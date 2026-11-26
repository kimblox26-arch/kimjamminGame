// 자동차: 절차적 모델 + 아케이드 주행
import * as THREE from 'three';
import { MB, clamp, damp } from './util.js';
import { terrainH } from './korea.js';

const GLASS = [0.06, 0.08, 0.1], TIRE = [0.05, 0.05, 0.05], TRIM = [0.12, 0.12, 0.13], HEAD = [1, 0.97, 0.85], TAIL = [0.7, 0.04, 0.03], PLATE = [0.9, 0.9, 0.85];
// 반환: {body, detail} (body 는 흰색 → 도색은 재질/인스턴스색)
export function carGeo(wheels = true, kind = 0) {
  const b = new MB(), d = new MB();
  const L = kind === 1 ? 2.45 : 2.3, W = kind === 1 ? 0.95 : 0.9, H1 = kind === 1 ? 1.0 : 0.85, H2 = kind === 1 ? 1.85 : 1.42;
  b.box(-W, 0.32, -L, W, H1, L, { su: 1 });
  // 캐빈(사다리꼴)
  const zb0 = kind === 1 ? -L + 0.3 : -1.35, zb1 = kind === 1 ? 1.4 : 1.2, zt0 = kind === 1 ? -L + 0.4 : -0.95, zt1 = kind === 1 ? 1.0 : 0.6, w2 = W - 0.12;
  const q = (a, bb, c, dd, n) => b.quad(a, bb, c, dd, n);
  q([-w2, H1, zb1], [w2, H1, zb1], [w2, H2, zt1], [-w2, H2, zt1], [0, 0.6, 0.8]);
  q([w2, H1, zb0], [-w2, H1, zb0], [-w2, H2, zt0], [w2, H2, zt0], [0, 0.6, -0.8]);
  q([-w2, H2, zt1], [w2, H2, zt1], [w2, H2, zt0], [-w2, H2, zt0], [0, 1, 0]);
  q([w2, H1, zb1], [w2, H1, zb0], [w2, H2, zt0], [w2, H2, zt1], [1, 0, 0]);
  q([-w2, H1, zb0], [-w2, H1, zb1], [-w2, H2, zt1], [-w2, H2, zt0], [-1, 0, 0]);
  // 유리(캐빈보다 살짝 바깥)
  const e = 0.012, gy0 = H1 + 0.06, gy1 = H2 - 0.05, lz = (y) => zb1 + (zt1 - zb1) * (y - H1) / (H2 - H1), lz0 = (y) => zb0 + (zt0 - zb0) * (y - H1) / (H2 - H1);
  d.quad([-w2 + 0.08, gy0, lz(gy0) + e], [w2 - 0.08, gy0, lz(gy0) + e], [w2 - 0.08, gy1, lz(gy1) + e], [-w2 + 0.08, gy1, lz(gy1) + e], [0, 0.6, 0.8], undefined, GLASS);
  d.quad([w2 - 0.08, gy0, lz0(gy0) - e], [-w2 + 0.08, gy0, lz0(gy0) - e], [-w2 + 0.08, gy1, lz0(gy1) - e], [w2 - 0.08, gy1, lz0(gy1) - e], [0, 0.6, -0.8], undefined, GLASS);
  for (const s of [1, -1]) {
    const x = s * (w2 + e), a0 = lz0(gy1) + 0.1, a1 = lz(gy1) - 0.1, b0 = zb0 + 0.15, b1 = zb1 - 0.15;
    if (s > 0) d.quad([x, gy0, b1], [x, gy0, b0], [x, gy1, a0], [x, gy1, a1], [1, 0, 0], undefined, GLASS);
    else d.quad([x, gy0, b0], [x, gy0, b1], [x, gy1, a1], [x, gy1, a0], [-1, 0, 0], undefined, GLASS);
  }
  // 범퍼·라이트·번호판
  d.box(-W - 0.02, 0.3, L - 0.05, W + 0.02, 0.5, L + 0.08, { col: TRIM }); d.box(-W - 0.02, 0.3, -L - 0.08, W + 0.02, 0.5, -L + 0.05, { col: TRIM });
  for (const s of [1, -1]) { d.box(s * W * 0.62 - 0.18, H1 - 0.2, L - 0.01, s * W * 0.62 + 0.18, H1 - 0.06, L + 0.02, { col: HEAD }); d.box(s * W * 0.68 - 0.16, H1 - 0.22, -L - 0.02, s * W * 0.68 + 0.16, H1 - 0.08, -L + 0.01, { col: TAIL }); }
  d.box(-0.26, 0.52, L + 0.06, 0.26, 0.64, L + 0.09, { col: PLATE }); d.box(-0.26, 0.55, -L - 0.09, 0.26, 0.67, -L - 0.06, { col: PLATE });
  d.box(-W + 0.05, 0.05, -L + 0.2, W - 0.05, 0.32, L - 0.2, { col: TRIM, faces: 63 }); // 하부
  if (wheels) for (const [x, z] of wheelPos(kind)) wheelInto(d, x, z);
  return { body: b.build(), detail: d.build() };
}
export function wheelPos(kind = 0) { const L = kind === 1 ? 1.6 : 1.45; return [[0.8, L], [-0.8, L], [0.8, -L], [-0.8, -L]]; }
function wheelInto(d, x, z) {
  const g = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 14); g.rotateZ(Math.PI / 2); g.translate(x, 0.34, z); d.geo(g, TIRE);
  const h = new THREE.CylinderGeometry(0.2, 0.2, 0.235, 10); h.rotateZ(Math.PI / 2); h.translate(x, 0.34, z); d.geo(h, [0.55, 0.56, 0.58]);
}
export const CAR_COLORS = [0xf2f2f2, 0x1a1a1a, 0x8a8f96, 0xc9ccd1, 0x23324a, 0x6b1c1c, 0x2f4a3a, 0xbfa77a, 0xe8e8e8, 0x3a3d42];

