// 초록모자 — 2D 스프라이트(앞/뒤 걷기) + 추적 AI (시야 · 소리 · 숨은 곳 뒤지기)
import * as THREE from 'three';
import { SHARED } from './world.js';

const COLS = 8, ROWS = 3, PH = 2.75, PW = PH * 300 / 420;

export class Monster {
  constructor(scene, atlas, world, audio) {
    this.world = world; this.audio = audio;
    atlas.colorSpace = THREE.SRGBColorSpace; atlas.repeat.set(1 / COLS, 1 / ROWS); atlas.magFilter = THREE.LinearFilter;
    this.tex = atlas;
    const geo = new THREE.PlaneGeometry(PW, PH); geo.translate(0, PH / 2 - 0.04, 0);
    this.mat = new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: atlas, emissiveIntensity: 0.07 });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.castShadow = true;
    this.mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5 });
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshBasicMaterial({ map: SHARED.blob, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.01; this.blob = blob;
    this.root = new THREE.Group(); this.root.add(this.mesh); this.root.add(blob); scene.add(this.root);
    this.pos = this.root.position; this.dir = new THREE.Vector3(0, 0, 1);
    this.reset(new THREE.Vector3(14, 0, 21));
  }
  reset(p) {
    this.pos.copy(p); this.state = 'idle'; this.timer = 4; this.path = []; this.dist = 0; this.frame = 0; this.row = 0;
    this.aware = 0; this.lastSeen = new THREE.Vector3(); this.seenT = 0; this.cool = 0; this.target = null; this.sawHide = null;
    this.searchLeft = 0; this.checkSpot = null; this.stuck = 0; this.lastPos = p.clone(); this.anim = 0; this.voiceT = 8;
    this.speed = 0; this.root.visible = true; this.enabled = true; this.facingOverride = null; this.jit = 0; this.lookT = 0;
  }
  get chasing() { return this.state === 'chase' || this.state === 'attack'; }

  // ── 감각 ──
  canSee(g) {
    const pl = g.player; if (pl.hidden || g.safe) return false;
    const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z, d = Math.hypot(dx, dz);
    const range = 12 + (g.torchOn ? 5 : 0) + (pl.running ? 2 : 0);
    if (d > range) return false;
    if (d > 2.2) { const dot = (dx * this.dir.x + dz * this.dir.z) / d; if (dot < 0.25) return false; }
    return this.world.clear(this.pos.x, this.pos.z, pl.pos.x, pl.pos.z, 1.5, false, true);
  }
  // 소리 듣기: radius 안이면 그 위치로 간다. 벽 너머는 절반만 들린다
  hear(pos, radius, g, kind = 'noise') {
    if (!this.enabled || this.state === 'attack' || this.state === 'recover' || this.state === 'pull') return false;
    let d = Math.hypot(pos.x - this.pos.x, pos.z - this.pos.z);
    if (!this.world.clear(this.pos.x, this.pos.z, pos.x, pos.z, 1.5, false, true)) d *= 1.6;
    if (d > radius) return false;
    const pl = g.player;
    if (kind === 'voice' && pl.hidden && pl.spot) { // 숨어서 떠들면 숨은 곳을 정확히 안다
      this.goCheck(pl.spot, true); return true;
    }
    if (this.state === 'chase') return true;
    this.investigate(pos); return true;
  }
  investigate(pos) {
    this.state = 'investigate'; this.target = pos.clone(); this.pathTo(pos); this.timer = 0;
    this.say(['뭐야...?', '거기 누구야?', '소리가 났는데...'][Math.random() * 3 | 0]);
  }
  goCheck(spot, sure) {
    this.state = 'goCheck'; this.checkSpot = spot; this.sure = sure; this.pathTo(spot.front);
    if (sure) this.say('찾았다...');
  }
  say(t) { this.audio.monsterVoice(t, this.pos); }

  // ── 이동 ──
  pathTo(p) {
    const w = this.world;
    if (w.clear(this.pos.x, this.pos.z, p.x, p.z, 0.6, false)) { this.path = [{ x: p.x, z: p.z }]; return; }
    const a = w.nearestNode(this.pos.x, this.pos.z), b = w.nearestNode(p.x, p.z);
    const nodes = w.findPath(a, b);
    this.path = nodes.map(n => ({ x: n.x, z: n.z, door: n.door }));
    this.path.push({ x: p.x, z: p.z });
  }
  step(dt, speed) {
    if (!this.path.length) { this.speed = 0; return true; }
    const t = this.path[0];
    // 문 열기
    if (t.door) { const d = this.world.doors[t.door]; if (d && !d.open && Math.hypot(t.x - this.pos.x, t.z - this.pos.z) < 1.6) { d.setOpen(true); this.audio.door(d.pos, true); this.wait = 0.45; } }
    if (this.wait > 0) { this.wait -= dt; this.speed = 0; return false; }
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.25) { this.path.shift(); return !this.path.length; }
    const v = Math.min(d, speed * dt);
    this.dir.set(dx / d, 0, dz / d);
    this.pos.x += this.dir.x * v; this.pos.z += this.dir.z * v;
    this.world.collide(this.pos, 0.3, 1.8, true);
    this.speed = speed; this.dist += v;
    return false;
  }
  moveDirect(dt, target, speed) {
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    this.dir.set(dx / d, 0, dz / d);
    const v = Math.min(d, speed * dt);
    this.pos.x += this.dir.x * v; this.pos.z += this.dir.z * v;
    this.world.collide(this.pos, 0.3, 1.8, false);
    this.speed = speed; this.dist += v;
  }
  randomPatrol(g) {
    const w = this.world, ids = w.patrolIds.filter(id => w.nodeOpen(w.nodes[id]));
    // 처음 잠깐은 플레이어 근처로 오지 않는다
    let cand = ids.map(id => w.nodes[id]);
    if (g.time < 35) cand = cand.filter(n => Math.hypot(n.x - g.player.pos.x, n.z - g.player.pos.z) > 12);
    // 플레이어 쪽으로 약간 끌리게
    cand.sort(() => Math.random() - 0.5);
    const near = cand.slice(0, 4).sort((a, b) => Math.hypot(a.x - g.player.pos.x, a.z - g.player.pos.z) - Math.hypot(b.x - g.player.pos.x, b.z - g.player.pos.z));
    const n = Math.random() < 0.55 ? near[0] : cand[0];
    this.pathTo(new THREE.Vector3(n.x, 0, n.z));
  }

  // ── 매 프레임 ──
  update(dt, g) {
    if (!this.enabled) return;
    const pl = g.player;
    this.cool -= dt; this.voiceT -= dt;
    const sees = this.canSee(g);
    const dpl = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
    if (sees) {
      this.lastSeen.copy(pl.pos); this.seenT = 0;
      if (this.state !== 'chase' && this.state !== 'attack' && this.state !== 'recover' && this.state !== 'pull') {
        this.aware += dt * (dpl < 4 ? 10 : 1.4 + (12 - dpl) * 0.25);
        if (this.aware >= 1) { this.state = 'chase'; g.onSpotted(); this.say(['찾았다', '팔로우 안 한 애...', '거기 있었구나'][Math.random() * 3 | 0]); }
      }
    } else { this.seenT += dt; this.aware = Math.max(0, this.aware - dt * 0.4); }

    switch (this.state) {
      case 'idle': this.speed = 0; this.timer -= dt; if (this.timer <= 0) { this.state = 'patrol'; this.randomPatrol(g); } break;
      case 'patrol': {
        if (this.step(dt, 1.45)) { this.state = 'look'; this.timer = 1.5 + Math.random() * 2.5; }
        if (this.voiceT < 0 && dpl < 13) { this.voiceT = 12 + Math.random() * 14; this.say(['팔로우...', '팔로우 해줘...', '어디 있니...', '맞팔 해줄 거지?'][Math.random() * 4 | 0]); }
        break;
      }
      case 'look': {
        this.speed = 0; this.timer -= dt; this.lookT -= dt;
        if (this.lookT <= 0) { this.lookT = 0.7; const a = Math.random() * Math.PI * 2; this.dir.set(Math.cos(a), 0, Math.sin(a)); }
        if (this.timer <= 0) { this.state = 'patrol'; this.randomPatrol(g); }
        break;
      }
      case 'investigate': {
        if (this.step(dt, 2.6)) { this.state = 'search'; this.searchLeft = 9; this.lastSeen.copy(this.target); this.pickSearch(g, true); }
        break;
      }
      case 'chase': {
        if (pl.hidden) {
          // 숨는 걸 봤으면 바로 그 곳으로
          if (this.sawHide === pl.spot) { this.goCheck(pl.spot, true); break; }
          this.state = 'search'; this.searchLeft = 14; this.pathTo(this.lastSeen); break;
        }
        if (this.seenT > 4) { this.state = 'search'; this.searchLeft = 14; this.pathTo(this.lastSeen); this.say('어디 갔어...?'); break; }
        const sp = 4.05 + Math.min(0.6, g.chaseTime * 0.02);
        if (this.world.clear(this.pos.x, this.pos.z, pl.pos.x, pl.pos.z, 0.6, false)) { this.path = []; this.moveDirect(dt, pl.pos, sp); }
        else {
          this.repath = (this.repath || 0) - dt;
          if (this.repath <= 0 || !this.path.length) { this.repath = 0.5; this.pathTo(this.seenT < 0.1 ? pl.pos : this.lastSeen); }
          this.step(dt, sp);
        }
        if (dpl < 1.05 && this.cool <= 0) this.startAttack(g);
        break;
      }
      case 'search': {
        if (this.step(dt, 2.2)) { this.searchLeft -= 2; this.pickSearch(g, false); }
        this.searchLeft -= dt;
        if (this.searchLeft <= 0) { this.state = 'patrol'; this.randomPatrol(g); }
        break;
      }
      case 'goCheck': {
        if (this.step(dt, this.sure ? 3.4 : 2.2)) {
          this.state = 'check'; this.timer = this.sure ? 0.6 : 2.6;
          const s = this.checkSpot; this.dir.set(-s.out.x, 0, -s.out.z);
          if (!this.sure) this.say(['여기 있니...?', '킁... 킁...', '숨어도 소용없어'][Math.random() * 3 | 0]);
        }
        break;
      }
      case 'check': {
        this.speed = 0; this.timer -= dt;
        const s = this.checkSpot;
        if (pl.hidden && pl.spot === s && (this.sure || g.micLevel > g.micHideThreshold)) { this.pullOut(g); break; }
        if (this.timer <= 0) {
          if (pl.hidden && pl.spot === s && this.sure) { this.pullOut(g); break; }
          this.sure = false; this.state = 'search'; this.searchLeft = Math.min(this.searchLeft, 6); this.pickSearch(g, false);
        }
        break;
      }
      case 'pull': {
        this.speed = 0; this.timer -= dt;
        if (this.timer <= 0) { this.state = 'chase'; this.seenT = 0; this.startAttack(g); }
        break;
      }
      case 'attack': {
        this.speed = 0; this.timer -= dt; this.anim += dt;
        if (!this.hit && this.anim > 0.35) {
          this.hit = true;
          if (Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z) < 1.9 && !pl.hidden) g.onHit(this);
        }
        if (this.timer <= 0) { this.state = 'recover'; this.timer = 1.3; }
        break;
      }
      case 'recover': {
        this.speed = 0; this.timer -= dt;
        if (this.timer <= 0) { this.state = this.canSee(g) ? 'chase' : 'search'; this.searchLeft = 10; if (this.state === 'search') this.pathTo(this.lastSeen); }
        break;
      }
    }
    // 끼임 방지
    this.stuck += dt;
    if (this.stuck > 1.2) {
      if (this.speed > 0 && this.pos.distanceTo(this.lastPos) < 0.25) { const t = this.path[this.path.length - 1]; if (t) this.pathTo(new THREE.Vector3(t.x, 0, t.z)); }
      this.stuck = 0; this.lastPos.copy(this.pos);
    }
    this.animate(dt, g);
  }
  pickSearch(g, first) {
    // 근처 숨는 곳을 뒤지거나 근처 지점을 돈다
    const w = this.world, from = this.lastSeen;
    const spots = w.hides.filter(s => s.front.distanceTo(from) < 7 && w.nodeOpen(w.nearestNode(s.front.x, s.front.z, false)));
    if (spots.length && Math.random() < (first ? 0.5 : 0.6)) { this.goCheck(spots[Math.random() * spots.length | 0], false); return; }
    const ns = Object.values(w.nodes).filter(n => w.nodeOpen(n) && Math.hypot(n.x - from.x, n.z - from.z) < 8);
    const n = ns[Math.random() * ns.length | 0];
    if (n) this.pathTo(new THREE.Vector3(n.x, 0, n.z)); else { this.state = 'patrol'; this.randomPatrol(g); }
  }
  startAttack(g) {
    this.state = 'attack'; this.timer = 0.9; this.anim = 0; this.hit = false; this.cool = 2.6;
    const pl = g.player; this.dir.set(pl.pos.x - this.pos.x, 0, pl.pos.z - this.pos.z).normalize();
    this.audio.scream(this.pos);
  }
  pullOut(g) {
    const s = this.checkSpot; this.state = 'pull'; this.timer = 0.5;
    g.onPulled(s, this);
  }

  // ── 스프라이트 ──
  animate(dt, g) {
    const cam = g.camera.position;
    const tcx = cam.x - this.pos.x, tcz = cam.z - this.pos.z;
    this.mesh.rotation.y = Math.atan2(tcx, tcz);
    const front = (tcx * this.dir.x + tcz * this.dir.z) >= 0;
    let col, row;
    if (this.state === 'attack' || this.state === 'pull') { row = 2; col = this.anim < 0.3 ? 0 : 1; }
    else if (this.speed > 0.1) {
      row = front ? 0 : 1;
      const stride = this.speed > 3 ? 1.5 : 1.15;
      const f = Math.floor(this.dist / stride * COLS) % COLS;
      if ((f === 0 || f === 4) && f !== this.frame) this.audio.monsterStep(this.pos, this.speed > 3);
      this.frame = f; col = f;
    } else { row = 2; col = front ? 2 : 3; }
    this.tex.offset.set(col / COLS, 1 - (row + 1) / ROWS);
    // 추격 중엔 지직거리는 느낌
    this.jit -= dt;
    if (this.chasing && this.jit <= 0) { this.jit = 0.05 + Math.random() * 0.2; this.mesh.position.x = (Math.random() - 0.5) * 0.08; this.mesh.scale.set(1 + (Math.random() - 0.5) * 0.06, 1, 1); }
    else if (!this.chasing) { this.mesh.position.x = 0; this.mesh.scale.set(1, 1, 1); }
    const atk = this.state === 'attack' ? Math.sin(Math.min(1, this.anim / 0.4) * Math.PI) * 0.12 : 0;
    this.mesh.scale.y = 1 + atk; this.mat.emissiveIntensity = this.chasing ? 0.12 : 0.07;
  }
}
