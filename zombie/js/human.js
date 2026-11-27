// 고품질 절차적 인체 v2
// - 끊김 없는 피부 메시(몸통·팔·다리 링 스윕 + 관절 가중치 보간), 얼굴 조각(눈두덩·코·광대·입술·턱), 눈알(홍채/동공), 치아, 머리카락, 손가락
// - 셰이더: 피부 모공/얼룩/핏줄/부패, 면·데님·나일론·니트·위장무늬 직조, 피 튄 자국(젖은 반사), 때, 피부 산란광 근사, 범프 노멀
// - 애니메이션: 절차적 보행/달리기/추격/공격/섭식/쓰러짐/일어남/기어가기 + 다리 IK(계단·경사), 머리 날아감·팔다리 절단
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { rng, pick, clamp, damp, lerp, smooth } from './util.js';

const N3 = new ImprovedNoise();
const BN = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'clL', 'uaL', 'faL', 'hdL', 'clR', 'uaR', 'faR', 'hdR', 'thL', 'shL', 'ftL', 'thR', 'shR', 'ftR'];
const PAR = [-1, 0, 1, 2, 3, 4, 5, 3, 7, 8, 9, 3, 11, 12, 13, 1, 15, 16, 1, 18, 19];
const I = Object.fromEntries(BN.map((n, i) => [n, i]));
function rest(s) {
  return [[0, 0, 0], [0, 0.97 * s, 0], [0, 0.1 * s, 0], [0, 0.17 * s, 0], [0, 0.24 * s, 0], [0, 0.08 * s, 0.01], [0, 0.035 * s, 0.012],
    [0.06, 0.17 * s, 0], [0.125 * s, -0.01, 0], [0, -0.28 * s, 0], [0, -0.25 * s, 0],
    [-0.06, 0.17 * s, 0], [-0.125 * s, -0.01, 0], [0, -0.28 * s, 0], [0, -0.25 * s, 0],
    [0.095 * s, -0.07 * s, 0], [0, -0.43 * s, 0], [0, -0.4 * s, 0], [-0.095 * s, -0.07 * s, 0], [0, -0.43 * s, 0], [0, -0.4 * s, 0]];
}
function worldJoints(s) { const r = rest(s), W = []; r.forEach((p, i) => { const q = PAR[i] < 0 ? [0, 0, 0] : W[PAR[i]]; W.push([q[0] + p[0], q[1] + p[1], q[2] + p[2]]); }); return W; }
function makeBones(s) { const r = rest(s), bones = r.map((p, i) => { const b = new THREE.Bone(); b.name = BN[i]; b.position.set(...p); return b; }); bones.forEach((b, i) => { if (PAR[i] >= 0) bones[PAR[i]].add(b); }); return bones; }

// 재질 타입(aMat.x)
const M = { skin: 0, cotton: 1, denim: 2, nylon: 3, leather: 4, hair: 5, eye: 6, teeth: 7, metal: 8, mouth: 9, sole: 10, neon: 11, camo: 12, knit: 13 };
const SKIN_C = [[0.86, 0.68, 0.56], [0.8, 0.62, 0.5], [0.9, 0.74, 0.63], [0.74, 0.56, 0.44], [0.84, 0.66, 0.52]];
const ZSKIN = [[0.62, 0.62, 0.56], [0.56, 0.56, 0.53], [0.66, 0.61, 0.57], [0.52, 0.55, 0.49], [0.6, 0.58, 0.6]];
const HAIR_C = [[0.035, 0.03, 0.028], [0.07, 0.05, 0.04], [0.025, 0.025, 0.027], [0.18, 0.12, 0.08], [0.11, 0.08, 0.06]];

