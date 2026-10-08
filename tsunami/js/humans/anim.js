// 절차적 인체 동작: 보행 데이터(Winter) 근사 관절각 곡선 · 달리기 전환 · 일상/놀이/재난 동작 · 교차 페이드 · 순운동학
// 각도 규약 (몸 기준, 바인드 회전 = 단위): X 음수 = 고관절·어깨 굴곡(앞으로), 무릎 X 양수 = 굴곡, 척추 X 양수 = 앞숙임,
// 왼팔/왼다리 Z 양수 = 외전, 오른쪽은 Z 음수, Y 양수 = 몸의 왼쪽으로 비틂. 오일러 순서 R = Rz·Rx·Ry
import { NB } from './body.js';

const D = Math.PI / 180, TAU = Math.PI * 2;
const PEL = 0, SPI = 1, CHE = 2, NEC = 3, HEA = 4;
const CLL = 5, UAL = 6, FAL = 7, HAL = 8, CLR = 9, UAR = 10, FAR = 11, HAR = 12;
const THL = 13, SHL = 14, FTL = 15, THR = 16, SHR = 17, FTR = 18;
export const POSE_N = NB * 3 + 6;     // 뼈별 오일러 + 골반 이동(x,y,z) + 몸 전체 회전(x,y,z)
const OFF = NB * 3, ROOT = NB * 3 + 3;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// 주기 가우스 (보행 위상 0..1)
const g = (p, c, w) => { let d = p - c; d -= Math.round(d); return Math.exp(-(d / w) * (d / w)); };
const sn = (x) => Math.sin(x * TAU);
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
// 부드러운 값 잡음 (머리 둘러보기 · 체중 이동)
function vnoise(t, seed) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return (hash(i + seed * 17.3) * (1 - u) + hash(i + 1 + seed * 17.3) * u) * 2 - 1;
}

const LOCO = new Set(['idle', 'walk', 'run', 'panic']);
const ONESHOT = { throw: 0.75, catch: 0.6, volley: 0.9, fall: 2.6 };

/** 사람별 동작 상태 (스타일은 시드로 고정) */
export function makeAnimState(info, seed, kind = 'adult') {
  const r = (k) => hash(seed * 13.7 + k * 3.1);
  const elder = kind === 'elder', kid = kind === 'child';
  return {
    info, H: info.H, pelvisY: info.joints[1],
    seed, phase: r(1), clock: r(2) * 100, actT: 0, fallT: 0,
    group: 'idle', motion: 'idle', blend: 1, speed: 0, turn: 0, lean: 0,
    pose: new Float32Array(POSE_N), prev: new Float32Array(POSE_N), tmp: new Float32Array(POSE_N),
    style: {
      arm: (elder ? 0.6 : kid ? 1.25 : 0.85) + r(3) * 0.35,
      stride: (elder ? 0.86 : 1) * (0.94 + r(4) * 0.12),
      slouch: (elder ? 9 : 0) + (r(5) - 0.3) * 6,
      sway: info.land.sex * 1.6 + r(6) * 0.6,
      elbow: 8 + r(7) * 14,
      toe: 4 + r(8) * 8,
      bounce: (kid ? 1.25 : elder ? 0.7 : 1) * (0.85 + r(9) * 0.3),
      idleArms: kid ? 0 : Math.floor(r(10) * 4.99),     // 0 늘어뜨림 1 뒷짐 2 팔짱 3 허리에 손 4 늘어뜨림
      headTilt: (r(11) - 0.5) * 6,
      volleySet: r(12) < 0.5,
    },
  };
}

/** 한 프레임 진행: inp = { motion, speed, turnRate, action, look, lookPitch } */
export function animate(st, dt, inp) {
  const m = inp.motion || 'idle';
  const grp = LOCO.has(m) ? 'loco' : m;
  if (grp !== st.group) {
    st.prev.set(st.pose);
    st.blend = 0;
    st.group = grp;
    st.actT = 0;
    st.clock0 = st.clock;
  }
  st.motion = m;
  st.clock += dt;
  st.speed += ((inp.speed || 0) - st.speed) * Math.min(1, dt * 6);
  st.turn += ((inp.turnRate || 0) - st.turn) * Math.min(1, dt * 4);
  const o = st.pose;
  o.fill(0);
  const t = st.clock, tl = st.clock - (st.clock0 || 0);
  if (ONESHOT[m] !== undefined) st.actT = inp.action !== undefined && inp.action !== null ? inp.action : Math.min(1, tl / ONESHOT[m]);
  switch (grp) {
    case 'loco': loco(o, st, dt, t, m); break;
    case 'sit': sit(o, st, t, 0.45); break;
    case 'sitGround': sitGround(o, st, t); break;
    case 'lie': lie(o, st, t, false); break;
    case 'lieBack': lie(o, st, t, true); break;
    case 'swim': swim(o, st, dt, t); break;
    case 'tread': tread(o, st, t, 0); break;
    case 'struggle': tread(o, st, t, 1); break;
    case 'crouch': crouch(o, st, t, 0); break;
    case 'cover': crouch(o, st, t, 1); break;
    case 'dig': dig(o, st, t); break;
    case 'throw': throwPose(o, st, st.actT); break;
    case 'catch': catchPose(o, st, st.actT, t); break;
    case 'volley': volley(o, st, st.actT); break;
    case 'wave': idle(o, st, t); wave(o, st, t); break;
    case 'phone': idle(o, st, t); phone(o, st, t); break;
    case 'fall': fall(o, st, st.actT); break;
    case 'shock': shock(o, st, t, tl); break;
    case 'cry': idle(o, st, t); cry(o, st, t); break;
    case 'climb': climb(o, st, t); break;
    case 'hug': idle(o, st, t); hug(o, st, t); break;
    default: loco(o, st, dt, t, 'idle');
  }
  // 시선 (목 40% · 머리 60%)
  if (inp.look) {
    const y = Math.max(-75 * D, Math.min(75 * D, inp.look));
    o[NEC * 3 + 1] += y * 0.4; o[HEA * 3 + 1] += y * 0.6;
  }
  if (inp.lookPitch) o[HEA * 3] += Math.max(-0.5, Math.min(0.5, inp.lookPitch));
  if (st.blend < 1) {
    st.blend = Math.min(1, st.blend + dt / 0.35);
    const w = st.blend * st.blend * (3 - 2 * st.blend), p = st.prev;
    for (let i = 0; i < POSE_N; i++) o[i] = p[i] + (o[i] - p[i]) * w;
  }
}

