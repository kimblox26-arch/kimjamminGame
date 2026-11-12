// 자연: 풀 · 꽃 · 나무 · 폭포/상·하류 물줄기
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { CELL, NX, NZ, X0, Z0, idx, grass, ground, terrainAt, centerX, chanW, floorHalf, U } from './terrain.js';
import { GLSL_NOISE, rng } from './noise.js';
import { GLSL_SKY } from './sky.js';

const rand = rng(99), perlin = new ImprovedNoise();
const WIND_VS = `
  vec4 iw = instanceMatrix * vec4(0.,0.,0.,1.);
  float wv = sin(uTime*1.7 + iw.x*0.55 + iw.z*0.35)*0.6 + sin(uTime*2.9 + iw.x*1.3 - iw.z*0.7)*0.3 + sin(uTime*0.6+iw.z*0.1)*0.4;
`;

// ───── 풀 ─────
function bladeClump() {
  const B = 14, SEG = 4, pos = [], col = [], nor = [], uv = [], ind = [];
  for (let b = 0; b < B; b++) {
    const a = rand() * 6.283, r = Math.sqrt(rand()) * 0.16, h = 0.18 + rand() * 0.32, w = 0.012 + rand() * 0.01;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r, dir = rand() * 6.283, lean = 0.15 + rand() * 0.35;
    const dx = Math.cos(dir), dz = Math.sin(dir), sx = -dz, sz = dx;
    const base = pos.length / 3, tone = 0.8 + rand() * 0.35;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG, ww = w * (1 - t * 0.85), off = lean * t * t * h;
      const x = bx + dx * off, z = bz + dz * off, y = h * t;
      pos.push(x - sx * ww, y, z - sz * ww, x + sx * ww, y, z + sz * ww);
      const c = [0.10 + 0.22 * t, 0.17 + 0.25 * t, 0.04 + 0.05 * t].map(v => v * tone);
      col.push(...c, ...c); nor.push(0, 1, 0, 0, 1, 0); uv.push(0, t, 1, t);
      if (s < SEG) { const k = base + s * 2; ind.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ind);
  return g;
}
function windMat(params, amp, foliage) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uRain = U.uRain;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uRain; varying vec3 vWP2;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${WIND_VS}
        float hh = ${foliage ? 'max(position.y-1.0,0.)*0.05' : 'uv.y*uv.y'};
        float gust = 1. + uRain*1.5;
        transformed.x += wv*${amp}*hh*gust; transformed.z += wv*${amp * 0.6}*hh*gust;`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP2 = (modelMatrix * instanceMatrix * vec4(transformed,1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP2;\n' + GLSL_NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${foliage ? 'float lf = vnoise3(vWP2*5.5); diffuseColor.rgb *= 0.72 + 0.5*lf; diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(1.25,1.15,0.6), smoothstep(0.75,0.95,vnoise3(vWP2*1.3))*0.5);' : ''}`);
  };
  return m;
}

