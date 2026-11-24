// 편의점 실내·외 3D (야간). 정적인 상자들은 재질별로 합쳐서 그리기 횟수를 줄인다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PRODUCTS, SHELF_ITEMS, FRIDGE_ITEMS, CIGS } from './data.js';

export const SPOT = {
  cam: new THREE.Vector3(3.4, 1.62, 0.9),
  counterY: 0.95,
  customer: new THREE.Vector3(1.85, 0, 0.9),
  queue: [new THREE.Vector3(1.0, 0, 0.9), new THREE.Vector3(0.2, 0, 0.9)],
  doorIn: new THREE.Vector3(1.1, 0, 3.3), doorOut: new THREE.Vector3(1.1, 0, 5.2), street: new THREE.Vector3(-6, 0, 6),
  aisles: [-3.95, -2.0, 0.25], frontZ: 2.85, backZ: -3.1,
  scanner: new THREE.Vector3(2.75, 1.08, 1.75), bagArea: new THREE.Vector3(2.6, 0.95, 1.95),
  itemArea: new THREE.Vector3(2.55, 0.95, 0.95), pos: new THREE.Vector3(2.8, 1.25, 0.15),
  drawer: new THREE.Vector3(2.82, 0.86, 0.15), cardReader: new THREE.Vector3(2.42, 0.99, 0.3),
  boss: new THREE.Vector3(3.6, 0, -0.55), bossDoor: new THREE.Vector3(3.6, 0, -3.6),
  rack: { x: 4.52, z0: -0.45, z1: 2.25, y0: 1.18, rows: 4, cols: 10 },
  outside: new THREE.Vector3(1, 1.5, 7),
};

const texCache = {};
export function canvasTex(key, w, h, draw, srgb = true) {
  if (texCache[key]) return texCache[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return (texCache[key] = t);
}
const FONT = '"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif';

export { productMesh, cigMesh } from './products.js';
import { productMesh, cigMesh } from './products.js';
import { buildCounter } from './counter.js';
import { Merch } from './merch.js';
import { addDecor } from './decor.js';
// 새 로고 "달빛24": 초승달 + 글자. onDark=true 면 흰 글자
export function drawBrand(g, x, y, h, onDark = true) {
  const r = h * 0.42, cx = x + r, cy = y + h / 2;
  g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  g.beginPath(); g.rect(cx - r - 2, cy - r - 2, r * 2 + 4, r * 2 + 4); g.arc(cx + r * 0.42, cy - r * 0.28, r * 0.86, 0, Math.PI * 2, true);
  g.fillStyle = '#ffc53d'; g.fill('evenodd'); g.restore();
  g.font = `900 ${h * 0.78}px ${FONT}`; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.fillStyle = onDark ? '#ffffff' : '#1f2d4a'; g.fillText('달빛', x + r * 2 + h * 0.12, y + h * 0.8);
  const tw = g.measureText('달빛').width; g.fillStyle = '#2fd3b4'; g.fillText('24', x + r * 2 + h * 0.18 + tw, y + h * 0.8);
}
// ── 정적 상자 합치기 ──
class Batch {
  constructor() { this.g = new Map(); }
  add(mat, geo, x, y, z, ry = 0) {
    geo = geo.clone(); if (ry) geo.rotateY(ry); geo.translate(x, y, z);
    if (!this.g.has(mat)) this.g.set(mat, []); this.g.get(mat).push(geo); return geo;
  }
  box(mat, sx, sy, sz, x, y, z, ry = 0) { return this.add(mat, new THREE.BoxGeometry(sx, sy, sz), x, y, z, ry); }
  build(parent) {
    for (const [mat, geos] of this.g) {
      const norm = geos.map(g => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; });
      const m = new THREE.Mesh(mergeGeometries(norm), mat); m.matrixAutoUpdate = false; parent.add(m);
    }
  }
}