/* ───────────────────────── 보행 · 달리기 ───────────────────────── */
// 모션캡처 보행 (참고 자료: 사용자 제공 Renderpeople 걷기 애니메이션에서 추출한 관절각 곡선)
// 위상 0 = 왼발 뒤꿈치 착지, 48 표본/주기. 각도(도), bob·sway·surge(cm). 원래 속도 1.262 m/s, 주기 길이 1.442 m, 키 1.87 m
const MOCAP = {
  speed: 1.262, cycle: 1.442, height: 1.87,
  hipL: [23.3, 21.6, 19.6, 17.3, 14.8, 12.3, 9.9, 7.5, 5.2, 2.9, 0.5, -1.9, -4.4, -6.8, -9.2, -11.5, -13.2, -14.5, -15.1, -15.2, -14.4, -12.9, -10.7, -7.2, -3.4, 0.6, 4.5, 8.4, 12.1, 15.6, 18.9, 21.9, 24.4, 26.2, 27.3, 27.9, 28, 28.1, 28.4, 28.9, 29.4, 29.6, 29.6, 29.4, 28, 26.7, 25.7, 24.8],
  hipR: [-5.1, -1.1, 2.7, 6.4, 10.2, 13.7, 17, 20, 22.6, 24.5, 25.9, 26.7, 26.5, 25.5, 24.2, 23, 24.1, 24.6, 24.4, 23.3, 23, 22.8, 22.5, 21.9, 21, 19.8, 17.8, 15.5, 13.2, 10.8, 8.4, 6.1, 3.8, 1.4, -0.8, -2.9, -4.6, -6.2, -7.7, -9.2, -10.9, -12.3, -13.4, -14, -13.8, -12.7, -10.8, -7.7],
  abdL: [-4.7, -5.1, -5.1, -5, -4.9, -4.8, -4.7, -4.7, -4.6, -4.5, -4.5, -4.5, -4.5, -4.4, -4.4, -4.5, -4.3, -4.2, -3.9, -3.9, -3.8, -3.4, -2.9, -1.9, -1.4, -1.4, -2.3, -3.4, -4.2, -4.5, -4.2, -3.5, -2.7, -2, -1.8, -1.7, -1.8, -2.1, -2.3, -2.4, -2.7, -3.3, -3.9, -4.7, -5.3, -5.8, -6, -5.8],
  abdR: [0.2, 1.7, 2.5, 3.1, 3.7, 4.1, 4.7, 5.2, 5.4, 5.3, 4.6, 3.7, 3, 2.4, 1.9, 1.4, 1, 0.3, -0.6, -1.5, -2.2, -2.7, -3.1, -3.2, -3.3, -3.4, -3.6, -3.6, -3.5, -3.5, -3.5, -3.5, -3.6, -3.8, -4, -4.3, -4.5, -4.6, -4.6, -4.5, -4.3, -4.1, -3.8, -3.6, -3.3, -2.9, -2.2, -1.1],
  kneeL: [25.1, 25.9, 25.7, 25.1, 24.1, 22.8, 21.5, 20.2, 19, 17.7, 16.2, 14.6, 13, 11.5, 10.1, 8.9, 9.1, 10.3, 12.6, 16, 20.8, 26.6, 33.6, 41.9, 49.9, 57.2, 62.9, 66.6, 68.7, 69, 67.3, 64.2, 59.7, 53.5, 46, 37.7, 29.1, 22.1, 16.8, 13.5, 12.9, 13.9, 15.9, 18.6, 19.2, 19.9, 21.2, 22.9],
  kneeR: [45, 52.9, 59.2, 63.9, 67, 68.2, 67.6, 65.8, 62.5, 57.5, 51.2, 43.7, 34.6, 24.2, 14, 5, 3.8, 3.6, 3.9, 4, 6.2, 9.2, 12.3, 15.1, 17.4, 18.8, 18.8, 18.2, 17.3, 16.3, 15.2, 14.1, 12.8, 11.4, 10.2, 9.5, 9.4, 9.7, 10.2, 10.8, 11.4, 12.2, 13.5, 15.7, 19.3, 24.1, 30, 37.7],
  ankL: [-23.7, -22.3, -21, -19.7, -18.7, -17.8, -17.1, -16.4, -15.8, -15.2, -14.6, -14, -13.4, -12.8, -12.3, -11.9, -11.6, -11.3, -11.1, -11.8, -13.8, -16.9, -21.4, -27.4, -32, -34.6, -34, -31.7, -28.7, -26.1, -24.3, -22.9, -22, -22.2, -23.1, -23.9, -23.8, -22.5, -20.5, -18.2, -17, -16.5, -16.5, -17.1, -20, -22.4, -24.2, -24.4],
  ankR: [-38.5, -41.3, -39.4, -36.2, -33, -30.5, -28.5, -27, -25.9, -25.2, -24.7, -24.5, -24.6, -25.1, -25.6, -25.5, -23.8, -23.4, -24.6, -28.3, -30.9, -32.8, -33.8, -32.5, -30.7, -28.8, -27, -25.5, -24.1, -23, -22, -21.1, -20.3, -19.6, -18.7, -17.7, -16.3, -14.9, -13.5, -12.4, -11.7, -11.8, -12.6, -14.1, -16.8, -20.6, -25.4, -30.9],
  shL: [-2.8, -2.5, -1.9, -0.9, 0.3, 2, 3.7, 5.4, 7.1, 8.6, 10, 11.3, 12.3, 13.2, 13.9, 14.4, 14.7, 14.8, 14.6, 14, 13.2, 12.4, 11.5, 10.3, 9.1, 8.1, 7.3, 6.4, 5.5, 4.6, 3.7, 2.8, 1.9, 1, 0.1, -0.7, -1.5, -2.4, -3.2, -3.9, -4.6, -5, -5.1, -5, -4.8, -4.4, -4, -3.5],
  shR: [6.1, 5, 4.2, 3.4, 2.4, 1.1, -0.3, -1.8, -3.3, -4.7, -6, -7.2, -8.4, -9.4, -10.3, -11.1, -11.7, -12.1, -12.3, -12.1, -11.6, -10.8, -9.8, -8.9, -7.8, -6.7, -5.5, -4, -2.4, -0.6, 1.4, 3.4, 5.4, 7.3, 9, 10.6, 12, 13.2, 14.3, 15.2, 15.6, 15.4, 14.9, 14, 12.9, 11.7, 10.2, 8.6],
  shAbdL: [2.8, 2.5, 2.6, 2.8, 2.8, 2.9, 2.9, 3, 3.2, 3.7, 4.3, 5, 5.7, 6.5, 7.2, 8, 8.6, 9.2, 9.8, 10.1, 10.2, 10.2, 9.8, 9, 8.2, 7.6, 7.2, 7, 7, 6.8, 6.6, 6.5, 6.5, 6.5, 6.6, 6.7, 6.7, 6.6, 6.5, 6.4, 6.1, 5.8, 5.3, 4.8, 4.4, 3.9, 3.4, 2.8],
  shAbdR: [8.9, 8.3, 8.1, 8, 7.8, 7.6, 7.3, 7, 6.7, 6.6, 6.4, 6.4, 6.2, 6, 5.7, 5.4, 5.1, 4.7, 4.2, 3.7, 3.3, 2.9, 2.6, 2.2, 2, 1.9, 2, 2.3, 2.6, 2.9, 3.2, 3.5, 3.8, 4.1, 4.4, 4.7, 5, 5.3, 5.7, 6.2, 6.9, 7.4, 8, 8.5, 8.7, 8.7, 8.6, 8.4],
  elL: [13.4, 13.4, 13.3, 13.3, 13.3, 13.2, 13.3, 13.7, 14.4, 15.4, 16.7, 18.2, 19.7, 21.4, 23, 24.6, 25.9, 27.1, 28, 28.7, 28.7, 28.1, 26.8, 25.2, 23.7, 22.2, 20.9, 19.7, 18.6, 17.6, 16.6, 15.8, 15.1, 14.6, 14.2, 13.9, 13.7, 13.6, 13.6, 13.6, 13.5, 13.4, 13.4, 13.5, 13.5, 13.5, 13.5, 13.6],
  elR: [20.5, 20, 19.2, 18.6, 18.2, 18, 18.1, 18.2, 18.5, 18.8, 18.8, 18.7, 18.6, 18.3, 17.9, 17.5, 17.1, 16.7, 16.5, 16.7, 16.7, 16.7, 16.6, 16.6, 16.7, 16.6, 16.6, 16.5, 16.5, 16.9, 17.5, 18.1, 18.8, 19.6, 20.5, 21.4, 22.3, 23, 23.6, 24, 24.4, 24.9, 25.3, 25.6, 25.1, 24.3, 23.3, 21.9],
  pelYaw: [-5.8, -6, -6, -5.9, -5.5, -5, -4.2, -3.3, -2.3, -1.3, -0.4, 0.4, 1.1, 1.8, 2.5, 3.3, 3.7, 3.9, 4, 4.6, 4.9, 5, 4.8, 4.4, 4.1, 3.9, 3.8, 3.5, 3, 2.3, 1.5, 0.7, -0.1, -0.9, -1.5, -2.1, -2.8, -3.5, -4, -4.4, -4.5, -4.7, -5, -5.5, -5.7, -5.8, -5.8, -5.8],
  pelRoll: [-0.9, -0.6, -0.2, 0, 0.1, 0.1, 0.2, 0.2, 0.2, 0.3, 0.5, 0.7, 1.1, 1.6, 2.2, 3.1, 3.7, 4.2, 4.3, 4, 3.4, 2.7, 1.9, 1.3, 0.7, 0.1, -0.4, -0.7, -0.8, -0.8, -0.7, -0.7, -0.6, -0.7, -1, -1.3, -1.7, -2.2, -2.8, -3.3, -3.6, -3.8, -3.8, -3.7, -2.8, -2.1, -1.4, -1.1],
  bob: [-0.7, -0.4, 0, 0.4, 0.8, 1.2, 1.5, 1.7, 1.8, 1.7, 1.6, 1.5, 1.2, 0.8, 0.4, -0.1, -0.6, -1, -1.5, -1.8, -1.9, -1.8, -1.6, -1.3, -1, -0.6, -0.2, 0.2, 0.6, 1, 1.3, 1.5, 1.6, 1.6, 1.5, 1.3, 1.1, 0.6, 0.1, -0.4, -0.9, -1.3, -1.7, -1.9, -1.9, -1.8, -1.5, -1.1],
  sway: [-0.2, 0.1, 0.4, 0.6, 0.9, 1.1, 1.3, 1.4, 1.6, 1.7, 1.8, 1.9, 2, 2.1, 2.2, 2.3, 2.3, 2.2, 2.1, 1.9, 1.6, 1.3, 0.9, 0.6, 0.3, 0, -0.3, -0.5, -0.7, -0.9, -1.1, -1.2, -1.3, -1.5, -1.6, -1.8, -1.9, -2.1, -2.2, -2.3, -2.3, -2.3, -2.2, -2.1, -1.9, -1.6, -1.3, -1.1],
  surge: [0.9, 1.1, 1.1, 1.1, 1.1, 1.1, 1, 0.9, 0.6, 0.4, 0.1, -0.3, -0.6, -0.9, -1.1, -1.3, -1.3, -1.3, -1.1, -0.7, -0.3, 0.1, 0.5, 0.8, 1.1, 1.2, 1.1, 1.1, 1, 1, 0.8, 0.6, 0.3, 0, -0.3, -0.6, -1, -1.2, -1.4, -1.5, -1.5, -1.4, -1.2, -1, -0.4, 0.1, 0.5, 0.8],
  chestYaw: [9.9, 9.5, 8.7, 7.8, 6.8, 5.8, 4.7, 3.7, 2.6, 1.6, 0.8, 0, -0.6, -1.1, -1.6, -2.1, -2.3, -2.3, -2.3, -2.8, -3.1, -3.3, -3, -2.5, -1.9, -1.3, -0.6, 0.2, 1.2, 2.3, 3.4, 4.5, 5.6, 6.6, 7.3, 8, 8.7, 9.3, 9.8, 10.1, 10.1, 10.3, 10.7, 11.3, 11.7, 11.9, 12, 11.7],
  lean: [1.7, 1.6, 1.6, 1.6, 1.5, 1.3, 1.3, 1.2, 1.3, 1.5, 1.8, 2.2, 2.7, 3.2, 3.7, 4.1, 4.4, 4.5, 4.4, 4.2, 3.9, 3.6, 3.3, 3, 2.7, 2.5, 2.4, 2.2, 2.1, 1.9, 1.8, 1.8, 1.8, 1.9, 2.1, 2.4, 2.8, 3.1, 3.4, 3.5, 3.6, 3.6, 3.5, 3.4, 3.2, 3, 2.8, 2.7],
  headPitch: [0.9, 0.9, 0.9, 1.1, 1.3, 1.6, 2, 2.2, 2.5, 2.5, 2.5, 2.3, 2, 1.5, 1, 0.5, 0.2, 0, -0.1, 0, 0.1, 0.2, 0.3, 0.6, 0.9, 1.1, 1.4, 1.7, 2, 2.4, 2.7, 3, 3.2, 3.3, 3.4, 3.3, 3, 2.7, 2.5, 2.2, 2.1, 2, 1.8, 1.6, 1.5, 1.3, 1.2, 1.1],
};
const MMEAN = {};
for (const k in MOCAP) if (Array.isArray(MOCAP[k])) MMEAN[k] = MOCAP[k].reduce((a, b) => a + b, 0) / MOCAP[k].length;

