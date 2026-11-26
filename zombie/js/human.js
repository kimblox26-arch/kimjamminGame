// 절차적 인체: 21개 본 스키닝 메시(관절 블렌딩) + 절차적 보행/추격/공격/섭식/사망 애니메이션
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { T } from './textures.js';
import { rng, pick, clamp, damp, lerp } from './util.js';

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

const SKIN_C = [[0.88, 0.71, 0.6], [0.82, 0.64, 0.52], [0.9, 0.76, 0.66], [0.76, 0.58, 0.46]];
const ZSKIN = [[0.6, 0.62, 0.55], [0.55, 0.55, 0.52], [0.64, 0.6, 0.56], [0.5, 0.53, 0.47]];
const OUTFITS = {
  tshirt: R => ({ top: pick(R, [[0.75, 0.75, 0.72], [0.15, 0.15, 0.17], [0.55, 0.12, 0.12], [0.2, 0.35, 0.55], [0.85, 0.8, 0.6]]), bot: [0.17, 0.22, 0.36], shoe: [0.85, 0.85, 0.85], sleeve: 'short' }),
  padding: R => ({ top: pick(R, [[0.06, 0.06, 0.07], [0.1, 0.12, 0.2], [0.7, 0.63, 0.5], [0.45, 0.45, 0.47]]), bot: [0.1, 0.1, 0.11], shoe: [0.12, 0.12, 0.12], sleeve: 'long', puff: 0.035 }),
  suit: R => ({ top: pick(R, [[0.08, 0.1, 0.16], [0.15, 0.15, 0.16], [0.25, 0.25, 0.27]]), bot: [0.08, 0.09, 0.13], shoe: [0.04, 0.03, 0.03], sleeve: 'long', collar: [0.92, 0.92, 0.94] }),
  school: R => ({ top: [0.1, 0.14, 0.28], bot: [0.28, 0.28, 0.3], shoe: [0.9, 0.9, 0.9], sleeve: 'long', collar: [0.95, 0.95, 0.95] }),
  hospital: R => ({ top: [0.55, 0.72, 0.72], bot: [0.55, 0.72, 0.72], shoe: [0.8, 0.8, 0.75], sleeve: 'short' }),
  sport: R => ({ top: pick(R, [[0.45, 0.45, 0.46], [0.12, 0.12, 0.12], [0.6, 0.15, 0.2]]), bot: [0.08, 0.08, 0.09], shoe: [0.9, 0.9, 0.9], sleeve: 'long' }),
  police: R => ({ top: [0.12, 0.16, 0.24], bot: [0.1, 0.12, 0.18], shoe: [0.03, 0.03, 0.03], sleeve: 'long', vest: [0.75, 0.85, 0.15] }),
  soldier: R => ({ top: 'camo', bot: 'camo', shoe: [0.08, 0.07, 0.06], sleeve: 'long' })
};

function lathe(prof, y0, y1, zs, x = 0, z = 0, seg = 12) {
  const pts = prof.map((r, i) => new THREE.Vector2(r, lerp(y0, y1, i / (prof.length - 1))));
  const g = new THREE.LatheGeometry(pts, seg); g.scale(1, 1, zs); g.translate(x, 0, z); return g;
}
function sph(r, x, y, z, sx = 1, sy = 1, sz = 1, ws = 14, hs = 10, tl = Math.PI) { const g = new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, tl); g.scale(sx, sy, sz); g.translate(x, y, z); return g; }
function cap(r, len, x, y, z) { const g = new THREE.CapsuleGeometry(r, len, 4, 10); g.translate(x, y, z); return g; }

