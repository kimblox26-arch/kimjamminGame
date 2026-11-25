// 무기(주먹·권총·소총) → 피·탄흔 → 경찰 출동(지원 포함) → 체포 → 법정(사람들 있음) 선고 → 게임 오버
import * as THREE from 'three';
import { Person } from './people.js';
import { COURT, PRISON } from './places.js';
import { makePistol, makeRifle, FX } from './weapons.js';
import { $, toast, modal, show, ic } from './ui.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const POLICE = { id: 'police', name: '경찰관', model: 'man', h: 1.8, top: '#1b2a49', bottom: '#1b2a49', hat: 'police', voice: [0.95, 1.05] };
const ROLES = {
  judge: { id: 'judge', name: '재판장', model: 'man', h: 1.75, top: '#0d0d0f', bottom: '#0d0d0f', glasses: true, voice: [0.9, 0.95] },
  judge2: { id: 'judge2', name: '배석판사', model: 'woman', h: 1.65, voice: [1.05, 1.0] },
  pros: { id: 'pros', name: '검사', model: 'man', h: 1.77, top: '#1d2230', bottom: '#1d2230', voice: [0.95, 1.05] },
  lawyer: { id: 'lawyer', name: '변호인', model: 'man', h: 1.74, top: '#4a4e56', bottom: '#2e3138', glasses: true, voice: [1.0, 1.0] },
  guard: { id: 'guard', name: '법정 경위', model: 'man', h: 1.82, top: '#26344f', bottom: '#1a2234', hat: 'police', voice: [0.92, 1.05] },
  aud: { id: 'aud', name: '방청객', model: 'man', h: 1.72, top: '#555b63', bottom: '#2b2b2b', voice: [1.0, 1.0] },
  audw: { id: 'audw', name: '방청객', model: 'woman', h: 1.62, voice: [1.15, 1.0] },
};
const PAIN = {
  head: [['으… 윽…', 'sad']], chest: [['커헉… 숨이… 안 쉬어져…', 'sad'], ['으윽…! 가슴이…', 'sad']],
  stomach: [['으윽… 배가…', 'sad'], ['아… 아파… 너무 아파…', 'sad']], arm: [['아악! 내 팔!', 'angry'], ['팔이… 팔이…!', 'sad']],
  leg: [['아아악! 다리…!', 'angry'], ['다리가… 다리가 안 움직여…', 'sad']],
};
const SCREAM = [['꺄아악!', 'scared'], ['총이야! 엎드려!', 'scared'], ['사, 살려 줘!', 'scared'], ['도망쳐! 빨리!', 'scared'], ['누가 경찰 좀 불러요!', 'scared']];
const BEG = [['제발… 살려 주세요…', 'sad'], ['쏘지 마세요, 제발요!', 'scared'], ['잘못했어요… 진짜 잘못했어요…', 'sad'], ['집에 애가 있어요… 제발…', 'sad'], ['돈 다 드릴게요! 살려만 주세요!', 'scared'],
  ['아무한테도 말 안 할게요… 제발…', 'sad'], ['엄마… 엄마…', 'sad'], ['한 번만… 한 번만 봐주세요…', 'sad'], ['죽고 싶지 않아요… 제발…', 'sad']];
const SURR = [['쏘, 쏘지 마세요!', 'scared'], ['잠깐만요! 잠깐만!', 'scared'], ['손 들었어요! 손 들었어요!', 'scared'], ['저 아무것도 안 했어요!', 'scared'], ['왜, 왜 이러세요…!', 'scared']];
// 무기·부위별 피해 (머리 = 즉사)
const DMG = { fist: { head: 30, chest: 20, stomach: 24, arm: 12, leg: 12 }, pistol: { head: 999, chest: 60, stomach: 45, arm: 26, leg: 30 }, rifle: { head: 999, chest: 48, stomach: 38, arm: 22, leg: 26 } };
const pk = a => a[Math.random() * a.length | 0];

