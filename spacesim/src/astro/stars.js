// SpaceSim — 항성 물리
// 흑체복사 색/광도, 주계열 질량-광도 관계, 분광형 분류, HR 도표 생성,
// 거주가능영역, 간이 항성 진화 트랙.

import { SI, AU_PER_RSUN } from '../core/constants.js';

/** 빈 변위 법칙 — 최대복사 파장 [nm] */
export const wienPeak = (T) => 2.897771955e6 / T;

/** 슈테판-볼츠만: 광도 [Lsun] ← 반지름 [Rsun], 온도 [K] */
export function luminosityFromRT(R, T) {
  return (R * R) * Math.pow(T / SI.Tsun, 4);
}

/** 반지름 [Rsun] ← 광도, 온도 */
export const radiusFromLT = (L, T) => Math.sqrt(L) * Math.pow(SI.Tsun / T, 2);

/** 플랑크 복사 함수 B_λ [W sr^-1 m^-3] */
export function planck(lambdaNm, T) {
  const l = lambdaNm * 1e-9;
  const a = 2 * SI.h * SI.c * SI.c / Math.pow(l, 5);
  const b = SI.h * SI.c / (l * SI.kB * T);
  return a / (Math.exp(b) - 1);
}

// CIE 1931 등색함수 근사 (Wyman et al. 2013, 다중 가우시안)
function cieX(w) {
  const g = (x, m, s1, s2) => x < m ? Math.exp(-0.5 * ((x - m) / s1) ** 2) : Math.exp(-0.5 * ((x - m) / s2) ** 2);
  return 1.056 * g(w, 599.8, 37.9, 31.0) + 0.362 * g(w, 442.0, 16.0, 26.7) - 0.065 * g(w, 501.1, 20.4, 26.2);
}
function cieY(w) {
  const g = (x, m, s1, s2) => x < m ? Math.exp(-0.5 * ((x - m) / s1) ** 2) : Math.exp(-0.5 * ((x - m) / s2) ** 2);
  return 0.821 * g(w, 568.8, 46.9, 40.5) + 0.286 * g(w, 530.9, 16.3, 31.1);
}
function cieZ(w) {
  const g = (x, m, s1, s2) => x < m ? Math.exp(-0.5 * ((x - m) / s1) ** 2) : Math.exp(-0.5 * ((x - m) / s2) ** 2);
  return 1.217 * g(w, 437.0, 11.8, 36.0) + 0.681 * g(w, 459.0, 26.0, 13.8);
}

/**
 * 흑체 온도 → sRGB (0~1). 플랑크 스펙트럼을 CIE 등색함수로 적분한 뒤
 * XYZ→linear sRGB 변환 후 감마 보정, 최대성분 정규화.
 */
