// SKY BLADE — 검과 스킬
//  - 오른손에 쥔 검 (금속 날 + 금빛 코등이 + 가죽 손잡이), 기를 모으면 날이 푸르게 빛남
//  - 베기 (J / 마우스 왼쪽): 3단 콤보 (횡베기 → 사선 → 내려베기). 칼끝 궤적 + 초승달 검광. 가까운 건물은 베인 높이에서 잘려 미끄러져 떨어짐
//  - 검기 (L): 거대한 초승달 에너지 칼날이 날아가며 지나가는 건물을 모두 그 높이에서 베어 넘김
//  - 에너지 빔 (K 꾹 / 마우스 오른쪽): 누르는 동안 기를 모으고(최대 1.6초) 놓으면 조준한 곳으로 발사. 맞은 건물은 뚫리고 넘어가고, 끝점은 폭발
//  - 자세: 애니메이터가 만든 오른팔 자세 위에 공격 자세를 섞음 (몸 좌표계의 팔 방향 a, 날 쪽 방향 b 로 어깨 회전을 만듦)
import * as THREE from 'three';
import { origin, onRebase } from './frame.js';

const TAU = Math.PI * 2, D2R = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p) => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _e = new THREE.Vector3(), _f = new THREE.Vector3(), _g = new THREE.Vector3(), _h = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);
const ENERGY = new THREE.Color(0.45, 1.25, 3.0);   // 검기/빔 색 (HDR, 선형)

// 몸 좌표 방향 (az: 정면 0, +면 왼쪽(+X) / el: 위 +)
function dirAzEl(az, el, out) {
  const ca = Math.cos(el * D2R);
  return out.set(Math.sin(az * D2R) * ca, Math.sin(el * D2R), Math.cos(az * D2R) * ca);
}
// 팔 방향 a, 날 쪽 b (a ⟂ b) → 어깨 회전 (팔 로컬 -Y → a, +Z → b)
function armQuat(a, b, out) {
  _h.crossVectors(_v.copy(a).negate(), b);
  _m.makeBasis(_h, _v, b);
  return out.setFromRotationMatrix(_m);
}

// 4단 콤보 + 발도/납도/돌진 베기/검기 (팔 방향 시작/끝 [az, el] °, 휘두르기·준비·회수 시간)
//  spin: 몸이 한 바퀴 돌며 주위를 모두 벰, slam: 뛰어올라 내려찍어 땅에 충격파
const SLASH = [
  { a0: [-125, 14], a1: [80, -4], sw: 0.14, tw: 0.07, tr: 0.24 },
  { a0: [72, 58], a1: [-98, -28], sw: 0.13, tw: 0.06, tr: 0.24 },
  { a0: [-95, 6], a1: [-95, 2], sw: 0.34, tw: 0.08, tr: 0.26, spin: 1 },
  { a0: [-12, 135], a1: [-6, -62], sw: 0.15, tw: 0.2, tr: 0.36, slam: 1 },
];
const DRAW = { a0: [58, -30], a1: [-118, 12], sw: 0.12, tw: 0.14, tr: 0.3, draw: 1 };     // 발도: 왼쪽 허리에서 뽑으며 벰
const SHEATHE = { a0: [40, -40], a1: [40, -40], sw: 0.01, tw: 0.3, tr: 0.25, sheathe: 1 };  // 납도
const DASH = { a0: [-70, 18], a1: [75, -8], sw: 0.12, tw: 0.05, tr: 0.26, dash: 1 };      // 돌진 베기
const WAVE = { a0: [-150, 22], a1: [100, 4], sw: 0.13, tw: 0.2, tr: 0.32 };

// ── 검 모델 ──
function bladeGeometry(len, w, th) {
  const st = [0, 0.1, 0.3, 0.55, 0.8, 0.9, 1.0];
  const pts = [];
  const y0 = 0.17;
  for (const s of st) {
    const y = y0 + s * len;
    const hw = s >= 1 ? 0 : (w / 2) * (s < 0.82 ? 1 - 0.18 * s : (1 - 0.18 * 0.82) * (1 - (s - 0.82) / 0.18) ** 0.8);
    const ht = s >= 1 ? 0 : (th / 2) * (1 - 0.35 * s);
    pts.push([[-hw, y, 0], [0, y, ht], [hw, y, 0], [0, y, -ht]]);
  }
  const pos = [];
  const tri = (A, B, C) => pos.push(...A, ...B, ...C);
  for (let i = 0; i < pts.length - 1; i++) {
    const P = pts[i], Q = pts[i + 1];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      tri(P[k], P[k2], Q[k2]);
      if (i < pts.length - 2) tri(P[k], Q[k2], Q[k]);
    }
  }
  // 밑면 막기
  const P = pts[0];
  tri(P[0], P[2], P[1]); tri(P[0], P[3], P[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const GLOW_VS = /* glsl */`
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vY = position.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const GLOW_FS = /* glsl */`
uniform vec3 uColor; uniform float uI; uniform float uTime;
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float flick = 0.85 + 0.15 * sin(uTime * 37.0 + vY * 18.0);
  float a = uI * (0.25 + 1.2 * f * f) * flick;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

// 날 가운데 새겨진 문양: 기를 모으면 흐르듯 빛남
const RUNE_FS = /* glsl */`
uniform vec3 uColor; uniform float uI; uniform float uTime;
varying vec2 vUv;
void main() {
  float g = 1.0 - smoothstep(0.15, 0.5, abs(vUv.x - 0.5));
  float flow = 0.55 + 0.45 * sin(vUv.y * 46.0 - uTime * 9.0);
  float glyph = step(0.55, fract(vUv.y * 23.0 + sin(floor(vUv.y * 23.0) * 7.1) * 0.3));
  float a = uI * g * (0.35 + 0.65 * flow) * (0.6 + 0.4 * glyph) * smoothstep(0.0, 0.05, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y));
  gl_FragColor = vec4(uColor * a, 1.0);
}`;
const RUNE_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export function makeSword(envMap) {
  const pivot = new THREE.Group();
  pivot.name = 'sword';
  const len = 1.5;
  const blade = new THREE.Mesh(bladeGeometry(len, 0.11, 0.028), new THREE.MeshPhysicalMaterial({
    color: 0xe3ebf4, metalness: 1, roughness: 0.12, envMap, envMapIntensity: 1.5, clearcoat: 1, clearcoatRoughness: 0.05,
    emissive: 0x000000,
  }));
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xd2a650, metalness: 1, roughness: 0.25, envMap, envMapIntensity: 1.2, clearcoat: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c130c, roughness: 0.85 });
  const gemMat = new THREE.MeshStandardMaterial({ color: 0x3aa8ff, emissive: 0x2a88ff, emissiveIntensity: 2.2, roughness: 0.15, metalness: 0.2 });
  // 코등이: 날 쪽으로 휜 두 갈래 + 가운데 보석
  const qc = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.23, 0.215, 0), new THREE.Vector3(-0.12, 0.155, 0), new THREE.Vector3(0, 0.14, 0), new THREE.Vector3(0.12, 0.155, 0), new THREE.Vector3(0.23, 0.215, 0)]);
  const guard = new THREE.Mesh(new THREE.TubeGeometry(qc, 24, 0.02, 8, false), gold);
  const guardC = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.07), gold);
  guardC.position.y = 0.15;
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.03, 0), gemMat);
  gem.position.set(0, 0.15, 0.038); gem.scale.set(1, 1.3, 0.5);
  const gem2 = gem.clone(); gem2.position.z = -0.038;
  for (const e of [-0.235, 0.235]) { const k = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), gold); k.position.set(e, 0.22, 0); pivot.add(k); }
  // 손잡이: 가죽 + 감개 고리
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.031, 0.27, 12), dark);
  for (let i = 0; i < 6; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.006, 6, 16), dark); r.rotation.x = Math.PI / 2; r.position.y = -0.11 + i * 0.045; pivot.add(r); }
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 10), gold);
  pommel.position.y = -0.16;
  const pgem = new THREE.Mesh(new THREE.OctahedronGeometry(0.022, 0), gemMat);
  pgem.position.y = -0.2;
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: ENERGY.clone() }, uI: { value: 0 }, uTime: { value: 0 } },
    vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const glow = new THREE.Mesh(blade.geometry, glowMat);
  glow.scale.set(2.6, 1.03, 5);
  glow.visible = false;
  // 문양 띠 (날 양면)
  const runeMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: ENERGY.clone() }, uI: { value: 0.35 }, uTime: { value: 0 } },
    vertexShader: RUNE_VS, fragmentShader: RUNE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  for (const sz of [1, -1]) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(0.018, len * 0.78), runeMat);
    r.position.set(0, 0.17 + len * 0.42, sz * 0.0145);
    if (sz < 0) r.rotation.y = Math.PI;
    pivot.add(r);
  }
  for (const m of [blade, guard, guardC, gem, gem2, grip, pommel, pgem]) { m.castShadow = true; pivot.add(m); }
  pivot.add(glow);
  // 손 좌표계: 팔 = -Y, 손등 앞 = +Z. 날은 손에서 앞·아래로 (0.6a + 0.8b), 날의 폭은 휘두르는 쪽
  _g.set(0, -0.6, 0.8); _e.set(0, 0.8, 0.6); _h.crossVectors(_e, _g);
  const handQ = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(_e, _g, _h));
  pivot.quaternion.copy(handQ);
  pivot.position.set(0, 0.02, 0.02);
  const tip = new THREE.Object3D(); tip.position.y = 0.17 + len; pivot.add(tip);
  const base = new THREE.Object3D(); base.position.y = 0.3; pivot.add(base);
  const tip2 = new THREE.Object3D(); tip2.position.y = 0.17 + len + 0.45; pivot.add(tip2);
  const base2 = new THREE.Object3D(); base2.position.y = 0.6; pivot.add(base2);
  return { pivot, blade, glow, glowMat, runeMat, tip, base, tip2, base2, len, handQ };
}

