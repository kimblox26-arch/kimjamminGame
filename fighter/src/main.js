// SKYBREAKER — 메인 (부팅 · 상태 관리 · 메뉴 연출 · 비행 루프 · 점수/임팩트)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Settings } from '../../src/core/settings.js';
import { Audio } from '../../src/core/audio.js';
import { World } from '../../src/world/world.js';
import { Effects } from '../../src/fx/effects.js';
import { JetModel, PRESETS, normalizeDesign } from './jet.js';
import { FlightModel } from './flight.js';
import { Combat } from './combat.js';
import { HUD, HUD_COLORS } from './hud.js';
import { Input } from './input.js';
import { Sfx } from './sfx.js';
import { FxPlus, Ribbon, VaporCone, ImpactShader } from './fx.js';
import { FighterCamera } from './cam.js';
import { UI, isTouch } from './ui.js';
import { Hangar } from './hangar.js';

const FIXED = 1 / 120;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

const KILL_TITLES = ['', '격추!', '더블 킬!', '트리플 킬!', '쿼드라 킬!', '펜타 킬!', '에이스!!', '레전드!!!'];

class Game {
  constructor() {
    this.state = 'loading';
    this.paused = false;
    this.timeScale = 1;
    this.slowT = 0;
    this.time = 0;
    this.shake = 0;
    this.fxs = { flash: 0, ab: 0, red: 0, black: 0 };
    this.design = this._loadCurrent();
    try { this.best = JSON.parse(localStorage.getItem('skybreaker.best') || '{}'); } catch (e) { this.best = {}; }
    this.player = null;
    const self = this;
    this.playerTarget = {
      kind: 'air', name: 'PLAYER', hostile: false,
      get pos() { return self.player.fm.pos; },
      get vel() { return self.player.fm.vel; },
      get alive() { return !!(self.player && self.player.alive); },
    };
  }

  _loadCurrent() {
    try { const d = JSON.parse(localStorage.getItem('skybreaker.current')); if (d) return normalizeDesign(d); } catch (e) { /* noop */ }
    return normalizeDesign(PRESETS[1]);
  }

  setDesign(d) {
    this.design = normalizeDesign(d);
    try { localStorage.setItem('skybreaker.current', JSON.stringify(this.design)); } catch (e) { /* noop */ }
    this.ui.updateMenuCard(this.design);
    this._buildMenuJets();
  }

