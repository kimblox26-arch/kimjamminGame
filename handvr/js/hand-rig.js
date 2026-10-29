// 실제 사람 손 3D 모델(리깅된 스킨 메시) + MediaPipe 관절 리타기팅
//
// 모델: WebXR 표준 generic-hand (models/, MIT). 사람 손 형태의 메시에 뼈 25개, 정점마다 스킨 가중치.
//   불러온 뒤 한 번 Loop 세분화해서 표면을 매끈하게 만든다 (가중치도 같이 보간).
//
// 움직이는 방법 (늘어남·꼬임·겹침 방지):
//   1) 손바닥: 카메라 관절(손목·검지·중지·새끼 뿌리)로 손바닥 좌표계를 만들고, 모델 손바닥을 그 회전으로 돌린다.
//   2) 손가락 뼈: 위치를 그대로 옮기지 않고 '방향'만 맞춘다. 뼈 길이는 모델 길이(×손 크기×내 손 비율, 천천히 보정)로
//      고정이라 손가락이 늘어나거나 줄어들지 않는다.
//   3) 비틀림: 각 뼈의 옆 방향(굽힘 축)을 손바닥 회전으로 옮겨서 맞추므로 뼈가 축 방향으로 꼬이지 않는다.
//   4) 관절 제한: 둘째·셋째 마디는 굽힘 축으로만(옆으로 꺾이지 않음), 굽힘 각도 범위 제한,
//      뿌리 관절은 굽힘/벌림 범위 제한 + 이웃 손가락과 벌림 각 순서를 지켜 서로 파고들거나 겹치지 않게.
//   5) 부드럽게: 관절 좌표는 One-Euro 필터, 뼈 회전은 프레임마다 slerp.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeSkin, nailTexture, fabricNormal } from './skin.js';
import { FINGERS } from './hands.js';
import { measureAngles, palmBasis, thumbHinge } from './finger-pose.js';

export const SKIN_TONES = { light: 0xf3cbb0, medium: 0xdca47f, tan: 0xb87b53, deep: 0x7b4a2f };

const FN = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
// 손가락별 뼈 사슬 (MediaPipe 관절 FINGERS[f] 와 1:1)
const CHAIN = FN.map((n, f) => (f === 0
  ? ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']
  : [`${n}-phalanx-proximal`, `${n}-phalanx-intermediate`, `${n}-phalanx-distal`, `${n}-tip`]));
const META = FN.slice(1).map(n => `${n}-metacarpal`);
const DEG = Math.PI / 180;
// 관절 각도 범위 (라디안)
const LIM = { thumbCmc: 55 * DEG }; // 엄지 뿌리가 모델 기본 방향에서 벌어질 수 있는 최대 각

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _d = V(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion();
const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

// 직교 기저(열: x, y, z) 행렬
function basis(out, x, y) { _c.crossVectors(x, y); return out.makeBasis(x, y, _c); }
function perp(v, axis) { return v.addScaledVector(axis, -v.dot(axis)).normalize(); }
// v 를 기준 방향 base 에서 최대 maxAng 까지만 벌어지게
function cone(v, base, maxAng) {
  const ang = v.angleTo(base);
  if (ang <= maxAng || ang < 1e-6) return v;
  _q.setFromUnitVectors(base, v);
  const t = maxAng / ang;
  return v.copy(base).applyQuaternion(new THREE.Quaternion().slerp(_q, t)).normalize();
}

// ───────── 메시 정리: 위치가 같은 정점 합치기 + Loop 세분화 (스킨 가중치 포함) ─────────
const NB = 25;
function weldSkinned(geo) {
  const P = geo.attributes.position, SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight;
  const map = new Map(), pos = [], W = [], remap = new Uint32Array(P.count);
  for (let i = 0; i < P.count; i++) {
    const k = `${P.getX(i).toFixed(5)},${P.getY(i).toFixed(5)},${P.getZ(i).toFixed(5)}`;
    let id = map.get(k);
    if (id === undefined) {
      id = pos.length / 3; map.set(k, id);
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      const w = new Float32Array(NB);
      for (let j = 0; j < 4; j++) w[SI.getComponent(i, j)] += SW.getComponent(i, j);
      W.push(w);
    }
    remap[i] = id;
  }
  const idx = geo.index.array, out = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) out[i] = remap[idx[i]];
  return { P: new Float32Array(pos), W, idx: out };
}

