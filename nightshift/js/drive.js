// 탈것: 자동차(문 열리고 타서 시동, 운전석 시점/뒤에서 보기), 자전거, 배달 스쿠터, 시내버스(정류장에서 타고 내리기)
// 운전: 조이스틱 위=가속, 아래=브레이크·후진, 좌우=핸들. 건물·차와 부딪히고, 사람을 치면 다침.
import * as THREE from 'three';
import { activeAt } from './zones.js';
import { $, toast, ic } from './ui.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), pk = a => a[Math.random() * a.length | 0];
const JACKED = [['야! 내 차! 내 차 내놔!', 'angry'], ['뭐, 뭐 하는 거예요?! 살려 주세요!', 'scared'], ['도둑이야! 차 도둑!', 'angry']];

// 자동차 몸체에서 운전석 문(왼쪽 앞) 조각을 잘라 경첩에 달기 → 문이 실제로 열림
function splitDoor(car) {
  if (car.userData.door) return car.userData.door;
  const S = car.userData.size, W = S.x, H = S.y, L = S.z;
  const R = { x0: W / 2 - 0.32, y0: H * 0.3, y1: H * 0.8, z0: -L * 0.05, z1: L * 0.2 };
  const hinge = new THREE.Group(); hinge.position.set(W / 2 - 0.05, 0, R.z1); car.add(hinge);
  const inner = car.children[0]; inner.updateMatrix();
  for (const m of [...inner.children]) {
    if (!m.isMesh) continue; const g = m.geometry, pos = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : pos.count, at = i => idx ? idx.getX(i) : i, keep = [], door = [], v = V3();
    const mw = m.matrix.clone().premultiply(inner.matrix);
    for (let t = 0; t < n; t += 3) {
      let cx = 0, cy = 0, cz = 0; for (let k = 0; k < 3; k++) { v.fromBufferAttribute(pos, at(t + k)).applyMatrix4(mw); cx += v.x; cy += v.y; cz += v.z; }
      cx /= 3; cy /= 3; cz /= 3;
      (cx > R.x0 && cy > R.y0 && cy < R.y1 && cz > R.z0 && cz < R.z1 ? door : keep).push(at(t), at(t + 1), at(t + 2));
    }
    if (!door.length) continue;
    const gb = g.clone(); gb.setIndex(keep); m.geometry = gb;
    const gd = g.clone(); gd.setIndex(door); const dm = new THREE.Mesh(gd, m.material); dm.matrixAutoUpdate = false;
    dm.matrix.copy(mw).premultiply(new THREE.Matrix4().makeTranslation(-hinge.position.x, -hinge.position.y, -hinge.position.z)); hinge.add(dm);
  }
  car.userData.door = hinge; return hinge;
}
// 자전거 (프레임·바퀴살·핸들·안장·페달)
function makeBike(color = 0x1e5aa8) {
  const g = new THREE.Group(), fm = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.35 }), blk = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }), chr = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.25 });
  const tube = (a, b, r = 0.018, m = fm) => { const d = b.clone().sub(a), c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), m); c.position.copy(a).add(b).multiplyScalar(0.5); c.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); g.add(c); return c; };
  const rear = V3(0, 0.34, -0.52), front = V3(0, 0.34, 0.52), bb = V3(0, 0.3, -0.05), seat = V3(0, 0.82, -0.22), head = V3(0, 0.86, 0.38);
  tube(rear, bb); tube(bb, seat); tube(seat, rear, 0.014); tube(bb, head, 0.022); tube(seat.clone().add(V3(0, -0.05, 0.03)), head, 0.02); tube(head, front, 0.016, chr);
  const wheels = [];
  for (const c of [rear, front]) {
    const w = new THREE.Group(); w.position.copy(c); g.add(w); wheels.push(w);
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.022, 8, 32), blk); tire.rotation.y = Math.PI / 2; w.add(tire);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.305, 0.008, 6, 32), chr); rim.rotation.y = Math.PI / 2; w.add(rim);
    for (let i = 0; i < 16; i++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.3, 4), chr); s.rotation.x = i / 16 * Math.PI * 2; s.position.set(0, Math.cos(s.rotation.x) * 0.15, -Math.sin(s.rotation.x) * 0.15); w.add(s); }
  }
  const bar = new THREE.Group(); bar.position.copy(head).add(V3(0, 0.12, 0)); g.add(bar);
  const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.56, 10), chr); hb.rotation.z = Math.PI / 2; bar.add(hb);
  for (const s of [-1, 1]) { const gr = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.11, 10), blk); gr.rotation.z = Math.PI / 2; gr.position.x = s * 0.25; bar.add(gr); }
  tube(head, head.clone().add(V3(0, 0.12, 0)), 0.014, chr);
  const sd = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.24), blk); sd.position.copy(seat).add(V3(0, 0.04, -0.02)); g.add(sd);
  const crank = new THREE.Group(); crank.position.copy(bb); g.add(crank);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.008, 6, 24), chr); ring.rotation.y = Math.PI / 2; ring.position.x = 0.04; crank.add(ring);
  for (const s of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.17, 0.025), chr); arm.position.set(s * 0.07, s * 0.08, 0); crank.add(arm); const pd = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.06), blk); pd.position.set(s * 0.11, s * 0.16, 0); crank.add(pd); }
  g.userData = { wheels, crank, bar, size: V3(0.6, 1.1, 1.75), grips: [V3(0.25, 0.98, 0.38), V3(-0.25, 0.98, 0.38)] };
  return g;
}

