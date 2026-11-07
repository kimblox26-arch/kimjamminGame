// 블록 캐릭터 만들기 + 애니메이션
import * as THREE from 'three';
import { ITEM, DEFAULT_EQUIP } from './items.js';

const texCache = new Map();
const lam = (color, o = {}) => new THREE.MeshLambertMaterial({ color, ...o });

function canvasTex(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
  texCache.set(key, t);
  return t;
}

// ── 얼굴 ──
export function drawFace(g, id, S = 128) {
  const k = S / 128;
  g.save(); g.scale(k, k);
  g.fillStyle = '#111'; g.strokeStyle = '#111'; g.lineWidth = 6; g.lineCap = 'round';
  const eye = (x, y, w = 9, h = 15) => { g.beginPath(); g.ellipse(x, y, w, h, 0, 0, Math.PI * 2); g.fill(); };
  const arc = (y = 70, r = 30, a0 = 0.15, a1 = 0.85) => { g.beginPath(); g.arc(64, y, r, Math.PI * a0, Math.PI * a1); g.stroke(); };
  const heart = (x, y, s, col) => {
    g.fillStyle = col; g.beginPath(); g.moveTo(x, y + s * 0.9);
    g.bezierCurveTo(x - s * 1.4, y - s * 0.2, x - s * 0.6, y - s * 1.1, x, y - s * 0.3);
    g.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.4, y - s * 0.2, x, y + s * 0.9); g.fill(); g.fillStyle = '#111';
  };
  const star = (x, y, r, col) => {
    g.fillStyle = col; g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.fill(); g.fillStyle = '#111';
  };
  switch (id) {
    case 'face_grin': eye(44, 46); eye(84, 46); g.beginPath(); g.arc(64, 68, 30, 0, Math.PI); g.fill(); g.fillStyle = '#fff'; g.fillRect(40, 68, 48, 8); break;
    case 'face_wink': eye(44, 48); g.beginPath(); g.moveTo(74, 48); g.lineTo(94, 44); g.stroke(); arc(); break;
    case 'face_cool': g.fillRect(26, 36, 76, 20); g.fillRect(28, 44, 30, 18); g.fillRect(70, 44, 30, 18); g.beginPath(); g.arc(70, 78, 18, 0.1 * Math.PI, 0.7 * Math.PI); g.stroke(); break;
    case 'face_surprised': eye(44, 46, 10, 16); eye(84, 46, 10, 16); g.beginPath(); g.ellipse(64, 92, 10, 14, 0, 0, 7); g.fill(); break;
    case 'face_angry': eye(44, 54); eye(84, 54); g.beginPath(); g.moveTo(28, 30); g.lineTo(56, 42); g.moveTo(100, 30); g.lineTo(72, 42); g.stroke(); g.beginPath(); g.arc(64, 104, 22, 1.15 * Math.PI, 1.85 * Math.PI); g.stroke(); break;
    case 'face_hearts': heart(44, 48, 14, '#ff2a5c'); heart(84, 48, 14, '#ff2a5c'); arc(); break;
    case 'face_sleepy': g.beginPath(); g.moveTo(32, 50); g.lineTo(56, 50); g.moveTo(72, 50); g.lineTo(96, 50); g.stroke(); g.beginPath(); g.ellipse(64, 90, 8, 6, 0, 0, 7); g.fill(); g.font = 'bold 22px sans-serif'; g.fillText('z', 100, 30); break;
    case 'face_tongue': eye(44, 46); eye(84, 46); arc(66, 26); g.fillStyle = '#ff5f7e'; g.beginPath(); g.ellipse(72, 98, 10, 12, 0, 0, 7); g.fill(); break;
    case 'face_cat': eye(44, 46); eye(84, 46); g.beginPath(); g.arc(54, 80, 10, 0, Math.PI); g.arc(74, 80, 10, 0, Math.PI); g.stroke(); break;
    case 'face_blush': eye(44, 46); eye(84, 46); arc(); g.fillStyle = 'rgba(255,90,120,.55)'; g.beginPath(); g.ellipse(28, 72, 12, 7, 0, 0, 7); g.ellipse(100, 72, 12, 7, 0, 0, 7); g.fill(); break;
    case 'face_evil': g.beginPath(); g.moveTo(28, 36); g.lineTo(56, 50); g.lineTo(30, 54); g.fill(); g.beginPath(); g.moveTo(100, 36); g.lineTo(72, 50); g.lineTo(98, 54); g.fill(); g.beginPath(); g.moveTo(30, 76); g.quadraticCurveTo(64, 110, 98, 72); g.quadraticCurveTo(64, 92, 30, 76); g.fill(); break;
    case 'face_stars': star(44, 48, 16, '#ffcc00'); star(84, 48, 16, '#ffcc00'); g.beginPath(); g.arc(64, 72, 26, 0, Math.PI); g.fill(); break;
    case 'face_cry': eye(44, 46); eye(84, 46); g.fillStyle = '#4fb4ff'; g.fillRect(38, 60, 10, 34); g.fillRect(80, 60, 10, 34); g.fillStyle = '#111'; g.beginPath(); g.arc(64, 104, 18, 1.15 * Math.PI, 1.85 * Math.PI); g.stroke(); break;
    default: eye(44, 46); eye(84, 46); arc(); // face_smile
  }
  g.restore();
}

