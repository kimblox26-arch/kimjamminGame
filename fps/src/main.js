// OPERATION KIMJAMMIN — 1인칭 전술 FPS 메인 루프
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { ViewmodelPass, SSAOPass, GradeShader, skyMaterial, buildEnvironment, EnvBaker, packFogDir } from './post.js';
import { DayNight, NVGShader } from './daynight.js';

import { buildTextures, T } from './textures.js';
import { World, interiorFactorCPU } from './world.js';
import { WeaponSystem } from './weapons.js';
import { Player } from './player.js';
import { FX, Ballistics } from './fx.js';
import { Squad, HumanAnimator, propGun } from './squad.js';
import { createHuman, WIND } from './human.js';
import { buildTextures2 } from './textures2.js';
import { HUD } from './hud.js';
import { Armory } from './armory.js';
import { Nature } from './nature.js';
import { Range } from './range.js';
import { Audio } from './audio.js';
import { Profile } from './profile.js';
import { Enemies } from './enemies.js';
import { UpgradeShop } from './upgrades.js';
import { Account } from './account.js';
import { clamp, lerp, damp, rand, DEG } from './core.js';

const $ = (id) => document.getElementById(id);
export const SUN_DIR = new THREE.Vector3(-0.62, 0.47, 0.52).normalize();

