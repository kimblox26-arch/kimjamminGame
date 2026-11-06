// 장치: 회전 톱, 유압 프레스, 가시 함정, 전기 바닥(테슬라 코일), 발사대
import * as THREE from 'three';
import { P2PART } from './human.js';

const V = THREE.Vector3;
const _a = new V(), _b = new V();
const box = (x0, y0, z0, x1, y1, z1, extra = {}) => ({ min: new V(x0, y0, z0), max: new V(x1, y1, z1), ...extra });
function mesh(scene, geo, mat, x, y, z) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; scene.add(m); return m; }
function solid(world, scene, b, mat) {
  world.boxes.push(b); world.solids.push(b); b.metal = true;
  const s = new V().subVectors(b.max, b.min);
  b.mesh = mesh(scene, new THREE.BoxGeometry(s.x, s.y, s.z), mat, (b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
  return b;
}
function label(scene, text, x, y, z, ry = 0) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d');
  g.fillStyle = '#e8b018'; g.fillRect(0, 0, 512, 96); g.fillStyle = '#111'; g.font = 'bold 52px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.225), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 })); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
}
// 사람 입자마다 쿨타임
function cool(map, h, i, t) { const k = h.name + i; if ((map[k] || 0) > 0) return false; map[k] = t; return true; }
function tick(map, dt) { for (const k in map) map[k] -= dt; }

export function createDevices(G) {
  const { world: W, scene } = G, M = W.M, list = W.devices;

  // ───────── 1. 회전 톱 ─────────
  {
    const c = new V(-9, 0, 8), R = 0.42, cy = 0.95;
    solid(W, scene, box(c.x - 0.75, 0, c.z - 0.45, c.x + 0.75, 0.9, c.z + 0.45), M.metal);
    mesh(scene, new THREE.BoxGeometry(1.54, 0.04, 0.94), M.stripes, c.x, 0.91, c.z);
    const s = new THREE.Shape(); const T = 36;
    for (let i = 0; i < T; i++) { const a0 = i / T * Math.PI * 2, a1 = (i + 0.7) / T * Math.PI * 2; const p0 = [Math.cos(a0) * R * 0.94, Math.sin(a0) * R * 0.94], p1 = [Math.cos(a1) * R, Math.sin(a1) * R]; i ? s.lineTo(...p0) : s.moveTo(...p0); s.lineTo(...p1); }
    const hole = new THREE.Path(); hole.absarc(0, 0, 0.03, 0, Math.PI * 2, true); s.holes.push(hole);
    const blade = mesh(scene, new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false, curveSegments: 4 }), M.chrome, c.x, cy, c.z - 0.002);
    const hub = mesh(scene, new THREE.CylinderGeometry(0.06, 0.06, 0.05, 24).rotateX(Math.PI / 2), M.dark, c.x, cy, c.z);
    const guard = mesh(scene, new THREE.TorusGeometry(R + 0.04, 0.025, 8, 32, Math.PI * 0.6), M.paintY, c.x, cy, c.z); guard.rotation.z = Math.PI * 0.2;
    label(scene, '⚠ 회전 톱', c.x, 0.55, c.z + 0.452);
    const cd = {};
    list.push({ name: '회전 톱', pos: c, radius: 1.2, block: 0.95, update(dt) {
      blade.rotation.z -= dt * 70; tick(cd, dt);
      let load = 0;
      for (const h of G.humans) h.particles.forEach((p, i) => {
        const dz = p.p.z - c.z, dx = p.p.x - c.x, dy = p.p.y - cy, rr = Math.hypot(dx, dy);
        if (Math.abs(dz) > p.r + 0.006 || rr > R + p.r * 0.3 || p.p.y < 0.88) return;
        load = 1;
        const tan = _a.set(dy, -dx, 0).normalize(); // 회전 방향 접선
        p.push(_b.set(0, 0, Math.sign(dz) || 1).multiplyScalar(1.5).addScaledVector(tan, 2), G.physics.h);
        if (cool(cd, h, i, 0.12)) {
          const pt = p.p.clone(); pt.z = c.z;
          h.hit({ part: P2PART[i], type: 'saw', dmg: 22, point: pt, dir: tan.clone(), cutDir: tan.clone().cross(new V(0, 0, 1)), organDmg: 50, noImpulse: true });
          G.fx.bloodBurst(pt, tan, 2.5, 1.2); G.fx.sparks(pt, tan, 4, [1, 0.3, 0.2]);
        }
      });
      for (const g of G.fx.gibs) for (const p of g.particles) { const dz = p.p.z - c.z, rr = Math.hypot(p.p.x - c.x, p.p.y - cy); if (Math.abs(dz) < p.r + 0.01 && rr < R && p.p.y > 0.88) { p.push(_b.set(0, 4, Math.sign(dz) * 2), G.physics.h); G.fx.bloodBurst(p.p, null, 1, 0.5); } }
      G.audio.loop('saw', 0.35 + load * 0.4, new V(c.x, cy, c.z));
    } });
  }
  // ───────── 2. 유압 프레스 ─────────
  {
    const c = new V(-9, 0, -8), bedTop = 0.15, plateH = 0.26, top = 2.7;
    solid(W, scene, box(c.x - 1, 0, c.z - 1, c.x + 1, bedTop, c.z + 1), M.stripes);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) solid(W, scene, box(c.x + sx * 0.95 - 0.08, 0, c.z + sz * 0.95 - 0.08, c.x + sx * 0.95 + 0.08, 3.5, c.z + sz * 0.95 + 0.08), M.metal);
    solid(W, scene, box(c.x - 1.05, 3.3, c.z - 1.05, c.x + 1.05, 3.75, c.z + 1.05), M.paintY);
    const plate = { min: new V(c.x - 0.8, top, c.z - 0.8), max: new V(c.x + 0.8, top + plateH, c.z + 0.8), vel: new V(), fric: 1, metal: true };
    W.boxes.push(plate); W.solids.push(plate);
    const pm = mesh(scene, new THREE.BoxGeometry(1.6, plateH, 1.6), M.dark, c.x, top + plateH / 2, c.z);
    const rod = mesh(scene, new THREE.CylinderGeometry(0.09, 0.09, 1, 24), M.chrome, c.x, 0, c.z);
    label(scene, '⚠ 유압 프레스', c.x, 0.07, c.z + 1.005);
    let t = 0, y = top, slammed = false; const cd = {};
    list.push({ name: '유압 프레스', pos: c, radius: 1.4, block: 0, update(dt) {
      t = (t + dt) % 6; tick(cd, dt);
      let ny;
      if (t < 2.6) ny = top; else if (t < 3.0) { const f = (t - 2.6) / 0.4; ny = top - (top - bedTop - 0.02) * f * f; } else if (t < 4.2) ny = bedTop + 0.02; else ny = bedTop + 0.02 + (top - bedTop - 0.02) * ((t - 4.2) / 1.8);
      plate.vel.set(0, (ny - y) / Math.max(dt, 1e-4), 0);
      y = ny; plate.min.y = y; plate.max.y = y + plateH;
      pm.position.y = y + plateH / 2; rod.scale.y = 3.3 - (y + plateH); rod.position.y = (y + plateH + 3.3) / 2;
      const moving = t > 2.6 && t < 3.0 || t > 4.2;
      G.audio.loop('hyd', moving ? 0.35 : 0, new V(c.x, 2.5, c.z));
      if (t >= 3.0 && !slammed) { slammed = true; G.audio.slam(new V(c.x, 0.3, c.z)); G.shake(0.25, c); G.fx.sparks(new V(c.x, 0.2, c.z + 0.8), new V(0, 0, 1), 12); }
      if (t < 2.6) slammed = false;
      if (t > 2.75 && t < 4.2) for (const h of G.humans) h.particles.forEach((p, i) => {
        if (Math.abs(p.p.x - c.x) > 0.8 + p.r * 0.5 || Math.abs(p.p.z - c.z) > 0.8 + p.r * 0.5) return;
        if (p.p.y + p.r * 0.6 < y) return;
        const gap = y - bedTop;
        if (gap < p.r * 2.2 && cool(cd, h, i, 0.6)) {
          const pt = p.p.clone(); pt.y = bedTop + gap / 2;
          h.hit({ part: P2PART[i], type: 'crush', dmg: 75, point: pt, dir: new V(0, -1, 0), organDmg: 100, noImpulse: true });
          const out = _a.set(p.p.x - c.x, 0, p.p.z - c.z).normalize();
          G.fx.bloodBurst(pt, out, 3, 1.5); G.audio.crack(pt); G.audio.splat(pt, 1.3);
          p.push(out.multiplyScalar(0.8), G.physics.h);
        }
      });
    } });
  }
  // ───────── 3. 가시 함정 ─────────
  {
    const c = new V(-2.5, 0, -8), half = 1.1, n = 7;
    mesh(scene, new THREE.BoxGeometry(2.2, 0.03, 2.2), M.dark, c.x, 0.015, c.z);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.035, 2.4), M.stripes); rim.position.set(c.x, 0.012, c.z); scene.add(rim);
    const cone = new THREE.ConeGeometry(0.028, 0.55, 10); cone.translate(0, 0.275, 0);
    const spikes = new THREE.InstancedMesh(cone, M.chrome, n * n); spikes.castShadow = true;
    const pos = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) pos.push(new V(c.x - half + (i + 0.5) * 2 * half / n, 0, c.z - half + (j + 0.5) * 2 * half / n));
    scene.add(spikes);
    const set = (h) => { const m = new THREE.Matrix4(); pos.forEach((p, k) => { m.makeTranslation(p.x, h - 0.55 + 0.02, p.z); spikes.setMatrixAt(k, m); }); spikes.instanceMatrix.needsUpdate = true; };
    set(0);
    label(scene, '⚠ 가시 함정', c.x, 0.4, c.z - 1.25, Math.PI);
    let t = 0, fired = false; const cd = {};
    list.push({ name: '가시 함정', pos: c, radius: 1.6, block: 0, update(dt) {
      t = (t + dt) % 4; tick(cd, dt);
      let h = 0;
      if (t < 2.4) h = 0; else if (t < 2.48) h = (t - 2.4) / 0.08; else if (t < 3.5) h = 1; else h = 1 - (t - 3.5) / 0.5;
      set(h * 0.55);
      if (t >= 2.4 && !fired) { fired = true; G.audio.shing(c); }
      if (t < 2.4) fired = false;
      if (h > 0.2) for (const hm of G.humans) hm.particles.forEach((p, i) => {
        if (Math.abs(p.p.x - c.x) > half || Math.abs(p.p.z - c.z) > half) return;
        if (p.p.y - p.r > h * 0.55) return;
        if (t < 2.6 && cool(cd, hm, i, 1.5)) {
          const pt = p.p.clone(); pt.y -= p.r * 0.5;
          hm.hit({ part: P2PART[i], type: 'spike', dmg: 32, point: pt, dir: new V(0, 1, 0), chordA: pt.clone().setY(pt.y - 0.05), chordB: pt.clone().setY(pt.y + p.r * 1.6), organDmg: 70, impulse: 3.5 });
        }
        if (h >= 1) p.o.lerp(p.p, 0.15); // 꽂혀서 잘 안 움직임
      });
    } });
  }
  // ───────── 4. 전기 바닥 + 테슬라 코일 ─────────
  {
    const c = new V(10, 0, 6), half = 1.1, coil = new V(11.8, 0, 7.8);
    const plateM = new THREE.MeshStandardMaterial({ color: 0x9a6a40, metalness: 1, roughness: 0.35 });
    mesh(scene, new THREE.BoxGeometry(2.2, 0.03, 2.2), plateM, c.x, 0.015, c.z);
    for (let i = -4; i <= 4; i++) { mesh(scene, new THREE.BoxGeometry(2.2, 0.012, 0.02), M.copper, c.x, 0.035, c.z + i * 0.25); mesh(scene, new THREE.BoxGeometry(0.02, 0.012, 2.2), M.copper, c.x + i * 0.25, 0.035, c.z); }
    solid(W, scene, box(coil.x - 0.3, 0, coil.z - 0.3, coil.x + 0.3, 0.4, coil.z + 0.3), M.dark);
    const cm = new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 1, roughness: 0.3, map: (() => { const cv = document.createElement('canvas'); cv.width = 16; cv.height = 256; const g = cv.getContext('2d'); for (let y = 0; y < 256; y += 4) { g.fillStyle = y % 8 ? '#c48a50' : '#7a4a20'; g.fillRect(0, y, 16, 4); } const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })() });
    mesh(scene, new THREE.CylinderGeometry(0.16, 0.16, 1.9, 24), cm, coil.x, 1.35, coil.z);
    mesh(scene, new THREE.TorusGeometry(0.3, 0.1, 16, 40).rotateX(Math.PI / 2), M.chrome, coil.x, 2.4, coil.z);
    label(scene, '⚠ 고압 전기', c.x - 1.13, 0.4, c.z, -Math.PI / 2);
    const light = new THREE.PointLight(0x88aaff, 0, 10, 2); light.position.set(coil.x, 2.4, coil.z); scene.add(light);
    const boltMat = new THREE.LineBasicMaterial({ color: 0xb8ccff, transparent: true, blending: THREE.AdditiveBlending });
    boltMat.color.multiplyScalar(4);
    const bolts = []; for (let i = 0; i < 4; i++) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3)); const l = new THREE.Line(g, boltMat); l.frustumCulled = false; scene.add(l); bolts.push(l); }
    const zig = (l, a, b) => { const p = l.geometry.attributes.position; for (let i = 0; i < 24; i++) { const f = i / 23; const j = Math.sin(f * Math.PI) * 0.18; p.setXYZ(i, a.x + (b.x - a.x) * f + (Math.random() - 0.5) * j, a.y + (b.y - a.y) * f + (Math.random() - 0.5) * j, a.z + (b.z - a.z) * f + (Math.random() - 0.5) * j); } p.needsUpdate = true; };
    let t = 0, rt = 0; const cd = {};
    list.push({ name: '전기 바닥', pos: c, radius: 1.6, block: 0, update(dt) {
      t = (t + dt) % 3.2; tick(cd, dt); rt -= dt;
      const on = t < 1.6;
      const targets = [];
      if (on) for (const h of G.humans) h.particles.forEach((p, i) => {
        if (Math.abs(p.p.x - c.x) > half || Math.abs(p.p.z - c.z) > half || p.p.y - p.r > 0.08) return;
        targets.push(p.p);
        h.spasm = 1; h.stun = Math.max(h.stun, 1.2); h.hp -= dt * 16 / 17 * 3; h.organs.heart.hp -= dt * 7;
        h.organs.heart.mesh.material.uniforms.uFlash.value = Math.min(1, 1 - h.organs.heart.hp / 100);
        if (cool(cd, h, i, 0.7)) { h.hit({ part: P2PART[i], type: 'burn', dmg: 4, point: p.p.clone().setY(p.p.y - p.r * 0.8), dir: new V(0, 1, 0), noImpulse: true }); G.fx.sparks(p.p, new V(0, 1, 0), 6, [0.6, 0.75, 1]); }
      });
      light.intensity = on ? 30 + Math.random() * 60 : 0;
      G.audio.loop('buzz', on ? 0.4 : 0, coil);
      if (on && rt <= 0) {
        rt = 0.05;
        const top = _a.set(coil.x, 2.4, coil.z);
        bolts.forEach((l, k) => { l.visible = true; const end = targets.length && k < 2 ? targets[Math.floor(Math.random() * targets.length)] : new V(c.x + (Math.random() - 0.5) * 2 * half, 0.04, c.z + (Math.random() - 0.5) * 2 * half); zig(l, top, end); });
        if (Math.random() < 0.3) G.audio.zap(coil);
      }
      if (!on) bolts.forEach(l => { l.visible = false; });
    } });
  }
  // ───────── 5. 발사대 ─────────
  {
    const c = new V(3, 0, 9);
    mesh(scene, new THREE.BoxGeometry(1.8, 0.05, 1.8), M.dark, c.x, 0.025, c.z);
    const top = mesh(scene, new THREE.BoxGeometry(1.6, 0.08, 1.6), M.stripes, c.x, 0.09, c.z);
    const springs = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const sp = mesh(scene, new THREE.TorusGeometry(0.06, 0.012, 6, 16).rotateX(Math.PI / 2), M.chrome, c.x + sx * 0.6, 0.06, c.z + sz * 0.6); springs.push(sp); }
    label(scene, '⚠ 발사대', c.x, 0.3, c.z - 0.92, Math.PI);
    let cdT = 0, pop = 0;
    list.push({ name: '발사대', pos: c, radius: 1.3, block: 0, update(dt) {
      cdT -= dt; pop = Math.max(0, pop - dt * 3);
      top.position.y = 0.09 + Math.sin(Math.min(1, pop) * Math.PI) * 0.5;
      springs.forEach(s => { s.scale.set(1, 1, 1); s.position.y = 0.06 + pop * 0.2; });
      if (cdT > 0) return;
      for (const h of G.humans) {
        const on = h.particles.some(p => Math.abs(p.p.x - c.x) < 0.8 && Math.abs(p.p.z - c.z) < 0.8 && p.p.y - p.r < 0.2);
        if (!on) continue;
        cdT = 2.5; pop = 1; G.audio.boing(c);
        const dir = new V(0, 9, 6);
        h.knock(3);
        for (const p of h.particles) p.push(dir.clone().add(new V((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), G.physics.h);
      }
    } });
  }
}
