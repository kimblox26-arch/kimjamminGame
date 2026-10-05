// SpaceSim — Astrophysical Simulation Software · 메인 앱 (렌더러 · 후처리 · 루프 · 시나리오 관리)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Sky } from './sky.js';
import { OrbitCam } from './controls.js';
import { LIGHTS } from './bodies.js';
import { UI, Labels, icon } from './ui.js';
import { SpaceAudio } from './audio.js';
import { isMobile, clamp } from './util.js';
import { SolarScenario } from './scenarios/solar.js';
import { BlackHoleScenario } from './scenarios/blackhole.js';
import { GalaxyScenario } from './scenarios/galaxy.js';
import { ClusterScenario } from './scenarios/cluster.js';
import { ThreeBodyScenario } from './scenarios/threebody.js';
import { BinaryScenario } from './scenarios/binary.js';
import { LabScenario } from './scenarios/lab.js';
import { preloadTextures, setAnisotropy, PLANET_KEYS } from './textures.js';

const QUALITY = {
  low: { name: '낮음', pr: 1, msaa: 0, seg: 40, oct: 4, stars: 7000, belt: 2500, galaxy: 16000, cluster: 256, proto: 70, bhSteps: 140, bhScale: 0.55, bhCube: 512, budget: 6, debris: 70, debrisCap: 700, maxBodies: 120, sky: 'milkyway_4k' },
  medium: { name: '중간', pr: 1.5, msaa: 2, seg: 64, oct: 5, stars: 12000, belt: 5000, galaxy: 32000, cluster: 400, proto: 110, bhSteps: 190, bhScale: 0.7, bhCube: 768, budget: 7, debris: 120, debrisCap: 1200, maxBodies: 180, sky: 'milkyway_4k' },
  high: { name: '높음', pr: 2, msaa: 4, seg: 96, oct: 6, stars: 18000, belt: 9000, galaxy: 60000, cluster: 640, proto: 150, bhSteps: 260, bhScale: 0.8, bhCube: 1024, budget: 9, debris: 200, debrisCap: 2200, maxBodies: 240, sky: 'milkyway_8k' },
  ultra: { name: '울트라', pr: 2.5, msaa: 4, seg: 128, oct: 7, stars: 26000, belt: 14000, galaxy: 100000, cluster: 1024, proto: 200, bhSteps: 360, bhScale: 1, bhCube: 2048, budget: 11, debris: 300, debrisCap: 3200, maxBodies: 300, sky: 'milkyway_8k' },
};
const Q_HINT = {
  auto: '기기에 맞춰 자동 선택합니다.',
  low: '저사양 휴대폰용. 해상도·입자 수를 크게 줄입니다.',
  medium: '대부분의 휴대폰·태블릿에 적합합니다.',
  high: '데스크톱 권장. MSAA 4×, 은하 입자 6만 개.',
  ultra: '고성능 GPU 전용. 은하 입자 10만 개, 블랙홀 360스텝 원본 해상도.',
};

