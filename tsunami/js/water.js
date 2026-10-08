// 수면 렌더링: 천수방정식 결과(수위·유속·거품·흙탕물)로 변위되는 물 + 원경 바다
import * as THREE from 'three';
import { WORLD, HALF } from './config.js';

const COMMON = /* glsl */`
uniform float uTime;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
// 셀룰러(워리) 잡음: 가장 가까운 두 점 거리 차 → 거품 레이스 무늬
float worley(vec2 p) {
  vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y)); vec2 r = o + vec2(hash12(i + o), hash12(i + o + 17.3)) - f;
    float d = dot(r, r); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(d2) - sqrt(d1);
}
// 너울: 주기 9 s, 수심 등고선을 따라 해안으로 진행 (얕은물 분산 k = ω/√(gh), 해저 경사 약 3%)
// 위상 θ = ωt − 2ω√h/(m√g) + 연안 방향 변화. 반환: x 위상, y 수심 한계 쇄파 지수 H/(0.78h)
const float SW_OM = 0.698, SW_H0 = 0.55;
vec2 swellPhase(float h, vec2 xz, float t) {
  float th = SW_OM * t - 14.9 * sqrt(max(h, 0.0)) + vnoise(xz * 0.0035) * 5.0 + xz.x * 0.0015;
  float H = SW_H0 * pow(8.0 / max(h, 0.3), 0.25);
  return vec2(th, H / (0.78 * max(h, 0.05)));
}
// 파형: 얕아질수록 파봉이 뾰족해지고(골은 평평), 부서지면 앞면이 급한 톱니(보어)
float swellShape(float th, float beta) {
  float s = fract(th / 6.2831853);
  float peaked = pow(0.5 + 0.5 * cos(th), 1.0 + 2.5 * clamp(beta, 0.0, 1.0)) - 0.35;
  float bore = (s < 0.85 ? s / 0.85 : (1.0 - s) / 0.15); bore = bore * bore - 0.4;
  return mix(peaked, bore, smoothstep(0.85, 1.15, beta));
}
// 바람 파랑(분산 관계 ω=√(gk)) — 높이와 기울기
// spacing: 정점 간격 — 격자가 표현할 수 없는 짧은 파는 감쇠 (에일리어싱 방지)
float windWaves(vec2 p, float t, float spacing, out vec2 grad) {
  float hsum = 0.0; grad = vec2(0.0);
  const int NW = 6;
  vec3 W[NW];
  W[0] = vec3(0.92, 0.38, 0.055); W[1] = vec3(0.7, 0.71, 0.09); W[2] = vec3(0.99, -0.12, 0.14);
  W[3] = vec3(0.4, 0.92, 0.21); W[4] = vec3(0.85, -0.52, 0.33); W[5] = vec3(0.6, 0.8, 0.52);
  float A[NW]; A[0] = 0.32; A[1] = 0.2; A[2] = 0.13; A[3] = 0.08; A[4] = 0.05; A[5] = 0.03;
  for (int i = 0; i < NW; i++) {
    vec2 d = normalize(W[i].xy); float k = W[i].z; float w = sqrt(9.81 * k);
    float ph = dot(d, p) * k - w * t + float(i) * 1.7;
    float a = A[i] * (1.0 - smoothstep(0.25, 0.5, k * spacing / 3.14159));
    hsum += a * sin(ph);
    grad += a * k * cos(ph) * d;
  }
  return hsum;
}
`;

