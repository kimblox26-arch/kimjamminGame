// AI 친구들 — 같이 납치되어 온 아이들. 따라오고, 숨고, 단서를 알려 주고, 말을 한다
import * as THREE from 'three';
import { createAvatar, SKINS } from './avatar.js';
import { roomAt } from './world.js';

export const BOT_DEFS = [
  { name: '민준', skin: 1 },
  { name: '서연', skin: 2 },
  { name: '지호', skin: 3 },
];
const LINES = {
  wake: ['여긴... 어디야? 너도 잡혀 왔어?', '나도 초록모자 팔로우 안 했다가 끌려왔어...', '같이 나가자. 혼자는 무서워.'],
  idle: ['여기 너무 추워...', '집에 가고 싶어.', '열쇠 4개랑 일기 4장을 모아야 한대.', '방금 무슨 소리 안 났어?', '문 번호를 잘 봐. 방마다 번호가 있어.', '숨을 땐 옷장이나 침대 밑이 좋아.', '엎드리면 식탁 밑으로도 지나갈 수 있어!'],
  spot: ['저기! 초록모자다!!', '온다! 도망쳐!', '눈 마주쳤어... 뛰어!!'],
  hide: ['쉿... 숨자.', '여기 숨을게. 조용히 해!', '들키면 안 돼...'],
  safe: ['갔나...?', '휴... 살았다.', '이제 나가도 될 것 같아.'],
  hurt: ['괜찮아?!', '피 난다! 빨리 숨어!'],
  caught: ['으아악! 살려줘!!', '놔! 놔줘!!', '안 돼애애!'],
  follow: ['응, 따라갈게!', '알았어, 붙어 있을게.'],
  wait: ['여기서 기다릴게.', '알았어, 여기 있을게.'],
  explore: ['나도 찾아볼게!', '흩어져서 찾자!'],
  found: ['좋았어! 하나 찾았다!', '잘했어!'],
};
const pick = a => a[Math.random() * a.length | 0];

