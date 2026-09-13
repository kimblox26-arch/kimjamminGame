// ORBITER — 물리 상수 및 단위 변환

/** 만유인력 상수 (m³ kg⁻¹ s⁻²) */
export const G = 6.6743e-11;

/** 표준 중력가속도 (m/s²) — 비추력(Isp) 계산 기준 */
export const G0 = 9.80665;

/** 기체 상수 (J/(mol·K)) */
export const R_GAS = 8.314462618;

/** 공기의 평균 몰질량 (kg/mol) */
export const M_AIR = 0.0289644;

/** 슈테판-볼츠만 상수 (W m⁻² K⁻⁴) */
export const SIGMA_SB = 5.670374419e-8;

/** 절대영도 오프셋 */
export const KELVIN_OFFSET = 273.15;

/** 해수면 공기 밀도 기준값 (kg/m³) */
export const RHO_SEA_LEVEL = 1.225;

/** 해수면 음속 기준값 (m/s) */
export const SOUND_SEA_LEVEL = 340.29;

/** 1 천문단위 (m) */
export const AU = 1.495978707e11;

/** 시간 단위 (초) */
export const MINUTE = 60;
export const HOUR = 3600;
export const DAY = 86400;
export const YEAR = 31536000;

/** 궤도 계산에서 이심률 특이점을 피하기 위한 여유값 */
export const ECC_EPSILON = 1e-9;
export const PARABOLIC_BAND = 1e-6;

/** 시뮬레이션 한계 */
export const MAX_TIMEWARP = 100000;
export const MIN_ORBIT_MARGIN = 1.0; // m, 지면 위 최소 여유

/** 타임워프 단계 — 대기권 밖에서만 고배속 허용 */
export const WARP_LEVELS = [
  { rate: 1, label: '×1', minAltFactor: 0 },
  { rate: 2, label: '×2', minAltFactor: 0 },
  { rate: 5, label: '×5', minAltFactor: 0 },
  { rate: 10, label: '×10', minAltFactor: 0 },
  { rate: 50, label: '×50', minAltFactor: 1.0 },
  { rate: 100, label: '×100', minAltFactor: 1.0 },
  { rate: 500, label: '×500', minAltFactor: 1.3 },
  { rate: 1000, label: '×1k', minAltFactor: 1.5 },
  { rate: 5000, label: '×5k', minAltFactor: 2.0 },
  { rate: 10000, label: '×10k', minAltFactor: 3.0 },
  { rate: 50000, label: '×50k', minAltFactor: 5.0 },
  { rate: 100000, label: '×100k', minAltFactor: 8.0 },
];

/** 난이도별 보정 계수 */
export const DIFFICULTY = {
  sandbox: {
    label: '샌드박스',
    fuelMult: 0.5,
    dragMult: 0.6,
    heatMult: 0,
    crashMult: 4,
    fundsMult: 0,
    gMult: 0.9,
    description: '연료 넉넉, 파괴 거의 없음. 자유롭게 실험하기 좋습니다.',
  },
  easy: {
    label: '쉬움',
    fuelMult: 0.8,
    dragMult: 0.8,
    heatMult: 0.4,
    crashMult: 2,
    fundsMult: 0.5,
    gMult: 1,
    description: '입문용. 재진입 가열과 충돌 판정이 관대합니다.',
  },
  normal: {
    label: '보통',
    fuelMult: 1,
    dragMult: 1,
    heatMult: 1,
    crashMult: 1,
    fundsMult: 1,
    gMult: 1,
    description: '표준 물리. 균형 잡힌 기본 난이도입니다.',
  },
  hard: {
    label: '어려움',
    fuelMult: 1.15,
    dragMult: 1.2,
    heatMult: 1.6,
    crashMult: 0.7,
    fundsMult: 1.5,
    gMult: 1,
    description: '연료 소모 증가, 가열·충돌 판정이 엄격합니다.',
  },
  realistic: {
    label: '현실',
    fuelMult: 1.3,
    dragMult: 1.35,
    heatMult: 2.2,
    crashMult: 0.45,
    fundsMult: 2,
    gMult: 1,
    description: '실제에 가까운 가혹한 조건. 작은 실수도 임무를 끝냅니다.',
  },
};

/** 자원 종류 정의 */
export const RESOURCES = {
  lf: {
    id: 'lf',
    name: '액체연료',
    short: 'LF',
    density: 5.0, // kg per unit
    color: '#f0a44a',
    cost: 0.8,
  },
  ox: {
    id: 'ox',
    name: '산화제',
    short: 'OX',
    density: 5.0,
    color: '#4ab5f0',
    cost: 0.9,
  },
  sf: {
    id: 'sf',
    name: '고체연료',
    short: 'SF',
    density: 7.5,
    color: '#c86a3a',
    cost: 0.6,
  },
  mono: {
    id: 'mono',
    name: '모노프로펠런트',
    short: 'MP',
    density: 4.0,
    color: '#e7d24a',
    cost: 1.2,
  },
  xe: {
    id: 'xe',
    name: '제논가스',
    short: 'XE',
    density: 0.1,
    color: '#a97af0',
    cost: 6.0,
  },
  ec: {
    id: 'ec',
    name: '전기',
    short: 'EC',
    density: 0,
    color: '#7ef0c8',
    cost: 0,
  },
  ore: {
    id: 'ore',
    name: '광석',
    short: 'ORE',
    density: 10.0,
    color: '#8a8070',
    cost: 0.1,
  },
};

/** 액체 엔진 기본 혼합비 (연료:산화제) */
export const LF_OX_RATIO = { lf: 0.45, ox: 0.55 };

/** 파트 카테고리 */
export const CATEGORIES = [
  { id: 'pod', name: '조종부', icon: '◉' },
  { id: 'tank', name: '연료탱크', icon: '▮' },
  { id: 'engine', name: '엔진', icon: '▽' },
  { id: 'structural', name: '구조물', icon: '╫' },
  { id: 'aero', name: '공력', icon: '◣' },
  { id: 'utility', name: '유틸리티', icon: '⚙' },
  { id: 'science', name: '과학', icon: '⚗' },
  { id: 'payload', name: '페이로드', icon: '▣' },
];

/** 상황(situation) 라벨 */
export const SITUATION = {
  PRELAUNCH: 'prelaunch',
  LANDED: 'landed',
  SPLASHED: 'splashed',
  FLYING: 'flying',
  SUBORBITAL: 'suborbital',
  ORBITING: 'orbiting',
  ESCAPING: 'escaping',
  DOCKED: 'docked',
  DESTROYED: 'destroyed',
};

export const SITUATION_LABEL = {
  prelaunch: '발사 대기',
  landed: '착륙',
  splashed: '착수',
  flying: '비행 중',
  suborbital: '준궤도',
  orbiting: '궤도',
  escaping: '탈출 궤도',
  docked: '도킹',
  destroyed: '파괴됨',
};

/** 단위 변환 헬퍼 */
export const kmToM = (km) => km * 1000;
export const mToKm = (m) => m / 1000;
export const tonToKg = (t) => t * 1000;
export const kgToTon = (kg) => kg / 1000;
export const knToN = (kn) => kn * 1000;
export const nToKn = (n) => n / 1000;
export const celsiusToKelvin = (c) => c + KELVIN_OFFSET;
export const kelvinToCelsius = (k) => k - KELVIN_OFFSET;
