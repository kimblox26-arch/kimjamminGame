// FREE FREELY 우주 탐사 - 물리 상수 · 단위 · 표기
export const C_LIGHT = 299792458;            // m/s
export const LY = 9.4607304725808e15;        // m
export const AU = 1.495978707e11;            // m
export const G_CONST = 6.6743e-11;
export const M_SUN = 1.98892e30;
export const R_SUN = 6.957e8;
export const L_SUN = 3.828e26;               // W
export const DAY = 86400;
export const YEAR = 365.25 * DAY;
export const SIGMA = 5.670374e-8;
export const G0 = 9.80665;

/** 속도 단계 — 단계별 최대 속도(m/s) */
export const TIERS = [
  { id: 1, max: 40e3, name: '기동', desc: '행성 근처 기동 · 대기권 비행' },
  { id: 2, max: 100e3, name: '근거리', desc: '행성 간 근거리 이동' },
  { id: 3, max: 5e6, name: '항성계', desc: '항성계 내 이동' },
  { id: 4, max: 3e8, name: '광속', desc: '광속 워프' },
  { id: 5, max: 1.9e20, name: '은하간', desc: '은하 간 워프' },
];

const nf = (v, d = 0) => v.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d });

export function formatDistance(m) {
  const a = Math.abs(m);
  if (a < 1000) return nf(m, 0) + ' m';
  if (a < 1e7) return nf(m / 1000, a < 1e5 ? 2 : 1) + ' km';
  if (a < 0.05 * AU) return nf(m / 1000, 0) + ' km';
  if (a < 0.05 * LY) return nf(m / AU, a < 10 * AU ? 3 : 1) + ' AU';
  if (a < 1e6 * LY) return nf(m / LY, a < 100 * LY ? 2 : 0) + ' 광년';
  return nf(m / (1e6 * LY), 2) + ' 백만 광년';
}

export function formatSpeed(v) {
  const a = Math.abs(v);
  if (a < 1000) return nf(v, 0) + ' m/s';
  if (a < 0.01 * C_LIGHT) return nf(v / 1000, a < 1e5 ? 2 : 0) + ' km/s';
  return nf(v / 1000, 0) + ' km/s';
}

export function formatC(v) {
  const k = v / C_LIGHT;
  if (k < 0.001) return '';
  if (k < 10) return '광속 ×' + k.toFixed(k < 1 ? 3 : 2);
  if (k < 1e6) return '광속 ×' + nf(k, 0);
  return '광속 ×' + k.toExponential(2).replace('e+', '×10^');
}

export function formatDuration(s) {
  if (!isFinite(s) || s < 0) return '--';
  if (s < 60) return s.toFixed(s < 10 ? 1 : 0) + '초';
  if (s < 3600) return Math.floor(s / 60) + '분 ' + Math.floor(s % 60) + '초';
  if (s < 86400 * 2) return Math.floor(s / 3600) + '시간 ' + Math.floor((s % 3600) / 60) + '분';
  if (s < YEAR * 2) return nf(s / 86400, 1) + '일';
  return nf(s / YEAR, 1) + '년';
}

export function formatPressure(pa) {
  if (pa < 1e-3) return '진공';
  if (pa < 1000) return nf(pa, pa < 10 ? 2 : 0) + ' Pa';
  if (pa < 1e6) return nf(pa / 1000, 1) + ' kPa';
  return nf(pa / 1e5, 1) + ' bar';
}

export function formatTemp(k) {
  return nf(k - 273.15, 0) + ' °C';
}

/** 흑체 색온도 → 선형 RGB (근사) */
export function blackbody(T) {
  const t = T / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; } else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.52 * Math.log(t - 10) - 305.04;
  const c = (v) => Math.pow(Math.min(255, Math.max(0, v)) / 255, 2.2);
  return [c(r), c(g), c(b)];
}

/** 0..1 범위를 0..max 로 — 단계별 스로틀 매핑 (5단계는 지수 곡선으로 미세 조절) */
export function throttleToSpeed(tier, thr) {
  const max = TIERS[tier - 1].max;
  if (tier === 5) return max * Math.pow(thr, 8);
  if (tier === 4) return max * Math.pow(thr, 1.6);
  return max * thr;
}
