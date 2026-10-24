// SKY BLADE — 우주 장면 (별, 은하수, 해, 달, 지구)
//  - 단위: km, 카메라 기준 렌더 (카메라 = 원점, 장면 축 = 행성 좌표 축)
//  - 카메라 회전 = localToPlanetQuat(카메라 위치) × 메인 카메라 회전 → 지역 화면과 정확히 겹침
//  - 깊이 테스트 없이 거리순(renderOrder)으로 그림: 배경(별/은하) → 해 → 먼 천체 → 가까운 천체
//  - 모든 셰이더 출력은 선형 HDR (OutputPass 에서 톤매핑)
import * as THREE from 'three';
import { GE, GU, GN, loadTex } from './geo.js';
import { SUN_DIR, SUN, MOON, BODIES, ECLIPTIC, AU, flatToPlanet, localToPlanetQuat, eqToLocal, GMST, FAR, LY } from './frame.js';

const RE = 6371, RM = MOON.radius / 1000, RS = SUN.radius / 1000;   // km
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// 지구 자전축 (서울 위도 37.5°N): 서울 천정에서 북쪽(-Z)으로 52.5° 기운 방향
const POLE = new THREE.Vector3(0, Math.cos(52.5 * Math.PI / 180), -Math.sin(52.5 * Math.PI / 180)).normalize();
// 은하 북극 / 은하 중심 방향 (임의, 서울 밤하늘에서 은하수가 비스듬히 지나가게)
const GAL_N = eqToLocal(192.8595, 27.1283).normalize();
const GAL_C = eqToLocal(266.405, -28.936).normalize().projectOnPlane(GAL_N).normalize();

const NOISE = /* glsl */`
float h31(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 9; i++) { if (i >= oct) break; s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}
// 크레이터: 셀마다 하나, 반지름/깊이 무작위 → (높이, 테두리)
float craters(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float h = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(h31(i + g), h31(i + g + 17.3), h31(i + g + 41.7));
    float r = 0.18 + 0.32 * h31(i + g + 7.7);
    float d = length(g + o - f) / r;
    if (d < 1.4) {
      float bowl = d < 1.0 ? (d * d - 1.0) : 0.0;
      float rim = exp(-pow((d - 1.0) * 4.0, 2.0)) * 0.35;
      h += (bowl + rim) * r;
    }
  }
  return h;
}`;

// ── 별 ──
const STAR_VS = /* glsl */`
attribute float aMag;
attribute vec3 aCol;
uniform float uPR;
varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = 0.5 * gl_Position.w;
  float b = pow(10.0, -0.4 * (aMag - 1.0));
  gl_PointSize = max(clamp(1.4 + 2.2 * sqrt(b), 1.0, 5.0) * uPR, 1.6);
  vC = aCol * (0.6 + 6.0 * b);
}`;
const STAR_FS = /* glsl */`
uniform float uVis;
varying vec3 vC;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = exp(-dot(q, q) * 18.0);
  gl_FragColor = vec4(vC * a * uVis, 1.0);   // AdditiveBlending 은 src alpha 를 곱함
}`;

// ── 은하수 (안쪽에서 보는 큰 구) ──
const MW_VS = /* glsl */`
varying vec3 vD;
void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = 0.5 * gl_Position.w; }`;
const MW_FS = /* glsl */`
${NOISE}
uniform vec3 uGN;
uniform vec3 uGC;
uniform float uVis;
uniform sampler2D uMW;     // 실제 은하수 윤곽 (적경 u, 적위 v)
uniform vec3 uEE; uniform vec3 uEU; uniform vec3 uEN;
uniform float uGMST;
varying vec3 vD;
void main() {
  vec3 d = normalize(vD);
  float b = asin(clamp(dot(d, uGN), -1.0, 1.0));            // 은하 위도
  float l = acos(clamp(dot(normalize(d - uGN * dot(d, uGN)), uGC), -1.0, 1.0));   // 중심으로부터 경도 각
  vec3 e = d.x * uEE + d.y * uEU - d.z * uEN;
  float ra = atan(e.y, e.x) + uGMST, dec = asin(clamp(e.z, -1.0, 1.0));
  float mw = texture2D(uMW, vec2(fract(ra / 6.2831853), 0.5 + dec / 3.14159265)).r;
  float band = mw;
  float bulge = exp(-pow(l / 0.55, 2.0) - pow(b / 0.22, 2.0)) * mw;
  float n = fbm(d * 7.0, 6);
  float fine = fbm(d * 38.0, 4);
  // 먼지띠: 은하 적도 근처에 어두운 갈라짐
  float dust = smoothstep(0.42, 0.72, fbm(d * 13.0 + 4.0, 5)) * exp(-pow(b / 0.05, 2.0));
  float I = (band * (0.5 + 0.7 * n) + bulge * 1.2) * (0.75 + 0.5 * fine);
  I *= 1.0 - 0.7 * dust;
  vec3 col = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.82, 0.62), bulge * 0.9) * I;
  // 희미한 성운 얼룩
  col += vec3(0.9, 0.3, 0.35) * pow(max(fbm(d * 21.0 + 9.0, 4) - 0.55, 0.0), 2.0) * band * 2.0;
  gl_FragColor = vec4(col * 0.11 * uVis, 1.0);   // AdditiveBlending 은 src alpha 를 곱함
}`;

