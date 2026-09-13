// ORBITER — 헬리오스 항성계 정의
//
// 실제 태양계를 그대로 옮기면 저궤도 진입에만 9 km/s 가 들어 게임 템포가 무너진다.
// 그래서 반지름은 약 1/10, 밀도는 높게 잡아 표면중력은 유지하는 "압축 항성계"를 쓴다.
// 덕분에 저궤도 Δv 가 3.4 km/s 정도로 줄어 한 번의 비행이 짧고 밀도 있게 끝난다.
//
// 모든 거리는 m, 질량은 kg, 시간은 초.

import { ATMO_PRESETS } from '../physics/atmosphere.js';

/**
 * 천체 정의 필드
 *  id            고유 키
 *  name          표시 이름
 *  parent        부모 천체 id (항성은 null)
 *  type          star | planet | moon | dwarf
 *  radius        평균 반지름 (m)
 *  mu            중력변수 GM (m³/s²)
 *  rotPeriod     자전 주기 (s, 음수면 역자전)
 *  initialRotation 기준시각에서의 자전각 (rad)
 *  orbit         { a, e, argPe, M0, dir }
 *  atmo          대기 프리셋 오버라이드 또는 null
 *  ocean         { level, color } 또는 null
 *  terrain       지형 생성 파라미터
 *  palette       렌더링 색상
 *  science       과학 배율
 *  tidallyLocked 조석 고정 여부
 */

const T = (h) => h * 3600;

