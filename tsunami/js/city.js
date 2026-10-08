// 해랑시 도시: 도로망 · 구별 건물 배치 · 절차적 파사드 · 나무 · 시설물 · 건물 손상(유체력)
import * as THREE from 'three';
import { makeRng } from '../../src/core/utils.js';
import { WORLD, HALF, G } from './config.js';
import { coastZ, inlandDist, riverX, districtAt, PORT_Z, BREAKWATER, KNOLLS, sstep } from './geo.js';
import { GLSL_NOISE } from './terrain.js';
import { box, cyl, merge, gableGeometry } from './geom.js';

export const STYLE = { house: 0, apt: 1, office: 2, hotel: 3, shop: 4, warehouse: 5, school: 6, shelter: 7, rubble: 9 };
const STYLE_NAME = ['단독주택', '아파트', '오피스 빌딩', '호텔', '상가', '창고', '학교', '대피소', '', '잔해'];
const STRENGTH = [17, 260, 300, 260, 48, 60, 280, 420];

const AVENUES = []; for (let z = -1100; z <= 420; z += 130) AVENUES.push(z);
const STREETS = []; for (let x = -1980; x <= 1960; x += 110) STREETS.push(x);

export class City {
  constructor(terrain, q) {
    this.t = terrain;
    this.q = q;
    this.rng = makeRng(20261007);
    this.roads = [];
    this.buildings = [];
    this.trees = [];
    this.cars = [];
    this.containers = [];
    this.boats = [];
    this.umbrellas = [];
    this.shelters = [];
    this.layoutRoads();
    this.layoutBuildings();
    this.buildHash();
    this.layoutTrees();
    this.layoutVehicles();
  }

  /* ───────────────────────── 배치 ───────────────────────── */
  riverDist(x, z) { return Math.abs(x - riverX(z)); }

  landOk(x, z, minInl = 95) {
    const g = this.t.terrainAt(x, z);
    return g > 0.9 && g < 26 && inlandDist(x, z) > minInl && this.riverDist(x, z) > 42 && this.t.slopeAt(x, z) < 0.22;
  }

  addRoad(x0, z0, x1, z1, w, kind) { this.roads.push({ x0, z0, x1, z1, w, kind }); }

  layoutRoads() {
    // 동서 대로 (강을 만나면 다리)
    for (const z of AVENUES) {
      for (let m = 0; m < STREETS.length - 1; m++) {
        const x0 = STREETS[m], x1 = STREETS[m + 1];
        let ok = true, river = false;
        for (let s = 0; s <= 6; s++) {
          const x = x0 + (x1 - x0) * s / 6;
          if (this.landOk(x, z)) continue;
          if (this.riverDist(x, z) < 50 && this.t.terrainAt(x, z) < 26 && inlandDist(x, z) > 95) { river = true; continue; }
          ok = false; break;
        }
        if (!ok) continue;
        this.addRoad(x0, z, x1, z, 14, 'avenue');
        if (river) {
          const rx = riverX(z);
          const deck = Math.max(this.t.terrainAt(rx - 52, z), this.t.terrainAt(rx + 52, z)) + 0.4;
          this.t.bridges.push({ x0: rx - 50, x1: rx + 50, z0: z - 7, z1: z + 7, deck, dir: 'x' });
        }
      }
    }
    // 남북 도로
    for (const x of STREETS) {
      for (let k = 0; k < AVENUES.length - 1; k++) {
        const z0 = AVENUES[k], z1 = AVENUES[k + 1];
        let ok = true;
        for (let s = 0; s <= 6; s++) if (!this.landOk(x, z0 + (z1 - z0) * s / 6)) { ok = false; break; }
        if (ok) this.addRoad(x, z0, x, z1, 10, 'street');
      }
    }
    // 해안 도로 + 산책로
    this.promenade = [];
    let prev = null;
    for (let x = -980; x <= 1080; x += 20) {
      const z = coastZ(x) - 88;
      const g = this.t.terrainAt(x, z);
      const rv = this.riverDist(x, z) < 50;
      const ok = (g > 0.9 && g < 22) || rv;
      if (ok && prev) {
        this.addRoad(prev[0], prev[1], x, z, 12, 'coastal');
        if (rv && !prev[2]) {
          const rx = riverX(z);
          const deck = Math.max(this.t.terrainAt(rx - 55, z), this.t.terrainAt(rx + 55, z), 2.5) + 0.4;
          this.t.bridges.push({ x0: rx - 52, x1: rx + 52, z0: z - 8, z1: z + 8, deck, dir: 'x' });
        }
      }
      prev = ok ? [x, z, rv] : null;
      if (ok && !rv && x > -180 && x < 900) this.promenade.push([x, coastZ(x) - 72]);
    }
  }

