// 1인칭 팔/손 (고해상도 SDF 조형 + 스키닝) — 걷어올린 소매, 팔뚝 피부/혈관/털/흉터, 전술 장갑(손가락 관절), 손목시계
import * as THREE from 'three';
import { SDFModel, ellipsoid, sphere, cone, rbox, torus, buildGeometry, smoothMesh, mergeParts } from './sdf.js';
import { SKEL, BI, triMaterial, frameQuat, setWorldQuat, n3 } from './human.js';
import { solveIK, clamp } from './core.js';
import { T } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FWD = V(0, 0, 1);
// 뼈대: 루트 + 좌우 (상완, 전완, 손, 검지 2, 나머지 손가락 2, 엄지 2)
const VB = [];
const addB = (name, parent, p) => VB.push({ name, parent: parent == null ? -1 : VB.findIndex((b) => b.name === parent), p: V(...p) });
addB('root', null, [0, 0, 0]);
const SIDES = [[1, 'L'], [-1, 'R']];
const GEO = {};
for (const [s, k] of SIDES) {
  const sh = SKEL[BI['uarm' + k]].p, el = SKEL[BI['farm' + k]].p, wr = SKEL[BI['hand' + k]].p;
  const d = V(s * 0.7071, -0.7071, 0), n = V(-s * 0.7071, -0.7071, 0), w = V(0, 0, 1);
  GEO[k] = { sh, el, wr, d, n, w, s };
  const at = (a, b, c) => wr.clone().addScaledVector(d, a).addScaledVector(n, b).addScaledVector(w, c).toArray();
  GEO[k].at = at;
  addB('uarm' + k, 'root', sh.toArray());
  addB('farm' + k, 'uarm' + k, el.toArray());
  addB('hand' + k, 'farm' + k, wr.toArray());
  addB('index1' + k, 'hand' + k, at(0.092, 0, 0.028));
  addB('index2' + k, 'index1' + k, at(0.092 + 0.045, 0.004, 0.029));
  addB('fing1' + k, 'hand' + k, at(0.094, 0, -0.004));
  addB('fing2' + k, 'fing1' + k, at(0.094 + 0.047, 0.004, -0.004));
  addB('thumb1' + k, 'hand' + k, at(0.024, 0.012, 0.03));
  addB('thumb2' + k, 'thumb1' + k, at(0.058, 0.03, 0.056));
}
const VBI = Object.fromEntries(VB.map((b, i) => [b.name, i]));
const REST = {};
for (const [s, k] of SIDES) {
  const G = GEO[k];
  REST['uarm' + k] = G.el.clone().sub(G.sh).normalize();
  REST['farm' + k] = G.wr.clone().sub(G.el).normalize();
  REST['along' + k] = G.d.clone(); REST['palm' + k] = G.n.clone();
  REST['curl' + k] = new THREE.Vector3().crossVectors(G.d, G.n).normalize();
}
export const VM_GRIP_OFF = {};
for (const [s, k] of SIDES) VM_GRIP_OFF[k] = GEO[k].d.clone().multiplyScalar(0.058).addScaledVector(GEO[k].n, 0.029);

function folds(amp, lambda, jointT, width) {
  return (t, qx, qy, qz, x, y, z) => -amp * Math.exp(-(((t - jointT) / width) ** 2)) * Math.sin(t * 6.283 / lambda + n3(x * 40, y * 40, z * 40) * 4 + Math.atan2(qz, qx) * 0.8) + (n3(x * 70, y * 70, z * 70) - 0.5) * 0.0015;
}

