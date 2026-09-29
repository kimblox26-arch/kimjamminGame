// OPERATION KIMJAMMIN — 1인칭 전술 FPS 메인 루프
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';

import { buildTextures } from './textures.js';
import { World, interiorFactorCPU } from './world.js';
import { WeaponSystem } from './weapons.js';
import { Player } from './player.js';
import { FX, Ballistics } from './fx.js';
import { Bots } from './bots.js';
import { HUD } from './hud.js';
import { Audio } from './audio.js';
import { clamp, lerp, damp, rand, DEG } from './core.js';

const $ = (id) => document.getElementById(id);
const SUN_DIR = new THREE.Vector3(-0.52, 0.62, 0.42).normalize();

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

// 뷰모델 패스: 깊이만 지우고 총/팔을 월드 위에 그림 (벽 관통 방지)
class ViewmodelPass extends Pass {
  constructor(scene, camera) { super(); this.scene = scene; this.camera = camera; this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) {
    const ac = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }
}

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.32 }, uDamage: { value: 0 }, uSup: { value: 0 }, uGrain: { value: 0.035 }, uCA: { value: 0.0025 }, uSat: { value: 1.08 }, uLow: { value: 0 }, uFlash: { value: 0 }, uScope: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVig, uDamage, uSup, uGrain, uCA, uSat, uLow, uFlash, uScope; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 uv = vUv, c = uv - 0.5; float r = length(c);
      float ca = uCA * (1.0 + uSup*3.0) * r;
      vec3 col = vec3(texture2D(tDiffuse, uv - c*ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv + c*ca).b);
      float bl = uSup*0.6 + uLow*0.35;
      if (bl > 0.01) {
        vec3 b = vec3(0.); float s = 0.0035 * smoothstep(0.1, 0.6, r);
        for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398; b += texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * s * (1.0 + mod(float(i), 2.0))).rgb; }
        col = mix(col, b*0.125, clamp(bl * smoothstep(0.12, 0.55, r), 0., 1.));
      }
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(vec3(l), col, uSat - uSup*0.35 - uLow*0.55);
      col = mix(col, col*col*(3.0-2.0*col), 0.25);
      col *= vec3(1.02, 1.0, 0.97);
      col *= 1.0 - uVig*smoothstep(0.3, 0.95, r) - uSup*0.45*smoothstep(0.15, 0.75, r) - uScope*0.25*smoothstep(0.2,0.7,r);
      col = mix(col, vec3(0.42,0.0,0.0), clamp(uDamage*smoothstep(0.2, 0.8, r) + uLow*0.25*smoothstep(0.3,0.9,r), 0., 0.85));
      col += (h(uv*vec2(1920.,1080.) + fract(uTime)*97.) - 0.5) * uGrain;
      col += uFlash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const SkyShader = {
  uniforms: { uSun: { value: SUN_DIR.clone() }, uTime: { value: 0 }, uDisk: { value: 1 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize((modelMatrix*vec4(position,0.)).xyz); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }`,
  fragmentShader: `uniform vec3 uSun; uniform float uTime, uDisk; varying vec3 vDir;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    float fbm(vec2 p){ float s = 0., a = .5; for(int i=0;i<5;i++){ s += noise(p)*a; p *= 2.02; a *= .5; } return s; }
    void main(){
      vec3 d = normalize(vDir); float h = d.y;
      vec3 zen = vec3(0.11,0.26,0.62), hor = vec3(0.62,0.7,0.78);
      vec3 col = mix(hor, zen, pow(clamp(h,0.,1.), 0.45));
      float sd = max(dot(d, uSun), 0.);
      col += vec3(1.0,0.62,0.32) * pow(sd, 6.) * 0.45 * (1. - clamp(h,0.,1.));
      col += vec3(1.0,0.85,0.6) * pow(sd, 120.) * 1.6;
      col += vec3(40.,34.,26.) * smoothstep(0.99955, 0.99975, sd) * uDisk;
      if (h > 0.0) {
        vec2 uv = d.xz / (h + 0.12) * 1.3 + vec2(uTime*0.004, uTime*0.0015);
        float c = smoothstep(0.48, 0.82, fbm(uv*1.2));
        float c2 = smoothstep(0.55, 0.9, fbm(uv*3.1 + 7.));
        vec3 cc = mix(vec3(1.05,1.0,0.97), vec3(0.58,0.6,0.66), c*0.6) + vec3(1.0,0.7,0.45)*pow(sd,5.)*0.6;
        col = mix(col, cc, (c*0.85 + c2*0.25) * smoothstep(0.0, 0.18, h));
      }
      vec3 ground = vec3(0.23,0.21,0.18);
      col = mix(col, mix(hor*0.85, ground, smoothstep(0.0, 0.25, -h)), step(h, 0.0));
      gl_FragColor = vec4(col, 1.);
    }`,
};

const QUALITY = {
  low: { pr: 0.75, shadow: 1024, msaa: 0, bloom: false },
  medium: { pr: 1, shadow: 2048, msaa: 2, bloom: true },
  high: { pr: Math.min(devicePixelRatio, 1.5), shadow: 4096, msaa: 4, bloom: true },
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
    const d = { sens: 1, adsSens: 0.8, fov: 90, vol: 0.8, quality: 'high', invertY: false, showFps: false };
    try { return { ...d, ...JSON.parse(localStorage.getItem('kj-fps-settings') || '{}') }; } catch { return d; }
  }
  saveSettings() { try { localStorage.setItem('kj-fps-settings', JSON.stringify(this.settings)); } catch {} }

  async init() {
    const canvas = $('gl');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.input = new Input(canvas);
    this.setLoad(0.02, '텍스처 생성');
    await buildTextures((p, n) => this.setLoad(0.02 + p * 0.55, `텍스처 생성 · ${n}`));

    // 씬/카메라
    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x9aa6ae, 0.0055);
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.03, 1500);
    this.camera.rotation.order = 'YXZ';
    scene.add(this.camera);
    const sky = this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), new THREE.ShaderMaterial({ ...SkyShader, uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms), side: THREE.BackSide, depthWrite: false, fog: false }));
    sky.renderOrder = -10; sky.frustumCulled = false;
    scene.add(sky);
    // 조명
    this.hemi = new THREE.HemisphereLight(0xc4d6ee, 0x6a5a44, 0.55); scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xffe0bc, 3.4);
    sun.castShadow = true;
    const sc = sun.shadow.camera; sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 1; sc.far = 260;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035;
    scene.add(sun, sun.target);
    // 환경맵 (하늘 → PMREM)
    this.setLoad(0.6, '환경광 계산');
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({ ...SkyShader, uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms), side: THREE.BackSide, depthWrite: false }));
    envSky.material.uniforms.uDisk.value = 0.05;
    envScene.add(envSky);
    const pmrem = new THREE.PMREMGenerator(r);
    this.env = pmrem.fromScene(envScene, 0.02).texture;
    scene.environment = this.env;

    // 월드
    this.setLoad(0.65, '맵 구축');
    await tick();
    this.world = new World(scene);
    this.world.build();
    this.lamps = this.world.lamps.map((p) => { const l = new THREE.PointLight(0xffd7a0, 28, 26, 2); l.position.copy(p); scene.add(l); return l; });
    // 전역 재질 환경광 강도
    scene.traverse((o) => { if (o.isMesh && o.material && 'envMapIntensity' in o.material && !o.material.userData.keepEnv) o.material.envMapIntensity = 0.75; });

    // 뷰모델 씬
    this.setLoad(0.8, '총기 모델링');
    await tick();
    const vmScene = this.vmScene = new THREE.Scene();
    vmScene.environment = this.env;
    this.vmCam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 10);
    this.vmCam.rotation.order = 'YXZ';
    vmScene.add(this.vmCam);
    this.vmRoot = new THREE.Group(); this.vmCam.add(this.vmRoot);
    this.vmHemi = new THREE.HemisphereLight(0xc4d6ee, 0x5a4a38, 0.6); vmScene.add(this.vmHemi);
    this.vmSun = new THREE.DirectionalLight(0xffe0bc, 3.0); vmScene.add(this.vmSun, this.vmSun.target);
    this.vmFill = new THREE.DirectionalLight(0x8fa6c8, 0.5); vmScene.add(this.vmFill);
    // 카메라 기준 키 라이트 (총기 윤곽 하이라이트)
    this.vmKey = new THREE.DirectionalLight(0xfff4e8, 1.1); this.vmKey.position.set(-0.6, 1, 0.4); this.vmCam.add(this.vmKey); this.vmKey.target.position.set(0.1, -0.1, -0.4); this.vmCam.add(this.vmKey.target);

    this.fx = new FX(this);
    this.ballistics = new Ballistics(this);
    this.player = new Player(this);
    this.weapons = new WeaponSystem(this);
    this.bots = new Bots(this);
    this.hud = new HUD(this);
    this.hud.weapon(this.weapons.cur);
    // 탄약 드랍 픽업
    this.pickups = [];
    this.pickupGeo = new THREE.BoxGeometry(0.22, 0.12, 0.14);
    this.pickupMat = new THREE.MeshStandardMaterial({ color: 0x4a5536, roughness: 0.7, emissive: 0x223311, emissiveIntensity: 0.4 });

    // 저격 조준경 PIP
    this.scopeRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, samples: 2 });
    this.scopeCam = new THREE.PerspectiveCamera(4, 1, 0.1, 1500);
    this.scopeCam.rotation.order = 'YXZ';
    const awm = this.weapons.list.find((w) => w.def.scope);
    if (awm) awm.m.lens.material.uniforms.tScene.value = this.scopeRT.texture;

    this.setupComposer();
    this.applySettings();
    addEventListener('resize', () => this.resize());
    this.resize();
    this.setLoad(0.95, '셰이더 컴파일');
    await tick();
    this.bots.spawn(1); this.bots.spawn(1);
    this.fx.explosion(new THREE.Vector3(0, -50, 0)); this.fx.clear();
    r.compile(scene, this.camera); r.compile(vmScene, this.vmCam);
    this.bots.clear();
    this.setLoad(1, '준비 완료');
    this.bindUI();
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
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new ViewmodelPass(this.vmScene, this.vmCam));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.32, 0.45, 0.92);
    this.bloom.enabled = q.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
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
    }
    Audio.setVolume(s.vol);
    $('fps').style.display = s.showFps ? 'block' : 'none';
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
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
    this.hud.message(mode === 'training' ? '훈련 모드 — 표적은 반격하지 않습니다' : '작전 개시', 2.5, 'big');
  }

  reset() {
    this.bots.clear(); this.fx.clear(); this.ballistics.clear();
    for (const p of this.pickups) this.scene.remove(p.m);
    this.pickups = [];
    for (const c of this.world.glass) { c.disabled = false; c.glass.visible = true; }
    for (const b of this.world.barrels) { b.exploded = false; b.hp = 30; b.col.disabled = false; b.mesh.visible = true; }
    this.player.reset(this.world.playerSpawn);
    this.weapons.list.forEach((w) => { w.ammo = w.def.mag + (w.def.action === 'rifle' || w.def.action === 'ak' || w.def.action === 'pistol' ? 1 : 0); w.reserve = w.def.reserve; w.locked = false; w.needsCycle = false; });
    this.weapons.anim = null; this.weapons.shotgunLoading = false;
    this.weapons.equip(0, true);
    this.stats = { kills: 0, heads: 0, shots: 0, hits: 0 };
    this.wave = 0; this.score = 0; this.toSpawn = 0; this.waveBreak = 3; this.time = 0;
    this.dmgScale = 1;
    this.hud.ammo(this.weapons.cur);
  }

  pause() { if (this.state !== 'playing') return; this.state = 'paused'; this.showScreen('pause'); }
  resume() { if (this.input.forceLock) { this.state = 'playing'; this.showScreen('game'); } else this.lock(); }
  toMenu() { this.state = 'menu'; this.bots.clear(); this.showScreen('menu'); if (document.pointerLockElement) document.exitPointerLock(); }

  onPlayerDeath() {
    this.state = 'dying';
    setTimeout(() => {
      this.state = 'dead';
      if (document.pointerLockElement) document.exitPointerLock();
      const acc = this.stats.shots ? Math.round(this.stats.hits / this.stats.shots * 100) : 0;
      $('death-stats').innerHTML = `<div><b>${this.wave}</b><span>도달 웨이브</span></div><div><b>${this.stats.kills}</b><span>사살</span></div><div><b>${this.stats.heads}</b><span>헤드샷</span></div><div><b>${acc}%</b><span>명중률</span></div><div><b>${this.score}</b><span>점수</span></div>`;
      this.showScreen('dead');
    }, 2600);
  }

  // ── 전투 이벤트 ──
  hitBot(hit, dmg, dir, def) {
    const b = hit.bot, head = hit.zone === 'head';
    const mul = head ? def.headMul : hit.zone === 'arm' || hit.zone === 'leg' ? def.limbMul : 1;
    const killed = b.damage(dmg * mul, hit.zone, dir, hit.point);
    this.stats.hits++;
    this.fx.blood(hit.point, dir, head);
    this.hud.hitmarker(killed, head);
    Audio.play(head ? 'headshot' : 'hitmark', { vol: head ? 0.55 : 0.5, bus: 'ui' });
    if (killed) {
      this.stats.kills++; if (head) this.stats.heads++;
      this.score += 100 + (head ? 50 : 0) + this.wave * 10;
      Audio.play('kill', { vol: 0.35, bus: 'ui' });
      this.hud.kill('적 소총수', def.name, head);
      this.dropPickup(b.pos);
    }
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
    for (const b of this.bots.list) {
      if (!b.alive) continue;
      const d = b.pos.distanceTo(p);
      if (d < R && this.world.los(p, b.eye().clone().setY(b.pos.y + 1))) {
        const dmg = 180 * (1 - d / R) + 20;
        const dir = b.pos.clone().sub(p).setY(0.3).normalize();
        if (b.damage(dmg, 'torso', dir)) { this.stats.kills++; this.score += 120; this.hud.kill('적 소총수', '폭발', false); this.dropPickup(b.pos); this.hud.hitmarker(true, false); }
      }
    }
    const P = this.player, dp = P.eye.distanceTo(p);
    if (dp < R * 1.2 && this.world.los(p, P.eye)) P.damage(110 * Math.max(0, 1 - dp / (R * 1.2)), p, 'explosion');
    const k = clamp(1 - dp / 40, 0, 1);
    P.shake = Math.min(1.2, P.shake + k * 1.4);
    this.flashWhite = k * 0.35;
    if (k > 0.5) Audio.deafen(0.85 * k, 2.5);
    for (const o of this.world.barrels) if (!o.exploded && o.pos.distanceTo(p) < 4) setTimeout(() => this.explode(o), 120 + Math.random() * 180);
    for (const c of this.world.glass) if (!c.disabled && c.glass.position.distanceTo(p) < 10) this.fx.glassBreak(c, c.glass.position, c.glass.position.clone().sub(p).normalize());
  }

  alert(pos, r) { this.bots.alert(pos, r); }
  suppress(k) { this.suppressLevel = Math.min(1, this.suppressLevel + k); }

  dropPickup(pos) {
    if (Math.random() > 0.75) return;
    const m = new THREE.Mesh(this.pickupGeo, this.pickupMat);
    m.position.set(pos.x + rand(-0.4, 0.4), pos.y + 0.06, pos.z + rand(-0.4, 0.4)); m.rotation.y = rand(0, 6); m.castShadow = true;
    this.scene.add(m);
    this.pickups.push({ m, t: 30 });
  }

  // ── 웨이브 ──
  updateWaves(dt) {
    if (this.mode === 'training') {
      if (this.bots.alive() < 6) { this.spawnT -= dt; if (this.spawnT <= 0) { this.bots.spawn(1); this.spawnT = 1.5; } }
      this.hud.stats('∞', this.bots.alive(), this.score);
      return;
    }
    const alive = this.bots.alive();
    if (this.toSpawn <= 0 && alive === 0) {
      if (this.waveBreak <= 0) {
        this.wave++;
        this.toSpawn = 3 + this.wave * 2;
        this.dmgScale = 1 + (this.wave - 1) * 0.06;
        this.hud.message(`<small>WAVE</small> ${this.wave}`, 3, 'big');
        Audio.play('wave', { vol: 0.5, bus: 'ui' });
        if (this.wave > 1) { for (const w of this.weapons.list) w.reserve = Math.min(w.def.reserve * 1.5, w.reserve + Math.ceil(w.def.reserve * 0.35)); this.hud.ammo(this.weapons.cur); }
        this.waveBreak = 8;
      } else this.waveBreak -= dt;
    }
    if (this.toSpawn > 0 && alive < Math.min(8, 3 + this.wave)) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this.bots.spawn(this.wave); this.toSpawn--; this.spawnT = rand(1.5, 4); }
    }
    this.hud.stats(this.wave, alive + this.toSpawn, this.score);
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
    P.update(dt, I);
    // 벽 근접 거리 (무기 들어올림)
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const wh = this.world.raycast(this.camera.position, fwd, 1.2, { ignoreGlass: false });
    this.wallDist = wh ? wh.t : null;
    // 탄약 보급
    this.nearAmmo = this.world.ammoCrates.some((c) => c.distanceTo(P.pos.clone().setY(0.5)) < 1.8);
    if (this.nearAmmo) {
      this.hud.prompt('[F] 탄약 보급');
      if (I.pressed('KeyF')) { for (const w of W.list) w.reserve = w.def.reserve; Audio.play('pickup', { vol: 0.5, bus: 'ui' }); Audio.play('magin', { vol: 0.6 }); this.hud.ammo(W.cur); this.hud.message('탄약 보급 완료', 1.4); }
    } else this.hud.prompt('');
    if (P.alive) W.update(dt, I);
    if (this.mode === 'training') for (const w of W.list) w.reserve = w.def.reserve;
    // 픽업
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i]; pk.t -= dt; pk.m.rotation.y += dt;
      if (pk.m.position.distanceTo(P.pos) < 1.3 && P.alive) {
        const w = W.cur; w.reserve += Math.ceil(w.def.mag * (w.def.mag < 10 ? 1 : 0.7));
        const pistol = W.list[2]; if (pistol !== w) pistol.reserve += 8;
        Audio.play('pickup', { vol: 0.5, bus: 'ui' }); this.hud.ammo(w); this.hud.message(`+ 탄약 (${w.def.name})`, 1.2);
        pk.t = 0;
      }
      if (pk.t <= 0) { this.scene.remove(pk.m); this.pickups.splice(i, 1); }
    }
    this.ballistics.update(dt);
    this.bots.update(dt);
    this.fx.update(dt);
    this.updateWaves(dt);
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

  updateSun() {
    const p = this.camera.position, s = this.sun;
    const snap = 96 / this.sun.shadow.mapSize.x;
    const c = new THREE.Vector3(Math.round(p.x / snap) * snap, 0, Math.round(p.z / snap) * snap);
    s.target.position.copy(c); s.position.copy(c).addScaledVector(SUN_DIR, 120);
    s.target.updateMatrixWorld();
  }

  render(dt) {
    const W = this.weapons, P = this.player, cam = this.camera, r = this.renderer;
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
    // 뷰모델 조명 (실내 여부 + 태양 가림)
    this.sunVisT = (this.sunVisT || 0) - dt;
    if (this.sunVisT <= 0) { this.sunVisT = 0.15; this.sunVis = this.world.raycast(cam.position, SUN_DIR, 150) ? 0 : 1; }
    this.vmSunK = damp(this.vmSunK ?? 1, this.sunVis ?? 1, 5, dt);
    const io = interiorFactorCPU(cam.position);
    this.vmSun.intensity = 3.0 * this.vmSunK; this.vmSun.position.copy(SUN_DIR); this.vmSun.target.position.set(0, 0, 0);
    this.vmHemi.intensity = 0.6 * io;
    this.vmFill.intensity = 0.35 * io + 0.25; this.vmKey.intensity = 0.5 + 0.7 * io; this.vmFill.position.set(-SUN_DIR.x, 0.4, -SUN_DIR.z);
    this.vmScene.environmentIntensity = io;
    for (const w of W.list) w.m.group.traverse((o) => { if (o.isMesh && o.material.envMapIntensity !== undefined && !o.material.isShaderMaterial) { if (o.material.userData.env0 === undefined) o.material.userData.env0 = o.material.envMapIntensity; o.material.envMapIntensity = o.material.userData.env0 * (0.25 + 0.75 * io); } });
    // 파티클 크기 스케일
    const ps = r.getPixelRatio() * innerHeight / (2 * Math.tan(cam.fov * DEG / 2));
    // 저격 조준경 PIP 렌더
    if (W.def.scope && W.ads > 0.05 && this.state !== 'menu') {
      const sc = this.scopeCam, m = W.cur.m;
      sc.position.copy(cam.position);
      sc.quaternion.copy(cam.quaternion).multiply(m.group.quaternion);
      sc.fov = 22 / W.def.scope; sc.updateProjectionMatrix();
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
    this.composer.render(dt);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const game = new Game();
game.init().catch((e) => { console.error(e); $('loading-label').textContent = '오류: ' + e.message; });
