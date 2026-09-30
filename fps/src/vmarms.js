// 1인칭 팔/손 (고해상도 SDF 조형 + 스키닝) — 걷어올린 소매, 팔뚝 피부/혈관/털/흉터, 전술 장갑(손가락 관절), 손목시계
import * as THREE from 'three';
import { SDFModel, ellipsoid, sphere, cone, rbox, torus, buildGeometry, smoothMesh, mergeParts } from './sdf.js';
import { SKEL, BI, triMaterial, frameQuat, setWorldQuat, n3 } from './human.js';
import { solveIK, clamp } from './core.js';
import { handBoneSpec, buildGloveLocal, toRest, applyHandPose } from './hand.js';
import { T } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FWD = V(0, 0, 1);
// 뼈대: 루트 + 좌우 (상완, 전완, 손, 엄지 3마디, 네 손가락 각 3마디)
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
  for (const b of handBoneSpec()) addB(b.name + k, b.parent + k, at(b.p.x, b.p.y, b.p.z));
}
const VBI = Object.fromEntries(VB.map((b, i) => [b.name, i]));
const REST = {};
for (const [s, k] of SIDES) {
  const G = GEO[k];
  REST['uarm' + k] = G.el.clone().sub(G.sh).normalize();
  REST['farm' + k] = G.wr.clone().sub(G.el).normalize();
  REST['along' + k] = G.d.clone(); REST['palm' + k] = G.n.clone();
}
export const VM_GRIP_OFF = {};
for (const [s, k] of SIDES) VM_GRIP_OFF[k] = GEO[k].d.clone().multiplyScalar(0.058).addScaledVector(GEO[k].n, 0.03);

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
      const vein = Math.max(0, 1 - Math.abs(n3(x * 70, y * 25, z * 70) - 0.5) * 14) * 0.5, blot = n3(x * 90, y * 90, z * 90) - 0.5;
      out[0] = (0.68 + blot * 0.05 - vein * 0.05) * sun * fr; out[1] = (0.51 + blot * 0.02 - vein * 0.02) * sun * fr; out[2] = (0.4 + blot * 0.01 + vein * 0.02) * sun * fr;
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
    const G = GEO[k];
    const { m, S } = buildGloveLocal({ h: 0.0012, detail: true, watch: k === 'L', bi: (n) => VBI[n + k] });
    const cls = S.classify(m, VB, 0.0045);
    toRest(m, G.wr, G.d, G.n, G.w);
    parts.push({ m, cls });
  }
  const { m, cls } = mergeParts(parts);
  HAND = buildGeometry(m, cls, ['glove', 'palm', 'pad', 'pad2', 'cuff', 'cuff2', 'watch', 'strap', 'face'], null);
  return HAND;
}

function hairShell(layer, layers) {
  const m = new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.8, envMapIntensity: 0.4, alphaTest: 0.5 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uL = { value: 0.0038 * layer / layers }; s.uniforms.uK = { value: layer / layers };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uL; varying vec3 vP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position; float sx = sign(position.x); transformed += normal * uL + vec3(sx * 0.7071, -0.7071, 0.0) * uL * 2.2;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uK; varying vec3 vP; float hh(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`)
      .replace('#include <alphatest_fragment>', `float sx = sign(vP.x); vec3 dd = vec3(sx * 0.7071, -0.7071, 0.0), nn = vec3(-sx * 0.7071, -0.7071, 0.0);
        vec2 ac = floor(vec2(dot(vP, nn), vP.z) * 2600.0); float al = dot(vP, dd) * 170.0 + hh(ac.xyx) * 7.0;
        float r = hh(vec3(ac, floor(al))); if (r < 0.975 + uK * 0.018 || fract(al) > 1.0 - uK * 0.6) discard;`);
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
    const skin = triMaterial({ nmap: T.skinN.normalMap, map: T.skinN.map, scale: 30, ns: 0.8, rough: 0.5, vcol: true, sheen: 0.15, skin: 1 });
    const glove = triMaterial({ color: 0x5a4a37, map: T.glove.map, nmap: T.glove.normalMap, scale: 11, ns: 1.5, rough: 0.72, sheen: 0.3 });
    const palm = triMaterial({ color: 0x3e3a33, map: T.glove.map, nmap: T.stipple.normalMap, scale: 30, ns: 0.9, rough: 0.85, sheen: 0.5 });
    const pad = triMaterial({ color: 0x1f1d1a, nmap: T.stipple.normalMap, scale: 26, ns: 0.7, rough: 0.45 });
    const pad2 = triMaterial({ color: 0x3a342b, nmap: T.stipple.normalMap, scale: 24, ns: 0.5, rough: 0.6 });
    const cuff = triMaterial({ color: 0x2d2924, nmap: T.clothN.normalMap, scale: 9, ns: 1.2, rough: 0.9 });
    const cuff2 = triMaterial({ color: 0x24211d, nmap: T.stipple.normalMap, scale: 40, ns: 1.2, rough: 0.95 });
    const watch = triMaterial({ color: 0x151515, nmap: T.stipple.normalMap, scale: 30, ns: 0.3, rough: 0.35 });
    const strap = triMaterial({ color: 0x23201c, nmap: T.clothN.normalMap, scale: 20, ns: 1, rough: 0.8 });
    const face = new THREE.MeshPhysicalMaterial({ color: 0x0a0c0c, emissive: new THREE.Color(0.25, 0.9, 0.5), emissiveIntensity: 0.25, roughness: 0.05, clearcoat: 1 });
    this.arm = new THREE.SkinnedMesh(buildArms(), [sleeve, skin]);
    this.arm.add(bones[0]); this.arm.bind(skel);
    this.hands = new THREE.SkinnedMesh(buildGloves(), [glove, palm, pad, pad2, cuff, cuff2, watch, strap, face]);
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
      for (let i = 1; i <= 4; i++) { const sm = new THREE.SkinnedMesh(hg, hairShell(i, 4)); sm.bind(skel); sm.frustumCulled = false; this.group.add(sm); }
    }
    root.add(this.group);
    this.side = { L: { hand: this.bones.handL }, R: { hand: this.bones.handR } };
    this.shoulder = { L: V(-0.21, -0.31, 0.17), R: V(0.21, -0.31, 0.17) };
  }

  // tgt: {p, q} (root 로컬), pose: hand.js 손 자세 (off = 쥔 물체 중심의 손 로컬 위치)
  updateSide(k, tgt, pose) {
    const s = k === 'L' ? 1 : -1, B = this.bones, G = GEO[k];
    this.root.updateWorldMatrix(true, false);
    const rq = this.root.getWorldQuaternion(new THREE.Quaternion());
    const P = tgt.p.clone().applyMatrix4(this.root.matrixWorld), Q = rq.clone().multiply(tgt.q);
    const along = V(0, 0, -1).applyQuaternion(Q), palm = V(k === 'R' ? -1 : 1, 0, 0).applyQuaternion(Q);
    const Qh = frameQuat(REST['along' + k], REST['palm' + k], along, palm);
    const o = pose.off, offW = G.d.clone().multiplyScalar(o[0]).addScaledVector(G.n, o[1]).addScaledVector(G.w, o[2]);
    const wrist = P.clone().sub(offW.applyQuaternion(Qh));
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
    applyHandPose((n) => B[n + k], pose, G);
  }
  setVisible(v) { this.group.visible = v; }
}

