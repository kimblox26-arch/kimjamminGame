// 이펙트: 파티클(불꽃/먼지/피/연기/화염), 탄흔 데칼, 예광탄, 탄피·탄창 물리, 폭발 + 탄도 계산
import * as THREE from 'three';
import { T } from './textures.js';
import { casingGeo, gunMats } from './guns.js';
import { patchInterior } from './world.js';
import { Audio } from './audio.js';
import { rand, clamp, lerp, pick } from './core.js';

// ── GPU 포인트 파티클 ──
class Particles {
  constructor(scene, max, tex, additive) {
    this.max = max; this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max); this.ang = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('angle', new THREE.BufferAttribute(this.ang, 1).setUsage(THREE.DynamicDrawUsage));
    this.v = new Float32Array(max * 3); this.life = new Float32Array(max); this.max_ = new Float32Array(max);
    this.grow = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max); this.spin = new Float32Array(max);
    this.a0 = new Float32Array(max); this.s0 = new Float32Array(max); this.fadeIn = new Float32Array(max);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: tex }, uScale: { value: 500 } }]),
      vertexShader: `attribute float size; attribute vec4 pcolor; attribute float angle; varying vec4 vC; varying float vA; uniform float uScale;
        #include <fog_pars_vertex>
        void main(){ vec4 mvPosition = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mvPosition; gl_PointSize = min(size*uScale/max(-mvPosition.z,0.05), 512.); vC = pcolor; vA = angle;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC; varying float vA;
        #include <fog_pars_fragment>
        void main(){ vec2 uv = gl_PointCoord - 0.5; float c = cos(vA), s = sin(vA); uv = mat2(c,-s,s,c)*uv + 0.5; vec4 t = texture2D(map, uv);
          gl_FragColor = vec4(vC.rgb*t.rgb, vC.a*t.a);
          #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, fog: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = additive ? 11 : 10;
    this.geo = g; scene.add(this.pts);
    this.col3 = new Float32Array(max * 3);
  }
  add(p, v, { life = 1, size = 0.1, grow = 0, drag = 0, grav = 0, color = [1, 1, 1], alpha = 1, spin = 0, fadeIn = 0 }) {
    let i = this.n < this.max ? this.n++ : (Math.random() * this.max) | 0;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.v[i * 3] = v.x; this.v[i * 3 + 1] = v.y; this.v[i * 3 + 2] = v.z;
    this.life[i] = 0; this.max_[i] = life; this.size[i] = this.s0[i] = size; this.grow[i] = grow; this.drag[i] = drag; this.grav[i] = grav;
    this.col3[i * 3] = color[0]; this.col3[i * 3 + 1] = color[1]; this.col3[i * 3 + 2] = color[2]; this.a0[i] = alpha;
    this.ang[i] = Math.random() * 6.28; this.spin[i] = spin * (Math.random() - 0.5) * 2; this.fadeIn[i] = fadeIn;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      const L = this.life[i], M = this.max_[i];
      if (L >= M) { this.kill(i); continue; }
      const k = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= k; this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - this.grav[i] * dt; this.v[i * 3 + 2] *= k;
      this.pos[i * 3] += this.v[i * 3] * dt; this.pos[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.01 && this.grav[i] > 0) { this.pos[i * 3 + 1] = 0.01; this.v[i * 3 + 1] *= -0.3; this.v[i * 3] *= 0.6; this.v[i * 3 + 2] *= 0.6; }
      const t = L / M;
      this.size[i] = this.s0[i] + this.grow[i] * L;
      const fin = this.fadeIn[i] > 0 ? Math.min(1, L / this.fadeIn[i]) : 1;
      const a = this.a0[i] * fin * (1 - t) * (1 - t * 0.3);
      this.col[i * 4] = this.col3[i * 3]; this.col[i * 4 + 1] = this.col3[i * 3 + 1]; this.col[i * 4 + 2] = this.col3[i * 3 + 2]; this.col[i * 4 + 3] = a;
      this.ang[i] += this.spin[i] * dt;
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const k of ['position', 'pcolor', 'size', 'angle']) this.geo.attributes[k].needsUpdate = true;
  }
  kill(i) {
    const j = --this.n;
    if (i === j) return;
    const c3 = (arr, n) => { for (let q = 0; q < n; q++) arr[i * n + q] = arr[j * n + q]; };
    c3(this.pos, 3); c3(this.v, 3); c3(this.col, 4); c3(this.col3, 3);
    for (const arr of [this.life, this.max_, this.size, this.s0, this.grow, this.drag, this.grav, this.a0, this.ang, this.spin, this.fadeIn]) arr[i] = arr[j];
  }
}

// ── 데칼 (인스턴싱) ──
class Decals {
  constructor(scene, tex, count, opts = {}) {
    const mat = patchInterior(new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.roughnessMap, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 1, metalness: opts.metal ? 1 : 0, ...opts.mat }));
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, count);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.renderOrder = 1;
    this.i = 0; this.max = count; this.d = new THREE.Object3D();
    scene.add(this.mesh);
  }
  add(p, n, size) {
    const d = this.d;
    d.position.copy(p).addScaledVector(n, 0.003);
    d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    d.rotateZ(Math.random() * Math.PI * 2);
    d.scale.set(size, size, size);
    d.updateMatrix();
    this.mesh.setMatrixAt(this.i, d.matrix);
    this.i = (this.i + 1) % this.max;
    this.mesh.count = Math.min(this.max, this.mesh.count + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.mesh.count = 0; this.i = 0; }
}

const SURF = {
  concrete: { dust: [0.62, 0.6, 0.56], decal: 'concrete', sound: 'hitConcrete' },
  metal: { dust: [0.35, 0.34, 0.33], decal: 'metal', sound: 'hitMetal', sparks: true },
  wood: { dust: [0.55, 0.42, 0.28], decal: 'wood', sound: 'hitWood' },
  dirt: { dust: [0.45, 0.38, 0.28], decal: 'concrete', sound: 'hitDirt' },
  glass: { dust: [0.8, 0.85, 0.9], sound: 'glass' },
};

export class FX {
  constructor(game) {
    this.g = game;
    const s = game.scene;
    this.add = new Particles(s, 3000, T.soft.map, true);
    this.alpha = new Particles(s, 3000, T.smoke.map, false);
    this.dots = new Particles(s, 2000, T.soft.map, false);
    this.decals = {
      concrete: new Decals(s, T.holeConcrete, 300),
      metal: new Decals(s, T.holeMetal, 200, { metal: true }),
      wood: new Decals(s, T.holeWood, 150),
      blood: new Decals(s, T.blood, 120, { mat: { roughness: 0.3 } }),
      scorch: new Decals(s, T.scorch, 30),
    };
    // 예광탄
    const tg = new THREE.CylinderGeometry(0.012, 0.006, 1, 6, 1, true); tg.translate(0, -0.5, 0);
    this.tracerMatP = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 5, 1.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracerMatE = new THREE.MeshBasicMaterial({ color: new THREE.Color(10, 2.2, 1.0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracers = [];
    for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(tg, this.tracerMatP); m.visible = false; m.frustumCulled = false; s.add(m); this.tracers.push(m); }
    // 탄피
    const gm = gunMats();
    this.casingGeos = { '556': casingGeo('556'), '762': casingGeo('762'), '9mm': casingGeo('9mm'), '338': casingGeo('338'), shell: casingGeo('shell') };
    this.casings = [];
    for (let i = 0; i < 60; i++) { const m = new THREE.Mesh(this.casingGeos['556'], gm.brass); m.visible = false; m.castShadow = true; s.add(m); this.casings.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0, bounces: 0, active: false }); }
    this.ci = 0;
    this.mags = [];
    // 월드 섬광용 포인트 라이트 풀 (개수 고정 → 셰이더 재컴파일 방지)
    this.lights = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffa850, 0, 14, 2); s.add(l); this.lights.push({ l, t: 0, dur: 0.05, peak: 0 }); }
    this.li = 0;
    this.burning = [];
  }

  flashLight(p, intensity = 40, dur = 0.06, dist = 14, color = 0xffa850) {
    const L = this.lights[this.li]; this.li = (this.li + 1) % this.lights.length;
    L.l.position.copy(p); L.l.color.set(color); L.l.distance = dist; L.peak = intensity; L.t = dur; L.dur = dur; L.l.intensity = intensity;
  }

  muzzle(p, dir, def) {
    const big = def.id === 'awm' || def.id === 'm870';
    this.flashLight(p.clone().addScaledVector(dir, 0.3), big ? 90 : 45, 0.05);
    for (let i = 0; i < (big ? 6 : 3); i++) {
      const v = dir.clone().multiplyScalar(rand(0.5, 2.5)).add(new THREE.Vector3(rand(-0.3, 0.3), rand(0, 0.4), rand(-0.3, 0.3)));
      this.alpha.add(p.clone().addScaledVector(dir, 0.1), v, { life: rand(0.8, 1.6), size: rand(0.05, 0.1), grow: 0.35, drag: 2.2, grav: -0.15, color: [0.75, 0.75, 0.76], alpha: 0.18, spin: 1 });
    }
    for (let i = 0; i < (big ? 8 : 3); i++) this.add.add(p.clone().addScaledVector(dir, 0.05), dir.clone().multiplyScalar(rand(6, 14)).add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1))), { life: rand(0.05, 0.12), size: 0.02, drag: 4, color: [6, 3, 1] });
  }

  // 탄피 배출
  eject(w, ws) {
    const d = w.def, g = this.g;
    const c = this.casings[this.ci]; this.ci = (this.ci + 1) % this.casings.length;
    c.m.geometry = this.casingGeos[d.casing] || this.casingGeos['556'];
    c.m.material = d.casing === 'shell' ? ws.handShell.children[0].material : gunMats().brass;
    c.m.position.copy(ws.worldPointOf(w.m.eject));
    const q = g.camera.quaternion;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q), fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    c.v.copy(right).multiplyScalar(rand(2.2, 3.4)).addScaledVector(up, rand(0.5, 1.3)).addScaledVector(fwd, rand(-0.2, 0.8)).add(g.player.vel);
    c.w.set(rand(-25, 25), rand(-25, 25), rand(-25, 25));
    c.m.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
    c.life = 0; c.bounces = 0; c.active = true; c.m.visible = true; c.shell = d.casing === 'shell';
  }

  // 빈 탄창 떨어뜨리기
  dropMag(w, ws) {
    const src = w.m.parts.mag;
    if (!src) return;
    const m = src.clone(true);
    m.position.copy(ws.worldPointOf(src));
    src.getWorldQuaternion(m.quaternion);
    m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.g.scene.add(m);
    this.mags.push({ m, v: this.g.player.vel.clone().add(new THREE.Vector3(0, -0.5, 0)), w: new THREE.Vector3(rand(-3, 3), rand(-2, 2), rand(-3, 3)), life: 0, rest: false });
    if (this.mags.length > 10) { const o = this.mags.shift(); this.g.scene.remove(o.m); }
  }

  // 탄착 이펙트
  impact(p, n, surf, dir) {
    const S = SURF[surf] || SURF.concrete;
    const refl = dir.clone().reflect(n);
    // 먼지 퍼프
    for (let i = 0; i < 6; i++) {
      const v = n.clone().multiplyScalar(rand(0.5, 2.2)).add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.2, 0.8), rand(-0.6, 0.6)));
      this.alpha.add(p.clone().addScaledVector(n, 0.03), v, { life: rand(0.7, 1.6), size: rand(0.08, 0.16), grow: rand(0.4, 0.9), drag: 3.5, grav: 0.2, color: S.dust, alpha: 0.55, spin: 1.5 });
    }
    // 파편
    for (let i = 0; i < 8; i++) {
      const v = refl.clone().multiplyScalar(rand(1, 4)).addScaledVector(n, rand(1, 3)).add(new THREE.Vector3(rand(-1, 1), rand(0, 1.5), rand(-1, 1)));
      this.dots.add(p, v, { life: rand(0.4, 0.9), size: rand(0.012, 0.025), grav: 9.8, drag: 0.5, color: S.dust.map((c) => c * 0.55), alpha: 1 });
    }
    if (S.sparks) {
      for (let i = 0; i < 12; i++) {
        const v = refl.clone().multiplyScalar(rand(3, 10)).add(new THREE.Vector3(rand(-2, 2), rand(-1, 3), rand(-2, 2)));
        this.add.add(p, v, { life: rand(0.12, 0.4), size: rand(0.012, 0.022), grav: 9.8, drag: 1.5, color: [8, 4.5, 1.6] });
      }
      this.flashLight(p.clone().addScaledVector(n, 0.2), 6, 0.04, 3, 0xffc070);
    }
    if (S.decal) this.decals[S.decal].add(p, n, S.decal === 'metal' ? rand(0.05, 0.07) : rand(0.07, 0.11));
    Audio.play3D(S.sound, p, { vol: 0.9, ref: 3 });
    if (surf === 'metal' && Math.random() < 0.25) Audio.play3D('ricochet', p, { vol: 0.6, ref: 4 });
  }

  blood(p, dir, big) {
    for (let i = 0; i < (big ? 14 : 7); i++) {
      const v = dir.clone().multiplyScalar(rand(0.5, 3)).add(new THREE.Vector3(rand(-0.8, 0.8), rand(-0.3, 1), rand(-0.8, 0.8)));
      this.alpha.add(p, v, { life: rand(0.3, 0.8), size: rand(0.05, 0.12), grow: 0.5, drag: 5, grav: 1.5, color: [0.35, 0.02, 0.02], alpha: 0.85, spin: 1 });
    }
    for (let i = 0; i < 10; i++) this.dots.add(p, dir.clone().multiplyScalar(rand(1, 4)).add(new THREE.Vector3(rand(-1, 1), rand(0, 2), rand(-1, 1))), { life: rand(0.4, 0.8), size: rand(0.01, 0.02), grav: 9.8, color: [0.3, 0.01, 0.01] });
    // 뒤쪽 벽에 혈흔
    const hit = this.g.world.raycast(p, dir, 2.5);
    if (hit) this.decals.blood.add(hit.point, hit.n, rand(0.3, 0.6));
    Audio.play3D('hitFlesh', p, { vol: 1, ref: 4 });
  }

  glassBreak(col, p, dir) {
    const gm = col.glass;
    const c = new THREE.Vector3().addVectors(col.min, col.max).multiplyScalar(0.5);
    const size = new THREE.Vector3().subVectors(col.max, col.min);
    for (let i = 0; i < 70; i++) {
      const q = new THREE.Vector3(c.x + rand(-0.5, 0.5) * size.x, c.y + rand(-0.5, 0.5) * size.y, c.z + rand(-0.5, 0.5) * size.z);
      this.dots.add(q, dir.clone().multiplyScalar(rand(0.5, 3)).add(new THREE.Vector3(rand(-0.5, 0.5), rand(0, 1), rand(-0.5, 0.5))), { life: rand(0.8, 1.6), size: rand(0.015, 0.04), grav: 9.8, drag: 0.3, color: [0.75, 0.85, 0.9], alpha: 0.8 });
    }
    gm.visible = false; col.disabled = true;
    Audio.play3D('glass', p, { vol: 1.2, ref: 5 });
  }

  explosion(p) {
    this.flashLight(p.clone().add(new THREE.Vector3(0, 1, 0)), 900, 0.5, 30, 0xff9040);
    for (let i = 0; i < 40; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.5), rand(-1, 1)).normalize().multiplyScalar(rand(2, 9));
      this.add.add(p.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(0, 0.5), rand(-0.3, 0.3))), v, { life: rand(0.3, 0.8), size: rand(0.5, 1.2), grow: 2.5, drag: 4, grav: -2, color: [6, rand(2, 3.2), 0.6], alpha: 0.9, spin: 2 });
    }
    for (let i = 0; i < 36; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0.3, 1.5), rand(-1, 1)).normalize().multiplyScalar(rand(1, 5));
      this.alpha.add(p.clone().add(new THREE.Vector3(0, 0.5, 0)), v, { life: rand(3, 6), size: rand(0.8, 1.6), grow: 1.2, drag: 1.6, grav: -0.6, color: [0.12, 0.11, 0.1], alpha: 0.75, spin: 0.6, fadeIn: 0.2 });
    }
    for (let i = 0; i < 60; i++) this.add.add(p, new THREE.Vector3(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(6, 22)), { life: rand(0.5, 1.4), size: rand(0.02, 0.05), grav: 9.8, drag: 0.6, color: [9, 4, 1.2] });
    for (let i = 0; i < 30; i++) this.dots.add(p, new THREE.Vector3(rand(-1, 1), rand(0.4, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(4, 14)), { life: rand(1, 2), size: rand(0.03, 0.07), grav: 9.8, drag: 0.4, color: [0.08, 0.07, 0.06] });
    this.decals.scorch.add(new THREE.Vector3(p.x, 0.012, p.z), new THREE.Vector3(0, 1, 0), rand(3, 4.5));
    this.burning.push({ p: p.clone(), t: rand(6, 10) });
    Audio.play3D('explosion', p, { vol: 2.5, ref: 10 });
  }

  tracer(from, to) {
    const m = this.tracers.find((t) => !t.visible) || this.tracers[0];
    m.visible = true;
    return m;
  }

  update(dt) {
    const g = this.g, w = g.world;
    this.add.update(dt); this.alpha.update(dt); this.dots.update(dt);
    for (const L of this.lights) { if (L.t > 0) { L.t -= dt; L.l.intensity = L.peak * Math.max(0, L.t / L.dur) ** 1.5; } else L.l.intensity = 0; }
    // 화재 잔류
    for (let i = this.burning.length - 1; i >= 0; i--) {
      const b = this.burning[i]; b.t -= dt;
      if (b.t <= 0) { this.burning.splice(i, 1); continue; }
      if (Math.random() < dt * 30) this.add.add(b.p.clone().add(new THREE.Vector3(rand(-0.4, 0.4), 0.1, rand(-0.4, 0.4))), new THREE.Vector3(rand(-0.2, 0.2), rand(1, 2.5), rand(-0.2, 0.2)), { life: rand(0.3, 0.7), size: rand(0.2, 0.45), grow: -0.3, drag: 1, color: [5, 2, 0.5], alpha: 0.8, spin: 2 });
      if (Math.random() < dt * 8) this.alpha.add(b.p.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(rand(-0.3, 0.3), rand(1, 2), rand(-0.3, 0.3)), { life: rand(3, 5), size: 0.5, grow: 0.9, drag: 0.5, color: [0.1, 0.1, 0.1], alpha: 0.5, spin: 0.5, fadeIn: 0.3 });
    }
    // 탄피
    for (const c of this.casings) {
      if (!c.active) continue;
      c.life += dt;
      if (c.life > 12) { c.active = false; c.m.visible = false; continue; }
      if (c.rest) continue;
      c.v.y -= 9.8 * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.w.x * dt; c.m.rotation.y += c.w.y * dt; c.m.rotation.z += c.w.z * dt;
      const f = w.floorAt(c.m.position.x, c.m.position.z, c.m.position.y + 0.3);
      if (c.m.position.y < f.y + 0.006 && c.v.y < 0) {
        c.m.position.y = f.y + 0.006;
        if (c.bounces < 3 && Math.abs(c.v.y) > 0.4) Audio.play3D(c.shell ? 'shell' : 'casing', c.m.position, { vol: 0.35 * Math.pow(0.6, c.bounces), ref: 2, rate: rand(0.9, 1.15), speedDelay: false });
        c.v.y *= -0.35; c.v.x *= 0.55; c.v.z *= 0.55; c.w.multiplyScalar(0.5); c.bounces++;
        if (c.v.length() < 0.25) { c.rest = true; c.m.rotation.x = Math.PI / 2; c.m.rotation.z = 0; }
      }
    }
    for (const m of this.mags) {
      if (m.rest) continue;
      m.life += dt; m.v.y -= 9.8 * dt;
      m.m.position.addScaledVector(m.v, dt);
      m.m.rotation.x += m.w.x * dt; m.m.rotation.z += m.w.z * dt;
      const f = w.floorAt(m.m.position.x, m.m.position.z, m.m.position.y + 0.3);
      if (m.m.position.y < f.y + 0.02) {
        m.m.position.y = f.y + 0.02;
        if (Math.abs(m.v.y) > 1) Audio.play3D('magout', m.m.position, { vol: 0.3, rate: 0.6, ref: 2 });
        m.v.y *= -0.25; m.v.x *= 0.4; m.v.z *= 0.4; m.w.multiplyScalar(0.3);
        if (m.v.length() < 0.3 || m.life > 3) { m.rest = true; m.m.rotation.set(Math.PI / 2 * Math.sign(m.m.rotation.x || 1), m.m.rotation.y, 0); }
      }
    }
  }

  setScale(v) { this.add.mat.uniforms.uScale.value = v; this.alpha.mat.uniforms.uScale.value = v; this.dots.mat.uniforms.uScale.value = v; }
  clear() {
    for (const d of Object.values(this.decals)) d.clear();
    for (const m of this.mags) this.g.scene.remove(m.m);
    this.mags = [];
    for (const c of this.casings) { c.active = false; c.m.visible = false; c.rest = false; }
    this.burning = [];
  }
}

// ── 탄도 (투사체: 중력 + 공기저항) ──
export class Ballistics {
  constructor(game) { this.g = game; this.list = []; this._d = new THREE.Vector3(); }

  fire(o) {
    const b = { pos: o.origin.clone(), vel: o.dir.clone().multiplyScalar(o.speed), dmg: o.dmg, owner: o.owner, def: o.def, dist: 0, life: 2.5, whiz: false, bot: o.bot };
    if (o.tracer) {
      b.tracer = this.g.fx.tracer();
      b.tracer.material = o.owner === 'player' ? this.g.fx.tracerMatP : this.g.fx.tracerMatE;
      b.off = o.from ? o.from.clone().sub(o.origin) : new THREE.Vector3();
    }
    this.list.push(b);
    // 첫 프레임 즉시 짧게 진행 (근거리 반응성)
    this.step(b, 1 / 240);
  }

  step(b, dt) {
    const g = this.g, d = this._d;
    const p0 = b.pos.clone();
    b.vel.y -= 9.81 * dt;
    b.vel.multiplyScalar(1 - 0.02 * dt);
    const seg = b.vel.length() * dt;
    d.copy(b.vel).normalize();
    let remaining = seg, o = p0.clone();
    for (let guard = 0; guard < 4 && remaining > 0; guard++) {
      let best = remaining, kind = null, hit = null;
      const wh = g.world.raycast(o, d, best);
      if (wh && wh.t < best) { best = wh.t; kind = 'world'; hit = wh; }
      if (b.owner === 'player') { const bh = g.bots.raycast(o, d, best); if (bh && bh.t < best) { best = bh.t; kind = 'bot'; hit = bh; } }
      else { const ph = g.player.raycast(o, d, best); if (ph && ph.t < best) { best = ph.t; kind = 'player'; hit = ph; } }
      // 근접 통과음
      if (b.owner !== 'player' && !b.whiz) {
        const head = g.player.eye;
        const t = clamp(head.clone().sub(o).dot(d), 0, best);
        const cp = o.clone().addScaledVector(d, t);
        if (cp.distanceTo(head) < 1.6 && kind !== 'player') { b.whiz = true; Audio.play3D('whiz', cp, { vol: 0.9, ref: 2, speedDelay: false }); g.suppress(0.35); }
      }
      if (!kind) { b.pos.copy(o).addScaledVector(d, remaining); b.dist += remaining; remaining = 0; break; }
      const dist = b.dist + best;
      const r = b.def?.range || [60, 200, 0.7];
      const falloff = dist < r[0] ? 1 : lerp(1, r[2], clamp((dist - r[0]) / (r[1] - r[0]), 0, 1));
      if (kind === 'world') {
        if (hit.col && hit.col.glass) {
          g.fx.glassBreak(hit.col, hit.point, d);
          o.copy(hit.point).addScaledVector(d, 0.05); remaining -= best + 0.05; b.dist += best; b.dmg *= 0.85; continue;
        }
        g.fx.impact(hit.point, hit.n, hit.surf, d);
        if (hit.col && hit.col.barrel) g.damageBarrel(hit.col.barrel, b.dmg * falloff, b.owner);
        this.end(b, hit.point); return false;
      }
      if (kind === 'bot') { g.hitBot(hit, b.dmg * falloff, d, b.def); this.end(b, hit.point); return false; }
      if (kind === 'player') { g.player.damage(b.dmg * falloff, b.bot ? b.bot.pos : o, 'gun'); g.fx.blood(hit.point, d, false); this.end(b, hit.point); return false; }
    }
    return true;
  }

  end(b, p) { b.dead = true; b.endP = p; }

  update(dt) {
    const g = this.g;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.life -= dt;
      if (!b.dead) { const n = 2; for (let k = 0; k < n && !b.dead; k++) this.step(b, dt / n); }
      if (b.tracer) {
        const t = b.tracer;
        const k = Math.max(0, 1 - b.dist / 25);
        const head = b.dead ? b.endP : b.pos;
        const tail = head.clone().addScaledVector(b.vel.clone().normalize(), -Math.min(b.vel.length() * 0.018, Math.max(0.01, b.dist - 0.5)));
        head.clone().add(b.off.clone().multiplyScalar(k));
        const h2 = head.clone().add(b.off.clone().multiplyScalar(k)), t2 = tail.clone().add(b.off.clone().multiplyScalar(Math.max(0, 1 - (b.dist - 8) / 25)));
        const dv = h2.clone().sub(t2); const L = dv.length();
        t.position.copy(h2);
        t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv.normalize());
        t.scale.set(1, Math.max(0.01, L), 1);
        t.visible = !b.dead || b.tracerHold > 0;
        if (b.dead) b.tracerHold = (b.tracerHold ?? 0.02) - dt;
      }
      if ((b.dead && !(b.tracer && b.tracerHold > 0)) || b.life <= 0 || b.pos.y < -5) {
        if (b.tracer) b.tracer.visible = false;
        this.list.splice(i, 1);
      }
    }
  }
  clear() { for (const b of this.list) if (b.tracer) b.tracer.visible = false; this.list = []; }
}
