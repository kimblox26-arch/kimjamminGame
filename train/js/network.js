// 노선 선형 계산: 곡선(완화 원곡선), 종단 고저, 터널·교량 판정, 제한속도, 공용 구간 처리
import { LINES, displayName } from './data/stations.js';
import { toXZ, clamp, smooth, lerp } from './geo.js';

const K = (gx, gz) => (gx + 32768) * 65536 + (gz + 32768);

export const ST = { GROUND: 0, BRIDGE: 1, TUNNEL: 2, SUBWAY: 3 };
const CFG = {
  hsr: { ds: 20, R: 6500, grade: 0.03, win: 2400, lat: 0.95, plat: 410, gap: 5.0 },
  rail: { ds: 20, R: 1200, grade: 0.025, win: 1400, lat: 0.9, plat: 320, gap: 4.3 },
  metro: { ds: 10, R: 380, grade: 0.035, win: 700, lat: 0.8, plat: 0, gap: 3.9 },
  light: { ds: 10, R: 160, grade: 0.05, win: 500, lat: 0.8, plat: 0, gap: 3.6 },
};

export class Line {
  constructor(def) {
    Object.assign(this, def);
    this.cfg = CFG[def.type];
    this.cars = def.cars || 10;
    this.platLen = this.cfg.plat || Math.max(60, this.cars * 20 + 12);
    this.stations = def.st.split('|').map((s, k) => {
      const t = s.trim().split(/\s+/); const [x, z] = toXZ(+t[1], +t[2]);
      return { key: t[0], name: displayName(t[0]), lat: +t[1], lon: +t[2], x, z, struct: t[3] || 'g', k };
    });
  }
  idx(s) { const L = this.length; if (this.loop) s = ((s % L) + L) % L; else s = clamp(s, 0, L); const f = s / this.ds; const i = Math.min(Math.floor(f), this.n - 2); return [i, f - i]; }
  // s 위치의 선로 중심 좌표와 방향
  at(s, out = {}) {
    const [i, t] = this.idx(s);
    out.x = lerp(this.x[i], this.x[i + 1], t); out.z = lerp(this.z[i], this.z[i + 1], t); out.y = lerp(this.y[i], this.y[i + 1], t);
    const dx = this.x[i + 1] - this.x[i], dz = this.z[i + 1] - this.z[i];
    out.hd = Math.atan2(dz, dx); out.grade = (this.y[i + 1] - this.y[i]) / this.ds; out.i = i;
    out.st = this.st[t < 0.5 ? i : i + 1];
    return out;
  }
  limitAt(s) { return this.lim[this.idx(s)[0]]; }
}

export class Network {
  constructor(terrain) { this.terrain = terrain; this.lines = []; this.byId = {}; }

  async build(geo, progress) {
    const shareHash = new Map(); // 25 m 격자: 이미 만든 노선 샘플
    const SH = 25;
    let li = 0;
    for (const def of LINES) {
      const line = new Line(def); line.index = li++;
      let ctl;
      if (geo.rail[def.id]) { const r = geo.rail[def.id]; ctl = []; for (let i = 0; i < r.length; i += 2) ctl.push(toXZ(r[i + 1], r[i])); }
      else ctl = line.stations.map(s => [s.x, s.z]);
      buildPath(line, dedupe(ctl), line.cfg.R, !!def.loop, line.cfg.ds);
      this.projectStations(line);
      this.share(line, shareHash, SH);
      this.profile(line);
      this.limits(line);
      // 공용 해시에 등록
      for (let i = 0; i < line.n; i++) {
        if (line.sh[i]) continue;
        const k = Math.floor(line.x[i] / SH) + ',' + Math.floor(line.z[i] / SH);
        let a = shareHash.get(k); if (!a) shareHash.set(k, a = []); a.push(line.index, i);
      }
      this.lines.push(line); this.byId[line.id] = line;
      await progress?.(li / LINES.length);
    }
    this.buildCorridor();
    this.terrain.corridor = (x, z, h) => this.corridor(x, z, h);
    // 역 목록 (지도·검색용)
    this.stationList = [];
    for (const L of this.lines) for (const s of L.stations) this.stationList.push({ line: L, st: s });
  }

