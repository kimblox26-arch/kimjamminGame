// 초록모자 — 사진(앞·뒤)을 입힌 관절 3D 몸 + 천천히 돌아다니는 추적 AI
import * as THREE from 'three';

// greenhat_parts.png 안의 위치 [u0, v0, u1, v1] (화면 왼쪽 L / 오른쪽 R 기준)
const P = {
  head: { front: [0, .2245, .1226, 1], back: [.1242, .2245, .2469, 1], side: [.2484, .2245, .2610, 1] },
  torso: { front: [.2626, 0, .3821, 1], back: [.3836, 0, .5031, 1], side: [.5047, 0, .5173, 1] },
  armL: { front: [.5189, .0204, .5613, 1], back: [.5629, .0204, .6053, 1], side: [.6069, .0204, .6195, 1] },
  armR: { front: [.6211, .0204, .6635, 1], back: [.6651, .0204, .7075, 1], side: [.7091, .0204, .7217, 1] },
  legL: { front: [.7233, .1735, .7838, 1], back: [.7854, .1735, .8459, 1], side: [.8475, .1735, .8601, 1] },
  legR: { front: [.8616, .1735, .9222, 1], back: [.9237, .1735, .9843, 1], side: [.9858, .1735, .9984, 1] },
};
const PX = 2.45 / 502;   // 사진 1픽셀 = 몇 m (키 2.45m)

function partGeo(w, h, d, front, back, side) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const rect = (r, u, v) => [r[0] + u * (r[2] - r[0]), r[1] + v * (r[3] - r[1])];
  const top = [side[0], side[3] - 0.004, side[2], side[3]], bot = [side[0], side[1], side[2], side[1] + 0.004];
  const faces = [side, side, top, bot, front, back];      // px nx py ny pz nz
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; const [u, v] = rect(faces[f], uv.getX(k), uv.getY(k)); uv.setXY(k, u, v); }
  return g;
}

// 초록모자 몸 만들기 — stone 이면 돌 동상
export function buildGreenHat(tex, stoneMat) {
  const mat = stoneMat || new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.14 });
  const root = new THREE.Group(), hips = new THREE.Group(); root.add(hips);
  const mk = (w, h, d, name, frontKey, backKey) => new THREE.Mesh(partGeo(w, h, d, P[frontKey].front, P[backKey].back, P[frontKey].side), mat);
  const legH = 162 * PX, legW = 77 * PX, torsoH = 196 * PX, torsoW = 152 * PX, armW = 54 * PX, armH = 192 * PX;
  const hipY = legH, shY = (946 - 612) * PX, shX = 97 * PX, legX = 37.5 * PX;
  const torso = mk(torsoW, torsoH, 0.37, 'torso', 'torso', 'torso'); torso.position.y = legH + torsoH / 2 - 0.01; hips.add(torso);
  const neck = new THREE.Group(); neck.position.y = legH + torsoH - 0.02; hips.add(neck);
  const head = mk(156 * PX, 152 * PX, 0.62, 'head', 'head', 'head'); head.position.y = 152 * PX / 2; neck.add(head);
  // 몸의 오른쪽(-x)은 앞 사진의 왼쪽, 뒤 사진의 오른쪽
  const limb = (x, y, w, h, d, fk, bk, top) => {
    const piv = new THREE.Group(); piv.position.set(x, y, 0); hips.add(piv);
    const m = mk(w, h, d, '', fk, bk); m.position.y = top - h / 2; piv.add(m); return piv;
  };
  const armRt = limb(-shX, shY, armW, armH, 0.25, 'armL', 'armR', 14 * PX);
  const armLt = limb(shX, shY, armW, armH, 0.25, 'armR', 'armL', 14 * PX);
  const legRt = limb(-legX, hipY, legW, legH, 0.33, 'legL', 'legR', 0);
  const legLt = limb(legX, hipY, legW, legH, 0.33, 'legR', 'legL', 0);
  return { root, hips, neck, armR: armRt, armL: armLt, legR: legRt, legL: legLt, mat, height: legH + torsoH + 152 * PX };
}

