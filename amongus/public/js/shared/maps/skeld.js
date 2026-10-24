// THE SKELD — 원본 맵 정의 (월드 좌표). 지도 화면 좌표(px)를 S배 확대해서 사용.
const S = 5, OX = 290, OY = 20;
const tx = x => (x - OX) * S, ty = y => (y - OY) * S;
const R = (x1, y1, x2, y2) => [[tx(x1), ty(y1)], [tx(x2), ty(y1)], [tx(x2), ty(y2)], [tx(x1), ty(y2)]];
const Pg = pts => pts.map(([x, y]) => [tx(x), ty(y)]);
const P = (x, y) => ({ x: tx(x), y: ty(y) });
const D = (id, room, x1, y1, x2, y2) => ({ id, room, x: tx(x1), y: ty(y1), w: (x2 - x1) * S, h: (y2 - y1) * S });

const rooms = [
  ['upper_engine', '상부 엔진실', R(443, 140, 605, 318), 'eng'],
  ['reactor', '원자로', Pg([[308, 350], [355, 298], [457, 298], [457, 575], [355, 575], [308, 525]]), 'reactor'],
  ['security', '보안실', R(615, 335, 708, 515), 'metal'],
  ['medbay', '의무실', Pg([[730, 275], [880, 275], [880, 370], [935, 425], [935, 465], [730, 465]]), 'med'],
  ['cafeteria', '식당', Pg([[985, 32], [1195, 32], [1283, 120], [1283, 330], [1195, 418], [985, 418], [898, 330], [898, 120]]), 'cafe'],
  ['weapons', '무기고', R(1355, 115, 1512, 293), 'metal'],
  ['o2', '산소 공급실', R(1252, 330, 1380, 440), 'metal'],
  ['navigation', '항해실', Pg([[1645, 335], [1715, 335], [1765, 390], [1765, 440], [1715, 495], [1645, 495]]), 'metal'],
  ['admin', '관리실', R(1182, 465, 1352, 618), 'admin'],
  ['shields', '보호막 제어실', R(1355, 598, 1512, 778), 'metal'],
  ['comms', '통신실', R(1165, 733, 1338, 865), 'metal'],
  ['storage', '창고', Pg([[940, 550], [1147, 550], [1147, 820], [1100, 865], [985, 865], [940, 820]]), 'storage'],
  ['electrical', '전기실', R(762, 500, 932, 690), 'elec'],
  ['lower_engine', '하부 엔진실', R(443, 565, 605, 745), 'eng'],
].map(([id, name, poly, floor]) => ({ id, name, poly, floor }));

const halls = [
  R(600, 180, 903, 250), R(790, 245, 850, 280), R(505, 313, 560, 570), R(452, 400, 510, 470), R(555, 400, 620, 470),
  R(600, 700, 945, 780), R(810, 685, 860, 705), R(1060, 405, 1120, 555), R(1115, 520, 1187, 575), R(1278, 180, 1360, 250),
  R(1430, 288, 1490, 603), R(1375, 370, 1435, 430), R(1485, 370, 1650, 430), R(1142, 640, 1360, 700), R(1230, 695, 1290, 738),
].map(poly => ({ poly, floor: 'hall' }));

// 임무 / 사보타주 / 장비 위치
const st = {
  w_elec: P(790, 515), calib: P(905, 515), lights: P(775, 610), dl_elec: P(915, 670), divert: P(922, 600),
  w_stor: P(1115, 570), garb_stor: P(1100, 835), fuel_can: P(960, 590),
  w_admin: P(1200, 480), ul_admin: P(1255, 480), card: P(1335, 585), o2k_admin: P(1205, 600), admin: P(1267, 545),
  w_nav: P(1660, 475), steer: P(1748, 415), dl_nav: P(1690, 350), chart: P(1655, 420), acc_nav: P(1725, 470),
  w_cafe: P(1010, 50), dl_cafe: P(1170, 50), garb_cafe: P(1260, 130),
  w_sec: P(640, 350), cams: P(690, 425), acc_sec: P(698, 350),
  align_up: P(470, 280), fuel_up: P(585, 300), acc_upeng: P(455, 160),
  align_low: P(470, 725), fuel_low: P(590, 590), acc_loweng: P(455, 590),
  reactor_start: P(325, 440), manifolds: P(325, 500), hand1: P(400, 312), hand2: P(400, 562),
  scan: P(860, 435), inspect: P(760, 300),
  o2filter: P(1315, 360), garb_o2: P(1270, 425), o2k: P(1365, 345), acc_o2: P(1262, 345),
  weapons: P(1435, 140), dl_weapons: P(1375, 135), acc_weapons: P(1500, 200),
  shields: P(1455, 700), acc_shields: P(1500, 760),
  comms: P(1310, 845), dl_comms: P(1190, 845), acc_comms: P(1175, 750),
  vc_med: P(752, 430), vc_cafe: P(1235, 290), vc_admin: P(1320, 600), vc_nav: P(1680, 480), vc_elec: P(795, 670), vc_shields: P(1395, 760),
};

