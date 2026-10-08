// 시각 효과: 쇄파 물보라 · 건물 충돌 물기둥 · 운석 · 충격파 · 먼지
import * as THREE from 'three';
import { HALF } from './config.js';

const VERT = /* glsl */`
attribute float aSize; attribute float aAlpha; attribute float aMud;
varying float vAlpha; varying float vMud;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSize * uScale / max(-mv.z, 0.5), 256.0);
  vAlpha = aAlpha; vMud = aMud;
}`;
const FRAG = /* glsl */`
varying float vAlpha; varying float vMud;
uniform float uLight; uniform vec3 uTint;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.1, r) * vAlpha;
  vec3 col = mix(vec3(0.95, 0.97, 1.0), vec3(0.55, 0.45, 0.33), vMud) * uLight * uTint;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Effects {
  constructor(scene, max) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.mud = new Float32Array(max);
    this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aMud', new THREE.BufferAttribute(this.mud, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 600 }, uLight: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    // 운석
    const glow = document.createElement('canvas'); glow.width = glow.height = 128;
    const gc = glow.getContext('2d');
    const gr = gc.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.25, 'rgba(255,200,120,0.9)'); gr.addColorStop(1, 'rgba(255,90,20,0)');
    gc.fillStyle = gr; gc.fillRect(0, 0, 128, 128);
    this.meteor = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glow), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.meteor.visible = false;
    this.meteor.renderOrder = 6;
    scene.add(this.meteor);
    this.meteorState = null;
    // 충격파 고리
    this.shock = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.shock.visible = false;
    scene.add(this.shock);
    this.shockT = -1;
  }

  emit(x, y, z, vx, vy, vz, life, size, mud = 0, drag = 0.6) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.mud[i] = mud; this.drag[i] = drag;
  }

  /** 시뮬레이션 상태에서 물보라 생성 */
  spawnFromSim(sim, city, cam, dt, scale) {
    if (!sim.active) return;
    const N = sim.N, dx = sim.dx, h = sim.h, uc = sim.uc, vc = sim.vc, foam = sim.foam, b = sim.b, mud = sim.mud;
    const near = cam.y < 400;
    const R = near ? Math.max(150, cam.y * 4) : 2200;
    const ci = Math.floor((cam.x + HALF) / dx), cj = Math.floor((cam.z + HALF) / dx), rc = Math.ceil(R / dx);
    const samples = Math.floor((near ? 900 : 700) * scale);
    for (let s = 0; s < samples; s++) {
      const i = ci + Math.floor((Math.random() * 2 - 1) * rc), j = cj + Math.floor((Math.random() * 2 - 1) * rc);
      if (i < 1 || j < 1 || i >= N - 1 || j >= N - 1) continue;
      const k = j * N + i;
      const hh = h[k];
      if (hh < 0.2) continue;
      const u = uc[k], v = vc[k], sp = Math.hypot(u, v);
      if (sp < 2.2 || foam[k] < 0.5) continue;
      const x = -HALF + (i + Math.random()) * dx, z = -HALF + (j + Math.random()) * dx;
      const y = hh + b[k];
      const n = near ? 3 : 1;
      for (let q = 0; q < n; q++) {
        this.emit(x + (Math.random() - 0.5) * 4, y + 0.3, z + (Math.random() - 0.5) * 4,
          u * (0.8 + Math.random() * 0.5), 1.5 + Math.random() * sp * 0.7, v * (0.8 + Math.random() * 0.5),
          1 + Math.random() * 1.5, near ? 3 + Math.random() * 5 : 14 + Math.random() * 16, Math.min(1, mud[k]));
      }
    }
    // 건물 충돌 물기둥
    const bl = city.buildings;
    const tries = Math.floor(160 * scale);
    for (let s = 0; s < tries; s++) {
      const B = bl[Math.floor(Math.random() * bl.length)];
      if (!B.alive || !B.force.length) continue;
      if (Math.abs(B.x - cam.x) > R || Math.abs(B.z - cam.z) > R) continue;
      const k = B.force[Math.floor(Math.random() * B.force.length)];
      const hh = h[k];
      if (hh < 0.4) continue;
      const u = uc[k], v = vc[k], sp = Math.hypot(u, v);
      if (sp < 2) continue;
      // 흐름이 건물 쪽을 향하는지
      const ki = k % N, kj = (k - ki) / N;
      const cx = -HALF + (ki + 0.5) * dx, cz = -HALF + (kj + 0.5) * dx;
      if ((B.x - cx) * u + (B.z - cz) * v <= 0) continue;
      const px = Math.max(B.x - B.w / 2, Math.min(B.x + B.w / 2, cx)), pz = Math.max(B.z - B.d / 2, Math.min(B.z + B.d / 2, cz));
      const y = hh + b[k];
      const n = near ? 6 : 2;
      for (let q = 0; q < n; q++) {
        this.emit(px + (Math.random() - 0.5) * 3, y, pz + (Math.random() - 0.5) * 3,
          -u * 0.2 + (Math.random() - 0.5) * 2, sp * (0.8 + Math.random() * 0.9), -v * 0.2 + (Math.random() - 0.5) * 2,
          1.2 + Math.random() * 1.4, near ? 4 + Math.random() * 7 : 16 + Math.random() * 20, Math.min(1, mud[k]));
      }
    }
  }

  splash(x, y, z, power, count, mud = 0) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random();
      this.emit(x + Math.cos(a) * r * 6, y, z + Math.sin(a) * r * 6,
        Math.cos(a) * power * 0.3 * Math.random(), power * (0.5 + Math.random()), Math.sin(a) * power * 0.3 * Math.random(),
        2 + Math.random() * 3, 6 + Math.random() * 14, mud, 0.3);
    }
  }

  dust(x, y, z, size, count) {
    for (let i = 0; i < count; i++) {
      this.emit(x + (Math.random() - 0.5) * size, y + Math.random() * size * 0.3, z + (Math.random() - 0.5) * size,
        (Math.random() - 0.5) * 3, 1 + Math.random() * 3, (Math.random() - 0.5) * 3, 2.5 + Math.random() * 2.5, 5 + Math.random() * 10, 0.85, 1.5);
    }
  }

  launchMeteor(x, z, onImpact) {
    const sx = x + 2600, sy = 2400, sz = z - 1400;
    this.meteorState = { sx, sy, sz, x, z, t: 0, T: 3.2, onImpact };
    this.meteor.visible = true;
  }

  shockwave(x, z, maxR) {
    this.shock.position.set(x, 1, z);
    this.shock.visible = true;
    this.shockT = 0; this.shockR = maxR;
  }

  update(dt, light) {
    this.uniforms.uLight.value = light;
    const g = 9.81;
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        if (i !== n) {
          this.pos[i * 3] = this.pos[n * 3]; this.pos[i * 3 + 1] = this.pos[n * 3 + 1]; this.pos[i * 3 + 2] = this.pos[n * 3 + 2];
          this.vel[i * 3] = this.vel[n * 3]; this.vel[i * 3 + 1] = this.vel[n * 3 + 1]; this.vel[i * 3 + 2] = this.vel[n * 3 + 2];
          this.life[i] = this.life[n]; this.maxLife[i] = this.maxLife[n]; this.size[i] = this.size[n]; this.mud[i] = this.mud[n]; this.drag[i] = this.drag[n];
          i--;
        }
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - g * dt * (this.mud[i] > 0.8 && this.drag[i] > 1 ? 0.05 : 1);
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, t * 2.5) * Math.min(1, (1 - t) * 8) * 0.75;
      this.size[i] *= 1 + dt * 0.35;
    }
    this.n = n;
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.aMud.needsUpdate = true;

    const m = this.meteorState;
    if (m) {
      m.t += dt;
      const k = Math.min(1, m.t / m.T);
      const e = k * k;
      const x = m.sx + (m.x - m.sx) * e, y = m.sy * (1 - e), z = m.sz + (m.z - m.sz) * e;
      this.meteor.position.set(x, y, z);
      this.meteor.scale.setScalar(80 + 140 * k);
      for (let i = 0; i < 6; i++) this.emit(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 20, z + (Math.random() - 0.5) * 20, 0, 0, 0, 1.6, 40 + Math.random() * 40, 0.6, 0);
      if (k >= 1) {
        this.meteor.visible = false;
        this.meteorState = null;
        m.onImpact();
      }
    }
    if (this.shockT >= 0) {
      this.shockT += dt;
      const k = this.shockT / 2.5;
      this.shock.scale.setScalar(20 + this.shockR * k);
      this.shock.material.opacity = Math.max(0, 0.8 * (1 - k));
      if (k >= 1) { this.shockT = -1; this.shock.visible = false; }
    }
  }

  clear() { this.n = 0; this.meteorState = null; this.meteor.visible = false; }
}
