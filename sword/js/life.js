// SKY BLADE — 살아 있는 세상: 사람, 자동차, 여객기 (비행운), 배, 새
//  - 사람·차는 카메라 주변 도시 도로망 위에서만 생김 (멀어지면 다른 곳에 다시 생김)
//      도로 = terrain.js roadAt 의 비틀린 격자: q(x,z) = p + 비틀림, 간선 512 m 간격 (반폭 17 m), 이면도로 128 m (반폭 6.5 m)
//      → 차는 'q 의 한 성분 = 상수' 인 선을 따라 우측 통행, 교차로에서 가끔 회전. 사람은 그 옆 보도를 걸음
//  - 폭발·충격파 (blast / shock) 를 맞으면 날아가 구르고 쓰러짐, 가까운 사람은 도망침
//  - 여객기: 고도 9~11 km 를 250 m/s 로 지나가며 비행운을 남김 (부딪히면 폭발해 추락)
//  - 배: 강·바다 위를 떠다니며 물살을 남김. 새: 무리 지어 맴돌다 가까이 가면 흩어짐
//  모든 좌표는 절대 좌표, 그릴 때만 origin 을 뺌
import * as THREE from 'three';
import { origin } from './frame.js';

const TP = 6.283185307179586 / 65536;
const G = 9.81;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fa = (v, p) => Math.abs((((v / p + 0.5) % 1) + 1) % 1 - 0.5) * p;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _e = new THREE.Euler(), Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

// 도로 좌표 q 와 그 기울기 (terrain.js roadAt 과 같은 식)
const Q = { qx: 0, qz: 0, xx: 0, xz: 0, zx: 0, zz: 0 };
function roadQ(x, z) {
  const px = ((x % 65536) + 65536) % 65536, pz = ((z % 65536) + 65536) % 65536;
  const A = TP * (3 * pz + px), B = TP * (7 * px - 5 * pz) + 1.3, C = TP * (2 * px - 3 * pz) + 0.7, D = TP * (4 * px + 9 * pz) + 2.1;
  Q.qx = px + 260 * Math.sin(A) + 120 * Math.sin(B);
  Q.qz = pz + 260 * Math.sin(C) + 120 * Math.sin(D);
  const cA = 260 * TP * Math.cos(A), cB = 120 * TP * Math.cos(B), cC = 260 * TP * Math.cos(C), cD = 120 * TP * Math.cos(D);
  Q.xx = 1 + cA + 7 * cB; Q.xz = 3 * cA - 5 * cB;      // ∂qx/∂x, ∂qx/∂z
  Q.zx = 2 * cC + 4 * cD; Q.zz = 1 - 3 * cC + 9 * cD;  // ∂qz/∂x, ∂qz/∂z
  return Q;
}

// 상자 여러 개 → 한 지오메트리 (part 속성, 정점 색)
export function boxes(list) {
  const geos = [];
  for (const b of list) {
    const g = new THREE.BoxGeometry(b[0], b[1], b[2]);
    g.translate(b[3], b[4], b[5]);
    const n = g.attributes.position.count;
    const part = new Float32Array(n).fill(b[6] || 0), col = new Float32Array(n * 3);
    const c = new THREE.Color(b[7] !== undefined ? b[7] : 0xffffff);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  }
  return merge(geos);
}
function merge(geos) {
  let n = 0, ni = 0;
  for (const g of geos) { n += g.attributes.position.count; ni += g.index.count; }
  const out = new THREE.BufferGeometry();
  const names = Object.keys(geos[0].attributes);
  for (const k of names) {
    const sz = geos[0].attributes[k].itemSize, arr = new Float32Array(n * sz);
    let o = 0;
    for (const g of geos) { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, sz));
  }
  const idx = new Uint32Array(ni);
  let o = 0, base = 0;
  for (const g of geos) { for (let i = 0; i < g.index.count; i++) idx[o++] = g.index.array[i] + base; base += g.attributes.position.count; }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// ───────── 사람 (팔다리는 정점 셰이더에서 걷기 애니메이션) ─────────
//  part: 0 몸통, 1 머리, 2/3 왼·오른 다리, 4/5 왼·오른 팔, 6 머리카락
function personGeo() {
  return boxes([
    [0.36, 0.56, 0.22, 0, 1.1, 0, 0],
    [0.2, 0.23, 0.21, 0, 1.53, 0.01, 1],
    [0.21, 0.08, 0.22, 0, 1.66, -0.005, 6],
    [0.14, 0.82, 0.16, -0.095, 0.41, 0, 2],
    [0.14, 0.82, 0.16, 0.095, 0.41, 0, 3],
    [0.1, 0.62, 0.12, -0.24, 1.07, 0, 4],
    [0.1, 0.62, 0.12, 0.24, 1.07, 0, 5],
  ]);
}
const PERSON_COMMON = /* glsl */`
attribute float aPart;
attribute vec4 iAnim;     // 걸음 위상, 흔들림 크기, 팔 들기 (도망), 피부·머리 시드
attribute vec3 iShirt;
attribute vec3 iPants;
varying vec3 vPC;
float limbAng(out float piv) {
  float ph = iAnim.x, amp = iAnim.y, up = iAnim.z;
  piv = 0.0;
  if (aPart > 1.5 && aPart < 2.5) { piv = 0.82; return sin(ph) * amp; }
  if (aPart > 2.5 && aPart < 3.5) { piv = 0.82; return -sin(ph) * amp; }
  if (aPart > 3.5 && aPart < 4.5) { piv = 1.38; return mix(-sin(ph) * amp * 0.8, -2.7 + 0.35 * sin(ph * 2.0), up); }
  if (aPart > 4.5 && aPart < 5.5) { piv = 1.38; return mix(sin(ph) * amp * 0.8, -2.7 + 0.35 * cos(ph * 2.0), up); }
  return 0.0;
}
vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
`;
function personMat() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + PERSON_COMMON)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n{ float pv; objectNormal = rotX(objectNormal, limbAng(pv)); }')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{ float pv; float a = limbAng(pv); transformed.y -= pv; transformed = rotX(transformed, a); transformed.y += pv; }
float sk = fract(iAnim.w * 7.31);
vec3 skin = mix(vec3(0.8, 0.56, 0.42), vec3(0.42, 0.26, 0.17), sk * sk);
vec3 hair = mix(vec3(0.03, 0.025, 0.02), vec3(0.35, 0.22, 0.1), step(0.8, fract(iAnim.w * 13.7)));
vPC = aPart < 0.5 ? iShirt : aPart < 1.5 ? skin : aPart < 3.5 ? iPants : aPart < 5.5 ? iShirt : hair;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPC;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vPC;');
  };
  return m;
}

