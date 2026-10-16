// POLUS — 원작 월드 좌표(유니티 단위, y 위가 +)를 K배 확대. 건물 사이 야외(눈밭)는
// 구역 사각형에서 건물 자리(벽 두께만큼 띄움)를 격자로 빼서 자동으로 만든다.
import { inPoly } from './geom.js';

const K = 165, X0 = -0.5, Y0 = 3.0;
const X = x => Math.round((x - X0) * K), Y = y => Math.round((Y0 - y) * K);
const B = (x1, y1, x2, y2) => [[X(x1), Y(y2)], [X(x2), Y(y2)], [X(x2), Y(y1)], [X(x1), Y(y1)]];
const Pg = pts => pts.map(([x, y]) => [X(x), Y(y)]);
const P = (x, y) => ({ x: X(x), y: Y(y) });
const Rect = (kind, x1, y1, x2, y2, o = {}) => ({ kind, x: X(x1), y: Y(y2), w: (x2 - x1) * K, h: (y2 - y1) * K, ...o });
const Circ = (kind, x, y, r, o = {}) => ({ kind, ...P(x, y), r: r * K, ...o });
const D = (id, room, x1, y1, x2, y2) => ({ id, room, x: X(x1), y: Y(y2), w: (x2 - x1) * K, h: (y2 - y1) * K });

const rooms = [
  ['dropship', '수송선', Pg([[14.0, -5.6], [14.0, 1.0], [15.0, 1.9], [18.2, 1.9], [19.2, 1.0], [19.2, -5.6]]), 'ship'],
  ['electrical', '전기실', Pg([[1.5, -8.6], [11.2, -8.6], [11.2, -11.0], [6.5, -11.0], [6.5, -13.4], [4.7, -13.4], [4.7, -11.0], [1.5, -11.0]]), 'elec'],
  ['breaker', '전기실', B(7.0, -13.8, 11.2, -11.5), 'elec'],
  ['security', '보안실', B(1.5, -13.0, 4.2, -11.5), 'metal'],
  ['o2', '산소 공급실', Pg([[0.2, -14.7], [4.3, -14.7], [4.3, -18.6], [7.0, -18.6], [7.0, -22.2], [4.3, -22.2], [4.3, -23.05], [0.2, -23.05]]), 'greenhouse'],
  ['boiler', '보일러실', B(0.3, -25.0, 4.3, -23.0), 'eng'],
  ['comms', '통신실', B(10.2, -19.3, 13.2, -15.5), 'metal'],
  ['weapons', '무기고', B(9.6, -25.6, 14.2, -21.2), 'metal'],
  ['storage', '창고', B(17.6, -13.5, 22.6, -10.6), 'storage'],
  ['office', '사무실', B(15.9, -18.6, 28.5, -15.95), 'wood'],
  ['admin', '관리실', Pg([[19.7, -20.55], [25.5, -20.55], [25.5, -23.4], [22.6, -23.4], [22.6, -26.4], [19.7, -26.4]]), 'admin'],
  ['decon_low', '하부 소독실', B(22.95, -25.7, 25.4, -23.9), 'white'],
  ['specimen', '표본 보관실', Pg([[34.6, -18.0], [38.5, -18.0], [39.5, -19.2], [39.5, -21.4], [38.5, -22.5], [34.6, -22.5], [33.6, -21.4], [33.6, -19.2]]), 'lab'],
  ['decon_up', '상부 소독실', B(38.3, -11.5, 40.9, -9.5), 'white'],
  ['lab', '실험실', B(24.8, -9.0, 41.1, -4.8), 'lab'],
  ['lab_s', '실험실', B(24.8, -11.5, 35.4, -9.55), 'tile'],
].map(([id, name, poly, floor]) => ({ id, name, poly, floor }));

