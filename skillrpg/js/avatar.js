// ───────── 아바타: 32x48 정면 캐릭터 (캔버스 48x60, 발끝 y=57) ─────────
// 얼굴 · 의상 · 모자 · 무기 · 장식 레이어를 그린 뒤 자동 외곽선을 입힌다.
const AV_W = 48, AV_H = 60, AV_FOOT = 57;
const AV_LINE = [42, 29, 46];

function tone(h, a) {
  const n = parseInt(h.slice(1), 16), v = [n >> 16, (n >> 8) & 255, n & 255];
  return '#' + v.map(x => Math.max(0, Math.min(255, Math.round(a < 0 ? x * (1 + a) : x + (255 - x) * a)))).map(x => x.toString(16).padStart(2, '0')).join('');
}
const rc = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
// 좌우 대칭 타원 (중심선 x=cx 경계), 행 범위 제한 가능
function ell(c, cy, rx, ry, col, y0 = -99, y1 = 99, cx = 24) {
  c.fillStyle = col;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    if (y < y0 || y > y1) continue;
    const t = (y + 0.5 - cy) / ry;
    if (Math.abs(t) > 1) continue;
    const n = Math.round(rx * Math.sqrt(1 - t * t));
    if (n > 0) c.fillRect(Math.round(cx - n), y, n * 2, 1);
  }
}
const tri = (c, a, b, d, e, f, g, col) => PX.tri(c, a, b, d, e, f, g, col);
const mirror = (c, fn) => { fn(false); c.save(); c.translate(48, 0); c.scale(-1, 1); fn(true); c.restore(); };

// ── 데이터 ──
const DEF_FACE = { skin: '#f4c8a2', hair: '#3a2a2e', eye: '#4a3434', st: 0 };
const FACES = [
  { skin: '#f6c9a4', hair: '#8a5230', eye: '#5a3a2a', st: 0 },
  { skin: '#e2a578', hair: '#2a2230', eye: '#3a2a2a', st: 1 },
  { skin: '#f8d2b0', hair: '#f2c14a', eye: '#3a7ad8', st: 2 },
  { skin: '#f9dccb', hair: '#d6dbe6', eye: '#d83a3a', st: 3 },
  { skin: '#b9774e', hair: '#e8401c', eye: '#ff9a3c', st: 4 },
  { skin: '#f6d0c0', hair: '#7ee8ff', eye: '#3fe0ff', st: 5 },
];
const DEF_OUT = { top: '#efe8da', pants: '#5a6b8a', boots: '#6b4428', belt: '#7a5230', buckle: '#ffd23f' };
const OUTFITS = [
  { top: '#6aa84f', pants: '#7a6450', boots: '#6b4428', belt: '#8a5a2b', buckle: '#d8b04a', style: 'tunic' },
  { top: '#a0673a', sleeve: '#dcd2c2', pants: '#3f4a63', boots: '#6b3f1f', belt: '#4a2c14', buckle: '#c0c8d2', style: 'leather' },
  { top: '#b8c6d6', pants: '#55606e', boots: '#8a96a4', belt: '#3a4a5a', buckle: '#ffd23f', glove: '#a8b4c4', style: 'mithril' },
  { top: '#2f9e6b', pants: '#24343a', boots: '#1f6b48', belt: '#c89a2a', buckle: '#ffe066', style: 'dragon' },
  { top: '#eef1f6', pants: '#c8d0dc', boots: '#e8b830', belt: '#c89a2a', buckle: '#3fa9ff', glove: '#d8dee8', style: 'paladin', cape: '#c62839' },
  { top: '#3a2a8a', pants: '#3a2a8a', boots: '#7ee8ff', belt: '#ff7ad9', buckle: '#fff6a0', style: 'robe' },
];

