// 맵 데이터 (서버/클라이언트 공용). 스켈드는 지도 화면 좌표(px)를 S배 확대해서 사용.
const S = 5, OX = 290, OY = 20;
const tx = x => (x - OX) * S, ty = y => (y - OY) * S;
const R = (x1, y1, x2, y2) => [[tx(x1), ty(y1)], [tx(x2), ty(y1)], [tx(x2), ty(y2)], [tx(x1), ty(y2)]];
const Pg = pts => pts.map(([x, y]) => [tx(x), ty(y)]);
const P = (x, y) => ({ x: tx(x), y: ty(y) });

export function inPoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function walkable(map, x, y) {
  if (!map.walk.some(p => inPoly(x, y, p))) return false;
  return !map.obstacles.some(o => o.r ? Math.hypot(x - o.x, y - o.y) < o.r : x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h);
}
// 발 주변 여러 점이 모두 걸을 수 있는 곳이어야 이동 가능
export function canStand(map, x, y, r = 22) {
  return walkable(map, x, y) && walkable(map, x - r, y) && walkable(map, x + r, y) && walkable(map, x, y - r * 0.6) && walkable(map, x, y + r * 0.4);
}
const centroid = p => ({ x: p.reduce((s, q) => s + q[0], 0) / p.length, y: p.reduce((s, q) => s + q[1], 0) / p.length });

const rooms = [
  ['상부 엔진실', R(443, 140, 605, 318), 'eng'],
  ['원자로', Pg([[308, 350], [355, 298], [457, 298], [457, 575], [355, 575], [308, 525]]), 'reactor'],
  ['보안실', R(615, 335, 708, 515), 'metal'],
  ['의무실', Pg([[730, 275], [880, 275], [880, 370], [935, 425], [935, 465], [730, 465]]), 'med'],
  ['식당', Pg([[985, 32], [1195, 32], [1283, 120], [1283, 330], [1195, 418], [985, 418], [898, 330], [898, 120]]), 'cafe'],
  ['무기고', R(1355, 115, 1512, 293), 'metal'],
  ['산소 공급실', R(1252, 330, 1380, 440), 'metal'],
  ['항해실', Pg([[1645, 335], [1715, 335], [1765, 390], [1765, 440], [1715, 495], [1645, 495]]), 'metal'],
  ['관리실', R(1182, 465, 1352, 618), 'admin'],
  ['보호막 제어실', R(1355, 598, 1512, 778), 'metal'],
  ['통신실', R(1165, 733, 1338, 865), 'metal'],
  ['창고', Pg([[940, 550], [1147, 550], [1147, 820], [1100, 865], [985, 865], [940, 820]]), 'storage'],
  ['전기실', R(762, 500, 932, 690), 'elec'],
  ['하부 엔진실', R(443, 565, 605, 745), 'eng'],
].map(([name, poly, floor]) => ({ name, poly, floor, label: centroid(poly) }));

const halls = [
  R(600, 180, 903, 250), R(790, 245, 850, 280), R(505, 313, 560, 570), R(452, 400, 510, 470), R(555, 400, 620, 470),
  R(600, 700, 945, 780), R(810, 685, 860, 705), R(1060, 405, 1120, 555), R(1115, 520, 1187, 575), R(1278, 180, 1360, 250),
  R(1430, 288, 1490, 603), R(1375, 370, 1435, 430), R(1485, 370, 1650, 430), R(1142, 640, 1360, 700), R(1230, 695, 1290, 738),
];