// 건물 안 통로
const inner = [
  B(4.9, -18.0, 6.3, -13.9),                     // 전기실 ↔ 산소 통로(튜브)
  B(16.0, -20.6, 23.1, -18.5), B(17.5, -23.3, 19.75, -20.5), // 사무실 → 관리실 복도, 서쪽 홀
  B(25.9, -25.3, 32.2, -23.9), B(30.9, -25.3, 32.2, -20.2), B(31.0, -21.5, 33.9, -20.2), // 하부 통로 → 표본실
  B(38.2, -18.6, 39.6, -12.0),                   // 상부 통로 → 표본실
];
// 문/입구 (벽 틈을 잇는 짧은 통로)
const doorways = [
  B(15.9, -6.4, 17.4, -5.4),                     // 수송선 경사로
  B(11.0, -10.0, 11.9, -8.9), B(7.0, -11.6, 8.0, -10.9), B(4.9, -13.95, 6.3, -13.35), B(2.3, -11.6, 3.6, -10.9), // 전기실 문들 + 보안실 입구
  B(4.9, -18.7, 6.3, -17.9), B(5.3, -23.4, 6.5, -22.1), // 산소 위/아래 문
  B(10.4, -19.9, 11.4, -19.2), B(12.4, -21.4, 13.6, -20.6), B(16.9, -11.5, 17.8, -10.7), // 통신실·무기고·창고 문
  B(28.3, -17.6, 29.2, -16.5), B(16.8, -22.3, 17.7, -21.2), // 사무실 동쪽 문, 서쪽 홀 문
  B(24.2, -10.1, 25.0, -9.0), B(26.0, -9.7, 27.2, -8.9), B(30.6, -9.7, 31.8, -8.9), // 실험실 문들 + 안쪽 입구
];
// 다리(지반 안정 장치)
const bridges = [B(2.6, -8.1, 6.2, -3.4), B(23.15, -6.7, 24.85, -2.4)];

// 야외 구역 (건물 자리는 아래에서 빼냄)
const zones = [
  [5.4, -9.0, 23.8, -1.5], [11.6, -15.5, 24.5, -9.0], [24.5, -15.7, 31.0, -12.0], [28.3, -17.4, 31.0, -15.5],
  [13.2, -23.4, 17.2, -15.5], [6.7, -23.4, 10.2, -14.2], [6.7, -15.4, 13.2, -14.2], [4.5, -26.5, 19.2, -23.0], [24.0, -12.0, 25.6, -9.0], [6.7, -23.4, 17.2, -19.3],
];
const solid = [...rooms.map(r => r.poly), ...inner];
const GAP = 0.45, CELL = 0.25;
function outdoor() {
  const x0 = 0, x1 = 42, y0 = -27, y1 = 2.5, nx = Math.round((x1 - x0) / CELL), ny = Math.round((y1 - y0) / CELL);
  const ok = (x, y) => zones.some(([a, b, c, d]) => x > a && x < c && y > b && y < d) &&
    ![-GAP, 0, GAP].some(dx => [-GAP, 0, GAP].some(dy => solid.some(p => inPoly(X(x + dx), Y(y + dy), p))));
  const runs = [];
  for (let j = 0; j < ny; j++) {
    const y = y0 + (j + 0.5) * CELL, row = [];
    let s = -1;
    for (let i = 0; i <= nx; i++) {
      const on = i < nx && ok(x0 + (i + 0.5) * CELL, y);
      if (on && s < 0) s = i;
      if (!on && s >= 0) { row.push([s, i]); s = -1; }
    }
    runs.push(row);
  }
  // 같은 구간이 위아래로 이어지면 하나의 사각형으로 합침
  const out = [], open = new Map();
  for (let j = 0; j <= ny; j++) {
    const row = runs[j] || [], keys = new Set(row.map(r => r.join(',')));
    for (const [k, r] of open) if (!keys.has(k)) { out.push(r); open.delete(k); }
    for (const [a, b] of row) { const k = a + ',' + b; if (open.has(k)) open.get(k).j1 = j; else open.set(k, { a, b, j0: j, j1: j }); }
  }
  return out.map(r => ({ poly: B(x0 + r.a * CELL, y0 + r.j0 * CELL, x0 + r.b * CELL, y0 + (r.j1 + 1) * CELL), floor: 'snow' }));
}

const halls = [...inner.map(poly => ({ poly, floor: 'hall' })), ...doorways.map(poly => ({ poly, floor: 'hall' })), ...bridges.map(poly => ({ poly, floor: 'metal' })), ...outdoor()];

