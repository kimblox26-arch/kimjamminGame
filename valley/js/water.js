// 얕은 물 시뮬레이션(가상 파이프 + 마찰) · 침식 · 물 표면 렌더링
import * as THREE from 'three';
import { CELL, NX, NZ, NXV, NZV, NV, X0, Z0, SX0, SX1, SW, idx, U, ground, loose, cap, soil, bed, gfr, cem, cure, diag, centerX, baseY, markDirtyCell, MODE, SEA_Y, ISTH_Z } from './terrain.js';
import { GLSL_NOISE, sstep } from './noise.js';
import { GLSL_SKY } from './sky.js';

const G = 9.81, CF = 0.045, A = CELL * CELL;
export const h = new Float32Array(NV), solid = new Float32Array(NV), sBot = new Float32Array(NV).fill(1e9);
// 돌무더기 공극(틈): seal=공극 바닥(땅/진흙), ptop=공극 꼭대기(돌 윗면). 그 사이로 물이 스며 흐른다
export const seal = new Float32Array(NV), ptop = new Float32Array(NV), lev = new Float32Array(NV);
export const PHI = 0.38; let KP = 0.25;
export const KS = 0.02; // 흙·진흙 투수계수(가는 모래 수준): 흙둑도 아주 조금씩 샌다
export const kp = new Float32Array(NV); // 셀별 투수계수 (돌무더기≈KP, 흙≈KS)
export const core = new Uint8Array(NV); // 큰 돌의 속(단단한 바위): 물이 스미지 못하고 돌아 흐른다
export const dam = new Uint8Array(NV); // 콘크리트 댐 칸 (물이 스미지 않음)
export const pipes = []; // 수력발전 터빈 관 {a:[칸], b:[칸], area, Q, head, P}
const ho = new Float32Array(NV), hp = new Float32Array(NV);
const pL = new Float32Array(NV), pR = new Float32Array(NV), pU = new Float32Array(NV), pD = new Float32Array(NV);
const fL = new Float32Array(NV), fR = new Float32Array(NV), fU = new Float32Array(NV), fD = new Float32Array(NV);
export const vx = new Float32Array(NV), vz = new Float32Array(NV), foam = new Float32Array(NV), wet = new Float32Array(NV);
export const sed = new Float32Array(NV); const sed2 = new Float32Array(NV);
const vxm = new Float32Array(NV), vzm = new Float32Array(NV); // 10초 평균 물살 (파도처럼 왔다 갔다 하는 흐름은 0 에 가깝다)
export const h0 = new Float32Array(NV); // 저수량 기준 수심
export const MEAS_J = 325; // z=65 (하류 낙차 직전)
export const state = { tide: 0, tideA: 0, tideB: 0, inflow: 0.2, outflow: 0.2, outSm: 0.2, time: 0, stored: 0, maxDepth: 0, steps: 0, eroded: 0 };
const src = [];
// 바다: 양쪽 바다에서 사주로 밀려오는 파도 — 주기가 다른 너울 세 개가 겹쳐 파도 무리(세트)가 생긴다
export const WAVES_A = [[0.12, 6.1, 0.3], [0.06, 4.1, 2.2], [0.05, 8.7, 1.1]]; // 남쪽 바다 [진폭 m, 주기 s, 위상]
export const WAVES_B = [[0.13, 6.5, 0], [0.07, 4.3, 1.7], [0.05, 9.1, 0.4]]; // 북쪽 바다
export const C_SEA = 4.2; // 파도 속도 m/s (√(g·h), 수심 약 1.8 m)
// 계산 범위: 남쪽 바다 z≥14 (JL), 북쪽 바다 z≤58 (JM). 그 너머는 들어오는 파도를 식으로 그린다 (폰에서 가볍게)
export let JL = 0, JM = NZ;
export const SEA_ZA = 13, SEA_ZB = 59;
const etaAt = (W, t, d) => { let e = 0; for (const [a, T, p] of W) e += a * Math.sin(2 * Math.PI * (t / T + d / (C_SEA * T)) + p); return e; };
export const seaLevelA = () => SEA_Y + state.tideA, seaLevelB = () => SEA_Y + state.tideB;
function seaBoundary() {
  const t = state.time;
  for (let j = 0; j <= NZ; j++) {
    if (j > JL + 1 && j < JM - 1) continue;
    const south = j <= JL + 1, e = south ? seaLevelA() + etaAt(WAVES_A, t, (JL - j) * CELL) : seaLevelB() + etaAt(WAVES_B, t, (j - JM) * CELL);
    for (let i = SX0; i < SX1; i++) { const k = j * NXV + i; h[k] = Math.max(0, e - solid[k]); lev[k] = solid[k] + h[k]; ho[k] = h[k]; }
  }
}
export function init() {
  allocTex(); lo.fill(SX0); hi.fill(SX1 - 1);
  if (MODE === 'sea') { JL = Math.round(SEA_ZA / CELL); JM = Math.round(SEA_ZB / CELL); state.inflow = 0; state.outSm = 0; beginSolid(); return; }
  const zs = 5.2, cx = centerX(zs);
  for (let j = Math.round(zs / CELL) - 2; j <= Math.round(zs / CELL) + 2; j++)
    for (let i = SX0; i < SX1; i++) { const x = X0 + i * CELL; if (Math.abs(x - cx) < 0.7) src.push(idx(i, j)); }
  beginSolid();
}
export function beginSolid() {
  for (let j = 0; j < NZV; j++) {
    const b = idx(SX0, j), g = ground.subarray(b, b + SW);
    solid.set(g, b); seal.set(g, b); ptop.set(g, b); sBot.fill(1e9, b, b + SW); dam.fill(0, b, b + SW); core.fill(0, b, b + SW);
  }
}

