// 로블록스 클래식 뉴비(R6) — 노란 머리·팔, 파란 몸통, 초록 다리, 기본 스마일 얼굴
import * as THREE from 'three';

const S = 0.32; // 1 스터드 (m)
export const NOOB_H = 5.2 * S;
const COL = { yellow: 0xF5CD30, blue: 0x0D69AC, green: 0xA4BD47 };

function faceTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  // 세로로 긴 타원 눈 두 개
  for (const x of [100, 156]) { g.beginPath(); g.ellipse(x, 44, 10, 23, 0, 0, Math.PI * 2); g.fill(); }
  // 얇은 미소
  g.strokeStyle = '#000'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.moveTo(84, 82); g.quadraticCurveTo(128, 120, 172, 82); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function headGeo(r, h, seg = 28) {
  // 로블록스 기본 머리: 모서리가 둥근 원기둥
  const e = r * 0.38, pts = [];
  pts.push(new THREE.Vector2(0, -h / 2));
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + i / 6 * Math.PI / 2; pts.push(new THREE.Vector2(r - e + Math.cos(a) * e, -h / 2 + e + Math.sin(a) * e)); }
  for (let i = 0; i <= 6; i++) { const a = i / 6 * Math.PI / 2; pts.push(new THREE.Vector2(r - e + Math.cos(a) * e, h / 2 - e + Math.sin(a) * e)); }
  pts.push(new THREE.Vector2(0, h / 2));
  return new THREE.LatheGeometry(pts, seg);
}

export function createNoob() {
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0 });
  const mY = mat(COL.yellow), mB = mat(COL.blue), mG = mat(COL.green);
  const root = new THREE.Group();       // 발 위치
  const body = new THREE.Group(); root.add(body); // 전신 자세(눕기 등)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(2 * S, 2 * S, S), mB); torso.position.y = 3 * S; body.add(torso);
  const head = new THREE.Group(); head.position.y = 4 * S + 0.6 * S; body.add(head);
  const hm = new THREE.Mesh(headGeo(0.62 * S, 1.2 * S), mY); head.add(hm);
  const face = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62 * S + 0.002, 0.62 * S + 0.002, 0.62 * S, 24, 1, true, -Math.PI / 3, Math.PI * 2 / 3),
    new THREE.MeshStandardMaterial({ map: faceTex(), transparent: true, roughness: 0.5, depthWrite: false }));
  face.position.y = 0.02 * S; head.add(face);
  const limb = (m, x, y) => {
    const piv = new THREE.Group(); piv.position.set(x, y, 0); body.add(piv);
    const b = new THREE.Mesh(new THREE.BoxGeometry(S * 0.98, 2 * S, S * 0.98), m); b.position.y = -S * (y > 3 * S ? 0.5 : 1); piv.add(b);
    return piv;
  };
  const armL = limb(mY, -1.5 * S, 3.5 * S), armR = limb(mY, 1.5 * S, 3.5 * S);
  const legL = limb(mG, -0.5 * S, 2 * S), legR = limb(mG, 0.5 * S, 2 * S);
  // 손전등 (오른손)
  const torch = new THREE.Group(); torch.position.set(0, -1.55 * S, 0.02); armR.add(torch);
  const tm = new THREE.MeshStandardMaterial({ color: 0x222226, metalness: 0.6, roughness: 0.4 });
  const t1 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.22, 10), tm); t1.rotation.x = 0; torch.add(t1);
  const t2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.036, 0.07, 12), tm); t2.position.y = -0.13; torch.add(t2);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.045, 12), new THREE.MeshBasicMaterial({ color: 0xfff4d0 })); lens.rotation.x = Math.PI / 2; lens.position.y = -0.166; torch.add(lens);
  const tip = new THREE.Object3D(); tip.position.y = -0.2; torch.add(tip);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  face.castShadow = false;

  const st = { phase: 0, armL: 0, armR: 0, legL: 0, legR: 0, bodyRX: 0, bodyY: 0, bodyZ: 0, headX: 0, hurt: 0, lens };
  const api = {
    root, body, head, armL, armR, legL, legR, torch, tip, lens,
    pose: 'idle', torchOn: true,
    // speed: m/s, run: bool
    update(dt, speed = 0, run = false) {
      const p = api.pose; let tAL = 0, tAR = 0, tLL = 0, tLR = 0, tRX = 0, tY = 0, tZ = 0, tHX = 0, k = Math.min(1, dt * 12);
      if (p === 'walk' || p === 'idle') {
        if (speed > 0.15) {
          st.phase += dt * speed * (run ? 2.4 : 3.1);
          const amp = run ? 1.0 : 0.62, s = Math.sin(st.phase) * amp;
          tLL = s; tLR = -s; tAL = -s * 0.95; tAR = s * 0.95;
          tY = run ? Math.abs(Math.cos(st.phase)) * 0.04 : 0;
        } else {
          st.phase += dt; const s = Math.sin(st.phase * 1.4) * 0.05;
          tAL = s; tAR = -s; k = Math.min(1, dt * 6);
        }
      } else if (p === 'lie') { tRX = -Math.PI / 2; tY = 0.17; tZ = 0; tAL = -2.9; tAR = -2.9; k = Math.min(1, dt * 5); }
      else if (p === 'lieBed') { tRX = -Math.PI / 2; tY = 0.86; tAL = 0; tAR = 0; k = 1; }
      else if (p === 'crouch') { tLL = -1.45; tLR = -1.45; tY = -0.42; tAL = -0.6; tAR = -0.6; tRX = 0.25; k = Math.min(1, dt * 7); }
      else if (p === 'sit') { tLL = -1.5; tLR = -1.5; tY = -0.2; k = Math.min(1, dt * 6); }
      else if (p === 'dead') { tRX = Math.PI / 2 * 0.98; tY = 0.17; tAL = -0.4; tAR = 0.3; tLL = 0.2; tLR = -0.1; k = Math.min(1, dt * 4); }
      else if (p === 'scared') { tAL = -2.6; tAR = -2.6; tHX = 0.2; k = Math.min(1, dt * 10); }
      else if (p === 'lookback') { tHX = 0; k = Math.min(1, dt * 6); }
      if (api.torchOn && p !== 'lie' && p !== 'dead' && p !== 'lieBed' && p !== 'scared') tAR = -1.45 + tAR * 0.12; // 손전등 들기
      if (st.hurt > 0) { st.hurt -= dt; tRX += 0.35 * Math.sin(st.hurt * 30) * st.hurt; }
      st.armL += (tAL - st.armL) * k; st.armR += (tAR - st.armR) * k;
      st.legL += (tLL - st.legL) * k; st.legR += (tLR - st.legR) * k;
      st.bodyRX += (tRX - st.bodyRX) * k; st.bodyY += (tY - st.bodyY) * k; st.headX += (tHX - st.headX) * k;
      armL.rotation.x = st.armL; armR.rotation.x = st.armR; legL.rotation.x = st.legL; legR.rotation.x = st.legR;
      head.rotation.x = st.headX;
      body.rotation.x = st.bodyRX; body.position.y = st.bodyY;
      // 누울 때는 몸 중심이 아니라 발 쪽이 축이 되므로 앞으로 밀어준다
      body.position.z = Math.sin(st.bodyRX) * -0.0;
      torch.visible = api.torchOn && p !== 'dead';
    },
    hurt() { st.hurt = 0.5; },
    snap() { st.armL = st.armR = st.legL = st.legR = 0; st.bodyRX = 0; st.bodyY = 0; },
  };
  return api;
}
