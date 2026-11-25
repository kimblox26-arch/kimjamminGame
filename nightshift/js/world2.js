// 들어갈 수 있는 곳들: 창고 아래 지하 무기고(총기 보관함), 달빛타워(로비·엘리베이터·5층 사무실·옥상), 달빛 커피(카페),
// 교도소(감방·복도·운동장·감시탑·순찰 교도관 → 환풍구로 탈옥), 길고양이·비둘기
import * as THREE from 'three';
import { RAMPS, FLOORS } from './zones.js';
import { Person } from './people.js';
import { makePistol, makeRifle } from './weapons.js';
import { tex, pbr } from './tex.js';

const FONT = '"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function ctex(w, h, draw, rep) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); } return t; }
const M = o => new THREE.MeshStandardMaterial({ roughness: 0.7, envMapIntensity: 0.4, ...o });
const B = (p, m, sx, sy, sz, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); b.position.set(x, y, z); p.add(b); return b; };
const label = (txt, w, h, bg, fg, px = 64) => ctex(w, h, (g, W, H) => { g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = fg; g.font = `900 ${px}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, W / 2, H / 2); });
const plane = (p, mat, w, h, x, y, z, ry = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.y = ry; p.add(m); return m; };
const concT0 = () => ctex(256, 256, (g, w, h) => { g.fillStyle = '#7c8086'; g.fillRect(0, 0, w, h); for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.08})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, [2, 2]);
const concT = () => tex('concrete_col.jpg', [3, 2]);
const concM = (o = {}) => M({ ...pbr('concrete', [3, 2]), ...o });
// 벽 (방 둘레) + 충돌: rect, 높이, 바닥 y, 문 틈 [{side:'n|s|w|e', a, b}], opt = 충돌 옵션(lv 또는 y0/y1)
function room(p, collide, r, H, y, mat, gaps = [], opt = {}) {
  const T = 0.15, seg = (side, a, b) => {
    if (b - a < 0.05) return;
    if (side === 'n' || side === 's') { const z = side === 'n' ? r.z0 : r.z1; B(p, mat, b - a, H, T, (a + b) / 2, y + H / 2, z); collide({ x0: a, x1: b, z0: z - T, z1: z + T, ...opt }); }
    else { const x = side === 'w' ? r.x0 : r.x1; B(p, mat, T, H, b - a, x, y + H / 2, (a + b) / 2); collide({ x0: x - T, x1: x + T, z0: a, z1: b, ...opt }); }
  };
  for (const side of ['n', 's', 'w', 'e']) {
    const [lo, hi] = side === 'n' || side === 's' ? [r.x0, r.x1] : [r.z0, r.z1];
    const gs = gaps.filter(g => g.side === side).sort((a, b) => a.a - b.a); let c = lo;
    for (const g of gs) { seg(side, c, g.a); c = g.b; } seg(side, c, hi);
  }
}

// ── 지하 무기고 (창고 바닥 계단으로 내려감) ──
export const ARMORY = { stair: { x0: 2.2, x1: 3.0, z0: -8.0, z1: -4.7 }, room: { x0: 0.4, x1: 6.2, z0: -14, z1: -7.6 }, y: -2.6 };
export function buildArmory(scene, collide) {
  const g = new THREE.Group(); scene.add(g);
  const { stair: S, room: R, y: Y } = ARMORY, CY = -0.3;
  RAMPS.push({ x0: S.x0, x1: S.x1, z0: S.z0 - 0.4, z1: S.z1, axis: 'z', from: S.z1, to: S.z0, y0: 0, y1: Y });
  FLOORS.push({ x0: R.x0, x1: R.x1, z0: R.z0, z1: R.z1, y: Y });
  const conc = concM(), steel = M({ color: 0x3a3f45, metalness: 0.75, roughness: 0.38 }), yel = M({ color: 0xe0b020, roughness: 0.5 });
  // 계단 (17칸) + 옆벽 + 창고 쪽 난간
  const N = 17, run = (S.z1 - S.z0) / N, rise = -Y / N;
  for (let i = 0; i < N; i++) { const z = S.z1 - (i + 0.5) * run, top = -(i + 1) * rise; B(g, M({ color: 0x6b6f75, roughness: 0.8 }), S.x1 - S.x0, 0.3, run, (S.x0 + S.x1) / 2, top - 0.15, z); B(g, yel, S.x1 - S.x0 - 0.06, 0.012, 0.04, (S.x0 + S.x1) / 2, top + 0.006, z + run / 2 - 0.03); }
  for (const x of [S.x0 - 0.06, S.x1 + 0.06]) { B(g, conc, 0.1, -Y + 0.02, S.z1 - S.z0 + 0.4, x, Y / 2, (S.z0 + S.z1) / 2 - 0.2); collide({ x0: x - 0.08, x1: x + 0.08, z0: S.z0 - 0.4, z1: S.z1, lv: 'all' }); B(g, steel, 0.04, 0.04, S.z1 - S.z0, x, 0.95, (S.z0 + S.z1) / 2); for (let z = S.z0 + 0.2; z < S.z1; z += 0.8) B(g, steel, 0.03, 0.95, 0.03, x, 0.475, z); }
  // 방: 바닥(에폭시)·벽·천장 LED
  B(g, M({ color: 0x5a6068, roughness: 0.25, envMapIntensity: 0.9 }), R.x1 - R.x0, 0.05, R.z1 - R.z0, (R.x0 + R.x1) / 2, Y - 0.025, (R.z0 + R.z1) / 2);
  B(g, M({ color: 0x55595e, roughness: 0.9 }), R.x1 - R.x0, 0.05, R.z1 - R.z0, (R.x0 + R.x1) / 2, CY, (R.z0 + R.z1) / 2);
  room(g, collide, R, CY - Y, Y, conc, [{ side: 's', a: S.x0 - 0.1, b: S.x1 + 0.1 }], { lv: -1 });
  for (let x = R.x0 + 1; x < R.x1; x += 1.6) B(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf4f8ff).multiplyScalar(1.5) }), 1.0, 0.03, 0.08, x, CY - 0.04, (R.z0 + R.z1) / 2);
  const L = new THREE.PointLight(0xe8f0ff, 9, 10, 1.4); L.position.set((R.x0 + R.x1) / 2, CY - 0.3, (R.z0 + R.z1) / 2); g.add(L);
  const warn = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.3), new THREE.MeshBasicMaterial({ map: label('관계자 외 출입금지', 512, 160, '#c1121f', '#fff', 56), toneMapped: false })); warn.position.set((S.x0 + S.x1) / 2, Y + 2.0, R.z1 - 0.09); warn.rotation.y = Math.PI; g.add(warn);
  // 총기 보관함 2개 (남쪽 벽): 철제 몸통·유리문·LED 조명·소총 거치대 / 권총 타공판·탄약 상자
  const hits = [], cabs = [];
  const cab = (cx, kind) => {
    const c = new THREE.Group(); c.position.set(cx, Y, R.z0 + 0.42); g.add(c); cabs.push(c);
    const body = M({ color: 0x23272c, metalness: 0.8, roughness: 0.32, envMapIntensity: 1.2 }), inner = M({ color: 0x15171a, roughness: 0.9, bumpMap: ctex(64, 64, (q) => { q.fillStyle = '#777'; q.fillRect(0, 0, 64, 64); q.fillStyle = '#222'; for (let yy = 4; yy < 64; yy += 10) for (let xx = 4; xx < 64; xx += 10) { q.beginPath(); q.arc(xx, yy, 2, 0, 7); q.fill(); } }, [6, 10]), bumpScale: 2 });
    B(c, body, 1.3, 2.2, 0.06, 0, 1.1, -0.3); B(c, body, 0.06, 2.2, 0.66, -0.65, 1.1, 0); B(c, body, 0.06, 2.2, 0.66, 0.65, 1.1, 0); B(c, body, 1.3, 0.08, 0.66, 0, 2.2, 0); B(c, body, 1.3, 0.12, 0.66, 0, 0.06, 0);
    B(c, inner, 1.22, 2.0, 0.01, 0, 1.12, -0.265);
    B(c, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdfeeff).multiplyScalar(2) }), 1.16, 0.02, 0.04, 0, 2.13, 0.1);   // LED 바
    const glass = M({ color: 0xcfe3f0, transparent: true, opacity: 0.16, roughness: 0.02, metalness: 0.1, envMapIntensity: 1.8, depthWrite: false });
    for (const s of [-1, 1]) { B(c, glass, 0.6, 2.02, 0.012, s * 0.31, 1.12, 0.33); B(c, body, 0.035, 2.06, 0.035, s * 0.62, 1.12, 0.33); B(c, M({ color: 0xc9ced4, metalness: 0.95, roughness: 0.2 }), 0.025, 0.3, 0.03, s * 0.04, 1.15, 0.36); }
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.1), new THREE.MeshBasicMaterial({ map: label(kind === 'rifle' ? 'RIFLE · 소총' : 'PISTOL · 권총', 512, 100, '#111', '#e9c46a', 52), toneMapped: false })); pl.position.set(0, 2.32, 0.34); c.add(pl);
    if (kind === 'rifle') { for (let i = 0; i < 4; i++) { const r = makeRifle(); r.rotation.set(Math.PI / 2, 0, 0); r.position.set(-0.45 + i * 0.3, 1.3, -0.12); c.add(r); } B(c, steel, 1.2, 0.05, 0.25, 0, 0.32, -0.1); }
    else { for (let i = 0; i < 6; i++) { const p = makePistol(); p.rotation.set(0, Math.PI / 2, 0); p.position.set(-0.36 + (i % 3) * 0.36, 1.55 - Math.floor(i / 3) * 0.42, -0.2); c.add(p); }
      const am = M({ color: 0x3d4a2a, roughness: 0.7 }); for (let i = 0; i < 6; i++) B(c, am, 0.28, 0.16, 0.22, -0.42 + (i % 3) * 0.42, 0.22 + Math.floor(i / 3) * 0.17, -0.05); }
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.2, 0.7), new THREE.MeshBasicMaterial()); hit.visible = false; hit.position.y = 1.1; hit.userData.aim = 'guns'; c.add(hit); hits.push(hit);
    collide({ x0: cx - 0.7, x1: cx + 0.7, z0: R.z0, z1: R.z0 + 0.8, lv: -1 });
  };
  cab(1.8, 'rifle'); cab(3.35, 'pistol');
  // 탄약 상자 더미 (탄약 보충) · 작업대 · 방탄조끼 · 표적지
  const ammoT = ctex(256, 128, (q, w, h) => { q.fillStyle = '#4a5a32'; q.fillRect(0, 0, w, h); q.fillStyle = '#e8e0c0'; q.font = `900 30px ${FONT}`; q.fillText('5.56mm × 840', 18, 56); q.font = '700 20px monospace'; q.fillText('LOT 26-0412  탄약', 18, 96); });
  const ammoM = M({ map: ammoT, roughness: 0.75 });
  for (let i = 0; i < 5; i++) { const b = B(g, ammoM, 0.6, 0.3, 0.32, 5.4 + (i % 2) * 0.05, Y + 0.15 + i * 0.31, R.z0 + 0.5 + (i % 2) * 0.05); b.rotation.y = (Math.random() - 0.5) * 0.1; }
  const ammoHit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.6, 0.5), new THREE.MeshBasicMaterial()); ammoHit.visible = false; ammoHit.position.set(5.4, Y + 0.8, R.z0 + 0.5); ammoHit.userData.aim = 'ammo'; g.add(ammoHit); hits.push(ammoHit);
  collide({ x0: 5.0, x1: 5.8, z0: R.z0, z1: R.z0 + 0.9, lv: -1 });
  const wood = M({ color: 0x8a6a4b, roughness: 0.6 });
  B(g, wood, 0.7, 0.06, 2.4, R.x0 + 0.45, Y + 0.92, -10.8); for (const z of [-11.9, -9.7]) B(g, steel, 0.6, 0.9, 0.05, R.x0 + 0.45, Y + 0.45, z);
  B(g, steel, 0.15, 0.12, 0.2, R.x0 + 0.5, Y + 1.01, -11.2); B(g, M({ color: 0x8b5a2b }), 0.05, 0.9, 1.6, R.x0 + 0.08, Y + 1.7, -10.8);
  for (let i = 0; i < 6; i++) B(g, M({ color: [0xc1121f, 0x2a6f97, 0x444][i % 3], metalness: 0.5 }), 0.03, 0.03 + (i % 3) * 0.04, 0.18, R.x0 + 0.12, Y + 1.5 + Math.floor(i / 3) * 0.4, -11.4 + (i % 3) * 0.5);
  collide({ x0: R.x0, x1: R.x0 + 0.85, z0: -12.1, z1: -9.5, lv: -1 });
  for (let i = 0; i < 3; i++) { const v = B(g, M({ color: 0x2b2f26, roughness: 0.9 }), 0.42, 0.55, 0.12, R.x1 - 0.12, Y + 1.5, -12.6 + i * 0.6); v.rotation.y = -Math.PI / 2; }
  const tgt = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.9), new THREE.MeshStandardMaterial({ map: ctex(256, 384, (q, w, h) => { q.fillStyle = '#f2efe6'; q.fillRect(0, 0, w, h); q.fillStyle = '#111'; q.beginPath(); q.ellipse(w / 2, 110, 48, 60, 0, 0, 7); q.fill(); q.fillRect(w / 2 - 80, 170, 160, 210); q.strokeStyle = '#fff'; q.lineWidth = 3; for (let r = 20; r < 120; r += 25) { q.beginPath(); q.arc(w / 2, 250, r, 0, 7); q.stroke(); } }), roughness: 0.9 }));
  tgt.position.set(R.x1 - 0.09, Y + 1.4, -9.2); tgt.rotation.y = -Math.PI / 2; g.add(tgt);
  return { group: g, hits };
}

// ── 달빛타워 (로비·엘리베이터·5층·옥상) ──
export const TOWER = { x0: 20.5, x1: 42.6, z0: -14, z1: 3.9, h: 26, lobby: { x0: 20.8, x1: 42.3, z0: -6, z1: 3.75 }, door: [22.6, 24.8], f5: 12, roof: 26.4, ev: { x0: 37, x1: 39.2, z0: -5.9, z1: -4.1 } };
export function buildTower(scene, collide) {
  const g = new THREE.Group(); scene.add(g); const T = TOWER, Lb = T.lobby, E = T.ev;
  const marble0 = M({ map: ctex(256, 256, (q, w, h) => { q.fillStyle = '#e8e4dc'; q.fillRect(0, 0, w, h); for (let i = 0; i < 40; i++) { q.strokeStyle = `rgba(120,110,100,${Math.random() * 0.25})`; q.lineWidth = Math.random() * 2; q.beginPath(); q.moveTo(Math.random() * w, 0); q.bezierCurveTo(Math.random() * w, h / 3, Math.random() * w, h * 2 / 3, Math.random() * w, h); q.stroke(); } }, [4, 2]), roughness: 0.18, envMapIntensity: 1 });
  void marble0; const marble = M({ map: tex('marble_col.jpg', [5, 4]), roughness: 0.12, envMapIntensity: 1.3 });
  const wallM = M({ color: 0xd9d6cf, roughness: 0.6 }), dark = M({ color: 0x2b2f36, metalness: 0.5, roughness: 0.4 }), glass = M({ color: 0xbcd4e6, transparent: true, opacity: 0.22, roughness: 0.03, envMapIntensity: 1.5, depthWrite: false, side: THREE.DoubleSide });
  // 뒤쪽(로비 뒤) 막힌 부분 충돌
  collide({ x0: T.x0 - 0.1, x1: T.x1 + 0.1, z0: T.z0 - 0.1, z1: Lb.z0 });
  // 로비: 대리석 바닥·벽·천장·정문(유리)·안내데스크·소파·화분·간판
  B(g, marble, Lb.x1 - Lb.x0, 0.03, Lb.z1 - Lb.z0, (Lb.x0 + Lb.x1) / 2, 0.015, (Lb.z0 + Lb.z1) / 2);
  B(g, M({ color: 0xf2f2f0, roughness: 0.8 }), Lb.x1 - Lb.x0, 0.05, Lb.z1 - Lb.z0, (Lb.x0 + Lb.x1) / 2, 4.2, (Lb.z0 + Lb.z1) / 2);
  room(g, collide, Lb, 4.2, 0, wallM, [{ side: 's', a: T.door[0], b: T.door[1] }]);
  for (const yy of [{}, { y0: 12, y1: 15 }, { y0: 26.4, y1: 29.4 }]) { collide({ x0: E.x0 - 0.12, x1: E.x0, z0: E.z0, z1: E.z1 - 0.6, ...yy }); collide({ x0: E.x1, x1: E.x1 + 0.12, z0: E.z0, z1: E.z1 - 0.6, ...yy }); }
  plane(g, glass, T.door[1] - T.door[0], 2.6, (T.door[0] + T.door[1]) / 2, 1.3, T.z1 + 0.06);
  for (let x = Lb.x0 + 2; x < Lb.x1; x += 3) B(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff6e8).multiplyScalar(1.4) }), 1.2, 0.03, 1.2, x, 4.17, -1);
  const sign = plane(g, new THREE.MeshBasicMaterial({ map: label('DALBIT TOWER  달빛타워', 1024, 160, '#1b2433', '#e9c46a', 84), toneMapped: false }), 6, 0.9, 31.5, 4.6, T.z1 + 0.05);
  void sign;
  const desk = B(g, M({ color: 0x3e2c22, roughness: 0.4 }), 3.2, 1.05, 0.8, 30, 0.525, -2.5); void desk; collide({ x0: 28.4, x1: 31.6, z0: -2.9, z1: -2.1 });
  collide({ x0: 23.9, x1: 26.1, z0: -5.1, z1: -4.2 });
  for (const x of [21.5, 41.6]) { B(g, M({ color: 0x6b4a2e }), 0.5, 0.5, 0.5, x, 0.25, 3.1); for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 1), M({ color: 0x2f6b2f })); l.position.set(x, 0.9 + i * 0.25, 3.1); g.add(l); } }
  const LL = new THREE.PointLight(0xfff3e0, 10, 16, 1.3); LL.position.set(31, 3.8, -1); g.add(LL);
  // 엘리베이터 (로비 뒤): 통로 벽·문·버튼, 칸은 층마다 따라다님
  const evCar = new THREE.Group(); evCar.position.set((E.x0 + E.x1) / 2, 0, (E.z0 + E.z1) / 2 - 0.4); g.add(evCar);
  const st = M({ color: 0xb8bec6, metalness: 0.85, roughness: 0.25, envMapIntensity: 1.2 });
  B(evCar, st, 2.2, 0.04, 1.8, 0, 0.02, 0); B(evCar, st, 2.2, 0.04, 1.8, 0, 2.5, 0); B(evCar, st, 0.04, 2.5, 1.8, -1.1, 1.25, 0); B(evCar, st, 0.04, 2.5, 1.8, 1.1, 1.25, 0); B(evCar, M({ color: 0xc8ccd0, metalness: 0.6, roughness: 0.15, envMapIntensity: 1.5 }), 2.2, 2.5, 0.04, 0, 1.25, -0.9);
  B(evCar, new THREE.MeshBasicMaterial({ color: 0xfff6e0 }), 1.6, 0.02, 1.2, 0, 2.47, 0);
  const evL = new THREE.PointLight(0xfff6e0, 3, 4, 1.5); evL.position.set(0, 2.2, 0); evCar.add(evL);
  const panel = plane(evCar, new THREE.MeshBasicMaterial({ map: ctex(128, 256, (q, w, h) => { q.fillStyle = '#222'; q.fillRect(0, 0, w, h); [['R', 30], ['5', 90], ['1', 150]].forEach(([t, y]) => { q.fillStyle = '#ddd'; q.beginPath(); q.arc(64, y + 20, 22, 0, 7); q.fill(); q.fillStyle = '#111'; q.font = '900 28px sans-serif'; q.textAlign = 'center'; q.fillText(t, 64, y + 30); }); }), toneMapped: false }), 0.18, 0.36, 1.06, 1.3, 0.5, -Math.PI / 2);
  void panel;
  const doors = [], dm = M({ color: 0xaab0b8, metalness: 0.9, roughness: 0.2, envMapIntensity: 1.4 });
  for (const s of [-1, 1]) { const d = B(evCar, dm, 1.0, 2.3, 0.04, s * 0.5, 1.15, 0.92); doors.push([d, s]); }
  const setDoors = k => { for (const [d, s] of doors) d.position.x = s * (0.5 + k * 0.95); };
  // 5층 사무실: 바닥·천장·창 띠(밖이 보임)·책상·모니터·의자·화분·사장실
  const F5 = T.f5, f5 = { x0: Lb.x0, x1: Lb.x1, z0: -6, z1: 3.75 };
  FLOORS.push({ x0: f5.x0, x1: f5.x1, z0: f5.z0, z1: f5.z1, y: F5 });
  B(g, M({ color: 0x6e7176, roughness: 0.85 }), f5.x1 - f5.x0, 0.1, f5.z1 - f5.z0, (f5.x0 + f5.x1) / 2, F5 - 0.05, (f5.z0 + f5.z1) / 2);
  B(g, M({ color: 0xf0f0ee, roughness: 0.85 }), f5.x1 - f5.x0, 0.05, f5.z1 - f5.z0, (f5.x0 + f5.x1) / 2, F5 + 3, (f5.z0 + f5.z1) / 2);
  const y5 = { y0: F5, y1: F5 + 3 };
  for (const [x0, x1, z0, z1] of [[f5.x0, f5.x1, f5.z1 - 0.1, f5.z1], [f5.x0, f5.x0 + 0.1, f5.z0, f5.z1], [f5.x1 - 0.1, f5.x1, f5.z0, f5.z1]]) {
    B(g, wallM, x1 - x0 || 0.1, 0.9, z1 - z0 || 0.1, (x0 + x1) / 2, F5 + 0.45, (z0 + z1) / 2); B(g, wallM, x1 - x0 || 0.1, 0.4, z1 - z0 || 0.1, (x0 + x1) / 2, F5 + 2.8, (z0 + z1) / 2); collide({ x0, x1, z0, z1, ...y5 });
  }
  plane(g, glass, f5.x1 - f5.x0, 1.7, (f5.x0 + f5.x1) / 2, F5 + 1.75, f5.z1 - 0.12);
  B(g, wallM, f5.x1 - f5.x0, 3, 0.1, (f5.x0 + f5.x1) / 2, F5 + 1.5, f5.z0); collide({ x0: f5.x0, x1: f5.x1, z0: f5.z0 - 0.15, z1: f5.z0, ...y5 });
  const deskM = M({ color: 0xd8cbb5, roughness: 0.5 }), monM = new THREE.MeshBasicMaterial({ map: ctex(128, 80, (q, w, h) => { q.fillStyle = '#0f2340'; q.fillRect(0, 0, w, h); q.fillStyle = '#5bc0be'; for (let i = 0; i < 8; i++) q.fillRect(8, 8 + i * 8, 40 + Math.random() * 70, 4); }), toneMapped: false });
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) { const x = 24 + c * 3.2, z = -2.5 + r * 3; B(g, deskM, 1.5, 0.05, 0.75, x, F5 + 0.74, z); B(g, dark, 0.05, 0.72, 0.7, x - 0.7, F5 + 0.36, z); B(g, dark, 0.05, 0.72, 0.7, x + 0.7, F5 + 0.36, z); const mn = B(g, dark, 0.55, 0.34, 0.03, x, F5 + 1.0, z - 0.25); plane(g, monM, 0.5, 0.3, x, F5 + 1.0, z - 0.234); void mn; B(g, M({ color: 0x222 }), 0.5, 0.5, 0.5, x, F5 + 0.3, z + 0.65); collide({ x0: x - 0.8, x1: x + 0.8, z0: z - 0.4, z1: z + 0.4, ...y5 }); }
  const boss = B(g, M({ color: 0x4a2f22, roughness: 0.35 }), 2.0, 0.78, 0.9, 37.5, F5 + 0.39, 1.6); void boss; collide({ x0: 36.5, x1: 38.5, z0: 1.15, z1: 2.05, ...y5 });
  plane(g, new THREE.MeshBasicMaterial({ map: label('대표이사실', 256, 64, '#2b2f36', '#e9c46a', 40), toneMapped: false }), 0.8, 0.2, 37.5, F5 + 1.3, 2.06);
  const L5 = new THREE.PointLight(0xf4f8ff, 9, 18, 1.3); L5.position.set(31, F5 + 2.6, -1); g.add(L5);
  for (let x = f5.x0 + 2; x < f5.x1; x += 3) B(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf4f8ff).multiplyScalar(1.3) }), 1.2, 0.02, 0.3, x, F5 + 2.97, -1);
  // 옥상: 난간·기계실·물탱크·실외기·안테나
  const RF = T.roof, yr = { y0: RF, y1: RF + 3 };
  FLOORS.push({ x0: T.x0, x1: T.x1, z0: T.z0, z1: T.z1, y: RF });
  for (const [x0, x1, z0, z1] of [[T.x0, T.x1, T.z0, T.z0 + 0.2], [T.x0, T.x1, T.z1 - 0.2, T.z1], [T.x0, T.x0 + 0.2, T.z0, T.z1], [T.x1 - 0.2, T.x1, T.z0, T.z1]]) { B(g, M({ color: 0x8a8d92 }), x1 - x0, 1.1, z1 - z0, (x0 + x1) / 2, RF + 0.55, (z0 + z1) / 2); collide({ x0, x1, z0, z1, ...yr }); }
  B(g, M({ color: 0x9a9ea4, roughness: 0.8 }), 3.4, 2.8, 3, (E.x0 + E.x1) / 2, RF + 1.4, (E.z0 + E.z1) / 2 - 1.6); collide({ x0: E.x0 - 0.6, x1: E.x1 + 0.6, z0: E.z0 - 3.1, z1: E.z1 - 1.8, ...yr });
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 20), M({ color: 0x3a6ea5, roughness: 0.5 })); tank.position.set(24, RF + 1.1, -10); g.add(tank); collide({ x0: 22.8, x1: 25.2, z0: -11.2, z1: -8.8, ...yr });
  for (let i = 0; i < 4; i++) { B(g, M({ color: 0xd0d2d4, roughness: 0.6 }), 1.1, 0.9, 0.7, 28 + i * 1.5, RF + 0.45, -12); collide({ x0: 27.4 + i * 1.5, x1: 28.6 + i * 1.5, z0: -12.4, z1: -11.6, ...yr }); }
  B(g, dark, 0.12, 6, 0.12, 40, RF + 3, -12); const red = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false })); red.position.set(40, RF + 6.1, -12); g.add(red);
  const stops = [0, F5, RF];
  return { group: g, evCar, setDoors, stops, red, inCar: p => p.x > E.x0 && p.x < E.x1 && p.z > E.z0 - 1.2 && p.z < E.z1 + 0.2 };
}

// ── 달빛 커피 (편의점 옆 건물 1층 카페) ──
export const CAFE = { x0: 5.3, x1: 19.7, z0: -6, z1: 3.75, door: [11.8, 13.6] };
export function buildCafe(scene, collide, audio) {
  const g = new THREE.Group(); scene.add(g); const C = CAFE;
  collide({ x0: 4.9, x1: 20.1, z0: -14.1, z1: C.z0 });
  const floor = M({ map: tex('wood_col.jpg', [5, 4]), bumpMap: tex('wood_bump.jpg', [5, 4], false), bumpScale: 1.5, roughnessMap: tex('wood_rgh.jpg', [5, 4], false), roughness: 1, envMapIntensity: 0.8 });
  B(g, floor, C.x1 - C.x0, 0.03, C.z1 - C.z0, (C.x0 + C.x1) / 2, 0.015, (C.z0 + C.z1) / 2);
  B(g, M({ color: 0x3b3029, roughness: 0.9 }), C.x1 - C.x0, 0.05, C.z1 - C.z0, (C.x0 + C.x1) / 2, 3.4, (C.z0 + C.z1) / 2);
  const brick = M({ map: tex('brick_col.jpg', [6, 2]), bumpMap: tex('brick_bump.jpg', [6, 2], false), bumpScale: 3, roughnessMap: tex('brick_rgh.jpg', [6, 2], false), roughness: 1 });
  room(g, collide, C, 3.4, 0, brick, [{ side: 's', a: C.door[0], b: C.door[1] }]);
  const glass = M({ color: 0xffe2b8, transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
  plane(g, glass, C.door[1] - C.door[0], 2.4, (C.door[0] + C.door[1]) / 2, 1.2, 3.97);
  plane(g, new THREE.MeshBasicMaterial({ map: ctex(512, 256, (q, w, h) => { const gr = q.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ffe3b0'); gr.addColorStop(1, '#a06a3a'); q.fillStyle = gr; q.fillRect(0, 0, w, h); q.fillStyle = 'rgba(60,30,10,.6)'; for (let i = 0; i < 6; i++) q.fillRect(30 + i * 80, 150, 40, 70); }), toneMapped: false }), 5, 2.4, 8.5, 1.3, 3.96);
  plane(g, new THREE.MeshBasicMaterial({ map: ctex(512, 256, (q, w, h) => { const gr = q.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ffe3b0'); gr.addColorStop(1, '#a06a3a'); q.fillStyle = gr; q.fillRect(0, 0, w, h); }), toneMapped: false }), 5, 2.4, 16.8, 1.3, 3.96);
  plane(g, new THREE.MeshBasicMaterial({ map: label('☕ 달빛 커피  DALBIT COFFEE', 1024, 160, '#2b1d14', '#f4e1c1', 72), toneMapped: false }), 9, 1.1, 12.5, 3.35, 3.97);
  // 카운터·에스프레소 머신·메뉴판·테이블·의자·조명
  const wood = M({ color: 0x6b4a2e, roughness: 0.5 });
  B(g, wood, 5, 1.05, 0.7, 12.5, 0.525, -3.6); B(g, M({ color: 0x2a2a2a, roughness: 0.3 }), 5.1, 0.05, 0.8, 12.5, 1.07, -3.6); collide({ x0: 10, x1: 15, z0: -3.95, z1: -3.25 });
  const esp = B(g, M({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.2 }), 0.8, 0.5, 0.5, 11.2, 1.35, -3.75); void esp;
  plane(g, new THREE.MeshBasicMaterial({ map: ctex(512, 256, (q, w, h) => { q.fillStyle = '#1d1d1b'; q.fillRect(0, 0, w, h); q.fillStyle = '#f4e1c1'; q.font = `800 30px ${FONT}`; [['아메리카노', '4,500'], ['카페라떼', '5,000'], ['바닐라라떼', '5,500'], ['자몽에이드', '5,800'], ['조각케이크', '6,500']].forEach(([a, b], i) => { q.fillText(a, 30, 50 + i * 44); q.fillText(b, 360, 50 + i * 44); }); }), toneMapped: false }), 3, 1.5, 12.5, 2.4, C.z0 + 0.09);
  for (const [x, z] of [[7, 0], [9.5, 1.8], [16, 0.2], [18, 2], [7.5, 2.6], [17.5, -1.8]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 20), wood); t.position.set(x, 0.74, z); g.add(t); B(g, M({ color: 0x222 }), 0.06, 0.72, 0.06, x, 0.36, z);
    for (const s of [-1, 1]) { B(g, wood, 0.42, 0.05, 0.42, x + s * 0.62, 0.45, z); B(g, wood, 0.05, 0.45, 0.42, x + s * 0.83, 0.68, z); }
    collide({ x0: x - 1, x1: x + 1, z0: z - 0.45, z1: z + 0.45 });
    const lamp = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.2, 16, 1, true), M({ color: 0x1a1a1a, side: THREE.DoubleSide })); lamp.position.set(x, 2.5, z); g.add(lamp);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd59a, toneMapped: false })); bulb.position.set(x, 2.42, z); g.add(bulb); B(g, M({ color: 0x111 }), 0.01, 0.9, 0.01, x, 3.0, z);
  }
  const CL = new THREE.PointLight(0xffd8a0, 9, 14, 1.4); CL.position.set(12.5, 3, -0.5); g.add(CL);
  const order = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 0.9), new THREE.MeshBasicMaterial()); order.visible = false; order.position.set(12.5, 0.9, -3.4); order.userData.aim = 'cafe'; g.add(order);
  return { group: g, hits: [order], barista: V3(12.5, 0, -4.4) };
}

// ── 교도소: 감방 4칸 + 복도 + 운동장(철조망 울타리·감시탑·탐조등) + 순찰 교도관. 탈옥: 환풍구 → 운동장 → 개구멍 ──
export function buildPrison(scene, collide, base) {
  const g = new THREE.Group(); g.position.copy(base); scene.add(g);
  const conc = concM({ color: 0xb0b4b8 }), bar = M({ color: 0x2a2d31, metalness: 0.8, roughness: 0.35 }), floorM = M({ ...pbr('concrete', [8, 4]), color: 0x8a8e94 });
  const W = (x0, x1, z0, z1) => collide({ x0: base.x + x0, x1: base.x + x1, z0: base.z + z0, z1: base.z + z1 });
  // 감방 동: x -8..8, z -4..4 (감방 z -4..-0.5, 복도 z -0.5..4)
  B(g, floorM, 16, 0.04, 8, 0, 0.02, 0); B(g, M({ color: 0x55595e }), 16, 0.05, 8, 0, 3.2, 0);
  for (const [sx, sy, sz, x, z, c] of [[16, 3.2, 0.2, 0, -4.1, [-8, 8, -4.2, -4]], [16, 3.2, 0.2, 0, 4.1, [-8, 8, 4, 4.2]], [0.2, 3.2, 8, -8.1, 0, [-8.2, -8, -4, 4]], [0.2, 3.2, 8, 8.1, 0, [8, 8.2, -4, 4]]]) { B(g, conc, sx, sy, sz, x, 1.6, z); W(...c); }
  const cells = [];
  for (let i = 0; i < 4; i++) {
    const cx = -6 + i * 4; B(g, conc, 0.2, 3.2, 3.5, cx - 2, 1.6, -2.25); W(cx - 2.1, cx - 1.9, -4, -0.5);
    for (let k = 0; k < 15; k++) { const x = cx - 1.85 + k * 0.26; B(g, bar, 0.04, 3.2, 0.04, x, 1.6, -0.5); } W(cx - 2, cx + 2, -0.6, -0.4);
    B(g, M({ color: 0x8a8f96, roughness: 0.6 }), 0.9, 0.45, 2, cx - 1.3, 0.22, -2.9); B(g, M({ color: 0xdcdcd2 }), 0.85, 0.1, 1.9, cx - 1.3, 0.5, -2.9); W(cx - 1.8, cx - 0.8, -4, -1.9);
    B(g, M({ color: 0xe8e8e8, roughness: 0.3 }), 0.45, 0.4, 0.5, cx + 1.4, 0.2, -3.5);
    cells.push(cx);
  }
  B(g, conc, 0.2, 3.2, 3.5, 10 - 2, 1.6, -2.25);
  const vent = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), M({ map: ctex(128, 96, (q, w, h) => { q.fillStyle = '#8a8f96'; q.fillRect(0, 0, w, h); q.fillStyle = '#222'; for (let y = 10; y < h - 6; y += 12) q.fillRect(8, y, w - 16, 5); }), metalness: 0.6, roughness: 0.5 }));
  vent.position.set(cells[1] - 0.2, 0.5, -3.99); g.add(vent);
  const ventHit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.4), new THREE.MeshBasicMaterial()); ventHit.visible = false; ventHit.position.set(cells[1] - 0.2, 0.5, -3.85); ventHit.userData.aim = 'vent'; g.add(ventHit);
  for (let x = -6; x <= 6; x += 4) { B(g, new THREE.MeshBasicMaterial({ color: 0xdfe8ff }), 1.2, 0.03, 0.12, x, 3.15, 1.8); }
  const L1 = new THREE.PointLight(0xcfd8ff, 7, 14, 1.4); L1.position.set(0, 2.9, 1.5); g.add(L1);
  // 운동장: 감방 동 북쪽 바깥(z -30..-6), 철조망 울타리·감시탑·탐조등, 개구멍(울타리 북서쪽)
  const yard = { x0: -16, x1: 16, z0: -32, z1: -6 };
  B(g, M({ color: 0x4a4038, roughness: 1 }), 32, 0.04, 26, 0, 0.02, -19);
  const fenceT = ctex(128, 128, (q, w, h) => { q.clearRect(0, 0, w, h); q.strokeStyle = 'rgba(190,195,200,.9)'; q.lineWidth = 2; for (let i = -h; i < w; i += 16) { q.beginPath(); q.moveTo(i, 0); q.lineTo(i + h, h); q.stroke(); q.beginPath(); q.moveTo(i + h, 0); q.lineTo(i, h); q.stroke(); } }, [6, 1]);
  const fenceM = new THREE.MeshStandardMaterial({ map: fenceT, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 });
  const gap = { x0: -14.5, x1: -13.3 };
  for (const [x0, x1, z0, z1] of [[yard.x0, yard.x1, yard.z0, yard.z0], [yard.x0, yard.x0, yard.z0, yard.z1], [yard.x1, yard.x1, yard.z0, yard.z1]]) {
    const len = Math.max(x1 - x0, z1 - z0), horiz = z0 === z1;
    const f = new THREE.Mesh(new THREE.PlaneGeometry(len, 3.6), fenceM); f.position.set((x0 + x1) / 2, 1.8, (z0 + z1) / 2); if (!horiz) f.rotation.y = Math.PI / 2; g.add(f);
    for (let k = 0; k <= len; k += 3) B(g, bar, 0.08, 3.9, 0.08, horiz ? x0 + k : x0, 1.95, horiz ? z0 : z0 + k);
    const wire = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.02, 4, 12), bar); void wire;
    if (horiz) { W(x0, gap.x0, z0 - 0.15, z0 + 0.15); W(gap.x1, x1, z0 - 0.15, z0 + 0.15); } else W(x0 - 0.15, x0 + 0.15, z0, z1);
  }
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.0), new THREE.MeshBasicMaterial({ color: 0x0b0b0b })); hole.position.set((gap.x0 + gap.x1) / 2, 0.5, yard.z0 + 0.01); g.add(hole);
  B(g, bar, gap.x1 - gap.x0, 2.6, 0.05, (gap.x0 + gap.x1) / 2, 2.3, yard.z0);
  const holeHit = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1), new THREE.MeshBasicMaterial()); holeHit.visible = false; holeHit.position.set((gap.x0 + gap.x1) / 2, 0.7, yard.z0 + 0.3); holeHit.userData.aim = 'fence'; g.add(holeHit);
  // 감시탑 + 회전 탐조등
  const tw = new THREE.Group(); tw.position.set(13, 0, -29); g.add(tw);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B(tw, bar, 0.15, 7, 0.15, x, 3.5, z);
  B(tw, conc, 2.6, 1.2, 2.6, 0, 7.6, 0); B(tw, M({ color: 0x333 }), 3, 0.2, 3, 0, 8.4, 0); W(12, 14, -30, -28);
  const spot = new THREE.SpotLight(0xffffff, 120, 40, 0.22, 0.5, 1.2); spot.position.set(0, 7.8, 0); tw.add(spot); spot.target.position.set(-10, 0, 10); tw.add(spot.target);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(2.4, 14, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffee, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); tw.add(beam);
  const YL = new THREE.PointLight(0xffe6c0, 12, 30, 1.3); YL.position.set(-6, 6, -18); g.add(YL);
  W(-16.2, -8, -4.3, -4); W(8, 16.2, -4.3, -4); B(g, conc, 8, 3.2, 0.2, -12, 1.6, -4.1); B(g, conc, 8, 3.2, 0.2, 12, 1.6, -4.1);
  // 감방동 ↔ 운동장 벽 (환풍구 덕트로만 통함)
  // 호송 버스 실내 (창살 창문, 긴 의자, 어두운 조명) — 감옥 남쪽 멀리
  const van = base.clone().add(V3(0, 0, 60)), vg = new THREE.Group(); vg.position.copy(van); scene.add(vg);
  B(vg, M({ color: 0x2b2f36 }), 5, 0.05, 2.2, 0, 0.4, 0); B(vg, M({ color: 0x3a3f45 }), 5, 0.05, 2.2, 0, 2.3, 0);
  for (const z of [-1.1, 1.1]) { B(vg, M({ color: 0x4a5058 }), 5, 1.9, 0.05, 0, 1.35, z); for (let x = -2; x <= 2; x += 1) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.35), new THREE.MeshBasicMaterial({ color: 0x0a0d14 })); w.position.set(x, 1.6, z * 0.97); w.rotation.y = z > 0 ? Math.PI : 0; vg.add(w); for (let k = 0; k < 4; k++) B(vg, bar, 0.02, 0.38, 0.02, x - 0.22 + k * 0.15, 1.6, z * 0.95); } }
  B(vg, M({ color: 0x4a5058 }), 0.05, 1.9, 2.2, -2.5, 1.35, 0); B(vg, M({ color: 0x4a5058 }), 0.05, 1.9, 2.2, 2.5, 1.35, 0);
  for (let k = 0; k < 9; k++) B(vg, bar, 0.03, 1.9, 0.03, 1.6, 1.35, -1 + k * 0.25);
  B(vg, M({ color: 0x6b6f75 }), 4, 0.08, 0.45, 0, 0.85, 0.75); B(vg, M({ color: 0x6b6f75 }), 4, 0.08, 0.45, 0, 0.85, -0.75);
  const vl = new THREE.PointLight(0xbfd0ff, 2.5, 5, 1.6); vl.position.set(0, 2.1, 0); vg.add(vl);
  return { group: g, van, cells, vent, ventHit, holeHit, yard, spot, beam, tw, cellPos: i => base.clone().add(V3(cells[i], 1.55, -2)), ductOut: base.clone().add(V3(cells[1] - 0.2, 1.55, -7.2)), outside: base.clone().add(V3((gap.x0 + gap.x1) / 2, 1.55, yard.z0 - 1.5)) };
}

// ── 길고양이·비둘기 ──
function makeCat(color) {
  const g = new THREE.Group(), m = M({ color, roughness: 0.95 }), eye = new THREE.MeshBasicMaterial({ color: 0xc8e86a, toneMapped: false });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), m); body.scale.set(0.8, 0.75, 1.6); body.position.y = 0.2; g.add(body);
  const head = new THREE.Group(); head.position.set(0, 0.3, 0.2); g.add(head); head.add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), m));
  for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.06, 6), m); ear.position.set(s * 0.04, 0.07, 0); head.add(ear); const e = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 4), eye); e.position.set(s * 0.028, 0.012, 0.066); head.add(e); }
  const legs = []; for (const [x, z] of [[-0.05, 0.12], [0.05, 0.12], [-0.05, -0.12], [0.05, -0.12]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.016, 0.16, 6), m); l.position.set(x, 0.08, z); g.add(l); legs.push(l); }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.3, 6), m); tail.position.set(0, 0.3, -0.27); tail.rotation.x = -0.7; g.add(tail);
  g.userData = { head, legs, tail }; return g;
}
function makePigeon() {
  const g = new THREE.Group(), m = M({ color: 0x6f7480, roughness: 0.9 }), nk = M({ color: 0x4d7a6a, roughness: 0.6, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), m); body.scale.set(0.85, 0.85, 1.4); body.position.y = 0.1; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), nk); head.position.set(0, 0.17, 0.08); g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.025, 5), M({ color: 0x222 })); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.165, 0.115); g.add(beak);
  const wings = []; for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 0.1), m); w.geometry.translate(s * 0.08, 0, 0); w.position.set(s * 0.04, 0.12, 0); g.add(w); wings.push(w); }
  g.userData = { head, wings }; return g;
}
export class Animals {
  constructor(scene, audio) {
    this.scene = scene; this.audio = audio; this.cats = []; this.birds = [];
    for (const [x, z, c] of [[-6.5, 4.6, 0xd28a3c], [-30, 4.8, 0x2a2a2a], [12, 17, 0xe8e2d6], [-80, 120, 0x8a7560]]) { const k = makeCat(c); k.position.set(x, 0, z); k.rotation.y = Math.random() * 6; scene.add(k); this.cats.push({ g: k, home: V3(x, 0, z), t: Math.random() * 4, tgt: null }); }
    for (let i = 0; i < 12; i++) { const b = makePigeon(); const home = i < 7 ? V3(10 + Math.random() * 10, 0, 4.4 + Math.random() * 1.5) : V3(-95 + Math.random() * 12, 0, 128 + Math.random() * 10); b.position.copy(home); b.rotation.y = Math.random() * 6; scene.add(b); this.birds.push({ g: b, home, fly: 0, v: V3(), t: Math.random() * 3 }); }
  }
  update(dt, me) {
    for (const c of this.cats) {
      const g = c.g, d = g.position.distanceTo(V3(me.x, 0, me.z)); c.t -= dt;
      if (d < 2.6 && !c.run) { c.run = 1.6; const away = g.position.clone().sub(V3(me.x, 0, me.z)).setY(0).normalize(); c.tgt = g.position.clone().addScaledVector(away, 6); }
      if (c.t < 0 && !c.tgt) { c.t = 4 + Math.random() * 6; if (Math.random() < 0.5) c.tgt = c.home.clone().add(V3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 1.2)); }
      if (c.tgt) { const v = c.tgt.clone().sub(g.position).setY(0), dd = v.length(), sp = c.run > 0 ? 3.2 : 0.5; if (dd < 0.1) { c.tgt = null; c.run = 0; } else { g.rotation.y = Math.atan2(v.x, v.z); g.position.addScaledVector(v.normalize(), Math.min(dd, sp * dt)); const ph = performance.now() * 0.001 * (sp * 6); g.userData.legs.forEach((l, i) => (l.rotation.x = Math.sin(ph + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.5)); } }
      else g.userData.legs.forEach(l => (l.rotation.x = 0));
      if (c.run > 0) c.run -= dt;
      g.userData.tail.rotation.z = Math.sin(performance.now() * 0.002 + c.home.x) * 0.4; g.userData.head.rotation.y = Math.sin(performance.now() * 0.0007 + c.home.z) * 0.5;
    }
    for (const b of this.birds) {
      const g = b.g, d = Math.hypot(g.position.x - me.x, g.position.z - me.z);
      if (!b.fly && d < 3.2) { b.fly = 4 + Math.random() * 2; b.v.set((g.position.x - me.x) / d * 3 + (Math.random() - 0.5) * 2, 3 + Math.random() * 2, (g.position.z - me.z) / d * 3 + (Math.random() - 0.5) * 2); this.audio.play('bag', { pos: g.position, vol: 0.5, rate: 2.2 + Math.random() * 0.4 }); }
      if (b.fly > 0) { b.fly -= dt; g.position.addScaledVector(b.v, dt); b.v.y -= 0.3 * dt; g.rotation.y = Math.atan2(b.v.x, b.v.z); const f = Math.sin(performance.now() * 0.05) * 0.9; g.userData.wings[0].rotation.z = f; g.userData.wings[1].rotation.z = -f; if (b.fly <= 0) { g.position.copy(b.home); b.v.set(0, 0, 0); g.userData.wings.forEach(w => (w.rotation.z = 0)); } }
      else { b.t -= dt; const peck = Math.max(0, Math.sin(performance.now() * 0.012 + b.home.x * 3)); g.userData.head.position.y = 0.17 - peck * 0.06; g.userData.head.position.z = 0.08 + peck * 0.03; if (b.t < 0) { b.t = 1 + Math.random() * 3; g.rotation.y += (Math.random() - 0.5) * 2; } }
    }
  }
}
export { Person };
