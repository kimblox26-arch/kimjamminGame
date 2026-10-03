// SKYBREAKER — 전투기 전용 시각 효과
// 날개끝 베이퍼 리본, 베이퍼 콘, 대형 폭발 연출, 지속 화재, 화면 임팩트 셰이더(속도선/색수차/블랙아웃).
import * as THREE from 'three';
import { glowTexture } from './jet.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------------------------------------------------ */
/* 리본 트레일 (날개끝 와류 · 미사일 궤적 보조)                           */
/* ------------------------------------------------------------------ */
const RIBBON_VERT = /* glsl */`
attribute float aAlpha; attribute float aEdge;
varying float vA; varying float vE;
void main(){ vA = aAlpha; vE = aEdge; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RIBBON_FRAG = /* glsl */`
uniform vec3 uColor; varying float vA; varying float vE;
void main(){ float e = 1.0 - vE * vE; float a = vA * e; if (a < 0.003) discard; gl_FragColor = vec4(uColor, a); }`;

export class Ribbon {
  constructor(scene, opts = {}) {
    this.max = opts.max || 90;
    this.width = opts.width || 0.5;
    this.life = opts.life || 1.3;
    this.spread = opts.spread || 2.5;
    this.pts = [];
    const n = this.max;
    this.posArr = new Float32Array(n * 2 * 3);
    this.alphaArr = new Float32Array(n * 2);
    const edge = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { edge[i * 2] = -1; edge[i * 2 + 1] = 1; }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaArr, 1));
    g.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG,
      uniforms: { uColor: { value: new THREE.Color(opts.color || 0xffffff) } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    scene.add(this.mesh);
  }

  push(pos, side, intensity) {
    this.pts.unshift({ p: pos.clone(), s: side.clone(), a: intensity, age: 0 });
    if (this.pts.length > this.max) this.pts.length = this.max;
  }

  update(dt) {
    const P = this.posArr, A = this.alphaArr;
    let n = 0;
    for (let i = 0; i < this.pts.length; i++) {
      const q = this.pts[i];
      q.age += dt;
      const k = q.age / this.life;
      if (k >= 1) { this.pts.length = i; break; }
      const w = this.width * (1 + k * this.spread);
      const i6 = n * 6;
      P[i6] = q.p.x - q.s.x * w; P[i6 + 1] = q.p.y - q.s.y * w; P[i6 + 2] = q.p.z - q.s.z * w;
      P[i6 + 3] = q.p.x + q.s.x * w; P[i6 + 4] = q.p.y + q.s.y * w; P[i6 + 5] = q.p.z + q.s.z * w;
      const a = q.a * (1 - k) * (1 - k);
      A[n * 2] = a; A[n * 2 + 1] = a;
      n++;
    }
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  clear() { this.pts.length = 0; this.geo.setDrawRange(0, 0); }
  dispose() { this.mesh.parent && this.mesh.parent.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); }
}

/* ------------------------------------------------------------------ */
/* 베이퍼 콘 (천음속 응결운)                                             */
/* ------------------------------------------------------------------ */
const CONE_FRAG = /* glsl */`
uniform float uAmount, uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
float h(float x){ return fract(sin(x * 127.1) * 43758.5); }
void main(){
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rings = 0.55 + 0.45 * sin(vUv.y * 40.0 + uTime * 30.0 + h(floor(vUv.x * 40.0)) * 6.0);
  float streak = 0.6 + 0.4 * h(floor(vUv.x * 64.0) + floor(uTime * 20.0));
  float fade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
  float a = uAmount * pow(f, 0.7) * rings * streak * fade * 0.55;
  gl_FragColor = vec4(vec3(1.0), a);
}`;
const CONE_VERT = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;

export class VaporCone {
  constructor(jet) {
    const g = new THREE.CylinderGeometry(0.35, 1, 1, 40, 8, true);
    g.translate(0, 0.5, 0);
    g.rotateX(-Math.PI / 2);
    this.uniforms = { uAmount: { value: 0 }, uTime: { value: 0 } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    const L = jet.L;
    this.mesh.position.set(0, 0.2, L * 0.2);
    this.mesh.scale.set(L * 0.42, L * 0.3, L * 0.55);
    this.mesh.renderOrder = 12;
    this.mesh.visible = false;
    jet.root.add(this.mesh);
  }
  set(amount, t) {
    this.uniforms.uAmount.value = amount;
    this.uniforms.uTime.value = t;
    this.mesh.visible = amount > 0.01;
  }
}

/* ------------------------------------------------------------------ */
/* 폭발 연출 확장                                                       */
/* ------------------------------------------------------------------ */
export class FxPlus {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.timeline = [];
    this.fires = [];          // 지속 화재 (지상 목표 등)
    this.glows = [];
    const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(mat.clone());
      s.visible = false;
      s.renderOrder = 16;
      scene.add(s);
      this.glows.push({ s, life: 0, max: 1, size: 1 });
    }
  }

  /** 섬광 구체 (블룸으로 번쩍) */
  glow(pos, size, life = 0.35, color = 0xffc080) {
    const g = this.glows.find((x) => x.life <= 0) || this.glows[0];
    g.s.position.copy(pos);
    g.s.visible = true;
    g.s.material.color.set(color).multiplyScalar(2.4);
    g.life = g.max = life;
    g.size = size;
  }

  /** 공중 격추 대폭발: 섬광 → 화구 → 2차 폭발 → 잔해 */
  airKill(pos, vel, scale = 1) {
    const fx = this.fx;
    const p = pos.clone();
    this.glow(p, 38 * scale, 0.3, 0xffb070);
    fx.explosion(p, 1.3 * scale);
    // 운동량을 따라 흩어지는 화염
    for (let i = 0; i < 26 * scale; i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      const sp = rand(20, 70);
      fx.fire.spawn({
        x: p.x, y: p.y, z: p.z,
        vx: vel.x * 0.5 + d.x * sp, vy: vel.y * 0.5 + d.y * sp, vz: vel.z * 0.5 + d.z * sp,
        size: rand(6, 14) * scale, sizeRate: rand(14, 34),
        color: { r: 1, g: rand(0.45, 0.7), b: 0.15 }, colorTo: { r: 0.5, g: 0.1, b: 0.02 },
        life: rand(0.5, 1.2), drag: 0.7, gravity: -2, fade: 1.4,
      });
    }
    fx.sparks(p, new THREE.Vector3(0, 1, 0), 60, 2.6);
    fx.spawnDebris(p, 10, 1.1 * scale);
    for (let k = 0; k < 3; k++) {
      this.timeline.push({ t: 0.12 + k * rand(0.12, 0.22), fn: () => {
        const q = p.clone().addScaledVector(vel, 0.15 * (k + 1)).add(new THREE.Vector3(rand(-6, 6), rand(-4, 6), rand(-6, 6)));
        fx.explosion(q, rand(0.55, 0.85) * scale, { debris: false });
        this.glow(q, 20, 0.2);
      } });
    }
  }

  /** 지상 목표 폭발 (연료탱크면 거대 화염 기둥) */
  groundBlast(pos, big = false) {
    const fx = this.fx;
    const s = big ? 2.4 : 1.4;
    this.glow(pos.clone().add(new THREE.Vector3(0, 8, 0)), big ? 110 : 60, big ? 0.55 : 0.4, 0xffb070);
    fx.explosion(pos, s);
    for (let i = 0; i < (big ? 90 : 40); i++) {
      const a = Math.random() * Math.PI * 2, r = rand(0, 1);
      fx.fire.spawn({
        x: pos.x + Math.cos(a) * r * 6, y: pos.y + 2, z: pos.z + Math.sin(a) * r * 6,
        vx: Math.cos(a) * rand(4, 16), vy: rand(25, big ? 90 : 50), vz: Math.sin(a) * rand(4, 16),
        size: rand(14, 34) * (big ? 1.4 : 1), sizeRate: rand(30, 70),
        color: { r: 1, g: rand(0.65, 0.9), b: 0.35 }, colorTo: { r: 0.45, g: 0.1, b: 0.02 },
        life: rand(0.9, 2.2), drag: 0.6, gravity: -4, fade: 1.3,
      });
    }
    fx.dust(pos, big ? 6 : 3);
    this.fires.push({ pos: pos.clone(), life: big ? 40 : 22, amount: big ? 1.6 : 0.9 });
    if (big) {
      for (let k = 0; k < 4; k++) {
        this.timeline.push({ t: 0.25 + k * rand(0.2, 0.45), fn: () => {
          const q = pos.clone().add(new THREE.Vector3(rand(-14, 14), rand(4, 26), rand(-14, 14)));
          fx.explosion(q, rand(1.2, 2.0), { debris: false });
          this.glow(q, 40, 0.3);
        } });
      }
    }
  }

  /** 미사일 화염 + 연기 궤적 (매 프레임) */
  missileTrail(pos, dir, dt, motor) {
    const fx = this.fx;
    if (motor) {
      const n = Math.max(1, Math.round(dt * 160));
      for (let i = 0; i < n; i++) {
        const k = i / n;
        fx.smoke.spawn({
          x: pos.x - dir.x * k * 6, y: pos.y - dir.y * k * 6, z: pos.z - dir.z * k * 6,
          vx: rand(-1, 1), vy: rand(-0.5, 1), vz: rand(-1, 1),
          size: rand(2.2, 3.4), sizeRate: rand(10, 22),
          color: { r: 0.92, g: 0.92, b: 0.93 }, colorTo: { r: 0.78, g: 0.79, b: 0.82 },
          life: rand(2.2, 4.2), drag: 0.5, opacity: 0.55, fade: 1.4,
        });
      }
      fx.fire.spawn({
        x: pos.x - dir.x * 1.6, y: pos.y - dir.y * 1.6, z: pos.z - dir.z * 1.6,
        vx: -dir.x * 30, vy: -dir.y * 30, vz: -dir.z * 30,
        size: rand(3, 5), sizeRate: 6, color: { r: 1, g: 0.9, b: 0.6 }, colorTo: { r: 1, g: 0.4, b: 0.1 },
        life: 0.09, drag: 0.5, fade: 1.2,
      });
    }
  }

  /** 플레어 섬광 입자 */
  flareSpark(pos) {
    this.fx.fire.spawn({
      x: pos.x, y: pos.y, z: pos.z, vx: rand(-2, 2), vy: rand(-2, 1), vz: rand(-2, 2),
      size: rand(5, 8), sizeRate: -2, color: { r: 1, g: 0.95, b: 0.8 }, colorTo: { r: 1, g: 0.6, b: 0.25 },
      life: 0.25, drag: 0.4, fade: 1,
    });
    if (Math.random() < 0.6) this.fx.smoke.spawn({
      x: pos.x, y: pos.y, z: pos.z, vx: 0, vy: 1, vz: 0, size: 2.4, sizeRate: 9,
      color: { r: 0.9, g: 0.9, b: 0.9 }, colorTo: { r: 0.8, g: 0.8, b: 0.82 }, life: rand(1.5, 2.6), drag: 0.6, opacity: 0.45,
    });
  }

  /** 피격 기체 화재 연기 (매 프레임) */
  burning(pos, vel, amount, dt) {
    const fx = this.fx;
    fx.fireJet(pos, vel.clone().multiplyScalar(-0.02), amount, dt);
    if (Math.random() < dt * 40 * amount) {
      fx.smoke.spawn({
        x: pos.x, y: pos.y, z: pos.z, vx: rand(-2, 2), vy: rand(-1, 2), vz: rand(-2, 2),
        size: rand(4, 7), sizeRate: rand(20, 45), color: { r: 0.1, g: 0.09, b: 0.09 }, colorTo: { r: 0.32, g: 0.32, b: 0.33 },
        life: rand(2.5, 5), drag: 0.4, opacity: 0.85, fade: 1.2,
      });
    }
  }

  update(dt, camera) {
    for (let i = this.timeline.length - 1; i >= 0; i--) {
      const e = this.timeline[i];
      e.t -= dt;
      if (e.t <= 0) { this.timeline.splice(i, 1); e.fn(); }
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.life -= dt;
      const a = f.amount * clamp(f.life / 10, 0.2, 1);
      this.fx.fireJet(f.pos, new THREE.Vector3(0, 1, 0), a, dt);
      if (Math.random() < dt * 14 * a) {
        this.fx.smoke.spawn({
          x: f.pos.x + rand(-3, 3), y: f.pos.y + 4, z: f.pos.z + rand(-3, 3),
          vx: rand(-2, 2), vy: rand(8, 16), vz: rand(-2, 2), size: rand(10, 18), sizeRate: rand(60, 120),
          color: { r: 0.08, g: 0.08, b: 0.08 }, colorTo: { r: 0.3, g: 0.3, b: 0.31 },
          life: rand(6, 12), drag: 0.3, gravity: -0.8, opacity: 0.8, fade: 1.1,
        });
      }
      if (f.life <= 0) this.fires.splice(i, 1);
    }
    for (const g of this.glows) {
      if (g.life > 0) {
        g.life -= dt;
        const k = clamp(g.life / g.max, 0, 1);
        g.s.scale.setScalar(g.size * (1.4 - k * 0.4));
        g.s.material.opacity = k * k;
        if (g.life <= 0) g.s.visible = false;
      }
    }
    void camera;
  }

  clear() {
    this.timeline.length = 0;
    this.fires.length = 0;
    for (const g of this.glows) { g.life = 0; g.s.visible = false; }
  }
}

/* ------------------------------------------------------------------ */
/* 화면 임팩트 후처리                                                    */
/* ------------------------------------------------------------------ */
export const ImpactShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0 },
    uRadial: { value: 0 },
    uSpeedLines: { value: 0 },
    uFlash: { value: 0 },
    uRed: { value: 0 },
    uBlack: { value: 0 },
    uVignette: { value: 0.35 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberration, uRadial, uSpeedLines, uFlash, uRed, uBlack, uVignette, uAspect;
    varying vec2 vUv;
    float hash(float n){ return fract(sin(n) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r = length(c * vec2(uAspect, 1.0));
      vec3 col;
      if (uRadial > 0.002 || uAberration > 0.002) {
        vec2 dir = c * (0.045 * uRadial * smoothstep(0.08, 0.7, r));
        vec2 ab = c * 0.012 * uAberration * r;
        col = vec3(0.0);
        for (int i = 0; i < 6; i++) {
          vec2 o = dir * float(i) / 6.0;
          col.r += texture2D(tDiffuse, vUv - o + ab).r;
          col.g += texture2D(tDiffuse, vUv - o).g;
          col.b += texture2D(tDiffuse, vUv - o - ab).b;
        }
        col /= 6.0;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }
      // 속도선
      if (uSpeedLines > 0.01) {
        float ang = atan(c.y, c.x);
        float id = floor(ang * 70.0);
        float rnd = hash(id);
        float seg = fract(r * 2.2 - uTime * (2.5 + rnd * 3.0) + rnd * 7.0);
        float line = step(0.82, rnd) * smoothstep(0.0, 0.15, seg) * smoothstep(0.55, 0.3, seg);
        float w = 1.0 - smoothstep(0.0, 0.35, abs(fract(ang * 70.0) - 0.5));
        col += vec3(0.85, 0.92, 1.0) * line * w * uSpeedLines * smoothstep(0.25, 0.75, r) * 0.55;
      }
      // 비네트 / G-블랙아웃 / 레드아웃
      col *= 1.0 - uVignette * smoothstep(0.35, 0.95, r);
      float bl = uBlack;
      col *= mix(1.0, 1.0 - smoothstep(0.62 - bl * 0.62, 0.95 - bl * 0.5, r), clamp(bl * 1.4, 0.0, 1.0));
      col *= 1.0 - smoothstep(0.75, 1.0, bl) * 0.9;
      col = mix(col, col * vec3(1.4, 0.25, 0.2) + vec3(0.12, 0.0, 0.0), uRed * smoothstep(0.15, 0.9, r + uRed * 0.3));
      col += vec3(1.0, 0.96, 0.9) * uFlash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
