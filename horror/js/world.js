// 저택(챕터 1) — 텍스처 · 방 · 가구 · 문 · 숨는 곳 · 조명 · 길찾기
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CEIL = 3.4, DOOR_H = 2.3, WALL_T = 0.2;
let _s = 20261105;
export const rnd = () => (_s = (_s * 16807) % 2147483647) / 2147483647;

export const ROOMS = [
  { id: 'bed', name: '침실', x0: 0, x1: 9, z0: 0, z1: 7, wp: 'wpRed', fl: 'wood' },
  { id: 'bath', name: '욕실', x0: 9, x1: 15, z0: 0, z1: 7, wp: 'tileW', fl: 'tileF' },
  { id: 'study', name: '서재', x0: 15, x1: 28, z0: 0, z1: 7, wp: 'wpGreen', fl: 'wood' },
  { id: 'hall', name: '복도', x0: 0, x1: 28, z0: 7, z1: 10, wp: 'wpBeige', fl: 'wood' },
  { id: 'kids', name: '아이방', x0: 0, x1: 10, z0: 10, z1: 17, wp: 'wpKids', fl: 'wood2' },
  { id: 'pass', name: '통로', x0: 10, x1: 12, z0: 10, z1: 17, wp: 'wpBeige', fl: 'wood' },
  { id: 'dining', name: '식당', x0: 12, x1: 28, z0: 10, z1: 17, wp: 'wpWine', fl: 'wood' },
  { id: 'foyer', name: '현관 홀', x0: 0, x1: 28, z0: 17, z1: 24, wp: 'wpTeal', fl: 'marble' },
];
export function roomAt(x, z) {
  for (const r of ROOMS) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return r;
  return null;
}

