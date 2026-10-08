// 사람들: 개인 특성(나이·성별·체격·성격) · 인지(지진/사이렌/재난문자/파도 목격/바닷물 빠짐)
//  · 감정(공포 전염·안도·슬픔) · 가족/일행 · 도우미 · 대피(고지대/수직대피) · 물살 안정성(수심×유속)
//  · 절차적 관절 애니메이션(걷기·달리기·웅크림·허우적·손 흔들기·촬영·울기)
import * as THREE from 'three';
import { makeRng } from '../../src/core/utils.js';
import { HALF, WORLD, SAFE_ELEV, PERSON_TYPES, EMOTIONS, LINES, SURNAMES, GIVEN } from './config.js';
import { inlandDist, coastZ, coastSlope, districtAt, SIRENS, PORT_Z } from './geo.js';

const PARTS = 11;
const TAU = Math.PI * 2;
const ROLE = {
  tourist: '관광객', resident: '주민', office: '회사원', student: '학생', worker: '항만 노동자',
  fisher: '어부', merchant: '상인', retiree: '은퇴자', surfer: '서퍼', kid: '어린이',
};

const _v = new THREE.Vector3();
const tmpS = {};
const tmpDir = { x: 0, z: 0 };

export class People {
  constructor(scene, ctx, count) {
    this.ctx = ctx;                    // { terrain, city, nav, sim }
    this.scene = scene;
    this.max = count;
    this.list = [];
    this.groups = [];
    this.rng = makeRng(77123);
    this.buildMeshes(count);
    this.spawnAll();
  }

  /* ───────────────────────── 생성 ───────────────────────── */
  spawnAll() {
    this.list = [];
    this.groups = [];
    this.rng = makeRng(77123);
    const r = this.rng;
    const zones = [
      ['beach', 0.22], ['promenade', 0.09], ['port', 0.1], ['riverside', 0.18],
      ['beachTown', 0.12], ['central', 0.16], ['cape', 0.07], ['hills', 0.06],
    ];
    let guard = 0;
    while (this.list.length < this.max && guard++ < 20000) {
      let z = r(), zone = zones[zones.length - 1][0];
      for (const [k, w] of zones) { if (z < w) { zone = k; break; } z -= w; }
      const spot = this.findSpot(zone);
      if (!spot) continue;
      this.spawnGroup(zone, spot);
    }
    this.list.length = Math.min(this.list.length, this.max);
    this.list.forEach((p, i) => { p.i = i; });
    this.groups = this.groups.map((g) => g.filter((p) => p.i !== undefined && this.list[p.i] === p)).filter((g) => g.length);
    this.groups.forEach((g, gi) => g.forEach((p) => { p.group = gi; p.leader = g[0]; }));
    this.applyColors();
    this.mesh.count = this.list.length * PARTS;
    this.heads.count = this.hair.count = this.hats.count = this.list.length;
  }

  findSpot(zone) {
    const r = this.rng, { terrain, nav } = this.ctx;
    for (let t = 0; t < 30; t++) {
      let x, z;
      if (zone === 'beach') { x = -140 + r() * 1000; z = coastZ(x) - (8 + r() * 55); }
      else if (zone === 'promenade') { x = -900 + r() * 1900; z = coastZ(x) - (66 + r() * 34); }
      else if (zone === 'port') { x = -1980 + r() * 950; z = PORT_Z - 6 - r() * 420; }
      else if (zone === 'riverside') { x = -980 + r() * 780; z = -900 + r() * 1000; }
      else if (zone === 'beachTown') { x = -180 + r() * 1050; z = coastZ(x) - (110 + r() * 300); }
      else if (zone === 'central') { x = -180 + r() * 1050; z = coastZ(x) - (420 + r() * 600); }
      else if (zone === 'cape') { x = 900 + r() * 420; z = 200 + r() * 520; }
      else { x = -1900 + r() * 3800; z = -1500 + r() * 700; }
      if (Math.abs(x) > HALF - 30 || Math.abs(z) > HALF - 30) continue;
      if (zone === 'beach') {
        const g = terrain.groundAt(x, z);
        if (g < 0.25 || g > 3.5) continue;
        if (this.ctx.city.riverDist(x, z) < 45) continue;
        return { x, z, zone };
      }
      if (!nav.isWalkable(x, z)) continue;
      if (zone === 'cape' && inlandDist(x, z) > 420) continue;
      return { x, z, zone };
    }
    return null;
  }

  spawnGroup(zone, spot) {
    const r = this.rng;
    const roll = r();
    let members;
    if (zone === 'port') members = roll < 0.75 ? [['man', 'worker']] : roll < 0.9 ? [['man', 'fisher'], ['man', 'fisher']] : [['woman', 'merchant']];
    else if (zone === 'beach') {
      if (roll < 0.32) members = [['man', 'tourist'], ['woman', 'tourist'], ['child', 'kid'], ...(r() < 0.5 ? [['child', 'kid']] : [])];
      else if (roll < 0.62) members = Array.from({ length: 2 + Math.floor(r() * 3) }, () => [r() < 0.5 ? 'teen' : r() < 0.5 ? 'man' : 'woman', 'tourist']);
      else if (roll < 0.72) members = [['man', 'surfer']];
      else if (roll < 0.82) members = [['elder', 'tourist'], ['elder', 'tourist']];
      else members = [[r() < 0.5 ? 'man' : 'woman', 'tourist']];
    } else if (zone === 'central') members = roll < 0.55 ? [[r() < 0.55 ? 'man' : 'woman', 'office']] : roll < 0.75 ? [['man', 'resident'], ['woman', 'resident'], ['child', 'kid']] : roll < 0.88 ? [['teen', 'student'], ['teen', 'student']] : [['elder', 'retiree']];
    else if (zone === 'riverside' || zone === 'hills' || zone === 'cape') {
      if (roll < 0.28) members = [['man', 'resident'], ['woman', 'resident'], ['child', 'kid'], ...(r() < 0.4 ? [['child', 'kid']] : [])];
      else if (roll < 0.5) members = [['elder', 'retiree'], ...(r() < 0.6 ? [['elder', 'retiree']] : [])];
      else if (roll < 0.6) members = [['elder', 'retiree'], ['child', 'kid']];
      else if (roll < 0.75) members = Array.from({ length: 2 + Math.floor(r() * 3) }, () => ['teen', 'student']);
      else members = [[r() < 0.5 ? 'man' : 'woman', zone === 'cape' ? 'fisher' : 'resident']];
    } else if (zone === 'beachTown') members = roll < 0.4 ? [[r() < 0.5 ? 'man' : 'woman', 'merchant']] : roll < 0.75 ? Array.from({ length: 2 + Math.floor(r() * 2) }, () => [r() < 0.5 ? 'man' : 'woman', 'tourist']) : [['man', 'tourist'], ['woman', 'tourist'], ['child', 'kid']];
    else members = roll < 0.5 ? [[r() < 0.5 ? 'man' : 'woman', 'resident']] : roll < 0.7 ? [['teen', 'student']] : roll < 0.85 ? [['man', 'resident'], ['woman', 'resident']] : [['elder', 'retiree']];
    const group = [];
    const surname = SURNAMES[Math.floor(r() * SURNAMES.length)];
    for (const [type, role] of members) {
      if (this.list.length >= this.max) break;
      const p = this.makePerson(type, role, spot.x + (r() - 0.5) * 3, spot.z + (r() - 0.5) * 3, spot.zone, group.length && role !== 'tourist' && role !== 'student' ? surname : null);
      group.push(p);
      this.list.push(p);
    }
    if (group.length) {
      const L = group[0];
      for (const p of group) {
        if (p === L) continue;
        if (L.activity === 'swim') { p.activity = 'swim'; p.swimmer = true; p.x = L.x + (r() - 0.5) * 4; p.z = L.z + (r() - 0.5) * 4; p.swimBaseZ = L.swimBaseZ; }
        else { if (p.activity === 'swim') { p.z = L.z + (r() - 0.5) * 3; p.swimmer = false; } p.activity = L.activity === 'jog' ? 'jog' : L.activity === 'sit' && r() < 0.7 ? 'sit' : L.activity === 'stroll' ? 'stroll' : p.activity === 'swim' ? 'idle' : p.activity; }
      }
      this.groups.push(group);
    }
  }

