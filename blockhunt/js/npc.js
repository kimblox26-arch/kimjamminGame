// NPC: 감정(공포·분노·슬픔·기쁨·고통)을 가지고, 말하고, 도망치고, 싸우고, 무기를 빼앗아 위협하거나 쏜다
import * as THREE from 'three';
import { G } from './game.js';
import { Avatar } from './avatar.js';
import { buildModel, fireHitscan, shootArrow, dropPickup, muzzleFlash } from './weapons.js';
import { Sound } from './audio.js';
import { clamp, damp, rand, pick, chance, angDiff } from './util.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const NAMES = ['민준', '서연', '지호', '하은', '도윤', '수아', '예준', '지우', '시우', '서윤', '주원', '하린', '유준', '지아', '은우', '채원',
  '건우', '다은', '현우', '소율', '태양', '나래', '진수', '미나', '동현', '유나', '승민', '예린'];
const NAME_COLORS = ['#fd2943', '#01a2ff', '#02b857', '#a75ec2', '#f58a3d', '#f7d23e', '#e8b0c3', '#d7c59a'];
const SCARED = ['flee', 'cower', 'surrender', 'beg'];
const HOSTILE = ['attack', 'threaten', 'shoot'];
const LINES = {
  greet: ['안녕하세요!', '안녕!', '반가워요!'],
  small: [['오늘 날씨 좋다!', '그러게, 하늘이 엄청 파래.'], ['배고프다...', '이따가 같이 뭐 먹으러 가자.'], ['요즘 뭐 하고 지내?', '그냥 산책하고 있어.'], ['여기 자주 와?', '응, 넓어서 좋아.']],
  scared: ['으악!', '살려주세요!', '도망쳐!!', '총이다!!', '저 사람 미쳤어!'],
  beg: ['제발 쏘지 마세요...', '살려주세요, 제발...', '아무것도 안 했어요!', '가족이 있어요...!'],
  angry: ['너 뭐야?!', '가만 안 둬!', '덤벼 봐!'],
  threat: ['총 내려놔!', '움직이지 마!', '한 발짝만 더 와 봐!', '손 들어!'],
  steal: ['이리 내!', '내 거야 이제!', '이건 내가 가져간다!'],
  shoot: ['받아라!', '각오해!'],
  pain: ['아악!', '으윽...', '아파...!', '아아악!!'],
  leg: ['다리가...!', '다리가 안 움직여...'],
  crawl: ['누가... 도와줘...', '살려줘...', '아파... 너무 아파...'],
  mourn: ['안 돼... 일어나...', '왜 이런 짓을...!', '흐흑...'],
  witness: ['사람이 죽었어!!', '방금 쏜 거야?!', '꺄아악!'],
  car: ['차 온다!!', '피해!!'],
  calm: ['휴... 살았다.', '이제 괜찮겠지...'],
  bump: ['어이! 조심해!', '아야!'],
};

export class NPC {
  constructor(pos) {
    this.name = pick(NAMES);
    this.color = pick(NAME_COLORS);
    this.avatar = new Avatar(this);
    this.avatar.root.position.copy(pos);
    this.heading = rand(0, 6.28);
    this.avatar.root.rotation.y = this.heading;
    G.scene.add(this.avatar.root);
    for (const m of this.avatar.parts) G.hitList.push(m);
    this.pos = this.avatar.root.position;
    this.vel = V(); this.onGround = true;
    this.health = 100; this.legHP = 100; this.alive = true; this.bleed = 0; this.wounds = [];
    this.emo = { fear: 0, anger: 0, sad: 0, joy: rand(0.2, 0.6), pain: 0 };
    this.trait = { brave: rand(0, 1), aggro: rand(0, 1), social: rand(0.2, 1) };
    const hi = chance(0.5);
    this.voice = { f0: hi ? rand(190, 240) : rand(95, 135), fmt: hi ? 1.15 : 1, sp: hi ? rand(1.1, 1.5) : rand(0.6, 0.95), rate: rand(0.95, 1.15) };
    this.state = 'wander'; this.stateT = 0; this.goal = null; this.idleT = rand(0, 3);
    this.hostile = 0; this.aimedT = 0; this.think = rand(0, 0.3);
    this.weapon = null; this.model = null; this.fireCD = 0; this.aimT = 0;
    this.down = false; this.downT = 0; this.crawl = false; this.getupT = 0; this.deadT = 0;
    this.sayCD = rand(1, 4); this.screamCD = 0; this.yellCD = 0;
    this.punchT = 0; this.punchCD = 0; this.punchHit = -1; this.stealCD = 1; this.grabT = 0;
    this.partner = null; this.lastThreat = null; this.corpse = null;
    this.dirCache = null; this.dirT = 0; this.carCD = 0; this.trailT = 0; this.lastHitT = -9;
    this.pose = {};
  }

