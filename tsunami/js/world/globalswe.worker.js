// 전 지구 쓰나미 전파 (웹 워커)
//  구면 좌표 선형 장파 방정식 (MOST/COMCOT 방식), 엇갈린 C-격자, 경도 방향 주기 경계
//    ∂η/∂t + 1/(R cosφ)·[∂M/∂λ + ∂(N cosφ)/∂φ] = 0
//    ∂M/∂t + gD/(R cosφ)·∂η/∂λ − fN = −마찰
//    ∂N/∂t + gD/R·∂η/∂φ      + fM = −마찰
//  M, N: 동·북 방향 체적 플럭스 (m²/s), D: 수심, f = 2Ω sinφ (코리올리)
//  육지 = 벽(반사), 고위도(|φ|>76°)는 흡수층이 있는 벽

const G = 9.81, RE = 6371000, OMEGA = 7.2921e-5, LAT_LIM = 76, MANNING = 0.025;
let W = 0, H = 0, D = null, eta = null, M = null, N = null, maxE = null, arr = null;
let kx = null, cosC = null, cosF = null, fC = null, fF = null, sponge = null;
let dt = 10, ky = 0, dLam = 0, dPhi = 0, t = 0, active = false, paused = false, scale = 600;
let debt = 0, last = 0, lastPost = 0, frameNo = 0, stepsDone = 0, stepsWindow = 0, winStart = 0, stepsPerSec = 0;
const pool = [];
let gauge = null;          // { k, lon, lat, depth }
let gaugeBuf = [];         // 최근 게시 이후의 표본 [t, eta]
let dirty = true;          // 화면에 보낼 변화가 있는가
let lastGaugeT = -1e9;

function rowLat(j) { return 90 - (j + 0.5) * 180 / H; }

function init(m) {
  const srcW = m.W, srcH = m.H, f = m.factor || 1;
  W = srcW / f; H = srcH / f;
  D = new Float32Array(W * H);
  // 블록 평균 (바다 셀이 절반 이상일 때만 바다)
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let sum = 0, n = 0;
    for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) {
      const e = m.elev[(j * f + b) * srcW + i * f + a];
      if (e < 0) { sum += -e; n++; }
    }
    const lat = rowLat(j);
    D[j * W + i] = n * 2 >= f * f && Math.abs(lat) < LAT_LIM ? Math.max(20, sum / n) : 0;
  }
  eta = new Float32Array(W * H);
  M = new Float32Array(W * H);
  N = new Float32Array(W * (H + 1));
  maxE = new Float32Array(W * H);
  arr = new Float32Array(W * H).fill(-1);
  dLam = (2 * Math.PI) / W; dPhi = Math.PI / H;
  ky = 1 / (RE * dPhi);
  kx = new Float32Array(H); cosC = new Float32Array(H); fC = new Float32Array(H);
  cosF = new Float32Array(H + 1); fF = new Float32Array(H + 1); sponge = new Float32Array(H);
  for (let j = 0; j < H; j++) {
    const phi = rowLat(j) * Math.PI / 180;
    cosC[j] = Math.max(0.05, Math.cos(phi));
    kx[j] = 1 / (RE * cosC[j] * dLam);
    fC[j] = 2 * OMEGA * Math.sin(phi);
    // 고위도 흡수층 (벽 근처 8° 구간)
    const a = Math.abs(rowLat(j));
    sponge[j] = a > LAT_LIM - 8 ? ((a - (LAT_LIM - 8)) / 8) ** 2 * 0.02 : 0;
  }
  for (let j = 0; j <= H; j++) {
    const phi = (90 - j * 180 / H) * Math.PI / 180;
    cosF[j] = Math.max(0, Math.cos(phi));
    fF[j] = 2 * OMEGA * Math.sin(phi);
  }
  // CFL: 가장 빠른 파속 / 가장 좁은 격자
  let worst = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const d = D[j * W + i];
    if (d <= 0) continue;
    const c = Math.sqrt(G * d), dx = RE * cosC[j] * dLam, dy = RE * dPhi;
    const r = c * Math.sqrt(1 / (dx * dx) + 1 / (dy * dy));
    if (r > worst) worst = r;
  }
  dt = 0.62 / worst;
  for (let n = 0; n < 3; n++) pool.push(new Float32Array(W * H));
  postMessage({ type: 'ready', W, H, dt });
}