// ── 머리카락 ──
function hairBack(c, F) {
  const h = F.hair, hd = tone(h, -0.25);
  if (F.st === 2) { ell(c, 24, 3.5, 8, hd, -99, 99, 37); ell(c, 22, 3, 7, h, -99, 99, 37); rc(c, 34, 16, 4, 2, '#e8364f'); }
  if (F.st === 3) { rc(c, 14, 18, 20, 17, hd); rc(c, 15, 18, 18, 16, h); }
  if (F.st === 5) { rc(c, 13, 18, 22, 26, tone(h, -0.15)); rc(c, 14, 18, 20, 25, h); rc(c, 14, 38, 20, 5, '#ff9af0'); }
}
function hairFront(c, F) {
  const h = F.hair, hd = tone(h, -0.25), hl = tone(h, 0.35), st = F.st;
  if (st === 4) {
    const tip = '#ffd23f';
    [[14, 17, 13, 8], [18, 15, 18, 4], [23, 14, 25, 2], [28, 15, 31, 4], [31, 17, 36, 8]].forEach(([x0, y0, tx, ty]) => { tri(c, x0, y0 + 2, x0 + 6, y0 + 2, tx, ty, h); tri(c, x0 + 1, y0, x0 + 4, y0, tx, ty + 1, tip); });
  }
  ell(c, 19, 11, 8.5, h, -99, st === 1 ? 20 : 19);
  const side = [27, 24, 25, 33, 25, 36][st];
  rc(c, 13, 17, 3, side - 17, h); rc(c, 32, 17, 3, side - 17, h);
  rc(c, 33, 18, 1, side - 18, hd);
  if (st === 1) rc(c, 14, 19, 20, 2, h);
  else if (st === 2) { tri(c, 14, 19, 31, 19, 15, 23, h); rc(c, 31, 19, 2, 2, h); }
  else if (st === 3) { tri(c, 14, 19, 23, 19, 15, 24, h); tri(c, 25, 19, 34, 19, 33, 24, h); }
  else [[15, 2], [19, 3], [23, 2], [27, 3], [31, 2]].forEach(([x, l]) => tri(c, x - 1, 19, x + 3, 19, x + 1, 20 + l, h));
  rc(c, 18, 12, 7, 1, hl); rc(c, 16, 13, 3, 1, hl); rc(c, 15, 14, 2, 1, hl);
  if (st === 5) { rc(c, 20, 13, 1, 1, '#ffffff'); rc(c, 30, 16, 1, 1, '#fff6a0'); rc(c, 15, 30, 1, 1, '#ffffff'); }
}
function drawHead(c, F) {
  const s = F.skin, sd = tone(s, -0.18);
  rc(c, 22, 29, 4, 3, sd);
  ell(c, 22, 9.5, 9, sd);
  ell(c, 21.7, 9.2, 8.6, s);
  rc(c, 13, 22, 1, 3, s); rc(c, 34, 22, 1, 3, sd);
  rc(c, 18, 19, 3, 1, tone(F.hair, -0.3)); rc(c, 27, 19, 3, 1, tone(F.hair, -0.3));
}
function drawFace(c, F) {
  const glow = F.st === 5;
  [19, 27].forEach(x => {
    rc(c, x, 21, 2, 4, '#2a1d2e');
    rc(c, x + 1, 23, 1, 2, F.eye);
    if (glow) rc(c, x, 23, 1, 1, F.eye);
    rc(c, x, 21, 1, 1, '#ffffff');
  });
  rc(c, 16, 26, 2, 1, '#f08a8a'); rc(c, 30, 26, 2, 1, '#f08a8a');
  rc(c, 23, 27, 2, 1, '#a8484a');
}

