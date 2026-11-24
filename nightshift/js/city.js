// 밤의 도시: 3×3 블록 (약 300m), 건물(불 켜진 창문·1층 간판·옥상 십자가), 가로등, 가로수, 횡단보도, 신호등, 버스정류장,
// 움직이는 차량(승용차·택시·시내버스) — 플레이어가 걸어 다닐 수 있고 건물엔 부딪힘
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FONT = '"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
const R = (a) => a[Math.random() * a.length | 0], rnd = (a, b) => a + Math.random() * (b - a);
function ctex(w, h, draw, repeat = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
// 도로망: 큰길(z 6.6~14.4, x 방향) + 세로길 x=-45, x=50 + 뒷길 z=-70
export const ROADS = { main: { z0: 6.6, z1: 14.4 }, back: { z0: -76, z1: -68 }, cross: [-45, 50] };
const ROADW = 8;

// 건물 외벽 (창문 불빛은 발광 텍스처)
function facade(kind) {
  return ctex(512, 512, (g, w, h) => {
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
      }
    }
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
const winTex = ctex(512, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#fff1d6'); gr.addColorStop(1, '#c9a66b'); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(${60 + Math.random() * 80},${40 + Math.random() * 60},30,.5)`; g.fillRect(Math.random() * w, h * 0.45 + Math.random() * h * 0.5, 20 + Math.random() * 60, 30 + Math.random() * 60); } g.fillStyle = 'rgba(20,20,20,.8)'; for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 6, h); });

export function buildCity(scene, { onCollider }) {
  const root = new THREE.Group(); scene.add(root);
  const geos = new Map(); const add = (mat, g) => { if (!geos.has(mat)) geos.set(mat, []); geos.get(mat).push(g.index ? g.toNonIndexed() : g); };
  const box = (mat, sx, sy, sz, x, y, z) => add(mat, new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z));
  const M = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, envMapIntensity: 0.2, ...o });
  // 바닥: 아스팔트(젖은 듯 반사) · 보도블록 · 연석
  const asph = ctex(512, 512, (g, w, h) => { g.fillStyle = '#1a1c20'; g.fillRect(0, 0, w, h); for (let i = 0; i < 16000; i++) { const v = Math.random(); g.fillStyle = `rgba(${v < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.07})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } for (let i = 0; i < 6; i++) { g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(Math.random() * w, Math.random() * h); for (let k = 0; k < 5; k++) g.lineTo(Math.random() * w, Math.random() * h); g.stroke(); } });
  const pave = ctex(256, 256, (g, w, h) => { g.fillStyle = '#5f5a54'; g.fillRect(0, 0, w, h); for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) { g.fillStyle = `hsl(25,${6 + Math.random() * 8}%,${32 + Math.random() * 10}%)`; g.fillRect(x * 64 + (y % 2) * 32 + 2, y * 32 + 2, 60, 28); } });
  const mAsph = M({ map: asph, roughness: 0.42, envMapIntensity: 0.6 }), mPave = M({ map: pave, roughness: 0.8 }), mCurb = M({ color: 0x8d8d8d, roughness: 0.7 });
  asph.repeat.set(60, 60); pave.repeat.set(120, 120);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), mPave); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.005, -30); root.add(ground);
  const roadMesh = (x, z, sx, sz) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), mAsph); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.0, z); root.add(m); };
  const mLine = new THREE.MeshBasicMaterial({ color: 0xd9d9d9 }), mYellow = new THREE.MeshBasicMaterial({ color: 0xd8b13a });
  const span = 360;
  for (const r of [ROADS.main, ROADS.back]) {
    const cz = (r.z0 + r.z1) / 2; roadMesh(0, cz, span, r.z1 - r.z0);
    box(mYellow, span, 0.01, 0.12, 0, 0.012, cz - 0.1); box(mYellow, span, 0.01, 0.12, 0, 0.012, cz + 0.1);
    for (let x = -span / 2; x < span / 2; x += 6) { box(mLine, 3, 0.01, 0.12, x, 0.012, r.z0 + 2); box(mLine, 3, 0.01, 0.12, x, 0.012, r.z1 - 2); }
    box(mCurb, span, 0.15, 0.2, 0, 0.07, r.z0 - 0.1); box(mCurb, span, 0.15, 0.2, 0, 0.07, r.z1 + 0.1);
  }
  for (const cx of ROADS.cross) {
    roadMesh(cx, -30, ROADW, span); box(mYellow, 0.12, 0.01, span, cx - 0.1, 0.012, -30); box(mYellow, 0.12, 0.01, span, cx + 0.1, 0.012, -30);
    box(mCurb, 0.2, 0.15, span, cx - ROADW / 2 - 0.1, 0.07, -30); box(mCurb, 0.2, 0.15, span, cx + ROADW / 2 + 0.1, 0.07, -30);
    // 횡단보도 (큰길 양쪽)
    for (const zz of [ROADS.main.z0 - 3, ROADS.main.z1 + 3]) for (let k = -3; k <= 3; k++) box(mLine, 0.5, 0.012, 2.6, cx + k * 1.0, 0.014, zz);
    for (const r of [ROADS.main, ROADS.back]) for (let k = 0; k < 7; k++) box(mLine, 2.6, 0.012, 0.5, cx - ROADW / 2 - 2, 0.014, r.z0 + 0.6 + k * 1.1);
  }
  // 가게 앞 횡단보도
  for (let k = 0; k < 7; k++) box(mLine, 0.55, 0.012, 7.4, 8 + k * 1.05, 0.014, 10.5);

  // ── 건물 블록 ──
  const KINDS = ['apt', 'office', 'old', 'brick', 'stone', 'glass'];
  const FM = {}; for (const k of KINDS) { const t = facade(k); FM[k] = M({ map: t, emissiveMap: emissiveOf(t), emissive: 0xffffff, emissiveIntensity: 0.9, roughness: k === 'glass' || k === 'office' ? 0.25 : 0.85, envMapIntensity: k === 'glass' ? 0.8 : 0.2 }); }
  const mRoof = M({ color: 0x2a2d31 }), mSign = new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }), mShopWin = new THREE.MeshBasicMaterial({ map: winTex, color: 0xbbbbbb, toneMapped: false });
  const cross = M({ color: 0xff2030, emissive: 0xff1020, emissiveIntensity: 2.2 });
  const building = (x0, x1, z0, z1, h, kind, frontZ) => {
    const sx = x1 - x0, sz = z1 - z0, g = new THREE.BoxGeometry(sx, h, sz), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) { const face = Math.floor(i / 4); const W = face < 2 ? sz : sx; uv.setXY(i, uv.getX(i) * W / 12, uv.getY(i) * h / 12); }
    g.translate((x0 + x1) / 2, h / 2, (z0 + z1) / 2); add(FM[kind], g); box(mRoof, sx + 0.3, 0.4, sz + 0.3, (x0 + x1) / 2, h + 0.2, (z0 + z1) / 2);
    onCollider?.({ x0: x0 - 0.1, x1: x1 + 0.1, z0: z0 - 0.1, z1: z1 + 0.1 });
    if (frontZ != null && h > 5) { // 1층 상가: 진열창 + 간판
      const fz = frontZ > (z0 + z1) / 2 ? z1 + 0.02 : z0 - 0.02, dir = frontZ > (z0 + z1) / 2 ? 1 : -1;
      for (let x = x0 + 0.5; x < x1 - 4; x += 8 + Math.random() * 4) {
        const wv = Math.min(7, x1 - 0.5 - x), shop = Math.random() * SHOPS.length | 0;
        const win = new THREE.Mesh(new THREE.PlaneGeometry(wv, 2.6), mShopWin); win.position.set(x + wv / 2, 1.35, fz); if (dir < 0) win.rotation.y = Math.PI; root.add(win);
        const sg = new THREE.PlaneGeometry(wv, 1.1), u = sg.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, (shop % 4 + u.getX(i)) / 4, 1 - (Math.floor(shop / 4) + 1 - u.getY(i)) / 4);
        const s = new THREE.Mesh(sg, mSign); s.position.set(x + wv / 2, 3.35, fz + dir * 0.02); if (dir < 0) s.rotation.y = Math.PI; root.add(s);
      }
    }
    if (h > 18 && Math.random() < 0.35) { const cx = (x0 + x1) / 2 + rnd(-2, 2), cz = (z0 + z1) / 2; box(cross, 0.25, 3.2, 0.25, cx, h + 2, cz); box(cross, 1.6, 0.25, 0.25, cx, h + 2.8, cz); }
  };
  // 블록 채우기: x 구간 × z 구간
  const fill = (x0, x1, z0, z1, frontZ, minH = 8, maxH = 40) => { let x = x0; while (x < x1 - 6) { const w = Math.min(x1 - x, rnd(9, 20)); const d = Math.min(z1 - z0, rnd(10, 18)); const zz0 = frontZ > (z0 + z1) / 2 ? z1 - d : z0; building(x, x + w, zz0, zz0 + d, rnd(minH, maxH), R(KINDS), frontZ); x += w + rnd(0.5, 3); } };
  const SIDE = 3.2; // 보도 폭
  const MZ0 = ROADS.main.z0 - SIDE, MZ1 = ROADS.main.z1 + SIDE, BZ0 = ROADS.back.z0 - SIDE, BZ1 = ROADS.back.z1 + SIDE;
  const XA = ROADS.cross[0] - ROADW / 2 - SIDE, XB = ROADS.cross[0] + ROADW / 2 + SIDE, XC = ROADS.cross[1] - ROADW / 2 - SIDE, XD = ROADS.cross[1] + ROADW / 2 + SIDE;
  // 우리 가게 블록: 가게 양옆 상가 + 뒤쪽
  building(-24, -5.3, -14, 3.9, 14, 'old', 10); building(-41, -24.5, -14, 3.9, 22, 'apt', 10);
  building(5.0, 20, -14, 3.9, 11, 'brick', 10); building(-5.2, 4.9, -16, -8.4, 14, 'stone', null); building(20.5, 46, -14, 3.9, 26, 'office', 10);
  fill(XB, XC, BZ1, -16, BZ1, 8, 30);
  // 큰길 건너편
  fill(XB, XC, MZ1, MZ1 + 18, MZ1, 10, 45); fill(XA - 120, XA, MZ1, MZ1 + 18, MZ1, 10, 45); fill(XD, XD + 120, MZ1, MZ1 + 18, MZ1, 10, 45);
  // 세로길 바깥 블록 (가게 쪽)
  fill(XA - 120, XA, BZ1, MZ0, MZ0, 8, 35); fill(XD, XD + 120, BZ1, MZ0, MZ0, 8, 35);
  // 뒷길 건너편
  fill(XA - 120, XA, BZ0 - 18, BZ0, BZ0, 10, 40); fill(XB, XC, BZ0 - 18, BZ0, BZ0, 10, 40); fill(XD, XD + 120, BZ0 - 18, BZ0, BZ0, 10, 40);
  // ── 가로등 · 가로수 ──
  const mPole = M({ color: 0x3a3d42, metalness: 0.6, roughness: 0.4 }), mBulb = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc77a).multiplyScalar(3) });
  const poolTex = ctex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,190,110,.45)'); gr.addColorStop(1, 'rgba(255,190,110,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
  const mPool = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const lamp = (x, z, dz) => { box(mPole, 0.16, 6.5, 0.16, x, 3.25, z); box(mPole, 0.1, 0.1, 1.6, x, 6.4, z + dz * 0.8); box(mBulb, 0.5, 0.1, 0.22, x, 6.3, z + dz * 1.5); const p = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), mPool); p.rotation.x = -Math.PI / 2; p.position.set(x, 0.02, z + dz * 2.5); root.add(p); };
  const mTrunk = M({ color: 0x3b2a1f }), mLeaf = M({ color: 0x1f3a22, roughness: 0.95 });
  const tree = (x, z) => { box(mTrunk, 0.22, 2.6, 0.22, x, 1.3, z); for (let i = 0; i < 3; i++) add(mLeaf, new THREE.IcosahedronGeometry(rnd(0.9, 1.3), 1).translate(x + rnd(-0.5, 0.5), rnd(3, 4.2), z + rnd(-0.5, 0.5))); box(M({ color: 0x4a4038 }), 1.1, 0.12, 1.1, x, 0.06, z); };
  for (let x = -170; x < 170; x += 24) {
    if (Math.abs(x - ROADS.cross[0]) < 8 || Math.abs(x - ROADS.cross[1]) < 8) continue;
    if (Math.abs(x) > 12) lamp(x, ROADS.main.z0 - 0.6, 1); lamp(x + 12, ROADS.main.z1 + 0.6, -1); lamp(x + 6, ROADS.back.z1 + 0.6, -1);
    if (Math.abs(x - 2) > 14) tree(x + 6, ROADS.main.z0 - 1.6); tree(x + 18, ROADS.main.z1 + 1.6);
  }
  for (let z = -160; z < 120; z += 24) for (const cx of ROADS.cross) { if (Math.abs(z - 10) < 10 || Math.abs(z + 72) < 10) continue; lamp(cx - ROADW / 2 - 0.6, z, 1 * 0); tree(cx + ROADW / 2 + 1.6, z + 12); }
  // ── 신호등 (교차로) ──
  const lights = [];
  for (const cx of ROADS.cross) for (const [dx, dz] of [[-1, -1], [1, 1]]) {
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

  // 합치기
  for (const [mat, list] of geos) { const m = new THREE.Mesh(mergeGeometries(list.map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; })), mat); m.matrixAutoUpdate = false; root.add(m); }
  // 신호 바뀌기
  let sig = 0, sigT = 0;
  const update = (dt) => { if ((sigT += dt) > [12, 3, 12][sig]) { sigT = 0; sig = (sig + 1) % 3; } lights.forEach((b, i) => b.forEach((m, k) => (m.material.opacity = 1, m.visible = k === (i % 2 ? (2 - sig + 3) % 3 : sig)))); };
  return { root, update };
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
  const wm = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  for (const x of [-3.6, 3.4]) for (const z of [-1.1, 1.1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 16), wm); w.rotation.x = Math.PI / 2; w.position.set(x, 0.5, z); g.add(w); }
  g.rotation.y = 0; g.userData.size = new THREE.Vector3(W, H, L);
  // 모델 앞을 +z 로 (지프와 같게)
  const holder = new THREE.Group(); g.rotation.y = -Math.PI / 2; holder.add(g); holder.userData.size = new THREE.Vector3(W, H, L); return holder;
}
export function makeTraffic(scene, vehicles, audio, CAR_COLORS) {
  const list = [], base = vehicles.car;
  const cloneCar = (color, taxi) => {
    const c = base.clone(true); c.visible = true; c.userData.size = base.userData.size;
    c.traverse(o => { if (o.isMesh && o.material === base.userData.paint) { o.material = o.material.clone(); o.material.color.setHex(color); } });
    if (taxi) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.25), new THREE.MeshBasicMaterial({ toneMapped: false, map: ctex(128, 64, (g, w, h) => { g.fillStyle = '#ffcc00'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.font = `900 30px ${FONT}`; g.fillText('TAXI', 26, 44); }, false) })); s.position.set(0, base.userData.size.y + 0.12, 0); c.add(s); }
    c.children.forEach(o => { if (o.isSpotLight) o.visible = false; });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(4, 7), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: ctex(64, 128, (g, w, h) => { const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(255,245,210,.5)'); gr.addColorStop(1, 'rgba(255,245,210,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false) }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.03, base.userData.size.z / 2 + 3.5); c.add(pool);
    return c;
  };
  const lanes = [
    { axis: 'x', dir: -1, c: 8.6, len: 170 }, { axis: 'x', dir: 1, c: 12.4, len: 170 },
    { axis: 'z', dir: 1, c: ROADS.cross[0] - 2, len: 150, off: -30 }, { axis: 'z', dir: -1, c: ROADS.cross[1] + 2, len: 150, off: -30 },
    { axis: 'x', dir: 1, c: ROADS.back.z0 + 2, len: 170 },
  ];
  const spawn = (mesh, lane, at, speed, kind) => {
    scene.add(mesh); mesh.visible = true;
    const v = { mesh, lane, s: at, speed, kind, snd: audio.play('engine', { pos: mesh.position, vol: kind === 'bus' ? 1.8 : 1.1, loop: true, rate: kind === 'bus' ? 0.38 : 0.55 + speed / 30 }), honked: 0 };
    list.push(v); return v;
  };
  spawn(cloneCar(0xf4f4f2), lanes[0], -60, 11, 'car'); spawn(cloneCar(0xff9f1c, true), lanes[1], 20, 10, 'taxi'); spawn(busMesh('#1d5fc8', '472', '신촌역'), lanes[1], -90, 8, 'bus');
  spawn(busMesh('#2e9b48', '7016', '달빛시장'), lanes[0], 80, 7.5, 'bus'); spawn(cloneCar(0x1c2c52), lanes[2], 0, 12, 'car'); spawn(cloneCar(0x7a1414), lanes[3], 40, 11, 'car'); spawn(cloneCar(0x111214), lanes[4], 0, 13, 'car');
  const tmp = new THREE.Vector3();
  return {
    list,
    update(dt, player) {
      for (const v of list) {
        const L = v.lane; let speed = v.speed;
        const pos = L.axis === 'x' ? tmp.set(v.s, 0, L.c) : tmp.set(L.c, 0, v.s + (L.off || 0));
        // 앞에 사람이 있으면 멈추고 경적
        if (player) { const ahead = L.axis === 'x' ? (player.x - v.s) * L.dir : (player.z - (v.s + (L.off || 0))) * L.dir, side = L.axis === 'x' ? Math.abs(player.z - L.c) : Math.abs(player.x - L.c);
          if (ahead > 0 && ahead < 9 && side < 2) { speed = 0; if (v.honked <= 0) { audio.play('horn', { pos, vol: 1.2 }); v.honked = 6; } } }
        v.honked -= dt; v.cur = (v.cur ?? speed) + (speed - (v.cur ?? speed)) * Math.min(1, dt * 2);
        v.s += L.dir * v.cur * dt; if (v.s > L.len) v.s = -L.len; if (v.s < -L.len) v.s = L.len;
        v.mesh.position.copy(L.axis === 'x' ? tmp.set(v.s, 0, L.c) : tmp.set(L.c, 0, v.s + (L.off || 0)));
        v.mesh.rotation.y = L.axis === 'x' ? (L.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (L.dir > 0 ? 0 : Math.PI);
        audio.movePanner(v.snd, v.mesh.position);
      }
    },
  };
}