// 물이 있는 곳 주변만 계산(행마다 활성 열 범위) — 계곡 대부분은 말라 있어 연산이 크게 준다
const lo = new Int32Array(NZV).fill(SX0), hi = new Int32Array(NZV).fill(SX1 - 1);
const wlo = new Int32Array(NZV), whi = new Int32Array(NZV);
export function computeActive() {
  for (let j = 0; j < NZV; j++) {
    let a = SX1, b = SX0 - 1;
    for (let i = SX0; i < SX1; i++) if (h[j * NXV + i] > 0) { if (i < a) a = i; b = i; }
    wlo[j] = a; whi[j] = b;
  }
  lo.fill(SX0); hi.fill(SX1 - 1);
  widen();
}
function widen() {
  for (const k of src) { const j = (k / NXV) | 0, i = k % NXV; if (i < wlo[j]) wlo[j] = i; if (i > whi[j]) whi[j] = i; }
  for (const p of pipes) for (const k of p.b) { const j = (k / NXV) | 0, i = k % NXV; if (i < wlo[j]) wlo[j] = i; if (i > whi[j]) whi[j] = i; }
  for (let j = 0; j < NZV; j++) {
    let a = SX1, b = SX0 - 1;
    for (let jj = Math.max(0, j - 1); jj <= Math.min(NZ, j + 1); jj++) if (wlo[jj] <= whi[jj]) { if (wlo[jj] < a) a = wlo[jj]; if (whi[jj] > b) b = whi[jj]; }
    const nl = a > b ? SX1 : Math.max(SX0, a - 2), nh = a > b ? SX0 - 1 : Math.min(SX1 - 1, b + 2);
    // 범위에서 빠지는 셀은 남은 흐름을 지운다
    for (let i = lo[j]; i <= hi[j]; i++) if (i < nl || i > nh) { const k = j * NXV + i; fL[k] = fR[k] = fU[k] = fD[k] = pL[k] = pR[k] = pU[k] = pD[k] = vx[k] = vz[k] = 0; }
    lo[j] = nl; hi[j] = nh;
  }
}
export function step(dt) {
  const kf = dt * G, sea = MODE === 'sea';
  if (sea) seaBoundary();
  // 수위: 공극이 차기 전엔 seal + h/φ, 다 차면 돌 위로 흐름
  for (let j = JL; j <= JM; j++) {
    const i1 = Math.min(SX1 - 1, hi[j] + 1);
    for (let i = Math.max(SX0, lo[j] - 1); i <= i1; i++) {
      const k = j * NXV + i, hk = h[k], cp = PHI * (ptop[k] - seal[k]);
      if (cp > 1e-4) {
        if (hk <= cp) { lev[k] = seal[k] + hk / PHI; ho[k] = 0; hp[k] = hk / PHI; }
        else { lev[k] = solid[k] + hk - cp; ho[k] = hk - cp; hp[k] = ptop[k] - seal[k]; }
      } else { lev[k] = solid[k] + hk; ho[k] = hk; hp[k] = 0; }
    }
  }
  for (let j = JL; j <= JM; j++) {
    for (let i = lo[j]; i <= hi[j]; i++) {
      const k = j * NXV + i, hk = h[k];
      if (hk <= 0) { fL[k] = fR[k] = fU[k] = fD[k] = pL[k] = pR[k] = pU[k] = pD[k] = 0; continue; }
      const H = lev[k], o = ho[k], q = hp[k];
      let l = 0, r = 0, u = 0, d = 0, a = 0, b = 0, c = 0, e = 0;
      if (i > SX0) { l = flux(fL[k], H, o, k - 1, kf, dt); if (q > 0 && H > lev[k - 1]) a = kp[k] * q * (H - lev[k - 1]); }
      if (i < SX1 - 1) { r = flux(fR[k], H, o, k + 1, kf, dt); if (q > 0 && H > lev[k + 1]) b = kp[k] * q * (H - lev[k + 1]); }
      if (j > JL) { u = flux(fU[k], H, o, k - NXV, kf, dt); if (q > 0 && H > lev[k - NXV]) c = kp[k] * q * (H - lev[k - NXV]); }
      if (j < JM) { d = flux(fD[k], H, o, k + NXV, kf, dt); if (q > 0 && H > lev[k + NXV]) e = kp[k] * q * (H - lev[k + NXV]); }
      else if (!sea) { d = flux0(fD[k], o, o, kf, dt); e = kp[k] * q * q; }
      const s = l + r + u + d + a + b + c + e;
      if (s > 0) { const K = Math.min(1, hk * A / (s * dt)); l *= K; r *= K; u *= K; d *= K; a *= K; b *= K; c *= K; e *= K; }
      fL[k] = l; fR[k] = r; fU[k] = u; fD[k] = d; pL[k] = a; pR[k] = b; pU[k] = c; pD[k] = e;
    }
  }
  let out = 0;
  for (let j = JL; j <= JM; j++) {
    let wa = SX1, wb = SX0 - 1;
    for (let i = lo[j]; i <= hi[j]; i++) {
      const k = j * NXV + i;
      const inL = i > SX0 ? fR[k - 1] : 0, inR = i < SX1 - 1 ? fL[k + 1] : 0;
      const inU = j > JL ? fD[k - NXV] : 0, inD = j < JM ? fU[k + NXV] : 0;
      const sin = (i > SX0 ? pR[k - 1] : 0) + (i < SX1 - 1 ? pL[k + 1] : 0) + (j > JL ? pD[k - NXV] : 0) + (j < JM ? pU[k + NXV] : 0);
      const ho0 = h[k];
      let hn = ho0 + dt * (inL + inR + inU + inD + sin - fL[k] - fR[k] - fU[k] - fD[k] - pL[k] - pR[k] - pU[k] - pD[k]) / A;
      if (hn < 1e-7) hn = 0; else { if (i < wa) wa = i; wb = i; }
      h[k] = hn;
      const ha = Math.max(0, (ho0 + hn) * 0.5 - PHI * (ptop[k] - seal[k]));
      if (ha > 0.003) {
        let ux = (inL - fL[k] + fR[k] - inR) * 0.5 / (CELL * ha), uz = (inU - fU[k] + fD[k] - inD) * 0.5 / (CELL * ha);
        const sp = Math.hypot(ux, uz); if (sp > 5) { ux *= 5 / sp; uz *= 5 / sp; }
        vx[k] = ux; vz[k] = uz;
      } else { vx[k] = 0; vz[k] = 0; }
    }
    wlo[j] = wa; whi[j] = wb;
    if (j === MEAS_J) for (let i = lo[j]; i <= hi[j]; i++) { const k = j * NXV + i; out += fD[k] + pD[k] - fU[k + NXV] - pU[k + NXV]; }
  }
  const add = state.inflow * dt / (A * src.length);
  for (const k of src) h[k] += add;
  // 수력발전: 댐 위쪽 물이 관(터빈)을 지나 아래로 흐른다. 유량 Q = Cd·A·√(2gΔH), 출력 P = ρgQΔH·η
  for (const p of pipes) {
    let la = 0, lb = 0, ha = 0;
    for (const k of p.a) { la += lev[k]; ha += h[k]; }
    for (const k of p.b) lb += lev[k];
    la /= p.a.length; lb /= p.b.length;
    const dH = la - lb; let Q = 0;
    const want = p.qfn ? p.qfn(la, lb) : dH > 0.02 ? 0.8 * p.area * Math.sqrt(2 * G * dH) : 0; // 발전소 수차·수문은 자기 식(qfn)을 쓴다
    if (want > 0 && ha > 0.01) {
      Q = Math.min(want, ha * A * 0.5 / dt);
      const take = Q * dt / A;
      for (const k of p.a) h[k] = Math.max(0, h[k] - take * h[k] / ha);
      const put = Q * dt / (A * p.b.length);
      for (const k of p.b) h[k] += put;
    }
    p.Q += (Q - p.Q) * Math.min(1, dt * 2); p.head = Math.max(0, dH);
    if (!p.qfn) p.P = 1000 * G * p.Q * p.head * 0.85;
  }
  widen();
  state.outflow = out;
  const a = Math.min(1, dt * 0.6); state.outSm += (out - state.outSm) * a;
  state.steps++; state.time += dt;
}
export function setPermeability(v) { KP = v; }
export const getKP = () => KP;
function flux(f0, H, o, n, kf, dt) {
  const dH = H - lev[n];
  return flux0(f0, dH > 0 ? o : ho[n], dH, kf, dt);
}
function flux0(f0, hf, dH, kf, dt) {
  if (hf <= 1e-5) return 0;
  let f = f0 + kf * hf * dH;
  f /= 1 + dt * (CF * Math.abs(f0) / (hf * hf * CELL) + 0.04);
  return f > 0 ? f : 0;
}

