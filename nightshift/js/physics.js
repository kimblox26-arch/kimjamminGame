// 현실 물리엔진 (cannon-es): 중력·마찰·반발·질량이 있는 강체 충돌
//  - 건물·벽·기둥: 내 주변 충돌 상자를 정적 강체로 (가까운 것만 자동으로 넣고 뺌)
//  - 내가 타는 차·자전거: 질량 있는 강체 → 벽·차에 부딪히면 실제로 막히고 튕김
//  - 지나가는 차·사람·나: 움직이는 몸통(키네마틱) → 물건을 밀고 치면 날아감
//  - 크게 들이받힌 차는 운전 AI가 꺼지고 미끄러지며 빙글 돌다 멈춤(사고 차량)
//  - 길가 쓰레기통·라바콘·택배 상자·맥주 상자·가게 앞 플라스틱 의자: 넘어지고 굴러감
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };

export class Physics {
  constructor({ scene, colliders, audio }) {
    Object.assign(this, { scene, colliders, audio });
    const w = this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    w.broadphase = new CANNON.SAPBroadphase(w); w.allowSleep = true; w.solver.iterations = 8;
    w.defaultContactMaterial.friction = 0.45; w.defaultContactMaterial.restitution = 0.15;
    const ground = new CANNON.Body({ mass: 0 }); ground.addShape(new CANNON.Plane()); ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0); w.addBody(ground);
    this.statics = new Map(); this.props = []; this.kins = new Map(); this.wrecks = []; this.t = 0; this.st = 0; this.ride = null;
  }
  // ── 주변 건물·벽을 정적 강체로 ──
  refreshStatics(c0) {
    const R = 60, keep = new Set();
    for (const c of this.colliders) {
      if (c.lv === -1 || (c.y0 !== undefined && c.y0 > 1) || c.noPhys) continue;
      if (c.x1 < c0.x - R || c.x0 > c0.x + R || c.z1 < c0.z - R || c.z0 > c0.z + R) continue;
      keep.add(c);
      if (!this.statics.has(c)) {
        const hx = Math.max(0.05, (c.x1 - c.x0) / 2), hz = Math.max(0.05, (c.z1 - c.z0) / 2), y0 = c.y0 || 0, h = c.y1 !== undefined ? Math.max(0.5, c.y1 - y0) : 5;
        const b = new CANNON.Body({ mass: 0 }); b.addShape(new CANNON.Box(new CANNON.Vec3(hx, h / 2, hz))); b.position.set((c.x0 + c.x1) / 2, y0 + h / 2, (c.z0 + c.z1) / 2); this.world.addBody(b); this.statics.set(c, b);
      }
    }
    for (const [c, b] of this.statics) if (!keep.has(c)) { this.world.removeBody(b); this.statics.delete(c); }
  }
  // ── 물건 (강체) ──
  addProp(mesh, { hx, hy, hz, mass = 5, snd = 'thud', off = null, wake = false, home = null }) {
    const b = new CANNON.Body({ mass, linearDamping: 0.08, angularDamping: 0.12, allowSleep: true, sleepSpeedLimit: 0.15, sleepTimeLimit: 0.6 });
    b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
    const o = off || V3(0, hy, 0), p = mesh.getWorldPosition(V3()).add(o.clone().applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion())));
    if (mesh.parent !== this.scene) this.scene.attach(mesh);
    b.position.set(p.x, p.y, p.z); const q = mesh.quaternion; b.quaternion.set(q.x, q.y, q.z, q.w);
    if (!wake) b.sleep();
    const rec = { mesh, b, off: o, snd, lastSnd: 0, home };
    b.addEventListener('collide', e => { const v = Math.abs(e.contact.getImpactVelocityAlongNormal()); const now = performance.now(); if (v > 1.2 && now - rec.lastSnd > 140) { rec.lastSnd = now; this.clank(rec, v); } });
    this.world.addBody(b); this.props.push(rec); return rec;
  }
  removeProp(rec) { this.world.removeBody(rec.b); rec.mesh.removeFromParent(); this.props.splice(this.props.indexOf(rec), 1); }
  clank(rec, v) {
    const pos = rec.mesh.position, vol = Math.min(1.2, v / 6);
    if (rec.snd === 'metal') this.audio.play('key', { pos, vol, rate: 0.45 + Math.random() * 0.2 });
    else if (rec.snd === 'plastic') this.audio.play('thud', { pos, vol: vol * 0.7, rate: 1.7 + Math.random() * 0.3 });
    else if (rec.snd === 'box') this.audio.play('bag', { pos, vol: vol * 0.8, rate: 0.7 });
    else this.audio.play('thud', { pos, vol, rate: 1.1 + Math.random() * 0.3 });
  }
  // ── 움직이는 몸통 (나·사람·지나가는 차): 위치를 따라가며 속도까지 넘겨줘서 제대로 밀어냄 ──
  kin(key, x, y, z, yaw, hx, hy, hz, dt) {
    let b = this.kins.get(key);
    if (!b) { b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC }); b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz))); b.position.set(x, y, z); b.userData = { key }; this.world.addBody(b); this.kins.set(key, b); }
    // 위치를 바로 옮기면 물건 속으로 파고들어 튕겨 나가므로, 속도로 따라가게 함 (순간이동만 바로 옮김)
    const dx = x - b.position.x, dy = y - b.position.y, dz = z - b.position.z;
    if (dx * dx + dy * dy + dz * dz > 4) { b.position.set(x, y, z); b.velocity.set(0, 0, 0); }
    else { const k = 1 / Math.max(dt, 1 / 60); b.velocity.set(dx * k, dy * k, dz * k); }
    b.quaternion.setFromEuler(0, yaw, 0); b.seen = this.t;
    return b;
  }
  // ── 내가 탄 탈것: 질량 있는 강체 (y·기울기는 고정, 바닥에서 미끄러지지 않게 속도를 직접 줌) ──
  rideStart(obj, S, mass, onHit) {
    this.rideEnd();
    const hy = Math.max(0.3, S.y * 0.4), b = new CANNON.Body({ mass, linearDamping: 0, angularDamping: 0.3, allowSleep: false });
    b.addShape(new CANNON.Box(new CANNON.Vec3(S.x / 2, hy, S.z / 2))); b.linearFactor.set(1, 0, 1); b.angularFactor.set(0, 1, 0);
    b.position.set(obj.position.x, hy + 0.05, obj.position.z); b.quaternion.setFromEuler(0, obj.rotation.y, 0);
    b.addEventListener('collide', e => { const v = Math.abs(e.contact.getImpactVelocityAlongNormal()); onHit?.(v, e.body); if (v >= 4 && e.body.userData?.key?.mesh) (this.pend ||= []).push([e.body, v, b]); });
    this.world.addBody(b); this.ride = { b, obj }; return b;
  }
  rideDrive(fwd, v, yawRate) { const b = this.ride?.b; if (!b) return; b.velocity.x = fwd.x * v; b.velocity.z = fwd.z * v; b.angularVelocity.set(0, yawRate, 0); }
  rideRead(obj) { const b = this.ride?.b; if (!b) return null; obj.position.x = b.position.x; obj.position.z = b.position.z; const e = new CANNON.Vec3(); b.quaternion.toEuler(e); obj.rotation.y = e.y; return b.velocity; }
  rideEnd() { if (this.ride) { this.world.removeBody(this.ride.b); this.ride = null; } }
  // 세게 들이받힌 차 → 사고 차량 (AI 꺼짐, 미끄러지며 돌다 멈춤)
  hitCar(body, v, by) {
    const ref = body.userData?.key; if (!ref || !ref.mesh || ref.wreck || v < 4 || !this.kins.has(ref)) return;
    ref.wreck = true; ref.taken = true; ref.parked = true; ref.cur = 0; this.kins.delete(ref); this.world.removeBody(body);
    const S = ref.mesh.userData.size || { x: 2, y: 1.5, z: 4.4 }, hy = Math.max(0.3, S.y * 0.4);
    const b = new CANNON.Body({ mass: 1200, linearDamping: 0.55, angularDamping: 0.55 }); b.addShape(new CANNON.Box(new CANNON.Vec3(S.x / 2, hy, S.z / 2))); b.linearFactor.set(1, 0, 1); b.angularFactor.set(0, 1, 0);
    b.position.set(ref.mesh.position.x, hy + 0.05, ref.mesh.position.z); b.quaternion.setFromEuler(0, ref.mesh.rotation.y, 0);
    const push = new CANNON.Vec3(); by.velocity.scale(0.55, push); b.velocity.copy(push); b.angularVelocity.set(0, (Math.random() - 0.5) * v * 0.25, 0);
    b.userData = { key: ref }; this.world.addBody(b); this.wrecks.push({ ref, b, t: 0 });
    this.audio.play('hit', { pos: ref.mesh.position, vol: 1.6, rate: 0.5 }); this.audio.play('horn', { pos: ref.mesh.position, vol: 0.9, delay: 0.8 });
    this.onWreck?.(ref, v);
  }
  // ── 매 프레임 ──
  update(dt, me, people, cars) {
    this.t += dt;
    if ((this.st -= dt) < 0) { this.st = 0.4; this.refreshStatics(me); }
    const feet = me.y - 1.55;
    if (!this.ride) this.kin('me', me.x, feet + 0.9, me.z, 0, 0.26, 0.85, 0.26, dt);
    for (const c of people) { const p = c.person.root.position; if (c.dead || Math.abs(p.x - me.x) > 25 || Math.abs(p.z - me.z) > 25) continue; this.kin(c, p.x, p.y + 0.85, p.z, c.person.root.rotation.y, 0.22, 0.85, 0.16, dt); }
    for (const v of cars) {
      if (v.wreck || !v.mesh.visible || v.mesh === this.ride?.obj) continue; const p = v.mesh.position; if (Math.abs(p.x - me.x) > 45 || Math.abs(p.z - me.z) > 45) continue;
      const S = v.mesh.userData.size || { x: 2, y: 1.5, z: 4.4 }, hy = Math.max(0.3, S.y * 0.4); this.kin(v, p.x, hy + 0.05, p.z, v.mesh.rotation.y, S.x / 2, hy, S.z / 2, dt);
    }
    for (const [k, b] of this.kins) if (b.seen !== this.t) { this.world.removeBody(b); this.kins.delete(k); }
    this.world.step(1 / 60, Math.min(dt, 0.1), 6);
    if (this.pend?.length) { for (const [body, v, by] of this.pend) this.hitCar(body, v, by); this.pend.length = 0; }
    // 물건 메시 맞추기
    const q = new THREE.Quaternion();
    for (const r of this.props) { if (r.b.sleepState === CANNON.Body.SLEEPING && r.synced) continue; r.synced = true; q.set(r.b.quaternion.x, r.b.quaternion.y, r.b.quaternion.z, r.b.quaternion.w); r.mesh.quaternion.copy(q); r.mesh.position.set(r.b.position.x, r.b.position.y, r.b.position.z).sub(r.off.clone().applyQuaternion(q)); if (r.b.position.y < -5) { r.b.position.set(r.b.position.x, 1, r.b.position.z); r.b.velocity.set(0, 0, 0); } }
    for (const w of this.wrecks) { const m = w.ref.mesh, e = new CANNON.Vec3(); m.position.x = w.b.position.x; m.position.z = w.b.position.z; w.b.quaternion.toEuler(e); m.rotation.y = e.y; w.t += dt; }
    // 멈춘 사고 차량은 다시 정적인 장애물로 (차는 타고 갈 수 있음)
    for (const w of [...this.wrecks]) if (w.t > 2 && w.b.velocity.lengthSquared() < 0.05) { this.world.removeBody(w.b); this.wrecks.splice(this.wrecks.indexOf(w), 1); w.ref.wreck = false; }
  }
}

