// 1인칭 팔/손 (고해상도 SDF 조형 + 스키닝) — 긴소매 전투복, 전술 장갑(손가락 관절), 손목시계
import * as THREE from 'three';
import { SDFModel, ellipsoid, sphere, cone, rbox, torus, buildGeometry, smoothMesh, mergeParts } from './sdf.js';
import { SKEL, BI, triMaterial, frameQuat, setWorldQuat, n3 } from './human.js';
import { solveIK, clamp } from './core.js';
import { handBoneSpec, buildGloveLocal, toRest, applyHandPose } from './hand.js';
import { T } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FWD = V(0, 0, 1);
// 선분-선분 최단거리
const _d1 = V(0, 0, 0), _d2 = V(0, 0, 0), _r = V(0, 0, 0), _c1 = V(0, 0, 0), _c2 = V(0, 0, 0);
export function segSeg(p1, q1, p2, q2) {
  _d1.subVectors(q1, p1); _d2.subVectors(q2, p2); _r.subVectors(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s = 0, t = 0;
  if (a <= 1e-9 && e <= 1e-9) return p1.distanceTo(p2);
  if (a <= 1e-9) t = clamp(f / e, 0, 1);
  else {
    const c = _d1.dot(_r);
    if (e <= 1e-9) s = clamp(-c / a, 0, 1);
    else { const b = _d1.dot(_d2), den = a * e - b * b; s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0; t = (b * s + f) / e; if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); } }
  }
  _c1.copy(p1).addScaledVector(_d1, s); _c2.copy(p2).addScaledVector(_d2, t);
  return _c1.distanceTo(_c2);
}
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
    const S = new SDFModel(s > 0 ? [-0.02, 0.9, -0.1] : [-0.62, 0.9, -0.1], s > 0 ? [0.62, 1.52, 0.1] : [0.02, 1.52, 0.1], 0.0036);
    const { sh, el, wr } = GEO[k], ua = VBI['uarm' + k], fa = VBI['farm' + k];
    const lerpP = (a, b, t) => a.clone().lerp(b, t).toArray();
    // 긴소매 전투복: 어깨 뒤로 길게 이어져(화면에 끝단이 보이지 않게) → 상완 → 팔꿈치 주름 → 전완 → 소매 끝(장갑 커프 속으로)
    const back = sh.clone().addScaledVector(el.clone().sub(sh).normalize(), -0.22);
    S.add(cone(back.toArray(), sh.toArray(), 0.06, 0.058, { bone: ua, mat: 'sleeve', k: 0.02 }));
    S.add(cone(sh.toArray(), el.toArray(), 0.058, 0.049, { bone: [ua, fa], seg: [sh.toArray(), el.toArray()], blend: [0.8, 1.02], mat: 'sleeve', k: 0.02, disp: folds(0.004, 0.14, 0.9, 0.2), dispMax: 0.006 }));
    S.add(cone(el.toArray(), lerpP(el, wr, 0.86), 0.049, 0.039, { bone: [ua, fa], seg: [el.toArray(), wr.toArray()], blend: [-0.1, 0.12], mat: 'sleeve', k: 0.015, disp: folds(0.0035, 0.1, 0.12, 0.3), dispMax: 0.006 }));
    // 전완 근육 볼륨 (소매 속)
    const m1 = el.clone().lerp(wr, 0.3).addScaledVector(GEO[k].w, 0.008).addScaledVector(GEO[k].n, -0.006);
    S.add(ellipsoid(m1.toArray(), [0.05, 0.044, 0.04], { bone: fa, mat: 'sleeve', k: 0.03, rot: [0, 0, -s * Math.PI / 4] }));
    // 소매 끝단 밑단
    S.add(torus(lerpP(el, wr, 0.84), 0.038, 0.004, { bone: fa, mat: 'sleeve', k: 0.004, rot: [0, 0, s * Math.PI / 4] }));
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