// ── 의상 ──
function drawOutfit(c, O, skin) {
  const T = O.top, Td = tone(T, -0.22), Tl = tone(T, 0.3), S = O.sleeve || T, Sd = tone(S, -0.22);
  const P = O.pants, Pd = tone(P, -0.25), B = O.boots, Bd = tone(B, -0.3), Bl = tone(B, 0.3);
  const st = O.style;
  // 다리 · 신발
  rc(c, 18, 44, 12, 3, P); rc(c, 18, 47, 5, 5, P); rc(c, 25, 47, 5, 5, P); rc(c, 28, 44, 2, 8, Pd);
  rc(c, 17, 52, 6, 5, B); rc(c, 25, 52, 6, 5, B); rc(c, 17, 56, 6, 1, Bd); rc(c, 25, 56, 6, 1, Bd); rc(c, 18, 53, 1, 2, Bl); rc(c, 26, 53, 1, 2, Bl);
  if (st === 'leather') { rc(c, 17, 50, 6, 2, B); rc(c, 25, 50, 6, 2, B); rc(c, 17, 50, 6, 1, Bl); rc(c, 25, 50, 6, 1, Bl); }
  if (st === 'mithril' || st === 'paladin') { rc(c, 18, 48, 5, 2, tone(P, 0.35)); rc(c, 25, 48, 5, 2, tone(P, 0.35)); }
  // 몸통 · 팔
  rc(c, 18, 31, 12, 2, T); rc(c, 17, 33, 14, 9, T); rc(c, 28, 33, 3, 9, Td); rc(c, 17, 33, 1, 9, Tl);
  rc(c, 13, 33, 4, 9, S); rc(c, 31, 33, 4, 9, S); rc(c, 16, 34, 1, 8, Sd); rc(c, 34, 33, 1, 9, Sd); rc(c, 13, 33, 1, 8, tone(S, 0.25));
  const G = O.glove || skin;
  rc(c, 13, 42, 4, 3, G); rc(c, 31, 42, 4, 3, G); rc(c, 13, 44, 4, 1, tone(G, -0.2)); rc(c, 31, 44, 4, 1, tone(G, -0.2));
  if (st === 'tunic') { rc(c, 17, 42, 14, 4, T); for (let x = 17; x < 31; x += 2) rc(c, x, 46, 1, 1, T); rc(c, 28, 42, 3, 4, Td); }
  if (st === 'robe') {
    for (let y = 42; y <= 55; y++) { const n = 7 + Math.round((y - 42) * 0.32); rc(c, 24 - n, y, n * 2, 1, T); rc(c, 24 + n - 3, y, 3, 1, Td); }
    rc(c, 15, 55, 18, 1, '#7ee8ff');
    rc(c, 12, 33, 5, 10, T); rc(c, 31, 33, 5, 10, T); rc(c, 12, 42, 5, 1, '#7ee8ff'); rc(c, 31, 42, 5, 1, '#7ee8ff');
    [[19, 35], [27, 37], [21, 47], [28, 50], [17, 52], [24, 44], [14, 37], [33, 39]].forEach(([x, y]) => rc(c, x, y, 1, 1, '#fff6a0'));
    rc(c, 23, 31, 2, 10, '#7ee8ff');
  }
  // 벨트 · 목 부분
  rc(c, 17, 41, 14, 2, O.belt); rc(c, 23, 41, 2, 2, O.buckle);
  rc(c, 22, 31, 4, 1, tone(skin, -0.18)); rc(c, 23, 32, 2, 1, tone(skin, -0.18));
  // 장식 디테일
  if (st === 'leather') {
    for (let i = 0; i < 9; i++) rc(c, 18 + i, 33 + i, 2, 1, '#4a2c14');
    rc(c, 11, 31, 7, 4, '#7a4a26'); rc(c, 30, 31, 7, 4, '#7a4a26'); rc(c, 12, 31, 5, 1, '#a8703a'); rc(c, 31, 31, 5, 1, '#a8703a');
  }
  if (st === 'mithril') {
    for (let y = 33; y < 41; y += 2) for (let x = 18 + (y % 4 === 1 ? 1 : 0); x < 30; x += 2) rc(c, x, y, 1, 1, Td);
    rc(c, 22, 33, 4, 11, '#3a6fd8'); rc(c, 22, 33, 1, 11, '#5a8ff0'); rc(c, 22, 43, 4, 1, '#ffd23f');
  }
  if (st === 'dragon') {
    for (let y = 34; y < 41; y += 3) for (let x = 18 + ((y / 3) % 2 ? 1 : 0); x < 29; x += 3) { rc(c, x, y, 2, 1, Td); rc(c, x - 1, y - 1, 1, 1, Td); }
    tri(c, 11, 34, 16, 34, 12, 27, '#ffd23f'); tri(c, 32, 34, 37, 34, 36, 27, '#ffd23f'); rc(c, 11, 33, 6, 2, '#1f7a52'); rc(c, 31, 33, 6, 2, '#1f7a52');
  }
  if (st === 'paladin') {
    rc(c, 17, 33, 14, 1, '#e8b830'); rc(c, 23, 34, 2, 6, '#c62839'); rc(c, 21, 36, 6, 2, '#c62839');
    ell(c, 33, 4, 3, '#ffffff', -99, 99, 15); ell(c, 33, 4, 3, '#ffffff', -99, 99, 33); rc(c, 11, 34, 8, 1, '#e8b830'); rc(c, 29, 34, 8, 1, '#e8b830');
  }
}
function drawCape(c, col) { rc(c, 14, 31, 20, 24, tone(col, -0.2)); rc(c, 15, 31, 18, 23, col); }