  chest() {
    const r = this.avatar.rag;
    if (r) return r.p[1].clone().lerp(r.p[0], 0.4);
    return this.pos.clone().setY(this.pos.y + (this.crawl ? 0.8 : 3.3));
  }
  headPos() { return this.avatar.rag ? this.avatar.rag.p[2].clone() : this.pos.clone().setY(this.pos.y + (this.crawl ? 1 : 4.7)); }

  equip(w) {
    this.weapon = w;
    this.model = buildModel(w.def.id);
    if (w.def.id === 'bow') this.model.scale.setScalar(0.8);
    this.avatar.hold(this.model);
  }
  dropWeapon() {
    if (!this.weapon) return;
    dropPickup(this.weapon, this.model ? this.model.getWorldPosition(V()) : this.pos.clone());
    this.avatar.hold(null);
    this.weapon = null; this.model = null;
  }

  // 말하기: 머리 위 말풍선 + 채팅창 + 실제 목소리
  say(cat, prio = 1, force = false) {
    if (!this.alive || (!force && this.sayCD > 0)) return;
    const text = LINES[cat] ? pick(LINES[cat]) : cat;
    this.sayCD = rand(3, 6);
    G.ui.bubble(this, text);
    if (this.pos.distanceTo(G.player.pos) < 70) G.ui.chat(this.name, text, this.color);
    Sound.speak(text, this.voice, this.headPos(), prio);
  }
  scream(kind = 'scream') {
    if (this.screamCD > 0) return;
    Sound.voice(kind, this.headPos(), this.voice);
    this.screamCD = rand(2.5, 5.5);
  }
  setState(s) {
    if (s === this.state) return;
    const prev = this.state;
    this.state = s; this.stateT = 0; this.goal = null; this.aimT = 0;
    if (prev === 'chat') {
      const o = this.partner;
      this.partner = null; this.chatLead = false;
      if (o && o.partner === this && o.state === 'chat') o.setState('wander');
    }
    switch (s) {
      case 'flee': if (chance(0.6)) this.say('scared', 2); if (this.emo.fear > 0.5) this.scream(); break;
      case 'beg': case 'surrender': this.say('beg', 3, true); break;
      case 'attack': this.say('angry', 2); Sound.voice('yell', this.headPos(), this.voice); this.yellCD = rand(3, 6); break;
      case 'threaten': this.say('threat', 3, true); break;
      case 'shoot': if (chance(0.5)) this.say('shoot', 2); break;
      case 'mourn': this.say('mourn', 1); break;
    }
  }

  // 소리·사건을 듣고 감정이 바뀐다
  hear(ev) {
    if (!this.alive) return;
    const d = ev.pos ? this.pos.distanceTo(ev.pos) : 999;
    const E = this.emo, br = this.trait.brave, byP = ev.source === G.player || ev.killer === G.player || ev.attacker === G.player;
    let k;
    switch (ev.type) {
      case 'shot':
        if (d > 130 || ev.source === this || (ev.quiet && d > 25)) return;
        k = 1 - d / 130;
        E.fear += (0.5 * (1 - br) + 0.1) * k; E.anger += br * this.trait.aggro * 0.25 * k;
        if (byP && d < 90) { this.hostile = Math.min(1, this.hostile + 0.2 * k); this.lastThreat = ev.pos.clone(); }
        break;
      case 'whiz':
        E.fear += 0.5 * (1 - br) + 0.15; this.hostile = Math.min(1, this.hostile + 0.3); this.lastThreat = ev.pos.clone();
        if (chance(0.5)) this.say('scared', 2);
        break;
      case 'death':
        if (d > 80 || ev.victim === this) return;
        k = 1 - d / 80;
        E.fear += (0.7 * (1 - br) + 0.2) * k; E.sad += 0.5 * k + (ev.victim === this.partner ? 0.5 : 0); E.anger += br * 0.5 * k;
        if (byP) { this.hostile = Math.min(1, this.hostile + 0.7 * k); this.lastThreat = G.player.pos.clone(); }
        this.corpse = ev.victim;
        if (chance(0.6 * k)) { this.say('witness', 2); if (E.fear > 0.5) this.scream(); }
        break;
      case 'hurt':
        if (d > 50 || ev.victim === this) return;
        k = 1 - d / 50;
        E.fear += 0.35 * (1 - br) * k; E.anger += 0.2 * br * k;
        if (byP) { this.hostile = Math.min(1, this.hostile + 0.4 * k); this.lastThreat = G.player.pos.clone(); }
        break;
    }
    for (const key in E) E[key] = clamp(E[key], 0, 1);
    this.think = Math.min(this.think, 0.05);
  }

