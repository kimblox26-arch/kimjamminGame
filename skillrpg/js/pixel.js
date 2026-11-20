// ───────── 픽셀 그리기 도구 · 비트맵 폰트 · 스프라이트 ─────────
const PX = (() => {
  const R = Math.round;
  function rect(c, x, y, w, h, col) { c.fillStyle = col; c.fillRect(R(x), R(y), R(w), R(h)); }
  function disc(c, cx, cy, r, col) {
    if (r <= 0.3) return;
    c.fillStyle = col; cx = R(cx); cy = R(cy);
    const ri = Math.floor(r);
    for (let y = -ri; y <= ri; y++) {
      const hw = Math.floor(Math.sqrt(r * r - y * y));
      c.fillRect(cx - hw, cy + y, hw * 2 + 1, 1);
    }
  }
  function ellipse(c, cx, cy, rx, ry, col) {
    if (rx <= 0.3 || ry <= 0.3) return;
    c.fillStyle = col; cx = R(cx); cy = R(cy);
    const ri = Math.floor(ry);
    for (let y = -ri; y <= ri; y++) {
      const hw = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
      c.fillRect(cx - hw, cy + y, hw * 2 + 1, 1);
    }
  }
  function ring(c, cx, cy, r, col, sy = 1, th = 1, a0 = 0, a1 = Math.PI * 2) {
    if (r <= 0.3) return;
    c.fillStyle = col;
    const n = Math.max(8, Math.ceil(r * 7 * (a1 - a0) / (Math.PI * 2)));
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      c.fillRect(R(cx + Math.cos(a) * r - th / 2), R(cy + Math.sin(a) * r * sy - th / 2), th, th);
    }
  }
  function line(c, x0, y0, x1, y1, col, th = 1) {
    c.fillStyle = col;
    x0 = R(x0); y0 = R(y0); x1 = R(x1); y1 = R(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, g = 0;
    const o = th >> 1;
    while (g++ < 3000) {
      c.fillRect(x0 - o, y0 - o, th, th);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function tri(c, x0, y0, x1, y1, x2, y2, col) {
    c.fillStyle = col;
    const minX = Math.floor(Math.min(x0, x1, x2)), maxX = Math.ceil(Math.max(x0, x1, x2));
    const minY = Math.floor(Math.min(y0, y1, y2)), maxY = Math.ceil(Math.max(y0, y1, y2));
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 0.5) return;
    for (let y = minY; y <= maxY; y++) {
      let sx = -1, ex = -1;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) { if (sx < 0) sx = x; ex = x; }
      }
      if (sx >= 0) c.fillRect(sx, y, ex - sx + 1, 1);
    }
  }
  function sprite(c, rows, pal, x, y, flip = false) {
    x = R(x); y = R(y);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let i = 0; i < row.length; i++) {
        const col = pal[row[i]];
        if (!col) continue;
        c.fillStyle = col;
        c.fillRect(x + (flip ? row.length - 1 - i : i), y + r, 1, 1);
      }
    }
  }

  // 3x5 비트맵 숫자 폰트
  const FONT = {
    '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
    '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001010010',
    '8': '111101111101111', '9': '111101111001111', '+': '000010111010000', '!': '010010010000010',
    'x': '000101010101000', ',': '000000000010100', '-': '000000111000000', 'K': '101101110101101',
    'M': '101111111101101', 'C': '111100100100111', 'R': '110101110101101', 'I': '111010010010111',
    'T': '111010010010010', 'A': '010101111101101', 'L': '100100100100111',
  };
  function textW(str, s = 1) { return str.length * 4 * s - s; }
  function text(c, str, x, y, col, s = 1, outline = '#120a18') {
    x = R(x); y = R(y);
    for (let pass = 0; pass < 2; pass++) {
      c.fillStyle = pass ? col : outline;
      if (pass === 0 && !outline) continue;
      for (let i = 0; i < str.length; i++) {
        const g = FONT[str[i]];
        if (!g) continue;
        for (let j = 0; j < 15; j++) {
          if (g[j] !== '1') continue;
          const px = x + i * 4 * s + (j % 3) * s, py = y + Math.floor(j / 3) * s;
          if (pass) c.fillRect(px, py, s, s); else c.fillRect(px - 1, py - 1, s + 2, s + 2);
        }
      }
    }
  }
  function hsl(h, s = 100, l = 62) { return `hsl(${((h % 360) + 360) % 360},${s}%,${l}%)`; }
  function mk(w, h) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d'); c.imageSmoothingEnabled = false; return [cv, c]; }

  return { rect, disc, ellipse, ring, line, tri, sprite, text, textW, hsl, mk };
})();