// ── 모자 ──
function drawHat(c, r) {
  if (r === 0) {
    rc(c, 14, 14, 20, 5, '#c0392b'); rc(c, 14, 14, 20, 1, '#e86b5c'); rc(c, 14, 18, 20, 1, '#8a2418');
    [17, 22, 27, 31].forEach(x => rc(c, x, 16, 1, 1, '#f5d76e'));
    tri(c, 33, 15, 39, 12, 38, 17, '#c0392b'); tri(c, 33, 17, 38, 21, 36, 23, '#a8301f');
  } else if (r === 1) {
    rc(c, 22, 3, 4, 8, '#e04848'); tri(c, 21, 6, 27, 6, 20, 1, '#ff6a5a');
    ell(c, 19, 11.5, 9, '#9aa4b1', -99, 18); rc(c, 26, 11, 6, 7, '#7a838f');
    rc(c, 23, 10, 2, 9, '#d9e1ea'); rc(c, 12, 17, 24, 3, '#6a7380'); rc(c, 12, 17, 24, 1, '#c0c8d2');
    rc(c, 12, 20, 3, 6, '#7a838f'); rc(c, 33, 20, 3, 6, '#7a838f');
  } else if (r === 2) {
    tri(c, 14, 15, 34, 15, 30, 0, '#3b4fc4'); tri(c, 25, 15, 34, 15, 30, 0, '#2a3a9a');
    tri(c, 30, 0, 37, 3, 31, 4, '#3b4fc4');
    ell(c, 16, 16, 2.5, '#232f7a'); ell(c, 15.5, 15, 1.6, '#3b4fc4');
    rc(c, 17, 12, 15, 2, '#f4d35e');
    rc(c, 22, 6, 1, 3, '#ffe66d'); rc(c, 21, 7, 3, 1, '#ffe66d'); rc(c, 27, 9, 2, 1, '#ffe66d'); rc(c, 26, 8, 1, 1, '#ffe66d');
  } else if (r === 3) {
    tri(c, 15, 15, 19, 12, 7, 2, '#e8d9a8'); tri(c, 33, 15, 29, 12, 41, 2, '#e8d9a8'); tri(c, 11, 9, 14, 9, 7, 2, '#c8b888'); tri(c, 37, 9, 34, 9, 41, 2, '#c8b888');
    ell(c, 19, 11.5, 9, '#4a4458', -99, 18); rc(c, 27, 11, 6, 7, '#363042'); rc(c, 18, 12, 6, 1, '#7a7290');
    rc(c, 12, 17, 24, 3, '#2a2533'); rc(c, 23, 17, 2, 7, '#2a2533'); rc(c, 12, 20, 3, 6, '#363042'); rc(c, 33, 20, 3, 6, '#363042');
  } else if (r === 4) {
    [[15, 13], [20, 13], [25, 13], [30, 13]].forEach(([x, y]) => tri(c, x, y, x + 4, y, x + 2, y - 7, '#ffd23f'));
    rc(c, 15, 12, 18, 5, '#ffd23f'); rc(c, 15, 12, 18, 1, '#fff3b0'); rc(c, 15, 16, 18, 1, '#c48a12');
    [17, 22, 27, 32].forEach(x => rc(c, x, 5, 1, 2, '#e8364f')); rc(c, 23, 13, 2, 2, '#3fa9ff'); rc(c, 18, 14, 1, 1, '#e8364f'); rc(c, 29, 14, 1, 1, '#e8364f');
  } else if (r === 5) {
    rc(c, 16, 13, 16, 2, '#8ef6ff'); rc(c, 16, 13, 16, 1, '#ffffff');
    tri(c, 22, 13, 26, 13, 24, 6, '#bff8ff'); tri(c, 17, 13, 20, 13, 18, 9, '#8ef6ff'); tri(c, 28, 13, 31, 13, 30, 9, '#8ef6ff');
    rc(c, 23, 10, 2, 2, '#ff7ad9');
  }
}