function headMats(skin, faceId, headless) {
  const side = lam(skin);
  const face = canvasTex(`face|${faceId}|${skin}`, 128, 128, (g, w, h) => { g.fillStyle = skin; g.fillRect(0, 0, w, h); drawFace(g, faceId); });
  const front = lam(0xffffff, { map: face });
  if (headless) [side, front].forEach(m => { m.visible = false; });
  return [side, side, side, side, front, side];
}

// ── 옷 텍스처 ──
function shirtTex(it, part) {
  return canvasTex(`shirt|${it.id}|${part}`, 64, 64, (g, w, h) => {
    const c = it.color, c2 = it.color2;
    g.fillStyle = c; g.fillRect(0, 0, w, h);
    const p = it.pattern;
    if (p === 'stripes') { g.fillStyle = c2; for (let y = 4; y < h; y += 14) g.fillRect(0, y, w, 6); }
    if (p === 'check') { g.fillStyle = c2; g.globalAlpha = .55; for (let i = 0; i < w; i += 16) { g.fillRect(i, 0, 6, h); g.fillRect(0, i, w, 6); } g.globalAlpha = 1; }
    if (p === 'rainbow') { const cs = ['#ff3b3b', '#ff9b2b', '#ffe12b', '#3bd16f', '#2b8bff', '#8b4bff']; cs.forEach((cc, i) => { g.fillStyle = cc; g.fillRect(0, i * h / 6, w, h / 6 + 1); }); }
    if (p === 'camo') { const r = mulberry(it.id.length * 99); for (let i = 0; i < 26; i++) { g.fillStyle = i % 2 ? c2 : '#6b7a3c'; g.beginPath(); g.ellipse(r() * w, r() * h, 4 + r() * 8, 3 + r() * 5, r() * 3, 0, 7); g.fill(); } }
    if (part === 'arm') {
      if (p === 'santa') { g.fillStyle = '#fff'; g.fillRect(0, h - 12, w, 12); }
      if (p === 'suit') { g.fillStyle = '#fff'; g.fillRect(0, h - 6, w, 6); }
      if (p === 'sport') { g.fillStyle = c2; g.fillRect(0, h - 8, w, 4); }
      return;
    }
    if (part !== 'front') return;
    g.fillStyle = c2;
    if (p === 'suit') { g.beginPath(); g.moveTo(20, 0); g.lineTo(32, 26); g.lineTo(44, 0); g.fill(); g.fillStyle = '#b81d24'; g.beginPath(); g.moveTo(29, 6); g.lineTo(35, 6); g.lineTo(37, 40); g.lineTo(32, 46); g.lineTo(27, 40); g.fill(); }
    if (p === 'santa') { g.fillRect(28, 0, 8, h); g.fillStyle = '#111'; g.fillRect(0, 40, w, 9); g.fillStyle = '#ffd43b'; g.fillRect(26, 39, 12, 11); g.fillStyle = '#111'; g.fillRect(29, 42, 6, 5); }
    if (p === 'heart' || p === 'star') {
      const x = 32, y = 30, s = 13; g.beginPath();
      if (p === 'heart') { g.moveTo(x, y + s * .9); g.bezierCurveTo(x - s * 1.4, y - s * .2, x - s * .6, y - s * 1.1, x, y - s * .3); g.bezierCurveTo(x + s * .6, y - s * 1.1, x + s * 1.4, y - s * .2, x, y + s * .9); }
      else for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? s * .45 : s * 1.1; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.fill();
    }
    if (p === 'hoodie') { g.fillRect(14, 36, 36, 14); g.strokeStyle = '#ddd'; g.lineWidth = 2; g.beginPath(); g.moveTo(26, 0); g.lineTo(26, 18); g.moveTo(38, 0); g.lineTo(38, 18); g.stroke(); }
    if (p === 'sport') { g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.fillText('10', 32, 46); }
    if (p === 'logo') { g.fillStyle = c2; g.fillRect(22, 18, 6, 28); g.beginPath(); g.moveTo(28, 32); g.lineTo(42, 18); g.lineTo(46, 22); g.lineTo(32, 34); g.lineTo(46, 46); g.lineTo(42, 48); g.fill(); }
  });
}

