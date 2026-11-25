// 밤의 도시: 3×3 블록 (약 300m), 건물(불 켜진 창문·1층 간판·옥상 십자가), 가로등, 가로수, 횡단보도, 신호등, 버스정류장,
// 움직이는 차량(승용차·택시·시내버스) — 플레이어가 걸어 다닐 수 있고 건물엔 부딪힘
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tex, pbr } from './tex.js';

const FONT = '"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
const WIND = { value: 0 };
const R = (a) => a[Math.random() * a.length | 0], rnd = (a, b) => a + Math.random() * (b - a);
function ctex(w, h, draw, repeat = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
// 도로망: 큰길(z 6.6~14.4, x 방향) + 세로길 x=-45, x=50 + 뒷길 z=-70
export const ROADS = { main: { z0: 6.6, z1: 14.4 }, back: { z0: -76, z1: -68 }, cross: [-45, 50], NS: [-330, -235, -140, -45, 50, 145, 240, 335], X0: -385, X1: 385, Z0: -285, Z1: 225 };
ROADS.EW = [{ z0: -236, z1: -228 }, { z0: -156, z1: -148 }, ROADS.back, ROADS.main, { z0: 86, z1: 94 }, { z0: 166, z1: 174 }];
const ROADW = 8;

// 건물 외벽 (창문 불빛은 발광 텍스처)
function facade(kind) {
  return ctex(1024, 1024, (g, w, h) => {
    const base = { apt: '#bdb3a2', office: '#1d2833', old: '#8f8a80', brick: '#7a3d2c', stone: '#3b3f45', glass: '#16202c' }[kind];
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    if (kind === 'brick') for (let y = 0; y < h; y += 8) for (let x = (y / 8 % 2) * 12; x < w; x += 24) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x, y, 1, 8); g.fillRect(0, y, w, 1); }
    const floors = 4, bays = 4;
    for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) {
      const x = b * w / bays, y = f * h / floors, on = Math.random() < (kind === 'office' ? 0.35 : 0.42);
      const wx = x + 14, wy = y + 22, ww = w / bays - 28, wh = h / floors - 50;
      const col = on ? R(['#ffd99a', '#ffe9c2', '#cfe6ff', '#fff4d6', '#ffcf7a']) : R(['#0c1016', '#131a22', '#0a0d12']);
      if (kind === 'office' || kind === 'glass') { g.fillStyle = col; g.fillRect(x + 3, y + 6, w / bays - 6, h / floors - 12); g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x + 3, y + 6, w / bays - 6, 4); }
      else {
        g.fillStyle = col; g.fillRect(wx, wy, ww, wh);
        if (on && Math.random() < 0.5) { g.fillStyle = 'rgba(80,60,40,.5)'; g.fillRect(wx, wy, ww * 0.45, wh); } // 커튼
        g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(wx + ww / 2 - 1, wy, 2, wh);
        if (kind === 'apt') { g.fillStyle = '#d8d0c2'; g.fillRect(x + 6, wy + wh, w / bays - 12, 10); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 6, wy + wh + 10, w / bays - 12, 4); }
        g.fillStyle = 'rgba(230,230,225,.5)'; g.fillRect(wx - 4, wy - 4, ww + 8, 4); g.fillRect(wx - 4, wy + wh, ww + 8, 6);   // 창틀
      }
      // 세월 흔적: 창 아래로 흘러내린 빗물 자국
      if (kind !== 'glass') for (let k = 0; k < 3; k++) { const sx = x + 20 + Math.random() * (w / bays - 40), sy = y + h / floors - 26, sl = 40 + Math.random() * 120; const gr = g.createLinearGradient(0, sy, 0, sy + sl); gr.addColorStop(0, `rgba(20,18,15,${0.18 + Math.random() * 0.2})`); gr.addColorStop(1, 'rgba(20,18,15,0)'); g.fillStyle = gr; g.fillRect(sx, sy, 2 + Math.random() * 6, sl); }
    }
    // 얼룩 반점·이끼·밑동 때
    if (kind !== 'glass') { for (let i = 0; i < 40; i++) { const r = 10 + Math.random() * 60, x = Math.random() * w, y = Math.random() * h; const gr = g.createRadialGradient(x, y, 1, x, y, r); gr.addColorStop(0, `rgba(${Math.random() < 0.2 ? '40,60,30' : '30,25,20'},${0.06 + Math.random() * 0.1})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
      const gb = g.createLinearGradient(0, h * 0.85, 0, h); gb.addColorStop(0, 'rgba(25,20,15,0)'); gb.addColorStop(1, 'rgba(25,20,15,.35)'); g.fillStyle = gb; g.fillRect(0, h * 0.85, w, h * 0.15); }
  });
}
// 같은 그림에서 불 켜진 창만 남긴 발광맵
function emissiveOf(tex) { const c = tex.image, d = document.createElement('canvas'); d.width = c.width; d.height = c.height; const g = d.getContext('2d'); g.drawImage(c, 0, 0); const im = g.getImageData(0, 0, d.width, d.height), p = im.data; for (let i = 0; i < p.length; i += 4) { const l = (p[i] + p[i + 1] + p[i + 2]) / 3; if (l < 170) p[i] = p[i + 1] = p[i + 2] = 0; } g.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(d); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
// 1층 가게 간판 (한국 거리)
const SHOPS = [['치킨', '#ffcc00', '#c1121f'], ['PC방', '#00e5ff', '#101820'], ['약국', '#ffffff', '#2a9d8f'], ['카페', '#f4e1c1', '#3e2723'], ['부동산', '#ffffff', '#1d3557'], ['미용실', '#ff66c4', '#1a1a1a'],
  ['노래연습장', '#ff4dd2', '#14002e'], ['고깃집', '#ffffff', '#8b0000'], ['분식', '#ffef5a', '#e63946'], ['세탁소', '#ffffff', '#1e88e5'], ['꽃집', '#fff', '#2e7d32'], ['24시 국밥', '#ff5252', '#300'], ['편의점', '#ffffff', '#0b6e4f'], ['호프', '#ffd166', '#5a189a']];
const signTex = ctex(2048, 1024, (g, w, h) => {
  SHOPS.forEach(([t, fg, bg], i) => { const x = (i % 4) * 512, y = Math.floor(i / 4) * 256; g.fillStyle = bg; g.fillRect(x + 4, y + 4, 504, 248); g.fillStyle = fg; g.font = `900 ${t.length > 4 ? 84 : 120}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = fg; g.shadowBlur = 18; g.fillText(t, x + 256, y + 128); g.shadowBlur = 0; });
}, false);
const shutterTex = ctex(256, 128, (g, w, h) => { g.fillStyle = '#8a8f96'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 6) { g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, y, w, 2); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, y + 4, w, 2); }
  for (let i = 0; i < 3; i++) { g.fillStyle = `hsla(${Math.random() * 360},60%,${40 + Math.random() * 30}%,.55)`; g.font = `900 ${20 + Math.random() * 20}px sans-serif`; g.fillText(['RENT', '임대', 'TAG', '♥', 'NO PARKING'][Math.random() * 5 | 0], Math.random() * w * 0.7, 30 + Math.random() * (h - 40)); } g.fillStyle = '#f2f2f2'; g.fillRect(w * 0.7, h * 0.3, 40, 54); g.fillStyle = '#333'; g.font = '700 8px sans-serif'; g.fillText('임대문의', w * 0.7 + 3, h * 0.3 + 14); });
