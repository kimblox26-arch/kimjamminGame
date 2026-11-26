// 달빛지방법원: 법정(places.js buildCourt)을 감싸는 실제 법원 건물. 교도소 옆 블록.
// 돌기둥 현관·계단·간판, 자동 유리문, 로비(보안 검색대·X선 검색기·안내 데스크·대기 의자·안내판), 법정을 둘러싼 복도.
// 재판 중 법정 문을 열고 나가거나 싸워서 건물 밖으로 탈출할 수 있음 (crime.js)
import * as THREE from 'three';
import { pbr, tex } from './tex.js';

const FONT = '"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
const M = o => new THREE.MeshStandardMaterial({ roughness: 0.7, envMapIntensity: 0.4, ...o });
function ctex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
function box(p, m, sx, sy, sz, x, y, z, T = 2) {
  const g = new THREE.BoxGeometry(sx, sy, sz), uv = g.attributes.uv, D = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * D[f][0] / T, uv.getY(i) * D[f][1] / T); }
  const b = new THREE.Mesh(g, m); b.position.set(x, y, z); p.add(b); return b;
}
const pl = (p, m, w, h, x, y, z, ry = 0) => { const q = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); q.position.set(x, y, z); q.rotation.y = ry; p.add(q); return q; };

export function buildCourthouse(scene, colliders, base, court) {
  const g = new THREE.Group(); g.position.copy(base); scene.add(g);
  const W = (x0, x1, z0, z1, extra = {}) => { const c = { x0: base.x + Math.min(x0, x1), x1: base.x + Math.max(x0, x1), z0: base.z + Math.min(z0, z1), z1: base.z + Math.max(z0, z1), ...extra }; colliders.push(c); return c; };
  const stone = M({ ...pbr('concrete', [1, 1]), color: 0xd9d2c3, roughness: 0.75 }), stoneDark = M({ ...pbr('concrete', [1, 1]), color: 0x8f877a });
  const marble = M({ map: tex('marble_col.jpg', [1, 1]), roughness: 0.25, envMapIntensity: 0.9 }), plaster = M({ color: 0xece6da, roughness: 0.9 }), wood = M({ map: tex('wood_col.jpg', [1, 1]), roughness: 0.5 });
  const steel = M({ color: 0x8a9096, metalness: 0.8, roughness: 0.35 }), glass = new THREE.MeshStandardMaterial({ color: 0x9fb8c8, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.2, envMapIntensity: 1.2 });
  const glow = c => new THREE.MeshBasicMaterial({ color: new THREE.Color(c), toneMapped: false });
  const winTex = ctex(256, 256, (q, w, h) => { q.fillStyle = '#cfc7b6'; q.fillRect(0, 0, w, h); for (let i = 0; i < 1500; i++) { q.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; q.fillRect(Math.random() * w, Math.random() * h, 2, 2); } const lit = Math.random() < 0.5; q.fillStyle = lit ? '#e8d7a4' : '#1a222c'; q.fillRect(56, 40, 144, 170); q.fillStyle = 'rgba(0,0,0,.35)'; q.fillRect(126, 40, 4, 170); q.fillRect(56, 122, 144, 4); q.fillStyle = 'rgba(255,255,255,.4)'; q.fillRect(48, 210, 160, 8); });
  const mFacade = M({ map: winTex, emissiveMap: winTex, emissive: 0x5a5038, emissiveIntensity: 0.5, roughness: 0.8 });
  const X = 17, Z0 = -31, Z1 = 16, H = 13;
  // ── 바깥: 벽(창문), 지붕, 현관 기둥·계단·간판 ──
  box(g, mFacade, X * 2, H, 0.5, 0, H / 2, Z1, 4); box(g, mFacade, 0.5, H, Z1 - Z0, -X, H / 2, (Z0 + Z1) / 2, 4); box(g, mFacade, 0.5, H, Z1 - Z0, X, H / 2, (Z0 + Z1) / 2, 4);
  box(g, mFacade, X - 3.2, H, 0.5, -(X + 3.2) / 2, H / 2, Z0, 4); box(g, mFacade, X - 3.2, H, 0.5, (X + 3.2) / 2, H / 2, Z0, 4); box(g, stone, 6.4, H - 4.2, 0.5, 0, 4.2 + (H - 4.2) / 2, Z0, 3);
  box(g, stoneDark, X * 2 + 1, 0.6, Z1 - Z0 + 1, 0, H + 0.3, (Z0 + Z1) / 2, 3); box(g, stoneDark, X * 2 + 0.6, 1, Z1 - Z0 + 0.6, 0, 0.5, (Z0 + Z1) / 2, 3);
  W(-X - 0.3, X + 0.3, Z1 - 0.3, Z1 + 0.3); W(-X - 0.3, -X + 0.3, Z0, Z1); W(X - 0.3, X + 0.3, Z0, Z1); W(-X, -3.1, Z0 - 0.3, Z0 + 0.3); W(3.1, X, Z0 - 0.3, Z0 + 0.3);
  // 현관: 계단 3단 + 돌기둥 6개 + 박공 보 + 간판 "달빛지방법원" + 저울 문양
  for (let k = 0; k < 3; k++) box(g, stone, 28 - k * 0.8, 0.16, 1.1, 0, 0.08 + k * 0.16, Z0 - 4.6 + k * 1.1, 2);
  box(g, stone, 27, 0.48, 3.2, 0, 0.24, Z0 - 1.6, 2);
  for (const x of [-11.5, -7.5, -3.6, 3.6, 7.5, 11.5]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 9.2, 20), stone); c.position.set(x, 5.06, Z0 - 2.2); g.add(c); box(g, stoneDark, 1.5, 0.4, 1.5, x, 0.68, Z0 - 2.2); box(g, stoneDark, 1.5, 0.4, 1.5, x, 9.86, Z0 - 2.2); W(x - 0.65, x + 0.65, Z0 - 2.85, Z0 - 1.55); }
  box(g, stone, 26, 1.6, 3.4, 0, 10.8, Z0 - 1.9, 3); { const sh = new THREE.Shape(); sh.moveTo(-13.4, 0); sh.lineTo(13.4, 0); sh.lineTo(0, 3.2); sh.closePath(); const tg = new THREE.ExtrudeGeometry(sh, { depth: 3.4, bevelEnabled: false }); tg.translate(0, 0, -1.7); const tri = new THREE.Mesh(tg, stone); tri.position.set(0, 11.6, Z0 - 1.9); g.add(tri); }   // 박공(삼각 지붕)
  pl(g, M({ map: ctex(1024, 128, (q, w, h) => { q.fillStyle = '#e4dccb'; q.fillRect(0, 0, w, h); q.fillStyle = '#2a2622'; q.font = `900 78px ${FONT}`; q.textAlign = 'center'; q.fillText('달 빛 지 방 법 원', w / 2, 92); }), roughness: 0.6 }), 14, 1.4, 0, 10.8, Z0 - 3.62, Math.PI);
  pl(g, M({ map: ctex(256, 256, (q, w, h) => { q.fillStyle = '#c9a227'; q.beginPath(); q.arc(128, 128, 120, 0, 7); q.fill(); q.strokeStyle = '#5a4510'; q.lineWidth = 8; q.beginPath(); q.moveTo(128, 50); q.lineTo(128, 200); q.moveTo(60, 80); q.lineTo(196, 80); q.moveTo(90, 210); q.lineTo(166, 210); q.stroke(); for (const x of [60, 196]) { q.beginPath(); q.moveTo(x, 80); q.lineTo(x - 26, 140); q.lineTo(x + 26, 140); q.closePath(); q.stroke(); q.beginPath(); q.arc(x, 140, 26, 0, Math.PI); q.stroke(); } }), metalness: 0.6, roughness: 0.35, transparent: true }), 1.8, 1.8, 0, 12.7, Z0 - 3.0, Math.PI);
  for (const x of [-14.5, -13, 13, 14.5]) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 8, 8), steel); pole.position.set(x, 4, Z0 - 6); g.add(pole); const f = pl(g, M({ color: x < 0 ? 0x2b4a7a : 0xe8e6df, side: THREE.DoubleSide, roughness: 0.8 }), 1.6, 1.0, x + 0.82, 7.4, Z0 - 6); f.userData.keep = true; }
  for (const x of [-9, 9]) { box(g, steel, 0.16, 5, 0.16, x, 2.5, Z0 - 7); box(g, glow(0xffe3b0), 0.5, 0.12, 0.5, x, 5.05, Z0 - 7); }
  const LF = new THREE.PointLight(0xffe0b0, 12, 26, 1.4); LF.position.set(0, 8, Z0 - 6); g.add(LF);
  // ── 자동 유리문 (가까이 가면 양쪽으로 열림) ──
  const doorL = box(g, glass, 3, 3.9, 0.06, -1.5, 2.15, Z0), doorR = box(g, glass, 3, 3.9, 0.06, 1.5, 2.15, Z0); doorL.userData.keep = doorR.userData.keep = true;
  box(g, steel, 6.4, 0.25, 0.3, 0, 4.2, Z0); const frontCol = W(-3.1, 3.1, Z0 - 0.15, Z0 + 0.15);
  // ── 실내 벽 마감 (바깥 창문 무늬가 안에서 보이지 않게): 미색 벽 + 나무 징두리, 법정 바깥벽도 미색으로
  const inner = M({ color: 0xe9e2d4, roughness: 0.85 }), panel = M({ map: tex('wood_col.jpg', [1, 1]), roughness: 0.55, color: 0xb89a7a });
  const lining = (w, x, z, ry) => { pl(g, inner, w, 6.1, x, 3.05, z, ry); pl(g, panel, w, 1.1, x + Math.sin(ry) * 0.012, 0.6, z + Math.cos(ry) * 0.012, ry); };
  lining(X * 2 - 0.6, 0, Z1 - 0.27, Math.PI); lining(Z1 - Z0 - 0.6, -X + 0.27, (Z0 + Z1) / 2, Math.PI / 2); lining(Z1 - Z0 - 0.6, X - 0.27, (Z0 + Z1) / 2, -Math.PI / 2);
  lining(X - 3.5, -(X + 3.2) / 2, Z0 + 0.27, 0); lining(X - 3.5, (X + 3.2) / 2, Z0 + 0.27, 0);
  pl(g, inner, 16.2, 6.1, 0, 3.05, -7.58, Math.PI); pl(g, inner, 15.2, 6.1, -8.08, 3.05, 0, -Math.PI / 2); pl(g, inner, 15.2, 6.1, 8.08, 3.05, 0, Math.PI / 2);
  pl(g, inner, 7.2, 6.1, -4.45, 3.05, 7.58, 0); pl(g, inner, 7.2, 6.1, 4.45, 3.05, 7.58, 0); pl(g, inner, 1.7, 3.4, 0, 4.4, 7.58, 0);
  pl(g, M({ map: ctex(512, 128, (q, w, h) => { q.fillStyle = '#2b2620'; q.fillRect(0, 0, w, h); q.fillStyle = '#e8d9b0'; q.font = `900 64px ${FONT}`; q.textAlign = 'center'; q.fillText('제 1 호 법 정', w / 2, 86); }), roughness: 0.5 }), 2.4, 0.6, 0, 3.2, 7.6, 0);
  pl(g, M({ map: ctex(512, 128, (q, w, h) => { q.fillStyle = '#2b2620'; q.fillRect(0, 0, w, h); q.fillStyle = '#e8d9b0'; q.font = `900 60px ${FONT}`; q.textAlign = 'center'; q.fillText('형사 재판 진행 중', w / 2, 84); }), roughness: 0.5 }), 3.2, 0.8, 0, 3.4, -7.6, Math.PI);
  // ── 실내 바닥·천장: 로비(법정 앞) + 법정을 둘러싼 ㄷ자 복도 ──
  const fz = -7.62; box(g, marble, X * 2 - 0.6, 0.04, fz - Z0 - 0.3, 0, 0.02, (Z0 + 0.3 + fz) / 2, 3);
  box(g, marble, X - 8.3, 0.04, Z1 - fz, -(X + 8.3) / 2, 0.02, (fz + Z1) / 2, 3); box(g, marble, X - 8.3, 0.04, Z1 - fz, (X + 8.3) / 2, 0.02, (fz + Z1) / 2, 3); box(g, marble, 16.6, 0.04, Z1 - 7.62, 0, 0.02, (7.62 + Z1) / 2, 3);
  box(g, plaster, X * 2 - 0.6, 0.1, Z1 - Z0 - 0.6, 0, 6.2, (Z0 + Z1) / 2, 4);
  for (const [x, z] of [[-10, -20], [10, -20], [0, -12], [-12.5, 4], [12.5, 4], [0, 12]]) { box(g, glow(0xfff3dc), 1.6, 0.04, 0.6, x, 6.13, z); }
  const L1 = new THREE.PointLight(0xfff0d8, 10, 22, 1.3); L1.position.set(0, 5.2, -19); g.add(L1);
  const L2 = new THREE.PointLight(0xfff0d8, 7, 18, 1.3); L2.position.set(0, 5.2, 11.5); g.add(L2);
  // 로비 벽면 대리석 띠 + 안내판
  box(g, wood, X * 2 - 1, 1.1, 0.06, 0, 0.55, Z0 + 0.3, 2);
  pl(g, M({ map: ctex(512, 640, (q, w, h) => { q.fillStyle = '#2c3440'; q.fillRect(0, 0, w, h); q.fillStyle = '#f0e7cf'; q.font = `900 44px ${FONT}`; q.textAlign = 'center'; q.fillText('층별 안내', w / 2, 70); q.textAlign = 'left'; q.font = `600 30px ${FONT}`; ['1F  제1호 법정 · 민원실', '2F  형사부 · 증인지원실', '3F  민사부 · 조정실', '4F  판사실 · 법원장실', 'B1  구치감 (호송 대기)'].forEach((t, i) => q.fillText(t, 40, 160 + i * 90)); }), roughness: 0.5 }), 2.2, 2.75, -X + 0.27, 2.2, -20, Math.PI / 2);
  // 보안 검색대(문형 금속탐지기 2개) + X선 검색기 + 안내 데스크 + 대기 의자
  for (const x of [-1.6, 1.6]) { box(g, M({ color: 0xd8d8d0, roughness: 0.4 }), 0.18, 2.2, 0.6, x - 0.55, 1.1, -24); box(g, M({ color: 0xd8d8d0, roughness: 0.4 }), 0.18, 2.2, 0.6, x + 0.55, 1.1, -24); box(g, M({ color: 0xd8d8d0, roughness: 0.4 }), 1.28, 0.2, 0.6, x, 2.25, -24); W(x - 0.65, x - 0.45, -24.3, -23.7); W(x + 0.45, x + 0.65, -24.3, -23.7); }
  box(g, M({ color: 0x3a3f46, metalness: 0.4, roughness: 0.4 }), 1.2, 1.1, 2.6, -5, 0.55, -23.6); box(g, M({ color: 0x1a1d21 }), 0.5, 0.06, 3.4, -5, 0.9, -23.6); W(-5.6, -4.4, -25.4, -21.8);
  box(g, wood, 4.6, 1.05, 1.0, 10.5, 0.52, -19); box(g, marble, 4.8, 0.06, 1.15, 10.5, 1.08, -19); W(8.2, 12.8, -19.5, -18.5);
  for (const z of [-15, -12.5]) for (const x of [-12, -9]) { box(g, wood, 2.4, 0.08, 0.55, x, 0.46, z); box(g, steel, 0.06, 0.44, 0.5, x - 1.1, 0.22, z); box(g, steel, 0.06, 0.44, 0.5, x + 1.1, 0.22, z); box(g, wood, 2.4, 0.5, 0.06, x, 0.78, z + 0.26); W(x - 1.2, x + 1.2, z - 0.28, z + 0.3); }
  for (const [x, z] of [[-15.8, -29.8], [15.8, -29.8], [-15.8, -9], [15.8, -9]]) { const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.6, 12), M({ color: 0x5a4a3a })); pot.position.set(x, 0.3, z); g.add(pot); const bush = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), M({ color: 0x2f5a2e, roughness: 0.95 })); bush.position.set(x, 1.1, z); bush.scale.y = 1.5; g.add(bush); W(x - 0.35, x + 0.35, z - 0.35, z + 0.35); }
  // 복도 벽 쪽 문들(다른 법정·사무실) + 벤치
  for (const [x, z, ry] of [[-X + 0.27, -2, Math.PI / 2], [-X + 0.27, 8, Math.PI / 2], [X - 0.27, -2, -Math.PI / 2], [X - 0.27, 8, -Math.PI / 2]]) pl(g, wood, 1.6, 2.6, x, 1.3, z, ry);
  for (const x of [-12, -6, 6, 12]) { box(g, wood, 2.2, 0.08, 0.5, x, 0.46, Z1 - 0.9); box(g, wood, 2.2, 0.5, 0.06, x, 0.78, Z1 - 0.62); W(x - 1.1, x + 1.1, Z1 - 1.2, Z1 - 0.3); }
  // ── 법정 문: 법정 벽 사이 틈 (닫혀 있을 땐 막힘) ──
  // 법정 안: 벽(뒷벽 문 자리 비움)·법대·서기석·검사/변호인석·증인석·방청석 칸막이·긴 의자
  for (const [x0, x1, z0, z1] of [[-8.2, -7.9, -7.5, 7.5], [7.9, 8.2, -7.5, 7.5], [-8, 8, -7.8, -4.9], [-8, -0.85, 7.4, 7.8], [0.85, 8, 7.4, 7.8], [-2, 2, -4.5, -3.7], [-5.8, -2.6, -2.1, -1.1], [2.6, 5.8, -2.1, -1.1], [-0.7, 0.7, -2.85, -1.95], [-7.4, -1.2, 1.55, 1.65], [1.2, 7.4, 1.55, 1.65], [-6.8, -1.2, 2.5, 7], [1.2, 6.8, 2.5, 7]]) W(x0, x1, z0, z1);
  const courtDoorCol = { x0: base.x - 0.85, x1: base.x + 0.85, z0: base.z + 7.3, z1: base.z + 7.7 }; colliders.push(courtDoorCol);
  const door = court?.userData.door; let dk = 0, fk = 0, courtOpen = false, frontOpen = false;
  const api = {
    group: g, front: base.clone().add(new THREE.Vector3(0, 0, Z0 - 8)), lobby: base.clone().add(new THREE.Vector3(0, 0, -20)), bounds: { x0: base.x - X, x1: base.x + X, z0: base.z + Z0, z1: base.z + Z1 },
    inside: p => p.x > base.x - X && p.x < base.x + X && p.z > base.z + Z0 && p.z < base.z + Z1,
    lockCourt: false,
    update(dt, me) {
      const lx = me.x - base.x, lz = me.z - base.z;
      // 법정 문: 문 앞(안·밖) 1.6m 안에 오면 열림 (재판 중 잠금이면 안 열림)
      const nearC = Math.abs(lx) < 1.6 && Math.abs(lz - 7.5) < 1.8 && !api.lockCourt;
      dk += ((nearC ? 1 : 0) - dk) * Math.min(1, dt * 4); if (door) door.rotation.y = -dk * 1.6;
      if (nearC !== courtOpen) { courtOpen = nearC; const i = colliders.indexOf(courtDoorCol); if (nearC && i >= 0) colliders.splice(i, 1); else if (!nearC && i < 0) colliders.push(courtDoorCol); }
      // 정문 자동문
      const nearF = Math.abs(lx) < 3.5 && Math.abs(lz - Z0) < 3.2;
      fk += ((nearF ? 1 : 0) - fk) * Math.min(1, dt * 5); doorL.position.x = -1.5 - fk * 2.6; doorR.position.x = 1.5 + fk * 2.6;
      if (nearF !== frontOpen) { frontOpen = nearF; const i = colliders.indexOf(frontCol); if (nearF && i >= 0) colliders.splice(i, 1); else if (!nearF && i < 0) colliders.push(frontCol); }
    },
  };
  return api;
}
