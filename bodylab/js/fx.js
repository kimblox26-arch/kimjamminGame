// 효과: 피 방울·튐·웅덩이·물속 피, 총알 자국, 불꽃, 연기, 폭발, 물보라, 튀어나온 장기(물리)
import * as THREE from 'three';
import { Particle, Constraint } from './physics.js';
import { organMaterial, xrayMaterial, ORGAN_COLORS } from './anatomy.js';
import { canvas, toTex } from './tex.js';

const V = THREE.Vector3;
const _a = new V(), _b = new V(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new V(), Z = new V(0, 0, 1);

class Points {
  constructor(scene, max, { additive = false, soft = 0.5, gravity = 0, drag = 0, sizeScale = 1 } = {}) {
    this.max = max; this.n = 0; this.gravity = gravity; this.drag = drag;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.age = new Float32Array(max); this.grow = new Float32Array(max); this.a0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 800 * sizeScale }, uSoft: { value: soft } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float uScale;
        void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*uScale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec4 vC; uniform float uSoft; void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d)*2.0; float a=1.0-smoothstep(1.0-uSoft,1.0,r); if(a<=0.0) discard; gl_FragColor=vec4(vC.rgb,vC.a*a); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.obj = new THREE.Points(g, this.mat); this.obj.frustumCulled = false; scene.add(this.obj);
  }
  spawn(p, v, life, size, r, g, b, a, grow = 0) {
    let i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3); this.col.set([r, g, b, a], i * 4);
    this.size[i] = size; this.life[i] = life; this.age[i] = 0; this.grow[i] = grow; this.a0[i] = a;
    return i;
  }
  kill(i) {
    const j = --this.n;
    if (i !== j) {
      this.pos.copyWithin(i * 3, j * 3, j * 3 + 3); this.vel.copyWithin(i * 3, j * 3, j * 3 + 3); this.col.copyWithin(i * 4, j * 4, j * 4 + 4);
      this.size[i] = this.size[j]; this.life[i] = this.life[j]; this.age[i] = this.age[j]; this.grow[i] = this.grow[j]; this.a0[i] = this.a0[j];
    }
  }
  update(dt, hit) {
    const d = Math.exp(-this.drag * dt);
    for (let i = this.n - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.kill(i); continue; }
      const k = i * 3;
      this.vel[k + 1] -= this.gravity * dt;
      this.vel[k] *= d; this.vel[k + 1] *= d; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const f = this.age[i] / this.life[i];
      this.col[i * 4 + 3] = this.a0[i] * (f > 0.7 ? (1 - f) / 0.3 : 1);
      if (hit && hit(i, k)) this.kill(i);
    }
    const g = this.obj.geometry;
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.size.needsUpdate = true;
    g.setDrawRange(0, this.n);
  }
}

