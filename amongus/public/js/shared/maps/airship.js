// THE AIRSHIP — 원작 월드 좌표(유니티 단위, y 위가 +)를 K배 확대.
// 사다리 3개(회의실↔갭 룸, 갭 룸 위↔아래, 메인 홀↔전기실) · 갭 룸 이동 플랫폼 · 수동 문 21개 · 스폰 위치 선택
const K = 155, X0 = -26, Y0 = 18.5;
const X = x => Math.round((x - X0) * K), Y = y => Math.round((Y0 - y) * K);
const B = (x1, y1, x2, y2) => [[X(x1), Y(y2)], [X(x2), Y(y2)], [X(x2), Y(y1)], [X(x1), Y(y1)]];
const Pg = pts => pts.map(([x, y]) => [X(x), Y(y)]);
const P = (x, y) => ({ x: X(x), y: Y(y) });
const Rect = (kind, x1, y1, x2, y2, o = {}) => ({ kind, x: X(x1), y: Y(y2), w: (x2 - x1) * K, h: (y2 - y1) * K, ...o });
const Circ = (kind, x, y, r, o = {}) => ({ kind, ...P(x, y), r: r * K, ...o });
const D = (id, room, x1, y1, x2, y2) => ({ id, room, x: X(x1), y: Y(y2), w: (x2 - x1) * K, h: (y2 - y1) * K });

const rooms = [
  ['cockpit', '조종석', Pg([[-25.0, -3.4], [-24.0, -4.3], [-17.4, -4.3], [-16.6, -3.4], [-16.6, 1.8], [-17.4, 2.6], [-24.0, 2.6], [-25.0, 1.8]]), 'ship'],
  ['comms', '통신실', B(-15.3, 0.35, -11.2, 3.8), 'metal'],
  ['armory', '무기고', B(-15.6, -10.2, -9.2, -2.9), 'storage'],
  ['viewing', '전망대', B(-17.4, -16.9, -9.3, -10.9), 'ship'],
  ['kitchen', '주방', B(-8.2, -13.4, -2.0, -5.4), 'tile'],
  ['vault', '금고', B(-13.4, 4.3, -4.2, 13.4), 'carpet'],
  ['engine', '엔진실', B(-7.6, -3.2, 3.0, 2.0), 'eng'],
  ['brig', '감옥', B(-3.2, 7.6, 2.4, 13.6), 'metal'],
  ['gap_up', '갭 룸', B(3.2, 8.2, 6.6, 11.2), 'metal'],
  ['gap_low', '갭 룸', B(3.0, 5.2, 6.2, 7.5), 'metal'],
  ['gap_r', '갭 룸', B(10.6, 5.2, 16.0, 10.4), 'metal'],
  ['meeting', '회의실', Pg([[2.8, 13.0], [16.4, 13.0], [16.4, 14.9], [18.4, 14.9], [18.4, 17.6], [2.8, 17.6]]), 'wood'],
  ['main', '메인 홀', B(4.6, -1.3, 17.4, 1.0), 'wood'],
  ['records', '기록실', B(16.8, 6.4, 23.6, 13.0), 'carpet'],
  ['lounge', '라운지', Pg([[24.3, 4.75], [35.3, 4.75], [35.3, 6.5], [28.3, 6.5], [28.3, 10.9], [24.3, 10.9]]), 'carpet'],
  ['showers', '샤워실', Pg([[18.0, -2.8], [25.2, -2.8], [25.2, 5.9], [16.7, 5.9], [16.7, 3.0], [18.0, 3.0]]), 'white'],
  ['vent', '환기실', B(25.8, -3.7, 29.7, 2.6), 'metal'],
  ['cargo', '화물칸', B(30.4, -4.4, 40.2, 4.2), 'storage'],
  ['medical', '의무실', B(22.0, -10.8, 33.6, -5.0), 'med'],
  ['security', '보안실', B(4.3, -13.0, 9.4, -8.6), 'metal'],
  ['portraits', '초상화 복도', B(-0.9, -15.8, 3.7, -10.6), 'carpet'],
  ['deck', '전망대', B(5.0, -16.8, 11.6, -13.5), 'ship'],
].map(([id, name, poly, floor]) => ({ id, name, poly, floor }));