function pantsTex(it) {
  return canvasTex(`pants|${it.id}`, 32, 64, (g, w, h) => {
    g.fillStyle = it.color; g.fillRect(0, 0, w, h);
    const p = it.pattern;
    if (p === 'jeans') { g.fillStyle = it.color2; g.fillRect(14, 0, 2, h); g.fillRect(0, 6, w, 2); }
    if (p === 'suit') { g.fillStyle = it.color2; g.fillRect(15, 0, 2, h); }
    if (p === 'camo') { const r = mulberry(7); for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? it.color2 : '#6b7a3c'; g.beginPath(); g.ellipse(r() * w, r() * h, 3 + r() * 5, 2 + r() * 4, r() * 3, 0, 7); g.fill(); } }
    if (p === 'santa') { g.fillStyle = '#fff'; g.fillRect(0, h - 22, w, 8); g.fillStyle = '#111'; g.fillRect(0, h - 14, w, 14); }
    else { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, h - 7, w, 7); }
  });
}

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ── 기본 모양 도우미 ──
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cyl = (rt, rb, h, m, seg = 20) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
const sph = (r, m, seg = 16) => new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg * 0.75 | 0), m);
const dome = (r, m) => new THREE.Mesh(new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), m);
const cone = (r, h, m, seg = 16) => new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), m);
const at = (o, x, y, z, rx = 0, ry = 0, rz = 0) => { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o; };
function grp(...kids) { const g = new THREE.Group(); kids.forEach(k => g.add(k)); return g; }

