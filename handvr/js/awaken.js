// 각성 효과: 빛 구 · 빛 구슬 · 솟는 반짝이 · 바닥 빛 · 빛 돔 · 충격파 · 바닥 금·깨진 바닥판 · 바닥 조각 · 먼지 · 빠르게 날 때 빛줄기
import * as THREE from 'three';

// 단계 (영상처럼): 1 하늘빛 · 2 보랏빛 · 3 분홍빛 · 4 금빛
export const LEVELS = [
  { name: '각성 전', css: '#ffffff', color: new THREE.Color(1, 1, 1), scale: 0.8 },
  { name: '1단계 · 하늘빛', css: '#5fe3ff', color: new THREE.Color(0.3, 0.95, 1.0), scale: 0.85 },
  { name: '2단계 · 보랏빛', css: '#a07bff', color: new THREE.Color(0.6, 0.42, 1.0), scale: 1.0 },
  { name: '3단계 · 분홍빛', css: '#ff74cf', color: new THREE.Color(1.0, 0.42, 0.82), scale: 1.15 },
  { name: '4단계 · 금빛', css: '#ffd668', color: new THREE.Color(1.0, 0.8, 0.36), scale: 1.3 },
];

const NOISE = /* glsl */`
float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
`;
const OUT = /* glsl */`
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;
// 미리 곱한 알파 섞기: rgb 는 더하고(빛), alpha 만큼 뒤를 가린다(색) → 하얀 바닥 위에서도 파랑·노랑·빨강이 보인다
const PREMUL = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor };
const addMat = (o) => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, ...PREMUL, ...o });
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.random() * (b - a);

const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const WHITE = new THREE.Color(1, 1, 1);

// 둥근 빛 텍스처 (빛 구슬·가운데 빛·빛줄기 머리)
let _glow;
function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.22, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  _glow = new THREE.CanvasTexture(c); _glow.colorSpace = THREE.SRGBColorSpace;
  return _glow;
}
const glowSprite = (o = {}) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...o }));
  s.frustumCulled = false;
  return s;
};
const SPHERE_VS = `varying vec3 vN, vV, vL; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); vL = normalize(position); gl_Position = projectionMatrix * viewMatrix * wp; }`;

// ───────── 기운 (영상처럼): 몸을 감싸는 빛 구 + 가로 빛줄기 + 둘레를 도는 빛 구슬 + 위로 솟는 반짝이 + 바닥 빛 ─────────
const ORB_R = 1.25, ORB_Y = 1.0;
class Aura {
  constructor(local, flat) {
    this.u = { uTime: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) }, uAlpha: { value: 0 }, uActive: { value: 0 },
      uGround: { value: 0 }, uScale: { value: 1 } };
    // 빛 구
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(ORB_R, 64, 32), addMat({
      uniforms: this.u, vertexShader: SPHERE_VS,
      fragmentShader: NOISE + `uniform vec3 uColor; uniform float uTime, uAlpha; varying vec3 vN, vV, vL;
        void main(){
          float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          float rim = pow(f, 2.2);
          float sx = noise(vec3(vL.y * 13.0, (vL.x + vL.z) * 0.7 - uTime * 1.8, uTime * 0.25)); // 가로로 긴 빛줄기
          float streak = smoothstep(0.6, 0.92, sx) * (1.0 - abs(vL.y) * 0.8);
          float sw = fbm(vL * 2.5 + vec3(0.0, -uTime * 0.7, uTime * 0.2));
          float a = (0.16 + rim * 1.05 + streak * 0.75 + sw * 0.18) * uAlpha;
          vec3 col = mix(uColor, vec3(1.0), clamp(rim * 0.2 + streak * 0.7, 0.0, 1.0));
          gl_FragColor = vec4(col * a * 1.05, min(a * 0.72, 0.92));` + OUT + `
        }`,
    }));
    this.ball.position.y = ORB_Y; this.ball.frustumCulled = false;
    local.add(this.ball);
    // 가운데 밝은 빛 (캐릭터가 빛 속에 있는 것처럼)
    this.core = glowSprite({ depthTest: false });
    this.core.position.y = ORB_Y; this.core.renderOrder = 5;
    local.add(this.core);
    // 반짝이: 위로 솟는 것(0) + 구 둘레를 도는 빛 구슬(1) — 움직임은 GPU 에서
    const NS = 150, NO = 7, N = NS + NO;
    const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
    g.index = quad.index; g.attributes.position = quad.attributes.position; g.attributes.uv = quad.attributes.uv;
    const seed = new Float32Array(N * 4), kind = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      seed.set([Math.random() * Math.PI * 2, Math.random(), Math.random(), Math.random()], i * 4);
      kind.set(i < NS ? [0, Math.random()] : [1, (i - NS) / NO * 0.9], i * 2);
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 2));
    g.instanceCount = N;
    this.motes = new THREE.Mesh(g, addMat({
      uniforms: this.u,
      vertexShader: `attribute vec4 aSeed; attribute vec2 aKind; uniform float uTime, uActive, uScale, uAlpha;
        varying vec2 vUv; varying float vA, vK;
        void main(){
          vec3 c; float size, a;
          if (aKind.x < 0.5) {
            float life = 1.1 + aSeed.z * 1.4, age = fract(uTime / life + aSeed.y);
            float r = (0.15 + aSeed.w * 1.1) * uScale * (1.0 + age * 0.6), ang = aSeed.x + age * 1.5;
            c = vec3(cos(ang) * r, ${ORB_Y.toFixed(2)} + age * (5.0 + aSeed.z * 5.0) * uScale, sin(ang) * r);
            size = (0.06 + aSeed.w * 0.1) * (0.6 + 0.4 * sin(uTime * 9.0 + aSeed.x * 7.0));
            a = sin(age * 3.14159);
          } else {
            float ang = aSeed.x + uTime * (1.2 + aSeed.z * 1.2) * (aSeed.w > 0.5 ? 1.0 : -1.0);
            float tilt = (aSeed.y - 0.5) * 1.6, r = ${ORB_R.toFixed(2)} * uScale * (1.1 + aSeed.w * 0.35);
            c = vec3(cos(ang) * r, ${ORB_Y.toFixed(2)} + sin(ang) * r * tilt * 0.6 + sin(uTime * 2.0 + aSeed.x) * 0.25, sin(ang) * r);
            size = 0.32 + aSeed.z * 0.18; a = 1.0;
          }
          a *= step(aKind.y, uActive) * uAlpha;
          vec4 mv = modelViewMatrix * vec4(c, 1.0);
          mv.xy += position.xy * size * 2.0;
          vUv = uv; vA = a; vK = aKind.x;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uColor; varying vec2 vUv; varying float vA, vK;
        void main(){ float d = length(vUv - 0.5) * 2.0; float a = exp(-d * d * 4.0) * vA;
          vec3 col = mix(uColor, vec3(1.0), exp(-d * d * 14.0) * 0.8 + (1.0 - vK) * 0.3);
          gl_FragColor = vec4(col * a * 1.6, a * 0.55);` + OUT + `}`,
    }));
    this.motes.frustumCulled = false;
    flat.add(this.motes);
    // 바닥 빛 (영상의 보랏빛 바닥처럼) + 테두리 빛 고리
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, ...PREMUL, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      uniforms: this.u,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NOISE + `uniform vec3 uColor; uniform float uTime, uAlpha, uGround; varying vec2 vP;
        void main(){ float r = length(vP);
          float fill = smoothstep(1.0, 0.0, r) * 0.55 * (0.75 + 0.5 * noise(vec3(vP * 4.0, uTime * 0.8)));
          float ring = exp(-pow((r - 0.9 - 0.04 * sin(uTime * 3.0)) * 16.0, 2.0));
          float a = (fill + ring * 0.9) * uAlpha * uGround;
          gl_FragColor = vec4(mix(uColor, vec3(1.0), ring * 0.5) * a, a * 0.7);` + OUT + `}`,
    }));
    this.floor.frustumCulled = false;
    flat.add(this.floor);
    this.light = new THREE.PointLight(0xffffff, 0, 9, 1.6);
    this.light.position.y = ORB_Y;
    local.add(this.light); // 빛은 숨기지 않는다 (빛 개수가 바뀌면 셰이더를 다시 만들어 끊김)
    this.k = 0; this.color = new THREE.Color(1, 1, 1);
  }

  update(dt, t, { k, color, active, scale, feetY }) {
    const e = 1 - Math.exp(-dt * 5), u = this.u;
    this.k += (k - this.k) * e;
    this.color.lerp(color, 1 - Math.exp(-dt * 7));
    u.uTime.value = t; u.uColor.value.copy(this.color); u.uAlpha.value = this.k;
    u.uActive.value += (active - u.uActive.value) * e;
    u.uScale.value += (scale - u.uScale.value) * e;
    u.uGround.value = 1 - sstep(0, 3, feetY);
    const s = u.uScale.value * (1 + 0.025 * Math.sin(t * 7));
    this.ball.scale.setScalar(s);
    this.core.scale.setScalar(1.7 * s);
    this.core.material.color.copy(this.color).lerp(WHITE, 0.5);
    this.core.material.opacity = this.k * 0.5;
    this.floor.position.y = 0.012 - feetY;
    this.floor.scale.setScalar(3.4 * s);
    this.ball.visible = this.core.visible = this.motes.visible = this.floor.visible = this.k > 0.005;
    this.light.color.copy(this.color);
    this.light.intensity = this.k * (3 + 1.2 * Math.sin(t * 13) * Math.sin(t * 5.3));
  }
}

// ───────── 하늘에 떠 있는 빛 구슬 (각성하면 카메라 앞쪽 하늘에 줄지어) ─────────
class SkyOrbs {
  constructor(scene, n = 5) {
    this.group = new THREE.Group(); scene.add(this.group);
    this.list = Array.from({ length: n }, () => { const s = glowSprite(); this.group.add(s); return s; });
    this.k = 0; this.ang = 0; this.color = new THREE.Color(1, 1, 1);
  }
  update(dt, t, k, pos, camPos, color) {
    this.k += (k - this.k) * (1 - Math.exp(-dt * 2));
    this.group.visible = this.k > 0.01;
    if (!this.group.visible) return;
    this.ang += wrapA(Math.atan2(pos.x - camPos.x, pos.z - camPos.z) - this.ang) * (1 - Math.exp(-dt * 1.5));
    this.color.copy(color).lerp(WHITE, 0.55);
    const n = this.list.length;
    this.list.forEach((s, i) => {
      const a = this.ang + (i - (n - 1) / 2) * 0.3;
      s.position.set(pos.x + Math.sin(a) * 14, Math.max(pos.y, 0) + 7.5 + Math.sin(t * 1.3 + i * 1.7) * 0.35, pos.z + Math.cos(a) * 14);
      s.scale.setScalar(2.0 + 0.15 * Math.sin(t * 2.1 + i));
      s.material.color.copy(this.color);
      s.material.opacity = this.k * 0.9;
    });
  }
}

// ───────── 빛줄기: 빠르게 날면 하얀 빛이 되어 꼬리를 끌며 날아감 (영상처럼) ─────────
class LightBeam {
  constructor(scene, N = 72) {
    this.N = N; this.pts = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 6); this.uv = new Float32Array(N * 4);
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.u = { uK: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) } };
    this.mesh = new THREE.Mesh(g, addMat({
      side: THREE.DoubleSide, uniforms: this.u,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uK; varying vec2 vUv;
        void main(){ float x = abs(vUv.x), t = vUv.y;
          float core = exp(-x * x * 5.0), edge = smoothstep(1.0, 0.45, x);
          float a = edge * pow(1.0 - t, 0.8) * uK;
          vec3 col = mix(uColor, vec3(1.0), 0.7 + 0.3 * core) * (1.0 + core * 1.8 * (1.0 - t));
          gl_FragColor = vec4(col * a, a * 0.85);` + OUT + `}`,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.head = glowSprite({ depthTest: false, blending: THREE.NormalBlending }); // 하얗게 덮어서 캐릭터가 빛 속에 들어간 것처럼
    this.head.renderOrder = 6;
    scene.add(this.head);
    this.k = 0;
    this._t = new THREE.Vector3(); this._s = new THREE.Vector3(); this._v = new THREE.Vector3();
  }
  update(dt, t, k, center, vel, camPos, color) {
    this.k += (k - this.k) * (1 - Math.exp(-dt * (k > this.k ? 6 : 3)));
    const on = this.k > 0.01, sp = vel.length(), P = this.pts;
    this.mesh.visible = this.head.visible = on;
    // 지나온 자리 (가장 최근이 앞)
    if (P.length < 2 || P[1].distanceTo(center) > 0.35) P.unshift(center.clone()); else P[0].copy(center);
    const L = Math.min(34, 2 + sp * 0.22);
    let acc = 0, n = 1;
    while (n < P.length && n < this.N - 1) { acc += P[n].distanceTo(P[n - 1]); n++; if (acc > L) break; }
    P.length = Math.min(P.length, n);
    if (!on) return;
    this.u.uK.value = this.k;
    this.u.uColor.value.lerp(color, 1 - Math.exp(-dt * 5));
    const arr = [center.clone().addScaledVector(sp > 0.1 ? this._v.copy(vel).divideScalar(sp) : this._v.set(0, 0, 0), 0.6), ...P];
    const m = Math.min(arr.length, this.N);
    let total = 0;
    for (let i = 1; i < m; i++) total += arr[i].distanceTo(arr[i - 1]);
    total = Math.max(total, 0.01);
    let d = 0;
    for (let i = 0; i < this.N; i++) {
      const j = Math.min(i, m - 1), p = arr[j];
      if (i > 0 && i < m) d += arr[i].distanceTo(arr[i - 1]);
      const tt = Math.min(1, d / total);
      this._t.subVectors(arr[Math.max(0, j - 1)], arr[Math.min(m - 1, j + 1)]);
      if (this._t.lengthSq() < 1e-6) this._t.set(0, 0, 1);
      this._s.crossVectors(this._t, this._v.subVectors(camPos, p)).normalize().multiplyScalar(0.95 * (1 - 0.3 * tt));
      this.pos.set([p.x - this._s.x, p.y - this._s.y, p.z - this._s.z, p.x + this._s.x, p.y + this._s.y, p.z + this._s.z], i * 6);
      this.uv.set([-1, tt, 1, tt], i * 4);
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = g.attributes.uv.needsUpdate = true;
    g.setDrawRange(0, Math.max(0, m - 1) * 6);
    this.head.position.copy(center);
    this.head.scale.setScalar(3.8 * (0.94 + 0.06 * Math.sin(t * 23)));
    this.head.material.color.copy(this.u.uColor.value).lerp(WHITE, 0.8).multiplyScalar(1.6);
    this.head.material.opacity = this.k;
  }
}

