// FREE FREELY 우주 탐사 - 절차적 행성 지형 함수 (메인 스레드 · 워커 공용)
// 3D 심플렉스 노이즈(도함수 포함) + fBm · 릿지 멀티프랙탈 · 도메인 워핑 · 침식 근사 · 크레이터.
// 높이는 미터 단위, 기준면(해수면) = 행성 반지름. 옥타브는 요청한 최소 파장까지만 계산(LOD).

/* ------------------------------------------------------------------ */
/* 심플렉스 노이즈 3D (값 + 기울기)                                     */
/* ------------------------------------------------------------------ */
const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);
const F3 = 1 / 3, G3 = 1 / 6;

export class Simplex {
  constructor(seed = 1) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = (seed * 2654435761) >>> 0 || 1;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { this.perm[i] = p[i & 255]; this.permMod12[i] = this.perm[i] % 12; }
    this.d = new Float64Array(3); // 마지막 호출의 기울기
  }

  /** 값만 (-1..1) */
  noise(x, y, z) {
    const perm = this.perm, pm = this.permMod12;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0, tt, g;
    tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (tt > 0) { g = pm[ii + perm[jj + perm[kk]]] * 3; tt *= tt; n += tt * tt * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0); }
    tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (tt > 0) { g = pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; tt *= tt; n += tt * tt * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1); }
    tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (tt > 0) { g = pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; tt *= tt; n += tt * tt * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2); }
    tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (tt > 0) { g = pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; tt *= tt; n += tt * tt * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3); }
    return 32 * n;
  }

  /** 값 + 기울기 (this.d) */
  noiseD(x, y, z) {
    const perm = this.perm, pm = this.permMod12, d = this.d;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0, dx = 0, dy = 0, dz = 0, tt, g, gx, gy, gz, gd, t2, t4, k8, cx, cy, cz;
    cx = x0; cy = y0; cz = z0;
    tt = 0.6 - cx * cx - cy * cy - cz * cz;
    if (tt > 0) {
      g = pm[ii + perm[jj + perm[kk]]] * 3; gx = GRAD3[g]; gy = GRAD3[g + 1]; gz = GRAD3[g + 2];
      gd = gx * cx + gy * cy + gz * cz; t2 = tt * tt; t4 = t2 * t2; n += t4 * gd; k8 = -8 * t2 * tt * gd;
      dx += k8 * cx + t4 * gx; dy += k8 * cy + t4 * gy; dz += k8 * cz + t4 * gz;
    }
    cx = x0 - i1 + G3; cy = y0 - j1 + G3; cz = z0 - k1 + G3;
    tt = 0.6 - cx * cx - cy * cy - cz * cz;
    if (tt > 0) {
      g = pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; gx = GRAD3[g]; gy = GRAD3[g + 1]; gz = GRAD3[g + 2];
      gd = gx * cx + gy * cy + gz * cz; t2 = tt * tt; t4 = t2 * t2; n += t4 * gd; k8 = -8 * t2 * tt * gd;
      dx += k8 * cx + t4 * gx; dy += k8 * cy + t4 * gy; dz += k8 * cz + t4 * gz;
    }
    cx = x0 - i2 + 2 * G3; cy = y0 - j2 + 2 * G3; cz = z0 - k2 + 2 * G3;
    tt = 0.6 - cx * cx - cy * cy - cz * cz;
    if (tt > 0) {
      g = pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; gx = GRAD3[g]; gy = GRAD3[g + 1]; gz = GRAD3[g + 2];
      gd = gx * cx + gy * cy + gz * cz; t2 = tt * tt; t4 = t2 * t2; n += t4 * gd; k8 = -8 * t2 * tt * gd;
      dx += k8 * cx + t4 * gx; dy += k8 * cy + t4 * gy; dz += k8 * cz + t4 * gz;
    }
    cx = x0 - 1 + 3 * G3; cy = y0 - 1 + 3 * G3; cz = z0 - 1 + 3 * G3;
    tt = 0.6 - cx * cx - cy * cy - cz * cz;
    if (tt > 0) {
      g = pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; gx = GRAD3[g]; gy = GRAD3[g + 1]; gz = GRAD3[g + 2];
      gd = gx * cx + gy * cy + gz * cz; t2 = tt * tt; t4 = t2 * t2; n += t4 * gd; k8 = -8 * t2 * tt * gd;
      dx += k8 * cx + t4 * gx; dy += k8 * cy + t4 * gy; dz += k8 * cz + t4 * gz;
    }
    d[0] = 32 * dx; d[1] = 32 * dy; d[2] = 32 * dz;
    return 32 * n;
  }
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function hash3(x, y, z, s) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ */
/* 행성 지형                                                           */
/* ------------------------------------------------------------------ */
export class PlanetTerrain {
  /**
   * @param cfg { seed, kind, mountain, ocean, oceanDepth, craters, lava, volcano, canyon, crevasse, frost, alien, roundish }
   * @param R 행성 반지름(m)
   */
  constructor(cfg, R) {
    this.cfg = cfg;
    this.R = R;
    this.kind = cfg.kind;
    this.n = new Simplex(cfg.seed || 1);
    this.n2 = new Simplex((cfg.seed || 1) * 7 + 3);
    this.out = { moist: 0, extra: 0 };   // 마지막 호출의 부가 정보
    this.hasOcean = !!cfg.ocean || (cfg.lava || 0) > 0.2;
    this.seaFluid = cfg.lava > 0.2 ? 'lava' : (cfg.liquid || 'water');
    this.maxH = (cfg.mountain || 5000) * (cfg.volcano ? 3 : 1.6);
    this.minH = -(cfg.oceanDepth || cfg.mountain || 4000) * 1.4;
    if (cfg.volcano) {
      const v = cfg.volcano.dir; const l = Math.hypot(v[0], v[1], v[2]);
      this.volc = [v[0] / l, v[1] / l, v[2] / l];
    }
  }

