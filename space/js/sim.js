// 구슬(입자) 기반 2D 천체 물리
// 단위: 거리 km, 질량 kg, 시간 s
//
// - 중력: 모든 구슬끼리 뉴턴 만유인력(1/r²), Barnes-Hut 쿼드트리로 근사
// - 충돌: 구슬끼리 비탄성 충돌(반발계수) + 마찰, 운동량 보존 충격량 방식
// - 구슬 사이에 접착력은 없다 → 천체는 자기 중력으로만 뭉쳐 있으므로
//   다른 천체의 기조력이 자기 중력보다 커지는 거리(로슈 한계) 안에서는 실제처럼 찢어진다.
//   찢어진 파편은 각운동량을 지닌 채 충돌로 에너지를 잃으며 고리로 퍼지고,
//   로슈 한계 밖에서는 자기 중력으로 다시 뭉쳐 위성이 된다.

export const G = 6.674e-20; // km³ / (kg·s²)

// 재질: mu 마찰계수, e 반발계수
export const MATS = [
  { key: 'iron', mu: 0.1, e: 0.1 },
  { key: 'rock', mu: 0.1, e: 0.1 },
  { key: 'ice', mu: 0.05, e: 0.2 },
  { key: 'gas', mu: 0.0, e: 0.0 },
];

const BUCKET = 8;
const MAX_DEPTH = 48;
const THETA2 = 0.75 * 0.75;
const ITER = 6;
const POS_ITER = 2;
// 2D 원판 행성의 중력을 실제 구형 행성처럼 만드는 보정.
// 구슬 하나 = 행성을 위아래로 꿰뚫는 기둥. 기둥의 질량이 위아래로 퍼져 있는 정도(σ²)만큼 가까운 거리 중력을 부드럽게 하면
// 원판 행성 바깥의 중력장이 실제 구의 GM/r² 와 몇 % 이내로 같아진다.
// σ² = c · (R² − ρ²), c 는 덩어리의 질량 분포로 정한다 (spreadCoef)
const SPREAD_GAIN = 0.6;
export function spreadCoef(sumMRho2, sumMRest) {
  return sumMRest > 0 ? SPREAD_GAIN * (0.5 * sumMRho2) / sumMRest : 0;
}
const SPREAD_EVERY = 8;

export class Sim {
  constructor() {
    this.cap = 0;
    this.n = 0;
    this.ncap = 0;
    this.nn = 0;
    this.ccap = 0;
    this.nc = 0;
    this.prevN = 0;
    this.time = 0;
    this.dtMax = 120;
    this.dtCrit = 1;
    this.dtGrav = Infinity;
    this.dtCfl = Infinity;
    this.lastDt = 1;
    this.stepCount = 0;
    this.bodies = []; // 처음 넣은 행성 정보 (이름, 질량)
    this.stack = new Int32Array(1024);
    this.mono = new Int32Array(1024);
    this.leaves = new Int32Array(256);
    this._grow(4096);
    this._growNodes(8192);
    this._growContacts(16384);
  }

  reset() {
    this.n = 0;
    this.nc = 0;
    this.prevN = 0;
    this.lastN = 0;
    this.time = 0;
    this.dtCrit = 1;
    this.bodies = [];
  }

  // ---------- 메모리 ----------
  _grow(cap) {
    const n = this.n;
    const f64 = (a) => { const b = new Float64Array(cap); if (a) b.set(a.subarray(0, n)); return b; };
    const i32 = (a) => { const b = new Int32Array(cap); if (a) b.set(a.subarray(0, n)); return b; };
    for (const k of ['x', 'y', 'vx', 'vy', 'w', 'ax', 'ay', 'm', 'im', 'iI', 'r', 'rho', 'ga2', 'sg2', 'soft']) this[k] = f64(this[k]);
    for (const k of ['mat', 'col', 'org', 'next']) this[k] = i32(this[k]);
    for (const k of ['cStart', 'pStart', 'cCnt', 'pCnt']) this[k] = i32(this[k]);
    this.parent = new Int32Array(cap);
    this.cap = cap;
  }

