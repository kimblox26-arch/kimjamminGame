// 해랑시 지리 — 해안선 · 해저 지형 · 하천 · 언덕 · 항만 · 방파제의 해석적 정의
// 모든 함수는 월드 좌표(m) 기준: x = 동쪽, z = 남쪽(바다 방향), y = 해발고도
import { fbm2, ridgeNoise2, gradNoise2, lerp } from '../../src/core/utils.js';

export const sstep = (a, b, x) => {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};

export const PORT_Z = 180;
// 방파제: 항만 동쪽 끝에서 남서쪽으로 뻗음
export const BREAKWATER = [[-1085, PORT_Z - 12], [-1590, PORT_Z + 300]];
// 시내의 작은 언덕들 (대피 고지)
export const KNOLLS = [
  { name: '망루언덕', x: -640, z: -330, h: 40, r: 150 },
  { name: '솔숲공원', x: 520, z: -470, h: 32, r: 125 },
  { name: '서망대', x: -1560, z: -520, h: 36, r: 165 },
];
export const SIRENS = [
  [-1420, 40], [-560, -120], [180, -40], [380, -560], [1080, 380], [-150, -760],
];
// 해상 관측 부이 (쓰나미 조기 감지)
export const BUOYS = [[-900, 1150], [250, 1250], [1300, 1500], [-1700, 1000]];

export const portWeight = (x) => 1 - sstep(-1120, -880, x);

export function coastZ(x) {
  let z = 260 + 150 * Math.sin(x * 0.0012 + 0.7) + 60 * Math.sin(x * 0.0037 + 2.1);
  z -= 330 * Math.exp(-(((x + 120) / 430) ** 2));       // 해랑만
  z += 520 * Math.exp(-(((x - 1450) / 300) ** 2));      // 등대곶
  return lerp(z, PORT_Z, portWeight(x));
}

/** 해안선 접선 각도 (dz/dx) */
export function coastSlope(x) {
  return (coastZ(x + 5) - coastZ(x - 5)) / 10;
}

export function riverX(z) {
  return -430 + 110 * Math.sin(z * 0.0035 + 1.0) + 35 * Math.sin(z * 0.011 + 0.4);
}

function segDist(x, z, a, b) {
  const vx = b[0] - a[0], vz = b[1] - a[1];
  let t = ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = x - (a[0] + vx * t), dz = z - (a[1] + vz * t);
  return Math.sqrt(dx * dx + dz * dz);
}

/** 해안에서 내륙 방향 거리 (음수 = 바다) */
export function inlandDist(x, z) {
  const pw = portWeight(x);
  const zc = coastZ(x) + 18 * fbm2(x * 0.005, z * 0.005, 3) * (1 - pw);
  return zc - z;
}

export function heightAt(x, z) {
  const pw = portWeight(x);
  const inl = inlandDist(x, z);
  let h;
  if (inl < 0) {
    const d = -inl;
    let depth = 0.034 * d + 2.2e-5 * d * d;
    if (depth > 140) depth = 140;
    depth += 4 * fbm2(x * 0.0018 + 11, z * 0.0018, 3) * sstep(80, 400, d);
    if (pw > 0) depth = lerp(depth, Math.max(depth, 11), pw * sstep(0, 6, d));
    const cm = Math.exp(-(((x - 1450) / 330) ** 2));
    depth += 9 * cm * sstep(0, 40, d);
    h = -depth;
  } else {
    let land = 2.1 * sstep(0, 65, inl) + Math.max(0, inl - 65) * 0.0058;
    land += 1.4 * fbm2(x * 0.0032, z * 0.0032 + 7, 3) * sstep(60, 220, inl);
    const hillT = sstep(900, 1450, inl + 140 * fbm2(x * 0.0014, 5 + z * 0.0014, 3));
    land += hillT * (40 + 85 * ridgeNoise2(x * 0.0011 + 3, z * 0.0011 - 2, 4));
    for (const k of KNOLLS) {
      const r2 = (x - k.x) ** 2 + (z - k.z) ** 2;
      land += k.h * Math.exp(-r2 / (k.r * k.r));
    }
    if (pw > 0) land = lerp(land, 3.2, pw * (1 - sstep(350, 520, inl)));
    const cm = Math.exp(-(((x - 1450) / 330) ** 2));
    land += 30 * cm * sstep(0, 85, inl) * (1 + 0.25 * gradNoise2(x * 0.01, z * 0.01));
    h = land;
  }
  // 하천 (해수면 높이의 운하형 강)
  if (z > -1500) {
    const dist = Math.abs(x - riverX(z));
    const fade = 1 - sstep(820, 980, inl);
    const t = sstep(48, 18, dist) * fade;
    if (t > 0) h = lerp(h, Math.min(h, -2.2), t);
  }
  // 방파제
  const bd = segDist(x, z, BREAKWATER[0], BREAKWATER[1]);
  if (bd < 18) h = Math.max(h, lerp(h, 5.0, sstep(18, 9, bd)));
  return h;
}

/** 구(區) 판정: -1 = 바다/강 */
export function districtAt(x, z) {
  const inl = inlandDist(x, z);
  if (inl < -2) return -1;
  if (inl > 1030 + 90 * gradNoise2(x * 0.002, 3.3)) return 5;
  if (x < -1000) return 0;
  if (x < -190) return 1;
  if (x < 880) return inl < 400 ? 2 : 3;
  return 4;
}
