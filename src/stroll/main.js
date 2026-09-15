// 고요(GOYO) — 숲 속 1인칭 힐링 산책
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clamp, clamp01, lerp, rand, TAU } from '../core/utils.js';
import { damp } from './util.js';
import { Terrain, fbm2, LAKE } from './terrain.js';
import { Sky } from './sky.js';
import { Water } from './water.js';
import { GrassField, buildClutter, WIND, SUN } from './flora.js';
import { Forest, FallingLeaves } from './trees.js';
import { buildFlowers, buildLilies } from './flowers.js';
import { Wildlife } from './fauna.js';
import { Player, ObstacleGrid } from './player.js';
import { Audio } from './audio.js';
import { HUD, Menu, TouchControls } from './ui.js';
import { Weather } from './weather.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const DISCOVERIES = [
  { id: 'lake', text: '호숫가에 닿았다', sub: '물결이 발끝에서 번진다' },
  { id: 'deer', text: '사슴을 가까이서 보았다', sub: '숨을 죽이면 더 가까이 갈 수 있다' },
  { id: 'sunrise', text: '해가 떠오르는 것을 보았다', sub: '' },
  { id: 'sunset', text: '노을을 바라보았다', sub: '' },
  { id: 'stars', text: '별이 가득한 하늘을 보았다', sub: '' },
  { id: 'firefly', text: '반딧불이를 만났다', sub: '' },
  { id: 'summit', text: '언덕 꼭대기에 올랐다', sub: '계곡 전체가 내려다보인다' },
  { id: 'rainbow', text: '비 갠 하늘에 무지개가 섰다', sub: '' },
  { id: 'rain', text: '빗속을 걸었다', sub: '빗소리가 숲을 덮는다' },
  { id: 'rest', text: '잠시 앉아 쉬었다', sub: 'R 키로 언제든 앉을 수 있다' },
];

class Game {
  constructor() {
    this.settings = loadSettings();
    this.quality = this.settings.quality;
    this.isMobile = IS_MOBILE;
    this.found = new Set();
    this.time = 0;
    this.wind = 0.5;
    this.windTarget = 0.5;
    this.paused = false;
    this.started = false;
    this.photoMode = false;
    this.audio = Audio;
  }

