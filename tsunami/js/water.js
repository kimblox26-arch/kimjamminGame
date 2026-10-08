// 수면 렌더링: 천수방정식 결과(수위·유속·거품·흙탕물)로 변위되는 물 + 원경 바다
import * as THREE from 'three';
import { WORLD, HALF } from './config.js';

const COMMON = /* glsl */`
uniform float uTime;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
// 바람 파랑(분산 관계 ω=√(gk)) — 높이와 기울기
float windWaves(vec2 p, float t, out vec2 grad) {
  float hsum = 0.0; grad = vec2(0.0);
  const int NW = 6;
  vec3 W[NW];
  W[0] = vec3(0.92, 0.38, 0.055); W[1] = vec3(0.7, 0.71, 0.09); W[2] = vec3(0.99, -0.12, 0.14);
  W[3] = vec3(0.4, 0.92, 0.21); W[4] = vec3(0.85, -0.52, 0.33); W[5] = vec3(0.6, 0.8, 0.52);
  float A[NW]; A[0] = 0.32; A[1] = 0.2; A[2] = 0.13; A[3] = 0.08; A[4] = 0.05; A[5] = 0.03;
  for (int i = 0; i < NW; i++) {
    vec2 d = normalize(W[i].xy); float k = W[i].z; float w = sqrt(9.81 * k);
    float ph = dot(d, p) * k - w * t + float(i) * 1.7;
    hsum += A[i] * sin(ph);
    grad += A[i] * k * cos(ph) * d;
  }
  return hsum;
}
`;

