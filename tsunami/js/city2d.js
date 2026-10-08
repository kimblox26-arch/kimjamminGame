// 2D 도시 지도 — 위에서 내려다본 해랑시: 지형·도로·건물 + 실시간 침수(천수방정식 결과) + 사람·표류물
import * as THREE from 'three';
import { WORLD, HALF } from './config.js';
import { coastZ, riverX, PORT_Z } from './geo.js';
import { STYLE } from './city.js';

const VERT = /* glsl */`
varying vec2 vXZ;
void main() { vXZ = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */`
precision highp float;
varying vec2 vXZ;
uniform sampler2D tBase; uniform sampler2D tGround; uniform sampler2D tW; uniform sampler2D tWp; uniform sampler2D tF; uniform sampler2D tFlood;
uniform float uBlend, uN, uDx, uHalf, uR, uCell, uTime, uOverlay, uPx;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
vec4 fw(ivec2 c) { c = clamp(c, ivec2(0), ivec2(int(uN) - 1)); return mix(texelFetch(tWp, c, 0), texelFetch(tW, c, 0), uBlend); }
vec4 water(vec2 xz) {
  vec2 g = (xz + uHalf) / uDx - 0.5; ivec2 i0 = ivec2(floor(g)); vec2 f = fract(g);
  return mix(mix(fw(i0), fw(i0 + ivec2(1,0)), f.x), mix(fw(i0 + ivec2(0,1)), fw(i0 + ivec2(1,1)), f.x), f.y);
}
float gh(ivec2 c) { c = clamp(c, ivec2(0), ivec2(int(uR) - 1)); return texelFetch(tGround, c, 0).r; }
float ground(vec2 xz) {
  vec2 g = (xz + uHalf) / uCell; ivec2 i0 = ivec2(floor(g)); vec2 f = fract(g);
  return mix(mix(gh(i0), gh(i0 + ivec2(1,0)), f.x), mix(gh(i0 + ivec2(0,1)), gh(i0 + ivec2(1,1)), f.x), f.y);
}
vec3 floodRamp(float d) {
  vec3 c = vec3(0.55, 0.85, 0.95);
  c = mix(c, vec3(0.25, 0.6, 0.95), smoothstep(0.5, 2.0, d));
  c = mix(c, vec3(0.12, 0.3, 0.85), smoothstep(2.0, 5.0, d));
  c = mix(c, vec3(0.42, 0.14, 0.7), smoothstep(5.0, 9.0, d));
  return c;
}
void main() {
  vec2 uv = (vXZ + uHalf) / (2.0 * uHalf);
  vec3 col = texture2D(tBase, vec2(uv.x, 1.0 - uv.y)).rgb;
  float g = ground(vXZ);
  vec4 w = water(vXZ);
  float depth = w.x - g;
  vec4 F = texture2D(tFlood, uv);
  // 침수 흔적 (지금은 마른 땅)
  if (uOverlay > 0.0 && g > 0.2) {
    float md = F.g * 10.2;
    col = mix(col, floodRamp(md), smoothstep(0.05, 0.25, md) * 0.55 * uOverlay);
  }
  col = mix(col, col * vec3(0.72, 0.68, 0.6), F.b * 0.6);   // 진흙 퇴적
  if (depth > 0.0) {
    vec4 fm = texture2D(tF, uv);
    float foam = fm.r, mud = fm.g;
    vec2 vel = w.zw; float spd = length(vel);
    vec3 deep = vec3(0.035, 0.11, 0.2), shallow = vec3(0.13, 0.42, 0.5);
    vec3 wc = mix(shallow, deep, 1.0 - exp(-depth * 0.09));
    wc = mix(wc, mix(vec3(0.42, 0.33, 0.21), vec3(0.27, 0.21, 0.13), clamp(depth * 0.3, 0.0, 1.0)), clamp(mud * 1.2, 0.0, 1.0));
    // 흐름 방향 줄무늬 · 물결
    float ph = fract(uTime * 0.3);
    float st = vnoise((vXZ - vel * ph * 6.0) * 0.12) * 0.6 + vnoise(vXZ * 0.03 + uTime * 0.05) * 0.4;
    wc *= 0.92 + 0.16 * st * (0.4 + clamp(spd * 0.2, 0.0, 1.0));
    // 해안 쇄파 띠 + 쇄파 거품
    float surf = pow(0.5 + 0.5 * sin(depth * 4.0 + uTime * 1.5 + vnoise(vXZ * 0.04) * 6.0), 8.0) * (1.0 - smoothstep(0.2, 2.0, depth)) * step(-1.0, -g);
    float fa = clamp(max(foam, surf * 0.6), 0.0, 1.0);
    float fpat = smoothstep(0.35, 0.8, vnoise((vXZ - vel * ph * 6.0) * 0.5) * fa + fa * 0.4);
    wc = mix(wc, mix(vec3(0.93, 0.95, 0.96), vec3(0.7, 0.62, 0.5), mud * 0.7), fpat);
    float a = smoothstep(0.0, 0.35, depth) * (g < 0.0 ? 1.0 : smoothstep(0.0, 0.03, w.y));
    col = mix(col, wc, a);
    // 물가 하이라이트
    col += vec3(0.25, 0.32, 0.34) * (1.0 - smoothstep(0.0, 0.4, depth)) * a * 0.35;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class CityMap2D {
  constructor(renderer, ctx, water, { quality = 'medium' } = {}) {
    this.renderer = renderer;
    this.ctx = ctx;               // { terrain, city, sim, people }
    this.water = water;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a1a2b);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 5000);
    this.camera.up.set(0, 0, -1);     // 화면 위 = 북쪽(-z)
    this.view = { cx: 100, cz: 0, zoom: 0.35 };   // zoom: 화면 픽셀 / m
    this.goal = { ...this.view };
    this.w = 1; this.h = 1;
    this.onTap = null;
    this.ptr = new Map();
    this.size = quality === 'low' ? 2048 : 4096;
    this.buildGround();
    this.buildBuildings();
    this.buildDots();
    this.preview = this.makePreview();
    this.scene.add(this.preview);
  }

  /* ───────────── 바탕 지도 (한 번 그림) ───────────── */
  buildGround() {
    const { terrain, city } = this.ctx;
    const S = this.size, base = document.createElement('canvas');
    base.width = base.height = S;
    const g = base.getContext('2d');
    // 지형 색 + 음영 (1024 격자에서 계산 후 확대)
    const T = 1024, tc = document.createElement('canvas');
    tc.width = tc.height = T;
    const tg = tc.getContext('2d'), img = tg.createImageData(T, T);
    const step = WORLD / T;
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
      const x = -HALF + (i + 0.5) * step, z = -HALF + (j + 0.5) * step;
      const h = terrain.terrainAt(x, z);
      const hx = terrain.terrainAt(x + 6, z) - terrain.terrainAt(x - 6, z), hz = terrain.terrainAt(x, z + 6) - terrain.terrainAt(x, z - 6);
      const shade = Math.max(0.62, Math.min(1.18, 1 + (-hx * 0.7 - hz * 0.7) * 0.05));
      let r, gg, b;
      if (h < 0) { const d = Math.min(1, -h / 12); r = 196 - d * 70; gg = 186 - d * 70; b = 160 - d * 50; }        // 해저 모래
      else if (h < 2.4) { r = 226; gg = 214; b = 182; }                                                      // 모래사장
      else {
        const t = Math.min(1, Math.max(0, (h - 14) / 40));
        r = (205 - t * 95) * shade; gg = (212 - t * 70) * shade; b = (190 - t * 90) * shade;              // 저지대 → 숲 언덕
      }
      const o = (j * T + i) * 4;
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    tg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(tc, 0, 0, S, S);
    const s = S / WORLD, P = (x, z) => [(x + HALF) * s, (z + HALF) * s];
    // 항만 부지
    g.fillStyle = '#d9d6cf';
    g.beginPath();
    let [px, pz] = P(-HALF, PORT_Z + 2); g.moveTo(px, pz);
    for (let x = -HALF; x <= -980; x += 20) { [px, pz] = P(x, Math.min(coastZ(x), PORT_Z) + 2); g.lineTo(px, pz); }
    [px, pz] = P(-980, -230); g.lineTo(px, pz); [px, pz] = P(-HALF, -230); g.lineTo(px, pz);
    g.closePath(); g.fill();
    // 도로 (테두리 → 노면)
    g.lineCap = 'round';
    const road = (style, add) => {
      g.strokeStyle = style;
      for (const rd of city.roads) {
        g.lineWidth = Math.max(1, (rd.w + add) * s);
        g.beginPath(); const a = P(rd.x0, rd.z0), b = P(rd.x1, rd.z1); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
    };
    road('rgba(150,146,138,0.9)', 7);
    road('#fbfaf6', 0);
    // 해변 산책로
    g.strokeStyle = '#efe7d6'; g.lineWidth = 7 * s; g.beginPath();
    city.promenade.forEach(([x, z], i) => { const p = P(x, z); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
    g.stroke();
    // 다리
    g.fillStyle = '#e8e4dc';
    for (const b of terrain.bridges) { const a = P(b.x0, b.z0); g.fillRect(a[0], a[1], (b.x1 - b.x0) * s, (b.z1 - b.z0) * s); }
    this.baseTex = new THREE.CanvasTexture(base);
    this.baseTex.colorSpace = THREE.SRGBColorSpace;
    this.baseTex.anisotropy = 4;
    // 지면 높이 텍스처 (정확한 수심 계산용)
    const R = terrain.R;
    this.groundTex = new THREE.DataTexture(new Float32Array(terrain.h), R, R, THREE.RedFormat, THREE.FloatType);
    this.groundTex.needsUpdate = true;
    const sim = this.ctx.sim;
    this.uniforms = {
      tBase: { value: this.baseTex }, tGround: { value: this.groundTex },
      tW: { value: null }, tWp: { value: null }, tF: { value: this.water.texF }, tFlood: { value: this.water.texFlood },
      uBlend: { value: 1 }, uN: { value: sim.N }, uDx: { value: sim.dx }, uHalf: { value: HALF }, uR: { value: R }, uCell: { value: terrain.cell },
      uTime: { value: 0 }, uOverlay: { value: 1 }, uPx: { value: 1 },
    };
    const geo = new THREE.PlaneGeometry(WORLD, WORLD, 1, 1).rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms }));
    this.scene.add(this.ground);
  }

  /* ───────────── 건물 (붕괴 상태 반영) ───────────── */
  buildBuildings() {
    const B = this.ctx.city.buildings, n = B.length;
    const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shadow = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ color: 0x1c2430, transparent: true, opacity: 0.28, depthWrite: false }), n);
    this.roofs = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    this.shadow.position.y = 1; this.roofs.position.y = 2;
    this.shadow.frustumCulled = this.roofs.frustumCulled = false;
    this.scene.add(this.shadow, this.roofs);
    this.bState = new Int8Array(n).fill(-2);
    this.refreshBuildings(true);
  }

  refreshBuildings(force) {
    const B = this.ctx.city.buildings, m = new THREE.Matrix4(), c = new THREE.Color();
    let any = false;
    for (let i = 0; i < B.length; i++) {
      const b = B[i], st = b.alive ? 1 : 0;
      if (!force && this.bState[i] === st) continue;
      this.bState[i] = st; any = true;
      const off = Math.min(14, b.h * 0.18) * st;
      m.makeScale(b.w, 1, b.d).setPosition(b.x + off * 0.7, 0, b.z + off);
      this.shadow.setMatrixAt(i, m);
      m.makeScale(b.w * (st ? 1 : 1.1), 1, b.d * (st ? 1 : 1.1)).setPosition(b.x, 0, b.z);
      this.roofs.setMatrixAt(i, m);
      if (!st) c.setRGB(0.55, 0.49, 0.42);
      else {
        // 높이가 높을수록 진하게, 용도별 색조
        const t = Math.min(1, b.h / 90);
        const hue = b.style === STYLE.house ? [0.86, 0.8, 0.74] : b.style === STYLE.warehouse ? [0.76, 0.79, 0.82] : b.style === STYLE.shelter ? [0.62, 0.82, 0.66] : [0.84, 0.84, 0.86];
        c.setRGB(hue[0] - t * 0.32, hue[1] - t * 0.32, hue[2] - t * 0.28);
      }
      this.roofs.setColorAt(i, c);
    }
    if (any) {
      this.shadow.instanceMatrix.needsUpdate = this.roofs.instanceMatrix.needsUpdate = true;
      if (this.roofs.instanceColor) this.roofs.instanceColor.needsUpdate = true;
    }
  }

  /* ───────────── 사람 · 표류물 점 ───────────── */
  buildDots() {
    const circ = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
    this.dots = new THREE.InstancedMesh(circ, new THREE.MeshBasicMaterial({ color: 0xffffff }), 1200);
    this.dots.position.y = 4;
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    const rect = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.things = new THREE.InstancedMesh(rect, new THREE.MeshBasicMaterial({ color: 0xffffff }), 3000);
    this.things.position.y = 3;
    this.things.count = 0;
    this.things.frustumCulled = false;
    this.scene.add(this.dots, this.things);
  }

  makePreview() {
    const g = new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.9, depthTest: false }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.16, depthTest: false }));
    const grp = new THREE.Group();
    grp.add(m, fill);
    grp.position.y = 6;
    grp.visible = false;
    return grp;
  }

  /** src: { x, z, radius (m), stretch (가로/세로 비), angle (rad) } | null */
  setPreview(src) {
    if (!src) { this.preview.visible = false; return; }
    this.preview.visible = true;
    this.preview.position.set(src.x, 6, src.z);
    this.preview.rotation.y = -(src.angle || 0);
    this.preview.scale.set(src.radius * (src.stretch || 1), 1, src.radius);
  }

  /** 사람·물체 표시 갱신 */
  updateDots(people, bodies) {
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const px = Math.max(1.2, 2.6 / this.view.zoom);      // 화면에서 최소 크기 유지
    let n = 0;
    if (people) for (const p of people.list) {
      if (p.state === 'missing' || p.state === 'inside' || n >= 1200) continue;
      m.makeScale(px, 1, px).setPosition(p.x, 0, p.z);
      this.dots.setMatrixAt(n, m);
      const s = p.state;
      if (s === 'swept') c.setRGB(0.95, 0.25, 0.22);
      else if (s === 'safe' || s === 'roof') c.setRGB(0.25, 0.78, 0.48);
      else if (s === 'evac') c.setRGB(0.98, 0.7, 0.18);
      else c.setRGB(0.15, 0.2, 0.28);
      this.dots.setColorAt(n, c);
      n++;
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
    let k = 0;
    if (bodies) for (const b of bodies) {
      if (k >= 3000) break;
      m.makeRotationY(b.yaw || 0);
      m.scale(new THREE.Vector3(b.L, 1, b.W));
      m.setPosition(b.x, 0, b.z);
      this.things.setMatrixAt(k, m);
      this.things.setColorAt(k, c.set(b.color ?? 0x888888));
      k++;
    }
    this.things.count = k;
    this.things.instanceMatrix.needsUpdate = true;
    if (this.things.instanceColor) this.things.instanceColor.needsUpdate = true;
  }

  /* ───────────── 카메라 · 입력 ───────────── */
  setSize(w, h) { this.w = w; this.h = h; this.applyView(); }

  applyView() {
    const v = this.view, hw = this.w / 2 / v.zoom, hh = this.h / 2 / v.zoom;
    const cam = this.camera;
    cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh;
    cam.position.set(v.cx, 2000, v.cz);
    cam.lookAt(v.cx, 0, v.cz);
    cam.updateProjectionMatrix();
  }

  fitZoom() { return Math.min(this.w, this.h) / WORLD * 1.05; }

  clampGoal() {
    const g = this.goal;
    g.zoom = Math.max(this.fitZoom() * 0.8, Math.min(12, g.zoom));
    g.cx = Math.max(-HALF, Math.min(HALF, g.cx));
    g.cz = Math.max(-HALF, Math.min(HALF, g.cz));
  }

  flyTo(cx, cz, zoom) { this.goal.cx = cx; this.goal.cz = cz; if (zoom) this.goal.zoom = zoom; this.clampGoal(); }

  screenToWorld(sx, sy) {
    const v = this.view;
    return { x: v.cx + (sx - this.w / 2) / v.zoom, z: v.cz + (sy - this.h / 2) / v.zoom };
  }

  worldToScreen(x, z) {
    const v = this.view;
    return { x: (x - v.cx) * v.zoom + this.w / 2, y: (z - v.cz) * v.zoom + this.h / 2 };
  }

  attach(el) {
    this.el = el;
    this.h_down = (e) => this.down(e); this.h_move = (e) => this.move(e); this.h_up = (e) => this.up(e);
    this.h_wheel = (e) => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); };
    el.addEventListener('pointerdown', this.h_down);
    el.addEventListener('pointermove', this.h_move);
    el.addEventListener('pointerup', this.h_up);
    el.addEventListener('pointercancel', this.h_up);
    el.addEventListener('wheel', this.h_wheel, { passive: false });
  }

  detach() {
    const el = this.el;
    if (!el) return;
    el.removeEventListener('pointerdown', this.h_down);
    el.removeEventListener('pointermove', this.h_move);
    el.removeEventListener('pointerup', this.h_up);
    el.removeEventListener('pointercancel', this.h_up);
    el.removeEventListener('wheel', this.h_wheel);
    this.el = null;
    this.ptr.clear();
  }

  zoomAt(sx, sy, f) {
    const before = this.screenToWorld(sx, sy);
    this.goal.zoom *= f;
    this.clampGoal();
    // 커서 아래 지점이 고정되도록
    this.goal.cx = before.x - (sx - this.w / 2) / this.goal.zoom;
    this.goal.cz = before.z - (sy - this.h / 2) / this.goal.zoom;
    this.clampGoal();
  }

  down(e) {
    this.el.setPointerCapture(e.pointerId);
    this.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    this.moved = this.ptr.size > 1;
  }

  move(e) {
    const p = this.ptr.get(e.pointerId);
    if (!p) return;
    if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 7) this.moved = true;
    if (this.ptr.size === 1 && this.moved) {
      this.goal.cx -= (e.clientX - p.x) / this.goal.zoom;
      this.goal.cz -= (e.clientY - p.y) / this.goal.zoom;
      this.clampGoal();
    } else if (this.ptr.size === 2) {
      const o = [...this.ptr.values()].find((q) => q !== p);
      const d0 = Math.hypot(p.x - o.x, p.y - o.y), d1 = Math.hypot(e.clientX - o.x, e.clientY - o.y);
      if (d0 > 8) this.zoomAt((e.clientX + o.x) / 2, (e.clientY + o.y) / 2, d1 / d0);
    }
    p.x = e.clientX; p.y = e.clientY;
  }

  up(e) {
    const p = this.ptr.get(e.pointerId);
    this.ptr.delete(e.pointerId);
    if (!p) return;
    if (!this.moved && this.ptr.size === 0 && performance.now() - p.t < 500 && this.onTap) {
      const w = this.screenToWorld(e.clientX, e.clientY);
      this.onTap(w.x, w.z, e.clientX, e.clientY);
    }
  }

  update(dt, time) {
    const k = 1 - Math.exp(-dt * 10), v = this.view, g = this.goal;
    v.cx += (g.cx - v.cx) * k; v.cz += (g.cz - v.cz) * k;
    v.zoom *= Math.pow(g.zoom / v.zoom, k);
    this.applyView();
    const u = this.uniforms, wu = this.water.uniforms;
    u.tW.value = wu.tW.value; u.tWp.value = wu.tWp.value; u.uBlend.value = wu.uBlend.value;
    u.uTime.value = time;
    this.refreshBuildings(false);
    const pr = this.preview;
    if (pr.visible) pr.children[0].material.opacity = 0.6 + 0.35 * Math.sin(time * 5);
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