let shared = null;
export function carMaterials() {
  if (shared) return shared;
  shared = {
    paint: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }),
    detail: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.25 })
  };
  return shared;
}

let VID = 0;
export class Vehicle {
  constructor(game, x, z, yaw, color, owner) {
    this.game = game; this.id = 'veh' + (VID++); this.owner = owner;
    const G = carGeo(false), M = carMaterials();
    this.group = new THREE.Group();
    const paint = M.paint.clone(); paint.color.set(color);
    const body = new THREE.Mesh(G.body, paint), det = new THREE.Mesh(G.detail, M.detail);
    body.castShadow = det.castShadow = true; body.receiveShadow = true;
    this.group.add(body, det); this.wheels = [];
    const wg = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 16); wg.rotateZ(Math.PI / 2);
    const wm = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    for (const [wx, wz] of wheelPos()) { const w = new THREE.Mesh(wg, wm); w.position.set(wx, 0.34, wz); w.castShadow = true; this.group.add(w); this.wheels.push(w); }
    this.pos = new THREE.Vector3(x, terrainH(x, z), z); this.yaw = yaw; this.speed = 0; this.steer = 0; this.hp = 100; this.spin = 0;
    this.pitch = 0; this.roll = 0; this.driving = false;
    game.scene.add(this.group); this.placeBox(); this.sync();
    this.inter = game.inter.add({ pos: this.pos.clone().setY(this.pos.y + 1), r: 3, label: '차량 탑승', hold: 0.4, owner, cond: () => !game.player.vehicle && this.hp > 0, act: () => game.player.enterVehicle(this) });
  }
  placeBox() {
    const c = Math.abs(Math.cos(this.yaw)), s = Math.abs(Math.sin(this.yaw)), hx = 0.9 * c + 2.3 * s, hz = 0.9 * s + 2.3 * c;
    this.game.col.removeOwner(this.id);
    this.box = this.game.col.box(this.pos.x - hx * 0.9, this.pos.y + 0.2, this.pos.z - hz * 0.9, this.pos.x + hx * 0.9, this.pos.y + 1.45, this.pos.z + hz * 0.9, this.id, { veh: this });
    if (this.inter) this.inter.pos.set(this.pos.x, this.pos.y + 1, this.pos.z);
  }
  sync() { this.group.position.copy(this.pos); this.group.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ'); }
  forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  update(dt, inp) {
    const g = this.game;
    if (this.driving) {
      const thr = (inp.f ? 1 : 0) - (inp.b ? 1 : 0), st = (inp.l ? 1 : 0) - (inp.r ? 1 : 0);
      const maxV = this.hp > 30 ? 34 : 12;
      if (thr > 0) this.speed += (this.speed < 0 ? 18 : 7.5 * (1 - this.speed / maxV)) * dt;
      else if (thr < 0) this.speed -= (this.speed > 0 ? 16 : 4) * dt;
      if (inp.brake) this.speed = damp(this.speed, 0, 4, dt);
      this.speed -= this.speed * (0.06 + (thr === 0 ? 0.25 : 0)) * dt;
      this.speed = clamp(this.speed, -8, maxV);
      this.steer = damp(this.steer, st * 0.55 / (1 + Math.abs(this.speed) * 0.04), 6, dt);
    } else { this.speed = damp(this.speed, 0, 2, dt); this.steer = damp(this.steer, 0, 3, dt); }
    if (Math.abs(this.speed) < 0.02 && !this.driving) return;
    const yr = this.speed / 2.7 * Math.tan(this.steer);
    this.yaw += yr * dt;
    const f = this.forward(), np = this.pos.clone().addScaledVector(f, this.speed * dt);
    // 충돌: 앞/뒤 원 두 개
    let hit = false;
    for (const s of [1.5, -1.5]) {
      const cx = np.x + f.x * s, cz = np.z + f.z * s, r = 1.0;
      for (const b of g.col.query(cx - 2, cz - 2, cx + 2, cz + 2)) {
        if (b.veh === this || b.y1 < np.y + 0.6 || b.y0 > np.y + 1.5) continue;
        const qx = clamp(cx, b.x0, b.x1), qz = clamp(cz, b.z0, b.z1), dx = cx - qx, dz = cz - qz;
        if (dx * dx + dz * dz < r * r) { hit = true; break; }
      }
      if (hit) break;
    }
    if (hit) {
      const imp = Math.abs(this.speed);
      if (imp > 3) { g.audio.play('crash', { pos: this.pos, vol: Math.min(1, imp / 15) }); this.hp -= imp * 1.2; g.player.shake(Math.min(1, imp / 10)); g.zombies.noise(this.pos, 40 + imp * 3); if (imp > 10) g.player.damage(imp * 0.8, 'crash'); }
      this.speed *= -0.25;
    } else this.pos.copy(np);
    // 지면 & 자세
    const hF = terrainH(this.pos.x + f.x * 1.4, this.pos.z + f.z * 1.4), hB = terrainH(this.pos.x - f.x * 1.4, this.pos.z - f.z * 1.4);
    const rx = f.z, rz = -f.x, hR = terrainH(this.pos.x + rx * 0.8, this.pos.z + rz * 0.8), hL = terrainH(this.pos.x - rx * 0.8, this.pos.z - rz * 0.8);
    const gy = Math.max(g.col.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.3, 0.6, 0.6), (hF + hB) / 2);
    this.pos.y = damp(this.pos.y, gy, 18, dt);
    if (this.pos.y < -0.6) { this.speed *= 0.9; if (this.hp > 0 && this.driving) { this.hp = 0; g.ui.notify('엔진이 물에 잠겼다'); } }
    this.pitch = damp(this.pitch, Math.atan2(hB - hF, 2.8), 10, dt); this.roll = damp(this.roll, Math.atan2(hR - hL, 1.6), 10, dt);
    this.spin += this.speed * dt / 0.34;
    this.wheels.forEach((w, i) => { w.rotation.set(this.spin, i < 2 ? this.steer : 0, 0, 'YXZ'); });
    this.sync();
    // 좀비 치기
    if (Math.abs(this.speed) > 3.5) g.zombies.runOver(this.pos, f, this.speed, this);
    if (!this.driving && Math.abs(this.speed) < 0.05) this.placeBox();
  }
  dispose() { this.game.scene.remove(this.group); this.game.col.removeOwner(this.id); this.game.inter.remove(this.inter); }
}
