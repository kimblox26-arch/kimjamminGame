// 사람: 래그돌 물리 + 근육(자세 유지) + 해부(장기·뼈·근육) + 상처·출혈 + 감정·표정 + NPC 행동
// 플레이어와 NPC 가 같은 클래스를 쓴다.
import * as THREE from 'three';
import { Particle, Constraint, rayCapsuleSpan } from './physics.js';
import { Arm, hingeFrame } from './arm.js';
import * as A from './anatomy.js';

const V = THREE.Vector3, M4 = THREE.Matrix4, Qt = THREE.Quaternion;
export const PI_ = { head: 0, neck: 1, chest: 2, belly: 3, pelvis: 4, lSh: 5, lEl: 6, lHa: 7, rSh: 8, rEl: 9, rHa: 10, lHip: 11, lKn: 12, lFt: 13, rHip: 14, rKn: 15, rFt: 16 };
const RAD = [0.1, 0.06, 0.125, 0.115, 0.115, 0.06, 0.045, 0.045, 0.06, 0.045, 0.045, 0.08, 0.06, 0.05, 0.08, 0.06, 0.05];
const MASS = [5, 2, 14, 10, 12, 3, 2, 1, 3, 2, 1, 7, 4, 1.5, 7, 4, 1.5];
const BUOY = [1.05, 1, 1.3, 1.15, 1.1, 0.95, 0.9, 0.9, 0.95, 0.9, 0.9, 1, 0.95, 0.9, 1, 0.95, 0.9];
const K0 = [0.1, 0.1, 0.14, 0.14, 0.18, 0.12, 0.08, 0.14, 0.12, 0.08, 0.14, 0.14, 0.1, 0.35, 0.14, 0.1, 0.35];
export const P2PART = ['head', 'neck', 'chest', 'belly', 'pelvis', 'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
export const PART = {
  head: { label: '머리', bone: 'head', mult: 4, pts: [0], boneName: '두개골' },
  neck: { label: '목', bone: 'neck', mult: 2.4, pts: [1, 0], boneName: '목뼈', artery: 1 },
  chest: { label: '가슴', bone: 'chest', mult: 1.4, pts: [2, 5, 8], boneName: '갈비뼈' },
  belly: { label: '배', bone: 'belly', mult: 1.1, pts: [3], boneName: '허리뼈' },
  pelvis: { label: '골반', bone: 'pelvis', mult: 1, pts: [4, 11, 14], boneName: '골반뼈' },
  upperArmL: { label: '왼쪽 위팔', arm: 'L', bi: 0, mult: 0.55, pts: [5, 6], boneName: '왼쪽 위팔뼈' },
  foreArmL: { label: '왼쪽 아래팔', arm: 'L', bi: 1, mult: 0.45, pts: [6, 7], boneName: '왼쪽 아래팔뼈' },
  handL: { label: '왼손', arm: 'L', bi: 2, mult: 0.35, pts: [7], boneName: '왼손뼈' },
  upperArmR: { label: '오른쪽 위팔', arm: 'R', bi: 0, mult: 0.55, pts: [8, 9], boneName: '오른쪽 위팔뼈' },
  foreArmR: { label: '오른쪽 아래팔', arm: 'R', bi: 1, mult: 0.45, pts: [9, 10], boneName: '오른쪽 아래팔뼈' },
  handR: { label: '오른손', arm: 'R', bi: 2, mult: 0.35, pts: [10], boneName: '오른손뼈' },
  thighL: { label: '왼쪽 허벅지', bone: 'thighL', mult: 0.7, pts: [11, 12], boneName: '왼쪽 넙다리뼈', artery: 1, leg: 1 },
  shinL: { label: '왼쪽 종아리', bone: 'shinL', mult: 0.5, pts: [12, 13], boneName: '왼쪽 정강이뼈', leg: 1 },
  footL: { label: '왼발', bone: 'footL', mult: 0.3, pts: [13], boneName: '왼발뼈' },
  thighR: { label: '오른쪽 허벅지', bone: 'thighR', mult: 0.7, pts: [14, 15], boneName: '오른쪽 넙다리뼈', artery: 1, leg: 1 },
  shinR: { label: '오른쪽 종아리', bone: 'shinR', mult: 0.5, pts: [15, 16], boneName: '오른쪽 정강이뼈', leg: 1 },
  footR: { label: '오른발', bone: 'footR', mult: 0.3, pts: [16], boneName: '오른발뼈' },
};
const WOUND = { // type: 0 총알 입구 1 베임 2 타박 3 화상 4 찔림 5 총알 출구 6 으깨짐
  bullet: { t: 0, r: 0.0075, bleed: 0.012 }, exit: { t: 5, r: 0.016, bleed: 0.02 }, pellet: { t: 0, r: 0.0055, bleed: 0.007 },
  cut: { t: 1, r: 0.006, bleed: 0.02, len: 0.045 }, saw: { t: 1, r: 0.014, bleed: 0.05, len: 0.075 }, stab: { t: 4, r: 0.009, bleed: 0.025 },
  blunt: { t: 2, r: 0.04, bleed: 0 }, burn: { t: 3, r: 0.028, bleed: 0 }, crush: { t: 6, r: 0.06, bleed: 0.04 }, blast: { t: 6, r: 0.045, bleed: 0.03 },
  spike: { t: 4, r: 0.012, bleed: 0.03 }, impact: { t: 2, r: 0.05, bleed: 0 },
};
const LINES = {
  fear: ['쏘지 마세요!', '제발... 살려주세요', '잠깐! 무기 내려요!', '원하는 게 뭐예요...?'],
  pain: ['으아아악!!', '아아악!', '악!! 아파!!', '크윽...!'],
  flee: ['누가 좀 도와줘요!!', '사람 살려!!', '오지 마!!'],
  hurt: ['피가... 멈추질 않아...', '숨을... 못 쉬겠어...', '엄마...', '제발... 그만...'],
  water: ['읍...! 살려...!', '컥... 숨이...!'],
  calm: ['...', '여긴 어디지?', '흠...'],
};
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const pick = a => a[Math.floor(Math.random() * a.length)];
const _a = new V(), _b = new V(), _c = new V(), _d = new V(), _h = new V(), _y = new V(), _m = new M4(), _m2 = new M4(), _q = new Qt(), _q2 = new Qt();
const UP = new V(0, 1, 0), _e = new THREE.Euler();

export function ik2(a, c, l1, l2, pole, outE, outC) {
  const d = _a.subVectors(c, a); let L = d.length();
  if (L < 1e-6) { d.set(0, -1, 0); L = 1e-6; } else d.divideScalar(L);
  L = Math.min(Math.max(L, Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.004);
  const al = (l1 * l1 - l2 * l2 + L * L) / (2 * L), h = Math.sqrt(Math.max(0, l1 * l1 - al * al));
  const p = _b.copy(pole).addScaledVector(d, -pole.dot(d)); if (p.lengthSq() < 1e-8) p.set(0, 0, 1); p.normalize();
  outE.copy(a).addScaledVector(d, al).addScaledVector(p, h);
  if (outC) outC.copy(a).addScaledVector(d, L);
}

export class Human {
  constructor(G, armAsset, { name, isPlayer = false, shorts = 0x3b3f46, voice = 1 }) {
    this.G = G; this.name = name; this.isPlayer = isPlayer; this.voice = voice;
    this.group = new THREE.Group(); G.scene.add(this.group);
    // 피부 재질 (몸·머리·팔 각각: 상처 목록이 따로)
    const detail = G.skinDetail;
    this.mats = { body: A.skinMaterial({ detail }), head: A.skinMaterial({ detail }),
      armL: A.skinMaterial({ map: armAsset.map, normalMap: armAsset.normalMap, orm: armAsset.orm }), armR: A.skinMaterial({ map: armAsset.map, normalMap: armAsset.normalMap, orm: armAsset.orm }) };
    this.arms = { L: new Arm(armAsset, 'L', this.mats.armL), R: new Arm(armAsset, 'R', this.mats.armR) };
    const lenU = this.arms.L.lenU, lenF = this.arms.L.lenF;
    this.lenU = lenU; this.lenF = lenF; this.lenT = 0.427; this.lenS = 0.432;
    // 휴지 자세 (몸 기준, +Z 앞, +X 왼쪽)
    const R = this.REST = {};
    R.head = new V(0, 1.665, 0.01); R.neck = new V(0, 1.5, -0.012); R.chest = new V(0, 1.31, 0); R.belly = new V(0, 1.12, 0); R.pelvis = new V(0, 0.95, -0.01);
    for (const s of [1, -1]) {
      const k = s > 0 ? 'l' : 'r';
      R[k + 'Sh'] = new V(s * 0.175, 1.445, -0.015);
      R[k + 'El'] = R[k + 'Sh'].clone().addScaledVector(new V(s * 0.04, -1, -0.05).normalize(), lenU);
      R[k + 'Ha'] = R[k + 'El'].clone().addScaledVector(new V(s * 0.02, -1, 0.12).normalize(), lenF);
      R[k + 'Hip'] = new V(s * 0.092, 0.94, 0); R[k + 'Kn'] = new V(s * 0.1, 0.515, 0.022); R[k + 'Ft'] = new V(s * 0.105, 0.085, -0.012);
    }
    this.RP = Object.keys(PI_).map(k => R[k]);
    this.lenT = R.lHip.distanceTo(R.lKn); this.lenS = R.lKn.distanceTo(R.lFt);
    // 입자·제약
    this.particles = this.RP.map((p, i) => { const q = new Particle(p, RAD[i], MASS[i]); q.buoy = BUOY[i]; q.owner = this; q.idx = i; return q; });
    const P = this.particles, c = [];
    const D = (a, b, k = 1) => { const L = P[a].p.distanceTo(P[b].p); c.push(new Constraint(P[a], P[b], L, L, k)); };
    const Rg = (a, b, lo, hi, k = 1) => { const L = P[a].p.distanceTo(P[b].p); c.push(new Constraint(P[a], P[b], L * lo, L * hi, k)); };
    D(4, 3); D(3, 2); D(2, 1); D(1, 0);
    D(5, 8); D(5, 1); D(8, 1); D(5, 2); D(8, 2); D(5, 3, 0.6); D(8, 3, 0.6);
    D(11, 14); D(11, 4); D(14, 4); D(11, 3, 0.7); D(14, 3, 0.7);
    Rg(2, 4, 0.82, 1.03); Rg(1, 3, 0.85, 1.02); Rg(0, 2, 0.8, 1.01); Rg(5, 11, 0.85, 1.05); Rg(8, 14, 0.85, 1.05); Rg(5, 14, 0.88, 1.08); Rg(8, 11, 0.88, 1.08);
    Rg(0, 5, 0.75, 1.15); Rg(0, 8, 0.75, 1.15);
    for (const [s, e, h] of [[5, 6, 7], [8, 9, 10]]) { D(s, e); D(e, h); c.push(new Constraint(P[s], P[h], 0.12, lenU + lenF - 0.004)); }
    for (const [h, k, f] of [[11, 12, 13], [14, 15, 16]]) { D(h, k); D(k, f); c.push(new Constraint(P[h], P[f], 0.25, this.lenT + this.lenS - 0.004)); }
    this.constraints = c;
    this.selfPairs = [];
    for (const a of [6, 7, 9, 10]) for (const b of [2, 3, 4, 0]) this.selfPairs.push([a, b]);
    this.selfPairs.push([12, 15], [13, 16], [7, 10]);

    // 뼈 좌표계 (휴지)
    this.BONES = A.BODY_BONES;
    this.frame = {}; this.BM = {}; this.invRest = {};
    for (const b of this.BONES) { this.frame[b] = new M4(); this.BM[b] = new M4(); }
    this.prevH = { L: new V(-1, 0, 0), R: new V(-1, 0, 0) };
    this.look = { yaw: 0, pitch: 0 }; this.muscle = 1; this.footFlat = 1; this.rootYaw = 0;
    this.computeFrames(this.RP, true);
    for (const b of this.BONES) this.invRest[b] = this.frame[b].clone().invert();

    // 메시: 몸통·다리(스킨), 반바지, 팔, 머리
    this.bones = this.BONES.map(() => { const b = new THREE.Bone(); b.matrixAutoUpdate = false; return b; });
    const skel = new THREE.Skeleton(this.bones, this.bones.map(() => new M4()));
    const bodyGeo = A.buildBody(R);
    this.body = new THREE.SkinnedMesh(bodyGeo, this.mats.body); this.body.bind(skel, new M4());
    const shortsMat = new THREE.MeshStandardMaterial({ color: shorts, roughness: 0.85, envMapIntensity: 0.4 });
    this.shorts = new THREE.SkinnedMesh(A.buildBody(R, { inflate: 0.007, part: 'shorts' }), shortsMat); this.shorts.bind(skel, new M4());
    for (const m of [this.body, this.shorts, this.arms.L.mesh, this.arms.R.mesh]) { m.frustumCulled = false; m.castShadow = m.receiveShadow = true; this.group.add(m); }
    this.skel = skel;
    // 뼈 객체 (내부 구조·머리가 붙는 곳)
    this.bo = {};
    for (const b of this.BONES) { const o = new THREE.Object3D(); o.matrixAutoUpdate = false; this.group.add(o); this.bo[b] = o; }
    for (const s of ['L', 'R']) this.arms[s].objs.forEach(o => this.group.add(o));
    const head = new THREE.Mesh(A.headGeometry(R.head.clone().add(new V(0, 0.002, 0.004))), this.mats.head);
    head.castShadow = head.receiveShadow = true; this.bo.head.add(head); this.headMesh = head;
    const { face, F } = A.buildFace(R.head.clone().add(new V(0, 0.002, 0.004)), this.mats.head);
    this.bo.head.add(face); this.face = F;
    // 엑스레이: 피부는 유령처럼, 내부(뼈·장기·근육)는 엑스레이 화면에만
    const ghost = A.xrayMaterial(0x9fd8ff, { solid: 0.0, rim: 3, power: 0.35 });
    const ghostS = A.xrayMaterial(0x9fd8ff, { solid: 0.0, rim: 3, power: 0.35 });
    for (const m of [this.body, this.arms.L.mesh, this.arms.R.mesh]) { m.layers.enable(1); G.xraySwap.push({ mesh: m, x: ghostS }); }
    head.layers.enable(1); G.xraySwap.push({ mesh: head, x: ghost });
    this.xr = { bones: [], organs: [], muscles: [], wounds: [] };
    const addX = (parent, geo, color, cat, opt) => { if (!geo) return null; const m = new THREE.Mesh(geo, A.xrayMaterial(color, opt)); m.layers.set(1); m.frustumCulled = false; parent.add(m); this.xr[cat].push(m); return m; };
    this.boneMesh = {};
    const sk = A.skeletonGeometries(R);
    for (const b in sk) this.boneMesh[b] = addX(this.bo[b], sk[b], 0xeaf4ff, 'bones', { solid: 0.35, rim: 1.5, power: 0.9 });
    const mu = A.muscleGeometries();
    for (const b in mu) addX(this.bo[b], mu[b], 0xff5040, 'muscles', { solid: 0.08, rim: 2, power: 0.45 });
    for (const s of ['L', 'R']) {
      const arm = this.arms[s];
      A.armBoneGeometries(arm).forEach((g, i) => { const m = addX(arm.objs[i], g, 0xeaf4ff, 'bones', { solid: 0.35, rim: 1.5, power: 0.9 }); if (i < 3) this.boneMesh[['upperArm', 'foreArm', 'hand'][i] + s] = m; });
      A.armMuscleGeometries(arm).forEach((g, i) => addX(arm.objs[i], g, 0xff5040, 'muscles', { solid: 0.08, rim: 2, power: 0.45 }));
    }
    this.organs = {};
    for (const o of A.ORGANS) {
      const geo = A.organGeometry(o);
      const col = new THREE.Color(A.ORGAN_COLORS[o.id]).lerp(new THREE.Color(1, 0.6, 0.5), 0.35);
      const m = addX(this.bo[o.bone], geo, col, 'organs', { solid: 0.3, rim: 1.6, power: 0.8 });
      this.organs[o.id] = { def: o, mesh: m, geo, hp: 100, out: false, c: new V(...o.c), r: new V(...o.r) };
    }
    // 맞는 범위 (캡슐, 뼈 바인드 좌표)
    const v = (x, y, z) => new V(x, y, z);
    this.caps = [
      ['head', v(0, 1.6, 0.014), v(0, 1.725, 0.0), 0.092], ['neck', v(0, 1.49, -0.012), v(0, 1.585, 0), 0.056],
      ['chest', v(-0.075, 1.32, 0), v(0.075, 1.32, 0), 0.125], ['chest', v(-0.12, 1.405, -0.01), v(0.12, 1.405, -0.01), 0.085],
      ['belly', v(-0.05, 1.135, 0), v(0.05, 1.135, 0), 0.112], ['pelvis', v(-0.07, 0.95, -0.012), v(0.07, 0.95, -0.012), 0.115],
    ];
    for (const s of [1, -1]) {
      const k = s > 0 ? 'L' : 'R', arm = this.arms[k];
      this.caps.push(['thigh' + k, R[(s > 0 ? 'l' : 'r') + 'Hip'], R[(s > 0 ? 'l' : 'r') + 'Kn'], 0.078], ['shin' + k, R[(s > 0 ? 'l' : 'r') + 'Kn'], R[(s > 0 ? 'l' : 'r') + 'Ft'].clone().add(v(0, 0.03, 0)), 0.056],
        ['foot' + k, v(s * 0.106, 0.045, -0.04), v(s * 0.115, 0.03, 0.15), 0.04],
        ['upperArm' + k, arm.S, arm.E, 0.048], ['foreArm' + k, arm.E, arm.W, 0.041], ['hand' + k, arm.W, arm.J[9], 0.042]);
    }
    this.target = this.RP.map(p => p.clone()); this.K = new Float32Array(17); this.snap = this.RP.map(p => p.clone());
    this.Lp = this.RP.map(p => p.clone());
    this.wounds = []; this.channels = []; this.gibs = [];
    G.physics.add(this);
    this.reset(new V(), 0);
  }

  // ───────── 상태 초기화 (살아나기) ─────────
  reset(pos, yaw) {
    this.root = pos.clone(); this.rootYaw = yaw; this.vel = new V(); this.moveSpeed = 0; this.phase = 0;
    this.hp = 100; this.blood = 5; this.oxygen = 1; this.pain = 0; this.fear = 0; this.panic = 0; this.stun = 0; this.shock = 0;
    this.dead = false; this.conscious = true; this.cause = ''; this.state = 'stand'; this.downT = 0; this.getupT = 0; this.flinch = 0;
    this.heartStop = 0; this.broken = {}; this.partDmg = {}; this.recent = {}; this.muscle = 1; this.spasm = 0; this.swim = false;
    this.screamCd = 0; this.moanT = 2; this.sayCd = 0; this.blinkT = 2; this.blink = 0; this.hurtT = 0; this.emotion = '평온';
    this.ai = { mode: 'idle', t: 0, target: null, stuck: 0, last: new V() };
    this.ctrl = { move: new V(), yaw, run: false };
    this.hold = null; this.clutch = null; this.surrender = 0; this.mouth = 0; this.scream = 0; this.impactCd = new Float32Array(17);
    for (const o of Object.values(this.organs)) { o.hp = 100; o.out = false; o.mesh.visible = true; o.mesh.material.uniforms.uFlash.value = 0; }
    for (const m of Object.values(this.boneMesh)) if (m) m.material.uniforms.uFlash.value = 0;
    for (const ch of this.channels) { ch.parent?.remove(ch); ch.geometry.dispose(); }
    this.channels = []; this.wounds = [];
    for (const g of this.gibs) this.G.fx.removeGib(g);
    this.gibs = [];
    for (const m of Object.values(this.mats)) { m.userData.U.uN.value = 0; m.userData.U.uPale.value = 0; m.userData.U.uBloody.value = 0; }
    _m.makeRotationY(yaw);
    this.particles.forEach((p, i) => { p.setPos(_a.copy(this.RP[i]).applyMatrix4(_m).add(pos)); });
    this.arms.L.handOverride = this.arms.R.handOverride = null;
    this.updateVisual(0);
  }

  // ───────── 좌표계 ─────────
  computeFrames(P, rest) {
    const F = this.frame;
    const side = _a.subVectors(P[5], P[8]), hips = _b.subVectors(P[11], P[14]);
    hingeFrame(F.pelvis, P[4], _y.subVectors(P[3], P[4]).normalize(), hips);
    hingeFrame(F.belly, P[3], _y.subVectors(P[2], P[3]).normalize(), _h.addVectors(side, hips));
    hingeFrame(F.chest, P[2], _y.subVectors(P[1], P[2]).normalize(), side);
    hingeFrame(F.neck, P[1], _y.subVectors(P[0], P[1]).normalize(), side);
    hingeFrame(F.head, P[0], _y, side);
    for (const [k, h, kn, f] of [['L', 11, 12, 13], ['R', 14, 15, 16]]) {
      const H = _h.crossVectors(_c.subVectors(P[h], P[kn]), _d.subVectors(P[f], P[kn]));
      if (H.lengthSq() < 1e-6) H.copy(this.prevH[k]); else { H.normalize(); this.prevH[k].copy(H); }
      hingeFrame(F['thigh' + k], P[h], _y.subVectors(P[h], P[kn]).normalize(), H);
      hingeFrame(F['shin' + k], P[kn], _y.subVectors(P[kn], P[f]).normalize(), H);
      F['foot' + k].makeTranslation(P[f].x, P[f].y, P[f].z);
    }
    if (rest) return;
    for (const b of this.BONES) this.BM[b].multiplyMatrices(this.frame[b], this.invRest[b]);
    // 머리 돌리기 (살아 있을 때)
    _q.setFromEuler(_e.set(-this.look.pitch * this.muscle, this.look.yaw * this.muscle, 0, 'YXZ'));
    this.BM.head.multiplyMatrices(this.frame.head, _m.makeRotationFromQuaternion(_q)).multiply(this.invRest.head);
    // 발: 서 있으면 바닥과 평평, 쓰러지면 정강이를 따라감
    for (const [k, f] of [['L', 13], ['R', 16]]) {
      _q.setFromRotationMatrix(this.BM['shin' + k]);
      _q2.setFromAxisAngle(UP, this.rootYaw);
      _q.slerp(_q2, this.footFlat);
      const ra = this.RP[f], pa = P[f];
      this.BM['foot' + k].makeRotationFromQuaternion(_q);
      _c.copy(ra).applyQuaternion(_q);
      this.BM['foot' + k].setPosition(pa.x - _c.x, pa.y - _c.y, pa.z - _c.z);
    }
  }
  boneMat(part) { const d = PART[part]; return d.arm ? this.arms[d.arm].mat[d.bi] : this.BM[d.bone]; }
  boneObj(part) { const d = PART[part]; return d.arm ? this.arms[d.arm].objs[d.bi] : this.bo[d.bone]; }
  center(out = new V()) { return out.copy(this.particles[2].p); }

  // ───────── 물리 훅 ─────────
  preSolve(h) {
    const m = this.muscle;
    if (m <= 0.001 && !this.spasm) return;
    const P = this.particles;
    for (let i = 0; i < 17; i++) {
      const k = this.K[i] * m;
      if (k <= 0) continue;
      const p = P[i].p, t = this.target[i];
      p.x += (t.x - p.x) * k; p.y += (t.y - p.y) * k; p.z += (t.z - p.z) * k;
      P[i].o.lerp(p, 0.02 * m);
    }
    if (this.spasm > 0) for (const p of P) p.acc.set((Math.random() - 0.5) * 160, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 160).multiplyScalar(this.spasm);
  }
  innerSolve(it) {
    const P = this.particles;
    if (it % 2) return;
    for (const [a, b] of this.selfPairs) {
      const A_ = P[a], B = P[b]; _a.subVectors(B.p, A_.p);
      const r = A_.r + B.r * 0.9, d2 = _a.lengthSq();
      if (d2 >= r * r || d2 < 1e-10) continue;
      const d = Math.sqrt(d2), s = (r - d) / (d * (A_.w + B.w));
      A_.p.addScaledVector(_a, -s * A_.w); B.p.addScaledVector(_a, s * B.w);
    }
    // 무릎은 앞으로, 팔꿈치는 뒤로만 굽는다
    if (this.muscle < 0.6) {
      hingeFrame(_m, P[4].p, _y.subVectors(P[3].p, P[4].p).normalize(), _b.subVectors(P[11].p, P[14].p));
      const fw = _c.setFromMatrixColumn(_m, 2);
      for (const [h, k, f] of [[11, 12, 13], [14, 15, 16]]) {
        const mid = _d.addVectors(P[h].p, P[f].p).multiplyScalar(0.5); const off = _h.subVectors(P[k].p, mid).dot(fw);
        if (off < 0.015) { const e = Math.min(0.015 - off, 0.003); P[k].p.addScaledVector(fw, e * 0.5); P[h].p.addScaledVector(fw, -e * 0.25); P[f].p.addScaledVector(fw, -e * 0.25); }
      }
      hingeFrame(_m, P[2].p, _y.subVectors(P[1].p, P[2].p).normalize(), _b.subVectors(P[5].p, P[8].p));
      fw.setFromMatrixColumn(_m, 2);
      for (const [s, e, w] of [[5, 6, 7], [8, 9, 10]]) {
        const mid = _d.addVectors(P[s].p, P[w].p).multiplyScalar(0.5); const off = _h.subVectors(P[e].p, mid).dot(fw);
        if (off > -0.01) { const k = Math.min(off + 0.01, 0.003); P[e].p.addScaledVector(fw, -k * 0.5); P[s].p.addScaledVector(fw, k * 0.2); P[w].p.addScaledVector(fw, k * 0.3); }
      }
    }
  }
  onImpact(pt, speed, n) {
    if (speed < 6.5 || this.impactCd[pt.idx] > 0) return;
    this.impactCd[pt.idx] = 0.25;
    const part = P2PART[pt.idx], dmg = (speed - 6.5) * 7;
    this.G.queue.push(() => this.hit({ part, type: 'impact', dmg, point: pt.p.clone().addScaledVector(n, -pt.r), dir: n.clone().negate(), noImpulse: true }));
  }

  // ───────── 자세 목표 ─────────
  computeTargets(dt) {
    const L = this.Lp, R = this.REST;
    for (let i = 0; i < 17; i++) L[i].copy(this.RP[i]);
    const s = this.moveSpeed, amp = Math.min(1, s / 1.1), run = sstep(2.2, 3.4, s);
    const swim = this.swim;
    const stride = Math.min(0.95, 0.22 + s * 0.27);
    this.phase += dt * Math.PI * s / Math.max(0.35, stride);
    const t = this.G.time;
    const breath = Math.sin(t * (1.4 + this.fear * 2)) * 0.004;
    const crouch = this.surrender * 0.05 + (this.fear > 0.6 && !this.ai.flee ? 0.03 : 0);
    const bob = swim ? 0 : -0.022 * amp * (1 - Math.cos(2 * this.phase)) / 2 - crouch;
    const lean = swim ? 0.5 : 0.06 * amp + 0.2 * run + this.surrender * 0.06;
    const tremble = this.fear > 0.5 && !this.dead ? (this.fear - 0.5) * 0.012 : 0;
    // 상체
    for (const i of [0, 1, 2, 3, 5, 6, 7, 8, 9, 10]) {
      const p = L[i]; p.y += bob + (i <= 2 || i === 5 || i === 8 ? breath : 0);
      const dy = p.y - (R.pelvis.y + bob), dz = p.z - R.pelvis.z;
      p.z = R.pelvis.z + dz * Math.cos(lean) + dy * Math.sin(lean); p.y = R.pelvis.y + bob + dy * Math.cos(lean) - dz * Math.sin(lean);
      if (tremble) { p.x += (Math.random() - 0.5) * tremble; p.y += (Math.random() - 0.5) * tremble; }
    }
    L[4].y += bob; L[11].y += bob; L[14].y += bob;
    // 다리
    const poleK = _c.set(0, 0, 1);
    for (const [k, h, kn, f, ph] of [['l', 11, 12, 13, 0], ['r', 14, 15, 16, Math.PI]]) {
      const phi = this.phase + ph, ft = L[f];
      if (swim) { ft.set(L[h].x * 1.3, L[h].y - 0.75, -0.35 + Math.sin(t * 7 + ph) * 0.12); }
      else {
        ft.z = R[k + 'Ft'].z + Math.sin(phi) * stride * 0.5 * amp;
        ft.y = R[k + 'Ft'].y + Math.max(0, Math.cos(phi)) * (0.07 + 0.1 * run) * amp;
      }
      ik2(L[h], ft, this.lenT, this.lenS, poleK, L[kn], ft);
    }
    // 팔 (기본: 흔들기)
    for (const [k, sh, el, ha, ph, sg] of [['l', 5, 6, 7, Math.PI, 1], ['r', 8, 9, 10, 0, -1]]) {
      const phi = this.phase + ph;
      const hand = _d.copy(L[sh]);
      if (swim) hand.add(_a.set(sg * (0.3 + 0.12 * Math.cos(t * 3 + ph)), -0.1, 0.35 + 0.15 * Math.sin(t * 3 + ph)));
      else hand.add(_a.set(sg * 0.035, -(this.lenU + this.lenF) * (0.97 - 0.32 * run), Math.sin(phi) * 0.2 * amp + 0.06 + 0.18 * run));
      ik2(L[sh], hand, this.lenU, this.lenF, _b.set(sg * 0.4, -0.2, -1), L[el], L[ha]);
    }
    // 몸 좌표 → 월드
    _m.makeRotationY(this.rootYaw).setPosition(this.root);
    for (let i = 0; i < 17; i++) this.target[i].copy(L[i]).applyMatrix4(_m);
    // 손: 무기 / 항복 / 상처 누르기
    const handsOverride = (k, sh, el, ha, sg) => {
      const arm = this.arms[k === 'l' ? 'L' : 'R'];
      const hd = this.hold && this.hold[k === 'l' ? 'L' : 'R'];
      arm.handOverride = null;
      let tgt = null, pole = _b.set(0, -1, 0);
      if (hd) {
        arm.handMatrix(arm._hm || (arm._hm = new M4()), hd.F, hd.U, hd.grip);
        arm.handOverride = arm._hm;
        tgt = arm.wristOf(arm._hm, _d);
        pole.copy(hd.pole || _a.set(sg, -1, -0.3).applyAxisAngle(UP, this.rootYaw));
        arm.curl.forEach((c, f) => { const g = hd.curl[f]; c[0] = g[0]; c[1] = g[1]; c[2] = g[2]; });
      } else if (this.surrender > 0.05) {
        _a.set(sg * 0.28, 1.74 - crouch, 0.1).applyAxisAngle(UP, this.rootYaw).add(this.root);
        tgt = _d.lerpVectors(this.target[ha], _a, this.surrender);
        pole.set(sg * 1, -0.6, -0.4).applyAxisAngle(UP, this.rootYaw);
        arm.curl.forEach(c => { c[0] = c[1] = c[2] = 0.05; });
      } else if (this.clutch && k === this.clutch.side) {
        const w = this.clutch.w; tgt = this.woundWorld(w, _d);
        _a.subVectors(tgt, this.particles[2].p).normalize(); tgt.addScaledVector(_a, 0.05);
        pole.set(sg, -1, -0.5).applyAxisAngle(UP, this.rootYaw);
        arm.curl.forEach(c => { c[0] = 0.4; c[1] = 0.5; c[2] = 0.3; });
      } else arm.curl.forEach(c => { c[0] = 0.2; c[1] = 0.35; c[2] = 0.25; });
      if (tgt) { const S = this.target[sh]; ik2(S, tgt, this.lenU, this.lenF, pole, this.target[el], this.target[ha]); }
    };
    handsOverride('l', 5, 6, 7, 1); handsOverride('r', 8, 9, 10, -1);
    // 강성
    for (let i = 0; i < 17; i++) this.K[i] = K0[i];
    if (this.hold) { this.K[7] = this.K[10] = 0.35; this.K[6] = this.K[9] = 0.2; }
    for (const p in this.broken) { if (!this.broken[p]) continue; for (const i of PART[p].pts) if (PART[p].arm || PART[p].leg) this.K[i] *= 0.15; }
  }
  // 일어나기 중이면 쓰러진 자세 → 선 자세로 섞기
  blendGetup() {
    const e = sstep(0, 1, this.getupT);
    for (let i = 0; i < 17; i++) this.target[i].lerpVectors(this.snap[i], this.target[i], e);
  }

  // ───────── 매 프레임 ─────────
  update(dt) {
    if (dt <= 0) return;
    // 안전장치: 계산이 깨지면(NaN) 그 자리에서 다시 세운다
    if (!isFinite(this.particles[2].p.x + this.particles[0].p.y + this.root.x)) { const ok = isFinite(this.root.x) ? this.root.clone() : new V(); ok.y = 0; this.reset(ok, 0); }
    const G = this.G;
    this.time = G.time;
    for (let i = 0; i < 17; i++) this.impactCd[i] = Math.max(0, this.impactCd[i] - dt);
    for (const k in this.recent) this.recent[k] *= Math.exp(-dt * 1.5);
    this.life(dt);
    if (!this.isPlayer && !this.dead) this.think(dt);
    this.locomote(dt);
    this.computeTargets(dt);
    if (this.state === 'getup') this.blendGetup();
    // 근육 힘
    let mt = 0;
    if (this.dead || !this.conscious || this.state === 'down') mt = 0;
    else mt = this.state === 'getup' ? 0.25 + 0.75 * this.getupT : 1;
    if (this.stun > 0) mt *= 0.2;
    this.flinch = Math.max(0, this.flinch - dt * 2.5);
    mt *= 1 - this.flinch * 0.75;
    this.muscle += (mt - this.muscle) * Math.min(1, dt * (mt > this.muscle ? 4 : 12));
    this.footFlat += ((this.state === 'stand' && !this.swim ? 1 : 0) - this.footFlat) * Math.min(1, dt * 6);
    this.spasm = Math.max(0, this.spasm - dt * 2);
    // 넘어짐 판단
    const P = this.particles;
    if (this.state === 'stand') {
      const dev = P[4].p.distanceTo(this.target[4]), devH = P[0].p.distanceTo(this.target[0]);
      const legOut = this.broken.thighL || this.broken.thighR || this.broken.shinL || this.broken.shinR || this.broken.belly || this.broken.pelvis;
      if (!this.dead && this.conscious && !legOut && !this.swim && (dev > 0.33 || devH > 0.55)) this.fall(2 + Math.random() * 2);
      else if (this.dead || !this.conscious || legOut) this.fall(1e9);
    } else if (this.state === 'down') {
      this.downT -= dt;
      const legOut = this.broken.thighL || this.broken.thighR || this.broken.shinL || this.broken.shinR || this.broken.belly || this.broken.pelvis;
      const v = P[4].velocity(_a, G.physics.h).length();
      if (!this.dead && this.conscious && !legOut && this.downT <= 0 && v < 1.5 && !this.inWaterDeep()) this.startGetup();
      if (!this.dead && this.conscious && this.inWaterDeep() && v < 2.5) { this.startGetup(); this.swim = true; this.root.y = G.world.water.surface - 1.38; }
    } else if (this.state === 'getup') {
      this.getupT += dt / 1.3;
      if (this.getupT >= 1) this.state = 'stand';
      if (this.dead || !this.conscious) this.fall(1e9);
    }
  }
  inWaterDeep() { const p = this.particles[4].p, W = this.G.world; return W.inPool(p.x, p.z) && p.y < W.water.surface + 0.1; }
  fall(t) { if (this.state !== 'down') { this.state = 'down'; this.muscle *= 0.3; } this.downT = Math.max(this.downT, t); this.swim = false; for (const k of ['L', 'R']) this.arms[k].handOverride = null; this.hold = null; }
  startGetup() {
    const P = this.particles;
    this.state = 'getup'; this.getupT = 0;
    for (let i = 0; i < 17; i++) this.snap[i].copy(P[i].p);
    const g = this.G.world.groundAt(P[4].p.x, P[4].p.z);
    this.root.set(P[4].p.x, g, P[4].p.z);
    _a.subVectors(P[0].p, P[4].p); _a.y = 0;
    if (_a.lengthSq() > 0.01) this.rootYaw = Math.atan2(_a.x, _a.z);
    this.vel.set(0, 0, 0);
  }
  knock(seconds) { if (!this.dead) this.fall(seconds); this.muscle = 0; }

  locomote(dt) {
    const G = this.G, W = G.world;
    if (this.state !== 'stand' || this.dead) { this.moveSpeed = 0; return; }
    let want = this.ctrl.move;
    let maxS = (this.isPlayer ? 1 : 1) * (0.55 + 0.45 * Math.min(1, this.blood / 4.2)) * (this.oxygen < 0.3 ? 0.6 : 1);
    if (this.swim) maxS *= 0.45;
    _a.copy(want).multiplyScalar(maxS);
    this.vel.lerp(_a, 1 - Math.exp(-dt * 7));
    const nx = this.root.x + this.vel.x * dt, nz = this.root.z + this.vel.z * dt;
    const r = 0.3;
    let x = nx, z = nz;
    for (const b of W.solids) {
      if (b.max.y < this.root.y + 0.35 || b.min.y > this.root.y + 1.7) continue;
      const cx = Math.max(b.min.x, Math.min(x, b.max.x)), cz = Math.max(b.min.z, Math.min(z, b.max.z));
      const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
      if (d2 < r * r) { const d = Math.sqrt(d2) || 1e-4; x = cx + dx / d * r; z = cz + dz / d * r; }
    }
    for (const dv of W.devices) if (dv.block) { const dx = x - dv.pos.x, dz = z - dv.pos.z, d = Math.hypot(dx, dz) || 1e-3, rr = dv.block; if (d < rr) { x = dv.pos.x + dx / d * rr; z = dv.pos.z + dz / d * rr; } }
    this.root.x = x; this.root.z = z;
    this.moveSpeed = Math.hypot(this.vel.x, this.vel.z);
    // 바닥 / 물
    const g = W.groundAt(x, z), surf = W.water.surface;
    if (this.swim) {
      this.root.y += (surf - 1.38 - this.root.y) * Math.min(1, dt * 3);
      if (!W.inPool(x, z, -0.35)) { // 가장자리 → 올라가기
        if (!W.inPool(x, z, 0)) { this.swim = false; this.root.y = 0; }
        else { _a.set(this.vel.x, 0, this.vel.z); if (_a.lengthSq() > 0.05) { this.root.x += _a.x * 0.45 / Math.max(0.3, _a.length()); this.root.z += _a.z * 0.45 / Math.max(0.3, _a.length()); if (!W.inPool(this.root.x, this.root.z)) { this.swim = false; this.root.y = 0; } } }
      }
    } else if (g < this.root.y - 0.4) { this.fall(1.2); }
    else this.root.y += (g - this.root.y) * Math.min(1, dt * 10);
    // 방향
    let yaw = this.ctrl.yaw;
    if (yaw == null && this.moveSpeed > 0.2) yaw = Math.atan2(this.vel.x, this.vel.z);
    if (yaw != null) { let d = yaw - this.rootYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.rootYaw += d * Math.min(1, dt * 8); }
  }

  // ───────── 생리·감정 ─────────
  life(dt) {
    const G = this.G, W = G.world, O = this.organs;
    let bleed = 0;
    for (const w of this.wounds) { w.age += dt; bleed += w.bleed; w.bleed *= Math.exp(-dt / (w.bleed > 0.03 ? 60 : 25)); }
    if (O.liver.hp <= 0) bleed += 0.02; if (O.spleen.hp <= 0) bleed += 0.01;
    if (!this.dead && this.heartStop <= 0) { this.blood = Math.max(0, this.blood - bleed * dt); this.hp -= bleed * dt * 16; }
    this.bleedRate = bleed;
    if (this.dead) { this.mats.body.userData.U.uPale.value = Math.min(1, this.mats.body.userData.U.uPale.value + dt * 0.05); this.syncPale(); return; }
    // 물속 호흡
    const hp = this.particles[0].p;
    const under = W.inPool(hp.x, hp.z) && hp.y < W.water.surface - 0.03;
    this.underwater = under;
    const lungs = (O.lungL.hp > 0 ? 0.5 : 0) + (O.lungR.hp > 0 ? 0.5 : 0);
    if (under) this.oxygen -= dt / (this.conscious ? 24 : 9);
    else this.oxygen = Math.min(lungs, this.oxygen + dt * 0.3 * lungs) - (lungs < 1 ? dt * (1 - lungs) / 30 : 0);
    this.oxygen = Math.max(0, this.oxygen);
    if (this.oxygen <= 0) this.hp -= dt * 9;
    if (O.heart.hp <= 0) { this.heartStop += dt; this.hp -= dt * 14; }
    if (O.brain.hp <= 0) this.die('뇌 손상');
    this.stun = Math.max(0, this.stun - dt);
    const was = this.conscious;
    this.conscious = this.blood > 2.6 && this.oxygen > 0.12 && this.hp > 8 && this.heartStop < 4 && this.stun <= 0;
    if (was && !this.conscious) this.say('', 0);
    if (this.hp <= 0 || this.blood < 1.9) this.die(this.oxygen <= 0 ? '익사' : this.blood < 1.9 ? '과다 출혈' : this.heartStop > 0 ? '심장 정지' : '치명상');
    if (this.dead) return;
    this.pain = Math.max(0, this.pain - dt * 0.1);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.mats.body.userData.U.uPale.value = Math.min(0.9, Math.max(0, (5 - this.blood) / 2.6) * 0.9 + (1 - this.oxygen) * 0.3);
    this.syncPale();
    // 신음·비명
    this.screamCd -= dt; this.sayCd -= dt; this.moanT -= dt;
    if (this.conscious && this.moanT <= 0) {
      this.moanT = 2.5 + Math.random() * 4;
      if (under) { G.audio.voice(this, 'drown', 0.8); this.say(pick(LINES.water)); }
      else if (this.pain > 0.35 || this.blood < 4) { G.audio.voice(this, this.pain > 0.6 ? 'cry' : 'moan', 0.5 + this.pain * 0.5); this.mouth = 0.6; if (!this.isPlayer && Math.random() < 0.5) this.say(pick(LINES.hurt)); }
    }
    this.mouth = Math.max(0, this.mouth - dt * 1.2);
    // 감정 이름
    let e = '평온';
    if (!this.conscious) e = '의식 없음';
    else if (under) e = '질식 공포';
    else if (this.pain > 0.55) e = '극심한 고통';
    else if (this.ai.flee) e = '공황';
    else if (this.blood < 3.6 && this.pain > 0.2) e = '절망';
    else if (this.fear > 0.6) e = '공포';
    else if (this.pain > 0.2) e = '고통';
    else if (this.fear > 0.25) e = '불안';
    this.emotion = e;
  }
  syncPale() { const v = this.mats.body.userData.U.uPale.value; for (const k of ['head', 'armL', 'armR']) this.mats[k].userData.U.uPale.value = v; this.face.lipMat.userData.U.uPale.value = v; }
  die(cause) {
    if (this.dead) return;
    this.dead = true; this.conscious = false; this.cause = cause; this.hp = Math.min(this.hp, 0);
    this.fall(1e9); this.ai.flee = false; this.surrender = 0; this.clutch = null; this.say('');
    this.G.audio.voice(this, 'death', 0.8);
    this.G.onDeath?.(this);
  }
  say(text, dur = 2.6) { if (this.isPlayer || (text && !this.conscious)) return; this.G.ui?.say(this, text, dur); }

  // ───────── NPC 행동 ─────────
  think(dt) {
    const G = this.G, pl = G.player, ai = this.ai, W = G.world;
    const myPos = this.root;
    _a.subVectors(pl.root, myPos); _a.y = 0; const dist = _a.length();
    const aimed = G.aimTarget === this && !pl.dead && G.weaponRanged;
    if (aimed) this.fear = Math.min(1, this.fear + dt * (dist < 8 ? 1.1 : 0.6));
    else this.fear = Math.max(0, this.fear - dt * (this.hurtT > 0 ? 0.01 : 0.06));
    if (!this.conscious || this.state !== 'stand') { this.ctrl.move.set(0, 0, 0); this.surrender = Math.max(0, this.surrender - dt * 3); return; }
    if (this.hurtT > 0 && !ai.flee && this.pain > 0.15) { ai.flee = true; ai.target = null; ai.fleeT = 6 + Math.random() * 5; this.say(pick(LINES.flee)); }
    if (ai.flee) { ai.fleeT -= dt; if (ai.fleeT <= 0 && this.pain < 0.3) ai.flee = false; }
    let speed = 0, target = null, faceYaw = null;
    if (this.swim) { // 물에서는 가장 가까운 가장자리로
      const P = W.water; const cx = Math.min(Math.max(myPos.x, P.min.x), P.max.x), cz = Math.min(Math.max(myPos.z, P.min.z), P.max.z);
      const ex = [P.min.x - 0.6, P.max.x + 0.6], ez = [P.min.z - 0.6, P.max.z + 0.6];
      const opts = [new V(ex[0], 0, cz), new V(ex[1], 0, cz), new V(cx, 0, ez[0]), new V(cx, 0, ez[1])];
      target = opts.sort((a, b) => a.distanceTo(myPos) - b.distanceTo(myPos))[0]; speed = 1.8;
    } else if (ai.flee) {
      if (!ai.target || myPos.distanceTo(ai.target) < 1 || ai.stuck > 1.5) { ai.target = this.pickPoint(p => p.distanceTo(pl.root)); ai.stuck = 0; }
      target = ai.target; speed = 3.7;
      if (this.screamCd <= 0 && Math.random() < dt * 0.5) { G.audio.voice(this, 'scream', 0.7); this.screamCd = 2.5; this.mouth = 1; }
    } else if (this.fear > 0.35) {
      faceYaw = Math.atan2(_a.x, _a.z);
      if (dist < 7) { target = _b.copy(myPos).addScaledVector(_a, -1 / Math.max(dist, 0.1)); speed = 0.55; }
      if (this.sayCd <= 0) { this.say(pick(LINES.fear)); this.sayCd = 4 + Math.random() * 3; }
    } else {
      ai.t -= dt;
      if (!ai.target || ai.stuck > 2) { if (ai.t <= 0) { ai.target = this.pickPoint(p => -p.distanceTo(myPos) + Math.random() * 6 - (p.distanceTo(myPos) > 9 ? 20 : 0)); ai.t = 2 + Math.random() * 4; ai.stuck = 0; } }
      else if (myPos.distanceTo(ai.target) < 0.6) { ai.target = null; ai.t = 2 + Math.random() * 4; }
      target = ai.target; speed = 1.15;
      if (dist < 5 && Math.random() < dt * 0.3) faceYaw = Math.atan2(_a.x, _a.z);
    }
    this.surrender += ((this.fear > 0.35 && !ai.flee && aimed) || (this.fear > 0.55 && !ai.flee) ? 1 - this.surrender : -this.surrender) * Math.min(1, dt * 4);
    const mv = this.ctrl.move.set(0, 0, 0);
    if (target) {
      mv.subVectors(target, myPos); mv.y = 0; const d = mv.length();
      if (d > 0.2) mv.multiplyScalar(speed / d);
      // 장애물·위험 피하기
      for (const b of W.solids) {
        if (b.max.y < 0.5 || b.min.y > 1.5) continue;
        const cx = Math.max(b.min.x, Math.min(myPos.x, b.max.x)), cz = Math.max(b.min.z, Math.min(myPos.z, b.max.z));
        const dx = myPos.x - cx, dz = myPos.z - cz, dd = Math.hypot(dx, dz);
        if (dd < 1 && dd > 1e-4) { mv.x += dx / dd * (1 - dd) * speed * 1.5; mv.z += dz / dd * (1 - dd) * speed * 1.5; }
      }
      if (!this.swim) {
        for (const dv of W.devices) { const dx = myPos.x - dv.pos.x, dz = myPos.z - dv.pos.z, dd = Math.hypot(dx, dz) || 1e-3, R = dv.radius + 1.2; if (dd < R) { mv.x += dx / dd * (R - dd) * speed * (ai.flee ? 0.8 : 2); mv.z += dz / dd * (R - dd) * speed * (ai.flee ? 0.8 : 2); } }
        const P = W.water; const cx = Math.min(Math.max(myPos.x, P.min.x), P.max.x), cz = Math.min(Math.max(myPos.z, P.min.z), P.max.z);
        const dx = myPos.x - cx, dz = myPos.z - cz, dd = Math.hypot(dx, dz);
        if (dd < 1.4 && dd > 1e-4) { mv.x += dx / dd * (1.4 - dd) * speed * 2; mv.z += dz / dd * (1.4 - dd) * speed * 2; }
      }
      const ms = mv.length(); if (ms > speed) mv.multiplyScalar(speed / ms);
      ai.stuck = this.moveSpeed < speed * 0.25 ? ai.stuck + dt : 0;
    }
    this.ctrl.yaw = faceYaw;
    // 시선
    _b.subVectors(pl.particles[0].p, this.particles[0].p);
    const ly = Math.atan2(_b.x, _b.z) - this.rootYaw, lyN = Math.atan2(Math.sin(ly), Math.cos(ly));
    const want = (dist < 12 && Math.abs(lyN) < 1.6) || this.fear > 0.2 ? lyN : 0;
    this.look.yaw += (Math.max(-1.1, Math.min(1.1, want)) - this.look.yaw) * Math.min(1, dt * 5);
    this.look.pitch += (Math.atan2(_b.y, Math.hypot(_b.x, _b.z)) * (want ? 1 : 0) * 0.6 - this.look.pitch) * Math.min(1, dt * 5);
  }
  pickPoint(score) {
    const W = this.G.world; let best = null, bs = -1e9;
    for (let i = 0; i < 24; i++) {
      const p = new V((Math.random() - 0.5) * 24, 0, (Math.random() - 0.5) * 24);
      if (W.inPool(p.x, p.z, 1.5)) continue;
      if (W.devices.some(d => Math.hypot(p.x - d.pos.x, p.z - d.pos.z) < d.radius + 1.5)) continue;
      if (W.solids.some(b => b.max.y > 0.5 && b.max.y < 5.5 && p.x > b.min.x - 0.6 && p.x < b.max.x + 0.6 && p.z > b.min.z - 0.6 && p.z < b.max.z + 0.6)) continue;
      const s = score(p); if (s > bs) { bs = s; best = p; }
    }
    return best || new V();
  }

  // ───────── 피격 판정 ─────────
  // 광선이 지나는 모든 부위 [{part, tIn, tOut}] (가까운 순)
  raycast(ro, rd, maxT = 200) {
    const hits = [];
    const ro2 = new V(), rd2 = new V(), inv = new M4();
    for (const [part, a, b, r] of this.caps) {
      inv.copy(this.boneMat(part)).invert();
      ro2.copy(ro).applyMatrix4(inv); rd2.copy(rd).transformDirection(inv);
      const s = rayCapsuleSpan(ro2, rd2, a, b, r);
      if (s && s[0] > 0 && s[0] < maxT) hits.push({ part, tIn: s[0], tOut: s[1] });
    }
    hits.sort((x, y) => x.tIn - y.tIn);
    // 같은 부위 겹침 합치기
    const out = [];
    for (const h of hits) { const o = out.find(q => q.part === h.part); if (o) { o.tIn = Math.min(o.tIn, h.tIn); o.tOut = Math.max(o.tOut, h.tOut); } else out.push(h); }
    return out.sort((x, y) => x.tIn - y.tIn);
  }
  toBind(part, p, out) { return out.copy(p).applyMatrix4(_m2.copy(this.boneMat(part)).invert()); }
  dirToBind(part, d, out) { return out.copy(d).transformDirection(_m2.copy(this.boneMat(part)).invert()); }
  woundWorld(w, out) { return out.copy(w.pos).applyMatrix4(this.boneMat(w.part)); }
  nearestPart(p) {
    let best = 'chest', bd = 1e9;
    this.particles.forEach((q, i) => { const d = q.p.distanceTo(p) - q.r; if (d < bd) { bd = d; best = P2PART[i]; } });
    return best;
  }

  // 피해: { part, type, dmg, point, dir, chordA, chordB(월드: 총알이 지나간 구간), exit, organDmg, impulse }
  hit(info) {
    const G = this.G, part = info.part, D = PART[part];
    const wasDead = this.dead;
    const W = WOUND[info.type] || WOUND.blunt;
    const bp = this.toBind(part, info.point, new V());
    const dir = this.dirToBind(part, info.dir || _a.set(0, 0, 1), new V());
    // 상처
    const matKey = D.arm ? 'arm' + D.arm : part === 'head' ? 'head' : 'body';
    const w = { mat: matKey, part, pos: bp, r: W.r * (info.scale || 1) * (0.85 + Math.random() * 0.3), t: W.t, age: 0, bleed: W.bleed * (D.artery ? 3 : 1) * (info.bleedMul || 1),
      cut: new V(), cutLen: W.len || 0, drip: this.dirToBind(part, _a.set(0, -1, 0), new V()), n: dir.clone().negate() };
    if (W.t === 1) { w.cut.copy(info.cutDir ? this.dirToBind(part, info.cutDir, new V()) : new V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)).normalize(); }
    this.wounds.push(w);
    if (this.wounds.length > 60) this.wounds.shift();
    // 피
    if (info.type !== 'burn' && info.type !== 'blunt' && info.type !== 'impact') G.fx.bloodBurst(info.point, info.dir, info.exit ? 1.6 : 0.7, info.type === 'saw' || info.type === 'crush' || info.type === 'blast' ? 2.5 : 1);
    else if ((info.dmg || 0) > 25 && info.type !== 'burn') G.fx.bloodBurst(info.point, info.dir, 0.5, 0.6);
    // 내부: 장기·뼈
    const organHits = [];
    if (info.chordA && info.chordB) {
      const a = this.toBind(part, info.chordA, new V()), b = this.toBind(part, info.chordB, new V());
      if (!info.noChannel) this.addChannel(part, a, b, info.lodged);
      for (const o of Object.values(this.organs)) {
        if (o.out || o.def.bone !== D.bone) continue;
        if (segEllipsoid(a, b, o.c, o.r)) { o.hp -= info.organDmg ?? 85; organHits.push(o); }
      }
      // 뼈: 팔다리는 뼈 축 근처를 지나면, 몸통은 확률
      const cap = this.caps.find(c => c[0] === part);
      if (cap && (D.arm || D.leg || part.startsWith('foot'))) { if (segSegDist(a, b, cap[1], cap[2]) < 0.022) this.fracture(part); }
      else if (part === 'head') this.fracture(part);
      else if (Math.random() < (part === 'chest' ? 0.55 : 0.3)) this.fracture(part);
    } else if (['blunt', 'crush', 'blast', 'impact', 'saw', 'stab', 'spike'].includes(info.type)) {
      const cand = Object.values(this.organs).filter(o => !o.out && o.def.bone === D.bone);
      const n = info.type === 'crush' ? cand.length : info.type === 'blast' ? 2 : 1;
      for (let i = 0; i < n && cand.length; i++) { const o = cand.splice(Math.floor(Math.random() * cand.length), 1)[0]; const od = info.type === 'blunt' || info.type === 'impact' ? (info.dmg || 0) * 0.8 : info.organDmg ?? 60; o.hp -= od; organHits.push(o); }
      const fc = { blunt: (info.dmg || 0) / 70, impact: (info.dmg || 0) / 60, crush: 1, blast: 0.4, saw: 0.5, stab: 0.05, spike: 0.3 }[info.type];
      if (Math.random() < fc) this.fracture(part);
    }
    for (const o of organHits) { o.mesh.material.uniforms.uFlash.value = Math.min(1, 1 - o.hp / 100 + 0.3); if (o.hp <= 0) o.hp = 0; }
    // 체력
    this.hp -= (info.dmg || 0) * D.mult;
    this.partDmg[part] = (this.partDmg[part] || 0) + (info.dmg || 0);
    this.recent[part] = (this.recent[part] || 0) + (info.dmg || 0);
    // 힘 (밀려남)
    if (!info.noImpulse) {
      const imp = info.impulse ?? (info.dmg || 0) * 0.03;
      const dv = _b.copy(info.dir || _a.set(0, 0, 1)).normalize().multiplyScalar(imp / D.pts.length);
      for (const i of D.pts) this.particles[i].push(dv, G.physics.h);
    }
    // 반응
    if (!this.dead) {
      this.pain = Math.min(1, this.pain + (info.dmg || 0) / 45 + (organHits.length ? 0.3 : 0));
      this.fear = Math.min(1, this.fear + 0.4);
      this.hurtT = 8; this.flinch = Math.min(1, this.flinch + 0.6 + (info.dmg || 0) / 60);
      if (D.arm && D.bi === 2 && info.type !== 'burn') this.flinch = 1;
      if ((info.dmg || 0) > 45 || info.type === 'blast' || info.type === 'crush') this.knock(2.5);
      if (this.wounds.length && !this.isPlayer && Math.random() < 0.6 && ['chest', 'belly', 'pelvis', 'thighL', 'thighR', 'neck'].includes(part)) {
        this.clutch = { side: Math.random() < 0.5 ? 'l' : 'r', w }; setTimeout(() => { if (this.clutch?.w === w) this.clutch = null; }, 9000);
      }
      if (this.conscious && this.screamCd <= 0.6) { G.audio.voice(this, info.dmg > 30 || organHits.length ? 'scream' : 'pain', Math.min(1, 0.5 + (info.dmg || 0) / 50)); this.screamCd = 1.2; this.mouth = 1; if (Math.random() < 0.6) this.say(pick(LINES.pain), 1.6); }
      this.ai.flee = this.ai.flee || false;
    }
    // 장기가 튀어나옴
    if (['chest', 'belly', 'pelvis'].includes(part) && ((['crush', 'blast', 'saw'].includes(info.type) && this.partDmg[part] > 45) || (info.dmg || 0) >= 60 || this.recent[part] > (part === 'chest' ? 120 : 75))) this.eviscerate(part, info);
    if (organHits.some(o => o.def.id === 'brain' && o.hp <= 0)) this.die('머리 관통');
    if (this.hp <= 0) this.die('치명상');
    G.onHit?.(this, info, organHits, wasDead);
    return { organHits, wound: w };
  }
  fracture(part) {
    if (this.broken[part]) return;
    this.broken[part] = true;
    const m = this.boneMesh[PART[part].bone || part] || this.boneMesh[part];
    if (m) m.material.uniforms.uFlash.value = 1;
    this.G.audio.crack(this.particles[PART[part].pts[0]].p);
    this.pain = Math.min(1, this.pain + 0.35);
    if (PART[part].leg || part === 'pelvis' || part === 'belly') this.knock(1e9);
  }
  addChannel(part, a, b, lodged) {
    if (a.distanceTo(b) < 0.004) return;
    const g = new THREE.TubeGeometry(new THREE.LineCurve3(a.clone(), b.clone()), 1, 0.0035, 6, false);
    const m = new THREE.Mesh(g, A.xrayMaterial(0xff6a2a, { solid: 1, rim: 1, power: 1.6 }));
    m.layers.set(1); m.frustumCulled = false;
    this.boneObj(part).add(m); this.channels.push(m); this.xr.wounds.push(m);
    if (lodged) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), A.xrayMaterial(0xffe9a0, { solid: 1, power: 2 })); s.position.copy(b); s.layers.set(1); s.frustumCulled = false; m.add(s); }
  }
  eviscerate(part, info) {
    const bones = part === 'chest' ? ['chest'] : ['belly', 'pelvis'];
    const list = Object.values(this.organs).filter(o => !o.out && bones.includes(o.def.bone) && (part !== 'chest' || Math.random() < 0.6));
    if (!list.length) return;
    const G = this.G;
    // 배에 큰 구멍
    const fw = _a.setFromMatrixColumn(this.frame[part === 'chest' ? 'chest' : 'belly'], 2);
    const p = this.particles[part === 'chest' ? 2 : 3].p.clone().addScaledVector(fw, 0.1);
    this.wounds.push({ mat: 'body', part, pos: this.toBind(part, p, new V()), r: 0.07, t: 6, age: 0, bleed: 0.06, cut: new V(), cutLen: 0, drip: this.dirToBind(part, _b.set(0, -1, 0), new V()), n: new V() });
    for (const o of list.slice(0, part === 'chest' ? 2 : 5)) {
      o.out = true; o.hp = 0; o.mesh.visible = false;
      const wm = this.BM[o.def.bone].clone();
      const v = fw.clone().multiplyScalar(2 + Math.random() * 3).add(new V((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2));
      if (info.dir) v.addScaledVector(info.dir, 2);
      this.gibs.push(G.fx.spawnGib(this, o, wm, v, part));
    }
    G.audio.splat(p, 1.2);
    G.fx.bloodBurst(p, fw, 2.2, 3);
    this.pain = 1;
  }

  // ───────── 그리기 ─────────
  updateVisual(dt) {
    const P = this.particles.map(p => p.p);
    this.computeFrames(P, false);
    for (let i = 0; i < this.BONES.length; i++) { const b = this.BONES[i]; this.bones[i].matrixWorld.copy(this.BM[b]); this.bo[b].matrix.copy(this.BM[b]); }
    this.arms.L.update(P[5], P[6], P[7]);
    this.arms.R.update(P[8], P[9], P[10]);
    // 표정
    const F = this.face, t = this.G.time;
    this.blinkT -= dt; if (this.blinkT <= 0) { this.blink = 0.15; this.blinkT = 2 + Math.random() * 4; }
    this.blink = Math.max(0, this.blink - dt);
    const pain = this.pain, fear = this.fear;
    let e;
    if (this.dead) e = { eyeOpen: 0.55, browUp: 0, browIn: 0, mouthOpen: 0.35, mouthWide: 0.95, gaze: { x: 0, y: -0.1 } };
    else if (!this.conscious) e = { eyeOpen: 0.08, browUp: -0.2, browIn: 0, mouthOpen: 0.2, mouthWide: 0.95, gaze: { x: 0, y: 0 } };
    else {
      const scream = Math.max(this.mouth, 0);
      e = { eyeOpen: Math.max(0.15, 0.85 + fear * 0.3 - pain * 0.75) * (this.blink > 0 ? 0.05 : 1),
        browUp: fear * 1 - pain * 0.6, browIn: fear * 0.8 - pain * 0.9 + (this.blood < 3.8 ? 0.5 : 0),
        mouthOpen: Math.min(1, scream * (0.6 + Math.sin(t * 30) * 0.08) + fear * 0.12 + (this.underwater ? 0 : 0) + (this.oxygen < 0.5 ? 0.3 : 0)),
        mouthWide: 1 + pain * 0.3 - fear * 0.1, gaze: { x: (this.isPlayer ? 0 : Math.sin(t * 0.7) * 0.08), y: 0 } };
    }
    A.applyFace(F, e);
    // 심장 박동 (엑스레이)
    const heart = this.organs.heart;
    if (!heart.out) { const bpm = this.dead || heart.hp <= 0 ? 0 : 70 + fear * 60 + pain * 40 + (5 - this.blood) * 25; this.beat = (this.beat || 0) + dt * bpm / 60; const k = 1 + (bpm ? Math.pow(Math.max(0, Math.sin(this.beat * Math.PI * 2)), 6) * 0.12 : 0); heart.mesh.scale.setScalar(k); heart.mesh.position.copy(heart.c).multiplyScalar(1 - k); }
    // 상처 유니폼
    const lists = { body: [], head: [], armL: [], armR: [] };
    for (const w of this.wounds) lists[w.mat].push(w);
    for (const k in lists) {
      const U = this.mats[k].userData.U, L = lists[k].slice(-A.MAXW);
      U.uN.value = L.length;
      L.forEach((w, i) => {
        U.uW.value[i].set(w.pos.x, w.pos.y, w.pos.z, w.r);
        const dl = w.t === 2 || w.t === 3 ? 0 : Math.min(0.2, 0.01 + w.age * 0.012 * Math.min(1, w.bleed * 120 + 0.2));
        U.uD.value[i].set(w.drip.x * dl, w.drip.y * dl, w.drip.z * dl, w.t);
        U.uC.value[i].set(w.cut.x, w.cut.y, w.cut.z, w.cutLen);
      });
      U.uBloody.value = Math.min(0.6, this.wounds.length * 0.02 + (5 - this.blood) * 0.05);
    }
    this.face.lipMat.userData.U.uN.value = 0;
  }
  // 상처에서 피 흘리기 (fx 가 부름)
  emitBlood(dt) {
    const G = this.G;
    const beat = this.dead ? 0.3 : 0.6 + 0.4 * Math.max(0, Math.sin((this.beat || 0) * Math.PI * 2));
    for (const w of this.wounds) {
      if (w.bleed <= 0.001) continue;
      w.acc = (w.acc || 0) + dt * w.bleed * 900 * beat;
      while (w.acc > 1) {
        w.acc -= 1;
        const p = this.woundWorld(w, _c);
        const n = _d.copy(w.n).transformDirection(this.boneMat(w.part));
        G.fx.drop(p, n.multiplyScalar(0.3 + Math.random() * (w.bleed > 0.04 ? 1.5 : 0.4)).add(_a.set((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2)), 0.6 + Math.random());
      }
    }
    if (this.bleedRate > 0.004 && this.state === 'down') G.fx.pool(this, this.particles[3].p, dt * this.bleedRate * 6);
  }
}

function segEllipsoid(a, b, c, r) {
  const ax = (a.x - c.x) / r.x, ay = (a.y - c.y) / r.y, az = (a.z - c.z) / r.z;
  const dx = (b.x - a.x) / r.x, dy = (b.y - a.y) / r.y, dz = (b.z - a.z) / r.z;
  const A2 = dx * dx + dy * dy + dz * dz, B = ax * dx + ay * dy + az * dz, C = ax * ax + ay * ay + az * az - 1;
  if (C <= 0) return true;
  const disc = B * B - A2 * C; if (disc < 0 || A2 < 1e-12) return false;
  const t = (-B - Math.sqrt(disc)) / A2;
  return t >= 0 && t <= 1;
}
function segSegDist(p1, q1, p2, q2) {
  const d1 = new V().subVectors(q1, p1), d2 = new V().subVectors(q2, p2), r = new V().subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), c = d1.dot(r), b = d1.dot(d2), den = a * e - b * b;
  let s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
  let t = (b * s + f) / e;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
  return new V().copy(p1).addScaledVector(d1, s).distanceTo(new V().copy(p2).addScaledVector(d2, t));
}
