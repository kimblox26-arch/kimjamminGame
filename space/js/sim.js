// 구슬(입자) 기반 3D 천체 물리
// 단위: 거리 km, 질량 kg, 시간 s
//
// - 중력: 모든 구슬끼리 뉴턴 만유인력(1/r²), Barnes-Hut 팔진트리로 근사
// - 충돌: 구슬끼리 비탄성 충돌(반발계수) + 마찰 + 구슬 자체의 회전, 운동량 보존 충격량 방식
// - 구슬 사이에 접착력은 없다 → 천체는 자기 중력으로만 뭉쳐 있으므로
//   다른 천체의 기조력이 자기 중력보다 커지는 거리(로슈 한계) 안에서는 실제처럼 찢어진다.
//   찢어진 파편은 각운동량을 지닌 채 충돌로 에너지를 잃으며 고리로 퍼지고,
//   로슈 한계 밖에서는 자기 중력으로 다시 뭉쳐 위성이 된다.

export const G = 6.674e-20; // km³ / (kg·s²)

// 재질: mu 마찰계수, e 반발계수
// 행성 크기에서는 암석도 자기 중력에 눌려 유체처럼 흐르므로 마찰은 작게 둔다
export const MATS = [
  { key: 'iron', mu: 0.02, e: 0.1 },
  { key: 'rock', mu: 0.02, e: 0.1 },
  { key: 'ice', mu: 0.01, e: 0.2 },
  { key: 'gas', mu: 0.0, e: 0.0 },
];

const BUCKET = 16;
const MAX_DEPTH = 40;
const THETA2 = 0.7 * 0.7;
const ITER = 6;
const POS_ITER = 2;

export class Sim {
  constructor() {
    this.cap = 0;
    this.n = 0;
    this.ncap = 0;
    this.nn = 0;
    this.ccap = 0;
    this.nc = 0;
    this.pNc = 0;
    this.prevN = 0;
    this.lastN = 0;
    this.time = 0;
    this.dtMax = 120;
    this.dtCrit = 1;
    this.dtGrav = Infinity;
    this.dtCfl = Infinity;
    this.lastDt = 1;
    this.bodies = []; // 처음 넣은 행성 정보 (이름, 질량)
    this.stack = new Int32Array(4096);
    this.mono = new Int32Array(1024);
    this.leaves = new Int32Array(256);
    this.lmargin = new Float64Array(256);
    this.count = new Int32Array(0);
    this._grow(4096);
    this._growNodes(8192);
    this._growContacts(16384);
  }

