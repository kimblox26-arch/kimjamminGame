// 맵: 산업 단지 (창고 · 컨테이너 야적장 · 사무동 · 중앙 광장) + 충돌/광선/내비게이션
import * as THREE from 'three';
import { T, fbm } from './textures.js';
import { MeshBatch, rayAABB, clamp } from './core.js';

// ── 실내 차폐(간이 앰비언트 오클루전) 셰이더 패치 ──
export const INTERIOR = { min: { value: [] }, max: { value: [] } };
for (let i = 0; i < 4; i++) { INTERIOR.min.value.push(new THREE.Vector3(1e5, 1e5, 1e5)); INTERIOR.max.value.push(new THREE.Vector3(1e5, 1e5, 1e5)); }
const patchFn = (shader) => {
  shader.uniforms.uIntMin = INTERIOR.min; shader.uniforms.uIntMax = INTERIOR.max;
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <project_vertex>', `#include <project_vertex>
      vec4 iwp = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
      iwp = instanceMatrix * iwp;
      #endif
      vWPos = (modelMatrix * iwp).xyz;`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWPos; uniform vec3 uIntMin[4]; uniform vec3 uIntMax[4];
      float interiorF(vec3 p){ float f = 1.0;
        for(int i=0;i<4;i++){ vec3 a=uIntMin[i], b=uIntMax[i];
          float d = min(min(min(p.x-a.x, b.x-p.x), min(p.z-a.z, b.z-p.z)), b.y-p.y+0.5);
          f = min(f, 1.0 - 0.72*smoothstep(-0.3, 3.5, d)); }
        return f; }`)
    .replace('#include <aomap_fragment>', `#include <aomap_fragment>
      float ioF = interiorF(vWPos); reflectedLight.indirectDiffuse *= ioF; reflectedLight.indirectSpecular *= ioF;`);
};
// 단지 밖 지형 높이 (지형 메시·나무·풀 배치 공용)
export function terrainH(x, z) {
  const r = Math.max(Math.abs(x), Math.abs(z));
  if (r < 72) return -0.35;
  const k = THREE.MathUtils.smoothstep(r, 75, 260);
  return Math.max(-0.35, (fbm(x / 1400 + 0.5, z / 1400 + 0.5, 6, 4) - 0.35) * 90 * k + k * 6);
}
// 초원 비율 (0 흙 ~ 1 풀)
export function grassK(x, z) {
  const r = Math.max(Math.abs(x), Math.abs(z));
  return THREE.MathUtils.smoothstep(r, 71, 76) * THREE.MathUtils.clamp(0.35 + fbm(x / 160 + 3.1, z / 160 + 1.7, 4, 3) * 1.1, 0, 1);
}

export function patchInterior(mat) { mat.onBeforeCompile = patchFn; return mat; }
export function interiorFactorCPU(p) {
  let f = 1;
  for (let i = 0; i < 4; i++) {
    const a = INTERIOR.min.value[i], b = INTERIOR.max.value[i];
    const d = Math.min(p.x - a.x, b.x - p.x, p.z - a.z, b.z - p.z, b.y - p.y + 0.5);
    const t = clamp((d + 0.3) / 3.8, 0, 1);
    f = Math.min(f, 1 - 0.72 * t * t * (3 - 2 * t));
  }
  return f;
}

// 박스 지오메트리 (UV 를 실제 치수/타일 크기로 스케일)
function boxGeo(w, h, d, tile, ox = 0, oy = 0, oz = 0) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h, oz, oy], [d, h, oz, oy], [w, d, ox, oz], [w, d, ox, oz], [w, h, ox, oy], [w, h, ox, oy]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k, D = dims[f];
    uv.setXY(i, (uv.getX(i) * D[0] + D[2]) / tile, (uv.getY(i) * D[1] + D[3]) / tile);
  }
  return g;
}