function mc(k, p) {
  const a = MOCAP[k], n = a.length, x = p * n, i = Math.floor(x), f = x - i;
  return a[i % n] * (1 - f) + a[(i + 1) % n] * f;
}

function loco(o, st, dt, t, m) {
  const v = st.speed, H = st.H;
  const wMove = smooth(0.06, 0.55, v);
  if (wMove < 1) idle(o, st, t);
  if (wMove <= 0) return;
  const run = smooth(1.9, 2.7, v), vv = Math.max(v, 0.3);
  // 주기 길이: 걷기는 모션캡처(키 대비 0.775, 속도^0.42 비례), 달리기 1.4 m/s→… 4 m/s ≈ 1.43H. 실제 지면 속도로 위상 진행(발 미끄럼 없음)
  const cyc = H * st.style.stride * ((1 - run) * (MOCAP.cycle / MOCAP.height) * Math.pow(vv / MOCAP.speed, 0.42) + run * Math.min(2.25, 0.47 + 0.24 * vv));
  st.phase = (st.phase + dt * vv / cyc) % 1;
  const ph = st.phase, T = st.tmp;
  T.fill(0);
  if (run < 1) walkMocap(T, ph, v, st);
  if (run > 0) {
    const R = st.tmp2 || (st.tmp2 = new Float32Array(T.length));
    R.fill(0);
    runProc(R, ph, st);
    for (let i = 0; i < T.length; i++) T[i] += (R[i] - T[i]) * run;
  }
  const S = st.style;
  T[ROOT + 2] = Math.max(-0.2, Math.min(0.2, -st.turn * v * 0.05));
  if (m === 'panic') {
    // 공포 질주: 팔을 크게 휘젓고 뒤를 돌아봄
    T[UAL * 3] += -25 * D + 35 * D * Math.sin(t * 7.3 + 1); T[UAR * 3] += -25 * D + 35 * D * Math.sin(t * 6.1);
    T[UAL * 3 + 2] += 25 * D * (0.5 + 0.5 * Math.sin(t * 5)); T[UAR * 3 + 2] -= 25 * D * (0.5 + 0.5 * Math.sin(t * 4.3 + 2));
    const back = smooth(0.6, 0.95, vnoise(t * 0.35, st.seed + 3)) * 70 * D * (st.seed % 2 ? 1 : -1);
    T[NEC * 3 + 1] += back * 0.45; T[HEA * 3 + 1] += back * 0.55; T[CHE * 3 + 1] += back * 0.25;
  }
  if (S.slouch) { T[SPI * 3] += S.slouch * 0.4 * D; T[CHE * 3] += S.slouch * 0.6 * D; T[NEC * 3] -= S.slouch * 0.5 * D; }
  if (wMove >= 1) o.set(T);
  else for (let i = 0; i < POSE_N; i++) o[i] += (T[i] - o[i]) * wMove;
}