// ── 무기 (오른손 x31~34, y42~44) ──
function drawWeapon(c, r) {
  c.save(); c.translate(3, 0);
  drawWeaponAt(c, r);
  c.restore();
}
function drawWeaponAt(c, r) {
  if (r === 0) {
    rc(c, 32, 42, 2, 5, '#5a3a22'); rc(c, 30, 40, 6, 2, '#8a5a2b');
    rc(c, 32, 27, 2, 13, '#c89a5a'); rc(c, 32, 27, 1, 13, '#e0b878'); rc(c, 32, 26, 1, 1, '#c89a5a');
  } else if (r === 1) {
    rc(c, 32, 42, 2, 5, '#3a2a3a'); rc(c, 32, 47, 2, 1, '#ffd23f'); rc(c, 29, 40, 8, 2, '#ffd23f'); rc(c, 29, 40, 8, 1, '#fff3b0');
    rc(c, 31, 24, 4, 16, '#d8e0ea'); rc(c, 33, 25, 1, 15, '#a8b4c4'); rc(c, 31, 24, 1, 16, '#ffffff'); tri(c, 31, 24, 35, 24, 33, 20, '#d8e0ea');
  } else if (r === 2) {
    rc(c, 32, 21, 2, 33, '#8a5a2b'); rc(c, 32, 21, 1, 33, '#a8703a');
    rc(c, 30, 20, 1, 4, '#6b3f1f'); rc(c, 35, 20, 1, 4, '#6b3f1f');
    ell(c, 17.5, 3, 3, '#3fa9ff', -99, 99, 33); rc(c, 31, 16, 1, 1, '#ffffff'); rc(c, 32, 17, 1, 1, '#bfe4ff');
  } else if (r === 3) {
    rc(c, 32, 14, 2, 40, '#a8261a'); rc(c, 32, 14, 1, 40, '#d8423a');
    tri(c, 30, 15, 36, 15, 33, 3, '#d8e0ea'); rc(c, 33, 6, 1, 8, '#ffffff'); rc(c, 30, 15, 6, 2, '#ffd23f'); rc(c, 31, 17, 1, 3, '#ffd23f'); rc(c, 34, 17, 1, 3, '#ffd23f');
  } else if (r === 4) {
    rc(c, 32, 42, 3, 5, '#6b3f1f'); rc(c, 31, 47, 4, 2, '#ffd23f');
    rc(c, 27, 39, 12, 3, '#ffd23f'); rc(c, 27, 39, 12, 1, '#fff3b0'); rc(c, 32, 39, 2, 2, '#3fa9ff');
    rc(c, 30, 19, 6, 20, '#fff8e0'); rc(c, 30, 19, 1, 20, '#ffd23f'); rc(c, 35, 19, 1, 20, '#e8b830'); rc(c, 33, 20, 1, 18, '#ffe9a0');
    tri(c, 30, 19, 36, 19, 33, 13, '#fff8e0');
  } else if (r === 5) {
    rc(c, 32, 22, 2, 32, '#5a3fb0'); rc(c, 32, 22, 1, 32, '#7a5fd0'); [28, 36, 44].forEach(y => rc(c, 31, y, 4, 1, '#ff7ad9'));
    ell(c, 15, 6, 6, '#8ef6ff', -99, 99, 33); c.save(); c.globalCompositeOperation = 'destination-out'; ell(c, 13.5, 5, 5, '#000', -99, 99, 35); c.restore();
    rc(c, 34, 14, 1, 3, '#fff6a0'); rc(c, 33, 15, 3, 1, '#fff6a0');
  }
}