// ───────── 단계가 오를 때 터지는 빛 돔 ─────────
class Domes {
  constructor(scene) { this.scene = scene; this.list = []; this.geo = new THREE.SphereGeometry(1, 48, 24); }
  spawn(pos, maxR, dur, color, white = 0) {
    const m = new THREE.Mesh(this.geo, addMat({
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: color.clone() }, uA: { value: 0 }, uW: { value: white }, uTime: { value: 0 } },
      vertexShader: SPHERE_VS,
      fragmentShader: NOISE + `uniform vec3 uColor; uniform float uA, uW, uTime; varying vec3 vN, vV, vL;
        void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          float n = fbm(vL * 3.0 + vec3(0.0, -uTime * 2.0, 0.0));
          float a = (0.35 + pow(f, 2.0) * 0.9) * (0.7 + 0.6 * n) * uA;
          vec3 col = mix(uColor, vec3(1.0), clamp(0.3 + uW + (1.0 - f) * 0.3, 0.0, 1.0));
          gl_FragColor = vec4(col * a * 1.3, min(a * 0.8, 0.97));` + OUT + `}`,
    }));
    m.position.copy(pos); m.frustumCulled = false;
    this.scene.add(m);
    this.list.push({ m, t: 0, dur, maxR });
  }
  update(dt) {
    this.list = this.list.filter(d => {
      d.t += dt;
      const p = Math.min(1, d.t / d.dur), U = d.m.material.uniforms;
      d.m.scale.setScalar(Math.max(0.5, d.maxR * (1 - Math.pow(1 - p, 3))));
      U.uA.value = Math.pow(1 - p, 1.6) * Math.min(1, d.t * 12);
      U.uTime.value += dt;
      if (p >= 1) { this.scene.remove(d.m); d.m.material.dispose(); return false; }
      return true;
    });
  }
}

