// 2D 비압축성 유체 (Stam 'Stable Fluids' 계열, 셀 중심 격자)
// 좌표: 월드 미터, y 위쪽. 격자 (i, j), j=0 이 바닥.

export class Fluid {
  constructor(W, H, nx, ny) {
    this.W = W; this.H = H; this.nx = nx; this.ny = ny;
    this.h = W / nx;
    const n = nx * ny;
    this.n = n;
    this.u = new Float32Array(n); this.v = new Float32Array(n);
    this.u0 = new Float32Array(n); this.v0 = new Float32Array(n);
    this.p = new Float64Array(n); this.div = new Float64Array(n);
    this.T = new Float32Array(n); this.T0 = new Float32Array(n);
    this.curl = new Float32Array(n);
    this.solid = new Uint8Array(n);
    this.heat = new Float32Array(n);            // 열원(+) / 냉원(-) 세기
    this.tu = new Float32Array(n); this.tv = new Float32Array(n); this.tw = new Float32Array(n);
    this.tuw = new Float32Array(n); this.tvw = new Float32Array(n);
    this.eu = new Float32Array(n); this.ev = new Float32Array(n);   // 제트 유입(entrainment) 방향 × 세기
    this._best = new Float32Array(n); this._le = new Float32Array(n * 2);
    this.ambU = 0; this.ambV = 0;
    this.relax = 0.6;      // 바람 붓이 유체를 목표 속도로 끌어당기는 비율 (1/s)
    this.felt = 0.93;      // 붓 띠 안에서 비행체가 느끼는 바람이 목표 속도를 따르는 정도
    this.entrain = 0.24;   // 제트가 주변 공기를 축 쪽으로 빨아들이는 비율 (실제 난류 제트 ≈ 0.1)
    this.damp = 0.5;       // 교란이 배경풍으로 돌아가는 비율 (1/s)
    this.buoy = 4.0;       // 부력 계수
    this.mix = 0.08;       // 난류 혼합(열 확산) — 열기둥이 넓게 퍼진다
    this.coolRate = 0.04;  // 온도 감쇠 (1/s) — 따뜻한 공기는 섞이기 전까지 열을 오래 지닌다
    this.vort = 0.22;      // 와도 보존 세기
    this.iters = 16;
    this.time = 0;
  }

  idx(i, j) { return i + j * this.nx; }

