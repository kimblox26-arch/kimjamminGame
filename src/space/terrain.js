// FREE FREELY 우주 탐사 - 구형 쿼드트리 LOD 지형 (큐브-스피어) + 바다 메시
// 각 타일은 부모 해상도로 부드럽게 모핑(CDLOD)되고, 스커트로 이음새를 가린다.
// 부동 원점: 타일 행렬을 매 프레임 Float64 로 (카메라 기준) 다시 계산해 정밀도 떨림이 없다.
import * as THREE from 'three';
import { cubeToSphere, tileSize, buildTileIndex } from './terrainfn.js';
import { LOGDEPTH_VS_PARS, LOGDEPTH_VS, LOGDEPTH_FS_PARS, LOGDEPTH_FS, ATMO_PARS, CLOUD_PARS } from './glsl.js';

export const TILE_N = 32;
const DETAIL_L = [5.5, 80, 1300];
let _sharedIndex = null;
function sharedIndex() {
  if (!_sharedIndex) _sharedIndex = new THREE.Uint32BufferAttribute(buildTileIndex(TILE_N), 1);
  return _sharedIndex;
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _d = [0, 0, 0];

/* ------------------------------------------------------------------ */
/* 셰이더                                                               */
/* ------------------------------------------------------------------ */
const TERRAIN_VS = /* glsl */`
${LOGDEPTH_VS_PARS}
${ATMO_PARS}
attribute vec3 morph;
attribute vec3 aux;
uniform vec2 uMorph;
uniform vec3 uTileCenter;
uniform float uR;
uniform vec3 uSunDir;
uniform mat4 uShadowM0;
uniform mat4 uShadowM1;
varying vec3 vNrmL;
varying vec3 vUpL;
varying vec3 vAux;
varying vec3 vLocal;
varying vec3 vSunL;
varying vec3 vViewL;
varying vec3 vSunT;
varying float vDist;
varying vec4 vSh0;
varying vec4 vSh1;
void main() {
  vec4 w0 = modelMatrix * vec4(position, 1.0);
  float k = smoothstep(uMorph.x, uMorph.y, length(w0.xyz));
  vec3 p = position + morph * k;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vDist = length(w.xyz);
  vLocal = p;
  vNrmL = normal;
  vAux = aux;
  vUpL = normalize(uTileCenter + p);
  mat3 rot = mat3(modelMatrix);
  vSunL = uSunDir * rot;
  vViewL = (-w.xyz) * rot;
  vSunT = uAtOn > 0.5 ? sunTransmittance((uTileCenter + p) / uR, vSunL) : vec3(1.0);
  vSh0 = uShadowM0 * w;
  vSh1 = uShadowM1 * w;
  gl_Position = projectionMatrix * viewMatrix * w;
  ${LOGDEPTH_VS}
}`;

const TERRAIN_FS = /* glsl */`
precision highp float;
precision highp sampler3D;
${LOGDEPTH_FS_PARS}
${CLOUD_PARS}
uniform sampler2D uDetailTex;
uniform vec3 uDet0;
uniform vec3 uDet1;
uniform vec3 uDet2;
uniform vec3 uSunCol;
uniform vec3 uSkyAmb;
uniform vec3 uSpaceAmb;
uniform vec3 uC[10];
uniform float uTime;
uniform float uClOverlay;
uniform float uLavaGlow;
uniform float uShadowOn;
uniform sampler2D uShadow0;
uniform sampler2D uShadow1;
uniform float uShadowBias;
varying vec3 vNrmL;
varying vec3 vUpL;
varying vec3 vAux;
varying vec3 vLocal;
varying vec3 vSunL;
varying vec3 vViewL;
varying vec3 vSunT;
varying float vDist;
varying vec4 vSh0;
varying vec4 vSh1;

vec4 tri(vec3 p, vec3 w) {
  return texture(uDetailTex, p.zy) * w.x + texture(uDetailTex, p.xz) * w.y + texture(uDetailTex, p.xy) * w.z;
}
vec3 triGrad(vec3 p, vec3 w) {
  vec4 a = texture(uDetailTex, p.zy), b = texture(uDetailTex, p.xz), c = texture(uDetailTex, p.xy);
  vec2 ga = a.gb * 2.0 - 1.0, gb = b.gb * 2.0 - 1.0, gc = c.gb * 2.0 - 1.0;
  return vec3(0.0, ga.y, ga.x) * w.x + vec3(gb.x, 0.0, gb.y) * w.y + vec3(gc.x, gc.y, 0.0) * w.z;
}
float shadowTap(sampler2D map, vec4 sc) {
  vec3 c = sc.xyz / sc.w * 0.5 + 0.5;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return -1.0;
  float s = 0.0;
  vec2 px = vec2(1.0 / 2048.0);
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
    float d = texture(map, c.xy + vec2(float(i), float(j)) * px).r;
    s += c.z - uShadowBias > d ? 0.0 : 1.0;
  }
  return s / 9.0;
}
float shadowAt() {
  if (uShadowOn < 0.5) return 1.0;
  float s = shadowTap(uShadow0, vSh0);
  if (s >= 0.0) return s;
  s = shadowTap(uShadow1, vSh1);
  if (s >= 0.0) return s;
  return 1.0;
}

void main() {
  vec3 up = normalize(vUpL);
  vec3 n = normalize(vNrmL);
  vec3 L = normalize(vSunL);
  vec3 V = normalize(vViewL);
  float h = vAux.x;
  float moist = vAux.y;
  float extra = vAux.z;
  float lat = abs(up.y);
  float slope = 1.0 - clamp(dot(n, up), 0.0, 1.0);

  // 삼평면 디테일 (거리별 3단계 블렌딩)
  vec3 bw = pow(abs(n), vec3(4.0)); bw /= dot(bw, vec3(1.0));
  float f0 = 1.0 - smoothstep(60.0, 180.0, vDist);
  float f1 = 1.0 - smoothstep(1500.0, 5000.0, vDist);
  float f2 = 1.0 - smoothstep(30000.0, 90000.0, vDist);
  vec3 p0 = (uDet0 + vLocal) / ${DETAIL_L[0].toFixed(1)};
  vec3 p1 = (uDet1 + vLocal) / ${DETAIL_L[1].toFixed(1)};
  vec3 p2 = (uDet2 + vLocal) / ${DETAIL_L[2].toFixed(1)};
  vec4 t1 = tri(p1, bw), t2 = tri(p2, bw);
  vec4 t0 = f0 > 0.0 ? tri(p0, bw) : vec4(0.5, 0.5, 0.5, 0.5);
  vec3 g = triGrad(p0, bw) * 0.55 * f0 + triGrad(p1, bw) * 0.38 * f1 + triGrad(p2, bw) * 0.25 * f2;
  float var = (t0.r - 0.5) * f0 * 0.5 + (t1.r - 0.5) * f1 * 0.8 + (t2.r - 0.5) * f2 * 0.6;
  float cell = mix(0.5, t0.a, f0) * 0.4 + mix(0.5, t1.a, f1) * 0.6;

  vec3 col;
  vec3 emis = vec3(0.0);
  float rough = 0.9;
  float rocky = smoothstep(0.32, 0.55, slope + var * 0.25);
#if defined(PT_TERRAN) || defined(PT_ALIEN)
  // 0 모래 1 초원 2 숲 3 건조 4 사막 5 툰드라 6 암석 7 눈 8 해저 9 절벽
  float temp = 1.0 - lat * 1.05 - max(0.0, h) / 7000.0 + var * 0.18;
  float snowline = smoothstep(0.08, 0.02, temp);
  vec3 veg = mix(uC[1], uC[2], smoothstep(0.45, 0.7, moist + var * 0.3));
  veg = mix(uC[3], veg, smoothstep(0.25, 0.45, moist + var * 0.2));
  vec3 land = mix(uC[4], veg, smoothstep(0.18, 0.4, moist + temp * 0.1 - 0.45 * smoothstep(0.75, 0.95, temp)));
  land = mix(uC[5], land, smoothstep(0.12, 0.32, temp));
  land = mix(uC[0], land, smoothstep(4.0, 16.0, h + var * 6.0));
  vec3 rock = mix(uC[6], uC[9], cell * 0.8 + var);
  land = mix(land, rock, rocky);
  land = mix(land, uC[7], snowline * (1.0 - smoothstep(0.5, 0.75, slope)));
  vec3 bed = mix(uC[0], uC[8], smoothstep(-2.0, -60.0, h)) * mix(1.0, 0.45, smoothstep(-60.0, -3000.0, h));
  col = h < 0.0 ? bed : land;
  rough = mix(0.92, 0.35, snowline);
  #ifdef PT_TERRAN
  // 도시 불빛 (밤 쪽 저지대 대륙)
  float night = smoothstep(0.08, -0.12, dot(up, L));
  if (night > 0.0 && h > 2.0 && h < 1800.0 && slope < 0.2) {
    float cities = texture(uDetailTex, up.xz * 9.0 + up.y * 3.0).r * texture(uDetailTex, up.zy * 31.0).r;
    cities = smoothstep(0.42, 0.62, cities) * smoothstep(0.25, 0.6, moist) * (1.0 - snowline);
    float sparkle = texture(uDetailTex, up.xy * 160.0).a;
    emis += vec3(1.0, 0.72, 0.4) * cities * (0.5 + sparkle) * night * 0.9;
  }
  #endif
#elif defined(PT_MARS)
  // 0 녹슨 모래 1 현무암 2 밝은 먼지 3 극관 4 층리 절벽
  col = mix(uC[0], uC[2], smoothstep(-0.2, 0.3, var + h / 9000.0));
  col = mix(col, uC[1], smoothstep(0.45, 0.65, cell + var * 0.4) * 0.6);
  vec3 cliff = mix(uC[4], uC[1], 0.5 + 0.5 * sin(h * 0.012 + var * 3.0));
  col = mix(col, cliff, rocky);
  col = mix(col, uC[3], moist * (1.0 - rocky * 0.6));
  rough = 0.95;
#elif defined(PT_HOT)
  // 0 현무암 1 화산 평원 2 고원 3 균열 발광
  col = mix(uC[1], uC[0], smoothstep(0.3, 0.7, cell + var));
  col = mix(col, uC[2], smoothstep(2000.0, 5000.0, h + var * 800.0));
  col = mix(col, uC[0] * 0.7, rocky);
  float crack = smoothstep(0.3, 0.9, extra) * (0.6 + 0.4 * sin(uTime * 1.3 + vLocal.x * 0.01));
  emis += uC[3] * crack * uLavaGlow * (1.0 + 2.0 * smoothstep(0.85, 1.0, extra));
  emis += uC[3] * smoothstep(80.0, -20.0, h) * uLavaGlow * 0.6 * (0.5 + 0.5 * t1.r);
  rough = 0.8;
#elif defined(PT_ICE)
  // 0 얼음 1 푸른 얼음 2 크레바스 3 질소 서리 4 암석 5 균열(갈색)
  col = mix(uC[0], uC[1], smoothstep(0.35, 0.75, cell + var * 0.5));
  col = mix(col, uC[3], moist);
  col = mix(col, uC[1] * 0.8, rocky);
  col = mix(col, uC[2], smoothstep(0.25, 0.8, extra));
  col = mix(col, uC[4], smoothstep(0.6, 0.85, slope) * 0.6);
  col = mix(col, uC[5], smoothstep(0.6, 0.85, t2.a) * smoothstep(0.3, 0.6, t1.r) * 0.0 + smoothstep(0.92, 0.99, t2.a) * 0.5);
  rough = mix(0.25, 0.7, rocky + moist);
#else
  // 위성·소행성: 0 고지대 1 바다 2 분출물 3 어두운 바위
  col = mix(uC[0], uC[1], moist);
  col = mix(col, uC[2], smoothstep(0.1, 0.8, extra) * 0.6);
  col = mix(col, uC[3], rocky * 0.5);
  col *= 0.85 + var * 0.5;
  rough = 1.0;
#endif
  col *= 0.88 + var * 0.35;

  // 노멀: 디테일 기울기로 섭동
  vec3 N = normalize(n - (g - up * dot(g, up)) * 0.9);
  float ndl = dot(N, L);
  float sh = shadowAt();
  // 지형 자체 그림자 (지평선 근사): 거친 노멀이 빛을 등지면 어둡게
  float horizon = smoothstep(-0.02, 0.06, dot(up, L));
  vec3 direct = uSunCol * vSunT * max(0.0, ndl) * sh * horizon;
  float dayAmb = smoothstep(-0.25, 0.25, dot(up, L));
  vec3 amb = uSkyAmb * (0.55 + 0.45 * dot(N, up)) * dayAmb + uSpaceAmb;
  // 간이 스펙큘러 (눈·얼음·젖은 표면)
  vec3 H = normalize(L + V);
  float spec = pow(max(0.0, dot(N, H)), mix(8.0, 90.0, 1.0 - rough)) * (1.0 - rough) * 0.6;
  vec3 color = col * (direct + amb) + uSunCol * vSunT * spec * sh * horizon * max(0.0, ndl) + emis;

  // 먼 거리: 구름 덮개 (주 행성이 아닐 때만 — 주 행성은 대기 패스가 체적 구름을 그림)
  if (uClOn > 0.5 && uClOverlay > 0.0) {
    float cov = cloudCoverage(up) * uClOverlay;
    vec3 cl = uClColor * (uSunCol * vSunT * max(0.0, dot(up, L)) * 0.9 + uSkyAmb * 0.6 * dayAmb);
    color = mix(color, cl, cov * 0.92);
  }
  gl_FragColor = vec4(color, 1.0);
  ${LOGDEPTH_FS}
}`;

const OCEAN_VS = /* glsl */`
${LOGDEPTH_VS_PARS}
${ATMO_PARS}
attribute vec3 aux;
uniform vec3 uTileCenter;
uniform float uR;
uniform vec3 uSunDir;
uniform vec3 uDet1;
uniform vec3 uDet2;
uniform float uTime;
uniform float uWaveAmp;
varying vec3 vUpL;
varying vec3 vNrmL;
varying float vDepth;
varying vec3 vSunL;
varying vec3 vViewL;
varying vec3 vSunT;
varying float vDist;
varying float vCrest;
varying vec3 vLocal;

// 주기 80 m / 1300 m 격자에 맞춘 파동 벡터 (타일 경계에서 위상 연속)
const float TAU = 6.2831853;
void wave(vec3 p, vec3 kInt, float period, float amp, float speed, vec3 up, inout vec3 disp, inout vec3 grad) {
  vec3 k = kInt * (TAU / period);
  vec3 kt = k - up * dot(k, up);
  float kl = length(kt) + 1e-5;
  float ph = dot(k, p) - sqrt(9.81 * kl) * uTime * speed;
  float s = sin(ph), c = cos(ph);
  disp += up * (amp * s) + (kt / kl) * (amp * 0.6 * c);
  grad += kt * (amp * c);
}

void main() {
  vec3 p = position;
  vUpL = normalize(uTileCenter + p);
  vec4 w0 = modelMatrix * vec4(p, 1.0);
  float dist = length(w0.xyz);
  float fade = 1.0 - smoothstep(1500.0, 6000.0, dist);
  vec3 disp = vec3(0.0), grad = vec3(0.0);
  float depth = -aux.x;
  float shoal = smoothstep(0.5, 12.0, depth);
  if (fade > 0.0) {
    vec3 q1 = uDet1 + p, q2 = uDet2 + p;
    float a = uWaveAmp * fade * shoal;
    wave(q2, vec3(3.0, 1.0, 2.0), 1300.0, 0.9 * a, 1.0, vUpL, disp, grad);
    wave(q2, vec3(-2.0, 1.0, 4.0), 1300.0, 0.55 * a, 1.0, vUpL, disp, grad);
    wave(q1, vec3(2.0, 0.0, 1.0), 80.0, 0.32 * a, 1.0, vUpL, disp, grad);
    wave(q1, vec3(-1.0, 1.0, 2.0), 80.0, 0.24 * a, 1.0, vUpL, disp, grad);
    wave(q1, vec3(3.0, -1.0, -2.0), 80.0, 0.14 * a, 1.0, vUpL, disp, grad);
    wave(q1, vec3(1.0, 2.0, -4.0), 80.0, 0.08 * a, 1.0, vUpL, disp, grad);
  }
  p += disp;
  vCrest = dot(disp, vUpL) / max(0.2, uWaveAmp);
  vNrmL = normalize(vUpL - grad);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vDist = length(w.xyz);
  vDepth = depth;
  vLocal = p;
  mat3 rot = mat3(modelMatrix);
  vSunL = uSunDir * rot;
  vViewL = (-w.xyz) * rot;
  vSunT = uAtOn > 0.5 ? sunTransmittance((uTileCenter + p) / uR, vSunL) : vec3(1.0);
  gl_Position = projectionMatrix * viewMatrix * w;
  ${LOGDEPTH_VS}
}`;

const OCEAN_FS = /* glsl */`
precision highp float;
${LOGDEPTH_FS_PARS}
uniform sampler2D uDetailTex;
uniform vec3 uDet0;
uniform vec3 uDet1;
uniform vec3 uSunCol;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyAmb;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform float uTime;
uniform float uFluid; // 0 물 1 용암 2 메탄
varying vec3 vUpL;
varying vec3 vNrmL;
varying float vDepth;
varying vec3 vSunL;
varying vec3 vViewL;
varying vec3 vSunT;
varying float vDist;
varying float vCrest;
varying vec3 vLocal;
void main() {
  vec3 up = normalize(vUpL);
  vec3 L = normalize(vSunL);
  vec3 V = normalize(vViewL);
  vec3 N = normalize(vNrmL);
  float near = 1.0 - smoothstep(200.0, 1200.0, vDist);
  vec3 bw = vec3(0.33);
  vec2 sc = (uDet0.xz + vLocal.xz) / 5.5 * 0.5;
  vec2 sc2 = (uDet1.xz + vLocal.xz) / 80.0;
  vec4 r0 = texture(uDetailTex, sc + vec2(uTime * 0.03, uTime * 0.017));
  vec4 r1 = texture(uDetailTex, sc * 0.37 - vec2(uTime * 0.012, -uTime * 0.02));
  vec4 r2 = texture(uDetailTex, sc2 + vec2(uTime * 0.004, 0.0));
  vec3 gt = vec3(r0.g - 0.5 + r1.g - 0.5, 0.0, r0.b - 0.5 + r1.b - 0.5) * near * 0.35 + vec3(r2.g - 0.5, 0.0, r2.b - 0.5) * 0.18;
  N = normalize(N - (gt - up * dot(gt, up)));
  bool below = dot(V, up) < 0.0;
  if (below) N = -N;
  float day = smoothstep(-0.15, 0.2, dot(up, L));
  vec3 color;
  float alpha = 1.0;
  if (uFluid > 0.5 && uFluid < 1.5) {
    // 용암: 흐르는 지각과 빛나는 균열
    vec2 fl = (uDet1.xz + vLocal.xz) / 80.0;
    float a = texture(uDetailTex, fl * 0.3 + vec2(uTime * 0.004, uTime * 0.002)).a;
    float b = texture(uDetailTex, fl * 0.07 - vec2(uTime * 0.001, 0.0)).r;
    float crust = smoothstep(0.25, 0.6, a + b * 0.4);
    vec3 glow = mix(vec3(6.0, 1.4, 0.15), vec3(10.0, 4.0, 0.8), b);
    vec3 crustCol = vec3(0.06, 0.04, 0.035) * (uSunCol * vSunT * max(0.0, dot(N, L)) + uSkyAmb);
    color = mix(glow, crustCol, crust);
  } else {
    float fres = 0.02 + 0.98 * pow(1.0 - max(0.0, dot(N, V)), 5.0);
    vec3 R = reflect(-V, N);
    float e = max(0.0, dot(R, up));
    vec3 sky = mix(uSkyHorizon, uSkyZenith, sqrt(e)) * day;
    float shin = mix(80.0, 900.0, near);
    float spec = pow(max(0.0, dot(R, L)), shin) * shin * 0.06;
    float deep = smoothstep(0.0, 60.0, vDepth);
    vec3 body = mix(uShallow, uDeep, deep);
    vec3 lit = uSunCol * vSunT * max(0.0, dot(up, L)) * 0.12 + uSkyAmb * 0.35;
    vec3 water = body * lit;
    // 파고 부분 산란 (하위 표면)
    water += uShallow * max(0.0, vCrest) * 0.08 * uSunCol * vSunT * day;
    color = mix(water, sky, fres) + uSunCol * vSunT * spec;
    // 거품: 해안 + 파고
    float fn = texture(uDetailTex, sc * 1.7 + vec2(uTime * 0.05, 0.0)).a;
    float foam = smoothstep(2.5, 0.2, vDepth) * smoothstep(0.35, 0.8, fn + 0.25 * sin(uTime * 1.4 + vDepth * 3.0));
    foam += smoothstep(0.7, 1.3, vCrest) * fn * near;
    color = mix(color, vec3(0.9) * (uSunCol * vSunT * max(0.0, dot(up, L)) * 0.9 + uSkyAmb), clamp(foam, 0.0, 1.0) * 0.85);
    alpha = clamp(0.55 + vDepth / 6.0 + fres * 0.4, 0.55, 1.0);
    if (uFluid > 1.5) { color *= vec3(0.5, 0.42, 0.3); }
    if (below) {
      // 수면 아래에서 본 수면: 스넬의 창
      float win = smoothstep(0.55, 0.75, dot(V * -1.0, up));
      color = mix(uDeep * uSkyAmb * 0.5, mix(uSkyHorizon, uSkyZenith, 0.5) * day * 0.8 + uSunCol * vSunT * 0.05, win);
      alpha = 1.0;
    }
  }
  gl_FragColor = vec4(color, alpha);
  ${LOGDEPTH_FS}
}`;

/* ------------------------------------------------------------------ */
/* 팔레트                                                               */
/* ------------------------------------------------------------------ */
const PAL = {
  earth: ['#c9b98a', '#4a6b2a', '#203d16', '#8a7a4a', '#c7a36a', '#6e6a55', '#5c5650', '#f2f5fa', '#7a7058', '#3c3631'],
  alien: ['#b9a98a', '#5a2a5c', '#2c103a', '#6a4a5a', '#b08a6a', '#5a5060', '#4c4650', '#e8e4f0', '#6a6058', '#2c2631'],
  mars: ['#a65a32', '#3e2a22', '#d0915c', '#f2ece4', '#7a4a32'],
  desert2: ['#b07050', '#4a3028', '#d8a070', '#e8e0e0', '#8a5040'],
  venus: ['#5a4a3a', '#8a6a44', '#a08868', '#ff7a20'],
  lava: ['#1a1412', '#3a2016', '#2a2420', '#ff5a10'],
  io: ['#d8c858', '#a86a20', '#e8e0b0', '#ff8a20'],
  ice: ['#e8f0f8', '#9cc6e6', '#20486a', '#f4dcdc', '#5a5a64', '#8a5a3a'],
  ice2: ['#e0e8f4', '#8ab4dc', '#1a3c5c', '#eae0f0', '#50525c', '#6a5a4a'],
  europa: ['#e6dcc8', '#c8d4dc', '#7a4a28', '#f0ece4', '#706458', '#8a5228'],
  titan: ['#7a5a30', '#a8885a', '#3a2a18', '#b89a6a', '#4a3a28', '#5a4020'],
  moon: ['#8c8a86', '#3c3c3e', '#bcbab6', '#54524e'],
  asteroid: ['#5c5650', '#4a4642', '#7a746c', '#3a3632'],
};
const PT_DEFINE = {
  terran: 'PT_TERRAN', alien: 'PT_ALIEN', mars: 'PT_MARS', desert2: 'PT_MARS', venus: 'PT_HOT', lava: 'PT_HOT', io: 'PT_HOT',
  ice: 'PT_ICE', ice2: 'PT_ICE', europa: 'PT_ICE', titan: 'PT_ICE', moon: 'PT_MOON', asteroid: 'PT_MOON',
};

export function paletteColors(name) {
  const p = PAL[name] || PAL.moon;
  const out = [];
  for (let i = 0; i < 10; i++) out.push(new THREE.Color(p[Math.min(i, p.length - 1)]).convertSRGBToLinear());
  return out;
}

/** 대기 유니폼 객체 생성 (행성 반지름 단위) */
export function makeAtmoUniforms(body) {
  const a = body.atmo;
  const R = body.radius;
  const u = {
    uAtR: { value: a ? (R + a.top) / R : 1 },
    uAtBetaR: { value: new THREE.Vector3() },
    uAtBetaM: { value: new THREE.Vector3() },
    uAtBetaMExt: { value: new THREE.Vector3() },
    uAtHR: { value: a ? a.HR / R : 1 },
    uAtHM: { value: a ? a.HM / R : 1 },
    uAtG: { value: a ? a.mieG : 0.7 },
    uAtMieTint: { value: new THREE.Vector3(1, 1, 1) },
    uAtSun: { value: new THREE.Vector3(20, 20, 20) },
    uAtOn: { value: a ? 1 : 0 },
  };
  if (a) {
    u.uAtBetaR.value.set(a.betaR[0] * R, a.betaR[1] * R, a.betaR[2] * R);
    u.uAtBetaM.value.set(a.betaM[0] * R, a.betaM[1] * R, a.betaM[2] * R);
    const e = a.betaMExt || a.betaM.map((v) => v * 1.11);
    u.uAtBetaMExt.value.set(e[0] * R, e[1] * R, e[2] * R);
    u.uAtMieTint.value.set(a.mieTint[0], a.mieTint[1], a.mieTint[2]);
  }
  return u;
}

export function makeCloudUniforms(body, cloudTex) {
  const c = body.atmo && body.atmo.clouds;
  const R = body.radius;
  return {
    uCloudTex: { value: cloudTex },
    uClBase: { value: c ? c.base / R : 0 },
    uClTop: { value: c ? c.top / R : 0 },
    uClCover: { value: c ? c.coverage : 0 },
    uClDensity: { value: c ? c.density * R : 0 },
    uClScale: { value: c ? c.scale / R : 0.01 },
    uClColor: { value: new THREE.Color(...(c ? c.color : [1, 1, 1])) },
    uClTime: { value: 0 },
    uClOn: { value: c ? 1 : 0 },
    uClCirrus: { value: c && c.cirrus ? c.cirrus / R : 0 },
  };
}

/* ------------------------------------------------------------------ */
/* 쿼드트리 노드                                                         */
/* ------------------------------------------------------------------ */
class Node {
  constructor(tree, face, level, ix, iy) {
    this.tree = tree;
    this.face = face; this.level = level; this.ix = ix; this.iy = iy;
    this.key = `${tree.body.id}:${face}:${level}:${ix}:${iy}`;
    const sc = 1 / Math.pow(2, level);
    cubeToSphere(face, ix * sc * 2 - 1 + sc, iy * sc * 2 - 1 + sc, _d);
    this.dir = new THREE.Vector3(_d[0], _d[1], _d[2]);
    this.center = this.dir.clone().multiplyScalar(tree.R);
    this.size = tileSize(tree.R, level);
    this.minH = tree.terrain ? tree.terrain.minH : 0;
    this.maxH = tree.terrain ? tree.terrain.maxH : 0;
    this.bound = this.size * 0.75 + (this.maxH - this.minH) * 0.5;
    this.state = 'none';
    this.children = null;
    this.mesh = null;
    this.ocean = null;
    this.lastUsed = 0;
    this.det = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  }

  request(priority) {
    if (this.state !== 'none') return;
    this.state = 'pending';
    const t = this.tree;
    t.scheduler.request({ key: this.key, planet: t.body.id, face: this.face, level: this.level, ix: this.ix, iy: this.iy, N: TILE_N, priority }, (d) => this._onData(d));
  }

  _onData(d) {
    if (this.state !== 'pending') return;
    const t = this.tree;
    this.center.set(d.center[0], d.center[1], d.center[2]);
    this.minH = d.minH; this.maxH = d.maxH;
    this.bound = this.size * 0.72 + (this.maxH - this.minH) * 0.5 + 10;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.nrm, 3));
    g.setAttribute('morph', new THREE.BufferAttribute(d.morph, 3));
    const auxAttr = new THREE.BufferAttribute(d.aux, 3);
    g.setAttribute('aux', auxAttr);
    g.setIndex(sharedIndex());
    const midH = (this.minH + this.maxH) * 0.5;
    g.boundingSphere = new THREE.Sphere(this.dir.clone().multiplyScalar(midH), this.bound);
    const mesh = new THREE.Mesh(g, t.material);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = true;
    mesh.visible = false;
    mesh.layers.enable(1);   // 그림자 투사
    mesh.onBeforeRender = (r, s, c, geo, mat) => this._uniforms(mat);
    mesh.renderOrder = 1;
    this.mesh = mesh;
    t.group.add(mesh);
    if (d.ocean && t.oceanMaterial) {
      const og = new THREE.BufferGeometry();
      og.setAttribute('position', new THREE.BufferAttribute(d.ocean, 3));
      og.setAttribute('aux', auxAttr);
      og.setIndex(sharedIndex());
      og.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.size * 0.75 + 20);
      const om = new THREE.Mesh(og, t.oceanMaterial);
      om.matrixAutoUpdate = false;
      om.visible = false;
      om.renderOrder = 3;
      om.onBeforeRender = (r, s, c, geo, mat) => this._uniforms(mat);
      this.ocean = om;
      t.group.add(om);
    }
    // 디테일 텍스처 좌표 오프셋 (Float64 로 나머지 연산 → 타일 경계에서 연속)
    const m = (v, l) => v - Math.floor(v / l) * l;
    for (let i = 0; i < 3; i++) this.det[i].set(m(this.center.x, DETAIL_L[i]), m(this.center.y, DETAIL_L[i]), m(this.center.z, DETAIL_L[i]));
    this.state = 'ready';
    t.readyCount++;
  }

  _uniforms(mat) {
    const u = mat.uniforms;
    const parentSplit = this.tree.splitDist(this.level - 1);
    u.uMorph.value.set(parentSplit * 0.55, parentSplit * 0.92);
    u.uTileCenter.value.copy(this.center);
    u.uDet0.value.copy(this.det[0]);
    u.uDet1.value.copy(this.det[1]);
    if (u.uDet2) u.uDet2.value.copy(this.det[2]);
    mat.uniformsNeedUpdate = true;
  }

  split() {
    if (this.children) return;
    const L = this.level + 1, x = this.ix * 2, y = this.iy * 2;
    const t = this.tree;
    this.children = [new Node(t, this.face, L, x, y), new Node(t, this.face, L, x + 1, y), new Node(t, this.face, L, x, y + 1), new Node(t, this.face, L, x + 1, y + 1)];
  }

  dispose() {
    if (this.children) { for (const c of this.children) c.dispose(); this.children = null; }
    if (this.state === 'pending') this.tree.scheduler.cancel(this.key);
    if (this.mesh) { this.tree.group.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (this.ocean) { this.tree.group.remove(this.ocean); this.ocean.geometry.dispose(); this.ocean = null; }
    if (this.state === 'ready') this.tree.readyCount--;
    this.state = 'none';
  }
}

