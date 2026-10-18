// SKY HERO — World
// 물리 기반 산란 하늘(Preetham) + HDR 태양, 태양광을 받는 적운(인스턴스 빌보드 1 draw call),
// 무한 흰 바닥(안티앨리어싱 격자 + 그림자 + 구름 그림자), 태양 DirectionalLight + HemisphereLight.
// 모든 커스텀 셰이더는 선형 HDR 을 출력한다 (톤매핑/sRGB 는 OutputPass 담당).
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const wrapHalf = (v, P) => v - Math.floor(v / P + 0.5) * P;   // [-P/2, P/2)
const wrap01 = (v, P) => { const r = v / P; return r - Math.floor(r); };

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 값 노이즈 (텍스처 생성용, 시작 시 1회) ----------
function hash2(ix, iy, s) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h & 0xffff) / 65535;
}
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y, s, oct) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) { sum += amp * vnoise(x * f, y * f, s + i * 17); norm += amp; amp *= 0.5; f *= 2.03; }
  return sum / norm;
}
function billow(x, y, s, oct) {   // 둥근 뭉게 형태 (|2n-1| 반전)
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) { sum += amp * (1 - Math.abs(2 * vnoise(x * f, y * f, s + i * 23) - 1)); norm += amp; amp *= 0.52; f *= 2.11; }
  return sum / norm;
}
function smax(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; }

// ---------- Preetham 상수 ----------
const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];

// ---------- 공용 대기 GLSL (하늘 / 바닥 안개 / 구름 연무 모두 같은 함수 → 지평선 이음매 없음) ----------
const GLSL_ATMOS = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uBetaR;
uniform vec3 uBetaM;
uniform float uSunE;
uniform float uMieG;
uniform float uLinMix;
uniform vec3 uFexH;
uniform float uSkyExposure;
uniform float uHorizonBand;
uniform float uHorizonPhase;
uniform vec2 uSkyKnee;
uniform vec3 uHazeAvg;
uniform float uHazeB0;
uniform float uHazeInvH;

float atmRayleighPhase(float c) { return 0.05968310365946075 * (1.0 + c * c); }
float atmHG(float c, float g) {
  float g2 = g * g;
  return 0.07957747154594767 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
}
vec3 atmScatter(float ct, vec3 fex) {
  float rP = atmRayleighPhase(ct * 0.5 + 0.5);
  float mP = atmHG(ct, uMieG);
  vec3 bT = (uBetaR * rP + uBetaM * mP) / (uBetaR + uBetaM);
  vec3 lin = pow(max(uSunE * bT * (1.0 - fex), vec3(0.0)), vec3(1.5));
  lin *= mix(vec3(1.0), pow(max(uSunE * bT * fex, vec3(0.0)), vec3(0.5)), uLinMix);
  vec3 c = ((lin + 0.1 * fex) * 0.04 + vec3(0.0, 0.0003, 0.00075)) * uSkyExposure;   // 선형 HDR
  // 소프트 니: 하늘 휘도를 블룸 임계(0.9) 아래로 눌러 태양 원반/코로나만 블룸되게
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float knee = uSkyKnee.x, top = uSkyKnee.y;
  float lc = lum < knee ? lum : knee + (top - knee) * (1.0 - exp(-(lum - knee) / (top - knee)));
  return c * (lc / max(lum, 1e-5));
}
vec3 atmFex(float y) {
  float za = acos(clamp(y, 0.0, 1.0));
  float inv = 1.0 / (cos(za) + 0.15 * pow(max(93.885 - za * 57.295779513, 1e-3), -1.253));
  return exp(-(uBetaR * (8.4e3 * inv) + uBetaM * (1.25e3 * inv)));
}
// 방향 dir 의 하늘 휘도 (태양 원반 제외). 지평선 근처는 연무 띠로 지평선 색에 합류.
vec3 skyRadiance(vec3 dir) {
  vec3 dh = vec3(dir.x, 0.0, dir.z);
  float l = length(dh);
  dh = l > 1e-4 ? dh / l : vec3(1.0, 0.0, 0.0);
  float y = max(dir.y, 0.0);
  float band = exp(-y * uHorizonBand);
  vec3 fex = mix(atmFex(y), uFexH, band);
  float ct = mix(dot(dir, uSunDir), dot(dh, uSunDir) * uHorizonPhase, band);
  vec3 c = atmScatter(ct, fex);
  return dir.y < 0.0 ? mix(uHazeAvg, c, smoothstep(0.0, 0.7, l)) : c;
}
// 먼 연무(지평선) 색. 수직에 가까운 방향은 방위 평균으로 수렴 (발밑 이음매 방지)
vec3 hazeColor(vec3 dir) {
  vec3 dh = vec3(dir.x, 0.0, dir.z);
  float l = length(dh);
  dh = l > 1e-4 ? dh / l : vec3(1.0, 0.0, 0.0);
  return mix(uHazeAvg, atmScatter(dot(dh, uSunDir) * uHorizonPhase, uFexH), smoothstep(0.0, 0.7, l));
}
// 지수 고도 분포 연무의 광학 두께 (카메라 고도 hc → 점 고도 hp, 거리 dist)
float hazeDepth(float dist, float hc, float hp) {
  hc = max(hc, 0.0); hp = max(hp, 0.0);
  float k = (hc - hp) * uHazeInvH;
  float f = abs(k) < 1e-3 ? 1.0 - 0.5 * k : (1.0 - exp(-k)) / k;
  return uHazeB0 * dist * exp(-hp * uHazeInvH) * f;
}
`;

// ---------- 하늘 돔 ----------
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;   // 돔이 카메라를 따라다니므로 로컬 위치 = 월드 방향 (원거리 정밀도 문제 없음)
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */`
${GLSL_ATMOS}
uniform vec3 uSunDisc;
uniform vec3 uSunGlow;
uniform float uSunR;
varying vec3 vDir;
float skyHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyRadiance(dir);
  float ct = dot(dir, uSunDir);
  float ang = sqrt(max(0.0, 2.0 * (1.0 - ct)));          // 태양과의 각거리 (rad)
  float aa = max(fwidth(ang), 1e-5);
  float above = smoothstep(-0.012, 0.004, dir.y);
  float disc = 1.0 - smoothstep(uSunR - aa, uSunR + aa, ang);
  float mu = sqrt(max(0.0, 1.0 - min(1.0, (ang * ang) / (uSunR * uSunR))));
  float limb = 1.0 - 0.5 * (1.0 - pow(mu, 0.6));         // 주연 감광
  col += uSunDisc * (disc * limb * above);
  float x = max(ang - uSunR, 0.0);
  col += uSunGlow * (exp(-x * 300.0) * 0.8 + exp(-x * 32.0) * 0.14 + exp(-x * 6.0) * 0.035) * above;
  col *= 1.0 + (skyHash(gl_FragCoord.xy) - 0.5) * 0.008;  // 미세 디더 (그라디언트 밴딩 방지)
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------- 구름 (카메라를 향한 빌보드, 인스턴스) ----------
const CLOUD_VERT = /* glsl */`
${GLSL_ATMOS}
attribute vec4 iA;   // xyz: 카메라 기준 상대 위치, w: 반경
attribute vec4 iB;   // x: 아틀라스 변형, y: 회전, z: 하늘광 가시도, w: 태양 가시도(자기 그림자)
attribute vec4 iC;   // x: 구름 바닥 높이(카메라 기준), y: 구름 두께, z: 불투명도(원거리 페이드 포함), w: 시드
attribute vec4 iD;   // xyz: 클러스터 거시 법선
uniform float uCamY;
varying vec3 vMacroN;
varying float vClose;
varying vec2 vUv;
varying vec3 vRel;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vToCam;
varying vec4 vInfo;
varying vec3 vHaze;
varying vec3 vBase;
void main() {
  vec3 c = iA.xyz;
  float r = iA.w;
  float dist = length(c);
  vec3 toCam = -c / max(dist, 1e-3);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 rr = cross(vec3(0.0, 1.0, 0.0), toCam);
  float rl = length(rr);
  vec3 cr = camRight - toCam * dot(camRight, toCam);
  vec3 right = normalize(mix(cr, rr / max(rl, 1e-4), smoothstep(0.04, 0.3, rl)) + vec3(1e-6));
  vec3 up = cross(toCam, right);
  float cs = cos(iB.y), sn = sin(iB.y);
  vec3 R = right * cs + up * sn;
  vec3 U = cross(toCam, R);
  vec3 p = c + (R * position.x + U * position.y) * r;
  vRel = p;
  vRight = R; vUp = U; vToCam = toCam;
  vMacroN = iD.xyz;
  float vi = iB.x;
  vUv = (vec2(mod(vi, 2.0), floor(vi * 0.5)) + uv) * 0.5;
  // 카메라가 퍼프 가까이/안에 있을 때 부드럽게 사라짐 (고속 통과 시 팝핑/모서리 방지)
  float nearF = smoothstep(r * 0.1, r * 0.8, dist);
  vClose = 1.0 - smoothstep(r * 0.9, r * 2.6, dist);   // 구름 속/근처: 음영 대비를 줄여 균일한 안개처럼
  float tau = hazeDepth(dist, uCamY, uCamY + c.y);
  vInfo = vec4(iB.w, iB.z, iC.z * nearF, exp(-tau));
  vHaze = skyRadiance(c / max(dist, 1e-3));
  vBase = vec3(iC.x, iC.y, r);
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * p, 1.0);
}`;

