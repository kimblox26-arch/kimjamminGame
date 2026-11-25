// 지하도 · 달빛 지하상가: 큰길(달빛대로) 아래 넓은 지하 보도. 양쪽 보도에서 계단으로 내려감.
// 밤이라 가게 대부분은 셔터가 내려져 있고, 몇 곳만 불이 켜져 있음. 기둥 광고판, 벤치, 출구 안내판, 자판기.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FONT = '"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
export const UNDER = {
  y: -4.2, ceil: -0.7,
  hall: { x0: 34, x1: 76, z0: 3.0, z1: 18.0 },
  stairs: [{ x0: 26, x1: 34, z0: 4.2, z1: 6.0, exit: 1 }, { x0: 26, x1: 34, z0: 15.0, z1: 16.8, exit: 2 }],
};
// 발밑 높이: 계단은 비탈, 지하에 있으면 지하 바닥
export function groundAt(x, z, feetY) {
  for (const s of UNDER.stairs) if (x > s.x0 && x < s.x1 + 0.8 && z > s.z0 - 0.05 && z < s.z1 + 0.05) return UNDER.y * Math.min(1, (x - s.x0) / (s.x1 - s.x0));
  const h = UNDER.hall;
  if (feetY < -2 && x > h.x0 - 0.5 && x < h.x1 && z > h.z0 && z < h.z1) return UNDER.y;
  return 0;
}
function ctex(w, h, draw, rep) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } return t; }
const rnd = (a, b) => a + Math.random() * (b - a);