const aptNumTex = ctex(1024, 512, (g, w, h) => { g.fillStyle = '#bdb3a2'; g.fillRect(0, 0, w, h); for (let i = 0; i < 16; i++) { const x = (i % 4) * 256, y = Math.floor(i / 4) * 128; g.fillStyle = '#2b3a55'; g.font = `900 84px ${FONT}`; g.textAlign = 'center'; g.fillText(`${101 + i}동`, x + 128, y + 96); } }, false);
const winTex = ctex(512, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#fff1d6'); gr.addColorStop(1, '#c9a66b'); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(${60 + Math.random() * 80},${40 + Math.random() * 60},30,.5)`; g.fillRect(Math.random() * w, h * 0.45 + Math.random() * h * 0.5, 20 + Math.random() * 60, 30 + Math.random() * 60); } g.fillStyle = 'rgba(20,20,20,.8)'; for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 6, h); });

export function buildCity(scene, { onCollider, holes = [] }) {
  const root = new THREE.Group(); scene.add(root);
  const geos = new Map(); const add = (mat, g) => { if (!geos.has(mat)) geos.set(mat, []); geos.get(mat).push(g.index ? g.toNonIndexed() : g); };
  const box = (mat, sx, sy, sz, x, y, z) => add(mat, new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z));
  const M = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, envMapIntensity: 0.2, ...o });
  const { X0, X1, Z0, Z1, NS, EW } = ROADS, W2 = ROADW / 2, SIDE = 3.2;
  const inHole = (x, z, pad = 1.5) => holes.some(h => x > h.x0 - pad && x < h.x1 + pad && z > h.z0 - pad && z < h.z1 + pad);
  // 바닥: 아스팔트(젖은 듯 반사) · 보도블록(지하도 입구 구멍 뚫림) · 연석
  const asph = ctex(512, 512, (g, w, h) => { g.fillStyle = '#1a1c20'; g.fillRect(0, 0, w, h); for (let i = 0; i < 16000; i++) { const v = Math.random(); g.fillStyle = `rgba(${v < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.07})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } for (let i = 0; i < 6; i++) { g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(Math.random() * w, Math.random() * h); for (let k = 0; k < 5; k++) g.lineTo(Math.random() * w, Math.random() * h); g.stroke(); } });
  const pave = ctex(256, 256, (g, w, h) => { g.fillStyle = '#5f5a54'; g.fillRect(0, 0, w, h); for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) { g.fillStyle = `hsl(25,${6 + Math.random() * 8}%,${32 + Math.random() * 10}%)`; g.fillRect(x * 64 + (y % 2) * 32 + 2, y * 32 + 2, 60, 28); } });
  // 실사 재질: 젖은 아스팔트(물웅덩이 반사·균열·골재), 보도블록(줄눈·닳은 모서리)
  const mAsph = M(pbr('asphalt', [0.125, 0.125], { envMapIntensity: 1.1, normalScale: new THREE.Vector2(0.9, 0.9), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })), mPave = M(pbr('pave', [0.31, 0.31], { envMapIntensity: 0.5 })), mCurb = M(pbr('concrete', [0.5, 0.5], { color: 0xb8b8b8 }));
  void asph; void pave;
  { const s = new THREE.Shape(); s.moveTo(X0 - 60, -(Z0 - 60)); s.lineTo(X1 + 60, -(Z0 - 60)); s.lineTo(X1 + 60, -(Z1 + 60)); s.lineTo(X0 - 60, -(Z1 + 60)); s.closePath();
    for (const h of holes) { const p = new THREE.Path(); p.moveTo(h.x0, -h.z0); p.lineTo(h.x0, -h.z1); p.lineTo(h.x1, -h.z1); p.lineTo(h.x1, -h.z0); p.closePath(); s.holes.push(p); }
    const gm = new THREE.ShapeGeometry(s); gm.rotateX(-Math.PI / 2); const ground = new THREE.Mesh(gm, mPave); ground.position.y = -0.03; root.add(ground); }
  // 도로(아스팔트는 월드 좌표 UV)
  const roadGeo = (x, z, sx, sz) => { const g = new THREE.PlaneGeometry(sx, sz); g.rotateX(-Math.PI / 2); g.translate(x, 0, z); const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i)); add(mAsph, g); };
  const mLine = new THREE.MeshBasicMaterial({ color: 0xd9d9d9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }), mYellow = new THREE.MeshBasicMaterial({ color: 0xd8b13a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
  const nearNS = x => NS.some(c => Math.abs(x - c) < W2 + 0.5), nearEW = z => EW.some(r => z > r.z0 - 0.5 && z < r.z1 + 0.5);
  for (const r of EW) {
    const cz = (r.z0 + r.z1) / 2; roadGeo(0, cz, X1 - X0, r.z1 - r.z0);
    for (let x = X0; x < X1; x += 6) { if (nearNS(x) || nearNS(x + 3)) continue; box(mLine, 3, 0.01, 0.12, x + 1.5, 0.012, r.z0 + 2); box(mLine, 3, 0.01, 0.12, x + 1.5, 0.012, r.z1 - 2); }
    // 중앙선·연석: 교차로 사이 구간마다
    const xs = [X0, ...NS.flatMap(c => [c - W2, c + W2]), X1];
    for (let i = 0; i < xs.length; i += 2) { const a = xs[i], b = xs[i + 1], L = b - a, m = (a + b) / 2; if (L <= 0) continue;
      box(mYellow, L, 0.01, 0.12, m, 0.012, cz - 0.1); box(mYellow, L, 0.01, 0.12, m, 0.012, cz + 0.1);
      box(mCurb, L, 0.15, 0.2, m, 0.07, r.z0 - 0.1); box(mCurb, L, 0.15, 0.2, m, 0.07, r.z1 + 0.1); }
  }
  for (const cx of NS) {
    roadGeo(cx, (Z0 + Z1) / 2, ROADW, Z1 - Z0);
    const zs = [Z0, ...EW.flatMap(r => [r.z0, r.z1]), Z1];
    for (let i = 0; i < zs.length; i += 2) { const a = zs[i], b = zs[i + 1], L = b - a, m = (a + b) / 2; if (L <= 0) continue;
      box(mYellow, 0.12, 0.01, L, cx - 0.1, 0.012, m); box(mYellow, 0.12, 0.01, L, cx + 0.1, 0.012, m);
      box(mCurb, 0.2, 0.15, L, cx - W2 - 0.1, 0.07, m); box(mCurb, 0.2, 0.15, L, cx + W2 + 0.1, 0.07, m);
      for (let z = a + 4; z < b - 4; z += 6) { box(mLine, 0.12, 0.01, 3, cx - 2, 0.012, z); box(mLine, 0.12, 0.01, 3, cx + 2, 0.012, z); } }
    // 횡단보도 (모든 교차로 네 방향)
    for (const r of EW) {
      for (const zz of [r.z0 - 2.2, r.z1 + 2.2]) for (let k = -3; k <= 3; k++) box(mLine, 0.5, 0.012, 2.6, cx + k * 1.0, 0.014, zz);
      for (const xx of [cx - W2 - 2.2, cx + W2 + 2.2]) for (let k = 0; k < 7; k++) box(mLine, 2.6, 0.012, 0.5, xx, 0.014, r.z0 + 0.6 + k * 1.1);
    }
  }
  // 가게 앞 횡단보도
  for (let k = 0; k < 7; k++) box(mLine, 0.55, 0.012, 7.4, 8 + k * 1.05, 0.014, 10.5);

  // ── 건물 ──
  const KINDS = ['apt', 'office', 'old', 'brick', 'stone', 'glass'];
  const FM = {}; for (const k of KINDS) { const t = facade(k); FM[k] = M({ map: t, emissiveMap: emissiveOf(t), emissive: 0xffffff, emissiveIntensity: 0.9, roughness: k === 'glass' || k === 'office' ? 0.2 : 0.85, envMapIntensity: k === 'glass' ? 1.2 : 0.3, bumpMap: k === 'brick' ? tex('brick_bump.jpg', [1, 1], false) : t, bumpScale: k === 'brick' ? 2.5 : 1.2 }); }
  const mRoof = M({ color: 0x2a2d31 }), mSign = new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }), mShopWin = new THREE.MeshBasicMaterial({ map: winTex, color: 0xbbbbbb, toneMapped: false });
  const mShutter = M({ map: shutterTex, roughness: 0.5, metalness: 0.4 }), mAptNum = M({ map: aptNumTex, roughness: 0.8, emissive: 0xffffff, emissiveMap: aptNumTex, emissiveIntensity: 0.25 });
  const mAC = M({ color: 0xd8d6d0, roughness: 0.55, metalness: 0.2 }), mPipe = M({ color: 0x7d7f80, roughness: 0.5, metalness: 0.5 });
  const mGrille = M({ map: ctex(64, 64, (g, w, h) => { g.fillStyle = '#9a9a96'; g.fillRect(0, 0, w, h); g.fillStyle = '#2a2a28'; for (let y = 4; y < h; y += 6) g.fillRect(4, y, w - 8, 3); g.beginPath(); g.arc(w / 2, h / 2, 22, 0, 7); g.strokeStyle = '#555'; g.lineWidth = 3; g.stroke(); }, false), roughness: 0.6, metalness: 0.4 });
  const cross = M({ color: 0xff2030, emissive: 0xff1020, emissiveIntensity: 2.2 }), mRooftop = M({ color: 0x5a5e64, roughness: 0.7, metalness: 0.3 });
  const blds = [];
  const plane = (mat, w, h, x, y, z, ry = 0, uvf) => { const g = new THREE.PlaneGeometry(w, h); if (uvf) uvf(g.attributes.uv); g.rotateY(ry); g.translate(x, y, z); add(mat, g); };
  const building = (x0, x1, z0, z1, h, kind, frontZ, shops = true) => {
    blds.push({ x0, x1, z0, z1, h });
    const sx = x1 - x0, sz = z1 - z0, g = new THREE.BoxGeometry(sx, h, sz), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) { const face = Math.floor(i / 4); const W = face < 2 ? sz : sx; uv.setXY(i, uv.getX(i) * W / 12, uv.getY(i) * h / 12); }
    g.translate((x0 + x1) / 2, h / 2, (z0 + z1) / 2); add(FM[kind], g); box(mRoof, sx + 0.3, 0.4, sz + 0.3, (x0 + x1) / 2, h + 0.2, (z0 + z1) / 2);
    onCollider?.({ x0: x0 - 0.1, x1: x1 + 0.1, z0: z0 - 0.1, z1: z1 + 0.1 });
    if (frontZ != null && h > 5 && shops) { // 1층 상가: 진열창(불 켜짐) 또는 내린 셔터 + 간판
      const fz = frontZ > (z0 + z1) / 2 ? z1 + 0.02 : z0 - 0.02, dir = frontZ > (z0 + z1) / 2 ? 1 : -1, ry = dir < 0 ? Math.PI : 0;
      for (let x = x0 + 0.5; x < x1 - 4; x += 8 + Math.random() * 4) {
        const wv = Math.min(7, x1 - 0.5 - x), shop = Math.random() * SHOPS.length | 0;
        plane(Math.random() < 0.55 ? mShopWin : mShutter, wv, 2.6, x + wv / 2, 1.35, fz, ry);
        plane(mSign, wv, 1.1, x + wv / 2, 3.35, fz + dir * 0.02, ry, u => { for (let i = 0; i < u.count; i++) u.setXY(i, (shop % 4 + u.getX(i)) / 4, 1 - (Math.floor(shop / 4) + 1 - u.getY(i)) / 4); });
      }
    }
    // 벽에 붙은 실외기·배수관 (세월 흔적 있는 생활감)
    if (h > 6 && kind !== 'glass' && kind !== 'office' && frontZ != null) {
      const fz = frontZ > (z0 + z1) / 2 ? z1 : z0, dir = frontZ > (z0 + z1) / 2 ? 1 : -1;
      for (let i = 0; i < Math.min(6, (h / 3 | 0)); i++) if (Math.random() < 0.55) { const ax = rnd(x0 + 1, x1 - 1), ay = 4.5 + (Math.random() * (h - 6) / 3 | 0) * 3 + 0.4; box(mAC, 0.8, 0.55, 0.32, ax, ay, fz + dir * 0.17); box(mGrille, 0.6, 0.4, 0.01, ax, ay, fz + dir * 0.335); box(mPipe, 0.04, 0.04, 0.4, ax + 0.3, ay - 0.3, fz + dir * 0.1); }
      for (const px of [x0 + 0.25, x1 - 0.25]) if (Math.random() < 0.6) { const pg = new THREE.CylinderGeometry(0.05, 0.05, h, 8); pg.translate(px, h / 2, fz + dir * 0.07); add(mPipe, pg); }
    }
    // 옥상: 물탱크·실외기 / 교회 십자가
    if (h > 12 && Math.random() < 0.5) box(mRooftop, rnd(1.5, 3), rnd(1.2, 2.2), rnd(1.5, 3), rnd(x0 + 2, x1 - 2), h + 1, rnd(z0 + 2, z1 - 2));
    if (h > 18 && Math.random() < 0.25) { const cx = (x0 + x1) / 2 + rnd(-2, 2), cz = (z0 + z1) / 2; box(cross, 0.25, 3.2, 0.25, cx, h + 2, cz); box(cross, 1.6, 0.25, 0.25, cx, h + 2.8, cz); }
  };
  // 한 줄로 건물 채우기 (앞면이 도로 쪽)
  const row = (x0, x1, za, zb, frontZ, kinds, hMin, hMax, wMin = 9, wMax = 20, shops = true) => { let x = x0; while (x < x1 - 5) { const w = Math.min(x1 - x, rnd(wMin, wMax)); building(x, x + w, za, zb, rnd(hMin, hMax), R(kinds), frontZ, shops); x += w + rnd(0.6, 3); } };
  // 아파트 단지 (101동, 102동 … 번호)
  let dong = 101;
  const aptComplex = (bx0, bx1, bz0, bz1) => {
    for (let z = bz0 + 4; z < bz1 - 14; z += 24) for (let x = bx0 + 3; x < bx1 - 30; x += rnd(44, 52)) {
      const L = Math.min(rnd(34, 44), bx1 - 3 - x), h = rnd(42, 60); building(x, x + L, z, z + 12, h, 'apt', null, false);
      const n = (dong++ - 101) % 16; plane(mAptNum, 6, 3, x - 0.03, h - 4, z + 6, -Math.PI / 2, u => { for (let i = 0; i < u.count; i++) u.setXY(i, (n % 4 + u.getX(i)) / 4, 1 - (Math.floor(n / 4) + 1 - u.getY(i)) / 4); });
      plane(mAptNum, 6, 3, x + L + 0.03, h - 4, z + 6, Math.PI / 2, u => { for (let i = 0; i < u.count; i++) u.setXY(i, (n % 4 + u.getX(i)) / 4, 1 - (Math.floor(n / 4) + 1 - u.getY(i)) / 4); });
    }
  };
  // 공원: 나무·산책로·연못·벤치·가로등
  const mTrunk = M({ color: 0x3b2a1f }), mLeaf = M({ color: 0x1f3a22, roughness: 0.95 }), mLeaf2 = M({ color: 0x2a4a26, roughness: 0.95 });
  // 바람에 흔들리는 나뭇잎 (높을수록 크게, 잎은 파르르)
  for (const m of [mLeaf, mLeaf2]) m.onBeforeCompile = sh => { sh.uniforms.uTime = WIND; sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    float hh = max(0., position.y - 2.3); float gust = 0.6 + 0.4 * sin(uTime * 0.37 + position.x * 0.01);
    transformed.x += (sin(uTime * 1.3 + position.x * 0.35 + position.z * 0.2) * 0.07 * hh + sin(uTime * 7.0 + position.y * 9.0 + position.x * 5.0) * 0.012) * gust;
    transformed.z += (cos(uTime * 1.1 + position.z * 0.3) * 0.05 * hh + cos(uTime * 6.3 + position.z * 8.0) * 0.012) * gust;`); };
  // 나무: 나무껍질 줄기·가지 + 실사 나뭇잎 사진 카드 수십 장 (바람에 흔들림)
  const barkT = ctex(128, 256, (g, w, h) => { g.fillStyle = '#3b2c22'; g.fillRect(0, 0, w, h); for (let i = 0; i < 260; i++) { g.strokeStyle = `rgba(${Math.random() < 0.5 ? '15,10,8' : '120,100,85'},${0.2 + Math.random() * 0.4})`; g.lineWidth = 1 + Math.random() * 3; const x = Math.random() * w; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + (Math.random() - 0.5) * 20, h / 3, x + (Math.random() - 0.5) * 20, h * 2 / 3, x + (Math.random() - 0.5) * 10, h); g.stroke(); } });
  const mBark = M({ map: barkT, bumpMap: barkT, bumpScale: 4, roughness: 0.95 });
  const mCard = new THREE.MeshStandardMaterial({ map: tex('leaf.png'), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.75, envMapIntensity: 0.25 }); mCard.onBeforeCompile = mLeaf.onBeforeCompile;
  const limb = (a, b, r0, r1) => { const d = b.clone().sub(a), g = new THREE.CylinderGeometry(r1, r0, d.length(), 7, 1, true); g.translate(0, d.length() / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate(a.x, a.y, a.z); add(mBark, g); };
  const tree = (x, z, s = 1) => {
    onCollider?.({ x0: x - 0.2 * s, x1: x + 0.2 * s, z0: z - 0.2 * s, z1: z + 0.2 * s });
    const V = (a, b, c) => new THREE.Vector3(a, b, c), top = V(x + rnd(-0.2, 0.2), 3.2 * s, z + rnd(-0.2, 0.2)); limb(V(x, 0, z), top, 0.15 * s, 0.09 * s);
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + rnd(-0.4, 0.4), e = V(x + Math.cos(a) * 1.1 * s, (3.6 + rnd(0, 0.9)) * s, z + Math.sin(a) * 1.1 * s); limb(V(x, (2.2 + i * 0.25) * s, z), e, 0.07 * s, 0.03 * s); }
    const cy = 3.9 * s, n = 26;
    for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), r = rnd(0.2, 1.4) * s, y = cy + rnd(-0.9, 1.1) * s, w = rnd(1.3, 1.9) * s, g = new THREE.PlaneGeometry(w, w * 2); g.translate(0, -w * 0.55, 0); g.rotateX(rnd(-0.5, 0.25)); g.rotateY(a + rnd(-0.6, 0.6)); g.translate(x + Math.cos(a) * r, y + w * 0.5, z + Math.sin(a) * r); add(mCard, g); }
    box(M({ color: 0x4a4038 }), 1.1, 0.12, 1.1, x, 0.06, z);
  };
  const mPole = M({ color: 0x3a3d42, metalness: 0.6, roughness: 0.4 }), mBulb = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc77a).multiplyScalar(3) });
  const poolTex = ctex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,190,110,.45)'); gr.addColorStop(1, 'rgba(255,190,110,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
  const mPool = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const lampPool = (x, z) => { const g = new THREE.PlaneGeometry(9, 9); g.rotateX(-Math.PI / 2); g.translate(x, 0.02, z); add(mPool, g); };
  const lamps = [];
  const lampX = (x, z, dz) => { lamps.push({ x, z: z + dz * 1.5, tx: x, tz: z + dz * 2.5 }); onCollider?.({ x0: x - 0.14, x1: x + 0.14, z0: z - 0.14, z1: z + 0.14 }); box(mPole, 0.16, 6.5, 0.16, x, 3.25, z); box(mPole, 0.1, 0.1, 1.6, x, 6.4, z + dz * 0.8); box(mBulb, 0.5, 0.1, 0.22, x, 6.3, z + dz * 1.5); lampPool(x, z + dz * 2.5); };
  const lampZ = (x, z, dx) => { lamps.push({ x: x + dx * 1.5, z, tx: x + dx * 2.5, tz: z }); onCollider?.({ x0: x - 0.14, x1: x + 0.14, z0: z - 0.14, z1: z + 0.14 }); box(mPole, 0.16, 6.5, 0.16, x, 3.25, z); box(mPole, 1.6, 0.1, 0.1, x + dx * 0.8, 6.4, z); box(mBulb, 0.22, 0.1, 0.5, x + dx * 1.5, 6.3, z); lampPool(x + dx * 2.5, z); };
  const park = (bx0, bx1, bz0, bz1) => {
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2, mPath = M(pbr('pave', [6, 1], { color: 0xc8bba8 })), mGrass = M({ map: tex('grass_col.jpg', [(bx1 - bx0) / 6, (bz1 - bz0) / 6]), normalMap: tex('grass_nrm.jpg', [(bx1 - bx0) / 6, (bz1 - bz0) / 6], false), color: 0x7a8a70, roughness: 0.95 });
    box(mGrass, bx1 - bx0, 0.04, bz1 - bz0, cx, 0.01, cz); box(mPath, bx1 - bx0, 0.05, 3, cx, 0.02, cz); box(mPath, 3, 0.05, bz1 - bz0, cx, 0.02, cz);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(9, 40), new THREE.MeshStandardMaterial({ color: 0x0a1420, roughness: 0.05, metalness: 0.6, envMapIntensity: 1.2 })); pond.rotation.x = -Math.PI / 2; pond.position.set(cx + 18, 0.035, cz - 14); root.add(pond);
    onCollider?.({ x0: cx + 11, x1: cx + 25, z0: cz - 21, z1: cz - 7 });
    for (let i = 0; i < 70; i++) { const x = rnd(bx0 + 2, bx1 - 2), z = rnd(bz0 + 2, bz1 - 2); if (Math.abs(x - cx) < 3 || Math.abs(z - cz) < 3 || Math.hypot(x - cx - 18, z - cz + 14) < 11) continue; tree(x, z, rnd(0.9, 1.4)); }
    for (let k = -2; k <= 2; k++) { if (!k) continue; box(M({ color: 0x6b4a2e }), 1.8, 0.08, 0.45, cx + k * 12, 0.45, cz + 2.4); lampX(cx + k * 12 + 4, cz - 2, 0); }
    parkLabel.push({ x: cx, z: cz });
  };
  const parkLabel = [], schoolLabel = [];
  const school = (bx0, bx1, bz0, bz1) => {
    const mField = M({ color: 0x6e5236, roughness: 1 }), mFence = M({ color: 0x2f6b3a, roughness: 0.6, metalness: 0.4 });
    building(bx0 + 4, bx1 - 4, bz0 + 2, bz0 + 16, 16, 'stone', bz0 - 1, false);
    building(bx0 + 4, bx0 + 18, bz0 + 16, bz0 + 36, 16, 'stone', null, false);
    const fx0 = bx0 + 24, fx1 = bx1 - 6, fz0 = bz0 + 22, fz1 = bz1 - 4; box(mField, fx1 - fx0, 0.04, fz1 - fz0, (fx0 + fx1) / 2, 0.02, (fz0 + fz1) / 2);
    box(mLine, fx1 - fx0 - 4, 0.012, 0.15, (fx0 + fx1) / 2, 0.05, fz0 + 2); box(mLine, fx1 - fx0 - 4, 0.012, 0.15, (fx0 + fx1) / 2, 0.05, fz1 - 2); box(mLine, 0.15, 0.012, fz1 - fz0 - 4, (fx0 + fx1) / 2, 0.05, (fz0 + fz1) / 2);
    for (const gx of [fx0 + 2.5, fx1 - 2.5]) { box(mLine, 0.1, 2.2, 0.1, gx, 1.1, (fz0 + fz1) / 2 - 3.6); box(mLine, 0.1, 2.2, 0.1, gx, 1.1, (fz0 + fz1) / 2 + 3.6); box(mLine, 0.1, 0.1, 7.3, gx, 2.2, (fz0 + fz1) / 2); }
    for (const [a, b, c, d] of [[bx0, bx1, bz1, bz1], [bx0, bx0, bz0, bz1], [bx1, bx1, bz0, bz1]]) { const L = Math.max(b - a, d - c); box(mFence, b - a || 0.06, 1.8, d - c || 0.06, (a + b) / 2, 0.9, (c + d) / 2); onCollider?.({ x0: Math.min(a, b) - 0.1, x1: Math.max(a, b) + 0.1, z0: Math.min(c, d) - 0.1, z1: Math.max(c, d) + 0.1 }); void L; }
    schoolLabel.push({ x: (bx0 + bx1) / 2, z: (bz0 + bz1) / 2 });
  };
  // 블록마다 동네 성격대로 채우기
  const xsB = [X0 - 50, ...NS, X1 + 50], zsB = [Z0 - 50, ...EW.map(r => (r.z0 + r.z1) / 2), Z1 + 50];
  const zEdge = j => j === 0 ? Z0 - 50 : (EW[j - 1].z1 + SIDE), zEdge2 = j => j === EW.length ? Z1 + 50 : (EW[j].z0 - SIDE);
  for (let i = 0; i < xsB.length - 1; i++) for (let j = 0; j < zsB.length - 1; j++) {
    const bx0 = i === 0 ? X0 - 50 : NS[i - 1] + W2 + SIDE, bx1 = i === NS.length ? X1 + 50 : NS[i] - W2 - SIDE, bz0 = zEdge(j), bz1 = zEdge2(j);
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2, edgeN = j === 0, edgeS = j === EW.length;
    if (cx > -45 && cx < 50 && cz > -72 && cz < 10) { // 우리 가게 블록 (가게·창고·이웃 상가)
      building(-24, -5.3, -14, 3.9, 14, 'old', 10); building(-37.6, -24.5, -14, 3.9, 22, 'apt', 10);
      building(5.0, 20, -14, 3.9, 11, 'brick', 10, false); building(-5.2, 4.9, -16, -8.4, 14, 'stone', null); building(20.5, 42.6, -14, 3.9, 26, 'office', 10, false);
      row(bx0, bx1, bz0, bz0 + rnd(12, 16), bz0 - 1, ['apt', 'brick', 'stone', 'old'], 8, 30);
      continue;
    }
    if (cx > -140 && cx < -45 && cz > 90 && cz < 170) { park(bx0, bx1, bz0, bz1); continue; }
    if (cx > 50 && cx < 145 && cz > 90 && cz < 170) { school(bx0, bx1, bz0, bz1); continue; }
    if (cz < -152) { aptComplex(bx0, bx1, bz0, bz1); continue; }
    let kinds = ['apt', 'brick', 'stone', 'old', 'office', 'glass'], hMin = 8, hMax = 36, wMin = 9, wMax = 20;
    if (cx > 145) { kinds = ['glass', 'office', 'glass', 'stone']; hMin = 28; hMax = 90; wMin = 16; wMax = 30; }   // 도심 고층
    else if (cx < -140) { kinds = ['old', 'brick', 'old', 'apt']; hMin = 6; hMax = 16; wMin = 7; wMax = 12; }    // 옛 동네 저층
    const d1 = rnd(12, 18), d2 = rnd(12, 18);
    if (!edgeN) row(bx0, bx1, bz0, bz0 + d1, bz0 - 1, kinds, hMin, hMax, wMin, wMax);
    if (!edgeS) row(bx0, bx1, bz1 - d2, bz1, bz1 + 1, kinds, hMin, hMax, wMin, wMax);
    const iz0 = edgeN ? bz0 : bz0 + d1 + 6, iz1 = edgeS ? bz1 : bz1 - d2 - 6;      // 안쪽: 뒷동네 건물
    if (iz1 - iz0 > 10) row(bx0 + 3, bx1 - 3, iz0, Math.min(iz1, iz0 + rnd(10, 20)), null, kinds, hMin * 0.8, hMax * 0.7, wMin, wMax, false);
  }
  // 도시 끝 (못 나가게)
  for (const c of [{ x0: X0 - 60, x1: X0 - 1, z0: Z0 - 60, z1: Z1 + 60 }, { x0: X1 + 1, x1: X1 + 60, z0: Z0 - 60, z1: Z1 + 60 }, { x0: X0, x1: X1, z0: Z0 - 60, z1: Z0 - 1 }, { x0: X0, x1: X1, z0: Z1 + 1, z1: Z1 + 60 }]) onCollider?.(c);
  // ── 가로등 · 가로수 (모든 길 양옆) ──
  const storeFront = (x, z) => x > -14 && x < 14 && z > 0 && z < 7;
  for (const r of EW) for (let x = X0 + 6; x < X1 - 6; x += 30) {
    if (nearNS(x) || nearNS(x + 6) || Math.abs(x - (r === EW[3] ? 16 : 1e9)) < 4) continue;
    const zn = r.z0 - 0.6, zs = r.z1 + 0.6;
    if (!storeFront(x, zn) && !inHole(x, zn)) lampX(x, zn, 1); if (!inHole(x + 15, zs)) lampX(x + 15, zs, -1);
    if (!storeFront(x + 8, r.z0 - 1.6) && !inHole(x + 8, r.z0 - 1.6) && Math.abs(x + 8 - 16) > 4) tree(x + 8, r.z0 - 1.6); if (!inHole(x + 23, r.z1 + 1.6)) tree(x + 23, r.z1 + 1.6);
  }
  for (const cx of NS) for (let z = Z0 + 6; z < Z1 - 6; z += 30) { if (nearEW(z) || nearEW(z + 15) || nearEW(z - 4) || nearEW(z + 19)) continue; lampZ(cx - W2 - 0.6, z, 1); lampZ(cx + W2 + 0.6, z + 15, -1); tree(cx + W2 + 1.6, z + 6); tree(cx - W2 - 1.6, z + 21); }
  // ── 신호등 (교차로) ──
  const lights = [];
  for (const cx of NS.filter(c => Math.abs(c) < 160)) for (const [dx, dz] of [[-1, -1], [1, 1]]) {
    const x = cx + dx * (ROADW / 2 + 0.8), z = (dz < 0 ? ROADS.main.z0 - 0.8 : ROADS.main.z1 + 0.8);
    box(mPole, 0.14, 5, 0.14, x, 2.5, z); box(mPole, 0.1, 0.1, 3, x, 5, z + dz * -1.5);
    const head = new THREE.Group(); head.position.set(x, 5.2, z - dz * 3); root.add(head);
    head.add(new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 1.0), M({ color: 0x111111 })));
    const bulbs = ['#ff2a2a', '#ffb000', '#2aff7a'].map((c, i) => { const m = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), new THREE.MeshBasicMaterial({ color: c, toneMapped: false })); m.position.set(dx * 0.18, 0, (i - 1) * 0.3); m.rotation.y = dx * Math.PI / 2; head.add(m); return m; });
    lights.push(bulbs);
  }
  // ── 버스 정류장 (가게 오른쪽 앞) ──
  const stop = new THREE.Group(); stop.position.set(16, 0, ROADS.main.z0 - 1.6); root.add(stop);
  const mGlass = M({ color: 0xbfd8ea, transparent: true, opacity: 0.25, roughness: 0.05, envMapIntensity: 1 });
  const at = (m, x, y, z) => { m.position.set(x, y, z); stop.add(m); return m; };
  at(new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.1, 1.6), M({ color: 0x2b2f36 })), 0, 2.6, 0);
  at(new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.3), mGlass), 0, 1.4, -0.75);
  at(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.4), M({ color: 0x8a6a4b })), 0, 0.48, -0.5);
  const ad = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.9), new THREE.MeshBasicMaterial({ toneMapped: false, map: ctex(256, 440, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2b5876'); gr.addColorStop(1, '#4e4376'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = `900 46px ${FONT}`; g.fillText('새 스마트폰', 20, 90); g.font = `700 26px ${FONT}`; g.fillText('지금 사전예약', 20, 140); g.fillStyle = 'rgba(255,255,255,.8)'; g.fillRect(60, 200, 130, 220); }, false) }));
  ad.position.set(2.0, 1.35, -0.7); stop.add(ad);
  const bsign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshBasicMaterial({ toneMapped: false, map: ctex(256, 140, (g, w, h) => { g.fillStyle = '#0b5cd6'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = `900 34px ${FONT}`; g.fillText('달빛시장 앞', 16, 50); g.font = `700 24px ${FONT}`; g.fillText('472  740  N62', 16, 100); }, false) }));
  bsign.position.set(-2.4, 2.4, 0.3); stop.add(bsign); box(mPole, 0.08, 2.8, 0.08, 16 - 2.4, 1.4, ROADS.main.z0 - 1.3);
  onCollider?.({ x0: 13.8, x1: 18.2, z0: ROADS.main.z0 - 2.45, z1: ROADS.main.z0 - 2.25 });
  for (const x of BUS_STOPS.slice(1)) { box(mPole, 0.08, 2.8, 0.08, x - 2.4, 1.4, ROADS.main.z0 - 1.3); const sg = bsign.clone(); sg.position.set(x - 2.4, 2.4, ROADS.main.z0 - 1.25); root.add(sg); box(M({ color: 0x8a6a4b }), 2.0, 0.08, 0.4, x, 0.48, ROADS.main.z0 - 2.2); }

  // 합치기
  for (const [mat, list] of geos) { const m = new THREE.Mesh(mergeGeometries(list.map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; })), mat); m.matrixAutoUpdate = false; root.add(m); }
  // 신호 바뀌기
  let sig = 0, sigT = 0;
  const update = (dt) => { WIND.value += dt; if ((sigT += dt) > [12, 3, 12][sig]) { sigT = 0; sig = (sig + 1) % 3; } lights.forEach((b, i) => b.forEach((m, k) => (m.material.opacity = 1, m.visible = k === (i % 2 ? (2 - sig + 3) % 3 : sig)))); };
  return { root, update, blds, ROADW, parks: parkLabel, schools: schoolLabel, lamps };
}