let ARM = null, HAND = null;
function buildArms() {
  if (ARM) return ARM;
  const parts = [];
  for (const [s, k] of SIDES) {
    const S = new SDFModel(s > 0 ? [0.14, 0.95, -0.09] : [-0.62, 0.95, -0.09], s > 0 ? [0.62, 1.48, 0.09] : [-0.14, 1.48, 0.09], 0.0036);
    const { sh, el, wr } = GEO[k], ua = VBI['uarm' + k], fa = VBI['farm' + k], ha = VBI['hand' + k];
    const lerpP = (a, b, t) => a.clone().lerp(b, t).toArray();
    // 소매: 상완 + 팔꿈치 주름 + 걷어올린 커프
    S.add(cone(sh.toArray(), el.toArray(), 0.057, 0.048, { bone: [ua, fa], seg: [sh.toArray(), el.toArray()], blend: [0.8, 1.02], mat: 'sleeve', k: 0.02, disp: folds(0.004, 0.14, 0.9, 0.2), dispMax: 0.006 }));
    S.add(cone(el.toArray(), lerpP(el, wr, 0.36), 0.048, 0.046, { bone: [ua, fa], seg: [el.toArray(), wr.toArray()], blend: [-0.1, 0.12], mat: 'sleeve', k: 0.015, disp: folds(0.004, 0.12, 0.1, 0.25), dispMax: 0.006 }));
    const cuffA = el.clone().lerp(wr, 0.35), cuffB = el.clone().lerp(wr, 0.305);
    for (const [c, R, r] of [[cuffA, 0.046, 0.0105], [cuffB, 0.048, 0.009]]) {
      S.add(torus(c.toArray(), R, r, { bone: fa, mat: 'sleeve', k: 0.006, rot: [0, 0, s * Math.PI / 4] }));
    }
    // 팔뚝 피부 (근육 볼륨 + 힘줄 + 혈관)
    S.add(cone(lerpP(el, wr, 0.25), wr.toArray(), 0.042, 0.03, { bone: [fa, ha], seg: [el.toArray(), wr.toArray()], blend: [0.95, 1.1], mat: 'skin', k: 0.012 }));
    const m1 = el.clone().lerp(wr, 0.42).addScaledVector(GEO[k].w, 0.012).addScaledVector(GEO[k].n, -0.008);
    S.add(ellipsoid(m1.toArray(), [0.036, 0.034, 0.03], { bone: fa, mat: 'skin', k: 0.02, rot: [0, 0, -s * Math.PI / 4] }));
    for (const [o1, o2, t0, t1] of [[0.02, 0.028, 0.45, 0.97], [-0.012, 0.03, 0.5, 0.95], [0.004, 0.034, 0.6, 1.0]]) {
      const a = el.clone().lerp(wr, t0).addScaledVector(GEO[k].w, o1).addScaledVector(GEO[k].n, o2 * 0.95 + 0.004);
      const b = el.clone().lerp(wr, t1).addScaledVector(GEO[k].w, o1 * 0.6).addScaledVector(GEO[k].n, 0.026);
      S.add(cone(a.toArray(), b.toArray(), 0.0022, 0.0018, { bone: fa, mat: 'skin', k: 0.004 }));
    }
    if (k === 'R') { // 흉터 (얕은 홈)
      const sc = el.clone().lerp(wr, 0.62).addScaledVector(GEO[k].n, -0.036).addScaledVector(GEO[k].w, 0.012);
      S.sub(ellipsoid(sc.toArray(), [0.028, 0.0016, 0.0022], { k: 0.002, rot: [0.5, 0, -s * Math.PI / 4 + 0.4] }));
    }
    S.bake();
    const m = smoothMesh(S.mesh(), 1, 0.3);
    parts.push({ m, cls: S.classify(m, VB, 0.012) });
  }
  const { m, cls } = mergeParts(parts);
  ARM = buildGeometry(m, cls, ['sleeve', 'skin'], (x, y, z, mat, out) => {
    if (mat === 'skin') {
      const sun = 0.9 + n3(x * 40, y * 40, z * 40) * 0.12, fr = n3(x * 300, y * 300, z * 300) > 0.8 ? 0.93 : 1;
      out[0] = 0.72 * sun * fr; out[1] = 0.5 * sun * fr; out[2] = 0.37 * sun * fr;
      // 흉터 색 (오른팔)
      if (x < 0) { const G = GEO.R, sc = G.el.clone().lerp(G.wr, 0.62).addScaledVector(G.n, -0.036).addScaledVector(G.w, 0.012); const dd = V(x, y, z).distanceTo(sc); if (dd < 0.03) { const k = Math.max(0, 1 - dd / 0.03) * 0.5; out[0] += 0.12 * k; out[1] += 0.02 * k; out[2] += 0.05 * k; } }
    } else { const dirt = n3(x * 12, y * 12, z * 12) * 0.12; out[0] = out[1] = out[2] = 1 - dirt; }
  });
  return ARM;
}

