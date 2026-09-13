// ORBITER — 게임 오케스트레이터
// 씬 전환, 입력 라우팅, 물리 스텝, 타임워프, 저장/불러오기, 임무 추적을 묶는다.

import {
  clamp,
  clamp01,
  Vec2,
  vLen,
  vNorm,
  formatTime,
  formatDistance,
  formatSpeed,
  formatMass,
} from '../core/math.js';
import { GameLoop, Scheduler } from '../core/loop.js';
import { bus, EVT, StateMachine } from '../core/events.js';
import { InputManager } from '../core/input.js';
import {
  loadSettings,
  saveSettings,
  loadProgress,
  saveProgress,
  updateRecord,
  addRecord,
  writeSave,
  readSave,
  listSaves,
  autosave,
  QUICKSAVE_ID,
  saveBlueprint,
  loadBlueprint,
  listBlueprints,
} from '../core/storage.js';
import {
  WARP_LEVELS,
  DIFFICULTY,
  SITUATION,
  SITUATION_LABEL,
} from '../physics/constants.js';
import { createSolarSystem, launchSitesOf } from '../world/system.js';
import { SurfaceProps } from '../world/terrain.js';
import { Craft } from '../build/craft.js';
import { buildPreset, presetCatalog } from '../build/presets.js';
import { Builder } from '../build/builder.js';
import { Vessel } from '../flight/vessel.js';
import { Autopilot, AP_MODE } from '../flight/autopilot.js';
import { ManeuverPlanner, relativeMotion } from '../flight/maneuver.js';
import { shouldAutoStage } from '../flight/staging.js';
import { Camera, CAMERA_MODE } from '../render/camera.js';
import { FlightRenderer } from '../render/renderer.js';
import { HUD } from '../render/hud.js';
import { MapView } from '../render/mapview.js';
import { audio } from '../audio/audio.js';
import { MissionTracker, MISSIONS, availableMissions } from './missions.js';