export function buildStore(renderer, scene, quality) {
  const root = new THREE.Group(); scene.add(root);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.background = new THREE.Color(0x03050a);
  scene.fog = new THREE.Fog(0x03050a, 14, 40);

  const B = new Batch();
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.6, envMapIntensity: 0.35, ...o });
  // 재질
  const floorTex = canvasTex('floor', 512, 512, (g, w, h) => {
    g.fillStyle = '#d9d6cf'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '90,85,80' : '255,255,255'},${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.strokeStyle = '#a7a39b'; g.lineWidth = 3; g.strokeRect(0, 0, w, h); g.strokeRect(w / 2, 0, 0, h); g.strokeRect(0, h / 2, w, 0);
  });
  floorTex.repeat.set(8, 6.7);
  const mFloor = std({ map: floorTex, roughness: 0.14, metalness: 0.05, envMapIntensity: 1.1 });
  const mWall = std({ color: 0xc9ccd0, roughness: 0.85 });
  const mBrand = std({ color: 0x14a38b, roughness: 0.5 });
  const mBrand2 = std({ color: 0xff7a2e, roughness: 0.5 });
  const mShelf = std({ color: 0xf2f3f5, roughness: 0.4, metalness: 0.3 });
  const priceTex = canvasTex('price', 1024, 64, (g, w, h) => { g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, w, h); for (let x = 6; x < w; x += 128) { const promo = Math.random() < 0.25; g.fillStyle = promo ? '#ffd400' : '#ffffff'; g.fillRect(x, 6, 116, h - 12); g.strokeStyle = '#c9ced4'; g.strokeRect(x, 6, 116, h - 12); g.fillStyle = promo ? '#d62828' : '#1f2d4a'; g.font = `900 26px ${FONT}`; g.fillText((1000 + (Math.random() * 40 | 0) * 100).toLocaleString(), x + 10, 44); g.font = `800 12px ${FONT}`; g.fillText(promo ? '1+1' : '원', x + 88, 44); } });
  priceTex.repeat.set(5, 1);
  const mShelfEdge = std({ map: priceTex, roughness: 0.5 });
  const mDark = std({ color: 0x23272e, roughness: 0.5, metalness: 0.4 });
  const mMetal = std({ color: 0xb8bec6, roughness: 0.25, metalness: 0.9 });
  const mCounter = std({ color: 0xf4f1ec, roughness: 0.35 });
  const mWood = std({ color: 0x8a6a4b, roughness: 0.55 });
  const ceilTex = canvasTex('ceil', 256, 256, (g, w, h) => { g.fillStyle = '#f2f2f0'; g.fillRect(0, 0, w, h); for (let i = 0; i < 2500; i++) { g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); } g.fillStyle = '#c9cac8'; g.fillRect(0, 0, w, 4); g.fillRect(0, 0, 4, h); });
  ceilTex.repeat.set(16, 13);
  const mCeil = std({ map: ceilTex, roughness: 0.9 });
  const mLed = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(2.5) });

  // 바닥·천장·벽
  const W0 = -5, W1 = 4.6, D0 = -4, D1 = 4, H = 2.8;
  B.box(mFloor, W1 - W0, 0.02, D1 - D0, (W0 + W1) / 2, -0.01, 0);
  B.box(mCeil, W1 - W0, 0.02, D1 - D0, (W0 + W1) / 2, H, 0);
  B.box(mWall, 0.1, H, D1 - D0, W0 - 0.05, H / 2, 0);
  B.box(mWall, 0.1, H, D1 - D0, W1 + 0.05, H / 2, 0);
  B.box(mWall, W1 - W0, H, 0.1, (W0 + W1) / 2, H / 2, D0 - 0.05);
  B.box(mBrand, 0.02, 0.12, D1 - D0, W0 + 0.01, 0.06, 0); B.box(mBrand, 0.02, 0.12, D1 - D0, W1 - 0.01, 0.06, 0);
  B.box(mBrand, 0.02, 0.3, D1 - D0, W1 - 0.01, 2.55, 0); B.box(mBrand2, 0.02, 0.05, D1 - D0, W1 - 0.02, 2.38, 0);
  // LED 조명 패널 + 실제 조명
  const hemi = new THREE.HemisphereLight(0xf4f8ff, 0x6a6458, 0.32); scene.add(hemi);
  [[-2.5, 0], [1.5, 0.5], [3.6, 0.8]].forEach(([x, z]) => { const p = new THREE.PointLight(0xfff6ea, 2.6, 9, 1.6); p.position.set(x, 2.6, z); scene.add(p); });

  // 앞쪽 유리벽 + 문
  const mGlass = new THREE.MeshStandardMaterial({ color: 0x9fb8c8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.12, envMapIntensity: 0.6, depthWrite: false });
  const mFrame = std({ color: 0x3a3f47, metalness: 0.7, roughness: 0.35 });
  B.box(mFrame, W1 - W0, 0.1, 0.12, (W0 + W1) / 2, 0.05, D1);
  B.box(mFrame, W1 - W0, 0.5, 0.12, (W0 + W1) / 2, H - 0.25, D1);
  for (const x of [W0, -2.6, -0.2, 0.6, 1.6, 3.0, W1]) B.box(mFrame, 0.07, H, 0.12, x, H / 2, D1);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mGlass);
  [[W0, -0.2], [1.6, W1]].forEach(([a, b]) => { const g = glass.clone(); g.scale.set(b - a, H - 0.6, 1); g.position.set((a + b) / 2, 0.1 + (H - 0.6) / 2, D1); g.rotation.y = Math.PI; g.renderOrder = 2; root.add(g); });
  // 유리문 (여닫이)
  const door = new THREE.Group(); door.position.set(0.6, 0, D1);
  const dg = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 2.1), mGlass); dg.position.set(0.5, 1.15, 0); dg.renderOrder = 2; door.add(dg);
  const df = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.2, 0.05), mFrame); df.scale.set(1, 1, 1);
  [[0.5, 0.05, 1, 0.1], [0.5, 2.18, 1, 0.08], [0.02, 1.1, 0.04, 2.2], [0.98, 1.1, 0.04, 2.2]].forEach(([x, y, sx, sy]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.05), mFrame); m.position.set(x, y, 0); door.add(m); });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5), mMetal); handle.position.set(0.88, 1.05, -0.05); door.add(handle);
  const pushTxt = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.08), new THREE.MeshBasicMaterial({ map: canvasTex('push', 128, 48, (g, w, h) => { g.fillStyle = '#fff'; g.font = `900 30px ${FONT}`; g.textAlign = 'center'; g.fillText('당기세요', w / 2, 34); }), transparent: true }));
  pushTxt.position.set(0.5, 1.3, -0.01); pushTxt.rotation.y = Math.PI; door.add(pushTxt);
  root.add(door);
  // 앞유리 시트지
  const sticker = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.5), new THREE.MeshBasicMaterial({ transparent: true, map: canvasTex('stk', 512, 112, (g, w, h) => { g.fillStyle = 'rgba(20,163,139,.85)'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = `900 46px ${FONT}`; g.textAlign = 'center'; g.fillText('24시간 영업 · 택배 · ATM', w / 2, 72); }) }));
  sticker.position.set(-3.8 + 1.15, 0.45, D1 - 0.01); sticker.rotation.y = Math.PI; root.add(sticker);

  // 곤돌라 진열대 (섬 2개) + 왼쪽 벽 진열대
  const shelfSlots = [];
  const gondola = (cx, z0, z1, h, sides) => {
    const len = z1 - z0, cz = (z0 + z1) / 2;
    B.box(mShelf, 0.06, h, len, cx, h / 2, cz);
    for (const s of sides) {
      const fx = cx + s * 0.25;
      B.box(mShelf, 0.45, 0.12, len, cx + s * 0.225, 0.06, cz);
      B.box(mDark, 0.02, 0.1, len, cx + s * 0.45, 0.06, cz);
      const nk = h > 1.6 ? 5 : 4;
      for (let k = 0; k < nk; k++) {
        const y = 0.12 + k * (h > 1.6 ? 0.34 : 0.33);
        if (k) B.box(mShelf, 0.42, 0.025, len, cx + s * 0.22, y, cz);
        B.box(mShelfEdge, 0.012, 0.045, len, cx + s * 0.435, y, cz);
        shelfSlots.push({ x: fx, cx, s, k, y: y + 0.013, z0: z0 + 0.05, z1: z1 - 0.05 });
      }
    }
    B.box(mBrand, 0.5, 0.18, 0.02, cx, h + 0.12, z1 + 0.01); // 끝 표지
  };
  gondola(-3, -2, 2, 1.45, [-1, 1]); gondola(-1, -2, 2, 1.45, [-1, 1]); gondola(-4.85, -2.6, 2.6, 1.9, [1]);
  // 천장에 매단 코너 안내판 (양면)
  const aisleSign = (txt, sub, x, z) => {
    const t = canvasTex('as_' + txt, 512, 160, (g, w, h) => { g.fillStyle = '#1f2d4a'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffc53d'; g.fillRect(0, h - 14, w, 14); g.fillStyle = '#fff'; g.font = `900 64px ${FONT}`; g.textAlign = 'center'; g.fillText(txt, w / 2, 82); g.fillStyle = '#9fd8ff'; g.font = `700 26px ${FONT}`; g.fillText(sub, w / 2, 126); });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.34), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, side: THREE.DoubleSide, emissive: 0x111111 }));
    m.position.set(x, 2.32, z); m.rotation.y = Math.PI / 2; root.add(m);
    B.box(mMetal, 0.01, 0.42, 0.01, x, 2.6, z - 0.45); B.box(mMetal, 0.01, 0.42, 0.01, x, 2.6, z + 0.45);
  };
  aisleSign('라면 · 즉석', 'NOODLE · INSTANT', -3.95, 0); aisleSign('과자 · 간식', 'SNACK', -2.0, 0); aisleSign('생활 · 잡화', 'DAILY', 0.25, -0.5);
  // 상품 채우기 (종류별 InstancedMesh)
  const inst = {}; const put = (key, x, y, z, ry) => { (inst[key] ||= []).push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1))); };
  const SPAN = { cup: 0.125, tri: 0.09, tray: 0.24, jar: 0.08, bottle: 0.075, can: 0.075, soju: 0.08, bag: 0.17, box: 0.21, small: 0.085 };
  const merch = new Merch();
  // 곤돌라별 품목 (아래칸 → 위칸)
  const PLAN = { '-3:-1': ['box', 'cup', 'cup', 'cup'], '-3:1': ['box', 'bag', 'bag', 'bag'], '-1:-1': ['box', 'box', 'small', 'small'], '-1:1': ['bag', 'box', 'bag', 'small'], '-4.85:1': ['box', 'bag', 'bag', 'bag', 'small'] };
  for (const sl of shelfSlots) {
    const kind = (PLAN[`${sl.cx}:${sl.s}`] || ['box'])[sl.k] || 'small';
    merch.fillShelf(kind, sl.z0, sl.z1, sl.y, sl.cx + sl.s * 0.42, -sl.s, sl.s > 0 ? Math.PI / 2 : -Math.PI / 2, kind === 'bag' ? 3 : 3, 'z');
  }
  // 뒷벽 워크인 냉장고 (유리문 + 내부 조명)
  const FZ = D0 + 0.02, fx0 = -4.55, fx1 = 1.85, nDoor = 8, dw = (fx1 - fx0) / nDoor;
  const mFridgeIn = std({ color: 0xdfe6ec, roughness: 0.3, metalness: 0.2 });
  // 워크인 냉장고 안: 앞이 뚫린 칸 (뒤판·바닥·천장·옆판) — 안에 음료가 보이도록
  const mFridgeBack = new THREE.MeshStandardMaterial({ color: 0xf2f6fa, emissive: 0xdde8f2, emissiveIntensity: 0.55, roughness: 0.4 });
  B.box(mFridgeBack, fx1 - fx0, 2.2, 0.04, (fx0 + fx1) / 2, 1.1, FZ + 0.02);
  B.box(mFridgeIn, fx1 - fx0, 0.2, 0.7, (fx0 + fx1) / 2, 0.1, FZ + 0.35);
  B.box(mFridgeIn, fx1 - fx0, 0.04, 0.7, (fx0 + fx1) / 2, 2.18, FZ + 0.35);
  B.box(mFridgeIn, 0.04, 2.2, 0.7, fx0, 1.1, FZ + 0.35); B.box(mFridgeIn, 0.04, 2.2, 0.7, fx1, 1.1, FZ + 0.35);
  for (let i = 0; i < nDoor; i++) {
    const x = fx0 + dw * (i + 0.5);
    B.box(mDark, 0.05, 2.05, 0.06, fx0 + dw * i, 1.08, FZ + 0.72);
    B.box(mMetal, 0.025, 0.9, 0.03, fx0 + dw * (i + 1) - 0.07, 1.15, FZ + 0.77);
    for (let k = 0; k < 5; k++) {
      const y = 0.25 + k * 0.38; B.box(mMetal, dw - 0.06, 0.015, 0.6, x, y, FZ + 0.36); B.box(mShelfEdge, dw - 0.06, 0.03, 0.01, x, y + 0.005, FZ + 0.665);
      const kind = i < 2 ? ['jar', 'jar', 'bottle', 'bottle', 'can'][k] : i < 5 ? ['bottle', 'bottle', 'can', 'can', 'can'][k] : i < 7 ? ['can', 'can', 'bottle', 'can', 'bottle'][k] : ['soju', 'soju', 'soju', 'can', 'can'][k];
      merch.fillShelf(kind, x - dw / 2 + 0.05, x + dw / 2 - 0.03, y + 0.008, FZ + 0.66, -1, 0, 5, 'x');
    }
    B.box(mLed, 0.03, 1.9, 0.02, fx0 + dw * i + 0.04, 1.1, FZ + 0.68);
  }
  B.box(mDark, fx1 - fx0, 0.35, 0.75, (fx0 + fx1) / 2, 2.38, FZ + 0.38);
  const fridgeSign = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.25), new THREE.MeshBasicMaterial({ map: canvasTex('fsign', 768, 64, (g, w, h) => { g.fillStyle = '#0d1b2a'; g.fillRect(0, 0, w, h); g.fillStyle = '#7fe3ff'; g.font = `900 40px ${FONT}`; g.textAlign = 'center'; g.fillText('음료 · 주류 · 유제품', w / 2, 46); }) }));
  fridgeSign.position.set(-1.35, 2.38, FZ + 0.76); root.add(fridgeSign);
  const mFGlass = new THREE.MeshStandardMaterial({ color: 0xe8f4ff, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.07, envMapIntensity: 0.35, depthWrite: false });
  const fglass = new THREE.Mesh(new THREE.PlaneGeometry(fx1 - fx0, 2.0), mFGlass); fglass.position.set((fx0 + fx1) / 2, 1.1, FZ + 0.74); fglass.renderOrder = 2; root.add(fglass);
  const fl = new THREE.PointLight(0xdff4ff, 1.5, 4, 2); fl.position.set(-1.3, 1.4, FZ + 1.2); scene.add(fl);

  // 직원 문 (창고)
  B.box(mWood, 1.0, 2.1, 0.06, 3.6, 1.05, D0 + 0.03);
  const staff = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.14), new THREE.MeshBasicMaterial({ map: canvasTex('staff', 256, 72, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#c22'; g.font = `900 34px ${FONT}`; g.textAlign = 'center'; g.fillText('STAFF ONLY', w / 2, 48); }) }));
  staff.position.set(3.6, 1.6, D0 + 0.07); root.add(staff);

  // 계산대
  const CX = 2.6, CZ0 = -1.2, CZ1 = 2.4, CH = 0.95;
  B.box(mCounter, 0.62, 0.05, CZ1 - CZ0, CX, CH - 0.025, (CZ0 + CZ1) / 2);
  B.box(mWood, 0.04, CH - 0.05, CZ1 - CZ0, CX - 0.28, (CH - 0.05) / 2, (CZ0 + CZ1) / 2);
  B.box(mDark, 0.5, CH - 0.05, CZ1 - CZ0, CX + 0.02, (CH - 0.05) / 2, (CZ0 + CZ1) / 2);
  B.box(mBrand, 0.02, 0.16, CZ1 - CZ0, CX - 0.305, 0.75, (CZ0 + CZ1) / 2);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.38), new THREE.MeshBasicMaterial({ transparent: true, map: canvasTex('cfront', 1024, 160, (g, w, h) => { drawBrand(g, 30, 20, 110, true); g.fillStyle = 'rgba(255,255,255,.85)'; g.font = `700 42px ${FONT}`; g.fillText('밤에도 환한 우리 동네', 470, 98); }) }));
  front.position.set(CX - 0.32, 0.43, 0.6); front.rotation.y = -Math.PI / 2; root.add(front);
  // 뒤 카운터 + 담배 진열장
  B.box(mDark, 0.5, CH, 2.9, 4.35, CH / 2, 0.9);
  B.box(mCounter, 0.52, 0.04, 2.9, 4.35, CH, 0.9);
  const R = SPOT.rack, rw = (R.z1 - R.z0) / R.cols, rh = 0.28;
  B.box(mDark, 0.04, R.rows * rh + 0.12, R.z1 - R.z0 + 0.12, R.x + 0.06, R.y0 + R.rows * rh / 2 - 0.02, (R.z0 + R.z1) / 2);
  for (const zz of [R.z0 - 0.04, R.z1 + 0.04]) B.box(mDark, 0.26, R.rows * rh + 0.12, 0.03, R.x - 0.06, R.y0 + R.rows * rh / 2 - 0.02, zz);
  const rackLight = new THREE.Mesh(new THREE.PlaneGeometry(R.z1 - R.z0, 0.03), mLed); rackLight.position.set(R.x - 0.1, R.y0 + R.rows * rh + 0.02, (R.z0 + R.z1) / 2); rackLight.rotation.y = -Math.PI / 2; root.add(rackLight);
  const numTex = canvasTex('cignum', 1024, 256, (g, w, h) => {
    g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < R.rows; r++) for (let c = 0; c < R.cols; c++) {
      const cig = CIGS[r * R.cols + c], x = c * w / R.cols, y = (R.rows - 1 - r) * h / R.rows;
      g.fillStyle = '#ffd400'; g.fillRect(x + 4, y + 4, w / R.cols - 8, 26); g.fillStyle = '#000'; g.font = `900 22px ${FONT}`; g.textAlign = 'center';
      g.fillText(`${cig.id}`, x + w / R.cols / 2, y + 25); g.fillStyle = '#fff'; g.font = `600 15px ${FONT}`; g.fillText(cig.price.toLocaleString(), x + w / R.cols / 2, y + 50);
    }
  });
  const cigSlots = [];
  for (let r = 0; r < R.rows; r++) for (let c = 0; c < R.cols; c++) {
    const cig = CIGS[r * R.cols + c], z = R.z0 + rw * (c + 0.5), y = R.y0 + r * rh;
    B.box(mMetal, 0.24, 0.012, rw - 0.01, R.x - 0.06, y, z);
    const m = cigMesh(cig); m.scale.set(1.45, 1.45, 3.2); m.position.set(R.x - 0.1, y + 0.008, z); m.rotation.y = -Math.PI / 2; m.userData.cig = cig; root.add(m); cigSlots.push(m);
  }
  for (let r = 0; r < R.rows; r++) {
    const t = numTex.clone(); t.needsUpdate = true; t.repeat.set(1, 0.86 / R.rows); t.offset.set(0, (r + 0.14) / R.rows);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(R.z1 - R.z0, 0.085), new THREE.MeshBasicMaterial({ map: t }));
    lab.position.set(R.x - 0.185, R.y0 + r * rh - 0.05, (R.z0 + R.z1) / 2); lab.rotation.y = -Math.PI / 2; root.add(lab);
  }
  const C = buildCounter(root, CH);
  // 뒤 카운터: 전자레인지, 커피머신, 영수증 꽂이
  const mw = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.28, 0.5), std({ color: 0xdedfe2, metalness: 0.4, roughness: 0.3 })); mw.position.set(4.35, CH + 0.16, -0.25); root.add(mw);
  const mwDoor = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), std({ color: 0x111, roughness: 0.1 })); mwDoor.position.set(4.149, CH + 0.16, -0.28); mwDoor.rotation.y = -Math.PI / 2; root.add(mwDoor);
  const cm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.35), mDark); cm.position.set(4.35, CH + 0.3, 2.2); root.add(cm);
  // 아이스크림 냉동고, ATM, 쓰레기통, 우산꽂이
  B.box(std({ color: 0xf4f6f8, roughness: 0.3 }), 1.4, 0.8, 0.65, -1.1, 0.4, 3.3);
  B.box(mBrand2, 1.4, 0.08, 0.66, -1.1, 0.7, 3.3);
  const icGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.55), mGlass); icGlass.rotation.x = -Math.PI / 2; icGlass.position.set(-1.1, 0.81, 3.3); root.add(icGlass);
  for (let i = 0; i < 14; i++) put('icecream', -1.7 + (i % 7) * 0.18, 0.62, 3.15 + Math.floor(i / 7) * 0.25, 0.3);
  B.box(std({ color: 0x2c4a7a, metalness: 0.4, roughness: 0.4 }), 0.7, 1.6, 0.6, -4.4, 0.8, 3.45);
  const atm = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshBasicMaterial({ map: canvasTex('atm', 256, 192, (g, w, h) => { g.fillStyle = '#0b5cd6'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = `900 40px ${FONT}`; g.textAlign = 'center'; g.fillText('ATM', w / 2, 80); g.font = `600 22px ${FONT}`; g.fillText('카드를 넣어주세요', w / 2, 130); }), toneMapped: false }));
  atm.position.set(-4.4, 1.25, 3.14); atm.rotation.y = Math.PI; root.add(atm);
  B.box(mDark, 0.4, 0.7, 0.4, 0.3, 0.35, 3.6);
  // 벽 포스터
  const poster = (key, txt, sub, col, x, y, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.85), new THREE.MeshStandardMaterial({ roughness: 0.5, map: canvasTex(key, 256, 360, (g, w, h) => { g.fillStyle = col; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = `900 46px ${FONT}`; g.textAlign = 'center'; txt.split('\n').forEach((t, i) => g.fillText(t, w / 2, 120 + i * 56)); g.font = `600 22px ${FONT}`; g.fillText(sub, w / 2, 320); }) })); m.position.set(x, y, z); m.rotation.y = ry; root.add(m); };
  poster('po1', '1+1\n행사', '컵라면 · 음료 일부', '#d62828', -4.94, 2.2, 2.9, Math.PI / 2);
  poster('po2', '청소년\n주류·담배\n판매 금지', '신분증 확인 필수', '#1b263b', 4.54, 1.9, -1.0, -Math.PI / 2);
  poster('po3', '택배\n접수', '편의점 택배', '#14a38b', -4.94, 2.2, -3.2, Math.PI / 2);
  // CCTV 돔
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std({ color: 0x111, roughness: 0.1 })); dome.rotation.x = Math.PI; dome.position.set(-0.5, H - 0.01, 0); root.add(dome);
  const dome2 = dome.clone(); dome2.position.set(2.0, H - 0.01, 3.2); root.add(dome2);

  addDecor({ root, scene, B, std, canvasTex, drawBrand, FONT, renderer, shelfSlots, merch });
  merch.build(root);
  for (const [key, mats] of Object.entries(inst)) {
    const proto = productMesh(key), im = new THREE.InstancedMesh(proto.geometry, proto.material, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m)); im.matrixAutoUpdate = false; root.add(im);
  }
  B.build(root);
  const outside = buildOutside(scene);
  // 매장 안을 큐브카메라로 한 번 찍어서 반사·주변광으로 쓴다 (바닥·유리·캔에 진열대와 조명이 비침)
  try {
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cc = new THREE.CubeCamera(0.05, 40, rt); cc.position.set(-0.8, 1.5, 0.4); scene.add(cc); cc.update(renderer, scene); scene.remove(cc);
    const env = pmrem.fromCubemap(rt.texture).texture; scene.environment = env; rt.dispose();
  } catch (e) { console.warn('env capture', e); }
  return { root, mw, door, doorAngle: 0, cigSlots, C, pos: C.pos, posScreenTex: C.posScreenTex, outside };
}

