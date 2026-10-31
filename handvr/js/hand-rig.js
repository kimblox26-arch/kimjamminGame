// 실제 사람 손·팔 3D 모델 + 뼈대·스킨 가중치 + MediaPipe 관절 리타기팅
//
// 모델: "Hand and arm - Zbrush sculpt" (Andy Woodhead, CC BY 4.0, models/LICENSE.md)
//   어깨부터 손끝까지 한 덩어리인 왼팔 조각 모델. 피부색·주름·핏줄·손톱은 모델 텍스처(색, 노멀맵, 거칠기·AO)를 그대로 쓴다.
//   오른팔은 같은 모델을 좌우로 뒤집어 만든다.
// 뼈대: 손 25개(WebXR 손 관절 이름) + 위팔·아래팔·아래팔 비틀림.
//   관절 위치(JOINTS)는 모델을 여러 방향에서 렌더링해 손 인식 AI 로 찾고 손가락 단면의 중심으로 보정한 값이고,
//   스킨 가중치는 불러올 때 계산한다: 어느 손가락 살인지는 피부 표면을 따라 잰 거리로 고르고(fingerRegions),
//   관절마다 경계면을 두고 두 뼈를 부드럽게 섞는다.
//   → 손·손목·팔뚝·팔꿈치가 한 피부로 이어져서, 손목을 꺾어도 틈이나 튀어나온 데가 생기지 않는다.
//
// 움직이는 방법:
//   1) 손바닥: 카메라 관절(손목·검지·중지·새끼 뿌리)로 손바닥 좌표계를 만들고, 모델 손바닥을 그 회전으로 돌린다.
//   2) 손가락: finger-pose.js 가 판단한 관절 각도만큼 굽힌다. 뼈 길이는 고정이라 늘어나거나 꼬이지 않는다.
//   3) 팔: 몸 인식(PoseLandmarker)으로 찾은 내 팔꿈치·어깨 방향을 그대로 따라간다. 안 보이면 몸 쪽 어깨에서
//      손목까지 두 마디 IK + 손목이 편하게 펴진 방향을 섞어 자연스럽게. 손목은 실제 범위(70°) 이상 꺾이지 않고,
//      팔뚝은 손이 돌아간 만큼 손목 쪽으로 갈수록 더 비틀린다(실제 아래팔뼈처럼).
//   4) 부드럽게: 각도는 One-Euro 필터, 뼈 회전은 프레임마다 slerp, 팔꿈치·어깨도 천천히 따라간다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeSkin } from './skin.js';
import { FINGERS } from './hands.js';
import { measureAngles, palmBasis, thumbHinge } from './finger-pose.js';

export const SKIN_TONES = { light: 0xf3cbb0, medium: 0xdca47f, tan: 0xb87b53, deep: 0x7b4a2f };

const FN = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
// 손가락별 뼈 사슬 (MediaPipe 관절 FINGERS[f] 와 1:1)
const CHAIN = FN.map((n, f) => (f === 0
  ? ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']
  : [`${n}-phalanx-proximal`, `${n}-phalanx-intermediate`, `${n}-phalanx-distal`, `${n}-tip`]));
const META = FN.slice(1).map(n => `${n}-metacarpal`);
const HAND_BONES = ['wrist', ...META, ...CHAIN.flat()];
const BONES = [...HAND_BONES, 'upperarm', 'forearm', 'forearm-twist'];
const DEG = Math.PI / 180;
const LIM = { thumbCmc: 55 * DEG }; // 엄지 뿌리가 모델 기본 방향에서 벌어질 수 있는 최대 각