  projectStations(line) {
    let from = 0;
    for (const st of line.stations) {
      let best = -1, bd = 1e18;
      const range = line.loop || from === 0 ? [0, line.n - 1] : [from, line.n - 1];
      for (let i = range[0]; i < range[1]; i++) {
        const d = segProj(st.x, st.z, line.x[i], line.z[i], line.x[i + 1], line.z[i + 1]);
        if (d.d2 < bd) { bd = d.d2; best = i + d.t; }
        if (!line.loop && bd < 400 && d.d2 > bd + 4e6) break;
      }
      st.s = best * line.ds; from = Math.max(0, Math.floor(best) - 2);
    }
  }

  // 먼저 만든 노선과 겹치는 구간은 같은 선로를 쓴다
  share(line, hash, SH) {
    const n = line.n; line.sh = new Uint8Array(n); line.shRef = new Int32Array(n).fill(-1);
    const dX = new Float32Array(n), dZ = new Float32Array(n), dY = new Float32Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      const x = line.x[i], z = line.z[i], hx = Math.cos(line.hd[i]), hz = Math.sin(line.hd[i]);
      const gx = Math.floor(x / SH), gz = Math.floor(z / SH);
      let best = null, bd = 64;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const arr = hash.get((gx + a) + ',' + (gz + b)); if (!arr) continue;
        for (let k = 0; k < arr.length; k += 2) {
          const L = this.lines[arr[k]], j = arr[k + 1];
          const d2 = (L.x[j] - x) ** 2 + (L.z[j] - z) ** 2;
          if (d2 < bd && Math.abs(Math.cos(L.hd[j]) * hx + Math.sin(L.hd[j]) * hz) > 0.985) { bd = d2; best = [L, j]; }
        }
      }
      if (best) {
        const [L, j] = best; const j2 = Math.min(j + 1, L.n - 1);
        const p = segProj(x, z, L.x[j], L.z[j], L.x[j2], L.z[j2]);
        line.sh[i] = 1; line.shRef[i] = L.index * 1048576 + j; any = true;
        dX[i] = lerp(L.x[j], L.x[j2], p.t) - x; dZ[i] = lerp(L.z[j], L.z[j2], p.t) - z;
      }
    }
    // 짧은 공용 구간(분기부 잡음)은 무시
    clean(line.sh, 1, Math.round(300 / line.ds));
    for (let i = 0; i < n; i++) if (!line.sh[i]) { line.shRef[i] = -1; dX[i] = dZ[i] = 0; }
    line.shared = any && line.sh.some(v => v);
    if (!line.shared) return;
    // 경계에서 부드럽게 이어 붙인다
    spreadDelta(line.sh, [dX, dZ], Math.round(250 / line.ds));
    for (let i = 0; i < n; i++) { line.x[i] += dX[i]; line.z[i] += dZ[i]; }
    recomputeHeading(line);
  }

  profile(line) {
    const T = this.terrain, n = line.n, ds = line.ds, cfg = line.cfg;
    const hn = line.hn = new Float32Array(n);
    for (let i = 0; i < n; i++) hn[i] = T.natural(line.x[i], line.z[i]);
    const hg = new Float32Array(n), hu = new Float32Array(n);
    for (let i = 0; i < n; i++) { hg[i] = hn[i] < 0.6 ? 13 : hn[i]; hu[i] = Math.max(hn[i], 0); }
    const w = Math.max(2, Math.round(cfg.win / ds / 2));
    const sg = movAvg(hg, w, line.loop), su = movAvg(hu, w, line.loop);
    // 역 구조(지하/고가)를 역 사이에서 보간
    const wu = new Float32Array(n), we = new Float32Array(n);
    const S = line.stations, L = line.length;
    const sv = st => st.struct === 'u' ? [1, 0] : st.struct === 'e' ? [0, 1] : [0, 0];
    const segs = line.loop ? S.map((a, k) => [a, S[(k + 1) % S.length]]) : S.slice(0, -1).map((a, k) => [a, S[k + 1]]);
    for (const [a, b] of segs) {
      let s0 = a.s, s1 = b.s; if (s1 <= s0) s1 += L;
      const [ua, ea] = sv(a), [ub, eb] = sv(b);
      for (let s = Math.floor(s0 / ds) * ds; s <= s1; s += ds) {
        const t = smooth(0.2, 0.8, (s - s0) / (s1 - s0));
        const i = Math.round(((s % L) + L) % L / ds); if (i >= n) continue;
        wu[i] = lerp(ua, ub, t); we[i] = lerp(ea, eb, t);
      }
    }
    if (!line.loop) { // 끝 역 바깥
      for (let i = 0; i < n; i++) { const s = i * ds;
        if (s < S[0].s) { [wu[i], we[i]] = sv(S[0]); } else if (s > S[S.length - 1].s) { [wu[i], we[i]] = sv(S[S.length - 1]); } }
    }
    const y = line.y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = lerp(sg[i] + 10 * we[i], su[i] - 24, wu[i]);
    // 역 구내는 수평
    line.zone = new Int16Array(n).fill(-1);
    for (const st of S) {
      const half = line.platLen / 2 + 25, i0 = Math.round(st.s / ds);
      const yc = y[clamp(i0, 0, n - 1)];
      for (let k = -Math.ceil((half + 160) / ds); k <= Math.ceil((half + 160) / ds); k++) {
        let i = i0 + k; if (line.loop) i = (i + n) % n; if (i < 0 || i >= n) continue;
        const d = Math.abs(k * ds);
        y[i] = lerp(yc, y[i], smooth(half, half + 160, d));
        if (d <= half) line.zone[i] = st.k;
      }
    }
    // 공용 구간 높이 맞추기
    if (line.shared) {
      const dy = new Float32Array(n);
      for (let i = 0; i < n; i++) if (line.sh[i]) { const r = line.shRef[i]; const Lr = this.lines[r >> 20]; dy[i] = Lr.y[r & 1048575] - y[i]; }
      spreadDelta(line.sh, [dy], Math.round(400 / ds));
      for (let i = 0; i < n; i++) y[i] += dy[i];
    }
    // 기울기 제한
    const g = cfg.grade * ds;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < n; i++) if (!line.sh[i]) y[i] = clamp(y[i], y[i - 1] - g, y[i - 1] + g);
      for (let i = n - 2; i >= 0; i--) if (!line.sh[i]) y[i] = clamp(y[i], y[i + 1] - g, y[i + 1] + g);
    }
    // 구조물 판정
    const st = line.st = new Uint8Array(n);
    const sub = line.type === 'metro' || line.type === 'light';
    for (let i = 0; i < n; i++) {
      if (line.sh[i]) { const r = line.shRef[i]; st[i] = this.lines[r >> 20].st[r & 1048575]; continue; }
      const d = y[i] - hn[i];
      if (d < -9) st[i] = sub && wu[i] > 0.3 ? ST.SUBWAY : ST.TUNNEL;
      else if (d > 6 || hn[i] < 0.6 || we[i] > 0.5) st[i] = ST.BRIDGE;
      else st[i] = ST.GROUND;
    }
    clean(st, ST.TUNNEL, Math.round(60 / ds)); clean(st, ST.BRIDGE, Math.round(40 / ds));
    // 지하 역 구간은 지하로
    for (let i = 0; i < n; i++) if (line.zone[i] >= 0 && !line.sh[i] && S[line.zone[i]].struct === 'u') st[i] = ST.SUBWAY;
  }

  limits(line) {
    const n = line.n, lim = line.lim = new Uint16Array(n), a = line.cfg.lat;
    for (let i = 0; i < n; i++) {
      const R = 1 / Math.max(Math.abs(line.cv[i]), 1e-6);
      lim[i] = Math.min(line.max, Math.floor(Math.sqrt(R * a) * 3.6 / 5) * 5);
    }
    // 곡선 앞뒤 150 m 까지 제한 연장
    const k = Math.round(150 / line.ds), src = lim.slice();
    for (let i = 0; i < n; i++) { let m = src[i]; for (let j = -k; j <= k; j++) { const q = i + j; if (q >= 0 && q < n && src[q] < m) m = src[q]; } lim[i] = Math.max(25, m); }
  }

  // 지형을 선로 높이에 맞춘다 (흙쌓기·땅깎기)
  buildCorridor() {
    const C = this.corrCell = 64, map = this.corr = new Map();
    for (const L of this.lines) for (let i = 0; i < L.n - 1; i++) {
      if (L.sh[i] || L.st[i] !== ST.GROUND) continue;
      const k = K(Math.floor(L.x[i] / C), Math.floor(L.z[i] / C));
      let a = map.get(k); if (!a) map.set(k, a = []); a.push(L.index, i);
    }
  }
  nearestTrack(x, z, maxD = 90, ground = true) {
    const C = this.corrCell, gx = Math.floor(x / C), gz = Math.floor(z / C);
    let best = null, bd = maxD * maxD;
    const r = Math.ceil(maxD / C);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const arr = (ground ? this.corr : this.allCorr()).get(K(gx + a, gz + b)); if (!arr) continue;
      for (let k = 0; k < arr.length; k += 2) {
        const L = this.lines[arr[k]], i = arr[k + 1];
        const p = segProj(x, z, L.x[i], L.z[i], L.x[i + 1], L.z[i + 1]);
        if (p.d2 < bd) { bd = p.d2; best = { L, i, t: p.t, d: Math.sqrt(p.d2) }; }
      }
    }
    return best;
  }
  allCorr() {
    if (this._all) return this._all;
    const C = this.corrCell, map = this._all = new Map();
    for (const L of this.lines) for (let i = 0; i < L.n - 1; i++) {
      if (L.sh[i] || L.st[i] >= ST.TUNNEL) continue;
      const k = K(Math.floor(L.x[i] / C), Math.floor(L.z[i] / C));
      let a = map.get(k); if (!a) map.set(k, a = []); a.push(L.index, i);
    }
    return map;
  }
  corridor(x, z, h) {
    const C = this.corrCell; if (!this.corr.size) return h;
    const nb = this.nearestTrack(x, z, 90);
    if (!nb) return h;
    const { L, i, t, d } = nb;
    const ty = lerp(L.y[i], L.y[i + 1], t) - 0.9;
    const half = L.zone[i] >= 0 ? 24 : 8.5;
    const wb = half + 5 + Math.min(70, Math.abs(h - ty) * 1.6);
    return lerp(ty, h, smooth(half, wb, d));
  }
}