/** 모션캡처 걷기: 속도에 따라 진폭 조절, 사람별 스타일 반영 */
function walkMocap(T, p, v, st) {
  const S = st.style, H = st.H, k = H / MOCAP.height;
  const amp = Math.max(0.6, Math.min(1.3, 0.55 + 0.45 * v / MOCAP.speed));
  const dev = (key) => mc(key, p) - MMEAN[key];
  // 다리: 고관절 굴곡 · 외전, 무릎, 발목 (뒤꿈치 착지 = 0°)
  T[THL * 3] = -(MMEAN.hipL + dev('hipL') * amp) * D * S.stride; T[THR * 3] = -(MMEAN.hipR + dev('hipR') * amp) * D * S.stride;
  T[THL * 3 + 2] = (dev('abdL') + 1.5) * D; T[THR * 3 + 2] = -(dev('abdR') + 1.5) * D;
  T[THL * 3 + 1] = -S.toe * D * 0.5; T[THR * 3 + 1] = S.toe * D * 0.5; T[FTL * 3 + 1] = -S.toe * D * 0.5; T[FTR * 3 + 1] = S.toe * D * 0.5;
  T[SHL * 3] = mc('kneeL', p) * (0.55 + 0.45 * amp) * D; T[SHR * 3] = mc('kneeR', p) * (0.55 + 0.45 * amp) * D;
  T[FTL * 3] = -(mc('ankL', p) - MOCAP.ankL[0]) * D * (0.6 + 0.4 * amp); T[FTR * 3] = -(mc('ankR', p) - MOCAP.ankR[24]) * D * (0.6 + 0.4 * amp);
  // 팔: 어깨 굴곡·외전(바인드 17° 보정), 팔꿈치
  T[UAL * 3] = -mc('shL', p) * D * S.arm * amp; T[UAR * 3] = -mc('shR', p) * D * S.arm * amp;
  T[UAL * 3 + 2] = (mc('shAbdL', p) - 17) * D; T[UAR * 3 + 2] = -(mc('shAbdR', p) - 17) * D;
  T[UAL * 3 + 1] = 8 * D; T[UAR * 3 + 1] = -8 * D;
  const eb = 0.6 + S.elbow / 30;
  T[FAL * 3] = -mc('elL', p) * eb * D; T[FAR * 3] = -mc('elR', p) * eb * D;
  // 골반: 회전 · 기울기 · 상하 · 좌우 · 전후 (cm → m, 키 비례)
  T[PEL * 3 + 1] = dev('pelYaw') * D * amp; T[PEL * 3 + 2] = dev('pelRoll') * D * (0.7 + 0.3 * S.sway);
  T[OFF + 1] = mc('bob', p) * 0.01 * k * amp * S.bounce; T[OFF] = mc('sway', p) * 0.01 * k * (0.7 + 0.3 * S.sway); T[OFF + 2] = mc('surge', p) * 0.01 * k;
  // 몸통: 앞숙임, 골반과 반대 회전; 머리는 시선 안정
  const lean = mc('lean', p) * D + Math.min(0.08, v * 0.012);
  T[SPI * 3] = lean * 0.45; T[CHE * 3] = lean * 0.55;
  T[CHE * 3 + 1] = dev('chestYaw') * D * amp; T[SPI * 3 + 1] = -T[PEL * 3 + 1] * 0.4;
  T[NEC * 3] = -lean * 0.6 + dev('headPitch') * D + S.headTilt * D * 0.3;
  T[NEC * 3 + 1] = -(T[CHE * 3 + 1] + T[PEL * 3 + 1] + T[SPI * 3 + 1]) * 0.7;
}

/** 절차적 달리기 (체공기 포함) */
function runProc(T, ph, st) {
  const H = st.H, S = st.style;
  gaitSide(T, ph, 1, st, 1);
  gaitSide(T, (ph + 0.5) % 1, 1, st, -1);
  T[OFF + 1] = -0.04 * (H / 1.75) * S.bounce * Math.cos(2 * TAU * (ph - 0.2)) - 0.05 * (H / 1.75);
  T[PEL * 3 + 1] = -11 * D * Math.cos(TAU * ph);
  T[PEL * 3 + 2] = -(1.5 + S.sway) * D * sn(ph);
  const lean = 11 * D;
  T[SPI * 3] = lean * 0.45; T[CHE * 3] = lean * 0.55;
  T[SPI * 3 + 1] = 8 * D * Math.cos(TAU * ph); T[CHE * 3 + 1] = 11 * D * Math.cos(TAU * ph);
  T[NEC * 3] = -lean * 0.5; T[HEA * 3] = -lean * 0.35;
  T[NEC * 3 + 1] = -T[CHE * 3 + 1] * 0.6 - T[SPI * 3 + 1] * 0.5 - T[PEL * 3 + 1] * 0.6;
}

/** 한쪽 다리·반대쪽 팔 (side 1 = 왼다리/오른팔 위상) — 달리기용 */
function gaitSide(o, p, run, st, side) {
  const S = st.style;
  const hip = 15 + 32 * Math.cos(TAU * (p - 0.88));
  const knee = 18 + 26 * g(p, 0.18, 0.08) + 98 * g(p, 0.64, 0.14);
  const ank = 10 * g(p, 0.16, 0.06) - 24 * g(p, 0.38, 0.06) + 6 * g(p, 0.78, 0.1);
  const th = side > 0 ? THL : THR, sh = side > 0 ? SHL : SHR, ft = side > 0 ? FTL : FTR;
  o[th * 3] = -hip * D * S.stride;
  o[sh * 3] = knee * D;
  o[ft * 3] = -ank * D;
  o[th * 3 + 1] = side * -S.toe * D * 0.5; o[ft * 3 + 1] = side * -S.toe * D * 0.5;
  o[th * 3 + 2] = side * 3 * D;
  const ua = side > 0 ? UAR : UAL, fa = side > 0 ? FAR : FAL, cl = side > 0 ? CLR : CLL;
  const swing = 34 * S.arm * Math.cos(TAU * (p - 0.02));
  o[ua * 3] = -swing * D - 8 * D;
  o[ua * 3 + 2] = (side > 0 ? 1 : -1) * 10 * D;
  o[fa * 3] = -(70 + Math.max(0, swing) * 0.4 + S.elbow * 0.5) * D;
  o[cl * 3 + 2] = (side > 0 ? 1 : -1) * 3 * D * Math.cos(TAU * p);
}