// 전기실: 칸막이 미로 (칸 사이 일부만 열림)
const CX = [[9.9, 11.8], [12.2, 14.8], [15.2, 17.8], [18.2, 21.0]], CY = [[-7.5, -4.6], [-10.0, -7.9], [-11.9, -10.4]];
const cells = [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2]];
for (const [c, r] of cells) {
  const [x1, x2] = CX[c], [y1, y2] = CY[r];
  rooms.push({ id: `elec${c}${r}`, name: '전기실', poly: B(x1, y1, x2, c === 3 && r === 0 ? -3.3 : y2), floor: 'elec' });
}
const link = (a, b) => { // 이웃 칸 사이 입구
  const [c1, r1] = a, [c2, r2] = b;
  if (r1 === r2) { const x = CX[Math.min(c1, c2)][1], y = (CY[r1][0] + CY[r1][1]) / 2; return B(x - 0.15, y - 0.55, x + 0.55, y + 0.55); }
  const x = (CX[c1][0] + CX[c1][1]) / 2; return B(x - 0.55, CY[Math.max(r1, r2)][1] - 0.15, x + 0.55, CY[Math.min(r1, r2)][0] + 0.15);
};
const elecLinks = [[[0, 0], [1, 0]], [[0, 0], [0, 1]], [[1, 0], [1, 1]], [[1, 1], [1, 2]], [[1, 2], [2, 2]], [[2, 2], [3, 2]], [[3, 2], [3, 1]], [[3, 1], [3, 0]], [[3, 0], [2, 0]], [[2, 0], [2, 1]], [[2, 1], [3, 1]]].map(([a, b]) => link(a, b));

const halls = [
  B(-16.8, -1.8, -8.4, -0.2),                       // 통신실 복도
  B(-13.9, -0.4, -12.8, 0.55), B(-11.6, -3.05, -10.4, -1.7), // 통신실·무기고 입구
  B(-17.0, -1.6, -16.2, -0.2), B(-8.6, -1.6, -7.4, -0.2),    // 조종석·엔진실 쪽 끝
  B(-9.4, -7.9, -8.0, -6.7), B(-9.5, -12.6, -8.0, -11.4), B(-2.2, -12.6, -0.7, -11.4), // 주방 문 3개
  B(-1.1, 1.8, 0.9, 7.8),                           // 엔진실 → 감옥 앞 통로
  B(-4.4, 8.2, -3.0, 9.4), B(2.2, 8.2, 3.4, 9.4),   // 감옥 서쪽(금고)·동쪽(갭 룸) 문
  B(2.8, -0.6, 4.8, 0.7),                           // 엔진실 ↔ 메인 홀
  B(4.6, 1.0, 7.6, 3.9), B(8.0, 0.9, 11.8, 3.6), B(12.4, 0.9, 14.0, 3.1), B(4.8, -4.3, 7.8, -1.2), B(12.2, -4.0, 15.2, -1.2), // 메인 홀 곁방들
  B(14.4, 0.9, 15.6, 5.4),                          // 메인 홀 → 갭 룸 오른쪽
  B(17.2, -0.5, 18.2, 0.6),                         // 메인 홀 ↔ 샤워실
  B(16.0, 8.8, 17.0, 9.9), B(19.3, 5.7, 20.4, 6.6), B(23.4, 8.8, 24.5, 9.9), // 기록실 문 3개
  B(16.9, 12.8, 18.3, 15.1),                        // 기록실 → 회의실 계단
  B(25.0, -0.6, 26.0, 0.8), B(29.5, -2.6, 30.6, -1.0), B(26.6, 2.4, 27.8, 4.9), // 샤워실·화물칸·라운지 ↔ 환기실
  B(32.0, -5.2, 33.1, -4.2), B(20.8, -9.0, 22.2, -7.9), // 의무실 문(화물칸·전기실)
  B(9.2, -9.6, 10.1, -8.4), B(5.0, -13.7, 6.2, -12.8), B(3.5, -11.4, 4.6, -10.3), // 보안실 ↔ 전기실·전망대·초상화 복도
  ...[29.25, 30.8, 32.3, 33.8].map(x => B(x - 0.5, 6.4, x + 0.5, 7.3)), // 라운지 화장실 칸 입구
  ...elecLinks,
].map(poly => ({ poly, floor: 'hall' }));
// 라운지 화장실 칸
for (const [i, x] of [29.25, 30.8, 32.3, 33.8].entries()) halls.push({ poly: B(x - 0.65, 7.2, x + 0.65, 8.5), floor: 'white', id: 'stall' + i });