// 침식(부어 놓은 흙만) · 거품 · 젖음 — 프레임당 한 번, 물 있는 곳만
let phase = 0;
const SEA = () => MODE === 'sea';
// 물길 바닥이 깎여 둑이 가팔라지면 젖은 흙·모래가 무너져 물길로 흘러든다 (안식각 약 40°) → 물길이 넓어진다
// 무너지는 양은 바닥이 깎인 양(e)에 비례 (바닥이 깎인 만큼 둑 밑이 파여 무너짐) — 물길이 메워지지 않고 깊어지며 넓어진다
const MAXB = 0.17;
function bankSlump(k, e, cp) {
  let ex = 0;
  for (const n of [k - 1, k + 1, k - NXV, k + NXV]) { const d = ground[n] - ground[k] - MAXB; if (d > 0 && !dam[n] && solid[n] - ground[n] <= 0.01 && cem[n] * cure[n] <= 0.4) ex += d; }
  if (ex <= 0) return;
  const budget = Math.min(ex * 0.3, e * 0.7, Math.max(0, cp - sed[k])); // 물살이 실어 갈 수 있는 만큼만
  for (const n of [k - 1, k + 1, k - NXV, k + NXV]) {
    const d = ground[n] - ground[k] - MAXB; if (d <= 0 || dam[n] || solid[n] - ground[n] > 0.01 || cem[n] * cure[n] > 0.4) continue;
    const mv = budget * d / ex, a = Math.min(loose[n], mv), b = Math.min(soil[n], mv - a), m = a + b;
    if (m <= 1e-7) continue;
    loose[n] -= a; soil[n] -= b; ground[n] -= m; solid[n] = seal[n] = ptop[n] = ground[n];
    sed[k] += m; // 무너진 모래는 바로 물에 실려 간다
    if (m > 2e-5) markDirtyCell(n % NXV, (n / NXV) | 0, false, false);
  }
}
let VC0 = 0.5, VC1 = 0.55, KR1 = 0.5, KL = 0.02, CPK = 0.008, CPM = 0.03, BEDF = 0.75, VCR = 1.3, KRR = 0.02; // 계곡: 흙은 0.55 m/s, 바위는 1.3 m/s 넘는 물살에 깎임 // 임계 유속(쌓인 흙, 원래 흙) · 원래 흙 깎임 계수
export function post(dt) {
  if (SEA()) { VC0 = 0.28; VC1 = 0.32; KR1 = 1.0; KL = 0.05; CPM = 0.05; BEDF = 0.7; VCR = 1.6; KRR = 0.004; } // 바다 모래: 조류 물살의 지형 변화 가속 (해안 모델의 MORFAC 처럼) // 모래는 잘 쓸려 간다
  let mx = 0, st = 0;
  for (let j = Math.max(1, JL + 2); j < Math.min(NZ, JM - 1); j++) {
    const i0 = Math.max(SX0 + 1, lo[j]), i1 = Math.min(SX1 - 2, hi[j]);
    for (let i = i0; i <= i1; i++) {
      const k = j * NXV + i, hk = ho[k];
      if (h[k] > 0.0008) wet[k] = 1;
      if (j < MEAS_J) { const dv = h[k] - h0[k]; if (dv > 0) st += dv; }
      if (hk <= 0.004) continue;
      const sp = Math.hypot(vx[k], vz[k]);
      vxm[k] += (vx[k] - vxm[k]) * Math.min(1, dt / 10); vzm[k] += (vz[k] - vzm[k]) * Math.min(1, dt / 10);
      const sm = Math.hypot(vxm[k], vzm[k]);
      // 물살이 깎는 재료: 덮인 흙·쌓인 흙/모래 → 원래 흙(바다는 모래) → 암반(아주 느리게). 돌이 덮은 곳·댐은 안 깎임
      const top = cap[k] > 0 || loose[k] > 0 ? 0 : soil[k] > 0.001 ? 1 : 2;
      const vc = top === 0 ? VC0 + (1.1 - VC0) * gfr[k] : top === 1 ? VC1 : VCR, kr = top === 0 ? 1 : top === 1 ? KR1 : KRR; // 자갈은 무거워 잘 안 쓸림
      const cp = (CPK * Math.max(0, sp - vc) + CPM * Math.max(0, sm - vc)) * Math.min(hk, 0.3) / 0.3; // 순간 물살 + 한 방향으로 오래 흐르는 물살(조류·강)
      const armored = dam[k] || (cap[k] <= 0 && solid[k] - ground[k] > 0.01) || cem[k] * cure[k] > 0.4; // 굳은 시멘트는 안 깎임
      if (sed[k] < cp * BEDF && !armored) {
        let e = (cp * BEDF - sed[k]) * 0.5 * kr * dt; // 바닥은 운반량의 일부까지만 — 나머지는 옆 둑을 깎는 데 쓰여 물길이 넓어진다
        if (cap[k] > 0) { e = Math.min(cap[k], e); cap[k] -= e; solid[k] -= e; }
        else {
          if (top === 0) { e = Math.min(loose[k], e); loose[k] -= e; }
          else if (top === 1) { e = Math.min(soil[k], e); soil[k] -= e; }
          else bed[k] -= e;
          ground[k] -= e; if (solid[k] > ground[k] + e - 1e-6 && solid[k] - ground[k] < e + 1e-4) { solid[k] = ground[k]; seal[k] = ptop[k] = ground[k]; }
        }
        sed[k] += e; state.eroded += e * A;
        if (e > 2e-5) markDirtyCell(i, j, false, false);
        if (e > 1e-6) bankSlump(k, e, cp);
      } else if (sed[k] > cp) {
        const dd = (sed[k] - cp) * 0.5 * dt;
        sed[k] -= dd; loose[k] += dd; ground[k] += dd; if (solid[k] < ground[k]) { solid[k] = seal[k] = ptop[k] = ground[k]; } if (dd > 2e-5) markDirtyCell(i, j, false, false);
      }
      // 옆 둑 깎기: 둑과 나란히 흐르는 빠른 물살이 옆 벽을 파고들어 물길이 넓어진다 (밀려 올라오는 파도는 거의 안 깎음)
      if (sm > vc && !armored && sed[k] < cp) {
        let room = cp - sed[k]; // 물살이 더 실어 갈 수 있는 양
        for (let q = 0; q < 4 && room > 1e-7; q++) {
          const n = q === 0 ? k - 1 : q === 1 ? k + 1 : q === 2 ? k - NXV : k + NXV, vt = Math.abs(q < 2 ? vzm[k] : vxm[k]);
          const d = ground[n] - ground[k]; if (vt <= vc || d < 0.05 || dam[n] || solid[n] - ground[n] > 0.01 || cem[n] * cure[n] > 0.4) continue;
          const kn = loose[n] > 0 ? 1 : soil[n] > 0.001 ? KR1 : KRR;
          let m = Math.min(d * 0.5, room, KL * (vt - vc) * Math.min(hk, 0.5) * dt * kn * Math.min(1, d / 0.3)); if (m <= 1e-7) continue;
          room -= m;
          const a = Math.min(loose[n], m); loose[n] -= a; const b = Math.min(soil[n], m - a); soil[n] -= b; bed[n] -= m - a - b;
          ground[n] -= m; solid[n] = seal[n] = ptop[n] = ground[n]; sed[k] += m; state.eroded += m * A;
          if (m > 2e-5) markDirtyCell(n % NXV, (n / NXV) | 0, false, false);
        }
      }
      const dHx = lev[k + 1] - lev[k - 1], dHz = lev[k + NXV] - lev[k - NXV];
      const grad = Math.hypot(dHx, dHz) / (2 * CELL);
      const tgt = Math.min(1, sstep(0.9, 2.2, sp) + sstep(0.15, 0.6, grad) * sstep(0.3, 0.8, sp) * 0.7);
      foam[k] += (tgt - foam[k]) * Math.min(1, dt * (tgt > foam[k] ? 4 : 0.8));
      if (j < MEAS_J && hk > mx) mx = hk;
      // 퇴적물 이류(반 라그랑지)
      const px = i - vx[k] * dt / CELL, pz = j - vz[k] * dt / CELL;
      const ii = Math.max(SX0, Math.min(SX1 - 2, px | 0)), jj = Math.max(0, Math.min(NZ - 1, pz | 0));
      const u = Math.min(1, Math.max(0, px - ii)), v = Math.min(1, Math.max(0, pz - jj)), b = jj * NXV + ii;
      sed2[k] = (sed[b] * (1 - u) + sed[b + 1] * u) * (1 - v) + (sed[b + NXV] * (1 - u) + sed[b + NXV + 1] * u) * v;
    }
    for (let i = i0; i <= i1; i++) { const k = j * NXV + i; if (ho[k] > 0.004) sed[k] = sed2[k]; }
  }
  // 마른 곳: 젖음·거품 서서히 줄이기 (8프레임에 나눠 전체를 훑음)
  phase = (phase + 1) & 7;
  for (let j = 1 + phase; j < NZ; j += 8) for (let i = SX0 + 1; i < SX1 - 1; i++) {
    const k = j * NXV + i; if (h[k] > 0.0008) continue;
    if (wet[k] > 0) wet[k] = Math.max(0, wet[k] - dt * 8 / 45);
    if (foam[k] > 0) foam[k] *= 0.4;
    if (sed[k] > 0) { loose[k] += sed[k]; ground[k] += sed[k]; sed[k] = 0; markDirtyCell(i, j); }
  }
  state.stored = st * A;
  state.maxDepth = mx;
}
export function saveBaseline() { h0.set(h); }
// 빠른 배속: 물 계산이 못 따라간 시간(sec)만큼, 고인 물(깊고 잔잔한 칸)이 지금 차오르는 속도를 그대로 이어서 더한다
// (차오르는 속도는 실제 계산된 시간 simDt 동안의 고인 물 부피 변화로 잰다 — 넘치기 시작하면 0 이 되어 멈춤)
let pondPrev = -1, pondRate = 0;
const pond = [];
export function fastFill(sec, simDt) {
  pond.length = 0; let vol = 0;
  for (let j = 1; j < MEAS_J; j++) for (let i = Math.max(SX0 + 1, lo[j]); i <= Math.min(SX1 - 2, hi[j]); i++) {
    const k = j * NXV + i;
    if (h[k] < 0.02 || vx[k] * vx[k] + vz[k] * vz[k] > 0.03) continue;
    vol += h[k]; // 잔잔한 물 전체(얕은 가장자리 포함)로 차오르는 속도를 재고, 수면이 고르게 오르도록 같은 칸들에 더한다
    if (solid[k] - ground[k] < 0.01) pond.push(k);
  }
  vol *= A;
  if (pondPrev >= 0 && simDt > 0) {
    const r = Math.max(0, Math.min(state.inflow, (vol - pondPrev) / simDt));
    pondRate += (r - pondRate) * Math.min(1, simDt * 0.5);
  }
  let add = 0;
  // 유입-하류 유출(전체 물 수지)과 고인 물 증가 속도 중 큰 쪽 (하류 물이 빠지는 동안엔 앞의 값이 작게 나옴)
  const rate = Math.min(state.inflow, Math.max(pondRate, state.inflow - state.outSm));
  if (sec > 0 && pond.length >= 40 && rate > 1e-4) {
    const dh = Math.min(0.04, rate * sec / (pond.length * A));
    for (const k of pond) h[k] += dh;
    add = dh * pond.length * A;
  }
  if (simDt > 0 || add > 0) pondPrev = vol + add;
  return add;
}