  _growNodes(cap) {
    const nn = this.nn;
    const f64 = (a) => { const b = new Float64Array(cap); if (a) b.set(a.subarray(0, nn)); return b; };
    const i32 = (a) => { const b = new Int32Array(cap); if (a) b.set(a.subarray(0, nn)); return b; };
    for (const k of ['ncx', 'ncy', 'nhs', 'nm', 'nmx', 'nmy', 'nmaxR', 'nsoft', 'nvx0', 'nvx1', 'nvy0', 'nvy1']) this[k] = f64(this[k]);
    for (const k of ['nchild', 'nfirst', 'ncount']) this[k] = i32(this[k]);
    this.ncap = cap;
  }

  _growContacts(cap) {
    const nc = this.nc;
    const f64 = (a, len) => { const b = new Float64Array(cap); if (a) b.set(a.subarray(0, len)); return b; };
    const i32 = (a, len) => { const b = new Int32Array(cap); if (a) b.set(a.subarray(0, len)); return b; };
    for (const k of ['cNx', 'cNy', 'cGap', 'cMeff', 'cMeffT', 'cTarget', 'cAccN', 'cAccT', 'cMu', 'cE']) this[k] = f64(this[k], nc);
    for (const k of ['cI', 'cJ']) this[k] = i32(this[k], nc);
    // 이전 스텝 접촉(웜 스타트용)
    const pn = this.pNc || 0;
    this.pJ = i32(this.pJ, pn);
    this.pAccN = f64(this.pAccN, pn);
    this.pAccT = f64(this.pAccT, pn);
    this.ccap = cap;
  }

  // w: 구슬 자체의 자전 각속도 (rad/s), sg2: 기둥의 수직 퍼짐 σ² (km²)
  add(x, y, vx, vy, w, m, r, rho, mat, col, org, sg2 = 0) {
    if (this.n >= this.cap) this._grow(this.cap * 2);
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy; this.w[i] = w;
    this.ax[i] = 0; this.ay[i] = 0;
    this.m[i] = m; this.im[i] = 1 / m; this.r[i] = r; this.rho[i] = rho;
    this.iI[i] = 1 / (0.4 * m * r * r); // 구슬(구) 관성모멘트 2/5·m·r²
    // 구슬 질량을 실제 밀도의 공으로 뭉쳤을 때의 반지름만큼은 항상 중력을 부드럽게 한다
    const a = Math.cbrt((3 * m) / (4 * Math.PI * rho));
    this.ga2[i] = 0.5 * a * a;
    this.sg2[i] = sg2;
    this.soft[i] = this.ga2[i] + sg2;
    this.mat[i] = mat; this.col[i] = col; this.org[i] = org;
    // 새 천체가 들어오면 시간 간격을 작게 다시 시작
    this.dtCrit = Math.min(this.dtCrit, 5);
    return i;
  }

  // ---------- 쿼드트리 ----------
  _node(cx, cy, hs) {
    if (this.nn >= this.ncap) this._growNodes(this.ncap * 2);
    const k = this.nn++;
    this.ncx[k] = cx; this.ncy[k] = cy; this.nhs[k] = hs;
    this.nchild[k] = -1; this.nfirst[k] = -1; this.ncount[k] = 0;
    return k;
  }