// 모델(왼팔, 미터) 안의 관절 위치. hand 는 MediaPipe 21개 순서 (손가락 관절은 단면 중심으로 보정)
const JOINTS = {
  hand: [[0.0457, 0.1688, 0.1484], [0.0070, 0.1780, 0.1894], [-0.0142, 0.1653, 0.2276], [-0.0449, 0.1595, 0.2475], [-0.0477, 0.1649, 0.2707],
    [0.0561, 0.1520, 0.2634], [0.0422, 0.1160, 0.3125], [0.0263, 0.0915, 0.3411], [0.0164, 0.0876, 0.3645],
    [0.0696, 0.1227, 0.2474], [0.0656, 0.0754, 0.2935], [0.0476, 0.0495, 0.3246], [0.0416, 0.0342, 0.3469],
    [0.0728, 0.1000, 0.2239], [0.0709, 0.0571, 0.2613], [0.0597, 0.0321, 0.2897], [0.0484, 0.0177, 0.3079],
    [0.0697, 0.0837, 0.1970], [0.0565, 0.0418, 0.2211], [0.0469, 0.0176, 0.2393], [0.0423, 0.0065, 0.2515]],
  elbow: [0.0295, 0.3395, -0.0790],
  shoulder: [-0.0250, 0.5740, -0.2940],
};
// 모델 텍스처의 평균 피부색(선형). 고른 피부 톤 ÷ 이 색을 곱해서 톤을 맞춘다
const TEX_SKIN = [0.431, 0.184, 0.112];
// 관절 경계면에서 두 뼈가 섞이는 폭(m): 손가락은 [뿌리, 둘째, 끝] 마디
const ZONE = { finger: [0.009, 0.006, 0.004], thumb: [0.014, 0.008, 0.004], wrist: 0.02, elbow: 0.045 };
// 끝마디 경계면을 관절에서 손바닥 쪽으로 옮기는 거리(m): 손톱이 섞이는 범위 밖에 있어서 마디를 펴고 굽혀도 손톱이 휘지 않게
const SHIFT = { finger: [0, 0, 0.002], thumb: [0, 0, 0.003] };
// 몸 쪽 어깨 위치(카메라 기준, 오른쪽 어깨). 손이 팔 길이보다 멀면 어깨를 손 쪽으로 당긴다(화면 밖이라 안 보임)
const SHOULDER = new THREE.Vector3(0.18, -0.25, 0.05);
const TWIST_MAX = 95 * DEG; // 팔뚝이 비틀릴 수 있는 최대 각
const WRIST_MAX = 70 * DEG; // 손목이 팔뚝 방향에서 꺾일 수 있는 최대 각
const POLE = new THREE.Vector3(0.45, -1, 0.35).normalize(); // 팔꿈치 기본 방향(오른팔): 아래·바깥·조금 뒤

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion();
const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

// 직교 기저(열: x, y, z) 행렬
function basis(out, x, y) { _c.crossVectors(x, y); return out.makeBasis(x, y, _c); }
function perp(v, axis) { return v.addScaledVector(axis, -v.dot(axis)).normalize(); }
// (x0, y0) 방향 쌍을 (x1, y1) 로 옮기는 회전
function rotBetween(x0, y0, x1, y1) {
  const a = perp(y0.clone(), x0), b = perp(y1.clone(), x1);
  return new THREE.Quaternion().setFromRotationMatrix(_m1.multiplyMatrices(basis(_m2, x1, b), basis(_m1, x0, a).transpose()));
}
// v 를 기준 방향 base 에서 최대 maxAng 까지만 벌어지게
function cone(v, base, maxAng) {
  const ang = v.angleTo(base);
  if (ang <= maxAng || ang < 1e-6) return v;
  _q.setFromUnitVectors(base, v);
  return v.copy(base).applyQuaternion(new THREE.Quaternion().slerp(_q, maxAng / ang)).normalize();
}
// 점 p 에서 선분 ab 까지 거리 (out: 가장 가까운 점)
function segDist(p, a, b, out = _b) {
  _a.subVectors(b, a);
  const t = clamp(_c.subVectors(p, a).dot(_a) / _a.lengthSq(), 0, 1);
  return out.copy(a).addScaledVector(_a, t).distanceTo(p);
}

