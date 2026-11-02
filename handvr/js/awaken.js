// 각성 효과: 몸을 감싸는 기(오라) · 불꽃 가시 · 번개 · 보호막 · 충격파 · 바닥 금·깨진 바닥판 · 돌 조각 · 먼지 · 음속 원뿔
import * as THREE from 'three';

// 단계: 1 약한 하양 · 2 파랑 · 3 노랑 · 4 빨강
export const LEVELS = [
  { name: '각성 전', css: '#ffffff', color: new THREE.Color(1, 1, 1), power: 0, scale: 0.75 },
  { name: '1단계 · 하얀 기운', css: '#f4f7ff', color: new THREE.Color(0.8, 0.88, 1.0), power: 0.5, scale: 0.82 },
  { name: '2단계 · 파란 기운', css: '#5aa8ff', color: new THREE.Color(0.18, 0.55, 1.0), power: 0.8, scale: 0.97 },
  { name: '3단계 · 노란 기운', css: '#ffd23a', color: new THREE.Color(1.0, 0.78, 0.12), power: 1.05, scale: 1.12 },
  { name: '4단계 · 붉은 기운', css: '#ff4a3a', color: new THREE.Color(1.0, 0.13, 0.06), power: 1.3, scale: 1.3 },
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

// 기 껍질 모양: 발밑에서 부풀었다가 머리 위로 뾰족하게 (사진의 빨간 선처럼)
const AURA_H = 2.9, AURA_R = 1.05;
const shellR = t => AURA_R * Math.pow(Math.max(1 - t, 0), 0.72) * (0.62 + 0.38 * Math.min(1, t / 0.3));
const SHELL_R_GLSL = `float shellR(float t){ return ${AURA_R.toFixed(3)} * pow(max(1.0 - t, 0.0), 0.72) * (0.62 + 0.38 * min(1.0, t / 0.3)); }`;

// ───────── 오라 ─────────
class Aura {
  constructor(parent) {
    this.u = { uTime: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) }, uAlpha: { value: 0 }, uPower: { value: 1 },
      uActive: { value: 0 }, uGround: { value: 1 }, uScale: { value: 1 } };
    this.group = new THREE.Group();
    parent.add(this.group);
    // 껍질 2겹
    const pts = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push(new THREE.Vector2(Math.max(shellR(t), 0.001), t * AURA_H)); }
    const geo = new THREE.LatheGeometry(pts, 72);
    const shellMat = (inner) => addMat({
      side: THREE.DoubleSide, uniforms: { ...this.u, uInner: { value: inner } },
      vertexShader: NOISE + `
        uniform float uTime, uPower, uScale; varying vec3 vN, vV; varying vec2 vQ;
        void main(){
          vec3 p = position; float a = atan(p.z, p.x), h = uv.y;
          float n = noise(vec3(a * 2.0, h * 3.0 - uTime * 2.6, uTime * 0.7));
          float fl = noise(vec3(a * 5.0 + 3.0, h * 7.0 - uTime * 7.0, 1.0));
          p.xz *= 1.0 + (n - 0.5) * 0.4 * uPower + fl * 0.14 * h;
          p.y += (fl - 0.35) * 0.6 * h * h * uPower;
          p *= uScale;
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); vQ = vec2(a, h);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: NOISE + `
        uniform vec3 uColor; uniform float uTime, uAlpha, uInner; varying vec3 vN, vV; varying vec2 vQ;
        void main(){
          float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          float a = vQ.x, h = vQ.y;
          float s1 = fbm(vec3(a * 3.0, h * 2.4 - uTime * 3.4, uTime * 0.5));
          float st = pow(noise(vec3(a * 15.0, h * 1.7 - uTime * 5.0, uInner * 7.0)), 3.0);
          float edge = pow(f, 2.0);
          float body = (0.03 + edge * 1.1) * (0.4 + s1) + st * 0.9 * (0.25 + edge);
          float fade = smoothstep(0.0, 0.1, h) * (1.0 - 0.75 * smoothstep(0.7, 1.0, h));
          float al = body * fade * uAlpha * (uInner > 0.5 ? 0.45 : 1.0);
          vec3 col = mix(uColor, vec3(1.0), clamp(st * 0.35 + uInner * 0.1, 0.0, 1.0));
          gl_FragColor = vec4(col * al * 0.8, min(al * 0.75, 0.85));` + OUT + `
        }`,
    });
    this.outer = new THREE.Mesh(geo, shellMat(0));
    this.inner = new THREE.Mesh(geo, shellMat(1));
    this.inner.scale.set(0.78, 0.86, 0.78);
    this.outer.frustumCulled = this.inner.frustumCulled = false;
    this.group.add(this.outer, this.inner);

    // 불꽃 가시: 몸 둘레에서 솟아오르는 뾰족한 불꽃 + 발밑에서 바깥으로 튀는 불꽃 (GPU 에서 움직임 계산)
    const NB = 230, NG = 70, N = NB + NG;
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index; g.attributes.position = quad.attributes.position; g.attributes.uv = quad.attributes.uv;
    const seed = new Float32Array(N * 4), kind = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      seed.set([Math.random() * Math.PI * 2, Math.random(), Math.random(), Math.random()], i * 4);
      kind.set([i < NB ? 0 : 1, Math.random()], i * 2);
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 2));
    g.instanceCount = N;
    this.tongues = new THREE.Mesh(g, addMat({
      side: THREE.DoubleSide, uniforms: this.u,
      vertexShader: SHELL_R_GLSL + `
        attribute vec4 aSeed; attribute vec2 aKind;
        uniform float uTime, uActive, uGround, uScale, uAlpha, uPower; varying vec2 vQ; varying float vA;
        void main(){
          float life = 0.42 + aSeed.z * 0.5;
          float age = fract(uTime / life + aSeed.y);
          float on = step(aKind.y, uActive) * (aKind.x > 0.5 ? uGround : 1.0);
          vec3 rad = vec3(cos(aSeed.x), 0.0, sin(aSeed.x));
          vec3 base, dir; float len, wid;
          if (aKind.x < 0.5) {
            float y = (aSeed.w * 1.7 + age * (1.0 + aSeed.z * 1.5)) * uScale;
            float t = clamp(y / (${AURA_H.toFixed(2)} * uScale), 0.0, 1.0);
            base = rad * shellR(t) * uScale * (0.7 + 0.25 * aSeed.y) + vec3(0.0, y, 0.0);
            dir = normalize(vec3(0.0, 1.0, 0.0) - rad * (0.15 + t * 0.7));
            len = (0.35 + aSeed.w * 0.55) * uScale * (0.6 + 0.5 * uPower);
            wid = (0.08 + aSeed.z * 0.12) * uScale;
          } else {
            base = rad * (0.3 + age * 1.1) * uScale + vec3(0.0, 0.02, 0.0);
            dir = normalize(rad + vec3(0.0, 0.45 + aSeed.w * 0.7, 0.0));
            len = (0.3 + aSeed.w * 0.5) * uScale * (0.6 + 0.5 * uPower);
            wid = (0.1 + aSeed.z * 0.1) * uScale;
          }
          float grow = pow(sin(age * 3.14159), 0.6);
          vec3 wb = (modelMatrix * vec4(base, 1.0)).xyz;
          vec3 wd = normalize(mat3(modelMatrix) * dir);
          vec3 side = normalize(cross(wd, normalize(cameraPosition - wb)));
          vec3 wp = wb + wd * position.y * len * grow * on + side * position.x * wid * on;
          vQ = vec2(position.x, position.y); vA = on * grow * uAlpha;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor; varying vec2 vQ; varying float vA;
        void main(){
          float w = 0.5 * pow(1.0 - vQ.y, 1.25);
          float m = 1.0 - smoothstep(w * 0.45, w, abs(vQ.x));
          float core = 1.0 - smoothstep(0.0, w * 0.55, abs(vQ.x));
          float a = m * vA * smoothstep(0.0, 0.15, vQ.y);
          vec3 col = mix(uColor, vec3(1.0), core * 0.3 * (1.0 - vQ.y));
          gl_FragColor = vec4(col * a * (0.75 + core * 0.5), a * 0.8);` + OUT + `
        }`,
    }));
    this.tongues.frustumCulled = false;
    this.group.add(this.tongues);

    this.light = new THREE.PointLight(0xffffff, 0, 9, 1.6);
    this.light.position.y = 1.0;
    parent.add(this.light); // 그룹을 숨겨도 빛 개수가 그대로여야 셰이더를 다시 만들지 않는다
    this.k = 0; this.color = new THREE.Color(1, 1, 1);
  }

  // k: 세기(0~1.5), color: 목표 색, active: 불꽃 개수 비율, ground: 발밑 불꽃(땅 위일 때)
  update(dt, t, { k, color, active, ground, scale, power }) {
    const e = 1 - Math.exp(-dt * 5);
    this.k += (k - this.k) * e;
    this.color.lerp(color, 1 - Math.exp(-dt * 7));
    const u = this.u;
    u.uTime.value = t; u.uColor.value.copy(this.color);
    u.uAlpha.value = this.k;
    u.uActive.value += (active - u.uActive.value) * e;
    u.uGround.value += (ground - u.uGround.value) * (1 - Math.exp(-dt * 8));
    u.uScale.value += (scale - u.uScale.value) * e;
    u.uPower.value += (power - u.uPower.value) * e;
    this.group.visible = this.k > 0.005;
    this.light.color.copy(this.color);
    this.light.intensity = this.k * (3 + 1.2 * Math.sin(t * 23) * Math.sin(t * 7.3));
  }
}

// ───────── 번개 (3·4단계): 몸 주위에 튀는 지그재그 전기 ─────────
class Lightning {
  constructor(scene, local) {
    this.local = local; this.max = 10; this.seg = 9; this.bolts = [];
    const nq = this.max * this.seg;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(nq * 4 * 3);
    const uv = new Float32Array(nq * 4 * 2), idx = [];
    for (let q = 0; q < nq; q++) {
      uv.set([0, 0, 0, 1, 1, 0, 1, 1], q * 8);
      const b = q * 4; idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.u = { uColor: { value: new THREE.Color() } };
    this.mesh = new THREE.Mesh(g, addMat({
      side: THREE.DoubleSide, uniforms: this.u,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying vec2 vUv;
        void main(){ float d = abs(vUv.y * 2.0 - 1.0); float a = exp(-d * d * 7.0); vec3 c = mix(uColor, vec3(1.0), exp(-d * d * 30.0));
          gl_FragColor = vec4(c * a * 2.2, a * 0.4);` + OUT + `}`,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.acc = 0;
  }
  spawn(scale) {
    if (this.bolts.length >= this.max) this.bolts.shift();
    const pts = [], a = Math.random() * Math.PI * 2, r = rnd(0.25, 0.6) * scale;
    const p = new THREE.Vector3(Math.cos(a) * r, rnd(0.2, 1.9) * scale, Math.sin(a) * r), d = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
    for (let i = 0; i <= this.seg; i++) {
      pts.push(p.clone());
      d.add(new THREE.Vector3(rnd(-1.2, 1.2), rnd(-1.2, 1.2), rnd(-1.2, 1.2))).normalize();
      p.addScaledVector(d, rnd(0.07, 0.17) * scale);
    }
    this.bolts.push({ pts, life: rnd(0.05, 0.13), w: rnd(0.018, 0.04) * scale });
  }
  update(dt, rate, scale, color, camPos) {
    this.u.uColor.value.copy(color);
    this.acc += dt * rate;
    while (this.acc > 1) { this.acc -= 1; this.spawn(scale); }
    this.bolts = this.bolts.filter(b => (b.life -= dt) > 0);
    this.pos.fill(0);
    const m = this.local.matrixWorld, A = new THREE.Vector3(), B = new THREE.Vector3(), s = new THREE.Vector3(), v = new THREE.Vector3();
    let q = 0;
    for (const b of this.bolts) {
      for (let i = 0; i < this.seg; i++, q++) {
        A.copy(b.pts[i]).applyMatrix4(m); B.copy(b.pts[i + 1]).applyMatrix4(m);
        s.subVectors(B, A).cross(v.subVectors(camPos, A)).normalize().multiplyScalar(b.w);
        this.pos.set([A.x - s.x, A.y - s.y, A.z - s.z, A.x + s.x, A.y + s.y, A.z + s.z, B.x - s.x, B.y - s.y, B.z - s.z, B.x + s.x, B.y + s.y, B.z + s.z], q * 12);
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.visible = this.bolts.length > 0;
  }
}

// ───────── 보호막: 육각 무늬 에너지 막 (충격 때 물결, 빠르게 날면 앞쪽이 달아오름) ─────────
class Shield {
  constructor(parent) {
    this.u = { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uHeat: { value: 0 },
      uVel: { value: new THREE.Vector3(0, 0, 1) }, uHits: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 1, 0, -1)) } };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 40), addMat({
      side: THREE.DoubleSide, uniforms: this.u,
      vertexShader: `varying vec3 vN, vV, vL; varying vec2 vUv;
        void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
          vL = normalize(position); vUv = uv; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform vec3 uColor, uVel; uniform float uTime, uAlpha, uHeat; uniform vec4 uHits[4];
        varying vec3 vN, vV, vL; varying vec2 vUv;
        float hexD(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.732))), p.x); }
        vec4 hexC(vec2 uv){ vec2 r = vec2(1.0, 1.732), h = r * 0.5; vec2 a = mod(uv, r) - h, b = mod(uv - h, r) - h;
          vec2 gv = dot(a, a) < dot(b, b) ? a : b; return vec4(gv, uv - gv); }
        void main(){
          float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          vec4 hx = hexC(vec2(vUv.x * 30.0, vUv.y * 15.0));
          float line = smoothstep(0.07, 0.0, 0.5 - hexD(hx.xy));
          float cell = step(0.94, fract(sin(dot(hx.zw, vec2(12.9898, 78.233)) + floor(uTime * 5.0)) * 43758.5453));
          float scan = exp(-pow((fract(vUv.y * 1.5 - uTime * 0.35) - 0.5) * 24.0, 2.0));
          float rip = 0.0;
          for (int i = 0; i < 4; i++) { vec4 h = uHits[i]; if (h.w >= 0.0 && h.w < 1.0) {
            float d = acos(clamp(dot(vL, h.xyz), -1.0, 1.0)); rip += exp(-pow((d - h.w * 3.3) * 6.0, 2.0)) * (1.0 - h.w); } }
          float heat = pow(max(dot(vL, uVel), 0.0), 5.0) * uHeat;
          float a = (pow(f, 3.5) * 0.7 + line * (0.04 + f * 0.3) + cell * 0.04 + scan * 0.05 * (0.3 + line) + rip * (0.35 + line * 1.2)) * uAlpha + heat * (0.5 + line);
          vec3 col = mix(uColor, vec3(1.0), 0.3 + rip * 0.4);
          col = mix(col, vec3(1.0, 0.72, 0.42), clamp(heat * 1.3, 0.0, 1.0));
          gl_FragColor = vec4(col * a * 0.8, min(a * 0.5, 0.8));` + OUT + `
        }`,
    }));
    this.mesh.scale.set(1.45, 1.75, 1.45);
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this.hitI = 0; this.k = 0; this.color = new THREE.Color(1, 1, 1);
  }
  hit(dirLocal) { const h = this.u.uHits.value[this.hitI++ % 4]; h.set(dirLocal.x, dirLocal.y, dirLocal.z, 0); }
  update(dt, t, k, color, heat, velLocal) {
    this.k += (k - this.k) * (1 - Math.exp(-dt * 4));
    this.color.lerp(color, 1 - Math.exp(-dt * 6));
    const u = this.u;
    u.uTime.value = t; u.uColor.value.copy(this.color); u.uAlpha.value = this.k;
    u.uHeat.value += (heat - u.uHeat.value) * (1 - Math.exp(-dt * 5));
    u.uVel.value.copy(velLocal);
    for (const h of u.uHits.value) if (h.w >= 0) { h.w += dt * 0.9; if (h.w >= 1) h.w = -1; }
    this.mesh.visible = this.k > 0.005 || u.uHeat.value > 0.01;
    const pulse = 1 + 0.015 * Math.sin(t * 3);
    this.mesh.scale.set(1.45 * pulse, 1.75 * pulse, 1.45 * pulse);
  }
}

