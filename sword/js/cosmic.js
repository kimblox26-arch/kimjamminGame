// SKY BLADE — 행성 폭발 / 초신성 (우주 장면, km 단위, 카메라 기준)
//  행성: 충돌 섬광 → 표면을 가로지르는 균열망(용암빛) → 팽창 → 핵 폭발(불덩이) → 수천 개의 달아오른 파편 + 평면 충격파 고리 + 먼지 구름
//  초신성: 별이 부풀며 깜빡임 → 핵 붕괴(어두워짐) → 눈부신 섬광 → 필라멘트 성운 껍질 + 충격파 구 → 잔해(중성자별)
//  파편/먼지 위치는 정점 셰이더에서 시간으로 계산 → CPU 비용 거의 없음
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

const NOISE = /* glsl */`
float ch31(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float cnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ch31(i), ch31(i + vec3(1,0,0)), f.x), mix(ch31(i + vec3(0,1,0)), ch31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(ch31(i + vec3(0,0,1)), ch31(i + vec3(1,0,1)), f.x), mix(ch31(i + vec3(0,1,1)), ch31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float cfbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * cnoise(p); p = p * 2.07 + 3.1; a *= 0.5; } return s; }
// 보로노이 경계 (균열선)
float vEdge(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(ch31(i + g), ch31(i + g + 13.1), ch31(i + g + 27.7));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}
vec3 heatRamp(float T) {
  T = clamp(T, 0.0, 1.0);
  vec3 c = mix(vec3(0.05, 0.005, 0.0), vec3(0.9, 0.08, 0.01), smoothstep(0.0, 0.25, T));
  c = mix(c, vec3(1.6, 0.45, 0.05), smoothstep(0.2, 0.5, T));
  c = mix(c, vec3(2.6, 1.6, 0.5), smoothstep(0.45, 0.75, T));
  c = mix(c, vec3(5.0, 4.6, 4.0), smoothstep(0.75, 1.0, T));
  return c;
}`;

// ── 균열 오버레이 (행성 표면 위 가산) ──
const SPHERE_VS = /* glsl */`
varying vec3 vN;
varying vec3 vW;
void main() {
  vN = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = 0.5 * gl_Position.w;
}`;
const CRACK_FS = /* glsl */`
${NOISE}
uniform vec3 uImpact;
uniform float uFront;     // 균열 전선 각 (rad)
uniform float uGlow;      // 전체 달아오름
uniform float uTime;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  float ang = acos(clamp(dot(n, uImpact), -1.0, 1.0));
  float e1 = vEdge(n * 6.0 + 1.3), e2 = vEdge(n * 17.0 + 5.1);
  float crack = (1.0 - smoothstep(0.0, 0.06, e1)) + 0.6 * (1.0 - smoothstep(0.0, 0.05, e2));
  float reach = 1.0 - smoothstep(uFront - 0.25, uFront, ang + cfbm(n * 5.0) * 0.4);
  float flick = 0.85 + 0.3 * cnoise(n * 30.0 + uTime * 3.0);
  float hot = crack * reach * flick;
  // 충돌 지점 주변은 녹아 빛나는 용암 바다
  float pool = (1.0 - smoothstep(0.0, 0.35 + uFront * 0.25, ang)) * (0.6 + 0.4 * cfbm(n * 9.0 + uTime));
  vec3 c = heatRamp(0.45 + 0.3 * hot) * hot * 1.3 + heatRamp(0.6) * pool;
  c += vec3(0.9, 0.22, 0.03) * uGlow * (0.15 + crack * 0.6);
  gl_FragColor = vec4(c, 1.0);   // AdditiveBlending 은 src alpha 를 곱함
}`;

// ── 불덩이 (핵 폭발) ──
const FIRE_FS = /* glsl */`
${NOISE}
uniform float uAge;      // 0..1
uniform float uTime;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(-vW);
  float ndv = abs(dot(n, V));
  float turb = cfbm(n * 4.0 + vec3(0.0, uTime * 0.3, 0.0)) * 0.7 + cfbm(n * 13.0 - uTime * 0.5) * 0.3;
  float T = (1.0 - uAge) * (0.55 + 0.6 * turb) + 0.25 * pow(ndv, 3.0) * (1.0 - uAge);
  float a = smoothstep(0.1, 0.5, turb + 0.25 - uAge * 0.6) * (0.35 + 0.65 * pow(ndv, 0.6));
  gl_FragColor = vec4(heatRamp(T) * a * 1.6, 1.0);   // AdditiveBlending 은 src alpha 를 곱함
}`;