  /** 파장(m) → 노이즈 주파수 (반지름 단위) */
  freq(wavelength) { return this.R / wavelength; }

  /** 옥타브 수 계산: 기본 파장 w0 에서 최소 파장 minW 까지, 마지막 옥타브 가중치 반환 */
  _oct(w0, minW, maxOct = 24) {
    if (w0 <= minW) return [0, 0];
    const n = Math.log2(w0 / minW);
    const full = Math.min(maxOct, Math.floor(n));
    return [full, Math.min(1, n - full)];
  }

  /** fBm (도함수 감쇠 = 침식 근사). 반환 -1..1 정도 */
  _fbm(x, y, z, w0, minW, gain, erosion, maxOct = 20) {
    const [full, frac] = this._oct(w0, minW, maxOct);
    let f = this.R / w0, a = 1, sum = 0, norm = 0, dx = 0, dy = 0, dz = 0;
    const N = this.n;
    for (let i = 0; i <= full; i++) {
      const wgt = i < full ? 1 : frac;
      if (wgt <= 0) break;
      const v = N.noiseD(x * f + i * 17.3, y * f - i * 9.1, z * f + i * 3.7);
      dx += N.d[0] * a; dy += N.d[1] * a; dz += N.d[2] * a;
      const damp = erosion ? 1 / (1 + erosion * (dx * dx + dy * dy + dz * dz)) : 1;
      sum += v * a * damp * wgt;
      norm += a;
      a *= gain; f *= 2.03;
    }
    return norm > 0 ? sum : 0;
  }

  /** 릿지 멀티프랙탈 — 날카로운 산등성이. 반환 0..~1.6 */
  _ridge(x, y, z, w0, minW, maxOct = 22) {
    const [full, frac] = this._oct(w0, minW, maxOct);
    let f = this.R / w0, a = 0.5, sum = 0, prev = 1;
    const N = this.n2;
    for (let i = 0; i <= full; i++) {
      const wgt = i < full ? 1 : frac;
      if (wgt <= 0) break;
      let v = 1 - Math.abs(N.noise(x * f + i * 5.1, y * f + i * 11.7, z * f - i * 2.3));
      v *= v;
      sum += v * a * prev * wgt;
      prev = clamp(v * 1.6, 0, 1);
      a *= i < 3 ? 0.52 : 0.46; f *= 2.07;
    }
    return sum;
  }

