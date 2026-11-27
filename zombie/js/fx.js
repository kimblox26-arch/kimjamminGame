// 파티클/효과: 피, 불·연기 기둥, 총구 화염, 비
import * as THREE from 'three';

function dotTex() { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, '#fff'); g.addColorStop(0.6, 'rgba(255,255,255,.8)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); }
function spriteTex(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  if (kind === 'smoke') { g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(0.5, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
  else { g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(0.25, 'rgba(255,200,80,.9)'); g.addColorStop(0.6, 'rgba(255,90,10,.4)'); g.addColorStop(1, 'rgba(255,40,0,0)'); }
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  if (kind === 'smoke') { x.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`; x.beginPath(); x.arc(Math.random() * 128, Math.random() * 128, 6 + Math.random() * 16, 0, 7); x.fill(); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class FX {
  constructor(game) {
    this.game = game; this.scene = game.scene; this.fires = [];
    this.smokeMat = new THREE.SpriteMaterial({ map: spriteTex('smoke'), color: 0x3a3632, transparent: true, depthWrite: false, opacity: 0.5, fog: true });
    this.fireMat = new THREE.SpriteMaterial({ map: spriteTex('fire'), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
    // 피 파티클
    const N = 400; this.bN = N; this.bi = 0;
    this.bPos = new Float32Array(N * 3).fill(-9999); this.bVel = new Float32Array(N * 3); this.bLife = new Float32Array(N);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.bPos, 3));
    this.bPts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x4a0404, size: 0.03, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false, alphaMap: this.dot = dotTex() }));
    this.bPts.frustumCulled = false; this.scene.add(this.bPts);
    // 살점(헤드샷·절단) & 탄착 먼지
    this.gibs = []; this.gibMat = new THREE.MeshStandardMaterial({ color: 0x5a0a08, roughness: 0.3, metalness: 0.05 });
    this.gibGeo = [new THREE.DodecahedronGeometry(0.035, 0), new THREE.TetrahedronGeometry(0.05, 0), new THREE.BoxGeometry(0.06, 0.03, 0.04)];
    const DN = 160; this.dN = DN; this.di = 0; this.dPos = new Float32Array(DN * 3).fill(-9999); this.dVel = new Float32Array(DN * 3); this.dLife = new Float32Array(DN);
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(this.dPos, 3));
    this.dPts = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x9a948a, size: 0.03, transparent: true, opacity: 0.8, depthWrite: false, alphaMap: this.dot })); this.dPts.frustumCulled = false; this.scene.add(this.dPts);
    this.decals = []; this.decalMat = new THREE.MeshStandardMaterial({ color: 0x3a0303, roughness: 0.2, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    // 총구 화염
    this.flash = new THREE.Sprite(this.fireMat.clone()); this.flash.scale.set(0.35, 0.35, 1); this.flash.visible = false; this.flashT = 0;
    // 비
    const RN = 3000, rp = new Float32Array(RN * 6);
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9aa4ad, transparent: true, opacity: 0.35 }));
    this.rain.frustumCulled = false; this.rain.visible = false; this.rainOn = false; this.scene.add(this.rain);
    this.rainSeed(true);
  }
  blood(p, dir, n = 10) {
    for (let k = 0; k < n; k++) {
      const i = this.bi = (this.bi + 1) % this.bN;
      this.bPos[i * 3] = p.x; this.bPos[i * 3 + 1] = p.y; this.bPos[i * 3 + 2] = p.z;
      this.bVel[i * 3] = dir.x * 2 + (Math.random() - 0.5) * 3; this.bVel[i * 3 + 1] = Math.random() * 2.5 + dir.y; this.bVel[i * 3 + 2] = dir.z * 2 + (Math.random() - 0.5) * 3;
      this.bLife[i] = 0.6 + Math.random() * 0.8;
    }
  }
  gore(p, dir, k = 1) {
    this.blood(p, dir, Math.round(40 * k)); this.blood(p, new THREE.Vector3(0, 1.5, 0), Math.round(20 * k));
    for (let i = 0; i < 9 * k; i++) {
      if (this.gibs.length > 60) { const o = this.gibs.shift(); this.scene.remove(o.m); }
      const m = new THREE.Mesh(this.gibGeo[i % 3], this.gibMat); m.position.copy(p); m.castShadow = true; this.scene.add(m);
      this.gibs.push({ m, v: new THREE.Vector3(dir.x * 3 + (Math.random() - 0.5) * 4, 2 + Math.random() * 3, dir.z * 3 + (Math.random() - 0.5) * 4), t: 0, rest: false });
    }
    this.splat(p.x + dir.x * 1.2, p.z + dir.z * 1.2, 0.9 * k);
  }
  splat(x, z, s) { // 바닥 핏자국
    const y = this.game.col.groundAt(x, z, 1e4, 0, 0.1) + 0.02; if (this.decals.length > 40) this.scene.remove(this.decals.shift());
    const g = new THREE.CircleGeometry(s * (0.6 + Math.random() * 0.6), 10); const pa = g.attributes.position; for (let i = 1; i < pa.count; i++) { const k = 0.6 + Math.random() * 0.7; pa.setX(i, pa.getX(i) * k); pa.setY(i, pa.getY(i) * k); }
    const m = new THREE.Mesh(g, this.decalMat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.renderOrder = 2; this.scene.add(m); this.decals.push(m);
  }
  impact(p) {
    for (let k = 0; k < 8; k++) { const i = this.di = (this.di + 1) % this.dN; this.dPos[i * 3] = p.x; this.dPos[i * 3 + 1] = p.y; this.dPos[i * 3 + 2] = p.z; this.dVel[i * 3] = (Math.random() - 0.5) * 3; this.dVel[i * 3 + 1] = Math.random() * 2.5; this.dVel[i * 3 + 2] = (Math.random() - 0.5) * 3; this.dLife[i] = 0.4 + Math.random() * 0.5; }
    this.game.audio.play('impact', { pos: p });
  }
  addFire(pos, owner, big) {
    const grp = new THREE.Group(); grp.position.copy(pos);
    const flames = [], smoke = [];
    for (let i = 0; i < (big ? 8 : 4); i++) { const s = new THREE.Sprite(this.fireMat); s.position.set((Math.random() - 0.5) * 2, 0.6 + Math.random(), (Math.random() - 0.5) * 2); grp.add(s); flames.push({ s, ph: Math.random() * 6, base: big ? 2.6 : 1.6 }); }
    for (let i = 0; i < (big ? 26 : 14); i++) { const s = new THREE.Sprite(this.smokeMat); grp.add(s); smoke.push({ s, t: Math.random() }); }
    this.scene.add(grp);
    const f = { grp, flames, smoke, owner, big, pos: pos.clone(), snd: null };
    this.fires.push(f); return f;
  }
  removeOwner(o) { this.fires = this.fires.filter(f => { if (f.owner !== o) return true; this.scene.remove(f.grp); if (f.snd) f.snd.stop(); return false; }); }
  hideForAO(on) { const v = !on; for (const f of this.fires) if (f._vis === undefined || !on) { if (on) f._vis = f.grp.visible; f.grp.visible = on ? false : f._vis ?? true; if (!on) f._vis = undefined; } this.rain.visible = v && this.rainOn; this.bPts.visible = v; this.dPts.visible = v; this.flash.visible = v && this.flashT > 0; for (const d of this.decals) d.visible = v; }
  muzzle(p) { this.flash.position.copy(p); this.flash.visible = true; this.flashT = 0.05; this.flash.material.rotation = Math.random() * 6; if (!this.flash.parent) this.scene.add(this.flash); }
  rainSeed(all) {
    const a = this.rain.geometry.attributes.position, c = this.game.camera ? this.game.camera.position : new THREE.Vector3();
    for (let i = 0; i < a.count / 2; i++) {
      if (!all && a.getY(i * 2 + 1) > c.y - 5) continue;
      const x = c.x + (Math.random() - 0.5) * 60, y = c.y + Math.random() * 30, z = c.z + (Math.random() - 0.5) * 60;
      a.setXYZ(i * 2, x, y, z); a.setXYZ(i * 2 + 1, x + 0.05, y - 0.6, z + 0.03);
    }
    a.needsUpdate = true;
  }
  update(dt) {
    const cam = this.game.camera.position, tt = performance.now() / 1000;
    // 피
    for (let i = 0; i < this.bN; i++) {
      if (this.bLife[i] <= 0) continue;
      this.bLife[i] -= dt; this.bVel[i * 3 + 1] -= 9.8 * dt;
      this.bPos[i * 3] += this.bVel[i * 3] * dt; this.bPos[i * 3 + 1] += this.bVel[i * 3 + 1] * dt; this.bPos[i * 3 + 2] += this.bVel[i * 3 + 2] * dt;
      if (this.bLife[i] <= 0) this.bPos[i * 3 + 1] = -9999;
    }
    this.bPts.geometry.attributes.position.needsUpdate = true;
    for (let i = 0; i < this.dN; i++) { if (this.dLife[i] <= 0) continue; this.dLife[i] -= dt; this.dVel[i * 3 + 1] -= 9.8 * dt; for (let a = 0; a < 3; a++) this.dPos[i * 3 + a] += this.dVel[i * 3 + a] * dt; if (this.dLife[i] <= 0) this.dPos[i * 3 + 1] = -9999; }
    this.dPts.geometry.attributes.position.needsUpdate = true;
    for (const g of this.gibs) { if (g.rest) continue; g.t += dt; g.v.y -= 9.8 * dt; g.m.position.addScaledVector(g.v, dt); g.m.rotation.x += dt * 8; g.m.rotation.y += dt * 5; const gy = this.game.col.groundAt(g.m.position.x, g.m.position.z, g.m.position.y + 0.2, 0.3, 0.02) + 0.02; if (g.m.position.y < gy) { g.m.position.y = gy; g.v.multiplyScalar(0.25); g.v.y = -g.v.y * 0.3; if (g.v.length() < 0.3) g.rest = true; } }
    // 불·연기 (가까운 것만 활성)
    for (const f of this.fires) {
      const d = f.pos.distanceTo(cam); f.grp.visible = d < 1500;
      if (!f.grp.visible) continue;
      for (const fl of f.flames) { const k = fl.base * (0.75 + 0.35 * Math.sin(tt * 13 + fl.ph) * Math.sin(tt * 7.3 + fl.ph * 2)); fl.s.scale.set(k, k * 1.4, 1); fl.s.position.y = 0.4 + k * 0.4; }
      for (const s of f.smoke) {
        s.t += dt * (f.big ? 0.035 : 0.05); if (s.t > 1) s.t -= 1;
        const h = s.t * (f.big ? 90 : 45), w = 3 + s.t * (f.big ? 26 : 14);
        s.s.position.set(Math.sin(s.t * 9 + f.pos.x) * 2 + s.t * 18, 2 + h, Math.cos(s.t * 7) * 2 + s.t * 6);
        s.s.scale.set(w, w, 1); s.s.material.rotation = s.t * 2;
      }
      if (d < 60 && !f.snd) f.snd = this.game.audio.loop('fire', { pos: f.pos, vol: f.big ? 0.8 : 0.5 });
      else if (d > 80 && f.snd) { f.snd.stop(); f.snd = null; }
    }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
    // 비
    this.rain.visible = this.rainOn;
    if (this.rainOn) {
      const a = this.rain.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) a.setY(i, a.getY(i) - 22 * dt);
      for (let i = 0; i < a.count / 2; i++) if (a.getY(i * 2 + 1) < cam.y - 6 || Math.abs(a.getX(i * 2) - cam.x) > 32 || Math.abs(a.getZ(i * 2) - cam.z) > 32) {
        const x = cam.x + (Math.random() - 0.5) * 60, y = cam.y + 18 + Math.random() * 10, z = cam.z + (Math.random() - 0.5) * 60;
        a.setXYZ(i * 2, x, y, z); a.setXYZ(i * 2 + 1, x + 0.05, y - 0.6, z + 0.03);
      }
      a.needsUpdate = true;
    }
  }
}
