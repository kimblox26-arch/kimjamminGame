// three.js 렌더러: 카메라 상대 좌표(부동 원점) + 로그 깊이 버퍼로 10 m ~ 100 kpc 스케일을 하나의 장면에 표현
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import * as S from './shaders.js';
import { G, C, AU, LSUN, D2R, orbitPoints, stateToElements, sub, rng, gauss, blackbody } from './orbit.js';

export let U = 1e6; // 렌더 1 단위 (기본 1000 km, 은하 규모에서는 시나리오별로 확대)
const KIND = { rocky: 0, earth: 1, gas: 2, ice: 3, lava: 4, cloud: 5, mars: 6 };
const BUMP = { rocky: 0.012, earth: 0.006, ice: 0.008, lava: 0.008, mars: 0.01, gas: 0, cloud: 0 };
const TRAIL_N = 700;
export const toR = (x, y, z, o) => o.set(x / U, z / U, -y / U);
const eclDir = (lam, bet) => { const l = lam * D2R, b = bet * D2R; return new THREE.Vector3(Math.cos(b) * Math.cos(l), Math.sin(b), -Math.cos(b) * Math.sin(l)); };
const lightUniforms = () => ({ uLPos: { value: [new THREE.Vector3(), new THREE.Vector3()] }, uLCol: { value: [new THREE.Vector3(), new THREE.Vector3()] },
  uLRad: { value: [1, 1] }, uNL: { value: 0 } });