// ── 입력 ──
class Input {
  constructor(el) {
    this.keys = new Set(); this.down = new Set(); this.mouse = [false, false, false]; this.mdown = [false, false, false];
    this.dx = 0; this.dy = 0; this.wheel = 0; this.el = el; this._dx = 0; this._dy = 0; this._w = 0;
    addEventListener('keydown', (e) => { if (!this.keys.has(e.code)) this.down.add(e.code); this.keys.add(e.code); if (this.locked && ['Tab', 'Space', 'KeyC', 'KeyW', 'KeyS', 'KeyD', 'KeyA', 'KeyQ', 'KeyE', 'KeyF', 'KeyR'].includes(e.code)) e.preventDefault(); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('mousedown', (e) => { if (!this.locked) return; this.mouse[e.button] = true; this.mdown[e.button] = true; });
    addEventListener('mouseup', (e) => { this.mouse[e.button] = false; });
    addEventListener('mousemove', (e) => { if (this.locked) { this._dx += e.movementX; this._dy += e.movementY; } });
    addEventListener('wheel', (e) => { if (this.locked) this._w += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('blur', () => { this.keys.clear(); this.mouse = [false, false, false]; });
  }
  get locked() { return document.pointerLockElement === this.el || this.forceLock; }
  frame() {
    // 브라우저가 가끔 튀는 큰 값 제거
    this.dx = Math.abs(this._dx) > 800 ? 0 : this._dx; this.dy = Math.abs(this._dy) > 800 ? 0 : this._dy;
    this.wheel = this._w; this._dx = this._dy = this._w = 0;
  }
  end() { this.down.clear(); this.mdown = [false, false, false]; }
  key(c) { return this.keys.has(c); }
  pressed(c) { return this.down.has(c); }
  mousePressed(b) { return this.mdown[b]; }
}

const QUALITY = {
  low: { pr: 0.75, shadow: 1024, msaa: 0, bloom: false, ao: false, vmShadow: 512 },
  medium: { pr: 1, shadow: 2048, msaa: 2, bloom: true, ao: true, vmShadow: 1024 },
  high: { pr: Math.min(devicePixelRatio, 1.5), shadow: 4096, msaa: 4, bloom: true, ao: true, vmShadow: 2048 },
};

class Game {
  constructor() {
    this.settings = this.loadSettings();
    this.state = 'loading';
    this.mode = 'survival';
    this.stats = { kills: 0, heads: 0, shots: 0, hits: 0 };
    this.wave = 0; this.score = 0; this.toSpawn = 0; this.spawnT = 0; this.waveBreak = 0;
    this.damageFlash = 0; this.suppressLevel = 0; this.dmgScale = 1; this.flashWhite = 0;
    this.time = 0;
  }

  loadSettings() {
    const d = { sens: 1, adsSens: 0.8, fov: 90, vol: 0.8, quality: 'high', invertY: false, showFps: false, timeMode: 'cycle' };
    let s = d;
    try { s = { ...d, ...JSON.parse(localStorage.getItem('kj-fps-settings') || '{}') }; } catch {}
    const q = new URLSearchParams(location.search).get('q');
    if (q && QUALITY[q]) s.quality = q;
    return s;
  }
  saveLoadout() { try { const W = this.weapons; localStorage.setItem('kj-fps-loadout', JSON.stringify(W.loadout.map((i) => W.list[i].def.id))); } catch {} }
  loadLoadout() { try { const L = JSON.parse(localStorage.getItem('kj-fps-loadout') || 'null'); if (Array.isArray(L)) L.forEach((id, k) => { const i = this.weapons.byId[id]; if (i != null && k < 2) this.weapons.loadout[k] = i; }); } catch {} }
  saveSettings() { try { localStorage.setItem('kj-fps-settings', JSON.stringify(this.settings)); } catch {} }

  async init() {
    const canvas = $('gl');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.AgXToneMapping; r.toneMappingExposure = 1.35;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.input = new Input(canvas);
    this.setLoad(0.02, '텍스처 생성');
    await buildTextures((p, n) => this.setLoad(0.02 + p * 0.4, `텍스처 생성 · ${n}`));
    await buildTextures2((p, n) => this.setLoad(0.42 + p * 0.14, `인물 텍스처 · ${n}`));
    // 비스듬한 각도에서도 선명하도록 최대 비등방성 필터
    { const mx = r.capabilities.getMaxAnisotropy(); for (const k in T) for (const m of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (T[k] && T[k][m]) { T[k][m].anisotropy = mx; T[k][m].needsUpdate = true; } }

    // 씬/카메라
    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x9aa6ae, packFogDir(SUN_DIR), 0.0055);   // near=해 방향, far=밀도 (post.js 대기 안개)
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.03, 1500);
    this.camera.rotation.order = 'YXZ';
    scene.add(this.camera);
    const sky = this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMaterial(SUN_DIR));
    sky.renderOrder = -10; sky.frustumCulled = false;
    scene.add(sky);
    // 조명
    this.hemi = new THREE.HemisphereLight(0xc4d6ee, 0x6a5a44, 0.25); scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xffdcb0, 4.2);
    sun.castShadow = true;
    const sc = sun.shadow.camera; sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 1; sc.far = 260;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035;
    scene.add(sun, sun.target);
    // 환경광: 실사 HDRI(CC0, Poly Haven) → PMREM, 태양 방향 정렬
    this.setLoad(0.6, '환경광 계산 (HDRI)');
    try {
      const hdr = await new EXRLoader().loadAsync('./assets/hdri/park.exr');
      // 시간대별로 다시 굽기 위해 HDRI 유지
      this.envBaker = new EnvBaker(r, hdr, 0.628);
      this.env = this.envBaker.bake(SUN_DIR, SUN_DIR.clone().negate(), 1, 0, 0);
    } catch (e) {
      console.warn('HDRI 로드 실패, 절차적 하늘 사용', e);
      const envScene = new THREE.Scene(); const es = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial(SUN_DIR, 0.05)); envScene.add(es);
      const pm = new THREE.PMREMGenerator(r); this.env = pm.fromScene(envScene, 0.02).texture;
    }
    scene.environment = this.env;

    // 월드
    this.setLoad(0.65, '맵 구축');
    await tick();
    this.world = new World(scene);
    this.world.build();
    this.lamps = this.world.lamps.map((p) => { const l = new THREE.PointLight(0xffd7a0, 28, 26, 2); l.position.copy(p); scene.add(l); return l; });
    this.setLoad(0.7, '자연 환경 (초원 · 숲 · 새)');
    await tick();
    this.nature = new Nature(this);
    this.range = new Range(this);
    // 전역 재질 환경광 강도
    scene.traverse((o) => { if (o.isMesh && o.material && 'envMapIntensity' in o.material && !o.material.userData.keepEnv) o.material.envMapIntensity = 0.8; });

    // 뷰모델 씬
    this.setLoad(0.8, '총기 모델링');
    await tick();
    const vmScene = this.vmScene = new THREE.Scene();
    vmScene.environment = this.env;
    this.vmCam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 10);
    this.vmCam.rotation.order = 'YXZ';
    vmScene.add(this.vmCam);
    this.vmRoot = new THREE.Group(); this.vmCam.add(this.vmRoot);
    this.vmHemi = new THREE.HemisphereLight(0xd2d9e2, 0x5a4a38, 0.6); vmScene.add(this.vmHemi);
    this.vmSun = new THREE.DirectionalLight(0xffe0bc, 3.0); vmScene.add(this.vmSun, this.vmSun.target);
    this.vmFill = new THREE.DirectionalLight(0xa9b3c2, 0.5); vmScene.add(this.vmFill);
    // 카메라 기준 키 라이트 (총기 윤곽 하이라이트)
    // 뷰모델 자체 그림자 (손 ↔ 총 사이)
    this.vmSun.castShadow = true;
    const vsc = this.vmSun.shadow.camera; vsc.left = -0.55; vsc.right = 0.55; vsc.top = 0.55; vsc.bottom = -0.55; vsc.near = 0.05; vsc.far = 4;
    this.vmSun.shadow.bias = -0.0006; this.vmSun.shadow.normalBias = 0.0025; this.vmSun.shadow.radius = 2;
    this.vmKey = new THREE.DirectionalLight(0xfff4e8, 1.1); this.vmKey.position.set(-0.6, 1, 0.4); this.vmCam.add(this.vmKey); this.vmKey.target.position.set(0.1, -0.1, -0.4); this.vmCam.add(this.vmKey.target);

