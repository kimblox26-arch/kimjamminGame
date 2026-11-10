// SCP-096 "수줍은 자" — 모델, 행동(앉아 울기/배회/발작/추격/처치), 절차적 애니메이션, 얼굴 목격 판정
import * as THREE from 'three';
import { Pose, applyPose } from './rig.js';
import { buildModel096 } from './model096.js';
import { CELL, W, at, cellOf, center, find, collideCircle, distanceField, walkable096, lineClear, doors } from './map.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const rnd = (a, b) => a + Math.random() * (b - a);
const TRIGGER_TIME = 7.5;

export class SCP096 {
  constructor(scene, world, audio) {
    this.world = world; this.audio = audio;
    this.rig = buildModel096();
    this.root = this.rig.root; scene.add(this.root);
    const s = find('S')[0];
    this.home = new THREE.Vector3(center(s.x), 0, center(s.y) - 0.3);
    this.pos = this.home.clone(); this.yaw = 0;
    this.state = 'sit'; this.st = 0; this.t = 0; this.phase = 0; this.lastStep = 0;
    this.sitFor = rnd(28, 45); this.lookT = rnd(6, 12); this.look = 0; this.wanders = 0;
    this.speed = 0; this.path = null; this.pathT = 0; this.target = null; this.seen = 0;
    this.P = new Pose();
    this.headPos = new THREE.Vector3(); this.faceDir = new THREE.Vector3();
    this.rig.bones.head.visible = true;
    // 얼굴을 비추는 아주 약한 자체 조명(어둠 속에서 하얀 몸이 드러나게)
    this.fill = new THREE.PointLight(0xffe8e0, 0.25, 3, 2); this.fill.position.set(0, 1.9, 0.6); this.root.add(this.fill);
  }
  get calm() { return this.state === 'sit' || this.state === 'wander' || this.state === 'return'; }
  get faceCovered() { return (this.state === 'sit' && this.look < 0.5) || this.state === 'trigger' && this.st < TRIGGER_TIME - 1.2; }
  get mood() { return this.state === 'trigger' ? 'panic' : this.state === 'chase' || this.state === 'kill' ? 'scream' : this.state === 'done' ? 'sob' : 'sob'; }

  // 카메라가 096 의 얼굴을 보았는가
  checkSeen(cam, frustum, dt) {
    if (!this.calm || this.faceCovered) { this.seen = 0; return false; }
    const h = this.headPos, to = cam.position.clone().sub(h), d = to.length();
    to.divideScalar(d);
    const ok = d < 28 && this.faceDir.dot(to) > 0.28 && frustum.containsPoint(h) && lineClear(h.x, h.z, cam.position.x, cam.position.z);
    this.seen = ok ? this.seen + dt : Math.max(0, this.seen - dt * 2);
    return this.seen > 0.15;
  }
  trigger() { this.state = 'trigger'; this.st = 0; this.audio.stinger(); }