  // 플레이어가 채팅으로 말을 걸면 대답
  respond(text) {
    if (!this.alive || this.down) return;
    const E = this.emo, t = text.toLowerCase();
    let r = null;
    if (/안녕|하이|ㅎㅇ|hello|\bhi\b|반가/.test(t)) r = E.fear > 0.4 ? '...가까이 오지 마세요!' : this.hostile > 0.5 ? '꺼져!' : pick(LINES.greet);
    else if (/이름|누구/.test(t)) r = `저는 ${this.name}이에요.`;
    else if (/미안|죄송|sorry/.test(t)) { this.hostile = Math.max(0, this.hostile - 0.35); E.anger *= 0.5; r = this.hostile > 0.4 ? '말로만...?' : '...다신 그러지 마요.'; }
    else if (/죽|kill|쏜다|쏠|쏴/.test(t)) {
      if (this.trait.brave > 0.65) { E.anger = Math.min(1, E.anger + 0.3); r = '해볼 테면 해봐!'; }
      else { E.fear = Math.min(1, E.fear + 0.4); r = pick(['히익...!', '제발 그러지 마세요!', '살려주세요!']); }
    } else if (/뭐해|뭐 해|뭐하/.test(t)) r = pick(['그냥 산책 중이에요.', '친구 기다리는 중이에요.']);
    else if (/바보|멍청/.test(t)) { E.anger = Math.min(1, E.anger + 0.3); r = pick(['뭐라고?!', '너나 잘해!']); }
    else if (chance(0.5)) r = pick(['네?', '뭐라고요?', '그렇군요.', '음...']);
    if (r) this.say(r, 1, true);
  }

  // 0.25초마다: 상황 판단 → 행동 결정
  decide() {
    const P = G.player, E = this.emo, t = this.trait;
    const dP = P.alive ? this.pos.distanceTo(P.pos) : 999;
    const pArmed = P.alive && !!P.weapon() && !P.car;
    const aimed = dP < 120 && pArmed && P.aimingAt(this);
    if (aimed) { E.fear += 0.3 * (1 - t.brave) + 0.04; this.aimedT += 0.25; if (t.brave > 0.6) E.anger += 0.06; }
    else this.aimedT = Math.max(0, this.aimedT - 0.25);
    for (const o of G.npcs) if (o !== this && o.alive && o.emo.fear > 0.75 && o.pos.distanceTo(this.pos) < 15) { E.fear += 0.03 * (1 - t.brave); break; }
    this.checkCars();
    for (const key in E) E[key] = clamp(E[key], 0, 1);
    if (this.down || this.crawl || this.getupT > 0) return;

    const threatened = P.alive && (this.hostile > 0.3 || this.aimedT > 0.5);
    if (threatened) this.lastThreat = P.pos.clone();
    const fight = E.anger * 0.7 + t.brave * 0.5 + t.aggro * 0.35 + (this.weapon ? 0.45 : 0) - E.fear * 0.75 - E.pain * 0.3;
    let next = this.state;
    if (threatened && dP < 140) {
      if (this.weapon) next = fight > 0.25 ? (this.hostile > 0.65 || P.shotRecently() || this.aimedT > 2.5 || (this.state === 'shoot' && this.stateT < 8) ? 'shoot' : 'threaten') : 'flee';
      else if (fight > 0.5 && dP < 50) next = 'attack';
      else if (E.fear > 0.7 && dP < 12 && this.aimedT > 0.5) next = t.brave < 0.35 ? 'beg' : 'surrender';
      else if (this.state === 'cower' && this.stateT < 5) next = 'cower';
      else if (E.fear > 0.85 && dP < 25 && chance(0.12)) next = 'cower';
      else if ((this.state === 'beg' || this.state === 'surrender') && this.aimedT > 0) next = this.state;
      else if (E.fear > 0.2 || this.aimedT > 0) next = 'flee';
      else next = 'watch';
    } else if (E.fear > 0.4 && this.lastThreat) next = 'flee';
    else if (E.sad > 0.5 && this.corpse && !this.corpse.removed && this.corpse.pos.distanceTo(this.pos) < 45) next = 'mourn';
    else if (SCARED.includes(this.state) || HOSTILE.includes(this.state) || this.state === 'watch') {
      next = 'wander';
      if (this.state === 'flee' && chance(0.4)) this.say('calm');
    }
    if (next !== this.state) this.setState(next);
  }

