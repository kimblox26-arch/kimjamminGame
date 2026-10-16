// 게임 화면 그리기 도구 (scene.js 가 사용)
// - 바닥 텍스처, 벽(윗면 + 높이 있는 앞벽), 소품, 콘솔, 환풍구, 문, 배경, 크루원(캔버스 Path2D)
// - 정적인 맵은 512px 타일(오프스크린 캔버스)에 한 번만 그려 두고 매 프레임 복사만 한다.
import { inPoly } from '../shared/maps/index.js';
import { BODY, DEAD, BACK, legsD, bobY, ghostD, GHOST_MAIN, pal, VISOR, cosmeticSVG, COS_BOX, SKINS, PETS } from '../ui/crew.js';

export const TAU = Math.PI * 2;
export const FACE_H = 150;          // 위쪽 벽면(앞벽) 높이
export const CAP = 42;              // 벽 윗면 두께
export const CREW_SC = 1.3;         // 크루원 몸 좌표 → 월드 단위
export const VENT_W = 124, VENT_H = 72;
export const FONT = '"Pretendard","Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",system-ui,sans-serif';
const OL = '#14181c';               // 외곽선
const OUTDOOR = new Set(['snow', 'dirt', 'grass', 'sand', 'rock']);

// ---------- 공용 도구 ----------
export const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
export function rng(seed) { let s = (Math.imul(seed | 0, 2654435761) >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
export const hash2 = (x, y = 0) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const rgbOf = c => {
  if (typeof c === 'string' && c[0] === '#') {
    if (c.length === 4) return [1, 2, 3].map(i => parseInt(c[i] + c[i], 16));
    if (c.length >= 7) return [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  }
  const m = typeof c === 'string' && c.match(/rgba?\((\d+)\D+(\d+)\D+(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : [128, 128, 128];
};
// k>0 밝게, k<0 어둡게
export const shade = (c, k) => { const [r, g, b] = rgbOf(c), t = k > 0 ? 255 : 0, a = Math.min(1, Math.abs(k)); return `rgb(${(r + (t - r) * a) | 0},${(g + (t - g) * a) | 0},${(b + (t - b) * a) | 0})`; };
export const rgba = (c, a) => { const [r, g, b] = rgbOf(c); return `rgba(${r},${g},${b},${a})`; };
export const lerp = (a, b, k) => a + (b - a) * k;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const ease = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const bbox = pts => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; };
export const polyPath = (g, pts, dx = 0, dy = 0) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy))); g.closePath(); };
const ell = (g, x, y, rx, ry, rot = 0) => { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); };
const rr = (g, x, y, w, h, r) => {
  g.beginPath();
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
};
const fillOL = (g, fill, lw = 5, ol = OL) => { g.fillStyle = fill; g.fill(); if (lw) { g.lineWidth = lw; g.strokeStyle = ol; g.stroke(); } };
const shadowEll = (g, x, y, rx, ry, a = 0.26) => { ell(g, x, y, rx, ry); g.fillStyle = `rgba(0,0,0,${a})`; g.fill(); };
const lgrad = (g, x0, y0, x1, y1, stops) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
const rgrad = (g, x, y, r0, r1, stops, fx = x, fy = y) => { const gr = g.createRadialGradient(fx, fy, r0, x, y, r1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
const line = (g, x0, y0, x1, y1, w, c) => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineWidth = w; g.strokeStyle = c; g.stroke(); };
// 2.5D 상자: 바닥 사각형 (x,y,w,h), 높이 hh. 윗면은 위로 hh 만큼 올라감
function box3(g, x, y, w, h, hh, top, front, lw = 5) {
  const fh = Math.min(hh, h + hh);
  g.beginPath(); g.rect(x, y + h - fh, w, fh); fillOL(g, front, lw);
  rr(g, x, y - hh, w, h, 6); fillOL(g, top, lw);
}

// ---------- 바닥 텍스처 ----------
const TEXS = 2; // 텍스처 픽셀 / 월드 단위
function rivet(g, x, y, r, base) {
  ell(g, x + 0.6, y + 0.8, r, r); g.fillStyle = shade(base, -0.45); g.fill();
  ell(g, x, y, r, r); g.fillStyle = shade(base, 0.1); g.fill();
  ell(g, x - r * 0.3, y - r * 0.3, r * 0.4, r * 0.4); g.fillStyle = shade(base, 0.45); g.fill();
}
function brushed(g, S, n, seed, a = 0.04) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    g.strokeStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    g.lineWidth = 0.6 + r() * 1.6; const y = 3 + r() * (S - 6), x = r() * S * 0.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + S * (0.2 + r() * 0.4), y); g.stroke();
  }
}
function speck(g, S, n, cols, seed, smax = 2) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) { g.globalAlpha = 0.05 + r() * 0.1; g.fillStyle = cols[i % cols.length]; const s = 0.5 + r() * smax; g.fillRect(r() * (S - s), r() * (S - s), s, s); }
  g.globalAlpha = 1;
}
function blobs(g, S, n, cols, seed, rmin, rmax, a = 0.12) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * S, y = r() * S, rad = rmin + r() * (rmax - rmin), c = cols[i % cols.length];
    // 이음새가 생기지 않도록 가장자리 근처는 반대편에도 그림
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      if (x + ox < -rad || x + ox > S + rad || y + oy < -rad || y + oy > S + rad) continue;
      g.fillStyle = rgrad(g, x + ox, y + oy, 0, rad, [[0, rgba(c, a)], [1, rgba(c, 0)]]);
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
}
function plate(g, x, y, w, h, base, bevel = 0.14) {
  g.fillStyle = base; g.fillRect(x, y, w, h);
  g.fillStyle = shade(base, bevel); g.fillRect(x, y, w, 2.2); g.fillRect(x, y, 2.2, h);
  g.fillStyle = shade(base, -bevel * 1.5); g.fillRect(x, y + h - 2.6, w, 2.6); g.fillRect(x + w - 2.6, y, 2.6, h);
  g.fillStyle = shade(base, -0.5); g.fillRect(x, y + h - 0.9, w, 0.9); g.fillRect(x + w - 0.9, y, 0.9, h);
}
function checker(g, S, n, a, b, grout, gw = 1.6, bevel = 0.09) {
  const t = S / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) plate(g, i * t, j * t, t, t, (i + j) % 2 ? b : a, bevel);
  if (grout) { g.fillStyle = grout; for (let k = 0; k <= n; k++) { g.fillRect(k * t - gw / 2, 0, gw, S); g.fillRect(0, k * t - gw / 2, S, gw); } }
}
const FLOOR_TEX = {
  metal: [120, (g, S) => { plate(g, 0, 0, S, S, '#88939b'); brushed(g, S, 30, 3); for (const [x, y] of [[10, 10], [S - 10, 10], [10, S - 10], [S - 10, S - 10]]) rivet(g, x, y, 2.6, '#88939b'); }],
  metalDark: [120, (g, S) => { plate(g, 0, 0, S, S, '#4e575e'); brushed(g, S, 30, 5, 0.05); for (const [x, y] of [[10, 10], [S - 10, 10], [10, S - 10], [S - 10, S - 10]]) rivet(g, x, y, 2.6, '#4e575e'); }],
  hall: [100, (g, S) => {
    plate(g, 0, 0, S, S, '#717c83', 0.12); brushed(g, S, 26, 7, 0.035);
    for (const y of [S * 0.33, S * 0.66]) { g.fillStyle = 'rgba(0,0,0,.13)'; g.fillRect(6, y, S - 12, 1.6); g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(6, y + 1.6, S - 12, 1); }
    rivet(g, 8, 8, 2.2, '#717c83'); rivet(g, S - 8, S - 8, 2.2, '#717c83');
  }],
  cafe: [200, (g, S) => { checker(g, S, 2, '#a3aeb6', '#96a2ab', '#7f8a93', 2.2, 0.08); speck(g, S, 160, ['#ffffff', '#55606a'], 11, 1.2); }],
  med: [100, (g, S) => { checker(g, S, 2, '#b2d0dc', '#a4c3d0', '#e4f3f8', 1.8, 0.06); speck(g, S, 60, ['#ffffff'], 13, 1); }],
  admin: [120, (g, S) => { checker(g, S, 2, '#7f9585', '#768b7c', '#5d7064', 1.8, 0.08); brushed(g, S, 14, 17, 0.03); }],
  storage: [80, (g, S) => {
    g.fillStyle = '#8b8373'; g.fillRect(0, 0, S, S);
    const t = S / 4;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = i * t + t / 2, y = j * t + t / 2, ang = (i + j) % 2 ? 0.7 : -0.7;
      g.save(); g.translate(x, y); g.rotate(ang);
      rr(g, -7, -2.2, 14, 4.4, 2.2); g.fillStyle = '#a39b8a'; g.fill(); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(-7, 1.2, 14, 1.2);
      g.restore();
    }
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, S - 1.5, S, 1.5); g.fillRect(S - 1.5, 0, 1.5, S);
  }],
  elec: [100, (g, S) => {
    plate(g, 0, 0, S, S, '#69746c', 0.1); brushed(g, S, 20, 19, 0.04);
    g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(S / 2 - 0.8, 0, 1.6, S); g.fillRect(0, S / 2 - 0.8, S, 1.6);
    for (const [x, y] of [[S / 2, S / 2], [6, 6]]) rivet(g, x, y, 2, '#69746c');
  }],
  eng: [100, (g, S) => {
    plate(g, 0, 0, S, S, '#7b858b', 0.12);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 2; i++) { rr(g, 10 + i * 42, 10 + j * 17.5, 36, 8, 4); g.fillStyle = '#3f474c'; g.fill(); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(12 + i * 42, 18 + j * 17.5, 32, 1.2); }
  }],
  reactor: [120, (g, S) => {
    plate(g, 0, 0, S, S, '#5c6979', 0.12);
    for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) { ell(g, 10 + i * 20, 10 + j * 20, 4.2, 4.2); g.fillStyle = '#2f3843'; g.fill(); ell(g, 10 + i * 20 + 0.8, 10 + j * 20 + 1, 2.4, 2.4); g.fillStyle = '#1f262e'; g.fill(); }
  }],
  white: [120, (g, S) => { checker(g, S, 2, '#e5eaf0', '#dce2e9', '#c2cbd4', 1.6, 0.05); speck(g, S, 40, ['#9aa7b4'], 23, 1); }],
  tile: [80, (g, S) => { checker(g, S, 4, '#cfd8de', '#c8d2d8', '#a9b5bd', 1.4, 0.05); }],
  lab: [120, (g, S) => {
    g.fillStyle = '#cbd7e2'; g.fillRect(0, 0, S, S); blobs(g, S, 6, ['#ffffff', '#9fb4c6'], 29, 20, 50, 0.12);
    g.fillStyle = '#a5b6c6'; for (const k of [0, S / 2]) { g.fillRect(k - 0.8, 0, 1.6, S); g.fillRect(0, k - 0.8, S, 1.6); }
    for (const [x, y] of [[0, 0], [S / 2, 0], [0, S / 2], [S / 2, S / 2]]) { ell(g, x + 0.01, y + 0.01, 2.6, 2.6); g.fillStyle = '#5a9bd4'; g.fill(); }
  }],
  greenhouse: [100, (g, S) => {
    checker(g, S, 2, '#7fa66f', '#779e68', '#5b7e50', 1.6, 0.08);
    for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(30,50,25,.35)'; g.fillRect(8 + i * 22, S / 2 - 18, 10, 36); }
  }],
  wood: [240, (g, S) => {
    const r = rng(31), ph = 40;
    for (let j = 0; j < S / ph; j++) {
      const off = j % 2 ? S / 2 : 0;
      for (let k = -1; k < 2; k++) {
        const x = off + k * S / 2 * 2, base = ['#9c6b3f', '#a1714a', '#94623a', '#a77a4d'][(j + k + 4) % 4];
        g.fillStyle = base; g.fillRect(x, j * ph, S, ph);
        g.strokeStyle = 'rgba(60,30,10,.18)'; g.lineWidth = 1;
        for (let q = 0; q < 4; q++) { const y = j * ph + 6 + q * 8 + r() * 3; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + S * 0.3, y + r() * 4 - 2, x + S * 0.6, y + r() * 4 - 2, x + S, y); g.stroke(); }
        g.fillStyle = 'rgba(40,20,5,.55)'; g.fillRect(x, j * ph, 1.6, ph);
      }
      g.fillStyle = 'rgba(40,20,5,.5)'; g.fillRect(0, j * ph + ph - 2, S, 2); g.fillStyle = 'rgba(255,230,190,.12)'; g.fillRect(0, j * ph, S, 1.4);
      for (const x of [12, S / 2 + 12]) { ell(g, (x + (j % 2 ? S / 2 : 0)) % S, j * ph + ph / 2, 1.6, 1.6); g.fillStyle = '#4a2c14'; g.fill(); }
    }
  }],
  carpet: [120, (g, S) => {
    g.fillStyle = '#8c2b31'; g.fillRect(0, 0, S, S); speck(g, S, 300, ['#5e1a1f', '#b0444b'], 37, 1.4);
    g.strokeStyle = 'rgba(214,170,80,.7)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(S / 2, 0); g.lineTo(S, S / 2); g.lineTo(S / 2, S); g.lineTo(0, S / 2); g.closePath(); g.stroke();
    ell(g, S / 2, S / 2, 6, 6); g.fillStyle = 'rgba(214,170,80,.8)'; g.fill();
    for (const [x, y] of [[0, 0], [S, 0], [0, S], [S, S]]) { ell(g, x, y, 4, 4); g.fill(); }
  }],
  ship: [120, (g, S) => {
    plate(g, 0, 0, S, S, '#8e979c', 0.14); brushed(g, S, 24, 41, 0.04);
    g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(S / 2 - 0.8, 4, 1.6, S - 8);
    for (const [x, y] of [[8, 8], [S - 8, 8], [8, S - 8], [S - 8, S - 8]]) rivet(g, x, y, 2.4, '#8e979c');
  }],
  snow: [256, (g, S) => { g.fillStyle = '#e8eff7'; g.fillRect(0, 0, S, S); blobs(g, S, 18, ['#c9d6e6', '#ffffff', '#b8c7da'], 43, 18, 60, 0.35); speck(g, S, 220, ['#9fb1c8', '#ffffff'], 47, 1.8); }],
  dirt: [200, (g, S) => {
    g.fillStyle = '#8a6a4b'; g.fillRect(0, 0, S, S); blobs(g, S, 16, ['#6e533a', '#a3825f'], 53, 14, 46, 0.4);
    const r = rng(59); for (let i = 0; i < 26; i++) { const x = r() * S, y = r() * S, s = 1.5 + r() * 3; ell(g, x, y, s * 1.3, s); g.fillStyle = r() < 0.5 ? '#6b5a49' : '#a89a87'; g.fill(); }
    speck(g, S, 200, ['#4d3a28', '#b39472'], 61, 1.6);
  }],
  grass: [200, (g, S) => {
    g.fillStyle = '#4d8a3a'; g.fillRect(0, 0, S, S); blobs(g, S, 14, ['#3d7230', '#62a24a'], 67, 16, 50, 0.45);
    const r = rng(71);
    for (let i = 0; i < 260; i++) { const x = r() * S, y = r() * S, h = 3 + r() * 6; g.strokeStyle = r() < 0.5 ? 'rgba(120,190,90,.55)' : 'rgba(30,70,25,.45)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - h); g.stroke(); }
  }],
  sand: [240, (g, S) => {
    g.fillStyle = '#e1c991'; g.fillRect(0, 0, S, S); blobs(g, S, 12, ['#cdb177', '#efdcae'], 73, 20, 60, 0.4);
    g.strokeStyle = 'rgba(160,125,70,.22)'; g.lineWidth = 1.4;
    for (let j = 0; j < 8; j++) { const y = j * S / 8 + 10; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= S; x += 20) g.quadraticCurveTo(x + 10, y + (j % 2 ? 4 : -4), x + 20, y); g.stroke(); }
    speck(g, S, 240, ['#a88b55', '#fff3d0'], 79, 1.4);
  }],
  rock: [200, (g, S) => {
    g.fillStyle = '#7b7368'; g.fillRect(0, 0, S, S); blobs(g, S, 16, ['#5f584f', '#968d80'], 83, 16, 50, 0.45);
    const r = rng(89); g.strokeStyle = 'rgba(40,35,30,.4)'; g.lineWidth = 1.2;
    for (let i = 0; i < 10; i++) { let x = r() * S, y = r() * S; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
    speck(g, S, 160, ['#3d3832', '#b5ab9c'], 97, 1.6);
  }],
};
const texCache = new Map();
let patCtx = null;
export function floorPattern(key) {
  if (!FLOOR_TEX[key]) key = 'metal';
  let p = texCache.get(key);
  if (!p) {
    const [S, paint] = FLOOR_TEX[key], c = mk(S * TEXS, S * TEXS), g = c.getContext('2d');
    g.scale(TEXS, TEXS); paint(g, S);
    patCtx ||= mk(2, 2).getContext('2d');
    p = patCtx.createPattern(c, 'repeat');
    p.setTransform(new DOMMatrix([1 / TEXS, 0, 0, 1 / TEXS, 0, 0]));
    texCache.set(key, p);
  }
  return p;
}
export const FLOOR_KEYS = Object.keys(FLOOR_TEX);

