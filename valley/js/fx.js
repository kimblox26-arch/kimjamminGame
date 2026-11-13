// 파티클: 흙덩이 · 물보라 · 폭포 물안개 · 비 · 햇살 먼지
import * as THREE from 'three';
import { groundAt, centerX, terrainAt, U } from './terrain.js';

class Points {
  constructor(n, blending = THREE.NormalBlending) {
    this.n = n; this.i = 0;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1);
    this.size = new Float32Array(n); this.col = new Float32Array(n * 4); this.grow = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 30), 1e4);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending, fog: true,
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), { uScale: { value: 600 }, uSunCol: U.uSunCol }),
      vertexShader: `attribute float aSize; attribute vec4 aCol; varying vec4 vC; uniform float uScale;
        #include <fog_pars_vertex>
        void main(){ vC = aCol; vec4 mvPosition = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mvPosition;
        gl_PointSize = aSize * uScale / max(-mvPosition.z, 0.05); if(aCol.a<=0.) gl_PointSize = 0.;
        #include <fog_vertex>
        }`,
      fragmentShader: `varying vec4 vC; uniform vec3 uSunCol;
        #include <fog_pars_fragment>
        void main(){ vec2 c = gl_PointCoord*2.-1.; float d = dot(c,c); if(d>1.) discard;
        gl_FragColor = vec4(vC.rgb*uSunCol, vC.a*(1.-d)*(1.-d));
        #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
        }`,
    });
    this.obj = new THREE.Points(g, this.mat); this.obj.frustumCulled = false;
  }
  emit(x, y, z, vx, vy, vz, life, size, r, g, b, a, grow = 0) {
    const i = this.i; this.i = (i + 1) % this.n;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.size[i] = size; this.grow[i] = grow;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.col0 = this.col0 || new Float32Array(this.n); this.col0[i] = a;
  }
  update(dt, grav, drag) {
    const { p, v, life, col, size } = this;
    for (let i = 0; i < this.n; i++) {
      if (life[i] <= 0) { col[i * 4 + 3] = 0; continue; }
      life[i] -= dt;
      v[i * 3 + 1] -= grav * dt;
      const k = Math.max(0, 1 - drag * dt);
      v[i * 3] *= k; v[i * 3 + 1] *= k; v[i * 3 + 2] *= k;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      size[i] += this.grow[i] * dt;
      const t = life[i] / this.max[i];
      col[i * 4 + 3] = this.col0[i] * Math.min(1, t * 2.5) * Math.min(1, (1 - t) * 8 + 0.3);
    }
    this.obj.geometry.attributes.position.needsUpdate = true;
    this.obj.geometry.attributes.aCol.needsUpdate = true;
    this.obj.geometry.attributes.aSize.needsUpdate = true;
  }
}

let drops, mist, motes, clods, clodData, rain, rainPos, camera;
const CL = 160;
const dm = new THREE.Object3D();

export function init(scene, cam) {
  camera = cam;
  drops = new Points(1500); mist = new Points(900); motes = new Points(220, THREE.AdditiveBlending);
  scene.add(drops.obj, mist.obj, motes.obj);
  const cg = new THREE.DodecahedronGeometry(0.035, 0);
  clods = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 }), CL);
  clods.castShadow = true; clods.frustumCulled = false;
  clodData = Array.from({ length: CL }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, s: 1, r: new THREE.Euler() }));
  for (let i = 0; i < CL; i++) { dm.scale.setScalar(0); dm.updateMatrix(); clods.setMatrixAt(i, dm.matrix); }
  scene.add(clods);
  // 비
  const RN = 4000; rainPos = new Float32Array(RN * 6);
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaab8c4, transparent: true, opacity: 0, depthWrite: false }));
  rain.frustumCulled = false; scene.add(rain);
  for (let i = 0; i < RN; i++) resetDrop(i, true);
}
function resetDrop(i, any) {
  const c = camera.position, o = i * 6;
  const x = c.x + (Math.random() * 2 - 1) * 18, z = c.z + (Math.random() * 2 - 1) * 18;
  const y = c.y + (any ? Math.random() * 16 - 4 : 10 + Math.random() * 4);
  rainPos[o] = x; rainPos[o + 1] = y; rainPos[o + 2] = z; rainPos[o + 3] = x + 0.03; rainPos[o + 4] = y - 0.35; rainPos[o + 5] = z + 0.02;
}

