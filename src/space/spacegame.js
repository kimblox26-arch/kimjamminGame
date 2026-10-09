// FREE FREELY 우주 탐사 - 모드 컨트롤러
// 부동 원점: 카메라는 항상 월드 원점에 있고, 모든 천체·타일·함선 위치를 매 프레임 Float64 계층 좌표에서
// 카메라 기준으로 다시 계산한다 (정밀도 떨림 없음). 로그 깊이 버퍼로 수 m ~ 수십억 광년을 한 번에 그린다.
import * as THREE from 'three';
import { Settings } from '../core/settings.js';
import { Audio } from '../core/audio.js';
import { Effects } from '../fx/effects.js';
import { buildUniverse, updateBodies, computeRelative, posInFrame, velInFrame, START_POINTS } from './universe.js';
import { TIERS, C_LIGHT, LY, AU, L_SUN, blackbody, formatDistance, G0 } from './consts.js';
import { TileScheduler } from './tiles.js';
import { makeDetailTexture, makeCloudNoise3D } from './textures.js';
import { PlanetView } from './planet.js';
import { StarView } from './star.js';
import { GalaxyView, Starfield, NebulaView, BlackHoleView } from './galaxy.js';
import { buildShipModel } from './shipmodel.js';
import { ShipFlight } from './flight.js';
import { createSpaceComposer } from './postfx.js';
import { SpaceHUD } from './spacehud.js';
import { NavMap } from './navmap.js';
import { PreviewCache } from './preview.js';
import { SpaceAudio } from './spaceaudio.js';
import { SurfaceScatter, ParticleField } from './scatter.js';
import { atmosphereAt } from './atmos.js';
import { loadSpaceKeys } from './keys.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m3 = new THREE.Matrix3();
const _atm = {};

const QUALITY = {
  low: { scale: 0.7, galaxy: 50000, galaxyOther: 14000, stars: 14000, shadows: 0, bloom: 0.45 },
  medium: { scale: 0.85, galaxy: 110000, galaxyOther: 30000, stars: 30000, shadows: 1024, bloom: 0.55 },
  high: { scale: 1.0, galaxy: 180000, galaxyOther: 50000, stars: 50000, shadows: 2048, bloom: 0.6 },
  ultra: { scale: 1.2, galaxy: 260000, galaxyOther: 80000, stars: 80000, shadows: 4096, bloom: 0.65 },
};

