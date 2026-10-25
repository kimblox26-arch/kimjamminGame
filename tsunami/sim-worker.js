// 쓰나미 전파 계산 (Web Worker)
//  1) 바다: 진원에서 출발한 파면을 다익스트라로 전파. 속도 = √(g·수심) (천수파 속도)
//  2) 육지: 해안에 도달한 파고에서 시작해 내륙으로 갈수록 수위가 깎이며 낮은 땅을 따라 범람
// 영상 재현용 옵션: seaSpeed 를 주면 바다는 고정 속도, landSpeed 를 주면 육지는 수심 30 m 기준 속도에
// √(수심/30) 을 곱한 속도(¼~2배로 제한), decayLength 를 주면 거리 감쇠를 지수형 exp(-r/L) 로 계산한다.
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
  const { width: W, height: H, lat0, lat1, lon0, lon1, elev, epicenter, waveHeight, distanceDecay, inlandDecay, seaSpeed, landSpeed, decayRadius, decayLength, cellSize } = e.data;
  const N = W * H;
  const dLat = (lat1 - lat0) / H, dLon = (lon1 - lon0) / W;
  const mPerDeg = 111320;
  // cellSize(행별 정사각형 셀 한 변, m)를 주면 메르카토르 격자(세계 지도), 아니면 위경도 등간격 격자
  const dxRow = new Float32Array(H), dyRow = new Float32Array(H);
  for (let r = 0; r < H; r++) {
    dxRow[r] = cellSize ? cellSize[r] : dLon * mPerDeg * Math.cos((lat1 - (r + 0.5) * dLat) * Math.PI / 180);
    dyRow[r] = cellSize ? cellSize[r] : dLat * mPerDeg;
  }

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
    const vi = seaSpeed || Math.sqrt(G * Math.max(5, -elev[i]));
    for (let k = 0; k < 8; k++) {
      const cc = c + DX[k], rr = r + DY[k];
      if (cc < 0 || rr < 0 || cc >= W || rr >= H) continue;
      const j = rr * W + cc;
      if (elev[j] > 0) continue;
      const step = Math.hypot(DX[k] * dxRow[r], DY[k] * dyRow[r]);
      const v = seaSpeed || 0.5 * (vi + Math.sqrt(G * Math.max(5, -elev[j])));
      // Float32 배열과 비교하므로 후보값도 Float32 로 맞춰야 반올림 오차로 같은 셀을 끝없이 갱신하지 않는다
      const t = Math.fround(time[i] + step / v);
      if (t < time[j]) { time[j] = t; dist[j] = dist[i] + step; heap.push(j, t); }
    }
  }

  // 거리 감쇠: 원형 확산으로 파고가 √(R0/(R0+r)) 비율로 줄어든다 (기본 R0 = 50 km)
  const R0 = decayRadius || 50000;
  const amp = (i) => !distanceDecay ? waveHeight
    : decayLength ? waveHeight * Math.exp(-dist[i] / decayLength) : waveHeight * Math.sqrt(R0 / (R0 + dist[i]));

  // ── 2) 육지 수위: 수위가 높은 곳부터 처리하는 우선순위 범람 (최대 힙 = 키에 음수) ──
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
    for (let k = 0; k < 8; k++) {
      const cc = c + DX[k], rr = r + DY[k];
      if (cc < 0 || rr < 0 || cc >= W || rr >= H) continue;
      const j = rr * W + cc;
      if (sea[j]) continue;
      const lv = Math.fround(level[i] - decayPerM * Math.hypot(DX[k] * dxRow[r], DY[k] * dyRow[r]));
      if (lv <= level[j]) continue;
      level[j] = lv;
      if (lv > elev[j]) land.push(j, -lv);
    }
  }

  // ── 3) 도달 시각: 해안에서 잠긴 땅을 따라 가장 빨리 닿는 경로 ──
  // 범람 흐름 속도: 물이 얕을수록 느려짐 (물리 모드는 천수파 속도의 절반, 2~25 m/s)
  const flowSpeed = (depth) => landSpeed ? landSpeed * Math.min(2, Math.max(0.25, Math.sqrt(depth / 30)))
    : Math.min(25, Math.max(2, 0.5 * Math.sqrt(G * depth)));
  const flow = new Heap(1 << 16);
  for (let i = 0; i < N; i++) if (sea[i] && level[i] > -NEVER) flow.push(i, time[i]);
  while (flow.n) {
    const i = flow.pop();
    if (flow.topKey > time[i]) continue;
    const r = (i / W) | 0, c = i - r * W;
    const di = sea[i] ? level[i] : level[i] - elev[i];
    for (let k = 0; k < 8; k++) {
      const cc = c + DX[k], rr = r + DY[k];
      if (cc < 0 || rr < 0 || cc >= W || rr >= H) continue;
      const j = rr * W + cc;
      if (sea[j] || level[j] === -NEVER) continue;
      const v = flowSpeed(Math.max(0, (di + Math.max(0, level[j] - elev[j])) / 2));
      const t = Math.fround(time[i] + Math.hypot(DX[k] * dxRow[r], DY[k] * dyRow[r]) / v);
      if (t >= time[j]) continue;
      time[j] = t;
      if (level[j] > elev[j]) flow.push(j, t);
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
    area[b] += dxRow[r] * dyRow[r] / 1e6;
  }
  for (let b = 1; b <= BINS; b++) area[b] += area[b - 1];

  self.postMessage({ data: out, tMax, area }, [out.buffer, area.buffer]);
};