// ───────── 바닥이 그 단계 색으로 물들고 빛 고리가 퍼짐 ─────────
class FloorGlows {
  constructor(scene) { this.scene = scene; this.list = []; this.geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2); }
  spawn(x, z, R, dur, color) {
    const m = new THREE.Mesh(this.geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, ...PREMUL, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
      uniforms: { uColor: { value: color.clone() }, uP: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NOISE + `uniform vec3 uColor; uniform float uP, uTime; varying vec2 vP;
        void main(){ float r = length(vP), e = 1.0 - pow(1.0 - min(uP * 2.5, 1.0), 3.0);
          float fill = smoothstep(e, e * 0.2, r) * (0.65 + 0.35 * noise(vec3(vP * 6.0, uTime)));
          float ring = exp(-pow((r - e * 0.97) * 22.0, 2.0));
          float a = (fill * 0.75 + ring * 1.2) * (1.0 - smoothstep(0.35, 1.0, uP));
          gl_FragColor = vec4(mix(uColor, vec3(1.0), ring * 0.55) * a, min(a * 0.75, 0.9));` + OUT + `}`,
    }));
    m.position.set(x, 0.015, z); m.scale.setScalar(R); m.frustumCulled = false;
    this.scene.add(m);
    this.list.push({ m, t: 0, dur });
  }
  update(dt) {
    this.list = this.list.filter(g => {
      g.t += dt;
      const U = g.m.material.uniforms;
      U.uP.value = Math.min(1, g.t / g.dur); U.uTime.value = g.t;
      if (g.t >= g.dur) { this.scene.remove(g.m); g.m.material.dispose(); return false; }
      return true;
    });
  }
}

