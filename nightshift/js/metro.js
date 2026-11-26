// 수도권(서울 크기) 확장: 가로 26km × 세로 24km ≈ 620km². 가까운 구역(블록)만 그때그때 만들고 멀어지면 치움.
// 도심 업무지구(유리 고층 빌딩) · 아파트 단지(동 번호) · 빌라촌 · 상가 거리(간판) · 공원 · 학교 · 한강(강변 공원·다리) · 외곽 숲
// 길은 기존 달빛동 도로와 그대로 이어지고, 바깥 순환도로가 둘러쌈. 길가엔 가로등·가로수·세워진 차, 도로엔 다니는 차.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROADS } from './city.js';

export const METRO = { x0: -13000, x1: 13000, z0: -10000, z1: 14000 };
export const CORE = { x0: -452, x1: 452, z0: -352, z1: 292 };
export const RIVER = { z0: 2440, z1: 2940, y: -2.2, nRoad: 2372, sRoad: 3012 };
export const CBDS = [{ x: 2600, z: -1700, r: 1100, name: '도심 업무지구' }, { x: 5600, z: 4700, r: 1300, name: '강남 업무지구' }, { x: -3900, z: 2000, r: 800, name: '여의 금융지구' }];
const SP = 160, SW = 3.5, CNS = ROADS.NS, CEW = ROADS.EW.map(r => (r.z0 + r.z1) / 2);
export function nsLines(a, b) {
  const s = new Set(); for (const x of [...CNS, CORE.x0, CORE.x1]) if (x >= a && x <= b) s.add(x);
  for (let k = 1; CORE.x1 + SP * k <= Math.min(b, METRO.x1); k++) if (CORE.x1 + SP * k >= a) s.add(CORE.x1 + SP * k);
  for (let k = 1; CORE.x0 - SP * k >= Math.max(a, METRO.x0); k++) if (CORE.x0 - SP * k <= b) s.add(CORE.x0 - SP * k);
  return [...s].sort((p, q) => p - q);
}
export function ewLines(a, b) {
  const s = new Set(); for (const z of [...CEW, CORE.z0, CORE.z1]) if (z >= a && z <= b) s.add(z);
  for (let k = 1; CORE.z1 + SP * k <= Math.min(b, METRO.z1); k++) if (CORE.z1 + SP * k >= a) s.add(CORE.z1 + SP * k);
  for (let k = 1; CORE.z0 - SP * k >= Math.max(a, METRO.z0); k++) if (CORE.z0 - SP * k <= b) s.add(CORE.z0 - SP * k);
  return [...s].sort((p, q) => p - q);
}
const ring = v => v === CORE.x0 || v === CORE.x1 || v === CORE.z0 || v === CORE.z1;
export const roadW = (v, ns) => (ns ? CNS : CEW).includes(v) ? 8 : ring(v) ? 12 : (Math.round(Math.abs(v - (ns ? CORE.x1 : CORE.z1)) / SP) % 3 === 0 ? 14 : 10);
export const isBridge = x => x === 50 || x === CORE.x0 || x === CORE.x1 || (Math.abs(x) > 452 && Math.round((Math.abs(x) - 452) / SP) % 5 === 0);
const inRiverBand = z => z > RIVER.nRoad + 1 && z < RIVER.sRoad - 1;
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const h2 = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
export function zoneOf(xa, xb, za, zb) {
  const cx = (xa + xb) / 2, cz = (za + zb) / 2;
  if (za >= RIVER.nRoad && zb <= RIVER.sRoad) return 'river';
  if (cx < METRO.x0 + 700 || cx > METRO.x1 - 700 || cz < METRO.z0 + 700 || cz > METRO.z1 - 700) return 'forest';
  for (const c of CBDS) if (Math.hypot(cx - c.x, cz - c.z) < c.r) return 'cbd';
  const r = h2(Math.round(cx), Math.round(cz)), big = h2(Math.round(cx / 900), Math.round(cz / 900));
  if (big < 0.08) return 'park';
  if (big > 0.75) return r < 0.7 ? 'apt' : r < 0.85 ? 'shops' : 'school';
  return r < 0.3 ? 'apt' : r < 0.58 ? 'villa' : r < 0.86 ? 'shops' : r < 0.93 ? 'park' : 'school';
}
// 구역 설계도 (메시 없이 계산만): 지도와 실제 건물이 똑같음
const PLAN = new Map();
export function planOf(xa, xb, za, zb) {
  const key = xa + '|' + za; if (PLAN.has(key)) return PLAN.get(key);
  const R = rng(Math.floor(h2(xa * 0.37, za * 0.61) * 4e9)), rnd = (a, b) => a + R() * (b - a), pick = a => a[R() * a.length | 0];
  const zone = zoneOf(xa, xb, za, zb), wl = roadW(xa, 1), wr = roadW(xb, 1), wt = roadW(za, 0), wb = roadW(zb, 0);
  const ix0 = xa + wl / 2 + SW, ix1 = xb - wr / 2 - SW, iz0 = za + wt / 2 + SW, iz1 = zb - wb / 2 - SW, blds = [], trees = [], extra = {};
  const row = (x0, x1, z0, z1, front, kinds, hMin, hMax, wMin, wMax, shops = true) => { let x = x0; while (x < x1 - 5) { const w = Math.min(x1 - x, rnd(wMin, wMax)); if (w > 5) blds.push({ x0: x, x1: x + w, z0, z1, h: rnd(hMin, hMax), kind: pick(kinds), front, shops }); x += w + rnd(0.5, 2.5); } };
  const col = (z0, z1, x0, x1, front, kinds, hMin, hMax, wMin, wMax, shops = true) => { let z = z0; while (z < z1 - 5) { const w = Math.min(z1 - z, rnd(wMin, wMax)); if (w > 5) blds.push({ x0, x1, z0: z, z1: z + w, h: rnd(hMin, hMax), kind: pick(kinds), front, shops }); z += w + rnd(0.5, 2.5); } };
  if (zone === 'shops' || zone === 'villa') {
    const kinds = zone === 'shops' ? ['brick', 'stone', 'old', 'apt', 'office'] : ['apt', 'old', 'brick', 'apt'], hMin = zone === 'shops' ? 9 : 10, hMax = zone === 'shops' ? 26 : 16, d = rnd(13, 17);
    row(ix0, ix1, iz0, iz0 + d, 'n', kinds, hMin, hMax, 9, 18, zone === 'shops' || R() < 0.4); row(ix0, ix1, iz1 - d, iz1, 's', kinds, hMin, hMax, 9, 18, zone === 'shops' || R() < 0.4);
    if (iz1 - iz0 - 2 * d > 30) { col(iz0 + d + 4, iz1 - d - 4, ix0, ix0 + 14, 'w', kinds, hMin * 0.8, hMax * 0.8, 10, 16, zone === 'shops'); col(iz0 + d + 4, iz1 - d - 4, ix1 - 14, ix1, 'e', kinds, hMin * 0.8, hMax * 0.8, 10, 16, zone === 'shops'); }
    for (let i = 0; i < 6; i++) trees.push([rnd(ix0 + 18, ix1 - 18), rnd(iz0 + d + 3, iz1 - d - 3)]);
  } else if (zone === 'apt') {
    const n = 1 + (R() * 3 | 0), slabD = 13, gap = (iz1 - iz0 - 10) / Math.max(1, n); let num = 100 + (R() * 20 | 0);
    for (let i = 0; i < n + 1 && iz0 + 8 + i * gap + slabD < iz1 - 6; i++) { const z0 = iz0 + 8 + i * gap, w = Math.min(ix1 - ix0 - 20, rnd(48, 78)), x0 = ix0 + 10 + rnd(0, Math.max(0, ix1 - ix0 - 20 - w)); blds.push({ x0, x1: x0 + w, z0, z1: z0 + slabD, h: rnd(38, 72), kind: 'apt', front: 's', apt: num++ }); }
    extra.parking = true; for (let i = 0; i < 10; i++) trees.push([rnd(ix0 + 4, ix1 - 4), rnd(iz0 + 2, iz1 - 2)]);
  } else if (zone === 'cbd') {
    const n = 1 + (R() * 3 | 0); let x = ix0 + 6;
    for (let i = 0; i < n && x < ix1 - 30; i++) { const w = Math.min(ix1 - 6 - x, rnd(26, 46)), d = Math.min(iz1 - iz0 - 16, rnd(26, 46)), z0 = iz0 + 8 + rnd(0, Math.max(0, iz1 - iz0 - 16 - d)); blds.push({ x0: x, x1: x + w, z0, z1: z0 + d, h: rnd(70, 210), kind: pick(['glass', 'office', 'glass']), front: 'n', shops: false, tower: true }); x += w + rnd(10, 22); }
    for (let i = 0; i < 8; i++) trees.push([rnd(ix0 + 3, ix1 - 3), pick([iz0 + 3, iz1 - 3])]);
  } else if (zone === 'school') {
    blds.push({ x0: ix0 + 6, x1: ix1 - 6, z0: iz0 + 4, z1: iz0 + 18, h: 16, kind: 'stone', front: 's', shops: false }); extra.field = [ix0 + 12, ix1 - 12, iz0 + 26, iz1 - 6];
    for (let x = ix0 + 4; x < ix1 - 4; x += 12) trees.push([x, iz1 - 2]);
  } else if (zone === 'park' || zone === 'forest') {
    const n = zone === 'forest' ? 70 : 34; for (let i = 0; i < n; i++) trees.push([rnd(ix0 + 2, ix1 - 2), rnd(iz0 + 2, iz1 - 2)]);
    if (zone === 'park') extra.pond = [rnd(ix0 + 30, ix1 - 30), rnd(iz0 + 30, iz1 - 30), rnd(10, 18)];
  } else if (zone === 'river') {
    for (const [z0, z1] of [[iz0, RIVER.z0 - 6], [RIVER.z1 + 6, iz1]]) if (z1 - z0 > 4) for (let x = ix0 + 6; x < ix1; x += 14) trees.push([x + rnd(-3, 3), rnd(z0, z1)]);
  }
  const p = { zone, xa, xb, za, zb, wl, wr, wt, wb, ix0, ix1, iz0, iz1, blds, trees, extra, seed: R };
  if (PLAN.size > 3000) PLAN.delete(PLAN.keys().next().value); PLAN.set(key, p); return p;
}

