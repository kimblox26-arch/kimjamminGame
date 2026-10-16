// MIRA HQ — 원작 월드 좌표(유니티 단위)를 K배 확대. y 는 위가 +이므로 뒤집음.
// 문 사보타주 없음 · 소독실(자동문 이동) · 환풍구 하나로 연결 · 문 기록(센서 3개) · 관리실 지도
const K = 165, X0 = -12, Y0 = 26;
const X = x => Math.round((x - X0) * K), Y = y => Math.round((Y0 - y) * K);
const B = (x1, y1, x2, y2) => [[X(x1), Y(y2)], [X(x2), Y(y2)], [X(x2), Y(y1)], [X(x1), Y(y1)]];
const Pg = pts => pts.map(([x, y]) => [X(x), Y(y)]);
const P = (x, y) => ({ x: X(x), y: Y(y) });
const Rect = (kind, x1, y1, x2, y2, o = {}) => ({ kind, x: X(x1), y: Y(y2), w: (x2 - x1) * K, h: (y2 - y1) * K, ...o });
const Circ = (kind, x, y, r, o = {}) => ({ kind, ...P(x, y), r: r * K, ...o });

const rooms = [
  ['launchpad', '발사대', B(-6.7, -2.6, -2.4, 4.1), 'ship'],
  ['locker', '탈의실', Pg([[3.74, 0.07], [10.9, 0.07], [10.9, 5.66], [8.31, 5.66], [8.31, 2.16], [3.74, 2.16]]), 'tile'],
  ['decon', '소독실', B(5.0, 2.75, 7.2, 9.3), 'white'],
  ['reactor', '원자로', B(0.0, 9.6, 4.5, 15.2), 'reactor'],
  ['laboratory', '실험실', B(7.75, 9.6, 12.27, 14.8), 'lab'],
  ['medbay', '의무실', B(13.7, -2.26, 17.17, 1.7), 'med'],
  ['comms', '통신실', B(13.7, 2.42, 17.16, 5.2), 'metal'],
  ['office', '사무실', B(12.72, 16.51, 16.15, 21.04), 'carpet'],
  ['admin', '관리실', B(19.55, 15.96, 22.85, 21.09), 'admin'],
  ['greenhouse', '온실', Pg([[12.5, 21.65], [23.1, 21.65], [23.1, 23.9], [21.5, 25.4], [19.2, 25.75], [16.6, 25.75], [14.1, 25.4], [12.5, 23.9]]), 'greenhouse'],
  ['storage', '창고', B(17.9, 1.05, 21.1, 5.8), 'storage'],
  ['cafeteria', '식당', Pg([[17.9, -0.66], [29.39, -0.66], [29.39, 5.63], [21.6, 5.63], [21.6, 0.5], [17.9, 0.5]]), 'cafe'],
  ['balcony', '발코니', B(17.84, -3.79, 29.38, -1.4), 'ship'],
].map(([id, name, poly, floor]) => ({ id, name, poly, floor }));

const halls = [
  B(-2.6, -2.6, 13.2, -0.7),                    // 발사대–의무실 아래 복도
  B(11.4, -2.6, 13.2, 6.0),                     // 서쪽 세로 복도
  B(10.8, 3.42, 11.5, 4.51), B(13.1, -0.39, 13.8, 0.69), B(13.1, 3.42, 13.8, 4.5), // 탈의실·의무실·통신실 문
  Pg([[11.4, 5.8], [13.2, 5.8], [19.0, 11.6], [16.7, 11.6]]),   // Y 복도 왼팔
  Pg([[21.5, 6.1], [23.9, 6.1], [19.0, 11.6], [16.7, 11.6]]),   // Y 복도 오른팔
  B(16.7, 11.0, 19.0, 21.2),                    // 북쪽 줄기 + 북쪽 복도
  B(21.5, 6.1, 24.7, 7.9), B(22.1, 5.5, 24.4, 6.2), // 식당 위 복도 + 식당 북쪽 입구
  B(16.1, 16.77, 16.8, 17.77), B(18.9, 18.36, 19.6, 19.37), B(17.29, 21.0, 18.4, 21.8), // 사무실·관리실·온실 입구
  B(5.0, 9.85, 7.2, 14.6),                      // 원자로/실험실 연결 복도
  B(4.4, 9.7, 5.1, 10.8), B(7.1, 13.3, 7.8, 14.2), // 원자로·실험실 입구
  B(18.94, 0.4, 20.1, 1.1),                     // 창고 문
  B(20.9, -1.5, 23.2, -0.55), B(24.4, -1.5, 26.7, -0.55), // 발코니 입구 2개
].map(poly => ({ poly, floor: 'hall' }));

