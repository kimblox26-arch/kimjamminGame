// SpaceSim — 절차적 표면 텍스처 생성기
//
// 외부 이미지 없이 캔버스에서 천체 표면을 합성한다. 노이즈는 구면 좌표로
// 샘플링하므로 경도 방향 이음매가 없고 극 왜곡도 생기지 않는다.
// 생성 비용이 있어 천체가 화면에서 충분히 커졌을 때 처음 한 번만 만들고 캐시한다.

import * as THREE from 'three';

const cache = new Map();

// ─────────── 3D 값 노이즈 ───────────

function makeNoise(seed) {
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  const grad = new Float32Array(256);
  for (let i = 0; i < 256; i++) grad[i] = rnd();
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const g = (a, b, c) => grad[perm[(perm[(perm[a & 255] + b) & 255] + c) & 255]];

  const val = (x, y, z) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const fx = x - X, fy = y - Y, fz = z - Z;
    const u = fade(fx), v = fade(fy), w = fade(fz);
    const c000 = g(X, Y, Z), c100 = g(X + 1, Y, Z);
    const c010 = g(X, Y + 1, Z), c110 = g(X + 1, Y + 1, Z);
    const c001 = g(X, Y, Z + 1), c101 = g(X + 1, Y, Z + 1);
    const c011 = g(X, Y + 1, Z + 1), c111 = g(X + 1, Y + 1, Z + 1);
    const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
    const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;
  };

  const fbm = (x, y, z, oct = 4, lac = 2.1, gain = 0.5) => {
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += a * val(x * f, y * f, z * f);
      norm += a;
      a *= gain; f *= lac;
    }
    return sum / norm;
  };

  // 능선형 노이즈 — 산맥·소용돌이 경계에 쓴다
  const ridge = (x, y, z, oct = 4) => {
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += a * (1 - Math.abs(val(x * f, y * f, z * f) * 2 - 1));
      norm += a; a *= 0.5; f *= 2.1;
    }
    return sum / norm;
  };

  return { val, fbm, ridge, rnd };
}

// ─────────── 유틸 ───────────

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function mix3(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

/**
 * 픽셀별 셰이딩 함수로 구면 텍스처를 합성한다.
 * shade(u, v, nx, ny, nz, out) — out 에 [r,g,b] (0~255) 기록
 */
function paint(w, h, shade) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const out = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    const phi = v * Math.PI;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const th = u * Math.PI * 2;
      shade(u, v, sp * Math.cos(th), sp * Math.sin(th), cp, out);
      const i = (y * w + x) * 4;
      d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { cv, ctx };
}

