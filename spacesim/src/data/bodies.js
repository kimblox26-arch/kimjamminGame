// SpaceSim — 태양계 실측 데이터
//
// 궤도요소: JPL "Keplerian Elements for Approximate Positions of the Major
// Planets" (1800 AD – 2050 AD). 각 천체는 J2000 값과 율리우스 세기당 변화율을
// 함께 가지므로 임의 날짜의 위치를 계산할 수 있다.
//   a[AU]  e  i[deg]  L(평균황경)[deg]  ϖ(근일점황경)[deg]  Ω(승교점황경)[deg]
//
// 물리량: NASA Planetary Fact Sheet / IAU 2015 공칭값.

export const PLANET_ELEMENTS = [
  {
    key: 'mercury', name: '수성', en: 'Mercury',
    el: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
    rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  },
  {
    key: 'venus', name: '금성', en: 'Venus',
    el: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
    rate: [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
  },
  {
    key: 'earth', name: '지구', en: 'Earth',
    el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  },
  {
    key: 'mars', name: '화성', en: 'Mars',
    el: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  },
  {
    key: 'jupiter', name: '목성', en: 'Jupiter',
    el: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  },
  {
    key: 'saturn', name: '토성', en: 'Saturn',
    el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    rate: [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  },
  {
    key: 'uranus', name: '천왕성', en: 'Uranus',
    el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
    rate: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  },
  {
    key: 'neptune', name: '해왕성', en: 'Neptune',
    el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    rate: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  },
  {
    key: 'pluto', name: '명왕성', en: 'Pluto',
    el: [39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
    rate: [-0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
  },
];

/**
 * 율리우스 세기 T(=J2000 이후 세기) 시점의 궤도요소.
 * @returns {{a,e,i,Omega,omega,M0}} 각도 deg
 */
export function elementsAt(p, T) {
  const [a, e, i, L, pi, Om] = p.el.map((v, k) => v + p.rate[k] * T);
  let M = L - pi;
  M = ((M % 360) + 540) % 360 - 180;
  return { a, e, i, Omega: Om, omega: pi - Om, M0: M };
}

// ─────────────── 물리 제원 ───────────────
// R[km] 적도반지름, mass[M☉], rot[일] (음수 = 역행자전), tilt[deg] 자전축 기울기,
// albedo 기하 알베도, T[K] 평균 표면(또는 1bar) 온도, g[m/s²], vesc[km/s], rho[g/cm³]

export const BODY_DATA = {
  sun: {
    name: '태양',
    R: 695700, mass: 1, rot: 25.38, tilt: 7.25, T: 5772, g: 274, vesc: 617.6, rho: 1.408,
    type: 'star', texture: 'sun', color: 0xfff4e8,
    atmosphere: '수소 73.8% · 헬륨 24.9% · 금속 1.3%',
    note: '전체 태양계 질량의 99.86%. 매초 400만 톤의 질량이 빛으로 바뀐다.',
  },
  mercury: {
    name: '수성',
    R: 2439.7, mass: 1.66014e-7, rot: 58.646, tilt: 0.034, albedo: 0.142, T: 440,
    g: 3.70, vesc: 4.25, rho: 5.427, moons: 0, type: 'planet', texture: 'rock',
    color: 0x9c8f84, craters: 1.0, roughness: 1,
    atmosphere: '사실상 없음 (산소·나트륨 미량)',
    note: '3:2 자전-공전 공명. 하루(태양일)가 공전주기의 2배인 176일.',
  },
  venus: {
    name: '금성',
    R: 6051.8, mass: 2.44784e-6, rot: -243.025, tilt: 177.36, albedo: 0.689, T: 737,
    g: 8.87, vesc: 10.36, rho: 5.243, moons: 0, type: 'planet', texture: 'venus',
    color: 0xe8c98a, atmo: 0xffe9b0, atmoStrength: 1.2,
    atmosphere: 'CO₂ 96.5% · N₂ 3.5% (92 bar)',
    note: '폭주 온실효과로 표면 464 ℃. 자전이 역행이라 해가 서쪽에서 뜬다.',
  },
  earth: {
    name: '지구',
    R: 6371.0, mass: 3.00349e-6, rot: 0.99726968, tilt: 23.4393, albedo: 0.434, T: 288,
    g: 9.807, vesc: 11.186, rho: 5.514, moons: 1, type: 'planet', texture: 'earth',
    color: 0x4f9dea, atmo: 0x6fb8ff, atmoStrength: 1.0, specular: 1,
    atmosphere: 'N₂ 78.1% · O₂ 20.9% · Ar 0.93%',
    note: '표면에 액체 물이 존재하는 유일한 천체. 자전축 23.44° 기울기가 계절을 만든다.',
  },
  moon: {
    name: '달',
    R: 1737.4, mass: 3.69432e-8, rot: 27.321661, tilt: 6.68, albedo: 0.136, T: 250,
    g: 1.62, vesc: 2.38, rho: 3.344, type: 'moon', texture: 'moon',
    color: 0xc8c8c8, craters: 1.4, roughness: 1,
    atmosphere: '없음',
    note: '조석 고정되어 항상 같은 면만 보인다. 매년 3.8 cm 씩 멀어진다.',
  },
  mars: {
    name: '화성',
    R: 3389.5, mass: 3.22716e-7, rot: 1.02595676, tilt: 25.19, albedo: 0.170, T: 210,
    g: 3.71, vesc: 5.03, rho: 3.933, moons: 2, type: 'planet', texture: 'mars',
    color: 0xd1603d, atmo: 0xffb08a, atmoStrength: 0.35,
    atmosphere: 'CO₂ 95.3% · N₂ 2.7% (0.006 bar)',
    note: '태양계 최고봉 올림푸스 몬스(21.9 km)와 최대 협곡 마리네리스 협곡이 있다.',
  },
  jupiter: {
    name: '목성',
    R: 69911, mass: 9.54792e-4, rot: 0.41354, tilt: 3.13, albedo: 0.538, T: 165,
    g: 24.79, vesc: 59.5, rho: 1.326, moons: 95, type: 'planet', texture: 'gas',
    color: 0xd9b48f, atmo: 0xffd9a8, atmoStrength: 0.5, spot: 1,
    atmosphere: 'H₂ 89.8% · He 10.2%',
    note: '대적점은 최소 190년 이상 지속된 폭풍으로 지구보다 크다.',
  },
  saturn: {
    name: '토성',
    R: 58232, mass: 2.85886e-4, rot: 0.44401, tilt: 26.73, albedo: 0.499, T: 134,
    g: 10.44, vesc: 35.5, rho: 0.687, moons: 146, type: 'planet', texture: 'gas',
    color: 0xe3d3a0, atmo: 0xffedc0, atmoStrength: 0.45, ring: true,
    atmosphere: 'H₂ 96.3% · He 3.25%',
    note: '평균밀도 0.687 g/cm³ — 충분히 큰 물통이 있다면 물에 뜬다.',
  },
  uranus: {
    name: '천왕성',
    R: 25362, mass: 4.36624e-5, rot: -0.71833, tilt: 97.77, albedo: 0.488, T: 76,
    g: 8.87, vesc: 21.3, rho: 1.271, moons: 28, type: 'planet', texture: 'ice',
    color: 0x8fd6e0, atmo: 0xa8f0ff, atmoStrength: 0.6,
    atmosphere: 'H₂ 82.5% · He 15.2% · CH₄ 2.3%',
    note: '자전축이 97.8° 누워 있어 사실상 굴러간다. 극지방이 42년씩 낮과 밤.',
  },
  neptune: {
    name: '해왕성',
    R: 24622, mass: 5.15139e-5, rot: 0.67125, tilt: 28.32, albedo: 0.442, T: 72,
    g: 11.15, vesc: 23.5, rho: 1.638, moons: 16, type: 'planet', texture: 'ice',
    color: 0x4062d6, atmo: 0x6a90ff, atmoStrength: 0.7, bands: 1,
    atmosphere: 'H₂ 80% · He 19% · CH₄ 1.5%',
    note: '태양계에서 가장 빠른 바람 (초속 580 m). 계산으로 먼저 예측된 행성.',
  },
  pluto: {
    name: '명왕성',
    R: 1188.3, mass: 6.55e-9, rot: -6.3872, tilt: 122.53, albedo: 0.52, T: 44,
    g: 0.62, vesc: 1.21, rho: 1.854, moons: 5, type: 'dwarf', texture: 'rock',
    color: 0xbda58c, craters: 0.5, roughness: 1,
    atmosphere: 'N₂ 희박 (근일점 부근에만)',
    note: '카론과 서로를 도는 이중 왜소행성계. 2006년 행성 지위에서 제외.',
  },

  // ── 갈릴레이 위성 ──
  io: {
    name: '이오',
    R: 1821.6, mass: 4.4910e-8, rot: 1.769138, tilt: 0, albedo: 0.63, T: 110,
    g: 1.796, vesc: 2.558, rho: 3.528, type: 'moon', texture: 'io', color: 0xf2e08a,
    atmosphere: 'SO₂ 극희박',
    note: '태양계에서 화산활동이 가장 활발한 천체. 조석가열로 400개 이상의 활화산.',
  },
  europa: {
    name: '유로파',
    R: 1560.8, mass: 2.4133e-8, rot: 3.551181, tilt: 0, albedo: 0.67, T: 102,
    g: 1.314, vesc: 2.025, rho: 3.013, type: 'moon', texture: 'europa', color: 0xe8ddc8,
    atmosphere: 'O₂ 극희박',
    note: '얼음 지각 아래 지구 전체 바닷물보다 많은 액체 바다가 있을 것으로 본다.',
  },
  ganymede: {
    name: '가니메데',
    R: 2634.1, mass: 7.4523e-8, rot: 7.154553, tilt: 0, albedo: 0.43, T: 110,
    g: 1.428, vesc: 2.741, rho: 1.936, type: 'moon', texture: 'ganymede', color: 0xa89c8c,
    atmosphere: 'O₂ 극희박',
    note: '태양계 최대 위성(수성보다 크다). 자기장을 가진 유일한 위성.',
  },
  callisto: {
    name: '칼리스토',
    R: 2410.3, mass: 5.4097e-8, rot: 16.689018, tilt: 0, albedo: 0.22, T: 134,
    g: 1.235, vesc: 2.440, rho: 1.834, type: 'moon', texture: 'rock', color: 0x7d7266,
    craters: 1.8, roughness: 1,
    atmosphere: 'CO₂ 극희박',
    note: '태양계에서 크레이터가 가장 조밀한 표면 — 40억 년간 지질활동이 없었다.',
  },
  titan: {
    name: '타이탄',
    R: 2574.7, mass: 6.7632e-8, rot: 15.945, tilt: 0, albedo: 0.22, T: 94,
    g: 1.352, vesc: 2.639, rho: 1.881, type: 'moon', texture: 'titan', color: 0xd9a25c,
    atmo: 0xffc070, atmoStrength: 1.4,
    atmosphere: 'N₂ 94.2% · CH₄ 5.65% (1.45 bar)',
    note: '짙은 대기를 가진 유일한 위성. 표면에 메탄 호수와 강이 있다.',
  },
  triton: {
    name: '트리톤',
    R: 1353.4, mass: 1.0759e-8, rot: -5.876854, tilt: 0, albedo: 0.76, T: 38,
    g: 0.779, vesc: 1.455, rho: 2.061, type: 'moon', texture: 'ice', color: 0xdfe7ec,
    atmosphere: 'N₂ 극희박',
    note: '역행 궤도 — 카이퍼 벨트에서 포획된 천체. 질소 간헐천이 분출한다.',
  },

  // ── 소행성 · 혜성 ──
  ceres: {
    name: '세레스',
    R: 469.7, mass: 4.723e-10, rot: 0.3781, tilt: 4, albedo: 0.09, T: 168,
    g: 0.27, vesc: 0.51, rho: 2.162, type: 'dwarf', texture: 'rock', color: 0x8c8377,
    craters: 1.2, roughness: 1,
    note: '소행성대 최대 천체이자 유일한 왜소행성. 질량의 25%가 물얼음일 수 있다.',
  },
  vesta: {
    name: '베스타',
    R: 262.7, mass: 1.3027e-10, rot: 0.2226, tilt: 29, albedo: 0.42, T: 170,
    g: 0.25, vesc: 0.36, rho: 3.456, type: 'asteroid', texture: 'rock', color: 0xa39683,
    craters: 1.6, roughness: 1,
    note: '지구에 떨어지는 운석(HED)의 약 6%가 베스타 기원이다.',
  },
  pallas: {
    name: '팔라스',
    R: 255.5, mass: 1.0257e-10, rot: 0.3256, tilt: 84, albedo: 0.15, T: 164,
    g: 0.18, vesc: 0.32, rho: 2.89, type: 'asteroid', texture: 'rock', color: 0x8a8880,
    craters: 1.5, roughness: 1,
    note: '궤도 경사각 34.8° — 주요 소행성 중 가장 기울어져 있다.',
  },
  halley: {
    name: '핼리 혜성',
    R: 5.5, mass: 1.107e-16, rot: 2.2, tilt: 0, albedo: 0.04, T: 200,
    type: 'comet', texture: 'rock', color: 0x8fd8e8, craters: 0.6, roughness: 1,
    note: '주기 75.3년. 1P/Halley. 다음 근일점 통과는 2061년 7월.',
  },
  encke: {
    name: '엔케 혜성',
    R: 2.4, mass: 1.0e-17, rot: 0.46, tilt: 0, albedo: 0.05, T: 250,
    type: 'comet', texture: 'rock', color: 0x9fd0cc, craters: 0.6, roughness: 1,
    note: '주기 3.30년으로 알려진 혜성 중 가장 짧다. 황소자리 유성우의 모천체.',
  },
};

// ─────────────── 위성 · 소행성 · 혜성 궤도요소 ───────────────
// 모행성 기준 (위성) 또는 태양 기준 (소행성·혜성), J2000 근사

export const MOONS = {
  earth: [
    { key: 'moon', a: 0.00257, e: 0.0549, i: 5.145, Omega: 125.08, omega: 318.15, M0: 135.27 },
  ],
  jupiter: [
    { key: 'io', a: 0.002819, e: 0.0041, i: 0.036, Omega: 43.98, omega: 84.13, M0: 342.02 },
    { key: 'europa', a: 0.004486, e: 0.0094, i: 0.466, Omega: 219.11, omega: 88.97, M0: 171.02 },
    { key: 'ganymede', a: 0.007155, e: 0.0013, i: 0.177, Omega: 63.55, omega: 192.42, M0: 317.54 },
    { key: 'callisto', a: 0.012585, e: 0.0074, i: 0.192, Omega: 298.85, omega: 52.64, M0: 181.41 },
  ],
  saturn: [
    { key: 'titan', a: 0.008168, e: 0.0288, i: 0.348, Omega: 28.06, omega: 180.53, M0: 163.31 },
  ],
  neptune: [
    { key: 'triton', a: 0.002371, e: 0.000016, i: 156.885, Omega: 172.43, omega: 344.05, M0: 264.78 },
  ],
};

export const SMALL_BODIES = [
  { key: 'ceres', a: 2.7675, e: 0.07582, i: 10.593, Omega: 80.329, omega: 73.598, M0: 95.989 },
  { key: 'vesta', a: 2.3615, e: 0.08866, i: 7.140, Omega: 103.811, omega: 151.198, M0: 307.804 },
  { key: 'pallas', a: 2.7729, e: 0.22989, i: 34.837, Omega: 173.081, omega: 310.048, M0: 229.098 },
  { key: 'halley', a: 17.834, e: 0.96714, i: 162.262, Omega: 58.420, omega: 111.333, M0: 66.4 },
  { key: 'encke', a: 2.2155, e: 0.84833, i: 11.781, Omega: 334.568, omega: 186.540, M0: 284.7 },
];

/**
 * 주 소행성대 커크우드 간극 — 목성과의 평균운동 공명 위치 [AU] 와 간극 폭.
 * 폭은 공명 차수에 따라 다르며 3:1 과 2:1 이 가장 넓다.
 */
export const KIRKWOOD = [
  { a: 2.065, res: '4:1', w: 0.018 },
  { a: 2.502, res: '3:1', w: 0.038 },
  { a: 2.825, res: '5:2', w: 0.028 },
  { a: 2.958, res: '7:3', w: 0.016 },
  { a: 3.279, res: '2:1', w: 0.048 },
];

/** 날짜 문자열(YYYY-MM-DD) → J2000 이후 경과일 */
export function daysSinceJ2000(dateStr) {
  const t = Date.parse(dateStr + 'T12:00:00Z');
  if (!isFinite(t)) return 0;
  return (t - Date.UTC(2000, 0, 1, 12, 0, 0)) / 86400e3;
}