export const BODY_DEFS = [
  /* ── 항성 ───────────────────────────────────────────── */
  {
    id: 'helios',
    name: '헬리오스',
    latin: 'Helios',
    parent: null,
    type: 'star',
    radius: 261600000,
    mu: 1.1723328e18,
    rotPeriod: T(432),
    initialRotation: 0,
    orbit: null,
    atmo: null,
    ocean: null,
    luminosity: 1,
    surfaceTemp: 5800,
    terrain: { amplitude: 0, roughness: 0, craters: 0 },
    palette: {
      surface: '#ffcf5a',
      deep: '#ff9a2e',
      highlight: '#fff3c4',
      shadow: '#e07a1a',
      atmoGlow: '#ffd77a',
      map: '#ffcf5a',
    },
    science: 1,
    description:
      '항성계의 중심. 표면 온도 5,800 K. 근처에 접근하면 어떤 열차폐도 버티지 못한다.',
  },

  /* ── 1. 헤르메스 — 작고 뜨거운 암석 행성 ──────────── */
  {
    id: 'hermes',
    name: '헤르메스',
    latin: 'Hermes',
    parent: 'helios',
    type: 'planet',
    radius: 270000,
    mu: 1.7233e11,
    rotPeriod: T(1210),
    initialRotation: 0.9,
    orbit: {
      a: 5263138304,
      e: 0.2,
      argPe: 0.3,
      M0: 3.14,
      dir: 1,
    },
    atmo: null,
    ocean: null,
    terrain: {
      amplitude: 6800,
      roughness: 0.85,
      craters: 1.0,
      craterScale: 1.2,
      ridges: 0.3,
      seed: 1101,
    },
    palette: {
      surface: '#8c7a6a',
      deep: '#4e443c',
      highlight: '#c4b09a',
      shadow: '#2c2622',
      atmoGlow: null,
      map: '#a08a74',
    },
    biomes: ['적도 평원', '북극 분지', '태양면 능선', '충돌구 바닥'],
    science: 4,
    dayTemp: 700,
    nightTemp: 90,
    description:
      '항성에 가장 가까운 암석 행성. 대기가 없어 낮과 밤의 온도차가 600 K 를 넘는다.',
  },

  /* ── 2. 베네라 — 두꺼운 유독 대기 ─────────────────── */
  {
    id: 'venera',
    name: '베네라',
    latin: 'Venera',
    parent: 'helios',
    type: 'planet',
    radius: 580000,
    mu: 2.4897e12,
    rotPeriod: -T(2430),
    initialRotation: 2.1,
    orbit: {
      a: 9832684544,
      e: 0.01,
      argPe: 1.1,
      M0: 1.2,
      dir: 1,
    },
    atmo: { ...ATMO_PRESETS.thick },
    ocean: null,
    terrain: {
      amplitude: 5200,
      roughness: 0.6,
      craters: 0.2,
      ridges: 0.7,
      volcanic: 0.8,
      seed: 2202,
    },
    palette: {
      surface: '#c69a52',
      deep: '#8a6226',
      highlight: '#f0d08a',
      shadow: '#513a16',
      atmoGlow: '#f5d98f',
      map: '#d8b366',
    },
    biomes: ['용암 평원', '고지대', '극지 소용돌이', '균열대'],
    science: 6,
    dayTemp: 735,
    nightTemp: 730,
    description:
      '15기압의 이산화탄소 대기. 착륙은 쉽지만 이륙은 지옥이다. 역자전 행성.',
  },

  /* ── 3. 테라 — 모성 ───────────────────────────────── */
  {
    id: 'terra',
    name: '테라',
    latin: 'Terra',
    parent: 'helios',
    type: 'planet',
    radius: 600000,
    mu: 3.5316e12,
    rotPeriod: T(6),
    initialRotation: 0,
    orbit: {
      a: 13599840256,
      e: 0.0,
      argPe: 0,
      M0: 3.14,
      dir: 1,
    },
    atmo: { ...ATMO_PRESETS.earthlike },
    ocean: { level: 0, color: '#1d4f78', deepColor: '#0b2740' },
    terrain: {
      amplitude: 4800,
      roughness: 0.55,
      craters: 0.05,
      ridges: 0.65,
      continents: 0.7,
      seed: 3303,
    },
    palette: {
      surface: '#4a7d3f',
      deep: '#2b4a26',
      highlight: '#8fbf6a',
      shadow: '#1b2e18',
      rock: '#7a6a55',
      sand: '#c8b183',
      ice: '#e8f2f8',
      atmoGlow: '#7ec3f0',
      map: '#4f8ac4',
    },
    biomes: [
      '발사장',
      '해안',
      '대양',
      '초원',
      '사막',
      '산맥',
      '빙하',
      '고지대',
      '툰드라',
      '화산',
    ],
    science: 1,
    dayTemp: 295,
    nightTemp: 275,
    home: true,
    launchSites: [
      {
        id: 'ksc',
        name: '중앙 우주센터',
        latitude: 0.0,
        altitude: 76,
        pads: ['패드 A', '패드 B', '활주로'],
      },
      {
        id: 'north',
        name: '북방 발사기지',
        latitude: 1.05,
        altitude: 420,
        pads: ['극궤도 패드'],
      },
      {
        id: 'island',
        name: '적도 섬 기지',
        latitude: -0.12,
        altitude: 12,
        pads: ['해상 패드'],
      },
    ],
    description:
      '우리 문명의 고향. 70 km 대기, 6시간 자전, 그리고 아직 아무도 밟지 못한 두 개의 달.',
  },

  /* ── 테라의 달 1 : 루나 ───────────────────────────── */
  {
    id: 'luna',
    name: '루나',
    latin: 'Luna',
    parent: 'terra',
    type: 'moon',
    radius: 200000,
    mu: 6.5138398e10,
    rotPeriod: T(38.6),
    tidallyLocked: true,
    initialRotation: 1.7,
    orbit: {
      a: 12000000,
      e: 0.0,
      argPe: 0,
      M0: 1.7,
      dir: 1,
    },
    atmo: null,
    ocean: null,
    terrain: {
      amplitude: 4200,
      roughness: 0.75,
      craters: 1.4,
      craterScale: 1.0,
      ridges: 0.35,
      maria: 0.6,
      seed: 4404,
    },
    palette: {
      surface: '#9a9186',
      deep: '#5c564e',
      highlight: '#d6d0c6',
      shadow: '#2e2a26',
      atmoGlow: null,
      map: '#b0a89c',
    },
    biomes: ['고지대', '바다(마리아)', '극지 크레이터', '동쪽 분지', '중앙 산맥'],
    science: 2,
    dayTemp: 390,
    nightTemp: 100,
    description:
      '테라의 큰 달. 조석 고정되어 항상 같은 면만 보여준다. 첫 유인 착륙 목표.',
  },

  /* ── 테라의 달 2 : 닉스 ──────────────────────────── */
  {
    id: 'nyx',
    name: '닉스',
    latin: 'Nyx',
    parent: 'terra',
    type: 'moon',
    radius: 60000,
    mu: 1.7658e9,
    rotPeriod: T(11.7),
    initialRotation: 0.4,
    orbit: {
      a: 47000000,
      e: 0.03,
      argPe: 0.6,
      M0: 0.9,
      dir: 1,
    },
    atmo: null,
    ocean: null,
    terrain: {
      amplitude: 1200,
      roughness: 0.3,
      craters: 0.4,
      ridges: 0.15,
      smooth: 0.85,
      seed: 5505,
    },
    palette: {
      surface: '#cfe3d6',
      deep: '#8fae9c',
      highlight: '#f2fbf6',
      shadow: '#5e7568',
      atmoGlow: null,
      map: '#c8e0d2',
    },
    biomes: ['평탄지', '완만한 언덕', '극지', '깊은 골'],
    science: 3,
    dayTemp: 200,
    nightTemp: 60,
    lowGravity: true,
    description:
      '표면중력 0.49 m/s². 착륙은 쉽지만 너무 빨리 내려오면 그대로 튕겨 나간다.',
  },

  /* ── 4. 아레스 — 얇은 대기의 붉은 행성 ─────────────── */
  {
    id: 'ares',
    name: '아레스',
    latin: 'Ares',
    parent: 'helios',
    type: 'planet',
    radius: 320000,
    mu: 4.5e11,
    rotPeriod: T(18.6),
    initialRotation: 2.9,
    orbit: {
      a: 20726155264,
      e: 0.05,
      argPe: 0.0,
      M0: 0.05,
      dir: 1,
    },
    atmo: { ...ATMO_PRESETS.thin },
    ocean: null,
    terrain: {
      amplitude: 9500,
      roughness: 0.72,
      craters: 0.55,
      ridges: 0.9,
      canyons: 0.8,
      polarCaps: 0.85,
      seed: 6606,
    },
    palette: {
      surface: '#b4603a',
      deep: '#6e3520',
      highlight: '#e09466',
      shadow: '#3a1c11',
      ice: '#f0f4f8',
      atmoGlow: '#e0a882',
      map: '#c96a3d',
    },
    biomes: [
      '북극 빙관',
      '남극 빙관',
      '대협곡',
      '올림포스 화산',
      '적도 사막',
      '충돌 분지',
    ],
    science: 5,
    dayTemp: 250,
    nightTemp: 160,
    description:
      '0.6 % 기압. 낙하산만으로는 절대 못 선다. 역추진과 낙하산을 함께 써야 한다.',
  },

  {
    id: 'phobo',
    name: '포보',
    latin: 'Phobo',
    parent: 'ares',
    type: 'moon',
    radius: 13000,
    mu: 1.6e7,
    rotPeriod: T(7.6),
    tidallyLocked: true,
    initialRotation: 0,
    orbit: { a: 940000, e: 0.015, argPe: 0, M0: 2.2, dir: 1 },
    atmo: null,
    ocean: null,
    terrain: {
      amplitude: 900,
      roughness: 1.1,
      craters: 1.6,
      irregular: 0.9,
      seed: 7707,
    },
    palette: {
      surface: '#6e6258',
      deep: '#3b342e',
      highlight: '#a1958a',
      shadow: '#1f1b18',
      map: '#7a6c60',
    },
    biomes: ['스틱니 충돌구', '능선', '먼지 평원'],
    science: 7,
    description: '감자 모양의 포획 소행성. 탈출속도가 초속 11 m 라 점프로도 궤도에 오른다.',
  },

  {
    id: 'deimo',
    name: '데이모',
    latin: 'Deimo',
    parent: 'ares',
    type: 'moon',
    radius: 7500,
    mu: 3.1e6,
    rotPeriod: T(30.3),
    tidallyLocked: true,
    initialRotation: 1.2,
    orbit: { a: 2350000, e: 0.002, argPe: 1.4, M0: 0.3, dir: 1 },
    atmo: null,
    ocean: null,
    terrain: {
      amplitude: 420,
      roughness: 0.9,
      craters: 1.1,
      irregular: 0.7,
      seed: 8808,
    },
    palette: {
      surface: '#7d7264',
      deep: '#443d35',
      highlight: '#b2a695',
      shadow: '#241f1a',
      map: '#8a7d6e',
    },
    biomes: ['평활면', '먼지 웅덩이'],
    science: 8,
    description: '아레스의 바깥쪽 작은 달. 표면이 두꺼운 먼지로 덮여 있다.',
  },

  /* ── 5. 케레스 — 소행성대의 왜행성 ─────────────────── */
  {
    id: 'ceres',
    name: '케레스',
    latin: 'Ceres',
    parent: 'helios',
    type: 'dwarf',
    radius: 138000,
    mu: 2.9e10,
    rotPeriod: T(9.1),
    initialRotation: 0.7,
    orbit: {
      a: 36500000000,
      e: 0.11,
      argPe: 2.4,
      M0: 4.1,
      dir: 1,
    },
    atmo: null,
    ocean: null,
    terrain: {
      amplitude: 3400,
      roughness: 0.8,
      craters: 1.3,
      brightSpots: 0.5,
      seed: 9909,
    },
    palette: {
      surface: '#8e8a80',
      deep: '#514d46',
      highlight: '#ddd8cc',
      shadow: '#2a2724',
      map: '#9d978b',
    },
    biomes: ['오카토르 충돌구', '적도 능선', '극지 얼음'],
    science: 9,
    resources: { ore: 1.6 },
    description: '소행성대 최대 천체. 지하 얼음층과 풍부한 광석이 매장되어 있다.',
  },

  /* ── 6. 요베 — 가스 거인 ──────────────────────────── */
  {
    id: 'jove',
    name: '요베',
    latin: 'Jove',
    parent: 'helios',
    type: 'planet',
    radius: 6000000,
    mu: 8.2e14,
    rotPeriod: T(4.1),
    initialRotation: 1.1,
    orbit: {
      a: 68773560320,
      e: 0.05,
      argPe: 0.9,
      M0: 0.1,
      dir: 1,
    },
    atmo: { ...ATMO_PRESETS.gasgiant },
    ocean: null,
    gasGiant: true,
    terrain: { amplitude: 0, roughness: 0, craters: 0, bands: 9, seed: 11011 },
    palette: {
      surface: '#c9a273',
      deep: '#8e6c46',
      highlight: '#efd9b4',
      shadow: '#5c452c',
      band1: '#d8b98d',
      band2: '#a6805a',
      spot: '#c05f45',
      atmoGlow: '#e8c89a',
      map: '#caa478',
    },
    biomes: ['상층운', '대적점', '극지 소용돌이'],
    science: 12,
    description:
      '고체 표면이 없다. 대기권에 들어가면 돌아올 수 없지만, 중력 새총으로는 최고의 파트너.',
  },

  {
    id: 'vulca',
    name: '불카',
    latin: 'Vulca',
    parent: 'jove',
    type: 'moon',
    radius: 180000,
    mu: 4.2e10,
    rotPeriod: T(42),
    tidallyLocked: true,
    initialRotation: 0,
    orbit: { a: 14000000, e: 0.004, argPe: 0, M0: 0.5, dir: 1 },
    atmo: null,
    ocean: null,
    terrain: {
      amplitude: 2800,
      roughness: 0.5,
      craters: 0.05,
      volcanic: 1.5,
      seed: 12012,
    },
    palette: {
      surface: '#d9c14a',
      deep: '#94762a',
      highlight: '#f7e895',
      shadow: '#4f3d12',
      lava: '#ff5a1e',
      map: '#dcc356',
    },
    biomes: ['황 평원', '활화산', '용암호', '극지'],
    science: 10,
    description: '조석 가열로 끓는 화산 위성. 표면 전체가 유황으로 노랗다.',
  },

  {
    id: 'glacia',
    name: '글라시아',
    latin: 'Glacia',
    parent: 'jove',
    type: 'moon',
    radius: 160000,
    mu: 3.0e10,
    rotPeriod: T(84),
    tidallyLocked: true,
    initialRotation: 2.4,
    orbit: { a: 22500000, e: 0.009, argPe: 1.2, M0: 2.8, dir: 1 },
    atmo: null,
    ocean: { level: -800, color: '#2a5f8a', subsurface: true },
    terrain: {
      amplitude: 900,
      roughness: 0.25,
      craters: 0.15,
      cracks: 1.4,
      seed: 13013,
    },
    palette: {
      surface: '#dfe9f2',
      deep: '#9fb4c8',
      highlight: '#ffffff',
      shadow: '#6a7d90',
      crack: '#b9743f',
      map: '#d6e4f0',
    },
    biomes: ['균열대', '얼음 평원', '혼돈 지형', '극지'],
    science: 11,
    description: '두께 20 km 의 얼음 껍질 아래 액체 바다가 있다고 추정된다.',
  },

  {
    id: 'kronos',
    name: '크로노스',
    latin: 'Kronos',
    parent: 'jove',
    type: 'moon',
    radius: 380000,
    mu: 1.9e11,
    rotPeriod: T(160),
    tidallyLocked: true,
    initialRotation: 0.8,
    orbit: { a: 49000000, e: 0.028, argPe: 2.9, M0: 5.1, dir: 1 },
    atmo: { ...ATMO_PRESETS.methane },
    ocean: { level: 0, color: '#6b5a2e', deepColor: '#3d3216', liquid: '메탄' },
    terrain: {
      amplitude: 1800,
      roughness: 0.35,
      craters: 0.1,
      dunes: 1.2,
      seed: 14014,
    },
    palette: {
      surface: '#b5893f',
      deep: '#6f5423',
      highlight: '#e6c274',
      shadow: '#3d2d10',
      atmoGlow: '#f0c86a',
      map: '#c2953f',
    },
    biomes: ['메탄 호수', '모래 언덕', '고원', '해안'],
    science: 13,
    description:
      '1.45 기압의 질소·메탄 대기와 액체 메탄 호수. 낮은 중력 덕에 날개만 달아도 날 수 있다.',
  },

  /* ── 7. 아넬루스 — 고리 행성 ──────────────────────── */
  {
    id: 'anelus',
    name: '아넬루스',
    latin: 'Anelus',
    parent: 'helios',
    type: 'planet',
    radius: 4200000,
    mu: 3.1e14,
    rotPeriod: T(5.2),
    initialRotation: 3.3,
    orbit: {
      a: 125798522368,
      e: 0.06,
      argPe: 2.1,
      M0: 2.4,
      dir: 1,
    },
    atmo: { ...ATMO_PRESETS.gasgiant, height: 480000, seaPressure: 22 },
    ocean: null,
    gasGiant: true,
    rings: {
      inner: 5400000,
      outer: 9800000,
      tilt: 0,
      color: '#d8cdb4',
      gaps: [{ at: 7400000, width: 260000 }],
    },
    terrain: { amplitude: 0, roughness: 0, bands: 7, seed: 15015 },
    palette: {
      surface: '#d7c79a',
      deep: '#a08f66',
      highlight: '#f4ecd0',
      shadow: '#6b5d3c',
      band1: '#e2d4ac',
      band2: '#bba97c',
      atmoGlow: '#f0e3bd',
      map: '#d9caa0',
    },
    biomes: ['상층운', '고리 그림자대', '극지 육각형'],
    science: 15,
    description:
      '폭 4,400 km 의 얼음 고리를 가진 가스 행성. 고리 사이를 통과하는 궤도가 가능하다.',
  },

  {
    id: 'titania',
    name: '티타니아',
    latin: 'Titania',
    parent: 'anelus',
    type: 'moon',
    radius: 210000,
    mu: 5.5e10,
    rotPeriod: T(96),
    tidallyLocked: true,
    initialRotation: 1.9,
    orbit: { a: 26000000, e: 0.012, argPe: 0.4, M0: 3.9, dir: 1 },
    atmo: null,
    ocean: null,
    terrain: {
      amplitude: 5200,
      roughness: 0.7,
      craters: 0.9,
      canyons: 1.3,
      seed: 16016,
    },
    palette: {
      surface: '#b8b2a6',
      deep: '#6f6a60',
      highlight: '#e7e2d6',
      shadow: '#3a3630',
      map: '#c0b9ac',
    },
    biomes: ['대협곡', '충돌 분지', '극지 능선'],
    science: 14,
    description: '표면을 가로지르는 1,200 km 짜리 협곡이 특징인 얼음-암석 위성.',
  },

  /* ── 8. 히파티아 — 외곽 얼음 왜행성 ───────────────── */
  {
    id: 'hypatia',
    name: '히파티아',
    latin: 'Hypatia',
    parent: 'helios',
    type: 'dwarf',
    radius: 95000,
    mu: 1.1e10,
    rotPeriod: -T(153),
    initialRotation: 4.4,
    orbit: {
      a: 232000000000,
      e: 0.26,
      argPe: 4.4,
      M0: 1.6,
      dir: 1,
    },
    atmo: null,
    ocean: null,
    terrain: {
      amplitude: 2600,
      roughness: 0.6,
      craters: 0.8,
      nitrogenPlains: 0.9,
      seed: 17017,
    },
    palette: {
      surface: '#c9b0a0',
      deep: '#7d6a5e',
      highlight: '#f0e2d6',
      shadow: '#3e352e',
      nitrogen: '#e8ddc8',
      map: '#cdb4a4',
    },
    biomes: ['질소 평원', '얼음 산맥', '어두운 적도대', '극관'],
    science: 18,
    description:
      '항성에서 232 Gm 떨어진 얼음 왜행성. 여기 도달하면 당신은 더 배울 게 없다.',
  },
];