  // 다각형 목록으로 고체 마스크 구성 (바닥 행은 항상 벽)
  buildSolids(polys) {
    const { nx, ny, h, solid } = this;
    solid.fill(0);
    for (let j = 0; j < ny; j++) {
      const y = (j + 0.5) * h;
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * h;
        for (const pg of polys) if (pointInPoly(pg, x, y)) { solid[i + j * nx] = 1; break; }
      }
    }
    for (let i = 0; i < nx; i++) solid[i] = 1;
    this._prep();
    this.u.fill(this.ambU); this.v.fill(this.ambV);
    for (let k = 0; k < this.n; k++) if (solid[k]) { this.u[k] = 0; this.v[k] = 0; }
  }

  // 압력 풀이용 이웃 마스크(분기 없는 반복을 위해 미리 계산)
  _prep() {
    const { nx, ny, solid, n } = this;
    const list = [];
    this.mL = new Float64Array(n); this.mR = new Float64Array(n);
    this.mB = new Float64Array(n); this.mT = new Float64Array(n);
    this.invC = new Float64Array(n);
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const k = i + j * nx;
      if (solid[k]) continue;
      const l = solid[k - 1] ? 0 : 1, r = solid[k + 1] ? 0 : 1, b = solid[k - nx] ? 0 : 1, t = solid[k + nx] ? 0 : 1;
      const c = l + r + b + t;
      if (!c) continue;
      this.mL[k] = l; this.mR[k] = r; this.mB[k] = b; this.mT[k] = t; this.invC[k] = 1 / c;
      list.push(k);
    }
    this.cells = Int32Array.from(list);
  }

  // 지표면 위 열원 배치: 각 열에서 x 범위 안의 첫 공기 셀 2칸
  addHeat(x, w, power) {
    const { nx, ny, h, solid, heat } = this;
    const i0 = Math.max(1, Math.floor((x - w / 2) / h)), i1 = Math.min(nx - 2, Math.ceil((x + w / 2) / h));
    for (let i = i0; i <= i1; i++) {
      const t = (i + 0.5) * h - x;
      const fall = Math.exp(-(t * t) / (2 * (w * 0.32) ** 2));
      let j = 1;
      while (j < ny - 1 && solid[i + j * nx]) j++;
      for (let d = 0; d < 3 && j + d < ny - 1; d++) heat[i + (j + d) * nx] += power * fall;
    }
  }

  clearHeat() { this.heat.fill(0); this.T.fill(0); }

  // 바람 붓 획 → 목표 속도장. 획 시작부는 서서히 세지고(진입 충격 완화), 띠 주변 공기는 축 쪽으로 유입된다.
  setStrokes(strokes, radius = 7) {
    const { nx, ny, h, tu, tv, tw, eu, ev } = this;
    tu.fill(0); tv.fill(0); tw.fill(0); eu.fill(0); ev.fill(0);
    const best = this._best, le = this._le;
    for (const s of strokes) {
      const pts = s.pts, speed = s.speed;
      let total = 0;
      for (let a = 0; a + 1 < pts.length; a++) total += Math.hypot(pts[a + 1][0] - pts[a][0], pts[a + 1][1] - pts[a][1]);
      const ramp = Math.max(1, Math.min(24, total * 0.35));
      best.fill(1e9);
      let along = 0;
      for (let a = 0; a + 1 < pts.length; a++) {
        const ax = pts[a][0], ay = pts[a][1], bx = pts[a + 1][0], by = pts[a + 1][1];
        const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
        if (L < 1e-6) continue;
        const ux = dx / L, uy = dy / L;
        const i0 = Math.max(1, Math.floor((Math.min(ax, bx) - radius) / h)), i1 = Math.min(nx - 2, Math.ceil((Math.max(ax, bx) + radius) / h));
        const j0 = Math.max(1, Math.floor((Math.min(ay, by) - radius) / h)), j1 = Math.min(ny - 2, Math.ceil((Math.max(ay, by) + radius) / h));
        for (let j = j0; j <= j1; j++) {
          const cy = (j + 0.5) * h;
          for (let i = i0; i <= i1; i++) {
            const cx = (i + 0.5) * h;
            let t = ((cx - ax) * ux + (cy - ay) * uy);
            t = t < 0 ? 0 : t > L ? L : t;
            const qx = ax + ux * t - cx, qy = ay + uy * t - cy;
            const d = Math.hypot(qx, qy);
            if (d >= radius) continue;
            const q = Math.min(1, (radius - d) / (radius * 0.55));
            const r = Math.min(1, (along + t) / ramp);
            const w = q * q * (3 - 2 * q) * (0.15 + 0.85 * r * r * (3 - 2 * r));
            const k = i + j * nx;
            tu[k] += ux * speed * w; tv[k] += uy * speed * w; tw[k] += w;
            // 같은 획 안에서는 가장 가까운 축 지점 쪽으로만 유입
            if (d < best[k] && d > 1e-3) {
              const e = Math.sin((Math.PI * d) / radius) * speed * w / d;
              if (best[k] < 1e9) { eu[k] -= le[k * 2]; ev[k] -= le[k * 2 + 1]; }
              const ex = qx * e, ey = qy * e;
              eu[k] += ex; ev[k] += ey;
              le[k * 2] = ex; le[k * 2 + 1] = ey;
              best[k] = d;
            }
          }
        }
        along += L;
      }
    }
    for (let k = 0; k < this.n; k++) {
      const w = tw[k];
      if (w > 0) { tu[k] /= w; tv[k] /= w; tw[k] = Math.min(1, w); }
      this.tuw[k] = tu[k] * tw[k]; this.tvw[k] = tv[k] * tw[k];
    }
  }

  step(dt) {
    this.time += dt;
    this._forces(dt);
    this._bounds();
    this._project(4);
    this.u0.set(this.u); this.v0.set(this.v); this.T0.set(this.T);
    this._advect(this.u, this.u0, dt);
    this._advect(this.v, this.v0, dt);
    this._advect(this.T, this.T0, dt);
    this._bounds();
    this._project(this.iters);
    this._bounds();
  }

  _forces(dt) {
    const { n, u, v, T, heat, tu, tv, tw, solid, ambU, ambV } = this;
    const kd = 1 - Math.exp(-this.damp * dt);
    const kr = this.relax * dt;
    const cool = Math.exp(-this.coolRate * dt);
    const by = this.buoy * dt;
    const hk_r = 1 - Math.exp(-3 * dt);
    for (let k = 0; k < n; k++) {
      if (solid[k]) continue;
      let uu = u[k], vv = v[k];
      uu += (ambU - uu) * kd; vv += (ambV - vv) * kd;
      const w = tw[k];
      if (w > 0) {
        const r = 1 - Math.exp(-kr * w);
        uu += (tu[k] - uu) * r; vv += (tv[k] - vv) * r;
      }
      let t = T[k] * cool;
      const hk = heat[k];
      if (hk !== 0) t += (hk - t) * hk_r;
      if (t > 8) t = 8; else if (t < -8) t = -8;
      T[k] = t;
      vv += by * t;
      u[k] = uu; v[k] = vv;
    }
    if (this.mix > 0) this._mixHeat();
    if (this.vort > 0) this._vorticity(dt);
  }

  _mixHeat() {
    const { nx, ny, T, T0, solid } = this;
    const m = this.mix;
    T0.set(T);
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const k = i + j * nx;
      if (solid[k]) continue;
      const c = T0[k];
      const l = solid[k - 1] ? c : T0[k - 1], r = solid[k + 1] ? c : T0[k + 1];
      const b = solid[k - nx] ? c : T0[k - nx], t = solid[k + nx] ? c : T0[k + nx];
      T[k] = c + m * (l + r + b + t - 4 * c);
    }
  }

  _vorticity(dt) {
    const { nx, ny, h, u, v, curl, solid } = this;
    const inv2h = 0.5 / h;
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const k = i + j * nx;
      curl[k] = solid[k] ? 0 : (v[k + 1] - v[k - 1] - u[k + nx] + u[k - nx]) * inv2h;
    }
    const e = this.vort * h * dt;
    for (let j = 2; j < ny - 2; j++) for (let i = 2; i < nx - 2; i++) {
      const k = i + j * nx;
      if (solid[k]) continue;
      const gx = (Math.abs(curl[k + 1]) - Math.abs(curl[k - 1])) * inv2h;
      const gy = (Math.abs(curl[k + nx]) - Math.abs(curl[k - nx])) * inv2h;
      const len = Math.hypot(gx, gy) + 1e-5;
      const w = curl[k];
      u[k] += e * (gy / len) * w;
      v[k] -= e * (gx / len) * w;
    }
  }

  _advect(d, d0, dt) {
    const { nx, ny, h, u0, v0, solid } = this;
    const s = dt / h;
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const k = i + j * nx;
      if (solid[k]) { d[k] = 0; continue; }
      d[k] = sampleGrid(d0, nx, ny, i - s * u0[k], j - s * v0[k]);
    }
  }

  _bounds() {
    const { nx, ny, u, v, T, solid, ambU, ambV } = this;
    for (let j = 1; j < ny; j++) {
      const kl = j * nx, kr = nx - 1 + j * nx;
      if (ambU > 0.01) { u[kl] = ambU; v[kl] = ambV; } else { u[kl] = u[kl + 1]; v[kl] = v[kl + 1]; }
      if (ambU < -0.01) { u[kr] = ambU; v[kr] = ambV; } else { u[kr] = u[kr - 1]; v[kr] = v[kr - 1]; }
      T[kl] = 0; T[kr] = 0;
    }
    const top = (ny - 1) * nx;
    for (let i = 0; i < nx; i++) { u[top + i] = u[top + i - nx]; v[top + i] = Math.max(0, v[top + i - nx]); T[top + i] = 0; }
    for (let k = 0; k < this.n; k++) if (solid[k]) { u[k] = 0; v[k] = 0; }
  }

  _project(iters) {
    const { nx, ny, h, u, v, p, div, solid } = this;
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const k = i + j * nx;
      if (solid[k]) { div[k] = 0; p[k] = 0; continue; }
      div[k] = -0.5 * h * (u[k + 1] - u[k - 1] + v[k + nx] - v[k - nx]);
    }
    const om = 1.7, cells = this.cells, mL = this.mL, mR = this.mR, mB = this.mB, mT = this.mT, invC = this.invC, m = cells.length;
    for (let it = 0; it < iters; it++) {
      for (let q = 0; q < m; q++) {
        const k = cells[q];
        p[k] += om * ((div[k] + mL[k] * p[k - 1] + mR[k] * p[k + 1] + mB[k] * p[k - nx] + mT[k] * p[k + nx]) * invC[k] - p[k]);
      }
    }
    const g = 0.5 / h;
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const k = i + j * nx;
      if (solid[k]) continue;
      const pc = p[k];
      const pl = solid[k - 1] ? pc : p[k - 1], pr = solid[k + 1] ? pc : p[k + 1];
      const pb = solid[k - nx] ? pc : p[k - nx], pt = solid[k + nx] ? pc : p[k + nx];
      u[k] -= g * (pr - pl);
      v[k] -= g * (pt - pb);
    }
  }

  // 월드 좌표에서 바람 속도 (쌍선형 보간)
  sample(x, y, out) {
    const gx = x / this.h - 0.5, gy = y / this.h - 0.5;
    out[0] = sampleGrid(this.u, this.nx, this.ny, gx, gy);
    out[1] = sampleGrid(this.v, this.nx, this.ny, gx, gy);
    return out;
  }

  // 비행체가 느끼는 바람: 유체 + 붓 띠 안에서는 그린 방향·세기로 끌어당김
  sampleFelt(x, y, out) {
    const { nx, ny } = this;
    const gx = x / this.h - 0.5, gy = y / this.h - 0.5;
    const u = sampleGrid(this.u, nx, ny, gx, gy), v = sampleGrid(this.v, nx, ny, gx, gy);
    const w = sampleGrid(this.tw, nx, ny, gx, gy);
    if (w <= 0) { out[0] = u; out[1] = v; return out; }
    const k = this.felt;
    const e = this.entrain;
    out[0] = u + k * (sampleGrid(this.tuw, nx, ny, gx, gy) - w * u) + e * sampleGrid(this.eu, nx, ny, gx, gy);
    out[1] = v + k * (sampleGrid(this.tvw, nx, ny, gx, gy) - w * v) + e * sampleGrid(this.ev, nx, ny, gx, gy);
    return out;
  }

  sampleT(x, y) { return sampleGrid(this.T, this.nx, this.ny, x / this.h - 0.5, y / this.h - 0.5); }

  isSolidAt(x, y) {
    const i = Math.floor(x / this.h), j = Math.floor(y / this.h);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return false;
    return this.solid[i + j * this.nx] === 1;
  }
}

export function sampleGrid(a, nx, ny, x, y) {
  if (x < 0) x = 0; else if (x > nx - 1.001) x = nx - 1.001;
  if (y < 0) y = 0; else if (y > ny - 1.001) y = ny - 1.001;
  const i = x | 0, j = y | 0, fx = x - i, fy = y - j, k = i + j * nx;
  return (a[k] * (1 - fx) + a[k + 1] * fx) * (1 - fy) + (a[k + nx] * (1 - fx) + a[k + nx + 1] * fx) * fy;
}

export function pointInPoly(pg, x, y) {
  let inside = false;
  for (let i = 0, j = pg.length - 1; i < pg.length; j = i++) {
    const xi = pg[i][0], yi = pg[i][1], xj = pg[j][0], yj = pg[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
