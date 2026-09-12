// FREE FREELY - 메인 게임 루프 / 상태 관리
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { clamp, lerp, damp, formatTime, msToKmh, headingName, DEG } from './core/utils.js';
import { Settings } from './core/settings.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { CameraRig } from './core/camera.js';
import { World } from './world/world.js';
import { Effects } from './fx/effects.js';
import { buildCraft } from './craft/assembler.js';
import { CraftController } from './craft/pilot.js';
import { HUD } from './ui/hud.js';
import { UIManager, MISSIONS } from './ui/menu.js';
import { Builder } from './ui/builder.js';
import { PRESETS } from './craft/presets.js';
import { RUNWAY } from './world/terrain.js';

const FIXED_DT = 1 / 120;
const MAX_SUBSTEPS = 6;

class Game {
  constructor() {
    this.state = 'loading';
    this.paused = false;
    this.elapsed = 0;
    this.frameTime = 0;
    this.fps = 60;
    this.audio = Audio;
    this.craft = null;
    this.controller = null;
    this.mission = MISSIONS[0];
    this.missionState = null;
    this._accum = 0;
    this._fpsSamples = [];
    this._lastNow = performance.now();
    this._overlay = { cloud: 0, water: 0, damage: 0, flash: 0 };
  }

  /* ------------------------------ 초기화 ------------------------------ */
  async boot() {
    const canvas = document.getElementById('gl');
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: Settings.get('antialias'),
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = Settings.get('shadows');
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._applyPixelRatio();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(Settings.get('fov'), window.innerWidth / window.innerHeight, 0.35, 500000);
    this.camera.position.set(0, 300, 900);
    this.rig = new CameraRig(this.camera);

    this.input = new Input(canvas);
    this.hud = new HUD(document.getElementById('hud'));
    this.ui = new UIManager(this);

    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'flight') this.setPaused(true);
    });
    // 첫 상호작용에서 오디오 활성화 (브라우저 정책)
    const unlock = () => {
      if (!Audio.ready) {
        Audio.init();
        if (this.state === 'menu') Audio.music(true);
      }
      Audio.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    this.ui.show('screen-loading');
    this.ui.setLoading(0.01, '엔진 초기화');
    this._rotateTips();

    // 월드 생성
    this.world = new World(this.scene, this.renderer);
    this.world.onThunder = (pos) => { if (Audio.ready) Audio.thunder(pos); };
    await this.world.init((p, label) => this.ui.setLoading(0.05 + p * 0.9, label));

    this.fx = new Effects(this.scene);
    this.hud.setMap(this.world.terrain);
    this._setupComposer();
    this._bindFlightControls();
    this._bindGlobalKeys();
    this.applyOnScreenControls();

    this.ui.setLoading(1, '준비 완료');
    setTimeout(() => {
      this.state = 'menu';
      this.ui.show('screen-menu');
      this.ui.setFlightUI(false);
      if (Audio.ready) Audio.music(true);
    }, 420);

    this._loop();
  }

  _rotateTips() {
    const tips = [
      '이륙 전 플랩(F)을 내리면 더 짧은 활주로에서 뜰 수 있습니다.',
      '착륙은 강하율 −2 m/s 이하를 목표로. 기어(G)를 잊지 마세요.',
      '열기구는 버너(Space)와 배기 밸브(C)만으로 고도를 조절합니다.',
      '설계실에서 무게중심(CG)이 공력중심(AC)보다 앞에 있어야 안정적입니다.',
      '우주선은 고도 30 km 이상에서 공기 저항이 거의 사라집니다.',
      '바다에 착수할 때는 기수를 살짝 들고 최대한 느리게.',
      '초음속을 넘으면 소닉붐이 발생하고 조종면 효율이 변합니다.',
      'N 키로 1인칭·3인칭·시네마틱 시점을 자유롭게 바꿀 수 있습니다.',
    ];
    let i = 0;
    const el = document.getElementById('loading-tip');
    const set = () => { if (el) el.textContent = '💡 ' + tips[i++ % tips.length]; };
    set();
    this._tipTimer = setInterval(set, 4200);
  }

  _setupComposer() {
    const size = this.renderer.getSize(new THREE.Vector2());
    const useMsaa = Settings.get('antialias');
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: useMsaa ? 4 : 0,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.onResize();
  }

  /** 화면 조이스틱/스로틀 표시 여부 (터치 기기 자동 감지) */
  applyOnScreenControls() {
    const mode = Settings.get('onScreenControls');
    const touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    const show = mode === 'on' || (mode !== 'off' && touch);
    const stick = document.querySelector('.stick-wrap');
    const thr = document.querySelector('.throttle-wrap');
    if (stick) stick.style.display = show ? '' : 'none';
    if (thr) thr.style.display = show ? '' : 'none';
    if (this.hud) this.hud.controlsInset = show ? 158 : 0;
    this.onScreenControls = show;
  }

  _applyPixelRatio() {
    const scale = clamp(Settings.get('renderScale'), 0.5, 1.6);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1) * scale);
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.composer) this.composer.setSize(w, h);
    if (this.bloom) this.bloom.setSize(w, h);
    if (this.hud) this.hud.resize();
    if (this.builder) this.builder.resize();
  }

  onSettingsChanged(key) {
    this._applyPixelRatio();
    this.applyOnScreenControls();
    this.renderer.shadowMap.enabled = Settings.get('shadows');
    this.scene.traverse((o) => { if (o.isMesh && o.material) o.material.needsUpdate = false; });
    if (this.bloom) this.bloom.enabled = Settings.get('bloom');
    if (this.world) {
      if (key === 'weather' || key === 'cloudDensity' || key === '*') this.world.applyWeather(Settings.get('weather'));
      if (key === 'timeOfDay') this.world.setTimeOfDay(Settings.get('timeOfDay'));
      if (key === 'seaState') this.world.seaState = Settings.get('seaState');
    }
    if (Audio.ready) Audio.applyVolumes();
    this.onResize();
  }

  /* ------------------------------ 비행 시작 ------------------------------ */
  startFlight(blueprint, mission) {
    if (!this.world) return;
    const bp = blueprint || PRESETS[0];
    this.mission = mission || MISSIONS[0];
    if (this.mission.weather) {
      Settings.set('weather', this.mission.weather);
      this.world.applyWeather(this.mission.weather);
    }
    this.disposeCraft();

    this.craft = buildCraft(bp, this.scene);
    this.controller = new CraftController(this.craft, this.world, this.fx, Audio);
    this.controller.onDestroyed = (reason) => this.onCrash(reason);
    this._spawnCraft(this.mission);

    this.state = 'flight';
    this.paused = false;
    this.ui.hideAllScreens();
    this.ui.setFlightUI(true);
    this.ui.showPause(false);
    this.ui.showCrash(false);
    this.hud.visible = true;
    this.rig.setMode('chase');
    if (Audio.ready) { Audio.music(false); Audio.resume(); }
    this.missionState = this._initMission(this.mission);
    this.ui.toast(`${bp.name} — ${this.mission.name}`, 'info', 3200);
    this.controller.event('비행 준비 완료 — 스로틀(Shift)을 올려 이륙하세요');
  }

  _spawnCraft(mission) {
    const c = this.craft;
    const ctrl = this.controller;
    // 기체 최하단 위치 계산
    let minLocal = Infinity;
    for (const g of c.gears) minLocal = Math.min(minLocal, g.pos.y - g.restLength);
    for (const col of c.colliders) minLocal = Math.min(minLocal, col.pos.y - col.radius);
    if (!isFinite(minLocal)) minLocal = -1;
    const bottomOffset = minLocal - c.body.centerOfMass.y;

    let pos = new THREE.Vector3(RUNWAY.x0 + 140, 0, 0);
    let heading = 90;
    let airborne = !!mission.airborne;
    let speed = 0;
    let verticalLaunch = false;

    if (mission.id === 'carrier') {
      const car = this.world.props.carrier;
      pos.set(car.pos.x + 1400, 320, car.pos.z - 420);
      heading = 205;
      airborne = true;
      speed = Math.max(62, (c.stats.stallSpeed || 60) * 1.35);
    } else if (mission.id === 'water') {
      pos.set(RUNWAY.x0 + 140, 0, 0);
    } else if (mission.id === 'space') {
      const pad = this.world.props.spacePad;
      pos.set(pad.x, 0, pad.z);
      heading = 0;
      verticalLaunch = true;
    } else if (airborne) {
      pos.set(RUNWAY.x0 - 2600, mission.altitude || 1400, 400);
      heading = 90;
      speed = Math.max(40, (c.stats.stallSpeed || 55) * 1.35);
    }

    if (!airborne) {
      const surf = this.world.surfaceAt(pos.x, pos.z);
      pos.y = surf.height - bottomOffset + 0.08;
    }
    if (verticalLaunch) {
      // 발사대 위에 기수를 세워 배치 (로켓 수직 발사)
      const surf = this.world.surfaceAt(pos.x, pos.z);
      pos.y = surf.height + Math.max(6, c.radius * 0.75);
      ctrl.reset(pos, heading, true, 0, 84);
      ctrl.event('발사 준비 — 스로틀을 최대로 올려 로켓을 점화하세요', 'warn');
    } else {
      ctrl.reset(pos, heading, airborne, speed);
    }
    if (c.balloonVolume > 0) {
      ctrl.envelopeTemp += 110;
      ctrl.event('버너(Space)를 눌러 봉투를 가열하세요');
    }
    this.rig.pos.copy(pos).add(new THREE.Vector3(0, 20, 60));
    this.world.update(0, this.camera, true);
  }

  disposeCraft() {
    if (this.controller) this.controller.dispose();
    if (this.craft) this.scene.remove(this.craft.root);
    this.craft = null;
    this.controller = null;
    if (this.fx) this.fx.clear();
  }

  respawn() {
    if (!this.controller) return;
    this.ui.showCrash(false);
    this.fx.clear();
    this._spawnCraft(this.mission);
    this.missionState = this._initMission(this.mission);
    this.ui.toast('기체를 새로 준비했습니다', 'good');
  }

  quitToMenu() {
    this.disposeCraft();
    this.state = 'menu';
    this.ui.setFlightUI(false);
    this.ui.showPause(false);
    this.ui.showCrash(false);
    this.ui.show('screen-menu');
    this.ui.buildHangar();
    this.hud.visible = false;
    for (const k of ['cloud-overlay', 'underwater-overlay', 'damage-overlay', 'flash-overlay']) this.ui.setOverlay(k, 0);
    if (Audio.ready) { Audio.clearWarnings(); Audio.fire(false); Audio.bubbles(null, false); Audio.music(true); }
  }

  openBuilder(bp) {
    if (!this.builder) {
      this.builder = new Builder(document.getElementById('builder-root'), {
        audio: Audio,
        onLaunch: (blueprint) => {
          this.builder.hide();
          this.startFlight(blueprint, MISSIONS[0]);
        },
        onExit: () => {
          this.builder.hide();
          this.state = 'menu';
          this.ui.show('screen-menu');
          this.ui.buildHangar();
          if (Audio.ready) Audio.music(true);
        },
      });
    }
    this.disposeCraft();
    this.state = 'builder';
    this.ui.hideAllScreens();
    this.ui.setFlightUI(false);
    this.hud.visible = false;
    this.builder.show();
    if (bp) { this.builder.setBlueprint(bp); this.builder._renderInspector(); }
    document.body.dataset.screen = 'builder';
  }

  setPaused(p) {
    if (this.state !== 'flight') return;
    this.paused = p;
    this.ui.showPause(p);
    if (Audio.ready) {
      Audio.setMuted(p);
      if (p) Audio.clearWarnings();
    }
    if (p) this.input.exitPointerLock();
  }

  onCrash(reason) {
    const s = this.controller.score;
    this.ui.showCrash(true, {
      reason,
      time: formatTime(s.flightTime),
      distance: (s.distance / 1000).toFixed(2) + ' km',
      maxAlt: Math.round(s.maxAlt) + ' m',
      maxSpeed: Math.round(msToKmh(s.maxSpeed)) + ' km/h',
      landings: String(s.landings),
    });
    this.rig.setMode('cinematic');
  }

  /* ------------------------------ 임무 로직 ------------------------------ */
  _initMission(m) {
    for (const r of this.world.props.rings) r.passed = false;
    return {
      id: m.id, time: 0, next: 0, complete: false, holdTime: 0, message: '',
      startPos: this.craft ? this.craft.body.position.clone() : new THREE.Vector3(),
    };
  }

  _updateMission(dt) {
    const ms = this.missionState;
    if (!ms || !this.controller || this.controller.destroyed) return;
    const t = this.controller.telemetry;
    const body = this.craft.body;
    ms.time += dt;
    const finish = (msg, record) => {
      if (ms.complete) return;
      ms.complete = true;
      ms.message = msg;
      this.ui.toast('임무 완료! ' + msg, 'good', 5200);
      this.controller.event('임무 완료 — ' + msg, 'good');
      if (Audio.ready) Audio.ui('confirm');
      if (record) {
        const key = 'freefreely.best.' + ms.id;
        const prev = localStorage.getItem(key);
        if (!prev || record.localeCompare(prev) < 0) {
          try { localStorage.setItem(key, record); } catch (e) { /* 무시 */ }
        }
        this.ui.buildMissions();
      }
    };

    switch (ms.id) {
      case 'rings': {
        const rings = this.world.props.rings;
        const target = rings[ms.next];
        if (target) {
          const d = body.position.distanceTo(target.mesh.position);
          if (d < target.radius) {
            target.passed = true;
            ms.next++;
            if (Audio.ready) Audio.ui('radio');
            this.controller.event(`링 ${ms.next}/${rings.length} 통과 — ${formatTime(ms.time)}`, 'good');
            if (ms.next >= rings.length) finish(`전 구간 ${formatTime(ms.time)}`, formatTime(ms.time));
          }
        }
        break;
      }
      case 'carrier': {
        const deck = this.world.props.deckHeightAt(body.position.x, body.position.z);
        if (deck !== null && t.onGround && t.tas < 9) finish('항공모함 착함 성공');
        break;
      }
      case 'balloon': {
        if (t.alt > 1200 && t.alt < 1800) {
          ms.holdTime += dt;
          if (ms.holdTime > 180) finish('고도 유지 3분 달성');
        } else ms.holdTime = Math.max(0, ms.holdTime - dt * 0.5);
        break;
      }
      case 'space': {
        if (t.alt > 100000) finish('고도 100 km 우주 경계 돌파');
        break;
      }
      case 'storm': {
        if (t.onRunway && t.onGround && t.tas < 12) finish('폭풍 속 무사 착륙');
        break;
      }
      case 'water': {
        if (t.inWater && t.tas < 8.4 && t.integrity > 40) finish('수상 착륙 성공');
        break;
      }
      case 'glide': {
        if (ms.time > 300) finish('5분 활공 달성 — 비행거리 ' + (this.controller.score.distance / 1000).toFixed(1) + ' km');
        break;
      }
      default: break;
    }
  }

  _missionHud() {
    const ms = this.missionState;
    if (!ms || this.mission.id === 'free') return null;
    const t = this.controller.telemetry;
    let subtitle = this.mission.detail;
    if (ms.id === 'rings') subtitle = `링 ${ms.next} / ${this.world.props.rings.length} 통과`;
    else if (ms.id === 'balloon') subtitle = `1,200~1,800 m 유지 ${Math.floor(ms.holdTime)} / 180 초 (현재 ${Math.round(t.alt)} m)`;
    else if (ms.id === 'space') subtitle = `고도 ${(t.alt / 1000).toFixed(1)} / 100 km`;
    else if (ms.id === 'glide') subtitle = `비행 ${formatTime(ms.time)} / 05:00 · 거리 ${(this.controller.score.distance / 1000).toFixed(1)} km`;
    else if (ms.id === 'carrier') subtitle = '갑판에 착함 후 정지';
    if (ms.complete) subtitle = '✔ ' + ms.message;
    return { title: this.mission.icon + ' ' + this.mission.name, subtitle, time: ms.id === 'rings' || ms.id === 'glide' ? ms.time : undefined };
  }

  /* ---------------------------- 입력 / 버튼 UI ---------------------------- */
  _bindFlightControls() {
    // 화면 버튼 (작동 버튼)
    const buttons = [
      ['gear', '착륙장치', 'G'], ['flapsDown', '플랩▼', 'F'], ['flapsUp', '플랩▲', 'V'],
      ['brake', '브레이크', 'B'], ['airbrake', '에어브레이크', 'X'], ['afterburner', 'A/B', 'Tab'],
      ['burner', '버너/로켓', 'Space'], ['vent', '배기', 'C'], ['lights', '조명', 'L'],
      ['autopilot', '자동조종', 'H'], ['camera', '시점', 'N'], ['lookBack', '후방', 'M'],
      ['fire', '발사', 'J'], ['flare', '플레어', 'K'], ['chute', '낙하산', 'P'],
      ['engineToggle', '엔진', 'I'], ['respawn', '리스폰', 'O'], ['pause', '메뉴', 'ESC'],
    ];
    const wrap = document.getElementById('flight-buttons');
    if (wrap) {
      wrap.innerHTML = '';
      for (const [action, label, key] of buttons) {
        const b = document.createElement('button');
        b.className = 'act-btn';
        b.dataset.btn = action;
        b.innerHTML = `<span class="ab-label">${label}</span><span class="ab-key">${key}</span>`;
        wrap.appendChild(b);
        const toggleLike = ['gear', 'flapsDown', 'flapsUp', 'lights', 'autopilot', 'camera', 'chute',
          'engineToggle', 'respawn', 'pause', 'flare'].includes(action);
        this.input.attachButton(b, action, { toggle: toggleLike });
      }
    }
    // 스로틀 슬라이더
    const slider = document.getElementById('throttle-slider');
    if (slider) {
      const update = () => this.input.setVirtualAxis('throttle', parseFloat(slider.value));
      slider.addEventListener('input', update);
      slider.addEventListener('pointerup', update);
      this.throttleSlider = slider;
    }
    // 가상 조이스틱
    const pad = document.getElementById('stick-pad');
    if (pad) {
      const knob = pad.querySelector('.stick-knob');
      let active = false;
      const setFromEvent = (e) => {
        const r = pad.getBoundingClientRect();
        const nx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
        const ny = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
        this.input.setVirtualAxis('roll', nx);
        this.input.setVirtualAxis('pitch', -ny);
        if (knob) knob.style.transform = `translate(${nx * 38}px, ${ny * 38}px)`;
      };
      pad.addEventListener('pointerdown', (e) => { active = true; pad.setPointerCapture(e.pointerId); setFromEvent(e); });
      pad.addEventListener('pointermove', (e) => { if (active) setFromEvent(e); });
      const end = () => {
        active = false;
        this.input.setVirtualAxis('roll', 0);
        this.input.setVirtualAxis('pitch', 0);
        if (knob) knob.style.transform = 'translate(0,0)';
      };
      pad.addEventListener('pointerup', end);
      pad.addEventListener('pointercancel', end);
      pad.addEventListener('pointerleave', () => { if (active) end(); });
    }
  }

  _bindGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.state === 'flight') this.setPaused(!this.paused);
        else if (this.state === 'builder') { /* 설계실은 자체 UI 사용 */ }
        else if (this.ui.screen !== 'screen-menu') this.ui.show('screen-menu');
      }
      if (this.state !== 'flight' || this.paused) return;
      if (e.code === 'KeyN') {
        const name = this.rig.cycle();
        this.ui.toast('시점: ' + name);
        if (Audio.ready) { Audio.ui('click'); Audio.setCabin(this.rig.isInterior, this.craft && this.craft.cockpit ? this.craft.cockpit.closed : true); }
      }
      if (e.code === 'KeyZ') this.hud.mapZoom = this.hud.mapZoom >= 4 ? 1 : this.hud.mapZoom * 2;
      if (e.code === 'KeyU') {
        this.world.setTimeOfDay(this.world.timeOfDay + 1);
        this.ui.toast('시각 ' + this._clockString());
      }
      if (e.code === 'KeyO') this.respawn();
      if (e.code === 'F2') this.hud.visible = !this.hud.visible;
    });
  }

  _clockString() {
    const t = this.world ? this.world.timeOfDay : 12;
    const h = Math.floor(t), m = Math.floor((t - h) * 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  /**
   * 자동화 테스트용 결정론적 시뮬레이션 진행 (렌더 없이 물리만).
   * 브라우저 콘솔에서 __FREEFREELY__.debugStep(10) 처럼 호출할 수 있다.
   */
  debugStep(seconds = 1) {
    if (this.state !== 'flight' || !this.controller) return null;
    const n = Math.max(1, Math.floor(seconds / FIXED_DT));
    for (let i = 0; i < n; i++) {
      this.input.update(FIXED_DT);
      this.controller.readInput(this.input, FIXED_DT);
      this.controller.update(FIXED_DT);
      this.input.endFrame();
      if (i % 8 === 0) {
        const bigDt = FIXED_DT * 8;
        this.world.update(bigDt, this.camera);
        this.fx.update(bigDt, this.camera, this.world);
        this.rig.update(bigDt, this.craft, this.controller.telemetry, null, this.world, this.fx.shake);
        this._updateMission(bigDt);
      }
    }
    return this.controller.telemetry;
  }

  /* -------------------------------- 루프 -------------------------------- */
  _loop() {
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      let dt = (now - this._lastNow) / 1000;
      this._lastNow = now;
      dt = Math.min(dt, 0.1);
      this.frameTime = dt;
      this._fpsSamples.push(1 / Math.max(0.0005, dt));
      if (this._fpsSamples.length > 30) this._fpsSamples.shift();
      this.fps = Math.round(this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length);

      if (this.state === 'builder') { this.input.endFrame(); return; }

      this.elapsed += dt;
      this.input.update(dt);

      if (this.state === 'menu' || this.state === 'loading') {
        this._updateMenuScene(dt);
      } else if (this.state === 'flight') {
        if (!this.paused) this._updateFlight(dt);
        else if (this.world) this.world.update(0, this.camera);
      }

      this._render();
      this.input.endFrame();
    };
    loop();
  }

  _updateMenuScene(dt) {
    if (!this.world) return;
    this.rig.menuOrbit(dt, this.elapsed * 0.6, this.world, new THREE.Vector3(200, 420, 200));
    this.world.update(dt, this.camera);
    this.fx.update(dt, this.camera, this.world);
    if (Audio.ready) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      Audio.updateListener(this.camera.position, fwd, up);
      Audio.updateAtmos({ airspeed: 14, density: 1, stall: 0 });
    }
  }

  _updateFlight(dt) {
    const ctrl = this.controller;
    if (!ctrl) return;
    ctrl.readInput(this.input, dt);

    // 고정 스텝 물리
    this._accum += dt;
    let steps = 0;
    while (this._accum >= FIXED_DT && steps < MAX_SUBSTEPS) {
      ctrl.update(FIXED_DT);
      this._accum -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) this._accum = 0;

    this.world.update(dt, this.camera);
    this._updateMission(dt);
    this.fx.update(dt, this.camera, this.world);
    this.rig.update(dt, this.craft, ctrl.telemetry, this.input, this.world, this.fx.shake);

    // 리스너 갱신
    if (Audio.ready) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      Audio.updateListener(this.camera.position, fwd, up, this.craft.body.velocity);
      Audio.setCabin(this.rig.isInterior, this.craft.cockpit ? this.craft.cockpit.closed : true);
    }

    // 화면 오버레이
    const t = ctrl.telemetry;
    const inCloud = this.world.inCloud || 0;
    this._overlay.cloud = damp(this._overlay.cloud, this.rig.isInterior ? inCloud * 0.75 : inCloud * 0.45, 0.001, dt);
    this._overlay.water = damp(this._overlay.water, this.world.underwater ? 0.85 : 0, 0.001, dt);
    const dmg = clamp(1 - t.integrity / 45, 0, 1) * 0.55 + clamp(Math.abs(t.g) / 12, 0, 1) * 0.25 + clamp(t.reentry, 0, 1) * 0.4;
    this._overlay.damage = damp(this._overlay.damage, dmg, 0.001, dt);
    this._overlay.flash = Math.max(0, this._overlay.flash - dt * 2.4);
    this.ui.setOverlay('cloud-overlay', this._overlay.cloud);
    this.ui.setOverlay('underwater-overlay', this._overlay.water);
    this.ui.setOverlay('damage-overlay', this._overlay.damage);
    this.ui.setOverlay('flash-overlay', this._overlay.flash);

    // 이벤트 → HUD 로그
    while (ctrl.events.length) {
      const e = ctrl.events.shift();
      this.hud.pushEvent(e);
    }

    // 상단 정보 + 버튼 상태
    const wind = this.world.env.wind;
    this.ui.updateFlightTop({
      craft: this.craft.name,
      mission: this.mission.name + (this.missionState && this.missionState.complete ? ' ✔' : ''),
      clock: this._clockString(),
      weather: { clear: '맑음', cloudy: '구름', overcast: '흐림', storm: '폭풍' }[this.world.weather] || '맑음',
      wind: `${headingName((Math.atan2(wind.x, -wind.z) / DEG + 360) % 360)} ${wind.length().toFixed(1)} m/s`,
      camera: this.rig.mode === 'cockpit' ? '1인칭' : this.rig.mode === 'chase' ? '3인칭' : this.rig.mode,
      fps: this.fps,
    });
    this.ui.setButtonState('gear', t.gear > 0.5);
    this.ui.setButtonState('lights', t.lights);
    this.ui.setButtonState('autopilot', t.autopilot !== 'off');
    this.ui.setButtonState('afterburner', t.afterburner);
    this.ui.setButtonState('airbrake', t.airbrake);
    this.ui.setButtonState('brake', t.brake > 0.5);
    this.ui.setButtonState('burner', ctrl.burnerOn);
    this.ui.setButtonState('engineToggle', t.engineOn);
    if (this.throttleSlider && document.activeElement !== this.throttleSlider) {
      this.throttleSlider.value = String(t.throttle);
    }
    if (this.fx.shake > 0.4) this._overlay.flash = Math.max(this._overlay.flash, clamp(this.fx.shake * 0.3, 0, 0.5));
  }

  /* ------------------------------- 렌더링 ------------------------------- */
  _render() {
    if (this.state === 'builder') return;
    const useBloom = Settings.get('bloom') && this.composer;
    if (useBloom) {
      if (this.bloom) this.bloom.enabled = true;
      this.composer.render();
    } else {
      if (this.bloom) this.bloom.enabled = false;
      this.renderer.render(this.scene, this.camera);
    }
    // HUD
    if (this.state === 'flight' && this.controller && this.hud.visible) {
      const t = this.controller.telemetry;
      const ctx2 = { dt: this.frameTime, rings: this.world.props.rings, mission: this._missionHud() };
      // 속도 벡터 마커 투영
      if (t.tas > 6) {
        const p = this.craft.body.position.clone().addScaledVector(this.craft.body.velocity.clone().normalize(), 220);
        const v = p.project(this.camera);
        if (v.z < 1) {
          ctx2.fpv = { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
        }
      }
      ctx2.hasGuns = this.craft.weapons.length > 0;
      this.hud.render(t, ctx2);
    } else {
      this.hud.render(null);
    }
  }
}

void lerp;

const game = new Game();
window.__FREEFREELY__ = game;
game.boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading-label');
  if (el) el.innerHTML = '초기화 오류: ' + err.message + '<br><small>브라우저가 WebGL2를 지원하는지 확인하세요.</small>';
});
