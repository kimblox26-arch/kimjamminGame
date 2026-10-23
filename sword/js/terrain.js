// 지형: 서울 같은 분지(한강·여의도·남산·북한산·관악산…) + 끝없는 한국 시골(산맥, 들판, 마을) + 서해
//  - heightAt / waterLevelAt / urbanAt / normalAt : 절대(평면) 좌표, 물리·도시 배치용 (빠름, 결정적)
//  - Terrain : CPU 쿼드트리 LOD 청크 (웹 워커에서 생성 → 충돌 == 화면), 지구 곡률, 대기 원근, 사실적 재질, 물
import * as THREE from 'three';
import * as frame from './frame.js';

/* =====================================================================================
 *  지형 코어 — 순수 함수 (import 없음). 메인 스레드와 워커가 같은 소스를 실행해 결과가 비트 단위로 같다.
 * ===================================================================================== */
/*CORE-BEGIN*/
function terrainCore() {
  'use strict';
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(a, b, v) { let t = (v - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------- 정수 해시 값 노이즈 (주기 없음) ----------
  function hash2(ix, iz) {
    let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul((iz | 0) ^ 0x5bd1e995, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return (h & 0xffffff) * (2 / 16777215) - 1;
  }
  let NDX = 0, NDZ = 0;
  // 값 노이즈 + 해석적 미분 (NDX, NDZ)
  function noised(x, z) {
    const xf = Math.floor(x), zf = Math.floor(z);
    const fx = x - xf, fz = z - zf;
    const ix = xf | 0, iz = zf | 0;
    const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const k1 = b - a, k2 = c - a, k4 = a - b - c + d;
    NDX = 30 * fx * fx * (fx * (fx - 2) + 1) * (k1 + k4 * uz);
    NDZ = 30 * fz * fz * (fz * (fz - 2) + 1) * (k2 + k4 * ux);
    return a + k1 * ux + k2 * uz + k4 * ux * uz;
  }
  function noise(x, z) {
    const xf = Math.floor(x), zf = Math.floor(z);
    const fx = x - xf, fz = z - zf;
    const ix = xf | 0, iz = zf | 0;
    const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  }
  // 그래디언트 노이즈 (등치선이 격자 방향을 타지 않음 → 골짜기망용)
  const GRX = new Float64Array(16), GRZ = new Float64Array(16);
  for (let i = 0; i < 16; i++) { GRX[i] = Math.cos((i + 0.5) * Math.PI / 8); GRZ[i] = Math.sin((i + 0.5) * Math.PI / 8); }
  function ghash(ix, iz) {
    let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul((iz | 0) ^ 0x5bd1e995, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h ^= h >>> 13;
    return h & 15;
  }
  function gnoise(x, z) {
    const xf = Math.floor(x), zf = Math.floor(z);
    const fx = x - xf, fz = z - zf;
    const ix = xf | 0, iz = zf | 0;
    const a = ghash(ix, iz), b = ghash(ix + 1, iz), c = ghash(ix, iz + 1), d = ghash(ix + 1, iz + 1);
    const va = GRX[a] * fx + GRZ[a] * fz, vb = GRX[b] * (fx - 1) + GRZ[b] * fz;
    const vc = GRX[c] * fx + GRZ[c] * (fz - 1), vd = GRX[d] * (fx - 1) + GRZ[d] * (fz - 1);
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    return 1.45 * (va + (vb - va) * ux + (vc - va) * uz + (va - vb - vc + vd) * ux * uz);
  }
  // 침식 느낌 fbm (기울기가 큰 곳에서 고주파 억제 → 매끈한 골짜기 + 날카로운 능선)
  function efbm(x, z, oct) {
    let a = 0, b = 0.5, dx = 0, dz = 0;
    for (let i = 0; i < oct; i++) {
      const n = noised(x, z);
      dx += NDX; dz += NDZ;
      a += b * n / (1 + dx * dx + dz * dz);
      b *= 0.5;
      const nx = 1.6 * x - 1.2 * z, nz = 1.2 * x + 1.6 * z;
      x = nx + 17.13; z = nz - 9.71;
    }
    return a;
  }
  // 능선 노이즈 [0,1]
  function ridged(x, z, oct) {
    let a = 0, b = 0.5, w = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      let n = 1 - Math.abs(noise(x, z));
      n *= n * w;
      w = n * 1.8; if (w > 1) w = 1;
      a += n * b; norm += b;
      b *= 0.5;
      const nx = 1.6 * x - 1.2 * z, nz = 1.2 * x + 1.6 * z;
      x = nx + 5.3; z = nz + 2.9;
    }
    return a / norm;
  }

  // ---------- 한강 (동→서), 중심선 z(x) : 에르미트 스플라인 + 동쪽 무한 사행 ----------
  const RPX = [-70000, -46000, -38000, -31000, -24000, -17000, -11000, -6000, -2500, 0, 3000, 6000, 9000, 12000, 15500, 19500, 25000];
  const RPZ = [-7800, -7600, -7000, -6100, -4600, -2400, -300, 1300, 1000, 700, 450, -350, 300, 1250, -400, -3300, -7000];
  const RPN = RPX.length;
  const RPM = new Float64Array(RPN);
  const MEA1 = 2600, MEL1 = 8500, MEA2 = 1100, MEL2 = 3100;   // 동쪽 사행
  for (let i = 0; i < RPN; i++) {
    if (i === 0) RPM[i] = (RPZ[1] - RPZ[0]) / (RPX[1] - RPX[0]);
    else if (i === RPN - 1) RPM[i] = MEA1 / MEL1 + MEA2 / MEL2;
    else RPM[i] = (RPZ[i + 1] - RPZ[i - 1]) / (RPX[i + 1] - RPX[i - 1]);
  }
  let RZ = 0, RDZ = 0;
  function riverCenter(x) {
    if (x >= RPX[RPN - 1]) {
      const u = x - RPX[RPN - 1];
      RZ = RPZ[RPN - 1] + MEA1 * Math.sin(u / MEL1) + MEA2 * Math.sin(u / MEL2);
      RDZ = MEA1 / MEL1 * Math.cos(u / MEL1) + MEA2 / MEL2 * Math.cos(u / MEL2);
      return;
    }
    if (x <= RPX[0]) { RZ = RPZ[0]; RDZ = 0; return; }
    let lo = 0, hi = RPN - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (RPX[m] <= x) lo = m; else hi = m; }
    const x0 = RPX[lo], hdx = RPX[lo + 1] - x0, t = (x - x0) / hdx;
    const t2 = t * t, t3 = t2 * t;
    const z0 = RPZ[lo], z1 = RPZ[lo + 1], m0 = RPM[lo] * hdx, m1 = RPM[lo + 1] * hdx;
    RZ = (2 * t3 - 3 * t2 + 1) * z0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * z1 + (t3 - t2) * m1;
    RDZ = ((6 * t2 - 6 * t) * z0 + (3 * t2 - 4 * t + 1) * m0 + (-6 * t2 + 6 * t) * z1 + (3 * t2 - 2 * t) * m1) / hdx;
  }
  function riverHW(x) {
    let hw = 480 + 70 * Math.sin(x / 2300);
    if (x > 15000) hw *= Math.max(0.5, 1 - (x - 15000) / 40000);
    if (x < -12000) hw += (-12000 - x) * 0.045;          // 하구로 갈수록 넓어짐
    const t = (x + 6000) / 2300;                         // 여의도 둘레로 넓어짐
    if (t > -1 && t < 1) { const q = 1 - t * t; hw += 650 * q * q; }
    return hw;
  }
  function riverWL(x) {
    if (x < -38000) return 0;
    if (x < -12000) return 2.5 * (x + 38000) / 26000;
    if (x < 15000) return 2.5;
    return 2.5 + 60 * (1 - Math.exp(-(x - 15000) / 80000));
  }

  // ---------- 이름 있는 산: [cx, cz, rx, rz, 각도(도), 높이, 화강암] ----------
  const MTN_SRC = [
    [-1500, -15600, 2700, 2300, 20, 836, 1.0],   // 북한산 백운대
    [-500, -12600, 1800, 1500, 0, 650, 0.9],     // 보현봉·문수봉
    [-4300, -12800, 2300, 1500, 35, 560, 0.8],   // 비봉 능선
    [-6800, -13800, 2200, 1600, 10, 470, 0.6],   // 노고산
    [2300, -14200, 2000, 1500, 0, 480, 0.5],     // 우이령
    [1500, -19600, 2300, 2000, 15, 740, 1.0],    // 도봉산
    [4800, -22200, 2200, 1800, 30, 638, 0.9],    // 수락산
    [8500, -18600, 2000, 1700, 0, 508, 0.7],     // 불암산
    [-600, -6900, 1100, 800, 10, 342, 0.5],      // 북악산
    [-2800, -5700, 900, 750, -20, 338, 0.8],     // 인왕산
    [-4600, -4400, 950, 700, 0, 296, 0.3],       // 안산
    [1500, -3000, 1450, 850, 8, 262, 0.1],       // 남산
    [-2000, 11200, 3000, 2100, 15, 632, 1.0],    // 관악산
    [-5000, 10600, 1600, 1300, 0, 481, 0.6],     // 삼성산
    [7600, 13600, 2700, 2200, -10, 618, 0.4],    // 청계산
    [4600, 8900, 1500, 1000, 20, 293, 0.1],      // 우면산
    [10200, 9200, 1600, 1100, 30, 293, 0.1],     // 대모산·구룡산
    [15800, 10600, 3200, 2400, 0, 520, 0.3],     // 남한산성
    [13300, -4700, 1300, 1700, 10, 348, 0.3],    // 용마산
    [14000, -2100, 1100, 1300, 0, 287, 0.3],     // 아차산
    [17500, -8500, 2400, 1900, 0, 470, 0.2],     // 검암산 일대
    [-24000, -3500, 1900, 1600, 0, 395, 0.2],    // 계양산
    [-10500, -9500, 1300, 1000, 0, 210, 0.1],    // 봉산
    [-18000, 10500, 1500, 1200, 0, 280, 0.2],    // 소래산 일대
    [-29500, 6500, 1400, 1100, 0, 230, 0.2],     // 인천 문학산
  ];
  const NM = MTN_SRC.length;
  const MT = new Float64Array(NM * 8);
  for (let i = 0; i < NM; i++) {
    const s = MTN_SRC[i], a = s[4] * Math.PI / 180, o = i * 8;
    MT[o] = s[0]; MT[o + 1] = s[1]; MT[o + 2] = 1 / (s[2] * s[2] * 1.5); MT[o + 3] = 1 / (s[3] * s[3] * 1.5);
    MT[o + 4] = Math.cos(a); MT[o + 5] = Math.sin(a); MT[o + 6] = s[5]; MT[o + 7] = Math.max(s[2], s[3]) * 1.23;
  }
  const MT_GR = new Float64Array(NM);
  for (let i = 0; i < NM; i++) MT_GR[i] = MTN_SRC[i][6];

  // ---------- 도시: 위성도시 [x, z, 반경, 밀도], 도심 [x, z, 반경], 공원 [x, z, 반경] ----------
  const CITIES = new Float64Array([
    -29000, 1500, 7000, 0.85,   // 인천
    -16500, 2500, 3500, 0.9,    // 부천
    -21000, -9000, 4000, 0.7,   // 김포
    -17000, -13500, 5500, 0.85, // 고양·일산
    -25000, -22000, 4000, 0.6,  // 파주
    1500, -27500, 3500, 0.8,    // 의정부
    22000, -9500, 4000, 0.6,    // 남양주
    17500, -3500, 2500, 0.8,    // 구리
    19500, 4500, 3000, 0.7,     // 하남
    10000, 17500, 5000, 0.9,    // 성남·분당
    1500, 14200, 1500, 0.6,     // 과천
    -5000, 17000, 4000, 0.85,   // 안양
    -10000, 8500, 2500, 0.85,   // 광명
    -17000, 22000, 6000, 0.8,   // 시흥·안산
    1000, 31000, 6000, 0.85,    // 수원
    15000, 30000, 6000, 0.6,    // 용인
  ]);
  const CORES = new Float64Array([
    0, -4500, 2600,  -6000, 1800, 1300,  6500, 5500, 3200,  12500, 2500, 1900,  -3500, -2000, 1500,
    2600, -1700, 1000, -9500, 6000, 1800,  -8500, 3800, 1100,  -10500, 1500, 1500,  -9000, -5000, 1200,
    6500, -2000, 1500,  6500, -5200, 1300,  10000, 17500, 2500,  1000, 31000, 2500,  -29000, 1500, 2500,
  ]);
  const PARKS = new Float64Array([
    2400, -1500, 650,    // 용산공원
    14600, 3900, 800,    // 올림픽공원
    6500, -1350, 480,    // 서울숲
    -6500, 7000, 350,    // 보라매공원
    10400, -2300, 450,   // 어린이대공원
    -9700, -2900, 850,   // 월드컵공원 (하늘·노을)
    4200, 13600, 1100,   // 서울대공원
  ]);

  // ---------- 결과 구조체 ----------
  const S = { h: 0, level: -1e9, urban: 0, forest: 0, park: 0, rock: 0, edge: 1e4, floor: 0, relief: 0, sea: 0 };

  function evalTerrain(x, z, full) {
    // --- 시골: 휘어진 골짜기망 + 산줄기 ---
    const ex = (x - 2500) * (1 / 23000), ez = (z + 1500) * (1 / 19500);
    const ed = Math.sqrt(ex * ex + ez * ez) + 0.2 * noise(x * (1 / 11000) - 3.1, z * (1 / 11000) + 2.2);
    const w = sstep(0.8, 1.3, ed);
    // --- 서해 해안선 (≈ x -38 km) ---
    let cd = 1e9;
    if (x < -15000) cd = x - (-38000 + 2600 * noise(z * (1 / 16000), 3.3) + 900 * noise(z * (1 / 3800), 7.1) + 260 * noise(z * (1 / 900), 1.7));
    let h, floor, mt = 0, gr = 0;
    if (cd < -1500) { h = 0; floor = 0; } else {
    // --- 이름 있는 산 (가장 높은 종 모양 하나, 윤곽은 노이즈로 일그러뜨림) ---
    let wpx = 0, wpz = 0, warped = false;
    for (let i = 0; i < NM; i++) {
      const o = i * 8, ext = MT[o + 7] + 700;
      let dx = x - MT[o], dz = z - MT[o + 1];
      if (dx > ext || dx < -ext || dz > ext || dz < -ext) continue;
      if (!warped) {
        warped = true;
        wpx = 650 * noise(x * (1 / 1900) + 7.3, z * (1 / 1900) - 2.2);
        wpz = 650 * noise(x * (1 / 1900) - 4.1, z * (1 / 1900) + 5.6);
      }
      dx += wpx; dz += wpz;
      const u = dx * MT[o + 4] + dz * MT[o + 5], v = -dx * MT[o + 5] + dz * MT[o + 4];
      const q = u * u * MT[o + 2] + v * v * MT[o + 3];
      if (q >= 1) continue;
      const t = 1 - q, b = t * t * MT[o + 6];
      if (b > mt) { mt = b; gr = MT_GR[i]; }
    }
    // --- 분지 바닥 (10~30 m) + 낮은 언덕 ---
    floor = 17 + 9 * noise(x * (1 / 5200) + 1.3, z * (1 / 5200) - 2.1) + 4 * noise(x * (1 / 1300), z * (1 / 1300) + 4.2);
    h = floor;
    if (w < 0.999) {
      const hill = efbm(x * (1 / 2600) + 9.1, z * (1 / 2600) - 2.7, 4);
      if (hill > 0.1) h += (hill - 0.1) * 300 * (1 - w);
    }
    if (mt > 0.5) {
      const r = ridged(x * (1 / 1150) + 0.3, z * (1 / 1150) - 0.7, 5);
      let hm = mt * (0.58 + 0.55 * r);
      if (gr > 0) {   // 화강암 돔 (북한산·도봉산·관악산)
        const dn = noise(x * (1 / 330) + 3.7, z * (1 / 330) - 1.1);
        if (dn > 0) hm += gr * mt * 0.32 * dn * dn;
      }
      h = Math.max(h, floor + hm + mt * 0.12);
    }
    if (w > 0) {
      const reg = 0.5 + 0.5 * noise(x * (1 / 70000) + 4.1, z * (1 / 70000) - 1.7);   // 산지(1) / 구릉(0)
      const east = sstep(-20000, 160000, x);
      const west = 0.35 + 0.65 * sstep(-34000, -8000, x);
      const amp = (280 + 620 * reg + 650 * east) * west;
      const wx = x + 2400 * gnoise(x * (1 / 9000) + 1.7, z * (1 / 9000) - 4.4);
      const wz = z + 2400 * gnoise(x * (1 / 9000) - 6.1, z * (1 / 9000) + 2.3);
      const v0 = Math.abs(gnoise(wx * (1 / 26000) - 2.9, wz * (1 / 26000) + 1.3));   // 큰 골짜기 (넓은 들)
      const v1 = Math.abs(gnoise(wx * (1 / 10000), wz * (1 / 10000)));                // 작은 골짜기
      const v2 = Math.abs(gnoise(wx * (1 / 2900) + 3.3, wz * (1 / 2900) + 8.1));       // 지류
      const vw0 = 0.03 + 0.05 * (1 - reg), vw1 = 0.02 + 0.04 * (1 - reg);
      const k1 = 0.5 + 0.5 * (1 - reg);
      const vf = sstep(vw0, vw0 + 0.42, v0) * (1 - k1 + k1 * sstep(vw1, vw1 + 0.5, v1)) * (0.55 + 0.45 * sstep(0.01, 0.32, v2));
      let e = 0.55 + efbm(x * (1 / 10000) + 0.37, z * (1 / 10000) - 0.71, 6);
      e = e < 0.05 ? 0.05 : e;
      const rr = ridged(x * (1 / 3400) + 2.3, z * (1 / 3400) + 1.1, 3);
      const fl = 18 + 40 * reg + 130 * east + 5 * noise(x * (1 / 2600), z * (1 / 2600));
      const hc = fl + amp * vf * (0.12 + 0.88 * Math.pow(e, 1.4)) * (0.72 + 0.45 * rr);
      h = lerp(h, Math.max(h, hc), w);
      floor = lerp(floor, fl, w);
    }
    }
    // --- 서해 (갯벌, 섬) ---
    {
      if (cd < 12000) {
        const off = cd < 0 ? -cd : 0;
        let bed = -0.5 - 1.8 * sstep(0, 3500, off) - Math.min(off, 40000) * 0.0009;
        bed += 1.1 * noise(x * (1 / 600), z * (1 / 600)) * (1 - sstep(0, 5000, off));   // 갯골
        const tl = sstep(-200, 12000, cd);
        const relief = h - floor;
        let hh = lerp(bed, floor, tl) + relief * sstep(-1500, 4000, cd);
        if (cd < 3000) {
          const isl = efbm(x * (1 / 7000) + 7.7, z * (1 / 7000) - 3.3, 5);
          const thr = 0.17 + Math.min(off, 60000) * 0.000003;
          if (isl > thr) hh += (isl - thr) * 1100 * (1 - sstep(-1000, 3000, cd));
        }
        h = hh;
        floor = lerp(bed, floor, tl);
      }
    }
    // --- 자연 지형 잔디테일 (산·언덕에서만) ---
    const relief0 = h - floor;
    const nat = clamp(relief0 * (1 / 40), 0, 1);
    if (nat > 0) h += nat * (1.3 * noise(x * (1 / 26), z * (1 / 26)) + 0.45 * noise(x * (1 / 9.5) + 3.3, z * (1 / 9.5) - 1.9));
    // --- 스폰 공원 (원점 반경 270 m 평지 6.5 m) ---
    const d0 = Math.sqrt(x * x + z * z);
    if (d0 < 520) h = lerp(6.5, h, sstep(270, 520, d0));
    // --- 한강: 둔치(공원) → 제방 → 강바닥 ---
    riverCenter(x);
    const hw = riverHW(x), wl = riverWL(x);
    const sp = (z - RZ) / Math.sqrt(1 + RDZ * RDZ);
    const a = sp < 0 ? -sp : sp;
    const urbanRiver = 1 - sstep(14000, 21000, Math.abs(x - 1000));
    const pw = 90 + 140 * urbanRiver;               // 둔치 폭
    const fp = wl + 4.0;                             // 둔치 높이
    const inner = hw + pw;
    const bw = 380 + 1600 * w;                       // 골짜기 폭
    const bankW = 25 + 55 * (1 - urbanRiver);
    if (a < inner + bw) {
      const t = sstep(inner, inner + bw, a);
      if (h > fp || cd > 3000) h = fp + (h - fp) * t;
    }
    if (a < hw + bankW) {
      if (a < hw) {
        const u = a / hw;
        const bed = wl - 0.8 - 7.0 * (1 - u * u);
        if (bed < h) h = bed;
      } else {
        const bk = lerp(wl - 0.8, h, sstep(0, 1, (a - hw) / bankW));
        if (bk < h) h = bk;
      }
    }
    // 여의도 (강 안의 섬, 남쪽 샛강)
    let isl = 0;
    if (x > -7600 && x < -4400 && sp > -100 && sp < 1100) {
      const iu = (x + 6000) / 1450, iv = (sp - 500) / 470;
      const q = iu * iu + iv * iv;
      if (q < 1.3) {
        isl = sstep(1.3, 0.85, q);
        const ih = lerp(wl - 0.8, fp + 1.5, isl);
        if (ih > h) h = ih;
      }
    }
    // --- 수면 ---
    let level = -1e9;
    if (a < hw + bankW + 60) level = wl;
    if (cd < 6000 && level < 0) level = 0;
    S.h = h; S.level = level; S.edge = a - hw; S.floor = floor;
    if (!full) return h;

    // ===== 마스크 (청크 생성·도시 배치용) =====
    const relief = relief0 > 0 ? relief0 : 0;
    S.relief = relief;
    let park = 0;
    if (cd > 1500 && a < inner + 60) park = 1 - sstep(inner - 25, inner + 60, a);
    park = Math.max(park, 1 - sstep(330, 470, d0));
    for (let i = 0; i < PARKS.length; i += 3) {
      const dx = x - PARKS[i], dz = z - PARKS[i + 1], r = PARKS[i + 2];
      if (dx > r || dx < -r || dz > r || dz < -r) continue;
      park = Math.max(park, 1 - sstep(0.7, 1.0, Math.sqrt(dx * dx + dz * dz) / r));
    }
    if (isl > 0) park *= 1 - isl;
    let forest = sstep(7, 30, relief);
    // 도시 밀도
    const sx = (x - 3000) * (1 / 17500), sz = (z - 500) * (1 / 14500);
    let u = 1 - sstep(0.72, 1.05, Math.sqrt(sx * sx + sz * sz) + 0.12 * noise(x * (1 / 4000), z * (1 / 4000)));
    for (let i = 0; i < CITIES.length; i += 4) {
      const dx = x - CITIES[i], dz = z - CITIES[i + 1], r = CITIES[i + 2];
      if (dx > r || dx < -r || dz > r || dz < -r) continue;
      const d = Math.sqrt(dx * dx + dz * dz) / r + 0.15 * noise(x * (1 / 2500) + i, z * (1 / 2500));
      u = Math.max(u, CITIES[i + 3] * (1 - sstep(0.55, 1.0, d)));
    }
    if (w > 0.2) {   // 시골 마을 (8 km 격자당 하나 이하)
      const cs = 8000, ci = Math.floor(x / cs), cj = Math.floor(z / cs);
      const hh = hash2(ci * 7 + 13, cj * 11 + 5);
      if (hh > -0.15) {
        const tx = (ci + 0.25 + 0.25 * (1 + hash2(ci, cj + 77))) * cs, tz = (cj + 0.25 + 0.25 * (1 + hash2(ci + 31, cj))) * cs;
        const tr = 450 + 350 * (1 + hash2(ci + 9, cj));
        const d = Math.sqrt((x - tx) * (x - tx) + (z - tz) * (z - tz)) / tr;
        if (d < 1) u = Math.max(u, (0.32 + 0.16 * (1 + hh)) * (1 - sstep(0.35, 1, d)) * w);
      }
    }
    u *= 0.72 + 0.28 * (0.5 + 0.5 * noise(x * (1 / 1500) + 9.1, z * (1 / 1500)));
    for (let i = 0; i < CORES.length; i += 3) {
      const dx = x - CORES[i], dz = z - CORES[i + 1], r = CORES[i + 2];
      if (dx > r || dx < -r || dz > r || dz < -r) continue;
      const v = 1 - sstep(0.25, 1.0, Math.sqrt(dx * dx + dz * dz) / r);
      if (v > 0 && u > 0.3) u = Math.max(u, lerp(u, 1, v));
    }
    u *= 1 - sstep(18, 70, relief);
    if (isl <= 0) u *= sstep(inner - 15, inner + 50, a);
    else u = Math.max(u * sstep(inner - 15, inner + 50, a), isl * 0.95);
    u *= 1 - park;
    if (cd < 2000) u *= sstep(300, 2000, cd);
    if (h < level + 0.5) u = 0;
    S.urban = clamp(u, 0, 1);
    S.forest = clamp(forest * (1 - 0.85 * S.urban), 0, 1);
    S.park = clamp(park, 0, 1);
    S.rock = clamp(gr * sstep(200, 560, h) + sstep(650, 1300, relief) * 0.6, 0, 1);
    S.sea = 1 - sstep(-1500, 1500, cd);
    return h;
  }

  function heightAt(x, z) { return evalTerrain(x, z, false); }
  function waterLevelAt(x, z) { evalTerrain(x, z, false); return S.level > S.h ? S.level : -Infinity; }
  function urbanAt(x, z) { evalTerrain(x, z, true); return S.urban; }
  function sample(x, z) { evalTerrain(x, z, true); return S; }

  // ---------- 도로망 (셰이더와 같은 식) : 1 = 도로 위 ----------
  const TP = 6.283185307179586 / 65536;
  function roadAt(x, z) {
    evalTerrain(x, z, true);
    const u = S.urban;
    if (u < 0.2) return 0;
    const px = ((x % 65536) + 65536) % 65536, pz = ((z % 65536) + 65536) % 65536;
    const qx = px + 260 * Math.sin(TP * (3 * pz + px)) + 120 * Math.sin(TP * (7 * px - 5 * pz) + 1.3);
    const qz = pz + 260 * Math.sin(TP * (2 * px - 3 * pz) + 0.7) + 120 * Math.sin(TP * (4 * px + 9 * pz) + 2.1);
    const fa = (v, p) => Math.abs(((v / p + 0.5) % 1 + 1) % 1 - 0.5) * p;
    if (Math.min(fa(qx, 512), fa(qz, 512)) < 17) return 1;
    if (u > 0.32 && Math.min(fa(qx, 128), fa(qz, 128)) < 6.5) {
      const bx = (((Math.floor(qx / 512) % 128) + 128) % 128), bz = (((Math.floor(qz / 512) % 128) + 128) % 128);
      // GLSL tHash 와 같은 해시는 비싸므로 근사: 모든 슈퍼블록에 집산도로가 있다고 가정
      if (bx >= 0 && bz >= 0) return 1;
    }
    return 0;
  }

  // ---------- 청크 생성 ----------
  //  level: LOD (0 = 가장 촘촘), ix/iz: 청크 격자 인덱스, N: 한 변 사각형 수, leaf: 0레벨 청크 크기(m)
  //  반환 배열은 bufs 가 있으면 재사용 (워커 ↔ 메인 왕복 버퍼)
  let scratchH = null, scratchG = 0, scratchSun = null;
  function allocBufs(NT) {
    return { pos: new Float32Array(NT * 3), n: new Int8Array(NT * 4), nc: new Int8Array(NT * 4), attr: new Uint8Array(NT * 4), data: new Int16Array(NT * 4), minY: 0, maxY: 0 };
  }
  function genChunk(level, ix, iz, N, leaf, sx, sy, sz, bufs) {
    const size = leaf * Math.pow(2, level), step = size / N, half = size * 0.5;
    const x0 = ix * size, z0 = iz * size;
    const G = N + 5, N1 = N + 1, NV = N1 * N1, NT = NV + 4 * N1;
    if (!bufs || bufs.pos.length !== NT * 3) bufs = allocBufs(NT);
    if (scratchG !== G) { scratchH = new Float64Array(G * G); scratchG = G; scratchSun = new Float32Array(N1 * N1); }
    const H = scratchH, pos = bufs.pos, nn = bufs.n, nc = bufs.nc, attr = bufs.attr, data = bufs.data;
    let minY = 1e9, maxY = -1e9;
    for (let gj = 0; gj < G; gj++) {
      const z = z0 + (gj - 2) * step;
      const innerJ = gj >= 2 && gj <= N + 2;
      for (let gi = 0; gi < G; gi++) {
        const x = x0 + (gi - 2) * step;
        const inner = innerJ && gi >= 2 && gi <= N + 2;
        evalTerrain(x, z, inner);
        const vis = S.level > S.h ? S.level - (S.level < 0.5 ? 2.5 : 2.0) : S.h;   // 파도 메쉬(water.js)가 위를 덮도록 조금 낮춤
        H[gj * G + gi] = vis;
        if (inner) {
          const v = ((gj - 2) * N1 + (gi - 2)) * 4;
          attr[v] = Math.round(S.urban * 255); attr[v + 1] = Math.round(S.forest * 255);
          attr[v + 2] = Math.round(S.park * 255); attr[v + 3] = Math.round(S.rock * 255);
          data[v] = clamp(Math.round((S.level - S.h) * 10), -32000, 32000);
          data[v + 1] = clamp(Math.round(S.edge), -32000, 32000);
          data[v + 2] = level;
          if (vis < minY) minY = vis;
          if (vis > maxY) maxY = vis;
        }
      }
    }
    // 태양 가림 (지형 그림자): 성긴 격자에서 광선 행진 후 보간
    const SR = N >= 64 ? 4 : 2, NS = N / SR + 1;
    const sun = scratchSun;
    const lh = Math.sqrt(sx * sx + sz * sz) || 1;
    const tMax = Math.max(4000, step * 10);
    for (let sj = 0; sj < NS; sj++) {
      for (let si = 0; si < NS; si++) {
        const vi = si * SR, vj = sj * SR;
        const k = (vj + 2) * G + vi + 2;
        const px = x0 + vi * step, pz = z0 + vj * step;
        const h0 = H[k] + 0.5 + step * 0.05;
        let res = 1, t = Math.max(3, step * 0.75);
        for (let s = 0; s < 40 && t < tMax; s++) {
          const qx = px + sx * t, qz = pz + sz * t, qy = h0 + sy * t;
          if (qy > 2700) break;
          evalTerrain(qx, qz, false);
          const th = S.level > S.h ? S.level : S.h;
          const dd = qy - th;
          if (dd <= 0) { res = 0; break; }
          const r = 10 * dd / t;   // 각도 여유 → 반그림자
          if (r < res) res = r;
          t *= 1.28;
        }
        sun[sj * NS + si] = res > 1 ? 1 : res;
      }
    }
    // 정점
    const inv2 = 1 / (2 * step), inv4 = 1 / (4 * step);
    for (let vj = 0; vj <= N; vj++) {
      for (let vi = 0; vi <= N; vi++) {
        const v = vj * N1 + vi, k = (vj + 2) * G + vi + 2;
        const h = H[k];
        pos[v * 3] = vi * step - half; pos[v * 3 + 1] = h; pos[v * 3 + 2] = vj * step - half;
        // 촘촘한 법선 / 성긴(부모 LOD) 법선
        let dx = (H[k + 1] - H[k - 1]) * inv2, dz = (H[k + G] - H[k - G]) * inv2;
        let il = 127 / Math.sqrt(dx * dx + 1 + dz * dz);
        nn[v * 4] = Math.round(-dx * il); nn[v * 4 + 1] = Math.round(il); nn[v * 4 + 2] = Math.round(-dz * il);
        dx = (H[k + 2] - H[k - 2]) * inv4; dz = (H[k + 2 * G] - H[k - 2 * G]) * inv4;
        il = 127 / Math.sqrt(dx * dx + 1 + dz * dz);
        nc[v * 4] = Math.round(-dx * il); nc[v * 4 + 1] = Math.round(il); nc[v * 4 + 2] = Math.round(-dz * il);
        // 차폐 (주변 평균보다 낮은 곳 = 오목)
        const avg = (H[k + 2] + H[k - 2] + H[k + 2 * G] + H[k - 2 * G] + H[k + 2 + 2 * G] + H[k - 2 - 2 * G] + H[k + 2 - 2 * G] + H[k - 2 + 2 * G]) * 0.125;
        const ao = clamp(1 - (avg - h) / (step * 2.2 + 2) * 0.55, 0.45, 1);
        nn[v * 4 + 3] = Math.round(ao * 127);
        // 태양 가림 보간
        const fx = vi / SR, fz = vj / SR;
        const si = Math.min(NS - 2, Math.floor(fx)), sj = Math.min(NS - 2, Math.floor(fz));
        const tx = fx - si, tz = fz - sj;
        const s00 = sun[sj * NS + si], s10 = sun[sj * NS + si + 1], s01 = sun[(sj + 1) * NS + si], s11 = sun[(sj + 1) * NS + si + 1];
        const sv = (s00 * (1 - tx) + s10 * tx) * (1 - tz) + (s01 * (1 - tx) + s11 * tx) * tz;
        nc[v * 4 + 3] = Math.round(sv * 127);
        // 모프 목표 (부모 LOD 격자 위의 높이)
        let hc = h;
        const oi = vi & 1, oj = vj & 1;
        if (oi && !oj) hc = (H[k - 1] + H[k + 1]) * 0.5;
        else if (!oi && oj) hc = (H[k - G] + H[k + G]) * 0.5;
        else if (oi && oj) hc = (H[k - 1 - G] + H[k + 1 + G]) * 0.5;
        data[v * 4 + 3] = clamp(Math.round((hc - h) * 10), -32000, 32000);
      }
    }
    // 스커트 (LOD 경계 틈 가림)
    const skirt = size * 0.02 + 2;
    let o = NV;
    for (let e = 0; e < 4; e++) {
      for (let i = 0; i <= N; i++) {
        const vi = e === 0 ? i : e === 1 ? N : e === 2 ? N - i : 0;
        const vj = e === 0 ? 0 : e === 1 ? i : e === 2 ? N : N - i;
        const v = vj * N1 + vi;
        pos[o * 3] = pos[v * 3]; pos[o * 3 + 1] = pos[v * 3 + 1] - skirt; pos[o * 3 + 2] = pos[v * 3 + 2];
        for (let c = 0; c < 4; c++) { nn[o * 4 + c] = nn[v * 4 + c]; nc[o * 4 + c] = nc[v * 4 + c]; attr[o * 4 + c] = attr[v * 4 + c]; data[o * 4 + c] = data[v * 4 + c]; }
        o++;
      }
    }
    bufs.minY = minY - skirt; bufs.maxY = maxY;
    return bufs;
  }

  // 공유 인덱스 (청크 위상은 모두 같음)
  function buildIndex(N) {
    const N1 = N + 1, NV = N1 * N1;
    const idx = new Uint16Array(N * N * 6 + 4 * N * 6);
    let p = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * N1 + i, b = a + N1, c = b + 1, d = a + 1;   // a(i,j) b(i,j+1) c(i+1,j+1) d(i+1,j)
        idx[p++] = a; idx[p++] = b; idx[p++] = c;
        idx[p++] = a; idx[p++] = c; idx[p++] = d;
      }
    }
    // 스커트: 각 변의 정점 순서는 반시계(위에서 볼 때) → 바깥을 향하도록
    for (let e = 0; e < 4; e++) {
      for (let i = 0; i < N; i++) {
        const vi0 = e === 0 ? i : e === 1 ? N : e === 2 ? N - i : 0;
        const vj0 = e === 0 ? 0 : e === 1 ? i : e === 2 ? N : N - i;
        const vi1 = e === 0 ? i + 1 : e === 1 ? N : e === 2 ? N - i - 1 : 0;
        const vj1 = e === 0 ? 0 : e === 1 ? i + 1 : e === 2 ? N : N - i - 1;
        const A = vj0 * N1 + vi0, B = vj1 * N1 + vi1;
        const SA = NV + e * N1 + i, SB = SA + 1;
        idx[p++] = A; idx[p++] = B; idx[p++] = SA;
        idx[p++] = B; idx[p++] = SB; idx[p++] = SA;
      }
    }
    return idx;
  }

  return { heightAt, waterLevelAt, urbanAt, sample, roadAt, genChunk, buildIndex, evalTerrain, S, noise };
}
/*CORE-END*/