// ── 칼끝 궤적 리본 ──
const TRAIL_VS = /* glsl */`
attribute float aT; attribute float aS;
varying float vT; varying float vS;
void main() { vT = aT; vS = aS; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const TRAIL_FS = /* glsl */`
uniform vec3 uColor; uniform float uI;
varying float vT; varying float vS;
void main() {
  float age = clamp(vT, 0.0, 1.0);
  float edge = smoothstep(0.0, 0.25, vS) * (0.35 + 0.65 * vS);     // 칼끝 쪽이 진함
  float a = uI * (1.0 - age) * (1.0 - age) * edge;
  vec3 col = mix(uColor, vec3(3.2), smoothstep(0.75, 1.0, vS) * (1.0 - age));
  gl_FragColor = vec4(col * a, 1.0);
}`;
class Trail {
  constructor(scene, n = 28) {
    this.n = n;
    this.base = []; this.tip = []; this.t = [];
    const pos = new Float32Array(n * 2 * 3), aT = new Float32Array(n * 2), aS = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { aS[i * 2] = 0; aS[i * 2 + 1] = 1; }
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aT', new THREE.BufferAttribute(aT, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1.2, 1.5, 2.2) }, uI: { value: 1 } },
      vertexShader: TRAIL_VS, fragmentShader: TRAIL_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.visible = false;
    scene.add(this.mesh);
    onRebase((dx, dy, dz) => { for (const p of [...this.base, ...this.tip]) { p.x -= dx; p.y -= dy; p.z -= dz; } });
  }
  push(base, tip, time) {
    this.base.unshift(base.clone()); this.tip.unshift(tip.clone()); this.t.unshift(time);
    if (this.t.length > this.n) { this.base.pop(); this.tip.pop(); this.t.pop(); }
  }
  update(time, life, energy) {
    const m = this.n, P = this.mesh.geometry.attributes.position, T = this.mesh.geometry.attributes.aT;
    let k = this.t.length;
    while (k > 0 && time - this.t[k - 1] > life) k--;
    this.mesh.visible = k >= 2;
    if (!this.mesh.visible) return;
    for (let i = 0; i < m; i++) {
      const j = Math.min(i, k - 1);
      const b = this.base[j], t = this.tip[j];
      P.setXYZ(i * 2, b.x, b.y, b.z); P.setXYZ(i * 2 + 1, t.x, t.y, t.z);
      const age = i < k ? (time - this.t[j]) / life : 1;
      T.setX(i * 2, age); T.setX(i * 2 + 1, age);
    }
    P.needsUpdate = true; T.needsUpdate = true;
    this.mat.uniforms.uColor.value.setRGB(lerp(1.2, ENERGY.r, energy), lerp(1.5, ENERGY.g, energy), lerp(2.2, ENERGY.b, energy));
  }
  clear() { this.base.length = 0; this.tip.length = 0; this.t.length = 0; this.mesh.visible = false; }
}

// ── 초승달 검광 (베기 잔상 / 날아가는 검기) ──
const ARC_VS = /* glsl */`
uniform float uR0; uniform float uR1; uniform float uA0; uniform float uSpan; uniform float uBow;
varying vec2 vUv;
void main() {
  vUv = uv;
  float ang = uA0 + uv.x * uSpan;
  // 가운데가 두껍고 양끝이 가늘어지는 초승달
  float th = sin(3.14159 * uv.x);
  float r = mix(uR1 - (uR1 - uR0) * th, uR1, uv.y);
  // 날아가는 검기: 양끝이 뒤로 휨 (가운데가 앞으로 볼록)
  float mid = uA0 + 0.5 * uSpan;
  vec3 p = vec3(cos(ang) * r, sin(ang) * r, -uBow * r * (1.0 - cos(ang - mid)));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const ARC_FS = /* glsl */`
uniform vec3 uColor; uniform float uI; uniform float uReveal; uniform float uTime; uniform float uLead;
varying vec2 vUv;
float h1(float x) { return fract(sin(x * 91.3) * 43758.5); }
void main() {
  if (vUv.x > uReveal) discard;
  float lead = mix(1.0, smoothstep(uReveal - 0.5, uReveal, vUv.x), uLead);   // 베기: 앞쪽(최근)일수록 밝음
  float rim = smoothstep(0.0, 1.0, vUv.y);                           // 바깥 날 쪽이 밝음
  float streak = 0.75 + 0.25 * h1(floor(vUv.y * 14.0) + floor(uTime * 30.0));
  float ends = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x));
  float a = uI * ends * (0.25 + 0.75 * lead) * (0.15 + 0.85 * rim * rim) * streak;
  vec3 col = mix(uColor, vec3(3.0), rim * rim * rim * 0.8);
  gl_FragColor = vec4(col * a, 1.0);
}`;
let ARC_GEO = null;
function arcGeo() {
  if (ARC_GEO) return ARC_GEO;
  const NU = 40, NV = 3, pos = [], uv = [], idx = [];
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) { pos.push(0, 0, 0); uv.push(i / NU, j / NV); }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  ARC_GEO = g;
  return g;
}
function makeArc(scene) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uR0: { value: 1 }, uR1: { value: 2 }, uA0: { value: 0 }, uSpan: { value: 2 }, uBow: { value: 0 },
      uColor: { value: new THREE.Color(1.3, 1.6, 2.4) }, uI: { value: 1 }, uReveal: { value: 1 }, uTime: { value: 0 }, uLead: { value: 1 },
    },
    vertexShader: ARC_VS, fragmentShader: ARC_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(arcGeo(), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}

