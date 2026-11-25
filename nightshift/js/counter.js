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
const C3 = (r, l, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 16), mat); m.position.set(x, y, z); return m; };
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
  // ── 포스기: 본체(통풍구·전원 LED·카드 긁는 홈) + 경첩 받침 + 15인치 터치 모니터(유리 + 베젤 로고) + 손님용 화면(기둥) ──
  const pos = new THREE.Group(); pos.position.set(2.8, CH, 0.12);
  const shell = M({ color: 0x24272c, roughness: 0.38, metalness: 0.15 }), glass = new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.18, envMapIntensity: 1.5 });
  const ventT = ctex(256, 128, (g, w, h) => { g.fillStyle = '#26292e'; g.fillRect(0, 0, w, h); for (let x = 16; x < w - 16; x += 10) { g.fillStyle = '#0b0c0e'; g.fillRect(x, 30, 5, h - 60); } });
  const base = rbox(0.24, 0.07, 0.3, 0.02, shell); base.position.set(-0.01, 0.035, 0); pos.add(base);
  const vent = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.04), M({ map: ventT, roughness: 0.6 })); vent.position.set(0.111, 0.035, 0); vent.rotation.y = Math.PI / 2; pos.add(vent);
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.003, 10), new THREE.MeshBasicMaterial({ color: 0x33ff88, toneMapped: false })); led.position.set(0.1115, 0.035, 0.12); led.rotation.y = Math.PI / 2; pos.add(led);
  pos.add(box(0.2, 0.012, 0.006, M({ color: 0x08090a }), -0.01, 0.06, -0.152)); // 옆 카드 홈
  const neck = box(0.035, 0.15, 0.07, M({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.7 }), -0.075, 0.14, 0); neck.rotation.z = 0.3; pos.add(neck);
  pos.add(C3(0.022, 0.1, -0.075, 0.22, 0, shell));
  const mon = new THREE.Group(); mon.position.set(-0.04, 0.28, 0); mon.rotation.z = 0.3; pos.add(mon);
  mon.add(rbox(0.04, 0.31, 0.43, 0.014, black));
  const posScreenTex = new THREE.CanvasTexture(Object.assign(document.createElement('canvas'), { width: 900, height: 620 })); posScreenTex.colorSpace = THREE.SRGBColorSpace; posScreenTex.anisotropy = 8;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.39, 0.268), new THREE.MeshBasicMaterial({ map: posScreenTex, toneMapped: false })); scr.position.set(0.0255, 0.008, 0); scr.rotation.y = Math.PI / 2; mon.add(scr);
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.41, 0.29), glass); gl.position.set(0.0262, 0.0, 0); gl.rotation.y = Math.PI / 2; mon.add(gl);
  const bz = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.012), new THREE.MeshBasicMaterial({ map: ctex(256, 40, (g, w, h) => { g.fillStyle = '#0f1012'; g.fillRect(0, 0, w, h); g.fillStyle = '#9aa3ad'; g.font = `800 26px ${FONT}`; g.textAlign = 'center'; g.fillText('DALBIT POS', w / 2, 30); }) })); bz.position.set(0.0256, -0.141, 0); bz.rotation.y = Math.PI / 2; mon.add(bz);
  const pled = new THREE.Mesh(new THREE.CircleGeometry(0.0025, 8), new THREE.MeshBasicMaterial({ color: 0x3aa0ff, toneMapped: false })); pled.position.set(0.0256, -0.141, 0.19); pled.rotation.y = Math.PI / 2; mon.add(pled);
  // 손님용 화면: 본체 뒤 기둥 위
  pos.add(C3(0.012, 0.22, -0.11, 0.18, 0.1, M({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.7 })));
  const cust = new THREE.Group(); cust.position.set(-0.12, 0.31, 0.1); cust.rotation.z = 0.12; pos.add(cust);
  cust.add(rbox(0.03, 0.13, 0.22, 0.01, black));
  const custTex = new THREE.CanvasTexture(Object.assign(document.createElement('canvas'), { width: 320, height: 180 })); custTex.colorSpace = THREE.SRGBColorSpace;
  const custScr = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.105), new THREE.MeshBasicMaterial({ map: custTex, toneMapped: false })); custScr.position.x = -0.0205; custScr.rotation.y = -Math.PI / 2; cust.add(custScr);
  root.add(pos);
  // ── POS 키보드(계산기처럼 숫자·기능 키) : 모니터 앞, 내 쪽 ──
  const kb = new THREE.Group(); kb.position.set(2.86, CH, -0.12); kb.rotation.y = Math.PI / 2; root.add(kb);
  const kbBody = rbox(0.17, 0.025, 0.3, 0.01, shell); kbBody.rotation.y = Math.PI / 2; kbBody.position.y = 0.0125; kbBody.rotation.x = 0; kb.add(kbBody);
  const KEYS = [['취소', '보류', '7', '8', '9'], ['담배', '봉투', '4', '5', '6'], ['할인', '반품', '1', '2', '3'], ['현금', '카드', '0', '00', '합계']];
  const keyCol = { 현금: '#2467c9', 카드: '#1d9e5b', 합계: '#e08a1e', 취소: '#c0392b' };
  const kTex = {};
  const keyMat = (t) => kTex[t] ||= M({ roughness: 0.5, map: ctex(64, 64, (g, w, h) => { g.fillStyle = keyCol[t] || (/\d/.test(t) ? '#e9ecef' : '#5b6470'); g.fillRect(0, 0, w, h); g.fillStyle = keyCol[t] || !/\d/.test(t) ? '#fff' : '#111'; g.font = `800 ${t.length > 1 && !/\d/.test(t) ? 20 : 30}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, w / 2, h / 2 + 2); }) });
  const capG = new THREE.BoxGeometry(0.048, 0.012, 0.03); capG.translate(0, 0.006, 0);
  KEYS.forEach((row, r) => row.forEach((t, c) => { const side = M({ color: keyCol[t] ? new THREE.Color(keyCol[t]).multiplyScalar(0.7) : (/\d/.test(t) ? 0xc9cdd2 : 0x434a54), roughness: 0.6 }); const k = new THREE.Mesh(capG, [side, side, keyMat(t), side, side, side]); k.position.set(-0.12 + c * 0.058, 0.025, -0.055 + r * 0.037); kb.add(k); }));
  // ── 탁상 계산기 (태양전지·LCD·키) : 프린터 옆 ──
  const calc = new THREE.Group(); calc.position.set(2.82, CH, -0.55); calc.rotation.set(0, Math.PI / 2 - 0.25, 0); root.add(calc);
  const cBody = rbox(0.11, 0.022, 0.16, 0.012, M({ color: 0x2b2e33, roughness: 0.45 })); cBody.rotation.y = Math.PI / 2; cBody.position.y = 0.011; calc.add(cBody);
  const lcdC = document.createElement('canvas'); lcdC.width = 256; lcdC.height = 64; const lcdT = new THREE.CanvasTexture(lcdC); lcdT.colorSpace = THREE.SRGBColorSpace;
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.022), M({ map: lcdT, roughness: 0.25 })); lcd.rotation.x = -Math.PI / 2 + 0.25; lcd.position.set(0, 0.027, -0.05); calc.add(lcd);
  const solar = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.012), M({ color: 0x3a2a1e, roughness: 0.2, metalness: 0.4 })); solar.rotation.x = -Math.PI / 2; solar.position.set(0.02, 0.0225, -0.072); calc.add(solar);
  const CK = [['C', '√', '%', '÷'], ['7', '8', '9', '×'], ['4', '5', '6', '−'], ['1', '2', '3', '+'], ['0', '00', '.', '=']];
  const cCap = new THREE.BoxGeometry(0.017, 0.007, 0.013); cCap.translate(0, 0.0035, 0);
  CK.forEach((row, r) => row.forEach((t, c) => { const col = t === 'C' ? '#c0392b' : t === '=' ? '#e08a1e' : /\d|\./.test(t) ? '#3a3f46' : '#596270'; const m = M({ roughness: 0.55, map: ctex(48, 48, (g, w, h) => { g.fillStyle = col; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = `700 26px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, w / 2, h / 2 + 2); }) }); const sd = M({ color: 0x1a1c20 }); const k = new THREE.Mesh(cCap, [sd, sd, m, sd, sd, sd]); k.position.set(-0.03 + c * 0.02, 0.022, -0.026 + r * 0.0185); calc.add(k); }));
  posScreenTex.userData.calc = (n) => { const g = lcdC.getContext('2d'); g.fillStyle = '#a9b59a'; g.fillRect(0, 0, 256, 64); g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(0, 0, 256, 8); g.fillStyle = '#1b2016'; g.font = '700 44px "DSEG7 Classic", monospace'; g.textAlign = 'right'; g.fillText((n || 0).toLocaleString('en-US') + '.', 246, 50); lcdT.needsUpdate = true; };
  posScreenTex.userData.calc(0);
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