// ───────── 자동차 ─────────
function carGeo() {
  const g = boxes([
    [1.8, 0.75, 4.4, 0, 0.62, 0, 0, 0xffffff],          // 차체 (인스턴스 색)
    [1.62, 0.62, 2.3, 0, 1.3, -0.25, 0, 0x2a3138],     // 유리 지붕
    [1.66, 0.08, 2.2, 0, 1.64, -0.25, 0, 0xffffff],     // 지붕
    [0.3, 0.6, 0.6, -0.82, 0.3, 1.35, 0, 0x111111], [0.3, 0.6, 0.6, 0.82, 0.3, 1.35, 0, 0x111111],
    [0.3, 0.6, 0.6, -0.82, 0.3, -1.35, 0, 0x111111], [0.3, 0.6, 0.6, 0.82, 0.3, -1.35, 0, 0x111111],
    [1.4, 0.14, 0.05, 0, 0.75, 2.21, 0, 0xfff4d0],      // 전조등
    [1.5, 0.12, 0.05, 0, 0.8, -2.21, 0, 0xc01010],      // 후미등
  ]);
  return g;
}
const CAR_COLORS = [0xf2f2f2, 0xf2f2f2, 0x1a1a1a, 0x9aa0a6, 0x9aa0a6, 0x2b4a7a, 0x8a1c1c, 0xd8c8a0, 0x30503a, 0xe0b000];

// ───────── 여객기 ─────────
function makePlane() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, metalness: 0.3, roughness: 0.45 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.5, roughness: 0.4 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x1d4a8f, metalness: 0.2, roughness: 0.5 });
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 32, 16), white); fus.rotation.x = Math.PI / 2; g.add(fus);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), white); nose.rotation.x = Math.PI / 2; nose.scale.set(1, 1.6, 1); nose.position.z = 16; g.add(nose);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(2, 7, 16), white); tail.rotation.x = -Math.PI / 2; tail.position.set(0, 0.5, -19.5); g.add(tail);
  const wingShape = new THREE.Shape(); wingShape.moveTo(0, 3); wingShape.lineTo(17.5, -5); wingShape.lineTo(17.5, -7); wingShape.lineTo(0, -3); wingShape.closePath();
  const wg = new THREE.ExtrudeGeometry(wingShape, { depth: 0.4, bevelEnabled: false }); wg.rotateX(Math.PI / 2);
  const wR = new THREE.Mesh(wg, grey); wR.position.set(1.5, -0.8, 0); g.add(wR);
  const wL = new THREE.Mesh(wg, grey); wL.scale.x = -1; wL.position.set(-1.5, -0.8, 0); g.add(wL);
  const st = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 2.6), grey); st.position.set(0, 0.8, -19); g.add(st);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6.5, 4.5), blue); fin.position.set(0, 4.5, -19); fin.rotation.x = -0.35; g.add(fin);
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.0, 4.2, 12), grey); e.rotation.x = Math.PI / 2; e.position.set(s * 6, -2.2, 2.5); g.add(e); }
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(2.02, 2.02, 30, 16, 1, true, Math.PI * 0.35, Math.PI * 0.3), blue); stripe.rotation.x = Math.PI / 2; g.add(stripe);
  // 깜빡이는 충돌 방지등
  const lm = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.3, 0.2) });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), lm); beacon.position.set(0, 2.2, 0); g.add(beacon);
  g.userData.beacon = beacon;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// 비행운: 카메라를 향하는 띠 (점마다 나이에 따라 넓어지고 옅어짐)
class Contrail {
  constructor(scene, N = 140) {
    this.N = N; this.pts = []; // {x,y,z,t}
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 2 * 3); this.al = new Float32Array(N * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(vec3(1.0, 1.0, 1.02) * 1.15, vA); }',
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -40;
    scene.add(this.mesh);
  }
  push(x, y, z, t) { this.pts.push({ x, y, z, t }); if (this.pts.length > this.N) this.pts.shift(); }
  clear() { this.pts.length = 0; }
  update(time, cam) {
    const P = this.pts, n = P.length;
    this.mesh.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
    if (n < 2) return;
    const cx = cam.x, cy = cam.y, cz = cam.z;
    for (let i = 0; i < n; i++) {
      const p = P[i], q = P[Math.min(n - 1, i + 1)], r = P[Math.max(0, i - 1)];
      const tx = q.x - r.x, ty = q.y - r.y, tz = q.z - r.z;
      const vx = p.x - origin.x - cx, vy = p.y - origin.y - cy, vz = p.z - origin.z - cz;
      let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const age = time - p.t, w = 3 + age * 1.6;
      sx *= w / sl; sy *= w / sl; sz *= w / sl;
      const o = i * 6;
      this.pos[o] = p.x - origin.x + sx; this.pos[o + 1] = p.y - origin.y + sy; this.pos[o + 2] = p.z - origin.z + sz;
      this.pos[o + 3] = p.x - origin.x - sx; this.pos[o + 4] = p.y - origin.y - sy; this.pos[o + 5] = p.z - origin.z - sz;
      const a = 0.55 * Math.min(1, age * 2) * Math.max(0, 1 - age / 70) * Math.min(1, (n - 1 - i) / 3 + 0.2);
      this.al[i * 2] = this.al[i * 2 + 1] = a;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aA.needsUpdate = true;
  }
}