// 잔디 지면 텍스처 (위에서 본 풀잎 스트로크)
function turfTex() {
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d');
  const im = x.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const n = fbm(i / N, j / N, 6, 4), o = (j * N + i) * 4;
    im.data[o] = 58 + n * 40; im.data[o + 1] = 70 + n * 38; im.data[o + 2] = 28 + n * 12; im.data[o + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  for (let k = 0; k < 14000; k++) {
    const px = Math.random() * N, py = Math.random() * N, a = Math.random() * Math.PI * 2, L = 3 + Math.random() * 9, g = 0.6 + Math.random() * 0.7;
    const dry = Math.random() < 0.18;
    x.strokeStyle = dry ? `rgba(${150 * g | 0},${135 * g | 0},${70 * g | 0},0.8)` : `rgba(${55 * g | 0},${92 * g | 0},${30 * g | 0},0.85)`;
    x.lineWidth = 1 + Math.random() * 1.2;
    for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) {
      if (px + dx < -12 || px + dx > N + 12 || py + dy < -12 || py + dy > N + 12) continue;
      x.beginPath(); x.moveTo(px + dx, py + dy); x.lineTo(px + dx + Math.cos(a) * L, py + dy + Math.sin(a) * L); x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// 철망 텍스처 (다이아몬드 격자, 알파)
function chainTex() {
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d');
  x.clearRect(0, 0, N, N); x.lineCap = 'round';
  for (const [w, col] of [[5, 'rgba(70,72,72,1)'], [3, 'rgba(210,214,214,1)']]) {
    x.strokeStyle = col; x.lineWidth = w;
    for (let k = -2; k <= 2; k++) {
      x.beginPath(); x.moveTo(k * N / 2, 0); x.lineTo(k * N / 2 + N, N); x.stroke();
      x.beginPath(); x.moveTo(k * N / 2 + N, 0); x.lineTo(k * N / 2, N); x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.batch = new MeshBatch();
    this.barrels = [];
    this.glass = [];
    this.ammoCrates = [];
    this.lamps = [];
    this.spawns = [];
    this.playerSpawn = new THREE.Vector3(0, 0, 58);
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  // ── 재질 ──
  makeMaterials() {
    const std = (tex, { metalMap, ...o } = {}) => patchInterior(new THREE.MeshStandardMaterial({ map: tex?.map, normalMap: tex?.normalMap, roughnessMap: tex?.roughnessMap, metalnessMap: metalMap ? tex?.roughnessMap : null, ...o }));
    const M = this.M = {
      concrete: std(T.concrete, { roughness: 1 }),
      slab: std(T.slab, { roughness: 1 }),
      dirt: std(T.dirt, { roughness: 1 }),
      asphalt: std(T.asphalt, { roughness: 1 }),
      metalWall: std(T.corrugated, { color: 0x8c979c, roughness: 1, metalness: 0.55, metalMap: true }),
      roof: std(T.corrugated, { color: 0x5d6266, roughness: 1, metalness: 0.5, metalMap: true }),
      crate: std(T.planks, { roughness: 1 }),
      pallet: std(T.planks, { color: 0x9a8a78, roughness: 1 }),
      steel: std(T.steel, { color: 0x44484c, roughness: 1, metalness: 1, metalMap: true }),
      rackBlue: std(T.steel, { color: 0x1d4f8c, roughness: 0.9, metalness: 0.4 }),
      rackOrange: std(T.steel, { color: 0xd2621c, roughness: 0.9, metalness: 0.4 }),
      diamond: std(T.diamond, { roughness: 1, metalness: 1, metalMap: true }),
      sandbag: std(T.sandbag, { roughness: 1 }),
      plaster: std(T.plaster, { roughness: 1 }),
      plasterIn: std(T.plaster, { color: 0xd8e0e2, roughness: 1 }),
      tiles: std(T.tiles, { roughness: 1 }),
      barrelRed: std(T.steel, { color: 0xa3190f, roughness: 0.8, metalness: 0.5 }),
      barrelBlue: std(T.steel, { color: 0x1f3f78, roughness: 0.8, metalness: 0.5 }),
      barrelGray: std(T.steel, { color: 0x6c6f6a, roughness: 0.8, metalness: 0.5 }),
      olive: std(T.steel, { color: 0x4b5237, roughness: 0.75, metalness: 0.3 }),
      canvas: std(T.fabric, { color: 0x5d5a3f, roughness: 1 }),
      rubber: patchInterior(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 })),
      dark: patchInterior(new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.7, metalness: 0.2 })),
      ammoBox: std(T.steel, { color: 0x3f4a2c, roughness: 0.7, metalness: 0.4 }),
      yellow: std(T.steel, { color: 0xd9a514, roughness: 0.7, metalness: 0.3 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x9fb6c0, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.28, envMapIntensity: 1.6, depthWrite: false }),
      lamp: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(1, 0.86, 0.62), emissiveIntensity: 9 }),
      marker: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(0.3, 1, 0.45), emissiveIntensity: 5 }),
      chain: new THREE.MeshStandardMaterial({ map: chainTex(), color: 0xb8bcbc, alphaTest: 0.45, side: THREE.DoubleSide, metalness: 0.75, roughness: 0.45 }),
      galv: std(T.steel, { color: 0x9aa0a2, roughness: 0.7, metalness: 0.85 }),
      tree: patchInterior(new THREE.MeshStandardMaterial({ color: 0x2b3a22, roughness: 1 })),
      trunk: patchInterior(new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 1 })),
    };
    const cc = [0x8a2d1d, 0x1f4e7a, 0x3c5a2e, 0xb25a1e, 0x6b6f72, 0xb8b8b0, 0x7a1f28];
    this.containerMats = cc.map((c) => std(T.corrugated, { color: c, roughness: 1, metalness: 0.5, metalMap: true }));
  }

  // ── 기본 박스 (y = 바닥 높이) ──
  box(x, y, z, w, h, d, mat, { collide = true, surf = 'concrete', tile = 2, uvOff = true } = {}) {
    const g = boxGeo(w, h, d, tile, uvOff ? x - w / 2 : 0, uvOff ? y : 0, uvOff ? z - d / 2 : 0);
    this.batch.add(g, mat, x, y + h / 2, z);
    if (collide) return this.addCollider(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, surf);
  }
  addCollider(x0, y0, z0, x1, y1, z1, surf = 'concrete', extra = {}) {
    const c = { min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1), surf, ...extra };
    this.colliders.push(c);
    return c;
  }

  // 개구부(문/창)가 있는 벽. axis 'x' → x 방향으로 뻗은 벽 (z 고정)
  wall(axis, fixed, a0, a1, y0, y1, th, mat, openings = [], opts = {}) {
    const ops = openings.slice().sort((p, q) => p[0] - q[0]);
    let cur = a0;
    const seg = (s0, s1, yy0, yy1) => {
      if (s1 - s0 < 0.01 || yy1 - yy0 < 0.01) return;
      const c = (s0 + s1) / 2, L = s1 - s0;
      if (axis === 'x') this.box(c, yy0, fixed, L, yy1 - yy0, th, mat, opts);
      else this.box(fixed, yy0, c, th, yy1 - yy0, L, mat, opts);
    };
    for (const [s0, s1, oy0, oy1, glass] of ops) {
      seg(cur, s0, y0, y1);
      seg(s0, s1, y0, oy0);
      seg(s0, s1, oy1, y1);
      if (glass) this.glassPane(axis, fixed, s0, s1, oy0, oy1);
      cur = s1;
    }
    seg(cur, a1, y0, y1);
  }

  glassPane(axis, fixed, s0, s1, y0, y1) {
    const w = s1 - s0, h = y1 - y0, c = (s0 + s1) / 2;
    const geo = new THREE.BoxGeometry(axis === 'x' ? w : 0.02, h, axis === 'x' ? 0.02 : w);
    const mesh = new THREE.Mesh(geo, this.M.glass);
    mesh.position.set(axis === 'x' ? c : fixed, y0 + h / 2, axis === 'x' ? fixed : c);
    mesh.renderOrder = 2;
    this.group.add(mesh);
    const col = axis === 'x'
      ? this.addCollider(s0, y0, fixed - 0.03, s1, y1, fixed + 0.03, 'glass')
      : this.addCollider(fixed - 0.03, y0, s0, fixed + 0.03, y1, s1, 'glass');
    col.glass = mesh;
    this.glass.push(col);
    // 창틀
    const fr = this.M.steel, t = 0.06;
    if (axis === 'x') { this.box(c, y0 - t, fixed, w + t * 2, t, 0.12, fr, { collide: false }); this.box(c, y1, fixed, w + t * 2, t, 0.12, fr, { collide: false }); }
    else { this.box(fixed, y0 - t, c, 0.12, t, w + t * 2, fr, { collide: false }); this.box(fixed, y1, c, 0.12, t, w + t * 2, fr, { collide: false }); }
  }

  cylinder(x, y, z, r, h, mat, { seg = 20, axis = 'y', collide = true, surf = 'metal', open = false } = {}) {
    const g = new THREE.CylinderGeometry(r, r, h, seg, 1, open);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (2 * Math.PI * r) / 2, uv.getY(i) * h / 2);
    if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
    this.batch.add(g, mat, x, y, z);
    if (collide) {
      const ex = axis === 'x' ? h / 2 : r, ey = axis === 'y' ? h / 2 : r, ez = axis === 'z' ? h / 2 : r;
      return this.addCollider(x - ex, y - ey, z - ez, x + ex, y + ey, z + ez, surf);
    }
  }

  // ── 맵 빌드 ──
  build() {
    this.makeMaterials();
    const M = this.M, B = (...a) => this.box(...a);
    this.buildTerrain();

    // 단지 바닥 슬래브 + 도로
    B(0, -0.3, 0, 140, 0.3, 140, M.slab, { collide: false, tile: 12 });
    B(0, 0, 20, 9, 0.012, 100, M.asphalt, { collide: false, tile: 6 });
    B(-35, 0, 22, 60, 0.012, 8, M.asphalt, { collide: false, tile: 6 });

    // 외벽 (패널 + 기둥) — 남쪽 정문
    const FH = 3.1;
    this.fence('x', -70, -70, 70, FH);
    this.fence('x', 70, -70, 70, FH, [[-5.2, 5.2]]);
    this.fence('z', -70, -70, 70, FH);
    this.fence('z', 70, -70, 70, FH);
    for (const sx of [-5.6, 5.6]) B(sx, 0, 70, 0.5, 3.6, 0.5, M.concrete, { tile: 2 });
    // 정문 (슬라이딩 게이트)
    this.addCollider(-5, 0, 69.7, 5, 3.4, 70.3, 'metal');
    B(0, 0.05, 70, 10, 0.12, 0.12, M.steel, { collide: false });
    B(0, 3.2, 70, 10, 0.12, 0.12, M.steel, { collide: false });
    for (let x = -4.9; x <= 4.9; x += 0.35) B(x, 0.1, 70, 0.05, 3.1, 0.05, M.steel, { collide: false });
    B(0, 1.6, 70, 10, 0.1, 0.06, M.steel, { collide: false });

    this.buildWarehouse();
    this.buildOffice();
    this.buildContainers();
    this.buildYard();

    const g = this.batch.build(new THREE.Group(), { cast: true, receive: true });
    this.group.add(g);
    this.buildNav();
  }

  buildTerrain() {
    const size = 1400, seg = 200;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position, uv = geo.attributes.uv, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, terrainH(x, z));
      uv.setXY(i, x / 14, z / 14);
      // r: 풀 비율, g: 마른 풀 정도
      col[i * 3] = grassK(x, z); col[i * 3 + 1] = fbm(x / 60 + 9, z / 60 + 4, 3, 2); col[i * 3 + 2] = 0;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = this.M.dirt.clone(); mat.vertexColors = true;
    const gt = turfTex();
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTurf = { value: gt };
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uTurf;')
        .replace('#include <color_fragment>', `
          vec2 tuv = vMapUv * 3.1;
          vec3 turf = texture2D(uTurf, tuv).rgb * 0.62 + texture2D(uTurf, tuv * 0.23 + 0.37).rgb * 0.38;
          turf *= mix(vec3(0.92, 1.0, 0.9), vec3(1.3, 1.08, 0.62), smoothstep(0.35, 0.8, vColor.g));
          diffuseColor.rgb = mix(diffuseColor.rgb, turf, smoothstep(0.1, 0.55, vColor.r));`);
    };
    mat.customProgramCacheKey = () => 'terrain-turf';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  // 철망 울타리 (기둥 파이프 + 상단 레일 + 가시철선) — 총알은 통과, 사람/투척물은 막힘
  fence(axis, fixed, a0, a1, H, gaps = []) {
    const M = this.M, segs = [];
    let cur = a0;
    for (const [g0, g1] of gaps) { segs.push([cur, g0]); cur = g1; }
    segs.push([cur, a1]);
    for (const [s0, s1] of segs) {
      const L = s1 - s0, c = (s0 + s1) / 2;
      if (axis === 'x') this.addCollider(s0, 0, fixed - 0.15, s1, H + 0.4, fixed + 0.15, 'metal', { thin: true, pass: true });
      else this.addCollider(fixed - 0.15, 0, s0, fixed + 0.15, H + 0.4, s1, 'metal', { thin: true, pass: true });
      const g = new THREE.PlaneGeometry(L, H - 0.05);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L / 0.12, uv.getY(i) * (H - 0.05) / 0.12);
      const m = new THREE.Mesh(g, M.chain);
      m.position.set(axis === 'x' ? c : fixed, 0.03 + (H - 0.05) / 2, axis === 'x' ? fixed : c);
      if (axis === 'z') m.rotation.y = Math.PI / 2;
      m.receiveShadow = true; m.castShadow = true;
      this.group.add(m);
      const n = Math.max(1, Math.round(L / 3));
      for (let k = 0; k <= n; k++) {
        const t = s0 + (L * k) / n, x = axis === 'x' ? t : fixed, z = axis === 'x' ? fixed : t;
        this.cylinder(x, H / 2 + 0.2, z, 0.038, H + 0.4, M.galv, { seg: 10, collide: false });
        // 가시철선 암 (바깥쪽 45°)
        const out = Math.sign(fixed) * 0.18;
        const ax = axis === 'x' ? x : x + out, az = axis === 'x' ? z + out : z;
        this.box(ax, H + 0.2, az, axis === 'x' ? 0.03 : 0.4, 0.03, axis === 'x' ? 0.4 : 0.03, M.galv, { collide: false });
      }
      const ra = axis === 'x' ? 'x' : 'z';
      this.cylinder(axis === 'x' ? c : fixed, H, axis === 'x' ? fixed : c, 0.022, L, M.galv, { seg: 8, axis: ra, collide: false });
      this.cylinder(axis === 'x' ? c : fixed, 0.1, axis === 'x' ? fixed : c, 0.012, L, M.galv, { seg: 6, axis: ra, collide: false });
      for (let w = 0; w < 3; w++) {
        const out = Math.sign(fixed) * (0.02 + w * 0.08);
        this.cylinder(axis === 'x' ? c : fixed + out, H + 0.25 + w * 0.06, axis === 'x' ? fixed + out : c, 0.004, L, M.galv, { seg: 4, axis: ra, collide: false });
      }
    }
  }

  buildWarehouse() {
    const M = this.M, B = (...a) => this.box(...a);
    const X0 = -24, X1 = 24, Z0 = -58, Z1 = -30, H = 9, th = 0.4;
    INTERIOR.min.value[0].set(X0, 0, Z0); INTERIOR.max.value[0].set(X1, H, Z1);
    const wopt = { surf: 'metal', tile: 3 };
    // 콘크리트 기초 1m + 골강판 벽
    const walls = [
      ['x', Z1 - th / 2, X0, X1, [[-16, -9, 0, 5.5], [5, 12, 0, 5.5], [-3, -1.8, 0, 2.3]]],
      ['x', Z0 + th / 2, X0, X1, [[-2.5, 2.5, 0, 3.6]]],
      ['z', X1 - th / 2, Z0, Z1, [[-47, -41, 0, 4.5]]],
      ['z', X0 + th / 2, Z0, Z1, [[-37, -34.5, 0, 2.6]]],
    ];
    for (const [ax, f, a0, a1, ops] of walls) {
      const low = ops.map(([s0, s1, oy0, oy1]) => [s0, s1, oy0, Math.min(oy1, 1)]);
      this.wall(ax, f, a0, a1, 0, 1, th + 0.06, M.concrete, low);
      const hi = ops.filter((o) => o[3] > 1).map(([s0, s1, , oy1]) => [s0, s1, 1, oy1]);
      this.wall(ax, f, a0, a1, 1, H, th, M.metalWall, hi, wopt);
    }
    // 채광창 띠 (벽 상단)
    for (const x of [-18, -6, 6, 18]) {
      B(x, 6.6, Z1 - 0.1, 6, 1.1, 0.06, M.glass, { collide: false });
    }
    // 롤업 도어 (반쯤 올라감)
    for (const [a, b] of [[-16, -9], [5, 12]]) {
      B((a + b) / 2, 5.5, Z1 - 0.1, b - a, 0.8, 0.25, M.steel, { surf: 'metal' });
      for (let y = 5.5; y < 6.3; y += 0.1) B((a + b) / 2, y, Z1 - 0.26, b - a, 0.02, 0.02, M.steel, { collide: false });
    }
    // 지붕 (채광 슬롯 2개)
    const ry = H;
    const roofSeg = (x0, x1) => B((x0 + x1) / 2, ry, (Z0 + Z1) / 2, x1 - x0, 0.3, Z1 - Z0 + 1, M.roof, { surf: 'metal', tile: 3 });
    roofSeg(X0 - 0.5, -12); roofSeg(-10, 10); roofSeg(12, X1 + 0.5);
    for (const x of [-11, 11]) {
      B(x, ry, -54, 2, 0.3, 4, M.roof, { surf: 'metal', tile: 3 }); B(x, ry, -34.5, 2, 0.3, 5, M.roof, { surf: 'metal', tile: 3 });
      B(x, ry + 0.25, -44, 2, 0.04, 16, M.glass, { collide: false });
    }
    // 트러스
    for (let z = Z0 + 3.5; z < Z1; z += 7) {
      B(0, H - 0.6, z, X1 - X0 - 1, 0.35, 0.2, M.steel, { collide: false });
      for (let x = X0 + 2; x < X1 - 1; x += 3) B(x, H - 1.4, z, 0.08, 0.8, 0.08, M.steel, { collide: false });
      B(0, H - 1.5, z, X1 - X0 - 1, 0.12, 0.15, M.steel, { collide: false });
    }
    // 내부 바닥 (에폭시 느낌의 콘크리트)
    B(0, 0, (Z0 + Z1) / 2, X1 - X0 - 0.8, 0.02, Z1 - Z0 - 0.8, M.concrete, { collide: false, tile: 5 });
    // 기둥
    for (const x of [-8, 8]) for (const z of [-51, -44, -37]) B(x, 0, z, 0.4, H, 0.4, M.steel, { surf: 'metal' });
    // 랙 (북쪽)
    for (const [x0, x1] of [[-20, -6], [6, 20]]) {
      const z0 = -57.1, z1 = -55.9;
      for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / 5) { B(x, 0, z0, 0.1, 5.2, 0.1, M.rackBlue, { surf: 'metal' }); B(x, 0, z1, 0.1, 5.2, 0.1, M.rackBlue, { surf: 'metal' }); }
      for (const y of [1.6, 3.2, 4.8]) {
        B((x0 + x1) / 2, y, z0, x1 - x0, 0.12, 0.08, M.rackOrange, { collide: false });
        B((x0 + x1) / 2, y, z1, x1 - x0, 0.12, 0.08, M.rackOrange, { collide: false });
        this.addCollider(x0, y, z0 - 0.05, x1, y + 0.12, z1 + 0.05, 'metal');
      }
      for (const y of [0, 1.72, 3.32]) for (let x = x0 + 1.4; x < x1; x += 2.8) {
        if (Math.random() < 0.2) continue;
        B(x, y, (z0 + z1) / 2, 1.2, 0.14, 1.0, M.pallet, { surf: 'wood', tile: 1 });
        const h = 0.6 + Math.random() * 0.7;
        B(x + (Math.random() - 0.5) * 0.2, y + 0.14, (z0 + z1) / 2, 1.1, Math.min(h, 1.4), 0.95, M.crate, { surf: 'wood', tile: 1.2 });
      }
    }
    // 내부 엄폐물
    const crateStack = (x, z, n = 2, s = 1.2) => {
      for (let i = 0; i < n; i++) B(x + (i % 2) * s * 1.02, 0, z, s, s, s, M.crate, { surf: 'wood', tile: 1.2 });
      if (n > 1) B(x + s * 0.5, s, z, s, s, s, M.crate, { surf: 'wood', tile: 1.2 });
    };
    crateStack(-15, -44, 2); crateStack(13, -40, 2); crateStack(-4, -52, 2); crateStack(16, -50, 1, 1.4);
    B(3, 0, -41, 1.2, 0.14, 1.0, M.pallet, { surf: 'wood', tile: 1 }); B(3, 0.14, -41, 1.1, 1.0, 0.9, M.crate, { surf: 'wood', tile: 1.2 });
    // 지게차
    this.forklift(-1, -45, 0.4);
    // 작업대
    B(18, 0, -34, 3, 0.9, 1, M.steel, { surf: 'metal' });
    B(18, 0.9, -34, 3.1, 0.06, 1.1, M.crate, { collide: false, tile: 1 });
    // 캣워크 + 계단 (서쪽)
    const cy = 4;
    B(-22.1, cy, -47, 3, 0.2, 18, M.diamond, { surf: 'metal', tile: 1.5 });
    B(-21.2, cy, -39, 4.8, 0.2, 2, M.diamond, { surf: 'metal', tile: 1.5 });
    for (const z of [-55, -49, -43]) B(-20.8, 0, z, 0.2, cy, 0.2, M.steel, { surf: 'metal' });
    B(-18.9, 0, -39.5, 0.2, cy, 0.2, M.steel, { surf: 'metal' });
    const rail = (x, z, w, d) => {
      B(x, cy + 1.05, z, w, 0.06, d, M.yellow, { collide: false });
      B(x, cy + 0.6, z, w, 0.05, d, M.yellow, { collide: false });
      this.addCollider(x - w / 2 - 0.03, cy + 0.2, z - d / 2 - 0.03, x + w / 2 + 0.03, cy + 1.15, z + d / 2 + 0.03, 'metal', { thin: true });
      const n = Math.max(1, Math.round(Math.max(w, d) / 1.5));
      for (let i = 0; i <= n; i++) {
        const t = i / n - 0.5;
        B(x + t * (w > d ? w : 0), cy + 0.2, z + t * (d > w ? d : 0), 0.05, 0.9, 0.05, M.yellow, { collide: false });
      }
    };
    rail(-20.6, -48, 0.05, 16);
    rail(-19.7, -40, 1.8, 0.05);
    rail(-18.8, -39, 0.05, 2);
    rail(-22.1, -38, 3, 0.05);
    // 계단: z -32 → -38 (16 단)
    const steps = 16, run = 6 / steps, rise = cy / steps;
    for (let i = 0; i < steps; i++) {
      const z = -32 - (i + 0.5) * run, y = (i + 1) * rise;
      B(-19.7, y - 0.05, z, 1.7, 0.05, run + 0.02, M.diamond, { collide: false, tile: 1.5 });
      this.addCollider(-20.55, 0, z - run / 2, -18.85, y, z + run / 2, 'metal');
    }
    for (const x of [-20.6, -18.8]) {
      const g = new THREE.BoxGeometry(0.06, 0.3, Math.hypot(6, cy) + 0.2);
      this.batch.add(g, M.steel, x, cy / 2, -35, Math.atan2(cy, 6), 0, 0);
    }
    const rg = new THREE.BoxGeometry(0.05, 0.05, Math.hypot(6, cy));
    this.batch.add(rg, M.yellow, -18.8, cy / 2 + 1.05, -35, Math.atan2(cy, 6), 0, 0);
    // 조명
    for (const [x, z] of [[-12, -44], [0, -37], [12, -51]]) {
      B(x, H - 2.2, z, 1.2, 0.08, 0.4, M.lamp, { collide: false });
      B(x, H - 2.12, z, 1.3, 0.12, 0.5, M.steel, { collide: false });
      B(x, H - 2.0, z, 0.03, 1.4, 0.03, M.steel, { collide: false });
      this.lamps.push(new THREE.Vector3(x, H - 2.4, z));
    }
    // 폭발 드럼통 + 일반 드럼통
    this.barrel(-18, -33, true); this.barrel(-17.3, -33.2, false); this.barrel(20, -54, true); this.barrel(10, -33, true);
    this.ammoCrate(1.5, -56.5);
  }

  forklift(x, z, rot) {
    const M = this.M, B = (...a) => this.box(...a);
    B(x, 0.3, z, 1.2, 1.0, 2.2, M.yellow, { surf: 'metal' });
    B(x, 1.3, z + 0.3, 1.1, 0.08, 1.2, M.dark, { collide: false });
    for (const dx of [-0.52, 0.52]) for (const dz of [-0.6, 0.6]) B(x + dx, 1.3, z + 0.3 + dz, 0.06, 0.9, 0.06, M.dark, { collide: false });
    B(x, 0, z - 1.3, 1.0, 2.6, 0.12, M.dark, { surf: 'metal' });
    B(x - 0.3, 0.05, z - 1.9, 0.12, 0.06, 1.1, M.dark, { collide: false }); B(x + 0.3, 0.05, z - 1.9, 0.12, 0.06, 1.1, M.dark, { collide: false });
    for (const dx of [-0.6, 0.6]) for (const dz of [-0.7, 0.8]) this.cylinder(x + dx, 0.3, z + dz, 0.3, 0.22, M.rubber, { axis: 'x', collide: false });
  }

  barrel(x, z, explosive, y = 0) {
    const M = this.M, r = 0.29, h = 0.88;
    const mat = explosive ? M.barrelRed : Math.random() < 0.5 ? M.barrelBlue : M.barrelGray;
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), mat);
    body.position.y = h / 2; body.castShadow = body.receiveShadow = true; grp.add(body);
    for (const yy of [0.3, 0.6]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.004, 0.012, 6, 28), mat); ring.rotation.x = Math.PI / 2; ring.position.y = yy; grp.add(ring); }
    if (explosive) { const band = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.003, r + 0.003, 0.12, 24, 1, true), M.yellow); band.position.y = 0.72; grp.add(band); }
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.01, r - 0.01, 0.02, 24), M.steel); top.position.y = h; grp.add(top);
    grp.position.set(x, y, z);
    grp.rotation.y = Math.random() * 6;
    this.group.add(grp);
    const col = this.addCollider(x - r, y, z - r, x + r, y + h, z + r, 'metal');
    if (explosive) { col.barrel = { mesh: grp, hp: 30, pos: new THREE.Vector3(x, y + 0.5, z), col, exploded: false }; this.barrels.push(col.barrel); }
    return col;
  }

  ammoCrate(x, z) {
    const M = this.M;
    this.box(x, 0, z, 1.1, 0.55, 0.6, M.ammoBox, { surf: 'metal' });
    this.box(x, 0.55, z, 1.12, 0.06, 0.62, M.ammoBox, { collide: false });
    this.box(x, 0.3, z - 0.301, 0.5, 0.12, 0.01, M.marker, { collide: false });
    this.ammoCrates.push(new THREE.Vector3(x, 0.5, z));
  }

  buildOffice() {
    const M = this.M, B = (...a) => this.box(...a);
    const X0 = -62, X1 = -44, Z0 = -12, Z1 = 6, H = 3.4, th = 0.3;
    INTERIOR.min.value[1].set(X0, 0, Z0); INTERIOR.max.value[1].set(X1, H, Z1);
    const o = { tile: 3 };
    this.wall('z', X1 - th / 2, Z0, Z1, 0, H, th, M.plaster, [[-3.6, -2.1, 0, 2.2], [-10, -7.5, 1, 2.2, true], [0.5, 3, 1, 2.2, true]], o);
    this.wall('z', X0 + th / 2, Z0, Z1, 0, H, th, M.plaster, [[-6, -3.5, 1, 2.2, true]], o);
    this.wall('x', Z1 - th / 2, X0, X1, 0, H, th, M.plaster, [[-50, -48.6, 0, 2.2], [-59, -56.5, 1, 2.2, true], [-55, -52.5, 1, 2.2, true]], o);
    this.wall('x', Z0 + th / 2, X0, X1, 0, H, th, M.plaster, [[-58, -55.5, 1, 2.2, true], [-50, -47.5, 1, 2.2, true]], o);
    this.wall('z', -53, Z0, Z1, 0, H, 0.2, M.plasterIn, [[-4, -2.8, 0, 2.2]], o);
    B((X0 + X1) / 2, 0, (Z0 + Z1) / 2, X1 - X0 - 0.2, 0.04, Z1 - Z0 - 0.2, M.tiles, { collide: false, tile: 4 });
    B((X0 + X1) / 2, H, (Z0 + Z1) / 2, X1 - X0 + 0.6, 0.3, Z1 - Z0 + 0.6, M.concrete, { tile: 3 });
    B((X0 + X1) / 2, H + 0.3, (Z0 + Z1) / 2, X1 - X0 + 0.7, 0.35, 0.3, M.concrete, { collide: false });
    // 가구
    const desk = (x, z) => { B(x, 0.72, z, 1.6, 0.05, 0.8, M.crate, { tile: 1, surf: 'wood' }); for (const dx of [-0.75, 0.75]) B(x + dx, 0, z, 0.05, 0.72, 0.75, M.steel, { surf: 'metal' }); this.addCollider(x - 0.8, 0, z - 0.4, x + 0.8, 0.77, z + 0.4, 'wood'); B(x + 0.3, 0.77, z - 0.1, 0.5, 0.35, 0.05, M.dark, { collide: false }); };
    desk(-58, -8); desk(-58, 2); desk(-48, -9); desk(-47, 2.5);
    for (const z of [-11.3, -10.6, -9.9]) B(-61.5, 0, z, 0.6, 1.3, 0.65, M.barrelGray, { surf: 'metal' });
    B(-45, 0, -6, 0.8, 1.9, 0.5, M.barrelGray, { surf: 'metal' });
    B(-55.5, 0, -5, 1.2, 1.2, 1.2, M.crate, { surf: 'wood', tile: 1.2 });
    B(-52, H - 0.15, -3, 1.2, 0.06, 0.3, M.lamp, { collide: false });
    this.lamps.push(new THREE.Vector3(-52, H - 0.5, -3));
    this.ammoCrate(-60.5, 4.8);
  }

  buildContainers() {
    const list = [
      [34, -45, 0, 0], [34, -45, 0, 1], [34, -30, 0, 0], [34, -14, 0, 0], [34, -14, 0, 1],
      [42, -40, 0, 0], [42, -22, 0, 0], [42, 6, 0, 0], [42, 6, 0, 1],
      [52, -46, 0, 0], [52, -30, 0, 0], [52, -30, 0, 1], [52, -8, 0, 0], [52, 14, 0, 0],
      [62, -40, 0, 0], [62, -40, 0, 1], [62, -20, 0, 0], [62, 4, 0, 0], [62, 4, 0, 1],
      [48, 30, 1, 0], [36, 38, 1, 0], [58, 45, 1, 0], [58, 45, 1, 1],
    ];
    list.forEach(([x, z, rot, lvl], i) => this.container(x, z, rot, lvl, this.containerMats[(i * 3 + lvl) % this.containerMats.length]));
  }

  container(x, z, rot, lvl, mat) {
    const M = this.M, L = 12.19, W = 2.44, H = 2.59, y = lvl * H;
    const w = rot ? L : W, d = rot ? W : L;
    this.box(x, y + 0.08, z, w - 0.04, H - 0.16, d - 0.04, mat, { surf: 'metal', tile: 2.6 });
    this.addCollider(x - w / 2, y, z - d / 2, x + w / 2, y + H, z + d / 2, 'metal');
    // 프레임/코너 캐스팅
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this.box(x + sx * (w / 2 - 0.09), y, z + sz * (d / 2 - 0.09), 0.18, H, 0.18, M.dark, { collide: false });
    }
    for (const yy of [y, y + H - 0.16]) {
      this.box(x, yy, z - d / 2 + 0.07, w, 0.16, 0.14, M.dark, { collide: false });
      this.box(x, yy, z + d / 2 - 0.07, w, 0.16, 0.14, M.dark, { collide: false });
      this.box(x - w / 2 + 0.07, yy, z, 0.14, 0.16, d, M.dark, { collide: false });
      this.box(x + w / 2 - 0.07, yy, z, 0.14, 0.16, d, M.dark, { collide: false });
    }
    // 도어 잠금봉
    const endP = rot ? [x + w / 2 + 0.03, z] : [x, z + d / 2 + 0.03];
    for (const o of [-0.8, -0.35, 0.35, 0.8]) {
      const px = rot ? endP[0] : x + o, pz = rot ? z + o : endP[1];
      this.box(px, y + 0.2, pz, 0.05, H - 0.4, 0.05, M.steel, { collide: false });
    }
  }

  buildYard() {
    const M = this.M, B = (...a) => this.box(...a);
    // 저지 방호벽
    const jersey = (x, z, rot) => {
      const s = new THREE.Shape();
      s.moveTo(-0.3, 0); s.lineTo(0.3, 0); s.lineTo(0.3, 0.08); s.lineTo(0.16, 0.33); s.lineTo(0.08, 0.81); s.lineTo(-0.08, 0.81); s.lineTo(-0.16, 0.33); s.lineTo(-0.3, 0.08); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 });
      g.translate(0, 0, -1.5);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
      this.batch.add(g, M.concrete, x, 0, z, 0, rot, 0);
      if (Math.abs(Math.sin(rot)) > 0.5) this.addCollider(x - 1.52, 0, z - 0.3, x + 1.52, 0.81, z + 0.3); else this.addCollider(x - 0.3, 0, z - 1.52, x + 0.3, 0.81, z + 1.52);
    };
    for (const [x, z, r] of [[-6, 40, 0], [6, 40, 0], [-6, 16, 0], [6, 12, 0], [-3.1, 28, Math.PI / 2], [3.1, -12, Math.PI / 2], [0, -18, Math.PI / 2], [-14, 48, Math.PI / 2], [14, 50, Math.PI / 2], [20, 20, 0], [-22, -14, 0], [26, 0, Math.PI / 2]]) jersey(x, z, r);
    // 모래주머니 진지
    const sb = (x, z, w, d) => B(x, 0, z, w, 1.1, d, M.sandbag, { surf: 'dirt', tile: 1.6 });
    sb(-14, 6, 4, 0.7); sb(-16.3, 7.6, 0.7, 3.8); sb(-11.7, 7.6, 0.7, 3.8);
    sb(16, 33, 4.2, 0.7); sb(13.6, 31.4, 0.7, 3.8);
    sb(30, 52, 0.7, 5); sb(-32, 38, 5, 0.7);
    // 나무 상자 무더기
    const cs = (x, z, list) => list.forEach(([dx, dy, dz, s]) => B(x + dx, dy, z + dz, s, s, s, M.crate, { surf: 'wood', tile: 1.2 }));
    cs(10, 4, [[0, 0, 0, 1.2], [1.22, 0, 0, 1.2], [0.6, 1.2, 0, 1.2], [0, 0, 1.3, 1.0]]);
    cs(-22, 26, [[0, 0, 0, 1.4], [0, 1.4, 0, 1.0], [1.5, 0, 0.2, 1.1]]);
    cs(20, -22, [[0, 0, 0, 1.2], [1.25, 0, 0, 1.2], [0, 1.2, 0, 1.2], [0, 0, 1.25, 1.2]]);
    cs(-30, -22, [[0, 0, 0, 1.2], [0, 1.2, 0, 1.2]]);
    cs(-40, 14, [[0, 0, 0, 1.3], [1.35, 0, 0, 1.3], [0.2, 1.3, 0, 1.0]]);
    cs(24, 60, [[0, 0, 0, 1.2], [1.25, 0, 0, 1.2]]);
    cs(-26, 60, [[0, 0, 0, 1.2], [0, 1.2, 0, 1.0]]);
    // 팔레트 더미
    for (const [x, z] of [[-4, 52], [12, -26], [-34, -4], [30, 12]]) for (let i = 0; i < 4; i++) B(x, i * 0.145, z, 1.2, 0.14, 1.0, M.pallet, { surf: 'wood', tile: 1 });
    // 군용 트럭
    this.truck(-18, 32);
    this.truck(34, 58, Math.PI / 2);
    // 연료 탱크
    this.cylinder(14, 1.9, -4, 1.4, 6.5, M.barrelGray, { axis: 'z', seg: 28 });
    for (const dz of [-2.2, 2.2]) B(14, 0, -4 + dz, 2.4, 0.9, 0.3, M.steel, { surf: 'metal' });
    this.cylinder(14, 1.9, -0.7, 1.3, 0.1, M.steel, { axis: 'z', collide: false });
    // 콘크리트 블록
    for (const [x, z] of [[-36, 50], [-35, 51.1], [40, 22], [-8, -24], [-9.1, -23.6], [24, -12], [-44, 30], [-2, 34]]) B(x, 0, z, 1, 1, 1, M.concrete, { tile: 1.5 });
    // 경비초소
    B(10, 0, 62, 3, 2.7, 3, M.plaster, { tile: 3 });
    B(10, 2.7, 62, 3.6, 0.2, 3.6, M.concrete, { tile: 3 });
    B(10, 1.2, 60.49, 2, 1, 0.02, M.glass, { collide: false });
    // 감시탑
    for (const [tx, tz] of [[-63, 63], [63, -63], [-63, -63]]) {
      for (const dx of [-1.3, 1.3]) for (const dz of [-1.3, 1.3]) B(tx + dx, 0, tz + dz, 0.25, 6, 0.25, M.steel, { surf: 'metal' });
      B(tx, 6, tz, 3.4, 0.25, 3.4, M.pallet, { tile: 1, surf: 'wood' });
      B(tx, 6.25, tz, 3.4, 1.0, 0.1, M.pallet, { collide: false }); B(tx, 6.25, tz - 1.65, 3.4, 1.0, 0.1, M.pallet, { collide: false });
      B(tx, 8.6, tz, 4, 0.15, 4, M.roof, { collide: false, tile: 3 });
      for (const dx of [-1.6, 1.6]) for (const dz of [-1.6, 1.6]) B(tx + dx, 6.25, tz + dz, 0.12, 2.35, 0.12, M.steel, { collide: false });
    }
    // 가로등
    for (const [x, z] of [[-9, 50], [9, 30], [-9, 5], [9, -18], [30, 30], [-35, 30], [20, 45], [-30, -28]]) {
      this.cylinder(x, 3.5, z, 0.09, 7, M.steel, { seg: 10 });
      B(x + (x > 0 ? -0.8 : 0.8), 6.9, z, 1.8, 0.12, 0.2, M.steel, { collide: false });
      B(x + (x > 0 ? -1.4 : 1.4), 6.82, z, 0.6, 0.08, 0.3, M.lamp, { collide: false });
    }
    // 창고 외부 공조기/발전기
    B(28, 0, -54, 2.2, 1.6, 1.4, M.barrelGray, { surf: 'metal' });
    B(28, 1.6, -54, 1.2, 0.12, 1.2, M.dark, { collide: false });
    B(-29, 0, -46, 3, 1.8, 1.6, M.olive, { surf: 'metal' });
    // 폭발 드럼통
    for (const [x, z, e] of [[8, -20, 1], [8.7, -20.4, 1], [-26, 3, 1], [-25.4, 3.5, 0], [27, 40, 1], [40, -3, 1], [-3, 44, 1], [45, 24, 0], [-42, -18, 1], [16, 22, 1], [-10, -8, 1], [-9.5, -8.6, 0]]) this.barrel(x, z, !!e);
    this.ammoCrate(-2, 64.5);
    // 적 스폰 지점
    this.spawns.push(...[[-60, -64], [60, -64], [0, -65], [66, 36], [-66, 40], [-36, -40], [66, -6], [-66, -26], [46, 62], [-50, 62]].map(([x, z]) => new THREE.Vector3(x, 0, z)));
  }

  truck(x, z, rot = 0) {
    const M = this.M, grp = new MeshBatch();
    const add = (w, h, d, mat, px, py, pz) => grp.add(boxGeo(w, h, d, 2), mat, px, py + h / 2, pz);
    add(2.4, 1.2, 1.9, M.olive, 0, 0.9, -2.9);   // 보닛
    add(2.4, 1.3, 1.6, M.olive, 0, 1.3, -1.4);   // 캐빈
    add(2.2, 0.5, 0.05, M.glass, 0, 1.9, -2.22);
    add(2.4, 0.25, 5, M.olive, 0, 1.1, 1.3);     // 적재함 바닥
    add(0.08, 0.6, 5, M.olive, -1.18, 1.35, 1.3); add(0.08, 0.6, 5, M.olive, 1.18, 1.35, 1.3);
    add(2.4, 0.6, 0.08, M.olive, 0, 1.35, 3.76);
    add(2.6, 0.25, 7.6, M.dark, 0, 0.75, 0);     // 프레임
    const cov = new THREE.CylinderGeometry(1.22, 1.22, 5, 20, 1, true, Math.PI / 2, Math.PI);
    cov.rotateX(Math.PI / 2);
    grp.add(cov, M.canvas, 0, 2.55, 1.3, 0, 0, 0, 1, 0.85, 1);
    add(2.44, 0.6, 5, M.canvas, 0, 1.95, 1.3);
    for (const wz of [-2.7, 1.0, 2.6]) for (const wx of [-1.12, 1.12]) {
      const w = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 20); w.rotateZ(Math.PI / 2); grp.add(w, M.rubber, wx, 0.55, wz);
      const h = new THREE.CylinderGeometry(0.28, 0.28, 0.42, 12); h.rotateZ(Math.PI / 2); grp.add(h, M.olive, wx, 0.55, wz);
    }
    const g = grp.build(new THREE.Group(), { cast: true, receive: true });
    g.position.set(x, 0, z); g.rotation.y = rot;
    this.group.add(g);
    const c = Math.abs(Math.cos(rot)) > 0.5;
    const hw = c ? 1.3 : 3.8, hd = c ? 3.8 : 1.3;
    this.addCollider(x - hw, 0.3, z - hd, x + hw, 2.2, z + hd, 'metal');
    if (rot === 0) this.addCollider(x - 1.2, 2.2, z - 2.2, x + 1.2, 2.6, z - 0.6, 'metal');
    if (rot === 0) this.addCollider(x - 1.1, 2.2, z - 1.2, x + 1.1, 3.5, z + 3.8, 'wood');
    else this.addCollider(x - 1.2, 2.2, z - 1.1, x + 3.8, 3.5, z + 1.1, 'wood');
  }

  // ── 질의 ──
  raycast(o, d, maxT, { ignoreGlass = false, solid = false } = {}) {
    let best = maxT, hit = null;
    const out = this._ro || (this._ro = { n: new THREE.Vector3() });
    const n = this._rn || (this._rn = new THREE.Vector3());
    for (const c of this.colliders) {
      if (c.disabled || (ignoreGlass && c.glass) || (c.pass && !solid)) continue;
      const t = rayAABB(o, d, c, best, out);
      if (t >= 0 && t < best) { best = t; hit = c; n.copy(out.n); }
    }
    // 지면
    if (d.y < 0 && Math.abs(o.x) < 71 && Math.abs(o.z) < 71) { const t = -o.y / d.y; if (t >= 0 && t < best) { best = t; hit = null; n.set(0, 1, 0); return { t, n: n.clone(), surf: this.groundSurf(o.x + d.x * t, o.z + d.z * t), col: null, point: o.clone().addScaledVector(d, t) }; } }
    // 단지 밖 지형 (높이장 레이마치 + 이분 탐색)
    const ex = o.x + d.x * best, ez = o.z + d.z * best;
    if (Math.abs(o.x) > 70 || Math.abs(o.z) > 70 || Math.abs(ex) > 70 || Math.abs(ez) > 70) {
      const step = 0.6;
      for (let t = 0; t < best; t += step) {
        const t1 = Math.min(best, t + step);
        if (o.y + d.y * t1 - terrainH(o.x + d.x * t1, o.z + d.z * t1) < 0) {
          let a = t, b = t1;
          for (let k = 0; k < 6; k++) { const m = (a + b) / 2; if (o.y + d.y * m - terrainH(o.x + d.x * m, o.z + d.z * m) < 0) b = m; else a = m; }
          const px = o.x + d.x * b, pz = o.z + d.z * b, e = 0.4;
          n.set(terrainH(px - e, pz) - terrainH(px + e, pz), 2 * e, terrainH(px, pz - e) - terrainH(px, pz + e)).normalize();
          return { t: b, n: n.clone(), surf: 'dirt', col: null, point: o.clone().addScaledVector(d, b) };
        }
      }
    }
    if (!hit) return null;
    return { t: best, n: n.clone(), surf: hit.surf, col: hit, point: o.clone().addScaledVector(d, best) };
  }
  groundSurf(x, z) { return Math.abs(x) < 70 && Math.abs(z) < 70 ? 'concrete' : 'dirt'; }

  los(a, b) {
    const d = this._ld || (this._ld = new THREE.Vector3());
    d.subVectors(b, a); const L = d.length(); d.divideScalar(L);
    for (const c of this.colliders) { if (c.disabled || c.glass || c.thin) continue; if (rayAABB(a, d, c, L, null) >= 0) return false; }
    return true;
  }

  // (x,z) 에서 fromY 이하 가장 높은 표면
  floorAt(x, z, fromY, r = 0) {
    let y = 0, surf = this.groundSurf(x, z);
    for (const c of this.colliders) {
      if (c.disabled || c.max.y > fromY + 0.01 || c.max.y <= y) continue;
      if (x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z) { y = c.max.y; surf = c.surf; }
    }
    return { y, surf };
  }

  // 캡슐 근사 AABB 충돌 (feet 위치, 반경 r, 높이 h) — 축 분리 이동
  move(pos, vel, dt, r, h, state, stepH = 0.45) {
    state.grounded = false;
    const hit = { x: false, z: false };
    for (const ax of ['x', 'z']) {
      pos[ax] += vel[ax] * dt;
      for (const c of this.colliders) {
        if (c.disabled) continue;
        if (pos.x + r <= c.min.x || pos.x - r >= c.max.x || pos.z + r <= c.min.z || pos.z - r >= c.max.z) continue;
        if (pos.y + h <= c.min.y || pos.y >= c.max.y) continue;
        // 계단 오르기
        if (state.canStep && c.max.y - pos.y <= stepH && c.max.y - pos.y > 0 && !this.overlaps(pos.x, c.max.y + 0.01, pos.z, r, h, c)) { pos.y = c.max.y; state.stepped = true; continue; }
        if (ax === 'x') pos.x = vel.x > 0 ? c.min.x - r - 1e-4 : c.max.x + r + 1e-4;
        else pos.z = vel.z > 0 ? c.min.z - r - 1e-4 : c.max.z + r + 1e-4;
        hit[ax] = true;
      }
    }
    pos.y += vel.y * dt;
    for (const c of this.colliders) {
      if (c.disabled) continue;
      if (pos.x + r <= c.min.x || pos.x - r >= c.max.x || pos.z + r <= c.min.z || pos.z - r >= c.max.z) continue;
      if (pos.y + h <= c.min.y || pos.y >= c.max.y) continue;
      if (vel.y <= 0 && pos.y > c.max.y - 0.6) { pos.y = c.max.y; vel.y = 0; state.grounded = true; state.surf = c.surf; }
      else if (vel.y > 0) { pos.y = c.min.y - h - 1e-4; vel.y = 0; }
    }
    if (pos.y <= 0) { pos.y = 0; if (vel.y < 0) vel.y = 0; state.grounded = true; state.surf = this.groundSurf(pos.x, pos.z); }
    // 발 밑 확인 (걸어서 내려갈 때 붙기)
    if (!state.grounded && vel.y <= 0) {
      const f = this.floorAt(pos.x, pos.z, pos.y + 0.01, r - 0.05);
      if (pos.y - f.y < 0.02) { state.grounded = true; state.surf = f.surf; }
    }
    return hit;
  }
  overlaps(x, y, z, r, h, skip) {
    for (const c of this.colliders) {
      if (c === skip || c.disabled) continue;
      if (x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z && y + h > c.min.y && y < c.max.y) return true;
    }
    return false;
  }

  // ── 내비게이션 격자 + A* ──
  buildNav() {
    const N = this.navN = 140, O = -70, cs = 1;
    const g = this.nav = new Uint8Array(N * N);
    const inf = 0.35;
    for (const c of this.colliders) {
      if (c.min.y > 1.4 || c.max.y < 0.3) continue;
      const x0 = Math.floor(c.min.x - inf - O), x1 = Math.floor(c.max.x + inf - O), z0 = Math.floor(c.min.z - inf - O), z1 = Math.floor(c.max.z + inf - O);
      for (let z = Math.max(0, z0); z <= Math.min(N - 1, z1); z++) for (let x = Math.max(0, x0); x <= Math.min(N - 1, x1); x++) g[z * N + x] = 1;
    }
    for (let i = 0; i < N; i++) { g[i] = g[(N - 1) * N + i] = g[i * N] = g[i * N + N - 1] = 1; }
  }
  cellOf(x, z) { return [clamp(Math.floor(x + 70), 0, 139), clamp(Math.floor(z + 70), 0, 139)]; }
  free(cx, cz) { return cx >= 0 && cz >= 0 && cx < 140 && cz < 140 && !this.nav[cz * 140 + cx]; }
  nearestFree(cx, cz) {
    if (this.free(cx, cz)) return [cx, cz];
    for (let r = 1; r < 8; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (this.free(cx + dx, cz + dz)) return [cx + dx, cz + dz];
    return [cx, cz];
  }
  gridLOS(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) * 2);
    for (let i = 1; i < n; i++) {
      const x = ax + dx * i / n, z = az + dz * i / n;
      if (!this.free(Math.floor(x), Math.floor(z)) || !this.free(Math.floor(x + 0.3), Math.floor(z + 0.3)) || !this.free(Math.floor(x - 0.3), Math.floor(z - 0.3))) return false;
    }
    return true;
  }
  findPath(from, to) {
    const N = 140;
    const [sx, sz] = this.nearestFree(...this.cellOf(from.x, from.z));
    const [tx, tz] = this.nearestFree(...this.cellOf(to.x, to.z));
    const start = sz * N + sx, goal = tz * N + tx;
    const gS = this._g || (this._g = new Float32Array(N * N)), came = this._c || (this._c = new Int32Array(N * N)), closed = this._cl || (this._cl = new Uint8Array(N * N));
    gS.fill(1e9); came.fill(-1); closed.fill(0);
    const heap = [];
    const push = (i, f) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const h = (i) => { const x = i % N, z = (i / N) | 0; const dx = Math.abs(x - tx), dz = Math.abs(z - tz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    gS[start] = 0; push(start, h(start));
    let iter = 0;
    while (heap.length && iter++ < 12000) {
      const [, cur] = pop();
      if (cur === goal) break;
      if (closed[cur]) continue; closed[cur] = 1;
      const cx = cur % N, cz = (cur / N) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!this.free(nx, nz)) continue;
        if (dx && dz && (!this.free(cx + dx, cz) || !this.free(cx, cz + dz))) continue;
        const ni = nz * N + nx, ng = gS[cur] + (dx && dz ? 1.414 : 1);
        if (ng < gS[ni]) { gS[ni] = ng; came[ni] = cur; push(ni, ng + h(ni)); }
      }
    }
    if (came[goal] < 0 && goal !== start) return null;
    const cells = [];
    for (let i = goal; i >= 0 && i !== start; i = came[i]) cells.push(i);
    cells.reverse();
    // 스트링 풀링
    const pts = [];
    let ax = sx + 0.5, az = sz + 0.5;
    for (let k = 0; k < cells.length; k++) {
      const nxt = k + 1 < cells.length ? cells[k + 1] : -1;
      if (nxt >= 0 && this.gridLOS(ax, az, (nxt % N) + 0.5, ((nxt / N) | 0) + 0.5)) continue;
      const x = (cells[k] % N) + 0.5, z = ((cells[k] / N) | 0) + 0.5;
      pts.push(new THREE.Vector3(x - 70, 0, z - 70)); ax = x; az = z;
    }
    if (pts.length) pts[pts.length - 1].set(to.x, 0, to.z);
    return pts;
  }
}
