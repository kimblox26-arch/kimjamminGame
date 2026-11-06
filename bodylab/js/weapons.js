// 무기: 권총·돌격소총·산탄총·저격소총·칼·야구 방망이·수류탄
// 총알은 실제로 날아가며(슬로우 모션에서 보임) 몸을 관통할 때 지나간 길·장기·뼈를 계산한다.
import * as THREE from 'three';
import { rayBox, Particle } from './physics.js';
import { xrayMaterial } from './anatomy.js';
import { paint, toTex, fbm } from './tex.js';

const V = THREE.Vector3, M4 = THREE.Matrix4;
const _a = new V(), _b = new V(), _c = new V(), _n = new V(), _m = new M4(), _q = new THREE.Quaternion();
const N = (x, y, z) => new V(x, y, z).normalize();
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const GRIP_FINGERS = [[0.35, 0.5, 0.35], [0.95, 1.15, 0.7], [1.0, 1.2, 0.75], [1.05, 1.25, 0.75], [1.1, 1.3, 0.75]];
const TRIGGER = [[0.35, 0.5, 0.35], [0.35, 0.55, 0.3], [1.0, 1.2, 0.75], [1.05, 1.25, 0.75], [1.1, 1.3, 0.75]];
export const WEAPONS = [
  { id: 'pistol', name: '권총', type: 'gun', dmg: 34, pellets: 1, spread: 0.003, rate: 0.2, auto: false, speed: 360, energy: 1.0, kick: 0.035, snd: 'pistol' },
  { id: 'rifle', name: '돌격소총', type: 'gun', dmg: 36, pellets: 1, spread: 0.006, rate: 0.095, auto: true, speed: 880, energy: 1.7, kick: 0.022, snd: 'rifle' },
  { id: 'shotgun', name: '산탄총', type: 'gun', dmg: 17, pellets: 10, spread: 0.045, rate: 0.8, auto: false, speed: 420, energy: 0.75, kick: 0.09, snd: 'shotgun' },
  { id: 'sniper', name: '저격소총', type: 'gun', dmg: 130, pellets: 1, spread: 0, rate: 1.3, auto: false, speed: 900, energy: 4.5, kick: 0.12, snd: 'sniper', zoom: true },
  { id: 'knife', name: '칼', type: 'melee', dmg: 42, rate: 0.5 },
  { id: 'bat', name: '야구 방망이', type: 'melee', dmg: 38, rate: 0.75 },
  { id: 'grenade', name: '수류탄', type: 'throw', rate: 1.1 },
];

// ───────── 모델 ─────────
function rbox(w, h, d, r = 0.004) {
  const s = new THREE.Shape(), x = w / 2 - r, y = h / 2 - r;
  s.moveTo(-x, -h / 2); s.lineTo(x, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -y); s.lineTo(w / 2, y); s.quadraticCurveTo(w / 2, h / 2, x, h / 2);
  s.lineTo(-x, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, y); s.lineTo(-w / 2, -y); s.quadraticCurveTo(-w / 2, -h / 2, -x, -h / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.8, bevelSegments: 2, curveSegments: 3 });
  g.translate(0, 0, -(d - 2 * r) / 2);
  return g;
}
function cyl(r, len, seg = 20, r2 = r) { const g = new THREE.CylinderGeometry(r2, r, len, seg); g.rotateX(Math.PI / 2); return g; }
function makeMats() {
  const steel = new THREE.MeshStandardMaterial({ color: 0x1d1f22, metalness: 0.85, roughness: 0.32 });
  const steel2 = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.9, roughness: 0.25 });
  const poly = new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0, roughness: 0.62,
    roughnessMap: toTex(paint(128, (u, v) => { const r = 140 + fbm(u * 16, v * 16, 16, 3, 2) * 90; return [r, r, r]; }), { repeat: 4 }) });
  const tan = new THREE.MeshStandardMaterial({ color: 0x8a7a5c, metalness: 0, roughness: 0.7 });
  const wood = new THREE.MeshStandardMaterial({ map: toTex(paint(256, (u, v) => { const g = Math.sin((u * 40 + fbm(u * 3, v * 12, 3, 4, 5) * 8)) * 0.5 + 0.5; return [110 + g * 50, 62 + g * 30, 30 + g * 15]; }), { srgb: true }), roughness: 0.45, metalness: 0 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdde3ea, metalness: 1, roughness: 0.12 });
  const green = new THREE.MeshStandardMaterial({ color: 0x3e4a2c, metalness: 0.2, roughness: 0.55 });
  const lens = new THREE.MeshPhysicalMaterial({ color: 0x223355, metalness: 0.2, roughness: 0.05, clearcoat: 1 });
  return { steel, steel2, poly, tan, wood, chrome, green, lens };
}
function part(g, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; }