export class Monster {
  constructor(scene, tex, world, audio) {
    this.world = world; this.audio = audio;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.rig = buildGreenHat(tex); this.mat = this.rig.mat;
    this.root = this.rig.root; scene.add(this.root);
    this.pos = this.root.position; this.dir = new THREE.Vector3(0, 0, 1); this.face = 0;
    this.speedMul = 1; this.sightMul = 1;
    this.reset(new THREE.Vector3(38, 0, 8.5));
  }
  reset(p) {
    this.pos.copy(p); this.state = 'idle'; this.timer = 4; this.path = []; this.ph = 0; this.speed = 0;
    this.aware = 0; this.lastSeen = new THREE.Vector3(); this.seenT = 99; this.cool = 0; this.target = null; this.sawHide = null; this.tgt = null;
    this.searchLeft = 0; this.checkSpot = null; this.stuck = 0; this.lastPos = p.clone(); this.anim = 0; this.voiceT = 10; this.wait = 0;
    this.root.visible = true; this.enabled = true; this.frozen = false; this.lookT = 0;
  }
  get chasing() { return this.state === 'chase' || this.state === 'attack'; }
  // ── 감각: 눈으로 본다 (서 있기 > 숙이기 > 엎드리기) ──
  canSeeT(t, g) {
    if (!t.alive || t.hidden || t.invisible || g.safe) return false;
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, d = Math.hypot(dx, dz);
    const k = t.pose === 'prone' ? 0.45 : t.pose === 'crouch' ? 0.65 : 1;
    if (d > (17 + (t.running ? 3 : 0)) * k * this.sightMul) return false;
    if (d > 2.5) { const dot = (dx * this.dir.x + dz * this.dir.z) / d; if (dot < 0.3) return false; }
    const y = t.pose === 'prone' ? 0.35 : t.pose === 'crouch' ? 0.9 : 1.5;
    return this.world.clear(this.pos.x, this.pos.z, t.pos.x, t.pos.z, y, false, t.pose === 'stand' || !t.pose);
  }
  // ── 감각: 마이크로 들어온 실제 목소리만 듣는다 ──
  hearVoice(pos, radius, g, t) {
    if (!this.enabled || this.frozen || ['attack', 'recover', 'pull', 'chase'].includes(this.state)) return false;
    let d = Math.hypot(pos.x - this.pos.x, pos.z - this.pos.z);
    if (!this.world.clear(this.pos.x, this.pos.z, pos.x, pos.z, 1.5, false, true)) d *= 1.5;
    if (d > radius) return false;
    if (t && t.hidden && t.spot) { this.goCheck(t.spot, true); return true; }
    this.state = 'investigate'; this.target = pos.clone(); this.pathTo(pos);
    this.say(['뭐야...?', '거기 누구야?', '목소리가 들렸는데...']);
    return true;
  }
  noteHide(t, spot) { if (this.chasing && this.tgt === t.id && this.seenT < 0.9 && Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) < 12) this.sawHide = spot; }
  goCheck(spot, sure) {
    this.state = 'goCheck'; this.checkSpot = spot; this.sure = sure; this.pathTo(spot.front);
    if (sure) this.say('거기 있구나...');
  }
  say(t) { if (Array.isArray(t)) t = t[Math.random() * t.length | 0]; this.audio.monsterVoice(t, this.pos); }
  pathTo(p) {
    const w = this.world;
    if (w.clear(this.pos.x, this.pos.z, p.x, p.z, 0.6, false)) { this.path = [{ x: p.x, z: p.z }]; return; }
    const nodes = w.findPath(w.nearestNode(this.pos.x, this.pos.z), w.nearestNode(p.x, p.z));
    this.path = nodes.map(n => ({ x: n.x, z: n.z, door: n.door })); this.path.push({ x: p.x, z: p.z });
  }
  turnTo(dx, dz, dt) {
    const want = Math.atan2(dx, dz); let d = want - this.face; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.face += d * Math.min(1, dt * 5); this.dir.set(Math.sin(this.face), 0, Math.cos(this.face));
  }
  step(dt, speed) {
    speed *= this.speedMul;
    if (!this.path.length) { this.speed = 0; return true; }
    const t = this.path[0];
    if (t.door) { const d = this.world.doors[t.door]; if (d && !d.open && Math.hypot(t.x - this.pos.x, t.z - this.pos.z) < 1.7) { this.onDoor && this.onDoor(d); this.wait = 0.6; } }
    if (this.wait > 0) { this.wait -= dt; this.speed = 0; return false; }
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.3) { this.path.shift(); return !this.path.length; }
    this.turnTo(dx, dz, dt);
    const v = Math.min(d, speed * dt); this.pos.x += dx / d * v; this.pos.z += dz / d * v;
    this.world.collide(this.pos, 0.35, 1.8, true);
    this.speed = speed; return false;
  }
  moveDirect(dt, target, speed) {
    speed *= this.speedMul;
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    this.turnTo(dx, dz, dt);
    const v = Math.min(d, speed * dt); this.pos.x += dx / d * v; this.pos.z += dz / d * v;
    this.world.collide(this.pos, 0.35, 1.8, false); this.speed = speed;
  }
  randomPatrol(g) {
    const w = this.world, T = g.targets().filter(t => t.alive && !t.isBot);
    let cand = w.patrolIds.map(id => w.nodes[id]).filter(n => w.nodeOpen(n) && w.reachable(n));
    const pp = (T[Math.random() * T.length | 0] || { pos: this.pos }).pos;
    const far = cand.filter(n => Math.hypot(n.x - pp.x, n.z - pp.z) > 10);
    if (g.time < 30 && far.length) cand = far;
    cand.sort(() => Math.random() - 0.5);
    const near = cand.slice(0, 5).sort((a, b) => Math.hypot(a.x - pp.x, a.z - pp.z) - Math.hypot(b.x - pp.x, b.z - pp.z));
    const n = Math.random() < 0.6 ? near[0] : cand[0];
    if (n) this.pathTo(new THREE.Vector3(n.x, 0, n.z));
  }
  update(dt, g) {
    if (!this.enabled) return;
    this.world.monsterPos.copy(this.pos);
    if (this.frozen) { this.speed = 0; this.animate(dt, g); return; }
    this.cool -= dt; this.voiceT -= dt;
    const T = g.targets();
    let best = null, bd = 1e9;
    for (const t of T) { if (!this.canSeeT(t, g)) continue; const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z); if (d < bd) { bd = d; best = t; } }
    if (best) {
      if (!this.chasing || !this.tgt) this.tgt = best.id;
      const cur = T.find(t => t.id === this.tgt);
      if (cur && this.canSeeT(cur, g)) { this.lastSeen.copy(cur.pos); this.seenT = 0; }
      else if (!this.chasing) { this.tgt = best.id; this.lastSeen.copy(best.pos); this.seenT = 0; }
      if (!['chase', 'attack', 'recover', 'pull'].includes(this.state)) {
        this.aware += dt * (bd < 4 ? 6 : 0.5 + (17 - bd) * 0.09);
        if (this.aware > 0.4 && this.state !== 'notice') { this.state = 'notice'; this.timer = 0.6; this.path = []; }
        if (this.aware >= 1) { this.state = 'chase'; this.tgt = best.id; this.seenT = 0; g.onSpotted(best); this.say(['찾았다...', '팔로우 안 한 애...', '거기 있었구나']); }
      }
    } else { this.seenT += dt; this.aware = Math.max(0, this.aware - dt * 0.3); }
    const tg = T.find(t => t.id === this.tgt);
    switch (this.state) {
      case 'idle': this.speed = 0; this.timer -= dt; if (this.timer <= 0) { this.state = 'patrol'; this.randomPatrol(g); } break;
      case 'notice': this.speed = 0; if (best) this.turnTo(best.pos.x - this.pos.x, best.pos.z - this.pos.z, dt); if (!best && this.aware < 0.3) { this.state = 'patrol'; this.randomPatrol(g); } break;
      case 'patrol':
        if (this.step(dt, 1.1)) { this.state = 'look'; this.timer = 2 + Math.random() * 3; }
        if (this.voiceT < 0) { this.voiceT = 14 + Math.random() * 16; if (T.some(t => !t.isBot && t.pos.distanceTo(this.pos) < 14)) this.say(['팔로우...', '어디 있니...', '맞팔 해줄 거지?', '숨바꼭질 할까?']); }
        break;
      case 'look':
        this.speed = 0; this.timer -= dt; this.lookT -= dt;
        if (this.lookT <= 0) { this.lookT = 1.2; this.lookYaw = this.face + (Math.random() - 0.5) * 2.5; }
        this.turnTo(Math.sin(this.lookYaw), Math.cos(this.lookYaw), dt * 0.4);
        if (this.timer <= 0) { this.state = 'patrol'; this.randomPatrol(g); }
        break;
      case 'investigate': if (this.step(dt, 1.6)) { this.state = 'search'; this.searchLeft = 10; this.lastSeen.copy(this.target); this.pickSearch(g, true); } break;
      case 'chase': {
        if (!tg || !tg.alive) { this.state = 'search'; this.searchLeft = 10; this.pathTo(this.lastSeen); break; }
        if (tg.hidden) {
          if (this.sawHide && this.sawHide === tg.spot) { this.goCheck(tg.spot, true); break; }
          this.state = 'search'; this.searchLeft = 14; this.pathTo(this.lastSeen); break;
        }
        if (this.seenT > 4) { this.state = 'search'; this.searchLeft = 14; this.pathTo(this.lastSeen); this.say('어디 갔어...?'); break; }
        const sp = 3.0 + Math.min(0.5, g.chaseTime * 0.02);
        if (this.world.clear(this.pos.x, this.pos.z, tg.pos.x, tg.pos.z, 0.6, false) && tg.pose !== 'prone') { this.path = []; this.moveDirect(dt, tg.pos, sp); }
        else { this.repath = (this.repath || 0) - dt; if (this.repath <= 0 || !this.path.length) { this.repath = 0.5; this.pathTo(this.seenT < 0.1 ? tg.pos : this.lastSeen); } this.step(dt, sp); }
        if (Math.hypot(tg.pos.x - this.pos.x, tg.pos.z - this.pos.z) < 1.15 && this.cool <= 0 && !tg.fly) this.startAttack(g);
        break;
      }
      case 'search':
        if (this.step(dt, 1.3)) { this.searchLeft -= 2; this.pickSearch(g, false); }
        this.searchLeft -= dt; if (this.searchLeft <= 0) { this.state = 'patrol'; this.randomPatrol(g); }
        break;
      case 'goCheck':
        if (this.step(dt, this.sure ? 2.2 : 1.3)) { this.state = 'check'; this.timer = this.sure ? 0.8 : 2.8; if (!this.sure) this.say(['여기 있니...?', '킁... 킁...', '숨어도 소용없어']); }
        break;
      case 'check': {
        this.speed = 0; this.timer -= dt;
        const s = this.checkSpot; this.turnTo(-s.out.x, -s.out.z, dt);
        const inside = T.find(t => t.hidden && t.spot === s);
        if (inside && (this.sure || (inside.isLocal && g.micLevel > g.micHideThreshold) || inside.loud || (inside.isBot && this.timer < 1.5 && Math.random() < dt * 0.4))) { this.tgt = inside.id; this.pullOut(g, inside); break; }
        if (this.timer <= 0) { this.sure = false; this.state = 'search'; this.searchLeft = Math.min(this.searchLeft, 6); this.pickSearch(g, false); }
        break;
      }
      case 'pull': this.speed = 0; this.timer -= dt; if (this.timer <= 0) { this.state = 'chase'; this.seenT = 0; this.startAttack(g); } break;
      case 'attack': {
        this.speed = 0; this.timer -= dt; this.anim += dt;
        if (tg) this.turnTo(tg.pos.x - this.pos.x, tg.pos.z - this.pos.z, dt);
        if (!this.hit && this.anim > 0.45) { this.hit = true; if (tg && tg.alive && !tg.hidden && !tg.fly && Math.hypot(tg.pos.x - this.pos.x, tg.pos.z - this.pos.z) < 2.0) g.onHit(tg, this); }
        if (this.timer <= 0) { this.state = 'recover'; this.timer = 1.6; }
        break;
      }
      case 'recover':
        this.speed = 0; this.timer -= dt;
        if (this.timer <= 0) { this.state = best ? 'chase' : 'search'; if (best) this.tgt = best.id; this.searchLeft = 10; if (this.state === 'search') this.pathTo(this.lastSeen); }
        break;
    }
    this.stuck += dt;
    if (this.stuck > 1.5) {
      if (this.speed > 0 && this.pos.distanceTo(this.lastPos) < 0.3) { const t = this.path[this.path.length - 1]; if (t) this.pathTo(new THREE.Vector3(t.x, 0, t.z)); }
      this.stuck = 0; this.lastPos.copy(this.pos);
    }
    this.animate(dt, g);
  }
  pickSearch(g, first) {
    const w = this.world, from = this.lastSeen;
    const spots = w.hides.filter(s => s.front.distanceTo(from) < 8 && w.reachable(w.nearestNode(s.front.x, s.front.z, false)));
    if (spots.length && Math.random() < (first ? 0.5 : 0.6)) { this.goCheck(spots[Math.random() * spots.length | 0], false); return; }
    const ns = Object.values(w.nodes).filter(n => w.nodeOpen(n) && w.reachable(n) && Math.hypot(n.x - from.x, n.z - from.z) < 9);
    const n = ns[Math.random() * ns.length | 0];
    if (n) this.pathTo(new THREE.Vector3(n.x, 0, n.z)); else { this.state = 'patrol'; this.randomPatrol(g); }
  }
  startAttack(g) { this.state = 'attack'; this.timer = 1.0; this.anim = 0; this.hit = false; this.cool = 2.8; this.audio.scream(this.pos); }
  pullOut(g, t) { this.state = 'pull'; this.timer = 0.6; g.onPulled(this.checkSpot, t, this); }
  // ── 멀티플레이: 방장이 보낸 상태로 움직이기 ──
  netState() { return { x: +this.pos.x.toFixed(2), z: +this.pos.z.toFixed(2), f: +this.face.toFixed(2), s: this.state, sp: +this.speed.toFixed(1), a: +this.anim.toFixed(2), t: this.tgt, v: this.root.visible ? 1 : 0 }; }
  applyNet(n, dt, g) {
    if (!n) return;
    const k = Math.min(1, dt * 10);
    if (Math.hypot(n.x - this.pos.x, n.z - this.pos.z) > 4) this.pos.set(n.x, 0, n.z); else { this.pos.x += (n.x - this.pos.x) * k; this.pos.z += (n.z - this.pos.z) * k; }
    let d = n.f - this.face; d = Math.atan2(Math.sin(d), Math.cos(d)); this.face += d * k; this.dir.set(Math.sin(this.face), 0, Math.cos(this.face));
    if (n.s === 'attack' && this.state !== 'attack') this.audio.scream(this.pos);
    this.state = n.s; this.speed = n.sp; this.anim = n.a; this.tgt = n.t; this.root.visible = !!n.v;
    this.world.monsterPos.copy(this.pos);
    this.animate(dt, g);
  }
  // ── 관절 애니메이션 ──
  animate(dt, g) {
    const r = this.rig, sp = this.speed, t = (this.t = (this.t || 0) + dt);
    this.root.rotation.y = this.face;
    const prev = this.ph; this.ph += dt * sp * 2.3;
    const k = Math.min(1, sp / 1.2), amp = sp > 2.4 ? 0.85 : 0.55 * k, s = Math.sin(this.ph);
    // 발이 땅에 닿을 때 발소리
    if (sp > 0.2 && Math.floor(prev / Math.PI) !== Math.floor(this.ph / Math.PI)) this.audio.monsterStep(this.pos, sp > 2.4);
    const lerp = (o, v, kk = 10) => o + (v - o) * Math.min(1, dt * kk);
    let aR = -s * amp * 0.9, aL = s * amp * 0.9, lR = s * amp, lL = -s * amp, bob = Math.abs(Math.cos(this.ph)) * 0.05 * k, lean = 0, headZ = Math.sin(t * 0.8) * 0.07, headX = 0;
    if (this.state === 'chase') { aR = -1.4 + s * 0.2; aL = -1.4 - s * 0.2; lean = 0.18; headZ = Math.sin(t * 7) * 0.12; }
    if (this.state === 'notice' || this.state === 'check') { headX = -0.12; headZ = 0.25 * Math.sin(t * 1.3); }
    if (this.state === 'attack' || this.state === 'pull') {
      const a = Math.min(1, this.anim / 0.45), down = this.anim > 0.45 ? Math.min(1, (this.anim - 0.45) / 0.15) : 0;
      aR = aL = -2.8 * a + 2.2 * down; lean = 0.3 * a - 0.1 * down; headX = 0.25;
    }
    if (sp < 0.1 && this.state !== 'attack' && this.state !== 'chase') { aR = Math.sin(t * 1.4) * 0.04; aL = -aR; lR = lL = 0; }
    r.armR.rotation.x = lerp(r.armR.rotation.x, aR); r.armL.rotation.x = lerp(r.armL.rotation.x, aL);
    r.legR.rotation.x = lerp(r.legR.rotation.x, lR, 14); r.legL.rotation.x = lerp(r.legL.rotation.x, lL, 14);
    r.armR.rotation.z = -0.08; r.armL.rotation.z = 0.08;
    r.hips.position.y = lerp(r.hips.position.y, bob, 12); r.hips.rotation.x = lerp(r.hips.rotation.x, lean, 6);
    r.neck.rotation.z = lerp(r.neck.rotation.z, headZ, 6); r.neck.rotation.x = lerp(r.neck.rotation.x, headX, 6);
    this.mat.emissiveIntensity = this.chasing ? 0.2 : 0.14;
  }
}