export class Game {
  constructor(dom) {
    this.dom = dom;
    this.settings = loadSettings();
    this.progress = loadProgress();
    this.difficulty = DIFFICULTY[this.settings.gameplay.difficulty] ?? DIFFICULTY.normal;

    /* 세계 */
    this.system = createSolarSystem();
    this.universeTime = 0;
    this.home = this.system.home;
    this.launchSites = launchSitesOf(this.home);
    this.launchSite = this.launchSites[0];
    this.home.surfaceProps = new SurfaceProps(this.home);
    for (const site of this.launchSites) {
      // 발사장 주변 지형을 평탄하게 깎아 둔다 (산꼭대기에서 발사되는 일이 없도록)
      this.home.terrain.addFlatZone(site.angle, 0.0016, 0.02, site.altitude);
      this.home.surfaceProps.addLaunchSite(site);
    }

    /* 입력 */
    this.input = new InputManager(window, { canvas: dom.flightCanvas });
    if (this.settings.controls.bindings) {
      Object.assign(this.input.bindings, this.settings.controls.bindings);
    }

    /* 렌더 */
    this.camera = new Camera(dom.flightCanvas);
    this.renderer = new FlightRenderer(dom.flightCanvas);
    this.hud = new HUD(dom.hudCanvas);
    this.mapView = new MapView(dom.mapCanvas);
    this.builder = new Builder(dom.buildCanvas, this.input, {
      onChange: () => this.refreshBuildPanels(),
    });

    /* 비행 상태 */
    this.vessel = null;
    this.autopilot = null;
    this.planner = new ManeuverPlanner();
    this.vessels = [];
    this.target = null;
    this.targetBody = null;
    this.warpIndex = 0;
    this.mapOpen = false;
    this.paused = false;
    this.flightLog = [];

    /* 임무 */
    this.missions = new MissionTracker(this.progress);

    /* 루프 */
    this.scheduler = new Scheduler();
    this.loop = new GameLoop({
      fixedDt: 1 / 90,
      maxSteps: 6,
      onFixedUpdate: (dt, t) => this.fixedUpdate(dt, t),
      onUpdate: (dt) => this.update(dt),
      onRender: () => this.render(),
      onStats: (s) => this.onStats(s),
    });

    this.scene = new StateMachine('loading');
    this.setupScenes();
    this.setupEvents();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /* ──────────────────────────────────────────────────────────
   * 씬
   * ────────────────────────────────────────────────────────── */

  setupScenes() {
    const setScreen = (name) => {
      document.body.dataset.screen = name;
    };

    this.scene
      .add('loading', {
        enter: () => setScreen('screen-loading'),
      })
      .add('menu', {
        enter: () => {
          setScreen('screen-menu');
          this.loop.setTimeScale(1);
          audio.startMusic('space');
        },
        exit: () => audio.stopMusic(1.2),
      })
      .add('hangar', {
        enter: () => {
          setScreen('screen-hangar');
          this.refreshHangar();
        },
      })
      .add('builder', {
        enter: () => {
          setScreen('screen-builder');
          this.resize();
          this.builder.renderCategories(this.dom.buildCategories);
          this.builder.paletteEl = this.dom.buildPalette;
          this.builder.renderPalette(this.dom.buildPalette);
          this.refreshBuildPanels();
        },
      })
      .add('missions', {
        enter: () => {
          setScreen('screen-missions');
          this.refreshMissionList();
        },
      })
      .add('flight', {
        enter: () => {
          setScreen('screen-flight');
          this.resize();
        },
      })
      .add('settings', {
        enter: () => {
          setScreen('screen-settings');
          this.refreshSettingsPanel();
        },
      })
      .add('results', {
        enter: (payload) => {
          setScreen('screen-results');
          this.showResults(payload);
        },
      })
      .add('bodies', {
        enter: () => {
          setScreen('screen-bodies');
          this.refreshBodyGuide();
        },
      });

    this.scene.start();
  }

  go(sceneName, payload) {
    this.scene.change(sceneName, payload);
    bus.emit(EVT.SCENE_CHANGE, { scene: sceneName });
  }

  /* ──────────────────────────────────────────────────────────
   * 이벤트 연결
   * ────────────────────────────────────────────────────────── */

  setupEvents() {
    bus.on(EVT.TOAST, (p) => this.hud.toast(p.text, p.kind ?? 'info'));

    bus.on(EVT.STAGE, () => {
      audio.play('stage');
      this.camera.addShake(6);
      if (this.vessel?.lastDebris) {
        this.renderer.addDebris(this.vessel.lastDebris);
        this.vessel.lastDebris = null;
      }
      this.log('스테이지 분리');
    });

    bus.on(EVT.LAUNCH, () => {
      this.log('발사!');
      this.camera.addShake(10);
      addRecord(this.progress, 'totalLaunches');
    });

    bus.on(EVT.CHUTE_DEPLOY, () => {
      audio.play('chute');
      this.log('낙하산 전개');
    });

    bus.on(EVT.LANDED, (p) => {
      audio.play('touchdown', { scale: clamp01(p.speed / 12) });
      this.log(`${p.body.name} 착륙 — 접지속도 ${p.speed.toFixed(1)} m/s`);
      addRecord(this.progress, 'totalLandings');
      if (!this.progress.landedBodies.includes(p.body.id)) {
        this.progress.landedBodies.push(p.body.id);
        bus.emit(EVT.TOAST, {
          text: `${p.body.name} 최초 착륙!`,
          kind: 'success',
        });
      }
      // 깃발
      if (p.body.surfaceProps && this.vessel) {
        p.body.surfaceProps.plantFlag(
          this.vessel.landedTheta ?? 0,
          this.vessel.name,
          this.vessel.missionTime
        );
      }
    });

    bus.on(EVT.SPLASHDOWN, (p) => {
      audio.play('splash');
      this.log(`착수 — ${p.speed.toFixed(1)} m/s`);
    });

    bus.on(EVT.CRASH, (p) => {
      audio.play('explosion', { scale: 1.4 });
      this.camera.addShake(26);
      const bodyWorld = p.body.absolutePositionAt(this.universeTime);
      this.renderer.explodeAt(
        bodyWorld.x + p.pos.x,
        bodyWorld.y + p.pos.y,
        1.6,
        this.vessel?.vel
      );
      this.log(`충돌 — ${p.speed.toFixed(0)} m/s`);
      addRecord(this.progress, 'totalCrashes');
    });

    bus.on(EVT.DESTROYED, (p) => {
      this.log(`기체 상실: ${p.reason}`);
      audio.play('fail');
      this.scheduler.after(3, () => this.endFlight('destroyed'));
    });

    bus.on(EVT.SOI_CHANGE, (p) => {
      this.log(`${p.from.name} → ${p.to.name} 영향권 진입`);
      bus.emit(EVT.TOAST, {
        text: `${p.to.name} 영향권 진입`,
        kind: 'info',
      });
      if (!this.progress.visitedBodies.includes(p.to.id)) {
        this.progress.visitedBodies.push(p.to.id);
      }
      this.planner.clear();
    });

    bus.on(EVT.ORBIT_ACHIEVED, (p) => {
      this.log(`${p.body.name} 궤도 진입`);
      audio.play('success');
      if (!this.progress.orbitedBodies.includes(p.body.id)) {
        this.progress.orbitedBodies.push(p.body.id);
      }
    });

    bus.on(EVT.PART_DESTROYED, (p) => {
      audio.play('explosion', { scale: 0.5 });
      this.camera.addShake(8);
      this.log(`${p.part.def.name} ${p.reason}`);
    });

    bus.on(EVT.ENGINE_FLAMEOUT, (p) => {
      this.log(`${p.part.def.name} 연소 종료`);
    });

    bus.on(EVT.FUEL_LOW, () => {
      audio.play('warning');
      bus.emit(EVT.TOAST, { text: '연료 부족', kind: 'warn' });
    });

    bus.on(EVT.MAXQ, (p) => {
      this.log(`max Q 통과 (${(p.q / 1000).toFixed(1)} kPa)`);
    });

    bus.on(EVT.MISSION_COMPLETE, () => {
      audio.play('success');
      saveProgress(this.progress);
    });

    bus.on(EVT.ACHIEVEMENT, () => {
      audio.play('success');
      saveProgress(this.progress);
    });
  }

  log(text) {
    const entry = {
      t: this.vessel?.missionTime ?? 0,
      text,
    };
    this.flightLog.push(entry);
    if (this.flightLog.length > 200) this.flightLog.shift();
    if (this.dom.flightLog) {
      const el = document.createElement('div');
      el.className = 'log-entry';
      el.innerHTML = `<span>${formatTime(entry.t, true)}</span> ${text}`;
      this.dom.flightLog.prepend(el);
      while (this.dom.flightLog.childElementCount > 40) {
        this.dom.flightLog.lastElementChild.remove();
      }
    }
  }

  /* ──────────────────────────────────────────────────────────
   * 리사이즈
   * ────────────────────────────────────────────────────────── */

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;

    for (const canvas of [
      this.dom.flightCanvas,
      this.dom.hudCanvas,
      this.dom.mapCanvas,
    ]) {
      if (!canvas) continue;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.camera.resize(w, h, dpr);
    this.hud.resize(w, h, dpr);
    this.mapView.resize(w, h, dpr);

    // 설계실 캔버스는 컨테이너 크기에 맞춘다
    const bc = this.dom.buildCanvas;
    if (bc) {
      const rect = bc.parentElement.getBoundingClientRect();
      bc.width = Math.floor(rect.width * dpr);
      bc.height = Math.floor(rect.height * dpr);
      bc.style.width = `${rect.width}px`;
      bc.style.height = `${rect.height}px`;
      bc.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
      this.builder.resize(rect.width, rect.height);
    }
  }

  onStats(s) {
    if (this.dom.fpsCounter && this.settings.graphics.showFps) {
      this.dom.fpsCounter.textContent = `${s.fps.toFixed(0)} FPS · ${s.physicsMs.toFixed(1)}ms 물리 · ${this.renderer.particles.count} 입자`;
    }
  }

  /* ──────────────────────────────────────────────────────────
   * 시작 / 발사
   * ────────────────────────────────────────────────────────── */

  start() {
    this.loop.start();
    this.applyGraphicsSettings();
    this.scheduler.after(0.6, () => this.go('menu'));
  }

  applyGraphicsSettings() {
    const q = this.settings.graphics.quality;
    const level = q === 'low' ? 0 : q === 'medium' ? 1 : q === 'high' ? 3 : 2;
    this.renderer.setQuality(level);
    this.renderer.starfield.enabled = this.settings.graphics.starfield;
    this.renderer.showTrajectory = this.settings.graphics.showTrajectoryPrediction;
    this.camera.shakeIntensity = this.settings.graphics.screenShake;
  }

  /**
   * 기체를 발사대에 올린다.
   * @param {object} opts
   *   body        발사할 천체 (기본: 모성)
   *   site        발사장
   *   startInOrbit 지표 대신 원궤도에서 시작 (착륙선·정거장·행성간선용)
   *   altitude    궤도 시작 고도
   */
  launch(craft, opts = {}) {
    if (!craft || !craft.parts.length) {
      bus.emit(EVT.TOAST, { text: '발사할 기체가 없습니다', kind: 'warn' });
      return false;
    }
    const body = opts.body ?? this.home;
    const site = opts.site ?? this.launchSite;

    const validation = craft.validate(body, { orbital: !!opts.startInOrbit });
    if (!validation.ok) {
      for (const e of validation.errors) {
        bus.emit(EVT.TOAST, { text: e, kind: 'danger' });
      }
      if (!opts.force) return false;
    }
    for (const w of validation.warnings.slice(0, 2)) {
      bus.emit(EVT.TOAST, { text: w, kind: 'warn' });
    }

    craft.fillAll(1);
    craft.alignToGround();

    const vessel = new Vessel(craft, {
      body,
      name: craft.name,
      difficulty: this.difficulty,
    });

    const t = this.universeTime;
    vessel.universeTime = t;

    if (opts.startInOrbit) {
      // 원궤도에 직접 배치 — 착륙·도킹·행성간 기동 연습용
      const alt =
        opts.altitude ?? Math.max(body.atmo.height + 25000, body.radius * 0.12);
      // 산봉우리 안에서 시작하는 일이 없도록 지형 최고점 위로 올린다
      const r = Math.max(body.radius + alt, body.safeOrbitRadius(3000));
      const speed = Math.sqrt(body.mu / r);
      const phase = 0;
      vessel.pos.set(r * Math.cos(phase), r * Math.sin(phase));
      vessel.vel.set(-speed * Math.sin(phase), speed * Math.cos(phase));
      vessel.angle = Math.atan2(vessel.vel.y, vessel.vel.x);
      vessel.angularVelocity = 0;
      vessel.situation = SITUATION.ORBITING;
      vessel.hasLaunched = true;
      vessel.clamped = false;
      // 발사 클램프가 붙어 있으면 궤도에서는 의미가 없으니 떼어낸다
      for (const p of vessel.parts) if (p.def.clamp) p.destroyed = true;
      vessel.recomputeMass();
    } else {
      // 발사대 위에 배치
      const sitePos = site.positionAt(t);
      const up = site.upAt(t);
      const lift = vessel.com.y - (vessel.bounds?.minY ?? 0);
      vessel.pos.set(sitePos.x + up.x * lift, sitePos.y + up.y * lift);
      vessel.vel.copy(site.velocityAt(t));
      vessel.angle = Math.atan2(up.y, up.x);
      vessel.angularVelocity = 0;
      vessel.situation = SITUATION.PRELAUNCH;
    }

    this.vessel = vessel;
    this.vessels = [vessel];
    this.autopilot = new Autopilot(vessel);
    this.planner.clear();
    this.flightLog.length = 0;
    if (this.dom.flightLog) this.dom.flightLog.innerHTML = '';
    this.renderer.clear();
    this.warpIndex = 0;
    this.loop.setTimeScale(1);
    this.loop.gameTime = 0;

    this.camera.mode = CAMERA_MODE.FOLLOW;
    this.camera.jumpTo(
      body.absolutePositionAt(t).x + vessel.pos.x,
      body.absolutePositionAt(t).y + vessel.pos.y
    );
    this.camera.setZoom(8, true);
    this.camera.setRotation(vessel.angle - Math.PI / 2, true);

    audio.init();
    audio.resume();
    audio.startWind();

    addRecord(this.progress, 'totalFlights');
    this.missions.stats.initialPartCount = vessel.partCount;

    this.go('flight');
    if (opts.startInOrbit) {
      this.log(`${craft.name} — ${body.name} 궤도에서 임무 시작`);
      bus.emit(EVT.TOAST, {
        text: `${body.name} 궤도에서 시작합니다`,
        kind: 'info',
      });
    } else {
      this.log(`${craft.name} 발사 대기 — ${site.name}`);
      bus.emit(EVT.TOAST, {
        text: '스페이스바를 눌러 발사하세요',
        kind: 'info',
      });
    }
    return true;
  }

  endFlight(reason = 'recovered') {
    if (!this.vessel) return;
    const v = this.vessel;
    updateRecord(this.progress, 'maxAltitude', this.missions.stats.maxAltitude);
    updateRecord(this.progress, 'maxSpeed', this.missions.stats.maxSpeed);
    updateRecord(this.progress, 'maxG', v.maxG);
    updateRecord(this.progress, 'longestFlight', v.missionTime);
    addRecord(this.progress, 'totalFuelBurned', v.fuelBurned);
    addRecord(this.progress, 'totalDistanceTravelled', v.distanceTravelled);
    saveProgress(this.progress);

    const payload = {
      reason,
      vessel: v,
      missionTime: v.missionTime,
      maxAltitude: this.missions.stats.maxAltitude,
      maxSpeed: this.missions.stats.maxSpeed,
      maxG: v.maxG,
      body: v.body.name,
      situation: v.situation,
      objectives: this.missions.objectiveStates(),
      mission: this.missions.active,
    };

    audio.stopAll();
    this.go('results', payload);
  }

  recover() {
    if (!this.vessel) return;
    const v = this.vessel;
    if (!v.landed && !v.splashed) {
      bus.emit(EVT.TOAST, {
        text: '착륙 또는 착수 상태에서만 회수할 수 있습니다',
        kind: 'warn',
      });
      return;
    }
    const recovered = Math.round(
      v.parts.filter((p) => !p.destroyed).length * 800 +
        v.net.totalMass() * 0.4
    );
    this.progress.funds += recovered;
    bus.emit(EVT.TOAST, {
      text: `기체 회수 — +${recovered.toLocaleString('ko-KR')}`,
      kind: 'success',
    });
    this.endFlight('recovered');
  }

  /* ──────────────────────────────────────────────────────────
   * 물리 스텝
   * ────────────────────────────────────────────────────────── */

  fixedUpdate(dt, gameTime) {
    if (this.scene.name !== 'flight') return;
    if (this.paused) return;
    const v = this.vessel;
    if (!v) return;

    this.universeTime += dt;
    v.universeTime = this.universeTime;
    this.system.setTime(this.universeTime);

    // 오토파일럿
    if (this.autopilot?.enabled) this.autopilot.update(dt);

    v.update(dt, this.universeTime, this.system);

    // 기동 노드 실행 추적
    this.planner.updateExecution(v, dt);
    if (v.orbit) this.planner.rebase(v.orbit);

    // 자동 스테이징 제안
    if (
      this.settings.gameplay.autoStagePrompt &&
      shouldAutoStage(v) &&
      !this._autoStagePrompted
    ) {
      this._autoStagePrompted = true;
      bus.emit(EVT.TOAST, {
        text: '연소 종료 — 스페이스바로 다음 단',
        kind: 'warn',
      });
      this.scheduler.after(3, () => {
        this._autoStagePrompted = false;
      });
    }

    // 타임워프 안전 검사
    this.checkWarpSafety();

    // 임무
    const targetInfo = this.target
      ? relativeMotion(v, this.target)
      : null;
    this.missions.update(dt, {
      vessel: v,
      system: this.system,
      time: this.universeTime,
      targetDistance: targetInfo?.distance ?? null,
      targetRelativeSpeed: targetInfo?.relativeSpeed ?? Infinity,
    });
  }

  /**
   * @param {number} dt 실시간 경과
   * @param {number} scaledDt 타임워프가 반영된 경과 — 카메라 추적에 쓴다
   */
  update(dt, scaledDt = dt) {
    this.scaledDt = Math.max(dt, scaledDt || 0);
    this.input.beginFrame();
    this.scheduler.update(dt);
    this.scene.update(dt);
    this.hud.update(dt);

    switch (this.scene.name) {
      case 'flight':
        this.updateFlight(dt);
        break;
      case 'builder':
        this.builder.update(dt);
        break;
      default:
        break;
    }

    this.input.endFrame();
  }

  updateFlight(dt) {
    const v = this.vessel;
    if (!v) return;
    const input = this.input;

    // 지도 토글
    if (input.actionPressed('mapToggle')) this.toggleMap();

    if (this.mapOpen) {
      this.mapView.handleInput(
        input,
        this.system,
        v,
        this.planner,
        this.universeTime
      );
      this.mapView.update(dt);
      // 지도에서도 기본 조종은 가능하게 둔다
    }

    // 조종 입력
    const fi = input.flightInput();
    const sens = this.settings.controls.controlSensitivity;
    v.control.roll = fi.roll * sens;
    v.control.pitch = fi.pitch * sens;
    v.control.translateX = fi.translateX;
    v.control.translateY = fi.translateY;
    if (Math.abs(fi.roll) > 0.05 && v.sasMode === 'hold') {
      v._sasHoldAngle = undefined;
    }

    // 스로틀
    if (Math.abs(fi.throttleDelta) > 0.01) {
      v.adjustThrottle(fi.throttleDelta * dt * 0.8);
    }
    if (input.actionPressed('throttleMax')) v.setThrottle(1);
    if (input.actionPressed('throttleZero')) v.setThrottle(0);

    // 스테이징
    if (input.actionPressed('stage')) {
      v.activateStage();
      this._autoStagePrompted = false;
    }

    // 액션 그룹
    if (input.actionPressed('rcsToggle')) {
      const on = v.toggleRcs();
      bus.emit(EVT.TOAST, { text: `RCS ${on ? '켜짐' : '꺼짐'}` });
    }
    if (input.actionPressed('sasToggle')) {
      const on = v.toggleSas();
      bus.emit(EVT.TOAST, { text: `SAS ${on ? '켜짐' : '꺼짐'}` });
    }
    if (input.actionPressed('gearToggle')) v.toggleGear();
    if (input.actionPressed('lightToggle')) v.toggleLights();
    if (input.actionPressed('chuteDeploy')) {
      const n = v.deployAllChutes();
      if (!n) bus.emit(EVT.TOAST, { text: '전개할 낙하산이 없습니다', kind: 'warn' });
    }

    // SAS 모드
    if (input.actionPressed('navPrograde')) v.setSasMode('prograde');
    if (input.actionPressed('navRetrograde')) v.setSasMode('retrograde');
    if (input.actionPressed('navRadialIn')) v.setSasMode('radialIn');
    if (input.actionPressed('navRadialOut')) v.setSasMode('radialOut');
    if (input.actionPressed('navTarget')) v.setSasMode('target');
    if (input.actionPressed('navSurface')) v.setSasMode('surfaceRetrograde');

    // 타임워프
    if (input.wasPressed('Period')) this.setWarp(this.warpIndex + 1);
    if (input.wasPressed('Comma')) this.setWarp(this.warpIndex - 1);

    // 카메라
    if (input.actionPressed('cameraNext')) this.cycleCamera();
    if (!this.mapOpen) {
      if (input.mouse.wheel !== 0) {
        this.camera.autoZoom = false;
        this.camera.zoomBy(Math.pow(0.9, input.mouse.wheel / 100));
      }
      if (input.action('zoomIn')) {
        this.camera.autoZoom = false;
        this.camera.zoomBy(1 + dt * 1.5);
      }
      if (input.action('zoomOut')) {
        this.camera.autoZoom = false;
        this.camera.zoomBy(1 - dt * 1.2);
      }
    }

    // 저장/불러오기
    if (input.actionPressed('quicksave')) this.quicksave();
    if (input.actionPressed('quickload')) this.quickload();
    if (input.actionPressed('pause')) this.togglePauseMenu();

    // 카메라 추적
    if (!this.mapOpen) {
      const bodyWorld = v.body.absolutePositionAt(this.universeTime);
      this.camera.follow(
        {
          pos: new Vec2(bodyWorld.x + v.pos.x, bodyWorld.y + v.pos.y),
          vel: v.vel,
          angle: v.angle,
          terrainAltitude: v.terrainAltitude,
          altitude: v.altitude,
          bounds: v.bounds,
        },
        {
          lockRotation: this.camera.mode === CAMERA_MODE.LOCKED,
          alignToBody: this.camera.mode === CAMERA_MODE.FOLLOW,
          // 천체 중심 기준 "위쪽" 방향 — 절대 좌표로 계산하면 안 된다
          upAngle: Math.atan2(v.pos.y, v.pos.x),
          autoZoom: this.camera.autoZoom,
        }
      );
      // 타임워프 중에는 기체가 실시간보다 훨씬 빨리 움직이므로
      // 카메라도 같은 배속으로 따라가야 화면 밖으로 놓치지 않는다.
      this.camera.update(this.scaledDt ?? dt);
      // 그래도 벌어지면(스테이지 분리·SOI 전환 등) 즉시 붙인다
      const gap = Math.hypot(
        this.camera.targetPos.x - this.camera.pos.x,
        this.camera.targetPos.y - this.camera.pos.y
      ) * this.camera.zoom;
      if (gap > Math.max(this.camera.width, this.camera.height) * 1.5) {
        this.camera.jumpTo(this.camera.targetPos.x, this.camera.targetPos.y);
      }
    }

    this.renderer.update(dt, v);
    this.updateAudio(dt);
    this.updateFlightDom();
  }

  updateAudio(dt) {
    const v = this.vessel;
    if (!audio.ready || !v) return;
    const atmoDensity = v.body.atmo.exists
      ? clamp01(v.body.atmo.densityAt(v.altitude) / 1.225)
      : 0;

    // 엔진 사운드 — 전체를 하나의 루프로 묶는다
    const running = v.parts.filter(
      (p) => !p.destroyed && p.isEngine && p.running && !p.flameout
    );
    if (running.length) {
      const totalThrust = running.reduce(
        (a, p) => a + p.thrustAt(0) * p.throttleActual,
        0
      );
      const size = clamp01(totalThrust / 4e6);
      if (!audio.loops.has('main-engine')) {
        audio.startEngine('main-engine', { size });
      }
      audio.updateEngine(
        'main-engine',
        clamp01(totalThrust / Math.max(v.maxThrust(0), 1)),
        Math.max(atmoDensity, 0.25)
      );
    } else if (audio.loops.has('main-engine')) {
      audio.stopEngine('main-engine');
    }

    audio.updateWind(v.dynamicPressure, v.mach);

    if (v.heatFlux > 40000) {
      if (!audio.loops.has('reentry')) audio.startReentry();
      audio.updateReentry(clamp01(v.heatFlux / 400000));
    } else if (audio.loops.has('reentry')) {
      audio.stopReentry();
    }

    // 소닉붐
    if (v.prevMach < 1 && v.mach >= 1 && atmoDensity > 0.02) {
      audio.play('sonicBoom');
    }
  }

  updateFlightDom() {
    const v = this.vessel;
    if (!v || !this.dom.missionPanel) return;
    if (!this.missions.active || this.mapOpen) {
      this.dom.missionPanel.hidden = true;
      return;
    }
    this.dom.missionPanel.hidden = false;
    const states = this.missions.objectiveStates();
    this.dom.missionPanel.innerHTML =
      `<h4>${this.missions.active.name}</h4>` +
      states
        .map(
          (s) =>
            `<div class="obj ${s.done ? 'done' : ''} ${
              s.optional ? 'optional' : ''
            }"><span>${s.done ? '✔' : '○'}</span>${s.text}${
              s.optional ? ' <em>(선택)</em>' : ''
            }</div>`
        )
        .join('');
  }

  /* ──────────────────────────────────────────────────────────
   * 타임워프
   * ────────────────────────────────────────────────────────── */

  setWarp(index) {
    const v = this.vessel;
    index = clamp(index, 0, WARP_LEVELS.length - 1);
    if (index === this.warpIndex) return;
    const level = WARP_LEVELS[index];

    if (v && index > this.warpIndex) {
      // 안전 조건 검사
      if (v.body.atmo.exists && level.minAltFactor > 0) {
        const minAlt = v.body.atmo.height * level.minAltFactor;
        if (v.altitude < minAlt && !v.landed) {
          bus.emit(EVT.TOAST, {
            text: `고도 ${formatDistance(minAlt)} 이상에서만 ${level.label} 가속이 가능합니다`,
            kind: 'warn',
          });
          return;
        }
      }
      if (v.currentThrust > 0 && level.rate > 4) {
        bus.emit(EVT.TOAST, {
          text: '엔진 가동 중에는 고배속을 쓸 수 없습니다',
          kind: 'warn',
        });
        return;
      }
    }

    this.warpIndex = index;
    this.loop.setTimeScale(level.rate);
    addRecord(this.progress, 'totalTimeWarped', 0);
    bus.emit(EVT.TIMEWARP_CHANGE, { rate: level.rate });
  }

  checkWarpSafety() {
    const v = this.vessel;
    if (!v || this.warpIndex === 0) return;
    const level = WARP_LEVELS[this.warpIndex];
    // 대기권 재진입 시 자동 감속
    if (
      v.body.atmo.exists &&
      level.minAltFactor > 0 &&
      v.altitude < v.body.atmo.height * level.minAltFactor
    ) {
      this.setWarp(0);
      bus.emit(EVT.TOAST, {
        text: '대기권 진입 — 시간 가속 해제',
        kind: 'warn',
      });
    }
    // 지면 접근 시
    if (v.terrainAltitude < 3000 && v.verticalSpeed < -20 && this.warpIndex > 2) {
      this.setWarp(0);
    }
  }

  /* ──────────────────────────────────────────────────────────
   * 카메라 / 지도
   * ────────────────────────────────────────────────────────── */

  cycleCamera() {
    const modes = [CAMERA_MODE.FOLLOW, CAMERA_MODE.LOCKED, CAMERA_MODE.FREE];
    const i = modes.indexOf(this.camera.mode);
    this.camera.mode = modes[(i + 1) % modes.length];
    this.camera.autoZoom = this.camera.mode !== CAMERA_MODE.FREE;
    const label = {
      follow: '추적 카메라',
      locked: '기체 고정',
      free: '자유 카메라',
    }[this.camera.mode];
    bus.emit(EVT.TOAST, { text: label });
  }

  toggleMap() {
    this.mapOpen = !this.mapOpen;
    if (this.mapOpen) {
      this.mapView.open(this.vessel, this.system, this.universeTime);
      this.dom.mapCanvas.hidden = false;
      this.dom.mapToolbar.hidden = false;
    } else {
      this.mapView.close();
      this.dom.mapCanvas.hidden = true;
      this.dom.mapToolbar.hidden = true;
    }
    // 지도에서는 비행 로그·임무 패널이 궤도를 가린다
    if (this.dom.flightLog) this.dom.flightLog.hidden = this.mapOpen;
    if (this.dom.missionPanel && this.mapOpen) this.dom.missionPanel.hidden = true;
  }

  /** 기동 노드 추가 */
  addManeuverNode(offsetSeconds = null) {
    const v = this.vessel;
    if (!v || !v.orbit) return null;
    const t =
      this.universeTime +
      (offsetSeconds ??
        (Number.isFinite(v.orbit.period) ? v.orbit.period * 0.25 : 300));
    const node = this.planner.add(v.orbit, t, { prograde: 0, radial: 0 });
    bus.emit(EVT.TOAST, { text: '기동 노드 추가 — 지도에서 드래그하세요' });
    return node;
  }

  /* ──────────────────────────────────────────────────────────
   * 저장 / 불러오기
   * ────────────────────────────────────────────────────────── */

  buildSaveData(label) {
    const v = this.vessel;
    if (!v) return null;
    return {
      label,
      universeTime: this.universeTime,
      missionTime: v.missionTime,
      bodyName: v.body.name,
      situation: SITUATION_LABEL[v.situation] ?? v.situation,
      craftName: v.craftName,
      craft: this.currentCraft ? this.currentCraft.toBlueprint() : null,
      vessel: v.toJSON(),
      mission: this.missions.active?.id ?? null,
      completedObjectives: [...this.missions.completedObjectives],
      warpIndex: this.warpIndex,
      nodes: this.planner.toJSON(),
    };
  }

  quicksave() {
    const data = this.buildSaveData('빠른 저장');
    if (!data) return;
    writeSave(QUICKSAVE_ID, data, '빠른 저장');
    bus.emit(EVT.TOAST, { text: '저장 완료', kind: 'success' });
  }

  quickload() {
    const data = readSave(QUICKSAVE_ID);
    if (!data) {
      bus.emit(EVT.TOAST, { text: '저장된 비행이 없습니다', kind: 'warn' });
      return;
    }
    this.loadSaveData(data);
  }

  loadSaveData(data) {
    if (!data?.craft) {
      bus.emit(EVT.TOAST, { text: '세이브가 손상되었습니다', kind: 'danger' });
      return;
    }
    const craft = Craft.fromBlueprint(data.craft);
    this.currentCraft = craft;
    this.universeTime = data.universeTime ?? 0;
    this.system.setTime(this.universeTime);

    const vessel = new Vessel(craft, {
      body: this.system.get(data.vessel.bodyId) ?? this.home,
      name: craft.name,
      difficulty: this.difficulty,
    });
    vessel.restore(data.vessel, this.system);
    this.vessel = vessel;
    this.vessels = [vessel];
    this.autopilot = new Autopilot(vessel);
    this.planner.clear();
    this.renderer.clear();
    this.setWarp(0);

    if (data.mission) {
      this.missions.start(data.mission, vessel);
      for (const id of data.completedObjectives ?? []) {
        this.missions.completedObjectives.add(id);
      }
    }

    const bodyWorld = vessel.body.absolutePositionAt(this.universeTime);
    this.camera.jumpTo(bodyWorld.x + vessel.pos.x, bodyWorld.y + vessel.pos.y);
    this.go('flight');
    bus.emit(EVT.TOAST, { text: '불러오기 완료', kind: 'success' });
  }

  togglePauseMenu() {
    if (this.scene.name !== 'flight') return;
    this.paused = !this.paused;
    if (this.dom.pauseMenu) this.dom.pauseMenu.hidden = !this.paused;
    if (this.paused) audio.suspend();
    else audio.resume();
  }

  /* ──────────────────────────────────────────────────────────
   * 렌더
   * ────────────────────────────────────────────────────────── */

  render() {
    switch (this.scene.name) {
      case 'flight':
        if (this.mapOpen) {
          this.mapView.render({
            system: this.system,
            vessel: this.vessel,
            time: this.universeTime,
            planner: this.planner,
            otherVessels: this.vessels,
          });
        } else {
          this.renderer.render({
            camera: this.camera,
            system: this.system,
            vessel: this.vessel,
            time: this.universeTime,
            settings: this.settings,
          });
        }
        this.hud.render({
          vessel: this.vessel,
          system: this.system,
          time: this.universeTime,
          autopilot: this.autopilot,
          planner: this.planner,
          target: this.target,
          warp: WARP_LEVELS[this.warpIndex].rate,
          settings: this.settings,
          mapOpen: this.mapOpen,
        });
        break;
      case 'builder':
        this.builder.render();
        break;
      default:
        break;
    }
  }

  /* ──────────────────────────────────────────────────────────
   * DOM 패널 갱신
   * ────────────────────────────────────────────────────────── */

  refreshBuildPanels() {
    if (this.dom.buildStats) this.builder.renderStats(this.dom.buildStats);
    if (this.dom.buildName) this.dom.buildName.value = this.builder.craft.name;
  }

  refreshHangar() {
    const container = this.dom.hangarList;
    if (!container) return;
    container.innerHTML = '';

    // 프리셋
    const presetHeader = document.createElement('h3');
    presetHeader.textContent = '기본 제공 기체';
    container.appendChild(presetHeader);

    for (const p of presetCatalog()) {
      const card = document.createElement('div');
      card.className = 'craft-card';
      const startBody = p.start ? this.system.get(p.start.body) : null;
      card.innerHTML = `
        <div class="craft-head">
          <b>${p.name}</b>
          <span class="tag">${p.tag}</span>
          ${startBody ? `<span class="tag ok">${startBody.name} 궤도 시작</span>` : ''}
        </div>
        <div class="craft-meta">
          ${formatMass(p.stats.mass)} · ${p.stats.stages}단 ·
          Δv ${Math.round(p.stats.deltaV)} m/s · TWR ${p.stats.twr.toFixed(2)}
        </div>
        <div class="craft-hint">${p.hint}</div>
        <div class="craft-actions">
          <button data-act="launch" data-id="${p.id}">${
            startBody ? '임무 시작' : '발사'
          }</button>
          <button data-act="edit" data-id="${p.id}">설계실에서 열기</button>
        </div>`;
      container.appendChild(card);
    }

    // 저장된 설계도
    const saved = listBlueprints();
    if (saved.length) {
      const h = document.createElement('h3');
      h.textContent = '내 설계도';
      container.appendChild(h);
      for (const meta of saved) {
        const card = document.createElement('div');
        card.className = 'craft-card saved';
        card.innerHTML = `
          <div class="craft-head"><b>${meta.name}</b>
            <span class="tag">${new Date(meta.savedAt).toLocaleDateString('ko-KR')}</span>
          </div>
          <div class="craft-meta">
            ${formatMass(meta.mass)} · ${meta.stages}단 · Δv ${Math.round(meta.deltaV)} m/s · 부품 ${meta.partCount}개
          </div>
          <div class="craft-actions">
            <button data-act="launch-saved" data-id="${meta.id}">발사</button>
            <button data-act="edit-saved" data-id="${meta.id}">편집</button>
            <button data-act="delete-saved" data-id="${meta.id}" class="danger">삭제</button>
          </div>`;
        container.appendChild(card);
      }
    }
  }

  refreshMissionList() {
    const container = this.dom.missionList;
    if (!container) return;
    container.innerHTML = '';
    for (const m of availableMissions(this.progress)) {
      const card = document.createElement('div');
      card.className = `mission-card${m.completed ? ' completed' : ''}${
        m.locked ? ' locked' : ''
      }`;
      card.innerHTML = `
        <div class="mission-head">
          <b>${m.name}</b>
          <span class="tier">난이도 ${m.tier}</span>
        </div>
        <p>${m.brief}</p>
        <ul>${m.objectives
          .map((o) => `<li${o.optional ? ' class="optional"' : ''}>${o.text}</li>`)
          .join('')}</ul>
        <div class="mission-foot">
          <span>보상 ${m.reward.toLocaleString('ko-KR')} · 과학 ${m.science}</span>
          <button data-act="start-mission" data-id="${m.id}" ${
        m.locked ? 'disabled' : ''
      }>${m.completed ? '다시 도전' : '임무 수락'}</button>
        </div>`;
      container.appendChild(card);
    }
  }

  refreshBodyGuide() {
    const container = this.dom.bodyList;
    if (!container) return;
    container.innerHTML = '';
    for (const entry of this.system.hierarchy()) {
      const b = entry.body;
      const d = b.describe();
      const card = document.createElement('div');
      card.className = 'body-card';
      card.style.marginLeft = `${entry.depth * 18}px`;
      const visited = this.progress.visitedBodies.includes(b.id);
      const landed = this.progress.landedBodies.includes(b.id);
      card.innerHTML = `
        <div class="body-head">
          <span class="body-dot" style="background:${b.palette.map ?? b.palette.surface}"></span>
          <b>${b.name}</b>
          <span class="tag">${
            { star: '항성', planet: '행성', moon: '위성', dwarf: '왜행성' }[b.type]
          }</span>
          ${visited ? '<span class="tag ok">방문</span>' : ''}
          ${landed ? '<span class="tag ok">착륙</span>' : ''}
        </div>
        <p>${b.def.description ?? ''}</p>
        <div class="body-stats">
          <span>반지름 ${formatDistance(b.radius)}</span>
          <span>중력 ${d.gravity}</span>
          <span>탈출속도 ${d.escape}</span>
          <span>대기 ${d.atmosphere}</span>
          <span>하루 ${d.day}</span>
          <span>SOI ${d.soi}</span>
        </div>`;
      container.appendChild(card);
    }
  }

  refreshSettingsPanel() {
    const s = this.settings;
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!value;
      else el.value = value;
    };
    set('set-quality', s.graphics.quality);
    set('set-starfield', s.graphics.starfield);
    set('set-trajectory', s.graphics.showTrajectoryPrediction);
    set('set-shake', s.graphics.screenShake);
    set('set-fps', s.graphics.showFps);
    set('set-master', s.audio.master);
    set('set-sfx', s.audio.sfx);
    set('set-music', s.audio.music);
    set('set-difficulty', s.gameplay.difficulty);
    set('set-heat', s.gameplay.reentryHeat);
    set('set-drag', s.gameplay.atmosphericDrag);
    set('set-sensitivity', s.controls.controlSensitivity);
  }