const vcache = new Map();
export function variantGeo(kind, idx) {
  const k = kind + idx; if (vcache.has(k)) return vcache.get(k);
  const R = rng(idx * 7919 + (kind === 'zombie' ? 17 : kind === 'soldier' ? 29 : 3));
  const Z = kind === 'zombie' || kind === 'zsoldier';
  const fem = kind === 'soldier' || kind === 'zsoldier' || kind === 'police' ? false : R() < 0.45;
  const s = fem ? 0.93 + R() * 0.05 : 0.98 + R() * 0.07, g = (fem ? 0.9 : 1) * (0.93 + R() * 0.25);
  const outfit = kind.includes('soldier') ? OUTFITS.soldier(R) : kind === 'police' ? OUTFITS.police(R) : OUTFITS[pick(R, ['tshirt', 'padding', 'padding', 'suit', 'school', 'sport', Z ? 'hospital' : 'tshirt'])](R);
  const skin = Z ? pick(R, ZSKIN) : pick(R, SKIN_C), hair = pick(R, [[0.04, 0.035, 0.03], [0.08, 0.06, 0.045], [0.03, 0.03, 0.03], [0.2, 0.14, 0.09]]);
  const J = worldJoints(s), P = (n) => J[I[n]], puff = outfit.puff || 0, bald = !fem && R() < 0.12, seed = R() * 100;
  const parts = [];
  const add = (geo, bone, col, blends = []) => parts.push({ geo, bone: I[bone], col, blends: blends.map(([b, y, d]) => ({ b: I[b], y, d })) });
  const top = outfit.top, bot = outfit.bot;
  // 몸통
  const hy = P('hips')[1], sy = P('spine')[1], cy = P('chest')[1], ny = P('neck')[1], gy = g + puff * 2;
  add(lathe([0.12, 0.155, fem ? 0.172 : 0.16, 0.15].map(v => v * g), hy - 0.1, hy + 0.09, 0.72), 'hips', bot, [['spine', sy, 1]]);
  add(lathe([0.148, 0.138, 0.15].map(v => v * (g + puff)), sy - 0.04, cy + 0.03, 0.7), 'spine', top, [['hips', sy, -1], ['chest', cy, 1]]);
  add(lathe([0.155, fem ? 0.16 : 0.178, fem ? 0.155 : 0.172, 0.12].map(v => v * gy), cy - 0.02, ny + 0.01, 0.66), 'chest', top, [['spine', cy, -1]]);
  if (outfit.vest) add(lathe([0.16, 0.18, 0.17].map(v => v * g + 0.012), sy, ny - 0.04, 0.7), 'chest', outfit.vest, [['spine', cy, -1]]);
  add(new THREE.CylinderGeometry(0.046, 0.05, 0.14, 10).translate(0, ny + 0.03, 0.005), 'neck', outfit.collar && !Z ? skin : skin, [['chest', ny, -1], ['head', P('head')[1], 1]]);
  if (outfit.collar) add(new THREE.CylinderGeometry(0.062, 0.07, 0.04, 10).translate(0, ny - 0.005, 0.0), 'chest', outfit.collar);
  // 머리
  const H = P('head'), hc = [H[0], H[1] + 0.085 * s, H[2] + 0.01];
  add(sph(0.1 * s, hc[0], hc[1], hc[2], 0.9, 1.12, 1.0, 18, 14), 'head', skin);
  if (!bald) {
    add(sph(0.106 * s, hc[0], hc[1] + 0.006, hc[2] - 0.008, 0.93, 1.12, 1.05, 16, 8, Math.PI * 0.42), 'head', hair);
    if (fem) add(sph(0.1 * s, hc[0], hc[1] - 0.05, hc[2] - 0.045, 1.05, 1.5, 0.6, 12, 8), 'head', hair);
  }
  add(new THREE.ConeGeometry(0.017, 0.045, 8).rotateX(Math.PI / 2).translate(hc[0], hc[1] - 0.01, hc[2] + 0.105), 'head', skin.map(v => v * 0.97));
  for (const sx of [1, -1]) {
    add(sph(0.026, hc[0] + sx * 0.091, hc[1] - 0.005, hc[2] - 0.005, 0.45, 1, 0.75, 8, 6), 'head', skin.map(v => v * 0.95));
    add(sph(0.021, hc[0] + sx * 0.035, hc[1] + 0.015, hc[2] + 0.076, 1.2, 0.8, 0.6, 10, 8), 'head', Z ? [0.18, 0.08, 0.08] : skin.map(v => v * 0.7)); // 눈두덩
    add(sph(0.0125, hc[0] + sx * 0.035, hc[1] + 0.015, hc[2] + 0.082, 1, 1, 1, 10, 8), 'head', Z ? [0.82, 0.8, 0.68] : [0.95, 0.95, 0.93]);
    if (!Z) add(sph(0.006, hc[0] + sx * 0.035, hc[1] + 0.015, hc[2] + 0.093, 1, 1, 0.5, 8, 6), 'head', [0.06, 0.04, 0.03]);
    else add(sph(0.004, hc[0] + sx * 0.035, hc[1] + 0.015, hc[2] + 0.094, 1, 1, 0.5, 6, 4), 'head', [0.45, 0.1, 0.08]);
    add(new THREE.BoxGeometry(0.03, 0.006, 0.01).translate(hc[0] + sx * 0.036, hc[1] + 0.038, hc[2] + 0.09), 'head', hair); // 눈썹
  }
  add(sph(0.034, hc[0], hc[1] - 0.06, hc[2] + 0.058, 1, 0.8, 0.7, 10, 8), 'head', [0.12, 0.03, 0.03]); // 입 안
  add(new THREE.BoxGeometry(0.045, 0.01, 0.012).translate(hc[0], hc[1] - 0.047, hc[2] + 0.09), 'head', Z ? [0.75, 0.7, 0.5] : [0.62, 0.36, 0.34]);
  // 턱
  const jw = P('jaw');
  add(sph(0.072 * s, jw[0], jw[1] - 0.005, jw[2] + 0.03, 0.85, 0.42, 0.95, 14, 8), 'jaw', skin);
  add(new THREE.BoxGeometry(0.044, 0.01, 0.012).translate(jw[0], jw[1] + 0.012, jw[2] + 0.088), 'jaw', Z ? [0.7, 0.62, 0.42] : [0.62, 0.36, 0.34]);
  // 팔
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const ua = P('ua' + side), fa = P('fa' + side), hd = P('hd' + side), arm = outfit.top === 'camo' ? 'camo' : top;
    add(sph(0.062 * (g + puff), ua[0], ua[1] - 0.01, ua[2], 1, 1, 1, 10, 8), 'ua' + side, arm, [['chest', ua[1] + 0.03, 1]]);
    add(cap(0.05 * (g + puff), ua[1] - fa[1] - 0.06, ua[0], (ua[1] + fa[1]) / 2, ua[2]), 'ua' + side, arm, [['fa' + side, fa[1], -1]]);
    const fcol = outfit.sleeve === 'short' ? skin : arm;
    add(lathe([0.034, 0.04 * (g + puff * 0.6), 0.044 * (g + puff)], hd[1] + 0.01, fa[1] + 0.02, 1, fa[0], fa[2], 10), 'fa' + side, fcol, [['ua' + side, fa[1], 1], ['hd' + side, hd[1], -1]]);
    if (outfit.sleeve === 'short') add(cap(0.052 * g, 0.06, ua[0], fa[1] + 0.13, ua[2]), 'ua' + side, arm);
    // 손(손바닥 + 손가락)
    add(new THREE.BoxGeometry(0.03, 0.085, 0.075).translate(hd[0] + sx * 0.003, hd[1] - 0.05, hd[2] + 0.005), 'hd' + side, skin, [['fa' + side, hd[1], 1]]);
    for (let f = 0; f < 4; f++) add(cap(0.009, 0.055, hd[0] + sx * 0.002, hd[1] - 0.12, hd[2] + 0.03 - f * 0.019), 'hd' + side, Z ? skin.map(v => v * 0.85) : skin);
    add(cap(0.011, 0.04, hd[0] - sx * 0.004, hd[1] - 0.06, hd[2] + 0.05), 'hd' + side, skin);
  }
  // 다리
  for (const side of ['L', 'R']) {
    const th = P('th' + side), sh = P('sh' + side), ft = P('ft' + side), leg = outfit.bot;
    add(lathe([0.054, 0.07 * g, 0.084 * g, 0.088 * g], sh[1] - 0.02, th[1] + 0.05, 0.95, th[0], th[2], 12), 'th' + side, leg, [['hips', th[1], 1], ['sh' + side, sh[1], -1]]);
    add(lathe([0.042, 0.05, 0.06 * g, 0.054], ft[1] + 0.03, sh[1] + 0.02, 0.95, sh[0], sh[2] - 0.005, 10), 'sh' + side, leg, [['th' + side, sh[1], 1], ['ft' + side, ft[1] + 0.02, -1]]);
    add(new THREE.BoxGeometry(0.095, 0.075, 0.25).translate(ft[0], ft[1] - 0.03, ft[2] + 0.055), 'ft' + side, outfit.shoe);
    add(new THREE.BoxGeometry(0.1, 0.02, 0.26).translate(ft[0], ft[1] - 0.065, ft[2] + 0.055), 'ft' + side, [0.1, 0.1, 0.1]);
  }
  // 정점 속성: 색(더러움/피/위장무늬), 스킨 가중치
  const geos = [];
  const bd = 0.05;
  for (const p of parts) {
    let gg = p.geo.index ? p.geo : p.geo; ['uv1', 'uv2'].forEach(a => gg.deleteAttribute(a));
    const pos = gg.attributes.position, n = pos.count, col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      let c = p.col;
      if (c === 'camo') { const q = N3.noise(x * 9, y * 9, z * 9 + seed); c = q > 0.25 ? [0.12, 0.11, 0.08] : q > -0.05 ? [0.25, 0.3, 0.17] : q > -0.3 ? [0.38, 0.33, 0.22] : [0.2, 0.24, 0.14]; }
      let r = c[0], gC = c[1], b = c[2];
      const dirt = 0.82 + 0.28 * (N3.noise(x * 7 + seed, y * 7, z * 7) * 0.5 + 0.5); r *= dirt; gC *= dirt; b *= dirt;
      if (Z) {
        const bl = N3.noise(x * 11 + seed, y * 11, z * 11 + 3) + (z > 0.03 && y > 1.2 && y < 1.62 ? 0.45 : 0) + (y > 1.0 && y < 1.4 && z > 0.05 ? 0.15 : 0);
        if (bl > 0.32) { const k = clamp((bl - 0.32) * 4, 0, 1); r = lerp(r, 0.3, k); gC = lerp(gC, 0.015, k); b = lerp(b, 0.02, k); }
        if (c === skin && N3.noise(x * 20, y * 20 + seed, z * 20) > 0.35) { r *= 0.8; gC *= 0.75; b *= 0.85; } // 멍/핏줄
        if (c !== skin && N3.noise(x * 6, y * 6, z * 6 + seed) > 0.5) { r = skin[0] * 0.8; gC = skin[1] * 0.75; b = skin[2] * 0.75; } // 찢어진 옷
      }
      col[v * 3] = r; col[v * 3 + 1] = gC; col[v * 3 + 2] = b;
      let wo = 1; const idx = [p.bone, 0, 0, 0], w = [0, 0, 0, 0]; let k = 1;
      for (const bl of p.blends) { const t = clamp((bl.d * (y - bl.y) + bd) / (2 * bd), 0, 1) * (Math.abs(y - bl.y) < bd * 3 ? 1 : 0); if (t > 0 && k < 3) { idx[k] = bl.b; w[k] = t * 0.999; wo -= t; k++; } }
      if (wo < 0) { const sum = w[1] + w[2]; w[1] /= sum; w[2] /= sum; wo = 0; }
      w[0] = wo; si.set(idx, v * 4); sw.set(w, v * 4);
    }
    gg.setAttribute('color', new THREE.BufferAttribute(col, 3)); gg.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); gg.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geos.push(gg);
  }
  const geo = mergeGeometries(geos, false);
  const v = { geo, s, fem, Z, kind };
  vcache.set(k, v); return v;
}