// ───────── 음속 원뿔: 빠르게 날면 앞에 생기는 충격파 원뿔 + 앞쪽 빛 원반 ─────────
class SonicCone {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.u = { uTime: { value: 0 }, uK: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) } };
    const cone = (L, R, k0) => {
      const pts = [];
      for (let i = 0; i <= 30; i++) { const v = i / 30; pts.push(new THREE.Vector2(0.1 + R * Math.pow(v, 0.5), v * L)); }
      const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), addMat({
        side: THREE.DoubleSide, uniforms: { ...this.u, uMul: { value: k0 } },
        vertexShader: `varying vec3 vN, vV; varying vec2 vUv;
          void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); vUv = uv;
            gl_Position = projectionMatrix * viewMatrix * wp; }`,
        fragmentShader: NOISE + `uniform vec3 uColor; uniform float uTime, uK, uMul; varying vec3 vN, vV; varying vec2 vUv;
          void main(){
            float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
            float v = vUv.y;
            float rings = pow(0.5 + 0.5 * sin(v * 34.0 - uTime * 55.0), 5.0);
            float n = noise(vec3(vUv.x * 12.0, v * 5.0 - uTime * 14.0, uTime * 2.0));
            float a = (pow(f, 1.7) * 0.9 + 0.07 + rings * 0.45 * f) * pow(1.0 - v, 1.4) * (0.5 + 0.7 * n);
            a += smoothstep(0.14, 0.0, v) * 1.4;
            vec3 col = mix(uColor, vec3(1.0), 0.4 + 0.4 * rings);
            gl_FragColor = vec4(col * a * uK * uMul * 0.7, min(a * uK * uMul * 0.55, 0.9));` + OUT + `
          }`,
      }));
      m.frustumCulled = false;
      return m;
    };
    this.group.add(cone(5.5, 1.9, 1.3), cone(9, 3.4, 0.55));
    // 앞쪽 빛 원반 (공기를 밀어내는 면)
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1.25, 48), addMat({
      side: THREE.DoubleSide, uniforms: this.u,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NOISE + `uniform vec3 uColor; uniform float uTime, uK; varying vec2 vP;
        void main(){ float r = length(vP) / 1.25; float a = (exp(-r * r * 6.0) * 1.2 + smoothstep(1.0, 0.75, r) * smoothstep(0.55, 0.95, r) * 0.6)
          * (0.7 + 0.5 * noise(vec3(atan(vP.y, vP.x) * 4.0, r * 3.0 - uTime * 9.0, 0.0)));
          gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.7) * a * uK * 0.8, a * uK * 0.35);` + OUT + `}`,
    }));
    this.disc.rotation.x = Math.PI / 2;
    this.disc.position.y = 0.05;
    this.disc.frustumCulled = false;
    this.group.add(this.disc);
    this.k = 0;
  }
  update(dt, t, k, center, dir, color) {
    this.k += (k - this.k) * (1 - Math.exp(-dt * 6));
    this.u.uTime.value = t; this.u.uK.value = this.k;
    this.u.uColor.value.lerp(color, 1 - Math.exp(-dt * 5));
    this.group.visible = this.k > 0.01;
    if (!this.group.visible) return;
    this.group.position.copy(center).addScaledVector(dir, 1.35);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
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

// ───────── 돌 조각 (튀어 오르거나, 기 모을 때 둥실 떠오름) ─────────
class Rocks {
  constructor(scene, max = 170) {
    this.max = max; this.list = [];
    this.mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0),
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
      this.s.set(r.size, r.size * 0.7, r.size * 0.9).multiplyScalar(Math.max(0.001, fade));
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
export class AwakenFX {
  constructor(scene, character) {
    this.scene = scene; this.ch = character;
    this.local = new THREE.Group();          // 캐릭터 기울기를 따라가는 효과 (발 = y 0)
    this.local.position.y = -character.tilt.position.y;
    character.tilt.add(this.local);
    this.aura = new Aura(this.local);
    this.shield = new Shield(character.tilt);
    this.bolts = new Lightning(scene, this.local);
    this.cone = new SonicCone(scene);
    this.lines = new SpeedLines(scene);
    this.waves = new Shockwaves(scene);
    this.dust = new Particles(scene, 260, false);
    this.sparks = new Particles(scene, 260, true);
    this.rocks = new Rocks(scene);
    this.cracks = new Cracks(scene);
    this.flash = new THREE.PointLight(0xffffff, 0, 30, 1.5);
    scene.add(this.flash);
    this.flashK = 0; this.t = 0; this.floatAcc = 0;
  }

  // 단계가 오를 때: 큰 충격파, 바닥 금·깨진 판, 돌·먼지·불티
  levelUp(level, pos, onGround) {
    const L = LEVELS[level], c = L.color, size = [0, 3.4, 5.2, 7.4, 10.5][level];
    const center = pos.clone().add(new THREE.Vector3(0, 1, 0));
    if (onGround) {
      this.waves.spawn(new THREE.Vector3(pos.x, 0.03, pos.z), new THREE.Vector3(0, 1, 0), size * 1.6, 0.9 + level * 0.12, c, { dust: true, width: 0.35 + level * 0.12 });
      this.waves.spawn(new THREE.Vector3(pos.x, 0.05, pos.z), new THREE.Vector3(0, 1, 0), size * 3, 1.5, c, { shell: false, alpha: 0.35, width: 0.6 });
      this.cracks.spawn(pos.x, pos.z, size, c, level >= 2 ? 4 + level * 4 : 0);
      for (let i = 0; i < 26 + level * 14; i++) {
        const a = rnd(0, 6.28), sp = rnd(4, 9) * (0.7 + level * 0.25);
        this.dust.add({ pos: new THREE.Vector3(pos.x + Math.cos(a) * 0.6, rnd(0.1, 0.4), pos.z + Math.sin(a) * 0.6),
          vel: new THREE.Vector3(Math.cos(a) * sp, rnd(0.3, 2.2), Math.sin(a) * sp), size: rnd(0.5, 1.1), grow: 2.5, life: rnd(1.0, 1.9),
          alpha: 0.55, color: new THREE.Color(0xc4cad3), drag: 2.4 });
      }
      for (let i = 0; i < 8 + level * 7; i++) {
        const a = rnd(0, 6.28), sp = rnd(3, 8) * (0.6 + level * 0.2);
        this.rocks.add({ pos: new THREE.Vector3(pos.x + Math.cos(a) * rnd(0.3, size * 0.3), 0.1, pos.z + Math.sin(a) * rnd(0.3, size * 0.3)),
          vel: new THREE.Vector3(Math.cos(a) * sp * 0.5, rnd(4, 9) * (0.7 + level * 0.15), Math.sin(a) * sp * 0.5), size: rnd(0.05, 0.16) * (0.8 + level * 0.15), life: rnd(3, 5) });
      }
    } else {
      this.waves.spawn(center, new THREE.Vector3(0, 1, 0), size * 1.5, 1.0, c, { width: 0.5 });
    }
    this.rocks.blast(pos, 7 + level * 3);
    for (let i = 0; i < 40 + level * 20; i++) {
      const d = new THREE.Vector3(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize();
      this.sparks.add({ pos: center.clone().addScaledVector(d, 0.4), vel: d.multiplyScalar(rnd(6, 16)), size: rnd(0.06, 0.14), grow: -0.5,
        life: rnd(0.4, 0.9), alpha: 1, color: c.clone(), drag: 3, grav: 4 });
    }
    this.shield.hit(new THREE.Vector3(0, -1, 0));
    this.shield.hit(new THREE.Vector3(rnd(-1, 1), 0, rnd(-1, 1)).normalize());
    this.flash.position.copy(center); this.flash.color.copy(c); this.flashK = 1 + level * 0.5;
    this.ch.burst();
  }

  // 세게 착지: 크기는 충격 세기(0~1)
  impact(pos, k, color) {
    const size = 2.5 + k * 7;
    this.waves.spawn(new THREE.Vector3(pos.x, 0.03, pos.z), new THREE.Vector3(0, 1, 0), size * 1.5, 0.8 + k * 0.5, color, { dust: true, width: 0.4 + k * 0.4 });
    this.cracks.spawn(pos.x, pos.z, size, color, k > 0.35 ? Math.round(4 + k * 12) : 0);
    for (let i = 0; i < 20 + k * 40; i++) {
      const a = rnd(0, 6.28), sp = rnd(3, 9) * (0.6 + k);
      this.dust.add({ pos: new THREE.Vector3(pos.x, rnd(0.1, 0.3), pos.z), vel: new THREE.Vector3(Math.cos(a) * sp, rnd(0.5, 2.5), Math.sin(a) * sp),
        size: rnd(0.5, 1.0), grow: 2.5, life: rnd(0.9, 1.7), alpha: 0.6, color: new THREE.Color(0xc4cad3), drag: 2.4 });
    }
    for (let i = 0; i < 6 + k * 22; i++) {
      const a = rnd(0, 6.28);
      this.rocks.add({ pos: new THREE.Vector3(pos.x + Math.cos(a) * 0.4, 0.1, pos.z + Math.sin(a) * 0.4),
        vel: new THREE.Vector3(Math.cos(a) * rnd(2, 6), rnd(4, 10) * (0.5 + k), Math.sin(a) * rnd(2, 6)), size: rnd(0.05, 0.15), life: rnd(3, 5) });
    }
    this.shield.hit(new THREE.Vector3(0, -1, 0));
    this.flash.position.set(pos.x, 1, pos.z); this.flash.color.copy(color); this.flashK = 0.6 + k;
  }

  // 음속 돌파: 진행 방향에 수직인 큰 고리
  sonicBoom(pos, dir, color) {
    this.waves.spawn(pos.clone().addScaledVector(dir, 1.5), dir, 14, 0.9, color, { width: 0.9 });
    this.waves.spawn(pos.clone(), dir, 7, 0.6, new THREE.Color(1, 1, 1), { shell: false, width: 0.5 });
    this.shield.hit(this.ch.tilt.worldToLocal(pos.clone().add(dir)).normalize());
  }

  // st: { level, chargeK (기 모으는 중 진행 0~1), charging, flying, speed, fast, vel, grounded, pos, camPos, chargeLevel }
  update(dt, st) {
    this.t += dt;
    const t = this.t, L = LEVELS[st.level], next = LEVELS[Math.min(4, st.level + 1)];
    // 오라: 기 모으는 중엔 다음 색 쪽으로 조금씩, 각성 전이라도 모으는 중이면 희미한 하얀 기운
    const color = st.charging ? L.color.clone().lerp(next.color, st.chargeK * 0.35) : L.color;
    let k = st.level ? 0.75 + 0.25 * L.power : 0;
    if (st.charging) k = Math.max(k, 0.25 + st.chargeK * 0.6) * (1 + 0.35 * st.chargeK);
    k *= 1 + st.fast * 0.25;
    const lv = st.level + (st.charging ? st.chargeK : 0);
    this.aura.update(dt, t, {
      k, color, active: Math.min(1, 0.2 + lv * 0.2), ground: st.grounded && !st.flying ? 1 : 0,
      scale: (st.level ? L.scale : 0.75) * (st.charging ? 1 + 0.08 * st.chargeK : 1), power: Math.max(0.45, L.power) * (st.charging ? 1.15 : 1),
    });
    // 번개: 3단계부터 (2단계는 기 모을 때만 가끔)
    const rate = st.level >= 3 ? (st.level === 4 ? 22 : 10) : (st.charging && st.level === 2 ? 4 * st.chargeK : 0);
    this.bolts.update(dt, rate, st.level ? L.scale : 1, color, st.camPos);
    // 보호막
    const velLocal = st.vel.lengthSq() > 1 ? this.ch.tilt.worldToLocal(st.pos.clone().add(new THREE.Vector3(0, 1, 0)).add(st.vel.clone().normalize())).normalize() : new THREE.Vector3(0, 0, 1);
    const coneK = st.flying ? sstep(42, 85, st.speed) : 0;
    this.shield.update(dt, t, st.level ? 0.55 + 0.12 * st.level : (st.charging ? st.chargeK * 0.35 : 0), color, coneK * 1.2, velLocal);
    // 음속 원뿔 + 바람 줄
    const center = st.pos.clone().add(new THREE.Vector3(0, 0.95, 0));
    const dir = st.vel.lengthSq() > 1 ? st.vel.clone().normalize() : new THREE.Vector3(0, 0, 1);
    this.cone.update(dt, t, coneK, center, dir, st.level ? color : new THREE.Color(0.75, 0.88, 1));
    this.lines.update(dt, st.flying ? sstep(25, 80, st.speed) * 0.8 : 0, center, st.vel);
    // 기 모을 때: 돌이 둥실 떠오르고 먼지가 맴돈다
    if (st.charging && st.pos.y < 1.5) {
      this.floatAcc += dt * (5 + st.level * 4 + st.chargeK * 8);
      while (this.floatAcc > 1) {
        this.floatAcc -= 1;
        const a = rnd(0, 6.28), r = rnd(0.9, 3.5);
        this.rocks.add({ pos: new THREE.Vector3(st.pos.x + Math.cos(a) * r, 0.05, st.pos.z + Math.sin(a) * r), vel: new THREE.Vector3(),
          size: rnd(0.04, 0.13), life: 12, floating: true, lift: rnd(0.5, 1.4), top: rnd(0.8, 3.2) });
        if (Math.random() < 0.6) this.dust.add({ pos: new THREE.Vector3(st.pos.x + Math.cos(a) * r * 0.5, 0.1, st.pos.z + Math.sin(a) * r * 0.5),
          vel: new THREE.Vector3(Math.cos(a) * 2.5, 0.2, Math.sin(a) * 2.5), size: rnd(0.4, 0.8), grow: 1.5, life: 1.2, alpha: 0.35, color: new THREE.Color(0xd2d7de) });
      }
    }
    // 불티 (각성 중 몸에서 계속)
    if (st.level && Math.random() < dt * (6 + st.level * 8)) {
      const a = rnd(0, 6.28);
      this.sparks.add({ pos: st.pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.5, rnd(0.2, 1.8), Math.sin(a) * 0.5)),
        vel: new THREE.Vector3(Math.cos(a) * 0.6, rnd(1.5, 3.5), Math.sin(a) * 0.6), size: rnd(0.04, 0.08), life: rnd(0.4, 0.8), alpha: 1, color, drag: 1, grow: -0.6 });
    }
    this.waves.update(dt); this.dust.update(dt); this.sparks.update(dt); this.rocks.update(dt, t); this.cracks.update(dt);
    this.flashK *= Math.exp(-dt * 7);
    this.flash.intensity = this.flashK * 9;
  }
}
