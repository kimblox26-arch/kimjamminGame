// THE FUNGLE — 원작 월드 좌표(유니티 단위, y 위가 +)를 K배 확대.
// 해변·정글·고원(야외)은 구역에서 건물 자리를 빼서 자동 생성. 사다리·짚라인 · 버섯 혼란 · 문은 두드려서 엶 · 망원경
import { carve } from './geom.js';

const K = 155, X0 = -26.5, Y0 = 16.5;
const X = x => Math.round((x - X0) * K), Y = y => Math.round((Y0 - y) * K);
const B = (x1, y1, x2, y2) => [[X(x1), Y(y2)], [X(x2), Y(y2)], [X(x2), Y(y1)], [X(x1), Y(y1)]];
const Pg = pts => pts.map(([x, y]) => [X(x), Y(y)]);
const P = (x, y) => ({ x: X(x), y: Y(y) });
const Rect = (kind, x1, y1, x2, y2, o = {}) => ({ kind, x: X(x1), y: Y(y2), w: (x2 - x1) * K, h: (y2 - y1) * K, ...o });
const Circ = (kind, x, y, r, o = {}) => ({ kind, ...P(x, y), r: r * K, ...o });
const D = (id, room, x1, y1, x2, y2) => ({ id, room, x: X(x1), y: Y(y2), w: (x2 - x1) * K, h: (y2 - y1) * K });

const rooms = [
  ['dropship', '수송선', Pg([[-12.0, 10.4], [-5.5, 10.4], [-5.5, 14.2], [-6.5, 15.0], [-11.0, 15.0], [-12.0, 14.2]]), 'ship'],
  ['cafeteria', '식당', B(-21.5, 4.4, -12.6, 8.4), 'wood'],
  ['kitchen', '주방', B(-18.4, -10.6, -12.0, -6.4), 'tile'],
  ['dock', '낚시터', B(-25.2, -8.4, -19.4, -5.6), 'wood'],
  ['meeting', '회의실', Pg([[-5.8, -2.2], [-4.8, -3.2], [-0.5, -3.2], [0.5, -2.2], [0.5, 1.0], [-0.5, 1.9], [-4.8, 1.9], [-5.8, 1.0]]), 'wood'],
  ['sleeping', '숙소', B(1.0, -3.0, 4.4, 0.2), 'carpet'],
  ['storage', '창고', B(-1.0, 3.6, 4.2, 7.6), 'storage'],
  ['lab', '실험실', B(-8.0, -12.8, -3.1, -8.3), 'lab'],
  ['greenhouse', '온실', B(6.8, -13.0, 11.8, -9.4), 'greenhouse'],
  ['reactor', '원자로', B(19.9, -7.9, 25.2, -4.6), 'reactor'],
  ['lookout', '전망대', B(6.2, 0.0, 10.6, 5.8), 'wood'],
  ['mining', '광산', B(10.2, 6.9, 15.6, 11.4), 'rock'],
  ['upper_engine', '상부 엔진', B(21.6, 1.0, 25.4, 5.0), 'eng'],
  ['comms', '통신실', B(18.9, 11.6, 23.6, 15.4), 'metal'],
].map(([id, name, poly, floor]) => ({ id, name, poly, floor }));
// 야외 지역도 방으로 (관리용 이름)
const areas = [['rec', '스플래시 존', B(-22.4, -3.4, -14.8, 1.6), 'sand'], ['beach', '모닥불', B(-12.4, -1.0, -6.4, 3.4), 'sand'], ['jungle', '정글', B(-3.0, -16.6, 19.0, -14.0), 'grass'], ['highlands', '고원', B(13.2, -0.8, 20.8, 4.6), 'dirt']];

