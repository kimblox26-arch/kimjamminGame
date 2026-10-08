// 해랑시 쓰나미 — 게임 루프 · 모드(지도/사람/관찰) · 사건(지진·경보·도달) · 렌더 파이프라인
import * as THREE from 'three';
import { Sky } from '../../src/world/sky.js';
import { WORLD, HALF, QUALITY, DISTRICTS, SOURCE_TYPES, SAFE_ELEV } from './config.js';
import { coastSlope, inlandDist, districtAt, SIRENS, BUOYS } from './geo.js';
import { Terrain } from './terrain.js';
import { ShallowWater } from './swe.js';
import { WaterSurface } from './water.js';
import { City } from './city.js';
import { NavGrid } from './nav.js';
import { Bodies } from './bodies.js';
import { People } from './people.js';
import { Player } from './player.js';
import { Input, MapCamera } from './controls.js';
import { Effects } from './fx.js';
import { SoundEngine } from './audio.js';
import { UI } from './ui.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const tick = () => new Promise((r) => requestAnimationFrame(() => r()));

function pickQuality() {
  let key = null;
  try { key = localStorage.getItem('tsunami.quality'); } catch (e) { /* 저장소 없음 */ }
  const url = new URLSearchParams(location.search).get('q');
  if (url && QUALITY[url]) key = url;
  if (!key || !QUALITY[key]) {
    const mobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
    key = mobile ? 'low' : 'medium';
  }
  return key;
}