const st = {
  // 공통
  card: P(24.82, -16.6), keys: P(17.38, 0.9), pass: P(25.75, -16.5),
  w_elec: P(3.07, -9.1), w_o2: P(6.5, -19.0), w_office: P(16.6, -18.3), w_shower: P(40.61, -8.6), w_lab: P(37.33, -8.6), w_bath: P(32.98, -9.95),
  // 긴 임무
  dl_elec: P(6.57, -9.1), dl_o2: P(2.86, -15.2), dl_office: P(27.74, -16.4), dl_weapons: P(13.95, -21.8), dl_specimen: P(37.74, -18.6), ul_comms: P(11.72, -15.9),
  reactor_start: P(34.76, -18.88), fuel_can: P(21.07, -11.3), fuel_right: P(22.03, -6.25), fuel_left: P(11.36, -6.17),
  wheel1: P(0.94, -24.15), wheel2: P(3.67, -24.15), wheel3: P(18.42, -23.72), inspect: P(36.53, -5.6),
  jug_fill: P(1.16, -23.4), jug_cooler: P(16.77, -16.4),
  node_ca: P(23.03, -7.24), node_tb: P(8.36, -15.76), node_iro: P(7.15, -25.66), node_pd: P(14.95, -25.74), node_gi: P(14.47, -12.47), node_mlg: P(30.85, -12.53),
  weather_lab: P(29.42, -6.8), wifi: P(11.05, -15.9),
  // 짧은 임무
  tree: P(1.65, -16.01), canisters: P(1.14, -19.53), garbage: P(5.04, -20.65), chart: P(15.97, 0.9), scan: P(40.33, -7.08), asteroids: P(9.95, -22.4),
  manifolds: P(34.39, -19.47), artifacts: P(36.48, -19.4), telescope: P(33.87, -5.47), drill: P(27.42, -6.98), temp_cold: P(31.34, -6.67), temp_hot: P(30.92, -15.32),
  // 사보타주
  hand1: P(4.67, -3.77), hand2: P(24.21, -2.74), lights: P(9.72, -11.6), comms: P(13.69, -15.9),
  // 장비
  admin: P(23.9, -21.6), cams: P(2.96, -12.4), vitals: P(26.69, -16.4), laptop: P(20.8, -16.94),
};

const vents = {
  v_elec: P(1.93, -9.56), v_fence: P(6.9, -14.55), v_o2: P(3.51, -16.58),
  v_comms: P(12.3, -18.9), v_office: P(16.6, -19.6), v_storage: P(22.0, -12.19),
  v_elecb: P(9.64, -7.72), v_science: P(24.02, -8.39),
  v_bath: P(32.96, -10.5), v_subbath: P(30.4, -12.6), v_admin: P(20.3, -25.52), v_south: P(18.6, -24.85),
};
const ventGroups = [['v_elec', 'v_fence', 'v_o2'], ['v_comms', 'v_office', 'v_storage'], ['v_elecb', 'v_science']];
vents.v_bath.links = ['v_subbath']; vents.v_subbath.links = ['v_bath', 'v_admin']; vents.v_admin.links = ['v_subbath', 'v_south']; vents.v_south.links = ['v_admin'];

// 문 사보타주 (폴루스: 플레이어가 차단기를 재설정해야 열림)
const doors = [
  D('elec_e', 'electrical', 11.25, -10.0, 11.65, -8.9), D('elec_in', 'electrical', 7.0, -11.45, 8.0, -11.05), D('elec_b', 'electrical', 4.9, -13.85, 6.3, -13.45),
  D('o2_t', 'o2', 4.9, -18.5, 6.3, -18.1), D('o2_b', 'o2', 5.3, -22.95, 6.5, -22.5),
  D('comms', 'comms', 10.4, -19.75, 11.4, -19.35), D('weapons', 'weapons', 12.4, -21.15, 13.6, -20.75), D('storage', 'storage', 17.05, -11.5, 17.45, -10.7),
  D('office_e', 'office', 28.6, -17.6, 29.0, -16.5), D('office_w', 'office', 17.0, -22.3, 17.4, -21.2),
  D('lab_w', 'lab', 24.35, -10.1, 24.75, -9.0), D('lab_in', 'lab', 26.0, -9.5, 27.2, -9.1),
];

// 소독실: 이동수단(kind decon)
const transports = [
  { id: 'decon_low', kind: 'decon', name: '하부 소독실', a: P(24.2, -22.9), b: P(26.3, -25.2), time: 6 },
  { id: 'decon_up', kind: 'decon', name: '상부 소독실', a: P(37.6, -8.5), b: P(39.3, -12.6), time: 6 },
];