  /** 다중 스케일 크레이터. 반환 높이(m) */
  _craters(x, y, z, minW, density, maxR) {
    let h = 0;
    let size = maxR;
    let extra = 0;
    for (let o = 0; o < 9 && size > minW * 3; o++) {
      const f = this.R / size;
      const qx = x * f, qy = y * f, qz = z * f;
      const cx = Math.floor(qx), cy = Math.floor(qy), cz = Math.floor(qz);
      const r0 = hash3(cx, cy, cz, o + 1);
      if (r0 < density * (0.35 + o * 0.06)) {
        const px = cx + 0.3 + 0.4 * hash3(cx, cy, cz, o + 11);
        const py = cy + 0.3 + 0.4 * hash3(cx, cy, cz, o + 21);
        const pz = cz + 0.3 + 0.4 * hash3(cx, cy, cz, o + 31);
        const rad = 0.12 + 0.17 * hash3(cx, cy, cz, o + 41);
        const dx = qx - px, dy = qy - py, dz = qz - pz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / rad;
        if (d < 1.6) {
          const D = 2 * size * rad;
          const depth = D < 10000 ? D * 0.2 : 2000 * Math.pow(D / 10000, 0.3);
          let c;
          if (d < 1) c = (d * d - 1) * depth + Math.max(0, 1 - d * 3.2) * depth * 0.18 * (rad > 0.2 ? 1 : 0); // 중앙봉
          else c = 0;
          const rim = Math.exp(-Math.pow((d - 1) * 4.2, 2)) * depth * 0.32;
          h += c + rim;
          if (d < 1.4) extra = Math.max(extra, (1.4 - d) * 0.7);
        }
      }
      size *= 0.42;
    }
    this.out.extra = Math.max(this.out.extra, extra);
    return h;
  }

  /**
   * 단위 방향 (x,y,z) 의 지형 높이(m).
   * @param minW 최소 표현 파장(m) — LOD 에 맞춰 옥타브를 자른다
   */
  height(x, y, z, minW = 1) {
    const c = this.cfg;
    const out = this.out;
    out.extra = 0;
    switch (this.kind) {
      case 'terran': return this._terran(x, y, z, minW, c);
      case 'mars': return this._mars(x, y, z, minW, c);
      case 'hot': case 'lava': case 'io': return this._hot(x, y, z, minW, c);
      case 'ice': case 'titan': return this._ice(x, y, z, minW, c);
      case 'moon': return this._moon(x, y, z, minW, c);
      case 'asteroid': return this._asteroid(x, y, z, minW, c);
      default: return this._moon(x, y, z, minW, c);
    }
  }

  _warp(x, y, z, amt, w) {
    const f = this.R / w;
    const N = this.n;
    const wx = N.noise(x * f + 31.4, y * f, z * f);
    const wy = N.noise(x * f, y * f + 47.2, z * f);
    const wz = N.noise(x * f, y * f, z * f + 12.9);
    return [x + wx * amt, y + wy * amt, z + wz * amt];
  }

  _terran(x, y, z, minW, c) {
    const R = this.R;
    const [wx, wy, wz] = this._warp(x, y, z, 0.22, R * 0.9);
    // 대륙
    let cont = this._fbm(wx, wy, wz, R * 1.3, Math.max(minW, R * 0.004), 0.5, 0, 9) - 0.16;
    const mtn = c.mountain || 8000;
    const land = smooth(-0.02, 0.06, cont);
    // 산맥 분포 (대륙 가장자리·내부 띠)
    const belt = this.n.noise(wx * 2.4 + 5, wy * 2.4, wz * 2.4 - 3);
    const mask = smooth(0.05, 0.45, belt + cont * 0.6) * smooth(0.0, 0.12, cont);
    let h;
    if (cont > 0) {
      h = 40 + cont * 1400 * (0.4 + 0.6 * smooth(0.0, 0.5, cont));
    } else {
      // 대륙붕 → 대륙사면 → 심해평원
      const shelf = smooth(-0.07, 0.0, cont);
      h = -60 - (1 - shelf) * (c.oceanDepth * 0.42) + cont * 2200;
      // 해구 (대륙 가장자리 깊은 골)
      const tr = 1 - Math.abs(this.n2.noise(wx * 5.5, wy * 5.5, wz * 5.5));
      const tmask = smooth(-0.38, -0.2, cont) * (1 - smooth(-0.12, -0.04, cont));
      h -= Math.pow(tr, 10) * tmask * c.oceanDepth * 0.5;
    }
    // 날카로운 산맥 (릿지 멀티프랙탈)
    if (mask > 0.001) {
      const r = this._ridge(wx, wy, wz, R * 0.06, minW, 20);
      h += mask * r * mtn * 0.85;
    }
    // 고원
    const plat = smooth(0.25, 0.4, this.n.noise(wx * 3.1 - 7, wy * 3.1, wz * 3.1 + 2)) * land;
    h += plat * 900;
    // 언덕·세부 (침식 근사 fBm)
    const hills = this._fbm(x, y, z, R * 0.012, minW, 0.48, 0.6, 22);
    h += hills * (90 + 600 * mask + 140 * land) * (cont > -0.02 ? 1 : 0.5);
    // 해변 평탄화
    if (h > -6 && h < 25) h = h * 0.5 + 6 * Math.sign(h) * 0.5;
    this.out.moist = clamp(0.5 + 0.5 * this.n.noise(x * 2.8 + 9, y * 2.8, z * 2.8 - 4) - mask * 0.2, 0, 1);
    return h;
  }