export const SCENARIOS = [
  { id: 'solar', title: '태양계', sub: '지금 이 순간(또는 원하는 날짜)의 실제 위치·자전에서 시작 · 실제 표면 사진', cls: SolarScenario, thumb: 'radial-gradient(circle at 30% 50%, #fff3c4 0 10%, #ffb347 14%, transparent 24%), radial-gradient(circle at 74% 40%, #6fb2ff 0 6%, transparent 8%), radial-gradient(circle at 60% 72%, #e0b98c 0 8%, transparent 10%), #0a1124' },
  { id: 'blackhole', title: '블랙홀', sub: '슈바르츠실트 측지선 광선추적 — 중력 렌즈 · 광자 고리 · 도플러 빔', cls: BlackHoleScenario, thumb: 'radial-gradient(circle, #000 0 22%, #ffe9c8 25%, #ff9a4a 30%, transparent 38%), linear-gradient(transparent 44%, #ffcf8a 48%, #ff7a3a 52%, transparent 56%), #070a14' },
  { id: 'galaxy', title: '은하 충돌', sub: '두 나선은하의 조석 상호작용과 병합 · 최대 10만 입자', cls: GalaxyScenario, thumb: 'radial-gradient(ellipse 30% 14% at 34% 44%, #fff0d0, #8fb0ff 60%, transparent), radial-gradient(ellipse 20% 30% at 70% 62%, #ffe2b8, #b08cff 60%, transparent), #060914' },
  { id: 'cluster', title: '구상성단', sub: '플러머 구 직접 N-체 · 질량 분리 · 별의 증발', cls: ClusterScenario, thumb: 'radial-gradient(circle at 50% 50%, #fff8e0 0 8%, #ffd29a 18%, rgba(255,190,120,.35) 34%, transparent 52%), #070b16' },
  { id: 'threebody', title: '삼체 문제', sub: '8자 궤도 · 나비 해 · 라그랑주 삼각형 · 피타고라스 혼돈', cls: ThreeBodyScenario, thumb: 'radial-gradient(circle at 25% 50%, #8fb8ff 0 7%, transparent 9%), radial-gradient(circle at 75% 50%, #ffd27a 0 7%, transparent 9%), radial-gradient(circle at 50% 50%, #ff7a5a 0 6%, transparent 8%), #0a0f20' },
  { id: 'binary', title: '쌍성계', sub: 'Kepler-16 — 두 개의 태양을 도는 행성 (타투인)', cls: BinaryScenario, thumb: 'radial-gradient(circle at 42% 50%, #ffd09a 0 10%, transparent 14%), radial-gradient(circle at 60% 52%, #ff8a6a 0 6%, transparent 9%), radial-gradient(circle at 82% 34%, #e0c8a0 0 4%, transparent 5%), #0b0f1e' },
  { id: 'sandbox', title: '우주 실험실', sub: '빈 우주에 실제 천체를 배치·발사 — 충돌하면 파편이 튀고 원시 위성이 생깁니다', cls: LabScenario, thumb: 'radial-gradient(circle at 50% 50%, #fff3c4 0 8%, #ffb347 12%, transparent 18%), radial-gradient(circle at 20% 30%, #ffa060 0 3%, transparent 5%), radial-gradient(circle at 76% 70%, #6fb2ff 0 4%, transparent 6%), #0a1020' },
];

const DEFAULTS = { quality: 'auto', bloom: 1, exposure: 1, orbits: true, markers: true, autorot: false, dynres: true, perf: true, sound: false, trails: true, labels: true, scenario: 'solar' };