  update(dt, player) {
    this.t += dt; this.st += dt;
    const P = player.pos;
    switch (this.state) {
      case 'sit':
        this.speed = 0;
        this.lookT -= dt;
        if (this.lookT < 0) { this.look = this.look ? 0 : 1; this.lookT = this.look ? rnd(3, 5) : rnd(9, 18); }
        if (this.st > this.sitFor && !this.look) { this.state = 'wander'; this.st = 0; this.wanders = 2 + (Math.random() * 2 | 0); this.pickWander(); }
        break;
      case 'wander': case 'return': {
        if (this.wait > 0) { this.wait -= dt; this.speed *= 0.9; break; }
        const arrived = this.moveTo(this.target, 0.8, dt, false);
        if (arrived) {
          if (this.state === 'return') { this.state = 'sit'; this.st = 0; this.sitFor = rnd(30, 55); this.look = 0; this.lookT = rnd(8, 14); this.yawTo(0, dt); }
          else if (--this.wanders > 0) { this.wait = rnd(2.5, 6); this.pickWander(); }
          else { this.state = 'return'; this.target = this.home.clone(); }
        }
        break;
      }
      case 'trigger': {
        this.speed = 0;
        const want = Math.atan2(P.x - this.pos.x, P.z - this.pos.z);
        if (this.st > 1.0 && this.st < 2.2) this.world.setAlarm(true);
        if (!this.hold) this.yawTo(want, dt * (this.st > TRIGGER_TIME - 1.5 ? 1.5 : 0.25));
        if (this.st > TRIGGER_TIME) { this.state = 'chase'; this.st = 0; }
        break;
      }
      case 'chase': {
        const top = Math.min(11, 5 + this.st * 3.2); // 더 강하게: 빠른 가속, 최고 11 m/s
        this.moveTo(P, top, dt, true);
        if (Math.hypot(P.x - this.pos.x, P.z - this.pos.z) < 1.25 && !player.dead) { this.state = 'kill'; this.st = 0; player.die(); this.audio.kill(); }
        break;
      }
      case 'kill':
        this.speed *= 0.85; this.yawTo(Math.atan2(P.x - this.pos.x, P.z - this.pos.z), dt * 6);
        if (this.st > 3.5) { this.state = 'done'; this.st = 0; }
        break;
      case 'done': this.speed = 0; break;
    }
    // 발소리
    const stride = this.state === 'chase' ? 3.6 : 1.3;
    this.phase += dt * this.speed / stride * Math.PI * 2;
    const step = Math.floor(this.phase / Math.PI);
    if (step !== this.lastStep && this.speed > 0.3) this.audio.step({ x: this.pos.x, y: 0.1, z: this.pos.z }, this.state === 'chase' ? 1.0 : 0.12, this.state === 'chase');
    this.lastStep = step;
    this.animate(dt, player);
    const hb = this.rig.bones.head; hb.updateWorldMatrix(true, false);
    hb.getWorldPosition(this.headPos); this.headPos.y += 0.1; hb.getWorldDirection(this.faceDir);
    this.fill.intensity = this.state === 'chase' ? 0.5 : 0.25;
    this.rig.eyeMat.color.setScalar(this.calm ? 1.6 : 5 + Math.random() * 2); // 분노하면 눈이 강하게 빛남
  }

  // 플레이어가 096 을 조종할 때: 입력 상태로 포즈만 구동
  asAvatar() {
    const self = this;
    return { id: '096', root: this.root, rig: this.rig, head: this.rig.bones.head, radius: 0.38, camH: 2.15, camDist: 3.6, walk: 2.2, run: 10.5, jump: 8, heavy: true, strong: true,
      animate(dt, s) { self.puppet(dt, s); } };
  }
  puppet(dt, s) {
    this.t += dt; this.pos.copy(s.pos); this.yaw = s.yaw; this.speed = s.speed; this.phase = s.phase; this.wait = 0;
    const fit = s.act >= 0 && s.act < 3, st = fit ? 'trigger' : s.speed > 4.5 ? 'chase' : 'wander';
    this.st = fit ? 2 + s.act : st === this.state ? this.st + dt : 3; this.state = st;
    this.animate(dt);
    const hb = this.rig.bones.head; hb.updateWorldMatrix(true, false); hb.getWorldPosition(this.headPos); this.headPos.y += 0.1; hb.getWorldDirection(this.faceDir);
    this.rig.eyeMat.color.setScalar(st === 'wander' ? 1.6 : 5);
  }
  pickWander() {
    // 격리실과 그 앞 복도 안에서 임의 지점
    const cells = [];
    for (let y = 11; y <= 16; y++) for (let x = 10; x <= 15; x++) if ('.*S'.includes(at(x, y))) cells.push({ x, y }); // 격리실 안에서만
    const c = cells[Math.random() * cells.length | 0];
    this.target = new THREE.Vector3(center(c.x) + rnd(-0.5, 0.5), 0, center(c.y) + rnd(-0.5, 0.5));
  }
  yawTo(a, k) { this.yaw += wrap(a - this.yaw) * Math.min(1, k * 4); }