  _buildTree() {
    const n = this.n, x = this.x, y = this.y;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i];
      if (xi < x0) x0 = xi; if (xi > x1) x1 = xi;
      if (yi < y0) y0 = yi; if (yi > y1) y1 = yi;
    }
    this.nn = 0;
    this._node((x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) * 0.50001 + 1);
    for (let i = 0; i < n; i++) this._insert(i);
    this._aggregate();
  }

  _insert(i) {
    const px = this.x[i], py = this.y[i];
    let k = 0, depth = 0;
    for (;;) {
      const ch = this.nchild[k];
      if (ch >= 0) {
        k = ch + (px >= this.ncx[k] ? 1 : 0) + (py >= this.ncy[k] ? 2 : 0);
        depth++;
        continue;
      }
      if (this.ncount[k] < BUCKET || depth >= MAX_DEPTH) {
        this.next[i] = this.nfirst[k]; this.nfirst[k] = i; this.ncount[k]++;
        return;
      }
      // 잎 노드가 가득 차면 4개로 나눈다
      const h = this.nhs[k] * 0.5, cx = this.ncx[k], cy = this.ncy[k];
      const c = this._node(cx - h, cy - h, h);
      this._node(cx + h, cy - h, h);
      this._node(cx - h, cy + h, h);
      this._node(cx + h, cy + h, h);
      this.nchild[k] = c;
      let p = this.nfirst[k];
      this.nfirst[k] = -1; this.ncount[k] = 0;
      while (p >= 0) {
        const nxt = this.next[p];
        const q = c + (this.x[p] >= cx ? 1 : 0) + (this.y[p] >= cy ? 2 : 0);
        this.next[p] = this.nfirst[q]; this.nfirst[q] = p; this.ncount[q]++;
        p = nxt;
      }
    }
  }

  // 자식 노드가 항상 부모보다 뒤에 만들어지므로 거꾸로 돌며 합산
  _aggregate() {
    const { x, y, vx, vy, m, r, soft, next, nchild, nfirst, nm, nmx, nmy, nmaxR, nsoft, nvx0, nvx1, nvy0, nvy1 } = this;
    for (let k = this.nn - 1; k >= 0; k--) {
      let M = 0, mx = 0, my = 0, mr = 0, ms = 0;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      const ch = nchild[k];
      if (ch < 0) {
        for (let p = nfirst[k]; p >= 0; p = next[p]) {
          const mp = m[p];
          M += mp; mx += mp * x[p]; my += mp * y[p]; ms += mp * soft[p];
          if (r[p] > mr) mr = r[p];
          const u = vx[p], v = vy[p];
          if (u < a0) a0 = u; if (u > a1) a1 = u;
          if (v < b0) b0 = v; if (v > b1) b1 = v;
        }
      } else {
        for (let q = ch; q < ch + 4; q++) {
          const mq = nm[q];
          if (mq === 0) continue;
          M += mq; mx += mq * nmx[q]; my += mq * nmy[q]; ms += mq * nsoft[q];
          if (nmaxR[q] > mr) mr = nmaxR[q];
          if (nvx0[q] < a0) a0 = nvx0[q]; if (nvx1[q] > a1) a1 = nvx1[q];
          if (nvy0[q] < b0) b0 = nvy0[q]; if (nvy1[q] > b1) b1 = nvy1[q];
        }
      }
      nm[k] = M;
      if (M > 0) { nmx[k] = mx / M; nmy[k] = my / M; nsoft[k] = ms / M; }
      nmaxR[k] = mr;
      nvx0[k] = a0; nvx1[k] = a1; nvy0[k] = b0; nvy1[k] = b1;
    }
  }

  // ---------- 중력 + 충돌 후보 찾기 ----------
  // 트리의 잎(구슬 몇 개 묶음)마다 한 번 순회해 상호작용 목록을 만들고 묶음 안 구슬들이 같이 쓴다.
  // 충돌 후보에는 이번 스텝 안에 닿을 수 있는 쌍까지 미리 넣는다(고속 충돌 때 뚫고 지나가지 않게).
  _walk(dt) {
    // 이전 접촉을 웜 스타트용으로 보관
    [this.pJ, this.cJ] = [this.cJ, this.pJ];
    [this.pAccN, this.cAccN] = [this.cAccN, this.pAccN];
    [this.pAccT, this.cAccT] = [this.cAccT, this.pAccT];
    [this.pStart, this.cStart] = [this.cStart, this.pStart];
    [this.pCnt, this.cCnt] = [this.cCnt, this.pCnt];
    this.pNc = this.nc;
    this.prevN = this.lastN;

    const { x, y, vx, vy, m, r, soft, ax, ay, next, nchild, nfirst, nm, nmx, nmy, nhs, nmaxR, nsoft, ncx, ncy, nvx0, nvx1, nvy0, nvy1, stack, cStart, cCnt } = this;
    let mono = this.mono, leaves = this.leaves;
    const dtm = dt * 1.25;
    let nc = 0, minT = Infinity;

    for (let L = 0; L < this.nn; L++) {
      if (nchild[L] >= 0 || nfirst[L] < 0) continue;
      // 묶음의 경계 상자, 최대 반지름, 속도 범위
      let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, gr = 0;
      for (let p = nfirst[L]; p >= 0; p = next[p]) {
        const px = x[p], py = y[p];
        if (px < bx0) bx0 = px; if (px > bx1) bx1 = px;
        if (py < by0) by0 = py; if (py > by1) by1 = py;
        if (r[p] > gr) gr = r[p];
      }
      const gu0 = nvx0[L], gu1 = nvx1[L], gv0 = nvy0[L], gv1 = nvy1[L];

      let nMono = 0, nLeaf = 0, sp = 0;
      stack[sp++] = 0;
      while (sp > 0) {
        const k = stack[--sp];
        if (nm[k] === 0) continue;
        const du = Math.max(gu1 - nvx0[k], nvx1[k] - gu0);
        const dv = Math.max(gv1 - nvy0[k], nvy1[k] - gv0);
        const lim = nhs[k] + gr * 1.02 + nmaxR[k] + dtm * Math.sqrt(du * du + dv * dv);
        const cx = ncx[k], cy = ncy[k];
        const near = cx + lim >= bx0 && cx - lim <= bx1 && cy + lim >= by0 && cy - lim <= by1;
        if (!near) {
          const mx = nmx[k], my = nmy[k];
          const ex = mx < bx0 ? bx0 - mx : (mx > bx1 ? mx - bx1 : 0);
          const ey = my < by0 ? by0 - my : (my > by1 ? my - by1 : 0);
          const s = 2 * nhs[k];
          if (s * s < THETA2 * (ex * ex + ey * ey)) {
            // 충분히 먼 노드는 질량중심 하나로 근사
            if (nMono >= mono.length) { const b = new Int32Array(mono.length * 2); b.set(mono); mono = this.mono = b; }
            mono[nMono++] = k;
            continue;
          }
        }
        const ch = nchild[k];
        if (ch >= 0) {
          stack[sp++] = ch; stack[sp++] = ch + 1; stack[sp++] = ch + 2; stack[sp++] = ch + 3;
        } else {
          if (nLeaf >= leaves.length) { const b = new Int32Array(leaves.length * 2); b.set(leaves); leaves = this.leaves = b; }
          leaves[nLeaf++] = k;
        }
      }

      for (let i = nfirst[L]; i >= 0; i = next[i]) {
        cStart[i] = nc;
        const xi = x[i], yi = y[i], ui = vx[i], vi = vy[i], ri = r[i];
        const gi = soft[i];
        let gx = 0, gy = 0;
        for (let q = 0; q < nMono; q++) {
          const k = mono[q];
          const dx = nmx[k] - xi, dy = nmy[k] - yi;
          const dd = dx * dx + dy * dy + gi + nsoft[k];
          const f = nm[k] / (dd * Math.sqrt(dd));
          gx += f * dx; gy += f * dy;
        }
        for (let q = 0; q < nLeaf; q++) {
          for (let p = nfirst[leaves[q]]; p >= 0; p = next[p]) {
            if (p === i) continue;
            const ex = x[p] - xi, ey = y[p] - yi;
            const rs = ri + r[p];
            const q2 = ex * ex + ey * ey;
            const qq = q2 + gi + soft[p];
            const f = m[p] / (qq * Math.sqrt(qq));
            gx += f * ex; gy += f * ey;
            if (p > i) {
              const su = vx[p] - ui, sv = vy[p] - vi;
              const lc = rs * 1.02 + dtm * Math.sqrt(su * su + sv * sv);
              if (q2 < lc * lc) {
                if (nc >= this.ccap) { this.nc = nc; this._growContacts(this.ccap * 2); }
                this.cI[nc] = i; this.cJ[nc] = p;
                nc++;
              }
            }
          }
        }
        cCnt[i] = nc - cStart[i];
        gx *= G; gy *= G;
        ax[i] = gx; ay[i] = gy;
        const a2 = gx * gx + gy * gy;
        if (a2 > 0) {
          const t = ri / Math.sqrt(a2);
          if (t < minT) minT = t;
        }
      }
    }
    this.nc = nc;
    this.lastN = this.n;
    this.dtGrav = 0.3 * Math.sqrt(minT);
  }

  // ---------- 충돌 풀이 (순차 충격량) ----------
  // 구슬도 스스로 돈다(w). 마찰은 접촉점의 미끄럼 속도에 작용하므로
  // 천체 전체가 함께 자전할 때는 마찰이 생기지 않고, 서로 비빌 때만 생긴다.
  _solve(dt, ratio) {
    const { x, y, vx, vy, w, ax, ay, im, iI, r, mat, cI, cJ, cNx, cNy, cGap, cMeff, cMeffT, cTarget, cAccN, cAccT, cMu, cE, pJ, pAccN, pAccT, pStart, pCnt } = this;
    const nc = this.nc, prevN = this.prevN;

    for (let c = 0; c < nc; c++) {
      const i = cI[c], j = cJ[c];
      const dx = x[j] - x[i], dy = y[j] - y[i];
      const d = Math.sqrt(dx * dx + dy * dy);
      let nx = 1, ny = 0;
      if (d > 1e-9) { nx = dx / d; ny = dy / d; }
      const ri = r[i], rj = r[j], rs = ri + rj;
      const gap = d - rs;
      const touching = gap <= 0.02 * rs;
      cNx[c] = nx; cNy[c] = ny; cGap[c] = touching ? 0 : gap;
      cMeff[c] = 1 / (im[i] + im[j]);
      cMeffT[c] = 1 / (im[i] + im[j] + ri * ri * iI[i] + rj * rj * iI[j]);
      const mi = MATS[mat[i]], mj = MATS[mat[j]];
      cMu[c] = touching ? Math.sqrt(mi.mu * mj.mu) : 0;
      cE[c] = Math.min(mi.e, mj.e);

      // 웜 스타트: 지난 스텝의 같은 쌍 충격량을 재사용
      let an = 0, at = 0;
      if (i < prevN) {
        for (let q = pStart[i], qe = q + pCnt[i]; q < qe; q++) {
          if (pJ[q] === j) { an = pAccN[q] * ratio; at = touching ? pAccT[q] * ratio : 0; break; }
        }
      }
      cAccN[c] = an; cAccT[c] = at;
      if (an !== 0 || at !== 0) {
        const px = an * nx - at * ny, py = an * ny + at * nx;
        vx[i] -= px * im[i]; vy[i] -= py * im[i];
        vx[j] += px * im[j]; vy[j] += py * im[j];
        w[i] -= at * ri * iI[i]; w[j] -= at * rj * iI[j];
      }
    }

    for (let c = 0; c < nc; c++) {
      const i = cI[c], j = cJ[c];
      const vn = (vx[j] - vx[i]) * cNx[c] + (vy[j] - vy[i]) * cNy[c];
      const gap = cGap[c];
      if (gap > 0) {
        cTarget[c] = -gap / dt; // 아직 떨어져 있으면 이번 스텝에 딱 닿을 만큼만 접근 허용
      } else {
        const dax = ax[j] - ax[i], day = ay[j] - ay[i];
        const vth = 0.002 + 2 * dt * Math.sqrt(dax * dax + day * day);
        cTarget[c] = vn < -vth ? -cE[c] * vn : 0;
      }
    }

    for (let it = 0; it < ITER; it++) {
      for (let c = 0; c < nc; c++) {
        const i = cI[c], j = cJ[c];
        const nx = cNx[c], ny = cNy[c];
        const imi = im[i], imj = im[j];
        const vn = (vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny;
        const acc = cAccN[c];
        let na = acc + cMeff[c] * (cTarget[c] - vn);
        if (na < 0) na = 0;
        const lam = na - acc;
        cAccN[c] = na;
        if (lam !== 0) {
          vx[i] -= lam * nx * imi; vy[i] -= lam * ny * imi;
          vx[j] += lam * nx * imj; vy[j] += lam * ny * imj;
        }
        const mu = cMu[c];
        if (mu > 0) {
          const ri = r[i], rj = r[j];
          // 접촉점 미끄럼 속도 (t = n을 90° 돌린 방향)
          const vt = -(vx[j] - vx[i]) * ny + (vy[j] - vy[i]) * nx - w[i] * ri - w[j] * rj;
          const at = cAccT[c];
          const lim = mu * na;
          let nt = at - cMeffT[c] * vt;
          if (nt > lim) nt = lim; else if (nt < -lim) nt = -lim;
          const lt = nt - at;
          cAccT[c] = nt;
          if (lt !== 0) {
            const tx = -ny * lt, ty = nx * lt;
            vx[i] -= tx * imi; vy[i] -= ty * imi;
            vx[j] += tx * imj; vy[j] += ty * imj;
            w[i] -= lt * ri * iI[i]; w[j] -= lt * rj * iI[j];
          }
        }
      }
    }
  }

  // 겹친 구슬을 위치로만 밀어낸다 (속도는 건드리지 않아 에너지를 만들지 않음)
  _correct() {
    const { x, y, im, r, cI, cJ } = this;
    const nc = this.nc;
    for (let it = 0; it < POS_ITER; it++) {
      for (let c = 0; c < nc; c++) {
        const i = cI[c], j = cJ[c];
        const dx = x[j] - x[i], dy = y[j] - y[i];
        const d = Math.sqrt(dx * dx + dy * dy);
        const rs = r[i] + r[j];
        const pen = rs - d - 0.005 * rs;
        if (pen <= 0 || d < 1e-9) continue;
        const k = 0.6 * pen / ((im[i] + im[j]) * d);
        x[i] -= dx * k * im[i]; y[i] -= dy * k * im[i];
        x[j] += dx * k * im[j]; y[j] += dy * k * im[j];
      }
    }
  }

  _cfl() {
    const { vx, vy, r, cI, cJ } = this;
    let minT = Infinity;
    for (let c = 0; c < this.nc; c++) {
      const i = cI[c], j = cJ[c];
      const du = vx[j] - vx[i], dv = vy[j] - vy[i];
      const s2 = du * du + dv * dv;
      if (s2 === 0) continue;
      const t = (r[i] + r[j]) / Math.sqrt(s2);
      if (t < minT) minT = t;
    }
    this.dtCfl = 0.3 * minT;
  }

  // maxDt 이내에서 한 스텝 진행하고 실제 사용한 dt 를 돌려준다
  step(maxDt) {
    const dt = Math.min(maxDt, this.dtCrit);
    const n = this.n;
    if (n === 0) { this.time += dt; return dt; }
    const { x, y, vx, vy, ax, ay } = this;

    this._buildTree();
    this._walk(dt);
    for (let i = 0; i < n; i++) { vx[i] += ax[i] * dt; vy[i] += ay[i] * dt; }
    this._solve(dt, dt / this.lastDt);
    for (let i = 0; i < n; i++) { x[i] += vx[i] * dt; y[i] += vy[i] * dt; }
    this._correct();
    this._cfl();

    this.lastDt = dt;
    this.time += dt;
    this.spreadAcc = (this.spreadAcc || 0) + dt;
    if (++this.stepCount % SPREAD_EVERY === 0) { this._spread(this.spreadAcc); this.spreadAcc = 0; }
    this.dtCrit = Math.min(this.dtMax, this.dtGrav, this.dtCfl, this.dtCrit * 1.5);
    return dt;
  }

  // ---------- 서로 붙어 있는 구슬 덩어리(천체) 찾기 ----------
  _union() {
    const n = this.n, parent = this.parent;
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (a) => {
      while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
      return a;
    };
    const { x, y, r, cI, cJ } = this;
    for (let c = 0; c < this.nc; c++) {
      const i = cI[c], j = cJ[c];
      if (i >= n || j >= n) continue;
      const dx = x[j] - x[i], dy = y[j] - y[i], rs = (r[i] + r[j]) * 1.05;
      if (dx * dx + dy * dy > rs * rs) continue;
      const a = find(i), b = find(j);
      if (a !== b) parent[a] = b;
    }
    for (let i = 0; i < n; i++) parent[i] = find(i);
    return parent;
  }

  // 덩어리 모양이 바뀌면(부서짐·합쳐짐) 기둥의 수직 퍼짐도 그 덩어리에 맞게 바뀐다.
  // 실제로 물질이 새 모양으로 가라앉는 시간(자유낙하 시간 ~1/√(Gρ))에 걸쳐 천천히 따라간다.
  _spread(elapsed) {
    const n = this.n, root = this._union();
    const { x, y, m, r, rho, ga2, sg2, soft } = this;
    const M = new Float64Array(n), MX = new Float64Array(n), MY = new Float64Array(n), A = new Float64Array(n);
    const S1 = new Float64Array(n), S2 = new Float64Array(n), d2 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const k = root[i];
      M[k] += m[i]; MX[k] += m[i] * x[i]; MY[k] += m[i] * y[i]; A[k] += r[i] * r[i];
    }
    for (let i = 0; i < n; i++) {
      const k = root[i];
      const dx = x[i] - MX[k] / M[k], dy = y[i] - MY[k] / M[k];
      d2[i] = dx * dx + dy * dy;
      S1[k] += m[i] * d2[i];
      S2[k] += m[i] * Math.max(0, A[k] / 0.8 - d2[i]); // A/0.8: 덩어리를 원판으로 본 반지름²
    }
    for (let i = 0; i < n; i++) {
      const k = root[i];
      const target = spreadCoef(S1[k], S2[k]) * Math.max(0, A[k] / 0.8 - d2[i]);
      const f = 1 - Math.exp(-elapsed * Math.sqrt(G * rho[i]));
      sg2[i] += (target - sg2[i]) * f;
      soft[i] = ga2[i] + sg2[i];
    }
  }

  clumps(minCount) {
    const n = this.n, parent = this._union();
    const find = (a) => parent[a];
    const { x, y, vx, vy, m, r, rho, org } = this;
    const map = new Map();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      let c = map.get(root);
      if (!c) { c = { count: 0, mass: 0, mx: 0, my: 0, px: 0, py: 0, vol: 0, byOrg: new Map() }; map.set(root, c); }
      const mi = m[i];
      c.count++; c.mass += mi; c.mx += mi * x[i]; c.my += mi * y[i];
      c.px += mi * vx[i]; c.py += mi * vy[i];
      c.vol += mi / rho[i];
      c.byOrg.set(org[i], (c.byOrg.get(org[i]) || 0) + mi);
    }
    const out = [];
    for (const c of map.values()) {
      if (c.count < minCount) continue;
      c.x = c.mx / c.mass; c.y = c.my / c.mass;
      c.vx = c.px / c.mass; c.vy = c.py / c.mass;
      c.density = c.mass / c.vol; // kg/km³ (3차원 평균 밀도)
      c.radius = 0;
      out.push(c);
    }
    for (let i = 0; i < n; i++) {
      const c = map.get(find(i));
      if (c.count < minCount) continue;
      const dx = x[i] - c.x, dy = y[i] - c.y;
      const d = Math.sqrt(dx * dx + dy * dy) + r[i];
      if (d > c.radius) c.radius = d;
    }
    out.sort((a, b) => b.mass - a.mass);
    return out;
  }
}

// 유체 로슈 한계: d = 2.44 · R_주천체 · (ρ_주천체/ρ_위성)^(1/3) = 2.44 · (3M/(4πρ_위성))^(1/3)
export function rocheLimit(primaryMass, satelliteDensity) {
  return 2.44 * Math.cbrt((3 * primaryMass) / (4 * Math.PI * satelliteDensity));
}