const doorways = [
  B(-9.8, 9.0, -8.4, 10.6),                       // 수송선 경사로
  B(-16.1, -6.6, -14.9, -5.4), B(-12.2, -8.5, -11.0, -7.2), // 주방 위 문, 동쪽 출구
  B(-20.4, -5.8, -19.2, -4.2),                    // 낚시터 계단
  B(-17.4, 3.6, -15.8, 4.6), B(-13.8, 3.6, -12.4, 4.6), // 식당 아래 입구 2개
  B(-2.6, 1.7, -1.4, 2.4), B(-3.2, -3.4, -2.0, -2.8), B(0.3, -1.6, 1.2, -0.6), // 회의실 위·아래, 숙소 문
  B(-1.6, 3.1, -0.8, 4.4),                        // 창고 서쪽 문
  B(-5.0, -8.5, -3.6, -6.0),                      // 실험실 입구
  B(9.0, -9.6, 10.2, -8.8),                       // 온실 입구
  B(19.2, -7.1, 20.1, -6.0),                      // 원자로 서쪽 문
  B(10.4, 2.6, 12.4, 3.7),                        // 전망대 동쪽 문
  B(12.2, 6.0, 13.3, 7.0),                        // 광산 아래 문
  B(20.6, 2.4, 21.8, 3.6),                        // 상부 엔진 입구
  B(18.2, 12.8, 19.1, 13.8), B(23.4, 11.4, 24.4, 12.5), // 통신실 문 2개
].map(poly => ({ poly, floor: 'wood' }));

const solid = [...rooms.map(r => r.poly)];
const zones = [
  [-22.6, -4.5, 5.6, 9.8, 'sand'],                // 해변 (식당·회의실·숙소·창고 주변)
  [-23.0, -5.8, -14.0, -3.4, 'sand'],             // 스플래시 존 아래
  [4.2, -5.0, 13.2, -0.2, 'sand'],                // 숙소 동쪽 길
  [-12.4, -17.0, -3.0, -5.6, 'grass'],            // 주방–정글 길 + 정글 서쪽
  [-3.0, -17.0, 25.6, -4.4, 'grass'],             // 정글
  [5.6, -0.4, 6.4, 6.2, 'sand'],                  // 전망대 서쪽 입구
  [12.0, -1.2, 21.2, 6.2, 'dirt'],                // 고원
  [16.4, 8.6, 26.0, 16.0, 'rock'],                // 통신실 절벽 위
];

const halls = [...doorways, ...carve(zones, solid, { B, X, Y })];
// 야외 이름 영역 (관리·위치 표시용, 이미 걸을 수 있는 야외 안쪽에만 둠)
for (const [id, name, poly, floor] of areas) rooms.push({ id, name, poly, floor });

const st = {
  samples: P(-6.37, -9.3), idcode: P(8.45, 5.0), parts_reactor: P(23.2, -5.2), parts_engine: P(23.4, 4.5),
  mm0: P(-11.33, 7.9), mm1: P(-18.37, -3.85), mm2: P(-20.07, 3.3), mm3: P(-9.31, -3.51), mm4: P(-9.79, 1.64),
  fish_dock: P(-24.36, -6.83), fish_kitchen: P(-12.64, -9.36), veg_jungle: P(4.0, -12.0), veg_kitchen: P(-17.4, -7.2),
  fuel_jungle: P(17.0, -12.0), fuel_engine: P(22.4, 2.0), critter: P(2.0, -15.4), hoist: P(-22.0, -7.6),
  ores: P(11.08, 10.65), gem: P(14.35, 10.24), jug_storage: P(3.4, 7.0), jug_meeting: P(-5.2, 0.6), water_storage: P(-0.4, 7.0), water_green: P(10.6, -12.4),
  artifact: P(-6.27, -9.9), sandcastle: P(-21.47, 0.37), shell0: P(-3.18, 8.14), shell1: P(-7.95, -1.94), shell2: P(3.16, 1.51), shell3: P(-20.28, -2.43),
  crank_comms: P(20.75, 14.6), crank_kitchen: P(-13.0, -6.9), garb_kitchen: P(-17.8, -10.0), garb_out: P(-24.6, -8.0),
  antenna: P(23.1, 14.8), w_comms: P(19.4, 14.3), w_dropship: P(-11.11, 13.4), weights: P(-19.15, 0.88), mushroom: P(12.79, -15.57),
  videogame: P(3.25, -1.09), temp_green: P(8.68, -11.28), temp_lab: P(-3.5, -9.0), temp_reactor: P(23.4, -6.93), frisbee: P(-18.65, -0.89), radio: P(19.62, 12.76),
  // 사보타주
  hand1: P(20.6, -5.1), hand2: P(24.6, -5.1), comms: P(22.6, 12.2),
  // 장비 (망원경)
  binoculars: P(7.2, 5.0), laptop: P(-1.0, 0.8),
};