const st = {
  w_engine: P(-7.0, 1.4), w_view: P(-10.3, -11.5), w_main: P(16.2, 2.6), w_showers: P(17.1, 5.3), w_cargo: P(35.15, 3.8), w_lounge: P(27.4, 10.3), w_meeting: P(14.1, 16.5),
  idcode: P(16.2, 16.33), calib: P(16.35, -5.5),
  br1: P(12.33, -7.3), br2: P(15.37, -7.3), br3: P(17.29, -10.6), br4: P(17.29, -7.3), br5: P(18.42, -5.34), br6: P(18.42, -8.2), br7: P(20.27, -10.6),
  ul_left: P(-14.46, -16.39), ul_right: P(10.47, -16.22), dl_records: P(22.5, 12.4), dl_lounge: P(34.5, 5.5), dl_medical: P(30.5, -5.5), dl_cockpit: P(-23.0, 1.8), dl_armory: P(-15.0, -3.5),
  safe: P(36.3, -2.69), fans: P(27.6, 1.8), photos: P(13.4, 2.35), tapes: P(8.13, -11.54),
  garb_main: P(6.0, 3.4), garb_medical: P(24.0, -10.3), garb_lounge: P(25.0, 10.3), garb_out: P(-12.0, -16.4),
  fuel_can: P(39.0, 3.6), fuel_engine: P(-5.5, -2.6),
  ruby: P(-8.85, 9.1), steering: P(-19.68, -0.79), divert: P(17.6, -3.71),
  acc_meeting: P(9.0, 17.0), acc_gap: P(5.5, 5.6), acc_records: P(17.4, 12.4), acc_lounge: P(34.6, 6.0), acc_engine: P(2.4, 1.6), acc_vault: P(-5.0, 12.8), acc_cockpit: P(-17.2, -3.6), acc_armory: P(-9.8, -9.6),
  towels: P(21.0, 1.0), toilet0: P(29.25, 8.0), toilet1: P(30.8, 8.0), toilet2: P(32.3, 8.0), toilet3: P(33.8, 8.0),
  mannequin: P(-7.38, 6.43), records_sort: P(19.0, 11.8), pistols: P(-14.8, -5.0), rifles: P(-14.8, -8.6), decon: P(14.95, 3.7), burger: P(-5.18, -8.52), shower: P(20.82, 3.28),
  // 사보타주
  crash1: P(4.6, 5.8), crash2: P(15.2, 9.8), lights_cargo: P(31.2, 3.6), lights_gap: P(12.0, 9.9), lights_view: P(-16.6, -11.6), comms: P(-13.4, 3.3),
  // 장비
  cams: P(6.4, -9.2), admin: P(20.0, 8.3), vitals: P(23.0, -5.6), laptop: P(13.2, 15.8),
};

const vents = {
  v_vault: P(-12.63, 8.47), v_cockpit: P(-22.1, -1.51), v_ejection: P(-15.66, -11.7),
  v_engine: P(0.2, -2.54), v_kitchen: P(-2.6, -9.34), v_hall1: P(7.02, -3.73),
  v_hall2: P(9.81, 3.21), v_gap2: P(12.66, 5.92), v_gap1: P(3.6, 6.4),
  v_showers: P(23.99, -1.39), v_records: P(23.0, 8.26), v_cargo: P(30.9, -3.58),
};
const ventGroups = [['v_engine', 'v_kitchen', 'v_hall1'], ['v_hall2', 'v_gap2', 'v_gap1'], ['v_showers', 'v_records', 'v_cargo']];
vents.v_vault.links = ['v_cockpit']; vents.v_cockpit.links = ['v_vault', 'v_ejection']; vents.v_ejection.links = ['v_cockpit'];

