// FREE FREELY - 바다 (Gerstner 파동 + 프레넬 반사 + 해안 포말)
// CPU/GPU가 동일한 파동식을 사용하므로 부력·착수 판정이 시각과 일치한다.
import * as THREE from 'three';
import { clamp, lerp } from '../core/utils.js';
import { MAP_HALF, MAP_SPACING } from './terrain.js';

// 파동 성분: [방향x, 방향z, 파장(m), 진폭(m), 뾰족함, 속도배율]
const WAVES = [
  [1.00, 0.18, 210, 1.55, 0.62, 1.00],
  [0.72, -0.69, 124, 0.95, 0.55, 1.08],
  [-0.36, 0.93, 67, 0.52, 0.48, 1.16],
  [0.94, 0.34, 38, 0.28, 0.42, 1.25],
  [-0.82, -0.57, 21, 0.15, 0.38, 1.35],
  [0.21, -0.98, 11.5, 0.075, 0.32, 1.5],
];

const WATER_VERT = /* glsl */`
precision highp float;
uniform float uTime;
uniform float uSeaState;
uniform vec3 uCenter;
uniform vec2 uWaveDir[6];
uniform vec4 uWaveParam[6];   // x: 파장, y: 진폭, z: 뾰족함, w: 속도배율
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFoam;
varying float vDistance;

void main() {
  vec3 world = vec3(position.x + uCenter.x, 0.0, position.z + uCenter.z);
  vec3 disp = vec3(0.0);
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  float crest = 0.0;
  float fade = 1.0 - smoothstep(2500.0, 14000.0, length(position.xz));
  for (int i = 0; i < 6; i++) {
    vec2 d = normalize(uWaveDir[i]);
    float L = uWaveParam[i].x;
    float A = uWaveParam[i].y * uSeaState;
    float Q = uWaveParam[i].z;
    float sp = uWaveParam[i].w;
    float k = 6.28318530718 / L;
    float c = sqrt(9.81 / k) * sp;
    float f = k * (dot(d, world.xz) - c * uTime);
    float s = sin(f), co = cos(f);
    float qa = Q * A;
    disp.x += qa * d.x * co;
    disp.z += qa * d.y * co;
    disp.y += A * s;
    // 해석적 미분 → 노멀
    tangent += vec3(-qa * d.x * d.x * k * s, d.x * k * A * co, -qa * d.x * d.y * k * s);
    binormal += vec3(-qa * d.x * d.y * k * s, d.y * k * A * co, -qa * d.y * d.y * k * s);
    crest += max(0.0, s) * A * k * 2.2;
  }
  world += disp * fade;
  vWorld = world;
  vNormal = normalize(cross(binormal, tangent));
  vFoam = clamp(crest * 0.25 * uSeaState - 0.12, 0.0, 1.0);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  vDistance = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const WATER_FRAG = /* glsl */`
