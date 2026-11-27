// 플레이어: 1인칭 이동/계단/수영, 체력·기력·배고픔·갈증(굶어 죽지 않음), 감정(공포·스트레스·희망), 무기, 손전등, 차량
import * as THREE from 'three';
import { clamp, damp, lerp, MB } from './util.js';
import { ITEMS, RARITY } from './items.js';
import { buildFPArm, humanMat } from './human.js';
import { terrainH } from './korea.js';

export const WEAPONS = {
  fists: { name: '맨손', slot: 1, melee: true, dmg: 12, range: 1.3, rate: 0.5, stam: 5, arc: 0.7 },
  knife: { name: '식칼', slot: 2, melee: true, dmg: 30, range: 1.45, rate: 0.42, stam: 7, arc: 0.55 },
  bat: { name: '야구방망이', slot: 3, melee: true, dmg: 44, range: 2.0, rate: 0.72, stam: 13, arc: 0.85, heavy: true },
  pipe: { name: '쇠파이프', slot: 3, melee: true, dmg: 50, range: 2.0, rate: 0.85, stam: 15, arc: 0.85, heavy: true },
  golf: { name: '골프채', slot: 3, melee: true, dmg: 36, range: 2.1, rate: 0.62, stam: 10, arc: 0.8 },
  crowbar: { name: '빠루', slot: 3, melee: true, dmg: 52, range: 1.7, rate: 0.8, stam: 14, arc: 0.7, heavy: true },
  baton: { name: '경찰봉', slot: 2, melee: true, dmg: 30, range: 1.6, rate: 0.45, stam: 7, arc: 0.7 },
  axe: { name: '소방도끼', slot: 3, melee: true, dmg: 75, range: 1.9, rate: 1.0, stam: 19, arc: 0.75, heavy: true },
  shotgun: { name: '산탄총', slot: 6, gun: true, dmg: 17, pellets: 9, mag: 6, rate: 0.85, spread: 0.075, recoil: 0.09, noise: 210, kind: 'shotgun', reload: 3.0 },
  pistol: { name: '권총', slot: 4, gun: true, dmg: 36, mag: 15, rate: 0.2, spread: 0.012, recoil: 0.035, noise: 130, kind: 'pistol', reload: 1.6 },
  rifle: { name: '소총', slot: 5, gun: true, dmg: 45, mag: 30, rate: 0.1, spread: 0.007, recoil: 0.02, noise: 190, kind: 'rifle', auto: true, reload: 2.2 }
};
const MONO = {
  fear: ['심장이 터질 것 같아…', '침착해… 침착하자.', '저것들이… 가까이 있어.'],
  panic: ['안 돼, 안 돼, 안 돼…!', '숨을 쉬어… 제발…', '여기서 죽을 순 없어!'],
  hunger: ['배고파… 뭐라도 먹어야 해.', '배가 너무 고파서 힘이 안 들어가.'],
  thirst: ['목이 타들어가… 물이 필요해.', '목말라…'],
  hurt: ['피가… 멈추질 않아.', '윽… 이대로는 위험해.'],
  night: ['밤이 됐어… 놈들이 더 날뛸 거야.', '어두워지니까 더 무섭다…'],
  firstKill: ['내가… 사람을… 아니야, 저건 이제 사람이 아니야.'],
  kills: ['익숙해지면 안 되는데…', '도대체 얼마나 많은 거야…'],
  hope: ['그래… 아직 살아 있어. 할 수 있어.', '조금만 더 버티자.'],
  calm: ['조용하다… 잠깐 숨 좀 돌리자.']
};

