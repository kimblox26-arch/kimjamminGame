// 무기: 활과 총 — 모델, 총 사격(히트스캔), 화살, 떨어진 무기 줍기(로블록스 도구처럼 닿으면 주움)
import * as THREE from 'three';
import { G } from './game.js';
import { rbox, mat, rand, canvasTex } from './util.js';
import { Sound } from './audio.js';

export const WEAPONS = {
  bow: { id: 'bow', name: '활', type: 'bow', minDmg: 22, maxDmg: 110, draw: 0.75, minSpd: 80, maxSpd: 250, npcDmg: 22, rate: 0.45 },
  gun: { id: 'gun', name: '총', type: 'gun', dmg: 30, npcDmg: 11, rate: 0.22, spread: 0.008 },
};
export const makeWeapon = (id) => ({ def: WEAPONS[id] });

// 모델: 손잡이가 원점, 총구가 -Z 방향
export function buildModel(id) {
  const g = new THREE.Group();
  const B = (w, h, d, c, x, y, z, rx = 0) => { const m = new THREE.Mesh(rbox(w, h, d, Math.min(w, h, d) * 0.25, 2), mat(c)); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; g.add(m); return m; };
  if (id === 'gun') {
    B(0.3, 0.36, 1.15, '#2c2e33', 0, 0.2, -0.32); B(0.28, 0.62, 0.34, '#3b3e44', 0, -0.12, 0.08, 0.22); B(0.12, 0.12, 0.2, '#111', 0, 0.22, -0.92);
    g.userData.muzzle = new THREE.Vector3(0, 0.22, -1.0);
  } else {
    const R = 2.2, n = 10;
    for (let i = 0; i < n; i++) {
      const a0 = -0.85 + (1.7 * i) / n, a1 = -0.85 + (1.7 * (i + 1)) / n, am = (a0 + a1) / 2;
      const m = B(0.22, R * (a1 - a0) + 0.05, 0.3, i === 4 || i === 5 ? '#3b2a1a' : '#8b5a2b', 0, R * Math.sin(am), R * (1 - Math.cos(am)));
      m.rotation.x = am;
    }
    const tip = R * (1 - Math.cos(0.85)), ty = R * Math.sin(0.85);
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, ty, tip), new THREE.Vector3(0, 0, tip), new THREE.Vector3(0, -ty, tip)]);
    const str = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#f0f0f0' }));
    g.add(str);
    g.userData.string = str; g.userData.tip = tip;
    const arrow = buildArrow(); arrow.position.set(0, 0, tip - 2.5); g.add(arrow); g.userData.arrow = arrow;
    g.userData.muzzle = new THREE.Vector3(0, 0, -0.6);
  }
  return g;
}
// 활 시위 당김 (0~1)
export function setBowDraw(model, d) {
  const u = model.userData, p = u.string.geometry.attributes.position;
  p.setZ(1, u.tip + d * 1.7); p.needsUpdate = true;
  u.arrow.position.z = u.tip + d * 1.7 - 2.5;
}
// 화살: 촉이 원점, 몸통이 +Z 로
export function buildArrow() {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 2.4), mat('#a0703c')); s.position.z = 1.3; g.add(s);
  const h = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.35, 4), mat('#9aa0a6')); h.rotation.x = -Math.PI / 2; g.add(h);
  for (const r of [0, Math.PI / 2]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.45), mat('#d33')); f.position.z = 2.3; f.rotation.z = r; g.add(f); }
  g.traverse((m) => (m.castShadow = true));
  return g;
}

// 총구 불꽃
const flashTex = canvasTex(64, (c) => {
  const gr = c.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.35, 'rgba(255,200,80,0.9)'); gr.addColorStop(1, 'rgba(255,120,0,0)');
  c.fillStyle = gr; c.beginPath();
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = i % 2 ? 12 : 31; c.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
  c.fill();
});
export const flashMat = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
const flashes = [];
export function muzzleFlash(pos) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), flashMat);
  m.position.copy(pos); m.lookAt(G.camera.position); m.rotateZ(Math.random() * 3);
  G.scene.add(m);
  flashes.push({ m, t: 0.05 });
}

