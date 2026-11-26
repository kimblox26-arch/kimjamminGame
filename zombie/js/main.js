// 서울 감염 — 메인: 렌더러/후처리, 게임 루프, 상태, 저장, 설정
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { buildTextures, setAniso } from './textures.js';
import { Bus, clamp, damp, lerp } from './util.js';
import { CollisionWorld } from './physics.js';
import { World } from './world.js';
import { Sky } from './sky.js';
import { AudioEngine } from './audio.js';
import { Voice } from './voice.js';
import { ItemManager, Interactions } from './items.js';
import { FX } from './fx.js';
import { ZombieManager } from './zombies.js';
import { Player } from './player.js';
import { Home, registerShelter } from './apartment.js';
import { Story, Intro } from './story.js';
import { UI, Clock } from './ui.js';
import { bakeCorpseGeo } from './human.js';

const QUALITY = {
  low: { pr: 0.6, shadow: 0, post: false, chunkR: 1, zombies: 14, trees: 0.35, far: 56, farCity: false, fog: 1.8, aniso: 2 },
  medium: { pr: 0.85, shadow: 1024, post: true, chunkR: 1, zombies: 22, trees: 0.7, far: 80, farCity: true, fog: 1.2, aniso: 4 },
  high: { pr: 1, shadow: 2048, post: true, chunkR: 2, zombies: 32, trees: 1, far: 104, farCity: true, fog: 1, aniso: 8 },
  ultra: { pr: Math.min(devicePixelRatio, 2), shadow: 4096, post: true, chunkR: 2, zombies: 45, trees: 1.3, far: 128, farCity: true, fog: 0.9, aniso: 16 }
};
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFear: { value: 0 }, uHurt: { value: 0 }, uSat: { value: 0.88 }, uVig: { value: 0.85 }, uGrain: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uFear, uHurt, uSat, uVig, uGrain; varying vec2 vUv;
  void main(){ vec2 d = vUv - 0.5; float ca = 0.0012 + uFear * 0.0025 + uHurt * 0.006;
    vec3 c = vec3(texture2D(tDiffuse, vUv + d * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d * ca).b);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, clamp(uSat - uFear * 0.3 - uHurt * 0.3, 0.0, 1.5));
    c *= mix(vec3(0.93, 1.0, 1.06), vec3(1.06, 1.0, 0.92), smoothstep(0.0, 0.8, l));
    float v = smoothstep(0.95, 0.2, length(d) * (1.0 + uFear * 0.35 + uHurt * 0.3));
    c *= mix(1.0, v, uVig); c = mix(c, c * vec3(1.3, 0.25, 0.2), uHurt * 0.55 * (1.0 - v));
    float n = fract(sin(dot(vUv * vec2(12.9898, 78.233) + fract(uTime) * 17.0, vec2(1.0))) * 43758.5453) - 0.5;
    c += n * uGrain * (0.006 + 0.014 * (1.0 - clamp(l * 3.0, 0.0, 1.0)));
    gl_FragColor = vec4(max(c, 0.0), 1.0); }`
};

class Game extends Bus {
  constructor() {
    super();
    this.settings = Object.assign({ quality: 'high', optimize: false, volume: 0.8, voice: true, subs: true, sens: 1, fov: 75, showFps: false }, this.loadJSON('sz_settings') || {});
    if (this.settings.optimize) document.getElementById('opt-optimize').checked = true;
    const canvas = document.getElementById('gl');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    const R = this.renderer; R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1; R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 16000); this.scene.add(this.camera);
    this.time = 0; this.paused = false; this.state = 'title'; this.night = 0; this.taken = new Set(); this.blinkers = []; this.vehicles = []; this.power = 1; this.exposure = 1;
    this.col = new CollisionWorld(); this.audio = new AudioEngine(); this.clock = new Clock();
    this.inter = new Interactions(); this.items = new ItemManager(this);
    this.voice = new Voice(this);
    addEventListener('resize', () => this.resize());
  }
  loadJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  get Q() { return this.settings.optimize ? QUALITY.low : QUALITY[this.settings.quality] || QUALITY.high; }
  async init() {
    const bar = document.querySelector('#load-bar i'), step = async (p) => { bar.style.width = p + '%'; await new Promise(r => setTimeout(r, 16)); };
    const q = this.Q; setAniso(Math.min(q.aniso, this.renderer.capabilities.getMaxAnisotropy()));
    await step(5); buildTextures(q.pr < 0.7 ? 0.5 : 1); await step(25);
    this.sky = new Sky(this.renderer, this.scene);
    this.fx = new FX(this); this.zombies = new ZombieManager(this);
    this.world = new World(this); this.player = new Player(this); this.ui = new UI(this);
    this.home = new Home(this); this.nav = this.home.nav; registerShelter(this);
    this.story = new Story(this); this.intro = new Intro(this);
    await step(35); this.world.corpseG = [bakeCorpseGeo(3), bakeCorpseGeo(11)];
    this.applySettings(true); await step(45);
    // 시작 지역 미리 생성
    const cx = 0, cz = 0; let n = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { this.world.gen(cx + i, cz + j); n++; await step(45 + n * 5); }
    this.player.pos.copy(this.intro.U(6.9, 0, 8.9));
    while (this.world.farJob || !this.world.far) { this.world.updateFar(this.player.pos); await step(95); }
    this.sky.update(this.clock.hours, 0, this.player.pos); this.sky.updateEnv();
    // 셰이더 미리 컴파일
    this.camera.position.copy(this.intro.U(2.2, 1.6, 11.3)); this.renderer.compile(this.scene, this.camera);
    await step(100);
    const b = document.getElementById('btn-start'); b.disabled = false; b.textContent = '게임 시작';
    b.onclick = () => this.start();
    const save = this.loadJSON('sz_save'); if (save) { const c = document.getElementById('btn-continue'); c.classList.remove('hidden'); c.onclick = () => this.start(save); }
    document.getElementById('opt-optimize').onchange = e => { this.settings.optimize = e.target.checked; this.applySettings(); };
    this.bindInput(); this.hooks();
    this.last = performance.now(); this.frames = 0; this.fpsT = 0;
    this.renderer.setAnimationLoop(() => this.loop());
  }
  applySettings(first) {
    const q = this.Q, S = this.settings, R = this.renderer;
    R.setPixelRatio(q.pr); R.setSize(innerWidth, innerHeight, false);
    R.shadowMap.enabled = q.shadow > 0; this.sky.setShadow(q.shadow, q.shadow >= 4096 ? 80 : 60);
    this.world.setQuality(q); this.zombies.max = q.zombies; this.sky.fogBase = 0.00042 * q.fog;
    this.audio.setVolume(S.volume); this.voice.enabled = S.voice; this.voice.subs = S.subs;
    if (q.post && !this.composer) this.makeComposer(); this.usePost = q.post;
    if (this.composer) { this.composer.setPixelRatio(q.pr); this.composer.setSize(innerWidth, innerHeight); this.fxaa.uniforms.resolution.value.set(1 / (innerWidth * q.pr), 1 / (innerHeight * q.pr)); }
    if (!first) { this.scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); }); this.world.farCenter = null; }
    this.camera.fov = S.fov; this.camera.updateProjectionMatrix();
    this.saveJSON('sz_settings', S);
  }
  makeComposer() {
    const c = this.composer = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.32, 0.55, 0.9); c.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader); c.addPass(this.grade);
    c.addPass(new OutputPass());
    this.fxaa = new ShaderPass(FXAAShader); c.addPass(this.fxaa);
  }
  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.applySettings(true); if (this.ui.mapOpen) { this.ui.resizeMap(); this.ui.drawMap(); } }
  bindInput() {
    const P = this.player, cv = this.renderer.domElement;
    addEventListener('keydown', e => {
      if (e.code === 'Tab') e.preventDefault();
      if (this.state === 'title') return;
      if (e.code === 'Escape') { if (this.ui.mapOpen) this.ui.openMap(false); else if (this.ui.invOpen) this.ui.openInv(false); else if (this.ui.menuOpen) this.ui.toggleMenu(false); else if (this.ui.mode === 'cine') this.ui.toggleMenu(true); return; }
      if (e.code === 'KeyM' && !e.repeat && this.state === 'play' && !this.ui.menuOpen) { this.ui.openMap(!this.ui.mapOpen); return; }
      if (e.code === 'Tab' && !e.repeat && this.state === 'play' && !this.ui.menuOpen && !this.ui.mapOpen) { this.ui.openInv(!this.ui.invOpen); return; }
      if (e.code === 'F9') { this.godMode = !this.godMode; this.ui.notify('개발자 무적 ' + (this.godMode ? 'ON' : 'OFF')); }
      if (!this.paused && !e.repeat) P.key(e.code, true);
      if (!this.paused) P.keys[e.code] = true;
    });
    addEventListener('keyup', e => { P.keys[e.code] = false; });
    addEventListener('mousemove', e => { if (document.pointerLockElement === cv && !this.paused) { if (P.vehicle) P.camYaw -= e.movementX * 0.003; else P.look(e.movementX, e.movementY); } });
    cv.addEventListener('mousedown', e => { if (this.state === 'play' && !this.paused && document.pointerLockElement !== cv) { this.requestLock(); return; } if (e.button === 0) P.mouse.l = true; if (e.button === 2) P.mouse.r = true; });
    addEventListener('mouseup', e => { if (e.button === 0) P.mouse.l = false; if (e.button === 2) P.mouse.r = false; });
    addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== cv && this.state === 'play' && !this.paused && !this.ui.mapOpen && !this.ui.invOpen && !this.player.dead && !this._noMenu) this.ui.toggleMenu(true);
    });
    addEventListener('blur', () => { for (const k in P.keys) P.keys[k] = false; P.mouse.l = P.mouse.r = false; });
  }
  requestLock() { const cv = this.renderer.domElement; if (document.pointerLockElement !== cv) { try { const r = cv.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (e) { } } }
  start(save) {
    this.audio.init(); this.audio.ctx.resume(); this.applySettings(true);
    document.getElementById('title-screen').classList.add('hidden');
    this.ambLoops = [this.audio.loop('wind', { amb: true, vol: 0.35 })];
    if (save) { this.loadGame(save); return; }
    this.state = 'intro'; this.intro.play().catch(e => console.error(e));
  }
  hooks() {
    this.on('zkill', ({ part }) => { const P = this.player; P.kills++; P.stress = clamp(P.stress + 3, 0, 100); if (P.kills === 1) P.mono('firstKill', true); else if (P.kills % 15 === 0) P.mono('kills', true); });
  }
  // 인트로 종료 후 setMode('play') 호출 시 상태 동기화
  get playing() { return this.ui.mode === 'play'; }
  loop() {
    const now = performance.now(); let dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    this.frames++; this.fpsT += dt; if (this.fpsT > 0.5) { document.getElementById('fps').textContent = `${Math.round(this.frames / this.fpsT)} FPS · 좀비 ${this.zombies.list.filter(z => !z.dead).length} · 청크 ${this.world.chunks.size}`; this.frames = 0; this.fpsT = 0; }
    if (this.state === 'title') { this.renderFrame(dt); return; }
    if (this.state === 'intro' && this.playing) this.state = 'play';
    if (!this.paused) for (let i = 0; i < (this.timeScale || 1); i++) this.step(dt);
    this.renderFrame(dt);
  }
  step(dt) {
    this.time += dt;
    this.clock.min += dt; // 현실 1초 = 게임 1분
    const P = this.player, h = this.clock.hours;
    this.intro.update(dt);
    P.update(dt);
    const focus = P.vehicle ? P.vehicle.pos : P.pos;
    this.world.update(dt, focus, this.time);
    this.zombies.update(dt);
    for (const v of this.vehicles) if (!v.driving) v.update(dt, {});
    this.home.update(dt, this.time);
    this.fx.update(dt);
    this.blinkers.forEach(f => f(this.time));
    this.story.update(dt);
    // 실내 판정
    this._inT = (this._inT || 0) - dt;
    if (this._inT < 0) { this._inT = 0.4; const e = this.camera.position; this._inRay = this.col.ray(e.x, e.y + 0.2, e.z, 0, 1, 0, 25) < 25 ? 1 : 0; }
    P.indoor = damp(P.indoor, this._inRay || 0, 3, dt); this.audio.setIndoor(P.indoor);
    // 시간대·날씨·정전
    this.sky.update(h, dt, focus, P.indoor);
    this.night = 1 - this.sky.dayF;
    const day = this.clock.day; if (day >= 2 || h >= 21) this.power = Math.max(0, this.power - dt * 0.2);
    this.world.setNight(this.night, 0.15 + this.power * 0.85);
    this.weatherT = (this.weatherT ?? 300) - dt;
    if (this.weatherT < 0) { this.weatherT = 200 + Math.random() * 400; const rain = day >= 2 && Math.random() < 0.45; if (rain !== this.fx.rainOn) { this.fx.rainOn = rain; if (rain) this.rainSnd = this.audio.loop('rain', { amb: true, vol: 0.6, fade: 4 }); else if (this.rainSnd) { this.rainSnd.stop(4); this.rainSnd = null; } } this.sky.cloud = rain ? 0.9 : 0.35 + Math.random() * 0.4; }
    if (this.night > 0.6 && !this.crickets && P.indoor < 0.5) this.crickets = this.audio.loop('crickets', { amb: true, vol: 0.25 }); else if ((this.night < 0.4 || P.indoor > 0.5) && this.crickets) { this.crickets.stop(); this.crickets = null; }
    if (!this.nightSaid && this.night > 0.7 && this.playing) { this.nightSaid = true; P.mono('night', true); }
    this.audio.chaos = this.playing ? (P.indoor > 0.5 ? 0.6 : 1) : 0.8;
    if (this.state !== 'title') this.audio.update(dt);
    if (!this.intro.active) this.audio.listen(this.camera);
    this.ui.update(dt);
  }
  renderFrame(dt) {
    const P = this.player;
    // 노출 적응(실내/밤)
    const tgt = (1 + P.indoor * 0.45) * (1 + this.night * 0.8) * (this.state === 'title' ? 1 : 1);
    this.exposure = damp(this.exposure, tgt, 0.8, dt || 0.016); this.renderer.toneMappingExposure = this.exposure;
    if (this.usePost && this.composer) {
      const u = this.grade.uniforms; u.uTime.value = this.time; u.uFear.value = (P.fear / 100) ** 1.5; u.uHurt.value = clamp(1 - P.hp / 100, 0, 1) ** 2 * 0.8 + (this.time - P.lastHurt < 0.5 && P.lastHurt ? 0.4 : 0);
      this.bloom.strength = 0.25 + this.night * 0.3;
      this.composer.render(dt);
    } else this.renderer.render(this.scene, this.camera);
  }
  onDeath(src) {
    this.ui.death(`생존 ${this.clock.day}일차 · ${this.clock.short()} · 처치한 감염자 ${this.player.kills}명`);
    this.audio.play('bodyfall'); this.zombies.ignorePlayer = true;
  }
  retry() {
    const s = this.loadJSON('sz_save'); if (s) { document.getElementById('death').classList.add('hidden'); this.loadGame(s); } else location.reload();
  }
  ending() { this.ui.ending(`부산항에 도착했다. 피난선의 경적이 울린다.<br>생존 ${this.clock.day}일 · 처치 ${this.player.kills}명<br><small>이후로도 자유롭게 탐험할 수 있습니다.</small>`); this.paused = true; }
  saveGame(auto) {
    const P = this.player, h = this.home;
    const s = { v: 1, p: P.save(), clock: this.clock.min, story: this.story.save(), taken: [...this.taken], power: this.power,
      home: { tub: h.tubFill, door: { locked: h.door.locked, barricade: h.door.barricade, broken: h.door.broken, hp: h.door.hp }, kn: h.knife.visible, fl: h.fl.visible, mk: h.mk.visible, rd: h.rd.visible, bat: h.bat.visible }, obj: this.objective ? { name: this.objective.name, pos: this.objective.pos.toArray() } : null };
    this.saveJSON('sz_save', s); this.ui.notify(auto ? '자동 저장됨' : '저장되었습니다');
  }
  loadGame(s) {
    this._noMenu = true; this.zombies.clear(); this.zombies.ignorePlayer = false;
    this.intro.active = false; this.intro.done = true;
    this.clock.min = s.clock; this.taken = new Set(s.taken); this.power = s.power ?? 1;
    const h = this.home; h.tubFill = s.home.tub; h.tubWater.visible = h.tubFill > 0; h.tubWater.position.y = 6 + 0.06 + h.tubFill * 0.4;
    Object.assign(h.door, s.home.door); if (h.door.broken) h.door.breakOpen(); h.door.box.on = !h.door.broken; h.cabMove = h.door.barricade ? 1 : 0;
    h.knife.visible = s.home.kn; h.fl.visible = s.home.fl; h.mk.visible = s.home.mk; h.rd.visible = s.home.rd; h.bat.visible = s.home.bat; h.phone.visible = false; h.setTV('off');
    this.player.load(s.p); this.player.enabled = true; this.player.eyeSmooth = 0;
    if (s.obj) this.objective = { name: s.obj.name, pos: new THREE.Vector3().fromArray(s.obj.pos) };
    this.world.preload(this.player.pos.x, this.player.pos.z, 1);
    this.story.load(s.story); if (this.story.done.has('leave') || this.story.idx >= 7) this.zombies.autoSpawn = true;
    if (this.story.cur && this.story.cur.id === 'escape') { /* 이미 시작된 탈출 이벤트 재개 */ }
    this.state = 'play'; this.ui.setMode('play'); this.paused = false; this.ui.fade(1, 0); this.ui.fade(0, 1);
    document.getElementById('death').classList.add('hidden');
    setTimeout(() => { this._noMenu = false; this.requestLock(); }, 300);
  }
}

const game = new Game(); window.game = game;
game.init().catch(e => { console.error(e); const b = document.getElementById('btn-start'); b.textContent = '오류: ' + e.message; });