// ───────── 바람 줄 (빠른 비행) ─────────
class SpeedLines {
  constructor(scene, n = 70) {
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index; g.attributes.position = quad.attributes.position;
    this.off = Array.from({ length: n }, () => this.rand(new THREE.Vector3(), true));
    this.p = new Float32Array(n * 3);
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = n;
    this.u = { uDir: { value: new THREE.Vector3(0, 0, 1) }, uLen: { value: 1 }, uK: { value: 0 } };
    this.mesh = new THREE.Mesh(g, addMat({
      side: THREE.DoubleSide, uniforms: this.u,
      vertexShader: `attribute vec3 iPos; uniform vec3 uDir; uniform float uLen; varying vec2 vQ;
        void main(){ vec3 side = normalize(cross(uDir, cameraPosition - iPos)); vec3 wp = iPos - uDir * position.y * uLen + side * position.x * 0.025;
          vQ = position.xy; gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`,
      fragmentShader: `uniform float uK; varying vec2 vQ; void main(){ float a = (1.0 - abs(vQ.x) * 2.0) * sin(vQ.y * 3.14159) * uK;
        gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * a, a * 0.3);` + OUT + `}`,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  rand(v, any) {
    const a = Math.random() * Math.PI * 2, r = rnd(1.6, 7);
    return v.set(Math.cos(a) * r, Math.sin(a) * r, any ? rnd(-14, 26) : rnd(18, 26)); // (가로, 세로, 앞쪽 거리)
  }
  update(dt, k, center, vel) {
    const sp = vel.length();
    this.u.uK.value = k; this.mesh.visible = k > 0.01;
    if (!this.mesh.visible || sp < 1) return;
    const dir = vel.clone().divideScalar(sp), up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize(), upv = new THREE.Vector3().crossVectors(right, dir);
    this.u.uDir.value.copy(dir); this.u.uLen.value = Math.min(9, sp * 0.07);
    this.off.forEach((o, i) => {
      o.z -= sp * dt * 0.35;
      if (o.z < -14) this.rand(o, false);
      this.p[i * 3] = center.x + right.x * o.x + upv.x * o.y + dir.x * o.z;
      this.p[i * 3 + 1] = center.y + right.y * o.x + upv.y * o.y + dir.y * o.z;
      this.p[i * 3 + 2] = center.z + right.z * o.x + upv.z * o.y + dir.z * o.z;
    });
    this.mesh.geometry.attributes.iPos.needsUpdate = true;
  }
}

// ───────── 충격파 고리 (땅·하늘) + 퍼지는 구 ─────────
const RING_FRAG = NOISE + `uniform vec3 uColor; uniform float uP, uMaxR, uW, uAlpha, uDust; varying vec2 vUv;
  void main(){
    vec2 c = vUv * 2.0 - 1.0; float dm = length(c) * uMaxR * 1.1;
    float e = 1.0 - pow(1.0 - uP, 3.0), R = uMaxR * e, w = uW * (0.5 + uP);
    float n = noise(vec3(atan(c.y, c.x) * 6.0, dm * 0.8, uP * 4.0));
    float band = exp(-pow((dm - R) / w, 2.0)) * (0.6 + 0.6 * n);
    float trail = smoothstep(R, R * 0.45, dm) * smoothstep(0.0, R * 0.3, dm) * 0.3;
    float a = (band + trail * (1.0 - uDust)) * pow(1.0 - uP, 1.3) * uAlpha;
    vec3 col = uDust > 0.5 ? uColor : mix(uColor, vec3(1.0), band * 0.5);
    gl_FragColor = uDust > 0.5 ? vec4(col, clamp(a * 0.75, 0.0, 1.0)) : vec4(col * a * 0.9, a * 0.5);` + OUT + `
  }`;

class Shockwaves {
  constructor(scene) {
    this.scene = scene; this.list = [];
    this.plane = new THREE.PlaneGeometry(2, 2);
    this.sphere = new THREE.SphereGeometry(1, 48, 24);
  }
  ringMesh(dust) {
    const m = new THREE.Mesh(this.plane, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, ...(dust ? { blending: THREE.NormalBlending } : PREMUL),
      polygonOffset: true, polygonOffsetFactor: -4,
      uniforms: { uColor: { value: new THREE.Color() }, uP: { value: 0 }, uMaxR: { value: 1 }, uW: { value: 0.5 }, uAlpha: { value: 1 }, uDust: { value: dust ? 1 : 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: RING_FRAG,
    }));
    m.frustumCulled = false;
    return m;
  }
  // pos: 중심, normal: 고리 면의 법선, maxR: 퍼지는 반지름(m), dur: 초
  spawn(pos, normal, maxR, dur, color, { dust = false, shell = true, alpha = 1, width = 0.5 } = {}) {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const ring = this.ringMesh(false);
    ring.position.copy(pos); ring.quaternion.copy(q); ring.scale.setScalar(maxR * 1.1);
    ring.material.uniforms.uColor.value.copy(color);
    ring.material.uniforms.uMaxR.value = maxR; ring.material.uniforms.uW.value = width; ring.material.uniforms.uAlpha.value = alpha;
    this.scene.add(ring);
    const items = [ring];
    if (dust) {
      const d = this.ringMesh(true);
      d.position.copy(pos).addScaledVector(normal, 0.02); d.quaternion.copy(q); d.scale.setScalar(maxR * 0.85 * 1.1);
      d.material.uniforms.uColor.value.set(0xc9cfd8); d.material.uniforms.uMaxR.value = maxR * 0.85; d.material.uniforms.uW.value = width * 2.2;
      this.scene.add(d); items.push(d);
    }
    let sh = null;
    if (shell) {
      sh = new THREE.Mesh(this.sphere, addMat({
        uniforms: { uColor: { value: color.clone() }, uA: { value: 1 } },
        vertexShader: `varying vec3 vN, vV; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
        fragmentShader: `uniform vec3 uColor; uniform float uA; varying vec3 vN, vV;
          void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float x = pow(f, 4.0) * uA; gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.3) * x * 0.6, x * 0.3);` + OUT + `}`,
      }));
      sh.position.copy(pos); sh.frustumCulled = false;
      this.scene.add(sh); items.push(sh);
    }
    this.list.push({ items, ring, sh, t: 0, dur, maxR, alpha });
  }
  update(dt) {
    this.list = this.list.filter(w => {
      w.t += dt;
      const p = Math.min(1, w.t / w.dur);
      for (const m of w.items) if (m !== w.sh) m.material.uniforms.uP.value = p;
      if (w.sh) {
        const ps = Math.min(1, w.t / (w.dur * 0.45));
        w.sh.scale.setScalar(Math.max(0.01, w.maxR * 0.55 * (1 - Math.pow(1 - ps, 3))));
        w.sh.material.uniforms.uA.value = Math.pow(1 - ps, 2) * w.alpha;
      }
      if (p >= 1) { for (const m of w.items) { this.scene.remove(m); m.material.dispose(); } return false; }
      return true;
    });
  }
}

// ───────── 부드러운 알갱이 (먼지·불티) ─────────
class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.list = [];
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index; g.attributes.position = quad.attributes.position; g.attributes.uv = quad.attributes.uv;
    this.a = { p: new Float32Array(max * 3), s: new Float32Array(max), al: new Float32Array(max), c: new Float32Array(max * 3) };
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.a.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iSize', new THREE.InstancedBufferAttribute(this.a.s, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(this.a.al, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iCol', new THREE.InstancedBufferAttribute(this.a.c, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, ...(additive ? PREMUL : { blending: THREE.NormalBlending }),
      vertexShader: `attribute vec3 iPos, iCol; attribute float iSize, iAlpha; varying vec2 vUv; varying float vA; varying vec3 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(iPos, 1.0); mv.xy += position.xy * iSize; vUv = uv; vA = iAlpha; vC = iCol; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: additive
        ? `varying vec2 vUv; varying float vA; varying vec3 vC; void main(){ float d = length(vUv - 0.5) * 2.0; float a = exp(-d * d * 5.0) * vA; gl_FragColor = vec4(mix(vC, vec3(1.0), exp(-d * d * 18.0)) * a * 1.6, a * 0.5);` + OUT + `}`
        : `varying vec2 vUv; varying float vA; varying vec3 vC; void main(){ float d = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.2, d) * vA; gl_FragColor = vec4(vC, a);` + OUT + `}`,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  add(o) { if (this.list.length >= this.max) this.list.shift(); this.list.push({ age: 0, drag: 1.5, grav: 0, grow: 1, ...o }); }
  update(dt) {
    const A = this.a;
    this.list = this.list.filter(p => (p.age += dt) < p.life);
    this.list.forEach((p, i) => {
      p.vel.multiplyScalar(Math.exp(-p.drag * dt)); p.vel.y -= p.grav * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.05) { p.pos.y = 0.05; p.vel.y = Math.abs(p.vel.y) * 0.2; }
      const k = p.age / p.life;
      A.p.set([p.pos.x, p.pos.y, p.pos.z], i * 3);
      A.s[i] = p.size * (1 + k * p.grow);
      A.al[i] = p.alpha * Math.min(1, p.age * 12) * (1 - k) * (1 - k * 0.3);
      A.c.set([p.color.r, p.color.g, p.color.b], i * 3);
    });
    const g = this.mesh.geometry;
    g.instanceCount = this.list.length;
    for (const k of ['iPos', 'iSize', 'iAlpha', 'iCol']) g.attributes[k].needsUpdate = true;
  }
}

// ───────── 바닥 조각 (튀어 오르거나, 기 모을 때 둥실 떠오름) ─────────
class Rocks {
  constructor(scene, max = 170) {
    this.max = max; this.list = [];
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 1.2, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xe9ecf0, roughness: 0.9, flatShading: true }), max);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.e = new THREE.Euler();
  }
  add(o) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ age: 0, rot: new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6)), spin: new THREE.Vector3(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6)),
      floating: false, bounces: 0, ...o });
  }
  // 떠 있던 돌을 바깥으로 날려 보냄
  blast(center, power) {
    for (const r of this.list) if (r.floating) {
      r.floating = false;
      const d = r.pos.clone().sub(center); d.y = Math.max(d.y, 0.3) * 0.6;
      r.vel.copy(d.normalize().multiplyScalar(power * rnd(0.6, 1.2))); r.vel.y += rnd(2, 6);
      r.life = r.age + rnd(2.5, 4);
    }
  }
  drop() { for (const r of this.list) if (r.floating) { r.floating = false; r.vel.set(rnd(-0.5, 0.5), 0, rnd(-0.5, 0.5)); r.life = r.age + rnd(2.5, 4); } }
  update(dt, t) {
    this.list = this.list.filter(r => (r.age += dt) < r.life);
    this.list.forEach((r, i) => {
      if (r.floating) {
        r.vel.y += (r.lift - r.vel.y) * dt * 2; r.vel.y *= r.pos.y > r.top ? 0.9 : 1;
        r.pos.x += Math.sin(t * 3 + r.size * 40) * dt * 0.15; r.pos.z += Math.cos(t * 2.6 + r.size * 30) * dt * 0.15;
        r.pos.y += r.vel.y * dt;
        if (r.pos.y > r.top) r.pos.y = r.top + Math.sin(t * 4 + i) * 0.03;
      } else {
        r.vel.y -= 22 * dt;
        r.pos.addScaledVector(r.vel, dt);
        if (r.pos.y < r.size * 0.6) {
          r.pos.y = r.size * 0.6;
          if (r.vel.y < -1.5 && r.bounces < 2) { r.vel.y *= -0.35; r.vel.x *= 0.6; r.vel.z *= 0.6; r.spin.multiplyScalar(0.5); r.bounces++; }
          else { r.vel.set(0, 0, 0); r.spin.multiplyScalar(0.9); }
        }
      }
      r.rot.x += r.spin.x * dt; r.rot.y += r.spin.y * dt; r.rot.z += r.spin.z * dt;
      const fade = Math.min(1, (r.life - r.age) / 0.6, r.age * 8);
      this.s.setScalar(r.size * Math.max(0.001, fade));
      this.mesh.setMatrixAt(i, this.m.compose(r.pos, this.q.setFromEuler(r.rot), this.s));
    });
    this.mesh.count = this.list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ───────── 바닥 금 + 깨진 바닥판 ─────────
function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function crackTextures(seed) {
  const N = 1024, R = mulberry(seed), lines = [];
  const walk = (x, y, ang, len, w, depth) => {
    const pts = [[x, y]];
    let l = 0;
    while (l < len) {
      const st = 10 + R() * 22;
      ang += (R() - 0.5) * 0.7;
      x += Math.cos(ang) * st; y += Math.sin(ang) * st; l += st;
      pts.push([x, y]);
      if (depth < 2 && R() < 0.13) walk(x, y, ang + (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.6), (len - l) * (0.35 + R() * 0.4), w * 0.55, depth + 1);
    }
    lines.push({ pts, w });
  };
  const n = 13 + Math.floor(R() * 5);
  for (let i = 0; i < n; i++) walk(N / 2, N / 2, (i / n) * Math.PI * 2 + (R() - 0.5) * 0.4, N * (0.25 + R() * 0.24), 7 + R() * 4, 0);
  for (const rr of [0.1, 0.17, 0.26]) { // 동심원 방향 금
    let a = R() * 6.28;
    for (let k = 0; k < 7; k++) {
      const a0 = a, a1 = a + 0.25 + R() * 0.5, pts = [];
      for (let s = 0; s <= 6; s++) { const aa = a0 + (a1 - a0) * s / 6, r = N * rr * (1 + (R() - 0.5) * 0.12); pts.push([N / 2 + Math.cos(aa) * r, N / 2 + Math.sin(aa) * r]); }
      if (R() < 0.75) lines.push({ pts, w: 3 + R() * 3 });
      a = a1 + 0.3 + R() * 0.6;
    }
  }
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const dark = mk(), glow = mk(), gd = dark.getContext('2d'), gg = glow.getContext('2d');
  const grad = gd.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N * 0.2);
  grad.addColorStop(0, 'rgba(70,78,92,0.55)'); grad.addColorStop(0.5, 'rgba(110,118,130,0.25)'); grad.addColorStop(1, 'rgba(140,148,160,0)');
  gd.fillStyle = grad; gd.fillRect(0, 0, N, N);
  const stroke = (g, pts, w, col) => {
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = g.lineJoin = 'round';
    g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
  };
  const fade = pts => { const [x, y] = pts[pts.length - 1]; return 1 - Math.min(1, Math.hypot(x - N / 2, y - N / 2) / (N * 0.5)); };
  for (const { pts, w } of lines) {
    const k = 0.35 + 0.65 * fade(pts);
    stroke(gd, pts, w * k * 1.6, 'rgba(120,128,140,0.35)');
    stroke(gd, pts, w * k, 'rgba(46,52,62,0.92)');
    stroke(gd, pts.map(([x, y]) => [x + 1.5, y + 1.5]), Math.max(1, w * k * 0.35), 'rgba(255,255,255,0.7)');
  }
  gg.shadowColor = '#fff'; gg.shadowBlur = 14;
  for (const { pts, w } of lines) stroke(gg, pts, w * 0.9, 'rgba(255,255,255,0.95)');
  const tex = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  return [tex(dark), tex(glow)];
}

