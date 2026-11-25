// 총 모델(권총·소총, 부품 단위) + 사격 효과: 총구 화염, 탄피, 벽 탄흔·불꽃, 피 튀김·바닥 피 웅덩이
import * as THREE from 'three';

function ctex(w, h, draw, rep) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); } return t; }
const noiseBump = (dense = 1) => ctex(128, 128, (g, w, h) => { const id = g.createImageData(w, h); for (let i = 0; i < w * h; i++) { const v = 128 + (Math.random() - 0.5) * 120 * dense; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; } g.putImageData(id, 0, 0); }, [3, 3]);
const serr = ctex(128, 32, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 8) { g.fillStyle = '#202020'; g.fillRect(x, 0, 3, h); g.fillStyle = '#d0d0d0'; g.fillRect(x + 3, 0, 1, h); } });
const steel = (o = {}) => new THREE.MeshStandardMaterial({ color: 0x24262a, metalness: 0.85, roughness: 0.32, envMapIntensity: 1.2, ...o });
const poly = (o = {}) => new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.1, roughness: 0.75, bumpMap: noiseBump(), bumpScale: 1.2, ...o });
const B = (g, sx, sy, sz, x, y, z, m, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); b.position.set(x, y, z); b.rotation.x = rx; g.add(b); return b; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C = (g, r, l, x, y, z, m, seg = 16) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, seg), m); c.rotation.x = Math.PI / 2; c.position.set(x, y, z); g.add(c); return c; };