// 모자: 머리 꼭대기(y=0), 머리 폭 1.2 기준
function buildHat(it) {
  const m = lam(it.color), w = lam(0xffffff), dark = lam(0x222222);
  switch (it.kind) {
    case 'cap': { const d = dome(0.7, m); d.scale.y = 0.6; return grp(at(d, 0, -0.08, 0), at(cyl(0.7, 0.7, 0.12, m), 0, -0.08, 0), at(box(1.0, 0.07, 0.65, m), 0, -0.05, 0.85)); }
    case 'tophat': return grp(at(cyl(0.68, 0.68, 0.06, m), 0, 0.03, 0), at(cyl(0.48, 0.48, 1.0, m), 0, 0.55, 0), at(cyl(0.49, 0.49, 0.16, lam(0xb01e1e)), 0, 0.15, 0));
    case 'crown': { const g = grp(at(cyl(0.6, 0.6, 0.3, lam(it.color, { emissive: 0x332200 }), 8), 0, 0.15, 0)); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; g.add(at(cone(0.12, 0.35, lam(it.color, { emissive: 0x332200 }), 4), Math.cos(a) * 0.52, 0.45, Math.sin(a) * 0.52)); g.add(at(sph(0.07, lam(i % 2 ? 0xff2244 : 0x22aaff), 8), Math.cos(a) * 0.6, 0.15, Math.sin(a) * 0.6)); } return g; }
    case 'santa': { const c = at(cone(0.62, 1.3, m), 0, 0.62, -0.1, -0.35, 0, 0); return grp(c, at(new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.14, 8, 24), w), 0, 0.02, 0, Math.PI / 2), at(sph(0.17, w), 0, 1.1, -0.55)); }
    case 'beanie': return grp(at(dome(0.68, m), 0, -0.1, 0), at(cyl(0.7, 0.7, 0.22, lam(0xffffff)), 0, -0.1, 0), at(sph(0.16, w), 0, 0.6, 0));
    case 'wizard': { const g = grp(at(cyl(0.95, 0.95, 0.05, m), 0, 0.02, 0), at(cone(0.55, 1.6, m), 0, 0.82, 0, 0, 0, 0.12)); g.add(at(cone(0.08, 0.16, lam(0xffe14d, { emissive: 0x665500 }), 5), 0.2, 0.7, 0.42, Math.PI / 2)); return g; }
    case 'bunny': return grp(at(box(0.22, 0.9, 0.12, m), -0.28, 0.45, 0, 0, 0, 0.15), at(box(0.22, 0.9, 0.12, m), 0.28, 0.45, 0, 0, 0, -0.15), at(box(0.12, 0.7, 0.02, lam(0xffa8c8)), -0.27, 0.45, 0.07, 0, 0, 0.15), at(box(0.12, 0.7, 0.02, lam(0xffa8c8)), 0.27, 0.45, 0.07, 0, 0, -0.15));
    case 'catears': return grp(at(cone(0.24, 0.45, m, 4), -0.38, 0.18, 0, 0, Math.PI / 4, 0.2), at(cone(0.24, 0.45, m, 4), 0.38, 0.18, 0, 0, Math.PI / 4, -0.2));
    case 'horns': return grp(at(cone(0.13, 0.55, m), -0.4, 0.2, 0.1, 0.2, 0, 0.45), at(cone(0.13, 0.55, m), 0.4, 0.2, 0.1, 0.2, 0, -0.45));
    case 'halo': return grp(at(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 8, 32), new THREE.MeshBasicMaterial({ color: it.color })), 0, 0.45, 0, Math.PI / 2));
    case 'headphones': return grp(at(new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.06, 6, 24, Math.PI), m), 0, -0.55, 0), at(cyl(0.25, 0.25, 0.18, lam(0xff3b5c)), -0.68, -0.6, 0, 0, 0, Math.PI / 2), at(cyl(0.25, 0.25, 0.18, lam(0xff3b5c)), 0.68, -0.6, 0, 0, 0, Math.PI / 2));
    case 'cowboy': { const brim = at(cyl(1.0, 1.0, 0.06, m), 0, 0.05, 0); brim.scale.set(1, 1, 0.85); return grp(brim, at(cyl(0.5, 0.58, 0.55, m), 0, 0.33, 0), at(cyl(0.59, 0.59, 0.1, lam(0x3a2412)), 0, 0.12, 0)); }
    case 'cone': return grp(at(box(1.1, 0.08, 1.1, m), 0, 0.04, 0), at(cone(0.5, 1.2, m), 0, 0.65, 0), at(cyl(0.3, 0.38, 0.18, w), 0, 0.5, 0));
    case 'valk': { const g = grp(at(sph(0.7, m), 0, -0.15, 0)); [-1, 1].forEach(s => { const wing = box(0.06, 0.55, 0.8, lam(0xffffff)); g.add(at(wing, s * 0.72, 0.2, -0.15, 0.4, 0, s * -0.4)); }); g.add(at(box(0.9, 0.12, 0.1, lam(0x2a6fff, { emissive: 0x0a2a80 })), 0, -0.35, 0.62)); return g; }
    case 'dom': { const g = grp(at(sph(0.72, m), 0, -0.2, 0)); g.add(at(cone(0.38, 0.6, m, 8), 0, 0.55, 0)); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.add(at(cone(0.08, 0.5, lam(0xc9d3ff, { emissive: 0x334488 }), 4), Math.cos(a) * 0.55, 0.3, Math.sin(a) * 0.55)); } g.add(at(box(1.0, 0.18, 0.05, new THREE.MeshBasicMaterial({ color: 0x7af0ff })), 0, -0.55, 0.62)); return g; }
  }
  return new THREE.Group();
}

function buildHair(it) {
  const m = lam(it.color);
  switch (it.kind) {
    case 'short': return grp(at(box(1.3, 0.3, 1.3, m), 0, 0.08, 0), at(box(1.3, 0.8, 0.25, m), 0, -0.3, -0.55), at(box(1.3, 0.2, 0.2, m), 0, -0.1, 0.56));
    case 'long': return grp(at(box(1.3, 0.3, 1.3, m), 0, 0.08, 0), at(box(1.32, 1.9, 0.3, m), 0, -0.8, -0.55), at(box(0.2, 1.4, 1.1, m), -0.63, -0.6, -0.05), at(box(0.2, 1.4, 1.1, m), 0.63, -0.6, -0.05));
    case 'pony': return grp(at(box(1.3, 0.28, 1.3, m), 0, 0.07, 0), at(box(1.3, 0.7, 0.25, m), 0, -0.25, -0.55), at(sph(0.25, m), 0, -0.2, -0.8), at(cyl(0.18, 0.06, 1.1, m), 0, -0.85, -0.85, 0.25));
    case 'spiky': { const g = grp(at(box(1.28, 0.25, 1.28, m), 0, 0.05, 0)); for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) g.add(at(cone(0.22, 0.6, m, 5), x * 0.4, 0.4, z * 0.4, z * -0.3, 0, x * -0.3)); return g; }
    case 'afro': return grp(at(sph(0.95, m, 12), 0, 0.1, -0.15));
    case 'bob': return grp(at(box(1.34, 0.32, 1.34, m), 0, 0.08, 0), at(box(1.36, 0.95, 0.28, m), 0, -0.45, -0.55), at(box(0.22, 0.95, 1.2, m), -0.64, -0.45, 0), at(box(0.22, 0.95, 1.2, m), 0.64, -0.45, 0), at(box(1.32, 0.25, 0.2, m), 0, -0.12, 0.58));
  }
  return new THREE.Group();
}