class Cracks {
  constructor(scene) {
    this.scene = scene; this.list = [];
    this.tex = [11, 23, 37].map(crackTextures);
    this.plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.slabs = new THREE.InstancedMesh(this.rboxSlab(), new THREE.MeshStandardMaterial({ color: 0xf6f7f9, roughness: 0.9 }), 160);
    this.slabs.castShadow = this.slabs.receiveShadow = true;
    this.slabs.count = 0; this.slabs.frustumCulled = false;
    this.slabs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.slabs);
    this.slabList = [];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3();
  }
  rboxSlab() { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, -0.5, 0); return g; }
  spawn(x, z, size, color, slabs = 0) {
    if (this.list.length >= 9) this.kill(this.list.shift());
    const [dark, glow] = this.tex[Math.floor(Math.random() * 3)], rot = Math.random() * Math.PI * 2;
    const md = new THREE.Mesh(this.plane, new THREE.MeshStandardMaterial({ map: dark, transparent: true, depthWrite: false, roughness: 0.95,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const mg = new THREE.Mesh(this.plane, new THREE.MeshBasicMaterial({ map: glow, color: color.clone().multiplyScalar(1.6), transparent: true,
      depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    for (const m of [md, mg]) { m.position.set(x, 0.002, z); m.rotation.y = rot; m.scale.setScalar(0.001); m.receiveShadow = m === md; this.scene.add(m); }
    this.list.push({ md, mg, size, t: 0, life: 26 });
    // 바닥판이 깨져서 들림
    for (let i = 0; i < slabs; i++) {
      const a = (i / slabs) * Math.PI * 2 + rnd(-0.25, 0.25), r = size * 0.5 * rnd(0.3, 0.85);
      if (this.slabList.length >= 160) this.slabList.shift();
      this.slabList.push({ x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, a, tilt: rnd(0.25, 0.65) * (r / (size * 0.5) < 0.5 ? 1.2 : 1),
        w: rnd(0.35, 0.9) * Math.min(1.6, size / 5), d: rnd(0.4, 1.0) * Math.min(1.6, size / 5), h: rnd(0.12, 0.22), spin: rnd(-0.4, 0.4), t: 0, life: 26 });
    }
  }
  kill(c) { for (const m of [c.md, c.mg]) { this.scene.remove(m); m.material.dispose(); } }
  update(dt) {
    this.list = this.list.filter(c => {
      c.t += dt;
      const grow = 1 - Math.pow(1 - Math.min(1, c.t / 0.25), 3), s = c.size * grow;
      c.md.scale.set(s, 1, s); c.mg.scale.set(s, 1, s);
      const fade = 1 - sstep(c.life - 3, c.life, c.t);
      c.md.material.opacity = fade;
      c.mg.material.opacity = Math.exp(-c.t * 0.7) * fade;
      if (c.t >= c.life) { this.kill(c); return false; }
      return true;
    });
    this.slabList = this.slabList.filter(b => (b.t += dt) < b.life);
    this.slabList.forEach((b, i) => {
      const up = 1 - Math.pow(1 - Math.min(1, b.t / 0.18), 3), sink = sstep(b.life - 3, b.life, b.t);
      // 가운데 쪽 모서리가 들리게: 바깥 방향 축 둘레로 기울임
      this.q.setFromEuler(new THREE.Euler(0, -b.a + b.spin, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -b.tilt * up));
      this.v.set(b.x, b.h * 0.6 * up - sink * 0.5, b.z);
      this.s.set(b.w, b.h, b.d);
      this.slabs.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
    });
    this.slabs.count = this.slabList.length;
    this.slabs.instanceMatrix.needsUpdate = true;
  }
}

// ───────── 모두 묶기 ─────────
const UP = new THREE.Vector3(0, 1, 0);
export class AwakenFX {
  constructor(scene, character) {
    this.scene = scene; this.ch = character;
    this.local = new THREE.Group();          // 몸 기울기를 따라가는 효과 (발 = y 0)
    this.local.position.y = -character.tilt.position.y;
    character.tilt.add(this.local);
    this.flat = new THREE.Group();           // 기울지 않는 효과 (위로 솟는 반짝이·바닥 빛)
    character.root.add(this.flat);
    this.aura = new Aura(this.local, this.flat);
    this.orbs = new SkyOrbs(scene);
    this.beam = new LightBeam(scene);
    this.lines = new SpeedLines(scene);
    this.waves = new Shockwaves(scene);
    this.domes = new Domes(scene);
    this.glows = new FloorGlows(scene);
    this.dust = new Particles(scene, 260, false);
    this.sparks = new Particles(scene, 260, true);
    this.rocks = new Rocks(scene);
    this.cracks = new Cracks(scene);
    this.flash = new THREE.PointLight(0xffffff, 0, 30, 1.5);
    scene.add(this.flash);
    this.flashK = 0; this.t = 0; this.floatAcc = 0;
  }

  // 단계가 오를 때: 빛 돔이 터지고, 바닥이 물들고, 바닥 조각이 튀어 오름
  levelUp(level, pos, onGround) {
    const L = LEVELS[level], c = L.color, size = [0, 4, 6, 8.5, 12][level];
    const center = pos.clone().add(new THREE.Vector3(0, 1, 0));
    this.domes.spawn(onGround ? new THREE.Vector3(pos.x, 0, pos.z) : center, size, 0.9 + level * 0.15, c, level === 4 ? 0.4 : 0);
    if (level === 4) this.domes.spawn(center, size * 1.8, 1.7, WHITE, 1); // 마지막 단계는 하얗게 크게 터짐
    if (onGround) {
      this.glows.spawn(pos.x, pos.z, size * 1.5, 2.6, c);
      this.waves.spawn(new THREE.Vector3(pos.x, 0.03, pos.z), UP, size * 1.7, 1.0 + level * 0.12, c, { dust: true, shell: false, width: 0.3 + level * 0.1 });
      this.cracks.spawn(pos.x, pos.z, size * 0.85, c, level >= 2 ? 4 + level * 4 : 0);
      for (let i = 0; i < 24 + level * 12; i++) {
        const a = rnd(0, 6.28), sp = rnd(4, 9) * (0.7 + level * 0.25);
        this.dust.add({ pos: new THREE.Vector3(pos.x + Math.cos(a) * 0.6, rnd(0.1, 0.4), pos.z + Math.sin(a) * 0.6),
          vel: new THREE.Vector3(Math.cos(a) * sp, rnd(0.3, 2.2), Math.sin(a) * sp), size: rnd(0.5, 1.1), grow: 2.5, life: rnd(1.0, 1.9),
          alpha: 0.5, color: new THREE.Color(0xc4cad3), drag: 2.4 });
      }
      for (let i = 0; i < 10 + level * 8; i++) { // 바닥 조각(네모)
        const a = rnd(0, 6.28), r = rnd(0.5, size * 0.35), sp = rnd(2, 6) * (0.6 + level * 0.2);
        this.rocks.add({ pos: new THREE.Vector3(pos.x + Math.cos(a) * r, 0.1, pos.z + Math.sin(a) * r),
          vel: new THREE.Vector3(Math.cos(a) * sp, rnd(5, 10) * (0.7 + level * 0.12), Math.sin(a) * sp), size: rnd(0.08, 0.2), life: rnd(3, 5) });
      }
    } else this.waves.spawn(center, UP, size * 1.5, 1.0, c, { width: 0.5 });
    this.rocks.blast(pos, 7 + level * 3);
    for (let i = 0; i < 40 + level * 20; i++) {
      const d = new THREE.Vector3(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize();
      this.sparks.add({ pos: center.clone().addScaledVector(d, 0.4), vel: d.multiplyScalar(rnd(6, 16)), size: rnd(0.08, 0.18), grow: -0.5,
        life: rnd(0.5, 1.0), alpha: 1, color: c.clone(), drag: 3, grav: 2 });
    }
    this.flash.position.copy(center); this.flash.color.copy(c); this.flashK = 1 + level * 0.5;
    this.ch.burst();
  }

  // 세게 착지: 크기는 충격 세기(0~1)
  impact(pos, k, color) {
    const size = 2.5 + k * 7;
    this.glows.spawn(pos.x, pos.z, size * 1.2, 1.6, color);
    this.waves.spawn(new THREE.Vector3(pos.x, 0.03, pos.z), UP, size * 1.5, 0.8 + k * 0.5, color, { dust: true, width: 0.4 + k * 0.4 });
    this.cracks.spawn(pos.x, pos.z, size, color, k > 0.35 ? Math.round(4 + k * 12) : 0);
    for (let i = 0; i < 20 + k * 40; i++) {
      const a = rnd(0, 6.28), sp = rnd(3, 9) * (0.6 + k);
      this.dust.add({ pos: new THREE.Vector3(pos.x, rnd(0.1, 0.3), pos.z), vel: new THREE.Vector3(Math.cos(a) * sp, rnd(0.5, 2.5), Math.sin(a) * sp),
        size: rnd(0.5, 1.0), grow: 2.5, life: rnd(0.9, 1.7), alpha: 0.6, color: new THREE.Color(0xc4cad3), drag: 2.4 });
    }
    for (let i = 0; i < 6 + k * 22; i++) {
      const a = rnd(0, 6.28);
      this.rocks.add({ pos: new THREE.Vector3(pos.x + Math.cos(a) * 0.4, 0.1, pos.z + Math.sin(a) * 0.4),
        vel: new THREE.Vector3(Math.cos(a) * rnd(2, 6), rnd(4, 10) * (0.5 + k), Math.sin(a) * rnd(2, 6)), size: rnd(0.08, 0.2), life: rnd(3, 5) });
    }
    this.flash.position.set(pos.x, 1, pos.z); this.flash.color.copy(color); this.flashK = 0.6 + k;
  }

  // 빛줄기가 될 때: 하얗게 터지는 빛 + 진행 방향에 수직인 고리
  sonicBoom(pos, dir) {
    this.domes.spawn(pos, 6, 0.6, WHITE, 1);
    this.waves.spawn(pos.clone().addScaledVector(dir, 1.5), dir, 14, 0.9, WHITE, { shell: false, width: 0.9 });
  }

  // st: { level, chargeK, charging, flying, speed, vel, grounded, pos, camPos }
  update(dt, st) {
    this.t += dt;
    const t = this.t, L = LEVELS[st.level], next = LEVELS[Math.min(4, st.level + 1)];
    const color = st.charging ? L.color.clone().lerp(next.color, st.chargeK * 0.4) : L.color;
    const beamK = st.flying ? sstep(40, 80, st.speed) : 0;
    let k = st.level ? 0.7 + 0.08 * st.level : 0;
    if (st.charging) k = Math.max(k, 0.3 + st.chargeK * 0.55) * (1 + 0.3 * st.chargeK);
    const lv = st.level + (st.charging ? st.chargeK : 0);
    this.aura.update(dt, t, {
      k: k * (1 - beamK), color, active: Math.min(1, 0.25 + lv * 0.19), feetY: st.pos.y,
      scale: (st.level ? L.scale : 0.8) * (st.charging ? 1 + 0.12 * st.chargeK : 1),
    });
    this.orbs.update(dt, t, st.level ? 1 : 0, st.pos, st.camPos, color);
    const center = st.pos.clone(); center.y += 0.95;
    this.beam.update(dt, t, beamK, center, st.vel, st.camPos, st.level ? color : WHITE);
    this.lines.update(dt, st.flying ? sstep(25, 80, st.speed) * 0.8 : 0, center, st.vel);
    // 기 모을 때: 바닥 조각이 둥실 떠오르고 먼지가 맴돈다
    if (st.charging && st.pos.y < 1.5) {
      this.floatAcc += dt * (5 + st.level * 4 + st.chargeK * 8);
      while (this.floatAcc > 1) {
        this.floatAcc -= 1;
        const a = rnd(0, 6.28), r = rnd(0.9, 3.5);
        this.rocks.add({ pos: new THREE.Vector3(st.pos.x + Math.cos(a) * r, 0.05, st.pos.z + Math.sin(a) * r), vel: new THREE.Vector3(),
          size: rnd(0.06, 0.16), life: 12, floating: true, lift: rnd(0.5, 1.4), top: rnd(0.8, 3.2) });
        if (Math.random() < 0.6) this.dust.add({ pos: new THREE.Vector3(st.pos.x + Math.cos(a) * r * 0.5, 0.1, st.pos.z + Math.sin(a) * r * 0.5),
          vel: new THREE.Vector3(Math.cos(a) * 2.5, 0.2, Math.sin(a) * 2.5), size: rnd(0.4, 0.8), grow: 1.5, life: 1.2, alpha: 0.35, color: new THREE.Color(0xd2d7de) });
      }
    }
    this.waves.update(dt); this.domes.update(dt); this.glows.update(dt);
    this.dust.update(dt); this.sparks.update(dt); this.rocks.update(dt, t); this.cracks.update(dt);
    this.flashK *= Math.exp(-dt * 7);
    this.flash.intensity = this.flashK * 9;
  }
}
