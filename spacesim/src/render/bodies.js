// SpaceSim — 구체 천체 렌더러
//
// 화면에서 충분히 커진 천체는 점 스프라이트 대신 실제 구체로 그린다.
// 광원(주성) 방향으로 조명해 위상(초승달·반달)과 명암경계가 실제처럼 나타나고,
// 자전주기·자전축 기울기를 적용해 회전한다. 토성에는 실제 구조의 고리를 붙인다.

import * as THREE from 'three';
import { getTexture, getRingTexture } from './textures.js';
import { BODY_DATA } from '../data/bodies.js';
import { KM_PER_AU, DEG } from '../core/constants.js';

const SPHERE_VERT = /* glsl */`
varying vec3 vN;
varying vec2 vUv;
varying vec3 vV;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SPHERE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uMap;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uAmbient;
uniform vec3 uAtmo;
uniform float uAtmoStrength;
uniform float uSpecular;
uniform float uEmissive;
varying vec3 vN;
varying vec2 vUv;
varying vec3 vV;

void main() {
  vec3 base = texture2D(uMap, vUv).rgb;
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);

  if (uEmissive > 0.5) {
    // 항성: 주연감광(limb darkening) 을 역으로 — 가장자리로 갈수록 밝게 번진다
    float mu = max(dot(N, V), 0.0);
    float limb = 0.45 + 0.55 * pow(mu, 0.42);
    float rim = pow(1.0 - mu, 2.2);
    gl_FragColor = vec4(base * limb + vec3(1.0, 0.86, 0.62) * rim * 0.75, 1.0);
    return;
  }

  float ndl = dot(N, uLightDir);
  float lam = max(0.0, ndl);
  // 대기 산란 때문에 명암경계는 기하학적 경계보다 조금 넓다
  float term = smoothstep(-0.10, 0.22, ndl);

  vec3 col = base * uLightColor * (uAmbient + lam * 1.28);

  if (uSpecular > 0.0) {
    vec3 H = normalize(uLightDir + V);
    float spec = pow(max(dot(N, H), 0.0), 56.0);
    // 파란 픽셀(바다)에서만 정반사
    float ocean = smoothstep(0.10, 0.02, base.r) * smoothstep(0.12, 0.34, base.b);
    col += uLightColor * spec * ocean * uSpecular;
  }

  // 대기 림라이트 — 낮쪽 가장자리에서 가장 강하다
  float rim = pow(1.0 - max(dot(V, N), 0.0), 3.0);
  col += uAtmo * rim * uAtmoStrength * (0.12 + 1.05 * term);

  gl_FragColor = vec4(col, 1.0);
}`;

const RING_VERT = /* glsl */`
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const RING_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uMap;
uniform float uInner;
uniform float uOuter;
uniform vec3 uLightDir;
uniform vec3 uCenter;
uniform float uPlanetR;
varying vec3 vLocal;
varying vec3 vWorld;

void main() {
  float r = length(vLocal.xy);
  float t = (r - uInner) / (uOuter - uInner);
  if (t < 0.0 || t > 1.0) discard;
  vec4 c = texture2D(uMap, vec2(t, 0.5));
  if (c.a < 0.01) discard;

  // 행성 그림자 — 광원 반대쪽에서 행성 원기둥 안에 들어오면 가려진다
  vec3 d = vWorld - uCenter;
  float along = dot(d, uLightDir);
  float perp = length(d - along * uLightDir);
  float shadow = 1.0;
  if (along < 0.0) shadow = smoothstep(uPlanetR * 0.92, uPlanetR * 1.12, perp);

  gl_FragColor = vec4(c.rgb * (0.22 + 0.95 * shadow), c.a);
}`;

const MAX_SPHERES = 14;

export class BodyMeshes {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    // 극을 +Z 로 맞춘다 (시뮬레이션은 황도면 z-up)
    this.geo = new THREE.SphereGeometry(1, 64, 40);
    this.geo.rotateX(Math.PI / 2);

