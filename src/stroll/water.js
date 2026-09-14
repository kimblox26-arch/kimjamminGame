// 고요(GOYO) — 호수: 수면 셰이더 + 물결 파문
import * as THREE from 'three';
import { WATER_LEVEL, LAKE } from './terrain.js';
import { TAU } from '../core/utils.js';

const WATER_VERT = /* glsl */`
varying vec3 vWorld;
varying float vFogDepth;
uniform float uTime;
void main() {
  vec3 p = position;
  // 아주 완만한 수면 기복
  p.z += sin(p.x * 0.12 + uTime * 0.7) * 0.045 + sin(p.y * 0.17 - uTime * 0.53) * 0.04;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const WATER_FRAG = /* glsl */`
precision highp float;
varying vec3 vWorld;
varying float vFogDepth;

uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uNight;
uniform sampler2D uDepthMap;
uniform vec2 uLakeMin;
uniform float uLakeSize;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;

// 값 노이즈
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

float waveHeight(vec2 p, float t) {
  vec2 d1 = vec2(t * 0.055, t * 0.031);
  vec2 d2 = vec2(-t * 0.042, t * 0.07);
  return noise(p * 0.16 + d1) * 0.62
       + noise(p * 0.46 - d2) * 0.26
       + noise(p * 1.15 + d1 * 2.0) * 0.12;
}

/** 거리에 따라 잔물결을 줄여 멀리서 지글거리지 않게 한다 */
vec3 waveNormal(vec2 p, float t, float detail) {
  float e = 0.9;
  float h  = waveHeight(p, t);
  float hx = waveHeight(p + vec2(e, 0.0), t);
  float hz = waveHeight(p + vec2(0.0, e), t);
  return normalize(vec3((h - hx) * 1.1 * detail, 0.42, (h - hz) * 1.1 * detail));
}

void main() {
  vec2 duv = (vWorld.xz - uLakeMin) / uLakeSize;
  float depth = texture2D(uDepthMap, duv).r;
  if (depth <= 0.001) discard;

  float camDist = distance(cameraPosition, vWorld);
  float detail = 1.0 - smoothstep(8.0, 90.0, camDist) * 0.75;
  vec3 n = waveNormal(vWorld.xz, uTime, detail);
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.2);

  // 반사(하늘) + 투과(바닥)
  vec3 refl = mix(uHorizon, uZenith, clamp(reflect(-viewDir, n).y * 1.6, 0.0, 1.0));
  vec3 body = mix(uShallow, uDeep, smoothstep(0.02, 0.5, depth));
  vec3 col = mix(body, refl, clamp(fres * 0.92 + 0.08, 0.0, 1.0));

  // 햇빛 반짝임
  float sp = max(dot(reflect(-uSunDir, n), viewDir), 0.0);
  float spec = pow(sp, 120.0) * detail;
  float glint = pow(sp, 14.0) * 0.1;
  col += uSunColor * (spec * 1.6 + glint) * (1.0 - uNight * 0.75);

  // 물가 포말
  float edge = 1.0 - smoothstep(0.0, 0.075, depth);
  float foam = edge * (0.45 + 0.55 * noise(vWorld.xz * 3.2 + vec2(uTime * 0.35, -uTime * 0.22)));
  col = mix(col, vec3(0.92, 0.95, 0.96), foam * 0.5);

  float alpha = mix(0.42, 0.94, smoothstep(0.0, 0.22, depth));
  alpha = mix(alpha, 0.85, foam * 0.4);

  gl_FragColor = vec4(col, alpha);
  float f = smoothstep(fogNear, fogFar, vFogDepth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, f);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Water {
  constructor(scene, depthBake) {
    this.scene = scene;
    const half = depthBake.half;
    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0xfff0d2) },
      uZenith: { value: new THREE.Color(0x3f7ec4) },
      uHorizon: { value: new THREE.Color(0xbcd3e6) },
      uDeep: { value: new THREE.Color(0x1b3b3f) },
      uShallow: { value: new THREE.Color(0x5d7a6a) },
      uNight: { value: 0 },
      uDepthMap: { value: depthBake.tex },
      uLakeMin: { value: new THREE.Vector2(LAKE.x - half, LAKE.z - half) },
      uLakeSize: { value: half * 2 },
      fogColor: { value: new THREE.Color(0xc6d6e4) },
      fogNear: { value: 30 },
      fogFar: { value: 520 },
    };

    const geo = new THREE.PlaneGeometry(half * 2, half * 2, 96, 96);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      fog: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(LAKE.x, WATER_LEVEL, LAKE.z);
    this.mesh.renderOrder = 10;
    this.mesh.name = 'lake';
    scene.add(this.mesh);

    this.ripples = new Ripples(scene, 48);
  }

  update(dt, sky) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uSunDir.value.copy(sky.sunDir);
    u.uSunColor.value.copy(sky.uniforms.uSunTint.value);
    u.uZenith.value.copy(sky.uniforms.uZenith.value);
    u.uHorizon.value.copy(sky.uniforms.uHorizon.value);
    u.uNight.value = sky.night;
    u.fogColor.value.copy(this.scene.fog.color);
    u.fogNear.value = this.scene.fog.near;
    u.fogFar.value = this.scene.fog.far;
    this.ripples.update(dt);
  }

  splash(x, z, strength = 1) { this.ripples.spawn(x, z, strength); }
}

/** 수면 파문 링 풀 */
class Ripples {
  constructor(scene, count) {
    const tex = ringTexture();
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, fog: true,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.items = [];
    for (let i = 0; i < count; i++) this.items.push({ life: 0, x: 0, z: 0, s: 1, dur: 0 });
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this.next = 0;
    scene.add(this.mesh);
    this._hideAll();
  }

  _hideAll() {
    this._s.set(0, 0, 0);
    for (let i = 0; i < this.items.length; i++) {
      this._m.compose(this._v.set(0, -999, 0), this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  spawn(x, z, strength = 1) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.life = 0; it.x = x; it.z = z;
    it.s = 1.2 + strength * 2.2;
    it.dur = 1.6 + strength * 1.4;
  }

  update(dt) {
    let dirty = false;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.dur <= 0 || it.life >= it.dur) continue;
      it.life += dt;
      const t = Math.min(1, it.life / it.dur);
      const scale = it.s * (0.25 + t * 1.8);
      this._v.set(it.x, WATER_LEVEL + 0.035, it.z);
      this._m.compose(this._v, this._q, this._s.set(scale, scale, scale));
      this.mesh.setMatrixAt(i, this._m);
      const fade = (1 - t) * (1 - t) * 0.5;
      this.mesh.instanceColor.setXYZ(i, fade, fade * 1.02, fade * 1.05);
      dirty = true;
      if (t >= 1) {
        it.dur = 0;
        this._m.compose(this._v.set(0, -999, 0), this._q, this._s.set(0, 0, 0));
        this.mesh.setMatrixAt(i, this._m);
      }
    }
    if (dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
  }
}

function ringTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  for (let i = 0; i < 3; i++) {
    const r = size * (0.22 + i * 0.11);
    g.beginPath();
    g.arc(size / 2, size / 2, r, 0, TAU);
    g.strokeStyle = `rgba(255,255,255,${0.5 - i * 0.14})`;
    g.lineWidth = size * (0.028 - i * 0.006);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