// ── 평면 충격파 고리 ──
const RING_VS = /* glsl */`
varying vec2 vP;
void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = 0.5 * gl_Position.w; }`;
const RING_FS = /* glsl */`
${NOISE}
uniform float uAge;
uniform float uTime;
uniform vec3 uTint;
varying vec2 vP;
void main() {
  float r = length(vP);
  float ang = atan(vP.y, vP.x);
  float n = cnoise(vec3(cos(ang) * 6.0, sin(ang) * 6.0, uTime * 0.6));
  float edge = exp(-pow((r - 0.97 + n * 0.02) / 0.025, 2.0));
  float inner = smoothstep(0.35, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r)) * 0.25;
  float streak = pow(cnoise(vec3(cos(ang) * 40.0, sin(ang) * 40.0, r * 3.0)), 3.0) * smoothstep(0.5, 0.97, r);
  float I = (edge * 2.6 + inner + streak * 0.8) * (1.0 - uAge) * (1.0 - uAge);
  vec3 c = mix(uTint, vec3(1.6, 0.8, 0.35), smoothstep(0.85, 0.3, r)) * I;
  gl_FragColor = vec4(c, 1.0);   // AdditiveBlending 은 src alpha 를 곱함
}`;

// ── 파편 (인스턴스, 정점 셰이더에서 비행/회전) ──
const FRAG_VS = /* glsl */`
attribute vec3 aDir;
attribute vec4 aMove;     // x: 속도(반지름/초), y: 크기(반지름 비), z: 회전 속도, w: 냉각률
attribute vec3 aAxis;
uniform float uT;
uniform float uR;         // 행성 반지름 (km)
varying vec3 vNrm;
varying float vHeat;
varying vec3 vPos;
vec3 rotAxis(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
void main() {
  float a = aMove.z * uT;
  vec3 p = rotAxis(position, aAxis, a) * aMove.y * uR;
  vNrm = rotAxis(normal, aAxis, a);
  // 처음엔 빠르게 튀어나오고 점점 일정 속도
  float d = (0.92 + aMove.x * (uT + 0.6 * (1.0 - exp(-uT * 2.0)))) * uR;
  vec3 wp = aDir * d + p;
  vHeat = exp(-uT * aMove.w);
  vPos = (modelMatrix * vec4(wp, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
}`;
const FRAG_FS = /* glsl */`
${NOISE}
uniform vec3 uSun;
uniform vec3 uRock;
varying vec3 vNrm;
varying float vHeat;
varying vec3 vPos;
void main() {
  vec3 n = normalize(vNrm);
  float lit = max(dot(n, uSun), 0.0);
  vec3 c = uRock * (0.04 + lit * 2.2);
  // 갈라진 안쪽 면(핵 쪽)이 달아오름
  float inner = smoothstep(-0.2, 0.6, -dot(n, normalize(vPos)));
  c += heatRamp(vHeat * (0.55 + 0.45 * inner)) * vHeat * (0.4 + inner);
  gl_FragColor = vec4(c, 1.0);
}`;

// ── 먼지/불티 구름 (점) ──
const DUST_VS = /* glsl */`
attribute vec3 aDir;
attribute vec2 aSpd;     // x: 속도, y: 크기
uniform float uT;
uniform float uR;
uniform float uPR;
varying float vA;
varying float vHot;
void main() {
  float d = (0.95 + aSpd.x * uT) * uR;
  vec4 mv = modelViewMatrix * vec4(aDir * d, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = 0.5 * gl_Position.w;
  gl_PointSize = clamp(aSpd.y * uR * 0.02 / max(-mv.z, 1.0) * 800.0, 1.0, 60.0) * uPR;
  vA = exp(-uT * 0.12);
  vHot = exp(-uT * 0.9 * aSpd.x);
}`;
const DUST_FS = /* glsl */`
varying float vA;
varying float vHot;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = exp(-dot(q, q) * 10.0) * vA;
  vec3 c = mix(vec3(0.12, 0.09, 0.07), vec3(2.2, 0.9, 0.25), vHot);
  gl_FragColor = vec4(c * a, 1.0);   // AdditiveBlending 은 src alpha 를 곱함
}`;