const vents = {
  v_comms: P(25.22, 10.97), v_kitchen: P(-15.36, -9.78), v_lookout: P(9.37, 0.63), v_storage: P(2.86, 1.6), v_nwjungle: P(-2.52, -8.99),
  v_nejungle: P(22.68, -8.5), v_swjungle: P(1.3, -10.52), v_sejungle: P(15.15, -16.42), v_rec: P(-16.9, -2.57), v_meeting: P(-12.23, 8.06),
};
const L = (id, ...to) => (vents[id].links = to);
L('v_comms', 'v_lookout', 'v_nejungle'); L('v_kitchen', 'v_swjungle'); L('v_lookout', 'v_comms', 'v_nejungle'); L('v_storage', 'v_meeting', 'v_nwjungle');
L('v_nwjungle', 'v_rec', 'v_storage'); L('v_nejungle', 'v_lookout', 'v_comms'); L('v_swjungle', 'v_kitchen', 'v_sejungle'); L('v_sejungle', 'v_swjungle');
L('v_rec', 'v_meeting', 'v_nwjungle'); L('v_meeting', 'v_rec', 'v_storage');

// 문 (펑글: 여러 번 두드려야 열림)
const doors = [
  D('comms_w', 'comms', 18.45, 12.8, 18.85, 13.8), D('comms_e', 'comms', 23.7, 11.4, 24.1, 12.5), D('kitchen', 'kitchen', -16.1, -6.3, -14.9, -5.9),
  D('lab', 'lab', -5.0, -7.9, -3.6, -7.5), D('lookout', 'lookout', 10.9, 2.6, 11.3, 3.7), D('mining', 'mining', 12.2, 6.3, 13.3, 6.7),
  D('reactor', 'reactor', 19.3, -7.1, 19.7, -6.0), D('storage', 'storage', -1.5, 3.95, -1.1, 4.4),
];

// 사다리·짚라인
const transports = [
  { id: 'ladder_comms', kind: 'ladder', name: '사다리', a: P(19.6, 5.4), b: P(19.6, 9.2), time: 3 },
  { id: 'ladder_reactor', kind: 'ladder', name: '사다리', a: P(17.6, -4.9), b: P(17.6, -0.7), time: 2.6 },
  { id: 'zipline', kind: 'zipline', name: '짚라인', a: P(14.4, -0.6), b: P(13.6, -7.0), time: 2.5 },
];

