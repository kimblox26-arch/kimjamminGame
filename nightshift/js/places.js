// 창고(재고 선반·사물함·CCTV 책상·창고 상점 자판기), 법정(판사석·태극기·방청석), 교도소 감방
import * as THREE from 'three';

const FONT = '"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
function ctex(w, h, draw, rep) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); } return t; }
const M = (o) => new THREE.MeshStandardMaterial({ roughness: 0.7, envMapIntensity: 0.3, ...o });
const box = (p, mat, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); p.add(m); return m; };
export const STORAGE = { x0: 1.2, x1: 4.6, z0: -8, z1: -4 };

export function buildStorage(scene, collide) {
  const g = new THREE.Group(); scene.add(g);
  const { x0, x1, z0, z1 } = STORAGE, H = 2.8, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const floorT = ctex(256, 256, (c, w, h) => { c.fillStyle = '#5d646b'; c.fillRect(0, 0, w, h); for (let i = 0; i < 5000; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; c.fillRect(Math.random() * w, Math.random() * h, 3, 3); } }, [3, 3]);
  box(g, M({ map: floorT, roughness: 0.35 }), x1 - x0, 0.02, z1 - z0, cx, -0.01, cz);
  const wall = M({ color: 0xb8bcc0, roughness: 0.9 });
  box(g, wall, x1 - x0, 0.02, z1 - z0, cx, H, cz); box(g, wall, 0.1, H, z1 - z0, x0 - 0.05, H / 2, cz); box(g, wall, 0.1, H, z1 - z0, x1 + 0.05, H / 2, cz); box(g, wall, x1 - x0, H, 0.1, cx, H / 2, z0 - 0.05);
  collide({ x0: x0 - 0.2, x1: x0, z0, z1 }); collide({ x0: x1, x1: x1 + 0.2, z0, z1 }); collide({ x0, x1, z0: z0 - 0.2, z1: z0 });
  // 형광등 한 줄 (조금 어두운 창고)
  box(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf0f6ff).multiplyScalar(1.6) }), 1.2, 0.04, 0.08, cx, H - 0.03, cz);
  const L = new THREE.PointLight(0xe8f0ff, 3.2, 7, 1.6); L.position.set(cx, H - 0.25, cz); g.add(L);
  // 재고 랙 + 박스 (골판지)
  const cardT = (txt) => ctex(256, 192, (c, w, h) => { c.fillStyle = '#b98d5a'; c.fillRect(0, 0, w, h); for (let i = 0; i < 1200; i++) { c.fillStyle = `rgba(80,50,20,${Math.random() * 0.12})`; c.fillRect(Math.random() * w, Math.random() * h, 4, 1); } c.fillStyle = '#4a2f16'; c.font = `900 34px ${FONT}`; c.fillText(txt, 18, 80); c.font = `700 18px ${FONT}`; c.fillText('취급주의 ↑', 18, 130); c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, h / 2 - 6, w, 12); });
  const cards = ['컵라면 24입', '생수 20입', '과자 12입', '콜라 24캔', '삼각김밥', '맥주 24캔', '우유 24입'].map(t => M({ map: cardT(t), roughness: 0.95 }));
  const rack = M({ color: 0x2f5d8a, roughness: 0.5, metalness: 0.5 });
  for (let k = 0; k < 4; k++) box(g, rack, 0.6, 0.03, 3.4, x0 + 0.35, 0.15 + k * 0.6, cz);
  for (const zz of [z0 + 0.4, cz, z1 - 0.4]) box(g, rack, 0.05, 2.2, 0.05, x0 + 0.62, 1.1, zz), box(g, rack, 0.05, 2.2, 0.05, x0 + 0.08, 1.1, zz);
  for (let k = 0; k < 4; k++) for (let i = 0; i < 6; i++) if (Math.random() > 0.15) { const b = box(g, cards[(Math.random() * cards.length) | 0], 0.5, 0.34 + Math.random() * 0.1, 0.48, x0 + 0.36, 0.17 + k * 0.6 + 0.2, z0 + 0.5 + i * 0.52); b.rotation.y = (Math.random() - 0.5) * 0.15; }
  collide({ x0, x1: x0 + 0.7, z0, z1 });
  // 음료 상자 더미, 대걸레 통
  for (let i = 0; i < 5; i++) box(g, M({ color: [0x1b6b3a, 0xc4161c][i % 2], roughness: 0.6 }), 0.45, 0.28, 0.35, cx - 0.2, 0.14 + i * 0.29, z0 + 0.35);
  collide({ x0: cx - 0.45, x1: cx + 0.05, z0, z1: z0 + 0.55 });
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.32, 14), M({ color: 0xe6c200 })); bucket.position.set(cx + 0.5, 0.16, z0 + 0.4); g.add(bucket);
  box(g, M({ color: 0x8a6a4b }), 0.03, 1.3, 0.03, cx + 0.5, 0.75, z0 + 0.35).rotation.z = 0.15;
  // 사물함 (직원 조끼)
  const locker = M({ color: 0x9aa3ad, roughness: 0.45, metalness: 0.6 });
  for (let i = 0; i < 3; i++) { const d = box(g, locker, 0.5, 1.8, 0.45, x1 - 0.3, 0.9, z1 - 0.6 - i * 0.52); box(g, M({ color: 0x333 }), 0.02, 0.12, 0.02, x1 - 0.56, 1.0, z1 - 0.45 - i * 0.52); void d; }
  collide({ x0: x1 - 0.55, x1, z0: z1 - 1.9, z1 });
  // CCTV 책상 + 모니터 + 의자
  const deskM = M({ color: 0x6b5644, roughness: 0.6 });
  box(g, deskM, 0.6, 0.04, 1.1, x1 - 0.35, 0.74, z0 + 1.3); box(g, deskM, 0.05, 0.72, 1.0, x1 - 0.1, 0.37, z0 + 1.3);
  const cctvT = ctex(320, 240, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); for (let q = 0; q < 4; q++) { const x = (q % 2) * w / 2, y = Math.floor(q / 2) * h / 2; c.fillStyle = `rgb(${60 + q * 10},${70 + q * 8},${60 + q * 10})`; c.fillRect(x + 3, y + 3, w / 2 - 6, h / 2 - 6); c.fillStyle = 'rgba(200,220,200,.4)'; c.fillRect(x + 20, y + 40, 50, 60); c.fillRect(x + 90, y + 30, 40, 70); c.fillStyle = '#fff'; c.font = '700 12px monospace'; c.fillText('CAM0' + (q + 1) + '  REC', x + 8, y + 18); } });
  const mon = box(g, M({ color: 0x111 }), 0.06, 0.32, 0.42, x1 - 0.45, 0.98, z0 + 1.3); const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.28), new THREE.MeshBasicMaterial({ map: cctvT, toneMapped: false })); scr.position.set(-0.031, 0, 0); scr.rotation.y = -Math.PI / 2; mon.add(scr);
  collide({ x0: x1 - 0.65, x1, z0: z0 + 0.7, z1: z0 + 1.9 });
  // ── 창고 상점 자판기 ──
  const shop = new THREE.Group(); shop.position.set(cx + 0.55, 0, z0 + 0.45); g.add(shop);
  const front = ctex(256, 512, (c, w, h) => { c.fillStyle = '#7a0d0d'; c.fillRect(0, 0, w, h); c.fillStyle = '#111'; c.fillRect(16, 90, w - 32, 300); for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) { c.fillStyle = ['#555', '#2b2b2b', '#c9a227', '#3a5a8a'][(r + k) % 4]; c.fillRect(30 + k * 68, 110 + r * 70, 52, 44); } c.fillStyle = '#ffd400'; c.font = `900 44px ${FONT}`; c.textAlign = 'center'; c.fillText('창고 상점', w / 2, 62); c.fillStyle = '#fff'; c.font = `700 22px ${FONT}`; c.fillText('직원 전용 · 현금', w / 2, 430); c.fillStyle = '#0f0'; c.fillRect(w / 2 - 40, 450, 80, 30); });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.9, 0.7), [M({ color: 0x5a0a0a }), M({ color: 0x5a0a0a }), M({ color: 0x5a0a0a }), M({ color: 0x5a0a0a }), M({ map: front, emissive: 0xffffff, emissiveMap: front, emissiveIntensity: 0.35, roughness: 0.3 }), M({ color: 0x5a0a0a })]);
  body.position.y = 0.95; shop.add(body); body.userData.aim = 'shop';
  collide({ x0: cx + 0.15, x1: cx + 0.95, z0, z1: z0 + 0.8 });
  return { group: g, shop: body, light: L };
}