  saveSettingsFromPanel() {
    saveSettings(this.settings);
    this.difficulty =
      DIFFICULTY[this.settings.gameplay.difficulty] ?? DIFFICULTY.normal;
    if (this.vessel) this.vessel._difficulty = this.difficulty;
    this.applyGraphicsSettings();
    audio.setVolume('master', this.settings.audio.master);
    audio.setVolume('sfx', this.settings.audio.sfx);
    audio.setVolume('music', this.settings.audio.music);
  }

  showResults(payload) {
    const el = this.dom.resultsBody;
    if (!el || !payload) return;
    const reasonLabel = {
      recovered: '기체 회수',
      destroyed: '기체 상실',
      aborted: '임무 중단',
    }[payload.reason] ?? payload.reason;

    el.innerHTML = `
      <h2>${reasonLabel}</h2>
      <div class="result-grid">
        <div><span>임무 시간</span><b>${formatTime(payload.missionTime)}</b></div>
        <div><span>최고 고도</span><b>${formatDistance(payload.maxAltitude)}</b></div>
        <div><span>최고 속도</span><b>${formatSpeed(payload.maxSpeed)}</b></div>
        <div><span>최대 G</span><b>${payload.maxG.toFixed(2)} g</b></div>
        <div><span>최종 천체</span><b>${payload.body}</b></div>
        <div><span>최종 상황</span><b>${
          SITUATION_LABEL[payload.situation] ?? payload.situation
        }</b></div>
      </div>
      ${
        payload.mission
          ? `<h3>${payload.mission.name}</h3><ul class="result-objs">${payload.objectives
              .map(
                (o) =>
                  `<li class="${o.done ? 'done' : 'miss'}">${
                    o.done ? '✔' : '✕'
                  } ${o.text}</li>`
              )
              .join('')}</ul>`
          : ''
      }
      <div class="result-funds">보유 자금 ${this.progress.funds.toLocaleString(
        'ko-KR'
      )} · 과학 ${this.progress.science}</div>`;
  }
}