// ── 장식 ──
function accBack(c, r) {
  if (r === 1) { rc(c, 14, 31, 20, 24, '#1d4fa8'); rc(c, 15, 31, 18, 23, '#2f6fd8'); }
  if (r === 2) mirror(c, () => { tri(c, 18, 33, 3, 20, 7, 38, '#ff9ac0'); tri(c, 17, 34, 7, 24, 9, 35, '#ffd0e6'); tri(c, 18, 38, 8, 46, 16, 47, '#9ad0ff'); });
  if (r === 3) mirror(c, () => {
    tri(c, 18, 32, 1, 18, 5, 42, '#4a2a6a'); tri(c, 5, 42, 9, 37, 11, 44, '#4a2a6a'); tri(c, 11, 44, 13, 39, 17, 44, '#4a2a6a');
    PX.line(c, 18, 32, 2, 19, '#2a1838'); PX.line(c, 9, 25, 9, 38, '#2a1838');
  });
  if (r === 4) mirror(c, () => {
    tri(c, 18, 31, 1, 15, 4, 44, '#d8e4f0'); tri(c, 18, 32, 3, 17, 7, 42, '#ffffff');
    tri(c, 8, 40, 13, 36, 12, 47, '#ffffff'); tri(c, 13, 41, 17, 37, 16, 47, '#e8eef8');
    PX.line(c, 17, 32, 4, 19, '#c8d4e4'); PX.line(c, 16, 34, 4, 28, '#c8d4e4'); PX.line(c, 15, 36, 5, 36, '#c8d4e4');
    rc(c, 2, 16, 2, 2, '#ffe9a0'); rc(c, 3, 42, 2, 2, '#ffe9a0');
  });
  if (r === 5) mirror(c, () => {
    tri(c, 18, 32, 0, 14, 4, 44, '#2a1a6a'); tri(c, 17, 33, 3, 18, 6, 40, '#5a3fb0'); tri(c, 16, 34, 6, 24, 8, 37, '#8c6cf0');
    [[6, 26], [9, 33], [5, 37], [11, 29]].forEach(([x, y]) => rc(c, x, y, 1, 1, '#fff6a0'));
  });
}
function accFront(c, r) {
  if (r === 0) { rc(c, 18, 29, 12, 4, '#e8364f'); rc(c, 18, 29, 12, 1, '#ff8a9a'); rc(c, 18, 33, 4, 9, '#c62839'); rc(c, 18, 41, 1, 2, '#c62839'); rc(c, 20, 41, 1, 2, '#c62839'); rc(c, 21, 33, 1, 8, '#a01a30'); }
  if (r === 1) { rc(c, 17, 30, 14, 2, '#ffd23f'); rc(c, 23, 31, 2, 2, '#e8364f'); }
}
function drawGlow(c, eq, only) {
  const show = p => !only || only === p;
  c.save();
  if (show('head') && eq.head && eq.head.r === 5) { c.globalAlpha = 0.9; ell(c, 4, 9, 2.6, '#fff6a0'); c.globalCompositeOperation = 'destination-out'; ell(c, 4, 7, 1.4, '#000'); }
  c.restore(); c.save();
  if (show('weapon') && eq.weapon) {
    const r = eq.weapon.r;
    if (r === 2) { c.globalAlpha = 0.35; ell(c, 17.5, 5, 5, '#8fd0ff', -99, 99, 36); }
    if (r === 4) { c.globalAlpha = 0.9; [[32, 11], [41, 16], [31, 27], [42, 31]].forEach(([x, y]) => { rc(c, x, y - 1, 1, 3, '#fff3b0'); rc(c, x - 1, y, 3, 1, '#fff3b0'); }); }
    if (r === 5) { c.globalAlpha = 0.9; [[32, 9], [41, 12], [39, 22], [31, 19]].forEach(([x, y]) => rc(c, x, y, 1, 1, '#ffffff')); }
  }
  if (show('acc') && eq.acc && eq.acc.r >= 4) { c.globalAlpha = 0.6; [[4, 22], [44, 24], [2, 36], [45, 38], [7, 46], [41, 47]].forEach(([x, y]) => rc(c, x, y, 1, 1, eq.acc.r === 5 ? '#ff9af0' : '#fff3b0')); }
  c.restore();
}