// 정점마다 어느 손가락 영역인지: 손가락 뼈 축을 따라 2mm 마다 가장 가까운 표면 정점을 씨앗으로,
// 메시 표면을 따라 잰 거리(측지 거리)가 가장 가까운 손가락을 고른다. 공간 거리로 고르면 엄지 끝 바로 아래 손바닥처럼
// '가깝지만 이어져 있지 않은' 살이 엄지를 따라가 찢어진다. chains[f]: 손가락 f 의 관절 4개 (바인드 위치)
function fingerRegions(geo, chains) {
  const Pa = geo.attributes.position, n = Pa.count, ix = geo.index.array, v = V(), u = V();
  // UV 이음매로 갈라진 같은 위치 정점은 하나로 보고 이웃을 센다
  const canon = new Int32Array(n), seen = new Map(), reps = [];
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(Pa.getX(i) * 1e5)},${Math.round(Pa.getY(i) * 1e5)},${Math.round(Pa.getZ(i) * 1e5)}`;
    let c = seen.get(k);
    if (c === undefined) { c = i; seen.set(k, c); reps.push(i); }
    canon[i] = c;
  }
  const adj = Array.from({ length: n }, () => []);
  for (let t = 0; t < ix.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = canon[ix[t + e]], b = canon[ix[t + (e + 1) % 3]];
    if (a === b) continue;
    const d = v.fromBufferAttribute(Pa, a).distanceTo(u.fromBufferAttribute(Pa, b));
    adj[a].push(b, d); adj[b].push(a, d);
  }
  const dist = new Float64Array(n).fill(Infinity), lab = new Uint8Array(n), heap = new MinHeap();
  chains.forEach((p, f) => {
    for (let k = 0; k < 3; k++) {
      const steps = Math.ceil(p[k].distanceTo(p[k + 1]) / 0.002);
      for (let st = 0; st <= steps; st++) {
        u.lerpVectors(p[k], p[k + 1], st / steps);
        let best = -1, bd = Infinity;
        for (const i of reps) { const d = v.fromBufferAttribute(Pa, i).distanceToSquared(u); if (d < bd) { bd = d; best = i; } }
        if (dist[best] > 0) { dist[best] = 0; lab[best] = f; heap.push(0, best); }
      }
    }
  });
  while (heap.size) {
    const d = heap.topKey(), a = heap.pop();
    if (d > dist[a]) continue;
    const nb = adj[a];
    for (let j = 0; j < nb.length; j += 2) {
      const b = nb[j], nd = d + nb[j + 1];
      if (nd < dist[b]) { dist[b] = nd; lab[b] = lab[a]; heap.push(nd, b); }
    }
  }
  // 씨앗과 이어지지 않은 조각(따로 떨어진 껍질)은 공간 거리로 가장 가까운 손가락
  for (const i of reps) {
    if (dist[i] < Infinity) continue;
    v.fromBufferAttribute(Pa, i);
    let dm = Infinity;
    chains.forEach((p, f) => { for (let k = 0; k < 3; k++) { const d = segDist(v, p[k], p[k + 1]); if (d < dm) { dm = d; lab[i] = f; } } });
  }
  for (let i = 0; i < n; i++) lab[i] = lab[canon[i]];
  return lab;
}

// 작은 최소 힙 (key 가 가장 작은 값부터)
class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  topKey() { return this.k[0]; }
  push(key, val) {
    const K = this.k, Vv = this.v;
    let i = K.length;
    K.push(key); Vv.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= key) break; K[i] = K[p]; Vv[i] = Vv[p]; i = p; }
    K[i] = key; Vv[i] = val;
  }
  pop() {
    const K = this.k, Vv = this.v, top = Vv[0], key = K.pop(), val = Vv.pop(), n = K.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= key) break;
        K[i] = K[c]; Vv[i] = Vv[c]; i = c;
      }
      K[i] = key; Vv[i] = val;
    }
    return top;
  }
}

// ───────── 모델 불러오기 ─────────
const rigs = new Set();
let skinColor = new THREE.Color(0xdca47f);

export async function loadHandRigs() {
  const url = n => new URL(`../models/${n}`, import.meta.url).href;
  const texLoader = new THREE.TextureLoader();
  const tex = async (n, srgb) => {
    const t = await texLoader.loadAsync(url(n));
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const [gltf, map, normalMap, orm] = await Promise.all([
    new GLTFLoader().loadAsync(url('arm.glb')), tex('arm-color.jpg', true), tex('arm-normal.jpg'), tex('arm-orm.jpg')]);
  let src = null;
  gltf.scene.traverse(o => { if (o.isMesh) src = o; });
  const T = { map, normalMap, orm };
  return { L: new HandRig('L', src.geometry, T), R: new HandRig('R', src.geometry, T) };
}

class HandRig {
  constructor(side, srcGeo, T) {
    rigs.add(this);
    this.side = side;
    this.sign = side === 'R' ? 1 : -1;
    this.group = new THREE.Group();
    this.group.visible = false;

    // 바인드 관절 (모델은 왼팔 → 오른팔은 x 를 뒤집는다)
    const mx = side === 'R' ? -1 : 1;
    const at = p => new THREE.Vector3(p[0] * mx, p[1], p[2]);
    const J = JOINTS.hand.map(at), P = this.bindP = {};
    P.wrist = J[0];
    CHAIN.forEach((ch, f) => ch.forEach((n, k) => { P[n] = J[FINGERS[f][k]]; }));
    META.forEach((n, i) => { P[n] = V().lerpVectors(J[0], J[FINGERS[i + 1][0]], 0.35); });
    P.upperarm = at(JOINTS.shoulder);
    P.forearm = at(JOINTS.elbow);
    P['forearm-twist'] = P.forearm.clone();

    // 모델의 손바닥 좌표계 (바인드 포즈)
    this.Fb = V().subVectors(P['middle-finger-phalanx-proximal'], P.wrist).normalize();
    this.Lb = perp(V().subVectors(P['index-finger-phalanx-proximal'], P['pinky-finger-phalanx-proximal']), this.Fb);
    this.Ub = V().crossVectors(_a.subVectors(P['index-finger-phalanx-proximal'], P.wrist), _b.subVectors(P['pinky-finger-phalanx-proximal'], P.wrist)).normalize().multiplyScalar(this.sign);
    this.MbT = basis(new THREE.Matrix4(), this.Fb, this.Lb).transpose();
    this.backB = this.Ub.clone().negate();

    // 뼈별 바인드 방향·길이
    this.seg = {};
    CHAIN.forEach(ch => ch.slice(0, 3).forEach((n, k) => {
      const D = V().subVectors(P[ch[k + 1]], P[n]);
      const len = D.length();
      this.seg[n] = { D: D.normalize(), len };
    }));
    this.size0 = this.palmSize(n => P[n]);
    // 손가락 판단 각도의 기준(모델 바인드 포즈의 각도). 같은 방식으로 재야 차이만큼만 굽힌다
    this.Bb = palmBasis(J[0], J[5], J[9], J[17], this.sign);
    this.abAxis = V().crossVectors(this.Bb.F, this.Bb.L).normalize(); // +회전 = 엄지 쪽으로 벌림
    this.bindAng = measureAngles(i => J[i], this.Bb);
    // 팔 바인드: 위팔·아래팔 방향, 길이, 팔꿈치 경첩 축, 비틀림 기준(엄지 쪽)
    const up = V().subVectors(P.forearm, P.upperarm), fo = V().subVectors(P.wrist, P.forearm);
    this.armB = { lenU: up.length(), lenF: fo.length(), up: up.normalize(), fore: fo.normalize() };
    this.armB.hinge = V().crossVectors(up, fo).normalize();
    this.armB.ref = perp(this.Lb.clone(), fo);

    // 메시: 모델 복사(오른팔은 좌우 뒤집기) + 스킨 가중치
    const geo = srcGeo.clone();
    if (mx < 0) {
      for (const k of ['position', 'normal']) { const a = geo.attributes[k]; for (let i = 0; i < a.count; i++) a.setX(i, -a.getX(i)); }
      const ix = geo.index.array;
      for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    }
    this.girth = new Float32Array([1, 1, 1, 1, 1]);
    this.prepareSkin(geo);
    this.mat = makeSkin({ map: T.map, normalMap: T.normalMap, roughnessMap: T.orm, aoMap: T.orm, aoMapIntensity: 0.7, roughness: 1, girth: this.girth });

    // 뼈대: 모두 Armature 바로 아래(평평한 구조), 바인드 회전은 단위 회전
    const root = new THREE.Object3D();
    root.name = 'Armature';
    this.bone = {};
    const bones = BONES.map(n => {
      const b = new THREE.Bone();
      b.name = n;
      b.position.copy(P[n]);
      root.add(b);
      return (this.bone[n] = b);
    });
    this.group.add(root);
    root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(bones);
    this.mesh = new THREE.SkinnedMesh(geo, this.mat);
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.bind(this.skeleton);
    this.group.add(this.mesh);
    this.applySkin();

    this.Q = {}; this.Pt = {};
    for (const n of HAND_BONES) { this.Q[n] = new THREE.Quaternion(); this.Pt[n] = V(); }
    this.scale = 1;
    this.ratio = CHAIN.map(ch => ch.slice(0, 3).map(() => 1));
    this.lenS = CHAIN.map(ch => ch.slice(0, 3).map(() => []));
    this.lenTick = 0;
    this.wasVisible = false;
    this.S = null; this.E = null; this.hinge = null; this.swivel = 0; this.phi = 0; this.phiRaw = 0;
  }

  palmSize(get) {
    const w = get('wrist');
    return ['index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal', 'ring-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal']
      .reduce((s, n) => s + w.distanceTo(get(n)), 0) / 4;
  }

  // 스킨 가중치: 위팔 | 팔꿈치 | 아래팔(팔꿈치 쪽 → 손목 쪽 비틀림) | 손목 | 손가락 마디들.
  // 관절마다 경계면(뼈 방향에 수직)을 두고 그 앞뒤 ZONE 폭에서 두 뼈를 부드럽게 섞는다.
  // 손가락은 가장 가까운 손가락 축을 골라 그 손가락의 경계면만 쓴다 (이웃 손가락과 섞이지 않게).
  // 함께: 손가락 굵기 보정용 반지름 벡터(girthData), 손가락 번호, 투과 정도(얇은 손가락일수록 빛이 비침)
  prepareSkin(geo) {
    const Pa = geo.attributes.position, n = Pa.count, P = this.bindP;
    const bi = name => BONES.indexOf(name);
    const W = P.wrist, E = P.forearm, S = P.upperarm;
    const uF = V().subVectors(W, E), lenF = uF.length();
    uF.divideScalar(lenF);
    const nE = V().subVectors(E, S).normalize().add(uF).normalize();
    const nW = V().subVectors(P['middle-finger-phalanx-proximal'], W).normalize().add(uF).normalize();
    const br = CHAIN.map((ch, f) => {
      const p = ch.map(nm => P[nm]), z = f === 0 ? ZONE.thumb : ZONE.finger, sh = f === 0 ? SHIFT.thumb : SHIFT.finger;
      const planes = [0, 1, 2].map(k => {
        const n = (k === 0 ? V().subVectors(p[1], p[0]) : V().subVectors(p[k], p[k - 1]).normalize().add(V().subVectors(p[k + 1], p[k]).normalize())).normalize();
        return { o: V().copy(p[k]).addScaledVector(n, -sh[k]), z: z[k], n };
      });
      return { p, planes, segs: [[W, p[0]], [p[0], p[1]], [p[1], p[2]], [p[2], p[3]]], bones: ch.slice(0, 3).map(bi), axis: f === 0 ? 1 : 0 };
    });
    const lab = fingerRegions(geo, br.map(b => b.p));
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), thin = new Float32Array(n), gd = new Float32Array(n * 4), fid = new Float32Array(n);
    const v = V(), cp = V(), tmp = V(), BU = bi('upperarm'), BF = bi('forearm'), BT = bi('forearm-twist'), BW = bi('wrist');
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(Pa, i);
      const sE = smooth(-ZONE.elbow, ZONE.elbow, tmp.subVectors(v, E).dot(nE));
      const sW = smooth(-ZONE.wrist, ZONE.wrist, tmp.subVectors(v, W).dot(nW));
      const t = clamp(tmp.subVectors(v, E).dot(uF) / lenF, 0, 1);
      const f = lab[i], B = br[f], s = B.planes.map(pl => smooth(-pl.z, pl.z, tmp.subVectors(v, pl.o).dot(pl.n)));
      const hand = sE * sW, fore = sE * (1 - sW);
      const fw = [s[0] * (1 - s[1]), s[0] * s[1] * (1 - s[2]), s[0] * s[1] * s[2]].map(x => hand * x);
      // 엄지 뿌리 뼈는 엄지 두덩까지만 끌고 간다 (손바닥 가운데는 손목에 남김)
      if (f === 0) fw[0] *= 1 - smooth(0.022, 0.034, segDist(v, B.p[0], B.p[1]));
      const w = [[BU, 1 - sE], [BF, fore * (1 - t)], [BT, fore * t], [BW, hand - fw[0] - fw[1] - fw[2]],
        [B.bones[0], fw[0]], [B.bones[1], fw[1]], [B.bones[2], fw[2]]]
        .sort((x, y) => y[1] - x[1]).slice(0, 4);
      const sum = w.reduce((a, x) => a + x[1], 0) || 1;
      w.forEach(([b, x], k) => { si[i * 4 + k] = b; sw[i * 4 + k] = x / sum; });
      // 손가락 마디 축에서의 반지름 벡터 (굵기 보정은 마디 부분에만)
      let dd = Infinity;
      for (let k = B.axis + 1; k < 4; k++) { const d = segDist(v, B.segs[k][0], B.segs[k][1], tmp); if (d < dd) { dd = d; cp.copy(tmp); } }
      gd.set([v.x - cp.x, v.y - cp.y, v.z - cp.z, hand * s[B.axis]], i * 4);
      fid[i] = f;
      thin[i] = 0.12 + 0.88 * hand * s[0];
    }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geo.setAttribute('thin', new THREE.BufferAttribute(thin, 1));
    geo.setAttribute('girthData', new THREE.BufferAttribute(gd, 4));
    geo.setAttribute('fingerId', new THREE.BufferAttribute(fid, 1));
    // 모델 손가락 마디 폭(스캔값과 비교해 굵기 보정)
    const dorsal = (f, dir) => perp(f === 0 ? V().copy(this.Lb).multiplyScalar(0.75).addScaledVector(this.backB, 0.65) : this.backB.clone(), dir);
    this.modelW = CHAIN.map((ch, f) => [0, 1, 2].map(k => {
      if (f === 0 && k === 0) return 0;
      const a = P[ch[k]], b = P[ch[k + 1]], dir = V().subVectors(b, a).normalize();
      const mid = V().lerpVectors(a, b, k === 2 ? 0.4 : 0.5);
      const side = f === 0 ? V().crossVectors(dir, dorsal(0, dir)).normalize() : perp(this.Lb.clone(), dir);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < n; i++) {
        if (fid[i] !== f || gd[i * 4 + 3] < 0.5) continue;
        v.fromBufferAttribute(Pa, i).sub(mid);
        if (Math.abs(v.dot(dir)) > 0.003 || v.length() > 0.02) continue;
        const s = v.dot(side); lo = Math.min(lo, s); hi = Math.max(hi, s);
      }
      return hi > lo ? hi - lo : 0;
    }));
  }

  applySkin() {
    const c = skinColor;
    this.mat.color.setRGB(...[c.r, c.g, c.b].map((x, k) => clamp(x / TEX_SKIN[k], 0.4, 2.6)));
  }

  // J: 화면용 관절 21개(카메라 공간 — 손 위치와 손바닥 방향에 씀), local: 3D 손 모양(크기·마디 비율),
  // pose: 손가락 판단 결과(finger-pose.js), pr: 손 스캔 결과,
  // arm: 몸 인식의 팔 { toE: 손목→팔꿈치, toS: 손목→어깨 } (카메라 공간 m, 안 보이는 쪽은 null / 전체가 null 일 수도)
  update(J, local, pose, arm, dt, pr, visible) {
    this.group.visible = visible && !!pose;
    if (!this.group.visible) { this.wasVisible = false; return; }
    const snap = !this.wasVisible;
    this.wasVisible = true;
    const BP = this.bindP, Q = this.Q, Pt = this.Pt;

    // 손 크기: 3D 손 모양의 손바닥 크기 ÷ 모델 손바닥 크기 (천천히)
    const st = clamp(this.palmSize(n => local[{ wrist: 0, 'index-finger-phalanx-proximal': 5, 'middle-finger-phalanx-proximal': 9, 'ring-finger-phalanx-proximal': 13, 'pinky-finger-phalanx-proximal': 17 }[n]]) / this.size0, 0.6, 1.25);
    this.scale = snap ? st : this.scale + (st - this.scale) * (1 - Math.exp(-dt * 1.5));
    const s = this.scale;

    // 내 손가락 마디 길이 비율 (여러 프레임 중앙값, ±15% 이내)
    if (this.lenTick++ % 3 === 0) CHAIN.forEach((ch, f) => {
      for (let k = 0; k < 2; k++) {
        const arr = this.lenS[f][k];
        arr.push(local[FINGERS[f][k]].distanceTo(local[FINGERS[f][k + 1]]) / (s * this.seg[ch[k]].len));
        if (arr.length > 90) arr.shift();
        if (arr.length >= 15) this.ratio[f][k] += (clamp(median(arr), 0.85, 1.15) - this.ratio[f][k]) * 0.05;
      }
      this.ratio[f][2] = clamp((this.ratio[f][0] + this.ratio[f][1]) / 2, 0.93, 1.07);
    });

    // 손가락 굵기: 스캔한 마디 폭 ÷ (모델 폭 × 크기)
    for (let f = 0; f < 5; f++) {
      let sum = 0, cnt = 0;
      for (let k = f === 0 ? 1 : 0; k < 3; k++) {
        const m = pr?.get(`w${f}${f === 0 ? k - 1 : k}`), mw = this.modelW[f][k];
        if (m && mw) { sum += m / (mw * s); cnt++; }
      }
      const g = cnt ? clamp(sum / cnt, 0.85, 1.2) : 1;
      this.girth[f] += (g - this.girth[f]) * (snap ? 1 : 1 - Math.exp(-dt * 2));
    }

    // ① 손바닥: 위치는 손목, 방향은 손바닥 좌표계 (카메라 관절)
    const Ft = V().subVectors(J[9], J[0]).normalize();
    const Lt = perp(V().subVectors(J[5], J[17]), Ft);
    const Rp = new THREE.Quaternion().setFromRotationMatrix(_m1.multiplyMatrices(basis(_m2, Ft, Lt), this.MbT));

    // ② 손가락: 판단한 관절 각도만큼 모델 바인드 포즈를 굽힌다 (바인드 공간에서 계산 → 손바닥 회전으로 옮김)
    //    뼈 길이는 그대로라 늘어나지 않고, 굽힘은 항상 손바닥 쪽 경첩 축이라 꼬이거나 옆으로 꺾이지 않는다
    const B = this.Bb, A0 = this.bindAng, Qbs = {}, Pbs = {};
    const rot = (axis, deg) => new THREE.Quaternion().setFromAxisAngle(axis, deg * DEG);
    const chain = (f, qs) => {
      const ch = CHAIN[f];
      Pbs[ch[0]] = BP[ch[0]].clone();
      for (let k = 0; k < 3; k++) {
        Qbs[ch[k]] = qs[k].clone();
        Pbs[ch[k + 1]] = Pbs[ch[k]].clone().addScaledVector(this.seg[ch[k]].D.clone().applyQuaternion(qs[k]), this.seg[ch[k]].len * this.ratio[f][k]);
      }
      Qbs[ch[3]] = Qbs[ch[2]];
    };
    for (let f = 1; f < 5; f++) {
      const fp = pose.fingers[f], f0 = A0.fingers[f];
      const qa = rot(this.abAxis, fp.a - f0.a);
      const cm = fp.m - f0.m, cp = cm + fp.p - f0.p, cd = cp + fp.d - f0.d;
      chain(f, [cm, cp, cd].map(c => qa.clone().multiply(rot(B.H, c))));
    }
    {
      const tp = pose.thumb, t0 = A0.thumb, base = this.seg[CHAIN[0][0]].D;
      const dir = V().addScaledVector(B.F, tp.dir.x).addScaledVector(B.L, tp.dir.y).addScaledVector(B.U, tp.dir.z).normalize();
      cone(dir, base, LIM.thumbCmc);
      const qc = new THREE.Quaternion().setFromUnitVectors(base, dir);
      const hT = thumbHinge(dir, B);
      const c1 = tp.t1 - t0.t1, c2 = c1 + tp.t2 - t0.t2;
      chain(0, [qc, rot(hT, c1).multiply(qc), rot(hT, c2).multiply(qc)]);
    }

    // ③ 카메라 공간으로 옮기기
    const toCam = (n, p) => Pt[n].copy(p).sub(BP.wrist).applyQuaternion(Rp).multiplyScalar(s).add(J[0]);
    Pt.wrist.copy(J[0]);
    Q.wrist.copy(Rp);
    for (const n of META) { toCam(n, BP[n]); Q[n].copy(Rp); }
    for (const n in Qbs) { toCam(n, Pbs[n]); Q[n].copy(Rp).multiply(Qbs[n]); }

    // ④ 손 뼈에 적용 (부드럽게)
    const k = snap ? 1 : 1 - Math.exp(-dt * 30);
    for (const n of HAND_BONES) {
      const b = this.bone[n];
      b.position.lerp(Pt[n], k);
      b.quaternion.slerp(Q[n], k);
      b.scale.setScalar(s);
    }
    this.poseArm(arm, s, dt, snap);
  }

  // ⑤ 팔: 팔 길이는 모델 길이 × 손 크기라 손과 비율이 맞고, 팔뚝은 항상 손목에 붙어 있다
  poseArm(arm, s, dt, snap) {
    const A = this.armB, sd = this.sign;
    const Wp = this.bone.wrist.position, Wq = this.bone.wrist.quaternion;
    const L1 = A.lenU * s, L2 = A.lenF * s;
    const Fh = this.Fb.clone().applyQuaternion(Wq); // 손이 향한 방향
    const pole = V().set(POLE.x * sd, POLE.y, POLE.z);
    const ease = r => (snap ? 1 : 1 - Math.exp(-dt * r));
    // 팔뚝 방향(팔꿈치 → 손목): 손목이 실제 범위 이상 꺾이지 않게
    const foreDir = E => {
      const aF = V().subVectors(Wp, E).normalize(), bend = aF.angleTo(Fh);
      if (bend > WRIST_MAX) { _q.setFromUnitVectors(Fh, aF); aF.copy(Fh).applyQuaternion(new THREE.Quaternion().slerp(_q, WRIST_MAX / bend)); }
      return aF;
    };
    // 팔꿈치 경첩 축: 팔이 거의 펴지면 직전 축을 이어 써서 갑자기 뒤집히지 않게
    const hingeOf = (aU, aF) => {
      const h = V().crossVectors(aU, aF);
      return (h.length() < 0.15 ? (this.hinge ? perp(this.hinge.clone(), aF) : V().crossVectors(pole, aF)) : h).normalize();
    };
    // 손이 팔뚝 기준으로 돌아간 각도 (팔뚝 비틀림)
    const rollOf = (qF, aF) => {
      const rf = A.ref.clone().applyQuaternion(qF), rh = perp(this.Lb.clone().applyQuaternion(Wq), aF);
      return Math.atan2(_a.crossVectors(rf, rh).dot(aF), rf.dot(rh));
    };

    // 어깨: 몸 인식 어깨(손목 기준, 내 팔 길이 → 모델 팔 길이 비율로) 또는 몸 쪽 고정점
    let k = 1;
    if (arm?.toE && arm?.toS) { const pl = arm.toE.length() + arm.toS.distanceTo(arm.toE); if (pl > 0.2) k = (L1 + L2) / pl; }
    const Sg = arm?.toS ? V().copy(Wp).addScaledVector(arm.toS, k) : V().set(SHOULDER.x * sd, SHOULDER.y, SHOULDER.z);
    this.S = !this.S || snap ? Sg : this.S.lerp(Sg, ease(5));
    // 팔꿈치: 몸 인식 팔꿈치 방향. 없으면 어깨에서 IK 한 팔꿈치와 손목이 편하게 펴진 방향(손 반대쪽)을 섞고,
    // 팔꿈치가 어깨-손목 축 둘레 어느 쪽을 향할지는 팔뚝이 가장 덜 비틀리는 쪽으로 고른다 (손을 돌리면 팔꿈치도 따라 돎)
    let Eg;
    if (arm?.toE) Eg = V().copy(Wp).addScaledVector(arm.toE, L2 / arm.toE.length());
    else {
      const u = V().subVectors(Wp, this.S).normalize();
      const guess = sw => this.ikElbow(Wp, this.S, L1, L2, pole.clone().applyAxisAngle(u, sw)).sub(Wp).normalize()
        .multiplyScalar(0.6).addScaledVector(Fh, -0.4).normalize().multiplyScalar(L2).add(Wp);
      let best = 0, bc = Infinity;
      for (let sw = -100; sw <= 100; sw += 20) {
        const aF = foreDir(guess(sw * DEG)), aU = V().copy(Wp).addScaledVector(aF, -L2).sub(this.S).normalize();
        const c = Math.abs(rollOf(rotBetween(A.fore, A.hinge, aF, hingeOf(aU, aF)), aF)) + 0.35 * Math.abs(sw * DEG);
        if (c < bc) { bc = c; best = sw * DEG; }
      }
      this.swivel = snap ? best : this.swivel + (best - this.swivel) * ease(4);
      Eg = guess(this.swivel);
    }
    this.E = !this.E || snap ? Eg : this.E.lerp(Eg, ease(arm?.toE ? 12 : 6));
    const aF = foreDir(this.E), Eb = V().copy(Wp).addScaledVector(aF, -L2);
    this.E.copy(Eb);
    // 위팔: 팔꿈치에서 어깨 쪽으로 (어깨 끝은 화면 밖)
    const aU = V().subVectors(Eb, this.S);
    if (aU.lengthSq() < 1e-6) aU.copy(aF);
    aU.normalize();
    const Sh = V().copy(Eb).addScaledVector(aU, -L1);
    const hinge = hingeOf(aU, aF);
    this.hinge = hinge.clone();
    const qU = rotBetween(A.up, A.hinge, aU, hinge), qF = rotBetween(A.fore, A.hinge, aF, hinge);
    // 팔뚝 비틀림: 연속되게 이어서 재고, 손목 쪽 비틀림은 TWIST_MAX 까지만.
    // 그보다 더 돌아간 만큼은 팔꿈치 쪽 팔뚝이 같이 돌아서(화면 밖), 손목이 꼬여 가늘어지지 않게
    const raw = rollOf(qF, aF);
    let dr = raw - this.phiRaw;
    dr -= Math.round(dr / (2 * Math.PI)) * 2 * Math.PI;
    this.phiRaw = snap ? raw : this.phiRaw + dr;
    if (Math.abs(this.phiRaw) > Math.PI * 1.5) this.phiRaw -= Math.sign(this.phiRaw) * 2 * Math.PI;
    const total = clamp(this.phiRaw, -170 * DEG, 170 * DEG);
    this.phi = snap ? total : this.phi + (total - this.phi) * ease(20);
    const root = this.phi - clamp(this.phi, -TWIST_MAX, TWIST_MAX);
    const set = (n, p, q) => { const b = this.bone[n]; b.position.copy(p); b.quaternion.copy(q); b.scale.setScalar(s); };
    set('upperarm', Sh, qU);
    set('forearm', Eb, new THREE.Quaternion().setFromAxisAngle(aF, root).multiply(qF));
    set('forearm-twist', Eb, new THREE.Quaternion().setFromAxisAngle(aF, this.phi).multiply(qF));
  }

  // 어깨 S 에서 손목 W 까지 두 마디 IK 의 팔꿈치 (팔꿈치는 pole 쪽으로)
  ikElbow(W, S, L1, L2, pole) {
    const toW = V().subVectors(W, S), d = toW.length();
    const dc = clamp(d, Math.abs(L1 - L2) + 0.02, (L1 + L2) * 0.97);
    const S2 = V().copy(W).addScaledVector(toW.normalize(), -dc), u = V().subVectors(W, S2).divideScalar(dc);
    const pv = perp(pole.clone(), u);
    const a = (L1 * L1 - L2 * L2 + dc * dc) / (2 * dc), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    return S2.addScaledVector(u, a).addScaledVector(pv, h);
  }
}

// ───────── 피부색 ─────────
const srgb = c => c.getStyle(THREE.SRGBColorSpace).match(/[\d.]+/g).map(v => Number(v) / 255);
export function setSkinColor(r, g, b) {
  skinColor = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  for (const rig of rigs) rig.applySkin();
}
export function setSkinTone(name) { setSkinColor(...srgb(new THREE.Color(SKIN_TONES[name] ?? SKIN_TONES.medium))); }
// 카메라에서 잰 피부색(0~255) → 실내 조명 영향을 줄여 자연스러운 범위로
export function setSkinFromCamera(rgb) {
  const c = new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
  const hsl = {};
  c.getHSL(hsl, THREE.SRGBColorSpace);
  const h = clamp(hsl.h > 0.5 ? hsl.h - 1 : hsl.h, 0.0, 0.1);
  c.setHSL((h + 1) % 1, clamp(hsl.s * 1.2, 0.25, 0.6), clamp(0.16 + hsl.l * 0.66, 0.22, 0.66), THREE.SRGBColorSpace);
  setSkinColor(...srgb(c));
}