  tryBuilding(cx, cz, w, d, style, h, opts = {}) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    let gmin = 1e9, gmax = -1e9;
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [cx, cz]]) {
      const g = this.t.terrainAt(x, z);
      if (g < 1.0 || inlandDist(x, z) < (opts.minInl ?? 96) || this.riverDist(x, z) < 44) return null;
      gmin = Math.min(gmin, g); gmax = Math.max(gmax, g);
    }
    if (gmax - gmin > (opts.maxDrop ?? 4)) return null;
    if (opts.check) for (const b of this.buildings) {
      if (Math.abs(b.x - cx) < (b.w + w) / 2 + 3 && Math.abs(b.z - cz) < (b.d + d) / 2 + 3) return null;
    }
    const r = this.rng;
    const floorH = style === STYLE.office ? 3.8 : style === STYLE.house ? 2.9 : style === STYLE.warehouse ? 1 : 3.2;
    const b = {
      id: this.buildings.length, x: cx, z: cz, w, d, h, base: gmin - 0.2, style,
      floors: style === STYLE.warehouse ? 1 : Math.max(1, Math.round(h / floorH)),
      district: districtAt(cx, cz), gable: style === STYLE.house, roofH: 1.6 + r() * 1.4,
      strength: STRENGTH[style] * (0.8 + r() * 0.4),
      evac: false, alive: true, damage: 0, collapse: -1, fall: [0, 0], seed: r(),
      name: opts.name || STYLE_NAME[style], color: opts.color || this.wallColor(style),
    };
    b.evac = [STYLE.apt, STYLE.office, STYLE.hotel, STYLE.school, STYLE.shelter].includes(style) && b.floors >= 3;
    b.top = b.base + h;
    this.buildings.push(b);
    return b;
  }

  wallColor(style) {
    const r = this.rng;
    const pal = {
      [STYLE.house]: [0xe8e0d0, 0xd9c7a8, 0xf0ece4, 0xc9b49a, 0xdde4e8, 0xe6d3c0, 0xb8a58c],
      [STYLE.apt]: [0xe9e6de, 0xdcd8cc, 0xefe9dc, 0xd2d6d8],
      [STYLE.office]: [0x9aa6ad, 0xb3b8b5, 0x7f8c93, 0xc4c1b8],
      [STYLE.hotel]: [0xf2efe8, 0xe8e2d4, 0xf5f0e6],
      [STYLE.shop]: [0xe4b07a, 0xd6dce2, 0xf0d9a8, 0xc98a72, 0xa9c8b8, 0xe8e8e0],
      [STYLE.warehouse]: [0x8a98a8, 0x6f8fa8, 0xa8aca0, 0x9a6e5a, 0x7a9a84],
      [STYLE.school]: [0xece0c0],
      [STYLE.shelter]: [0xdfe8dc],
    }[style] || [0xdddddd];
    return pal[Math.floor(r() * pal.length)];
  }

  layoutBuildings() {
    const r = this.rng;
    let schoolDone = false;
    for (let k = 0; k < AVENUES.length - 1; k++) {
      for (let m = 0; m < STREETS.length - 1; m++) {
        const bx0 = STREETS[m] + 9, bx1 = STREETS[m + 1] - 9;
        const bz0 = AVENUES[k] + 10;
        const cxm = (bx0 + bx1) / 2;
        let bz1 = Math.min(AVENUES[k + 1] - 10, coastZ(cxm) - 102);
        if (bz1 - bz0 < 24) continue;
        const cx = cxm, cz = (bz0 + bz1) / 2;
        const dist = districtAt(cx, cz);
        if (dist < 0 || dist === 5) continue;
        const W = bx1 - bx0, D = bz1 - bz0;
        const inl = inlandDist(cx, cz);
        if (dist === 0) {
          if (inl < 260) { this.containerYard(bx0, bz0, bx1, bz1); continue; }
          if (r() < 0.22) this.tryBuilding(cx, cz, Math.min(W - 6, 36), Math.min(D - 6, 22), STYLE.apt, 16 + r() * 8, { name: '항만 사무소' });
          else {
            const n = D > 70 ? 2 : 1;
            for (let i = 0; i < n; i++) {
              const dd = (D - 8 * n) / n;
              this.tryBuilding(cx, bz0 + 4 + dd / 2 + i * (dd + 8), W - 8, dd, STYLE.warehouse, 9 + r() * 4, { name: '물류 창고' });
            }
          }
        } else if (dist === 1) {
          if (!schoolDone && Math.abs(cx + 760) < 120 && Math.abs(cz + 200) < 140) {
            if (this.tryBuilding(cx, cz - 10, W - 10, 18, STYLE.school, 14.4, { name: '해랑초등학교' })) { schoolDone = true; continue; }
          }
          if (r() < 0.14) {
            this.tryBuilding(cx, bz0 + D * 0.28, W - 12, 14, STYLE.apt, 14 + r() * 18, { name: '강변 아파트' });
            this.tryBuilding(cx, bz0 + D * 0.74, W - 12, 14, STYLE.apt, 14 + r() * 18, { name: '강변 아파트' });
          } else this.houseLots(bx0, bz0, bx1, bz1);
        } else if (dist === 2) {
          if (inl < 270) {
            const n = W > 80 ? 2 : 1;
            for (let i = 0; i < n; i++) {
              const ww = (W - 10 * n) / n;
              this.tryBuilding(bx0 + 5 + ww / 2 + i * (ww + 10), bz1 - 13, ww * (0.75 + r() * 0.2), 18 + r() * 6, STYLE.hotel, 26 + r() * 40, { name: '해변 호텔' });
            }
            this.shopRow(bx0, bz0, bx1, bz0 + Math.max(14, D - 40));
          } else this.shopRow(bx0, bz0, bx1, bz1);
        } else if (dist === 3) {
          const roll = r();
          if (roll < 0.1) continue; // 공원
          if (roll < 0.45) {
            this.tryBuilding(cx, bz0 + D * 0.27, W - 14, 15, STYLE.apt, 30 + r() * 22, { name: '중앙 아파트' });
            this.tryBuilding(cx, bz0 + D * 0.75, W - 14, 15, STYLE.apt, 30 + r() * 22, { name: '중앙 아파트' });
          } else {
            const n = W > 85 && r() < 0.6 ? 2 : 1;
            for (let i = 0; i < n; i++) {
              const ww = (W - 10 * n) / n;
              this.tryBuilding(bx0 + 5 + ww / 2 + i * (ww + 10), cz, ww * (0.7 + r() * 0.25), Math.min(D - 12, 26 + r() * 14), STYLE.office, 30 + Math.pow(r(), 1.6) * 85, { name: '오피스 빌딩' });
            }
          }
        } else if (dist === 4) {
          this.houseLots(bx0, bz0, bx1, bz1);
        }
      }
    }
    // 등대곶 어촌 마을
    for (let i = 0; i < 260 && this.buildings.length < 4000; i++) {
      const x = 900 + r() * 420, z = 200 + r() * 520;
      const inl = inlandDist(x, z), g = this.t.terrainAt(x, z);
      if (inl < 60 || inl > 380 || g > 14) continue;
      this.tryBuilding(x, z, 8 + r() * 4, 7 + r() * 3, STYLE.house, 3 + Math.floor(r() * 2) * 2.9, { minInl: 55, check: true, maxDrop: 3 });
    }
    // 고지대 대피소
    const sites = [[-1460, -1180], [-760, -1100], [40, -1120], [760, -1040], [1500, -760], [1450, 760],
      ...KNOLLS.map((k) => [k.x, k.z])];
    for (const [sx, sz] of sites) {
      for (let tries = 0; tries < 40; tries++) {
        const x = sx + (r() - 0.5) * 220, z = sz + (r() - 0.5) * 220;
        const g = this.t.terrainAt(x, z);
        if (g < 20 || this.t.slopeAt(x, z) > 0.3) continue;
        const b = this.tryBuilding(x, z, 24, 14, STYLE.shelter, 7.5, { minInl: 0, check: true, maxDrop: 6, name: '지정 대피소' });
        if (b) { b.top = b.base + b.h; this.shelters.push(b); break; }
      }
    }
    // 산마루구 주택
    for (let i = 0; i < 300; i++) {
      const x = -1950 + r() * 3900, z = -1500 + r() * 700;
      const g = this.t.terrainAt(x, z);
      if (g < 18 || g > 70 || this.t.slopeAt(x, z) > 0.18) continue;
      this.tryBuilding(x, z, 9 + r() * 3, 8 + r() * 3, STYLE.house, 2.9 + Math.floor(r() * 2) * 2.9, { minInl: 0, check: true, maxDrop: 3 });
    }
    // 등대
    let best = null;
    for (let x = 1300; x <= 1600; x += 10) for (let z = 650; z <= 900; z += 10) {
      const inl = inlandDist(x, z);
      if (inl < 50 || inl > 90) continue;
      const g = this.t.terrainAt(x, z);
      if (!best || z > best[1]) best = [x, z, g];
    }
    this.lighthouse = best ? { x: best[0], z: best[1], y: best[2] } : { x: 1450, z: 820, y: 30 };
  }

  houseLots(x0, z0, x1, z1) {
    const r = this.rng;
    const lw = 17, ld = 19;
    const nx = Math.max(1, Math.floor((x1 - x0) / lw)), nz = Math.max(1, Math.floor((z1 - z0) / ld));
    const sx = (x1 - x0) / nx, sz = (z1 - z0) / nz;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (r() < 0.12) continue;
      const w = 8.5 + r() * 4, d = 8 + r() * 3.5;
      const cx = x0 + (i + 0.5) * sx + (r() - 0.5) * (sx - w - 3) * 0.6;
      const cz = z0 + (j + 0.5) * sz + (r() - 0.5) * (sz - d - 3) * 0.6;
      const fl = r() < 0.55 ? 2 : 1;
      this.tryBuilding(cx, cz, w, d, STYLE.house, fl * 2.9 + 0.3);
    }
  }

  shopRow(x0, z0, x1, z1) {
    const r = this.rng;
    const D = z1 - z0;
    if (D < 12) return;
    let x = x0 + 2;
    while (x < x1 - 10) {
      const w = 10 + r() * 10;
      if (x + w > x1 - 1) break;
      const d = Math.min(D - 4, 12 + r() * 10);
      const tall = r() < 0.18;
      this.tryBuilding(x + w / 2, z0 + 2 + d / 2, w, d, tall ? STYLE.apt : STYLE.shop, tall ? 13 + r() * 10 : 6.5 + Math.floor(r() * 3) * 3.5, { name: tall ? '상가 건물' : '상점' });
      if (D > 40) this.tryBuilding(x + w / 2, z1 - 2 - d / 2, w, d, STYLE.shop, 6.5 + Math.floor(r() * 2) * 3.5, { name: '상점' });
      x += w + 2 + r() * 3;
    }
  }

  containerYard(x0, z0, x1, z1) {
    const r = this.rng;
    const cap = { low: 260, medium: 420, high: 600, ultra: 800 }[this.q.key] || 420;
    if (this.containers.length >= cap) return;
    const cols = [0xb83a2a, 0x2a5fa8, 0xd9822b, 0x3d8a4a, 0x8a8f94, 0xe0c040, 0x6a3a8a, 0x1f6f7a];
    for (let z = z0 + 4; z < z1 - 3; z += 6.5) {
      for (let x = x0 + 8; x < x1 - 8; x += 13.5) {
        if (r() < 0.25) continue;
        const g = this.t.terrainAt(x, z);
        if (g < 1 || inlandDist(x, z) < 20) continue;
        if (this.containers.length >= cap) return;
        const n = 1 + Math.floor(r() * 3.6);
        for (let s = 0; s < n; s++) {
          this.containers.push({ x, z, y: g + s * 2.6, yaw: 0, color: cols[Math.floor(r() * cols.length)] });
        }
      }
    }
  }

  buildHash() {
    this.HC = 40;
    this.HN = Math.ceil(WORLD / this.HC);
    this.hash = Array.from({ length: this.HN * this.HN }, () => []);
    for (const b of this.buildings) {
      const i0 = Math.floor((b.x - b.w / 2 + HALF) / this.HC), i1 = Math.floor((b.x + b.w / 2 + HALF) / this.HC);
      const j0 = Math.floor((b.z - b.d / 2 + HALF) / this.HC), j1 = Math.floor((b.z + b.d / 2 + HALF) / this.HC);
      for (let j = Math.max(0, j0); j <= Math.min(this.HN - 1, j1); j++)
        for (let i = Math.max(0, i0); i <= Math.min(this.HN - 1, i1); i++) this.hash[j * this.HN + i].push(b);
    }
  }

  nearBuildings(x, z) {
    const i = Math.floor((x + HALF) / this.HC), j = Math.floor((z + HALF) / this.HC);
    if (i < 0 || j < 0 || i >= this.HN || j >= this.HN) return [];
    return this.hash[j * this.HN + i];
  }

  /** 원(x,z,r)을 건물 밖으로 밀어냄. y가 지붕보다 높으면 무시. 충돌 건물 반환 */
  collide(p, r, y = -1e9) {
    let hit = null;
    for (const b of this.nearBuildings(p.x, p.z)) {
      if (!b.alive || y > b.top - 0.3) continue;
      const hx = b.w / 2 + r, hz = b.d / 2 + r;
      const dx = p.x - b.x, dz = p.z - b.z;
      if (dx > -hx && dx < hx && dz > -hz && dz < hz) {
        const px = hx - Math.abs(dx), pz = hz - Math.abs(dz);
        if (px < pz) p.x = b.x + Math.sign(dx || 1) * hx; else p.z = b.z + Math.sign(dz || 1) * hz;
        hit = b;
      }
    }
    return hit;
  }

  buildingAt(x, z, margin = 0) {
    for (const b of this.nearBuildings(x, z)) {
      if (Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(z - b.z) < b.d / 2 + margin) return b;
    }
    return null;
  }

  nearRoad(x, z, extra = 0) {
    for (const rd of this.roads) {
      const vx = rd.x1 - rd.x0, vz = rd.z1 - rd.z0;
      let t = ((x - rd.x0) * vx + (z - rd.z0) * vz) / (vx * vx + vz * vz);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - rd.x0 - vx * t, dz = z - rd.z0 - vz * t;
      if (dx * dx + dz * dz < (rd.w / 2 + extra) ** 2) return true;
    }
    return false;
  }

  layoutTrees() {
    const r = this.rng, max = this.q.trees;
    const add = (x, z, type, s) => {
      if (this.trees.length >= max) return;
      this.trees.push({ x, z, y: this.t.terrainAt(x, z), type, s, fall: 0, fx: 0, fz: 0, alive: true });
    };
    // 야자수 (산책로)
    for (const [x, z] of this.promenade) if (r() < 0.55) add(x + (r() - 0.5) * 6, z + 5 + r() * 4, 2, 0.85 + r() * 0.35);
    // 가로수
    for (const rd of this.roads) {
      if (rd.kind !== 'avenue') continue;
      const dist = districtAt((rd.x0 + rd.x1) / 2, rd.z0);
      if (dist === 0 || dist < 0) continue;
      for (let x = rd.x0 + 8; x < rd.x1 - 8; x += 16 + r() * 6) {
        for (const side of [-1, 1]) {
          const z = rd.z0 + side * (rd.w / 2 + 2.2);
          if (this.buildingAt(x, z, 1.5) || this.riverDist(x, z) < 45) continue;
          if (this.t.terrainAt(x, z) > 0.8) add(x, z, 0, 0.7 + r() * 0.3);
        }
      }
    }
    // 숲 (산마루 · 언덕 · 등대곶)
    let guard = 0;
    while (this.trees.length < max && guard++ < max * 12) {
      const x = -HALF + 20 + r() * (WORLD - 40), z = -HALF + 20 + r() * (WORLD - 40);
      const g = this.t.terrainAt(x, z);
      if (g < 9 || this.t.slopeAt(x, z) > 0.75) continue;
      const knoll = KNOLLS.some((k) => Math.hypot(x - k.x, z - k.z) < k.r * 1.1);
      if (g < 16 && !knoll && r() < 0.85) continue;
      if (this.buildingAt(x, z, 4)) continue;
      if (g < 26 && this.nearRoad(x, z, 3)) continue;
      add(x, z, g > 30 || r() < 0.4 ? 1 : 0, 0.75 + r() * 0.6);
    }
  }

  layoutVehicles() {
    const r = this.rng;
    const maxCars = { low: 80, medium: 140, high: 200, ultra: 260 }[this.q.key] || 140;
    const carCols = [0xf2f2f2, 0xf2f2f2, 0x1a1a1a, 0x1a1a1a, 0x9a9ea2, 0x9a9ea2, 0x5a6066, 0x9c1f1f, 0x1f3f7a, 0xd8cdb4, 0x2f4f3f];
    const roads = this.roads.filter((rd) => rd.kind !== 'coastal');
    for (let guard = 0; this.cars.length < maxCars && guard < 4000; guard++) {
      const rd = roads[Math.floor(r() * roads.length)];
      const t = 0.1 + r() * 0.8;
      const x = rd.x0 + (rd.x1 - rd.x0) * t, z = rd.z0 + (rd.z1 - rd.z0) * t;
      const horiz = rd.z0 === rd.z1;
      const side = r() < 0.5 ? -1 : 1;
      const off = rd.w / 2 - 1.3;
      const px = horiz ? x : x + side * off, pz = horiz ? z + side * off : z;
      if (this.t.groundAt(px, pz) < 0.8 || this.riverDist(px, pz) < 55) continue;
      if (this.cars.some((c) => Math.abs(c.x - px) < 6 && Math.abs(c.z - pz) < 6)) continue;
      const yaw = (horiz ? 0 : Math.PI / 2) + (side < 0 ? Math.PI : 0);
      this.cars.push({ x: px, z: pz, yaw, color: carCols[Math.floor(r() * carCols.length)] });
    }
    // 어선 (항구 안벽 · 등대곶 포구 · 만)
    const boatCols = [0x2a5fa8, 0xb83a2a, 0x1f6f7a, 0x2f8a4a, 0x3a3f8a];
    for (let x = -1960; x < -1180; x += 48 + r() * 30) {
      this.boats.push({ x, z: PORT_Z + 9 + r() * 5, yaw: r() < 0.5 ? 0 : Math.PI, len: 13 + r() * 9, color: boatCols[Math.floor(r() * boatCols.length)] });
    }
    for (let i = 0; i < 6; i++) {
      const x = 960 + r() * 200;
      this.boats.push({ x, z: coastZ(x) + 25 + r() * 40, yaw: r() * 6.28, len: 9 + r() * 6, color: boatCols[Math.floor(r() * boatCols.length)] });
    }
    for (let i = 0; i < 4; i++) {
      const x = -500 + r() * 900;
      this.boats.push({ x, z: coastZ(x) + 220 + r() * 300, yaw: r() * 6.28, len: 10 + r() * 10, color: boatCols[Math.floor(r() * boatCols.length)] });
    }
    this.boats.push({ x: -1500, z: PORT_Z + 20, yaw: 0, len: 72, color: 0x2c3e50, ship: true });
    // 파라솔
    for (let i = 0; i < 90; i++) {
      const x = -150 + r() * 1000;
      const inl = 14 + r() * 42;
      const z = coastZ(x) - inl;
      if (this.t.terrainAt(x, z) < 0.6 || this.riverDist(x, z) < 50) continue;
      this.umbrellas.push({ x, z, y: this.t.terrainAt(x, z), color: [0xe84a4a, 0x3a8ae8, 0xf2c94a, 0x4ac28a, 0xf28a3a, 0xffffff][i % 6], alive: true });
    }
  }

  /* ───────────────────────── 시뮬레이션 연동 ───────────────────────── */
  bindSim(sim) {
    this.sim = sim;
    const N = sim.N, dx = sim.dx;
    for (const b of this.buildings) {
      b.cells = []; b.force = [];
      const i0 = Math.max(0, Math.floor((b.x - b.w / 2 + HALF) / dx) - 1), i1 = Math.min(N - 1, Math.floor((b.x + b.w / 2 + HALF) / dx) + 1);
      const j0 = Math.max(0, Math.floor((b.z - b.d / 2 + HALF) / dx) - 1), j1 = Math.min(N - 1, Math.floor((b.z + b.d / 2 + HALF) / dx) + 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const cx = -HALF + (i + 0.5) * dx, cz = -HALF + (j + 0.5) * dx;
        const inside = Math.abs(cx - b.x) < b.w / 2 && Math.abs(cz - b.z) < b.d / 2;
        const near = Math.abs(cx - b.x) < b.w / 2 + dx * 0.9 && Math.abs(cz - b.z) < b.d / 2 + dx * 0.9;
        const k = j * N + i;
        if (inside) b.cells.push(k);
        else if (near) b.force.push(k);
      }
      if (!b.cells.length) {
        // 셀보다 작은 건물: 해당 셀의 마찰(항력)을 키움
        const k = sim.cellOf(b.x, b.z);
        b.force.push(k);
        sim.n2[k] = Math.max(sim.n2[k], 0.075 * 0.075);
      }
    }
    this.applySolids();
    // 산림 마찰
    for (let k = 0; k < N * N; k++) if (sim.b0[k] > 15) sim.n2[k] = Math.max(sim.n2[k], 0.055 * 0.055);
  }

  applySolids() {
    for (const b of this.buildings) {
      if (!b.alive) continue;
      for (const k of b.cells) this.sim.setSolid(k, Math.max(0, b.top - this.sim.b0[k]));
    }
  }

  /** 유체력에 의한 건물 손상: 압력 지표 P = ½gh² + h·|u|² (m³/s²) */
  updateDamage(dt, onCollapse) {
    const sim = this.sim, h = sim.h, uc = sim.uc, vc = sim.vc;
    for (const b of this.buildings) {
      if (b.collapse >= 0) {
        if (b.collapse < 1) { b.collapse = Math.min(1, b.collapse + dt / 2.8); this.setBuildingMatrix(b); }
        continue;
      }
      if (!b.alive) continue;
      let P = 0, fx = 0, fz = 0, hm = 0;
      for (const k of b.force) {
        const hh = h[k];
        if (hh < 0.05) continue;
        const u = uc[k], v = vc[k];
        const p = 0.5 * G * hh * hh + hh * (u * u + v * v);
        if (p > P) P = p;
        fx += u * hh; fz += v * hh;
        if (hh > hm) hm = hh;
      }
      b.load = P;
      b.waterDepth = hm;
      if (P > b.strength) {
        b.damage += dt * (P / b.strength - 1) * 1.1 + (b.extraHit || 0);
        b.extraHit = 0;
        if (b.damage >= 1) {
          b.alive = false;
          b.collapse = 0;
          const l = Math.hypot(fx, fz) || 1;
          b.fall = [fx / l, fz / l];
          for (const k of b.cells) sim.clearSolid(k);
          onCollapse(b);
        }
      } else if (b.extraHit) {
        b.damage += b.extraHit; b.extraHit = 0;
      }
    }
  }

  /* ───────────────────────── 렌더링 ───────────────────────── */
  buildMeshes(scene, U) {
    const n = this.buildings.length;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0);
    const aStyle = new Float32Array(n), aSeed = new Float32Array(n);
    boxGeo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(aStyle, 1));
    boxGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
    this.facadeMat = makeFacadeMaterial(U);
    this.bMesh = new THREE.InstancedMesh(boxGeo, this.facadeMat, n);
    this.bMesh.castShadow = this.bMesh.receiveShadow = true;
    const col = new THREE.Color();
    const houses = this.buildings.filter((b) => b.gable);
    this.roofMesh = new THREE.InstancedMesh(gableGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.05 }), houses.length);
    this.roofMesh.castShadow = this.roofMesh.receiveShadow = true;
    const roofCols = [0x8a3a2a, 0x3a4a6a, 0x5a5a5a, 0x6a4a3a, 0x2a5a5a, 0x9a5a3a, 0x40464e];
    let ri = 0;
    this.buildings.forEach((b, i) => {
      b.idx = i;
      aStyle[i] = b.style; aSeed[i] = b.seed;
      this.bMesh.setColorAt(i, col.set(b.color));
      if (b.gable) { b.roofIdx = ri; this.roofMesh.setColorAt(ri, col.set(roofCols[Math.floor(b.seed * 97) % roofCols.length])); ri++; }
      this.setBuildingMatrix(b);
    });
    scene.add(this.bMesh, this.roofMesh);

    // 옥상 설비 (고층)
    const rooftop = [];
    for (const b of this.buildings) if (b.floors >= 5 && !b.gable) {
      const k = 1 + Math.floor(b.seed * 3);
      for (let i = 0; i < k; i++) rooftop.push([b, (fract(b.seed * 13.7 * (i + 1)) - 0.5) * b.w * 0.6, (fract(b.seed * 7.3 * (i + 2)) - 0.5) * b.d * 0.6, 2 + fract(b.seed * 31 * (i + 1)) * 3]);
    }
    this.rooftop = rooftop;
    this.rtMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x9a9c9e, roughness: 0.7 }), rooftop.length);
    this.rtMesh.castShadow = true;
    this.updateRooftop();
    scene.add(this.rtMesh);

    this.buildTrees(scene);
    this.buildProps(scene);
  }

  setBuildingMatrix(b) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    let hh = b.h + 3, y = b.base - 3, tilt = 0;
    if (b.collapse >= 0) {
      const c = b.collapse;
      const fin = Math.max(1.5, b.h * 0.14) + 3;
      hh = (b.h + 3) * (1 - c) + fin * c;
      tilt = Math.sin(Math.min(1, c * 1.6) * Math.PI) * (b.style === STYLE.house ? 0.35 : 0.12);
      if (c >= 1 && !b.rubbled) {
        b.rubbled = true;
        this.bMesh.geometry.attributes.aStyle.array[b.idx] = STYLE.rubble;
        this.bMesh.geometry.attributes.aStyle.needsUpdate = true;
        this.updateRooftop();
      }
    }
    q.setFromAxisAngle(p.set(b.fall[1], 0, -b.fall[0]).normalize(), tilt);
    if (!tilt) q.identity();
    const sw = b.collapse >= 1 ? 1.15 : 1;
    m.compose(p.set(b.x + b.fall[0] * tilt * 4, y, b.z + b.fall[1] * tilt * 4), q, s.set(b.w * sw, hh, b.d * sw));
    this.bMesh.setMatrixAt(b.idx, m);
    this.bMesh.instanceMatrix.needsUpdate = true;
    if (b.gable) {
      if (b.collapse >= 0) m.compose(p.set(b.x, b.base + hh - 3, b.z), q, s.set(b.w + 0.8, b.roofH * (1 - b.collapse), b.d + 0.8));
      else m.compose(p.set(b.x, b.top, b.z), q.identity(), s.set(b.w + 0.8, b.roofH, b.d + 0.8));
      this.roofMesh.setMatrixAt(b.roofIdx, m);
      this.roofMesh.instanceMatrix.needsUpdate = true;
    }
  }

  updateRooftop() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    this.rooftop.forEach(([b, ox, oz, sz], i) => {
      if (b.collapse >= 0) m.makeScale(0, 0, 0);
      else m.compose(p.set(b.x + ox, b.top, b.z + oz), q, s.set(sz, sz * 0.6, sz));
      this.rtMesh.setMatrixAt(i, m);
    });
    this.rtMesh.instanceMatrix.needsUpdate = true;
  }

  buildTrees(scene) {
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1, 6).translate(0, 0.5, 0);
    const broad = new THREE.IcosahedronGeometry(1, 1);
    const pine = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
    const palmParts = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      palmParts.push(box(2.6, 0.05, 0.55, Math.cos(a) * 1.25, -0.25, Math.sin(a) * 1.25, 0x3f6a2a, 0, -a, -0.35));
    }
    const palm = merge(palmParts);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.95, envMapIntensity: 0.35 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, envMapIntensity: 0.35 });
    const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, envMapIntensity: 0.35 });
    const T = this.trees;
    this.trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, T.length);
    const byType = [T.filter((t) => t.type === 0), T.filter((t) => t.type === 1), T.filter((t) => t.type === 2)];
    this.crownMeshes = [
      new THREE.InstancedMesh(broad, leafMat, byType[0].length),
      new THREE.InstancedMesh(pine, leafMat, byType[1].length),
      new THREE.InstancedMesh(palm, palmMat, byType[2].length),
    ];
    const col = new THREE.Color();
    byType.forEach((list, ty) => list.forEach((t, i) => {
      t.ci = i;
      if (ty === 0) this.crownMeshes[0].setColorAt(i, col.setHSL(0.24 + Math.random() * 0.06, 0.45, 0.2 + Math.random() * 0.1));
      if (ty === 1) this.crownMeshes[1].setColorAt(i, col.setHSL(0.3 + Math.random() * 0.04, 0.4, 0.13 + Math.random() * 0.06));
    }));
    T.forEach((t, i) => { t.ti = i; this.setTreeMatrix(t); });
    for (const m of [this.trunkMesh, ...this.crownMeshes]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }
  }

  setTreeMatrix(t) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3();
    const H = t.type === 2 ? 9 * t.s : t.type === 1 ? 11 * t.s : 8 * t.s;
    const ang = t.fall * 1.45;
    if (ang > 0) q.setFromAxisAngle(up.set(t.fz, 0, -t.fx).normalize(), ang); else q.identity();
    const trunkH = t.type === 2 ? H : t.type === 1 ? H * 0.35 : H * 0.45;
    m.compose(p.set(t.x, t.y - 0.3, t.z), q, s.set(t.type === 2 ? 0.9 : 1.3 * t.s, trunkH, t.type === 2 ? 0.9 : 1.3 * t.s));
    this.trunkMesh.setMatrixAt(t.ti, m);
    up.set(0, 1, 0).applyQuaternion(q);
    if (t.type === 0) {
      const top = p.set(t.x, t.y, t.z).addScaledVector(up, trunkH + H * 0.28);
      m.compose(top, q, s.set(H * 0.38, H * 0.33, H * 0.38));
    } else if (t.type === 1) {
      const top = p.set(t.x, t.y, t.z).addScaledVector(up, trunkH * 0.6);
      m.compose(top, q, s.set(H * 0.24, H * 0.72, H * 0.24));
    } else {
      const top = p.set(t.x, t.y, t.z).addScaledVector(up, H);
      m.compose(top, q, s.set(t.s, t.s, t.s));
    }
    this.crownMeshes[t.type].setMatrixAt(t.ci, m);
    this.trunkMesh.instanceMatrix.needsUpdate = true;
    this.crownMeshes[t.type].instanceMatrix.needsUpdate = true;
  }

  /** 흐름에 의한 나무 쓰러짐 · 파라솔 유실 */
  updateVegetation(dt) {
    const sim = this.sim;
    this._veg = (this._veg || 0) + dt;
    if (this._veg < 0.2) return;
    const step = this._veg; this._veg = 0;
    for (const t of this.trees) {
      if (t.fall >= 1) continue;
      const k = sim.cellOf(t.x, t.z);
      const hh = sim.h[k];
      if (t.fall > 0) { t.fall = Math.min(1, t.fall + step * 0.8); this.setTreeMatrix(t); continue; }
      if (hh < 0.4) continue;
      const u = sim.uc[k], v = sim.vc[k];
      const P = hh * (u * u + v * v);
      if (P > (t.type === 2 ? 22 : 14) * t.s) {
        const l = Math.hypot(u, v) || 1;
        t.fx = u / l; t.fz = v / l; t.fall = 0.01;
      }
    }
    for (const um of this.umbrellas) {
      if (!um.alive) continue;
      const k = sim.cellOf(um.x, um.z);
      if (sim.h[k] > 0.5 && Math.hypot(sim.uc[k], sim.vc[k]) > 1.2) { um.alive = false; this.umbDirty = true; }
    }
    if (this.umbDirty) { this.umbDirty = false; this.refreshUmbrellas(); }
  }

  buildProps(scene) {
    // 다리
    const parts = [];
    for (const b of this.t.bridges) {
      const L = b.x1 - b.x0, W = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      parts.push(box(L, 1.2, W, cx, b.deck - 0.6, cz, 0x8a8a86));
      parts.push(box(L, 1.0, 0.3, cx, b.deck + 0.5, b.z0 + 0.2, 0xc8c8c0));
      parts.push(box(L, 1.0, 0.3, cx, b.deck + 0.5, b.z1 - 0.2, 0xc8c8c0));
      for (const px of [b.x0 + 18, cx, b.x1 - 18]) parts.push(box(2.2, 8, W * 0.6, px, b.deck - 5, cz, 0x7a7a76));
    }
    // 항만 크레인
    for (let i = 0; i < 4; i++) {
      const x = -1880 + i * 190, z = PORT_Z - 14, y = 3.2;
      const c = i % 2 ? 0xd03a2a : 0x2a6ad0;
      for (const [ox, oz] of [[-7, -5], [7, -5], [-7, 9], [7, 9]]) parts.push(box(1.2, 32, 1.2, x + ox, y + 16, z + oz, c));
      parts.push(box(16, 2, 16, x, y + 32, z + 2, c));
      parts.push(box(2.4, 2.2, 70, x, y + 36, z + 18, c));
      parts.push(box(6, 4, 6, x, y + 34, z + 6, 0xe8e8e0));
    }
    // 방파제 소파블록
    const [a, bw] = BREAKWATER;
    const L = Math.hypot(bw[0] - a[0], bw[1] - a[1]);
    for (let s = 20; s < L; s += 7) {
      const t = s / L, x = a[0] + (bw[0] - a[0]) * t, z = a[1] + (bw[1] - a[1]) * t;
      for (const side of [-1, 1]) {
        const nx = -(bw[1] - a[1]) / L * side, nz = (bw[0] - a[0]) / L * side;
        parts.push(box(3.2, 3.2, 3.2, x + nx * 10, 3.3, z + nz * 10, 0xa8a6a0, s, s * 0.7, s * 1.3));
      }
    }
    // 등대
    const lh = this.lighthouse;
    parts.push(cyl(2.2, 3.2, 22, 16, lh.x, lh.y + 11, lh.z, 0xf4f4f0));
    for (let k = 0; k < 3; k++) parts.push(cyl(2.35 + (2 - k) * 0.3, 2.45 + (2 - k) * 0.3, 2.2, 16, lh.x, lh.y + 4 + k * 6.5, lh.z, 0xc8281e));
    parts.push(cyl(2.8, 2.8, 0.5, 16, lh.x, lh.y + 22.3, lh.z, 0x303030));
    parts.push(cyl(1.6, 1.6, 2.6, 12, lh.x, lh.y + 23.8, lh.z, 0xfff4b0));
    parts.push(cyl(0.1, 2.0, 1.8, 12, lh.x, lh.y + 26, lh.z, 0x303030));
    const propMesh = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.15 }));
    propMesh.castShadow = propMesh.receiveShadow = true;
    scene.add(propMesh);
    this.beacon = new THREE.PointLight(0xfff0a0, 0, 900, 1.2);
    this.beacon.position.set(lh.x, lh.y + 24, lh.z);
    scene.add(this.beacon);

    // 파라솔
    const umb = merge([cyl(0.04, 0.04, 2.4, 5, 0, 1.2, 0, 0xeeeeee), cyl(0.05, 1.5, 0.5, 10, 0, 2.45, 0, 0xffffff)]);
    this.umbMesh = new THREE.InstancedMesh(umb, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), this.umbrellas.length);
    this.umbMesh.castShadow = true;
    const col = new THREE.Color();
    this.umbrellas.forEach((u, i) => this.umbMesh.setColorAt(i, col.set(u.color)));
    this.refreshUmbrellas();
    scene.add(this.umbMesh);
  }

  refreshUmbrellas() {
    const m = new THREE.Matrix4();
    this.umbrellas.forEach((u, i) => {
      if (u.alive) m.makeTranslation(u.x, u.y, u.z); else m.makeScale(0, 0, 0);
      this.umbMesh.setMatrixAt(i, m);
    });
    this.umbMesh.instanceMatrix.needsUpdate = true;
  }

  resetState() {
    for (const b of this.buildings) {
      b.alive = true; b.damage = 0; b.collapse = -1; b.fall = [0, 0]; b.rubbled = false; b.load = 0; b.extraHit = 0;
      this.bMesh.geometry.attributes.aStyle.array[b.idx] = b.style;
      this.setBuildingMatrix(b);
    }
    this.bMesh.geometry.attributes.aStyle.needsUpdate = true;
    this.updateRooftop();
    for (const t of this.trees) { if (t.fall) { t.fall = 0; this.setTreeMatrix(t); } }
    for (const u of this.umbrellas) u.alive = true;
    this.refreshUmbrellas();
    this.applySolids();
  }

  /* ───────────────────────── 토지이용 텍스처 ───────────────────────── */
  drawLanduse(size) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    const s = size / WORLD;
    const P = (x, z) => [(x + HALF) * s, (z + HALF) * s];
    g.fillStyle = 'rgba(0,0,0,1)';
    g.fillRect(0, 0, size, size);
    // 항만 콘크리트 부지
    g.fillStyle = 'rgb(0,230,0)';
    g.beginPath();
    let [px, pz] = P(-HALF, PORT_Z + 2);
    g.moveTo(px, pz);
    for (let x = -HALF; x <= -980; x += 20) { [px, pz] = P(x, Math.min(coastZ(x), PORT_Z) + 2); g.lineTo(px, pz); }
    [px, pz] = P(-980, -230); g.lineTo(px, pz);
    [px, pz] = P(-HALF, -230); g.lineTo(px, pz);
    g.closePath(); g.fill();
    // 건물 주변 포장 / 정원
    for (const b of this.buildings) {
      const [x, z] = P(b.x, b.z);
      if (b.style === STYLE.house) {
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = 'rgba(0,0,0,0.85)';
        g.fillRect(x - (b.w / 2 + 3) * s, z - (b.d / 2 + 3) * s, (b.w + 6) * s, (b.d + 6) * s);
        g.globalCompositeOperation = 'source-over';
      } else if (b.district !== 5 || b.style === STYLE.shelter) {
        g.fillStyle = 'rgb(0,200,0)';
        g.fillRect(x - (b.w / 2 + 6) * s, z - (b.d / 2 + 6) * s, (b.w + 12) * s, (b.d + 12) * s);
      }
    }
    // 학교 운동장
    // 도로: 보도 → 차도 → 차선
    g.lineCap = 'round';
    const stroke = (style, wAdd) => {
      g.strokeStyle = style;
      for (const rd of this.roads) {
        g.lineWidth = Math.max(1, (rd.w + wAdd) * s);
        g.beginPath();
        const a = P(rd.x0, rd.z0), b = P(rd.x1, rd.z1);
        g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
    };
    stroke('rgb(0,255,0)', 6);
    stroke('rgb(255,0,0)', 0);
    if (s >= 0.5) {
      g.setLineDash([3 * s, 4 * s]);
      g.strokeStyle = 'rgb(255,0,200)';
      g.lineWidth = Math.max(1, 0.25 * s);
      for (const rd of this.roads) {
        if (rd.kind === 'street') continue;
        g.beginPath();
        const a = P(rd.x0, rd.z0), b = P(rd.x1, rd.z1);
        g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
      g.setLineDash([]);
    }
    // 해변 산책로
    g.strokeStyle = 'rgb(0,255,0)';
    g.lineWidth = 7 * s;
    g.beginPath();
    this.promenade.forEach(([x, z], i) => { const p = P(x, z); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
    g.stroke();
    // 다리 위는 지형 표시 안 함 (다리 메시가 덮음)
    return cv;
  }
}

function fract(x) { return x - Math.floor(x); }

function makeFacadeMaterial(U) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, envMapIntensity: 0.75 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aStyle; attribute float aSeed;
varying vec3 vFac; varying vec3 vFacN; varying float vStyle; varying float vSeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 bsc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vFac = position * bsc; vFacN = normal; vStyle = aStyle; vSeed = aSeed;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFac; varying vec3 vFacN; varying float vStyle; varying float vSeed; uniform float uNight;
${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float fRough = 0.86; float fMetal = 0.0; vec3 fEmit = vec3(0.0);
{
  int st = int(vStyle + 0.5);
  float isTop = step(0.5, vFacN.y);
  float isSide = 1.0 - step(0.5, abs(vFacN.y));
  float u = abs(vFacN.x) > 0.5 ? vFac.z : vFac.x;
  float v = vFac.y - 3.0;
  float face = vFacN.x * 3.0 + vFacN.z * 7.0;
  vec3 wall = diffuseColor.rgb;
  float floorH = 3.0, colW = 3.0, ww = 0.5, wh = 0.5, wy = 0.55;
  if (st == 0) { floorH = 2.9; colW = 3.4; ww = 0.42; wh = 0.42; }
  else if (st == 1) { floorH = 2.9; colW = 3.1; ww = 0.62; wh = 0.5; }
  else if (st == 2) { floorH = 3.8; colW = 1.7; ww = 0.9; wh = 0.8; wy = 0.5; }
  else if (st == 3) { floorH = 3.2; colW = 3.8; ww = 0.66; wh = 0.62; }
  else if (st == 4) { floorH = 3.5; colW = 4.2; ww = 0.7; wh = 0.5; }
  else if (st == 5) { floorH = 12.0; colW = 6.0; ww = 0.6; wh = 0.08; wy = 0.8; }
  else if (st == 6) { floorH = 3.6; colW = 3.3; ww = 0.8; wh = 0.5; }
  else if (st == 7) { floorH = 3.75; colW = 4.0; ww = 0.5; wh = 0.4; }
  float fu = fract(u / colW), fv = fract(v / floorH);
  float fi = floor(v / floorH), ci = floor(u / colW);
  float win = step(abs(fu - 0.5), ww * 0.5) * step(abs(fv - wy), wh * 0.5) * isSide * step(0.0, v);
  if (st == 4 && fi < 0.5) win = step(abs(fu - 0.5), 0.46) * step(0.06, fv) * step(fv, 0.84) * isSide * step(0.0, v);
  if (st == 9) win = 0.0;
  float rnd = hash12(vec2(ci + face * 13.1, fi + vSeed * 91.7));
  vec3 glass = mix(vec3(0.035, 0.05, 0.07), vec3(0.14, 0.2, 0.25), rnd);
  if (st == 2) glass = mix(vec3(0.06, 0.15, 0.19), vec3(0.18, 0.3, 0.36), rnd * 0.7);
  float grime = vnoise(vec2(u, v) * 0.35 + vSeed * 10.0) * 0.14;
  wall *= 0.9 + grime - 0.12 * (1.0 - smoothstep(0.0, 2.5, v)) * isSide;
  if (st == 1 || st == 3 || st == 7) wall = mix(wall, wall * 0.72, step(fv, 0.11) * isSide);
  if (st == 7) wall = mix(wall, vec3(0.15, 0.6, 0.3), step(abs(v - 6.5), 0.5) * isSide);
  if (st == 5) wall *= 0.84 + 0.16 * step(0.5, fract(u * 1.3));
  if (st == 9) wall = mix(vec3(0.38, 0.33, 0.27), vec3(0.2, 0.18, 0.16), vnoise(vFac.xz * 0.9 + vFac.y * 2.0));
  if (isTop > 0.5) { wall = mix(vec3(0.4, 0.4, 0.39), vec3(0.54, 0.53, 0.5), vnoise(vFac.xz * 0.3)); if (st == 9) wall = vec3(0.32, 0.28, 0.23); if (st == 7) wall = vec3(0.2, 0.55, 0.3); }
  diffuseColor.rgb = mix(wall, glass, win);
  fRough = mix(0.88, 0.07, win);
  fMetal = mix(0.0, 0.5, win);
  float lit = step(0.56, hash12(vec2(ci * 3.1 + face, fi * 7.3 + vSeed * 13.0)));
  fEmit = vec3(1.0, 0.8, 0.5) * lit * win * uNight * 1.5;
}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = fMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEmit;');
  };
  return mat;
}