function buildGloves() {
  if (HAND) return HAND;
  const parts = [];
  for (const [s, k] of SIDES) {
    const S = new SDFModel(s > 0 ? [0.44, 0.84, -0.08] : [-0.8, 0.84, -0.08], s > 0 ? [0.8, 1.1, 0.12] : [-0.44, 1.1, 0.12], 0.0024);
    const G = GEO[k], at = G.at, rz = [0, 0, -s * Math.PI / 4];
    const hb = VBI['hand' + k];
    // 커프 + 벨크로 스트랩
    S.add(cone(at(-0.04, 0, 0), at(0.012, 0, 0), 0.0355, 0.034, { bone: hb, mat: 'cuff', k: 0.008 }));
    S.add(rbox(at(-0.012, -0.03, 0.0), [0.018, 0.007, 0.03], 0.005, { bone: hb, mat: 'cuff', k: 0.004, rot: rz }));
    // 손바닥 / 손등 / 무지구
    S.add(ellipsoid(at(0.05, 0.001, 0.001), [0.048, 0.0185, 0.046], { bone: hb, mat: 'glove', k: 0.01, rot: rz }));
    S.add(ellipsoid(at(0.03, 0.008, 0.021), [0.032, 0.018, 0.028], { bone: hb, mat: 'glove', k: 0.012, rot: rz }));
    S.add(ellipsoid(at(0.028, 0.006, -0.028), [0.034, 0.013, 0.014], { bone: hb, mat: 'glove', k: 0.01, rot: rz }));
    // 너클 보호 (하드쉘) + 손등 패널
    S.add(rbox(at(0.083, -0.019, 0.001), [0.011, 0.0055, 0.041], 0.0045, { bone: hb, mat: 'pad', k: 0.003, rot: rz }));
    S.add(rbox(at(0.045, -0.02, 0.0), [0.028, 0.004, 0.034], 0.004, { bone: hb, mat: 'pad2', k: 0.004, rot: rz }));
    // 손가락: 검지(별도 뼈) + 중지/약지/소지
    const F = [[0.028, 0.045, 0.0096, 'index'], [0.009, 0.049, 0.0099, 'fing'], [-0.01, 0.046, 0.0094, 'fing'], [-0.028, 0.037, 0.0084, 'fing']];
    for (const [o, L, r, b] of F) {
      const b1 = VBI[b + '1' + k], b2 = VBI[b + '2' + k];
      const k0 = at(0.092, 0.0, o), k1 = at(0.092 + L, 0.004, o * 1.03), k2 = at(0.092 + L + 0.028, 0.01, o * 1.05), k3 = at(0.092 + L + 0.05, 0.02, o * 1.06);
      S.add(sphere(k0, r * 1.18, { bone: b1, mat: 'glove', k: 0.006 }));
      S.add(cone(k0, k1, r, r * 0.93, { bone: [b1, b2], seg: [k0, k1], blend: [0.86, 1.04], mat: 'glove', k: 0.004 }));
      S.add(cone(k1, k2, r * 0.93, r * 0.85, { bone: b2, mat: 'glove', k: 0.004 }));
      S.add(cone(k2, k3, r * 0.85, r * 0.78, { bone: b2, mat: 'glove', k: 0.004 }));
      S.add(sphere(k1, r * 0.98, { bone: [b1, b2], seg: [k0, k2], blend: [0.4, 0.6], mat: 'glove', k: 0.004 }));
      // 손가락 마디 패드 (손등쪽)
      const pp = at(0.092 + L * 0.5, -r * 0.95, o * 1.02);
      S.add(rbox(pp, [L * 0.28, 0.0035, r * 0.7], 0.003, { bone: b1, mat: 'pad', k: 0.002, rot: rz }));
      // 관절 주름 (고리)
      S.sub(torus(at(0.092 + L + 0.002, 0.004, o * 1.03), r * 1.02, 0.0012, { k: 0.0015, rot: [0, 0, -s * Math.PI / 4 + Math.PI / 2] }));
    }
    // 엄지
    const t0 = at(0.024, 0.012, 0.03), t1 = at(0.058, 0.03, 0.056), t2 = at(0.084, 0.045, 0.07);
    S.add(cone(at(0.0, 0.009, 0.017), t0, 0.0185, 0.0152, { bone: hb, mat: 'glove', k: 0.012 }));
    S.add(cone(t0, t1, 0.0128, 0.0112, { bone: [VBI['thumb1' + k], VBI['thumb2' + k]], seg: [t0, t1], blend: [0.8, 1.05], mat: 'glove', k: 0.006 }));
    S.add(cone(t1, t2, 0.0112, 0.0096, { bone: VBI['thumb2' + k], mat: 'glove', k: 0.005 }));
    // 손목시계 (왼손, 장갑 커프 위)
    if (k === 'L') {
      const wc = at(-0.022, -0.036, 0.0);
      S.add(rbox(wc, [0.019, 0.0065, 0.021], 0.006, { bone: hb, mat: 'watch', k: 0.002, rot: rz }));
      S.add(torus(at(-0.022, 0, 0), 0.039, 0.0045, { bone: hb, mat: 'strap', k: 0.002, rot: [0, 0, s * Math.PI / 4] }));
      S.add(rbox(at(-0.022, -0.0428, 0.0), [0.014, 0.0012, 0.015], 0.003, { bone: hb, mat: 'face', k: 0.001, rot: rz }));
    }
    S.bake();
    const m = smoothMesh(S.mesh(), 1, 0.3);
    parts.push({ m, cls: S.classify(m, VB, 0.006) });
  }
  const { m, cls } = mergeParts(parts);
  HAND = buildGeometry(m, cls, ['glove', 'pad', 'pad2', 'cuff', 'watch', 'strap', 'face'], null);
  return HAND;
}

