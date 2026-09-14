// ORBITER — 절차적 텍스처
//
// 사진처럼 보이려면 "면이 균일하지 않아야" 한다. 실제 금속은 압연 자국이
// 있고, 도장은 미세한 오렌지필이 있고, 발사체는 이슬·그을음·긁힘이 있다.
// 그런 정보를 담은 타일을 부팅 때 한 번만 만들어 두고 패턴으로 재사용한다.
//
// 모든 타일은 회색조(중간값 128) 다. overlay/soft-light 로 얹으면
// 밑에 깔린 셰이딩 색을 해치지 않고 표면 정보만 더한다.

/* ──────────────────────────────────────────────────────────────
 * 결정론적 잡음 — Math.random 을 쓰면 새로고침마다 표면이 달라진다
 * ────────────────────────────────────────────────────────────── */

function makeRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** 타일링되는 2D 값 노이즈 (주기 = period) */
function makeTileNoise(period, seed) {
  const rnd = makeRandom(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const wrap = (v) => ((v % period) + period) % period;
    const x0 = wrap(xi);
    const x1 = wrap(xi + 1);
    const y0 = wrap(yi);
    const y1 = wrap(yi + 1);
    const v00 = g[y0 * period + x0];
    const v10 = g[y0 * period + x1];
    const v01 = g[y1 * period + x0];
    const v11 = g[y1 * period + x1];
    const u = fade(xf);
    const v = fade(yf);
    return (
      v00 * (1 - u) * (1 - v) +
      v10 * u * (1 - v) +
      v01 * (1 - u) * v +
      v11 * u * v
    );
  };
}

/** 여러 옥타브를 겹친 타일링 fBm */
function tileFbm(size, octaves, seed, lacunarity = 2) {
  const layers = [];
  let period = 4;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    layers.push({ n: makeTileNoise(period, seed + o * 7919), amp, period });
    norm += amp;
    amp *= 0.5;
    period = Math.min(size, period * lacunarity);
  }
  return (x, y) => {
    let sum = 0;
    for (const l of layers) {
      sum += l.amp * l.n((x / size) * l.period, (y / size) * l.period);
    }
    return sum / norm;
  };
}

/* ──────────────────────────────────────────────────────────────
 * 타일 생성기
 * ────────────────────────────────────────────────────────────── */

const SIZE = 256;
const _cache = new Map();
const _patterns = new Map();

function makeTile(name, fill) {
  if (_cache.has(name)) return _cache.get(name);
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const g = c.getContext('2d');
  const img = g.createImageData(SIZE, SIZE);
  fill(img.data, SIZE);
  g.putImageData(img, 0, 0);
  _cache.set(name, c);
  return c;
}

const put = (d, i, v, a = 255) => {
  const c = v < 0 ? 0 : v > 255 ? 255 : v;
  d[i] = c;
  d[i + 1] = c;
  d[i + 2] = c;
  d[i + 3] = a;
};

/** 압연 금속 — 가로로 길게 늘어난 결 */
export function brushedTile() {
  return makeTile('brushed', (d, S) => {
    const fine = tileFbm(S, 4, 1301);
    const rnd = makeRandom(77);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        // 가로로 16배 늘린 좌표 → 압연 방향 줄무늬
        const streak = fine(x * 0.12, y * 3.4) * 2 - 1;
        const micro = rnd() * 2 - 1;
        put(d, (y * S + x) * 4, 128 + streak * 22 + micro * 7);
      }
    }
  });
}

/** 도장 표면 — 오렌지필(미세한 물결) + 먼지 알갱이 */
export function paintTile() {
  return makeTile('paint', (d, S) => {
    const peel = tileFbm(S, 3, 4127);
    const rnd = makeRandom(913);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const p = peel(x * 1.6, y * 1.6) * 2 - 1;
        const dust = rnd() < 0.004 ? (rnd() < 0.5 ? -50 : 40) : 0;
        put(d, (y * S + x) * 4, 128 + p * 11 + (rnd() * 2 - 1) * 4 + dust);
      }
    }
  });
}

/** 탄소 복합재 — 능직 위브 */
export function carbonTile() {
  return makeTile('carbon', (d, S) => {
    const cell = 8;
    const rnd = makeRandom(555);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const cx = Math.floor(x / cell);
        const cy = Math.floor(y / cell);
        const over = (cx + cy) % 2 === 0;
        const u = (x % cell) / cell;
        const v = (y % cell) / cell;
        // 위로 올라온 실은 밝고, 가장자리는 어둡다
        const t = over ? u : v;
        const curve = Math.sin(t * Math.PI);
        const base = over ? 118 : 104;
        put(d, (y * S + x) * 4, base + curve * 38 + (rnd() * 2 - 1) * 5);
      }
    }
  });
}

/** MLI 금박 — 구겨진 주름 */
export function foilTile() {
  return makeTile('foil', (d, S) => {
    const crease = tileFbm(S, 5, 2711, 2.3);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = crease(x, y);
        // 능선 노이즈 — 주름은 날카로운 선으로 보인다
        const ridge = 1 - Math.abs(n * 2 - 1);
        const sharp = Math.pow(ridge, 6);
        put(d, (y * S + x) * 4, 100 + sharp * 120 + n * 30);
      }
    }
  });
}