// 법정 (멀리 떨어진 곳에 만들어 두고 체포되면 카메라를 옮긴다)
export const COURT = new THREE.Vector3(0, 0, 600), PRISON = new THREE.Vector3(30, 0, 600);
export function buildCourt(scene) {
  const g = new THREE.Group(); g.position.copy(COURT); scene.add(g);
  const wood = M({ color: 0x6b4226, roughness: 0.55 }), wood2 = M({ color: 0x4a2c18, roughness: 0.5 }), wallM = M({ color: 0xe8e0d2, roughness: 0.9 });
  const panel = ctex(512, 256, (c, w, h) => { c.fillStyle = '#7a4b2a'; c.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 64) { c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(x, 0, 3, h); } for (let i = 0; i < 300; i++) { c.fillStyle = `rgba(40,20,10,${Math.random() * 0.15})`; c.fillRect(Math.random() * w, Math.random() * h, 30, 1); } }, [4, 1]);
  box(g, M({ color: 0x5b1f1f, roughness: 0.9 }), 14, 0.02, 16, 0, 0, 0); box(g, wallM, 14, 0.02, 16, 0, 5, 0);
  box(g, M({ map: panel }), 14, 5, 0.1, 0, 2.5, -8); box(g, wallM, 0.1, 5, 16, -7, 2.5, 0); box(g, wallM, 0.1, 5, 16, 7, 2.5, 0); box(g, wallM, 14, 5, 0.1, 0, 2.5, 8);
  // 판사석 (높은 단) + 법원 마크 + 태극기
  box(g, wood, 6, 0.9, 2, 0, 0.45, -6.4); box(g, wood2, 6, 1.75, 0.15, 0, 0.875, -5.4); box(g, wood, 6.2, 0.08, 0.6, 0, 1.78, -5.6);
  const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.7, 40), new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.5, map: ctex(256, 256, (c, w, h) => { c.fillStyle = '#c9a227'; c.beginPath(); c.arc(w / 2, h / 2, w / 2, 0, 7); c.fill(); c.fillStyle = '#5a3d0a'; c.font = `900 60px ${FONT}`; c.textAlign = 'center'; c.fillText('법원', w / 2, h / 2 + 20); }) }));
  emblem.position.set(0, 3.6, -7.9); g.add(emblem);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, map: ctex(300, 200, (c, w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.save(); c.translate(w / 2, h / 2); c.rotate(-0.59); c.fillStyle = '#cd2e3a'; c.beginPath(); c.arc(0, 0, 50, Math.PI, 0); c.fill(); c.fillStyle = '#0047a0'; c.beginPath(); c.arc(0, 0, 50, 0, Math.PI); c.fill(); c.fillStyle = '#cd2e3a'; c.beginPath(); c.arc(-25, 0, 25, 0, Math.PI * 2); c.fill(); c.fillStyle = '#0047a0'; c.beginPath(); c.arc(25, 0, 25, 0, Math.PI * 2); c.fill(); c.restore(); c.fillStyle = '#000'; [[-95, -55], [95, 55], [95, -55], [-95, 55]].forEach(([x, y]) => { c.save(); c.translate(w / 2 + x, h / 2 + y); c.rotate(Math.atan2(y, x) + Math.PI / 2); for (let k = 0; k < 3; k++) c.fillRect(-18, -12 + k * 9, 36, 5); c.restore(); }); }) }));
  flag.position.set(-4.5, 3.2, -7.9); g.add(flag); box(g, M({ color: 0xc9a227, metalness: 0.8, roughness: 0.3 }), 0.05, 3.4, 0.05, -5.2, 1.7, -7.7);
  // 피고인석 · 방청석
  box(g, wood, 1.6, 1.0, 0.1, 0, 0.5, -2.0);
  for (let r = 0; r < 3; r++) for (const sx of [-3.5, 3.5]) box(g, wood2, 4, 0.5, 0.5, sx, 0.25, 3.5 + r * 1.2);
  const lamp = new THREE.PointLight(0xffe2b8, 18, 18, 1.4); lamp.position.set(0, 4.2, -2); g.add(lamp);
  const lamp2 = new THREE.PointLight(0xffe2b8, 10, 14, 1.5); lamp2.position.set(0, 4.2, 4); g.add(lamp2);
  // 교도소 감방
  const p = new THREE.Group(); p.position.copy(PRISON); scene.add(p);
  const conc = M({ color: 0x6f7378, roughness: 0.95 }), bar = M({ color: 0x2a2d31, metalness: 0.8, roughness: 0.35 });
  box(p, conc, 3, 0.02, 3.5, 0, 0, 0); box(p, conc, 3, 3, 0.1, 0, 1.5, -1.75); box(p, conc, 0.1, 3, 3.5, -1.5, 1.5, 0); box(p, conc, 0.1, 3, 3.5, 1.5, 1.5, 0); box(p, conc, 3, 0.02, 3.5, 0, 3, 0);
  for (let i = 0; i < 12; i++) box(p, bar, 0.04, 3, 0.04, -1.4 + i * 0.25, 1.5, 1.75);
  box(p, M({ color: 0x8a8f96, roughness: 0.6 }), 0.9, 0.45, 2, -1.0, 0.22, -0.6); box(p, M({ color: 0xdcdcd2 }), 0.85, 0.1, 1.9, -1.0, 0.5, -0.6);
  const pl = new THREE.PointLight(0xcfd8ff, 4, 6, 1.6); pl.position.set(0, 2.7, 0); p.add(pl);
  return { court: g, prison: p };
}