function hairShell(layer, layers) {
  const m = new THREE.MeshStandardMaterial({ color: 0x2b1f15, roughness: 0.85, envMapIntensity: 0.4, alphaTest: 0.5 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uL = { value: 0.0038 * layer / layers }; s.uniforms.uK = { value: layer / layers };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uL; varying vec3 vP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position; float sx = sign(position.x); transformed += normal * uL + vec3(sx * 0.7071, -0.7071, 0.0) * uL * 2.2;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uK; varying vec3 vP; float hh(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`)
      .replace('#include <alphatest_fragment>', `float sx = sign(vP.x); vec3 dd = vec3(sx * 0.7071, -0.7071, 0.0), nn = vec3(-sx * 0.7071, -0.7071, 0.0);
        vec2 ac = floor(vec2(dot(vP, nn), vP.z) * 1500.0); float al = dot(vP, dd) * 300.0 + hh(ac.xyx) * 7.0;
        float r = hh(vec3(ac, floor(al))); if (r < 0.965 + uK * 0.025 || fract(al) > 1.0 - uK * 0.5) discard;`);
  };
  m.customProgramCacheKey = () => 'armhair' + layer;
  return m;
}

export class Arms {
  constructor(root) {
    this.root = root;
    const bones = VB.map((b) => { const x = new THREE.Bone(); x.name = b.name; return x; });
    VB.forEach((b, i) => { if (b.parent < 0) bones[i].position.copy(b.p); else { bones[b.parent].add(bones[i]); bones[i].position.copy(b.p).sub(VB[b.parent].p); } });
    this.bones = Object.fromEntries(bones.map((b) => [b.name, b]));
    const skel = new THREE.Skeleton(bones);
    const cam = T.multicam;
    const sleeve = triMaterial({ map: cam.map, nmap: T.clothN.normalMap, scale: 3.4, ns: 1.6, rough: 0.95, vcol: true, sheen: 0.7 });
    const skin = triMaterial({ nmap: T.skinN.normalMap, map: T.skinN.map, scale: 30, ns: 0.8, rough: 0.5, vcol: true, sheen: 0.2 });
    const glove = triMaterial({ color: 0x5a4a37, map: T.glove.map, nmap: T.glove.normalMap, scale: 11, ns: 1.5, rough: 0.72, sheen: 0.3 });
    const pad = triMaterial({ color: 0x1f1d1a, nmap: T.stipple.normalMap, scale: 26, ns: 0.7, rough: 0.45 });
    const pad2 = triMaterial({ color: 0x3a342b, nmap: T.stipple.normalMap, scale: 24, ns: 0.5, rough: 0.6 });
    const cuff = triMaterial({ color: 0x2d2924, nmap: T.clothN.normalMap, scale: 9, ns: 1.2, rough: 0.9 });
    const watch = triMaterial({ color: 0x151515, nmap: T.stipple.normalMap, scale: 30, ns: 0.3, rough: 0.35 });
    const strap = triMaterial({ color: 0x23201c, nmap: T.clothN.normalMap, scale: 20, ns: 1, rough: 0.8 });
    const face = new THREE.MeshPhysicalMaterial({ color: 0x0a0c0c, emissive: new THREE.Color(0.25, 0.9, 0.5), emissiveIntensity: 0.25, roughness: 0.05, clearcoat: 1 });
    this.arm = new THREE.SkinnedMesh(buildArms(), [sleeve, skin]);
    this.arm.add(bones[0]); this.arm.bind(skel);
    this.hands = new THREE.SkinnedMesh(buildGloves(), [glove, pad, pad2, cuff, watch, strap, face]);
    this.hands.bind(skel);
    this.group = new THREE.Group();
    this.group.add(this.arm, this.hands);
    for (const o of [this.arm, this.hands]) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; }
    // 팔 털 셸 (피부 영역만)
    const g = this.arm.geometry, grp = g.groups.find((x) => x.materialIndex === 1);
    if (grp) {
      const hg = new THREE.BufferGeometry();
      for (const a of ['position', 'normal', 'skinIndex', 'skinWeight']) hg.setAttribute(a, g.attributes[a]);
      hg.setIndex(new THREE.BufferAttribute(g.index.array.slice(grp.start, grp.start + grp.count), 1));
      for (let i = 1; i <= 5; i++) { const sm = new THREE.SkinnedMesh(hg, hairShell(i, 5)); sm.bind(skel); sm.frustumCulled = false; this.group.add(sm); }
    }
    root.add(this.group);
    this.side = { L: { hand: this.bones.handL }, R: { hand: this.bones.handR } };
    this.shoulder = { L: V(-0.21, -0.31, 0.17), R: V(0.21, -0.31, 0.17) };
  }

  // tgt: {p, q} (root 로컬), curl: [c1, c2, i1, i2, t1, t2]
  updateSide(k, tgt, curl) {
    const s = k === 'L' ? 1 : -1, B = this.bones;
    this.root.updateWorldMatrix(true, false);
    const rq = this.root.getWorldQuaternion(new THREE.Quaternion());
    const P = tgt.p.clone().applyMatrix4(this.root.matrixWorld), Q = rq.clone().multiply(tgt.q);
    const along = V(0, 0, -1).applyQuaternion(Q), palm = V(k === 'R' ? -1 : 1, 0, 0).applyQuaternion(Q);
    const Qh = frameQuat(REST['along' + k], REST['palm' + k], along, palm);
    const wrist = P.clone().sub(VM_GRIP_OFF[k].clone().applyQuaternion(Qh));
    // 어깨 → 상완 뼈 위치 (카메라 공간 고정)
    B['uarm' + k].position.copy(this.shoulder[k]);
    B['uarm' + k].updateMatrixWorld(true);
    const sh = V(0, 0, 0).setFromMatrixPosition(B['uarm' + k].matrixWorld);
    const pole = V(-s * 0.75, -1, 0.15).normalize().applyQuaternion(rq);
    const elbow = V(0, 0, 0), S = sh.clone();
    solveIK(S, wrist, 0.295, 0.255, pole, elbow);
    if (S.distanceToSquared(sh) > 1e-8) { B['uarm' + k].position.add(S.sub(sh).applyQuaternion(rq.clone().invert())); B['uarm' + k].updateMatrixWorld(true); sh.setFromMatrixPosition(B['uarm' + k].matrixWorld); }
    const ua = elbow.clone().sub(sh), fl = wrist.clone().sub(elbow);
    const un = ua.clone().normalize(), flex = fl.clone().addScaledVector(un, -fl.dot(un));
    setWorldQuat(B['uarm' + k], frameQuat(REST['uarm' + k], FWD, ua, flex.lengthSq() > 1e-8 ? flex : pole));
    setWorldQuat(B['farm' + k], frameQuat(REST['farm' + k], FWD, fl, V(0, 0, 1).applyQuaternion(Qh)));
    setWorldQuat(B['hand' + k], Qh);
    const ca = REST['curl' + k], c = curl || [1.2, 1.1, 1.2, 1.1, 0.4, 0.5];
    B['fing1' + k].quaternion.setFromAxisAngle(ca, c[0]);
    B['fing2' + k].quaternion.setFromAxisAngle(ca, c[1]);
    B['index1' + k].quaternion.setFromAxisAngle(ca, c[2]);
    B['index2' + k].quaternion.setFromAxisAngle(ca, c[3]);
    B['thumb1' + k].quaternion.setFromAxisAngle(REST['along' + k], s * c[4]).multiply(new THREE.Quaternion().setFromAxisAngle(ca, 0.35));
    B['thumb2' + k].quaternion.setFromAxisAngle(ca, c[5]);
  }
  setVisible(v) { this.group.visible = v; }
}

// 앵커별 손가락 굽힘 [중지~소지 근위, 원위, 검지 근위, 원위, 엄지 회전, 엄지 원위]
export const CURLS = {
  grip: [1.35, 1.35, 0.45, 0.75, 0.55, 0.35],
  fore: [1.05, 0.95, 0.95, 0.85, 0.2, 0.3],
  mag: [0.95, 0.9, 0.9, 0.85, 0.5, 0.4],
  charge: [1.2, 1.3, 1.15, 1.2, 0.3, 0.5],
  bolt: [0.9, 1.1, 0.8, 1.0, 0.6, 0.5],
  slide: [1.1, 1.2, 1.05, 1.1, 0.2, 0.3],
  port: [0.7, 0.6, 0.6, 0.5, 0.3, 0.3],
  free: [0.8, 0.7, 0.75, 0.65, 0.4, 0.3],
  nade: [1.25, 1.3, 1.2, 1.25, 0.8, 0.6],
  ring: [1.2, 1.25, 0.75, 1.35, 0.7, 0.6],
  point: [0.3, 0.25, 0.2, 0.15, 0.25, 0.1],
  det: [1.35, 1.35, 1.1, 1.0, 0.2, 0.25],
};