// ── 차량: 승용차·택시(지프 모델 색칠), 시내버스(직접 만듦) ──
function busMesh(color, num, dest) {
  const g = new THREE.Group(), L = 11, H = 3.1, W = 2.5;
  const side = ctex(1024, 256, (c, w, h) => { c.fillStyle = color; c.fillRect(0, 0, w, h); c.fillStyle = '#f2f2f2'; c.fillRect(0, h * 0.72, w, h * 0.28);
    for (let i = 0; i < 8; i++) { const x = 40 + i * 118; c.fillStyle = '#ffe6b0'; c.fillRect(x, 40, 104, 110); c.fillStyle = 'rgba(30,20,10,.35)'; c.fillRect(x, 120, 104, 30); for (let k = 0; k < 2; k++) { c.fillStyle = 'rgba(40,30,30,.6)'; c.beginPath(); c.arc(x + 30 + k * 45, 112, 13, 0, 7); c.fill(); } }
    c.fillStyle = '#333'; c.fillRect(760, 36, 70, 200); c.fillStyle = '#fff'; c.font = `900 60px ${FONT}`; c.fillText(num, 60, 225); }, false);
  const front = ctex(256, 320, (c, w, h) => { c.fillStyle = color; c.fillRect(0, 0, w, h); c.fillStyle = '#111'; c.fillRect(10, 10, w - 20, 50); c.fillStyle = '#ff9d00'; c.font = `900 34px ${FONT}`; c.fillText(`${num} ${dest}`, 20, 48); c.fillStyle = '#9fd0ff'; c.fillRect(10, 70, w - 20, 150); c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(10, 70, w - 20, 20); c.fillStyle = '#fffbe0'; c.fillRect(16, 260, 50, 26); c.fillRect(w - 66, 260, 50, 26); }, false);
  const back = ctex(256, 320, (c, w, h) => { c.fillStyle = color; c.fillRect(0, 0, w, h); c.fillStyle = '#111'; c.fillRect(30, 30, w - 60, 90); c.fillStyle = '#ff2020'; c.fillRect(16, 250, 46, 30); c.fillRect(w - 62, 250, 46, 30); c.fillStyle = '#fff'; c.font = `900 40px ${FONT}`; c.fillText(num, 80, 200); }, false);
  const ms = new THREE.MeshStandardMaterial({ map: side, roughness: 0.35, emissive: 0xffffff, emissiveMap: side, emissiveIntensity: 0.25 }), mf = new THREE.MeshStandardMaterial({ map: front, roughness: 0.3, emissive: 0xffffff, emissiveMap: front, emissiveIntensity: 0.35 }), mb = new THREE.MeshStandardMaterial({ map: back, roughness: 0.35, emissive: 0xffffff, emissiveMap: back, emissiveIntensity: 0.3 }), mt = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), [mf, mb, mt, mt, ms, ms]); body.position.y = H / 2 + 0.35; g.add(body);
  const wm = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.85 }), rimM = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.3 }), blk = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
  for (const x of [-3.6, 3.4]) for (const z of [-1.1, 1.1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 24), wm); w.rotation.x = Math.PI / 2; w.position.set(x, 0.5, z); g.add(w); const r = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.32, 16), rimM); r.rotation.x = Math.PI / 2; r.position.set(x, 0.5, z); g.add(r); const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.05, 20, 1, true, 0, Math.PI), blk); arch.rotation.set(Math.PI / 2, 0, 0); arch.position.set(x, 0.55, z * 1.12); g.add(arch); }
  // 범퍼·사이드미러·지붕 냉방기·와이퍼·측면 띠
  for (const sx of [1, -1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.35, W + 0.04), blk); b.position.set(sx * (L / 2 + 0.05), 0.55, 0); g.add(b); }
  for (const s of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.04), blk); arm.position.set(L / 2 + 0.2, 2.6, s * (W / 2 + 0.05)); g.add(arm); const mir = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.25), blk); mir.position.set(L / 2 + 0.42, 2.35, s * (W / 2 + 0.12)); g.add(mir); }
  const ac = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 1.6), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 })); ac.position.set(-0.5, H + 0.5, 0); g.add(ac);
  for (const z of [-0.5, 0.5]) { const wp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.9, 0.04), blk); wp.position.set(L / 2 + 0.01, 1.4, z); wp.rotation.x = 0.6 * Math.sign(z); g.add(wp); }
  for (const z of [-W / 2 - 0.005, W / 2 + 0.005]) { const st = new THREE.Mesh(new THREE.BoxGeometry(L - 0.4, 0.08, 0.01), rimM); st.position.set(0, 1.05, z); g.add(st); }
  // 오른쪽(인도 쪽) 앞문·뒷문: 정류장에서 접히며 열림
  const dm = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.75 }), fm = new THREE.MeshStandardMaterial({ color: 0x333, metalness: 0.5, roughness: 0.4 });
  const doors = [];
  for (const dx of [4.55, 0.35]) for (const s of [-1, 1]) { const piv = new THREE.Group(); piv.position.set(dx + s * 0.5, 0.35, W / 2 + 0.03); g.add(piv); const pnl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.35, 0.04), dm); pnl.position.set(-s * 0.25, 1.2, 0); piv.add(pnl); const fr = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.05), fm); fr.position.set(-s * 0.25, 2.38, 0); piv.add(fr); doors.push([piv, s]); }
  g.userData.doors = doors;
  g.rotation.y = 0; g.userData.size = new THREE.Vector3(W, H, L);
  // 모델 앞을 +z 로 (지프와 같게)
  const holder = new THREE.Group(); g.rotation.y = -Math.PI / 2; holder.add(g); holder.userData.size = new THREE.Vector3(W, H, L); holder.userData.bus = g; holder.userData.num = num;
  holder.userData.doorK = 0; holder.userData.setDoors = k => { holder.userData.doorK = k; for (const [piv, s] of doors) piv.rotation.y = s * k * 1.35; };
  return holder;
}
export const BUS_STOPS = [16, -105, 135, 255, -215];
export function makeTraffic(scene, vehicles, audio, CAR_COLORS, hooks = {}) {
  const list = [], base = vehicles.car;
  const cloneCar = (color, taxi) => {
    const c = base.clone(true); c.visible = true; c.userData.size = base.userData.size;
    c.traverse(o => { if (o.isMesh && o.material === base.userData.paint) { o.material = o.material.clone(); o.material.color.setHex(color); } });
    if (taxi) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.25), new THREE.MeshBasicMaterial({ toneMapped: false, map: ctex(128, 64, (g, w, h) => { g.fillStyle = '#ffcc00'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.font = `900 30px ${FONT}`; g.fillText('TAXI', 26, 44); }, false) })); s.position.set(0, base.userData.size.y + 0.12, 0); c.add(s); }
    c.children.forEach(o => { if (o.isSpotLight) o.visible = false; }); c.traverse(o => { if (o.isMesh) o.castShadow = true; });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(4, 7), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: ctex(64, 128, (g, w, h) => { const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(255,245,210,.5)'); gr.addColorStop(1, 'rgba(255,245,210,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false) }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.03, base.userData.size.z / 2 + 3.5); c.add(pool);
    return c;
  };
  const { X0, X1, Z0, Z1 } = ROADS, lanes = [];
  for (const r of ROADS.EW) lanes.push({ axis: 'x', dir: -1, c: r.z0 + 2, len: (X1 - X0) / 2 }, { axis: 'x', dir: 1, c: r.z1 - 2, len: (X1 - X0) / 2 });
  for (const cx of ROADS.NS) lanes.push({ axis: 'z', dir: 1, c: cx - 2, len: (Z1 - Z0) / 2, off: (Z0 + Z1) / 2 }, { axis: 'z', dir: -1, c: cx + 2, len: (Z1 - Z0) / 2, off: (Z0 + Z1) / 2 });
  const ML = lanes.filter(l => l.axis === 'x' && (l.c === 8.6 || l.c === 12.4)), BL = lanes.find(l => l.axis === 'x' && l.c === ROADS.back.z0 + 2), NL = lanes.filter(l => l.axis === 'z');
  // 페라리 (스포츠카): 색 다르게, 바퀴 굴러감
  const cloneFerrari = (color) => { const c = vehicles.ferrari.clone(true); c.visible = true; c.traverse(o => { if (o.isMesh && o.material.name === 'Body_Color') { o.material = o.material.clone(); o.material.color.setHex(color); } });
    c.userData.wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map(n => c.getObjectByName(n)).filter(Boolean); c.userData.ferrari = true; return c; };
  const spawn = (mesh, lane, at, speed, kind, silent) => {
    scene.add(mesh); mesh.visible = true;
    const v = { mesh, lane, s: at, speed, kind, snd: silent ? null : audio.play('engine', { pos: mesh.position, vol: kind === 'bus' ? 1.8 : 1.1, loop: true, rate: kind === 'bus' ? 0.38 : 0.55 + speed / 30 }), honked: 0 };
    list.push(v); return v;
  };
  spawn(cloneCar(0xf4f4f2), ML[0], -60, 11, 'car'); spawn(cloneCar(0xff9f1c, true), ML[1], 20, 10, 'taxi'); spawn(busMesh('#1d5fc8', '472', '신촌역'), ML[1], -90, 8, 'bus');
  spawn(busMesh('#2e9b48', '7016', '달빛시장'), ML[0], 80, 7.5, 'bus'); spawn(cloneCar(0x1c2c52), NL[6], 0, 12, 'car'); spawn(cloneCar(0x7a1414), NL[9], 40, 11, 'car'); spawn(cloneCar(0x111214), BL, 0, 13, 'car');
  for (const [col, L, at] of [[0xc21a1a, ML[1], -40], [0xf2c230, ML[0], 60], [0x111111, NL[3], 20], [0xe8e8e8, lanes[2], -100]]) spawn(cloneFerrari(col), L, at, rnd(13, 17), 'car', true);
  // 도시 곳곳 차량 (소리는 가까운 큰길 차만)
  const COLS = [0xf4f4f2, 0x111214, 0x8c9096, 0x1c2c52, 0x7a1414, 0xd8d8d8, 0x2b2b2b, 0x3a4a3a];
  for (const L of lanes) { const n = L === ML[0] || L === ML[1] ? 2 : 1; for (let i = 0; i < n; i++) { const taxi = Math.random() < 0.2; spawn(Math.random() < 0.12 ? busMesh(R(['#1d5fc8', '#2e9b48', '#e2a400']), R(['472', '7016', '6411', '02']), R(['신촌역', '달빛시장', '시청', '종점'])) : cloneCar(taxi ? 0xff9f1c : R(COLS), taxi), L, (Math.random() * 2 - 1) * L.len, rnd(9, 14), 'car', true); } }
  const tmp = new THREE.Vector3();
  return {
    list,
    // 길가에 세워 둔 차 (택시 일자리 등)
    spawnParked(color, taxi, x, z, ry, ferrari) { const m = ferrari ? cloneFerrari(color) : cloneCar(color, taxi); const v = spawn(m, ML[0], 0, 0, 'car', true); v.taken = true; v.parked = true; m.position.set(x, 0, z); m.rotation.y = ry; return v; },
    update(dt, player) {
      for (const v of list) {
        const L = v.lane; let speed = v.speed;
        const pos = L.axis === 'x' ? tmp.set(v.s, 0, L.c) : tmp.set(L.c, 0, v.s + (L.off || 0));
        if (v.taken) continue;
        // 버스: 정류장에 서서 문 열기
        if (v.kind === 'bus' && L === ML[0]) { const st = BUS_STOPS.find(x => Math.abs(v.s - x) < 0.6 && v.lastStop !== x); if (st !== undefined && !(v.stopT > 0)) { v.stopT = 8; v.lastStop = st; v.mesh.userData.setDoors?.(1); audio.play('door', { pos, vol: 0.7, rate: 0.6 }); } }
        if (v.stopT > 0) { v.stopT -= dt; speed = 0; if (v.stopT <= 0.6) v.mesh.userData.setDoors?.(0); if (v.hold) v.stopT = Math.max(v.stopT, 1); }
        // 앞에 사람·차가 있으면 멈추고 경적, 피할 새 없이 치면 사람이 다침
        const fx = L.axis === 'x' ? L.dir : 0, fz = L.axis === 'z' ? L.dir : 0, half = (v.mesh.userData.size?.z || 4.4) / 2;
        const obs = hooks.obstacles?.() || []; for (const w of list) if (w !== v && w.mesh.visible) obs.push({ x: w.mesh.position.x, z: w.mesh.position.z, car: true });
        for (const o of obs) {
          const dx = o.x - pos.x, dz = o.z - pos.z, ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
          if (ahead > 0 && ahead < half + (o.car ? 7 : 9) && side < 1.7) { speed = Math.min(speed, Math.max(0, (ahead - half - 2) * 1.2)); if (o.player && v.honked <= 0) { audio.play('horn', { pos, vol: 1.2 }); v.honked = 6; } }
          if (o.person && ahead > -half && ahead < half + 0.4 && side < 1.15 && (v.cur || 0) > 2.5) hooks.hit?.(o.person, v, new THREE.Vector3(fx, 0, fz), v.cur);
        }
        v.honked -= dt; v.cur = (v.cur ?? speed) + (speed - (v.cur ?? speed)) * Math.min(1, dt * 2);
        if (v.stopT > 0 && speed === 0) v.cur = Math.max(0, v.cur - dt * 6);
        v.s += L.dir * v.cur * dt; if (v.s > L.len) v.s = -L.len; if (v.s < -L.len) v.s = L.len;
        v.mesh.position.copy(L.axis === 'x' ? tmp.set(v.s, 0, L.c) : tmp.set(L.c, 0, v.s + (L.off || 0)));
        v.mesh.rotation.y = L.axis === 'x' ? (L.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (L.dir > 0 ? 0 : Math.PI);
        if (v.snd) audio.movePanner(v.snd, v.mesh.position);
        if (v.mesh.userData.wheels) for (const w of v.mesh.userData.wheels) w.rotation.x += v.cur * dt / 0.34;
        if (player || v.far !== undefined) { const far = player ? v.mesh.position.distanceToSquared(player) > 150 * 150 : false; if (far !== v.far) { v.far = far; v.mesh.visible = !far; } }
      }
    },
  };
}
