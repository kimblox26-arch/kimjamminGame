// 시설 지도 — 1칸 = 2m.  # 벽  . 바닥  * 바닥+천장등  D 자동문  O 부서진(열린) 문
// X 잠긴 게이트(키카드)  g 유리창  c 상자  t 책상  P 플레이어  S SCP-096  K 키카드  E 출구
export const CELL = 2, WALL_H = 3.6;
export const MAP = [
  '########################################',
  '#......#c......c#.........#............#',
  '#...*..#....*...#.t...t...#............#',
  '#..P...#..cc....#....*....#....*......E#',
  '#......#......c.#.t...t...#...........E#',
  '#......#c...c...#.........#...........E#',
  '###D#######D#########D##########X#######',
  '#......................................#',
  '#....*........*.........*.........*....#',
  '#......................................#',
  '#####D#######O#######D##########D#######',
  '#........#......#.........#............#',
  '#........g..*...#.t.....t.#..c.....c...#',
  '#...*....g......#....*....D...*.....*..#',
  '#....K...g......#.........#.c...c......#',
  '#........g......#...t.....#........c...#',
  '#........#...S..#.........#............#',
  '########################################',
];
export const W = MAP[0].length, H = MAP.length;
export const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? '#' : MAP[y][x];
export const cellOf = v => Math.floor(v / CELL);
export const center = c => c * CELL + CELL / 2;

export function find(ch) {
  const out = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (MAP[y][x] === ch) out.push({ x, y });
  return out;
}

// 문 상태는 world.js 가 채운다: key "x,y" → door
export const doors = new Map();
const isDoor = c => c === 'D' || c === 'X';

// 이동 차단 여부 (상자/책상은 높이가 있어 별도 AABB 로 처리)
export function blocks(x, y) {
  const c = at(x, y);
  if (c === '#' || c === 'g') return true;
  if (isDoor(c)) { const d = doors.get(x + ',' + y); return !!d && !d.passable(); }
  return false;
}
// 시야 차단 (유리는 통과)
export function blocksSight(x, y) {
  const c = at(x, y);
  if (c === '#') return true;
  if (isDoor(c)) { const d = doors.get(x + ',' + y); return !!d && d.open < 0.6 && !d.broken; }
  return false;
}
// 096 길찾기용 통행 가능 칸 (문은 부수고 지나감)
export const walkable096 = (x, y) => { const c = at(x, y); return c !== '#' && c !== 'g' && c !== 'c' && c !== 't'; };

// 두 점 사이 직선 시야 (XZ 평면 + 높이: 벽은 천장까지라 높이 무시)
export function lineClear(ax, az, bx, bz, test = blocksSight) {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), n = Math.ceil(len / 0.25);
  let lx = -1, ly = -1;
  for (let i = 1; i < n; i++) {
    const cx = cellOf(ax + dx * i / n), cy = cellOf(az + dz * i / n);
    if (cx === lx && cy === ly) continue;
    lx = cx; ly = cy;
    if (test(cx, cy)) return false;
  }
  return true;
}

// 원(반지름 r)을 벽에서 밀어낸다
export function collideCircle(p, r) {
  const cx = cellOf(p.x), cz = cellOf(p.z);
  for (let y = cz - 1; y <= cz + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
    if (!blocks(x, y)) continue;
    const minX = x * CELL, minZ = y * CELL;
    const nx = Math.max(minX, Math.min(p.x, minX + CELL)), nz = Math.max(minZ, Math.min(p.z, minZ + CELL));
    let dx = p.x - nx, dz = p.z - nz, d = Math.hypot(dx, dz);
    if (d >= r) continue;
    if (d < 1e-5) { // 중심이 벽 안: 가장 가까운 면으로
      const opts = [[p.x - minX, -1, 0], [minX + CELL - p.x, 1, 0], [p.z - minZ, 0, -1], [minZ + CELL - p.z, 0, 1]].sort((a, b) => a[0] - b[0]);
      p.x += opts[0][1] * (opts[0][0] + r); p.z += opts[0][2] * (opts[0][0] + r);
    } else { p.x += dx / d * (r - d); p.z += dz / d * (r - d); }
  }
}

// BFS 거리장 (목표 칸에서 퍼져나감) — 096 추격용
export function distanceField(tx, ty, ok = walkable096) {
  const f = new Int16Array(W * H).fill(-1), q = [tx + ty * W];
  f[q[0]] = 0;
  for (let i = 0; i < q.length; i++) {
    const k = q[i], x = k % W, y = (k / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, nk = nx + ny * W;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || f[nk] >= 0 || !ok(nx, ny)) continue;
      f[nk] = f[k] + 1; q.push(nk);
    }
  }
  return f;
}