// 문 사보타주 (에어십: 문 패널을 열어야 함)
const doors = [
  D('comms_w', 'comms', -16.8, -1.6, -16.4, -0.2), D('comms_e', 'comms', -8.9, -1.6, -8.45, -0.2), D('comms_n', 'comms', -13.9, -0.25, -12.8, 0.15), D('comms_s', 'comms', -11.6, -2.6, -10.4, -2.2),
  D('brig_s', 'brig', -1.1, 7.15, 0.9, 7.55), D('brig_w', 'brig', -3.85, 8.2, -3.45, 9.4), D('brig_e', 'brig', 2.55, 8.2, 2.95, 9.4),
  D('kit_w1', 'kitchen', -8.95, -7.9, -8.55, -6.7), D('kit_w2', 'kitchen', -8.95, -12.6, -8.55, -11.4), D('kit_e', 'kitchen', -1.7, -12.6, -1.3, -11.4),
  D('main_w', 'main', 4.05, -0.6, 4.45, 0.7), D('main_e', 'main', 17.4, -0.5, 17.8, 0.6),
  D('rec_w', 'records', 16.2, 8.8, 16.6, 9.9), D('rec_e', 'records', 23.8, 8.8, 24.2, 9.9), D('rec_s', 'records', 19.3, 5.95, 20.4, 6.35),
  ...[29.25, 30.8, 32.3, 33.8].map((x, i) => D('stall' + i, 'lounge', x - 0.5, 6.55, x + 0.5, 6.95)),
  D('med_w', 'medical', 21.3, -9.0, 21.7, -7.9), D('med_n', 'medical', 32.0, -4.9, 33.1, -4.5),
];

// 사다리·플랫폼
const transports = [
  { id: 'ladder_meet', kind: 'ladder', name: '사다리', a: P(4.2, 13.6), b: P(4.2, 10.6), time: 2.2 },
  { id: 'ladder_gap', kind: 'ladder', name: '사다리', a: P(5.6, 8.7), b: P(5.6, 7.0), time: 1.6 },
  { id: 'ladder_elec', kind: 'ladder', name: '사다리', a: P(13.7, -3.5), b: P(13.7, -5.9), time: 1.8 },
  { id: 'platform', kind: 'platform', name: '이동 플랫폼', a: P(6.2, 9.4), b: P(11.0, 9.4), time: 3.5 },
];

const props = [
  Rect('ladder', 3.8, 10.9, 4.6, 13.3), Rect('ladder', 5.2, 7.2, 6.0, 8.5), Rect('ladder', 13.3, -5.6, 14.1, -3.7),
  Rect('longTable', 8.0, 14.6, 13.6, 15.6, { block: true, color: '#c99a60' }),
  Rect('console', -24.2, -1.0, -22.8, 1.2, { block: true }), Rect('chair', -22.6, -0.3, -22.1, 0.2),
  Rect('console', -14.8, 2.9, -11.8, 3.6, { block: true }), Rect('shelf', -15.4, -4.0, -14.4, -2.95, { block: true }), Rect('shelf', -15.4, -9.6, -14.4, -7.6, { block: true }),
  Rect('crate', -12.0, -8.0, -10.6, -6.6, { block: true }), Rect('window', -17.4, -16.9, -9.3, -16.7), Rect('window', 5.0, -16.8, 11.6, -16.6),
  Rect('desk', -7.0, -10.8, -4.0, -9.8, { block: true, color: '#d9d9d2' }), Rect('sink', -7.8, -7.0, -6.6, -6.0),
  Rect('statue', -11.0, 9.5, -10.0, 10.5, { block: true }), Rect('crate', -6.0, 11.6, -4.6, 12.9, { block: true }), Circ('barrel', -10.5, 5.2, 0.4, { block: true }),
  Rect('engine', -6.8, -2.6, -3.8, 0.8, { block: true }), Rect('engine', -2.6, 0.6, 1.4, 1.8, { block: true }),
  Rect('bed', 5.0, 2.6, 6.6, 3.5), Rect('bed', 13.0, -3.8, 14.8, -3.0), Rect('rug', 8.0, -0.9, 14.0, 0.6),
  Rect('mapTable', 19.0, 8.9, 21.0, 10.0, { block: true }), Rect('shelf', 17.2, 12.4, 22.8, 12.95, { block: true }),
  Rect('sofa', 25.0, 8.6, 27.4, 9.4, { block: true }), ...[29.25, 30.8, 32.3, 33.8].map(x => Rect('toilet', x - 0.3, 7.6, x + 0.3, 8.3)),
  Rect('sink', 18.4, 4.6, 19.6, 5.5), Rect('sink', 21.4, 3.9, 22.4, 4.9), Rect('lamp', 23.3, -2.5, 23.8, -2.0),
  Rect('pipe', 26.0, -3.4, 26.4, 2.2), Rect('pipe', 29.1, -3.4, 29.5, 2.2),
  Rect('crate', 32.0, -3.6, 33.6, -2.2, { block: true }), Rect('crate', 34.2, 0.2, 35.6, 1.6, { block: true }), Rect('boxes', 37.0, 1.6, 38.8, 3.2, { block: true }), Rect('crate', 37.83, -3.12, 39.4, -1.95, { block: true }),
  Rect('bed', 22.4, -9.0, 24.0, -8.0), Rect('bed', 25.0, -9.0, 26.6, -8.0), Rect('bed', 27.6, -9.0, 29.2, -8.0), Rect('console', 22.4, -5.6, 24.2, -5.05, { block: true }),
  Rect('monitor', 5.0, -9.2, 7.8, -8.7), Rect('chair', 6.2, -10.0, 6.7, -9.5),
  Rect('rug', -0.4, -14.6, 3.2, -11.0), Rect('panel', 9.9, -4.85, 11.6, -4.6), Rect('panel', 15.4, -4.85, 17.6, -4.6),
];