// 포스 화면: 실제 편의점 POS 프로그램처럼 (상단 정보줄, 판매 목록 표, 합계 영역, 결제·기능 버튼, 하단 상태줄)
export function drawPos(tex, custTex, st) {
  const c = tex.image, g = c.getContext('2d'), w = c.width, h = c.height, F = (wt, px) => (g.font = `${wt} ${px}px ${FONT}`);
  const rr = (x, y, ww, hh, r, col) => { g.fillStyle = col; g.beginPath(); g.roundRect ? g.roundRect(x, y, ww, hh, r) : g.rect(x, y, ww, hh); g.fill(); };
  g.fillStyle = '#dfe5ec'; g.fillRect(0, 0, w, h);
  // 상단
  const tg = g.createLinearGradient(0, 0, 0, 50); tg.addColorStop(0, '#22345a'); tg.addColorStop(1, '#172440'); g.fillStyle = tg; g.fillRect(0, 0, w, 50);
  g.fillStyle = '#ffc53d'; F(900, 24); g.fillText('달빛24', 16, 33); g.fillStyle = '#cfd8e3'; F(600, 15);
  g.fillText(`마포점  │  POS 01  │  판매원 ${st.staff || ''}  │  영업일자 2026-11-25`, 112, 31);
  g.textAlign = 'right'; g.fillStyle = '#fff'; F(800, 20); g.fillText(st.clock || '', w - 16, 33); g.textAlign = 'left';
  // 판매 목록
  const LW = w * 0.64, top = 60;
  g.fillStyle = '#fff'; g.fillRect(10, top, LW, h - top - 150);
  g.fillStyle = '#3b5b8c'; g.fillRect(10, top, LW, 30); g.fillStyle = '#fff'; F(700, 15);
  const cols = [['No', 20], ['상품명', 62], ['단가', LW * 0.6], ['수량', LW * 0.74], ['금액', LW * 0.86]];
  cols.forEach(([t, x]) => g.fillText(t, x, top + 21));
  const items = (st.items || []).slice(-10), n0 = Math.max(0, (st.items || []).length - 10);
  F(600, 17);
  items.forEach((it, i) => {
    const y = top + 30 + i * 34; g.fillStyle = i === items.length - 1 ? '#fff5d6' : i % 2 ? '#f3f6f9' : '#fff'; g.fillRect(11, y, LW - 2, 34);
    g.fillStyle = '#222'; g.fillText(String(n0 + i + 1), 22, y + 23); g.fillText(it.name.slice(0, 14), 62, y + 23);
    g.textAlign = 'right'; g.fillText(Math.round(it.price / it.qty).toLocaleString(), LW * 0.7, y + 23); g.fillText(String(it.qty), LW * 0.8, y + 23); g.fillStyle = '#1d4f8f'; F(800, 17); g.fillText(it.price.toLocaleString(), LW + 2, y + 23); F(600, 17); g.textAlign = 'left';
  });
  if (!items.length) { g.fillStyle = '#9aa6b2'; F(600, 18); g.fillText('상품 바코드를 스캔해 주세요', 30, top + 80); }
  // 합계 영역 (왼쪽 아래)
  const sy = h - 82;
  rr(10, h - 142, LW, 54, 6, '#22345a'); g.fillStyle = '#9fb0c4'; F(700, 15); g.fillText(`총 수량 ${(st.items || []).reduce((a, i) => a + i.qty, 0)}`, 22, h - 110);
  g.fillText('할인 0', 140, h - 110); g.fillStyle = '#fff'; F(700, 17); g.fillText('받을 금액', LW * 0.42, h - 108);
  g.textAlign = 'right'; g.fillStyle = '#ffd36b'; F(900, 34); g.fillText((st.total || 0).toLocaleString() + '원', LW, h - 102); g.textAlign = 'left';
  const box2 = (x, label, val, col) => { rr(x, sy, LW / 2 - 4, 50, 6, '#fff'); g.fillStyle = '#6b7785'; F(700, 14); g.fillText(label, x + 10, sy + 19); g.textAlign = 'right'; g.fillStyle = col; F(900, 24); g.fillText(val, x + LW / 2 - 14, sy + 42); g.textAlign = 'left'; };
  box2(10, '받은 금액', st.recv ? st.recv.toLocaleString() : '0', '#333'); box2(10 + LW / 2 + 4, '거스름돈', st.change != null ? st.change.toLocaleString() : '0', '#c0392b');
  // 오른쪽: 상태 + 기능 버튼
  const RX = LW + 20, RW = w - RX - 10;
  rr(RX, top, RW, 56, 6, st.msgCol || '#1d9e5b'); g.fillStyle = '#fff'; F(800, 21); g.fillText(st.msg || '대기 중', RX + 12, top + 36);
  const BT = [['현금결제', '#2467c9'], ['신용카드', '#1d9e5b'], ['간편결제', '#7b4fc9'], ['현금영수증', '#3a7ca5'], ['봉투', '#7a8796'], ['담배', '#8a5a2b'], ['연령확인', '#c0392b'], ['할인', '#d4801a'], ['보류', '#5b6470'], ['반품', '#5b6470'], ['재발행', '#5b6470'], ['전체취소', '#a8323a']];
  const bw = (RW - 8) / 2, bh = (h - top - 70 - 40) / 6;
  BT.forEach(([t, col], i) => { const x = RX + (i % 2) * (bw + 8), y = top + 66 + Math.floor(i / 2) * bh; const gg = g.createLinearGradient(0, y, 0, y + bh - 6); gg.addColorStop(0, col); gg.addColorStop(1, shade(col)); g.fillStyle = gg; g.beginPath(); g.roundRect ? g.roundRect(x, y, bw, bh - 6, 7) : g.rect(x, y, bw, bh - 6); g.fill(); g.fillStyle = '#fff'; F(800, 16); g.textAlign = 'center'; g.fillText(t, x + bw / 2, y + bh / 2 + 3); g.textAlign = 'left'; });
  // 하단 상태줄
  g.fillStyle = '#172440'; g.fillRect(0, h - 26, w, 26); g.fillStyle = '#7fe3a0'; F(600, 13); g.fillText('● VAN 연결됨   ● 프린터 정상   ● 스캐너 연결', 12, h - 9);
  g.fillStyle = '#ffd36b'; g.textAlign = 'right'; g.fillText('이번 달 행사: 음료 1+1 · 과자 2+1', w - 12, h - 9); g.textAlign = 'left';
  tex.needsUpdate = true;
  tex.userData.calc?.(st.change != null ? st.change : st.total);
  if (custTex) { const c2 = custTex.image.getContext('2d'); c2.fillStyle = '#0d1b2a'; c2.fillRect(0, 0, 320, 180); c2.fillStyle = '#7fe3ff'; c2.font = `700 22px ${FONT}`; c2.fillText('결제하실 금액', 18, 50); c2.fillStyle = '#fff'; c2.font = `900 50px ${FONT}`; c2.textAlign = 'right'; c2.fillText((st.total || 0).toLocaleString() + '원', 305, 130); c2.textAlign = 'left'; custTex.needsUpdate = true; }
}
function shade(hex) { const c = new THREE.Color(hex).multiplyScalar(0.72); return '#' + c.getHexString(); }