    this.fx = new FX(this);
    this.ballistics = new Ballistics(this);
    this.player = new Player(this);
    this.profile = new Profile();
    this.weapons = new WeaponSystem(this);
    this.squad = new Squad(this);
    this.vmRoot.traverse((o) => { if (o.isMesh && !o.material.transparent && !o.material.isShaderMaterial) { o.castShadow = true; o.receiveShadow = true; } });
    this.loadLoadout();
    this.hud = new HUD(this);
    this.armory = new Armory(this);
    this.enemies = new Enemies(this);
    this.shop = new UpgradeShop(this);
    this.account = new Account(this);
    this.dayNight = new DayNight(this, { sunDir: SUN_DIR, envBaker: this.envBaker });
    this.dayNight.setMode(this.settings.timeMode || 'cycle');
    this.hud.weapon(this.weapons.cur);
    // 아군 분대 + 플레이어 그림자 몸체
    this.setLoad(0.86, '분대원 생성 (인물 조형)');
    await tick();
    this.squad.spawn();
    // 적 인물·총 미리 조형 (전투 중 첫 등장 시 끊김 방지)
    this.setLoad(0.9, '적 병력 조형');
    await tick();
    for (const k of ['op1', 'op2', 'op3', 'op4']) { createHuman(k); await tick(); }
    for (const t of ['ak', 'ak74', 'm4']) propGun(t);
    this.shadowBody = createHuman('jin', { shadowOnly: true });
    this.shadowAnim = new HumanAnimator(this.shadowBody);
    this.scene.add(this.shadowBody.root);
    this.shadowGuns = {};