// ---------- 지오메트리 빌더 ----------
class Builder {
  constructor() { this.p = []; this.uv = []; this.c = []; this.m = []; this.si = []; this.sw = []; this.idx = []; this.n = 0; }
  // g: 인덱스드 지오메트리(이미 바인드 포즈 좌표), W(x,y,z)->[[bone,w]..], C(x,y,z)->rgb, MT(x,y,z)->[type,blood,dirt,wet]
  add(g, W, C, MT, flip = false) {
    const pos = g.attributes.position, uv = g.attributes.uv, base = this.n;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      this.p.push(x, y, z); this.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      const c = typeof C === 'function' ? C(x, y, z) : C; this.c.push(c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2); // sRGB → 선형
      const mt = typeof MT === 'function' ? MT(x, y, z) : MT; this.m.push(mt[0], mt[1] || 0, mt[2] || 0, mt[3] || 0);
      const w = typeof W === 'function' ? W(x, y, z) : W; const ws = [0, 0, 0, 0], is = [0, 0, 0, 0]; let tot = 0;
      for (let k = 0; k < Math.min(4, w.length); k++) { is[k] = w[k][0]; ws[k] = w[k][1]; tot += w[k][1]; }
      for (let k = 0; k < 4; k++) ws[k] /= tot || 1;
      this.si.push(...is); this.sw.push(...ws);
    }
    const ix = g.index; const cnt = ix ? ix.count : pos.count;
    for (let i = 0; i < cnt; i += 3) { const a = ix ? ix.getX(i) : i, b = ix ? ix.getX(i + 1) : i + 1, c = ix ? ix.getX(i + 2) : i + 2; if (flip) this.idx.push(base + a, base + c, base + b); else this.idx.push(base + a, base + b, base + c); }
    this.n += pos.count;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.m, 4));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }
}
// 링 스윕 튜브: rings [{y,x,z,rx,zf,zb}], p = 초타원 지수
function sweep(rings, seg, p = 2, capBot = true, capTop = false) {
  const pos = [], idx = [], e = 2 / p;
  for (const r of rings) for (let j = 0; j < seg; j++) {
    const a = j / seg * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
    pos.push(r.x + (r.rx * Math.sign(s) * Math.pow(Math.abs(s), e)), r.y, r.z + (c > 0 ? r.zf : r.zb) * Math.sign(c) * Math.pow(Math.abs(c), e));
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + (j + 1) % seg, c = a + seg, d = b + seg;
    idx.push(a, c, b, b, c, d);
  }
  const cap = (ri, up) => { const r = rings[ri], ci = pos.length / 3; pos.push(r.x, r.y + (up ? 0.004 : -0.004), r.z); for (let j = 0; j < seg; j++) { const a = ri * seg + j, b = ri * seg + (j + 1) % seg; if (up) idx.push(a, b, ci); else idx.push(a, ci, b); } };
  if (capBot) cap(0, false); if (capTop) cap(rings.length - 1, true);
  // 링 순서가 위→아래면 감김이 반대
  if (rings.length > 1 && rings[0].y > rings[1].y) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
// y 기반 본 가중치 보간: nodes [[y, bone],...] 오름차순
function wy(y, nodes) {
  if (y <= nodes[0][0]) return [[nodes[0][1], 1]];
  for (let i = 0; i < nodes.length - 1; i++) { const [y0, b0] = nodes[i], [y1, b1] = nodes[i + 1]; if (y <= y1) { const t = smooth(y0, y1, y); return b0 === b1 ? [[b0, 1]] : [[b0, 1 - t], [b1, t]]; } }
  return [[nodes[nodes.length - 1][1], 1]];
}
const gauss = (x, y, z, c, wx, wy2, wz) => Math.exp(-((x - c[0]) ** 2 / (wx * wx) + (y - c[1]) ** 2 / (wy2 * wy2) + (z - c[2]) ** 2 / (wz * wz)));

const OUT = {
  tshirt: R => ({ top: pick(R, [[0.72, 0.72, 0.7], [0.13, 0.13, 0.15], [0.5, 0.12, 0.12], [0.2, 0.33, 0.52], [0.82, 0.76, 0.58], [0.32, 0.4, 0.3]]), topM: M.cotton, bot: pick(R, [[0.16, 0.21, 0.34], [0.12, 0.14, 0.22], [0.3, 0.28, 0.25]]), botM: M.denim, shoe: [0.86, 0.86, 0.84], sleeve: 'short' }),
  padding: R => ({ top: pick(R, [[0.05, 0.05, 0.06], [0.08, 0.1, 0.18], [0.66, 0.6, 0.48], [0.38, 0.4, 0.34], [0.5, 0.15, 0.15]]), topM: M.nylon, bot: [0.08, 0.08, 0.09], botM: M.cotton, shoe: [0.1, 0.1, 0.1], sleeve: 'long', puff: 0.032, hood: true, long: R() < 0.5 }),
  suit: R => ({ top: pick(R, [[0.07, 0.09, 0.15], [0.13, 0.13, 0.14], [0.22, 0.22, 0.24]]), topM: M.knit, bot: null, botM: M.knit, shoe: [0.04, 0.03, 0.03], shoeM: M.leather, sleeve: 'long', collar: [0.93, 0.93, 0.95], tie: pick(R, [[0.45, 0.06, 0.08], [0.1, 0.15, 0.35], [0.3, 0.3, 0.32]]) }),
  school: R => ({ top: [0.09, 0.12, 0.25], topM: M.knit, bot: [0.25, 0.25, 0.28], botM: M.knit, shoe: [0.92, 0.92, 0.92], sleeve: 'long', collar: [0.95, 0.95, 0.96], tie: [0.5, 0.08, 0.1], skirt: true }),
  sport: R => ({ top: pick(R, [[0.42, 0.42, 0.43], [0.1, 0.1, 0.11], [0.55, 0.14, 0.18], [0.15, 0.25, 0.4]]), topM: M.cotton, bot: [0.07, 0.07, 0.08], botM: M.cotton, shoe: [0.9, 0.9, 0.9], sleeve: 'long', hood: true }),
  hospital: R => ({ top: [0.55, 0.7, 0.72], topM: M.cotton, bot: [0.55, 0.7, 0.72], botM: M.cotton, shoe: [0.82, 0.82, 0.78], sleeve: 'short' }),
  police: R => ({ top: [0.11, 0.15, 0.23], topM: M.cotton, bot: [0.09, 0.11, 0.17], botM: M.cotton, shoe: [0.03, 0.03, 0.03], shoeM: M.leather, sleeve: 'long', vest: [0.72, 0.85, 0.12], vestM: M.neon }),
  soldier: R => ({ top: [0.3, 0.33, 0.2], topM: M.camo, bot: [0.3, 0.33, 0.2], botM: M.camo, shoe: [0.07, 0.06, 0.05], shoeM: M.leather, sleeve: 'long', vest: [0.22, 0.24, 0.16], vestM: M.cotton, helmet: true }),
  brute: R => ({ top: pick(R, [[0.78, 0.76, 0.7], [0.4, 0.4, 0.42]]), topM: M.cotton, bot: [0.36, 0.33, 0.24], botM: M.cotton, shoe: [0.15, 0.12, 0.1], shoeM: M.leather, sleeve: 'none' })
};

const vcache = new Map();
// kind: civ | zombie | zsoldier | zpolice | zbrute | soldier | police,  lod: 0 고품질 / 1 원거리
export function variantGeo(kind, idx, lod = 0) {
  const key = kind + idx + '_' + lod; if (vcache.has(key)) return vcache.get(key);
  const R = rng(idx * 7919 + kind.length * 131 + 7);
  const Z = kind[0] === 'z', brute = kind === 'zbrute', sold = kind.includes('soldier'), pol = kind.includes('police');
  const fem = sold || pol || brute ? false : R() < 0.45;
  const s = brute ? 1.08 : fem ? 0.93 + R() * 0.05 : 0.97 + R() * 0.07, g = brute ? 1.5 : (fem ? 0.9 : 1) * (0.92 + R() * 0.2);
  const outfit = sold ? OUT.soldier(R) : pol ? OUT.police(R) : brute ? OUT.brute(R) : OUT[pick(R, Z ? ['tshirt', 'padding', 'padding', 'suit', 'school', 'sport', 'hospital', 'hospital'] : ['tshirt', 'padding', 'padding', 'suit', 'school', 'sport'])](R);
  if (!outfit.bot) outfit.bot = outfit.top;
  if (outfit.skirt && !fem) outfit.skirt = false;
  const skin = Z ? pick(R, ZSKIN) : pick(R, SKIN_C), hairC = pick(R, HAIR_C), seed = R() * 100;
  const hairStyle = brute ? 'bald' : fem ? pick(R, ['long', 'long', 'bob', 'pony']) : pick(R, ['short', 'short', 'short', Z ? 'bald' : 'short', 'buzz']);
  const mask = !sold && R() < (Z ? 0.12 : 0.3), bag = !sold && !brute && R() < 0.3;
  const J = worldJoints(s), P = n => J[I[n]];
  const S = lod ? { tor: 18, limb: 10, head: [20, 14], fing: false } : { tor: 30, limb: 16, head: [44, 34], fing: true };
  const b = new Builder();
  // 피·때 분포(정점 단위, 셰이더가 고해상도 패턴으로 확장)
  const wounds = Z ? Array.from({ length: 3 + (R() * 3 | 0) }, () => [(R() - 0.5) * 0.4, 0.4 + R() * 1.2, (R() - 0.5) * 0.3, 0.06 + R() * 0.08]) : [];
  const hcY = P('head')[1] + 0.085 * s;
  const BL = (x, y, z) => {
    if (!Z) return 0.0;
    let v = 0.05 + N3.noise(x * 4 + seed, y * 4, z * 4) * 0.25;
    if (y > hcY - 0.12 && y < hcY - 0.01 && z > 0.03) v += 0.9; // 입 주변
    if (y > 1.0 && y < 1.45 && z > 0.05) v += 0.35; // 가슴
    if (y < 1.0 && y > 0.75 && Math.abs(x) > 0.15) v += 0.4; // 손
    for (const w of wounds) if (Math.hypot(x - w[0], y - w[1], z - w[2]) < w[3] * 1.5) v += 0.8;
    return clamp(v, 0, 1.3);
  };
  const DT = (x, y, z) => (Z ? 0.45 : 0.08) + (y < 0.4 ? 0.25 : 0) + N3.noise(x * 6, y * 6 + seed, z * 6) * 0.2;
  const mt = (type) => (x, y, z) => [type, BL(x, y, z), DT(x, y, z), 0];
  // 의복 판정
  const waist = 0.97 * s, sleeveY = outfit.sleeve === 'short' ? 1.24 * s : outfit.sleeve === 'none' ? 1.43 * s : 0.93 * s, hem = 0.1 * s;
  const torn = (x, y, z) => Z && N3.noise(x * 7 + 3, y * 7, z * 7 + seed) > 0.42;
  const clothCol = (base, type) => (x, y, z) => torn(x, y, z) ? skin : base;
  const clothM = (type) => (x, y, z) => [torn(x, y, z) ? M.skin : type, BL(x, y, z), DT(x, y, z), 0];
  // ----- 몸통 -----
  const TR = [[0.79, 0.085, 0.07, 0.08], [0.84, 0.15, 0.095, 0.115], [0.9, 0.168, 0.1, 0.122], [0.96, 0.162, 0.095, 0.106], [1.02, 0.15, 0.092, 0.088], [1.08, 0.146, 0.098, 0.083], [1.15, 0.154, 0.108, 0.088], [1.22, 0.166, 0.118, 0.095], [1.29, 0.174, 0.12, 0.1], [1.35, 0.178, 0.108, 0.098], [1.4, 0.17, 0.088, 0.09], [1.44, 0.13, 0.07, 0.075], [1.47, 0.07, 0.058, 0.062], [1.52, 0.054, 0.054, 0.05], [1.6, 0.05, 0.05, 0.046]];
  const tr = [];
  const rings = (src, n) => { const out = []; for (let i = 0; i < src.length - 1; i++) for (let k = 0; k < n; k++) { const t = k / n, a = src[i], c = src[i + 1]; out.push(a.map((v, q) => lerp(v, c[q], t))); } out.push(src[src.length - 1]); return out; };
  for (const r of rings(TR, lod ? 1 : 2)) {
    let [y, rx, zf, zb] = r; const top = y * s >= waist - 0.04;
    if (fem) { if (y > 0.82 && y < 0.98) rx *= 1.07; if (y > 1.0 && y < 1.12) rx *= 0.86; if (y > 1.32 && y < 1.46) rx *= 0.9; if (y > 1.17 && y < 1.32) zf += 0.025 * Math.sin((y - 1.17) / 0.15 * Math.PI); }
    if (brute && y > 0.95 && y < 1.25) zf += 0.07 * Math.sin((y - 0.95) / 0.3 * Math.PI);
    const gk = y > 1.45 ? 1 : g; rx *= gk; zf *= gk; zb *= gk;
    let puff = 0; if (top && y < 1.46 && outfit.puff) puff = outfit.puff + 0.007 * Math.abs(Math.sin(y * Math.PI / 0.075));
    if (!top && y < 1.0) puff = outfit.skirt ? 0 : 0.006;
    tr.push({ y: y * s, x: 0, z: 0, rx: rx + puff, zf: zf + puff, zb: zb + puff });
  }
  const torsoW = (x, y, z) => {
    let w = wy(y, [[0.86 * s, I.hips], [1.03 * s, I.spine], [1.22 * s, I.chest], [1.47 * s, I.neck], [1.6 * s, I.head]]);
    const t = smooth(0.09, 0.16, Math.abs(x)) * smooth(1.32 * s, 1.42 * s, y);
    if (t > 0) { w = w.map(([bb, ww]) => [bb, ww * (1 - t)]); w.push([x > 0 ? I.clL : I.clR, t]); }
    return w;
  };
  const isTop = y => y >= waist - 0.04 && y < 1.455 * s, isBot = y => y < waist - 0.04;
  b.add(sweep(tr, S.tor, 2.5), torsoW,
    (x, y, z) => isTop(y) ? clothCol(outfit.top)(x, y, z) : isBot(y) ? clothCol(outfit.bot)(x, y, z) : skin,
    (x, y, z) => isTop(y) ? clothM(outfit.topM)(x, y, z) : isBot(y) ? clothM(outfit.botM)(x, y, z) : mt(M.skin)(x, y, z));
  // 칼라/넥타이/조끼/후드/치마
  if (outfit.collar) b.add(sweep([{ y: 1.43 * s, x: 0, z: 0.004, rx: 0.076, zf: 0.066, zb: 0.07 }, { y: 1.49 * s, x: 0, z: 0.0, rx: 0.062, zf: 0.06, zb: 0.058 }], 16, 2, false), (x, y, z) => wy(y, [[1.44 * s, I.chest], [1.5 * s, I.neck]]), outfit.collar, [M.cotton, 0, 0.1, 0]);
  if (outfit.tie) b.add(sweep([{ y: 1.42 * s, x: 0, z: 0.105, rx: 0.016, zf: 0.006, zb: 0.006 }, { y: 1.3 * s, x: 0, z: 0.125, rx: 0.026, zf: 0.006, zb: 0.006 }, { y: 1.12 * s, x: 0, z: 0.115, rx: 0.03, zf: 0.005, zb: 0.005 }], 8, 2, true, true), torsoW, outfit.tie, mt(M.cotton));
  if (outfit.vest) b.add(sweep([1.04, 1.14, 1.24, 1.34, 1.42].map(y => ({ y: y * s, x: 0, z: 0, rx: 0.17 * g + 0.02, zf: (y > 1.17 && fem ? 0.14 : 0.125) * g + 0.022, zb: 0.105 * g + 0.02 })), S.tor, 3, true, true), torsoW, outfit.vest, mt(outfit.vestM));
  if (outfit.hood) b.add(sweep([{ y: 1.4 * s, x: 0, z: -0.09, rx: 0.12, zf: 0.03, zb: 0.07 }, { y: 1.46 * s, x: 0, z: -0.1, rx: 0.13, zf: 0.035, zb: 0.075 }, { y: 1.5 * s, x: 0, z: -0.1, rx: 0.1, zf: 0.02, zb: 0.05 }], 14, 2, true, true), (x, y, z) => wy(y, [[1.42 * s, I.chest], [1.5 * s, I.neck]]), (x, y, z) => clothCol(outfit.top)(x, y, z), clothM(outfit.topM));
  if (outfit.skirt) { const sk = sweep([0.97, 0.86, 0.74, 0.62].map((y, i) => ({ y: y * s, x: 0, z: 0, rx: 0.17 + i * 0.03, zf: 0.12 + i * 0.03, zb: 0.13 + i * 0.03 })), S.tor, 2, false); const sc = [0.2, 0.2, 0.24]; b.add(sk, [[I.hips, 1]], sc, mt(M.knit)); b.add(sk, [[I.hips, 1]], sc, mt(M.knit), true); }
  if (bag) b.add(new THREE.SphereGeometry(1, 12, 10).scale(0.15, 0.2, 0.07).translate(0, 1.2 * s, -0.17 * g), [[I.chest, 1]], pick(R, [[0.1, 0.1, 0.12], [0.3, 0.15, 0.1], [0.2, 0.3, 0.45]]), mt(M.nylon));
  // ----- 다리 -----
  const LG = [[0.98, 0.075, 0.075, 0.075], [0.92, 0.088, 0.085, 0.095], [0.84, 0.084, 0.082, 0.09], [0.74, 0.076, 0.075, 0.08], [0.62, 0.065, 0.066, 0.068], [0.53, 0.054, 0.058, 0.055], [0.47, 0.052, 0.054, 0.055], [0.4, 0.055, 0.05, 0.066], [0.32, 0.05, 0.045, 0.058], [0.22, 0.04, 0.038, 0.042], [0.13, 0.034, 0.033, 0.035], [0.08, 0.033, 0.033, 0.034]];
  for (const sd of [1, -1]) {
    const th = I[sd > 0 ? 'thL' : 'thR'], sh = I[sd > 0 ? 'shL' : 'shR'], ft = I[sd > 0 ? 'ftL' : 'ftR'];
    const lr = LG.slice().reverse().map(([y, r, zf, zb]) => { const pants = y * s > hem && !(outfit.skirt && y < 0.62); const gk = brute ? 1.3 : g, add = pants ? (outfit.botM === M.denim ? 0.008 : 0.012) : 0; return { y: y * s, x: sd * 0.095 * s * (0.9 + 0.1 * y / 0.98), z: 0, rx: r * gk * (fem && y > 0.7 ? 1.06 : 1) + add, zf: zf * gk + add, zb: zb * gk + add }; });
    const legRings = lod ? lr : rings(lr.map(r => [r.y, r.x, r.z, r.rx, r.zf, r.zb]), 2).map(([y, x, z, rx, zf, zb]) => ({ y, x, z, rx, zf, zb }));
    const isPants = y => y > hem && !(outfit.skirt && y < 0.62 * s);
    b.add(sweep(legRings, S.limb, 2, true, false), (x, y, z) => wy(y, [[0.05 * s, ft], [0.11 * s, sh], [0.43 * s, sh], [0.51 * s, th], [0.87 * s, th], [0.97 * s, I.hips]]),
      (x, y, z) => isPants(y) ? clothCol(outfit.bot)(x, y, z) : (outfit.skirt ? [0.12, 0.12, 0.13] : skin), (x, y, z) => isPants(y) ? clothM(outfit.botM)(x, y, z) : outfit.skirt ? [M.knit, BL(x, y, z), DT(x, y, z), 0] : mt(M.skin)(x, y, z));
    // 신발
    const shoe = new THREE.BoxGeometry(0.1 * (brute ? 1.15 : 1), 0.085, 0.27, 3, 2, 6), sp = shoe.attributes.position;
    for (let i = 0; i < sp.count; i++) { let X = sp.getX(i), Y = sp.getY(i), Zz = sp.getZ(i); const t = smooth(0.0, 0.135, Zz); X *= 1 - t * 0.25; Y = Y > 0 ? Y * (1 - t * 0.45) : Y; if (Zz < -0.1) X *= 0.85; sp.setXYZ(i, X, Y, Zz); }
    shoe.translate(sd * 0.095 * s * 0.9, 0.045, 0.06);
    b.add(shoe, (x, y, z) => wy(y, [[0.07, ft], [0.1, sh]]), outfit.shoe, mt(outfit.shoeM || M.leather));
    b.add(new THREE.BoxGeometry(0.104, 0.018, 0.275).translate(sd * 0.095 * s * 0.9, 0.006, 0.06), [[ft, 1]], [0.12, 0.12, 0.12], [M.sole, 0, 0.5, 0]);
  }
  // ----- 팔 + 손 -----
  const AR = [[1.45, 0.04, 0.04], [1.42, 0.055, 0.058], [1.37, 0.058, 0.06], [1.3, 0.05, 0.052], [1.22, 0.046, 0.05], [1.16, 0.041, 0.043], [1.12, 0.039, 0.042], [1.07, 0.043, 0.042], [1.0, 0.037, 0.035], [0.93, 0.029, 0.026], [0.885, 0.026, 0.022]];
  for (const sd of [1, -1]) {
    const L = sd > 0 ? 'L' : 'R', ua = P('ua' + L), cl = I['cl' + L];
    const sleeve = y => y > sleeveY;
    const ar = AR.map(([y, rx, rz]) => { const gk = brute ? 1.35 : g, pf = sleeve(y * s) ? (outfit.puff || 0) * 0.8 + 0.006 : 0; return { y: y * s, x: ua[0] - sd * 0.004 * (1.4 - y), z: 0, rx: rx * gk * (fem ? 0.9 : 1) + pf, zf: rz * gk * (fem ? 0.9 : 1) + pf, zb: rz * gk * (fem ? 0.9 : 1) + pf }; });
    b.add(sweep(lod ? ar : rings(ar.map(r => [r.y, r.x, r.z, r.rx, r.zf, r.zb]), 2).map(([y, x, z, rx, zf, zb]) => ({ y, x, z, rx, zf, zb })), S.limb, 2, true, true),
      (x, y, z) => wy(y, [[0.86 * s, I['hd' + L]], [0.92 * s, I['fa' + L]], [1.08 * s, I['fa' + L]], [1.16 * s, I['ua' + L]], [1.36 * s, I['ua' + L]], [1.45 * s, cl]]),
      (x, y, z) => sleeve(y) ? clothCol(outfit.top)(x, y, z) : skin, (x, y, z) => sleeve(y) ? clothM(outfit.topM)(x, y, z) : mt(M.skin)(x, y, z));
    const hx = ua[0] - sd * 0.006, wyy = 0.885 * s, hb = [[I['hd' + L], 1]];
    b.add(new THREE.SphereGeometry(1, 12, 10).scale(0.016, 0.046, 0.04).translate(hx, wyy - 0.045, 0.004), (x, y, z) => wy(y, [[wyy - 0.02, I['hd' + L]], [wyy + 0.01, I['fa' + L]]]), skin, mt(M.skin));
    if (S.fing) {
      for (let f = 0; f < 4; f++) {
        let fx = hx - sd * 0.002, fy = wyy - 0.088, fz = 0.028 - f * 0.018; const lens = [0.042, 0.027, 0.022].map(l => l * (f === 0 || f === 3 ? 0.88 : 1) * s);
        let ang = 0.15 + (Z ? 0.5 : 0.25);
        for (let k = 0; k < 3; k++) { const c = new THREE.CapsuleGeometry(0.0078 - k * 0.0006, lens[k], 2, 6); c.translate(0, -lens[k] / 2, 0); c.rotateZ(-sd * ang * k * 0.9); c.translate(fx, fy, fz); b.add(c, hb, skin, mt(M.skin)); fx -= sd * Math.sin(ang * k * 0.9) * lens[k]; fy -= Math.cos(ang * k * 0.9) * lens[k]; }
      }
      const th = new THREE.CapsuleGeometry(0.009, 0.04, 2, 6); th.rotateX(0.7); th.rotateZ(sd * 0.3); th.translate(hx - sd * 0.01, wyy - 0.05, 0.045); b.add(th, hb, skin, mt(M.skin));
    } else b.add(new THREE.SphereGeometry(1, 8, 6).scale(0.014, 0.05, 0.036).translate(hx, wyy - 0.1, 0.004), hb, skin, mt(M.skin));
  }
  // ----- 머리(조각) -----
  const hc = [0, hcY, 0.012 * s], HS = [0.086 * s, 0.106 * s, 0.1 * s];
  let hg = new THREE.SphereGeometry(1, S.head[0], S.head[1]); hg.deleteAttribute('uv'); hg.deleteAttribute('normal'); hg = mergeVertices(hg);
  const hp = hg.attributes.position, zk = Z ? 1 : 0;
  for (let i = 0; i < hp.count; i++) {
    let x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
    const nx = x, ny = y, nz = z; let d = 0;
    // 턱/광대 윤곽
    if (ny < -0.15) { const k = smooth(-0.15, -1, ny); x *= 1 - 0.3 * k; z *= 1 - 0.12 * k * (nz < 0 ? 1.5 : 0.3); }
    if (ny > 0.2) { x *= 1 - 0.05 * smooth(0.2, 1, ny); }
    d += -0.011 * (gauss(nx, ny, nz, [0.36, 0.2, 0.91], 0.2, 0.15, 0.3) + gauss(nx, ny, nz, [-0.36, 0.2, 0.91], 0.2, 0.15, 0.3)) * (1 + zk * 0.3);
    d += 0.005 * (gauss(nx, ny, nz, [0.3, 0.38, 0.88], 0.22, 0.08, 0.3) + gauss(nx, ny, nz, [-0.3, 0.38, 0.88], 0.22, 0.08, 0.3)) + 0.003 * gauss(nx, ny, nz, [0, 0.33, 0.95], 0.12, 0.1, 0.3);
    d += 0.007 * gauss(nx, ny, nz, [0, 0.16, 0.99], 0.07, 0.12, 0.2) + 0.016 * gauss(nx, ny, nz, [0, 0.03, 1], 0.08, 0.13, 0.2) + 0.022 * gauss(nx, ny, nz, [0, -0.07, 0.99], 0.085, 0.07, 0.2);
    d += 0.008 * (gauss(nx, ny, nz, [0.1, -0.1, 0.98], 0.05, 0.05, 0.2) + gauss(nx, ny, nz, [-0.1, -0.1, 0.98], 0.05, 0.05, 0.2));
    d += 0.006 * (gauss(nx, ny, nz, [0.62, 0.02, 0.78], 0.25, 0.18, 0.3) + gauss(nx, ny, nz, [-0.62, 0.02, 0.78], 0.25, 0.18, 0.3));
    d += (zk ? -0.008 : 0.002) * (gauss(nx, ny, nz, [0.58, -0.28, 0.75], 0.2, 0.15, 0.3) + gauss(nx, ny, nz, [-0.58, -0.28, 0.75], 0.2, 0.15, 0.3));
    d += 0.006 * gauss(nx, ny, nz, [0, -0.22, 0.97], 0.25, 0.06, 0.2) + 0.006 * gauss(nx, ny, nz, [0, -0.34, 0.94], 0.22, 0.06, 0.2) - 0.004 * gauss(nx, ny, nz, [0, -0.28, 0.96], 0.28, 0.025, 0.2);
    d += 0.01 * gauss(nx, ny, nz, [0, -0.64, 0.76], 0.25, 0.18, 0.3) + 0.006 * gauss(nx, ny, nz, [0, 0.25, -0.95], 0.5, 0.4, 0.3) - 0.004 * (gauss(nx, ny, nz, [0.95, 0.25, 0.25], 0.3, 0.25, 0.3) + gauss(nx, ny, nz, [-0.95, 0.25, 0.25], 0.3, 0.25, 0.3));
    if (zk) d += N3.noise(nx * 6 + seed, ny * 6, nz * 6) * 0.003;
    hp.setXYZ(i, hc[0] + x * HS[0] + nx * d, hc[1] + y * HS[1] + ny * d, hc[2] + z * HS[2] + nz * d);
  }
  hg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(hp.count * 2), 2));
  const headW = (x, y, z) => {
    const ny = (y - hc[1]) / HS[1], nz = (z - hc[2]) / HS[2];
    const jw = smooth(-0.18, -0.42, ny) * smooth(-0.55, 0.1, nz), nk = smooth(-0.55, -0.95, ny) * (1 - jw);
    const w = [[I.head, Math.max(0.001, 1 - jw - nk)]]; if (jw > 0) w.push([I.jaw, jw]); if (nk > 0) w.push([I.neck, nk]); return w;
  };
  const lipC = Z ? [0.4, 0.3, 0.32] : fem ? [0.72, 0.4, 0.42] : [0.66, 0.42, 0.4];
  b.add(hg, headW, (x, y, z) => { const ny = (y - hc[1]) / HS[1], nz = (z - hc[2]) / HS[2], nx = (x - hc[0]) / HS[0]; const lip = gauss(nx, ny, nz, [0, -0.28, 0.96], 0.26, 0.09, 0.3); const sock = Z ? (gauss(nx, ny, nz, [0.36, 0.2, 0.91], 0.24, 0.18, 0.3) + gauss(nx, ny, nz, [-0.36, 0.2, 0.91], 0.24, 0.18, 0.3)) : 0; let c = skin.map((v, i) => lerp(v, lipC[i], clamp(lip * 1.3, 0, 1))); if (sock) c = c.map((v, i) => v * (1 - 0.55 * clamp(sock, 0, 1)) + [0.12, 0.02, 0.04][i] * 0.4 * clamp(sock, 0, 1)); return c; }, mt(M.skin));
  // 귀
  for (const sd of [1, -1]) { const e = new THREE.SphereGeometry(1, 10, 8); e.scale(0.012, 0.03, 0.02); e.rotateY(sd * 0.35); e.translate(hc[0] + sd * HS[0] * 0.98, hc[1] - 0.004, hc[2] - 0.006); b.add(e, [[I.head, 1]], skin.map(v => v * 0.96), mt(M.skin)); }
  // 입 안 + 치아 + 혀
  b.add(new THREE.SphereGeometry(1, 10, 8).scale(0.03, 0.02, 0.028).translate(0, hc[1] - 0.032, hc[2] + 0.064), (x, y, z) => [[I.head, 0.5], [I.jaw, 0.5]], [0.3, 0.06, 0.07], [M.mouth, 0, 0, 0]);
  const tc = Z ? [0.72, 0.64, 0.42] : [0.94, 0.92, 0.86];
  b.add(new THREE.BoxGeometry(0.034, 0.009, 0.012, 4, 1, 1).translate(0, hc[1] - 0.023, hc[2] + 0.085), [[I.head, 1]], tc, [M.teeth, 0, 0, 0]);
  b.add(new THREE.BoxGeometry(0.03, 0.008, 0.011, 4, 1, 1).translate(0, hc[1] - 0.034, hc[2] + 0.082), [[I.jaw, 1]], tc, [M.teeth, 0, 0, 0]);
  // 눈알(앞쪽 극점 = 홍채)
  for (const sd of [1, -1]) {
    const eg = new THREE.SphereGeometry(0.0122 * s, lod ? 8 : 16, lod ? 6 : 12); eg.rotateX(Math.PI / 2); eg.translate(hc[0] + sd * 0.031 * s, hc[1] + 0.02 * s, hc[2] + 0.077 * s);
    b.add(eg, [[I.head, 1]], [1, 1, 1], [M.eye, 0, 0, 0]);
    b.add(new THREE.SphereGeometry(1, 8, 4).scale(0.016, 0.0028, 0.006).rotateZ(-sd * 0.12).translate(hc[0] + sd * 0.033 * s, hc[1] + 0.043 * s, hc[2] + 0.093 * s), [[I.head, 1]], hairC, [M.hair, 0, 0, 0]); // 눈썹
  }
  // 머리카락
  if (hairStyle !== 'bald') {
    const cap = new THREE.SphereGeometry(1, lod ? 18 : 36, lod ? 9 : 18, 0, Math.PI * 2, 0, Math.PI * (hairStyle === 'buzz' ? 0.5 : 0.58)); cap.deleteAttribute('normal');
    const cp = cap.attributes.position, thick = hairStyle === 'buzz' ? 0.003 : hairStyle === 'short' ? 0.008 : 0.01;
    for (let i = 0; i < cp.count; i++) {
      let x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
      const front = z > 0.35 && y < 0.55, k = front ? 0.93 : 1;
      const tuft = hairStyle === 'short' ? N3.noise(x * 9 + seed, y * 9, z * 9) * 0.004 : 0;
      cp.setXYZ(i, hc[0] + x * (HS[0] + thick) * k + x * tuft, hc[1] + y * (HS[1] + thick) * k + 0.004, hc[2] + z * (HS[2] + thick) * k - 0.004);
    }
    b.add(cap, [[I.head, 1]], hairC, [M.hair, 0, Z ? 0.4 : 0, 0]);
    if (hairStyle === 'long' || hairStyle === 'bob') {
      const len = hairStyle === 'long' ? 0.26 : 0.13, segV = 6, sh = new THREE.CylinderGeometry(HS[0] + 0.016, HS[0] + 0.03, len, lod ? 14 : 28, segV, true, Math.PI * 0.62, Math.PI * 1.76);
      const shp = sh.attributes.position; for (let i = 0; i < shp.count; i++) { const x = shp.getX(i), y = shp.getY(i), z = shp.getZ(i); const t = (len / 2 - y) / len; shp.setXYZ(i, x * (1 + t * 0.15) + N3.noise(x * 30, y * 30, seed) * 0.006, y, z * (1 + t * 0.2) - t * 0.02); }
      sh.translate(hc[0], hc[1] + 0.03 - len / 2, hc[2] - 0.005);
      const hw = (x, y, z) => wy(y, [[hc[1] - 0.16, I.neck], [hc[1] - 0.06, I.head]]);
      b.add(sh, hw, hairC, [M.hair, 0, 0, 0]); b.add(sh, hw, hairC, [M.hair, 0, 0, 0], true);
    }
    if (hairStyle === 'pony') b.add(new THREE.SphereGeometry(1, 10, 8).scale(0.03, 0.08, 0.03).translate(hc[0], hc[1] - 0.04, hc[2] - HS[2] - 0.03), [[I.head, 1]], hairC, [M.hair, 0, 0, 0]);
  }
  if (mask) { const mk = new THREE.SphereGeometry(1, 16, 8, -1.0, 2.0, Math.PI * 0.52, Math.PI * 0.32); mk.rotateY(Math.PI / 2 - Math.PI / 2); mk.scale(HS[0] + 0.008, HS[1] + 0.006, HS[2] + 0.012); mk.translate(hc[0], hc[1], hc[2]); const mc = pick(R, [[0.94, 0.94, 0.94], [0.12, 0.12, 0.13]]); b.add(mk, headW, mc, [M.cotton, Z ? 0.6 : 0, 0.2, 0]); b.add(mk, headW, mc, [M.cotton, 0, 0, 0], true); }
  const geo = b.build();
  const v = { geo, s, fem, Z, kind, helmet: !!outfit.helmet, brute, hc: hc, HS };
  vcache.set(key, v); return v;
}