    this.slots = [];
    for (let i = 0; i < MAX_SPHERES; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: null },
          uLightDir: { value: new THREE.Vector3(1, 0, 0) },
          uLightColor: { value: new THREE.Color(1, 0.97, 0.92) },
          uAmbient: { value: 0.035 },
          uAtmo: { value: new THREE.Color(0, 0, 0) },
          uAtmoStrength: { value: 0 },
          uSpecular: { value: 0 },
          uEmissive: { value: 0 },
        },
        vertexShader: SPHERE_VERT,
        fragmentShader: SPHERE_FRAG,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.slots.push({ mesh, mat, body: -1 });
    }

    this._buildRing();
    this.textureBudget = 1; // 프레임당 새 텍스처 생성 개수
    this.rendered = new Set();
  }

  _buildRing() {
    // 반지름 1 기준 링 — 실제 스케일은 매 프레임 적용
    const g = new THREE.RingGeometry(1, 2.41, 192, 1);
    this.ringMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uInner: { value: 1 },
        uOuter: { value: 2.41 },
        uLightDir: { value: new THREE.Vector3(1, 0, 0) },
        uCenter: { value: new THREE.Vector3() },
        uPlanetR: { value: 1 },
      },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(g, this.ringMat);
    this.ring.visible = false;
    this.ring.frustumCulled = false;
    this.ring.renderOrder = 3;
    this.group.add(this.ring);
  }

  /**
   * @param {NBody} sim
   * @param {View} view
   * @param {number} minPx 구체로 전환할 최소 화면 반지름 [px]
   */
  update(sim, view, minPx = 4) {
    this.rendered.clear();
    const cam = view.camera;
    const pxScale = view.pointMat.uniforms.uPixelScale.value;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const tmp = [0, 0, 0];
    const cands = [];

    for (let i = 0; i < sim.count; i++) {
      if (!sim.active[i]) continue;
      const m = sim.meta[i];
      if (!m.data) continue;             // 실측 데이터가 있는 천체만 구체로 그린다
      const i3 = i * 3;
      const x = sim.pos[i3], y = sim.pos[i3 + 1], z = sim.pos[i3 + 2];
      view.mapPos(x, y, z, tmp);
      const dist = Math.hypot(tmp[0] - cam.position.x, tmp[1] - cam.position.y, tmp[2] - cam.position.z);
      const rWorld = Math.hypot(x - view.origin[0], y - view.origin[1], z - view.origin[2]);
      const rr = sim.radius[i] * view.localScale(rWorld) * (m.drawScale || 1) * view.bodyScale;
      const px = (rr * pxScale / dpr) / Math.max(dist, 1e-9);
      if (px < minPx) continue;
      cands.push({ i, px, rr, p: [tmp[0], tmp[1], tmp[2]] });
    }
    cands.sort((a, b) => b.px - a.px);
    cands.length = Math.min(cands.length, MAX_SPHERES);

    // 광원 — 가장 밝은(무거운) 항성. 방향은 시뮬레이션 좌표계에서 구해야 정확하다.
    const star = this._starIndex(sim);
    const lightPos = star >= 0
      ? [sim.pos[star * 3], sim.pos[star * 3 + 1], sim.pos[star * 3 + 2]]
      : [0, 0, 0];

    let made = 0;
    let ringDone = false;

    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      const c = cands[s];
      if (!c) { slot.mesh.visible = false; continue; }

      const m = sim.meta[c.i];
      const d = m.data;
      const texId = m.textureId || (m.textureId = `${d.texture}:${m.name}`);
      let tex = slot.mat.uniforms.uMap.value;
      if (!m._tex) {
        if (made >= this.textureBudget) { slot.mesh.visible = false; continue; }
        m._tex = getTexture(texId, {
          kind: d.texture, color: d.color ?? m.color,
          craters: d.craters, spot: d.spot, bands: d.bands,
        });
        made++;
      }
      tex = m._tex;

      slot.mesh.visible = true;
      slot.body = c.i;
      this.rendered.add(c.i);
      slot.mesh.position.set(c.p[0], c.p[1], c.p[2]);
      slot.mesh.scale.setScalar(c.rr);

      // 자전축 기울기 + 자전
      const tilt = (d.tilt ?? 0) * DEG;
      const rot = d.rot ? (sim.time / d.rot) * Math.PI * 2 : 0;
      slot.mesh.rotation.set(0, 0, 0);
      slot.mesh.rotateX(tilt);
      slot.mesh.rotateZ(rot + (m.rotPhase || 0));

      const u = slot.mat.uniforms;
      u.uMap.value = tex;
      const isStar = d.type === 'star';
      u.uEmissive.value = isStar ? 1 : 0;
      if (!isStar) {
        const lx = lightPos[0] - sim.pos[c.i * 3];
        const ly = lightPos[1] - sim.pos[c.i * 3 + 1];
        const lz = lightPos[2] - sim.pos[c.i * 3 + 2];
        const len = Math.hypot(lx, ly, lz) || 1;
        u.uLightDir.value.set(lx / len, ly / len, lz / len);
        u.uAmbient.value = 0.030;
        u.uSpecular.value = d.specular ?? 0;
        if (d.atmo) {
          u.uAtmo.value.setHex(d.atmo);
          u.uAtmoStrength.value = d.atmoStrength ?? 0.5;
        } else {
          u.uAtmoStrength.value = 0;
        }
      }

      // 고리
      if (d.ring && !ringDone) {
        ringDone = true;
        this.ring.visible = true;
        this.ring.position.copy(slot.mesh.position);
        this.ring.rotation.set(0, 0, 0);
        this.ring.rotateX(tilt);
        // 실제 고리: 내경 74,500 km / 외경 140,200 km, 토성 반경 58,232 km
        const inner = c.rr * (74500 / 58232);
        const outer = c.rr * (140200 / 58232);
        this.ring.scale.setScalar(outer / 2.41);
        const rm = this.ringMat.uniforms;
        rm.uMap.value = getRingTexture();
        rm.uInner.value = inner / (outer / 2.41);
        rm.uOuter.value = 2.41;
        rm.uLightDir.value.copy(u.uLightDir.value);
        rm.uCenter.value.copy(slot.mesh.position);
        rm.uPlanetR.value = c.rr;
      }
    }
    if (!ringDone) this.ring.visible = false;
  }

  _starIndex(sim) {
    let best = -1, bm = -1;
    for (let i = 0; i < sim.count; i++) {
      if (!sim.active[i]) continue;
      if (sim.meta[i].type !== 'star' && sim.meta[i].type !== 'bh') continue;
      if (sim.mass[i] > bm) { bm = sim.mass[i]; best = i; }
    }
    return best >= 0 ? best : sim.primaryIndex();
  }

  hide() {
    for (const s of this.slots) s.mesh.visible = false;
    this.ring.visible = false;
    this.rendered.clear();
  }
}

/** 천체 데이터에서 반지름(AU) 얻기 */
export function radiusAU(key) {
  const d = BODY_DATA[key];
  return d ? d.R / KM_PER_AU : 1e-5;
}