// ── 길가 물건: 내 주변 보도에 자동으로 놓이고(위치는 항상 같음), 멀어지면 치움 ──
const M = o => new THREE.MeshStandardMaterial({ roughness: 0.6, envMapIntensity: 0.5, ...o });
function ctex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
let KIT = null;
function kit() {
  if (KIT) return KIT;
  const binTex = (c, txt) => ctex(128, 256, (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(14, 70, w - 28, 54); g.fillStyle = '#222'; g.font = '900 24px "Noto Sans KR",sans-serif'; g.textAlign = 'center'; g.fillText(txt, w / 2, 106); const gr = g.createLinearGradient(0, h * 0.8, 0, h); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(40,30,10,.45)'); g.fillStyle = gr; g.fillRect(0, h * 0.8, w, h * 0.2); });
  const box = ctex(256, 256, (g, w, h) => { g.fillStyle = '#b48a57'; g.fillRect(0, 0, w, h); for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(80,50,20,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 1); } g.fillStyle = 'rgba(220,200,160,.75)'; g.fillRect(w / 2 - 16, 0, 32, h); g.fillStyle = '#5a3c1e'; g.font = '900 30px sans-serif'; g.fillText('↑↑', 20, 50); });
  KIT = {
    binG: M({ map: binTex('#2f6e45', '일반쓰레기'), roughness: 0.5 }), binB: M({ map: binTex('#2d5d9a', '재활용'), roughness: 0.5 }), lid: M({ color: 0x3a3d40, roughness: 0.45 }),
    cone: M({ color: 0xff5a14, roughness: 0.55 }), band: M({ color: 0xf4f4f4, roughness: 0.3, emissive: 0x333333 }), coneBase: M({ color: 0x1a1a1a, roughness: 0.8 }),
    box: M({ map: box, roughness: 0.9 }), crate: M({ color: 0xf2b705, roughness: 0.5 }), crateR: M({ color: 0xc8202a, roughness: 0.5 }), bottle: M({ color: 0x2e6b2a, roughness: 0.15, metalness: 0.1 }),
  };
  return KIT;
}
function makeProp(kind) {
  const K = kit(), g = new THREE.Group(); let s;
  if (kind === 'bin' || kind === 'binB') { const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.86, 0.42), kind === 'bin' ? K.binG : K.binB); body.position.y = 0.43; g.add(body); const lid = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.08, 0.46), K.lid); lid.position.y = 0.9; g.add(lid); const slot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.12), new THREE.MeshBasicMaterial({ color: 0x050505 })); slot.position.set(0, 0.945, 0.05); g.add(slot); s = { hx: 0.27, hy: 0.47, hz: 0.23, mass: 14, snd: 'plastic' }; }
  else if (kind === 'cone') { const c = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.66, 18), K.cone); c.position.y = 0.37; g.add(c); for (const [y, r] of [[0.42, 0.105], [0.27, 0.13]]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.012, r, 0.07, 18, 1, true), K.band); b.position.y = y; g.add(b); } const base = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.04, 0.38), K.coneBase); base.position.y = 0.02; g.add(base); s = { hx: 0.17, hy: 0.35, hz: 0.17, mass: 2.5, snd: 'plastic' }; }
  else if (kind === 'box') { const w = 0.35 + Math.random() * 0.25, h = 0.25 + Math.random() * 0.2, d = 0.3 + Math.random() * 0.2; const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), K.box); b.position.y = h / 2; g.add(b); s = { hx: w / 2, hy: h / 2, hz: d / 2, mass: 3, snd: 'box' }; }
  else { const red = Math.random() < 0.5, m = red ? K.crateR : K.crate; const b = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.3, 0.36), m); b.position.y = 0.15; g.add(b); for (let i = 0; i < 6; i++) { const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), K.bottle); bt.position.set(-0.17 + (i % 3) * 0.17, 0.3, i < 3 ? -0.08 : 0.08); g.add(bt); } s = { hx: 0.26, hy: 0.15, hz: 0.18, mass: 6, snd: 'plastic' }; }
  return { g, s };
}
export class StreetProps {
  // curbs(center): 주변 보도 선분 [{ ax:'x'|'z', c, a, b, out(-1|1) }]
  constructor({ physics, scene, colliders, curbs }) { Object.assign(this, { physics, scene, colliders, curbs }); this.live = new Map(); this.t = 0; }
  blocked(x, z) { for (const c of this.colliders) if (x > c.x0 - 0.5 && x < c.x1 + 0.5 && z > c.z0 - 0.5 && z < c.z1 + 0.5 && c.lv !== -1 && !(c.y0 > 1)) return true; return false; }
  update(dt, me) {
    if ((this.t -= dt) > 0) return; this.t = 0.8;
    const want = new Set();
    for (const s of this.curbs(me)) {
      const step = 9; for (let u = Math.ceil(s.a / step) * step; u < s.b; u += step) {
        if (s.skip && u > s.skip[0] && u < s.skip[1]) continue;
        const h = hash(u * 1.3 + s.c * 0.7, s.c * 1.1 + (s.ax === 'x' ? 1 : 7)); if (h > 0.5) continue;
        const kind = h < 0.12 ? 'bin' : h < 0.2 ? 'binB' : h < 0.3 ? 'cone' : h < 0.42 ? 'box' : 'crate';
        const off = kind === 'cone' ? 0.6 : kind.startsWith('bin') ? 0.9 : 2.6, x = s.ax === 'x' ? u : s.c + s.out * off, z = s.ax === 'x' ? s.c + s.out * off : u;
        if (Math.abs(x - me.x) > 55 || Math.abs(z - me.z) > 55) continue;
        const key = `${kind}:${x.toFixed(1)}:${z.toFixed(1)}`; want.add(key);
        if (this.live.has(key) || this.blocked(x, z)) continue;
        const n = kind === 'box' || kind === 'crate' ? 1 + (h * 37 | 0) % 3 : 1, recs = [];
        for (let i = 0; i < n; i++) { const { g, s: sz } = makeProp(kind); g.position.set(x + (i ? (Math.random() - 0.5) * 0.1 : 0), i * sz.hy * 2.02, z); g.rotation.y = (s.ax === 'x' ? 0 : Math.PI / 2) + (Math.random() - 0.5) * 0.3; this.scene.add(g); recs.push(this.physics.addProp(g, sz)); }
        this.live.set(key, recs);
      }
    }
    for (const [k, recs] of this.live) if (!want.has(k)) { const far = recs.every(r => Math.abs(r.mesh.position.x - me.x) > 70 || Math.abs(r.mesh.position.z - me.z) > 70); if (far) { for (const r of recs) this.physics.removeProp(r); this.live.delete(k); } }
  }
}