/** 캔버스 위에 크레이터를 찍는다 (경도 랩·극 왜곡 보정 포함) */
function addCraters(ctx, w, h, count, rnd, tint = 'rgba(0,0,0,') {
  for (let k = 0; k < count; k++) {
    const v = 0.06 + rnd() * 0.88;
    const y = v * h;
    const sp = Math.max(0.12, Math.sin(v * Math.PI));
    const r = (1.6 + Math.pow(rnd(), 3.0) * 22) * (h / 256);
    const x = rnd() * w;
    const rx = r / sp; // 극으로 갈수록 경도 방향으로 늘린다
    const dark = 0.12 + rnd() * 0.22;
    for (const dx of [-w, 0, w]) {
      ctx.save();
      ctx.translate(x + dx, y);
      ctx.scale(rx / r, 1);
      const g = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
      g.addColorStop(0, `${tint}${dark * 0.5})`);
      g.addColorStop(0.72, `${tint}${dark})`);
      g.addColorStop(0.86, 'rgba(255,255,255,0.09)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function toTexture(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// ─────────── 천체별 합성 ───────────

const KINDS = {
  // 암석형 — 수성·칼리스토·소행성
  rock(spec, N) {
    const W = spec.size || 512, H = W / 2;
    const base = hex(spec.color ?? 0x9c8f84);
    const dark = base.map((c) => c * 0.55);
    const light = base.map((c) => Math.min(255, c * 1.3));
    const { cv, ctx } = paint(W, H, (u, v, nx, ny, nz, out) => {
      const n = N.fbm(nx * 3.4, ny * 3.4, nz * 3.4, 5);
      const m = N.fbm(nx * 1.3 + 11, ny * 1.3, nz * 1.3, 3);
      const t = clamp01(n * 0.75 + m * 0.45);
      const c = mix3(dark, light, t);
      const grain = (N.val(nx * 40, ny * 40, nz * 40) - 0.5) * 18;
      out[0] = clamp01((c[0] + grain) / 255) * 255;
      out[1] = clamp01((c[1] + grain) / 255) * 255;
      out[2] = clamp01((c[2] + grain) / 255) * 255;
    });
    addCraters(ctx, W, H, Math.round(160 * (spec.craters ?? 1)), N.rnd);
    return cv;
  },

  // 달 — 암석 + 어두운 바다(마리아)
  moon(spec, N) {
    const W = spec.size || 512, H = W / 2;
    const hi = [196, 192, 186], lo = [96, 94, 92], maria = [58, 58, 64];
    const { cv, ctx } = paint(W, H, (u, v, nx, ny, nz, out) => {
      const n = N.fbm(nx * 3.0, ny * 3.0, nz * 3.0, 5);
      let c = mix3(lo, hi, clamp01(n * 1.15));
      // 마리아는 앞면(경도 0 부근)에 몰려 있다
      const m = N.fbm(nx * 1.5 + 31, ny * 1.5, nz * 1.5, 3);
      const front = smooth(0.15, 0.75, nx * 0.5 + 0.5);
      const mask = smooth(0.52, 0.62, m) * front;
      c = mix3(c, maria, mask * 0.92);
      const grain = (N.val(nx * 50, ny * 50, nz * 50) - 0.5) * 14;
      out[0] = clamp01((c[0] + grain) / 255) * 255;
      out[1] = clamp01((c[1] + grain) / 255) * 255;
      out[2] = clamp01((c[2] + grain) / 255) * 255;
    });
    addCraters(ctx, W, H, 220, N.rnd);
    return cv;
  },

  // 지구 — 바다·대륙·사막·빙관·구름
  earth(spec, N) {
    const W = spec.size || 1024, H = W / 2;
    const deep = [8, 32, 78], shallow = [22, 92, 150];
    const grass = [44, 92, 48], forest = [26, 62, 34];
    const sand = [162, 142, 96], rock = [120, 112, 98], ice = [242, 246, 250];
    const { cv, ctx } = paint(W, H, (u, v, nx, ny, nz, out) => {
      const lat = Math.abs(v - 0.5) * 2;             // 0 적도 ~ 1 극
      const cont = N.fbm(nx * 1.9, ny * 1.9, nz * 1.9, 6, 2.15, 0.52);
      const detail = N.fbm(nx * 7, ny * 7, nz * 7, 4);
      const hgt = cont * 0.82 + detail * 0.18;
      let c;
      if (hgt < 0.505) {
        c = mix3(deep, shallow, smooth(0.40, 0.505, hgt));
      } else {
        const land = smooth(0.505, 0.58, hgt);
        // 위도에 따른 식생/사막 분포
        const arid = smooth(0.12, 0.34, Math.abs(lat - 0.28)) * smooth(0.3, 0.6, detail);
        c = mix3(mix3(grass, forest, detail), sand, arid);
        c = mix3(c, rock, smooth(0.62, 0.78, hgt));
        c = mix3(shallow, c, land);
      }
      // 빙관
      const ic = smooth(0.78, 0.93, lat + (N.val(nx * 6, ny * 6, nz * 6) - 0.5) * 0.12);
      c = mix3(c, ice, ic);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    // 구름층
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H, phi = v * Math.PI;
      const sp = Math.sin(phi), cp = Math.cos(phi);
      for (let x = 0; x < W; x++) {
        const th = ((x + 0.5) / W) * Math.PI * 2;
        const nx = sp * Math.cos(th), ny = sp * Math.sin(th), nz = cp;
        // 위도 방향으로 눌린 소용돌이 구름
        const cl = N.fbm(nx * 3.2, ny * 3.2, nz * 6.5 + 77, 5, 2.2, 0.55);
        const band = 0.55 + 0.22 * Math.cos(v * Math.PI * 6);
        const a = smooth(band, band + 0.16, cl);
        const i = (y * W + x) * 4;
        d[i] = lerp(d[i], 250, a * 0.92);
        d[i + 1] = lerp(d[i + 1], 252, a * 0.92);
        d[i + 2] = lerp(d[i + 2], 255, a * 0.92);
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  },

  // 화성 — 산화철 표면 + 알베도 지형 + 극관
  mars(spec, N) {
    const W = spec.size || 768, H = W / 2;
    const bright = [196, 118, 74], mid = [148, 78, 48], dark = [96, 58, 44];
    const ice = [238, 240, 244];
    const { cv, ctx } = paint(W, H, (u, v, nx, ny, nz, out) => {
      const lat = Math.abs(v - 0.5) * 2;
      const n = N.fbm(nx * 2.2, ny * 2.2, nz * 2.2, 6);
      const alb = N.fbm(nx * 1.1 + 5, ny * 1.1, nz * 1.1, 3);
      let c = mix3(mid, bright, clamp01(n * 1.2));
      c = mix3(c, dark, smooth(0.55, 0.75, alb) * 0.8);
      const grain = (N.val(nx * 30, ny * 30, nz * 30) - 0.5) * 16;
      c = [c[0] + grain, c[1] + grain, c[2] + grain];
      const ic = smooth(0.86, 0.96, lat + (N.val(nx * 8, ny * 8, nz * 8) - 0.5) * 0.1);
      c = mix3(c, ice, ic);
      out[0] = clamp01(c[0] / 255) * 255;
      out[1] = clamp01(c[1] / 255) * 255;
      out[2] = clamp01(c[2] / 255) * 255;
    });
    addCraters(ctx, W, H, 90, N.rnd);
    return cv;
  },

  // 금성 — 두꺼운 황산 구름
  venus(spec, N) {
    const W = spec.size || 512, H = W / 2;
    const a = [236, 214, 160], b = [198, 164, 104], c2 = [250, 238, 206];
    const { cv } = paint(W, H, (u, v, nx, ny, nz, out) => {
      // 초자전(super-rotation) 으로 위도 방향으로 강하게 늘어난 구름
      const s = N.fbm(nx * 1.4, ny * 1.4, nz * 5.5, 5, 2.2, 0.55);
      const t = N.ridge(nx * 2.4, ny * 2.4, nz * 7.0, 4);
      let c = mix3(b, a, clamp01(s * 1.25));
      c = mix3(c, c2, smooth(0.55, 0.85, t) * 0.5);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    return cv;
  },

  // 가스행성 — 위도 띠 + 난류 + 대적점
  gas(spec, N) {
    const W = spec.size || 1024, H = W / 2;
    const base = hex(spec.color ?? 0xd9b48f);
    const lightB = base.map((c) => Math.min(255, c * 1.22));
    const darkB = base.map((c) => c * 0.62);
    const white = [246, 238, 224];
    const { cv, ctx } = paint(W, H, (u, v, nx, ny, nz, out) => {
      const lat = (v - 0.5) * 2;
      // 띠 구조: 위도 방향 사인 + 난류로 흔들기
      const warp = (N.fbm(nx * 2.2, ny * 2.2, nz * 3.0, 4) - 0.5) * 0.11;
      const bands = Math.sin((lat + warp) * Math.PI * 9.5) * 0.5 + 0.5;
      const fine = N.fbm(nx * 3.0, ny * 3.0, nz * 14.0, 5, 2.1, 0.55);
      let t = clamp01(bands * 0.72 + fine * 0.4);
      let c = mix3(darkB, lightB, t);
      // 극지방은 어둡게
      c = mix3(c, darkB, smooth(0.72, 1.0, Math.abs(lat)) * 0.45);
      // 소용돌이 하이라이트
      c = mix3(c, white, smooth(0.74, 0.92, fine) * 0.5);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    if (spec.spot) {
      // 대적점 — 남위 22°, 경도 방향으로 긴 타원
      const cx = W * 0.68, cy = H * (0.5 + 0.22 / 2 * 2 * 0.5 + 0.11);
      for (const dx of [-W, 0, W]) {
        ctx.save();
        ctx.translate(cx + dx, cy);
        ctx.scale(2.5, 1);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, H * 0.085);
        g.addColorStop(0, 'rgba(186,86,52,0.95)');
        g.addColorStop(0.55, 'rgba(198,112,72,0.8)');
        g.addColorStop(0.85, 'rgba(214,160,120,0.35)');
        g.addColorStop(1, 'rgba(214,160,120,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, H * 0.085, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    return cv;
  },

  // 얼음거성 — 메탄 흡수로 균일한 청록
  ice(spec, N) {
    const W = spec.size || 512, H = W / 2;
    const base = hex(spec.color ?? 0x8fd6e0);
    const lightB = base.map((c) => Math.min(255, c * 1.18));
    const darkB = base.map((c) => c * 0.72);
    const { cv, ctx } = paint(W, H, (u, v, nx, ny, nz, out) => {
      const lat = (v - 0.5) * 2;
      const warp = (N.fbm(nx * 1.6, ny * 1.6, nz * 2.2, 3) - 0.5) * 0.1;
      const bands = Math.sin((lat + warp) * Math.PI * 4.5) * 0.5 + 0.5;
      const fine = N.fbm(nx * 2.4, ny * 2.4, nz * 8.0, 4);
      const t = clamp01(bands * 0.35 + fine * 0.3 + 0.35);
      const c = mix3(darkB, lightB, t);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    if (spec.bands) {
      // 해왕성 대흑점
      const g = ctx.createRadialGradient(W * 0.3, H * 0.38, 0, W * 0.3, H * 0.38, H * 0.1);
      g.addColorStop(0, 'rgba(18,34,96,0.85)');
      g.addColorStop(1, 'rgba(18,34,96,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    return cv;
  },

  // 이오 — 황 화합물과 화산 칼데라
  io(spec, N) {
    const W = spec.size || 512, H = W / 2;
    const yellow = [236, 214, 118], orange = [212, 148, 62], white = [242, 236, 208];
    const { cv, ctx } = paint(W, H, (u, v, nx, ny, nz, out) => {
      const n = N.fbm(nx * 3.0, ny * 3.0, nz * 3.0, 5);
      const m = N.fbm(nx * 6.5 + 9, ny * 6.5, nz * 6.5, 4);
      let c = mix3(orange, yellow, clamp01(n * 1.3));
      c = mix3(c, white, smooth(0.62, 0.86, m) * 0.55);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    // 화산 칼데라 — 어두운 반점
    for (let k = 0; k < 70; k++) {
      const x = N.rnd() * W, v = 0.08 + N.rnd() * 0.84, y = v * H;
      const r = (2 + Math.pow(N.rnd(), 2) * 14) * (H / 256);
      const sp = Math.max(0.15, Math.sin(v * Math.PI));
      for (const dx of [-W, 0, W]) {
        ctx.save();
        ctx.translate(x + dx, y);
        ctx.scale(1 / sp, 1);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, 'rgba(48,26,14,0.9)');
        g.addColorStop(0.7, 'rgba(96,50,22,0.5)');
        g.addColorStop(1, 'rgba(120,70,30,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    return cv;
  },

  // 유로파 — 매끄러운 얼음과 리네아(균열)
  europa(spec, N) {
    const W = spec.size || 512, H = W / 2;
    const icec = [232, 224, 206], tan = [196, 170, 136];
    const { cv, ctx } = paint(W, H, (u, v, nx, ny, nz, out) => {
      const n = N.fbm(nx * 2.5, ny * 2.5, nz * 2.5, 4);
      const c = mix3(icec, tan, clamp01((n - 0.4) * 1.4));
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    ctx.lineCap = 'round';
    for (let k = 0; k < 90; k++) {
      const y0 = N.rnd() * H, x0 = N.rnd() * W;
      const len = W * (0.1 + N.rnd() * 0.5);
      const ang = (N.rnd() - 0.5) * 1.5;
      ctx.strokeStyle = `rgba(${140 + N.rnd() * 40 | 0},${96 + N.rnd() * 30 | 0},70,${0.28 + N.rnd() * 0.4})`;
      ctx.lineWidth = (0.6 + N.rnd() * 2.4) * (H / 256);
      for (const dx of [-W, 0, W]) {
        ctx.beginPath();
        ctx.moveTo(x0 + dx, y0);
        ctx.bezierCurveTo(
          x0 + dx + len * 0.33, y0 + Math.sin(ang) * H * 0.1,
          x0 + dx + len * 0.66, y0 - Math.sin(ang) * H * 0.1,
          x0 + dx + len, y0 + Math.sin(ang) * H * 0.05,
        );
        ctx.stroke();
      }
    }
    return cv;
  },

  // 가니메데 — 밝은 홈지형과 어두운 옛지각
  ganymede(spec, N) {
    const W = spec.size || 512, H = W / 2;
    const dark = [92, 84, 76], light = [172, 164, 154];
    const { cv, ctx } = paint(W, H, (u, v, nx, ny, nz, out) => {
      const n = N.fbm(nx * 2.0, ny * 2.0, nz * 2.0, 5);
      const groove = N.ridge(nx * 9, ny * 9, nz * 9, 3);
      let c = mix3(dark, light, smooth(0.42, 0.58, n));
      c = mix3(c, light, smooth(0.72, 0.95, groove) * 0.45);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    addCraters(ctx, W, H, 120, N.rnd);
    return cv;
  },

  // 타이탄 — 유기물 안개에 덮여 특징이 흐릿하다
  titan(spec, N) {
    const W = spec.size || 384, H = W / 2;
    const a = [214, 152, 74], b = [174, 112, 52];
    const { cv } = paint(W, H, (u, v, nx, ny, nz, out) => {
      const n = N.fbm(nx * 1.8, ny * 1.8, nz * 3.2, 4);
      const c = mix3(b, a, clamp01(n * 1.2 + 0.15));
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    return cv;
  },

  // 항성 — 쌀알무늬와 흑점
  sun(spec, N) {
    const W = spec.size || 512, H = W / 2;
    const base = hex(spec.color ?? 0xfff0d8);
    const hot = [255, 252, 242], cool = base.map((c) => c * 0.78);
    const { cv, ctx } = paint(W, H, (u, v, nx, ny, nz, out) => {
      const gran = N.fbm(nx * 26, ny * 26, nz * 26, 3, 2.3, 0.5);
      const cell = N.ridge(nx * 18, ny * 18, nz * 18, 2);
      let c = mix3(cool, hot, clamp01(gran * 0.8 + cell * 0.45));
      const lat = Math.abs(v - 0.5) * 2;
      c = mix3(c, cool, smooth(0.7, 1.0, lat) * 0.25);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    for (let k = 0; k < 10; k++) {
      const v = 0.32 + N.rnd() * 0.36;
      const x = N.rnd() * W, y = v * H;
      const r = (3 + N.rnd() * 12) * (H / 256);
      const sp = Math.max(0.2, Math.sin(v * Math.PI));
      ctx.save();
      ctx.translate(x, y); ctx.scale(1 / sp, 1);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(90,40,10,0.72)');
      g.addColorStop(0.6, 'rgba(170,96,30,0.4)');
      g.addColorStop(1, 'rgba(220,150,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    return cv;
  },
};

/**
 * 텍스처 가져오기 (없으면 생성 후 캐시)
 * @param {string} id  캐시 키
 * @param {object} spec { kind, color, craters, spot, bands, seed, size }
 */
export function getTexture(id, spec) {
  if (cache.has(id)) return cache.get(id);
  const kind = KINDS[spec.kind] ? spec.kind : 'rock';
  const N = makeNoise(spec.seed ?? hashString(id));
  const cv = KINDS[kind](spec, N);
  const tex = toTexture(cv);
  cache.set(id, tex);
  return tex;
}

/**
 * 토성 고리 텍스처 — 실제 A/B/C 고리와 카시니 간극 구조.
 * u = 0 이 내부 가장자리(74,500 km), u = 1 이 외부(140,200 km).
 */
export function getRingTexture() {
  const id = '__ring';
  if (cache.has(id)) return cache.get(id);
  const W = 1024, H = 1;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const R0 = 74500, R1 = 140200;
  // [내경, 외경, 광학두께, 밝기]
  const REGIONS = [
    [74500, 92000, 0.10, 0.55],   // C 고리
    [92000, 117580, 0.85, 1.00],  // B 고리
    [117580, 122170, 0.05, 0.35], // 카시니 간극
    [122170, 133590, 0.55, 0.90], // A 고리 (내)
    [133590, 136780, 0.02, 0.30], // 엥케 간극 부근
    [136780, 140200, 0.45, 0.80], // A 고리 (외)
  ];
  const N = makeNoise(4242);
  for (let x = 0; x < W; x++) {
    const r = R0 + ((x + 0.5) / W) * (R1 - R0);
    let tau = 0, bright = 0.5;
    for (const [a, b, t, br] of REGIONS) {
      if (r >= a && r < b) {
        tau = t; bright = br;
        // 가장자리에서 부드럽게 감쇠
        const e = Math.min((r - a) / (b - a), (b - r) / (b - a));
        tau *= smooth(0, 0.06, e) * 0.5 + 0.5;
        break;
      }
    }
    // 미세 고리 구조
    const fine = N.fbm(r * 0.0016, 0.5, 0.5, 5, 2.3, 0.55);
    tau *= 0.62 + 0.76 * fine;
    const alpha = clamp01(1 - Math.exp(-tau * 2.6));
    const c = clamp01(bright * (0.72 + 0.4 * fine));
    const i = x * 4;
    d[i] = 214 * c; d[i + 1] = 200 * c; d[i + 2] = 176 * c;
    d[i + 3] = alpha * 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  cache.set(id, tex);
  return tex;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function clearTextureCache() {
  for (const t of cache.values()) t.dispose?.();
  cache.clear();
}