// 권총 (총구 = -z). 길이 약 19cm
export function makePistol() {
  const g = new THREE.Group(), st = steel(), sl = steel({ bumpMap: serr, bumpScale: 2 }), pl = poly(), dark = steel({ color: 0x0c0c0d, roughness: 0.5 });
  B(g, 0.03, 0.03, 0.19, 0, 0.032, -0.06, sl);                       // 슬라이드 (뒤쪽 톱니)
  B(g, 0.031, 0.008, 0.05, 0, 0.022, -0.115, st);                    // 슬라이드 앞 하단
  B(g, 0.012, 0.004, 0.06, 0.0158, 0.036, -0.03, dark);               // 배출구
  C(g, 0.0065, 0.012, 0, 0.034, -0.155, dark);                       // 총구 테
  const bore = C(g, 0.0042, 0.013, 0, 0.034, -0.156, new THREE.MeshBasicMaterial({ color: 0x000000 }));
  B(g, 0.004, 0.006, 0.006, 0, 0.05, -0.14, st); B(g, 0.016, 0.006, 0.006, 0, 0.05, 0.028, st); // 가늠쇠·가늠자
  B(g, 0.028, 0.02, 0.14, 0, 0.008, -0.05, pl);                      // 프레임
  B(g, 0.024, 0.006, 0.05, 0, -0.004, -0.095, pl);                   // 레일
  const grip = B(g, 0.029, 0.11, 0.048, 0, -0.045, 0.01, poly({ bumpScale: 3 })); grip.rotation.x = -0.22;
  const mag = B(g, 0.024, 0.012, 0.042, 0, -0.1, 0.022, dark); mag.rotation.x = -0.22;
  const tg = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.0035, 8, 16, Math.PI), pl); tg.rotation.set(0, Math.PI / 2, Math.PI); tg.position.set(0, -0.004, -0.02); g.add(tg);
  const trig = B(g, 0.005, 0.016, 0.004, 0, -0.008, -0.018, st); trig.rotation.x = 0.3;
  B(g, 0.01, 0.012, 0.01, 0, 0.04, 0.038, st);                       // 공이치기
  g.userData.muzzle = new THREE.Vector3(0, 0.034, -0.17); g.userData.eject = new THREE.Vector3(0.02, 0.04, -0.03); g.userData.auto = false; g.userData.name = '권총'; void bore;
  // 두 손 파지(이등변 자세): 오른손 = 손잡이 감싸고 검지는 방아쇠, 왼손 = 오른손을 감싸 받침. p=손목, F=손가락 방향, up=손등 방향
  g.userData.base = V(0.095, -0.118, -0.42); g.userData.rot0 = [0.03, 0.03, 0]; g.userData.run = { p: V(-0.02, -0.07, 0.06), r: [-0.55, 0.35, 0.2] };
  g.userData.hold = { R: { p: V(0.026, -0.078, 0.062), F: V(-0.1, 0.12, -1), up: V(1, 0.1, 0), pose: 'trigger' }, L: { p: V(-0.04, -0.105, 0.028), F: V(0.3, 0.38, -0.87), up: V(-0.95, 0.2, 0.05), pose: 'support' } };
  g.scale.setScalar(1.2);
  return g;
}
// 소총 (총구 = -z). 길이 약 85cm
export function makeRifle() {
  const g = new THREE.Group(), st = steel(), pl = poly(), dark = steel({ color: 0x0f1011, roughness: 0.45 });
  const mlok = ctex(256, 32, (c, w, h) => { c.fillStyle = '#909090'; c.fillRect(0, 0, w, h); for (let x = 10; x < w; x += 32) { c.fillStyle = '#101010'; c.fillRect(x, 8, 20, 16); } }, [1, 1]);
  B(g, 0.05, 0.06, 0.24, 0, 0.0, -0.05, st);                         // 리시버
  B(g, 0.05, 0.012, 0.36, 0, 0.037, -0.18, dark);                    // 상부 레일
  for (let i = 0; i < 16; i++) B(g, 0.052, 0.006, 0.008, 0, 0.045, -0.02 - i * 0.022, st);
  const hg = B(g, 0.055, 0.055, 0.3, 0, 0.004, -0.33, new THREE.MeshStandardMaterial({ color: 0x2a2b2c, metalness: 0.5, roughness: 0.5, bumpMap: mlok, bumpScale: 3 })); // 총열 덮개
  C(g, 0.009, 0.2, 0, 0.004, -0.57, st);                             // 총열
  C(g, 0.016, 0.06, 0, 0.004, -0.68, dark, 6);                       // 소염기
  const mz = C(g, 0.006, 0.061, 0, 0.004, -0.681, new THREE.MeshBasicMaterial({ color: 0x000000 }));
  // 탄창 (휘어진)
  const ms = new THREE.Shape(); ms.moveTo(0, 0); ms.lineTo(0.06, 0); ms.quadraticCurveTo(0.08, -0.1, 0.05, -0.2); ms.lineTo(-0.01, -0.19); ms.quadraticCurveTo(0.015, -0.09, 0, 0);
  const mg = new THREE.ExtrudeGeometry(ms, { depth: 0.028, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 1 }); mg.translate(-0.03, 0, -0.014); mg.rotateY(Math.PI / 2);
  const mag = new THREE.Mesh(mg, dark); mag.position.set(0, -0.025, -0.08); g.add(mag);
  const grip = B(g, 0.032, 0.11, 0.045, 0, -0.07, 0.04, poly({ bumpScale: 3 })); grip.rotation.x = -0.35;
  const tg = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.004, 8, 16, Math.PI), st); tg.rotation.set(0, Math.PI / 2, Math.PI); tg.position.set(0, -0.028, -0.0); g.add(tg);
  B(g, 0.04, 0.05, 0.06, 0, 0.0, 0.1, pl); const stock = B(g, 0.042, 0.11, 0.2, 0, -0.025, 0.24, pl); stock.rotation.x = -0.05; B(g, 0.046, 0.12, 0.02, 0, -0.03, 0.345, poly({ color: 0x101010 }));
  // 도트사이트
  B(g, 0.03, 0.035, 0.07, 0, 0.065, -0.07, dark); const lens = new THREE.Mesh(new THREE.CircleGeometry(0.013, 16), new THREE.MeshStandardMaterial({ color: 0x334455, metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.7 })); lens.position.set(0, 0.07, -0.106); g.add(lens);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0015, 8), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false })); dot.position.set(0, 0.07, -0.035); dot.rotation.y = Math.PI; g.add(dot);
  g.userData.muzzle = new THREE.Vector3(0, 0.004, -0.72); g.userData.eject = new THREE.Vector3(0.03, 0.02, -0.06); g.userData.auto = true; g.userData.name = '소총'; void hg; void mz;
  // 오른손 = 권총손잡이, 왼손 = 총열 덮개 아래 받침. 달릴 땐 총구를 왼쪽 아래로 내림(로우 레디)
  g.userData.base = V(0.125, -0.165, -0.3); g.userData.rot0 = [0.02, 0.04, 0]; g.userData.run = { p: V(-0.03, -0.06, 0.05), r: [-0.5, 0.55, 0.35] };
  g.userData.hold = { R: { p: V(0.03, -0.085, 0.11), F: V(-0.08, 0.1, -1), up: V(1, 0.15, 0), pose: 'trigger' }, L: { p: V(-0.04, -0.075, -0.25), F: V(0.55, 0.28, -0.78), up: V(-0.45, -0.88, 0), pose: 'support' } };
  return g;
}