// ---------- 벽 모양 ----------
// 실내 벽은 맵 theme 색, 야외 바닥은 자연 지형(절벽/수풀/해안)
function wallStyle(floor, theme) {
  const wall = theme.wall || '#3b4449', top = theme.wallTop || '#5b676d', face = theme.wallFace || '#48535a';
  switch (floor) {
    case 'snow': return { k: 'snowcliff', H: 110, cap: 52, out: '#3a4256', mass: '#59627a', top: '#f3f7fc', rim: '#ffffff', face: '#6f7891' };
    case 'grass': return { k: 'hedge', H: 125, cap: 58, out: '#0f2410', mass: '#1d3d1b', top: '#2f6b29', rim: '#4b9a3d', face: '#24521f' };
    case 'dirt': return { k: 'cliff', H: 105, cap: 50, out: '#2a211b', mass: '#4a3d33', top: '#6f5d4b', rim: '#8d7861', face: '#5a4a3d' };
    case 'rock': return { k: 'cliff', H: 115, cap: 50, out: '#24211f', mass: '#46413b', top: '#6c655b', rim: '#8a8277', face: '#56504a' };
    case 'sand': return { k: 'shore', H: 0, cap: 64, out: 'rgba(0,0,0,0)', mass: '#c9ad75', top: '#bfa06a', rim: '#f4fbff', face: '#bfa06a' };
    default: return { k: 'wall', H: theme.faceH || FACE_H, cap: CAP, out: '#090b0d', mass: shade(wall, -0.32), top: wall, rim: top, face };
  }
}