function reset() {
  eta.fill(0); M.fill(0); N.fill(0); maxE.fill(0); arr.fill(-1);
  t = 0; active = false; debt = 0; gaugeBuf = []; lastGaugeT = -1e9; stepsDone = 0;
  dirty = true;
}

function step() {
  const w = W, h = H;
  // ── 연속식: η ← η − dt·∇·(M,N)
  for (let j = 0; j < h; j++) {
    const row = j * w, kxj = kx[j], kyj = ky / cosC[j], cn = cosF[j], cs = cosF[j + 1], sp = sponge[j];
    for (let i = 0; i < w; i++) {
      const c = row + i;
      if (D[c] === 0) continue;
      const me = i === w - 1 ? M[row] : M[c + 1];
      const div = kxj * (me - M[c]) + kyj * (N[c] * cn - N[c + w] * cs);
      let e = eta[c] - dt * div;
      if (sp > 0) e *= 1 - sp;
      eta[c] = e;
      const ae = e < 0 ? -e : e;
      if (e > maxE[c]) maxE[c] = e;
      if (ae > 0.02 && arr[c] < 0) arr[c] = t;
    }
  }
  t += dt;
  // ── 동서 플럭스 M (서쪽 면)
  for (let j = 0; j < h; j++) {
    const row = j * w, gk = G * kx[j] * dt, fdt = fC[j] * dt * 0.25, sp = sponge[j];
    for (let i = 0; i < w; i++) {
      const c = row + i, l = i === 0 ? row + w - 1 : c - 1;
      const dL = D[l], dR = D[c];
      if (dL === 0 || dR === 0) { M[c] = 0; continue; }
      const df = 0.5 * (dL + dR);
      const nav = N[l] + N[c] + N[l + w] + N[c + w];
      let m = M[c] - gk * df * (eta[c] - eta[l]) + fdt * nav;
      if (df < 200) { const u = m / df; m /= 1 + dt * G * MANNING * MANNING * (u < 0 ? -u : u) / (df * Math.cbrt(df)); }
      if (sp > 0) m *= 1 - sp;
      M[c] = m;
    }
  }
  // ── 남북 플럭스 N (북쪽 면, j=1..H-1)
  const gky = G * dt / (RE * dPhi);
  for (let j = 1; j < h; j++) {
    const row = j * w, rowN = row - w, fdt = fF[j] * dt * 0.25, sp = Math.max(sponge[j], sponge[j - 1]);
    for (let i = 0; i < w; i++) {
      const c = row + i, cn = rowN + i;
      const dN = D[cn], dS = D[c];
      if (dN === 0 || dS === 0) { N[c] = 0; continue; }
      const df = 0.5 * (dN + dS);
      const i1 = i === w - 1 ? 0 : i + 1;
      const mav = M[cn] + M[rowN + i1] + M[c] + M[row + i1];
      let n = N[c] - gky * df * (eta[cn] - eta[c]) - fdt * mav;
      if (df < 200) { const v = n / df; n /= 1 + dt * G * MANNING * MANNING * (v < 0 ? -v : v) / (df * Math.cbrt(df)); }
      if (sp > 0) n *= 1 - sp;
      N[c] = n;
    }
  }
  // 관측점 기록 (약 10초 간격)
  if (gauge && t - lastGaugeT >= 10) {
    lastGaugeT = t;
    gaugeBuf.push(t, eta[gauge.k]);
  }
  stepsDone++;
  dirty = true;
}