export class Bot {
  constructor(scene, world, audio, def, i) {
    this.world = world; this.audio = audio; this.def = def; this.name = def.name; this.id = 'bot' + i; this.idx = i;
    this.skin = SKINS[def.skin];
    this.rig = createAvatar(this.skin); scene.add(this.rig.root);
    this.pos = this.rig.root.position; this.face = 0; this.isBot = true;
    this.hinted = new Set();
  }
  reset(pos) {
    this.pos.copy(pos); this.hp = 100; this.alive = true; this.hidden = false; this.spot = null; this.mode = 'follow'; this.state = 'idle';
    this.path = []; this.speed = 0; this.sayT = 6 + Math.random() * 8; this.repath = 0; this.calm = 0; this.pose = 'stand'; this.wait = 0;
    this.rig.root.visible = true; this.bubble = null; this.hinted.clear(); this.panic = 0;
  }
  get running() { return this.speed > 3; }
  say(g, t, force) { if (!force && this.bubbleT > 0) return; g.botSay(this, t); this.bubbleT = 2.5; }
  command(cmd, g) {
    if (!this.alive) return;
    if (cmd === 'follow' || cmd === 'wait' || cmd === 'explore') { this.mode = cmd; this.say(g, pick(LINES[cmd]), true); if (this.hidden && cmd !== 'wait') this.leaveHide(g); }
    if (cmd === 'hide' && !this.hidden) { this.goHide(g, true); this.say(g, pick(LINES.hide), true); }
  }
  pathTo(p) {
    const w = this.world;
    if (w.clear(this.pos.x, this.pos.z, p.x, p.z, 0.6, false)) { this.path = [{ x: p.x, z: p.z }]; return; }
    const nodes = w.findPath(w.nearestNode(this.pos.x, this.pos.z), w.nearestNode(p.x, p.z));
    this.path = nodes.map(n => ({ x: n.x, z: n.z, door: n.door })); this.path.push({ x: p.x, z: p.z });
  }
  step(dt, sp) {
    if (this.wait > 0) { this.wait -= dt; this.speed = 0; return false; }
    if (!this.path.length) { this.speed = 0; return true; }
    const t = this.path[0];
    if (t.door) { const d = this.world.doors[t.door]; if (d && !d.open && !d.locked && Math.hypot(t.x - this.pos.x, t.z - this.pos.z) < 1.6) { this.onDoor && this.onDoor(d); this.wait = 0.4; } }
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.3) { this.path.shift(); return !this.path.length; }
    const v = Math.min(d, sp * dt); this.pos.x += dx / d * v; this.pos.z += dz / d * v;
    this.world.collide(this.pos, 0.28, 1.6, true);
    const want = Math.atan2(dx, dz); let a = want - this.face; a = Math.atan2(Math.sin(a), Math.cos(a)); this.face += a * Math.min(1, dt * 8);
    this.speed = sp; return false;
  }
  freeSpot(g, maxD) {
    let best = null, bd = maxD;
    for (const s of this.world.hides) {
      if (g.spotTaken(s, this)) continue;
      const d = s.front.distanceTo(this.pos); if (d < bd && this.world.nodeOpen(this.world.nearestNode(s.front.x, s.front.z, false))) { bd = d; best = s; }
    }
    return best;
  }
  goHide(g, now) {
    const s = this.freeSpot(g, now ? 14 : 10);
    if (s) { this.state = 'toHide'; this.target = s; g.claimSpot(s, this); this.pathTo(s.front); return true; }
    return false;
  }
  enterHide(g) { this.hidden = true; this.spot = this.target; this.rig.root.visible = false; this.state = 'hidden'; this.calm = 0; this.audio.hide(this.spot.type, true); this.pos.copy(this.spot.inside); }
  leaveHide(g) { if (!this.spot) return; this.pos.copy(this.spot.front); g.releaseSpot(this.spot); this.hidden = false; this.spot = null; this.rig.root.visible = true; this.state = 'idle'; this.say(g, pick(LINES.safe)); }
  hit(g) {
    this.hp -= 40; this.rig.hurt(); this.audio.hit();
    if (this.hp <= 0) { this.alive = false; this.state = 'caught'; this.rig.root.visible = false; if (this.spot) g.releaseSpot(this.spot); this.hidden = false; this.say(g, pick(LINES.caught), true); g.botCaught(this); }
    else { this.say(g, pick(LINES.caught), true); this.state = 'flee'; this.fleeT = 3; }
  }
  update(dt, g) {
    this.bubbleT = (this.bubbleT || 0) - dt;
    if (!this.alive) return;
    const mon = g.monster, w = this.world;
    const dm = Math.hypot(mon.pos.x - this.pos.x, mon.pos.z - this.pos.z);
    const seesMon = mon.root.visible && mon.enabled !== false && dm < 15 && w.clear(this.pos.x, this.pos.z, mon.pos.x, mon.pos.z, 1.5, false, true);
    const danger = (mon.chasing && mon.tgt === this.id) || (seesMon && dm < 9) || (mon.chasing && dm < 7);
    const leader = g.leaderFor(this);
    this.sayT -= dt;
    // ── 숨어 있을 때 ──
    if (this.hidden) {
      this.speed = 0;
      this.calm = danger || dm < 10 ? 0 : this.calm + dt;
      if (this.calm > 6 && this.mode !== 'wait') this.leaveHide(g);
      if (this.mode === 'follow' && leader && !leader.hidden && this.calm > 3 && leader.pos.distanceTo(this.pos) > 10) this.leaveHide(g);
      return;
    }
    if (this.panic > 0) this.panic -= dt;
    // ── 위험 ──
    if (danger && this.state !== 'toHide' && this.state !== 'flee') {
      if (this.panic <= 0) { this.say(g, pick(LINES.spot), true); this.panic = 8; }
      if (!this.goHide(g, false)) { this.state = 'flee'; this.fleeT = 4; this.fleeFrom(mon.pos); }
    }
    if (this.state === 'toHide') {
      if (this.step(dt, danger ? 4.2 : 2.6)) { if (this.target.front.distanceTo(this.pos) < 0.8) this.enterHide(g); else this.state = 'idle'; }
      this.anim(dt); return;
    }
    if (this.state === 'flee') {
      this.fleeT -= dt; if (this.step(dt, 4.2) || this.fleeT <= 0) { this.state = danger ? 'flee' : 'idle'; if (danger) { this.fleeT = 3; this.fleeFrom(mon.pos); } }
      this.anim(dt); return;
    }
    // ── 평소: 따라가기 · 기다리기 · 찾아보기 ──
    this.repath -= dt;
    if (this.mode === 'follow' && leader) {
      const d = leader.pos.distanceTo(this.pos);
      if (leader.hidden && !this.hidden) { if (this.repath <= 0) { this.repath = 1; if (!this.goHide(g, false)) this.path = []; } }
      else if (d > 2.6) { if (this.repath <= 0 || !this.path.length) { this.repath = 0.8; this.pathTo(leader.pos); } this.step(dt, d > 7 ? 4.0 : 2.5); }
      else { this.speed = 0; const want = Math.atan2(leader.pos.x - this.pos.x, leader.pos.z - this.pos.z); this.face += Math.atan2(Math.sin(want - this.face), Math.cos(want - this.face)) * Math.min(1, dt * 3); }
      this.pose = leader.pose === 'crouch' || leader.pose === 'prone' ? leader.pose : 'stand';
    } else if (this.mode === 'explore') {
      this.pose = 'stand';
      if (!this.path.length || this.repath < -15) {
        const ids = w.patrolIds.map(id => w.nodes[id]).filter(n => w.nodeOpen(n) && this.canReach(n));
        const n = ids[Math.random() * ids.length | 0]; if (n) this.pathTo(new THREE.Vector3(n.x, 0, n.z)); this.repath = 0;
      }
      this.step(dt, 2.2);
    } else { this.speed = 0; this.pose = 'stand'; }
    this.lookForClues(g);
    if (this.sayT <= 0) { this.sayT = 22 + Math.random() * 25; this.say(g, pick(LINES.idle)); }
    this.anim(dt);
  }
  canReach(n) { const w = this.world; const a = w.nearestNode(this.pos.x, this.pos.z, false); return a && w.findPath(a, n).length > 0; }
  fleeFrom(p) {
    const w = this.world; let best = null, bd = -1;
    for (const n of Object.values(w.nodes)) { if (!w.nodeOpen(n)) continue; const d = Math.hypot(n.x - p.x, n.z - p.z), mine = Math.hypot(n.x - this.pos.x, n.z - this.pos.z); if (mine < 14 && d > bd) { bd = d; best = n; } }
    if (best) this.pathTo(new THREE.Vector3(best.x, 0, best.z));
  }
  // 근처에 아직 안 연 서랍에 무언가 있으면 알려 주고 메모를 남긴다
  lookForClues(g) {
    for (const it of this.world.items) {
      if (it.opened || !it.item || this.hinted.has(it.id) || g.hinted.has(it.id)) continue;
      if (it.pos.distanceTo(this.pos) < 2.3) {
        this.hinted.add(it.id); g.hinted.add(it.id);
        const r = roomAt(it.pos.x, it.pos.z), where = r ? (r.num ? r.num + ' ' : '') + r.name : '여기';
        const what = it.item.key === 'bandage' ? '붕대 같은 게' : '반짝이는 게';
        this.say(g, `여기 ${it.label.replace(' 열기', '')}에 ${what} 있어!`, true);
        g.botMemo(this, `${where} — ${it.label.replace(' 열기', '')}에 ${what} 있음`);
      }
    }
    for (const it of this.world.inter) {
      if (it.kind !== 'diary' || it.read || this.hinted.has('d' + it.id) || g.hinted.has('d' + it.id)) continue;
      if (it.pos.distanceTo(this.pos) < 2.5) {
        this.hinted.add('d' + it.id); g.hinted.add('d' + it.id);
        const r = roomAt(it.pos.x, it.pos.z), where = r ? (r.num ? r.num + ' ' : '') + r.name : '여기';
        this.say(g, '여기 일기장이 있어! 읽어 봐!', true); g.botMemo(this, `${where}에 일기장 있음`);
      }
    }
  }
  anim(dt) { this.rig.root.rotation.y = this.face; this.rig.update(dt, this.speed, this.pose); }
}