// 임무/사보타주 위치
const st = {
  w_elec: P(790, 515), calib: P(905, 515), lights: P(775, 610), dl_elec: P(915, 670),
  w_stor: P(1115, 570), w_admin: P(1200, 480), ul_admin: P(1255, 480), card: P(1335, 585), o2k_admin: P(1205, 600),
  w_nav: P(1660, 475), steer: P(1748, 415), dl_nav: P(1690, 350),
  w_cafe: P(1010, 50), dl_cafe: P(1170, 50), garb_cafe: P(1260, 130),
  w_sec: P(640, 350), align_up: P(470, 280), align_low: P(470, 725),
  reactor_start: P(325, 440), hand1: P(400, 312), hand2: P(400, 562),
  scan: P(860, 435), o2filter: P(1315, 360), garb_o2: P(1270, 425), o2k: P(1365, 345),
  weapons: P(1435, 140), dl_weapons: P(1375, 135), shields: P(1455, 700),
  comms: P(1310, 845), dl_comms: P(1190, 845),
};
const roomAt = (x, y) => rooms.find(r => inPoly(x, y, r.poly))?.name || '복도';
for (const k in st) st[k].room = roomAt(st[k].x, st[k].y);

const vents = {
  v_upeng: P(585, 165), v_reactor: P(330, 330), v_loweng: P(585, 725),
  v_med: P(750, 445), v_sec: P(690, 495), v_elec: P(780, 670),
  v_cafe: P(1250, 290), v_admin: P(1335, 600), v_hall: P(1090, 500),
  v_weapons: P(1490, 270), v_nav1: P(1665, 355), v_nav2: P(1665, 480), v_shields: P(1380, 760),
};
const ventGroups = [['v_upeng', 'v_reactor', 'v_loweng'], ['v_med', 'v_sec', 'v_elec'], ['v_cafe', 'v_admin', 'v_hall'], ['v_weapons', 'v_nav1'], ['v_nav2', 'v_shields']];
for (const g of ventGroups) for (const id of g) { vents[id].links = g.filter(v => v !== id); vents[id].room = roomAt(vents[id].x, vents[id].y); }

const button = P(1090, 235);
const T = (x, y, r = 46) => ({ ...P(x, y), r: r * S, table: true });
const obstacles = [
  T(1090, 235, 40), T(990, 135, 34), T(1190, 135, 34), T(990, 325, 34), T(1190, 325, 34), // 식당 테이블
  { ...P(510, 225), r: 38 * S, engine: true }, { ...P(510, 655), r: 38 * S, engine: true },  // 엔진
  { ...P(370, 437), r: 32 * S, core: true },                                              // 원자로 코어
  { ...P(1267, 545), r: 30 * S, map: true },                                               // 관리실 지도 테이블
  { x: tx(985), y: ty(640), w: 45 * S, h: 40 * S, crate: true }, { x: tx(1075), y: ty(760), w: 40 * S, h: 35 * S, crate: true },
];

export const SKELD = {
  id: 'skeld', S, rooms, walk: [...rooms.map(r => r.poly), ...halls], halls, obstacles, stations: st, vents, button,
  w: tx(1790), h: ty(890),
  spawn(i, n) { const a = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2; return { x: button.x + Math.cos(a) * 330, y: button.y + Math.sin(a) * 300 }; },
};

// 대기실(드롭십)
const lobbyFloor = [[150, 330], [1250, 330], [1250, 920], [150, 920]];
export const LOBBY = {
  id: 'lobby', rooms: [{ name: '', poly: lobbyFloor, floor: 'ship', label: { x: 700, y: 600 } }], walk: [lobbyFloor], halls: [],
  obstacles: [{ x: 260, y: 690, w: 170, h: 150, crate: true }, { x: 960, y: 610, w: 170, h: 160, crate: true },
    { x: 335, y: 400, w: 120, h: 95, crate: true, laptop: true }, { x: 940, y: 400, w: 120, h: 95, crate: true, box: true }],
  stations: { laptop: { x: 395, y: 520, room: '' }, box: { x: 1000, y: 520, room: '' } },
  vents: {}, w: 1400, h: 1000,
  spawn(i) { return { x: 700 + Math.cos(i * 2.4) * 120 * Math.min(1, i), y: 640 + Math.sin(i * 2.4) * 80 * Math.min(1, i) }; },
};
export const ROOM_NAMES = rooms.map(r => r.name);