// 얼굴 장신구: 머리 앞면 중심 기준(z=0 이 얼굴 면, y=0 이 머리 중앙)
function buildFaceAcc(it) {
  const m = lam(it.color);
  switch (it.kind) {
    case 'sunglasses': return grp(at(box(0.42, 0.24, 0.05, m), -0.24, 0.12, 0.03), at(box(0.42, 0.24, 0.05, m), 0.24, 0.12, 0.03), at(box(1.24, 0.05, 0.05, m), 0, 0.2, 0.03));
    case 'glasses': { const r = new THREE.TorusGeometry(0.17, 0.03, 6, 20); return grp(at(new THREE.Mesh(r, m), -0.23, 0.12, 0.04), at(new THREE.Mesh(r, m), 0.23, 0.12, 0.04), at(box(0.14, 0.03, 0.03, m), 0, 0.14, 0.04)); }
    case 'mask': return grp(at(box(0.9, 0.42, 0.08, m), 0, -0.25, 0.04), at(box(1.24, 0.04, 0.04, lam(0xdddddd)), 0, -0.15, 0.02));
    case 'eyepatch': return grp(at(box(0.32, 0.3, 0.06, m), 0.24, 0.14, 0.04), at(box(1.24, 0.05, 0.04, m), 0, 0.26, 0.02, 0, 0, -0.15));
    case 'mustache': return grp(at(box(0.5, 0.1, 0.06, m), 0, -0.02, 0.04), at(box(0.16, 0.1, 0.06, m), -0.3, -0.07, 0.04, 0, 0, 0.5), at(box(0.16, 0.1, 0.06, m), 0.3, -0.07, 0.04, 0, 0, -0.5));
    case 'visor': return grp(at(box(1.28, 0.3, 0.08, new THREE.MeshBasicMaterial({ color: it.color, transparent: true, opacity: 0.8 })), 0, 0.12, 0.05));
  }
  return new THREE.Group();
}

// 목: 목 위치(y=0) 기준
function buildNeck(it) {
  const m = lam(it.color);
  switch (it.kind) {
    case 'scarf': { const t = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.16, 8, 20), m); t.scale.set(1.15, 0.85, 1); return grp(at(t, 0, -0.05, 0, Math.PI / 2), at(box(0.3, 0.9, 0.12, m), 0.35, -0.5, 0.55, 0.1, 0, 0.15)); }
    case 'bowtie': return grp(at(cone(0.16, 0.3, m, 4), -0.14, -0.15, 0.53, 0, 0, Math.PI / 2), at(cone(0.16, 0.3, m, 4), 0.14, -0.15, 0.53, 0, 0, -Math.PI / 2), at(box(0.1, 0.12, 0.1, m), 0, -0.15, 0.55));
    case 'chain': { const t = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.05, 6, 24), lam(it.color, { emissive: 0x332200 })); t.scale.set(1, 1.5, 1); return grp(at(t, 0, -0.35, 0.12, 1.25), at(box(0.22, 0.26, 0.06, lam(it.color, { emissive: 0x332200 })), 0, -0.82, 0.54)); }
  }
  return new THREE.Group();
}