// ── 해 (구 + 화면 정렬 글로우) ──
const SUN_VS = /* glsl */`
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(-wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = 0.5 * gl_Position.w;
}`;
const SUN_FS = /* glsl */`
${NOISE}
uniform float uTime;
uniform float uI;
uniform vec3 uTint;
varying vec3 vN;
varying vec3 vV;
void main() {
  float mu = clamp(dot(vN, vV), 0.0, 1.0);
  float limb = 0.35 + 0.65 * pow(mu, 0.55);                 // 주연 감광
  float gran = 0.85 + 0.3 * fbm(vN * 180.0 + uTime * 0.05, 4);   // 쌀알 무늬
  vec3 col = uTint * 60.0 * limb * gran;
  gl_FragColor = vec4(col * uI, 1.0);
}`;
const GLOW_VS = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  gl_Position = projectionMatrix * mv;
  gl_Position.z = 0.5 * gl_Position.w;
}`;
const GLOW_FS = /* glsl */`
uniform float uR;      // 해 원반 반지름 (쿼드 반폭 대비)
uniform float uI;
uniform vec3 uTint;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float x = max(r - uR, 0.0) / max(1.0 - uR, 1e-4);
  float a = atan(vUv.y, vUv.x);
  float rays = 0.6 + 0.4 * pow(abs(sin(a * 6.0 + 0.4)), 18.0) + 0.25 * pow(abs(sin(a * 11.0 - 1.1)), 30.0);
  vec3 c = uTint * (exp(-x * 9.0) * 3.0 + exp(-x * 2.6) * 0.35 * rays) * (1.0 - smoothstep(0.85, 1.0, r));
  gl_FragColor = vec4(c * uI, 1.0);   // AdditiveBlending 은 src alpha 를 곱함
}`;

// ── 달 ──
const BODY_VS = /* glsl */`
varying vec3 vN;     // 천체 기준 단위 위치 (= 법선)
varying vec3 vW;     // 카메라 기준 위치 (km)
void main() {
  vN = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = 0.5 * gl_Position.w;
}`;
const MOON_FS = /* glsl */`
${NOISE}
uniform vec3 uSun;
uniform float uI;
uniform sampler2D uMap;
uniform vec3 uAxis;
uniform vec3 uRef;     // 지구 쪽 (조석 고정: 앞면이 늘 지구를 봄)
varying vec3 vN;
varying vec3 vW;
vec4 mapTex(sampler2D t, vec2 uv) {
  vec2 uvB = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dxA = dFdx(uv), dyA = dFdy(uv), dxB = dFdx(uvB), dyB = dFdy(uvB);
  return textureGrad(t, uv, abs(dxA.x) <= abs(dxB.x) ? dxA : dxB, abs(dyA.x) <= abs(dyB.x) ? dyA : dyB);
}
float hgt(vec3 p) {
  return craters(p * 7.0) * 0.6 + craters(p * 19.0) * 0.25 + craters(p * 47.0) * 0.08 + fbm(p * 30.0, 4) * 0.05;
}
void main() {
  vec3 n = normalize(vN);
  // 법선 섭동 (높이장 유한 차분)
  vec3 t1 = normalize(cross(n, vec3(0.0, 1.0, 0.1)));
  vec3 t2 = cross(n, t1);
  float e = 0.004;
  float h0 = hgt(n);
  float hx = hgt(normalize(n + t1 * e)), hy = hgt(normalize(n + t2 * e));
  vec3 nb = normalize(n - (t1 * (hx - h0) + t2 * (hy - h0)) * 2.2 / e * 0.012);
  // 바다(어두운 현무암 평원)와 고지대
  // 실제 달 지도 (LRO): 앞면 경도 0 이 지구 쪽
  float lat = asin(clamp(dot(n, uAxis), -1.0, 1.0));
  vec3 r1 = cross(uAxis, uRef);
  float lon = atan(dot(n, r1), dot(n, uRef));
  vec3 tex = mapTex(uMap, vec2(fract(lon / 6.2831853 + 0.5), 0.5 + lat / 3.14159265)).rgb;
  float alb = dot(tex, vec3(0.3, 0.59, 0.11)) * 0.42 * (0.9 + 0.2 * fbm(n * 160.0, 3));
  alb += 0.05 * smoothstep(0.03, 0.08, h0);                  // 밝은 크레이터 테두리/광조
  float nl = max(dot(nb, uSun), 0.0);
  vec3 V = normalize(-vW);
  float nv = max(dot(nb, V), 1e-3);
  float ls = nl / (nl + nv) * 2.0;                           // 로멜-지리거 (달 표면 반사)
  vec3 col = vec3(1.0, 0.97, 0.93) * alb * mix(nl, ls, 0.6) * 3.2;
  col += vec3(0.25, 0.3, 0.4) * alb * 0.02;                  // 지구 반사광
  gl_FragColor = vec4(col * uI, 1.0);
}`;

// ── 지구 (실제 위성 사진: NASA 블루마블, 야간 조명, 구름) ──
const EARTH_FS = /* glsl */`
uniform vec3 uSun;
uniform vec3 uGE;
uniform vec3 uGU;
uniform vec3 uGN;
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uCloud;
uniform sampler2D uWater;
uniform float uTime;
uniform float uI;
varying vec3 vN;
varying vec3 vW;
// 경도 ±180° 이음매에서 밉맵이 튀지 않게: 이음매 없는 쪽 미분으로 샘플
vec4 geoTex(sampler2D t, vec2 uv) {
  vec2 uvB = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dxA = dFdx(uv), dyA = dFdy(uv), dxB = dFdx(uvB), dyB = dFdy(uvB);
  vec2 dx = abs(dxA.x) <= abs(dxB.x) ? dxA : dxB;
  vec2 dy = abs(dyA.x) <= abs(dyB.x) ? dyA : dyB;
  return textureGrad(t, uv, dx, dy);
}
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(-vW);
  // 서울 기준 행성 좌표 → 지구 고정 좌표 → 위도·경도
  vec3 e = n.x * uGE + n.y * uGU - n.z * uGN;
  float lat = asin(clamp(e.z, -1.0, 1.0));
  float lon = atan(e.y, e.x);
  vec2 uv = vec2(lon / 6.2831853 + 0.5, 0.5 + lat / 3.14159265);
  vec3 alb = geoTex(uDay, uv).rgb;
  float sea = geoTex(uWater, uv).r;
  vec2 cuv = vec2(uv.x + uTime * 0.000004, uv.y);
  float cov = smoothstep(0.04, 0.8, geoTex(uCloud, cuv).r) * 0.95;
  float NL = dot(n, uSun);
  float day = smoothstep(-0.08, 0.12, NL);
  float lit = max(NL, 0.0);
  vec3 col = alb * lit * 2.3;
  // 바다 햇빛 반짝임
  vec3 H = normalize(uSun + V);
  float spec = pow(max(dot(n, H), 0.0), 180.0) * sea * (1.0 - cov);
  col += vec3(1.0, 0.92, 0.8) * spec * 5.0 * lit;
  // 구름: 밝게, 아래 지면은 조금 어둡게
  col = mix(col * (1.0 - 0.45 * cov), vec3(0.92, 0.94, 0.97) * (lit * 2.3 + 0.015), cov * 0.9);
  // 밤: 실제 도시 불빛
  vec3 lights = geoTex(uNight, uv).rgb;
  col += lights * vec3(1.0, 0.8, 0.55) * (1.0 - day) * (1.0 - cov * 0.6) * 1.4;
  // 대기: 가장자리로 갈수록 파란 산란광, 명암 경계는 붉게
  float ndv = max(dot(n, V), 0.0);
  float fres = pow(1.0 - ndv, 5.0);
  vec3 sky = mix(vec3(0.95, 0.35, 0.1), vec3(0.25, 0.5, 1.0), smoothstep(-0.05, 0.3, NL));
  col = mix(col, sky * 1.2 * smoothstep(-0.2, 0.25, NL), clamp(fres * 0.7 + 0.05 * day, 0.0, 1.0));
  gl_FragColor = vec4(col * uI, 1.0);
}`;
// 대기 바깥 껍질 (지구 원반 테두리 너머로 번지는 푸른 빛)
const ATMO_FS = /* glsl */`
uniform vec3 uSun;
uniform float uI;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(-vW);
  float ndv = dot(n, V);
  float rim = pow(clamp(1.0 - abs(ndv), 0.0, 1.0), 4.0);
  float NL = dot(n, uSun);
  vec3 c = mix(vec3(1.0, 0.4, 0.12), vec3(0.3, 0.55, 1.0), smoothstep(-0.1, 0.35, NL)) * smoothstep(-0.35, 0.2, NL);
  gl_FragColor = vec4(c * rim * 2.2 * uI, 1.0);   // AdditiveBlending 은 src alpha 를 곱함
}`;

// 다른 행성의 대기 바깥 껍질 (가장자리 빛무리)
const ATMO2_FS = /* glsl */`
uniform vec3 uSunL;
uniform vec3 uC;
uniform float uI, uK;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(-vW);
  float ndv = dot(n, V);
  float rim = pow(clamp(1.0 - abs(ndv), 0.0, 1.0), 5.0);
  float NL = dot(n, uSunL);
  vec3 c = mix(vec3(1.0, 0.45, 0.18), uC, smoothstep(-0.1, 0.35, NL)) * smoothstep(-0.35, 0.2, NL);
  gl_FragColor = vec4(c * rim * uK * uI, 1.0);
}`;
// ── 행성 (암석/가스/얼음/구름) ──
const PLANET_FS = /* glsl */`
${NOISE}
uniform vec3 uSunL;     // 행성 → 태양 방향
uniform vec3 uAxis;     // 자전축 (황도 북극 근사)
uniform vec3 uC1;
uniform vec3 uC2;
uniform float uKind;    // 0 암석, 1 가스, 2 얼음, 3 구름
uniform float uSeed;
uniform float uSpot;
uniform float uIce;
uniform float uTime;
uniform float uI;
uniform sampler2D uMap;   // 실제 행성 지도 (있으면)
uniform float uHasMap;
uniform vec3 uRef;        // 경도 0 방향 (자전축에 수직)
uniform float uRot;       // 자전 각속도 (rad/s)
uniform float uAlb;
uniform vec3 uAtmC;      // 대기 산란 색
uniform float uAtm;      // 대기 세기 (0 = 없음)
uniform float uCrack;    // 유로파: 얼음 균열
varying vec3 vN;
varying vec3 vW;
float relief(vec3 q) { return craters(q * 6.0) * 0.6 + craters(q * 17.0) * 0.25 + craters(q * 43.0) * 0.08 + fbm(q * 20.0, 4) * 0.06; }
vec4 mapTex(sampler2D t, vec2 uv) {
  vec2 uvB = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dxA = dFdx(uv), dyA = dFdy(uv), dxB = dFdx(uvB), dyB = dFdy(uvB);
  return textureGrad(t, uv, abs(dxA.x) <= abs(dxB.x) ? dxA : dxB, abs(dyA.x) <= abs(dyB.x) ? dyA : dyB);
}
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(-vW);
  float lat = asin(clamp(dot(n, uAxis), -1.0, 1.0));
  vec3 q = n * 1.0 + uSeed;
  vec3 alb;
  vec3 nb = n;
  if (uKind < 0.5) {
    // 암석: 크레이터 + 지형 무늬
    float h = craters(q * 6.0) * 0.6 + craters(q * 17.0) * 0.25 + fbm(q * 20.0, 4) * 0.08;
    float m = fbm(q * 2.5, 5);
    alb = mix(uC2, uC1, smoothstep(0.35, 0.65, m)) * (0.85 + 0.3 * fbm(q * 40.0, 3));
    alb *= 0.85 + 2.0 * clamp(h, -0.1, 0.1);
    if (uIce > 0.5) alb = mix(alb, vec3(0.9, 0.9, 0.92), smoothstep(1.2, 1.32, abs(lat)));
  } else if (uKind < 1.5) {
    // 가스 행성: 위도 띠 + 난류 + 대적점
    float w = fbm(vec3(n.x * 3.0, lat * 2.0, n.z * 3.0) + uSeed + vec3(uTime * 0.002, 0.0, 0.0), 5);
    float bands = sin(lat * 18.0 + w * 3.5) * 0.5 + 0.5;
    float fine = sin(lat * 55.0 + w * 6.0) * 0.5 + 0.5;
    alb = mix(uC2, uC1, bands * 0.75 + fine * 0.25);
    if (uSpot > 0.5) {
      vec3 sc = normalize(vec3(0.0, -0.38, 1.0) - uAxis * dot(vec3(0.0, -0.38, 1.0), uAxis) * 0.0);
      float d = length((n - normalize(uAxis * -0.37 + cross(uAxis, vec3(1.0, 0.0, 0.0)) * 0.93)) * vec3(0.55, 1.0, 0.55));
      alb = mix(alb, vec3(0.72, 0.32, 0.18), smoothstep(0.18, 0.1, d) * 0.9);
    }
  } else if (uCrack > 0.5) {
    // 유로파: 흰 얼음 위 붉은 갈색 균열 (리니에)
    float w = fbm(q * 4.0, 5);
    float cr = 0.0;
    for (int i = 0; i < 3; i++) { float f = fbm(q * (3.0 + float(i) * 2.3) + float(i) * 7.1, 4); cr = max(cr, 1.0 - smoothstep(0.0, 0.025, abs(f - 0.5))); }
    alb = mix(uC1, uC2, clamp(cr * 0.85 + smoothstep(0.55, 0.8, w) * 0.4, 0.0, 1.0));
  } else if (uKind < 2.5) {
    // 얼음 거인: 은은한 띠
    float w = fbm(n * 3.0 + uSeed, 4);
    alb = mix(uC2, uC1, 0.5 + 0.5 * sin(lat * 7.0 + w * 2.0)) * (0.95 + 0.1 * w);
  } else {
    // 두꺼운 구름 (금성/타이탄)
    float w = fbm(q * 3.0 + vec3(uTime * 0.003, 0.0, 0.0), 6);
    alb = mix(uC2, uC1, smoothstep(0.3, 0.7, w + 0.15 * sin(lat * 6.0)));
  }
  if (uHasMap > 0.5) {
    vec3 r1 = cross(uAxis, uRef);
    float lon = atan(dot(n, r1), dot(n, uRef)) + uTime * uRot;
    vec2 uv = vec2(fract(lon / 6.2831853 + 0.5), 0.5 + lat / 3.14159265);
    vec3 tex = mapTex(uMap, uv).rgb;
    // 가까이 가면 보이는 잔무늬 (암석 행성은 크레이터 음영)
    float det = uKind < 0.5 ? clamp(alb.r / max(uC1.r, 1e-3), 0.6, 1.4) : 1.0;
    alb = tex * uAlb * mix(1.0, det, 0.35) * (0.94 + 0.12 * fbm(q * 60.0, 3));
    // 지도 밝기 기울기로 지형 음영 (협곡·크레이터 가장자리)
    if (uKind < 0.5) {
      vec3 east = normalize(cross(uAxis, n) + 1e-5), north = cross(n, east);
      float du = 1.5 / 1024.0, dv = 1.5 / 512.0;
      float l0 = dot(tex, vec3(0.33));
      float le = dot(mapTex(uMap, uv + vec2(du, 0.0)).rgb, vec3(0.33)), ln = dot(mapTex(uMap, uv + vec2(0.0, dv)).rgb, vec3(0.33));
      nb = normalize(nb - (east * (le - l0) + north * (ln - l0)) * 1.6);
    }
  }
  // 암석 천체: 크레이터 높이장으로 법선 섭동 (빛 방향에 따라 그림자가 생김)
  if (uKind < 0.5) {
    vec3 t1 = normalize(cross(n, vec3(0.0, 1.0, 0.1))), t2 = cross(n, t1);
    float e = 0.004, h0 = relief(q);
    float hx = relief(normalize(n + t1 * e) + uSeed), hy = relief(normalize(n + t2 * e) + uSeed);
    nb = normalize(nb - (t1 * (hx - h0) + t2 * (hy - h0)) * 2.2 / e * (uHasMap > 0.5 ? 0.006 : 0.012));
  }
  float NL = dot(nb, uSunL);
  float ndv = max(dot(n, V), 0.0);
  vec3 col;
  if (uKind < 0.5) {
    // 대기 없는 암석: 로멜-지리거 반사 (보름 때 가장자리가 어두워지지 않음)
    float nl = max(NL, 0.0), nv = max(dot(nb, V), 1e-3);
    col = alb * mix(nl, nl / (nl + nv) * 2.0, 0.55) * 1.1;
  } else {
    // 가스·구름: 부드러운 명암 경계 + 가장자리 어두워짐
    float lit = clamp((dot(n, uSunL) + 0.05) / 1.05, 0.0, 1.0);
    col = alb * lit * (0.55 + 0.45 * pow(ndv, 0.35)) * 1.1;
  }
  // 대기: 가장자리 산란 (낮 쪽, 명암 경계에선 붉게)
  float NL0 = dot(n, uSunL);
  if (uAtm > 0.0) {
    float rim = pow(1.0 - ndv, 3.0);
    vec3 ac = mix(vec3(1.0, 0.45, 0.2), uAtmC, smoothstep(-0.05, 0.35, NL0));
    col += ac * rim * smoothstep(-0.3, 0.25, NL0) * 0.45 * uAtm;
  }
  col += alb * 0.004;     // 아주 희미한 밤쪽 (별빛)
  gl_FragColor = vec4(col * uI, 1.0);
}`;
// 토성 고리 (평면, 반지름에 따른 띠와 카시니 간극, 행성 그림자)
const RINGP_VS = /* glsl */`
varying vec3 vL;
varying vec3 vW;
void main() {
  vL = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = 0.5 * gl_Position.w;
}`;
const RINGP_FS = /* glsl */`
${NOISE}
uniform vec3 uSunL;
uniform vec3 uCenter;   // 행성 중심 (카메라 기준 km)
uniform float uR;       // 행성 반지름 (km)
uniform float uI;
varying vec3 vL;
varying vec3 vW;
void main() {
  float r = length(vL.xy) / uR;
  if (r < 1.24 || r > 2.27) discard;
  float t = (r - 1.24) / 1.03;
  float dens = 0.55 + 0.45 * sin(r * 90.0) * sin(r * 37.0) + 0.3 * vnoise(vec3(r * 300.0, 0.0, 0.0));
  // 멀리서 가는 띠가 화소보다 촘촘해지면 평균값으로 (깜빡이는 줄무늬 방지)
  float fw = fwidth(r);
  dens = mix(dens, 0.55, clamp(fw * 90.0 / 3.14, 0.0, 1.0) * 0.7 + clamp(fw * 300.0 / 3.14, 0.0, 1.0) * 0.3);
  dens *= 1.0 - smoothstep(1.95, 2.03, r) * (1.0 - smoothstep(2.03, 2.05, r)) * 0.9;   // 카시니 간극
  dens *= smoothstep(1.24, 1.32, r) * (1.0 - smoothstep(2.2, 2.27, r));
  dens = clamp(dens, 0.0, 1.0);
  vec3 c = mix(vec3(0.75, 0.68, 0.55), vec3(0.95, 0.9, 0.78), t) * 0.8;
  // 행성 그림자
  vec3 toC = uCenter - vW;
  float along = dot(toC, uSunL);
  float shadow = 1.0;
  if (along < 0.0) { float dperp = length(toC - uSunL * along); shadow = smoothstep(uR * 0.97, uR * 1.03, dperp); }
  gl_FragColor = vec4(c * dens * shadow * uI, dens);
}`;
// 먼 천체를 밝은 점으로 (행성은 각지름이 화소보다 작아도 하늘에서 보여야 함)
const DOT_VS = /* glsl */`
attribute float aI;
attribute float aSz;
varying float vI;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = 0.5 * gl_Position.w;
  gl_PointSize = aSz;
  vI = aI;
}`;
const DOT_FS = /* glsl */`
varying float vI;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = exp(-dot(q, q) * 14.0);
  gl_FragColor = vec4(vec3(1.0, 0.96, 0.9) * vI * a, 1.0);
}`;
// 소행성대
const BELT_VS = /* glsl */`
attribute float aB;
uniform vec3 uOff;      // 카메라 기준 태양 위치 (km)
uniform float uPR;
varying float vB;
void main() {
  vec4 mv = modelViewMatrix * vec4(position + uOff, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = 0.5 * gl_Position.w;
  float d = -mv.z;
  gl_PointSize = clamp(2.0e7 / max(d, 1.0), 1.0, 4.0) * uPR;
  vB = aB * clamp(4.0e7 / max(d, 1.0), 0.15, 1.0);
}`;
const BELT_FS = /* glsl */`
varying float vB;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = exp(-dot(q, q) * 12.0);
  gl_FragColor = vec4(vec3(0.75, 0.68, 0.6) * vB * a, 1.0);
}`;
// 안드로메다 은하 (먼 배경)
const GAL_FS = /* glsl */`
${NOISE}
uniform float uVis;
varying vec2 vUv;
void main() {
  vec2 p = vUv;
  float c = cos(0.6), s = sin(0.6);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  p.y *= 3.2;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float arms = 0.6 + 0.4 * sin(ang * 2.0 - log(r + 0.05) * 6.0);
  float I = exp(-r * 3.2) * (0.5 + 0.5 * arms) + exp(-r * 14.0) * 1.5;
  I *= 0.8 + 0.4 * fbm(vec3(p * 8.0, 1.0), 4);
  vec3 col = mix(vec3(0.6, 0.7, 1.0), vec3(1.0, 0.85, 0.65), exp(-r * 6.0)) * I;
  gl_FragColor = vec4(col * 0.35 * uVis * (1.0 - smoothstep(0.7, 1.0, length(vUv))), 1.0);
}`;
const GAL_VS = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  gl_Position = projectionMatrix * mv;
  gl_Position.z = 0.5 * gl_Position.w;
}`;