// ── 발생원: 초기 수면 변위 ─────────────────────────────────────────
function addSource(s) {
  const lat0 = s.lat, lon0 = s.lon, cl = Math.cos(lat0 * Math.PI / 180);
  const L = Math.max(5, s.length_km), Wd = Math.max(5, s.width_km), A = s.height_m;
  const th = (s.strike_deg || 0) * Math.PI / 180;
  const sx = Math.sin(th), sy = Math.cos(th);          // 주향 (동, 북)
  const nx = Math.cos(th), ny = -Math.sin(th);          // 주향의 오른쪽
  const reach = (s.type === 'impact' ? L * 0.9 : Math.max(L, Wd) * 0.9) / 111.32;
  const j0 = Math.max(0, Math.floor((90 - (lat0 + reach)) / (180 / H)));
  const j1 = Math.min(H - 1, Math.ceil((90 - (lat0 - reach)) / (180 / H)));
  for (let j = j0; j <= j1; j++) {
    const lat = rowLat(j);
    const dyk = (lat - lat0) * 111.32;
    const span = reach / Math.max(0.05, Math.cos(lat * Math.PI / 180));
    const i0 = Math.floor((lon0 - span + 180) / (360 / W)), i1 = Math.ceil((lon0 + span + 180) / (360 / W));
    for (let ii = i0; ii <= i1; ii++) {
      const i = ((ii % W) + W) % W;
      const c = j * W + i;
      if (D[c] === 0) continue;
      let dl = -180 + (ii + 0.5) * 360 / W - lon0;
      const dxk = dl * 111.32 * cl;
      let d = 0;
      if (s.type === 'quake') {
        const a = dxk * sx + dyk * sy, b = dxk * nx + dyk * ny;
        const along = Math.exp(-((a / (L / 2)) ** 4));
        const up = Math.exp(-(((b + 0.22 * Wd) / (0.3 * Wd)) ** 2));
        const dn = Math.exp(-(((b - 0.3 * Wd) / (0.28 * Wd)) ** 2));
        d = A * along * (up - 0.42 * dn);
      } else if (s.type === 'landslide') {
        const a = dxk * sx + dyk * sy, b = dxk * nx + dyk * ny;
        const along = Math.exp(-((a / (L / 2)) ** 2));
        d = A * along * (0.85 * Math.exp(-(((b + 0.3 * Wd) / (0.3 * Wd)) ** 2)) - Math.exp(-(((b - 0.25 * Wd) / (0.3 * Wd)) ** 2)));
      } else {
        const r = Math.hypot(dxk, dyk), R = L / 2;
        if (r < R) d -= A * (1 - (r / R) ** 2);
        d += 0.35 * A * Math.exp(-(((r - 1.25 * R) / (0.3 * R)) ** 2));
      }
      if (d > -1e-3 && d < 1e-3) continue;
      // 선형 모델: 수심보다 깊게 파일 수 없음
      eta[c] = Math.max(-0.9 * D[c], eta[c] + d);
    }
  }
  active = true;
  dirty = true;
}

function setGauge(lon, lat) {
  let best = null;
  const ci = Math.floor((lon + 180) / (360 / W)), cj = Math.floor((90 - lat) / (180 / H));
  for (let r = 0; r <= 8 && !best; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const j = cj + dj, i = ((ci + di) % W + W) % W;
      if (j < 0 || j >= H) continue;
      const k = j * W + i;
      if (D[k] >= 30 && (!best || Math.hypot(di, dj) < best.r)) best = { k, depth: D[k], r: Math.hypot(di, dj) };
    }
  }
  gauge = best ? { k: best.k, depth: best.depth, lon: -180 + ((best.k % W) + 0.5) * 360 / W, lat: rowLat(Math.floor(best.k / W)) } : null;
  postMessage({ type: 'gauge', gauge });
  if (gauge) { const tt = travelTimes(gauge.k); postMessage({ type: 'tt', tt }, [tt.buffer]); }
}