// 등: 몸통 등 중앙 기준
function buildBack(it) {
  const m = lam(it.color, { side: THREE.DoubleSide });
  switch (it.kind) {
    case 'angel': case 'bat': case 'butterfly': {
      const g = new THREE.Group();
      [-1, 1].forEach(s => {
        let wing;
        if (it.kind === 'angel') { wing = sph(0.75, lam(it.color, { emissive: 0x666666 }), 14); wing.scale.set(1.9, 0.85, 0.14); }
        else if (it.kind === 'bat') { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(1.8, 0.6); sh.lineTo(1.6, -0.2); sh.lineTo(1.2, 0.1); sh.lineTo(0.9, -0.4); sh.lineTo(0.5, -0.1); sh.lineTo(0, -0.5); wing = new THREE.Mesh(new THREE.ShapeGeometry(sh), m); wing.scale.x = s; }
        else { wing = new THREE.Group(); const a = sph(0.6, lam(it.color, { transparent: true, opacity: 0.85 }), 12); a.scale.set(1.2, 1, 0.08); a.position.set(0.55, 0.35, 0); const b = sph(0.45, lam(0xff7ad9, { transparent: true, opacity: 0.85 }), 12); b.scale.set(1, 1, 0.08); b.position.set(0.45, -0.35, 0); wing.add(a, b); wing.scale.x = s; }
        if (it.kind === 'angel') at(wing, s * 1.25, 0.65, -0.35, 0, s * 0.45, s * 0.45);
        else at(wing, s * 0.15, 0.25, -0.2, 0, s * 0.35, 0);
        wing.userData.flap = s; g.add(wing);
      });
      g.userData.wings = true; return g;
    }
    case 'cape': { const c = box(1.9, 2.4, 0.06, m); c.geometry.translate(0, -1.2, 0); at(c, 0, 0.95, -0.12, 0.12); c.userData.cape = true; return grp(c); }
    case 'backpack': return grp(at(box(1.4, 1.5, 0.6, m), 0, 0, -0.3), at(box(1.1, 0.6, 0.15, lam(0x1d4cb3)), 0, -0.3, -0.65));
    case 'sword': return grp(at(box(0.18, 2.4, 0.06, lam(it.color)), 0, 0.5, -0.12, 0, 0, 0.6), at(box(0.7, 0.12, 0.14, lam(0xc49a2c)), -0.38, -0.25, -0.12, 0, 0, 0.6), at(box(0.12, 0.5, 0.12, lam(0x4a2a12)), -0.6, -0.55, -0.12, 0, 0, 0.6));
    case 'jetpack': { const g = grp(at(box(1.0, 0.5, 0.4, lam(0x555b66)), 0, 0.2, -0.25)); [-0.35, 0.35].forEach(x => { g.add(at(cyl(0.25, 0.25, 1.4, lam(it.color)), x, -0.1, -0.5)); g.add(at(cone(0.2, 0.35, new THREE.MeshBasicMaterial({ color: 0xff8a1a })), x, -1.0, -0.5, Math.PI)); }); g.userData.jet = true; return g; }
  }
  return new THREE.Group();
}