export function buildUnderpass(scene, onCollider) {
  const group = new THREE.Group(); scene.add(group);
  const geos = new Map(), add = (m, g) => { if (!geos.has(m)) geos.set(m, []); geos.get(m).push(g.index ? g.toNonIndexed() : g); };
  const box = (m, sx, sy, sz, x, y, z) => add(m, new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z));
  // 월드 좌표 UV 상자 (타일이 늘어나지 않게)
  const tbox = (m, sx, sy, sz, x, y, z, s = 1) => { const g = new THREE.BoxGeometry(sx, sy, sz), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const f = Math.floor(i / 4), W = f < 2 ? sz : sx, H = f === 2 || f === 3 ? sz : sy; uv.setXY(i, uv.getX(i) * W / s, uv.getY(i) * H / s); } add(m, g.translate(x, y, z)); };
  const plane = (m, w, h, x, y, z, ry = 0, rx = 0) => { const g = new THREE.PlaneGeometry(w, h); if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); add(m, g.translate(x, y, z)); };
  const M = o => new THREE.MeshStandardMaterial({ roughness: 0.6, envMapIntensity: 0.5, ...o });
  const { y: Y, ceil: CY, hall: H } = UNDER, HH = CY - Y;
  // 재질: 광택 바닥 타일, 벽 타일, 천장 텍스, 계단 돌
  const floorT = ctex(512, 512, (g, w, h) => { g.fillStyle = '#b9b3a8'; g.fillRect(0, 0, w, h); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? '#c4beb3' : '#aea89c'; g.fillRect(x * 128 + 1, y * 128 + 1, 126, 126); for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '60,55,50' : '235,230,220'},${Math.random() * 0.35})`; g.fillRect(x * 128 + Math.random() * 126, y * 128 + Math.random() * 126, 2, 2); } } g.fillStyle = 'rgba(80,75,70,.6)'; for (let i = 0; i <= 4; i++) { g.fillRect(i * 128 - 1, 0, 2, h); g.fillRect(0, i * 128 - 1, w, 2); } }, true);
  const wallT = ctex(256, 256, (g, w, h) => { g.fillStyle = '#e4e0d6'; g.fillRect(0, 0, w, h); for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) { g.fillStyle = `hsl(40,${10 + Math.random() * 6}%,${84 + Math.random() * 5}%)`; g.fillRect(x * 64 + 1, y * 32 + 1, 62, 30); } }, true);
  const ceilT = ctex(256, 256, (g, w, h) => { g.fillStyle = '#c9ccd0'; g.fillRect(0, 0, w, h); for (let i = 0; i <= 4; i++) { g.fillStyle = '#8f9399'; g.fillRect(i * 64 - 1, 0, 2, h); g.fillRect(0, i * 64 - 1, w, 2); } for (let i = 0; i < 900; i++) { g.fillStyle = 'rgba(90,90,95,.25)'; g.fillRect(Math.random() * w, Math.random() * h, 1, 1); } }, true);
  const mFloor = M({ map: floorT, roughness: 0.16, envMapIntensity: 1.1 }), mWall = M({ map: wallT, roughness: 0.35 }), mCeil = M({ map: ceilT, roughness: 0.9 });
  const mStep = M({ color: 0x8e8a84, roughness: 0.75 }), mNose = M({ color: 0xd8b13a, roughness: 0.6 }), mSteel = M({ color: 0xb8bec6, metalness: 0.85, roughness: 0.25 });
  const mGlass = M({ color: 0xcfe3f0, transparent: true, opacity: 0.22, roughness: 0.05, envMapIntensity: 1.2, side: THREE.DoubleSide });
  const mLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf4f8ff).multiplyScalar(1.6), toneMapped: false });
  // ── 넓은 홀 ──
  plane(mFloor, H.x1 - H.x0, H.z1 - H.z0, (H.x0 + H.x1) / 2, Y, (H.z0 + H.z1) / 2, 0, -Math.PI / 2);
  const fl = geos.get(mFloor)[0], fp = fl.attributes.position, fu = fl.attributes.uv; for (let i = 0; i < fp.count; i++) fu.setXY(i, fp.getX(i) / 2.4, fp.getZ(i) / 2.4);
  plane(mCeil, H.x1 - H.x0, H.z1 - H.z0, (H.x0 + H.x1) / 2, CY, (H.z0 + H.z1) / 2, 0, Math.PI / 2);
  { const cg = geos.get(mCeil)[0], p = cg.attributes.position, u = cg.attributes.uv; for (let i = 0; i < p.count; i++) u.setXY(i, p.getX(i) / 2.4, p.getZ(i) / 2.4); }
  for (let x = H.x0 + 3; x < H.x1 - 1; x += 4) for (const z of [6.2, 10.5, 14.8]) box(mLight, 1.8, 0.03, 0.32, x, CY - 0.02, z);  // 천장 조명
  tbox(mWall, H.x1 - H.x0, HH, 0.2, (H.x0 + H.x1) / 2, Y + HH / 2, H.z0 - 0.1, 2); tbox(mWall, H.x1 - H.x0, HH, 0.2, (H.x0 + H.x1) / 2, Y + HH / 2, H.z1 + 0.1, 2);
  tbox(mWall, 0.2, HH, H.z1 - H.z0, H.x1 + 0.1, Y + HH / 2, (H.z0 + H.z1) / 2, 2);
  // 서쪽 벽 (계단 두 곳 뚫림)
  const segs = [[H.z0, UNDER.stairs[0].z0 - 0.1], [UNDER.stairs[0].z1 + 0.1, UNDER.stairs[1].z0 - 0.1], [UNDER.stairs[1].z1 + 0.1, H.z1]];
  for (const [a, b] of segs) { tbox(mWall, 0.2, HH, b - a, H.x0 - 0.1, Y + HH / 2, (a + b) / 2, 2); onCollider({ x0: H.x0 - 0.2, x1: H.x0 + 0.05, z0: a, z1: b, lv: -1 }); }
  for (const s of UNDER.stairs) tbox(mWall, 0.2, 1.2, s.z1 - s.z0 + 0.2, H.x0 - 0.1, CY - 0.6 + 0.0, (s.z0 + s.z1) / 2, 2);   // 계단 입구 위 벽
  onCollider({ x0: H.x0, x1: H.x1, z0: H.z0 - 0.3, z1: H.z0 + 0.05, lv: -1 }); onCollider({ x0: H.x0, x1: H.x1, z0: H.z1 - 0.05, z1: H.z1 + 0.3, lv: -1 }); onCollider({ x0: H.x1 - 0.05, x1: H.x1 + 0.3, z0: H.z0, z1: H.z1, lv: -1 });
  // ── 가게들 (북쪽·남쪽 벽) : 셔터 내림 / 불 켜진 가게 ──
  const SH = [['패션 STYLE', '#111', '#f5f5f5'], ['화장품', '#ff4f8b', '#fff'], ['휴대폰 할인', '#0057b8', '#fff'], ['안경원', '#1d3557', '#fff'], ['꽃집', '#2e7d32', '#fff'], ['분식', '#e63946', '#ffef5a'], ['액세서리', '#6a1b9a', '#fff'], ['구두 수선', '#5d4037', '#fff'], ['약국', '#2a9d8f', '#fff'], ['서점', '#283593', '#fff'], ['네일', '#ad1457', '#fff'], ['24시 카페', '#3e2723', '#f4e1c1']];
  const signT = ctex(1024, 768, (g, w, h) => SH.forEach(([t, bg, fg], i) => { const x = (i % 4) * 256, y = Math.floor(i / 4) * 256; g.fillStyle = bg; g.fillRect(x + 2, y + 2, 252, 252); g.fillStyle = fg; g.font = `900 ${t.length > 4 ? 44 : 60}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x + 128, y + 128); }));
  const mSign = new THREE.MeshBasicMaterial({ map: signT, toneMapped: false });
  const shutT = ctex(256, 256, (g, w, h) => { g.fillStyle = '#9aa0a7'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 7) { g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(0, y, w, 2); g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, y + 5, w, 2); } g.fillStyle = '#444'; g.fillRect(w / 2 - 14, h - 22, 28, 8); });
  const mShut = M({ map: shutT, metalness: 0.55, roughness: 0.4 });
  const shopIn = ctex(512, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#fff8ea'); gr.addColorStop(1, '#e8d8bc'); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let s = 0; s < 3; s++) { g.fillStyle = '#c9b89a'; g.fillRect(0, 60 + s * 62, w, 6); for (let i = 0; i < 18; i++) { g.fillStyle = `hsl(${Math.random() * 360},55%,${45 + Math.random() * 25}%)`; g.fillRect(10 + i * 28, 30 + s * 62, 20, 30); } } g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(0, 0, w, 10); });
  const mShopIn = new THREE.MeshBasicMaterial({ map: shopIn, toneMapped: false, color: 0xdddddd });
  let si = 0;
  for (const [z, ry, dz] of [[H.z0 + 0.01, 0, 1], [H.z1 - 0.01, Math.PI, -1]]) for (let x = H.x0 + 1.2; x < H.x1 - 5; x += 6.6) {
    const open = Math.random() < 0.3, k = si++ % SH.length, cx = x + 3;
    plane(open ? mShopIn : mShut, 5.6, 2.6, cx, Y + 1.3, z + dz * 0.02, ry);
    const sg = new THREE.PlaneGeometry(5.6, 0.62), u = sg.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, (k % 4 + u.getX(i)) / 4, 1 - (Math.floor(k / 4) + 1 - u.getY(i)) / 3);
    sg.rotateY(ry); sg.translate(cx, Y + 2.95, z + dz * 0.03); add(mSign, sg);
    box(mSteel, 0.08, 3.4, 0.12, x - 0.3, Y + 1.7, z + dz * 0.06);
  }
  // ── 기둥 (광고판) + 벤치 ──
  const adT = ctex(512, 1024, (g, w, h) => { const ads = [['#0b132b', '#5bc0be', '새 학기\n노트북 특가'], ['#3a0ca3', '#f72585', '달빛 뮤직\n페스티벌'], ['#1b4332', '#95d5b2', '맑은 물\n생수 2+1'], ['#7f1d1d', '#fde68a', '치킨 배달\n1588-0000']];
    ads.forEach(([bg, fg, t], i) => { const x = (i % 2) * 256, y = Math.floor(i / 2) * 512; const gr = g.createLinearGradient(0, y, 0, y + 512); gr.addColorStop(0, bg); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(x, y, 256, 512); g.fillStyle = fg; g.font = `900 40px ${FONT}`; t.split('\n').forEach((l, j) => g.fillText(l, x + 20, y + 120 + j * 50)); g.globalAlpha = 0.35; g.beginPath(); g.arc(x + 180, y + 360, 90, 0, 7); g.fill(); g.globalAlpha = 1; }); });
  const mAd = new THREE.MeshBasicMaterial({ map: adT, toneMapped: false });
  const colX = []; for (let x = H.x0 + 5; x < H.x1 - 2; x += 8) colX.push(x);
  colX.forEach((x, n) => { for (const z of [8.0, 13.0]) {
    tbox(mWall, 0.7, HH, 0.7, x, Y + HH / 2, z, 2); onCollider({ x0: x - 0.4, x1: x + 0.4, z0: z - 0.4, z1: z + 0.4, lv: -1 });
    const k = (n + (z > 10 ? 1 : 0)) % 4;
    for (const s of [-1, 1]) { const g = new THREE.PlaneGeometry(0.6, 1.4), u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, (k % 2 + u.getX(i)) / 2, 1 - (Math.floor(k / 2) + 1 - u.getY(i)) / 2); g.rotateY(s < 0 ? Math.PI : 0); g.translate(x, Y + 1.6, z + s * 0.36); add(mAd, g); }
  } });
  const mWood = M({ color: 0x8a6a4b, roughness: 0.7 });
  colX.slice(0, -1).forEach(x => { box(mWood, 2.0, 0.06, 0.45, x + 4, Y + 0.45, 10.5); box(mSteel, 0.06, 0.42, 0.4, x + 3.2, Y + 0.21, 10.5); box(mSteel, 0.06, 0.42, 0.4, x + 4.8, Y + 0.21, 10.5); onCollider({ x0: x + 2.9, x1: x + 5.1, z0: 10.2, z1: 10.8, lv: -1 }); });
  // 자판기
  const vmT = ctex(256, 512, (g, w, h) => { g.fillStyle = '#c1121f'; g.fillRect(0, 0, w, h); g.fillStyle = '#e9f5ff'; g.fillRect(16, 30, w - 32, 300); for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { g.fillStyle = `hsl(${(r * 6 + c) * 37 % 360},65%,50%)`; g.fillRect(26 + c * 36, 46 + r * 72, 26, 54); g.fillStyle = '#222'; g.font = '700 11px sans-serif'; g.fillText('1,200', 24 + c * 36, 112 + r * 72); } g.fillStyle = '#111'; g.fillRect(40, 400, w - 80, 60); g.fillStyle = '#fff'; g.font = '900 30px sans-serif'; g.fillText('COLD DRINK', 34, 380); });
  const vm = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.75), [M({ color: 0x9d0f19 }), M({ color: 0x9d0f19 }), M({ color: 0x9d0f19 }), M({ color: 0x9d0f19 }), new THREE.MeshBasicMaterial({ map: vmT, toneMapped: false }), M({ color: 0x9d0f19 })]);
  vm.position.set(H.x1 - 0.5, Y + 0.95, 12.2); vm.rotation.y = -Math.PI / 2; group.add(vm); onCollider({ x0: H.x1 - 0.9, x1: H.x1, z0: 11.7, z1: 12.7, lv: -1 });
  // 안내판 (출구·지하상가 이름)
  const sign = (txt, sub, x, y, z, ry, bg = '#0a7a45', w = 2.4) => { const t = ctex(512, 128, (g, W, Hh) => { g.fillStyle = bg; g.fillRect(0, 0, W, Hh); g.fillStyle = '#fff'; g.font = `900 46px ${FONT}`; g.fillText(txt, 20, 58); g.font = `700 26px ${FONT}`; g.fillStyle = '#d8f5e6'; g.fillText(sub, 22, 104); }); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: t, toneMapped: false, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.y = ry; group.add(m); return m; };
  sign('← 1번 출구', '달빛24 편의점 · 달빛대로 북쪽', H.x0 + 3.5, CY - 0.35, 5.1, Math.PI / 2);
  sign('← 2번 출구', '버스 정류장 · 달빛시장 방면', H.x0 + 3.5, CY - 0.35, 15.9, Math.PI / 2);
  sign('달빛 지하상가', 'DALBIT UNDERGROUND MALL', H.x1 - 0.12, Y + 2.6, 7.0, -Math.PI / 2, '#1d2d4a', 3.2);
  // ── 계단 (각 28칸, 미끄럼방지 노란 줄) + 벽·난간·지상 유리 난간·입구 간판 ──
  const N = 28, rise = -Y / N, run = 8 / N;
  for (const s of UNDER.stairs) {
    const w = s.z1 - s.z0, cz = (s.z0 + s.z1) / 2;
    for (let i = 0; i < N; i++) { const top = -(i + 1) * rise, x = s.x0 + (i + 0.5) * run; box(mStep, run, 0.35, w, x, top - 0.175, cz); box(mNose, 0.04, 0.012, w - 0.1, x - run / 2 + 0.03, top + 0.006, cz); }
    for (const z of [s.z0 - 0.1, s.z1 + 0.1]) {
      // 비스듬한 계단 옆벽(타일) : 위는 지면, 아래는 지하 천장까지
      tbox(mWall, s.x1 - s.x0, -Y + 0.05, 0.2, (s.x0 + s.x1) / 2, Y / 2, z, 2);
      const rail = new THREE.CylinderGeometry(0.025, 0.025, Math.hypot(8, -Y), 8); rail.rotateZ(Math.atan2(8, -Y)); rail.translate((s.x0 + s.x1) / 2, Y / 2 + 0.9, z + (z < cz ? 0.15 : -0.15)); add(mSteel, rail);
      onCollider({ x0: s.x0 - 0.2, x1: s.x1 + 0.1, z0: z - 0.12, z1: z + 0.12, lv: 'all' });
      // 지상 유리 난간
      plane(mGlass, s.x1 - s.x0, 1.0, (s.x0 + s.x1) / 2, 0.5, z, 0); box(mSteel, s.x1 - s.x0, 0.05, 0.06, (s.x0 + s.x1) / 2, 1.02, z);
    }
    plane(mGlass, w, 1.0, s.x1, 0.5, cz, Math.PI / 2); box(mSteel, 0.06, 0.05, w, s.x1, 1.02, cz);
    onCollider({ x0: s.x1 - 0.1, x1: s.x1 + 0.1, z0: s.z0, z1: s.z1, lv: 0 });
    // 계단 위 지붕(유리 캐노피) + 기둥
    box(mGlass, s.x1 - s.x0 + 0.4, 0.04, w + 0.6, (s.x0 + s.x1) / 2, 2.7, cz); for (const x of [s.x0, s.x1]) for (const z of [s.z0 - 0.25, s.z1 + 0.25]) box(mSteel, 0.06, 2.7, 0.06, x, 1.35, z);
    // 입구 간판 (지하보도 표지)
    const t = ctex(256, 384, (g, W, Hh) => { g.fillStyle = '#0b4fa8'; g.fillRect(0, 0, W, Hh); g.fillStyle = '#fff'; g.font = `900 52px ${FONT}`; g.fillText('지하보도', 22, 92); g.font = `700 30px ${FONT}`; g.fillText(`${s.exit}번 출입구`, 26, 150); g.fillText('달빛 지하상가', 26, 200); g.fillStyle = '#ffd36b'; g.beginPath(); g.moveTo(128, 240); g.lineTo(178, 300); g.lineTo(150, 300); g.lineTo(150, 350); g.lineTo(106, 350); g.lineTo(106, 300); g.lineTo(78, 300); g.closePath(); g.fill(); });
    const tm = new THREE.MeshBasicMaterial({ map: t, toneMapped: false }), bm = M({ color: 0x0b4fa8 });
    const pm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.9), [tm, tm, bm, bm, bm, bm]);
    pm.position.set(s.x0 + 0.6, 2.0, s.exit === 1 ? s.z1 + 0.1 : s.z0 - 0.1); group.add(pm);
    box(mSteel, 0.08, 1.3, 0.08, s.x0 + 0.6, 0.65, pm.position.z);
    // 계단 조명
    for (let x = s.x0 + 1.5; x < s.x1; x += 2.2) for (const z of [s.z0 + 0.01, s.z1 - 0.01]) box(mLight, 0.6, 0.08, 0.02, x, Math.min(-0.25, Y * (x - s.x0) / 8 + 2.1), z);
  }
  for (const [m, list] of geos) { const mesh = new THREE.Mesh(mergeGeometries(list.map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; })), m); mesh.matrixAutoUpdate = false; mesh.updateMatrix(); group.add(mesh); }
  void rnd;
  return { group };
}