  makePerson(type, role, x, z, zone, surname) {
    const r = this.rng, T = PERSON_TYPES[type];
    const sex = type === 'man' ? 'M' : type === 'woman' ? 'F' : r() < 0.5 ? 'M' : 'F';
    const age = type === 'child' ? 4 + Math.floor(r() * 8) : type === 'teen' ? 13 + Math.floor(r() * 6) : type === 'elder' ? 66 + Math.floor(r() * 22) : 22 + Math.floor(r() * 40);
    let height = T.h[0] + r() * (T.h[1] - T.h[0]);
    if (type === 'teen' && sex === 'F') height -= 0.06;
    const name = (surname || SURNAMES[Math.floor(r() * SURNAMES.length)]) + GIVEN[Math.floor(r() * GIVEN.length)] + GIVEN[Math.floor(r() * GIVEN.length)];
    const local = role !== 'tourist' && role !== 'surfer';
    const fitness = Math.max(0.3, Math.min(1.3, (type === 'elder' ? 0.55 : 1) * (0.75 + r() * 0.5) * (role === 'surfer' ? 1.2 : 1)));
    const p = {
      type, role, roleName: ROLE[role], sex, age, name, height, mass: T.mass * (height / 1.7) ** 2 * (0.85 + r() * 0.35),
      walk: T.walk * (0.85 + r() * 0.3), run: T.run * fitness * (0.85 + r() * 0.25), dvCrit: T.dv * (0.8 + r() * 0.4),
      fitness, stamina: 1,
      composure: Math.min(1, Math.max(0, (type === 'child' ? 0.25 : type === 'elder' ? 0.6 : 0.45) + (r() - 0.5) * 0.7)),
      altruism: r() ** 0.8, curiosity: r(), prep: Math.min(1, (local ? 0.35 + r() * 0.65 : r() * 0.45) * (type === 'child' ? 0.4 : 1)),
      bias: r() ** 1.5, local, phone: type !== 'child' && r() < (type === 'elder' ? 0.45 : 0.92),
      x, z, y: 0, vx: 0, vz: 0, yaw: r() * TAU, homeZone: zone, district: Math.max(0, districtAt(x, z)),
      state: 'normal', activity: 'walk', tx: x, tz: z, timer: r() * 5, perceiveT: r() * 0.4,
      awareness: 0, fear: 0.02, emotion: 'calm', thought: '', thoughtT: 0, heart: 72,
      reactDelay: 2 + r() ** 2 * 40, decideT: -1, sawWave: false, sawDraw: false, heardSiren: false, gotAlert: false, alertDelay: r() * 25,
      threat: 0, threatDir: [0, 1], escort: null, escortedBy: null, building: null, roofX: 0, roofZ: 0, inT: 0,
      waterT: 0, depth: 0, frozenT: 0, frozeOnce: false, fallT: 0, safeT: 0, lostFamily: false, watched: false,
      // 애니메이션
      phase: r() * TAU, anim: { spd: 0, lean: 0, crouch: 0, arms: 0, fall: 0, swim: 0, wave: 0, phone: 0, sit: 0, cry: 0, head: 0, chat: 0, roll: 0, tumble: 0 },
      ap: this.appearance(type, role, sex, r),
    };
    p.restHeart = type === 'child' ? 92 : type === 'elder' ? 70 : 66 + r() * 10;
    // 일상 활동
    if (zone === 'beach') p.activity = role === 'surfer' ? 'swim' : r() < 0.35 ? 'sit' : r() < 0.25 ? 'swim' : r() < 0.5 ? 'idle' : 'stroll';
    else if (zone === 'promenade') p.activity = r() < 0.3 ? 'jog' : r() < 0.6 ? 'walk' : 'idle';
    else if (role === 'fisher' && zone === 'port') p.activity = 'idle';
    else p.activity = r() < 0.62 ? 'walk' : 'idle';
    if (p.activity === 'swim') { p.z += 30 + r() * 25; p.swimBaseZ = p.z; p.swimmer = true; }
    return p;
  }

  appearance(type, role, sex, r) {
    const c = new THREE.Color();
    const hsl = (h, s, l) => c.setHSL(h, s, l).getHex();
    const skin = role === 'tourist' && r() < 0.35 ? hsl(0.06 + r() * 0.03, 0.35 + r() * 0.2, 0.3 + r() * 0.5) : hsl(0.07 + r() * 0.02, 0.38 + r() * 0.15, 0.62 + r() * 0.14);
    let hair = r() < 0.8 ? hsl(0.07, 0.25, 0.06 + r() * 0.08) : hsl(0.07 + r() * 0.04, 0.45, 0.2 + r() * 0.25);
    if (type === 'elder') hair = hsl(0, 0, 0.55 + r() * 0.35);
    const bright = () => hsl(r(), 0.55 + r() * 0.35, 0.42 + r() * 0.2);
    const muted = () => hsl(r(), 0.12 + r() * 0.2, 0.25 + r() * 0.35);
    let top = muted(), bottom = hsl(0.6, 0.25, 0.12 + r() * 0.2), sleeves = 1, shorts = 0, hat = 0, hatColor = 0xffffff;
    if (role === 'tourist' || role === 'kid') { top = bright(); bottom = r() < 0.5 ? bright() : hsl(0.58, 0.3, 0.3 + r() * 0.2); sleeves = 0; shorts = r() < 0.7 ? 1 : 0; if (r() < 0.25) { hat = 2; hatColor = hsl(0.12, 0.4, 0.75); } }
    if (role === 'surfer') { top = hsl(0.6, 0.2, 0.08); bottom = top; sleeves = 1; }
    if (role === 'office') { top = r() < 0.5 ? hsl(0.62, 0.3, 0.13) : hsl(0, 0, 0.1 + r() * 0.15); bottom = top; }
    if (role === 'student') { top = hsl(0.63, 0.45, 0.16); bottom = sex === 'F' ? hsl(0.62, 0.15, 0.3) : hsl(0.62, 0.2, 0.15); shorts = sex === 'F' ? 2 : 0; }
    if (role === 'worker') { top = hsl(0.07, 0.95, 0.5); bottom = hsl(0.6, 0.3, 0.18); hat = 3; hatColor = r() < 0.6 ? 0xf2c230 : 0xf0f0f0; }
    if (role === 'fisher') { top = hsl(0.1, 0.5, 0.4); bottom = hsl(0.6, 0.1, 0.2); if (r() < 0.6) { hat = 1; hatColor = muted(); } }
    if (role === 'retiree') { top = muted(); bottom = hsl(0.08, 0.15, 0.25 + r() * 0.2); if (r() < 0.4) { hat = 1; hatColor = muted(); } }
    if (role === 'merchant' && r() < 0.5) top = hsl(0, 0, 0.92);
    if (sex === 'F' && (type === 'woman' || type === 'teen') && role !== 'student' && r() < 0.3) shorts = 2;
    if (hat === 0 && r() < 0.08) { hat = 1; hatColor = bright(); }
    const hairStyle = type === 'elder' && sex === 'M' && r() < 0.35 ? 2 : sex === 'F' ? (r() < 0.6 ? 1 : 3) : 0;
    return { skin, hair, top, bottom, sleeves, shorts, hat, hatColor, hairStyle, shoulders: sex === 'M' ? 0.122 : 0.106, girth: 0.9 + r() * 0.35 };
  }