// ───── 데이터 텍스처 ─────
// 장소마다 계산 폭(SW)이 달라서, 장소를 정한 뒤 만든다
let dW, dV; export let texW, texV;
function allocTex() {
  if (texW && texW.image.width === SW) return;
  dW = new Float32Array(SW * NZV * 4); dV = new Float32Array(SW * NZV * 4);
  texW = new THREE.DataTexture(dW, SW, NZV, THREE.RGBAFormat, THREE.FloatType);
  texV = new THREE.DataTexture(dV, SW, NZV, THREE.RGBAFormat, THREE.FloatType);
  for (const t of [texW, texV]) { t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
  U.tWater.value = texW;
}
// 일부 모바일 GPU는 float 텍스처 선형 보간을 못 함 → half-float 로 대체 (첫 렌더 전에 호출)
let half = null;
export function useHalfFloat() {
  allocTex();
  half = [new Uint16Array(dW.length), new Uint16Array(dV.length)];
  texW.image.data = half[0]; texV.image.data = half[1];
  texW.type = texV.type = THREE.HalfFloatType;
}

export function upload() {
  for (let j = 0; j < NZV; j++) for (let c = 0; c < SW; c++) {
    const k = j * NXV + SX0 + c, o = (j * SW + c) * 4, hk = h[k];
    let R, dep = 0;
    if (hk > 0.0008) { dep = ho[k] > 0 ? ho[k] : lev[k] - seal[k]; R = lev[k] + Math.max(0, 0.003 - dep); }
    else {
      let best = -1e9;
      if (c > 0 && h[k - 1] > 0.0008) best = Math.max(best, lev[k - 1]);
      if (c < SW - 1 && h[k + 1] > 0.0008) best = Math.max(best, lev[k + 1]);
      if (j > 0 && h[k - NXV] > 0.0008) best = Math.max(best, lev[k - NXV]);
      if (j < NZ && h[k + NXV] > 0.0008) best = Math.max(best, lev[k + NXV]);
      R = dam[k] ? ground[k] - 0.1 // 콘크리트 댐 칸: 수면을 블록 속으로 숨겨 아래쪽에 얇은 막이 늘어지지 않게
        : best > -1e8 ? Math.min(best, solid[k] + 0.03) - 0.006 : Math.min(solid[k], ground[k]) - 0.06;
    }
    dW[o] = R; dW[o + 1] = dep; dW[o + 2] = wet[k]; dW[o + 3] = foam[k];
    dV[o] = vx[k]; dV[o + 1] = vz[k]; dV[o + 2] = Math.min(1, sed[k] / (hk + 0.02) * 25); dV[o + 3] = 0;
  }
  if (half) { const f = THREE.DataUtils.toHalfFloat, a = half[0], b = half[1]; for (let n = 0; n < dW.length; n++) { a[n] = f(dW[n]); b[n] = f(dV[n]); } }
  texW.needsUpdate = true; texV.needsUpdate = true;
}

// 위치에서 수면/속도 조회 (게임플레이용)
export function sample(x, z) {
  const i = Math.round((x - X0) / CELL), j = Math.round((z - Z0) / CELL);
  if (!(i >= SX0 && i < SX1 && j >= 0 && j <= NZ)) return null; // NaN 좌표도 거른다
  const k = idx(i, j);
  return { h: h[k], open: ho[k], surf: lev[k], solid: solid[k], vx: vx[k], vz: vz[k], k };
}

// ───── 잔물결 노멀맵 (타일링) ─────
function makeNormalTex() {
  const S = 256, data = new Uint8Array(S * S * 4), hgt = new Float32Array(S * S), fo = new Float32Array(S * S);
  const waves = [];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 48; n++) {
    let kx, ky; do { kx = Math.round((rnd() * 2 - 1) * 14); ky = Math.round((rnd() * 2 - 1) * 14); } while (kx === 0 && ky === 0);
    const km = Math.hypot(kx, ky); waves.push([kx, ky, 1 / Math.pow(km, 1.4), rnd() * 6.283]);
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0, f = 0;
    for (const [kx, ky, a, p] of waves) { const t = 6.283 * (kx * x + ky * y) / S + p; v += a * Math.sin(t); f += a * Math.sin(t * 1.0 + p * 3.0) * (kx % 3 === 0 ? 1 : 0.3); }
    hgt[y * S + x] = v; fo[y * S + x] = f;
  }
  let fmin = 1e9, fmax = -1e9; for (const v of fo) { fmin = Math.min(fmin, v); fmax = Math.max(fmax, v); }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const L = hgt[y * S + ((x + S - 1) % S)], R = hgt[y * S + ((x + 1) % S)], D = hgt[((y + S - 1) % S) * S + x], T = hgt[((y + 1) % S) * S + x];
    let nx = (L - R) * 0.9, ny = (D - T) * 0.9; const il = 1 / Math.hypot(nx, ny, 1);
    const o = (y * S + x) * 4;
    data[o] = (nx * il * 0.5 + 0.5) * 255; data[o + 1] = (ny * il * 0.5 + 0.5) * 255; data[o + 2] = il * 255;
    data[o + 3] = (fo[y * S + x] - fmin) / (fmax - fmin) * 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

export function makeWaterMesh(refrRT) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(SW * NZV * 3);
  for (let j = 0; j < NZV; j++) for (let c = 0; c < SW; c++) { const o = (j * SW + c) * 3; pos[o] = X0 + (SX0 + c) * CELL; pos[o + 2] = Z0 + j * CELL; }
  const ind = new Uint32Array((SW - 1) * NZ * 6); let p = 0;
  for (let j = 0; j < NZ; j++) for (let c = 0; c < SW - 1; c++) {
    const a = j * SW + c, b = a + 1, cc = a + SW, d = cc + 1;
    // 지형 메시와 같은 대각선 방향(물가 톱니 방지)
    if (diag[j * NX + SX0 + c]) { ind[p++] = a; ind[p++] = cc; ind[p++] = b; ind[p++] = b; ind[p++] = cc; ind[p++] = d; }
    else { ind[p++] = a; ind[p++] = cc; ind[p++] = d; ind[p++] = a; ind[p++] = d; ind[p++] = b; }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(ind, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 30), 45);
  const uniforms = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), U, {
    tV: { value: texV }, tN: { value: makeNormalTex() }, tRefr: { value: refrRT.texture }, tDepth: { value: refrRT.depthTexture },
    uRes: { value: new THREE.Vector2(1, 1) }, uProj: { value: new THREE.Matrix4() }, uNear: { value: 0.05 }, uFar: { value: 1200 }, uCheap: { value: 0 },
  });
  const mat = new THREE.ShaderMaterial({ uniforms, fog: true, transparent: true, vertexShader: WATER_VS, fragmentShader: WATER_FS, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

const WATER_VS = /* glsl */`
uniform sampler2D tWater; uniform vec4 uWInfo; uniform vec2 uWSize;
varying vec3 vWorld; varying vec2 vUv; varying vec3 vNg;
#include <fog_pars_vertex>
void main(){
  vec2 c = (position.xz - uWInfo.xy) * uWInfo.z; vUv = (c + .5) / uWSize;
  vec4 w = texture2D(tWater, vUv);
  vec3 p = vec3(position.x, w.r, position.z);
  vWorld = p;
  // 수면 법선은 꼭짓점에서 계산해 삼각형 위로 부드럽게 보간 (격자 모양으로 각지지 않게)
  vec2 tx = 1.0 / uWSize;
  float hL = texture2D(tWater, vUv - vec2(tx.x,0.)).r, hR = texture2D(tWater, vUv + vec2(tx.x,0.)).r;
  float hD = texture2D(tWater, vUv - vec2(0.,tx.y)).r, hU = texture2D(tWater, vUv + vec2(0.,tx.y)).r;
  vNg = vec3(clamp((hL-hR)*0.5*uWInfo.z, -3., 3.), 1.0, clamp((hD-hU)*0.5*uWInfo.z, -3., 3.));
  vec4 mvPosition = viewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FS = GLSL_NOISE + GLSL_SKY + /* glsl */`
uniform sampler2D tV, tN, tRefr, tDepth; uniform vec2 uRes; uniform float uTime, uNear, uFar, uCheap; uniform vec3 uSunCol; uniform mat4 uProj;
varying vec3 vWorld; varying vec2 vUv; varying vec3 vNg;
#include <fog_pars_fragment>
float linZ(float d){ return uNear*uFar / (uFar - d*(uFar-uNear)); }
// 화면 공간 반사: 물에 비친 계곡 벽·바위를 실제로 그린다
vec3 ssr(vec3 wpos, vec3 n, out float hit){
  hit = 0.;
  vec3 vp = (viewMatrix * vec4(wpos, 1.)).xyz;
  vec3 vn = normalize((viewMatrix * vec4(n, 0.)).xyz);
  vec3 rd = normalize(reflect(normalize(vp), vn));
#ifdef LITE
  const int STEPS = 12; const float GROW = 1.45;
#else
  const int STEPS = 22; const float GROW = 1.3;
#endif
  float t = 0.12, tp = 0.;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = vp + rd * t;
    vec4 c = uProj * vec4(p, 1.);
    if (c.w <= 0.) break;
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1.) break;
    float sz = linZ(texture2D(tDepth, uv).r), pz = -p.z;
    if (pz > sz && pz - sz < 0.4 + t * 0.2) {
      // 맞은 구간을 이분 탐색으로 다듬어 계단 모양 반사를 없앤다
      float a = tp, b = t;
      for (int k = 0; k < 5; k++) {
        float m = (a + b) * 0.5; vec3 q = vp + rd * m; vec4 cq = uProj * vec4(q, 1.);
        vec2 uq = cq.xy / cq.w * 0.5 + 0.5;
        if (-q.z > linZ(texture2D(tDepth, uq).r)) b = m; else a = m;
      }
      vec4 cb = uProj * vec4(vp + rd * b, 1.); uv = cb.xy / cb.w * 0.5 + 0.5;
      vec2 e = min(uv, 1. - uv);
      hit = smoothstep(0., 0.12, min(e.x, e.y)) * (1. - smoothstep(25., 45., t));
      vec2 bt = 1.2 / uRes;
      return (texture2D(tRefr, uv).rgb * 2. + texture2D(tRefr, uv + vec2(bt.x, 0.)).rgb + texture2D(tRefr, uv - vec2(bt.x, 0.)).rgb + texture2D(tRefr, uv + vec2(0., bt.y)).rgb + texture2D(tRefr, uv - vec2(0., bt.y)).rgb) / 6.;
    }
    tp = t; t = t * GROW + 0.04;
  }
  return vec3(0.);
}
void main(){
  vec4 w = texture2D(tWater, vUv); vec4 v = texture2D(tV, vUv);
  float depth = w.g;
  vec3 n = normalize(vNg);
  vec2 flow = v.xy; float sp = length(flow);
  float t = uTime*0.55; float p0 = fract(t), p1 = fract(t+0.5); float wb = abs(p0*2.-1.);
  vec2 bx = vWorld.xz*0.42;
  vec2 uvA = bx - flow*p0*0.55, uvB = bx - flow*p1*0.55 + vec2(0.37,0.71);
  vec4 nA = texture2D(tN, uvA), nB = texture2D(tN, uvB);
#ifdef LITE
  vec4 nC = nA, nD = nB;
#else
  vec4 nC = texture2D(tN, vWorld.xz*1.3 - flow*p0*1.6 + 0.5), nD = texture2D(tN, vWorld.xz*1.3 - flow*p1*1.6 + 0.2);
#endif
  vec2 dn = mix(nA.xy, nB.xy, wb)*2.-1.; vec2 dn2 = mix(nC.xy, nD.xy, wb)*2.-1.;
  vec4 nS = texture2D(tN, vWorld.xz*0.9 + vec2(uTime*0.03, uTime*0.021));
  dn += (nS.xy*2.-1.)*0.5 + dn2*(0.25+sp*0.6);
  float rainR = uRain * smoothstep(0.75,0.95, vnoise2(vWorld.xz*9. + floor(uTime*6.)*7.3));
  float str = (0.10 + sp*0.32) * smoothstep(0.,0.03,depth) + rainR*0.4;
  n = normalize(n + vec3(dn.x, 0., dn.y)*str);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n,V), 0.);
  float fres = 0.02 + 0.98*pow(1.-ndv, 5.);
  vec3 Rv = reflect(-V, n); Rv.y = abs(Rv.y);
  vec3 wallC = mix(vec3(0.06,0.08,0.05), vec3(0.15,0.17,0.16), uRain);
  vec3 refl = mix(wallC, skyCol(Rv), smoothstep(0.08, 0.5, Rv.y));
  if (uCheap < 0.5 && depth > 0.0005) { float hit; vec3 sc = ssr(vWorld, normalize(mix(n, vec3(0.,1.,0.), 0.55)), hit); refl = mix(refl, sc, hit); }
  float sdot = max(dot(Rv, uSunDir), 0.);
  vec3 spec = uSunCol * (pow(sdot, 900.)*28. + pow(sdot, 90.)*1.3) * (1.-uRain*0.9);
  float mud = v.z;
  vec3 absC = mix(vec3(1.9, 0.75, 0.62), vec3(1.4, 1.7, 2.6), mud);
  vec3 scat = mix(vec3(0.020, 0.085, 0.075), vec3(0.16, 0.11, 0.06), mud) * (0.45 + 0.55*max(uSunDir.y,0.)) * (1.-uRain*0.4);
  vec3 refr = vec3(0.); float thick, alpha = 1.;
  if (uCheap < 0.5) {
    vec2 suv = gl_FragCoord.xy / uRes;
    float myZ = linZ(gl_FragCoord.z);
    vec2 off = n.xz * 0.05 * clamp(depth*5., 0., 1.) / max(myZ*0.15, 1.);
    float sZ = linZ(texture2D(tDepth, suv + off).r);
    if (sZ < myZ) { off = vec2(0.); sZ = linZ(texture2D(tDepth, suv).r); }
    refr = texture2D(tRefr, suv + off).rgb;
    thick = depth / max(ndv, 0.2); // 깊이 버퍼 대신 시뮬레이션 수심 → 계단 무늬 없음
  } else thick = depth / max(ndv, 0.2);
  vec3 ab = exp(-thick * absC);
  vec3 col = uCheap < 0.5 ? refr*ab + scat*(1.-ab) : scat;
  if (uCheap > 0.5) alpha = 1. - dot(ab, vec3(0.3333));
  float thinK = smoothstep(0.004, 0.06, depth); // 얇은 물막은 반사를 줄인다
  col = mix(col, refl, fres * (0.2 + 0.8 * thinK)) + spec*smoothstep(0.,0.004,depth)*(0.3 + 0.7 * thinK);
  alpha = max(alpha, fres*0.9*thinK);
  float vis = smoothstep(0.001, 0.025, depth); // 아주 얇게 스며 나온 물은 젖은 모래처럼 거의 투명하게
  alpha *= vis; // 얕은 물가는 실제 화면이 비치도록 투명하게
  float fo = w.a;
  float fnz = mix(nA.w, nB.w, wb)*0.6 + nC.w*0.4;
  float foamA = smoothstep(0.5, 0.85, fo*0.6 + fnz*0.7 - 0.2) * smoothstep(0.,0.02,depth);
  float edge = smoothstep(0.05, 0.015, depth) * smoothstep(0.5, 0.75, fnz) * step(0.012, depth) * 0.45;
  foamA = max(foamA, edge);
  vec3 foamC = vec3(0.92,0.95,0.96) * (0.35 + 0.65*max(uSunDir.y,0.)) * uSunCol;
  col = mix(col, foamC, foamA*0.9);
  gl_FragColor = vec4(col, max(alpha, foamA*0.9));
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 웅덩이를 미리 채워(우선순위 범람) 시작 안정화 시간을 줄인다
export function prefill() {
  if (MODE === 'sea') {
    for (let j = 0; j <= NZ; j++) for (let i = SX0; i < SX1; i++) { const k = idx(i, j); h[k] = Math.max(0, SEA_Y - solid[k]); } // 사주 양쪽 바다 (가운데 땅은 해수면 위)
    computeActive(); return;
  }
  const lev = new Float32Array(NV).fill(Infinity), heap = [];
  const push = (v, k) => { heap.push([v, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  for (let i = SX0; i < SX1; i++) { const k = idx(i, NZ); lev[k] = solid[k]; push(lev[k], k); }
  while (heap.length) {
    const [v, k] = pop(); const i = k % NXV, j = (k / NXV) | 0;
    for (const [n, ok] of [[k - 1, i > SX0], [k + 1, i < SX1 - 1], [k - NXV, j > 0], [k + NXV, j < NZ]]) {
      if (!ok || lev[n] !== Infinity) continue;
      lev[n] = Math.max(solid[n], v); push(lev[n], n);
    }
  }
  for (let j = 0; j <= NZ; j++) {
    const z = Z0 + j * CELL, cx = centerX(z);
    for (let i = SX0; i < SX1; i++) {
      const k = idx(i, j); let d = lev[k] - solid[k];
      if (Math.abs(X0 + i * CELL - cx) < 0.6 && z > 4.5) d = Math.max(d, 0.17 - Math.max(0, solid[k] - (baseY(z) - 0.42)));
      h[k] = d > 1.5 || Math.abs(X0 + i * CELL - cx) > 2.6 ? 0 : d;
    }
  }
  computeActive();
}
