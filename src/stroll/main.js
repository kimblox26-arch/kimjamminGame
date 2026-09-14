// 고요(GOYO) — 숲 속 1인칭 힐링 산책
import * as THREE from 'three';
import { clamp, clamp01, lerp, rand, TAU } from '../core/utils.js';
import { damp } from './util.js';
import { Terrain, fbm2, LAKE } from './terrain.js';
import { Sky } from './sky.js';
import { Water } from './water.js';
import { GrassField, buildForest, buildClutter, WIND } from './flora.js';
import { Wildlife } from './fauna.js';
import { Player, ObstacleGrid } from './player.js';
import { Audio } from './audio.js';
import { HUD, Menu } from './ui.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const DISCOVERIES = [
  { id: 'lake', text: '호숫가에 닿았다', sub: '물결이 발끝에서 번진다' },
  { id: 'deer', text: '사슴을 가까이서 보았다', sub: '숨을 죽이면 더 가까이 갈 수 있다' },
  { id: 'sunrise', text: '해가 떠오르는 것을 보았다', sub: '' },
  { id: 'sunset', text: '노을을 바라보았다', sub: '' },
  { id: 'stars', text: '별이 가득한 하늘을 보았다', sub: '' },
  { id: 'firefly', text: '반딧불이를 만났다', sub: '' },
  { id: 'summit', text: '언덕 꼭대기에 올랐다', sub: '계곡 전체가 내려다보인다' },
  { id: 'rest', text: '잠시 앉아 쉬었다', sub: 'R 키로 언제든 앉을 수 있다' },
];

class Game {
  constructor() {
    this.settings = {
      quality: detectQuality(),
      master: 0.85, ambient: 0.9, sfx: 0.95, musicVol: 0.5,
      music: true, sensitivity: 1, invertY: false, fov: 68, dayLength: 900,
    };
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
      canvas, antialias: this.settings.quality !== 'low', powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, this.settings.quality === 'low' ? 1 : 1.6));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.08, 5200);
    this.scene.add(this.camera);

    const prog = (p, label) => {
      document.getElementById('loading-bar').style.width = `${Math.round(p * 100)}%`;
      if (label) document.getElementById('loading-label').textContent = label;
    };

    prog(0.02, '골짜기를 빚는 중');
    this.terrain = new Terrain(this.scene, this.settings.quality);
    await this.terrain.build((p) => prog(0.02 + p * 0.45, '골짜기를 빚는 중'), nextFrame);

    prog(0.5, '호수에 물을 채우는 중');
    await nextFrame();
    this.water = new Water(this.scene, this.terrain.bakeLakeDepth());

    prog(0.56, '나무를 심는 중');
    await nextFrame();
    this.forest = buildForest(this.scene, this.settings.quality);

    prog(0.74, '풀과 꽃을 뿌리는 중');
    await nextFrame();
    this.grass = new GrassField(this.scene, this.settings.quality);
    this.clutter = buildClutter(this.scene, this.settings.quality);

    prog(0.82, '하늘을 여는 중');
    await nextFrame();
    this.sky = new Sky(this.scene, renderer, { time: 0.29, dayLength: this.settings.dayLength });
    this.sky.setShadowQuality(this.settings.quality);

    prog(0.88, '동물을 부르는 중');
    await nextFrame();
    this.wildlife = new Wildlife(this.scene, {
      quality: this.settings.quality, trees: this.forest.trees, water: this.water,
    });

    prog(0.94, '오솔길을 내는 중');
    await nextFrame();
    const obstacles = new ObstacleGrid(10);
    for (const [x, z, , , sc] of this.forest.trees) obstacles.add(x, z, 0.42 * sc);
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
    this.grass.prime(this.player.pos.x, this.player.pos.z);
    for (const layer of this.clutter) layer.prime(this.player.pos.x, this.player.pos.z);

    this.hud = new HUD();
    this.menu = new Menu(this);

    prog(1, '준비되었다');
    await nextFrame();

    this._bindEvents();
    document.body.dataset.screen = 'title';
    document.getElementById('loading').classList.add('done');
    this._loop();
  }

  _bindEvents() {
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    document.getElementById('btn-start').addEventListener('click', () => this.start());

    addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (!this.started) return;
        if (this.paused) this.resume(); else this.pause();
      } else if (e.code === 'KeyP') {
        this.photoMode = !this.photoMode;
        this.hud.setVisible(!this.photoMode);
        document.getElementById('vignette').classList.toggle('photo', this.photoMode);
      } else if (e.code === 'KeyM') {
        this.settings.music = !this.settings.music;
        this.hud.say(this.settings.music ? '음악을 켰다' : '음악을 껐다', 2.5);
      } else if (e.code === 'KeyH') {
        this.hud.setVisible(!this.hud.visible);
      }
    });

    document.addEventListener('pointerlockchange', () => {
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
    this.renderer.domElement.requestPointerLock?.();
    this.hud.showHint('WASD 이동 · Shift 달리기 · Ctrl 앉기 · R 쉬기 · P 사진 모드', 9);
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
    this.renderer.domElement.requestPointerLock?.();
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
  }

  _loop() {
    const clock = new THREE.Clock();
    const tick = () => {
      requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (this.paused) { this.renderer.render(this.scene, this.camera); return; }
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  update(dt) {
    this.time += dt;
    const player = this.player;

    // 바람 — 천천히 변하는 세기
    if ((this._windT = (this._windT || 0) - dt) <= 0) {
      this._windT = rand(4, 14);
      this.windTarget = rand(0.18, 1);
    }
    this.wind = damp(this.wind, this.windTarget, 0.35, dt);
    WIND.time.value += dt * (0.6 + this.wind * 0.9);
    WIND.strength.value = 0.22 + this.wind * 0.85;
    WIND.dir.value.set(Math.cos(this.time * 0.017), Math.sin(this.time * 0.017)).normalize();

    // 타이틀 화면에서는 카메라가 천천히 골짜기를 둘러본다
    if (!this.started) player.yaw += dt * 0.03;
    player.update(dt);
    const p = player.pos;
    WIND.player.value.set(p.x, p.y, p.z);

    this.sky.update(dt, p, this.camera);
    this.grass.update(p.x, p.z, 2);
    this.grass.syncLighting(this.sky);
    for (const layer of this.clutter) layer.update(p.x, p.z, 1);
    this.water.update(dt, this.sky);

    const waterDist = Math.max(0, Math.hypot(p.x - LAKE.x, p.z - LAKE.z) - LAKE.r);
    const treeDensity = clamp01((fbm2(p.x * 0.0045 + 5.5, p.z * 0.0045 - 2.2, 3) * 0.5 + 0.5 - 0.3) * 2.1);

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

function detectQuality() {
  const mem = navigator.deviceMemory || 4;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile || mem <= 2) return 'low';
  if (mem <= 4) return 'medium';
  return 'high';
}

const game = new Game();
window.__goyo = game;
game.boot().catch((err) => {
  console.error(err);
  document.getElementById('loading-label').textContent = '오류: ' + err.message;
});