export class Crime {
  constructor(app) { Object.assign(this, app); this.fx = new FX(this.scene); this.guns = {}; this.reset(); }
  reset() { this.gs = null; this.begCool = 0; this.surCool = 0; this.aimedC = null; this.assaults = 0; this.kills = 0; this.police = null; this.called = false; this.arrested = false; this.officers = []; this.weapon = 'fist'; this.inCourt = false; this.courtPeople = []; this.chaos = false; this.firing = false; this.cool = 0; this.backup = 0; }
  owned() { try { return JSON.parse(localStorage.getItem('ns_guns') || '{}'); } catch (e) { return {}; } }
  get hasGun() { const o = this.owned(); return !!(o.pistol || o.rifle); }
  // 보관함에서 총 꺼내기 (무료)
  takeFromCabinet() {
    const modalP = new Promise(r => modal(`<h2>${ic('gun')} 총기 보관함</h2><p>어떤 총을 꺼낼까요?</p><p style="color:#8a97a6;font-size:13px">⚠ 사람을 다치게 하면 경찰이 출동하고 재판을 받습니다</p>`, [['권총', 'gray', () => r('pistol')], ['소총', 'blue', () => r('rifle')], ['닫기', 'gray', () => r(null)]]));
    modalP.then(k => {
      if (!k) return; const o = this.owned(); o[k] = true; try { localStorage.setItem('ns_guns', JSON.stringify(o)); } catch (e) { }
      this.audio.play('door', { vol: 0.5, rate: 1.6 }); this.audio.play('key', { vol: 0.6, rate: 0.7 });
      this.setWeapon(k); $('bWpn').classList.remove('hidden');
    });
  }
  gun(k) { return (this.guns[k] ||= k === 'rifle' ? makeRifle() : makePistol()); }
  cycle() { const o = this.owned(), order = ['fist', ...(o.pistol ? ['pistol'] : []), ...(o.rifle ? ['rifle'] : [])]; this.setWeapon(order[(order.indexOf(this.weapon) + 1) % order.length]); }
  setWeapon(w) {
    this.weapon = w;
    if (w === 'fist') { for (const k of ['pistol', 'rifle']) this.guns[k]?.removeFromParent(); this.hands.hold('R', null); this.hands.rest('R'); this.hands.rest('L'); }
    else {
      // 총은 화면 앞 고정 위치(1인칭 슈팅 방식), 손은 손잡이·총열 덮개를 쥠
      for (const k of ['pistol', 'rifle']) this.guns[k]?.removeFromParent();
      const gm = this.gun(w); this.hands.hold('R', null); this.hands.hold('L', null); this.camera.add(gm);
      this.gs = { t: 0, sx: 0, sy: 0, kick: 0, run: 0, mv: 0, py: this.look.yaw, pp: this.look.pitch, draw: 1 };
      this.updateGun(0);
      this.audio.play('key', { vol: 0.7, rate: 0.6 }); this.audio.play('bill', { vol: 0.5, rate: 0.5, delay: 0.12 });
    }
    $('bWpn').querySelector('b').textContent = { fist: '주먹', pistol: '권총', rifle: '소총' }[w];
  }
  // 총 든 자세: 걸을 때 흔들림(발걸음에 맞춰), 고개 돌리면 살짝 늦게 따라옴, 달리면 총구 내림, 쏘면 반동, 숨쉬기
  updateGun(dt) {
    const gm = this.guns[this.weapon], gs = this.gs; if (!gm || this.weapon === 'fist' || !gm.parent || !gs) return;
    const ud = gm.userData, m = this.mover, L = this.look; gs.t += dt;
    let dy = L.yaw - gs.py; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); const dp = L.pitch - gs.pp; gs.py = L.yaw; gs.pp = L.pitch;
    const k = Math.min(1, dt * 7), cl = (v, a) => Math.max(-a, Math.min(a, v));
    if (dt > 0) { gs.sx += (cl(dy / dt * 0.012, 0.035) - gs.sx) * k; gs.sy += (cl(dp / dt * 0.012, 0.03) - gs.sy) * k; }
    gs.mv += ((m?.moving ? 1 : 0) - gs.mv) * Math.min(1, dt * 6); gs.run += ((m?.running ? 1 : 0) - gs.run) * Math.min(1, dt * 5);
    gs.kick *= Math.exp(-dt * 16); gs.draw *= Math.exp(-dt * 7);
    const ph = (m?.phase || 0) * 0.5, mv = gs.mv * (1 - gs.run * 0.5), run = gs.run, br = Math.sin(gs.t * 1.7);
    const p = ud.base.clone();
    p.x += Math.sin(ph) * 0.011 * mv + gs.sx * 0.6 + ud.run.p.x * run;
    p.y += -Math.abs(Math.cos(ph)) * 0.012 * mv + br * 0.0016 - gs.sy * 0.5 + ud.run.p.y * run - gs.draw * 0.25 + gs.kick * 0.012;
    p.z += ud.run.p.z * run + gs.kick * (ud.auto ? 0.035 : 0.05);
    gm.position.copy(p);
    const r0 = ud.rot0 || [0, 0, 0];
    gm.rotation.set(r0[0] + ud.run.r[0] * run + gs.kick * (ud.auto ? 0.1 : 0.32) + gs.sy * 1.2 - gs.draw * 0.9 + br * 0.004, r0[1] + ud.run.r[1] * run + gs.sx * 1.5 + Math.sin(ph) * 0.012 * mv, ud.run.r[2] * run + Math.sin(ph) * 0.03 * mv + gs.sx * 0.8);
    gm.updateMatrix();
    for (const side of ['R', 'L']) { const h = ud.hold[side]; if (!h) continue; this.hands.place(side, h.p.clone().applyMatrix4(gm.matrix), h.F.clone().applyQuaternion(gm.quaternion), h.up.clone().applyQuaternion(gm.quaternion), h.pose); }
  }
  // 총알이 몸 어디에 맞았나: 뼈 사이 선분(머리·가슴·배·팔·다리)과 총알 선의 거리
  zoneHit(person, ray) {
    const B = person.B; if (!B?.head || person.dead) return null;
    const P = b => b.getWorldPosition(V3()), pr = V3(), ps = V3();
    const segs = [['head', P(B.head), B.top ? P(B.top) : P(B.head).add(V3(0, 0.2, 0)), 0.12], ['chest', P(B.spine1), P(B.neck), 0.19], ['stomach', P(B.hips), P(B.spine1), 0.18]];
    for (const s of ['L', 'R']) { const S = B[s]; if (S.arm) segs.push(['arm', P(S.arm), P(S.fore), 0.07, s], ['arm', P(S.fore), P(S.hand), 0.06, s]); if (S.up) segs.push(['leg', P(S.up), P(S.leg), 0.1, s], ['leg', P(S.leg), P(S.foot), 0.075, s]); }
    let best = null;
    for (const [zone, a, b, r, side] of segs) {
      const d = Math.sqrt(ray.distanceSqToSegment(a, b, pr, ps)); if (d > r) continue;
      const t = pr.distanceTo(ray.origin) - (zone === 'head' ? 0.05 : 0);
      if (!best || t < best.t) best = { zone, side: side || (Math.random() < 0.5 ? 'L' : 'R'), point: pr.clone(), t };
    }
    return best;
  }
  vox(c, kind, delay = 0) {
    const f = (c.gender || (c.person.kind === 'woman' ? 'f' : 'm')) === 'f', n = { scream: 2, hurt: f ? 3 : 4, die: 3 }[kind] || 1;
    const name = kind === 'breath' ? `breath_${f ? 'f' : 'm'}` : `${kind}_${f ? 'f' : 'm'}${1 + (Math.random() * n | 0)}`;
    const pos = c.person.head ? c.person.head.getWorldPosition(V3()) : c.person.root.position;
    this.audio.play(name, { pos, vol: kind === 'breath' ? 0.8 : 1.3, rate: 0.93 + Math.random() * 0.14, delay });
  }
  // 공격 버튼 누름/뗌 (소총은 누르고 있으면 연사)
  press() { if (this.weapon === 'rifle') this.firing = true; else this.attack(); }
  release() { this.firing = false; }
  targets() {
    const g = this.game, list = [];
    for (const c of g.customers) if (!c.dead) list.push([c.person.hitbox, c]);
    if (g.boss && !g.bossDead) list.push([g.boss.hitbox, g.bossC]);
    for (const o of this.officers) if (!o.dead) list.push([o.hitbox, o.ref]);
    for (const c of this.courtPeople) if (!c.dead) list.push([c.person.hitbox, c]);
    return list;
  }
  async attack() {
    if (this.arrested && !this.inCourt) return;
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0, 0), this.camera); ray.far = this.weapon === 'fist' ? 2.2 : 60;
    const T = this.targets(), hits = ray.intersectObjects(T.map(t => t[0]), false), ph = hits[0];
    if (this.weapon === 'fist') {
      if (!ph) return;
      const c = T.find(t => t[0] === ph.object)[1], z = this.zoneHit(c.person, ray.ray) || { zone: 'chest', side: 'R', point: ph.point };
      this.hands.pose('R', 'fist'); await this.hands.reachTo('R', z.point, 'fist', 'front', 130);
      this.audio.play('punch', { pos: z.point, vol: 1.2, rate: 1.1 + Math.random() * 0.2 }); this.fx.blood(z.point, ray.ray.direction, 4); this.hit(c, DMG.fist[z.zone], z, ray.ray.direction);
      setTimeout(() => { this.hands.pose('R', 'relax'); this.hands.rest('R'); }, 160);
      return;
    }
    const gm = this.gun(this.weapon);
    this.audio.play('gun', { pos: this.camera.getWorldPosition(V3()), vol: this.weapon === 'rifle' ? 1.3 : 1.6, rate: this.weapon === 'rifle' ? 0.9 + Math.random() * 0.1 : 1 });
    this.fx.muzzle(gm); this.look.pitch += this.weapon === 'rifle' ? 0.01 + Math.random() * 0.006 : 0.035; this.look.yaw += (Math.random() - 0.5) * 0.008; if (this.gs) this.gs.kick = 1;
    const world = this.worldRoots.filter(Boolean), wh = ray.intersectObjects(world, true).find(h => h.object.visible && !h.object.userData.loose);
    let hitC = null, z = null;
    for (const h of hits) { if (wh && h.distance > wh.distance) break; const c = T.find(t => t[0] === h.object)[1]; z = this.zoneHit(c.person, ray.ray); if (z) { hitC = c; break; } }
    if (hitC) { this.fx.blood(z.point, ray.ray.direction, z.zone === 'head' ? 34 : 16); this.hit(hitC, DMG[this.weapon][z.zone], z, ray.ray.direction); }
    else { if (wh) this.fx.impact(wh); this.panic(); if (!this.inCourt) { this.game.violence = true; this.callPolice(); } else this.courtChaos(); }
  }
  hit(c, dmg, z, dir) {
    const g = this.game, p = c.person;
    c.hp = (c.hp ?? 100) - dmg; this.assaults++;
    if (c.hp <= 0) this.kill(c, { zone: z.zone, side: z.side, dir });
    else {
      p.hurt(z.zone, dir, z.side); this.vox(c, 'hurt'); c.mood = 0; c.wound = z.zone;
      if (Math.random() < 0.6) setTimeout(() => { if (!c.dead) g.say(c, pk(PAIN[z.zone])); }, 450);
      const tough = c.officer || c.role === 'guard';
      if (z.zone === 'leg') { p.goDown(z.side); c.down = true; if (c.officer) c.officer.chase = false; }
      else if (!tough && (z.zone === 'stomach' || Math.random() < 0.45)) { p.kneel(); c.down = true; }
      else if (!tough) { p.speed = 1.25; }
      if (c.down && !tough) { c.begging = true; c.begT = 1.4; c.done = true; setTimeout(() => !c.dead && p.beg(true), 1100); }
      if (Math.random() < 0.5) setTimeout(() => !c.dead && this.vox(c, 'breath'), 1500);
    }
    this.panic(c);
    if (this.inCourt) this.courtChaos(); else { g.violence = true; this.callPolice(); }
  }
  // 총소리·폭력에 다들 비명 지르며 도망
  panic(except) {
    const g = this.game;
    for (const o of g.customers) if (o !== except && !o.dead && !o.fleeing) { o.fleeing = true; o.person.speed = 2.8; o.done = true; if (g.cur === o) { g.cur = null; show('cust', false); } if (Math.random() < 0.8) this.vox(o, 'scream', Math.random() * 0.5); if (Math.random() < 0.35) setTimeout(() => g.say(o, pk(SCREAM)), 700); if (!o.gone) g.leave(o); }
    for (const o of this.courtPeople) if (o !== except && !o.dead && !o.fleeing && o.role !== 'guard') { o.fleeing = true; o.person.speed = 2.6; o.person.walk([V3(COURT.x + (Math.random() - 0.5) * 3, 0, COURT.z + 6.8)]); if (Math.random() < 0.75) this.vox(o, 'scream', Math.random() * 0.6); if (Math.random() < 0.25) setTimeout(() => g.say(o, pk(SCREAM)), 800); }
  }
  kill(c, info = {}) {
    const g = this.game, p = c.person; this.kills++; c.dead = true; c.done = true; c.gone = true; c.begging = false;
    if (g.cur === c) { g.cur = null; show('cust', false); }
    const qi = g.queue.indexOf(c); if (qi >= 0) g.queue.splice(qi, 1);
    if (info.zone !== 'head') this.vox(c, 'die', 0.05); if (c.talk !== undefined) p.talk = 0;
    p.die(info); const land = (p.Ta + p.Tb * 0.92) || 0.8;
    this.audio.play('thud', { pos: p.root.position, vol: 1.3, rate: 0.55 + Math.random() * 0.1, delay: land });
    setTimeout(() => this.fx.pool(p.bodyCenter(), info.zone === 'head' ? 1.1 : 1.35), land * 1000 + 300);
    if (c === g.bossC) g.bossDead = true;
    if (c.officer) { c.officer.dead = true; this.backup++; if (this.backup <= 2) setTimeout(() => this.policeArrive(true), 7000); }
  }
  // ── 경찰 ──
  callPolice() {
    if (this.called) return; this.called = true;
    setTimeout(() => toast(ic('siren') + '누군가 112에 신고했습니다!', 'bad', 2500), 1200);
    setTimeout(() => this.policeArrive(), 9000);
  }
  policeArrive(backup) {
    if (this.arrested || !this.game.running) return;
    const car = this.vehicles.car.clone(true); car.visible = true;
    car.traverse(o => { if (o.isMesh && o.material === this.vehicles.car.userData.paint) { o.material = o.material.clone(); o.material.color.setHex(0xf2f2f2); } if (o.isSpotLight) o.visible = false; });
    const red = new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }), blue = new THREE.MeshBasicMaterial({ color: 0x2060ff, toneMapped: false });
    const bar = new THREE.Group(); bar.position.set(0, this.vehicles.car.userData.size.y + 0.08, 0); car.add(bar);
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.2), red), l2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.2), blue); l1.position.x = -0.27; l2.position.x = 0.27; bar.add(l1, l2);
    const pl = new THREE.PointLight(0xff2020, 8, 14); pl.position.y = 0.3; bar.add(pl);
    const stopX = backup ? -5 - this.backup * 6 : 1.1;
    car.rotation.y = Math.PI / 2; car.position.set(-90, 0, 8.6); this.scene.add(car);
    const P = { car, siren: this.audio.siren(() => car.position), t: 0, l1, l2, pl, phase: 'drive', stopX };
    (this.cars ||= []).push(P); this.police = P;
    toast(ic('police') + (backup ? '경찰 지원 병력이 출동했습니다' : '경찰이 출동했습니다'), 'bad', 2200);
  }
  update(dt) {
    if (!window.__fxFreeze) this.fx.update(dt, this.audio);
    if (this.firing && (this.cool -= dt) <= 0) { this.cool = 0.11; this.attack(); }
    this.updateGun(dt); this.reactions(dt);
    for (const P of this.cars || []) {
      P.t += dt; const blink = Math.floor(P.t * 6) % 2; P.l1.visible = !!blink; P.l2.visible = !blink; P.pl.color.setHex(blink ? 0xff2020 : 0x2060ff);
      if (P.phase === 'drive') { const d = P.stopX - P.car.position.x; P.car.position.x += Math.sign(d) * Math.min(Math.abs(d), Math.min(16, Math.max(2, d * 0.8)) * dt); if (Math.abs(d) < 0.05) { P.phase = 'out'; this.officersOut(P); } }
    }
    if (!this.arrested && !this.inCourt) {
      const me = this.yawObj.position;
      for (const o of this.officers) {
        if (o.dead || !o.chase || o.down) continue;
        if (!o.path.length) o.walk([V3(me.x, 0, me.z)]); else o.path[o.path.length - 1].set(me.x, 0, me.z);
        if (o.root.position.distanceTo(V3(me.x, 0, me.z)) < 1.4) { this.arrest(o); break; }
      }
    }
    const cam = this.camera.getWorldPosition(V3());
    for (const o of this.officers) o.update(dt, cam);
    for (const c of this.courtPeople) c.person.update(dt, cam);
  }
  // 총구를 겨누면 손 들고 멈춤, 다친 사람은 무릎 꿇고 손 비비며 살려 달라고 빎
  reactions(dt) {
    const g = this.game; this.begCool -= dt; this.surCool -= dt;
    let aimed = null;
    if (this.weapon !== 'fist' && !this.arrested) {
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0, 0), this.camera); ray.far = 14;
      const T = this.targets(), h = ray.intersectObjects(T.map(t => t[0]), false)[0]; if (h) aimed = T.find(t => t[0] === h.object)[1];
    }
    const all = [...g.customers, ...this.courtPeople]; if (g.bossC && !g.bossDead) all.push(g.bossC);
    for (const c of all) {
      if (c.dead || !c.person) continue; const p = c.person, tough = c.officer || c.role === 'guard';
      if (c === aimed && !tough) {
        c.aimT = (c.aimT || 0) + dt; c.unaimT = 0;
        if (c.aimT > 0.3 && !c.surr && !c.begging) { c.surr = true; p.freeze(true); if (this.surCool <= 0) { this.surCool = 2.2; this.vox(c, 'breath'); g.say(c, pk(SURR)); } }
      } else if (c.surr) { c.aimT = 0; if ((c.unaimT = (c.unaimT || 0) + dt) > 1.6) { c.surr = false; p.freeze(false); } }
      if (c.begging) {
        c.begT -= dt * (c === aimed ? 1.7 : 1);
        if (c.begT <= 0 && this.begCool <= 0 && !p.talk) { c.begT = 3.2 + Math.random() * 2.5; this.begCool = 1.4; g.say(c, this.freshBeg(c)); if (Math.random() < 0.5) this.vox(c, 'breath', 0.2); }
      }
    }
    this.aimedC = aimed;
  }
  freshBeg(c) { c.begUsed ||= []; let l = BEG.filter(b => !c.begUsed.includes(b)); if (!l.length) { c.begUsed = []; l = BEG; } const b = pk(l); c.begUsed.push(b); return b; }
  officersOut(P) {
    const g = this.game;
    for (let i = 0; i < 2; i++) {
      const o = new Person(POLICE, this.audio); o.root.position.set(P.stopX - 0.8 + i * 1.6, 0, 7.2); o.speed = 3.4; this.scene.add(o.root); this.officers.push(o);
      o.ref = { type: POLICE, person: o, voice: POLICE.voice, gender: 'm', vIdx: 4, mood: 50, officer: o };
      o.walk([V3(1.1, 0, 5.6), V3(1.1, 0, 5.2), V3(1.1, 0, 3.3)]).then(() => (o.chase = true));
      setTimeout(() => (o.chase = true), 4000);
    }
    this.audio.play('door', { pos: P.car.position, vol: 0.8, rate: 0.7 });
    g.say(this.officers[this.officers.length - 1].ref, ['경찰입니다! 무기 버리고 꼼짝 마!', 'angry']);
  }
  async arrest(o) {
    if (this.arrested) return; this.arrested = true; this.firing = false;
    const g = this.game, oc = o.ref;
    this.mover.enabled = false; g.running = false;
    for (const s of ['R', 'L']) this.hands.hold(s, null); for (const k of ['pistol', 'rifle']) this.guns[k]?.removeFromParent();
    this.hands.raise('R', V3(0.25, 0.05, -0.38), 'open'); this.hands.raise('L', V3(-0.25, 0.05, -0.38), 'open');
    await g.say(oc, [`손 들어! 당신을 ${this.kills ? '살인' : '폭행'} 혐의로 현행범 체포합니다.`, 'angry']);
    this.audio.play('key', { vol: 1, rate: 0.5 }); this.audio.play('thud', { vol: 0.6, rate: 2.5 });
    await g.say(oc, ['당신은 변호인을 선임할 수 있고, 진술을 거부할 수 있습니다.', 'calm']);
    for (const P of this.cars || []) P.siren.stop();
    $('fade').classList.add('on');
    setTimeout(() => this.court(), 1600);
  }
  // ── 법정: 판사 3명·검사·변호인·경위·방청객 ──
  async court() {
    const g = this.game; this.inCourt = true; g.running = false;
    ['cust', 'idcard'].forEach(id => show(id, false)); show('hud'); document.body.classList.add('court-mode');
    const court = this.courtGroup, S = court.userData.seats, at = (a) => V3(COURT.x + a[0], a[1], COURT.z + a[2]);
    const add = (role, pos, face, line) => { const p = new Person(ROLES[role], this.audio); p.root.position.copy(at(pos)); p.lookAt(face || this.camera.getWorldPosition(V3())); this.scene.add(p.root); const c = { type: ROLES[role], person: p, voice: ROLES[role].voice, gender: ROLES[role].model === 'woman' ? 'f' : 'm', vIdx: 2 + this.courtPeople.length % 4, mood: 50, role }; this.courtPeople.push(c); return c; };
    const judge = add('judge', S.judges[1]); add('judge2', S.judges[0]); add('judge', S.judges[2]);
    add('pros', S.prosecutor, at([4, 1, -1])); add('lawyer', S.lawyer, at([-4, 1, -1])); add('aud', S.clerk);
    S.guards.forEach(p => add('guard', p)); S.audience.forEach((p, i) => add(i % 2 ? 'audw' : 'aud', p, at([0, 1, -6])));
    this.courtPeople[2].type = { ...ROLES.judge, name: '배석판사' };
    this.yawObj.position.copy(COURT).add(V3(3.6, 1.55, -0.2)); this.look.yaw = 0.25; this.look.pitch = 0.1; this.look.target = null; this.look.frozen = false;
    for (const s of ['R', 'L']) { this.hands.hold(s, null); this.hands.rest(s); }
    if (this.weapon !== 'fist') this.setWeapon(this.weapon);
    $('fade').classList.remove('on');
    const jc = judge, sleep = ms => new Promise(r => setTimeout(r, ms));
    await sleep(1200);
    const gavel = () => { for (let i = 0; i < 3; i++) this.audio.play('thud', { vol: 1.4, rate: 0.75, delay: i * 0.45 }); };
    const steps = [
      () => { gavel(); return sleep(1500); },
      () => g.say(jc, ['지금부터 2026고합 제1024호 사건의 판결을 선고하겠습니다. 피고인은 일어서 주십시오.', 'calm']),
      () => g.say(jc, [`피고인 ${g.name}은, ${this.kills ? `편의점 근무 중 ${this.kills}명을 살해하였습니다` : `편의점 근무 중 손님을 ${this.assaults}회 폭행하였습니다`}. 그 죄질이 매우 무겁습니다.`, 'calm']),
    ];
    for (const st of steps) { if (this.chaos) return; await st(); await sleep(400); }
    if (this.chaos) return;
    const death = this.kills >= 2 || (this.kills === 1 && Math.random() < 0.5), years = 1 + Math.min(9, Math.ceil(this.assaults / 2));
    const verdict = death ? '사형' : this.kills ? '무기징역' : `징역 ${years}년`;
    await g.say(jc, [`따라서 피고인을 ${verdict}에 처한다.`, 'angry']);
    if (this.chaos) return; gavel(); await sleep(1800); if (this.chaos) return;
    this.ending(death, verdict);
  }
  // 법정에서 폭력 → 경위·특공대 진압 → 사형
  courtChaos() {
    if (this.chaos) return; this.chaos = true;
    const g = this.game; this.audio.stopSpeak?.();
    const guard = this.courtPeople.find(c => c.role === 'guard' && !c.dead);
    if (guard) g.say(guard, ['총 버려! 엎드려!', 'angry']);
    toast(ic('siren') + '법정 비상! 경찰 특공대 진입', 'bad', 2500);
    for (const c of this.courtPeople) if (c.role === 'guard' && !c.dead) c.person.walk([this.yawObj.position.clone().setY(0)]);
    setTimeout(() => {
      this.firing = false; $('fade').classList.add('on'); this.audio.play('gun', { vol: 1.8, rate: 0.8 }); this.audio.play('punch', { vol: 1.5, rate: 0.7, delay: 0.2 });
      setTimeout(() => this.ending(true, '사형'), 1400);
    }, 7000);
  }
  ending(death, verdict) {
    this.firing = false; document.body.classList.remove('court-mode'); show('hud', false);
    for (const s of ['R', 'L']) this.hands.hold(s, null); for (const k of ['pistol', 'rifle']) this.guns[k]?.removeFromParent(); this.hands.enabled = false; this.hands.body.visible = false;
    $('fade').classList.add('on');
    setTimeout(() => {
      if (!death) { this.yawObj.position.copy(PRISON).add(V3(0, 1.6, -0.6)); this.look.yaw = Math.PI; this.look.pitch = -0.05; this.look.frozen = true; this.audio.play('door', { vol: 1, rate: 0.5 }); this.audio.play('thud', { vol: 1, rate: 0.5 }); }
      $('fade').classList.remove('on');
      try { localStorage.removeItem('ns_save'); } catch (e) { }
      setTimeout(() => modal(`<h2>${death ? '사형 선고' : '교도소 수감'}</h2><div class="grade" style="color:#ff6b7a">GAME OVER</div><p>${death ? '법원은 피고인에게 사형을 선고했습니다.' : `${verdict} — 이제 편의점 대신 교도소에서 밤을 보냅니다.`}</p><p style="color:#8a97a6;font-size:13px">게임 속 폭력도 대가를 치릅니다. 다시 성실한 알바생으로 시작해 볼까요?</p>`,
        [['메인으로', 'gray', () => this.onExit()], ['처음부터', 'blue', () => this.onRestart()]]), death ? 600 : 2200);
    }, 1500);
  }
  cleanup() {
    for (const P of this.cars || []) { P.siren.stop(); P.car.removeFromParent(); } this.cars = [];
    for (const o of this.officers) o.dispose(); this.officers = [];
    for (const c of this.courtPeople) c.person.dispose(); this.courtPeople = [];
    this.fx.clear(); document.body.classList.remove('court-mode'); for (const k of ['pistol', 'rifle']) this.guns[k]?.removeFromParent();
    this.look.frozen = false; this.hands.enabled = true; this.reset();
  }
}