  /* ───────────────────────── 렌더 메시 ───────────────────────── */
  buildMeshes(count) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.0, envMapIntensity: 0.5 });
    this.mesh = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.5, 1, 3, 8), mat, count * PARTS);
    this.heads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 9), mat, count);
    this.hair = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.6 }), count);
    this.hats = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 12), new THREE.MeshStandardMaterial({ roughness: 0.6 }), count);
    for (const m of [this.mesh, this.heads, this.hair, this.hats]) {
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m);
    }
    // 지도용 감정 표시점
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(32, 32, 26, 0, TAU); cx.fill();
    cx.lineWidth = 7; cx.strokeStyle = 'rgba(0,0,0,0.55)'; cx.stroke();
    this.markers = new THREE.Points(g, new THREE.PointsMaterial({
      size: 9, sizeAttenuation: false, vertexColors: true, map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false, alphaTest: 0.2,
    }));
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 10;
    this.scene.add(this.markers);
    // 선택 표시 고리
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.9, depthTest: false }));
    this.ring.renderOrder = 11;
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.emoColors = {};
    for (const [k, e] of Object.entries(EMOTIONS)) this.emoColors[k] = new THREE.Color(e.color);
  }

  applyColors() {
    const c = new THREE.Color();
    for (const p of this.list) {
      const a = p.ap, b = p.i * PARTS;
      const set = (k, col) => this.mesh.setColorAt(b + k, c.set(col));
      set(0, a.top); set(1, a.bottom);
      set(2, a.top); set(3, a.sleeves ? a.top : a.skin);
      set(4, a.top); set(5, a.sleeves ? a.top : a.skin);
      set(6, a.bottom); set(7, a.shorts ? a.skin : a.bottom);
      set(8, a.bottom); set(9, a.shorts ? a.skin : a.bottom);
      set(10, 0x5a3e28);
      this.heads.setColorAt(p.i, c.set(a.skin));
      this.hair.setColorAt(p.i, c.set(a.hair));
      this.hats.setColorAt(p.i, c.set(a.hatColor));
    }
    for (const m of [this.mesh, this.heads, this.hair, this.hats]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  /* ───────────────────────── 갱신 ───────────────────────── */
  rebuildHash() {
    const C = 6, M = Math.ceil(WORLD / C);
    if (!this.hHead) { this.hHead = new Int32Array(M * M); this.hNext = new Int32Array(this.max + 1); this.hM = M; this.hC = C; }
    this.hHead.fill(-1);
    for (const p of this.list) {
      if (p.state === 'missing' || p.state === 'inside') continue;
      const k = this.hashKey(p.x, p.z);
      this.hNext[p.i] = this.hHead[k];
      this.hHead[k] = p.i;
    }
  }

  hashKey(x, z) {
    let i = Math.floor((x + HALF) / this.hC), j = Math.floor((z + HALF) / this.hC);
    i = i < 0 ? 0 : i >= this.hM ? this.hM - 1 : i;
    j = j < 0 ? 0 : j >= this.hM ? this.hM - 1 : j;
    return j * this.hM + i;
  }

  forNear(x, z, fn) {
    const i0 = Math.floor((x + HALF) / this.hC), j0 = Math.floor((z + HALF) / this.hC);
    for (let j = j0 - 1; j <= j0 + 1; j++) {
      if (j < 0 || j >= this.hM) continue;
      for (let i = i0 - 1; i <= i0 + 1; i++) {
        if (i < 0 || i >= this.hM) continue;
        for (let n = this.hHead[j * this.hM + i]; n >= 0; n = this.hNext[n]) fn(this.list[n]);
      }
    }
  }

  /** env: { sim, simTime, quake, sirenOn, alertOn, player } */
  update(dt, env) {
    if (dt <= 0) return;
    this.env = env;
    this.rebuildHash();
    const sub = dt > 0.06 ? Math.ceil(dt / 0.06) : 1;
    const h = dt / sub;
    // 인지: 프레임당 처리 인원 제한 (고배속에서도 비용 일정), 순환 시작점
    const n = this.list.length;
    let budget = Math.ceil(n / 8) + 2;
    this.pi = this.pi || 0;
    let c = 0;
    for (; c < n && budget > 0; c++) {
      const p = this.list[(this.pi + c) % n];
      if (p.state === 'missing' || env.simTime < p.nextPerceive) continue;
      const pdt = Math.min(2, env.simTime - (p.lastPerceive ?? env.simTime - 0.35));
      p.lastPerceive = env.simTime;
      p.nextPerceive = env.simTime + 0.3 + Math.random() * 0.15;
      this.perceive(p, env, pdt);
      budget--;
    }
    this.pi = (this.pi + c) % Math.max(1, n);
    for (const p of this.list) {
      if (p.state === 'missing') continue;
      for (let s = 0; s < sub; s++) { this.move(p, h, env); if (p.state === 'missing') break; }
      this.mood(p, dt, env);
    }
  }

  perceive(p, env, dt) {
    const sim = env.sim;
    if (p.state === 'inside') return;
    // 파도 · 침수 목격
    const CN = sim.CN, cs = WORLD / CN;
    const R = p.state === 'roof' || p.y > 14 ? 1200 : p.homeZone === 'beach' || p.homeZone === 'promenade' ? 900 : 600;
    const ci = Math.floor((p.x + HALF) / cs), cj = Math.floor((p.z + HALF) / cs), rc = Math.ceil(R / cs);
    let best = 0, bx = 0, bz = 0, draw = 0;
    for (let j = Math.max(0, cj - rc); j <= Math.min(CN - 1, cj + rc); j++) {
      for (let i = Math.max(0, ci - rc); i <= Math.min(CN - 1, ci + rc); i++) {
        const k = j * CN + i;
        const t = sim.threat[k], dd = sim.drawdown[k];
        if (t === 0 && dd === 0) continue;
        const cx = -HALF + (i + 0.5) * cs, cz = -HALF + (j + 0.5) * cs;
        const d = Math.hypot(cx - p.x, cz - p.z);
        if (d > R) continue;
        const vis = 1 - d / R;
        const s = t * (0.3 + 0.7 * vis);
        if (s > best) { best = s; bx = cx - p.x; bz = cz - p.z; }
        if (d < 520 && dd * vis > draw) draw = dd * vis;
      }
    }
    p.threat = best;
    if (best > 0.5) {
      const l = Math.hypot(bx, bz) || 1;
      p.threatDir[0] = bx / l; p.threatDir[1] = bz / l;
      if (!p.sawWave) { p.sawWave = true; p.awareness = 3; this.say(p, LINES.fear); }
      const react = env.simTime + 0.4 + (1 - p.composure) * 1.2;   // 시각적 반응 지연
      if (p.decideT < 0 || p.decideT > react) p.decideT = react;
    }
    if (draw > 0.5 && !p.sawDraw) {
      p.sawDraw = true;
      p.awareness += p.prep * 1.4;
      if (p.state === 'normal' && p.prep < 0.55 && p.curiosity > 0.45 && p.type !== 'child') {
        p.activity = 'gawk';
        const cz = coastZ(p.x);
        p.tx = p.x + (Math.random() - 0.5) * 20; p.tz = cz + 40;
        this.say(p, LINES.curious);
      }
    }
    // 사이렌
    if (env.sirenOn && !p.heardSiren) {
      for (const [sx, sz] of SIRENS) if (Math.hypot(sx - p.x, sz - p.z) < 1100) { p.heardSiren = true; break; }
      if (p.heardSiren) { p.awareness += 0.55 + p.prep * 0.5 - p.bias * 0.3; if (p.state === 'normal') this.say(p, LINES.warned); }
    }
    // 재난문자
    if (env.alertOn && p.phone && !p.gotAlert && env.simTime - env.alertTime > p.alertDelay) {
      p.gotAlert = true;
      p.awareness += 0.5 + p.prep * 0.4 - p.bias * 0.2;
    }
    // 주변 사람 (대피 행렬 · 공포 전염)
    let nN = 0, nFear = 0, nEvac = 0;
    this.forNear(p.x, p.z, (o) => {
      if (o === p) return;
      const d = Math.abs(o.x - p.x) + Math.abs(o.z - p.z);
      if (d > 12) return;
      nN++; nFear += o.fear;
      if (o.state === 'evac' && o.anim.spd > 2) nEvac++;
    });
    p.nFear = nN ? nFear / nN : 0;
    if (nEvac) p.awareness += dt * (0.2 + 0.15 * nEvac) * (1 - p.bias * 0.5);
    // 의사결정
    if (p.state === 'normal' && p.awareness >= 1) {
      if (p.decideT < 0) p.decideT = env.simTime + (p.sawWave ? 0 : p.reactDelay * (1 - Math.min(0.85, p.fear)));
      if (env.simTime >= p.decideT) this.startEvac(p);
    }
  }

  startEvac(p) {
    if (p.state !== 'normal') return;
    p.state = 'evac';
    p.activity = 'evac';
    p.field = p.local ? 'all' : 'hill';
    if (!p.sawWave) this.say(p, p.type === 'child' ? LINES.child : LINES.warned);
    // 일행 전체 대피
    const g = this.groups[p.group];
    if (g) for (const o of g) if (o.state === 'normal') { o.awareness = Math.max(o.awareness, 1); o.decideT = this.env.simTime + 0.5 + Math.random(); }
  }

  move(p, dt, env) {
    const { terrain, city, nav, sim } = this.ctx;
    const A = p.anim;
    if (p.state === 'missing') return;
    if (p.state === 'inside') {
      p.inT -= dt;
      const b = p.building;
      if (!b.alive) { this.toSwept(p, b.x + (Math.random() - 0.5) * b.w, b.z + (Math.random() - 0.5) * b.d); return; }
      if (p.inT <= 0) {
        p.state = 'roof';
        p.x = b.x + (Math.random() - 0.5) * (b.w - 3); p.z = b.z + (Math.random() - 0.5) * (b.d - 3);
        p.y = b.top; p.safeT = 0;
        p.yaw = Math.atan2(p.threatDir[0], p.threatDir[1]) || 0;
      }
      return;
    }
    // 수심·유속
    sim.sample(p.x, p.z, tmpS);
    const ground = p.state === 'roof' ? p.building.top : terrain.groundAt(p.x, p.z);
    const depth = Math.max(0, tmpS.eta - ground);
    p.depth = depth;
    const wu = tmpS.u, wv = tmpS.v, wsp = Math.hypot(wu, wv);

    if (p.state === 'swept') { this.moveSwept(p, dt, depth, wu, wv, wsp, tmpS.eta, ground); return; }

    // 물살 안정성: 수심 × 유속 (DV) 한계, 부력 한계 수심
    const dv = depth * wsp;
    const floatDepth = p.height * (p.type === 'child' ? 0.62 : 0.78);
    // 바다에 있는 수영객: 대피를 시작해도 물이 얕아질 때까지는 헤엄/걸어서 해안으로
    const swimmer = p.activity === 'swim' || (p.swimmer && depth > 0.35 && p.state === 'evac');
    // 휩쓸렸다 빠져나온 직후에는 잠시 더 버팀 (상태 진동 방지)
    if (p.recoverT > 0) p.recoverT -= dt;
    const tol = p.recoverT > 0 ? 1.7 : 1;
    if (!swimmer && depth > 0.05 && (dv > p.dvCrit * (1.15 - p.composure * 0.25) * tol || depth > floatDepth * (tol > 1 ? 1.15 : 1))) { this.toSwept(p); return; }
    if (swimmer && (wsp > 0.9 || depth > p.height * 1.8 || depth < 0.3)) {
      if (wsp > 0.9 || depth > p.height * 1.8) { this.toSwept(p); return; }
    }

    if (p.state === 'roof') {
      const b = p.building;
      if (!b.alive || depth > 1.1) { this.toSwept(p); return; }
      p.y = b.top;
      A.spd += (0 - A.spd) * Math.min(1, dt * 4);
      // 바다 쪽을 바라봄
      const ty = Math.atan2(p.threatDir[0], p.threatDir[1]);
      p.yaw += angDiff(p.yaw, ty) * Math.min(1, dt * 1.5);
      return;
    }

    // 목표 속도
    let dx = 0, dz = 0, speed = 0;
    if (p.frozenT > 0) { p.frozenT -= dt; }
    else if (p.fallT > 0) { p.fallT -= dt; }
    else if (p.state === 'evac') {
      const lead = p.leader;
      const follower = lead && lead !== p && lead.state === 'evac' && Math.hypot(lead.x - p.x, lead.z - p.z) < 35 && (p.type === 'child' || p.type === 'elder' || p.type === 'teen');
      if (p.escort && (p.escort.state !== 'evac' || Math.hypot(p.escort.x - p.x, p.escort.z - p.z) > 20)) { if (p.escort.escortedBy === p) p.escort.escortedBy = null; p.escort = null; }
      if (follower) {
        dx = lead.x - lead.vx * 0.3 - p.x; dz = lead.z - lead.vz * 0.3 - p.z;
        const l = Math.hypot(dx, dz);
        if (l > 1.2) { dx /= l; dz /= l; speed = Math.min(p.run, Math.max(lead.anim.spd * 1.1, l * 0.8)); } else { nav.direction(nav[p.field], p.x, p.z, tmpDir); dx = tmpDir.x; dz = tmpDir.z; speed = lead.anim.spd; }
      } else {
        nav.direction(nav[p.field], p.x, p.z, tmpDir);
        if (swimmer || (tmpDir.x === 0 && tmpDir.z === 0 && terrain.groundAt(p.x, p.z) < 0.4)) landward(p.x, tmpDir);
        dx = tmpDir.x; dz = tmpDir.z;
        const runFear = p.fear > 0.22 || p.sawWave;
        speed = runFear ? p.run * (0.55 + 0.45 * p.stamina) : p.walk * 1.35;
        if (p.stamina < 0.15) speed = Math.min(speed, p.walk * 1.5);
        // 일행 중 가장 느린 사람에 맞춤 (리더)
        const g = this.groups[p.group];
        if (g && g.length > 1 && lead === p) {
          for (const o of g) if (o !== p && o.state === 'evac' && Math.hypot(o.x - p.x, o.z - p.z) < 40) speed = Math.min(speed, o.run * (0.55 + 0.45 * o.stamina) * 0.95 + 0.2);
        }
        if (p.escort) speed = Math.min(speed, p.escort.anim.spd + 0.3);
        if (swimmer) speed = Math.min(speed, 0.9 + depth * 0.2);
        // 패닉: 방향 흔들림
        if (p.fear > 0.8 && p.composure < 0.4) {
          const n = Math.sin(env.simTime * 1.7 + p.i) * 0.7 * (p.fear - 0.7);
          const c = Math.cos(n), s = Math.sin(n);
          const ndx = dx * c - dz * s; dz = dx * s + dz * c; dx = ndx;
          speed *= 1.08;
        }
      }
      // 도착 판정
      const k = nav.cellOf(p.x, p.z);
      const sid = p.field === 'all' ? nav.all.src[k] : -1;
      if (sid >= 0 && !city.buildings[sid].alive) { p.field = 'hill'; this.say(p, ['건물이 무너졌어!', '다른 데로 가야 해!']); }
      if (nav.ground[k] >= SAFE_ELEV && terrain.groundAt(p.x, p.z) >= SAFE_ELEV - 0.5) { this.toSafe(p); }
      else if (p.field === 'all' && sid >= 0 && nav.all.dist[k] <= 72) {
        const b = city.buildings[sid];
        if (b && b.alive) { this.enterBuilding(p, b); return; }
      }
      // 넘어짐 (패닉 질주)
      if (speed > 2.5 && p.fear > 0.6 && Math.random() < dt * (p.type === 'elder' ? 0.03 : p.type === 'child' ? 0.02 : 0.006)) { p.fallT = 1.2 + Math.random() * 1.8; this.say(p, ['악!', '아야...', '넘어졌어!']); }
      // 공포로 얼어붙음
      if (!p.frozeOnce && p.threat > 3 && p.fear > 0.85 && p.composure < 0.22 && Math.random() < dt * 0.4) { p.frozeOnce = true; p.frozenT = 2 + Math.random() * 4; this.say(p, LINES.frozen); }
      // 도우미: 근처의 느린 노인/아이
      if (!p.escort && p.altruism > 0.72 && (p.type === 'man' || p.type === 'woman' || p.type === 'teen') && Math.random() < dt * 0.5) {
        this.forNear(p.x, p.z, (o) => {
          if (p.escort || o === p || o.group === p.group || o.escortedBy || o.state !== 'evac') return;
          if ((o.type === 'elder' || o.type === 'child') && Math.hypot(o.x - p.x, o.z - p.z) < 10 && (o.leader === o || o.leader.state !== 'evac')) {
            p.escort = o; o.escortedBy = p; this.say(p, LINES.helper);
          }
        });
      }
      if (p.escort) { const e = p.escort; const ex = e.x - p.x, ez = e.z - p.z, el = Math.hypot(ex, ez); if (el > 1.5) { dx = dx * 0.4 + ex / el * 0.6; dz = dz * 0.4 + ez / el * 0.6; } }
    } else if (p.state === 'safe') {
      p.safeT += dt;
      p.timer -= dt;
      if (p.timer <= 0) {
        p.timer = 4 + Math.random() * 10;
        if (Math.random() < 0.4) { p.tx = p.x + (Math.random() - 0.5) * 8; p.tz = p.z + (Math.random() - 0.5) * 8; } else { p.tx = p.x; p.tz = p.z; }
      }
      dx = p.tx - p.x; dz = p.tz - p.z;
      const l = Math.hypot(dx, dz);
      if (l > 0.5 && terrain.groundAt(p.tx, p.tz) > SAFE_ELEV - 2) { dx /= l; dz /= l; speed = p.walk * 0.6; } else { dx = dz = 0; }
    } else {
      // 일상 활동
      p.timer -= dt;
      const act = p.activity;
      if (act === 'walk' || act === 'stroll' || act === 'jog') {
        let l = Math.hypot(p.tx - p.x, p.tz - p.z);
        if (l < 1.5 || p.timer <= 0) { this.pickWaypoint(p); l = Math.hypot(p.tx - p.x, p.tz - p.z); }
        if (l > 0.3) { dx = (p.tx - p.x) / l; dz = (p.tz - p.z) / l; }
        speed = act === 'jog' ? p.run * 0.55 : act === 'stroll' ? p.walk * 0.7 : p.walk;
      } else if (act === 'gawk') {
        const l = Math.hypot(p.tx - p.x, p.tz - p.z);
        if (l > 2 && depth < 0.3) { dx = (p.tx - p.x) / l; dz = (p.tz - p.z) / l; speed = p.walk * 1.1; }
      } else if (act === 'swim') {
        p.timer -= dt;
        if (p.timer <= 0) { p.timer = 5 + Math.random() * 8; p.tx = p.x + (Math.random() - 0.5) * 30; p.tz = (p.swimBaseZ || p.z) + (Math.random() - 0.5) * 16; }
        const l = Math.hypot(p.tx - p.x, p.tz - p.z);
        if (l > 1) { dx = (p.tx - p.x) / l; dz = (p.tz - p.z) / l; speed = 0.6; }
      } else if (act === 'idle' || act === 'sit') {
        if (p.timer <= 0) { p.timer = 6 + Math.random() * 14; if (act === 'idle' && Math.random() < 0.35 && p.leader === p) { p.activity = 'walk'; this.pickWaypoint(p); } }
        // 일행끼리 마주보기
        const g = this.groups[p.group];
        if (g && g.length > 1) { let cx = 0, cz = 0; for (const o of g) { cx += o.x; cz += o.z; } cx /= g.length; cz /= g.length; if (Math.hypot(cx - p.x, cz - p.z) > 0.3) p.faceYaw = Math.atan2(cx - p.x, cz - p.z); }
      }
      // 일행 따라가기
      const lead = p.leader;
      if (lead && lead !== p && lead.state === 'normal' && p.activity !== 'swim' && p.activity !== 'gawk') {
        const ox = lead.x - p.x, oz = lead.z - p.z, ol = Math.hypot(ox, oz);
        if (ol > 2.2) { dx = ox / ol; dz = oz / ol; speed = Math.min(p.run * 0.6, lead.anim.spd + (ol - 2) * 0.5); }
        else if (lead.anim.spd < 0.2) speed = 0;
        else { dx = lead.vx; dz = lead.vz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; speed = lead.anim.spd; }
      }
      // 지진: 웅크림
      if (env.quake > 0.25 && p.composure < 0.75 && p.activity !== 'swim') speed = 0;
    }

    // 수심에 따른 감속 · 경사
    if (depth > 0.05 && !swimmer) speed *= Math.max(0.12, 1 - depth / (0.7 * p.height));
    // 분리 (서로 밀기)
    let sx = 0, sz = 0;
    this.forNear(p.x, p.z, (o) => {
      if (o === p || o.state === 'swept') return;
      const ex = p.x - o.x, ez = p.z - o.z, d2 = ex * ex + ez * ez;
      if (d2 > 0.5 || d2 < 1e-6) return;
      const d = Math.sqrt(d2);
      sx += ex / d * (0.71 - d) * 3; sz += ez / d * (0.71 - d) * 3;
    });
    if (env.player && env.player.active) {
      const ex = p.x - env.player.x, ez = p.z - env.player.z, d = Math.hypot(ex, ez);
      if (d < 0.8 && d > 1e-3) { sx += ex / d * (0.8 - d) * 4; sz += ez / d * (0.8 - d) * 4; }
    }
    // 갇힘 감지 → 일정 시간 벽을 따라 우회
    if (p.state === 'evac') {
      p.stuckT = (p.stuckT || 0) + dt;
      if (p.stuckT > 2.5) {
        if (speed > 0.5 && Math.hypot(p.x - (p.sx0 ?? p.x + 9), p.z - (p.sz0 ?? 0)) < 1.0) { p.detourT = 1.5 + Math.random() * 2.5; p.detourSign = Math.random() < 0.5 ? -1 : 1; }
        p.stuckT = 0; p.sx0 = p.x; p.sz0 = p.z;
      }
      if (p.detourT > 0) {
        p.detourT -= dt;
        const a = p.detourSign * 1.35, c = Math.cos(a), s2 = Math.sin(a);
        const ndx = dx * c - dz * s2; dz = dx * s2 + dz * c; dx = ndx;
      }
    }
    const tvx = dx * speed + sx, tvz = dz * speed + sz;
    const acc = (p.state === 'evac' ? 5 : 3) * dt;
    let ddx = tvx - p.vx, ddz = tvz - p.vz;
    const dl = Math.hypot(ddx, ddz);
    if (dl > acc) { ddx *= acc / dl; ddz *= acc / dl; }
    p.vx += ddx; p.vz += ddz;
    // 물에 의한 밀림
    if (depth > 0.05 && !swimmer) {
      const k = Math.min(1, depth / (0.6 * p.height)) * 1.4 * dt;
      p.vx += (wu - p.vx) * k * 0.5; p.vz += (wv - p.vz) * k * 0.5;
    }
    const ox = p.x, oz = p.z;
    let nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
    const pos = { x: nx, z: nz };
    city.collide(pos, 0.32, ground);
    // 벽 방향 속도 성분 제거 (벽을 따라 미끄러짐)
    const px = pos.x - nx, pz = pos.z - nz, pl = Math.hypot(px, pz);
    if (pl > 1e-6) { const vn = (p.vx * px + p.vz * pz) / pl; if (vn < 0) { p.vx -= vn * px / pl; p.vz -= vn * pz / pl; } }
    nx = pos.x; nz = pos.z;
    if (!swimmer && !nav.isWalkable(nx, nz) && nav.isWalkable(ox, oz)) {
      if (nav.isWalkable(nx, oz)) { nz = oz; p.vz = 0; }
      else if (nav.isWalkable(ox, nz)) { nx = ox; p.vx = 0; }
      else { nx = ox; nz = oz; p.vx *= -0.2; p.vz *= -0.2; if (p.state === 'normal') this.pickWaypoint(p); }
    }
    p.x = nx; p.z = nz;
    if (p.x < -HALF + 5 || p.x > HALF - 5 || p.z < -HALF + 5 || p.z > HALF - 5) { p.x = ox; p.z = oz; }
    p.y = swimmer ? Math.max(terrain.groundAt(p.x, p.z), tmpS.eta - p.height * 0.82) : terrain.groundAt(p.x, p.z);
    // 체력
    const spd = Math.hypot(p.vx, p.vz);
    if (spd > p.walk * 1.6) p.stamina = Math.max(0, p.stamina - dt * 0.006 * spd / p.fitness);
    else p.stamina = Math.min(1, p.stamina + dt * 0.02);
    A.spd = spd;
    // 방향
    let ty = p.yaw;
    if (spd > 0.25) ty = Math.atan2(p.vx, p.vz);
    else if (p.faceYaw !== undefined && p.state === 'normal') ty = p.faceYaw;
    else if (p.state === 'safe' || p.activity === 'gawk' || (p.activity === 'sit' && p.state === 'normal')) ty = Math.atan2(p.threatDir[0], p.threatDir[1]);
    p.yaw += angDiff(p.yaw, ty) * Math.min(1, dt * 6);
  }

  moveSwept(p, dt, depth, wu, wv, wsp, eta, ground) {
    const { terrain, city, nav } = this.ctx;
    p.waterT += dt;
    // 흐름에 실려감 + 약한 헤엄
    nav.direction(nav.hill, p.x, p.z, tmpDir);
    if (tmpDir.x === 0 && tmpDir.z === 0) landward(p.x, tmpDir);
    const swim = 0.45 * p.fitness * (p.type === 'child' ? 0.5 : 1);
    p.vx += (wu + tmpDir.x * swim - p.vx) * Math.min(1, dt * 2.2);
    p.vz += (wv + tmpDir.z * swim - p.vz) * Math.min(1, dt * 2.2);
    p.x += p.vx * dt; p.z += p.vz * dt;
    if (p.x < -HALF + 5 || p.x > HALF - 5 || p.z < -HALF + 5 || p.z > HALF - 5) { p.x = Math.max(-HALF + 5, Math.min(HALF - 5, p.x)); p.z = Math.max(-HALF + 5, Math.min(HALF - 5, p.z)); }
    const pos = { x: p.x, z: p.z };
    const hit = city.collide(pos, 0.4, eta - 0.5);
    p.x = pos.x; p.z = pos.z;
    const g = terrain.groundAt(p.x, p.z);
    p.y = Math.max(g, eta - p.height * 0.18);
    p.anim.spd = Math.hypot(p.vx, p.vz);
    p.anim.tumble += dt * (1 + wsp * 0.6);
    if (wsp > 0.2) p.yaw += angDiff(p.yaw, Math.atan2(wu, wv)) * Math.min(1, dt);
    // 건물에 매달려 지붕으로
    if (hit && hit.alive) {
      const climb = hit.top - eta;
      if (climb < 3.2 && climb > -0.5 && Math.random() < dt * 0.9) { this.toRoof(p, hit); return; }
      if (hit.evac && Math.random() < dt * 0.25) { this.enterBuilding(p, hit, true); return; }
    }
    // 발이 닿고 물살이 약해지면 탈출
    if ((depth < p.height * 0.35 && depth * wsp < p.dvCrit * 0.7) || depth < 0.08) {
      p.state = 'evac'; p.activity = 'evac'; p.field = p.field || 'hill'; p.recoverT = 4;
      p.anim.fall = 1; p.fallT = 1.5;
      this.say(p, ['살았다...', '콜록콜록...', '빨리 높은 곳으로...']);
      return;
    }
    if (p.waterT > 160 && depth > 0.4) {
      p.state = 'missing';
      this.say(p, ['...']);
    }
  }

  toSwept(p, x, z) {
    if (x !== undefined) { p.x = x; p.z = z; }
    if (p.escort) { p.escort.escortedBy = null; p.escort = null; }
    if (p.escortedBy) { p.escortedBy.escort = null; p.escortedBy = null; }
    p.state = 'swept'; p.activity = 'swept'; p.waterT = 0; p.building = null;
    p.fear = Math.max(p.fear, 0.9);
    this.say(p, LINES.swept);
    // 일행의 슬픔
    const g = this.groups[p.group];
    if (g) for (const o of g) if (o !== p) {
      o.lostFamily = true;
      if (o.state === 'normal') { o.awareness = Math.max(o.awareness, 1.5); o.decideT = this.env ? this.env.simTime + 0.8 : 0; }
    }
  }

  toSafe(p) {
    p.state = 'safe'; p.activity = 'safe'; p.safeT = 0; p.timer = 2;
    if (p.escort) { p.escort.escortedBy = null; p.escort = null; }
    this.say(p, LINES.relief);
  }

  toRoof(p, b) {
    p.state = 'roof'; p.building = b; p.safeT = 0;
    p.x = Math.max(b.x - b.w / 2 + 1, Math.min(b.x + b.w / 2 - 1, p.x));
    p.z = Math.max(b.z - b.d / 2 + 1, Math.min(b.z + b.d / 2 - 1, p.z));
    p.y = b.top;
    this.say(p, LINES.roof);
  }

  enterBuilding(p, b, rescued) {
    p.state = 'inside'; p.building = b; p.inT = (rescued ? 4 : 2) + b.floors * (p.type === 'elder' ? 9 : 4.5) / Math.max(0.4, p.fitness);
    if (p.escort) { p.escort.escortedBy = null; p.escort = null; }
  }

  pickWaypoint(p) {
    const { nav } = this.ctx;
    const r = Math.random;
    p.timer = 15 + r() * 25;
    for (let t = 0; t < 8; t++) {
      let tx, tz;
      if (p.activity === 'jog' || p.activity === 'stroll') {
        const dir = r() < 0.5 ? -1 : 1;
        tx = p.x + dir * (40 + r() * 80);
        tz = p.homeZone === 'beach' ? coastZ(tx) - (10 + r() * 45) : coastZ(tx) - (75 + r() * 20);
      } else {
        const a = Math.floor(r() * 4) * Math.PI / 2 + (r() - 0.5) * 0.3, d = 25 + r() * 70;
        tx = p.x + Math.sin(a) * d; tz = p.z + Math.cos(a) * d;
      }
      if (Math.abs(tx) > HALF - 40 || Math.abs(tz) > HALF - 40) continue;
      if (p.homeZone === 'beach' && (p.activity === 'stroll')) { const g = this.ctx.terrain.groundAt(tx, tz); if (g > 0.3 && g < 3.5) { p.tx = tx; p.tz = tz; return; } continue; }
      if (!nav.isWalkable(tx, tz)) continue;
      const mx = (p.x + tx) / 2, mz = (p.z + tz) / 2;
      if (!nav.isWalkable(mx, mz)) continue;
      p.tx = tx; p.tz = tz; return;
    }
    p.tx = p.x; p.tz = p.z;
  }

  say(p, lines) {
    p.thought = lines[Math.floor(Math.random() * lines.length)];
    p.thoughtT = 5 + Math.random() * 3;
  }

  mood(p, dt, env) {
    // 공포 목표치
    let ft = 0.02;
    if (env.quake > 0.05) ft = Math.max(ft, Math.min(0.75, env.quake * 0.8));
    if (env.quakeAfter) ft = Math.max(ft, 0.12 + p.bias * -0.05 + (1 - p.composure) * 0.15);
    if (p.heardSiren) ft = Math.max(ft, 0.3);
    if (p.gotAlert) ft = Math.max(ft, 0.28);
    if (p.state === 'evac') ft = Math.max(ft, 0.35);
    if (p.threat > 0.5) ft = Math.max(ft, Math.min(1, 0.5 + p.threat * 0.12));
    if (p.depth > 0.1) ft = Math.max(ft, Math.min(1, 0.6 + p.depth));
    if (p.state === 'swept') ft = 1;
    ft = Math.max(ft, (p.nFear || 0) * 0.85);
    if (p.state === 'safe' || p.state === 'roof') ft = Math.min(ft, p.state === 'roof' && p.depth > 0.2 ? 0.9 : p.threat > 1 ? 0.45 : 0.18);
    ft *= 1.2 - p.composure * 0.45;
    if (p.type === 'child' && p.leader && p.leader !== p && (p.leader.state === 'swept' || Math.hypot(p.leader.x - p.x, p.leader.z - p.z) > 40) && p.state !== 'normal') ft = Math.max(ft, 0.9);
    ft = Math.min(1, ft);
    p.fear += (ft - p.fear) * Math.min(1, dt * (ft > p.fear ? 2.2 : 0.12));
    // 감정 판정
    let e;
    const fe = p.fear;
    if (p.state === 'swept') e = 'struggle';
    else if (p.frozenT > 0) e = 'frozen';
    else if (p.state === 'safe' || p.state === 'roof' || p.state === 'inside') {
      if (p.state === 'roof' && p.depth > 0.2) e = 'fear';
      else if ((p.lostFamily || (p.safeT > 30 && env.collapses > 3 && p.composure > 0.5)) && p.safeT > 8) e = 'sad';
      else if (p.safeT < 40) e = 'relief';
      else e = fe > 0.35 ? 'anxious' : 'relief';
    } else if (p.escort) e = 'determined';
    else if (p.activity === 'gawk' && fe < 0.45) e = 'curious';
    else if (fe < 0.12) e = 'calm';
    else if (fe < 0.28) e = 'confused';
    else if (fe < 0.5) e = 'anxious';
    else if (fe < 0.78) e = 'fear';
    else e = 'panic';
    if (e !== p.emotion) {
      p.emotion = e;
      if (p.thoughtT <= 0 || Math.random() < 0.6) {
        const key = e === 'struggle' ? 'swept' : e === 'determined' ? 'helper' : e === 'confused' ? (env.quakeRecent ? 'quake' : 'confused') : e;
        let lines = LINES[key] || LINES.calm;
        if (p.type === 'child' && (e === 'fear' || e === 'panic')) lines = LINES.child;
        if (p.type === 'elder' && p.state === 'evac' && Math.random() < 0.5) lines = LINES.elder;
        if (p.state === 'roof' && p.depth < 0.2 && e !== 'sad' && Math.random() < 0.5) lines = LINES.roof;
        this.say(p, lines);
      }
    }
    p.thoughtT -= dt;
    if (p.thoughtT <= -8 - Math.random() * 10) {
      const key = p.emotion === 'struggle' ? 'swept' : p.emotion === 'determined' ? 'helper' : p.emotion;
      this.say(p, LINES[key] || LINES.calm);
    }
    // 심박
    const exert = Math.min(1, p.anim.spd / 5);
    const hr = p.restHeart + fe * 85 + exert * 35 + (p.type === 'elder' ? -5 : 0);
    p.heart += (hr - p.heart) * Math.min(1, dt * 0.8);
  }

  /* ───────────────────────── 애니메이션 · 렌더 ───────────────────────── */
  render(dt, camPos, showMarkers, selected, hideId = -1) {
    const A = this.mesh.instanceMatrix.array, H = this.heads.instanceMatrix.array, HR = this.hair.instanceMatrix.array, HT = this.hats.instanceMatrix.array;
    const pos = this.markers.geometry.attributes.position.array, col = this.markers.geometry.attributes.color.array;
    const camFar = camPos.y > 500;
    for (const p of this.list) {
      const i = p.i;
      const c = this.emoColors[p.emotion] || this.emoColors.calm;
      const hidden = p.state === 'missing' || p.state === 'inside' || i === hideId;
      pos[i * 3] = p.x; pos[i * 3 + 1] = hidden ? 1e7 : p.y + p.height + 2; pos[i * 3 + 2] = p.z;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      const d2 = (p.x - camPos.x) ** 2 + (p.z - camPos.z) ** 2;
      if (i === hideId && p.state !== 'missing') this.animate(p, dt);   // 관찰 시점 대상: 보이지 않아도 자세 상태는 갱신
      if (hidden || (camFar && d2 > 1.2e6) || d2 > 9e6) {
        for (let k = 0; k < PARTS; k++) zero(A, (i * PARTS + k) * 16);
        zero(H, i * 16); zero(HR, i * 16); zero(HT, i * 16);
        continue;
      }
      this.animate(p, dt);
      this.pose(p, A, H, HR, HT);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = this.hair.instanceMatrix.needsUpdate = this.hats.instanceMatrix.needsUpdate = true;
    this.markers.geometry.attributes.position.needsUpdate = true;
    this.markers.geometry.attributes.color.needsUpdate = true;
    this.markers.visible = showMarkers;
    if (selected && selected.state !== 'missing') {
      this.ring.visible = true;
      this.ring.position.set(selected.x, selected.y + 0.08, selected.z);
      const s = showMarkers ? Math.max(1, camPos.distanceTo(this.ring.position) / 60) : 1;
      this.ring.scale.setScalar(s);
    } else this.ring.visible = false;
  }

  animate(p, dt) {
    const A = p.anim, k = Math.min(1, dt * 5);
    const swept = p.state === 'swept';
    const crouch = (this.env && this.env.quake > 0.25 && p.state === 'normal' && p.composure < 0.75 && p.activity !== 'swim') ? 1 : 0;
    A.crouch += (crouch - A.crouch) * k;
    A.fall += ((p.fallT > 0 ? 1 : 0) - A.fall) * Math.min(1, dt * 7);
    A.swim += (((swept || p.activity === 'swim') ? 1 : 0) - A.swim) * k;
    A.arms += (((p.fear > 0.78 && p.state === 'evac') || swept || p.frozenT > 0 ? 1 : 0) - A.arms) * k;
    A.wave += ((p.state === 'roof' && (p.depth > 0.05 || p.emotion !== 'relief' || (p.i % 3 === 0)) ? 1 : 0) - A.wave) * k;
    A.phone += (((p.activity === 'gawk' && p.fear < 0.45) || (p.state === 'safe' && p.curiosity > 0.75 && p.safeT > 15) ? 1 : 0) - A.phone) * k;
    A.sit += ((p.activity === 'sit' && p.state === 'normal' && A.spd < 0.3 ? 1 : 0) - A.sit) * k;
    A.cry += ((p.emotion === 'sad' && p.composure < 0.6 ? 1 : 0) - A.cry) * k;
    A.chat += ((p.state === 'normal' && p.activity === 'idle' && A.spd < 0.2 ? 1 : 0) - A.chat) * k;
    // 위협 방향 돌아보기
    let look = 0;
    if (p.state === 'evac' && p.threat > 0.5 && A.spd > 1) {
      const ty = Math.atan2(p.threatDir[0], p.threatDir[1]);
      const d = angDiff(p.yaw, ty);
      if (Math.abs(d) > 1.6 && Math.sin(this.env.simTime * 0.9 + p.i) > 0.6) look = Math.max(-1.3, Math.min(1.3, d));
    }
    A.head += (look - A.head) * k;
    const stride = p.height * (A.spd > 2.2 ? 1.25 : 0.78);
    p.phase += (A.spd / Math.max(stride, 0.3)) * Math.PI * dt;
    if (swept || A.swim > 0.5) p.phase += dt * 4;
  }

  pose(p, A, H, HR, HT) {
    const an = p.anim, Hh = p.height, ap = p.ap;
    const child = p.type === 'child';
    const thigh = 0.245 * Hh, shin = 0.235 * Hh, torso = 0.29 * Hh;
    const headR = (child ? 0.078 : 0.063) * Hh;
    const shW = ap.shoulders * Hh, hipW = 0.05 * Hh;
    const uArm = 0.165 * Hh, fArm = 0.16 * Hh;
    const run = clamp01((an.spd - 1.8) / 2), walk = clamp01(an.spd / 1.2);
    const ph = p.phase;
    // 몸통 기울기 · 자세
    let lean = 0.05 + run * 0.22 + (p.type === 'elder' ? 0.28 : 0) - an.sit * 0.05;
    let tilt = lean + an.fall * (Math.PI / 2 - lean);
    let roll = 0;
    if (an.swim > 0.01) {
      const sw = p.state === 'swept' ? 1.25 + Math.sin(an.tumble * 0.7 + p.i) * 0.35 : 1.35;
      tilt = tilt * (1 - an.swim) + sw * an.swim;
      if (p.state === 'swept') roll = Math.sin(an.tumble * 0.45 + p.i * 1.3) * 1.6 * an.swim;
    }
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const f0x = sy, f0z = cy, r0x = -cy, r0z = sy;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const Ux = f0x * st, Uy = ct, Uz = f0z * st;
    let Fx = f0x * ct, Fy = -st, Fz = f0z * ct;
    const cr = Math.cos(roll), sr = Math.sin(roll);
    Fx = Fx * cr + r0x * sr; Fy = Fy * cr; Fz = Fz * cr + r0z * sr;
    // R = F × U
    const Rx = Fy * Uz - Fz * Uy, Ry = Fz * Ux - Fx * Uz, Rz = Fx * Uy - Fy * Ux;
    // 다리 각도
    const amp = 0.42 * walk + run * 0.38;
    let hipL = amp * Math.sin(ph), hipR = amp * Math.sin(ph + Math.PI);
    let kneeL = 0.08 + (0.35 * walk + run * 1.1) * Math.max(0, Math.sin(ph + 1.9)), kneeR = 0.08 + (0.35 * walk + run * 1.1) * Math.max(0, Math.sin(ph + Math.PI + 1.9));
    // 웅크림 / 앉기
    const cr2 = Math.max(an.crouch, an.sit);
    hipL = hipL * (1 - cr2) + (an.sit > an.crouch ? 1.5 : 1.25) * cr2; hipR = hipR * (1 - cr2) + (an.sit > an.crouch ? 1.45 : 1.25) * cr2;
    kneeL = kneeL * (1 - cr2) + (an.sit > an.crouch ? 0.25 : 2.1) * cr2; kneeR = kneeR * (1 - cr2) + (an.sit > an.crouch ? 0.35 : 2.1) * cr2;
    if (an.swim > 0.01) {
      const kick = Math.sin(ph * 1.6) * 0.45;
      hipL = hipL * (1 - an.swim) + kick * an.swim; hipR = hipR * (1 - an.swim) - kick * an.swim;
      kneeL = kneeL * (1 - an.swim) + 0.3 * an.swim; kneeR = kneeR * (1 - an.swim) + 0.3 * an.swim;
    }
    const legDir = (a) => [-Ux * Math.cos(a) + Fx * Math.sin(a), -Uy * Math.cos(a) + Fy * Math.sin(a), -Uz * Math.cos(a) + Fz * Math.sin(a)];
    const tL = legDir(hipL), sL = legDir(hipL - kneeL), tR = legDir(hipR), sR = legDir(hipR - kneeR);
    // 골반 위치: 낮은 발이 지면에 닿도록
    let px = p.x, pz = p.z, py;
    const extL = -(tL[1] * thigh + sL[1] * shin), extR = -(tR[1] * thigh + sR[1] * shin);
    const standY = p.y + Math.max(extL, extR, 0.15 * Hh) + 0.02 * Hh;
    const lieY = p.y + 0.11 * Hh;
    py = standY * (1 - an.fall) + lieY * an.fall;
    if (an.sit > 0.01) py = py * (1 - an.sit) + (p.y + 0.12 * Hh) * an.sit;
    if (an.swim > 0.01) py = py * (1 - an.swim) + (p.y + 0.06 * Hh) * an.swim;
    if (an.fall > 0.01) { px -= Fx * 0 + Ux * 0.45 * Hh * an.fall * 0; }
    const pel = [px, py, pz];
    const hipLp = [px - Rx * hipW, py - Ry * hipW, pz - Rz * hipW], hipRp = [px + Rx * hipW, py + Ry * hipW, pz + Rz * hipW];
    const kL = add(hipLp, tL, thigh), fL = add(kL, sL, shin), kR = add(hipRp, tR, thigh), fR = add(kR, sR, shin);
    const chest = [px + Ux * torso, py + Uy * torso, pz + Uz * torso];
    const b = p.i * PARTS;
    const W = ap.girth;
    setPart(A, b + 0, [px + Ux * 0.04 * Hh, py + Uy * 0.04 * Hh, pz + Uz * 0.04 * Hh], chest, shW * 0.78 * W, shW * 0.5 * W, Fx, Fy, Fz);
    setPart(A, b + 1, [px - Ux * 0.04 * Hh, py - Uy * 0.04 * Hh, pz - Uz * 0.04 * Hh], [px + Ux * 0.07 * Hh, py + Uy * 0.07 * Hh, pz + Uz * 0.07 * Hh], hipW * (ap.shorts === 2 ? 2.3 : 1.75) * W, hipW * 1.2 * W, Fx, Fy, Fz);
    setPart(A, b + 6, hipLp, kL, 0.058 * Hh * W, 0.058 * Hh * W, Fx, Fy, Fz);
    setPart(A, b + 7, kL, fL, 0.044 * Hh, 0.044 * Hh, Fx, Fy, Fz);
    setPart(A, b + 8, hipRp, kR, 0.058 * Hh * W, 0.058 * Hh * W, Fx, Fy, Fz);
    setPart(A, b + 9, kR, fR, 0.044 * Hh, 0.044 * Hh, Fx, Fy, Fz);
    // 팔
    const t = this.env ? this.env.simTime : 0;
    const armSwing = (0.5 * walk + run * 0.5) * 0.9;
    let sL2 = -armSwing * Math.sin(ph) * 0.9, sR2 = -armSwing * Math.sin(ph + Math.PI) * 0.9;
    let eL = 0.15 + run * 1.3, eR = eL, abL = 0.08, abR = 0.08;
    const blend = (cur, target, w) => cur * (1 - w) + target * w;
    if (an.chat > 0.01) { const g = Math.sin(t * 2.3 + p.i) > 0.3 ? 1 : 0; sR2 = blend(sR2, 0.5 + 0.3 * Math.sin(t * 3 + p.i) * g, an.chat); eR = blend(eR, 1.3, an.chat * g); }
    if (an.phone > 0.01) { sR2 = blend(sR2, 1.35, an.phone); eR = blend(eR, 0.55, an.phone); abR = blend(abR, -0.25, an.phone); }
    if (an.arms > 0.01) {
      const fl = Math.sin(t * 9 + p.i) * 0.5;
      sL2 = blend(sL2, 2.7 + fl, an.arms); sR2 = blend(sR2, 2.7 - fl, an.arms);
      eL = blend(eL, 0.4, an.arms); eR = blend(eR, 0.4, an.arms); abL = blend(abL, 0.35, an.arms); abR = blend(abR, 0.35, an.arms);
    }
    if (an.crouch > 0.01) { sL2 = blend(sL2, 2.4, an.crouch); sR2 = blend(sR2, 2.4, an.crouch); eL = blend(eL, 2.2, an.crouch); eR = blend(eR, 2.2, an.crouch); abL = blend(abL, 0.6, an.crouch); abR = blend(abR, 0.6, an.crouch); }
    if (p.frozenT > 0) { sL2 = 2.0; sR2 = 2.0; eL = eR = 2.4; abL = abR = 0.7; }
    if (an.wave > 0.01) { sR2 = blend(sR2, 2.9, an.wave); eR = blend(eR, 0.3, an.wave); abR = blend(abR, 0.25 + 0.35 * Math.sin(t * 7 + p.i), an.wave); }
    if (an.cry > 0.01) { sL2 = blend(sL2, 1.2, an.cry); sR2 = blend(sR2, 1.2, an.cry); eL = blend(eL, 2.5, an.cry); eR = blend(eR, 2.5, an.cry); abL = blend(abL, -0.2, an.cry); abR = blend(abR, -0.2, an.cry); }
    if (an.swim > 0.01 && p.state !== 'swept') { const st2 = t * 2.4 + p.i; sL2 = blend(sL2, 1.6 + Math.sin(st2) * 1.4, an.swim); sR2 = blend(sR2, 1.6 + Math.sin(st2 + Math.PI) * 1.4, an.swim); }
    if (p.escort) { const e = p.escort; const ex = e.x - p.x, ez = e.z - p.z; const side = ex * Rx + ez * Rz; if (side > 0) { sR2 = 0.55; eR = 0.2; abR = 0.5; } else { sL2 = 0.55; eL = 0.2; abL = 0.5; } }
    const shY = -0.025 * Hh;
    const shL = [chest[0] - Rx * shW + Ux * shY, chest[1] - Ry * shW + Uy * shY, chest[2] - Rz * shW + Uz * shY];
    const shR = [chest[0] + Rx * shW + Ux * shY, chest[1] + Ry * shW + Uy * shY, chest[2] + Rz * shW + Uz * shY];
    const armDir = (s, ab, side) => {
      const ca = Math.cos(s), sa = Math.sin(s), cb = Math.cos(ab), sb = Math.sin(ab);
      const dx = (-Ux * ca + Fx * sa) * cb + Rx * side * sb, dy = (-Uy * ca + Fy * sa) * cb + Ry * side * sb, dz = (-Uz * ca + Fz * sa) * cb + Rz * side * sb;
      return [dx, dy, dz];
    };
    const uL = armDir(sL2, abL, -1), lL = armDir(sL2 + eL, abL * 0.5, -1), uR = armDir(sR2, abR, 1), lR = armDir(sR2 + eR, abR * 0.5, 1);
    const elL = add(shL, uL, uArm), haL = add(elL, lL, fArm), elR = add(shR, uR, uArm), haR = add(elR, lR, fArm);
    setPart(A, b + 2, shL, elL, 0.037 * Hh * W, 0.037 * Hh * W, Fx, Fy, Fz);
    setPart(A, b + 3, elL, haL, 0.031 * Hh, 0.031 * Hh, Fx, Fy, Fz);
    setPart(A, b + 4, shR, elR, 0.037 * Hh * W, 0.037 * Hh * W, Fx, Fy, Fz);
    setPart(A, b + 5, elR, haR, 0.031 * Hh, 0.031 * Hh, Fx, Fy, Fz);
    // 지팡이 (노인, 서 있을 때)
    if (p.type === 'elder' && an.fall < 0.5 && an.swim < 0.5 && an.arms < 0.5 && p.i % 2 === 0) {
      setPart(A, b + 10, haR, [haR[0] + Fx * 0.08, p.y, haR[2] + Fz * 0.08], 0.012 * Hh, 0.012 * Hh, Fx, Fy, Fz);
    } else zero(A, (b + 10) * 16);
    // 머리
    const neck = 0.04 * Hh;
    const cry = an.cry * 0.5;
    const hu = [Ux * Math.cos(cry) + Fx * Math.sin(cry), Uy * Math.cos(cry) + Fy * Math.sin(cry), Uz * Math.cos(cry) + Fz * Math.sin(cry)];
    const hc = [chest[0] + Ux * neck + hu[0] * headR * 1.05, chest[1] + Uy * neck + hu[1] * headR * 1.05, chest[2] + Uz * neck + hu[2] * headR * 1.05];
    writeMat(H, p.i * 16, hc[0], hc[1], hc[2], headR * 0.92, headR * 1.05, headR);
    // 고개 방향 (머리카락 오프셋이 시선을 보여줌)
    const hy = p.yaw + an.head;
    const fhx = Math.sin(hy), fhz = Math.cos(hy);
    if (ap.hairStyle === 2) zero(HR, p.i * 16);
    else if (ap.hairStyle === 1) writeMat(HR, p.i * 16, hc[0] - fhx * headR * 0.22, hc[1] - headR * 0.18, hc[2] - fhz * headR * 0.22, headR * 1.02, headR * 1.3, headR * 1.02);
    else if (ap.hairStyle === 3) writeMat(HR, p.i * 16, hc[0] - fhx * headR * 0.3, hc[1] + headR * 0.15, hc[2] - fhz * headR * 0.3, headR * 0.98, headR * 0.98, headR * 0.98);
    else writeMat(HR, p.i * 16, hc[0] - fhx * headR * 0.16, hc[1] + headR * 0.16, hc[2] - fhz * headR * 0.16, headR * 0.98, headR * 0.86, headR * 0.98);
    if (ap.hat && an.swim < 0.5) {
      const hs = ap.hat === 2 ? 1.9 : ap.hat === 3 ? 1.08 : 1.02;
      const hh = ap.hat === 2 ? 0.25 : ap.hat === 3 ? 0.6 : 0.5;
      writeMat(HT, p.i * 16, hc[0] + Ux * headR * 0.7, hc[1] + Uy * headR * 0.7, hc[2] + Uz * headR * 0.7, headR * hs, headR * hh, headR * hs);
    } else zero(HT, p.i * 16);
  }

  headPos(p, out) {
    if (p.state === 'swept') return out.set(p.x, p.y + p.height * 0.12, p.z);
    const base = p.anim.sit > 0.5 ? 0.55 : p.anim.crouch > 0.5 ? 0.55 : p.anim.fall > 0.5 ? 0.15 : 0.93;
    return out.set(p.x, p.y + p.height * base, p.z);
  }

  /** 화면 좌표에서 가장 가까운 사람 */
  pick(camera, sx, sy, w, h, maxPx = 22) {
    let best = null, bd = maxPx * maxPx;
    for (const p of this.list) {
      if (p.state === 'missing' || p.state === 'inside') continue;
      _v.set(p.x, p.y + p.height * 0.6, p.z).project(camera);
      if (_v.z > 1) continue;
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  stats(nDistricts) {
    const S = Array.from({ length: nDistricts }, () => ({ pop: 0, normal: 0, evac: 0, safe: 0, swept: 0, missing: 0 }));
    const emo = {};
    let tot = { pop: 0, normal: 0, evac: 0, safe: 0, swept: 0, missing: 0 };
    for (const p of this.list) {
      const s = S[p.district] || S[0];
      const k = p.state === 'roof' || p.state === 'inside' || p.state === 'safe' ? 'safe' : p.state;
      s.pop++; tot.pop++;
      s[k] = (s[k] || 0) + 1; tot[k] = (tot[k] || 0) + 1;
      if (p.state !== 'missing') emo[p.emotion] = (emo[p.emotion] || 0) + 1;
    }
    return { districts: S, total: tot, emo };
  }
}

/** 해안선 기준 육지 쪽 단위벡터 */
function landward(x, out) {
  const s = coastSlope(x), l = Math.hypot(s, 1);
  out.x = s / l; out.z = -1 / l;
  return out;
}

function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function add(a, d, l) { return [a[0] + d[0] * l, a[1] + d[1] * l, a[2] + d[2] * l]; }
function zero(arr, o) { for (let i = 0; i < 16; i++) arr[o + i] = 0; }
function writeMat(arr, o, x, y, z, sx, sy, sz) {
  arr[o] = sx; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
  arr[o + 4] = 0; arr[o + 5] = sy; arr[o + 6] = 0; arr[o + 7] = 0;
  arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = sz; arr[o + 11] = 0;
  arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
}
/** 캡슐 부위: A→B 축, 반지름 rx(좌우)·rz(앞뒤), 앞방향 F 기준 */
function setPart(arr, idx, a, b, rx, rz, fx, fy, fz) {
  let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const len = Math.hypot(ux, uy, uz) || 1e-4;
  ux /= len; uy /= len; uz /= len;
  let d = fx * ux + fy * uy + fz * uz;
  let Fx = fx - ux * d, Fy = fy - uy * d, Fz = fz - uz * d;
  let fl = Math.hypot(Fx, Fy, Fz);
  if (fl < 1e-3) { Fx = 0; Fy = 0; Fz = 1; d = uz; Fx -= ux * d; Fy -= uy * d; Fz -= uz * d; fl = Math.hypot(Fx, Fy, Fz) || 1; }
  Fx /= fl; Fy /= fl; Fz /= fl;
  const Rx = uy * Fz - uz * Fy, Ry = uz * Fx - ux * Fz, Rz = ux * Fy - uy * Fx;
  const sx = rx * 2, sy = len / 2, sz = rz * 2;
  const o = idx * 16;
  arr[o] = Rx * sx; arr[o + 1] = Ry * sx; arr[o + 2] = Rz * sx; arr[o + 3] = 0;
  arr[o + 4] = ux * sy; arr[o + 5] = uy * sy; arr[o + 6] = uz * sy; arr[o + 7] = 0;
  arr[o + 8] = Fx * sz; arr[o + 9] = Fy * sz; arr[o + 10] = Fz * sz; arr[o + 11] = 0;
  arr[o + 12] = (a[0] + b[0]) / 2; arr[o + 13] = (a[1] + b[1]) / 2; arr[o + 14] = (a[2] + b[2]) / 2; arr[o + 15] = 1;
}