  _mars(x, y, z, minW, c) {
    const R = this.R;
    const [wx, wy, wz] = this._warp(x, y, z, 0.18, R * 0.8);
    // 남북 이분법 (북반구 저지대)
    const dich = smooth(-0.15, 0.35, wy + this.n.noise(wx * 1.4, wy * 1.4, wz * 1.4) * 0.3);
    let h = (1 - dich) * 2500 - dich * 3500;
    h += this._fbm(wx, wy, wz, R * 0.5, Math.max(minW, R * 0.002), 0.5, 0.3, 8) * 1800;
    // 크레이터
    h += this._craters(x, y, z, minW, c.craters || 0.5, R * 0.12);
    // 협곡 (적도 부근 거대 균열)
    if (c.canyon) {
      const lat = Math.asin(clamp(y, -1, 1));
      const band = Math.exp(-Math.pow((lat + 0.12 + this.n.noise(x * 3, 0, z * 3) * 0.05) / 0.06, 2));
      const lon = Math.atan2(z, x);
      const span = smooth(-1.6, -0.9, lon) * (1 - smooth(-0.1, 0.4, lon));
      const cut = Math.pow(1 - Math.abs(this.n2.noise(x * 9, y * 9, z * 9)), 6);
      h -= band * span * (5000 + cut * 2500);
    }
    // 거대 화산 (올림푸스형)
    if (this.volc) {
      const v = this.volc;
      const ang = Math.acos(clamp(x * v[0] + y * v[1] + z * v[2], -1, 1)) / c.volcano.radius;
      if (ang < 1.6) {
        let dome = Math.pow(Math.max(0, 1 - ang), 1.6) * c.volcano.height;
        if (ang < 0.12) dome -= (0.12 - ang) / 0.12 * 2800;      // 칼데라
        if (ang > 0.9 && ang < 1.05) dome += 1600 * Math.sin((ang - 0.9) / 0.15 * Math.PI); // 외곽 절벽
        h += dome;
      }
    }
    // 산·바위 지대 세부
    h += this._ridge(wx, wy, wz, R * 0.03, minW, 20) * (c.mountain || 6000) * 0.35 * smooth(0, 0.4, this.n.noise(wx * 2, wy * 2 + 4, wz * 2));
    // 사구 (작은 스케일 릿지)
    if (minW < 120) {
      const dune = 1 - Math.abs(this.n.noise(x * R / 180 + this.n.noise(x * R / 900, y * R / 900, z * R / 900) * 2, y * R / 180, z * R / 260));
      h += dune * dune * 9 * dich;
    }
    h += this._fbm(x, y, z, R * 0.004, minW, 0.5, 0.5, 18) * 140;
    // 극관
    this.out.moist = smooth(0.82, 0.9, Math.abs(y) + this.n.noise(x * 6, y * 6, z * 6) * 0.03);
    return h;
  }