/* ───────────── 캔버스 텍스처 ───────────── */
export function cv(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
export function toTex(c, rep = true) {
  const t = new THREE.CanvasTexture(c);
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function noise(g, w, h, amt) {
  const d = g.getImageData(0, 0, w, h), p = d.data;
  for (let i = 0; i < p.length; i += 4) { const n = (rnd() - 0.5) * amt; p[i] += n; p[i + 1] += n; p[i + 2] += n; }
  g.putImageData(d, 0, 0);
}
function wrap9(w, h, fn) { for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) fn(dx, dy); }
function grime(g, w, h, n, a, col = '14,9,6') {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h, r = 15 + rnd() * 90, al = a * rnd();
    wrap9(w, h, (dx, dy) => {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, `rgba(${col},${al})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    });
  }
}
function drips(g, w, h, n, col, a) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, len = h * (0.15 + rnd() * 0.7), wd = 1 + rnd() * 3;
    g.fillStyle = `rgba(${col},${a * (0.4 + rnd() * 0.6)})`;
    g.fillRect(x, 0, wd, len); g.beginPath(); g.arc(x + wd / 2, len, wd * 0.9, 0, 7); g.fill();
  }
}
function damask(g, x, y, s) {
  g.save(); g.translate(x, y); g.scale(s, s);
  for (const k of [1, -1]) {
    g.save(); g.scale(k, 1); g.beginPath();
    g.moveTo(0, -46); g.bezierCurveTo(10, -40, 22, -28, 14, -16); g.bezierCurveTo(30, -20, 36, -4, 22, 4);
    g.bezierCurveTo(34, 14, 26, 30, 10, 26); g.bezierCurveTo(14, 38, 6, 46, 0, 52); g.closePath(); g.fill();
    g.beginPath(); g.arc(30, -30, 4, 0, 7); g.fill(); g.beginPath(); g.arc(34, 22, 3, 0, 7); g.fill();
    g.restore();
  }
  g.restore();
}
function wallpaper(base, ink, style = 'damask') {
  const [c, g] = cv(512);
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = 0; x < 512; x += 64) { g.fillRect(x, 0, 5, 512); g.fillRect(x + 58, 0, 2, 512); }
  g.fillStyle = ink;
  if (style === 'damask') {
    for (let r = 0; r < 4; r++) for (let col = 0; col < 4; col++)
      wrap9(512, 512, (dx, dy) => damask(g, col * 128 + (r % 2) * 64 + 32 + dx, r * 128 + 64 + dy, 0.9));
  } else if (style === 'kids') {
    for (let i = 0; i < 40; i++) {
      const x = (i % 8) * 64 + 32 + ((i >> 3) % 2) * 32, y = (i >> 3) * 102 + 40;
      wrap9(512, 512, (dx, dy) => {
        g.save(); g.translate(x + dx, y + dy); g.beginPath();
        if (i % 2) { for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5 - Math.PI / 2, rr = k % 2 ? 6 : 14; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } }
        else { g.arc(0, 0, 13, 0.6, 5.7); g.arc(6, -2, 10, 5.4, 0.9, true); }
        g.fill(); g.restore();
      });
    }
  } else {
    for (let x = 0; x < 512; x += 32) { g.fillRect(x + 10, 0, 3, 512); }
  }
  noise(g, 512, 512, 22);
  grime(g, 512, 512, 46, 0.45);
  drips(g, 512, 512, 18, '20,12,8', 0.35);
  if (style !== 'kids') { g.fillStyle = 'rgba(150,140,110,0.06)'; for (let i = 0; i < 6; i++) g.fillRect(rnd() * 512, rnd() * 512, 30 + rnd() * 60, 20 + rnd() * 80); }
  return toTex(c);
}
function planks(base, dark = 0.6) {
  const [c, g] = cv(512), ph = 64;
  for (let y = 0; y < 512; y += ph) {
    let x = -rnd() * 200;
    while (x < 512) {
      const len = 160 + rnd() * 240, t = 0.7 + rnd() * 0.45;
      g.fillStyle = `rgb(${base[0] * t | 0},${base[1] * t | 0},${base[2] * t | 0})`; g.fillRect(x, y, len, ph);
      for (let k = 0; k < 9; k++) {
        g.strokeStyle = `rgba(0,0,0,${0.05 + rnd() * 0.12})`; g.lineWidth = 1 + rnd();
        g.beginPath(); const yy = y + rnd() * ph; g.moveTo(x, yy);
        for (let xx = x; xx < x + len; xx += 16) g.lineTo(xx, yy + Math.sin(xx * 0.02 + k * 3) * 2.5);
        g.stroke();
      }
      g.fillStyle = `rgba(0,0,0,${dark})`; g.fillRect(x, y, 2, ph); x += len;
    }
    g.fillStyle = `rgba(0,0,0,${dark})`; g.fillRect(0, y, 512, 2);
  }
  noise(g, 512, 512, 16); grime(g, 512, 512, 30, 0.4);
  return toTex(c);
}
function woodGrain(base) {
  const [c, g] = cv(256);
  g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 60; k++) {
    g.strokeStyle = `rgba(0,0,0,${0.05 + rnd() * 0.15})`; g.lineWidth = 1 + rnd() * 2;
    g.beginPath(); const y0 = rnd() * 256; g.moveTo(0, y0);
    for (let x = 0; x <= 256; x += 8) g.lineTo(x, y0 + Math.sin(x * 0.03 + k) * 4 + Math.sin(x * 0.011 + k * 2) * 6);
    g.stroke();
  }
  noise(g, 256, 256, 14); grime(g, 256, 256, 10, 0.3);
  return toTex(c);
}
function tiles(c1, c2, n, checker) {
  const [c, g] = cv(512), s = 512 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const t = 0.85 + rnd() * 0.2; const col = checker && (i + j) % 2 ? c2 : c1;
    g.fillStyle = `rgb(${col[0] * t | 0},${col[1] * t | 0},${col[2] * t | 0})`; g.fillRect(i * s, j * s, s, s);
  }
  g.strokeStyle = 'rgba(30,25,20,0.9)'; g.lineWidth = 3;
  for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, 512); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(512, i * s); g.stroke(); }
  noise(g, 512, 512, 18); grime(g, 512, 512, 40, 0.5, '40,30,15');
  for (let i = 0; i < 4; i++) { g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1; g.beginPath(); let x = rnd() * 512, y = rnd() * 512; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; g.lineTo(x, y); } g.stroke(); }
  return toTex(c);
}
function marble() {
  const [c, g] = cv(512);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const d = (i + j) % 2; g.fillStyle = d ? '#1b211f' : '#8f8a7e'; g.fillRect(i * 256, j * 256, 256, 256);
    for (let k = 0; k < 7; k++) {
      g.strokeStyle = d ? 'rgba(160,170,160,0.18)' : 'rgba(40,35,30,0.35)'; g.lineWidth = 1 + rnd() * 2;
      g.beginPath(); let x = i * 256 + rnd() * 256, y = j * 256; g.moveTo(x, y);
      for (let s = 0; s < 12; s++) { x += (rnd() - 0.4) * 30; y += 22; g.lineTo(x, y); } g.stroke();
    }
  }
  g.strokeStyle = '#0c0b0a'; g.lineWidth = 4; g.strokeRect(0, 0, 256, 256); g.strokeRect(256, 256, 256, 256); g.strokeRect(256, 0, 256, 256); g.strokeRect(0, 256, 256, 256);
  noise(g, 512, 512, 14); grime(g, 512, 512, 40, 0.5);
  return toTex(c);
}
function plaster() {
  const [c, g] = cv(512); g.fillStyle = '#4d463e'; g.fillRect(0, 0, 512, 512);
  noise(g, 512, 512, 26); grime(g, 512, 512, 60, 0.5);
  g.strokeStyle = 'rgba(15,10,8,0.6)';
  for (let i = 0; i < 8; i++) { g.lineWidth = 1 + rnd(); g.beginPath(); let x = rnd() * 512, y = rnd() * 512; g.moveTo(x, y); for (let k = 0; k < 10; k++) { x += (rnd() - 0.5) * 50; y += (rnd() - 0.5) * 50; g.lineTo(x, y); } g.stroke(); }
  return toTex(c);
}
function fabric(base, blood) {
  const [c, g] = cv(256); g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  g.globalAlpha = 0.08; g.fillStyle = '#000';
  for (let i = 0; i < 256; i += 3) { g.fillRect(i, 0, 1, 256); g.fillRect(0, i, 256, 1); }
  g.globalAlpha = 1; noise(g, 256, 256, 18); grime(g, 256, 256, 14, 0.35, '60,50,30');
  if (blood) { grime(g, 256, 256, 5, 0.9, '90,8,6'); }
  return toTex(c);
}
function runner() {
  const [c, g] = cv(256, 512);
  g.fillStyle = '#4a0d0e'; g.fillRect(0, 0, 256, 512);
  g.fillStyle = '#2a0607'; g.fillRect(0, 0, 26, 512); g.fillRect(230, 0, 26, 512);
  g.fillStyle = '#7a5a26'; g.fillRect(30, 0, 5, 512); g.fillRect(221, 0, 5, 512);
  g.fillStyle = '#6a1416';
  for (let y = 32; y < 512; y += 64) { g.beginPath(); g.moveTo(128, y - 26); g.lineTo(170, y); g.lineTo(128, y + 26); g.lineTo(86, y); g.closePath(); g.fill(); }
  noise(g, 256, 512, 26); grime(g, 256, 512, 30, 0.6);
  return toTex(c);
}
function rugTex() {
  const [c, g] = cv(512, 384);
  g.fillStyle = '#3a0c10'; g.fillRect(0, 0, 512, 384);
  g.strokeStyle = '#8a6a30'; g.lineWidth = 8; g.strokeRect(20, 20, 472, 344);
  g.strokeStyle = '#1d2a40'; g.lineWidth = 14; g.strokeRect(42, 42, 428, 300);
  g.fillStyle = '#5a1a20'; g.beginPath(); g.ellipse(256, 192, 140, 90, 0, 0, 7); g.fill();
  g.fillStyle = '#7a5a2a'; damask(g, 256, 192, 1.4);
  noise(g, 512, 384, 30); grime(g, 512, 384, 30, 0.55);
  return toTex(c, false);
}
function louver() {
  const [c, g] = cv(128, 256);
  g.fillStyle = '#2b1a10'; g.fillRect(0, 0, 128, 256);
  for (let y = 30; y < 230; y += 9) { g.fillStyle = '#120a06'; g.fillRect(16, y, 96, 3); g.fillStyle = '#3d2618'; g.fillRect(16, y + 3, 96, 5); }
  g.strokeStyle = '#1a0f08'; g.lineWidth = 6; g.strokeRect(8, 8, 112, 240);
  noise(g, 128, 256, 18); return toTex(c, false);
}
function doorTex() {
  const [c, g] = cv(128, 256);
  g.fillStyle = '#2e1b10'; g.fillRect(0, 0, 128, 256);
  g.strokeStyle = '#140b06'; g.lineWidth = 5;
  g.strokeRect(16, 16, 96, 100); g.strokeRect(16, 132, 96, 108);
  g.strokeStyle = '#4a3020'; g.lineWidth = 2; g.strokeRect(22, 22, 84, 88); g.strokeRect(22, 138, 84, 96);
  noise(g, 128, 256, 20); grime(g, 128, 256, 8, 0.5);
  return toTex(c, false);
}
function books() {
  const [c, g] = cv(512, 128);
  g.fillStyle = '#0a0705'; g.fillRect(0, 0, 512, 128);
  let x = 0; const cols = ['#4a1010', '#1c2d1c', '#2a2016', '#16203a', '#3a2a10', '#301818', '#1e1e1e', '#4a3a22'];
  while (x < 512) {
    const w = 10 + rnd() * 20, h = 80 + rnd() * 46; g.fillStyle = cols[(rnd() * cols.length) | 0];
    g.fillRect(x, 128 - h, w - 1, h); g.fillStyle = 'rgba(200,170,90,0.4)'; g.fillRect(x + 2, 128 - h + 10, w - 5, 2); g.fillRect(x + 2, 128 - h + 16, w - 5, 1);
    if (rnd() < 0.08) x += 18; x += w;
  }
  noise(g, 512, 128, 20); grime(g, 512, 128, 10, 0.5);
  return toTex(c, false);
}
function boards() {
  const [c, g] = cv(256);
  const pl = [[10, 0.12], [80, -0.08], [150, 0.15], [215, -0.05]];
  for (const [y, a] of pl) {
    g.save(); g.translate(128, y + 20); g.rotate(a); g.fillStyle = '#3a2a1c'; g.fillRect(-150, -22, 300, 44);
    g.fillStyle = 'rgba(0,0,0,0.4)'; for (let k = 0; k < 6; k++) g.fillRect(-150, -18 + k * 7, 300, 1);
    g.fillStyle = '#777'; g.fillRect(-110, -4, 6, 6); g.fillRect(104, -4, 6, 6); g.restore();
  }
  noise(g, 256, 256, 24);
  return toTex(c, false);
}
function bloodText(text, w = 512, h = 256, font = 120) {
  const [c, g] = cv(w, h);
  g.font = `${font}px "East Sea Dokdo", "Nanum Pen Script", serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(110,6,6,0.92)'; g.fillText(text, w / 2, h / 2);
  for (let i = 0; i < 26; i++) {
    const x = w * 0.12 + rnd() * w * 0.76, y = h / 2 + 10 + rnd() * 20, len = 20 + rnd() * 90;
    const d = g.getImageData(x | 0, y | 0, 1, 1).data; if (d[3] < 100) continue;
    g.fillStyle = 'rgba(100,4,4,0.85)'; g.fillRect(x, y, 3, len); g.beginPath(); g.arc(x + 1.5, y + len, 3, 0, 7); g.fill();
  }
  return toTex(c, false);
}
function handprints() {
  const [c, g] = cv(256);
  for (let i = 0; i < 4; i++) {
    g.save(); g.translate(40 + rnd() * 170, 40 + rnd() * 170); g.rotate((rnd() - 0.5) * 1.2);
    g.fillStyle = `rgba(${90 + rnd() * 40},5,5,0.85)`; g.beginPath(); g.ellipse(0, 10, 16, 20, 0, 0, 7); g.fill();
    for (let f = 0; f < 4; f++) { g.beginPath(); g.ellipse(-12 + f * 8, -18 - (f === 1 || f === 2 ? 6 : 0), 3.5, 11, 0, 0, 7); g.fill(); }
    g.beginPath(); g.ellipse(18, 4, 4, 10, -0.8, 0, 7); g.fill();
    g.fillRect(-4, 26, 3, 30 + rnd() * 40); g.restore();
  }
  return toTex(c, false);
}
function glintTex() {
  const [c, g] = cv(64); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.2, 'rgba(255,220,150,0.5)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,230,0.9)'; g.fillRect(31, 4, 2, 56); g.fillRect(4, 31, 56, 2);
  return toTex(c, false);
}
function blobTex() {
  const [c, g] = cv(64); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return toTex(c, false);
}
export const SHARED = { glint: null, blob: null };

/* 단서 텍스처 (비밀번호 숫자가 들어간다) */
function drawMirror(g, d) {
  const w = 256, h = 320;
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#5d6a6e'); gr.addColorStop(1, '#22292b');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(220,225,225,0.35)'; for (let i = 0; i < 400; i++) { g.beginPath(); g.arc(rnd() * w, rnd() * h, 2 + rnd() * 9, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(15,20,22,0.85)'; g.lineWidth = 2; g.beginPath(); g.moveTo(40, 0); g.lineTo(90, 120); g.lineTo(70, 200); g.lineTo(120, 320); g.stroke();
  if (d != null) {
    g.font = '180px "East Sea Dokdo", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(25,30,32,0.9)'; g.fillText(String(d), w / 2 + 10, h / 2 + 10);
    g.fillStyle = 'rgba(40,45,48,0.8)'; for (let i = 0; i < 6; i++) g.fillRect(w / 2 - 30 + rnd() * 60, h / 2 + 50, 3, 20 + rnd() * 50);
  }
}
function drawClock(g, d) {
  const s = 256; g.fillStyle = '#1a120a'; g.fillRect(0, 0, s, s);
  g.fillStyle = '#c9b98e'; g.beginPath(); g.arc(128, 128, 112, 0, 7); g.fill();
  g.strokeStyle = '#3a2a14'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#2a1a0a'; g.font = 'bold 24px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const rom = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  rom.forEach((r, i) => { const a = i * Math.PI / 6 - Math.PI / 2; g.fillText(r, 128 + Math.cos(a) * 88, 128 + Math.sin(a) * 88); });
  g.strokeStyle = '#111'; g.lineWidth = 6; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(-2.2) * 50, 128 + Math.sin(-2.2) * 50); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(0.4) * 80, 128 + Math.sin(0.4) * 80); g.stroke();
  if (d != null) { g.fillStyle = '#8a0606'; g.font = '64px "East Sea Dokdo", serif'; g.fillText(String(d), 128, 168); }
  grime(g, s, s, 14, 0.5);
}
function drawSheet(g, d) {
  const w = 256, h = 200; g.fillStyle = '#cfc3a0'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#3a3226'; g.lineWidth = 1;
  for (let st = 0; st < 3; st++) for (let l = 0; l < 5; l++) { const y = 30 + st * 56 + l * 6; g.beginPath(); g.moveTo(12, y); g.lineTo(w - 12, y); g.stroke(); }
  g.fillStyle = '#221a12'; for (let i = 0; i < 26; i++) { const x = 24 + (i % 9) * 25, y = 30 + ((i / 9) | 0) * 56 + ((rnd() * 5) | 0) * 6; g.beginPath(); g.ellipse(x, y, 4, 3, -0.4, 0, 7); g.fill(); g.fillRect(x + 3, y - 18, 1.5, 18); }
  if (d != null) { g.strokeStyle = 'rgba(130,6,6,0.9)'; g.lineWidth = 5; g.beginPath(); g.arc(w / 2, h / 2, 46, 0, 7); g.stroke(); g.fillStyle = 'rgba(130,6,6,0.95)'; g.font = '96px "East Sea Dokdo", serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(d), w / 2, h / 2 + 4); }
  grime(g, w, h, 12, 0.4, '60,40,20');
}
function drawPlaque(g, d) {
  const w = 256, h = 96; g.clearRect(0, 0, w, h);
  if (d != null) { g.fillStyle = 'rgba(120,5,5,0.92)'; g.font = '86px "East Sea Dokdo", serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(d), w / 2, h / 2); for (let i = 0; i < 4; i++) g.fillRect(w / 2 - 20 + rnd() * 40, h / 2 + 20, 3, 10 + rnd() * 26); }
}
function painting(kind, img) {
  const [c, g] = cv(256, 320);
  g.fillStyle = '#120c08'; g.fillRect(0, 0, 256, 320);
  const gr = g.createRadialGradient(128, 140, 10, 128, 150, 170); gr.addColorStop(0, '#3a2a1a'); gr.addColorStop(1, '#0a0604');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 320);
  if (kind === 'greenhat' && img) {
    g.filter = 'sepia(0.7) contrast(1.2) brightness(0.8)';
    g.drawImage(img, 30, 30, 196, 320); g.filter = 'none';
    g.fillStyle = 'rgba(160,0,0,0.85)'; g.fillRect(84, 112, 34, 10); g.fillRect(132, 112, 34, 10);
  } else if (kind === 'family') {
    for (let i = 0; i < 3; i++) {
      const x = 60 + i * 68, y = 150; g.fillStyle = '#4a3a2a'; g.beginPath(); g.ellipse(x, y, 22, 28, 0, 0, 7); g.fill();
      g.fillRect(x - 28, y + 26, 56, 120);
      g.strokeStyle = 'rgba(10,5,5,0.95)'; g.lineWidth = 4; for (let k = 0; k < 9; k++) { g.beginPath(); g.moveTo(x - 25 + rnd() * 10, y - 30 + rnd() * 10); g.lineTo(x + 15 + rnd() * 10, y + 20 + rnd() * 10); g.stroke(); }
    }
  } else {
    g.fillStyle = '#1a2018'; g.beginPath(); g.moveTo(0, 220); g.lineTo(80, 150); g.lineTo(150, 200); g.lineTo(256, 130); g.lineTo(256, 320); g.lineTo(0, 320); g.fill();
    g.fillStyle = '#2a2a1a'; g.fillRect(150, 120, 50, 60); g.fillStyle = '#6a5a2a'; g.fillRect(170, 140, 8, 10);
  }
  noise(g, 256, 320, 24); grime(g, 256, 320, 18, 0.6);
  return toTex(c, false);
}
function kidDrawing(i) {
  const [c, g] = cv(256, 200);
  g.fillStyle = '#d8d0b8'; g.fillRect(0, 0, 256, 200);
  g.lineWidth = 4; g.lineCap = 'round';
  g.strokeStyle = '#2a2a2a'; g.beginPath(); g.arc(90, 70, 20, 0, 7); g.moveTo(90, 90); g.lineTo(90, 150); g.lineTo(70, 190); g.moveTo(90, 150); g.lineTo(110, 190); g.moveTo(60, 110); g.lineTo(120, 110); g.stroke();
  g.fillStyle = '#3c9a3c'; g.beginPath(); g.ellipse(90, 52, 30, 12, 0, Math.PI, 0); g.fill(); g.fillRect(60, 50, 60, 6);
  g.fillStyle = '#111'; g.fillRect(76, 64, 12, 6); g.fillRect(94, 64, 12, 6);
  g.strokeStyle = '#d0a020'; g.beginPath(); g.arc(190, 120, 12, 0, 7); g.moveTo(190, 132); g.lineTo(190, 170); g.stroke();
  g.strokeStyle = '#a01010'; g.beginPath(); g.moveTo(120, 110); g.lineTo(178, 124); g.stroke();
  g.fillStyle = '#a01010'; g.font = '30px "Nanum Pen Script", sans-serif'; g.fillText(i % 2 ? '팔로우 해' : '도망쳐', 130, 40);
  noise(g, 256, 200, 20);
  return toTex(c, false);
}

/* ───────────── 지오메트리 도우미 ───────────── */
function boxGeo(w, h, d, s = 1) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  if (!s) return g;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / s, uv.getY(k) * dims[f][1] / s); }
  return g;
}
export function box(parent, w, h, d, m, x, y, z, s = 1) {
  const mesh = new THREE.Mesh(boxGeo(w, h, d, s), m); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}
