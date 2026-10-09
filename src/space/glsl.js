// FREE FREELY 우주 탐사 - 공용 GLSL 조각 (대기 산란, 구름 노이즈, 로그 깊이)

export const LOGDEPTH_VS_PARS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
`;
export const LOGDEPTH_VS = /* glsl */`
#include <logdepthbuf_vertex>
`;
export const LOGDEPTH_FS_PARS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
`;
export const LOGDEPTH_FS = /* glsl */`
#include <logdepthbuf_fragment>
`;

/** 대기 매개변수 유니폼 (행성 반지름 단위로 미리 스케일) */
export const ATMO_PARS = /* glsl */`
uniform float uAtR;        // 대기 상단 반지름 (행성 반지름 = 1)
uniform vec3 uAtBetaR;     // 레일리 산란 계수 × R
uniform vec3 uAtBetaM;     // 미 산란 계수 × R
uniform vec3 uAtBetaMExt;  // 미 소광 계수 × R
uniform float uAtHR;       // 레일리 척도고도 / R
uniform float uAtHM;       // 미 척도고도 / R
uniform float uAtG;        // 미 비대칭 계수
uniform vec3 uAtMieTint;   // 전방 산란 색조 (화성의 푸른 노을)
uniform vec3 uAtSun;       // 태양 조도 (색 × 세기)
uniform float uAtOn;

vec2 rsph(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  vec3 q = ro - b * rd;
  float h = r * r - dot(q, q);
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

float phaseR(float mu) { return 0.0596831 * (1.0 + mu * mu); }
float phaseM(float mu, float g) {
  float g2 = g * g;
  return 0.1193662 * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(max(1e-4, 1.0 + g2 - 2.0 * g * mu), 1.5));
}

/** p 에서 태양 방향 광학 깊이 (레일리, 미) — 행성에 가리면 큰 값 */
vec2 lightDepth(vec3 p, vec3 L, int steps) {
  vec2 pl = rsph(p, L, 1.0);
  if (pl.x > 0.0 && pl.x < pl.y) {
    // 지평선 근처 부드러운 전환 (지형 노이즈 대신 반그림자)
    return vec2(1e3);
  }
  vec2 at = rsph(p, L, uAtR);
  float len = max(0.0, at.y);
  float ds = len / float(steps);
  vec2 od = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= steps) break;
    vec3 q = p + L * (ds * (float(i) + 0.5));
    float h = length(q) - 1.0;
    od += exp(-h / vec2(uAtHR, uAtHM)) * ds;
  }
  return od;
}

/**
 * 시선 [t0, t1] 구간 대기 산란 적분.
 * ro: 행성 중심 기준 카메라 위치(R 단위), rd: 시선 방향
 * 반환: inscatter(rgb), 투과율은 trans 로
 */
vec3 atmoIntegrate(vec3 ro, vec3 rd, float t0, float t1, vec3 L, int steps, int lsteps, out vec3 trans) {
  trans = vec3(1.0);
  if (t1 <= t0) return vec3(0.0);
  float ds = (t1 - t0) / float(steps);
  vec2 odv = vec2(0.0);
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float mu = dot(rd, L);
  for (int i = 0; i < 24; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * (t0 + ds * (float(i) + 0.5));
    float h = max(0.0, length(p) - 1.0);
    vec2 dens = exp(-h / vec2(uAtHR, uAtHM)) * ds;
    odv += dens;
    vec2 odl = lightDepth(p, L, lsteps);
    vec3 tau = uAtBetaR * (odv.x + odl.x) + uAtBetaMExt * (odv.y + odl.y);
    vec3 att = exp(-tau);
    sumR += att * dens.x;
    sumM += att * dens.y;
  }
  trans = exp(-(uAtBetaR * odv.x + uAtBetaMExt * odv.y));
  vec3 mieCol = uAtBetaM * mix(vec3(1.0), uAtMieTint, smoothstep(0.86, 0.995, mu));
  return (sumR * uAtBetaR * phaseR(mu) + sumM * mieCol * phaseM(mu, uAtG)) * uAtSun;
}

/** 지표 한 점에서 태양빛 투과율 (정점 셰이더용 간이 계산) */
vec3 sunTransmittance(vec3 p, vec3 L) {
  vec2 od = lightDepth(p, L, 4);
  return exp(-(uAtBetaR * od.x + uAtBetaMExt * od.y));
}
`;

/** 구름 밀도 함수 (3D 노이즈 텍스처) */
export const CLOUD_PARS = /* glsl */`
uniform sampler3D uCloudTex;
uniform float uClBase;      // 구름 바닥 (R 단위 높이)
uniform float uClTop;
uniform float uClCover;     // 덮임 0..1
uniform float uClDensity;   // 소광 (R 단위 길이당)
uniform float uClScale;     // 노이즈 크기 (R 단위)
uniform vec3 uClColor;
uniform float uClTime;
uniform float uClOn;
uniform float uClCirrus;    // 권운 고도 (R 단위, 0 = 없음)

float cloudCoverage(vec3 dirL) {
  vec3 q = dirL * (1.0 / (uClScale * 18.0));
  float c = texture(uCloudTex, q * 0.25 + vec3(uClTime * 0.0004, 0.0, 0.0)).a * 0.6
          + texture(uCloudTex, q * 0.9 + vec3(0.0, uClTime * 0.0007, 0.0)).r * 0.4;
  // 위도별 기후대 (적도 수렴대·편서풍대 많고 아열대 고압대 적음)
  float lat = abs(dirL.y);
  float climate = 0.9 + 0.25 * cos(lat * 9.0) - 0.15 * smoothstep(0.6, 1.0, lat);
  return smoothstep(1.0 - uClCover * climate, 1.0 - uClCover * climate + 0.32, c);
}

float cloudDensityAt(vec3 pL, float hN) {
  // hN: 구름층 내 높이 비율 0..1
  float shape = smoothstep(0.0, 0.12, hN) * smoothstep(1.0, 0.45, hN);
  vec3 dirL = normalize(pL);
  float cov = cloudCoverage(dirL);
  if (cov <= 0.001) return 0.0;
  vec3 q = pL / uClScale + vec3(uClTime * 0.004, 0.0, uClTime * 0.002);
  vec4 n = texture(uCloudTex, q);
  float d = n.r * 0.7 + n.g * 0.3;
  d = clamp((d - (1.0 - cov * shape)) / max(0.08, cov * shape), 0.0, 1.0);
  float det = texture(uCloudTex, q * 4.3).b;
  d = clamp(d - (1.0 - det) * 0.25 * (1.0 - d), 0.0, 1.0);
  return d;
}
`;