  _hot(x, y, z, minW, c) {
    const R = this.R;
    const [wx, wy, wz] = this._warp(x, y, z, 0.25, R * 0.7);
    let h = this._fbm(wx, wy, wz, R * 0.6, Math.max(minW, R * 0.002), 0.5, 0.2, 8) * 2200;
    // 화산 돔 · 리프트
    const domes = this.n2.noise(wx * 6, wy * 6, wz * 6);
    h += smooth(0.45, 0.85, domes) * 3200;
    const rift = Math.pow(1 - Math.abs(this.n.noise(wx * 4, wy * 4, wz * 4)), 8);
    h -= rift * 1600;
    h += this._ridge(wx, wy, wz, R * 0.04, minW, 20) * (c.mountain || 5000) * 0.5 * smooth(-0.1, 0.5, this.n.noise(wx * 2.2, wy * 2.2, wz * 2.2));
    h += this._fbm(x, y, z, R * 0.006, minW, 0.5, 0.6, 20) * 220;
    if (c.craters) h += this._craters(x, y, z, minW, c.craters, R * 0.05);
    // 용암 균열 강도 (렌더링 발광용)
    const crack = Math.pow(1 - Math.abs(this.n2.noise(x * R / 14000, y * R / 14000, z * R / 14000)), 14);
    this.out.extra = crack * (0.4 + (c.lava || 0) * 2);
    if (this.kind === 'lava') {
      // 용암 바다: 해수면 아래는 용암 평원
      h += 600;
    }
    if (this.kind === 'io') {
      this.out.extra += smooth(0.6, 0.8, this.n.noise(x * 18, y * 18, z * 18)) * 0.8;
    }
    this.out.moist = clamp(0.5 + 0.5 * this.n.noise(x * 3, y * 3, z * 3), 0, 1);
    return h;
  }

  _ice(x, y, z, minW, c) {
    const R = this.R;
    const [wx, wy, wz] = this._warp(x, y, z, 0.2, R * 0.8);
    let h = this._fbm(wx, wy, wz, R * 0.7, Math.max(minW, R * 0.002), 0.5, 0.2, 8) * 1200;
    // 얼음 절벽 (계단형)
    const plate = this.n.noise(wx * 3.5, wy * 3.5, wz * 3.5);
    const step = 420;
    const terr = Math.floor((plate * 1800) / step) * step;
    h += terr * 0.7 + (plate * 1800 - terr) * 0.15;
    // 산맥
    h += this._ridge(wx, wy, wz, R * 0.05, minW, 20) * (c.mountain || 3000) * 0.55 * smooth(0.0, 0.5, this.n2.noise(wx * 2, wy * 2, wz * 2));
    // 크레바스 (가는 깊은 골)
    if (c.crevasse) {
      const cv = 1 - Math.abs(this.n2.noise(x * R / 3800 + plate * 2, y * R / 3800, z * R / 3800));
      const cut = Math.pow(cv, 18);
      h -= cut * 260;
      // 미세 크레바스
      if (minW < 60) {
        const cv2 = 1 - Math.abs(this.n.noise(x * R / 240, y * R / 240 + plate, z * R / 240));
        h -= Math.pow(cv2, 22) * 30;
      }
      this.out.extra = Math.max(this.out.extra, cut);
    }
    if (c.craters) h += this._craters(x, y, z, minW, c.craters, R * 0.06);
    h += this._fbm(x, y, z, R * 0.005, minW, 0.5, 0.5, 20) * 120;
    if (this.kind === 'titan') {
      // 사구 + 메탄 호수 분지 (극지방 저지대)
      h -= smooth(0.55, 0.85, Math.abs(y)) * 900;
      h += 140;
    }
    this.out.moist = clamp((c.frost || 0) * (0.5 + 0.5 * this.n.noise(x * 5, y * 5, z * 5)), 0, 1);
    return h;
  }

  _moon(x, y, z, minW, c) {
    const R = this.R;
    // 바다(마리아): 큰 저지대 현무암 평원
    const mare = smooth(0.15, 0.35, this.n.noise(x * 1.6 + 3, y * 1.6, z * 1.6));
    let h = -mare * 2200 + (1 - mare) * this._fbm(x, y, z, R * 0.4, Math.max(minW, R * 0.003), 0.5, 0.2, 8) * 2400;
    h += this._craters(x, y, z, minW, c.craters || 1, R * 0.16) * (1 - mare * 0.6);
    h += this._ridge(x, y, z, R * 0.05, minW, 18) * (c.mountain || 4000) * 0.3 * (1 - mare);
    h += this._fbm(x, y, z, R * 0.004, minW, 0.5, 0.4, 20) * 80;
    // 표면 미세 요철 (레골리스)
    this.out.moist = mare;
    return h;
  }

