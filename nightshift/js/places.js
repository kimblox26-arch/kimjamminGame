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
  const fm = M({ map: floorT, roughness: 0.35 });   // 바닥 (지하 무기고 계단 구멍 x 2.2~3.0, z -8~-4.7)
  box(g, fm, 2.2 - x0, 0.02, z1 - z0, (x0 + 2.2) / 2, -0.01, cz); box(g, fm, x1 - 3.0, 0.02, z1 - z0, (3.0 + x1) / 2, -0.01, cz); box(g, fm, 0.8, 0.02, z1 + 4.7, 2.6, -0.01, (z1 - 4.7) / 2);
  const wall = M({ color: 0xb8bcc0, roughness: 0.9 });
  box(g, wall, x1 - x0, 0.02, z1 - z0, cx, H, cz); box(g, wall, 0.1, H, z1 - z0, x0 - 0.05, H / 2, cz); box(g, wall, 0.1, H, z1 - z0, x1 + 0.05, H / 2, cz); box(g, wall, x1 - x0, H, 0.1, cx, H / 2, z0 - 0.05);
  collide({ x0: x0 - 0.2, x1: x0, z0, z1 }); collide({ x0: x1, x1: x1 + 0.2, z0, z1 }); collide({ x0, x1, z0: z0 - 0.2, z1: z0 });
  // 형광등 한 줄 (조금 어두운 창고)
  box(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf0f6ff).multiplyScalar(1.6) }), 1.2, 0.04, 0.08, cx, H - 0.03, cz);
  const L = new THREE.PointLight(0xe8f0ff, 3.2, 7, 1.6); L.position.set(cx, H - 0.25, cz); g.add(L);
  // 재고 랙 + 박스 (골판지)
  const cardT = (txt) => ctex(256, 192, (c, w, h) => { c.fillStyle = '#b98d5a'; c.fillRect(0, 0, w, h); for (let i = 0; i < 1200; i++) { c.fillStyle = `rgba(80,50,20,${Math.random() * 0.12})`; c.fillRect(Math.random() * w, Math.random() * h, 4, 1); } c.fillStyle = '#4a2f16'; c.font = `900 34px ${FONT}`; c.fillText(txt, 18, 80); c.font = `700 18px ${FONT}`; c.fillText('취급주의 ↑', 18, 130); c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, h / 2 - 6, w, 12); });
  const cardN = new THREE.TextureLoader().load('assets/tex/card_nrm.jpg');
  const cards = ['신라면 컵 24입', '삼다수 20입', '새우깡 12입', '코카콜라 24캔', '삼각김밥', '카스 24캔', '바나나맛우유'].map(t => M({ map: cardT(t), roughness: 0.92, normalMap: cardN, normalScale: new THREE.Vector2(0.6, 0.6) }));
  const rack = M({ color: 0x2f5d8a, roughness: 0.5, metalness: 0.5 });
  for (let k = 0; k < 4; k++) box(g, rack, 0.6, 0.03, 3.4, x0 + 0.35, 0.15 + k * 0.6, cz);
  for (const zz of [z0 + 0.4, cz, z1 - 0.4]) box(g, rack, 0.05, 2.2, 0.05, x0 + 0.62, 1.1, zz), box(g, rack, 0.05, 2.2, 0.05, x0 + 0.08, 1.1, zz);
  for (let k = 0; k < 4; k++) for (let i = 0; i < 6; i++) if (Math.random() > 0.15) { const b = box(g, cards[(Math.random() * cards.length) | 0], 0.5, 0.34 + Math.random() * 0.1, 0.48, x0 + 0.36, 0.17 + k * 0.6 + 0.2, z0 + 0.5 + i * 0.52); b.rotation.y = (Math.random() - 0.5) * 0.15; }
  collide({ x0, x1: x0 + 0.7, z0, z1 });
  // 음료 상자 더미, 대걸레 통
  for (let i = 0; i < 5; i++) box(g, M({ color: [0x1b6b3a, 0xc4161c][i % 2], roughness: 0.6 }), 0.45, 0.28, 0.35, cx + 0.6, 0.14 + i * 0.29, z0 + 0.35);
  collide({ x0: cx + 0.35, x1: cx + 0.85, z0, z1: z0 + 0.55 });
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.32, 14), M({ color: 0xe6c200 })); bucket.position.set(x1 - 0.5, 0.16, z0 + 0.3); g.add(bucket);
  box(g, M({ color: 0x8a6a4b }), 0.03, 1.3, 0.03, x1 - 0.5, 0.75, z0 + 0.25).rotation.z = 0.15;
  // 소화기 · 근무표 게시판 · 벽시계 · 지하 계단 안내
  const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 14), M({ color: 0xc1121f, roughness: 0.35 })); ext.position.set(x0 + 0.85, 0.27, z1 - 0.15); g.add(ext);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), M({ map: ctex(360, 240, (c, w, h) => { c.fillStyle = '#c9a26b'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.fillRect(20, 20, 200, 200); c.fillStyle = '#111'; c.font = `900 22px ${FONT}`; c.fillText('11월 근무표', 34, 50); c.font = `600 15px ${FONT}`; ['월 김잼민 22-06', '화 김잼민 22-06', '수 박민수 22-06', '목 김잼민 22-06', '금 이지은 22-06', '토 김잼민 22-06'].forEach((t, i) => c.fillText(t, 34, 80 + i * 22)); c.fillStyle = '#ffe066'; c.fillRect(240, 30, 100, 90); c.fillStyle = '#333'; c.font = `700 13px ${FONT}`; c.fillText('유통기한', 252, 60); c.fillText('매일 확인!', 252, 82); c.fillStyle = '#ff9aa2'; c.fillRect(240, 135, 100, 80); c.fillStyle = '#333'; c.fillText('지하 무기고', 250, 165); c.fillText('관계자만', 252, 187); }), roughness: 0.9 }));
  board.position.set(x0 + 0.01 + 0.7, 1.6, z1 - 0.06); board.rotation.y = Math.PI; g.add(board);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.18), new THREE.MeshBasicMaterial({ map: ctex(256, 92, (c, w, h) => { c.fillStyle = '#e9c46a'; c.fillRect(0, 0, w, h); c.fillStyle = '#111'; c.font = `900 34px ${FONT}`; c.fillText('↓ 지하', 70, 58); }), toneMapped: false })); sign.position.set(2.6, 1.9, z0 + 0.06); g.add(sign);
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
  return { group: g, shop: null, cabinet: null, light: L };
}