precision highp float;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform float uDay;
uniform sampler2D uDepthMap;      // 해저 깊이 (0=깊음, 1=얕음)
uniform float uMapHalf;
uniform vec3 uCameraPos;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFoam;
varying float vDistance;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec3 V = normalize(uCameraPos - vWorld);
  vec3 N = normalize(vNormal);
  // 잔물결 (고주파 노멀 섭동)
  vec2 rp = vWorld.xz * 0.35;
  float r1 = noise(rp + vec2(uTime * 0.7, uTime * 0.4));
  float r2 = noise(rp * 2.7 - vec2(uTime * 0.9, uTime * 0.5));
  float ripple = clamp(1.0 - vDistance / 900.0, 0.0, 1.0);
  N = normalize(N + vec3((r1 - 0.5) * 0.55, 0.0, (r2 - 0.5) * 0.55) * ripple);
  if (dot(N, V) < 0.0) N = reflect(N, V);

  // 거친 수면의 프레넬 (Schlick, 상한을 두어 원경이 하얗게 날아가지 않게)
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  fres = clamp(mix(0.02, 1.0, fres), 0.02, 0.62);

  // 수심 (해안 얕은 물 표현)
  vec2 duv = (vWorld.xz + uMapHalf) / (uMapHalf * 2.0);
  float shallow = texture2D(uDepthMap, duv).r;
  vec3 baseCol = mix(uDeepColor, uShallowColor, pow(shallow, 1.9));

  // 하늘 반사
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, clamp(R.y * 1.5, 0.0, 1.0)) * 0.78;

  // 태양 반사 (거친 표면의 광택)
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 420.0) * 2.6;
  float glitter = pow(max(dot(N, H), 0.0), 42.0) * 0.16;

  // 파도 산란 (crest 투과광)
  float sss = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 2.0) * max(0.0, dot(uSunDir, vec3(0.0, 1.0, 0.0)));

  vec3 col = mix(baseCol, sky, fres);
  col += uSunColor * (spec + glitter) * (0.35 + uDay);
  col += uShallowColor * sss * 0.35 * uDay;

  // 포말: 파고 + 해안
  float shoreFoam = smoothstep(0.86, 0.995, shallow) * (0.55 + 0.45 * noise(vWorld.xz * 0.12 + uTime * 0.25));
  float foam = clamp(vFoam + shoreFoam, 0.0, 1.0);
  float foamTex = noise(vWorld.xz * 0.9 + uTime * 0.3) * 0.6 + noise(vWorld.xz * 3.1 - uTime * 0.6) * 0.4;
  col = mix(col, vec3(0.94, 0.97, 1.0) * (0.35 + 0.65 * uDay), foam * smoothstep(0.35, 0.8, foamTex));

  // 지수 안개
  float fogAmt = 1.0 - exp(-pow(vDistance * uFogDensity, 2.0));
  col = mix(col, uFogColor, clamp(fogAmt, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

export class Ocean {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.time = 0;
    this.seaState = 0.7;

    const dirs = [], params = [];
    for (const w of WAVES) {
      dirs.push(new THREE.Vector2(w[0], w[1]));
      params.push(new THREE.Vector4(w[2], w[3], w[4], w[5]));
    }

    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSeaState: { value: 1 },
        uCenter: { value: new THREE.Vector3() },
        uWaveDir: { value: dirs },
        uWaveParam: { value: params },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xfff0d8) },
        uSkyZenith: { value: new THREE.Color(0x2a5f9e) },
        uSkyHorizon: { value: new THREE.Color(0xb8d4ee) },
        uDeepColor: { value: new THREE.Color(0x061a2c) },
        uShallowColor: { value: new THREE.Color(0x1f7d8c) },
        uFogColor: { value: new THREE.Color(0xb8d4ee) },
        uFogDensity: { value: 0.00009 },
        uDay: { value: 1 },
        uDepthMap: { value: makeDepthTexture(terrain) },
        uMapHalf: { value: MAP_HALF },
        uCameraPos: { value: new THREE.Vector3() },
      },
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(makeRadialDisc(18000, 144, 110), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'ocean';
    scene.add(this.mesh);

    // 수면 아래에서 보이는 심해 배경 (수중 시야)
    this.underMaterial = new THREE.MeshBasicMaterial({ color: 0x05121f, side: THREE.BackSide, fog: false });
  }

  /** CPU 파고 계산 — GPU와 동일식 */
  heightAt(x, z, time = this.time) {
    let y = 0;
    const s = this.seaState;
    for (let i = 0; i < WAVES.length; i++) {
      const w = WAVES[i];
      const len = Math.hypot(w[0], w[1]);
      const dx = w[0] / len, dz = w[1] / len;
      const L = w[2], A = w[3] * s, sp = w[5];
      const k = 6.28318530718 / L;
      const c = Math.sqrt(9.81 / k) * sp;
      const f = k * (dx * x + dz * z - c * time);
      y += A * Math.sin(f);
    }
    return y;
  }

  normalAt(x, z, time = this.time, out = new THREE.Vector3()) {
    const e = 0.8;
    const hL = this.heightAt(x - e, z, time), hR = this.heightAt(x + e, z, time);
    const hD = this.heightAt(x, z - e, time), hU = this.heightAt(x, z + e, time);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  update(dt, camera, sky, seaState = 0.7) {
    this.time += dt;
    this.seaState = clamp(0.25 + seaState * 1.5, 0.15, 2.6);
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    u.uSeaState.value = this.seaState;
    u.uCenter.value.set(Math.round(camera.position.x), 0, Math.round(camera.position.z));
    u.uCameraPos.value.copy(camera.position);
    this.mesh.position.set(0, 0, 0);
    if (sky) {
      u.uSunDir.value.copy(sky.sunDirection);
      u.uSunColor.value.copy(sky.sunColor);
      u.uFogColor.value.copy(sky.fogColor);
      u.uSkyHorizon.value.copy(sky.horizonColor);
      u.uSkyZenith.value.copy(sky.horizonColor).lerp(new THREE.Color(0x14406f), 0.82);
      u.uDay.value = clamp(sky.dayFactor, 0.03, 1);
      const night = 1 - sky.dayFactor;
      u.uDeepColor.value.setRGB(lerp(0.022, 0.006, night), lerp(0.10, 0.02, night), lerp(0.17, 0.05, night));
      u.uShallowColor.value.setRGB(lerp(0.12, 0.02, night), lerp(0.49, 0.10, night), lerp(0.55, 0.16, night));
    }
  }

  setFog(density) { this.material.uniforms.uFogDensity.value = density; }
}

/** 중심이 촘촘하고 외곽이 성긴 원판 — 카메라 추종 수면 */
function makeRadialDisc(radius, angular, rings) {
  const pos = [];
  const index = [];
  pos.push(0, 0, 0);
  for (let r = 1; r <= rings; r++) {
    const t = r / rings;
    const rad = Math.pow(t, 2.6) * radius + t * 12;
    for (let a = 0; a < angular; a++) {
      const ang = (a / angular) * Math.PI * 2;
      pos.push(Math.cos(ang) * rad, 0, Math.sin(ang) * rad);
    }
  }
  // 중심 팬
  for (let a = 0; a < angular; a++) {
    const b = 1 + a, c = 1 + ((a + 1) % angular);
    index.push(0, b, c);
  }
  for (let r = 0; r < rings - 1; r++) {
    const base = 1 + r * angular;
    const next = base + angular;
    for (let a = 0; a < angular; a++) {
      const a0 = base + a, a1 = base + ((a + 1) % angular);
      const b0 = next + a, b1 = next + ((a + 1) % angular);
      index.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  geo.boundingSphere.radius = radius * 2;
  return geo;
}

/** 지형 하이트맵 → 얕은물 마스크 텍스처 */
function makeDepthTexture(terrain, size = 256) {
  const data = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = -MAP_HALF + (i / (size - 1)) * MAP_HALF * 2;
      const z = -MAP_HALF + (j / (size - 1)) * MAP_HALF * 2;
      const h = terrain && terrain.heights ? terrain.heightAt(x, z) : -100;
      // 0 = 깊은 바다, 1 = 해안선
      const v = clamp(1 + h / 170, 0, 1);
      data[j * size + i] = Math.round(Math.pow(v, 2.2) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  void MAP_SPACING;
  return tex;
}
