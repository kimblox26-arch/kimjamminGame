// FREE FREELY - 파티클 / 사고 임팩트 시스템
// 폭발, 화재, 연기, 불꽃, 파편, 물보라, 물기둥, 충격파, 예광탄, 콘트레일.
import * as THREE from 'three';
import { clamp, lerp, rand, randInt, smoothstep } from '../core/utils.js';
import { fbm2 } from '../core/utils.js';

/* ------------------------------ 텍스처 ------------------------------ */
function softTexture(size = 128, power = 2.2, noise = 0.55) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot((x - half) / half, (y - half) / half);
      let a = Math.pow(clamp(1 - d, 0, 1), power);
      if (noise > 0) {
        const n = fbm2(x * 0.05, y * 0.05, 3) * 0.5 + 0.5;
        a *= lerp(1, n * 1.4, noise);
      }
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const PARTICLE_VERT = /* glsl */`
precision highp float;
attribute float aSize;
attribute float aOpacity;
attribute vec3 aColor;
uniform float uPixelRatio;
uniform float uFogDensity;
uniform vec3 uFogColor;
varying float vOpacity;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = -mv.z;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio * (420.0 / max(1.0, dist));
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
  vColor = mix(aColor, uFogColor, clamp(fog, 0.0, 0.85));
  vOpacity = aOpacity * (1.0 - clamp(fog * 0.6, 0.0, 0.8));
}`;