  async boot() {
    const canvas = document.getElementById('gl');
    const renderer = this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: this.quality !== 'low', powerPreference: 'high-performance',
      stencil: false,
    });
    this.pixelCap = PIXEL_CAP[this.quality];
    this.renderScale = 1;
    renderer.setPixelRatio(Math.min(devicePixelRatio, this.pixelCap));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.info.autoReset = false;    // 후처리 패스까지 합쳐서 통계를 본다
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.08, 5200);
    this.scene.add(this.camera);
    this._setupComposer();

    const prog = (p, label) => {
      document.getElementById('loading-bar').style.width = `${Math.round(p * 100)}%`;
      if (label) document.getElementById('loading-label').textContent = label;
    };

    prog(0.02, '골짜기를 빚는 중');
    this.terrain = new Terrain(this.scene, this.quality);
    await this.terrain.build((p) => prog(0.02 + p * 0.45, '골짜기를 빚는 중'), nextFrame);

    prog(0.5, '호수에 물을 채우는 중');
    await nextFrame();
    this.water = new Water(this.scene, this.terrain.bakeLakeDepth());

    prog(0.56, '나무를 심는 중');
    await nextFrame();
    this.forest = new Forest(this.scene, this.quality);
    this.leaves = new FallingLeaves(this.scene, this.quality === 'low' ? 0 : this.quality === 'medium' ? 60 : 110);

    prog(0.74, '풀과 꽃을 뿌리는 중');
    await nextFrame();
    this.grass = new GrassField(this.scene, this.quality);
    this.clutter = buildClutter(this.scene, this.quality);

    prog(0.78, '들꽃을 피우는 중');
    await nextFrame();
    const flowers = buildFlowers(this.scene, this.quality);
    this.flowers = flowers;
    this.clutter = this.clutter.concat(flowers.layers);   // 같은 셀 풀 방식이라 함께 갱신된다
    this.lilies = buildLilies(this.scene, this.quality);

    this.weather = new Weather(this.scene, {
      rain: this.settings.rain,
      rainCount: this.quality === 'low' ? 900 : this.quality === 'medium' ? 1600 : this.quality === 'ultra' ? 3600 : 2600,
    });

    prog(0.82, '하늘을 여는 중');
    await nextFrame();
    this.sky = new Sky(this.scene, renderer, { time: 0.29, dayLength: this.settings.dayLength });
    this.sky.setShadowQuality(this.quality);

    prog(0.88, '동물을 부르는 중');
    await nextFrame();
    this.wildlife = new Wildlife(this.scene, {
      quality: this.quality, trees: this.forest.trees, water: this.water,
    });

    prog(0.94, '오솔길을 내는 중');
    await nextFrame();
    const obstacles = new ObstacleGrid(10);
    for (const [x, z, , , sc] of this.forest.trees) obstacles.add(x, z, 0.55 * sc);
    for (const [x, z, , , sc] of this.forest.rocks) if (sc > 0.9) obstacles.add(x, z, sc * 0.75);
    this.player = new Player(this.camera, {
      obstacles,
      fov: this.settings.fov,
      onStep: (surf, i, run, side) => this.onStep(surf, i, run, side),
      onLand: (impact, surf) => {
        if (impact > 0.12) this.audio.footstep(surf, 0.6 + impact, true, 1);
        if (impact > 0.3) this.audio.cloth(impact);
      },
      onJump: () => this.audio.cloth(0.7),
    });
    this.player.bind(canvas);
    this.player.update(0.016);      // 타이틀 화면에서도 골짜기가 보이도록 카메라를 앉힌다
    this.player.sensitivity = this.settings.sensitivity;
    this.player.invertY = this.settings.invertY;
    this.grass.prime(this.player.pos.x, this.player.pos.z);
    for (const layer of this.clutter) layer.prime(this.player.pos.x, this.player.pos.z);
    this.forest.updateLOD(this.player.pos.x, this.player.pos.z, true);

    this.hud = new HUD();
    this.menu = new Menu(this);
    if (this.isMobile || navigator.maxTouchPoints > 0) this.touch = new TouchControls(this);

    prog(1, '준비되었다');
    await nextFrame();

    this._bindEvents();
    document.body.dataset.screen = 'title';
    document.getElementById('loading').classList.add('done');
    this._loop();
  }

  /**
   * 후처리 — 장면을 HDR 렌더타깃에 그린 뒤 블룸을 얹고 마지막에 톤매핑한다.
   * (렌더타깃에 그릴 때 three 는 머티리얼 톤매핑을 끄므로 이중 적용되지 않는다)
   */
  _setupComposer() {
    const q = this.quality;
    // 저사양에서는 후처리를 통째로 건너뛴다 (전체화면 패스도 비용이다)
    if (q === 'low') { this.composer = null; this.bloom = null; return; }
    this.bloomOn = true;
    const samples = q === 'ultra' ? 4 : q === 'high' ? 4 : q === 'medium' ? 2 : 0;
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    const composer = this.composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(innerWidth, innerHeight);
    composer.addPass(new RenderPass(this.scene, this.camera));
    {
      // 햇빛이 번지는 정도만 — 아주 약하게
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.34, 0.72, 0.86);
      composer.addPass(this.bloom);
    }
    composer.addPass(new OutputPass());
  }

  saveSettings() { saveSettings(this.settings); }

  /**
   * 해를 향해 보면 안개가 밝아지고, 등지면 가라앉는다.
   * 먼 산과 나무에 공기원근이 생겨 거리감이 살아난다.
   */
  _tintFogBySun() {
    const cam = this.camera;
    const d = this._camDir || (this._camDir = new THREE.Vector3());
    cam.getWorldDirection(d);
    const toSun = clamp01(d.dot(this.sky.sunDir) * 0.5 + 0.5);
    const warm = this._warmFog || (this._warmFog = new THREE.Color());
    warm.copy(this.sky.uniforms.uSunTint.value).lerp(this.scene.fog.color, 0.45);
    const k = Math.pow(toSun, 2.6) * (0.35 + this.sky.goldenFactor * 0.35)
      * clamp01(this.sky.sunLight.intensity * 0.5);
    this.scene.fog.color.lerp(warm, k);
  }

  /** 비가 오면 해가 가려지고 안개가 짙어지며 땅이 젖는다 */
  _applyWeatherToSky(rain) {
    const grey = this._greyFog || (this._greyFog = new THREE.Color(0x8d97a0));
    if (rain > 0.005) {
      this.sky.sunLight.intensity *= 1 - 0.72 * rain;
      this.sky.hemi.intensity *= 1 - 0.22 * rain;
      this.scene.fog.color.lerp(grey, rain * 0.6);
      this.scene.fog.far = lerp(this.scene.fog.far, 80, rain * 0.72);
      // 하늘도 함께 흐려진다
      const u = this.sky.uniforms;
      u.uZenith.value.lerp(grey, rain * 0.72);
      u.uHorizon.value.lerp(grey, rain * 0.8);
      u.uSunTint.value.lerp(grey, rain * 0.6);
      u.uHaze.value = Math.min(1, u.uHaze.value + rain * 0.5);
      this.sky.clouds.material.opacity = Math.min(1, this.sky.clouds.material.opacity + rain * 0.4);
      this.sky.sunGlow.visible = this.sky.sunGlow.visible && rain < 0.4;
    }
    const wet = clamp01(rain * 1.2);
    if (this._wet !== wet) {
      this._wet = wet;
      const m = this.terrain.material;
      m.color.setScalar(lerp(1, 0.66, wet));
      m.roughness = lerp(0.97, 0.55, wet);
      this.grass.setWet(wet);
      this.forest.blobMat.color.setScalar(lerp(1, 0.78, wet));
      if (this.forest.leafMat) this.forest.leafMat.color.setScalar(lerp(1, 0.82, wet));
      this.forest.barkMat.color.setScalar(lerp(1, 0.7, wet));
    }
  }

  togglePhoto() {
    this.photoMode = !this.photoMode;
    this.hud.setVisible(!this.photoMode);
    document.body.classList.toggle('photo', this.photoMode);
    document.getElementById('vignette').classList.toggle('photo', this.photoMode);
  }

  _bindEvents() {
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
      this.composer?.setPixelRatio(this.renderer.getPixelRatio());
      this.composer?.setSize(innerWidth, innerHeight);
      this.bloom?.setSize(innerWidth, innerHeight);
    });

    document.getElementById('btn-start').addEventListener('click', () => this.start());

    addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (!this.started) return;
        if (this.paused) this.resume(); else this.pause();
      } else if (e.code === 'KeyP') {
        this.togglePhoto();
      } else if (e.code === 'KeyM') {
        this.settings.music = !this.settings.music;
        this.hud.say(this.settings.music ? '음악을 켰다' : '음악을 껐다', 2.5);
      } else if (e.code === 'KeyH') {
        this.hud.setVisible(!this.hud.visible);
      }
    });

    document.addEventListener('pointerlockchange', () => {
      if (this.isMobile) return;
      if (document.pointerLockElement !== this.renderer.domElement && this.started && !this.paused) this.pause();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.started && !this.paused) this.pause();
    });
  }

  start() {
    this.audio.init();
    this.audio.resume();
    this.audio.setVolume('master', this.settings.master);
    this.started = true;
    this.paused = false;
    document.body.dataset.screen = 'play';
    this.menu.hide();
    if (this.isMobile) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      screen.orientation?.lock?.('landscape').catch(() => {});
    } else {
      this.renderer.domElement.requestPointerLock?.();
    }
    this.hud.showHint(this.isMobile
      ? '왼쪽 스틱으로 걷고, 화면을 끌어 둘러보세요'
      : 'WASD 이동 · Shift 달리기 · Ctrl 앉기 · R 쉬기 · P 사진 모드', 9);
    this.hud.say('숲이 당신을 기다리고 있었다.', 6);
  }

  pause() {
    this.paused = true;
    this.menu.show();
    document.exitPointerLock?.();
    this.audio.suspend();
  }

  resume() {
    this.paused = false;
    this.menu.hide();
    this.audio.resume();
    if (!this.isMobile) this.renderer.domElement.requestPointerLock?.();
  }

  onStep(surface, intensity, running, side) {
    this.audio.footstep(surface, intensity, running, side);
    if (surface === 'water') {
      this.water.splash(this.player.pos.x, this.player.pos.z, 0.5 + intensity * 0.4);
      this.discover('lake');
    }
  }

  discover(id) {
    if (this.found.has(id)) return;
    const d = DISCOVERIES.find((x) => x.id === id);
    if (!d) return;
    this.found.add(id);
    this.hud.toast(d.text, d.sub);
    this.player.calm = clamp01(this.player.calm + 0.06);
  }

  _checkDiscoveries(dt) {
    const p = this.player.pos;
    const sky = this.sky;
    if (Math.hypot(p.x - LAKE.x, p.z - LAKE.z) < LAKE.r + 6) this.discover('lake');
    if (this.player.sitting) this._sitTime = (this._sitTime || 0) + dt; else this._sitTime = 0;
    if (this._sitTime > 4) this.discover('rest');
    const near = this.wildlife.nearest(p.x, p.z);
    if (near.dist < 9 && near.animal && near.animal.state !== 'flee') this.discover('deer');
    if (sky.sunElevation > -0.02 && sky.sunElevation < 0.12 && Math.cos((sky.time - 0.25) * TAU) > 0) this.discover('sunrise');
    if (sky.sunElevation > -0.02 && sky.sunElevation < 0.12 && Math.cos((sky.time - 0.25) * TAU) < 0) this.discover('sunset');
    if (sky.night > 0.8 && this.camera.rotation.x > 0.35) this.discover('stars');
    if (sky.night > 0.6) this.discover('firefly');
    if (p.y > 30) this.discover('summit');
    if (this.weather.rainAmount > 0.4) this.discover('rain');
  }

  _loop() {
    const clock = new THREE.Clock();
    this._fpsAcc = 0; this._fpsCount = 0; this.fps = 60;
    const tick = () => {
      requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      this.renderer.info.reset();
      if (this.paused) { this._render(); return; }
      this._measure(dt);
      this.update(dt);
      this._render();
    };
    tick();
  }

  _render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** 프레임을 살펴 무거우면 스스로 가볍게, 여유로우면 도로 선명하게 */
  _measure(dt) {
    this._fpsAcc += dt; this._fpsCount++;
    if (this._fpsAcc < 1.5) return;
    this.fps = this._fpsCount / this._fpsAcc;
    this._fpsAcc = 0; this._fpsCount = 0;
    if (!this.settings.autoQuality || !this.started) return;

    const target = this.isMobile ? 30 : 50;
    if (this.fps < target && this.renderScale > 0.55) {
      this._setRenderScale(Math.max(0.55, this.renderScale - 0.12));
      this._perfNote = (this._perfNote || 0) + 1;
    } else if (this.fps > target + 16 && this.renderScale < 1) {
      this._setRenderScale(Math.min(1, this.renderScale + 0.06));
    }
    // 해상도를 낮춰도 버거우면 잔디/잎 범위를 줄인다
    if (this.fps < target - 8 && this.renderScale <= 0.57 && this.forest.q.leafDist > 14) {
      this.forest.q.leafDist = Math.max(14, this.forest.q.leafDist - 8);
      this.forest.updateLOD(this.player.pos.x, this.player.pos.z, true);
    }
  }

  _setRenderScale(v) {
    this.renderScale = v;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.pixelCap) * v);
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(innerWidth, innerHeight);
  }

  update(dt) {
    this.time += dt;
    const player = this.player;

    // 바람·비 — 보이는 것과 들리는 것이 같은 값을 쓴다
    this.weather.enabled = this.settings.rain;
    this.weather.update(dt, this.player.pos.x, this.player.pos.z, this.sky, this.water);
    this.wind = this.weather.wind;
    const gust = this.weather.gust;
    const rainAmt = this.weather.rainAmount;
    WIND.time.value += dt * (0.6 + this.weather.strength * 1.4);
    WIND.strength.value = this.weather.strength;
    WIND.dir.value.copy(this.weather.dir);

    // 타이틀 화면에서는 카메라가 천천히 골짜기를 둘러본다
    if (!this.started) player.yaw += dt * 0.03;
    player.update(dt);
    const p = player.pos;
    WIND.player.value.set(p.x, p.y, p.z);

    this.sky.update(dt, p, this.camera);
    // 식생 셰이더가 쓰는 태양 상태
    SUN.dir.value.copy(this.sky.sunDir.y > 0 ? this.sky.sunDir : this.sky.moonDir);
    SUN.color.value.copy(this.sky.sunLight.color)
      .multiplyScalar(Math.max(this.sky.sunLight.intensity * 0.22, this.sky.moonLight.intensity * 0.3));
    this._applyWeatherToSky(rainAmt);
    this.sky.setRainbow(this.weather.rainbow, p);
    this._tintFogBySun();
    if (this.weather.rainbow > 0.4) this.discover('rainbow');
    this.grass.update(p.x, p.z, this.isMobile ? 1.4 : 2.4);
    for (const layer of this.clutter) layer.update(p.x, p.z, 1);
    this.forest.updateLOD(p.x, p.z);
    this.water.update(dt, this.sky);

    const waterDist = Math.max(0, Math.hypot(p.x - LAKE.x, p.z - LAKE.z) - LAKE.r);
    const treeDensity = clamp01((fbm2(p.x * 0.0045 + 5.5, p.z * 0.0045 - 2.2, 3) * 0.5 + 0.5 - 0.3) * 2.1);

    if (this.leaves) {
      this.leaves.update(dt, p.x, p.z, 0.25 + treeDensity * 0.75,
        WIND.dir.value.x, WIND.dir.value.y, this.wind, this.camera.position.y);
    }

    const ctx = {
      player: p, stealth: player.stealth, audio: this.audio,
      night: this.sky.night, time: this.time,
    };
    this.wildlife.update(dt, ctx);

    const animalsNear = this.wildlife.calmNearby(p.x, p.z);
    player.updateCalm(dt, {
      animalsNear, waterDist,
      goldenHour: this.sky.goldenFactor > 0.5,
    });

    this.audio.update({
      dt,
      exertion: player.exertion,
      windStrength: this.wind,
      gust,
      rain: rainAmt,
      treeDensity,
      waterDist,
      night: this.sky.night,
      dayFactor: this.sky.dayFactor,
      player: p,
      yaw: player.yaw,
      moving: player.speed > 0.3,
      music: this.settings.music,
    });

    if (this.started) this._checkDiscoveries(dt);

    if (player.boundaryWarn > 0.3 && !this._warned) {
      this._warned = true;
      this.hud.say('골짜기를 벗어나면 길을 잃는다. 돌아가자.', 4);
      setTimeout(() => { this._warned = false; }, 12000);
    }

    if (this.bloom) {
      // 밤에는 달·별이 번지고, 비에는 가라앉는다
      this.bloom.strength = lerp(0.3, 0.5, this.sky.night) * (1 - rainAmt * 0.45);
    }

    if (!this.started) return;

    this.hud.update(dt, {
      yaw: player.yaw,
      clock: this.sky.clock(),
      phase: this.sky.phaseName(),
      calm: player.calm,
      stamina: player.stamina,
      sprinting: player.sprinting,
    });

    // 물안개가 짙을 때 살짝 뿌옇게
    document.getElementById('vignette').style.setProperty('--mist', (this.sky.mist * 0.35).toFixed(3));
  }
}