// ── 효과 ──
const flashTex = ctex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64); gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.25, 'rgba(255,200,90,.9)'); gr.addColorStop(1, 'rgba(255,120,20,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(255,230,150,.9)'; g.lineWidth = 6; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); g.stroke(); } });
const bloodTex = ctex(128, 128, (g, w, h) => { for (let i = 0; i < 26; i++) { const r = 6 + Math.random() * 22, x = 64 + (Math.random() - 0.5) * 70, y = 64 + (Math.random() - 0.5) * 70; const gr = g.createRadialGradient(x, y, 1, x, y, r); gr.addColorStop(0, 'rgba(90,0,0,.95)'); gr.addColorStop(0.7, 'rgba(110,5,5,.85)'); gr.addColorStop(1, 'rgba(110,5,5,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } });
const holeTex = ctex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 1, 32, 32, 30); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.25, 'rgba(20,20,20,.9)'); gr.addColorStop(0.5, 'rgba(60,60,60,.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
export class FX {
  constructor(scene) { this.scene = scene; this.parts = []; this.decals = []; this.brass = new THREE.MeshStandardMaterial({ color: 0xc9a040, metalness: 0.9, roughness: 0.3 }); this.bloodM = new THREE.MeshBasicMaterial({ color: 0x7a0000 }); }
  muzzle(gun) {
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    f.scale.setScalar(gun.userData.auto ? 0.22 : 0.16); f.position.copy(gun.userData.muzzle); f.material.rotation = Math.random() * 6; gun.add(f);
    const L = new THREE.PointLight(0xffb050, 25, 6); L.position.copy(gun.userData.muzzle); gun.add(L);
    setTimeout(() => { gun.remove(f); gun.remove(L); f.material.dispose(); }, 55);
    // 탄피 배출
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.02, 8), this.brass); gun.localToWorld(s.position.copy(gun.userData.eject)); this.scene.add(s);
    const right = new THREE.Vector3(1, 0.6, 0.2).applyQuaternion(gun.getWorldQuaternion(new THREE.Quaternion()));
    this.parts.push({ m: s, v: right.multiplyScalar(2 + Math.random()), spin: new THREE.Vector3(Math.random() * 20, Math.random() * 20, 0), life: 3, bounce: true, tink: true });
  }
  // 사람 맞음: 피가 총알 방향으로 튐
  blood(p, dir, n = 14) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.008 + Math.random() * 0.012, 5, 4), this.bloodM); m.position.copy(p); this.scene.add(m);
      const v = dir.clone().multiplyScalar(1.5 + Math.random() * 2.5).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.6, (Math.random() - 0.5) * 2));
      this.parts.push({ m, v, life: 1.2, blood: true });
    }
  }
  // 바닥 피 웅덩이 (점점 커짐)
  pool(p, max = 1.1) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: bloodTex, transparent: true, depthWrite: false, roughness: 0.15, metalness: 0.1, color: 0xffffff }));
    m.rotation.set(-Math.PI / 2, 0, Math.random() * 6); m.position.set(p.x, 0.006 + this.decals.length * 0.0004, p.z); m.scale.setScalar(0.05); m.renderOrder = 2; this.scene.add(m);
    this.decals.push(m); this.parts.push({ m, grow: max, life: 99 });
  }
  splat(p) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.25), new THREE.MeshBasicMaterial({ map: bloodTex, transparent: true, depthWrite: false })); m.rotation.set(-Math.PI / 2, 0, Math.random() * 6); m.position.set(p.x, 0.007, p.z); this.scene.add(m); this.decals.push(m); }
  // 벽·물건 맞음: 탄흔 + 불꽃
  impact(hit) {
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    d.position.copy(hit.point).addScaledVector(n, 0.003); d.lookAt(d.position.clone().add(n)); this.scene.add(d); this.decals.push(d);
    for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.006, 4, 3), new THREE.MeshBasicMaterial({ color: 0xffd080, toneMapped: false })); s.position.copy(hit.point); this.scene.add(s); this.parts.push({ m: s, v: n.clone().multiplyScalar(2).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)), life: 0.25 }); }
  }
  update(dt, audio) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]; p.life -= dt;
      if (p.grow) { p.m.scale.setScalar(Math.min(p.grow, p.m.scale.x + dt * 0.25)); continue; }
      p.v.y -= 9.8 * dt; p.m.position.addScaledVector(p.v, dt); if (p.spin) { p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt; }
      if (p.m.position.y < 0.005) {
        if (p.blood) { if (Math.random() < 0.35) this.splat(p.m.position); p.life = 0; }
        else if (p.bounce && p.v.y < -0.5) { p.v.y *= -0.35; p.v.x *= 0.5; p.v.z *= 0.5; p.m.position.y = 0.005; if (p.tink) { audio?.play('key', { pos: p.m.position, vol: 0.25, rate: 2.4 + Math.random() }); p.tink = p.v.y > 0.6; } }
        else { p.m.position.y = 0.005; p.v.set(0, 0, 0); }
      }
      if (p.life <= 0) { p.m.removeFromParent(); this.parts.splice(i, 1); }
    }
    while (this.decals.length > 60) this.decals.shift().removeFromParent();
  }
  clear() { for (const p of this.parts) p.m.removeFromParent(); for (const d of this.decals) d.removeFromParent(); this.parts = []; this.decals = []; }
}