// ── 총 사격 (플레이어·NPC 공통) ──
const rc = new THREE.Raycaster();
export function fireHitscan(origin, dir, wpn, shooter) {
  const def = wpn.def, isPlayer = shooter === G.player;
  const sp = def.spread;
  const d = dir.clone().add(new THREE.Vector3(rand(-sp, sp), rand(-sp, sp), rand(-sp, sp))).normalize();
  rc.set(origin, d); rc.far = 600;
  let h = null;
  for (const x of rc.intersectObjects(G.hitList, false)) {
    const u = x.object.userData;
    if (u.owner && u.owner === shooter) continue;
    if (u.car && u.car === shooter.car) continue;
    h = x; break;
  }
  let dist = h ? h.distance : 600;
  if (!isPlayer && G.player.alive) {
    const tp = G.player.rayHit(origin, d);
    if (tp < dist) { dist = tp; h = null; G.player.hurt(def.npcDmg * rand(0.85, 1.15), origin, shooter); }
  }
  if (h && h.object.userData.kind === 'part') {
    const u = h.object.userData;
    u.owner.hit({ part: u.part, mesh: h.object, point: h.point, localNormal: h.face.normal.clone(), dir: d, dmg: def.dmg, attacker: shooter, kind: 'bullet', weapon: def.id, force: 22 });
  } else if (h && h.object.userData.car) Sound.ping(h.point);
  if (isPlayer) {
    for (const n of G.npcs) {
      if (!n.alive) continue;
      const c = n.chest(), t = c.clone().sub(origin).dot(d);
      if (t > 0 && t < dist && origin.clone().addScaledVector(d, t).distanceTo(c) < 4) n.hear({ type: 'whiz', pos: origin, source: shooter });
    }
  }
}

// ── 화살 ──
const arrows = [], stuck = [];
export function shootArrow(pos, dir, speed, dmg, owner) {
  const m = buildArrow();
  m.position.copy(pos);
  G.scene.add(m);
  arrows.push({ m, p: pos.clone(), v: dir.clone().multiplyScalar(speed), dmg, owner, life: 6 });
}
function stick(m, parent) {
  parent.attach(m);
  stuck.push(m);
  if (stuck.length > 70) stuck.shift().removeFromParent();
}
const _z = new THREE.Vector3(0, 0, -1), _d = new THREE.Vector3();
function updateArrows(dt) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    a.life -= dt;
    a.v.y -= 45 * dt;
    const step = a.v.length() * dt;
    _d.copy(a.v).normalize();
    rc.set(a.p, _d); rc.far = step + 0.3;
    let h = null;
    for (const x of rc.intersectObjects(G.hitList, false)) { if (x.object.userData.owner && x.object.userData.owner === a.owner) continue; h = x; break; }
    if (a.owner !== G.player && G.player.alive) {
      const tp = G.player.rayHit(a.p, _d);
      if (tp < (h ? h.distance : step)) { G.player.hurt(a.dmg, a.p, a.owner); a.m.removeFromParent(); arrows.splice(i, 1); Sound.flesh(G.player.pos); continue; }
    }
    if (h) {
      const u = h.object.userData, spd = a.v.length();
      a.m.position.copy(h.point).addScaledVector(_d, 0.45);
      a.m.quaternion.setFromUnitVectors(_z, _d);
      a.m.updateMatrixWorld();
      if (u.kind === 'part') {
        stick(a.m, h.object);
        u.owner.hit({ part: u.part, mesh: h.object, point: h.point, localNormal: h.face.normal.clone(), dir: _d.clone(), dmg: a.dmg * (spd / 250 * 0.4 + 0.6), attacker: a.owner, kind: 'arrow', weapon: 'bow', force: 16 });
      } else { stick(a.m, G.scene); Sound.thunk(h.point); }
      arrows.splice(i, 1);
      continue;
    }
    if (a.life <= 0) { a.m.removeFromParent(); arrows.splice(i, 1); continue; }
    a.p.addScaledVector(a.v, dt);
    a.m.position.copy(a.p);
    a.m.quaternion.setFromUnitVectors(_z, _d);
  }
}

// ── 떨어진 무기: 닿으면 줍는다 ──
export function dropPickup(wpn, pos) {
  const m = buildModel(wpn.def.id);
  if (wpn.def.id === 'bow') { m.userData.arrow.visible = false; m.scale.setScalar(0.8); }
  m.position.copy(pos).setY(0.4);
  m.rotation.set(Math.PI / 2, 0, Math.random() * 6);
  m.traverse((o) => { if (o.isMesh) { o.userData = { kind: 'world' }; } });
  G.scene.add(m);
  G.pickups.push({ wpn, m, pos: m.position, cool: 1.2 });
}
export function removePickup(p) {
  p.m.removeFromParent();
  const i = G.pickups.indexOf(p);
  if (i >= 0) G.pickups.splice(i, 1);
}

export function updateWeapons(dt) {
  updateArrows(dt);
  for (let i = flashes.length - 1; i >= 0; i--) { const t = flashes[i]; t.t -= dt; if (t.t <= 0) { t.m.removeFromParent(); t.m.geometry.dispose(); flashes.splice(i, 1); } }
  for (const p of [...G.pickups]) {
    p.cool -= dt;
    if (p.cool <= 0 && G.player.alive && !G.player.car && Math.hypot(p.pos.x - G.player.pos.x, p.pos.z - G.player.pos.z) < 2.5) {
      if (G.player.give(p.wpn)) removePickup(p);
    }
  }
}