// ── 빔 (원기둥 두 겹: 하얀 심 + 푸른 빛) ──
const BEAM_VS = /* glsl */`
varying vec3 vN; varying vec3 vV; varying float vL;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vL = position.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const BEAM_FS = /* glsl */`
uniform vec3 uColor; uniform float uI; uniform float uTime; uniform float uLen; uniform float uCore;
varying vec3 vN; varying vec3 vV; varying float vL;
float h1(float x) { return fract(sin(x * 12.9898) * 43758.5453); }
float n1(float x) { float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main() {
  float c = abs(dot(normalize(vN), normalize(vV)));                  // 정면 = 원기둥 가운데
  float prof = uCore > 0.5 ? smoothstep(0.35, 1.0, c) : pow(c, 4.0) * 0.6;
  float d = vL * uLen;
  float wave = 0.8 + 0.2 * n1(d * 0.08 - uTime * 60.0) + 0.12 * sin(d * 0.6 - uTime * 90.0);
  // 멀어질수록 가늘고 흐리게 (공기 산란)
  float far = exp(-d / 2200.0);
  float a = uI * prof * wave * (0.35 + 0.65 * far);
  vec3 col = uCore > 0.5 ? mix(uColor, vec3(3.0), 0.55) : uColor * vec3(0.7, 0.9, 1.25);
  gl_FragColor = vec4(col * a, 1.0);
}`;
function makeBeam(scene) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0);
  const mk = (core) => {
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { uColor: { value: ENERGY.clone() }, uI: { value: 0 }, uTime: { value: 0 }, uLen: { value: 1 }, uCore: { value: core ? 1 : 0 } },
      vertexShader: BEAM_VS, fragmentShader: BEAM_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    m.frustumCulled = false; m.renderOrder = 10; m.visible = false;
    scene.add(m);
    return m;
  };
  return { core: mk(true), glow: mk(false) };
}

export class Blade {
  constructor(scene, game, player) {
    this.scene = scene; this.game = game; this.player = player;
    this.sword = makeSword(game.envMap || null);
    this.drawn = false;      // 처음엔 왼쪽 허리 칼집에
    this._toSheath();
    this.idleT = 0;
    this.trail = new Trail(scene);
    this.trail2 = new Trail(scene);      // 넓고 흐린 바깥 빛
    this.trail2.mat.uniforms.uI.value = 0.45;
    this.arcs = [];
    for (let i = 0; i < 6; i++) this.arcs.push({ mesh: makeArc(scene), t: 9, life: 0.3, kind: 'slash' });
    this.waves = [];
    this.beamMesh = makeBeam(scene);
    // 상태
    this.atk = null;          // { def, idx, t, hit, kind }
    this.combo = 0; this.comboT = 0; this.queued = false;
    this.charge = 0; this.charging = false; this.chargeSnd = 0;
    this.beam = null;         // { t, dur, power, r }
    this.w = 0;               // 공격 자세 섞는 비율
    this.twist = 0;
    this.armQ = new THREE.Quaternion();
    this.energy = 0;          // 날의 빛 0..1
    this.cool = 0; this.waveCool = 0; this.beamCool = 0;
    this.time = 0;
    this.aimAbs = new THREE.Vector3();    // 조준점 (절대)
    this.aimDir = new THREE.Vector3(0, 0, 1);
    this.beamFrom = new THREE.Vector3(); this.beamTo = new THREE.Vector3();
    this._tipW = new THREE.Vector3(); this._baseW = new THREE.Vector3();
    this._fx = 0;
    this.hits = 0;
    onRebase(() => {});
  }

  get busy() { return !!this.atk || this.charging || !!this.beam; }

  // 칼을 손으로 / 칼집으로 옮김
  _toHand() {
    const S = this.sword, h = this.player.avatar.limbs.handR;
    h.add(S.pivot);
    S.pivot.position.set(0, 0.02, 0.02); S.pivot.quaternion.copy(S.handQ);
    this.drawn = true;
  }
  _toSheath() {
    const S = this.sword;
    this.player.avatar.sheathSocket.add(S.pivot);
    S.pivot.position.set(0, 0, 0); S.pivot.quaternion.identity();
    this.drawn = false;
  }

  // ───────── 고정 스텝: 입력 → 상태 ─────────
  step(dt, input, cam) {
    const P = this.player, I = input.state;
    this.time += dt;
    this.cool = Math.max(0, this.cool - dt);
    this.waveCool = Math.max(0, this.waveCool - dt);
    this.beamCool = Math.max(0, this.beamCool - dt);
    this.comboT = Math.max(0, this.comboT - dt);
    if (this.comboT <= 0) this.combo = 0;
    const can = !P.hidden && (P.mode === 'ground' || P.mode === 'air' || P.mode === 'fly');
    const wantSlash = input.consume('slash'), wantWave = input.consume('wave');
    // 조준 (선분 질의가 무거워서 공격과 관련 있을 때만)
    if (wantSlash || wantWave || I.beam || this.busy) this._aim(cam);
    if (!can) { this.atk = null; this.charging = false; this.beam = null; }
    else {
      // 베기 / 검기 (공격 중 누르면 다음 콤보로 예약)
      if (wantSlash) { if (this.atk) this.queued = true; else this._startSlash(); }
      if (wantWave && !this.atk && this.waveCool <= 0 && !this.beam) { if (!this.drawn) this._toHand(); this._start(WAVE, 'wave'); }
      // 빔: 누르는 동안 기 모으기 → 놓으면 발사
      if (I.beam && !this.atk && !this.beam && this.beamCool <= 0) {
        if (!this.drawn) this._toHand();
        if (!this.charging) { this.charging = true; this.charge = 0; this.game.audio.play('charge', 1); }
        this.charge = Math.min(1.6, this.charge + dt);
        if (this.charge >= 1.6) this._fire();
      } else if (this.charging) this._fire();
    }
    // 한동안 싸우지 않으면 칼을 칼집에 넣음
    this.idleT = this.busy ? 0 : this.idleT + dt;
    if (can && this.drawn && this.idleT > 7 && !this.atk && P.mode !== 'fly') this._start(SHEATHE, 'sheathe');
    // 공격 진행
    const A = this.atk;
    let wT = 0;
    if (A) {
      A.t += dt;
      const d = A.def, tSw = A.t - d.tw;
      if (d.draw && tSw >= 0 && !this.drawn) { this._toHand(); this.game.audio.play('clang', 0.35); }
      if (d.sheathe && tSw >= 0 && this.drawn) { this._toSheath(); this.game.audio.play('clang', 0.3); }
      if (tSw >= d.sw * 0.45 && !A.hit && !d.sheathe) { A.hit = true; A.kind === 'wave' ? this._launchWave() : this._slashHit(A); }
      if (tSw >= d.sw && this.queued && A.kind === 'slash' && !d.sheathe) { this.queued = false; this._startSlash(); }
      else if (tSw >= d.sw + d.tr) { this.atk = null; }
      wT = A === this.atk ? (A.t < d.tw ? smooth(0, d.tw, A.t) : tSw < d.sw ? 1 : 1 - smooth(d.sw, d.sw + d.tr, tSw)) : 0;
    }
    if (this.charging || this.beam) wT = 1;
    this.w = this.charging || this.beam || this.atk ? Math.max(wT, lerp(this.w, wT, 1 - Math.exp(-30 * dt))) : lerp(this.w, 0, 1 - Math.exp(-12 * dt));
    // 내려찍기: 땅에 닿으면 충격파 (0.6 s 안에 못 닿으면 취소)
    if (this.slamPending > 0) {
      this.slamPending -= dt;
      if (P.mode === 'ground' && P.vel.y > -1) { this.slamPending = 0; this._slamLand(); }
    }
    // 빔 진행
    if (this.beam) this._stepBeam(dt);
    // 검기 비행
    for (let i = this.waves.length - 1; i >= 0; i--) if (!this._stepWave(this.waves[i], dt)) { this._dropWave(this.waves[i]); this.waves.splice(i, 1); }
    // 날 빛
    const eT = this.charging ? 0.3 + 0.7 * (this.charge / 1.6) : this.beam ? 1 : this.atk && this.atk.kind === 'wave' ? 1 : this.atk ? 0.25 : 0;
    this.energy = lerp(this.energy, eT, 1 - Math.exp(-10 * dt));
  }

  _startSlash() {
    if (this.cool > 0) return;
    const P = this.player;
    // 칼집에 있으면 뽑으면서 베기 (발도술)
    if (!this.drawn) { this.combo = 1; this.comboT = 0.9; this._start(DRAW, 'slash', 0); return; }
    // 달리거나 빠르게 날면 돌진 베기
    if ((P.mode === 'ground' && P.sprinting) || (P.mode === 'fly' && P.speed > 25 && P.speed < 400)) { this.combo = 0; this._start(DASH, 'slash', 0); return; }
    const idx = this.combo % SLASH.length;
    this.combo++; this.comboT = 0.9;
    this._start(SLASH[idx], 'slash', idx);
  }
  _start(def, kind, idx = 0) {
    const P = this.player;
    this.atk = { def, kind, idx, t: 0, hit: false };
    this.cool = 0.05;
    if (kind === 'wave') this.waveCool = 0.7;
    if (def.sheathe) return;
    // 조준 쪽으로 몸을 돌리고 내딛기
    P.heading = Math.atan2(this.aimDir.x, this.aimDir.z);
    _v.set(Math.sin(P.heading), 0, Math.cos(P.heading));
    if (P.mode === 'ground') P.dash.addScaledVector(_v, kind === 'wave' ? 5 : def.slam ? 2 : 3.6);
    if (def.dash) {
      // 돌진: 순식간에 앞으로 (지상 약 14 m, 비행 중엔 더 멀리)
      if (P.mode === 'ground') P.dash.addScaledVector(_v, 34);
      else P.vel.addScaledVector(this.aimDir, 45);
      this.dashFrom = new THREE.Vector3(P.pos.x + origin.x, P.pos.y + origin.y + 0.4, P.pos.z + origin.z);
      if (this.game.fx.dash) this.game.fx.dash(P.pos, _v);
    }
    if (def.slam && P.mode === 'ground') P.jump(9.5, 0.7);
    this.game.audio.play('slash', kind === 'wave' || def.dash || def.slam ? 1 : 0.8);
    this.game.hooks.fovKick && this.game.hooks.fovKick(def.dash ? 7 : 3);
    // 초승달 잔상
    const arc = this.arcs.find((a) => a.t > a.life) || this.arcs[0];
    arc.def = def; arc.t = -def.tw; arc.life = def.sw + 0.22; arc.kind = kind;
    this._placeArc(arc);
  }

  // 팔 휘두름 평면에 초승달을 놓음 (렌더 좌표, 몸 기준)
  _placeArc(arc) {
    const P = this.player, d = arc.def;
    // 휘두름이 180° 를 넘을 수 있으니 중간 방향으로 평면을 잡음
    dirAzEl(d.a0[0], d.a0[1], _a); dirAzEl(d.a1[0], d.a1[1], _b);
    dirAzEl((d.a0[0] + d.a1[0]) / 2, (d.a0[1] + d.a1[1]) / 2, _e);
    const n = _c.crossVectors(_a, _e).normalize();
    const x = _a.clone(), y = _d.crossVectors(n, x).normalize();
    _m.makeBasis(x, y, n);
    _q.setFromRotationMatrix(_m);
    _q2.setFromAxisAngle(Y, P.heading);
    const M = arc.mesh;
    M.quaternion.copy(_q2).multiply(_q);
    _v.set(-0.45, 0.42, 0.1).applyQuaternion(_q2);
    M.position.copy(P.pos).add(_v);
    const ang = Math.acos(clamp(_a.dot(_e), -1, 1)) + Math.acos(clamp(_e.dot(_b), -1, 1));
    const big = arc.kind === 'wave';
    const u = M.material.uniforms;
    u.uA0.value = 0; u.uSpan.value = ang; u.uR0.value = big ? 1.2 : 1.0; u.uR1.value = big ? 3.6 : 2.4;
    u.uColor.value.setRGB(big ? ENERGY.r : 1.3, big ? ENERGY.g : 1.6, big ? ENERGY.b : 2.4);
    M.visible = true;
    arc.follow = true;
  }

  // 조준: 카메라 시선이 처음 닿는 곳 (건물/지면), 없으면 3 km 앞
  _aim(cam) {
    const cp = Math.cos(cam.pitch);
    _f.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
    const c = cam.cam.position;
    const ax = c.x + origin.x, ay = c.y + origin.y, az = c.z + origin.z;
    let L = 3000;
    const C = this.game.city, hit = this._hit || (this._hit = {});
    if (C && C.segmentHit(ax, ay, az, ax + _f.x * L, ay + _f.y * L, az + _f.z * L, hit)) L = hit.t * L;
    const tl = this._terrainHit(ax, ay, az, _f.x, _f.y, _f.z, L);
    if (tl >= 0) L = tl;
    this.aimAbs.set(ax + _f.x * L, ay + _f.y * L, az + _f.z * L);
    // 몸(가슴)에서 조준점으로
    const P = this.player;
    _v.set(P.pos.x + origin.x, P.pos.y + origin.y + 0.4, P.pos.z + origin.z);
    this.aimDir.subVectors(this.aimAbs, _v);
    if (this.aimDir.lengthSq() < 1) this.aimDir.copy(_f); else this.aimDir.normalize();
  }
  _terrainHit(ax, ay, az, dx, dy, dz, L) {
    const T = this.game.terrain;
    if (!T) return -1;
    const ground = (x, z) => Math.max(T.heightAt(x, z), T.waterLevelAt(x, z));
    let prev = 0;
    for (let s = 4; s <= L; s *= 1.18) {
      const x = ax + dx * s, y = ay + dy * s, z = az + dz * s;
      if (y < ground(x, z)) {
        // 이분법으로 다듬기
        let lo = prev, hi = s;
        for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (ay + dy * m < ground(ax + dx * m, az + dz * m)) hi = m; else lo = m; }
        return hi;
      }
      prev = s;
    }
    return -1;
  }

  // 베기 판정: 칼이 지나가는 부채꼴 안의 건물 → 그 높이에서 잘림 (잘린 윗부분이 베는 방향으로 미끄러짐)
  _slashHit(A) {
    const P = this.player, C = this.game.city, W = this.game.wreck;
    const d = A.def, fx = this.game.fx, H = this.game.hooks;
    _q2.setFromAxisAngle(Y, P.heading);
    // 휘두를 때마다 칼끝에서 터지는 검풍
    _v.set(Math.sin(P.heading), 0, Math.cos(P.heading));
    _c.copy(P.pos).addScaledVector(_v, 2.2); _c.y += 0.4;
    if (fx.energyBurst) fx.energyBurst(_c, d.spin || d.dash ? 1.4 : 0.9, 1.1, 1.5, 2.4, !!(d.spin || d.dash));
    if (d.slam) return this._slam();
    if (d.dash) this._dashCut();
    let hitAny = false, maxHit = d.spin ? 4 : 1;
    const seen = new Set();
    const N = d.spin ? 24 : 8;
    for (let k = 0; k <= N && hitAny < maxHit; k++) {
      const s = k / N;
      // 회전 베기는 몸이 한 바퀴 돌며 주위 360° 를 벰
      if (d.spin) dirAzEl(d.a0[0] + 360 * s, 4, _a).applyQuaternion(_q2);
      else dirAzEl(lerp(d.a0[0], d.a1[0], s), lerp(d.a0[1], d.a1[1], s), _a).applyQuaternion(_q2);
      for (const r of d.spin ? [1.6, 2.8, 4.0, 5.2] : [1.6, 2.6, 3.6, 4.6]) {
        const x = P.pos.x + origin.x + _a.x * r, y = P.pos.y + origin.y + 0.4 + _a.y * r, z = P.pos.z + origin.z + _a.z * r;
        const id = C ? C.roofId(x, z) : -1;
        if (id < 0 || seen.has(id) || y > C.by[id] + C.bh[id] || y < C.by[id]) continue;
        seen.add(id);
        hitAny++;
        // 휘두르는 방향 (접선)
        if (d.spin) _b.set(_a.z, 0, -_a.x).normalize();
        else dirAzEl(lerp(d.a0[0], d.a1[0], s + 0.05), lerp(d.a0[1], d.a1[1], s + 0.05), _b).applyQuaternion(_q2).sub(_a).normalize();
        if (W && C.bh[id] > 14 && C.isDynamicable(id)) {
          _c.copy(_b).setY(0).multiplyScalar(5).addScaledVector(_v.set(Math.sin(P.heading), 0, Math.cos(P.heading)), 3);
          _d.set(0, (d.a1[0] - d.a0[0]) > 0 ? 0.25 : -0.25, 0).add(_e.set(_b.z, 0, -_b.x).multiplyScalar(0.12));
          W.cut(id, y, _c, _d);
        } else if (W) W.blast(id, x, y, z, _a.x, _a.y, _a.z, 1);
        _v.set(x - origin.x, y - origin.y, z - origin.z);
        // 콘크리트를 가르는 불꽃 + 칼날 방향으로 뿜어지는 섬광
        if (fx.sparks) { fx.sparks(_v, _e.copy(_b).negate(), 90, 0.8, 34, 2.4, 1.7, 0.9, 0.07); fx.sparks(_v, _b, 50, 0.35, 55, 1.4, 1.8, 2.6, 0.05); }
        if (fx.energyBurst) fx.energyBurst(_v, 2.2, 1.0, 1.4, 2.4, true);
        if (fx.dustCloud && Math.random() < 0.6) fx.dustCloud(x, y - 2, z, 6, 8);
        this.game.audio.play('clang', 1);
        H.shake(0.5); H.flash(0.15); H.shockwave && H.shockwave(_v, 0.25);
        this.game.hitStop(0.09, 0.04);
        this.hits++;
        break;
      }
    }
  }
  // 내려찍기: 땅에 닿는 순간 충격파 → 주변 건물이 바깥으로 쓰러지거나 부서짐
  _slam() {
    const P = this.player, C = this.game.city, W = this.game.wreck, fx = this.game.fx, H = this.game.hooks;
    P.vel.y = Math.min(P.vel.y, -30);
    this.slamPending = 0.6;
  }
  _slamLand() {
    const P = this.player, C = this.game.city, W = this.game.wreck, fx = this.game.fx, H = this.game.hooks;
    const ax = P.pos.x + origin.x, az = P.pos.z + origin.z;
    const T = this.game.terrain, gy = T ? T.heightAt(ax, az) : P.pos.y + origin.y - 1;
    _v.set(P.pos.x, gy - origin.y + 0.3, P.pos.z);
    if (fx.impact) fx.impact(_v, 3e6, _e.set(0, 1, 0));
    if (fx.energyBurst) fx.energyBurst(_v, 3.5, 1.0, 1.4, 2.6, true);
    if (fx.dustCloud) fx.dustCloud(ax, gy, az, 18, 6);
    H.shake(1); H.flash(0.35); H.fovKick(9); H.shockwave && H.shockwave(_v, 0.6);
    this.game.audio.play('clang', 1);
    this.game.hitStop(0.12, 0.03);
    if (!C || !W) return;
    // 16 m 안 건물: 가까우면 부서짐, 멀면 바깥쪽으로 쓰러짐
    const seen = new Set();
    for (let r = 4; r <= 16; r += 3) for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, x = ax + Math.sin(a) * r, z = az + Math.cos(a) * r;
      const id = C.roofId(x, z);
      if (id < 0 || seen.has(id)) continue;
      seen.add(id);
      if (r < 9 || !C.isDynamicable(id) || C.bh[id] < 10) W.blast(id, x, gy + 1.5, z, Math.sin(a), 0.3, Math.cos(a), 1.5);
      else W.topple(id, Math.sin(a), Math.cos(a), 1.2);
    }
  }
  // 돌진 베기: 지나간 길 위의 건물 (최대 3채) 을 벰
  _dashCut() {
    const P = this.player, C = this.game.city, W = this.game.wreck, fx = this.game.fx;
    if (!C || !W || !this.dashFrom) return;
    const a = this.dashFrom;
    _v.set(Math.sin(P.heading), 0, Math.cos(P.heading));
    if (P.mode === 'fly') _v.copy(this.aimDir);
    const L = P.mode === 'fly' ? 40 : 18;
    let ax = a.x, ay = a.y, az = a.z;
    const hit = this._hit || (this._hit = {});
    for (let n = 0; n < 3 && L > 0; n++) {
      if (!C.segmentHit(ax, ay, az, a.x + _v.x * L, a.y + _v.y * L, a.z + _v.z * L, hit) || hit.id === undefined || hit.id < 0) break;
      const id = hit.id;
      const hx = ax + (a.x + _v.x * L - ax) * hit.t, hy = ay + (a.y + _v.y * L - ay) * hit.t, hz = az + (a.z + _v.z * L - az) * hit.t;
      if (C.bh[id] > 14 && C.isDynamicable(id)) W.cut(id, hy, _c.copy(_v).multiplyScalar(8), _d.set(0, 0.3, 0));
      else W.blast(id, hx, hy, hz, _v.x, _v.y, _v.z, 1.3);
      _e.set(hx - origin.x, hy - origin.y, hz - origin.z);
      if (fx.sparks) fx.sparks(_e, _v, 120, 0.9, 40, 2.4, 1.7, 0.9, 0.08);
      if (fx.energyBurst) fx.energyBurst(_e, 2.4, 1.0, 1.4, 2.4, true);
      this.game.audio.play('clang', 1);
      this.game.hooks.shake(0.6);
      this.game.hitStop(0.1, 0.04);
      ax = hx + _v.x * 0.5; ay = hy + _v.y * 0.5; az = hz + _v.z * 0.5;
    }
  }

  // ───────── 검기 ─────────
  _launchWave() {
    const P = this.player;
    const dir = this.aimDir.clone();
    const side = _v.crossVectors(Y, dir);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0); else side.normalize();
    // 진행 방향에 수직으로 선 초승달 (뒤에서 보면 웃는 입 모양), 진행축 둘레로 비스듬히 (번갈아 좌우) → 건물을 사선으로 벰
    this.waveN = (this.waveN || 0) + 1;
    const tilt = (this.waveN % 2 ? 1 : -1) * 24 * D2R;
    const up = new THREE.Vector3().crossVectors(dir, side).normalize();
    const s2 = side.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(up, Math.sin(tilt)).normalize();
    up.crossVectors(dir, s2).normalize();
    const p = new THREE.Vector3(P.pos.x + origin.x, P.pos.y + origin.y + 0.3, P.pos.z + origin.z).addScaledVector(dir, 2);
    const arc = { mesh: makeArc(this.scene), t: 0, life: 9, kind: 'wave' };
    const core = makeArc(this.scene);
    const w = { p, prev: p.clone(), dir, side: s2, up, R: 16, span: 2.2, bow: 0.35, speed: 280, life: 4.2, t: 0, hit: new Set(), arc, core };
    this.waves.push(w);
    const a0 = -Math.PI / 2 - w.span / 2;
    const u = arc.mesh.material.uniforms;
    u.uColor.value.copy(ENERGY); u.uR0.value = w.R * 0.82; u.uR1.value = w.R; u.uA0.value = a0; u.uSpan.value = w.span; u.uBow.value = w.bow; u.uI.value = 1.6; u.uReveal.value = 1; u.uLead.value = 0;
    const u2 = core.material.uniforms;
    u2.uColor.value.setRGB(3, 3.3, 3.6); u2.uR0.value = w.R * 0.95; u2.uR1.value = w.R * 0.995; u2.uA0.value = a0 + w.span * 0.05; u2.uSpan.value = w.span * 0.9; u2.uBow.value = w.bow; u2.uI.value = 1.4; u2.uReveal.value = 1; u2.uLead.value = 0;
    arc.mesh.visible = true; core.visible = true;
    const fx = this.game.fx;
    _v.set(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    if (fx.energyBurst) fx.energyBurst(_v, 1.5, ENERGY.r, ENERGY.g, ENERGY.b);
    this.game.audio.play('boost', 0.8);
    this.game.hooks.shake(0.4);
    this.game.hooks.fovKick && this.game.hooks.fovKick(6);
  }
  _dropWave(w) { for (const m of [w.arc.mesh, w.core]) { this.scene.remove(m); m.material.dispose(); } }
  _stepWave(w, dt) {
    w.t += dt;
    if (w.t > w.life) return false;
    w.prev.copy(w.p);
    w.p.addScaledVector(w.dir, w.speed * dt);
    const C = this.game.city, Wk = this.game.wreck, fx = this.game.fx, T = this.game.terrain;
    const hit = this._hit2 || (this._hit2 = {});
    // 초승달 위의 점 9개가 이번 스텝에 지나간 선분으로 건물 판정
    for (let j = 0; j <= 8; j++) {
      const th = -w.span / 2 + (w.span * j) / 8;
      const sn = Math.sin(th) * w.R, cs = (1 - Math.cos(th)) * w.R;
      const bx = w.p.x + w.side.x * sn + w.up.x * cs - w.dir.x * cs * w.bow;
      const by = w.p.y + w.side.y * sn + w.up.y * cs - w.dir.y * cs * w.bow;
      const bz = w.p.z + w.side.z * sn + w.up.z * cs - w.dir.z * cs * w.bow;
      const s = w.speed * dt;
      const axp = bx - w.dir.x * s, ayp = by - w.dir.y * s, azp = bz - w.dir.z * s;
      if (!C || !C.segmentHit(axp, ayp, azp, bx, by, bz, hit) || w.hit.has(hit.id)) continue;
      w.hit.add(hit.id);
      if (Wk) {
        if (C.bh[hit.id] > 12 && C.isDynamicable(hit.id)) {
          _c.copy(w.dir).setY(0).normalize().multiplyScalar(7 + Math.random() * 3);
          _d.set(w.side.x, 0, w.side.z).multiplyScalar((Math.random() - 0.5) * 0.3).add(_e.set(w.dir.z, 0, -w.dir.x).multiplyScalar(0.25));
          Wk.cut(hit.id, hit.y, _c, _d);
        } else Wk.blast(hit.id, hit.x, hit.y, hit.z, w.dir.x, w.dir.y, w.dir.z, 1.5);
      }
      _v.set(hit.x - origin.x, hit.y - origin.y, hit.z - origin.z);
      if (fx.sparks) fx.sparks(_v, _e.copy(w.dir), 30, 0.9, 40, ENERGY.r * 1.4, ENERGY.g * 1.2, ENERGY.b, 0.1);
    }
    // 지면에 닿으면 폭발하며 사라짐
    if (T) {
      const g = Math.max(T.heightAt(w.p.x, w.p.z), T.waterLevelAt(w.p.x, w.p.z));
      if (w.p.y < g + 0.5) {
        _v.set(w.p.x - origin.x, g - origin.y, w.p.z - origin.z);
        if (fx.energyBurst) fx.energyBurst(_v, 6, ENERGY.r, ENERGY.g, ENERGY.b, true);
        if (fx.dustCloud) fx.dustCloud(_v.x, _v.y, _v.z, 18, 10);
        this.game.smashAt && this.game.smashAt(w.p.x, g, w.p.z, 22);
        this.game.audio.play('heroLand', 0.8);
        return false;
      }
    }
    return true;
  }

  // ───────── 에너지 빔 ─────────
  _fire() {
    const c = clamp(this.charge / 1.6, 0.15, 1);
    this.charging = false;
    this.beam = { t: 0, dur: 0.6 + 0.9 * c, power: 1 + 3 * c, r: 0.6 + 2.4 * c, tick: 0, boom: 0 };
    this.charge = 0;
    this.game.audio.play('beam', 0.6 + 0.4 * c);
    this.game.hooks.shake(0.4 + 0.4 * c);
    this.game.hooks.fovKick && this.game.hooks.fovKick(10 * c);
    this.game.hitStop(0.05, 0.1);
  }
  _stepBeam(dt) {
    const B = this.beam, P = this.player;
    B.t += dt;
    if (B.t > B.dur) { this.beam = null; this.beamCool = 0.5; return; }
    // 시작: 칼끝 근처 (몸 앞), 끝: 조준선
    const S = this.beamFrom.set(P.pos.x + origin.x, P.pos.y + origin.y + 0.55, P.pos.z + origin.z).addScaledVector(this.aimDir, 1.9);
    const D = this.aimDir, L = 2800;
    let end = L;
    const tl = this._terrainHit(S.x, S.y, S.z, D.x, D.y, D.z, L);
    if (tl >= 0) end = tl;
    this.beamTo.copy(S).addScaledVector(D, end);
    // 반동
    if (P.mode !== 'ground') P.vel.addScaledVector(D, -6 * dt * B.power);
    // 건물: 빔이 지나는 건물 최대 3채를 매 틱 뚫음
    B.tick -= dt;
    const C = this.game.city, Wk = this.game.wreck, fx = this.game.fx;
    if (B.tick <= 0) {
      B.tick = 0.05;
      const hit = this._hit2 || (this._hit2 = {});
      let ox = S.x, oy = S.y, oz = S.z;
      for (let k = 0; k < 3 && C; k++) {
        const rem = end - Math.hypot(ox - S.x, oy - S.y, oz - S.z);
        if (rem < 2 || !C.segmentHit(ox, oy, oz, ox + D.x * rem, oy + D.y * rem, oz + D.z * rem, hit)) break;
        if (Wk) Wk.blast(hit.id, hit.x, hit.y, hit.z, D.x, D.y, D.z, B.power);
        _v.set(hit.x - origin.x, hit.y - origin.y, hit.z - origin.z);
        if (fx.energyBurst) fx.energyBurst(_v, 2 + B.r, ENERGY.r, ENERGY.g, ENERGY.b, false);
        if (fx.sparks) fx.sparks(_v, _e.copy(D).negate(), 40, 1.0, 35, 2.2, 1.8, 1.4, 0.09);
        ox = hit.x + D.x * 2; oy = hit.y + D.y * 2; oz = hit.z + D.z * 2;
      }
    }
    // 끝점 폭발 (주기적으로)
    B.boom -= dt;
    if (tl >= 0 && B.boom <= 0) {
      B.boom = 0.18;
      B.nb = (B.nb || 0) + 1;
      const E = this.beamTo;
      _v.set(E.x - origin.x, E.y - origin.y, E.z - origin.z);
      if (fx.energyBurst) fx.energyBurst(_v, 2 + B.r * 1.5, ENERGY.r, ENERGY.g, ENERGY.b, B.nb === 1);
      if (fx.dustCloud && B.nb % 3 === 1) fx.dustCloud(_v.x, _v.y, _v.z, 6 + B.r * 3, 8);
      this.game.smashAt && this.game.smashAt(E.x, E.y, E.z, 8 + B.r * 5);
      const T = this.game.terrain;
      if (T && T.waterLevelAt(E.x, E.z) > T.heightAt(E.x, E.z) && fx.splash) fx.splash(_v.x, _v.y, _v.z, 1.5);
    }
  }

  // ───────── 자세 (고정 스텝, 애니메이터 다음) ─────────
  pose(av) {
    const w = this.w;
    if (w < 0.002) { this.twist = 0; return; }
    const P = this.player;
    let az = 0;
    if (this.charging || this.beam) {
      // 몸 좌표로 조준 방향
      _q.copy(av.body.quaternion).invert();
      if (this.charging) {
        // 칼을 하늘로 치켜들기 (날 = 위)
        _d.set(0, 1, 0).applyQuaternion(_q);
        _e.set(0.15, 0, 1).normalize();
        _a.copy(_d).multiplyScalar(0.6).addScaledVector(_e, 0.8).normalize();
        _b.copy(_d).multiplyScalar(0.8).addScaledVector(_e, -0.6).normalize();
      } else {
        // 날이 조준 방향을 정확히 가리키게: a = 0.6·조준 + 0.8·u, b = 0.8·조준 - 0.6·u
        _d.copy(this.aimDir).applyQuaternion(_q);
        _e.set(0, 1, 0).applyQuaternion(_q).addScaledVector(_d, -_d.dot(_e.set(0, 1, 0).applyQuaternion(_q)));
        if (_e.lengthSq() < 1e-6) _e.set(0, 0, 1); _e.normalize();
        _a.copy(_d).multiplyScalar(0.6).addScaledVector(_e, 0.8).normalize();
        _b.copy(_d).multiplyScalar(0.8).addScaledVector(_e, -0.6).normalize();
        az = Math.atan2(_d.x, _d.z) / D2R * 0.3;
      }
    } else if (this.atk) {
      const A = this.atk, d = A.def;
      const p = A.t < d.tw ? 0 : easeOut(clamp((A.t - d.tw) / d.sw, 0, 1));
      const s0 = clamp(p - 0.04, 0, 1), s1 = clamp(p + 0.04, 0, 1);
      dirAzEl(lerp(d.a0[0], d.a1[0], p), lerp(d.a0[1], d.a1[1], p), _a);
      dirAzEl(lerp(d.a0[0], d.a1[0], s1), lerp(d.a0[1], d.a1[1], s1), _b).sub(dirAzEl(lerp(d.a0[0], d.a1[0], s0), lerp(d.a0[1], d.a1[1], s0), _c));
      _b.addScaledVector(_a, -_b.dot(_a));
      if (_b.lengthSq() < 1e-8) _b.set(0, 1, 0).addScaledVector(_a, -_a.y);
      _b.normalize();
      az = lerp(d.a0[0], d.a1[0], p);
      // 회전 베기: 팔은 옆으로 뻗은 채 몸이 한 바퀴
      if (d.spin) { this.spinA = A.t < d.tw ? 0 : easeInOut(clamp((A.t - d.tw) / d.sw, 0, 1)) * Math.PI * 2; az = 0; }
    } else return;
    armQuat(_a, _b, this.armQ);
    av.shoulderR.quaternion.slerp(this.armQ, w);
    // 상체 비틀기 (팔을 따라)
    const tw = clamp(az * 0.35, -45, 45) * D2R * w;
    this.twist = tw;
    av.body.quaternion.multiply(_q.setFromAxisAngle(Y, tw + (this.atk && this.atk.def.spin ? this.spinA * w : 0)));
    // 왼팔은 균형 잡듯 반대로
    av.shoulderL.quaternion.slerp(_q2.setFromEuler(_euler.set(-0.6 * w, 0, -0.25 * w)), 0.5 * w);
  }

  // ───────── 렌더 프레임: 궤적·검광·빔·기 모으기 ─────────
  render(dt, camera) {
    const S = this.sword;
    const P = this.player;
    S.tip.getWorldPosition(this._tipW);
    S.base.getWorldPosition(this._baseW);
    const swinging = this.atk && this.atk.t >= this.atk.def.tw - 0.01;
    if (swinging) {
      this.trail.push(this._baseW, this._tipW, this.time);
      S.tip2.getWorldPosition(_c); S.base2.getWorldPosition(_d);
      this.trail2.push(_d, _c, this.time);
    }
    const tE = this.atk && (this.atk.kind === 'wave' || this.atk.def.spin || this.atk.def.dash || this.atk.def.slam) ? 1 : this.energy;
    this.trail.update(this.time, 0.16, tE);
    this.trail2.update(this.time, 0.22, tE);
    // 룬: 기가 오를수록 밝게 맥동
    if (S.runeMat) { S.runeMat.uniforms.uI.value = 0.35 + this.energy * 2.2 + (swinging ? 0.6 : 0); S.runeMat.uniforms.uTime.value = this.time; }
    // 날 빛
    const e = this.energy;
    S.glow.visible = e > 0.03;
    S.glowMat.uniforms.uI.value = e * 1.6;
    S.glowMat.uniforms.uTime.value = this.time;
    S.blade.material.emissive.setRGB(ENERGY.r * 0.25 * e, ENERGY.g * 0.25 * e, ENERGY.b * 0.25 * e);
    // 베기 초승달 잔상
    for (const a of this.arcs) {
      if (a.t > a.life) { a.mesh.visible = false; continue; }
      a.t += dt;
      const d = a.def;
      const u = a.mesh.material.uniforms;
      const p = clamp(a.t / d.sw, 0, 1);
      u.uReveal.value = easeOut(p);
      u.uI.value = (a.kind === 'wave' ? 1.6 : 1.0) * (1 - smooth(d.sw, a.life, a.t));
      u.uTime.value = this.time;
      a.mesh.visible = a.t > 0;
      if (a.follow) { _q2.setFromAxisAngle(Y, P.heading); _v.set(-0.45, 0.42, 0.1).applyQuaternion(_q2); a.mesh.position.copy(P.renderPos).add(_v); }
    }
    // 날아가는 검기
    for (const w of this.waves) {
      _c.set(w.p.x - origin.x + w.up.x * w.R, w.p.y - origin.y + w.up.y * w.R, w.p.z - origin.z + w.up.z * w.R);
      _q.setFromRotationMatrix(_m.makeBasis(w.side, w.up, w.dir));
      const fade = 1 - smooth(w.life - 0.6, w.life, w.t);
      for (const [M, I] of [[w.arc.mesh, 3.0], [w.core, 2.2]]) {
        M.position.copy(_c); M.quaternion.copy(_q);
        const u = M.material.uniforms; u.uI.value = I * fade; u.uTime.value = this.time;
      }
      // 칼날 가장자리에서 흩날리는 불꽃
      if (this.game.fx.sparks && Math.random() < 0.7) {
        const th = (Math.random() - 0.5) * w.span;
        _e.set(w.p.x - origin.x, w.p.y - origin.y, w.p.z - origin.z).addScaledVector(w.side, Math.sin(th) * w.R).addScaledVector(w.up, (1 - Math.cos(th)) * w.R);
        this.game.fx.sparks(_e, _f.copy(w.dir).negate(), 3, 0.5, 30, ENERGY.r * 1.3, ENERGY.g * 1.2, ENERGY.b, 0.12);
      }
    }
    // 빔
    const BM = this.beamMesh, B = this.beam;
    if (B) {
      const a = this.beamFrom, b = this.beamTo;
      _a.set(a.x - origin.x, a.y - origin.y, a.z - origin.z);
      _b.set(b.x - origin.x, b.y - origin.y, b.z - origin.z);
      const L = _a.distanceTo(_b);
      _d.subVectors(_b, _a).normalize();
      _q.setFromUnitVectors(Y, _d);
      const fade = smooth(0, 0.06, B.t) * (1 - smooth(B.dur - 0.25, B.dur, B.t));
      const jitter = 1 + 0.08 * Math.sin(this.time * 70);
      for (const [m, r, I] of [[BM.core, B.r * 0.2, 1.1], [BM.glow, B.r * 0.75, 0.4]]) {
        m.visible = true;
        m.position.copy(_a); m.quaternion.copy(_q); m.scale.set(r * jitter, L, r * jitter);
        const u = m.material.uniforms; u.uI.value = I * fade; u.uTime.value = this.time; u.uLen.value = L;
      }
      // 칼끝 섬광
      this._fx -= dt;
      if (this._fx <= 0 && this.game.fx.sparks) { this._fx = 0.05; this.game.fx.sparks(_a, _d, 6, 0.5, 25, ENERGY.r * 1.5, ENERGY.g * 1.3, ENERGY.b, 0.06); }
    } else { BM.core.visible = false; BM.glow.visible = false; }
    // 기 모으기: 빛 알갱이가 칼로 빨려 들어옴
    if (this.charging && this.game.fx.sparks) {
      this._fx -= dt;
      if (this._fx <= 0) {
        this._fx = 0.03;
        const fx = this.game.fx, k = this.charge / 1.6;
        for (let i = 0; i < 3; i++) {
          _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
          const r = 2.5 + Math.random() * 2;
          _c.copy(this._tipW).addScaledVector(_v, r);
          fx.sparks(_c, _e.copy(_v).negate(), 1, 0.05, r * 4.5, ENERGY.r * (1 + k), ENERGY.g * (1 + k), ENERGY.b * (1 + k), 0.05 + 0.05 * k);
        }
      }
    }
  }

  reset() {
    this.atk = null; this.beam = null; this.charging = false;
    for (const w of this.waves) this._dropWave(w);
    this.waves.length = 0;
    this.trail.clear(); this.trail2.clear();
    this.slamPending = 0;
  }
}
const _euler = new THREE.Euler(0, 0, 0, 'XZY');