// ───────── 슬라임 (절차적) ─────────
function drawSlime(c, x, yb, w, h, col, o = {}) {
  const R = Math.round;
  x = R(x); yb = R(yb);
  const shape = (ww, hh, fill) => {
    for (let r = 0; r < hh; r++) {
      const t = (r + 0.5) / hh;
      let hw = (ww / 2) * Math.sqrt(Math.max(0, 1 - Math.pow(1 - t, 2.2)));
      if (r === hh - 1) hw -= 1;
      hw = Math.max(0, Math.round(hw));
      fill(r, hw, hh);
    }
  };
  const top = yb - h;
  // 외곽선
  c.fillStyle = '#140c1c';
  shape(w + 2, h + 1, (r, hw) => c.fillRect(x - hw, top - 1 + r, hw * 2 + 1, 1));
  // 본체
  const main = o.flash ? '#ffffff' : col.m, dark = o.flash ? '#ffffff' : col.d, light = o.flash ? '#ffffff' : col.l;
  shape(w, h, (r, hw, hh) => {
    c.fillStyle = r > hh * 0.72 ? dark : main;
    c.fillRect(x - hw, top + r, hw * 2 + 1, 1);
    if (r > 1 && r < hh * 0.72) { c.fillStyle = dark; c.fillRect(x + hw - 1, top + r, 1, 1); }
  });
  if (o.flash) return;
  // 하이라이트
  c.fillStyle = light;
  c.fillRect(x - R(w * 0.28), top + R(h * 0.22), 3, 2);
  c.fillRect(x - R(w * 0.28) - 1, top + R(h * 0.22) + 2, 1, 2);
  c.fillStyle = '#ffffff';
  c.fillRect(x - R(w * 0.28), top + R(h * 0.22), 1, 1);
  // 눈 (플레이어 쪽 = 왼쪽을 봄)
  const ey = top + R(h * 0.45);
  const ex = x - R(w * 0.12);
  c.fillStyle = '#140c1c';
  if (o.hurt) {
    c.fillRect(ex - 5, ey, 3, 1); c.fillRect(ex + 1, ey, 3, 1);
  } else {
    c.fillRect(ex - 5, ey - 1, 2, 3); c.fillRect(ex + 1, ey - 1, 2, 3);
    c.fillStyle = '#ffffff'; c.fillRect(ex - 5, ey - 1, 1, 1); c.fillRect(ex + 1, ey - 1, 1, 1);
  }
  c.fillStyle = '#140c1c';
  c.fillRect(ex - 2, ey + 3, 2, 1);
  if (o.crown) {
    const cx = x - 1, cy = top - 6;
    PX.sprite(c, ['K..KK..K', 'K1K11K1K', 'K111111K', 'K131131K', 'KKKKKKKK'],
      { K: '#140c1c', 1: '#ffd23f', 3: '#e8364f' }, cx - 4, cy);
  }
}
const SLIME_COLORS = [
  { m: '#5ad35a', d: '#2f8f3a', l: '#b8f5a8', name: '초록' },
  { m: '#4aa8ff', d: '#1d5aa8', l: '#b0e0ff', name: '파랑' },
  { m: '#ff7ab8', d: '#b03a78', l: '#ffd0e6', name: '분홍' },
  { m: '#a26bff', d: '#5a2fb0', l: '#dcc8ff', name: '보라' },
  { m: '#ff9a3c', d: '#b05a14', l: '#ffd8a8', name: '주황' },
  { m: '#ffd23f', d: '#b8860b', l: '#fff3b0', name: '황금' },
];