  _asteroid(x, y, z, minW, c) {
    const R = this.R;
    // 비구형 덩어리 형태
    const blob = this._fbm(x, y, z, R * (c.roundish ? 1.2 : 0.9), Math.max(minW, R * 0.02), 0.5, 0, 4);
    let h = blob * (c.roundish ? R * 0.025 : R * 0.28);
    h += this._craters(x, y, z, minW, 1, R * 0.35);
    h += this._fbm(x, y, z, R * 0.05, minW, 0.5, 0.4, 16) * R * 0.012;
    this.out.moist = 0;
    return h;
  }
}

/* ------------------------------------------------------------------ */
/* 큐브-스피어 타일 생성                                                 */
/* ------------------------------------------------------------------ */
export const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

/** 면 좌표(-1..1) → 단위 구 방향 (탄젠트 보정으로 면적 균일화) */
export function cubeToSphere(face, s, t, out) {
  const F = FACES[face];
  const a = Math.tan(s * Math.PI * 0.25), b = Math.tan(t * Math.PI * 0.25);
  const x = F.n[0] + a * F.u[0] + b * F.v[0];
  const y = F.n[1] + a * F.u[1] + b * F.v[1];
  const z = F.n[2] + a * F.u[2] + b * F.v[2];
  const l = 1 / Math.sqrt(x * x + y * y + z * z);
  out[0] = x * l; out[1] = y * l; out[2] = z * l;
  return out;
}

/** 타일 한 변의 대략적 길이(m) */
export function tileSize(R, level) { return (Math.PI * 0.5 * R) / Math.pow(2, level); }

/**
 * 타일 정점 데이터 생성.
 * 반환: { pos, nrm, morph, aux, ocean, center, minH, maxH }  (모두 Float32Array, 위치는 타일 중심 기준)
 */