/* =====================================================================================
 *  공개 함수 (메인 스레드)
 * ===================================================================================== */
const CORE = terrainCore();
/** 절대 (x,z) → 지면 높이 (m). 강·바다에서는 물 밑바닥. */
export function heightAt(x, z) { return CORE.heightAt(x, z); }
/** 물 표면 높이 (m), 마른 땅이면 -Infinity */
export function waterLevelAt(x, z) { return CORE.waterLevelAt(x, z); }
/** 0..1 도시 밀도 (0 = 산/숲/들/공원/물, 1 = 도심) */
export function urbanAt(x, z) { return CORE.urbanAt(x, z); }
/** 셰이더의 도로망과 같은 근사 마스크 (1 = 간선·집산 도로 위) */
export function roadAt(x, z) { return CORE.roadAt(x, z); }
/** 한 번에 모든 값: {h, level, urban, forest, park, rock, edge, floor, relief, sea} (재사용 객체 — 복사해서 쓸 것) */
export function terrainSample(x, z) { return CORE.sample(x, z); }
/** 단위 법선 */
export function normalAt(x, z, out) {
  const e = 1.0;
  const hx = CORE.heightAt(x + e, z) - CORE.heightAt(x - e, z);
  const hz = CORE.heightAt(x, z + e) - CORE.heightAt(x, z - e);
  out = out || new THREE.Vector3();
  return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
}