const grassInst = { mesh: null, pos: [] };
export function buildGrass(scene, count) {
  const geo = bladeClump();
  const mat = windMat({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.82 }, 0.08, false);
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.receiveShadow = true; m.castShadow = false; m.frustumCulled = false;
  const d = new THREE.Object3D(), c = new THREE.Color();
  let n = 0;
  for (let t = 0; n < count && t < count * 40; t++) {
    const x = -19 + rand() * 38, z = 6 + rand() * 52;
    const i = Math.round((x - X0) / CELL), j = Math.round((z - Z0) / CELL);
    const g = grass[idx(i, j)];
    if (g < 0.35 || rand() > g) continue;
    d.position.set(x, groundBil(x, z) - 0.02, z); d.rotation.set(0, rand() * 6.283, 0);
    d.scale.setScalar(0.7 + rand() * 0.7); d.updateMatrix();
    m.setMatrixAt(n, d.matrix);
    c.setHSL(0.2 + rand() * 0.07, 0.5 + rand() * 0.2, 0.42 + rand() * 0.2); m.setColorAt(n, c);
    grassInst.pos.push(x, z, j * (NX + 1) + i); n++;
  }
  m.count = n; grassInst.mesh = m; grassInst.full = n; scene.add(m);
}
function groundBil(x, z) {
  const fx = (x - X0) / CELL, fz = (z - Z0) / CELL, i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
  const a = ground[idx(i, j)], b = ground[idx(i + 1, j)], c = ground[idx(i, j + 1)], d = ground[idx(i + 1, j + 1)];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// 땅을 파거나 흙을 부으면 그 자리 풀을 없애고 높이 다시 맞추기
const zero = new THREE.Matrix4().makeScale(0, 0, 0), mtx = new THREE.Matrix4(), pp = new THREE.Vector3(), qq = new THREE.Quaternion(), ss = new THREE.Vector3();
export function onEdit(x, z, r) {
  const m = grassInst.mesh; if (!m) return;
  const P = grassInst.pos; let ch = false;
  for (let n = 0; n < m.count; n++) {
    const dx = P[n * 3] - x, dz = P[n * 3 + 1] - z; if (dx * dx + dz * dz > (r + 0.3) ** 2) continue;
    if (grass[P[n * 3 + 2]] < 0.2) m.setMatrixAt(n, zero);
    else { m.getMatrixAt(n, mtx); mtx.decompose(pp, qq, ss); pp.y = groundBil(P[n * 3], P[n * 3 + 1]) - 0.02; mtx.compose(pp, qq, ss); m.setMatrixAt(n, mtx); }
    ch = true;
  }
  if (ch) m.instanceMatrix.needsUpdate = true;
}

// ───── 꽃 ─────
const flowerInst = [];
// 최적화 모드: 풀·꽃 밀도 줄이기 (무작위 배치라 앞부분만 그려도 고르게 줄어든다)
export function setDensity(f) {
  if (grassInst.mesh) grassInst.mesh.count = Math.round(grassInst.full * f);
  for (const [m, n] of flowerInst) m.count = Math.round(n * f);
}
export function buildFlowers(scene, count) {
  const stem = new THREE.CylinderGeometry(0.004, 0.005, 0.3, 4).translate(0, 0.15, 0);
  const head = new THREE.IcosahedronGeometry(0.028, 0).scale(1, 0.55, 1).translate(0, 0.3, 0);
  const ms = new THREE.InstancedMesh(stem, new THREE.MeshStandardMaterial({ color: 0x3d5a1e, roughness: 0.8 }), count);
  const mh = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ roughness: 0.6 }), count);
  const d = new THREE.Object3D(), c = new THREE.Color(), cols = [0xffffff, 0xf4d03f, 0xb57edc, 0xff9fb2, 0xfff3c4];
  let n = 0;
  for (let t = 0; n < count && t < count * 60; t++) {
    const x = -19 + rand() * 38, z = 6 + rand() * 52;
    const g = grass[idx(Math.round((x - X0) / CELL), Math.round((z - Z0) / CELL))];
    if (g < 0.6 || rand() > 0.5) continue;
    d.position.set(x, groundBil(x, z), z); d.scale.setScalar(0.6 + rand() * 0.8); d.rotation.set((rand() - 0.5) * 0.3, rand() * 6, (rand() - 0.5) * 0.3); d.updateMatrix();
    ms.setMatrixAt(n, d.matrix); mh.setMatrixAt(n, d.matrix); c.setHex(cols[(rand() * cols.length) | 0]); mh.setColorAt(n, c); n++;
  }
  ms.count = mh.count = n; ms.receiveShadow = mh.receiveShadow = true; flowerInst.push([ms, n], [mh, n]);
  scene.add(ms, mh);
}