function loopSubdivide({ P, W, idx }) {
  const n = P.length / 3, edges = new Map(), nbr = Array.from({ length: n }, () => new Set());
  const key = (a, b) => (a < b ? a * n + b : b * n + a);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx[t + e], b = idx[t + (e + 1) % 3], c = idx[t + (e + 2) % 3], k = key(a, b);
    let E = edges.get(k);
    if (!E) { E = { a, b, opp: [] }; edges.set(k, E); }
    E.opp.push(c);
    nbr[a].add(b); nbr[b].add(a);
  }
  const bnd = Array.from({ length: n }, () => []);
  for (const E of edges.values()) if (E.opp.length !== 2) { bnd[E.a].push(E.b); bnd[E.b].push(E.a); }
  let m = n;
  for (const E of edges.values()) E.id = m++;
  const NP = new Float32Array(m * 3), NW = Array.from({ length: m }, () => new Float32Array(NB));
  const acc = (dst, src, w) => { NP[dst * 3] += P[src * 3] * w; NP[dst * 3 + 1] += P[src * 3 + 1] * w; NP[dst * 3 + 2] += P[src * 3 + 2] * w; const D = NW[dst], S = W[src]; for (let j = 0; j < NB; j++) D[j] += S[j] * w; };
  for (let v = 0; v < n; v++) {
    if (bnd[v].length >= 2) { acc(v, v, 0.75); acc(v, bnd[v][0], 0.125); acc(v, bnd[v][1], 0.125); continue; }
    const k = nbr[v].size, beta = k > 3 ? 3 / (8 * k) : 3 / 16;
    acc(v, v, 1 - k * beta);
    for (const u of nbr[v]) acc(v, u, beta);
  }
  for (const E of edges.values()) {
    if (E.opp.length === 2) { acc(E.id, E.a, 0.375); acc(E.id, E.b, 0.375); acc(E.id, E.opp[0], 0.125); acc(E.id, E.opp[1], 0.125); }
    else { acc(E.id, E.a, 0.5); acc(E.id, E.b, 0.5); }
  }
  const out = new Uint32Array(idx.length * 4);
  let o = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ab = edges.get(key(a, b)).id, bc = edges.get(key(b, c)).id, ca = edges.get(key(c, a)).id;
    out.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], o); o += 12;
  }
  return { P: NP, W: NW, idx: out };
}