function decalAtlas() {
  const S = 512, c = canvas(S), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const blot = (ox, oy, n, spread, seed) => {
    let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(ox + 128, oy + 128, 46, 0, 7); g.fill();
    for (let i = 0; i < n; i++) { const a = rnd() * 6.28, d = Math.pow(rnd(), 0.7) * spread, r = (1 - d / spread) * 22 * rnd() + 2;
      g.beginPath(); g.arc(ox + 128 + Math.cos(a) * d, oy + 128 + Math.sin(a) * d, r, 0, 7); g.fill();
      if (rnd() < 0.3) { g.beginPath(); g.ellipse(ox + 128 + Math.cos(a) * d * 0.6, oy + 128 + Math.sin(a) * d * 0.6, d * 0.4, 4, a, 0, 7); g.fill(); } }
  };
  blot(0, 0, 60, 120, 7); blot(256, 0, 90, 115, 31);
  // 웅덩이
  g.fillStyle = '#fff'; g.beginPath();
  for (let i = 0; i <= 40; i++) { const a = i / 40 * 6.283, r = 100 + Math.sin(a * 3) * 10 + Math.sin(a * 7 + 1) * 6; i ? g.lineTo(128 + Math.cos(a) * r, 384 + Math.sin(a) * r) : g.moveTo(128 + Math.cos(a) * r, 384 + Math.sin(a) * r); }
  g.fill();
  // 총알 구멍 (알파: 그을음)
  const gr = g.createRadialGradient(384, 384, 4, 384, 384, 90);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.12, '#fff'); gr.addColorStop(0.2, '#aaa'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.beginPath(); g.arc(384, 384, 90, 0, 7); g.fill();
  const t = toTex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export class FX {
  constructor(G) {
    this.G = G; const scene = G.scene;
    this.blood = new Points(scene, 2500, { soft: 0.25, gravity: 9.81, sizeScale: 1 });
    this.mist = new Points(scene, 800, { soft: 0.9, drag: 4 });
    this.spark = new Points(scene, 800, { additive: true, soft: 0.6, gravity: 6, drag: 1 });
    this.fire = new Points(scene, 600, { additive: true, soft: 0.95, drag: 3 });
    this.smoke = new Points(scene, 600, { soft: 0.95, drag: 1.5 });
    this.splash = new Points(scene, 800, { soft: 0.5, gravity: 9.81 });
    this.cloud = new Points(scene, 400, { soft: 0.98, drag: 0.6 });
    this.cloud.mat.depthTest = true;
    // 자국 (인스턴스)
    this.maxD = 1400; this.nD = 0;
    const atlas = decalAtlas();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: atlas, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.12, metalness: 0, envMapIntensity: 1.2 });
    this.tile = new THREE.InstancedBufferAttribute(new Float32Array(this.maxD), 1);
    mat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aTile;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAlphaMapUv = vAlphaMapUv*0.5 + vec2(mod(aTile,2.0), 1.0-floor(aTile/2.0))*0.5;');
    };
    const geo = new THREE.PlaneGeometry(1, 1); geo.setAttribute('aTile', this.tile);
    this.decals = new THREE.InstancedMesh(geo, mat, this.maxD);
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.decals.count = 0; this.decals.frustumCulled = false; this.decals.receiveShadow = true;
    this.decals.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxD * 3), 3);
    scene.add(this.decals);
    this.dInfo = []; // {pos, n, size, grow, max, owner}
    this.pools = [];
    // 섬광 조명
    this.flash = new THREE.PointLight(0xffb060, 0, 12, 2); scene.add(this.flash); this.flashT = 0;
    this.rings = [];
    this.gibs = new Set();
    this.organX = {};
  }
  // 자국 추가 tile: 0,1 튄 피 / 2 웅덩이 / 3 총알 구멍
  decal(p, n, size, tile, color, spin = Math.random() * 6.28, owner = null) {
    const i = this.nD < this.maxD ? this.nD++ : (this.dIdx = ((this.dIdx || 0) + 1) % this.maxD);
    _q.setFromUnitVectors(Z, n);
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, spin));
    _a.copy(p).addScaledVector(n, 0.012 + (i % 7) * 0.0004);
    _m.compose(_a, _q, _s.set(size, size, 1));
    this.decals.setMatrixAt(i, _m);
    this.decals.setColorAt(i, color);
    this.tile.setX(i, tile); this.tile.needsUpdate = true;
    this.decals.count = Math.max(this.decals.count, i + 1);
    this.decals.instanceMatrix.needsUpdate = true; this.decals.instanceColor.needsUpdate = true;
    this.dInfo[i] = { p: _a.clone(), q: _q.clone(), size };
    return i;
  }
  resize(i, size) { const d = this.dInfo[i]; d.size = size; _m.compose(d.p, d.q, _s.set(size, size, 1)); this.decals.setMatrixAt(i, _m); this.decals.instanceMatrix.needsUpdate = true; }
  // 피 튀기기: dir 방향으로 강하게 (출구) + 사방
  bloodBurst(p, dir, power = 1, amount = 1) {
    const n = Math.floor(28 * amount);
    for (let i = 0; i < n; i++) {
      _a.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(0.6 + Math.random() * 1.5);
      if (dir) _a.addScaledVector(dir, (1 + Math.random() * 4) * power);
      this.drop(p, _a, 0.7 + Math.random() * 1.6);
    }
    for (let i = 0; i < 10 * amount; i++) { _a.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.2); if (dir) _a.addScaledVector(dir, power * 1.5); this.mist.spawn(p, _a, 0.5 + Math.random() * 0.5, 0.02 + Math.random() * 0.03, 0.35, 0.01, 0.01, 0.5, 0.12); }
  }
  drop(p, v, s = 1) {
    const W = this.G.world;
    if (W.inPool(p.x, p.z) && p.y < W.water.surface) { this.cloud.spawn(p, _b.set(v.x * 0.05, 0.02, v.z * 0.05), 14, 0.04 * s, 0.32, 0.02, 0.02, 0.32, 0.03); return; }
    this.blood.spawn(p, v, 3, 0.0045 * s + 0.002, 0.28 + Math.random() * 0.1, 0.01, 0.01, 0.95);
  }
  pool(owner, p, amount) {
    const W = this.G.world; if (W.inPool(p.x, p.z)) return;
    let pl = this.pools.find(q => q.owner === owner && q.p.distanceTo(_a.set(p.x, q.p.y, p.z)) < 0.4);
    const g = W.groundAt(p.x, p.z);
    if (!pl) { pl = { owner, p: new V(p.x, g, p.z), size: 0.05, i: this.decal(new V(p.x, g, p.z), new V(0, 1, 0), 0.05, 2, new THREE.Color(0.2, 0.004, 0.004)) }; this.pools.push(pl); }
    pl.size = Math.min(1.8, Math.sqrt(pl.size * pl.size + amount * 0.6));
    this.resize(pl.i, pl.size);
  }
  hole(p, n, kind) {
    this.decal(p, n, 0.05 + Math.random() * 0.03, 3, new THREE.Color(0.03, 0.03, 0.03));
    for (let i = 0; i < 8; i++) { _a.copy(n).multiplyScalar(1 + Math.random() * 2).add(_b.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.5)); this.smoke.spawn(p, _a, 0.6 + Math.random() * 0.6, 0.03, 0.55, 0.53, 0.5, 0.35, 0.25); }
    const ns = kind === 'metal' ? 14 : 5;
    for (let i = 0; i < ns; i++) { _a.copy(n).multiplyScalar(2 + Math.random() * 3).add(_b.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4)); this.spark.spawn(p, _a, 0.2 + Math.random() * 0.3, 0.01, 1, 0.75, 0.35, 1); }
  }
  sparks(p, dir, n = 10, col = [1, 0.7, 0.3]) { for (let i = 0; i < n; i++) { _a.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).multiplyScalar(3); if (dir) _a.addScaledVector(dir, 3 + Math.random() * 3); this.spark.spawn(p, _a, 0.15 + Math.random() * 0.35, 0.008 + Math.random() * 0.01, col[0], col[1], col[2], 1); } }
  muzzle(p, dir, big = 1) {
    for (let i = 0; i < 10 * big; i++) { _a.copy(dir).multiplyScalar(2 + Math.random() * 6).add(_b.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.5)); this.fire.spawn(p, _a, 0.05 + Math.random() * 0.04, 0.03 + Math.random() * 0.04 * big, 1, 0.65, 0.25, 1, 0.4); }
    for (let i = 0; i < 6 * big; i++) { _a.copy(dir).multiplyScalar(0.5 + Math.random()).add(_b.set(Math.random() - 0.5, Math.random(), Math.random() - 0.5).multiplyScalar(0.3)); this.smoke.spawn(p, _a, 1 + Math.random(), 0.04, 0.6, 0.6, 0.6, 0.25, 0.25); }
    this.light(p, 3 * big, 0.06);
  }
  light(p, intensity, dur, color = 0xffb060) { this.flash.position.copy(p); this.flash.intensity = intensity * 40; this.flash.color.set(color); this.flashT = dur; this.flashI = this.flash.intensity; this.flashD = dur; }
  explosion(p) {
    for (let i = 0; i < 160; i++) { _a.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 9); const h = Math.random(); this.fire.spawn(p, _a, 0.25 + Math.random() * 0.5, 0.15 + Math.random() * 0.25, 1, 0.45 + h * 0.4, 0.12 + h * 0.2, 1, 1.2); }
    for (let i = 0; i < 90; i++) { _a.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(1 + Math.random() * 4); const c = 0.12 + Math.random() * 0.15; this.smoke.spawn(p, _a, 2 + Math.random() * 3, 0.3 + Math.random() * 0.3, c, c, c, 0.65, 0.6); }
    this.sparks(p, null, 80, [1, 0.6, 0.2]);
    this.light(p, 60, 0.35, 0xffa040);
    const g = this.G.world.groundAt(p.x, p.z);
    if (p.y - g < 1.2) this.decal(new V(p.x, g, p.z), new V(0, 1, 0), 2.2, 0, new THREE.Color(0.02, 0.018, 0.016));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffd0a0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.set(p.x, g + 0.05, p.z); ring.rotation.x = -Math.PI / 2; this.G.scene.add(ring); this.rings.push({ m: ring, t: 0, life: 0.4, s: 6 });
  }
  waterSplash(p, power = 1) {
    const W = this.G.world, y = W.water.surface;
    for (let i = 0; i < 40 * power; i++) { _a.set((Math.random() - 0.5) * 2, 2 + Math.random() * 4 * power, (Math.random() - 0.5) * 2); this.splash.spawn(_b.set(p.x, y, p.z), _a, 1.2, 0.012 + Math.random() * 0.015, 0.85, 0.93, 1, 0.8); }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }));
    ring.position.set(p.x, y + 0.01, p.z); ring.rotation.x = -Math.PI / 2; this.G.scene.add(ring); this.rings.push({ m: ring, t: 0, life: 1.5, s: 2 * power });
    this.G.audio?.splash(p, power);
  }

  // ───────── 튀어나온 장기 ─────────
  spawnGib(human, organ, wm, vel, part) {
    const G = this.G, id = organ.def.id;
    const c = new V(...organ.def.c).applyMatrix4(wm);
    const mat = organMaterial(id);
    const xm = this.organX[id] || (this.organX[id] = xrayMaterial(new THREE.Color(ORGAN_COLORS[id]).lerp(new THREE.Color(1, 0.6, 0.5), 0.4), { solid: 0.4, rim: 1.5, power: 0.9 }));
    const gib = { human, id, particles: [], constraints: [], mesh: null, rope: id === 'intestine' };
    if (gib.rope) {
      const n = 22, anchor = human.particles[part === 'chest' ? 2 : 3];
      let p = c.clone();
      for (let i = 0; i < n; i++) {
        const q = new Particle(p, 0.016, 0.08); q.fric = 1.5; q.buoy = 1.1;
        q.push(_a.copy(vel).multiplyScalar(1 - i / n * 0.6).add(_b.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)), G.physics.h);
        gib.particles.push(q);
        p = p.clone().add(_a.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.04));
      }
      for (let i = 0; i < n - 1; i++) gib.constraints.push(new Constraint(gib.particles[i], gib.particles[i + 1], 0.02, 0.055));
      gib.constraints.push(new Constraint(anchor, gib.particles[0], 0, 0.14, 0.6));
      gib.mat = mat;
      gib.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      gib.update = () => {
        const pts = gib.particles.map(q => q.p);
        gib.mesh.geometry.dispose();
        gib.mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([human.particles[part === 'chest' ? 2 : 3].p.clone().lerp(pts[0], 0.6), ...pts]), 90, 0.0135, 8, false);
      };
      gib.update();
    } else {
      const r = Math.cbrt(organ.r.x * organ.r.y * organ.r.z);
      const q = new Particle(c, Math.max(0.025, r * 0.9), 0.5); q.fric = 1.3;
      q.push(vel, G.physics.h);
      gib.particles.push(q);
      const geo = organ.geo.clone(); geo.translate(-organ.def.c[0], -organ.def.c[1], -organ.def.c[2]);
      gib.mesh = new THREE.Mesh(geo, mat);
      gib.mesh.quaternion.setFromRotationMatrix(wm);
      gib.spin = new V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
      gib.update = (dt) => {
        const p = gib.particles[0];
        gib.mesh.position.copy(p.p);
        if (p.touch) gib.spin.multiplyScalar(Math.exp(-dt * 6));
        _q.setFromAxisAngle(_a.copy(gib.spin).normalize(), gib.spin.length() * dt);
        if (gib.spin.lengthSq() > 1e-6) gib.mesh.quaternion.premultiply(_q);
      };
      gib.update(0);
    }
    gib.mesh.castShadow = gib.mesh.receiveShadow = true; gib.mesh.frustumCulled = false;
    gib.mesh.layers.enable(1);
    G.xraySwap.push({ mesh: gib.mesh, x: xm });
    G.scene.add(gib.mesh);
    gib.onImpact = (pt, speed) => { if (speed > 2) { this.decal(pt.p.clone().setY(G.world.groundAt(pt.p.x, pt.p.z)), new V(0, 1, 0), 0.08 + Math.random() * 0.1, Math.random() < 0.5 ? 0 : 1, new THREE.Color(0.24, 0.006, 0.006)); if (speed > 4) G.audio.splat(pt.p, 0.4); } };
    G.physics.add(gib);
    this.gibs.add(gib);
    return gib;
  }
  removeGib(g) {
    this.G.physics.remove(g); this.gibs.delete(g); this.G.scene.remove(g.mesh); g.mesh.geometry.dispose();
    const k = this.G.xraySwap.findIndex(s => s.mesh === g.mesh); if (k >= 0) this.G.xraySwap.splice(k, 1);
  }

  update(dt) {
    const W = this.G.world;
    const hitBlood = (i, k) => {
      const P = this.blood.pos, x = P[k], y = P[k + 1], z = P[k + 2];
      if (W.inPool(x, z) && y < W.water.surface) { this.cloud.spawn(_a.set(x, W.water.surface - 0.05, z), _b.set(0, 0, 0), 16, 0.06, 0.3, 0.02, 0.02, 0.35, 0.05); return true; }
      for (const b of W.solids) {
        if (x < b.min.x || x > b.max.x || y < b.min.y || y > b.max.y || z < b.min.z || z > b.max.z) continue;
        // 가장 가까운 면
        const f = [x - b.min.x, b.max.x - x, y - b.min.y, b.max.y - y, z - b.min.z, b.max.z - z];
        let m = 0; for (let j = 1; j < 6; j++) if (f[j] < f[m]) m = j;
        const n = _b.set(0, 0, 0); n.setComponent(m >> 1, m & 1 ? 1 : -1);
        const p = _a.set(x, y, z); p.setComponent(m >> 1, m & 1 ? b.max.getComponent(m >> 1) : b.min.getComponent(m >> 1));
        const sp = Math.hypot(this.blood.vel[k], this.blood.vel[k + 1], this.blood.vel[k + 2]);
        if (Math.random() < 0.55) this.decal(p, n.clone(), 0.02 + Math.min(0.25, sp * 0.02) * Math.random() + this.blood.size[i] * 6, Math.random() < 0.5 ? 0 : 1, new THREE.Color(0.2 + Math.random() * 0.08, 0.005, 0.005));
        return true;
      }
      return false;
    };
    this.blood.update(dt, hitBlood);
    this.mist.update(dt); this.spark.update(dt); this.fire.update(dt); this.smoke.update(dt);
    this.splash.update(dt, (i, k) => this.splash.pos[k + 1] < W.water.surface && this.splash.vel[k + 1] < 0);
    this.cloud.update(dt);
    if (this.flashT > 0) { this.flashT -= dt; this.flash.intensity = Math.max(0, this.flashI * this.flashT / this.flashD); } else this.flash.intensity = 0;
    for (let i = this.rings.length - 1; i >= 0; i--) { const r = this.rings[i]; r.t += dt; const f = r.t / r.life; r.m.scale.setScalar(0.1 + f * r.s); r.m.material.opacity = (1 - f) * 0.5; if (f >= 1) { this.G.scene.remove(r.m); r.m.geometry.dispose(); this.rings.splice(i, 1); } }
    for (const g of this.gibs) g.update(dt);
  }
}