// ---------- 맵 분석 (한 번만) ----------
// 걸을 수 있는 영역(방+복도 합집합)의 바깥 경계를 따라 벽 사슬(chain)을 만든다.
export function prepMap(m) {
  if (m._art) return m._art;
  const theme = m.theme || {};
  const polys = [...(m.halls || []).map(h => ({ poly: h.poly, floor: h.floor || 'hall', hall: true })), ...(m.rooms || []).map(r => ({ poly: r.poly, floor: r.floor || 'metal', id: r.id }))]
    .filter(p => p.poly?.length > 2);
  for (const p of polys) p.bb = bbox(p.poly);
  const walkAt = (x, y) => polys.some(p => x >= p.bb[0] && x <= p.bb[2] && y >= p.bb[1] && y <= p.bb[3] && inPoly(x, y, p.poly));
  const chains = [];
  for (const P of polys) {
    const pts = P.poly, n = pts.length, local = [];
    let cur = null;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n], L = Math.hypot(bx - ax, by - ay);
      if (L < 0.5) continue;
      let nx = (by - ay) / L, ny = -(bx - ax) / L;
      if (inPoly((ax + bx) / 2 + nx * 2, (ay + by) / 2 + ny * 2, pts)) { nx = -nx; ny = -ny; }
      const k = Math.max(1, Math.round(L / 12)), fl = [];
      for (let j = 0; j < k; j++) { const t = (j + 0.5) / k; fl.push(!walkAt(ax + (bx - ax) * t + nx * 5, ay + (by - ay) * t + ny * 5)); }
      let j = 0;
      while (j < k) {
        if (!fl[j]) { cur = null; j++; continue; }
        let e = j; while (e < k && fl[e]) e++;
        const p0 = [ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k], p1 = [ax + ((bx - ax) * e) / k, ay + ((by - ay) * e) / k];
        if (cur && j === 0) { cur.pts.push(p1); cur.n.push([nx, ny]); }
        else { cur = { pts: [p0, p1], n: [[nx, ny]], floor: P.floor, head: i === 0 && j === 0 }; local.push(cur); }
        if (e < k) cur = null;
        j = e;
      }
    }
    // 다각형 처음/끝에서 끊긴 사슬 잇기
    const last = local[local.length - 1], first = local[0];
    if (last && cur === last && first?.head) {
      const a = last.pts[last.pts.length - 1], b = first.pts[0];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1) {
        if (first === last) last.closed = true;
        else { last.pts.push(...first.pts.slice(1)); last.n.push(...first.n); local.shift(); }
      }
    }
    chains.push(...local);
  }
  const styles = new Map();
  for (const c of chains) {
    c.st = wallStyle(c.floor, theme);
    const k = c.st.k + (c.st.k === 'wall' ? '' : c.floor);
    if (!styles.has(k)) styles.set(k, { st: c.st, chains: [] });
    styles.get(k).chains.push(c);
    const b = bbox(c.pts); c.bb = [b[0] - c.st.cap - 12, b[1] - c.st.H - c.st.cap - 12, b[2] + c.st.cap + 12, b[3] + c.st.cap + 12];
    // 경계 조각(면 그리기·그림자용)
    c.segs = c.n.map(([nx, ny], i) => ({ ax: c.pts[i][0], ay: c.pts[i][1], bx: c.pts[i + 1][0], by: c.pts[i + 1][1], nx, ny }));
  }
  // 위쪽 벽면(앞벽) 조각 → 시야 계산 때 벽면도 밝혀 주기 위한 마스크
  const faces = new Path2D(), faceSegs = [];
  for (const c of chains) if (c.st.H > 0) for (const s of c.segs) if (s.ny < -0.3) {
    faceSegs.push({ ...s, H: c.st.H, st: c.st });
    faces.moveTo(s.ax, s.ay + 4); faces.lineTo(s.bx, s.by + 4); faces.lineTo(s.bx, s.by - c.st.H - 2); faces.lineTo(s.ax, s.ay - c.st.H - 2); faces.closePath();
  }
  const props = (m.props || []).map((p, i) => ({ ...p, i, b: propBox(p) }));
  for (const p of props) { p.tall = !!p.block && !FLAT.has(p.kind); p.sb = spriteBounds(p); p.key = sortKey(p); }
  const art = {
    map: m, theme, polys, walkAt, chains, styles: [...styles.values()], faces, faceSegs,
    props, tall: props.filter(p => p.tall), flat: props.filter(p => !p.tall),
    bounds: [-400, -400, (m.w || 4000) + 400, (m.h || 3000) + 400],
  };
  art.consoles = buildConsoles(art);
  art.overlays = buildOverlays(art);
  return (m._art = art);
}
// 북쪽 벽(아래를 바라보는 벽면) 찾기: x 에서 y 바로 위쪽 벽 y
export function wallAbove(art, x, y, maxD = 260) {
  let best = null;
  for (const s of art.faceSegs) {
    const x0 = Math.min(s.ax, s.bx), x1 = Math.max(s.ax, s.bx);
    if (x < x0 + 20 || x > x1 - 20) continue;
    const t = (x - s.ax) / ((s.bx - s.ax) || 1), wy = s.ay + (s.by - s.ay) * t;
    if (wy <= y + 5 && y - wy < maxD && (!best || wy > best.y)) best = { y: wy, s };
  }
  return best;
}