// ───── 나무 ─────
function colorize(g, fn) {
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const c = fn(p.getX(i), p.getY(i), p.getZ(i)); col.set(c, i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
function jitter(g, amt, sc) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = perlin.noise(x * sc, y * sc, z * sc);
    const r = Math.hypot(x, z) || 1; p.setXYZ(i, x + x / r * n * amt, y + n * amt * 0.4, z + z / r * n * amt);
  }
  g.computeVertexNormals(); return g;
}
function pineGeo(seed) {
  const r = rng(seed), parts = [];
  const H = 7 + r() * 5;
  parts.push(colorize(new THREE.CylinderGeometry(0.1, 0.22, H * 0.55, 7).translate(0, H * 0.27, 0), () => [0.25, 0.16, 0.1]));
  const L = 6;
  for (let l = 0; l < L; l++) {
    const t = l / (L - 1), rad = (1.9 - t * 1.45) * (0.85 + r() * 0.3), h = 2.3 - t * 0.9, y = 1.6 + t * (H - 2.6);
    const g = new THREE.ConeGeometry(rad, h, 11, 3, true).translate(0, y + h / 2, 0);
    jitter(g, 0.22, 1.6 + r());
    colorize(g, (x, yy, z) => { const k = (yy - y) / h; const d = 0.55 + 0.45 * k; return [0.06 * d, (0.16 + r() * 0.04) * d, 0.07 * d]; });
    parts.push(g);
  }
  return mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g));
}
function broadGeo(seed) {
  const r = rng(seed), parts = [];
  const H = 4.5 + r() * 3;
  parts.push(colorize(jitter(new THREE.CylinderGeometry(0.12, 0.25, H, 7, 4).translate(0, H / 2, 0), 0.06, 1.5), () => [0.3, 0.24, 0.18]));
  const tone = [0.13 + r() * 0.08, 0.26 + r() * 0.1, 0.06];
  for (let b = 0; b < 9; b++) {
    const s = 1.0 + r() * 1.0, a = r() * 6.283, d = r() * 1.4;
    const g = new THREE.IcosahedronGeometry(s, 2).translate(Math.cos(a) * d, H - 0.3 + r() * 2.0, Math.sin(a) * d);
    jitter(g, 0.35, 1.2);
    colorize(g, (x, y, z) => { const k = 0.6 + 0.4 * Math.min(1, Math.max(0, (y - H + 1) / 3)); return tone.map(v => v * k); });
    parts.push(g);
  }
  return mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g));
}
export function buildTrees(scene, nPine, nBroad) {
  const pineMat = windMat({ vertexColors: true, roughness: 0.88 }, 0.12, true);
  const broadMat = windMat({ vertexColors: true, roughness: 0.8 }, 0.1, true);
  const kinds = [[pineGeo(1), pineGeo(2), pineGeo(3)], [broadGeo(4), broadGeo(5)]];
  const spots = [[[], [], []], [[], []]];
  const total = nPine + nBroad;
  for (let n = 0, t = 0; n < total && t < total * 30; t++) {
    const near = rand() < 0.4;
    const x = near ? (rand() * 2 - 1) * 30 : (rand() * 2 - 1) * 140, z = near ? -5 + rand() * 75 : -100 + rand() * 260;
    const tt = terrainAt(x, z);
    const e = tt.d - tt.F;
    if (e < 0.8 || tt.y > 60) continue;
    const s = Math.hypot(terrainAt(x + 1, z).y - tt.y, terrainAt(x, z + 1).y - tt.y);
    if (s > 1.1) continue;
    if (Math.abs(x) < 22 && z > 0 && z < 60 && e < 2.0) continue;
    const kind = n < nPine ? 0 : 1, v = (rand() * kinds[kind].length) | 0;
    spots[kind][v].push([x, tt.y - 0.2, z, 0.75 + rand() * 0.6, rand() * 6.283, Math.hypot(x, z - 30) < 50]);
    n++;
  }
  const d = new THREE.Object3D(), c = new THREE.Color();
  kinds.forEach((geos, kind) => geos.forEach((g, v) => {
    const list = spots[kind][v];
    for (const near of [true, false]) {
      const L = list.filter(s => s[5] === near); if (!L.length) continue;
      const m = new THREE.InstancedMesh(g, kind ? broadMat : pineMat, L.length);
      L.forEach((s, i) => { d.position.set(s[0], s[1], s[2]); d.rotation.set(0, s[4], 0); d.scale.setScalar(s[3]); d.updateMatrix(); m.setMatrixAt(i, d.matrix); c.setHSL(0.25 + rand() * 0.06, 0.3, 0.45 + rand() * 0.2); m.setColorAt(i, c); });
      m.castShadow = near; m.receiveShadow = true; m.frustumCulled = false;
      scene.add(m);
    }
  }));
}

