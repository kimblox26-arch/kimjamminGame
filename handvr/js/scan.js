// 손 스캔: 카메라 영상의 실제 픽셀에서 내 손의 치수와 색을 잰다.
//  - 손가락 마디별 굵기(손가락 방향에 수직으로 피부 경계를 찾음) → 3D 손 모델의 손가락 굵기 보정
//  - 피부색, 팔뚝이 맨살인지 소매인지(소매 색)
const SAMPLE_W = 640;
const NEED = 8;                     // 항목별 필요한 측정 횟수
const T = 1.0;                      // 피부/배경 경계 판정 문턱
const STORE = 'handvr.profile.';

const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

export const PROFILE_KEYS = [
  ...[1, 2, 3, 4].flatMap(f => [0, 1, 2].map(s => `w${f}${s}`)), 'w00', 'w01',
];

export class HandProfile {
  constructor(side) { this.side = side; this.reset(); this.load(); }
  reset() {
    this.samples = {}; this.values = {}; this.done = false; this.skinS = []; this.sleeveVotes = [];
    this.skin = null; this.sleeve = null;
  }
  add(key, v) {
    const a = (this.samples[key] ??= []);
    a.push(v); if (a.length > 40) a.shift();
    this.values[key] = median(a);
  }
  get(key) { return this.values[key]; }
  get progress() {
    let n = 0;
    for (const k of PROFILE_KEYS) n += Math.min(NEED, this.samples[k]?.length ?? 0);
    return n / (PROFILE_KEYS.length * NEED);
  }
  finishIfReady() {
    if (this.done || this.progress < 0.9 || this.skinS.length < 10) return false;
    this.done = true;
    this.save();
    return true;
  }
  save() {
    try { localStorage.setItem(STORE + this.side, JSON.stringify({ values: this.values, skin: this.skin, sleeve: this.sleeve })); } catch { /* 무시 */ }
  }
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE + this.side) || 'null');
      if (d?.values) { this.values = d.values; this.skin = d.skin; this.sleeve = d.sleeve; this.done = true; }
    } catch { /* 무시 */ }
  }
  clear() { this.reset(); try { localStorage.removeItem(STORE + this.side); } catch { /* 무시 */ } }
}

export class HandScanner {
  constructor(hfov) {
    this.c = document.createElement('canvas');
    this.g = this.c.getContext('2d', { willReadFrequently: true });
    this.hfov = hfov;
    this.stamp = -1;
  }

