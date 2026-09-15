// 고요(GOYO) — 동물: 사슴·토끼·여우·새·나비·물고기·반딧불이
import * as THREE from 'three';
import { clamp, clamp01, lerp, makeRng, rand, randInt, pick, TAU } from '../core/utils.js';
import { damp } from './util.js';
import { heightAt, normalAt, slopeAt, fertilityAt, WATER_LEVEL, LAKE, WORLD_LIMIT } from './terrain.js';
import { mergeGeos, tint } from './flora.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

// 모든 동물이 재질 하나를 공유한다 (드로우콜·셰이더 컴파일 절약)
const FUR_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
const WING_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.72, metalness: 0, side: THREE.DoubleSide,
});
const SCALE_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.45, metalness: 0.22, side: THREE.DoubleSide,
});

/** 한 덩어리로 움직이는 부위를 하나의 메시로 합친다 */
function seg(geos, mat = FUR_MAT) {
  const m = new THREE.Mesh(mergeGeos(geos), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/* ------------------------------------------------------------------ */
/* 네발짐승 공통                                                        */
/* ------------------------------------------------------------------ */
const SPECIES = {
  deer: {
    name: '사슴', scale: 1, body: 0.95, color: 0x8a6340, belly: 0xd8c4a8, legColor: 0x6b4c30,
    height: 1.05, legLen: 0.62, walk: 1.5, run: 7.2, flee: 15, curious: 0.35, antlers: true, spots: true,
    cry: 'deer',
  },
  fawn: {
    name: '아기사슴', scale: 0.62, body: 0.9, color: 0x9a7350, belly: 0xe2d0b6, legColor: 0x7a5a3a,
    height: 0.7, legLen: 0.42, walk: 1.3, run: 6.4, flee: 13, curious: 0.5, antlers: false, spots: true,
    cry: 'deer',
  },
  rabbit: {
    name: '토끼', scale: 0.42, body: 1.15, color: 0x9c8c78, belly: 0xece2d2, legColor: 0x8a7a66,
    height: 0.4, legLen: 0.2, walk: 1.1, run: 6.0, flee: 9, curious: 0.25, hop: true, ears: 'long',
    cry: 'rabbit',
  },
  fox: {
    name: '여우', scale: 0.6, body: 1.1, color: 0xb05f2a, belly: 0xf0e6d8, legColor: 0x3a2a22,
    height: 0.52, legLen: 0.3, walk: 1.6, run: 7.8, flee: 12, curious: 0.55, bushyTail: true,
    cry: 'fox',
  },
};

function buildQuadruped(spec, rng) {
  const g = new THREE.Group();
  const S = spec.scale;
  const bodyLen = 1.1 * S * spec.body, bodyR = 0.3 * S;
  const legLen = spec.legLen;
  const col = (hex) => new THREE.Color(hex);

  // 몸통 + 배 + 반점
  const torsoParts = [];
  const torsoGeo = new THREE.CapsuleGeometry(bodyR, bodyLen * 0.75, 4, 8);
  torsoGeo.rotateX(Math.PI / 2);
  torsoParts.push(tint(torsoGeo, col(spec.color), 0.25, rng));
  const bellyGeo = new THREE.SphereGeometry(bodyR * 0.82, 8, 6);
  bellyGeo.scale(1, 0.7, 1.5);
  bellyGeo.translate(0, -bodyR * 0.35, -bodyLen * 0.08);
  torsoParts.push(tint(bellyGeo, col(spec.belly)));
  if (spec.spots) {
    for (let i = 0; i < 8; i++) {
      const spot = new THREE.CircleGeometry(bodyR * 0.08, 6);
      const a = rng() * Math.PI - Math.PI / 2;
      spot.lookAt(new THREE.Vector3(Math.cos(a), 0.5, Math.sin(a) * 0.3));
      spot.translate(Math.cos(a) * bodyR * 0.92, Math.sin(a) * bodyR * 0.5 + bodyR * 0.2, (rng() - 0.5) * bodyLen * 0.6);
      torsoParts.push(tint(spot, col(0xf0e2cc)));
    }
  }
  const torso = seg(torsoParts);
  torso.position.y = legLen + bodyR * 0.9;
  g.add(torso);

  // 목
  const neck = new THREE.Group();
  neck.position.set(0, legLen + bodyR * 1.15, bodyLen * 0.42);
  g.add(neck);
  const neckGeo = new THREE.CylinderGeometry(bodyR * 0.42, bodyR * 0.55, bodyR * 1.5, 6);
  neckGeo.rotateX(-0.35);
  neckGeo.translate(0, bodyR * 0.6, 0);
  neck.add(seg([tint(neckGeo, col(spec.color), 0.2, rng)]));

  // 머리 — 두개골·주둥이·눈·귀·뿔을 하나로 합친다
  const head = new THREE.Group();
  head.position.set(0, bodyR * 1.25, bodyR * 0.5);
  neck.add(head);
  const headParts = [];
  const skull = new THREE.SphereGeometry(bodyR * 0.52, 8, 6);
  skull.scale(0.85, 0.9, 1.15);
  headParts.push(tint(skull, col(spec.color), 0.2, rng));
  const snout = new THREE.ConeGeometry(bodyR * 0.28, bodyR * 0.75, 6);
  snout.rotateX(Math.PI / 2);
  snout.translate(0, -bodyR * 0.12, bodyR * 0.6);
  headParts.push(tint(snout, col(spec.color)));
  const nose = new THREE.SphereGeometry(bodyR * 0.1, 5, 4);
  nose.translate(0, -bodyR * 0.14, bodyR * 0.92);
  headParts.push(tint(nose, col(0x2b2018)));
  for (const s of [-1, 1]) {
    const eye = new THREE.SphereGeometry(bodyR * 0.09, 5, 4);
    eye.translate(s * bodyR * 0.34, bodyR * 0.12, bodyR * 0.32);
    headParts.push(tint(eye, col(0x141014)));
    const ear = spec.ears === 'long'
      ? new THREE.CapsuleGeometry(bodyR * 0.12, bodyR * 1.0, 3, 5)
      : new THREE.ConeGeometry(bodyR * 0.2, bodyR * 0.5, 5);
    ear.rotateX(-0.2);
    ear.rotateZ(s * 0.35);
    ear.translate(s * bodyR * 0.3, bodyR * (spec.ears === 'long' ? 0.85 : 0.5), -bodyR * 0.05);
    headParts.push(tint(ear, col(spec.color)));
    if (!spec.antlers) continue;
    const main = new THREE.CylinderGeometry(bodyR * 0.05, bodyR * 0.08, bodyR * 1.5, 4);
    main.rotateZ(s * 0.3);
    main.translate(s * bodyR * 0.22, bodyR * 1.2, 0);
    headParts.push(tint(main, col(0x6e5a41)));
    for (let i = 0; i < 3; i++) {
      const tine = new THREE.CylinderGeometry(bodyR * 0.03, bodyR * 0.05, bodyR * (0.5 + rng() * 0.4), 4);
      tine.rotateZ(s * (0.7 + rng() * 0.4));
      tine.translate(s * bodyR * (0.42 + i * 0.12), bodyR * (1.05 + i * 0.42), 0);
      headParts.push(tint(tine, col(0x6e5a41)));
    }
  }
  head.add(seg(headParts));

  // 다리 — 허벅지 / 정강이+발굽
  const legs = [];
  const lz = [bodyLen * 0.3, bodyLen * 0.3, -bodyLen * 0.3, -bodyLen * 0.3];
  const lx = [-bodyR * 0.62, bodyR * 0.62, -bodyR * 0.66, bodyR * 0.66];
  for (let i = 0; i < 4; i++) {
    const hip = new THREE.Group();
    hip.position.set(lx[i], legLen, lz[i]);
    g.add(hip);
    const upper = new THREE.CylinderGeometry(bodyR * 0.13, bodyR * 0.1, legLen * 0.55, 5);
    upper.translate(0, -legLen * 0.27, 0);
    hip.add(seg([tint(upper, col(spec.color), 0.2, rng)]));

    const knee = new THREE.Group();
    knee.position.y = -legLen * 0.55;
    hip.add(knee);
    const lower = new THREE.CylinderGeometry(bodyR * 0.09, bodyR * 0.07, legLen * 0.45, 5);
    lower.translate(0, -legLen * 0.23, 0);
    const hoof = new THREE.CylinderGeometry(bodyR * 0.09, bodyR * 0.1, legLen * 0.1, 5);
    hoof.translate(0, -legLen * 0.47, 0);
    knee.add(seg([tint(lower, col(spec.legColor)), tint(hoof, col(0x342a22))]));
    legs.push({ hip, knee });
  }

  // 꼬리
  const tail = new THREE.Group();
  tail.position.set(0, legLen + bodyR * 0.95, -bodyLen * 0.45);
  g.add(tail);
  const tailParts = [];
  const tailGeo = spec.bushyTail
    ? new THREE.CapsuleGeometry(bodyR * 0.24, bodyLen * 0.5, 3, 6)
    : new THREE.CapsuleGeometry(bodyR * 0.12, bodyR * 0.4, 3, 5);
  tailGeo.rotateX(Math.PI / 2.2);
  tailGeo.translate(0, 0, -(spec.bushyTail ? bodyLen * 0.3 : bodyR * 0.2));
  tailParts.push(tint(tailGeo, col(spec.bushyTail ? spec.color : spec.belly), 0.2, rng));
  if (spec.bushyTail) {
    const tip = new THREE.SphereGeometry(bodyR * 0.22, 6, 5);
    tip.translate(0, 0, -bodyLen * 0.56);
    tailParts.push(tint(tip, col(0xf2ece2)));
  }
  tail.add(seg(tailParts));

  return { group: g, legs, neck, head, tail, torso, legLen, bodyLen, torsoY: torso.position.y };
}


class Quadruped {
  constructor(scene, spec, rng, x, z) {
    this.spec = spec;
    this.rng = rng;
    const built = buildQuadruped(spec, rng);
    Object.assign(this, built);
    this.group.position.set(x, heightAt(x, z), z);
    this.group.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    scene.add(this.group);

    this.pos = this.group.position;
    this.heading = rng() * TAU;
    this.speed = 0;
    this.state = 'graze';
    this.timer = rand(1, 5);
    this.phase = rng() * TAU;
    this.target = new THREE.Vector2(x, z);
    this.alert = 0;
    this.headLower = 0;
    this.bodyTilt = 0;
    this.earTwitch = 0;
    this.hopPhase = 0;
    this.visible = true;
    this.callCooldown = rand(8, 40);
  }

  _pickTarget(maxDist = 22) {
    for (let i = 0; i < 8; i++) {
      const a = this.rng() * TAU, d = 4 + this.rng() * maxDist;
      const x = this.pos.x + Math.cos(a) * d, z = this.pos.z + Math.sin(a) * d;
      if (Math.hypot(x, z) > WORLD_LIMIT - 12) continue;
      const h = heightAt(x, z);
      if (h < WATER_LEVEL + 0.4) continue;
      if (slopeAt(x, z) > 0.4) continue;
      this.target.set(x, z);
      return true;
    }
    return false;
  }

  update(dt, ctx) {
    const spec = this.spec;
    const player = ctx.player;
    const dx = this.pos.x - player.x, dz = this.pos.z - player.z;
    const pdist = Math.hypot(dx, dz);

    // 컬링 — 멀리 있으면 간단히만 갱신
    const far = pdist > 140;
    this.group.visible = pdist < 200;

    // 상태 전이
    const stealth = ctx.stealth;           // 0(시끄러움)~1(조용함)
    const fleeDist = spec.flee * (1.15 - stealth * 0.62);
    this.timer -= dt;

    if (pdist < fleeDist && this.state !== 'flee') {
      this.state = 'flee';
      this.timer = rand(2.5, 5);
      this.alert = 1;
      if (ctx.audio && pdist < 40) ctx.audio.animalCall(spec.cry, this.pos.x, this.pos.z, 0.8);
      // 달아나는 방향
      const a = Math.atan2(dz, dx) + rand(-0.6, 0.6);
      this.target.set(this.pos.x + Math.cos(a) * 34, this.pos.z + Math.sin(a) * 34);
    } else if (pdist < fleeDist * 2.1 && this.state !== 'flee' && this.state !== 'alert') {
      this.state = 'alert';
      this.timer = rand(1.5, 3.5);
    } else if (this.timer <= 0) {
      const r = this.rng();
      if (this.state === 'flee') { this.state = 'alert'; this.timer = rand(1, 2.5); }
      else if (r < 0.42) { this.state = 'graze'; this.timer = rand(4, 12); }
      else if (r < 0.86) { this.state = 'walk'; this.timer = rand(4, 10); this._pickTarget(); }
      else { this.state = 'idle'; this.timer = rand(2, 6); }
    }

    // 목표 속도
    let want = 0;
    if (this.state === 'walk') want = spec.walk;
    else if (this.state === 'flee') want = spec.run;
    else if (this.state === 'graze' && this.rng() < 0.004) { this._pickTarget(4); want = spec.walk * 0.4; }

    // 목표를 향해 회전
    let tx = this.target.x - this.pos.x, tz = this.target.y - this.pos.z;
    const tdist = Math.hypot(tx, tz);
    if (tdist < 1.2) {
      if (this.state === 'walk') { this.state = 'graze'; this.timer = rand(3, 9); }
      want = 0;
    } else {
      const wantHeading = Math.atan2(tx, tz);
      let diff = ((wantHeading - this.heading + Math.PI * 3) % TAU) - Math.PI;
      this.heading += clamp(diff, -1, 1) * dt * (this.state === 'flee' ? 3.6 : 2.0);
    }

    this.speed = damp(this.speed, want, this.state === 'flee' ? 3 : 6, dt);

    // 이동 + 지형 추종
    if (this.speed > 0.01) {
      const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt;
      const nz = this.pos.z + Math.cos(this.heading) * this.speed * dt;
      const nh = heightAt(nx, nz);
      const blocked = nh < WATER_LEVEL + 0.25 || Math.hypot(nx, nz) > WORLD_LIMIT - 6 || slopeAt(nx, nz) > 0.55;
      if (blocked) { this.heading += 2.1; this.timer = Math.min(this.timer, 0.4); }
      else { this.pos.x = nx; this.pos.z = nz; }
    }
    const groundH = heightAt(this.pos.x, this.pos.z);

    // 토끼는 깡충깡충
    let hop = 0;
    if (spec.hop && this.speed > 0.4) {
      this.hopPhase += dt * (3.2 + this.speed * 0.9);
      hop = Math.max(0, Math.sin(this.hopPhase)) * clamp01(this.speed / spec.run) * 0.45;
    } else this.hopPhase = 0;
    this.pos.y = damp(this.pos.y, groundH + hop, 14, dt);

    // 지면 기울기에 맞춰 자세
    const n = normalAt(this.pos.x, this.pos.z, 0.9);
    _q.setFromUnitVectors(_up, n);
    _q.multiply(_q2.setFromAxisAngle(_up, this.heading));
    this.group.quaternion.slerp(_q, 1 - Math.exp(-8 * dt));

    if (far) return;

    // 다리 / 머리 애니메이션
    const gait = this.speed / Math.max(spec.walk, 0.001);
    this.phase += dt * (2.4 + this.speed * 2.2);
    const amp = clamp01(this.speed / spec.walk) * 0.55;
    for (let i = 0; i < 4; i++) {
      const off = (i === 0 || i === 3) ? 0 : Math.PI;   // 대각선 보행
      const s = Math.sin(this.phase + off);
      const leg = this.legs[i];
      if (spec.hop && this.speed > 0.4) {
        const hp = Math.sin(this.hopPhase) * 0.9;
        leg.hip.rotation.x = (i < 2 ? -hp : hp) * 0.7;
        leg.knee.rotation.x = Math.max(0, -hp) * 0.8;
      } else {
        leg.hip.rotation.x = s * amp;
        leg.knee.rotation.x = Math.max(0, -s) * amp * 0.8;
      }
    }

    const grazing = this.state === 'graze' && this.speed < 0.2;
    this.headLower = damp(this.headLower, grazing ? 1 : 0, 3, dt);
    this.neck.rotation.x = lerp(-0.1, 0.95, this.headLower) + Math.sin(this.phase * 0.5) * 0.04;
    this.alert = damp(this.alert, this.state === 'alert' || this.state === 'flee' ? 1 : 0, 4, dt);
    this.head.rotation.x = -this.alert * 0.35 + Math.sin(this.phase * 0.7) * 0.03;
    // 경계 중엔 플레이어를 본다
    if (this.alert > 0.05) {
      const toPlayer = Math.atan2(player.x - this.pos.x, player.z - this.pos.z) - this.heading;
      this.head.rotation.y = damp(this.head.rotation.y, clamp(((toPlayer + Math.PI * 3) % TAU) - Math.PI, -0.9, 0.9) * this.alert, 5, dt);
    } else {
      this.head.rotation.y = damp(this.head.rotation.y, Math.sin(this.phase * 0.23) * 0.3, 2, dt);
    }
    this.tail.rotation.x = Math.sin(this.phase * 1.6) * 0.12 * (0.3 + gait) + (this.state === 'flee' ? 0.6 : 0);
    this.tail.rotation.z = Math.sin(this.phase * 1.1) * 0.1;
    this.torso.position.y = this.torsoY + Math.sin(this.phase * 2) * 0.014 * gait;

    // 가끔 우는 소리
    this.callCooldown -= dt;
    if (this.callCooldown <= 0 && ctx.audio && pdist < 70) {
      this.callCooldown = rand(20, 70);
      if (this.rng() < 0.5) ctx.audio.animalCall(spec.cry, this.pos.x, this.pos.z, 0.5);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 새 — 무리 비행 + 나뭇가지 착지                                        */
/* ------------------------------------------------------------------ */
function buildBird(hex, size) {
  const g = new THREE.Group();
  const color = new THREE.Color(hex);
  // 몸통·머리·부리·꽁지는 한 덩어리
  const body = new THREE.CapsuleGeometry(size * 0.28, size * 0.6, 3, 6);
  body.rotateX(Math.PI / 2);
  const head = new THREE.SphereGeometry(size * 0.24, 6, 5);
  head.translate(0, size * 0.16, size * 0.5);
  const beak = new THREE.ConeGeometry(size * 0.08, size * 0.26, 5);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, size * 0.12, size * 0.74);
  const tailGeo = new THREE.BoxGeometry(size * 0.4, size * 0.04, size * 0.5);
  tailGeo.translate(0, 0, -size * 0.7);
  g.add(seg([
    tint(body, color), tint(head, color),
    tint(beak, new THREE.Color(0xe8a13c)), tint(tailGeo, color),
  ]));

  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * size * 0.2, size * 0.08, 0);
    const wGeo = new THREE.PlaneGeometry(size * 1.15, size * 0.5);
    wGeo.rotateX(-Math.PI / 2);
    wGeo.translate(s * size * 0.58, 0, 0);
    pivot.add(seg([tint(wGeo, color)], WING_MAT));
    g.add(pivot);
    wings.push({ pivot, side: s });
  }
  return { group: g, wings };
}

class Birds {
  constructor(scene, count, rng, trees) {
    this.rng = rng;
    this.birds = [];
    this.trees = trees;
    const palette = [0x3d3a42, 0x6a4a34, 0x2f4a63, 0x8a6a3a, 0x4a4f3a];
    for (let i = 0; i < count; i++) {
      const size = 0.22 + rng() * 0.12;
      const b = buildBird(pick(palette), size);
      b.group.position.set(rand(-80, 80), 30 + rng() * 25, rand(-80, 80));
      scene.add(b.group);
      this.birds.push({
        ...b,
        size,
        phase: rng() * TAU,
        flapSpeed: 9 + rng() * 6,
        radius: 22 + rng() * 40,
        angle: rng() * TAU,
        speed: 0.16 + rng() * 0.14,
        alt: 24 + rng() * 26,
        state: 'fly',
        timer: rand(6, 26),
        perch: null,
        vel: new THREE.Vector3(),
      });
    }
    this.center = new THREE.Vector3(0, 0, 0);
    this.centerTarget = new THREE.Vector3(rand(-90, 90), 0, rand(-90, 90));
    this.centerTimer = 20;
  }

  update(dt, ctx) {
    this.centerTimer -= dt;
    if (this.centerTimer <= 0) {
      this.centerTimer = rand(25, 60);
      this.centerTarget.set(ctx.player.x + rand(-90, 90), 0, ctx.player.z + rand(-90, 90));
    }
    this.center.lerp(this.centerTarget, 1 - Math.exp(-0.25 * dt));

    for (const b of this.birds) {
      b.timer -= dt;
      if (b.state === 'fly') {
        b.angle += b.speed * dt;
        const tx = this.center.x + Math.cos(b.angle) * b.radius;
        const tz = this.center.z + Math.sin(b.angle) * b.radius;
        const ty = Math.max(heightAt(tx, tz) + 12, b.alt + Math.sin(b.phase + b.angle * 2) * 4);
        _v.set(tx, ty, tz).sub(b.group.position);
        const dist = _v.length();
        b.vel.lerp(_v.normalize().multiplyScalar(4.5 + b.size * 6), 1 - Math.exp(-1.6 * dt));
        b.group.position.addScaledVector(b.vel, dt);
        // 진행 방향 보기
        _v2.copy(b.group.position).add(b.vel);
        b.group.lookAt(_v2);
        b.group.rotateY(Math.PI);
        b.group.rotation.z = clamp(-b.vel.x * 0.05, -0.5, 0.5);

        const climb = clamp01(b.vel.y * 0.4 + 0.5);
        b.phase += dt * b.flapSpeed * (0.6 + climb);
        const flap = Math.sin(b.phase);
        for (const w of b.wings) w.pivot.rotation.z = w.side * (flap * 0.8 + 0.15);

        if (b.timer <= 0 && this.trees && this.trees.length && this.rng() < 0.5) {
          const t = this.trees[Math.floor(this.rng() * this.trees.length)];
          if (Math.hypot(t[0] - ctx.player.x, t[1] - ctx.player.z) < 90) {
            b.perch = new THREE.Vector3(t[0] + rand(-1.2, 1.2), t[2] + 5 + this.rng() * 3, t[1] + rand(-1.2, 1.2));
            b.state = 'land';
            b.timer = 12;
          } else b.timer = rand(8, 22);
        }
      } else if (b.state === 'land') {
        _v.copy(b.perch).sub(b.group.position);
        const d = _v.length();
        b.group.position.addScaledVector(_v.normalize(), Math.min(d, 4.2 * dt));
        b.phase += dt * b.flapSpeed * 1.2;
        const flap = Math.sin(b.phase);
        for (const w of b.wings) w.pivot.rotation.z = w.side * (flap * 0.7 + 0.15);
        if (d < 0.4 || b.timer <= 0) { b.state = 'perch'; b.timer = rand(8, 30); }
      } else {
        // 앉아 있는 중 — 가끔 지저귄다
        for (const w of b.wings) w.pivot.rotation.z = w.side * 0.1;
        b.group.rotation.y += Math.sin(ctx.time * 0.6 + b.phase) * dt * 0.4;
        const pd = Math.hypot(b.group.position.x - ctx.player.x, b.group.position.z - ctx.player.z);
        if (pd < 7 * (1.2 - ctx.stealth)) { b.state = 'fly'; b.timer = rand(10, 25); b.vel.y = 3; }
        if (b.timer <= 0) { b.state = 'fly'; b.timer = rand(10, 25); }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 나비                                                                */
/* ------------------------------------------------------------------ */
class Butterflies {
  constructor(scene, count, rng) {
    this.items = [];
    const palette = [0xf2e07a, 0xe88aa8, 0x8ac4e8, 0xf0f0e4, 0xe8a04a];
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      const color = new THREE.Color(pick(palette));
      const wings = [];
      for (const s of [-1, 1]) {
        const pivot = new THREE.Group();
        const geo = new THREE.PlaneGeometry(0.12, 0.09);
        geo.translate(s * 0.06, 0, 0);
        const m = new THREE.Mesh(tint(geo, color, 0.3, rng), WING_MAT);
        pivot.add(m);
        g.add(pivot);
        wings.push({ pivot, side: s });
      }
      const x = rand(-60, 60), z = rand(-60, 60);
      g.position.set(x, heightAt(x, z) + 0.8, z);
      scene.add(g);
      this.items.push({ group: g, wings, phase: rng() * TAU, t: rng() * 100, home: new THREE.Vector2(x, z), speed: 0.5 + rng() * 0.5 });
    }
    this.rng = rng;
  }

  update(dt, ctx) {
    for (const b of this.items) {
      b.t += dt * b.speed;
      const px = b.home.x + Math.sin(b.t * 0.7) * 5 + Math.sin(b.t * 1.7) * 1.6;
      const pz = b.home.y + Math.cos(b.t * 0.53) * 5 + Math.cos(b.t * 2.1) * 1.4;
      const h = heightAt(px, pz);
      const py = h + 0.55 + Math.sin(b.t * 2.4) * 0.35 + Math.sin(b.t * 0.9) * 0.2;
      _v.set(px, py, pz);
      b.group.position.lerp(_v, 1 - Math.exp(-3 * dt));
      b.group.rotation.y = Math.atan2(px - b.group.position.x, pz - b.group.position.z);
      b.phase += dt * (14 + Math.sin(b.t * 3) * 5);
      const flap = Math.abs(Math.sin(b.phase));
      for (const w of b.wings) w.pivot.rotation.y = w.side * (0.25 + flap * 1.15);
      // 밤에는 쉰다
      b.group.visible = ctx.night < 0.55;
      // 플레이어 곁에서 멀어지면 새 자리로
      if (Math.hypot(b.home.x - ctx.player.x, b.home.y - ctx.player.z) > 70) {
        const a = this.rng() * TAU, d = 18 + this.rng() * 28;
        b.home.set(ctx.player.x + Math.cos(a) * d, ctx.player.z + Math.sin(a) * d);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 물고기 — 호수                                                        */
/* ------------------------------------------------------------------ */
class Fish {
  constructor(scene, count, rng, water) {
    this.items = [];
    this.water = water;
    this.rng = rng;
    for (let i = 0; i < count; i++) {
      const size = 0.18 + rng() * 0.22;
      const bodyGeo = new THREE.CapsuleGeometry(size * 0.3, size, 3, 6);
      bodyGeo.rotateX(Math.PI / 2);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(tint(bodyGeo, new THREE.Color(0x6b7a6a), 0.4, rng), SCALE_MAT));
      const tailGeo = new THREE.ConeGeometry(size * 0.35, size * 0.55, 4);
      tailGeo.rotateX(-Math.PI / 2);
      const tail = new THREE.Mesh(tint(tailGeo, new THREE.Color(0x5a6a5a)), SCALE_MAT);
      tail.position.z = -size * 0.85;
      g.add(tail);
      scene.add(g);
      const a = rng() * TAU, r = rng() * LAKE.r * 0.7;
      this.items.push({
        group: g, tail, size,
        angle: a, radius: r, speed: 0.3 + rng() * 0.5,
        depth: 0.35 + rng() * 0.9, phase: rng() * TAU, jumpTimer: rand(15, 70),
      });
    }
  }

  update(dt, ctx) {
    for (const f of this.items) {
      f.angle += dt * f.speed * 0.35;
      f.phase += dt * (4 + f.speed * 4);
      const x = LAKE.x + Math.cos(f.angle) * f.radius + Math.sin(f.phase * 0.3) * 1.5;
      const z = LAKE.z + Math.sin(f.angle) * f.radius + Math.cos(f.phase * 0.27) * 1.5;
      const floor = heightAt(x, z);
      const y = Math.max(floor + 0.25, WATER_LEVEL - f.depth);
      f.group.position.set(x, y, z);
      f.group.rotation.y = -f.angle + Math.PI / 2;
      f.tail.rotation.y = Math.sin(f.phase) * 0.5;

      f.jumpTimer -= dt;
      if (f.jumpTimer <= 0) {
        f.jumpTimer = rand(20, 90);
        if (this.water) this.water.splash(x, z, 0.8);
        if (ctx.audio) ctx.audio.splash(x, z, 0.5);
      } else if (this.rng() < dt * 0.25) {
        if (this.water) this.water.splash(x, z, 0.25);
      }
      f.group.visible = ctx.night < 0.7;
    }
  }
}

/* ------------------------------------------------------------------ */
/* 반딧불이 / 꽃가루                                                     */
/* ------------------------------------------------------------------ */
class Motes {
  constructor(scene, count) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rand(-40, 40); pos[i * 3 + 1] = rand(0, 6); pos[i * 3 + 2] = rand(-40, 40);
      seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uNight: { value: 0 },
        uOrigin: { value: new THREE.Vector3() },
        uFireflyColor: { value: new THREE.Color(0xbdf07a) },
        uPollenColor: { value: new THREE.Color(0xfff0c0) },
      },
      vertexShader: /* glsl */`
        attribute float aSeed;
        uniform float uTime; uniform float uNight; uniform vec3 uOrigin;
        varying float vGlow; varying float vNight;
        void main() {
          vec3 p = position;
          float t = uTime + aSeed * 6.2;
          // 플레이어 주변 40m 박스 안에서 순환
          p.x = uOrigin.x + mod(position.x + sin(t * 0.31) * 6.0 + 40.0, 80.0) - 40.0;
          p.z = uOrigin.z + mod(position.z + cos(t * 0.27) * 6.0 + 40.0, 80.0) - 40.0;
          p.y = uOrigin.y + p.y * (0.4 + uNight * 0.5) + sin(t * 0.9) * 0.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vGlow = 0.5 + 0.5 * sin(t * 2.6 + aSeed);
          vNight = uNight;
          gl_PointSize = mix(1.3, 2.3, uNight) * (22.0 / -mv.z) * (0.6 + vGlow * 0.5);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uFireflyColor; uniform vec3 uPollenColor;
        varying float vGlow; varying float vNight;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          a *= a;
          vec3 col = mix(uPollenColor, uFireflyColor, vNight);
          float amp = mix(0.35, vGlow * vGlow, vNight);
          gl_FragColor = vec4(col * (0.4 + vNight * 0.8), a * amp * mix(0.3, 0.75, vNight));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt, ctx) {
    this.mat.uniforms.uTime.value += dt;
    this.mat.uniforms.uNight.value = ctx.night;
    this.mat.uniforms.uOrigin.value.set(ctx.player.x, heightAt(ctx.player.x, ctx.player.z) + 0.6, ctx.player.z);
  }
}

/* ------------------------------------------------------------------ */
/* 총괄                                                                */
/* ------------------------------------------------------------------ */
export class Wildlife {
  constructor(scene, { quality = 'high', trees = [], water = null, seed = 777 } = {}) {
    const rng = makeRng(seed);
    this.rng = rng;
    this.animals = [];
    const q = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;

    const spawn = (spec, n) => {
      for (let i = 0; i < n; i++) {
        let x = 0, z = 0, ok = false;
        for (let t = 0; t < 40; t++) {
          const a = rng() * TAU, d = 25 + rng() * (WORLD_LIMIT - 50);
          x = Math.cos(a) * d; z = Math.sin(a) * d;
          const h = heightAt(x, z);
          if (h > WATER_LEVEL + 0.6 && slopeAt(x, z) < 0.3 && fertilityAt(x, z) > 0.2) { ok = true; break; }
        }
        if (ok) this.animals.push(new Quadruped(scene, spec, rng, x, z));
      }
    };
    spawn(SPECIES.deer, Math.round(5 * q));
    spawn(SPECIES.fawn, Math.round(3 * q));
    spawn(SPECIES.rabbit, Math.round(8 * q));
    spawn(SPECIES.fox, Math.round(2 * q));

    this.birds = new Birds(scene, Math.round(16 * q), rng, trees);
    this.butterflies = new Butterflies(scene, Math.round(14 * q), rng);
    this.fish = new Fish(scene, Math.round(9 * q), rng, water);
    this.motes = new Motes(scene, Math.round(260 * q));
  }

  /** 플레이어 근처에서 평온하게 머무는 동물 수 — 힐링 지표 */
  calmNearby(px, pz) {
    let n = 0;
    for (const a of this.animals) {
      const d = Math.hypot(a.pos.x - px, a.pos.z - pz);
      if (d < 16 && a.state !== 'flee') n++;
    }
    return n;
  }

  nearest(px, pz) {
    let best = null, bd = Infinity;
    for (const a of this.animals) {
      const d = Math.hypot(a.pos.x - px, a.pos.z - pz);
      if (d < bd) { bd = d; best = a; }
    }
    return { animal: best, dist: bd };
  }

  update(dt, ctx) {
    for (const a of this.animals) a.update(dt, ctx);
    this.birds.update(dt, ctx);
    this.butterflies.update(dt, ctx);
    this.fish.update(dt, ctx);
    this.motes.update(dt, ctx);
  }
}

export { SPECIES };