// ───────── 보물상자 (tier 0~3) ─────────
const CHEST_COLORS = [
  { w: '#8a5a2b', d: '#5c3a1a', l: '#b07a40', band: '#6b6b78', lock: '#d8d8e0' },
  { w: '#5a6370', d: '#3a414c', l: '#8a95a4', band: '#c0c8d2', lock: '#e04848' },
  { w: '#c48a12', d: '#8a5c08', l: '#ffd23f', band: '#fff3b0', lock: '#3fa9ff' },
  { w: '#3a2a7a', d: '#1e1448', l: '#8c6cf0', band: '#8ef6ff', lock: '#ff7ad9' },
];
// (x, y) = 상자 바닥 중앙, lid = 뚜껑 들림 정도(px)
function drawChest(c, x, y, tier, o = {}) {
  const C = CHEST_COLORS[tier], K = '#140c1c';
  const w = 28, bh = 12, lh = 8;
  const L = Math.round(x - w / 2), T = Math.round(y - bh);
  // 몸통
  PX.rect(c, L, T, w, bh, K);
  PX.rect(c, L + 1, T + 1, w - 2, bh - 2, C.w);
  PX.rect(c, L + 1, T + bh - 3, w - 2, 2, C.d);
  for (let i = 0; i < 3; i++) PX.rect(c, L + 2, T + 3 + i * 3, w - 4, 1, C.d);
  PX.rect(c, L + 1, T + 1, w - 2, 1, C.l);
  [4, w - 7].forEach(bx => { PX.rect(c, L + bx, T, 3, bh, K); PX.rect(c, L + bx + 1, T + 1, 1, bh - 2, C.band); });
  if (o.glow) { PX.rect(c, L + 1, T - 1, w - 2, 2, o.glow); }
  // 뚜껑
  const lift = o.lid || 0;
  if (lift < 40) {
    const lt = T - lh - lift;
    c.save();
    if (o.lidRot) { c.translate(x, lt + lh / 2); c.rotate(o.lidRot); c.translate(-x, -(lt + lh / 2)); }
    PX.rect(c, L, lt + 2, w, lh - 1, K);
    PX.rect(c, L + 2, lt, w - 4, 2, K);
    PX.rect(c, L + 1, lt + 2, w - 2, lh - 3, C.w);
    PX.rect(c, L + 3, lt + 1, w - 6, 2, C.w);
    PX.rect(c, L + 3, lt + 1, w - 6, 1, C.l);
    PX.rect(c, L + 1, lt + lh - 2, w - 2, 1, C.d);
    [4, w - 7].forEach(bx => { PX.rect(c, L + bx, lt, 3, lh, K); PX.rect(c, L + bx + 1, lt + 1, 1, lh - 2, C.band); });
    // 자물쇠
    if (!lift) {
      PX.rect(c, x - 3, lt + lh - 4, 6, 6, K);
      PX.rect(c, x - 2, lt + lh - 3, 4, 4, C.lock);
      PX.rect(c, x - 1, lt + lh - 2, 1, 2, K);
    }
    c.restore();
  }
  if (tier === 3) {
    const t = (o.time || performance.now() / 1000);
    c.fillStyle = '#ffffff';
    for (let i = 0; i < 3; i++) {
      const k = (t * 1.3 + i * 0.33) % 1;
      if (k < 0.5) c.fillRect(L + ((i * 11 + 5) % w), T - 4 + i * 5, 1, 1);
    }
  }
}
