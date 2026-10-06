// 이펙트: 불꽃(스파크) · 연기/분진 · 파편 · 유리 조각 · 용접 아크광 · 열 발광 · 열변색 데칼 · 추진 화염
import * as THREE from 'three';
import { radialTex, smokeTex, heatTintTex } from './textures.js';
import { rand, clamp } from '../core/util.js';

const MAX_SPARK = 2500, MAX_SOFT = 1600, MAX_DEB = 320, MAX_SHARD = 160;
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

function heatColor(h, out) { // 1=백열 → 0=암적
  out[0] = clamp(h * 3, 0, 1) * 4; out[1] = clamp(h * 2.2 - 0.35, 0, 1) * 3.2; out[2] = clamp(h * 2.5 - 1.5, 0, 1) * 2.4;
  return out;
}

export class FX {
  constructor(scene, camera, renderer) {
    this.scene = scene; this.camera = camera; this.renderer = renderer;
    this.surfaceY = () => 0; // 월드에서 주입
    // 스파크: 꼬리 선 + 머리 점
    this.sp = []; for (let i = 0; i < MAX_SPARK; i++) this.sp.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, h: 1 });
    this.spIdx = 0;
    const lg = new THREE.BufferGeometry();
    this.lPos = new Float32Array(MAX_SPARK * 6); this.lCol = new Float32Array(MAX_SPARK * 6);
    lg.setAttribute('position', new THREE.BufferAttribute(this.lPos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(this.lCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
    this.lines.frustumCulled = false; scene.add(this.lines);
    // 부드러운 입자 (연기/분진/안개) — 일반 블렌딩, 가산 블렌딩 2계통
    this.glowTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']], 64);
    this.soft = this.makeSoft(smokeTex(), THREE.NormalBlending, MAX_SOFT);
    this.add = this.makeSoft(this.glowTex, THREE.AdditiveBlending, 1000);
    // 파편 (나뭇조각/벽돌/금속 칩)
    const dg = new THREE.BoxGeometry(1, 1, 1);
    this.debMesh = new THREE.InstancedMesh(dg, new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.1 }), MAX_DEB);
    this.debMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DEB * 3), 3);
    this.debMesh.castShadow = true; this.debMesh.frustumCulled = false; this.debMesh.count = MAX_DEB; scene.add(this.debMesh);
    this.deb = []; for (let i = 0; i < MAX_DEB; i++) { this.deb.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), w: new THREE.Vector3(), s: new THREE.Vector3(), life: 0 }); this.debMesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); }
    this.debIdx = 0;
    const sg = new THREE.TetrahedronGeometry(1); sg.scale(1, 0.12, 1);
    this.shardMesh = new THREE.InstancedMesh(sg, new THREE.MeshPhysicalMaterial({ color: 0xcfe6ea, roughness: 0.05, transparent: true, opacity: 0.45, metalness: 0, specularIntensity: 1, envMapIntensity: 2 }), MAX_SHARD);
    this.shardMesh.frustumCulled = false; scene.add(this.shardMesh);
    this.sh = []; for (let i = 0; i < MAX_SHARD; i++) { this.sh.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), w: new THREE.Vector3(), s: 0, life: 0 }); this.shardMesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); }
    this.shIdx = 0;
    // 용접 아크: 점광원 + 글로우 스프라이트 (항상 장면에 존재, 강도만 변경)
    this.arcLight = new THREE.PointLight(0xc8dcff, 0, 14, 1.6); this.arcLight.castShadow = false; scene.add(this.arcLight);
    this.arcSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: new THREE.Color(6, 7, 9), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.arcSprite.visible = false; scene.add(this.arcSprite);
    this.glowMat = new THREE.SpriteMaterial({ map: this.glowTex, color: new THREE.Color(3, 1.1, 0.25), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true });
    this.glows = [];
    this.tintTex = heatTintTex(); this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.tintMat = new THREE.MeshStandardMaterial({ map: this.tintTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.45, metalness: 0.7 });
    this.scorchMat = new THREE.MeshStandardMaterial({ map: radialTex([[0, 'rgba(10,8,6,0.95)'], [0.5, 'rgba(25,18,12,0.7)'], [1, 'rgba(30,20,10,0)']]), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 1 });
    this.flames = new Map();
    this.flameMat = new THREE.MeshBasicMaterial({ map: radialTex([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,200,120,0.9)'], [0.7, 'rgba(255,90,20,0.4)'], [1, 'rgba(255,40,0,0)']]), color: new THREE.Color(3, 2, 1.4), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.shake = 0;
  }
  makeSoft(tex, blending, max) {
    const g = new THREE.BufferGeometry();
    const o = { max, idx: 0, list: [], pos: new Float32Array(max * 3), col: new Float32Array(max * 3), size: new Float32Array(max), alpha: new Float32Array(max) };
    for (let i = 0; i < max; i++) o.list.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), c: [1, 1, 1], s0: 0.1, s1: 0.4, a: 0.5, life: 0, max: 1, drag: 1, rise: 0 });
    g.setAttribute('position', new THREE.BufferAttribute(o.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(o.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(o.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(o.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    o.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 800 } }, transparent: true, depthWrite: false, blending,
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC; uniform float scale;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * scale / max(-mv.z, 0.05); vA = alpha; vC = color; }`,
      fragmentShader: `uniform sampler2D map; varying float vA; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA); }`,
    });
    o.points = new THREE.Points(g, o.mat); o.points.frustumCulled = false; this.scene.add(o.points);
    return o;
  }
  // ─── 생성 API ───
  spark(p, v, life = 1, h = 1) {
    const s = this.sp[this.spIdx]; this.spIdx = (this.spIdx + 1) % MAX_SPARK;
    s.on = true; s.p.copy(p); s.v.copy(v); s.life = s.max = life; s.h = h;
  }
  // 방향(dir) 원뿔로 스파크 분출
  sparks(p, dir, n, speed = 5, spread = 0.8, life = 1, h = 1) {
    for (let i = 0; i < n; i++) {
      _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spread).add(dir).normalize().multiplyScalar(speed * rand(0.3, 1.2));
      this.spark(p, _v, life * rand(0.4, 1.2), h * rand(0.7, 1));
    }
  }
  puff(sys, p, v, color, s0, s1, a, life, rise = 0.3, drag = 1.5) {
    const o = sys === 'add' ? this.add : this.soft, q = o.list[o.idx]; o.idx = (o.idx + 1) % o.max;
    q.on = true; q.p.copy(p); q.v.copy(v); q.c = color; q.s0 = s0; q.s1 = s1; q.a = a; q.life = q.max = life; q.rise = rise; q.drag = drag;
  }
  smoke(p, n = 1, color = [0.55, 0.55, 0.55], size = 0.2, life = 3, a = 0.35) {
    for (let i = 0; i < n; i++) this.puff('soft', p, _v.set(rand(-0.15, 0.15), rand(0.1, 0.4), rand(-0.15, 0.15)), color, size * 0.4, size * 2.2, a, life * rand(0.7, 1.3));
  }
  dust(p, n, color = [0.5, 0.48, 0.45], size = 0.15) {
    for (let i = 0; i < n; i++) this.puff('soft', p, _v.set(rand(-1, 1), rand(0.1, 1), rand(-1, 1)).multiplyScalar(0.8), color, size * 0.5, size * 2.5, 0.4, rand(0.8, 2), -0.1, 2.5);
  }
  debris(p, n, color, size = 0.01, speed = 2.5, dir = null) {
    for (let i = 0; i < n; i++) {
      const di = this.debIdx, d = this.deb[di]; this.debIdx = (di + 1) % MAX_DEB;
      d.on = true; d.p.copy(p); d.v.set(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).multiplyScalar(speed);
      if (dir) d.v.addScaledVector(dir, speed);
      d.r.set(rand(0, 6), rand(0, 6), rand(0, 6)); d.w.set(rand(-20, 20), rand(-20, 20), rand(-20, 20));
      const k = rand(0.5, 1.5) * size; d.s.set(k, k * rand(0.3, 1), k * rand(0.4, 1.6)); d.life = rand(2, 4);
      const c = new THREE.Color(color).multiplyScalar(rand(0.75, 1.15));
      this.debMesh.instanceColor.setXYZ(di, c.r, c.g, c.b);
    }
    this.debMesh.instanceColor.needsUpdate = true;
  }
  debrisFrom(p, kind) { this.debris(p, 1, kind === 'clamp' ? 0xc22020 : 0x999999, kind === 'clamp' ? 0.05 : 0.012, 3); }
  shatter(center, half, q, vel) { // 유리 깨짐
    const n = Math.min(70, 16 + Math.floor(half.x * half.z * 160));
    for (let i = 0; i < n; i++) {
      const s = this.sh[this.shIdx]; this.shIdx = (this.shIdx + 1) % MAX_SHARD;
      s.on = true; s.p.set(rand(-half.x, half.x), rand(-half.y, half.y), rand(-half.z, half.z)).applyQuaternion(q).add(center);
      s.v.set(rand(-1.5, 1.5), rand(-0.5, 2), rand(-1.5, 1.5)); if (vel) s.v.add(vel);
      s.r.set(rand(0, 6), rand(0, 6), rand(0, 6)); s.w.set(rand(-15, 15), rand(-15, 15), rand(-15, 15)); s.s = rand(0.015, 0.07); s.life = rand(3, 6);
    }
  }
  // 부품에 붙는 열 발광
  heatGlow(part, lp, ln, size = 0.07) {
    for (const g of this.glows) if (g.part === part && g.sp.position.distanceTo(lp) < 0.02) { g.t = 0; return; }
    const sp = new THREE.Sprite(this.glowMat.clone()); sp.position.copy(lp).addScaledVector(ln, 0.004); sp.scale.setScalar(size);
    part.mesh.add(sp); this.glows.push({ part, sp, t: 0, size });
  }
  decal(part, lp, ln, kind, size) {
    const m = new THREE.Mesh(this.decalGeo, kind === 'tint' ? this.tintMat : this.scorchMat);
    m.position.copy(lp).addScaledVector(ln, 0.0004); m.quaternion.setFromUnitVectors(_v.set(0, 0, 1), ln);
    m.rotateZ(rand(0, 6.28)); m.scale.setScalar(size); m.renderOrder = 2; m.receiveShadow = true;
    part.mesh.add(m); (part.decals || (part.decals = [])).push(m);
    if (part.decals.length > 80) part.mesh.remove(part.decals.shift());
  }
  arc(on, p, intensity = 1) {
    this.arcSprite.visible = on; this.arcLight.intensity = on ? (5 + Math.random() * 13) * intensity : 0;
    if (on) { this.arcLight.position.copy(p); this.arcSprite.position.copy(p); this.arcSprite.scale.setScalar(rand(0.07, 0.17)); }
  }
  thrusterFlame(part, dt) {
    let f = this.flames.get(part);
    if (!f) {
      const g = new THREE.ConeGeometry(0.13, 1.4, 20, 1, true); g.rotateX(-Math.PI / 2); g.translate(0, 0, 1.0);
      f = new THREE.Mesh(g, this.flameMat); part.mesh.add(f); this.flames.set(part, f);
    }
    f.visible = true; f.userData.t = performance.now(); f.scale.set(rand(0.85, 1.1), rand(0.85, 1.1), rand(0.7, 1.3));
    const wp = part.toWorld(_v.set(0, 0, 0.6)), wd = part.toWorld(new THREE.Vector3(0, 0, 3)).sub(wp).normalize();
    if (Math.random() < 0.6) this.puff('soft', wp.clone().addScaledVector(wd, 1.2), wd.clone().multiplyScalar(rand(4, 8)), [0.6, 0.58, 0.55], 0.3, 2.2, 0.3, rand(1.5, 3), 0.4, 0.8);
    this.puff('add', wp, wd.clone().multiplyScalar(rand(5, 10)), [1.6, 0.8, 0.3], 0.4, 0.1, 0.8, 0.15, 0, 0);
  }
  // ─── 갱신 ───
  update(dt) {
    const sy = this.surfaceY;
    // 스파크
    let k = 0; const c = [0, 0, 0];
    for (const s of this.sp) {
      if (!s.on) continue;
      s.life -= dt; if (s.life <= 0) { s.on = false; continue; }
      s.v.y -= 9.81 * dt; s.v.multiplyScalar(1 - 0.6 * dt);
      s.p.addScaledVector(s.v, dt);
      const g = sy(s.p.x, s.p.z, s.p.y + 0.05);
      if (s.p.y < g) { s.p.y = g + 0.001; s.v.y *= -0.32; s.v.x *= 0.6; s.v.z *= 0.6; if (Math.random() < 0.03 && s.h > 0.5) { s.v.y += rand(0.5, 2); } }
      const h = (s.life / s.max) * s.h; heatColor(h, c);
      const i6 = k * 6, tl = 0.014 + 0.004 * s.h;
      this.lPos[i6] = s.p.x; this.lPos[i6 + 1] = s.p.y; this.lPos[i6 + 2] = s.p.z;
      this.lPos[i6 + 3] = s.p.x - s.v.x * tl; this.lPos[i6 + 4] = s.p.y - s.v.y * tl; this.lPos[i6 + 5] = s.p.z - s.v.z * tl;
      this.lCol[i6] = c[0]; this.lCol[i6 + 1] = c[1]; this.lCol[i6 + 2] = c[2]; this.lCol[i6 + 3] = c[0] * 0.2; this.lCol[i6 + 4] = c[1] * 0.1; this.lCol[i6 + 5] = c[2] * 0.05;
      k++;
    }
    this.lines.geometry.setDrawRange(0, k * 2);
    this.lines.geometry.attributes.position.needsUpdate = true; this.lines.geometry.attributes.color.needsUpdate = true;
    // 부드러운 입자
    const scale = this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    for (const o of [this.soft, this.add]) {
      o.mat.uniforms.scale.value = scale;
      let n = 0;
      for (const q of o.list) {
        if (!q.on) continue;
        q.life -= dt; if (q.life <= 0) { q.on = false; continue; }
        q.v.multiplyScalar(1 - q.drag * dt); q.v.y += q.rise * dt; q.p.addScaledVector(q.v, dt);
        const g = sy(q.p.x, q.p.z, q.p.y + 0.05); if (q.p.y < g + 0.02) { q.p.y = g + 0.02; q.v.y = Math.abs(q.v.y) * 0.2; }
        const t = 1 - q.life / q.max;
        o.pos[n * 3] = q.p.x; o.pos[n * 3 + 1] = q.p.y; o.pos[n * 3 + 2] = q.p.z;
        o.col[n * 3] = q.c[0]; o.col[n * 3 + 1] = q.c[1]; o.col[n * 3 + 2] = q.c[2];
        o.size[n] = q.s0 + (q.s1 - q.s0) * Math.sqrt(t); o.alpha[n] = q.a * Math.min(1, t * 8) * (1 - t);
        n++;
      }
      const g = o.points.geometry; g.setDrawRange(0, n);
      for (const a of ['position', 'color', 'size', 'alpha']) g.attributes[a].needsUpdate = true;
    }
    // 파편
    for (let i = 0; i < MAX_DEB; i++) {
      const d = this.deb[i]; if (!d.on) continue;
      d.life -= dt; if (d.life <= 0) { d.on = false; this.debMesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
      d.v.y -= 9.81 * dt; d.p.addScaledVector(d.v, dt); d.r.addScaledVector(d.w, dt);
      const g = sy(d.p.x, d.p.z, d.p.y + 0.05) + d.s.y * 0.5;
      if (d.p.y < g) { d.p.y = g; d.v.y *= -0.3; d.v.x *= 0.5; d.v.z *= 0.5; d.w.multiplyScalar(0.5); }
      const k2 = Math.min(1, d.life * 2);
      _m.compose(d.p, _q.setFromEuler(_e.set(d.r.x, d.r.y, d.r.z)), _s.copy(d.s).multiplyScalar(k2));
      this.debMesh.setMatrixAt(i, _m);
    }
    this.debMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < MAX_SHARD; i++) {
      const d = this.sh[i]; if (!d.on) continue;
      d.life -= dt; if (d.life <= 0) { d.on = false; this.shardMesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
      d.v.y -= 9.81 * dt; d.p.addScaledVector(d.v, dt); d.r.addScaledVector(d.w, dt);
      const g = sy(d.p.x, d.p.z, d.p.y + 0.05) + 0.003;
      if (d.p.y < g) { d.p.y = g; d.v.y *= -0.25; d.v.x *= 0.4; d.v.z *= 0.4; d.w.multiplyScalar(0.3); }
      _m.compose(d.p, _q.setFromEuler(_e.set(d.r.x, d.r.y, d.r.z)), _s.setScalar(d.s * Math.min(1, d.life)));
      this.shardMesh.setMatrixAt(i, _m);
    }
    this.shardMesh.instanceMatrix.needsUpdate = true;
    // 열 발광 냉각
    for (let i = this.glows.length - 1; i >= 0; i--) {
      const g = this.glows[i]; g.t += dt; const h = 1 - g.t / 6;
      if (h <= 0 || !g.part.s) { g.part.mesh.remove(g.sp); g.sp.material.dispose(); this.glows.splice(i, 1); continue; }
      g.sp.material.color.setRGB(3 * h * h, 1.1 * h * h * h, 0.25 * h ** 4); g.sp.scale.setScalar(g.size * (0.6 + 0.4 * h));
    }
    const now = performance.now();
    for (const [p, f] of this.flames) { if (!p.s) { this.flames.delete(p); continue; } if (now - f.userData.t > 60) f.visible = false; }
    this.shake = Math.max(0, this.shake - dt * 3);
  }
}