let MAT = null;
export function humanMat() {
  return MAT ||= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0, normalMap: T.clothNormal, normalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: 0.6 });
}

const _v = new THREE.Vector3();
export class Human {
  constructor(kind = 'zombie', idx = 0) {
    const V = variantGeo(kind, idx); this.v = V; this.kind = kind; this.Z = V.Z;
    this.bones = makeBones(V.s); this.b = Object.fromEntries(this.bones.map(b => [b.name, b]));
    this.mesh = new THREE.SkinnedMesh(V.geo, humanMat());
    this.mesh.add(this.bones[0]); this.mesh.updateMatrixWorld(true); this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = true;
    this.hipsY = this.b.hips.position.y;
    this.tx = new Float32Array(21); this.ty = new Float32Array(21); this.tz = new Float32Array(21);
    this.phase = Math.random() * 6; this.t = Math.random() * 100; this.seed = Math.random() * 10;
    this.st = { speed: 0, vy: 0, mode: 'loco', reach: 0, agit: 0, atk: 0, fear: 0, runner: false };
    this.limp = this.Z ? (Math.random() < 0.35 ? 0.4 + Math.random() * 0.6 : 0) : 0;
    this.hit = new THREE.Vector2(); this.hitV = new THREE.Vector2(); this.deadT = 0; this.deadDir = -1; this.imp = new Float32Array(21);
    this.dpose = Array.from({ length: 21 }, () => [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
  }
  update(dt) {
    const s = this.st, t = (this.t += dt), tx = this.tx, ty = this.ty, tz = this.tz, B = this.bones;
    tx.fill(0); ty.fill(0); tz.fill(0);
    let hipDY = 0, k = 14;
    if (s.mode === 'dead') {
      this.deadT += dt; const f = Math.min(1, (this.deadT / 0.85) ** 2), d = this.dpose;
      B[0].rotation.x = this.deadDir * f * 1.5; B[0].position.y = 0.1 * f;
      B[0].position.z = 0;
      tx[I.uaL] = -0.4 + d[8][0]; tz[I.uaL] = 0.7 + d[8][1] * 0.8; tx[I.uaR] = -0.4 + d[12][0]; tz[I.uaR] = -0.7 - d[12][1] * 0.8;
      tx[I.faL] = -0.4; tx[I.faR] = -0.3; tx[I.thL] = d[15][0] * 0.4; tz[I.thL] = 0.1; tx[I.thR] = -0.3 + d[18][0] * 0.4; tz[I.thR] = -0.15;
      tx[I.shL] = 0.2 + Math.abs(d[16][0]); tx[I.shR] = 0.4 + Math.abs(d[19][0]) * 0.8; ty[I.head] = d[5][0] * 1.4; tx[I.jaw] = 0.3; k = 8;
    } else if (s.mode === 'eat') {
      hipDY = -0.52; const e = Math.sin(t * 5.2 + this.seed);
      for (const sd of ['L', 'R']) { tx[I['th' + sd]] = -1.75; tx[I['sh' + sd]] = 2.3; tx[I['ft' + sd]] = -0.5; }
      tz[I.thL] = 0.15; tz[I.thR] = -0.15;
      tx[I.spine] = 0.65; tx[I.chest] = 0.35; tx[I.neck] = 0.25 + e * 0.15; tx[I.head] = 0.25 + Math.sin(t * 5.2 + 0.7) * 0.22; ty[I.head] = Math.sin(t * 1.3) * 0.2;
      tx[I.jaw] = 0.3 + Math.sin(t * 8) * 0.25;
      tx[I.uaL] = -0.95 + Math.sin(t * 4) * 0.2; tx[I.uaR] = -0.95 + Math.sin(t * 4 + 2) * 0.2; tz[I.uaL] = 0.25; tz[I.uaR] = -0.25; tx[I.faL] = -0.9; tx[I.faR] = -0.8;
    } else {
      const sp = s.speed, run = clamp((sp - 2.2) / 2.8, 0, 1), walk = clamp(sp / 1.2, 0, 1), climb = clamp(s.vy * 2, 0, 1);
      const stride = lerp(0.6, 1.15, run) * this.v.s * (this.Z && !s.runner ? 0.75 : 1);
      this.phase += Math.PI * sp / stride * dt;
      const ph = this.phase, A = walk * 0.4 + run * 0.4 + climb * 0.2;
      for (const [sd, off] of [['L', 0], ['R', Math.PI]]) {
        const p = ph + off, sn = Math.sin(p), lim = sd === 'R' ? this.limp : 0;
        let th = -A * sn - run * 0.18 - climb * 0.3 * Math.max(0, sn);
        let kn = walk * (0.08 + 0.75 * Math.max(0, Math.cos(p + 0.5)) ** 2) + run * (0.3 + 1.35 * Math.max(0, Math.cos(p + 0.35)) ** 1.5) + climb * 0.6 * Math.max(0, Math.sin(p + 0.4));
        th *= 1 - lim * 0.55; kn *= 1 - lim * 0.75;
        tx[I['th' + sd]] = th; tx[I['sh' + sd]] = kn; tx[I['ft' + sd]] = -(th + kn) * 0.65 + walk * 0.12 * Math.max(0, -sn);
        const arm = sd === 'L' ? 1 : -1;
        tx[I['ua' + sd]] = (walk * 0.3 + run * 0.65) * sn; tz[I['ua' + sd]] = arm * (0.06 + run * 0.1); tx[I['fa' + sd]] = -(0.12 + walk * 0.15 + run * 1.15);
      }
      hipDY = (walk * 0.02 + run * 0.04) * Math.cos(2 * ph) - run * 0.06;
      ty[I.hips] = -0.12 * walk * Math.sin(ph); tz[I.hips] = 0.035 * walk * Math.cos(ph) + this.limp * 0.07 * Math.sin(ph);
      tx[I.spine] = 0.03 + run * 0.22; ty[I.chest] = -ty[I.hips] * 1.3; tx[I.neck] = -tx[I.spine] * 0.4; tx[I.head] = -tx[I.spine] * 0.3;
      if (sp < 0.15) { tx[I.chest] += 0.025 * Math.sin(t * 1.7); tz[I.hips] += 0.03 * Math.sin(t * 0.5); }
      if (this.Z) {
        const ag = s.agit, hunch = 0.22 - (s.runner ? run * 0.1 : 0);
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
        if (Math.random() < dt * 0.35) { const b = pick(Math.random, [I.head, I.uaL, I.uaR, I.neck, I.chest]); this.imp[b] = (Math.random() - 0.5) * 1.2; }
      } else if (s.fear > 0.5) {
        if (Math.sin(t * 0.9 + this.seed) > 0.8) ty[I.neck] = 1.1 * (this.seed > 5 ? 1 : -1);
        if (sp < 0.5) { tx[I.uaL] = tx[I.uaR] = -1.9; tz[I.uaL] = 0.5; tz[I.uaR] = -0.5; tx[I.faL] = tx[I.faR] = -1.6; tx[I.spine] = 0.3; hipDY -= 0.1; } // 웅크림
      }
      if (s.atk > 0) {
        const a = Math.sin(Math.PI * clamp(s.atk, 0, 1));
        tx[I.spine] += 0.35 * a; tx[I.chest] += 0.2 * a; tx[I.head] += 0.15 * a; tx[I.jaw] = 0.55 * a;
        for (const [sd, arm] of [['L', 1], ['R', -1]]) { tx[I['ua' + sd]] = lerp(tx[I['ua' + sd]], -1.55, a); tz[I['ua' + sd]] = arm * lerp(0.15, -0.2, a); tx[I['fa' + sd]] = -0.25 * a; }
      }
      if (s.aim) { tx[I.uaR] = -1.45; ty[I.uaR] = 0.3; tx[I.faR] = -0.2; tx[I.uaL] = -1.35; tz[I.uaL] = -0.3; tx[I.faL] = -0.6; }
      // 피격 반응(스프링)
      this.hitV.x += (-this.hit.x * 60 - this.hitV.x * 9) * dt; this.hitV.y += (-this.hit.y * 60 - this.hitV.y * 9) * dt;
      this.hit.x += this.hitV.x * dt; this.hit.y += this.hitV.y * dt;
      tx[I.spine] -= this.hit.y * 0.5; tx[I.chest] -= this.hit.y * 0.4; tx[I.head] -= this.hit.y * 0.6; tz[I.spine] += this.hit.x * 0.4;
      B[0].rotation.x = damp(B[0].rotation.x, 0, 10, dt); B[0].position.y = 0;
    }
    for (let i = 1; i < 21; i++) {
      this.imp[i] *= Math.exp(-dt * 6);
      const b = B[i].rotation;
      b.x = damp(b.x, tx[i] + this.imp[i], k, dt); b.y = damp(b.y, ty[i], k, dt); b.z = damp(b.z, tz[i] + this.imp[i] * 0.5, k, dt);
    }
    B[I.hips].position.y = damp(B[I.hips].position.y, this.hipsY + hipDY, 12, dt);
  }
  impulse(dx, dz) { this.hitV.x += dx * 6; this.hitV.y += dz * 6; }
  // 피격 판정 구
  spheres() {
    const out = [], b = this.b, mw = this.mesh.matrixWorld;
    b.head.getWorldPosition(_v); out.push({ c: _v.clone().add(new THREE.Vector3(0, 0.09, 0)), r: 0.14, part: 'head' });
    b.chest.getWorldPosition(_v); out.push({ c: _v.clone(), r: 0.26, part: 'body' });
    b.hips.getWorldPosition(_v); out.push({ c: _v.clone(), r: 0.22, part: 'body' });
    for (const n of ['shL', 'shR', 'faL', 'faR']) { b[n].getWorldPosition(_v); out.push({ c: _v.clone(), r: 0.13, part: 'limb' }); }
    return out;
  }
  setDead(dir = -1) { this.st.mode = 'dead'; this.deadT = 0; this.deadDir = dir; }
}

// 길 위에 놓을 시체(정적 메시로 굽기)
export function bakeCorpseGeo(idx) {
  const h = new Human('zombie', idx); h.setDead(-1);
  for (let i = 0; i < 60; i++) h.update(0.05);
  h.mesh.updateMatrixWorld(true); h.mesh.skeleton.update();
  const src = h.mesh.geometry, pos = src.attributes.position, out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { _v.fromBufferAttribute(pos, i); h.mesh.applyBoneTransform(i, _v); out.set([_v.x, _v.y, _v.z], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(out, 3)); g.setAttribute('color', src.attributes.color);
  g.setAttribute('uv', src.attributes.uv); g.setIndex(src.index); g.computeVertexNormals();
  // 시체가 땅에 눕도록: 회전 결과 이미 누워 있음, 바닥 높이 보정
  g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0); g.computeBoundingSphere();
  return g;
}