export class Metro {
  constructor({ scene, city, colliders, spawnCar, removeCar, lamps }) {
    Object.assign(this, { scene, city, colliders, spawnCar, removeCar, lamps }); this.mats = city.mats; this.cells = new Map(); this.queue = []; this.t = 0; this.cars = [];
    const M = this.mats.M;
    this.mWater = new THREE.MeshStandardMaterial({ color: 0x0a1826, roughness: 0.06, metalness: 0.55, envMapIntensity: 1.6 });
    this.mGrass = M({ color: 0x2d4a2a, roughness: 1 }); this.mBike = M({ color: 0x7a3328, roughness: 0.8 }); this.mConc = M({ color: 0x8e8b85, roughness: 0.9 }); this.mRail = M({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 });
    this.mField = M({ color: 0x7a5a3a, roughness: 1 }); this.mPark = M({ color: 0x3a3e44, roughness: 0.8 }); this.mWhite = new THREE.MeshBasicMaterial({ color: 0xd9d9d9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    this.buildRing(); this.buildBackdrop();
    // 바깥 경계 (못 나가게)
    for (const c of [{ x0: METRO.x0 - 20, x1: METRO.x0, z0: METRO.z0, z1: METRO.z1 }, { x0: METRO.x1, x1: METRO.x1 + 20, z0: METRO.z0, z1: METRO.z1 }, { x0: METRO.x0, x1: METRO.x1, z0: METRO.z0 - 20, z1: METRO.z0 }, { x0: METRO.x0, x1: METRO.x1, z0: METRO.z1, z1: METRO.z1 + 20 }]) colliders.push({ ...c, noPhys: true });
  }
  // 달빛동을 둘러싼 순환도로 + 달빛동 길 끝을 순환도로까지 잇기
  buildRing() {
    const geos = new Map(), A = this.mats, add = (m, g) => { if (!geos.has(m)) geos.set(m, []); geos.get(m).push(g); };
    const flat = (m, x0, x1, z0, z1, y = 0, uvs = 1) => { const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2); const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * uvs, -p.getZ(i) * uvs); add(m, g); };
    const C = CORE, w = 6;
    flat(A.mAsph, C.x0 - w, C.x1 + w, C.z0 - w, C.z0 + w, 0, 0.125); flat(A.mAsph, C.x0 - w, C.x1 + w, C.z1 - w, C.z1 + w, 0, 0.125);
    flat(A.mAsph, C.x0 - w, C.x0 + w, C.z0 + w, C.z1 - w, 0, 0.125); flat(A.mAsph, C.x1 - w, C.x1 + w, C.z0 + w, C.z1 - w, 0, 0.125);
    for (const r of ROADS.EW) { flat(A.mAsph, ROADS.X1, C.x1 - w, r.z0, r.z1, 0, 0.125); flat(A.mAsph, C.x0 + w, ROADS.X0, r.z0, r.z1, 0, 0.125); }
    for (const x of CNS) { flat(A.mAsph, x - 4, x + 4, ROADS.Z1, C.z1 - w, 0, 0.125); flat(A.mAsph, x - 4, x + 4, C.z0 + w, ROADS.Z0, 0, 0.125); }
    const line = (x0, x1, z0, z1) => flat(A.mYellow, x0, x1, z0, z1, 0.012, 1);
    line(C.x0, C.x1, C.z0 - 0.08, C.z0 + 0.08); line(C.x0, C.x1, C.z1 - 0.08, C.z1 + 0.08); line(C.x0 - 0.08, C.x0 + 0.08, C.z0, C.z1); line(C.x1 - 0.08, C.x1 + 0.08, C.z0, C.z1);
    const root = new THREE.Group(); for (const [m, list] of geos) { const mesh = new THREE.Mesh(mergeGeometries(list), m); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; root.add(mesh); }
    this.scene.add(root);
  }
  // 멀리 둘러싼 산 능선 (서울을 감싼 산처럼) + 산 위 전망타워 불빛: 하늘처럼 나를 따라다님
  buildBackdrop() {
    const g = new THREE.Group(), N = 220, pos = [], idx = [];
    for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2, n = Math.sin(a * 3) * 0.5 + Math.sin(a * 7 + 1) * 0.3 + Math.sin(a * 17 + 2) * 0.15 + Math.sin(a * 41) * 0.05, h = 14 + n * 12 + (Math.abs(Math.sin(a * 1.5)) > 0.9 ? 10 : 0);
      pos.push(Math.cos(a) * 225, -20, Math.sin(a) * 225, Math.cos(a) * 225, h, Math.sin(a) * 225); if (i < N) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); } }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0b0e16, fog: false, depthWrite: false, side: THREE.DoubleSide })); m.renderOrder = -1; g.add(m);
    const pos2 = []; for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2 + 0.01, n = Math.sin(a * 2 + 3) * 0.5 + Math.sin(a * 5) * 0.3 + Math.sin(a * 13 + 1) * 0.2, h = 6 + n * 7; pos2.push(Math.cos(a) * 218, -20, Math.sin(a) * 218, Math.cos(a) * 218, h, Math.sin(a) * 218); }
    const geo2 = new THREE.BufferGeometry(); geo2.setAttribute('position', new THREE.Float32BufferAttribute(pos2, 3)); geo2.setIndex(idx);
    const m2 = new THREE.Mesh(geo2, new THREE.MeshBasicMaterial({ color: 0x121722, fog: false, depthWrite: false, side: THREE.DoubleSide })); m2.renderOrder = -1; g.add(m2);
    // 전망타워 (북쪽 산 위, 깜빡이는 항공장애등)
    const ta = -Math.PI / 2 + 0.25, tx = Math.cos(ta) * 222, tz = Math.sin(ta) * 222, tm = new THREE.MeshBasicMaterial({ color: 0x1a2030, fog: false, depthWrite: false });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 16, 8), tm); shaft.position.set(tx, 30, tz); shaft.renderOrder = -1; g.add(shaft);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(2, 1.6, 1.6, 12), new THREE.MeshBasicMaterial({ color: 0xffd8a0, fog: false, depthWrite: false })); deck.position.set(tx, 36, tz); deck.renderOrder = -1; g.add(deck);
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a2a, fog: false, depthWrite: false })); this.beacon.position.set(tx, 39, tz); this.beacon.renderOrder = -1; g.add(this.beacon);
    this.backdrop = g; this.scene.add(g);
  }
  // ── 구역 하나 만들기 (hi: 가까이 = 간판·가로등·나무·차까지 / lo: 멀리 = 건물 덩어리만) ──
  build(p, hi) {
    const A = this.mats, geos = new Map(), add = (m, g) => { if (!geos.has(m)) geos.set(m, []); geos.get(m).push(g.index ? g.toNonIndexed() : g); };
    const cols = [], lamps = [], cars = [], R = rng(Math.floor(h2(p.xa * 0.91, p.za * 0.13) * 4e9)), rnd = (a, b) => a + R() * (b - a);
    const box = (m, sx, sy, sz, x, y, z) => add(m, new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z));
    const flat = (m, x0, x1, z0, z1, y = 0, uvs = 1) => { if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return; const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2); const ps = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < ps.count; i++) uv.setXY(i, ps.getX(i) * uvs, -ps.getZ(i) * uvs); add(m, g); };
    const plane = (m, w, h, x, y, z, ry, uvf) => { const g = new THREE.PlaneGeometry(w, h); if (uvf) uvf(g.attributes.uv); g.rotateY(ry); g.translate(x, y, z); add(m, g); };
    const { xa, xb, za, zb, wl, wr, wt, wb, zone } = p, river = zone === 'river';
    // 길 (이 구역 쪽 절반씩) · 중앙선 · 차선 · 연석 · 보도
    const edges = [
      { ns: true, v: xa, w: wl, s: 1, a: za, b: zb, onRing: xa === CORE.x1 && za >= CORE.z0 && zb <= CORE.z1, main: true },
      { ns: true, v: xb, w: wr, s: -1, a: za, b: zb, onRing: xb === CORE.x0 && za >= CORE.z0 && zb <= CORE.z1 },
      { ns: false, v: za, w: wt, s: 1, a: xa, b: xb, onRing: za === CORE.z1 && xa >= CORE.x0 && xb <= CORE.x1, main: true },
      { ns: false, v: zb, w: wb, s: -1, a: xa, b: xb, onRing: zb === CORE.z0 && xa >= CORE.x0 && xb <= CORE.x1 },
    ];
    for (const e of edges) {
      const road = !(river && ((e.ns && !isBridge(e.v)) || (!e.ns && inRiverBand(e.v)))), hw = e.w / 2;
      const r0 = Math.min(e.v, e.v + e.s * hw), r1 = Math.max(e.v, e.v + e.s * hw);
      const inner0 = e.a + (e.ns ? wt : wl) / 2, inner1 = e.b - (e.ns ? wb : wr) / 2;   // 교차로 사이 구간
      if (road && !e.onRing) {
        if (e.ns) flat(A.mAsph, r0, r1, e.a, e.b, 0, 0.125); else flat(A.mAsph, e.a, e.b, r0, r1, 0, 0.125);
        if (e.main && hi) { for (const o of [-0.12, 0.12]) e.ns ? flat(A.mYellow, e.v + o - 0.06, e.v + o + 0.06, inner0, inner1, 0.012) : flat(A.mYellow, inner0, inner1, e.v + o - 0.06, e.v + o + 0.06, 0.012); }
        if (hi && e.w >= 10) for (let u = inner0 + 2; u < inner1 - 3; u += 9) { const o = e.v + e.s * hw / 2; e.ns ? flat(this.mWhite, o - 0.07, o + 0.07, u, u + 3, 0.012) : flat(this.mWhite, u, u + 3, o - 0.07, o + 0.07, 0.012); }
        // 횡단보도 (교차로 앞)
        if (hi && e.main) for (const at of [inner0 + 1.5, inner1 - 3.5]) for (let k = -hw + 0.6; k < hw - 0.4; k += 1.1) e.ns ? flat(this.mWhite, e.v + k, e.v + k + 0.55, at, at + 2, 0.013) : flat(this.mWhite, at, at + 2, e.v + k, e.v + k + 0.55, 0.013);
      }
      // 다리 위: 콘크리트 난간 + 교각
      if (river && e.ns && isBridge(e.v)) {
        const bx = e.v + e.s * (hw + 0.2); box(this.mConc, 0.4, 0.9, RIVER.z1 - RIVER.z0 + 12, bx, 0.45, (RIVER.z0 + RIVER.z1) / 2); cols.push({ x0: bx - 0.2, x1: bx + 0.2, z0: Math.max(e.a, RIVER.z0 - 6), z1: Math.min(e.b, RIVER.z1 + 6) });
        box(this.mConc, hw, 0.8, Math.min(e.b, RIVER.z1) - Math.max(e.a, RIVER.z0), e.v + e.s * hw / 2, -0.4, (Math.max(e.a, RIVER.z0) + Math.min(e.b, RIVER.z1)) / 2);
        if (e.main) for (let z = Math.ceil(Math.max(e.a, RIVER.z0) / 60) * 60; z < Math.min(e.b, RIVER.z1); z += 60) box(this.mConc, 4, 8, 3, e.v, -4.6, z);
        if (hi) for (let z = Math.max(e.a, RIVER.z0) + 10; z < Math.min(e.b, RIVER.z1); z += 36) lamps.push([bx - e.s * 0.1, z, -e.s, 0]);
        continue;
      }
      if (!road || e.onRing) continue;
      // 보도 + 연석
      const k0 = e.v + e.s * hw, k1 = k0 + e.s * SW, q0 = Math.min(k0, k1), q1 = Math.max(k0, k1);
      if (e.ns) flat(A.mPave, q0, q1, inner0, inner1, 0.005, 0.31); else flat(A.mPave, inner0, inner1, q0, q1, 0.005, 0.31);
      if (hi) { if (e.ns) box(A.mCurb, 0.2, 0.14, inner1 - inner0, k0 + e.s * 0.1, 0.07, (inner0 + inner1) / 2); else box(A.mCurb, inner1 - inner0, 0.14, 0.2, (inner0 + inner1) / 2, 0.07, k0 + e.s * 0.1); }
      if (hi && !river) {
        for (let u = inner0 + 8 + (e.main ? 0 : 15); u < inner1 - 4; u += 30) lamps.push(e.ns ? [k0 + e.s * 0.6, u, e.s, 0] : [u, k0 + e.s * 0.6, 0, e.s]);
        if (zone !== 'forest') for (let u = inner0 + 12; u < inner1 - 6; u += 15) p.trees.push(e.ns ? [k0 + e.s * 1.7, u, 's'] : [u, k0 + e.s * 1.7, 's']);
        // 길가에 세워진 차
        if (this.spawnCar && (zone === 'shops' || zone === 'villa' || zone === 'apt') && R() < 0.55) { const u = rnd(inner0 + 10, inner1 - 10), lane = e.v + e.s * (hw - 1.4); cars.push(e.ns ? [lane, u, e.s > 0 ? Math.PI : 0] : [u, lane, e.s > 0 ? -Math.PI / 2 : Math.PI / 2]); }
      }
    }
    // 바닥
    const g0 = p.ix0 - 0.01, g1 = p.ix1 + 0.01, h0 = p.iz0 - 0.01, h1 = p.iz1 + 0.01;
    if (river) {
      const wz0 = Math.max(za, RIVER.z0), wz1 = Math.min(zb, RIVER.z1);
      if (wz1 > wz0) { flat(this.mWater, xa, xb, wz0, wz1, RIVER.y, 0.05); for (const bz of [RIVER.z0, RIVER.z1]) if (bz > za && bz < zb) { box(this.mConc, xb - xa, 2.4, 0.5, (xa + xb) / 2, -1.0, bz); const bl = isBridge(xa) ? xa + wl / 2 + 0.5 : xa, br = isBridge(xb) ? xb - wr / 2 - 0.5 : xb; cols.push({ x0: bl, x1: br, z0: bz - 0.5, z1: bz + 0.5 }); if (hi) box(this.mRail, br - bl, 0.06, 0.06, (bl + br) / 2, 1.0, bz + (bz === RIVER.z0 ? -0.4 : 0.4)); } }
      for (const [z0, z1] of [[za + wt / 2, Math.min(zb, RIVER.z0)], [Math.max(za, RIVER.z1), zb - wb / 2]]) if (z1 - z0 > 0.5) { flat(this.mGrass, xa + (isBridge(xa) ? wl / 2 : 0), xb - (isBridge(xb) ? wr / 2 : 0), z0, z1, 0.004, 0.2); const bz = z0 < RIVER.z0 ? z1 - 12 : z0 + 9; flat(this.mBike, xa + (isBridge(xa) ? wl / 2 : 0), xb - (isBridge(xb) ? wr / 2 : 0), bz, bz + 3, 0.008, 0.5); }
    } else {
      const gm = zone === 'park' || zone === 'forest' ? this.mGrass : zone === 'apt' ? this.mPark : A.mPave;
      flat(gm, g0, g1, h0, h1, 0.004, gm === A.mPave ? 0.31 : 0.2);
    }
    if (p.extra.field) { const [a, b, c, d] = p.extra.field; flat(this.mField, a, b, c, d, 0.008, 0.2); flat(this.mWhite, (a + b) / 2 - 0.08, (a + b) / 2 + 0.08, c + 2, d - 2, 0.012); }
    if (p.extra.pond && hi) { const [x, z, r] = p.extra.pond, g = new THREE.CircleGeometry(r, 28); g.rotateX(-Math.PI / 2); g.translate(x, 0.02, z); add(this.mWater, g); cols.push({ x0: x - r * 0.8, x1: x + r * 0.8, z0: z - r * 0.8, z1: z + r * 0.8 }); }
    if (p.extra.parking && hi) for (let x = p.ix0 + 6; x < p.ix1 - 6; x += 2.6) flat(this.mWhite, x, x + 0.1, p.iz1 - 7, p.iz1 - 2, 0.012);
    // 건물
    for (const b of p.blds) {
      const sx = b.x1 - b.x0, sz = b.z1 - b.z0, g = new THREE.BoxGeometry(sx, b.h, sz), uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) { const f = Math.floor(i / 4), W = f < 2 ? sz : sx; uv.setXY(i, uv.getX(i) * W / 12, uv.getY(i) * b.h / 12); }
      g.translate((b.x0 + b.x1) / 2, b.h / 2, (b.z0 + b.z1) / 2); add(A.FM[b.kind], g); box(A.mRoof, sx + 0.3, 0.4, sz + 0.3, (b.x0 + b.x1) / 2, b.h + 0.2, (b.z0 + b.z1) / 2);
      cols.push({ x0: b.x0 - 0.1, x1: b.x1 + 0.1, z0: b.z0 - 0.1, z1: b.z1 + 0.1 });
      if (b.tower) { box(A.mRooftop, sx * 0.5, 4, sz * 0.5, (b.x0 + b.x1) / 2, b.h + 2.4, (b.z0 + b.z1) / 2); if (hi) box(A.mBulb, 0.5, 0.5, 0.5, (b.x0 + b.x1) / 2, b.h + 4.6, (b.z0 + b.z1) / 2); }
      if (!hi) continue;
      const fz = b.front === 'n' ? b.z0 - 0.02 : b.front === 's' ? b.z1 + 0.02 : null, fx = b.front === 'w' ? b.x0 - 0.02 : b.front === 'e' ? b.x1 + 0.02 : null;
      if (b.apt) { // 아파트 동 번호 (옆벽 꼭대기)
        const n = b.apt % 16; for (const [x, ry] of [[b.x0 - 0.03, -Math.PI / 2], [b.x1 + 0.03, Math.PI / 2]]) plane(A.mAptNum, Math.min(9, sz * 0.7), Math.min(4.5, sz * 0.35), x, b.h - 4, (b.z0 + b.z1) / 2, ry, u => { for (let i = 0; i < u.count; i++) u.setXY(i, (n % 4 + u.getX(i)) / 4, 1 - (Math.floor(n / 4) + 1 - u.getY(i)) / 4); });
      }
      if (b.shops && (fz !== null || fx !== null)) {
        const len = fz !== null ? sx : sz, a0 = fz !== null ? b.x0 : b.z0;
        for (let u = a0 + 0.5; u < a0 + len - 4; u += 8 + R() * 4) {
          const wv = Math.min(7, a0 + len - 0.5 - u), shop = R() * A.nShops | 0, mid = u + wv / 2, uvf = q => { for (let i = 0; i < q.count; i++) q.setXY(i, (shop % 4 + q.getX(i)) / 4, 1 - (Math.floor(shop / 4) + 1 - q.getY(i)) / 4); };
          if (fz !== null) { const ry = b.front === 'n' ? Math.PI : 0, d = b.front === 'n' ? -1 : 1; plane(R() < 0.6 ? A.mShopWin : A.mShutter, wv, 2.6, mid, 1.35, fz, ry); plane(A.mSign, wv, 1.1, mid, 3.35, fz + d * 0.02, ry, uvf); }
          else { const ry = b.front === 'w' ? -Math.PI / 2 : Math.PI / 2, d = b.front === 'w' ? -1 : 1; plane(R() < 0.6 ? A.mShopWin : A.mShutter, wv, 2.6, fx, 1.35, mid, ry); plane(A.mSign, wv, 1.1, fx + d * 0.02, 3.35, mid, ry, uvf); }
        }
      }
      if (b.h > 6 && b.kind !== 'glass' && b.kind !== 'office' && fz !== null) { const d = b.front === 'n' ? -1 : 1, z = b.front === 'n' ? b.z0 : b.z1; for (let i = 0; i < Math.min(5, b.h / 3 | 0); i++) if (R() < 0.5) { const ax = rnd(b.x0 + 1, b.x1 - 1), ay = 4.5 + (R() * (b.h - 6) / 3 | 0) * 3 + 0.4; box(A.mAC, 0.8, 0.55, 0.32, ax, ay, z + d * 0.17); box(A.mGrille, 0.6, 0.4, 0.01, ax, ay, z + d * 0.335); } }
      if (b.h > 12 && !b.tower && R() < 0.5) box(A.mRooftop, rnd(1.5, 3), rnd(1.2, 2.2), rnd(1.5, 3), rnd(b.x0 + 2, b.x1 - 2), b.h + 1, rnd(b.z0 + 2, b.z1 - 2));
    }
    // 나무 · 가로등
    if (hi) {
      for (const [x, z] of p.trees) {
        if (p.blds.some(b => x > b.x0 - 2 && x < b.x1 + 2 && z > b.z0 - 2 && z < b.z1 + 2)) continue;
        const s = 0.8 + h2(x, z) * 0.5, tg = new THREE.CylinderGeometry(0.09 * s, 0.15 * s, 3.4 * s, 6, 1, true); tg.translate(x, 1.7 * s, z); add(A.mBark, tg);
        for (let i = 0; i < 9; i++) { const a = i * 0.7 + h2(z, x + i) * 2, w = (1.4 + h2(x + i, z) * 0.6) * s, g = new THREE.PlaneGeometry(w, w * 2); g.translate(0, -w * 0.55, 0); g.rotateY(a); g.translate(x + Math.cos(a) * 0.5 * s, (3.6 + (i % 3) * 0.5) * s + w * 0.55, z + Math.sin(a) * 0.5 * s); add(A.mCard, g); }
        cols.push({ x0: x - 0.18, x1: x + 0.18, z0: z - 0.18, z1: z + 0.18 });
      }
      for (const [x, z, dx, dz] of lamps) {
        box(A.mPole, 0.16, 6.5, 0.16, x, 3.25, z); box(A.mPole, dx ? 1.6 : 0.1, 0.1, dz ? 1.6 : 0.1, x + dx * 0.8, 6.4, z + dz * 0.8); box(A.mBulb, 0.5, 0.08, 0.3, x + dx * 1.5, 6.3, z + dz * 1.5);
        const cg = new THREE.CylinderGeometry(0.18, 2.4, 6.3, 14, 1, true); cg.translate(x + dx * 1.5, 3.15, z + dz * 1.5); add(A.mCone, cg);
        cols.push({ x0: x - 0.14, x1: x + 0.14, z0: z - 0.14, z1: z + 0.14 });
      }
    }
    const root = new THREE.Group();
    for (const [m, list] of geos) { const mesh = new THREE.Mesh(mergeGeometries(list.map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; })), m); mesh.matrixAutoUpdate = false; mesh.receiveShadow = true; root.add(mesh); }
    this.scene.add(root);
    for (const c of cols) this.colliders.push(c);
    const lampRecs = lamps.map(([x, z, dx, dz]) => ({ x: x + dx * 1.5, z: z + dz * 1.5, tx: x + dx * 2.5, tz: z + dz * 2.5 })); for (const l of lampRecs) this.lamps.push(l);
    const carRecs = hi && this.spawnCar ? cars.map(([x, z, ry]) => this.spawnCar(x, z, ry)).filter(Boolean) : [];
    return { root, cols, lampRecs, carRecs, hi };
  }
  drop(c) {
    c.root.removeFromParent(); c.root.traverse(o => o.geometry?.dispose());
    const cs = new Set(c.cols); for (let i = this.colliders.length - 1; i >= 0; i--) if (cs.has(this.colliders[i])) this.colliders.splice(i, 1);
    const ls = new Set(c.lampRecs); for (let i = this.lamps.length - 1; i >= 0; i--) if (ls.has(this.lamps[i])) this.lamps.splice(i, 1);
    for (const v of c.carRecs) this.removeCar?.(v);
  }
  // 내 주변 구역 불러오기/치우기 (한 프레임에 하나씩 만들어 끊김 없게)
  update(dt, me) {
    if (this.beacon) { this.backdrop.position.set(me.x, 0, me.z); this.beacon.visible = Math.floor(performance.now() / 700) % 2 === 0; }
    if ((this.t -= dt) < 0) {
      const q = window.__q; this.t = 0.5; const RAD = q === 'low' ? 360 : q === 'mid' ? 480 : 600, HI = q === 'low' ? 160 : q === 'mid' ? 220 : 280, want = new Map();
      const xs = nsLines(me.x - RAD - SP, me.x + RAD + SP), zs = ewLines(me.z - RAD - SP, me.z + RAD + SP);
      for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
        const xa = xs[i], xb = xs[i + 1], za = zs[j], zb = zs[j + 1];
        if (xa >= CORE.x0 && xb <= CORE.x1 && za >= CORE.z0 && zb <= CORE.z1) continue;
        const dx = Math.max(0, xa - me.x, me.x - xb), dz = Math.max(0, za - me.z, me.z - zb), d = Math.hypot(dx, dz); if (d > RAD) continue;
        want.set(xa + '|' + za, { xa, xb, za, zb, hi: d < HI, d });
      }
      for (const [k, c] of this.cells) { const w = want.get(k); if (!w || (w.hi !== c.hi && Math.abs(w.d - HI) > 20)) { this.drop(c); this.cells.delete(k); } }
      this.queue = [...want.entries()].filter(([k]) => !this.cells.has(k)).sort((a, b) => a[1].d - b[1].d);
    }
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < 6) { const [k, w] = this.queue.shift(); if (this.cells.has(k)) continue; this.cells.set(k, this.build(planOf(w.xa, w.xb, w.za, w.zb), w.hi)); }
    this.drive(dt, me);
  }
  // 바깥 도로를 달리는 차 (오른쪽 차선, 앞에 사람·차 있으면 멈춤)
  drive(dt, me) {
    if (!this.spawnCar) return; const inMetro = !(me.x > CORE.x0 - 40 && me.x < CORE.x1 + 40 && me.z > CORE.z0 - 40 && me.z < CORE.z1 + 40);
    for (const c of [...this.cars]) {
      const v = c.v; if (v.wreck || v.mesh === this.ride?.()) { this.cars.splice(this.cars.indexOf(c), 1); continue; }
      const m = v.mesh;
      let sp = c.speed, blocked = false;
      const px = c.ax === 'x' ? c.s : c.c, pz = c.ax === 'x' ? c.c : c.s, fx = c.ax === 'x' ? c.dir : 0, fz = c.ax === 'x' ? 0 : c.dir;
      const chk = (x, z) => { const ddx = x - px, ddz = z - pz, a = ddx * fx + ddz * fz, sd = Math.abs(ddx * fz - ddz * fx); if (a > 0 && a < 9 && sd < 1.8) blocked = true; };
      chk(me.x, me.z); for (const o of this.cars) if (o !== c) chk(o.v.mesh.position.x, o.v.mesh.position.z);
      if (blocked) sp = 0; v.cur += (sp - v.cur) * Math.min(1, dt * (blocked ? 4 : 0.8));
      c.s += c.dir * v.cur * dt; const nx = c.ax === 'x' ? c.s : c.c, nz = c.ax === 'x' ? c.c : c.s;
      m.position.set(nx, 0, nz); m.rotation.y = c.ax === 'x' ? (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.dir > 0 ? 0 : Math.PI);
      for (const w of m.userData.wheels || []) w.rotation.x += v.cur * dt / 0.34;
      if (v.snd) { this.audio?.movePanner(v.snd, m.position); v.snd.playbackRate.value = 0.5 + v.cur / 30; }
      const far = Math.hypot(nx - me.x, nz - me.z) > 280, bad = (nx > CORE.x0 && nx < CORE.x1 && nz > CORE.z0 && nz < CORE.z1) || (c.ax === 'z' && !isBridge(c.line) && inRiverBand(nz)) || (c.ax === 'x' && inRiverBand(c.line));
      if (far || bad) { this.removeCar(v); this.cars.splice(this.cars.indexOf(c), 1); }
    }
    if (!inMetro || this.cars.length >= 12 || Math.random() > dt * 3) return;
    // 새 차: 내 주변 140~230m 길 위
    const ns = Math.random() < 0.5, lines = ns ? nsLines(me.x - 230, me.x + 230) : ewLines(me.z - 230, me.z + 230); if (!lines.length) return;
    const line = lines[Math.random() * lines.length | 0], dir = Math.random() < 0.5 ? 1 : -1, w = roadW(line, ns), off = w / 4 + (w >= 14 ? 0.6 : 0);
    const along = (ns ? me.z : me.x) + (Math.random() < 0.5 ? -1 : 1) * (140 + Math.random() * 90), c = ns ? line - dir * off : line + dir * off;
    const x = ns ? c : along, z = ns ? along : c; if (Math.hypot(x - me.x, z - me.z) < 120) return;
    if ((x > CORE.x0 - 10 && x < CORE.x1 + 10 && z > CORE.z0 - 10 && z < CORE.z1 + 10) || (ns && !isBridge(line) && inRiverBand(z)) || (!ns && inRiverBand(line)) || x < METRO.x0 + 50 || x > METRO.x1 - 50 || z < METRO.z0 + 50 || z > METRO.z1 - 50) return;
    const v = this.spawnCar(x, z, 0, true); if (!v) return; v.cur = 8; v.parked = false;
    this.cars.push({ v, ax: ns ? 'z' : 'x', c, line, s: along, dir, speed: 9 + Math.random() * 6 });
  }
  // 행인이 걸을 보도 (가까운 구역)
  sidewalks(me) {
    const out = [];
    for (const k of this.cells.keys()) {
      const [xa, za] = k.split('|').map(Number); const c = this.cells.get(k); if (!c.hi) continue;
      const xs = nsLines(xa, xa + 400), zs = ewLines(za, za + 400), xb = xs[1], zb = zs[1]; if (xb === undefined || zb === undefined) continue;
      const p = planOf(xa, xb, za, zb); if (p.zone === 'river' || Math.hypot((xa + xb) / 2 - me.x, (za + zb) / 2 - me.z) > 160) continue;
      out.push({ axis: 'x', c: za + p.wt / 2 + 1.8, a: xa + p.wl / 2 + 2, b: xb - p.wr / 2 - 2, y: 0 }, { axis: 'x', c: zb - p.wb / 2 - 1.8, a: xa + p.wl / 2 + 2, b: xb - p.wr / 2 - 2, y: 0 },
        { axis: 'z', c: xa + p.wl / 2 + 1.8, a: za + p.wt / 2 + 2, b: zb - p.wb / 2 - 2, y: 0 }, { axis: 'z', c: xb - p.wr / 2 - 1.8, a: za + p.wt / 2 + 2, b: zb - p.wb / 2 - 2, y: 0 });
    }
    return out;
  }
  // 물건(쓰레기통 등)을 놓을 연석선
  curbs(me) {
    return this.sidewalks(me).map(s => ({ ax: s.axis, c: s.c, a: s.a + 4, b: s.b - 4, out: 0 }));
  }
}