function dedupe(pts) { const o = [pts[0]]; for (const p of pts) { const q = o[o.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 8) o.push(p); } return o; }

function segProj(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L ? clamp(((x - ax) * dx + (z - az) * dz) / L, 0, 1) : 0;
  const ex = ax + dx * t - x, ez = az + dz * t - z; return { t, d2: ex * ex + ez * ez };
}

// 꺾인 선을 직선+원곡선으로 다듬고 ds 간격으로 다시 나눈다
function buildPath(line, V, R0, loop, ds) {
  if (loop) { const a = V[0], b = V[V.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 10) V.pop(); }
  const m = V.length, fil = new Array(m).fill(null);
  for (let i = 0; i < m; i++) {
    if (!loop && (i === 0 || i === m - 1)) continue;
    const p = V[(i - 1 + m) % m], c = V[i], q = V[(i + 1) % m];
    let ax = c[0] - p[0], az = c[1] - p[1], bx = q[0] - c[0], bz = q[1] - c[1];
    const L1 = Math.hypot(ax, az), L2 = Math.hypot(bx, bz); ax /= L1; az /= L1; bx /= L2; bz /= L2;
    const cr = ax * bz - az * bx, th = Math.atan2(Math.abs(cr), ax * bx + az * bz);
    if (th < 0.001) continue;
    const tn = Math.tan(th / 2);
    const lim1 = (!loop && i === 1) ? L1 * 0.9 : L1 * 0.5, lim2 = (!loop && i === m - 2) ? L2 * 0.9 : L2 * 0.5;
    const T = Math.min(R0 * tn, lim1, lim2), R = T / tn, sg = Math.sign(cr);
    const A = [c[0] - ax * T, c[1] - az * T], E = [c[0] + bx * T, c[1] + bz * T];
    const C = [A[0] - az * sg * R, A[1] + ax * sg * R];
    fil[i] = { A, E, R, sg, th, C };
  }
  // 촘촘한 점열 (곡률 포함)
  const P = [], K = [];
  const push = (x, z, k) => { P.push(x, z); K.push(k); };
  const arc = f => {
    const a0 = Math.atan2(f.A[1] - f.C[1], f.A[0] - f.C[0]), steps = Math.max(2, Math.ceil(f.R * f.th / (ds * 0.5)));
    for (let s = 0; s <= steps; s++) { const a = a0 + f.sg * f.th * s / steps; push(f.C[0] + f.R * Math.cos(a), f.C[1] + f.R * Math.sin(a), f.sg / f.R); }
  };
  if (loop) {
    const order = [...Array(m).keys()].map(i => (i + 1) % m); // 0번 꼭짓점 원곡선 끝에서 시작
    const start = fil[0] ? fil[0].E : V[0]; push(start[0], start[1], 0);
    for (const i of order) { if (fil[i]) arc(fil[i]); else push(V[i][0], V[i][1], 0); }
  } else {
    push(V[0][0], V[0][1], 0);
    for (let i = 1; i < m - 1; i++) { if (fil[i]) arc(fil[i]); else push(V[i][0], V[i][1], 0); }
    push(V[m - 1][0], V[m - 1][1], 0);
  }
  // 누적 거리 → 등간격 재표본
  const cnt = P.length / 2, cum = new Float64Array(cnt);
  for (let i = 1; i < cnt; i++) cum[i] = cum[i - 1] + Math.hypot(P[2 * i] - P[2 * i - 2], P[2 * i + 1] - P[2 * i - 1]);
  const total = cum[cnt - 1], n = Math.floor(total / ds) + 1;
  line.ds = ds; line.length = (n - 1) * ds; line.n = n;
  line.x = new Float32Array(n); line.z = new Float32Array(n); line.cv = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++) {
    const s = i * ds; while (j < cnt - 2 && cum[j + 1] < s) j++;
    const t = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    line.x[i] = lerp(P[2 * j], P[2 * j + 2], t); line.z[i] = lerp(P[2 * j + 1], P[2 * j + 3], t);
    line.cv[i] = Math.abs(K[j]) < Math.abs(K[j + 1]) ? K[j] : K[j + 1];
  }
  if (loop) { line.length = total; line.ds = total / (n - 1); }
  recomputeHeading(line);
}