/* ───────────────────────── 서 있기 ───────────────────────── */
function idle(o, st, t) {
  const S = st.style, sd = st.seed;
  // 체중 이동 (콘트라포스토): 수 초 주기
  const ws = vnoise(t * 0.12, sd), side = ws > 0 ? 1 : -1, a = Math.min(1, Math.abs(ws) * 1.6);
  o[OFF] = ws * 0.035 * (st.H / 1.75);
  o[OFF + 1] = -0.008 * a;
  o[PEL * 3 + 2] = -side * 3 * D * a;
  const bent = side > 0 ? SHR : SHL, bentT = side > 0 ? THR : THL;
  o[bent * 3] = 9 * D * a; o[bentT * 3] = -4 * D * a;
  o[THL * 3 + 2] = (2 - (side > 0 ? 2 : 0) * a) * D; o[THR * 3 + 2] = -(2 - (side < 0 ? 2 : 0) * a) * D;
  o[THL * 3 + 1] = -S.toe * D; o[THR * 3 + 1] = S.toe * D;
  // 호흡 · 자세
  const br = Math.sin(t * TAU * 0.24 + sd);
  o[SPI * 3] = (S.slouch * 0.4) * D; o[CHE * 3] = (S.slouch * 0.6 - br * 0.8) * D;
  o[CLL * 3 + 2] = br * 0.6 * D; o[CLR * 3 + 2] = -br * 0.6 * D;
  o[SPI * 3 + 2] = side * 2 * D * a;
  // 둘러보기
  const look = vnoise(t * 0.22, sd + 7) * 35 * D;
  o[NEC * 3 + 1] = look * 0.4; o[HEA * 3 + 1] = look * 0.6;
  o[NEC * 3] = (-S.slouch * 0.3 + S.headTilt * 0.5) * D + vnoise(t * 0.15, sd + 9) * 5 * D;
  o[HEA * 3 + 2] = vnoise(t * 0.1, sd + 11) * 4 * D;
  armsIdle(o, S.idleArms, br);
}

function armsIdle(o, kind, br) {
  if (kind === 1) {          // 뒷짐
    o[UAL * 3] = 18 * D; o[UAR * 3] = 18 * D; o[UAL * 3 + 2] = -6 * D; o[UAR * 3 + 2] = 6 * D;
    o[UAL * 3 + 1] = 30 * D; o[UAR * 3 + 1] = -30 * D; o[FAL * 3] = -55 * D; o[FAR * 3] = -55 * D;
  } else if (kind === 2) {   // 팔짱
    o[UAL * 3] = -22 * D; o[UAR * 3] = -24 * D; o[UAL * 3 + 2] = -10 * D; o[UAR * 3 + 2] = 10 * D;
    o[UAL * 3 + 1] = -40 * D; o[UAR * 3 + 1] = 40 * D; o[FAL * 3] = -105 * D; o[FAR * 3] = -100 * D;
    o[FAL * 3 + 1] = -60 * D; o[FAR * 3 + 1] = 60 * D;
  } else if (kind === 3) {   // 허리에 손
    o[UAL * 3 + 2] = 28 * D; o[UAR * 3 + 2] = -28 * D; o[UAL * 3] = 8 * D; o[UAR * 3] = 8 * D;
    o[UAL * 3 + 1] = -35 * D; o[UAR * 3 + 1] = 35 * D; o[FAL * 3] = -95 * D; o[FAR * 3] = -95 * D;
  } else {
    o[UAL * 3 + 2] = -7 * D + br * 0.5 * D; o[UAR * 3 + 2] = 7 * D - br * 0.5 * D;
    o[UAL * 3] = -3 * D; o[UAR * 3] = -3 * D; o[FAL * 3] = -12 * D; o[FAR * 3] = -12 * D;
    o[UAL * 3 + 1] = 8 * D; o[UAR * 3 + 1] = -8 * D;
  }
}

/* ───────────────────────── 앉기 · 눕기 ───────────────────────── */
function sit(o, st, t, seat) {
  o[OFF + 1] = seat - st.pelvisY + 0.06;
  o[OFF + 2] = -0.06;
  o[THL * 3] = o[THR * 3] = -88 * D; o[SHL * 3] = o[SHR * 3] = 85 * D;
  o[THL * 3 + 2] = 6 * D; o[THR * 3 + 2] = -6 * D;
  o[SPI * 3] = 4 * D; o[CHE * 3] = (st.style.slouch + 3) * D;
  o[UAL * 3] = o[UAR * 3] = -28 * D; o[FAL * 3] = o[FAR * 3] = -55 * D;
  const look = vnoise(t * 0.2, st.seed + 2) * 30 * D;
  o[NEC * 3 + 1] = look * 0.4; o[HEA * 3 + 1] = look * 0.6;
}

function sitGround(o, st, t) {
  // 모래 위에 앉아 무릎 세우고 팔로 뒤를 짚음
  const H = st.H, s = st.seed % 3;
  o[OFF + 1] = 0.1 * (H / 1.75) - st.pelvisY;
  o[OFF + 2] = -0.05;
  o[PEL * 3] = -14 * D;
  o[THL * 3] = -(s === 2 ? 70 : 62) * D; o[THR * 3] = -(s === 1 ? 20 : 66) * D;
  o[SHL * 3] = (s === 2 ? 115 : 105) * D; o[SHR * 3] = (s === 1 ? 15 : 110) * D;
  o[THL * 3 + 2] = 10 * D; o[THR * 3 + 2] = -10 * D;
  o[FTL * 3] = 25 * D; o[FTR * 3] = 25 * D;
  o[SPI * 3] = -6 * D; o[CHE * 3] = -4 * D;
  o[UAL * 3] = 38 * D; o[UAR * 3] = 38 * D; o[UAL * 3 + 2] = 14 * D; o[UAR * 3 + 2] = -14 * D;
  o[FAL * 3] = -6 * D; o[FAR * 3] = -6 * D;
  const br = Math.sin(t * TAU * 0.22 + st.seed);
  o[CHE * 3] += br * 0.8 * D;
  const look = vnoise(t * 0.18, st.seed + 5) * 40 * D;
  o[NEC * 3] = 10 * D; o[NEC * 3 + 1] = look * 0.4; o[HEA * 3 + 1] = look * 0.6;
}