let ci = 0;
export function dirt(x, y, z, n) {
  for (let k = 0; k < n; k++) {
    const d = clodData[ci]; ci = (ci + 1) % CL;
    d.p.set(x + (Math.random() - 0.5) * 0.3, y + 0.05, z + (Math.random() - 0.5) * 0.3);
    d.v.set((Math.random() - 0.5) * 1.6, 1.2 + Math.random() * 1.8, (Math.random() - 0.5) * 1.6);
    d.life = 1.2 + Math.random() * 0.8; d.s = 0.5 + Math.random() * 1.2; d.r.set(Math.random() * 6, Math.random() * 6, 0);
  }
  for (let k = 0; k < n; k++) drops.emit(x, y + 0.05, z, (Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6, 1.4, 0.12 + Math.random() * 0.1, 0.45, 0.37, 0.28, 0.25, 0.35);
}
// 곡괭이에 튀는 돌 조각 + 돌가루
export function chips(x, y, z, n) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * 6.283, sp = 0.8 + Math.random() * 2.2;
    const g = 0.45 + Math.random() * 0.3;
    drops.emit(x, y, z, Math.cos(a) * sp, 1 + Math.random() * 2.5, Math.sin(a) * sp, 0.5 + Math.random() * 0.4, 0.02 + Math.random() * 0.03, g, g * 0.97, g * 0.92, 0.95);
  }
  for (let k = 0; k < n / 3; k++) mist.emit(x, y, z, (Math.random() - 0.5) * 0.5, 0.2 + Math.random() * 0.3, (Math.random() - 0.5) * 0.5, 1.2, 0.18, 0.75, 0.72, 0.68, 0.3, 0.35);
}
export function splash(x, y, z, s) {
  const n = Math.round(10 + s * 40);
  for (let k = 0; k < n; k++) {
    const a = Math.random() * 6.283, sp = (0.4 + Math.random()) * (0.8 + s * 1.5);
    drops.emit(x, y + 0.02, z, Math.cos(a) * sp * 0.6, (1 + Math.random() * 2) * (0.6 + s), Math.sin(a) * sp * 0.6, 0.6 + Math.random() * 0.5, 0.03 + Math.random() * 0.04, 0.85, 0.92, 0.95, 0.8);
  }
  for (let k = 0; k < n / 4; k++) mist.emit(x, y + 0.05, z, (Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4, 1.0, 0.2, 0.9, 0.95, 1, 0.18, 0.4);
}

let acc = 0;
export const fall2 = { x: 0, y: 0, z: 0, f: 0 }; // 작은 폭포 아래 물보라
export function update(dt, rainAmt) {
  // 폭포 물안개
  acc += dt;
  const fx = centerX(4.3), fy = terrainAt(fx, 5).y + 0.35;
  while (acc > 0.025) {
    acc -= 0.025;
    mist.emit(fx + (Math.random() - 0.5) * 1.2, fy, 4.3 + Math.random() * 0.8, (Math.random() - 0.5) * 0.5, 0.25 + Math.random() * 0.5, 0.3 + Math.random() * 0.5, 2.5, 0.35 + Math.random() * 0.3, 0.92, 0.96, 1, 0.12, 0.35);
    if (Math.random() < fall2.f * 0.8) {
      mist.emit(fall2.x + (Math.random() - 0.5) * 0.9, fall2.y, fall2.z + Math.random() * 0.4, (Math.random() - 0.5) * 0.4, 0.2 + Math.random() * 0.35, 0.2 + Math.random() * 0.4, 1.8, 0.25 + Math.random() * 0.2, 0.92, 0.96, 1, 0.1, 0.3);
      drops.emit(fall2.x + (Math.random() - 0.5) * 0.8, fall2.y, fall2.z + Math.random() * 0.3, (Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 1.5, Math.random() * 1.0, 0.6, 0.025, 0.85, 0.92, 0.95, 0.7);
    }
    drops.emit(fx + (Math.random() - 0.5) * 1.0, fy, 4.4 + Math.random() * 0.4, (Math.random() - 0.5) * 1.5, 1 + Math.random() * 2, (Math.random()) * 1.2, 0.7, 0.03, 0.85, 0.92, 0.95, 0.7);
    if (Math.random() < 0.35) {
      const c = camera.position;
      motes.emit(c.x + (Math.random() - 0.5) * 14, c.y + (Math.random() - 0.3) * 4, c.z + (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.1, 6, 0.012, 1, 0.95, 0.75, 0.35 * (1 - rainAmt));
    }
  }
  drops.update(dt, 9.8, 0.3); mist.update(dt, -0.05, 0.6); motes.update(dt, 0, 0);
  // 흙덩이
  for (let i = 0; i < CL; i++) {
    const d = clodData[i];
    if (d.life <= 0) continue;
    d.life -= dt; d.v.y -= 9.8 * dt; d.p.addScaledVector(d.v, dt);
    const g = groundAt(d.p.x, d.p.z);
    if (d.p.y < g + 0.02) { d.p.y = g + 0.02; d.v.multiplyScalar(0.3); d.v.y = Math.abs(d.v.y) * 0.3; }
    d.r.x += dt * 6; dm.position.copy(d.p); dm.rotation.copy(d.r); dm.scale.setScalar(d.life > 0 ? d.s * Math.min(1, d.life * 3) : 0);
    dm.updateMatrix(); clods.setMatrixAt(i, dm.matrix);
  }
  clods.instanceMatrix.needsUpdate = true;
  // 비
  rain.material.opacity = 0.42 * rainAmt; rain.visible = rainAmt > 0.01;
  if (rain.visible) {
    const n = rainPos.length / 6, c = camera.position;
    for (let i = 0; i < n; i++) {
      const o = i * 6, dy = 16 * dt;
      rainPos[o + 1] -= dy; rainPos[o + 4] -= dy; rainPos[o] += 0.6 * dt; rainPos[o + 3] += 0.6 * dt;
      if (rainPos[o + 1] < groundAt(rainPos[o], rainPos[o + 2]) || Math.abs(rainPos[o] - c.x) > 18 || Math.abs(rainPos[o + 2] - c.z) > 18) {
        if (Math.random() < 0.08 && rainPos[o + 1] > c.y - 6) drops.emit(rainPos[o], rainPos[o + 1] + 0.02, rainPos[o + 2], 0, 0.8, 0, 0.2, 0.02, 0.8, 0.85, 0.9, 0.5);
        resetDrop(i, false);
      }
    }
    rain.geometry.attributes.position.needsUpdate = true;
  }
}
export function setScale(px) { for (const s of [drops, mist, motes]) s.mat.uniforms.uScale.value = px; }