  findPartner() {
    let best = null, bd = 25;
    for (const o of G.npcs) {
      if (o === this || !o.alive || o.state !== 'wander' || o.down || o.crawl || o.emo.fear > 0.2) continue;
      const d = o.pos.distanceTo(this.pos);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  startChat(o) {
    this.setState('chat'); o.setState('chat');
    this.partner = o; o.partner = this; this.chatLead = true; o.chatLead = false;
    this.chatLines = [pick(LINES.greet), pick(LINES.greet), ...pick(LINES.small)];
    this.chatI = 0; this.chatT = 1;
  }
  // 달려오는 차를 보면 겁먹고 도망
  checkCars() {
    for (const c of G.cars) {
      if (Math.abs(c.speed) < 12) continue;
      const rel = this.pos.clone().sub(c.pos), f = c.forward(), r = c.right();
      const lz = rel.dot(f) * Math.sign(c.speed), lx = rel.dot(r);
      if (lz > 0 && lz < 45 && Math.abs(lx) < 8) {
        this.emo.fear = Math.min(1, this.emo.fear + 0.25);
        this.lastThreat = c.pos.clone();
        if (lz < 30 && this.sayCD <= 0) { this.say('car', 3); this.scream(); }
      }
    }
  }
  // 경계를 피해 가는 방향 고르기
  steer(want, dt) {
    this.dirT -= dt;
    if (this.dirT > 0 && this.dirCache) return this.dirCache.clone();
    this.dirT = 0.25;
    const base = Math.atan2(want.x, want.z);
    let best = want.clone(), bs = -1e9;
    for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3, 3.14]) {
      const a = base + off, d = V(Math.sin(a), 0, Math.cos(a));
      const free = G.world.edgeDist(this.pos, d, 10);
      const sc = Math.cos(off) + (free / 10) * 1.4 - (free < 2.5 ? 2 : 0);
      if (sc > bs) { bs = sc; best = d; }
    }
    this.dirCache = best;
    return best.clone();
  }

  tryFire() {
    const w = this.weapon, d = w.def;
    if (this.fireCD > 0 || !this.model) return;
    this.model.updateWorldMatrix(true, false);
    const mz = this.model.localToWorld(this.model.userData.muzzle.clone());
    const P = G.player, target = P.eye().add(V(0, -1.4, 0));
    const dist = mz.distanceTo(target), err = 0.045 * dist * (P.moving ? 1.6 : 1);
    target.add(V(rand(-err, err), rand(-err, err) * 0.6, rand(-err, err)));
    if (d.type === 'bow') {
      const sp = 170, tt = dist / sp;
      target.y += 0.5 * 45 * tt * tt;
      shootArrow(mz, target.sub(mz).normalize(), sp, d.npcDmg, this);
      Sound.bow(mz); this.fireCD = 1.6;
    } else {
      fireHitscan(mz, target.sub(mz).normalize(), w, this);
      Sound.gun(mz); muzzleFlash(mz);
      this.fireCD = d.rate * rand(3, 5);
    }
    G.emit({ type: 'shot', pos: mz, source: this });
  }
  // 플레이어 손에서 무기를 빼앗는다
  steal() {
    const w = G.player.takeWeapon();
    if (!w) return;
    this.equip(w);
    this.say('steal', 3, true);
    Sound.punch(this.pos);
    this.hostile = 1; this.emo.anger = Math.min(1, this.emo.anger + 0.3);
    this.setState('threaten');
  }
  trip() {
    Sound.voice('grunt', this.headPos(), this.voice);
    this.knockDown(this.vel.clone().multiplyScalar(0.4).add(V(0, 5, 0)));
  }
  knockDown(v, point, imp) {
    if (this.down) { this.avatar.startRagdoll(v, point, imp); return; }
    this.down = true; this.downT = 0; this.getupT = 0;
    this.avatar.startRagdoll(v.clone().add(this.vel), point, imp);
    if (this.weapon && chance(0.5)) this.dropWeapon();
  }