export class Player {
  constructor(game) {
    this.game = game; this.camera = game.camera;
    this.c = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), r: 0.32, h: 1.75, step: 0.5, onGround: true };
    this.pos = this.c.pos; this.yaw = 0; this.pitch = 0; this.eyeY = 1.62; this.eyeSmooth = 0;
    this.hp = 100; this.st = 100; this.food = 82; this.water = 75; this.fear = 10; this.stress = 15; this.hope = 40;
    this.inv = {}; this.owned = new Set(['fists']); this.ammo = { pistol: 0, rifle: 0, shotgun: 0 }; this.mag = { pistol: 0, rifle: 0, shotgun: 0 }; this.bag = null; this.armor = { head: null, body: null }; this.batt = 100; this.stBoost = 0;
    this.weapon = 'fists'; this.hasFlash = false; this.flashOn = false; this.crouch = false; this.vehicle = null; this.dead = false;
    this.enabled = false; this.keys = {}; this.mouse = { l: false, r: false }; this.cool = 0; this.reloadT = 0; this.swingT = 0; this.switchT = 0;
    this.trauma = 0; this.bob = 0; this.stepAcc = 0; this.stRegenT = 0; this.monoT = 20; this.emo = '평온'; this.kills = 0; this.heartT = 0; this.breathT = 0;
    this.aimK = 0; this.recoil = 0; this.sway = new THREE.Vector2(); this.lastHurt = 0; this.interHold = 0; this.interTarget = null; this.indoor = 0; this.flags = {};
    this.makeView(); this.view.visible = false;
    this.flash = new THREE.SpotLight(0xfff4e0, 0, 45, 0.42, 0.45, 1.4); this.flash.position.set(0.25, -0.15, 0); this.camera.add(this.flash); this.flash.target.position.set(0.1, -0.1, -5); this.camera.add(this.flash.target);
    this.muzzleL = new THREE.PointLight(0xffc070, 0, 12, 2); this.camera.add(this.muzzleL);
  }
  forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  lookDir() { return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion); }
  // ---------- 뷰모델 ----------
  makeView() {
    const v = this.view = new THREE.Group(); this.camera.add(v);
    const ag = buildFPArm(); ag.translate(0, 0, 0.6); const agL = ag.clone(); agL.scale(-1, 1, 1); const ix = agL.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; } agL.computeVertexNormals();
    const arm = (g) => { const m = new THREE.Mesh(g, humanMat(false)); const gr = new THREE.Group(); gr.add(m); return gr; };
    this.armR = arm(ag); this.armL = arm(agL); v.add(this.armR, this.armL);
    const M = (c, m = 0.3, r = 0.5) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r });
    const W = this.wm = {};
    W.bat = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.016, 0.84, 12).translate(0, 0.42, 0), M(0x9a6a3a, 0, 0.45));
    W.pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 10).translate(0, 0.42, 0), M(0x777777, 0.8, 0.35));
    W.knife = new THREE.Group(); W.knife.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.025).translate(0, 0.02, 0), M(0x222222, 0, 0.6))); W.knife.add(new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.2, 0.04).translate(0, 0.18, 0.005), M(0xdddddd, 0.9, 0.15)));
    const gun = (len, col) => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, len).translate(0, 0.02, -len / 2), M(col, 0.7, 0.35))); g.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.04).rotateX(-0.25).translate(0, -0.04, -0.02), M(0x1a1a1a, 0.2, 0.7))); return g; };
    W.pistol = gun(0.19, 0x202224); W.rifle = gun(0.75, 0x2a2c2a); W.rifle.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.05).translate(0, -0.06, -0.3), M(0x111111))); W.rifle.add(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.25).translate(0, -0.01, 0.12), M(0x1d1f1d)));
    W.golf = new THREE.Group(); W.golf.add(new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 1.0, 8).translate(0, 0.5, 0), M(0xbbbbbb, 0.9, 0.2)), new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.11).translate(0, 1.0, 0.04), M(0x333333, 0.9, 0.25)), new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.25, 8).translate(0, 0.12, 0), M(0x111111, 0, 0.8)));
    W.crowbar = new THREE.Group(); W.crowbar.add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 8).translate(0, 0.4, 0), M(0x8a1a1a, 0.6, 0.4)), new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.1).translate(0, 0.8, 0.04), M(0x8a1a1a, 0.6, 0.4)));
    W.baton = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.6, 10).translate(0, 0.3, 0), M(0x111111, 0.2, 0.5));
    W.axe = new THREE.Group(); W.axe.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.9, 8).translate(0, 0.45, 0), M(0x6a3a1a, 0, 0.6)), new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.22).translate(0, 0.84, 0.08), M(0xb81c1c, 0.5, 0.4)), new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.13, 0.06).translate(0, 0.84, 0.2), M(0xcccccc, 0.9, 0.2)));
    W.shotgun = gun(0.72, 0x1e1e1e); W.shotgun.add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.6, 10).rotateX(Math.PI / 2).translate(0, 0.0, -0.45), M(0x202020, 0.8, 0.3)), new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.18).translate(0, -0.02, -0.42), M(0x4a3020, 0, 0.6)), new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.08, 0.28).translate(0, -0.02, 0.14), M(0x5a3a22, 0, 0.6)));
    W.flash = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.18, 10).rotateX(Math.PI / 2), M(0x222222, 0.6, 0.4));
    for (const k in W) { W[k].visible = false; v.add(W[k]); W[k].traverse(o => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } }); }
    v.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    this.phoneHeld = null;
  }
  updateView(dt) {
    const v = this.view, W = this.wm, w = WEAPONS[this.weapon], t = this.game.time;
    v.visible = this.enabled && !this.vehicle && !this.dead;
    const bobA = this.moveK * (this.sprinting ? 0.022 : 0.012), bx = Math.sin(this.bob) * bobA, by = -Math.abs(Math.cos(this.bob)) * bobA;
    const tremor = (this.fear / 100) * 0.004;
    const sx = this.sway.x * 0.02 + bx + Math.sin(t * 23) * tremor, sy = this.sway.y * 0.02 + by + Math.cos(t * 19) * tremor;
    const sw = this.switchT > 0 ? -0.3 * Math.sin(Math.PI * this.switchT / 0.4) : 0, rl = this.reloadT > 0 ? Math.sin(Math.PI * clamp(1 - this.reloadT / w.reload, 0, 1)) : 0;
    for (const k in W) W[k].visible = false;
    const aR = this.armR, aL = this.armL; aL.visible = aR.visible = true;
    if (w.melee) {
      const s = this.swingT > 0 ? 1 - this.swingT / w.rate : 0, sk = Math.sin(s * Math.PI), ph = s < 0.35 ? s / 0.35 : 1 - (s - 0.35) / 0.65;
      aR.position.set(0.24 + sx - ph * 0.3, -0.26 + sy + sw + ph * 0.08, -0.38 - sk * 0.2); aR.rotation.set(-0.2 - ph * 0.6, 0.2 + ph * 1.4, ph * 0.8);
      if (this.weapon !== 'fists') { const m = W[this.weapon]; m.visible = true; m.position.copy(aR.position).add(new THREE.Vector3(0, 0.02, -0.04)); if (this.weapon === 'knife') m.rotation.set(-1.2 - ph * 0.6, ph * 1.2, 0.2); else { m.position.x += 0.05; m.rotation.set(0.55 - ph * 2.0, ph * 0.6, -0.35 + ph * 1.5, 'YXZ'); } }
      if (this.flashOn) { aL.position.set(-0.22 + sx, -0.25 + sy + sw, -0.4); aL.rotation.set(-0.05, 0, 0); W.flash.visible = true; W.flash.position.set(-0.22 + sx, -0.22 + sy + sw, -0.5); W.flash.rotation.set(0, 0, 0); }
      else { aL.position.set(-0.24 + sx, -0.34 + sy + sw, -0.36); aL.rotation.set(-0.3, -0.3, 0); }
      if (this.weapon === 'fists') { aR.position.y -= 0.05; aR.position.z -= 0.04; aL.position.set(-0.2 + sx, -0.3 + sy + sw - (s > 0 && this.punchL ? -0.1 * sk : 0), -0.42 - (this.punchL ? sk * 0.25 : 0)); }
    } else {
      const m = W[this.weapon], ad = this.aimK, rec = this.recoil;
      const gp = new THREE.Vector3(lerp(0.17, 0.0, ad) + sx * (1 - ad * 0.7), lerp(-0.2, -0.13, ad) + sy * (1 - ad * 0.7) + sw - rl * 0.15 + rec * 0.02, lerp(-0.42, -0.34, ad) + rec * 0.06);
      m.visible = true; m.position.copy(gp); m.rotation.set(rec * 0.25 + rl * 0.6, 0, rl * 0.5);
      aR.position.copy(gp).add(new THREE.Vector3(0.01, -0.07, 0.12)); aR.rotation.set(0.2, 0, 0);
      aL.position.copy(gp).add(new THREE.Vector3(-0.05, -0.06, this.weapon !== 'pistol' ? -0.3 : -0.02)); aL.rotation.set(0.1, 0.3, 0);
      this.muzzle = gp.clone().add(new THREE.Vector3(0, 0.03, this.weapon !== 'pistol' ? -0.78 : -0.22));
    }
    this.recoil = damp(this.recoil, 0, 12, dt);
  }
  // ---------- 인벤토리 ----------
  weight() {
    let w = 0; for (const k in this.inv) w += (ITEMS[k]?.w || 0) * this.inv[k];
    for (const k of this.owned) if (ITEMS[k]) w += ITEMS[k].w;
    w += this.ammo.pistol * 0.0125 + this.ammo.rifle * 0.0133 + this.ammo.shotgun * 0.05;
    for (const a of Object.values(this.armor)) if (a) w += ITEMS[a.type].w;
    return w;
  }
  capacity() { return 15 + (this.bag ? ITEMS[this.bag].cap : 0); }
  canCarry(type, n) { const d = ITEMS[type]; if (!d) return 0; if (d.kind === 'bag' || (d.kind === 'weapon' && this.owned.has(d.weapon) && !WEAPONS[d.weapon].gun)) return n; const w = d.kind === 'ammo' ? d.w : d.w; if (w <= 0) return n; return Math.max(0, Math.min(n, Math.floor((this.capacity() - this.weight()) / w + 1e-6))); }
  give(type, n = 1, silent) {
    const d = ITEMS[type]; if (!d) return false;
    if (!silent && this.canCarry(type, n) < n) { this.game.ui.notify('가방이 꽉 찼다 (무게 초과) — 가방을 비우거나 더 큰 가방을 찾자'); return false; }
    if (d.kind === 'weapon') {
      const had = this.owned.has(d.weapon); this.owned.add(d.weapon);
      if (WEAPONS[d.weapon].gun && !had) this.mag[d.weapon] = WEAPONS[d.weapon].mag; else if (WEAPONS[d.weapon].gun) this.ammo[d.weapon] += Math.round(WEAPONS[d.weapon].mag * 0.6);
      if (!had) this.equip(d.weapon);
    } else if (d.kind === 'ammo') this.ammo[d.weapon] += d.count * n;
    else if (d.kind === 'bag') { if (!this.bag || ITEMS[this.bag].cap < d.cap) { this.bag = type; this.game.ui.notify(`가방 교체: ${d.name}`); } }
    else if (d.kind === 'armor') { const cur = this.armor[d.slot]; if (!cur || ITEMS[cur.type].def < d.def) { if (cur) this.inv[cur.type] = (this.inv[cur.type] || 0) + 1; this.armor[d.slot] = { type, dur: d.dur }; this.game.ui.notify(`착용: ${d.name}`); } else this.inv[type] = (this.inv[type] || 0) + n; }
    else if (type === 'flashlight') this.hasFlash = true;
    else this.inv[type] = (this.inv[type] || 0) + n;
    if (!silent) { this.game.ui.notify(`획득: ${d.name}${n > 1 ? ' ×' + n : ''}`, RARITY[d.r || 'c'][1]); this.hope = clamp(this.hope + (d.r === 'e' || d.r === 'l' ? 4 : 0.8), 0, 100); }
    this.game.emit('give', type); return true;
  }
  use(type) {
    const d = ITEMS[type]; if (!d || !this.inv[type]) return false;
    const g = this.game;
    if (d.kind === 'food') { this.food = clamp(this.food + d.val, 0, 100); g.audio.play('eat'); this.stress -= 3; }
    else if (d.kind === 'drink') { this.water = clamp(this.water + d.val, 0, 100); g.audio.play('drink'); if (d.st) { this.st = Math.min(this.capSt(), this.st + d.st); this.stBoost = d.st >= 100 ? 40 : 0; } }
    else if (d.kind === 'heal') { if (this.hp >= 100 && !d.stress) return false; this.hp = clamp(this.hp + d.val, 0, 100); g.audio.play('rummage'); }
    else if (d.kind === 'armor') { const cur = this.armor[d.slot]; this.armor[d.slot] = { type, dur: d.dur }; if (cur) this.inv[cur.type] = (this.inv[cur.type] || 0) + 1; g.ui.notify(`착용: ${d.name}`); }
    else if (type === 'battery') { if (!this.hasFlash) return false; this.batt = Math.min(100, this.batt + 60); g.audio.play('click'); }
    else if (d.use) g.audio.play('rummage');
    else return false;
    if (d.stress) this.stress = clamp(this.stress + d.stress, 0, 100); if (d.hope) this.hopeAdd(d.hope);
    this.inv[type]--; if (!this.inv[type]) delete this.inv[type];
    g.ui.notify(`사용: ${d.name}`); return true;
  }
  drop(type) { if (!this.inv[type]) return; this.inv[type]--; if (!this.inv[type]) delete this.inv[type]; this.game.ui.notify(`버림: ${ITEMS[type].name}`); }
  capSt() { return this.food < 15 || this.water < 15 ? 55 : 100; }
  quickUse(kind) {
    const order = { heal: ['bandage', 'medkit', 'pills'], food: ['bar', 'kimbap', 'ramen', 'rice', 'can', 'choco', 'mre'], drink: ['water', 'juice', 'coffee', 'energy', 'soju'] }[kind];
    for (const t of order) if (this.inv[t] && this.use(t)) return;
    this.game.ui.notify(kind === 'heal' ? '치료 도구가 없다' : kind === 'food' ? '먹을 것이 없다' : '마실 것이 없다');
  }
  hopeAdd(v) { this.hope = clamp(this.hope + v, 0, 100); }
  equip(w) { if (!this.owned.has(w) || this.weapon === w) return; this.weapon = w; this.switchT = 0.4; this.reloadT = 0; this.game.audio.play('click'); }
  // ---------- 입력 ----------
  key(code, down) {
    this.keys[code] = down; if (!down || !this.enabled || this.dead) return;
    const g = this.game;
    if (this.vehicle) { if (code === 'KeyE') this.exitVehicle(); return; }
    if (code.startsWith('Digit')) { const n = +code.slice(5), w = Object.keys(WEAPONS).filter(k => WEAPONS[k].slot === n && this.owned.has(k)); if (w.length) this.equip(w.includes(this.weapon) && w.length > 1 ? w[(w.indexOf(this.weapon) + 1) % w.length] : w[0]); }
    if (code === 'KeyF') { if (this.hasFlash) { this.flashOn = !this.flashOn; g.audio.play('click'); } else g.ui.notify('손전등이 없다'); }
    if (code === 'KeyC') this.crouch = !this.crouch;
    if (code === 'KeyR') this.reload();
    if (code === 'KeyH') this.quickUse('heal'); if (code === 'KeyX') this.quickUse('food'); if (code === 'KeyZ') this.quickUse('drink');
    if (code === 'Space' && this.c.onGround && this.st > 8) { this.c.vel.y = 4.4; this.st -= 8; this.c.onGround = false; }
  }
  look(dx, dy) { const s = 0.0022 * this.game.settings.sens * (this.aimK > 0.5 ? 0.6 : 1); this.yaw -= dx * s; this.pitch = clamp(this.pitch - dy * s, -1.45, 1.45); this.sway.x = clamp(this.sway.x - dx * 0.002, -1, 1); this.sway.y = clamp(this.sway.y + dy * 0.002, -1, 1); }
  reload() { const w = WEAPONS[this.weapon]; if (!w.gun || this.reloadT > 0 || this.mag[this.weapon] >= w.mag || this.ammo[this.weapon] <= 0) return; this.reloadT = w.reload; this.game.audio.play('reload'); }
  attack() {
    const g = this.game, w = WEAPONS[this.weapon];
    if (this.cool > 0 || this.switchT > 0 || this.reloadT > 0) return;
    const eye = this.camera.getWorldPosition(new THREE.Vector3()), dir = this.lookDir();
    if (w.melee) {
      if (this.st < w.stam * 0.5) return;
      this.st -= w.stam; this.cool = w.rate; this.swingT = w.rate; this.punchL = !this.punchL; g.audio.play('swing'); g.zombies.noise(this.pos, 8);
      setTimeout(() => {
        const hits = g.zombies.melee(eye, dir, w.range, w.arc);
        if (hits.length) { const h = hits[0]; const r = h.z.hit(w.dmg * (0.85 + Math.random() * 0.3), h.part, new THREE.Vector3(dir.x, 0, dir.z).normalize(), 'melee', !!w.heavy); this.shake(w.heavy ? 0.25 : 0.15); if (r) g.ui.hitmarker(r); if (w.heavy) g.audio.play('click', { vol: 0.3 }); }
      }, w.rate * 300);
      return;
    }
    if (this.mag[this.weapon] <= 0) { g.audio.play('dryfire'); this.cool = 0.3; if (this.ammo[this.weapon] > 0) this.reload(); return; }
    this.mag[this.weapon]--; this.cool = w.rate;
    const sp = w.spread * (1 - this.aimK * 0.75) * (1 + this.fear / 80) * (this.moveK > 0.3 ? 1.8 : 1);
    const base = dir.clone(); let best = null;
    for (let p = 0; p < (w.pellets || 1); p++) {
      const d = base.clone(); d.x += (Math.random() - 0.5) * sp; d.y += (Math.random() - 0.5) * sp; d.z += (Math.random() - 0.5) * sp; d.normalize();
      const wallT = g.col.ray(eye.x, eye.y, eye.z, d.x, d.y, d.z, 250, b => !b.glass);
      const hit = g.zombies.raycast(eye, d, Math.min(250, wallT));
      if (hit) { const r = hit.z.hit(w.dmg * (0.9 + Math.random() * 0.2) * (w.pellets && hit.t > 15 ? 0.5 : 1), hit.part, d, 'gun'); if (r && (!best || r.kill || r.head)) best = r; }
      else if (wallT < 250) g.fx.impact(eye.clone().addScaledVector(d, wallT - 0.03));
    }
    if (best) g.ui.hitmarker(best);
    g.audio.play('gunshot', { kind: w.kind, vol: 1.2 });
    g.zombies.noise(this.pos, w.noise);
    this.recoil = 1; this.pitch += w.recoil * (1 - this.aimK * 0.4); this.yaw += (Math.random() - 0.5) * w.recoil * 0.4; this.shake(0.1);
    this.muzzleL.intensity = 30; this.muzzleL.position.copy(this.muzzle || new THREE.Vector3(0.1, -0.1, -0.6)); setTimeout(() => this.muzzleL.intensity = 0, 45);
    g.fx.muzzle(this.camera.localToWorld((this.muzzle || new THREE.Vector3(0.1, -0.1, -0.6)).clone()));
    this.stress = clamp(this.stress + 0.4, 0, 100);
  }
  shake(a) { this.trauma = Math.min(1, this.trauma + a); }
  damage(d, src, from) {
    if (this.dead || this.game.godMode) return;
    if (src === 'zombie') { let red = 0; for (const sl of ['body', 'head']) { const a = this.armor[sl]; if (!a) continue; const def = ITEMS[a.type].def * (sl === 'head' ? 0.6 : 1); red += def; a.dur -= d * 0.6; if (a.dur <= 0) { this.game.ui.notify(`${ITEMS[a.type].name} 파손!`); this.armor[sl] = null; } } d *= 1 - Math.min(0.6, red); }
    this.hp -= d; this.fear = clamp(this.fear + d * 1.6, 0, 100); this.stress = clamp(this.stress + d * 0.5, 0, 100); this.shake(0.5); this.lastHurt = this.game.time;
    this.game.audio.play('hurt'); this.game.ui.hurt(clamp(d / 25, 0.3, 1));
    if (from && from.pos) { const dx = this.pos.x - from.pos.x, dz = this.pos.z - from.pos.z, l = Math.hypot(dx, dz) || 1; this.c.vel.x += dx / l * 2.5; this.c.vel.z += dz / l * 2.5; }
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.game.onDeath(src); }
  }
  enterVehicle(v) { this.vehicle = v; v.driving = true; v.box.on = false; this.flashOn = false; this.engine = this.game.audio.loop('engine', { pos: v.pos, vol: 0.7, inside: true }); this.camYaw = 0; this.game.audio.play('doorOpen', { pos: v.pos }); }
  exitVehicle() {
    const v = this.vehicle; if (!v) return; if (Math.abs(v.speed) > 4) { this.game.ui.notify('속도를 줄여야 내릴 수 있다'); return; }
    const f = v.forward(), side = new THREE.Vector3(f.z, 0, -f.x);
    for (const s of [1.8, -1.8, 3.5]) { const p = v.pos.clone().addScaledVector(side, s); const gy = this.game.col.groundAt(p.x, p.z, v.pos.y + 1.5, 1.5, 0.3); this.pos.set(p.x, gy, p.z); break; }
    v.driving = false; v.placeBox(); this.vehicle = null; if (this.engine) { this.engine.stop(); this.engine = null; } this.yaw = Math.atan2(-f.x, -f.z);
  }
  // ---------- 매 프레임 ----------
  update(dt) {
    const g = this.game, K = this.keys;
    if (this.dead) return;
    this.cool -= dt; this.swingT = Math.max(0, this.swingT - dt); this.switchT = Math.max(0, this.switchT - dt);
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { const w = WEAPONS[this.weapon], need = w.mag - this.mag[this.weapon], n = Math.min(need, this.ammo[this.weapon]); this.mag[this.weapon] += n; this.ammo[this.weapon] -= n; } }
    if (this.vehicle) { this.driveUpdate(dt); this.needs(dt); this.emotions(dt); return; }
    // 이동
    const ctl = this.enabled;
    const fw = (ctl && K.KeyW ? 1 : 0) - (ctl && K.KeyS ? 1 : 0), st = (ctl && K.KeyD ? 1 : 0) - (ctl && K.KeyA ? 1 : 0);
    const lowNeeds = this.food < 15 || this.water < 15, stMax = lowNeeds ? 55 : 100;
    this.sprinting = ctl && (K.ShiftLeft || K.ShiftRight) && fw > 0 && this.st > 3 && !this.crouch;
    if (this.sprinting) this.crouch = false;
    const inWater = terrainH(this.pos.x, this.pos.z) < -1.0 && this.pos.y < -0.6;
    const spd = (this.sprinting ? 6.0 : this.crouch ? 1.4 : 3.0) * (inWater ? 0.45 : 1) * (this.hp < 25 ? 0.8 : 1) * (this.aimK > 0.5 ? 0.6 : 1);
    const f = this.forward(), r = new THREE.Vector3(-f.z, 0, f.x);
    let mx = f.x * fw + r.x * st, mz = f.z * fw + r.z * st; const ml = Math.hypot(mx, mz); if (ml > 0) { mx /= ml; mz /= ml; }
    const acc = this.c.onGround ? 12 : 2;
    this.c.vel.x = damp(this.c.vel.x, mx * spd, acc, dt); this.c.vel.z = damp(this.c.vel.z, mz * spd, acc, dt);
    this.c.h = this.crouch ? 1.1 : 1.75;
    const oy = this.pos.y;
    g.col.move(this.c, dt, inWater ? 4 : 22);
    if (inWater && this.pos.y < -1.15) { this.pos.y = -1.15; this.c.vel.y = Math.max(0, this.c.vel.y); this.c.onGround = true; }
    const hs = Math.hypot(this.c.vel.x, this.c.vel.z); this.moveK = clamp(hs / 3, 0, 1.5);
    // 기력
    if (this.sprinting && hs > 1) { this.st -= 13 * dt; this.stRegenT = 1.2; } else { this.stRegenT -= dt; if (this.stRegenT < 0) this.st += (lowNeeds ? 6 : 15) * dt * (1 + this.hope / 200); }
    this.st = clamp(this.st, 0, stMax);
    // 발소리
    if (this.c.onGround && hs > 0.5) {
      this.bob += hs * dt * 2.1; this.stepAcc += hs * dt;
      const stride = this.sprinting ? 1.6 : this.crouch ? 0.7 : 1.05;
      if (this.stepAcc > stride) { this.stepAcc = 0; g.audio.play('step', { surf: inWater ? 'water' : this.surface(), vol: this.sprinting ? 0.6 : this.crouch ? 0.12 : 0.35 }); g.zombies.noise(this.pos, this.sprinting ? 14 : this.crouch ? 1.5 : 5); }
    }
    if (!this.wasGround && this.c.onGround && oy - this.pos.y < 0.01 && this.fallV < -6) { this.shake(0.25); g.audio.play('step', { surf: this.surface(), vol: 0.8 }); if (this.fallV < -12) this.damage((-this.fallV - 12) * 6, 'fall'); }
    this.fallV = this.c.vel.y; this.wasGround = this.c.onGround;
    // 조준/공격
    this.aimK = damp(this.aimK, ctl && this.mouse.r && WEAPONS[this.weapon].gun ? 1 : 0, 14, dt);
    if (ctl && this.mouse.l && (WEAPONS[this.weapon].auto || !this.fired)) { this.attack(); this.fired = true; }
    if (!this.mouse.l) this.fired = false;
    if (this.flashOn) { this.batt = Math.max(0, this.batt - dt * 0.25); if (this.batt <= 0) { this.flashOn = false; this.game.ui.notify('손전등 배터리가 다 됐다 (건전지 필요)'); } }
    this.flash.intensity = this.flashOn ? 55 * (this.batt < 15 ? 0.3 + 0.7 * Math.random() * (this.batt / 15) : 1) : 0;
    if (this.stBoost > 0) { this.stBoost -= dt; this.st = Math.min(this.capSt(), this.st + dt * 10); }
    this.needs(dt); this.emotions(dt); this.interact(dt);
    if (!this.game.intro.active) this.camUpdate(dt);
  }
  surface() {
    const h = this.game.home; if (h && h.inUnit(this.pos)) { const lx = this.pos.x - 30, lz = this.pos.z - 50; return lx < 3.94 && lz < 3.44 ? 'tile' : 'wood'; }
    const u = this.game.world.urbanAt(this.pos.x, this.pos.z); return u > 0.3 ? 'concrete' : 'grass';
  }
  camUpdate(dt) {
    const cam = this.camera, t = this.game.time;
    const eye = this.crouch ? 1.05 : 1.62;
    this.eyeY = damp(this.eyeY, eye, 10, dt);
    const targetY = this.pos.y + this.eyeY;
    this.eyeSmooth = this.eyeSmooth ? damp(this.eyeSmooth, targetY, 18, dt) : targetY;
    if (Math.abs(this.eyeSmooth - targetY) > 1.2) this.eyeSmooth = targetY;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const sh = this.trauma * this.trauma + (this.fear > 75 ? 0.02 : 0), bobY = Math.cos(this.bob * 2) * 0.035 * this.moveK, bobX = Math.sin(this.bob) * 0.025 * this.moveK;
    const swayA = 0.0015 + this.fear * 0.00006 * (1 - this.aimK * 0.5);
    cam.position.set(this.pos.x + bobX * Math.cos(this.yaw), this.eyeSmooth + bobY, this.pos.z - bobX * Math.sin(this.yaw));
    cam.rotation.set(this.pitch + Math.sin(t * 1.3) * swayA + (Math.random() - 0.5) * sh * 0.08, this.yaw + Math.cos(t * 0.9) * swayA + (Math.random() - 0.5) * sh * 0.08, (Math.random() - 0.5) * sh * 0.05 + bobX * 0.3, 'YXZ');
    const fov = this.game.settings.fov * (1 - this.aimK * (this.weapon === 'rifle' ? 0.35 : 0.2)) + (this.sprinting ? 4 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = damp(cam.fov, fov, 10, dt); cam.updateProjectionMatrix(); }
    this.sway.multiplyScalar(Math.exp(-dt * 8));
    this.updateView(dt);
  }
  driveUpdate(dt) {
    const v = this.vehicle, K = this.keys, cam = this.camera;
    v.update(dt, { f: K.KeyW, b: K.KeyS, l: K.KeyA, r: K.KeyD, brake: K.Space });
    this.pos.copy(v.pos);
    if (this.engine) { this.engine.pos(v.pos); this.engine.rpm(clamp(Math.abs(v.speed) / 30, 0, 1) + (K.KeyW ? 0.15 : 0)); }
    g_noise(this.game, v.pos, 35 + Math.abs(v.speed) * 2);
    // 추적 카메라
    const yaw = v.yaw + Math.PI + this.camYaw, dist = 7.5, h = 2.8;
    const tp = new THREE.Vector3(v.pos.x + Math.sin(yaw) * dist, v.pos.y + h, v.pos.z + Math.cos(yaw) * dist);
    cam.position.lerp(tp, 1 - Math.exp(-dt * 6)); cam.position.y = Math.max(cam.position.y, terrainH(cam.position.x, cam.position.z) + 0.6);
    cam.lookAt(v.pos.x, v.pos.y + 1.2, v.pos.z);
    this.camYaw = damp(this.camYaw, 0, 1.5, dt);
    this.flash.intensity = this.game.night > 0.3 ? 70 : 0;
    this.moveK = 0; this.updateView(dt);
    if (cam.fov !== this.game.settings.fov) { cam.fov = this.game.settings.fov; cam.updateProjectionMatrix(); }
  }
  needs(dt) {
    const g = this.game, m = dt / 60; // 게임 분
    this.food = clamp(this.food - m * (100 / (36 * 60)) * 60 * (this.sprinting ? 1.6 : 1), 0, 100);
    this.water = clamp(this.water - m * (100 / (24 * 60)) * 60 * (this.sprinting ? 1.8 : 1), 0, 100);
    // 굶어 죽지는 않는다: 0 이 되면 스트레스만 상승
    if (this.food < 10) this.stress = clamp(this.stress + dt * 0.3, 0, 100);
    if (this.water < 10) this.stress = clamp(this.stress + dt * 0.4, 0, 100);
    if (this.hp < 100 && this.food > 40 && this.water > 40 && g.time - this.lastHurt > 12) this.hp = clamp(this.hp + dt * 0.15, 0, 100);
  }
  emotions(dt) {
    const g = this.game; let near = 0, chase = 0;
    for (const z of g.zombies.list) { if (z.dead) continue; const d = z.pos.distanceTo(this.pos); if (d < 22) near += (22 - d) / 22; if (z.state === 'chase' && d < 40) chase++; }
    const dark = g.night * (this.indoor > 0.5 ? 0.2 : 1) * (this.flashOn ? 0.4 : 1);
    const target = clamp(near * 25 + chase * 12 + dark * 18 + (this.hp < 40 ? 20 : 0) + this.stress * 0.15, 0, 100);
    this.fear = damp(this.fear, Math.max(target, this.fear - 0.0001), target > this.fear ? 1.2 : 0.12, dt);
    const calm = near < 0.1 && chase === 0;
    this.stress = clamp(this.stress + (chase ? 0.5 : 0) * dt - (calm ? 0.12 : 0) * dt * (this.indoor > 0.5 ? 2 : 1), 0, 100);
    this.hope = clamp(this.hope - (this.stress > 70 ? 0.05 : 0) * dt + (calm && this.indoor > 0.5 ? 0.02 : 0) * dt, 0, 100);
    const lbl = this.fear > 78 ? '공황' : this.fear > 50 ? '공포' : this.fear > 28 ? '불안' : this.stress > 65 ? '지침' : this.hope > 65 ? '희망' : '평온';
    if (lbl !== this.emo) { const prev = this.emo; this.emo = lbl; if (lbl === '공황') this.mono('panic'); else if (lbl === '공포' && prev !== '공황') this.mono('fear'); else if (lbl === '희망') this.mono('hope'); else if (lbl === '평온' && prev !== '평온' && Math.random() < 0.3) this.mono('calm'); }
    this.monoT -= dt;
    if (this.monoT < 0) { if (this.food < 15) this.mono('hunger'); else if (this.water < 15) this.mono('thirst'); else if (this.hp < 30) this.mono('hurt'); }
    // 심장박동 / 숨소리
    if (this.fear > 32 || this.hp < 30) { this.heartT -= dt; if (this.heartT < 0) { this.heartT = 60 / (62 + this.fear * 0.95); g.audio.play('heartbeat', { vol: 0.15 + this.fear / 160 }); } }
    if (this.st < 35 || this.fear > 65) { this.breathT -= dt; if (this.breathT < 0) { this.breathT = 0.7 + this.st / 80; this.breathEx = !this.breathEx; g.audio.play('breath', { vol: 0.12 + (1 - this.st / 100) * 0.15, ex: this.breathEx }); } }
  }
  mono(kind, force) {
    if (!force && (this.monoT > 0 || !this.enabled)) return; const L = MONO[kind]; if (!L) return;
    this.monoT = 28 + Math.random() * 20; this.game.voice.say(L[Math.floor(Math.random() * L.length)], 'player');
  }
  interact(dt) {
    const g = this.game, ui = g.ui;
    if (!this.enabled) { ui.prompt(null); return; }
    const eye = this.camera.position, dir = this.lookDir(), o = g.inter.best(eye, dir);
    if (o !== this.interTarget) { if (this.interTarget && this.interHold > 0 && this.interTarget.onRelease) this.interTarget.onRelease(); this.interTarget = o; this.interHold = 0; this.interDone = false; }
    if (!o) { ui.prompt(null); return; }
    const label = typeof o.label === 'function' ? o.label() : o.label;
    const E = this.keys.KeyE;
    if (E && !this.interDone) {
      this.interHold += dt;
      const hold = typeof o.hold === 'function' ? o.hold() : o.hold;
      if (hold > 0) { const k = clamp(this.interHold / hold, 0, 1); o.onHold && o.onHold(k); ui.prompt(label, k); if (k >= 1) { this.interDone = true; o.act(); } }
      else { ui.prompt(label, clamp(this.interHold / 0.6, 0, 1) * 0); if (this.interHold > 0.6) { this.interDone = true; o.act(true); } }
    } else {
      if (!E && this.interHold > 0 && !this.interDone) { if ((typeof o.hold === 'function' ? o.hold() : o.hold) > 0) { o.onRelease && o.onRelease(); } else o.act(false); }
      if (!E) { this.interHold = 0; this.interDone = false; }
      ui.prompt(label, 0);
    }
  }
  save() { return { pos: this.pos.toArray(), yaw: this.yaw, hp: this.hp, st: this.st, food: this.food, water: this.water, fear: this.fear, stress: this.stress, hope: this.hope, inv: this.inv, owned: [...this.owned], ammo: this.ammo, mag: this.mag, weapon: this.weapon, hasFlash: this.hasFlash, kills: this.kills, bag: this.bag, armor: this.armor, batt: this.batt }; }
  load(s) { this.pos.fromArray(s.pos); this.yaw = s.yaw; Object.assign(this, { hp: s.hp, st: s.st, food: s.food, water: s.water, fear: s.fear, stress: s.stress, hope: s.hope, inv: s.inv, ammo: s.ammo, mag: s.mag, weapon: s.weapon, hasFlash: s.hasFlash, kills: s.kills || 0, bag: s.bag || null, armor: s.armor || { head: null, body: null }, batt: s.batt ?? 100 }); this.ammo.shotgun ??= 0; this.mag.shotgun ??= 0; this.owned = new Set(s.owned); this.c.vel.set(0, 0, 0); this.dead = false; }
}
function g_noise(game, p, r) { game._vn = (game._vn || 0) + 1; if (game._vn % 20 === 0) game.zombies.noise(p, r); }
