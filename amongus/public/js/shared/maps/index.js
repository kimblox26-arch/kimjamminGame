// 맵 레지스트리 + 기하 도구 (서버/클라이언트 공용)
// 각 맵 파일은 "원본 정의(def)"를 export default 하고, 여기서 buildMap()으로 계산 필드를 붙인다.
import skeld from './skeld.js';
import mira from './mira.js';
import polus from './polus.js';
import airship from './airship.js';
import fungle from './fungle.js';
import lobby from './lobby.js';

export function inPoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const centroid = p => ({ x: p.reduce((s, q) => s + q[0], 0) / p.length, y: p.reduce((s, q) => s + q[1], 0) / p.length });
const inRect = (x, y, r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
const hitProp = (x, y, o) => (o.r ? Math.hypot(x - o.x, y - o.y) < o.r : inRect(x, y, o));

export function buildMap(def) {
  const m = { theme: {}, props: [], obstacles: [], doors: [], transports: [], sabotages: {}, tasks: [], vents: {}, stations: {}, ...def };
  m.rooms = (def.rooms || []).map(r => ({ ...r, label: r.label || centroid(r.poly) }));
  m.halls = (def.halls || []).map(h => (Array.isArray(h) ? { poly: h, floor: 'hall' } : { floor: 'hall', ...h }));
  m.walk = [...m.rooms.map(r => r.poly), ...m.halls.map(h => h.poly)];
  m.blockers = [...(def.obstacles || []), ...(def.props || []).filter(p => p.block)];
  m.roomAt = (x, y) => m.rooms.find(r => inPoly(x, y, r.poly)) || null;
  m.roomNames = m.rooms.map(r => r.name);
  const near = (x, y) => m.roomAt(x, y) || m.rooms.reduce((b, r) => (Math.hypot(r.label.x - x, r.label.y - y) < Math.hypot(b.label.x - x, b.label.y - y) ? r : b), m.rooms[0]);
  for (const k in m.stations) { const s = m.stations[k], r = near(s.x, s.y); s.id = k; s.roomId = r?.id; s.room = s.room || r?.name || '복도'; }
  const links = {};
  for (const g of def.ventGroups || []) for (const id of g) links[id] = new Set([...(links[id] || []), ...g.filter(v => v !== id)]);
  for (const id in m.vents) for (const l of m.vents[id].links || []) { (links[id] ||= new Set()).add(l); (links[l] ||= new Set()).add(id); }
  for (const id in m.vents) { const v = m.vents[id]; v.id = id; v.links = [...(links[id] || [])]; v.room = near(v.x, v.y)?.name; }
  m.doorById = Object.fromEntries(m.doors.map(d => [d.id, d]));
  m.doorRooms = [...new Set(m.doors.map(d => d.room))];
  m.doorMode = def.doorMode || 'auto';
  m.doorTime = def.doorTime ?? 10;
  let grid = null;
  // 시야 계산용 격자 (벽 = 걸을 수 없는 곳). 소품은 시야를 막지 않음.
  m.grid = () => {
    if (grid) return grid;
    const cell = 25, gw = Math.ceil(m.w / cell), gh = Math.ceil(m.h / cell), data = new Uint8Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
      if (m.walk.some(p => inPoly(x, y, p))) data[j * gw + i] = 1;
    }
    return (grid = { cell, gw, gh, data });
  };
  return m;
}

// closed: 닫힌 문 id 집합(Set) 또는 배열
const closedRects = (m, closed) => (closed && (closed.size || closed.length) ? [...closed].map(id => m.doorById[id]).filter(Boolean) : null);
export function walkable(m, x, y, closed) {
  if (!m.walk.some(p => inPoly(x, y, p))) return false;
  if (m.blockers.some(o => hitProp(x, y, o))) return false;
  const cr = closedRects(m, closed);
  return !cr || !cr.some(d => inRect(x, y, d));
}
// 발 주변 여러 점이 모두 걸을 수 있어야 이동 가능
export function canStand(m, x, y, closed, r = 22) {
  return walkable(m, x, y, closed) && walkable(m, x - r, y, closed) && walkable(m, x + r, y, closed) && walkable(m, x, y - r * 0.6, closed) && walkable(m, x, y + r * 0.4, closed);
}
// 시야 다각형: 격자 위에서 광선을 쏘아 벽/닫힌 문에서 멈춘 지점들
export function visionPoly(m, x, y, radius, closed, rays = 220) {
  const g = m.grid(), cr = closedRects(m, closed), pts = [], step = g.cell * 0.5;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    let d = 0;
    while (d < radius) {
      const px = x + dx * d, py = y + dy * d, ci = Math.floor(px / g.cell), cj = Math.floor(py / g.cell);
      if (ci < 0 || cj < 0 || ci >= g.gw || cj >= g.gh || !g.data[cj * g.gw + ci]) break;
      if (cr && cr.some(r => inRect(px, py, r))) break;
      d += step;
    }
    pts.push([x + dx * Math.min(d + g.cell * 0.6, radius), y + dy * Math.min(d + g.cell * 0.6, radius)]);
  }
  return pts;
}
// 두 점 사이가 벽에 막히지 않았는지 (격자 기준)
export function lineClear(m, x0, y0, x1, y1, closed) {
  const g = m.grid(), cr = closedRects(m, closed), d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / (g.cell * 0.5));
  for (let i = 1; i < n; i++) {
    const px = x0 + ((x1 - x0) * i) / n, py = y0 + ((y1 - y0) * i) / n, ci = Math.floor(px / g.cell), cj = Math.floor(py / g.cell);
    if (!g.data[cj * g.gw + ci]) return false;
    if (cr && cr.some(r => inRect(px, py, r))) return false;
  }
  return true;
}
// 원(타원) 둘레에 n명 배치, 걸을 수 없는 자리는 중심 쪽으로 당김
export function spawnAt(m, area, i, n) {
  const a = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
  for (let k = 1; k >= 0; k -= 0.1) {
    const x = area.x + Math.cos(a) * (area.rx ?? 300) * k, y = area.y + Math.sin(a) * (area.ry ?? 260) * k;
    if (canStand(m, x, y)) return { x, y };
  }
  return { x: area.x, y: area.y };
}
// 임무 정의 → 이번 게임의 단계별 장소 목록
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export function stationsFor(task) {
  if (task.pick) { const p = shuffle([...task.pool]).slice(0, task.pick); if (task.then) p.push(task.then); return p; }
  return task.seq.map(s => (typeof s === 'string' ? s : s.pool[Math.floor(Math.random() * s.pool.length)]));
}
// 단계별 미니게임 id / 이름
export const stepGame = (task, i) => (task.games ? task.games[Math.min(i, task.games.length - 1)] : task.game);
export const stepLabel = (task, i) => (task.labels ? task.labels[Math.min(i, task.labels.length - 1)] : task.name);
export const taskById = (m, id) => m.tasks.find(t => t.id === id);

export const MAP_LIST = [skeld, mira, polus, airship, fungle].map(buildMap);
export const MAPS_BY_ID = Object.fromEntries(MAP_LIST.map(m => [m.id, m]));
export const getMap = id => MAPS_BY_ID[id] || MAPS_BY_ID.skeld;
export const LOBBY = buildMap(lobby);