  // 맞았을 때: 상처·피·비명·쓰러짐·장기
  hit(info) {
    const { part, point, dir, attacker } = info;
    const av = this.avatar, gore = G.gore;
    const mult = part === 'head' ? 3.2 : part === 'torso' ? 1 : part === 'arm' ? 0.65 : 0.75;
    const dmg = info.dmg * mult;
    if (info.mesh && info.localNormal) gore.wound(info.mesh, point, info.localNormal, part === 'head' ? 0.4 : rand(0.4, 0.58));
    const n = Math.round(clamp(dmg / 4, 4, 28));
    gore.spray(point, dir, n, 14, { size: 0.2, mark: 0.6 });
    gore.spray(point, dir.clone().negate(), Math.ceil(n / 3), 6, { size: 0.16 });
    const fresh = G.time - this.lastHitT > 0.08;
    this.lastHitT = G.time;
    if (fresh) Sound.flesh(point, dmg > 40);
    const lethal = this.alive && this.health - dmg <= 0;
    if (part === 'torso' && !this.organsOut && (dmg >= 50 || (lethal && chance(0.5)))) { this.organsOut = true; gore.organs(av, point, dir); }
    if (!this.alive) { av.startRagdoll(V(), point, dir.clone().multiplyScalar(info.force || 15)); return; }
    this.health -= dmg;
    this.bleed = Math.min(6, this.bleed + dmg * 0.025 + (this.organsOut ? 2 : 0));
    this.emo.pain = 1;
    if (attacker === G.player) this.hostile = 1;
    const br = this.trait.brave;
    this.emo.fear = Math.min(1, this.emo.fear + 0.35 * (1 - br) + 0.15);
    this.emo.anger = Math.min(1, this.emo.anger + 0.35 * br + 0.2 * this.trait.aggro);
    if (attacker) this.lastThreat = (attacker.pos || point).clone();
    if (part === 'leg') this.legHP -= dmg * 1.3;
    if (part === 'arm' && this.weapon && chance(0.45)) this.dropWeapon();
    av.flinch(dir, part);
    G.emit({ type: 'hurt', pos: this.pos.clone(), victim: this, attacker });
    if (this.health <= 0) { this.die(info); return; }
    if (fresh) {
      if (dmg > 30 || chance(0.5)) { this.screamCD = 0; this.scream(dmg > 35 ? 'scream' : 'pain'); }
      else Sound.voice('grunt', this.headPos(), this.voice);
      if (chance(0.35)) this.say(part === 'leg' && this.legHP < 40 ? 'leg' : 'pain', 2);
    }
    if (info.kind !== 'car' && !this.crawl && ((part === 'leg' && (this.legHP <= 0 || (dmg > 20 && chance(0.5)))) || dmg > 48 || this.health < 20)) {
      this.knockDown(dir.clone().multiplyScalar((info.force || 15) * 0.4).add(V(0, 3, 0)), point, dir.clone().multiplyScalar(info.force || 15));
    }
    this.think = 0;
  }
  // 자동차에 치였을 때
  carHit(car, vel) {
    if (this.carCD > 0.5) return;
    this.carCD = 1;
    const spd = vel.length(), point = this.chest(), dir = vel.clone().normalize();
    Sound.crash(point, 0.7); Sound.crack(point);
    if (!this.alive) { this.avatar.push(vel.clone().multiplyScalar(0.8).add(V(0, spd * 0.25, 0))); G.gore.spray(point, dir, 10, 10); return; }
    this.knockDown(vel.clone().multiplyScalar(1.05).add(V(0, 6 + spd * 0.35, 0)));
    this.hit({ part: 'torso', mesh: this.avatar.torso, point, localNormal: V(0, 0, 1), dir, dmg: Math.max(0, (spd - 5) * 1.6), attacker: car.driver, kind: 'car', weapon: 'car', force: 0 });
  }
  die(info) {
    this.alive = false; this.health = 0; this.deadT = 0;
    const av = this.avatar;
    av.setFace('dead');
    if (info.part !== 'head' && chance(0.7)) { this.screamCD = 0; this.scream('death'); }
    if (this.weapon) this.dropWeapon();
    const f = info.force ?? 15;
    if (!av.rag) av.startRagdoll((info.dir ? info.dir.clone().multiplyScalar(f * 0.4) : V()).add(this.vel).add(V(0, 2, 0)), info.point, info.dir ? info.dir.clone().multiplyScalar(f) : null);
    else if (info.point && info.dir && f) av.impulse(info.point, info.dir.clone().multiplyScalar(f));
    this.down = true;
    if (info.part === 'head' && info.point) G.gore.spray(info.point, info.dir || UP, 40, 18, { size: 0.22, mark: 0.7 });
    G.emit({ type: 'death', pos: this.pos.clone(), victim: this, killer: info.attacker });
    G.corpses.push(this);
  }
  dispose() {
    this.removed = true;
    this.avatar.root.removeFromParent();
    const set = new Set(this.avatar.parts);
    G.hitList = G.hitList.filter((m) => !set.has(m));
    G.gore.removeFor(this.avatar);
    G.ui.removeLabel(this);
    G.npcs.splice(G.npcs.indexOf(this), 1);
  }