const tasks = [
  { id: 'wires', name: '배선 수리하기', kind: 'common', game: 'wires', pick: 3, pool: ['w_engine', 'w_view', 'w_main', 'w_showers', 'w_cargo', 'w_lounge', 'w_meeting'] },
  { id: 'idcode', name: 'ID 코드 입력하기', kind: 'common', game: 'idcode', seq: ['idcode'] },
  { id: 'calib', name: '배전기 보정하기', kind: 'long', game: 'calib', seq: ['calib'] },
  { id: 'breakers', name: '차단기 재설정하기', kind: 'long', seq: ['br1', 'br2', 'br4', 'br5', 'br6', 'br3', 'br7'], games: ['lever', 'lever', 'lever', 'lever', 'lever', 'lever', 'lever'],
    labels: ['차단기 1', '차단기 2', '차단기 3', '차단기 4', '차단기 5', '차단기 6', '차단기 7'] },
  { id: 'upload', name: '데이터 업로드하기', kind: 'long', seq: [{ pool: ['dl_records', 'dl_lounge', 'dl_medical', 'dl_cockpit', 'dl_armory'] }, { pool: ['ul_left', 'ul_right'] }], games: ['download', 'upload'], labels: ['데이터 다운로드하기', '데이터 업로드하기'] },
  { id: 'safe', name: '금고 열기', kind: 'long', game: 'dial', seq: ['safe'], params: { label: '다이얼을 돌려 금고를 여세요' } },
  { id: 'fans', name: '환풍기 가동하기', kind: 'long', game: 'idcode', seq: ['fans'], params: { label: '환풍기 코드를 입력하세요' } },
  { id: 'garbage', name: '쓰레기 비우기', kind: 'long', seq: [{ pool: ['garb_main', 'garb_medical', 'garb_lounge'] }, 'garb_out'], games: ['hold', 'garbage'], labels: ['쓰레기 봉투 챙기기', '쓰레기 비우기'] },
  { id: 'photos', name: '사진 현상하기', kind: 'long', seq: ['photos', 'photos'], games: ['inspect_start', 'inspect_result'], labels: ['사진 현상 시작', '사진 꺼내기'] },
  { id: 'fuel', name: '엔진 연료 공급하기', kind: 'long', seq: ['fuel_can', 'fuel_engine'], games: ['fuel_fill', 'fuel_empty'], labels: ['연료통 채우기', '엔진에 연료 넣기'] },
  { id: 'tapes', name: '테이프 되감기', kind: 'long', game: 'wait', seq: ['tapes'], params: { seconds: 20, label: '테이프를 되감는 중…' } },
  { id: 'ruby', name: '루비 닦기', kind: 'short', game: 'clean', seq: ['ruby'], params: { icon: '💎', label: '루비를 문질러 닦으세요' } },
  { id: 'steering', name: '조종 장치 안정화하기', kind: 'short', game: 'steer', seq: ['steering'] },
  { id: 'divert', name: '전력 전환하기', kind: 'short', seq: ['divert', { pool: ['acc_meeting', 'acc_gap', 'acc_records', 'acc_lounge', 'acc_engine', 'acc_vault', 'acc_cockpit', 'acc_armory'] }], games: ['divert', 'accept_power'], labels: ['전력 전환하기', '전환된 전력 받기'] },
  { id: 'towels', name: '수건 줍기', kind: 'short', game: 'find', seq: ['towels'], params: { label: '바닥에 떨어진 수건을 찾으세요' } },
  { id: 'toilet', name: '변기 청소하기', kind: 'short', game: 'clean', seq: [{ pool: ['toilet0', 'toilet1', 'toilet2', 'toilet3'] }], params: { icon: '🚽', label: '변기를 문질러 닦으세요' } },
  { id: 'mannequin', name: '마네킹 옷 입히기', kind: 'short', game: 'match', seq: ['mannequin'] },
  { id: 'records', name: '기록 정리하기', kind: 'short', game: 'sort', seq: ['records_sort'], params: { groups: ['📕', '📗', '📘'], label: '같은 색 파일끼리 정리하세요' } },
  { id: 'pistols', name: '권총 정리하기', kind: 'short', game: 'drag', seq: ['pistols'], params: { label: '권총을 보관함으로 옮기세요' } },
  { id: 'rifles', name: '소총 정리하기', kind: 'short', game: 'drag', seq: ['rifles'], params: { label: '소총을 보관함으로 옮기세요' } },
  { id: 'decon', name: '소독하기', kind: 'short', game: 'hold', seq: ['decon'], params: { seconds: 3, icon: '🧴', label: '버튼을 눌러 소독하세요' } },
  { id: 'burger', name: '햄버거 만들기', kind: 'short', game: 'sequence', seq: ['burger'] },
  { id: 'shower', name: '샤워기 고치기', kind: 'short', game: 'tap', seq: ['shower'], params: { icon: '🔧', label: '고장 난 부분을 모두 누르세요' } },
  { id: 'ventclean', name: '환풍구 청소하기', kind: 'short', game: 'vent_clean', seq: [{ pool: Object.keys(vents).map(v => 'vc_' + v.slice(2)) }] },
];
for (const v of Object.keys(vents)) st['vc_' + v.slice(2)] = { x: vents[v].x + 80, y: vents[v].y - 40 };