const VERT = /* glsl */`
${COMMON}
uniform sampler2D tW; uniform sampler2D tF;
uniform float uN; uniform float uDx; uniform float uHalf;
varying vec3 vW; varying float vDepth; varying vec2 vVel; varying float vFoam; varying float vMud; varying vec3 vNrm; varying float vSteep;
#include <fog_pars_vertex>
vec4 fetchW(ivec2 c) { c = clamp(c, ivec2(0), ivec2(int(uN) - 1)); return texelFetch(tW, c, 0); }
vec4 fetchF(ivec2 c) { c = clamp(c, ivec2(0), ivec2(int(uN) - 1)); return texelFetch(tF, c, 0); }
vec4 sampleW(vec2 xz) {
  vec2 g = (xz + uHalf) / uDx - 0.5; ivec2 i0 = ivec2(floor(g)); vec2 f = g - floor(g);
  return mix(mix(fetchW(i0), fetchW(i0 + ivec2(1,0)), f.x), mix(fetchW(i0 + ivec2(0,1)), fetchW(i0 + ivec2(1,1)), f.x), f.y);
}
vec4 sampleF(vec2 xz) {
  vec2 g = (xz + uHalf) / uDx - 0.5; ivec2 i0 = ivec2(floor(g)); vec2 f = g - floor(g);
  return mix(mix(fetchF(i0), fetchF(i0 + ivec2(1,0)), f.x), mix(fetchF(i0 + ivec2(0,1)), fetchF(i0 + ivec2(1,1)), f.x), f.y);
}
void main() {
  vec3 p = position;
  vec2 xz = p.xz;
#ifdef FAR
  float eta = 0.0; float depth = 80.0; vec2 vel = vec2(0.0); float foam = 0.0; float mud = 0.0; vec2 sg = vec2(0.0);
#else
  vec4 s = sampleW(xz);
  float eta = s.x; float depth = s.y; vec2 vel = s.zw;
  vec4 fm = sampleF(xz); float foam = fm.r; float mud = fm.g;
  float e = uDx * 0.9;
  float ex1 = sampleW(xz + vec2(e, 0.0)).x, ex0 = sampleW(xz - vec2(e, 0.0)).x;
  float ez1 = sampleW(xz + vec2(0.0, e)).x, ez0 = sampleW(xz - vec2(0.0, e)).x;
  vec2 sg = vec2(ex1 - ex0, ez1 - ez0) / (2.0 * e);
  sg = clamp(sg, vec2(-3.0), vec2(3.0));
#endif
  vec2 wg;
  float calm = clamp(depth / 4.0, 0.0, 1.0) * (1.0 - 0.75 * mud) * (1.0 - clamp(length(vel) / 6.0, 0.0, 0.85));
  float ww = windWaves(xz, uTime, wg) * calm;
  // 고속 흐름의 난류 요철
  float turb = (vnoise(xz * 0.07 - vel * uTime * 0.07) - 0.5) * clamp(length(vel) * 0.18, 0.0, 1.0) * clamp(depth, 0.0, 1.5) * 0.9;
  float y = eta + ww + turb;
  vec3 wpos = vec3(xz.x, y, xz.y);
  vW = wpos; vDepth = depth; vVel = vel; vFoam = foam; vMud = mud;
  vec2 tg = sg + wg * calm;
  vNrm = normalize(vec3(-tg.x, 1.0, -tg.y));
  vSteep = length(sg);
  vec4 mvPosition = viewMatrix * vec4(wpos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
${COMMON}
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uHorizon; uniform vec3 uZenith; uniform float uLight; uniform float uUnder;
varying vec3 vW; varying float vDepth; varying vec2 vVel; varying float vFoam; varying float vMud; varying vec3 vNrm; varying float vSteep;
#include <fog_pars_fragment>
vec2 detailGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  float a = 0.5, f = 0.35;
  for (int i = 0; i < 4; i++) {
    float e = 0.07 / f;
    vec2 q = p * f + vec2(t * 0.3 * f, t * 0.21 * f) * 3.0;
    float n0 = vnoise(q), nx = vnoise(q + vec2(0.07, 0.0)), nz = vnoise(q + vec2(0.0, 0.07));
    g += a * vec2(nx - n0, nz - n0) / 0.07;
    a *= 0.55; f *= 2.13;
  }
  return g;
}
void main() {
  float depth = vDepth;
  vec2 vel = vVel; float spd = length(vel);
  // 흐름을 따라 움직이는 미세 물결 (플로우맵 2위상)
  float ph0 = fract(uTime * 0.2), ph1 = fract(uTime * 0.2 + 0.5);
  float wb = abs(1.0 - 2.0 * ph0);
  vec2 g0 = detailGrad(vW.xz - vel * ph0 * 5.0, uTime);
  vec2 g1 = detailGrad(vW.xz - vel * ph1 * 5.0 + 37.0, uTime);
  vec2 dg = mix(g0, g1, wb) * (0.14 + 0.35 * clamp(spd * 0.15, 0.0, 1.0) + 0.2 * vMud);
  vec3 N = normalize(vNrm + vec3(-dg.x, 0.0, -dg.y));
  vec3 V = normalize(cameraPosition - vW);
  bool under = !gl_FrontFacing;
  if (under) N = -N;
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.5));
  float sd = max(dot(R, uSunDir), 0.0);
  vec3 spec = uSunColor * (pow(sd, 900.0) * 40.0 + pow(sd, 90.0) * 0.6) * step(0.0, uSunDir.y);
  // 수체 색: 깊이 감쇠 + 흙탕물
  float dT = 1.0 - exp(-depth * 0.22);
  vec3 shallow = vec3(0.07, 0.36, 0.36), deep = vec3(0.012, 0.06, 0.095);
  vec3 muddy = mix(vec3(0.30, 0.24, 0.15), vec3(0.17, 0.13, 0.08), clamp(depth * 0.25, 0.0, 1.0));
  vec3 body = mix(shallow, deep, dT);
  body = mix(body, muddy, clamp(vMud * 1.15, 0.0, 1.0));
  float sunUp = clamp(uSunDir.y * 2.5, 0.0, 1.0);
  vec3 lit = body * (0.3 + 0.7 * sunUp) * uLight;
  // 파봉 투과광 (서브서피스)
  float sss = pow(clamp(dot(V, -uSunDir) * 0.5 + 0.5, 0.0, 1.0), 3.0) * clamp(vSteep * 1.5 + max(vW.y, 0.0) * 0.05, 0.0, 1.0);
  lit += vec3(0.05, 0.32, 0.28) * sss * (1.0 - vMud) * uLight;
  vec3 col = mix(lit, sky * uLight, F * (1.0 - vMud * 0.5)) + spec * (1.0 - clamp(vFoam, 0.0, 1.0));
  // 거품: 쇄파·고속 흐름·해안선
  float fn = vnoise(vW.xz * 0.45 - vel * uTime * 0.45) * 0.6 + vnoise(vW.xz * 1.7 + uTime * 0.3) * 0.4;
  float foamAmt = clamp(vFoam, 0.0, 1.2);
  // 평상시 파도 거품 띠 (수심 등고선을 따라 해안 쪽으로 이동)
  float surf = pow(0.5 + 0.5 * sin(depth * 4.5 + uTime * 1.6 + vnoise(vW.xz * 0.05) * 6.0), 6.0) * (1.0 - smoothstep(0.2, 2.2, depth)) * step(0.05, depth);
  foamAmt = max(foamAmt, surf * 0.8);
  float fm = smoothstep(0.35, 0.75, fn * foamAmt + foamAmt * 0.35);
  vec3 foamCol = mix(vec3(0.93, 0.95, 0.96), vec3(0.62, 0.55, 0.45), vMud * 0.7) * (0.35 + 0.65 * sunUp) * uLight;
  col = mix(col, foamCol, fm);
  float alpha = clamp(1.0 - exp(-depth * 1.6 - vMud * depth * 5.0), 0.0, 1.0);
  alpha = max(alpha, fm * clamp(depth * 4.0, 0.0, 1.0));
  if (under) { col = mix(vec3(0.05, 0.12, 0.12), vec3(0.16, 0.13, 0.08), vMud) * uLight + sky * 0.15 * F; alpha = 0.92; }
#ifdef FAR
  alpha = 1.0;
#endif
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class WaterSurface {
  constructor(sim) {
    this.sim = sim;
    const N = sim.N;
    this.texW = new THREE.DataTexture(sim.texW, N, N, THREE.RGBAFormat, THREE.FloatType);
    this.texW.minFilter = this.texW.magFilter = THREE.NearestFilter;
    this.texW.needsUpdate = true;
    this.texF = new THREE.DataTexture(sim.texF, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texF.minFilter = this.texF.magFilter = THREE.NearestFilter;
    this.texF.needsUpdate = true;
    this.texFlood = new THREE.DataTexture(sim.texFlood, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texFlood.minFilter = this.texFlood.magFilter = THREE.LinearFilter;
    this.texFlood.needsUpdate = true;

    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, tW: { value: null }, tF: { value: null },
      uN: { value: N }, uDx: { value: sim.dx }, uHalf: { value: HALF },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) },
      uHorizon: { value: new THREE.Color(0.7, 0.8, 0.9) }, uZenith: { value: new THREE.Color(0.25, 0.45, 0.75) },
      uLight: { value: 1 }, uUnder: { value: 0 },
    }]);
    this.uniforms.tW.value = this.texW;
    this.uniforms.tF.value = this.texF;

    const mk = (defines) => new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, defines,
      transparent: true, side: THREE.DoubleSide, fog: true, depthWrite: true,
    });
    this.material = mk({});
    this.farMaterial = mk({ FAR: '' });
    this.farMaterial.transparent = false;

    const geo = gridGeometry(N + 1, WORLD);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;

    // 원경 바다: 영역을 둘러싼 액자형 격자
    const fg = frameGeometry(HALF, 30000);
    this.far = new THREE.Mesh(fg, this.farMaterial);
    this.far.frustumCulled = false;
    this.far.renderOrder = 1;
  }

  update(time, sky) {
    const u = this.uniforms;
    u.uTime.value = time;
    if (this.sim.texDirty) {
      this.texW.needsUpdate = true;
      this.texF.needsUpdate = true;
      this.sim.texDirty = false;
      this.floodTick = (this.floodTick || 0) + 1;
      if (this.floodTick % 4 === 0) this.texFlood.needsUpdate = true;
    }
    if (sky) {
      u.uSunDir.value.copy(sky.sunDirection);
      u.uSunColor.value.copy(sky.sunColor);
      u.uHorizon.value.copy(sky.horizonColor);
      u.uZenith.value.setHSL(0.6, 0.55, 0.12 + 0.35 * sky.dayFactor);
      u.uLight.value = 0.12 + 0.88 * sky.dayFactor;
    }
  }
}

function gridGeometry(R, size) {
  const pos = new Float32Array(R * R * 3);
  const c = size / (R - 1);
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const k = (j * R + i) * 3;
    pos[k] = -size / 2 + i * c; pos[k + 1] = 0; pos[k + 2] = -size / 2 + j * c;
  }
  const idx = new Uint32Array((R - 1) * (R - 1) * 6);
  let n = 0;
  for (let j = 0; j < R - 1; j++) for (let i = 0; i < R - 1; i++) {
    const a = j * R + i, b = a + R, cc = b + 1, d = a + 1;
    idx[n++] = a; idx[n++] = b; idx[n++] = d; idx[n++] = b; idx[n++] = cc; idx[n++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** 안쪽 정사각 구멍(±inner)과 바깥(±outer) 사이를 채우는 격자 */
function frameGeometry(inner, outer) {
  const xs = [-outer, -inner * 3, -inner * 1.5, -inner, -inner / 2, 0, inner / 2, inner, inner * 1.5, inner * 3, outer];
  const n = xs.length;
  const pos = [], idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.push(xs[i], 0, xs[j]);
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const x0 = xs[i], x1 = xs[i + 1], z0 = xs[j], z1 = xs[j + 1];
    if (x0 >= -inner && x1 <= inner && z0 >= -inner && z1 <= inner) continue;
    const a = j * n + i, b = a + n, c = b + 1, d = a + 1;
    idx.push(a, b, d, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