// 블랙홀 강착 원반: 안쪽이 희고 바깥은 주황, 소용돌이
const DISK_VS = /* glsl */`
varying vec3 vL;
void main() { vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = 0.5 * gl_Position.w; }`;
const DISK_FS = /* glsl */`
${NOISE}
uniform float uTime;
uniform float uR;
varying vec3 vL;
void main() {
  float r = length(vL.xy) / uR;
  float a = atan(vL.y, vL.x);
  float sw = fbm(vec3(cos(a - uTime * 0.6 / r) * r, sin(a - uTime * 0.6 / r) * r, r * 0.5), 5);
  float I = smoothstep(2.6, 3.2, r) * (1.0 - smoothstep(6.0, 9.0, r)) * (0.5 + sw) * 3.0 / (r - 2.0);
  vec3 col = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.95, 0.85), smoothstep(5.0, 3.0, r));
  gl_FragColor = vec4(col * I, 1.0);
}`;

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _cp = new THREE.Vector3(), _w = new THREE.Vector3();

// 실제 행성 지도 (파일, 자전 주기 h (음수 = 역방향), 밝기 배율)
// 대기 (산란 색, 세기, 껍질 두께 / 반지름)
const ATM = {
  venus: [[1.0, 0.86, 0.55], 1.0, 0.03], mars: [[0.95, 0.6, 0.45], 0.45, 0.012], titan: [[0.95, 0.62, 0.28], 1.2, 0.09],
  jupiter: [[0.8, 0.82, 0.95], 0.5, 0.012], saturn: [[0.92, 0.86, 0.7], 0.5, 0.012], uranus: [[0.6, 0.9, 1.0], 0.7, 0.02], neptune: [[0.45, 0.62, 1.0], 0.7, 0.02],
};
const MAPS = {
  mercury: ['mercury.jpg', 1407.6, 0.55], venus: ['venus.jpg', -5832.5, 0.9], mars: ['mars.jpg', 24.62, 0.5], jupiter: ['jupiter.jpg', 9.93, 1.0],
  saturn: ['saturn.jpg', 10.7, 0.95], uranus: ['uranus.jpg', -17.24, 0.9], neptune: ['neptune.jpg', 16.11, 0.9], pluto: ['pluto.jpg', -153.3, 0.65],
};