function buildModels(M) {
  const W = {};
  { // 권총: 손잡이 중심이 원점
    const g = new THREE.Group();
    part(g, rbox(0.03, 0.032, 0.19, 0.005), M.steel, 0, 0.068, 0.045);
    part(g, rbox(0.028, 0.022, 0.15, 0.004), M.poly, 0, 0.042, 0.055);
    part(g, rbox(0.03, 0.11, 0.045, 0.007), M.poly, 0, -0.005, -0.008, -0.25);
    part(g, cyl(0.006, 0.02), M.steel2, 0, 0.068, 0.143);
    part(g, new THREE.TorusGeometry(0.016, 0.003, 6, 16, Math.PI), M.poly, 0, 0.03, 0.035, 0, Math.PI / 2, Math.PI);
    part(g, rbox(0.004, 0.018, 0.006, 0.001), M.steel2, 0, 0.03, 0.03, 0.3);
    part(g, rbox(0.005, 0.008, 0.008, 0.001), M.steel2, 0, 0.088, 0.13);
    W.pistol = { g, muzzle: new V(0, 0.068, 0.155), R: { grip: new V(0, -0.01, -0.008), F: N(0, -0.24, 0.97), U: N(1, 0, 0), curl: TRIGGER },
      L: { grip: new V(0.028, -0.025, -0.0), F: N(-0.3, -0.35, 0.88), U: N(-1, 0.25, 0.2), curl: GRIP_FINGERS } };
  }
  const rifleBase = (len, barrel, mat2) => {
    const g = new THREE.Group();
    part(g, rbox(0.045, 0.07, 0.3, 0.006), M.steel, 0, 0.055, 0.06);
    part(g, rbox(0.032, 0.11, 0.045, 0.006), M.poly, 0, -0.005, -0.005, -0.3);
    part(g, rbox(0.05, 0.055, 0.26, 0.01), mat2, 0, 0.05, 0.33);
    part(g, cyl(0.009, barrel), M.steel, 0, 0.06, 0.33 + barrel / 2 - 0.05);
    part(g, rbox(0.04, 0.06, 0.24, 0.01), mat2, 0, 0.03, -0.2);
    part(g, rbox(0.035, 0.11, 0.035, 0.008), mat2, 0, 0.005, -0.32);
    part(g, new THREE.TorusGeometry(0.018, 0.0035, 6, 16, Math.PI), M.poly, 0, 0.012, 0.035, 0, Math.PI / 2, Math.PI);
    return g;
  };
  { const g = rifleBase(0.8, 0.36, M.poly); part(g, rbox(0.028, 0.15, 0.05, 0.006), M.steel, 0, -0.03, 0.13, 0.25); part(g, rbox(0.03, 0.035, 0.07, 0.004), M.steel2, 0, 0.105, 0.1);
    W.rifle = { g, muzzle: new V(0, 0.06, 0.65), R: { grip: new V(0, -0.005, -0.008), F: N(0, -0.3, 0.95), U: N(1, 0, 0), curl: TRIGGER }, L: { grip: new V(0, 0.03, 0.34), F: N(-0.85, 0.1, 0.5), U: N(0, 1, 0), curl: GRIP_FINGERS } }; }
  { const g = new THREE.Group();
    part(g, cyl(0.011, 0.72), M.steel, 0, 0.065, 0.36); part(g, cyl(0.01, 0.55), M.steel2, 0, 0.04, 0.3);
    part(g, rbox(0.045, 0.06, 0.2, 0.006), M.steel, 0, 0.05, 0.02); part(g, rbox(0.05, 0.05, 0.16, 0.012), M.wood, 0, 0.035, 0.36);
    part(g, rbox(0.04, 0.07, 0.3, 0.012), M.wood, 0, 0.0, -0.2, 0.15); part(g, rbox(0.032, 0.1, 0.04, 0.008), M.wood, 0, -0.01, -0.03, -0.35);
    W.shotgun = { g, muzzle: new V(0, 0.065, 0.72), R: { grip: new V(0, -0.01, -0.03), F: N(0, -0.3, 0.95), U: N(1, 0, 0), curl: TRIGGER }, L: { grip: new V(0, 0.03, 0.36), F: N(-0.85, 0.1, 0.5), U: N(0, 1, 0), curl: GRIP_FINGERS } }; }
  { const g = rifleBase(1.1, 0.6, M.tan); part(g, cyl(0.022, 0.3), M.steel, 0, 0.125, 0.1); part(g, cyl(0.026, 0.05, 20), M.steel, 0, 0.125, 0.25); part(g, cyl(0.025, 0.05), M.steel, 0, 0.125, -0.04);
    part(g, new THREE.CircleGeometry(0.02, 20), M.lens, 0, 0.125, 0.276); part(g, rbox(0.03, 0.08, 0.04, 0.006), M.steel, 0, -0.02, 0.14);
    W.sniper = { g, muzzle: new V(0, 0.06, 0.88), R: { grip: new V(0, -0.005, -0.008), F: N(0, -0.3, 0.95), U: N(1, 0, 0), curl: TRIGGER }, L: { grip: new V(0, 0.03, 0.34), F: N(-0.85, 0.1, 0.5), U: N(0, 1, 0), curl: GRIP_FINGERS } }; }
  { // 칼: +Y 가 칼끝
    const g = new THREE.Group();
    const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.016, 0); s.quadraticCurveTo(0.018, 0.12, 0.0, 0.2); s.lineTo(-0.012, 0.15); s.lineTo(-0.012, 0); s.lineTo(0, 0);
    const bl = new THREE.ExtrudeGeometry(s, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0012, bevelSegments: 1 }); bl.translate(0, 0.02, -0.001); bl.rotateY(Math.PI / 2);
    part(g, bl, M.chrome); part(g, rbox(0.022, 0.11, 0.026, 0.008), M.poly, 0, -0.04, 0, Math.PI / 2, 0, 0).geometry.rotateX(Math.PI / 2);
    part(g, rbox(0.012, 0.012, 0.05, 0.003), M.steel, 0, 0.018, 0, 0, 0, 0);
    W.knife = { g, tip: new V(0, 0.22, 0), base: new V(0, 0.04, 0), R: { grip: new V(0, -0.045, 0), F: N(0, 0, 1), U: N(1, 0, 0), curl: GRIP_FINGERS } };
  }
  { const pts = []; for (let i = 0; i <= 20; i++) { const y = i / 20 * 0.84; const r = y < 0.02 ? 0.022 : y < 0.3 ? 0.014 + (y - 0.02) * 0.01 : 0.017 + Math.pow((y - 0.3) / 0.54, 0.7) * 0.016; pts.push(new THREE.Vector2(i === 20 ? 0 : r, y)); }
    const g = new THREE.Group(); part(g, new THREE.LatheGeometry(pts, 24), M.wood);
    W.bat = { g, pts: [new V(0, 0.45, 0), new V(0, 0.62, 0), new V(0, 0.8, 0)], R: { grip: new V(0, 0.13, 0), F: N(0, 0, 1), U: N(1, 0, 0), curl: GRIP_FINGERS }, L: { grip: new V(0, 0.05, 0), F: N(0, 0, 1), U: N(-1, 0, 0), curl: GRIP_FINGERS } }; }
  { const g = new THREE.Group(); const b = new THREE.SphereGeometry(0.032, 20, 16); b.scale(1, 1.25, 1); part(g, b, M.green);
    part(g, cyl(0.012, 0.025), M.steel2, 0, 0.045, 0, Math.PI / 2); part(g, rbox(0.008, 0.06, 0.012, 0.002), M.steel2, 0.02, 0.03, 0, 0, 0, 0.2); part(g, new THREE.TorusGeometry(0.01, 0.0015, 6, 16), M.chrome, -0.015, 0.055, 0);
    W.grenade = { g, R: { grip: new V(0, 0, 0), F: N(0, 0.2, 1), U: N(1, 0, 0), curl: [[0.5, 0.5, 0.4], [0.7, 0.8, 0.6], [0.75, 0.85, 0.6], [0.8, 0.9, 0.6], [0.85, 0.95, 0.6]] } }; }
  return W;
}