  prepare(video, stamp) {
    if (this.stamp === stamp) return;
    this.stamp = stamp;
    const w = SAMPLE_W, h = Math.round(w * video.videoHeight / video.videoWidth);
    if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h; }
    this.g.drawImage(video, 0, 0, w, h);
    this.data = this.g.getImageData(0, 0, w, h).data;
    this.w = w; this.h = h;
    this.fc = (w / 2) / Math.tan(this.hfov / 2); // 샘플 해상도 기준 초점거리(px)
  }

  rgb(x, y) {
    x = Math.round(x); y = Math.round(y);
    if (x < 1 || y < 1 || x >= this.w - 1 || y >= this.h - 1) return null;
    const i = (y * this.w + x) * 4, d = this.data;
    // 3x3 평균으로 잡음 감소
    let r = 0, g = 0, b = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const j = i + (oy * this.w + ox) * 4; r += d[j]; g += d[j + 1]; b += d[j + 2]; }
    return [r / 9, g / 9, b / 9];
  }

  dist(x, y, ref) {
    const c = this.rgb(x, y);
    if (!c) return -1;
    const s = c[0] + c[1] + c[2] + 1;
    return Math.hypot(c[0] / s - ref.cr, c[1] / s - ref.cg) * 14 + Math.abs(Math.log((s / 3 + 8) / (ref.l + 8))) * 1.1;
  }

  // 중심에서 (dx,dy) 방향으로 피부가 끝나는 지점까지의 거리(px). 못 찾으면 -1
  edge(cx, cy, dx, dy, maxK, ref) {
    let prev = this.dist(cx, cy, ref);
    if (prev < 0 || prev > T) return -1;
    for (let k = 1; k <= maxK; k++) {
      const d = this.dist(cx + dx * k, cy + dy * k, ref);
      if (d < 0) return -1;
      if (d > T) {
        const d2 = this.dist(cx + dx * (k + 1), cy + dy * (k + 1), ref);
        if (d2 < 0 || d2 > T) return k - 1 + Math.min(1, Math.max(0, (T - prev) / (d - prev + 1e-6)));
      }
      prev = d;
    }
    return -1;
  }

  // h: HandState, lm: 정규화 랜드마크, depth(i): 관절 깊이(m)
  observe(h, lm, depth, video, stamp) {
    const p = h.profile;
    if (p.done || h.cand !== 'open') return;
    // 손바닥(또는 손등)이 카메라를 향할 때만
    const w = h.local;
    const ax = w[5].x - w[0].x, ay = w[5].y - w[0].y, az = w[5].z - w[0].z;
    const bx = w[17].x - w[0].x, by = w[17].y - w[0].y, bz = w[17].z - w[0].z;
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    if (Math.abs(nz) / (Math.hypot(nx, ny, nz) + 1e-9) < 0.7) return;

    this.prepare(video, stamp);
    const P = lm.map(l => [l.x * this.w, l.y * this.h]);
    const mpp = i => depth(i) / this.fc; // 그 관절 깊이에서 1px 이 몇 m 인가

    // 피부 기준색: 손바닥 안쪽 여러 곳 평균
    const spots = [[0, 5, 17], [5, 9, 13, 17], [0, 9], [0, 13], [0, 5, 9]];
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (const s of spots) {
      const x = s.reduce((a, i) => a + P[i][0], 0) / s.length, y = s.reduce((a, i) => a + P[i][1], 0) / s.length;
      const c = this.rgb(x, y);
      if (c) { sr += c[0]; sg += c[1]; sb += c[2]; n++; }
    }
    if (n < 3) return;
    sr /= n; sg /= n; sb /= n;
    const sum = sr + sg + sb + 1;
    const ref = { cr: sr / sum, cg: sg / sum, l: sum / 3 };
    p.skinS.push([sr, sg, sb]); if (p.skinS.length > 60) p.skinS.shift();
    p.skin = [0, 1, 2].map(k => median(p.skinS.map(c => c[k])));

    const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
    const mid = (a, b, t) => [P[a][0] + (P[b][0] - P[a][0]) * t, P[a][1] + (P[b][1] - P[a][1]) * t];

    // 손가락 마디 굵기
    const FINGER_SEGS = [[0, [[2, 3, 0.5], [3, 4, 0.4]]], [1, [[5, 6, 0.5], [6, 7, 0.5], [7, 8, 0.4]]], [2, [[9, 10, 0.5], [10, 11, 0.5], [11, 12, 0.4]]],
      [3, [[13, 14, 0.5], [14, 15, 0.5], [15, 16, 0.4]]], [4, [[17, 18, 0.5], [18, 19, 0.5], [19, 20, 0.4]]]];
    const segMid = {};
    for (const [f, segs] of FINGER_SEGS) segs.forEach(([a, b, t], s) => { segMid[`${f}${s}`] = mid(a, b, t); });
    for (const [f, segs] of FINGER_SEGS) segs.forEach(([a, b, t], s) => {
      const len2d = Math.hypot(P[b][0] - P[a][0], P[b][1] - P[a][1]);
      const len3d = Math.hypot(w[b].x - w[a].x, w[b].y - w[a].y, w[b].z - w[a].z);
      const m = mpp(a);
      if (len2d * m < len3d * 0.82) return;          // 카메라 쪽으로 기울어진 마디는 제외
      const [cx, cy] = segMid[`${f}${s}`];
      const [dx, dy] = unit(-(P[b][1] - P[a][1]), P[b][0] - P[a][0]);
      // 옆 손가락까지 거리의 절반을 넘지 않게
      let lim = 0.024 / m;
      for (const g of [f - 1, f + 1]) {
        const o = segMid[`${g}${Math.min(s, g === 0 ? 1 : 2)}`];
        if (o && g >= 1) lim = Math.min(lim, Math.hypot(o[0] - cx, o[1] - cy) * 0.55);
      }
      const e1 = this.edge(cx, cy, dx, dy, lim, ref), e2 = this.edge(cx, cy, -dx, -dy, lim, ref);
      if (e1 < 0 || e2 < 0) return;
      const width = (e1 + e2) * m;
      if (width > 0.009 && width < 0.032) p.add(`w${f}${s}`, width);
    });

    // 팔뚝: 맨살인지 소매인지
    const palmLen = Math.hypot(P[9][0] - P[0][0], P[9][1] - P[0][1]);
    const [fx, fy] = unit(P[0][0] - P[9][0], P[0][1] - P[9][1]);
    for (const k of [0.8, 1.0, 1.2]) {
      const x = P[0][0] + fx * palmLen * k, y = P[0][1] + fy * palmLen * k;
      const d = this.dist(x, y, ref);
      if (d < 0) continue;
      p.sleeveVotes.push({ skin: d <= T * 1.2, c: this.rgb(x, y) });
      if (p.sleeveVotes.length > 90) p.sleeveVotes.shift();
    }
    const v = p.sleeveVotes;
    if (v.length >= 20) {
      const skinFrac = v.filter(x => x.skin).length / v.length;
      if (skinFrac > 0.6) p.sleeve = { bare: true };
      else {
        const cs = v.filter(x => !x.skin).map(x => x.c);
        const med = [0, 1, 2].map(k => median(cs.map(c => c[k])));
        const spread = Math.max(...[0, 1, 2].map(k => median(cs.map(c => Math.abs(c[k] - med[k])))));
        p.sleeve = spread < 28 ? { bare: false, color: med } : null;
      }
    }
  }
}
