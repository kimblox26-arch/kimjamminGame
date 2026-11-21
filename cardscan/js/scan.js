// 카메라 한 장면에서 카드 지문 후보들을 만든다 (브라우저/테스트 공용, DOM 없음)
import { toGray, integral, cardHash } from './hash.js?v=7';

const CARD_RATIO = 63 / 88; // 가로/세로

// 가이드 근처에서 카드 테두리(가장 바깥쪽 강한 경계선)를 찾는다
function findEdge(rgba, w, h, guide, bx, by) {
  const gw = guide.x1 - guide.x0, gh = guide.y1 - guide.y0;
  const diffAt = (a, b) => {
    const i = a * 4, j = b * 4;
    return Math.abs(rgba[i] - rgba[j]) + Math.abs(rgba[i + 1] - rgba[j + 1]) + Math.abs(rgba[i + 2] - rgba[j + 2]);
  };
  // 세로선 강도: 열 x 에서 행 범위의 가로 방향 차이 합
  const colScore = (x, ya, yb) => {
    let s = 0;
    for (let y = ya; y < yb; y += 2) s += diffAt(y * w + x, y * w + x - 1);
    return s / ((yb - ya) / 2);
  };
  const rowScore = (y, xa, xb) => {
    let s = 0;
    for (let x = xa; x < xb; x += 2) s += diffAt(y * w + x, (y - 1) * w + x);
    return s / ((xb - xa) / 2);
  };
  // 범위 [a,b] 에서 경계 위치 찾기. outerFirst: 바깥쪽부터 보며 최대치의 60% 넘는 첫 봉우리
  const pick = (a, b, score, fromLow) => {
    a = Math.max(1, Math.round(a)); b = Math.round(b);
    const vals = [];
    let max = 0;
    for (let p = a; p <= b; p++) { const v = score(p); vals.push(v); if (v > max) max = v; }
    if (max < 25) return null; // 경계가 너무 약함
    const idx = fromLow ? [...vals.keys()] : [...vals.keys()].reverse();
    for (const k of idx) {
      const v = vals[k];
      if (v >= max * 0.6 && v >= (vals[k - 1] ?? 0) && v >= (vals[k + 1] ?? 0)) return a + k;
    }
    return null;
  };
  const mx = gw * bx, my = gh * by;
  const ya = Math.round(guide.y0 + gh * 0.2), yb = Math.round(guide.y1 - gh * 0.2);
  const xa = Math.round(guide.x0 + gw * 0.2), xb = Math.round(guide.x1 - gw * 0.2);
  const x0 = pick(guide.x0 - mx, Math.min(guide.x0 + mx, w - 2), x => colScore(x, ya, yb), true);
  const x1 = pick(Math.max(guide.x1 - mx, 1), Math.min(guide.x1 + mx, w - 1), x => colScore(x, ya, yb), false);
  const y0 = pick(guide.y0 - my, Math.min(guide.y0 + my, h - 2), y => rowScore(y, xa, xb), true);
  const y1 = pick(Math.max(guide.y1 - my, 1), Math.min(guide.y1 + my, h - 1), y => rowScore(y, xa, xb), false);
  if ([x0, x1, y0, y1].some(v => v == null)) return null;
  const ratio = (x1 - x0) / (y1 - y0);
  if (Math.abs(ratio - CARD_RATIO) > 0.07) return null;
  return { x0, y0, x1, y1 };
}

function variants(r, scales, shifts) {
  const out = [];
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  const w = r.x1 - r.x0, h = r.y1 - r.y0;
  for (const s of scales)
    for (const dx of shifts)
      for (const dy of shifts) {
        const nw = w * s, nh = h * s;
        const x = cx + dx * w, y = cy + dy * h;
        out.push({ x0: x - nw / 2, y0: y - nh / 2, x1: x + nw / 2, y1: y + nh / 2 });
      }
  return out;
}

// rgba: 카메라 크롭 이미지(RGBA), guide: 그 안에서 카드가 있어야 할 사각형
// 반환: { queries: [[4 x uint32], ...], edge: 찾은 테두리 or null }
export function makeQueries(rgba, w, h, guide) {
  const I = integral(toGray(rgba, w, h, 4), w, h);
  const rects = variants(guide, [0.86, 0.93, 1, 1.07, 1.14], [-0.03, 0, 0.03]);
  // 테두리 찾기: 좁은 범위 / 넓은 범위 두 번 (카드가 가이드보다 많이 크거나 어긋나 있어도 찾도록)
  let edge = null;
  for (const [bx, by] of [[0.14, 0.12], [0.19, 0.18]]) {
    const e = findEdge(rgba, w, h, guide, bx, by);
    if (!e || (edge && Math.abs(e.x0 - edge.x0) + Math.abs(e.y0 - edge.y0) + Math.abs(e.x1 - edge.x1) + Math.abs(e.y1 - edge.y1) < 4)) continue;
    edge = e;
    rects.push(...variants(e, [0.97, 1, 1.03], [-0.015, 0, 0.015]));
  }
  return { queries: rects.map(r => cardHash(I, r.x0, r.y0, r.x1, r.y1)), edge };
}
