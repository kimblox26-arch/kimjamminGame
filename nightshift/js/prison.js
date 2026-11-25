// 달빛교도소: 도시 남서쪽 블록에 있는 실제 교도소 단지 (밖에서도 보이고 차로 가 볼 수 있음)
// 높은 콘크리트 외벽 + 윤형 철조망, 모서리 감시탑 4개(탐조등), 정문·초소·표지석, 행정동,
// 2층 수용동(감방 8칸: 2층 침대·스테인리스 변기·세면대·선반·작은 창, 철창문), 복도·휴게 공간(식탁·TV·교도관 부스·계단·2층 통로),
// 운동장(농구 골대·철봉·벤치·투광등, 철조망 울타리 + 개구멍) → 환풍구로 탈옥
import * as THREE from 'three';
import { pbr } from './tex.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const FONT = '"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
const M = o => new THREE.MeshStandardMaterial({ roughness: 0.7, envMapIntensity: 0.4, ...o });
function ctex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
const noise = (g, w, h, n, a, light) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${light && Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * a})`; const s = 1 + Math.random() * 3; g.fillRect(Math.random() * w, Math.random() * h, s, s); } };
// 상자: 면마다 실제 크기대로 UV (T = 텍스처 한 장이 덮는 미터)
function box(p, m, sx, sy, sz, x, y, z, T = 2) {
  const g = new THREE.BoxGeometry(sx, sy, sz), uv = g.attributes.uv, D = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * D[f][0] / T, uv.getY(i) * D[f][1] / T); }
  const b = new THREE.Mesh(g, m); b.position.set(x, y, z); p.add(b); return b;
}
const cyl = (p, m, r, h, x, y, z, seg = 8, rx = 0, rz = 0) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); c.position.set(x, y, z); c.rotation.set(rx, 0, rz); p.add(c); return c; };
const pl = (p, m, w, h, x, y, z, ry = 0) => { const q = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); q.position.set(x, y, z); q.rotation.y = ry; p.add(q); return q; };
const sign = (w, h, draw) => new THREE.MeshStandardMaterial({ map: ctex(w, h, draw), roughness: 0.6 });

export function buildPrison(scene, collide, base) {
  const g = new THREE.Group(); g.position.copy(base); scene.add(g);
  const W = (x0, x1, z0, z1) => collide({ x0: base.x + Math.min(x0, x1), x1: base.x + Math.max(x0, x1), z0: base.z + Math.min(z0, z1), z1: base.z + Math.max(z0, z1) });

  // ── 재질 ──
  const conc = M({ ...pbr('concrete', [1, 1]), color: 0xc4c0b6 }), concDark = M({ ...pbr('concrete', [1, 1]), color: 0x7d7a74 });
  const wallTex = ctex(512, 512, (q, w, h) => { // 4m×4m: 아래 1.2m 연녹색 페인트, 위 미색, 때·긁힘
    q.fillStyle = '#d8d4c8'; q.fillRect(0, 0, w, h); q.fillStyle = '#7f9a8c'; q.fillRect(0, h * 0.7, w, h * 0.3); q.fillStyle = '#4f6a5c'; q.fillRect(0, h * 0.695, w, 6);
    noise(q, w, h, 5000, 0.05, true); for (let i = 0; i < 40; i++) { q.strokeStyle = `rgba(40,40,40,${0.05 + Math.random() * 0.1})`; q.lineWidth = 1; const x = Math.random() * w, y = h * (0.55 + Math.random() * 0.4); q.beginPath(); q.moveTo(x, y); q.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 8); q.stroke(); }
    const gr = q.createLinearGradient(0, h * 0.9, 0, h); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.25)'); q.fillStyle = gr; q.fillRect(0, h * 0.9, w, h * 0.1);
  });
  const mWall = M({ map: wallTex, roughness: 0.85 });
  const mWallMark = M({ map: ctex(512, 512, (q, w, h) => { q.drawImage(wallTex.image, 0, 0); q.strokeStyle = 'rgba(30,30,30,.55)'; q.lineWidth = 3; // 날짜 세는 금·낙서
    for (let k = 0; k < 6; k++) { const x0 = 70 + k * 46; for (let i = 0; i < 4; i++) { q.beginPath(); q.moveTo(x0 + i * 7, 150); q.lineTo(x0 + i * 7, 186); q.stroke(); } q.beginPath(); q.moveTo(x0 - 4, 182); q.lineTo(x0 + 26, 152); q.stroke(); }
    q.font = `600 26px ${FONT}`; q.fillStyle = 'rgba(40,40,40,.45)'; q.fillText('엄마 보고싶다', 300, 250); q.fillText('2611', 120, 260); }), roughness: 0.85 });
  const lino = M({ map: ctex(256, 256, (q, w, h) => { q.fillStyle = '#b8a888'; q.fillRect(0, 0, w, h); noise(q, w, h, 3000, 0.06, true); q.strokeStyle = 'rgba(0,0,0,.12)'; q.strokeRect(0, 0, w, h); }), roughness: 0.55, envMapIntensity: 0.6 });
  const floorC = M({ ...pbr('concrete', [1, 1]), color: 0x9a9894, roughness: 0.55, envMapIntensity: 0.7 });
  const steel = M({ color: 0x3b3f45, metalness: 0.85, roughness: 0.38 }), bars = M({ color: 0x2c3036, metalness: 0.9, roughness: 0.32 });
  const steelLight = M({ color: 0x8c949c, metalness: 0.8, roughness: 0.4 }), stainless = M({ color: 0xd2d6da, metalness: 0.95, roughness: 0.22 });
  const mattress = M({ color: 0x3a4a5c, roughness: 0.6 }), blanket = M({ map: ctex(128, 128, (q, w, h) => { q.fillStyle = '#6b5e4e'; q.fillRect(0, 0, w, h); noise(q, w, h, 1500, 0.12); q.fillStyle = 'rgba(30,20,10,.25)'; for (let y = 0; y < h; y += 16) q.fillRect(0, y, w, 2); }), roughness: 0.95 });
  const pillow = M({ color: 0xd6d2c6, roughness: 0.9 }), paintYel = new THREE.MeshStandardMaterial({ color: 0xd7a91d, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }), paintW = new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
  const glow = c => new THREE.MeshBasicMaterial({ color: new THREE.Color(c), toneMapped: false });
  const darkGlass = M({ color: 0x0c1118, metalness: 0.3, roughness: 0.15, envMapIntensity: 1 }), litWin = new THREE.MeshBasicMaterial({ map: ctex(128, 64, (q, w, h) => { q.fillStyle = '#7d7356'; q.fillRect(0, 0, w, h); q.fillStyle = 'rgba(40,34,20,.45)'; for (let y = 3; y < h; y += 6) q.fillRect(0, y, w, 2); }) });
  const asph = M({ ...pbr('asphalt', [1, 1]), color: 0x8a8a8a, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const gravel = M({ map: ctex(256, 256, (q, w, h) => { q.fillStyle = '#6d6862'; q.fillRect(0, 0, w, h); for (let i = 0; i < 4500; i++) { const l = 30 + Math.random() * 40; q.fillStyle = `hsl(30,6%,${l}%)`; q.beginPath(); q.arc(Math.random() * w, Math.random() * h, 0.8 + Math.random() * 2.2, 0, 7); q.fill(); } }), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

  // ── 땅: 자갈(벽 안쪽 빈 땅) · 운동장 아스팔트 · 정문 앞 진입로 ──
  box(g, gravel, 74, 0.02, 88, 0, 0.012, 0, 2.5);
  box(g, asph, 52, 0.02, 40, 0, 0.03, -14.3, 6);
  box(g, asph, 12, 0.02, 4.8, 0, 0.03, -46.4, 6); box(g, asph, 12, 0.02, 9.6, 0, 0.025, -39, 6);

  // ── 외벽: 높이 6.5m, 위에 윤형 철조망, 바깥 면 투광등 ──
  const WH = 6.5, X = 37, Z = 44;
  const wireTex = ctex(256, 128, (q, w, h) => { q.clearRect(0, 0, w, h); q.strokeStyle = 'rgba(205,210,215,1)'; q.lineWidth = 2.2; for (let i = -1; i < 9; i++) { q.beginPath(); q.ellipse(i * 32 + 16, h / 2, 26, h / 2 - 6, 0.25, 0, 7); q.stroke(); } q.strokeStyle = 'rgba(160,165,170,1)'; q.lineWidth = 1.4; for (let i = 0; i < 40; i++) { const x = Math.random() * w, y = Math.random() * h; q.beginPath(); q.moveTo(x, y); q.lineTo(x + 5, y - 3); q.stroke(); } });
  const mWire = new THREE.MeshStandardMaterial({ map: wireTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.8, roughness: 0.35 });
  const outerWall = (x0, x1, z0, z1) => {
    const horiz = z0 === z1, len = horiz ? x1 - x0 : z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    box(g, conc, horiz ? len : 0.6, WH, horiz ? 0.6 : len, cx, WH / 2, cz, 3); box(g, concDark, horiz ? len + 0.6 : 0.9, 0.25, horiz ? 0.9 : len + 0.6, cx, WH + 0.12, cz, 3);
    box(g, concDark, horiz ? len : 0.66, 0.6, horiz ? 0.66 : len, cx, 0.3, cz, 3);
    for (let k = 4; k < len; k += 8) box(g, conc, horiz ? 0.5 : 0.8, WH, horiz ? 0.8 : 0.5, horiz ? x0 + k : x0, WH / 2, horiz ? z0 : z0 + k, 3); // 기둥
    const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, len, 10, 1, true), mWire); coil.geometry.rotateZ(Math.PI / 2); coil.geometry.attributes.uv.array.forEach((v, i, a) => { if (i % 2 === 0) a[i] = v * len / 0.9; });
    coil.position.set(cx, WH + 0.6, cz); if (!horiz) coil.rotation.y = Math.PI / 2; g.add(coil);
    for (let k = 6; k < len; k += 12) { const lx = horiz ? x0 + k : x0, lz = horiz ? z0 : z0 + k, o = horiz ? (z0 < 0 ? -0.45 : 0.45) : (x0 < 0 ? -0.45 : 0.45); box(g, steel, 0.4, 0.22, 0.3, horiz ? lx : lx + o, WH - 0.5, horiz ? lz + o : lz); box(g, glow(0xfff2d6), 0.32, 0.04, 0.22, horiz ? lx : lx + o, WH - 0.62, horiz ? lz + o : lz); }
  };
  outerWall(-X, -6, -Z, -Z); outerWall(6, X, -Z, -Z); outerWall(-X, X, Z, Z); outerWall(-X, -X, -Z, Z); outerWall(X, X, -Z, Z);
  W(-X - 0.4, -5.5, -Z - 0.4, -Z + 0.4); W(5.5, X + 0.4, -Z - 0.4, -Z + 0.4); W(-X - 0.4, X + 0.4, Z - 0.4, Z + 0.4); W(-X - 0.4, -X + 0.4, -Z, Z); W(X - 0.4, X + 0.4, -Z, Z);

  // ── 정문: 철문 2짝 + 위 간판 + 초소 + 차단기 + 표지석 + 깃대 ──
  for (const s of [-1, 1]) { const gt = box(g, steel, 5.6, 5.8, 0.18, s * 2.85, 2.9, -Z, 2); void gt; for (let k = 0; k < 9; k++) box(g, steelLight, 0.08, 5.6, 0.26, s * (0.4 + k * 0.62), 2.9, -Z); box(g, steelLight, 5.6, 0.12, 0.28, s * 2.85, 1.2, -Z); box(g, steelLight, 5.6, 0.12, 0.28, s * 2.85, 4.6, -Z); }
  W(-6, 6, -Z - 0.3, -Z + 0.3);
  for (const s of [-1, 1]) box(g, conc, 1.4, 8.6, 1.4, s * 6.4, 4.3, -Z, 3);
  box(g, conc, 14.2, 1.6, 1.4, 0, 8.6, -Z, 3);
  const title = sign(1024, 160, (q, w, h) => { q.fillStyle = '#1f2a33'; q.fillRect(0, 0, w, h); q.fillStyle = '#e9e4d6'; q.font = `900 86px ${FONT}`; q.textAlign = 'center'; q.fillText('달 빛 교 도 소', w / 2, 92); q.font = `700 30px ${FONT}`; q.fillStyle = '#b9b3a3'; q.fillText('DALBIT CORRECTIONAL INSTITUTION', w / 2, 140); });
  pl(g, title, 11, 1.2, 0, 8.6, -Z - 0.72, Math.PI);
  box(g, glow(0xfff0d0), 11, 0.05, 0.1, 0, 9.42, -Z - 0.75);
  // 초소 (정문 오른쪽 밖)
  box(g, conc, 3.2, 2.9, 2.6, 9.2, 1.45, -Z - 2.2, 2); box(g, darkGlass, 3.22, 1.0, 2.0, 9.2, 1.9, -Z - 2.2); box(g, litWin, 2.2, 0.8, 0.02, 9.2, 1.9, -Z - 3.52); box(g, concDark, 3.6, 0.25, 3.0, 9.2, 3.0, -Z - 2.2); W(7.6, 10.8, -Z - 3.5, -Z - 0.9);
  const arm = new THREE.Group(); arm.position.set(6.8, 1.0, -Z - 3.9); g.add(arm); box(arm, M({ color: 0xd92f2f }), 5.4, 0.1, 0.1, -2.7, 0, 0); for (let k = 0; k < 5; k++) box(arm, M({ color: 0xf2f2f2 }), 0.5, 0.11, 0.11, -0.6 - k * 1.1, 0, 0); box(g, steel, 0.3, 1.1, 0.3, 6.8, 0.55, -Z - 3.9);
  // 표지석
  box(g, M({ color: 0x5a5753, roughness: 0.4, envMapIntensity: 0.8 }), 4.2, 1.5, 0.8, -12, 0.75, -Z - 2.6);
  pl(g, sign(512, 160, (q, w, h) => { q.fillStyle = '#4d4a46'; q.fillRect(0, 0, w, h); noise(q, w, h, 2500, 0.15, true); q.fillStyle = '#d9cfae'; q.font = `900 70px ${FONT}`; q.textAlign = 'center'; q.fillText('달빛교도소', w / 2, 100); q.font = `600 24px ${FONT}`; q.fillText('바른 삶으로 돌아가는 길', w / 2, 140); }), 3.6, 1.1, -12, 0.85, -Z - 3.02, Math.PI);
  W(-14.2, -9.8, -Z - 3.1, -Z - 2.2);
  for (const [k, c] of [[0, '#2b4a7a'], [1, '#e8e6df'], [2, '#7a2b2b']]) { const x = 14 + k * 2.4; cyl(g, steelLight, 0.06, 9, x, 4.5, -Z - 2.6); const f = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.2, 6, 1), new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, roughness: 0.8 })); f.position.set(x + 0.92, 8.2, -Z - 2.6); f.userData.flag = true; f.userData.keep = true; g.add(f); }
  // 담장 밖 가로등(정문 앞)
  for (const x of [-8, 8]) { cyl(g, steel, 0.08, 6, x, 3, -Z - 4.4); box(g, steel, 0.5, 0.15, 0.3, x, 6, -Z - 4.2); box(g, glow(0xffe1b0), 0.42, 0.03, 0.24, x, 5.92, -Z - 4.2); }
  const gateL = new THREE.PointLight(0xffe0b8, 10, 22, 1.4); gateL.position.set(0, 6.4, -Z - 4); g.add(gateL);
  for (const x of [-22, 22]) { const wl = new THREE.PointLight(0xffc88a, 9, 22, 1.4); wl.position.set(x, 5.6, -Z - 1.6); g.add(wl); }

  // ── 감시탑 4개 ──
  const towers = [];
  for (const [tx, tz] of [[-X + 2.6, -Z + 2.6], [X - 2.6, -Z + 2.6], [-X + 2.6, Z - 2.6], [X - 2.6, Z - 2.6]]) {
    const t = new THREE.Group(); t.position.set(tx, 0, tz); g.add(t); towers.push(t);
    box(t, conc, 2.6, 8.2, 2.6, 0, 4.1, 0, 3); box(t, concDark, 4.4, 0.3, 4.4, 0, 8.3, 0, 3);
    box(t, conc, 4.0, 1.0, 4.0, 0, 8.95, 0, 3); box(t, darkGlass, 4.04, 1.2, 4.04, 0, 10.05, 0); for (const [x, z] of [[-1.95, -1.95], [1.95, -1.95], [-1.95, 1.95], [1.95, 1.95]]) box(t, steel, 0.14, 1.3, 0.14, x, 10.05, z);
    box(t, litWin, 3.0, 0.5, 0.02, 0, 10.0, 2.03); box(t, concDark, 4.8, 0.3, 4.8, 0, 10.8, 0, 3);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; box(t, steel, 4.4, 0.06, 0.06, Math.sin(a) * 2.2, 9.5, Math.cos(a) * 2.2).rotation.y = a; }
    box(t, steel, 0.5, 0.45, 0.6, 0, 11.2, 0); box(t, glow(0xfffbe8), 0.42, 0.36, 0.02, 0, 11.2, 0.31);
    W(tx - 1.4, tx + 1.4, tz - 1.4, tz + 1.4);
  }

  // ── 행정동 (정문 안 오른쪽) ──
  const winTex = ctex(512, 256, (q, w, h) => { q.fillStyle = '#b9b4a8'; q.fillRect(0, 0, w, h); noise(q, w, h, 3000, 0.06, true); for (let r = 0; r < 2; r++) for (let c = 0; c < 8; c++) { const lit = Math.random() < 0.45; q.fillStyle = lit ? '#e9d9a8' : '#1b2630'; q.fillRect(c * 64 + 12, r * 128 + 34, 40, 56); q.fillStyle = 'rgba(0,0,0,.35)'; q.fillRect(c * 64 + 12, r * 128 + 88, 40, 4); } });
  const mAdmin = M({ map: winTex, emissiveMap: winTex, emissive: 0x6b6044, emissiveIntensity: 0.55, roughness: 0.8 });
  winTex.repeat.set(1, 2.5); box(g, mAdmin, 8, 7.2, 16, 31.8, 3.6, -28, 18); box(g, concDark, 8.6, 0.4, 16.6, 31.8, 7.4, -28, 3); W(27.8, 35.8, -36, -20);
  pl(g, sign(512, 96, (q, w, h) => { q.fillStyle = '#2d3a46'; q.fillRect(0, 0, w, h); q.fillStyle = '#fff'; q.font = `800 54px ${FONT}`; q.textAlign = 'center'; q.fillText('행 정 동', w / 2, 66); }), 4, 0.75, 27.76, 5.4, -28, -Math.PI / 2);
  box(g, concDark, 2.2, 0.2, 4, 26.7, 3.0, -28); box(g, darkGlass, 0.06, 2.6, 2.2, 27.77, 1.3, -28);

  // ── 수용동: x -22..22, z 6..26, 높이 8.6 (1층 감방 8칸 + 2층 통로) ──
  const BX = 22, BZ0 = 6, BZ1 = 26, BH = 8.6, CZ = 11; // CZ: 감방 앞 철창 선
  // 바깥 벽 (운동장 쪽 = 북쪽 z 6)
  box(g, conc, BX * 2, BH, 0.6, 0, BH / 2, BZ0, 3); box(g, conc, BX * 2, BH, 0.6, 0, BH / 2, BZ1, 3); box(g, conc, 0.6, BH, BZ1 - BZ0, -BX, BH / 2, (BZ0 + BZ1) / 2, 3); box(g, conc, 0.6, BH, BZ1 - BZ0, BX, BH / 2, (BZ0 + BZ1) / 2, 3);
  box(g, concDark, BX * 2 + 0.7, 0.9, BZ1 - BZ0 + 0.7, 0, 0.45, (BZ0 + BZ1) / 2, 3); // 아랫단 띠
  box(g, concDark, BX * 2 + 0.8, 0.4, BZ1 - BZ0 + 0.8, 0, BH + 0.2, (BZ0 + BZ1) / 2, 3); // 지붕
  for (const [x, z] of [[-12, 14], [-2, 20], [10, 16]]) { box(g, steelLight, 2.2, 1.2, 1.4, x, BH + 1, z); box(g, steel, 1.6, 0.1, 1.0, x, BH + 1.65, z); }
  W(-BX - 0.3, BX + 0.3, BZ0 - 0.35, BZ0 + 0.3); W(-BX - 0.3, BX + 0.3, BZ1 - 0.3, BZ1 + 0.35); W(-BX - 0.35, -BX + 0.3, BZ0, BZ1); W(BX - 0.3, BX + 0.35, BZ0, BZ1);
  pl(g, sign(512, 96, (q, w, h) => { q.fillStyle = '#c9c4b6'; q.fillRect(0, 0, w, h); q.fillStyle = '#2b3138'; q.font = `900 60px ${FONT}`; q.textAlign = 'center'; q.fillText('수 용 동  A', w / 2, 70); }), 5, 0.9, 0, 7.4, BZ0 - 0.32, Math.PI);
  // 바깥 창 (작고 창살): 1층·2층 감방마다
  const cells = []; for (let i = 0; i < 8; i++) cells.push(-17.5 + i * 5);
  for (const cx of cells) for (const [y, inner] of [[2.9, true], [6.5, false]]) {
    box(g, darkGlass, 1.0, 0.55, 0.05, cx + 1.2, y, BZ0 - 0.32); for (let k = 0; k < 4; k++) box(g, bars, 0.035, 0.6, 0.035, cx + 0.84 + k * 0.24, y, BZ0 - 0.36); box(g, concDark, 1.2, 0.08, 0.2, cx + 1.2, y - 0.33, BZ0 - 0.38);
    void inner;
  }
  for (let x = -18; x <= 18; x += 6) { box(g, darkGlass, 2.2, 1.2, 0.05, x, 6.2, BZ1 + 0.32); for (let k = 0; k < 6; k++) box(g, bars, 0.035, 1.25, 0.035, x - 0.9 + k * 0.36, 6.2, BZ1 + 0.36); }
  // 실내 바닥·천장
  box(g, floorC, BX * 2 - 0.6, 0.04, BZ1 - CZ - 0.6, 0, 0.02, (CZ + BZ1) / 2, 3);
  box(g, M({ color: 0xbfbcb2, roughness: 0.9 }), BX * 2 - 0.6, 0.12, BZ1 - BZ0 - 0.6, 0, BH - 0.15, (BZ0 + BZ1) / 2, 4);
  box(g, mWall, BX * 2 - 0.62, BH - 0.2, 0.02, 0, (BH - 0.2) / 2, BZ1 - 0.31, 4); // 남쪽 안벽
  box(g, mWall, 0.02, BH - 0.2, BZ1 - CZ, -BX + 0.31, (BH - 0.2) / 2, (CZ + BZ1) / 2, 4); box(g, mWall, 0.02, BH - 0.2, BZ1 - CZ, BX - 0.31, (BH - 0.2) / 2, (CZ + BZ1) / 2, 4);
  box(g, paintYel, BX * 2 - 1, 0.01, 0.12, 0, 0.045, CZ + 1.0); // 철창 앞 노란 선 (넘지 말 것)
  // 2층: 감방 위 바닥판 + 복도 위 통로(난간) + 2층 철창 앞면
  box(g, concDark, BX * 2 - 0.6, 0.3, CZ - BZ0 + 1.6, 0, 4.05, (BZ0 + CZ + 1.6) / 2, 3);
  box(g, steelLight, BX * 2 - 0.6, 0.06, 0.06, 0, 5.2, CZ + 1.55); box(g, steelLight, BX * 2 - 0.6, 0.04, 0.04, 0, 4.7, CZ + 1.55);
  for (let x = -BX + 0.6; x < BX; x += 1.25) box(g, steelLight, 0.05, 1.0, 0.05, x, 4.7, CZ + 1.55);
  box(g, mWall, BX * 2 - 0.62, BH - 4.2, 0.2, 0, 4.2 + (BH - 4.4) / 2, CZ - 0.25, 4);
  for (const cx of cells) { box(g, glow(0x060708), 4.4, 3.0, 0.02, cx, 5.75, CZ - 0.14); for (let k = 0; k < 24; k++) box(g, bars, 0.03, 3.1, 0.03, cx - 2.2 + k * 0.19, 5.75, CZ - 0.1); box(g, bars, 4.5, 0.08, 0.06, cx, 4.35, CZ - 0.1); box(g, bars, 4.5, 0.08, 0.06, cx, 7.25, CZ - 0.1); }
  // 계단 (서쪽 끝, 1층 → 2층 통로)
  for (let k = 0; k < 14; k++) box(g, steelLight, 1.4, 0.06, 0.32, -BX + 1.3, 0.3 * (k + 1), CZ + 1.9 + 8.4 - k * 0.6);
  box(g, steel, 0.08, 0.35, 8.9, -BX + 2.05, 2.25, CZ + 6.4).rotation.x = 0.49; W(-BX + 0.3, -BX + 2.1, CZ + 1.6, CZ + 10.6);
  // 감방 8칸
  const plateT = n => sign(128, 64, (q, w, h) => { q.fillStyle = '#28323c'; q.fillRect(0, 0, w, h); q.fillStyle = '#fff'; q.font = `800 38px ${FONT}`; q.textAlign = 'center'; q.fillText(`${100 + n}`, w / 2, 45); });
  for (let i = 0; i < cells.length; i++) {
    const cx = cells[i], x0 = cx - 2.5, x1 = cx + 2.5, wallM = i === 1 ? mWallMark : mWall;
    box(g, lino, 4.75, 0.03, CZ - BZ0 - 0.3, cx, 0.02, (BZ0 + 0.3 + CZ) / 2, 2);
    box(g, wallM, 4.75, 3.9, 0.02, cx, 1.95, BZ0 + 0.31, 4); // 뒷벽 (안쪽 면)
    if (i === 0) box(g, conc, 0.25, 3.9, CZ - BZ0, x0, 1.95, (BZ0 + CZ) / 2, 3);
    box(g, conc, 0.25, 3.9, CZ - BZ0 - 0.3, x1, 1.95, (BZ0 + 0.3 + CZ) / 2, 3); box(g, wallM, 0.02, 3.9, CZ - BZ0 - 0.3, x1 - 0.13, 1.95, (BZ0 + 0.3 + CZ) / 2, 4); box(g, mWall, 0.02, 3.9, CZ - BZ0 - 0.3, x0 + 0.13, 1.95, (BZ0 + 0.3 + CZ) / 2, 4);
    W(x1 - 0.15, x1 + 0.15, BZ0, CZ); if (i === 0) W(x0 - 0.15, x0 + 0.15, BZ0, CZ);
    // 철창: 세로 둥근 창살 + 가로 띠 + 미닫이 문(자물쇠 통·배식구)
    for (let k = 0; k < 34; k++) cyl(g, bars, 0.019, 3.82, x0 + 0.2 + k * 0.137, 1.95, CZ, 6);
    for (const y of [0.12, 1.05, 2.1, 3.0, 3.82]) box(g, bars, 4.75, 0.07, 0.05, cx, y, CZ);
    box(g, bars, 0.12, 3.9, 0.12, cx + 0.4, 1.95, CZ); box(g, steel, 0.22, 0.32, 0.16, cx + 0.55, 1.15, CZ + 0.06); box(g, steel, 0.6, 0.16, 0.1, cx - 0.4, 1.05, CZ + 0.02);
    pl(g, plateT(i + 1), 0.42, 0.21, cx, 3.62, CZ + 0.08);
    // 2층 침대 (서쪽 벽)
    const bxl = x0 + 0.62, bz = BZ0 + 0.3 + 1.05;
    for (const [dx, dz] of [[-0.42, -0.98], [0.42, -0.98], [-0.42, 0.98], [0.42, 0.98]]) cyl(g, steelLight, 0.03, 1.8, bxl + dx, 0.9, bz + dz, 6);
    for (const y of [0.42, 1.48]) { box(g, steelLight, 0.9, 0.05, 2.0, bxl, y, bz); box(g, mattress, 0.84, 0.13, 1.92, bxl, y + 0.09, bz); box(g, pillow, 0.55, 0.1, 0.32, bxl, y + 0.2, bz - 0.74).rotation.z = 0.05; box(g, blanket, 0.86, 0.06, 0.8, bxl, y + 0.18, bz + 0.45); }
    for (let k = 0; k < 4; k++) box(g, steelLight, 0.03, 0.03, 0.34, bxl + 0.45, 0.6 + k * 0.28, bz + 0.98).rotation.y = Math.PI / 2;
    W(x0 + 0.1, x0 + 1.1, BZ0 + 0.3, BZ0 + 2.45);
    // 화장실 칸막이 + 스테인리스 변기·세면대 일체형 + 거울판
    box(g, wallM, 0.08, 1.4, 1.3, x1 - 1.35, 0.7, BZ0 + 0.95, 4); box(g, stainless, 0.5, 0.42, 0.6, x1 - 0.55, 0.21, BZ0 + 0.66); box(g, M({ color: 0x0d0f12, roughness: 0.2 }), 0.36, 0.02, 0.36, x1 - 0.55, 0.425, BZ0 + 0.72);
    box(g, stainless, 0.55, 0.5, 0.25, x1 - 0.55, 0.72, BZ0 + 0.44); box(g, stainless, 0.5, 0.06, 0.32, x1 - 0.55, 1.0, BZ0 + 0.5); box(g, stainless, 0.4, 0.3, 0.02, x1 - 0.55, 1.6, BZ0 + 0.33);
    W(x1 - 1.4, x1 - 0.1, BZ0 + 0.3, BZ0 + 1.6);
    // 선반 + 소지품 (책·컵·칫솔)
    box(g, steelLight, 0.3, 0.03, 1.2, x1 - 0.3, 1.5, BZ0 + 2.8); for (let k = 0; k < 4; k++) box(g, M({ color: [0x7a2e2e, 0x2e4f7a, 0xd8c9a0, 0x3d6b4a][k], roughness: 0.8 }), 0.18, 0.24, 0.04, x1 - 0.3, 1.64, BZ0 + 2.4 + k * 0.05);
    cyl(g, M({ color: 0xe9e4d8, roughness: 0.6 }), 0.04, 0.1, x1 - 0.3, 1.565, BZ0 + 3.1, 10); cyl(g, M({ color: 0x5a9ad8 }), 0.006, 0.18, x1 - 0.31, 1.62, BZ0 + 3.1, 4, 0, 0.2);
    // 작은 철제 책상 + 걸상 (바닥 고정)
    box(g, steelLight, 0.5, 0.04, 0.8, x1 - 0.35, 0.75, BZ0 + 3.5); box(g, steelLight, 0.04, 0.75, 0.04, x1 - 0.55, 0.37, BZ0 + 3.5); cyl(g, steelLight, 0.16, 0.04, x1 - 0.85, 0.45, BZ0 + 3.5, 12); cyl(g, steelLight, 0.03, 0.45, x1 - 0.85, 0.22, BZ0 + 3.5, 6);
    W(x1 - 0.65, x1 - 0.1, BZ0 + 3.05, BZ0 + 3.95);
    // 높은 창 (안쪽): 바깥 달빛
    box(g, glow(0x2a3448), 1.0, 0.55, 0.02, cx + 1.2, 2.9, BZ0 + 0.33); for (let k = 0; k < 4; k++) box(g, bars, 0.035, 0.6, 0.04, cx + 0.84 + k * 0.24, 2.9, BZ0 + 0.35);
    // 천장 철망 등
    box(g, steel, 0.5, 0.08, 0.3, cx, 3.84, BZ0 + 2.6); box(g, glow(i === 1 ? 0xfff1d6 : 0xd8e0ea), 0.4, 0.03, 0.2, cx, 3.79, BZ0 + 2.6);
  }
  W(-BX, BX, CZ - 0.12, CZ + 0.12); // 철창 (잠김)
  const vent = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), new THREE.MeshStandardMaterial({ map: ctex(128, 96, (q, w, h) => { q.fillStyle = '#8a8f96'; q.fillRect(0, 0, w, h); q.fillStyle = '#1d1f22'; for (let y = 10; y < h - 6; y += 12) q.fillRect(8, y, w - 16, 5); q.fillStyle = '#555'; for (const [x, y] of [[5, 5], [w - 9, 5], [5, h - 9], [w - 9, h - 9]]) q.fillRect(x, y, 4, 4); }), metalness: 0.6, roughness: 0.5 }));
  vent.position.set(cells[1] - 0.2, 0.5, BZ0 + 0.33); vent.userData.keep = true; g.add(vent);
  box(g, glow(0x050505), 0.56, 0.41, 0.01, cells[1] - 0.2, 0.5, BZ0 + 0.322);
  const ventHit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.4), new THREE.MeshBasicMaterial()); ventHit.visible = false; ventHit.position.set(cells[1] - 0.2, 0.5, BZ0 + 0.48); ventHit.userData.aim = 'vent'; g.add(ventHit);
  // 휴게 공간: 식탁(의자 붙은 철제) 3개, 벽걸이 TV, 교도관 부스(유리), 게시판, 시계, CCTV
  for (const x of [-10, -2, 6]) { const tz = 19.5; cyl(g, steelLight, 0.7, 0.05, x, 0.76, tz, 20); cyl(g, steel, 0.06, 0.74, x, 0.37, tz, 8); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; cyl(g, steelLight, 0.2, 0.04, x + Math.cos(a) * 1.05, 0.45, tz + Math.sin(a) * 1.05, 12); cyl(g, steel, 0.03, 0.45, x + Math.cos(a) * 1.05, 0.22, tz + Math.sin(a) * 1.05, 6); } W(x - 0.75, x + 0.75, tz - 0.75, tz + 0.75); }
  box(g, M({ color: 0x0b0c0e, roughness: 0.25, emissive: 0x24384f, emissiveIntensity: 0.6 }), 1.6, 0.92, 0.06, -4, 3.3, BZ1 - 0.38); box(g, steel, 0.3, 0.3, 0.3, -4, 3.3, BZ1 - 0.5);
  pl(g, sign(512, 384, (q, w, h) => { q.fillStyle = '#7b5a36'; q.fillRect(0, 0, w, h); q.fillStyle = '#efe9d8'; q.fillRect(16, 16, w - 32, h - 32); q.fillStyle = '#1d2733'; q.font = `900 40px ${FONT}`; q.textAlign = 'center'; q.fillText('수용자 준수사항', w / 2, 70); q.textAlign = 'left'; q.font = `600 24px ${FONT}`; ['1. 점호 시간 06:30 · 21:00', '2. 거실 내 흡연 금지', '3. 교도관의 지시에 따를 것', '4. 다른 수용자와 다툼 금지', '5. 운동 시간 10:00 ~ 11:00'].forEach((t, k) => q.fillText(t, 50, 130 + k * 46)); }), 2.2, 1.65, 6, 2.0, BZ1 - 0.33, Math.PI);
  pl(g, M({ map: ctex(128, 128, (q, w, h) => { q.fillStyle = '#fff'; q.beginPath(); q.arc(64, 64, 60, 0, 7); q.fill(); q.strokeStyle = '#222'; q.lineWidth = 5; q.stroke(); for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283; q.fillStyle = '#222'; q.fillRect(64 + Math.sin(a) * 48 - 2, 64 - Math.cos(a) * 48 - 2, 4, 4); } q.lineWidth = 4; q.beginPath(); q.moveTo(64, 64); q.lineTo(64, 28); q.moveTo(64, 64); q.lineTo(88, 72); q.stroke(); }), roughness: 0.4 }), 0.6, 0.6, 12, 3.4, BZ1 - 0.33, Math.PI);
  box(g, darkGlass, 5.6, 2.4, 0.06, 17.5, 1.7, 20.4); box(g, darkGlass, 0.06, 2.4, 5, 14.7, 1.7, 22.9); box(g, steel, 5.6, 0.12, 5.2, 17.5, 2.95, 22.9);
  box(g, steelLight, 3, 0.05, 0.8, 18, 0.95, 23.8); box(g, M({ color: 0x111, emissive: 0x2b6aa8, emissiveIntensity: 0.5 }), 0.6, 0.38, 0.03, 17.4, 1.25, 23.5); box(g, M({ color: 0x111, emissive: 0x3a8a5a, emissiveIntensity: 0.5 }), 0.6, 0.38, 0.03, 18.2, 1.25, 23.5);
  W(14.6, BX, 20.3, BZ1);
  for (const [x, z] of [[-BX + 0.6, CZ + 1.8], [BX - 0.6, CZ + 1.8], [0, BZ1 - 0.6]]) { box(g, M({ color: 0xe8e8e8, roughness: 0.4 }), 0.16, 0.12, 0.3, x, 3.6, z); box(g, glow(0xff2020), 0.02, 0.02, 0.02, x, 3.6, z + (z > 20 ? -0.16 : 0.16)); }
  for (let x = -16; x <= 16; x += 8) { box(g, steel, 1.4, 0.1, 0.4, x, BH - 0.25, 18.5); box(g, glow(0xe8eef6), 1.3, 0.03, 0.3, x, BH - 0.31, 18.5); }
  const L1 = new THREE.PointLight(0xdfe6f0, 9, 24, 1.3); L1.position.set(-8, 6.5, 17); g.add(L1);
  const L2 = new THREE.PointLight(0xdfe6f0, 9, 24, 1.3); L2.position.set(10, 6.5, 17); g.add(L2);
  const Lc = new THREE.PointLight(0xffe8c8, 3.2, 7, 1.5); Lc.position.set(cells[1], 3.5, BZ0 + 2.6); g.add(Lc);

  // ── 운동장: x -26..26, z -34..5.7 (철조망 울타리, 서북쪽 개구멍) ──
  const yard = { x0: -26, x1: 26, z0: -34, z1: 5.7 };
  // 농구장 반쪽 + 골대
  box(g, paintW, 14, 0.01, 0.1, 12, 0.045, -6); box(g, paintW, 0.1, 0.01, 14, 5, 0.045, -13); box(g, paintW, 0.1, 0.01, 14, 19, 0.045, -13); box(g, paintW, 14, 0.01, 0.1, 12, 0.045, -20);
  box(g, paintW, 4.8, 0.01, 0.1, 12, 0.045, -14.2); box(g, paintW, 0.1, 0.01, 5.8, 9.6, 0.045, -17.1); box(g, paintW, 0.1, 0.01, 5.8, 14.4, 0.045, -17.1);
  cyl(g, steel, 0.09, 3.6, 12, 1.8, -21.4); box(g, steel, 0.08, 0.08, 1.2, 12, 3.4, -20.9); box(g, M({ color: 0xf2f2f2, roughness: 0.5 }), 1.8, 1.05, 0.05, 12, 3.45, -20.3); box(g, M({ color: 0xd04a1a }), 0.6, 0.45, 0.06, 12, 3.3, -20.29);
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.015, 6, 20), M({ color: 0xd04a1a, metalness: 0.5 })); hoop.rotation.x = Math.PI / 2; hoop.position.set(12, 3.05, -20.0); g.add(hoop); W(11.8, 12.2, -21.6, -21.2);
  // 철봉·평행봉
  for (const [x, z] of [[-18, -24], [-14, -24]]) { cyl(g, steel, 0.05, 2.4, x - 0.7, 1.2, z); cyl(g, steel, 0.05, 2.4, x + 0.7, 1.2, z); cyl(g, steelLight, 0.025, 1.4, x, 2.35, z, 8, 0, Math.PI / 2); }
  for (const s of [-1, 1]) { cyl(g, steelLight, 0.03, 2.4, -16, 1.1, -18 + s * 0.3, 8, 0, Math.PI / 2); for (const dx of [-1, 1]) cyl(g, steel, 0.04, 1.1, -16 + dx * 1.1, 0.55, -18 + s * 0.3); }
  // 콘크리트 벤치·식탁
  for (const [x, z] of [[-8, -4], [-2, -4], [-8, -30], [4, -30]]) { box(g, concDark, 2.2, 0.08, 0.5, x, 0.46, z, 2); box(g, concDark, 0.3, 0.42, 0.42, x - 0.8, 0.21, z, 2); box(g, concDark, 0.3, 0.42, 0.42, x + 0.8, 0.21, z, 2); W(x - 1.1, x + 1.1, z - 0.25, z + 0.25); }
  // 투광등 기둥 2개 (실제 조명 1개)
  for (const [x, z] of [[-25, -33], [25, -33]]) { cyl(g, steel, 0.12, 11, x, 5.5, z); box(g, steel, 2.0, 0.12, 0.12, x, 11, z); for (const dx of [-0.7, 0.7]) { box(g, steel, 0.6, 0.4, 0.3, x + dx, 10.8, z + 0.25); box(g, glow(0xfff6e2), 0.5, 0.32, 0.02, x + dx, 10.75, z + 0.41); } W(x - 0.2, x + 0.2, z - 0.2, z + 0.2); }
  const YL = new THREE.PointLight(0xfff0d8, 16, 46, 1.2); YL.position.set(0, 10, -18); g.add(YL);
  // 철조망 울타리 (높이 4m, 위에 기울어진 가시철선 3줄)
  const fenceT = ctex(128, 128, (q, w, h) => { q.clearRect(0, 0, w, h); q.strokeStyle = 'rgba(190,195,200,.95)'; q.lineWidth = 2; for (let i = -h; i < w; i += 16) { q.beginPath(); q.moveTo(i, 0); q.lineTo(i + h, h); q.stroke(); q.beginPath(); q.moveTo(i + h, 0); q.lineTo(i, h); q.stroke(); } });
  const fenceM = new THREE.MeshStandardMaterial({ map: fenceT, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 });
  const gap = { x0: -24.6, x1: -23.4 }, FH = 4;
  const fence = (x0, x1, z0, z1) => {
    const horiz = z0 === z1, len = horiz ? x1 - x0 : z1 - z0;
    const geo = new THREE.PlaneGeometry(len, FH); geo.attributes.uv.array.forEach((v, i, a) => { a[i] = i % 2 === 0 ? v * len / 1.2 : v * FH / 1.2; });
    const f = new THREE.Mesh(geo, fenceM); f.position.set((x0 + x1) / 2, FH / 2, (z0 + z1) / 2); if (!horiz) f.rotation.y = Math.PI / 2; g.add(f);
    for (let k = 0; k <= len + 0.01; k += 3) { const px = horiz ? x0 + k : x0, pz = horiz ? z0 : z0 + k; cyl(g, bars, 0.05, FH + 0.6, px, (FH + 0.6) / 2, pz, 8); const armG = cyl(g, bars, 0.025, 0.7, px + (horiz ? 0 : (x0 < 0 ? -0.22 : 0.22)), FH + 0.75, pz + (horiz ? (z0 < 0 ? -0.22 : 0.22) : 0), 6); if (horiz) armG.rotation.x = z0 < 0 ? -0.6 : 0.6; else armG.rotation.z = x0 < 0 ? 0.6 : -0.6; }
    for (let r = 0; r < 3; r++) { const off = 0.12 + r * 0.14, out = (horiz ? (z0 < 0 ? -1 : 1) : (x0 < 0 ? -1 : 1)) * off; const wbar = box(g, bars, horiz ? len : 0.015, 0.015, horiz ? 0.015 : len, horiz ? (x0 + x1) / 2 : x0 + out, FH + 0.55 + r * 0.14, horiz ? z0 + out : (z0 + z1) / 2); void wbar; }
    box(g, bars, horiz ? len : 0.05, 0.05, horiz ? 0.05 : len, (x0 + x1) / 2, FH, (z0 + z1) / 2);
  };
  fence(yard.x0, gap.x0, yard.z0, yard.z0); fence(gap.x1, yard.x1, yard.z0, yard.z0); fence(yard.x0, yard.x0, yard.z0, BZ0 - 0.3); fence(yard.x1, yard.x1, yard.z0, BZ0 - 0.3);
  W(yard.x0 - 0.1, gap.x0, yard.z0 - 0.12, yard.z0 + 0.12); W(gap.x1, yard.x1 + 0.1, yard.z0 - 0.12, yard.z0 + 0.12); W(yard.x0 - 0.12, yard.x0 + 0.12, yard.z0, BZ0); W(yard.x1 - 0.12, yard.x1 + 0.12, yard.z0, BZ0);
  box(g, fenceM, gap.x1 - gap.x0, FH - 1.05, 0.01, (gap.x0 + gap.x1) / 2, 1.05 + (FH - 1.05) / 2, yard.z0); // 개구멍 위쪽 철망
  const flap = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.0), fenceM); flap.position.set(gap.x0 + 0.1, 0.5, yard.z0 - 0.35); flap.rotation.y = -0.9; g.add(flap);
  fence(-26, -22, BZ0 - 0.3, BZ0 - 0.3); fence(22, 26, BZ0 - 0.3, BZ0 - 0.3); W(-26.1, -21.7, BZ0 - 0.42, BZ0 - 0.18); W(21.7, 26.1, BZ0 - 0.42, BZ0 - 0.18);
  const holeHit = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1), new THREE.MeshBasicMaterial()); holeHit.visible = false; holeHit.position.set((gap.x0 + gap.x1) / 2, 0.7, yard.z0 + 0.3); holeHit.userData.aim = 'fence'; g.add(holeHit);

  // ── 탐조등 (북동 감시탑에서 운동장을 훑음): 실제 스포트라이트 1개 + 빛줄기 ──
  const tw = towers[1], lampLocal = V3(tw.position.x, 11.2, tw.position.z);
  const spot = new THREE.SpotLight(0xffffff, 160, 70, 0.16, 0.5, 1.2); spot.position.copy(lampLocal); g.add(spot); spot.target.position.set(0, 0, -15); g.add(spot.target);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffee, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  beam.geometry.translate(0, -0.5, 0); beam.geometry.rotateX(-Math.PI / 2); beam.position.copy(lampLocal); beam.userData.keep = true; g.add(beam);
  const sweep = t => V3(Math.sin(t * 0.33) * 19, 0, -15 + Math.cos(t * 0.26) * 13);
  const aimSpot = t => { const p = sweep(t); spot.target.position.copy(p); spot.target.updateMatrixWorld(); const d = p.clone().sub(lampLocal); beam.position.copy(lampLocal); beam.lookAt(base.clone().add(p)); beam.scale.set(1, 1, d.length()); return base.clone().add(p); };
  aimSpot(0);
  // 깃발 흔들기
  const flags = []; g.traverse(o => o.userData.flag && flags.push(o));
  const update = t => { for (const f of flags) { const p = f.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i) + 0.9; p.setZ(i, Math.sin(t * 3 + x * 3) * 0.08 * x); } p.needsUpdate = true; } };

  // ── 호송차 실내 (멀리 떨어진 곳, 사방이 막힘) ──
  const van = V3(30, 0, 660), vg = new THREE.Group(); vg.position.copy(van); scene.add(vg);
  box(vg, M({ color: 0x2b2f36 }), 5, 0.05, 2.2, 0, 0.4, 0); box(vg, M({ color: 0x3a3f45 }), 5, 0.05, 2.2, 0, 2.3, 0);
  for (const z of [-1.1, 1.1]) { box(vg, M({ color: 0x4a5058 }), 5, 1.9, 0.05, 0, 1.35, z); for (let x = -2; x <= 2; x += 1) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.35), new THREE.MeshBasicMaterial({ color: 0x0a0d14 })); w.position.set(x, 1.6, z * 0.97); w.rotation.y = z > 0 ? Math.PI : 0; vg.add(w); for (let k = 0; k < 4; k++) box(vg, bars, 0.025, 0.4, 0.025, x - 0.22 + k * 0.15, 1.6, z * 0.95); } }
  box(vg, M({ color: 0x4a5058 }), 0.05, 1.9, 2.2, -2.5, 1.35, 0); box(vg, M({ color: 0x4a5058 }), 0.05, 1.9, 2.2, 2.5, 1.35, 0);
  for (let k = 0; k < 9; k++) box(vg, bars, 0.03, 1.9, 0.03, 1.6, 1.35, -1 + k * 0.25);
  box(vg, M({ color: 0x6b6f75 }), 4, 0.08, 0.45, 0, 0.85, 0.75); box(vg, M({ color: 0x6b6f75 }), 4, 0.08, 0.45, 0, 0.85, -0.75);
  const vl = new THREE.PointLight(0xbfd0ff, 2.5, 5, 1.6); vl.position.set(0, 2.1, 0); vg.add(vl);

  const L = (x, y, z) => base.clone().add(V3(x, y, z));
  let T = 0;
  const api = {
    group: g, van, cells, vent, ventHit, holeHit, yard, spot, beam, tw, aimSpot, update,
    cellPos: i => L(cells[i], 1.55, BZ0 + 2.6),
    ductOut: L(cells[1] - 0.2, 1.55, BZ0 - 1.6),
    outside: L(-30, 1.55, -Z - 3.5),
    gate: L(0, 0, -Z - 5),
    inmateSpots: [[cells[0] + 0.6, CZ - 0.5], [cells[2] - 0.4, CZ - 0.5], [cells[3] + 0.3, CZ - 1.6], [cells[5], CZ - 0.5]].map(([x, z]) => L(x, 0, z)),
    patrols: [[L(-16, 0, CZ + 3), L(16, 0, CZ + 3)], [L(-20, 0, -28), L(-20, 0, -6)], [L(20, 0, -6), L(4, 0, -28)]],
    bounds: { x0: base.x - X, x1: base.x + X, z0: base.z - Z, z1: base.z + Z },
  };
  // 가까이 있을 때만: 탐조등이 운동장을 훑고 깃발이 펄럭임 (멀면 조명 끔 → 셰이더 재컴파일 없이 비용 0)
  api.tick = (dt, me) => {
    T += dt; const near = Math.abs(me.x - base.x) < 170 && Math.abs(me.z - base.z) < 170;
    spot.intensity = near ? 160 : 0; beam.visible = near; if (!near) return;
    api.spotPos = aimSpot(T); update(T);
  };
  return api;
}