function toGeometry({ P, W, idx }) {
  const n = P.length / 3, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const order = [...W[v].keys()].sort((x, y) => W[v][y] - W[v][x]).slice(0, 4);
    const sum = order.reduce((s, j) => s + W[v][j], 0) || 1;
    order.forEach((j, k) => { si[v * 4 + k] = j; sw[v * 4 + k] = W[v][j] / sum; });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

// ───────── 모델 불러오기 ─────────
const loader = new GLTFLoader();
const rigs = new Set();
let skinColor = new THREE.Color(0xdca47f), skinDk = 0.3;
let NAIL_TEX = null, FABRIC = null;

export async function loadHandRigs() {
  const [L, R] = await Promise.all(['L', 'R'].map(async side => {
    const gltf = await loader.loadAsync(new URL(`../models/hand-${side === 'L' ? 'left' : 'right'}.glb`, import.meta.url).href);
    return new HandRig(side, gltf);
  }));
  return { L, R };
}

class HandRig {
  constructor(side, gltf) {
    rigs.add(this);
    this.side = side;
    this.sign = side === 'R' ? 1 : -1;
    this.group = new THREE.Group();
    this.group.visible = false;
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const src = root.getObjectByProperty('isSkinnedMesh', true);
    this.skeleton = src.skeleton;
    this.bone = {};
    for (const b of this.skeleton.bones) this.bone[b.name] = b;
    const bp = n => this.bone[n].position, bq = n => this.bone[n].quaternion;
    this.bindP = {}; this.bindQ = {};
    for (const n in this.bone) { this.bindP[n] = bp(n).clone(); this.bindQ[n] = bq(n).clone(); }
    const P = this.bindP;

    // 모델의 손바닥 좌표계 (바인드 포즈)
    this.Fb = V().subVectors(P['middle-finger-phalanx-proximal'], P.wrist).normalize();
    this.Lb = perp(V().subVectors(P['index-finger-phalanx-proximal'], P['pinky-finger-phalanx-proximal']), this.Fb);
    this.Ub = V().crossVectors(_a.subVectors(P['index-finger-phalanx-proximal'], P.wrist), _b.subVectors(P['pinky-finger-phalanx-proximal'], P.wrist)).normalize().multiplyScalar(this.sign);
    this.Mb = basis(new THREE.Matrix4(), this.Fb, this.Lb);
    this.MbT = this.Mb.clone().transpose();
    this.backB = this.Ub.clone().negate();

    // 뼈별 바인드 방향·길이
    this.seg = {};
    CHAIN.forEach(ch => ch.slice(0, 3).forEach((n, k) => {
      const D = V().subVectors(P[ch[k + 1]], P[n]);
      const len = D.length(); D.normalize();
      this.seg[n] = { D, len };
    }));
    this.size0 = this.palmSize(n => P[n]);
    // 손가락 판단 각도의 기준(모델 바인드 포즈의 각도). 같은 방식으로 재야 차이만큼만 굽힌다
    const IDX = ['wrist'];
    CHAIN.forEach((ch, f) => ch.forEach((n, k) => { IDX[FINGERS[f][k]] = n; }));
    this.Bb = palmBasis(P.wrist, P[IDX[5]], P[IDX[9]], P[IDX[17]], this.sign);
    this.abAxis = V().crossVectors(this.Bb.F, this.Bb.L).normalize(); // +회전 = 엄지 쪽으로 벌림
    this.bindAng = measureAngles(i => P[IDX[i]], this.Bb);

    // 메시: 세분화 + 피부 속성
    const geo = toGeometry(loopSubdivide(weldSkinned(src.geometry)));
    this.girth = new Float32Array([1, 1, 1, 1, 1]);
    this.mat = makeSkin({ detail: true, girth: this.girth, vertexColors: true });
    this.prepareAttributes(geo);
    this.mesh = new THREE.SkinnedMesh(geo, this.mat);
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.bind(this.skeleton, src.bindMatrix);
    src.parent.add(this.mesh);
    src.removeFromParent();
    this.group.add(root);

    this.makeNails(geo);
    this.makeArm(geo);
    this.applySkin();

    this.Q = {}; this.Pt = {};
    for (const n in this.bone) { this.Q[n] = new THREE.Quaternion(); this.Pt[n] = V(); }
    this.scale = 1;
    this.ratio = CHAIN.map(ch => ch.slice(0, 3).map(() => 1));
    this.lenS = CHAIN.map(ch => ch.slice(0, 3).map(() => []));
    this.lenTick = 0;
    this.wasVisible = false;
  }

  palmSize(get) {
    const w = get('wrist');
    return ['index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal', 'ring-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal']
      .reduce((s, n) => s + w.distanceTo(get(n)), 0) / 4;
  }

  // 정점 속성: 손가락 굵기 보정용(축에서의 반지름 벡터), 마디 주름 좌표, 투과(얇은 정도), 색 배합 정보
  prepareAttributes(geo) {
    const P = geo.attributes.position, N = geo.attributes.normal, SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight;
    const n = P.count, names = this.skeleton.bones.map(b => b.name), BP = this.bindP;
    const fingerOf = names.map(nm => FN.findIndex(f => nm.startsWith(f) && !nm.endsWith('metacarpal')));
    const thin = new Float32Array(n), kn = new Float32Array(n * 4), gd = new Float32Array(n * 4), fid = new Float32Array(n);
    this.colorInfo = new Float32Array(n * 3); // 손바닥 쪽 정도, 손끝 정도, 마디 붉은 기
    const v = V(), nr = V(), cp = V(), axis = V();
    // 손가락별 축(관절 점들), 손등 방향, 주름 중심
    const axes = CHAIN.map(ch => ch.map(nm => BP[nm]));
    const dorsalOf = (f, dir) => {
      const d = f === 0 ? V().copy(this.Lb).multiplyScalar(0.75).addScaledVector(this.backB, 0.65) : this.backB.clone();
      return perp(d, dir);
    };
    // 손가락을 따라 이어지는 길이 좌표(s): 뿌리 관절에서 0. 주름·마디 금 위치는 셰이더에서 이 좌표로 그린다
    const cum = axes.map(pts => { const c = [0]; for (let k = 0; k < 3; k++) c.push(c[k] + pts[k].distanceTo(pts[k + 1])); return c; });
    const wr = cum.map((c, f) => (f === 0 ? new THREE.Vector3(-1, c[1], c[2]) : new THREE.Vector3(c[0], c[1], c[2])));
    const cr = cum.map((c, f) => (f === 0 ? new THREE.Vector3(-1, c[1], c[2]) : new THREE.Vector3(c[1] * 0.38, c[1], c[2])));
    this.mat.userData.fold = { wrinkS: { value: wr }, creaseS: { value: cr } };
    const tipBones = new Set(CHAIN.flatMap(ch => [ch[2], ch[3]]));
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(P, i); nr.fromBufferAttribute(N, i);
      const fw = [0, 0, 0, 0, 0];
      let tipW = 0;
      for (let j = 0; j < 4; j++) {
        const b = SI.getComponent(i, j), w = SW.getComponent(i, j), f = fingerOf[b];
        if (f >= 0) fw[f] += w;
        if (tipBones.has(names[b])) tipW += w;
      }
      let fd = 0;
      for (let f = 1; f < 5; f++) if (fw[f] > fw[fd]) fd = f;
      const total = fw.reduce((s, x) => s + x, 0);
      thin[i] = 0.2 + 0.8 * total;
      // 가장 가까운 손가락 축 위의 점
      const pts = axes[fd];
      let best = Infinity;
      for (let k = 0; k < 3; k++) {
        axis.subVectors(pts[k + 1], pts[k]);
        const t = clamp(_a.subVectors(v, pts[k]).dot(axis) / axis.lengthSq(), 0, 1);
        _b.copy(pts[k]).addScaledVector(axis, t);
        const d = _b.distanceToSquared(v);
        if (d < best) { best = d; cp.copy(_b); }
      }
      gd.set([v.x - cp.x, v.y - cp.y, v.z - cp.z, fw[fd]], i * 4);
      fid[i] = fd;
      // 주름 좌표: 길이 s, 손등 쪽 세기, 손바닥 쪽 세기
      let sAlong = 0, segK = 0, bestS = Infinity;
      for (let k = 0; k < 3; k++) {
        axis.subVectors(pts[k + 1], pts[k]);
        const t = clamp(_a.subVectors(v, pts[k]).dot(axis) / axis.lengthSq(), k === 0 ? -0.5 : 0, k === 2 ? 2.2 : 1);
        const d = _b.copy(pts[k]).addScaledVector(axis, t).distanceToSquared(v);
        if (d < bestS) { bestS = d; sAlong = cum[fd][k] + t * axis.length(); segK = k; }
      }
      const dor = dorsalOf(fd, V().subVectors(pts[segK + 1], pts[segK]).normalize());
      const wgt = clamp(fw[fd] * 2, 0, 1);
      const kd = Math.pow(clamp(nr.dot(dor), 0, 1), 1.5) * wgt, kp = Math.pow(clamp(-nr.dot(dor), 0, 1), 1.5) * wgt;
      let kr = 0;
      for (const c of [cum[fd][1], cum[fd][2]]) kr = Math.max(kr, Math.exp(-((sAlong - c) ** 2) / 4e-5) * kd);
      kn.set([sAlong, kd, kp, 0], i * 4);
      this.colorInfo.set([Math.pow(clamp(nr.dot(this.Ub), 0, 1), 1.2), clamp(tipW, 0, 1), kr * 0.7], i * 3);
    }
    geo.setAttribute('thin', new THREE.BufferAttribute(thin, 1));
    const palmW = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      nr.fromBufferAttribute(N, i);
      palmW[i] = Math.pow(clamp(nr.dot(this.Ub), 0, 1), 1.5) * clamp(1 - thin[i] + 0.2, 0, 1);
      kn[i * 4 + 3] = Math.pow(clamp(-nr.dot(this.Ub), 0, 1), 1.5) * clamp(1 - thin[i] + 0.2, 0, 1); // 손등 (힘줄)
    }
    geo.setAttribute('palmW', new THREE.BufferAttribute(palmW, 1));
    // 손금 좌표: x = 새끼 뿌리(0) → 검지 뿌리(1), y = 손목(0) → 중지 뿌리(1)
    const pk = BP['pinky-finger-phalanx-proximal'], ix = BP['index-finger-phalanx-proximal'];
    const ax = this.Lb.clone(), ay = this.Fb.clone();
    this.mat.userData.palm = {
      palmO: { value: V().copy(BP.wrist).addScaledVector(ax, _a.subVectors(pk, BP.wrist).dot(ax)) },
      palmX: { value: ax.divideScalar(_a.subVectors(ix, pk).dot(this.Lb)) },
      palmY: { value: ay.divideScalar(_a.subVectors(BP['middle-finger-phalanx-proximal'], BP.wrist).dot(this.Fb)) },
      palmLen: { value: _a.subVectors(BP['middle-finger-phalanx-proximal'], BP.wrist).dot(this.Fb) },
    };
    geo.setAttribute('kn', new THREE.BufferAttribute(kn, 4));
    geo.setAttribute('girthData', new THREE.BufferAttribute(gd, 4));
    geo.setAttribute('fingerId', new THREE.BufferAttribute(fid, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    // 모델 손가락 마디 폭(스캔값과 비교해 굵기 보정)
    this.modelW = CHAIN.map((ch, f) => [0, 1, 2].map(k => {
      if (f === 0 && k === 0) return 0;
      const a = BP[ch[k]], b = BP[ch[k + 1]], dir = V().subVectors(b, a).normalize();
      const mid = V().lerpVectors(a, b, k === 2 ? 0.4 : 0.5);
      const side = f === 0 ? V().crossVectors(dir, dorsalOf(0, dir)).normalize() : perp(this.Lb.clone(), dir);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < n; i++) {
        if (fid[i] !== f || gd[i * 4 + 3] < 0.5) continue;
        v.fromBufferAttribute(P, i).sub(mid);
        if (Math.abs(v.dot(dir)) > 0.003 || v.length() > 0.02) continue;
        const s = v.dot(side); lo = Math.min(lo, s); hi = Math.max(hi, s);
      }
      return hi > lo ? hi - lo : 0;
    }));
  }

  refreshColors() {
    const c = this.mesh.geometry.attributes.color, a = c.array, ci = this.colorInfo, dk = skinDk;
    const lift = [1.04 + 0.3 * dk, 1.0 + 0.32 * dk, 0.97 + 0.32 * dk];
    for (let i = 0; i < c.count; i++) {
      const pw = ci[i * 3], tp = smooth(0.4, 1, ci[i * 3 + 1]), kr = ci[i * 3 + 2];
      a[i * 3] = (1 + (lift[0] - 1) * pw) * (1 + 0.04 * tp) * (1 - 0.03 * kr);
      a[i * 3 + 1] = (1 + (lift[1] - 1) * pw) * (1 - 0.05 * tp) * (1 - 0.1 * kr);
      a[i * 3 + 2] = (1 + (lift[2] - 1) * pw) * (1 - 0.04 * tp) * (1 - 0.1 * kr);
    }
    c.needsUpdate = true;
  }

  // 손톱: 바인드 포즈의 손끝 표면에 광선을 쏴서 표면 모양 그대로 휘어진 판을 만들고, 끝마디 뼈에 붙인다
  makeNails(geo) {
    NAIL_TEX ??= nailTexture();
    // 손톱도 피부 셰이더(SSS)를 써서 아래 살빛이 비치는 반투명한 느낌 + 광택 코팅
    this.nailMat = makeSkin({ map: NAIL_TEX, roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.08, specularIntensity: 0.6, sheen: 0, side: THREE.DoubleSide });
    const probe = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    probe.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const NU = 9, NV = 13, BP = this.bindP;
    this.nailPivots = [];
    CHAIN.forEach((ch, f) => {
      const D = BP[ch[2]], T = BP[ch[3]];
      const A = V().subVectors(T, D).normalize();
      // 모델의 tip 관절은 손끝보다 안쪽에 있으므로, 축을 따라 광선을 쏴서 실제 손끝 끝점까지의 길이를 잰다
      ray.set(V().copy(T).addScaledVector(A, 0.04), A.clone().negate());
      const endHit = ray.intersectObject(probe, false)[0];
      const Ld = endHit ? endHit.point.distanceTo(D) : D.distanceTo(T) * 1.8;
      const dor = f === 0 ? perp(V().copy(this.Lb).multiplyScalar(0.75).addScaledVector(this.backB, 0.65), A) : perp(this.backB.clone(), A);
      const side = V().crossVectors(dor, A);
      const pos = new Float32Array(NU * NV * 3), uv = new Float32Array(NU * NV * 2);
      const a0 = Ld * (f === 0 ? 0.4 : 0.44), a1 = Ld - 0.0026, thMax = (f === 0 ? 54 : 50) * DEG;
      const lastR = new Float32Array(NU).fill(0.006);
      for (let j = 0; j < NV; j++) {
        const t = j / (NV - 1), a = a0 + (a1 - a0) * Math.min(t, 0.88) / 0.88 + Math.max(0, t - 0.88) / 0.12 * 0.0018;
        const C = V().copy(D).addScaledVector(A, Math.min(a, a1));
        const wp = (0.62 + 0.38 * Math.sqrt(Math.max(0, 1 - (Math.max(0, 0.2 - t) / 0.2) ** 2))) * (t > 0.9 ? 0.8 + 0.2 * Math.sqrt(Math.max(0, 1 - ((t - 0.9) / 0.1) ** 2)) : 1);
        for (let i = 0; i < NU; i++) {
          const th = Math.PI / 2 + (i / (NU - 1) * 2 - 1) * thMax * wp;
          const dir = V().copy(side).multiplyScalar(Math.cos(th)).addScaledVector(dor, Math.sin(th)).normalize();
          let r = lastR[i];
          if (t <= 0.88) {
            ray.set(V().copy(C).addScaledVector(dir, 0.03), dir.clone().negate());
            const hit = ray.intersectObject(probe, false)[0];
            if (hit) { r = hit.point.distanceTo(C); lastR[i] = r; }
          }
          const lift = t < 0.06 ? -0.00015 : 0.00035 + 0.0002 * t; // 뿌리는 살 속으로, 끝은 살짝 떠서 두께감
          const p = V().copy(C).addScaledVector(A, Math.max(0, a - a1)).addScaledVector(dir, r + lift);
          pos.set([p.x, p.y, p.z], (j * NU + i) * 3);
          uv.set([i / (NU - 1), t], (j * NU + i) * 2);
        }
      }
      const idx = [];
      for (let j = 0; j < NV - 1; j++) for (let i = 0; i < NU - 1; i++) { const q = j * NU + i; idx.push(q, q + 1, q + NU, q + 1, q + NU + 1, q + NU); }
      const ng = new THREE.BufferGeometry();
      ng.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      ng.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      ng.setAttribute('thin', new THREE.BufferAttribute(new Float32Array(NU * NV).fill(1), 1));
      ng.setIndex(idx);
      // 끝마디 뼈 → 축 방향 피벗(굵기 보정 시 축 기준으로만 늘리기 위함)
      const bone = this.bone[ch[2]];
      const pivot = new THREE.Object3D();
      const qb = this.bindQ[ch[2]];
      pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), A.clone().applyQuaternion(qb.clone().invert()));
      bone.add(pivot);
      _m1.compose(D, qb, new THREE.Vector3(1, 1, 1)).multiply(_m2.makeRotationFromQuaternion(pivot.quaternion));
      ng.applyMatrix4(_m1.invert());
      ng.computeVertexNormals();
      const mesh = new THREE.Mesh(ng, this.nailMat);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      pivot.add(mesh);
      this.nailPivots.push(pivot);
    });
  }

  // 팔뚝·소매: 손목 단면 크기에 맞춘 매끈한 회전체 (손과는 별도, 팔꿈치 쪽으로 자연스럽게)
  makeArm(geo) {
    // 손 모델의 손목 쪽 끝 단면 크기 → 팔뚝이 거기서 단차 없이 이어지게
    const P = geo.attributes.position, w0 = this.bindP.wrist, v = V();
    let end = 0;
    for (let i = 0; i < P.count; i++) end = Math.min(end, v.fromBufferAttribute(P, i).sub(w0).dot(this.Fb));
    let wx = 0, wz = 0;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).sub(w0);
      if (v.dot(this.Fb) > end + 0.004) continue;
      wx = Math.max(wx, Math.abs(v.dot(this.Lb))); wz = Math.max(wz, Math.abs(v.dot(this.Ub)));
    }
    this.wristEnd = -end;
    this.wristR = { x: wx || 0.028, z: wz || 0.02 };
    const prof = [];
    for (let k = 0; k <= 24; k++) { const y = k / 24 * 0.34; prof.push(new THREE.Vector2(1 + 0.3 * smooth(0, 0.24, y) - 0.04 * smooth(0.26, 0.34, y), y)); }
    for (let k = 1; k <= 6; k++) { const a = k / 6 * Math.PI / 2; prof.push(new THREE.Vector2(1.26 * Math.cos(a), 0.34 + 0.03 * Math.sin(a))); } // 팔꿈치 쪽 둥근 끝
    this.armMat = makeSkin({ detail: true });
    this.arm = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), this.armMat);
    FABRIC ??= fabricNormal();
    const fab = FABRIC.clone(); fab.repeat.set(10, 6); fab.needsUpdate = true;
    this.sleeveMat = new THREE.MeshStandardMaterial({ color: 0x35598f, roughness: 0.96, normalMap: fab, side: THREE.DoubleSide });
    const slv = new THREE.CylinderGeometry(1.06, 1, 1, 40, 1, true); slv.translate(0, 0.5, 0);
    this.sleeve = new THREE.Mesh(slv, this.sleeveMat);
    this.cuff = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 10, 48), this.sleeveMat);
    for (const m of [this.arm, this.sleeve, this.cuff]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; this.group.add(m); }
  }

  applySkin() {
    for (const m of [this.mat, this.armMat]) m.color.copy(skinColor);
    this.nailMat.color.copy(skinColor).lerp(new THREE.Color(0xe9a79c), 0.5);
    this.refreshColors();
  }

  // J: 화면용 관절 21개(카메라 공간 — 손 위치와 손바닥 방향에 씀), local: 3D 손 모양(크기·마디 비율),
  // pose: 손가락 판단 결과(finger-pose.js), elbow: 손목→팔꿈치 { dir, len } (카메라 공간, 모르면 null), pr: 손 스캔 결과
  update(J, local, pose, elbow, dt, pr, visible) {
    this.group.visible = visible && !!pose;
    if (!this.group.visible) { this.wasVisible = false; return; }
    const snap = !this.wasVisible;
    this.wasVisible = true;
    const BP = this.bindP, BQ = this.bindQ, Q = this.Q, Pt = this.Pt;

    // 손 크기: 3D 손 모양의 손바닥 크기 ÷ 모델 손바닥 크기 (천천히)
    const st = clamp(this.palmSize(n => local[{ wrist: 0, 'index-finger-phalanx-proximal': 5, 'middle-finger-phalanx-proximal': 9, 'ring-finger-phalanx-proximal': 13, 'pinky-finger-phalanx-proximal': 17 }[n]]) / this.size0, 0.75, 1.35);
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
      this.nailPivots[f].scale.set(this.girth[f], 1, this.girth[f]);
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
        Qbs[ch[k]] = qs[k].clone().multiply(BQ[ch[k]]);
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
    Q.wrist.copy(Rp).multiply(BQ.wrist);
    for (const n of META) { toCam(n, BP[n]); Q[n].copy(Rp).multiply(BQ[n]); }
    for (const n in Qbs) { toCam(n, Pbs[n]); Q[n].copy(Rp).multiply(Qbs[n]); }

    // ④ 뼈에 적용 (부드럽게)
    const k = snap ? 1 : 1 - Math.exp(-dt * 30);
    for (const n in this.bone) {
      const b = this.bone[n];
      b.position.lerp(Pt[n], k);
      b.quaternion.slerp(Q[n], k);
      b.scale.setScalar(s);
    }

    // ⑤ 팔뚝: 몸 인식으로 찾은 팔꿈치 방향(있으면), 없으면 손 방향 + 몸 쪽 아래 방향으로 추정
    const sd = this.side === 'R' ? 1 : -1;
    const guess = V().set(sd * 0.28, -0.72, 0.62).normalize().multiplyScalar(0.55).addScaledVector(Ft, -0.45).normalize();
    const target = elbow?.dir ?? guess;
    this.armDir = snap || !this.armDir ? target.clone() : this.armDir.lerp(target, 1 - Math.exp(-dt * 8)).normalize();
    this.armLen = elbow ? clamp(elbow.len, 0.2, 0.34) : 0.3;
    const armDir = this.armDir;
    const ax = perp(Lt.clone(), armDir), az = V().crossVectors(ax, armDir);
    const base = V().copy(this.bone.wrist.position).addScaledVector(Ft, 0.012 * s);
    const rx = this.wristR.x * s * 0.985, rz = this.wristR.z * s * 0.985;
    const bare = !!pr?.sleeve?.bare;
    this.place(this.arm, base, ax, armDir, az, rx, (this.armLen + 0.012) / 0.34, rz);
    this.sleeve.visible = this.cuff.visible = !bare;
    if (!bare) {
      const sp = V().copy(base).addScaledVector(armDir, 0.14);
      this.place(this.sleeve, sp, ax, armDir, az, rx * 1.7, this.armLen - 0.12 + 0.15, rz * 1.75);
      this.place(this.cuff, sp, ax, az.clone().negate(), armDir, rx * 1.7, rz * 1.75, rx * 1.7);
    }
  }

  place(mesh, pos, x, y, z, sx, sy, sz) {
    _m1.makeBasis(x, y, z);
    mesh.quaternion.setFromRotationMatrix(_m1);
    mesh.position.copy(pos);
    mesh.scale.set(sx, sy, sz);
  }
}

// ───────── 피부색 · 소매색 ─────────
const srgb = c => c.getStyle(THREE.SRGBColorSpace).match(/[\d.]+/g).map(v => Number(v) / 255);
export function setSkinColor(r, g, b) {
  skinColor = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  skinDk = clamp((0.62 - lum) / 0.42, 0, 1);
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
export function setSleeve(sleeve) {
  for (const rig of rigs) {
    if (sleeve?.color) rig.sleeveMat.color.setRGB(...sleeve.color.map(v => v / 255), THREE.SRGBColorSpace);
    else rig.sleeveMat.color.setHex(0x35598f);
  }
}