const r0pitch = k => (k === 'car' ? -0.1 : k === 'bus' ? -0.05 : -0.18);
export class Driving {
  constructor(app) {
    Object.assign(this, app); this.ride = null; this.lookOff = 0; this.tps = false; this.t = 0;
    this.bikes = [];
    for (const [x, z, r, c] of [[-7.2, 5.2, 0.4, 0x1e5aa8], [-8.2, 5.3, 0.35, 0x2f7d32], [48, 17.5, 1.2, 0xb02020], [60, 5.3, -0.3, 0x333333]]) { const b = makeBike(c); b.position.set(x, 0, z); b.rotation.y = r; this.scene.add(b); this.bikes.push(b); }
    this.scooter = this.vehicles.scooter; this.taxiParked = null;
    // 버튼: 타기/내리기(바코드 버튼 자리 재사용), 시점, 경적
    this.btnView = $('bView'); this.btnHorn = $('bHorn'); this.speedEl = $('speedo');
    this.btnView?.addEventListener('click', () => { this.tps = !this.tps; });
    this.btnHorn?.addEventListener('pointerdown', () => this.horn());
  }
  // 가까이 있는 탈것 (타기 버튼에 표시)
  near() {
    if (this.ride) return null;
    const me = this.yawObj.position; if (me.y - 1.55 < -1 || me.y - 1.55 > 2) return null;
    let best = null, bd = 2.4;
    const consider = (obj, kind, ref, pt) => { const d = Math.hypot(pt.x - me.x, pt.z - me.z); if (d < bd) { bd = d; best = { obj, kind, ref }; } };
    for (const v of this.traffic.list) {
      if (!v.mesh.visible) continue;
      if (v.kind === 'bus') { if (v.mesh.userData.doorK > 0.5) consider(v.mesh, 'bus', v, v.mesh.localToWorld(V3(-1.6, 0, 4.4))); continue; }
      const S = v.mesh.userData.size; consider(v.mesh, 'car', v, v.mesh.localToWorld(V3(S.x / 2 + 0.5, 0, S.z * 0.1)));
    }
    for (const b of this.bikes) consider(b, 'bike', null, b.position);
    if (this.scooter) consider(this.scooter, 'scooter', null, this.scooter.position);
    return best;
  }
  label(n) { return { car: '차 타기', bike: '자전거 타기', scooter: '스쿠터 타기', bus: '버스 타기' }[n.kind]; }
  async enter(n) {
    const { obj, kind, ref } = n; this.mover.enabled = false; this.mover.riding = true; this.hands.rest('R'); this.hands.rest('L');
    this.crime.setWeapon?.('fist');
    const S0 = obj.userData.size || V3(0.6, 1, 1.7);
    this.ride = { obj, kind, ref, v: 0, steer: 0, ry: obj.rotation.y, lean: 0, eye: kind === 'car' ? V3(S0.x * 0.2, S0.y * 0.72, -S0.z * 0.06) : kind === 'bus' ? V3(0.75, 1.65, -1.2) : kind === 'bike' ? V3(0, 1.72, -0.28) : V3(0, 1.6, -0.25), entering: kind === 'car' };
    if (kind === 'car') {
      if (ref && !ref.taken) {
        ref.taken = true; ref.cur = 0;
        if (!ref.parked) { // 운전자 끌어내기 (차량 탈취)
          const drv = this.spawnDriver?.(obj); if (drv) { this.game.say(drv, pk(JACKED)); this.crime.wanted?.add(1, '차량 탈취'); }
        }
      }
      const door = splitDoor(obj); this.audio.play('door', { pos: obj.position, vol: 0.9, rate: 1.25 });
      await this.anim(t => (door.rotation.y = -t * 1.15), 450);
      this.ride.eye = V3(obj.userData.size.x * 0.2, obj.userData.size.y * 0.72, -obj.userData.size.z * 0.06);
      this.place(); await this.anim(t => (door.rotation.y = -1.15 * (1 - t)), 400);
      this.audio.play('door', { pos: obj.position, vol: 1, rate: 0.9 }); this.audio.play('key', { vol: 0.8, rate: 0.7, delay: 0.5 });
      this.ride.snd = ref?.snd || this.audio.play('engine', { pos: obj.position, loop: true, vol: 1.2, rate: 0.5, delay: 0.9 }); this.ride.entering = false;
      toast(ic('check') + '시동을 걸었어요. 조이스틱 위 = 가속, 아래 = 브레이크·후진', 'good', 2600);
    } else if (kind === 'bus') {
      ref.hold = true; this.audio.beep?.(obj.position, true); this.ride.eye = V3(0.75, 1.65, -1.2); this.ride.bus = true; this.busInterior(obj, true);
      this.game.say?.({ type: { name: '버스 기사', id: 'driver' }, person: { talk: 0, gesture() { }, smile: 0 }, voice: [0.95, 1.05], gender: 'm', vIdx: 4 }, ['어서 오세요. 카드 찍고 안쪽으로 들어가세요.', 'calm']);
      setTimeout(() => { ref.hold = false; }, 1500);
    } else {
      this.ride.eye = kind === 'bike' ? V3(0, 1.72, -0.28) : V3(0, 1.6, -0.25);
      if (kind === 'scooter') { this.audio.play('key', { vol: 0.8, rate: 0.8 }); this.ride.snd = this.audio.play('engine', { pos: obj.position, loop: true, vol: 0.9, rate: 0.9, delay: 0.3 }); }
    }
    this.look.pitch = r0pitch(kind); this.lookOff = 0; this.lastYaw = undefined; this.place(); document.body.classList.add('riding'); document.body.classList.toggle('in-car', kind === 'car'); this.hud();
  }
  exit() {
    const r = this.ride; if (!r) return;
    if (r.kind !== 'bus' && Math.abs(r.v) > 2.5) { toast('속도를 줄여야 내릴 수 있어요', 'bad', 1500); return; }
    if (r.kind === 'bus' && !(r.ref.stopT > 0)) { toast('정류장에서 내릴 수 있어요', 'bad', 1500); return; }
    const o = r.obj, S = o.userData.size || V3(0.6, 1, 1.7);
    let out = r.kind === 'car' ? V3(S.x / 2 + 0.75, 0, S.z * 0.1) : r.kind === 'bus' ? V3(-1.9, 0, 4.4) : V3(0.8, 0, 0);
    out = o.localToWorld(out); out.y = 1.55;
    if (r.kind === 'car') { const door = splitDoor(o); this.audio.play('door', { pos: o.position, vol: 0.9, rate: 1.25 }); this.anim(t => (door.rotation.y = -Math.sin(t * Math.PI) * 1.1), 900).then(() => this.audio.play('door', { pos: o.position, vol: 1, rate: 0.9 })); if (r.ref) { r.ref.parked = true; r.ref.cur = 0; } if (r.snd && !r.ref?.snd) r.snd.stop?.(); }
    if (r.kind === 'scooter' && r.snd) r.snd.stop?.();
    if (r.kind === 'bus') this.busInterior(o, false);
    this.yawObj.position.copy(out); this.look.yaw = (r.obj.rotation.y + Math.PI); this.look.pitch = 0;
    this.ride = null; this.mover.enabled = true; this.mover.riding = false; this.hands.rest('R'); this.hands.rest('L'); this.hands.enabled = true;
    document.body.classList.remove('riding', 'in-car'); this.camera.position.set(0, 0, 0);
  }
  anim(f, ms) { return new Promise(res => { const t0 = performance.now(); const step = () => { const t = Math.min(1, (performance.now() - t0) / ms); f(t); if (t < 1) requestAnimationFrame(step); else res(); }; step(); }); }
  horn() { const r = this.ride; if (!r || r.kind === 'bus' || r.kind === 'bike') { if (r?.kind === 'bike') this.audio.play('key', { vol: 0.8, rate: 3 }); return; } this.audio.play('horn', { pos: r.obj.position, vol: 1.4 }); this.honked?.(r.obj.position); }
  // 운전석/안장 시점에 카메라 놓기 (+ 3인칭)
  place() {
    const r = this.ride, o = r.obj; o.updateMatrixWorld(true);
    if (this.tps && r.kind !== 'bus') {
      const back = V3(Math.sin(o.rotation.y), 0, Math.cos(o.rotation.y)), d = r.kind === 'car' ? 6.5 : 3.6;
      this.yawObj.position.copy(o.position).addScaledVector(back, -d).add(V3(0, r.kind === 'car' ? 2.6 : 1.9, 0));
    } else this.yawObj.position.copy(o.localToWorld(r.eye.clone()));
  }
  hud() { const r = this.ride; $('bScan').querySelector('b').textContent = r ? (r.kind === 'bus' ? '버스 내리기' : '내리기') : '바코드 찍기'; }
  update(dt) {
    const r = this.ride; this.t += dt;
    if (!r || r.entering) return;
    const o = r.obj, k = this.mover.keys, vec = this.mover.vec;
    if (r.kind === 'bus') { // 승객: 버스가 가는 대로
      this.place(); this.look.yaw += 0; if (this.speedEl) this.speedEl.textContent = r.ref.stopT > 0 ? '정류장 · 내리기 가능' : `${r.ref.num || ''}번 버스`; return;
    }
    let thr = -vec.y, st = -vec.x; if (k.KeyW || k.ArrowUp) thr = 1; if (k.KeyS || k.ArrowDown) thr = -1; if (k.KeyA || k.ArrowLeft) st = 1; if (k.KeyD || k.ArrowRight) st = -1;
    const spec = { car: { acc: 6, max: 24, rev: 6, wb: 2.6, steer: 0.55, brake: 11 }, scooter: { acc: 4.5, max: 14, rev: 0, wb: 1.3, steer: 0.6, brake: 9 }, bike: { acc: 2.4, max: 7.5, rev: 0, wb: 1.05, steer: 0.65, brake: 7 } }[r.kind];
    if (thr > 0.15) r.v += (r.v < 0 ? spec.brake : spec.acc) * thr * dt; else if (thr < -0.15) r.v -= (r.v > 0.3 ? spec.brake : spec.acc * 0.6) * -thr * dt; else r.v -= Math.sign(r.v) * Math.min(Math.abs(r.v), (0.8 + Math.abs(r.v) * 0.05) * dt);
    r.v = Math.max(-spec.rev, Math.min(spec.max, r.v));
    r.steer += (st * spec.steer * (1 - Math.min(0.5, Math.abs(r.v) / 50)) - r.steer) * Math.min(1, dt * 5);
    o.rotation.y += r.v / spec.wb * Math.tan(r.steer) * dt;
    const fwd = V3(Math.sin(o.rotation.y), 0, Math.cos(o.rotation.y)), prev = o.position.clone();
    o.position.addScaledVector(fwd, r.v * dt);
    // 부딪힘: 건물·벽 (차는 앞·가운데·뒤 원 3개)
    const S = o.userData.size || V3(0.6, 1, 1.7), rad = r.kind === 'car' ? S.x / 2 + 0.05 : 0.35, offs = r.kind === 'car' ? [-S.z / 2 + rad, 0, S.z / 2 - rad] : [0];
    let crash = 0;
    for (const off of offs) {
      const c = o.position.clone().addScaledVector(fwd, off);
      for (const q of this.colliders) {
        if (c.x < q.x0 - rad || c.x > q.x1 + rad || c.z < q.z0 - rad || c.z > q.z1 + rad || !activeAt(q, 0)) continue;
        const qx = Math.max(q.x0, Math.min(c.x, q.x1)), qz = Math.max(q.z0, Math.min(c.z, q.z1)), dx = c.x - qx, dz = c.z - qz, d = Math.hypot(dx, dz);
        if (d < rad) { const n = d > 1e-4 ? V3(dx / d, 0, dz / d) : fwd.clone().negate(); o.position.addScaledVector(n, rad - d + 0.01); crash = Math.max(crash, Math.abs(r.v)); }
      }
      for (const w of this.traffic.list) { if (w.mesh === o || !w.mesh.visible) continue; const d = w.mesh.position.distanceTo(c); const rr = rad + (w.kind === 'bus' ? 1.6 : 1.1); if (d < rr) { o.position.addScaledVector(c.clone().sub(w.mesh.position).setY(0).normalize(), rr - d); crash = Math.max(crash, Math.abs(r.v)); w.cur = 0; } }
    }
    if (crash > 2) { this.audio.play('thud', { pos: o.position, vol: Math.min(1.8, crash / 8), rate: 0.5 }); this.audio.play('punch', { pos: o.position, vol: Math.min(1.4, crash / 10), rate: 0.6 }); this.shake = Math.min(0.3, crash / 40); r.v *= -0.25; if (crash > 12) this.crime.wanted?.add(0, ''); }
    else if (crash) r.v *= 0.6;
    // 사람 치기
    for (const c of this.crowd.people()) {
      if (c.dead || !c.person?.root.parent) continue; const p = c.person.root.position; if (Math.abs(p.y) > 1) continue;
      const rel = p.clone().sub(o.position), ahead = rel.dot(fwd), side = Math.abs(rel.x * fwd.z - rel.z * fwd.x);
      if (Math.abs(ahead) < (r.kind === 'car' ? S.z / 2 + 0.35 : 0.9) && side < (r.kind === 'car' ? S.x / 2 + 0.25 : 0.45) && Math.abs(r.v) > 1.5) this.hitPerson?.(c, fwd.clone().multiplyScalar(Math.sign(r.v)), Math.abs(r.v), true);
    }
    // 바퀴·페달·기울기
    if (r.kind === 'bike') { o.userData.wheels.forEach(w => (w.rotation.x += r.v * dt / 0.34)); o.userData.crank.rotation.x += r.v * dt / 0.34 * 0.55; o.userData.bar.rotation.y = r.steer * 0.8; }
    r.lean += ((r.kind === 'car' ? 0 : -r.steer * Math.min(1, Math.abs(r.v) / 5) * 0.5) - r.lean) * Math.min(1, dt * 4); o.rotation.z = r.lean;
    if (r.snd) { r.snd.playbackRate.value = (r.kind === 'car' ? 0.5 : 0.85) + Math.abs(r.v) / (r.kind === 'car' ? 22 : 12) * 0.9; this.audio.movePanner(r.snd, o.position); }
    if (r.kind === 'bike' && Math.abs(r.v) > 0.5 && (this.stepT = (this.stepT || 0) - dt) < 0) { this.stepT = 0.9 / Math.max(1, Math.abs(r.v)); }
    // 카메라: 차 방향 + 자유롭게 둘러보기(손 떼면 천천히 정면으로)
    const base = o.rotation.y + Math.PI;
    if (this.lastYaw !== undefined) this.lookOff += this.look.yaw - this.lastYaw;
    if (Math.abs(r.v) > 3 && !this.look.dragging) this.lookOff *= Math.exp(-dt * 1.2);
    this.look.yaw = base + this.lookOff; this.lastYaw = this.look.yaw; if (this.tps) this.look.pitch += (-0.22 - this.look.pitch) * Math.min(1, dt * 3);
    this.place(); this.camera.position.set((Math.random() - 0.5) * (this.shake || 0), (Math.random() - 0.5) * (this.shake || 0) + (r.kind === 'bike' ? Math.sin(this.t * Math.abs(r.v) * 1.8) * 0.012 : 0), 0); this.shake = (this.shake || 0) * Math.exp(-dt * 6);
    // 손: 핸들/손잡이 쥐기 (1인칭)
    this.hands.enabled = !this.tps && r.kind !== 'car';
    if (!this.tps) {
      if (false && r.kind === 'car') { const wc = V3(S.x * 0.2, S.y * 0.6, S.z * 0.12), a = r.steer * 2.2; for (const [sd, s] of [['L', 1], ['R', -1]]) { const p = o.localToWorld(wc.clone().add(V3(Math.cos(a) * 0.17 * s, Math.sin(a) * 0.17 * s * -1 + 0.02, 0))); this.camera.worldToLocal(p); this.hands.place(sd, p, V3(-0.15 * s, 0.6, -0.8), V3(0, 0.6, 0.8), 'grip'); } }
      else if (r.kind !== 'car') { o.userData.grips?.forEach((gp, i) => { const p = o.localToWorld(gp.clone().add(V3(0, 0, -0.08))); this.camera.worldToLocal(p); this.hands.place(i ? 'L' : 'R', p.add(V3(0, 0, 0.06)), V3(i ? 0.3 : -0.3, -0.2, -1), V3(0, 1, 0.1), 'grip'); }); }
    }
    if (this.speedEl) this.speedEl.textContent = `${Math.round(Math.abs(r.v) * 3.6)} km/h`;
  }
  // 버스 실내 (탄 동안만): 좌석·손잡이 기둥·천장 조명·창틀 — 바깥 상자는 숨김
  busInterior(bus, on) {
    const ud = bus.userData, g = ud.bus; if (!g) return;
    if (!ud.inside) {
      const I = new THREE.Group(), M = o => new THREE.MeshStandardMaterial({ roughness: 0.6, ...o }), seat = M({ color: 0x1f4fa0 }), yel = M({ color: 0xf2c230, metalness: 0.5, roughness: 0.3 }), wall = M({ color: 0xe8e8e4 }), dark = M({ color: 0x2a2d31 });
      const B = (sx, sy, sz, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); b.position.set(x, y, z); I.add(b); return b; };
      B(10.8, 0.05, 2.4, M({ color: 0x55585c }), 0, 0.4, 0); B(10.8, 0.05, 2.4, wall, 0, 3.35, 0);
      for (const z of [-1.22, 1.22]) { B(10.8, 1.0, 0.04, wall, 0, 0.9, z); for (let x = -5; x <= 5; x += 1.1) B(0.12, 1.9, 0.05, dark, x, 2.35, z); }
      B(0.05, 3, 2.4, dark, -5.4, 1.9, 0);
      for (let x = -4.6; x < 3.8; x += 0.85) for (const z of [-0.75, 0.7]) { if (x > -0.5 && x < 1.2 && z > 0) continue; B(0.45, 0.1, 0.45, seat, x, 0.85, z); B(0.08, 0.55, 0.45, seat, x - 0.22, 1.15, z); }
      for (let x = -4; x < 5; x += 1.6) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.9, 8), yel); p.position.set(x, 1.9, 0.25); I.add(p); }
      for (let x = -4.5; x < 5; x += 1.5) B(0.9, 0.02, 0.18, new THREE.MeshBasicMaterial({ color: 0xf4f8ff }), x, 3.32, 0);
      B(0.5, 1.2, 0.6, dark, 5.0, 1.0, -0.8); const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 8, 24), dark); wheel.position.set(4.8, 1.55, -0.8); wheel.rotation.y = Math.PI / 2 - 0.4; I.add(wheel);
      const drv = this.makeDriver?.(); if (drv) { drv.position.set(5.0, 0.4, -0.8); drv.rotation.y = Math.PI / 2; I.add(drv); }
      const L = new THREE.PointLight(0xf4f8ff, 6, 9, 1.5); L.position.set(0, 3, 0); I.add(L);
      ud.inside = I; I.visible = false; g.add(I);
    }
    ud.inside.visible = on; for (const c of g.children) if (c.isMesh && c.geometry.type === 'BoxGeometry' && c.geometry.parameters.width > 10) c.visible = !on;
  }
}
