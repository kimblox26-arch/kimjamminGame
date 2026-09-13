// SpaceSim — 물리 상수 및 단위계
//
// 내부 시뮬레이션 단위계 (astronomical unit system):
//   길이 = AU, 시간 = day, 질량 = M_sun
// 이 단위계에서 G = k^2 (가우스 중력상수의 제곱) = 2.959122082855911e-4

export const G_SIM = 2.959122082855911e-4; // AU^3 / (Msun * day^2)
export const C_SIM = 173.1446326846693;    // 광속 [AU/day]

// ── SI 상수 (CODATA 2018 / IAU 2015 공칭값) ──
export const SI = {
  G: 6.67430e-11,          // m^3 kg^-1 s^-2
  c: 2.99792458e8,         // m/s
  h: 6.62607015e-34,       // J s
  kB: 1.380649e-23,        // J/K
  sigma: 5.670374419e-8,   // W m^-2 K^-4
  mp: 1.67262192369e-27,   // kg
  me: 9.1093837015e-31,    // kg
  eV: 1.602176634e-19,     // J
  Msun: 1.98892e30,        // kg
  Rsun: 6.957e8,           // m
  Lsun: 3.828e26,          // W
  Tsun: 5772,              // K
  Mearth: 5.9722e24,       // kg
  Rearth: 6.3781e6,        // m
  AU: 1.495978707e11,      // m
  pc: 3.0856775814913673e16, // m
  ly: 9.4607304725808e15,  // m
  day: 86400,              // s
  yr: 3.155693e7,          // s (율리우스년 기준 근사)
  jyr: 3.15576e7,          // s (율리우스년)
};

// ── 단위 환산 ──
export const AU_PER_KM = 1 / 1.495978707e8;
export const KM_PER_AU = 1.495978707e8;
export const DAY_PER_YEAR = 365.25;
export const AU_PER_PC = 206264.806247;
export const AU_PER_RSUN = SI.Rsun / SI.AU;      // 0.004650467
export const MSUN_PER_MEARTH = SI.Mearth / SI.Msun;
export const MSUN_PER_MJUP = 1.89813e27 / SI.Msun;

/** AU/day → km/s */
export const auday2kms = (v) => v * KM_PER_AU / SI.day;
/** km/s → AU/day */
export const kms2auday = (v) => v * SI.day / KM_PER_AU;

/** 허블상수 H0 [km/s/Mpc] → 1/Gyr */
export const h0ToInvGyr = (H0) => H0 * 1e3 * (1e9 * SI.jyr) / (1e6 * SI.pc);

// ── 포맷터 ──
const SUFFIX = ['', 'k', 'M', 'G', 'T', 'P'];

export function fmt(x, digits = 3) {
  if (!isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a === 0) return '0';
  if (a >= 1e5 || a < 1e-3) {
    const e = Math.floor(Math.log10(a));
    const m = x / Math.pow(10, e);
    return `${m.toFixed(digits - 1)}e${e >= 0 ? '+' : ''}${e}`;
  }
  const s = x.toPrecision(digits);
  // 소수점이 있을 때만 꼬리 0 을 제거한다 (5810 → 581 이 되는 것을 방지)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

export function fmtBig(x, digits = 3) {
  const a = Math.abs(x);
  if (a < 1000) return fmt(x, digits);
  const i = Math.min(SUFFIX.length - 1, Math.floor(Math.log10(a) / 3));
  return (x / Math.pow(1000, i)).toFixed(2) + SUFFIX[i];
}

/** 시뮬레이션 시각(일) → 사람이 읽는 기간 */
export function fmtDuration(days) {
  const a = Math.abs(days);
  if (a < 1) return `${(days * 24).toFixed(2)} h`;
  if (a < 700) return `${days.toFixed(2)} d`;
  const y = days / DAY_PER_YEAR;
  if (Math.abs(y) < 1e4) return `${y.toFixed(2)} yr`;
  if (Math.abs(y) < 1e7) return `${(y / 1e3).toFixed(3)} kyr`;
  if (Math.abs(y) < 1e10) return `${(y / 1e6).toFixed(3)} Myr`;
  return `${(y / 1e9).toFixed(3)} Gyr`;
}

/** J2000 기준일(일) → 달력 날짜 문자열 */
export function julianToDate(jdOffset) {
  const ms = Date.UTC(2000, 0, 1, 12, 0, 0) + jdOffset * 86400e3;
  const d = new Date(ms);
  if (!isFinite(ms) || Math.abs(ms) > 8.64e15) {
    const y = 2000 + jdOffset / DAY_PER_YEAR;
    return `${y > 0 ? 'AD' : 'BC'} ${Math.abs(y).toFixed(0)}`;
  }
  return d.toISOString().slice(0, 10);
}

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
