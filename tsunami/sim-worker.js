// 쓰나미 전파 계산 (Web Worker)
//  1) 바다: 진원에서 출발한 파면을 다익스트라로 전파. 속도 = √(g·수심) (천수파 속도)
//  2) 육지: 해안에 도달한 파고에서 시작해 내륙으로 갈수록 수위가 깎이며 낮은 땅을 따라 범람
// 결과는 셀마다 [해발, 도달시각(s), 수위(m) 또는 바다 파고, 바다여부] 를 담은 Float32Array.

const G = 9.81;
const NEVER = 1e9;

class Heap {
  constructor(cap) {
    this.idx = new Int32Array(cap);
    this.key = new Float64Array(cap);
    this.n = 0;
  }
  push(i, k) {
    if (this.n === this.idx.length) {
      const idx = new Int32Array(this.n * 2); idx.set(this.idx); this.idx = idx;
      const key = new Float64Array(this.n * 2); key.set(this.key); this.key = key;
    }
    let c = this.n++;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.key[p] <= k) break;
      this.idx[c] = this.idx[p]; this.key[c] = this.key[p]; c = p;
    }
    this.idx[c] = i; this.key[c] = k;
  }
  pop() {
    const top = this.idx[0];
    this.topKey = this.key[0];
    const i = this.idx[--this.n], k = this.key[this.n];
    let c = 0;
    for (;;) {
      let m = 2 * c + 1;
      if (m >= this.n) break;
      if (m + 1 < this.n && this.key[m + 1] < this.key[m]) m++;
      if (this.key[m] >= k) break;
      this.idx[c] = this.idx[m]; this.key[c] = this.key[m]; c = m;
    }
    this.idx[c] = i; this.key[c] = k;
    return top;
  }
}

self.onmessage = (e) => {
  const { width: W, height: H, lat0, lat1, lon0, lon1, elev, epicenter, waveHeight, distanceDecay, inlandDecay } = e.data;
  const N = W * H;
  const dLat = (lat1 - lat0) / H, dLon = (lon1 - lon0) / W;
  const mPerDeg = 111320;
  const dy = dLat * mPerDeg;
  const dxRow = new Float32Array(H);
  for (let r = 0; r < H; r++) dxRow[r] = dLon * mPerDeg * Math.cos((lat1 - (r + 0.5) * dLat) * Math.PI / 180);

  const time = new Float32Array(N).fill(NEVER);
  const dist = new Float32Array(N);
  const level = new Float32Array(N).fill(-NEVER);
  const sea = new Uint8Array(N);
  const DX = [-1, 0, 1, -1, 1, -1, 0, 1], DY = [-1, -1, -1, 0, 0, 1, 1, 1];

  // ── 1) 바다 전파 ──
  const heap = new Heap(1 << 16);
  time[epicenter] = 0;
  heap.push(epicenter, 0);
  while (heap.n) {
    const i = heap.pop();
    if (heap.topKey > time[i]) continue;
    sea[i] = 1;
    const r = (i / W) | 0, c = i - r * W;
    const vi = Math.sqrt(G * Math.max(5, -elev[i]));
    for (let k = 0; k < 8; k++) {
      const cc = c + DX[k], rr = r + DY[k];
      if (cc < 0 || rr < 0 || cc >= W || rr >= H) continue;
      const j = rr * W + cc;
      if (elev[j] > 0) continue;
      const step = Math.hypot(DX[k] * dxRow[r], DY[k] * dy);
      const v = 0.5 * (vi + Math.sqrt(G * Math.max(5, -elev[j])));
      const t = time[i] + step / v;
      if (t < time[j]) { time[j] = t; dist[j] = dist[i] + step; heap.push(j, time[j]); }  // 키는 Float32 로 저장된 값 그대로
    }
  }

  // 거리 감쇠: 원형 확산으로 파고가 √(R0/(R0+r)) 비율로 줄어든다 (R0 = 50 km)
  const R0 = 50000;
  const amp = (i) => distanceDecay ? waveHeight * Math.sqrt(R0 / (R0 + dist[i])) : waveHeight;

  // ── 2) 육지 범람: 수위가 높은 곳부터 처리하는 우선순위 범람 (최대 힙 = 키에 음수) ──
  const land = new Heap(1 << 16);
  for (let i = 0; i < N; i++) {
    if (!sea[i]) continue;
    const r = (i / W) | 0, c = i - r * W;
    for (let k = 0; k < 8; k++) {
      const cc = c + DX[k], rr = r + DY[k];
      if (cc < 0 || rr < 0 || cc >= W || rr >= H) continue;
      if (!sea[rr * W + cc]) { level[i] = amp(i); land.push(i, -level[i]); break; }
    }
  }
  const decayPerM = inlandDecay / 1000;
  while (land.n) {
    const i = land.pop();
    if (-land.topKey < level[i]) continue;
    const r = (i / W) | 0, c = i - r * W;
    const depth = sea[i] ? level[i] : level[i] - elev[i];
    // 범람 흐름 속도: 얕을수록 느려짐 (마찰 고려해 천수파 속도의 절반, 2~25 m/s)
    const v = Math.min(25, Math.max(2, 0.5 * Math.sqrt(G * Math.max(0, depth))));
    for (let k = 0; k < 8; k++) {
      const cc = c + DX[k], rr = r + DY[k];
      if (cc < 0 || rr < 0 || cc >= W || rr >= H) continue;
      const j = rr * W + cc;
      if (sea[j]) continue;
      const step = Math.hypot(DX[k] * dxRow[r], DY[k] * dy);
      const lv = level[i] - decayPerM * step;
      if (lv <= level[j]) continue;
      level[j] = lv;
      time[j] = time[i] + step / v;
      if (lv > elev[j]) land.push(j, -level[j]);
    }
  }

  // ── 결과 정리 + 시간별 침수 면적 누적 ──
  const out = new Float32Array(N * 4);
  let tMax = 0, seaMax = 0;
  for (let i = 0; i < N; i++) {
    out[4 * i] = elev[i];
    out[4 * i + 1] = time[i];
    out[4 * i + 2] = sea[i] ? amp(i) : level[i];
    out[4 * i + 3] = sea[i];
    if (sea[i]) seaMax = Math.max(seaMax, time[i]);
    else if (level[i] > elev[i]) tMax = Math.max(tMax, time[i]);
  }
  if (tMax === 0) tMax = Math.min(seaMax, 4 * 3600);
  const BINS = 240;
  const area = new Float64Array(BINS + 1);
  for (let i = 0; i < N; i++) {
    if (sea[i] || level[i] <= elev[i]) continue;
    const r = (i / W) | 0;
    const b = Math.min(BINS, Math.ceil(time[i] / tMax * BINS));
    area[b] += dxRow[r] * dy / 1e6;
  }
  for (let b = 1; b <= BINS; b++) area[b] += area[b - 1];

  self.postMessage({ data: out, tMax, area }, [out.buffer, area.buffer]);
};
