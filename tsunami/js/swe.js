// 비선형 천수방정식(Shallow Water Equations) 솔버
//  - 엇갈린 격자(Arakawa C): 수심 h는 셀 중심, 유속 u·v는 셀 경계면
//  - 운동량: 압력경사(중력) + 상류차분 이류 + 반암시적 매닝 마찰
//  - 연속식: 정수압 재구성 상류 수심 플럭스 + 유출 제한기(질량 보존·음수 수심 방지)
//  - 침수/건조(wetting & drying), 건물=고체 셀, 개방 경계=스펀지 흡수층
//  - CFL 조건으로 서브스텝 자동 분할
import { G, HALF, WORLD } from './config.js';

const EPS = 1e-3;
const VMAX = 24;

export class ShallowWater {
  constructor(N, bedAt) {
    this.N = N;
    this.dx = WORLD / N;
    const C = N * N;
    this.b0 = new Float32Array(C);   // 지형 바닥고
    this.b = new Float32Array(C);    // 유효 바닥고 (건물 포함)
    this.h = new Float32Array(C);
    this.u = new Float32Array((N + 1) * N);
    this.forcing = null;
    this.forceDir = [0, -1];
    this.v = new Float32Array(N * (N + 1));
    this.un = new Float32Array((N + 1) * N);
    this.vn = new Float32Array(N * (N + 1));
    this.fx = new Float32Array((N + 1) * N);
    this.fz = new Float32Array(N * (N + 1));
    this.lim = new Float32Array(C);
    this.n2 = new Float32Array(C);
    this.uc = new Float32Array(C);
    this.vc = new Float32Array(C);
    this.foam = new Float32Array(C);
    this.mud = new Float32Array(C);
    this.tmpA = new Float32Array(C);
    this.tmpB = new Float32Array(C);
    this.maxH = new Float32Array(C);
    this.wet = new Float32Array(C);
    this.deposit = new Float32Array(C);
    this.arrive = new Float32Array(C).fill(-1);
    this.texW = new Float32Array(C * 4);
    this.texWPrev = new Float32Array(C * 4);
    this.minStep = 0.045;
    this.acc = 0;
    this.lastStep = 0;
    this.texF = new Uint8Array(C * 4);
    this.texFlood = new Uint8Array(C * 4);
    const CN = Math.ceil(N / 8);
    this.CN = CN;
    this.threat = new Float32Array(CN * CN);
    this.drawdown = new Float32Array(CN * CN);
    this.time = 0;
    this.steps = 0;
    this.hmax = 0;
    this.umax = 0;

    // 바닥고: 셀 내부 3x3 표본 평균
    const dx = this.dx;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) {
          s += bedAt(-HALF + (i + (a + 0.5) / 3) * dx, -HALF + (j + (c + 0.5) / 3) * dx);
        }
        const k = j * N + i;
        this.b0[k] = s / 9;
        this.n2[k] = this.b0[k] < 0 ? 0.025 * 0.025 : 0.035 * 0.035;
      }
    }
    // 해안 셀 (파고 계측용)
    this.coastCells = [];
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      if (this.b0[k] < -0.3 && this.b0[k] > -6 &&
        (this.b0[k - 1] > 0.5 || this.b0[k + 1] > 0.5 || this.b0[k - N] > 0.5 || this.b0[k + N] > 0.5)) this.coastCells.push(k);
    }
    // 스펀지 흡수층
    const B = Math.max(8, Math.round(N / 22));
    this.spongeCells = [];
    this.spongeW = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const d = Math.min(i, j, N - 1 - i, N - 1 - j);
      if (d < B) { this.spongeCells.push(j * N + i); this.spongeW.push(((B - d) / B) ** 2); }
    }
    this.reset();
  }

  reset() {
    const C = this.N * this.N;
    this.b.set(this.b0);
    for (let k = 0; k < C; k++) this.h[k] = this.b0[k] < 0 ? -this.b0[k] : 0;
    this.u.fill(0); this.v.fill(0);
    this.foam.fill(0); this.mud.fill(0); this.maxH.fill(0);
    this.wet.fill(0); this.deposit.fill(0); this.arrive.fill(-1);
    this.uc.fill(0); this.vc.fill(0);
    this.threat.fill(0); this.drawdown.fill(0);
    this.time = 0;
    this.steps = 0;
    this.active = false;
    this.coastMax = 0;
    this.acc = 0;
    this.lastStep = 0;
    this.prepareTextures(0);
    this.texWPrev.set(this.texW);
    this.prevDirty = true;
  }

  cellOf(x, z) {
    const N = this.N;
    let i = Math.floor((x + HALF) / this.dx), j = Math.floor((z + HALF) / this.dx);
    if (i < 0) i = 0; else if (i >= N) i = N - 1;
    if (j < 0) j = 0; else if (j >= N) j = N - 1;
    return j * N + i;
  }

  setSolid(k, height) {
    this.b[k] = this.b0[k] + height;
    if (this.h[k] > 0) this.h[k] = 0;
  }

  clearSolid(k) { this.b[k] = this.b0[k]; }

  /** 시뮬레이션 진행: CFL 기반 서브스텝 */
  /** 시간 누적 후 약 22 Hz 로 적분 (렌더는 두 상태 사이를 보간) */
  advance(dtFrame) {
    if (dtFrame <= 0) return false;
    this.acc += dtFrame;
    if (this.acc < this.minStep) return false;
    const dtTotal = this.acc;
    this.acc = 0;
    this.lastStep = dtTotal;
    let t = 0, guard = 0;
    while (t < dtTotal - 1e-6 && guard++ < 10) {
      const c = Math.sqrt(G * Math.max(this.hmax, 1)) + this.umax;
      const dtMax = 0.42 * this.dx / Math.max(c, 1);
      const dt = Math.min(dtMax, dtTotal - t);
      this.step(dt);
      t += dt;
    }
    this.postStep(dtTotal);
    return true;
  }

  /** 렌더 보간 계수 (직전 상태 → 현재 상태) */
  blend() { return this.lastStep > 0 ? Math.min(1, this.acc / this.lastStep) : 1; }

  step(dt) {
    const N = this.N, N1 = N + 1, idx = 1 / this.dx;
    const h = this.h, b = this.b, u = this.u, v = this.v, un = this.un, vn = this.vn, n2a = this.n2;
    const gdt = G * dt;
    let umax = 0;

    // ── x 방향 운동량 (u 면)
    for (let j = 0; j < N; j++) {
      const row = j * N, rowU = j * N1;
      un[rowU] = 0; un[rowU + N] = 0;
      for (let i = 1; i < N; i++) {
        const k = rowU + i, cL = row + i - 1, cR = cL + 1;
        const hL = h[cL], hR = h[cR];
        if (hL < EPS && hR < EPS) { un[k] = 0; continue; }
        const bL = b[cL], bR = b[cR], eL = hL + bL, eR = hR + bR;
        if ((hL < EPS && bL > eR) || (hR < EPS && bR > eL)) { un[k] = 0; continue; }
        const bm = bL > bR ? bL : bR;
        const hf = (eL > eR ? eL : eR) - bm;
        if (hf < EPS) { un[k] = 0; continue; }
        let uu = u[k];
        let adv = 0;
        if (hf > 0.05) {
          const dudx = uu > 0 ? uu - u[k - 1] : u[k + 1] - uu;
          const va = 0.25 * (v[row + i - 1] + v[row + i] + v[row + N + i - 1] + v[row + N + i]);
          let dudz = 0;
          if (va > 0) { if (j > 0) dudz = uu - u[k - N1]; } else if (j < N - 1) dudz = u[k + N1] - uu;
          adv = (uu * dudx + va * dudz) * idx;
        }
        uu -= gdt * (eR - eL) * idx + dt * adv;
        if (hf < 25) {
          const hc = hf > 0.05 ? hf : 0.05;
          uu /= 1 + gdt * 0.5 * (n2a[cL] + n2a[cR]) * Math.abs(uu) / (hc * Math.cbrt(hc));
        }
        if (uu > VMAX) uu = VMAX; else if (uu < -VMAX) uu = -VMAX;
        un[k] = uu;
        const au = uu < 0 ? -uu : uu;
        if (au > umax) umax = au;
      }
    }
    // ── z 방향 운동량 (v 면)
    vn.fill(0, 0, N); vn.fill(0, N * N, N * N + N);
    for (let j = 1; j < N; j++) {
      const rowT = (j - 1) * N, row = j * N;
      for (let i = 0; i < N; i++) {
        const k = row + i, cT = rowT + i, cB = row + i;
        const hT = h[cT], hB = h[cB];
        if (hT < EPS && hB < EPS) { vn[k] = 0; continue; }
        const bT = b[cT], bB = b[cB], eT = hT + bT, eB = hB + bB;
        if ((hT < EPS && bT > eB) || (hB < EPS && bB > eT)) { vn[k] = 0; continue; }
        const bm = bT > bB ? bT : bB;
        const hf = (eT > eB ? eT : eB) - bm;
        if (hf < EPS) { vn[k] = 0; continue; }
        let vv = v[k];
        let adv = 0;
        if (hf > 0.05) {
          const dvdz = vv > 0 ? vv - v[k - N] : v[k + N] - vv;
          const ua = 0.25 * (u[(j - 1) * N1 + i] + u[(j - 1) * N1 + i + 1] + u[j * N1 + i] + u[j * N1 + i + 1]);
          let dvdx = 0;
          if (ua > 0) { if (i > 0) dvdx = vv - v[k - 1]; } else if (i < N - 1) dvdx = v[k + 1] - vv;
          adv = (vv * dvdz + ua * dvdx) * idx;
        }
        vv -= gdt * (eB - eT) * idx + dt * adv;
        if (hf < 25) {
          const hc = hf > 0.05 ? hf : 0.05;
          vv /= 1 + gdt * 0.5 * (n2a[cT] + n2a[cB]) * Math.abs(vv) / (hc * Math.cbrt(hc));
        }
        if (vv > VMAX) vv = VMAX; else if (vv < -VMAX) vv = -VMAX;
        vn[k] = vv;
        const av = vv < 0 ? -vv : vv;
        if (av > umax) umax = av;
      }
    }
    // 교체
    this.u = un; this.un = u; this.v = vn; this.vn = v;
    const U = this.u, V = this.v, fx = this.fx, fz = this.fz, lim = this.lim;

    // ── 플럭스 (정수압 재구성 상류 수심)
    for (let j = 0; j < N; j++) {
      const row = j * N, rowU = j * N1;
      fx[rowU] = 0; fx[rowU + N] = 0;
      for (let i = 1; i < N; i++) {
        const k = rowU + i, q = U[k];
        if (q === 0) { fx[k] = 0; continue; }
        const cL = row + i - 1, cR = cL + 1;
        const bm = b[cL] > b[cR] ? b[cL] : b[cR];
        const hu = q > 0 ? h[cL] + b[cL] - bm : h[cR] + b[cR] - bm;
        fx[k] = hu > 0 ? q * hu : 0;
      }
    }
    fz.fill(0, 0, N); fz.fill(0, N * N, N * N + N);
    for (let j = 1; j < N; j++) {
      const row = j * N, rowT = row - N;
      for (let i = 0; i < N; i++) {
        const k = row + i, q = V[k];
        if (q === 0) { fz[k] = 0; continue; }
        const cT = rowT + i, cB = row + i;
        const bm = b[cT] > b[cB] ? b[cT] : b[cB];
        const hv = q > 0 ? h[cT] + b[cT] - bm : h[cB] + b[cB] - bm;
        fz[k] = hv > 0 ? q * hv : 0;
      }
    }
    // ── 유출 제한기
    const r = dt * idx;
    for (let j = 0; j < N; j++) {
      const row = j * N, rowU = j * N1;
      for (let i = 0; i < N; i++) {
        const c = row + i;
        const hc = h[c];
        if (hc <= 0) { lim[c] = 0; continue; }
        const fl = fx[rowU + i], fr = fx[rowU + i + 1], ft = fz[row + i], fb = fz[row + N + i];
        const out = r * ((fr > 0 ? fr : 0) - (fl < 0 ? fl : 0) + (fb > 0 ? fb : 0) - (ft < 0 ? ft : 0));
        lim[c] = out > hc ? hc / out : 1;
      }
    }
    // ── 연속식
    let hmax = 0;
    for (let j = 0; j < N; j++) {
      const row = j * N, rowU = j * N1;
      for (let i = 0; i < N; i++) {
        const c = row + i;
        let fl = fx[rowU + i], fr = fx[rowU + i + 1], ft = fz[row + i], fb = fz[row + N + i];
        if (fl !== 0) fl *= fl > 0 ? lim[c - 1] : lim[c];
        if (fr !== 0) fr *= fr > 0 ? lim[c] : lim[c + 1];
        if (ft !== 0) ft *= ft > 0 ? lim[c - N] : lim[c];
        if (fb !== 0) fb *= fb > 0 ? lim[c] : lim[c + N];
        let hn = h[c] + r * (fl - fr + ft - fb);
        if (hn < 0) hn = 0;
        h[c] = hn;
        if (hn > hmax) hmax = hn;
      }
    }
    // ── 스펀지 (개방 경계 흡수)
    // 외해 강제(전 지구 모델 둥지): 경계 수위 η_B(t) 와 육지 쪽 진행파 유속 η_B·√(g/h) 로 이완
    const sc = this.spongeCells, sw = this.spongeW, b0 = this.b0;
    const kk = Math.min(1, dt * 1.2);
    const eB = this.forcing ? this.forcing(this.time) : 0, fd = this.forceDir;
    for (let n = 0; n < sc.length; n++) {
      const c = sc[n];
      if (b0[c] >= 0) continue;
      const w = sw[n] * kk;
      const eta = h[c] + b[c];
      h[c] = Math.max(0, h[c] - (eta - eB) * w);
      const i = c % N, j = (c - i) / N;
      const vB = eB !== 0 && h[c] > 1 ? eB * Math.sqrt(G / h[c]) : 0;
      U[j * N1 + i] += (vB * fd[0] - U[j * N1 + i]) * w; U[j * N1 + i + 1] += (vB * fd[0] - U[j * N1 + i + 1]) * w;
      V[j * N + i] += (vB * fd[1] - V[j * N + i]) * w; V[(j + 1) * N + i] += (vB * fd[1] - V[(j + 1) * N + i]) * w;
    }
    this.hmax = hmax;
    this.umax = umax;
    this.time += dt;
    this.steps++;
  }

  /** 프레임당 1회: 셀 유속, 거품·흙탕물 추적자, 침수 기록, 텍스처 */
  postStep(dt) {
    const N = this.N, N1 = N + 1, C = N * N, h = this.h, U = this.u, V = this.v;
    const uc = this.uc, vc = this.vc, foam = this.foam, mud = this.mud, b0 = this.b0;
    const idx = 1 / this.dx;
    const decay = Math.exp(-dt * 0.33);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const c = j * N + i;
        const ul = U[j * N1 + i], ur = U[j * N1 + i + 1], vt = V[j * N + i], vb = V[(j + 1) * N + i];
        const cu = 0.5 * (ul + ur), cv = 0.5 * (vt + vb);
        uc[c] = cu; vc[c] = cv;
        const hc = h[c];
        if (hc < 0.01) { foam[c] *= 0.85; continue; }
        const sp2 = cu * cu + cv * cv;
        let f = foam[c];
        const fr2 = sp2 / (G * hc);
        if (fr2 > 0.3025) f += dt * Math.min(3, (Math.sqrt(fr2) - 0.55) * 5);   // 프루드 수 기반 쇄파 (Fr > 0.55)
        const div = (ur - ul + vb - vt) * idx;
        if (div < -0.04 && sp2 > 0.8) f += dt * Math.min(2, -div * 6);
        if (hc < 1.2 && sp2 > 0.6) f += dt * 0.8;
        f *= decay;
        foam[c] = f < 0 ? 0 : f > 1.5 ? 1.5 : f;
        if (b0[c] > 0.2 && sp2 > 0.15) mud[c] += dt * 0.6 * (1 - mud[c]);
        else if (b0[c] < -3) mud[c] *= 1 - dt * 0.004;
        if (b0[c] > 0) {
          if (hc > this.maxH[c]) this.maxH[c] = hc;
          if (hc > 0.1 && this.arrive[c] < 0) this.arrive[c] = this.time;
          if (mud[c] * 0.85 > this.deposit[c] && hc > 0.05) this.deposit[c] = mud[c] * 0.85;
        }
      }
    }
    // 반라그랑지 이류
    const s = dt * idx, A = this.tmpA, B = this.tmpB;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const c = j * N + i;
        if (h[c] < 0.01) { A[c] = foam[c]; B[c] = mud[c]; continue; }
        let x = i - uc[c] * s, z = j - vc[c] * s;
        if (x < 0) x = 0; else if (x > N - 1.001) x = N - 1.001;
        if (z < 0) z = 0; else if (z > N - 1.001) z = N - 1.001;
        const i0 = x | 0, j0 = z | 0, tx = x - i0, tz = z - j0;
        const k0 = j0 * N + i0;
        A[c] = (foam[k0] * (1 - tx) + foam[k0 + 1] * tx) * (1 - tz) + (foam[k0 + N] * (1 - tx) + foam[k0 + N + 1] * tx) * tz;
        B[c] = (mud[k0] * (1 - tx) + mud[k0 + 1] * tx) * (1 - tz) + (mud[k0 + N] * (1 - tx) + mud[k0 + N + 1] * tx) * tz;
      }
    }
    this.foam = A; this.tmpA = foam;
    this.mud = B; this.tmpB = mud;
    // 해안 파고
    let cm = 0;
    for (const k of this.coastCells) { const e = h[k] + this.b[k]; if (e > cm) cm = e; }
    this.coastNow = cm;
    if (cm > this.coastMax) this.coastMax = cm;
    this.prepareTextures(dt);
  }

  prepareTextures(dt) {
    const sw = this.texWPrev; this.texWPrev = this.texW; this.texW = sw;   // 버퍼 교대
    const N = this.N, h = this.h, b = this.b, tw = this.texW, tf = this.texF, tl = this.texFlood;
    const foam = this.foam, mud = this.mud, wet = this.wet;
    const dry = 1 - Math.min(1, dt * 0.012);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const c = j * N + i, o = c * 4;
        const hc = h[c];
        let eta;
        if (hc > 0.02) {
          eta = hc + b[c];
          wet[c] = 1;
        } else {
          eta = -1e9;
          if (i > 0 && h[c - 1] > 0.02) eta = Math.max(eta, h[c - 1] + b[c - 1]);
          if (i < N - 1 && h[c + 1] > 0.02) eta = Math.max(eta, h[c + 1] + b[c + 1]);
          if (j > 0 && h[c - N] > 0.02) eta = Math.max(eta, h[c - N] + b[c - N]);
          if (j < N - 1 && h[c + N] > 0.02) eta = Math.max(eta, h[c + N] + b[c + N]);
          // 건조 셀: 이웃 수면을 외삽하되 자기 바닥보다 높이 띄우지 않음 (전면이 허공에 뜨지 않게)
          if (eta < -1e8) eta = this.b0[c] - 12;
          else if (eta > b[c] - 0.02) eta = b[c] - 0.02;
          wet[c] *= dry;
        }
        tw[o] = eta; tw[o + 1] = hc; tw[o + 2] = this.uc[c]; tw[o + 3] = this.vc[c];
        const f = foam[c];
        tf[o] = f > 1 ? 255 : f < 0 ? 0 : f * 255; tf[o + 1] = mud[c] * 255; tf[o + 2] = 0; tf[o + 3] = 255;
        tl[o] = wet[c] * 255;
        const m = this.maxH[c] * 25;
        tl[o + 1] = m > 255 ? 255 : m;
        tl[o + 2] = this.deposit[c] * 255;
        tl[o + 3] = 255;
      }
    }
    this.texDirty = true;
  }

  /** 거친 위협 지도 — 사람들의 인지(파도 목격·바닷물 빠짐) 계산용 */
  updateThreat() {
    const N = this.N, CN = this.CN, h = this.h, b = this.b, b0 = this.b0, uc = this.uc, vc = this.vc;
    this.threat.fill(0); this.drawdown.fill(0);
    for (let j = 0; j < N; j += 2) {
      for (let i = 0; i < N; i += 2) {
        const c = j * N + i, cc = (j >> 3) * CN + (i >> 3);
        const hc = h[c];
        let t = 0;
        if (b0[c] < -0.5) {
          const eta = hc + b[c];
          if (eta > 0.6) t = eta;
          if (b0[c] > -14 && eta < -0.6 && -eta > this.drawdown[cc]) this.drawdown[cc] = -eta;
        } else if (hc > 0.15) {
          const sp = Math.sqrt(uc[c] * uc[c] + vc[c] * vc[c]);
          t = hc * (1 + sp * 0.3);
        }
        if (t > this.threat[cc]) this.threat[cc] = t;
      }
    }
  }

  /** 렌더 수면(외삽 포함) · 수심 · 유속 쌍선형 표본 */
  sample(x, z, out) {
    const N = this.N;
    let gx = (x + HALF) / this.dx - 0.5, gz = (z + HALF) / this.dx - 0.5;
    if (gx < 0) gx = 0; else if (gx > N - 1.001) gx = N - 1.001;
    if (gz < 0) gz = 0; else if (gz > N - 1.001) gz = N - 1.001;
    const i0 = gx | 0, j0 = gz | 0, tx = gx - i0, tz = gz - j0;
    const k = j0 * N + i0;
    const w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz;
    const tw = this.texW;
    const o0 = k * 4, o1 = o0 + 4, o2 = (k + N) * 4, o3 = o2 + 4;
    out.eta = tw[o0] * w00 + tw[o1] * w10 + tw[o2] * w01 + tw[o3] * w11;
    out.h = tw[o0 + 1] * w00 + tw[o1 + 1] * w10 + tw[o2 + 1] * w01 + tw[o3 + 1] * w11;
    out.u = tw[o0 + 2] * w00 + tw[o1 + 2] * w10 + tw[o2 + 2] * w01 + tw[o3 + 2] * w11;
    out.v = tw[o0 + 3] * w00 + tw[o1 + 3] * w10 + tw[o2 + 3] * w01 + tw[o3 + 3] * w11;
    return out;
  }

  /** 쓰나미 발생원 추가 — 초기 수면 변위 (+필요 시 진행파 유속) */
  /** 외해 경계 강제: fn(simTime) → 경계 수위(m), dir = 육지 쪽 단위벡터. null 이면 해제 */
  setBoundaryForcing(fn, dir = [0, -1]) {
    this.forcing = fn;
    this.forceDir = dir;
  }

  addSource(type, x0, z0, power, landDir, opt = {}) {
    const N = this.N, dx = this.dx, h = this.h, b = this.b;
    const p = Math.max(0, Math.min(1, power));
    // 해안 방향 단위벡터 (육지 쪽) 와 해안선 방향. opt.strike(도, 북=0 시계방향)로 단층 방향 지정 가능
    let nx = landDir[0], nz = landDir[1];
    let tx = -nz, tz = nx;
    if (opt.strike !== undefined) {
      const s = opt.strike * Math.PI / 180;
      tx = Math.sin(s); tz = -Math.cos(s);
      let px = -tz, pz = tx;
      if (px * landDir[0] + pz * landDir[1] < 0) { px = -px; pz = -pz; }
      nx = px; nz = pz;
    }
    let fn;
    let info;
    if (type === 'quake') {
      // 거대지진: 해안과 나란한 긴 단층 (영역 폭에 걸친 긴 파봉 → 방사 감쇠가 작음)
      const A = opt.A ?? 3.5 + 12.5 * Math.pow(p, 1.2), R = opt.R ?? 500 + 600 * p, L = opt.L ?? 1300 + 2400 * p;
      fn = (x, z) => {
        const a = (x - x0) * tx + (z - z0) * tz;     // 주향 방향
        const c = (x - x0) * nx + (z - z0) * nz;     // 해안 쪽(+)
        const along = Math.exp(-((a / L) ** 4));
        const up = Math.exp(-(((c + 0.35 * R) / (0.55 * R)) ** 2));
        const dn = Math.exp(-(((c - 0.55 * R) / (0.5 * R)) ** 2));
        return along * (A * up - 0.5 * A * dn);
      };
      info = { A, R, L: L * 2, M: (2 / 3) * (Math.log10(3e10 * 2 * L * 1.4 * R * A / 0.35) - 9.1) };
    } else if (type === 'landslide') {
      const A = opt.A ?? 4 + 26 * p, R = opt.R ?? 80 + 150 * p;
      fn = (x, z) => {
        const c = (x - x0) * nx + (z - z0) * nz;
        const a = (x - x0) * tx + (z - z0) * tz;
        const al = Math.exp(-((a / (1.1 * R)) ** 2));
        return al * (A * 0.9 * Math.exp(-(((c + 0.6 * R) / (0.55 * R)) ** 2)) - A * Math.exp(-(((c - 0.4 * R) / (0.5 * R)) ** 2)));
      };
      info = { A, R, M: 5.5 + 1.5 * p };
    } else if (type === 'impact') {
      const Rc = opt.R ?? 60 + 200 * p, A = opt.A ?? 30 + 110 * p;
      fn = (x, z) => {
        const r = Math.hypot(x - x0, z - z0);
        let e = 0;
        if (r < Rc) e -= A * (1 - (r / Rc) ** 2);
        e += 0.38 * A * Math.exp(-(((r - 1.25 * Rc) / (0.32 * Rc)) ** 2));
        return e;
      };
      info = { A, R: Rc, M: 0 };
    } else {
      const A = 2 + 10 * p, W = 220 + 380 * p;
      fn = (x, z) => {
        const c = (x - x0) * nx + (z - z0) * nz;
        return A * Math.exp(-((c / W) ** 2));
      };
      info = { A, R: W, M: 0 };
    }
    // 수면 변위 적용 (물이 있는 셀만)
    for (let j = 0; j < N; j++) {
      const z = -HALF + (j + 0.5) * dx;
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        if (this.b0[k] > -0.5) continue;
        const x = -HALF + (i + 0.5) * dx;
        const d = fn(x, z);
        if (d > -0.01 && d < 0.01) continue;
        h[k] = Math.max(0, h[k] + d);
      }
    }
    // 원거리 해일: 육지 방향 진행파 유속 u = η·√(g/h)
    if (type === 'plane') {
      const N1 = N + 1;
      for (let j = 0; j < N; j++) for (let i = 1; i < N; i++) {
        const k = j * N + i;
        const hh = 0.5 * (h[k] + h[k - 1]);
        if (hh < 1 || this.b0[k] > -1) continue;
        const eta = fn(-HALF + i * dx, -HALF + (j + 0.5) * dx);   // 이번에 더한 변위만
        if (eta < 0.05) continue;
        this.u[j * N1 + i] += eta * Math.sqrt(G / hh) * nx;
      }
      for (let j = 1; j < N; j++) for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const hh = 0.5 * (h[k] + h[k - N]);
        if (hh < 1 || this.b0[k] > -1) continue;
        const eta = fn(-HALF + (i + 0.5) * dx, -HALF + j * dx);
        if (eta < 0.05) continue;
        this.v[k] += eta * Math.sqrt(G / hh) * nz;
      }
    }
    let hm = 0;
    for (let k = 0; k < N * N; k++) if (h[k] > hm) hm = h[k];
    this.hmax = hm;
    this.active = true;
    this.prepareTextures(0);
    this.texWPrev.set(this.texW);
    this.prevDirty = true;
    return info;
  }
}