export function cyl(parent, rt, rb, h, m, x, y, z, seg = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}
function plane(parent, w, h, m, x, y, z, ry = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); mesh.position.set(x, y, z); mesh.rotation.y = ry; parent.add(mesh); return mesh;
}
const dyn = (o) => { o.userData.dyn = true; o.traverse(c => c.userData.dyn = true); return o; };

/* ───────────── 문 ───────────── */
class Door {
  constructor(w, id, cx, cz, axis, width, swing, lock, name) {
    Object.assign(this, { id, cx, cz, axis, width, lock, name, open: false, locked: !!lock });
    const piv = new THREE.Group();
    if (axis === 'x') { piv.position.set(cx - width / 2 + 0.03, 0, cz); this.base = 0; this.openAng = -swing * 1.62; }
    else { piv.position.set(cx, 0, cz - width / 2 + 0.03); this.base = -Math.PI / 2; this.openAng = this.base + swing * 1.62; }
    piv.rotation.y = this.base;
    const pw = width - 0.06;
    box(piv, pw, DOOR_H - 0.03, 0.07, w.m.door, pw / 2, DOOR_H / 2, 0, 0);
    for (const s of [-1, 1]) { const k = new THREE.Mesh(w.geo.knob, w.m.brass); k.position.set(pw - 0.1, 1.0, s * 0.06); piv.add(k); }
    if (lock) {
      this.lockMesh = new THREE.Group();
      box(this.lockMesh, 0.1, 0.12, 0.04, lock === 'rusty' ? w.m.rust : w.m.silver, 0, 0, 0);
      const sh = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 12, Math.PI), w.m.iron); sh.position.y = 0.06; this.lockMesh.add(sh);
      this.lockMesh.position.set(pw - 0.1, 1.15, swing > 0 ? -0.07 : 0.07); piv.add(this.lockMesh);
    }
    w.scene.add(piv); this.piv = piv;
    const h = 0.07;
    this.col = axis === 'x' ? w.col(cx - width / 2, cx + width / 2, cz - h, cz + h, 0, DOOR_H, 'door')
      : w.col(cx - h, cx + h, cz - width / 2, cz + width / 2, 0, DOOR_H, 'door');
    this.pos = new THREE.Vector3(cx, 1, cz);
  }
  setOpen(v) { this.open = v; this.col.on = !v; }
  reset() { this.setOpen(false); this.locked = !!this.lock; if (this.lockMesh) this.lockMesh.visible = true; this.piv.rotation.y = this.base; }
  update(dt) {
    const t = this.open ? this.openAng : this.base;
    this.piv.rotation.y += (t - this.piv.rotation.y) * Math.min(1, dt * 4.5);
  }
}

/* ───────────── 저택 ───────────── */
export class World {
  constructor(scene, assets, quality) {
    this.scene = scene; this.assets = assets; this.quality = quality;
    this.colliders = []; this.doors = {}; this.hides = []; this.inter = []; this.fixtures = []; this.anims = []; this.items = [];
    this.st = new THREE.Group(); scene.add(this.st);
    this.geo = { knob: new THREE.SphereGeometry(0.035, 10, 8) };
    this.makeMaterials();
    this.buildShell();
    this.furnish();
    this.buildNav();
    this.mergeStatic();
    this.buildLights();
    this.time = 0; this.focusSort = 0; this.lightning = 0;
  }
  col(x0, x1, z0, z1, y0, y1, tag = 'f') { const c = { x0, x1, z0, z1, y0, y1, tag, on: true }; this.colliders.push(c); return c; }

