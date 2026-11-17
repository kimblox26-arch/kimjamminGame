// 수능 감독관 — 사실적인 사람 모델: 그려 넣은 얼굴 · 머리카락 결 · 원단 노멀맵 · 손가락 · 1인칭 팔
import * as THREE from 'three';
import { R, merge, K, M, mkCanvas, ctex, rand, pick, normalFrom } from './world.js';

const PI = Math.PI, HP = PI / 2, C = {};
const hx = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const shade = (h, k) => { const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); const [r, g, b] = hx(h); return `rgb(${f(r)},${f(g)},${f(b)})`; };
const rgba = (h, a) => { const [r, g, b] = hx(h); return `rgba(${r},${g},${b},${a})`; };
const SP = (r, w = 20, h = 14, a, b, c, d) => new THREE.SphereGeometry(r, w, h, a, b, c, d);
const CY = (a, b, h, s = 16, open = false, t0, tl) => new THREE.CylinderGeometry(a, b, h, s, 1, open, t0, tl);
const CA = (r, l, s = 10) => new THREE.CapsuleGeometry(r, l, 4, s);
const TO = (r, t, rs = 8, ts = 24, arc = PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc);
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const LA = (pts, s = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), s);

export const SKIN = ['#efc9a6', '#e6b993', '#f3d3b5', '#ddae86', '#ebc29c'];
const HAIR = ['#161210', '#221913', '#2e2118', '#0f0f10', '#3d2b1d'];
const EYES = ['#4a2c1a', '#3b2416', '#5a3a22', '#2e1d12'];
const TOPS = ['#2b3a67', '#555b66', '#1f1f24', '#e6e6e4', '#6e2a36', '#2f5444', '#3d6aa0', '#5f4a86', '#1d2b40', '#121418', '#3a3d44', '#7d8590', '#24443a', '#8c2f2f', '#2d4f7c'];
const PANTS = ['#1f2536', '#18181c', '#363d4c', '#2b313b', '#455066', '#2b3a58'];
const SHOES = ['#f0f0ee', '#1a1a1a', '#b8302e', '#2b5aa8', '#e3ddcf', '#6d6f73'];