  // 상태별 행동 → 원하는 이동 방향·속도·바라볼 곳
  behave(dt) {
    const P = G.player, E = this.emo, pose = this.pose;
    const toP = P.pos.clone().sub(this.pos).setY(0), dP = toP.length();
    let want = null, speed = 0, face = null;
    switch (this.state) {
      case 'wander': {
        if (this.goal && this.pos.distanceTo(this.goal) < 2.5) { this.goal = null; this.idleT = rand(1.5, 5); }
        if (!this.goal) {
          this.idleT -= dt;
          if (this.idleT <= 0) {
            const o = chance(this.trait.social * 0.45) ? this.findPartner() : null;
            if (o) { this.startChat(o); break; }
            this.goal = G.world.randomOpen(1.5, this.pos, 45);
          }
        }
        if (this.goal) { want = this.goal.clone().sub(this.pos).setY(0).normalize(); speed = 8; }
        if (dP < 12 && P.alive && this.hostile < 0.2 && E.fear < 0.2) {
          if (this.sayCD <= 0 && chance(dt * 0.25)) this.say('greet');
          if (!this.goal) face = P.pos;
        }
        break;
      }
      case 'chat': {
        const o = this.partner;
        if (!o || !o.alive || o.down || o.state !== 'chat' || this.stateT > 15) { this.setState('wander'); break; }
        if (this.pos.distanceTo(o.pos) > 6) { want = o.pos.clone().sub(this.pos).setY(0).normalize(); speed = 6; } else face = o.pos;
        E.joy = Math.min(1, E.joy + dt * 0.05);
        if (this.chatLead) {
          this.chatT -= dt;
          if (this.chatT <= 0 && this.chatI < this.chatLines.length) { (this.chatI % 2 ? o : this).say(this.chatLines[this.chatI], 0, true); this.chatI++; this.chatT = 2.8; }
          if (this.chatI >= this.chatLines.length && this.chatT <= 0) this.setState('wander');
        }
        break;
      }
      case 'watch':
        face = P.pos;
        if (dP < 9) { want = toP.clone().normalize().negate(); speed = 5; }
        break;
      case 'flee': {
        const away = this.pos.clone().sub(this.lastThreat || P.pos).setY(0);
        if (away.length() > 90 && E.fear < 0.35) { this.setState('wander'); break; }
        want = away.lengthSq() > 0.01 ? away.normalize() : V(Math.sin(this.heading), 0, Math.cos(this.heading));
        speed = 24 * (0.8 + 0.2 * this.trait.brave) * (this.legHP < 60 ? 0.6 : 1);
        pose.run = 1;
        pose.flail = E.fear > 0.8 && !this.weapon;
        if (E.fear > 0.55) this.scream();
        if (this.stateT > 1 && chance(dt * 0.03 * E.fear)) this.trip();
        break;
      }
      case 'cower':
        pose.mode = 'cower'; pose.shake = 1; face = P.pos;
        if (this.screamCD <= 0) { Sound.voice('sob', this.headPos(), this.voice); this.screamCD = rand(3, 6); }
        if (dP < 5 && chance(dt * 0.5)) this.setState('beg');
        break;
      case 'surrender':
        pose.handsUp = true; pose.shake = 0.5; face = P.pos; pose.hold = false;
        if (this.sayCD <= 0) this.say('beg', 3);
        break;
      case 'beg':
        pose.mode = 'kneel'; pose.shake = 0.4; face = P.pos;
        if (this.sayCD <= 0) this.say('beg', 3);
        if (this.screamCD <= 0 && chance(dt)) { Sound.voice('sob', this.headPos(), this.voice); this.screamCD = rand(4, 7); }
        break;
      case 'mourn': {
        const c = this.corpse;
        if (!c || c.removed) { this.setState('wander'); break; }
        const cp = c.avatar.ragCenter(), d = cp.clone().sub(this.pos).setY(0);
        if (d.length() > 3.5) { want = d.normalize(); speed = 8; }
        else {
          pose.mode = 'kneel'; pose.pose = 'mourn'; face = cp;
          if (this.screamCD <= 0) { Sound.voice('sob', this.headPos(), this.voice); this.screamCD = rand(3, 5); }
          if (this.sayCD <= 0 && chance(dt * 0.3)) this.say('mourn');
        }
        E.sad = Math.max(0, E.sad - dt * 0.02);
        if (this.stateT > 14 || E.sad < 0.3) { this.corpse = null; this.setState('wander'); }
        break;
      }
      case 'attack':
        if (!P.alive) { this.setState('wander'); break; }
        face = P.pos;
        if (dP > 3.3) { want = toP.clone().normalize(); speed = 22; pose.run = 1; }
        else if (this.punchCD <= 0) {
          if (P.weapon() && this.stealCD <= 0 && !P.car) {
            this.stealCD = 1.4; this.punchCD = 0.9; this.grabT = 0.45;
            if (chance(0.4 + this.trait.aggro * 0.2)) this.steal(); else { this.say('steal', 2); Sound.punch(P.pos); }
          } else { this.punchT = 0.45; this.punchCD = 1.0; this.punchHit = 0.17; }
        }
        if (this.yellCD <= 0) { Sound.voice('yell', this.headPos(), this.voice); this.yellCD = rand(3, 6); }
        break;
      case 'threaten':
        if (!this.weapon) { this.setState('attack'); break; }
        face = P.pos; pose.aim = true; pose.aimPitch = this.pitchTo(P.eye());
        if (this.sayCD <= 0) this.say('threat', 3);
        if (dP < 8) { want = toP.clone().normalize().negate(); speed = 5; }
        else if (dP > 30) { want = toP.clone().normalize(); speed = 9; }
        if (P.shotRecently() || this.aimedT > 2.5 || (dP < 5 && this.stateT > 2) || (this.stateT > 6 && this.trait.aggro > 0.6)) this.setState('shoot');
        else if (this.stateT > 8 && !P.weapon()) { this.hostile *= 0.4; this.setState('watch'); }
        break;
      case 'shoot':
        if (!this.weapon || !P.alive) { this.setState('wander'); break; }
        face = P.pos; pose.aim = true; pose.aimPitch = this.pitchTo(P.eye());
        if (dP > 45) { want = toP.clone().normalize(); speed = 12; }
        else if (dP < 6) { want = toP.clone().normalize().negate(); speed = 6; }
        else { want = V(toP.z, 0, -toP.x).normalize().multiplyScalar(Math.sin(this.stateT * 0.9) > 0 ? 1 : -1); speed = 4; }
        this.aimT += dt;
        if (this.aimT > 0.6) this.tryFire();
        break;
    }
    return { want, speed, face };
  }
  pitchTo(p) { const c = this.chest(), dx = Math.hypot(p.x - c.x, p.z - c.z); return Math.atan2(p.y - c.y, dx); }