const CLOUD_FRAG = /* glsl */`
uniform vec3 uSunDir;
uniform sampler2D uAtlas;
uniform vec3 uCloudSun;
uniform vec3 uAmbTop;
uniform vec3 uAmbBottom;
uniform float uSilver;
uniform float uMacro;
uniform vec3 uMistColor;
varying vec3 vMacroN;
varying float vClose;
varying vec2 vUv;
varying vec3 vRel;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vToCam;
varying vec4 vInfo;
varying vec3 vHaze;
varying vec3 vBase;
float cloudHG(float c, float g) {
  float g2 = g * g;
  return 0.07957747154594767 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
}
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  float yIn = vRel.y - vBase.x;                          // 구름 바닥으로부터의 높이
  float baseCut = smoothstep(-0.03 * vBase.z, 0.2 * vBase.z, yIn);   // 적운의 평평한 바닥
  float fd = length(vRel);
  float a = t.a * vInfo.z * baseCut * smoothstep(2.0, 30.0, fd);
  if (a < 0.002) discard;
  vec3 nT = vec3(t.rg * 2.0 - 1.0, 0.0);
  nT.z = sqrt(max(0.0, 1.0 - dot(nT.xy, nT.xy)));
  vec3 N = normalize(vRight * nT.x + vUp * nT.y + vToCam * nT.z);
  N = normalize(mix(N, vMacroN, uMacro));   // 개별 퍼프의 '공' 음영 대신 구름 전체 형태로 음영
  float sunVis = vInfo.x;
  float hgt = clamp(yIn / max(vBase.y, 1.0), 0.0, 1.0);
  // 직사광: 감싸는 확산 + 클러스터 자기 그림자
  float ndl = dot(N, uSunDir);
  float diff = clamp(ndl * 0.6 + 0.4, 0.0, 1.0);
  diff = diff * (0.55 + 0.45 * diff);
  vec3 col = uCloudSun * (diff * sunVis);
  // 앰비언트: 위쪽은 하늘빛, 아래쪽은 바닥 반사광
  float skyW = clamp(0.38 + 0.42 * N.y + 0.35 * hgt, 0.0, 1.0);
  col += mix(uAmbBottom, uAmbTop, skyW) * mix(0.62, 1.0, vInfo.y);
  // 바닥 쪽 회청색 그늘
  col *= mix(0.74, 1.0, smoothstep(0.0, 0.5 * vBase.y, yIn));
  // 역광: 두꺼운 중심부는 어둡게, 얇은 가장자리는 전방 산란으로 은빛 테두리 (HDR → 블룸)
  vec3 V = vRel / max(fd, 1e-3);
  float cv = dot(V, uSunDir);
  float back = smoothstep(0.35, 0.97, cv);
  col *= 1.0 - back * 0.5 * smoothstep(0.15, 0.8, t.b);
  float ph = cloudHG(cv, 0.72);
  float thin = 1.0 - t.b;
  thin *= thin * (1.0 - 0.55 * t.a);
  col += uCloudSun * (ph * thin * uSilver * mix(0.35, 1.0, sunVis));
  col = mix(col, uMistColor, vClose * 0.6);
  // 대기 원근 (원경일수록 하늘/지평선 연무 색)
  col = mix(vHaze, col, vInfo.w);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------- 구름 속 안개 (전체 화면) ----------
const MIST_VERT = /* glsl */`
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const MIST_FRAG = /* glsl */`
uniform vec3 uMistColor;
uniform float uMist;
void main() {
  gl_FragColor = vec4(uMistColor, uMist);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------- 바닥 (MeshStandardMaterial 확장) ----------
const FLOOR_FRAG_PARS = /* glsl */`
${GLSL_ATMOS}
varying vec3 vFloorLocal;
uniform vec3 uCamLocal;
uniform vec4 uGridMinor;   // x 간격(m), y 선 두께(셀 단위), z 강도, w 페이드 거리
uniform vec4 uGridMajor;
uniform vec4 uGridSuper;
uniform vec3 uGridColor;
uniform sampler2D uCloudShadow;
uniform vec2 uCloudShadowOff;
uniform float uCloudShadowScale;
uniform float uCloudShadowAmt;
uniform float uSunComp;
uniform float uShadowAmt;
uniform float uPlaneR;
uniform float uHorizonSoft;
uniform vec2 uCloudShadowSize;
uniform vec2 uCloudFade;
vec4 csCubic(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x;
  return vec4(x, y, z, 6.0 - x - y - z) * (1.0 / 6.0);
}
// B-스플라인 바이큐빅 (4탭) — 저해상도 그림자 맵의 선형 보간 꺾임 제거
float cloudShadowAt(vec2 uv) {
  vec2 tc = uv * uCloudShadowSize - 0.5;
  vec2 f = fract(tc);
  tc -= f;
  vec4 xc = csCubic(f.x), yc = csCubic(f.y);
  vec4 c = tc.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 o = (c + vec4(xc.yw, yc.yw) / s) / uCloudShadowSize.xxyy;
  float s0 = texture2D(uCloudShadow, o.xz).r, s1 = texture2D(uCloudShadow, o.yz).r;
  float s2 = texture2D(uCloudShadow, o.xw).r, s3 = texture2D(uCloudShadow, o.yw).r;
  float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}