// ───── 물줄기 리본 (폭포 / 상류 / 하류) ─────
function ribbon(path, width) {
  const pos = [], uv = [], ind = []; let len = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i], q = path[Math.min(path.length - 1, i + 1)], o = path[Math.max(0, i - 1)];
    let tx = q[0] - o[0], tz = q[2] - o[2]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const sx = -tz, sz = tx, w = (p[3] ?? 1) * width / 2;
    if (i > 0) len += Math.hypot(p[0] - o[0] * 0 - path[i - 1][0], p[1] - path[i - 1][1], p[2] - path[i - 1][2]);
    pos.push(p[0] - sx * w, p[1], p[2] - sz * w, p[0] + sx * w, p[1], p[2] + sz * w);
    uv.push(0, len, 1, len);
    if (i < path.length - 1) { const k = i * 2; ind.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ind);
  g.computeVertexNormals();
  return g;
}
function flowMat(foam, speed, fall) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), U, { uFoam: { value: foam }, uSpeed: { value: speed }, uOp: { value: 1 }, uFall: { value: fall } }),
    vertexShader: `varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vW = (modelMatrix*vec4(position,1.)).xyz; vN = normalize(mat3(modelMatrix)*normal); vec4 mvPosition = viewMatrix*vec4(vW,1.); gl_Position = projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: GLSL_NOISE + GLSL_SKY + `uniform float uTime, uFoam, uSpeed, uOp, uFall; uniform vec3 uSunCol; varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      #include <fog_pars_fragment>
      void main(){
        float t = uTime*uSpeed;
        float n = fbm2(vec2(vUv.x*5., vUv.y*1.2 - t));
        float st = vnoise2(vec2(vUv.x*30., vUv.y*(uFall>0.5?0.8:3.) - t*1.6));
        float edge = smoothstep(0.0,0.15,vUv.x)*smoothstep(1.0,0.85,vUv.x);
        vec3 V = normalize(cameraPosition - vW); vec3 N = normalize(vN); if(dot(N,V)<0.) N=-N;
        float fres = 0.04 + 0.96*pow(1.-max(dot(N,V),0.),5.);
        vec3 base = mix(vec3(0.03,0.10,0.09), vec3(0.12,0.22,0.2), n);
        vec3 col = mix(base, skyCol(reflect(-V,N)), fres*0.8);
        float f = smoothstep(0.45, 0.85, n*0.6 + st*0.6 + uFoam*0.35 - 0.2) * uFoam;
        f = max(f, (1.-edge)*0.5*uFoam);
        col = mix(col, vec3(0.92,0.95,0.97)*(0.5+0.5*uSunDir.y)*uSunCol, f);
        float a = uOp * edge * mix(0.82, 1.0, f) * (uFall>0.5 ? (0.55 + 0.45*st) : 1.);
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }`,
  });
}
let downMat, downMesh;
// 바깥 지형(1m 격자 선형보간) 높이와 해석 높이 중 높은 쪽
function surfY(x, z, off) {
  const t = terrainAt(x, z).y;
  if (z >= 0 && z <= 60) return t + off;
  const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j;
  const a = terrainAt(i, j).y, b = terrainAt(i + 1, j).y, c = terrainAt(i, j + 1).y, d = terrainAt(i + 1, j + 1).y;
  return Math.max(t, a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) + off;
}
export function buildStreams(scene) {
  // 상류: 절벽 위 물길
  const up = [];
  for (let z = -40; z <= 2.95; z += 0.5) { const x = centerX(z); up.push([x, surfY(x, z, 0.13), z, 1]); }
  const mu = new THREE.Mesh(ribbon(up, 1.3), flowMat(0.25, 1.4, 0)); scene.add(mu);
  // 폭포
  const fall = [], x0 = centerX(2.95), y0 = terrainAt(x0, 2.95).y + 0.13, yEnd = terrainAt(centerX(4.6), 4.6).y + 0.25;
  for (let t = 0; t <= 1.2; t += 0.04) {
    const z = 2.95 + 1.5 * t, y = y0 - 4.9 * t * t; if (y < yEnd) { fall.push([centerX(z), yEnd, z, 1.15 + t * 0.4]); break; }
    fall.push([centerX(z), y, z, 1 + t * 0.4]);
  }
  const mf = new THREE.Mesh(ribbon(fall, 1.25), flowMat(1.0, 2.2, 1)); scene.add(mf);
  // 하류 출구
  const dn = [];
  for (let z = 59.7; z <= 140; z += 0.5) { const x = centerX(z); dn.push([x, surfY(x, z, 0.12), z, 1]); }
  downMat = flowMat(0.45, 1.6, 0); downMesh = new THREE.Mesh(ribbon(dn, 1.3), downMat); scene.add(downMesh);
}
export function setDownstream(f) { downMat.uniforms.uOp.value = Math.min(1, f * 1.2); downMesh.visible = f > 0.03; downMat.uniforms.uFoam.value = 0.15 + 0.4 * f; }
