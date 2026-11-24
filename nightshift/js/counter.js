// 계산대 장비: 포스기(모니터·손님용 화면), 영수증 프린터, 카드 단말기, 핸드 스캐너+거치대, 돈통(지폐칸·동전컵), 가림막, 껌 진열대
import * as THREE from 'three';
import { productMesh } from './products.js';

const FONT = '"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
const M = (o) => new THREE.MeshStandardMaterial({ roughness: 0.5, envMapIntensity: 0.6, ...o });
function ctex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
const box = (sx, sy, sz, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); return m; };
const rbox = (sx, sy, sz, r, mat) => { // 모서리 둥근 상자
  const s = new THREE.Shape(), w = sz / 2 - r, h = sy / 2 - r;
  s.moveTo(-w, -sy / 2); s.lineTo(w, -sy / 2); s.quadraticCurveTo(sz / 2, -sy / 2, sz / 2, -h); s.lineTo(sz / 2, h); s.quadraticCurveTo(sz / 2, sy / 2, w, sy / 2);
  s.lineTo(-w, sy / 2); s.quadraticCurveTo(-sz / 2, sy / 2, -sz / 2, h); s.lineTo(-sz / 2, -h); s.quadraticCurveTo(-sz / 2, -sy / 2, -w, -sy / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: sx, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -sx / 2); g.rotateY(Math.PI / 2); return new THREE.Mesh(g, mat);
};
export const BILL_COL = { 1000: ['#a9c6e8', '#5f88b8'], 5000: ['#f2c39a', '#c97a4a'], 10000: ['#b9dcae', '#6fa25f'], 50000: ['#f5dd8e', '#d0a23b'] };
const billTexCache = {};
export function billTex(d) {
  if (billTexCache[d]) return billTexCache[d];
  const col = BILL_COL[d];
  return (billTexCache[d] = ctex(512, 240, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, col[0]); gr.addColorStop(1, col[1]); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.04})`; g.beginPath(); g.arc(w * 0.35, h * 0.5, 20 + i * 4, 0, 7); g.stroke(); }
    g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(w * 0.78, h * 0.5, 62, 80, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(w * 0.36, h * 0.52, 58, 74, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(0,0,0,.65)'; g.font = `900 60px ${FONT}`; g.fillText(d.toLocaleString(), 28, 76); g.font = `800 28px ${FONT}`; g.fillText('한국은행', 30, h - 34);
    g.font = `700 22px monospace`; g.fillText('AA ' + (1e6 + Math.random() * 8e6 | 0) + ' A', w - 250, h - 30);
  }));
}
const billGeo = new THREE.BoxGeometry(0.148, 0.0012, 0.068);
export function billMesh(d) { const t = billTex(d); const side = M({ color: BILL_COL[d][1] }); return new THREE.Mesh(billGeo, [side, side, M({ map: t, roughness: 0.8 }), M({ map: t, roughness: 0.8 }), side, side]); }
const coinMat = { 10: M({ color: 0xc98d4c, metalness: 0.9, roughness: 0.35 }), 50: M({ color: 0xd9dcdf, metalness: 0.9, roughness: 0.3 }), 100: M({ color: 0xd9dcdf, metalness: 0.9, roughness: 0.3 }), 500: M({ color: 0xe2e4e6, metalness: 0.9, roughness: 0.28 }) };
const coinR = { 10: 0.009, 50: 0.0108, 100: 0.012, 500: 0.0132 };
export function coinMesh(d, n = 1) { const m = new THREE.Mesh(new THREE.CylinderGeometry(coinR[d], coinR[d], 0.0016 * n, 24), coinMat[d]); return m; }

export function buildCounter(root, CH) {
  const dark = M({ color: 0x1c1f24, roughness: 0.45, metalness: 0.3 }), black = M({ color: 0x0f1012, roughness: 0.35, metalness: 0.2 }), grey = M({ color: 0x8a9098, roughness: 0.4, metalness: 0.6 });
  const out = {};
  // ── 포스기: 받침 + 기울어진 터치 모니터 + 손님용 화면 ──
  const pos = new THREE.Group(); pos.position.set(2.8, CH, 0.12);
  pos.add(box(0.2, 0.03, 0.24, dark, 0, 0.015, 0));
  const arm = box(0.04, 0.2, 0.06, grey, 0.02, 0.12, 0); pos.add(arm);
  const mon = new THREE.Group(); mon.position.set(0.0, 0.27, 0); mon.rotation.z = -0.32; pos.add(mon);
  mon.add(rbox(0.035, 0.3, 0.42, 0.012, black));
  const posScreenTex = new THREE.CanvasTexture(Object.assign(document.createElement('canvas'), { width: 640, height: 460 })); posScreenTex.colorSpace = THREE.SRGBColorSpace;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.39, 0.27), new THREE.MeshBasicMaterial({ map: posScreenTex, toneMapped: false })); scr.position.x = 0.0185; scr.rotation.y = Math.PI / 2; mon.add(scr);
  const cust = new THREE.Group(); cust.position.set(-0.06, 0.24, 0.13); pos.add(cust);
  cust.add(rbox(0.03, 0.12, 0.2, 0.01, black));
  const custTex = new THREE.CanvasTexture(Object.assign(document.createElement('canvas'), { width: 320, height: 180 })); custTex.colorSpace = THREE.SRGBColorSpace;
  const custScr = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.1), new THREE.MeshBasicMaterial({ map: custTex, toneMapped: false })); custScr.position.x = -0.0165; custScr.rotation.y = -Math.PI / 2; cust.add(custScr);
  root.add(pos);
  // ── 영수증 프린터 ──
  const prn = new THREE.Group(); prn.position.set(2.8, CH, -0.2);
  prn.add(rbox(0.16, 0.12, 0.13, 0.015, M({ color: 0x2a2d31, roughness: 0.6 })));
  prn.children[0].position.y = 0.06;
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 1), M({ color: 0xfafafa, roughness: 0.9, side: THREE.DoubleSide }));
  paper.geometry.translate(0, 0.5, 0); paper.position.set(-0.04, 0.12, 0); paper.rotation.set(0, Math.PI / 2, -0.5); paper.scale.y = 0.02; prn.add(paper);
  root.add(prn); out.paper = paper;
  // ── 카드 단말기 (손님 쪽, 키패드·화면·투입구) ──
  const rd = new THREE.Group(); rd.position.set(2.43, CH, 0.42); rd.rotation.y = 0.15;
  rd.add(box(0.1, 0.02, 0.1, dark, 0, 0.01, 0));
  const body = rbox(0.085, 0.17, 0.085, 0.012, black); body.position.set(0, 0.1, 0); body.rotation.z = 0.35; rd.add(body);
  const keyTex = ctex(160, 320, (g, w, h) => {
    g.fillStyle = '#111'; g.fillRect(0, 0, w, h); g.fillStyle = '#7fd0ff'; g.fillRect(14, 14, w - 28, 96);
    g.fillStyle = '#0b2a40'; g.font = `800 20px ${FONT}`; g.fillText('카드를', 30, 52); g.fillText('넣어주세요', 30, 82);
    const k = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
    k.forEach((t, i) => { const x = 18 + (i % 3) * 44, y = 128 + Math.floor(i / 3) * 40; g.fillStyle = '#3a3d42'; g.fillRect(x, y, 36, 30); g.fillStyle = '#eee'; g.font = `700 18px ${FONT}`; g.fillText(t, x + 12, y + 22); });
    [['#c33', 18], ['#cc3', 62], ['#3a3', 106]].forEach(([c, x]) => { g.fillStyle = c; g.fillRect(x, 290, 36, 20); });
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.16), new THREE.MeshBasicMaterial({ map: keyTex }));
  face.position.set(-0.0445, 0, 0); face.rotation.y = -Math.PI / 2; body.add(face);
  const slot = box(0.01, 0.006, 0.07, M({ color: 0x050505 }), -0.03, -0.088, 0); body.add(slot);
  root.add(rd); out.reader = rd; out.readerBody = body;
  out.readerSlot = () => body.localToWorld(new THREE.Vector3(-0.02, -0.08, 0));
  const scrCan = keyTex.image; out.readerMsg = (txt, col = '#7fd0ff') => { const g = scrCan.getContext('2d'); g.fillStyle = col; g.fillRect(14, 14, 132, 96); g.fillStyle = '#0b2a40'; g.font = `800 20px ${FONT}`; txt.split('\n').forEach((t, i) => g.fillText(t, 26, 52 + i * 30)); keyTex.needsUpdate = true; };
  // ── 핸드 스캐너 + 거치대 ──
  const stand = new THREE.Group(); stand.position.set(2.78, CH, 1.62); root.add(stand);
  stand.add(box(0.08, 0.015, 0.08, dark, 0, 0.0075, 0));
  const cradle = box(0.03, 0.09, 0.05, dark, 0.01, 0.05, 0); cradle.rotation.z = -0.3; stand.add(cradle);
  const gun = new THREE.Group();
  const gm = M({ color: 0x1a1c1f, roughness: 0.45 }), ym = M({ color: 0xf2c230, roughness: 0.4 });
  const head = rbox(0.13, 0.055, 0.06, 0.014, gm); head.position.set(-0.03, 0.115, 0); gun.add(head);
  const grip = rbox(0.045, 0.12, 0.04, 0.012, gm); grip.position.set(0.01, 0.05, 0); grip.rotation.z = -0.35; gun.add(grip);
  const trig = box(0.015, 0.03, 0.02, ym, -0.022, 0.075, 0); gun.add(trig);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.035), new THREE.MeshBasicMaterial({ color: 0x551111 })); win.position.set(-0.097, 0.115, 0); win.rotation.y = -Math.PI / 2; gun.add(win);
  const laser = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.004), new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }));
  laser.geometry.translate(-0.25, 0, 0); laser.position.set(-0.098, 0.115, 0); laser.rotation.x = Math.PI / 2; laser.visible = false; gun.add(laser);
  gun.position.set(0.01, 0.0, 0); stand.add(gun);
  out.scanner = { stand, gun, win, laser, home: () => { stand.add(gun); gun.position.set(0.01, 0, 0); gun.rotation.set(0, 0, 0); } };
  // ── 돈통 (계산대 아래, 내 쪽으로 열림) ──
  const dr = new THREE.Group(); dr.position.set(2.66, CH - 0.115, 0.12); root.add(dr);
  dr.add(box(0.44, 0.11, 0.44, black, 0, 0, 0));
  const tray = new THREE.Group(); dr.add(tray);
  tray.add(box(0.43, 0.012, 0.42, M({ color: 0x2b2f35, roughness: 0.6 }), 0.005, -0.045, 0));
  tray.add(box(0.012, 0.095, 0.43, dark, 0.22, -0.005, 0)); // 앞판
  const handle = box(0.01, 0.02, 0.12, grey, 0.23, 0.0, 0); tray.add(handle);
  const slots = {};
  [50000, 10000, 5000, 1000].forEach((d, i) => { // 뒤쪽 지폐칸 4개 (+ 누름쇠)
    const z = -0.16 + i * 0.107, stack = new THREE.Group(); stack.position.set(-0.06, -0.037, z); tray.add(stack);
    for (let k = 0; k < 6 + Math.random() * 6; k++) { const b = billMesh(d); b.rotation.y = Math.PI / 2 + (Math.random() - 0.5) * 0.04; b.position.y = k * 0.0013; stack.add(b); }
    tray.add(box(0.2, 0.06, 0.004, dark, -0.06, -0.01, z - 0.052));
    const clip = box(0.12, 0.004, 0.02, grey, -0.04, 0.0, z); clip.rotation.z = -0.05; tray.add(clip);
    slots[d] = stack;
  });
  [500, 100, 50, 10].forEach((d, i) => { // 앞쪽 동전컵 4개
    const z = -0.15 + i * 0.1, cup = new THREE.Group(); cup.position.set(0.14, -0.038, z); tray.add(cup);
    cup.add(box(0.09, 0.004, 0.085, dark, 0, 0, 0)); cup.add(box(0.09, 0.05, 0.004, dark, 0, 0.025, 0.043)); cup.add(box(0.09, 0.05, 0.004, dark, 0, 0.025, -0.043));
    for (let k = 0; k < 7; k++) { const c = coinMesh(d, 3 + (Math.random() * 6 | 0)); c.position.set((Math.random() - 0.5) * 0.05, 0.006, (Math.random() - 0.5) * 0.05); c.rotation.set((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4); cup.add(c); }
    slots[d] = cup;
  });
  out.drawer = { group: dr, tray, slots, open: 0 };
  // ── 손님 쪽 가림막(아크릴) + 껌·사탕 진열대 + 봉투 안내 ──
  const shield = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), M({ color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4 }));
  shield.position.set(2.33, CH + 0.42, -0.35); shield.rotation.y = Math.PI / 2; root.add(shield);
  const frameM = M({ color: 0xdfe3e8, roughness: 0.3, metalness: 0.5 });
  root.add(box(0.012, 0.012, 1.1, frameM, 2.33, CH + 0.7, -0.35), box(0.04, 0.02, 0.03, frameM, 2.33, CH + 0.15, -0.88), box(0.04, 0.02, 0.03, frameM, 2.33, CH + 0.15, 0.18));
  const rack = new THREE.Group(); rack.position.set(2.42, CH, 1.95); root.add(rack);
  for (let r = 0; r < 3; r++) {
    rack.add(box(0.1, 0.006, 0.36, M({ color: 0xffffff, roughness: 0.3, transparent: true, opacity: 0.55 }), r * 0.035, 0.03 + r * 0.05, 0));
    for (let i = 0; i < 4; i++) { const p = productMesh(['gum', 'battery', 'condom', 'gum'][(i + r) % 4]); p.scale.setScalar(0.85); p.position.set(r * 0.035, 0.033 + r * 0.05, -0.13 + i * 0.087); p.rotation.y = -Math.PI / 2; rack.add(p); }
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), new THREE.MeshStandardMaterial({ roughness: 0.4, map: ctex(256, 160, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#1f2d4a'; g.fillRect(0, 0, w, 40); g.fillStyle = '#fff'; g.font = `800 24px ${FONT}`; g.fillText('안내', 12, 29); g.fillStyle = '#111'; g.font = `800 22px ${FONT}`; g.fillText('봉투는 유상 판매', 12, 82); g.fillText('(1장 100원)', 12, 118); }) }));
  sign.position.set(2.36, CH + 0.06, -0.85); sign.rotation.set(0, -Math.PI / 2, 0); root.add(sign);
  const san = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.16, 16), M({ color: 0xe8f4ff, transparent: true, opacity: 0.6, roughness: 0.05 })); san.position.set(2.42, CH + 0.08, -0.6); root.add(san);
  const pump = box(0.02, 0.04, 0.05, M({ color: 0xffffff }), 2.42, CH + 0.18, -0.6); root.add(pump);
  // 내 쪽 계산대 아래 봉투 걸이
  const bagM = M({ color: 0xf6f6f4, roughness: 0.7, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), bagM); b.position.set(2.88, CH - 0.33, 1.2 + i * 0.012); b.rotation.y = Math.PI / 2; root.add(b); }
  Object.assign(out, { pos, posScreenTex, custTex, monitor: mon, printer: prn });
  return out;
}

// 포스 화면 (모니터에 그리는 실제 POS 화면)
export function drawPos(tex, custTex, st) {
  const c = tex.image, g = c.getContext('2d'), w = c.width, h = c.height;
  g.fillStyle = '#eef2f6'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1f2d4a'; g.fillRect(0, 0, w, 44); g.fillStyle = '#ffc53d'; g.font = `900 22px ${FONT}`; g.fillText('달빛24', 14, 30);
  g.fillStyle = '#fff'; g.font = `600 18px ${FONT}`; g.fillText(`POS 01  ·  ${st.clock || ''}  ·  ${st.staff || ''}`, 110, 29);
  g.fillStyle = '#fff'; g.fillRect(10, 54, w * 0.62, h - 64); g.strokeStyle = '#c9d2dc'; g.strokeRect(10, 54, w * 0.62, h - 64);
  g.fillStyle = '#294a78'; g.fillRect(10, 54, w * 0.62, 28); g.fillStyle = '#fff'; g.font = `700 15px ${FONT}`; g.fillText('상품명', 20, 74); g.fillText('수량', w * 0.43, 74); g.fillText('금액', w * 0.54, 74);
  g.font = `600 16px ${FONT}`;
  (st.items || []).slice(-11).forEach((it, i) => { const y = 104 + i * 30; g.fillStyle = i % 2 ? '#f4f7fa' : '#fff'; g.fillRect(11, y - 20, w * 0.62 - 2, 30); g.fillStyle = '#111'; g.fillText(it.name.slice(0, 13), 20, y); g.fillText(String(it.qty), w * 0.45, y); g.textAlign = 'right'; g.fillText(it.price.toLocaleString(), w * 0.62, y); g.textAlign = 'left'; });
  const R = (y, label, val, col) => { g.fillStyle = '#fff'; g.fillRect(w * 0.65, y, w * 0.33, 64); g.strokeStyle = '#c9d2dc'; g.strokeRect(w * 0.65, y, w * 0.33, 64); g.fillStyle = '#556'; g.font = `700 15px ${FONT}`; g.fillText(label, w * 0.67, y + 20); g.fillStyle = col; g.font = `900 30px ${FONT}`; g.textAlign = 'right'; g.fillText(val, w * 0.97, y + 54); g.textAlign = 'left'; };
  R(54, '합계', (st.total || 0).toLocaleString(), '#1d4f8f'); R(126, '받은 금액', st.recv ? st.recv.toLocaleString() : '-', '#333'); R(198, '거스름돈', st.change != null ? st.change.toLocaleString() : '-', '#c0392b');
  g.fillStyle = st.msgCol || '#1d9e5b'; g.fillRect(w * 0.65, 274, w * 0.33, 60); g.fillStyle = '#fff'; g.font = `800 20px ${FONT}`; g.fillText(st.msg || '대기 중', w * 0.67, 311);
  ['현금', '카드', '봉투', '연령확인'].forEach((t, i) => { const x = w * 0.65 + (i % 2) * (w * 0.165), y = 344 + Math.floor(i / 2) * 52; g.fillStyle = ['#2467c9', '#1d9e5b', '#7a8796', '#c0392b'][i]; g.fillRect(x, y, w * 0.16, 46); g.fillStyle = '#fff'; g.font = `800 17px ${FONT}`; g.fillText(t, x + 12, y + 29); });
  tex.needsUpdate = true;
  if (custTex) { const c2 = custTex.image.getContext('2d'); c2.fillStyle = '#0d1b2a'; c2.fillRect(0, 0, 320, 180); c2.fillStyle = '#7fe3ff'; c2.font = `700 22px ${FONT}`; c2.fillText('결제하실 금액', 18, 50); c2.fillStyle = '#fff'; c2.font = `900 50px ${FONT}`; c2.textAlign = 'right'; c2.fillText((st.total || 0).toLocaleString() + '원', 305, 130); c2.textAlign = 'left'; custTex.needsUpdate = true; }
}