// Ben Golus 'pristine grid': 원거리에서 평균 피복률로 수렴 → 모아레 없음
float pristineGrid(vec2 uv, float lineW, float minPx) {
  vec4 dd = vec4(dFdx(uv), dFdy(uv));
  vec2 deriv = vec2(length(dd.xz), length(dd.yw));
  vec2 tw = clamp(max(vec2(lineW), deriv * minPx), 0.0, 0.06);
  vec2 drawW = clamp(tw, deriv, vec2(0.5));
  vec2 lineAA = deriv * 1.5;
  vec2 g = 1.0 - abs(fract(uv) * 2.0 - 1.0);
  vec2 g2 = 1.0 - smoothstep(drawW - lineAA, drawW + lineAA, g);
  g2 *= clamp(tw / drawW, 0.0, 1.0);
  g2 = mix(g2, tw, clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
  return mix(g2.x, 1.0, g2.y);
}
float gridLayer(vec2 p, vec4 L, float dist, float minPx) {
  return pristineGrid(p / L.x, L.y, minPx) * L.z * (1.0 - smoothstep(L.w * 0.3, L.w, dist));
}
`;

const FLOOR_GRID = /* glsl */`
{
  vec2 gp = vFloorLocal.xz;
  float gd = length(vFloorLocal - uCamLocal);
  float g1 = gridLayer(gp, uGridMinor, gd, 0.0);
  float g2 = gridLayer(gp, uGridMajor, gd, 0.0);
  float g3 = gridLayer(gp, uGridSuper, gd, 0.85) * smoothstep(50.0, 260.0, gd);   // 고도용 큰 격자 (최소 ~1px 폭)
  float gsum = 1.0 - (1.0 - g1) * (1.0 - g2) * (1.0 - g3);
  diffuseColor.rgb = mix(diffuseColor.rgb, uGridColor, gsum);
}
`;

const FLOOR_HAZE = /* glsl */`
{
  vec3 rel = vFloorLocal - uCamLocal;
  float dist = length(rel);
  vec3 vd = rel / max(dist, 1e-3);
  float T = exp(-hazeDepth(dist, uCamLocal.y, 0.0));
  T *= 1.0 - smoothstep(uPlaneR * 0.55, uPlaneR * 0.92, max(abs(vFloorLocal.x), abs(vFloorLocal.z)));
  // 지평선 바로 아래(시선 각도 기준)는 연무로 부드럽게 녹아듦 → 바닥/하늘 경계선 제거
  T *= smoothstep(0.0, uHorizonSoft * clamp(uCamLocal.y / 3.0, 0.2, 1.0), -vd.y);
  gl_FragColor.rgb = mix(hazeColor(vd), gl_FragColor.rgb, T);
}
`;

const DIR_INFO = 'getDirectionalLightInfo( directionalLight, directLight );';
const DIR_SHADOW = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
const DIR_SHADOW_NEW = 'directLight.color *= ( directLight.visible && receiveShadow ) ? mix( 1.0, getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ), uShadowAmt ) : 1.0;';

// ---------- 모듈 스코프 임시 객체 (프레임당 할당 없음) ----------
const _up = new THREE.Vector3(0, 1, 0);
const _lr = new THREE.Vector3();
const _lu = new THREE.Vector3();
const _c = new THREE.Vector3();
const _f = new THREE.Vector3();
const _col = new THREE.Color();

export class World {
  static EXPOSURE = 2.2;   // 이 월드의 밝기 기준 (바닥 ≈ 0.8 선형 → 블룸 임계 0.9 아래, 화면에서는 밝은 흰색)

  constructor(renderer, scene, opts = { quality: 'high' }) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = opts && opts.quality === 'low' ? 'low' : 'high';
    const low = this.quality === 'low';
    if (!opts || opts.setExposure !== false) renderer.toneMappingExposure = World.EXPOSURE;

    // 태양 방향 (태양을 향함). 고도 ≈ 32°
    this.sunDir = (opts && opts.sunDir) ? opts.sunDir.clone().normalize() : new THREE.Vector3(-0.42, 0.53, -0.74).normalize();

    // 튜닝 파라미터. sunIntensity/hemiIntensity/cloudShadow/grid*/wind 는 매 프레임 반영,
    // 나머지(대기·색)는 바꾼 뒤 world.applyParams() 호출 (유니폼만 갱신, 재컴파일 없음)
    this.params = {
      // 대기
      turbidity: 2.0, rayleigh: 1.8, mieCoefficient: 0.0015, mieG: 0.85,
      skyExposure: 0.197, horizonBand: 11.0, horizonPhase: 0.4, horizonSoft: 0.025,
      skyKnee: 0.6, skyTop: 0.8,   // 하늘 휘도 상한 (블룸 임계 0.9 아래)
      hazeB0: 1 / 7000, hazeHeight: 1500,
      // 태양 원반 (선형 HDR)
      sunDisc: 16, sunGlow: 1.4, sunDiameterDeg: 0.85,
      // 조명
      sunIntensity: 2.1, hemiIntensity: 1.5,
      // 구름
      cloudSun: 0.66, cloudAmb: 1.0, silver: 1.8, cloudShadow: 0.62,
      wind: new THREE.Vector3(3.2, 0, 1.4),
      // 격자
      gridMinor: 0.3, gridMajor: 0.42, gridSuper: 0.25,
    };

    this.fogColor = new THREE.Color();
    this.horizonColor = this.fogColor;      // 별칭
    this.skyColor = new THREE.Color();      // 상반구 평균 하늘빛
    this.sunColor = new THREE.Color(1.0, 0.965, 0.91);

    this.uniforms = this._makeAtmosUniforms();
    this._computeAtmosphere();

    this._buildSky(low);
    this._buildLights(low);
    this._buildFloor(low);
    this._buildClouds(low);
    this._buildMist();

    // 다른 재질(캐릭터/FX)용 안개 = 지평선 연무 평균색 (가까운 물체엔 거의 영향 없음)
    scene.fog = new THREE.FogExp2(new THREE.Color(), 0.00011);
    this.applyParams();

    // 상태 (읽기 전용으로 노출)
    this.sunVisibility = 1;     // 포커스(플레이어) 위치의 태양 가시도 (구름 그림자) 0..1
    this.cameraCloud = 0;       // 카메라 위치의 구름 농도 0..1 (화이트아웃 등에 사용 가능)
    this.camSpeed = 0;
    this._lastCam = new THREE.Vector3();
    this._hasLast = false;
    this._frame = 0;
  }

  /** params 변경 후 호출: 대기/색 유니폼 재계산 (런타임 가능, 셰이더 재컴파일 없음) */
  applyParams() {
    const p = this.params;
    this._computeAtmosphere();
    if (this.scene.fog && this.scene.fog.color) this.scene.fog.color.copy(this.fogColor);
    const su = this.skyUniforms;
    su.uSunDisc.value.copy(this.sunColor).multiplyScalar(p.sunDisc);
    su.uSunGlow.value.setRGB(1.0, 0.92, 0.8).multiplyScalar(p.sunGlow);
    su.uSunR.value = THREE.MathUtils.degToRad(p.sunDiameterDeg) * 0.5;
    this.sun.color.copy(this.sunColor);
    // 반구광: 하늘(옅은 푸른 흰빛) / 흰 바닥 반사(따뜻한 흰빛) → 그늘이 검지 않고 부드러운 청회색
    const sc = this.skyColor;
    const m = Math.max(sc.r, sc.g, sc.b, 1e-4);
    this.hemi.color.setRGB(sc.r / m, sc.g / m, sc.b / m).lerp(_col.setRGB(1, 1, 1), 0.55);
    this.hemi.groundColor.setRGB(0.93, 0.9, 0.86);
    const fu = this.floorUniforms;
    fu.uHorizonSoft.value = p.horizonSoft;
    fu.uGridSuper.value.z = p.gridSuper;
    this._updateCloudColors();
  }

  // ===================== 대기 =====================
  _makeAtmosUniforms() {
    return {
      uSunDir: { value: this.sunDir },
      uBetaR: { value: new THREE.Vector3() },
      uBetaM: { value: new THREE.Vector3() },
      uSunE: { value: 0 },
      uMieG: { value: 0.8 },
      uLinMix: { value: 0 },
      uFexH: { value: new THREE.Vector3() },
      uSkyExposure: { value: 1 },
      uHorizonBand: { value: 8 },
      uHorizonPhase: { value: 0.6 },
      uSkyKnee: { value: new THREE.Vector2(0.68, 0.88) },
      uHazeAvg: { value: new THREE.Color() },
      uHazeB0: { value: 1 / 5000 },
      uHazeInvH: { value: 1 / 1500 },
    };
  }

  _computeAtmosphere() {
    const p = this.params, u = this.uniforms, s = this.sunDir;
    const mc = 0.434 * (0.2 * p.turbidity) * 10e-18;
    const bR = [0, 0, 0], bM = [0, 0, 0];
    for (let i = 0; i < 3; i++) { bR[i] = TOTAL_RAYLEIGH[i] * p.rayleigh; bM[i] = mc * MIE_CONST[i] * p.mieCoefficient; }
    const sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(clamp(s.y, -1, 1))) / 1.5)));
    const linMix = clamp(Math.pow(1 - s.y, 5), 0, 1);
    this._atm = { bR, bM, sunE, linMix, mieG: p.mieG, exposure: p.skyExposure, band: p.horizonBand, hph: p.horizonPhase, knee: p.skyKnee, top: p.skyTop };
    const fexH = this._fex(0, [0, 0, 0]);
    this._atm.fexH = fexH;

    u.uBetaR.value.set(bR[0], bR[1], bR[2]);
    u.uBetaM.value.set(bM[0], bM[1], bM[2]);
    u.uSunE.value = sunE;
    u.uMieG.value = p.mieG;
    u.uLinMix.value = linMix;
    u.uFexH.value.set(fexH[0], fexH[1], fexH[2]);
    u.uSkyExposure.value = p.skyExposure;
    u.uHorizonBand.value = p.horizonBand;
    u.uHorizonPhase.value = p.horizonPhase;
    u.uSkyKnee.value.set(p.skyKnee, p.skyTop);
    u.uHazeB0.value = p.hazeB0;
    u.uHazeInvH.value = 1 / p.hazeHeight;

    // 지평선 방위 평균 = 안개색
    const out = [0, 0, 0];
    let r = 0, g = 0, b = 0;
    const NA = 64;
    for (let i = 0; i < NA; i++) {
      const a = (i / NA) * Math.PI * 2;
      const ct = (Math.cos(a) * s.x + Math.sin(a) * s.z) * p.horizonPhase;
      this._scatter(ct, fexH, out);
      r += out[0]; g += out[1]; b += out[2];
    }
    this.fogColor.setRGB(r / NA, g / NA, b / NA);
    u.uHazeAvg.value.copy(this.fogColor);

    // 상반구 코사인 가중 평균 하늘빛 (반구광 색)
    r = g = b = 0;
    let wsum = 0;
    for (let j = 0; j < 12; j++) {
      const el = ((j + 0.5) / 12) * (Math.PI / 2);
      const cy = Math.sin(el), ch = Math.cos(el);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        this._skyRadiance(Math.cos(a) * ch, cy, Math.sin(a) * ch, out);
        const w = cy * ch;
        r += out[0] * w; g += out[1] * w; b += out[2] * w; wsum += w;
      }
    }
    this.skyColor.setRGB(r / wsum, g / wsum, b / wsum);
  }

  // GLSL atmFex/atmScatter/skyRadiance 의 JS 사본
  _fex(y, out) {
    const A = this._atm;
    const za = Math.acos(clamp(y, 0, 1));
    const inv = 1 / (Math.cos(za) + 0.15 * Math.pow(Math.max(93.885 - za * 57.295779513, 1e-3), -1.253));
    for (let i = 0; i < 3; i++) out[i] = Math.exp(-(A.bR[i] * 8.4e3 * inv + A.bM[i] * 1.25e3 * inv));
    return out;
  }
  _scatter(ct, fex, out) {
    const A = this._atm;
    const rP = 0.05968310365946075 * (1 + (ct * 0.5 + 0.5) ** 2);
    const g = A.mieG, g2 = g * g;
    const mP = 0.07957747154594767 * (1 - g2) / Math.pow(Math.max(1 + g2 - 2 * g * ct, 1e-4), 1.5);
    const add = [0, 0.0003, 0.00075];
    for (let i = 0; i < 3; i++) {
      const bT = (A.bR[i] * rP + A.bM[i] * mP) / (A.bR[i] + A.bM[i]);
      let lin = Math.pow(Math.max(A.sunE * bT * (1 - fex[i]), 0), 1.5);
      lin *= lerp(1, Math.pow(Math.max(A.sunE * bT * fex[i], 0), 0.5), A.linMix);
      const c = (lin + 0.1 * fex[i]) * 0.04 + add[i];
      out[i] = c * A.exposure;
    }
    const lum = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
    const k = A.knee, t = A.top;
    const lc = lum < k ? lum : k + (t - k) * (1 - Math.exp(-(lum - k) / (t - k)));
    const f = lc / Math.max(lum, 1e-5);
    out[0] *= f; out[1] *= f; out[2] *= f;
    return out;
  }
  _skyRadiance(dx, dy, dz, out) {
    const s = this.sunDir, A = this._atm;
    let l = Math.hypot(dx, dz);
    const hx = l > 1e-4 ? dx / l : 1, hz = l > 1e-4 ? dz / l : 0;
    const y = Math.max(dy, 0);
    const band = Math.exp(-y * A.band);
    const f = this._fex(y, [0, 0, 0]);
    for (let i = 0; i < 3; i++) f[i] = lerp(f[i], A.fexH[i], band);
    const ct = lerp(dx * s.x + dy * s.y + dz * s.z, (hx * s.x + hz * s.z) * A.hph, band);
    return this._scatter(ct, f, out);
  }

  // ===================== 하늘 돔 =====================
  _buildSky(low) {
    const u = this.uniforms;
    this.skyUniforms = Object.assign({}, u, {
      uSunDisc: { value: new THREE.Color() },   // 선형 HDR (applyParams)
      uSunGlow: { value: new THREE.Color() },
      uSunR: { value: 0.005 },
    });
    const mat = new THREE.ShaderMaterial({
      name: 'SkyDome',
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    mat.extensions.derivatives = true;
    const geo = new THREE.SphereGeometry(1000, low ? 32 : 64, low ? 16 : 32);
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.name = 'skyDome';
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;   // 가장 먼저, 깊이 기록 없음 → 모든 것 뒤
    this.scene.add(this.sky);
  }

  // ===================== 조명 =====================
  _buildLights(low) {
    const p = this.params;
    const sun = new THREE.DirectionalLight(this.sunColor, p.sunIntensity);
    sun.name = 'sun';
    sun.castShadow = true;
    const sz = low ? 1024 : 2048;
    sun.shadow.mapSize.set(sz, sz);
    this.shadowExtent = 18;
    const cam = sun.shadow.camera;
    cam.left = -this.shadowExtent; cam.right = this.shadowExtent;
    cam.top = this.shadowExtent; cam.bottom = -this.shadowExtent;
    cam.near = 0.5; cam.far = 120;
    cam.updateProjectionMatrix();
    sun.shadow.normalBias = 0.025;
    sun.shadow.bias = -0.0002;
    sun.position.copy(this.sunDir).multiplyScalar(40);
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this._shadowTexel = (2 * this.shadowExtent) / sz;
    this._shadowFar = 120;
    // 광원 공간 축 (고정 태양 → 상수)
    _lr.crossVectors(_up, this.sunDir).normalize();
    _lu.crossVectors(this.sunDir, _lr).normalize();
    this._lightRight = _lr.clone();
    this._lightUp = _lu.clone();

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, p.hemiIntensity);   // 색은 applyParams
    this.hemi.name = 'skyHemi';
    this.scene.add(this.hemi);
  }

  // ===================== 바닥 =====================
  _buildFloor(low) {
    const p = this.params;
    const R = 28000;
    this.floorR = R;
    this.floorSnap = 256;
    // 중심부에 정점이 몰린 평면 (정밀도↑), XZ 평면, 법선 +Y
    const geo = new THREE.PlaneGeometry(2, 2, 48, 48);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setXYZ(i, Math.sign(x) * Math.pow(Math.abs(x), 3) * R, 0, Math.sign(z) * Math.pow(Math.abs(z), 3) * R);
    }
    pos.needsUpdate = true;
    geo.computeBoundingSphere();

    // 구름 그림자 텍스처 (구름 배치 후 채움)
    this.cloudPeriod = 14000;
    const csN = low ? 128 : 256;
    this.cloudShadowTex = new THREE.DataTexture(new Uint8Array(csN * csN), csN, csN, THREE.RedFormat, THREE.UnsignedByteType);
    this.cloudShadowTex.wrapS = this.cloudShadowTex.wrapT = THREE.RepeatWrapping;
    this.cloudShadowTex.magFilter = THREE.LinearFilter;
    this.cloudShadowTex.minFilter = THREE.LinearMipmapLinearFilter;
    this.cloudShadowTex.generateMipmaps = true;
    this.cloudShadowTex.unpackAlignment = 1;

    const u = this.uniforms;
    this.floorUniforms = Object.assign({}, u, {
      uCamLocal: { value: new THREE.Vector3() },
      uGridMinor: { value: new THREE.Vector4(4, 0.008, p.gridMinor, 140) },
      uGridMajor: { value: new THREE.Vector4(32, 0.0019, p.gridMajor, 900) },
      uGridSuper: { value: new THREE.Vector4(256, 0.0011, p.gridSuper, 6000) },
      uGridColor: { value: new THREE.Color(0.52, 0.58, 0.68) },
      uCloudShadow: { value: this.cloudShadowTex },
      uCloudShadowOff: { value: new THREE.Vector2() },
      uCloudShadowScale: { value: 1 / this.cloudPeriod },
      uCloudShadowAmt: { value: p.cloudShadow },
      uSunComp: { value: 1 },
      uShadowAmt: { value: 1 },
      uPlaneR: { value: R },
      uHorizonSoft: { value: p.horizonSoft },
      uCloudShadowSize: { value: new THREE.Vector2(csN, csN) },
      uCloudFade: { value: new THREE.Vector2(this.cloudPeriod * 0.5 * 0.68, this.cloudPeriod * 0.5 * 0.97) },
    });

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0.0 });
    mat.name = 'WhiteFloor';
    mat.fog = false;  // 자체 대기 연무 사용 (톤매핑 전에 적용)
    const fu = this.floorUniforms;
    const lightsChunk = THREE.ShaderChunk.lights_fragment_begin;
    let lights = lightsChunk.replace(DIR_INFO, DIR_INFO + '\n\t\tdirectLight.color *= floorSunMod;');
    lights = lights.replace(DIR_SHADOW, DIR_SHADOW_NEW);
    if (lights.indexOf('floorSunMod') < 0 || lights.indexOf('uShadowAmt') < 0) console.warn('[World] floor light chunk patch failed');
    const floorLights = /* glsl */`
material.specularF90 = 0.35;   // 무광 바닥: 스침각 반사 억제 (태양 쪽 눈부심 블룸 방지)
// 구름 그림자: 그림자를 드리운 구름(≈1.1 km 고도)이 구름장 반경 밖이면 페이드 (토러스 반복 그림자 숨김)
vec2 csRel = vFloorLocal.xz - uCamLocal.xz + uSunDir.xz * (1100.0 / max(uSunDir.y, 0.1));
float csFade = 1.0 - smoothstep(uCloudFade.x, uCloudFade.y, length(csRel));
float floorSunMod = uSunComp * mix(1.0, cloudShadowAt(vFloorLocal.xz * uCloudShadowScale + uCloudShadowOff), uCloudShadowAmt * csFade);
${lights}`;
    mat.onBeforeCompile = (sh) => {
      for (const k in fu) sh.uniforms[k] = fu[k];
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFloorLocal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFloorLocal = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FLOOR_FRAG_PARS)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + FLOOR_GRID)
        .replace('#include <lights_fragment_begin>', floorLights)
        .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + FLOOR_HAZE);
    };
    mat.customProgramCacheKey = () => 'skyhero-floor-v1';
    this.floor = new THREE.Mesh(geo, mat);
    this.floor.name = 'floor';
    this.floor.receiveShadow = true;
    this.floor.castShadow = false;
    this.floor.frustumCulled = false;
    this.floor.renderOrder = -10;
    this.scene.add(this.floor);
  }

  // ===================== 구름 =====================
  _buildClouds(low) {
    const P = this.cloudPeriod;
    const rnd = mulberry32(20261017);
    const clusters = [];
    const puffs = [];   // 생성용 임시 (생성 후 typed array 로 이동)
    const sun = this.sunDir;

    const addCluster = (x, z, baseY, W, H, elong, dirA) => {
      const cl = { x: ((x % P) + P) % P, z: ((z % P) + P) % P, y: baseY, W, H, start: puffs.length, count: 0, bound: Math.max(W * 0.75, H), rx: 0, ry: 0, rz: 0, fade: 0, op: 0.85 + rnd() * 0.15 };
      const ca = Math.cos(dirA), sa = Math.sin(dirA);
      const n = low ? clamp(Math.round(W / 60), 3, 16) : clamp(Math.round(W / 25), 6, 42);
      const rScale = low ? 1.3 : 1.0;
      const nb = Math.max(2, Math.round(n * 0.42));
      // 탑 중심 (비대칭)
      const tx = (rnd() - 0.5) * W * 0.18, tz = (rnd() - 0.5) * W * 0.18;
      for (let i = 0; i < n; i++) {
        let ox, oy, oz, r, variant;
        if (i < nb) {   // 넓고 평평한 바닥층
          const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.4 * W;
          const lx = Math.cos(a) * d * elong, lz = Math.sin(a) * d;
          ox = lx * ca - lz * sa; oz = lx * sa + lz * ca;
          oy = H * (0.1 + 0.12 * rnd());
          r = W * (0.19 + 0.08 * rnd()) * rScale;
          variant = rnd() < 0.6 ? 2 : 3;
        } else {        // 위로 부풀어 오르는 탑
          const hf = Math.pow(rnd(), 0.85);
          const allow = 0.34 * W * (1 - 0.7 * hf);
          const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * allow;
          ox = tx * hf + Math.cos(a) * d * (0.5 + 0.5 * elong);
          oz = tz * hf + Math.sin(a) * d;
          oy = H * (0.25 + 0.6 * hf);
          r = W * (0.17 + 0.08 * rnd()) * (1 - 0.4 * hf) * rScale;
          variant = rnd() < 0.45 ? 0 : (rnd() < 0.6 ? 1 : 3);
        }
        puffs.push({ cl: clusters.length, ox, oy, oz, r, variant, rot: (rnd() - 0.5) * 0.7, seed: rnd(), op: 0.82 + 0.18 * rnd(), sky: 1, sun: 1 });
      }
      cl.count = puffs.length - cl.start;
      clusters.push(cl);
      return cl;
    };

    // 구도용 대표 구름 (스폰 시점: +Z 전방, 태양 방향, 600m 고도 주변)
    const sh = Math.hypot(sun.x, sun.z);
    const sx = sun.x / sh, sz = sun.z / sh;
    addCluster(700, 2900, 760, 1150, 700, 1.3, 0.3);
    addCluster(-1500, 4300, 980, 1350, 760, 1.5, -0.2);
    addCluster(1900, 5200, 620, 900, 480, 1.2, 0.8);
    addCluster(sx * 2350 - sz * 260, sz * 2350 + sx * 260, 820, 980, 560, 1.2, 0.5);   // 태양 앞 (은빛 테두리)
    addCluster(-650, 1300, 430, 520, 260, 1.4, 1.1);   // 600 m 고도에서 가까이 보이는 구름
    addCluster(480, 900, 520, 380, 210, 1.2, 0.2);
    addCluster(-220, 2000, 640, 640, 330, 1.3, 2.2);
    addCluster(900, -1400, 560, 720, 380, 1.3, 1.6);

    // 나머지: 겹침을 피하며 무작위 배치 (토러스 주기 P)
    const target = low ? 58 : 96;
    let tries = 0;
    while (clusters.length < target && tries < 6000) {
      tries++;
      const big = rnd();
      const W = 180 + 1050 * Math.pow(big, 2.1);
      const x = rnd() * P, z = rnd() * P;
      let ok = true;
      for (const c of clusters) {
        const dx = wrapHalf(c.x - x, P), dz = wrapHalf(c.z - z, P);
        const md = (c.W + W) * 0.55;
        if (dx * dx + dz * dz < md * md) { ok = false; break; }
      }
      if (!ok) continue;
      const baseY = 300 + Math.pow(rnd(), 1.15) * 1500;
      const H = W * (0.38 + 0.4 * rnd());
      addCluster(x, z, baseY, W, H, 1 + rnd() * 0.7, rnd() * Math.PI);
    }

    // 자기 그림자 (태양/하늘 방향 광학 두께) — 고정 태양이라 1회 계산
    const chordTau = (pi, dx, dy, dz, c) => {
      let tau = 0;
      const a = puffs[pi];
      for (let j = c.start; j < c.start + c.count; j++) {
        if (j === pi) continue;
        const b = puffs[j];
        const ox = b.ox - a.ox, oy = b.oy - a.oy, oz = b.oz - a.oz;
        const tca = ox * dx + oy * dy + oz * dz;
        const R = b.r * 0.9;
        const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
        if (d2 >= R * R) continue;
        const half = Math.sqrt(R * R - d2);
        const t1 = tca + half;
        if (t1 <= 0) continue;
        const t0 = Math.max(tca - half, 0);
        tau += (t1 - t0) / (2 * R) * b.op;
      }
      return tau;
    };
    for (const c of clusters) {
      for (let i = c.start; i < c.start + c.count; i++) {
        const ts = chordTau(i, sun.x, sun.y, sun.z, c);
        const tu = chordTau(i, 0, 1, 0, c);
        puffs[i].sun = 0.28 + 0.72 * Math.exp(-ts * 0.9);
        puffs[i].sky = 0.4 + 0.6 * Math.exp(-tu * 0.6);
      }
    }

    // typed arrays
    const n = puffs.length;
    this.clusters = clusters;
    this.puffCount = n;
    this.pOff = new Float32Array(n * 3);
    this.pR = new Float32Array(n);
    this.pB = new Float32Array(n * 4);   // variant, rot, sky, sun
    this.pOp = new Float32Array(n);
    this.pSeed = new Float32Array(n);
    this.pCl = new Uint16Array(n);
    this.pN = new Float32Array(n * 3);   // 클러스터 중심 → 퍼프 방향 (거시 법선)
    for (let i = 0; i < n; i++) {
      const q = puffs[i];
      const cH = clusters[q.cl].H;
      let mx = q.ox, my = (q.oy - cH * 0.42) * 1.6 - cH * 0.1, mz = q.oz;
      const ml = Math.hypot(mx, my, mz) || 1;
      this.pN[i * 3] = mx / ml; this.pN[i * 3 + 1] = my / ml; this.pN[i * 3 + 2] = mz / ml;
      this.pOff[i * 3] = q.ox; this.pOff[i * 3 + 1] = q.oy; this.pOff[i * 3 + 2] = q.oz;
      this.pR[i] = q.r;
      this.pB[i * 4] = q.variant; this.pB[i * 4 + 1] = q.rot; this.pB[i * 4 + 2] = q.sky; this.pB[i * 4 + 3] = q.sun;
      this.pOp[i] = q.op * clusters[q.cl].op;
      this.pSeed[i] = q.seed;
      this.pCl[i] = q.cl;
    }
    this._keys = new Uint32Array(n);
    this._fillCloudShadow();

    // 인스턴스 버퍼 (매 프레임 정렬 후 전체 업로드: ~n*48 바이트)
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(2, 2);
    geo.setIndex(quad.index);
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    this.cloudData = new Float32Array(n * 16);
    const ib = new THREE.InstancedInterleavedBuffer(this.cloudData, 16, 1);
    ib.setUsage(THREE.DynamicDrawUsage);
    this.cloudBuffer = ib;
    geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(ib, 4, 0));
    geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(ib, 4, 4));
    geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(ib, 4, 8));
    geo.setAttribute('iD', new THREE.InterleavedBufferAttribute(ib, 4, 12));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);

    const p = this.params;
    this.cloudUniforms = Object.assign({}, this.uniforms, {
      uAtlas: { value: makePuffAtlas(low ? 128 : 256, 777) },
      uCamY: { value: 0 },
      uCloudSun: { value: new THREE.Color().copy(this.sunColor).multiplyScalar(p.cloudSun) },
      uAmbTop: { value: new THREE.Color() },
      uAmbBottom: { value: new THREE.Color() },
      uSilver: { value: p.silver },
      uMacro: { value: 0.42 },
      uMistColor: { value: new THREE.Color(0.8, 0.83, 0.88) },
    });
    const mat = new THREE.ShaderMaterial({
      name: 'Cumulus',
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: this.cloudUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.clouds = new THREE.Mesh(geo, mat);
    this.clouds.name = 'clouds';
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -50;   // 투명 객체 중 먼저 (FX 는 그 위에)
    this.scene.add(this.clouds);
  }

  _updateCloudColors() {
    const p = this.params, cu = this.cloudUniforms;
    // 위쪽 앰비언트 = 하늘빛, 아래쪽 = 흰 바닥 반사 (약간 회청색)
    // 하늘빛 + 구름 내부 다중 산란(태양색) 혼합 → 너무 파랗지 않은 흰 그늘
    const sl = 0.2126 * this.skyColor.r + 0.7152 * this.skyColor.g + 0.0722 * this.skyColor.b;
    _col.copy(this.sunColor).multiplyScalar(sl * 1.15);
    cu.uAmbTop.value.copy(this.skyColor).lerp(_col, 0.45).multiplyScalar(1.05 * p.cloudAmb);
    cu.uAmbBottom.value.setRGB(0.22, 0.24, 0.28).multiplyScalar(p.cloudAmb);
    cu.uCloudSun.value.copy(this.sunColor).multiplyScalar(p.cloudSun);
    cu.uSilver.value = p.silver;
    // 구름 속 안개색: 산란광 평균 (햇빛 절반 + 하늘빛)
    cu.uMistColor.value.copy(cu.uCloudSun.value).multiplyScalar(0.62).add(cu.uAmbTop.value);
  }

  // 구름 → 바닥 그림자 맵 (태양 방향으로 투영한 타원 가우시안 누적, 토러스 주기로 반복)
  _fillCloudShadow() {
    const tex = this.cloudShadowTex;
    const N = tex.image.width, P = this.cloudPeriod, px = P / N;
    const tau = new Float32Array(N * N);
    const s = this.sunDir;
    const sh = Math.hypot(s.x, s.z);
    const ax = s.x / sh, az = s.z / sh;           // 태양 방위 (그림자 늘어나는 축)
    const elong = 1 / Math.max(s.y, 0.2);
    for (let i = 0; i < this.puffCount; i++) {
      const c = this.clusters[this.pCl[i]];
      const wx = c.x + this.pOff[i * 3], wy = c.y + this.pOff[i * 3 + 1], wz = c.z + this.pOff[i * 3 + 2];
      const gx = wx - (s.x / s.y) * wy, gz = wz - (s.z / s.y) * wy;
      const sig = this.pR[i] * 0.45, sigL = sig * elong;
      const ext = Math.ceil((sigL * 2.6) / px);
      const cxp = gx / px, czp = gz / px;
      const amp = 1.25 * this.pOp[i];
      const i0 = Math.floor(cxp), j0 = Math.floor(czp);
      for (let dj = -ext; dj <= ext; dj++) {
        for (let di = -ext; di <= ext; di++) {
          const tx = (i0 + di + 0.5) * px - gx, tz = (j0 + dj + 0.5) * px - gz;
          const along = tx * ax + tz * az, across = -tx * az + tz * ax;
          const e = (along * along) / (2 * sigL * sigL) + (across * across) / (2 * sig * sig);
          if (e > 4.5) continue;
          const ii = ((i0 + di) % N + N) % N, jj = ((j0 + dj) % N + N) % N;
          tau[jj * N + ii] += amp * Math.exp(-e);
        }
      }
    }
    const data = tex.image.data;
    for (let k = 0; k < N * N; k++) data[k] = Math.round(255 * Math.exp(-tau[k] * 1.4));
    tex.needsUpdate = true;
  }

  _buildMist() {
    this.mistUniforms = { uMistColor: this.cloudUniforms.uMistColor, uMist: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      name: 'CloudMist',
      vertexShader: MIST_VERT,
      fragmentShader: MIST_FRAG,
      uniforms: this.mistUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mist = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mist.name = 'cloudMist';
    this.mist.frustumCulled = false;
    this.mist.renderOrder = 9000;
    this.scene.add(this.mist);
  }

  // ===================== 매 프레임 =====================
  update(dt, elapsed, camera, focus) {
    this._frame++;
    camera.updateWorldMatrix(true, false);
    const e = camera.matrixWorld.elements;
    const cx = e[12], cy = e[13], cz = e[14];
    if (!focus) focus = _f.set(cx, cy, cz);
    let fx = -e[8], fy = -e[9], fz = -e[10];
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;

    // 카메라 속도 (격자 시간 앨리어싱 방지용)
    if (this._hasLast && dt > 0) {
      const v = Math.hypot(cx - this._lastCam.x, cy - this._lastCam.y, cz - this._lastCam.z) / dt;
      if (v < 6000) this.camSpeed += (v - this.camSpeed) * (1 - Math.exp(-dt * 8));
    }
    this._lastCam.set(cx, cy, cz);
    this._hasLast = true;

    // 하늘 돔: 카메라 추적
    this.sky.position.set(cx, cy, cz);

    // 바닥: 격자 크기에 스냅해 카메라 아래로 재배치 (무늬는 월드 고정)
    const S = this.floorSnap, P = this.cloudPeriod, p = this.params;
    const px = Math.round(cx / S) * S, pz = Math.round(cz / S) * S;
    this.floor.position.set(px, 0, pz);
    const fu = this.floorUniforms;
    fu.uCamLocal.value.set(cx - px, cy, cz - pz);
    const dX = p.wind.x * elapsed, dZ = p.wind.z * elapsed;
    fu.uCloudShadowOff.value.set(wrap01(px - dX, P), wrap01(pz - dZ, P));
    fu.uGridMinor.value.z = p.gridMinor * (1 - 0.85 * smooth(110, 380, this.camSpeed));
    fu.uGridMajor.value.z = p.gridMajor * (1 - 0.6 * smooth(700, 1600, this.camSpeed));
    fu.uCloudShadowAmt.value = p.cloudShadow;

    // 태양 그림자 카메라
    const alt = Math.max(0, focus.y);
    this._updateShadow(focus, alt);
    fu.uShadowAmt.value = lerp(1, 0.22, smooth(3, 90, alt)) * (1 - smooth(110, 170, alt));

    // 구름
    this._updateClouds(cx, cy, cz, fx, fy, fz, elapsed, dX, dZ);

    // 플레이어 위치의 구름 그림자 → 태양광 세기 (바닥은 자체 구름 그림자 맵으로 보정)
    const vis = this._sunVisAt(focus.x - cx, focus.y - cy, focus.z - cz);
    const k = 1 - Math.exp(-dt * 5);
    this.sunVisibility += (vis - this.sunVisibility) * (this._frame < 3 ? 1 : k);
    const sv = lerp(1, this.sunVisibility, clamp(p.cloudShadow * 1.45, 0, 1));
    this.sun.intensity = p.sunIntensity * sv;
    fu.uSunComp.value = 1 / Math.max(sv, 0.05);
    this.hemi.intensity = p.hemiIntensity;

    // 카메라가 구름 속 → 화이트아웃 안개
    const dens = this._densityAtRel(0, 0, 0);
    this.cameraCloud += (dens - this.cameraCloud) * (1 - Math.exp(-dt * 10));
    const mistA = clamp(this.cameraCloud * 0.85, 0, 0.82);
    this.mistUniforms.uMist.value = mistA;
    this.mist.visible = this._frame < 4 || mistA > 0.003;   // 처음 몇 프레임은 표시 → 셰이더 사전 컴파일
  }

  _updateShadow(focus, alt) {
    const sun = this.sun, s = this.sunDir, t = this._shadowTexel;
    const lr = this._lightRight, lu = this._lightUp;
    const ax = focus.x * lr.x + focus.y * lr.y + focus.z * lr.z;
    const ay = focus.x * lu.x + focus.y * lu.y + focus.z * lu.z;
    const az = focus.x * s.x + focus.y * s.y + focus.z * s.z;
    const sx = Math.round(ax / t) * t, sy = Math.round(ay / t) * t;   // 텍셀 스냅 → 반짝임 방지
    _c.set(0, 0, 0).addScaledVector(lr, sx).addScaledVector(lu, sy).addScaledVector(s, az);
    sun.target.position.copy(_c);
    const back = 30;
    sun.position.copy(_c).addScaledVector(s, back);
    // 깊이 범위: 플레이어 위 back m ~ 바닥까지 (태양 방향 광선 길이)
    const far = Math.ceil((back + 12 + Math.min(alt, 180) / s.y) / 8) * 8;
    if (far !== this._shadowFar) {
      this._shadowFar = far;
      const cam = sun.shadow.camera;
      cam.far = far;
      cam.updateProjectionMatrix();
      sun.shadow.bias = -0.012 / (far - cam.near);   // ≈ 1.2 cm (월드 단위 고정)
    }
  }

  _updateClouds(cx, cy, cz, fx, fy, fz, elapsed, dX, dZ) {
    const P = this.cloudPeriod, half = P * 0.5;
    const f0 = half * 0.68, f1 = half * 0.97;
    const cls = this.clusters;
    for (let k = 0; k < cls.length; k++) {
      const c = cls[k];
      c.rx = wrapHalf(c.x + dX - cx, P);
      c.rz = wrapHalf(c.z + dZ - cz, P);
      c.ry = c.y - cy;
      c.fade = 1 - smooth(f0, f1, Math.hypot(c.rx, c.rz));
    }
    const keys = this._keys, off = this.pOff, R = this.pR, n = this.puffCount;
    let vis = 0;
    for (let i = 0; i < n; i++) {
      const c = cls[this.pCl[i]];
      if (c.fade <= 0.001) { keys[i] = 0xffffffff; continue; }
      const x = c.rx + off[i * 3], y = c.ry + off[i * 3 + 1], z = c.rz + off[i * 3 + 2];
      const r = R[i];
      if (x * fx + y * fy + z * fz < -r * 1.1) { keys[i] = 0xffffffff; continue; }   // 카메라 뒤
      const d = Math.sqrt(x * x + y * y + z * z);
      if (d < r * 0.1) { keys[i] = 0xffffffff; continue; }                        // 완전히 페이드된 근접 퍼프
      const q = Math.min(524287, (d * 16) | 0);
      keys[i] = q * 4096 + i;
      vis++;
    }
    keys.sort();
    const D = this.cloudData, B = this.pB;
    let w = 0;
    for (let j = vis - 1; j >= 0; j--) {     // 먼 것부터 (뒤→앞)
      const i = keys[j] & 4095;
      const c = cls[this.pCl[i]];
      const o = w * 16;
      D[o] = c.rx + off[i * 3]; D[o + 1] = c.ry + off[i * 3 + 1]; D[o + 2] = c.rz + off[i * 3 + 2];
      D[o + 3] = R[i] * (1 + 0.035 * Math.sin(elapsed * 0.07 + this.pSeed[i] * 6.283));
      D[o + 4] = B[i * 4]; D[o + 5] = B[i * 4 + 1]; D[o + 6] = B[i * 4 + 2]; D[o + 7] = B[i * 4 + 3];
      D[o + 8] = c.ry; D[o + 9] = c.H; D[o + 10] = this.pOp[i] * c.fade; D[o + 11] = this.pSeed[i];
      D[o + 12] = this.pN[i * 3]; D[o + 13] = this.pN[i * 3 + 1]; D[o + 14] = this.pN[i * 3 + 2];
      w++;
    }
    this.clouds.geometry.instanceCount = w;
    this.cloudBuffer.needsUpdate = true;
    this.cloudUniforms.uCamY.value = cy;
  }

  // 카메라 기준 상대 좌표 점에서 태양 방향 광선의 구름 투과율
  _sunVisAt(px, py, pz) {
    const s = this.sunDir, cls = this.clusters, off = this.pOff, R = this.pR;
    let tau = 0;
    for (let k = 0; k < cls.length; k++) {
      const c = cls[k];
      const ox = c.rx - px, oy = c.ry + c.H * 0.5 - py, oz = c.rz - pz;
      const t = ox * s.x + oy * s.y + oz * s.z;
      const B = c.bound;
      if (t < -B) continue;
      const d2 = ox * ox + oy * oy + oz * oz - t * t;
      if (d2 > B * B) continue;
      for (let i = c.start; i < c.start + c.count; i++) {
        const qx = c.rx + off[i * 3] - px, qy = c.ry + off[i * 3 + 1] - py, qz = c.rz + off[i * 3 + 2] - pz;
        const tca = qx * s.x + qy * s.y + qz * s.z;
        const rr = R[i] * 0.85;
        const e2 = qx * qx + qy * qy + qz * qz - tca * tca;
        if (e2 >= rr * rr) continue;
        const h = Math.sqrt(rr * rr - e2);
        const t1 = tca + h;
        if (t1 <= 0) continue;
        tau += (t1 - Math.max(tca - h, 0)) / (2 * rr) * this.pOp[i];
      }
    }
    return 0.12 + 0.88 * Math.exp(-tau * 1.5);
  }

  // 카메라 기준 상대 좌표 점의 구름 농도 0..1
  _densityAtRel(px, py, pz) {
    const cls = this.clusters, off = this.pOff, R = this.pR;
    let d = 0;
    for (let k = 0; k < cls.length; k++) {
      const c = cls[k];
      const ox = c.rx - px, oy = c.ry + c.H * 0.5 - py, oz = c.rz - pz;
      const B = c.bound * 1.2;
      if (ox * ox + oy * oy + oz * oz > B * B) continue;
      if (py < c.ry - 4) continue;   // 평평한 구름 바닥 아래
      for (let i = c.start; i < c.start + c.count; i++) {
        const qx = c.rx + off[i * 3] - px, qy = c.ry + off[i * 3 + 1] - py, qz = c.rz + off[i * 3 + 2] - pz;
        const dist = Math.sqrt(qx * qx + qy * qy + qz * qz);
        const r = R[i] * 0.8;
        if (dist >= r) continue;
        const f = 1 - dist / r;
        d += f * f * (3 - 2 * f) * this.pOp[i] * c.fade;
      }
    }
    return clamp(d * 0.9, 0, 1);
  }

  /** 월드 좌표 pos 의 구름 농도 0..1 (update 이후 호출) */
  cloudDensityAt(pos) {
    return this._densityAtRel(pos.x - this._lastCam.x, pos.y - this._lastCam.y, pos.z - this._lastCam.z);
  }
}

// ---------- 퍼프 텍스처 아틀라스 (2x2 변형). RG = 법선 xy, B = 두께, A = 밀도 ----------
function makePuffAtlas(S, seed) {
  const N = S * 2;
  const data = new Uint8Array(N * N * 4);
  const rnd = mulberry32(seed);
  const z = new Float32Array(S * S);
  const dens = new Float32Array(S * S);
  for (let v = 0; v < 4; v++) {
    const blobs = [];
    if (v === 2) {        // 넓고 납작한 바닥 퍼프
      blobs.push([-0.36, -0.2, 0.36], [0.0, -0.12, 0.44], [0.38, -0.2, 0.34]);
    } else if (v === 3) { // 둥근 덩어리
      blobs.push([0.0, -0.04, 0.5]);
    } else {              // 콜리플라워 탑
      blobs.push([0.0, -0.24, v === 0 ? 0.46 : 0.5]);
      const k = v === 0 ? 3 : 4;
      for (let j = 0; j < k; j++) {
        const a = Math.PI * (0.2 + 0.6 * ((j + 0.5) / k) + (rnd() - 0.5) * 0.12);
        const d = 0.26 + rnd() * 0.12;
        blobs.push([Math.cos(a) * d * 1.1, -0.18 + Math.sin(a) * d * (v === 0 ? 1.15 : 0.95), 0.25 + rnd() * 0.12]);
      }
    }
    // 실루엣 가장자리의 작은 혹들
    const base = blobs.length;
    const nb = v === 3 ? 14 : 10;
    for (let j = 0; j < nb; j++) {
      const b = blobs[Math.floor(rnd() * base)];
      const a = v === 3 ? rnd() * Math.PI * 2 : Math.PI * (0.05 + 0.9 * rnd());
      const d = b[2] * (0.72 + 0.22 * rnd());
      blobs.push([b[0] + Math.cos(a) * d, b[1] + Math.sin(a) * d, b[2] * (0.22 + 0.2 * rnd())]);
    }
    let ext = 0;
    for (const b of blobs) ext = Math.max(ext, Math.hypot(b[0], b[1]) + b[2]);
    const sc = 0.86 / ext;
    for (const b of blobs) { b[0] *= sc; b[1] *= sc; b[2] *= sc; }
    let zmax = 0;
    for (const b of blobs) zmax = Math.max(zmax, b[2]);
    const ns = 101 + v * 37;
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const x = ((i + 0.5) / S) * 2 - 1, y = ((j + 0.5) / S) * 2 - 1;
        let h = 0;
        for (let b = 0; b < blobs.length; b++) {
          const B = blobs[b];
          const dx = x - B[0], dy = y - B[1];
          const q = B[2] * B[2] - dx * dx - dy * dy;
          if (q > 0) h = smax(h, Math.sqrt(q), 0.07);
        }
        const n1 = billow(x * 2.6 + v * 7.1, y * 2.6, ns, 3);
        const n2 = fbm(x * 6.0, y * 6.0 + v * 3.3, ns + 50, 3);
        const hz = h + (n1 - 0.55) * 0.08 * smooth(0.0, 0.22, h) + (n2 - 0.5) * 0.022;
        z[j * S + i] = hz;
        const rad = Math.hypot(x, y);
        const edge = fbm(x * 5.0 + 11.0, y * 5.0, ns + 90, 3);
        const soft = lerp(0.32, 0.13, smooth(-0.45, 0.35, y));   // 위쪽은 또렷, 아래는 흐릿
        let dd = smooth(-0.02, soft, hz + (edge - 0.5) * lerp(0.16, 0.07, smooth(-0.45, 0.35, y)));
        dd = dd * dd * (1.6 - 0.6 * dd);   // 가장자리는 옅게, 중심은 빠르게 불투명
        dd *= 1 - smooth(0.86, 0.99, rad);
        dens[j * S + i] = dd;
      }
    }
    const ox = (v % 2) * S, oy = Math.floor(v / 2) * S;
    const inv = S / 2;   // dz/dx (도메인 단위) = Δz / (2 * 2/S)
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const k = j * S + i;
        const zl = z[j * S + Math.max(i - 1, 0)], zr = z[j * S + Math.min(i + 1, S - 1)];
        const zd = z[Math.max(j - 1, 0) * S + i], zu = z[Math.min(j + 1, S - 1) * S + i];
        let nx = -(zr - zl) * inv * 0.5, ny = -(zu - zd) * inv * 0.5, nz = 1;
        if (z[k] <= 0.0) {   // 바깥: 방사형 법선 (밉맵 평균 시 테두리 얼룩 방지)
          const x = ((i + 0.5) / S) * 2 - 1, y = ((j + 0.5) / S) * 2 - 1;
          nx = x; ny = y; nz = 0.25;
        }
        const nl = Math.hypot(nx, ny, nz);
        nx /= nl; ny /= nl;
        const o = ((oy + j) * N + ox + i) * 4;
        data[o] = Math.round((nx * 0.5 + 0.5) * 255);
        data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[o + 2] = Math.round(clamp(z[k] / zmax, 0, 1) * 255);
        data[o + 3] = Math.round(clamp(dens[k], 0, 1) * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  return tex;
}