// 외곽선: 불투명 픽셀 옆의 빈 픽셀을 진한 색으로
function outline(c, w, h) {
  const img = c.getImageData(0, 0, w, h), d = img.data, out = new Uint8ClampedArray(d);
  const A = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 128;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (d[i + 3] > 0) continue;
    if (A(x - 1, y) || A(x + 1, y) || A(x, y - 1) || A(x, y + 1)) { out[i] = AV_LINE[0]; out[i + 1] = AV_LINE[1]; out[i + 2] = AV_LINE[2]; out[i + 3] = 255; }
  }
  c.putImageData(new ImageData(out, w, h), 0, 0);
}

// eq: { face, body, head, weapon, acc } (아이템 또는 null), only: 한 부위만 그리기
function renderAvatar(eq, only) {
  const [cv, c] = PX.mk(AV_W, AV_H);
  const show = p => !only || only === p;
  const F = eq.face ? FACES[eq.face.r] : DEF_FACE, O = eq.body ? OUTFITS[eq.body.r] : DEF_OUT;
  const headOn = show('face') || show('head');
  if (show('acc') && eq.acc) accBack(c, eq.acc.r);
  if (show('body') && O.cape) drawCape(c, O.cape);
  if (headOn && !only) hairBack(c, F);
  if (only === 'face') hairBack(c, F);
  if (show('body')) drawOutfit(c, O, F.skin);
  if (headOn) { drawHead(c, F); hairFront(c, F); drawFace(c, F); }
  if (show('head') && eq.head) drawHat(c, eq.head.r);
  if (show('acc') && eq.acc) accFront(c, eq.acc.r);
  if (show('weapon') && eq.weapon) { drawWeapon(c, eq.weapon.r); if (!only) { const G = O.glove || F.skin; rc(c, 31, 43, 4, 2, G); } }
  outline(c, AV_W, AV_H);
  drawGlow(c, eq, only);
  return cv;
}
function buildPlayerSprite(eq) { return renderAvatar(eq); }

// 내용이 있는 영역만 잘라낸 캔버스
function cropCanvas(src) {
  const c = src.getContext('2d'), { width: w, height: h } = src, d = c.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return src;
  const [cv, g] = PX.mk(x1 - x0 + 1, y1 - y0 + 1);
  g.drawImage(src, -x0, -y0);
  return cv;
}
function gearIcon(g) { return cropCanvas(renderAvatar({ [g.slot]: g }, g.slot)); }
// 정수 배율 우선으로 상자 안에 맞춤
function fitIcon(cv, bw, bh = bw) {
  let k = Math.min(bw / cv.width, bh / cv.height);
  k = k >= 2 ? Math.floor(k) : Math.max(1, k);
  cv.style.width = Math.round(cv.width * k) + 'px'; cv.style.height = Math.round(cv.height * k) + 'px';
  cv.className = 'px-icon';
  return cv;
}