const VERT = /* glsl */`
${COMMON}
uniform sampler2D tW; uniform sampler2D tWp; uniform sampler2D tF; uniform float uBlend;
uniform float uN; uniform float uDx; uniform float uHalf;
varying vec3 vW; varying float vDepth; varying vec2 vVel; varying float vFoam; varying float vMud; varying vec3 vNrm; varying float vSteep;
varying float vSurf; varying float vSwash;
#include <fog_pars_vertex>
vec4 fetchW(ivec2 c) { c = clamp(c, ivec2(0), ivec2(int(uN) - 1)); return mix(texelFetch(tWp, c, 0), texelFetch(tW, c, 0), uBlend); }
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
  vec4 sx1 = sampleW(xz + vec2(e, 0.0)), sx0 = sampleW(xz - vec2(e, 0.0));
  vec4 sz1 = sampleW(xz + vec2(0.0, e)), sz0 = sampleW(xz - vec2(0.0, e));
  float ex1 = sx1.x, ex0 = sx0.x, ez1 = sz1.x, ez0 = sz0.x;
  vec2 sg = vec2(ex1 - ex0, ez1 - ez0) / (2.0 * e);
  vec2 dgr = vec2(sx1.y - sx0.y, sz1.y - sz0.y) / (2.0 * e);   // 수심 기울기 (해안 쪽 = 감소 방향)
  sg = clamp(sg, vec2(-3.0), vec2(3.0));
#endif
  vec2 wg;
  float calm = clamp(depth / 4.0, 0.0, 1.0) * (1.0 - 0.75 * mud) * (1.0 - clamp(length(vel) / 6.0, 0.0, 0.85));
  // 영역 경계에서는 원경 바다(평면)와 높이가 맞도록 파랑을 0으로
  calm *= 1.0 - smoothstep(uHalf - 3.0 * uDx, uHalf - uDx, max(abs(xz.x), abs(xz.y)));
#ifdef FAR
  calm = 0.0;
#endif
  float ww = windWaves(xz, uTime, uDx, wg) * calm;
  // 고속 흐름의 난류 요철 (유한한 2위상 이류: 시간이 지나도 위상차가 커지지 않음)
  float tp0 = fract(uTime * 0.12), tp1 = fract(uTime * 0.12 + 0.5), tw = abs(1.0 - 2.0 * tp0);
  float tn = mix(vnoise(xz * 0.07 - vel * tp1 * 0.5 + 7.3), vnoise(xz * 0.07 - vel * tp0 * 0.5), tw);
  float turb = (tn - 0.5) * clamp(length(vel) * 0.18, 0.0, 1.0) * clamp(depth, 0.0, 1.5) * 0.9;
  float y = eta + ww + turb;
  vec3 wpos = vec3(xz.x, y, xz.y);
  float surfFoam = 0.0, swash = 0.0;
  vec2 swg = vec2(0.0);
#ifndef FAR
  // 해안 너울: 천수(쇼알링) → 쇄파 → 백파(보어). 쓰나미 흐름·흙탕물에서는 약해짐
  float quiet = (1.0 - clamp(length(vel) / 2.5, 0.0, 1.0)) * (1.0 - mud);
  if (depth > 0.04 && depth < 9.0 && quiet > 0.01) {
    vec2 sp = swellPhase(depth, xz, uTime);
    float beta = sp.y;
    float H = min(SW_H0 * pow(8.0 / max(depth, 0.3), 0.25), 0.78 * depth) * (1.0 - smoothstep(6.0, 9.0, depth)) * quiet;
    if (beta > 1.0) H *= mix(1.0, 0.65, smoothstep(1.0, 1.6, beta));         // 부서진 뒤 에너지 소산
    float sh = swellShape(sp.x, beta);
    float sh2 = swellShape(sp.x + 0.12, beta);
    y += H * sh;
    // 진행 방향(수심 감소 방향)으로 파봉 앞쏠림 (트로코이드)
    vec2 dir = -dgr / max(length(dgr), 1e-4);
    wpos.xz += dir * H * 0.35 * sin(sp.x);
    swg = dir * H * (sh2 - sh) / 0.12 * 0.8;
    float s = fract(sp.x / 6.2831853);
    surfFoam = smoothstep(0.85, 1.05, beta) * (smoothstep(0.7, 0.95, s) * (1.0 - smoothstep(0.97, 1.0, s)) + 0.55 * exp(-s * 5.0)) + smoothstep(1.05, 1.5, beta) * 0.35;
  }
  // 스워시: 부서진 파도가 모래 위로 얇게 밀려 올라왔다 빠짐 (마른 첫 셀 = 지면 높이 ≈ η + 0.02)
  if (depth < 0.06 && eta > -3.0) {
    float gnd = eta + 0.02;
    float th0 = SW_OM * uTime + vnoise(xz * 0.0035) * 5.0 + xz.x * 0.0015;
    float s0 = fract(th0 / 6.2831853 + 0.08);
    float run = 0.55 * (s0 < 0.3 ? smoothstep(0.0, 0.3, s0) : 1.0 - smoothstep(0.3, 1.0, s0)) * (1.0 - mud);
    swash = run - max(gnd, 0.0);
    if (swash > 0.0) y = max(y, gnd + min(swash, 0.05));
  }
#endif
  wpos.y = y;
  vW = wpos; vDepth = depth; vVel = vel; vFoam = foam; vMud = mud; vSurf = surfFoam; vSwash = swash;
  vec2 tg = sg + wg * calm + swg;
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
varying float vSurf; varying float vSwash;
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
  // 얕은 물 바닥 빛무늬(코스틱)
  if (depth < 4.0) {
    float c1 = worley(vW.xz * 0.9 + vec2(uTime * 0.35, uTime * 0.2)), c2 = worley(vW.xz * 1.3 - vec2(uTime * 0.25, -uTime * 0.31));
    float caust = pow(1.0 - clamp(min(c1, c2) * 3.0, 0.0, 1.0), 4.0);
    lit += vec3(0.25, 0.3, 0.26) * caust * (1.0 - smoothstep(0.3, 4.0, depth)) * (1.0 - vMud) * sunUp * uLight;
  }
  // 파봉 투과광 (서브서피스)
  float sss = pow(clamp(dot(V, -uSunDir) * 0.5 + 0.5, 0.0, 1.0), 3.0) * clamp(vSteep * 1.5 + max(vW.y, 0.0) * 0.05, 0.0, 1.0);
  lit += vec3(0.05, 0.32, 0.28) * sss * (1.0 - vMud) * uLight;
  vec3 col = mix(lit, sky * uLight, F * (1.0 - vMud * 0.5)) + spec * (1.0 - clamp(vFoam, 0.0, 1.0));
  // 거품: 쇄파·고속 흐름·해안선
  float fq0 = fract(uTime * 0.25), fq1 = fract(uTime * 0.25 + 0.5), fqw = abs(1.0 - 2.0 * fq0);
  float fadv = mix(vnoise(vW.xz * 0.45 - vel * fq1 * 1.6 + 3.1), vnoise(vW.xz * 0.45 - vel * fq0 * 1.6), fqw);
  float fn = fadv * 0.6 + vnoise(vW.xz * 1.7 + uTime * 0.3) * 0.4;
  float foamAmt = clamp(vFoam, 0.0, 1.2);
  // 쇄파 백파 · 잔류 거품 (셀룰러 레이스)
  float lace = clamp(worley(vW.xz * 0.55 - vel * fq0 * 0.6 + uTime * 0.05) * 2.2, 0.0, 1.0);
  float lace2 = clamp(worley(vW.xz * 1.9 + uTime * 0.12) * 2.5, 0.0, 1.0);
  foamAmt = max(foamAmt, clamp(vSurf, 0.0, 1.0) * (0.55 + 0.45 * lace));
  float fm = smoothstep(0.35, 0.75, fn * foamAmt + foamAmt * 0.35);
  fm = max(fm, smoothstep(0.25, 0.6, vSurf * (0.4 + 0.6 * lace) + lace2 * vSurf * 0.3));
  vec3 foamCol = mix(vec3(0.93, 0.95, 0.96), vec3(0.62, 0.55, 0.45), vMud * 0.7) * (0.35 + 0.65 * sunUp) * uLight;
  col = mix(col, foamCol, fm);
  float alpha = clamp(1.0 - exp(-depth * 1.6 - vMud * depth * 5.0), 0.0, 1.0);
  alpha = max(alpha, fm * clamp(depth * 4.0, 0.0, 1.0));
  if (vSwash > 0.0 && depth < 0.06) {
    // 얇은 물막: 모래가 비치는 반사막 + 가장자리 거품 레이스
    float edgeF = (1.0 - smoothstep(0.0, 0.05, vSwash)) * clamp(worley(vW.xz * 2.4 + uTime * 0.2) * 3.0, 0.0, 1.0);
    col = mix(sky * uLight * 0.9 + spec, foamCol, edgeF);
    alpha = max(alpha, clamp(vSwash * 12.0, 0.0, 0.55) * 0.6 + edgeF * 0.8);
  }
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
    this.texWp = new THREE.DataTexture(sim.texWPrev, N, N, THREE.RGBAFormat, THREE.FloatType);
    this.texWp.minFilter = this.texWp.magFilter = THREE.NearestFilter;
    this.texWp.needsUpdate = true;
    this.texF = new THREE.DataTexture(sim.texF, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texF.minFilter = this.texF.magFilter = THREE.NearestFilter;
    this.texF.needsUpdate = true;
    this.texFlood = new THREE.DataTexture(sim.texFlood, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texFlood.minFilter = this.texFlood.magFilter = THREE.LinearFilter;
    this.texFlood.needsUpdate = true;

    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, tW: { value: null }, tWp: { value: null }, tF: { value: null }, uBlend: { value: 1 },
      uN: { value: N }, uDx: { value: sim.dx }, uHalf: { value: HALF },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) },
      uHorizon: { value: new THREE.Color(0.7, 0.8, 0.9) }, uZenith: { value: new THREE.Color(0.25, 0.45, 0.75) },
      uLight: { value: 1 }, uUnder: { value: 0 },
    }]);
    this.uniforms.tW.value = this.texW;
    this.uniforms.tWp.value = this.texWp;
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
    u.uBlend.value = this.sim.blend();
    if (this.sim.texDirty) {
      // 두 텍스처를 번갈아 사용: 새 상태만 업로드 (직전 상태는 이미 GPU에 있음)
      const cur = this.sim.texW === this.texW.image.data ? this.texW : this.texWp;
      const prev = cur === this.texW ? this.texWp : this.texW;
      u.tW.value = cur; u.tWp.value = prev;
      cur.needsUpdate = true;
      if (this.sim.prevDirty) { prev.needsUpdate = true; this.sim.prevDirty = false; }
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