/** id → 정의 맵 */
export const BODY_BY_ID = new Map(BODY_DEFS.map((b) => [b.id, b]));

/** 모성 */
export const HOME_BODY_ID = 'terra';

/** 항성 */
export const STAR_ID = 'helios';

/**
 * 탐사 순서 추천 — 튜토리얼/미션 진행에 사용
 */
export const PROGRESSION_ORDER = [
  'terra',
  'luna',
  'nyx',
  'ares',
  'phobo',
  'deimo',
  'venera',
  'ceres',
  'jove',
  'vulca',
  'glacia',
  'kronos',
  'anelus',
  'titania',
  'hermes',
  'hypatia',
];

/** 천체별 난이도 등급 (1=쉬움 … 10=극악) */
export const DIFFICULTY_RATING = {
  terra: 1,
  luna: 2,
  nyx: 2,
  ares: 4,
  phobo: 5,
  deimo: 5,
  venera: 7,
  ceres: 6,
  jove: 8,
  vulca: 8,
  glacia: 8,
  kronos: 7,
  anelus: 9,
  titania: 9,
  hermes: 9,
  hypatia: 10,
};

/**
 * 대략적인 Δv 지도 (m/s) — 지도 UI 및 미션 브리핑 표시용.
 * from → to 의 최소 Δv 근사치.
 */