  update(dt) {
    const av = this.avatar, E = this.emo;
    if (!this.alive) {
      if (av.rag) av.update(dt);
      this.deadT += dt;
      if (!this.pooled && av.rag && (av.settled || this.deadT > 3)) { this.pooled = true; G.gore.pool(av.ragCenter(), rand(4, 7)); }
      return;
    }
    for (const k of ['sayCD', 'screamCD', 'yellCD', 'punchCD', 'stealCD', 'fireCD', 'carCD', 'grabT', 'punchT']) this[k] -= dt;
    this.stateT += dt;
    if (this.punchHit > 0) {
      this.punchHit -= dt;
      if (this.punchHit <= 0) {
        const P = G.player;
        if (P.alive && P.pos.distanceTo(this.pos) < 4.5) { P.hurt(rand(7, 11), this.pos, this); P.knock(P.pos.clone().sub(this.pos).setY(0).normalize().multiplyScalar(26).add(V(0, 12, 0))); Sound.punch(P.pos); }
      }
    }
    E.fear = Math.max(0, E.fear - dt * 0.03 * (1 + this.trait.brave));
    E.anger = Math.max(0, E.anger - dt * 0.015); E.sad = Math.max(0, E.sad - dt * 0.012);
    E.pain = Math.max(0, E.pain - dt * 0.22); E.joy = damp(E.joy, 0.35, 0.1, dt);
    this.hostile = Math.max(0, this.hostile - dt * 0.006);
    if (this.bleed > 0) {
      this.health -= this.bleed * dt;
      this.bleed = Math.max(0, this.bleed - dt * 0.04);
      if (chance(dt * this.bleed * 1.5)) {
        const w = this.wounds.length ? pick(this.wounds).getWorldPosition(V()) : this.chest();
        G.gore.spray(w, V(0, -1, 0), 1, 1, { size: 0.15, mark: 1 });
      }
      if (this.health <= 0) { this.die({ kind: 'bleed', part: 'torso' }); return; }
    }
    this.think -= dt;
    if (this.think <= 0) { this.think = 0.25; this.decide(); }

    const pose = this.pose;
    pose.mode = 'stand'; pose.run = 0; pose.flail = pose.handsUp = pose.aim = false; pose.hold = !!this.weapon;
    pose.grab = this.grabT > 0; pose.shake = 0; pose.punch = this.punchT > 0 ? this.punchT / 0.45 : 0;
    pose.lookYaw = 0; pose.lookPitch = 0; pose.pose = null; pose.g = 0;

    if (this.down) {
      this.downT += dt;
      av.update(dt, pose);
      if (this.downT > 1.2 && av.settled) {
        this.heading = av.endRagdoll();
        this.down = false;
        if (this.legHP <= 0 || this.health < 25) { this.crawl = true; this.say(this.legHP <= 0 ? 'leg' : 'crawl', 2); }
        else this.getupT = 0.001;
      }
      this.updateFace();
      return;
    }
    let want = null, speed = 0, face = null;
    if (this.crawl) {
      pose.mode = 'crawl';
      const P = G.player, dP = this.pos.distanceTo(P.pos);
      if (this.lastThreat && dP < 60) { want = this.pos.clone().sub(this.lastThreat).setY(0).normalize(); speed = 2.2; }
      if (P.alive && dP < 10 && P.aimingAt(this)) { want = null; if (this.sayCD <= 0) this.say('beg', 3); }
      else if (this.sayCD <= 0 && chance(dt * 0.4)) this.say('crawl', 2);
      if (this.screamCD <= 0) { Sound.voice('moan', this.headPos(), this.voice); this.screamCD = rand(3, 6); }
      this.trailT -= dt;
      if (this.trailT <= 0 && this.bleed > 0.3) { this.trailT = 0.5; G.gore.splat(V(this.pos.x, 0.02, this.pos.z), UP, rand(0.8, 1.6)); }
    } else if (this.getupT > 0) {
      this.getupT += dt;
      pose.mode = 'getup'; pose.g = this.getupT / 1.4;
      if (this.getupT > 1.4) { this.getupT = 0; this.setState(this.emo.fear > 0.3 ? 'flee' : 'wander'); this.think = 0; }
    } else ({ want, speed, face } = this.behave(dt));

    if (want) want = this.steer(want, dt);
    const acc = this.onGround ? 9 : 2;
    this.vel.x = damp(this.vel.x, want ? want.x * speed : 0, acc, dt);
    this.vel.z = damp(this.vel.z, want ? want.z * speed : 0, acc, dt);
    this.vel.y -= 196.2 * dt;
    const bx = this.pos.x, bz = this.pos.z;
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; } else this.onGround = false;
    G.world.collide(this.pos, 1.1, 5, this.vel);
    const hs = Math.hypot(this.pos.x - bx, this.pos.z - bz) / Math.max(dt, 1e-4);