const PARTICLE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uTex;
varying float vOpacity;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  float a = t.a * vOpacity;
  if (a < 0.005) discard;
  gl_FragColor = vec4(vColor, a);
}`;

class ParticleSystem {
  constructor(scene, max, additive, texture, renderOrder = 10) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.sizeRate = new Float32Array(max);
    this.opacity = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.fade = new Float32Array(max);
    this.colorTo = new Float32Array(max * 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aOpacity', new THREE.BufferAttribute(this.opacity, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geo = geo;

    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: {
        uTex: { value: texture },
        uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) },
        uFogDensity: { value: 0.00007 },
        uFogColor: { value: new THREE.Color(0xbdd6ee) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = renderOrder;
    scene.add(this.points);
  }

  spawn(o) {
    let i;
    if (this.count < this.max) i = this.count++;
    else i = randInt(0, this.max - 1);   // 가장 오래된 것 대체 (근사)
    const i3 = i * 3;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx || 0; this.vel[i3 + 1] = o.vy || 0; this.vel[i3 + 2] = o.vz || 0;
    this.size[i] = this.size0[i] = o.size || 4;
    this.sizeRate[i] = o.sizeRate || 0;
    this.opacity[i] = o.opacity !== undefined ? o.opacity : 1;
    this.fade[i] = o.fade !== undefined ? o.fade : 1;
    const c = o.color || { r: 1, g: 1, b: 1 };
    this.color[i3] = c.r; this.color[i3 + 1] = c.g; this.color[i3 + 2] = c.b;
    const c2 = o.colorTo || c;
    this.colorTo[i3] = c2.r; this.colorTo[i3 + 1] = c2.g; this.colorTo[i3 + 2] = c2.b;
    this.life[i] = this.maxLife[i] = o.life || 1;
    this.drag[i] = o.drag !== undefined ? o.drag : 0.6;
    this.grav[i] = o.gravity !== undefined ? o.gravity : 0;
    return i;
  }

  update(dt, wind, killBelow) {
    const P = this.pos, V = this.vel, L = this.life, M = this.maxLife;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      L[i] -= dt;
      if (L[i] <= 0) {
        // 마지막 입자를 당겨와 압축
        n--;
        this._move(n, i);
        i--;
        continue;
      }
      const i3 = i * 3;
      const d = Math.pow(clamp(1 - this.drag[i], 0.0001, 1), dt);
      V[i3] *= d; V[i3 + 1] *= d; V[i3 + 2] *= d;
      V[i3 + 1] -= this.grav[i] * dt;
      if (wind) {
        V[i3] += (wind.x - V[i3]) * dt * 0.25 * this.drag[i];
        V[i3 + 2] += (wind.z - V[i3 + 2]) * dt * 0.25 * this.drag[i];
      }
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      const t = 1 - L[i] / M[i];
      this.size[i] = this.size0[i] + this.sizeRate[i] * t;
      this.opacity[i] = Math.pow(clamp(L[i] / M[i], 0, 1), this.fade[i]);
      // 색상 전이 (불 → 연기)
      this.color[i3] = lerp(this.color[i3], this.colorTo[i3], dt * 3);
      this.color[i3 + 1] = lerp(this.color[i3 + 1], this.colorTo[i3 + 1], dt * 3);
      this.color[i3 + 2] = lerp(this.color[i3 + 2], this.colorTo[i3 + 2], dt * 3);
      if (killBelow !== undefined && P[i3 + 1] < killBelow) L[i] = Math.min(L[i], 0.15);
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aOpacity.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }

  _move(from, to) {
    const f3 = from * 3, t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[t3 + k] = this.pos[f3 + k];
      this.vel[t3 + k] = this.vel[f3 + k];
      this.color[t3 + k] = this.color[f3 + k];
      this.colorTo[t3 + k] = this.colorTo[f3 + k];
    }
    this.size[to] = this.size[from];
    this.size0[to] = this.size0[from];
    this.sizeRate[to] = this.sizeRate[from];
    this.opacity[to] = this.opacity[from];
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.drag[to] = this.drag[from];
    this.grav[to] = this.grav[from];
    this.fade[to] = this.fade[from];
  }

  setFog(density, color) {
    this.material.uniforms.uFogDensity.value = density;
    if (color) this.material.uniforms.uFogColor.value.copy(color);
  }
}

/* ------------------------------------------------------------------ */
/* 메인 이펙트 매니저                                                   */
/* ------------------------------------------------------------------ */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    const soft = softTexture(128, 1.6, 0.75);
    const glow = softTexture(128, 3.2, 0.0);
    this.smoke = new ParticleSystem(scene, 2600, false, soft, 12);
    this.fire = new ParticleSystem(scene, 1800, true, glow, 14);
    this.water = new ParticleSystem(scene, 1600, false, softTexture(96, 2.0, 0.35), 13);

    // 파편 (강체 박스)
    this.debrisMax = 90;
    this.debrisMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: 0.7, metalness: 0.6 }),
      this.debrisMax
    );
    this.debrisMesh.castShadow = true;
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.count = 0;
    scene.add(this.debrisMesh);
    this.debris = [];
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();

    // 예광탄
    this.tracerMax = 120;
    this.tracerMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.12, 0.12, 5),
      new THREE.MeshBasicMaterial({ color: 0xffdd66, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      this.tracerMax
    );
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.count = 0;
    scene.add(this.tracerMesh);
    this.tracers = [];

    // 충격파 / 물결 링
    this.ringMax = 14;
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.6, 1, 48);
    this.ringPool = [];
    for (let i = 0; i < this.ringMax; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      m.visible = false;
      m.renderOrder = 15;
      scene.add(m);
      this.ringPool.push(m);
    }

    // 폭발 섬광 라이트 풀
    this.flashPool = [];
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xffaa44, 0, 900, 2);
      l.visible = false;
      scene.add(l);
      this.flashPool.push({ light: l, life: 0, peak: 0 });
    }
    this.shake = 0;
  }

  /* ------------------------------ 폭발 ------------------------------ */
  explosion(pos, size = 1, opts = {}) {
    const s = clamp(size, 0.3, 4);
    const n = Math.round(34 * s);
    // 화염 코어
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-0.35, 1), rand(-1, 1)).normalize();
      const sp = rand(6, 34) * s;
      this.fire.spawn({
        x: pos.x + dir.x * s, y: pos.y + dir.y * s, z: pos.z + dir.z * s,
        vx: dir.x * sp, vy: dir.y * sp + 4 * s, vz: dir.z * sp,
        size: rand(9, 26) * s, sizeRate: rand(14, 40) * s,
        color: { r: 1.0, g: rand(0.55, 0.85), b: rand(0.1, 0.3) },
        colorTo: { r: 0.5, g: 0.13, b: 0.03 },
        life: rand(0.4, 1.1) * s, drag: 0.9, gravity: -3, fade: 1.6,
      });
    }
    // 검은 연기
    for (let i = 0; i < n * 0.9; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize();
      this.smoke.spawn({
        x: pos.x + dir.x * s * 2, y: pos.y + dir.y * s * 2, z: pos.z + dir.z * s * 2,
        vx: dir.x * rand(2, 14) * s, vy: rand(3, 14) * s, vz: dir.z * rand(2, 14) * s,
        size: rand(14, 34) * s, sizeRate: rand(40, 110) * s,
        color: { r: 0.16, g: 0.15, b: 0.14 }, colorTo: { r: 0.42, g: 0.42, b: 0.44 },
        life: rand(2.5, 7) * s, drag: 0.55, gravity: -1.4, fade: 1.1, opacity: 0.85,
      });
    }
    // 불티
    for (let i = 0; i < 30 * s; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)).normalize();
      this.fire.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: dir.x * rand(20, 70) * s, vy: dir.y * rand(20, 70) * s, vz: dir.z * rand(20, 70) * s,
        size: rand(1.2, 3.4), sizeRate: -0.6,
        color: { r: 1, g: 0.85, b: 0.5 }, colorTo: { r: 1, g: 0.35, b: 0.1 },
        life: rand(0.5, 1.8), drag: 0.25, gravity: 9, fade: 0.8,
      });
    }
    if (opts.debris !== false) this.spawnDebris(pos, Math.round(6 * s), s);
    this.shockwave(pos, s);
    this.flash(pos, 2200 * s * s, 0.42);
    this.shake = Math.min(1.6, this.shake + 0.5 * s);
  }

  /** 지속 화재 — 매 프레임 호출 */
  fireJet(pos, dir, amount, dt) {
    if (amount <= 0) return;
    const rate = 60 * amount * dt;
    let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      this.fire.spawn({
        x: pos.x + rand(-0.4, 0.4), y: pos.y + rand(-0.3, 0.3), z: pos.z + rand(-0.4, 0.4),
        vx: dir.x * rand(2, 9) + rand(-2, 2), vy: dir.y * rand(2, 9) + rand(1, 5), vz: dir.z * rand(2, 9) + rand(-2, 2),
        size: rand(2.4, 7) * (0.6 + amount), sizeRate: rand(4, 14),
        color: { r: 1, g: rand(0.5, 0.8), b: 0.15 }, colorTo: { r: 0.55, g: 0.12, b: 0.02 },
        life: rand(0.25, 0.7), drag: 0.85, gravity: -6, fade: 1.4,
      });
    }
    if (Math.random() < amount * dt * 26) {
      this.smoke.spawn({
        x: pos.x, y: pos.y + 1, z: pos.z,
        vx: rand(-2, 2), vy: rand(3, 9), vz: rand(-2, 2),
        size: rand(6, 14), sizeRate: rand(20, 50),
        color: { r: 0.12, g: 0.11, b: 0.1 }, colorTo: { r: 0.35, g: 0.35, b: 0.36 },
        life: rand(2, 5), drag: 0.5, gravity: -1.2, opacity: 0.8, fade: 1.2,
      });
    }
  }

  /** 엔진 배기 (제트/로켓 화염 + 프롭 후류) */
  exhaust(pos, dir, power, type, dt, speed = 0) {
    if (power <= 0.02) return;
    const rate = (type === 'rocket' ? 150 : type === 'jet' ? 55 : 16) * power * dt;
    let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      if (type === 'rocket') {
        this.fire.spawn({
          x: pos.x + rand(-0.3, 0.3), y: pos.y + rand(-0.3, 0.3), z: pos.z + rand(-0.3, 0.3),
          vx: dir.x * rand(40, 110) * power, vy: dir.y * rand(40, 110) * power, vz: dir.z * rand(40, 110) * power,
          size: rand(3, 9), sizeRate: rand(20, 46),
          color: { r: 1, g: 0.92, b: 0.75 }, colorTo: { r: 1, g: 0.42, b: 0.12 },
          life: rand(0.2, 0.7), drag: 0.8, gravity: 0, fade: 1.3,
        });
      } else if (type === 'jet') {
        this.fire.spawn({
          x: pos.x, y: pos.y, z: pos.z,
          vx: dir.x * rand(25, 70) * power, vy: dir.y * rand(25, 70) * power, vz: dir.z * rand(25, 70) * power,
          size: rand(1.4, 3.6), sizeRate: rand(6, 18),
          color: { r: 0.75, g: 0.55, b: 1.0 }, colorTo: { r: 0.35, g: 0.15, b: 0.45 },
          life: rand(0.12, 0.34), drag: 0.9, fade: 1.6, opacity: 0.85,
        });
      } else {
        this.smoke.spawn({
          x: pos.x, y: pos.y, z: pos.z,
          vx: dir.x * rand(4, 12) * power, vy: dir.y * rand(4, 12) * power + 1, vz: dir.z * rand(4, 12) * power,
          size: rand(1.2, 3), sizeRate: rand(6, 16),
          color: { r: 0.5, g: 0.5, b: 0.52 }, colorTo: { r: 0.7, g: 0.7, b: 0.72 },
          life: rand(0.3, 0.9), drag: 0.7, opacity: 0.16, fade: 1.4,
        });
      }
    }
    void speed;
  }

  /** 고고도 비행운 */
  contrail(pos, dir, amount, dt) {
    if (Math.random() > amount * dt * 30) return;
    this.smoke.spawn({
      x: pos.x, y: pos.y, z: pos.z,
      vx: dir.x * 4, vy: dir.y * 4, vz: dir.z * 4,
      size: rand(4, 8), sizeRate: rand(30, 70),
      color: { r: 0.95, g: 0.97, b: 1 }, colorTo: { r: 0.9, g: 0.93, b: 0.97 },
      life: rand(6, 16), drag: 0.2, opacity: 0.5, fade: 1.6,
    });
  }

  /** 날개 끝 와류 (고AoA·고G) */
  vortex(pos, dir, amount) {
    if (Math.random() > amount * 0.5) return;
    this.smoke.spawn({
      x: pos.x, y: pos.y, z: pos.z,
      vx: dir.x * 2, vy: dir.y * 2, vz: dir.z * 2,
      size: rand(1.5, 3.5), sizeRate: rand(6, 16),
      color: { r: 1, g: 1, b: 1 }, colorTo: { r: 0.95, g: 0.97, b: 1 },
      life: rand(0.35, 1.1), drag: 0.4, opacity: 0.42, fade: 1.5,
    });
  }

  /* ------------------------------ 충돌/지면 ------------------------------ */
  sparks(pos, normal, count = 14, energy = 1) {
    for (let i = 0; i < count; i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().add(normal).normalize();
      this.fire.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: d.x * rand(8, 40) * energy, vy: d.y * rand(8, 40) * energy, vz: d.z * rand(8, 40) * energy,
        size: rand(0.8, 2.2), sizeRate: -0.4,
        color: { r: 1, g: 0.92, b: 0.65 }, colorTo: { r: 1, g: 0.4, b: 0.08 },
        life: rand(0.25, 0.9), drag: 0.2, gravity: 12, fade: 0.7,
      });
    }
  }

  dust(pos, amount, color = { r: 0.62, g: 0.56, b: 0.45 }) {
    const n = Math.round(amount * 6);
    for (let i = 0; i < n; i++) {
      this.smoke.spawn({
        x: pos.x + rand(-1.5, 1.5), y: pos.y + rand(0, 0.6), z: pos.z + rand(-1.5, 1.5),
        vx: rand(-6, 6) * amount, vy: rand(0.5, 4) * amount, vz: rand(-6, 6) * amount,
        size: rand(3, 9), sizeRate: rand(10, 30),
        color, colorTo: { r: color.r * 1.2, g: color.g * 1.2, b: color.b * 1.2 },
        life: rand(0.7, 2.2), drag: 0.6, gravity: 0.6, opacity: 0.45, fade: 1.3,
      });
    }
  }

  /* ------------------------------- 물 ------------------------------- */
  /** 착수 임팩트 — 물기둥 + 링 + 물방울 + 안개 */
  waterImpact(pos, speed = 20, size = 1) {
    const s = clamp(size * (0.4 + speed / 45), 0.4, 5);
    // 중앙 물기둥
    for (let i = 0; i < 26 * s; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.5) * 3 * s;
      this.water.spawn({
        x: pos.x + Math.cos(a) * r, y: pos.y + rand(0, 1), z: pos.z + Math.sin(a) * r,
        vx: Math.cos(a) * rand(1, 8) * s, vy: rand(10, 30) * s, vz: Math.sin(a) * rand(1, 8) * s,
        size: rand(5, 16) * s, sizeRate: rand(8, 26) * s,
        color: { r: 0.85, g: 0.94, b: 0.98 }, colorTo: { r: 0.75, g: 0.85, b: 0.92 },
        life: rand(0.8, 2.4), drag: 0.35, gravity: 9.4, opacity: 0.92, fade: 1.2,
      });
    }
    // 방사형 물보라
    for (let i = 0; i < 40 * s; i++) {
      const a = Math.random() * Math.PI * 2;
      this.water.spawn({
        x: pos.x, y: pos.y + 0.4, z: pos.z,
        vx: Math.cos(a) * rand(8, 34) * s, vy: rand(2, 12) * s, vz: Math.sin(a) * rand(8, 34) * s,
        size: rand(2, 7) * s, sizeRate: rand(4, 14),
        color: { r: 0.92, g: 0.97, b: 1 }, colorTo: { r: 0.8, g: 0.88, b: 0.94 },
        life: rand(0.5, 1.6), drag: 0.5, gravity: 9.4, opacity: 0.8, fade: 1.1,
      });
    }
    // 물안개
    for (let i = 0; i < 14 * s; i++) {
      this.smoke.spawn({
        x: pos.x + rand(-4, 4) * s, y: pos.y + rand(0, 3), z: pos.z + rand(-4, 4) * s,
        vx: rand(-3, 3), vy: rand(1, 4), vz: rand(-3, 3),
        size: rand(8, 20) * s, sizeRate: rand(20, 50),
        color: { r: 0.9, g: 0.94, b: 0.97 }, colorTo: { r: 0.85, g: 0.9, b: 0.95 },
        life: rand(1.5, 4), drag: 0.5, gravity: -0.4, opacity: 0.5, fade: 1.4,
      });
    }
    this.waterRing(pos, s);
    this.shake = Math.min(1.2, this.shake + 0.2 * s);
  }

  /** 수면 활주 물보라 (지속) */
  waterSpray(pos, vel, amount, dt) {
    const rate = 90 * amount * dt;
    let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      this.water.spawn({
        x: pos.x + rand(-0.8, 0.8), y: pos.y + rand(-0.2, 0.5), z: pos.z + rand(-0.8, 0.8),
        vx: -vel.x * rand(0.05, 0.3) + rand(-5, 5), vy: rand(2, 11) * amount, vz: -vel.z * rand(0.05, 0.3) + rand(-5, 5),
        size: rand(1.4, 5), sizeRate: rand(4, 13),
        color: { r: 0.93, g: 0.97, b: 1 }, colorTo: { r: 0.82, g: 0.9, b: 0.95 },
        life: rand(0.4, 1.3), drag: 0.5, gravity: 9.4, opacity: 0.75, fade: 1.2,
      });
    }
  }

  /** 수중 기포 */
  bubbles(pos, amount, dt) {
    if (Math.random() > amount * dt * 30) return;
    this.water.spawn({
      x: pos.x + rand(-1.5, 1.5), y: pos.y + rand(-1, 1), z: pos.z + rand(-1.5, 1.5),
      vx: rand(-1, 1), vy: rand(2, 6), vz: rand(-1, 1),
      size: rand(1, 4), sizeRate: rand(1, 4),
      color: { r: 0.8, g: 0.92, b: 1 }, colorTo: { r: 0.7, g: 0.85, b: 0.95 },
      life: rand(1, 3), drag: 0.4, gravity: -2.5, opacity: 0.6, fade: 1.1,
    });
  }

  waterRing(pos, size) {
    const m = this.ringPool.find((r) => !r.visible);
    if (!m) return;
    m.visible = true;
    m.position.set(pos.x, 0.6, pos.z);
    m.rotation.set(-Math.PI / 2, 0, 0);
    m.scale.setScalar(3 * size);
    m.material.color.setRGB(0.8, 0.92, 1);
    m.material.blending = THREE.NormalBlending;
    m.material.opacity = 0.75;
    this.rings.push({ mesh: m, life: 2.4 * size, maxLife: 2.4 * size, grow: 26 * size, kind: 'water' });
  }

  shockwave(pos, size) {
    const m = this.ringPool.find((r) => !r.visible);
    if (!m) return;
    m.visible = true;
    m.position.copy(pos);
    m.rotation.set(-Math.PI / 2, 0, 0);
    m.scale.setScalar(2 * size);
    m.material.color.setRGB(1, 0.85, 0.6);
    m.material.blending = THREE.AdditiveBlending;
    m.material.opacity = 0.9;
    this.rings.push({ mesh: m, life: 0.55 * size, maxLife: 0.55 * size, grow: 160 * size, kind: 'blast', billboard: true });
  }

  /* ------------------------------ 파편 ------------------------------ */
  spawnDebris(pos, count = 6, scale = 1) {
    for (let i = 0; i < count; i++) {
      if (this.debris.length >= this.debrisMax) break;
      this.debris.push({
        pos: pos.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1))),
        vel: new THREE.Vector3(rand(-18, 18), rand(4, 26), rand(-18, 18)).multiplyScalar(scale),
        spin: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)),
        rot: new THREE.Euler(rand(0, 3), rand(0, 3), rand(0, 3)),
        size: new THREE.Vector3(rand(0.3, 1.4), rand(0.2, 0.9), rand(0.4, 2.2)).multiplyScalar(scale),
        life: rand(6, 14), burning: Math.random() < 0.5,
      });
    }
  }

  addTracer(pos, vel, life = 2.2) {
    if (this.tracers.length >= this.tracerMax) this.tracers.shift();
    this.tracers.push({ pos: pos.clone(), vel: vel.clone(), life, maxLife: life });
  }

  flash(pos, intensity, duration = 0.3) {
    const f = this.flashPool.find((x) => x.life <= 0) || this.flashPool[0];
    f.light.position.copy(pos);
    f.light.intensity = intensity;
    f.light.visible = true;
    f.life = duration;
    f.peak = intensity;
    f.duration = duration;
  }

  /* ------------------------------- 갱신 ------------------------------- */
  update(dt, camera, world) {
    const wind = world ? world.env.wind : null;
    this.smoke.update(dt, wind);
    this.fire.update(dt, wind);
    this.water.update(dt, wind);

    // 파편 물리
    let k = 0;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.vel.y -= 9.81 * dt;
      d.vel.multiplyScalar(Math.pow(0.75, dt));
      d.pos.addScaledVector(d.vel, dt);
      d.rot.x += d.spin.x * dt; d.rot.y += d.spin.y * dt; d.rot.z += d.spin.z * dt;
      if (world) {
        const s = world.surfaceAt(d.pos.x, d.pos.z);
        if (d.pos.y < s.height + 0.2) {
          if (s.type === 'water') {
            this.waterImpact(new THREE.Vector3(d.pos.x, s.height, d.pos.z), d.vel.length() * 0.3, 0.35);
            d.life = 0;
          } else {
            d.pos.y = s.height + 0.2;
            d.vel.y = Math.abs(d.vel.y) * 0.28;
            d.vel.x *= 0.55; d.vel.z *= 0.55;
            d.spin.multiplyScalar(0.6);
            if (d.vel.length() < 1.4) { d.vel.set(0, 0, 0); d.spin.multiplyScalar(0.2); }
            if (Math.random() < 0.3) this.dust(d.pos, 0.3);
          }
        }
      }
      if (d.burning && Math.random() < dt * 12) {
        this.fire.spawn({
          x: d.pos.x, y: d.pos.y, z: d.pos.z,
          vx: rand(-1, 1), vy: rand(1, 3), vz: rand(-1, 1),
          size: rand(1, 3), sizeRate: 3,
          color: { r: 1, g: 0.6, b: 0.2 }, colorTo: { r: 0.4, g: 0.1, b: 0.02 },
          life: rand(0.2, 0.6), drag: 0.8, gravity: -3,
        });
        this.smoke.spawn({
          x: d.pos.x, y: d.pos.y, z: d.pos.z,
          vx: rand(-1, 1), vy: rand(2, 5), vz: rand(-1, 1),
          size: rand(2, 5), sizeRate: 9,
          color: { r: 0.2, g: 0.19, b: 0.18 }, colorTo: { r: 0.45, g: 0.45, b: 0.46 },
          life: rand(1, 2.6), drag: 0.5, opacity: 0.6,
        });
      }
      if (d.life <= 0) { this.debris.splice(i, 1); continue; }
      this._q.setFromEuler(d.rot);
      this._m4.compose(d.pos, this._q, d.size);
      this.debrisMesh.setMatrixAt(k++, this._m4);
    }
    this.debrisMesh.count = k;
    this.debrisMesh.instanceMatrix.needsUpdate = true;

    // 예광탄
    let t = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      tr.vel.y -= 9.81 * dt * 0.35;
      tr.pos.addScaledVector(tr.vel, dt);
      if (world) {
        const s = world.surfaceAt(tr.pos.x, tr.pos.z);
        if (tr.pos.y < s.height) {
          if (s.type === 'water') this.waterImpact(new THREE.Vector3(tr.pos.x, s.height, tr.pos.z), 8, 0.2);
          else { this.sparks(tr.pos, new THREE.Vector3(0, 1, 0), 6, 0.6); this.dust(tr.pos, 0.4); }
          tr.life = 0;
        }
      }
      if (tr.life <= 0) { this.tracers.splice(i, 1); continue; }
      const dir = this._v.copy(tr.vel).normalize();
      this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      const len = clamp(tr.vel.length() * 0.02, 1, 6);
      this._m4.compose(tr.pos, this._q, new THREE.Vector3(1, 1, len));
      this.tracerMesh.setMatrixAt(t++, this._m4);
    }
    this.tracerMesh.count = t;
    this.tracerMesh.instanceMatrix.needsUpdate = true;

    // 링/충격파
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const p = 1 - r.life / r.maxLife;
      r.mesh.scale.setScalar(r.mesh.scale.x + r.grow * dt);
      r.mesh.material.opacity = (1 - p) * (r.kind === 'blast' ? 0.9 : 0.6);
      if (r.billboard && camera) r.mesh.quaternion.copy(camera.quaternion);
      if (r.life <= 0) { r.mesh.visible = false; this.rings.splice(i, 1); }
    }

    // 섬광
    for (const f of this.flashPool) {
      if (f.life > 0) {
        f.life -= dt;
        f.light.intensity = f.peak * Math.pow(clamp(f.life / (f.duration || 0.3), 0, 1), 2);
        if (f.life <= 0) { f.light.visible = false; f.light.intensity = 0; }
      }
    }

    this.shake = Math.max(0, this.shake - dt * 1.5);

    if (world && world.scene.fog) {
      const d = world.scene.fog.density;
      const c = world.scene.fog.color;
      this.smoke.setFog(d * 0.8, c);
      this.fire.setFog(d * 0.5, c);
      this.water.setFog(d * 0.8, c);
    }
  }

  clear() {
    this.smoke.count = 0; this.fire.count = 0; this.water.count = 0;
    this.debris.length = 0; this.tracers.length = 0;
    for (const r of this.rings) r.mesh.visible = false;
    this.rings.length = 0;
    this.shake = 0;
  }
}

void smoothstep;