  /* ------------------------------ 부팅 ------------------------------ */
  async boot() {
    const canvas = document.getElementById('gl');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = Settings.get('shadows');
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._pixelRatio();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.35, 500000);
    this.camera.position.set(0, 600, 0);
    this.rig = new FighterCamera(this.camera);
    this.input = new Input(canvas);
    this.hud = new HUD(document.getElementById('hud'));
    this.ui = new UI(this);
    this.ui.show('s-loading');
    this._applyInputSettings();

    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'flight') this.setPaused(true); });
    const unlock = () => {
      if (!Audio.ready) {
        Audio.init();
        if (this.state === 'menu' || this.state === 'hangar') Sfx.music(true, 0.75);
      }
      Audio.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('keydown', (e) => this._onKey(e));

    this._tips();
    this.world = new World(this.scene, this.renderer);
    this.world.onThunder = (pos) => { if (Audio.ready) Audio.thunder(pos); };
    await this.world.init((p, label) => this.ui.setLoading(0.03 + p * 0.85, label));
    this.ui.setLoading(0.9, '전투 시스템 준비');
    await new Promise((r) => setTimeout(r, 20));
    this.fx = new Effects(this.scene);
    this.fxp = new FxPlus(this.scene, this.fx);
    this.combat = new Combat(this);
    this._composer();
    this.ui.setLoading(0.96, '편대 집결');
    await new Promise((r) => setTimeout(r, 20));
    this.hangar = new Hangar(this);
    this.hangar.bindTopBar();
    this._buildMenuJets();
    this.ui.updateMenuCard(this.design);
    this.ui.setLoading(1, '출격 준비 완료');
    setTimeout(() => {
      clearInterval(this._tipTimer);
      this.state = 'menu';
      this.ui.show('s-menu');
      if (Audio.ready) Sfx.music(true, 0.75);
    }, 380);
    this._last = performance.now();
    this._loop();
  }

  _tips() {
    const tips = [
      '락온 원 안에 적을 1초 유지하면 LOCK — 미사일이 유도됩니다.',
      '연속 격추로 콤보 배율이 최대 7배까지 올라갑니다.',
      '고도 60m 이하 초저공 고속 비행은 초당 보너스 점수!',
      '음속(마하 1.0) 돌파 순간 베이퍼 콘과 소닉붐을 확인하세요.',
      '격납고에서 날개·엔진·도장·무장을 바꿔 나만의 전투기를 만드세요.',
      'V 키로 1인칭 조종석 / 3인칭 / 시네마틱 시점 전환.',
      'MISSILE 경보 시 플레어(X)를 뿌리고 급선회!',
    ];
    let i = 0;
    const el = document.getElementById('load-tip');
    const set = () => { if (el) el.textContent = tips[i++ % tips.length]; };
    set();
    this._tipTimer = setInterval(set, 3600);
  }

  _pixelRatio() {
    const s = clamp(Settings.get('renderScale'), 0.5, 1.6);
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1) * s);
  }

  _composer() {
    const size = this.renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Settings.get('antialias') ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.38, 0.5, 1.0);
    this.composer.addPass(this.bloom);
    this.impact = new ShaderPass(ImpactShader);
    this.composer.addPass(this.impact);
    this.composer.addPass(new OutputPass());
    this.onResize();
  }

  _applyInputSettings() {
    this.input.mouseFlight = !!Settings.get('mouseFlight');
    this.input.sensitivity = Settings.get('sensitivity') || 1;
    this.input.invert = !!Settings.get('invertPitch');
    this.hud.color = HUD_COLORS[Settings.get('hudColor')] || HUD_COLORS.green;
    this.rig.baseFov = Settings.get('fov') || 72;
  }

  onSettings(key) {
    this._pixelRatio();
    this.renderer.shadowMap.enabled = Settings.get('shadows');
    this._applyInputSettings();
    this.ui.applyTouchVisibility();
    if (key === 'weather' || key === 'cloudDensity' || key === '*' || key === 'quality') this.world.applyWeather(Settings.get('weather'));
    if (key === 'timeOfDay' || key === '*') this.world.setTimeOfDay(Settings.get('timeOfDay'));
    if (Audio.ready) Audio.applyVolumes();
    if (key === 'flightMusic' && this.state === 'flight') Sfx.music(!!Settings.get('flightMusic'), this.mode === 'dogfight' ? 1 : 0.5);
    this.onResize();
  }

  onResize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.composer) this.composer.setSize(w, h);
    if (this.impact) this.impact.uniforms.uAspect.value = w / h;
    this.hud.resize();
  }

  /* ------------------------------ 메뉴 연출 ------------------------------ */
  _buildMenuJets() {
    if (this.menuJets) for (const m of this.menuJets) { m.jet.dispose(); m.ribbons.forEach((r) => r.dispose()); }
    const designs = [this.design, PRESETS[(PRESETS.findIndex((p) => p.id === this.design.id) + 2 + PRESETS.length) % PRESETS.length], PRESETS[4]];
    const offs = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(-30, -5, 30), new THREE.Vector3(32, -8, 36)];
    this.menuJets = designs.map((d, i) => {
      const jet = new JetModel(d);
      this.scene.add(jet.root);
      return { jet, off: offs[i], ribbons: [new Ribbon(this.scene, { max: 70, width: 0.3, life: 1.6 }), new Ribbon(this.scene, { max: 70, width: 0.3, life: 1.6 })] };
    });
    if (!this.menuPath) {
      // 원형 항로의 지형 고도 미리 계산
      const R = 5200, n = 96, hs = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        let h = 0;
        for (let k = -2; k <= 2; k++) {
          const b = a + k * 0.03;
          h = Math.max(h, this.world.surfaceAt(Math.cos(b) * R, Math.sin(b) * R).height);
        }
        hs.push(Math.max(420, h + 260));
      }
      const sm = hs.map((_, i) => { let s = 0; for (let k = -4; k <= 4; k++) s += hs[(i + k + n) % n]; return s / 9; });
      this.menuPath = { R, n, hs: sm, a: Math.random() * 6.28, shot: 0, shotT: 0 };
    }
    this._setMenuJetsVisible(this.state === 'menu' || this.state === 'loading');
  }

  _setMenuJetsVisible(on) {
    if (!this.menuJets) return;
    for (const m of this.menuJets) { m.jet.root.visible = on; m.ribbons.forEach((r) => { r.mesh.visible = on; if (!on) r.clear(); }); }
  }

  _updateMenu(dt) {
    const mp = this.menuPath;
    const speed = 175;
    mp.a += (speed / mp.R) * dt;
    const posAt = (a) => {
      const f = ((a / (Math.PI * 2)) % 1 + 1) % 1 * mp.n;
      const i = Math.floor(f), t = f - i;
      const h = mp.hs[i % mp.n] * (1 - t) + mp.hs[(i + 1) % mp.n] * t;
      return new THREE.Vector3(Math.cos(a) * mp.R, h, Math.sin(a) * mp.R);
    };
    const p = posAt(mp.a), pn = posAt(mp.a + 0.01);
    const fwd = pn.sub(p).normalize();
    const bank = -0.42;
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd.clone().negate(), new THREE.Vector3(0, 1, 0)));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -bank));
    const t = this.time;
    const abOn = (t % 9) > 5.5;
    this.menuJets.forEach((m, i) => {
      const off = m.off.clone().applyQuaternion(q);
      off.y += Math.sin(t * 0.8 + i * 2) * 1.2;
      m.jet.root.position.copy(p).add(off);
      m.jet.root.quaternion.copy(q);
      m.jet.animate(dt, { throttle: 0.85, ab: i === 0 ? abOn : (t + i * 3) % 11 > 8, pitch: Math.sin(t * 0.9 + i) * 0.2, roll: Math.sin(t * 0.6 + i) * 0.2 });
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      for (let k = 0; k < 2; k++) {
        const tip = m.jet.wingtipLocal[k].clone().applyQuaternion(q).add(m.jet.root.position);
        m.ribbons[k].push(tip, right, 0.28);
        m.ribbons[k].update(dt);
      }
    });
    // 카메라 샷
    mp.shotT += dt;
    if (mp.shotT > 8) { mp.shotT = 0; mp.shot = (mp.shot + 1) % 4; }
    const lead = this.menuJets[0].jet.root.position;
    const cam = this.camera;
    const st = mp.shotT;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    if (mp.shot === 0) {
      const a = st * 0.22 + 0.6;
      cam.position.copy(lead).addScaledVector(fwd, Math.cos(a) * 36).addScaledVector(right, Math.sin(a) * 36).addScaledVector(up, 7);
      cam.lookAt(lead.clone().addScaledVector(right, 6));
      cam.fov = 50;
    } else if (mp.shot === 1) {
      cam.position.copy(lead).addScaledVector(fwd, -60 + st * 2).addScaledVector(up, 14).addScaledVector(right, -10);
      cam.lookAt(lead.clone().addScaledVector(fwd, 30));
      cam.fov = 58;
    } else if (mp.shot === 2) {
      cam.position.copy(lead).addScaledVector(fwd, 80 - st * 6).addScaledVector(right, 26).addScaledVector(up, -4);
      cam.lookAt(lead);
      cam.fov = 34;
    } else {
      cam.position.copy(lead).addScaledVector(right, -70 + st * 3).addScaledVector(up, 28).addScaledVector(fwd, 18);
      cam.lookAt(lead.clone().addScaledVector(fwd, 10));
      cam.fov = 44;
    }
    const s = this.world.surfaceAt(cam.position.x, cam.position.z);
    cam.position.y = Math.max(cam.position.y, s.height + 5);
    cam.updateProjectionMatrix();
    this.world.update(dt, cam);
    this._skyGrade();
    this.fx.update(dt, cam, this.world);
    if (Audio.ready) {
      Audio.updateListener(cam.position, _v.set(0, 0, -1).applyQuaternion(cam.quaternion), _v2.set(0, 1, 0).applyQuaternion(cam.quaternion));
      Audio.updateAtmos({ airspeed: 40, density: 1, stall: 0 });
    }
    this._setImpact(0, 0, 0, 0, 0, 0);
  }

  /* ------------------------------ 격납고 ------------------------------ */
  openHangar() {
    this.state = 'hangar';
    this._setMenuJetsVisible(false);
    this.ui.show('s-hangar');
    this.hangar.open(this.design);
    this.input.exitLock();
  }

  /* ------------------------------ 비행 ------------------------------ */
  startFlight(mode) {
    if (!this.world) return;
    if (this.state === 'hangar') this.hangar.close();
    this.mode = mode;
    this.state = 'flight';
    this.paused = false;
    this._setMenuJetsVisible(false);
    this._disposePlayer();
    this.fx.clear();
    this.fxp.clear();

    const jet = new JetModel(this.design, { cockpit: true });
    this.scene.add(jet.root);
    const fm = new FlightModel(jet.stats);
    const st = jet.stats;
    this.player = {
      jet, fm, alive: true, hp: st.hp, maxHp: st.hp, ammo: st.gun.ammo, missiles: st.missiles, flares: 60,
      gunAcc: 0, gunIdle: 9, firing: false, msCd: 0, flareCd: 0, deaths: 0,
      ribbons: [new Ribbon(this.scene, { max: 110, width: 0.42, life: 1.6 }), new Ribbon(this.scene, { max: 110, width: 0.42, life: 1.6 })],
      cone: new VaporCone(jet),
      light: new THREE.PointLight(0xff9a50, 0, 60, 2),
    };
    jet.root.add(this.player.light);
    this.player.light.position.set(0, 0, jet.L * 0.6);
    this._spawn(true);
    this.score = 0; this.kills = 0; this.groundKills = 0; this.combo = 0; this.comboT = 0;
    this.supersonic = false; this.boomShown = false; this.lowT = 0; this.flightT = 0;
    this.combat.start(mode);
    for (const r of this.world.props.rings) r.passed = false;

    this.ui.hideScreens();
    this.ui.setFlight(true);
    this.ui.showPause(false);
    this.ui.showDead(false);
    this.hud.visible = true;
    this.input.enabled = true;
    this.input.v.ab = false;
    this.input.v.throttle = null;
    this.ui.setTouchState('ab', false);
    this.rig.mode = 'chase';
    this.rig.startIntro(fm);
    if (Audio.ready) {
      Audio.resume();
      Sfx.music(false);
      if (Settings.get('flightMusic')) setTimeout(() => this.state === 'flight' && Sfx.music(true, mode === 'dogfight' ? 1 : 0.5), 600);
      if (this.engine) Audio.removeVoice(this.engine);
      this.engine = Audio.createEngineVoice('jet');
    }
    this.ui.banner(mode === 'dogfight' ? '공중전 개시' : '자유 비행', mode === 'dogfight' ? '적 편대를 격추하라' : '하늘은 당신의 것 — 훈련 드론이 배치되었습니다', 'wave');
  }

  _spawn(first) {
    const P = this.player, fm = P.fm;
    let pos, hdg;
    if (first) { pos = new THREE.Vector3(-3800, 650, 900); hdg = 80; }
    else {
      pos = fm.pos.clone();
      hdg = fm.heading;
      const h = this.world.surfaceAt(pos.x, pos.z).height;
      pos.y = Math.max(h + 1200, pos.y, 1400);
    }
    fm.reset(pos, hdg, 250);
    P.alive = true;
    P.hp = P.maxHp;
    P.missiles = P.jet.stats.missiles;
    P.jet.setMissilesVisible(P.missiles);
    P.jet.root.visible = true;
    P.ribbons.forEach((r) => r.clear());
    this.rig.deathPos = null;
    this.rig.snap(fm);
    this._sync(0);
  }

  _disposePlayer() {
    if (!this.player) return;
    const P = this.player;
    P.jet.dispose();
    P.ribbons.forEach((r) => r.dispose());
    this.player = null;
    Sfx.stopAll();
    if (Audio.ready) Audio.clearWarnings();
  }

  respawn() {
    if (!this.player) return;
    this.ui.showDead(false);
    this.ui.showPause(false);
    this.paused = false;
    if (Audio.ready) Audio.setMuted(false);
    this._spawn(false);
    this.rig.startIntro(this.player.fm);
    this.ui.banner('재출격', '', 'info');
  }

  toMenu() {
    this.combat.clear();
    this._disposePlayer();
    if (this.engine && Audio.ready) { Audio.removeVoice(this.engine); this.engine = null; }
    if (this.state === 'hangar') this.hangar.close();
    this.state = 'menu';
    this.paused = false;
    this.timeScale = 1;
    this.fx.clear(); this.fxp.clear();
    this.ui.setFlight(false);
    this.ui.showPause(false);
    this.ui.showDead(false);
    this.ui.show('s-menu');
    this.ui.updateMenuCard(this.design);
    this.hud.visible = false;
    this.input.enabled = false;
    this.input.exitLock();
    this._setMenuJetsVisible(true);
    if (Audio.ready) { Audio.setMuted(false); Sfx.music(true, 0.75); }
  }

  setPaused(p) {
    if (this.state !== 'flight') return;
    if (!this.player.alive && p) return;
    this.paused = p;
    this.ui.showPause(p);
    if (p) { this.input.exitLock(); Sfx.gun(false); Sfx.lockTone('off'); }
    if (Audio.ready) { Audio.setMuted(p); if (p) Audio.clearWarnings(); }
  }

  _onKey(e) {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.state === 'flight') {
        if (this.ui.screen === 's-settings') { this.ui.hideScreens(); this.ui.showPause(true); }
        else this.setPaused(!this.paused);
      } else if (this.state === 'hangar') this.hangar.game.setDesign(this.hangar.design), this.toMenu();
      else if (this.ui.screen !== 's-menu' && this.state === 'menu') this.ui.show('s-menu');
    }
    if (this.state === 'flight' && e.code === 'KeyH') this.hud.visible = !this.hud.visible;
    if (this.state === 'flight' && this.player && !this.player.alive && (e.code === 'KeyR' || e.code === 'Enter') && !document.getElementById('dead').hidden) this.respawn();
  }

  /* ------------------------------ 이벤트 ------------------------------ */
  banner(title, sub, kind) { this.ui.banner(title, sub, kind); }

  addShake(a) { this.rig.shake = Math.min(2.2, this.rig.shake + a * (Settings.get('impactFx') ?? 1)); }

  bonus(text, pts) {
    if (!this.player || !this.player.alive) return;
    this.score += pts;
    this.ui.popup(`${text} +${pts}`, 'bonus');
    Sfx.bonus();
  }

  onHitMarker(kill) {
    this.hud.hitMarker(kill);
    Sfx.hit(kill);
    this.fxs.ab = Math.max(this.fxs.ab, 0.35);
  }

  onKill(target, cause) {
    if (!this.player) return;
    const air = target.kind === 'air';
    const P = this.player;
    if (air) this.kills++; else this.groundKills++;
    this.combo = this.comboT > 0 ? this.combo + 1 : 1;
    this.comboT = 8;
    const base = air ? (cause === 'gun' ? 150 : 100) : target.pts;
    const pts = base * this.combo;
    this.score += pts;
    const title = air ? KILL_TITLES[Math.min(this.combo, KILL_TITLES.length - 1)] : (this.combo > 1 ? KILL_TITLES[Math.min(this.combo, KILL_TITLES.length - 1)] : '목표 파괴!');
    this.ui.banner(title, `${air ? target.name : target.name} ${cause === 'gun' ? '기관포' : '미사일'} 격파  +${pts.toLocaleString()}`, this.combo >= 3 ? 'combo' : 'kill');
    this.ui.popup(`+${pts.toLocaleString()}${this.combo > 1 ? ` (x${this.combo})` : ''}`, 'pts');
    this.ui.killfeed(`<b>${this.design.name}</b> <i>${cause === 'gun' ? '▸ GUN' : '▸ MSL'}</i> <em>${target.name}</em>`);
    Sfx.kill(this.combo);
    this.hud.hitMarker(true);
    const d = target.pos.distanceTo(P.fm.pos);
    const k = Settings.get('impactFx') ?? 1;
    if (d < 3500) {
      this.slowT = air ? 0.65 : 0.45;
      this.fxs.flash = Math.max(this.fxs.flash, (air ? 0.32 : 0.22) * k * clamp(1.4 - d / 3000, 0.3, 1));
      this.fxs.ab = Math.max(this.fxs.ab, 1.3);
      this.rig.fovKick += 6 * k;
      this.addShake(clamp(1 - d / 2500, 0.25, 1) * 0.9);
    }
    if (this.mode === 'dogfight' && air && this.combat.wave > 0 && !this.combat.enemies.some((e) => e.alive)) {
      setTimeout(() => {
        if (this.state !== 'flight' || !this.player) return;
        this.ui.banner('WAVE CLEAR', `보너스 +${500 * this.combat.wave} · 기체 수리 완료`, 'wave');
        this.score += 500 * this.combat.wave;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.5);
      }, 1600);
    }
  }

  onMissileIncoming() { /* 경보는 Combat.update 에서 지속 판정 */ }

  damagePlayer(dmg, kind, point) {
    const P = this.player;
    if (!P || !P.alive) return;
    P.hp -= dmg;
    this.fxs.red = Math.min(1, this.fxs.red + (kind === 'missile' ? 0.9 : 0.25));
    this.addShake(kind === 'missile' ? 1.4 : 0.35);
    if (point) this.fx.sparks(point, _v.copy(point).sub(P.fm.pos).normalize(), kind === 'missile' ? 30 : 6, 1.4);
    if (Audio.ready) Audio.impact(P.fm.pos.clone(), kind === 'missile' ? 1.4 : 0.5, 'metal');
    if (kind === 'missile') { this.fx.explosion(P.fm.pos.clone().addScaledVector(P.fm.vel, 0.05), 0.8, { debris: false }); this.ui.banner('피격!', '기체 손상', 'warn'); }
    if (P.hp <= 0) this.crash('적에게 격추당했습니다', true);
  }

  crash(reason, shotDown = false) {
    const P = this.player;
    if (!P.alive) return;
    P.alive = false;
    P.deaths++;
    this.combo = 0; this.comboT = 0;
    const pos = P.fm.pos.clone();
    const s = this.world.surfaceAt(pos.x, pos.z);
    if (!shotDown && s.type === 'water') { this.fx.waterImpact(pos, 90, 3); Audio.splash(pos, 3); }
    else if (!shotDown) { this.fxp.groundBlast(pos, true); Audio.explosion(pos, 3); }
    else { this.fxp.airKill(pos, P.fm.vel, 1.3); Audio.explosion(pos, 2.5); }
    P.jet.root.visible = false;
    Sfx.gun(false); Sfx.lockTone('off'); Sfx.rwr(false);
    if (Audio.ready) Audio.clearWarnings();
    if (this.engine) this.engine.update({ throttle: 0, rpm: 0, airspeed: 0, afterburner: false, health: 0 }, 0.016);
    this.rig.deathPos = pos;
    this.rig.deathT = 0;
    this.slowT = 1.2;
    this.fxs.flash = 0.6 * (Settings.get('impactFx') ?? 1);
    this.addShake(1.6);
    this.input.exitLock();
    const best = this.best[this.mode] || 0;
    if (this.score > best) { this.best[this.mode] = this.score; try { localStorage.setItem('skybreaker.best', JSON.stringify(this.best)); } catch (e) { /* noop */ } }
    setTimeout(() => {
      if (this.state !== 'flight' || !this.player || this.player.alive) return;
      this.ui.showDead(true, {
        reason,
        stats: {
          점수: this.score.toLocaleString(), '공중 격추': this.kills, '지상 파괴': this.groundKills,
          '비행 시간': `${Math.floor(this.flightT / 60)}:${String(Math.floor(this.flightT % 60)).padStart(2, '0')}`,
          '최고 점수': Math.max(best, this.score).toLocaleString(),
        },
      });
    }, 2300);
  }

  /* ------------------------------ 비행 갱신 ------------------------------ */
  _updateFlight(dtReal) {
    const P = this.player, fm = P.fm, inp = this.input;
    // 슬로모션
    if (this.slowT > 0) { this.slowT -= dtReal; this.timeScale += (0.28 - this.timeScale) * (1 - Math.exp(-dtReal * 20)); }
    else this.timeScale += (1 - this.timeScale) * (1 - Math.exp(-dtReal * 5));
    const dt = dtReal * this.timeScale;
    this.flightT += dt;
    const ctl = inp.controls(dtReal);

    if (P.alive) {
      // 스로틀
      let thr = fm.throttle;
      if (ctl.thrAbs !== null && ctl.thrAbs !== undefined) thr = ctl.thrAbs;
      thr = clamp(thr + ctl.thrDelta * dtReal, 0, 1);
      if (ctl.ab) thr = 1;
      // 자동 수평 보조
      const al = Settings.get('autoLevel');
      let roll = ctl.roll;
      if ((al === 'on' || (al === 'auto' && isTouch())) && Math.abs(ctl.roll) < 0.05) {
        const b = fm.bank;
        if (Math.abs(b) < 1.3) roll = clamp(-b * 1.1, -0.6, 0.6);
      }
      this._acc = (this._acc || 0) + dt;
      let n = 0;
      while (this._acc >= FIXED && n < 8) {
        fm.step(FIXED, { pitch: ctl.pitch, roll, yaw: ctl.yaw, throttle: thr, ab: ctl.ab });
        this._acc -= FIXED; n++;
      }
      if (n === 8) this._acc = 0;
      // 충돌
      const s = this.world.surfaceAt(fm.pos.x, fm.pos.z);
      const hitProp = this.world.props.checkCollision(fm.pos, 3.5);
      if (fm.pos.y - 1.2 < s.height || (hitProp && !hitProp.deck)) {
        fm.pos.y = Math.max(fm.pos.y, s.height + 1);
        this.crash(s.type === 'water' ? '바다에 추락했습니다' : '지면과 충돌했습니다');
      }
      // 무장
      this.combat.firePlayerGun(dt, ctl.fire);
      P.msCd -= dt; P.flareCd -= dt;
      if (inp.consumeTap('missile')) { if (!this.combat.firePlayerMissile() && Audio.ready) Audio.ui('error'); }
      if (inp.consumeTap('flare')) {
        if (P.flares >= 6 && P.flareCd <= 0) { this.combat.dropFlares(P, 6); P.flares -= 6; P.flareCd = 1.0; }
        else if (Audio.ready) Audio.ui('error');
      }
      const maxM = P.jet.stats.missiles;
      if (P.missiles < maxM) {
        const before = Math.floor(P.missiles);
        P.missiles = Math.min(maxM, P.missiles + dt / 5);
        if (Math.floor(P.missiles) !== before) P.jet.setMissilesVisible(Math.floor(P.missiles));
      }
      P.flares = Math.min(60, P.flares + dt * 1.2);
      if (this.mode === 'free') P.hp = Math.min(P.maxHp, P.hp + dt * 3);
    } else {
      inp.consumeTap('missile'); inp.consumeTap('flare');
      this.combat.firePlayerGun(dt, false);
    }
    if (inp.consumeTap('camera')) { const name = this.rig.cycle(); this.ui.popup('시점: ' + name, 'info'); if (Audio.ready) Audio.ui('click'); }
    if (inp.consumeTap('pause')) this.setPaused(true);
    inp.consumeTap('target');

    this.combat.update(dt);
    this._sync(dt, ctl);
    this.world.update(dt, this.camera);
    this._skyGrade();
    this.fx.update(dt, this.camera, this.world);
    this.fxp.update(dt, this.camera);

    // 점수 콤보
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }

    if (P.alive) this._flightBonuses(dt);
    this._flightFeedback(dtReal, ctl);
  }

  /** 기체 메시 · 베이퍼 · 화염 · 엔진 소리 동기화 */
  _sync(dt, ctl = {}) {
    const P = this.player, fm = P.fm, jet = P.jet;
    jet.root.position.copy(fm.pos);
    jet.root.quaternion.copy(fm.quat);
    jet.setInterior(this.rig.interior);
    jet.animate(dt, { pitch: ctl.pitch || 0, roll: ctl.roll || 0, yaw: ctl.yaw || 0, throttle: fm.throttle, ab: fm.ab && P.alive, firing: P.firing });
    if (!P.alive || dt <= 0) return;
    // 날개끝 베이퍼 (고G / 고받음각)
    const vap = clamp((fm.gLoad - 3.2) / 3.5, 0, 1) + clamp((fm.aoa - 0.16) * 4, 0, 0.8) * clamp(fm.speed / 150, 0, 1);
    for (let i = 0; i < 2; i++) {
      const tip = _v.copy(jet.wingtipLocal[i]).applyQuaternion(fm.quat).add(fm.pos);
      if (vap > 0.02) P.ribbons[i].push(tip, fm.right, clamp(vap, 0, 1) * 0.7);
      P.ribbons[i].update(dt);
    }
    // 베이퍼 콘 (천음속)
    const m = fm.mach;
    const cone = clamp(1 - Math.abs(m - 1.0) / 0.06, 0, 1) * (fm.pos.y < 9000 ? 1 : 0.3) + clamp((fm.gLoad - 5) / 4, 0, 1) * clamp((m - 0.82) / 0.1, 0, 1) * 0.7;
    P.cone.set(clamp(cone, 0, 1), this.time);
    // 애프터버너 열광
    P.light.intensity = fm.ab ? 2600 + Math.random() * 600 : 0;
    // 고고도 비행운
    if (fm.pos.y > 6500) for (const nz of jet.nozzles) this.fx.contrail(_v.copy(nz.exit).applyQuaternion(fm.quat).add(fm.pos), fm.forward, clamp((fm.pos.y - 6500) / 2000, 0, 1), dt);
  }

  _flightBonuses(dt) {
    const P = this.player, fm = P.fm;
    // 음속 돌파
    if (!this.supersonic && fm.mach >= 1.0) {
      this.supersonic = true;
      if (Audio.ready) Audio.sonicBoom(fm.pos.clone());
      this.fx.shockwave(fm.pos.clone(), 1.6);
      this.fxp.glow(fm.pos.clone(), 30, 0.25, 0xe0f0ff);
      this.fxs.flash = Math.max(this.fxs.flash, 0.15 * (Settings.get('impactFx') ?? 1));
      this.addShake(0.9);
      this.rig.fovKick += 5;
      if (!this.boomShown) { this.boomShown = true; this.ui.banner('음속 돌파!', 'MACH 1.0 — 소닉붐', 'boom'); this.score += 200; }
    } else if (this.supersonic && fm.mach < 0.95) this.supersonic = false;
    // 초저공 고속 비행
    const agl = this.agl;
    if (agl < 60 && fm.speed > 170) {
      this.lowT += dt;
      if (this.lowT > 1) { this.lowT -= 1; this.score += 15; this.ui.popup('초저공 비행! +15', 'bonus'); }
    } else this.lowT = 0;
    // 링 통과
    for (const r of this.world.props.rings) {
      if (r.passed) continue;
      if (r.mesh.position.distanceTo(fm.pos) < r.radius) { r.passed = true; this.bonus('링 통과!', 100); }
    }
  }

  _flightFeedback(dtReal, ctl) {
    const P = this.player, fm = P.fm;
    const s = this.world.surfaceAt(fm.pos.x, fm.pos.z);
    this.agl = fm.pos.y - s.height;
    const ahead = _v.copy(fm.pos).addScaledVector(fm.vel, 3.2);
    const sA = this.world.surfaceAt(ahead.x, ahead.z).height;
    const warn = {
      pullUp: P.alive && ((fm.vel.y < -8 && this.agl / -fm.vel.y < 4.5) || (ahead.y < sA + 25 && fm.speed > 60)),
      stall: P.alive && fm.stall > 0.35,
      overG: P.alive && fm.gLoad > fm.s.maxG * 0.97,
      boundary: P.alive && Math.max(Math.abs(fm.pos.x), Math.abs(fm.pos.z)) > 15000,
    };
    this.warn = warn;
    if (Audio.ready) {
      Audio.warning('pullup', warn.pullUp);
      Audio.warning('stall', warn.stall);
      const cam = this.camera;
      Audio.updateListener(cam.position, _v.set(0, 0, -1).applyQuaternion(cam.quaternion), _v2.set(0, 1, 0).applyQuaternion(cam.quaternion));
      Audio.setCabin(this.rig.interior, true);
      Audio.updateAtmos({ airspeed: P.alive ? fm.speed : 0, density: Math.exp(-fm.pos.y / 9000), stall: P.alive ? fm.stall : 0, airbrake: false });
      if (this.engine) {
        this.engine.update({ throttle: P.alive ? fm.throttle : 0, rpm: P.alive ? 0.3 + fm.throttle * 0.75 : 0, airspeed: fm.speed, afterburner: fm.ab && P.alive, health: P.alive ? 1 : 0 }, dtReal);
        this.engine.setPosition(fm.pos);
      }
    }
    // 카메라
    const buffet = P.alive ? fm.stall * 0.6 + (fm.ab ? 0.12 : 0) + clamp((fm.speed - 300) / 400, 0, 0.3) * clamp(1 - this.agl / 200, 0, 1) + clamp((fm.gLoad - 6) / 4, 0, 0.4) : 0;
    this.rig.update(dtReal, P, this.input, this.world, buffet + this.fx.shake * 0.4);

    // 화면 임팩트
    const k = Settings.get('impactFx') ?? 1;
    const f = this.fxs;
    f.flash = Math.max(0, f.flash - dtReal * 2.2);
    f.ab = Math.max(0, f.ab - dtReal * 2.5);
    f.red = Math.max(0, f.red - dtReal * 0.9);
    const lowHp = P.alive ? clamp(1 - P.hp / P.maxHp - 0.45, 0, 0.5) * (0.6 + 0.4 * Math.sin(this.time * 6)) : 0;
    const gPos = P.alive ? clamp((fm.gLoad - 7.2) / 3, 0, 1) : 0;
    f.black += ((gPos * 0.85) - f.black) * (1 - Math.exp(-dtReal * (gPos > f.black ? 0.8 : 2.5)));
    const gNeg = P.alive ? clamp((-fm.gLoad - 2) / 2.5, 0, 0.6) : 0;
    const spd = P.alive ? clamp((fm.speed - 260) / 260, 0, 1) : 0;
    const radial = (spd * 0.55 + (fm.ab && P.alive ? 0.35 : 0)) * (this.rig.interior ? 0.5 : 1);
    this._setImpact(
      f.ab * 1.2 * k + spd * 0.25 * k,
      radial * k,
      spd * k * (this.rig.mode === 'cinematic' ? 0 : 1),
      f.flash,
      Math.max(f.red * 0.8, lowHp, gNeg) * k,
      f.black,
    );
    // HUD 데이터
    this.ui.setThrottleKnob(fm.throttle, fm.ab);
    if (P.jet.cockpit && this.rig.interior && (this._mfdT = (this._mfdT || 0) - dtReal) <= 0) {
      this._mfdT = 0.2;
      const blips = [];
      for (const e of this.combat.enemies) {
        if (!e.alive) continue;
        const dx = e.pos.x - fm.pos.x, dz = e.pos.z - fm.pos.z;
        const h = fm.heading * Math.PI / 180;
        const x = (dx * Math.cos(h) + dz * Math.sin(h)) / 8000, y = (-dx * Math.sin(h) + dz * Math.cos(h)) / 8000;
        if (Math.hypot(x, y) < 1) blips.push({ x, y, hostile: e.hostile });
      }
      P.jet.drawMFD({ speed: fm.speed * 3.6, alt: fm.pos.y, throttle: fm.throttle, ab: fm.ab, g: fm.gLoad, ammo: Math.floor(P.ammo), missiles: Math.floor(P.missiles), flares: Math.floor(P.flares), hp: P.hp / P.maxHp, blips }, this.hud.color);
    }
    void ctl;
  }

  /** 전투기 게임용 하늘 그레이딩: 더 깊은 푸른 하늘 + 선명한 대기 */
  _skyGrade() {
    const u = this.world.sky.material.uniforms;
    u.exposure.value *= 0.52;
    u.turbidity.value = Math.max(1.8, u.turbidity.value * 0.62);
    u.rayleigh.value *= 1.5;
  }

  _setImpact(ab, radial, lines, flash, red, black) {
    if (!this.impact) return;
    const u = this.impact.uniforms;
    u.uTime.value = this.time;
    u.uAberration.value = ab;
    u.uRadial.value = radial;
    u.uSpeedLines.value = lines;
    u.uFlash.value = flash;
    u.uRed.value = red;
    u.uBlack.value = black;
    u.uVignette.value = 0.32 + black * 0.3;
  }

  /** 자동화 테스트용: 렌더 없이 비행 로직만 진행 (콘솔: __SKYBREAKER__.debugStep(2)) */
  debugStep(sec = 1) {
    if (this.state !== 'flight') return null;
    const n = Math.round(sec * 30);
    for (let i = 0; i < n; i++) { this.time += 1 / 30; this._updateFlight(1 / 30); this.input.endFrame(); }
    return { kills: this.kills, score: this.score, alive: this.player.alive };
  }

  /* ------------------------------ 루프 ------------------------------ */
  _loop() {
    const tick = () => {
      requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.1, (now - this._last) / 1000);
      this._last = now;
      this.time += dt;
      if (this.state === 'menu' || this.state === 'loading') {
        if (this.menuJets) this._updateMenu(dt);
        else if (this.world) this.world.update(dt, this.camera);
      } else if (this.state === 'hangar') {
        this.hangar.update(dt);
      } else if (this.state === 'flight' && this.player) {
        if (!this.paused) this._updateFlight(dt);
        else this.world.update(0, this.camera);
      }
      this._render(dt);
      this.input.endFrame();
    };
    tick();
  }

  _render(dt) {
    if (this.state === 'hangar') { this.hangar.render(); this.hud.render(null); return; }
    if (!this.composer) { this.renderer.render(this.scene, this.camera); return; }
    this.bloom.enabled = !!Settings.get('bloom');
    this.bloom.strength = 0.34 + (this.fxs.flash * 1.2);
    this.composer.render();
    if (this.state === 'flight' && this.player && this.hud.visible) {
      this.hud.render({
        camera: this.camera, player: this.player, combat: this.combat, dt, time: this.time,
        agl: this.agl || 0, warn: this.warn || {}, score: this.score, kills: this.kills, groundKills: this.groundKills,
        combo: this.combo, comboT: this.comboT, mode: this.mode, wave: this.combat.wave, playerTarget: this.playerTarget,
      });
    } else this.hud.render(null);
  }
}

const game = new Game();
window.__SKYBREAKER__ = game;
game.boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('load-label');
  if (el) el.innerHTML = '초기화 오류: ' + err.message + '<br><small>WebGL2 를 지원하는 최신 브라우저에서 실행하세요.</small>';
});