const st = {
  // 임무
  idcode: P(19.89, 19.02), chart: P(22.23, 20.7), shields: P(21.17, 17.6),
  w_storage: P(18.39, 1.4), w_hall: P(12.1, 6.6), w_locker: P(4.36, 1.9), w_green: P(16.98, 22.0), w_lab: P(6.13, 14.3),
  scan: P(16.23, 0.26), asteroids: P(19.21, -2.41), divert: P(0.78, 11.48), reactor_start: P(2.55, 12.41), manifolds: P(0.44, 13.26),
  acc_admin: P(20.28, 20.8), acc_cafe: P(21.9, 5.3), acc_comms: P(14.0, 4.9), acc_launch: P(-6.33, 0.92), acc_med: P(14.83, 1.4),
  acc_office: P(16.0, 20.01), acc_green: P(13.85, 22.87), acc_lab: P(7.95, 14.4),
  water_can: P(19.62, 5.2), water_plants: P(20.49, 22.52), diag: P(-2.9, 1.87), fuel_can: P(-6.3, 2.26), fuel_rocket: P(-6.3, 3.7),
  o2filter: P(17.22, 24.51), artifact: P(9.4, 14.3), samples: P(9.66, 12.0), garbage: P(25.35, 5.3), weather: P(28.91, -1.9),
  vending: P(27.49, 4.8), process: P(15.78, 20.7),
  // 사보타주 수리
  hand1: P(0.7, 14.8), hand2: P(4.2, 14.8), o2k_green: P(17.86, 24.37), o2k_hall: P(4.09, -0.85), lights: P(14.8, 20.8),
  comms_k1: P(14.93, 4.9), comms_k2: P(13.2, 19.35),
  // 장비
  admin: P(21.02, 19.1), doorlog: P(16.22, 4.9), laptop: P(26.65, 2.9),
};

const vents = {
  v_balcony: P(23.77, -1.94), v_yhall: P(23.9, 7.18), v_reactor: P(0.48, 10.2), v_lab: P(11.61, 13.82), v_office: P(13.28, 20.13),
  v_admin: P(22.39, 17.0), v_green: P(17.85, 24.9), v_med: P(15.41, -1.82), v_decon_hall: P(6.1, 11.2), v_locker: P(4.29, 0.6), v_launch: P(-6.0, 3.56),
};
// 원작: 하나의 네트워크(모든 벤트 서로 도달 가능)
const L = (id, ...to) => (vents[id].links = to);
L('v_balcony', 'v_med', 'v_yhall'); L('v_yhall', 'v_admin', 'v_balcony'); L('v_reactor', 'v_lab', 'v_decon_hall', 'v_launch');
L('v_lab', 'v_reactor', 'v_decon_hall', 'v_office'); L('v_office', 'v_lab', 'v_admin', 'v_green'); L('v_admin', 'v_green', 'v_yhall', 'v_office');
L('v_green', 'v_admin', 'v_office'); L('v_med', 'v_balcony', 'v_locker'); L('v_decon_hall', 'v_reactor', 'v_locker', 'v_lab');
L('v_locker', 'v_med', 'v_launch', 'v_decon_hall'); L('v_launch', 'v_reactor', 'v_locker');

// 소독실: 문 → 3초 소독 → 반대쪽 문. (이동수단 kind 'decon')
const transports = [{ id: 'decon', kind: 'decon', name: '소독실', a: P(6.1, 1.25), b: P(6.1, 10.45), time: 6 }];