export function blackbodyRGB(T) {
  let X = 0, Y = 0, Z = 0;
  for (let w = 380; w <= 780; w += 5) {
    const I = planck(w, T);
    X += I * cieX(w); Y += I * cieY(w); Z += I * cieZ(w);
  }
  const s = X + Y + Z;
  if (s <= 0) return [1, 1, 1];
  X /= s; Y /= s; Z /= s;
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let b = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  const gam = (c) => {
    c = Math.max(0, c);
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  r = gam(r); g = gam(g); b = gam(b);
  const mx = Math.max(r, g, b) || 1;
  return [r / mx, g / mx, b / mx];
}

/** 흑체 온도 → 0xRRGGBB */
export function blackbodyHex(T) {
  const [r, g, b] = blackbodyRGB(T);
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/** 주계열 질량-광도 관계 (구간별 멱법칙) */
export function msLuminosity(M) {
  if (M < 0.43) return 0.23 * Math.pow(M, 2.3);
  if (M < 2) return Math.pow(M, 4);
  if (M < 55) return 1.4 * Math.pow(M, 3.5);
  return 32000 * M;
}

/** 주계열 질량-반지름 관계 [Rsun] */
export function msRadius(M) {
  return M < 1 ? Math.pow(M, 0.8) : Math.pow(M, 0.57);
}

/** 주계열 유효온도 [K] */
export function msTemperature(M) {
  const L = msLuminosity(M), R = msRadius(M);
  return SI.Tsun * Math.pow(L / (R * R), 0.25);
}

/** 주계열 수명 [Gyr] — t ≈ 10 (M/L) Gyr */
export const msLifetime = (M) => 10 * M / msLuminosity(M);

const SPECTRAL = [
  { c: 'O', T: 30000, color: 0x9bb0ff },
  { c: 'B', T: 10000, color: 0xaabfff },
  { c: 'A', T: 7500, color: 0xcad7ff },
  { c: 'F', T: 6000, color: 0xf8f7ff },
  { c: 'G', T: 5200, color: 0xfff4ea },
  { c: 'K', T: 3700, color: 0xffd2a1 },
  { c: 'M', T: 2400, color: 0xffb56b },
  { c: 'L', T: 1300, color: 0xff7b4a },
];

/** 유효온도 → 분광형 (예: G2V) */
export function spectralClass(T, lumClass = 'V') {
  for (let i = 0; i < SPECTRAL.length; i++) {
    const s = SPECTRAL[i];
    if (T >= s.T) {
      const next = SPECTRAL[i - 1];
      const hi = next ? next.T : s.T * 2;
      const sub = Math.max(0, Math.min(9, Math.round(9 * (1 - (T - s.T) / (hi - s.T)))));
      return `${s.c}${sub}${lumClass}`;
    }
  }
  return `T0${lumClass}`;
}

/** 절대등급 ← 광도 [Lsun] (M_bol,sun = 4.74) */
export const absoluteMagnitude = (L) => 4.74 - 2.5 * Math.log10(L);

/** 거리지수 → 거리 [pc] */
export const distanceFromModulus = (m, M) => Math.pow(10, (m - M + 5) / 5);

/** 거주가능영역 [AU] — 광도 스케일링 (Kopparapu 근사) */
export function habitableZone(L) {
  return { inner: Math.sqrt(L / 1.1), outer: Math.sqrt(L / 0.53) };
}

/** 서리선(snow line) [AU] */
export const snowLine = (L) => 2.7 * Math.sqrt(L);

/** 슈바르츠실트 반지름 [AU] ← 질량 [Msun] */
export function schwarzschildRadius(M) {
  return 2 * SI.G * M * SI.Msun / (SI.c * SI.c) / SI.AU;
}

/** 찬드라세카르 한계 [Msun] */
export const CHANDRASEKHAR = 1.44;

/** 항성 최종 운명 */
export function stellarFate(M) {
  if (M < 0.08) return { end: '갈색왜성', remnant: '축퇴 물체', note: '수소 핵융합 점화 실패' };
  if (M < 0.5) return { end: '헬륨 백색왜성', remnant: 'WD', note: '우주 나이보다 수명이 길다' };
  if (M < 8) return { end: '행성상성운 → 백색왜성', remnant: 'C/O WD', note: `잔해 질량 ≈ ${(0.109 * M + 0.394).toFixed(2)} M☉` };
  if (M < 20) return { end: 'II형 초신성 → 중성자별', remnant: 'NS', note: '반경 ≈ 11 km' };
  if (M < 40) return { end: '초신성 → 블랙홀', remnant: 'BH', note: `R_s ≈ ${(schwarzschildRadius(M * 0.3) * 1.496e8).toFixed(1)} km` };
  return { end: '직접 붕괴 / 쌍불안정', remnant: 'BH', note: '질량 대부분이 블랙홀로' };
}

/** 간이 주계열 진화: 나이 비율 f 에 따른 광도·온도 (태양 유사) */
export function evolveMainSequence(M, ageGyr) {
  const life = msLifetime(M);
  const f = Math.min(1, ageGyr / life);
  // 주계열 동안 광도 약 +60% 증가 (태양 모델 근사)
  const L = msLuminosity(M) * (1 + 0.6 * f);
  const R = msRadius(M) * (1 + 0.25 * f);
  const T = SI.Tsun * Math.pow(L / (R * R), 0.25);
  return { L, R, T, fraction: f, lifetime: life, evolved: f >= 1 };
}

/** HR 도표용 주계열 곡선 데이터 */
export function mainSequenceTrack(n = 120) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const M = Math.pow(10, -1.1 + (2.0 * i) / (n - 1)); // 0.08 ~ 100 Msun
    const L = msLuminosity(M);
    const T = msTemperature(M);
    out.push({ M, L, T, color: blackbodyHex(T), spectral: spectralClass(T) });
  }
  return out;
}

/** 대표 항성 카탈로그 (HR 도표 표시용) */
export const STAR_CATALOG = [
  { name: '태양', T: 5772, L: 1, M: 1 },
  { name: '시리우스 A', T: 9940, L: 25.4, M: 2.06 },
  { name: '시리우스 B', T: 25200, L: 0.056, M: 1.02 },
  { name: '베텔게우스', T: 3600, L: 126000, M: 16.5 },
  { name: '리겔', T: 12100, L: 120000, M: 21 },
  { name: '프록시마', T: 3042, L: 0.0017, M: 0.122 },
  { name: '알데바란', T: 3900, L: 439, M: 1.16 },
  { name: '베가', T: 9602, L: 40.1, M: 2.14 },
  { name: '아크투루스', T: 4286, L: 170, M: 1.08 },
  { name: '스피카', T: 22400, L: 20500, M: 11.4 },
  { name: '폴룩스', T: 4586, L: 43, M: 1.91 },
  { name: '바너드별', T: 3134, L: 0.0035, M: 0.144 },
  { name: '안타레스', T: 3660, L: 97700, M: 12 },
  { name: '데네브', T: 8525, L: 196000, M: 19 },
  { name: '알타이르', T: 7550, L: 10.6, M: 1.79 },
  { name: '카펠라 Aa', T: 4970, L: 78.7, M: 2.57 },
  { name: '리길 켄타우루스 B', T: 5260, L: 0.5, M: 0.907 },
  { name: '포말하우트', T: 8590, L: 16.6, M: 1.92 },
  { name: 'UY 스쿠티', T: 3365, L: 340000, M: 10 },
  { name: '프로키온 B', T: 7740, L: 0.00049, M: 0.602 },
];
