// 지도 데이터 모델: 픽셀 격자(지방 ID) + 지방 소유국 + 국가/도시/바다 + 렌더링 + 실행취소
export const W = 4096, H = 2048;
export const PXKM = (6371 * 2 * Math.PI / W) * (6371 * Math.PI / H); // 적도에서 1픽셀 면적(km²)
const cosT = new Float32Array(H);
for (let y = 0; y < H; y++) cosT[y] = Math.cos(((y + 0.5) / H - 0.5) * Math.PI);

export const M = {
  pid: new Uint16Array(W * H),          // 픽셀 → 지방 ID (0 = 물)
  own: new Int16Array(65536).fill(-1),  // 지방 → 국가 인덱스 (-1 = 무주지)
  prov: [null], countries: [], cities: [], oceans: [],
  edges: new Int32Array(0), cstat: [],
  sel: -1, selProv: 0, name: '내 세계',
  opts: { cLabels: true, flags: true, pBorders: true, pLabels: true, cities: true, oceans: true, ocean: '#6b9fd4', neutral: '#e8e2d2' },
};
let base = null; // 원본 데이터

export const canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
const ctx = canvas.getContext('2d');
const img = ctx.createImageData(W, H);
const px = new Uint32Array(img.data.buffer);
const dist = new Uint8Array(W * H);

// ── 이벤트 ──
const subs = new Set();
export const on = (f) => subs.add(f);
export const emit = (t) => { for (const f of subs) f(t); };