  makeMaterials() {
    const L = (map, color = 0xffffff, o = {}) => new THREE.MeshLambertMaterial({ map, color, ...o });
    const S = (o) => new THREE.MeshStandardMaterial(o);
    const m = this.m = {};
    m.wpRed = L(wallpaper('#3b1415', 'rgba(90,30,28,0.9)'));
    m.wpGreen = L(wallpaper('#17261c', 'rgba(50,72,48,0.9)'));
    m.wpBeige = L(wallpaper('#5a4a36', 'rgba(80,64,44,0.9)', 'stripe'));
    m.wpKids = L(wallpaper('#4f5a66', 'rgba(150,140,100,0.55)', 'kids'));
    m.wpWine = L(wallpaper('#2d0e18', 'rgba(70,24,36,0.9)'));
    m.wpTeal = L(wallpaper('#11262a', 'rgba(40,66,64,0.9)'));
    m.tileW = L(tiles([170, 168, 155], [170, 168, 155], 8, false));
    m.tileF = L(tiles([180, 178, 165], [28, 28, 28], 8, true));
    m.wood = L(planks([92, 58, 36]));
    m.wood2 = L(planks([110, 80, 54]));
    m.marble = S({ map: marble(), roughness: 0.35, metalness: 0.0 });
    m.ceil = L(plaster());
    m.wains = L(planks([58, 34, 20], 0.8));
    m.trim = L(null, 0x24150c);
    const dark = woodGrain('52,32,20'), mid = woodGrain('84,56,34'), red = woodGrain('70,24,16');
    m.woodDark = L(dark); m.woodMid = L(mid); m.woodRed = L(red);
    m.fabricW = L(fabric('#9a9180', true)); m.fabricR = L(fabric('#4a1418')); m.fabricG = L(fabric('#243424')); m.fabricB = L(fabric('#3a4a6a'));
    m.runner = L(runner()); m.rug = L(rugTex());
    m.louver = L(louver()); m.door = L(doorTex()); m.books = L(books());
    m.brass = S({ color: 0x8a6a2a, metalness: 0.85, roughness: 0.38 });
    m.silver = S({ color: 0xb8bcc0, metalness: 0.9, roughness: 0.3 });
    m.gold = S({ color: 0xd4a830, metalness: 0.95, roughness: 0.25, emissive: 0x3a2800, emissiveIntensity: 0.6 });
    m.rust = S({ color: 0x6a3a1e, metalness: 0.6, roughness: 0.8 });
    m.iron = S({ color: 0x1c1c1e, metalness: 0.7, roughness: 0.6 });
    m.black = L(null, 0x050404);
    m.porcelain = S({ color: 0xa8a49a, roughness: 0.25 });
    m.water = S({ color: 0x0a0b06, roughness: 0.05, metalness: 0.2 });
    m.leather = L(null, 0x3a1a10); m.paper = L(null, 0xc9bb94);
    m.candle = L(null, 0xd8ccb0);
    m.boards = L(boards());
    m.blood = (t, w, h, f) => new THREE.MeshLambertMaterial({ map: bloodText(t, w, h, f), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    m.hands = new THREE.MeshLambertMaterial({ map: handprints(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    m.winGlow = new THREE.MeshBasicMaterial({ color: 0x0c1220 });
    m.ember = new THREE.MeshBasicMaterial({ color: 0xff5010 });
    SHARED.glint = glintTex(); SHARED.blob = blobTex();
    // 단서용 캔버스
    this.clueCv = {};
    const mk = (id, w, h, draw) => { const [c, g] = cv(w, h); draw(g, null); this.clueCv[id] = { c, g, draw, tex: toTex(c, false) }; return this.clueCv[id].tex; };
    m.mirror = S({ map: mk('mirror', 256, 320, drawMirror), roughness: 0.15, metalness: 0.4 });
    m.clockFace = L(mk('clock', 256, 256, drawClock));
    m.sheet = L(mk('piano', 256, 200, drawSheet));
    m.plaque = new THREE.MeshLambertMaterial({ map: mk('portrait', 256, 96, drawPlaque), transparent: true });
    m.portraitGH = L(painting('greenhat', this.assets.full));
    m.portraitFam = L(painting('family'));
    m.portraitLand = L(painting('land'));
    m.kidDraw = [0, 1, 2].map(i => new THREE.MeshLambertMaterial({ map: kidDrawing(i) }));
    m.pianoKeys = L((() => { const [c, g] = cv(256, 32); g.fillStyle = '#c8bfa8'; g.fillRect(0, 0, 256, 32); g.fillStyle = '#111'; for (let i = 0; i < 36; i++) { g.fillRect(i * 7.1, 0, 1, 32); if ([1, 2, 4, 5, 6].includes(i % 7)) g.fillRect(i * 7.1 - 2, 0, 4, 19); } return toTex(c, false); })());
  }
  setCode(code) {
    const ids = ['mirror', 'clock', 'portrait', 'piano'];
    ids.forEach((id, i) => { const o = this.clueCv[id]; o.g.clearRect(0, 0, o.c.width, o.c.height); o.draw(o.g, code[i]); o.tex.needsUpdate = true; });
  }

  /* 벽 · 바닥 · 천장 */
  wpFor(x, z) { const r = roomAt(x, z); return r ? this.m[r.wp] : this.m.trim; }
  piece(x0, x1, z0, z1, y0, y1) {
    const w = x1 - x0, d = z1 - z0, h = y1 - y0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const mats = [this.wpFor(x1 + 0.3, cz), this.wpFor(x0 - 0.3, cz), this.m.trim, this.m.trim, this.wpFor(cx, z1 + 0.3), this.wpFor(cx, z0 - 0.3)];
    const mesh = new THREE.Mesh(boxGeo(w, h, d, 1.25), mats); mesh.position.set(cx, (y0 + y1) / 2, cz); this.st.add(mesh);
    mesh.userData.noMerge = true; mesh.receiveShadow = true;
    if (y0 < 1) { // 징두리 판벽 + 몰딩
      const ex = w < d ? 0.03 : 0, ez = w < d ? 0 : 0.03;
      box(this.st, w + ex * 2, 1.0, d + ez * 2, this.m.wains, cx, 0.5, cz, 1.2);
      box(this.st, w + ex * 3.4, 0.07, d + ez * 3.4, this.m.trim, cx, 1.02, cz);
    }
    const ex = w < d ? 0.05 : 0, ez = w < d ? 0 : 0.05;
    box(this.st, w + ex * 2, 0.14, d + ez * 2, this.m.trim, cx, CEIL - 0.07, cz);
  }
  wallLine(axis, at, a, b, gaps = []) {
    gaps = gaps.slice().sort((p, q) => p.c - q.c);
    let s = a; const t = WALL_T / 2;
    const cuts = [...new Set(ROOMS.flatMap(r => axis === 'x' ? [r.x0, r.x1] : [r.z0, r.z1]))];
    const seg = (p, q) => {
      if (q - p < 0.01) return;
      axis === 'x' ? this.col(p, q, at - t, at + t, 0, CEIL, 'wall') : this.col(at - t, at + t, p, q, 0, CEIL, 'wall');
      // 방 경계에서 잘라야 방마다 벽지가 다르게 붙는다
      const pts = [p, ...cuts.filter(c => c > p + 0.01 && c < q - 0.01).sort((u, v) => u - v), q];
      for (let i = 0; i < pts.length - 1; i++) axis === 'x' ? this.piece(pts[i], pts[i + 1], at - t, at + t, 0, CEIL) : this.piece(at - t, at + t, pts[i], pts[i + 1], 0, CEIL);
    };
    for (const gp of gaps) {
      const g0 = gp.c - gp.w / 2, g1 = gp.c + gp.w / 2, gh = gp.h || DOOR_H;
      seg(s, g0); s = g1;
      // 문 위쪽(인방)
      if (axis === 'x') { this.piece(g0, g1, at - t, at + t, gh, CEIL); this.col(g0, g1, at - t, at + t, gh, CEIL, 'wall'); }
      else { this.piece(at - t, at + t, g0, g1, gh, CEIL); this.col(at - t, at + t, g0, g1, gh, CEIL, 'wall'); }
      // 문틀
      const fT = WALL_T + 0.1;
      for (const e of [g0 - 0.05, g1 + 0.05]) axis === 'x' ? box(this.st, 0.1, gh + 0.1, fT, this.m.trim, e, (gh + 0.1) / 2, at) : box(this.st, fT, gh + 0.1, 0.1, this.m.trim, at, (gh + 0.1) / 2, e);
      axis === 'x' ? box(this.st, gp.w + 0.3, 0.12, fT, this.m.trim, gp.c, gh + 0.06, at) : box(this.st, fT, 0.12, gp.w + 0.3, this.m.trim, at, gh + 0.06, gp.c);
    }
    seg(s, b);
  }
  buildShell() {
    const W = 28, D = 24;
    this.wallLine('x', 0, 0, W);
    this.wallLine('x', D, 0, W, [{ c: 14, w: 2.2, h: 2.9 }]);
    this.wallLine('z', 0, 0, D);
    this.wallLine('z', W, 0, D);
    this.wallLine('x', 7, 0, W, [{ c: 4.5, w: 1.2 }, { c: 12, w: 1.1 }, { c: 21.5, w: 1.2 }]);
    this.wallLine('x', 10, 0, W, [{ c: 5, w: 1.2 }, { c: 11, w: 1.6 }, { c: 17.5, w: 1.3 }]);
    this.wallLine('x', 17, 0, W, [{ c: 11, w: 1.6 }, { c: 21, w: 1.3 }]);
    this.wallLine('z', 9, 0, 7); this.wallLine('z', 15, 0, 7);
    this.wallLine('z', 10, 10, 17); this.wallLine('z', 12, 10, 17);
    // 바닥 · 천장
    for (const r of ROOMS) {
      const w = r.x1 - r.x0, d = r.z1 - r.z0, s = r.fl === 'marble' ? 2.4 : r.fl.startsWith('tile') ? 2 : 1.7;
      const g = new THREE.PlaneGeometry(w, d); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / s, uv.getY(i) * d / s);
      const f = new THREE.Mesh(g, this.m[r.fl]); f.rotation.x = -Math.PI / 2; f.position.set((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2); this.st.add(f);
    }
    const cg = new THREE.PlaneGeometry(W, D); const cu = cg.attributes.uv; for (let i = 0; i < cu.count; i++) cu.setXY(i, cu.getX(i) * W / 3, cu.getY(i) * D / 3);
    const ce = new THREE.Mesh(cg, this.m.ceil); ce.rotation.x = Math.PI / 2; ce.position.set(W / 2, CEIL, D / 2); this.st.add(ce);
    // 문
    const D_ = (id, cx, cz, ax, w, sw, lock, name) => this.doors[id] = new Door(this, id, cx, cz, ax, w, sw, lock, name);
    D_('bed', 4.5, 7, 'x', 1.2, -1, null, '침실 문');
    D_('bath', 12, 7, 'x', 1.1, -1, null, '욕실 문');
    D_('study', 21.5, 7, 'x', 1.2, -1, 'rusty', '서재 문');
    D_('kids', 5, 10, 'x', 1.2, 1, 'silver', '아이방 문');
    D_('dining', 17.5, 10, 'x', 1.3, 1, null, '식당 문');
    D_('dfoyer', 21, 17, 'x', 1.3, 1, null, '식당 문');
    for (const d of Object.values(this.doors)) this.inter.push({ kind: 'door', door: d, pos: d.pos, r: 1.5 });
  }

  /* 가구 도우미 */
  grp(x, z, ry = 0) { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; this.st.add(g); g.updateMatrixWorld(); return g; }
  lw(g, x, y, z) { g.updateMatrixWorld(); return g.localToWorld(new THREE.Vector3(x, y, z)); }
  colFoot(g, w, d, h, ox = 0, oz = 0, tag = 'f') {
    const a = this.lw(g, ox - w / 2, 0, oz - d / 2), b = this.lw(g, ox + w / 2, 0, oz + d / 2);
    return this.col(Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.z, b.z), Math.max(a.z, b.z), 0, h, tag);
  }
  addInter(o) { this.inter.push(o); return o; }
  addGlint(pos) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SHARED.glint, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffe0a0 }));
    s.position.copy(pos); s.scale.setScalar(0.22); this.scene.add(s); return s;
  }
  fixture(pos, color, power, range, type, bulbs = []) {
    const f = { pos: pos.clone(), color: new THREE.Color(color), power, range, type, bulbs, cur: 1, drop: 0, ph: rnd() * 100, on: true };
    for (const b of bulbs) { b.material = b.material.clone(); b.userData.base = b.material.color.clone(); dyn(b); }
    this.fixtures.push(f); return f;
  }
  keyMesh(mat) {
    const k = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 14), mat); ring.rotation.x = Math.PI / 2; k.add(ring);
    box(k, 0.11, 0.012, 0.014, mat, 0.09, 0, 0); box(k, 0.012, 0.012, 0.03, mat, 0.13, 0, 0.014); box(k, 0.012, 0.012, 0.022, mat, 0.11, 0, 0.012);
    return k;
  }
  diaryMesh(color = 0x3a1a10) {
    const d = new THREE.Group();
    box(d, 0.2, 0.035, 0.27, new THREE.MeshLambertMaterial({ color }), 0, 0.0175, 0);
    box(d, 0.19, 0.028, 0.255, this.m.paper, 0.006, 0.0175, 0);
    return d;
  }

  /* 가구 */
  bed(x, z, ry, small = false) {
    const g = this.grp(x, z, ry), W = small ? 1.0 : 1.6, L = small ? 1.8 : 2.1, m = this.m.woodRed;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.08, 0.42, 0.08, m, sx * (W / 2 - 0.05), 0.21, sz * (L / 2 - 0.05));
    box(g, W, 0.12, L, m, 0, 0.44, 0);
    box(g, W - 0.06, 0.2, L - 0.1, this.m.fabricW, 0, 0.6, 0.02);
    box(g, W + 0.08, 0.06, L * 0.62, small ? this.m.fabricB : this.m.fabricR, 0, 0.71, L * 0.18);
    for (const s of [-1, 1]) box(g, 0.02, 0.3, L * 0.62, small ? this.m.fabricB : this.m.fabricR, s * (W / 2 + 0.04), 0.57, L * 0.18);
    if (small) box(g, W * 0.7, 0.1, 0.3, this.m.fabricW, 0, 0.75, -L / 2 + 0.25);
    else for (const s of [-1, 1]) box(g, W * 0.38, 0.12, 0.32, this.m.fabricW, s * W * 0.22, 0.76, -L / 2 + 0.28);
    box(g, W + 0.1, small ? 1.0 : 1.4, 0.08, m, 0, small ? 0.5 : 0.7, -L / 2 - 0.04);
    for (const s of [-1, 1]) cyl(g, 0.045, 0.045, small ? 1.1 : 1.55, m, s * (W / 2 + 0.05), small ? 0.55 : 0.78, -L / 2 - 0.04, 8);
    box(g, W + 0.1, 0.6, 0.06, m, 0, 0.3, L / 2 + 0.03);
    this.colFoot(g, W + 0.14, L + 0.16, 0.85, 0, -0.02);
    const side = 1; // +x 쪽으로 숨는다
    this.addHide('bed', g, [side * (W / 2 + 0.6), 0.25], [side * 0.15, 0.17, 0.25], [], small ? '침대 밑에 숨기' : '침대 밑에 숨기', Math.PI / 2 * side);
    return g;
  }
  wardrobe(x, z, ry) {
    const g = this.grp(x, z, ry), W = 1.3, Hh = 2.25, D = 0.65, m = this.m.woodDark;
    box(g, W, Hh, 0.04, m, 0, Hh / 2, -D / 2 + 0.02);
    for (const s of [-1, 1]) box(g, 0.05, Hh, D, m, s * (W / 2 - 0.025), Hh / 2, 0);
    box(g, W + 0.04, 0.12, D + 0.02, m, 0, 0.06, 0);
    box(g, W + 0.14, 0.14, D + 0.1, m, 0, Hh + 0.07, 0.02);
    box(g, W - 0.1, 0.03, D - 0.1, m, 0, 1.9, 0);
    const doors = [];
    for (const s of [-1, 1]) {
      const piv = new THREE.Group(); piv.position.set(s * (W / 2 - 0.03), 0, D / 2); g.add(piv); dyn(piv);
      const pw = W / 2 - 0.035;
      const p = box(piv, pw, Hh - 0.2, 0.035, this.m.louver, -s * pw / 2, 0.12 + (Hh - 0.2) / 2, 0, 0); dyn(p);
      const k = new THREE.Mesh(this.geo.knob, this.m.brass); k.position.set(-s * (pw - 0.07), 1.15, 0.03); piv.add(k); dyn(k);
      doors.push({ piv, open: s * 1.75 });
    }
    this.colFoot(g, W + 0.1, D + 0.06, Hh, 0, 0, 'tall');
    this.addHide('wardrobe', g, [0, D / 2 + 0.6], [0, 0, -0.02], doors, '옷장에 숨기', 0);
    return g;
  }
  cabinet(x, z, ry) { // 큰 서랍장 — 아래 칸에 들어가 숨는다
    const g = this.grp(x, z, ry), W = 1.5, Hh = 1.15, D = 0.72, m = this.m.woodMid;
    box(g, W, Hh, 0.04, m, 0, Hh / 2, -D / 2 + 0.02);
    for (const s of [-1, 1]) box(g, 0.05, Hh, D, m, s * (W / 2 - 0.025), Hh / 2, 0);
    box(g, W + 0.06, 0.05, D + 0.04, m, 0, Hh + 0.025, 0); box(g, W, 0.08, D, m, 0, 0.04, 0); box(g, W - 0.08, 0.03, D - 0.04, m, 0, 0.76, 0);
    for (let r = 0; r < 2; r++) for (const s of [-1, 1]) {
      box(g, W / 2 - 0.06, 0.15, 0.03, m, s * W / 4, 0.86 + r * 0.17, D / 2);
      const k = new THREE.Mesh(this.geo.knob, this.m.brass); k.position.set(s * W / 4, 0.86 + r * 0.17, D / 2 + 0.03); g.add(k);
    }
    const doors = [];
    for (const s of [-1, 1]) {
      const piv = new THREE.Group(); piv.position.set(s * (W / 2 - 0.03), 0, D / 2); g.add(piv); dyn(piv);
      const pw = W / 2 - 0.035;
      const p = box(piv, pw, 0.64, 0.03, this.m.door, -s * pw / 2, 0.42, 0, 0); dyn(p);
      const k = new THREE.Mesh(this.geo.knob, this.m.brass); k.position.set(-s * (pw - 0.07), 0.5, 0.03); piv.add(k); dyn(k);
      doors.push({ piv, open: s * 1.6 });
    }
    this.colFoot(g, W + 0.06, D + 0.04, Hh + 0.05);
    this.addHide('cabinet', g, [0, D / 2 + 0.6], [0, 0, -0.05], doors, '서랍장에 숨기', 0);
    return g;
  }
  addHide(type, g, front, inside, doors, label, look) {
    const fp = this.lw(g, front[0], 0, front[1]);
    const ip = this.lw(g, inside[0], inside.length > 2 ? inside[1] : 0, inside[inside.length - 1]);
    const yaw = g.rotation.y + look; // 바깥쪽을 보는 방향 (로컬 +z 기준)
    const out = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const spot = { type, group: g, front: fp, inside: ip, doors, label, out, faceYaw: yaw, room: roomAt(fp.x, fp.z) };
    this.hides.push(spot);
    this.addInter({ kind: 'hide', spot, pos: fp.clone().setY(1), r: 1.25 });
  }
  nightstand(x, z, ry, item) {
    const g = this.grp(x, z, ry), m = this.m.woodRed;
    box(g, 0.5, 0.56, 0.42, m, 0, 0.28, 0); box(g, 0.54, 0.03, 0.46, m, 0, 0.575, 0);
    const dr = new THREE.Group(); g.add(dr); dyn(dr);
    box(dr, 0.44, 0.14, 0.03, m, 0, 0.44, 0.215); box(dr, 0.42, 0.02, 0.36, m, 0, 0.38, 0.04); box(dr, 0.42, 0.1, 0.02, m, 0, 0.43, -0.13);
    const k = new THREE.Mesh(this.geo.knob, this.m.brass); k.position.set(0, 0.44, 0.24); dr.add(k); dyn(dr);
    this.colFoot(g, 0.54, 0.46, 0.6);
    return this.drawer(g, dr, item, [0, 0.4, 0.05], new THREE.Vector3(0, 0, 0.3));
  }
  drawer(g, dr, item, itemL, slide, label = '서랍 열기') {
    const it = { kind: 'drawer', g, dr, item, opened: false, slide, label, pos: this.lw(g, 0, 0.8, 0.5) };
    if (item) {
      const mat = { rusty: this.m.rust, silver: this.m.silver, gold: this.m.gold }[item.key] || this.m.paper;
      const km = this.keyMesh(mat); km.position.set(...itemL); km.rotation.y = 0.6; dr.add(km); dyn(km); it.mesh = km;
      it.glint = this.addGlint(this.lw(g, itemL[0], itemL[1] + 0.25, itemL[2] + 0.2)); it.glint.visible = false;
    }
    this.items.push(it);
    return this.addInter(it);
  }
  desk(x, z, ry, opts = {}) {
    const g = this.grp(x, z, ry), m = this.m.woodDark;
    box(g, 1.4, 0.05, 0.7, m, 0, 0.76, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.06, 0.74, 0.06, m, sx * 0.64, 0.37, sz * 0.3);
    box(g, 0.42, 0.5, 0.62, m, 0.45, 0.49, 0);
    const dr = new THREE.Group(); g.add(dr); dyn(dr);
    box(dr, 0.38, 0.16, 0.03, m, 0.45, 0.62, 0.32); box(dr, 0.36, 0.02, 0.5, m, 0.45, 0.55, 0.08);
    const k = new THREE.Mesh(this.geo.knob, this.m.brass); k.position.set(0.45, 0.62, 0.35); dr.add(k); dyn(dr);
    // 의자
    const c = new THREE.Group(); c.position.set(-0.15, 0, 0.65); c.rotation.y = 0.25; g.add(c);
    box(c, 0.45, 0.05, 0.45, m, 0, 0.46, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(c, 0.04, 0.46, 0.04, m, sx * 0.19, 0.23, sz * 0.19);
    box(c, 0.45, 0.6, 0.04, m, 0, 0.78, 0.21);
    // 책 더미 · 촛대
    box(g, 0.25, 0.08, 0.32, this.m.leather, -0.45, 0.82, -0.15); box(g, 0.22, 0.06, 0.3, this.m.fabricG, -0.43, 0.89, -0.13);
    this.colFoot(g, 1.45, 0.75, 0.8); this.colFoot(g, 0.5, 0.5, 0.9, -0.15, 0.68);
    const res = { g };
    if (opts.lamp) {
      const lg = new THREE.Group(); lg.position.set(-0.5, 0.785, 0.1); g.add(lg);
      cyl(lg, 0.08, 0.1, 0.03, this.m.brass, 0, 0.015, 0); cyl(lg, 0.012, 0.012, 0.35, this.m.brass, 0, 0.19, 0);
      const shade = cyl(lg, 0.06, 0.16, 0.14, new THREE.MeshBasicMaterial({ color: opts.lamp }), 0, 0.38, 0, 14);
      this.fixture(this.lw(lg, 0, 0.3, 0), opts.lamp, 3.2, 5, opts.flick || 'normal', [shade]);
    }
    if (opts.diary) { const d = this.diaryMesh(); d.position.set(0.05, 0.785, 0.05); d.rotation.y = -0.3; g.add(d); dyn(d); res.diary = this.addDiary(opts.diary, d, this.lw(g, 0.05, 0.8, 0.05)); }
    if (opts.item !== undefined) res.drawer = this.drawer(g, dr, opts.item, [0.45, 0.58, 0.1], new THREE.Vector3(0, 0, 0.32), '책상 서랍 열기');
    return res;
  }
  addDiary(id, mesh, pos) {
    const it = { kind: 'diary', id, mesh, pos, r: 1.3, glint: this.addGlint(pos.clone().setY(pos.y + 0.18)) };
    return this.addInter(it);
  }
  bookshelf(x, z, ry) {
    const g = this.grp(x, z, ry), m = this.m.woodDark, W = 1.6, Hh = 2.4, D = 0.4;
    box(g, W, Hh, 0.03, m, 0, Hh / 2, -D / 2 + 0.015);
    for (const s of [-1, 1]) box(g, 0.05, Hh, D, m, s * (W / 2 - 0.025), Hh / 2, 0);
    for (let i = 0; i < 6; i++) box(g, W - 0.1, 0.035, D, m, 0, 0.05 + i * 0.46, 0);
    box(g, W + 0.1, 0.1, D + 0.06, m, 0, Hh + 0.05, 0.02);
    for (let i = 0; i < 5; i++) { const p = plane(g, W - 0.12, 0.4, this.m.books, 0, 0.27 + i * 0.46, 0.1); if (i % 2) p.scale.x = -1; }
    this.colFoot(g, W, D + 0.04, Hh, 0, 0, 'tall');
  }
  dresser(x, z, ry, text) {
    const g = this.grp(x, z, ry), m = this.m.woodRed;
    box(g, 1.2, 0.9, 0.5, m, 0, 0.45, 0); box(g, 1.26, 0.04, 0.54, m, 0, 0.92, 0);
    for (let r = 0; r < 3; r++) { box(g, 1.1, 0.24, 0.02, m, 0, 0.17 + r * 0.27, 0.255); for (const s of [-1, 1]) { const k = new THREE.Mesh(this.geo.knob, this.m.brass); k.position.set(s * 0.3, 0.17 + r * 0.27, 0.28); g.add(k); } }
    this.colFoot(g, 1.26, 0.54, 0.95);
    if (text) this.addInter({ kind: 'flavor', text, pos: this.lw(g, 0, 1, 0.5), r: 1.2, label: '서랍 뒤지기' });
    return g;
  }
  chair(x, z, ry, m = this.m.woodRed, broken = false) {
    const g = this.grp(x, z, ry);
    box(g, 0.46, 0.05, 0.46, m, 0, 0.47, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.045, 0.47, 0.045, m, sx * 0.2, 0.235, sz * 0.2);
    const b = box(g, 0.46, 0.75, 0.05, m, 0, 0.85, -0.21); if (broken) { b.rotation.x = -0.5; b.position.set(0, 0.5, -0.5); }
    box(g, 0.4, 0.04, 0.4, this.m.fabricR, 0, 0.51, 0);
    this.colFoot(g, 0.5, 0.5, 0.5);
  }
  candle(parent, x, y, z, light = true) {
    cyl(parent, 0.018, 0.02, 0.12, this.m.candle, x, y + 0.06, z, 8);
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffb050 })); fl.scale.y = 1.8; fl.position.set(x, y + 0.14, z); parent.add(fl);
    return fl;
  }
  candelabra(parent, x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
    cyl(g, 0.07, 0.09, 0.03, this.m.brass, 0, 0.015, 0); cyl(g, 0.015, 0.015, 0.3, this.m.brass, 0, 0.16, 0);
    box(g, 0.32, 0.02, 0.02, this.m.brass, 0, 0.3, 0);
    const fl = [-0.15, 0, 0.15].map(dx => this.candle(g, dx, 0.31, 0));
    this.fixture(this.lw(g, 0, 0.5, 0), 0xff9a40, 1.6, 5, 'candle', fl);
  }
  chandelier(x, z, big = false) {
    const g = new THREE.Group(); g.position.set(x, CEIL, z); this.st.add(g);
    const R = big ? 0.75 : 0.5, y = big ? -1.2 : -1.0;
    cyl(g, 0.01, 0.01, -y, this.m.iron, 0, y / 2, 0, 4);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.025, 6, 24), this.m.brass); ring.rotation.x = Math.PI / 2; ring.position.y = y; g.add(ring);
    const fl = []; const n = big ? 8 : 6;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; fl.push(this.candle(g, Math.cos(a) * R, y, Math.sin(a) * R)); }
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; const arm = box(g, 0.02, 0.02, R, this.m.brass, Math.cos(a) * R / 2, y + 0.05, Math.sin(a) * R / 2); arm.rotation.y = -a + Math.PI / 2; }
    this.fixture(new THREE.Vector3(x, CEIL + y + 0.1, z), 0xffa050, big ? 9 : 6, big ? 11 : 8, 'candle', fl);
  }
  ceilingLamp(x, z, flick = 'bad', color = 0xffd6a0) {
    const g = new THREE.Group(); g.position.set(x, CEIL, z); this.st.add(g);
    cyl(g, 0.006, 0.006, 0.6, this.m.iron, 0, -0.3, 0, 4);
    cyl(g, 0.06, 0.24, 0.16, this.m.iron, 0, -0.66, 0, 14);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color })); b.position.y = -0.74; g.add(b);
    this.fixture(new THREE.Vector3(x, CEIL - 0.85, z), color, 6, 8, flick, [b]);
  }
  sconce(x, y, z, ry) {
    const g = this.grp(x, z, ry); g.position.y = y;
    box(g, 0.08, 0.16, 0.03, this.m.brass, 0, 0, 0.015); box(g, 0.02, 0.02, 0.16, this.m.brass, 0, 0, 0.1);
    const sh = cyl(g, 0.07, 0.04, 0.12, new THREE.MeshBasicMaterial({ color: 0xffb070 }), 0, 0.06, 0.2, 10);
    this.fixture(this.lw(g, 0, 0.05, 0.3), 0xffa860, 2.6, 6, 'normal', [sh]);
  }
  windowBoard(x, z, ry) {
    const g = this.grp(x, z, ry);
    plane(g, 1.2, 1.5, this.m.winGlow, 0, 1.75, 0.014);
    const b = plane(g, 1.2, 1.5, this.m.boards, 0, 1.75, 0.03); b.material = new THREE.MeshLambertMaterial({ map: this.m.boards.map, transparent: true, alphaTest: 0.1 });
    this.boardMat = b.material;
    box(g, 1.4, 0.08, 0.14, this.m.trim, 0, 0.97, 0.05); box(g, 1.4, 0.08, 0.1, this.m.trim, 0, 2.53, 0.04);
    for (const s of [-1, 1]) box(g, 0.08, 1.6, 0.1, this.m.trim, s * 0.66, 1.75, 0.04);
    this.addInter({ kind: 'flavor', text: '창문이 판자로 단단히 막혀 있다. 틈 사이로 아무것도 보이지 않는다.', pos: this.lw(g, 0, 1.2, 0.6), r: 1.1, label: '창문 살펴보기' });
  }
  portrait(x, y, z, ry, mat, w = 0.7, h = 0.88, clue) {
    const g = this.grp(x, z, ry); g.position.y = y;
    box(g, w + 0.14, h + 0.14, 0.05, this.m.brass, 0, 0, 0.025);
    plane(g, w, h, mat, 0, 0, 0.052);
    if (clue) {
      const p = plane(g, 0.42, 0.16, this.m.plaque, 0, -h / 2 - 0.2, 0.01);
      this.addInter({ kind: 'clue', id: clue, pos: this.lw(g, 0, -0.6, 0.6), r: 1.4, label: '초상화 살펴보기' });
    }
    return g;
  }
  decal(mat, x, y, z, ry, w, h, rx = 0) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); p.position.set(x, y, z); p.rotation.set(rx, ry, 0, 'YXZ'); this.st.add(p); p.userData.noMerge = true; return p;
  }

  furnish() {
    const P = Math.PI, m = this.m;
    /* ── 침실 ── */
    this.bed(2.6, 1.15, 0);
    this.items.bedNight = this.nightstand(1.15, 0.35, 0, { key: 'rusty' });
    { const lg = new THREE.Group(); lg.position.set(1.0, 0.59, 0.25); this.st.add(lg); cyl(lg, 0.06, 0.08, 0.25, m.brass, 0, 0.12, 0); const sh = cyl(lg, 0.09, 0.15, 0.18, new THREE.MeshBasicMaterial({ color: 0xffc080 }), 0, 0.33, 0, 12); this.fixture(new THREE.Vector3(1.0, 0.95, 0.35), 0xffa860, 2.0, 4.5, 'bad', [sh]); }
    this.wardrobe(0.4, 4.5, P / 2);
    this.desk(8.45, 2.6, -P / 2, { diary: 1, lamp: 0xffb070 });
    this.dresser(6.4, 0.32, 0, '낡은 옷가지 사이에 쪽지가 있다.\n"팔로우 해줘. 팔로우 해줘. 팔로우 해줘."');
    this.windowBoard(6.4, 0.1, 0);
    this.ceilingLamp(4.5, 3.6, 'bad');
    this.portrait(8.88, 1.75, 5.2, -P / 2, m.portraitLand);
    { const r = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.2), m.rug); r.rotation.x = -P / 2; r.position.set(4.6, 0.005, 4.2); this.st.add(r); }
    this.decal(m.blood('팔로우 해', 512, 200, 130), 7.2, 1.9, 6.88, P, 1.6, 0.62);

    /* ── 욕실 ── */
    { const g = this.grp(10.2, 0.6, 0); const pm = m.porcelain;
      box(g, 1.7, 0.08, 0.8, pm, 0, 0.6, 0); for (const s of [-1, 1]) { box(g, 1.7, 0.55, 0.06, pm, 0, 0.32, s * 0.37); box(g, 0.06, 0.55, 0.8, pm, s * 0.82, 0.32, 0); }
      box(g, 1.6, 0.04, 0.7, m.water, 0, 0.5, 0); box(g, 1.7, 0.06, 0.8, pm, 0, 0.05, 0).visible = false;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.04, 0.02, 0.1, m.brass, sx * 0.72, 0.05, sz * 0.3, 6);
      this.colFoot(g, 1.75, 0.82, 0.65);
      this.addInter({ kind: 'flavor', text: '검은 물이 고여 있다. 바닥에 무언가 가라앉아 있는 것 같다... 손을 넣고 싶지 않다.', pos: this.lw(g, 0, 1, 0.8), r: 1.3, label: '욕조 살펴보기' });
    }
    { const g = this.grp(14.68, 2.6, -P / 2);
      box(g, 0.6, 0.12, 0.45, m.porcelain, 0, 0.82, 0); cyl(g, 0.08, 0.12, 0.76, m.porcelain, 0, 0.38, 0.0, 10);
      box(g, 0.8, 1.0, 0.04, m.brass, 0, 1.65, -0.2);
      plane(g, 0.7, 0.9, m.mirror, 0, 1.65, -0.175);
      this.colFoot(g, 0.62, 0.5, 0.9);
      this.addInter({ kind: 'clue', id: 'mirror', pos: this.lw(g, 0, 1, 0.7), r: 1.4, label: '거울 살펴보기' });
    }
    this.ceilingLamp(12, 3.5, 'bad', 0xe0f0ff);
    this.decal(m.hands, 9.12, 1.4, 4.5, P / 2, 1.2, 1.2);
    this.decal(m.hands, 13.5, 1.2, 0.12, 0, 1.0, 1.0);

    /* ── 서재 ── */
    this.bookshelf(17.0, 0.32, 0); this.bookshelf(18.75, 0.32, 0); this.bookshelf(26.4, 0.32, 0);
    this.items.studyDesk = this.desk(23.5, 2.2, 0, { diary: 2, lamp: 0x90d090, flick: 'normal', item: { key: 'silver' } });
    this.cabinet(15.48, 4.6, P / 2);
    this.windowBoard(21.6, 0.1, 0);
    { const g = this.grp(27.7, 4.0, -P / 2);
      box(g, 1.6, 1.2, 0.5, m.woodDark, 0, 0.6, 0); box(g, 1.0, 0.75, 0.52, m.black, 0, 0.42, 0.01); box(g, 1.8, 0.08, 0.6, m.woodDark, 0, 1.24, 0.02);
      const e = box(g, 0.8, 0.06, 0.3, m.ember, 0, 0.1, 0.05);
      this.fixture(this.lw(g, 0, 0.5, 0.6), 0xff5a20, 3.2, 5, 'fire', [e]);
      this.colFoot(g, 1.8, 0.62, 1.3);
      this.portrait(27.88, 2.1, 4.0, -P / 2, m.portraitFam, 0.8, 0.6);
      this.addInter({ kind: 'flavor', text: '타다 남은 사진들... 모두 초록모자를 팔로우하지 않은 사람들이다.\n얼굴마다 X 표시가 그어져 있다.', pos: this.lw(g, 0, 1, 0.9), r: 1.4, label: '벽난로 살펴보기' });
    }
    this.chair(26.0, 5.3, -P / 2 - 0.4, m.fabricG);
    { const r = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.4), m.rug); r.rotation.x = -P / 2; r.position.set(22.5, 0.005, 4.4); this.st.add(r); }
    this.ceilingLamp(19, 3.8, 'normal');

    /* ── 복도 ── */
    { const g2 = new THREE.PlaneGeometry(26, 1.2), u2 = g2.attributes.uv;
      for (let i = 0; i < u2.count; i++) { const x = u2.getX(i), y = u2.getY(i); u2.setXY(i, y, x * 18); }
      const r = new THREE.Mesh(g2, m.runner); r.rotation.x = -P / 2; r.position.set(14, 0.006, 8.5); this.st.add(r); }
    for (const x of [2.2, 8, 15.5, 19.8, 25]) this.sconce(x, 2.1, 7.1, 0);
    for (const x of [3, 14, 23.5]) this.sconce(x, 2.1, 9.9, P);
    this.portrait(8.2, 1.75, 7.1, 0, m.portraitGH, 0.7, 0.95, 'portrait');
    this.portrait(15.0, 1.75, 7.1, 0, m.portraitFam, 0.8, 0.6);
    this.portrait(25.5, 1.75, 9.9, P, m.portraitLand);
    this.wardrobe(27.6, 8.5, -P / 2);
    this.windowBoard(0.1, 8.5, P / 2);
    { const g = this.grp(23.5, 9.65, P); box(g, 0.8, 0.05, 0.4, m.woodRed, 0, 0.8, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.04, 0.78, 0.04, m.woodRed, sx * 0.35, 0.39, sz * 0.15); cyl(g, 0.06, 0.1, 0.3, m.porcelain, 0, 0.98, 0, 10); this.colFoot(g, 0.82, 0.42, 0.85); }
    this.decal(m.blood('도망쳐', 512, 200, 120), 19.5, 1.5, 9.88, P, 1.2, 0.48);

    /* ── 아이방 ── */
    this.bed(1.0, 12.4, P / 2, true);
    this.wardrobe(9.6, 15.5, -P / 2);
    this.items.toy = (() => { const g = this.grp(6.6, 16.6, P), wm = m.woodMid;
      box(g, 0.9, 0.5, 0.5, new THREE.MeshLambertMaterial({ color: 0x5a3a5a, map: m.woodMid.map }), 0, 0.25, 0);
      const lid = new THREE.Group(); lid.position.set(0, 0.5, -0.25); g.add(lid); dyn(lid);
      const lp = box(lid, 0.92, 0.05, 0.52, new THREE.MeshLambertMaterial({ color: 0x6a4a6a, map: wm.map }), 0, 0.025, 0.25); dyn(lp);
      this.colFoot(g, 0.92, 0.52, 0.55);
      const it = this.drawer(g, lid, { key: 'gold' }, [0, -0.1, 0.25], null, '장난감 상자 열기'); it.lid = true; it.pos = this.lw(g, 0, 0.8, 0.7);
      g.add(it.mesh); it.mesh.position.set(0, 0.4, 0); it.glint.position.copy(this.lw(g, 0, 0.75, 0));
      return it; })();
    { const g = this.grp(8.4, 10.45, 0); box(g, 1.0, 0.04, 0.5, m.woodMid, 0, 0.6, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.04, 0.6, 0.04, m.woodMid, sx * 0.45, 0.3, sz * 0.2);
      this.colFoot(g, 1.02, 0.52, 0.65);
      const d = this.diaryMesh(0x6a3050); d.position.set(0.1, 0.62, 0); g.add(d); dyn(d); this.addDiary(3, d, this.lw(g, 0.1, 0.64, 0));
      const lamp = cyl(g, 0.05, 0.08, 0.12, new THREE.MeshBasicMaterial({ color: 0xff6060 }), -0.35, 0.68, 0, 10);
      this.fixture(this.lw(g, -0.35, 0.8, 0.2), 0xff4040, 1.8, 5, 'normal', [lamp]); }
    this.teddy(1.0, 0.82, 11.9, P / 2); this.teddy(4.2, 0.0, 15.8, P * 0.8, true);
    for (let i = 0; i < 6; i++) box(this.st, 0.14, 0.14, 0.14, new THREE.MeshLambertMaterial({ color: [0x8a2020, 0x20408a, 0x8a8a20][i % 3] }), 3 + rnd() * 3, 0.07, 13 + rnd() * 2).rotation.y = rnd() * 3;
    this.decal(m.kidDraw[0], 0.12, 1.6, 14.2, P / 2, 0.6, 0.47);
    this.decal(m.kidDraw[1], 0.12, 1.4, 15.3, P / 2, 0.5, 0.39);
    this.decal(m.kidDraw[2], 3.4, 1.5, 16.88, P, 0.6, 0.47);
    this.decal(m.kidDraw[0], 7.2, 1.5, 10.12, 0, 0.5, 0.39);
    this.windowBoard(0.1, 15.6, P / 2);
    this.ceilingLamp(5, 13.5, 'bad', 0xffc0a0);

    /* ── 통로 ── */
    { for (const [x, z, s] of [[11.7, 11.0, 0.5], [11.7, 11.45, 0.4], [11.68, 11.2, 0.35]]) { const b = box(this.st, s, s, s, m.woodMid, x, s / 2 + (s === 0.35 ? 0.5 : 0), z); b.rotation.y = rnd(); }
      this.col(11.4, 12, 10.7, 11.7, 0, 1); }
    this.sconce(10.1, 2.1, 14, P / 2);

    /* ── 식당 ── */
    { const g = this.grp(19.5, 13.5, 0), tm = m.woodRed;
      box(g, 6.6, 0.07, 1.25, tm, 0, 0.78, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.1, 0.76, 0.1, tm, sx * 3.1, 0.38, sz * 0.5);
      box(g, 6.0, 0.012, 0.9, m.fabricW, 0, 0.822, 0);
      for (let i = 0; i < 6; i++) { const x = -2.6 + i * 1.04; for (const s of [-1, 1]) { cyl(g, 0.13, 0.11, 0.02, m.porcelain, x, 0.83, s * 0.32, 14); box(g, 0.1, 0.04, 0.08, new THREE.MeshLambertMaterial({ color: 0x2a3010 }), x, 0.85, s * 0.32); } }
      this.candelabra(g, -1.2, 0.815, 0); this.candelabra(g, 1.4, 0.815, 0);
      this.col(16.2, 22.8, 12.85, 14.15, 0, 0.85);
      this.addInter({ kind: 'flavor', text: '썩은 음식이 담긴 접시들. 접시마다 이름표가 붙어 있다.\n"팔로우 안 한 사람 1", "팔로우 안 한 사람 2"...', pos: new THREE.Vector3(16.0, 1, 13.5), r: 1.2, label: '식탁 살펴보기' });
    }
    for (let i = 0; i < 6; i++) { const x = 16.9 + i * 1.04; this.chair(x, 12.45, 0); this.chair(x, 14.55, P); }
    this.chandelier(19.5, 13.5);
    this.cabinet(25.5, 10.48, 0);
    this.wardrobe(12.42, 15.6, P / 2);
    { const g = this.grp(27.62, 13.5, -P / 2), pm = new THREE.MeshLambertMaterial({ color: 0x140c08, map: m.woodDark.map });
      box(g, 1.5, 1.3, 0.55, pm, 0, 0.65, -0.05); box(g, 1.4, 0.05, 0.3, pm, 0, 0.74, 0.32);
      const k = plane(g, 1.36, 0.16, m.pianoKeys, 0, 0.768, 0.32); k.rotation.x = -P / 2;
      const sh = plane(g, 0.42, 0.33, m.sheet, 0, 1.05, 0.24); sh.rotation.x = -0.25;
      box(g, 0.8, 0.06, 0.35, pm, 0, 0.48, 0.85); for (const s of [-1, 1]) box(g, 0.05, 0.46, 0.3, pm, s * 0.35, 0.23, 0.85);
      this.colFoot(g, 1.52, 0.9, 1.3, 0, 0.15);
      this.addInter({ kind: 'clue', id: 'piano', pos: this.lw(g, 0, 1, 1.0), r: 1.4, label: '피아노 살펴보기' }); }
    this.portrait(16.0, 1.85, 16.9, P, m.portraitFam, 0.9, 0.7);
    this.portrait(23.0, 1.85, 10.1, 0, m.portraitGH, 0.6, 0.8);
    this.windowBoard(27.9, 16.0, -P / 2);
    this.decal(m.blood('왜 팔로우 안 해?', 768, 200, 110), 14.0, 2.0, 10.12, 0, 2.0, 0.52);

    /* ── 현관 홀 ── */
    this.chandelier(14, 20.5, true);
    { const g = this.grp(7.0, 17.32, 0), cm = m.woodDark;
      box(g, 0.62, 2.25, 0.4, cm, 0, 1.125, 0); box(g, 0.7, 0.14, 0.46, cm, 0, 2.3, 0);
      plane(g, 0.46, 0.46, m.clockFace, 0, 1.85, 0.205);
      box(g, 0.4, 1.0, 0.02, m.black, 0, 0.95, 0.2);
      const pend = new THREE.Group(); pend.position.set(0, 1.52, 0.18); g.add(pend); dyn(pend);
      cyl(pend, 0.006, 0.006, 0.6, m.brass, 0, -0.3, 0, 4); const bob = cyl(pend, 0.07, 0.07, 0.015, m.brass, 0, -0.62, 0, 14); bob.rotation.x = P / 2;
      this.anims.push(t => pend.rotation.z = Math.sin(t * 2.2) * 0.22);
      this.clockPos = this.lw(g, 0, 1.5, 0.3);
      this.colFoot(g, 0.7, 0.46, 2.4, 0, 0, 'tall');
      this.addInter({ kind: 'clue', id: 'clock', pos: this.lw(g, 0, 1, 0.7), r: 1.4, label: '괘종시계 살펴보기' }); }
    // 무너진 계단
    { const g = this.grp(2.4, 18.4, 0), sm = m.woodDark;
      for (let i = 0; i < 7; i++) box(g, 3.6 - i * 0.45, 0.22, 2.0, sm, -i * 0.22 + 0.2, 0.11 + i * 0.22, 0);
      for (const s of [-1, 1]) { const b = box(g, 3.2, 0.12, 0.18, m.woodMid, 0.3, 1.0, 0.8 * s); b.rotation.z = s * 0.45; }
      for (let i = 0; i < 6; i++) { const b = box(g, 0.5 + rnd() * 0.8, 0.08, 0.15, m.woodMid, (rnd() - 0.5) * 2, 0.08, 1.2 + rnd() * 0.3); b.rotation.y = rnd() * 3; }
      this.col(0.1, 4.4, 17.2, 19.6, 0, 2);
      this.addInter({ kind: 'flavor', text: '계단이 무너져 있다. 위층으로는 갈 수 없다.\n위에서 무언가 긁는 소리가 들린다...', pos: new THREE.Vector3(4.2, 1, 19.6), r: 1.4, label: '계단 살펴보기' }); }
    this.wardrobe(0.4, 21.8, P / 2);
    { const g = this.grp(20, 22.7, P), sm = m.fabricR;
      box(g, 2.0, 0.42, 0.85, sm, 0, 0.21, 0); box(g, 2.0, 0.6, 0.18, sm, 0, 0.6, -0.34); for (const s of [-1, 1]) box(g, 0.18, 0.55, 0.85, sm, s * 0.95, 0.35, 0);
      this.colFoot(g, 2.02, 0.88, 0.8); }
    { const g = this.grp(20, 21.4, 0); cyl(g, 0.4, 0.4, 0.04, m.woodRed, 0, 0.55, 0, 16); cyl(g, 0.04, 0.06, 0.55, m.woodRed, 0, 0.27, 0, 8); this.candle(g, 0, 0.57, 0); this.colFoot(g, 0.8, 0.8, 0.6); }
    { const r = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), m.rug); r.rotation.x = -P / 2; r.position.set(14, 0.006, 20.6); this.st.add(r); }
    this.windowBoard(6.0, 23.9, P); this.windowBoard(22.5, 23.9, P);
    this.sconce(11.9, 2.4, 23.9, P); this.sconce(16.1, 2.4, 23.9, P);
    this.portrait(25, 1.9, 17.1, 0, m.portraitGH, 0.9, 1.2);
    this.decal(m.blood('나갈 수 없어', 640, 200, 120), 9.0, 1.7, 23.88, P, 1.7, 0.53);
    this.decal(m.hands, 25.5, 0.012, 21.5, 0, 1.4, 1.4, -P / 2);
    this.frontDoor();
  }
  teddy(x, y, z, ry, sit) {
    const g = this.grp(x, z, ry); g.position.y = y; const fm = new THREE.MeshLambertMaterial({ color: 0x6a4a2a, map: this.m.fabricW.map });
    const S = (r, px, py, pz) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), fm); s.position.set(px, py, pz); g.add(s); return s; };
    S(0.12, 0, 0.12, 0); S(0.09, 0, 0.3, 0); S(0.035, -0.07, 0.38, 0); S(0.035, 0.07, 0.38, 0);
    S(0.045, -0.12, 0.15, 0.04); S(0.045, 0.12, 0.15, 0.04); S(0.05, -0.07, 0.03, 0.1); S(0.05, 0.07, 0.03, 0.1);
    const e = new THREE.MeshBasicMaterial({ color: sit ? 0x550000 : 0x000000 });
    for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), e); b.position.set(s * 0.035, 0.32, 0.08); g.add(b); }
  }
  frontDoor() {
    const g = this.grp(14, 24, 0), P = Math.PI; this.front = { g, padlock: true, keypad: true, opening: false, ang: 0 };
    const doors = [];
    for (const s of [-1, 1]) {
      const piv = new THREE.Group(); piv.position.set(s * 1.08, 0, -0.02); g.add(piv); dyn(piv);
      const p = box(piv, 1.06, 2.82, 0.09, this.m.door, -s * 0.53, 1.45, 0, 0); dyn(p);
      const k = box(piv, 0.04, 0.3, 0.04, this.m.brass, -s * 0.95, 1.2, -0.07); dyn(k);
      doors.push(piv);
    }
    this.front.doors = doors;
    // 쇠사슬 + 자물쇠
    const ch = new THREE.Group(); g.add(ch); dyn(ch);
    for (let i = 0; i < 9; i++) { const l = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 5, 10), this.m.iron); l.position.set(-0.36 + i * 0.09, 1.2 + Math.sin(i / 8 * P) * -0.08, -0.12); l.rotation.y = i % 2 ? P / 2 : 0; ch.add(l); dyn(l); }
    const pl = box(ch, 0.14, 0.16, 0.06, this.m.gold, 0, 1.02, -0.13); dyn(pl);
    this.front.chain = ch;
    // 비밀번호 장치
    const kp = new THREE.Group(); kp.position.set(1.65, 1.35, -0.12); g.add(kp);
    box(kp, 0.26, 0.36, 0.05, this.m.iron, 0, 0, 0);
    const scr = plane(kp, 0.18, 0.06, new THREE.MeshBasicMaterial({ color: 0x401010 }), 0, 0.11, -0.026, P); dyn(scr); this.front.screen = scr;
    for (let i = 0; i < 12; i++) box(kp, 0.04, 0.035, 0.012, this.m.silver, -0.055 + (i % 3) * 0.055, 0.04 - ((i / 3) | 0) * 0.05, -0.03);
    // 문틈 빛 (바깥은 밝다)
    const glow = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    const crack = box(g, 2.2, 0.025, 0.04, glow, 0, 0.012, 0.02); dyn(crack);
    const crack2 = box(g, 0.02, 2.86, 0.04, glow, 0, 1.43, 0.02); dyn(crack2);
    this.front.crack = [crack, crack2];
    // 바깥 빛 (탈출 때만)
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    outside.position.set(14, 2, 25.2); outside.rotation.y = P; this.scene.add(outside); this.front.outside = outside; outside.visible = false;
    this.front.col = this.col(12.9, 15.1, 23.8, 24.2, 0, 3, 'door');
    this.addInter({ kind: 'front', pos: new THREE.Vector3(14.6, 1, 23.4), r: 1.6 });
    this.fixture(new THREE.Vector3(14, 0.3, 23.6), 0xfff0d0, 0.6, 2.5, 'steady', []);
  }

  /* 길찾기 그래프 */
  buildNav() {
    const N = {
      bed: [4.5, 3.9], bed2: [6.6, 4.6], bedD: [4.5, 7, 'bed'],
      bath: [12, 3.6], bathD: [12, 7, 'bath'],
      study: [21.5, 4.6], study2: [25.2, 5.4], study3: [17.6, 4.4], studyD: [21.5, 7, 'study'],
      h0: [1.6, 8.5], h1: [4.5, 8.5], h2: [8, 8.5], h3: [11, 8.5], h4: [12, 8.5], h5: [17.5, 8.5], h6: [21.5, 8.5], h7: [25.6, 8.5],
      kidsD: [5, 10, 'kids'], kids: [5, 13.4], kids2: [2.8, 15.4], kids3: [7.6, 12.6],
      passN: [11, 10], pass: [10.9, 13.5], passS: [11, 17],
      dinD: [17.5, 10, 'dining'], dA: [17.5, 11.6], dB: [24.3, 11.75], dC: [24.3, 15.6], dD: [21, 15.6], dE: [14.4, 15.6], dF: [14.4, 11.6], dinS: [21, 17, 'dfoyer'],
      f0: [5.6, 21.2], f1: [11, 20.4], f2: [14, 21.2], f3: [21, 20.0], f4: [25.2, 21.2], f5: [8.5, 22.6],
    };
    const E = 'bed-bed2 bed-bedD bedD-h1 bath-bathD bathD-h4 study-studyD study-study2 study-study3 studyD-h6 h0-h1 h1-h2 h2-h3 h3-h4 h4-h5 h5-h6 h6-h7 h1-kidsD kidsD-kids kids-kids2 kids-kids3 h3-passN passN-pass pass-passS passS-f1 h5-dinD dinD-dA dA-dB dB-dC dC-dD dD-dE dE-dF dF-dA dD-dinS dinS-f3 f0-f1 f1-f2 f2-f3 f3-f4 f0-f5 f5-f2';
    this.nodes = {};
    for (const [id, [x, z, door]] of Object.entries(N)) this.nodes[id] = { id, x, z, door, nb: [] };
    for (const e of E.split(' ')) { const [a, b] = e.split('-'); this.nodes[a].nb.push(this.nodes[b]); this.nodes[b].nb.push(this.nodes[a]); }
    this.patrolIds = ['bed', 'bed2', 'bath', 'study', 'study2', 'study3', 'h0', 'h2', 'h5', 'h7', 'kids', 'kids2', 'kids3', 'pass', 'dA', 'dB', 'dC', 'dE', 'f0', 'f2', 'f4', 'f5'];
  }
  nodeOpen(n) { return !n.door || !this.doors[n.door] || !this.doors[n.door].locked; }
  nearestNode(x, z, needLOS = true) {
    let best = null, bd = 1e9;
    for (const n of Object.values(this.nodes)) {
      if (!this.nodeOpen(n)) continue;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd && (!needLOS || d < 0.04 || this.clear(x, z, n.x, n.z, 0.6, true))) { bd = d; best = n; }
    }
    return best || (needLOS ? this.nearestNode(x, z, false) : null);
  }
  findPath(from, to) { // A*
    if (!from || !to) return [];
    const open = new Map([[from.id, { n: from, g: 0, f: 0, p: null }]]), done = new Set();
    while (open.size) {
      let cur = null; for (const v of open.values()) if (!cur || v.f < cur.f) cur = v;
      open.delete(cur.n.id); done.add(cur.n.id);
      if (cur.n === to) { const out = []; for (let c = cur; c; c = c.p) out.unshift(c.n); return out; }
      for (const nb of cur.n.nb) {
        if (done.has(nb.id) || !this.nodeOpen(nb)) continue;
        const g = cur.g + Math.hypot(nb.x - cur.n.x, nb.z - cur.n.z);
        const ex = open.get(nb.id);
        if (!ex || g < ex.g) open.set(nb.id, { n: nb, g, f: g + Math.hypot(nb.x - to.x, nb.z - to.z), p: cur });
      }
    }
    return [];
  }

  /* 충돌 · 시야 */
  // 선분이 막혀 있지 않은지 (y 높이에서), ignoreDoors 면 문은 무시
  clear(x0, z0, x1, z1, y, ignoreDoors = false, tallOnly = false) {
    const dx = x1 - x0, dz = z1 - z0;
    for (const c of this.colliders) {
      if (!c.on || y < c.y0 || y > c.y1) continue;
      if (ignoreDoors && c.tag === 'door') continue;
      if (tallOnly && c.tag === 'f') continue;
      let t0 = 0, t1 = 1;
      if (Math.abs(dx) < 1e-9) { if (x0 < c.x0 || x0 > c.x1) continue; } else { let a = (c.x0 - x0) / dx, b = (c.x1 - x0) / dx; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) continue; }
      if (Math.abs(dz) < 1e-9) { if (z0 < c.z0 || z0 > c.z1) continue; } else { let a = (c.z0 - z0) / dz, b = (c.z1 - z0) / dz; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) continue; }
      return false;
    }
    return true;
  }
  // 3D 광선 (카메라 충돌용) — 가장 가까운 충돌 거리
  ray(o, d, maxT) {
    let best = maxT;
    for (const c of this.colliders) {
      if (!c.on) continue;
      let t0 = 0, t1 = best;
      const ax = [[o.x, d.x, c.x0 - 0.12, c.x1 + 0.12], [o.y, d.y, c.y0 - 0.05, c.y1 + 0.05], [o.z, d.z, c.z0 - 0.12, c.z1 + 0.12]];
      let ok = true;
      for (const [p, v, mn, mx] of ax) {
        if (Math.abs(v) < 1e-9) { if (p < mn || p > mx) { ok = false; break; } continue; }
        let a = (mn - p) / v, b = (mx - p) / v; if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) { ok = false; break; }
      }
      if (ok && t0 > 0.02 && t0 < best) best = t0;
    }
    return best;
  }
  collide(p, r, yTop = 1.6, ignoreDoors = false) {
    for (let it = 0; it < 2; it++) for (const c of this.colliders) {
      if (!c.on || c.y0 > yTop || c.y1 < 0.15) continue;
      if (ignoreDoors && c.tag === 'door') continue;
      const cx = Math.max(c.x0, Math.min(p.x, c.x1)), cz = Math.max(c.z0, Math.min(p.z, c.z1));
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
      else { const l = p.x - c.x0, rr = c.x1 - p.x, t = p.z - c.z0, b = c.z1 - p.z, mn = Math.min(l, rr, t, b); if (mn === l) p.x = c.x0 - r; else if (mn === rr) p.x = c.x1 + r; else if (mn === t) p.z = c.z0 - r; else p.z = c.z1 + r; }
    }
  }

  /* 정적 메시 합치기 (모바일 드로우콜 줄이기) */
  mergeStatic() {
    this.st.updateMatrixWorld(true);
    const groups = new Map(), kill = [];
    this.st.traverse(o => {
      if (!o.isMesh || o.userData.dyn || o.userData.noMerge || Array.isArray(o.material)) return;
      let p = o.parent, skip = false; while (p) { if (p.userData.dyn) { skip = true; break; } p = p.parent; }
      if (skip) return;
      const g = o.geometry.index ? o.geometry.clone() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!groups.has(o.material)) groups.set(o.material, []);
      groups.get(o.material).push(g.index ? g : g); kill.push(o);
    });
    for (const o of kill) o.parent.remove(o);
    for (const [mat, list] of groups) {
      const idx = list.filter(g => g.index), non = list.filter(g => !g.index);
      for (const part of [idx, non]) {
        if (!part.length) continue;
        const merged = mergeGeometries(part, false); if (!merged) continue;
        const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = mat.transparent ? false : true; mesh.receiveShadow = true;
        this.scene.add(mesh);
      }
    }
    // 남은 동적/벽 메시도 그림자 받기
    this.scene.traverse(o => { if (o.isMesh && !o.material.transparent) { o.receiveShadow = true; if (o.userData.dyn) o.castShadow = true; } });
  }

  /* 조명: 가까운 등만 실제 빛을 켠다 */
  buildLights(n = 7) {
    this.pool = [];
    for (let i = 0; i < n; i++) { const l = new THREE.PointLight(0xffaa66, 0, 8, 2); this.scene.add(l); this.pool.push(l); }
    this.sorted = this.fixtures.slice();
  }
  update(dt, focus, monsterPos) {
    this.time += dt; const t = this.time;
    for (const a of this.anims) a(t);
    for (const d of Object.values(this.doors)) d.update(dt);
    for (const f of this.fixtures) {
      const md = monsterPos ? f.pos.distanceTo(monsterPos) : 99;
      let v = 1;
      if (!f.on) v = 0;
      else if (md < 6 && Math.random() < 0.35) v = Math.random() * 0.4; // 괴물이 가까우면 마구 깜빡임
      else if (f.type === 'candle') v = 0.82 + Math.sin(t * 9 + f.ph) * 0.08 + Math.sin(t * 23 + f.ph * 2) * 0.06;
      else if (f.type === 'fire') v = 0.7 + Math.sin(t * 6 + f.ph) * 0.15 + Math.random() * 0.15;
      else if (f.type === 'steady') v = 1;
      else {
        if (f.drop > 0) { f.drop -= dt; v = f.dropV; }
        else if (Math.random() < dt * (f.type === 'bad' ? 0.9 : 0.12)) { f.drop = 0.04 + Math.random() * (f.type === 'bad' ? 0.5 : 0.15); f.dropV = Math.random() * 0.25; v = f.dropV; }
        else v = 0.95 + Math.sin(t * 50 + f.ph) * 0.03;
      }
      f.cur = v;
      for (const b of f.bulbs) b.material.color.copy(b.userData.base).multiplyScalar(0.18 + 0.82 * v);
    }
    this.focusSort -= dt;
    if (this.focusSort <= 0) { this.focusSort = 0.3; this.sorted.sort((a, b) => a.pos.distanceToSquared(focus) - b.pos.distanceToSquared(focus)); }
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i], f = this.sorted[i];
      if (!f) { l.intensity = 0; continue; }
      const d = f.pos.distanceTo(focus), fade = Math.max(0, Math.min(1, (18 - d) / 6));
      l.position.copy(f.pos); l.color.copy(f.color); l.distance = f.range; l.intensity = f.power * f.cur * fade;
    }
    // 번개
    if (this.lightning > 0) { this.lightning -= dt; const k = this.lightning > 0.25 || (this.lightning > 0.1 && this.lightning < 0.17) ? 1 : 0.1; this.m.winGlow.color.setRGB(0.6 * k + 0.05, 0.65 * k + 0.07, 0.8 * k + 0.12); }
    else this.m.winGlow.color.setHex(0x0c1220);
  }
  reset() {
    for (const d of Object.values(this.doors)) d.reset();
    for (const it of this.items) { it.opened = false; it.taken = false; if (it.mesh) it.mesh.visible = true; if (it.lid) it.dr.rotation.x = 0; else it.dr.position.set(0, 0, 0); if (it.glint) it.glint.visible = false; }
    for (const i of this.inter) if (i.kind === 'diary') { i.mesh.visible = true; i.glint.visible = true; i.read = false; }
    for (const h of this.hides) for (const d of h.doors) { d.piv.rotation.y = 0; d.piv.visible = true; }
    const f = this.front; f.padlock = true; f.keypad = true; f.opening = false; f.chain.visible = true; f.col.on = true; f.outside.visible = false;
    f.doors.forEach(d => d.rotation.y = 0); f.screen.material.color.setHex(0x401010);
  }
}
