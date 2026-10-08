// 지형: 하이트필드 생성 · 정확한 지면 높이 질의 · 메시 · PBR 지형 셰이더(젖음/퇴적/침수지도)
import * as THREE from 'three';
import { WORLD, HALF } from './config.js';
import { heightAt } from './geo.js';

export const GLSL_NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
`;

export class Terrain {
  constructor(R) {
    this.R = R;
    this.cell = WORLD / (R - 1);
    this.h = new Float32Array(R * R);
    for (let j = 0; j < R; j++) {
      const z = -HALF + j * this.cell;
      for (let i = 0; i < R; i++) this.h[j * R + i] = heightAt(-HALF + i * this.cell, z);
    }
    this.bridges = [];
  }

  /** 렌더 메시 삼각형과 정확히 일치하는 지면 높이 */
  terrainAt(x, z) {
    const R = this.R;
    let fx = (x + HALF) / this.cell, fz = (z + HALF) / this.cell;
    if (fx < 0) fx = 0; else if (fx > R - 1.0001) fx = R - 1.0001;
    if (fz < 0) fz = 0; else if (fz > R - 1.0001) fz = R - 1.0001;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const k = j * R + i, h = this.h;
    const ha = h[k], hb = h[k + R], hc = h[k + R + 1], hd = h[k + 1];
    if (tx + tz <= 1) return ha + (hd - ha) * tx + (hb - ha) * tz;
    return hc + (hb - hc) * (1 - tx) + (hd - hc) * (1 - tz);
  }

  /** 지면(다리 상판 포함) */
  groundAt(x, z) {
    const t = this.terrainAt(x, z);
    for (const b of this.bridges) {
      if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && b.deck > t) return b.deck;
    }
    return t;
  }

  slopeAt(x, z) {
    const e = 3;
    const dx = this.terrainAt(x + e, z) - this.terrainAt(x - e, z);
    const dz = this.terrainAt(x, z + e) - this.terrainAt(x, z - e);
    return Math.sqrt(dx * dx + dz * dz) / (2 * e);
  }

  buildMesh(uniforms) {
    const R = this.R, h = this.h, c = this.cell;
    const nV = R * R;
    const pos = new Float32Array(nV * 3), nrm = new Float32Array(nV * 3);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const k = j * R + i;
      pos[k * 3] = -HALF + i * c; pos[k * 3 + 1] = h[k]; pos[k * 3 + 2] = -HALF + j * c;
      const hl = h[j * R + Math.max(0, i - 1)], hr = h[j * R + Math.min(R - 1, i + 1)];
      const hu = h[Math.max(0, j - 1) * R + i], hd = h[Math.min(R - 1, j + 1) * R + i];
      let nx = -(hr - hl) / (2 * c), ny = 1, nz = -(hd - hu) / (2 * c);
      const l = Math.hypot(nx, ny, nz);
      nrm[k * 3] = nx / l; nrm[k * 3 + 1] = ny / l; nrm[k * 3 + 2] = nz / l;
    }
    const idx = new Uint32Array((R - 1) * (R - 1) * 6);
    let n = 0;
    for (let j = 0; j < R - 1; j++) for (let i = 0; i < R - 1; i++) {
      const a = j * R + i, b = a + R, cc = b + 1, d = a + 1;
      idx[n++] = a; idx[n++] = b; idx[n++] = d;
      idx[n++] = b; idx[n++] = cc; idx[n++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    this.material = makeTerrainMaterial(uniforms);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;

    // 영역 밖 원경 지형 (구멍 뚫린 저해상도 격자) + 경계 커튼
    // 좌표: 영역 경계 근처는 촘촘히(40 m), 멀리는 성기게
    const xs = [];
    for (let v = -14000; v < -3200; v += 800) xs.push(v);
    for (let v = -3200; v <= 3200; v += 40) xs.push(v);
    for (let v = 4000; v <= 14000; v += 800) xs.push(v);
    const M = xs.length - 1;
    const sp = [], sn = [], si = [];
    for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) {
      const x = xs[i], z = xs[j];
      let y = heightAt(x, z) - 0.6;
      const far = Math.max(Math.abs(x), Math.abs(z));
      if (y < 0) y = Math.min(y, -2 - (far - 2000) * 0.02);
      sp.push(x, y, z); sn.push(0, 1, 0);
    }
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      if (xs[i] >= -HALF && xs[i + 1] <= HALF && xs[j] >= -HALF && xs[j + 1] <= HALF) continue;
      const a = j * (M + 1) + i, b = a + M + 1, cc = b + 1, d = a + 1;
      si.push(a, b, d, b, cc, d);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('normal', new THREE.Float32BufferAttribute(sn, 3));
    sg.setIndex(si);
    sg.computeVertexNormals();
    this.skirt = new THREE.Mesh(sg, this.material);
    this.skirt.receiveShadow = true;

    // 커튼: 영역 가장자리에서 아래로
    const cp = [], ci = [];
    const edge = (getXZ) => {
      const base = cp.length / 3;
      for (let s = 0; s < R; s++) {
        const [x, z, k] = getXZ(s);
        cp.push(x, h[k], z, x, h[k] - 120, z);
      }
      for (let s = 0; s < R - 1; s++) {
        const a = base + s * 2, b = a + 1, c2 = a + 2, d = a + 3;
        ci.push(a, b, c2, b, d, c2, a, c2, b, b, c2, d);
      }
    };
    edge((s) => [-HALF + s * c, -HALF, s]);
    edge((s) => [-HALF + s * c, HALF, (R - 1) * R + s]);
    edge((s) => [-HALF, -HALF + s * c, s * R]);
    edge((s) => [HALF, -HALF + s * c, s * R + R - 1]);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    cg.setIndex(ci);
    cg.computeVertexNormals();
    this.curtain = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ color: 0x4a4436, roughness: 1 }));
    return [this.mesh, this.skirt, this.curtain];
  }
}

function makeTerrainMaterial(U) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, envMapIntensity: 0.3 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTW; varying vec3 vTN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz; vTN = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vTW; varying vec3 vTN;
uniform sampler2D tLand; uniform sampler2D tFlood; uniform sampler2D tDist;
uniform float uOverlay; uniform float uDistAlpha; uniform float uHalf; uniform float uNight;
${GLSL_NOISE}
vec3 floodRamp(float d){
  vec3 c = vec3(0.62,0.92,1.0);
  c = mix(c, vec3(0.28,0.62,0.98), smoothstep(0.5, 2.0, d));
  c = mix(c, vec3(0.12,0.30,0.85), smoothstep(2.0, 5.0, d));
  c = mix(c, vec3(0.38,0.12,0.72), smoothstep(5.0, 9.0, d));
  return c;
}`)
      .replace('#include <map_fragment>', `
vec3 wp = vTW; vec3 nn = normalize(vTN);
float slope = 1.0 - nn.y;
float nA = vnoise(wp.xz * 0.012), nB = vnoise(wp.xz * 0.11), nC = vnoise(wp.xz * 0.9), nD = vnoise(wp.xz * 3.7);
vec3 sand = vec3(0.80, 0.72, 0.54) * (0.88 + 0.12 * nB + 0.06 * nD);
vec3 wetSand = vec3(0.52, 0.45, 0.33) * (0.9 + 0.1 * nC);
vec3 grass = mix(vec3(0.24, 0.35, 0.13), vec3(0.38, 0.43, 0.19), nA) * (0.8 + 0.25 * nB + 0.1 * nD);
vec3 forest = mix(vec3(0.13, 0.22, 0.09), vec3(0.2, 0.27, 0.12), nB);
vec3 rock = mix(vec3(0.42, 0.40, 0.37), vec3(0.56, 0.53, 0.48), nC) * (0.85 + 0.2 * nB);
vec3 seabed = mix(vec3(0.62, 0.56, 0.42), vec3(0.24, 0.27, 0.25), smoothstep(-1.5, -18.0, wp.y));
float sandT = 1.0 - smoothstep(2.3, 3.3, wp.y + (nA - 0.5) * 1.2);
vec3 alb = mix(grass, forest, smoothstep(16.0, 34.0, wp.y + nA * 12.0));
alb = mix(alb, sand, sandT);
alb = mix(alb, wetSand, 1.0 - smoothstep(0.05, 0.7, wp.y));
alb = mix(alb, seabed, 1.0 - smoothstep(-0.6, 0.0, wp.y));
alb = mix(alb, rock, smoothstep(0.32, 0.55, slope + (nB - 0.5) * 0.15));
float rgh = 0.93;
vec2 uvw = (wp.xz + uHalf) / (2.0 * uHalf);
float inside = step(0.0, uvw.x) * step(uvw.x, 1.0) * step(0.0, uvw.y) * step(uvw.y, 1.0);
if (inside > 0.5) {
  vec4 L = texture2D(tLand, vec2(uvw.x, 1.0 - uvw.y));
  vec3 asphalt = vec3(0.13, 0.13, 0.14) * (0.8 + 0.3 * nD + 0.15 * nB);
  vec3 pave = vec3(0.56, 0.54, 0.5) * (0.85 + 0.2 * nD);
  vec3 garden = vec3(0.2, 0.32, 0.12) * (0.8 + 0.3 * nD);
  alb = mix(alb, garden, L.a < 0.99 ? (1.0 - L.a) : 0.0);
  alb = mix(alb, pave, L.g);
  alb = mix(alb, asphalt, L.r);
  alb = mix(alb, vec3(0.86, 0.84, 0.76), L.b);
  rgh = mix(rgh, 0.78, max(L.r, L.g));
  vec4 F = texture2D(tFlood, uvw);
  float wet = max(F.r, F.b * 0.8);
  alb = mix(alb, mix(vec3(0.24, 0.19, 0.12), vec3(0.15, 0.12, 0.08), nB), F.b * 0.65);
  alb *= mix(1.0, 0.58, wet);
  rgh = mix(rgh, 0.22, F.r);
  if (uOverlay > 0.0) {
    float md = F.g * 10.2;
    float on = smoothstep(0.03, 0.12, md) * step(0.0, wp.y - 0.2);
    alb = mix(alb, floodRamp(md), on * 0.78 * uOverlay);
  }
  if (uDistAlpha > 0.0) {
    vec4 D = texture2D(tDist, vec2(uvw.x, 1.0 - uvw.y));
    alb = mix(alb, D.rgb, D.a * uDistAlpha);
  }
}
diffuseColor.rgb = alb;
`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rgh;');
  };
  return mat;
}