export class Space {
  constructor(renderer, opts = {}) {
    const low = opts.quality === 'low';
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.001, 2e9);
    this.camPlanet = new THREE.Vector3();     // 카메라 행성 좌표 (m)
    this.time = 0;
    this.sunDir = SUN_DIR.clone();

    this._buildStars(low);
    this._buildMilkyWay(low);
    this._buildSun();
    this._buildMoon(low);
    this._buildEarth(low);

    this.bodies = {
      earth: { group: this.earth, radius: RE, center: new THREE.Vector3(0, 0, 0) },
      moon: { group: this.moon, radius: RM, center: MOON.pos.clone() },
      sun: { group: this.sun, radius: RS, center: SUN.pos.clone() },
    };
    this._buildPlanets(low);
    this._buildBelt(low);
    this._buildDots();
    this._buildAndromeda();
    this._buildFar();
    this.list = [...BODIES, ...FAR].map((b) => Object.assign(this.bodies[b.id], { id: b.id, name: b.name }));
  }

  _buildPlanets(low) {
    const KIND = { rocky: 0, gas: 1, ice: 2, cloud: 3 };
    this.planetMats = [];
    let seed = 1;
    for (const b of BODIES) {
      if (b.id === 'sun' || b.id === 'earth' || b.id === 'moon') continue;
      const rk = b.radius / 1000;
      const map = MAPS[b.id];
      const u = {
        uSunL: { value: new THREE.Vector3() }, uAxis: { value: ECLIPTIC.n }, uC1: { value: new THREE.Color(...b.c1) }, uC2: { value: new THREE.Color(...b.c2) },
        uKind: { value: KIND[b.kind] }, uSeed: { value: seed++ * 3.7 }, uSpot: { value: b.spot ? 1 : 0 }, uIce: { value: b.ice ? 1 : 0 }, uTime: { value: 0 }, uI: { value: 1 },
        uMap: { value: map ? loadTex('./assets/' + map[0]) : null }, uHasMap: { value: map ? 1 : 0 }, uRef: { value: ECLIPTIC.u }, uRot: { value: map ? (2 * Math.PI) / (map[1] * 3600) : 0 }, uAlb: { value: map ? map[2] : 1 },
        uAtmC: { value: new THREE.Color(...(ATM[b.id] ? ATM[b.id][0] : [0, 0, 0])) }, uAtm: { value: ATM[b.id] ? ATM[b.id][1] : 0 }, uCrack: { value: b.id === 'europa' ? 1 : 0 },
      };
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(rk, low ? 64 : 112, low ? 32 : 56), new THREE.ShaderMaterial({
        vertexShader: BODY_VS, fragmentShader: PLANET_FS, uniforms: u, depthTest: false, depthWrite: false,
      }));
      mesh.frustumCulled = false;
      const grp = new THREE.Group();
      grp.add(mesh);
      // 대기가 있으면 바깥 빛무리 껍질
      if (ATM[b.id]) {
        const [c, k, th] = ATM[b.id];
        const halo = new THREE.Mesh(new THREE.SphereGeometry(rk * (1 + th), low ? 48 : 80, low ? 24 : 40), new THREE.ShaderMaterial({
          vertexShader: BODY_VS, fragmentShader: ATMO2_FS, uniforms: { uSunL: u.uSunL, uC: { value: new THREE.Color(...c) }, uI: u.uI, uK: { value: k * 1.6 } },
          depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
        halo.frustumCulled = false;
        grp.add(halo);
      }
      if (b.rings) {
        this.ringU = { uSunL: u.uSunL, uCenter: { value: new THREE.Vector3() }, uR: { value: rk }, uI: { value: 1 } };
        const ring = new THREE.Mesh(new THREE.RingGeometry(rk * 1.2, rk * 2.3, 256, 4), new THREE.ShaderMaterial({
          vertexShader: RINGP_VS, fragmentShader: RINGP_FS, uniforms: this.ringU, side: THREE.DoubleSide,
          depthTest: false, depthWrite: false, transparent: true,
        }));
        // 고리 평면: 황도에서 26.7° 기움
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ECLIPTIC.n.clone().applyAxisAngle(ECLIPTIC.u, 0.466));
        ring.frustumCulled = false;
        grp.add(ring);
        this.ring = ring;
      }
      this.scene.add(grp);
      this.bodies[b.id] = { group: grp, radius: rk, center: b.pos.clone(), mat: u };
      this.planetMats.push(u);
    }
  }

  _buildBelt(low) {
    const N = low ? 2500 : 7000;
    const pos = new Float32Array(N * 3), br = new Float32Array(N);
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      const a = (2.15 + 1.15 * Math.pow(rnd(), 0.8)) * AU / 1000, t = rnd() * Math.PI * 2, h = (rnd() - 0.5) * 0.12 * a;
      _v.copy(ECLIPTIC.u).multiplyScalar(Math.cos(t) * a).addScaledVector(ECLIPTIC.v, Math.sin(t) * a).addScaledVector(ECLIPTIC.n, h);
      pos.set([_v.x, _v.y, _v.z], i * 3);
      br[i] = 0.3 + 0.7 * rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aB', new THREE.BufferAttribute(br, 1));
    this.beltU = { uOff: { value: new THREE.Vector3() }, uPR: { value: 1 } };
    this.belt = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: BELT_VS, fragmentShader: BELT_FS, uniforms: this.beltU, depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    this.belt.frustumCulled = false;
    this.belt.renderOrder = -95;
    this.scene.add(this.belt);
  }

  _buildDots() {
    const N = BODIES.length;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aI', new THREE.BufferAttribute(new Float32Array(N), 1));
    g.setAttribute('aSz', new THREE.BufferAttribute(new Float32Array(N), 1));
    this.dots = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: DOT_VS, fragmentShader: DOT_FS, depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    this.dots.frustumCulled = false;
    this.dots.renderOrder = -90;
    this.scene.add(this.dots);
  }

  _buildAndromeda() {
    this.galU = { uVis: { value: 1 } };
    return;   // 안드로메다는 _buildFar 에서 실제 위치·거리로
    this.andromeda = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: GAL_VS, fragmentShader: GAL_FS, uniforms: this.galU, depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    this.andromeda.position.set(0.55, 0.62, 0.56).normalize().multiplyScalar(9e7);
    const half = 9e7 * Math.tan(0.06);
    this.andromeda.scale.set(half, half, 1);
    this.andromeda.frustumCulled = false;
    this.andromeda.renderOrder = -105;
    this.scene.add(this.andromeda);
  }

  // 실제 별: 히파르코스 목록 (6등급까지 약 5천 개, 적경·적위·등급·색지수) + 그보다 어두운 배경 별
  _buildStars(low) {
    this.starUniforms = { uPR: { value: this.renderer.getPixelRatio() }, uVis: { value: 1 } };
    const m = new THREE.ShaderMaterial({
      vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: this.starUniforms,
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    });
    const make = (ra, dec, mag, bv) => {
      const N = mag.length;
      const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        eqToLocal(ra[i], dec[i], _v).multiplyScalar(1e8);
        pos[i * 3] = _v.x; pos[i * 3 + 1] = _v.y; pos[i * 3 + 2] = _v.z;
        // 색지수(B-V) → 색: 푸른 별 ~ 붉은 별
        const t = Math.max(-0.4, Math.min(2.0, bv[i]));
        const c = t < 0 ? [0.68 + 0.5 * (t + 0.4), 0.78 + 0.4 * (t + 0.4), 1.0] : t < 0.6 ? [0.88 + 0.2 * t, 0.94, 1.0 - 0.18 * t] : [1.0, 0.94 - 0.22 * (t - 0.6), 0.89 - 0.38 * (t - 0.6)];
        col[i * 3] = c[0]; col[i * 3 + 1] = Math.max(0.5, c[1]); col[i * 3 + 2] = Math.max(0.3, c[2]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aMag', new THREE.BufferAttribute(new Float32Array(mag), 1));
      g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      pts.renderOrder = -100;
      this.scene.add(pts);
      return pts;
    };
    // 배경: 6~7.5 등급 별을 은하면에 몰리게 (실제 은하수 방향)
    const NB = low ? 2500 : 6000;
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ra = [], dec = [], mag = [], bv = [];
    const ar = [0, 0];
    for (let i = 0; i < NB; i++) {
      _v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
      if (rnd() < 0.55) _v.addScaledVector(GAL_N, -_v.dot(GAL_N) * (0.8 + 0.18 * rnd())).normalize();
      const e = this._toEq(_v, ar);
      ra.push(e[0]); dec.push(e[1]); mag.push(6 + 1.6 * rnd()); bv.push(rnd() * 1.4 - 0.1);
    }
    this.stars = make(ra, dec, mag, bv);
    fetch('./assets/stars.json').then((r) => r.json()).then((d) => {
      const S = d.stars, n = S.length / 4;
      const a = new Array(n), b = new Array(n), mg = new Array(n), c = new Array(n);
      for (let i = 0; i < n; i++) { a[i] = S[i * 4]; b[i] = S[i * 4 + 1]; mg[i] = S[i * 4 + 2]; c[i] = S[i * 4 + 3]; }
      this.realStars = make(a, b, mg, c);
      this.starCount = n;
    }).catch((e) => console.warn('[space] 별 목록 없음', e));
  }
  // 행성 좌표 방향 → 적경·적위 (도)
  _toEq(v, out) {
    const ex = v.x * GE.x + v.y * GU.x - v.z * GN.x, ey = v.x * GE.y + v.y * GU.y - v.z * GN.y, ez = v.x * GE.z + v.y * GU.z - v.z * GN.z;
    out[0] = ((Math.atan2(ey, ex) + GMST) * 180 / Math.PI + 720) % 360;
    out[1] = Math.asin(Math.max(-1, Math.min(1, ez))) * 180 / Math.PI;
    return out;
  }

  // 태양계 밖 천체: 별 (표면 + 빛무리), 블랙홀 (검은 구 + 강착 원반), 은하 (나선 판)
  _buildFar() {
    for (const f of FAR) {
      const grp = new THREE.Group();
      const rk = f.radius / 1000;
      const entry = { group: grp, radius: rk, center: f.pos.clone(), far: true, kind: f.kind };
      if (f.kind === 'star') {
        const T = f.temp;
        const tint = T > 8000 ? new THREE.Color(0.75, 0.85, 1.0) : T > 5500 ? new THREE.Color(1.0, 0.95, 0.85) : T > 4000 ? new THREE.Color(1.0, 0.8, 0.55) : new THREE.Color(1.0, 0.55, 0.3);
        const su = { uTime: this.sunUniforms.uTime, uI: { value: 1 }, uTint: { value: tint } };
        const body = new THREE.Mesh(new THREE.SphereGeometry(rk, 48, 24), new THREE.ShaderMaterial({ vertexShader: SUN_VS, fragmentShader: SUN_FS, uniforms: su, depthTest: false, depthWrite: false }));
        body.frustumCulled = false;
        const gu = { uR: { value: 0.1 }, uI: { value: 1 }, uTint: { value: tint.clone().multiplyScalar(0.9) } };
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: GLOW_VS, fragmentShader: GLOW_FS, uniforms: gu, depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
        glow.frustumCulled = false;
        grp.add(body, glow);
        entry.glow = glow; entry.glowU = gu;
      } else if (f.kind === 'blackhole') {
        const hole = new THREE.Mesh(new THREE.SphereGeometry(rk, 48, 24), new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, depthWrite: false }));
        hole.frustumCulled = false;
        const du = { uTime: this.sunUniforms.uTime, uR: { value: rk } };
        const disk = new THREE.Mesh(new THREE.RingGeometry(rk * 2.6, rk * 9, 128, 8), new THREE.ShaderMaterial({
          vertexShader: DISK_VS, fragmentShader: DISK_FS, uniforms: du, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
        }));
        disk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), GAL_N);
        disk.frustumCulled = false;
        grp.add(disk, hole);
      } else {
        const gu = { uVis: this.galU.uVis };
        const gal = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: GAL_VS, fragmentShader: GAL_FS, uniforms: gu, depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
        gal.scale.set(rk, rk, 1);
        gal.frustumCulled = false;
        grp.add(gal);
      }
      this.scene.add(grp);
      this.bodies[f.id] = entry;
    }
  }

  _buildMilkyWay(low) {
    const mwTex = loadTex('./assets/milkyway.png', false);
    mwTex.generateMipmaps = false; mwTex.minFilter = THREE.LinearFilter;   // 적경 0° 이음매에 선이 생기지 않게
    this.mwUniforms = { uGN: { value: GAL_N }, uGC: { value: GAL_C }, uVis: { value: 1 }, uMW: { value: mwTex },
      uEE: { value: GE }, uEU: { value: GU }, uEN: { value: GN }, uGMST: { value: GMST } };
    const m = new THREE.ShaderMaterial({
      vertexShader: MW_VS, fragmentShader: MW_FS, uniforms: this.mwUniforms, side: THREE.BackSide,
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    });
    this.milkyWay = new THREE.Mesh(new THREE.SphereGeometry(5e7, low ? 48 : 96, low ? 24 : 48), m);
    this.milkyWay.frustumCulled = false;
    this.milkyWay.renderOrder = -110;
    this.scene.add(this.milkyWay);
  }

  _buildSun() {
    this.sun = new THREE.Group();
    this.sunUniforms = { uTime: { value: 0 }, uI: { value: 1 }, uTint: { value: new THREE.Color(1.0, 0.93, 0.82) } };
    const body = new THREE.Mesh(new THREE.SphereGeometry(RS, 48, 24), new THREE.ShaderMaterial({
      vertexShader: SUN_VS, fragmentShader: SUN_FS, uniforms: this.sunUniforms, depthTest: false, depthWrite: false,
    }));
    body.frustumCulled = false;
    this.glowUniforms = { uR: { value: 0.1 }, uI: { value: 1 }, uTint: { value: new THREE.Color(1.0, 0.86, 0.7) } };
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: GLOW_VS, fragmentShader: GLOW_FS, uniforms: this.glowUniforms,
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    }));
    glow.frustumCulled = false;
    this.sunBody = body; this.sunGlow = glow;
    this.sun.add(body, glow);
    this.scene.add(this.sun);
  }

  _buildMoon(low) {
    const toEarth = MOON.pos.clone().negate().normalize();
    const ax = ECLIPTIC.n.clone();
    const ref = toEarth.clone().addScaledVector(ax, -toEarth.dot(ax)).normalize();
    this.moonUniforms = { uSun: { value: this.sunDir }, uI: { value: 1 }, uMap: { value: loadTex('./assets/moon.jpg') }, uAxis: { value: ax }, uRef: { value: ref } };
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(RM, low ? 64 : 128, low ? 32 : 64), new THREE.ShaderMaterial({
      vertexShader: BODY_VS, fragmentShader: MOON_FS, uniforms: this.moonUniforms, depthTest: false, depthWrite: false,
    }));
    this.moon.frustumCulled = false;
    this.scene.add(this.moon);
  }

  _buildEarth(low) {
    this.earth = new THREE.Group();
    const A = './assets/';
    this.earthUniforms = {
      uSun: { value: this.sunDir }, uTime: { value: 0 }, uI: { value: 1 },
      uGE: { value: GE }, uGU: { value: GU }, uGN: { value: GN },
      uDay: { value: loadTex(A + 'earth_day.jpg') }, uNight: { value: loadTex(A + 'earth_night.jpg') },
      uCloud: { value: loadTex(A + 'earth_clouds.jpg', false) }, uWater: { value: loadTex(A + 'earth_water.png', false) },
    };
    const surf = new THREE.Mesh(new THREE.SphereGeometry(RE, low ? 96 : 192, low ? 48 : 96), new THREE.ShaderMaterial({
      vertexShader: BODY_VS, fragmentShader: EARTH_FS, uniforms: this.earthUniforms, depthTest: false, depthWrite: false,
    }));
    surf.frustumCulled = false;
    this.atmoUniforms = { uSun: { value: this.sunDir }, uI: { value: 1 } };
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(RE + 90, low ? 64 : 128, low ? 32 : 64), new THREE.ShaderMaterial({
      vertexShader: BODY_VS, fragmentShader: ATMO_FS, uniforms: this.atmoUniforms,
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    }));
    atmo.frustumCulled = false;
    atmo.renderOrder = 1;
    this.earthSurf = surf; this.earthAtmo = atmo;
    this.earth.add(surf, atmo);
    this.scene.add(this.earth);
  }

  setBodyVisible(name, v) { const b = this.bodies[name]; if (b) b.group.visible = v; }

  // 행성 좌표 (m) → 우주 장면 좌표 (km, 카메라 기준)
  toCamera(pm, out) {
    return out.set((pm.x - this.camPlanet.x) / 1000, (pm.y - this.camPlanet.y) / 1000, (pm.z - this.camPlanet.z) / 1000);
  }

  update(dt, mainCamera, camAbs, altitude) {
    this.time += dt;
    flatToPlanet(camAbs.x, camAbs.y, camAbs.z, this.camPlanet);
    localToPlanetQuat(camAbs.x, camAbs.z, _q);
    const cam = this.camera;
    cam.quaternion.copy(_q).multiply(mainCamera.quaternion);
    cam.position.set(0, 0, 0);
    if (cam.fov !== mainCamera.fov || cam.aspect !== mainCamera.aspect) { cam.fov = mainCamera.fov; cam.aspect = mainCamera.aspect; }
    const alt = Math.max(0, altitude);

    // 천체 위치 (카메라 기준 km) + 거리순 그리기 + 먼 천체는 밝은 점
    let minD = Infinity;
    const L = this.list;
    const dPos = this.dots.geometry.attributes.position, dI = this.dots.geometry.attributes.aI, dS = this.dots.geometry.attributes.aSz;
    const pxPerRad = (this.renderer.domElement.height / 2) / Math.tan((cam.fov * Math.PI / 180) / 2);
    for (let k = 0; k < L.length; k++) {
      const b = L[k];
      this.toCamera(b.center, b.group.position);
      const d = b.group.position.length();
      b.dist = d - b.radius;
      if (b.group.visible) minD = Math.min(minD, b.dist);
      if (b.mat) {
        // 행성마다 태양 방향
        _w.subVectors(this.sun.position, b.group.position).normalize();
        b.mat.uSunL.value.copy(_w);
        b.mat.uTime.value = this.time;
      }
      // 각지름이 3 px 보다 작으면 점으로
      const px = Math.atan(b.radius / Math.max(d, 1)) * pxPerRad;
      dPos.setXYZ(k, b.group.position.x, b.group.position.y, b.group.position.z);
      let I = 0, sz = 0;
      if (b.id !== 'sun' && !b.far && b.group.visible && px < 3) {
        const dsun = Math.max(_w.subVectors(this.sun.position, b.group.position).length() / 1.496e8, 0.05);
        const flux = (b.radius * b.radius) / (dsun * dsun * Math.pow(Math.max(d / 1.496e8, 1e-4), 2));
        I = clamp(Math.sqrt(flux) * 2.2e-4, 0.08, 6);
        sz = clamp(2 + Math.log10(1 + flux) * 0.25, 2.2, 5) * this.renderer.getPixelRatio();
      }
      dI.setX(k, I); dS.setX(k, sz);
    }
    dPos.needsUpdate = true; dI.needsUpdate = true; dS.needsUpdate = true;
    const sorted = this._sorted || (this._sorted = L.slice());
    sorted.sort((a, b) => b.dist - a.dist);
    for (let i = 0; i < sorted.length; i++) {
      const o = sorted[i].group;
      o.renderOrder = i * 10;
      o.traverse((c) => { if (c !== o) c.renderOrder = i * 10 + (c === this.earthAtmo || c === this.ring ? 2 : c === this.sunGlow ? 3 : 1); });
    }
    if (this.ringU) { this.ringU.uCenter.value.copy(this.bodies.saturn.group.position); }
    this.beltU.uOff.value.copy(this.sun.position);
    this.beltU.uPR.value = this.renderer.getPixelRatio();
    // 가까운 천체 표면까지 거리로 near 결정 (잘림 방지)
    const near = clamp(minD * 0.3, 1e-5, 500);
    if (Math.abs(cam.near - near) > near * 0.05) cam.near = near;
    cam.far = 2e9;
    cam.updateProjectionMatrix();

    // 해 글로우: 거리와 무관하게 해 원반보다 넉넉한 쿼드
    const ds = this.sun.position.length();
    const angR = Math.asin(clamp(RS / ds, 0, 1));
    const glowAng = Math.max(angR * 9, 0.09);
    const halfW = ds * Math.tan(Math.min(glowAng, 1.2));
    this.sunGlow.scale.set(halfW, halfW, 1);
    this.sunGlow.position.set(0, 0, 0);
    this.glowUniforms.uR.value = clamp(Math.tan(angR) / Math.tan(Math.min(glowAng, 1.2)), 0, 0.95);
    this.sunUniforms.uTime.value = this.time;
    this.earthUniforms.uTime.value = this.time;
    // 먼 별: 가까이 가면 빛무리가 생김
    for (const b of L) {
      if (!b.glow) continue;
      const d = b.group.position.length();
      const aR = Math.asin(clamp(b.radius / d, 0, 1));
      const gA = Math.min(Math.max(aR * 9, 0.004), 1.2);
      const hw = d * Math.tan(gA);
      b.glow.scale.set(hw, hw, 1);
      b.glowU.uR.value = clamp(Math.tan(aR) / Math.tan(gA), 0, 0.95);
      b.glowU.uI.value = clamp(aR * 4000, 0, 1);
    }

    // 대기권 안에서는 낮하늘이 별을 가림 (world 하늘 돔이 불투명) → 여기서는 대기 투과만 근사
    const hk = smooth(15000, 90000, alt);
    this.starUniforms.uVis.value = 0.15 + 0.85 * hk;
    this.mwUniforms.uVis.value = hk;
    this.galU.uVis.value = hk;
    this.starUniforms.uPR.value = this.renderer.getPixelRatio();
    // 지구 대기 바깥 껍질은 대기권 밖에서만
    this.earthAtmo.visible = alt > 60000;
  }
}
