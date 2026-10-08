// 해랑시 쓰나미 — 세계지도(전 지구 전파) · 도시 지도(2D) · 3D · 1인칭 / 사건(지진·경보·도달) / 렌더 파이프라인
import * as THREE from 'three';
import { Sky } from '../../src/world/sky.js';
import { WORLD, HALF, QUALITY, DISTRICTS } from './config.js';
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
import { CityMap2D } from './city2d.js';
import { loadWorldData } from './world/worlddata.js';
import { WorldMap } from './world/worldmap.js';
import { GlobalSim } from './world/globalsim.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// 가상 도시 해랑시: 한반도 남동 해안
const CITY_LL = { lon: 129.12, lat: 35.08 };
const SPEEDS = { world: [60, 300, 1200, 3600], city: [1, 2, 5, 10] };
const LOCK_SCALE = 10;           // 쓰나미가 도시에 다가오면 세계지도 배속 상한 (도시 시뮬레이션이 따라갈 수 있는 속도)
const LOCK_LEAD = 20 * 60;       // 도달 몇 초 전부터 잠글지

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

    await step(3, '렌더러 준비');
    const canvas = document.getElementById('gl');
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.qKey !== 'low', powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, this.q.pr));
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.86;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = this.q.shadow > 0;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1, 40000);
    this.scene.fog = new THREE.FogExp2(0x9ec4e8, 0.0001);

    await step(6, '세계 지형 · 수심 자료');
    this.worldData = await loadWorldData();
    this.global = new GlobalSim(this.worldData, { quality: this.qKey });
    this.global.onFrame = (gs) => this.onGlobalFrame(gs);
    this.global.onTT = () => this.updateCityArrival();
    this.global.ready.then(() => this.global.setGauge(CITY_LL.lon, CITY_LL.lat));
    this.worldMap = new WorldMap(r, this.worldData, { quality: this.qKey });
    this.worldMap.setCity(CITY_LL);
    this.worldMap.onTap = (lon, lat, sx, sy) => this.onWorldTap(lon, lat, sx, sy);

    this.sky = new Sky(this.scene);
    this.sky.mesh.scale.setScalar(30000);
    // 하늘 셰이더는 후처리(OutputPass)용 선형 출력 → 직접 렌더할 때 톤매핑·sRGB 변환 추가
    const sfs = this.sky.material.fragmentShader, si = sfs.lastIndexOf('}');
    this.sky.material.fragmentShader = sfs.slice(0, si) + '#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}';
    if (this.q.shadow) this.sky.sunLight.shadow.mapSize.set(this.q.shadow, this.q.shadow);
    else this.sky.sunLight.castShadow = false;
    this.sky.sunLight.shadow.camera.far = 5000;
    this.timeOfDay = 15.5;

    await step(14, '도시 지형 생성 (해안선 · 해저 · 하천 · 언덕)');
    this.terrain = new Terrain(this.q.terrain);
    await step(24, '도시 배치 (도로 · 건물 · 해수욕장)');
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
    // 외해 경계: 전 지구 모델 관측점 수위 → 그린 법칙 증폭 후 강제
    this.boundaryEta = 0;
    this.sim.setBoundaryForcing(() => this.boundaryEta, this.landDir(0));
    let dsum = 0, dn = 0;
    for (let i = 0; i < this.sim.N; i++) { const b = -this.sim.b0[(this.sim.N - 3) * this.sim.N + i]; if (b > 2) { dsum += b; dn++; } }
    this.edgeDepth = dn ? dsum / dn : 40;

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

    await step(78, '차량 · 선박 · 컨테이너');
    this.bodies = new Bodies(this.scene, this.terrain, this.city, this.sim);

    await step(84, `사람 ${this.q.people}명 (성격 · 감정 · 가족 · 해변 놀이)`);
    this.ctx = { terrain: this.terrain, city: this.city, nav: this.nav, sim: this.sim };
    this.people = new People(this.scene, this.ctx, this.q.people, this.qKey);
    await this.people.crowd.ready;
    this.player = new Player(this.ctx);

    await step(90, '도시 지도');
    this.city2d = new CityMap2D(r, { ...this.ctx, people: this.people }, this.water, { quality: this.qKey });
    this.city2d.onTap = (x, z, sx, sy) => this.onCityTap(x, z, sx, sy);

    await step(94, '효과 · 사운드 · 인터페이스');
    this.fx = new Effects(this.scene, this.q.particles);
    this.audio = new SoundEngine();
    this.input = new Input(canvas);
    this.mapCam = new MapCamera(this.camera, canvas);
    this.mapCam.onTap = (x, y) => this.on3DTap(x, y);
    this.mapCam.enabled = false;
    this.input.onKey = (e) => this.onKey(e);
    this.pmrem = new THREE.PMREMGenerator(r);
    if (this.q.bloom) {
      this.composer = new EffectComposer(r);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.28, 0.5, 1.15);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.envDirty = true;

    this.mode = 'world';
    this.speed = { world: 300, city: 1 };
    this.paused = false;
    this.selected = null;
    this.npcLook = { yaw: 0, pitch: -0.05 };
    this.resetState();
    this.ui = new UI(this);
    addEventListener('resize', () => this.resize());
    this.resize();
    this.worldMap.resetView();
    this.city2d.flyTo(200, -150, this.city2d.fitZoom() * 1.4);
    this.setMode('world');

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
    this.shockFx = 0;
    this.collapseLogT = -10;
    this.pendingCollapses = [];
    this.roar = 0;
    this.roarTarget = 0;
    this.roarT = 0;
    this.gEvents = [];
    this.gEvent = null;
    this.gWarnAt = null;
    this.cityArrive = null;
    this.cityLock = false;
    this.lockNoticed = false;
    this.boundaryEta = 0;
  }

  resetWorld() {
    this.sim.reset();
    this.water.texFlood.needsUpdate = true;
    this.water.texW.needsUpdate = this.water.texWp.needsUpdate = this.water.texF.needsUpdate = true;
    this.city.resetState();
    this.bodies.reset();
    this.people.spawnAll();
    this.fx.clear();
    this.global.reset();
    this.global.setGauge(CITY_LL.lon, CITY_LL.lat);
    this.worldMap.setWave(null); this.worldMap.setMax(null); this.worldMap.setArrival(null);
    this.resetState();
    this.selected = null;
    this.player.active = false;
    this.ui.reset();
    if (this.mode === 'fp' || this.mode === 'npc') this.setMode('city');
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
      img.data[o] = c.r * 255; img.data[o + 1] = c.g * 255; img.data[o + 2] = c.b * 255; img.data[o + 3] = 110;
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
    this.worldMap.setSize(w, h);
    this.city2d.setSize(w, h);
  }

  /* ───────────────────────── 모드 · 시간 ───────────────────────── */
  setMode(m) {
    if (m === 'fp' && !this.player.active) { this.quickPlace(); return; }
    if (m === 'npc' && (!this.selected || this.selected.state === 'missing')) m = 'city';
    const prev = this.mode;
    this.mode = m;
    if (m !== 'fp' && document.pointerLockElement) document.exitPointerLock();
    this.input.fpMode = m === 'fp' || m === 'npc';
    this.mapCam.enabled = m === 'city3d';
    if (m === 'world') this.worldMap.attach(this.canvas); else this.worldMap.detach();
    if (m === 'city') { if (!this.city2d.el) this.city2d.attach(this.canvas); } else this.city2d.detach();
    if (m === 'city3d' && prev === 'city') { const v = this.city2d.view; this.mapCam.focus(v.cx, v.cz, Math.max(250, Math.min(3000, innerHeight / v.zoom * 0.9))); }
    if (m === 'city' && prev === 'world' && !this.cityVisited) { this.cityVisited = true; this.city2d.flyTo(250, -120, this.city2d.fitZoom() * 2.2); }
    this.ui.setMode(m);
    this.syncGlobalSpeed();
  }

  /** 지금 실제로 적용되는 배속 */
  effScale() {
    const grp = this.mode === 'world' ? 'world' : 'city';
    let s = this.speed[grp];
    if (grp === 'world' && this.cityLock) s = Math.min(s, LOCK_SCALE);
    return s;
  }

  speedLabel() {
    const s = this.effScale();
    if (this.mode !== 'world' || s <= LOCK_SCALE) return s + '×';
    return s >= 3600 ? `${s / 3600}시간/초` : `${s / 60}분/초`;
  }

  cycleSpeed() {
    const grp = this.mode === 'world' ? 'world' : 'city';
    const list = SPEEDS[grp], i = list.indexOf(this.speed[grp]);
    this.speed[grp] = list[(i + 1) % list.length];
    if (grp === 'world' && this.cityLock && this.speed.world > LOCK_SCALE) this.ui.notice('쓰나미가 해랑시에 다가오는 동안은 최대 10배속입니다', 'info', 3);
    this.paused = false;
    this.global.pause(false);
    this.syncGlobalSpeed();
    this.ui.syncSpeed();
  }

  setSpeed(s) {
    if (s === 0) { this.togglePause(); return; }
    this.speed[this.mode === 'world' ? 'world' : 'city'] = s;
    this.paused = false; this.global.pause(false);
    this.syncGlobalSpeed(); this.ui.syncSpeed();
  }

  togglePause() {
    this.paused = !this.paused;
    this.global.pause(this.paused);
    this.ui.syncSpeed();
  }

  syncGlobalSpeed() {
    const s = this.effScale();
    if (s !== this._gScale) { this._gScale = s; this.global.setTimeScale(s); }
    if (this.ui) this.ui.syncSpeed();
  }

  eventStarted() { return !!this.gEvent || this.eventT0 !== null; }

  clockLabel() {
    if (this.gEvent) return 'T+' + fmtClock(this.global.now() - this.gEvent.t0);
    if (this.eventT0 !== null) return 'T+' + fmtClock(this.simTime - this.eventT0);
    return this.clockText();
  }

  clockText() {
    const h = Math.floor(this.timeOfDay), m = Math.floor((this.timeOfDay - h) * 60);
    return `${h}:${String(m).padStart(2, '0')}`;
  }

  cityEtaText() {
    if (this.cityArrive === null) return '';
    const rem = this.cityArrive - this.global.now();
    if (rem <= 0) return this.arrived ? '침수 중' : '도달';
    return fmtDur(rem) + ' 후';
  }

  etaFor(lon, lat) { return this.global.travelTime(lon, lat); }

  updateCityArrival() {
    if (!this.gEvents) return;
    let best = null;
    for (const e of this.gEvents) {
      const tt = this.global.travelTime(e.lon, e.lat);
      if (tt !== null && (best === null || e.t + tt < best)) best = e.t + tt;
    }
    this.cityArrive = best;
  }

  setFloodOverlay(on) {
    this.terrainU.uOverlay.value = on ? 1 : 0;
    if (this.city2d.uniforms) this.city2d.uniforms.uOverlay.value = on ? 1 : 0;
  }

  /* ───────────────────────── 입력 ───────────────────────── */
  worldElev(lon, lat) {
    const d = this.worldData, i = Math.floor(((((lon + 180) % 360) + 360) % 360) / 360 * d.W), j = Math.floor((90 - lat) / 180 * d.H);
    return d.elev[Math.max(0, Math.min(d.H - 1, j)) * d.W + Math.min(d.W - 1, i)];
  }

  onWorldTap(lon, lat, sx, sy) {
    this.audio.start();
    const e = this.worldElev(lon, lat);
    if (e >= 0) { this.ui.closeEditor(); this.ui.notice('바다를 눌러 주세요 — 쓰나미는 해저에서 시작됩니다', 'warn', 3); return; }
    if (Math.abs(lat) > 74) { this.ui.closeEditor(); this.ui.notice('극지방 바다는 계산 범위 밖입니다', 'warn', 3); return; }
    const d = haversine(lon, lat, CITY_LL.lon, CITY_LL.lat);
    const ll = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
    this.ui.openEditor({ kind: 'world', lon, lat, where: `${ll} · 수심 ${(-e).toLocaleString()} m · 해랑시까지 ${Math.round(d).toLocaleString()} km` }, sx, sy);
  }

  onCityTap(x, z, sx, sy) {
    this.audio.start();
    this.ui.hidePerson();
    // 사람 선택 (화면 14 px 이내)
    const v = this.city2d.view, R = 14 / v.zoom;
    let best = null, bd = R;
    for (const p of this.people.list) {
      if (p.state === 'missing' || p.state === 'inside') continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) { this.ui.closeEditor(); this.ui.showPerson(best, sx, sy); return; }
    this.cityTapAt(x, z, sx, sy);
  }

  cityTapAt(x, z, sx, sy) {
    if (Math.abs(x) > HALF - 40 || Math.abs(z) > HALF - 40) { this.ui.notice('시뮬레이션 영역 밖입니다', 'warn', 3); return; }
    const b0 = this.sim.b0[this.sim.cellOf(x, z)];
    if (b0 > -1.5) { this.ui.closeEditor(); this.ui.showPlace(x, z, sx, sy); return; }
    this.ui.openEditor({ kind: 'city', x, z, where: this.locationText(x, z) }, sx, sy);
  }

  on3DTap(sx, sy) {
    this.audio.start();
    this.ui.hidePerson();
    const p = this.people.pick(this.camera, sx, sy, innerWidth, innerHeight, 16);
    if (p) { this.ui.showPerson(p, sx, sy); return; }
    const hit = this.screenRay(sx, sy);
    if (hit) this.cityTapAt(hit.x, hit.z, sx, sy);
  }

  screenRay(sx, sy) {
    const ndc = new THREE.Vector2(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    let t = 0, prev = null;
    for (let i = 0; i < 2000; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const g = Math.max(this.terrain.groundAt(x, z), 0);
      if (y <= g) {
        if (prev) {
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

  onKey(e) {
    if (e.code === 'KeyP') this.togglePause();
    if (e.code === 'Escape') { this.ui.closeEditor(); this.ui.hidePerson(); if (this.mode === 'fp' || this.mode === 'npc') this.setMode('city'); }
    if (e.code === 'Tab') { e.preventDefault(); const order = ['world', 'city', 'city3d', 'fp']; this.setMode(order[(order.indexOf(this.mode) + 1) % order.length]); }
    const grp = this.mode === 'world' ? 'world' : 'city';
    const k = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (k >= 0) this.setSpeed(SPEEDS[grp][k]);
  }

  viewPerson(p) {
    if (!p) return;
    this.selected = p;
    this.npcYaw = undefined;
    this.setMode('npc');
  }

  startFP(x, z) {
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
    this.setMode('fp');
    this.ui.notice('바다 쪽을 보고 있습니다. 쓰나미가 오면 언덕이나 고층 건물 옥상으로 대피하세요', 'info', 6);
  }

  quickPlace() {
    const P = this.city.promenade;
    for (let t = 0; t < 60 && P.length; t++) {
      const [x, z] = P[Math.floor(Math.random() * P.length)];
      if (this.nav.isWalkable(x, z - 8)) { this.startFP(x, z - 8); return; }
    }
    this.startFP(100, -50);
  }

  /* ───────────────────────── 쓰나미 발생 ───────────────────────── */
  previewSource(s) {
    if (!s) { this.worldMap.setPreview(null); this.city2d.setPreview(null); return; }
    if (s.kind === 'world') {
      const g = worldGeom(s);
      this.worldMap.setPreview(s.type === 'impact' ? { lon: s.lon, lat: s.lat, radius_km: g.L / 2 } : { lon: s.lon, lat: s.lat, length_km: g.L, width_km: g.W, strike_deg: s.strike });
    } else {
      const o = cityOpt(s), R = s.type === 'quake' ? o.R : o.R;
      this.city2d.setPreview({ x: s.x, z: s.z, radius: R, stretch: s.type === 'quake' ? o.L / o.R : s.type === 'landslide' ? 1.2 : 1, angle: (s.strike - 90) * Math.PI / 180 });
    }
  }

  launch(s) {
    this.audio.start();
    if (s.kind === 'world') this.launchWorld(s);
    else this.trigger(s.type, s.x, s.z, s.power, cityOpt(s));
  }

  launchWorld(s) {
    const g = worldGeom(s);
    const src = { type: s.type, lon: s.lon, lat: s.lat, height_m: s.height, length_km: g.L, width_km: g.W, strike_deg: s.strike };
    const t = this.global.t;
    this.global.addSource(src);
    if (!this.gEvent) this.gEvent = { t0: t };
    this.gEvents.push({ ...src, t });
    this.updateCityArrival();
    const d = haversine(s.lon, s.lat, CITY_LL.lon, CITY_LL.lat);
    const tt = this.global.travelTime(s.lon, s.lat);
    const name = s.type === 'quake' ? `규모 Mw ${GlobalSim.magnitude(src).toFixed(1)} 해저 지진` : s.type === 'landslide' ? '해저 산사태' : '운석 충돌';
    this.ui.notice(`${name} — 해랑시까지 ${Math.round(d).toLocaleString()} km${tt !== null ? ` · 도달 예상 ${fmtDur(tt)} 후` : ''}`, 'alert', 8);
    // 도시가 느끼는 진동 (거리 감쇠) · 경보 예약
    const Mw = s.type === 'quake' ? GlobalSim.magnitude(src) : s.type === 'impact' ? 7.5 : 6;
    const I = Math.max(0, Math.min(1, (Mw - 5.5) / 3.5) * Math.exp(-d / 350));
    if (I > 0.05) {
      if (this.effScale() <= LOCK_SCALE) this.startQuake(0.25 + I * 0.75, 15 + 40 * I);
      else for (const p of this.people.list) p.awareness += (0.25 + p.prep * 0.95) * I;
    }
    const warnDelay = d < 1000 ? 180 + d * 0.06 : 600;
    if (!this.gWarnAt || t + warnDelay < this.gWarnAt) this.gWarnAt = t + warnDelay;
    this.ui.closeEditor();
  }

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
    return `해랑시 ${dn}쪽 해안에서 ${(d / 1000).toFixed(1)} km 해상 · 수심 ${Math.max(0, -this.sim.b0[this.sim.cellOf(x, z)]).toFixed(0)} m`;
  }

  trigger(type, x, z, power, opt) {
    const ld = this.landDir(x);
    if (type === 'impact') {
      this.audio.whoosh();
      this.ui.notice('운석이 대기권으로 진입합니다', 'alert', 4);
      for (const p of this.people.list) p.awareness += 0.3;
      this.fx.launchMeteor(x, z, () => this.applySource(type, x, z, power, ld, opt));
      return;
    }
    this.applySource(type, x, z, power, ld, opt);
  }

  applySource(type, x, z, power, ld, opt) {
    const info = this.sim.addSource(type, x, z, power, ld, opt);
    if (this.eventT0 === null) this.eventT0 = this.simTime;
    this.sources.push({ type, x, z, power, info, t: this.simTime });
    const loc = this.locationText(x, z);
    if (type === 'quake') {
      this.startQuake(0.45 + 0.55 * power, 18 + 30 * power);
      this.ui.notice(`규모 Mw ${info.M.toFixed(1)} 해저 지진 · 융기 ${info.A.toFixed(1)} m — ${loc}`, 'alert', 7);
      if (this.ui.warnOn && !this.warn.scheduled) this.schedule(14 + 8 * (1 - power), () => this.issueWarning('지진해일 경보'));
    } else if (type === 'landslide') {
      this.startQuake(0.2 + 0.15 * power, 10);
      this.ui.notice(`해저 산사태 · 초기 파고 ${info.A.toFixed(0)} m — ${loc}`, 'alert', 7);
    } else if (type === 'impact') {
      this.flash = 1;
      this.shake = 1.5;
      this.audio.boom();
      this.fx.splash(x, 0, z, 70 + 60 * power, Math.min(1400, this.fx.max * 0.4) | 0, 0.2);
      this.fx.shockwave(x, z, 2500);
      this.ui.notice(`운석 충돌 · 충돌구 반경 ${info.R.toFixed(0)} m — ${loc}`, 'alert', 7);
      for (const p of this.people.list) { p.awareness += 1.2; p.fear = Math.max(p.fear, 0.45); }
      this.startQuake(0.35 + 0.3 * power, 8);
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
    this.ui.notice(`${kind} 발령 — 해안 지역은 즉시 고지대로 대피하십시오`, 'alert', 8);
    this.ui.phone(`[행정안전부] 오늘 ${this.clockText()} 해랑시 해역 ${kind} 발령. 해안가 주민은 즉시 인근 고지대·지정 대피 건물로 대피 바랍니다.`);
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

  onGlobalFrame(gs) {
    this.worldMap.setWave(gs.eta, gs.W, gs.H);
    if (gs.max) { this.worldMap.setMax(gs.max, gs.W, gs.H); this.worldMap.setArrival(gs.arr, gs.W, gs.H); }
  }

  /* ───────────────────────── 프레임 ───────────────────────── */
  frame() {
    const now = performance.now();
    const dtReal = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.elapsed = (this.elapsed || 0) + dtReal;
    this.updateGlobalLink();
    const S = this.effScale();
    // 세계지도에서 빨리 감는 동안 도시는 멈춤 (쓰나미가 다가오면 잠금 배속으로 함께 진행)
    const dt = this.paused || S > LOCK_SCALE ? 0 : dtReal * S;
    const quake = this.simulate(dt, dtReal);
    const m = this.mode;
    if (m === 'world') this.worldMap.render();
    else if (m === 'city') {
      this.water.update(this.elapsed, this.sky);
      this.city2d.update(dtReal, this.elapsed);
      this.city2d.updateDots(this.people, this.bodies.mapList ? this.bodies.mapList() : null);
      this.city2d.render();
    } else {
      this.updateCamera(dtReal, quake);
      this.updateEnvironment(dtReal);
      const hideId = m === 'npc' && this.selected ? this.selected.i : -1;
      const showMarkers = m === 'city3d' && this.camera.position.y > 260 && this.ui.bubblesOn;
      this.people.render(dt, this.camera, showMarkers, m === 'city3d' ? this.selected : null, hideId);
      if (this.composer) this.composer.render(dtReal); else this.renderer.render(this.scene, this.camera);
    }
    this.updateAudio(dtReal, quake);
    this.ui.update(dtReal);
  }

  /** 전 지구 모델 ↔ 도시: 경계 수위, 도달 잠금, 경보 */
  updateGlobalLink() {
    const gs = this.global;
    const gnow = gs.now();
    if (gs.gauge && gs.series.length > 2) {
      const amp = Math.max(1, Math.min(4, Math.pow(gs.gauge.depth / Math.max(5, this.edgeDepth), 0.25)));
      this.boundaryEta = amp * gs.gaugeAt(gnow - (gs.dt || 30));
      if (Math.abs(this.boundaryEta) > 0.02 && !this.sim.active) {
        this.sim.active = true;
        if (this.eventT0 === null) this.eventT0 = this.simTime;
      }
    } else this.boundaryEta = 0;
    const rem = this.cityArrive !== null ? this.cityArrive - gnow : Infinity;
    const lock = (rem < LOCK_LEAD && rem > -6 * 3600) || Math.abs(this.boundaryEta) > 0.02;
    if (lock !== this.cityLock) {
      this.cityLock = lock;
      this.syncGlobalSpeed();
      if (lock && !this.lockNoticed) {
        this.lockNoticed = true;
        this.ui.notice('쓰나미가 해랑시에 다가옵니다 — 도시를 눌러 지켜보세요', 'wave', 8);
      }
    }
    if (this.gWarnAt !== null && gnow >= this.gWarnAt && !this.warn.issued) {
      this.gWarnAt = null;
      this.issueWarning(rem < 3 * 3600 ? '지진해일 경보' : '지진해일 주의보');
    }
  }

  /** 테스트용: 렌더 없이 물리·사람만 진행 */
  debugStep(sec, dt = 0.1) {
    const t0 = performance.now();
    for (let t = 0; t < sec - 1e-6; t += dt) this.simulate(dt, dt);
    return performance.now() - t0;
  }

  simulate(dt, dtReal) {
    this.simTime += dt;
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.simTime >= this.events[i].t) { const e = this.events[i]; this.events.splice(i, 1); e.fn(); }
    }
    const quake = this.quakeNow();
    if (this.sim.active && dt > 0) {
      this.sim.advance(dt);
      this.threatT -= dt;
      if (this.threatT <= 0) { this.threatT = 0.25; this.sim.updateThreat(); this.checkGauges(); }
      this.city.updateDamage(dt, (b) => this.onCollapse(b));
      this.city.updateVegetation(dt);
      this.bodies.update(dt, (body, bld, E) => { bld.extraHit = (bld.extraHit || 0) + E / (bld.strength * 2.5e4); if (E > 2e5) this.audio.collapse(0.25); });
    }
    if (this.pendingCollapses.length && this.simTime - this.collapseLogT > 8) {
      const big = this.pendingCollapses.filter((b) => b.floors >= 4).map((b) => b.name);
      this.ui.notice(`건물 ${this.pendingCollapses.length}채 붕괴${big.length ? ' — ' + [...new Set(big)].slice(0, 2).join('·') : ''}`, 'warn', 5);
      this.pendingCollapses = [];
      this.collapseLogT = this.simTime;
    }
    if (dt <= 0 && this.mode === 'world') return quake;
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
    if (dt > 0 && this.mode !== 'world' && this.mode !== 'city') this.fx.spawnFromSim(this.sim, this.city, this.camera.position, dt, Math.min(1, dt * 30) * (this.qKey === 'low' ? 0.5 : 1));
    this.fx.update(dt, 0.25 + 0.75 * this.sky.dayFactor);
    this.shockFx = Math.max(0, this.shockFx - dtReal * 2);
    return quake;
  }

  checkGauges() {
    const sim = this.sim;
    if (!this.warn.issued && this.ui.warnOn && !this.warn.buoy) {
      for (const [bx, bz] of BUOYS) {
        const k = sim.cellOf(bx, bz);
        if (Math.abs(sim.h[k] + sim.b[k]) > 0.5) {
          this.warn.buoy = true;
          this.ui.notice('해상 관측 부이에서 이상 수위 감지 — 경보 분석 중', 'info', 5);
          this.schedule(9, () => this.issueWarning('지진해일 경보'));
          break;
        }
      }
    }
    if (!this.arrived) {
      for (const k of sim.coastCells) {
        for (const n of [k - 1, k + 1, k - sim.N, k + sim.N]) {
          if (sim.b0[n] > 0.8 && sim.h[n] > 0.3 && this.distMap[n] >= 0) {
            this.arrived = true;
            const ni = n % sim.N, nj = (n - ni) / sim.N;
            const d = districtAt(-HALF + (ni + 0.5) * sim.dx, -HALF + (nj + 0.5) * sim.dx);
            this.ui.notice(`쓰나미가 ${DISTRICTS[Math.max(0, d)].name} 해안에 도달 · 해안 수위 ${sim.coastNow.toFixed(1)} m`, 'wave', 7);
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
    if (this.mode === 'city3d') {
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
        if (!p || p.state === 'missing') { this.setMode('city'); return; }
        this.people.headPos(p, cam.position);
        const k = 1 - Math.exp(-dt * 4);
        const tgt = p.yaw + (p.anim.head || 0) + Math.PI;
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
    const focus = this.mode === 'city3d' ? this.mapCam.target : cam.position;
    const half = this.mode === 'city3d' ? Math.max(180, Math.min(1800, this.mapCam.dist * 0.55)) : 170;
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
    const m = this.mode;
    const fpLike = m === 'fp' || m === 'npc';
    let lx, lz, alt;
    if (fpLike) { lx = this.camera.position.x; lz = this.camera.position.z; alt = 0; }
    else if (m === 'city3d') { lx = this.mapCam.target.x; lz = this.mapCam.target.z; alt = Math.min(1, this.mapCam.dist / 3000); }
    else if (m === 'city') { lx = this.city2d.view.cx; lz = this.city2d.view.cz; alt = Math.min(1, 0.35 / this.city2d.view.zoom); }
    else { lx = 0; lz = 0; alt = 1; }
    const near = m === 'world' ? 0.08 : 1 - alt * 0.85;
    this.roarT -= dt;
    if (this.roarT <= 0 && this.sim.active) {
      this.roarT = 0.12;
      let e = 0;
      const R = fpLike ? 350 : 500 + alt * 1000;
      for (let i = 0; i < 40; i++) {
        const a = i * 2.39996, r = R * Math.sqrt((i + 0.5) / 40);
        const x = lx + Math.cos(a) * r, z = lz + Math.sin(a) * r;
        const k = this.sim.cellOf(x, z);
        const h = this.sim.h[k];
        if (h < 0.1) continue;
        const sp = Math.hypot(this.sim.uc[k], this.sim.vc[k]);
        e += (sp * Math.min(h, 4) * 0.08 + this.sim.foam[k] * 0.6) / (1 + (r / (R * 0.35)) ** 2);
      }
      this.roarTarget = Math.min(1.6, e * 0.35);
    }
    this.roar += ((this.roarTarget || 0) - this.roar) * Math.min(1, dt * 3);
    let crowd = 0, screams = 0;
    if (this.people.hHead && m !== 'world') {
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
    const coast = m === 'world' ? 0 : Math.max(0, 1 - Math.abs(inlandDist(lx, lz)) / 350);
    const fear = m === 'fp' ? this.player.fear : m === 'npc' && this.selected ? this.selected.fear : 0;
    const heart = m === 'fp' ? this.player.heart : m === 'npc' && this.selected ? this.selected.heart : 0;
    const ts = this.effScale();
    this.audio.update(dt, {
      surf: (0.25 + coast) * near, altitude: alt, roar: this.roar * near, quake: quake * (fpLike ? 1 : 0.6),
      siren: Math.max(0, sirenV) * near * (this.paused ? 0 : 1), crowd: crowd / 25 * near, screamRate: this.paused ? 0 : screams * 0.25 * ts ** 0.3, screamVol: near * Math.min(1, screams / 6 + 0.3),
      heart, heartVol: fpLike ? Math.max(0, (fear - 0.35) * 1.5) : 0, underwater: this.underwater && fpLike, calm: !this.sim.active && this.sky.dayFactor > 0.5 && near > 0.4,
    });
  }
}

/* ───────────────────────── 발생원 기하 ───────────────────────── */
function worldGeom(s) {
  const L = s.type === 'impact' ? Math.max(60, s.size) : s.size;
  const W = s.type === 'quake' ? Math.min(220, Math.max(50, L * 0.33)) : s.type === 'landslide' ? Math.max(40, L * 0.6) : L;
  return { L, W };
}

function cityOpt(s) {
  const half = s.size * 1000 / 2;
  if (s.type === 'quake') return { A: s.height, L: half, R: Math.max(300, Math.min(1200, half * 0.8)), strike: s.strike };
  return { A: s.height, R: half, strike: s.strike };
}

function haversine(lon1, lat1, lon2, lat2) {
  const r = Math.PI / 180, dl = (lon2 - lon1) * r, dp = (lat2 - lat1) * r;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dl / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function fmtDur(t) {
  if (t < 3600) return `${Math.max(1, Math.round(t / 60))}분`;
  const h = Math.floor(t / 3600), m = Math.round((t - h * 3600) / 60);
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

function fmtClock(t) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

const game = new Game();
game.init().catch((e) => {
  console.error(e);
  const t = document.getElementById('load-text');
  if (t) t.textContent = '오류: ' + e.message + ' — WebGL2 지원 브라우저가 필요합니다.';
});