export function buildTile(terrain, face, level, ix, iy, N, exag = 1) {
  const R = terrain.R;
  const scale = 1 / Math.pow(2, level);
  const s0 = ix * scale * 2 - 1, t0 = iy * scale * 2 - 1, ds = (scale * 2) / N;
  const spacing = tileSize(R, level) / N;
  const minW = Math.max(0.6, spacing * 2.0);
  const minWc = minW * 2;
  const G = N + 3;                       // 경계 1칸씩 확장 (노멀 계산)
  const H = new Float64Array(G * G);
  const Hc = new Float64Array(G * G);
  const DX = new Float64Array(G * G * 3);
  const moist = new Float32Array(G * G);
  const extra = new Float32Array(G * G);
  const d = [0, 0, 0];
  let minH = Infinity, maxH = -Infinity;
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const k = j * G + i;
      cubeToSphere(face, s0 + (i - 1) * ds, t0 + (j - 1) * ds, d);
      DX[k * 3] = d[0]; DX[k * 3 + 1] = d[1]; DX[k * 3 + 2] = d[2];
      const h = terrain.height(d[0], d[1], d[2], minW) * exag;
      H[k] = h;
      moist[k] = terrain.out.moist;
      extra[k] = terrain.out.extra;
      const ii = i - 1, jj = j - 1;
      if (ii >= 0 && jj >= 0 && ii <= N && jj <= N) {
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
        // 부모 해상도 높이 (짝수 정점만 계산, 홀수는 보간)
        if ((ii & 1) === 0 && (jj & 1) === 0) Hc[k] = terrain.height(d[0], d[1], d[2], minWc) * exag;
      }
    }
  }
  // 타일 중심 (해수면 반지름 기준)
  const cc = [0, 0, 0];
  cubeToSphere(face, s0 + scale, t0 + scale, cc);
  const cx = cc[0] * R, cy = cc[1] * R, cz = cc[2] * R;

  const V = (N + 1) * (N + 1);
  const S = 4 * (N + 1);                 // 스커트 정점
  const total = V + S;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const morph = new Float32Array(total * 3);
  const aux = new Float32Array(total * 3);
  const hasSea = terrain.hasOcean && minH < 0;
  const ocean = hasSea ? new Float32Array(total * 3) : null;

  const P = (k, r) => [DX[k * 3] * (R + r), DX[k * 3 + 1] * (R + r), DX[k * 3 + 2] * (R + r)];
  let vi = 0;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++, vi++) {
      const k = (j + 1) * G + (i + 1);
      const p = P(k, H[k]);
      pos[vi * 3] = p[0] - cx; pos[vi * 3 + 1] = p[1] - cy; pos[vi * 3 + 2] = p[2] - cz;
      // 노멀 (중앙 차분)
      const pl = P(k - 1, H[k - 1]), pr = P(k + 1, H[k + 1]), pd = P(k - G, H[k - G]), pu = P(k + G, H[k + G]);
      const ax = pr[0] - pl[0], ay = pr[1] - pl[1], az = pr[2] - pl[2];
      const bx = pu[0] - pd[0], by = pu[1] - pd[1], bz = pu[2] - pd[2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const nl = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      nx *= nl; ny *= nl; nz *= nl;
      if (nx * DX[k * 3] + ny * DX[k * 3 + 1] + nz * DX[k * 3 + 2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
      nrm[vi * 3] = nx; nrm[vi * 3 + 1] = ny; nrm[vi * 3 + 2] = nz;
      // 모핑 목표: 부모 메시가 이 점에서 보여주는 위치
      let target;
      const ei = (i & 1) === 0, ej = (j & 1) === 0;
      if (ei && ej) target = P(k, Hc[k]);
      else if (!ei && ej) { const a = P(k - 1, Hc[k - 1]), b = P(k + 1, Hc[k + 1]); target = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; }
      else if (ei && !ej) { const a = P(k - G, Hc[k - G]), b = P(k + G, Hc[k + G]); target = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; }
      else { const a = P(k - G - 1, Hc[k - G - 1]), b = P(k + G + 1, Hc[k + G + 1]); target = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; }
      morph[vi * 3] = target[0] - p[0]; morph[vi * 3 + 1] = target[1] - p[1]; morph[vi * 3 + 2] = target[2] - p[2];
      aux[vi * 3] = H[k] / exag; aux[vi * 3 + 1] = moist[k]; aux[vi * 3 + 2] = extra[k];
      if (ocean) {
        ocean[vi * 3] = DX[k * 3] * R - cx; ocean[vi * 3 + 1] = DX[k * 3 + 1] * R - cy; ocean[vi * 3 + 2] = DX[k * 3 + 2] * R - cz;
      }
    }
  }
  // 스커트: 가장자리 정점을 아래로 내린 복제본 (균열 은폐)
  const skirt = Math.max(2, spacing * 1.5 + (maxH - minH) * 0.08);
  const edge = [];
  for (let i = 0; i <= N; i++) edge.push(i);                       // 아래 (j=0)
  for (let j = 0; j <= N; j++) edge.push(j * (N + 1) + N);         // 오른쪽
  for (let i = N; i >= 0; i--) edge.push(N * (N + 1) + i);         // 위
  for (let j = N; j >= 0; j--) edge.push(j * (N + 1));             // 왼쪽
  for (let e = 0; e < S; e++, vi++) {
    const src = edge[e];
    const ux = (pos[src * 3] + cx), uy = (pos[src * 3 + 1] + cy), uz = (pos[src * 3 + 2] + cz);
    const ul = 1 / Math.sqrt(ux * ux + uy * uy + uz * uz);
    for (let c = 0; c < 3; c++) {
      const u = [ux, uy, uz][c] * ul;
      pos[vi * 3 + c] = pos[src * 3 + c] - u * skirt;
      nrm[vi * 3 + c] = nrm[src * 3 + c];
      morph[vi * 3 + c] = morph[src * 3 + c];
      aux[vi * 3 + c] = aux[src * 3 + c];
      if (ocean) ocean[vi * 3 + c] = ocean[src * 3 + c] - u * skirt * 0.2;
    }
  }
  return { pos, nrm, morph, aux, ocean, center: [cx, cy, cz], minH, maxH };
}

/** 타일 인덱스 버퍼 (모든 타일 공용) */
export function buildTileIndex(N) {
  const V = (N + 1) * (N + 1);
  const idx = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 2, d = a + N + 1;
      idx.push(a, b, c, a, c, d);
    }
  }
  // 스커트 띠
  const S = 4 * (N + 1);
  const edge = [];
  for (let i = 0; i <= N; i++) edge.push(i);
  for (let j = 0; j <= N; j++) edge.push(j * (N + 1) + N);
  for (let i = N; i >= 0; i--) edge.push(N * (N + 1) + i);
  for (let j = N; j >= 0; j--) edge.push(j * (N + 1));
  for (let e = 0; e < S - 1; e++) {
    const a = edge[e], b = edge[e + 1], c = V + e + 1, d = V + e;
    if (a === b) continue;
    idx.push(a, d, b, b, d, c);
  }
  return idx;
}