function recomputeHeading(line) {
  const n = line.n; line.hd = line.hd || new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    line.hd[i] = Math.atan2(line.z[b] - line.z[a], line.x[b] - line.x[a]);
  }
}

function movAvg(a, w, loop) {
  const n = a.length, o = new Float32Array(n);
  const pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
  for (let i = 0; i < n; i++) {
    if (loop) { let s = 0; for (let k = -w; k <= w; k += Math.max(1, w >> 4)) s += a[(i + k + n) % n]; o[i] = s / (Math.floor(2 * w / Math.max(1, w >> 4)) + 1); }
    else { const lo = Math.max(0, i - w), hi = Math.min(n, i + w + 1); o[i] = (pre[hi] - pre[lo]) / (hi - lo); }
  }
  return o;
}

// 값 v 구간이 minLen 보다 짧으면 앞쪽 값으로 바꾼다
function clean(arr, v, minLen) {
  const n = arr.length;
  for (let i = 0; i < n;) {
    if (arr[i] !== v) { i++; continue; }
    let j = i; while (j < n && arr[j] === v) j++;
    if (j - i < minLen) { const r = i > 0 ? arr[i - 1] : (j < n ? arr[j] : 0); for (let k = i; k < j; k++) arr[k] = r === v ? 0 : r; }
    i = j;
  }
}

// mask 가 1인 곳의 보정값을 바깥으로 range 만큼 서서히 퍼뜨린다
function spreadDelta(mask, arrs, range) {
  const n = mask.length;
  for (const d of arrs) {
    const f = new Float32Array(n), b = new Float32Array(n);
    let last = -1e9; for (let i = 0; i < n; i++) { if (mask[i]) last = i; f[i] = i - last <= range ? d[Math.max(0, last)] * (1 - smooth(0, range, i - last)) : 0; }
    last = 1e9; for (let i = n - 1; i >= 0; i--) { if (mask[i]) last = i; b[i] = last - i <= range ? d[Math.min(n - 1, last)] * (1 - smooth(0, range, last - i)) : 0; }
    for (let i = 0; i < n; i++) if (!mask[i]) d[i] = Math.abs(f[i]) > Math.abs(b[i]) ? f[i] : b[i];
  }
}