export class View {
  constructor(canvas) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 1e-6, 1e12);
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.lens = new ShaderPass(S.lensShader); this.composer.addPass(this.lens);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.7, 0.5, 0.92); this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.hi = new THREE.SphereGeometry(1, 160, 112); this.lo = new THREE.SphereGeometry(1, 40, 28); this.quad = new THREE.PlaneGeometry(2, 2);
    this.vis = new Map(); this.pointsVis = []; this.orbits = new Map(); this.trails = new Map(); this.flashes = [];
    this.time = 0; this.tanHalf = Math.tan(27.5 * D2R); this.H = 1; this.W = 1;
    this.sun = new THREE.DirectionalLight(0xffffff, 3); this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.HemisphereLight(0x8fa4c8, 0x1a1c22, 0.35));
    this.buildSky(); this.buildShip(); this.buildPred();
  }

  setUnit(u) { U = u; this.ship.scale.setScalar(1 / U); }

  resize(w, h) {
    this.W = w; this.H = h; this.renderer.setSize(w, h, false); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.skyStars.material.uniforms.uPR.value = this.renderer.getPixelRatio();
  }

  buildSky() {
    const gc = eclDir(266.84, -5.54), ngp = eclDir(180.02, 29.81);
    const mat = new THREE.ShaderMaterial({ vertexShader: S.skyVS, fragmentShader: S.skyFS, side: THREE.BackSide, depthTest: false, depthWrite: false,
      uniforms: { uGC: { value: gc }, uNGP: { value: ngp }, uI: { value: 1 } } });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat); this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    const n = 9000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), rnd = rng(99);
    const e2 = new THREE.Vector3().crossVectors(ngp, gc).normalize(), tmp = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      if (i < n * 0.55) { const l = rnd() * Math.PI * 2, b = gauss(rnd) * 0.22;
        tmp.copy(gc).multiplyScalar(Math.cos(b) * Math.cos(l)).addScaledVector(e2, Math.cos(b) * Math.sin(l)).addScaledVector(ngp, Math.sin(b)); }
      else { const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z); tmp.set(s * Math.cos(t), z, s * Math.sin(t)); }
      tmp.toArray(pos, 3 * i);
      const m = Math.pow(rnd(), 7), T = rnd() < 0.1 ? 12000 + 18000 * rnd() : 3000 + 7000 * Math.pow(rnd(), 1.5);
      const c = blackbody(T), br = 0.25 + 2.6 * m;
      col.set([c[0] * br, c[1] * br, c[2] * br], 3 * i); size[i] = 1.2 + 3.2 * m;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.skyStars = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: S.starsVS, fragmentShader: S.starsFS, uniforms: { uPR: { value: 1 } },
      depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true }));
    this.skyStars.renderOrder = -9; this.skyStars.frustumCulled = false;
    this.scene.add(this.sky, this.skyStars);
  }

  buildShip() {
    const g = new THREE.Group(), add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
    const hull = new THREE.MeshStandardMaterial({ color: 0xdfe3ea, metalness: 0.15, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd19a32, metalness: 0.35, roughness: 0.3, emissive: 0x1a1004 });
    const pan = new THREE.MeshStandardMaterial({ color: 0x1e3478, metalness: 0.2, roughness: 0.25, emissive: 0x060e2a });
    add(new THREE.CylinderGeometry(1.4, 1.4, 6, 32), hull);
    add(new THREE.ConeGeometry(1.4, 2.6, 32), hull, 0, 4.3);
    add(new THREE.CylinderGeometry(1.65, 1.65, 2.6, 32), gold, 0, -4.3);
    add(new THREE.CylinderGeometry(0.55, 1.25, 2.2, 32, 1, true), dark, 0, -6.7);
    for (const s of [-1, 1]) { add(new THREE.BoxGeometry(7.5, 0.06, 2), pan, s * 5.6, -4.3); add(new THREE.CylinderGeometry(0.08, 0.08, 1.9, 8), dark, s * 1.9, -4.3).rotation.z = Math.PI / 2; }
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; add(new THREE.BoxGeometry(0.4, 0.5, 0.4), dark, Math.cos(a) * 1.45, 2.4, Math.sin(a) * 1.45); }
    const dish = add(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, 0.8), hull, 0, 1, 1.9); dish.scale.setScalar(0.9); dish.rotation.x = Math.PI / 2;
    const pg = new THREE.CylinderGeometry(0.9, 3.2, 1, 28, 1, true); pg.translate(0, -0.5, 0);
    this.plume = add(pg, new THREE.ShaderMaterial({ vertexShader: S.plumeVS, fragmentShader: S.plumeFS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, uniforms: { uCol: { value: new THREE.Vector3(1, .6, .3) }, uT: { value: 0 }, uTime: { value: 0 } } }), 0, -7.6);
    this.heat = add(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xff6a20, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 1.5);
    this.heat.scale.set(2.3, 6, 2.3);
    g.scale.setScalar(1 / U); g.visible = false;
    this.ship = g; this.scene.add(g);
  }

  buildPred() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2600 * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(2600 * 3), 3));
    this.pred = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
    this.pred.frustumCulled = false; this.pred.visible = false; this.scene.add(this.pred);
  }

  clear() {
    for (const v of this.vis.values()) this.scene.remove(v.g);
    for (const p of this.pointsVis) this.scene.remove(p.pts);
    for (const o of [...this.orbits.values(), ...this.trails.values()]) this.scene.remove(o.line);
    for (const f of this.flashes) this.scene.remove(f.m);
    this.vis.clear(); this.pointsVis = []; this.orbits.clear(); this.trails.clear(); this.flashes = [];
  }

  glow(col, rays, core = 6) {
    const m = new THREE.Mesh(this.quad, new THREE.ShaderMaterial({ vertexShader: S.glowVS, fragmentShader: S.glowFS, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, uniforms: { uCol: { value: new THREE.Vector3(...col) }, uTime: { value: 0 }, uI: { value: 1.4 }, uRays: { value: rays }, uCore: { value: core } } }));
    m.frustumCulled = false; return m;
  }

  makeVis(b) {
    const g = new THREE.Group(), tilt = new THREE.Group(), t = b.tilt * D2R; g.add(tilt);
    tilt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, Math.cos(t), -Math.sin(t)));
    const v = { b, g, tilt, mesh: null, atmo: null, ring: null, glow: null };
    if (b.type === 'star') {
      v.mesh = new THREE.Mesh(this.hi, new THREE.ShaderMaterial({ vertexShader: S.starVS, fragmentShader: S.starFS,
        uniforms: { uCol: { value: new THREE.Vector3(...b.color) }, uTime: { value: 0 }, uI: { value: 3.2 } } }));
      v.glow = this.glow(b.color, 1); g.add(v.glow);
    } else if (b.type === 'blackhole') {
      v.mesh = new THREE.Mesh(this.hi, new THREE.MeshBasicMaterial({ color: 0x000000 }));
    } else if (b.type === 'core') {
      v.glow = this.glow(b.color, 0, 4); v.glow.material.uniforms.uI.value = 2.2; g.add(v.glow);
    } else {
      const st = b.style || { k: 'rocky', a: [.5, .5, .5], b: [.7, .7, .7] };
      const u = Object.assign(lightUniforms(), {
        uKind: { value: KIND[st.k] ?? 0 }, uA: { value: new THREE.Vector3(...st.a) }, uB: { value: new THREE.Vector3(...(st.b || st.a)) },
        uC: { value: new THREE.Vector3(...(st.c || st.b || st.a)) }, uP: { value: new THREE.Vector4(...(st.p || [10, .3, 0, 0])) },
        uSeed: { value: (b.id * 7.13) % 17 }, uTime: { value: 0 }, uBump: { value: BUMP[st.k] ?? 0.01 }, uRadius: { value: 1 }, uCenter: { value: new THREE.Vector3() },
        uAtmo: { value: new THREE.Vector3(...(st.atmo || [0, 0, 0])) }, uAtmoK: { value: st.atmo ? 1 : 0 },
        uOcc: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uNO: { value: 0 },
        uRingIn: { value: 0 }, uRingOut: { value: 0 }, uRingN: { value: new THREE.Vector3(0, 1, 0) } });
      v.mesh = new THREE.Mesh(this.hi, new THREE.ShaderMaterial({ vertexShader: S.planetVS, fragmentShader: S.planetFS, uniforms: u }));
      if (st.atmo) {
        v.atmo = new THREE.Mesh(this.hi, new THREE.ShaderMaterial({ vertexShader: S.atmoVS, fragmentShader: S.atmoFS, side: THREE.BackSide, transparent: true,
          depthWrite: false, blending: THREE.AdditiveBlending, uniforms: Object.assign(lightUniforms(), { uCenter: u.uCenter, uAtmo: u.uAtmo,
            uR: { value: 1 }, uRa: { value: 1 }, uK: { value: 0.9 } }) }));
        v.atmo.userData.th = st.th || 0.02; g.add(v.atmo);
      }
      if (b.ring) {
        const rg = new THREE.RingGeometry(b.ring.inner / U, b.ring.outer / U, 256, 4);
        v.ring = new THREE.Mesh(rg, new THREE.ShaderMaterial({ vertexShader: S.ringVS, fragmentShader: S.ringFS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
          uniforms: Object.assign(lightUniforms(), { uCenter: u.uCenter, uCol: { value: new THREE.Vector3(...b.ring.col) }, uIn: { value: 1 }, uOut: { value: 2 }, uR: { value: 1 }, uOp: { value: b.ring.op } }) }));
        v.ring.rotation.x = -Math.PI / 2; tilt.add(v.ring);
      }
    }
    if (v.mesh) tilt.add(v.mesh);
    this.scene.add(g); this.vis.set(b.id, v);
    return v;
  }

  setGroups(groups) {
    for (const p of this.pointsVis) this.scene.remove(p.pts);
    this.pointsVis = groups.map(gr => {
      const geo = new THREE.BufferGeometry(), col = new Float32Array(gr.n * 4);
      for (let i = 0; i < gr.n; i++) { col[4 * i] = gr.col[3 * i]; col[4 * i + 1] = gr.col[3 * i + 1]; col[4 * i + 2] = gr.col[3 * i + 2]; }
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gr.n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aCol', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aVel', new THREE.BufferAttribute(new Float32Array(gr.n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const pts = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: S.partVS, fragmentShader: S.partFS, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, uniforms: { uSize: { value: gr.size }, uPR: { value: this.renderer.getPixelRatio() }, uBeam: { value: gr.beam ? 1 : 0 } } }));
      pts.frustumCulled = false; this.scene.add(pts);
      return { gr, pts };
    });
  }

  flash(posP, size, col) {
    const m = this.glow(col, 1, 3); this.scene.add(m);
    this.flashes.push({ m, pos: posP.slice(), size, t: 0 });
  }

  // 케플러 접촉 궤도선 (기준 천체 상대)
  updateOrbits(bodies, focusId) {
    const seen = new Set();
    for (const b of bodies) {
      const p = b.parent; if (!p || b.type === 'core') continue;
      seen.add(b.id);
      let o = this.orbits.get(b.id);
      if (!o) {
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(257 * 3), 3));
        o = { line: new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(...b.color).lerp(new THREE.Color(0.6, 0.75, 1), 0.5), transparent: true, opacity: 0.4 })) };
        o.line.frustumCulled = false; this.scene.add(o.line); this.orbits.set(b.id, o);
      }
      const el = stateToElements(G * (p.mass + b.mass), sub(b.pos, p.pos), sub(b.vel, p.vel));
      const pts = orbitPoints(el, 257, p.soi && isFinite(p.soi) ? p.soi * 1.5 : el.pe * 40), arr = o.line.geometry.attributes.position.array;
      for (let k = 0; k < 257; k++) { arr[3 * k] = pts[3 * k] / U; arr[3 * k + 1] = pts[3 * k + 2] / U; arr[3 * k + 2] = -pts[3 * k + 1] / U; }
      o.line.geometry.attributes.position.needsUpdate = true;
      o.parent = p; o.size = (el.e < 1 ? el.a : el.pe * 4) / U;
      o.line.material.opacity = b.id === focusId ? 0.8 : 0.22;
    }
    for (const [id, o] of this.orbits) if (!seen.has(id)) { this.scene.remove(o.line); this.orbits.delete(id); }
  }

  addTrailSample(bodies, frame) {
    for (const b of bodies) {
      let tr = this.trails.get(b.id);
      if (!tr) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3)); geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
        tr = { line: new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })), n: 0, b };
        tr.line.frustumCulled = false; this.scene.add(tr.line); this.trails.set(b.id, tr);
      }
      const anc = frame === 'parent' && b.parent && b.parent.mass > 10 * b.mass ? b.parent : null;
      if (tr.anchor !== anc) { tr.anchor = anc; tr.n = 0; }
      const pa = tr.line.geometry.attributes.position.array;
      if (tr.n === TRAIL_N) pa.copyWithin(0, 3); else tr.n++;
      const k = 3 * (tr.n - 1), a = anc ? anc.pos : [0, 0, 0];
      pa[k] = (b.pos[0] - a[0]) / U; pa[k + 1] = (b.pos[2] - a[2]) / U; pa[k + 2] = -(b.pos[1] - a[1]) / U;
      tr.line.geometry.attributes.position.needsUpdate = true;
      tr.line.geometry.setDrawRange(0, tr.n);
      if (tr.n < TRAIL_N || !tr.colored) {
        const ca = tr.line.geometry.attributes.color.array, c = b.type === 'star' || b.type === 'core' ? b.color : b.color.map(x => 0.35 + 0.65 * x);
        const dim = Math.min(1, 3.5 / Math.sqrt(bodies.length));
        for (let i = 0; i < tr.n; i++) { const f = Math.pow(i / tr.n, 1.5) * 0.9 * dim; ca[3 * i] = c[0] * f; ca[3 * i + 1] = c[1] * f; ca[3 * i + 2] = c[2] * f; }
        tr.line.geometry.attributes.color.needsUpdate = true; tr.colored = tr.n === TRAIL_N;
      }
    }
  }
  clearTrails() { for (const t of this.trails.values()) this.scene.remove(t.line); this.trails.clear(); }

  // 프레임 갱신
  update(sim, camW, look, camDist, o) {
    const cam = this.camera, tmp = new THREE.Vector3(), bodies = sim.bodies;
    this.time += o.dtReal;
    cam.position.set(0, 0, 0); cam.up.set(0, 1, 0); cam.lookAt(look);
    cam.near = Math.max(camDist * 0.002, 1e-9); cam.far = Math.max(camDist, 1) * 1e10; cam.updateProjectionMatrix();
    const skyR = Math.sqrt(cam.near * cam.far); this.sky.scale.setScalar(skyR); this.skyStars.scale.setScalar(skyR);
    const pxk = this.H / 2 / this.tanHalf;
    const stars = bodies.filter(b => b.type === 'star');
    const alive = new Set();
    const kids = new Map();
    for (const b of bodies) if (b.parent) { if (!kids.has(b.parent)) kids.set(b.parent, []); kids.get(b.parent).push(b); }
    for (const b of bodies) {
      alive.add(b.id);
      const v = this.vis.get(b.id) || this.makeVis(b);
      toR(b.pos[0] - camW[0], b.pos[1] - camW[1], b.pos[2] - camW[2], v.g.position);
      const d = v.g.position.length(), rr = b.radius / U; v.pr = rr / d * pxk; v.d = d;
      if (v.mesh) {
        v.mesh.scale.setScalar(rr); v.mesh.visible = v.pr > 0.25;
        v.mesh.geometry = v.pr > 50 ? this.hi : this.lo;
        if (b.rotP) v.mesh.rotation.y = (2 * Math.PI * (sim.t / b.rotP % 1));
      }
      if (b.type === 'star') {
        v.mesh.material.uniforms.uTime.value = this.time;
        v.glow.scale.setScalar(Math.max(rr * 8, d * 0.03)); v.glow.quaternion.copy(cam.quaternion); v.glow.material.uniforms.uTime.value = this.time;
      } else if (b.type === 'core') {
        v.glow.scale.setScalar(Math.max(3 * 3.0857e19 / U, d * 0.02)); v.glow.quaternion.copy(cam.quaternion);
      } else if (v.mesh && v.mesh.material.uniforms && v.mesh.visible) this.shadePlanet(v, b, stars, kids, cam);
    }
    for (const [id, v] of this.vis) if (!alive.has(id)) { this.scene.remove(v.g); this.vis.delete(id); }
    for (const [id, tr] of this.trails) if (!alive.has(id)) { this.scene.remove(tr.line); this.trails.delete(id); }

    // 접촉 궤도선 / 궤적
    for (const o2 of this.orbits.values()) {
      const pv = this.vis.get(o2.parent.id);
      o2.line.visible = o.orbitMode === 'kepler' && !!pv && (o2.size / Math.max(pv.d, 1e-9)) * pxk > 6;
      if (pv) o2.line.position.copy(pv.g.position);
    }
    for (const tr of this.trails.values()) {
      tr.line.visible = o.orbitMode === 'trail';
      const a = tr.anchor ? tr.anchor.pos : [0, 0, 0];
      toR(a[0] - camW[0], a[1] - camW[1], a[2] - camW[2], tr.line.position);
    }

    // 시험 입자
    for (const { gr, pts } of this.pointsVis) {
      const pa = pts.geometry.attributes.position.array, ca = pts.geometry.attributes.aCol.array, va = pts.geometry.attributes.aVel.array;
      for (let i = 0; i < gr.n; i++) {
        const x = gr.P[3 * i], y = gr.P[3 * i + 1], z = gr.P[3 * i + 2];
        pa[3 * i] = x / U; pa[3 * i + 1] = z / U; pa[3 * i + 2] = -y / U;
        ca[4 * i + 3] = gr.alive[i] ? gr.alpha : 0;
        if (gr.beam) { va[3 * i] = gr.V[3 * i] / C; va[3 * i + 1] = gr.V[3 * i + 2] / C; va[3 * i + 2] = -gr.V[3 * i + 1] / C; }
      }
      pts.geometry.attributes.position.needsUpdate = true; pts.geometry.attributes.aCol.needsUpdate = true;
      if (gr.beam) pts.geometry.attributes.aVel.needsUpdate = true;
      toR(-camW[0], -camW[1], -camW[2], pts.position); pts.visible = o.showParticles;
    }

    // 우주선
    const sh = o.ship;
    this.ship.visible = !!(sh && sh.alive);
    if (sh && sh.alive) {
      toR(sh.pos[0] - camW[0], sh.pos[1] - camW[1], sh.pos[2] - camW[2], this.ship.position); this.ship.quaternion.copy(sh.q);
      const e = sh.eng, th = sh.burning() ? sh.throttle : 0, pu = this.plume.material.uniforms;
      pu.uT.value += (th - pu.uT.value) * Math.min(1, o.dtReal * 12); pu.uTime.value = this.time; pu.uCol.value.set(...e.col);
      this.plume.visible = pu.uT.value > 0.01; this.plume.scale.set(1, 4 + 22 * pu.uT.value, 1);
      this.heat.material.opacity = Math.min(0.8, Math.max(0, Math.log10(Math.max(sh.heat, 1)) - 5) * 0.4);
      let best = null, bf = 0;
      for (const s of stars) { const f = s.lum / ((s.pos[0] - sh.pos[0]) ** 2 + (s.pos[1] - sh.pos[1]) ** 2 + (s.pos[2] - sh.pos[2]) ** 2); if (f > bf) { bf = f; best = s; } }
      if (best) {
        toR(best.pos[0] - sh.pos[0], best.pos[1] - sh.pos[1], best.pos[2] - sh.pos[2], tmp).normalize();
        this.sun.position.copy(this.ship.position).addScaledVector(tmp, 1e-3); this.sun.target.position.copy(this.ship.position);
        this.sun.color.setRGB(...best.color); this.sun.intensity = 2.6 * Math.min(1.5, Math.pow(bf / (LSUN / (AU * AU)), 0.2));
      }
    }
    // 예측 궤적
    const pr = sh && sh.alive && sh.pred;
    this.pred.visible = !!pr;
    if (pr) {
      const pv = this.vis.get(pr.ref.id); const n = Math.min(pr.pts.length / 3, 2600);
      const pa = this.pred.geometry.attributes.position.array, ca = this.pred.geometry.attributes.color.array;
      for (let k = 0; k < n; k++) {
        pa[3 * k] = pr.pts[3 * k] / U; pa[3 * k + 1] = pr.pts[3 * k + 2] / U; pa[3 * k + 2] = -pr.pts[3 * k + 1] / U;
        const after = pr.enc && k >= pr.enc.idx, f = 1 - 0.6 * k / n;
        ca[3 * k] = (after ? 1 : 0.3) * f; ca[3 * k + 1] = (after ? 0.6 : 0.9) * f; ca[3 * k + 2] = (after ? 0.2 : 1) * f;
      }
      if (pr.impact) for (let k = Math.max(0, n - 12); k < n; k++) { ca[3 * k] = 1; ca[3 * k + 1] = 0.15; ca[3 * k + 2] = 0.1; }
      this.pred.geometry.setDrawRange(0, n);
      this.pred.geometry.attributes.position.needsUpdate = true; this.pred.geometry.attributes.color.needsUpdate = true;
      if (pv) this.pred.position.copy(pv.g.position);
    }
    // 폭발/충돌 섬광
    this.flashes = this.flashes.filter(f => {
      f.t += o.dtReal; toR(f.pos[0] - camW[0], f.pos[1] - camW[1], f.pos[2] - camW[2], f.m.position);
      const d = f.m.position.length(); f.m.scale.setScalar(Math.max(f.size / U * (0.5 + f.t), d * 0.05 * (0.5 + f.t)));
      f.m.quaternion.copy(cam.quaternion); f.m.material.uniforms.uI.value = 4 * Math.max(0, 1 - f.t / 2.5);
      if (f.t > 2.5) { this.scene.remove(f.m); return false; }
      return true;
    });
    // 중력 렌즈 (가장 가까운 블랙홀)
    const lu = this.lens.uniforms; lu.uOn.value = 0;
    if (o.lens) {
      let best = null;
      for (const b of bodies) if (b.type === 'blackhole') { const v = this.vis.get(b.id); if (!best || v.d < best.d) best = v; }
      if (best) {
        tmp.copy(best.g.position).project(cam);
        const ang = (2.6 * best.b.radius / U) / best.d, ur = ang / (2 * this.tanHalf);
        if (tmp.z < 1 && ur > 4e-4 && Math.abs(tmp.x) < 3 && Math.abs(tmp.y) < 3) {
          lu.uOn.value = 1; lu.uC.value = [(tmp.x + 1) / 2, (tmp.y + 1) / 2]; lu.uR.value = ur; lu.uAsp.value = this.W / this.H;
        }
      }
    }
    this.bloom.strength = o.bloom;
    this.composer.render();
  }

  shadePlanet(v, b, stars, kids, cam) {
    const u = v.mesh.material.uniforms, pos = v.g.position, rr = b.radius / U;
    u.uCenter.value.copy(pos); u.uRadius.value = rr; u.uTime.value = this.time;
    // 광원: 플럭스가 큰 항성 2개
    const ls = stars.map(s => { const d2 = (s.pos[0] - b.pos[0]) ** 2 + (s.pos[1] - b.pos[1]) ** 2 + (s.pos[2] - b.pos[2]) ** 2; return { s, f: s.lum / d2 }; })
      .sort((a, c) => c.f - a.f).slice(0, 2);
    u.uNL.value = ls.length;
    ls.forEach(({ s, f }, i) => {
      const sv = this.vis.get(s.id); if (sv) u.uLPos.value[i].copy(sv.g.position);
      const I = 1.0 * Math.min(2.0, Math.max(0.3, Math.pow(f / (LSUN / (AU * AU)), 0.18)));
      u.uLCol.value[i].set(s.color[0] * I, s.color[1] * I, s.color[2] * I); u.uLRad.value[i] = s.radius / U;
    });
    // 일식/월식 차폐체: 모천체·위성·형제
    const fam = [];
    if (b.parent && b.parent.type !== 'star') fam.push(b.parent);
    for (const k of kids.get(b) || []) fam.push(k);
    if (b.parent) for (const k of kids.get(b.parent) || []) if (k !== b) fam.push(k);
    const occ = fam.filter(c => c.type !== 'star' && c.type !== 'core' && c.radius > 0)
      .map(c => ({ c, k: c.radius / Math.hypot(c.pos[0] - b.pos[0], c.pos[1] - b.pos[1], c.pos[2] - b.pos[2]) })).sort((a, c) => c.k - a.k).slice(0, 4);
    u.uNO.value = occ.length;
    occ.forEach(({ c }, i) => { const cv = this.vis.get(c.id); if (cv) u.uOcc.value[i].set(cv.g.position.x, cv.g.position.y, cv.g.position.z, c.radius / U); });
    if (v.ring) {
      const ru = v.ring.material.uniforms, inn = b.ring.inner / U, out = b.ring.outer / U;
      ru.uIn.value = inn; ru.uOut.value = out; ru.uR.value = rr; ru.uNL.value = u.uNL.value;
      for (let i = 0; i < 2; i++) { ru.uLPos.value[i].copy(u.uLPos.value[i]); ru.uLCol.value[i].copy(u.uLCol.value[i]); }
      u.uRingIn.value = inn; u.uRingOut.value = out; u.uRingN.value.set(0, 1, 0).applyQuaternion(v.tilt.quaternion);
    }
    if (v.atmo) {
      const au = v.atmo.material.uniforms, ra = rr * (1 + v.atmo.userData.th);
      v.atmo.scale.setScalar(ra); v.atmo.visible = v.pr > 1.5; v.atmo.geometry = v.mesh.geometry;
      au.uR.value = rr; au.uRa.value = ra; au.uNL.value = u.uNL.value;
      for (let i = 0; i < 2; i++) { au.uLPos.value[i].copy(u.uLPos.value[i]); au.uLCol.value[i].copy(u.uLCol.value[i]); }
    }
  }

  project(p, out) {
    const v = out.copy(p).project(this.camera);
    return { x: (v.x + 1) / 2 * this.W, y: (1 - v.y) / 2 * this.H, ok: v.z < 1 && v.z > -1 };
  }
}