class App {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.settings = { ...DEFAULTS };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('spacesim.settings') || '{}')); } catch { /* 저장소 없음 */ }
    this.paused = false;
    this.dynScale = 1;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.audio = new SpaceAudio();
    this.labels = new Labels(document.getElementById('labels'));
    this.ui = new UI(this);
    this.frame = 0;
    this.fps = 60;
    this.ft = 1 / 60;
  }

  save() { try { localStorage.setItem('spacesim.settings', JSON.stringify(this.settings)); } catch { /* 무시 */ } }

  resolveQuality() {
    const k = this.settings.quality;
    if (k !== 'auto') return k;
    if (isMobile) return Math.min(screen.width, screen.height) < 400 ? 'low' : 'medium';
    return 'high';
  }

  get pixelRatio() { return Math.min(window.devicePixelRatio || 1, this.quality.pr) * this.dynScale; }

  async init(progress) {
    this.qualityKey = this.resolveQuality();
    this.quality = QUALITY[this.qualityKey];
    progress(0.1, 'WebGL2 렌더러 초기화');
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    if (!r.capabilities.isWebGL2) throw new Error('WebGL2를 지원하지 않는 브라우저입니다.');
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = this.settings.exposure;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(50, this.width / this.height, 0.01, 1e5);
    this.controls = new OrbitCam(this.camera, this.canvas);
    this.controls.onTap = (x, y) => this.scenario?.pick(x, y);
    this.controls.onDoubleTap = (x, y) => { if (this.scenario?.pick(x, y)) this.controls.zoom(0.45); };
    setAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));
    if (r.capabilities.maxTextureSize < 8192) this.quality = { ...this.quality, sky: 'milkyway_4k' };
    await tick();
    const keys = [...PLANET_KEYS, this.quality.sky];
    await preloadTextures(keys, (f) => progress(0.12 + f * 0.33, `실제 천체 표면 텍스처 불러오는 중… (${Math.round(f * keys.length)}/${keys.length})`));
    progress(0.46, '은하수 파노라마 · 밝은 별 배치');
    this.buildSky();
    this.buildComposer();
    this.resize();
    await tick();
    progress(0.5, '인터페이스 구성');
    this.bindUI();
    await tick();
    const id = SCENARIOS.some((s) => s.id === this.settings.scenario) ? this.settings.scenario : 'solar';
    progress(0.65, `시나리오 준비: ${SCENARIOS.find((s) => s.id === id).title}`);
    await this.setScenario(id, true);
    progress(0.85, '셰이더 컴파일');
    await tick();
    this.renderer.compile(this.scene, this.camera);
    this.renderFrame(0.016);
    progress(1, '준비 완료');
    window.addEventListener('resize', () => this.resize());
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  buildSky() {
    if (this.sky) this.scene.remove(this.sky.group);
    if (this.sky) this.sky.dispose();
    this.sky = new Sky({ count: this.quality.stars, pixelRatio: this.pixelRatio, texKey: this.quality.sky });
    this.scene.add(this.sky.group);
  }

  buildComposer() {
    this.composer?.renderTarget1.dispose();
    this.composer?.renderTarget2.dispose();
    const r = this.renderer;
    r.setPixelRatio(this.pixelRatio);
    const rt = new THREE.WebGLRenderTarget(this.width * this.pixelRatio, this.height * this.pixelRatio, { type: THREE.HalfFloatType, samples: this.quality.msaa });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.8 * this.settings.bloom, 0.32, 0.9);
    this.bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.75, 0.5, 0.28, 0.12];
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const pr = this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.fov = this.camera.aspect < 1 ? clamp(50 / Math.sqrt(this.camera.aspect), 50, 76) : 50;
    this.camera.updateProjectionMatrix();
    this.sky?.setPixelRatio(pr);
    if (this.scenario?.markers) this.scenario.markers.setPixelRatio(pr);
  }

  get budgetMs() { return this.quality.budget; }
  toast(m) { this.ui.toast(m); }

  async setScenario(id, initial = false) {
    const def = SCENARIOS.find((s) => s.id === id);
    if (!def) return;
    if (this.scenario) {
      this.scenario.dispose();
      this.labels.clear();
      this.ui.showInfo(null);
    }
    const c = this.controls;
    c.follow = null; c.trans = null; c.interceptor = null; c.vTheta = c.vPhi = 0;
    LIGHTS.uStarCount.value = 1;
    if (id === 'blackhole' && !initial) this.toast('광선추적 셰이더 준비 중…');
    if (!initial) await tick();
    this.scenarioId = id;
    this.scenario = new def.cls(this);
    this.scenario.start();
    this.settings.scenario = id;
    this.save();
    document.getElementById('scenario-name').textContent = def.title;
    document.querySelectorAll('.scn-card').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
    const w = this.scenario.warp;
    this.warpRange = w;
    this.setWarp(w.def);
    this.ui.buildPanel(this.scenario.panel(), `${def.title} · 제어`);
    if (!initial) this.toast(def.title);
    this.paused = false;
    this.updatePlay();
  }

  // 배속 슬라이더 (로그 스케일)
  setWarp(w) {
    const { min, max } = this.warpRange;
    this.warp = clamp(w, min, max);
    document.getElementById('warp').value = Math.round((Math.log(this.warp / min) / Math.log(max / min)) * 1000);
    document.getElementById('warp-text').textContent = this.warpRange.fmt(this.warp);
  }
  sliderWarp(v) { const { min, max } = this.warpRange; this.setWarp(min * Math.pow(max / min, v / 1000)); }

  updatePlay() {
    const b = document.getElementById('btn-play');
    b.innerHTML = icon(this.paused ? 'play' : 'pause');
  }

  bindUI() {
    const $ = (id) => document.getElementById(id);
    const list = $('scn-list');
    list.innerHTML = '';
    SCENARIOS.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'scn-card';
      b.dataset.id = s.id;
      b.innerHTML = `<div class="scn-thumb" style="background:${s.thumb}"></div><div><b>${i + 1}. ${s.title}</b><span>${s.sub}</span></div>`;
      b.onclick = () => { this.closeDrawer(); if (s.id !== this.scenarioId) this.setScenario(s.id); };
      list.appendChild(b);
    });
    const drawer = $('drawer'), scrim = $('drawer-scrim');
    this.openDrawer = () => { drawer.classList.add('open'); scrim.classList.add('open'); };
    this.closeDrawer = () => { drawer.classList.remove('open'); scrim.classList.remove('open'); };
    $('btn-menu').onclick = this.openDrawer;
    $('btn-drawer-close').onclick = this.closeDrawer;
    scrim.onclick = this.closeDrawer;

    $('btn-play').onclick = () => { this.paused = !this.paused; this.updatePlay(); };
    $('btn-reset').onclick = () => this.setScenario(this.scenarioId);
    $('warp').oninput = (e) => this.sliderWarp(+e.target.value);
    const tog = (id, key, after) => {
      const el = $(id);
      el.classList.toggle('on', !!this.settings[key]);
      el.onclick = () => { this.settings[key] = !this.settings[key]; el.classList.toggle('on', this.settings[key]); this.save(); after && after(); };
    };
    tog('btn-trails', 'trails');
    tog('btn-labels', 'labels');
    $('btn-focus').onclick = () => { this.scenario.select?.(null); this.scenario.start(); };
    const panel = $('panel'), pbtn = $('btn-panel');
    const setPanel = (open) => { panel.classList.toggle('hidden', !open); pbtn.classList.toggle('on', open); if (open && isMobile) this.ui.showInfo(null); };
    this.setPanel = setPanel;
    setPanel(!isMobile && this.width > 900);
    pbtn.onclick = () => setPanel(panel.classList.contains('hidden'));

    $('btn-full').onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => this.toast('이 브라우저는 전체 화면을 지원하지 않습니다'));
    };
    $('btn-hide').onclick = () => document.body.classList.toggle('hidden-ui');
    $('btn-shot').onclick = () => (this.wantShot = true);

    // 설정
    const modal = $('settings');
    $('btn-settings').onclick = () => modal.classList.remove('hidden');
    $('btn-settings-close').onclick = () => modal.classList.add('hidden');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    const qc = $('q-chips');
    const qKeys = ['auto', 'low', 'medium', 'high', 'ultra'];
    const renderQ = () => {
      qc.innerHTML = '';
      qKeys.forEach((k) => {
        const b = document.createElement('button');
        b.className = 'chip' + (this.settings.quality === k ? ' on' : '');
        b.textContent = k === 'auto' ? `자동 (${QUALITY[this.resolveQualityAuto()].name})` : QUALITY[k].name;
        b.onclick = () => { this.settings.quality = k; this.save(); renderQ(); this.applyQuality(); };
        qc.appendChild(b);
      });
      $('q-hint').textContent = Q_HINT[this.settings.quality];
    };
    renderQ();
    const slider = (id, key, out, fn) => {
      const el = $(id), o = $(out);
      el.value = Math.round(this.settings[key] * 100);
      o.textContent = `${this.settings[key].toFixed(2)}×`;
      el.oninput = () => { this.settings[key] = el.value / 100; o.textContent = `${this.settings[key].toFixed(2)}×`; fn(this.settings[key]); this.save(); };
    };
    slider('s-bloom', 'bloom', 'bloom-v', (v) => (this.bloom.strength = 0.8 * v));
    slider('s-exposure', 'exposure', 'exp-v', (v) => (this.renderer.toneMappingExposure = v));
    const chk = (id, key, fn) => {
      const el = $(id);
      el.checked = !!this.settings[key];
      el.onchange = () => { this.settings[key] = el.checked; this.save(); fn && fn(el.checked); };
    };
    chk('s-orbits', 'orbits');
    chk('s-markers', 'markers');
    chk('s-autorot', 'autorot');
    chk('s-dynres', 'dynres', (v) => { if (!v) { this.dynScale = 1; this.resize(); } });
    chk('s-perf', 'perf', (v) => ($('perf').style.display = v ? '' : 'none'));
    $('perf').style.display = this.settings.perf ? '' : 'none';
    chk('s-sound', 'sound', (v) => this.audio.setEnabled(v));

    // 키보드
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key;
      if (k === ' ') { e.preventDefault(); this.paused = !this.paused; this.updatePlay(); }
      else if (k === '[' || k === ']') { const el = $('warp'); el.value = clamp(+el.value + (k === ']' ? 60 : -60), 0, 1000); this.sliderWarp(+el.value); }
      else if (k === 'r' || k === 'R') this.setScenario(this.scenarioId);
      else if (k === 'f' || k === 'F') { this.controls.follow = null; }
      else if (k === 'h' || k === 'H') document.body.classList.toggle('hidden-ui');
      else if (k === 'Escape') { this.closeDrawer(); modal.classList.add('hidden'); }
      else if (/^[1-7]$/.test(k)) { const s = SCENARIOS[+k - 1]; if (s.id !== this.scenarioId) this.setScenario(s.id); }
    });
  }

  resolveQualityAuto() { const s = this.settings.quality; this.settings.quality = 'auto'; const k = this.resolveQuality(); this.settings.quality = s; return k; }

  async applyQuality() {
    this.qualityKey = this.resolveQuality();
    this.quality = QUALITY[this.qualityKey];
    if (this.renderer.capabilities.maxTextureSize < 8192) this.quality = { ...this.quality, sky: 'milkyway_4k' };
    this.dynScale = 1;
    this.buildSky();
    this.buildComposer();
    this.resize();
    await this.setScenario(this.scenarioId);
    this.toast(`그래픽 품질: ${this.quality.name}`);
  }

  renderFrame(dt) {
    const sc = this.scenario;
    sc.update(dt);
    this.controls.autoRotate = this.settings.autorot;
    this.controls.update(dt);
    sc.lateUpdate?.(dt);
    this.sky.update(this.camera);
    sc.beforeRender?.(this.renderer);
    this.composer.render(dt);
  }

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const raw = (now - this.last) / 1000, dt = clamp(raw, 0, 0.1);
    this.last = now;
    if (!dt) return;
    this.frame++;
    if (!this.paused) this.scenario.simulate(dt, this.warp);
    LIGHTS.uTime.value += dt;
    this.renderFrame(dt);
    if (this.wantShot) { this.wantShot = false; this.screenshot(); }

    // 성능 · 동적 해상도
    this.ft += (Math.min(raw, 2) - this.ft) * 0.05;
    this.fps = 1 / this.ft;
    if (this.settings.dynres && this.frame > 90) {
      this._slow = this.fps < 40 ? (this._slow || 0) + dt : 0;
      this._fast = this.fps > 57 ? (this._fast || 0) + dt : 0;
      if (this._slow > 1.5 && this.dynScale > 0.5) { this.dynScale = Math.max(0.5, this.dynScale * 0.85); this._slow = 0; this.resize(); }
      else if (this._fast > 5 && this.dynScale < 1) { this.dynScale = Math.min(1, this.dynScale * 1.12); this._fast = 0; this.resize(); }
    }
    if (this.frame % 10 === 0) this.updateHUD();
  }

  updateHUD() {
    const sc = this.scenario, c = sc.clock();
    const cm = document.getElementById('clock-main'), cs = document.getElementById('clock-sub');
    if (cm.textContent !== c.main) cm.textContent = c.main;
    if (cs.textContent !== c.sub) cs.textContent = c.sub;
    if (sc.readouts) this.ui.updateReadouts(sc.readouts());
    if (this.settings.perf) {
      const s = sc.stats?.() || {};
      const pr = this.renderer.getPixelRatio();
      document.getElementById('perf').innerHTML = `${Math.round(this.fps)} FPS · ${this.quality.name} · ${Math.round(this.width * pr)}×${Math.round(this.height * pr)}${this.dynScale < 1 ? ` (${Math.round(this.dynScale * 100)}%)` : ''}<br>${s.bodies ? `${s.bodies.toLocaleString()} 천체 · ` : ''}${this.paused ? '일시정지' : this.warpRange.fmt(this.warp)}`;
    }
  }

  screenshot() {
    this.canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `spacesim-${this.scenarioId}-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      this.toast('스크린샷 저장됨');
    });
  }
}

const tick = () => new Promise((r) => setTimeout(r, 16));

// ── 인트로 별빛 ──
function introStars() {
  const cv = document.getElementById('intro-stars'), ctx = cv.getContext('2d');
  const stars = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() }));
  let run = true;
  const draw = (t) => {
    if (!run) return;
    const w = (cv.width = cv.clientWidth * devicePixelRatio), h = (cv.height = cv.clientHeight * devicePixelRatio);
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.z -= 0.0012; if (s.z <= 0.02) { s.z = 1; s.x = Math.random(); s.y = Math.random(); }
      const k = 0.5 / s.z, x = (s.x - 0.5) * k * w + w / 2, y = (s.y - 0.5) * k * h + h / 2;
      const a = Math.min(1, (1 - s.z) * 1.4) * (0.7 + 0.3 * Math.sin(t / 300 + s.x * 40));
      ctx.fillStyle = `rgba(200,220,255,${a})`;
      ctx.fillRect(x, y, 1.6 * devicePixelRatio * (1.2 - s.z), 1.6 * devicePixelRatio * (1.2 - s.z));
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  return () => (run = false);
}

const stopIntro = introStars();
const app = new App();
window.spacesim = app;
const bar = document.getElementById('load-bar'), txt = document.getElementById('load-text');
app.init((p, msg) => { bar.style.width = `${Math.round(p * 100)}%`; txt.textContent = msg; })
  .then(() => {
    const btn = document.getElementById('btn-start');
    btn.hidden = false;
    txt.textContent = isMobile ? '터치로 회전 · 핀치로 확대 · 천체를 탭해 추적' : '드래그 회전 · 휠 확대 · 천체 클릭으로 추적';
    const go = () => {
      document.getElementById('intro').classList.add('gone');
      setTimeout(stopIntro, 1200);
      if (app.settings.sound) app.audio.setEnabled(true);
      app.last = performance.now();
    };
    btn.onclick = go;
    if (new URLSearchParams(location.search).has('autostart')) go();
  })
  .catch((e) => {
    console.error(e);
    txt.textContent = `오류: ${e.message}`;
    bar.style.background = '#ff6b7d';
  });