const props = [
  Rect('ladder', 19.2, 5.6, 20.0, 8.9), Rect('ladder', 17.2, -4.6, 18.0, -1.0), Rect('zipline', 13.4, -6.8, 14.6, -0.8),
  Circ('campfire', -8.6, 1.0, 0.7, { block: true }), Rect('longTable', -4.4, -1.1, -1.0, 0.0, { block: true, color: '#b5884e' }),
  Rect('longTable', -20.5, 5.2, -17.5, 6.2, { block: true, color: '#b5884e' }), Rect('longTable', -16.6, 5.2, -13.6, 6.2, { block: true, color: '#b5884e' }),
  Rect('tent', 1.4, -2.8, 3.0, -1.6, { block: true }), Rect('boxes', 0.0, 5.6, 1.6, 7.0, { block: true }), Rect('barrel', 2.6, 4.0, 3.4, 4.8, { block: true }),
  Rect('desk', -7.6, -11.2, -5.0, -10.4, { block: true, color: '#e6e9ec' }), Rect('sink', -17.6, -8.0, -16.4, -7.0), Rect('desk', -16.0, -10.2, -13.6, -9.4, { block: true, color: '#c9a77a' }),
  Rect('boat', -25.0, -9.4, -22.0, -8.5), Rect('water', -26.0, -12.0, -19.0, -8.5),
  Rect('plant', 7.2, -12.6, 11.4, -12.0, { block: true }), Rect('reactorCore', 21.6, -7.4, 23.4, -5.8, { block: true }), Rect('engine', 22.2, 2.6, 24.6, 4.2, { block: true }),
  Rect('rock', 13.0, 8.2, 14.2, 9.0, { block: true }), Rect('console', 19.6, 14.9, 21.6, 15.3, { block: true }), Circ('statue', 7.4, 4.6, 0.3, { block: true, color: '#c7a26b' }),
  ...[[-1, -6], [5, -8], [9, -15], [16, -10], [20, -14], [-6, -15], [2, -16.2], [24, -11]].map(([x, y]) => Circ('tree', x, y, 0.75, { block: true })),
  ...[[0, -12], [7, -6], [12, -14.5], [18, -16], [22, -12.5], [-9.6, -14]].map(([x, y], i) => Circ(i % 2 ? 'mushroom' : 'bush', x, y, 0.45, { block: true })),
  Rect('lava', -26.0, -4.2, -22.8, 9.0), Rect('rock', 14.2, 2.4, 15.4, 3.4, { block: true }), Rect('rock', 24.6, 9.0, 25.8, 10.0, { block: true }),
];

const tasks = [
  { id: 'samples', name: '표본 수집하기', kind: 'common', game: 'sort', seq: ['samples'], params: { groups: ['🍄', '🌿', '🪨'], label: '표본을 종류별로 나누세요' } },
  { id: 'idcode', name: 'ID 코드 입력하기', kind: 'common', game: 'idcode', seq: ['idcode'] },
  { id: 'parts', name: '부품 교체하기', kind: 'common', seq: ['parts_reactor', 'parts_engine'], games: ['drag', 'drag'], labels: ['부품 꺼내기', '부품 교체하기'] },
  { id: 'marshmallow', name: '마시멜로 굽기', kind: 'common', game: 'fill', seq: [{ pool: ['mm0', 'mm1', 'mm2', 'mm3', 'mm4'] }], params: { label: '노릇노릇할 때 멈추세요' } },
  { id: 'fish', name: '물고기 잡기', kind: 'long', seq: ['fish_dock', 'fish_kitchen'], games: ['tap', 'drag'], labels: ['물고기 잡기', '물고기 손질하기'] },
  { id: 'veg', name: '채소 수확하기', kind: 'long', seq: ['veg_jungle', 'veg_kitchen'], games: ['find', 'drag'], labels: ['채소 찾기', '주방에 채소 두기'] },
  { id: 'fuel', name: '연료 추출하기', kind: 'long', seq: ['fuel_jungle', 'fuel_engine'], games: ['fuel_fill', 'fuel_empty'], labels: ['연료 추출하기', '엔진에 연료 넣기'] },
  { id: 'critter', name: '동물 돕기', kind: 'long', game: 'clean', seq: ['critter'], params: { icon: '🐾', label: '동물을 깨끗이 닦아 주세요' } },
  { id: 'hoist', name: '보급품 끌어올리기', kind: 'long', game: 'lever', seq: ['hoist'], params: { label: '레버를 당겨 보급품을 끌어올리세요' } },
  { id: 'ores', name: '광석 캐기', kind: 'long', game: 'tap', seq: ['ores'], params: { icon: '⛏️', label: '광석을 모두 캐세요' } },
  { id: 'gem', name: '보석 닦기', kind: 'long', game: 'clean', seq: ['gem'], params: { icon: '💎', label: '보석을 문질러 닦으세요' } },
  { id: 'jug', name: '물통 교체하기', kind: 'long', seq: ['jug_storage', 'jug_meeting'], games: ['fill', 'drag'], labels: ['물통 채우기', '정수기 물통 교체하기'] },
  { id: 'water', name: '식물에 물 주기', kind: 'long', seq: ['water_storage', 'water_green'], games: ['hold', 'fill'], labels: ['물뿌리개 챙기기', '식물에 물 주기'] },
  { id: 'artifact', name: '유물 복원하기', kind: 'short', game: 'drag', seq: ['artifact'], params: { label: '유물 조각을 받침대로 옮기세요' } },
  { id: 'sandcastle', name: '모래성 쌓기', kind: 'short', game: 'tap', seq: ['sandcastle'], params: { icon: '🏰', label: '모래를 눌러 성을 쌓으세요' } },
  { id: 'shells', name: '조개껍데기 줍기', kind: 'short', game: 'find', seq: [{ pool: ['shell0', 'shell1', 'shell2', 'shell3'] }] },
  { id: 'crank', name: '발전기 돌리기', kind: 'short', game: 'dial', seq: [{ pool: ['crank_comms', 'crank_kitchen'] }] },
  { id: 'garbage', name: '쓰레기 비우기', kind: 'short', seq: ['garb_kitchen', 'garb_out'], games: ['hold', 'garbage'], labels: ['쓰레기 봉투 챙기기', '쓰레기 비우기'] },
  { id: 'antenna', name: '안테나 고치기', kind: 'short', game: 'rotate', seq: ['antenna'] },
  { id: 'wires', name: '배선 수리하기', kind: 'short', game: 'wires', seq: [{ pool: ['w_comms', 'w_dropship'] }] },
  { id: 'weights', name: '역기 들기', kind: 'short', game: 'tap', seq: ['weights'], params: { icon: '🏋️', label: '여러 번 눌러 역기를 드세요' } },
  { id: 'mushroom', name: '버섯 관찰하기', kind: 'short', game: 'match', seq: ['mushroom'] },
  { id: 'videogame', name: '비디오 게임 하기', kind: 'short', game: 'simon', seq: ['videogame'], params: { rounds: 3 } },
  { id: 'temp', name: '온도 기록하기', kind: 'short', game: 'calib', seq: [{ pool: ['temp_green', 'temp_lab', 'temp_reactor'] }] },
  { id: 'frisbee', name: '원반 시험하기', kind: 'short', game: 'slider', seq: ['frisbee'] },
  { id: 'radio', name: '라디오 맞추기', kind: 'short', game: 'dial', seq: ['radio'], params: { label: '다이얼을 돌려 주파수를 맞추세요' } },
];