export const DELTAV_MAP = {
  'terra:surface→terra:lowOrbit': 3400,
  'terra:lowOrbit→luna:transfer': 860,
  'luna:transfer→luna:lowOrbit': 280,
  'luna:lowOrbit→luna:surface': 580,
  'terra:lowOrbit→nyx:transfer': 930,
  'nyx:transfer→nyx:lowOrbit': 210,
  'nyx:lowOrbit→nyx:surface': 160,
  'terra:lowOrbit→escape': 950,
  'escape→ares:transfer': 1050,
  'ares:transfer→ares:lowOrbit': 1250,
  'ares:lowOrbit→ares:surface': 1400,
  'escape→venera:transfer': 1000,
  'venera:transfer→venera:lowOrbit': 1450,
  'escape→jove:transfer': 1960,
  'jove:transfer→jove:lowOrbit': 2800,
  'escape→anelus:transfer': 2600,
  'escape→hypatia:transfer': 4100,
  'escape→hermes:transfer': 2200,
  'escape→ceres:transfer': 1560,
};

/**
 * 천체 표면중력 계산 (m/s²)
 */
export function surfaceGravityOf(def) {
  return def.mu / (def.radius * def.radius);
}

/**
 * 천체 탈출속도 (m/s)
 */
export function escapeSpeedOf(def) {
  return Math.sqrt((2 * def.mu) / def.radius);
}