const props = [
  Rect('longTable', 23.36, 0.93, 24.72, 3.81, { block: true }), Rect('longTable', 26.22, 0.93, 27.58, 3.81, { block: true }),
  Rect('vending', 27.0, 5.0, 28.75, 5.63, { block: true }),
  Rect('mapTable', 19.95, 18.1, 21.95, 19.75, { block: true }),
  Rect('desk', 8.13, 10.61, 10.53, 11.48, { block: true, color: '#e6e9ec' }), Rect('desk', 10.6, 10.5, 12.0, 12.6, { block: true, color: '#e6e9ec' }),
  Rect('reactorCore', 1.75, 11.81, 3.22, 12.9, { block: true }),
  Rect('bed', 13.9, 0.9, 15.2, 1.6), Rect('bed', 15.7, 0.9, 17.0, 1.6), Rect('bed', 14.4, -1.6, 15.9, -0.9),
  Rect('desk', 12.97, 17.03, 14.44, 18.26, { block: true, color: '#a37b55' }), Rect('desk', 12.9, 18.84, 14.3, 19.5, { block: true, color: '#a37b55' }),
  Rect('rug', 13.0, 16.7, 15.9, 20.8), Rect('chair', 14.0, 18.4, 14.5, 18.8),
  Rect('plant', 13.4, 22.4, 16.4, 22.8, { block: true }), Rect('plant', 19.2, 22.4, 22.4, 22.8, { block: true }),
  Rect('plant', 14.3, 23.4, 16.6, 24.4, { block: true }), Rect('plant', 19.1, 23.4, 21.6, 24.4, { block: true }), Circ('tree', 17.85, 23.6, 0.5, { block: true }),
  Rect('boxes', 19.9, 3.0, 21.0, 4.0, { block: true }), Rect('shelf', 18.0, 5.0, 19.2, 5.7, { block: true }),
  Rect('locker', 3.8, 1.6, 4.9, 2.15, { block: true }), Rect('locker', 9.0, 5.1, 10.8, 5.65, { block: true }), Rect('sink', 9.4, 0.15, 10.4, 0.6),
  Rect('gate', 5.0, 2.45, 7.2, 3.0, { block: true }), Rect('gate', 5.0, 9.1, 7.2, 9.65, { block: true }),
  Rect('console', 14.4, 4.6, 16.6, 5.15, { block: true }), Rect('monitor', 14.6, 2.5, 15.6, 3.0),
  Rect('cannon', 18.0, -3.6, 19.0, -2.6), Rect('fence', 17.84, -3.79, 29.38, -3.6), Rect('console', 28.4, -3.4, 29.3, -2.6, { block: true }),
  Rect('engine', -6.7, 2.9, -5.0, 4.1, { block: true }), Rect('barrel', -6.6, 1.7, -6.0, 2.3, { block: true }), Rect('console', -3.6, 1.6, -2.5, 2.2, { block: true }),
  Rect('panel', 0.2, 14.9, 4.3, 15.2), Rect('pipe', 0.1, 10.5, 0.4, 14.0),
  Rect('window', 17.84, -1.45, 29.38, -1.4), Rect('window', 21.0, 25.6, 24.5, 25.75),
];