const sabotages = {
  reactor: { name: '원자로 멜트다운', type: 'critical', time: 60, game: 'hand', together: true, fix: { hand1: 'h1', hand2: 'h2' }, room: 'reactor' },
  mixup: { name: '버섯 혼란', type: 'mixup', time: 12, game: 'mixup', fix: {}, room: 'jungle' },
  comms: { name: '통신 방해', type: 'comms', game: 'comms', fix: { comms: 'c' }, room: 'comms' },
};

const button = P(-2.7, -0.55);
export default {
  id: 'fungle', name: 'THE FUNGLE', ko: '펑글', w: X(26.5), h: Y(-17.5),
  theme: { outside: 'ocean', wall: '#5b4a3a', wallTop: '#7e6852', wallFace: '#6a5644' },
  rooms, halls, props, stations: st, vents, doors, doorMode: 'manual', transports, tasks, sabotages, button,
  cams: { station: 'binoculars', single: true, views: [
    { name: '해변', ...P(-9.0, 2.0) }, { name: '스플래시 존', ...P(-18.0, -1.0) }, { name: '정글', ...P(6.0, -8.0) },
    { name: '온실', ...P(9.3, -11.0) }, { name: '원자로', ...P(21.5, -6.5) }, { name: '광산', ...P(13.0, 9.0) }] },
  admin: null, vitals: null, doorlog: null,
  spawn: { ...P(-9.8, 1.0), rx: 230, ry: 230 }, meetingSpawn: { ...P(-2.7, -0.55), rx: 420, ry: 260 },
};
