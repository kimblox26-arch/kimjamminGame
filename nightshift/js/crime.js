// 무기(주먹·권총·소총) → 피·탄흔 → 경찰 출동(지원 포함) → 체포 → 법정(사람들 있음) 선고 → 게임 오버
import * as THREE from 'three';
import { Person } from './people.js';
import { COURT, PRISON } from './places.js';
import { makePistol, makeRifle, FX } from './weapons.js';
import { $, toast, modal, show, ic } from './ui.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const INMATE = { id: 'inmate', name: '수용자', model: 'man', h: 1.76, voice: [0.9, 1.0] };
const INMATE_LINES = [['콜록콜록… 아, 여기 공기 진짜 안 좋네.', 'tired'], ['너 무슨 일로 들어왔냐?', 'calm'], ['조용히 해라, 교도관 온다.', 'calm'], ['나가면 제일 먼저 국밥 한 그릇 먹을 거다.', 'tired'], ['밤마다 환풍구에서 바람 소리가 나… 저거 나사 헐거운 거 아니냐?', 'calm']];
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
let crackM = null; const CRACK = () => crackM ||= new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, map: (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.strokeStyle = 'rgba(255,255,255,.85)'; for (let i = 0; i < 16; i++) { const a = Math.random() * 6.28; g.lineWidth = 1 + Math.random() * 1.5; g.beginPath(); g.moveTo(128, 128); let x = 128, y = 128; for (let k = 0; k < 6; k++) { x += Math.cos(a + (Math.random() - 0.5) * 0.6) * 20; y += Math.sin(a + (Math.random() - 0.5) * 0.6) * 20; g.lineTo(x, y); } g.stroke(); } for (let r = 20; r < 90; r += 22) { g.beginPath(); g.arc(128, 128, r + Math.random() * 8, 0, 7); g.lineWidth = 0.8; g.stroke(); } g.fillStyle = 'rgba(30,30,30,.9)'; g.beginPath(); g.arc(128, 128, 6, 0, 7); g.fill(); return new THREE.CanvasTexture(c); })() });