  // 거리장 경로 따라 이동. 추격 중엔 문을 부숨
  moveTo(tgt, top, dt, chase) {
    const dx = tgt.x - this.pos.x, dz = tgt.z - this.pos.z, dist = Math.hypot(dx, dz);
    if (!chase && dist < 0.4) { this.speed *= 0.8; return true; }
    const ok = chase ? walkable096 : (x, y) => walkable096(x, y) && !'DXZ'.includes(at(x, y));
    this.pathT -= dt;
    const tx = cellOf(tgt.x), ty = cellOf(tgt.z);
    if (this.pathT <= 0 || !this.path || this.pathKey !== tx + ty * W) { this.path = distanceField(tx, ty, ok); this.pathKey = tx + ty * W; this.pathT = 0.3; }
    // 경로를 따라 몇 칸 앞을 보고, 직선으로 갈 수 있는 가장 먼 지점을 향함
    let cx = cellOf(this.pos.x), cy = cellOf(this.pos.z), aim = null;
    const f = this.path, passTest = (x, y) => !ok(x, y);
    if (lineClear(this.pos.x, this.pos.z, tgt.x, tgt.z, passTest)) aim = tgt;
    else {
      for (let i = 0; i < 6; i++) {
        let best = null, bv = f[cx + cy * W] < 0 ? 1e9 : f[cx + cy * W];
        for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = f[cx + ax + (cy + ay) * W]; if (v >= 0 && v < bv) { bv = v; best = [cx + ax, cy + ay]; } }
        if (!best) break;
        [cx, cy] = best;
        const p = { x: center(cx), z: center(cy) };
        if (!aim || lineClear(this.pos.x, this.pos.z, p.x, p.z, passTest)) aim = p; else break;
      }
    }
    if (!aim) aim = tgt;
    const ax = aim.x - this.pos.x, az = aim.z - this.pos.z, al = Math.hypot(ax, az) || 1;
    const want = Math.atan2(ax, az), turn = Math.abs(wrap(want - this.yaw));
    if (!this.hold) this.yawTo(want, dt * (chase ? 3.5 : 1.2));
    this.speed += ((chase ? top * (1 - Math.min(0.6, turn * 0.35)) : top) - this.speed) * Math.min(1, dt * (chase ? 3 : 2));
    if (this.hold) { this.speed = top; this.phase += 0; return false; }
    const vx = Math.sin(this.yaw) * this.speed, vz = Math.cos(this.yaw) * this.speed;
    this.pos.x += vx * dt; this.pos.z += vz * dt;
    if (chase) for (const d of doors.values()) {
      if (d.passable()) continue;
      const ddx = d.cx - this.pos.x, ddz = d.cz - this.pos.z, dd = Math.hypot(ddx, ddz);
      if (dd < 2.3 && (ddx * vx + ddz * vz) > 0) { d.burst(new THREE.Vector3(vx, 0, vz).normalize(), this.audio); this.speed *= 0.55; this.bumpT = 0.35; }
    }
    collideCircle(this.pos, 0.38); this.world.collideBoxes(this.pos, 0.42, 0);
    return false;
  }

  animate(dt, player) {
    const P = this.P.clear(), t = this.t, φ = this.phase, s = Math.sin(φ), c = Math.cos(φ), st = this.state;
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
    let sharp = 7;
    const jitter = a => (Math.random() - 0.5) * a;
    // 얼굴 가리는 팔 (공용)
    const cover = (w, shake = 0) => {
      P.rot('armL', -0.8 + jitter(shake), 0, -0.1, w).rot('armR', -0.8 + jitter(shake), 0, 0.1, w);
      P.rot('foreL', -2.6, 0.15, 0, w).rot('foreR', -2.6, -0.15, 0, w);
      P.rot('handL', -0.4, Math.PI / 2, 0, w).rot('handR', -0.4, -Math.PI / 2, 0, w).rot('head', 0.25, 0, 0, w);
      P.val('curlL', 0.25, w).val('curlR', 0.25, w);
    };
    if (st === 'sit') {
      const lk = this.look, sob = Math.sin(t * 13) * (0.5 + 0.5 * Math.sin(t * 0.9));
      P.val('hipY', -1.1).val('hipZ', -0.1);
      P.rot('legL', -2.05, 0, 0.18).rot('legR', -2.05, 0, -0.18).rot('shinL', 2.55).rot('shinR', 2.55).rot('footL', 0.45).rot('footR', 0.45);
      P.rot('spine', 0.55 - 0.2 * lk + 0.06 * Math.sin(t * 1.3), 0, 0).rot('chest', 0.3 - 0.15 * lk + 0.025 * sob, 0, 0);
      P.rot('neck', 0.25 - 0.3 * lk, 0.25 * lk * Math.sin(t * 0.7), 0).rot('head', 0.35 * (1 - lk) - 0.05 * lk, lk * 1.1 * Math.sin(t * 0.55 + 1), 0.06 * sob);
      cover(1 - lk, 0.05);
      P.rot('armL', -0.75, 0, 0.08, lk).rot('armR', -0.75, 0, -0.08, lk).rot('foreL', -0.55, 0, 0, lk).rot('foreR', -0.55, 0, 0, lk).val('curlL', 0.5, lk).val('curlR', 0.5, lk);
      sharp = 3.5;
    } else if (st === 'wander' || st === 'return') {
      const m = clamp(this.speed / 0.8, 0, 1), i = 1 - m;
      P.rot('legL', -0.38 * s * m - 0.05, 0, 0.03).rot('legR', 0.38 * s * m - 0.05, 0, -0.03);
      P.rot('shinL', 0.15 + 0.55 * Math.max(0, c) * m).rot('shinR', 0.15 + 0.55 * Math.max(0, -c) * m);
      P.rot('footL', 0.3 * s * m).rot('footR', -0.3 * s * m);
      P.rot('spine', 0.42 + 0.03 * Math.sin(t * 1.7)).rot('chest', 0.22, -0.06 * s * m, 0).rot('neck', 0.3).rot('head', 0.45 + 0.05 * Math.sin(t * 13) * Math.sin(t * 0.8), 0.15 * Math.sin(t * 0.4), 0.1 * Math.sin(t * 0.6));
      // 축 늘어진 긴 팔이 흔들림
      P.rot('armL', 0.15 * Math.sin(φ + 0.6) * m + 0.05 * i * Math.sin(t), 0, 0.06).rot('armR', -0.15 * Math.sin(φ + 0.6) * m, 0, -0.06);
      P.rot('foreL', -0.12).rot('foreR', -0.12).val('curlL', 0.3).val('curlR', 0.3).val('hipY', -0.08 - 0.03 * Math.abs(s) * m).val('hipZ', -0.04);
      if (this.wait > 0) cover(0.85, 0.02);
      sharp = 5;
    } else if (st === 'trigger') {
      // 발작: 얼굴을 감싸 쥐고 몸부림치며 비명. 마지막에 팔을 떨구고 입을 찢어지게 벌림
      const k = this.st, end = clamp((k - (TRIGGER_TIME - 1.2)) / 0.6, 0, 1), sh = 1 - end, fit = 0.5 + 0.5 * Math.sin(k * 2.3);
      cover(sh, 0.5 * fit);
      P.rot('spine', 0.35 + jitter(0.3) * sh * fit + 0.25 * Math.sin(k * 5) * sh, jitter(0.4) * sh, jitter(0.3) * sh);
      P.rot('chest', 0.25 + jitter(0.25) * sh, jitter(0.5) * sh * fit, 0).rot('neck', 0.3 * sh + jitter(0.3) * sh).rot('head', 0.2 * sh + jitter(0.5) * sh * fit, jitter(0.6) * sh, jitter(0.5) * sh);
      const stomp = Math.max(0, Math.sin(k * 7)) * sh * fit;
      P.rot('legL', -0.25 - 0.6 * stomp + jitter(0.1), 0, 0.1).rot('legR', -0.2 + jitter(0.1), 0, -0.1).rot('shinL', 0.4 + 0.9 * stomp).rot('shinR', 0.35).val('hipY', -0.18 + jitter(0.05) * sh);
      // 끝: 팔을 축 늘어뜨리고 고개를 들어 목표를 봄
      P.rot('armL', 0.2, 0, 0.35, end).rot('armR', 0.2, 0, -0.35, end).rot('foreL', -0.3, 0, 0, end).rot('foreR', -0.3, 0, 0, end);
      P.rot('head', -0.35, 0, 0.25, end).rot('jaw', 0.45 * sh * fit + 1.05 * end + jitter(0.1));
      P.val('curlL', 0.9 * sh, 1).val('curlR', 0.9 * sh, 1);
      sharp = 18;
    } else if (st === 'chase') {
      // 미친 듯이 앞으로 기울어 달리며 긴 팔을 휘두름
      const w = clamp(this.speed / 6, 0.3, 1), kl = 0.4 + 1.9 * Math.pow(0.5 + 0.5 * Math.cos(φ - 0.6), 2), kr = 0.4 + 1.9 * Math.pow(0.5 - 0.5 * Math.cos(φ - 0.6), 2);
      P.rot('legL', (-1.15 * s - 0.35) * w, 0, 0.06).rot('legR', (1.15 * s - 0.35) * w, 0, -0.06);
      P.rot('shinL', kl * w + 0.2).rot('shinR', kr * w + 0.2).rot('footL', 0.4 * s - 0.3).rot('footR', -0.4 * s - 0.3);
      P.rot('spine', 0.65 * w + 0.08 * Math.abs(c), 0.18 * s, 0).rot('chest', 0.25, -0.35 * s, 0.1 * c);
      P.rot('neck', -0.45).rot('head', -0.55 + jitter(0.12), jitter(0.15), 0.15 * Math.sin(t * 9));
      P.rot('armL', (1.2 * s + 0.75) * w + jitter(0.2), 0.3, 0.55 + 0.35 * Math.sin(2 * φ + 1)).rot('armR', (-1.2 * s + 0.75) * w + jitter(0.2), -0.3, -0.55 - 0.35 * Math.sin(2 * φ));
      P.rot('foreL', -0.35 - 0.5 * Math.max(0, -s)).rot('foreR', -0.35 - 0.5 * Math.max(0, s));
      P.rot('jaw', 1.15 + 0.15 * Math.sin(t * 17)).val('hipY', -0.2 + 0.08 * Math.abs(c)).val('hipZ', 0.08).val('curlL', 0.15).val('curlR', 0.15);
      sharp = 22;
    } else if (st === 'kill' || st === 'done') {
      const k = clamp(this.st / 0.4, 0, 1), a = st === 'done' ? 0 : 1;
      P.rot('spine', 0.5 * a + 0.3, 0, 0).rot('chest', 0.3).rot('neck', -0.2 * a).rot('head', (-0.3 + jitter(0.25)) * a + 0.4 * (1 - a), jitter(0.3) * a, 0);
      P.rot('armL', -1.5 * a, 0, -0.15 * a).rot('armR', -1.5 * a, 0, 0.15 * a).rot('foreL', -0.5 * a).rot('foreR', -0.5 * a);
      P.rot('legL', -0.6, 0, 0.1).rot('legR', 0.1, 0, -0.1).rot('shinL', 0.9).rot('shinR', 0.4).val('hipY', -0.25);
      P.rot('jaw', (1.3 + jitter(0.2)) * a * k).val('curlL', 0.7).val('curlR', 0.7);
      if (st === 'done') cover(1, 0.03);
      sharp = 14;
    }
    applyPose(this.rig, P, dt, sharp);
  }
}