// ---------- 소품 ----------
// 원(r) 또는 사각형(x,y,w,h). block 소품은 높이가 있어 플레이어와 y 순서로 그림(스프라이트 캐시)
const FLAT = new Set(['rug', 'water', 'lava', 'stairs', 'ladder', 'window', 'scanner', 'hexPanel', 'bed', 'chair', 'zipline']);
export function propBox(p) {
  if (p.r) return { x: p.x - p.r, y: p.y - p.r, w: p.r * 2, h: p.r * 2, cx: p.x, cy: p.y, r: p.r, round: true };
  const w = p.w || 80, h = p.h || 80;
  return { x: p.x, y: p.y, w, h, cx: p.x + w / 2, cy: p.y + h / 2, r: Math.min(w, h) / 2 };
}
function spriteBounds(p) {
  const b = p.b, d = PROPS[p.kind] || PROPS._;
  let up = d.up ? d.up(b, p) : Math.max(50, b.r * 0.6), mx = 34 + b.w * 0.1, my = 34;
  if (p.rot) { const e = Math.max(b.w, b.h) * 0.3; mx += e; my += e; up += e; }
  return [b.x - mx, b.y - up - my, b.x + b.w + mx, b.y + b.h + my];
}
function sortKey(p) { const b = p.b, d = PROPS[p.kind]; return d?.key ? d.key(b) : b.round ? b.cy + b.r * 0.35 : b.y + b.h * 0.72; }
function withRot(g, p, b, fn) {
  if (!p.rot) return fn();
  g.save(); g.translate(b.cx, b.cy); g.rotate((p.rot * Math.PI) / 180); g.translate(-b.cx, -b.cy); fn(); g.restore();
}
export function drawPropUnder(g, p, art) { const d = PROPS[p.kind] || PROPS._; if (d.under) withRot(g, p, p.b, () => d.under(g, p, p.b, art)); }
export function drawPropBody(g, p, art) { const d = PROPS[p.kind] || PROPS._; g.lineJoin = 'round'; g.lineCap = 'round'; withRot(g, p, p.b, () => d.draw(g, p, p.b, art)); }
const screenGlow = (g, x, y, w, h, c = '#3fd6c0') => { rr(g, x, y, w, h, 4); g.fillStyle = lgrad(g, x, y, x, y + h, [[0, shade(c, 0.25)], [1, shade(c, -0.35)]]); g.fill(); g.lineWidth = 3; g.strokeStyle = OL; g.stroke(); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x + 4, y + 4, w * 0.4, 3); };
const leafBall = (g, x, y, r, c, seed = 1) => {
  const R = rng(seed);
  const pts = [];
  for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + R() * 0.4; pts.push([x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.55, r * (0.45 + R() * 0.15)]); }
  g.beginPath(); for (const [px, py, pr] of pts) { g.moveTo(px + pr, py); g.arc(px, py, pr, 0, TAU); } g.moveTo(x + r * 0.6, y); g.arc(x, y, r * 0.6, 0, TAU);
  g.lineWidth = 10; g.strokeStyle = OL; g.stroke(); g.fillStyle = c; g.fill();
  for (const [px, py, pr] of pts.slice(0, 4)) { ell(g, px - pr * 0.25, py - pr * 0.3, pr * 0.45, pr * 0.32); g.fillStyle = shade(c, 0.22); g.fill(); }
};
const PROPS = {
  table: {
    up: b => 30,
    under(g, p, b) {
      const { cx, cy, r } = b;
      shadowEll(g, cx, cy + r * 0.25, r * 1.3, r * 1.05, 0.2);
      g.lineCap = 'butt';
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        g.beginPath(); g.arc(cx, cy + 8, r + 46, a - 0.43, a + 0.43);
        g.strokeStyle = OL; g.lineWidth = 50; g.stroke();
        g.strokeStyle = '#3b5778'; g.lineWidth = 40; g.stroke();
        g.beginPath(); g.arc(cx, cy + 2, r + 46, a - 0.41, a + 0.41); g.strokeStyle = '#5c80a8'; g.lineWidth = 26; g.stroke();
        g.beginPath(); g.arc(cx, cy - 2, r + 40, a - 0.36, a + 0.36); g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 4; g.stroke();
      }
    },
    draw(g, p, b) {
      const { cx, cy, r } = b, col = p.color || '#90a8c2';
      ell(g, cx, cy + 22, r * 0.45, r * 0.2); g.fillStyle = 'rgba(0,0,0,.35)'; g.fill();
      ell(g, cx, cy + 16, r, r * 0.96); fillOL(g, shade(col, -0.42), 6);
      ell(g, cx, cy, r, r * 0.96);
      g.fillStyle = rgrad(g, cx, cy, r * 0.1, r, [[0, shade(col, 0.22)], [0.75, col], [1, shade(col, -0.1)]], cx - r * 0.35, cy - r * 0.4); g.fill();
      g.lineWidth = 6; g.strokeStyle = OL; g.stroke();
      ell(g, cx, cy, r * 0.82, r * 0.79); g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = 3; g.stroke();
      g.beginPath(); g.arc(cx, cy, r * 0.9, Math.PI * 1.05, Math.PI * 1.45); g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 5; g.stroke();
    },
  },
  engine: {
    up: b => b.r * 0.7,
    under(g, p, b) { shadowEll(g, b.cx + b.r * 0.08, b.cy + b.r * 0.62, b.r * 1.2, b.r * 0.45, 0.32); },
    draw(g, p, b) {
      const { cx, cy, r } = b, col = p.color || '#8d989f';
      const x0 = cx - r * 0.82, x1 = cx + r * 1.02, yT = cy - r * 1.05, yB = cy + r * 0.62;
      rr(g, cx - r * 0.55, yB - 24, r * 1.25, 34, 8); fillOL(g, '#394146');
      // 위 배관
      for (const [ox, w] of [[0.1, 22], [0.45, 30]]) { rr(g, x0 + r * 0.3, yT - 18 + ox * 40, (x1 - x0) * 0.7, w, w / 2); fillOL(g, lgrad(g, 0, yT - 18 + ox * 40, 0, yT - 18 + ox * 40 + w, [[0, '#a6b0b6'], [1, '#5b656b']]), 4); }
      // 본체 원통
      rr(g, x0, yT, x1 - x0, yB - yT, r * 0.42);
      g.fillStyle = lgrad(g, 0, yT, 0, yB, [[0, shade(col, 0.3)], [0.4, col], [0.6, shade(col, -0.18)], [1, shade(col, -0.5)]]); g.fill(); g.lineWidth = 7; g.strokeStyle = OL; g.stroke();
      for (const t of [0.3, 0.55, 0.8]) {
        const x = lerp(x0, x1, t);
        g.fillStyle = shade(col, -0.32); g.fillRect(x - 9, yT + 5, 18, yB - yT - 10);
        g.fillStyle = shade(col, 0.32); g.fillRect(x - 9, yT + 5, 4, yB - yT - 10);
      }
      // 경고 패널
      rr(g, x1 - r * 0.42, cy - r * 0.2, r * 0.3, r * 0.42, 6); fillOL(g, '#2f363b', 4);
      g.save(); g.clip();
      for (let i = -6; i < 8; i++) { g.beginPath(); g.moveTo(x1 - r * 0.42 + i * 14, cy - r * 0.2); g.lineTo(x1 - r * 0.42 + i * 14 + 30, cy + r * 0.22); g.lineWidth = 6; g.strokeStyle = i % 2 ? '#f2c230' : '#22262a'; g.stroke(); }
      g.restore();
      // 배기구
      const ex = x0 + r * 0.06, ey = (yT + yB) / 2;
      ell(g, ex, ey, r * 0.34, r * 0.74); fillOL(g, '#2a3034', 7);
      ell(g, ex - 6, ey, r * 0.24, r * 0.6); g.fillStyle = rgrad(g, ex - 6, ey, 2, r * 0.6, [[0, '#fff4c8'], [0.3, '#ffb53a'], [0.7, '#e2541c'], [1, '#4a1508']]); g.fill();
      ell(g, ex - 6, ey, r * 0.24, r * 0.6); g.lineWidth = 4; g.strokeStyle = '#1a1d20'; g.stroke();
      g.beginPath(); g.arc(ex + 8, ey, r * 0.28, -1.2, 1.2); g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 4; g.stroke();
    },
  },
  reactorCore: {
    up: b => b.r * 1.1,
    under(g, p, b) { shadowEll(g, b.cx, b.cy + b.r * 0.35, b.r * 1.15, b.r * 0.7, 0.3); },
    draw(g, p, b) {
      const { cx, cy, r } = b;
      // 팔각 받침
      const oct = (rad, dy) => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + Math.PI / 8; g.lineTo(cx + Math.cos(a) * rad, cy + dy + Math.sin(a) * rad * 0.8); } g.closePath(); };
      oct(r * 1.02, 26); fillOL(g, '#262d35', 6);
      oct(r * 1.02, 0); fillOL(g, lgrad(g, 0, cy - r, 0, cy + r, [[0, '#6c7a88'], [1, '#3c4652']]), 6);
      // 배관
      for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + Math.PI / 4; line(g, cx, cy, cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.76, 26, OL); line(g, cx, cy, cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.76, 18, '#56636f'); }
      // 코어 원통
      const w = r * 0.5, top = cy - r * 1.05, bot = cy + r * 0.1;
      g.beginPath(); g.moveTo(cx - w, top); g.lineTo(cx - w, bot); g.ellipse(cx, bot, w, w * 0.35, 0, Math.PI, 0, true); g.lineTo(cx + w, top); g.closePath();
      g.fillStyle = lgrad(g, cx - w, 0, cx + w, 0, [[0, '#1b6a8f'], [0.35, '#7fe8ff'], [0.55, '#c9f8ff'], [1, '#1c5d80']]); g.fill(); g.lineWidth = 6; g.strokeStyle = OL; g.stroke();
      for (const t of [0.22, 0.55, 0.85]) { const y = lerp(top, bot, t); ell(g, cx, y, w + 6, w * 0.32); g.lineWidth = 9; g.strokeStyle = OL; g.stroke(); g.lineWidth = 5; g.strokeStyle = '#8a96a2'; g.stroke(); }
      ell(g, cx, top, w, w * 0.35); fillOL(g, rgrad(g, cx, top, 2, w, [[0, '#ffffff'], [0.5, '#9af0ff'], [1, '#3aa9d0']]), 5);
      line(g, cx - w * 0.55, top + 20, cx - w * 0.55, bot - 10, 6, 'rgba(255,255,255,.45)');
    },
  },
  mapTable: {
    up: b => 40,
    under(g, p, b) { shadowEll(g, b.cx, b.cy + b.r * 0.3, b.r * 1.1, b.r * 0.85, 0.25); },
    draw(g, p, b) {
      const { cx, cy, r } = b;
      const hex = (rad, dy) => { g.beginPath(); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; g.lineTo(cx + Math.cos(a) * rad, cy + dy + Math.sin(a) * rad * 0.82); } g.closePath(); };
      hex(r, 26); fillOL(g, '#3a4148', 6);
      hex(r, 0); fillOL(g, lgrad(g, 0, cy - r, 0, cy + r, [[0, '#7d8890'], [1, '#535d64']]), 6);
      hex(r * 0.8, -2); fillOL(g, '#13251f', 4);
      g.save(); hex(r * 0.8, -2); g.clip();
      g.strokeStyle = 'rgba(80,255,170,.25)'; g.lineWidth = 2;
      for (let x = cx - r; x < cx + r; x += 22) { g.beginPath(); g.moveTo(x, cy - r); g.lineTo(x, cy + r); g.stroke(); }
      for (let y = cy - r; y < cy + r; y += 22) { g.beginPath(); g.moveTo(cx - r, y); g.lineTo(cx + r, y); g.stroke(); }
      // 작은 함선 지도
      g.fillStyle = 'rgba(90,255,170,.55)'; g.strokeStyle = 'rgba(180,255,220,.9)'; g.lineWidth = 3;
      for (const [x, y, w, h] of [[-0.55, -0.35, 0.3, 0.25], [-0.15, -0.5, 0.35, 0.3], [0.3, -0.3, 0.25, 0.22], [-0.45, 0.1, 0.25, 0.25], [0.0, 0.05, 0.3, 0.28], [0.35, 0.15, 0.2, 0.2]]) { g.beginPath(); g.rect(cx + x * r, cy + y * r, w * r, h * r); g.fill(); g.stroke(); }
      g.restore();
    },
  },
  crate: {
    up: b => Math.min(90, b.h * 0.55) + 10,
    under(g, p, b) { shadowEll(g, b.cx + 10, b.y + b.h - 4, b.w * 0.6, Math.max(18, b.h * 0.25), 0.28); },
    draw(g, p, b) {
      const col = p.color || '#4f7d62', hh = Math.min(90, b.h * 0.55), { x, y, w, h } = b;
      box3(g, x, y, w, h, hh, col, shade(col, -0.38), 6);
      // 판자 무늬
      g.save(); rr(g, x, y - hh, w, h, 6); g.clip();
      g.strokeStyle = shade(col, -0.2); g.lineWidth = 3;
      for (let k = 1; k < 4; k++) { const yy = y - hh + (h * k) / 4; g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(x, y - hh, w, 8);
      g.restore();
      // 모서리 철판
      for (const cxx of [x + 4, x + w - 26]) { g.fillStyle = '#8f9aa1'; g.fillRect(cxx, y - hh + 4, 22, 14); g.fillRect(cxx, y + h - 26, 22, 22); g.lineWidth = 3; g.strokeStyle = OL; g.strokeRect(cxx, y + h - 26, 22, 22); }
      g.fillStyle = shade(col, -0.5); g.fillRect(x + w * 0.35, y + h - hh * 0.62, w * 0.3, hh * 0.22);
      if (p.laptop) {
        const lx = x + w / 2 - 50, ly = y - hh + h / 2 - 30;
        rr(g, lx, ly, 100, 64, 6); fillOL(g, '#c9ced3', 4); screenGlow(g, lx + 7, ly + 7, 86, 46, '#3aa3e8');
        rr(g, lx - 6, ly + 60, 112, 18, 5); fillOL(g, '#a8afb5', 4);
      }
      if (p.box) {
        const lx = x + w / 2 - 44, ly = y - hh + h / 2 - 50;
        box3(g, lx, ly + 30, 88, 40, 44, '#c58d4d', '#93612c', 4);
        g.fillStyle = '#e8d6a8'; g.fillRect(lx + 38, ly - 14, 12, 40);
      }
    },
  },
  bed: {
    draw(g, p, b) {
      const { x, y, w, h } = b, hor = w >= h;
      shadowEll(g, b.cx + 8, b.cy + 14, w * 0.55, h * 0.55, 0.22);
      rr(g, x, y + 10, w, h, 12); fillOL(g, '#5f6b73', 5);
      rr(g, x, y, w, h, 12); fillOL(g, '#c4ccd2', 5);
      rr(g, x + 8, y + 8, w - 16, h - 16, 10); fillOL(g, '#eef3f6', 3);
      if (hor) { rr(g, x + 14, y + 14, w * 0.2, h - 28, 10); fillOL(g, '#ffffff', 3); rr(g, x + w * 0.42, y + 8, w * 0.54, h - 16, 8); fillOL(g, '#6fa6d6', 3); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x + w * 0.42, y + 12, w * 0.54, 6); }
      else { rr(g, x + 14, y + 14, w - 28, h * 0.2, 10); fillOL(g, '#ffffff', 3); rr(g, x + 8, y + h * 0.42, w - 16, h * 0.54, 8); fillOL(g, '#6fa6d6', 3); }
    },
  },
  scanner: {
    draw(g, p, b) {
      const { cx, cy, r } = b;
      ell(g, cx, cy + 10, r, r * 0.7); fillOL(g, '#3d464c', 5);
      ell(g, cx, cy, r, r * 0.7); fillOL(g, '#9aa5ac', 5);
      ell(g, cx, cy, r * 0.78, r * 0.54); fillOL(g, '#24323a', 4);
      ell(g, cx, cy, r * 0.62, r * 0.42); g.strokeStyle = '#3cff9a'; g.lineWidth = 5; g.stroke();
      ell(g, cx, cy, r * 0.32, r * 0.22); g.strokeStyle = 'rgba(60,255,154,.6)'; g.lineWidth = 3; g.stroke();
      line(g, cx - r * 0.7, cy, cx + r * 0.7, cy, 2, 'rgba(60,255,154,.5)'); line(g, cx, cy - r * 0.5, cx, cy + r * 0.5, 2, 'rgba(60,255,154,.5)');
    },
  },
  chair: {
    up: () => 50,
    draw(g, p, b) {
      const { cx, cy, r } = b, col = p.color || '#4a5a8a';
      shadowEll(g, cx, cy + r * 0.5, r * 0.9, r * 0.45, 0.25);
      line(g, cx, cy, cx, cy + r * 0.6, 8, OL);
      ell(g, cx, cy, r * 0.9, r * 0.6); fillOL(g, col, 5);
      ell(g, cx - r * 0.15, cy - r * 0.12, r * 0.45, r * 0.22); g.fillStyle = shade(col, 0.25); g.fill();
      rr(g, cx - r * 0.75, cy - r * 1.35, r * 1.5, r * 0.75, r * 0.3); fillOL(g, shade(col, -0.15), 5);
    },
  },
  desk: {
    up: () => 60,
    under(g, p, b) { shadowEll(g, b.cx + 10, b.y + b.h, b.w * 0.55, 22, 0.25); },
    draw(g, p, b) {
      const { x, y, w, h } = b, col = p.color || '#8b939a', hh = 46;
      box3(g, x, y, w, h, hh, col, shade(col, -0.4), 5);
      g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x + 6, y - hh + 4, w - 12, 5);
      // 위 물건
      rr(g, x + w * 0.12, y - hh + h * 0.2, w * 0.22, h * 0.5, 3); fillOL(g, '#f2f2ea', 2.5);
      rr(g, x + w * 0.45, y - hh + h * 0.3, w * 0.3, h * 0.35, 4); fillOL(g, '#30373c', 3);
      ell(g, x + w * 0.85, y - hh + h * 0.45, 9, 9); fillOL(g, '#d65a3a', 3);
      g.fillStyle = shade(col, -0.55); g.fillRect(x + w * 0.4, y + h - hh * 0.6, w * 0.2, 8);
    },
  },
  monitor: {
    up: () => 110,
    under(g, p, b) { shadowEll(g, b.cx, b.y + b.h, b.w * 0.55, 24, 0.25); },
    draw(g, p, b) {
      const { x, y, w, h } = b, hh = 40;
      box3(g, x, y, w, h, hh, '#6d777e', '#3c444a', 5);
      // 화면 받침 + 화면 (뒤쪽에 서 있음)
      const n = Math.max(2, Math.round(w / 90)), sw = (w - 16) / n;
      for (let i = 0; i < n; i++) {
        const sx = x + 8 + i * sw, sy = y - hh - 70;
        g.fillStyle = '#2b3237'; g.fillRect(sx + sw / 2 - 6, sy + 50, 12, 26);
        rr(g, sx, sy, sw - 6, 58, 5); fillOL(g, '#2c3439', 4);
        screenGlow(g, sx + 5, sy + 5, sw - 16, 46, i % 2 ? '#3ac9e8' : '#4fe0a0');
      }
      rr(g, x + w * 0.3, y - hh + h * 0.35, w * 0.4, 14, 4); fillOL(g, '#1f2428', 3);
    },
  },
  console: {
    up: () => 80,
    under(g, p, b) { shadowEll(g, b.cx, b.y + b.h, b.w * 0.55, 22, 0.25); },
    draw(g, p, b) {
      const { x, y, w, h } = b, hh = 55;
      box3(g, x, y, w, h, hh, '#78838b', '#40494f', 5);
      // 기울어진 패널
      g.beginPath(); g.moveTo(x + 8, y - hh + h - 6); g.lineTo(x + w - 8, y - hh + h - 6); g.lineTo(x + w - 18, y - hh - 30); g.lineTo(x + 18, y - hh - 30); g.closePath(); fillOL(g, '#2d353a', 4);
      screenGlow(g, x + w * 0.3, y - hh - 22, w * 0.4, h * 0.45, '#2f6fd0');
      g.fillStyle = 'rgba(255,255,255,.8)'; for (let i = 0; i < 6; i++) g.fillRect(x + w * 0.32 + ((i * 37) % (w * 0.36)), y - hh - 16 + ((i * 13) % (h * 0.35)), 2.5, 2.5);
      const cols = ['#ff4f4f', '#ffd23f', '#4fdc6a', '#4fb0ff'];
      for (let i = 0; i < 8; i++) { const bx = x + 26 + (i % 4) * 16 + (i < 4 ? 0 : w - 100), by = y - hh - 6 + Math.floor(i / 8) * 14; ell(g, bx, by, 5, 4); fillOL(g, cols[i % 4], 2); }
    },
  },
  panel: {
    up: b => 70,
    draw(g, p, b) {
      const { x, y, w, h } = b, n = Math.max(1, Math.round(w / 110)), cw = w / n, hh = 60;
      for (let i = 0; i < n; i++) {
        const cx = x + i * cw;
        box3(g, cx + 3, y, cw - 6, h, hh, '#7c868c', '#4a5359', 4);
        rr(g, cx + 12, y - hh + 6, cw - 24, Math.max(10, h - 12), 4); fillOL(g, '#5d676d', 3);
        for (let k = 0; k < 3; k++) { ell(g, cx + 20 + k * 14, y + h - hh * 0.5, 4, 4); fillOL(g, ['#4fdc6a', '#ffd23f', '#ff4f4f'][(i + k) % 3], 2); }
      }
    },
  },
  pipe: {
    up: b => 20,
    draw(g, p, b) {
      const { x, y, w, h } = b, vert = h > w, col = p.color || '#7f8a91';
      rr(g, x, y, w, h, Math.min(w, h) / 2);
      g.fillStyle = vert ? lgrad(g, x, 0, x + w, 0, [[0, shade(col, -0.4)], [0.35, shade(col, 0.3)], [1, shade(col, -0.45)]]) : lgrad(g, 0, y, 0, y + h, [[0, shade(col, 0.3)], [0.4, col], [1, shade(col, -0.45)]]);
      g.fill(); g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
      const L = vert ? h : w, n = Math.max(1, Math.floor(L / 140));
      for (let i = 1; i <= n; i++) {
        const t = i / (n + 1);
        if (vert) { rr(g, x - 5, y + h * t - 7, w + 10, 14, 4); } else { rr(g, x + w * t - 7, y - 5, 14, h + 10, 4); }
        fillOL(g, shade(col, -0.1), 4);
      }
    },
  },
  plant: {
    up: b => b.r * 1.6 + 20,
    under(g, p, b) { shadowEll(g, b.cx, b.cy + b.r * 0.6, b.r * 0.8, b.r * 0.35, 0.25); },
    draw(g, p, b) {
      const { cx, cy, r } = b, col = p.color || '#3f9b45';
      // 화분
      g.beginPath(); g.moveTo(cx - r * 0.55, cy - r * 0.2); g.lineTo(cx + r * 0.55, cy - r * 0.2); g.lineTo(cx + r * 0.4, cy + r * 0.6); g.lineTo(cx - r * 0.4, cy + r * 0.6); g.closePath(); fillOL(g, '#b2683a', 5);
      ell(g, cx, cy - r * 0.2, r * 0.55, r * 0.16); fillOL(g, '#5a3a22', 4);
      // 잎
      const R = rng(p.x * 7 + p.y);
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i - 3) * 0.42 + (R() - 0.5) * 0.2, L = r * (1.1 + R() * 0.5);
        g.save(); g.translate(cx, cy - r * 0.25); g.rotate(a + Math.PI / 2);
        ell(g, 0, -L / 2, r * 0.22, L / 2); fillOL(g, i % 2 ? col : shade(col, 0.15), 4);
        line(g, 0, -4, 0, -L * 0.85, 2, shade(col, -0.3));
        g.restore();
      }
    },
  },
  tree: {
    up: b => b.r * 2.7 + 30,
    key: b => b.cy + b.r * 0.2,
    under(g, p, b) { shadowEll(g, b.cx + b.r * 0.2, b.cy + b.r * 0.15, b.r * 1.5, b.r * 0.7, 0.3); },
    draw(g, p, b) {
      const { cx, cy, r } = b, col = p.color || '#3c8a3a';
      g.beginPath(); g.moveTo(cx - r * 0.28, cy + r * 0.2); g.lineTo(cx - r * 0.18, cy - r * 1.3); g.lineTo(cx + r * 0.18, cy - r * 1.3); g.lineTo(cx + r * 0.28, cy + r * 0.2); g.closePath();
      fillOL(g, lgrad(g, cx - r * 0.3, 0, cx + r * 0.3, 0, [[0, '#5a3a20'], [0.4, '#8a5c34'], [1, '#4a2e18']]), 6);
      leafBall(g, cx, cy - r * 1.75, r * 1.25, shade(col, -0.15), p.x + p.y);
      leafBall(g, cx - r * 0.3, cy - r * 2.05, r * 0.8, col, p.x * 3);
      leafBall(g, cx + r * 0.35, cy - r * 1.6, r * 0.75, shade(col, 0.08), p.y * 5);
    },
  },
  rock: {
    up: b => b.r * 0.7,
    under(g, p, b) { shadowEll(g, b.cx + b.r * 0.1, b.cy + b.r * 0.45, b.r * 1.05, b.r * 0.45, 0.28); },
    draw(g, p, b) {
      const { cx, cy, r } = b, col = p.color || '#8a8176', R = rng(p.x * 13 + p.y * 7), pts = [];
      for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU, k = 0.8 + R() * 0.25; pts.push([cx + Math.cos(a) * r * k, cy - r * 0.25 + Math.sin(a) * r * k * (a > Math.PI ? 1.05 : 0.7)]); }
      polyPath(g, pts); fillOL(g, lgrad(g, 0, cy - r * 1.2, 0, cy + r * 0.5, [[0, shade(col, 0.2)], [0.6, col], [1, shade(col, -0.4)]]), 6);
      g.beginPath(); g.moveTo(pts[5][0], pts[5][1]); g.lineTo(cx - r * 0.1, cy - r * 0.35); g.lineTo(pts[7][0], pts[7][1]); g.fillStyle = 'rgba(255,255,255,.18)'; g.fill();
      line(g, cx - r * 0.1, cy - r * 0.35, cx + r * 0.2, cy + r * 0.2, 3, 'rgba(0,0,0,.3)');
    },
  },
  bush: {
    up: b => b.r * 0.9,
    under(g, p, b) { shadowEll(g, b.cx, b.cy + b.r * 0.35, b.r * 1.1, b.r * 0.45, 0.28); },
    draw(g, p, b) { leafBall(g, b.cx, b.cy - b.r * 0.35, b.r, p.color || '#3f8a3a', p.x * 11 + p.y); },
  },
  mushroom: {
    up: b => b.r * 2.4,
    key: b => b.cy + b.r * 0.2,
    under(g, p, b) { shadowEll(g, b.cx, b.cy + b.r * 0.2, b.r * 1.4, b.r * 0.6, 0.28); },
    draw(g, p, b) {
      const { cx, cy, r } = b, col = p.color || '#e0623a';
      g.beginPath(); g.moveTo(cx - r * 0.3, cy + r * 0.25); g.quadraticCurveTo(cx - r * 0.42, cy - r * 0.6, cx - r * 0.22, cy - r * 1.3); g.lineTo(cx + r * 0.22, cy - r * 1.3); g.quadraticCurveTo(cx + r * 0.42, cy - r * 0.6, cx + r * 0.3, cy + r * 0.25); g.closePath();
      fillOL(g, lgrad(g, cx - r * 0.4, 0, cx + r * 0.4, 0, [[0, '#d9c9a8'], [0.4, '#fff4dc'], [1, '#bda988']]), 6);
      g.beginPath(); g.moveTo(cx - r * 1.25, cy - r * 1.25); g.bezierCurveTo(cx - r * 1.3, cy - r * 2.6, cx + r * 1.3, cy - r * 2.6, cx + r * 1.25, cy - r * 1.25); g.quadraticCurveTo(cx, cy - r * 0.95, cx - r * 1.25, cy - r * 1.25); g.closePath();
      fillOL(g, lgrad(g, 0, cy - r * 2.4, 0, cy - r * 1.1, [[0, shade(col, 0.2)], [1, shade(col, -0.25)]]), 7);
      const R = rng(p.x + p.y * 3);
      for (let i = 0; i < 5; i++) { ell(g, cx + (R() - 0.5) * r * 1.6, cy - r * (1.55 + R() * 0.6), r * (0.1 + R() * 0.1), r * (0.08 + R() * 0.07)); g.fillStyle = '#fff1d6'; g.fill(); }
      g.beginPath(); g.ellipse(cx - r * 0.5, cy - r * 1.95, r * 0.35, r * 0.12, -0.5, 0, TAU); g.fillStyle = 'rgba(255,255,255,.3)'; g.fill();
    },
  },
  barrel: {
    up: b => b.r * 1.3,
    under(g, p, b) { shadowEll(g, b.cx + 6, b.cy + b.r * 0.3, b.r * 0.95, b.r * 0.42, 0.28); },
    draw(g, p, b) {
      const { cx, cy, r } = b, col = p.color || '#c9772c', top = cy - r * 1.25, bot = cy + r * 0.2, w = r * 0.85;
      g.beginPath(); g.moveTo(cx - w, top); g.lineTo(cx - w, bot); g.ellipse(cx, bot, w, w * 0.35, 0, Math.PI, 0, true); g.lineTo(cx + w, top); g.closePath();
      fillOL(g, lgrad(g, cx - w, 0, cx + w, 0, [[0, shade(col, -0.35)], [0.35, shade(col, 0.25)], [1, shade(col, -0.45)]]), 6);
      for (const t of [0.25, 0.75]) { const y = lerp(top, bot, t); g.beginPath(); g.ellipse(cx, y, w, w * 0.35, 0, 0, Math.PI); g.lineWidth = 7; g.strokeStyle = '#3b3f43'; g.stroke(); }
      ell(g, cx, top, w, w * 0.35); fillOL(g, shade(col, 0.12), 5);
      ell(g, cx + w * 0.4, top, w * 0.15, w * 0.07); g.fillStyle = '#3b3f43'; g.fill();
    },
  },
  shelf: {
    up: () => 150,
    under(g, p, b) { shadowEll(g, b.cx, b.y + b.h, b.w * 0.55, 20, 0.25); },
    draw(g, p, b) {
      const { x, y, w, h } = b, hh = 140, col = p.color || '#7a6a58';
      g.beginPath(); g.rect(x, y + h - hh, w, hh); fillOL(g, shade(col, -0.3), 5);
      const R = rng(p.x * 5 + p.y);
      for (let k = 0; k < 3; k++) {
        const sy = y + h - hh + 8 + k * (hh / 3);
        g.fillStyle = shade(col, -0.55); g.fillRect(x + 6, sy, w - 12, hh / 3 - 12);
        for (let ix = x + 10; ix < x + w - 24; ix += 18 + R() * 14) { const bh = 14 + R() * (hh / 3 - 30), c = ['#d9534f', '#5bc0de', '#f0ad4e', '#5cb85c', '#c9ced3'][(R() * 5) | 0]; g.fillStyle = c; g.fillRect(ix, sy + hh / 3 - 12 - bh, 14, bh); g.lineWidth = 2; g.strokeStyle = OL; g.strokeRect(ix, sy + hh / 3 - 12 - bh, 14, bh); }
        g.fillStyle = col; g.fillRect(x + 2, sy + hh / 3 - 14, w - 4, 8);
      }
      rr(g, x - 2, y + h - hh - 10, w + 4, 16, 4); fillOL(g, shade(col, 0.15), 4);
    },
  },
  locker: {
    up: () => 170,
    under(g, p, b) { shadowEll(g, b.cx, b.y + b.h, b.w * 0.55, 18, 0.25); },
    draw(g, p, b) {
      const { x, y, w, h } = b, hh = 165, col = p.color || '#5f7d9a', n = Math.max(1, Math.round(w / 70)), lw = w / n;
      rr(g, x, y + h - hh - 12, w, 22, 4); fillOL(g, shade(col, 0.1), 4);
      for (let i = 0; i < n; i++) {
        const lx = x + i * lw;
        g.beginPath(); g.rect(lx, y + h - hh, lw, hh); fillOL(g, lgrad(g, lx, 0, lx + lw, 0, [[0, shade(col, 0.15)], [1, shade(col, -0.2)]]), 4);
        for (let k = 0; k < 3; k++) { g.fillStyle = shade(col, -0.45); g.fillRect(lx + 12, y + h - hh + 16 + k * 9, lw - 24, 4); }
        g.fillStyle = '#d6dde2'; g.fillRect(lx + lw - 16, y + h - hh * 0.55, 6, 22);
      }
    },
  },
  window: {
    draw(g, p, b) {
      const { x, y, w, h } = b;
      rr(g, x - 6, y - 6, w + 12, h + 12, 8); fillOL(g, '#5b666d', 5);
      rr(g, x, y, w, h, 5); g.fillStyle = lgrad(g, x, y, x + w, y + h, [[0, '#0d1530'], [1, '#04060f']]); g.fill();
      const R = rng(p.x * 3 + p.y * 7);
      g.fillStyle = '#fff';
      for (let i = 0; i < (w * h) / 900; i++) { const s = R() < 0.85 ? 1.5 : 3; g.globalAlpha = 0.4 + R() * 0.6; g.fillRect(x + R() * (w - 3), y + R() * (h - 3), s, s); }
      g.globalAlpha = 1;
      g.save(); rr(g, x, y, w, h, 5); g.clip();
      g.beginPath(); g.moveTo(x, y + h * 0.6); g.lineTo(x + w * 0.5, y); g.lineTo(x + w * 0.7, y); g.lineTo(x, y + h * 0.85); g.closePath(); g.fillStyle = 'rgba(180,220,255,.12)'; g.fill();
      g.restore();
      rr(g, x, y, w, h, 5); g.lineWidth = 4; g.strokeStyle = OL; g.stroke();
    },
  },
  rug: {
    draw(g, p, b) {
      const { x, y, w, h } = b, col = p.color || '#7d3a4c';
      if (b.round) { ell(g, b.cx, b.cy, b.r, b.r * 0.8); fillOL(g, col, 4); ell(g, b.cx, b.cy, b.r * 0.8, b.r * 0.62); g.lineWidth = 5; g.strokeStyle = shade(col, 0.35); g.stroke(); return; }
      rr(g, x, y, w, h, 8); fillOL(g, col, 4);
      rr(g, x + 12, y + 12, w - 24, h - 24, 6); g.lineWidth = 5; g.strokeStyle = shade(col, 0.35); g.stroke();
      g.beginPath(); g.moveTo(b.cx, y + 26); g.lineTo(x + w - 26, b.cy); g.lineTo(b.cx, y + h - 26); g.lineTo(x + 26, b.cy); g.closePath(); g.lineWidth = 4; g.strokeStyle = shade(col, -0.3); g.stroke();
    },
  },
  sofa: {
    up: () => 70,
    under(g, p, b) { shadowEll(g, b.cx, b.y + b.h, b.w * 0.55, 20, 0.25); },
    draw(g, p, b) {
      const { x, y, w, h } = b, col = p.color || '#a3423d', hh = 40;
      rr(g, x, y - 50, w, 60, 18); fillOL(g, shade(col, -0.15), 5);
      box3(g, x, y, w, h, hh, col, shade(col, -0.4), 5);
      const n = Math.max(1, Math.round(w / 90));
      for (let i = 0; i < n; i++) { rr(g, x + 22 + (i * (w - 44)) / n, y - hh + 8, (w - 44) / n - 6, h - 16, 10); fillOL(g, shade(col, 0.12), 3); }
      for (const ax of [x - 8, x + w - 22]) { rr(g, ax, y - hh - 16, 30, h + 10, 12); fillOL(g, shade(col, -0.08), 5); }
    },
  },
  lamp: {
    up: () => 230,
    key: b => b.cy + b.r,
    under(g, p, b) { shadowEll(g, b.cx, b.cy, b.r, b.r * 0.4, 0.3); ell(g, b.cx, b.cy - 40, 160, 100); g.fillStyle = rgrad(g, b.cx, b.cy - 40, 0, 160, [[0, 'rgba(255,230,150,.22)'], [1, 'rgba(255,230,150,0)']]); g.fill(); },
    draw(g, p, b) {
      const { cx, cy, r } = b;
      ell(g, cx, cy, r * 0.8, r * 0.35); fillOL(g, '#3c4146', 4);
      line(g, cx, cy, cx, cy - 190, 12, OL); line(g, cx, cy, cx, cy - 190, 6, '#8d959b');
      g.beginPath(); g.moveTo(cx - 30, cy - 175); g.lineTo(cx + 30, cy - 175); g.lineTo(cx + 18, cy - 220); g.lineTo(cx - 18, cy - 220); g.closePath(); fillOL(g, p.color || '#f3e3b0', 5);
      ell(g, cx, cy - 172, 26, 8); g.fillStyle = 'rgba(255,240,180,.9)'; g.fill();
    },
  },
  boxes: {
    up: b => 110,
    under(g, p, b) { shadowEll(g, b.cx + 8, b.y + b.h, b.w * 0.6, 22, 0.26); },
    draw(g, p, b) {
      const { x, y, w, h } = b, col = p.color || '#c4904f';
      const bx = (xx, yy, ww, hh2, d) => { box3(g, xx, yy, ww, hh2, d, col, shade(col, -0.32), 5); g.fillStyle = 'rgba(240,230,200,.8)'; g.fillRect(xx + ww / 2 - 6, yy - d, 12, hh2); };
      bx(x, y + h * 0.3, w * 0.55, h * 0.7, 50);
      bx(x + w * 0.5, y + h * 0.15, w * 0.5, h * 0.85, 60);
      bx(x + w * 0.15, y + h * 0.25, w * 0.45, h * 0.5, 50 + 52);
    },
  },
  hexPanel: {
    draw(g, p, b) {
      const { cx, cy, r } = b, hr = r * 0.32;
      ell(g, cx, cy + 8, r * 1.02, r * 0.86); fillOL(g, '#3a4248', 5);
      ell(g, cx, cy, r * 1.02, r * 0.86); fillOL(g, '#6b767d', 5);
      const hex = (x, y) => { g.beginPath(); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + Math.PI / 6; g.lineTo(x + Math.cos(a) * hr, y + Math.sin(a) * hr * 0.85); } g.closePath(); };
      const cells = [[0, 0], ...Array.from({ length: 6 }, (_, i) => [Math.cos((i / 6) * TAU) * hr * 1.75, Math.sin((i / 6) * TAU) * hr * 1.5])];
      for (const [dx, dy] of cells) { hex(cx + dx, cy + dy); fillOL(g, '#2a4a5c', 4); hex(cx + dx, cy + dy - 2); g.fillStyle = 'rgba(120,200,255,.2)'; g.fill(); }
    },
  },
  gunSeat: {
    up: b => b.r * 0.9,
    under(g, p, b) { shadowEll(g, b.cx, b.cy + b.r * 0.35, b.r, b.r * 0.5, 0.28); },
    draw(g, p, b) {
      const { cx, cy, r } = b;
      ell(g, cx, cy + 10, r * 0.7, r * 0.45); fillOL(g, '#3b4348', 5);
      // 포신 (오른쪽 위)
      for (const dy of [-r * 0.5, -r * 0.2]) { rr(g, cx, cy + dy - 9, r * 1.15, 18, 9); fillOL(g, lgrad(g, 0, cy + dy - 9, 0, cy + dy + 9, [[0, '#a5aeb4'], [1, '#4c555b']]), 4); }
      rr(g, cx - r * 0.35, cy - r * 0.75, r * 0.75, r * 0.75, 16); fillOL(g, '#6d7880', 5);
      screenGlow(g, cx - r * 0.25, cy - r * 0.68, r * 0.55, r * 0.3, '#ff5d5d');
      rr(g, cx - r * 0.6, cy - r * 0.1, r * 0.55, r * 0.45, 12); fillOL(g, '#c0392b', 5);
      rr(g, cx - r * 0.7, cy - r * 0.6, r * 0.28, r * 0.6, 10); fillOL(g, '#a3302a', 5);
    },
  },
  statue: {
    up: b => b.r * 2.6,
    under(g, p, b) { shadowEll(g, b.cx, b.cy + b.r * 0.3, b.r * 1.1, b.r * 0.5, 0.3); },
    draw(g, p, b) {
      const { cx, cy, r } = b, col = p.color || '#a9a397';
      box3(g, cx - r * 0.85, cy - r * 0.6, r * 1.7, r * 1.0, r * 0.5, shade(col, 0.05), shade(col, -0.35), 5);
      // 크루원 모양 석상
      g.save(); g.translate(cx - 64 * r * 0.012, cy - r * 0.95 - 120 * r * 0.012); g.scale(r * 0.012, r * 0.012);
      g.lineJoin = 'round';
      const st = shade(col, -0.25);
      g.lineWidth = 13; g.strokeStyle = OL; g.stroke(p2(BODY.pack)); g.stroke(p2(BODY.torso)); for (const l of legsD(null)) g.stroke(p2(l));
      g.fillStyle = st; g.fill(p2(BODY.pack)); for (const l of legsD(null)) g.fill(p2(l)); g.fill(p2(BODY.torso)); g.fillStyle = col; g.fill(p2(BODY.main));
      g.fillStyle = shade(col, 0.25); g.fill(p2(BODY.visor)); g.lineWidth = 6; g.stroke(p2(BODY.visor));
      g.restore();
    },
  },
  toilet: {
    up: b => 60,
    draw(g, p, b) {
      const { cx, cy, r } = b;
      shadowEll(g, cx, cy + r * 0.5, r * 0.8, r * 0.35, 0.25);
      rr(g, cx - r * 0.55, cy - r * 1.2, r * 1.1, r * 0.6, 8); fillOL(g, '#e9eef2', 5);
      ell(g, cx, cy, r * 0.6, r * 0.7); fillOL(g, '#f4f7fa', 5);
      ell(g, cx, cy + 4, r * 0.38, r * 0.45); fillOL(g, '#9fc7dd', 3);
    },
  },
  sink: {
    up: b => 60,
    draw(g, p, b) {
      const { x, y, w, h } = b;
      box3(g, x, y, w, h, 50, '#e7ecef', '#a9b3ba', 5);
      ell(g, b.cx, y - 50 + h / 2, w * 0.32, h * 0.32); fillOL(g, '#b8d8e8', 4);
      line(g, b.cx, y - 50 + 6, b.cx, y - 50 + h / 2 - 8, 6, '#8d959b');
    },
  },
  car: {
    up: () => 70,
    under(g, p, b) { shadowEll(g, b.cx, b.y + b.h, b.w * 0.55, 26, 0.3); },
    draw(g, p, b) {
      const { x, y, w, h } = b, col = p.color || '#b8322e';
      for (const wx of [x + w * 0.18, x + w * 0.82]) { ell(g, wx, y + h - 6, 30, 30); fillOL(g, '#1d1f22', 5); ell(g, wx, y + h - 6, 13, 13); g.fillStyle = '#b9c0c6'; g.fill(); }
      rr(g, x, y - 30, w, h, 30); fillOL(g, lgrad(g, 0, y - 30, 0, y + h - 30, [[0, shade(col, 0.25)], [1, shade(col, -0.35)]]), 6);
      rr(g, x + w * 0.3, y - 66, w * 0.42, h * 0.55, 18); fillOL(g, '#2a3a4a', 5);
      g.fillStyle = 'rgba(160,210,255,.35)'; g.fillRect(x + w * 0.33, y - 60, w * 0.12, h * 0.4);
      ell(g, x + w - 14, y + h * 0.35 - 30, 10, 12); fillOL(g, '#ffe88a', 3);
    },
  },
  cannon: {
    up: b => 60,
    under(g, p, b) { shadowEll(g, b.cx, b.cy + b.r * 0.4, b.r * 1.1, b.r * 0.45, 0.28); },
    draw(g, p, b) {
      const { cx, cy, r } = b;
      rr(g, cx - r * 0.7, cy - r * 0.2, r * 1.4, r * 0.55, 10); fillOL(g, '#7a5232', 5);
      for (const wx of [cx - r * 0.5, cx + r * 0.5]) { ell(g, wx, cy + r * 0.35, r * 0.25, r * 0.25); fillOL(g, '#5a3a20', 5); }
      g.save(); g.translate(cx - r * 0.2, cy - r * 0.35); g.rotate(-0.35);
      rr(g, 0, -r * 0.22, r * 1.25, r * 0.44, r * 0.2); fillOL(g, lgrad(g, 0, -r * 0.22, 0, r * 0.22, [[0, '#5d646a'], [0.3, '#2c3134'], [1, '#141618']]), 6);
      ell(g, r * 1.25, 0, r * 0.1, r * 0.24); fillOL(g, '#0c0d0e', 4);
      g.restore();
    },
  },
  ladder: {
    draw(g, p, b) {
      const { x, y, w, h } = b, vert = h >= w;
      const L = vert ? h : w, n = Math.max(2, Math.floor(L / 34));
      shadowEll(g, b.cx + 8, b.cy + 8, w * 0.55, h * 0.55, 0.15);
      for (let i = 0; i <= n; i++) { const t = (i + 0.5) / (n + 1); if (vert) { line(g, x + 10, y + h * t, x + w - 10, y + h * t, 10, OL); line(g, x + 10, y + h * t, x + w - 10, y + h * t, 5, '#b9a27a'); } else { line(g, x + w * t, y + 10, x + w * t, y + h - 10, 10, OL); line(g, x + w * t, y + 10, x + w * t, y + h - 10, 5, '#b9a27a'); } }
      for (const k of [0, 1]) { if (vert) { rr(g, x + k * (w - 14), y - 6, 14, h + 12, 5); } else { rr(g, x - 6, y + k * (h - 14), w + 12, 14, 5); } fillOL(g, '#8f6b43', 4); }
    },
  },
  zipline: {
    draw(g, p, b) {
      const { cx, cy, r } = b;
      ell(g, cx, cy, r, r * 0.6); fillOL(g, '#7b5a3a', 5);
      ell(g, cx, cy - 6, r * 0.75, r * 0.42); fillOL(g, '#9c7650', 4);
      line(g, cx, cy - 6, cx, cy - 190, 14, OL); line(g, cx, cy - 6, cx, cy - 190, 8, '#6d4c2e');
    },
  },
  stairs: {
    draw(g, p, b) {
      const { x, y, w, h } = b, vert = h >= w, L = vert ? h : w, n = Math.max(3, Math.floor(L / 40));
      rr(g, x, y, w, h, 6); fillOL(g, '#6f777d', 5);
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n, c = shade('#9aa3a9', -i / n * 0.45);
        g.fillStyle = c;
        if (vert) g.fillRect(x + 4, y + h * t0 + 2, w - 8, h * (t1 - t0) - 4); else g.fillRect(x + w * t0 + 2, y + 4, w * (t1 - t0) - 4, h - 8);
        g.fillStyle = 'rgba(255,255,255,.25)';
        if (vert) g.fillRect(x + 4, y + h * t0 + 2, w - 8, 3); else g.fillRect(x + w * t0 + 2, y + 4, 3, h - 8);
      }
    },
  },
  lava: {
    draw(g, p, b) {
      const { x, y, w, h } = b;
      const shape = () => (b.round ? ell(g, b.cx, b.cy, b.r, b.r * 0.8) : rr(g, x, y, w, h, Math.min(w, h) * 0.3));
      shape(); g.fillStyle = '#3a1208'; g.fill(); g.lineWidth = 10; g.strokeStyle = '#1c0904'; g.stroke();
      g.save(); shape(); g.clip();
      g.fillStyle = rgrad(g, b.cx, b.cy, 4, Math.max(w, h) * 0.6, [[0, '#ffe066'], [0.35, '#ff8a1c'], [0.8, '#d6370f'], [1, '#6b1a07']]); g.fillRect(x, y, w, h);
      const R = rng(p.x + p.y * 9);
      for (let i = 0; i < (w * h) / 6000 + 3; i++) { ell(g, x + R() * w, y + R() * h, 14 + R() * 26, 8 + R() * 14, R() * 3); g.fillStyle = 'rgba(60,15,5,.55)'; g.fill(); }
      g.restore();
    },
  },
  water: {
    draw(g, p, b) {
      const { x, y, w, h } = b;
      const shape = () => (b.round ? ell(g, b.cx, b.cy, b.r, b.r * 0.8) : rr(g, x, y, w, h, Math.min(w, h) * 0.25));
      shape(); g.fillStyle = lgrad(g, 0, y, 0, y + h, [[0, '#4fb3d9'], [1, '#1f6d9c']]); g.fill(); g.lineWidth = 8; g.strokeStyle = '#d8f2ff'; g.stroke();
      g.save(); shape(); g.clip();
      const R = rng(p.x * 3 + p.y);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 3;
      for (let i = 0; i < (w * h) / 5000 + 3; i++) { const wx = x + R() * w, wy = y + R() * h; g.beginPath(); g.moveTo(wx, wy); g.quadraticCurveTo(wx + 15, wy - 8, wx + 30, wy); g.stroke(); }
      g.restore();
    },
  },
  fence: {
    up: () => 70,
    draw(g, p, b) {
      const { x, y, w, h } = b, vert = h > w, L = vert ? h : w, n = Math.max(2, Math.round(L / 60)), col = p.color || '#8a6239';
      shadowEll(g, b.cx, b.cy + 10, w * 0.55, h * 0.55 + 6, 0.2);
      if (vert) { for (const dx of [b.cx - 4]) { line(g, dx, y, dx, y + h, 12, OL); line(g, dx, y, dx, y + h, 6, col); } for (let i = 0; i <= n; i++) { const yy = y + (h * i) / n; rr(g, b.cx - 9, yy - 50, 18, 54, 4); fillOL(g, shade(col, 0.1), 4); } return; }
      for (let i = 0; i <= n; i++) { const xx = x + (w * i) / n; rr(g, xx - 8, b.cy - 60, 16, 64, 4); fillOL(g, shade(col, 0.1), 4); }
      for (const dy of [-45, -20]) { line(g, x, b.cy + dy, x + w, b.cy + dy, 13, OL); line(g, x, b.cy + dy, x + w, b.cy + dy, 7, col); }
    },
  },
  tent: {
    up: b => b.h * 0.6 + 40,
    under(g, p, b) { shadowEll(g, b.cx + 10, b.y + b.h, b.w * 0.6, 26, 0.28); },
    draw(g, p, b) {
      const { x, y, w, h } = b, col = p.color || '#e07b2f', top = y - h * 0.55;
      g.beginPath(); g.moveTo(x, y + h); g.lineTo(b.cx, top); g.lineTo(x + w, y + h); g.closePath(); fillOL(g, col, 6);
      g.beginPath(); g.moveTo(b.cx, top); g.lineTo(x + w, y + h); g.lineTo(x + w * 0.62, y + h); g.closePath(); g.fillStyle = shade(col, -0.25); g.fill();
      g.beginPath(); g.moveTo(b.cx - w * 0.16, y + h); g.lineTo(b.cx, top + h * 0.5); g.lineTo(b.cx + w * 0.16, y + h); g.closePath(); fillOL(g, '#2c1a10', 4);
      line(g, b.cx, top, b.cx, top - 22, 6, OL);
    },
  },
  campfire: {
    up: b => b.r * 1.4,
    under(g, p, b) { ell(g, b.cx, b.cy, b.r * 2.2, b.r * 1.5); g.fillStyle = rgrad(g, b.cx, b.cy, 0, b.r * 2.2, [[0, 'rgba(255,160,60,.28)'], [1, 'rgba(255,160,60,0)']]); g.fill(); },
    draw(g, p, b) {
      const { cx, cy, r } = b;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; ell(g, cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.55, r * 0.22, r * 0.16); fillOL(g, '#8d8a85', 3); }
      for (const a of [0.5, -0.5, 1.6]) { g.save(); g.translate(cx, cy); g.rotate(a); rr(g, -r * 0.6, -r * 0.1, r * 1.2, r * 0.2, r * 0.1); fillOL(g, '#6b4426', 3); g.restore(); }
    },
  },
  boat: {
    up: () => 40,
    under(g, p, b) { shadowEll(g, b.cx, b.cy + 14, b.w * 0.55, b.h * 0.5, 0.25); },
    draw(g, p, b) {
      const { x, y, w, h } = b, col = p.color || '#9a6b3e';
      g.beginPath(); g.moveTo(x, b.cy); g.quadraticCurveTo(x + w * 0.1, y, x + w * 0.3, y); g.lineTo(x + w * 0.85, y); g.quadraticCurveTo(x + w, b.cy, x + w * 0.85, y + h); g.lineTo(x + w * 0.3, y + h); g.quadraticCurveTo(x + w * 0.1, y + h, x, b.cy); g.closePath();
      fillOL(g, col, 6);
      g.save(); g.clip(); g.strokeStyle = shade(col, -0.25); g.lineWidth = 3; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x, y + (h * k) / 4); g.lineTo(x + w, y + (h * k) / 4); g.stroke(); } g.restore();
      for (const t of [0.4, 0.65]) { g.fillStyle = shade(col, -0.35); g.fillRect(x + w * t, y + 6, 18, h - 12); }
    },
  },
  _: {
    up: () => 50,
    draw(g, p, b) { box3(g, b.x, b.y, b.w, b.h, Math.min(50, b.h * 0.5), p.color || '#7d868c', shade(p.color || '#7d868c', -0.35), 5); },
  },
};
export const PROP_KINDS = Object.keys(PROPS).filter(k => k !== '_');

// 소품 스프라이트 (높이 있는 소품을 비트맵으로 한 번 그려 둠)
export function propSprite(p, art, s) {
  p._spr ||= new Map();
  const k = Math.round(s * 100);
  let e = p._spr.get(k);
  if (!e) {
    const [x0, y0, x1, y1] = p.sb, c = mk((x1 - x0) * s, (y1 - y0) * s), g = c.getContext('2d');
    g.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
    drawPropBody(g, p, art);
    e = { c, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    p._spr.set(k, e);
    if (p._spr.size > 3) p._spr.delete(p._spr.keys().next().value);
  }
  return e;
}