export class Crime {
  constructor(app) { Object.assign(this, app); this.fx = new FX(this.scene); this.guns = {}; this.reset(); }
  reset() { this.hp = 100; this.lv = 0; this.lvT = 0; this.hurtT = 9; this.inPrison = false; this.ventN = 0; this.prisonGuards?.forEach(o => o.dispose()); this.prisonGuards = []; this.ammo = { pistol: 15, rifle: 30 }; this.reloadT = 0; this.gs = null; this.begCool = 0; this.surCool = 0; this.aimedC = null; this.assaults = 0; this.kills = 0; this.charges = new Set(); this.copAttacked = false; this.inmates?.forEach(o => o.dispose()); this.inmates = []; this.police = null; this.called = false; this.arrested = false; this.officers = []; this.weapon = 'fist'; this.inCourt = false; this.courtPeople = []; this.chaos = false; this.firing = false; this.cool = 0; this.backup = 0; }
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
  setWeapon(w, instant) {
    // 총 넣기: 총을 허리 쪽으로 내리는 동작 뒤에 사라짐
    if (w === 'fist' && this.weapon !== 'fist' && this.gs && !instant && !this.holsterT) { this.holsterT = 0.38; this.audio.play('bag', { vol: 0.45, rate: 0.55 }); return; }
    this.holsterT = 0; this.weapon = w; document.body.classList.toggle('armed', w !== 'fist');
    if (w === 'fist') { for (const k of ['pistol', 'rifle']) this.guns[k]?.removeFromParent(); this.hands.hold('R', null); this.hands.rest('R'); this.hands.rest('L'); }
    else {
      // 총은 화면 앞 고정 위치(1인칭 슈팅 방식), 손은 손잡이·총열 덮개를 쥠
      for (const k of ['pistol', 'rifle']) this.guns[k]?.removeFromParent();
      const gm = this.gun(w); this.hands.hold('R', null); this.hands.hold('L', null); this.camera.add(gm);
      // 꺼내기: 허리춤에서 뽑아 올림(0.55초) → 앞으로 겨눔 → 왼손으로 슬라이드/장전손잡이 당겨 장전
      this.gs = { t: 0, sx: 0, sy: 0, kick: 0, run: 0, mv: 0, py: this.look.yaw, pp: this.look.pitch, draw: 1, drawT: 0 };
      this.updateGun(0);
      this.audio.play('bag', { vol: 0.5, rate: 0.6 }); this.audio.play('key', { vol: 0.7, rate: 0.55, delay: 0.08 });
      this.rackDelay = 0.55;
    }
    this.reloadT = 0; this.hud();
  }
  hud() { const w = this.weapon; $('bWpn').querySelector('b').textContent = w === 'fist' ? '총 꺼내기' : `${w === 'rifle' ? '소총' : '권총'} ${this.ammo[w]}`; }
  // 탄창 갈기: 총 기울이기 → 빈 탄창 떨어짐 → 왼손이 허리춤에서 새 탄창 → 꽂기 → 슬라이드/장전손잡이 당기기
  reload() {
    const w = this.weapon; if (w === 'fist' || this.reloadT > 0 || this.ammo[w] === this.gun(w).userData.cap) return;
    this.firing = false; this.reloadT = this.RT = w === 'rifle' ? 2.2 : 1.7; this.rl = { dropped: false, inserted: false, racked: false };
    this.audio.play('key', { vol: 0.7, rate: 0.85 });
  }
  // 총 든 자세: 걸을 때 흔들림(발걸음에 맞춰), 고개 돌리면 살짝 늦게 따라옴, 달리면 총구 내림, 쏘면 반동, 숨쉬기
  updateGun(dt) {
    const gm = this.guns[this.weapon], gs = this.gs; if (!gm || this.weapon === 'fist' || !gm.parent || !gs) return;
    const ud = gm.userData, m = this.mover, L = this.look; gs.t += dt;
    let dy = L.yaw - gs.py; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); const dp = L.pitch - gs.pp; gs.py = L.yaw; gs.pp = L.pitch;
    const k = Math.min(1, dt * 7), cl = (v, a) => Math.max(-a, Math.min(a, v));
    if (dt > 0) { gs.sx += (cl(dy / dt * 0.012, 0.035) - gs.sx) * k; gs.sy += (cl(dp / dt * 0.012, 0.03) - gs.sy) * k; }
    gs.mv += ((m?.moving ? 1 : 0) - gs.mv) * Math.min(1, dt * 6); gs.run += ((m?.running ? 1 : 0) - gs.run) * Math.min(1, dt * 5);
    gs.kick *= Math.exp(-dt * 16);
    gs.drawT += dt; { const k = Math.min(1, gs.drawT / 0.55); gs.draw = Math.pow(1 - k, 3); }
    if (this.holsterT > 0) { this.holsterT -= dt; gs.draw = 1 - Math.pow(Math.max(0, this.holsterT) / 0.38, 2); if (this.holsterT <= 0) { this.setWeapon('fist', true); return; } }
    if (this.rackDelay > 0 && (this.rackDelay -= dt) <= 0 && !(this.reloadT > 0)) { this.RT = 1.5; this.reloadT = this.RT * 0.38; this.rl = { dropped: true, inserted: true, racked: false, hand: true, rackOnly: true }; }
    const ph = (m?.phase || 0) * 0.5, mv = gs.mv * (1 - gs.run * 0.5), run = gs.run, br = Math.sin(gs.t * 1.7);
    const p = ud.base.clone();
    p.x += Math.sin(ph) * 0.011 * mv + gs.sx * 0.6 + ud.run.p.x * run;
    p.y += -Math.abs(Math.cos(ph)) * 0.012 * mv + br * 0.0016 - gs.sy * 0.5 + ud.run.p.y * run - gs.draw * 0.3 + gs.kick * 0.012; p.x += gs.draw * 0.09; p.z += gs.draw * 0.16;
    p.z += ud.run.p.z * run + gs.kick * (ud.auto ? 0.035 : 0.05);
    // 장전 동작
    let tilt = 0, rp = -1;
    if (this.reloadT > 0) {
      this.reloadT -= dt; rp = 1 - Math.max(0, this.reloadT) / this.RT; const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      tilt = this.rl.rackOnly ? ss(0.62, 0.7, rp) * (1 - ss(0.84, 1, rp)) * 0.6 : ss(0, 0.15, rp) * (1 - ss(0.82, 1, rp));
      if (rp > 0.12 && !this.rl.dropped) { this.rl.dropped = true; const m = ud.mag.clone(true); gm.updateMatrixWorld(true); ud.mag.getWorldPosition(m.position); ud.mag.getWorldQuaternion(m.quaternion); m.scale.copy(gm.scale); this.fx.drop(m, V3(0, -0.5, 0)); ud.mag.visible = false; this.audio.play('reload_rifle', { vol: 0.9, offset: 0, dur: 0.32 }); this.audio.play('thud', { vol: 0.3, rate: 2.2, delay: 0.45 }); }
      if (rp > 0.36 && !this.rl.hand) { this.rl.hand = ud.mag.clone(true); this.rl.hand.visible = true; this.rl.hand.scale.copy(gm.scale); this.hands.hold('L', this.rl.hand); this.rl.hand.position.set(0, 0, 0); }
      if (rp > 0.62 && !this.rl.inserted) { this.rl.inserted = true; this.hands.hold('L', null); this.rl.hand = null; ud.mag.visible = true; if (ud.slide) this.audio.play('reload_pistol', { vol: 1.1, offset: 0.02, dur: 0.5 }); else this.audio.play('reload_rifle', { vol: 1.1, offset: 0.08, dur: 0.42 }); }
      if (rp > 0.72 && !this.rl.racked) { this.rl.racked = true; if (ud.slide) this.audio.play('reload_pistol', { vol: 1.2, offset: 0.66, dur: 0.37 }); else this.audio.play('reload_rifle', { vol: 1.2, offset: 0.5, dur: 0.7 }); }
      if (this.reloadT <= 0) { this.reloadT = 0; if (!this.rl.rackOnly) this.ammo[this.weapon] = ud.cap; this.hud(); }
      p.y -= 0.025 * tilt; p.x -= 0.015 * tilt; p.z += 0.02 * tilt;
    }
    gm.position.copy(p);
    const r0 = ud.rot0 || [0, 0, 0];
    gm.rotation.set(r0[0] + ud.run.r[0] * run + gs.kick * (ud.auto ? 0.1 : 0.32) + gs.sy * 1.2 - gs.draw * 1.25 + br * 0.004, r0[1] + ud.run.r[1] * run + gs.sx * 1.5 + Math.sin(ph) * 0.012 * mv, ud.run.r[2] * run + Math.sin(ph) * 0.03 * mv + gs.sx * 0.8);
    gm.rotation.z += gs.draw * 0.5; gm.rotation.y -= gs.draw * 0.35;
    if (tilt) { gm.rotation.z += 0.55 * tilt; gm.rotation.x += 0.22 * tilt; gm.rotation.y -= 0.15 * tilt; }
    // 슬라이드·노리쇠 후퇴 (쏠 때 / 탄 다 쓰면 슬라이드 열린 채)
    const rack = rp > 0.74 && rp < 0.84 ? Math.sin((rp - 0.74) / 0.1 * Math.PI) : 0, open = this.ammo[this.weapon] === 0 && rp < 0.74;
    if (ud.slide) ud.slide.position.z = Math.max(gs.kick * 0.028, open ? 0.026 : 0, rack * 0.028);
    if (ud.bolt) ud.bolt.position.z = -0.01 + Math.max(gs.kick * 0.03, rack * 0.04);
    gm.updateMatrix();
    for (const side of ['R', 'L']) {
      const h = ud.hold[side]; if (!h) continue;
      let hp = h.p.clone().applyMatrix4(gm.matrix), F = h.F.clone().applyQuaternion(gm.quaternion), up = h.up.clone().applyQuaternion(gm.quaternion), pose = h.pose;
      if (side === 'L' && rp >= 0) { // 왼손: 받침 → 허리춤(새 탄창) → 탄창 삽입구 → 슬라이드/장전손잡이 → 받침
        const belt = V3(-0.1, -0.46, -0.22), well = ud.magwell.clone().add(V3(-0.01, -0.03, 0)).applyMatrix4(gm.matrix), rk = (ud.slide ? V3(0, 0.03, 0.02) : V3(0.0, 0.03, 0.09)).applyMatrix4(gm.matrix);
        const seg = (a, b, x0, x1) => { const t = Math.min(1, Math.max(0, (rp - x0) / (x1 - x0))); return a.clone().lerp(b, t * t * (3 - 2 * t)); };
        if (rp < 0.12) {} else if (rp < 0.36) { hp = seg(hp, belt, 0.12, 0.36); pose = 'grip'; } else if (rp < 0.62) { hp = seg(belt, well, 0.36, 0.6); pose = 'grip'; F = V3(0.15, 0.85, -0.5); up = V3(-0.9, 0.1, 0.4); }
        else if (rp < 0.86) { hp = seg(this.rl.rackOnly ? hp : well, rk.clone().add(V3(0, 0, rack * 0.035)), 0.62, 0.72); pose = 'pinch'; F = V3(0.6, 0.1, -0.8); up = V3(-0.2, 0.95, 0.1); } else hp = seg(rk, hp, 0.86, 1);
      }
      this.hands.place(side, hp, F, up, pose);
    }
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
  indoor() { const p = this.yawObj.position, f = p.y - 1.55; return this.inCourt || this.inPrison || f < -1 || f > 2 || (p.x > -5.6 && p.x < 20 && p.z > -16 && p.z < 4.2) || (p.x > 20.5 && p.x < 42.6 && p.z > -6 && p.z < 3.9); }
  // 공격 버튼 누름/뗌 (소총은 누르고 있으면 연사)
  press() { if (this.weapon === 'fist' || this.holsterT > 0 || this.gs?.draw > 0.2) return; if (this.weapon === 'rifle') this.firing = true; else this.attack(); }
  release() { this.firing = false; }
  targets() {
    const g = this.game, list = [];
    for (const c of g.customers) if (!c.dead) list.push([c.person.hitbox, c]);
    if (g.boss && !g.bossDead) list.push([g.boss.hitbox, g.bossC]);
    for (const o of this.officers) if (!o.dead) list.push([o.hitbox, o.ref]);
    for (const c of this.courtPeople) if (!c.dead) list.push([c.person.hitbox, c]);
    for (const c of this.peds?.list || []) if (!c.dead) list.push([c.person.hitbox, c]);
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
    if (this.reloadT > 0) return;
    if (this.ammo[this.weapon] <= 0) { this.audio.play('dryfire', { vol: 0.9 }); this.firing = false; this.reload(); return; }
    this.ammo[this.weapon]--; this.hud(); if (this.ammo[this.weapon] === 0) setTimeout(() => this.reload(), 350);
    this.audio.play(this.weapon === 'rifle' ? (this.indoor() ? 'rifle_in' : (Math.random() < 0.5 ? 'rifle_shot1' : 'rifle_shot2')) : 'pistol_shot', { vol: this.weapon === 'rifle' ? 1.5 : 1.7, rate: 0.96 + Math.random() * 0.08 });
    this.fx.muzzle(gm); this.look.pitch += this.weapon === 'rifle' ? 0.01 + Math.random() * 0.006 : 0.035; this.look.yaw += (Math.random() - 0.5) * 0.008; if (this.gs) this.gs.kick = 1;
    if (!this.inCourt) this.peds?.gunshot(this.camera.getWorldPosition(V3()));
    const carList = (this.drive?.traffic?.list || []).filter(v => v.mesh.visible && v.mesh.position.distanceTo(this.yawObj.position) < 70);
    const world = [...this.worldRoots.filter(Boolean), ...carList.map(v => v.mesh)], wh = ray.intersectObjects(world, true).find(h => h.object.visible && !h.object.userData.loose && !h.object.isSprite);
    let hitC = null, z = null;
    for (const h of hits) { if (wh && h.distance > wh.distance) break; const c = T.find(t => t[0] === h.object)[1]; z = this.zoneHit(c.person, ray.ray); if (z) { hitC = c; break; } }
    if (hitC) { this.fx.blood(z.point, ray.ray.direction, z.zone === 'head' ? 34 : 16); this.hit(hitC, DMG[this.weapon][z.zone], z, ray.ray.direction); }
    else { if (wh) { const d = this.fx.impact(wh); const car = carList.find(v => { let o = wh.object; while (o) { if (o === v.mesh) return true; o = o.parent; } return false; }); if (car) this.carDamage(car, wh, d); } this.panic(); if (!this.inCourt) { this.game.violence = true; this.callPolice(); } else this.courtChaos(); }
  }
  hit(c, dmg, z, dir) {
    const g = this.game, p = c.person; if (!c.wantedHit) { c.wantedHit = true; this.assaults++; this.wanted.add(c.officer ? 2 : 1, c.officer ? '경찰 공격' : '폭행'); }
    if (c.officer) this.copAttacked = true;
    if (c.thug || (c.ped && Math.random() < 0.15)) this.provoke(c);
    c.hp = (c.hp ?? 100) - dmg;
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
    for (const o of g.customers) if (o !== except && !o.dead && !o.fleeing && !o.down) {
      o.fleeing = true; o.done = true; if (g.cur === o) { g.cur = null; show('cust', false); }
      const P = o.person; P.lookAt(this.camera.getWorldPosition(V3()));
      if (Math.random() < 0.3) { // 그 자리에 웅크리고 머리 감싸기 → 잠시 뒤 도망
        P.pause(true); Object.assign(P.PT, { kneel: 1, cover: 1, hunch: 0.6, phone: 0 }); this.vox(o, Math.random() < 0.5 ? 'scream' : 'breath', Math.random() * 0.3);
        setTimeout(() => { if (o.dead || o.down) return; Object.assign(P.PT, { kneel: 0, cover: 0, hunch: 0 }); P.pause(false); P.speed = 3.2; if (!o.gone) g.leave(o); }, 4000 + Math.random() * 3500);
        continue;
      }
      P.speed = 3.0 + Math.random() * 0.6; if (Math.random() < 0.8) this.vox(o, 'scream', Math.random() * 0.5); if (Math.random() < 0.35) setTimeout(() => g.say(o, pk(SCREAM)), 700); if (!o.gone) g.leave(o); }
    for (const o of this.courtPeople) if (o !== except && !o.dead && !o.fleeing && o.role !== 'guard') { o.fleeing = true; o.person.speed = 2.6; o.person.walk([V3(COURT.x + (Math.random() - 0.5) * 3, 0, COURT.z + 6.8)]); if (Math.random() < 0.75) this.vox(o, 'scream', Math.random() * 0.6); if (Math.random() < 0.25) setTimeout(() => g.say(o, pk(SCREAM)), 800); }
  }
  kill(c, info = {}) {
    const g = this.game, p = c.person; if (c.dead) return;
    // 내가 실제로 숨지게 한 경우에만 살인 (다치게만 했거나 남이 낸 사고는 살인이 아님)
    if (!info.accident) { this.kills++; this.wanted.add(c.officer ? 2 : 1, c.officer ? '경찰 살해' : '살인'); this.features?.stat?.('kills'); setTimeout(() => this.peds?.witness?.(p.root.position.clone()), 600); }
    c.dead = true; c.done = true; c.gone = true; c.begging = false;
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
    this.updateGun(dt); this.reactions(dt); this.playerUpdate(dt);
    if (this.smoking && (this.smokeT = (this.smokeT || 0) - dt) < 0) { this.smokeT = 0.18; for (const v of this.smoking) { const S = v.mesh.userData.size || { y: 1.5, z: 4 }; this.fx.smoke(v.mesh.localToWorld(V3(0, S.y * 0.75, S.z * 0.35)), 0x333333); } } if (this.inPrison || this.prisonGuards.length) this.prisonUpdate(dt);
    for (const P of this.cars || []) {
      P.t += dt; const blink = Math.floor(P.t * 6) % 2; P.l1.visible = !!blink; P.l2.visible = !blink; P.pl.color.setHex(blink ? 0xff2020 : 0x2060ff);
      if (P.phase === 'drive') { const d = P.stopX - P.car.position.x, me = this.yawObj.position, ahead = (me.x - P.car.position.x) * Math.sign(d); const blocked = Math.abs(me.z - P.car.position.z) < 1.8 && ahead > 0 && ahead < 4.2 && Math.abs(me.y - 1.55) < 1; if (!blocked) P.car.position.x += Math.sign(d) * Math.min(Math.abs(d), Math.min(16, Math.max(2, d * 0.8)) * dt); if (Math.abs(d) < 0.05) { P.phase = 'out'; this.officersOut(P); } }
    }
    if (!this.arrested && !this.inCourt) {
      const me = this.yawObj.position;
      for (const o of this.officers) {
        if (o.dead || !o.chase || o.down) continue;
        const od = o.root.position.distanceTo(V3(me.x, o.root.position.y, me.z));
        if (od > 70) { const a = Math.random() * 6.28; o.root.position.set(me.x + Math.cos(a) * 32, me.y - 1.55 < -1 ? me.y - 1.55 : 0, me.z + Math.sin(a) * 32); o.path = []; }
        if ((this.kills > 0 || this.copAttacked) && od < 24 && this.shootAt(o, dt)) continue;
        const ride = this.drive?.ride, fast = ride && Math.abs(ride.v) > 2.5, op = o.root.position, fy = me.y - 1.55 < -1 ? Math.max(-4.2, me.y - 1.55) : 0;
        // 나에게서 0.9m 앞에서 멈춤 (몸을 뚫고 지나가지 않게)
        const to = V3(me.x - op.x, 0, me.z - op.z), dd = to.length(), stand = dd > 0.95 ? V3(me.x, fy, me.z).addScaledVector(to.normalize(), -0.9).addScaledVector(V3(-to.z, 0, to.x), (o.flank ??= this.officers.indexOf(o) % 2 ? 0.75 : -0.75) * Math.min(1, dd / 3)) : op.clone();
        const behind = me.x > 2.3 && me.x < 4.8 && me.z > -4 && me.z < 2.5;
        if (behind && op.x < 2.3 && op.z > -4 && op.z < 4.2) { if (!o.path.length || o.path.length < 2) o.walk([V3(2.0, 0, 3.05), V3(3.4, 0, 3.05), stand]); else o.path[o.path.length - 1].copy(stand); }
        else if (dd <= 0.95) { o.path = []; o.lookAt(me); }
        else if (!o.path.length) o.walk([stand]); else o.path[o.path.length - 1].copy(stand);
        if ((ride ? this.drive.boxGap(ride.obj, op) < 0.75 || dd < 2.6 : dd < 1.4) && !fast) { this.arrest(o); break; }
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
    const all = [...g.customers, ...this.courtPeople, ...(this.peds?.list || [])]; if (g.bossC && !g.bossDead) all.push(g.bossC);
    for (const c of all) {
      if (c.dead || !c.person) continue; const p = c.person, tough = c.officer || c.role === 'guard' || c.aggro;
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
  report() { if (!this.inCourt && !this.arrested) { this.game.violence = true; this.callPolice(); } }
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
    g.say(this.officers[this.officers.length - 1].ref, this.kills > 0 ? ['살인 용의자다! 무기 버려! 안 그러면 쏜다!', 'angry'] : this.copAttacked ? ['경찰관 폭행범이다! 무기 버리고 엎드려!', 'angry'] : ['경찰입니다! 손 머리 위로 올리고 그 자리에 서세요!', 'angry']);
  }
  async arrest(o) {
    if (this.arrested) return; this.arrested = true; this.firing = false;
    const g = this.game, oc = o.ref;
    if (this.drive?.ride) { this.drive.ride.v = 0; this.drive.exit(true); o.lookAt(this.yawObj.position); await g.say(oc, ['차에서 내려! 당장!', 'angry']); }
    this.mover.enabled = false; g.running = false;
    for (const s of ['R', 'L']) this.hands.hold(s, null); for (const k of ['pistol', 'rifle']) this.guns[k]?.removeFromParent();
    this.hands.raise('R', V3(0.25, 0.05, -0.38), 'open'); this.hands.raise('L', V3(-0.25, 0.05, -0.38), 'open');
    await g.say(oc, [`손 들어! 당신을 ${this.charge()} 혐의로 현행범 체포합니다.`, 'angry']);
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
      () => g.say(jc, [`피고인 ${g.name}은, ${this.kills ? `${this.kills}명을 살해하였습니다` : this.assaults ? `${this.assaults}명을 폭행하였으나 사망에 이르지는 않았습니다` : `${[...this.charges].join(', ') || '공무집행방해'}의 죄를 저질렀습니다`}. ${this.kills ? '그 죄질이 매우 무겁습니다.' : '다만 사람의 목숨을 빼앗지는 않았습니다.'}`, 'calm']),
    ];
    for (const st of steps) { if (this.chaos) return; await st(); await sleep(400); }
    if (this.chaos) return;
    const death = this.kills >= 2 || (this.kills === 1 && Math.random() < 0.5), years = Math.min(10, 1 + this.assaults + (this.charges.has('차량 탈취') ? 1 : 0) + (this.copAttacked ? 2 : 0));
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
      this.firing = false; $('fade').classList.add('on'); this.audio.play('rifle_in', { vol: 1.8 }); this.audio.play('rifle_in', { vol: 1.6, delay: 0.12 }); this.audio.play('punch', { vol: 1.5, rate: 0.7, delay: 0.2 });
      setTimeout(() => this.ending(true, '사형'), 1400);
    }, 7000);
  }
  ending(death, verdict) {
    if (!death && this.prison) return this.toPrison(verdict);
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
  // ── 수배 등급(별 0~5) · 내 체력 · 경찰 사격 · 깡패 · 차 사고 · 교도소 ──
  get wanted() {
    const me = this;
    return { add(n, why) { if (me.inCourt || me.inPrison || me.arrested) return; me.charges.add(why); const old = me.lv; me.lv = Math.min(5, Math.max(me.lv, 0) + n); me.lvT = 0; me.starsHud(); if (me.lv > old) { toast(ic('siren') + `경찰이 쫓아요 · ${why}`, 'bad', 2000); if (me.lv >= 1) { me.game.violence = true; me.callPolice(); } if (me.lv >= 3 && me.backup < me.lv - 1) { me.backup++; setTimeout(() => me.policeArrive(true), 4000); } } }, get level() { return me.lv; } };
  }
  charge() { return this.kills ? '살인' : this.copAttacked ? '경찰관 폭행' : this.assaults ? '폭행' : [...this.charges][0] || '공무집행방해'; }
  starsHud() { const el = $('stars'); if (el) el.innerHTML = ''; }   // 수배 별 표시는 없앰 (경찰 추적은 그대로)
  hpHud() { const el = $('hpbar'); if (el) { el.style.setProperty('--hp', Math.max(0, this.hp) + '%'); el.classList.toggle('low', this.hp < 35); } }
  hurtMe(dmg, from) {
    if (this.dead || this.inCourt || this.arrested) return; this.hp -= dmg; this.hurtT = 0; this.hpHud();
    const f = $('hurtfx'); if (f) { f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
    this.audio.play(Math.random() < 0.5 ? 'hurt_m1' : 'hurt_m2', { vol: 0.9, rate: 1 + Math.random() * 0.1 }); this.look.pitch += 0.03; this.look.yaw += (Math.random() - 0.5) * 0.05;
    if (this.hp <= 0) this.wasted();
  }
  wasted() {
    this.dead = true; this.firing = false; this.mover.enabled = false; this.drive?.ride && this.drive.exit?.();
    $('fade').classList.add('on'); toast('<b style="font-size:22px">사망</b><br>응급실로 옮겨졌습니다', 'bad', 3000);
    setTimeout(() => { for (const o of this.officers) o.dispose(); this.officers = []; for (const P of this.cars || []) { P.siren.stop(); P.car.removeFromParent(); } this.cars = []; this.called = false; this.backup = 0;
      this.lv = 0; this.starsHud(); this.hp = 100; this.hpHud(); this.dead = false; this.yawObj.position.set(1.1, 1.55, 6.2); this.look.yaw = Math.PI; this.look.pitch = 0;
      this.money?.(-30000, '병원비'); $('fade').classList.remove('on'); this.mover.enabled = true; toast('달빛병원에서 퇴원했어요 (병원비 -30,000원)', '', 2600); }, 3200);
  }
  playerUpdate(dt) {
    if ((this.hurtT += dt) > 5 && this.hp < 100 && !this.dead) { this.hp = Math.min(100, this.hp + dt * 2); this.hpHud(); }
    // 별 내려가기: 경찰이 가까이 없으면 25초마다 하나씩
    if (this.lv > 0 && !this.arrested && !this.inCourt) {
      const me = this.yawObj.position, near = this.officers.some(o => !o.dead && o.root.position.distanceTo(me) < 40);
      if (!near && (this.lvT += dt) > (this.kills > 0 ? 60 : 25)) { this.lvT = 0; this.lv--; this.starsHud(); if (!this.lv) { toast('경찰 추적이 끝났어요', 'good', 1800); this.called = false; this.backup = 0; for (const o of this.officers) o.chase = false; } }
      if (near) this.lvT = 0;
    }
  }
  // 경찰이 총을 겨누고 쏨 (별 3개 이상)
  shootAt(o, dt) {
    const me = this.yawObj.position; o.lookAt(me); o.pause?.(true);
    if (!o.gun) { o.gun = makePistol(); o.gun.scale.setScalar(1); this.scene.add(o.gun); }
    const hp = o.rHand?.getWorldPosition(V3()) || o.root.position.clone().add(V3(0, 1.3, 0)); o.gun.position.copy(hp); o.gun.lookAt(me); o.gun.rotateY(Math.PI);
    o.reach(me.clone().setY(me.y - 0.2), 400);
    if ((o.shootT = (o.shootT ?? 1) - dt) < 0) {
      o.shootT = 1.1 + Math.random() * 1.2; this.audio.play('pistol_shot', { pos: hp, vol: 1.6, rate: 0.95 + Math.random() * 0.1 }); this.fx.muzzle(o.gun);
      const d = o.root.position.distanceTo(me); if (Math.random() < 0.55 - d * 0.015) this.hurtMe(9 + Math.random() * 7, o.root.position); else this.audio.play('whoosh', { pos: me.clone().add(V3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2)), vol: 0.7, rate: 1.8 });
    }
    if (o.root.position.distanceTo(me) < 7) { o.pause?.(false); return false; }
    return true;
  }
  // 깡패: 시비 걸고 주먹질 / 총을 가진 놈은 쏨
  provoke(c) {
    if (c.dead || c.aggro || c.down) return; c.aggro = true; c.state = 'fight'; c.person.pause?.(false); c.person.PT.phone = 0; c.person.keepPhone = false; c.person.fidget = false; c.person.speed = 3.2;
    this.game.say(c, pk([['야, 너 지금 나 쳤냐?', 'angry'], ['이게 미쳤나… 오늘 임자 만났다.', 'angry'], ['뭘 봐? 한판 붙자는 거야?', 'angry'], ['너 죽었어, 이 새끼야!', 'angry']]));
  }
  fight(c, dt) {
    const P = c.person, me = this.yawObj.position, d = P.root.position.distanceTo(V3(me.x, P.root.position.y, me.z));
    if (c.hp !== undefined && c.hp < 35 && !c.down) { c.aggro = false; c.state = 'walk'; P.speed = 3.6; this.peds?.flee(c); return; }
    if (d > 35 || this.inCourt || this.arrested) { c.aggro = false; c.state = 'walk'; return; }
    if (c.armed && d < 12 && d > 3) { P.pause?.(true); P.lookAt(me); if (!c.gun) { c.gun = makePistol(); this.scene.add(c.gun); } const hp = P.rHand.getWorldPosition(V3()); c.gun.position.copy(hp); c.gun.lookAt(me); c.gun.rotateY(Math.PI); P.reach(me, 400);
      if ((c.shootT = (c.shootT ?? 0.8) - dt) < 0) { c.shootT = 1.3 + Math.random(); this.audio.play('pistol_shot', { pos: hp, vol: 1.5, rate: 0.97 + Math.random() * 0.06 }); this.fx.muzzle(c.gun); if (Math.random() < 0.45) this.hurtMe(8 + Math.random() * 6); } return; }
    P.pause?.(false);
    if (d > 1.1) { if (!P.path.length || (c.chaseT = (c.chaseT || 0) - dt) < 0) { c.chaseT = 0.5; P.walk([V3(me.x, P.root.position.y, me.z)]); } }
    else { P.path = []; P.lookAt(me); if ((c.punchT = (c.punchT ?? 0.4) - dt) < 0) { c.punchT = 0.9 + Math.random() * 0.5; P.reach(me.clone().setY(me.y - 0.25), 350); setTimeout(() => { if (!c.dead && P.root.position.distanceTo(V3(me.x, P.root.position.y, me.z)) < 1.5) { this.audio.play('punch', { vol: 1.1, rate: 0.9 + Math.random() * 0.2 }); this.hurtMe(7 + Math.random() * 5); } }, 180); } }
  }
  // 총 맞은 차: 탄흔이 차에 붙어 다니고, 유리는 금 가고, 많이 맞으면 연기 나며 멈춤 (운전자는 도망)
  carDamage(v, hit, decal) {
    if (decal) hit.object.attach(decal);
    const glass = /glass/i.test(hit.object.material?.name || '') || hit.object.material?.transparent;
    this.audio.play(glass ? 'bill' : 'key', { pos: hit.point, vol: glass ? 0.9 : 1, rate: glass ? 2.2 : 1.7 + Math.random() * 0.4 });
    if (glass) { const cr = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), CRACK()); cr.position.copy(hit.point); const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : V3(0, 1, 0); cr.lookAt(hit.point.clone().add(n)); cr.position.addScaledVector(n, 0.004); this.scene.add(cr); hit.object.attach(cr); }
    v.dmg = (v.dmg || 0) + 1;
    if (v.dmg >= 3 && !v.stopped && !v.parked) { v.stopped = true; v.taken = true; v.parked = true; v.cur = 0; const S = v.mesh.userData.size || { x: 2, z: 4 }; this.peds?.addFleeing(v.mesh.localToWorld(V3(S.x / 2 + 0.9, 0, S.z * 0.1)), this.yawObj.position.clone()); if (v.snd) v.snd.stop?.(); }
    if (v.dmg >= 7) (this.smoking ||= new Set()).add(v);
  }
  // 차에 치임 (지나가는 차 / 내가 운전한 차)
  carHit(c, dir, speed, byMe) {
    if ((c.carT || 0) > performance.now()) return; c.carT = performance.now() + 900;
    const p = c.person; p.knock(dir.clone().multiplyScalar(speed * 0.7).add(V3(0, 0, 0)));
    this.audio.play('hit', { pos: p.root.position, vol: 1.4, rate: 0.7 }); this.audio.play('thud', { pos: p.root.position, vol: 1.2, rate: 0.6, delay: 0.25 });
    if (c.dead) return;
    this.fx.blood(p.root.position.clone().add(V3(0, 1, 0)), dir, 10);
    c.hp = (c.hp ?? 100) - speed * 9;
    if (byMe) { this.wanted.add(1, '교통사고'); this.game.violence = true; }
    if (c.hp <= 0) this.kill(c, { zone: 'chest', side: 'R', dir: dir.clone(), accident: !byMe });
    else { this.vox(c, 'hurt'); p.goDown(Math.random() < 0.5 ? 'L' : 'R'); c.down = true; c.done = true; setTimeout(() => !c.dead && this.game.say(c, pk([['아아악… 다리…!', 'sad'], ['누가… 구급차 좀…', 'sad'], ['으윽… 차가… 차가…', 'sad']])), 700); }
    this.peds?.gunshot(p.root.position.clone());
  }
  // ── 교도소: 호송 → 감방 → 환풍구 → 운동장(교도관·탐조등 피하기) → 개구멍 → 탈옥 ──
  toPrison(verdict) {
    const pr = this.prison; this.firing = false; document.body.classList.remove('court-mode');
    for (const c of this.courtPeople) c.person.dispose(); this.courtPeople = []; this.inCourt = false; this.chaos = false;
    try { localStorage.removeItem('ns_guns'); } catch (e) { } this.setWeapon('fist'); $('bWpn').classList.add('hidden');
    $('fade').classList.add('on'); this.audio.play('door', { vol: 1, rate: 0.5 });
    setTimeout(() => {
      this.yawObj.position.copy(pr.van).add(V3(0.4, 1.25, 0)); this.look.yaw = Math.PI / 2; this.look.pitch = -0.05; $('fade').classList.remove('on');
      const eng = this.audio.play('engine', { loop: true, vol: 1.2, rate: 0.42 }); this.vanT = 0;
      this.game.say({ type: { name: '호송 교도관', id: 'guard' }, person: { talk: 0, gesture() { }, smile: 0 }, voice: [0.92, 1.0], gender: 'm', vIdx: 4 }, [`${verdict}. 이제부터 넌 수용번호 2611번이다. 조용히 앉아 있어.`, 'calm']);
      setTimeout(() => { eng?.stop?.(); $('fade').classList.add('on'); setTimeout(() => this.inCell(), 1200); }, 7000);
    }, 1400);
  }
  inCell() {
    const pr = this.prison; this.inPrison = true; this.arrested = false; this.ventN = 0; pr.vent.position.y = 0.5; pr.vent.rotation.x = 0; pr.vent.visible = true;
    this.yawObj.position.copy(pr.cellPos(1)); this.look.yaw = Math.PI; this.look.pitch = 0; this.look.frozen = false; this.hands.enabled = true; this.hands.body.visible = true;
    this.mover.enabled = true; this.game.running = true; this.game.freeRoam = true; this.game.violence = true; show('hud'); this.lv = 0; this.starsHud();
    if (!this.prisonGuards.length) for (const route of this.prison.patrols) { const o = new Person(POLICE, this.audio); o.root.position.copy(route[0]); this.scene.add(o.root); o.speed = 1.1; o.ref = { type: { ...POLICE, name: '교도관' }, person: o, voice: POLICE.voice, gender: 'm', vIdx: 4, mood: 50 }; o.patrol = route; o.pi = 0; this.prisonGuards.push(o); }
    // 옆 감방 수용자들 (철창 앞에 서서 복도를 봄, 가끔 말 걸기)
    if (!this.inmates.length) this.prison.inmateSpots.forEach((pos, i) => { const t = { ...INMATE, top: ['#6f8295', '#7a8a7a', '#6f8295', '#857a6a'][i], bottom: ['#6f8295', '#7a8a7a', '#6f8295', '#857a6a'][i], hat: null }, o = new Person(t, this.audio); o.root.position.copy(pos); this.scene.add(o.root); o.lookAt(pos.clone().add(V3(Math.random() - 0.5, 1.6, 3))); o.fidget = true; o.ref = { type: t, person: o, voice: [0.86 + i * 0.05, 0.98], gender: 'm', vIdx: i + 1, mood: 50 }; this.inmates.push(o); });
    this.inmateT = 3; this.hands.prison?.(true);
    $('fade').classList.remove('on'); this.audio.play('door', { vol: 1, rate: 0.45 }); this.audio.play('thud', { vol: 1, rate: 0.5 });
    toast(ic('warn') + '교도소에 수감됐어요. 침대 옆 환풍구를 살펴보세요…', '', 4000); this.onPrison?.();
    setTimeout(() => this.inmates[0] && this.game.say(this.inmates[0].ref, ['어이 신입, 들어왔냐? 여기선 조용히 지내는 게 신상에 좋아.', 'calm']), 2500);
  }
  ventTry() {
    const pr = this.prison; this.ventN++; this.audio.play('key', { vol: 1, rate: 0.35 + Math.random() * 0.1 }); this.audio.play('thud', { vol: 0.5, rate: 2 });
    pr.vent.rotation.x = -0.12 * this.ventN;
    if (this.ventN < 3) { toast(`환풍구 나사가 헐거워진다… (${this.ventN}/3)`, '', 1300); return; }
    pr.vent.visible = false; this.audio.play('thud', { vol: 0.9, rate: 1.6 }); toast('환풍구가 열렸다! 기어서 밖으로…', 'good', 1800);
    this.mover.enabled = false; $('fade').classList.add('on');
    setTimeout(() => { this.yawObj.position.copy(pr.ductOut); this.look.yaw = 0; $('fade').classList.remove('on'); this.mover.enabled = true; toast('운동장이다. 탐조등과 교도관 눈을 피해 북서쪽 울타리 개구멍으로!', '', 4200); this.inYard = true; }, 1600);
  }
  prisonUpdate(dt) {
    const pr = this.prison, me = this.yawObj.position, cam = this.camera.getWorldPosition(V3());
    for (const o of this.prisonGuards) { if (!o.path.length) { o.pi = (o.pi + 1) % o.patrol.length; o.walk([o.patrol[o.pi]]); } o.update(dt, cam); }
    const front = V3(me.x, me.y, (pr.inmateSpots[0]?.z || me.z) + 2.5); for (const o of this.inmates) { if (!this.inYard) o.lookAt(front); o.update(dt, cam); }
    if (this.inPrison && !this.inYard && (this.inmateT -= dt) < 0 && this.inmates.length) { this.inmateT = 14 + Math.random() * 12; const o = this.inmates[Math.random() * this.inmates.length | 0]; if (o.root.position.distanceTo(me) < 14) this.game.say(o.ref, INMATE_LINES[Math.random() * INMATE_LINES.length | 0]); }
    if (!this.inYard || this.caught) return;
    const tgtW = pr.spotPos || V3(1e9, 0, 0);
    let seen = Math.hypot(me.x - tgtW.x, me.z - tgtW.z) < 2.8;
    for (const o of this.prisonGuards) { const v = me.clone().sub(o.root.position).setY(0), d = v.length(), f = o.root.getWorldDirection(V3()); if (d < 9 && v.normalize().dot(f) > 0.75) seen = true; }
    if (seen) { this.caught = true; const s = this.audio.siren(() => me); toast(ic('siren') + '들켰다! 교도관: "거기 서!"', 'bad', 2200); this.mover.enabled = false;
      setTimeout(() => { s.stop(); $('fade').classList.add('on'); setTimeout(() => { this.caught = false; this.inYard = false; this.inCell(); toast('다시 감방이다… 환풍구는 아직 헐거워.', '', 2500); }, 1300); }, 1600); }
  }
  escape() {
    this.inYard = false; this.inPrison = false; this.mover.enabled = false; $('fade').classList.add('on'); this.audio.play('bag', { vol: 1, rate: 0.7 });
    toast('<b>탈옥 성공!</b> 어둠 속으로 달아났다…', 'good', 3000);
    setTimeout(() => { for (const o of [...this.prisonGuards, ...this.inmates]) o.dispose(); this.prisonGuards = []; this.inmates = []; this.hands.prison?.(false); this.yawObj.position.copy(this.prison.outside); this.look.yaw = 0; this.look.pitch = 0; this.called = false; this.backup = 0;
      $('fade').classList.remove('on'); this.mover.enabled = true; this.lv = 0; this.wanted.add(3, '탈옥수'); this.onEscape?.(); }, 2600);
  }
  cleanup() {
    for (const P of this.cars || []) { P.siren.stop(); P.car.removeFromParent(); } this.cars = [];
    for (const o of this.officers) o.dispose(); this.officers = [];
    for (const c of this.courtPeople) c.person.dispose(); this.courtPeople = [];
    this.fx.clear(); document.body.classList.remove('court-mode'); for (const k of ['pistol', 'rifle']) this.guns[k]?.removeFromParent();
    this.look.frozen = false; this.hands.enabled = true; this.reset();
  }
}