// ───────── 배 ─────────
function boatGeo() {
  return boxes([
    [3.2, 1.4, 11, 0, 0.3, 0, 0, 0xffffff],
    [2.0, 1.0, 1.0, 0, 0.3, 6.0, 0, 0xffffff],
    [2.4, 1.6, 3.6, 0, 1.8, -1.0, 0, 0xe8e8e8],
    [2.2, 0.5, 3.2, 0, 2.2, -1.0, 0, 0x203040],
  ]);
}

// ───────── 새 (날갯짓은 정점 셰이더) ─────────
function birdGeo() {
  const g = new THREE.BufferGeometry();
  // 몸 + 두 날개 (얇은 삼각형)
  const p = [0, 0, 0.25, -0.06, 0, -0.2, 0.06, 0, -0.2, 0, 0, 0.05, -0.55, 0.02, -0.08, 0, 0, -0.12, 0, 0, 0.05, 0, 0, -0.12, 0.55, 0.02, -0.08];
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
  g.computeVertexNormals();
  return g;
}

export class Life {
  /** game: { terrain, city, fx, audio, hooks, water }, opts.eco */
  constructor(scene, game, opts = {}) {
    this.scene = scene; this.game = game;
    this.time = 0;
    this.setEco(!!opts.eco, true);
    // 사람
    const NP = 320;
    this.people = [];
    const pg = personGeo();
    this.pAnim = new THREE.InstancedBufferAttribute(new Float32Array(NP * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.pShirt = new THREE.InstancedBufferAttribute(new Float32Array(NP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.pPants = new THREE.InstancedBufferAttribute(new Float32Array(NP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('iAnim', this.pAnim); pg.setAttribute('iShirt', this.pShirt); pg.setAttribute('iPants', this.pPants);
    this.pMesh = new THREE.InstancedMesh(pg, personMat(), NP);
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pMesh.castShadow = true; this.pMesh.frustumCulled = false; this.pMesh.count = 0;
    scene.add(this.pMesh);
    const SH = [0xf5f5f5, 0x202020, 0x2d4e8a, 0x8a2d2d, 0x3f6e46, 0xd9c49a, 0x6b6b6b, 0xe6a23a, 0x5a3f7a, 0x9ec7e8];
    const PA = [0x1d2333, 0x2a2a2a, 0x3b4b63, 0x6b5a45, 0xbcb5a5, 0x161616];
    for (let i = 0; i < NP; i++) {
      const c = new THREE.Color(SH[(Math.random() * SH.length) | 0]).multiplyScalar(rnd(0.8, 1.1));
      const d = new THREE.Color(PA[(Math.random() * PA.length) | 0]);
      this.people.push({ alive: false, i, shirt: c, pants: d, x: 0, y: 0, z: 0, h: 0, sp: 0, ph: Math.random() * 6, seed: Math.random(), st: 'walk', axis: 0, L: 512, tgt: 0, dir: 1, side: 1, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, wx: 0, wz: 0, t: 0, gx: 1e9, gz: 0, gy: 0, chk: 0, shock: -1 });
    }
    // 자동차
    const NC = 110;
    this.cars = [];
    this.cMesh = new THREE.InstancedMesh(carGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.32 }), NC);
    this.cMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cMesh.castShadow = true; this.cMesh.frustumCulled = false; this.cMesh.count = 0;
    for (let i = 0; i < NC; i++) {
      if (i === 0) this.cMesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.cars.push({ alive: false, i, col: new THREE.Color(CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0]), x: 0, y: 0, z: 0, h: 0, sp: 0, vmax: rnd(9, 17), st: 'drive', axis: 0, L: 512, tgt: 0, dir: 1, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, wx: 0, wz: 0, t: 0, gx: 1e9, gz: 0, gy: 0, chk: 0, shock: -1 });
    }
    scene.add(this.cMesh);
    // 여객기
    this.planes = [];
    for (let i = 0; i < 4; i++) {
      const mesh = makePlane(); mesh.visible = false; scene.add(mesh);
      this.planes.push({ mesh, trail: new Contrail(scene), alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), st: 'fly', t: 0, lastPt: 0, roll: 0, rv: 0 });
    }
    // 배
    const NB = 10;
    this.boats = [];
    this.bMesh = new THREE.InstancedMesh(boatGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 }), NB);
    this.bMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.bMesh.castShadow = true; this.bMesh.frustumCulled = false; this.bMesh.count = 0;
    for (let i = 0; i < NB; i++) { this.bMesh.setColorAt(i, new THREE.Color([0xffffff, 0xd8302a, 0x1f4f8a, 0xf0c020][i % 4])); this.boats.push({ alive: false, i, x: 0, z: 0, y: 0, h: 0, sp: rnd(5, 11), t: 0, chk: 0, wake: 0 }); }
    scene.add(this.bMesh);
    // 새
    const NBd = 60;
    this.birds = [];
    this.flocks = [];
    const bg = birdGeo();
    this.bdPh = new THREE.InstancedBufferAttribute(new Float32Array(NBd), 1).setUsage(THREE.DynamicDrawUsage);
    bg.setAttribute('iPh', this.bdPh);
    const bm = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.9, side: THREE.DoubleSide });
    this.bUni = { uTime: { value: 0 } };
    bm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.bUni.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float iPh; uniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += sin(uTime * 13.0 + iPh) * abs(transformed.x) * 0.9;');
    };
    this.bdMesh = new THREE.InstancedMesh(bg, bm, NBd);
    this.bdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.bdMesh.frustumCulled = false; this.bdMesh.count = 0;
    scene.add(this.bdMesh);
    for (let f = 0; f < 3; f++) this.flocks.push({ alive: false, x: 0, y: 0, z: 0, scat: 0, n: 20 });
    for (let i = 0; i < NBd; i++) this.birds.push({ f: (i / 20) | 0, r: rnd(6, 22), a: Math.random() * 6.28, w: rnd(0.35, 0.7) * (Math.random() < 0.5 ? -1 : 1), dy: rnd(-5, 5), sx: 0, sy: 0, sz: 0, ph: Math.random() * 6 });
    this.shockN = 0;
  }

  setEco(eco, init) {
    this.eco = eco;
    this.R = eco ? 260 : 420;
    // 실제 도로망이 있으면 사람·차는 town.js 가 맡음
    this.maxP = this.town ? 0 : eco ? 110 : 320;
    this.maxC = this.town ? 0 : eco ? 40 : 110;
    if (this.town) this.town.setEco(eco, this.lowHeat ? 0.5 : 1);
  }
  setTown(t) { this.town = t; this.setEco(this.eco); }

  _hAt(x, z) { const T = this.game.terrain; return T ? T.heightAt(x, z) : 0; }
  _water(x, z) { const T = this.game.terrain; return T && T.waterLevelAt(x, z) > T.heightAt(x, z) + 0.3; }
  _roof(x, z) { const C = this.game.city; return C ? C.roofAt(x, z) : -Infinity; }
  _road(x, z) { const T = this.game.terrain; return T && T.roadAt ? T.roadAt(x, z) : 0; }

  // 도로선 (축, 간격, 목표값) 위로 끌어당김: q_axis = tgt
  _snap(o, tgt) {
    for (let k = 0; k < 3; k++) {
      roadQ(o.x, o.z);
      const q = o.axis === 0 ? Q.qx : Q.qz, gx = o.axis === 0 ? Q.xx : Q.zx, gz = o.axis === 0 ? Q.xz : Q.zz;
      const gg = gx * gx + gz * gz;
      let e = q - tgt;
      e -= Math.round(e / 65536) * 65536;
      o.x -= e * gx / gg; o.z -= e * gz / gg;
    }
  }

  // 도로망 위 무작위 지점 (카메라 주변 고리)
  _spawnRoad(o, cam, rMin, rMax, sidewalk) {
    for (let tries = 0; tries < 3; tries++) {
      const a = Math.random() * Math.PI * 2, r = rnd(rMin, rMax);
      o.x = cam.x + Math.sin(a) * r; o.z = cam.z + Math.cos(a) * r;
      o.axis = Math.random() < 0.5 ? 0 : 1;
      o.L = Math.random() < 0.55 ? 512 : 128;
      roadQ(o.x, o.z);
      const q = o.axis === 0 ? Q.qx : Q.qz;
      o.tgt = Math.round(q / o.L) * o.L;
      o.dir = Math.random() < 0.5 ? 1 : -1;
      o.side = Math.random() < 0.5 ? 1 : -1;
      this._snap(o, o.tgt);
      if (this._road(o.x, o.z) !== 1) continue;
      const hw = o.L === 512 ? 17 : 6.5;
      if (sidewalk) { this._snap(o, o.tgt + o.side * (hw + rnd(1.2, 2.6))); if (this._roof(o.x, o.z) > this._hAt(o.x, o.z) + 1) continue; }
      if (this._water(o.x, o.z)) continue;
      return true;
    }
    return false;
  }

  // 선 따라가기 한 스텝: 접선 방향으로 이동 + 차선 (우측 통행) 유지, 교차로 회전
  _follow(o, dt, laneOff, turnP) {
    roadQ(o.x, o.z);
    let gx = o.axis === 0 ? Q.xx : Q.zx, gz = o.axis === 0 ? Q.xz : Q.zz;
    const gl = Math.hypot(gx, gz);
    let tx = -gz / gl * o.dir, tz = gx / gl * o.dir;
    // 교차로: 다른 축 q 가 격자선을 지날 때
    const qo = o.axis === 0 ? Q.qz : Q.qx;
    const nearX = fa(qo, o.L) < 2;
    if (nearX && !o.inX && Math.random() < turnP) {
      o.axis ^= 1;
      o.tgt = Math.round(qo / o.L) * o.L;
      o.dir = Math.random() < 0.5 ? 1 : -1;
      roadQ(o.x, o.z);
      gx = o.axis === 0 ? Q.xx : Q.zx; gz = o.axis === 0 ? Q.xz : Q.zz;
      const g2 = Math.hypot(gx, gz);
      tx = -gz / g2 * o.dir; tz = gx / g2 * o.dir;
    }
    o.inX = nearX;
    o.x += tx * o.sp * dt; o.z += tz * o.sp * dt;
    // 오른쪽 = (-tz, tx) → q 축 방향 성분의 부호
    const rs = Math.sign(-tz * gx + tx * gz) || 1;
    this._snap(o, o.tgt + laneOff(o) * rs);
    o.h = Math.atan2(tx, tz);
  }

  _ground(o, dist) {
    if (Math.abs(o.x - o.gx) + Math.abs(o.z - o.gz) > dist) { o.gx = o.x; o.gz = o.z; o.gy = this._hAt(o.x, o.z); }
    return o.gy;
  }

  // ───────── 바깥에서 부르는 사건 ─────────
  /** 폭발 (절대 좌표): R 안은 날아감 (세기 power m/s 정도), 3R 안 사람은 도망 */
  // 칼·검기·빔이 지나간 선분: 사람은 죽고 차는 부서짐
  hit(ax, ay, az, bx, by, bz, r, power = 1) { return this.town ? this.town.hit(ax, ay, az, bx, by, bz, r, power) : 0; }
  blast(x, y, z, R, power = 20) {
    if (this.town) this.town.blast(x, y, z, R, power);
    for (const o of this.people) if (o.alive) {
      const d = Math.hypot(o.x - x, o.y - y, o.z - z);
      if (d < R) this._fling(o, x, y, z, power * (1 - d / R) + 4, d);
      else if (d < R * 3 && o.st !== 'fly' && o.st !== 'down') this._panic(o, x, z);
    }
    for (const o of this.cars) if (o.alive) {
      const d = Math.hypot(o.x - x, o.y - y, o.z - z);
      if (d < R * 0.8) this._fling(o, x, y, z, power * 0.6 * (1 - d / R) + 2, d);
      else if (d < R * 3 && o.st === 'drive') { o.st = 'stop'; o.t = 0; }
    }
    for (const f of this.flocks) if (f.alive && Math.hypot(f.x - x, f.z - z) < R * 6) f.scat = 1;
  }
  /** 사람만 놀라 도망 (칼질·빔 등) */
  panic(x, z, R) {
    if (this.town) this.town.panic(x, z, R);
    for (const o of this.people) if (o.alive && o.st !== 'fly' && o.st !== 'down' && Math.hypot(o.x - x, o.z - z) < R) this._panic(o, x, z);
    for (const o of this.cars) if (o.alive && o.st === 'drive' && Math.hypot(o.x - x, o.z - z) < R * 0.7) { o.st = 'stop'; o.t = 0; }
  }
  /** 핵 충격파: 중심 (x,z) 에서 front 까지 지나간 곳 — vap 안은 증발, 그 밖은 압력 (R5/d)^1.4 에 비례해 날아감 */
  shock(id, x, gy, z, front, vap, R5, Rmax) {
    if (this.town) this.town.shock(id, x, gy, z, front, vap, R5, Rmax);
    const hit = (o, car) => {
      if (!o.alive || o.shock === id) return;
      const d = Math.hypot(o.x - x, o.z - z);
      if (d > front || d > Rmax) return;
      o.shock = id;
      if (d < vap) { o.alive = false; return; }
      const v = clamp(Math.pow(R5 / Math.max(d, 30), 1.4) * (car ? 35 : 45), 3, 250);
      this._fling(o, x, gy - 30, z, v, d);
    };
    for (const o of this.people) hit(o, false);
    for (const o of this.cars) hit(o, true);
    for (const f of this.flocks) if (f.alive && Math.hypot(f.x - x, f.z - z) < front) f.scat = 1;
  }
  _fling(o, x, y, z, v, d) {
    const dx = o.x - x, dz = o.z - z, l = Math.hypot(dx, dz) || 1;
    o.vx = dx / l * v; o.vz = dz / l * v; o.vy = v * rnd(0.25, 0.6) + 1;
    o.wx = rnd(-8, 8); o.wz = rnd(-8, 8);
    if (o.st !== 'fly') { o.rx = 0; o.rz = 0; }
    o.st = 'fly'; o.t = 0;
  }
  _panic(o, x, z) {
    if (o.st === 'flee') return;
    const dx = o.x - x, dz = o.z - z, l = Math.hypot(dx, dz) || 1;
    o.st = 'flee'; o.t = 0; o.fx = dx / l; o.fz = dz / l;
    o.sp = rnd(3.8, 5.6);
  }

  // ───────── 매 프레임 ─────────
  update(dt, camAbs, playerAbs, playerVel, show) {
    this.time += dt;
    const cam = camAbs;
    const gC = this._hAt(cam.x, cam.z);
    const agl = cam.y - gC;
    const near = show && agl < 2500;
    this.pMesh.visible = this.cMesh.visible = near;
    this.bMesh.visible = show && agl < 6000;
    this.bdMesh.visible = show && agl < 1500;
    if (dt > 0 && show) {
      if (near) { this._stepPeople(dt, cam, playerAbs, playerVel); this._stepCars(dt, cam, playerAbs, playerVel); }
      this._stepBoats(dt, cam, playerAbs, playerVel);
      this._stepBirds(dt, cam, playerAbs, playerVel);
    }
    this._stepPlanes(dt, cam, playerAbs, playerVel, show);
    this._render(cam, near, show);
  }

  _physics(o, dt, gy) {
    o.vy -= G * dt;
    const dr = Math.exp(-0.08 * dt * Math.hypot(o.vx, o.vy, o.vz));   // 공기 저항
    o.vx *= dr; o.vy *= dr; o.vz *= dr;
    o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
    o.rx += o.wx * dt; o.rz += o.wz * dt;
    if (o.y <= gy) {
      o.y = gy;
      if (o.vy < -3) { o.vy *= -0.25; o.vx *= 0.5; o.vz *= 0.5; o.wx *= 0.5; o.wz *= 0.5; }
      else { o.vy = 0; o.vx *= Math.exp(-6 * dt); o.vz *= Math.exp(-6 * dt); o.wx *= Math.exp(-8 * dt); o.wz *= Math.exp(-8 * dt); }
      return Math.hypot(o.vx, o.vz) < 0.4 && Math.abs(o.vy) < 0.5;
    }
    return false;
  }

  _stepPeople(dt, cam, pa, pv) {
    const R = this.R, P = this.people;
    let alive = 0, spawns = this.eco ? 2 : 4;
    const pSp = pv.length();
    for (const o of P) {
      if (o.alive && Math.hypot(o.x - cam.x, o.z - cam.z) > R * 1.3 && o.st !== 'fly') o.alive = false;
      if (!o.alive) {
        if (o.i >= this.maxP || spawns <= 0) continue;
        spawns--;
        const first = this.time < 1.5;
        if (!this._spawnRoad(o, cam, first ? 10 : R * 0.7, R, true)) continue;
        o.alive = true; o.st = 'walk'; o.sp = rnd(1.1, 1.6); o.gx = 1e9; o.y = this._ground(o, 0); o.rx = o.rz = 0; o.shock = -1;
      }
      alive++;
      o.t += dt;
      // 플레이어에 부딪힘
      const dp = Math.hypot(o.x - pa.x, o.y + 0.9 - pa.y, o.z - pa.z);
      if (dp < 1.6 && pSp > 6 && o.st !== 'fly') { o.vx = pv.x * 0.8; o.vy = Math.max(3, pv.y * 0.5 + pSp * 0.25); o.vz = pv.z * 0.8; o.wx = rnd(-10, 10); o.wz = rnd(-10, 10); o.st = 'fly'; o.t = 0; }
      else if (dp < 12 && pSp > 25 && (o.st === 'walk')) this._panic(o, pa.x, pa.z);
      if (o.st === 'walk') {
        this._follow(o, dt, (p) => (p.L === 512 ? 17 : 6.5) + 1.8, 0.3);
        o.ph += dt * o.sp * 4.2;
        o.chk -= dt;
        if (o.chk <= 0) { o.chk = 1; if (this._roof(o.x + Math.sin(o.h) * 2, o.z + Math.cos(o.h) * 2) > o.y + 1 || this._water(o.x, o.z)) o.dir = -o.dir; }
        o.y = this._ground(o, 2.5);
      } else if (o.st === 'flee') {
        o.x += o.fx * o.sp * dt; o.z += o.fz * o.sp * dt; o.h = Math.atan2(o.fx, o.fz);
        o.ph += dt * o.sp * 3.2;
        o.chk -= dt;
        if (o.chk <= 0) { o.chk = 0.5; if (this._roof(o.x + o.fx * 2, o.z + o.fz * 2) > o.y + 1) { const t = o.fx; o.fx = -o.fz; o.fz = t; } }
        o.y = this._ground(o, 2.5);
        if (o.t > 25) { o.st = 'walk'; o.sp = rnd(1.1, 1.6); this._spawnRoad(o, { x: o.x, z: o.z }, 0, 30, true) || (o.alive = false); }
      } else if (o.st === 'fly') {
        o.gx = 1e9;
        const gy = this._ground(o, 0);
        if (this._physics(o, dt, gy) && o.t > 0.4) { o.st = 'down'; o.t = 0; o.rx = Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1); o.rz = 0; }
      } else if (o.st === 'down') {
        // 잠시 쓰러져 있다가 일어나 도망
        if (o.t > rnd(5, 9)) { o.rx = 0; o.rz = 0; o.st = 'flee'; o.t = 0; const a = Math.random() * 6.28; o.fx = Math.sin(a); o.fz = Math.cos(a); o.sp = rnd(2.5, 4.5); }
      }
    }
    this.pMesh.count = 0;
    this._aliveP = alive;
  }

  _stepCars(dt, cam, pa, pv) {
    const R = this.R * 1.6, C = this.cars;
    let spawns = this.eco ? 1 : 3;
    const pSp = pv.length();
    for (const o of C) {
      if (o.alive && Math.hypot(o.x - cam.x, o.z - cam.z) > R * 1.3) o.alive = false;
      if (!o.alive) {
        if (o.i >= this.maxC || spawns <= 0) continue;
        spawns--;
        const first = this.time < 1.5;
        if (!this._spawnRoad(o, cam, first ? 20 : R * 0.75, R, false)) continue;
        o.alive = true; o.st = 'drive'; o.sp = o.vmax * rnd(0.6, 1); o.gx = 1e9; o.y = this._ground(o, 0); o.rx = o.rz = 0; o.shock = -1;
      }
      o.t += dt;
      const dp = Math.hypot(o.x - pa.x, o.y + 0.8 - pa.y, o.z - pa.z);
      if (dp < 3 && pSp > 15 && o.st !== 'fly') {
        o.vx = pv.x * 0.6; o.vy = Math.max(2, pSp * 0.15); o.vz = pv.z * 0.6; o.wx = rnd(-3, 3); o.wz = rnd(-3, 3); o.st = 'fly'; o.t = 0;
        this.game.audio && this.game.audio.play('clang', 0.8);
        this.game.fx && this.game.fx.sparks && this.game.fx.sparks(_p.set(o.x - origin.x, o.y + 0.8 - origin.y, o.z - origin.z), _a.copy(pv).normalize(), 40, 0.8, 18, 2, 1.6, 1.1, 0.06);
      }
      if (o.st === 'drive' || o.st === 'stop') {
        // 앞에 사람이 있거나 놀라 멈춤 → 서서히 감속
        const want = o.st === 'stop' ? 0 : o.vmax;
        o.sp += clamp(want - o.sp, -7 * dt, 2.5 * dt);
        if (o.st === 'stop' && o.t > 12) o.st = 'drive';
        if (o.sp > 0.05) this._follow(o, dt, (c) => (c.L === 512 ? 5.5 : 2.2), 0.35);
        o.chk -= dt;
        if (o.chk <= 0) { o.chk = 1.2; if (this._road(o.x + Math.sin(o.h) * 12, o.z + Math.cos(o.h) * 12) !== 1) o.dir = -o.dir; }
        o.y = this._ground(o, 4);
      } else if (o.st === 'fly') {
        o.gx = 1e9;
        const gy = this._ground(o, 0);
        if (this._physics(o, dt, gy) && o.t > 0.5) { o.st = 'wreck'; o.t = 0; o.rx = Math.round(o.rx / Math.PI) * Math.PI; o.rz = Math.round(o.rz / Math.PI) * Math.PI; }
      }
    }
  }

  _stepBoats(dt, cam, pa, pv) {
    let spawns = 1;
    for (const o of this.boats) {
      if (o.alive && Math.hypot(o.x - cam.x, o.z - cam.z) > 2600) o.alive = false;
      if (!o.alive) {
        if (spawns-- <= 0) continue;
        const a = Math.random() * 6.28, r = rnd(this.time < 1.5 ? 80 : 900, 1800);
        o.x = cam.x + Math.sin(a) * r; o.z = cam.z + Math.cos(a) * r;
        const T = this.game.terrain;
        if (!T || !(T.waterLevelAt(o.x, o.z) > T.heightAt(o.x, o.z) + 2)) continue;
        o.alive = true; o.h = Math.random() * 6.28; o.y = T.waterLevelAt(o.x, o.z); o.t = 0; o.sink = 0;
      }
      o.t += dt;
      const T = this.game.terrain;
      if (o.sink > 0) { o.sink += dt; o.y -= dt * 1.2; if (o.sink > 20) o.alive = false; continue; }
      o.x += Math.sin(o.h) * o.sp * dt; o.z += Math.cos(o.h) * o.sp * dt;
      o.chk -= dt;
      if (o.chk <= 0) {
        o.chk = 0.6;
        const ax = o.x + Math.sin(o.h) * 40, az = o.z + Math.cos(o.h) * 40;
        if (!(T.waterLevelAt(ax, az) > T.heightAt(ax, az) + 1.5)) o.h += (Math.random() < 0.5 ? 1 : -1) * rnd(0.6, 1.4);
        o.y = T.waterLevelAt(o.x, o.z);
        if (!(o.y > -1e8)) o.alive = false;
      }
      // 뱃머리 물살
      o.wake -= dt;
      if (o.wake <= 0 && this.game.fx && this.game.fx.puff) {
        o.wake = 0.25;
        const s = Math.random() < 0.5 ? 1 : -1;
        this.game.fx.puff({ x: o.x - origin.x - Math.sin(o.h) * 5 + Math.cos(o.h) * s * 1.5, y: o.y - origin.y + 0.2, z: o.z - origin.z - Math.cos(o.h) * 5 - Math.sin(o.h) * s * 1.5,
          vx: Math.cos(o.h) * s * 1.2, vy: 0.2, vz: -Math.sin(o.h) * s * 1.2, life: 3, s0: 1.2, s1: 4, a: 0.45, r0: 1, g0: 1, b0: 1, r1: 1, g1: 1, b1: 1, fin: 0.05, drag: 0.5 }, 'smoke');
      }
      if (Math.hypot(o.x - pa.x, o.y - pa.y, o.z - pa.z) < 7 && pv.length() > 20) { o.sink = 0.01; this.game.audio && this.game.audio.play('splash', 1); }
    }
  }

  _stepBirds(dt, cam, pa, pv) {
    for (const f of this.flocks) {
      if (f.alive && Math.hypot(f.x - cam.x, f.z - cam.z) > 900) f.alive = false;
      if (!f.alive) {
        const a = Math.random() * 6.28, r = rnd(this.time < 1.5 ? 60 : 300, 600);
        f.x = cam.x + Math.sin(a) * r; f.z = cam.z + Math.cos(a) * r;
        if (this._water(f.x, f.z) && Math.random() < 0.5) continue;
        f.y = this._hAt(f.x, f.z) + rnd(35, 110); f.alive = true; f.scat = 0; f.vx = rnd(-3, 3); f.vz = rnd(-3, 3);
      }
      f.x += f.vx * dt; f.z += f.vz * dt;
      if (Math.hypot(f.x - pa.x, f.y - pa.y, f.z - pa.z) < 45 && pv.length() > 12) f.scat = 1;
      if (f.scat > 0) { f.scat += dt; if (f.scat > 8) { f.alive = false; } }
    }
    for (const b of this.birds) {
      const f = this.flocks[b.f];
      b.a += b.w * dt * (f.scat > 0 ? 2.5 : 1);
      const R = b.r * (1 + (f.scat > 0 ? f.scat * 6 : 0));
      b.sx = f.x + Math.cos(b.a) * R; b.sz = f.z + Math.sin(b.a) * R;
      b.sy = f.y + b.dy + Math.sin(this.time * 0.7 + b.ph) * 3 + (f.scat > 0 ? f.scat * f.scat * 4 : 0);
      b.h = Math.atan2(-Math.sin(b.a) * Math.sign(b.w), Math.cos(b.a) * Math.sign(b.w));
    }
  }

  _stepPlanes(dt, cam, pa, pv, show) {
    for (const P of this.planes) {
      if (!show) { P.mesh.visible = false; P.trail.mesh.visible = false; continue; }
      P.trail.mesh.visible = true;
      if (P.alive && (Math.hypot(P.p.x - cam.x, P.p.z - cam.z) > 70000 || (P.st === 'down' && P.t > 30))) { P.alive = false; P.trail.clear(); }
      if (!P.alive) {
        if (Math.random() > 0.02) continue;
        // 카메라에서 20~45 km 떨어진 곳에서 카메라 근처를 스쳐 지나가는 방향으로
        const a = Math.random() * 6.28, r = rnd(20000, 45000);
        P.p.set(cam.x + Math.sin(a) * r, rnd(9000, 11500), cam.z + Math.cos(a) * r);
        const b = a + Math.PI + rnd(-0.5, 0.5);
        P.v.set(Math.sin(b), 0, Math.cos(b)).multiplyScalar(rnd(225, 255));
        P.alive = true; P.st = 'fly'; P.t = 0; P.lastPt = 0; P.roll = 0; P.rv = 0; P.trail.clear();
        // 셋 중 하나는 김포·인천 쪽으로 내려가는 낮은 비행기
        if (Math.random() < 0.33) { P.p.y = rnd(1200, 3000); P.v.multiplyScalar(0.4); }
      }
      P.t += dt;
      if (dt > 0) {
        if (P.st === 'fly') {
          P.p.addScaledVector(P.v, dt);
          // 부딪힘: 폭발 후 추락
          if (Math.hypot(P.p.x - pa.x, P.p.y - pa.y, P.p.z - pa.z) < 26 && pv.length() > 30) this._crash(P);
        } else {
          P.v.y -= G * dt; P.v.multiplyScalar(Math.exp(-0.05 * dt));
          P.p.addScaledVector(P.v, dt);
          P.roll += P.rv * dt;
          const fx = this.game.fx;
          if (fx && fx.puff && Math.random() < 0.8) {
            fx.puff({ x: P.p.x - origin.x, y: P.p.y - origin.y, z: P.p.z - origin.z, vx: rnd(-2, 2), vy: 2, vz: rnd(-2, 2), life: 12, s0: 6, s1: 22, a: 0.7, r0: 0.08, g0: 0.07, b0: 0.065, r1: 0.12, g1: 0.11, b1: 0.1, fin: 0.03, drag: 0.4 }, 'smoke');
            fx.puff({ x: P.p.x - origin.x, y: P.p.y - origin.y, z: P.p.z - origin.z, life: 0.3, s0: 5, s1: 9, r0: 5, g0: 2.4, b0: 0.6, r1: 1.4, g1: 0.3, b1: 0.05, a: 0.9, add0: 1, add1: 1, shade: 0, fin: 0.01 }, 'glow');
          }
          const gy = this._hAt(P.p.x, P.p.z);
          if (P.p.y < gy + 3) {
            _p.set(P.p.x - origin.x, gy - origin.y, P.p.z - origin.z);
            if (fx && fx.impact) fx.impact(_p, 4e8, _a.set(0, 1, 0));
            this.game.audio && this.game.audio.play('heroLand', 1);
            if (this.game.smashAt) this.game.smashAt(P.p.x, gy + 10, P.p.z, 30);
            this.blast(P.p.x, gy, P.p.z, 60, 30);
            P.alive = false; P.trail.clear();
            continue;
          }
        }
        // 비행운: 8 km 위, 엔진 뒤로 (0.5 초마다 한 점)
        if (P.st === 'fly' && P.p.y > 8000 && P.t - P.lastPt > 0.5) { P.lastPt = P.t; _a.copy(P.v).normalize(); P.trail.push(P.p.x - _a.x * 30, P.p.y - 2, P.p.z - _a.z * 30, this.time); }
      }
      if (!P.alive) { P.mesh.visible = false; continue; }
      P.mesh.visible = true;
      P.mesh.position.set(P.p.x - origin.x, P.p.y - origin.y, P.p.z - origin.z);
      _a.copy(P.v).normalize();
      P.mesh.quaternion.setFromUnitVectors(_b.set(0, 0, 1), _a);
      if (P.roll) P.mesh.quaternion.multiply(_q.setFromAxisAngle(_b.set(0, 0, 1), P.roll));
      P.mesh.userData.beacon.visible = (this.time % 1.2) < 0.12;
    }
    for (const P of this.planes) P.trail.update(this.time, this._camR || _p.set(0, 0, 0));
  }
  _crash(P) {
    P.st = 'down'; P.t = 0; P.rv = rnd(-1.2, 1.2);
    P.v.multiplyScalar(0.6); P.v.y -= 20;
    const fx = this.game.fx;
    _p.set(P.p.x - origin.x, P.p.y - origin.y, P.p.z - origin.z);
    if (fx && fx.impact) fx.impact(_p, 6e8, _a.set(0, 1, 0));
    if (fx && fx.energyBurst) fx.energyBurst(_p, 8, 2.4, 1.2, 0.4, true);
    this.game.audio && this.game.audio.play('heroLand', 1);
    this.game.hooks && this.game.hooks.shake(0.8);
    this.game.toast && this.game.toast('여객기 충돌!');
  }

  _render(cam, near, show) {
    this._camR = this._camR || new THREE.Vector3();
    this._camR.set(cam.x - origin.x, cam.y - origin.y, cam.z - origin.z);
    if (near) {
      let n = 0;
      for (const o of this.people) {
        if (!o.alive) continue;
        _q.setFromAxisAngle(Y, o.h || 0);
        if (o.rx || o.rz) _q.premultiply(_q2.setFromEuler(_e.set(o.rx, 0, o.rz)));
        _p.set(o.x - origin.x, o.y - origin.y + (o.st === 'down' ? 0.12 : 0), o.z - origin.z);
        _m.compose(_p, _q, _s.set(1, 1, 1));
        this.pMesh.setMatrixAt(n, _m);
        const moving = o.st === 'walk' || o.st === 'flee';
        this.pAnim.setXYZW(n, o.ph, moving ? (o.st === 'flee' ? 0.85 : 0.45) : 0, o.st === 'flee' || o.st === 'fly' ? 1 : 0, o.seed);
        this.pShirt.setXYZ(n, o.shirt.r, o.shirt.g, o.shirt.b); this.pPants.setXYZ(n, o.pants.r, o.pants.g, o.pants.b);
        n++;
      }
      // 살아 있는 사람만 앞에서부터 채움 (옷 색도 함께)
      this.pMesh.count = n;
      this.pMesh.instanceMatrix.needsUpdate = true; this.pAnim.needsUpdate = true; this.pShirt.needsUpdate = true; this.pPants.needsUpdate = true;
      let c = 0;
      for (const o of this.cars) {
        if (!o.alive) continue;
        _q.setFromAxisAngle(Y, o.h || 0);
        if (o.rx || o.rz) _q.premultiply(_q2.setFromEuler(_e.set(o.rx, 0, o.rz)));
        _p.set(o.x - origin.x, o.y - origin.y, o.z - origin.z);
        _m.compose(_p, _q, _s.set(1, 1, 1));
        this.cMesh.setMatrixAt(c, _m);
        this.cMesh.setColorAt(c, o.col);
        c++;
      }
      this.cMesh.count = c;
      this.cMesh.instanceMatrix.needsUpdate = true;
      if (this.cMesh.instanceColor) this.cMesh.instanceColor.needsUpdate = true;
    }
    let b = 0;
    for (const o of this.boats) {
      if (!o.alive) continue;
      _q.setFromAxisAngle(Y, o.h);
      _q.premultiply(_q2.setFromAxisAngle(X, Math.sin(this.time * 1.3 + o.i) * 0.03 + (o.sink > 0 ? Math.min(0.6, o.sink * 0.05) : 0)));
      _p.set(o.x - origin.x, o.y - origin.y, o.z - origin.z);
      _m.compose(_p, _q, _s.set(1, 1, 1));
      this.bMesh.setMatrixAt(b++, _m);
    }
    this.bMesh.count = b; this.bMesh.instanceMatrix.needsUpdate = true;
    let k = 0;
    this.bUni.uTime.value = this.time;
    for (const bd of this.birds) {
      const f = this.flocks[bd.f];
      if (!f.alive) continue;
      _q.setFromAxisAngle(Y, bd.h || 0);
      _p.set(bd.sx - origin.x, bd.sy - origin.y, bd.sz - origin.z);
      _m.compose(_p, _q, _s.set(1, 1, 1));
      this.bdMesh.setMatrixAt(k, _m);
      this.bdPh.setX(k, bd.ph);
      k++;
    }
    this.bdMesh.count = k; this.bdMesh.instanceMatrix.needsUpdate = true; this.bdPh.needsUpdate = true;
  }

  reset() {
    if (this.town) this.town.reset();
    for (const o of this.people) o.alive = false;
    for (const o of this.cars) o.alive = false;
    for (const o of this.boats) o.alive = false;
    for (const f of this.flocks) f.alive = false;
    for (const P of this.planes) { P.alive = false; P.trail.clear(); P.mesh.visible = false; }
  }
}
