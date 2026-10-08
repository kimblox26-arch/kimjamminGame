// 표류물 물리: 자동차 · 컨테이너 · 선박 · 건물 잔해
//  부력(잠긴 부피) · 유체 항력(상대 유속²) · 지면 마찰 · 건물 충돌(충격 → 건물 손상) · 상호 충돌
import * as THREE from 'three';
import { G } from './config.js';
import { carGeometry, boatGeometry, merge, box } from './geom.js';

const RHO = 1025;

export class Bodies {
  constructor(scene, terrain, city, sim) {
    this.t = terrain; this.city = city; this.sim = sim;
    this.list = [];
    this.kinds = {};
    const add = (key, geo, mat, max) => {
      const m = new THREE.InstancedMesh(geo, mat, max);
      m.castShadow = m.receiveShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
      this.kinds[key] = { mesh: m, n: 0, max };
    };
    const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.35 });
    add('car', carGeometry(), vc, city.cars.length + 4);
    add('container', new THREE.BoxGeometry(12.2, 2.6, 2.44).translate(0, 1.3, 0), new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3 }), city.containers.length + 4);
    add('boat', boatGeometry(0xffffff), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), city.boats.length + 4);
    add('debris', new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }), 700);
    this.tmp = {};
    this.col = new THREE.Color();
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3();
    this.spawnInitial();
  }

  spawnInitial() {
    for (const k of Object.values(this.kinds)) { k.n = 0; k.mesh.count = 0; }
    this.list = [];
    for (const c of this.city.cars) this.add('car', c.x, this.t.groundAt(c.x, c.z), c.z, c.yaw, { L: 4.4, W: 1.8, H: 1.5, mass: 1400, color: c.color });
    let last = null;
    for (const c of this.city.containers) {
      const b = this.add('container', c.x, c.y, c.z, c.yaw, { L: 12.2, W: 2.44, H: 2.6, mass: 3800, color: c.color });
      if (b && last && last.x === c.x && last.z === c.z) b.below = last;
      last = b;
    }
    for (const b of this.city.boats) {
      const L = b.len;
      this.add('boat', b.x, 0, b.z, b.yaw, { L, W: L * 0.32, H: L * 0.11, mass: L * L * L * 9, color: b.color, scale: L, floatBoat: true, ship: b.ship });
    }
  }

  add(kind, x, y, z, yaw, o) {
    const K = this.kinds[kind];
    if (K.n >= K.max) return null;
    const b = {
      kind, idx: K.n++, x, y, z, yaw, vx: 0, vy: 0, vz: 0, wy: 0, roll: 0, pitch: 0, rv: 0, pv: 0,
      L: o.L, W: o.W, H: o.H, mass: o.mass, scale: o.scale || 1, floating: !!o.floatBoat, moved: false,
      r: Math.max(o.L, o.W) * 0.5, color: o.color, ship: o.ship, life: o.life || 0, sleep: !o.floatBoat,
    };
    // 부력 한계 수심: 질량 = ρ·L·W·흘수  (보트는 선체 높이 일부)
    b.draft = Math.min(b.H * 0.92, b.mass / (RHO * b.L * b.W));
    if (kind === 'car') b.draft = 0.55;            // 자동차는 실내 공기로 약 0.5~0.6 m 수심에서 뜸
    if (kind === 'container') b.draft = 0.9;
    K.mesh.count = K.n;
    if (o.color !== undefined) K.mesh.setColorAt(b.idx, this.col.set(o.color));
    if (K.mesh.instanceColor) K.mesh.instanceColor.needsUpdate = true;
    this.list.push(b);
    this.writeMatrix(b);
    return b;
  }

  spawnDebris(bld, count) {
    const cols = [0x8a6a4a, 0x6a5a4a, 0xb8a888, 0x9a9a96, 0x5a4a3a, 0xc8b8a0];
    for (let i = 0; i < count; i++) {
      const x = bld.x + (Math.random() - 0.5) * bld.w, z = bld.z + (Math.random() - 0.5) * bld.d;
      const L = 1.5 + Math.random() * 4, W = 0.3 + Math.random() * 1.6, H = 0.15 + Math.random() * 0.5;
      const b = this.add('debris', x, bld.base + Math.random() * Math.min(bld.h, 8), z, Math.random() * 6.28,
        { L, W, H, mass: L * W * H * 450, color: cols[i % cols.length], life: 1 });
      if (b) { b.sleep = false; b.vy = 2 + Math.random() * 3; b.vx = (Math.random() - 0.5) * 3; b.vz = (Math.random() - 0.5) * 3; }
    }
  }

  update(dt, impact) {
    const sim = this.sim, t = this.t, city = this.city, s = this.tmp;
    const sub = dt > 0.05 ? Math.ceil(dt / 0.05) : 1;
    const h = dt / sub;
    for (const b of this.list) {
      if (b.sleep) {
        // 침수 확인 후 깨움
        sim.sample(b.x, b.z, s);
        if (s.eta - b.y > b.draft * 0.6 || Math.hypot(s.u, s.v) * Math.max(0, s.eta - b.y) > 1.5 || (b.below && !b.below.sleep)) b.sleep = false;
        else continue;
      }
      for (let n = 0; n < sub; n++) this.stepBody(b, h, s, sim, t, city, impact);
      this.writeMatrix(b);
    }
    // 간단한 상호 충돌 (근접 쌍만)
    this.resolvePairs();
    for (const k of Object.values(this.kinds)) {
      k.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  stepBody(b, dt, s, sim, t, city, impact) {
    sim.sample(b.x, b.z, s);
    let ground = t.groundAt(b.x, b.z);
    const bl = b.below;
    if (bl && Math.abs(bl.x - b.x) < 3 && Math.abs(bl.z - b.z) < 3) ground = Math.max(ground, bl.y + bl.H);
    const surf = s.eta;
    const depthAtBody = surf - b.y;                     // 바닥면 기준 잠김 깊이
    const sub = Math.max(0, Math.min(b.H, depthAtBody));
    const subFrac = sub / b.H;
    // 부력: 잠긴 부피 · 중력
    const buoy = G * Math.min(sub, b.draft * 1.6) / b.draft;
    let ay = -G + buoy;
    // 유체 항력 (수평): ½ρCdA|Δv|Δv / m
    const ru = s.u - b.vx, rv = s.v - b.vz;
    const rs = Math.hypot(ru, rv);
    const A = (b.L + b.W) * 0.5 * Math.max(sub, 0.02);
    const kd = 0.5 * RHO * 1.1 * A * rs / b.mass;
    let ax = ru * kd, az = rv * kd;
    ay -= b.vy * (subFrac > 0 ? 2.2 : 0.05);
    b.vx += ax * dt; b.vz += az * dt; b.vy += ay * dt;
    // 바닥 접지
    const onGround = b.y <= ground + 0.02;
    if (onGround) {
      const fr = (1 - Math.min(1, subFrac * 1.3)) * 0.85 * G;  // 쿨롱 마찰 (부력만큼 감소)
      const hs = Math.hypot(b.vx, b.vz);
      if (hs > 1e-4) {
        const dv = Math.min(hs, fr * dt);
        b.vx -= b.vx / hs * dv; b.vz -= b.vz / hs * dv;
      }
    }
    b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
    let g2 = t.groundAt(b.x, b.z);
    if (bl && Math.abs(bl.x - b.x) < 3 && Math.abs(bl.z - b.z) < 3) g2 = Math.max(g2, bl.y + bl.H);
    if (b.y < g2) { b.y = g2; if (b.vy < 0) b.vy = 0; }
    // 건물 충돌
    const pos = { x: b.x, z: b.z };
    const hit = city.collide(pos, b.r * 0.6, b.y + 0.5);
    if (hit) {
      const dxp = pos.x - b.x, dzp = pos.z - b.z;
      const l = Math.hypot(dxp, dzp) || 1;
      const nx = dxp / l, nz = dzp / l;
      const vn = b.vx * nx + b.vz * nz;
      if (vn < 0) {
        const E = 0.5 * b.mass * vn * vn;
        if (E > 2e4 && impact) impact(b, hit, E);
        b.vx -= 1.4 * vn * nx; b.vz -= 1.4 * vn * nz;
      }
      b.x = pos.x; b.z = pos.z;
      b.wy += (Math.random() - 0.5) * 0.6;
    }
    // 회전: 흐름 전단 + 감쇠, 기울기 진동
    b.wy += (rv * Math.cos(b.yaw) - ru * Math.sin(b.yaw)) * 0.02 * subFrac * dt * 10;
    b.wy *= 1 - Math.min(1, dt * (onGround ? 3 : 0.6));
    b.yaw += b.wy * dt;
    const wave = subFrac > 0.05 && subFrac < 0.99 ? 1 : 0;
    b.rv += (-b.roll * 3 + (Math.random() - 0.5) * rs * 0.6 * wave) * dt; b.rv *= 0.97; b.roll += b.rv * dt;
    b.pv += (-b.pitch * 3 + (Math.random() - 0.5) * rs * 0.4 * wave) * dt; b.pv *= 0.97; b.pitch += b.pv * dt;
    b.floating = subFrac > 0.15 && !onGround;
    if (Math.abs(b.vx) + Math.abs(b.vz) > 0.3) b.moved = true;
  }

  resolvePairs() {
    const L = this.list;
    const cell = 16, map = new Map();
    for (const b of L) {
      if (b.sleep) continue;
      const key = ((b.x / cell) | 0) * 7919 + ((b.z / cell) | 0);
      let a = map.get(key); if (!a) map.set(key, a = []);
      a.push(b);
    }
    for (const b of L) {
      if (b.sleep) continue;
      const cx = (b.x / cell) | 0, cz = (b.z / cell) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const a = map.get((cx + dx) * 7919 + cz + dz);
        if (!a) continue;
        for (const o of a) {
          if (o === b || o.x < b.x) continue;
          const rr = (b.r + o.r) * 0.55;
          const ddx = o.x - b.x, ddz = o.z - b.z, d2 = ddx * ddx + ddz * ddz;
          if (d2 >= rr * rr || d2 < 1e-6) continue;
          if (Math.abs(o.y - b.y) > Math.max(o.H, b.H)) continue;
          const d = Math.sqrt(d2), pen = rr - d, nx = ddx / d, nz = ddz / d;
          const wb = o.mass / (b.mass + o.mass), wo = 1 - wb;
          b.x -= nx * pen * wb; b.z -= nz * pen * wb; o.x += nx * pen * wo; o.z += nz * pen * wo;
          const rv = (o.vx - b.vx) * nx + (o.vz - b.vz) * nz;
          if (rv < 0) {
            const j = rv * 1.3;
            b.vx += nx * j * wb; b.vz += nz * j * wb; o.vx -= nx * j * wo; o.vz -= nz * j * wo;
          }
        }
      }
    }
  }

  writeMatrix(b) {
    const K = this.kinds[b.kind];
    this.e.set(b.roll * 0.4, b.yaw, b.pitch * 0.4, 'YXZ');
    this.q.setFromEuler(this.e);
    let sx = 1, sy = 1, sz = 1, y = b.y;
    if (b.kind === 'boat') { sx = sy = sz = b.scale; y = b.y + b.draft * 0.0; }
    if (b.kind === 'debris') { sx = b.L; sy = b.H; sz = b.W; y = b.y + b.H / 2; }
    if (b.kind === 'boat') y = b.y + b.scale * 0.04;
    this.m.compose(this.p.set(b.x, y, b.z), this.q, this.s.set(sx, sy, sz));
    K.mesh.setMatrixAt(b.idx, this.m);
  }

  reset() {
    this.spawnInitial();
    for (const k of Object.values(this.kinds)) k.mesh.instanceMatrix.needsUpdate = true;
  }

  /** 소리·인지용: 주변 움직이는 표류물 수 */
  movingNear(x, z, r) {
    let n = 0;
    for (const b of this.list) if (!b.sleep && Math.abs(b.x - x) < r && Math.abs(b.z - z) < r && Math.hypot(b.vx, b.vz) > 1) n++;
    return n;
  }
}
