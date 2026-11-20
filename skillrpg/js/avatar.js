// ───────── 아바타: 큰 머리 2등신 캐릭터 (캔버스 64x80, 발끝 y=77) ─────────
// 얼굴 · 의상 · 모자 · 무기 · 장식 레이어 → 자동 외곽선. 명암은 "어두운 색 위에 밝은 색을 한 칸 비껴 그리기"로 부드럽게.
const AV_W = 64, AV_H = 80, AV_FOOT = 77;
const AV_LINE = [42, 29, 46];

function tone(h, a) {
  const n = parseInt(h.slice(1), 16), v = [n >> 16, (n >> 8) & 255, n & 255];
  return '#' + v.map(x => Math.max(0, Math.min(255, Math.round(a < 0 ? x * (1 + a) : x + (255 - x) * a)))).map(x => x.toString(16).padStart(2, '0')).join('');
}
const rc = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
function ell(c, cy, rx, ry, col, y0 = -99, y1 = 99, cx = 32) {
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
const mirror = (c, fn) => { fn(); c.save(); c.translate(AV_W, 0); c.scale(-1, 1); fn(); c.restore(); };
const cutout = (c, fn) => { c.save(); c.globalCompositeOperation = 'destination-out'; fn(); c.restore(); };

const DEF_FACE = { skin: '#f6cfae', hair: '#4a3436', eye: '#5a3e3a', st: 0 };
const FACES = [
  { skin: '#f8d0ae', hair: '#9a5a32', eye: '#6a4430', st: 0 },
  { skin: '#e6ab80', hair: '#2a2432', eye: '#3a2a2a', st: 1 },
  { skin: '#fad8b8', hair: '#f4c24a', eye: '#3a7ad8', st: 2 },
  { skin: '#fbe0d0', hair: '#d8dde8', eye: '#d84a5a', st: 3 },
  { skin: '#c0805a', hair: '#e8401c', eye: '#ff9a3c', st: 4 },
  { skin: '#f8d6c8', hair: '#7ee8ff', eye: '#3fd8ff', st: 5 },
];
const DEF_OUT = { top: '#f2ece0', pants: '#5a6b8a', boots: '#7a4a2a', belt: '#7a5230', buckle: '#ffd23f' };
const OUTFITS = [
  { top: '#6aa84f', pants: '#7a6450', boots: '#7a4a2a', belt: '#8a5a2b', buckle: '#d8b04a', style: 'tunic' },
  { top: '#a8703e', sleeve: '#e2d8c6', pants: '#3f4a63', boots: '#6b3f1f', belt: '#4a2c14', buckle: '#c0c8d2', style: 'leather' },
  { top: '#b8c6d6', pants: '#55606e', boots: '#8a96a4', belt: '#3a4a5a', buckle: '#ffd23f', glove: '#a8b4c4', style: 'mithril' },
  { top: '#2f9e6b', pants: '#24343a', boots: '#1f6b48', belt: '#c89a2a', buckle: '#ffe066', style: 'dragon' },
  { top: '#eef1f6', pants: '#c8d0dc', boots: '#e8b830', belt: '#c89a2a', buckle: '#3fa9ff', glove: '#d8dee8', style: 'paladin', cape: '#c62839' },
  { top: '#3a2a8a', pants: '#3a2a8a', boots: '#7ee8ff', belt: '#ff7ad9', buckle: '#fff6a0', style: 'robe' },
];

// ── 머리카락 ──
const SIDE_END = [42, 35, 36, 54, 35, 56];
function hairBack(c, F) {
  const h = F.hair, hd = tone(h, -0.28);
  if (F.st === 0) rc(c, 17, 28, 30, 15, hd);
  if (F.st === 2) { ell(c, 38, 5, 13, hd, -99, 99, 52); ell(c, 37, 4, 12, h, -99, 99, 51); rc(c, 47, 25, 6, 3, '#e8364f'); }
  if (F.st === 3) { rc(c, 16, 28, 32, 31, hd); rc(c, 17, 28, 29, 30, h); tri(c, 16, 58, 48, 58, 32, 63, hd); }
  if (F.st === 5) { rc(c, 15, 28, 34, 37, tone(h, -0.2)); rc(c, 16, 28, 31, 36, h); rc(c, 16, 59, 31, 6, '#ff9af0'); [[19, 46], [43, 52], [22, 57]].forEach(([x, y]) => rc(c, x, y, 1, 1, '#ffffff')); }
}
function hairFront(c, F) {
  const h = F.hair, hd = tone(h, -0.28), hl = tone(h, 0.38), st = F.st, end = SIDE_END[st];
  if (st === 4) [[15, 22, 8, 6], [21, 18, 16, 1], [28, 16, 29, -1], [35, 16, 42, 0], [41, 18, 49, 3], [45, 22, 56, 9]].forEach(([x, y, tx, ty]) => {
    tri(c, x, y + 5, x + 9, y + 5, tx, ty, h); tri(c, x + 2, y + 3, x + 6, y + 3, tx, ty + 2, '#ff8a1f'); tri(c, x + 3, y + 1, x + 5, y + 1, tx, ty + 1, '#ffd23f');
  });
  ell(c, 28, 16.5, 14, hd, -99, 27);
  ell(c, 27.5, 16, 13.5, h, -99, 27, 31);
  rc(c, 15, 24, 5, end - 24, h); rc(c, 44, 24, 5, end - 24, hd); rc(c, 15, 24, 1, end - 24, hl);
  if (st === 1) { rc(c, 17, 25, 30, 5, h); rc(c, 17, 29, 30, 1, hd); }
  else if (st === 2) { tri(c, 17, 25, 46, 25, 18, 33, h); rc(c, 44, 25, 3, 4, h); }
  else if (st === 3) { tri(c, 17, 25, 31, 25, 18, 34, h); tri(c, 33, 25, 47, 25, 46, 34, hd); }
  else {
    rc(c, 18, 25, 28, 3, h);
    [20, 30, 34, 44].forEach(x => tri(c, x - 3, 27, x + 3, 27, x, 31, x > 32 ? hd : h));
    [25, 39].forEach(x => tri(c, x - 2, 27, x + 2, 27, x, 29, h));
  }
  rc(c, 23, 17, 9, 1, hl); rc(c, 20, 18, 4, 1, hl); rc(c, 18, 19, 3, 1, hl); rc(c, 35, 17, 2, 1, hl);
  if (st === 5) { rc(c, 26, 15, 1, 1, '#ffffff'); rc(c, 40, 20, 1, 1, '#fff6a0'); rc(c, 16, 40, 1, 1, '#ffffff'); }
}
function drawHead(c, F) {
  const s = F.skin, sd = tone(s, -0.16);
  rc(c, 29, 42, 6, 5, sd);
  ell(c, 31, 14.5, 13.5, sd);
  ell(c, 30.5, 14, 13, s, -99, 99, 31);
  rc(c, 21, 24, 6, 1, tone(s, 0.35));
}
function drawFace(c, F) {
  [[23, 0], [37, 1]].forEach(([x, right]) => {
    rc(c, x, 29, 4, 7, '#2a1d2e');
    rc(c, right ? x + 4 : x - 1, 29, 1, 2, '#2a1d2e');
    rc(c, x, 32, 4, 3, F.eye); rc(c, x, 34, 4, 1, tone(F.eye, 0.4));
    rc(c, x, 30, 2, 2, '#ffffff'); rc(c, x + 3, 33, 1, 1, '#ffffff');
    if (F.st === 5) rc(c, x + 1, 35, 2, 1, '#bff8ff');
  });
  rc(c, 19, 37, 4, 2, '#f4a8a0'); rc(c, 41, 37, 4, 2, '#f4a8a0');
  rc(c, 30, 38, 1, 1, '#a8484a'); rc(c, 31, 39, 2, 1, '#a8484a'); rc(c, 33, 38, 1, 1, '#a8484a');
}

// ── 의상 ──
function drawOutfit(c, O, skin) {
  const T = O.top, Td = tone(T, -0.22), Tl = tone(T, 0.32), S = O.sleeve || T, Sd = tone(S, -0.22);
  const P = O.pants, Pd = tone(P, -0.25), B = O.boots, Bd = tone(B, -0.32), Bl = tone(B, 0.32), st = O.style;
  rc(c, 24, 61, 16, 4, P); rc(c, 24, 65, 7, 6, P); rc(c, 33, 65, 7, 6, P); rc(c, 37, 61, 3, 10, Pd); rc(c, 29, 65, 2, 6, Pd);
  [23, 33].forEach(x => { rc(c, x, 70, 8, 7, B); rc(c, x, 76, 8, 1, Bd); rc(c, x + 6, 70, 2, 6, Bd); rc(c, x + 1, 71, 2, 3, Bl); });
  if (st === 'leather') [23, 33].forEach(x => { rc(c, x, 67, 8, 3, B); rc(c, x, 67, 8, 1, Bl); });
  if (st === 'mithril' || st === 'paladin') [24, 33].forEach(x => rc(c, x, 66, 7, 2, tone(P, 0.4)));
  rc(c, 25, 46, 14, 2, T); rc(c, 23, 48, 18, 13, T); rc(c, 36, 48, 5, 13, Td); rc(c, 23, 48, 1, 12, Tl);
  rc(c, 18, 47, 5, 12, S); rc(c, 41, 47, 5, 12, S); rc(c, 18, 47, 1, 12, tone(S, 0.28)); rc(c, 45, 47, 1, 12, Sd); rc(c, 22, 48, 1, 11, Sd);
  const G = O.glove || skin;
  [18, 41].forEach(x => { rc(c, x, 59, 5, 4, G); rc(c, x, 62, 5, 1, tone(G, -0.2)); });
  if (st === 'tunic') { rc(c, 23, 61, 18, 4, T); rc(c, 36, 61, 5, 4, Td); for (let x = 23; x < 41; x += 3) tri(c, x, 65, x + 3, 65, x + 1.5, 67, x > 35 ? Td : T); }
  if (st === 'robe') {
    for (let y = 60; y <= 75; y++) { const n = 9 + Math.round((y - 60) * 0.35); rc(c, 32 - n, y, n * 2, 1, T); rc(c, 32 + n - 4, y, 4, 1, Td); }
    rc(c, 18, 75, 28, 1, '#7ee8ff');
    rc(c, 16, 47, 7, 13, T); rc(c, 41, 47, 7, 13, T); rc(c, 16, 59, 7, 1, '#7ee8ff'); rc(c, 41, 59, 7, 1, '#7ee8ff');
    [[26, 50], [36, 53], [27, 64], [37, 67], [22, 71], [32, 60], [19, 51], [44, 55], [40, 72]].forEach(([x, y]) => rc(c, x, y, 1, 1, '#fff6a0'));
    rc(c, 31, 46, 2, 14, '#7ee8ff');
  }
  rc(c, 23, 59, 18, 3, O.belt); rc(c, 30, 59, 4, 3, O.buckle); rc(c, 31, 60, 2, 1, tone(O.buckle, -0.35));
  rc(c, 29, 46, 6, 1, tone(skin, -0.16)); rc(c, 30, 47, 4, 1, tone(skin, -0.16)); rc(c, 31, 48, 2, 1, tone(skin, -0.16));
  if (st === 'leather') {
    for (let i = 0; i < 11; i++) rc(c, 25 + i, 48 + i, 2, 1, '#4a2c14');
    ell(c, 47, 5, 3, '#7a4a26', -99, 99, 20); ell(c, 47, 5, 3, '#7a4a26', -99, 99, 44); rc(c, 16, 45, 8, 1, '#b07a44'); rc(c, 40, 45, 8, 1, '#b07a44');
  }
  if (st === 'mithril') {
    for (let y = 49; y < 58; y += 2) for (let x = 24 + (y % 4 === 3 ? 1 : 0); x < 40; x += 2) rc(c, x, y, 1, 1, Td);
    rc(c, 29, 48, 6, 18, '#3a6fd8'); rc(c, 29, 48, 1, 18, '#5a8ff0'); rc(c, 29, 65, 6, 1, '#ffd23f');
  }
  if (st === 'dragon') {
    for (let y = 50; y < 58; y += 3) for (let x = 25 + ((y / 3) % 2 ? 2 : 0); x < 38; x += 4) { rc(c, x, y, 3, 1, Td); rc(c, x - 1, y - 1, 1, 1, Td); }
    tri(c, 15, 49, 22, 49, 17, 40, '#ffd23f'); tri(c, 42, 49, 49, 49, 47, 40, '#ffd23f'); rc(c, 15, 47, 8, 3, '#1f7a52'); rc(c, 41, 47, 8, 3, '#1f7a52');
  }
  if (st === 'paladin') {
    rc(c, 23, 48, 18, 1, '#e8b830'); rc(c, 31, 49, 2, 9, '#c62839'); rc(c, 28, 51, 8, 2, '#c62839');
    [20, 44].forEach(x => { ell(c, 48, 6, 4, '#c8d0dc', -99, 99, x); ell(c, 47.5, 5.5, 3.5, '#ffffff', -99, 99, x); }); rc(c, 14, 49, 12, 1, '#e8b830'); rc(c, 38, 49, 12, 1, '#e8b830');
  }
}
function drawCape(c, col) { rc(c, 19, 46, 26, 29, tone(col, -0.22)); rc(c, 20, 46, 24, 28, col); }

// ── 모자 ──
function drawHat(c, r) {
  if (r === 0) {
    rc(c, 15, 19, 34, 7, '#c0392b'); rc(c, 15, 19, 34, 1, '#e86b5c'); rc(c, 15, 25, 34, 1, '#8a2418');
    [19, 25, 31, 37, 43].forEach(x => rc(c, x, 22, 1, 1, '#f5d76e'));
    tri(c, 47, 20, 57, 15, 56, 23, '#c0392b'); tri(c, 47, 23, 56, 28, 52, 31, '#a8301f');
  } else if (r === 1) {
    rc(c, 30, 4, 4, 10, '#e04848'); tri(c, 29, 8, 35, 8, 28, 1, '#ff6a5a');
    ell(c, 27, 17.5, 14, '#6e7884', -99, 25); ell(c, 26.5, 17, 13.5, '#9aa4b1', -99, 25, 31);
    rc(c, 31, 13, 2, 11, '#d9e1ea'); rc(c, 14, 23, 36, 4, '#5e6672'); rc(c, 14, 23, 36, 1, '#c0c8d2');
    rc(c, 14, 27, 4, 11, '#7a838f'); rc(c, 46, 27, 4, 11, '#5e6672');
  } else if (r === 2) {
    ell(c, 21, 24, 3.5, '#232f7a'); ell(c, 20.5, 23, 2.6, '#3b4fc4');
    tri(c, 19, 20, 46, 20, 44, 0, '#3b4fc4'); tri(c, 35, 20, 46, 20, 44, 0, '#2a3a9a');
    tri(c, 44, 0, 54, 4, 45, 6, '#3b4fc4');
    rc(c, 24, 15, 21, 3, '#f4d35e'); rc(c, 24, 15, 21, 1, '#fff3b0');
    [[31, 9], [38, 5]].forEach(([x, y]) => { rc(c, x, y - 1, 1, 3, '#ffe66d'); rc(c, x - 1, y, 3, 1, '#ffe66d'); });
  } else if (r === 3) {
    tri(c, 18, 22, 24, 17, 5, 1, '#e8d9a8'); tri(c, 46, 22, 40, 17, 59, 1, '#e8d9a8'); tri(c, 13, 13, 18, 13, 5, 1, '#c8b888'); tri(c, 51, 13, 46, 13, 59, 1, '#c8b888');
    ell(c, 27, 17.5, 14, '#2e2838', -99, 25); ell(c, 26.5, 17, 13.5, '#4a4458', -99, 25, 31); rc(c, 22, 16, 8, 1, '#7a7290');
    rc(c, 14, 23, 36, 4, '#2a2533'); rc(c, 31, 23, 2, 9, '#2a2533'); rc(c, 14, 27, 4, 11, '#363042'); rc(c, 46, 27, 4, 11, '#2a2533');
  } else if (r === 4) {
    [20, 26, 32, 38].forEach(x => { tri(c, x, 13, x + 6, 13, x + 3, 4, '#ffd23f'); rc(c, x + 2, 6, 2, 2, '#e8364f'); });
    rc(c, 20, 12, 24, 7, '#ffd23f'); rc(c, 20, 12, 24, 1, '#fff3b0'); rc(c, 20, 18, 24, 1, '#c48a12'); rc(c, 38, 13, 6, 5, '#e8b830');
    rc(c, 30, 14, 4, 3, '#3fa9ff'); rc(c, 23, 15, 2, 2, '#e8364f'); rc(c, 39, 15, 2, 2, '#e8364f');
  } else if (r === 5) {
    rc(c, 20, 17, 24, 3, '#8ef6ff'); rc(c, 20, 17, 24, 1, '#ffffff');
    tri(c, 29, 17, 35, 17, 32, 7, '#bff8ff'); tri(c, 22, 17, 26, 17, 24, 11, '#8ef6ff'); tri(c, 38, 17, 42, 17, 40, 11, '#8ef6ff');
    rc(c, 31, 12, 2, 3, '#ff7ad9');
  }
}

// ── 무기 (오른손 옆 x46~49) ──
function drawWeapon(c, r) {
  if (r === 0) {
    rc(c, 46, 36, 4, 21, '#c89a5a'); rc(c, 46, 36, 1, 21, '#e0b878'); rc(c, 47, 35, 2, 1, '#c89a5a');
    rc(c, 43, 57, 10, 2, '#8a5a2b'); rc(c, 46, 59, 4, 6, '#5a3a22');
  } else if (r === 1) {
    rc(c, 46, 30, 4, 27, '#d8e0ea'); rc(c, 46, 30, 1, 27, '#ffffff'); rc(c, 49, 31, 1, 26, '#a8b4c4'); tri(c, 46, 30, 50, 30, 48, 24, '#d8e0ea');
    rc(c, 42, 57, 12, 2, '#ffd23f'); rc(c, 42, 57, 12, 1, '#fff3b0'); rc(c, 46, 59, 4, 6, '#3a2a3a'); rc(c, 46, 65, 4, 2, '#ffd23f');
  } else if (r === 2) {
    rc(c, 47, 27, 3, 49, '#8a5a2b'); rc(c, 47, 27, 1, 49, '#b07a44');
    rc(c, 44, 23, 1, 6, '#6b3f1f'); rc(c, 52, 23, 1, 6, '#6b3f1f');
    ell(c, 22, 4.5, 4.5, '#2a7ad8', -99, 99, 48.5); ell(c, 21.5, 3.6, 3.6, '#3fa9ff', -99, 99, 48); rc(c, 46, 19, 2, 1, '#ffffff'); rc(c, 46, 20, 1, 1, '#bfe4ff');
  } else if (r === 3) {
    rc(c, 47, 16, 3, 60, '#a8261a'); rc(c, 47, 16, 1, 60, '#d8423a');
    tri(c, 44, 18, 53, 18, 48.5, 2, '#d8e0ea'); rc(c, 48, 5, 1, 12, '#ffffff'); rc(c, 44, 18, 9, 3, '#ffd23f'); rc(c, 45, 21, 1, 4, '#ffd23f'); rc(c, 51, 21, 1, 4, '#ffd23f');
  } else if (r === 4) {
    rc(c, 45, 22, 7, 35, '#fff8e0'); rc(c, 45, 22, 1, 35, '#ffd23f'); rc(c, 51, 22, 1, 35, '#e8b830'); rc(c, 48, 24, 1, 31, '#ffe9a0');
    tri(c, 45, 22, 52, 22, 48.5, 14, '#fff8e0');
    rc(c, 40, 57, 17, 3, '#ffd23f'); rc(c, 40, 57, 17, 1, '#fff3b0'); rc(c, 47, 57, 3, 3, '#3fa9ff'); rc(c, 46, 60, 5, 6, '#6b3f1f'); rc(c, 45, 66, 7, 2, '#ffd23f');
  } else if (r === 5) {
    rc(c, 47, 26, 3, 50, '#5a3fb0'); rc(c, 47, 26, 1, 50, '#7a5fd0'); [37, 51, 65].forEach(y => rc(c, 46, y, 5, 1, '#ff7ad9'));
    ell(c, 19, 7, 7, '#8ef6ff', -99, 99, 48); cutout(c, () => ell(c, 17, 6, 6, '#000', -99, 99, 51));
    rc(c, 50, 15, 1, 5, '#fff6a0'); rc(c, 48, 17, 5, 1, '#fff6a0');
  }
}

// ── 장식 ──
function accBack(c, r) {
  if (r === 1) { rc(c, 19, 46, 26, 29, '#1d4fa8'); rc(c, 20, 46, 24, 28, '#2f6fd8'); }
  if (r === 2) mirror(c, () => { tri(c, 24, 50, 3, 32, 9, 57, '#ff9ac0'); tri(c, 23, 51, 9, 37, 12, 55, '#ffd0e6'); tri(c, 24, 56, 9, 67, 21, 68, '#9ad0ff'); rc(c, 9, 41, 2, 2, '#ffffff'); });
  if (r === 3) mirror(c, () => {
    tri(c, 24, 49, 1, 26, 6, 60, '#4a2a6a'); tri(c, 6, 60, 12, 53, 15, 63, '#4a2a6a'); tri(c, 15, 63, 19, 56, 23, 63, '#4a2a6a');
    PX.line(c, 24, 49, 2, 27, '#2a1838'); PX.line(c, 12, 36, 12, 55, '#2a1838');
  });
  if (r === 4) mirror(c, () => {
    tri(c, 24, 48, 1, 23, 5, 62, '#d8e4f0'); tri(c, 24, 49, 3, 27, 9, 60, '#ffffff');
    tri(c, 10, 58, 17, 52, 16, 67, '#ffffff'); tri(c, 17, 59, 23, 53, 22, 67, '#e8eef8');
    PX.line(c, 23, 49, 4, 28, '#c8d4e4'); PX.line(c, 22, 52, 4, 41, '#c8d4e4'); PX.line(c, 21, 55, 6, 53, '#c8d4e4');
  });
  if (r === 5) mirror(c, () => {
    tri(c, 24, 48, 0, 19, 5, 63, '#2a1a6a'); tri(c, 23, 49, 3, 26, 8, 59, '#5a3fb0'); tri(c, 22, 51, 8, 34, 11, 56, '#8c6cf0');
    [[8, 34], [12, 44], [6, 50], [15, 39]].forEach(([x, y]) => rc(c, x, y, 1, 1, '#fff6a0'));
  });
}
function accFront(c, r) {
  if (r === 0) { rc(c, 24, 44, 16, 4, '#e8364f'); rc(c, 24, 44, 16, 1, '#ff8a9a'); rc(c, 25, 48, 5, 12, '#c62839'); rc(c, 29, 48, 1, 11, '#a01a30'); [25, 27, 29].forEach(x => rc(c, x, 60, 1, 2, '#c62839')); }
  if (r === 1) { rc(c, 23, 46, 18, 2, '#ffd23f'); rc(c, 30, 46, 4, 3, '#e8364f'); }
}
function drawGlow(c, eq, only) {
  const show = p => !only || only === p;
  c.save();
  if (show('head') && eq.head && eq.head.r === 5) { c.globalAlpha = 0.9; ell(c, 5, 12, 3, '#fff6a0'); cutout(c, () => ell(c, 5, 9.5, 1.6, '#000')); }
  c.restore(); c.save();
  if (show('weapon') && eq.weapon) {
    const r = eq.weapon.r;
    if (r === 2) { c.globalAlpha = 0.35; ell(c, 22, 7, 7, '#8fd0ff', -99, 99, 48.5); }
    if (r === 4) { c.globalAlpha = 0.9; [[42, 16], [56, 22], [41, 36], [57, 42]].forEach(([x, y]) => { rc(c, x, y - 1, 1, 3, '#fff3b0'); rc(c, x - 1, y, 3, 1, '#fff3b0'); }); }
    if (r === 5) { c.globalAlpha = 0.9; [[40, 10], [57, 13], [56, 28], [41, 26]].forEach(([x, y]) => rc(c, x, y, 1, 1, '#ffffff')); }
  }
  if (show('acc') && eq.acc && eq.acc.r >= 4) { c.globalAlpha = 0.7; [[4, 30], [59, 32], [2, 48], [61, 50], [8, 64], [55, 65]].forEach(([x, y]) => rc(c, x, y, 1, 1, eq.acc.r === 5 ? '#ff9af0' : '#fff3b0')); }
  c.restore();
}

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

// eq: { face, body, head, weapon, acc } / only: 한 부위만 (아이콘용)
function renderAvatar(eq, only) {
  const [cv, c] = PX.mk(AV_W, AV_H);
  const show = p => !only || only === p;
  const F = eq.face ? FACES[eq.face.r] : DEF_FACE, O = eq.body ? OUTFITS[eq.body.r] : DEF_OUT;
  const headOn = show('face') || show('head');
  if (show('acc') && eq.acc) accBack(c, eq.acc.r);
  if (show('body') && O.cape) drawCape(c, O.cape);
  if (show('face')) hairBack(c, F);
  if (show('body')) drawOutfit(c, O, F.skin);
  if (headOn) { drawHead(c, F); hairFront(c, F); drawFace(c, F); }
  if (show('head') && eq.head) drawHat(c, eq.head.r);
  if (show('acc') && eq.acc) accFront(c, eq.acc.r);
  if (show('weapon') && eq.weapon) { drawWeapon(c, eq.weapon.r); if (!only) { const G = O.glove || F.skin; rc(c, 43, 59, 5, 4, G); rc(c, 43, 62, 5, 1, tone(G, -0.2)); } }
  outline(c, AV_W, AV_H);
  drawGlow(c, eq, only);
  return cv;
}
function buildPlayerSprite(eq) { return renderAvatar(eq); }

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
function fitIcon(cv, bw, bh = bw) {
  let k = Math.min(bw / cv.width, bh / cv.height);
  k = k >= 2 ? Math.floor(k) : Math.max(1, k);
  cv.style.width = Math.round(cv.width * k) + 'px'; cv.style.height = Math.round(cv.height * k) + 'px';
  cv.className = 'px-icon';
  return cv;
}
