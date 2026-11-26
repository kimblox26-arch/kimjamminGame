// 길찾기: 건물·벽·기둥(충돌 상자)을 피해 돌아가는 길 (격자 A* + 직선 구간 다듬기)
import * as THREE from 'three';
import { activeAt } from './zones.js';

// 선분이 (여유 pad 만큼 넓힌) 상자를 지나가는지
function segHits(k, ax, az, bx, bz, pad) {
  const x0 = k.x0 - pad, x1 = k.x1 + pad, z0 = k.z0 - pad, z1 = k.z1 + pad, dx = bx - ax, dz = bz - az; let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dz, az - z0], [dz, z1 - az]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
export function lineClear(cols, a, b, feet = 0, pad = 0.3) {
  const mnx = Math.min(a.x, b.x) - pad, mxx = Math.max(a.x, b.x) + pad, mnz = Math.min(a.z, b.z) - pad, mxz = Math.max(a.z, b.z) + pad;
  for (const k of cols) { if (k.x1 < mnx || k.x0 > mxx || k.z1 < mnz || k.z0 > mxz || !activeAt(k, feet)) continue; if (segHits(k, a.x, a.z, b.x, b.z, pad)) return false; }
  return true;
}
export function findPath(cols, a, b, feet = 0, m = 16) {
  const r = findPath1(cols, a, b, feet, m); if (r || m > 16) return r; return findPath1(cols, a, b, feet, Math.min(60, 20 + a.distanceTo(b) * 0.6));
}
function findPath1(cols, a, b, feet, m) {
  const C = 0.6, pad = 0.32, x0 = Math.min(a.x, b.x) - m, z0 = Math.min(a.z, b.z) - m;
  const W = Math.ceil((Math.abs(a.x - b.x) + 2 * m) / C), H = Math.ceil((Math.abs(a.z - b.z) + 2 * m) / C); if (W * H > 60000) return null;
  const grid = new Uint8Array(W * H), X1 = x0 + W * C, Z1 = z0 + H * C;
  for (const k of cols) {
    if (k.x1 + pad < x0 || k.x0 - pad > X1 || k.z1 + pad < z0 || k.z0 - pad > Z1 || !activeAt(k, feet)) continue;
    const i0 = Math.max(0, Math.floor((k.x0 - pad - x0) / C)), i1 = Math.min(W - 1, Math.floor((k.x1 + pad - x0) / C)), j0 = Math.max(0, Math.floor((k.z0 - pad - z0) / C)), j1 = Math.min(H - 1, Math.floor((k.z1 + pad - z0) / C));
    for (let j = j0; j <= j1; j++) grid.fill(1, j * W + i0, j * W + i1 + 1);
  }
  const idx = p => Math.min(H - 1, Math.max(0, Math.floor((p.z - z0) / C))) * W + Math.min(W - 1, Math.max(0, Math.floor((p.x - x0) / C)));
  const s = idx(a), t = idx(b); grid[s] = 0; grid[t] = 0;
  const g = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), heap = [], hv = [];
  const ti = t % W, tj = (t / W) | 0, hf = n => { const di = Math.abs(n % W - ti), dj = Math.abs(((n / W) | 0) - tj); return (Math.max(di, dj) + 0.414 * Math.min(di, dj)) * C; };
  const push = (n, f) => { heap.push(n); hv.push(f); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hv[p] <= hv[i]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p; } };
  const pop = () => { const top = heap[0], lastN = heap.pop(), lastV = hv.pop(); if (heap.length) { heap[0] = lastN; hv[0] = lastV; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m2 = i; if (l < heap.length && hv[l] < hv[m2]) m2 = l; if (r < heap.length && hv[r] < hv[m2]) m2 = r; if (m2 === i) break; [heap[m2], heap[i]] = [heap[i], heap[m2]]; [hv[m2], hv[i]] = [hv[i], hv[m2]]; i = m2; } } return top; };
  const closed = new Uint8Array(W * H); g[s] = 0; push(s, hf(s)); let found = false, it = 0;
  while (heap.length && it++ < 120000) {
    const n = pop(); if (closed[n]) continue; closed[n] = 1; if (n === t) { found = true; break; }
    const ni = n % W, nj = (n / W) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const ii = ni + di, jj = nj + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      const q = jj * W + ii; if (grid[q]) continue; if (di && dj && (grid[nj * W + ii] || grid[jj * W + ni])) continue;   // 모서리 끼어들기 금지
      const ng = g[n] + (di && dj ? 1.414 : 1) * C; if (ng < g[q]) { g[q] = ng; from[q] = n; push(q, ng + hf(q)); }
    }
  }
  if (!found) return null;
  const pts = []; for (let n = t; n !== -1 && n !== s; n = from[n]) pts.push(new THREE.Vector3(x0 + (n % W + 0.5) * C, feet, z0 + (((n / W) | 0) + 0.5) * C));
  pts.reverse(); pts[pts.length - 1] = b.clone().setY(feet);
  // 보이는 곳까지는 곧장 (지그재그 없이 자연스럽게)
  const out = []; let cur = a.clone(), i = 0;
  while (i < pts.length) { let j = pts.length - 1; while (j > i && !lineClear(cols, cur, pts[j], feet, pad * 0.9)) j--; out.push(pts[j]); cur = pts[j]; i = j + 1; }
  return out;
}