/* ------------------------------------------------------------------ */
/* 지형 구 (행성 하나)                                                   */
/* ------------------------------------------------------------------ */
export class TerrainSphere {
  /**
   * @param body 천체
   * @param scheduler TileScheduler
   * @param shared { detailTex, cloudTex }
   */
  constructor(body, scheduler, shared, scene) {
    this.body = body;
    this.R = body.radius;
    this.scheduler = scheduler;
    this.terrain = scheduler.localTerrain(body.id);
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);
    this.splitK = 2.2;
    this.maxLevel = Math.max(2, Math.min(19, Math.floor(Math.log2((Math.PI * 0.5 * this.R) / (TILE_N * 1.0)))));
    this.frame = 0;
    this.readyCount = 0;
    this.visibleCount = 0;
    const palName = body.palette || 'moon';
    const define = PT_DEFINE[palName] || 'PT_MOON';
    const atmoU = makeAtmoUniforms(body);
    const cloudU = makeCloudUniforms(body, shared.cloudTex);
    this.atmoU = atmoU;
    this.cloudU = cloudU;
    const common = {
      uR: { value: this.R }, uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunCol: { value: new THREE.Vector3(3, 3, 3) },
      uSkyAmb: { value: new THREE.Vector3(0.1, 0.12, 0.15) }, uSpaceAmb: { value: new THREE.Vector3(0.004, 0.004, 0.005) },
      uTileCenter: { value: new THREE.Vector3() }, uDet0: { value: new THREE.Vector3() }, uDet1: { value: new THREE.Vector3() }, uDet2: { value: new THREE.Vector3() },
      uDetailTex: { value: shared.detailTex }, uTime: { value: 0 }, uMorph: { value: new THREE.Vector2(1e9, 2e9) },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS,
      defines: { [define]: 1 },
      uniforms: {
        ...common, ...atmoU, ...cloudU,
        uC: { value: paletteColors(palName) }, uClOverlay: { value: 0 },
        uLavaGlow: { value: (body.terrain && body.terrain.lava) ? 1 : 0 },
        uShadowOn: { value: 0 }, uShadow0: { value: null }, uShadow1: { value: null },
        uShadowM0: { value: new THREE.Matrix4() }, uShadowM1: { value: new THREE.Matrix4() }, uShadowBias: { value: 0.0015 },
      },
    });
    this.uniforms = this.material.uniforms;
    this.oceanMaterial = null;
    if (this.terrain.hasOcean) {
      const fluid = this.terrain.seaFluid;
      const isLava = fluid === 'lava';
      this.oceanMaterial = new THREE.ShaderMaterial({
        vertexShader: OCEAN_VS, fragmentShader: OCEAN_FS,
        transparent: !isLava, depthWrite: true, side: THREE.DoubleSide,
        uniforms: {
          ...common, ...atmoU,
          uSunDir: this.uniforms.uSunDir, uSunCol: this.uniforms.uSunCol, uSkyAmb: this.uniforms.uSkyAmb, uTime: this.uniforms.uTime,
          uTileCenter: { value: new THREE.Vector3() }, uDet0: { value: new THREE.Vector3() }, uDet1: { value: new THREE.Vector3() }, uDet2: { value: new THREE.Vector3() },
          uSkyZenith: { value: new THREE.Vector3(0.1, 0.25, 0.6) }, uSkyHorizon: { value: new THREE.Vector3(0.5, 0.65, 0.85) },
          uShallow: { value: new THREE.Color(body.palette === 'alien' ? '#2a8a7a' : '#1f8f9a').convertSRGBToLinear() },
          uDeep: { value: new THREE.Color(body.palette === 'alien' ? '#06202e' : '#031a3a').convertSRGBToLinear() },
          uWaveAmp: { value: 0.9 },
          uFluid: { value: isLava ? 1 : fluid === 'methane' ? 2 : 0 },
        },
      });
      // 공용 유니폼 객체 공유 (태양 방향 등은 한 번만 갱신)
      for (const k of ['uR', 'uDetailTex', ...Object.keys(atmoU)]) this.oceanMaterial.uniforms[k] = this.uniforms[k];
    }
    this.roots = [];
    for (let f = 0; f < 6; f++) this.roots.push(new Node(this, f, 0, 0, 0));
    this._camL = new THREE.Vector3();
    this._rot = new THREE.Matrix4();
    this._rel = new THREE.Vector3();
    this._list = [];
  }

  splitDist(level) { return tileSize(this.R, Math.max(0, level)) * this.splitK; }

  setQuality(q) {
    this.splitK = { low: 1.5, medium: 2.1, high: 2.7, ultra: 3.3 }[q] || 2.1;
  }

  /**
   * @param camL 행성 로컬 좌표의 카메라 위치 (Float64)
   * @param rel 카메라 기준 행성 중심 (Float64)
   * @param rot 행성 자세 쿼터니언
   * @param active false 면 전부 숨김
   */
  update(camL, rel, rot, active) {
    this.frame++;
    const list = this._list;
    list.length = 0;
    if (active) {
      const D = camL.length();
      this._horizonCos = D > this.R ? Math.cos(Math.acos(Math.min(1, (this.R + this.terrain.minH) / D)) + Math.acos(Math.min(1, this.R / (this.R + this.terrain.maxH)))) : -2;
      this._camDir = _v.copy(camL).divideScalar(Math.max(1, D)).clone();
      this._camL.copy(camL);
      for (const r of this.roots) this._traverse(r, list);
    }
    // 보이는 타일만 표시 · 행렬 갱신 (Float64 → 카메라 기준)
    for (const c of this.group.children) c.visible = false;
    this._rot.makeRotationFromQuaternion(rot);
    for (const n of list) {
      _v.copy(n.center).applyQuaternion(rot).add(rel);
      const e = this._rot.elements;
      for (const mesh of [n.mesh, n.ocean]) {
        if (!mesh) continue;
        mesh.matrix.copy(this._rot);
        mesh.matrix.elements[12] = _v.x; mesh.matrix.elements[13] = _v.y; mesh.matrix.elements[14] = _v.z;
        mesh.matrixWorld.copy(mesh.matrix);
        mesh.matrixWorldNeedsUpdate = false;
        mesh.visible = true;
        void e;
      }
    }
    this.visibleCount = list.length;
    // 오래 안 쓴 자식 정리
    if (this.frame % 30 === 0) for (const r of this.roots) this._prune(r);
  }

  _traverse(node, list) {
    node.lastUsed = this.frame;
    if (node.state === 'none') node.request(node.level * 4 + this._distTo(node) / node.size * 0.01);
    // 지평선 컬링
    if (this._horizonCos > -1.5 && node.level > 0) {
      const ang = node.size / this.R * 0.75;
      const c = node.dir.dot(this._camDir);
      if (c < Math.cos(Math.min(Math.PI, Math.acos(Math.max(-1, Math.min(1, this._horizonCos))) + ang))) return;
    }
    const d = this._distTo(node);
    const want = node.level < this.maxLevel && d < this.splitDist(node.level);
    if (want) {
      node.split();
      let ready = true;
      for (const c of node.children) {
        c.lastUsed = this.frame;
        if (c.state !== 'ready') { ready = false; if (c.state === 'none') c.request(c.level * 4 + this._distTo(c) / c.size * 0.01 - 2); }
      }
      if (ready) {
        for (const c of node.children) this._traverse(c, list);
        return;
      }
    }
    if (node.state === 'ready') list.push(node);
  }

  _distTo(node) {
    return Math.max(0, this._camL.distanceTo(node.center) - node.bound);
  }

  _prune(node) {
    if (!node.children) return;
    let used = false;
    for (const c of node.children) if (this.frame - c.lastUsed < 90) used = true;
    if (!used) { for (const c of node.children) c.dispose(); node.children = null; return; }
    for (const c of node.children) this._prune(c);
  }

  /** 지표 높이 (행성 로컬 단위 방향) — 충돌·카메라용 */
  heightAt(dirL, minW = 1) { return this.terrain.height(dirL.x, dirL.y, dirL.z, minW); }

  get seaLevel() { return this.terrain.hasOcean ? 0 : -Infinity; }

  dispose() {
    for (const r of this.roots) r.dispose();
    this.group.parent && this.group.parent.remove(this.group);
    this.material.dispose();
    if (this.oceanMaterial) this.oceanMaterial.dispose();
  }
}