const tasks = [
  { id: 'idcode', name: 'ID 코드 입력하기', kind: 'common', game: 'idcode', seq: ['idcode'] },
  { id: 'wires', name: '배선 수리하기', kind: 'common', game: 'wires', pick: 3, pool: ['w_storage', 'w_hall', 'w_locker', 'w_green', 'w_lab'] },
  { id: 'scan', name: '스캔 제출하기', kind: 'long', game: 'scan', seq: ['scan'], visual: true },
  { id: 'asteroids', name: '소행성 파괴하기', kind: 'long', game: 'asteroids', seq: ['asteroids'] },
  { id: 'divert', name: '전력 전환하기', kind: 'long', seq: ['divert', { pool: ['acc_admin', 'acc_cafe', 'acc_comms', 'acc_launch', 'acc_med', 'acc_office', 'acc_green', 'acc_lab'] }],
    games: ['divert', 'accept_power'], labels: ['전력 전환하기', '전환된 전력 받기'] },
  { id: 'water', name: '식물에 물 주기', kind: 'long', seq: ['water_can', 'water_plants'], games: ['hold', 'fill'], labels: ['물뿌리개 챙기기', '식물에 물 주기'] },
  { id: 'reactor', name: '원자로 가동하기', kind: 'long', game: 'simon', seq: ['reactor_start'] },
  { id: 'diag', name: '진단 실행하기', kind: 'short', seq: ['diag', 'diag'], games: ['inspect_start', 'inspect_result'], labels: ['진단 시작', '진단 결과 확인'] },
  { id: 'chart', name: '항로 계획하기', kind: 'short', game: 'chart', seq: ['chart'] },
  { id: 'o2', name: '산소 필터 청소', kind: 'short', game: 'leaves', seq: ['o2filter'] },
  { id: 'fuel', name: '엔진 연료 공급하기', kind: 'short', seq: ['fuel_can', 'fuel_rocket'], games: ['fuel_fill', 'fuel_empty'], labels: ['연료통 채우기', '로켓에 연료 넣기'] },
  { id: 'artifact', name: '유물 복원하기', kind: 'short', game: 'drag', seq: ['artifact'], params: { label: '유물 조각을 받침대로 옮기세요' } },
  { id: 'samples', name: '표본 분류하기', kind: 'short', game: 'sort', seq: ['samples'], params: { groups: ['🦴', '🪨', '💎'], label: '표본을 종류별로 나누세요' } },
  { id: 'shields', name: '보호막 준비하기', kind: 'short', game: 'shields', seq: ['shields'] },
  { id: 'garbage', name: '쓰레기 비우기', kind: 'short', game: 'garbage', seq: ['garbage'] },
  { id: 'weather', name: '기후 측정하기', kind: 'short', game: 'wait', seq: ['weather'], params: { seconds: 6, label: '기상 데이터를 측정하는 중…' } },
  { id: 'beverage', name: '음료 구매하기', kind: 'short', game: 'idcode', seq: ['vending'], params: { label: '쪽지에 적힌 음료 코드를 누르세요' } },
  { id: 'process', name: '데이터 처리하기', kind: 'short', game: 'download', seq: ['process'], params: { label: '데이터 처리' } },
  { id: 'manifolds', name: '매니폴드 잠금 해제하기', kind: 'short', game: 'numbers', seq: ['manifolds'] },
  { id: 'ventclean', name: '환풍구 청소하기', kind: 'short', game: 'vent_clean', seq: [{ pool: Object.keys(vents).map(v => 'vc_' + v.slice(2)) }] },
];
for (const v of Object.keys(vents)) st['vc_' + v.slice(2)] = { x: vents[v].x + 90, y: vents[v].y - 40 };

const sabotages = {
  reactor: { name: '원자로 멜트다운', type: 'critical', time: 45, game: 'hand', together: true, fix: { hand1: 'h1', hand2: 'h2' }, room: 'reactor' },
  o2: { name: '산소 고갈', type: 'critical', time: 45, game: 'keypad', fix: { o2k_green: 'k1', o2k_hall: 'k2' }, room: 'greenhouse' },
  lights: { name: '조명 고장', type: 'lights', game: 'lights', fix: { lights: 'l' }, room: 'office' },
  comms: { name: '통신 방해', type: 'comms', game: 'comms_code', fix: { comms_k1: 'c1', comms_k2: 'c2' }, room: 'comms', window: 10 },
};

// 문 기록 센서
const sensors = [
  { id: 'n', name: '북쪽', x: X(16.7), y: Y(16.0), w: 2.3 * K, h: 0.5 * K },
  { id: 'se', name: '남동쪽', ...P(22.0, 7.4), r: 0.8 * K },
  { id: 'sw', name: '남서쪽', ...P(13.6, 7.4), r: 0.8 * K },
];

const button = P(24.04, 2.4);
export default {
  id: 'mira', name: 'MIRA HQ', ko: '미라 HQ', w: X(30.5), h: Y(-4.5),
  theme: { outside: 'sky', wall: '#4a5560', wallTop: '#6c7a86', wallFace: '#56626d' },
  rooms, halls, props, stations: st, vents, doors: [], doorMode: 'auto', transports, sensors, tasks, sabotages, button,
  cams: null, admin: 'admin', vitals: null, doorlog: 'doorlog',
  spawn: { ...P(-4.4, 1.0), rx: 230, ry: 230 }, meetingSpawn: { ...P(24.04, 2.4), rx: 330, ry: 300 },
};