const ENV_VS = `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const ENV_FS = `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uGround; uniform vec3 uSun; uniform vec3 uSunCol; varying vec3 vD;
void main(){ vec3 d = normalize(vD); float e = d.y; vec3 c = e > 0.0 ? mix(uHor, uTop, pow(e, 0.5)) : mix(uHor, uGround, pow(-e, 0.35));
c += uSunCol * pow(max(0.0, dot(d, uSun)), 300.0) * 40.0 + uSunCol * pow(max(0.0, dot(d, uSun)), 8.0) * 0.4; gl_FragColor = vec4(c, 1.0); }`;

export class SpaceGame {
  constructor(app) {
    this.app = app;
    this.ready = false;
    this.active = false;
    this.paused = false;
    this.time = 0;
    this.keys = loadSpaceKeys();
    this.view = 'chase';
    this.orbitOn = true;
    this.target = null;
    this.look = { yaw: 0, pitch: 0 };
    this.camQuat = new THREE.Quaternion();
    this.camOff = new THREE.Vector3();
    this.fov = 70;
    this.shake = 0;
    this.flash = 0;
    this.warpVis = 0;
    this.blurVis = 0;
    this.mouseAxes = { pitch: 0, yaw: 0 };
    this.virtual = { pitch: 0, roll: 0, throttle: null };
    this.warnings = [];
    this._accum = 0;
    this._envT = 0;
    this._lastNear = null;
    this.crashTimer = 0;
  }

  sfx(kind) { if (Audio.ready) Audio.ui(kind); }

  /* ------------------------------ 초기화 ------------------------------ */
  async init(progress = () => {}) {
    if (this.ready) return;
    const tick = () => new Promise((r) => setTimeout(r, 0));
    progress(0.02, '우주 렌더러 초기화');
    const canvas = document.getElementById('gl-space');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.08, 1e27);
    this.quality = Settings.get('quality') || 'medium';
    const Q = QUALITY[this.quality] || QUALITY.medium;
    this._applyPixelRatio();

    progress(0.08, '절차적 텍스처 생성');
    await tick();
    this.detailTex = makeDetailTexture(256, 7);
    progress(0.16, '3D 구름 노이즈 생성');
    await tick();
    this.cloudTex = makeCloudNoise3D(64, 3);

    progress(0.3, '천체 데이터 구성');
    await tick();
    this.uni = buildUniverse();
    this.scheduler = new TileScheduler();
    const ctx = { scene: this.scene, scheduler: this.scheduler, detailTex: this.detailTex, cloudTex: this.cloudTex };
    this.ctx = ctx;
    this.views = new Map();
    this.planets = [];
    this.stars = [];
    this.galaxies = [];
    this.misc = [];
    let i = 0;
    for (const b of this.uni.bodies) {
      if (b.kind === 'planet' || b.kind === 'moon') { const v = new PlanetView(b, ctx); this.views.set(b, v); this.planets.push(v); }
      else if (b.kind === 'star') { const v = new StarView(b, ctx); this.views.set(b, v); this.stars.push(v); }
      else if (b.kind === 'nebula') { const v = new NebulaView(b, ctx); this.views.set(b, v); this.misc.push(v); }
      else if (b.kind === 'blackhole') { const v = new BlackHoleView(b, ctx); this.views.set(b, v); this.misc.push(v); }
      if (++i % 6 === 0) { progress(0.3 + (i / this.uni.bodies.length) * 0.25, '행성 생성: ' + b.name); await tick(); }
    }
    for (const b of this.uni.bodies) {
      if (b.kind !== 'galaxy') continue;
      progress(0.58 + this.galaxies.length * 0.04, '은하 생성: ' + b.name);
      await tick();
      const v = new GalaxyView(b, ctx, b.id === 'milkyway' ? Q.galaxy : Math.round(Q.galaxyOther * (b.gtype === 'elliptical' ? 0.5 : 1)));
      this.views.set(b, v);
      this.galaxies.push(v);
    }
    this.starfield = new Starfield(ctx, Q.stars);

    progress(0.86, '함선 조립');
    await tick();
    this.model = buildShipModel();
    this.scene.add(this.model.root);
    this.flight = new ShipFlight();
    this.flight.model = this.model;
    // 조명 (함선·식생용 표준 재질)
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -18; sc.right = 18; sc.top = 18; sc.bottom = -18; sc.near = 1; sc.far = 120;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x8899aa, 0x332211, 0.0);
    this.scene.add(this.hemi);
    this.engineLight = new THREE.PointLight(0xff9a50, 0, 80, 2);
    this.scene.add(this.engineLight);
    this.model.root.traverse((o) => { if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });
    // 환경 맵 (선체 반사)
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envScene = new THREE.Scene();
    this.envMat = new THREE.ShaderMaterial({
      vertexShader: ENV_VS, fragmentShader: ENV_FS, side: THREE.BackSide, depthWrite: false,
      uniforms: { uTop: { value: new THREE.Vector3() }, uHor: { value: new THREE.Vector3() }, uGround: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Vector3(1, 1, 1) } },
    });
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), this.envMat));
    this.envRT = null;
    // 이펙트 (기존 파티클 시스템 재사용, 부동 원점 앵커 그룹)
    this.fxGroup = new THREE.Group();
    this.fxGroup.matrixAutoUpdate = false;
    this.scene.add(this.fxGroup);
    this.fx = new Effects(this.fxGroup);
    for (const ps of [this.fx.smoke, this.fx.fire, this.fx.water]) ps.setFog(0, new THREE.Color(0, 0, 0));
    this.fxAnchor = { frame: null, pos: new THREE.Vector3(), q: new THREE.Quaternion(), qi: new THREE.Quaternion(), body: null, radius: 0 };
    this.fxWorld = { env: { wind: new THREE.Vector3() }, scene: { fog: null }, surfaceAt: (x, z) => this._fxSurface(x, z) };
    // 근거리 인스턴싱
    this.scatter = new SurfaceScatter(this.scene, this.scheduler);
    this.particles = new ParticleField(this.scene, 2400);
    // 궤도 예측선
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.BufferAttribute(new Float32Array(257 * 3), 3));
    this.orbitLine = new THREE.Line(og, new THREE.LineBasicMaterial({ color: 0x62e6ff, transparent: true, opacity: 0.75, depthWrite: false }));
    this.orbitLine.frustumCulled = false;
    this.orbitLine.matrixAutoUpdate = false;
    this.orbitLine.renderOrder = 30;
    this.scene.add(this.orbitLine);
    // 지형 그림자 (2단 캐스케이드)
    this._initShadows(Q.shadows);

    progress(0.92, '셰이더 컴파일');
    await tick();
    this._precompile();
    progress(0.95, '후처리 구성');
    await tick();
    this.post = createSpaceComposer(this.renderer, this.cloudTex, this.quality);
    this.post.bloom.strength = Q.bloom;
    // 후처리 셰이더도 로딩 중에 한 번 실행해 컴파일해 둔다
    try {
      this.post.atmo.uniforms.uActive.value = 1;
      this.renderer.setRenderTarget(this.post.sceneRT);
      this.renderer.clear();
      this.renderer.setRenderTarget(null);
      this.post.composer.render(0.016);
      this.post.atmo.uniforms.uActive.value = 0;
    } catch (e) { console.warn(e); }
    this.hud = new SpaceHUD(document.getElementById('hud'));
    this.map = new NavMap(this);
    this.previews = new PreviewCache(this.renderer, this.cloudTex);
    this.audio = new SpaceAudio();
    this.setQuality(this.quality);
    window.addEventListener('resize', () => this.onResize());
    this._bindInput();
    this.onResize();
    this.ready = true;
    progress(1, '준비 완료');
  }

  /** 첫 접근 시 끊김을 막기 위해 모든 고유 셰이더를 로딩 중에 미리 컴파일 */
  _precompile() {
    const tmp = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    geo.setAttribute('morph', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3));
    geo.setAttribute('aux', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3));
    const seen = new Set();
    const add = (mat) => {
      if (!mat || seen.has(mat)) return;
      seen.add(mat);
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      tmp.add(m);
    };
    for (const p of this.planets) {
      if (p.terrain) { add(p.terrain.material); add(p.terrain.oceanMaterial); }
      add(p.gasMat); add(p.ringMat); if (p.shell) add(p.shell.material);
    }
    // 실제 장면(같은 조명 구성)에 잠시 넣어 컴파일해야 프로그램 캐시가 일치한다
    this.scene.add(tmp);
    try { this.renderer.compile(this.scene, this.camera); } catch (e) { console.warn('셰이더 사전 컴파일 실패', e); }
    this.scene.remove(tmp);
    geo.dispose();
  }

  _applyPixelRatio() {
    const Q = QUALITY[this.quality] || QUALITY.medium;
    const s = Math.max(0.5, Math.min(1.6, (Settings.get('renderScale') || 1) * Q.scale));
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1) * s);
  }

  setQuality(q) {
    this.quality = QUALITY[q] ? q : 'medium';
    const Q = QUALITY[this.quality];
    this._applyPixelRatio();
    for (const p of this.planets) p.setQuality(this.quality);
    this.scatter.setQuality(this.quality);
    if (this.post) { this.post.atmo.setQuality(this.quality); this.post.bloom.strength = Q.bloom; }
    this.shadowSize = Q.shadows;
    this._initShadows(Q.shadows);
    this.onResize();
  }

  /** 무한 원평면 투영: 아주 먼 천체(은하)가 원평면 경계에서 잘리지 않도록 (깊이는 로그 깊이로 기록) */
  _updateProjection() {
    const cam = this.camera;
    cam.updateProjectionMatrix();
    const e = cam.projectionMatrix.elements;
    e[10] = -1 + 1e-6;
    e[14] = -2 * cam.near;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }

  onResize() {
    if (!this.renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this._updateProjection();
    this.renderer.setSize(w, h, false);
    if (this.post) { this.post.composer.setPixelRatio(this.renderer.getPixelRatio()); this.post.setSize(w, h); }
    if (this.hud) this.hud.resize();
  }

  /* ------------------------------ 그림자 ------------------------------ */
  _initShadows(size) {
    if (this.shadows) for (const c of this.shadows) c.rt.dispose();
    this.shadows = [];
    if (!size) return;
    for (const half of [220, 4200]) {
      const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
      rt.depthTexture = new THREE.DepthTexture(size, size, THREE.FloatType);
      const cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, 60000);
      cam.layers.set(1);
      this.shadows.push({ rt, cam, half, m: new THREE.Matrix4() });
    }
    this.shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  }

  _renderShadows(L, near, agl) {
    const on = this.shadows.length && near && near.view && near.view.terrain && agl < 9000 && L.dot(this._up) > -0.05;
    for (const p of this.planets) if (p.terrain) p.terrain.uniforms.uShadowOn.value = 0;
    if (!on) return;
    const u = near.view.terrain.uniforms;
    const r = this.renderer;
    const prevOverride = this.scene.overrideMaterial;
    this.scene.overrideMaterial = this.shadowMat;
    const prevAuto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    // 지표 아래 기준점 (카메라 아래 지면)
    const ground = this._up.clone().multiplyScalar(-Math.min(agl, 4000));
    for (let i = 0; i < this.shadows.length; i++) {
      const s = this.shadows[i];
      if (i === 1 && (this._frameNo & 1)) continue;   // 먼 단은 격프레임
      const D = 30000;
      s.cam.position.copy(ground).addScaledVector(L, D);
      s.cam.up.copy(this._up);
      s.cam.lookAt(ground);
      s.cam.updateMatrixWorld();
      // 텍셀 스냅 (흔들림 감소)
      const texel = (s.half * 2) / s.rt.width;
      const ls = ground.clone().applyMatrix4(s.cam.matrixWorldInverse);
      const dx = ls.x - Math.round(ls.x / texel) * texel, dy = ls.y - Math.round(ls.y / texel) * texel;
      s.cam.left = -s.half + dx; s.cam.right = s.half + dx; s.cam.top = s.half + dy; s.cam.bottom = -s.half + dy;
      s.cam.updateProjectionMatrix();
      r.setRenderTarget(s.rt);
      r.clear();
      r.render(this.scene, s.cam);
      s.m.multiplyMatrices(s.cam.projectionMatrix, s.cam.matrixWorldInverse);
    }
    r.setRenderTarget(null);
    this.scene.overrideMaterial = prevOverride;
    r.shadowMap.autoUpdate = prevAuto;
    u.uShadowOn.value = 1;
    u.uShadow0.value = this.shadows[0].rt.depthTexture;
    u.uShadow1.value = this.shadows[1].rt.depthTexture;
    u.uShadowM0.value.copy(this.shadows[0].m);
    u.uShadowM1.value.copy(this.shadows[1].m);
  }

  /* ------------------------------ 입력 ------------------------------ */
  _bindInput() {
    const canvas = document.getElementById('gl-space');
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    let rdrag = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      if (e.button === 2) { rdrag = { x: e.clientX, y: e.clientY }; return; }
      if (e.pointerType === 'mouse' && Settings.get('mouseFlight') && !document.pointerLockElement) canvas.requestPointerLock && canvas.requestPointerLock();
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      if (rdrag) {
        this.look.yaw -= (e.clientX - rdrag.x) * 0.005;
        this.look.pitch = Math.max(-1.2, Math.min(1.2, this.look.pitch - (e.clientY - rdrag.y) * 0.005));
        rdrag.x = e.clientX; rdrag.y = e.clientY;
      }
      if (document.pointerLockElement === canvas) {
        const s = Settings.get('sensitivity') || 1;
        this.mouseAxes.yaw = Math.max(-1, Math.min(1, this.mouseAxes.yaw + e.movementX * 0.004 * s));
        this.mouseAxes.pitch = Math.max(-1, Math.min(1, this.mouseAxes.pitch - e.movementY * 0.004 * s * (Settings.get('invertPitch') ? -1 : 1)));
      }
    });
    window.addEventListener('pointerup', (e) => { if (e.button === 2) rdrag = null; });
    canvas.addEventListener('wheel', (e) => {
      if (!this.active) return;
      this.flight.throttle = Math.max(0, Math.min(1, this.flight.throttle - e.deltaY * 0.0006));
    }, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (!this.active || this.paused) return;
      if (e.repeat) return;
      if (e.code === 'Tab') e.preventDefault();
      const a = this._actionFor(e.code);
      if (a) this._onAction(a);
    });
  }

  _actionFor(code) {
    for (const k in this.keys) if (this.keys[k].includes(code)) return k;
    return null;
  }

  _down(action) {
    const keys = this.keys[action];
    if (!keys) return false;
    const set = this.app.input.keys;
    for (const k of keys) if (set.has(k)) return true;
    return false;
  }

  /** 즉시 동작 (키·버튼·게임패드 공용) */
  _onAction(a) {
    const f = this.flight;
    if (a.startsWith('tier') && a !== 'tierNext') this.requestTier(parseInt(a.slice(4), 10));
    else if (a === 'tierNext') this.requestTier(f.tier >= 5 ? 1 : f.tier + 1);
    else if (a === 'assist') { f.fa = !f.fa; this._event(f.fa ? '관성 보조 켜짐 — 속도 유지 비행' : '관성 보조 꺼짐 — 뉴턴 비행 (관성 유지)', 'info'); this.sfx('click'); }
    else if (a === 'gear') { f.gearDown = !f.gearDown; this._event(f.gearDown ? '착륙 장치 내림' : '착륙 장치 올림'); this.sfx('click'); }
    else if (a === 'lights') { f.lights = !f.lights; this.sfx('click'); }
    else if (a === 'view') { this.view = this.view === 'chase' ? 'cockpit' : 'chase'; this.look.yaw = 0; this.look.pitch = 0; this.sfx('click'); }
    else if (a === 'map') this.map.toggle();
    else if (a === 'target') this.cycleTarget();
    else if (a === 'align') { this.autoAlign = !this.autoAlign; this._event(this.autoAlign ? '목표 방향 자동 정렬' : '자동 정렬 해제'); this.sfx('click'); }
    else if (a === 'orbit') { this.orbitOn = !this.orbitOn; this.sfx('click'); }
    else if (a === 'respawn') this.respawn();
    else if (a === 'hud') this.hud.visible = !this.hud.visible;
    else if (a === 'throttleZero') f.throttle = 0;
  }

  requestTier(n) {
    const f = this.flight;
    n = Math.max(1, Math.min(5, n));
    if (n === f.tier) return;
    // 대기권 안에서는 고단계 제한
    if (n >= 3 && this._inAtmo) {
      this._event('대기권 안에서는 3단계 이상 사용 불가 — 공기 저항·재진입 가열', 'warn');
      this._warn('대기권 — 고속 단계 제한', 1, 2.5);
      this.sfx('error');
      if (f.tier >= 2) return;
      n = 2;
    }
    if (n >= 4 && this._wellBody) {
      this._event(`${this._wellBody.name} 중력 우물 안 — 워프 불가`, 'warn');
      this._warn('중력 우물 — 워프 불가', 2, 2.5);
      this.sfx('error');
      return;
    }
    const up = n > f.tier;
    const wasWarp = f.tier >= 4;
    f.setTier(n);
    this.audio.tierClick(up);
    if (n >= 4 && !wasWarp) { this.audio.warpBurst(true); this.flash = Math.max(this.flash, 0.7); this.shake = Math.max(this.shake, 0.8); }
    if (n < 4 && wasWarp) { this.audio.warpBurst(false); this.flash = Math.max(this.flash, 0.5); this.shake = Math.max(this.shake, 0.6); }
    this._event(`속도 ${n}단계 — ${TIERS[n - 1].name} (${TIERS[n - 1].desc})`, n >= 4 ? 'warp' : 'info');
    this._pulseTierButton(n);
  }

  _pulseTierButton(n) {
    const b = document.querySelector(`[data-sp="tier${n}"]`);
    if (!b) return;
    b.classList.remove('sp-pulse'); void b.offsetWidth; b.classList.add('sp-pulse');
  }

  _readAxes(dt) {
    const s = Settings.get('sensitivity') || 1;
    let pitch = 0, roll = 0, yaw = 0, lift = 0;
    if (this._down('pitchUp')) pitch += 1;
    if (this._down('pitchDown')) pitch -= 1;
    if (this._down('rollLeft')) roll -= 1;
    if (this._down('rollRight')) roll += 1;
    if (this._down('yawLeft')) yaw -= 1;
    if (this._down('yawRight')) yaw += 1;
    if (this._down('liftUp')) lift += 1;
    if (this._down('liftDown')) lift -= 1;
    const f = this.flight;
    if (this._down('throttleUp')) f.throttle = Math.min(1, f.throttle + dt * 0.45);
    if (this._down('throttleDown')) f.throttle = Math.max(0, f.throttle - dt * 0.45);
    // 화면 조이스틱
    if (Math.abs(this.virtual.pitch) > 0.02) pitch = this.virtual.pitch;
    if (Math.abs(this.virtual.roll) > 0.02) roll = this.virtual.roll;
    if (this.virtual.throttle !== null) { f.throttle = this.virtual.throttle; this.virtual.throttle = null; }
    // 게임패드
    const gp = this.app.input.gamepad();
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
      roll += dz(gp.axes[0] || 0);
      pitch += -dz(gp.axes[1] || 0) * (Settings.get('invertPitch') ? -1 : 1);
      yaw += dz(gp.axes[2] || 0);
      lift += -dz(gp.axes[3] || 0);
      if (gp.buttons[7]) f.throttle = Math.min(1, f.throttle + gp.buttons[7].value * dt * 0.6);
      if (gp.buttons[6]) f.throttle = Math.max(0, f.throttle - gp.buttons[6].value * dt * 0.6);
      const pressed = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      const prev = this._gpPrev || [];
      const edge = (i) => pressed(i) && !prev[i];
      if (edge(0)) this.requestTier(f.tier + 1);
      if (edge(1)) this.requestTier(f.tier - 1);
      if (edge(2)) this._onAction('assist');
      if (edge(3)) this._onAction('map');
      if (edge(4)) this._onAction('view');
      if (edge(5)) this._onAction('target');
      if (edge(12)) this._onAction('gear');
      if (edge(13)) this._onAction('align');
      if (edge(9)) this.app.togglePause();
      this._gpPrev = gp.buttons.map((b) => b.pressed);
    }
    // 마우스 비행
    pitch += this.mouseAxes.pitch; yaw += this.mouseAxes.yaw;
    this.mouseAxes.pitch *= Math.pow(0.02, dt); this.mouseAxes.yaw *= Math.pow(0.02, dt);
    if (Settings.get('invertPitch')) pitch = -pitch;
    // 자동 정렬 (목표 방향)
    if (this.autoAlign && this.target && Math.abs(pitch) + Math.abs(yaw) < 0.05) {
      const dirW = _v.copy(this.target.rel).sub(this._shipRel()).normalize();
      const dl = dirW.applyQuaternion(_q.copy(f.body.quaternion).invert());
      pitch = Math.max(-1, Math.min(1, dl.y * 4));
      yaw = Math.max(-1, Math.min(1, dl.x * 4));
      if (dl.z > 0) yaw = dl.x >= 0 ? 1 : -1;
    }
    const k = (v) => Math.max(-1, Math.min(1, v * s));
    f.input.pitch = k(pitch); f.input.roll = k(roll); f.input.yaw = k(yaw); f.input.lift = Math.max(-1, Math.min(1, lift));
    f.input.brake = this._down('brake');
  }

  /* ------------------------------ 시작 · 리스폰 ------------------------------ */
  enter(systemId = 'sol') {
    this.systemId = systemId;
    this.active = true;
    this.paused = false;
    document.body.classList.add('space-mode');
    this.time = (this.time || 0) + 1e6 * Math.random() + 3600 * 24 * 40;
    this._spawn(systemId);
    this.audio.start();
    if (Audio.ready) Audio.music(false);
    this.hud.visible = true;
    this.onResize();
  }

  _spawn(systemId) {
    const sp = START_POINTS[systemId] || START_POINTS.sol;
    const b = this.uni.byId[sp.body];
    updateBodies(this.uni.bodies, this.time);
    const lat = sp.lat * Math.PI / 180, lon = sp.lon * Math.PI / 180;
    const dirL = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
    const r = b.radius + sp.alt;
    const pos = dirL.clone().applyQuaternion(b.rotation).multiplyScalar(r);
    // 원궤도 속도 (자전 방향)
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(b.rotation);
    const east = axis.clone().cross(pos).normalize();
    const vel = east.multiplyScalar(Math.sqrt(b.mu / r));
    // 진행 방향을 보되 행성 가장자리(지평선)가 보이도록 약간 아래로
    const up = pos.clone().normalize();
    const fwd = vel.clone().normalize().addScaledVector(up, -0.12).normalize();
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd, up);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.flight.reset(b, pos, vel, q);
    this.flight.fa = false;
    this.flight.gearDown = false;
    this.flight.gear = 0;
    this.target = null;
    this.view = 'chase';
    this.camQuat.copy(q);
    this.fx.clear();
    this.fxAnchor.frame = null;
    this.model.root.visible = true;
    this.crashTimer = 0;
    this.app.ui.showCrash(false);
    this._event(`${sp.title}에서 시작 — 관성 보조 꺼짐(궤도 유지). Z 키로 켜면 속도 유지 비행`, 'info');
    this._event('1~5 또는 Tab: 속도 단계 · M: 항법 지도 · T: 목표 지정 · H: 목표 정렬', 'info');
  }

  /** 디버그·테스트용: 천체 지표 근처로 순간 이동 (콘솔: __FREEFREELY__.space.teleport('earth', {alt: 800})) */
  teleport(bodyId, o = {}) {
    const b = this.uni.byId[bodyId];
    if (!b) return;
    updateBodies(this.uni.bodies, this.time);
    // 대상 천체까지 프레임 경로를 따라 함선 프레임을 바꾼다
    const lat = (o.lat ?? 20) * Math.PI / 180, lon = (o.lon ?? 30) * Math.PI / 180;
    let dirL = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
    if (o.sun !== undefined) {
      // 태양 고도각 지정: 태양 방향에서 o.sun 도 떨어진 지점 (북쪽으로 기울임 o.lat)
      const sys = this._systemOf(b);
      const star = sys && sys.children.find((c) => c.kind === 'star');
      if (star) {
        const sunL = posInFrame(star, b, new THREE.Vector3()).normalize().applyQuaternion(_q.copy(b.rotation).invert());
        const pole = new THREE.Vector3(0, 1, 0);
        const perp = pole.clone().addScaledVector(sunL, -pole.dot(sunL)).normalize();
        const side = sunL.clone().cross(perp);
        const a = o.sun * Math.PI / 180;
        dirL = sunL.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)).addScaledVector(perp, (o.lat ?? 0) / 90).normalize();
      }
    }
    const view = this.views.get(b);
    const h = view && view.terrain ? Math.max(view.heightAt(dirL, 2), view.terrain.terrain.hasOcean ? 0 : -1e9) : 0;
    const r = b.radius + h + (o.alt ?? 1000);
    const up = dirL.clone().applyQuaternion(b.rotation);
    const pos = up.clone().multiplyScalar(r);
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(b.rotation);
    let north = axis.clone().addScaledVector(up, -axis.dot(up)).normalize();
    const east = north.clone().cross(up).negate();
    const hd = (o.heading ?? 90) * Math.PI / 180;
    const fwd = north.clone().multiplyScalar(Math.cos(hd)).addScaledVector(east, Math.sin(hd)).addScaledVector(up, Math.tan((o.pitch ?? 0) * Math.PI / 180)).normalize();
    const vel = b.surfaceVelocity(pos, new THREE.Vector3()).addScaledVector(fwd, o.speed ?? 0);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd, up));
    this.flight.reset(b, pos, vel, q);
    this.flight.fa = o.fa ?? true;
    this.flight.throttle = o.throttle ?? 0;
    this.camQuat.copy(q);
    this.fxAnchor.frame = null;
    this.model.root.visible = true;
    if (o.time !== undefined) this.time = o.time;
  }

  /** 디버그·테스트용: 임의 천체 프레임의 한 점에 두고 그 천체(또는 lookAt)를 바라보게 */
  placeIn(bodyId, x, y, z, lookId) {
    const b = this.uni.byId[bodyId];
    if (!b) return;
    updateBodies(this.uni.bodies, this.time);
    const pos = new THREE.Vector3(x, y, z);
    const look = lookId ? posInFrame(this.uni.byId[lookId], b, new THREE.Vector3()) : new THREE.Vector3();
    const fwd = look.sub(pos).normalize();
    const up = Math.abs(fwd.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd, up));
    this.flight.reset(b, pos, new THREE.Vector3(), q);
    this.flight.fa = true;
    this.camQuat.copy(q);
    this.fxAnchor.frame = null;
    this._soi();
  }

  respawn() {
    this._spawn(this.systemId || 'sol');
    this.app.ui.toast('함선을 새로 준비했습니다', 'good');
  }

  exit() {
    this.active = false;
    document.body.classList.remove('space-mode');
    if (this.map.open) this.map.toggle(false);
    this.audio.stop();
    this.hud.clear();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setPaused(p) {
    this.paused = p;
    if (p) { Audio.ready && Audio.clearWarnings(); }
  }

  /* ------------------------------ 목표 ------------------------------ */
  setTarget(b) {
    this.target = b;
    if (b) this._event(`목표 지정: ${b.name} (${formatDistance(this.distanceTo(b))})`, 'good');
  }

  cycleTarget() {
    const list = this._targetCandidates();
    if (!list.length) return;
    const i = list.indexOf(this.target);
    this.setTarget(list[(i + 1) % list.length]);
    this.sfx('click');
  }

  _targetCandidates() {
    // 현재 항성계 천체 → 이웃 항성계·성운·블랙홀 → 은하 순
    const out = [];
    const sys = this._systemOf(this.flight.frame);
    if (sys) for (const c of sys.children) { if (c.kind !== 'belt') out.push(c); for (const m of c.children) out.push(m); }
    const gal = this._galaxyOf(this.flight.frame);
    if (gal) for (const c of gal.children) if (c !== sys) out.push(c);
    for (const g of this.uni.root.children) if (g !== gal) out.push(g);
    return out;
  }

  _systemOf(b) { while (b && b.kind !== 'system') b = b.parent; return b; }
  _galaxyOf(b) { while (b && b.kind !== 'galaxy') b = b.parent; return b; }

  distanceTo(b) { return _v.copy(b.rel).sub(this._shipRel()).length(); }
  _shipRel() { return _v2.copy(this.camOff).negate(); }

  /** 지도용: 함선 위치를 임의 프레임 좌표로 */
  shipPosIn(frame) {
    const p = posInFrame(this.flight.frame, frame, new THREE.Vector3());
    return p.add(this.flight.pos);
  }

  /* ------------------------------ 이벤트 · 경고 ------------------------------ */
  _event(text, kind = 'info') { this.hud && this.hud.pushEvent({ text, kind }); }
  _warn(text, level = 1, dur = 0.2) {
    const w = this.warnings.find((x) => x.text === text);
    if (w) { w.t = Math.max(w.t, dur); w.level = level; } else this.warnings.push({ text, level, t: dur });
  }

  /* ------------------------------ 메인 갱신 ------------------------------ */
  frame(dt) {
    if (!this.active) return;
    this._frameNo = (this._frameNo || 0) + 1;
    if (this.paused) { this._render(0); return; }
    this.time += dt;
    const f = this.flight;
    this._readAxes(dt);
    updateBodies(this.uni.bodies, this.time);

    // 물리 (워프는 프레임당 1회, 그 외 고정 1/120 s)
    const env = this._physEnv();
    if (f.warp) {
      f.step(dt, env);
      this._soi();
    } else {
      this._accum += dt;
      let n = 0;
      while (this._accum >= 1 / 120 && n < 8) {
        f.step(1 / 120, env);
        this._accum -= 1 / 120;
        n++;
        if (n % 2 === 0) { this._soi(); Object.assign(env, this._physEnv()); }
      }
      if (n >= 8) this._accum = 0;
      this._soi();
    }
    this._limits(env);
    this._handleEvents();
    this._updateCamera(dt);
    // 부동 원점: 카메라 위치(함선 + 오프셋) 기준 상대 좌표
    const camPos = _v.copy(f.pos).add(this.camOff);
    computeRelative(this.uni.root, f.frame, camPos);
    this._render(dt, env);
  }

  /** 가까운 천체 · 중력원 */
  _physEnv() {
    const f = this.flight;
    const F = f.frame;
    const sources = [];
    if (F.mu > 0 && F.kind !== 'system' && F.kind !== 'galaxy') sources.push({ mu: F.mu, pos: new THREE.Vector3() });
    for (const c of F.children) if (c.mu > 0 && c.kind !== 'galaxy' && c.kind !== 'system') sources.push({ mu: c.mu, pos: c.localPos.clone() });
    // 가장 가까운 단단한/기체 천체
    let near = null, best = Infinity;
    const consider = (b) => {
      if (!(b.kind === 'planet' || b.kind === 'moon' || b.kind === 'star' || b.kind === 'blackhole')) return;
      const p = posInFrame(b, F, new THREE.Vector3());
      const d = p.distanceTo(f.pos) - b.radius;
      if (d < best) { best = d; near = { body: b, view: this.views.get(b), pos: p, vel: velInFrame(b, F, new THREE.Vector3()) }; }
    };
    const sys = this._systemOf(F);
    if (sys) for (const c of sys.children) { consider(c); for (const m of c.children) consider(m); }
    else { if (F.kind !== 'universe' && F.kind !== 'galaxy') consider(F); for (const c of F.children) consider(c); }
    if (near && (near.body.kind === 'star' || near.body.kind === 'blackhole')) near.view = null;
    // 항성 복사
    let sunFlux = 0, radTemp = 3;
    const star = this._mainStar();
    if (star) {
      const d = posInFrame(star, F, new THREE.Vector3()).distanceTo(f.pos);
      sunFlux = (star.lum || L_SUN) / (4 * Math.PI * d * d);
      radTemp = Math.pow(sunFlux * 0.5 / (0.82 * 5.67e-8), 0.25);
    }
    return { near, sources, sunFlux, radTemp, nearDist: best };
  }

  _mainStar() {
    const sys = this._systemOf(this.flight.frame);
    return sys ? sys.children.find((c) => c.kind === 'star') : null;
  }

  /** 영향권(SOI) 프레임 전환 */
  _soi() {
    const f = this.flight;
    for (let guard = 0; guard < 4; guard++) {
      const F = f.frame;
      let moved = false;
      for (const c of F.children) {
        if (!c.soi) continue;
        if (_v.copy(f.pos).sub(c.localPos).lengthSq() < c.soi * c.soi) {
          f.pos.sub(c.localPos); f.vel.sub(c.localVel); f.frame = c; moved = true;
          if (c.kind === 'galaxy' || c.kind === 'system') this._event(`${c.name} 진입`, 'good');
          this.fxAnchor.frame = null;
          break;
        }
      }
      if (moved) continue;
      if (F.parent && f.pos.lengthSq() > F.soi * F.soi) {
        f.pos.add(F.localPos); f.vel.add(F.localVel); f.frame = F.parent;
        if (F.kind === 'galaxy' || F.kind === 'system') this._event(`${F.name} 이탈`, 'info');
        this.fxAnchor.frame = null;
        continue;
      }
      break;
    }
  }

  /** 근접 자동 감속 · 중력 우물 · 대기권 단계 제한 */
  _limits(env) {
    const f = this.flight;
    const F = f.frame;
    const near = env.near;
    this._inAtmo = false;
    this._wellBody = null;
    let limit = Infinity;
    const vdir = f.warp ? f.forward.clone() : (f.vel.lengthSq() > 1 ? f.vel.clone().normalize() : f.forward.clone());
    const check = (b, p) => {
      const to = p.clone().sub(f.pos);
      const d = to.length();
      const R = b.radius || 0;
      const well = R * (b.kind === 'star' ? 14 : b.kind === 'blackhole' ? 3000 : 10);
      if (d < well) this._wellBody = this._wellBody || b;
      const closing = to.dot(vdir) / Math.max(1, d);
      if (closing > 0.15 || d < R * 3) {
        const surf = Math.max(0, d - R * 1.05);
        const lim = surf / 2.2 / Math.max(0.3, closing) + 3000;
        limit = Math.min(limit, lim);
      }
    };
    const sys = this._systemOf(F);
    if (sys) for (const c of sys.children) { if (c.radius) check(c, posInFrame(c, F, new THREE.Vector3())); for (const m of c.children) if (m.radius) check(m, posInFrame(m, F, new THREE.Vector3())); }
    const gal = this._galaxyOf(F);
    if (gal) for (const c of gal.children) if (c.kind === 'blackhole') check(c, posInFrame(c, F, new THREE.Vector3()));
    // 목표 도착 감속
    if (this.target) {
      const t = this.target;
      const p = posInFrame(t, F, new THREE.Vector3());
      const d = p.distanceTo(f.pos);
      const stop = t.kind === 'galaxy' ? t.galRadius * 1.15 : t.kind === 'system' ? 3 * AU : t.kind === 'nebula' ? t.nebRadius * 2.5 : (t.radius || 1e6) * (t.kind === 'blackhole' ? 400 : 6);
      this._targetEta = null;
      const closing = p.clone().sub(f.pos).normalize().dot(vdir);
      if (closing > 0.5 && f.tier >= 3) limit = Math.min(limit, Math.max(f.tier >= 4 ? 2e5 : 4000, (d - stop) / 2.0));
    }
    // 대기권
    if (near && near.body.atmo) {
      const alt = env.nearDist;
      if (alt < near.body.atmo.top) this._inAtmo = true;
    }
    if (this._inAtmo && f.tier >= 3) {
      f.setTier(2);
      this._event('대기권 진입 — 속도 2단계로 자동 감속', 'warn');
      this._warn('대기권 — 고속 단계 해제', 2, 3);
    }
    if (this._wellBody && f.tier >= 4) {
      f.setTier(3);
      this.audio.warpBurst(false);
      this.flash = Math.max(this.flash, 0.8);
      this.shake = Math.max(this.shake, 0.9);
      this._event(`${this._wellBody.name} 중력 우물 — 워프 강제 해제`, 'danger');
      this._warn('중력 우물 이탈 경고 — 워프 해제', 2, 3);
    }
    f.speedLimit = f.tier >= 3 ? limit : Infinity;
    this._limited = f.tier >= 3 && limit < throttleTarget(f) * 0.95;
  }

  _handleEvents() {
    const f = this.flight;
    while (f.events.length) {
      const e = f.events.shift();
      if (e.kind === 'boom') {
        if (Audio.ready) Audio.sonicBoom(null);
        this.shake = Math.max(this.shake, 0.7);
        this._fxAt(this._shipRel(), (p) => this.fx.shockwave(p, 1.2));
      } else if (e.kind === 'impact') {
        if (Audio.ready) { if (e.water) Audio.splash(null, Math.min(3, e.speed / 20)); else Audio.impact(null, Math.min(3, e.speed / 15), 'metal'); }
        this.shake = Math.max(this.shake, Math.min(1.5, e.speed / 30));
        this._fxAt(this._shipRel(), (p) => { if (e.water) this.fx.waterImpact(p, e.speed, 1.2); else { this.fx.sparks(p, new THREE.Vector3(0, 1, 0), 20, 1); this.fx.dust(p, 1.5); } });
      } else if (e.kind === 'destroyed') {
        this._crash(e.text);
        continue;
      } else if (e.kind === 'warp') {
        // 워프 진입 시각 효과는 requestTier 에서 처리
      }
      if (e.kind !== 'impact' || e.speed > 8) this._event(e.text, e.kind === 'impact' ? 'danger' : e.kind === 'boom' ? 'warn' : e.kind);
    }
  }

  _crash(reason) {
    if (this.crashTimer > 0) return;
    this.crashTimer = 2.2;
    this.model.root.visible = false;
    this._fxAt(this._shipRel(), (p) => { this.fx.explosion(p, 2.4); this.fx.spawnDebris(p, 14, 1.6); this.fx.shockwave(p, 3); });
    if (Audio.ready) Audio.explosion(null, 2.5);
    this.flash = 1;
    this.shake = 1.6;
    this._crashReason = reason;
  }

  /* ------------------------------ 카메라 ------------------------------ */
  _updateCamera(dt) {
    const f = this.flight;
    const sq = f.body.quaternion;
    const cockpit = this.view === 'cockpit';
    // 자세 지연 (3인칭) — 고속 기동 시 함선이 화면에서 살짝 움직이는 느낌
    if (cockpit) this.camQuat.copy(sq);
    else this.camQuat.slerp(sq, 1 - Math.exp(-dt * 7));
    const lookQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.look.pitch, this.look.yaw, 0, 'YXZ'));
    if (!this._lookDragging) { this.look.yaw *= Math.pow(0.15, dt); this.look.pitch *= Math.pow(0.15, dt); }
    const cq = this.camQuat.clone().multiply(lookQ);
    if (cockpit) this.camOff.copy(this.model.eye).applyQuaternion(sq);
    else this.camOff.set(0, 7.5, 36).applyQuaternion(cq);
    // 흔들림 (재진입·가속·워프·충격)
    const t = f.t;
    const shakeAmt = Math.min(1.5, this.shake + t.reentry * 0.5 + (t.dyn > 3e4 ? Math.min(0.4, t.dyn / 4e5) : 0) + (f.tierT < 1 ? 0.25 : 0) + this.fx.shake * 0.4);
    this.shake = Math.max(0, this.shake - dt * 1.2);
    const s = shakeAmt * 0.006;
    const jq = new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.5));
    this.camera.quaternion.copy(cq).multiply(jq);
    this.camera.position.set(0, 0, 0);
    // 시야각: 속도·가속·워프에 따라 확대
    const speedK = Math.min(1, Math.log10(1 + t.speed / 1000) / 5);
    const target = (Settings.get('fov') || 72) + speedK * 6 + this.warpVis * 16 + Math.min(8, (t.accel / 300) * 2) * (f.warp ? 0 : 1);
    this.fov += (target - this.fov) * Math.min(1, dt * 3);
    this.camera.fov = this.fov;
    this.camera.near = cockpit ? 0.05 : 0.3;
    this._updateProjection();
    this.camera.updateMatrixWorld(true);
    this.model.cockpit.visible = cockpit;
    this.model.canopy.visible = !cockpit;
  }

  /* ------------------------------ 렌더 ------------------------------ */
  _render(dt, env) {
    const f = this.flight;
    if (!env) env = this._lastEnv || this._physEnv();
    this._lastEnv = env;
    const W = window.innerWidth, H = window.innerHeight;
    const pixelScale = H / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    const dpr = this.renderer.getPixelRatio();
    const shipRel = this._shipRel().clone();
    // 태양 (현재 항성계의 항성)
    const star = this._mainStar();
    let sunDir = new THREE.Vector3(0, 1, 0), sunCol = new THREE.Vector3(0.02, 0.02, 0.025), starTemp = 5778;
    if (star) {
      sunDir.copy(star.rel).sub(shipRel).normalize();
      const d = star.rel.length();
      const flux = (star.lum || L_SUN) / (4 * Math.PI * d * d) / 1361;
      const I = Math.min(60, 3.2 * Math.pow(flux, 0.35));
      const [r, g, b] = blackbody(star.temp);
      const mx = Math.max(r, g, b);
      sunCol.set(r / mx, g / mx, b / mx).multiplyScalar(I);
      starTemp = star.temp;
    }
    // 가까운 천체 정보
    const near = env.near;
    const nearB = near ? near.body : null;
    let up = this._up = new THREE.Vector3(0, 1, 0);
    let agl = Infinity, alt = Infinity;
    if (nearB) {
      up.copy(shipRel).sub(nearB.rel).normalize();
      alt = shipRel.distanceTo(nearB.rel) - nearB.radius;
      agl = f.t.agl;
    }
    // 하늘 주변광 (대기 산란 근사)
    const skyAmb = new THREE.Vector3();
    let skyZenith = new THREE.Vector3(), skyHorizon = new THREE.Vector3();
    let dayK = 0;
    if (nearB && nearB.atmo) {
      const a = nearB.atmo;
      const tint = new THREE.Vector3(a.betaR[0] + a.betaM[0] * 0.25, a.betaR[1] + a.betaM[1] * 0.25, a.betaR[2] + a.betaM[2] * 0.25);
      tint.divideScalar(Math.max(tint.x, tint.y, tint.z));
      const thick = a.betaR[2] * a.HR + a.betaM[0] * a.HM;
      const strength = (1 - Math.exp(-thick * 2.2)) * Math.exp(-Math.max(0, alt) / (a.HR * 2.2));
      dayK = smooth((up.dot(sunDir) + 0.15) / 0.4);
      skyAmb.copy(tint).multiply(sunCol).multiplyScalar(0.32 * strength * dayK);
      skyZenith.copy(tint).multiply(sunCol).multiplyScalar(0.18 * strength * dayK);
      skyHorizon.copy(tint).lerp(new THREE.Vector3(1, 1, 1), 0.55).multiply(sunCol).multiplyScalar(0.3 * strength * dayK);
    }
    // 주 대기 행성 선택 (화면 크기가 가장 큰 대기)
    let primary = null, bestA = 0;
    for (const p of this.planets) {
      const b = p.body;
      if (!b.atmo) { p.primary = false; continue; }
      const d = b.rel.length();
      const a = (b.radius + b.atmo.top) / Math.max(1, d);
      if (d < b.radius * 80 && a > bestA) { bestA = a; primary = p; }
      p.primary = false;
    }
    if (primary) primary.primary = true;
    // 천체 갱신
    const frame = { pixelScale, sunDir, sunCol, time: this.time, dpr, skyAmb, skyZenith, skyHorizon, waveAmp: 0.9, starExposure: 1 - dayK * 0.85 };
    for (const p of this.planets) p.update(frame);
    for (const s of this.stars) s.update(frame, dt);
    const camGalaxy = this._galaxyOf(f.frame);
    for (const g of this.galaxies) g.update(frame, g.body === camGalaxy);
    for (const m of this.misc) m.update(frame);
    const gal = this._galaxyOf(f.frame);
    if (gal) {
      const camGal = posInFrame(f.frame, gal, new THREE.Vector3()).add(f.pos).add(this.camOff);
      this.starfield.update(gal, camGal, frame);
    } else this.starfield.update(null);
    this.scheduler.update(4);
    // 함선
    const root = this.model.root;
    root.position.copy(shipRel);
    root.quaternion.copy(f.body.quaternion);
    root.updateMatrixWorld(true);
    this._updateShipVisuals(dt, sunDir, sunCol, near, shipRel, agl, skyAmb, dayK);
    // 근거리 식생·입자
    if (near && near.view && near.view.terrain) {
      const camL = _v.copy(nearB.rel).negate().applyQuaternion(_q.copy(nearB.rotation).invert());
      this.scatter.update(near, camL.clone(), agl, nearB.rel);
    } else this.scatter.update(null);
    this._updateParticles(f, near);
    // 궤도 예측선
    this._updateOrbit();
    // 이펙트
    this._updateFx(dt, near, shipRel, agl);
    // 경고 수집
    this._collectWarnings(dt, near, agl);

    // ---------------- 렌더링 ----------------
    const r = this.renderer;
    this._renderShadows(sunDir, near, agl);
    const post = this.post;
    // 대기 패스
    const au = post.atmo;
    if (primary && !this.debugNoAtmo) {
      const b = primary.body;
      au.setBody(b);
      const u = au.uniforms;
      u.uActive.value = 1;
      u.uR.value = b.radius;
      u.uCamP.value.copy(b.rel).negate().divideScalar(b.radius);
      _m3.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(b.rotation)).transpose();
      u.uPlanetInv.value.copy(_m3);
      u.uSunW.value.copy(sunDir);
      u.uAtSun.value.copy(sunCol).multiplyScalar(b.atmo.sunIntensity / 3);
      u.uSkyAmbient.value.copy(skyAmb).multiplyScalar(0.6).addScalar(0.002);
      u.uClTime.value = this.time;
      u.uTime.value = this.time;
      u.uCloudSteps.value = au.cloudSteps();
      u.uInvProj.value.copy(this.camera.projectionMatrixInverse);
      u.uCamRot.value.setFromMatrix4(this.camera.matrixWorld);
      u.uLogFar.value = Math.log2(this.camera.far + 1);
      // 수중
      const pv = primary.terrain;
      const camDistC = b.rel.length();
      let under = 0;
      if (pv && pv.terrain.hasOcean && pv.terrain.seaFluid === 'water' && camDistC < b.radius - 0.3) {
        const dirL = _v.copy(b.rel).negate().normalize().applyQuaternion(_q.copy(b.rotation).invert());
        if (pv.heightAt(dirL, 4) < 0) under = b.radius - camDistC;
      }
      u.uUnder.value = under;
      this.underwater = under > 0;
    } else {
      au.uniforms.uActive.value = 0;
      this.underwater = false;
    }
    this._postUniforms(dt, sunDir, sunCol, starTemp, shipRel, near);
    r.setRenderTarget(post.sceneRT);
    r.clear();
    r.render(this.scene, this.camera);
    this.renderStats = { calls: r.info.render.calls, triangles: r.info.render.triangles, points: r.info.render.points };
    post.composer.render(dt);
    // HUD
    this.hud.insetBottom = document.body.classList.contains('touch-ui') ? 60 : 0;
    this.hud.render(this._hudState(env, sunDir), dt);
    this.map.render(dt);
    // 오디오
    this.audio.update({
      throttle: f.throttle, thrust: f.warp ? 0.4 : (f.thrustFrac || 0), rcs: Math.min(1, (Math.abs(f.input.pitch) + Math.abs(f.input.yaw) + Math.abs(f.input.roll)) * 0.5),
      warp: this.warpVis, airspeed: f.t.surfSpeed, density: f.t.density, heat: f.t.reentry, cockpit: this.view === 'cockpit',
    });
    // 추락 후 패널
    if (this.crashTimer > 0) {
      this.crashTimer -= dt;
      if (this.crashTimer <= 0) {
        this.app.ui.showCrash(true, { reason: this._crashReason || '기체 파괴', time: '-', distance: '-', maxAlt: formatDistance(Math.max(0, alt)), maxSpeed: (f.t.speed / 1000).toFixed(1) + ' km/s', landings: '-' });
        if (document.pointerLockElement) document.exitPointerLock();
      }
    }
  }

  _updateShipVisuals(dt, sunDir, sunCol, near, shipRel, agl, skyAmb, dayK) {
    const f = this.flight;
    const m = this.model;
    const t = this.time;
    // 엔진 불꽃: 스로틀·단계에 따라 길이 변화
    const thrust = f.warp ? 0.9 : Math.max(f.thrustFrac || 0, f.fa ? 0 : f.throttle);
    const tierK = 1 + (f.tier - 1) * 0.45;
    for (const e of m.engines) {
      e.flame.scale.set(1 + thrust * 0.3, 1 + thrust * 0.3, (2 + thrust * 14) * tierK * (0.92 + Math.random() * 0.12));
      e.flame.visible = thrust > 0.02;
      e.mat.uniforms.uPower.value = thrust * (f.warp ? 1.6 : 1);
      e.mat.uniforms.uTime.value = t;
    }
    m.materials.nozzle.emissiveIntensity = 0.4 + thrust * 3;
    for (const e of m.engines) e.inner.material.color.setRGB(0.6 + thrust * 3, 0.3 + thrust * 1.4, 0.12 + thrust * 0.5);
    this.engineLight.intensity = thrust * 900;
    this.engineLight.position.copy(shipRel).add(new THREE.Vector3(0, 0, 14).applyQuaternion(f.body.quaternion));
    // 항법등 점멸
    const blink = (t % 1.4) < 0.08;
    m.nav.strobe.visible = blink;
    m.nav.beacon.visible = ((t + 0.7) % 1.1) < 0.12;
    m.nav.red.visible = m.nav.green.visible = true;
    m.landingLight.intensity = f.lights ? 4000 : 0;
    // 착륙장치 애니메이션
    m.gearGroup.visible = f.gear > 0.02;
    for (const leg of m.gearLegs) { leg.scale.y = Math.max(0.01, f.gear); leg.rotation.x = (1 - f.gear) * 1.2; }
    // 재진입 가열 발광
    const heat = f.t.reentry;
    const glow = Math.max(0, (f.hullTemp - 850) / 1300);
    for (const k of ['hull', 'dark', 'accent']) m.materials[k].emissiveIntensity = glow * glow * 2.4;
    m.plasma.visible = heat > 0.05;
    m.plasmaMat.uniforms.uHeat.value = heat;
    m.plasmaMat.uniforms.uTime.value = t;
    if (heat > 0.05) {
      const airL = f.vel.clone().sub(near ? near.vel : new THREE.Vector3()).normalize().applyQuaternion(_q.copy(f.body.quaternion).invert());
      m.plasmaMat.uniforms.uFlowL.value.copy(airL).negate();
    }
    // 태양광 (행성 그림자·지형 가림 고려)
    let lit = 1;
    if (near && near.body) {
      const c = _v.copy(near.body.rel).sub(shipRel);
      const b = c.dot(sunDir);
      if (b > 0) {
        const dd = c.clone().addScaledVector(sunDir, -b).length();
        lit = smooth((dd - near.body.radius * 0.995) / (near.body.radius * 0.01));
      }
      if (near.view && near.view.terrain && agl < 3000 && lit > 0) {
        // 산 그림자: 태양 방향으로 지형 표본
        const qi = _q.copy(near.body.rotation).invert();
        for (let i = 1; i <= 8; i++) {
          const p = shipRel.clone().addScaledVector(sunDir, i * i * 45).sub(near.body.rel);
          const R = p.length();
          const h = near.view.heightAt(p.clone().divideScalar(R).applyQuaternion(qi), 20);
          if (R < near.body.radius + h) { lit = 0; break; }
        }
      }
    }
    this.sun.position.copy(shipRel).addScaledVector(sunDir, 60);
    this.sun.target.position.copy(shipRel);
    this.sun.target.updateMatrixWorld();
    this.sun.color.setRGB(sunCol.x, sunCol.y, sunCol.z).multiplyScalar(1 / Math.max(0.001, Math.max(sunCol.x, sunCol.y, sunCol.z)));
    this.sun.intensity = Math.max(sunCol.x, sunCol.y, sunCol.z) * Math.PI * 0.75 * lit;
    this.hemi.color.setRGB(skyAmb.x, skyAmb.y, skyAmb.z).multiplyScalar(1 / Math.max(0.001, Math.max(skyAmb.x, skyAmb.y, skyAmb.z, 0.001)));
    this.hemi.intensity = Math.max(skyAmb.x, skyAmb.y, skyAmb.z) * Math.PI * 1.4 + 0.03;
    this.hemi.groundColor.setRGB(0.25, 0.2, 0.16);
    // 환경 맵 (0.5초마다)
    this._envT -= dt;
    if (this._envT <= 0) {
      this._envT = 1.0;
      const u = this.envMat.uniforms;
      const upL = up2local(this._up);
      void upL;
      u.uTop.value.copy(skyAmb).multiplyScalar(1.4).addScalar(0.002);
      u.uHor.value.copy(skyAmb).multiplyScalar(2.2).addScalar(0.003);
      u.uGround.value.set(0.06, 0.05, 0.04).multiplyScalar(near && near.view ? dayK + 0.05 : 0.02);
      // 환경 장면은 '위'가 지면 반대가 되도록 회전
      this.envScene.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this._up);
      u.uSun.value.copy(sunDir).applyQuaternion(this.envScene.quaternion.clone().invert());
      u.uSunCol.value.copy(sunCol).multiplyScalar(lit * 0.4);
      this.envScene.updateMatrixWorld(true);
      if (this.envRT) this.envRT.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
      for (const k of ['hull', 'dark', 'accent', 'glass', 'nozzle']) { m.materials[k].envMap = this.envRT.texture; m.materials[k].envMapIntensity = 1.0; }
    }
    // 조종석 화면
    if (this.view === 'cockpit' && (this._frameNo % 6 === 0)) this._drawCockpitScreens();
  }

  _drawCockpitScreens() {
    const sc = this.model.cockpit.userData.screens;
    const f = this.flight;
    const lines = [
      [`단계 ${f.tier}`, `${(f.t.speed / 1000).toFixed(2)} km/s`, `스로틀 ${Math.round(f.throttle * 100)}%`],
      [`선체 ${Math.round(f.integrity)}%`, `온도 ${Math.round(f.hullTemp - 273)}°C`, f.fa ? '관성 보조 ON' : '관성 보조 OFF'],
      [this.target ? this.target.name : '목표 없음', this.target ? formatDistance(this.distanceTo(this.target)) : '', `중력 ${(f.t.gravity / G0).toFixed(2)} g`],
    ];
    sc.forEach((s, i) => {
      const g = s.canvas.getContext('2d');
      g.fillStyle = '#02080c'; g.fillRect(0, 0, 256, 160);
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.strokeRect(4, 4, 248, 152);
      g.fillStyle = '#ffffff'; g.font = '700 26px Rajdhani, sans-serif';
      lines[i].forEach((l, k) => g.fillText(l, 14, 44 + k * 42));
      s.tex.needsUpdate = true;
    });
  }

  _updateParticles(f, near) {
    // 고리 · 소행성대 입자
    let region = null;
    for (const p of this.planets) {
      const b = p.body;
      if (!b.rings) continue;
      const camL = _v.copy(b.rel).negate().applyQuaternion(_q.copy(b.rotation).invert());
      const rr = Math.hypot(camL.x, camL.z);
      if (rr > b.rings.inner && rr < b.rings.outer && Math.abs(camL.y) < 3000) {
        const u = (rr - b.rings.inner) / (b.rings.outer - b.rings.inner);
        const dens = b.rings.palette === 'saturn' && u > 0.66 && u < 0.71 ? 0.05 : 0.75;
        region = { body: b, kind: 'ring', density: dens * (1 - Math.abs(camL.y) / 3000), camLocal: camL.clone(), rotation: b.rotation, palette: b.rings.palette };
      }
    }
    if (!region) {
      const sys = this._systemOf(f.frame);
      const belt = sys && sys.children.find((c) => c.kind === 'belt');
      if (belt) {
        const camS = _v.copy(belt.rel).negate();
        const rr = Math.hypot(camS.x, camS.z);
        if (rr > belt.inner && rr < belt.outer && Math.abs(camS.y) < 0.05 * AU) region = { body: belt, kind: 'belt', density: 0.5, camLocal: camS.clone(), rotation: new THREE.Quaternion(), palette: 'rock' };
      }
    }
    this.particles.update(region);
    this._inRing = region && region.kind === 'ring';
  }

  _updateOrbit() {
    const f = this.flight;
    const line = this.orbitLine;
    line.visible = false;
    this._orbitInfo = null;
    if (!this.orbitOn || f.warp || f.tier > 3) return;
    const F = f.frame;
    let center = F;
    if (F.kind === 'system') center = F.children.find((c) => c.kind === 'star') || null;
    if (!center || !(center.mu > 0) || center.kind === 'galaxy') return;
    const cpos = F === center ? new THREE.Vector3() : center.localPos.clone();
    const r = f.pos.clone().sub(cpos), v = f.vel.clone().sub(F === center ? new THREE.Vector3() : center.localVel);
    const mu = center.mu;
    const rl = r.length();
    if (center.atmo && rl - center.radius < center.atmo.top * 0.5) return;
    const h = r.clone().cross(v);
    const E = v.lengthSq() / 2 - mu / rl;
    const ev = v.clone().cross(h).divideScalar(mu).sub(r.clone().divideScalar(rl));
    const e = ev.length();
    const p = h.lengthSq() / mu;
    if (h.lengthSq() < 1) return;
    const P = e > 1e-6 ? ev.clone().divideScalar(e) : r.clone().divideScalar(rl);
    const Q = h.clone().normalize().cross(P);
    const arr = line.geometry.getAttribute('position');
    const soi = F === center ? (F.soi || 1e13) : 1e13;
    const nuLim = e < 1 ? Math.PI : Math.acos(Math.max(-1, Math.min(1, -1 / e))) - 0.02;
    const base = center.rel;
    // 현재 진근점 이각에서 앞뒤로 지표(또는 영향권) 경계까지만 그린다
    const nu0 = Math.atan2(r.dot(Q), r.dot(P));
    const minR = center.radius + (center.atmo ? center.atmo.top * 0.3 : 0);
    const ok = (nu) => { if (e >= 1 && Math.abs(nu) > nuLim) return false; const rad = p / (1 + e * Math.cos(nu)); return rad > minR * 0.999 && rad < soi * 1.5 && rad > 0; };
    const stepN = (Math.PI * 2) / 256;
    let lo = nu0, hi = nu0;
    for (let i = 0; i < 128 && ok(hi + stepN); i++) hi += stepN;
    for (let i = 0; i < 128 && ok(lo - stepN) && hi - lo < Math.PI * 2 - stepN; i++) lo -= stepN;
    let k = 0;
    for (let i = 0; i <= 256; i++) {
      const nu = lo + ((hi - lo) * i) / 256;
      const rad = p / (1 + e * Math.cos(nu));
      const x = base.x + (P.x * Math.cos(nu) + Q.x * Math.sin(nu)) * rad;
      const y = base.y + (P.y * Math.cos(nu) + Q.y * Math.sin(nu)) * rad;
      const z = base.z + (P.z * Math.cos(nu) + Q.z * Math.sin(nu)) * rad;
      arr.setXYZ(k++, x, y, z);
    }
    arr.needsUpdate = true;
    line.geometry.setDrawRange(0, 257);
    line.matrixWorld.identity();
    line.visible = true;
    const a = -mu / (2 * E);
    this._orbitInfo = e < 1 ? { ap: a * (1 + e) - center.radius, pe: a * (1 - e) - center.radius, period: 2 * Math.PI * Math.sqrt(a * a * a / mu) } : { ap: Infinity, pe: p / (1 + e) - center.radius, period: 0 };
  }

  /* ------------------------------ 이펙트 (부동 원점 앵커) ------------------------------ */
  _updateFx(dt, near, shipRel, agl) {
    const f = this.flight;
    const A = this.fxAnchor;
    const shipFrame = f.pos;
    // 앵커 재설정: 프레임 변경 또는 3 km 이상 이동
    if (A.frame !== f.frame || A.pos.distanceTo(shipFrame) > 3000) {
      A.frame = f.frame;
      A.pos.copy(shipFrame);
      this.fx.clear();
      A.body = near && near.view ? near.body : null;
      if (A.body) {
        const upW = shipFrame.clone().sub(near.pos).normalize();
        A.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), upW);
        A.radius = shipFrame.distanceTo(near.pos);
        A.nearPos = near.pos.clone();
      } else A.q.identity();
      A.qi.copy(A.q).invert();
    }
    // 그룹 변환: 앵커 - 카메라
    const g = this.fxGroup;
    const rel = _v.copy(A.pos).sub(shipFrame).sub(this.camOff);
    g.matrix.makeRotationFromQuaternion(A.q);
    g.matrix.elements[12] = rel.x; g.matrix.elements[13] = rel.y; g.matrix.elements[14] = rel.z;
    g.matrixWorld.copy(g.matrix);
    g.matrixWorldNeedsUpdate = false;
    for (const c of g.children) c.matrixWorldNeedsUpdate = true;
    this._fxRel = rel.clone();
    // 엔진 배기 (대기 중에서만 화염 입자)
    if (f.t.density > 0.002 && !f.warp && this.model.root.visible) {
      for (const e of this.model.engines) {
        const pw = e.pos.clone().applyQuaternion(f.body.quaternion).add(shipRel);
        const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(f.body.quaternion);
        this._fxAt(pw, (p) => this.fx.exhaust(p, this._fxDir(dir), (f.thrustFrac || 0) * 0.8, 'rocket', dt));
      }
    }
    // 재진입 플라스마 꼬리
    if (f.t.reentry > 0.15) {
      const back = f.vel.clone().sub(near ? near.vel : new THREE.Vector3()).normalize().negate();
      this._fxAt(shipRel.clone().addScaledVector(back, 6), (p) => this.fx.fireJet(p, this._fxDir(back), f.t.reentry * 1.5, dt));
    }
    // 저공 비행: 물보라 · 먼지 · 눈보라
    if (near && near.view && near.view.terrain && agl < 40 && f.t.surfSpeed > 25 && this.model.root.visible) {
      const groundW = shipRel.clone().addScaledVector(this._up, -agl);
      const dirL = groundW.clone().sub(near.body.rel).normalize().applyQuaternion(_q.copy(near.body.rotation).invert());
      const h = near.view.heightAt(dirL, 4);
      const T = near.view.terrain.terrain;
      const k = (1 - agl / 40) * Math.min(1, f.t.surfSpeed / 120);
      if (T.hasOcean && h < 0 && T.seaFluid === 'water') {
        const vel = f.vel.clone().sub(near.vel).multiplyScalar(0.25);
        this._fxAt(groundW, (p) => this.fx.waterSpray(p, this._fxDir(vel), k * 1.6, dt));
      } else if (Math.random() < k * dt * 30) {
        const lat = Math.abs(dirL.y);
        const kind = T.kind;
        const snow = kind === 'ice' || (kind === 'terran' && (lat > 0.75 || h > 3500));
        const col = snow ? { r: 0.92, g: 0.95, b: 1 } : kind === 'mars' ? { r: 0.62, g: 0.36, b: 0.2 } : kind === 'moon' || kind === 'asteroid' ? { r: 0.45, g: 0.45, b: 0.45 } : { r: 0.62, g: 0.55, b: 0.42 };
        this._fxAt(groundW, (p) => this.fx.dust(p, k * 2, col));
      }
    }
    const wind = this.fxWorld.env.wind;
    wind.set(0, 0, 0);
    this.fx.update(dt, this.camera, A.body ? this.fxWorld : null);
  }

  /** 카메라 기준 월드 좌표 → 이펙트 그룹 로컬 */
  _fxAt(worldPos, fn) {
    if (!this._fxRel) return;
    const p = worldPos.clone().sub(this._fxRel).applyQuaternion(this.fxAnchor.qi);
    fn(p);
  }
  _fxDir(d) { return d.clone().applyQuaternion(this.fxAnchor.qi); }

  _fxSurface(x, z) {
    const A = this.fxAnchor;
    const b = A.body;
    if (!b) return { height: -1e9, type: 'ground' };
    const v = this.views.get(b);
    // 앵커 로컬 (x, 0, z) → 행성 로컬 방향
    const pw = new THREE.Vector3(x, 0, z).applyQuaternion(A.q).add(A.pos).sub(A.nearPos || new THREE.Vector3());
    const dirL = pw.normalize().applyQuaternion(_q.copy(b.rotation).invert());
    const h = v.heightAt(dirL, 4);
    const ocean = v.terrain && v.terrain.terrain.hasOcean;
    if (ocean && h < 0) return { height: b.radius - A.radius, type: 'water' };
    return { height: b.radius + h - A.radius, type: 'ground' };
  }

  /* ------------------------------ 후처리 유니폼 ------------------------------ */
  _postUniforms(dt, sunDir, sunCol, starTemp, shipRel, near) {
    const f = this.flight;
    const u = this.post.fx.uniforms;
    // 워프 시각 강도: 광속 대비 로그
    const sp = f.warp ? f.warpSpeed : 0;
    const wk = sp > C_LIGHT * 0.5 ? Math.min(1, 0.35 + Math.log10(sp / C_LIGHT + 1) / 9) : 0;
    this.warpVis += (wk - this.warpVis) * Math.min(1, dt * 2.5);
    const ak = Math.min(1, (f.t.accel || 0) / 2500) + (f.tierT < 1 ? 0.5 : 0);
    this.blurVis += (ak - this.blurVis) * Math.min(1, dt * 4);
    u.uWarp.value = this.warpVis;
    u.uBlur.value = this.blurVis;
    u.uTime.value = this.time;
    u.uChroma.value = 0.25 + this.warpVis * 2.5 + f.t.reentry * 0.8;
    u.uHeat.value = Math.max(f.t.reentry, Math.min(1, Math.max(0, (f.hullTemp - 900) / 1500)));
    // 태양 화면 위치 · 가림
    const star = this._mainStar();
    u.uSun.value.set(0, 0, 0, 0);
    if (star) {
      const p = star.rel.clone().project(this.camera);
      const front = _v.copy(star.rel).applyMatrix4(this.camera.matrixWorldInverse).z < 0;
      let vis = front && Math.abs(p.x) < 1.3 && Math.abs(p.y) < 1.3 ? 1 : 0;
      // 행성에 가림 (구 교차)
      if (vis) for (const pl of this.planets) {
        const c = pl.body.rel;
        const b = c.dot(sunDir);
        if (b > 0 && b < star.rel.length()) {
          const d = c.clone().addScaledVector(sunDir, -b).length();
          if (d < pl.body.radius) { vis = 0; break; }
          if (d < pl.body.radius * 1.03) vis *= (d - pl.body.radius) / (pl.body.radius * 0.03);
        }
      }
      if (this.underwater) vis *= 0.1;
      const ang = star.radius / star.rel.length();
      const [r, g, b] = blackbody(starTemp);
      const mx = Math.max(r, g, b);
      u.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, vis * Math.min(1, 0.3 + Math.max(sunCol.x, sunCol.y) / 8), Math.min(3, 0.4 + ang * 200));
      u.uSunCol.value.set(r / mx, g / mx, b / mx);
    }
    // 블랙홀 렌즈
    u.uBH.value.set(0, 0, 0, 0);
    for (const m of this.misc) {
      if (m.body.kind !== 'blackhole') continue;
      const rel = m.body.rel;
      const D = rel.length();
      const camZ = _v.copy(rel).applyMatrix4(this.camera.matrixWorldInverse).z;
      if (camZ >= 0) continue;
      const thetaE = Math.sqrt((2 * m.body.radius) / D);
      const fovY = (this.camera.fov * Math.PI) / 180;
      const e = thetaE / fovY;
      if (e < 0.002) continue;
      const p = rel.clone().project(this.camera);
      u.uBH.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, Math.min(0.5, e), Math.min(0.6, (2.6 * m.body.radius / D) / fovY));
      u.uBHDepth.value = -camZ;
    }
    this.flash = Math.max(0, this.flash - dt * 1.8);
    u.uFlash.value = this.flash * 0.9;
    u.uVignette.value = Math.min(1, (1 - f.integrity / 100) * 0.8 + f.t.reentry * 0.4);
    u.uFlareOn.value = 1;
    if (this.underwater) u.uTint.value.set(0.75, 0.95, 1.05);
    else if (f.integrity < 30) u.uTint.value.set(1.15, 0.85, 0.85);
    else u.uTint.value.set(1, 1, 1);
  }

  _collectWarnings(dt, near, agl) {
    const f = this.flight;
    const t = f.t;
    for (const w of this.warnings) w.t -= dt;
    this.warnings = this.warnings.filter((w) => w.t > 0);
    if (f.hullTemp > 2000) this._warn('선체 과열 — 재진입 가열', f.hullTemp > 2300 ? 3 : 2);
    else if (f.hullTemp > 1300) this._warn('선체 온도 상승', 1);
    if (t.reentry > 0.4 && f.tier >= 2) this._warn('대기권 고속 비행 — 기체 손상 위험', 2);
    if (f.integrity < 25) this._warn('선체 손상 심각', 3);
    else if (f.integrity < 60) this._warn('선체 손상', 1);
    if (near && near.view && agl < 400 && t.vs < -60 && !f.warp) this._warn('지면 접근 — 상승하십시오', agl < 150 ? 3 : 2);
    if (t.pressure > 1e7) this._warn('외부 압력 위험', t.pressure > 2e7 ? 3 : 2);
    if (near && near.body.kind === 'star' && this._lastEnv.nearDist < near.body.radius * 6) this._warn('항성 근접 — 열 손상', 3);
    if (f.tier >= 4 && this._limited) this._warn('근접 자동 감속 중', 1);
    if (this.underwater) this._warn('수중', 1);
    if (Audio.ready) {
      Audio.warning('pullup', near && near.view && agl < 250 && t.vs < -60 && !f.warp);
      Audio.warning('fire', f.hullTemp > 2150 || f.integrity < 20);
    }
  }

  _hudState(env, sunDir) {
    const f = this.flight;
    const t = f.t;
    const near = env.near;
    const W = window.innerWidth, H = window.innerHeight;
    const proj = (rel) => {
      const p = rel.clone().project(this.camera);
      const z = _v.copy(rel).applyMatrix4(this.camera.matrixWorldInverse).z;
      const on = z < 0 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1;
      const ang = Math.atan2(-(z < 0 ? p.y : -p.y), z < 0 ? p.x : -p.x);
      return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H, on, ang };
    };
    const shipRel = this._shipRel().clone();
    // 프로그레이드 (기준 천체 대비 속도)
    let prograde = null, retro = null;
    const vrel = f.vel.clone().sub(near ? near.vel : new THREE.Vector3());
    if (near && near.body.angVel && this._inAtmo) vrel.sub(near.body.surfaceVelocity(shipRel.clone().sub(near.body.rel), new THREE.Vector3()));
    if (vrel.length() > 2 && !f.warp) {
      prograde = proj(shipRel.clone().addScaledVector(vrel.clone().normalize(), 1e4));
      retro = proj(shipRel.clone().addScaledVector(vrel.clone().normalize(), -1e4));
    }
    // 목표
    let target = null;
    if (this.target) {
      const b = this.target;
      const rel = b.rel.clone().sub(shipRel);
      const dist = rel.length();
      const closing = f.warp ? f.warpSpeed * Math.max(0, rel.clone().normalize().dot(f.forward)) : -vrel.dot(rel.clone().normalize().negate());
      const surf = Math.max(0, dist - (b.radius || 0));
      target = { body: b, dist: surf, eta: closing > 1 ? surf / closing : Infinity, screen: proj(b.rel) };
    }
    // 가까운 천체
    let nearest = null;
    if (near) nearest = { body: near.body, dist: Math.max(0, near.view && near.view.terrain ? t.agl : env.nearDist) };
    else {
      const sys = this._systemOf(f.frame), gal = this._galaxyOf(f.frame);
      const cand = sys ? [sys] : gal ? gal.children : this.uni.root.children;
      let best = Infinity;
      for (const c of cand) { const d = c.rel.distanceTo(shipRel); if (d < best) { best = d; nearest = { body: c, dist: d }; } }
    }
    // 라벨: 같은 항성계 천체 (화면 안, 너무 가깝지 않은 것)
    const labels = [];
    const sys = this._systemOf(f.frame);
    const pool = sys ? sys.children.filter((c) => c.kind !== 'belt') : (this._galaxyOf(f.frame) ? this._galaxyOf(f.frame).children : this.uni.root.children);
    for (const b of pool) {
      if (b === this.target) continue;
      const s = proj(b.rel);
      if (!s.on) continue;
      const d = b.rel.length();
      if (b.radius && d < b.radius * 4) continue;
      labels.push({ body: b, x: s.x, y: s.y });
      if (labels.length > 14) break;
    }
    const nb = near ? near.body : null;
    const atmoBody = nb && nb.atmo && t.pressure > 1e-3 ? nb.name : null;
    const gG = (env.sources.reduce((s, src) => { const d2 = src.pos.distanceToSquared(f.pos); return s + src.mu / Math.max(1, d2); }, 0)) / G0;
    return {
      tier: f.tier, tierFrom: f.tierFrom, tierT: f.tierT, warp: f.warp,
      speed: f.warp ? f.warpSpeed : t.speed, speedLabel: this._inAtmo ? '대기 속도' : near ? `${near.body.name} 기준 속도` : '속도',
      throttle: f.throttle, targetSpeed: throttleTarget(f), limited: this._limited, mach: this._inAtmo ? t.mach : 0,
      alt: t.alt, agl: t.agl, vs: t.vs, altShow: !!(near && near.view && t.alt < near.body.radius * 3),
      nearest, target, prograde, retro, labels,
      gravityG: gG, pressure: t.pressure, temp: t.temp, composition: atmoBody ? nb.atmo.comp : null, atmoBody, vacuum: t.pressure < 1e-3,
      hullTemp: f.hullTemp, integrity: f.integrity, heat: t.reentry,
      gear: f.gearDown, fa: f.fa, rcs: Math.abs(f.input.pitch) + Math.abs(f.input.yaw) + Math.abs(f.input.roll) + Math.abs(f.input.lift), orbitOn: this.orbitOn && !!this._orbitInfo,
      view: this.view, orbitInfo: this._orbitInfo, warnings: this.warnings.slice().sort((a, b) => b.level - a.level),
    };
  }
}

function throttleTarget(f) {
  const max = TIERS[f.tier - 1].max;
  if (f.tier === 5) return max * Math.pow(f.throttle, 8);
  if (f.tier === 4) return max * Math.pow(f.throttle, 1.6);
  return max * f.throttle;
}
function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
function up2local(v) { return v; }

void LY; void atmosphereAt; void _atm;