export class Weapons {
  constructor(G) {
    this.G = G; this.M = makeMats(); this.models = buildModels(this.M);
    this.cur = 0; this.cd = 0; this.bullets = []; this.grenades = []; this.swing = null; this.kickT = 0; this.kick = 0;
    this.group = new THREE.Group(); G.scene.add(this.group);
    this.xmat = xrayMaterial(0xffffff, { solid: 0.5, rim: 1.5, power: 1.2 });
    for (const k in this.models) { const m = this.models[k]; m.g.visible = false; m.g.matrixAutoUpdate = false; this.group.add(m.g); m.g.traverse(o => { if (o.isMesh) { o.layers.enable(1); G.xraySwap.push({ mesh: o, x: this.xmat }); } }); }
    this.bulletGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.022, 8); this.bulletGeo.rotateX(Math.PI / 2);
    this.bulletMat = new THREE.MeshStandardMaterial({ color: 0xc8883a, metalness: 1, roughness: 0.25, emissive: 0x331100 });
    this.bulletX = xrayMaterial(0xffe066, { solid: 1, power: 2.5 });
    this.trailMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    this.trailX = new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    this.wpose = new M4();
    this.aimPoint = new V();
  }
  get w() { return WEAPONS[this.cur]; }
  select(i) { if (i === this.cur || this.swing) return; this.cur = i; this.cd = 0.25; this.G.audio.click(); }

  // 무기 위치(월드 행렬) 계산 + 손 잡는 법(player.hold)
  pose(dt, aimDir, ads = 0, eye = null) {
    const G = this.G, pl = G.player, w = this.w, mdl = this.models[w.id];
    for (const k in this.models) this.models[k].g.visible = false;
    if (pl.car) return;
    const P = pl.particles;
    const f = _a.copy(aimDir).normalize(), r = _b.crossVectors(f, new V(0, 1, 0)).normalize(), u = _c.crossVectors(r, f);
    const basis = new M4().makeBasis(r.clone().negate(), u, f);
    const sh = P[8].p;
    let grip = new V(), rot = basis.clone();
    this.kick = Math.max(0, this.kick - dt * 6);
    const kb = this.kick;
    const at = (x, y, z) => grip.copy(sh).addScaledVector(r, x).addScaledVector(u, y).addScaledVector(f, z);
    if (w.type === 'gun') {
      if (w.id === 'pistol') at(-0.06, 0.04 + kb * 0.5, 0.44 - kb);
      else at(-0.02, 0.0, 0.24 - kb * 0.6);
      if (eye && ads > 0.001) { // 눈높이에 가늠자가 오게
        const A = { pistol: [0.085, 0.42], rifle: [0.115, 0.26], shotgun: [0.088, 0.3], sniper: [0.14, 0.2] }[w.id];
        const e = new V().copy(eye).addScaledVector(u, -A[0] + kb * 0.3).addScaledVector(f, A[1] - kb);
        grip.lerp(e, ads);
      }
      if (kb > 0) rot.multiply(_m.makeRotationX(-kb * 2.5));
    } else if (w.id === 'knife') {
      let t = this.swing ? this.swing.t / this.swing.dur : 0, k = this.swing?.kind || 0;
      const rest = [0.03, -0.3, 0.32], wind = k ? [0.3, -0.05, 0.28] : [0.06, -0.22, 0.12], hit = k ? [-0.3, -0.25, 0.5] : [-0.05, -0.12, 0.72];
      const e = t < 0.3 ? sstep(0, 0.3, t) : 0, h = t >= 0.3 && t < 0.5 ? sstep(0.3, 0.45, t) : 0, back = t >= 0.5 ? sstep(0.5, 1, t) : 0;
      const p = rest.map((v, i) => t < 0.3 ? v + (wind[i] - v) * e : t < 0.5 ? wind[i] + (hit[i] - wind[i]) * h : hit[i] + (rest[i] - hit[i]) * back);
      at(p[0], p[1], p[2]);
      rot.multiply(_m.makeRotationX(Math.PI / 2 - 0.25)).multiply(new M4().makeRotationY(k ? -0.6 + t : 0));
    } else if (w.id === 'bat') {
      const t = this.swing ? this.swing.t / this.swing.dur : 0;
      const L = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
      const RG = [-0.12, -0.25, 0.28], RD = [0.25, 0.9, 0.35], WG = [0.03, -0.05, 0.02], WD = [0.5, 0.55, -0.65], SG = [-0.2, -0.18, 0.32];
      let g, d;
      if (t < 0.3) { const k = sstep(0, 0.3, t); g = L(RG, WG, k); d = L(RD, WD, k); }
      else if (t < 0.6) { const k = sstep(0.3, 0.58, t), th = 1.6 - k * 3.1; g = L(WG, SG, Math.min(1, k * 2)); d = [Math.sin(th), 0.1, Math.cos(th)]; if (k < 0.2) d = L(WD, d, k / 0.2); }
      else { const k = sstep(0.6, 1, t); g = L(SG, RG, k); d = L([Math.sin(-1.5), 0.1, Math.cos(-1.5)], RD, k); }
      at(g[0], g[1], g[2]);
      const D = new V().addScaledVector(r, d[0]).addScaledVector(u, d[1]).addScaledVector(f, d[2]).normalize();
      const Zt = u.clone().addScaledVector(D, -u.dot(D)); if (Zt.lengthSq() < 1e-4) Zt.copy(f); Zt.normalize();
      rot.makeBasis(new V().crossVectors(D, Zt), D, Zt);
    } else {
      const t = this.swing ? this.swing.t / this.swing.dur : 0;
      at(-0.05 + (t > 0 && t < 0.4 ? 0.2 : 0), -0.25 + (t > 0 && t < 0.5 ? 0.45 * Math.sin(t / 0.5 * Math.PI) : 0), 0.3 - (t > 0 && t < 0.4 ? 0.45 * sstep(0, 0.4, t) : 0) + (t >= 0.4 && t < 0.6 ? 0.3 : 0));
      if (this.swing && this.swing.thrown) at(-0.05, -0.3, 0.3);
    }
    // 월드 행렬: 손잡이 점이 grip 에 오게
    const R = mdl.R;
    const pos = R.grip.clone().applyMatrix4(rot);
    rot.setPosition(grip.x - pos.x, grip.y - pos.y, grip.z - pos.z);
    this.wpose.copy(rot);
    const gw = (h) => h && { grip: h.grip.clone().applyMatrix4(rot), F: h.F.clone().transformDirection(rot), U: h.U.clone().transformDirection(rot), curl: h.curl };
    if (pl.state === 'stand' && !pl.dead && pl.conscious) {
      pl.hold = { R: gw(R), L: gw(mdl.L) };
      if (pl.hold.L) pl.hold.L.pole = r.clone().negate().add(new V(0, -1.2, 0));
      pl.hold.R.pole = r.clone().add(new V(0, -1.2, -0.2));
    } else pl.hold = null;
    mdl.g.visible = !(this.swing?.thrown);
  }
  // 물리 뒤: 모델을 손에 맞춰 놓는다 (쓰러지면 손을 따라감)
  place() {
    const pl = this.G.player, mdl = this.models[this.w.id], hm = pl.arms.R.mat[2];
    if (pl.car) return;
    if (pl.hold) { mdl.g.matrix.copy(this.wpose); this.rel = (this.rel || new M4()).copy(hm).invert().multiply(this.wpose); }
    else if (this.rel) mdl.g.matrix.multiplyMatrices(hm, this.rel); // 쓰러져도 손에 쥔 채로
  }

  trigger(down, pressed, aimDir, camPos) {
    const G = this.G, w = this.w, pl = G.player;
    if (pl.dead || pl.car || !pl.conscious || pl.state !== 'stand' || this.cd > 0 || this.swing) return;
    if (!(pressed || (down && w.auto))) return;
    this.cd = w.rate;
    if (w.type === 'gun') this.fire(aimDir, camPos);
    else if (w.type === 'melee') this.swing = { t: 0, dur: w.id === 'knife' ? 0.45 : 0.7, kind: w.id === 'knife' ? (this.alt = !this.alt) ? 1 : 0 : 0, hit: new Set() }, G.audio.whoosh(pl.particles[10].p, w.id === 'bat' ? 1 : 0.6);
    else this.swing = { t: 0, dur: 0.75, thrown: false, dir: aimDir.clone() };
  }

  fire(aimDir, camPos) {
    const G = this.G, w = this.w, mdl = this.models[w.id];
    const muzzle = mdl.muzzle.clone().applyMatrix4(this.wpose);
    // 화면 가운데가 가리키는 점을 향해
    const target = this.aimPoint;
    const base = new V().subVectors(target, muzzle).normalize();
    G.fx.muzzle(muzzle, base, w.id === 'shotgun' || w.id === 'sniper' ? 1.6 : 1);
    G.audio.gun(w.snd, muzzle);
    G.noise(muzzle, 20);
    this.kick = w.kick * 6; G.recoil(w.kick);
    for (let i = 0; i < w.pellets; i++) {
      const d = base.clone();
      if (w.spread) d.add(new V((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).multiplyScalar(w.spread)).normalize();
      this.shoot(muzzle, d, w, w.pellets > 1);
    }
  }
  // 총알 하나: 경로를 미리 계산해 사건 목록을 만든다
  shoot(origin, dir, w, pellet, shrapnel = false) {
    const G = this.G, events = [];
    let maxT = 120, wallN = new V(), wall = null;
    for (const b of G.world.solids) { const t = rayBox(origin, dir, b, _n); if (t >= 0 && t < maxT) { maxT = t; wallN.copy(_n); wall = b; } }
    // 물
    const W = G.world.water;
    if (dir.y < 0) { const t = (W.surface - origin.y) / dir.y; if (t > 0 && t < maxT) { const p = origin.clone().addScaledVector(dir, t); if (G.world.inPool(p.x, p.z)) events.push({ t, kind: 'water', p }); } }
    const hits = [];
    for (const h of G.humans) {
      if (h === G.player && !shrapnel) continue;
      for (const s of h.raycast(origin, dir, maxT)) hits.push({ h, ...s });
    }
    hits.sort((a, b) => a.tIn - b.tIn);
    let energy = w.energy;
    for (const hh of hits) {
      const len = hh.tOut - hh.tIn, cost = len * 4.2 + 0.25;
      const exits = energy > cost;
      const tEnd = exits ? hh.tOut : hh.tIn + len * Math.max(0.15, energy / cost);
      const pIn = origin.clone().addScaledVector(dir, hh.tIn), pEnd = origin.clone().addScaledVector(dir, tEnd);
      events.push({ t: hh.tIn, kind: 'body', h: hh.h, part: hh.part, a: hh.h.toBind(hh.part, pIn, new V()), b: hh.h.toBind(hh.part, pEnd, new V()), exits, tEnd, dmg: w.dmg * Math.min(1, energy + 0.3) });
      energy -= cost;
      if (energy <= 0) { maxT = tEnd; wall = null; break; }
    }
    if (wall) events.push({ t: maxT, kind: 'wall', p: origin.clone().addScaledVector(dir, maxT), n: wallN.clone(), metal: !!wall.metal });
    events.sort((a, b) => a.t - b.t);
    // 물속에서는 금방 멈춤
    const wi = events.findIndex(e => e.kind === 'water');
    if (wi >= 0) { const tw = events[wi].t; for (let i = events.length - 1; i > wi; i--) if (events[i].t > tw + 1.2) events.splice(i, 1); maxT = Math.min(maxT, tw + 1.2); }
    const b = { o: origin.clone(), d: dir.clone(), t: 0, maxT, speed: w.speed, events, w, pellet, shrapnel };
    if (!shrapnel) {
      b.mesh = new THREE.Mesh(this.bulletGeo, this.bulletMat); b.mesh.layers.enable(1); G.xraySwap.push({ mesh: b.mesh, x: this.bulletX });
      b.trail = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0006, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5), this.trailMat);
      b.trail.layers.enable(1); G.xraySwap.push({ mesh: b.trail, x: this.trailX });
      G.scene.add(b.mesh, b.trail);
      b.mesh.quaternion.setFromUnitVectors(new V(0, 0, 1), dir); b.trail.quaternion.copy(b.mesh.quaternion);
      // 사람 근처를 지나가면 놀람
      for (const h of G.humans) if (h !== G.player) { const c = h.particles[0].p; const t = Math.max(0, c.clone().sub(origin).dot(dir)); if (t < maxT && origin.clone().addScaledVector(dir, t).distanceTo(c) < 1.5) h.fear = Math.min(1, h.fear + 0.5); }
    } else b.speed = 600;
    this.bullets.push(b);
    if (shrapnel) this.advance(b, 1);
  }
  advance(b, simDt) {
    const G = this.G;
    const prev = b.t;
    b.t = Math.min(b.maxT, b.t + b.speed * simDt);
    while (b.events.length && b.events[0].t <= b.t) {
      const e = b.events.shift();
      if (e.kind === 'wall') { G.fx.hole(e.p, e.n, e.metal ? 'metal' : 'concrete'); G.audio.impact(e.metal ? 'metal' : 'concrete', e.p); }
      else if (e.kind === 'water') { G.fx.waterSplash(e.p, 0.25); }
      else if (e.kind === 'body') {
        const h = e.h, M = h.boneMat(e.part);
        const pa = e.a.clone().applyMatrix4(M), pb = e.b.clone().applyMatrix4(M);
        const dirW = new V().subVectors(pb, pa); if (dirW.lengthSq() < 1e-10) dirW.copy(b.d); dirW.normalize();
        h.hit({ part: e.part, type: b.pellet ? 'pellet' : 'bullet', dmg: e.dmg, point: pa, dir: dirW, chordA: pa, chordB: pb, lodged: !e.exits, organDmg: b.pellet ? 50 : 90, impulse: (b.w.energy * 0.9) * (b.pellet ? 0.5 : 1) });
        if (e.exits) h.hit({ part: e.part, type: 'exit', dmg: 0, point: pb, dir: dirW, exit: true, noImpulse: true, scale: b.w.energy > 2 ? 1.5 : 1 });
        G.audio.impact('flesh', pa);
      }
    }
    if (b.mesh) {
      const p = b.o.clone().addScaledVector(b.d, b.t);
      b.mesh.position.copy(p); b.trail.position.copy(p);
      b.trail.scale.set(1, 1, Math.max(0.05, Math.min(b.t, 2.5)));
      b.mesh.visible = b.trail.visible = true;
    }
    if (b.t >= b.maxT && !b.events.length) return false;
    return true;
  }
  removeBullet(b) {
    if (!b.mesh) return;
    this.G.scene.remove(b.mesh, b.trail); b.trail.geometry.dispose();
    for (const m of [b.mesh, b.trail]) { const k = this.G.xraySwap.findIndex(s => s.mesh === m); if (k >= 0) this.G.xraySwap.splice(k, 1); }
  }

  update(dt, simDt) {
    const G = this.G, pl = G.player;
    this.cd = Math.max(0, this.cd - simDt);
    // 총알
    for (let i = this.bullets.length - 1; i >= 0; i--) { const b = this.bullets[i]; if (!this.advance(b, simDt)) { b.done = (b.done || 0) + simDt; if (!b.mesh || b.done > 0.02) { this.removeBullet(b); this.bullets.splice(i, 1); } } }
    // 근접 무기
    if (this.swing) {
      const s = this.swing; s.t += simDt;
      const w = this.w, mdl = this.models[w.id], f = s.t / s.dur;
      if (w.type === 'melee' && f > 0.3 && f < 0.62) {
        const pts = w.id === 'knife' ? [mdl.tip, mdl.base.clone().lerp(mdl.tip, 0.6)] : mdl.pts;
        for (const h of G.humans) {
          if (h === pl || s.hit.has(h)) continue;
          for (const lp of pts) {
            const p = lp.clone().applyMatrix4(this.wpose);
            const part = this.pointInBody(h, p);
            if (!part) continue;
            s.hit.add(h);
            const dir = new V().subVectors(p, pl.particles[2].p).normalize();
            if (w.id === 'knife') {
              const tipDir = new V(0, 1, 0).transformDirection(this.wpose);
              const swingDir = s.kind ? new V().crossVectors(tipDir, new V(0, 1, 0)).normalize() : tipDir;
              h.hit({ part, type: s.kind ? 'cut' : 'stab', dmg: w.dmg, point: p, dir: s.kind ? swingDir : tipDir, chordA: p, chordB: p.clone().addScaledVector(tipDir, 0.09), noChannel: !!s.kind, organDmg: 70, impulse: 0.6, cutDir: swingDir });
              G.audio.stab(p);
            } else {
              const side = new V(0, 0, 1).transformDirection(this.wpose).negate();
              h.hit({ part, type: 'blunt', dmg: w.dmg, point: p, dir: side.add(dir).normalize(), impulse: 7 });
              G.audio.thud(p, 1.2);
            }
            G.slowmo?.(0.8);
            break;
          }
        }
      }
      if (w.type === 'throw' && !s.thrown && f > 0.5) { s.thrown = true; this.throwGrenade(); }
      if (s.t >= s.dur) this.swing = null;
    }
    // 수류탄
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i]; g.fuse -= simDt;
      g.mesh.position.copy(g.pt.p); g.mesh.rotation.x += simDt * 8;
      if (g.fuse <= 0) { this.explode(g.pt.p.clone()); G.physics.remove(g.grp); G.scene.remove(g.mesh); this.grenades.splice(i, 1); }
    }
  }
  pointInBody(h, p) {
    const inv = new M4();
    for (const [part, a, b, r] of h.caps) {
      inv.copy(h.boneMat(part)).invert(); const q = p.clone().applyMatrix4(inv);
      const ab = _a.subVectors(b, a), t = Math.max(0, Math.min(1, _b.subVectors(q, a).dot(ab) / ab.lengthSq()));
      if (q.distanceTo(_c.copy(a).addScaledVector(ab, t)) < r + 0.01) return part;
    }
    return null;
  }
  throwGrenade() {
    const G = this.G, pl = G.player, s = this.swing;
    const p = this.models.grenade.g.position.clone().setFromMatrixPosition(this.wpose);
    const pt = new Particle(p, 0.04, 0.4); pt.fric = 0.8;
    pt.push(s.dir.clone().multiplyScalar(13).add(new V(0, 3.5, 0)), G.physics.h);
    const grp = { particles: [pt], constraints: [], onImpact: (q, sp) => { if (sp > 2) G.audio.impact('metal', q.p, 0.4); } };
    G.physics.add(grp);
    const mesh = this.models.grenade.g.clone(); mesh.matrixAutoUpdate = true; mesh.visible = true; G.scene.add(mesh);
    this.grenades.push({ pt, grp, mesh, fuse: 2.6 });
    G.audio.whoosh(p, 0.7);
  }
  explode(p) {
    const G = this.G;
    G.fx.explosion(p); G.audio.explosion(p); G.shake(1.2, p); G.noise(p, 40);
    const W = G.world;
    if (W.inPool(p.x, p.z) && p.y < W.water.surface + 0.6) G.fx.waterSplash(p, 3);
    for (const h of G.humans) {
      let worst = null, wd = 1e9;
      h.particles.forEach((q, i) => {
        const d = q.p.distanceTo(p);
        if (d > 8) return;
        // 벽에 가리면 약하게
        const dir = _a.subVectors(q.p, p).normalize();
        let blocked = false; for (const b of W.solids) { const t = rayBox(p, dir, b, null); if (t >= 0 && t < d - 0.1) { blocked = true; break; } }
        const k = (blocked ? 0.2 : 1) * 22 / (d * d + 0.6);
        q.push(dir.clone().multiplyScalar(Math.min(26, k)).add(new V(0, Math.min(8, k * 0.4), 0)), G.physics.h);
        if (d < wd && !blocked) { wd = d; worst = i; }
      });
      if (worst != null && wd < 6) {
        const parts = new Set();
        h.particles.forEach((q, i) => { const d = q.p.distanceTo(p); if (d < 4.5) parts.add(i); });
        for (const i of parts) {
          const q = h.particles[i], d = q.p.distanceTo(p), part = ['head', 'neck', 'chest', 'belly', 'pelvis', 'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'][i];
          const dmg = 140 / (1 + d * d * 1.5);
          if (dmg < 4) continue;
          const dir = _a.subVectors(q.p, p).normalize().clone();
          h.hit({ part, type: d < 1.5 ? 'blast' : 'burn', dmg: dmg * 0.6, point: q.p.clone().addScaledVector(dir, -q.r), dir, noImpulse: true, organDmg: dmg });
        }
        h.knock(4); h.stun = Math.max(h.stun, wd < 2 ? 2 : 0);
      }
    }
    // 파편
    for (let i = 0; i < 40; i++) { const d = new V(Math.random() - 0.5, Math.random() * 0.7 - 0.15, Math.random() - 0.5).normalize(); this.shoot(p.clone().addScaledVector(d, 0.05), d, { dmg: 14, energy: 0.45, speed: 600 }, true, true); }
    for (const g of G.fx.gibs) for (const q of g.particles) { const d = q.p.distanceTo(p); if (d < 6) q.push(_a.subVectors(q.p, p).normalize().multiplyScalar(30 / (d * d + 1)), G.physics.h); }
  }
}