// ── 색 ──
export const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const rgb2hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const pack = ([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
export function randColor() {
  const h = Math.random() * 360, s = 0.45 + Math.random() * 0.3, l = 0.55 + Math.random() * 0.17;
  const f = (n) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return rgb2hex([f(0), f(8), f(4)]);
}
const PALETTE = ['#e9a77b', '#f3d27e', '#a6d49a', '#8cc0e6', '#c4a5dc', '#f2a3a8', '#94d6c8', '#e4c398', '#b9cf8e', '#f5b266', '#d0b3dd', '#9fc3cc'];

let T = {}; // 팔레트 테이블
const bgs = [];
export function buildPalette() {
  const n = M.countries.length + 1;
  T = { base: new Uint32Array(n), border: new Uint32Array(n), pb: new Uint32Array(n), coast: new Uint32Array(n), water: new Uint32Array(32) };
  for (let s = 0; s < n; s++) {
    const rgb = hex2rgb(s ? M.countries[s - 1].color : M.opts.neutral);
    const sel = s > 0 && s - 1 === M.sel;
    const b = sel ? mix(rgb, [255, 255, 255], 0.38) : rgb;
    T.base[s] = pack(b);
    T.border[s] = pack(sel ? [255, 255, 255] : mix(rgb, [25, 22, 30], s ? 0.62 : 0.4));
    T.pb[s] = pack(mix(b, [30, 30, 40], 0.2));
    T.coast[s] = pack(mix(rgb, [20, 35, 60], 0.55));
  }
  const deep = hex2rgb(M.opts.ocean), shallow = mix(deep, [255, 255, 255], 0.3);
  for (let d = 0; d < 32; d++) T.water[d] = pack(mix(shallow, deep, Math.min(1, Math.pow(d / 14, 0.8))));
}

// ── 렌더링 ──
function renderRect(x0, y0, x1, y1) {
  const { pid, own } = M, pbOn = M.opts.pBorders;
  const { base: B, border: BD, pb: PB, coast: C, water: WT } = T;
  for (let y = y0; y < y1; y++) {
    const row = y * W, up = y > 0 ? row - W : row, dn = y < H - 1 ? row + W : row;
    for (let x = x0; x < x1; x++) {
      const i = row + x, p = pid[i];
      if (!p) { px[i] = WT[dist[i]]; continue; }
      const pl = pid[x ? i - 1 : row + W - 1], pr = pid[x < W - 1 ? i + 1 : row], pu = pid[up + x], pd = pid[dn + x];
      const o = own[p] + 1;
      let c;
      if (!pl || !pr || !pu || !pd) c = C[o];
      else if (own[pl] + 1 !== o || own[pr] + 1 !== o || own[pu] + 1 !== o || own[pd] + 1 !== o) c = BD[o];
      else if (pbOn && (pl !== p || pr !== p || pu !== p || pd !== p)) c = PB[o];
      else if (bgs[o]) {
        const b = bgs[o]; let dx = x - b.x0; dx = ((dx % W) + W) % W;
        const u = ((dx / b.sw * b.w) | 0) % b.w, v = Math.min(b.h - 1, Math.max(0, ((y - b.y0) / b.sh * b.h) | 0));
        c = b.d[v * b.w + u];
      } else c = B[o];
      px[i] = c;
    }
  }
  ctx.putImageData(img, 0, 0, x0, y0, x1 - x0, y1 - y0);
}
function dirtyRaw(x0, y0, x1, y1) {
  x0 = Math.floor(x0) - 1; y0 = Math.max(0, Math.floor(y0) - 1); x1 = Math.ceil(x1) + 1; y1 = Math.min(H, Math.ceil(y1) + 1);
  if (y1 <= y0) return;
  if (x1 - x0 >= W) { x0 = 0; x1 = W; }
  if (x0 < 0) { renderRect(x0 + W, y0, W, y1); x0 = 0; }
  if (x1 > W) { renderRect(0, y0, x1 - W, y1); x1 = W; }
  if (x1 > x0) renderRect(x0, y0, x1, y1);
}
export function dirty(x0, y0, x1, y1) { dirtyRaw(x0, y0, x1, y1); emit('map'); }
export function renderAll() { renderRect(0, 0, W, H); emit('map'); }
const dirtyProv = (p) => { const q = M.prov[p]; if (q && q.cnt) dirtyRaw(q.x0, q.y0, q.x1, q.y1); };
export function renderCountry(o) { for (let p = 1; p < M.prov.length; p++) if (M.own[p] === o) dirtyProv(p); emit('map'); }

function computeDist() {
  const { pid } = M;
  for (let i = 0; i < W * H; i++) dist[i] = pid[i] ? 0 : 31;
  for (let y = 1; y < H; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; if (!dist[i]) continue;
    const m = Math.min(dist[i - 1], dist[i - W], dist[i - W - 1], dist[i - W + 1]) + 1;
    if (m < dist[i]) dist[i] = m;
  }
  for (let y = H - 2; y >= 0; y--) for (let x = W - 2; x > 0; x--) {
    const i = y * W + x; if (!dist[i]) continue;
    const m = Math.min(dist[i + 1], dist[i + W], dist[i + W + 1], dist[i + W - 1]) + 1;
    if (m < dist[i]) dist[i] = m;
  }
}

// ── 분석 (면적, 중심, 경계 상자, 인접) ──
export function analyzePixels() {
  const n = M.prov.length, { pid } = M;
  const cnt = new Int32Array(n), ar = new Float64Array(n), sx = new Float64Array(n), sy = new Float64Array(n);
  const ref = new Int32Array(n).fill(-1), rx0 = new Int32Array(n), rx1 = new Int32Array(n), y0 = new Int32Array(n), y1 = new Int32Array(n);
  const adj = new Set();
  for (let y = 0; y < H; y++) {
    const row = y * W, cw = cosT[y];
    for (let x = 0; x < W; x++) {
      const i = row + x, p = pid[i];
      if (!p) continue;
      if (ref[p] < 0) { ref[p] = x; rx0[p] = rx1[p] = 0; y0[p] = y; }
      let dx = x - ref[p]; if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
      cnt[p]++; ar[p] += cw; sx[p] += dx; sy[p] += y;
      if (dx < rx0[p]) rx0[p] = dx; if (dx > rx1[p]) rx1[p] = dx; y1[p] = y;
      const r = pid[x < W - 1 ? i + 1 : row];
      if (r && r !== p) adj.add(p < r ? p * 65536 + r : r * 65536 + p);
      if (y < H - 1) { const d = pid[i + W]; if (d && d !== p) adj.add(p < d ? p * 65536 + d : d * 65536 + p); }
    }
  }
  for (let p = 1; p < n; p++) {
    const q = M.prov[p]; if (!q) continue;
    q.cnt = cnt[p]; q.area = ar[p] * PXKM;
    if (cnt[p]) {
      q.cx = (((ref[p] + sx[p] / cnt[p]) % W) + W) % W + 0.5; q.cy = sy[p] / cnt[p] + 0.5;
      q.x0 = ref[p] + rx0[p]; q.x1 = ref[p] + rx1[p] + 1; q.y0 = y0[p]; q.y1 = y1[p] + 1;
    }
  }
  const e = new Int32Array(adj.size * 2); let k = 0;
  for (const v of adj) { e[k++] = Math.floor(v / 65536); e[k++] = v % 65536; }
  M.edges = e;
}

export function analyzeCountries() {
  const P = M.prov.length, { own, prov, edges } = M, nc = M.countries.length;
  const par = new Int32Array(P); for (let i = 0; i < P; i++) par[i] = i;
  const find = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
  for (let k = 0; k < edges.length; k += 2) {
    const a = edges[k], b = edges[k + 1];
    if (own[a] >= 0 && own[a] === own[b]) { const ra = find(a), rb = find(b); if (ra !== rb) par[ra] = rb; }
  }
  const st = Array.from({ length: nc }, () => ({ area: 0, np: 0, cnt: 0, root: -1, best: 0 }));
  const cA = new Float64Array(P), cC = new Int32Array(P);
  for (let p = 1; p < P; p++) {
    const q = prov[p], o = own[p];
    if (!q || !q.cnt || o < 0 || o >= nc) continue;
    st[o].area += q.area; st[o].np++;
    const r = find(p); cA[r] += q.area; cC[r] += q.cnt;
  }
  for (let p = 1; p < P; p++) {
    const q = prov[p], o = own[p];
    if (!q || !q.cnt || o < 0 || o >= nc) continue;
    const r = find(p), s = st[o];
    if (s.root < 0 || cA[r] > cA[s.root]) s.root = r;
    if (r === s.root && (!s.best || q.cnt > prov[s.best].cnt || find(s.best) !== r)) s.best = p;
  }
  // 라벨 위치 = 가장 큰 덩어리의 면적 가중 중심
  const acc = st.map(() => [0, 0, 0, Infinity, -Infinity, Infinity, -Infinity]);
  for (let p = 1; p < P; p++) {
    const q = prov[p], o = own[p];
    if (!q || !q.cnt || o < 0 || o >= nc || find(p) !== st[o].root) continue;
    const a = acc[o], anc = prov[st[o].best];
    let dx = q.cx - anc.cx; if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
    a[0] += dx * q.cnt; a[1] += q.cy * q.cnt; a[2] += q.cnt;
    const ox = dx - q.cx;
    a[3] = Math.min(a[3], q.x0 + ox); a[4] = Math.max(a[4], q.x1 + ox); a[5] = Math.min(a[5], q.y0); a[6] = Math.max(a[6], q.y1);
  }
  st.forEach((s, o) => {
    if (s.root < 0) return;
    const a = acc[o], anc = prov[s.best];
    let lx = ((anc.cx + a[0] / a[2]) % W + W) % W, ly = a[1] / a[2];
    const pp = M.pid[Math.floor(ly) * W + Math.floor(lx)];
    if (!pp || own[pp] !== o) { lx = anc.cx; ly = anc.cy; }
    s.lx = lx; s.ly = ly; s.cnt = cC[s.root];
    s.bx = [anc.cx + a[3], a[5], anc.cx + a[4], a[6]];
  });
  M.cstat = st;
}

// ── 실행 취소 ──
const U = [], R = []; let grp = null;
export function push(op) {
  if (grp) { grp.push(op); return; }
  U.push(op); if (U.length > 80) U.shift(); R.length = 0; emit('hist');
}
export function beginGroup() { grp = []; }
export function endGroup() {
  const g = grp; grp = null;
  if (g && g.length) push({ undo() { for (let i = g.length - 1; i >= 0; i--) g[i].undo(); }, redo() { for (const o of g) o.redo(); } });
}
export const canUndo = () => U.length > 0, canRedo = () => R.length > 0;
export function undo() { const op = U.pop(); if (op) { op.undo(); R.push(op); emit('hist'); } }
export function redo() { const op = R.pop(); if (op) { op.redo(); U.push(op); emit('hist'); } }
export function act(doFn, undoFn) { doFn(); push({ undo: undoFn, redo: doFn }); }

let anTimer = 0;
export function scheduleAnalyze() {
  clearTimeout(anTimer);
  anTimer = setTimeout(() => { analyzeCountries(); emit('data'); }, 30);
}

// ── 편집: 지방 소유 ──
export function setOwner(ps, o) {
  ps = ps.filter((p) => p > 0 && M.own[p] !== o);
  if (!ps.length) return;
  const olds = ps.map((p) => M.own[p]);
  const apply = (v) => { ps.forEach((p, k) => { M.own[p] = Array.isArray(v) ? v[k] : v; dirtyProv(p); }); emit('map'); scheduleAnalyze(); };
  act(() => apply(o), () => apply(olds));
}
export const provsOf = (o) => { const r = []; for (let p = 1; p < M.prov.length; p++) if (M.own[p] === o && M.prov[p].cnt) r.push(p); return r; };

// ── 편집: 국가 ──
export function addCountry(props = {}) {
  const c = { name: '새 국가', en: '', color: randColor(), flag: '', bg: '', alive: true, ...props };
  const i = M.countries.length;
  act(() => { M.countries[i] = c; c.alive = true; buildPalette(); emit('data'); }, () => { c.alive = false; emit('data'); });
  return i;
}
export function setCountry(o, key, val) {
  const c = M.countries[o], old = c[key];
  if (old === val) return;
  const apply = (v) => {
    c[key] = v;
    if (key === 'color') { buildPalette(); renderCountry(o); }
    if (key === 'bg' || key === 'bgBox') loadBg(o);
    emit('data');
  };
  act(() => apply(val), () => apply(old));
}
export function setCountryBg(o, url) {
  const c = M.countries[o], s = M.cstat[o], old = [c.bg, c.bgBox];
  const box = s && s.bx ? s.bx.slice() : [0, 0, W, H];
  const apply = ([b, bb]) => { c.bg = b; c.bgBox = bb; loadBg(o); emit('data'); };
  act(() => apply([url, box]), () => apply(old));
}
function loadBg(o) {
  const c = M.countries[o];
  bgs[o + 1] = null;
  if (!c.bg) { renderCountry(o); return; }
  const im = new Image();
  im.onload = () => {
    const w = Math.min(512, im.width), h = Math.round(im.height * w / im.width);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'); g.drawImage(im, 0, 0, w, h);
    const [x0, y0, x1, y1] = c.bgBox, bw = x1 - x0, bh = y1 - y0, k = Math.max(bw / w, bh / h);
    bgs[o + 1] = { d: new Uint32Array(g.getImageData(0, 0, w, h).data.buffer), w, h, sw: w * k, sh: h * k, x0: x0 + bw / 2 - w * k / 2, y0: y0 + bh / 2 - h * k / 2 };
    renderCountry(o);
  };
  im.src = c.bg;
}
export function select(o, p = 0) {
  const prev = M.sel;
  M.sel = o; M.selProv = p;
  if (prev !== o) { buildPalette(); if (prev >= 0) renderCountry(prev); if (o >= 0) renderCountry(o); }
  emit('sel');
}
export function setOpt(k, v) {
  M.opts[k] = v;
  if (k === 'pBorders' || k === 'ocean' || k === 'neutral') { buildPalette(); renderAll(); }
  emit('data');
}

// ── 편집: 브러시 (픽셀 단위) ──
let S = null;
const rootOf = (p) => M.prov[p].root || p;
function newProv(name, en, o, root) {
  const id = M.prov.length;
  if (id >= 65535) return 0;
  M.prov.push({ name, en, root, cnt: 0, area: 0 }); M.own[id] = o; S.created.add(id);
  return id;
}
let newCount = 0;
export function strokeBegin(mode, o) {
  S = { mode, o, ch: new Map(), created: new Set(), key: new Map(), split: new Map(), land: 0, bb: [Infinity, Infinity, -Infinity, -Infinity] };
  if (mode === 'own') for (let p = 1; p < M.prov.length; p++) {
    const k = rootOf(p) * 65536 + M.own[p] + 1;
    if (!S.key.has(k) || M.prov[p].cnt > M.prov[S.key.get(k)].cnt) S.key.set(k, p);
  }
}
function target(p) {
  const { mode } = S;
  if (mode === 'sea') return 0;
  if (mode === 'land') { if (p) return p; if (!S.land) S.land = newProv('새 땅 ' + (++newCount), '', S.o, 0) || 0; return S.land; }
  if (!p || S.created.has(p)) return p;
  if (mode === 'own') {
    if (M.own[p] === S.o) return p;
    const r = rootOf(p), k = r * 65536 + S.o + 1;
    let q = S.key.get(k);
    if (q === undefined) { q = newProv(M.prov[r].name, M.prov[r].en, S.o, r) || p; S.key.set(k, q); }
    return q;
  }
  if (mode === 'split') {
    const k = M.own[p];
    let q = S.split.get(k);
    if (q === undefined) { q = newProv('새 지방 ' + (++newCount), '', k, 0) || p; S.split.set(k, q); }
    return q;
  }
  return p;
}
function stamp(cx, cy, r) {
  cx = Math.round(cx); cy = Math.round(cy);
  const { pid } = M, ch = S.ch;
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy; if (y < 0 || y >= H) continue;
    const hw = Math.floor(Math.sqrt(r * r - dy * dy + r * 0.8));
    for (let dx = -hw; dx <= hw; dx++) {
      const x = ((cx + dx) % W + W) % W, i = y * W + x, p = pid[i], q = target(p);
      if (q !== p) { if (!ch.has(i)) ch.set(i, p); pid[i] = q; }
    }
  }
  const b = S.bb; b[0] = Math.min(b[0], cx - r); b[1] = Math.min(b[1], cy - r); b[2] = Math.max(b[2], cx + r + 1); b[3] = Math.max(b[3], cy + r + 1);
  dirtyRaw(cx - r, cy - r, cx + r + 1, cy + r + 1);
}
export function strokeLine(ax, ay, bx, by, r) {
  if (!S) return;
  ax = ((ax % W) + W) % W; bx = ((bx % W) + W) % W;
  let dx = bx - ax; if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
  const dy = by - ay, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, r * 0.5)));
  for (let k = 1; k <= n; k++) stamp(ax + dx * k / n, ay + dy * k / n, r);
  emit('map');
}
export function strokeEnd() {
  const s = S; S = null;
  if (!s || !s.ch.size) return;
  const idx = Int32Array.from(s.ch.keys()), old = Uint16Array.from(s.ch.values());
  const nw = new Uint16Array(idx.length); idx.forEach((i, k) => { nw[k] = M.pid[i]; });
  const water = s.mode === 'land' || s.mode === 'sea', bb = s.bb;
  const after = () => {
    analyzePixels();
    if (water) { computeDist(); renderRect(0, 0, W, H); } else dirtyRaw(...bb);
    emit('map'); analyzeCountries(); emit('data');
  };
  const apply = (v) => { for (let k = 0; k < idx.length; k++) M.pid[idx[k]] = v[k]; after(); };
  push({ undo: () => apply(old), redo: () => apply(nw) });
  after();
}