function buildAura(it) {
  const N = 40, pos = new Float32Array(N * 3), seeds = [];
  for (let i = 0; i < N; i++) seeds.push([Math.random() * Math.PI * 2, Math.random() * 6, 0.9 + Math.random() * 0.9, Math.random()]);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const size = it.id === 'aura_fire' ? 0.45 : it.id === 'aura_bubble' ? 0.35 : 0.25;
  const tex = canvasTex('aura|' + it.id, 32, 32, (g) => {
    if (it.id === 'aura_bubble') { g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(16, 16, 12, 0, 7); g.stroke(); }
    else if (it.id === 'aura_heart') { g.fillStyle = '#fff'; g.font = '28px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♥', 16, 18); }
    else { const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); }
  });
  const mat = new THREE.PointsMaterial({ color: it.color, size, map: tex, transparent: true, depthWrite: false, blending: it.id === 'aura_bubble' || it.id === 'aura_heart' ? THREE.NormalBlending : THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.update = (t) => {
    for (let i = 0; i < N; i++) {
      const [a, o, r, k] = seeds[i]; const life = ((t * (0.4 + k * 0.4) + o / 6) % 1);
      pos[i * 3] = Math.cos(a + t * 0.6) * r; pos[i * 3 + 1] = life * 6; pos[i * 3 + 2] = Math.sin(a + t * 0.6) * r;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return pts;
}

// ── 아바타 조립 ──
export function resolveLook(equip) {
  const e = { ...DEFAULT_EQUIP, ...equip };
  const g = s => ITEM[e[s]] || ITEM[DEFAULT_EQUIP[s]] || null;
  return { skin: g('skin'), head: g('head'), body: g('body'), rleg: g('rleg'), face: g('face'), shirt: g('shirt'), pants: g('pants'),
    hat: e.hat && ITEM[e.hat], hair: e.hair && ITEM[e.hair], faceacc: e.faceacc && ITEM[e.faceacc], neck: e.neck && ITEM[e.neck],
    back: e.back && ITEM[e.back], aura: e.aura && ITEM[e.aura], anim: g('anim') };
}

export function buildAvatar(equip) {
  const L = resolveLook(equip);
  const skin = L.skin.color, b = L.body, hs = L.head.size;
  const legH = 2 * b.leg, torH = 2 * b.torso, W = b.w;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const shirt = L.shirt, pants = L.pants;
  const tFront = lam(0xffffff, { map: shirtTex(shirt, 'front') }), tSide = lam(0xffffff, { map: shirtTex(shirt, 'side') });
  const torso = box(2 * W, torH, 1, [tSide, tSide, tSide, tSide, tFront, tSide]); torso.position.y = legH + torH / 2; body.add(torso);
  const armMat = lam(0xffffff, { map: shirtTex(shirt, 'arm') });
  const handMat = lam(skin);
  const mkArm = s => {
    const p = new THREE.Group(); p.position.set(s * (W + 0.5 * W), legH + torH - 0.5 * W, 0);
    const sleeve = box(W, torH * 0.7, 1, armMat); sleeve.position.y = -torH * 0.35 + 0.5 * W;
    const hand = box(W * 0.98, torH * 0.3, 0.98, handMat); hand.position.y = -torH * 0.85 + 0.5 * W;
    p.add(sleeve, hand); body.add(p); return p;
  };
  const la = mkArm(1), ra = mkArm(-1);
  const legMat = lam(0xffffff, { map: pantsTex(pants) });
  const mkLeg = (s, special) => {
    const p = new THREE.Group(); p.position.set(s * 0.5 * W, legH, 0);
    if (special?.koblox) {
      const dk = lam(0x1b2236), bone = lam(0xc9d2e3), glow = new THREE.MeshBasicMaterial({ color: 0x4aa3ff });
      p.add(at(box(0.7 * W, 0.55, 0.8, dk), 0, -0.28, 0), at(box(0.22, legH - 0.7, 0.22, bone), 0, -legH / 2 - 0.1, 0),
        at(box(0.5, 0.25, 0.5, dk), 0, -legH * 0.55, 0), at(box(0.12, 0.12, 0.12, glow), 0, -legH * 0.55, 0.26),
        at(box(0.55, 0.22, 0.9, dk), 0, -legH + 0.11, 0.08));
    } else if (special?.robot) {
      const mt = lam(0x9aa4b2), dk = lam(0x4a5260);
      p.add(at(box(W * 0.9, legH * 0.45, 0.9, mt), 0, -legH * 0.23, 0), at(cyl(0.22, 0.22, legH * 0.5, dk, 10), 0, -legH * 0.62, 0), at(box(W, 0.28, 1.05, mt), 0, -legH + 0.14, 0.05));
    } else { const l = box(W, legH, 1, legMat); l.position.y = -legH / 2; p.add(l); }
    body.add(p); return p;
  };
  const ll = mkLeg(1), rl = mkLeg(-1, L.rleg);
  const head = new THREE.Group(); head.position.y = legH + torH; body.add(head);
  const headMesh = box(hs[0], hs[1], hs[2], headMats(skin, L.face.id, L.head.headless)); headMesh.position.y = hs[1] / 2 + 0.02; head.add(headMesh);
  const neck = box(0.5 * W, 0.15, 0.5, handMat); neck.position.y = 0.02; if (!L.head.headless) head.add(neck);
  const sc = hs[0] / 1.2;
  if (L.hair && !L.head.headless) { const h = buildHair(L.hair); h.scale.set(hs[0] / 1.2, hs[1] / 1.2, hs[2] / 1.2); h.position.y = hs[1]; head.add(h); }
  if (L.hat) { const h = buildHat(L.hat); h.scale.setScalar(sc); h.position.y = hs[1] + (L.hair && !L.head.headless ? 0.12 : 0); head.add(h); }
  if (L.faceacc && !L.head.headless) { const f = buildFaceAcc(L.faceacc); f.scale.set(hs[0] / 1.2, hs[1] / 1.2, 1); f.position.set(0, hs[1] / 2, hs[2] / 2); head.add(f); }
  if (L.neck) { const n = buildNeck(L.neck); n.scale.set(W, 1, 1); n.position.y = 0; head.add(n); }
  let back = null;
  if (L.back) { back = buildBack(L.back); back.scale.set(W, b.torso, 1); back.position.set(0, legH + torH * 0.55, -0.5); body.add(back); }
  let aura = null;
  if (L.aura) { aura = buildAura(L.aura); root.add(aura); }
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  const height = legH + torH + hs[1];
  return { root, body, torso, head, la, ra, ll, rl, back, aura, legH, torH, height, anim: L.anim.id, look: L, t: 0, phase: 0 };
}

export function disposeAvatar(av) {
  av.root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); });
}