function lie(o, st, t, back) {
  const H = st.H;
  if (back) {
    // 반듯이 누움 (선베드는 등받이 각도)
    o[ROOT] = -86 * D;
    o[OFF + 1] = 0.11 * (H / 1.75) - st.pelvisY;
    o[UAL * 3] = -150 * D; o[UAR * 3] = -150 * D; o[FAL * 3] = -120 * D; o[FAR * 3] = -120 * D;
    o[UAL * 3 + 2] = 30 * D; o[UAR * 3 + 2] = -30 * D;
    if (st.seed % 2) { o[THL * 3] = -35 * D; o[SHL * 3] = 70 * D; }
    o[FTL * 3] = 30 * D; o[FTR * 3] = 30 * D;
    o[NEC * 3] = 12 * D; o[HEA * 3 + 1] = vnoise(t * 0.08, st.seed) * 25 * D;
  } else {
    // 엎드려 일광욕: 고개는 옆으로, 팔은 머리 옆
    o[ROOT] = 90 * D;
    o[OFF + 1] = 0.1 * (H / 1.75) - st.pelvisY;
    o[UAL * 3] = -160 * D; o[UAR * 3] = -160 * D; o[UAL * 3 + 2] = 25 * D; o[UAR * 3 + 2] = -25 * D;
    o[FAL * 3] = -110 * D; o[FAR * 3] = -110 * D;
    o[FTL * 3] = 55 * D; o[FTR * 3] = 55 * D;
    o[NEC * 3] = -18 * D; o[HEA * 3 + 1] = (st.seed % 2 ? 1 : -1) * 70 * D;
    if (st.seed % 3 === 0) { o[SHL * 3] = (50 + 25 * Math.sin(t * 1.3)) * D; }
  }
  o[CHE * 3] += Math.sin(t * TAU * 0.2 + st.seed) * 0.8 * D;
}

/* ───────────────────────── 물 ───────────────────────── */
function swim(o, st, dt, t) {
  // 자유형: 팔 연속 회전(당기기→회복), 6비트 발차기, 격 스트로크 호흡
  st.phase = (st.phase + dt * 0.55) % 1;
  const p = st.phase, H = st.H;
  o[ROOT] = 84 * D;
  o[OFF + 1] = 0.82 * H - 0.12 - st.pelvisY;
  for (const [ua, fa, ph, sgn] of [[UAL, FAL, p, 1], [UAR, FAR, (p + 0.5) % 1, -1]]) {
    o[ua * 3] = TAU * ph - Math.PI;
    o[fa * 3] = -(ph > 0.5 ? 70 * Math.sin((ph - 0.5) * TAU) : 15) * D;
    o[ua * 3 + 2] = sgn * 12 * D;
  }
  o[PEL * 3 + 1] = 25 * D * Math.sin(TAU * p);
  o[CHE * 3 + 1] = 15 * D * Math.sin(TAU * p);
  const kick = Math.sin(TAU * p * 3);
  o[THL * 3] = 12 * D * kick; o[THR * 3] = -12 * D * kick;
  o[SHL * 3] = (15 + 10 * kick) * D; o[SHR * 3] = (15 - 10 * kick) * D;
  o[FTL * 3] = 45 * D; o[FTR * 3] = 45 * D;
  const breathe = Math.floor(st.clock * 0.55) % 2 === 0 ? g(p, 0.75, 0.12) : 0;
  o[NEC * 3] = -25 * D; o[HEA * 3 + 1] = breathe * 70 * D;
}

function tread(o, st, t, panic) {
  const H = st.H, f = panic ? 2.4 : 1.1, a = panic ? 1 : 0.5;
  o[OFF + 1] = -0.03 * H;
  o[SPI * 3] = (panic ? -10 : 8) * D; o[NEC * 3] = (panic ? -25 : 0) * D;
  // 다리: 번갈아 원을 그리는 차기
  o[THL * 3] = -(45 + 20 * Math.sin(t * f * TAU)) * D; o[THR * 3] = -(45 + 20 * Math.sin(t * f * TAU + Math.PI)) * D;
  o[SHL * 3] = (80 + 25 * Math.cos(t * f * TAU)) * D; o[SHR * 3] = (80 + 25 * Math.cos(t * f * TAU + Math.PI)) * D;
  o[THL * 3 + 2] = 20 * D; o[THR * 3 + 2] = -20 * D;
  if (panic) {
    // 허우적: 팔을 수면 위로 휘저음
    o[UAL * 3] = -(100 + 60 * vnoise(t * 3.1, st.seed)) * D; o[UAR * 3] = -(100 + 60 * vnoise(t * 2.7, st.seed + 1)) * D;
    o[UAL * 3 + 2] = (40 + 30 * Math.sin(t * 9)) * D; o[UAR * 3 + 2] = -(40 + 30 * Math.sin(t * 8 + 1)) * D;
    o[FAL * 3] = -(30 + 40 * (0.5 + 0.5 * Math.sin(t * 7))) * D; o[FAR * 3] = -(30 + 40 * (0.5 + 0.5 * Math.sin(t * 6.3))) * D;
    o[HEA * 3 + 1] = vnoise(t * 1.5, st.seed + 4) * 40 * D;
    o[ROOT] = vnoise(t * 0.8, st.seed + 8) * 25 * D; o[ROOT + 2] = vnoise(t * 0.7, st.seed + 9) * 20 * D;
  } else {
    // 젓기: 팔을 옆으로 펴고 앞뒤로 쓸기
    o[UAL * 3 + 2] = 65 * D; o[UAR * 3 + 2] = -65 * D;
    o[UAL * 3 + 1] = 35 * D * Math.sin(t * 1.6 * TAU) * a; o[UAR * 3 + 1] = -35 * D * Math.sin(t * 1.6 * TAU) * a;
    o[FAL * 3] = -30 * D; o[FAR * 3] = -30 * D;
  }
}

/* ───────────────────────── 웅크림 · 놀이 ───────────────────────── */
function crouch(o, st, t, cover) {
  const H = st.H;
  o[OFF + 1] = -0.42 * st.pelvisY; o[OFF + 2] = -0.08 * (H / 1.75);
  o[THL * 3] = o[THR * 3] = -100 * D; o[SHL * 3] = o[SHR * 3] = 130 * D; o[FTL * 3] = o[FTR * 3] = -32 * D;
  o[THL * 3 + 2] = 12 * D; o[THR * 3 + 2] = -12 * D;
  o[SPI * 3] = 25 * D; o[CHE * 3] = 20 * D;
  if (cover) {
    // 지진: 머리를 감싸고 웅크림 (떨림)
    const sh = Math.sin(t * 23) * 1.5 * D;
    o[UAL * 3] = -150 * D + sh; o[UAR * 3] = -150 * D - sh; o[UAL * 3 + 2] = 25 * D; o[UAR * 3 + 2] = -25 * D;
    o[FAL * 3] = -135 * D; o[FAR * 3] = -135 * D; o[NEC * 3] = 30 * D; o[HEA * 3] = 15 * D;
  } else {
    o[UAL * 3] = -40 * D; o[UAR * 3] = -40 * D; o[FAL * 3] = -40 * D; o[FAR * 3] = -40 * D;
    o[NEC * 3] = -20 * D;
  }
}

function dig(o, st, t) {
  // 모래성 쌓기: 무릎 꿇고 몸을 숙여 번갈아 모래를 긁어 모음
  const H = st.H;
  o[OFF + 1] = 0.5 * (H / 1.75) - st.pelvisY;
  o[THL * 3] = o[THR * 3] = -8 * D; o[SHL * 3] = o[SHR * 3] = 125 * D; o[FTL * 3] = o[FTR * 3] = 40 * D;
  o[THL * 3 + 2] = 8 * D; o[THR * 3 + 2] = -8 * D;
  o[PEL * 3] = 20 * D; o[SPI * 3] = 18 * D; o[CHE * 3] = 15 * D; o[NEC * 3] = 10 * D;
  const s = Math.sin(t * 2.6 + st.seed), c = Math.sin(t * 2.6 + st.seed + Math.PI);
  o[UAL * 3] = -(70 + 20 * s) * D; o[UAR * 3] = -(70 + 20 * c) * D;
  o[FAL * 3] = -(25 + 25 * (0.5 + 0.5 * c)) * D; o[FAR * 3] = -(25 + 25 * (0.5 + 0.5 * s)) * D;
  o[UAL * 3 + 2] = (8 + 10 * s) * D; o[UAR * 3 + 2] = -(8 + 10 * c) * D;
  o[HEA * 3 + 1] = vnoise(t * 0.3, st.seed) * 20 * D;
}

