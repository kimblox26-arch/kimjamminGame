// 기하 도구 (맵 파일에서도 쓰므로 순환 import 를 피해 따로 둠)
export function inPoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// 야외 지형 만들기: 구역 사각형(월드 단위 [x1,y1,x2,y2,floor])에서 건물 자리(solid, px 다각형)를
// gap 만큼 띄워 빼고, 남은 칸을 가로줄 → 세로로 합쳐 사각형 다각형 목록으로 돌려준다.
export function carve(zones, solid, { B, X, Y, gap = 0.45, cell = 0.25, floor = 'snow' }) {
  const out = [];
  const blocked = (x, y) => [-gap, 0, gap].some(dx => [-gap, 0, gap].some(dy => solid.some(p => inPoly(X(x + dx), Y(y + dy), p))));
  for (const [zx1, zy1, zx2, zy2, zf] of zones) {
    const nx = Math.round((zx2 - zx1) / cell), ny = Math.round((zy2 - zy1) / cell), runs = [];
    for (let j = 0; j < ny; j++) {
      const y = zy1 + (j + 0.5) * cell, row = [];
      let s = -1;
      for (let i = 0; i <= nx; i++) {
        const on = i < nx && !blocked(zx1 + (i + 0.5) * cell, y);
        if (on && s < 0) s = i;
        if (!on && s >= 0) { row.push([s, i]); s = -1; }
      }
      runs.push(row);
    }
    const open = new Map();
    for (let j = 0; j <= ny; j++) {
      const row = runs[j] || [], keys = new Set(row.map(r => r.join(',')));
      for (const [k, r] of open) if (!keys.has(k)) { out.push({ poly: B(zx1 + r.a * cell, zy1 + r.j0 * cell, zx1 + r.b * cell, zy1 + (r.j1 + 1) * cell), floor: zf || floor }); open.delete(k); }
      for (const [a, b] of row) { const k = a + ',' + b; if (open.has(k)) open.get(k).j1 = j; else open.set(k, { a, b, j0: j, j1: j }); }
    }
  }
  return out;
}