// st: { speed(0..), air(bool), emote(id|null), emoteT }
export function animateAvatar(av, dt, st = {}) {
  av.t += dt;
  const t = av.t, sp = Math.min((st.speed || 0) / 16, 1.4);
  const { la, ra, ll, rl, body, head } = av;
  [la, ra, ll, rl].forEach(p => p.rotation.set(0, 0, 0));
  body.position.set(0, 0, 0); body.rotation.set(0, 0, 0); head.rotation.set(0, 0, 0);
  let A = 0.9, f = 9, armOff = 0, armA = 1, legA = 1;
  switch (av.anim) {
    case 'anim_robot': f = 7; A = 0.6; break;
    case 'anim_ninja': f = 12; A = 1.1; armOff = 1.0; armA = 0.15; break;
    case 'anim_zombie': f = 6; A = 0.5; armOff = -1.5; armA = 0.15; break;
    case 'anim_stylish': f = 9; A = 1.2; break;
  }
  if (sp > 0.05) av.phase += dt * f * Math.max(sp, 0.5);
  let s = Math.sin(av.phase);
  if (av.anim === 'anim_robot') s = Math.sign(s) * Math.min(1, Math.abs(s) * 2);
  if (st.air) {
    la.rotation.z = 0.6; ra.rotation.z = -0.6; la.rotation.x = ra.rotation.x = -0.4 + armOff * 0.5; ll.rotation.x = -0.3; rl.rotation.x = 0.25;
  } else if (sp > 0.05) {
    const amp = A * Math.min(sp, 1);
    la.rotation.x = s * amp * armA + armOff; ra.rotation.x = -s * amp * armA + armOff;
    ll.rotation.x = -s * amp * legA; rl.rotation.x = s * amp * legA;
    if (av.anim === 'anim_stylish') body.rotation.y = s * 0.12;
    if (av.anim === 'anim_ninja') body.rotation.x = 0.15;
  } else {
    const br = Math.sin(t * 2) * 0.05;
    la.rotation.z = 0.04 + br; ra.rotation.z = -0.04 - br;
    if (av.anim === 'anim_zombie') { la.rotation.x = ra.rotation.x = -1.5 + br; }
    if (av.anim === 'anim_robot') { head.rotation.y = Math.round(Math.sin(t * 0.7) * 2) * 0.25; }
  }
  if (st.emote && !st.air) emotePose(av, st.emote, st.emoteT || 0);
  if (av.back) av.back.traverse(o => {
    if (o.userData.flap) o.rotation.y = o.userData.flap * (0.35 + Math.sin(t * 3) * 0.15);
    if (o.userData.cape) o.rotation.x = 0.12 + Math.min(sp, 1) * 0.7 + Math.sin(t * 4) * 0.04 + (st.air ? 0.4 : 0);
  });
  if (av.aura) av.aura.userData.update(t);
}

function emotePose(av, id, e) {
  const { la, ra, ll, rl, body } = av;
  switch (id) {
    case 'emote_wave': ra.rotation.z = -2.7 + Math.sin(e * 10) * 0.35; break;
    case 'emote_point': ra.rotation.x = -Math.PI / 2; ra.rotation.y = 0; break;
    case 'emote_cheer': la.rotation.z = 2.7 + Math.sin(e * 12) * 0.2; ra.rotation.z = -2.7 - Math.sin(e * 12) * 0.2; body.position.y = Math.abs(Math.sin(e * 6)) * 0.6; break;
    case 'emote_dance': { const s = Math.sin(e * 8); body.rotation.y = s * 0.5; body.position.y = Math.abs(s) * 0.3; la.rotation.z = s > 0 ? 2.6 : 0.4; ra.rotation.z = s > 0 ? -0.4 : -2.6; ll.rotation.x = s * 0.4; rl.rotation.x = -s * 0.4; break; }
    case 'emote_sit': ll.rotation.x = rl.rotation.x = -Math.PI / 2; body.position.y = -av.legH + 0.5; la.rotation.x = ra.rotation.x = -0.6; break;
    case 'emote_spin': body.rotation.y = e * 10; la.rotation.z = 1.4; ra.rotation.z = -1.4; break;
    case 'emote_flex': la.rotation.z = 1.6; ra.rotation.z = -1.6; la.rotation.x = ra.rotation.x = 0; la.rotation.y = -1.2 - Math.sin(e * 8) * 0.2; ra.rotation.y = 1.2 + Math.sin(e * 8) * 0.2; break;
  }
}