export class Arms {
  constructor(root) {
    this.root = root;
    const bones = VB.map((b) => { const x = new THREE.Bone(); x.name = b.name; return x; });
    VB.forEach((b, i) => { if (b.parent < 0) bones[i].position.copy(b.p); else { bones[b.parent].add(bones[i]); bones[i].position.copy(b.p).sub(VB[b.parent].p); } });
    this.bones = Object.fromEntries(bones.map((b) => [b.name, b]));
    const skel = new THREE.Skeleton(bones);
    const cam = T.multicam;
    const sleeve = triMaterial({ map: cam.map, nmap: T.clothN.normalMap, scale: 3.4, ns: 1.6, rough: 0.95, vcol: true, sheen: 0.5, side: THREE.DoubleSide });
    const skin = triMaterial({ nmap: T.skinN.normalMap, map: T.skinN.map, scale: 30, ns: 0.8, rough: 0.5, vcol: true, sheen: 0.15, skin: 1 });
    const glove = triMaterial({ color: 0x74604a, map: T.glove.map, nmap: T.glove.normalMap, scale: 11, ns: 1.5, rough: 0.78, sheen: 0.12, env: 0.55 });
    const palm = triMaterial({ color: 0x4a4339, map: T.glove.map, nmap: T.stipple.normalMap, scale: 30, ns: 0.9, rough: 0.88, sheen: 0.2, env: 0.55 });
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
    root.add(this.group);
    this.side = { L: { hand: this.bones.handL }, R: { hand: this.bones.handR } };
    this.pen = { L: 0, R: 0 }; this.penDir = { L: V(0, 0, 0), R: V(0, 0, 0) };
    this.shoulder = { L: V(-0.21, -0.31, 0.17), R: V(0.21, -0.31, 0.17) };
  }

  // tgt: {p, q} (root 로컬), pose: hand.js 손 자세 (off = 쥔 물체 중심의 손 로컬 위치)
  // obst: [{a, b, r}] (월드 캡슐, 개머리판 등) — 팔이 총을 관통하지 않도록 팔꿈치 방향(폴)을 돌려 피함
  updateSide(k, tgt, pose, obst = null) {
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
    if (obst && obst.length) {
      // 손목 쪽 25%는 손잡이에 맞닿는 게 정상이므로 제외
      const W3 = V(0, 0, 0), sp = V(0, 0, 0), sdf = obst.sdf;
      const pen = (S0, E) => {
        W3.copy(E).lerp(wrist, 0.75); let p = 0;
        for (const o of obst) { p = Math.max(p, 0.056 + o.r - segSeg(S0, E, o.a, o.b), 0.045 + o.r - segSeg(E, W3, o.a, o.b)); }
        // 총 전체 표면: 전완(손목 쪽 20% 제외)·상완(어깨 쪽 절반) 표본점
        if (sdf) {
          for (const t of [0.15, 0.35, 0.55, 0.72]) p = Math.max(p, 0.042 - sdf(sp.copy(E).lerp(wrist, t)));
          for (const t of [0.55, 0.8, 1.0]) p = Math.max(p, 0.05 - sdf(sp.copy(S0).lerp(E, t)));
        }
        return p;
      };
      let bp = pen(S, elbow);
      if (bp > 0) {
        const ax = wrist.clone().sub(sh).normalize(), best = { c: bp * 10, e: elbow.clone(), s: S.clone() };
        for (const ang of [0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1.0, -1.0, 1.3, -1.3, 1.6, -1.6]) {
          const S2 = sh.clone(), E2 = V(0, 0, 0), pl = pole.clone().applyAxisAngle(ax, ang);
          solveIK(S2, wrist, 0.295, 0.255, pl, E2);
          const c = pen(S2, E2) * 10 + Math.abs(ang) * 0.004;
          if (c < best.c) { best.c = c; best.e.copy(E2); best.s.copy(S2); }
        }
        elbow.copy(best.e); S.copy(best.s);
      }
      // 남은 관통(방향 포함) → 총 위치 보정용 피드백 (Weapons 가 다음 프레임에 총을 그만큼 밀어냄)
      W3.copy(elbow).lerp(wrist, 0.75); let wp = 0; const dir = V(0, 0, 0);
      for (const o of obst) for (const [A0, B0, r0] of [[S, elbow, 0.056], [elbow, W3, 0.045]]) {
        const pp = r0 + o.r - segSeg(A0, B0, o.a, o.b);
        if (pp > wp) { wp = pp; dir.subVectors(_c2, _c1).normalize(); }
      }
      if (sdf) for (const t of [0.15, 0.35, 0.55, 0.72]) {
        const q = V(0, 0, 0).copy(elbow).lerp(wrist, t), pp = 0.042 - sdf(q);
        if (pp > wp) { wp = pp; const h = 0.01; dir.set(sdf(V(q.x + h, q.y, q.z)) - sdf(V(q.x - h, q.y, q.z)), sdf(V(q.x, q.y + h, q.z)) - sdf(V(q.x, q.y - h, q.z)), sdf(V(q.x, q.y, q.z + h)) - sdf(V(q.x, q.y, q.z - h))).normalize().negate(); }
      }
      this.pen[k] = wp; this.penDir[k].copy(dir);
    } else { this.pen[k] = 0; }
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