class Game {
  async init() {
    this.qKey = pickQuality();
    this.q = { ...QUALITY[this.qKey], key: this.qKey };
    const bar = document.getElementById('load-bar'), txt = document.getElementById('load-text');
    const step = async (pct, msg) => { bar.style.width = pct + '%'; txt.textContent = msg; await tick(); };

    await step(4, '렌더러 준비');
    const canvas = document.getElementById('gl');
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.qKey !== 'low', powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, this.q.pr));
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = this.q.shadow > 0;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1, 40000);
    this.scene.fog = new THREE.FogExp2(0x9ec4e8, 0.0001);

    this.sky = new Sky(this.scene);
    this.sky.mesh.scale.setScalar(30000);
    // 하늘 셰이더는 후처리(OutputPass)용 선형 출력 → 직접 렌더할 때 톤매핑·sRGB 변환 추가
    const sfs = this.sky.material.fragmentShader, si = sfs.lastIndexOf('}');
    this.sky.material.fragmentShader = sfs.slice(0, si) + '#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}';
    if (this.q.shadow) this.sky.sunLight.shadow.mapSize.set(this.q.shadow, this.q.shadow);
    else this.sky.sunLight.castShadow = false;
    this.sky.sunLight.shadow.camera.far = 5000;
    this.timeOfDay = 15.5;

    await step(10, '지형 생성 (해안선 · 해저 · 하천 · 언덕)');
    this.terrain = new Terrain(this.q.terrain);
    await step(22, '도시 배치 (도로 · 건물 · 나무)');
    this.city = new City(this.terrain, this.q);
    await step(36, `천수방정식 격자 ${this.q.sim}×${this.q.sim} 초기화`);
    this.sim = new ShallowWater(this.q.sim, (x, z) => this.terrain.terrainAt(x, z));
    this.city.bindSim(this.sim);
    this.sim.reset();
    this.city.applySolids();
    this.distMap = new Int8Array(this.sim.N * this.sim.N);
    for (let j = 0; j < this.sim.N; j++) for (let i = 0; i < this.sim.N; i++) {
      this.distMap[j * this.sim.N + i] = this.sim.b0[j * this.sim.N + i] > 0.3 ? districtAt(-HALF + (i + 0.5) * this.sim.dx, -HALF + (j + 0.5) * this.sim.dx) : -1;
    }

    await step(48, '토지이용 · 지형 셰이더');
    const landCanvas = this.city.drawLanduse(this.q.landuse);
    const landTex = new THREE.CanvasTexture(landCanvas);
    landTex.anisotropy = r.capabilities.getMaxAnisotropy();
    landTex.colorSpace = THREE.NoColorSpace;
    this.water = new WaterSurface(this.sim);
    this.terrainU = {
      tLand: { value: landTex }, tFlood: { value: this.water.texFlood }, tDist: { value: this.makeDistrictTexture() },
      uOverlay: { value: 1 }, uDistAlpha: { value: 0 }, uHalf: { value: HALF }, uNight: { value: 0 },
    };
    for (const m of this.terrain.buildMesh(this.terrainU)) this.scene.add(m);
    this.scene.add(this.water.mesh, this.water.far);

    await step(60, '건물 · 시설물 메시');
    this.cityU = { uNight: this.terrainU.uNight };
    this.city.buildMeshes(this.scene, this.cityU);

    await step(70, '대피 경로 계산 (다익스트라)');
    this.nav = new NavGrid(this.terrain, this.city);

    await step(80, '차량 · 선박 · 컨테이너');
    this.bodies = new Bodies(this.scene, this.terrain, this.city, this.sim);

    await step(86, `사람 ${this.q.people}명 생성 (성격 · 감정 · 가족)`);
    this.ctx = { terrain: this.terrain, city: this.city, nav: this.nav, sim: this.sim };
    this.people = new People(this.scene, this.ctx, this.q.people);
    this.player = new Player(this.ctx);

    await step(92, '효과 · 사운드 · 인터페이스');
    this.fx = new Effects(this.scene, this.q.particles);
    this.audio = new SoundEngine();
    this.input = new Input(canvas);
    this.mapCam = new MapCamera(this.camera, canvas);
    this.mapCam.onTap = (x, y) => this.onMapTap(x, y);
    this.mapCam.onUserMove = () => { this.follow = false; };
    this.input.onKey = (e) => this.onKey(e);
    this.pmrem = new THREE.PMREMGenerator(r);
    if (this.q.bloom) {
      // 높음/울트라: HDR 렌더 → 블룸(태양 반사·거품·야간 창문) → 톤매핑·sRGB
      this.composer = new EffectComposer(r);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.28, 0.5, 1.15);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.envDirty = true;

    this.mode = 'map';
    this.timeScale = 1;
    this.paused = false;
    this.selected = null;
    this.follow = false;
    this.npcLook = { yaw: 0, pitch: -0.05 };
    this.resetState();
    this.ui = new UI(this);
    addEventListener('resize', () => this.resize());
    this.resize();

    await step(100, '완료');
    document.getElementById('loading').classList.add('done');
    window.__TSUNAMI__ = this;
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resetState() {
    this.simTime = 0;
    this.eventT0 = null;
    this.events = [];
    this.quake = null;
    this.warn = { issued: false, scheduled: false, at: 0 };
    this.sirenOn = false;
    this.alertOn = false;
    this.alertTime = 0;
    this.collapses = 0;
    this.collapseByDistrict = new Array(DISTRICTS.length).fill(0);
    this.arrived = false;
    this.sources = [];
    this.threatT = 0;
    this.shake = 0;
    this.flash = 0;
    this.collapseLogT = -10;
    this.pendingCollapses = [];
    this.roar = 0;
    this.roarTarget = 0;
    this.roarT = 0;
  }

  resetWorld() {
    this.sim.reset();
    this.water.texFlood.needsUpdate = true;
    this.water.texW.needsUpdate = this.water.texWp.needsUpdate = this.water.texF.needsUpdate = true;
    this.city.resetState();
    this.bodies.reset();
    this.people.spawnAll();
    this.fx.clear();
    this.resetState();
    this.selected = null;
    if (this.mode !== 'map') this.setMode('map');
    this.player.active = false;
    this.ui.reset();
  }

  makeDistrictTexture() {
    const S = 512, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d'), img = g.createImageData(S, S);
    const ids = new Int8Array(S * S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = -HALF + (i + 0.5) * WORLD / S, z = -HALF + (j + 0.5) * WORLD / S;
      ids[j * S + i] = this.terrain.terrainAt(x, z) > 0.3 ? districtAt(x, z) : -1;
    }
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const k = j * S + i, id = ids[k], o = k * 4;
      if (id < 0) { img.data[o + 3] = 0; continue; }
      const c = new THREE.Color(DISTRICTS[id].color);
      const edge = (i > 0 && ids[k - 1] !== id && ids[k - 1] >= 0) || (j > 0 && ids[k - S] !== id && ids[k - S] >= 0);
      img.data[o] = edge ? 255 : c.r * 255; img.data[o + 1] = edge ? 255 : c.g * 255; img.data[o + 2] = edge ? 255 : c.b * 255;
      img.data[o + 3] = edge ? 255 : 110;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fx.uniforms.uScale.value = h * this.renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  /* ───────────────────────── 입력 ───────────────────────── */
  screenRay(sx, sy) {
    const ndc = new THREE.Vector2(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    // 지형/수면 레이마칭
    const o = ray.ray.origin, d = ray.ray.direction;
    let t = 0, prev = null;
    for (let i = 0; i < 2000; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const g = Math.max(this.terrain.groundAt(x, z), 0);
      if (y <= g) {
        if (prev) { // 이분 탐색
          let a = prev, b = t;
          for (let k = 0; k < 12; k++) { const m = (a + b) / 2; const yy = o.y + d.y * m; const gg = Math.max(this.terrain.groundAt(o.x + d.x * m, o.z + d.z * m), 0); if (yy <= gg) b = m; else a = m; }
          t = b;
        }
        return { x: o.x + d.x * t, z: o.z + d.z * t };
      }
      prev = t;
      t += Math.max(0.5, (y - g) * 0.5);
      if (t > 30000) break;
    }
    return null;
  }

  onMapTap(sx, sy) {
    if (this.mode === 'fp' || this.mode === 'npc') return;
    this.audio.start();
    // 사람 선택
    if (this.mode === 'map') {
      const p = this.people.pick(this.camera, sx, sy, innerWidth, innerHeight, 16);
      if (p) { this.select(p); return; }
    }
    const hit = this.screenRay(sx, sy);
    if (!hit) return;
    if (Math.abs(hit.x) > HALF - 40 || Math.abs(hit.z) > HALF - 40) { this.ui.toast('시뮬레이션 영역 밖입니다', 'warn'); return; }
    if (this.mode === 'place') {
      if (this.terrain.groundAt(hit.x, hit.z) < 0.4) { this.ui.toast('육지를 선택하세요', 'warn'); return; }
      this.startFP(hit.x, hit.z);
      return;
    }
    const b0 = this.sim.b0[this.sim.cellOf(hit.x, hit.z)];
    if (b0 > -1.5) {
      if (this.selected) { this.select(null); return; }
      this.ui.toast('쓰나미는 바다에서만 발생시킬 수 있습니다 — 바다를 터치하세요', 'warn');
      return;
    }
    this.trigger(this.ui.srcType, hit.x, hit.z, this.ui.power);
  }

  onKey(e) {
    if (e.code === 'KeyM' || e.code === 'Tab') { e.preventDefault(); this.setMode(this.mode === 'map' ? 'fp' : 'map'); }
    if (e.code === 'KeyP') this.setSpeed(this.paused ? 1 : 0);
    if (e.code === 'Escape' && this.mode === 'place') this.setMode('map');
    if (e.code === 'KeyV') this.ui.toggleBubbles();
    if (e.code === 'Digit1') this.setSpeed(1);
    if (e.code === 'Digit2') this.setSpeed(2);
    if (e.code === 'Digit3') this.setSpeed(5);
    if (e.code === 'Digit4') this.setSpeed(10);
  }

  setSpeed(s) {
    this.paused = s === 0;
    if (s > 0) this.timeScale = s;
    this.ui.syncSpeed();
  }

  select(p) {
    this.selected = p;
    this.follow = false;
    this.ui.showCard(p);
  }

  setMode(m) {
    if (m === 'fp') {
      if (this.player.active) { this.mode = 'fp'; }
      else { this.mode = 'place'; }
    } else this.mode = m;
    if (this.mode !== 'fp' && document.pointerLockElement) document.exitPointerLock();
    this.input.fpMode = this.mode === 'fp' || this.mode === 'npc';
    if (this.mode === 'npc') this.follow = false;
    this.mapCam.enabled = this.mode === 'map' || this.mode === 'place';
    this.ui.setMode(this.mode);
  }

  startFP(x, z) {
    // 물 위라면 가장 가까운 육지로
    if (this.terrain.groundAt(x, z) < 0.4) {
      const k = this.nav.cellOf(x, z), M = this.nav.M;
      let best = null;
      for (let r = 1; r < 40 && !best; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = (k % M) + di, j = ((k / M) | 0) + dj;
        if (i < 0 || j < 0 || i >= M || j >= M || !this.nav.walk[j * M + i]) continue;
        const cx = -HALF + (i + 0.5) * this.nav.S, cz = -HALF + (j + 0.5) * this.nav.S;
        if (!best || Math.hypot(cx - x, cz - z) < Math.hypot(best[0] - x, best[1] - z)) best = [cx, cz];
      }
      if (best) { x = best[0]; z = best[1]; }
    }
    this.input.consumeFP();
    this.player.spawn(x, z, 0);
    this.player.yaw = Math.PI;   // 남쪽(바다) 바라보기
    this.mode = 'fp';
    this.setMode('fp');
    this.ui.toast('사람 모드 — 바다 쪽을 보고 있습니다. 쓰나미가 오면 높은 곳(언덕·고층 건물)으로 대피하세요!', 'info');
  }

  quickPlace() {
    // 해변 산책로에서 시작
    const P = this.city.promenade;
    for (let t = 0; t < 60 && P.length; t++) {
      const [x, z] = P[Math.floor(Math.random() * P.length)];
      if (this.nav.isWalkable(x, z - 8)) { this.startFP(x, z - 8); return; }
    }
    this.startFP(100, -50);
  }

  /* ───────────────────────── 사건 ───────────────────────── */
  landDir(x) {
    const s = coastSlope(x);
    const l = Math.hypot(s, 1);
    return [s / l, -1 / l];
  }

  locationText(x, z) {
    const d = Math.max(0, -inlandDist(x, z));
    const ang = Math.atan2(x, -z) * 180 / Math.PI;
    const dirs = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
    const dn = dirs[((Math.round(ang / 45) % 8) + 8) % 8];
    return `해랑시 ${dn}쪽 해안에서 ${(d / 1000).toFixed(1)} km 해상`;
  }

  trigger(type, x, z, power) {
    this.audio.start();
    const ld = this.landDir(x);
    if (type === 'impact') {
      this.audio.whoosh();
      this.ui.toast('☄️ 운석이 대기권으로 진입합니다!', 'alert');
      for (const p of this.people.list) { p.awareness += 0.3; }
      this.fx.launchMeteor(x, z, () => this.applySource(type, x, z, power, ld));
      return;
    }
    this.applySource(type, x, z, power, ld);
  }

  applySource(type, x, z, power, ld) {
    const info = this.sim.addSource(type, x, z, power, ld);
    if (this.eventT0 === null) this.eventT0 = this.simTime;
    this.sources.push({ type, x, z, power, info, t: this.simTime });
    const loc = this.locationText(x, z);
    if (type === 'quake') {
      this.startQuake(0.45 + 0.55 * power, 18 + 30 * power);
      this.ui.toast(`🌋 규모 M${info.M.toFixed(1)} 해저 지진 발생 — ${loc}`, 'alert');
      this.ui.toast(`해저면 융기 최대 ${info.A.toFixed(1)} m · 단층 길이 ${(info.L / 1000).toFixed(1)} km`, 'info');
      if (this.ui.warnOn && !this.warn.scheduled) this.schedule(14 + 8 * (1 - power), () => this.issueWarning('지진 해일 경보'));
    } else if (type === 'landslide') {
      this.startQuake(0.2 + 0.15 * power, 10);
      this.ui.toast(`⛰️ 해저 산사태 발생 — ${loc}`, 'alert');
    } else if (type === 'impact') {
      this.flash = 1;
      this.shake = 1.5;
      this.audio.boom();
      this.fx.splash(x, 0, z, 70 + 60 * power, Math.min(1400, this.fx.max * 0.4) | 0, 0.2);
      this.fx.shockwave(x, z, 2500);
      this.ui.toast(`☄️ 운석 충돌! 충돌구 반경 ${info.R.toFixed(0)} m — ${loc}`, 'alert');
      for (const p of this.people.list) { p.awareness += 1.2; p.fear = Math.max(p.fear, 0.45); }
      this.startQuake(0.35 + 0.3 * power, 8);
    } else {
      this.ui.toast(`🌊 원거리 해일 접근 — 파고 ${info.A.toFixed(1)} m · ${loc}`, 'alert');
    }
  }

  startQuake(I, dur) {
    this.quake = { t0: this.simTime, I, dur };
    for (const p of this.people.list) {
      p.awareness += (0.25 + p.prep * 0.95) * I;
      p.fear = Math.max(p.fear, 0.2 * I);
      if (p.state === 'normal') this.people.say(p, ['지진이다!', '흔들려!', '머리 숙여!', '뭐야?!']);
    }
  }

  quakeNow() {
    const q = this.quake;
    if (!q) return 0;
    const t = this.simTime - q.t0;
    if (t > q.dur) return 0;
    const env = Math.min(1, t / 2) * Math.min(1, (q.dur - t) / (q.dur * 0.5));
    return q.I * env * (0.75 + 0.25 * Math.sin(t * 13) * Math.sin(t * 7.3));
  }

  schedule(delay, fn) { this.events.push({ t: this.simTime + delay, fn }); this.warn.scheduled = true; }

  issueWarning(kind) {
    if (this.warn.issued || !this.ui.warnOn) { this.warn.scheduled = false; return; }
    this.warn.issued = true;
    this.sirenOn = true;
    this.alertOn = true;
    this.alertTime = this.simTime;
    this.audio.alertTone();
    this.ui.banner(`⚠ ${kind} 발령 — 해안 지역 주민은 즉시 고지대로 대피하십시오`);
    this.ui.phone('[행정안전부] 오늘 ' + this.clockText() + ' 해랑시 해역 쓰나미 경보 발령. 해안가 주민은 즉시 인근 고지대·지정 대피 건물로 대피 바랍니다.');
    this.ui.toast('📢 사이렌 · 긴급재난문자 발송', 'alert');
  }

  clockText() {
    const h = Math.floor(this.timeOfDay), m = Math.floor((this.timeOfDay - h) * 60);
    return `${h}:${String(m).padStart(2, '0')}`;
  }

  onCollapse(b) {
    this.collapses++;
    if (b.district >= 0) this.collapseByDistrict[b.district]++;
    this.bodies.spawnDebris(b, b.style === 0 ? 8 : 14);
    this.fx.dust(b.x, b.base + b.h * 0.3, b.z, Math.max(b.w, b.d), b.style === 0 ? 4 : 14);
    const d = this.camera.position.distanceTo(new THREE.Vector3(b.x, b.base, b.z));
    this.audio.collapse(Math.max(0.05, 1 - d / 900));
    this.pendingCollapses.push(b);
  }

  /* ───────────────────────── 프레임 ───────────────────────── */
  frame() {
    const now = performance.now();
    const dtReal = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const dt = this.paused ? 0 : dtReal * this.timeScale;
    const quake = this.simulate(dt, dtReal);
    this.updateCamera(dtReal, quake);
    this.updateEnvironment(dtReal);
    const hideId = this.mode === 'npc' && this.selected ? this.selected.i : -1;
    const showMarkers = this.ui.markersOn && (this.mode === 'map' || this.mode === 'place') && this.camera.position.y > 260;
    this.people.render(dt, this.camera.position, showMarkers, this.mode === 'map' ? this.selected : null, hideId);
    this.updateAudio(dtReal, quake);
    this.ui.update(dtReal);
    if (this.composer) this.composer.render(dtReal); else this.renderer.render(this.scene, this.camera);
  }

  /** 테스트용: 렌더 없이 물리·사람만 진행 */
  debugStep(sec, dt = 0.1) {
    const t0 = performance.now();
    for (let t = 0; t < sec - 1e-6; t += dt) this.simulate(dt, dt);
    return performance.now() - t0;
  }

  simulate(dt, dtReal) {
    this.simTime += dt;
    this.elapsed = (this.elapsed || 0) + dtReal;

    // 예약 사건
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.simTime >= this.events[i].t) { const e = this.events[i]; this.events.splice(i, 1); e.fn(); }
    }
    const quake = this.quakeNow();
    // 물리
    if (this.sim.active && dt > 0) {
      this.sim.advance(dt);
      this.threatT -= dt;
      if (this.threatT <= 0) { this.threatT = 0.25; this.sim.updateThreat(); this.checkGauges(); }
      this.city.updateDamage(dt, (b) => this.onCollapse(b));
      this.city.updateVegetation(dt);
      this.bodies.update(dt, (body, bld, E) => { bld.extraHit = (bld.extraHit || 0) + E / (bld.strength * 2.5e4); if (E > 2e5) this.audio.collapse(0.25); });
    }
    if (this.pendingCollapses.length && this.simTime - this.collapseLogT > 6) {
      const byD = {};
      for (const b of this.pendingCollapses) { const k = (DISTRICTS[b.district] || { name: '해안' }).name; byD[k] = (byD[k] || 0) + 1; }
      const big = this.pendingCollapses.filter((b) => b.floors >= 4).map((b) => b.name);
      const extra = big.length ? ` — ${[...new Set(big)].slice(0, 2).join('·')} 포함` : '';
      this.ui.toast(`🏚 건물 붕괴 ${this.pendingCollapses.length}채: ` + Object.entries(byD).map(([k, n]) => `${k} ${n}`).join(' · ') + extra, 'warn');
      this.pendingCollapses = [];
      this.collapseLogT = this.simTime;
    }
    const env = {
      sim: this.sim, simTime: this.simTime, quake, quakeAfter: this.quake && this.simTime - this.quake.t0 < 400,
      quakeRecent: this.quake && this.simTime - this.quake.t0 < 90, sirenOn: this.sirenOn, alertOn: this.alertOn, alertTime: this.alertTime,
      player: this.player, collapses: this.collapses, time: this.elapsed,
    };
    this.people.update(dt, env);
    if (this.mode === 'fp') {
      const inp = this.input.consumeFP();
      if (dt > 0) this.player.update(dt, inp, env);
      else { this.player.yaw -= inp.lookX; this.player.pitch = Math.max(-1.45, Math.min(1.45, this.player.pitch - inp.lookY)); }
    } else if (this.mode === 'npc') {
      const inp = this.input.consumeFP();
      this.npcLook.yaw -= inp.lookX; this.npcLook.pitch = Math.max(-1.3, Math.min(1.3, this.npcLook.pitch - inp.lookY));
      this.npcLook.yaw *= 1 - Math.min(1, dtReal * 0.4);
    }
    // 효과
    if (dt > 0) this.fx.spawnFromSim(this.sim, this.city, this.camera.position, dt, Math.min(1, dt * 30) * (this.qKey === 'low' ? 0.5 : 1));
    this.fx.update(dt, 0.25 + 0.75 * this.sky.dayFactor);
    return quake;
  }

  checkGauges() {
    const sim = this.sim;
    if (!this.warn.issued && this.ui.warnOn && !this.warn.buoy) {
      for (const [bx, bz] of BUOYS) {
        const k = sim.cellOf(bx, bz);
        const eta = sim.h[k] + sim.b[k];
        if (Math.abs(eta) > 0.5) {
          this.warn.buoy = true;
          this.ui.toast('📡 해상 관측 부이에서 이상 수위 감지 — 경보 분석 중', 'info');
          this.schedule(9, () => this.issueWarning('쓰나미 경보'));
          break;
        }
      }
    }
    if (!this.arrived) {
      for (const k of sim.coastCells) {
        for (const n of [k - 1, k + 1, k - sim.N, k + sim.N]) {
          if (sim.b0[n] > 0.8 && sim.h[n] > 0.3 && this.distMap[n] >= 0) {   // 방파제 등 해상 구조물 제외
            this.arrived = true;
            const t = this.simTime - (this.eventT0 || 0);
            const ni = n % sim.N, nj = (n - ni) / sim.N;
            const d = districtAt(-HALF + (ni + 0.5) * sim.dx, -HALF + (nj + 0.5) * sim.dx);
            this.ui.toast(`🌊 쓰나미 해안 도달 (${DISTRICTS[Math.max(0, d)].name}) — 발생 ${fmtT(t)} 후 · 해안 수위 ${sim.coastNow.toFixed(1)} m`, 'alert');
            this.shake = Math.max(this.shake, 0.4);
            break;
          }
        }
        if (this.arrived) break;
      }
    }
  }

  updateCamera(dt, quake) {
    const cam = this.camera;
    const fpLike = this.mode === 'fp' || this.mode === 'npc';
    this.shake = Math.max(0, this.shake - dt * 0.6);
    const shakeAmt = quake * 0.6 + this.shake + (fpLike ? this.roar * 0.12 : 0);
    if (this.mode === 'map' || this.mode === 'place') {
      if (this.follow && this.selected && this.selected.state !== 'missing') { this.mapCam.goal.tx = this.selected.x; this.mapCam.goal.tz = this.selected.z; }
      this.mapCam.keys(this.input.keys, dt);
      this.mapCam.update(dt, (x, z) => this.terrain.groundAt(x, z));
      const alt = cam.position.y - Math.max(0, this.terrain.groundAt(cam.position.x, cam.position.z));
      cam.near = Math.min(40, Math.max(0.5, alt * 0.04));
      if (shakeAmt > 0.001) {
        const s = shakeAmt * Math.min(30, this.mapCam.dist * 0.004);
        cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s * 0.5;
      }
    } else {
      cam.near = 0.12;
      let yaw, pitch;
      if (this.mode === 'fp') {
        this.player.eye(cam.position, this.elapsed);
        yaw = this.player.yaw; pitch = this.player.pitch;
      } else {
        const p = this.selected;
        if (!p || p.state === 'missing') { this.setMode('map'); return; }
        this.people.headPos(p, cam.position);
        const k = 1 - Math.exp(-dt * 4);
        const tgt = p.yaw + p.anim.head + Math.PI;
        this.npcYaw = this.npcYaw === undefined ? tgt : this.npcYaw + angDiff(this.npcYaw, tgt) * k;
        yaw = this.npcYaw + this.npcLook.yaw; pitch = this.npcLook.pitch;
        if (p.state === 'swept') pitch += Math.sin(this.elapsed * 2.1) * 0.25;
      }
      cam.rotation.set(pitch, yaw, 0, 'YXZ');
      if (shakeAmt > 0.001) {
        cam.rotation.x += (Math.random() - 0.5) * shakeAmt * 0.03;
        cam.rotation.z += (Math.random() - 0.5) * shakeAmt * 0.04;
        cam.position.y += (Math.random() - 0.5) * shakeAmt * 0.08;
      }
      if (this.mode === 'fp' && this.player.state === 'swept') cam.rotation.z += Math.sin(this.elapsed * 1.7) * 0.15;
    }
    cam.updateProjectionMatrix();
  }

  updateEnvironment(dt) {
    const sky = this.sky, cam = this.camera;
    sky.update(this.timeOfDay, cam.position, 0.12, this.elapsed);
    const day = sky.dayFactor;
    // 그림자: 보는 곳 중심
    const focus = (this.mode === 'map' || this.mode === 'place') ? this.mapCam.target : cam.position;
    const half = (this.mode === 'map' || this.mode === 'place') ? Math.max(180, Math.min(1800, this.mapCam.dist * 0.55)) : 170;
    const L = sky.sunLight;
    L.position.copy(focus).addScaledVector(sky.sunDirection, 2000);
    L.target.position.copy(focus);
    const sc = L.shadow.camera;
    if (sc.right !== half) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.updateProjectionMatrix(); }
    L.shadow.normalBias = half > 600 ? 3 : 0.6;
    sky.material.uniforms.exposure.value *= 0.62;
    sky.hemi.intensity *= 0.55;
    sky.ambient.intensity *= 0.5;
    sky.sunSprite.position.copy(cam.position).addScaledVector(sky.sunDirection, 20000);
    sky.sunSprite.scale.multiplyScalar(20000 / 150000);
    // 수중 판정
    const s = this.sim.sample(cam.position.x, cam.position.z, {});
    const under = cam.position.y < s.eta - 0.05 && s.h > 0.2;
    this.underwater = under;
    const fog = this.scene.fog;
    if (under) {
      const mud = this.sim.mud[this.sim.cellOf(cam.position.x, cam.position.z)];
      fog.color.setRGB(0.05 + mud * 0.12, 0.12 + mud * 0.04, 0.12 - mud * 0.04).multiplyScalar(0.3 + 0.7 * day);
      fog.density = 0.09 + mud * 0.15;
    } else {
      fog.color.copy(sky.fogColor);
      const fp = this.mode === 'fp' || this.mode === 'npc';
      fog.density = fp ? 0.00028 : Math.max(0.00004, 0.00013 - this.camera.position.y * 0.00000002);
    }
    this.renderer.setClearColor(fog.color);
    this.water.update(this.elapsed, sky);
    this.water.uniforms.fogColor.value.copy(fog.color);
    this.water.uniforms.fogDensity.value = fog.density;
    this.terrainU.uNight.value = Math.max(0, 1 - day * 1.6);
    this.city.beacon.intensity = Math.max(0, 1 - day * 2) * 60;
    this.flash = Math.max(0, this.flash - dt * 0.8);
    if (this.envDirty) {
      this.envDirty = false;
      if (this.envRT) this.envRT.dispose();
      const es = new THREE.Scene();
      const m = new THREE.Mesh(sky.mesh.geometry, sky.material);
      m.scale.setScalar(1000);
      es.add(m);
      this.envRT = this.pmrem.fromScene(es, 0, 1, 5000);
      this.scene.environment = this.envRT.texture;
    }
  }

  updateAudio(dt, quake) {
    const cam = this.camera.position;
    const fpLike = this.mode === 'fp' || this.mode === 'npc';
    const lx = fpLike ? cam.x : this.mapCam.target.x, lz = fpLike ? cam.z : this.mapCam.target.z;
    const alt = fpLike ? 0 : Math.min(1, this.mapCam.dist / 3000);
    const near = 1 - alt * 0.85;
    // 쓰나미 포효: 주변 흐름 에너지
    this.roarT -= dt;
    if (this.roarT <= 0 && this.sim.active) {
      this.roarT = 0.12;
      let e = 0;
      const R = fpLike ? 350 : 500 + this.mapCam.dist * 0.3;
      for (let i = 0; i < 40; i++) {
        const a = i * 2.39996, r = R * Math.sqrt((i + 0.5) / 40);
        const x = lx + Math.cos(a) * r, z = lz + Math.sin(a) * r;
        const k = this.sim.cellOf(x, z);
        const h = this.sim.h[k];
        if (h < 0.1) continue;
        const sp = Math.hypot(this.sim.uc[k], this.sim.vc[k]);
        const f = this.sim.foam[k];
        e += (sp * Math.min(h, 4) * 0.08 + f * 0.6) / (1 + (r / (R * 0.35)) ** 2);
      }
      this.roarTarget = Math.min(1.6, e * 0.35);
    }
    this.roar += ((this.roarTarget || 0) - this.roar) * Math.min(1, dt * 3);
    let crowd = 0, screams = 0;
    if (this.people.hHead) {
      for (const p of this.people.list) {
        if (p.state === 'missing' || p.state === 'inside') continue;
        const d = Math.abs(p.x - lx) + Math.abs(p.z - lz);
        if (d > 220) continue;
        const w = 1 - d / 220;
        if (p.fear > 0.45) crowd += w;
        if (p.fear > 0.75 || p.state === 'swept') screams += w;
      }
    }
    let sirenV = 0;
    if (this.sirenOn) for (const [sx, sz] of SIRENS) sirenV = Math.max(sirenV, 1 - Math.hypot(sx - lx, sz - lz) / 1600);
    const coast = Math.max(0, 1 - Math.abs(inlandDist(lx, lz)) / 350);
    const fear = this.mode === 'fp' ? this.player.fear : this.mode === 'npc' && this.selected ? this.selected.fear : 0;
    const heart = this.mode === 'fp' ? this.player.heart : this.mode === 'npc' && this.selected ? this.selected.heart : 0;
    this.audio.update(dt, {
      surf: (0.25 + coast) * near, altitude: alt, roar: this.roar * near, quake: quake * (fpLike ? 1 : 0.6),
      siren: Math.max(0, sirenV) * near * (this.paused ? 0 : 1), crowd: crowd / 25 * near, screamRate: this.paused ? 0 : screams * 0.25 * this.timeScale ** 0.3, screamVol: near * Math.min(1, screams / 6 + 0.3),
      heart, heartVol: fpLike ? Math.max(0, (fear - 0.35) * 1.5) : 0, underwater: this.underwater, calm: !this.sim.active && this.sky.dayFactor > 0.5 && near > 0.4,
    });
  }
}

export function fmtT(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}분 ${String(s).padStart(2, '0')}초`;
}

function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

const game = new Game();
game.init().catch((e) => {
  console.error(e);
  const t = document.getElementById('load-text');
  if (t) t.textContent = '오류: ' + e.message + ' — WebGL2 지원 브라우저가 필요합니다.';
});