const props = [
  Rect('boxes', 12.3, -8.0, 14.04, -6.0, { block: true }), Rect('boxes', 19.24, -8.35, 21.15, -6.08, { block: true }), Rect('crate', 15.96, -10.98, 17.16, -10.12, { block: true }),
  Rect('rock', 24.72, -14.14, 28.43, -13.29, { block: true }), Rect('rock', 32.3, -13.69, 34.28, -11.74, { block: true }), Rect('rock', 28.87, -18.9, 31.0, -17.43, { block: true }),
  Rect('lava', 31.0, -17.77, 34.87, -12.0),
  Rect('engine', 10.6, -5.6, 12.1, -4.2, { block: true }), Rect('engine', 21.3, -5.6, 22.8, -4.2, { block: true }),
  Rect('longTable', 17.71, -17.45, 21.4, -16.81, { block: true, color: '#b88a5a' }), Rect('monitor', 22.2, -16.4, 23.0, -16.0),
  Rect('mapTable', 23.0, -22.1, 24.8, -21.1, { block: true }), Rect('console', 1.6, -13.0, 4.3, -12.6, { block: true }),
  Rect('panel', 7.2, -11.7, 11.0, -11.5), Rect('boxes', 7.2, -13.6, 8.4, -12.7, { block: true }), Rect('boxes', 9.8, -13.6, 11.0, -12.7, { block: true }),
  Circ('tree', 2.2, -16.9, 0.75, { block: true }), Rect('barrel', 0.5, -20.6, 1.1, -19.9, { block: true }), Rect('barrel', 0.5, -21.6, 1.1, -20.9, { block: true }),
  Circ('engine', 1.6, -24.4, 0.45, { block: true }), Circ('engine', 3.0, -24.4, 0.45, { block: true }),
  Rect('cannon', 9.65, -24.6, 10.4, -23.6), Rect('desk', 34.8, -20.6, 36.4, -20.0, { block: true, color: '#d8e3ea' }),
  Rect('desk', 31.0, -7.4, 33.4, -6.5, { block: true, color: '#e6e9ec' }), Rect('toilet', 33.6, -10.6, 34.2, -9.9), Rect('scanner', 40.0, -7.4, 40.8, -6.7),
  Rect('gate', 22.95, -23.9, 25.4, -23.5, { block: true }), Rect('gate', 38.3, -9.5, 40.9, -9.1, { block: true }),
  Circ('statue', 17.8, -25.6, 0.3, { block: true, color: '#eef3f8' }), Circ('statue', 18.5, -25.7, 0.3, { block: true, color: '#eef3f8' }), Circ('statue', 12.4, -12.0, 0.3, { block: true, color: '#eef3f8' }), Circ('statue', 6.8, -16.4, 0.25, { block: true, color: '#eef3f8' }),
  Rect('fence', 4.5, -26.5, 19.2, -26.3),
];