    let th = null;
    if (face) th = Math.atan2(face.x - this.pos.x, face.z - this.pos.z);
    else if (hs > 1) th = Math.atan2(this.vel.x, this.vel.z);
    if (th !== null) this.heading += angDiff(this.heading, th) * (1 - Math.exp(-(this.crawl ? 3 : 8) * dt));
    av.root.rotation.y = this.heading;

    const P = G.player;
    if (P.alive && !face && (this.state === 'wander' || this.state === 'chat') && this.pos.distanceTo(P.pos) < 18) {
      pose.lookYaw = angDiff(this.heading, Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z));
      if (Math.abs(pose.lookYaw) > 1.6) pose.lookYaw = 0;
    }
    if (!pose.aim && face === P.pos) pose.lookPitch = this.pitchTo(P.eye()) * 0.7;
    pose.speed = hs;
    av.update(dt, pose);
    this.updateFace();
  }

  // 감정 → 얼굴
  updateFace() {
    const E = this.emo;
    let f = 'neutral';
    if (E.pain > 0.45 || this.down) f = 'pain';
    else if (this.crawl) f = E.fear > 0.4 ? 'scared' : 'sad';
    else if (E.fear > 0.72) f = 'panic';
    else if (E.fear > 0.35 || SCARED.includes(this.state)) f = 'scared';
    else if (E.anger > 0.45 || HOSTILE.includes(this.state)) f = 'angry';
    else if (E.sad > 0.4 || this.state === 'mourn') f = 'sad';
    else if (E.joy > 0.6 || this.state === 'chat') f = 'happy';
    this.avatar.setFace(f);
  }
}
