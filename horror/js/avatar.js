// 로블록스 R6 스타일 캐릭터 (AI 친구 · 다른 플레이어)
import * as THREE from 'three';

const S = 0.32;
export const SKINS = [
  { name: '뉴비', head: 0xF5CD30, torso: 0x0D69AC, arms: 0xF5CD30, legs: 0xA4BD47 },
  { name: '빨강 후드', head: 0xEAB892, torso: 0xC4281C, arms: 0xC4281C, legs: 0x1B2A35, hair: 0x3a2414 },
  { name: '분홍', head: 0xF2D3B0, torso: 0xFF66CC, arms: 0xF2D3B0, legs: 0x4F6DA6, hair: 0x1a1010, long: true },
  { name: '주황 모자', head: 0xCC8E69, torso: 0xDA8541, arms: 0xCC8E69, legs: 0x6E6E6E, cap: 0x1E3A8A },
  { name: '보라', head: 0xF5CD30, torso: 0x6B327C, arms: 0xF5CD30, legs: 0x111111, hair: 0xd0b060 },
  { name: '하늘', head: 0xEAB892, torso: 0x5DA9E9, arms: 0xEAB892, legs: 0x2B2B2B, cap: 0xffffff },
  { name: '검정', head: 0xF2D3B0, torso: 0x222222, arms: 0x222222, legs: 0x444444, hair: 0x111111 },
  { name: '노랑', head: 0xCC8E69, torso: 0xF5CD30, arms: 0xCC8E69, legs: 0x8A5A2A, hair: 0x2a1a0a, long: true },
];

let faceT = null;
function faceTex() {
  if (faceT) return faceT;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#000'; for (const x of [100, 156]) { g.beginPath(); g.ellipse(x, 44, 10, 23, 0, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#000'; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.moveTo(84, 82); g.quadraticCurveTo(128, 120, 172, 82); g.stroke();
  faceT = new THREE.CanvasTexture(c); faceT.colorSpace = THREE.SRGBColorSpace; return faceT;
}
function headGeo(r, h) {
  const e = r * 0.38, pts = [new THREE.Vector2(0, -h / 2)];
  for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + i / 5 * Math.PI / 2; pts.push(new THREE.Vector2(r - e + Math.cos(a) * e, -h / 2 + e + Math.sin(a) * e)); }
  for (let i = 0; i <= 5; i++) { const a = i / 5 * Math.PI / 2; pts.push(new THREE.Vector2(r - e + Math.cos(a) * e, h / 2 - e + Math.sin(a) * e)); }
  pts.push(new THREE.Vector2(0, h / 2)); return new THREE.LatheGeometry(pts, 20);
}

export function createAvatar(skin = SKINS[0]) {
  const M = c => new THREE.MeshLambertMaterial({ color: c });
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(2 * S, 2 * S, S), M(skin.torso)); torso.position.y = 3 * S; body.add(torso);
  const head = new THREE.Group(); head.position.y = 4.6 * S; body.add(head);
  head.add(new THREE.Mesh(headGeo(0.62 * S, 1.2 * S), M(skin.head)));
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.62 * S + 0.003, 0.62 * S + 0.003, 0.62 * S, 16, 1, true, -Math.PI / 3, Math.PI * 2 / 3), new THREE.MeshLambertMaterial({ map: faceTex(), transparent: true, depthWrite: false }));
  head.add(face);
  if (skin.hair) { const h = new THREE.Mesh(new THREE.BoxGeometry(1.32 * S, 0.35 * S, 1.32 * S), M(skin.hair)); h.position.y = 0.55 * S; head.add(h); if (skin.long) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.3 * S, 1.3 * S, 0.3 * S), M(skin.hair)); b.position.set(0, -0.1 * S, -0.6 * S); head.add(b); } }
  if (skin.cap) { const cp = new THREE.Mesh(new THREE.CylinderGeometry(0.66 * S, 0.66 * S, 0.3 * S, 16), M(skin.cap)); cp.position.y = 0.62 * S; head.add(cp); const br = new THREE.Mesh(new THREE.BoxGeometry(0.9 * S, 0.06 * S, 0.6 * S), M(skin.cap)); br.position.set(0, 0.5 * S, 0.7 * S); head.add(br); }
  const limb = (m, x, y, top) => { const p = new THREE.Group(); p.position.set(x, y, 0); body.add(p); const b = new THREE.Mesh(new THREE.BoxGeometry(S * 0.98, 2 * S, S * 0.98), m); b.position.y = -S * top; p.add(b); return p; };
  const armL = limb(M(skin.arms), -1.5 * S, 3.5 * S, 0.5), armR = limb(M(skin.arms), 1.5 * S, 3.5 * S, 0.5);
  const legL = limb(M(skin.legs), -0.5 * S, 2 * S, 1), legR = limb(M(skin.legs), 0.5 * S, 2 * S, 1);
  const tag = new THREE.Object3D(); tag.position.y = 5.6 * S; body.add(tag);
  const st = { ph: 0, aL: 0, aR: 0, lL: 0, lR: 0, rx: 0, y: 0, hurt: 0 };
  return {
    root, body, head, tag, armL, armR, legL, legR,
    update(dt, speed = 0, pose = 'stand', wave = false) {
      let tAL = 0, tAR = 0, tLL = 0, tLR = 0, tRX = 0, tY = 0; const k = Math.min(1, dt * 10);
      const run = speed > 3;
      if (pose === 'prone') { tRX = Math.PI / 2; tY = 0.17; st.ph += dt * speed * 6; const s = Math.sin(st.ph) * 0.5; tAL = -2.6 + s; tAR = -2.6 - s; tLL = s * 0.3; tLR = -s * 0.3; }
      else if (pose === 'dead') { tRX = Math.PI / 2 * 0.98; tY = 0.17; tAL = -0.4; tAR = 0.3; }
      else if (pose === 'crouch') { tY = -0.32; tLL = -1.1; tLR = -1.1; tRX = 0.25; if (speed > 0.1) { st.ph += dt * speed * 4; const s = Math.sin(st.ph) * 0.4; tLL += s; tLR -= s; } tAL = -0.5; tAR = -0.5; }
      else if (speed > 0.15) { st.ph += dt * speed * (run ? 2.4 : 3.1); const amp = run ? 1.0 : 0.62, s = Math.sin(st.ph) * amp; tLL = s; tLR = -s; tAL = -s; tAR = s; tY = run ? Math.abs(Math.cos(st.ph)) * 0.05 : 0; }
      else { st.ph += dt; const s = Math.sin(st.ph * 1.4) * 0.05; tAL = s; tAR = -s; }
      if (wave) { tAR = -2.8 + Math.sin(performance.now() / 120) * 0.3; }
      if (st.hurt > 0) { st.hurt -= dt; tRX += Math.sin(st.hurt * 30) * 0.2; }
      st.aL += (tAL - st.aL) * k; st.aR += (tAR - st.aR) * k; st.lL += (tLL - st.lL) * k; st.lR += (tLR - st.lR) * k; st.rx += (tRX - st.rx) * k; st.y += (tY - st.y) * k;
      armL.rotation.x = st.aL; armR.rotation.x = st.aR; legL.rotation.x = st.lL; legR.rotation.x = st.lR;
      body.rotation.x = st.rx; body.position.y = st.y; body.position.z = pose === 'prone' ? -Math.sin(st.rx) * 0.85 : 0;
    },
    hurt() { st.hurt = 0.5; },
  };
}