const tasks = [
  { id: 'card', name: '카드 긁기', kind: 'common', game: 'card', seq: ['card'] },
  { id: 'keys', name: '열쇠 삽입하기', kind: 'common', game: 'rotate', seq: ['keys'], params: { label: '열쇠를 꽂고 돌리세요' } },
  { id: 'pass', name: '탑승권 스캔하기', kind: 'common', game: 'hold', seq: ['pass'], params: { seconds: 2, icon: '🎫', label: '탑승권을 스캐너에 대고 있으세요' } },
  { id: 'wires', name: '배선 수리하기', kind: 'common', game: 'wires', pick: 3, pool: ['w_elec', 'w_o2', 'w_office', 'w_shower', 'w_lab', 'w_bath'] },
  { id: 'upload', name: '데이터 업로드하기', kind: 'long', seq: [{ pool: ['dl_elec', 'dl_o2', 'dl_office', 'dl_weapons', 'dl_specimen'] }, 'ul_comms'], games: ['download', 'upload'], labels: ['데이터 다운로드하기', '데이터 업로드하기'] },
  { id: 'reactor', name: '원자로 가동하기', kind: 'long', game: 'simon', seq: ['reactor_start'] },
  { id: 'fuel', name: '엔진 연료 공급하기', kind: 'long', seq: ['fuel_can', 'fuel_right', 'fuel_can', 'fuel_left'], games: ['fuel_fill', 'fuel_empty', 'fuel_fill', 'fuel_empty'], labels: ['연료통 채우기', '오른쪽 엔진에 연료 넣기', '연료통 채우기', '왼쪽 엔진에 연료 넣기'] },
  { id: 'waterways', name: '수로 열기', kind: 'long', seq: ['wheel1', 'wheel2', 'wheel3'], games: ['dial', 'dial', 'dial'], labels: ['수로 밸브 돌리기 (1/3)', '수로 밸브 돌리기 (2/3)', '수로 밸브 돌리기 (3/3)'] },
  { id: 'inspect', name: '표본 조사하기', kind: 'long', seq: ['inspect', 'inspect'], games: ['inspect_start', 'inspect_result'] },
  { id: 'jug', name: '물통 교체하기', kind: 'long', seq: ['jug_fill', 'jug_cooler'], games: ['fill', 'drag'], labels: ['물통 채우기', '정수기 물통 교체하기'] },
  { id: 'weather', name: '날씨 노드 수리하기', kind: 'long', seq: [{ pool: ['node_tb', 'node_iro', 'node_pd', 'node_gi'] }, 'weather_lab'], games: ['sequence', 'switches'], labels: ['날씨 노드 수리하기', '날씨 노드 켜기'] },
  { id: 'wifi', name: 'Wi-Fi 재부팅하기', kind: 'long', seq: ['wifi', 'wifi'], games: ['wifi', 'wifi'], labels: ['Wi-Fi 끄기', 'Wi-Fi 다시 켜기'] },
  { id: 'tree', name: '나무 모니터링하기', kind: 'short', game: 'slider', seq: ['tree'] },
  { id: 'canisters', name: '산소통 채우기', kind: 'short', game: 'fill', seq: ['canisters'] },
  { id: 'garbage', name: '쓰레기 비우기', kind: 'short', game: 'garbage', seq: ['garbage'] },
  { id: 'chart', name: '항로 계획하기', kind: 'short', game: 'chart', seq: ['chart'] },
  { id: 'scan', name: '스캔 제출하기', kind: 'short', game: 'scan', seq: ['scan'], visual: true },
  { id: 'asteroids', name: '소행성 파괴하기', kind: 'short', game: 'asteroids', seq: ['asteroids'], visual: true },
  { id: 'manifolds', name: '매니폴드 잠금 해제하기', kind: 'short', game: 'numbers', seq: ['manifolds'] },
  { id: 'artifacts', name: '유물 보관하기', kind: 'short', game: 'match', seq: ['artifacts'] },
  { id: 'telescope', name: '망원경 조정하기', kind: 'short', game: 'find', seq: ['telescope'] },
  { id: 'drill', name: '드릴 수리하기', kind: 'short', game: 'tap', seq: ['drill'], params: { icon: '⚠️', label: '경고 표시를 모두 누르세요' } },
  { id: 'temp', name: '온도 기록하기', kind: 'short', game: 'calib', seq: [{ pool: ['temp_cold', 'temp_hot'] }] },
  { id: 'weather_s', name: '날씨 노드 수리하기 ', kind: 'short', seq: [{ pool: ['node_ca', 'node_mlg'] }, 'weather_lab'], games: ['sequence', 'switches'], labels: ['날씨 노드 수리하기', '날씨 노드 켜기'] },
];

const sabotages = {
  seismic: { name: '지반 안정 장치 초기화', type: 'critical', time: 60, game: 'hand', together: true, fix: { hand1: 'h1', hand2: 'h2' }, room: 'lab' },
  lights: { name: '조명 고장', type: 'lights', game: 'lights', fix: { lights: 'l' }, room: 'electrical' },
  comms: { name: '통신 방해', type: 'comms', game: 'comms', fix: { comms: 'c' }, room: 'comms' },
};

const button = P(19.5, -17.13);
export default {
  id: 'polus', name: 'POLUS', ko: '폴루스', w: X(42), h: Y(-27.5),
  theme: { outside: 'snow', wall: '#4b4f5c', wallTop: '#6f7586', wallFace: '#5a5f6e' },
  rooms, halls, props, stations: st, vents, ventGroups, doors, doorMode: 'manual', doorGame: 'door_switch', transports, tasks, sabotages, button,
  cams: { station: 'cams', single: true, views: [
    { name: '북서쪽', ...P(11.0, -7.6) }, { name: '중앙', ...P(14.8, -15.0) }, { name: '북동쪽', ...P(24.0, -10.6) },
    { name: '동쪽', ...P(29.8, -16.3) }, { name: '남쪽', ...P(16.2, -22.3) }, { name: '남서쪽', ...P(8.0, -22.0) }] },
  admin: 'admin', vitals: 'vitals', doorlog: null,
  spawn: { ...P(16.6, -2.4), rx: 200, ry: 200 }, meetingSpawn: { ...P(19.5, -17.13), rx: 420, ry: 230 },
};
