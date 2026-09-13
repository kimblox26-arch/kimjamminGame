// SpaceSim — 3D 렌더러 (three.js)
// 천체 포인트 셰이더, 궤적, 예측 궤도, 배경 별, 궤도 카메라.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clamp } from '../core/constants.js';
import { Sky } from './sky.js';
import { BodyMeshes } from './bodies.js';

const MAX_TRAILS = 80;
const TRAIL_LEN = 900;

const VERT = /* glsl */`
attribute float aSize;
attribute vec3 aColor;
attribute float aGlow;
varying vec3 vColor;
varying float vGlow;
uniform float uPixelScale;
uniform float uMinPx;
uniform float uMaxPx;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(-mv.z, 1e-6);
  float px = aSize * uPixelScale / d;
  gl_PointSize = clamp(px, uMinPx, uMaxPx);
  vColor = aColor;
  vGlow = aGlow;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
precision highp float;
varying vec3 vColor;
varying float vGlow;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r = length(uv);
  if (r > 1.0) discard;
  // vGlow >= 2.0 이면 코로나 전용 — 구체로 이미 그려진 항성의 바깥 광환만 남긴다
  float corona = step(1.5, vGlow);
  float g = vGlow - corona * 2.0;
  float core = smoothstep(1.0, 0.55, r) * (1.0 - corona);
  float halo = pow(max(0.0, 1.0 - r), 2.0);
  float a = mix(core + halo * g * 0.9, pow(max(0.0, 1.0 - r), 2.6) * 0.9, corona);
  vec3 c = mix(vColor, vColor + vec3(0.45), core * 0.55);
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
  if (gl_FragColor.a < 0.01) discard;
}`;

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x02040a, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.0005, 8000);

    this.target = new THREE.Vector3();
    this.spherical = { theta: 0.6, phi: 1.05, radius: 30 };
    this.focusIndex = -1;
    this.follow = true;

    this.scaleMode = 'linear';
    this.origin = [0, 0, 0];   // 기준 좌표계 원점 (질량중심 / 특정 천체)
    this.unit = 1;
    this.logRef = 0.05;
    this.bodyScale = 1;
    this.showTrails = true;
    this.showOrbits = true;
    this.showGrid = true;

    this.sky = new Sky(this.scene);
    this.bodies = new BodyMeshes(this.scene);
    this.showSpheres = true;
    this._buildGrid();
    this._buildPoints(4096);
    this._buildTrails();
    this._buildOrbit();
    this._setupComposer();
    this._bindInput();
    this.resize();
  }

  // ───────── 씬 구성 ─────────

  _buildGrid() {
    this.gridGroup = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({
      color: 0x2a5a7a, transparent: true, opacity: 0.32, depthWrite: false,
    });
    const matFaint = new THREE.LineBasicMaterial({
      color: 0x1d4058, transparent: true, opacity: 0.2, depthWrite: false,
    });
    for (let k = 1; k <= 12; k++) {
      const pts = [];
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        k % 4 === 0 ? mat : matFaint,
      );
      line.userData.ring = k;
      this.gridGroup.add(line);
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a), Math.sin(a), 0),
      ]);
      const l = new THREE.Line(g, matFaint);
      l.userData.spoke = true;
      this.gridGroup.add(l);
    }
    this.scene.add(this.gridGroup);
  }

  _buildPoints(cap) {
    this.cap = cap;
    const g = new THREE.BufferGeometry();
    this.pAttr = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
    this.cAttr = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
    this.sAttr = new THREE.BufferAttribute(new Float32Array(cap), 1);
    this.gAttr = new THREE.BufferAttribute(new Float32Array(cap), 1);
    this.pAttr.setUsage(THREE.DynamicDrawUsage);
    this.sAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pAttr);
    g.setAttribute('aColor', this.cAttr);
    g.setAttribute('aSize', this.sAttr);
    g.setAttribute('aGlow', this.gAttr);
    g.setDrawRange(0, 0);

    this.pointMat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelScale: { value: 500 },
        uMinPx: { value: 2.4 },
        uMaxPx: { value: 900 },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.pointMat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  _buildTrails() {
    this.trails = [];
    this.trailGroup = new THREE.Group();
    for (let i = 0; i < MAX_TRAILS; i++) {
      const g = new THREE.BufferGeometry();
      const arr = new Float32Array(TRAIL_LEN * 3);
      const attr = new THREE.BufferAttribute(arr, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', attr);
      g.setDrawRange(0, 0);
      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false,
      });
      const line = new THREE.Line(g, mat);
      line.frustumCulled = false;
      line.visible = false;
      this.trailGroup.add(line);
      this.trails.push({ line, attr, head: 0, len: 0, body: -1, raw: new Float64Array(TRAIL_LEN * 3) });
    }
    this.scene.add(this.trailGroup);
  }

  _buildOrbit() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1024 * 3), 3));
    g.setDrawRange(0, 0);
    this.orbitLine = new THREE.Line(g, new THREE.LineBasicMaterial({
      color: 0x7de2ff, transparent: true, opacity: 0.5, depthWrite: false,
    }));
    this.orbitLine.frustumCulled = false;
    this.scene.add(this.orbitLine);
  }

  _setupComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // 문턱값을 높여 실제로 밝은 것(항성·코로나)만 번지게 한다
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.45, 0.80);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.bloomEnabled = true;
  }

  // ───────── 입력 ─────────

  _bindInput() {
    const el = this.canvas;
    let dragging = null, lastX = 0, lastY = 0, pinch = 0;
    const pointers = new Map();

    const down = (e) => {
      el.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragging = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
      lastX = e.clientX; lastY = e.clientY;
    };
    const move = (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.zoom(Math.pow(0.995, d - pinch));
        pinch = d;
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (dragging === 'orbit') {
        this.spherical.theta -= dx * 0.005;
        this.spherical.phi = clamp(this.spherical.phi - dy * 0.005, 0.02, Math.PI - 0.02);
      } else {
        this.pan(dx, dy);
      }
    };
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (pointers.size === 0) dragging = null;
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(Math.pow(1.0016, e.deltaY));
    }, { passive: false });
  }

  zoom(f) {
    this.spherical.radius = clamp(this.spherical.radius * f, 1e-5, 6000);
  }

  pan(dx, dy) {
    const r = this.spherical.radius * 0.0016;
    const right = new THREE.Vector3(), up = new THREE.Vector3();
    this.camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    this.target.addScaledVector(right, -dx * r);
    this.target.addScaledVector(up, dy * r);
    this.follow = false;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.width = w; this.height = h;
    this.pointMat.uniforms.uPixelScale.value =
      (h * dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  // ───────── 좌표 스케일 ─────────

  /**
   * 시뮬레이션 좌표 → 렌더 좌표.
   * raw=false 이면 현재 기준 원점을 먼저 뺀다 (궤적은 기록 시점에 이미 빼므로 raw=true).
   */
  mapPos(x, y, z, out, raw = false) {
    if (!raw) { x -= this.origin[0]; y -= this.origin[1]; z -= this.origin[2]; }
    if (this.scaleMode === 'log') {
      const r = Math.hypot(x, y, z);
      if (r < 1e-14) { out[0] = out[1] = out[2] = 0; return out; }
      const k = this.logK();
      const rr = Math.log10(1 + r / this.logRef) * k;
      const f = rr / r;
      out[0] = x * f; out[1] = y * f; out[2] = z * f;
    } else {
      out[0] = x * this.unit; out[1] = y * this.unit; out[2] = z * this.unit;
    }
    return out;
  }

  logK() {
    return 1 / Math.log10(1 + 1 / this.logRef);
  }

  /** 실제 거리 → 렌더 거리 (카메라 거리 설정용) */
  mapDistance(r) {
    return this.scaleMode === 'log'
      ? Math.log10(1 + r / this.logRef) * this.logK()
      : r * this.unit;
  }

  /** 거리 r 에서의 국소 배율 (반지름 변환용) */
  localScale(r) {
    if (this.scaleMode !== 'log') return this.unit;
    const k = this.logK();
    return k / ((1 + r / this.logRef) * this.logRef * Math.LN10);
  }

  // ───────── 프레임 갱신 ─────────

  sync(sim, opts = {}) {
    const n = sim.count;
    if (n > this.cap) {
      this.scene.remove(this.points);
      this._buildPoints(Math.max(n * 2, this.cap * 2));
    }
    const P = this.pAttr.array, C = this.cAttr.array, S = this.sAttr.array, GL = this.gAttr.array;
    const tmp = this._tmp || (this._tmp = [0, 0, 0]);
    let k = 0;
    this.visibleIndex = this.visibleIndex || [];
    this.visibleIndex.length = 0;

    for (let i = 0; i < n; i++) {
      if (!sim.active[i]) continue;
      const i3 = i * 3;
      const x = sim.pos[i3], y = sim.pos[i3 + 1], z = sim.pos[i3 + 2];
      this.mapPos(x, y, z, tmp);
      P[k * 3] = tmp[0]; P[k * 3 + 1] = tmp[1]; P[k * 3 + 2] = tmp[2];
      const m = sim.meta[i];
      const c = m.color;
      C[k * 3] = ((c >> 16) & 255) / 255;
      C[k * 3 + 1] = ((c >> 8) & 255) / 255;
      C[k * 3 + 2] = (c & 255) / 255;
      const r = Math.hypot(x - this.origin[0], y - this.origin[1], z - this.origin[2]);
      const rr = sim.radius[i] * this.localScale(r) * (m.drawScale || 1) * this.bodyScale;
      if (this.bodies.rendered.has(i)) {
        // 이미 구체로 그렸다 — 항성이면 바깥 코로나만 남기고, 나머지는 생략
        if (m.type !== 'star') continue;
        S[k] = rr * 3.2;
        GL[k] = 2.0;
      } else {
        S[k] = rr;
        GL[k] = m.glow || 0;
      }
      this.visibleIndex[k] = i;
      k++;
    }
    this.points.geometry.setDrawRange(0, k);
    this.pAttr.needsUpdate = true;
    this.cAttr.needsUpdate = true;
    this.sAttr.needsUpdate = true;
    this.gAttr.needsUpdate = true;
    this.drawn = k;

    this._updateTrailGeometry();
    this.trailGroup.visible = this.showTrails;
    this.gridGroup.visible = this.showGrid;
    this._updateGrid();
  }

  /** 구체 LOD 갱신 — updateCamera 뒤, sync 앞에 호출한다 */
  updateBodies(sim) {
    if (!this.showSpheres) { this.bodies.hide(); return; }
    this.bodies.update(sim, this, 4);
  }

  assignTrails(sim) {
    for (const t of this.trails) { t.body = -1; t.len = 0; t.head = 0; t.line.visible = false; }
    let k = 0;
    for (let i = 0; i < sim.count && k < MAX_TRAILS; i++) {
      if (!sim.active[i] || !sim.meta[i].trail) continue;
      const t = this.trails[k++];
      t.body = i;
      t.line.material.color.setHex(sim.meta[i].color);
      t.line.visible = true;
    }
    this.trailCount = k;
  }

  clearTrails() {
    for (const t of this.trails) { t.len = 0; t.head = 0; }
  }

  /** 궤적 표본 기록 — 프레임당 여러 번 호출해 곡선을 매끄럽게 유지한다 */
  recordTrails(sim) {
    for (const t of this.trails) {
      if (t.body < 0 || !sim.active[t.body]) { t.line.visible = false; continue; }
      const b3 = t.body * 3;
      const h = t.head * 3;
      t.raw[h] = sim.pos[b3] - this.origin[0];
      t.raw[h + 1] = sim.pos[b3 + 1] - this.origin[1];
      t.raw[h + 2] = sim.pos[b3 + 2] - this.origin[2];
      t.head = (t.head + 1) % TRAIL_LEN;
      if (t.len < TRAIL_LEN) t.len++;
    }
  }

  _updateTrailGeometry() {
    if (!this.showTrails) return;
    const tmp = this._tmp2 || (this._tmp2 = [0, 0, 0]);
    for (const t of this.trails) {
      if (t.body < 0 || t.len < 2) { t.line.geometry.setDrawRange(0, 0); continue; }
      const arr = t.attr.array;
      const start = (t.head - t.len + TRAIL_LEN) % TRAIL_LEN;
      for (let i = 0; i < t.len; i++) {
        const s = ((start + i) % TRAIL_LEN) * 3;
        this.mapPos(t.raw[s], t.raw[s + 1], t.raw[s + 2], tmp, true);
        arr[i * 3] = tmp[0]; arr[i * 3 + 1] = tmp[1]; arr[i * 3 + 2] = tmp[2];
      }
      t.attr.needsUpdate = true;
      t.line.geometry.setDrawRange(0, t.len);
    }
  }

  setOrbit(points) {
    const g = this.orbitLine.geometry;
    if (!points || points.length < 6) { g.setDrawRange(0, 0); return; }
    const n = points.length / 3;
    let attr = g.getAttribute('position');
    if (attr.count < n) {
      attr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
      g.setAttribute('position', attr);
    }
    const tmp = this._tmp3 || (this._tmp3 = [0, 0, 0]);
    for (let i = 0; i < n; i++) {
      this.mapPos(points[i * 3], points[i * 3 + 1], points[i * 3 + 2], tmp);
      attr.array[i * 3] = tmp[0]; attr.array[i * 3 + 1] = tmp[1]; attr.array[i * 3 + 2] = tmp[2];
    }
    attr.needsUpdate = true;
    g.setDrawRange(0, n);
    this.orbitLine.visible = this.showOrbits;
  }

  /** 그리드 반지름을 현재 줌 수준에 맞춘다 */
  _updateGrid() {
    const R = this.spherical.radius;
    const step = Math.pow(10, Math.floor(Math.log10(R / 4)));
    for (const c of this.gridGroup.children) {
      if (c.userData.spoke) { c.scale.setScalar(step * 12); continue; }
      c.scale.setScalar(step * c.userData.ring);
    }
    this.gridStep = step;
  }

  /** 추적 중인 천체의 렌더 반지름 */
  drawRadiusOf(sim, i) {
    if (i < 0 || i >= sim.count) return 0;
    const i3 = i * 3;
    const r = Math.hypot(
      sim.pos[i3] - this.origin[0],
      sim.pos[i3 + 1] - this.origin[1],
      sim.pos[i3 + 2] - this.origin[2],
    );
    return sim.radius[i] * this.localScale(r) * (sim.meta[i].drawScale || 1) * this.bodyScale;
  }

  /** 카메라 위치 갱신 */
  updateCamera(sim, dtSmooth = 1) {
    if (this.follow && this.focusIndex >= 0 && sim.active[this.focusIndex]) {
      const i3 = this.focusIndex * 3;
      const tmp = this._tmp4 || (this._tmp4 = [0, 0, 0]);
      this.mapPos(sim.pos[i3], sim.pos[i3 + 1], sim.pos[i3 + 2], tmp);
      this.target.set(tmp[0], tmp[1], tmp[2]);
      // 표면 안쪽으로 들어가지 않도록 최소 거리를 유지한다
      const minR = this.drawRadiusOf(sim, this.focusIndex) * 1.25;
      if (minR > 0) this.spherical.radius = Math.max(this.spherical.radius, minR);
    }
    const s = this.spherical;
    const sp = Math.sin(s.phi);
    this.camera.position.set(
      this.target.x + s.radius * sp * Math.cos(s.theta),
      this.target.y + s.radius * sp * Math.sin(s.theta),
      this.target.z + s.radius * Math.cos(s.phi),
    );
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.target);
    this.camera.near = Math.max(1e-6, s.radius * 1e-4);
    this.camera.far = Math.max(100, s.radius * 400 + 6000);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.sky.update(this.camera, Math.min(window.devicePixelRatio || 1, 2));
  }

  render() {
    if (this.bloomEnabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** 화면 좌표 → 가장 가까운 천체 인덱스 */
  pick(sim, sx, sy, radiusPx = 22) {
    const v = new THREE.Vector3();
    const tmp = [0, 0, 0];
    let best = -1, bestD = radiusPx;
    for (let i = 0; i < sim.count; i++) {
      if (!sim.active[i]) continue;
      const i3 = i * 3;
      this.mapPos(sim.pos[i3], sim.pos[i3 + 1], sim.pos[i3 + 2], tmp);
      v.set(tmp[0], tmp[1], tmp[2]).project(this.camera);
      if (v.z > 1) continue;
      const px = (v.x * 0.5 + 0.5) * this.width;
      const py = (-v.y * 0.5 + 0.5) * this.height;
      const d = Math.hypot(px - sx, py - sy);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** 렌더 좌표를 그대로 화면에 투영 (하늘처럼 스케일 변환이 필요 없는 대상) */
  projectRender(x, y, z, out) {
    const v = this._pv2 || (this._pv2 = new THREE.Vector3());
    v.set(x, y, z).project(this.camera);
    out[0] = (v.x * 0.5 + 0.5) * this.width;
    out[1] = (-v.y * 0.5 + 0.5) * this.height;
    out[2] = v.z;
    return out;
  }

  /** 월드 → 화면 좌표 (라벨용) */
  project(x, y, z, out) {
    const tmp = this._tmp5 || (this._tmp5 = [0, 0, 0]);
    this.mapPos(x, y, z, tmp);
    const v = this._pv || (this._pv = new THREE.Vector3());
    v.set(tmp[0], tmp[1], tmp[2]).project(this.camera);
    out[0] = (v.x * 0.5 + 0.5) * this.width;
    out[1] = (-v.y * 0.5 + 0.5) * this.height;
    out[2] = v.z;
    return out;
  }
}
