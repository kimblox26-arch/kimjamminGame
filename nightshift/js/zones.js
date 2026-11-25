// 높이가 다른 곳(계단·지하·건물 층·옥상)과 층별 충돌. 모든 건물·지하가 여기에 등록함.
export const RAMPS = [], FLOORS = [];
const inR = (r, x, z) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
// 발밑 높이: 계단이면 비탈, 층 바닥 위면 그 층, 아니면 길바닥(0)
export function groundAt(x, z, feet) {
  for (const r of RAMPS) if (inR(r, x, z)) { const c = r.axis === 'x' ? x : z, t = Math.min(1, Math.max(0, (c - r.from) / (r.to - r.from))); return r.y0 + (r.y1 - r.y0) * t; }
  let best = null;
  for (const f of FLOORS) if (inR(f, x, z) && feet > f.y - 1.3 && feet < f.y + 1.2 && (best === null || Math.abs(f.y - feet) < Math.abs(best - feet))) best = f.y;
  if (best !== null) return best;
  return feet < -1.3 ? feet : 0;
}
// 충돌 상자가 지금 높이에서 유효한지: lv 0(지상) / -1(지하) / 'all' / y0~y1(건물 층)
export function activeAt(c, feet) {
  if (c.lv === 'all') return true;
  if (c.y0 !== undefined) return feet > c.y0 - 0.6 && feet < c.y1;
  const lv = c.lv ?? 0;
  return lv === -1 ? feet < -1.5 : feet >= -1.5 && feet < 2.5;
}