// ───────── 텍스처 ─────────
function faceMat(skin, o) {
  const key = ['f', skin, o.female, o.teacher, o.eye, o.brow].join(); if (C[key]) return C[key];
  const W = 1024, H = 512, cv = mkCanvas(W, H), g = cv.getContext('2d'), cx = 768;
  g.fillStyle = skin; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) { g.fillStyle = Math.random() < .5 ? `rgba(120,60,45,${rand(.01, .035)})` : `rgba(255,236,220,${rand(.01, .04)})`; g.fillRect(rand(0, W), rand(0, H), rand(1, 2.5), rand(1, 2.5)); }
  const rg = (x, y, r, col, a, sy = 1) => { g.save(); g.translate(x, y); g.scale(1, sy); const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(-r, -r, 2 * r, 2 * r); g.restore(); };
  for (const s of [-1, 1]) { rg(cx + s * 205, 250, 175, '95,45,30', .26, 1.5); rg(cx + s * 120, 385, 95, '95,45,30', .15, .8); }
  rg(cx, 175, 115, '255,242,228', .15, .55); rg(cx, 258, 16, '255,240,228', .16, 2.6);
  for (const s of [-1, 1]) rg(cx + s * 82, 302, 52, '232,105,95', o.female ? .22 : .1, .72);
  for (const s of [-1, 1]) rg(cx + s * 62, 245, 48, '85,45,38', .24, .5);
  rg(cx, 425, 145, '80,38,28', .22, .45); rg(cx, 382, 34, '255,236,222', .12, .55);
  for (const s of [-1, 1]) rg(cx + s * 17, 272, 13, '105,55,40', .22, 2.3);
  rg(cx, 293, 14, '255,238,225', .3, .8); rg(cx, 306, 25, '85,38,28', .26, .32);
  for (const s of [-1, 1]) { g.fillStyle = 'rgba(55,22,18,.62)'; g.beginPath(); g.ellipse(cx + s * 10, 303, 5.6, 2.6, s * .35, 0, 7); g.fill(); }
  for (const s of [-1, 1]) { g.strokeStyle = `rgba(110,55,40,${o.teacher ? .2 : .08})`; g.lineWidth = 3; g.beginPath(); g.moveTo(cx + s * 21, 300); g.quadraticCurveTo(cx + s * 35, 320, cx + s * 33, 344); g.stroke(); }
  rg(cx, 318, 8, '115,58,46', .15, 1.7);
  if (o.teacher) for (let i = 0; i < 6000; i++) { const a = rand(.1, PI - .1), r = rand(30, 150); g.fillStyle = `rgba(35,35,45,${rand(.02, .07)})`; g.fillRect(cx + Math.cos(a) * r * 1.15, 318 + Math.sin(a) * r * .62, 1.6, 1.6); }
  const lip = o.female ? '#c4666c' : '#b46c66';
  g.fillStyle = shade(lip, .72); g.beginPath(); g.moveTo(cx - 27, 335); g.bezierCurveTo(cx - 18, 327, cx - 8, 325, cx, 330); g.bezierCurveTo(cx + 8, 325, cx + 18, 327, cx + 27, 335); g.quadraticCurveTo(cx, 338, cx - 27, 335); g.fill();
  g.fillStyle = lip; g.beginPath(); g.moveTo(cx - 25, 336); g.quadraticCurveTo(cx, 339, cx + 25, 336); g.bezierCurveTo(cx + 16, 351, cx - 16, 351, cx - 25, 336); g.fill();
  g.strokeStyle = 'rgba(70,25,25,.75)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx - 27, 335); g.quadraticCurveTo(cx, 339, cx + 27, 335); g.stroke();
  rg(cx, 342, 10, '255,255,255', .22, .45); rg(cx, 358, 18, '85,38,28', .15, .45);
  const eye = (x, y, s) => {
    const ic = x - s * 21, oc = x + s * 22;
    g.save(); g.beginPath(); g.moveTo(ic, y + 1); g.quadraticCurveTo(x - s * 3, y - 14, oc, y - 2); g.quadraticCurveTo(x + s * 3, y + 10, ic, y + 1); g.closePath(); g.clip();
    g.fillStyle = '#ebe5de'; g.fillRect(x - 30, y - 20, 60, 40); rg(x, y - 9, 30, '90,55,45', .5, .45); rg(oc, y, 12, '120,70,60', .25);
    const ix = x + s, iy = y - 1.5, gr = g.createRadialGradient(ix, iy, 0, ix, iy, 10.5);
    gr.addColorStop(0, '#0a0606'); gr.addColorStop(.36, '#0a0606'); gr.addColorStop(.42, o.eye); gr.addColorStop(.85, shade(o.eye, .65)); gr.addColorStop(1, '#0f0806');
    g.fillStyle = gr; g.beginPath(); g.arc(ix, iy, 10.5, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.arc(ix + 3.5, iy - 4, 2.4, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.arc(ix - 3, iy + 3.5, 1.3, 0, 7); g.fill();
    g.restore();
    g.strokeStyle = '#1a1110'; g.lineCap = 'round'; g.lineWidth = o.female ? 3.8 : 2.9;
    g.beginPath(); g.moveTo(ic, y + 1); g.quadraticCurveTo(x - s * 3, y - 14, oc, y - 2); if (o.female) g.lineTo(oc + s * 5, y - 6); g.stroke();
    if (o.female) for (let k = 0; k < 8; k++) { const t = .3 + k * .085, px = (1 - t) * (1 - t) * ic + 2 * (1 - t) * t * (x - s * 3) + t * t * oc, py = (1 - t) * (1 - t) * (y + 1) + 2 * (1 - t) * t * (y - 14) + t * t * (y - 2); g.lineWidth = 1.2; g.beginPath(); g.moveTo(px, py); g.lineTo(px + s * 2 * t, py - 4); g.stroke(); }
    g.strokeStyle = 'rgba(80,40,35,.32)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(ic + s * 4, y - 8); g.quadraticCurveTo(x - s * 2, y - 20, oc - s * 2, y - 9); g.stroke();
    g.strokeStyle = 'rgba(90,45,40,.32)'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(ic + s * 3, y + 3); g.quadraticCurveTo(x + s * 3, y + 10, oc - s * 2, y + 1); g.stroke();
    g.fillStyle = 'rgba(205,110,110,.55)'; g.beginPath(); g.ellipse(ic + s * 2, y + 1, 2.5, 2, 0, 0, 7); g.fill();
  };
  eye(cx - 62, 250, -1); eye(cx + 62, 250, 1);
  for (const s of [-1, 1]) for (let k = 0; k < 130; k++) {
    const t = Math.random(), x0 = cx + s * 27, x1 = cx + s * 70, x2 = cx + s * 100, y0 = 225, y1 = 209, y2 = 221;
    const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * x1 + t * t * x2, y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * y1 + t * t * y2 + rand(-1, 1) * (5.5 - t * 3.5) * (o.female ? .7 : 1);
    const ang = s > 0 ? -.35 + t * .5 : PI + .35 - t * .5, l = rand(6, 11);
    g.strokeStyle = o.brow; g.globalAlpha = rand(.3, .7); g.lineWidth = rand(1, 2); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * l, y + Math.sin(ang) * l); g.stroke();
  }
  g.globalAlpha = 1;
  return (C[key] = new THREE.MeshStandardMaterial({ map: ctex(cv), roughness: .5, emissive: 0x3a1208, emissiveIntensity: .35 }));
}
const shade2 = (h, k) => '#' + hx(h).map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('');
export function skinMat(skin) { const k = 's' + skin; return C[k] || (C[k] = new THREE.MeshStandardMaterial({ color: skin, roughness: .52, emissive: 0x3a1208, emissiveIntensity: .35 })); }
function hairMats(col) {
  const key = 'h' + col; if (C[key]) return C[key];
  const mk = (card) => {
    const W = 256, H = 512, cv = mkCanvas(W, H), g = cv.getContext('2d');
    if (!card) { g.fillStyle = col; g.fillRect(0, 0, W, H); }
    for (let i = 0; i < 1500; i++) {
      const x = rand(-10, W + 10), len = card ? rand(.5, 1) * H : H;
      g.strokeStyle = shade(col, rand(.5, 1.9)); g.globalAlpha = card ? rand(.55, .95) : rand(.12, .4); g.lineWidth = rand(.6, 2.2);
      g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + rand(-8, 8), len * .33, x + rand(-10, 10), len * .66, x + rand(-12, 12), len); g.stroke();
    }
    g.globalAlpha = 1;
    if (card) { g.globalCompositeOperation = 'destination-over'; const gr = g.createLinearGradient(0, 0, 0, H * .62); gr.addColorStop(0, rgba(col, 1)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
    g.globalCompositeOperation = 'source-atop'; const sb = g.createLinearGradient(0, H * .1, 0, H * .42); sb.addColorStop(0, 'rgba(255,240,220,0)'); sb.addColorStop(.5, 'rgba(255,240,220,.16)'); sb.addColorStop(1, 'rgba(255,240,220,0)'); g.fillStyle = sb; g.fillRect(0, 0, W, H);
    return ctex(cv);
  };
  return (C[key] = { cap: new THREE.MeshStandardMaterial({ map: mk(false), roughness: .42 }), card: new THREE.MeshStandardMaterial({ map: mk(true), roughness: .45, alphaTest: .35, side: THREE.DoubleSide }) });
}
function fabricN(kind) {
  const key = 'n' + kind; if (C[key]) return C[key];
  const S = 256, c = mkCanvas(S, S), g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
  if (kind === 'quilt') { const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, '#202020'); gr.addColorStop(.12, '#9a9a9a'); gr.addColorStop(.5, '#f0f0f0'); gr.addColorStop(.88, '#9a9a9a'); gr.addColorStop(1, '#202020'); g.fillStyle = gr; g.fillRect(0, 0, S, S); }
  else if (kind === 'knit') { for (let y = 0; y < S; y += 8) for (let x = 0; x < S; x += 8) { g.fillStyle = '#c8c8c8'; g.beginPath(); g.ellipse(x + 2, y + 4, 2, 4, .5, 0, 7); g.ellipse(x + 6, y + 4, 2, 4, -.5, 0, 7); g.fill(); } }
  else if (kind === 'denim') { g.strokeStyle = '#b0b0b0'; g.lineWidth = 1.5; for (let i = -S; i < S; i += 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke(); } }
  else if (kind === 'suit') { g.strokeStyle = '#999'; g.lineWidth = 1; for (let i = -S; i < S; i += 3) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke(); } }
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? 0 : 255},${Math.random() < .5 ? 0 : 255},${Math.random() < .5 ? 0 : 255},${rand(0, .12)})`; g.fillRect(rand(0, S), rand(0, S), 1, 1); }
  const t = ctex(normalFrom(c, kind === 'quilt' ? 4 : 2), 1, 1, true);
  if (kind === 'quilt') t.repeat.set(1, 6); else t.repeat.set(kind === 'knit' ? 6 : 8, kind === 'knit' ? 6 : 8);
  return (C[key] = t);
}
export function clothMat(col, kind) {
  const key = 'c' + col + kind; if (C[key]) return C[key];
  const n = fabricN(kind), q = kind === 'quilt';
  return (C[key] = new THREE.MeshStandardMaterial({ color: col, roughness: q ? .45 : kind === 'suit' ? .72 : .9, normalMap: n, normalScale: new THREE.Vector2(q ? 1 : .5, q ? 1 : .5) }));
}

// ───────── 지오메트리 ─────────
const GA = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
function deform(g, front = .93, face = true) {
  const p = g.attributes.position, r = .118;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i); const nx = x / r, ny = y / r, nz = z / r;
    if (ny < 0) { const t = -ny; x *= 1 - .2 * t * t; z *= 1 - .07 * t; }
    z *= nz < 0 ? front : 1.05; y *= 1.1;
    if (ny < -.55 && nz < -.3) z -= .01 * (-ny - .55);
    if (face && nz < -.2) { // 얼굴 조각: 콧대·코끝·눈두덩·광대·입술·턱
      const w = Math.min(1, (-nz - .2) / .5);
      const dz = .017 * GA(nx, ny, 0, -.12, .07, .13) + .011 * GA(nx, ny, 0, -.22, .065, .055) - .007 * (GA(nx, ny, .36, .04, .13, .09) + GA(nx, ny, -.36, .04, .13, .09))
        + .004 * GA(nx, ny, 0, .2, .5, .06) + .005 * (GA(nx, ny, .46, -.14, .14, .12) + GA(nx, ny, -.46, -.14, .14, .12)) + .005 * GA(nx, ny, 0, -.5, .2, .07) + .006 * GA(nx, ny, 0, -.8, .22, .1);
      z -= dz * w;
    }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals(); return g;
}
function bandUV(g, t0, tl) { const uv = g.attributes.uv, lo = 1 - (t0 + tl) / PI, sc = PI / tl; for (let i = 0; i < uv.count; i++) uv.setY(i, (uv.getY(i) - lo) * sc); return g; }
const LAP = (pts, s, a, b) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), s, a, b);
function limb(len, r0, r1, mid = 1, s = 12) {
  const pts = [[0, -len - r1 * .55], [r1 * .72, -len - r1 * .4], [r1, -len]];
  for (let i = 1; i < 6; i++) { const t = i / 6; pts.push([r1 + (r0 - r1) * t + Math.sin(t * PI) * (mid - 1) * r0, -len + len * t]); }
  pts.push([r0, 0], [r0 * .72, r0 * .4], [0, r0 * .55]);
  return LA(pts, s);
}
function torso(sc = 1, female = false, sy = 1) {
  const p = female ? [[0, -.02], [.15, 0], [.168, .05], [.155, .13], [.128, .2], [.14, .27], [.162, .33], [.166, .4], [.156, .45], [.11, .5], [.064, .53], [0, .545]]
    : [[0, -.02], [.14, 0], [.155, .05], [.15, .13], [.14, .2], [.152, .27], [.172, .34], [.178, .41], [.17, .46], [.12, .5], [.066, .53], [0, .545]];
  const g = LA(p.map(([r, y]) => [r * sc, y * sy]), 22); g.scale(1, 1, .64); return g;
}
function handParts(side, curl = .5, y0 = -.21) {
  const p = [{ g: SP(.036, 12, 9), p: [0, y0 - .045, 0], s: [1.05, 1.2, .55] }];
  [.026, .03, .028, .022].forEach((l, i) => p.push({ g: CA(.0078, l, 8), p: [(-.021 + i * .014) * side, y0 - .1 - l * .25, .004 + curl * .014], r: [curl * .9, 0, 0] }));
  p.push({ g: CA(.009, .026, 8), p: [-side * .03, y0 - .055, .014], r: [.4, 0, side * .75] });
  return p;
}
function fist(side) {
  const p = [{ g: SP(.037, 16, 12), p: [0, -.045, 0], s: [1.05, 1.15, .62] }];
  for (let i = 0; i < 4; i++) p.push({ g: CA(.0082, .022, 8), p: [(-.021 + i * .014) * side, -.088, .012], r: [1.5, 0, 0] }, { g: SP(.0085, 8, 6), p: [(-.021 + i * .014) * side, -.08, .026] });
  p.push({ g: CA(.0095, .03, 8), p: [-side * .027, -.06, .022], r: [1.2, 0, side * .9] });
  return p;
}
function shoes(col, x) {
  return [{ g: SP(.05, 18, 12), c: col, p: [x, -.43, -.055], s: [1.04, .78, 2.35], k: K.shoe }, { g: SP(.052, 18, 10), c: '#f6f6f4', p: [x, -.462, -.055], s: [1.08, .3, 2.45], k: K.rubber },
    { g: CY(.047, .05, .03, 16), c: '#f0f0f0', p: [x, -.4, 0], k: K.cloth }, { g: B(.03, .004, .008), c: '#fff', p: [x, -.396, -.09], k: K.cloth }, { g: B(.03, .004, .008), c: '#fff', p: [x, -.4, -.11], k: K.cloth }];
}
function headMeshes(group, o) {
  const face = M(deform(SP(.118, 40, 28)), faceMat(o.skin, o)); face.position.y = .13; group.add(face);
  group.add(M(merge([{ g: SP(.026, 14, 10), p: [-.116, .125, .006], s: [.42, 1, .78] }, { g: SP(.026, 14, 10), p: [.116, .125, .006], s: [.42, 1, .78] }]), skinMat(shade2(o.skin, .9)), false));
  const m = hairMats(o.hair), cap = [], card = [], buzz = o.style === 'buzz', hl = o.female ? 1.28 : buzz ? 1.1 : 1.18;
  cap.push({ g: deform(SP(.1222, 30, 12, 0, 2 * PI, 0, hl - .2), .95, false), p: [0, .133, .004] });
  card.push({ g: bandUV(deform(SP(.1245, 36, 14, 0, 2 * PI, 0, hl), .95, false), 0, hl), p: [0, .133, .004] });
  const bt = buzz ? 1.85 : 2.05; card.push({ g: bandUV(SP(.1255, 26, 8, HP - 1.8, 3.6, 1.0, bt - 1.0), 1.0, bt - 1.0), p: [0, .133, .006], s: [1, 1.1, 1.05] });
  cap.push({ g: SP(.1215, 22, 6, HP - 1.75, 3.5, 1.0, bt - 1.12), p: [0, .133, .006], s: [1, 1.1, 1.05] });
  if (!buzz) card.push({ g: LAP(o.female ? [[.132, .168], [.135, .2], [.13, .235], [.112, .262]] : [[.132, .19], [.134, .215], [.12, .252]], 30, PI - 1.0, 2.0), p: [0, 0, 0] });
  if (o.style === 'long') { card.push({ g: LAP([[.158, -.2], [.152, -.1], [.144, 0], [.137, .08], [.13, .15], [.118, .205], [.095, .24], [.06, .262]], 26, -1.85, 3.7) }); for (const s of [-1, 1]) card.push({ g: LAP([[.138, -.1], [.134, .03], [.128, .14]], 8, s > 0 ? HP + .05 : -HP - .55, .5) }); }
  if (o.style === 'bob') card.push({ g: LAP([[.152, -.02], [.147, .05], [.137, .12], [.12, .2], [.095, .24], [.06, .262]], 26, -2.1, 4.2) });
  if (o.style === 'pony') cap.push({ g: SP(.03, 12, 10), p: [0, .17, .125] }, { g: LA([[0, -.22], [.016, -.19], [.03, -.09], [.033, 0], [0, .02]], 14), p: [0, .16, .14], r: [.35, 0, 0] });
  if (o.style === 'two') cap.push({ g: SP(.07, 18, 10), p: [0, .222, -.005], s: [1.3, .62, 1.4] });
  group.add(M(merge(cap), m.cap)); group.add(M(merge(card), m.card, false));
  return face;
}

// ───────── 학생 ─────────
export function studentBody(st) {
  const female = Math.random() < .5, skin = pick(SKIN), hair = pick(HAIR), top = pick(TOPS), pants = pick(PANTS), shoe = pick(SHOES);
  const style = female ? pick(['long', 'long', 'pony', 'bob']) : pick(['short', 'short', 'two', 'buzz']);
  const cloth = pick(['hoodie', 'padding', 'sweater', 'hoodie', 'padding', 'zip']), kind = cloth === 'padding' ? 'quilt' : cloth === 'sweater' ? 'knit' : 'cotton';
  const topM = clothMat(top, kind), pantM = clothMat(pants, Math.random() < .5 ? 'denim' : 'cotton'), skinM = skinMat(skin), puffy = cloth === 'padding';
  const fig = new THREE.Group(); fig.position.set(0, .52, .14); st.seat.add(fig); st.fig = fig;
  st.thigh = new THREE.Group(); st.thigh.rotation.x = HP; fig.add(st.thigh);
  st.thigh.add(M(merge([-1, 1].map((s) => ({ g: limb(.42, .086, .06, 1.05), p: [s * .1, 0, 0] }))), pantM));
  st.shin = new THREE.Group(); st.shin.position.y = -.42; st.shin.rotation.x = -HP; st.thigh.add(st.shin);
  st.shin.add(M(merge([-1, 1].map((s) => ({ g: limb(.39, .058, .043, 1.08), p: [s * .1, 0, 0] }))), pantM));
  st.shin.add(M(merge([...shoes(shoe, -.1), ...shoes(shoe, .1)]), R.mV, false));
  st.spine = new THREE.Group(); st.spine.position.set(0, 0, .03); fig.add(st.spine);
  const tp = [{ g: torso(puffy ? 1.1 : 1, female) }], tv = [];
  if (cloth === 'hoodie') { tp.push({ g: TO(.088, .042, 10, 18), p: [0, .49, .072], r: [1.25, 0, 0] }, { g: SP(.1, 16, 10), p: [0, .14, -.088], s: [1, .5, .25] }); tv.push({ g: CY(.004, .004, .15, 6), c: '#eee', p: [-.03, .38, -.108], k: K.cloth }, { g: CY(.004, .004, .15, 6), c: '#eee', p: [.03, .38, -.108], k: K.cloth }); }
  if (puffy) { tp.push({ g: CY(.085, .095, .08, 20), p: [0, .5, 0] }); tv.push({ g: B(.006, .4, .008), c: '#c8ccd0', p: [0, .27, -.118], k: K.chrome }, { g: B(.012, .03, .006), c: '#d8dce0', p: [0, .47, -.114], k: K.chrome }); }
  if (cloth === 'zip') tv.push({ g: B(.006, .44, .008), c: '#b8bcc0', p: [0, .26, -.11], k: K.chrome });
  if (cloth === 'sweater') tp.push({ g: TO(.06, .016, 8, 22), p: [0, .5, 0], r: [HP, 0, 0] });
  st.spine.add(M(merge(tp), topM)); if (tv.length) st.spine.add(M(merge(tv)));
  st.spine.add(M(merge([{ g: CY(.046, .052, .12, 18), p: [0, .5, 0] }]), skinMat(shade2(skin, .86))));
  st.head = new THREE.Group(); st.head.position.y = .56; st.spine.add(st.head);
  st.headMesh = headMeshes(st.head, { skin, hair, style, female, eye: pick(EYES), brow: shade(hair, 1.1) });
  const ar = puffy ? 1.16 : 1;
  const arm = (s) => {
    const sh = new THREE.Group(); sh.position.set(s * .195, .45, 0); st.spine.add(sh);
    sh.add(M(merge([{ g: limb(.27, .058 * ar, .046 * ar, 1.04) }, { g: SP(.064 * ar, 16, 12), p: [0, -.01, 0] }]), topM));
    const el = new THREE.Group(); el.position.y = -.27; sh.add(el);
    el.add(M(merge([{ g: limb(.19, .046 * ar, .04 * ar, 1.02) }, { g: TO(.037, .007, 8, 18), p: [0, -.19, 0], r: [HP, 0, 0] }]), topM));
    el.add(M(merge(handParts(s, s > 0 ? .95 : .45)), skinM, false));
    if (s > 0) el.add(M(merge([{ g: CY(.0016, .0072, .15, 8), c: '#f5c400', p: [0, -.27, .06], r: [2.04, 0, 0], k: K.gloss }, { g: CY(.0016, .0068, .03, 8), c: '#2a2a2a', p: [0, -.305, .128], r: [2.04, 0, 0], k: K.metal }])));
    return { sh, el };
  };
  st.armL = arm(-1); st.armR = arm(1);
}

// ───────── 감독관 (3인칭 · 학생 모드 NPC) ─────────
const TSKIN = '#e6bb96';
export function teacherBody(T) {
  const suitM = clothMat('#222a3c', 'suit'), pantM = clothMat('#262a33', 'suit'), shirtM = clothMat('#f3f3f1', 'cotton'), skinM = skinMat(TSKIN);
  const leg = (s) => {
    const p = new THREE.Group(); p.position.set(s * .1, .92, 0); T.root.add(p);
    p.add(M(merge([{ g: limb(.86, .09, .058, 1.04) }]), pantM));
    p.add(M(merge([{ g: SP(.052, 18, 12), c: '#141414', p: [0, -.86, -.05], s: [1, .72, 2.45], k: K.leather }, { g: SP(.054, 16, 10), c: '#0a0a0a', p: [0, -.895, -.05], s: [1.05, .28, 2.5], k: K.rubber }])));
    return p;
  };
  T.legL = leg(-1); T.legR = leg(1);
  T.body = new THREE.Group(); T.body.position.y = .92; T.root.add(T.body);
  T.body.add(M(merge([{ g: torso(1.16, false, 1.15) }, { g: EXs([[0, .02], [.05, -.04], [.04, -.3], [0, -.32]], .01), p: [-.05, .6, -.128], r: [0, .25, 0] }, { g: EXs([[0, .02], [-.05, -.04], [-.04, -.3], [0, -.32]], .01), p: [.05, .6, -.128], r: [0, -.25, 0] }]), suitM));
  T.body.add(M(merge([{ g: EXs([[-.06, .02], [.06, .02], [0, -.2]], .006), p: [0, .6, -.124] }, { g: TO(.056, .013, 8, 20), p: [0, .62, 0], r: [HP, 0, 0], s: [1, .8, 1] }]), shirtM));
  T.body.add(M(merge([
    { g: B(.032, .028, .02), c: '#a51c2c', p: [0, .6, -.14], k: [.4, 0] }, { g: EXs([[0, .012], [.022, -.22], [0, -.25], [-.022, -.22]], .007), c: '#b8202f', p: [0, .585, -.138], k: [.4, 0] },
    { g: SP(.011, 10, 8), c: '#111', p: [0, .28, -.14], k: K.gloss }, { g: SP(.011, 10, 8), c: '#111', p: [0, .19, -.138], k: K.gloss },
    { g: CY(.205, .205, .04, 26), c: '#33200f', p: [0, .1, 0], s: [1, 1, .66], k: K.leather }, { g: B(.042, .03, .01), c: '#d8c06a', p: [0, .1, -.137], k: K.chrome },
    { g: B(.06, .085, .004), c: '#fff', p: [.1, .35, -.136], k: K.gloss }, { g: B(.06, .02, .005), c: '#1a4fb0', p: [.1, .385, -.137], k: K.plastic },
    { g: B(.007, .2, .004), c: '#1a4fb0', p: [.07, .48, -.134], r: [0, 0, -.3], k: K.cloth }, { g: B(.007, .2, .004), c: '#1a4fb0', p: [.13, .48, -.132], r: [0, 0, .3], k: K.cloth },
    { g: B(.045, .014, .005), c: '#fafafa', p: [-.11, .45, -.132], k: K.cloth },
  ])));
  T.body.add(M(merge([{ g: CY(.056, .062, .12, 18), p: [0, .66, 0] }]), skinMat(shade2(TSKIN, .86))));
  T.head = new THREE.Group(); T.head.position.y = .7; T.body.add(T.head);
  headMeshes(T.head, { skin: TSKIN, hair: '#221e1b', style: 'two', female: false, teacher: true, eye: '#2e1d12', brow: '#1d1916' });
  const gl = '#aeb4bc';
  T.head.add(M(merge([{ g: TO(.034, .0032, 6, 22), c: gl, p: [-.046, .135, -.128], s: [1.05, .85, 1], k: K.chrome }, { g: TO(.034, .0032, 6, 22), c: gl, p: [.046, .135, -.128], s: [1.05, .85, 1], k: K.chrome }, { g: B(.02, .004, .004), c: gl, p: [0, .14, -.128], k: K.chrome }, { g: B(.004, .004, .13), c: gl, p: [-.122, .138, -.06], k: K.chrome }, { g: B(.004, .004, .13), c: gl, p: [.122, .138, -.06], k: K.chrome }, { g: B(.042, .004, .004), c: gl, p: [-.1, .138, -.125], k: K.chrome }, { g: B(.042, .004, .004), c: gl, p: [.1, .138, -.125], k: K.chrome }]), R.mV, false));
  const arm = (s) => {
    const sh = new THREE.Group(); sh.position.set(s * .255, .56, 0); T.body.add(sh);
    sh.add(M(merge([{ g: limb(.3, .068, .054, 1.03) }, { g: SP(.074, 16, 12), p: [0, -.01, 0] }]), suitM));
    const el = new THREE.Group(); el.position.y = -.3; sh.add(el);
    el.add(M(merge([{ g: limb(.24, .054, .045, 1.02) }]), suitM)); el.add(M(merge([{ g: CY(.046, .046, .03, 16), p: [0, -.235, 0] }]), shirtM));
    el.add(M(merge(handParts(s, .35, -.25)), skinM));
    if (s < 0) el.add(M(merge([{ g: CY(.046, .046, .02, 18), c: '#c9ced6', p: [0, -.225, 0], k: K.chrome }, { g: CY(.017, .017, .008, 16), c: '#1a1a1a', p: [0, -.225, -.045], r: [HP, 0, 0], k: K.gloss }])));
    return { sh, el };
  };
  T.armL = arm(-1); T.armR = arm(1);
}
function EXs(pts, depth) {
  const sh = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: .002, bevelSize: .002, bevelSegments: 1 }); g.translate(0, 0, -depth / 2); return g;
}

// ───────── 1인칭 팔 (화면용) ─────────
export function viewArms() {
  const suitM = clothMat('#222a3c', 'suit'), shirtM = clothMat('#f3f3f1', 'cotton'), skinM = skinMat(TSKIN);
  const mk = (s) => {
    const a = new THREE.Group();
    a.add(M(merge([{ g: limb(.36, .06, .047, 1.03, 22) }]), suitM, false));
    a.add(M(merge([{ g: CY(.046, .047, .035, 20), p: [0, -.352, 0] }]), shirtM, false));
    const hand = new THREE.Group(); hand.position.y = -.37; a.add(hand);
    hand.add(M(merge(fist(s)), skinM, false));
    if (s < 0) a.add(M(merge([{ g: CY(.049, .049, .022, 22), c: '#c9ced6', p: [0, -.335, 0], k: K.chrome }, { g: CY(.019, .019, .008, 18), c: '#151515', p: [0, -.335, .05], r: [HP, 0, 0], k: K.gloss }]), R.mV, false));
    return { a, hand };
  };
  return { r: mk(1), l: mk(-1) };
}