function throwPose(o, st, a) {
  // 오른손 던지기: 준비(뒤로) → 0.55 놓기 → 따라가기, 왼발 내딛기
  const wind = smooth(0, 0.4, a) * (1 - smooth(0.4, 0.62, a)), rel = smooth(0.42, 0.62, a), fol = smooth(0.6, 1, a);
  idle(o, st, st.clock);
  o[UAR * 3] = (60 * wind - 120 * rel + 50 * fol) * D;
  o[UAR * 3 + 2] = -(70 * wind + 20 * rel) * (1 - fol) * D;
  o[FAR * 3] = -(90 * wind + 20 * (1 - rel)) * D;
  o[UAL * 3] = -(50 * wind) * D; o[UAL * 3 + 2] = 20 * wind * D;
  o[CHE * 3 + 1] = (25 * wind - 30 * rel + 10 * fol) * D;
  o[SPI * 3] = (5 + 15 * rel * (1 - fol * 0.5)) * D;
  o[THL * 3] = -25 * rel * D; o[SHL * 3] = 15 * rel * D; o[SHR * 3] = 20 * wind * D;
  o[OFF + 2] = 0.08 * rel;
}

function catchPose(o, st, a, t) {
  idle(o, st, t);
  const r = 1 - smooth(0.6, 1, a);
  o[UAL * 3] = -75 * D * r; o[UAR * 3] = -75 * D * r; o[UAL * 3 + 2] = -5 * D; o[UAR * 3 + 2] = 5 * D;
  o[FAL * 3] = -(35 + 40 * smooth(0.2, 0.5, a)) * D * r; o[FAR * 3] = -(35 + 40 * smooth(0.2, 0.5, a)) * D * r;
  o[SHL * 3] += 15 * D * r; o[SHR * 3] += 15 * D * r; o[THL * 3] += -8 * D * r; o[THR * 3] += -8 * D * r;
  o[OFF + 1] -= 0.04 * r;
  o[NEC * 3] = -10 * D * r;
}

function volley(o, st, a) {
  const H = st.H;
  if (st.style.volleySet) {
    // 토스: 무릎 굽혔다 펴며 머리 위에서 손끝으로 올림
    const dip = Math.sin(Math.min(1, a) * Math.PI);
    o[OFF + 1] = -0.12 * dip;
    o[THL * 3] = o[THR * 3] = -35 * dip * D; o[SHL * 3] = o[SHR * 3] = 60 * dip * D; o[FTL * 3] = o[FTR * 3] = -15 * dip * D;
    o[UAL * 3] = o[UAR * 3] = -(150 + 15 * smooth(0.4, 0.7, a)) * D; o[UAL * 3 + 2] = 18 * D; o[UAR * 3 + 2] = -18 * D;
    o[FAL * 3] = o[FAR * 3] = -(70 - 55 * smooth(0.45, 0.7, a)) * D;
    o[NEC * 3] = -30 * D;
  } else {
    // 스파이크: 도움닫기 웅크림 → 점프(포물선) → 오른팔 내려침 → 착지
    const crouchA = smooth(0, 0.25, a) * (1 - smooth(0.25, 0.35, a)), air = a > 0.3 && a < 0.85 ? Math.sin((a - 0.3) / 0.55 * Math.PI) : 0;
    o[OFF + 1] = -0.18 * crouchA + 0.42 * (H / 1.75) * air - 0.08 * smooth(0.85, 1, a) * (1 - smooth(0.92, 1, a));
    o[THL * 3] = o[THR * 3] = -(50 * crouchA + 25 * air) * D; o[SHL * 3] = o[SHR * 3] = (90 * crouchA + 40 * air) * D;
    o[FTL * 3] = o[FTR * 3] = (-25 * crouchA + 30 * air) * D;
    const hit = smooth(0.5, 0.62, a);
    o[UAR * 3] = -(170 - 120 * hit) * smooth(0.25, 0.45, a) * D + 40 * crouchA * D;
    o[FAR * 3] = -(90 * (1 - hit)) * D;
    o[UAL * 3] = -(150 * air) * D; o[UAL * 3 + 2] = 20 * D;
    o[SPI * 3] = (-15 * air * (1 - hit) + 20 * hit * air) * D; o[CHE * 3 + 1] = (25 * (1 - hit) - 15 * hit) * air * D;
    o[NEC * 3] = -30 * air * D;
  }
}

function wave(o, st, t) {
  o[UAR * 3 + 2] = -150 * D; o[UAR * 3] = -10 * D;
  o[FAR * 3] = -(25 + 30 * (0.5 + 0.5 * Math.sin(t * 9))) * D; o[FAR * 3 + 1] = 40 * D;
  o[CLR * 3 + 2] = -12 * D;
  o[UAL * 3 + 2] = 0; o[FAL * 3] = -15 * D;
}

function phone(o, st, t) {
  if (st.seed % 4 === 0) {
    // 셀카: 팔을 앞으로 길게, 고개 살짝 기울임
    o[UAR * 3] = -105 * D; o[UAR * 3 + 2] = -18 * D; o[FAR * 3] = -15 * D; o[HAR * 3] = -20 * D;
    o[HEA * 3 + 2] = 10 * D; o[NEC * 3] = -8 * D;
  } else {
    o[UAR * 3] = -38 * D; o[UAR * 3 + 2] = 4 * D; o[UAR * 3 + 1] = -25 * D; o[FAR * 3] = -112 * D; o[FAR * 3 + 1] = -30 * D;
    o[NEC * 3] = 16 * D; o[HEA * 3] = 10 * D; o[NEC * 3 + 1] = -5 * D; o[HEA * 3 + 1] = 0;
    o[UAL * 3] = -5 * D;
  }
}

function fall(o, st, a) {
  // 넘어짐: 앞으로 고꾸라짐 → 손 짚고 엎드림 → 일어남
  const down = smooth(0.0, 0.3, a), up = smooth(0.65, 1, a), k = down * (1 - up);
  o[ROOT] = 80 * D * k;
  o[OFF + 1] = (0.18 * (st.H / 1.75) - st.pelvisY) * k;
  o[OFF + 2] = 0.3 * k;
  o[UAL * 3] = -140 * D * k; o[UAR * 3] = -130 * D * k; o[FAL * 3] = -40 * D * k; o[FAR * 3] = -50 * D * k;
  o[THL * 3] = -30 * D * k; o[SHL * 3] = 60 * D * k; o[SHR * 3] = 25 * D * k;
  o[NEC * 3] = -35 * D * k;
  const kneel = smooth(0.55, 0.75, a) * (1 - smooth(0.85, 1, a));
  o[THR * 3] += -60 * D * kneel; o[SHR * 3] += 80 * D * kneel; o[SPI * 3] = 30 * D * kneel;
}