const vents = {
  v_upeng: P(585, 165), v_reactor: P(330, 330), v_loweng: P(585, 725),
  v_med: P(750, 445), v_sec: P(690, 495), v_elec: P(780, 670),
  v_cafe: P(1250, 290), v_admin: P(1335, 600), v_hall: P(1090, 500),
  v_weapons: P(1490, 270), v_nav1: P(1665, 355), v_nav2: P(1665, 480), v_shields: P(1380, 760),
};
const ventGroups = [['v_upeng', 'v_reactor', 'v_loweng'], ['v_med', 'v_sec', 'v_elec'], ['v_cafe', 'v_admin', 'v_hall'], ['v_weapons', 'v_nav1'], ['v_nav2', 'v_shields']];

// 문 사보타주: 닫히면 10초 뒤 자동으로 열림
const doors = [
  D('cafe_w', 'cafeteria', 893, 180, 905, 250), D('cafe_e', 'cafeteria', 1278, 180, 1290, 250), D('cafe_s', 'cafeteria', 1060, 410, 1120, 422),
  D('upeng_e', 'upper_engine', 600, 180, 612, 250), D('upeng_s', 'upper_engine', 505, 313, 560, 325),
  D('loweng_n', 'lower_engine', 505, 560, 560, 572), D('loweng_e', 'lower_engine', 600, 700, 612, 745),
  D('med', 'medbay', 790, 262, 850, 275), D('sec', 'security', 610, 400, 622, 470), D('elec', 'electrical', 810, 688, 860, 700),
  D('stor_n', 'storage', 1060, 545, 1120, 557), D('stor_e', 'storage', 1142, 640, 1154, 700), D('stor_w', 'storage', 935, 700, 947, 780),
];

const T = (x, y, r) => ({ kind: 'table', ...P(x, y), r: r * S, block: true });
const props = [
  T(1090, 235, 40), T(990, 135, 34), T(1190, 135, 34), T(990, 325, 34), T(1190, 325, 34),
  { kind: 'engine', ...P(510, 225), r: 38 * S, block: true }, { kind: 'engine', ...P(510, 655), r: 38 * S, block: true },
  { kind: 'reactorCore', ...P(370, 437), r: 32 * S, block: true },
  { kind: 'mapTable', ...P(1267, 545), r: 30 * S, block: true },
  { kind: 'crate', x: tx(985), y: ty(640), w: 45 * S, h: 40 * S, block: true }, { kind: 'crate', x: tx(1075), y: ty(760), w: 40 * S, h: 35 * S, block: true },
  { kind: 'bed', x: tx(745), y: ty(320), w: 50 * S, h: 22 * S }, { kind: 'bed', x: tx(745), y: ty(360), w: 50 * S, h: 22 * S },
  { kind: 'scanner', ...P(860, 440), r: 18 * S },
  { kind: 'monitor', x: tx(645), y: ty(400), w: 40 * S, h: 18 * S }, { kind: 'chair', ...P(665, 440), r: 9 * S },
  { kind: 'gunSeat', ...P(1440, 190), r: 26 * S }, { kind: 'console', x: tx(1690), y: ty(400), w: 50 * S, h: 25 * S },
  { kind: 'chair', ...P(1700, 440), r: 9 * S }, { kind: 'hexPanel', ...P(1440, 690), r: 30 * S },
  { kind: 'desk', x: tx(1200), y: ty(780), w: 70 * S, h: 20 * S }, { kind: 'desk', x: tx(1260), y: ty(820), w: 50 * S, h: 20 * S },
  { kind: 'panel', x: tx(770), y: ty(505), w: 140 * S, h: 10 * S }, { kind: 'plant', ...P(1300, 400), r: 12 * S }, { kind: 'plant', ...P(1340, 400), r: 12 * S },
  { kind: 'window', x: tx(1520), y: ty(130), w: 8 * S, h: 150 * S }, { kind: 'window', x: tx(1760), y: ty(395), w: 8 * S, h: 40 * S },
  { kind: 'barrel', ...P(1010, 820), r: 14 * S }, { kind: 'barrel', ...P(1040, 830), r: 14 * S }, { kind: 'pipe', x: tx(320), y: ty(380), w: 10 * S, h: 120 * S },
];