// 법정 (멀리 떨어진 곳에 만들어 두고 체포되면 카메라를 옮긴다)
export const COURT = new THREE.Vector3(0, 0, 600), PRISON = new THREE.Vector3(30, 0, 600);
export function buildCourt(scene) {
  const g = new THREE.Group(); g.position.copy(COURT); scene.add(g);
  const W = 16, D = 15, H = 5.6;
  const oak = ctex(512, 512, (c, w, h) => { c.fillStyle = '#7b4f2c'; c.fillRect(0, 0, w, h); for (let i = 0; i < 260; i++) { const y = Math.random() * h; c.strokeStyle = `rgba(${40 + Math.random() * 40},${20 + Math.random() * 20},10,${0.15 + Math.random() * 0.25})`; c.lineWidth = 1 + Math.random() * 2; c.beginPath(); c.moveTo(0, y); for (let x = 0; x < w; x += 32) c.lineTo(x, y + Math.sin(x * 0.02 + i) * 4); c.stroke(); } }, [2, 2]);
  const slat = ctex(512, 512, (c, w, h) => { c.fillStyle = '#5a3a20'; c.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 32) { c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(x, 0, 4, h); c.fillStyle = 'rgba(255,220,180,.06)'; c.fillRect(x + 4, 0, 10, h); } for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(30,15,5,${Math.random() * 0.15})`; c.fillRect(Math.random() * w, Math.random() * h, 1, 20 + Math.random() * 40); } }, [3, 1]);
  const panel = ctex(512, 256, (c, w, h) => { c.fillStyle = '#80552f'; c.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 128) { c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 6; c.strokeRect(x + 14, 22, 100, h - 44); c.strokeStyle = 'rgba(255,220,170,.15)'; c.lineWidth = 2; c.strokeRect(x + 20, 28, 88, h - 56); } }, [4, 1]);
  const carpet = ctex(256, 256, (c, w, h) => { c.fillStyle = '#25384d'; c.fillRect(0, 0, w, h); for (let i = 0; i < 9000; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.08})`; c.fillRect(Math.random() * w, Math.random() * h, 1, 1); } }, [10, 10]);
  const plaster = ctex(256, 256, (c, w, h) => { c.fillStyle = '#e9e2d4'; c.fillRect(0, 0, w, h); for (let i = 0; i < 3000; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.035})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, [4, 2]);
  const wood = M({ map: oak, roughness: 0.45, envMapIntensity: 0.6 }), wSlat = M({ map: slat, roughness: 0.5 }), wPanel = M({ map: panel, roughness: 0.5 }), leather = M({ color: 0x111111, roughness: 0.35, envMapIntensity: 0.7 });
  const gold = M({ color: 0xc9a227, metalness: 0.9, roughness: 0.25 });
  // 바닥·천장·벽
  box(g, M({ map: carpet, roughness: 0.95 }), W, 0.02, D, 0, 0, 0);
  box(g, M({ map: plaster }), 0.1, H, D, -W / 2, H / 2, 0); box(g, M({ map: plaster }), 0.1, H, D, W / 2, H / 2, 0); box(g, M({ map: plaster }), W, H, 0.1, 0, H / 2, D / 2);
  box(g, wPanel, 0.12, 1.3, D, -W / 2 + 0.06, 0.65, 0); box(g, wPanel, 0.12, 1.3, D, W / 2 - 0.06, 0.65, 0);
  box(g, wSlat, W, H, 0.1, 0, H / 2, -D / 2);                                                  // 판사석 뒤 나무 루버 벽
  box(g, M({ color: 0xf2efe8, roughness: 0.9 }), W, 0.04, D, 0, H, 0);
  for (let x = -6; x <= 6; x += 3) for (let z = -5; z <= 5; z += 3.3) { box(g, M({ color: 0xd8d2c6 }), 2.6, 0.12, 2.9, x, H - 0.06, z); box(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4e0).multiplyScalar(1.8) }), 1.0, 0.02, 1.0, x, H - 0.13, z); }
  const L1 = new THREE.PointLight(0xffe9cc, 22, 20, 1.3); L1.position.set(0, 4.6, -3.5); g.add(L1);
  const L2 = new THREE.PointLight(0xffe9cc, 14, 18, 1.4); L2.position.set(0, 4.6, 3.5); g.add(L2);
  const L3 = new THREE.SpotLight(0xfff1dc, 40, 14, 0.7, 0.6, 1.2); L3.position.set(0, 5.2, -2); L3.target.position.set(0, 1.5, -6.2); g.add(L3, L3.target);
  // 법원 마크 (금색 원판)
  const emblem = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.06, 48), [gold, M({ metalness: 0.7, roughness: 0.3, map: ctex(256, 256, (c, w, h) => { c.fillStyle = '#c9a227'; c.fillRect(0, 0, w, h); c.strokeStyle = '#7a5a10'; c.lineWidth = 8; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 12, 0, 7); c.stroke(); c.fillStyle = '#6b4e0c'; c.font = '900 70px "Noto Sans KR",sans-serif'; c.textAlign = 'center'; c.fillText('法', w / 2, h / 2 - 4); c.font = '800 34px "Noto Sans KR",sans-serif'; c.fillText('대한민국 법원', w / 2, h / 2 + 56); }) }), gold]);
  emblem.rotation.x = Math.PI / 2; emblem.position.set(0, 3.9, -D / 2 + 0.1); g.add(emblem);
  // 판사석: 높은 단 + 패널 책상 + 높은 등받이 의자 3개
  box(g, wood, 9, 0.9, 2.4, 0, 0.45, -6.1); box(g, wPanel, 9, 1.0, 0.12, 0, 1.4, -4.95); box(g, wood, 9.2, 0.07, 0.75, 0, 1.92, -5.2);
  for (const x of [-2.4, 0, 2.4]) { box(g, leather, 0.7, 0.12, 0.65, x, 1.4, -6.3); const back = box(g, leather, 0.72, 1.3, 0.12, x, 2.05, -6.7); back.rotation.x = -0.06; box(g, gold, 0.3, 0.06, 0.02, x, 1.99, -4.88); }
  // 참여관(서기) 책상 + 모니터
  box(g, wood, 4, 0.8, 0.8, 0, 0.4, -4.1); box(g, M({ color: 0x111 }), 0.5, 0.35, 0.04, -0.8, 1.0, -4.2);
  // 검사석(왼쪽) · 변호인석(오른쪽) + 명패 + 마이크
  const plate = (txt) => M({ map: ctex(256, 64, (c, w, h) => { c.fillStyle = '#1c1c1c'; c.fillRect(0, 0, w, h); c.fillStyle = '#d4af37'; c.font = '900 40px "Noto Sans KR",sans-serif'; c.textAlign = 'center'; c.fillText(txt, w / 2, 46); }) });
  for (const [x, txt] of [[-4.2, '검 사'], [4.2, '변호인']]) {
    box(g, wood, 3.2, 0.78, 1.0, x, 0.39, -1.6); box(g, wood, 3.3, 0.06, 1.1, x, 0.8, -1.6);
    const pl = box(g, plate(txt), 0.6, 0.15, 0.04, x, 0.92, -1.0); pl.rotation.x = -0.4;
    box(g, M({ color: 0x111 }), 0.02, 0.35, 0.02, x + 0.5, 1.0, -1.4);
    for (const dx of [-0.7, 0.7]) { box(g, leather, 0.55, 0.1, 0.55, x + dx, 0.5, -0.6); box(g, leather, 0.55, 0.7, 0.1, x + dx, 0.9, -0.35); }
    box(g, M({ color: 0xf4f4f0 }), 0.32, 0.02, 0.45, x - 0.6, 0.835, -1.7);
  }
  // 증인석 (가운데)
  box(g, wood, 1.4, 1.05, 0.9, 0, 0.525, -2.4); box(g, M({ color: 0x111 }), 0.02, 0.3, 0.02, 0, 1.2, -2.5);
  // 방청석 칸막이 + 긴 의자
  box(g, wood, 6.2, 0.95, 0.08, -4.3, 0.475, 1.6); box(g, wood, 6.2, 0.95, 0.08, 4.3, 0.475, 1.6); box(g, wood, 6.4, 0.06, 0.15, -4.3, 0.98, 1.6); box(g, wood, 6.4, 0.06, 0.15, 4.3, 0.98, 1.6);
  for (let r = 0; r < 4; r++) for (const sx of [-4, 4]) { box(g, wood, 5.6, 0.08, 0.5, sx, 0.46, 2.8 + r * 1.2); box(g, wood, 5.6, 0.7, 0.07, sx, 0.8, 3.05 + r * 1.2); box(g, wood, 0.07, 0.42, 0.45, sx - 2.7, 0.21, 2.8 + r * 1.2); box(g, wood, 0.07, 0.42, 0.45, sx + 2.7, 0.21, 2.8 + r * 1.2); }
  // 시계 · 출입문
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), M({ map: ctex(128, 128, (c, w, h) => { c.fillStyle = '#fff'; c.beginPath(); c.arc(64, 64, 62, 0, 7); c.fill(); c.strokeStyle = '#111'; c.lineWidth = 4; c.stroke(); for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; c.fillRect(64 + Math.cos(a) * 52 - 2, 64 + Math.sin(a) * 52 - 2, 4, 4); } c.lineWidth = 5; c.beginPath(); c.moveTo(64, 64); c.lineTo(64, 26); c.moveTo(64, 64); c.lineTo(92, 70); c.stroke(); }) }));
  clock.position.set(-W / 2 + 0.07, 3.6, -2); clock.rotation.y = Math.PI / 2; g.add(clock);
  box(g, wood, 1.6, 2.6, 0.08, 0, 1.3, D / 2 - 0.06);
  g.userData.seats = { judges: [[-2.4, 0.9, -6.0], [0, 0.9, -6.0], [2.4, 0.9, -6.0]], prosecutor: [-4.2, 0, -0.9], lawyer: [4.9, 0, -0.9], clerk: [0.6, 0, -3.6], guards: [[-1.6, 0, 0.6], [6.6, 0, 1.0]], audience: [[-5.2, 0, 2.6], [-3.3, 0, 3.8], [-4.6, 0, 5.0], [3.2, 0, 2.6], [4.9, 0, 3.8], [3.9, 0, 5.0]] };
  // 교도소 감방
  const p = new THREE.Group(); p.position.copy(PRISON); scene.add(p);
  const conc = M({ color: 0x6f7378, roughness: 0.95 }), bar = M({ color: 0x2a2d31, metalness: 0.8, roughness: 0.35 });
  box(p, conc, 3, 0.02, 3.5, 0, 0, 0); box(p, conc, 3, 3, 0.1, 0, 1.5, -1.75); box(p, conc, 0.1, 3, 3.5, -1.5, 1.5, 0); box(p, conc, 0.1, 3, 3.5, 1.5, 1.5, 0); box(p, conc, 3, 0.02, 3.5, 0, 3, 0);
  for (let i = 0; i < 12; i++) box(p, bar, 0.04, 3, 0.04, -1.4 + i * 0.25, 1.5, 1.75);
  box(p, M({ color: 0x8a8f96, roughness: 0.6 }), 0.9, 0.45, 2, -1.0, 0.22, -0.6); box(p, M({ color: 0xdcdcd2 }), 0.85, 0.1, 1.9, -1.0, 0.5, -0.6);
  const pl = new THREE.PointLight(0xcfd8ff, 4, 6, 1.6); pl.position.set(0, 2.7, 0); p.add(pl);
  return { court: g, prison: p };
}