// 관측점으로부터의 장파 도달 시간(초) — 다익스트라, 이동 비용 = 거리 / √(g·D). 가역성으로 '발생원 → 도시' 시간과 같음
function travelTimes(src) {
  const n = W * H, T = new Float32Array(n).fill(Infinity);
  const heap = new Int32Array(n * 4), hk = new Float32Array(n * 4);
  let hn = 0;
  const push = (k, v) => {
    let i = hn++;
    while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= v) break; heap[i] = heap[p]; hk[i] = hk[p]; i = p; }
    heap[i] = k; hk[i] = v;
  };
  const pop = () => {
    const top = heap[0];
    const k = heap[--hn], v = hk[hn];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= hn) break;
      if (c + 1 < hn && hk[c + 1] < hk[c]) c++;
      if (hk[c] >= v) break;
      heap[i] = heap[c]; hk[i] = hk[c]; i = c;
    }
    heap[i] = k; hk[i] = v;
    return top;
  };
  const dy = RE * Math.PI / H;
  T[src] = 0; push(src, 0);
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (hn > 0 && hn < n * 4 - 8) {
    const tv = hk[0], k = pop();
    if (tv > T[k]) continue;
    const i = k % W, j = (k - i) / W;
    const cx = dy * Math.max(0.02, Math.cos(rowLat(j) * Math.PI / 180)) * (H / W) * 2;
    const ck = Math.sqrt(G * Math.max(D[k], 10));
    for (const [di, dj] of NB) {
      const jj = j + dj;
      if (jj < 0 || jj >= H) continue;
      const kk = jj * W + ((i + di + W) % W);
      if (!(D[kk] > 0)) continue;
      const dist = Math.hypot(di * cx, dj * dy);
      const v = tv + dist * 2 / (ck + Math.sqrt(G * Math.max(D[kk], 10)));
      if (v < T[kk]) { T[kk] = v; push(kk, v); }
    }
  }
  return T;
}

function post(withAux) {
  const buf = pool.pop();
  buf.set(eta);
  const msg = { type: 'frame', t, eta: buf, active, stepsPerSec, gauge: gaugeBuf };
  const tr = [buf.buffer];
  if (withAux) {
    const mx = new Float32Array(maxE), ar = new Float32Array(arr);
    msg.max = mx; msg.arr = ar; tr.push(mx.buffer, ar.buffer);
  }
  gaugeBuf = [];
  postMessage(msg, tr);
}

function tick() {
  const now = performance.now();
  let realDt = (now - last) / 1000;
  last = now;
  if (realDt > 0.25) realDt = 0.25;
  if (W && active && !paused) {
    debt += realDt * scale;
    const t0 = performance.now();
    while (debt >= dt && performance.now() - t0 < 14) { step(); debt -= dt; stepsWindow++; }
    if (debt > dt * 4) debt = dt * 4;   // 따라가지 못하면 그만큼 느려짐 (시간 건너뛰기 없음)
  }
  if (now - winStart > 1000) { stepsPerSec = stepsWindow * 1000 / (now - winStart); stepsWindow = 0; winStart = now; }
  if (W && dirty && pool.length && now - lastPost > 70) {
    lastPost = now;
    frameNo++;
    dirty = false;
    post(frameNo % 8 === 1 || !active);
  }
  setTimeout(tick, active && !paused ? 0 : 25);
}

onmessage = (e) => {
  const m = e.data;
  if (m.cmd === 'init') { init(m); last = performance.now(); tick(); }
  else if (m.cmd === 'source') addSource(m.src);
  else if (m.cmd === 'speed') scale = m.scale;
  else if (m.cmd === 'pause') paused = m.paused;
  else if (m.cmd === 'reset') reset();
  else if (m.cmd === 'gauge') setGauge(m.lon, m.lat);
  else if (m.cmd === 'return') { if (m.buf && m.buf.length === W * H) pool.push(m.buf); }
  else if (m.cmd === 'aux') post(true);
};