/** 때·얼룩 — 큰 스케일의 불규칙한 오염 */
export function grimeTile() {
  return makeTile('grime', (d, S) => {
    const blot = tileFbm(S, 4, 8317, 2.1);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = blot(x, y);
        const v = n < 0.45 ? 128 - (0.45 - n) * 150 : 128 + (n - 0.45) * 40;
        put(d, (y * S + x) * 4, v);
      }
    }
  });
}

/** 긁힘 — 가는 선 형태의 마모 */
export function scratchTile() {
  if (_cache.has('scratch')) return _cache.get('scratch');
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, SIZE, SIZE);
  const rnd = makeRandom(4649);
  g.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    const a = (rnd() - 0.5) * 0.6 + (rnd() < 0.5 ? 0 : Math.PI / 2);
    const len = 6 + rnd() * 50;
    const bright = rnd() < 0.55;
    g.strokeStyle = bright
      ? `rgba(200,200,200,${0.15 + rnd() * 0.3})`
      : `rgba(60,60,60,${0.12 + rnd() * 0.25})`;
    g.lineWidth = 0.5 + rnd() * 1.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
    // 타일 경계를 넘는 선은 반대편에도 그려 이음매를 없앤다
    for (const [ox, oy] of [[-SIZE, 0], [SIZE, 0], [0, -SIZE], [0, SIZE]]) {
      g.beginPath();
      g.moveTo(x + ox, y + oy);
      g.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
      g.stroke();
    }
  }
  _cache.set('scratch', c);
  return c;
}

/** 콘크리트 — 발사대 바닥 */
export function concreteTile() {
  return makeTile('concrete', (d, S) => {
    const coarse = tileFbm(S, 3, 1777);
    const rnd = makeRandom(31);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = coarse(x * 1.2, y * 1.2) * 2 - 1;
        const agg = rnd() < 0.02 ? (rnd() * 2 - 1) * 40 : 0;
        put(d, (y * S + x) * 4, 128 + n * 16 + (rnd() * 2 - 1) * 9 + agg);
      }
    }
  });
}

/** 암석/토양 — 지표 근접용 */
export function regolithTile() {
  return makeTile('regolith', (d, S) => {
    const f = tileFbm(S, 5, 6199, 2.2);
    const rnd = makeRandom(202);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = f(x, y) * 2 - 1;
        put(d, (y * S + x) * 4, 128 + n * 34 + (rnd() * 2 - 1) * 10);
      }
    }
  });
}

/* ──────────────────────────────────────────────────────────────
 * 패턴 캐시 — createPattern 은 컨텍스트마다 만들어야 한다
 * ────────────────────────────────────────────────────────────── */

const MAKERS = {
  brushed: brushedTile,
  paint: paintTile,
  carbon: carbonTile,
  foil: foilTile,
  grime: grimeTile,
  scratch: scratchTile,
  concrete: concreteTile,
  regolith: regolithTile,
};

/**
 * 이름으로 패턴을 얻는다. 같은 컨텍스트/이름 조합은 캐시된다.
 */
export function texturePattern(ctx, name) {
  const key = name;
  let byCtx = _patterns.get(ctx);
  if (!byCtx) {
    byCtx = new Map();
    _patterns.set(ctx, byCtx);
  }
  let p = byCtx.get(key);
  if (p !== undefined) return p;
  const maker = MAKERS[name];
  if (!maker) {
    byCtx.set(key, null);
    return null;
  }
  try {
    p = ctx.createPattern(maker(), 'repeat');
  } catch (e) {
    p = null;
  }
  byCtx.set(key, p);
  return p;
}

/**
 * 현재 클립 영역에 텍스처를 깐다.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} name   텍스처 이름
 * @param {number} w      덮을 폭 (부품 로컬 미터)
 * @param {number} h      덮을 높이
 * @param {object} opts   { alpha, scale, mode, rotate, offsetX, offsetY }
 *   scale = 텍스처 1픽셀이 몇 미터인가. 작을수록 촘촘하다.
 */
export function paintTexture(ctx, name, w, h, opts = {}) {
  const alpha = opts.alpha ?? 0.2;
  if (alpha <= 0.004) return;
  const pat = texturePattern(ctx, name);
  if (!pat) return;
  const scale = opts.scale ?? 0.008;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = opts.mode ?? 'overlay';
  ctx.translate(opts.offsetX ?? 0, opts.offsetY ?? 0);
  if (opts.rotate) ctx.rotate(opts.rotate);
  ctx.scale(scale, scale);
  ctx.fillStyle = pat;
  // 회전에 대비해 넉넉히 덮는다
  const span = (Math.hypot(w, h) * 1.2) / scale;
  ctx.fillRect(-span / 2, -span / 2, span, span);
  ctx.restore();
}

/** 부팅 때 미리 만들어 첫 프레임 끊김을 없앤다 */
export function warmTextures() {
  for (const name in MAKERS) {
    try {
      MAKERS[name]();
    } catch (e) {
      /* 캔버스를 못 만드는 환경이면 조용히 넘어간다 */
    }
  }
}