// ── 생성 / 저장 ──
export async function loadBase() {
  const [meta, bin] = await Promise.all([
    fetch('data/world.json').then((r) => r.json()),
    fetch('data/provinces.bin').then((r) => r.arrayBuffer()),
  ]);
  base = { meta, rle: new Uint16Array(bin) };
  return base;
}
function rleDecode(r, out) { let o = 0; for (let i = 0; i < r.length; i += 2) { out.fill(r[i], o, o + r[i + 1]); o += r[i + 1]; } }
function rleEncode(a) {
  const out = [];
  for (let i = 0; i < a.length;) { const v = a[i]; let n = 1; while (i + n < a.length && a[i + n] === v && n < 65535) n++; out.push(v, n); i += n; }
  return new Uint16Array(out);
}
function colorize() {
  const nc = M.countries.length, nb = Array.from({ length: nc }, () => new Set()), { own, edges } = M;
  for (let k = 0; k < edges.length; k += 2) { const a = own[edges[k]], b = own[edges[k + 1]]; if (a >= 0 && b >= 0 && a !== b) { nb[a].add(b); nb[b].add(a); } }
  const used = new Array(PALETTE.length).fill(0), order = [...Array(nc).keys()].sort((a, b) => nb[b].size - nb[a].size);
  for (const o of order) {
    const bad = new Set([...nb[o]].map((n) => M.countries[n].color));
    let best = -1;
    PALETTE.forEach((c, i) => { if (!bad.has(c) && (best < 0 || used[i] < used[best])) best = i; });
    if (best < 0) M.countries[o].color = randColor(); else { M.countries[o].color = PALETTE[best]; used[best]++; }
  }
}
function finish() {
  U.length = R.length = 0; M.sel = -1; M.selProv = 0;
  analyzePixels(); computeDist();
  M.countries.forEach((c, o) => { bgs[o + 1] = null; });
  buildPalette(); renderAll(); analyzeCountries();
  M.countries.forEach((c, o) => { if (c.bg) loadBg(o); });
  emit('data'); emit('hist'); emit('sel');
}
export function newWorld(kind) {
  const { meta } = base;
  rleDecode(base.rle, M.pid);
  M.own.fill(-1);
  M.prov = [null, ...meta.provinces.map(([name, en]) => ({ name, en: en || '', root: 0, cnt: 0, area: 0 }))];
  M.countries = []; M.name = '내 세계';
  if (kind === 'real') {
    M.countries = meta.countries.map(([name, en, iso]) => ({ name, en, color: '#cccccc', flag: iso, bg: '', alive: true }));
    meta.provinces.forEach((p, i) => { M.own[i + 1] = p[2]; });
  } else if (kind === 'provinces') {
    meta.provinces.forEach((p, i) => { M.countries.push({ name: p[0], en: p[1] || '', color: '#ccc', flag: '', bg: '', alive: true }); M.own[i + 1] = i; });
  }
  M.cities = meta.cities.map(([name, lon, lat, rank, cap]) => ({ name, lon, lat, rank, cap: !!cap }));
  M.oceans = meta.oceans.map(([name, lon, lat, rank]) => ({ name, lon, lat, rank }));
  analyzePixels(); colorize();
  finish();
}
export function serialize() {
  const own = [];
  for (let p = 1; p < M.prov.length; p++) own.push(M.own[p]);
  return {
    meta: {
      v: 1, name: M.name, opts: M.opts, countries: M.countries, cities: M.cities, oceans: M.oceans,
      prov: M.prov.slice(1).map((p) => [p.name, p.en, p.root]), own,
    },
    rle: rleEncode(M.pid),
  };
}
export function deserialize({ meta, rle }) {
  rleDecode(rle, M.pid);
  M.name = meta.name || '내 세계';
  M.opts = { ...M.opts, ...meta.opts };
  M.countries = meta.countries; M.cities = meta.cities; M.oceans = meta.oceans;
  M.prov = [null, ...meta.prov.map(([name, en, root]) => ({ name, en, root, cnt: 0, area: 0 }))];
  M.own.fill(-1); meta.own.forEach((o, i) => { M.own[i + 1] = o; });
  finish();
}
export const pixelAt = (x, y) => {
  x = Math.floor(((x % W) + W) % W); y = Math.floor(y);
  return y < 0 || y >= H ? 0 : M.pid[y * W + x];
};
export const lonlat = (x, y) => [x / W * 360 - 180, 90 - y / H * 180];
export const mapXY = (lon, lat) => [(lon + 180) / 360 * W, (90 - lat) / 180 * H];
