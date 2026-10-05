// SpaceSim — 천체 카탈로그: 실측 질량·반지름·궤도 요소·IAU 자전 모델·실제 표면 텍스처
// 궤도 요소: JPL "Approximate Positions of the Planets" (a, e, I, L, ϖ, Ω @J2000 + 세기당 변화율)
// 자전: IAU WGCCRE 2015 [α0, α̇, δ0, δ̇, W0, Ẇ]

export const BODIES = {
  sun: {
    name: '태양', type: 'G2V 주계열성', kind: 'star', m: 1, R: 695700, temp: 5772, tex: { map: 'sun' },
    iau: [286.13, 0, 63.87, 0, 84.176, 14.1844], color: 0xffe2b0,
    desc: '태양계 질량의 99.86%를 차지하는 G형 주계열성. 중심핵에서 매초 6억 톤의 수소를 헬륨으로 융합합니다.',
  },
  mercury: {
    name: '수성', type: '지구형 행성', m: 1.6601e-7, R: 2440, color: 0xb5aea6,
    el: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], rt: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
    iau: [281.0103, -0.0328, 61.4155, -0.0049, 329.5988, 6.1385108],
    style: 'rocky', look: { colA: 0x8f8a84, colB: 0x5f5b56, colC: 0x45423f, spot: 0.25 }, tex: { map: 'mercury', bump: 1 },
    desc: '태양에 가장 가까운 행성. 대기가 거의 없어 낮 430 °C, 밤 −180 °C의 극단적 온도차를 보입니다.',
  },
  venus: {
    name: '금성', type: '지구형 행성', m: 2.4478e-6, R: 6052, color: 0xf0d9a8,
    el: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], rt: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
    iau: [272.76, 0, 67.16, 0, 160.2, -1.4813688],
    style: 'cloudy', look: { colA: 0xe9d4a6, colB: 0xc49c5e, colC: 0xfff3d6, atmo: 0xffd9a0, atmoDensity: 1.3 }, tex: { map: 'venus', flow: 1 },
    desc: '두꺼운 이산화탄소 대기와 황산 구름이 폭주 온실효과를 일으켜 표면 온도가 465 °C에 달합니다. 역방향으로 자전합니다.',
  },
  earth: {
    name: '지구', type: '지구형 행성', m: 3.0034e-6, R: 6371, color: 0x6fb2ff, emb: true,
    el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], rt: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
    iau: [0, -0.641, 90, -0.557, 190.147, 360.9856235],
    style: 'earth', look: { clouds: true, atmo: 0x5aa6ff, atmoDensity: 1.7, atmoPower: 3.0, atmoScale: 1.04 },
    tex: { map: 'earth_day', night: 'earth_night', spec: 'earth_spec', normal: 'earth_normal', clouds: 'earth_clouds' },
    desc: '액체 상태의 물과 생명이 확인된 유일한 행성. 자전축이 23.4° 기울어져 계절이 생깁니다.',
  },
  moon: {
    name: '달', type: '지구의 위성', m: 3.6943e-8, R: 1737, color: 0xcfcac2,
    iau: [269.9949, 0.0031, 66.5392, 0.013, 38.3213, 13.17635815],
    style: 'rocky', look: { colA: 0x9c9a95, colB: 0x6e6c68, colC: 0x3a3938, spot: 1 }, tex: { map: 'moon', bump: 1.2 },
    desc: '지구의 유일한 자연 위성. 조석 고정되어 항상 같은 면을 지구로 향합니다.',
  },
  mars: {
    name: '화성', type: '지구형 행성', m: 3.2271e-7, R: 3390, color: 0xe07850,
    el: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], rt: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
    iau: [317.269, -0.1061, 54.432, -0.0609, 176.049, 350.891983],
    style: 'mars', look: { colA: 0xb8582c, colB: 0x5c2c18, colC: 0xd99466, atmo: 0xff9e70, atmoDensity: 0.55, atmoPower: 4.5 }, tex: { map: 'mars', bump: 0.8 },
    desc: '산화철 먼지로 붉게 보이는 행성. 태양계 최대 화산 올림푸스 산과 거대 협곡 마리네리스가 있습니다.',
  },
  jupiter: {
    name: '목성', type: '가스 거대 행성', m: 9.5479e-4, R: 69911, color: 0xe0b98c,
    el: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], rt: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
    iau: [268.056595, -0.006499, 64.495303, 0.002413, 284.95, 870.536],
    style: 'gas', look: { colA: 0xdcc6a6, colB: 0xa36a45, colC: 0xf2e9da, spot: 1, bands: 14, atmo: 0xd8c8b0, atmoDensity: 0.45 }, tex: { map: 'jupiter', flow: 1 },
    desc: '태양계에서 가장 큰 행성. 지구보다 큰 폭풍인 대적점이 350년 넘게 지속되고 있습니다.',
  },
  saturn: {
    name: '토성', type: '가스 거대 행성', m: 2.8589e-4, R: 58232, color: 0xf0d9a0,
    el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], rt: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
    iau: [40.589, -0.036, 83.537, -0.004, 38.9, 810.7939024],
    style: 'gas', look: { colA: 0xead9b2, colB: 0xc4a46c, colC: 0xf5ecd4, bands: 18, rings: true, atmo: 0xe8d8b0, atmoDensity: 0.4 }, tex: { map: 'saturn', flow: 1, ring: 'saturn_ring' },
    desc: '얼음과 암석 조각으로 이루어진 장대한 고리를 가진 행성. 평균 밀도가 물보다 낮습니다.',
  },
  uranus: {
    name: '천왕성', type: '얼음 거대 행성', m: 4.3662e-5, R: 25362, color: 0x9fe6f0,
    el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], rt: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
    iau: [257.311, 0, -15.175, 0, 203.81, -501.1600928],
    style: 'ice', look: { colA: 0xa6e6ec, colB: 0x83cbd8, colC: 0x5aa0b8, bands: 6, atmo: 0xaaf0ff, atmoDensity: 0.7 }, tex: { map: 'uranus' },
    desc: '자전축이 98° 기울어 옆으로 누운 채 공전합니다. 메테인 대기가 청록색을 띱니다.',
  },
  neptune: {
    name: '해왕성', type: '얼음 거대 행성', m: 5.1514e-5, R: 24622, color: 0x5d8bff,
    el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], rt: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
    iau: [299.36, 0, 43.46, 0, 249.978, 541.1397757],
    style: 'ice', look: { colA: 0x4170e0, colB: 0x2c50b8, colC: 0x14204e, bands: 8, spot: 1, atmo: 0x6a9cff, atmoDensity: 0.8 }, tex: { map: 'neptune', flow: 1 },
    desc: '태양계 가장 바깥의 행성. 시속 2,000 km가 넘는 태양계 최강의 바람이 붑니다.',
  },
  pluto: {
    name: '명왕성', type: '왜소행성', m: 6.58e-9, R: 1188, color: 0xd8c0a8, dwarf: true,
    el: [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684], rt: [-0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
    iau: [132.993, 0, -6.163, 0, 302.695, 56.3625225],
    style: 'pluto', look: { colA: 0xc9a98a, colB: 0x7a5a44 }, tex: { map: 'pluto', bump: 0.6 },
    desc: '카이퍼 벨트의 왜소행성. 하트 모양의 질소 얼음 평원 스푸트니크 평원이 유명합니다.',
  },
  io: {
    name: '이오', type: '목성의 위성', parent: 'jupiter', a: 421700, m: 4.4797e-8, R: 1822, color: 0xf0d870, gal: 0,
    iau: [268.05, -0.009, 64.5, 0.003, 200.39, 203.4889538],
    style: 'io', look: { colA: 0xe8d36a, colB: 0xcf9a3a, colC: 0xf6f0d6 },
    desc: '태양계에서 화산 활동이 가장 활발한 천체. 목성의 조석 가열로 400개 이상의 활화산이 있습니다.',
  },
  europa: {
    name: '유로파', type: '목성의 위성', parent: 'jupiter', a: 671034, m: 2.4078e-8, R: 1561, color: 0xe8dcc8, gal: 1,
    iau: [268.08, -0.009, 64.51, 0.003, 36.022, 101.3747235],
    style: 'europa', look: { colA: 0xece4d6, colB: 0xcbbca3, colC: 0x8a5634 },
    desc: '얼음 지각 아래 전 지구적 액체 바다가 있을 것으로 추정되는, 생명 탐사의 핵심 후보지입니다.',
  },
  ganymede: {
    name: '가니메데', type: '목성의 위성', parent: 'jupiter', a: 1070412, m: 7.4539e-8, R: 2634, color: 0xb8aa98, gal: 2,
    iau: [268.2, -0.009, 64.57, 0.003, 44.064, 50.3176081],
    style: 'rocky', look: { colA: 0x9d8f80, colB: 0x6a5f54, colC: 0xbab0a2, spot: 0.6 },
    desc: '태양계 최대의 위성으로 수성보다 큽니다. 고유 자기장을 가진 유일한 위성입니다.',
  },
  callisto: {
    name: '칼리스토', type: '목성의 위성', parent: 'jupiter', a: 1882709, m: 5.4074e-8, R: 2410, color: 0x8a8070, gal: 3,
    iau: [268.72, -0.009, 64.83, 0.003, 259.51, 21.5710715],
    style: 'rocky', look: { colA: 0x62584d, colB: 0x3d362f, colC: 0x8f8574, spot: 0.15 },
    desc: '태양계에서 크레이터가 가장 많은 천체 중 하나. 40억 년 된 오래된 표면을 간직하고 있습니다.',
  },
  titan: {
    name: '타이탄', type: '토성의 위성', parent: 'saturn', a: 1221870, m: 6.7628e-8, R: 2575, color: 0xe8a858,
    iau: [39.4827, 0, 83.4279, 0, 186.5855, 22.5769768],
    style: 'cloudy', look: { colA: 0xd99a4a, colB: 0xb47530, colC: 0xeab872, atmo: 0xffb060, atmoDensity: 1.1 },
    desc: '두꺼운 질소 대기를 가진 위성. 표면에는 액체 메테인 호수와 강이 흐릅니다.',
  },
  // ── 실험실 전용 천체 ──
  sirius: { name: '시리우스 A', type: 'A1V 주계열성', kind: 'star', m: 2.063, R: 1.711 * 695700, temp: 9940, desc: '밤하늘에서 가장 밝은 별. 태양보다 2배 무겁고 25배 밝습니다.' },
  proxima: { name: '적색왜성', type: 'M5.5V 적색왜성', kind: 'star', m: 0.122, R: 0.154 * 695700, temp: 3042, desc: '우리은하 별의 약 75%를 차지하는 작고 차가운 별. 수조 년 동안 탑니다.' },
  whitedwarf: { name: '백색왜성', type: '백색왜성 (시리우스 B형)', kind: 'star', m: 1.02, R: 5800, temp: 25000, desc: '태양 질량이 지구 크기에 압축된 별의 잔해. 1 cm³의 무게가 1톤에 달합니다.' },
  neutron: { name: '중성자별', type: '중성자별', kind: 'star', m: 1.4, R: 12, temp: 40000, desc: '초신성 폭발 후 남은 지름 24 km의 핵. 원자핵 밀도로 압축되어 있습니다.' },
  blackhole: { name: '블랙홀', type: '항성질량 블랙홀', kind: 'blackhole', m: 10, R: 29.5, color: 0xffa050, desc: '빛조차 빠져나올 수 없는 천체. 사건의 지평선 반지름 29.5 km(10 M☉).' },
  asteroid: { name: '소행성', type: '암석 소행성 (세레스급)', m: 4.7e-10, R: 470, style: 'rocky', look: { colA: 0x7a746c, colB: 0x4a4540, colC: 0x2e2b28, spot: 0.1 }, color: 0xa09080, desc: '태양계 형성 때 남은 암석 천체. 행성에 충돌하면 거대한 크레이터와 파편을 남깁니다.' },
  theia: { name: '테이아', type: '가상의 원시행성 (화성 크기)', m: 3.2e-7, R: 3390, style: 'lava', look: { colA: 0x3a2a22, colB: 0x7a5a48, spot: 0.4 }, color: 0xff9a70, desc: '45억 년 전 원시 지구와 충돌해 달을 만들었다고 추정되는 가상의 천체(거대 충돌 가설).' },
};

// 시각 강조 반지름 (AU)
export function visRadius(def) {
  if (def.kind === 'blackhole') return 0.05 * Math.cbrt(def.m / 10);
  if (def.kind === 'star') return Math.max(0.03, 0.12 * Math.sqrt(def.R / 695700));
  return 0.04 * Math.pow(def.R / 6371, 0.46) * (def.dwarf ? 1.2 : 1);
}