function buildOutside(scene) {
  const g = new THREE.Group(); scene.add(g);
  const B = new Batch();
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, envMapIntensity: 0.15, ...o });
  const wet = canvasTex('asph', 256, 256, (c, w, h) => { c.fillStyle = '#1b1d21'; c.fillRect(0, 0, w, h); for (let i = 0; i < 6000; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); } });
  wet.repeat.set(20, 4);
  B.box(std({ map: wet, roughness: 0.35, envMapIntensity: 0.5 }), 60, 0.02, 8, 0, -0.03, 10.5);
  const side = canvasTex('side', 256, 256, (c, w, h) => { c.fillStyle = '#6e6a64'; c.fillRect(0, 0, w, h); c.strokeStyle = '#4b4843'; c.lineWidth = 4; for (let i = 0; i <= 4; i++) { c.strokeRect(0, i * 64, w, 0); c.strokeRect(i * 64 + (i % 2) * 32, 0, 0, h); } });
  side.repeat.set(30, 1.5);
  B.box(std({ map: side }), 60, 0.12, 2.6, 0, 0.0, 5.3);
  B.box(std({ color: 0x8a8a8a }), 60, 0.15, 0.2, 0, 0.02, 6.6);
  for (let x = -28; x < 28; x += 4) B.box(new THREE.MeshBasicMaterial({ color: 0xc9c9c9 }), 2, 0.005, 0.12, x, -0.015, 10.5);
  B.box(new THREE.MeshBasicMaterial({ color: 0xd8b13a }), 60, 0.005, 0.1, 0, -0.015, 8.0);
  // 길 건너 건물들 (불 켜진 창문)
  const win = canvasTex('bld', 512, 512, (c, w, h) => {
    c.fillStyle = '#16181d'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const on = Math.random() < 0.28; c.fillStyle = on ? ['#ffd99a', '#cfe6ff', '#ffefc9'][(x + y) % 3] : '#0d0f13'; c.fillRect(x * 64 + 10, y * 64 + 12, 44, 36); }
  });
  win.repeat.set(3, 1);
  const mB = new THREE.MeshBasicMaterial({ map: win, color: 0x9a9a9a });
  [[-14, 9, 8], [-4, 13, 10], [8, 7, 9], [18, 11, 8]].forEach(([x, hh, w]) => B.box(mB, w, hh, 4, x, hh / 2, 17));
  const shopSign = canvasTex('shop', 512, 128, (c, w, h) => { c.fillStyle = '#300'; c.fillRect(0, 0, w, h); c.fillStyle = '#ff4040'; c.font = `900 70px ${FONT}`; c.textAlign = 'center'; c.fillText('24시 국밥', w / 2, 92); });
  const ss = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.2), new THREE.MeshBasicMaterial({ map: shopSign, toneMapped: false })); ss.position.set(-4, 3.2, 14.9); ss.rotation.y = Math.PI; g.add(ss);
  // 가로등
  const pole = std({ color: 0x3a3d42, metalness: 0.6, roughness: 0.4 });
  for (const x of [-7, 6]) {
    B.box(pole, 0.12, 5, 0.12, x, 2.5, 6.4); B.box(pole, 0.08, 0.08, 1.4, x, 4.95, 7.0);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc77a })); lamp.position.set(x, 4.85, 7.6); g.add(lamp);
    const pl = new THREE.PointLight(0xffb060, 30, 14, 1.7); pl.position.set(x, 4.6, 7.6); g.add(pl);
  }
  // 간판 (가게 바깥)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.55), new THREE.MeshBasicMaterial({ toneMapped: false, map: canvasTex('sign', 1024, 140, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#24365a'); gr.addColorStop(1, '#152238'); c.fillStyle = gr; c.fillRect(0, 0, w, h); drawBrand(c, 250, 18, 104, true); c.fillStyle = 'rgba(255,255,255,.7)'; c.font = `700 30px ${FONT}`; c.fillText('24시 편의점', 660, 90); }) }));
  sign.position.set(-0.6, 3.15, 4.07); g.add(sign);
  B.box(std({ color: 0x23262b }), 9.8, 0.6, 0.3, -0.2, 3.1, 4.0);
  B.box(std({ color: 0x23262b }), 9.8, 0.4, 0.2, -0.2, 2.9, 3.95);
  // 가게 불빛이 인도에 비치는 것
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(10, 3), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: canvasTex('pool', 256, 128, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,250,235,.38)'); gr.addColorStop(1, 'rgba(255,250,235,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); }) }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(-0.2, 0.075, 5.5); g.add(pool);
  B.build(g);
  return { group: g };
}