// ── 초신성 껍질 (필라멘트 성운) ──
const NEB_FS = /* glsl */`
${NOISE}
uniform float uAge;
uniform float uTime;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(-vW);
  float ndv = abs(dot(n, V));
  float f1 = cfbm(n * 3.0 + uTime * 0.02);
  float fil = 1.0 - smoothstep(0.0, 0.08, abs(cfbm(n * 9.0 + f1 * 2.0) - 0.5));   // 실 같은 필라멘트
  float limb = pow(1.0 - ndv, 1.5);
  vec3 ha = vec3(1.4, 0.18, 0.12), o3 = vec3(0.15, 0.9, 0.85);
  vec3 c = mix(ha, o3, smoothstep(0.35, 0.65, f1)) * (fil * 1.4 + limb * 0.8 + 0.08);
  c += vec3(2.0, 2.2, 2.6) * exp(-pow((1.0 - ndv) / 0.06, 2.0)) * 0.0;   // (충격파는 별도 구)
  float fade = smoothstep(0.0, 0.05, uAge) * (1.0 - smoothstep(0.7, 1.0, uAge));
  gl_FragColor = vec4(c * fade * 0.55, 1.0);   // AdditiveBlending 은 src alpha 를 곱함
}`;
const SHOCK_FS = /* glsl */`
uniform float uAge;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(-vW);
  float ndv = abs(dot(n, V));
  float rim = pow(1.0 - ndv, 6.0);
  vec3 c = vec3(1.2, 1.4, 2.0) * rim * 1.6 * (1.0 - uAge);
  gl_FragColor = vec4(c, 1.0);   // AdditiveBlending 은 src alpha 를 곱함
}`;
const FLASH_VS = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  gl_Position = projectionMatrix * mv;
  gl_Position.z = 0.5 * gl_Position.w;
}`;
const FLASH_FS = /* glsl */`
uniform float uI;
uniform vec3 uCol;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float a = atan(vUv.y, vUv.x);
  float rays = 0.7 + 0.3 * pow(abs(sin(a * 8.0)), 12.0);
  vec3 c = uCol * (exp(-r * 7.0) * 4.0 + exp(-r * 2.2) * 0.6 * rays) * (1.0 - smoothstep(0.85, 1.0, r));
  gl_FragColor = vec4(c * uI, 1.0);   // AdditiveBlending 은 src alpha 를 곱함
}`;

const ADD = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1);

function rockGeometry() {
  let g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const k = 0.7 + 0.5 * Math.abs(Math.sin(_v.x * 5.1 + _v.y * 3.7) * Math.cos(_v.z * 4.3 - _v.x * 2.1));
    p.setXYZ(i, _v.x * k, _v.y * k * 0.8, _v.z * k);
  }
  g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

export class Cosmic {
  constructor(space, hooks, opts = {}) {
    this.space = space;
    this.hooks = hooks || {};
    this.low = opts.quality === 'low';
    this.active = false;
    this.kind = null;
    this.t = 0;
    this.onDone = null;
    this.center = new THREE.Vector3();     // 행성 좌표 (m)
    this.radius = 1;                       // km
    this.impactN = new THREE.Vector3(0, 1, 0);
    this.group = new THREE.Group();
    this.group.visible = false;
    space.scene.add(this.group);
    const sun = space.sunDir || new THREE.Vector3(0, 1, 0);

    // 균열 오버레이
    this.crackU = { uImpact: { value: new THREE.Vector3() }, uFront: { value: 0 }, uGlow: { value: 0 }, uTime: { value: 0 } };
    this.crack = new THREE.Mesh(new THREE.SphereGeometry(1.004, 128, 64), new THREE.ShaderMaterial({ vertexShader: SPHERE_VS, fragmentShader: CRACK_FS, uniforms: this.crackU, depthTest: false, ...ADD }));
    // 불덩이
    this.fireU = { uAge: { value: 0 }, uTime: { value: 0 } };
    this.fire = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), new THREE.ShaderMaterial({ vertexShader: SPHERE_VS, fragmentShader: FIRE_FS, uniforms: this.fireU, depthTest: false, ...ADD }));
    // 충격파 고리 (두 겹)
    this.ringU = { uAge: { value: 0 }, uTime: { value: 0 }, uTint: { value: new THREE.Color(1.2, 1.5, 2.4) } };
    this.ring = new THREE.Mesh(new THREE.CircleGeometry(1, 256), new THREE.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, uniforms: this.ringU, depthTest: false, side: THREE.DoubleSide, ...ADD }));
    this.ring2U = { uAge: { value: 0 }, uTime: { value: 0 }, uTint: { value: new THREE.Color(2.0, 1.1, 0.5) } };
    this.ring2 = new THREE.Mesh(this.ring.geometry, new THREE.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, uniforms: this.ring2U, depthTest: false, side: THREE.DoubleSide, ...ADD }));
    // 섬광
    this.flashU = { uI: { value: 0 }, uCol: { value: new THREE.Color(1.0, 0.85, 0.65) } };
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: FLASH_VS, fragmentShader: FLASH_FS, uniforms: this.flashU, depthTest: false, ...ADD }));

    // 파편
    const N = this.low ? 900 : 2600;
    const base = rockGeometry();
    const g = new THREE.InstancedBufferGeometry();
    g.index = null;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('normal', base.attributes.normal);
    const dir = new Float32Array(N * 3), mv = new Float32Array(N * 4), ax = new Float32Array(N * 3);
    let seed = 777;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      _v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
      dir.set([_v.x, _v.y, _v.z], i * 3);
      const big = Math.pow(rnd(), 3.0);
      mv.set([0.08 + 0.35 * rnd() * (1.2 - big), 0.006 + 0.07 * big, (rnd() - 0.5) * 1.5, 0.08 + 0.25 * rnd()], i * 4);
      _v.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      ax.set([_v.x, _v.y, _v.z], i * 3);
    }
    g.setAttribute('aDir', new THREE.InstancedBufferAttribute(dir, 3));
    g.setAttribute('aMove', new THREE.InstancedBufferAttribute(mv, 4));
    g.setAttribute('aAxis', new THREE.InstancedBufferAttribute(ax, 3));
    g.instanceCount = N;
    this.fragU = { uT: { value: 0 }, uR: { value: 1 }, uSun: { value: sun }, uRock: { value: new THREE.Color(0.22, 0.17, 0.13) } };
    this.frags = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: FRAG_VS, fragmentShader: FRAG_FS, uniforms: this.fragU, depthTest: true, depthWrite: true }));
    this.frags.frustumCulled = false;
    // 먼지/불티
    const D = this.low ? 3000 : 9000;
    const dg = new THREE.BufferGeometry();
    const dd = new Float32Array(D * 3), ds = new Float32Array(D * 2);
    for (let i = 0; i < D; i++) {
      _v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
      dd.set([_v.x, _v.y, _v.z], i * 3);
      ds.set([0.05 + 0.5 * Math.pow(rnd(), 1.5), 0.2 + rnd() * 1.5], i * 2);
    }
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(D * 3), 3));
    dg.setAttribute('aDir', new THREE.BufferAttribute(dd, 3));
    dg.setAttribute('aSpd', new THREE.BufferAttribute(ds, 2));
    this.dustU = { uT: { value: 0 }, uR: { value: 1 }, uPR: { value: 1 } };
    this.dust = new THREE.Points(dg, new THREE.ShaderMaterial({ vertexShader: DUST_VS, fragmentShader: DUST_FS, uniforms: this.dustU, depthTest: false, ...ADD }));
    this.dust.frustumCulled = false;

    // 초신성
    this.nebU = { uAge: { value: 0 }, uTime: { value: 0 } };
    this.neb = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), new THREE.ShaderMaterial({ vertexShader: SPHERE_VS, fragmentShader: NEB_FS, uniforms: this.nebU, depthTest: false, side: THREE.DoubleSide, ...ADD }));
    this.shockU = { uAge: { value: 0 } };
    this.shock = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), new THREE.ShaderMaterial({ vertexShader: SPHERE_VS, fragmentShader: SHOCK_FS, uniforms: this.shockU, depthTest: false, ...ADD }));

    for (const m of [this.crack, this.fire, this.ring, this.ring2, this.flash, this.frags, this.dust, this.neb, this.shock]) {
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = 50;
      this.group.add(m);
    }
    this.frags.renderOrder = 45;
    this.flash.renderOrder = 60;
  }

  explode(name, impactDirPlanet) {
    const b = this.space.bodies[name];
    if (!b || (this.active && this.kind === 'planet' && this.body === name)) return;
    this.reset(false);
    this.active = true;
    this.kind = 'planet';
    this.body = name;
    this.t = 0;
    this.boomed = false;
    this.doneFired = false;
    this.center.copy(b.center);
    this.radius = b.radius;
    // 진행 방향의 반대 = 충돌 지점 바깥 법선
    this.impactN.copy(impactDirPlanet).normalize().negate();
    this.crackU.uImpact.value.copy(this.impactN);
    this.fragU.uRock.value.set(name === 'moon' ? 0.3 : 0.22, name === 'moon' ? 0.29 : 0.16, name === 'moon' ? 0.28 : 0.12);
    this.group.visible = true;
    this.crack.visible = true;
    this.flash.visible = true;
    this.hooks.flash && this.hooks.flash(0.9);
    this.hooks.shake && this.hooks.shake(1);
  }

  supernova() {
    if (this.active && this.kind === 'nova') return;
    this.reset(false);
    const b = this.space.bodies.sun;
    this.active = true;
    this.kind = 'nova';
    this.body = 'sun';
    this.t = 0;
    this.boomed = false;
    this.doneFired = false;
    this.flashU.uCol.value.setRGB(1.0, 0.85, 0.65);
    this.center.copy(b.center);
    this.radius = b.radius;
    this.group.visible = true;
    this.flash.visible = true;
    this.hooks.flash && this.hooks.flash(0.6);
  }

  reset(showBodies = true) {
    this.active = false;
    this.kind = null;
    this.group.visible = false;
    for (const m of this.group.children) m.visible = false;
    if (showBodies) {
      for (const n of ['earth', 'moon', 'sun']) this.space.setBodyVisible(n, true);
      const s = this.space.bodies.sun.group;
      s.scale.setScalar(1);
      if (this.space.sunUniforms) this.space.sunUniforms.uI.value = 1;
    }
  }

  // 연출용 카메라 제안 (행성 좌표, m)
  cameraHint(out) {
    out.active = this.active;
    if (!this.active) return out;
    const R = this.radius * 1000, t = this.t;
    // 충돌 지점을 옆에서 보도록: 충돌 법선에 수직인 방향 + 약간 위
    _v.set(0, 1, 0);
    if (Math.abs(_v.dot(this.impactN)) > 0.9) _v.set(1, 0, 0);
    _c.crossVectors(this.impactN, _v).normalize();
    const orbit = t * 0.035;
    const dist = this.kind === 'nova' ? R * (40 + t * 6) : R * (4.2 + Math.max(0, t - 3.8) * 1.1);
    out.planetPosMeters.copy(this.impactN).multiplyScalar(Math.cos(0.9 + orbit)).addScaledVector(_c, Math.sin(0.9 + orbit)).addScaledVector(_v, 0.35).normalize().multiplyScalar(dist).add(this.center);
    out.lookAtPlanetMeters.copy(this.center);
    return out;
  }

  update(dt, camAbs) {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    const sp = this.space;
    sp.toCamera(this.center, this.group.position);
    const R = this.radius;
    for (const u of [this.crackU, this.fireU, this.ringU, this.ring2U, this.nebU]) if (u.uTime) u.uTime.value = t;
    this.dustU.uPR.value = sp.renderer ? sp.renderer.getPixelRatio() : 1;
    if (this.kind === 'planet') this._planet(dt, t, R);
    else this._nova(dt, t, R);
  }

  _planet(dt, t, R) {
    const TB = 3.8;                      // 폭발 시각
    const bodyG = this.space.bodies[this.body].group;
    // 섬광: 충돌 지점
    this.flash.position.copy(this.impactN).multiplyScalar(R * 1.01);
    const fl = t < TB ? Math.exp(-t * 2.5) * 1.2 + smooth(TB - 0.6, TB, t) * 1.5 : Math.exp(-(t - TB) * 1.8) * 3;
    this.flashU.uI.value = fl;
    const fs = t < TB ? R * (0.3 + t * 0.15) : R * (2.5 + (t - TB) * 1.2);
    this.flash.scale.set(fs, fs, 1);
    if (t >= TB) this.flash.position.set(0, 0, 0);
    if (!this.boomed) {
      // 균열이 퍼지고 행성이 부풀어 오름
      this.crackU.uFront.value = Math.min(Math.PI * 1.1, t * 0.95);
      this.crackU.uGlow.value = smooth(1.5, TB, t) * 1.5;
      const bulge = 1 + 0.045 * smooth(2.4, TB, t) + 0.006 * Math.sin(t * 40) * smooth(2.8, TB, t);
      this.crack.scale.setScalar(R * bulge);
      bodyG.scale.setScalar(bulge);
      if (t > 2.0 && this.hooks.shake) this.hooks.shake(0.04);
      if (t >= TB) {
        this.boomed = true;
        bodyG.scale.setScalar(1);
        this.space.setBodyVisible(this.body, false);
        this.crack.visible = false;
        this.fire.visible = this.ring.visible = this.ring2.visible = this.frags.visible = this.dust.visible = true;
        // 고리 평면: 충돌 축에 수직
        _q.setFromUnitVectors(_z, this.impactN);
        this.ring.quaternion.copy(_q);
        _v.copy(this.impactN).applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
        this.ring2.quaternion.setFromUnitVectors(_z, _v.normalize());
        this.hooks.flash && this.hooks.flash(1);
        this.hooks.shake && this.hooks.shake(1);
      }
      return;
    }
    const tb = t - TB;
    // 불덩이: 빠르게 커지며 식음
    const fa = clamp(tb / 7, 0, 1);
    this.fireU.uAge.value = fa;
    this.fire.scale.setScalar(R * (0.9 + 1.1 * (1 - Math.exp(-tb * 0.8))));
    this.fire.visible = fa < 1;
    // 충격파 고리
    const ra = clamp(tb / 9, 0, 1);
    this.ringU.uAge.value = ra;
    this.ring.scale.setScalar(R * (1.1 + tb * 1.6));
    this.ring.visible = ra < 1;
    const ra2 = clamp(tb / 6, 0, 1);
    this.ring2U.uAge.value = ra2;
    this.ring2.scale.setScalar(R * (1.0 + tb * 0.9));
    this.ring2.visible = ra2 < 1;
    // 파편 / 먼지
    this.fragU.uT.value = tb; this.fragU.uR.value = R;
    this.dustU.uT.value = tb; this.dustU.uR.value = R;
    if (tb > 14 && !this.doneFired) { this.doneFired = true; if (this.onDone) this.onDone(this.body); }
  }

  _nova(dt, t, R) {
    const sunG = this.space.bodies.sun.group;
    const su = this.space.sunUniforms;
    const T1 = 2.2, T2 = 3.2;            // 붕괴 시작, 폭발
    if (t < T1) {
      // 부풀며 불안정하게 깜빡임
      const k = 1 + 0.6 * smooth(0, T1, t);
      sunG.scale.setScalar(k);
      if (su) su.uI.value = 1 + 0.8 * Math.sin(t * 23) * Math.sin(t * 7.1) * smooth(0.3, T1, t);
      this.flashU.uI.value = 0.35 * smooth(0, T1, t);
      this.flash.scale.setScalar(R * 6);
    } else if (t < T2) {
      // 핵 붕괴: 급격히 작아지고 어두워짐
      const k = THREE.MathUtils.lerp(1.6, 0.25, smooth(T1, T2, t));
      sunG.scale.setScalar(k);
      if (su) su.uI.value = THREE.MathUtils.lerp(1.5, 0.15, smooth(T1, T2, t));
      this.flashU.uI.value = 0.2;
    } else {
      if (!this.boomed) {
        this.boomed = true;
        this.space.setBodyVisible('sun', false);
        this.neb.visible = this.shock.visible = this.dust.visible = true;
        this.hooks.flash && this.hooks.flash(1);
        this.hooks.shake && this.hooks.shake(1);
      }
      const tb = t - T2;
      this.flashU.uCol.value.setRGB(0.85, 0.9, 1.0);
      this.flashU.uI.value = Math.exp(-tb * 0.9) * 4 + 0.12;
      this.flash.scale.setScalar(R * (30 + tb * 10));
      const age = clamp(tb / 22, 0, 1);
      this.nebU.uAge.value = age;
      this.neb.scale.setScalar(R * (2 + tb * 4.5));
      this.shockU.uAge.value = clamp(tb / 12, 0, 1);
      this.shock.scale.setScalar(R * (3 + tb * 7.5));
      this.shock.visible = tb < 12;
      this.dustU.uT.value = tb * 2.5; this.dustU.uR.value = R * 3;
      if (tb > 16 && !this.doneFired) { this.doneFired = true; if (this.onDone) this.onDone('sun'); }
    }
  }
}