  reset() {
    this.n = 0;
    this.nc = 0;
    this.pNc = 0;
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
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'wx', 'wy', 'wz', 'ax', 'ay', 'az', 'm', 'im', 'iI', 'r', 'rho', 'soft']) this[k] = f64(this[k]);
    for (const k of ['mat', 'col', 'org', 'next', 'ord']) this[k] = i32(this[k]);
    // 트리 순서로 다시 늘어놓은 사본 (가까운 구슬이 메모리에서도 가깝게)
    for (const k of ['ox', 'oy', 'oz', 'om', 'os', 'or']) this[k] = new Float64Array(cap);
    for (const k of ['cStart', 'pStart', 'cCnt', 'pCnt']) this[k] = i32(this[k]);
    this.parent = new Int32Array(cap);
    this.cap = cap;
  }

  _growNodes(cap) {
    const nn = this.nn;
    const f64 = (a) => { const b = new Float64Array(cap); if (a) b.set(a.subarray(0, nn)); return b; };
    const i32 = (a) => { const b = new Int32Array(cap); if (a) b.set(a.subarray(0, nn)); return b; };
    for (const k of ['ncx', 'ncy', 'ncz', 'nhs', 'nm', 'nmx', 'nmy', 'nmz', 'nmaxR', 'nsoft',
      'nvx0', 'nvx1', 'nvy0', 'nvy1', 'nvz0', 'nvz1']) this[k] = f64(this[k]);
    for (const k of ['nchild', 'nfirst', 'count', 'lstart', 'lend']) this[k] = i32(this[k]);
    this.ncap = cap;
  }

  _growContacts(cap) {
    const nc = this.nc, pn = this.pNc;
    const f64 = (a, len) => { const b = new Float64Array(cap); if (a) b.set(a.subarray(0, len)); return b; };
    const i32 = (a, len) => { const b = new Int32Array(cap); if (a) b.set(a.subarray(0, len)); return b; };
    for (const k of ['cNx', 'cNy', 'cNz', 'cGap', 'cMeff', 'cMeffT', 'cTarget', 'cAccN', 'cAtx', 'cAty', 'cAtz', 'cMu', 'cE']) this[k] = f64(this[k], nc);
    for (const k of ['cI', 'cJ']) this[k] = i32(this[k], nc);
    // 이전 스텝 접촉(웜 스타트용)
    this.pJ = i32(this.pJ, pn);
    for (const k of ['pAccN', 'pAtx', 'pAty', 'pAtz']) this[k] = f64(this[k], pn);
    this.ccap = cap;
  }

  // (wx, wy, wz): 구슬 자체의 자전 각속도 (rad/s)
  add(x, y, z, vx, vy, vz, wx, wy, wz, m, r, rho, mat, col, org) {
    if (this.n >= this.cap) this._grow(this.cap * 2);
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.wx[i] = wx; this.wy[i] = wy; this.wz[i] = wz;
    this.ax[i] = 0; this.ay[i] = 0; this.az[i] = 0;
    this.m[i] = m; this.im[i] = 1 / m; this.r[i] = r; this.rho[i] = rho;
    this.iI[i] = 1 / (0.4 * m * r * r); // 구슬(구) 관성모멘트 2/5·m·r²
    this.soft[i] = 0.09 * r * r;        // 겹쳤을 때 중력이 무한대가 되지 않게 하는 완화 길이²
    this.mat[i] = mat; this.col[i] = col; this.org[i] = org;
    // 새 천체가 들어오면 시간 간격을 작게 다시 시작
    this.dtCrit = Math.min(this.dtCrit, 5);
    return i;
  }

  // ---------- 팔진트리 ----------
  _node(cx, cy, cz, hs) {
    if (this.nn >= this.ncap) this._growNodes(this.ncap * 2);
    const k = this.nn++;
    this.ncx[k] = cx; this.ncy[k] = cy; this.ncz[k] = cz; this.nhs[k] = hs;
    this.nchild[k] = -1; this.nfirst[k] = -1; this.count[k] = 0;
    return k;
  }

  _buildTree() {
    const n = this.n, x = this.x, y = this.y, z = this.z;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i], zi = z[i];
      if (xi < x0) x0 = xi; if (xi > x1) x1 = xi;
      if (yi < y0) y0 = yi; if (yi > y1) y1 = yi;
      if (zi < z0) z0 = zi; if (zi > z1) z1 = zi;
    }
    this.nn = 0;
    this._node((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, y1 - y0, z1 - z0) * 0.50001 + 1);
    for (let i = 0; i < n; i++) this._insert(i);
    this._aggregate();
    this._order();
  }

  _order() {
    const { x, y, z, m, r, soft, next, nchild, nfirst, lstart, lend, ord, ox, oy, oz, om, os, or } = this;
    let t = 0;
    for (let k = 0; k < this.nn; k++) {
      if (nchild[k] >= 0) continue;
      lstart[k] = t;
      for (let p = nfirst[k]; p >= 0; p = next[p]) {
        ord[t] = p;
        ox[t] = x[p]; oy[t] = y[p]; oz[t] = z[p]; om[t] = m[p]; os[t] = soft[p]; or[t] = r[p];
        t++;
      }
      lend[k] = t;
    }
  }

  _insert(i) {
    const px = this.x[i], py = this.y[i], pz = this.z[i];
    let k = 0, depth = 0;
    for (;;) {
      const ch = this.nchild[k];
      if (ch >= 0) {
        k = ch + (px >= this.ncx[k] ? 1 : 0) + (py >= this.ncy[k] ? 2 : 0) + (pz >= this.ncz[k] ? 4 : 0);
        depth++;
        continue;
      }
      if (this.count[k] < BUCKET || depth >= MAX_DEPTH) {
        this.next[i] = this.nfirst[k]; this.nfirst[k] = i; this.count[k]++;
        return;
      }
      // 잎 노드가 가득 차면 8개로 나눈다
      const h = this.nhs[k] * 0.5, cx = this.ncx[k], cy = this.ncy[k], cz = this.ncz[k];
      const c = this.nn;
      for (let q = 0; q < 8; q++) this._node(cx + (q & 1 ? h : -h), cy + (q & 2 ? h : -h), cz + (q & 4 ? h : -h), h);
      this.nchild[k] = c;
      let p = this.nfirst[k];
      this.nfirst[k] = -1; this.count[k] = 0;
      while (p >= 0) {
        const nxt = this.next[p];
        const q = c + (this.x[p] >= cx ? 1 : 0) + (this.y[p] >= cy ? 2 : 0) + (this.z[p] >= cz ? 4 : 0);
        this.next[p] = this.nfirst[q]; this.nfirst[q] = p; this.count[q]++;
        p = nxt;
      }
    }
  }

  // 자식 노드가 항상 부모보다 뒤에 만들어지므로 거꾸로 돌며 합산
  _aggregate() {
    const { x, y, z, vx, vy, vz, m, r, soft, next, nchild, nfirst, nm, nmx, nmy, nmz, nmaxR, nsoft, nvx0, nvx1, nvy0, nvy1, nvz0, nvz1 } = this;
    for (let k = this.nn - 1; k >= 0; k--) {
      let M = 0, mx = 0, my = 0, mz = 0, mr = 0, ms = 0;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity, c0 = Infinity, c1 = -Infinity;
      const ch = nchild[k];
      if (ch < 0) {
        for (let p = nfirst[k]; p >= 0; p = next[p]) {
          const mp = m[p];
          M += mp; mx += mp * x[p]; my += mp * y[p]; mz += mp * z[p]; ms += mp * soft[p];
          if (r[p] > mr) mr = r[p];
          const u = vx[p], v = vy[p], w = vz[p];
          if (u < a0) a0 = u; if (u > a1) a1 = u;
          if (v < b0) b0 = v; if (v > b1) b1 = v;
          if (w < c0) c0 = w; if (w > c1) c1 = w;
        }
      } else {
        for (let q = ch; q < ch + 8; q++) {
          const mq = nm[q];
          if (mq === 0) continue;
          M += mq; mx += mq * nmx[q]; my += mq * nmy[q]; mz += mq * nmz[q]; ms += mq * nsoft[q];
          if (nmaxR[q] > mr) mr = nmaxR[q];
          if (nvx0[q] < a0) a0 = nvx0[q]; if (nvx1[q] > a1) a1 = nvx1[q];
          if (nvy0[q] < b0) b0 = nvy0[q]; if (nvy1[q] > b1) b1 = nvy1[q];
          if (nvz0[q] < c0) c0 = nvz0[q]; if (nvz1[q] > c1) c1 = nvz1[q];
        }
      }
      nm[k] = M;
      if (M > 0) { nmx[k] = mx / M; nmy[k] = my / M; nmz[k] = mz / M; nsoft[k] = ms / M; }
      nmaxR[k] = mr;
      nvx0[k] = a0; nvx1[k] = a1; nvy0[k] = b0; nvy1[k] = b1; nvz0[k] = c0; nvz1[k] = c1;
    }
  }

  // ---------- 중력 + 충돌 후보 찾기 ----------
  // 트리의 잎(구슬 몇 개 묶음)마다 한 번 순회해 상호작용 목록을 만들고 묶음 안 구슬들이 같이 쓴다.
  // 충돌 후보에는 이번 스텝 안에 닿을 수 있는 쌍까지 미리 넣는다(고속 충돌 때 뚫고 지나가지 않게).
  _walk(dt) {
    // 이전 접촉을 웜 스타트용으로 보관
    [this.pJ, this.cJ] = [this.cJ, this.pJ];
    [this.pAccN, this.cAccN] = [this.cAccN, this.pAccN];
    [this.pAtx, this.cAtx] = [this.cAtx, this.pAtx];
    [this.pAty, this.cAty] = [this.cAty, this.pAty];
    [this.pAtz, this.cAtz] = [this.cAtz, this.pAtz];
    [this.pStart, this.cStart] = [this.cStart, this.pStart];
    [this.pCnt, this.cCnt] = [this.cCnt, this.pCnt];
    this.pNc = this.nc;
    this.prevN = this.lastN;
    if (this.stack.length < 8 * MAX_DEPTH + 16) this.stack = new Int32Array(8 * MAX_DEPTH + 16);

    const { ax, ay, az, nchild, nfirst, nm, nmx, nmy, nmz, nhs, nmaxR, nsoft, lstart, lend,
      ncx, ncy, ncz, nvx0, nvx1, nvy0, nvy1, nvz0, nvz1, stack, cStart, cCnt, ord, ox, oy, oz, om, os, or } = this;
    let mono = this.mono, leaves = this.leaves, lmargin = this.lmargin;
    const dtm = dt * 1.25;
    let nc = 0, minT = Infinity;

    for (let L = 0; L < this.nn; L++) {
      if (nchild[L] >= 0 || nfirst[L] < 0) continue;
      // 묶음의 경계 상자, 최대 반지름, 속도 범위
      let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity, gr = 0;
      const t0 = lstart[L], t1 = lend[L];
      for (let t = t0; t < t1; t++) {
        const px = ox[t], py = oy[t], pz = oz[t];
        if (px < bx0) bx0 = px; if (px > bx1) bx1 = px;
        if (py < by0) by0 = py; if (py > by1) by1 = py;
        if (pz < bz0) bz0 = pz; if (pz > bz1) bz1 = pz;
        if (or[t] > gr) gr = or[t];
      }
      const gu0 = nvx0[L], gu1 = nvx1[L], gv0 = nvy0[L], gv1 = nvy1[L], gw0 = nvz0[L], gw1 = nvz1[L];

      let nMono = 0, nLeaf = 0, sp = 0;
      stack[sp++] = 0;
      while (sp > 0) {
        const k = stack[--sp];
        if (nm[k] === 0) continue;
        const du = Math.max(gu1 - nvx0[k], nvx1[k] - gu0);
        const dv = Math.max(gv1 - nvy0[k], nvy1[k] - gv0);
        const dw = Math.max(gw1 - nvz0[k], nvz1[k] - gw0);
        const lim = nhs[k] + gr * 1.02 + nmaxR[k] + dtm * Math.sqrt(du * du + dv * dv + dw * dw);
        const cx = ncx[k], cy = ncy[k], cz = ncz[k];
        const near = cx + lim >= bx0 && cx - lim <= bx1 && cy + lim >= by0 && cy - lim <= by1 && cz + lim >= bz0 && cz - lim <= bz1;
        if (!near) {
          const mx = nmx[k], my = nmy[k], mz = nmz[k];
          const ex = mx < bx0 ? bx0 - mx : (mx > bx1 ? mx - bx1 : 0);
          const ey = my < by0 ? by0 - my : (my > by1 ? my - by1 : 0);
          const ez = mz < bz0 ? bz0 - mz : (mz > bz1 ? mz - bz1 : 0);
          const s = 2 * nhs[k];
          if (s * s < THETA2 * (ex * ex + ey * ey + ez * ez)) {
            // 충분히 먼 노드는 질량중심 하나로 근사
            if (nMono >= mono.length) { const b = new Int32Array(mono.length * 2); b.set(mono); mono = this.mono = b; }
            mono[nMono++] = k;
            continue;
          }
        }
        const ch = nchild[k];
        if (ch >= 0) {
          for (let q = 0; q < 8; q++) stack[sp++] = ch + q;
        } else {
          if (nLeaf >= leaves.length) {
            const b = new Int32Array(leaves.length * 2); b.set(leaves); leaves = this.leaves = b;
            const c = new Float64Array(leaves.length); c.set(lmargin); lmargin = this.lmargin = c;
          }
          lmargin[nLeaf] = dtm * Math.sqrt(du * du + dv * dv + dw * dw); // 이 묶음과의 상대속도 상한으로 이번 스텝에 다가올 수 있는 거리
          leaves[nLeaf++] = k;
        }
      }

      for (let t = t0; t < t1; t++) {
        const i = ord[t];
        cStart[i] = nc;
        const xi = ox[t], yi = oy[t], zi = oz[t], ri = or[t];
        const si = os[t];
        let gx = 0, gy = 0, gz = 0;
        for (let q = 0; q < nMono; q++) {
          const k = mono[q];
          const dx = nmx[k] - xi, dy = nmy[k] - yi, dz = nmz[k] - zi;
          const dd = dx * dx + dy * dy + dz * dz + si + nsoft[k];
          const f = nm[k] / (dd * Math.sqrt(dd));
          gx += f * dx; gy += f * dy; gz += f * dz;
        }
        for (let q = 0; q < nLeaf; q++) {
          const lq = leaves[q], lm = lmargin[q];
          for (let u = lstart[lq], ue = lend[lq]; u < ue; u++) {
            if (u === t) continue;
            const ex = ox[u] - xi, ey = oy[u] - yi, ez = oz[u] - zi;
            const q2 = ex * ex + ey * ey + ez * ez;
            const qq = q2 + si + os[u];
            const f = om[u] / (qq * Math.sqrt(qq));
            gx += f * ex; gy += f * ey; gz += f * ez;
            const p = ord[u];
            if (p > i) {
              const lc = (ri + or[u]) * 1.02 + lm;
              if (q2 < lc * lc) {
                if (nc >= this.ccap) { this.nc = nc; this._growContacts(this.ccap * 2); }
                this.cI[nc] = i; this.cJ[nc] = p;
                nc++;
              }
            }
          }
        }
        cCnt[i] = nc - cStart[i];
        gx *= G; gy *= G; gz *= G;
        ax[i] = gx; ay[i] = gy; az[i] = gz;
        const a2 = gx * gx + gy * gy + gz * gz;
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
    const { x, y, z, vx, vy, vz, wx, wy, wz, ax, ay, az, im, iI, r, mat, cI, cJ, cNx, cNy, cNz, cGap, cMeff, cMeffT, cTarget,
      cAccN, cAtx, cAty, cAtz, cMu, cE, pJ, pAccN, pAtx, pAty, pAtz, pStart, pCnt } = this;
    const nc = this.nc, prevN = this.prevN;

    for (let c = 0; c < nc; c++) {
      const i = cI[c], j = cJ[c];
      const dx = x[j] - x[i], dy = y[j] - y[i], dz = z[j] - z[i];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let nx = 1, ny = 0, nz = 0;
      if (d > 1e-9) { nx = dx / d; ny = dy / d; nz = dz / d; }
      const ri = r[i], rj = r[j], rs = ri + rj;
      const gap = d - rs;
      const touching = gap <= 0.02 * rs;
      cNx[c] = nx; cNy[c] = ny; cNz[c] = nz; cGap[c] = touching ? 0 : gap;
      cMeff[c] = 1 / (im[i] + im[j]);
      cMeffT[c] = 1 / (im[i] + im[j] + ri * ri * iI[i] + rj * rj * iI[j]);
      const mi = MATS[mat[i]], mj = MATS[mat[j]];
      cMu[c] = touching ? Math.sqrt(mi.mu * mj.mu) : 0;
      cE[c] = Math.min(mi.e, mj.e);

      // 웜 스타트: 지난 스텝의 같은 쌍 충격량을 재사용 (마찰은 새 접선면으로 투영)
      let an = 0, tx = 0, ty = 0, tz = 0;
      if (i < prevN) {
        for (let q = pStart[i], qe = q + pCnt[i]; q < qe; q++) {
          if (pJ[q] !== j) continue;
          an = pAccN[q] * ratio;
          if (touching) {
            tx = pAtx[q] * ratio; ty = pAty[q] * ratio; tz = pAtz[q] * ratio;
            const tn = tx * nx + ty * ny + tz * nz;
            tx -= tn * nx; ty -= tn * ny; tz -= tn * nz;
          }
          break;
        }
      }
      cAccN[c] = an; cAtx[c] = tx; cAty[c] = ty; cAtz[c] = tz;
      if (an !== 0 || tx !== 0 || ty !== 0 || tz !== 0) {
        const px = an * nx + tx, py = an * ny + ty, pz = an * nz + tz;
        vx[i] -= px * im[i]; vy[i] -= py * im[i]; vz[i] -= pz * im[i];
        vx[j] += px * im[j]; vy[j] += py * im[j]; vz[j] += pz * im[j];
        this._spin(i, j, nx, ny, nz, tx, ty, tz);
      }
    }

    for (let c = 0; c < nc; c++) {
      const i = cI[c], j = cJ[c];
      const vn = (vx[j] - vx[i]) * cNx[c] + (vy[j] - vy[i]) * cNy[c] + (vz[j] - vz[i]) * cNz[c];
      const gap = cGap[c];
      if (gap > 0) {
        cTarget[c] = -gap / dt; // 아직 떨어져 있으면 이번 스텝에 딱 닿을 만큼만 접근 허용
      } else {
        const dax = ax[j] - ax[i], day = ay[j] - ay[i], daz = az[j] - az[i];
        const vth = 0.002 + 2 * dt * Math.sqrt(dax * dax + day * day + daz * daz);
        cTarget[c] = vn < -vth ? -cE[c] * vn : 0;
      }
    }

    for (let it = 0; it < ITER; it++) {
      for (let c = 0; c < nc; c++) {
        const i = cI[c], j = cJ[c];
        const nx = cNx[c], ny = cNy[c], nz = cNz[c];
        const imi = im[i], imj = im[j];
        const vn = (vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny + (vz[j] - vz[i]) * nz;
        const acc = cAccN[c];
        let na = acc + cMeff[c] * (cTarget[c] - vn);
        if (na < 0) na = 0;
        const lam = na - acc;
        cAccN[c] = na;
        if (lam !== 0) {
          vx[i] -= lam * nx * imi; vy[i] -= lam * ny * imi; vz[i] -= lam * nz * imi;
          vx[j] += lam * nx * imj; vy[j] += lam * ny * imj; vz[j] += lam * nz * imj;
        }
        const mu = cMu[c];
        if (mu > 0) {
          const ri = r[i], rj = r[j];
          // 접촉점 미끄럼 속도 = (vj − vi) − (ri·wi + rj·wj) × n 의 접선 성분
          const sx = ri * wx[i] + rj * wx[j], sy = ri * wy[i] + rj * wy[j], sz = ri * wz[i] + rj * wz[j];
          let ux = vx[j] - vx[i] - (sy * nz - sz * ny);
          let uy = vy[j] - vy[i] - (sz * nx - sx * nz);
          let uz = vz[j] - vz[i] - (sx * ny - sy * nx);
          const un = ux * nx + uy * ny + uz * nz;
          ux -= un * nx; uy -= un * ny; uz -= un * nz;
          const mt = cMeffT[c];
          let tx = cAtx[c] - mt * ux, ty = cAty[c] - mt * uy, tz = cAtz[c] - mt * uz;
          const lim = mu * na, t2 = tx * tx + ty * ty + tz * tz;
          if (t2 > lim * lim) { const s = lim / Math.sqrt(t2); tx *= s; ty *= s; tz *= s; }
          const lx = tx - cAtx[c], ly = ty - cAty[c], lz = tz - cAtz[c];
          cAtx[c] = tx; cAty[c] = ty; cAtz[c] = tz;
          if (lx !== 0 || ly !== 0 || lz !== 0) {
            vx[i] -= lx * imi; vy[i] -= ly * imi; vz[i] -= lz * imi;
            vx[j] += lx * imj; vy[j] += ly * imj; vz[j] += lz * imj;
            const qx = ny * lz - nz * ly, qy = nz * lx - nx * lz, qz = nx * ly - ny * lx;
            const ki = ri * iI[i], kj = rj * iI[j];
            wx[i] -= qx * ki; wy[i] -= qy * ki; wz[i] -= qz * ki;
            wx[j] -= qx * kj; wy[j] -= qy * kj; wz[j] -= qz * kj;
          }
        }
      }
    }
  }

  // 접선 충격량 P(j에 +P, i에 −P)가 두 구슬의 자전에 주는 변화: Δw = −iI·r·(n × P)
  _spin(i, j, nx, ny, nz, px, py, pz) {
    const cx = ny * pz - nz * py, cy = nz * px - nx * pz, cz = nx * py - ny * px;
    const ki = this.r[i] * this.iI[i], kj = this.r[j] * this.iI[j];
    this.wx[i] -= cx * ki; this.wy[i] -= cy * ki; this.wz[i] -= cz * ki;
    this.wx[j] -= cx * kj; this.wy[j] -= cy * kj; this.wz[j] -= cz * kj;
  }

  // 겹친 구슬을 위치로만 밀어낸다 (속도는 건드리지 않아 에너지를 만들지 않음)
  _correct() {
    const { x, y, z, im, r, cI, cJ } = this;
    const nc = this.nc;
    for (let it = 0; it < POS_ITER; it++) {
      for (let c = 0; c < nc; c++) {
        const i = cI[c], j = cJ[c];
        const dx = x[j] - x[i], dy = y[j] - y[i], dz = z[j] - z[i];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const rs = r[i] + r[j];
        const pen = rs - d - 0.005 * rs;
        if (pen <= 0 || d < 1e-9) continue;
        const k = 0.6 * pen / ((im[i] + im[j]) * d);
        x[i] -= dx * k * im[i]; y[i] -= dy * k * im[i]; z[i] -= dz * k * im[i];
        x[j] += dx * k * im[j]; y[j] += dy * k * im[j]; z[j] += dz * k * im[j];
      }
    }
  }

  _cfl() {
    const { vx, vy, vz, r, cI, cJ } = this;
    let minT = Infinity;
    for (let c = 0; c < this.nc; c++) {
      const i = cI[c], j = cJ[c];
      const du = vx[j] - vx[i], dv = vy[j] - vy[i], dw = vz[j] - vz[i];
      const s2 = du * du + dv * dv + dw * dw;
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
    const { x, y, z, vx, vy, vz, ax, ay, az } = this;

    this._buildTree();
    this._walk(dt);
    for (let i = 0; i < n; i++) { vx[i] += ax[i] * dt; vy[i] += ay[i] * dt; vz[i] += az[i] * dt; }
    this._solve(dt, dt / this.lastDt);
    for (let i = 0; i < n; i++) { x[i] += vx[i] * dt; y[i] += vy[i] * dt; z[i] += vz[i] * dt; }
    this._correct();
    this._cfl();

    this.lastDt = dt;
    this.time += dt;
    this.dtCrit = Math.min(this.dtMax, this.dtGrav, this.dtCfl, this.dtCrit * 1.5);
    return dt;
  }

  // ---------- 서로 붙어 있는 구슬 덩어리(천체) 찾기 ----------
  clumps(minCount) {
    const n = this.n, parent = this.parent;
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (a) => {
      while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
      return a;
    };
    const { x, y, z, vx, vy, vz, m, r, rho, org, cI, cJ } = this;
    for (let c = 0; c < this.nc; c++) {
      const i = cI[c], j = cJ[c];
      if (i >= n || j >= n) continue;
      const dx = x[j] - x[i], dy = y[j] - y[i], dz = z[j] - z[i], rs = (r[i] + r[j]) * 1.05;
      if (dx * dx + dy * dy + dz * dz > rs * rs) continue;
      const a = find(i), b = find(j);
      if (a !== b) parent[a] = b;
    }
    for (let i = 0; i < n; i++) parent[i] = find(i);
    const map = new Map();
    for (let i = 0; i < n; i++) {
      let c = map.get(parent[i]);
      if (!c) { c = { count: 0, mass: 0, mx: 0, my: 0, mz: 0, px: 0, py: 0, pz: 0, vol: 0, byOrg: new Map() }; map.set(parent[i], c); }
      const mi = m[i];
      c.count++; c.mass += mi; c.mx += mi * x[i]; c.my += mi * y[i]; c.mz += mi * z[i];
      c.px += mi * vx[i]; c.py += mi * vy[i]; c.pz += mi * vz[i];
      c.vol += mi / rho[i];
      c.byOrg.set(org[i], (c.byOrg.get(org[i]) || 0) + mi);
    }
    const out = [];
    for (const c of map.values()) {
      if (c.count < minCount) continue;
      c.x = c.mx / c.mass; c.y = c.my / c.mass; c.z = c.mz / c.mass;
      c.vx = c.px / c.mass; c.vy = c.py / c.mass; c.vz = c.pz / c.mass;
      c.density = c.mass / c.vol; // kg/km³ (평균 밀도)
      c.radius = 0;
      out.push(c);
    }
    for (let i = 0; i < n; i++) {
      const c = map.get(parent[i]);
      if (c.count < minCount) continue;
      const dx = x[i] - c.x, dy = y[i] - c.y, dz = z[i] - c.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + r[i];
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