const tasks = [
  { id: 'wires', name: '배선 수리하기', kind: 'common', game: 'wires', pick: 3, pool: ['w_elec', 'w_stor', 'w_admin', 'w_nav', 'w_cafe', 'w_sec'] },
  { id: 'card', name: '카드 긁기', kind: 'common', game: 'card', seq: ['card'] },
  { id: 'engine', name: '엔진 출력 정렬하기', kind: 'long', game: 'align', seq: ['align_up', 'align_low'] },
  { id: 'upload', name: '데이터 업로드', kind: 'long', seq: [{ pool: ['dl_cafe', 'dl_weapons', 'dl_nav', 'dl_comms', 'dl_elec'] }, 'ul_admin'], games: ['download', 'upload'], labels: ['데이터 다운로드', '데이터 업로드'] },
  { id: 'scan', name: '의무실 스캔 제출', kind: 'long', game: 'scan', seq: ['scan'], visual: true },
  { id: 'reactor', name: '원자로 가동', kind: 'long', game: 'simon', seq: ['reactor_start'] },
  { id: 'fuel', name: '엔진 연료 넣기', kind: 'long', seq: ['fuel_can', 'fuel_up', 'fuel_can', 'fuel_low'], games: ['fuel_fill', 'fuel_empty', 'fuel_fill', 'fuel_empty'], labels: ['연료통 채우기', '엔진에 연료 넣기', '연료통 채우기', '엔진에 연료 넣기'] },
  { id: 'inspect', name: '샘플 검사', kind: 'long', seq: ['inspect', 'inspect'], games: ['inspect_start', 'inspect_result'] },
  { id: 'calib', name: '배전기 보정하기', kind: 'short', game: 'calib', seq: ['calib'] },
  { id: 'o2', name: '산소 필터 청소', kind: 'short', game: 'leaves', seq: ['o2filter'] },
  { id: 'steer', name: '항로 조종 안정시키기', kind: 'short', game: 'steer', seq: ['steer'] },
  { id: 'asteroids', name: '소행성 파괴', kind: 'short', game: 'asteroids', seq: ['weapons'], visual: true },
  { id: 'garbage', name: '쓰레기 비우기', kind: 'short', game: 'garbage', seq: ['garb_cafe', 'garb_stor'], visual: true },
  { id: 'chute', name: '배출구 비우기', kind: 'short', game: 'garbage', seq: ['garb_o2', 'garb_stor'], visual: true },
  { id: 'shields', name: '보호막 활성화', kind: 'short', game: 'shields', seq: ['shields'], visual: true },
  { id: 'divert', name: '전력 우회', kind: 'short', seq: ['divert', { pool: ['acc_nav', 'acc_sec', 'acc_upeng', 'acc_loweng', 'acc_o2', 'acc_weapons', 'acc_shields', 'acc_comms'] }],
    games: ['divert', 'accept_power'], labels: ['전력 우회', '우회된 전력 수용'] },
  { id: 'chart', name: '항로 설정', kind: 'short', game: 'chart', seq: ['chart'] },
  { id: 'manifolds', name: '매니폴드 잠금 해제', kind: 'short', game: 'numbers', seq: ['manifolds'] },
  { id: 'ventclean', name: '벤트 청소', kind: 'short', game: 'vent_clean', seq: [{ pool: ['vc_med', 'vc_cafe', 'vc_admin', 'vc_nav', 'vc_elec', 'vc_shields'] }] },
];

const sabotages = {
  reactor: { name: '원자로 붕괴', type: 'critical', time: 30, game: 'hand', together: true, fix: { hand1: 'h1', hand2: 'h2' }, room: 'reactor' },
  o2: { name: '산소 고갈', type: 'critical', time: 30, game: 'keypad', fix: { o2k: 'k1', o2k_admin: 'k2' }, room: 'o2' },
  lights: { name: '조명 고장', type: 'lights', game: 'lights', fix: { lights: 'l' }, room: 'electrical' },
  comms: { name: '통신 방해', type: 'comms', game: 'comms', fix: { comms: 'c' }, room: 'comms' },
};

const button = P(1090, 235);
export default {
  id: 'skeld', name: 'THE SKELD', ko: '더 스켈드', w: tx(1790), h: ty(890),
  theme: { outside: 'space', wall: '#3b4449', wallTop: '#5b676d', wallFace: '#48535a' },
  rooms, halls, props, stations: st, vents, ventGroups, doors, doorMode: 'auto', doorTime: 10, tasks, sabotages, button,
  cams: { station: 'cams', views: [{ name: '항해실 복도', ...P(1560, 400) }, { name: '관리실 복도', ...P(1150, 600) }, { name: '보안실 복도', ...P(530, 435) }, { name: '의무실 복도', ...P(800, 215) }] },
  admin: 'admin', vitals: null,
  spawn: { x: button.x, y: button.y, rx: 330, ry: 300 }, meetingSpawn: { x: button.x, y: button.y, rx: 330, ry: 300 },
};
