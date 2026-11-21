// 카드 "지문"(perceptual hash) 계산.
// 브라우저(카메라 화면)와 빌드 스크립트(카드 DB 생성)가 이 파일을 똑같이 써서 결과가 일치하게 한다.

export const HASH_N = 32;          // 32x32 로 줄인 뒤
const LOW = 8;                     // 저주파 8x8 = 64비트

// 카드 안에서 일러스트가 있는 대략적인 영역 (카드 크기 대비 비율)
export const ART = { x0: 0.09, y0: 0.12, x1: 0.91, y1: 0.47 };

// RGBA(또는 RGB) 픽셀 → 회색조
export function toGray(data, w, h, ch = 4) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += ch) {
    g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  return g;
}

// 누적합 테이블(SAT). 크기 (w+1)*(h+1), 실수 좌표 영역 평균을 정확하게 구할 수 있다.
export function integral(g, w, h) {
  const W1 = w + 1;
  const s = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g[y * w + x];
      s[(y + 1) * W1 + x + 1] = s[y * W1 + x + 1] + row;
    }
  }
  return { s, w, h };
}

// SAT 를 실수 좌표 (x, y) 에서 읽기 (쌍선형 보간 = 정확한 면적 적분)
function satAt(I, x, y) {
  const { s, w, h } = I;
  if (x <= 0 || y <= 0) return 0;
  if (x > w) x = w;
  if (y > h) y = h;
  const W1 = w + 1;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w), y1 = Math.min(y0 + 1, h);
  const fx = x - x0, fy = y - y0;
  const a = s[y0 * W1 + x0], b = s[y0 * W1 + x1], c = s[y1 * W1 + x0], d = s[y1 * W1 + x1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

// 사각형 (x0,y0)-(x1,y1) 영역을 n x n 으로 면적 평균 축소
export function sample(I, x0, y0, x1, y1, n = HASH_N) {
  const out = new Float32Array(n * n);
  const dx = (x1 - x0) / n, dy = (y1 - y0) / n;
  const area = dx * dy;
  for (let j = 0; j < n; j++) {
    const ya = y0 + j * dy, yb = ya + dy;
    for (let i = 0; i < n; i++) {
      const xa = x0 + i * dx, xb = xa + dx;
      out[j * n + i] = (satAt(I, xb, yb) - satAt(I, xa, yb) - satAt(I, xb, ya) + satAt(I, xa, ya)) / area;
    }
  }
  return out;
}

// DCT 계수표 (8 x 32)
const C = (() => {
  const c = new Float64Array(LOW * HASH_N);
  for (let u = 0; u < LOW; u++)
    for (let x = 0; x < HASH_N; x++)
      c[u * HASH_N + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * HASH_N));
  return c;
})();

// 32x32 회색 → 64비트 지문 [hi, lo] (uint32 두 개)
export function phash(px) {
  const N = HASH_N;
  const t = new Float64Array(LOW * N); // t = C · px  (8 x 32)
  for (let u = 0; u < LOW; u++)
    for (let x = 0; x < N; x++) {
      let acc = 0;
      for (let y = 0; y < N; y++) acc += C[u * N + y] * px[y * N + x];
      t[u * N + x] = acc;
    }
  const d = new Float64Array(LOW * LOW); // d = t · C^T (8 x 8)
  for (let u = 0; u < LOW; u++)
    for (let v = 0; v < LOW; v++) {
      let acc = 0;
      for (let x = 0; x < N; x++) acc += t[u * N + x] * C[v * N + x];
      d[u * LOW + v] = acc;
    }
  const sorted = Array.from(d).slice(1).sort((a, b) => a - b);
  const med = (sorted[31] + sorted[32]) / 2;
  let hi = 0, lo = 0;
  for (let k = 0; k < 64; k++) {
    if (d[k] > med) {
      if (k < 32) hi |= 1 << k; else lo |= 1 << (k - 32);
    }
  }
  return [hi >>> 0, lo >>> 0];
}

// 카드 영역 (x0,y0)-(x1,y1) 의 지문 4개 값: [전체hi, 전체lo, 그림hi, 그림lo]
export function cardHash(I, x0, y0, x1, y1) {
  const w = x1 - x0, h = y1 - y0;
  const full = phash(sample(I, x0, y0, x1, y1));
  const art = phash(sample(I, x0 + ART.x0 * w, y0 + ART.y0 * h, x0 + ART.x1 * w, y0 + ART.y1 * h));
  return [full[0], full[1], art[0], art[1]];
}

export function popcount(v) {
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

// DB(Uint32Array, 카드당 4칸)에서 질의 지문들(여러 크롭 후보)과 가장 가까운 카드 top-k
// 점수 = 전체 지문 거리 + 그림 지문 거리 (0~128, 작을수록 비슷)
export function bestMatches(db, queries, k = 5) {
  const n = db.length >>> 2;
  const best = new Uint8Array(n).fill(255);
  for (const q of queries) {
    const [a, b, c, d] = q;
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const s = popcount(db[o] ^ a) + popcount(db[o + 1] ^ b) + popcount(db[o + 2] ^ c) + popcount(db[o + 3] ^ d);
      if (s < best[i]) best[i] = s;
    }
  }
  const top = [];
  for (let i = 0; i < n; i++) {
    const s = best[i];
    if (top.length < k || s < top[top.length - 1].score) {
      top.push({ index: i, score: s });
      top.sort((x, y) => x.score - y.score);
      if (top.length > k) top.pop();
    }
  }
  return top;
}

// 띠부씰(정사각형) 지문: [전체hi, 전체lo, 가운데hi, 가운데lo]
export function stickerHash(I, x0, y0, x1, y1) {
  const w = x1 - x0, h = y1 - y0;
  const full = phash(sample(I, x0, y0, x1, y1));
  const mid = phash(sample(I, x0 + 0.2 * w, y0 + 0.2 * h, x0 + 0.8 * w, y0 + 0.8 * h));
  return [full[0], full[1], mid[0], mid[1]];
}