const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];
const PIXEL_CAP = { low: 1, medium: 1.25, high: 1.6, ultra: 2 };

function detectQuality() {
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  if (IS_MOBILE) return mem >= 6 && cores >= 8 ? 'medium' : 'low';
  if (mem <= 2 || cores <= 2) return 'low';
  if (mem <= 4 || cores <= 4) return 'medium';
  if (mem >= 8 && cores >= 8) return 'ultra';
  return 'high';
}

const DEFAULTS = {
  quality: null,             // null = 자동 판정
  master: 0.85, ambient: 0.9, sfx: 0.95, musicVol: 0.5,
  music: true, sensitivity: 1, invertY: false, fov: 68, dayLength: 900,
  autoQuality: true, rain: true,
};

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('goyo.settings') || '{}'); } catch (e) { saved = {}; }
  const s = { ...DEFAULTS, ...saved };
  if (!QUALITY_ORDER.includes(s.quality)) s.quality = detectQuality();
  return s;
}

export function saveSettings(settings) {
  try { localStorage.setItem('goyo.settings', JSON.stringify(settings)); } catch (e) { /* 저장 불가 — 무시 */ }
}

const game = new Game();
window.__goyo = game;
game.boot().catch((err) => {
  console.error(err);
  document.getElementById('loading-label').textContent = '오류: ' + err.message;
});