/* =====================================================================================
 *  절차적 노이즈 텍스처 (반복 타일, 밉맵)
 *   A: r,g = 고르게 분포한 fbm 두 채널, b = 나무 수관 돔 (20×20 셀), a = 수관 id
 *   B: rg = 미세 요철 법선, ba = 수관 법선
 * ===================================================================================== */
function buildNoiseTextures(renderer) {
  const N = 256;
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const lattice = (p) => { const L = new Float32Array(p * p); for (let i = 0; i < L.length; i++) L[i] = rnd(); return L; };
  const vtile = (L, p, x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = L[y0 * p + x0], b = L[y0 * p + x1], c = L[y1 * p + x0], d = L[y1 * p + x1];
    return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
  };
  const fbmField = (base, oct) => {
    const lats = [];
    for (let o = 0; o < oct; o++) lats.push(lattice(base << o));
    const F = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let a = 0, amp = 0.5, norm = 0;
      for (let o = 0; o < oct; o++) { const p = base << o; a += amp * vtile(lats[o], p, x * p / N, y * p / N); norm += amp; amp *= 0.5; }
      F[y * N + x] = a / norm;
    }
    return F;
  };
  const equalize = (F) => {   // 순위 → [0,1] 균등 분포 (셰이더 임계값이 직관적이 되도록)
    const idx = new Uint32Array(F.length); for (let i = 0; i < idx.length; i++) idx[i] = i;
    idx.sort((a, b) => F[a] - F[b]);
    const out = new Float32Array(F.length);
    for (let r = 0; r < idx.length; r++) out[idx[r]] = r / (idx.length - 1);
    return out;
  };
  const R = equalize(fbmField(4, 6)), G = equalize(fbmField(8, 5));
  const Hb = fbmField(16, 4);
  // 수관: 지터 격자 워리
  const C = 20, cs = N / C;
  const fpx = new Float32Array(C * C), fpy = new Float32Array(C * C), fid = new Float32Array(C * C), frad = new Float32Array(C * C);
  for (let i = 0; i < C * C; i++) { fpx[i] = 0.15 + 0.7 * rnd(); fpy[i] = 0.15 + 0.7 * rnd(); fid[i] = rnd(); frad[i] = 0.55 + 0.25 * rnd(); }
  const dome = new Float32Array(N * N), cid = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const gx = x / cs, gy = y / cs, cx = Math.floor(gx), cy = Math.floor(gy);
    let best = 1e9, bi = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const ox = cx + i, oy = cy + j, wx = ((ox % C) + C) % C, wy = ((oy % C) + C) % C, k = wy * C + wx;
      const dx = ox + fpx[k] - gx, dy = oy + fpy[k] - gy, d = (dx * dx + dy * dy) / (frad[k] * frad[k]);
      if (d < best) { best = d; bi = k; }
    }
    dome[y * N + x] = best < 1 ? Math.sqrt(1 - best) : 0;
    cid[y * N + x] = fid[bi];
  }
  const A = new Uint8Array(N * N * 4), B = new Uint8Array(N * N * 4);
  const at = (F, x, y) => F[(((y % N) + N) % N) * N + (((x % N) + N) % N)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    A[i] = R[y * N + x] * 255; A[i + 1] = G[y * N + x] * 255; A[i + 2] = dome[y * N + x] * 255; A[i + 3] = cid[y * N + x] * 255;
    const hx = (at(Hb, x - 1, y) - at(Hb, x + 1, y)) * 9, hy = (at(Hb, x, y - 1) - at(Hb, x, y + 1)) * 9;
    B[i] = clamp01(0.5 + hx) * 255; B[i + 1] = clamp01(0.5 + hy) * 255;
    const dx = (at(dome, x - 1, y) - at(dome, x + 1, y)) * 1.2, dy = (at(dome, x, y - 1) - at(dome, x, y + 1)) * 1.2;
    B[i + 2] = clamp01(0.5 + dx) * 255; B[i + 3] = clamp01(0.5 + dy) * 255;
  }
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
  const mk = (data) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = aniso;
    t.needsUpdate = true;
    return t;
  };
  return { A: mk(A), B: mk(B) };
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function sstepJS(a, b, v) { let t = (v - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

/* =====================================================================================
 *  셰이더 (MeshStandardMaterial 확장: 그림자·조명은 three 그대로, 재질/물/연무는 직접)
 * ===================================================================================== */
const T_VERT_PARS = /* glsl */`
attribute vec4 aN;      // 촘촘한 법선 xyz, 차폐
attribute vec4 aNC;     // 부모 LOD 법선 xyz, 태양 가림(지형 그림자)
attribute vec4 aAttr;   // 도시, 숲, 공원, 암석
attribute vec4 aData;   // 수심×10, 강가 거리, LOD 레벨, 모프 높이차×10
uniform vec2 tOriginMod;
uniform float tLeaf;
uniform vec2 tMorphK;
uniform float tInv2R;
varying vec4 vTAttr;
varying vec4 vTMisc;
varying vec3 vTW;
varying vec2 vTP;
varying float vTH;
`;
const T_VERT_NORMAL = /* glsl */`
vec4 tWp0 = modelMatrix * vec4(position, 1.0);
float tCd = distance(tWp0.xyz, cameraPosition);
float tS = tLeaf * exp2(aData.z);
float tMorph = clamp((tCd - tMorphK.x * tS) / ((tMorphK.y - tMorphK.x) * tS), 0.0, 1.0);
vec3 objectNormal = normalize(mix(aN.xyz, aNC.xyz, tMorph));
`;
const T_VERT_BEGIN = /* glsl */`
vec3 transformed = vec3(position);
transformed.y += aData.w * 0.1 * tMorph;
vTH = transformed.y;
vec2 tRelXZ = tWp0.xz - cameraPosition.xz;
transformed.y -= dot(tRelXZ, tRelXZ) * tInv2R;     // 지구 곡률 (카메라 기준 낙차 d²/2R)
vTP = tWp0.xz + tOriginMod;
vTAttr = aAttr;
vTMisc = vec4(aData.x * 0.1, aData.y, aN.w, aNC.w);
vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;
const T_FRAG_PARS = /* glsl */`
uniform sampler2D tNoiseA;
uniform sampler2D tNoiseB;
uniform vec3 tSunDir;
uniform vec3 tFogCol;
uniform vec3 tZenith;
uniform vec4 tHaze;
uniform float tMieGlow;
uniform float tCamAlt;
uniform float tTime;
uniform vec3 tFade;
uniform float tShadowAmt;
uniform float tOriginX;
varying vec4 vTAttr;
varying vec4 vTMisc;
varying vec3 vTW;
varying vec2 vTP;
varying float vTH;
float tHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float tHazeDepth(float dist, float hc, float hp, float b0, float invH) {
  hc = max(hc, 0.0); hp = max(hp, 0.0);
  float k = (hc - hp) * invH;
  float f = abs(k) < 1e-3 ? 1.0 - 0.5 * k : (1.0 - exp(-k)) / k;
  return b0 * dist * exp(-hp * invH) * f;
}
float tBand(float d, float hw, float fw) { return 1.0 - smoothstep(hw - fw, hw + fw, d); }
// 직교하는 두 선 묶음 (반폭 hw, 주기 p): 멀면 면적 평균으로 수렴 (반짝임 방지)
float tGrid(vec2 g, float hw, float p, float fw) {
  float l = tBand(min(g.x, g.y), hw, fw);
  float avg = clamp(4.0 * hw / p - 4.0 * hw * hw / (p * p), 0.0, 1.0);
  return mix(l, avg, smoothstep(p * 0.06, p * 0.3, fw));
}
`;
// 재질 (color_fragment 자리). 결과: diffuseColor.rgb, tRough, tNw(월드 법선), tWater, tAOv, tSun
const T_FRAG_MATERIAL = /* glsl */`
vec3 tN0 = inverseTransformDirection(normalize(vNormal), viewMatrix);
vec2 P = vTP;
vec2 tFwV = fwidth(P);
float fw = max(max(tFwV.x, tFwV.y), 1e-4);
float tDepth = vTMisc.x;
float tEdge = vTMisc.y;
float tAOv = clamp(vTMisc.z, 0.0, 1.0);
float tSun = clamp(vTMisc.w, 0.0, 1.0);
float tSlope = clamp(1.0 - tN0.y, 0.0, 1.0);
float tAbsX = vTW.x + tOriginX;
vec4 n0 = texture2D(tNoiseA, P * (1.0 / 8192.0));
vec4 n1 = texture2D(tNoiseA, P * (1.0 / 1024.0));
vec4 n2 = texture2D(tNoiseA, P * (1.0 / 128.0));
vec4 n3 = texture2D(tNoiseA, P * (1.0 / 16.0));
float nearF = 1.0 - smoothstep(0.2, 1.2, fw);
float tRough = 0.95;
vec2 tBump = vec2(0.0);
float tWater = 0.0;
vec3 tWN = vec3(0.0, 1.0, 0.0);

// --- 풀밭 (기본): 10월 초록 + 마른 황록 ---
vec3 alb = mix(vec3(0.058, 0.090, 0.030), vec3(0.118, 0.108, 0.050), smoothstep(0.25, 0.85, n1.g * 0.6 + n2.r * 0.4));
alb *= 0.82 + 0.36 * mix(0.5, n3.r, nearF);
if (nearF > 0.0) tBump += (texture2D(tNoiseB, P * 0.25).rg * 2.0 - 1.0) * 0.22 * nearF;

float uW = smoothstep(0.14, 0.30, vTAttr.x + (n1.r - 0.5) * 0.16 + (n2.g - 0.5) * 0.06);
float pW = smoothstep(0.35, 0.65, vTAttr.z);
float fW = smoothstep(0.35, 0.65, vTAttr.y + (n1.r - 0.5) * 0.5 + (n2.g - 0.5) * 0.25) * (1.0 - pW) * (1.0 - uW);
float fieldW = (1.0 - uW) * (1.0 - fW) * (1.0 - pW);

// --- 들판: 지역마다 방향이 다른 필지 (논·그루터기·채소·밭·비닐하우스) ---
if (fieldW > 0.01) {
  vec2 Pw = P + (n0.rg - 0.5) * 600.0;
  vec2 dId = floor(Pw / 1024.0);
  vec2 dIdm = mod(dId, 64.0);
  float dh = tHash(dIdm + 0.37);
  float ang = dh * 6.2831853;
  vec2 loc = Pw - (dId + 0.5) * 1024.0;
  vec2 cs = vec2(cos(ang), sin(ang));
  vec2 fp = vec2(loc.x * cs.x - loc.y * cs.y, loc.x * cs.y + loc.y * cs.x);
  vec2 csz = mix(vec2(32.0, 64.0), vec2(64.0, 130.0), tHash(dIdm + 5.1));
  vec2 cg = fp / csz;
  vec2 cid = floor(cg);
  vec2 cf = fract(cg);
  float h = tHash(cid + dIdm * 17.0 + 0.5);
  vec3 fc; float fr = 0.95;
  if (h < 0.40) fc = mix(vec3(0.25, 0.19, 0.060), vec3(0.31, 0.25, 0.085), n2.r);          // 익은 벼 (황금빛)
  else if (h < 0.66) {                                                                        // 벤 논 (그루터기 줄)
    fc = mix(vec3(0.16, 0.125, 0.075), vec3(0.20, 0.16, 0.10), n2.g);
    fc *= 1.0 + 0.12 * sin(fp.y * 4.0) * nearF;
    float bale = step(0.86, tHash(floor(fp / 7.0) + cid)) * (1.0 - smoothstep(0.75, 1.0, length(fract(fp / 7.0) - 0.5) * 7.0));
    fc = mix(fc, vec3(0.55, 0.56, 0.55), bale * nearF);                                   // 곤포 사일리지 (마시멜로)
  }
  else if (h < 0.80) fc = vec3(0.070, 0.115, 0.038) * (0.8 + 0.4 * n2.r);                   // 채소
  else if (h < 0.90) fc = vec3(0.12, 0.088, 0.062) * (0.85 + 0.3 * n2.g);                   // 갈아엎은 밭
  else {                                                                                      // 비닐하우스 줄
    float rows = abs(fract(fp.x / 8.0) - 0.5) * 8.0;
    float tun = tBand(rows, 2.7, fw);
    tun = mix(tun, 0.66, smoothstep(1.5, 5.0, fw));
    fc = mix(vec3(0.12, 0.10, 0.08), vec3(0.60, 0.62, 0.63), tun);
    fr = mix(0.9, 0.3, tun);
  }
  vec2 ed = min(cf, 1.0 - cf) * csz;
  float edge = tBand(min(ed.x, ed.y), 0.8, fw);
  edge = mix(edge, 1.6 / min(csz.x, csz.y), smoothstep(0.8, 4.0, fw));
  fc = mix(fc, vec3(0.085, 0.095, 0.045), edge * 0.85);
  fc *= 0.9 + 0.2 * n1.g;
  alb = mix(alb, fc, fieldW);
  tRough = mix(tRough, fr, fieldW);
}

// --- 숲: 수관(지름 ~6 m), 침엽/활엽 무리, 고도 높을수록 단풍 ---
if (fW > 0.01) {
  float crownH = n2.b, crownId = n2.a;
  float decid = smoothstep(0.32, 0.68, n1.a * 0.55 + n0.g * 0.6 - 0.08);
  float autumn = clamp(0.28 + smoothstep(120.0, 700.0, vTH) * 0.72, 0.0, 1.0);
  vec3 conifer = vec3(0.024, 0.045, 0.021);
  vec3 green = vec3(0.040, 0.068, 0.025);
  vec3 aut = crownId < 0.28 ? vec3(0.15, 0.030, 0.015) : crownId < 0.55 ? vec3(0.17, 0.070, 0.017) : crownId < 0.8 ? vec3(0.19, 0.15, 0.030) : green;
  vec3 autAvg = vec3(0.125, 0.070, 0.021);
  float cRes = smoothstep(0.5, 3.0, fw);
  vec3 decC = mix(mix(green, aut, autumn), mix(green, autAvg, autumn), cRes);
  vec3 fc = mix(conifer * (0.75 + 0.5 * mix(crownId, 0.5, cRes)), decC, decid);
  fc *= mix(mix(0.28, 1.1, smoothstep(0.02, 0.75, crownH)), 0.78, cRes);
  fc *= 0.78 + 0.44 * n1.b;
  tBump += (texture2D(tNoiseB, P * (1.0 / 128.0)).ba * 2.0 - 1.0) * 1.1 * (1.0 - cRes) * fW;
  alb = mix(alb, fc, fW);
  tRough = mix(tRough, 0.9, fW);
}

// --- 공원 잔디 + 한강 자전거길·산책로·나무 줄 ---
if (pW > 0.01) {
  vec3 pc = mix(vec3(0.062, 0.100, 0.032), vec3(0.098, 0.100, 0.044), n2.r * 0.6 + n1.g * 0.4);
  pc *= 0.85 + 0.3 * mix(0.5, n3.g, nearF);
  float bike = tBand(abs(tEdge - 48.0), 1.6, fw);
  float walkp = tBand(abs(tEdge - 62.0), 1.2, fw);
  pc = mix(pc, vec3(0.052, 0.052, 0.058), bike);
  pc = mix(pc, mix(vec3(0.25, 0.155, 0.11), vec3(0.6), tBand(abs(tEdge - 48.0), 0.07, fw) * nearF), walkp);
  pc = mix(pc, vec3(0.55, 0.45, 0.08), tBand(abs(tEdge - 48.0), 0.06, fw) * nearF * step(0.5, fract(tAbsX / 6.0)));
  float row = tBand(abs(tEdge - 76.0), 4.5, fw) + tBand(abs(tEdge - 150.0), 7.0, fw) * step(0.45, n1.r);
  float crowns = smoothstep(0.2, 0.5, n2.b) * clamp(row, 0.0, 1.0);
  pc = mix(pc, vec3(0.05, 0.072, 0.026) * (0.55 + 0.6 * n2.b), crowns);
  alb = mix(alb, pc, pW);
  tRough = mix(tRough, 0.93, pW);
}

// --- 도시: 휘어진 격자 도로망 (간선 512 m, 집산 128 m) + 필지 ---
if (uW > 0.01) {
  float u = vTAttr.x;
  const float TPI = 6.283185307 / 65536.0;
  vec2 q = P + vec2(260.0 * sin(TPI * (3.0 * P.y + P.x)) + 120.0 * sin(TPI * (7.0 * P.x - 5.0 * P.y) + 1.3),
                    260.0 * sin(TPI * (2.0 * P.x - 3.0 * P.y) + 0.7) + 120.0 * sin(TPI * (4.0 * P.x + 9.0 * P.y) + 2.1));
  vec2 gA = abs(fract(q / 512.0 + 0.5) - 0.5) * 512.0;
  vec2 gC = abs(fract(q / 128.0 + 0.5) - 0.5) * 128.0;
  vec2 sbId = mod(floor(q / 512.0), 128.0);
  vec2 bId = mod(floor(q / 128.0), 512.0);
  float sbH = tHash(sbId + 0.71);
  float collOn = step(0.32, u) * step(0.22, sbH);
  float hwA = 17.0, hwC = 6.5;
  float dA = min(gA.x, gA.y);
  float rA = tGrid(gA, hwA, 512.0, fw);
  float rC = tGrid(gC, hwC, 128.0, fw) * collOn;
  float onRoad = max(rA, rC);
  bool art = dA < hwA + 1.0;
  float hwR = art ? hwA : hwC;
  vec2 g = art ? gA : gC;
  float onX = step(g.x, g.y);
  float across = min(g.x, g.y);
  float along = onX > 0.5 ? q.y : q.x;
  float other = onX > 0.5 ? g.y : g.x;
  float side = smoothstep(hwR - 3.7, hwR - 3.3, across);
  vec3 asph = vec3(0.046, 0.046, 0.050) * (0.82 + 0.36 * n2.g) * (0.9 + 0.2 * n3.g * nearF);
  vec3 walk = vec3(0.25, 0.235, 0.215) * (0.85 + 0.3 * n3.r);
  vec3 rc = mix(asph, walk, side);
  float mkd = 1.0 - smoothstep(0.06, 0.35, fw);
  if (mkd > 0.0 && other > hwR) {
    float cy = tBand(abs(across - 0.22), 0.08, fw);
    float dash = step(fract(along / 10.0), 0.3);
    float ln = 0.0;
    for (int k = 1; k <= 4; k++) { float c = 0.4 + 3.3 * float(k); if (c < hwR - 3.8) ln = max(ln, tBand(abs(across - c), 0.07, fw) * dash); }
    float cw = step(hwR + 0.8, other) * step(other, hwR + 5.0) * step(across, hwR - 3.6) * step(0.5, fract(across / 0.9));
    rc = mix(rc, vec3(0.42, 0.30, 0.05), cy * mkd * (1.0 - side));
    rc = mix(rc, vec3(0.62, 0.62, 0.60), max(ln, cw) * mkd * (1.0 - side));
  }
  // 가로수 (은행나무 노랑 / 느티나무 초록)
  float ta = across - (hwR - 1.6);
  float tb = (fract(along / 8.0) - 0.5) * 8.0;
  float crown = 1.0 - smoothstep(1.3, 2.0, length(vec2(ta, tb)));
  float treeRow = mix(crown, 0.3 * side, smoothstep(0.4, 1.6, fw)) * onRoad;
  float ginkgo = step(0.5, tHash(sbId * 3.1 + vec2(onX, floor(across / 200.0))));
  vec3 tc = mix(vec3(0.065, 0.08, 0.03), vec3(0.24, 0.19, 0.035), ginkgo) * (0.7 + 0.5 * n3.g);
  rc = mix(rc, tc, treeRow);
  // 블록 내부: 저층 필지 지붕 / 고밀 광장·조경
  vec2 bl = fract(q / 128.0);
  float bH = tHash(bId + 0.13);
  vec2 lg = bl * vec2(10.0, 8.0);
  vec2 lid = floor(lg);
  vec2 lf = fract(lg);
  float lH = tHash(lid + bId * 3.7 + 0.5);
  vec3 roof = lH < 0.28 ? vec3(0.10, 0.17, 0.10) : lH < 0.55 ? vec3(0.30, 0.29, 0.27) : lH < 0.70 ? vec3(0.21, 0.10, 0.07)
            : lH < 0.80 ? vec3(0.07, 0.11, 0.19) : lH < 0.90 ? vec3(0.42, 0.41, 0.39) : vec3(0.13, 0.12, 0.11);
  roof *= 0.8 + 0.4 * n3.g;
  vec2 le = min(lf, 1.0 - lf) * vec2(12.8, 16.0);
  float gap = tBand(min(le.x, le.y), 0.6, fw);
  gap = mix(gap, 0.12, smoothstep(0.3, 1.2, fw));
  vec3 roofAvg = vec3(0.21, 0.185, 0.16) * (0.82 + 0.36 * bH);
  vec3 lowrise = mix(roofAvg, mix(roof, vec3(0.085, 0.085, 0.085), gap), 1.0 - smoothstep(1.5, 6.0, fw));
  vec3 plaza = vec3(0.23, 0.225, 0.21) * (0.8 + 0.4 * n2.r);
  vec3 grn = vec3(0.045, 0.072, 0.03) * (0.8 + 0.5 * n3.g);
  vec3 dense = mix(plaza, grn, smoothstep(0.45, 0.75, n2.g * 0.7 + bH * 0.3) * 0.65);
  vec3 blockC = mix(lowrise, dense, smoothstep(0.55, 0.85, u + (bH - 0.5) * 0.3));
  if (bH > 0.955) { vec2 c = abs(bl - 0.5); blockC = mix(blockC, vec3(0.30, 0.21, 0.13), step(max(c.x, c.y), 0.3)); }   // 학교 운동장
  vec3 urb = mix(blockC, rc, onRoad);
  alb = mix(alb, urb, uW);
  tRough = mix(tRough, mix(0.8, 0.9, onRoad), uW);
}

// --- 암석 (가파른 비탈, 북한산·관악산 화강암) ---
float rW = smoothstep(0.32, 0.46, tSlope + (n2.r - 0.5) * 0.16);
rW = max(rW, vTAttr.w * smoothstep(0.07, 0.2, tSlope + (n1.g - 0.5) * 0.25));
rW *= 1.0 - uW;
if (rW > 0.01) {
  vec3 rc = mix(vec3(0.30, 0.285, 0.26), vec3(0.42, 0.40, 0.37), n2.g);
  rc *= 0.75 + 0.4 * mix(0.5, n3.g, nearF);
  rc = mix(rc, vec3(0.10, 0.10, 0.095), smoothstep(0.6, 0.85, n1.g * 0.5 + n3.r * 0.5) * 0.55);
  rc = mix(rc, vec3(0.06, 0.08, 0.04), smoothstep(0.65, 0.85, n2.r) * 0.4);
  tBump += (texture2D(tNoiseB, P * (1.0 / 32.0)).rg * 2.0 - 1.0) * 0.55 * rW;
  alb = mix(alb, rc, rW);
  tRough = mix(tRough, 0.7, rW);
}

// --- 물가 (모래·자갈 / 서해 갯벌) ---
float seaF = 1.0 - smoothstep(-37000.0, -31000.0, tAbsX);
if (tDepth > -3.6) {
  float sW = smoothstep(-3.6, -1.4, tDepth + (n2.g - 0.5) * 1.4) * (1.0 - uW * 0.7);
  vec3 sc = mix(vec3(0.25, 0.225, 0.18), vec3(0.30, 0.28, 0.23), n2.r);
  sc = mix(sc, vec3(0.13, 0.115, 0.095), seaF * 0.75);
  float wet = smoothstep(-1.2, -0.1, tDepth);
  sc *= 1.0 - 0.45 * wet;
  alb = mix(alb, sc, sW);
  tRough = mix(tRough, mix(0.9, 0.35, wet), sW);
}

// --- 물 (한강·서해): 흐르는 잔물결, 수심에 따른 색 ---
if (tDepth > -0.2) {
  tWater = smoothstep(-0.05, 0.4, tDepth);
  float df = 1.0 / (1.0 + fw * 0.8);
  vec2 w1 = texture2D(tNoiseB, P * (1.0 / 64.0) + tTime * vec2(0.010, 0.006)).rg * 2.0 - 1.0;
  vec2 w2 = texture2D(tNoiseB, P * (1.0 / 16.0) + tTime * vec2(-0.016, 0.013)).rg * 2.0 - 1.0;
  vec2 w3 = texture2D(tNoiseB, P * (1.0 / 256.0) + tTime * vec2(0.0025, -0.002)).rg * 2.0 - 1.0;
  vec2 wn = (w1 * 0.35 + w2 * 0.25 * df + w3 * 0.35) * mix(0.45, 0.8, seaF);
  tWN = normalize(vec3(-wn.x, 1.0, -wn.y));
  vec3 deep = mix(vec3(0.010, 0.020, 0.017), vec3(0.008, 0.019, 0.026), seaF);
  vec3 shal = mix(vec3(0.07, 0.068, 0.05), vec3(0.06, 0.058, 0.045), seaF);
  vec3 wc = mix(shal, deep, smoothstep(0.0, 2.5, tDepth));
  alb = mix(alb, wc, tWater);
  tRough = mix(tRough, mix(0.045, 0.14, smoothstep(0.5, 40.0, fw)), tWater);
}
diffuseColor.rgb = alb;
vec3 tNw = normalize(tN0 + vec3(tBump.x, 0.0, tBump.y));
tNw = normalize(mix(tNw, tWN, tWater));
`;
const T_FRAG_OUT = /* glsl */`
vec3 tCol = outgoingLight;
vec3 tRel = vTW - cameraPosition;
float tDist = length(tRel);
vec3 tVd = tRel / max(tDist, 1e-3);
if (tWater > 0.0) {   // 하늘 반사 (프레넬)
  float cosT = clamp(dot(tNw, -tVd), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  vec3 R = reflect(tVd, tNw);
  vec3 sky = mix(tFogCol, tZenith, pow(clamp(R.y, 0.0, 1.0), 0.55));
  tCol = mix(tCol, sky, F * tWater);
}
// 대기 원근: 미 산란(낮은 연무) + 레일리 (고도 지수 분포를 따라 적분)
float tHp = max(vTH, 0.0);
float tauM = tHazeDepth(tDist, tCamAlt, tHp, tHaze.x, tHaze.y);
float tauR = tHazeDepth(tDist, tCamAlt, tHp, tHaze.z, tHaze.w);
vec3 tT = exp(-(vec3(tauM) + tauR * vec3(0.55, 1.0, 2.0)));
float tMu = max(dot(tVd, tSunDir), 0.0);
float tMu2 = tMu * tMu, tMu4 = tMu2 * tMu2;
vec3 tHz = tFogCol * (1.0 + tMieGlow * tMu4 * tMu4);
tCol = tCol * tT + tHz * (1.0 - tT);
float tA = tFade.x * (1.0 - smoothstep(tFade.y, tFade.z, tDist));
gl_FragColor = vec4(tCol * tA, tA);
`;

function makeTerrainMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.name = 'TerrainPBR';
  mat.fog = false;
  // 프리멀티플라이드 알파 블렌딩 (불투명 패스에서 그려짐): 평소엔 α=1, 고고도/시야 끝에서 서서히 투명 → 우주 장면이 비침
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  mat.onBeforeCompile = (sh) => {
    for (const k in uniforms) sh.uniforms[k] = uniforms[k];
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + T_VERT_PARS)
      .replace('#include <beginnormal_vertex>', T_VERT_NORMAL)
      .replace('#include <begin_vertex>', T_VERT_BEGIN);
    let lights = THREE.ShaderChunk.lights_fragment_begin
      .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= tSun;');
    lights = lights.replace(/getShadow\( directionalShadowMap\[ i \],([^;]*)\) : 1\.0;/, 'mix( 1.0, getShadow( directionalShadowMap[ i ],$1), tShadowAmt ) : 1.0;');
    if (lights.indexOf('tSun') < 0) console.warn('[Terrain] light chunk patch failed');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + T_FRAG_PARS)
      .replace('#include <color_fragment>', T_FRAG_MATERIAL)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tNw, 0.0)).xyz);')
      .replace('#include <lights_fragment_begin>', lights)
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= tAOv;\nreflectedLight.indirectSpecular *= tAOv;')
      .replace('#include <opaque_fragment>', T_FRAG_OUT);
  };
  mat.customProgramCacheKey = () => 'skyblade-terrain-v1';
  return mat;
}

/* =====================================================================================
 *  Terrain: 쿼드트리 LOD (CDLOD식 모프 + 스커트), 워커 생성, LRU 슬롯 풀, 플로팅 원점
 * ===================================================================================== */
const LEVELS = 13;                       // 0..12 → 최상위 청크 128·4096 m ≈ 524 km
const KEY_OFF = 1048576, KEY_MUL = 2097152;
const nodeKey = (l, ix, iz) => (l * KEY_MUL + (ix + KEY_OFF)) * KEY_MUL + (iz + KEY_OFF);
const R2 = 2 * frame.R_EARTH;
const _m4 = new THREE.Matrix4();
const _box = new THREE.Box3();
const _v = new THREE.Vector3();
const _camAbs = new THREE.Vector3();

export class Terrain {
  constructor(renderer, scene, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    const low = opts.quality === 'low';
    this.quality = low ? 'low' : 'high';
    this.sunDir = (opts.sunDir || frame.SUN_DIR).clone().normalize();
    this.N = low ? 32 : 64;                // 청크 한 변 사각형 수
    this.leaf = 128;                       // 0레벨 청크 크기 (m) → 정점 간격 2 m (low 4 m)
    this.NT = (this.N + 1) * (this.N + 1) + 4 * (this.N + 1);
    this.maxSlots = low ? 240 : 480;
    this.resultBudget = low ? 6 : 12;      // 프레임당 GPU 업로드 청크 수

    // 튜닝 파라미터 (매 프레임 반영)
    this.params = {
      lodK: low ? 1.35 : 1.6,              // 분할 거리 = lodK × 청크 크기
      hazeB0: 1 / 24000, hazeH: 1400,      // 낮은 연무 (미 산란) 해수면 소광계수, 척도 높이
      rayB0: 0.65e-5, rayH: 8500,           // 레일리
      mieGlow: 0.7,                        // 태양 쪽 연무 밝아짐
      fadeStart: 45000, fadeEnd: 65000,    // 이 고도 사이에서 지형이 사라짐 (우주의 지구 구체로 교대)
      maxRange: 420000,                    // 최대 시야 (m), 카메라 far 로도 제한
      edgeFade: 0.8,                       // 시야 끝 페이드 시작 비율
      zenithScale: 0.32,                   // 물에 비친 천정 하늘 = 반구광 색 × 세기 × 이 값
    };

    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);

    const tex = buildNoiseTextures(renderer);
    this.textures = tex;
    this.uniforms = {
      tOriginMod: { value: new THREE.Vector2() },
      tOriginX: { value: 0 },
      tLeaf: { value: this.leaf },
      tMorphK: { value: new THREE.Vector2() },
      tInv2R: { value: 1 / R2 },
      tNoiseA: { value: tex.A },
      tNoiseB: { value: tex.B },
      tSunDir: { value: this.sunDir },
      tFogCol: { value: new THREE.Color(0.55, 0.62, 0.72) },
      tZenith: { value: new THREE.Color(0.18, 0.3, 0.55) },
      tHaze: { value: new THREE.Vector4() },
      tMieGlow: { value: 0.7 },
      tCamAlt: { value: 0 },
      tTime: { value: 0 },
      tFade: { value: new THREE.Vector3(1, 3e5, 4e5) },
      tShadowAmt: { value: 1 },
    };
    this.material = makeTerrainMaterial(this.uniforms);
    this._index = new THREE.BufferAttribute(CORE.buildIndex(this.N), 1);

    this._nodes = new Map();
    this._slots = [];
    this._free = [];
    this._drawn = [];
    this._req = [];
    this._results = [];
    this._frame = 0;
    this._time = 0;
    this._groundHaze = new THREE.Color(0.55, 0.62, 0.72);
    this._hazeInit = false;
    this._frustum = new THREE.Frustum();
    this._sunLight = null;
    this._hemi = null;
    this._lightSearchT = 0;
    this.stats = { draws: 0, tris: 0, nodes: 0, slots: 0, pending: 0, inflight: 0, genMs: 0, generated: 0 };

    this._initWorkers(opts.workers !== undefined ? opts.workers : (low ? 2 : 4));
    this._syncBufs = null;

    // 최상위 청크 3×3 은 바로 생성 (구멍 방지)
    const S = this.leaf * Math.pow(2, LEVELS - 1);
    const cx = Math.floor(frame.origin.x / S), cz = Math.floor(frame.origin.z / S);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const node = this._getNode(LEVELS - 1, cx + i, cz + j, null);
      this._genSync(node);
    }
  }

  // ---------- 워커 ----------
  _initWorkers(n) {
    this._workers = [];
    if (!n || typeof Worker === 'undefined') return;
    const src = 'const core = (' + terrainCore.toString() + ')();\n' +
      'const pool = [];\n' +
      'self.onmessage = (e) => {\n' +
      '  const d = e.data;\n' +
      '  if (d.recycle) { pool.push(d.recycle); return; }\n' +
      '  const r = core.genChunk(d.level, d.ix, d.iz, d.N, d.leaf, d.sx, d.sy, d.sz, pool.pop());\n' +
      '  self.postMessage({ key: d.key, r }, [r.pos.buffer, r.n.buffer, r.nc.buffer, r.attr.buffer, r.data.buffer]);\n' +
      '};\n';
    let url = null;
    try {
      url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
      n = Math.max(1, Math.min(n, cores - 1));
      for (let i = 0; i < n; i++) {
        const w = new Worker(url);
        const rec = { w, busy: 0 };
        w.onmessage = (e) => { rec.busy--; this._results.push(e.data, rec); };
        w.onerror = (e) => { console.warn('[Terrain] worker error', e.message); };
        this._workers.push(rec);
      }
    } catch (e) {
      console.warn('[Terrain] workers unavailable, generating on main thread', e);
      this._workers.length = 0;
    }
  }

  _getNode(l, ix, iz, parent) {
    const key = nodeKey(l, ix, iz);
    let n = this._nodes.get(key);
    if (n) return n;
    const size = this.leaf * Math.pow(2, l);
    n = { key, level: l, ix, iz, size, x0: ix * size, z0: iz * size, state: 0, slot: null, minY: 0, maxY: 0, touch: 0, prio: 0 };
    if (parent) { n.minY = parent.minY; n.maxY = parent.maxY; }
    else { const h = CORE.heightAt(n.x0 + size * 0.5, n.z0 + size * 0.5); n.minY = Math.min(h, 0) - 60; n.maxY = Math.max(h, 0) + Math.min(2000, size * 0.2 + 100); }
    this._nodes.set(key, n);
    return n;
  }

  _genSync(node) {
    const t0 = performance.now();
    const s = this.sunDir;
    const r = CORE.genChunk(node.level, node.ix, node.iz, this.N, this.leaf, s.x, s.y, s.z, this._syncBufs);
    this._syncBufs = r;
    this._accept(node, r);
    this.stats.genMs += performance.now() - t0;
  }

  _slotFor(node) {
    let slot = this._free.pop();
    if (!slot && this._slots.length < this.maxSlots) slot = this._newSlot();
    if (!slot) {   // LRU 축출
      let best = null, bt = this._frame - 1;
      for (let i = 0; i < this._slots.length; i++) {
        const s = this._slots[i], nd = s.node;
        if (nd && nd.touch < bt) { bt = nd.touch; best = s; }
      }
      if (!best) return null;
      best.node.state = 0; best.node.slot = null;
      best.mesh.visible = false;
      slot = best;
    }
    slot.node = node;
    return slot;
  }

  _newSlot() {
    const NT = this.NT;
    const geo = new THREE.BufferGeometry();
    const a = {
      pos: new THREE.BufferAttribute(new Float32Array(NT * 3), 3),
      n: new THREE.BufferAttribute(new Int8Array(NT * 4), 4, true),
      nc: new THREE.BufferAttribute(new Int8Array(NT * 4), 4, true),
      attr: new THREE.BufferAttribute(new Uint8Array(NT * 4), 4, true),
      data: new THREE.BufferAttribute(new Int16Array(NT * 4), 4, false),
    };
    geo.setAttribute('position', a.pos);
    geo.setAttribute('aN', a.n);
    geo.setAttribute('aNC', a.nc);
    geo.setAttribute('aAttr', a.attr);
    geo.setAttribute('aData', a.data);
    geo.setIndex(this._index);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-1e9, -1e9, -1e9), new THREE.Vector3(1e9, 1e9, 1e9));
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = 'terrainChunk';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.visible = false;
    this.group.add(mesh);
    const slot = { mesh, geo, a, node: null };
    this._slots.push(slot);
    return slot;
  }

  _accept(node, r) {
    const slot = this._slotFor(node);
    if (!slot) { node.state = 0; return false; }
    const a = slot.a;
    a.pos.array.set(r.pos); a.pos.needsUpdate = true;
    a.n.array.set(r.n); a.n.needsUpdate = true;
    a.nc.array.set(r.nc); a.nc.needsUpdate = true;
    a.attr.array.set(r.attr); a.attr.needsUpdate = true;
    a.data.array.set(r.data); a.data.needsUpdate = true;
    node.minY = r.minY; node.maxY = r.maxY;
    node.state = 2;
    node.slot = slot;
    this.stats.generated++;
    return true;
  }

  _request(node, prio) {
    if (node.state !== 0) return;
    if (node.touchReq !== this._frame) { node.touchReq = this._frame; node.prio = prio; this._req.push(node); }
    else if (prio < node.prio) node.prio = prio;
  }

  _boxDist(node, c) {
    const s = node.size;
    const dx = Math.max(node.x0 - c.x, 0, c.x - (node.x0 + s));
    const dz = Math.max(node.z0 - c.z, 0, c.z - (node.z0 + s));
    const dy = Math.max(node.minY - c.y, 0, c.y - node.maxY);
    this._d2 = Math.sqrt(dx * dx + dz * dz);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  _inFrustum(node, c) {
    const o = frame.origin, s = node.size;
    const dn = this._d2;
    const fx = Math.max(Math.abs(node.x0 - c.x), Math.abs(node.x0 + s - c.x)), fz = Math.max(Math.abs(node.z0 - c.z), Math.abs(node.z0 + s - c.z));
    const df2 = fx * fx + fz * fz;
    _box.min.set(node.x0 - o.x, node.minY - o.y - df2 / R2, node.z0 - o.z);
    _box.max.set(node.x0 + s - o.x, node.maxY - o.y - dn * dn / R2, node.z0 + s - o.z);
    return this._frustum.intersectsBox(_box);
  }

  _visit(l, ix, iz, parent) {
    const node = this._getNode(l, ix, iz, parent);
    node.touch = this._frame;
    const c = _camAbs;
    const dist = this._boxDist(node, c);
    if (dist > this._range) return;
    // 지평선 너머 (곡률에 가려짐)
    if (this._d2 > this._horizon + Math.sqrt(R2 * Math.max(node.maxY, 1))) return;
    const K = this.params.lodK;
    if (l > 0 && dist < K * node.size) {
      let ready = 0;
      const cl = l - 1, bx = ix * 2, bz = iz * 2;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const ch = this._getNode(cl, bx + i, bz + j, node);
        ch.touch = this._frame;
        if (ch.state === 2) ready++;
        else if (ch.state === 0) {
          const cd = this._boxDist(ch, c);
          const vis = this._inFrustum(ch, c);
          this._request(ch, cd / ch.size + (vis ? 0 : 2.5) - cl * 0.01);
        }
      }
      if (ready === 4) {
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) this._visit(cl, bx + i, bz + j, node);
        return;
      }
      this._boxDist(node, c);   // _d2 복원
    }
    if (node.state !== 2) { if (node.state === 0) this._request(node, -10); return; }
    if (!this._inFrustum(node, c)) return;
    const o = frame.origin, mesh = node.slot.mesh;
    mesh.position.set(node.x0 + node.size * 0.5 - o.x, -o.y, node.z0 + node.size * 0.5 - o.z);
    mesh.updateMatrix();
    mesh.visible = true;
    this._drawn.push(mesh);
  }

  /** 시작 화면 뒤 등에서 호출: 현재 카메라 주변 청크를 메인 스레드에서 즉시 생성 (최대 maxMs) */
  warmup(camera, camAbs, maxMs = 1500) {
    const t0 = performance.now();
    for (let it = 0; it < 200; it++) {
      this.update(0, camera, camAbs);
      this._results.length = 0;
      if (this._req.length === 0 && this.stats.inflight === 0) break;
      for (let i = 0; i < this._req.length; i++) {
        const nd = this._req[i];
        if (nd.state === 0) this._genSync(nd);
        if (performance.now() - t0 > maxMs) return;
      }
    }
  }

  get pending() { return this._req.length + this.stats.inflight; }

  update(dt, camera, camAbs) {
    this._frame++;
    const P = this.params, U = this.uniforms;
    this._time = (this._time + (dt || 0)) % 2000;
    if (!camAbs) camAbs = _v.copy(camera.position).add(frame.origin);
    _camAbs.copy(camAbs);
    const alt = camAbs.y;

    // 이전 프레임 표시 해제
    for (let i = 0; i < this._drawn.length; i++) this._drawn[i].visible = false;
    this._drawn.length = 0;

    // 워커 결과 수용 (프레임당 예산)
    let budget = this.resultBudget;
    while (this._results.length > 0 && budget > 0) {
      const msg = this._results.shift(), rec = this._results.shift();
      const r = msg.r, node = this._nodes.get(msg.key);
      if (node && node.state === 1) { this._accept(node, r); budget--; }
      rec.w.postMessage({ recycle: r }, [r.pos.buffer, r.n.buffer, r.nc.buffer, r.attr.buffer, r.data.buffer]);
    }

    // 고고도 페이드
    const fadeA = 1 - sstepJS(P.fadeStart, P.fadeEnd, alt);
    this.group.visible = fadeA > 0.002;
    if (!this.group.visible) { this.stats.draws = 0; this._req.length = 0; return; }

    camera.updateMatrixWorld();
    _m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(_m4);
    this._range = Math.min(P.maxRange, camera.far * 0.995);
    this._horizon = Math.sqrt(R2 * Math.max(alt, 1));

    // 쿼드트리 선택
    this._req.length = 0;
    const L = LEVELS - 1, S = this.leaf * Math.pow(2, L);
    const cx = Math.floor(camAbs.x / S), cz = Math.floor(camAbs.z / S);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) this._visit(L, cx + i, cz + j, null);

    // 생성 요청 (우선순위 정렬 → 워커 분배)
    const req = this._req;
    for (let i = 1; i < req.length; i++) {   // 삽입 정렬 (할당 없음)
      const x = req[i]; let j = i - 1;
      while (j >= 0 && req[j].prio > x.prio) { req[j + 1] = req[j]; j--; }
      req[j + 1] = x;
    }
    let inflight = 0;
    if (this._workers.length) {
      let k = 0;
      for (let w = 0; w < this._workers.length; w++) {
        const rec = this._workers[w];
        while (rec.busy < 2 && k < req.length) {
          const nd = req[k++];
          if (nd.state !== 0) continue;
          nd.state = 1;
          rec.busy++;
          rec.w.postMessage({ key: nd.key, level: nd.level, ix: nd.ix, iz: nd.iz, N: this.N, leaf: this.leaf, sx: this.sunDir.x, sy: this.sunDir.y, sz: this.sunDir.z });
        }
        inflight += rec.busy;
      }
    } else if (dt > 0) {   // 워커 없음: 프레임당 ~3 ms
      const t0 = performance.now();
      for (let k = 0; k < req.length && performance.now() - t0 < 3; k++) if (req[k].state === 0) this._genSync(req[k]);
    }

    // 오래 안 쓴 빈 노드 정리
    if ((this._frame & 127) === 0) {
      for (const [key, nd] of this._nodes) if (nd.state === 0 && nd.touch < this._frame - 600) this._nodes.delete(key);
    }

    // 유니폼
    const o = frame.origin;
    U.tOriginMod.value.set(((o.x % 65536) + 65536) % 65536, ((o.z % 65536) + 65536) % 65536);
    U.tOriginX.value = o.x;
    U.tCamAlt.value = alt;
    U.tTime.value = this._time;
    const K = P.lodK;
    U.tMorphK.value.set(2 * K * 0.97 * 0.62, 2 * K * 0.97);
    U.tHaze.value.set(P.hazeB0, 1 / P.hazeH, P.rayB0, 1 / P.rayH);
    U.tMieGlow.value = P.mieGlow;
    U.tFade.value.set(fadeA, this._range * P.edgeFade, this._range);

    // 장면 조명/안개와 맞춤
    if (--this._lightSearchT <= 0 && (!this._sunLight || !this._hemi)) {
      this._lightSearchT = 120;
      this.scene.traverse((ob) => {
        if (ob.isDirectionalLight && !this._sunLight) this._sunLight = ob;
        if (ob.isHemisphereLight && !this._hemi) this._hemi = ob;
      });
    }
    const fog = this.scene.fog;
    if (fog && fog.color) {
      if (!this._hazeInit || alt < 1500) { this._groundHaze.copy(fog.color); this._hazeInit = true; }
      U.tFogCol.value.copy(fog.color).lerp(this._groundHaze, sstepJS(1500, 8000, alt));
    }
    if (this._hemi) U.tZenith.value.copy(this._hemi.color).multiplyScalar(this._hemi.intensity * P.zenithScale);
    const agl = alt - CORE.heightAt(camAbs.x, camAbs.z);
    let sh = (1 - 0.6 * sstepJS(3, 90, agl)) * (1 - sstepJS(110, 170, agl));
    if (this._sunLight && (!this._sunLight.castShadow || this._sunLight.shadow.autoUpdate === false)) sh = 0;
    U.tShadowAmt.value = sh;

    // 통계
    const st = this.stats;
    st.draws = this._drawn.length;
    st.tris = this._drawn.length * (this.N * this.N * 2 + this.N * 8);
    st.nodes = this._nodes.size;
    st.slots = this._slots.length;
    st.pending = this._req.length;
    st.inflight = inflight;
  }

  dispose() {
    for (const rec of this._workers) rec.w.terminate();
    this._workers.length = 0;
    for (const s of this._slots) s.geo.dispose();
    this.material.dispose();
    this.textures.A.dispose(); this.textures.B.dispose();
    this.scene.remove(this.group);
  }
}