const sabotages = {
  crash: { name: '추락 경로 회피', type: 'critical', time: 90, game: 'crash', fix: { crash1: 'p1', crash2: 'p2' }, room: 'gap_r' },
  lights: { name: '조명 고장', type: 'lights', game: 'lights', fix: { lights_cargo: 'l', lights_gap: 'l', lights_view: 'l' }, room: 'cargo' },
  comms: { name: '통신 방해', type: 'comms', game: 'comms', fix: { comms: 'c' }, room: 'comms' },
};

// 게임 시작·회의 뒤 고르는 출발 위치
const spawnPoints = [
  { name: '메인 홀', ...P(10.8, 0.0) }, { name: '감옥', ...P(-0.4, 10.0) }, { name: '엔진실', ...P(-1.5, -1.0) },
  { name: '주방', ...P(-5.0, -11.5) }, { name: '기록실', ...P(20.0, 7.3) }, { name: '화물칸', ...P(34.3, -1.7) },
];

const button = P(10.8, 15.1);
export default {
  id: 'airship', name: 'THE AIRSHIP', ko: '에어십', w: X(41), h: Y(-18),
  theme: { outside: 'sky', wall: '#5a4a3c', wallTop: '#7d6a58', wallFace: '#69584a' },
  rooms, halls, props, stations: st, vents, ventGroups, doors, doorMode: 'manual', doorGame: 'door_panel', transports, tasks, sabotages, button,
  cams: { station: 'cams', single: true, views: [
    { name: '엔진실', ...P(-2.0, 0.0) }, { name: '금고', ...P(-8.7, 8.0) }, { name: '기록실', ...P(20.0, 9.5) },
    { name: '보안실', ...P(7.0, -11.0) }, { name: '화물칸', ...P(35.0, -1.5) }, { name: '회의실', ...P(10.2, 15.5) }] },
  admin: 'admin', vitals: 'vitals', doorlog: null, spawnPoints,
  spawn: { ...P(10.8, 0.0), rx: 400, ry: 120 }, meetingSpawn: { ...P(10.8, 0.0), rx: 400, ry: 120 },
};
