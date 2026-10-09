// FREE FREELY 우주 탐사 - 천체 미리보기 (화면 밖에서 회전 프레임 시트를 한 번 렌더링해 캐시)
// 큰 자리(96px 이상)에 실제 렌더링한 행성·항성·은하 그림을 천천히 자전시켜 보여준다. 보이는 것만 최대 30fps 로 갱신.
import * as THREE from 'three';
import { makeGasPalette, makeRingTexture } from './textures.js';
import { paletteColors } from './terrain.js';
import { blackbody } from './consts.js';

const FRAMES = 32;
const SIZE = 160;

const P_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN;
varying vec3 vL;
void main() {
  vN = normalize(normalMatrix * normal);
  vL = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const P_FS = /* glsl */`
precision highp float;
precision highp sampler3D;
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler3D uNoise;
uniform sampler2D uPal;
uniform vec3 uC[10];
uniform float uKind;     // 0 지형형 1 기체 2 항성
uniform float uSea;
uniform float uSeed;
uniform vec3 uAtmo;
uniform float uAtmoOn;
uniform vec3 uStar;
varying vec3 vN;
varying vec3 vL;
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += texture(uNoise, p).a * a; p *= 2.1; a *= 0.5; } return s; }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vN);
  vec3 L = normalize(vec3(-0.75, 0.35, 0.65));
  vec3 p = normalize(vL);
  float ndl = max(0.0, dot(n, L));
  vec3 col;
  if (uKind > 1.5) {
    float g = texture(uNoise, p * 3.0 + uSeed).g;
    float mu = max(0.0, n.z);
    col = uStar * (0.7 + g * 0.6) * (0.4 + 0.6 * pow(mu, 0.5)) * 2.2;
    gl_FragColor = vec4(pow(aces(col), vec3(1.0 / 2.2)), 1.0);
    return;
  }
  if (uKind > 0.5) {
    float t = fbm(p * 1.2 + uSeed) - 0.5;
    col = texture(uPal, vec2(p.y * 0.5 + 0.5 + t * 0.06, 0.5)).rgb;
  } else {
    float h = fbm(p * 0.7 + uSeed) + fbm(p * 2.3 + uSeed * 1.7) * 0.35 - 0.62;
    float lat = abs(p.y);
    if (uSea > 0.5 && h < 0.0) col = mix(vec3(0.02, 0.12, 0.3), vec3(0.0, 0.03, 0.12), clamp(-h * 4.0, 0.0, 1.0));
    else {
      col = mix(uC[1], uC[2], smoothstep(0.0, 0.25, h));
      col = mix(col, uC[4], smoothstep(0.2, 0.0, fbm(p * 3.0 + 7.0) - 0.4) * 0.5);
      col = mix(col, uC[0], smoothstep(0.35, 0.6, fbm(p * 5.0 + uSeed)) * 0.4);
      if (uSea > 0.5) col = mix(col, uC[7], smoothstep(0.78, 0.9, lat + h * 0.2));
    }
    float cl = uAtmoOn > 0.5 && uSea > 0.5 ? smoothstep(0.55, 0.75, fbm(p * 2.0 + vec3(uSeed, 0.0, 3.0))) : 0.0;
    col = mix(col, vec3(1.0), cl * 0.85);
  }
  vec3 c = col * (ndl * 1.6 + 0.03);
  float rim = pow(1.0 - max(0.0, n.z), 3.0);
  if (uAtmoOn > 0.5) c += uAtmo * rim * (0.4 + ndl * 1.6) * 1.2;
  gl_FragColor = vec4(pow(aces(c), vec3(1.0 / 2.2)), 1.0);
}`;

export class PreviewCache {
  constructor(renderer, cloudTex) {
    this.renderer = renderer;
    this.cloudTex = cloudTex;
    this.cache = new Map();
    this.queue = [];
    this.views = new Set();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.camera.position.set(0, 0, 4.4);
    this.rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { depthBuffer: true });
    this.pixels = new Uint8Array(SIZE * SIZE * 4);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: P_VS, fragmentShader: P_FS,
      uniforms: {
        uNoise: { value: cloudTex }, uPal: { value: null }, uC: { value: paletteColors('earth') }, uKind: { value: 0 }, uSea: { value: 0 },
        uSeed: { value: 0 }, uAtmo: { value: new THREE.Vector3(0.3, 0.5, 1.0) }, uAtmoOn: { value: 0 }, uStar: { value: new THREE.Vector3(1, 1, 1) },
      },
    });
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), this.mat);
    this.scene.add(this.sphere);
    this.ringMat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.3, 2.2, 96, 1), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2 + 0.35;
    this.scene.add(this.ring);
    this.galaxy = null;
    this._last = 0;
    this._tickBound = (t) => this._tick(t);
    requestAnimationFrame(this._tickBound);
  }

  /** 미리보기 캔버스 요소 생성 (자동 재생) */
  element(body, size = 128) {
    const c = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.height = Math.round(size * dpr);
    c.style.width = c.style.height = size + 'px';
    c.className = 'prev';
    c._body = body;
    c._frame = Math.floor(Math.random() * FRAMES);
    this.views.add(c);
    this._request(body);
    return c;
  }

  _request(body) {
    if (this.cache.has(body.id) || this.queue.includes(body)) return;
    this.queue.push(body);
  }

  _render(body) {
    const sheet = document.createElement('canvas');
    sheet.width = SIZE * FRAMES; sheet.height = SIZE;
    const g = sheet.getContext('2d');
    const img = g.createImageData(SIZE, SIZE);
    const u = this.mat.uniforms;
    const kind = body.kind;
    this.sphere.visible = true;
    this.ring.visible = false;
    if (this.galaxy) this.galaxy.visible = false;
    u.uSeed.value = (body.terrain ? body.terrain.seed : body.seed || 1) * 0.37;
    if (kind === 'star') {
      u.uKind.value = 2;
      const [r, gg, b] = blackbody(body.temp);
      const m = Math.max(r, gg, b);
      u.uStar.value.set(r / m, gg / m, b / m);
    } else if (body.gas) {
      u.uKind.value = 1;
      u.uPal.value = makeGasPalette(body.gas.palette);
    } else {
      u.uKind.value = 0;
      u.uC.value = paletteColors(body.palette || 'moon');
      u.uSea.value = body.terrain && body.terrain.ocean ? 1 : 0;
    }
    u.uAtmoOn.value = body.atmo ? 1 : 0;
    if (body.atmo) {
      const b = body.atmo.betaR, m = body.atmo.betaM;
      const c = [b[0] + m[0] * 0.3, b[1] + m[1] * 0.3, b[2] + m[2] * 0.3];
      const mx = Math.max(...c);
      u.uAtmo.value.set(c[0] / mx, c[1] / mx, c[2] / mx);
    }
    if (body.rings) {
      this.ring.visible = true;
      this.ringMat.map = makeRingTexture(body.rings.palette, body.rings.seed);
      this.ringMat.map.needsUpdate = true;
      this.ringMat.needsUpdate = true;
      const k = body.rings.inner / body.radius, k2 = body.rings.outer / body.radius;
      this.ring.geometry.dispose();
      const rg = new THREE.RingGeometry(k, k2, 96, 1);
      // 반지름 방향 UV
      const pos = rg.getAttribute('position'), uv = rg.getAttribute('uv');
      for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - k) / (k2 - k), 0.5);
      this.ring.geometry = rg;
      this.camera.position.z = 4.4 * Math.max(1, k2 / 1.4) * 0.75;
    } else this.camera.position.z = 4.4;
    if (kind === 'galaxy' || kind === 'nebula' || kind === 'blackhole' || kind === 'system' || kind === 'belt') this._buildGalaxy(body);
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevTM = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    for (let f = 0; f < FRAMES; f++) {
      const a = (f / FRAMES) * Math.PI * 2;
      this.sphere.rotation.set(0.25, a, 0);
      if (this.galaxy && this.galaxy.visible) this.galaxy.rotation.set(1.05, a * (kind === 'galaxy' ? 1 : 0.25), 0.2);
      r.setRenderTarget(this.rt);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(this.scene, this.camera);
      r.readRenderTargetPixels(this.rt, 0, 0, SIZE, SIZE, this.pixels);
      // 상하 반전 복사
      for (let y = 0; y < SIZE; y++) img.data.set(this.pixels.subarray((SIZE - 1 - y) * SIZE * 4, (SIZE - y) * SIZE * 4), y * SIZE * 4);
      g.putImageData(img, f * SIZE, 0);
    }
    r.setRenderTarget(prevRT);
    r.toneMapping = prevTM;
    this.cache.set(body.id, sheet);
  }

  _buildGalaxy(body) {
    this.sphere.visible = false;
    if (this.galaxy) { this.scene.remove(this.galaxy); this.galaxy.geometry.dispose(); }
    const n = 9000;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let s = (body.seed || 7) * 99991;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const C = body.colors || { core: [1, 0.8, 0.6], arm: [0.6, 0.7, 1] };
    const type = body.kind === 'galaxy' ? body.gtype : body.kind;
    for (let i = 0; i < n; i++) {
      let x, y, z, c;
      if (type === 'spiral' || type === 'system') {
        const r = Math.pow(rnd(), 1.4) * 1.6;
        const arm = Math.floor(rnd() * (body.arms || 2));
        const th = arm * Math.PI * 2 / (body.arms || 2) + Math.log(r * 8 + 1) * (body.armTwist || 3) * 0.55 + (rnd() - 0.5) * 0.7;
        x = Math.cos(th) * r; z = Math.sin(th) * r; y = (rnd() - 0.5) * 0.06;
        if (rnd() < 0.2) { const rr = rnd() * 0.3; x = (rnd() - 0.5) * rr * 2; z = (rnd() - 0.5) * rr * 2; y = (rnd() - 0.5) * rr; }
        const t = Math.min(1, r / 1.2);
        c = [C.core[0] * (1 - t) + C.arm[0] * t, C.core[1] * (1 - t) + C.arm[1] * t, C.core[2] * (1 - t) + C.arm[2] * t];
      } else if (type === 'blackhole') {
        const r = 0.45 + Math.pow(rnd(), 0.6) * 1.3, th = rnd() * Math.PI * 2;
        x = Math.cos(th) * r; z = Math.sin(th) * r; y = (rnd() - 0.5) * 0.03;
        const hot = 1 - (r - 0.45) / 1.3;
        c = [1, 0.5 + hot * 0.45, 0.2 + hot * 0.6];
      } else if (type === 'nebula') {
        x = (rnd() + rnd() + rnd() - 1.5) * 1.3; y = (rnd() + rnd() - 1) * 0.9; z = (rnd() + rnd() - 1) * 0.9;
        const k = body.colors[Math.floor(rnd() * body.colors.length)];
        c = k;
      } else {
        const e = body.ellip || [1, 0.8, 0.8];
        const r = Math.pow(rnd(), 2.2) * 1.5, th = rnd() * Math.PI * 2, ph = Math.acos(rnd() * 2 - 1);
        x = Math.sin(ph) * Math.cos(th) * r * e[0]; y = Math.cos(ph) * r * e[1]; z = Math.sin(ph) * Math.sin(th) * r * e[2];
        c = C.core;
        if (type === 'irregular') { x += (rnd() - 0.5) * 1.2; z += (rnd() - 0.5) * 0.8; c = rnd() < 0.5 ? C.arm : C.core; }
      }
      pos.set([x, y, z], i * 3);
      col.set(c, i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!this._dotTex) {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
      this._dotTex = new THREE.CanvasTexture(c);
    }
    this.galaxy = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.06, map: this._dotTex, vertexColors: true, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.galaxy);
    if (body.kind === 'blackhole') this.sphere.visible = false;
  }

  _tick(t) {
    requestAnimationFrame(this._tickBound);
    // 생성: 프레임당 1개
    if (this.queue.length) {
      const b = this.queue.shift();
      try { this._render(b); } catch (e) { console.warn('미리보기 생성 실패', b.id, e); this.cache.set(b.id, null); }
    }
    if (t - this._last < 33) return;   // 최대 30fps
    this._last = t;
    for (const c of this.views) {
      if (!c.isConnected) { this.views.delete(c); continue; }
      if (c.offsetParent === null) continue;
      const sheet = this.cache.get(c._body.id);
      if (!sheet) continue;
      c._frame = (c._frame + 0.25) % FRAMES;
      const f = Math.floor(c._frame);
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(sheet, f * SIZE, 0, SIZE, SIZE, 0, 0, c.width, c.height);
    }
  }
}