    // 저격 조준경 PIP
    this.scopeRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, samples: 2 });
    this.scopeCam = new THREE.PerspectiveCamera(4, 1, 0.1, 1500);
    this.scopeCam.rotation.order = 'YXZ';
    for (const w of this.weapons.list) if (w.m.lens) w.m.lens.material.uniforms.tScene.value = this.scopeRT.texture;

    this.setupComposer();
    this.applySettings();
    addEventListener('resize', () => this.resize());
    this.resize();
    this.setLoad(0.95, '셰이더 컴파일');
    await tick();
    this.fx.explosion(new THREE.Vector3(0, -50, 0)); this.fx.clear();
    r.compile(scene, this.camera); r.compile(vmScene, this.vmCam);
    this.setLoad(1, '준비 완료');
    this.bindUI();
    this.weapons.warmPoses();
    // 그림자 몸체용 총(손 자세 포함)도 백그라운드에서 미리 생성
    { const ids = this.weapons.list.map((w) => w.def.id); const next = () => { const id = ids.shift(); if (!id) return; if (!this.shadowGuns[id]) this.shadowGuns[id] = propGun(id); setTimeout(next, 40); }; setTimeout(next, 3000); }
    this.state = 'menu';
    this.showScreen('menu');
    this.last = performance.now();
    this.loop();
    window.__game = this;
    const qs = new URLSearchParams(location.search);
    if (qs.has('auto')) { this.input.forceLock = true; this.start(qs.get('auto') || 'survival'); }
    document.title = 'OPERATION KIMJAMMIN — FPS';
    window.__ready = true;
  }

  setupComposer() {
    const r = this.renderer, q = QUALITY[this.settings.quality] || QUALITY.high;
    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: q.msaa });
    rt.depthTexture = new THREE.DepthTexture(innerWidth, innerHeight); rt.depthTexture.type = THREE.UnsignedIntType;
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ssao = new SSAOPass(this.camera, innerWidth * r.getPixelRatio(), innerHeight * r.getPixelRatio());
    this.ssao.enabled = q.ao;
    this.composer.addPass(this.ssao);
    this.composer.addPass(this.vmPass = new ViewmodelPass(this.vmScene, this.vmCam));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.32, 0.45, 0.92);
    this.bloom.enabled = q.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.nvgPass = new ShaderPass(NVGShader);
    this.composer.addPass(this.nvgPass);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  applySettings() {
    const s = this.settings, q = QUALITY[s.quality] || QUALITY.high;
    this.renderer.setPixelRatio(q.pr);
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== q.shadow) { sh.mapSize.set(q.shadow, q.shadow); sh.map?.dispose(); sh.map = null; }
    if (this.composer) {
      if (this.composer.renderTarget1.samples !== q.msaa) { this.composer.renderTarget1.samples = q.msaa; this.composer.renderTarget2.samples = q.msaa; this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
      this.bloom.enabled = q.bloom;
      this.ssao.ao = q.ao;
    }
    this.dayNight?.setMode(s.timeMode || 'cycle');
    const vs = this.vmSun.shadow;
    if (vs.mapSize.x !== q.vmShadow) { vs.mapSize.set(q.vmShadow, q.vmShadow); vs.map?.dispose(); vs.map = null; }
    Audio.setVolume(s.vol);
    $('fps').style.display = s.showFps ? 'block' : 'none';
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.ssao?.setSize(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
    this.grade?.uniforms.uTexel.value.set(1 / (w * this.renderer.getPixelRatio()), 1 / (h * this.renderer.getPixelRatio()));
    this.camera.aspect = this.vmCam.aspect = w / h;
    this.baseFov = 2 * Math.atan(Math.tan(this.settings.fov * DEG / 2) * (h / w)) / DEG;
    this.camera.updateProjectionMatrix(); this.vmCam.updateProjectionMatrix();
  }

  setLoad(p, label) { $('loading-bar').style.width = (p * 100).toFixed(0) + '%'; $('loading-label').textContent = label; }

  // ── UI ──
  bindUI() {
    const s = this.settings;
    $('btn-start').onclick = () => this.start('survival');
    $('btn-train').onclick = () => this.start('training');
    $('btn-resume').onclick = () => this.resume();
    $('btn-quit').onclick = () => this.toMenu();
    $('btn-retry').onclick = () => this.start(this.mode);
    $('btn-menu').onclick = () => this.toMenu();
    $('btn-armory').onclick = () => this.armory.open('menu');
    $('btn-armory2').onclick = () => this.armory.open('pause');
    for (const id of ['btn-settings', 'btn-settings2']) $(id).onclick = () => { this.prevScreen = this.screen; this.showScreen('settings'); };
    $('btn-back').onclick = () => { this.saveSettings(); this.applySettings(); this.showScreen(this.prevScreen || 'menu'); };
    const bind = (id, key, fmt = (v) => v, parse = Number) => {
      const el = $(id), out = $(id + '-v');
      el.value = s[key]; if (out) out.textContent = fmt(s[key]);
      el.oninput = () => { s[key] = el.type === 'checkbox' ? el.checked : parse(el.value); if (out) out.textContent = fmt(s[key]); if (key === 'vol') Audio.setVolume(s.vol); if (key === 'fov') this.resize(); };
      if (el.type === 'checkbox') el.checked = s[key];
    };
    bind('set-sens', 'sens', (v) => (+v).toFixed(2));
    bind('set-ads', 'adsSens', (v) => (+v).toFixed(2));
    bind('set-fov', 'fov', (v) => v + '°');
    bind('set-vol', 'vol', (v) => Math.round(v * 100) + '%');
    bind('set-quality', 'quality', (v) => ({ low: '낮음', medium: '보통', high: '높음' }[v]), String);
    bind('set-time', 'timeMode', (v) => ({ cycle: '자동', dawn: '새벽', morning: '아침', day: '한낮', afternoon: '오후', dusk: '황혼', night: '밤' }[v] || v), String);
    bind('set-invert', 'invertY');
    bind('set-fps', 'showFps');
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.locked && this.state === 'playing') this.pause();
      else if (this.input.locked && this.state === 'paused') { this.state = 'playing'; this.showScreen('game'); this.last = performance.now(); }
    });
    document.addEventListener('pointerlockerror', () => { if (this.state === 'playing') this.pause(); });
    $('gl').addEventListener('click', () => { if (this.state === 'playing' && !this.input.locked) this.lock(); });
    document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => Audio.play('ui', { bus: 'ui', vol: 0.4 })));
  }

  showScreen(name) {
    this.screen = name;
    document.body.dataset.screen = name;
    document.querySelectorAll('.screen').forEach((e) => e.classList.toggle('active', e.id === 'screen-' + name));
  }

  lock() {
    if (this.input.forceLock) return;
    const c = $('gl');
    try { const p = c.requestPointerLock({ unadjustedMovement: true }); p?.catch?.(() => c.requestPointerLock()); } catch { c.requestPointerLock(); }
  }

  start(mode) {
    Audio.init();
    this.mode = mode;
    this.reset();
    this.state = 'playing';
    this.showScreen('game');
    this.lock();
    this.hud.message(mode === 'training' ? '사격장 챌린지 — 왼쪽(서쪽) 사대로' : '기지 방어전 — 적을 격퇴하라', 2.8, 'big');
    if (mode === 'survival') this.enemies.start(); else this.enemies.stop();
    document.querySelector('#wave-box div:nth-child(2) span').textContent = mode === 'survival' ? '적' : '분대';
    this.hud.points(0, '', this.profile.points); document.querySelector('#pts-feed').innerHTML = '';
  }

  reset() {
    this.fx.clear(); this.ballistics.clear(); this.range.reset();
    for (const c of this.world.glass) { c.disabled = false; c.glass.visible = true; }
    for (const b of this.world.barrels) { b.exploded = false; b.hp = 30; b.col.disabled = false; b.mesh.visible = true; }
    this.player.reset(this.world.playerSpawn);
    this.weapons.list.forEach((w) => { w.ammo = w.def.mag + (w.def.action === 'rifle' || w.def.action === 'ak' || w.def.action === 'pistol' ? 1 : 0); w.reserve = w.def.reserve; w.locked = false; w.needsCycle = false; });
    this.weapons.anim = null; this.weapons.shotgunLoading = false; this.weapons.item = null; this.weapons.pending = null; this.weapons.ex.reset();
    this.weapons.slot = 0; this.weapons.equip(this.weapons.loadout[0], true);
    this.stats = { kills: 0, heads: 0, shots: 0, hits: 0 };
    this.wave = 0; this.score = 0; this.time = 0;
    for (const f of this.squad.list) { f.pos.copy(this.world.playerSpawn).add(new THREE.Vector3(f.slot.x, 0, -f.slot.z)); f.path = null; f.anim.init = false; }
    this.dmgScale = 1;
    this.hud.ammo(this.weapons.cur);
  }

  openArmory() { this.state = 'paused'; this.armory.open('game'); if (document.pointerLockElement) document.exitPointerLock(); }
  pause() { if (this.state !== 'playing') return; this.state = 'paused'; this.showScreen('pause'); }
  resume() { if (this.input.forceLock) { this.state = 'playing'; this.showScreen('game'); } else this.lock(); }
  toMenu() { this.state = 'menu'; this.enemies.stop(); this.showScreen('menu'); if (document.pointerLockElement) document.exitPointerLock(); }

  // 처치 포인트 적립 (프로필 저장 → 로그인 시 클라우드 동기화)
  addPoints(n, why) {
    this.score += n; this.profile.kills = (this.profile.kills || 0) + (why.includes('처치') && !why.includes('지원') ? 1 : 0);
    this.profile.best = Math.max(this.profile.best || 0, this.score);
    this.profile.add(n);
    this.hud.points(n, why, this.profile.points);
  }

  onPlayerDeath() {
    this.state = 'dying';
    setTimeout(() => {
      this.state = 'dead';
      if (document.pointerLockElement) document.exitPointerLock();
      const acc = this.stats.shots ? Math.round(this.stats.hits / this.stats.shots * 100) : 0;
      $('death-stats').innerHTML = `<div><b>${Math.round(this.time)}s</b><span>생존 시간</span></div><div><b>${this.stats.hits}</b><span>명중</span></div><div><b>${acc}%</b><span>명중률</span></div><div><b>${this.score}</b><span>점수</span></div>`;
      this.showScreen('dead');
    }, 2600);
  }

  // ── 전투 이벤트 ──
  hitFriend(hit, dir) {
    hit.friend.onHit(dir);
    this.fx.impact(hit.point, hit.n, 'dirt', dir);
    this.hud.message(`⚠ 아군 사격 주의 — ${hit.friend.name}`, 1.6, 'warn');
    this.stats.ff = (this.stats.ff || 0) + 1;
  }

  damageBarrel(barrel, dmg) {
    if (barrel.exploded) return;
    barrel.hp -= dmg;
    if (barrel.hp <= 0) this.explode(barrel);
  }

  explode(barrel) {
    if (barrel.exploded || this.state !== 'playing' && this.state !== 'dying') return;
    barrel.exploded = true; barrel.col.disabled = true; barrel.mesh.visible = false;
    const p = barrel.pos;
    this.fx.explosion(p);
    const R = 7.5;
    this.squad.react(p, 25, 1.4);
    this.nature.scare(p, 1);
    const P = this.player, dp = P.eye.distanceTo(p);
    if (dp < R * 1.2 && this.world.los(p, P.eye)) P.damage(110 * Math.max(0, 1 - dp / (R * 1.2)), p, 'explosion');
    const k = clamp(1 - dp / 40, 0, 1);
    P.shake = Math.min(1.2, P.shake + k * 1.4);
    this.flashWhite = k * 0.35;
    this.enemies.blast(p, R * 1.3, 150, 'player');
    if (k > 0.5) Audio.deafen(0.85 * k, 2.5);
    for (const o of this.world.barrels) if (!o.exploded && o.pos.distanceTo(p) < 4) setTimeout(() => this.explode(o), 120 + Math.random() * 180);
    for (const c of this.world.glass) if (!c.disabled && c.glass.position.distanceTo(p) < 10) this.fx.glassBreak(c, c.glass.position, c.glass.position.clone().sub(p).normalize());
  }

  alert(pos, r) { this.squad.react(pos, 4, 0.4); this.nature.scare(pos, r > 60 ? 0.5 : 0.3); }
  onBlast(p, R) { this.nature.scare(p, 1); this.enemies.blast(p, R * 1.3, 160, 'player'); }
  suppress(k) { this.suppressLevel = Math.min(1, this.suppressLevel + k); }

  updateMode(dt) {
    const E = this.enemies;
    if (this.mode === 'survival') this.hud.stats(E.wave ? `제 ${E.wave} 파` : '대기', E.alive + E.toSpawn, this.score);
    else this.hud.stats('사격장', this.squad.list.length, this.score);
  }

  // ── 메인 루프 ──
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.fpsAcc = (this.fpsAcc || 0) + dt; this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsAcc > 0.5) { $('fps').textContent = Math.round(this.fpsN / this.fpsAcc) + ' FPS'; this.fpsAcc = 0; this.fpsN = 0; }
    this.input.frame();
    if (this.state === 'playing' || this.state === 'dying') this.update(dt);
    else if (this.state === 'menu') this.menuCam(dt);
    this.render(dt);
    this.input.end();
  }

  menuCam(dt) {
    this.time += dt;
    this.dayNight.update(dt);
    WIND.time.value += dt; this.nature.update(dt);
    const t = this.time * 0.05;
    this.camera.position.set(Math.sin(t) * 38, 9 + Math.sin(t * 0.7) * 2, 40 + Math.cos(t) * 20);
    this.camera.lookAt(0, 3, -20);
    this.camera.fov = 60; this.camera.updateProjectionMatrix();
    this.vmRoot.visible = false;
    this.updateSun();
  }

  update(dt) {
    const I = this.input, P = this.player, W = this.weapons;
    this.time += dt;
    this.vmRoot.visible = P.alive;
    if (I.pressed('Escape')) this.pause();
    this.dayNight.update(dt);
    // 전술 라이트 / 야간투시경
    if (I.pressed('KeyL')) { this.dayNight.flashOn = !this.dayNight.flashOn; Audio.play('select', { vol: 0.6 }); }
    if (I.pressed('KeyN')) { this.dayNight.nvg = !this.dayNight.nvg; Audio.play(this.dayNight.nvg ? 'nvgOn' : 'select', { vol: 0.5 }); }
    if (I.pressed('Tab') && P.alive) { this.openArmory(); return; }
    if (I.pressed('KeyU') && P.alive) { this.state = 'paused'; this.shop.open('game'); if (document.pointerLockElement) document.exitPointerLock(); return; }
    P.update(dt, I);
    // 벽 근접 거리 (무기 들어올림)
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const wh = this.world.raycast(this.camera.position, fwd, 1.2, { ignoreGlass: false });
    this.wallDist = wh ? wh.t : null;
    // 탄약 보급
    this.nearAmmo = this.world.ammoCrates.some((c) => c.distanceTo(P.pos.clone().setY(0.5)) < 1.8);
    if (this.nearAmmo) {
      this.hud.prompt('[F] 탄약 보급');
      if (I.pressed('KeyF')) { for (const w of W.list) w.reserve = w.def.reserve; W.ex.refill(); Audio.play('pickup', { vol: 0.5, bus: 'ui' }); Audio.play('magin', { vol: 0.6 }); if (!W.item) this.hud.ammo(W.cur); this.hud.message('탄약 보급 완료', 1.4); }
    } else this.hud.prompt('');
    if (P.alive) W.update(dt, I);
    if (this.mode === 'training') for (const w of W.list) w.reserve = w.def.reserve;
    this.ballistics.update(dt);
    W.ex.updateWorld(dt);
    this.nature.update(dt);
    this.range.update(dt);
    Audio.setWind(WIND.strength.value);
    this.squad.update(dt);
    this.enemies.update(dt);
    this.updateShadowBody(dt);
    this.fx.update(dt);
    this.updateMode(dt);
    // 화면 효과
    this.suppressLevel = Math.max(0, this.suppressLevel - dt * 0.6);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.5);
    if (P.lastHit < 0.05) this.damageFlash = Math.min(1, this.damageFlash + 0.5);
    this.flashWhite = Math.max(0, this.flashWhite - dt * 1.2);
    this.hud.update(dt);
    // 오디오 리스너
    Audio.setListener(this.camera.position, fwd);
    this.indoor = damp(this.indoor ?? 0, 1 - interiorFactorCPU(this.camera.position) > 0.3 ? 1 : 0, 3, dt);
    Audio.setIndoor(this.indoor);
    this.updateSun();
  }

  updateShadowBody(dt) {
    const P = this.player, W = this.weapons, sb = this.shadowBody;
    sb.root.visible = P.alive;
    if (!P.alive) return;
    const id = W.def.id;
    if (this.shadowGunId !== id) {
      if (this.shadowGun) this.scene.remove(this.shadowGun.group);
      this.shadowGun = this.shadowGuns[id] || (this.shadowGuns[id] = propGun(id));
      this.shadowGun.group.traverse((o) => { if (o.isMesh) { o.material = sb.body.material[0]; o.castShadow = true; } });
      this.scene.add(this.shadowGun.group); this.shadowGunId = id;
    }
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.aimPoint = this.camera.position.clone().addScaledVector(fwd, 30);
    this.shadowAnim.update(dt, { pos: P.pos, yaw: P.yaw + Math.PI, vel: P.vel, crouch: P.crouchT > 0.5, ready: 1, aimPitch: P.pitch, aimYaw: 0, lookAt: this.aimPoint, gun: this.shadowGun });
  }

  updateSun() {
    const p = this.camera.position, s = this.sun;
    const snap = 96 / this.sun.shadow.mapSize.x;
    const c = new THREE.Vector3(Math.round(p.x / snap) * snap, 0, Math.round(p.z / snap) * snap);
    s.target.position.copy(c); s.position.copy(c).addScaledVector(SUN_DIR, 120);
    s.target.updateMatrixWorld();
  }

  render(dt) {
    const W = this.weapons, P = this.player, cam = this.camera, r = this.renderer;
    if (this.debugCam) { cam.position.copy(this.debugCam.pos); cam.lookAt(this.debugCam.target); this.vmRoot.visible = false; }
    this.sky.position.copy(cam.position);
    this.sky.material.uniforms.uTime.value = this.time;
    if (this.state !== 'menu') {
      const e = W.ads * W.ads * (3 - 2 * W.ads);
      cam.fov = lerp(this.baseFov, this.baseFov * W.def.adsFov, e);
      if (P.sprinting) cam.fov += 4 * W.sprintT;
      cam.updateProjectionMatrix();
      this.vmCam.fov = lerp(60, 44, e); this.vmCam.updateProjectionMatrix();
    }
    this.vmCam.position.set(0, 0, 0);
    this.vmCam.quaternion.copy(cam.quaternion);
    // 개발용: 뷰모델(손/총) 근접 점검 카메라 {pos, target} (vmCam 로컬)
    if (this.vmDebug) {
      const dc = this.vmDbgCam || (this.vmDbgCam = new THREE.PerspectiveCamera(35, 1, 0.005, 10));
      if (!dc.parent) this.vmCam.add(dc);
      dc.aspect = cam.aspect; dc.fov = this.vmDebug.fov || 35; dc.updateProjectionMatrix();
      dc.position.copy(this.vmDebug.pos); this.vmCam.updateMatrixWorld(); dc.lookAt(this.vmCam.localToWorld(this.vmDebug.target.clone()));
      this.vmPass.camera = dc;
    } else if (this.vmPass) this.vmPass.camera = this.vmCam;
    // 뷰모델 조명 (실내 여부 + 태양 가림)
    this.sunVisT = (this.sunVisT || 0) - dt;
    if (this.sunVisT <= 0) { this.sunVisT = 0.15; this.sunVis = this.world.raycast(cam.position, this.dayNight.sunDir, 150) ? 0 : 1; }
    this.vmSunK = damp(this.vmSunK ?? 1, this.sunVis ?? 1, 5, dt);
    const io = interiorFactorCPU(cam.position);
    const DN = this.dayNight, amb = clamp(DN.ambient, 0.06, 1);
    this.vmSun.intensity = 3.4 * this.vmSunK * DN.lightI / 4.2; this.vmSun.color.copy(DN.lightColor); this.vmSun.position.copy(DN.sunDir).multiplyScalar(2); this.vmSun.target.position.set(0, 0, 0); this.vmSun.target.updateMatrixWorld();
    this.vmHemi.intensity = 0.6 * io * amb;
    this.vmFill.intensity = (0.35 * io + 0.25) * amb; this.vmKey.intensity = (0.5 + 0.7 * io) * amb; this.vmFill.position.set(-DN.sunDir.x, 0.4, -DN.sunDir.z);
    this.vmScene.environmentIntensity = io;
    for (const w of W.list) w.m.group.traverse((o) => { if (o.isMesh && o.material.envMapIntensity !== undefined && !o.material.isShaderMaterial) { if (o.material.userData.env0 === undefined) o.material.userData.env0 = o.material.envMapIntensity; o.material.envMapIntensity = o.material.userData.env0 * (0.25 + 0.75 * io); } });
    // 파티클 크기 스케일
    const ps = r.getPixelRatio() * innerHeight / (2 * Math.tan(cam.fov * DEG / 2));
    // 저격 조준경 PIP 렌더
    if (W.cur.m.lens && W.ads > 0.05 && this.state !== 'menu') {
      const sc = this.scopeCam, m = W.cur.m;
      sc.position.copy(cam.position);
      sc.quaternion.copy(cam.quaternion).multiply(m.group.quaternion);
      const lensAng = 2 * Math.atan(m.lens.geometry.parameters.radius / W.def.eye) / DEG;
      sc.fov = clamp(lensAng * (cam.fov / this.vmCam.fov) / (W.def.scope || 1), 0.5, 60); sc.updateProjectionMatrix();
      this.fx.setScale(r.getPixelRatio() * 512 / (2 * Math.tan(sc.fov * DEG / 2)) / r.getPixelRatio());
      this.vmRoot.visible = false;
      r.setRenderTarget(this.scopeRT); r.render(this.scene, sc); r.setRenderTarget(null);
      this.vmRoot.visible = P.alive;
      const u = m.lens.material.uniforms;
      u.uAds.value = W.ads;
      m.group.updateMatrixWorld(true);
      const lp = m.lens.getWorldPosition(new THREE.Vector3()).project(this.vmCam);
      u.uEye.value.set(lp.x * 0.5, lp.y * 0.5);
    }
    this.fx.setScale(ps);
    // 후처리 파라미터
    const g = this.grade.uniforms;
    g.uTime.value = this.time;
    g.uDamage.value = this.damageFlash * 0.8;
    g.uSup.value = this.suppressLevel;
    g.uLow.value = P.alive ? clamp((40 - P.hp) / 40, 0, 1) : 0.6;
    g.uFlash.value = this.flashWhite;
    g.uScope.value = W.def.scope ? W.ads : 0;
    // 폭발 충격파 (화면 굴절 고리, 최대 2개)
    { const sh = this.fx.shocks, u = [g.uSh0.value, g.uSh1.value]; u[0].set(0, 0, 0, 0); u[1].set(0, 0, 0, 0);
      let j = 0;
      for (let i = sh.length - 1; i >= 0; i--) {
        const s = sh[i]; s.t += dt; const T = s.big ? 0.55 : 0.42;
        if (s.t > T) { sh.splice(i, 1); continue; }
        if (j > 1) continue;
        const d = cam.position.distanceTo(s.p), k = clamp(1 - d / (s.big ? 90 : 60), 0, 1), sp = s.p.clone().project(cam);
        if (k <= 0 || sp.z > 1 || Math.abs(sp.x) > 1.6 || Math.abs(sp.y) > 1.6) continue;
        const x = s.t / T, R = (s.big ? 16 : 10) * Math.pow(x, 0.55);
        u[j++].set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5, R / (2 * Math.max(d, 1) * Math.tan(cam.fov * DEG / 2)), 0.022 * k * Math.pow(1 - x, 1.4));
      } }
    // 빛줄기: 해의 화면 위치/가시도 (해가 낮을수록 강함)
    { const DN = this.dayNight, su = this.ssao.compMat.uniforms, sp = cam.position.clone().addScaledVector(DN.sun, 800).project(cam);
      const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).dot(DN.sun);
      su.uSunUV.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
      su.uSunVis.value = clamp((facing - 0.1) / 0.5, 0, 1) * THREE.MathUtils.smoothstep(DN.sun.y, -0.02, 0.06) * (0.55 + 1.3 * DN.tw) * (1 - DN.nvgK);
      su.uSunCol.value.copy(DN.lightColor).multiplyScalar(1.4); }
    const nu = this.nvgPass.uniforms; nu.uK.value = this.dayNight.nvgK; nu.uTime.value = this.time; nu.uGain.value = lerp(1.2, 4.5, this.dayNight.night) + this.dayNight.tw * 1.5;
    this.hud.clock(this.dayNight);
    this.composer.render(dt);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const game = new Game();
game.init().catch((e) => { console.error(e); $('loading-label').textContent = '오류: ' + e.message; });