// ---------- 재질(셰이더 확장) ----------
const NOISE = `
float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fb(vec3 p){ float a = 0.0, w = 0.5; for (int i = 0; i < 4; i++) { a += w * vn(p); p *= 2.07; w *= 0.5; } return a; }
vec3 hBump(vec3 sp, vec3 sn, float h){ vec3 sx = dFdx(sp), sy = dFdy(sp); vec3 r1 = cross(sy, sn), r2 = cross(sn, sx); float det = dot(sx, r1);
  vec2 dh = vec2(dFdx(h), dFdy(h)); vec3 gr = sign(det) * (dh.x * r1 + dh.y * r2); return normalize(abs(det) * sn - gr); }
`;
const DETAIL = `
  vec3 P = vObj; float mt = vMat.x, BLd = vMat.y, DTd = vMat.z; float fw = length(fwidth(P)); float hi = 1.0 - smoothstep(0.0004, 0.0018, fw);
  vec3 alb = diffuseColor.rgb; float hR = 0.75, hM = 0.0, hH = 0.0, skinK = 0.0, clothK = 0.0;
  if (mt < 0.5) { skinK = 1.0; float pr = vn(P * 900.0), bl = fb(P * 40.0); alb *= 0.9 + 0.2 * bl; hH = pr * 0.00012 * hi + bl * 0.0005; hR = 0.46 + 0.16 * pr;
    #ifdef ZOMBIE
    float vein = smoothstep(0.9, 0.985, 1.0 - abs(vn(P * 55.0) * 2.0 - 1.0)); alb = mix(alb, vec3(0.22, 0.16, 0.26), vein * 0.65);
    float dc = smoothstep(0.52, 0.8, fb(P * 22.0 + 3.0)); alb = mix(alb, alb * vec3(0.62, 0.7, 0.5), dc); hR = mix(hR, 0.28, dc * 0.6); hH += dc * 0.0008 * vn(P * 300.0);
    #endif
  } else if (mt < 1.5) { clothK = 1.0; float wv = sin(P.x * 1400.0) * sin(P.y * 1400.0 + P.z * 900.0); float wr = fb(P * 11.0); hH = wv * 0.00007 * hi + wr * 0.004; hR = 0.92; alb *= 0.9 + 0.14 * fb(P * 17.0);
  } else if (mt < 2.5) { clothK = 0.8; float tw = sin((P.x + P.y + P.z) * 1800.0); hH = tw * 0.00009 * hi + fb(P * 12.0) * 0.003; hR = 0.85; alb *= 0.82 + 0.32 * vn(P * 260.0) * fb(P * 7.0);
  } else if (mt < 3.5) { hH = fb(P * 9.0) * 0.004; hR = 0.38; alb *= 0.92 + 0.1 * fb(P * 20.0);
  } else if (mt < 4.5) { hH = fb(P * 70.0) * 0.0003; hR = 0.45; alb *= 0.85 + 0.2 * fb(P * 30.0);
  } else if (mt < 5.5) { float st = vn(vec3(P.x * 1100.0, P.y * 120.0, P.z * 1100.0)); alb *= 0.6 + 0.65 * st; hH = st * 0.0004 * hi; hR = 0.38 + 0.3 * st;
  } else if (mt < 6.5) { float r = 1.0 - vUv2.y;
    #ifdef ZOMBIE
    float vv = smoothstep(0.9, 0.98, 1.0 - abs(vn(P * 3500.0) * 2.0 - 1.0)); alb = mix(mix(vec3(0.6, 0.62, 0.58), vec3(0.8, 0.76, 0.6), smoothstep(0.08, 0.13, r)), vec3(0.55, 0.06, 0.05), vv * step(0.13, r));
    #else
    float ang = atan(P.x, P.y); vec3 ir = vec3(0.2, 0.11, 0.05) * (0.6 + 0.8 * vn(vec3(ang * 25.0, r * 120.0, 1.0)));
    alb = r < 0.05 ? vec3(0.008) : r < 0.115 ? ir : mix(vec3(0.93, 0.9, 0.86), vec3(0.85, 0.6, 0.55), smoothstep(0.3, 0.6, r) * 0.3);
    #endif
    hR = 0.04; hH = 0.0;
  } else if (mt < 7.5) { alb *= 0.85 + 0.2 * vn(P * 1800.0); hR = 0.22;
  } else if (mt < 8.5) { hR = 0.35; hM = 0.55; hH = fb(P * 40.0) * 0.0006;
  } else if (mt < 9.5) { hR = 0.25;
  } else if (mt < 10.5) { hR = 0.85;
  } else if (mt < 11.5) { hR = 0.55; float rs = step(0.88, fract(P.y * 7.0)); alb = mix(alb, vec3(0.85), rs); hR = mix(hR, 0.2, rs);
  } else if (mt < 12.5) { vec3 q = floor(P * 45.0) / 45.0; float c1 = fb(q * 5.0);
    alb = c1 < 0.4 ? vec3(0.1, 0.09, 0.07) : c1 < 0.5 ? vec3(0.25, 0.29, 0.17) : c1 < 0.6 ? vec3(0.38, 0.33, 0.22) : vec3(0.2, 0.24, 0.14);
    hH = sin(P.x * 1400.0) * sin(P.y * 1400.0) * 0.00007 * hi + fb(P * 11.0) * 0.003; hR = 0.9; clothK = 1.0;
  } else { float kn = sin(P.y * 1100.0 + sin(P.x * 900.0) * 2.0); hH = kn * 0.00012 * hi + fb(P * 12.0) * 0.003; hR = 0.95; clothK = 1.0; }
  float gm = fb(P * 13.0 + 7.0); alb *= 1.0 - DTd * smoothstep(0.38, 0.78, gm) * 0.55;
  float bn = fb(P * 20.0 + 11.0) + vn(P * 140.0) * 0.22;
  float bm = smoothstep(1.22 - BLd * 0.62, 1.3 - BLd * 0.62, bn + BLd * 0.22) * step(0.01, BLd);
  vec3 bc = mix(vec3(0.17, 0.008, 0.008), vec3(0.4, 0.025, 0.02), vn(P * 180.0));
  alb = mix(alb, bc, bm * 0.95); hR = mix(hR, 0.14, bm * 0.85); hH += bm * 0.0004;
  diffuseColor.rgb = alb;
`;
const mats = {};
export function humanMat(zombie) {
  const k = zombie ? 'z' : 'c'; if (mats[k]) return mats[k];
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, envMapIntensity: 0.55 });
  if (zombie) m.defines = { ZOMBIE: '' };
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aMat; varying vec4 vMat; varying vec3 vObj; varying vec2 vUv2;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat; vObj = position; vUv2 = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vMat; varying vec3 vObj; varying vec2 vUv2;\nfloat hR_, hM_, hH_, skin_, cloth_;\n' + NOISE)
      .replace('#include <color_fragment>', '#include <color_fragment>\n{' + DETAIL + 'hR_ = hR; hM_ = hM; hH_ = hH; skin_ = skinK; cloth_ = clothK; }')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = hR_;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = hM_;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = hBump(-vViewPosition, normal, hH_);')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { vec3 vd = normalize(vViewPosition); float rim = pow(1.0 - saturate(dot(normal, vd)), 3.0);
          reflectedLight.directDiffuse *= mix(vec3(1.0), vec3(1.07, 0.95, 0.9), skin_);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.55, 0.12, 0.06) * skin_ * (0.25 + rim * 0.6) * (reflectedLight.directDiffuse.r * 0.8 + 0.08);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * rim * cloth_ * 0.35 * (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse * 2.0); }`);
  };
  m.customProgramCacheKey = () => 'human2' + k;
  return mats[k] = m;
}
const helmetMat = new THREE.MeshStandardMaterial({ color: 0x3a4030, roughness: 0.6, metalness: 0.2 });

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _h = new THREE.Vector3();
export class Human {
  constructor(kind = 'zombie', idx = 0) {
    const V = variantGeo(kind, idx, 0); this.v = V; this.kind = kind; this.idx = idx; this.Z = V.Z;
    this.geo0 = V.geo; this.lod = 0;
    this.bones = makeBones(V.s); this.b = Object.fromEntries(this.bones.map(b => [b.name, b]));
    this.mesh = new THREE.SkinnedMesh(V.geo, humanMat(V.Z));
    this.mesh.add(this.bones[0]); this.mesh.updateMatrixWorld(true); this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.7);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.hipsY = this.b.hips.position.y; this.L1 = 0.43 * V.s; this.L2 = 0.4 * V.s;
    this.tx = new Float32Array(21); this.ty = new Float32Array(21); this.tz = new Float32Array(21);
    this.phase = Math.random() * 6; this.t = Math.random() * 100; this.seed = Math.random() * 10;
    this.st = { speed: 0, vy: 0, mode: 'loco', reach: 0, agit: 0, atk: 0, fear: 0, runner: false };
    this.limp = this.Z ? (Math.random() < 0.35 ? 0.4 + Math.random() * 0.6 : 0) : 0;
    this.hit = new THREE.Vector2(); this.hitV = new THREE.Vector2(); this.deadT = 0; this.deadDir = -1; this.imp = new Float32Array(21); this.fall = 0;
    this.dpose = Array.from({ length: 21 }, () => [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
    this.headless = false; this.legless = false; this.armless = {};
    if (V.helmet) { const hm = new THREE.Mesh(new THREE.SphereGeometry(V.HS[1] + 0.022, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 0.9, 1.02), helmetMat); hm.position.set(0, V.hc[1] - this.b.head.getWorldPosition(_v).y + 0.006, 0.0); hm.castShadow = true; this.b.head.add(hm); this.helmet = hm; }
  }
  setLOD(l) { if (l === this.lod) return; this.lod = l; this.mesh.geometry = l ? variantGeo(this.kind, this.idx, 1).geo : this.geo0; }
  destroyHead() { if (this.headless) return; this.headless = true; this.b.head.scale.setScalar(0.001); this.b.neck.scale.set(0.8, 0.6, 0.8); if (this.helmet) this.helmet.visible = false; }
  loseArm(sd) { this.armless[sd] = true; this.b['fa' + sd].scale.setScalar(0.001); }
  loseLegs() { this.legless = true; this.b.shL.scale.setScalar(0.001); this.b.shR.scale.setScalar(0.001); this.st.mode = 'crawl'; }
  update(dt, ground) {
    const s = this.st, t = (this.t += dt), tx = this.tx, ty = this.ty, tz = this.tz, B = this.bones;
    tx.fill(0); ty.fill(0); tz.fill(0);
    let hipDY = 0, k = 14;
    // 넘어짐 정도: dead/down 이면 1 로(가속), 아니면 0 으로 천천히(일어나기)
    const lying = s.mode === 'dead' || s.mode === 'down';
    if (lying) { this.deadT += dt; this.fallV = (this.fallV || 0) + dt * 3.2; this.fall = Math.min(1, this.fall + this.fallV * dt); }
    else { this.fallV = 0; this.fall = Math.max(0, this.fall - dt * 0.8); }
    if (s.mode === 'crawl') {
      const sp = s.speed; this.phase += sp * 4.5 * dt; const ph = this.phase;
      B[0].rotation.x = damp(B[0].rotation.x, 1.42, 6, dt); B[0].position.set(0, 0.03, damp(B[0].position.z, -0.88, 6, dt));
      for (const [sd, o] of [['L', 0], ['R', Math.PI]]) { const c = Math.sin(ph + o); tx[I['ua' + sd]] = -1.7 - 0.9 * c; tz[I['ua' + sd]] = (sd === 'L' ? 1 : -1) * 0.35; tx[I['fa' + sd]] = -0.5 - 0.6 * Math.max(0, -c); tx[I['th' + sd]] = 0.12 * c; }
      tx[I.neck] = -0.75; tx[I.head] = -0.35 + 0.1 * Math.sin(t * 3); tx[I.jaw] = 0.25 + 0.2 * Math.sin(t * 7); ty[I.chest] = 0.12 * Math.sin(ph); tz[I.spine] = 0.08 * Math.sin(ph);
    } else if (lying || this.fall > 0.001) {
      const f = this.fall, d = this.dpose;
      B[0].rotation.x = this.deadDir * f * 1.5; B[0].position.y = 0.1 * f; B[0].position.z = damp(B[0].position.z, 0, 6, dt);
      if (!lying) { const j = Math.sin(t * 17) * 0.06 * f; tx[I.uaL] = -1.2 * f + j; tx[I.uaR] = -1.0 * f - j; tx[I.thL] = -1.0 * f; tx[I.shL] = 1.6 * f; tx[I.spine] = 0.5 * f; } // 일어나는 중(손 짚기)
      else {
        tx[I.uaL] = (-0.4 + d[8][0]) * f; tz[I.uaL] = (0.7 + d[8][1] * 0.8) * f; tx[I.uaR] = (-0.4 + d[12][0]) * f; tz[I.uaR] = (-0.7 - d[12][1] * 0.8) * f;
        tx[I.faL] = -0.4 * f; tx[I.faR] = -0.3 * f; tx[I.thL] = d[15][0] * 0.4 * f; tz[I.thL] = 0.1 * f; tx[I.thR] = (-0.3 + d[18][0] * 0.4) * f; tz[I.thR] = -0.15 * f;
        tx[I.shL] = (0.2 + Math.abs(d[16][0])) * f; tx[I.shR] = (0.4 + Math.abs(d[19][0]) * 0.8) * f; ty[I.head] = d[5][0] * 1.4 * f; tx[I.jaw] = 0.3 * f;
        if (s.mode === 'down') { const tw = Math.sin(t * 9 + this.seed) * 0.15; tx[I.uaL] += tw; tx[I.head] += tw * 0.5; tx[I.jaw] = 0.3 + Math.abs(Math.sin(t * 6)) * 0.3; }
      }
      k = lying ? 9 : 6;
    } else if (s.mode === 'eat') {
      hipDY = -0.52; const e = Math.sin(t * 5.2 + this.seed);
      for (const sd of ['L', 'R']) { tx[I['th' + sd]] = -1.75; tx[I['sh' + sd]] = 2.3; tx[I['ft' + sd]] = -0.5; }
      tz[I.thL] = 0.15; tz[I.thR] = -0.15;
      tx[I.spine] = 0.65; tx[I.chest] = 0.35; tx[I.neck] = 0.25 + e * 0.15; tx[I.head] = 0.25 + Math.sin(t * 5.2 + 0.7) * 0.22; ty[I.head] = Math.sin(t * 1.3) * 0.2;
      if (Math.sin(t * 0.9 + this.seed) > 0.93) { tx[I.neck] -= 0.5; tx[I.head] -= 0.3; } // 살을 뜯어내며 고개를 젖힘
      tx[I.jaw] = 0.3 + Math.sin(t * 8) * 0.25;
      tx[I.uaL] = -0.95 + Math.sin(t * 4) * 0.2; tx[I.uaR] = -0.95 + Math.sin(t * 4 + 2) * 0.2; tz[I.uaL] = 0.25; tz[I.uaR] = -0.25; tx[I.faL] = -0.9; tx[I.faR] = -0.8;
      B[0].rotation.x = damp(B[0].rotation.x, 0, 8, dt);
    } else {
      const sp = s.speed, run = clamp((sp - 2.2) / 2.8, 0, 1), walk = clamp(sp / 1.2, 0, 1), climb = clamp(s.vy * 2, 0, 1);
      const stride = lerp(0.6, 1.15, run) * this.v.s * (this.Z && !s.runner ? 0.75 : 1) * (this.v.brute ? 0.8 : 1);
      this.phase += Math.PI * sp / stride * dt;
      const ph = this.phase, A = walk * 0.4 + run * 0.4 + climb * 0.2;
      for (const [sd, off] of [['L', 0], ['R', Math.PI]]) {
        const p = ph + off, sn = Math.sin(p), lim = sd === 'R' ? this.limp : 0;
        let th = -A * sn - run * 0.18 - climb * 0.3 * Math.max(0, sn);
        let kn = walk * (0.08 + 0.75 * Math.max(0, Math.cos(p + 0.5)) ** 2) + run * (0.3 + 1.35 * Math.max(0, Math.cos(p + 0.35)) ** 1.5) + climb * 0.6 * Math.max(0, Math.sin(p + 0.4));
        th *= 1 - lim * 0.55; kn *= 1 - lim * 0.75;
        tx[I['th' + sd]] = th; tx[I['sh' + sd]] = kn; tx[I['ft' + sd]] = -(th + kn) * 0.65 + walk * 0.12 * Math.max(0, -sn);
        const arm = sd === 'L' ? 1 : -1;
        tx[I['ua' + sd]] = (walk * 0.3 + run * 0.65) * sn; tz[I['ua' + sd]] = arm * (0.07 + run * 0.1 + (this.v.brute ? 0.15 : 0)); tx[I['fa' + sd]] = -(0.12 + walk * 0.15 + run * 1.15);
      }
      hipDY = (walk * 0.02 + run * 0.04) * Math.cos(2 * ph) - run * 0.06;
      ty[I.hips] = -0.12 * walk * Math.sin(ph); tz[I.hips] = 0.035 * walk * Math.cos(ph) + this.limp * 0.07 * Math.sin(ph);
      tx[I.spine] = 0.03 + run * 0.22; ty[I.chest] = -ty[I.hips] * 1.3; tx[I.neck] = -tx[I.spine] * 0.4; tx[I.head] = -tx[I.spine] * 0.3;
      // 2차 움직임: 머리 지연, 호흡
      tx[I.head] += Math.cos(2 * ph) * 0.03 * walk; tx[I.chest] += 0.02 * Math.sin(t * (1.6 + s.agit * 2));
      if (sp < 0.15) { tz[I.hips] += 0.03 * Math.sin(t * 0.5); ty[I.head] += 0.25 * Math.sin(t * 0.23 + this.seed) * (this.Z ? 0.4 : 1); }
      if (this.Z) {
        const ag = s.agit, hunch = 0.22 - (s.runner ? run * 0.1 : 0) + (this.v.brute ? 0.1 : 0);
        tx[I.spine] += hunch * 0.6; tx[I.chest] += hunch * 0.4; tx[I.neck] += 0.15; tx[I.head] -= 0.12 + ag * 0.15;
        tz[I.head] += 0.28 * Math.sin(t * 0.5 + this.seed) * (1 - ag * 0.7); ty[I.head] += 0.15 * Math.sin(t * 0.37 + this.seed);
        tz[I.spine] += this.limp * 0.1;
        for (const [sd, arm] of [['L', 1], ['R', -1]]) {
          const fl = Math.sin(t * 2.6 + arm * 1.7 + this.seed);
          if (s.runner && run > 0.3) { tx[I['ua' + sd]] = -0.4 + 1.05 * Math.sin(ph + (arm > 0 ? 0 : Math.PI)); tz[I['ua' + sd]] = arm * (0.45 + 0.25 * Math.sin(t * 7 + arm)); tx[I['fa' + sd]] = -0.7; }
          else { tx[I['ua' + sd]] = lerp(tx[I['ua' + sd]] * 0.4 + 0.05, -1.35 + 0.15 * fl, s.reach); tz[I['ua' + sd]] = arm * (0.12 + 0.12 * s.reach); tx[I['fa' + sd]] = lerp(-0.1, -0.35, s.reach) + 0.08 * fl; }
          tx[I['hd' + sd]] = 0.35; tz[I['hd' + sd]] = arm * 0.1;
        }
        tx[I.jaw] = 0.08 + ag * (0.22 + 0.2 * Math.sin(t * 9 + this.seed));
        if (s.runner && run > 0.3) { tx[I.spine] += 0.18; tx[I.head] -= 0.25; }
        if (Math.random() < dt * 0.35) { const bb = pick(Math.random, [I.head, I.uaL, I.uaR, I.neck, I.chest]); this.imp[bb] = (Math.random() - 0.5) * 1.2; }
      } else if (s.fear > 0.5) {
        if (Math.sin(t * 0.9 + this.seed) > 0.8) ty[I.neck] = 1.1 * (this.seed > 5 ? 1 : -1);
        if (sp < 0.5) { tx[I.uaL] = tx[I.uaR] = -1.9; tz[I.uaL] = 0.5; tz[I.uaR] = -0.5; tx[I.faL] = tx[I.faR] = -1.6; tx[I.spine] = 0.3; hipDY -= 0.1; }
      }
      if (s.atk > 0) {
        const a = Math.sin(Math.PI * clamp(s.atk, 0, 1));
        tx[I.spine] += 0.35 * a; tx[I.chest] += 0.2 * a; tx[I.head] += 0.15 * a; tx[I.jaw] = 0.55 * a;
        for (const [sd, arm] of [['L', 1], ['R', -1]]) { tx[I['ua' + sd]] = lerp(tx[I['ua' + sd]], -1.55, a); tz[I['ua' + sd]] = arm * lerp(0.15, -0.2, a); tx[I['fa' + sd]] = -0.25 * a; }
      }
      if (s.aim) { tx[I.uaR] = -1.45; ty[I.uaR] = 0.3; tx[I.faR] = -0.2; tx[I.uaL] = -1.35; tz[I.uaL] = -0.3; tx[I.faL] = -0.6; }
      this.hitV.x += (-this.hit.x * 60 - this.hitV.x * 9) * dt; this.hitV.y += (-this.hit.y * 60 - this.hitV.y * 9) * dt;
      this.hit.x += this.hitV.x * dt; this.hit.y += this.hitV.y * dt;
      tx[I.spine] -= this.hit.y * 0.5; tx[I.chest] -= this.hit.y * 0.4; tx[I.head] -= this.hit.y * 0.6; tz[I.spine] += this.hit.x * 0.4;
      B[0].rotation.x = damp(B[0].rotation.x, 0, 10, dt); B[0].position.y = 0; B[0].position.z = damp(B[0].position.z, 0, 8, dt);
    }
    for (let i = 1; i < 21; i++) {
      this.imp[i] *= Math.exp(-dt * 6);
      const r = B[i].rotation;
      r.x = damp(r.x, tx[i] + this.imp[i], k, dt); r.y = damp(r.y, ty[i], k, dt); r.z = damp(r.z, tz[i] + this.imp[i] * 0.5, k, dt);
    }
    B[I.hips].position.y = damp(B[I.hips].position.y, this.hipsY + hipDY, 12, dt);
    if (ground && s.mode === 'loco' && this.fall < 0.01 && !(s.runner && s.speed > 3)) this.legIK(ground);
  }
  // 2본 IK: 발을 실제 지면(계단·경사)에 붙이고 필요하면 골반을 낮춤
  legIK(ground) {
    const b = this.b, m = this.mesh; m.updateMatrixWorld(true);
    const ah = 0.075 * this.v.s, L1 = this.L1, L2 = this.L2, legs = [];
    let lower = 0;
    for (const sd of ['L', 'R']) {
      const A = b['ft' + sd].getWorldPosition(new THREE.Vector3()), Hp = b['th' + sd].getWorldPosition(new THREE.Vector3());
      const gy = ground(A.x, A.z, A.y + 0.45) + ah, ty = A.y - gy < 0.1 ? gy : Math.max(gy, A.y);
      const d = Math.hypot(A.x - Hp.x, ty - Hp.y, A.z - Hp.z); if (d > (L1 + L2) * 0.985) lower = Math.max(lower, d - (L1 + L2) * 0.985);
      legs.push({ sd, A, ty });
    }
    if (lower > 0.002) { b.hips.position.y -= Math.min(lower, 0.35); m.updateMatrixWorld(true); }
    const hipsPitch = this.bones[0].rotation.x + b.hips.rotation.x;
    for (const lg of legs) {
      if (Math.abs(lg.ty - lg.A.y) < 0.004 && lower < 0.002) continue;
      const th = b['th' + lg.sd], sh = b['sh' + lg.sd], ft = b['ft' + lg.sd];
      _v.set(lg.A.x, lg.ty, lg.A.z); b.hips.worldToLocal(_v);
      const ty = _v.y - th.position.y, tz = _v.z - th.position.z;
      const d = clamp(Math.hypot(ty, tz), Math.abs(L1 - L2) + 0.02, L1 + L2 - 0.002);
      const kn = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
      const phi = Math.atan2(-tz, -ty), the = phi - Math.atan2(L2 * Math.sin(kn), L1 + L2 * Math.cos(kn));
      th.rotation.x = the; sh.rotation.x = kn; ft.rotation.x = -(the + kn + hipsPitch);
    }
  }
  impulse(dx, dz) { this.hitV.x += dx * 6; this.hitV.y += dz * 6; }
  spheres() {
    const out = [], b = this.b;
    if (!this.headless) { b.head.getWorldPosition(_v); out.push({ c: _v.clone().add(_h.set(0, 0.085 * this.v.s, 0.01).applyQuaternion(b.head.getWorldQuaternion(new THREE.Quaternion()))), r: 0.13, part: 'head' }); }
    b.chest.getWorldPosition(_v); out.push({ c: _v.clone(), r: this.v.brute ? 0.34 : 0.25, part: 'body' });
    b.spine.getWorldPosition(_v); out.push({ c: _v.clone(), r: this.v.brute ? 0.32 : 0.22, part: 'body' });
    for (const n of ['faL', 'faR']) if (!this.armless[n.slice(2)]) { b[n].getWorldPosition(_v); out.push({ c: _v.clone(), r: 0.1, part: 'arm' + n.slice(2) }); }
    if (!this.legless) for (const n of ['shL', 'shR', 'thL', 'thR']) { b[n].getWorldPosition(_v); out.push({ c: _v.clone(), r: 0.11, part: 'leg' }); }
    return out;
  }
  headPos() { this.b.head.getWorldPosition(_w); return _w.clone().add(_h.set(0, 0.08, 0)); }
  setDead(dir = -1) { this.st.mode = 'dead'; this.deadT = 0; this.deadDir = dir; }
}

// 시체(정적 메시로 굽기) — 길거리 장식/좀비 먹잇감
export function bakeCorpseGeo(idx) {
  const h = new Human('zombie', idx); h.setDead(-1);
  for (let i = 0; i < 80; i++) h.update(0.05);
  h.mesh.updateMatrixWorld(true); h.mesh.skeleton.update();
  const src = h.mesh.geometry, pos = src.attributes.position, out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { _v.fromBufferAttribute(pos, i); h.mesh.applyBoneTransform(i, _v); out.set([_v.x, _v.y, _v.z], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  for (const a of ['color', 'uv', 'aMat']) g.setAttribute(a, src.attributes[a]);
  g.setIndex(src.index); g.computeVertexNormals();
  g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0); g.computeBoundingSphere();
  return g;
}

// 1인칭 팔(소매 + 손가락이 무언가를 쥔 손)
export function buildFPArm(sleeveCol = [0.16, 0.18, 0.22]) {
  const b = new Builder(), skin = [0.84, 0.64, 0.52];
  const ar = [[0.0, 0.05], [-0.12, 0.052], [-0.24, 0.047], [-0.3, 0.043], [-0.34, 0.042], [-0.42, 0.037], [-0.5, 0.029], [-0.53, 0.027]].map(([z, r]) => ({ y: z, x: 0, z: 0, rx: r * 1.05, zf: r, zb: r }));
  const tube = sweep(ar, 18, 2, false, true); tube.rotateX(-Math.PI / 2); // 길이 방향 = -z
  b.add(tube, [[0, 1]], (x, y, z) => z > -0.33 ? sleeveCol : skin, (x, y, z) => [z > -0.33 ? M.cotton : M.skin, 0, 0.1, 0]);
  b.add(new THREE.SphereGeometry(1, 14, 10).scale(0.04, 0.018, 0.05).translate(0, 0, -0.58), [[0, 1]], skin, [M.skin, 0, 0, 0]);
  for (let f = 0; f < 4; f++) { const c = new THREE.CapsuleGeometry(0.0095, 0.022, 3, 8); c.rotateX(Math.PI / 2); c.translate(0.027 - f * 0.018, -0.022, -0.615); b.add(c, [[0, 1]], skin, [M.skin, 0, 0, 0]); const k = new THREE.SphereGeometry(0.01, 8, 6); k.translate(0.027 - f * 0.018, -0.006, -0.6); b.add(k, [[0, 1]], skin, [M.skin, 0, 0, 0]); }
  const th = new THREE.CapsuleGeometry(0.0105, 0.035, 3, 8); th.rotateX(Math.PI / 2); th.rotateY(-0.5); th.translate(0.04, 0.004, -0.6); b.add(th, [[0, 1]], skin, [M.skin, 0, 0, 0]);
  const g = b.build(); g.deleteAttribute('skinIndex'); g.deleteAttribute('skinWeight'); return g;
}
export const MAT_TYPES = M;