function shock(o, st, t, tl) {
  // 감전: 근육 강직 · 고주파 경련 → 쓰러짐
  const jit = (k) => Math.sin(t * 61 + k * 2.1) * Math.sin(t * 37 + k) * 6 * D;
  const col = smooth(1.6, 2.4, tl);
  o[SPI * 3] = -18 * D + jit(1); o[CHE * 3] = -12 * D + jit(2); o[NEC * 3] = -25 * D + jit(3);
  o[UAL * 3] = -40 * D + jit(4); o[UAR * 3] = -40 * D + jit(5); o[UAL * 3 + 2] = 40 * D; o[UAR * 3 + 2] = -40 * D;
  o[FAL * 3] = -110 * D + jit(6); o[FAR * 3] = -110 * D + jit(7); o[HAL * 3] = 40 * D; o[HAR * 3] = 40 * D;
  o[THL * 3] = jit(8); o[THR * 3] = jit(9); o[SHL * 3] = 10 * D + jit(10); o[SHR * 3] = 10 * D + jit(11);
  o[FTL * 3] = 25 * D; o[FTR * 3] = 25 * D;
  if (col > 0) {
    o[ROOT] = -80 * D * col; o[ROOT + 2] = 10 * D * col;
    o[OFF + 1] = (0.12 * (st.H / 1.75) - st.pelvisY) * col;
  }
}

function cry(o, st, t) {
  const sob = Math.max(0, Math.sin(t * 5.5)) * 4 * D;
  o[NEC * 3] = 30 * D + sob; o[HEA * 3] = 15 * D; o[CHE * 3] += 10 * D + sob;
  o[UAL * 3] = -70 * D; o[UAR * 3] = -70 * D; o[UAL * 3 + 2] = -15 * D; o[UAR * 3 + 2] = 15 * D;
  o[UAL * 3 + 1] = -20 * D; o[UAR * 3 + 1] = 20 * D;
  o[FAL * 3] = -140 * D; o[FAR * 3] = -140 * D;
  o[CLL * 3 + 2] = sob; o[CLR * 3 + 2] = -sob;
}

function climb(o, st, t) {
  const p = (t * 0.9) % 1, a = Math.sin(p * TAU), b = Math.sin(p * TAU + Math.PI);
  o[UAL * 3] = -(150 + 25 * a) * D; o[UAR * 3] = -(150 + 25 * b) * D;
  o[FAL * 3] = -(30 + 50 * (0.5 - 0.5 * a)) * D; o[FAR * 3] = -(30 + 50 * (0.5 - 0.5 * b)) * D;
  o[THL * 3] = -(45 + 35 * b) * D; o[THR * 3] = -(45 + 35 * a) * D;
  o[SHL * 3] = (60 + 40 * (0.5 + 0.5 * b)) * D; o[SHR * 3] = (60 + 40 * (0.5 + 0.5 * a)) * D;
  o[NEC * 3] = -25 * D; o[SPI * 3] = 8 * D;
}

function hug(o, st, t) {
  o[UAL * 3] = -80 * D; o[UAR * 3] = -80 * D; o[UAL * 3 + 2] = 10 * D; o[UAR * 3 + 2] = -10 * D;
  o[UAL * 3 + 1] = -50 * D; o[UAR * 3 + 1] = 50 * D; o[FAL * 3] = -75 * D; o[FAR * 3] = -75 * D;
  o[FAL * 3 + 1] = -40 * D; o[FAR * 3 + 1] = 40 * D;
  o[NEC * 3] = 15 * D; o[HEA * 3 + 2] = 15 * D; o[CHE * 3] += 6 * D + Math.sin(t * 3) * 1.5 * D;
}

/* ───────────────────────── 순운동학 → 스키닝 행렬 ───────────────────────── */
const R = new Float32Array(NB * 9), P = new Float32Array(NB * 3), E = new Float32Array(9), Q = new Float32Array(9);

function euler(x, y, z, out) {
  // R = Rz · Rx · Ry
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  // Rx·Ry
  const a00 = cy, a01 = 0, a02 = sy;
  const a10 = sx * sy, a11 = cx, a12 = -sx * cy;
  const a20 = -cx * sy, a21 = sx, a22 = cx * cy;
  out[0] = cz * a00 - sz * a10; out[1] = cz * a01 - sz * a11; out[2] = cz * a02 - sz * a12;
  out[3] = sz * a00 + cz * a10; out[4] = sz * a01 + cz * a11; out[5] = sz * a02 + cz * a12;
  out[6] = a20; out[7] = a21; out[8] = a22;
}

function mul3(a, ao, b, out, oo) {
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    out[oo + r * 3 + c] = a[ao + r * 3] * b[c] + a[ao + r * 3 + 1] * b[3 + c] + a[ao + r * 3 + 2] * b[6 + c];
  }
}

/**
 * 자세 → 뼈별 스키닝 행렬 (3×4 행 우선, 사람 지역 좌표 · 발바닥 원점)
 * out[o + b*12 ...] = [R | t] 행 3개. 바인드 회전이 단위이므로 M_b = [R_b | p_b − R_b·J_b]
 */
export function skinMatrices(info, pose, out, o = 0, parents) {
  const J = info.joints;
  // 골반: 몸 전체 회전(골반 관절 기준) × 골반 지역 회전
  euler(pose[ROOT], pose[ROOT + 1], pose[ROOT + 2], Q);
  euler(pose[0], pose[1], pose[2], E);
  mul3(Q, 0, E, R, 0);
  P[0] = J[0] + pose[OFF]; P[1] = J[1] + pose[OFF + 1]; P[2] = J[2] + pose[OFF + 2];
  for (let b = 1; b < NB; b++) {
    const p = parents[b];
    const dx = J[b * 3] - J[p * 3], dy = J[b * 3 + 1] - J[p * 3 + 1], dz = J[b * 3 + 2] - J[p * 3 + 2];
    const r = p * 9;
    P[b * 3] = P[p * 3] + R[r] * dx + R[r + 1] * dy + R[r + 2] * dz;
    P[b * 3 + 1] = P[p * 3 + 1] + R[r + 3] * dx + R[r + 4] * dy + R[r + 5] * dz;
    P[b * 3 + 2] = P[p * 3 + 2] + R[r + 6] * dx + R[r + 7] * dy + R[r + 8] * dz;
    euler(pose[b * 3], pose[b * 3 + 1], pose[b * 3 + 2], E);
    mul3(R, r, E, R, b * 9);
  }
  for (let b = 0; b < NB; b++) {
    const r = b * 9, k = o + b * 12, jx = J[b * 3], jy = J[b * 3 + 1], jz = J[b * 3 + 2];
    for (let row = 0; row < 3; row++) {
      const a = R[r + row * 3], bb = R[r + row * 3 + 1], c = R[r + row * 3 + 2];
      out[k + row * 4] = a; out[k + row * 4 + 1] = bb; out[k + row * 4 + 2] = c;
      out[k + row * 4 + 3] = P[b * 3 + row] - (a * jx + bb * jy + c * jz);
    }
  }
  return P;
}

/** 직전 skinMatrices 호출의 뼈 위치 (사람 지역 좌표) */
export function lastJointPos() { return P; }