/**
 * 저궤도 속도 (m/s) — 대기 상단 + 여유 10 km
 */
export function lowOrbitSpeedOf(def) {
  const alt = (def.atmo?.height ?? 0) + 10000;
  return Math.sqrt(def.mu / (def.radius + alt));
}

/** 권장 저궤도 고도 */
export function recommendedOrbitAltitude(def) {
  return (def.atmo?.height ?? 0) + Math.max(10000, def.radius * 0.02);
}

/** 정지궤도 반지름 */
export function synchronousRadiusOf(def) {
  const p = Math.abs(def.rotPeriod);
  return Math.cbrt((def.mu * p * p) / (4 * Math.PI * Math.PI));
}

/** 천체 요약 정보 — UI 카드에 표시 */
export function bodySummary(def) {
  const g = surfaceGravityOf(def);
  return {
    id: def.id,
    name: def.name,
    type: def.type,
    radiusKm: def.radius / 1000,
    gravity: g,
    gravityG: g / 9.80665,
    escapeSpeed: escapeSpeedOf(def),
    lowOrbitSpeed: lowOrbitSpeedOf(def),
    hasAtmosphere: !!def.atmo,
    atmosphereHeightKm: def.atmo ? def.atmo.height / 1000 : 0,
    dayLengthHours: Math.abs(def.rotPeriod) / 3600,
    difficulty: DIFFICULTY_RATING[def.id] ?? 5,
    science: def.science ?? 1,
    description: def.description,
  };
}
