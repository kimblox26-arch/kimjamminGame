// 월드 스트리밍: 240m 청크 단위로 지형·도로·건물·나무·차량·전리품 생성 (대한민국 1:1)
import * as THREE from 'three';
import { T, fbm } from './textures.js';
import { MB, hash2, rng, pick, clamp, smooth, lerp } from './util.js';
import { heightRaw, terrainH, gridH, urban, landDist, HIGHWAYS, DMZ, TG } from './korea.js';
import { carGeo, carMaterials, CAR_COLORS, Vehicle } from './vehicle.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOOT_STORE, LOOT_CAR } from './items.js';
import { bakeCorpseGeo } from './human.js';

export const CH = 240, CN = CH / TG;
const XB = [[0, 12, 'M'], [75, 85, 'm'], [155, 165, 'm'], [228, 240, 'M']];
const BLK = [[12, 75], [85, 155], [165, 228]];

function holeShader(mat, U) {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uHole = U;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWpH;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvec4 wpH = vec4(transformed,1.0);\n#ifdef USE_INSTANCING\nwpH = instanceMatrix * wpH;\n#endif\nvWpH = (modelMatrix * wpH).xyz;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWpH; uniform vec4 uHole;')
      .replace('void main() {', 'void main() {\nif (vWpH.x > uHole.x && vWpH.x < uHole.z && vWpH.z > uHole.y && vWpH.z < uHole.w) discard;');
  };
}

export class World {
  constructor(game) {
    this.game = game; this.scene = game.scene; this.col = game.col;
    this.chunks = new Map(); this.queue = []; this.R = 2; this.treeDensity = 1;
    this.hole = { value: new THREE.Vector4(0, 0, 0, 0) };
    this.special = new Map(); // 'cx,cz,i,j' -> fn
    this.mats = this.makeMats();
    this.carG = carGeo(true); this.vanG = carGeo(true, 1);
    this.treeG = this.makeTrees();
    this.corpseG = null;
    this.water = this.makeWater();
    this.far = null; this.farCenter = null; this.farJob = null;
    this.night = 0;
  }
  makeMats() {
    const S = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, o));
    const rep = (t, x, y = x) => { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; };
    const m = {
      terrain: S({ vertexColors: true, map: T.ground.map, normalMap: T.ground.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.97 }),
      roadM: S({ map: T.roadMain.map, normalMap: T.roadMain.normalMap, roughness: 0.82 }),
      roadm: S({ map: T.roadMinor.map, normalMap: T.roadMinor.normalMap, roughness: 0.82 }),
      asphalt: S({ map: T.asphalt.map, normalMap: T.asphalt.normalMap, roughness: 0.85 }),
      cross: S({ map: T.crosswalk.map, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }),
      paver: S({ map: T.paver.map, normalMap: T.paver.normalMap, vertexColors: true, roughness: 0.88 }),
      concrete: S({ map: T.concrete.map, normalMap: T.concrete.normalMap, vertexColors: true, roughness: 0.92 }),
      apt: S({ map: T.facadeApt.map, emissiveMap: T.facadeApt.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.75, vertexColors: true }),
      villa: S({ map: T.facadeVilla.map, roughness: 0.88, vertexColors: true }),
      office: S({ map: T.facadeOffice.map, emissiveMap: T.facadeOffice.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.25, metalness: 0.55, vertexColors: true }),
      store: S({ map: T.storefront.map, roughness: 0.4, metalness: 0.2 }),
      sign: S({ map: T.signs.map, emissiveMap: T.signs.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.5 }),
      aptNum: S({ map: T.aptNum.map, roughness: 0.8 }),
      metal: S({ color: 0x8a8f94, metalness: 0.7, roughness: 0.45, vertexColors: true }),
      lamp: S({ color: 0xffffff, emissive: 0xffe0a8, emissiveIntensity: 0, vertexColors: true }),
      neon: S({ color: 0x400000, emissive: 0xff2020, emissiveIntensity: 2.5 }),
      tile: S({ map: T.tile.map, normalMap: T.tile.normalMap, roughness: 0.25 }),
      wall: S({ map: T.wallpaper.map, normalMap: T.wallpaper.normalMap, vertexColors: true, roughness: 0.9 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false }),
      cooler: S({ color: 0xffffff, emissive: 0xe8f4ff, emissiveIntensity: 0.6, vertexColors: true }),
      tree: S({ vertexColors: true, map: T.leaf.map, roughness: 0.85 }),
      blood: new THREE.MeshStandardMaterial({ color: 0x3a0303, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
      hay: S({ color: 0xf2f2ee, roughness: 0.4 }), vinyl: new THREE.MeshStandardMaterial({ color: 0xe8efe8, roughness: 0.3, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
      corpse: S({ vertexColors: true, roughness: 0.7, normalMap: T.clothNormal })
    };
    m.far = S({ vertexColors: true, roughness: 1 }); holeShader(m.far, this.hole);
    m.farCity = S({ color: 0xbfc2c4, roughness: 0.9, map: T.facadeApt.map, emissiveMap: T.facadeApt.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0 }); holeShader(m.farCity, this.hole);
    return m;
  }
  makeTrees() {
    const mk = (fn) => { const b = new MB(); fn(b); return b.build(); };
    const trunk = (b, h, r, col) => { const g = new THREE.CylinderGeometry(r * 0.6, r, h, 6); g.translate(0, h / 2, 0); b.geo(g, col); };
    const blob = (b, x, y, z, s, col, sy = 1) => {
      for (let c = 0; c < 4; c++) { // 잎 덩어리 여러 개로 풍성하게
        let g = new THREE.IcosahedronGeometry(s * (c ? 0.55 : 0.8), 1); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
        const p = g.attributes.position, ox = c ? Math.cos(c * 2.1) * s * 0.55 : 0, oz = c ? Math.sin(c * 2.1) * s * 0.55 : 0, oy = c ? (c - 2) * s * 0.18 : s * 0.1;
        for (let i = 0; i < p.count; i++) { const X = p.getX(i), Y = p.getY(i), Z = p.getZ(i), k = 1 + (Math.sin(X * 7.1 + Y * 3.3) * Math.cos(Z * 5.7 - Y * 2.9)) * 0.22; p.setXYZ(i, X * k + ox, (Y * k) * sy + oy, Z * k + oz); }
        g.computeVertexNormals(); g.translate(x, y, z); const t = 0.88 + c * 0.05; b.geo(g, [col[0] * t, col[1] * t, col[2] * t]);
      }
    };
    return {
      ginkgo: mk(b => { trunk(b, 5, 0.18, [0.3, 0.24, 0.18]); blob(b, 0, 5.2, 0, 1.9, [0.92, 0.68, 0.1], 1.5); blob(b, -0.3, 6.6, -0.2, 1.1, [0.95, 0.74, 0.16]); }),
      maple: mk(b => { trunk(b, 3.2, 0.16, [0.28, 0.2, 0.15]); blob(b, 0, 4, 0, 2.2, [0.72, 0.16, 0.06], 0.85); }),
      pine: mk(b => { trunk(b, 7, 0.2, [0.32, 0.22, 0.16]); for (let i = 0; i < 4; i++) { const g = new THREE.ConeGeometry(2.2 - i * 0.45, 2.6, 7); g.translate(0, 4 + i * 1.5, 0); b.geo(g, [0.12 + i * 0.01, 0.24, 0.12]); } }),
      oak: mk(b => { trunk(b, 3.5, 0.2, [0.3, 0.24, 0.18]); blob(b, 0, 4.5, 0, 2.5, [0.52, 0.4, 0.17], 0.9); })
    };
  }
  makeWater() {
    const n = T.waterNormal.clone(); n.repeat.set(600, 600); n.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ color: 0x18313a, roughness: 0.06, metalness: 0.1, normalMap: n, normalScale: new THREE.Vector2(0.35, 0.35) });
    const w = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000, 1, 1), mat); w.rotation.x = -Math.PI / 2; w.position.y = -0.35; w.receiveShadow = true;
    this.scene.add(w); this.waterN = n; return w;
  }
  setQuality(q) { this.R = q.chunkR; this.treeDensity = q.trees; this.farN = q.far; this.farCity = q.farCity; }
  key(cx, cz) { return cx + ',' + cz; }
  // 시작 시 동기 생성
  preload(x, z, r = 1) { const cx = Math.floor(x / CH), cz = Math.floor(z / CH); for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (!this.chunks.has(this.key(cx + i, cz + j))) this.gen(cx + i, cz + j); }
  update(dt, pos, t) {
    const cx = Math.floor(pos.x / CH), cz = Math.floor(pos.z / CH), R = this.R;
    // 언로드
    for (const [k, c] of this.chunks) if (Math.abs(c.cx - cx) > R + 1 || Math.abs(c.cz - cz) > R + 1) this.unload(c);
    // 로드 (가까운 순, 프레임당 1개)
    if (!this.queue.length || this._qc !== cx + ',' + cz) {
      this._qc = cx + ',' + cz; this.queue = [];
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) if (!this.chunks.has(this.key(cx + i, cz + j))) this.queue.push([cx + i, cz + j, i * i + j * j]);
      this.queue.sort((a, b) => a[2] - b[2]);
    }
    if (this.queue.length) { const [a, b] = this.queue.shift(); if (!this.chunks.has(this.key(a, b))) this.gen(a, b); }
    // 먼 지형 구멍 = 완전히 로드된 정사각형
    let r = 0; for (let k = 1; k <= R; k++) { let ok = true; for (let i = -k; i <= k && ok; i++) for (let j = -k; j <= k; j++) if (!this.chunks.has(this.key(cx + i, cz + j))) { ok = false; break; } if (ok) r = k; else break; }
    if (this.chunks.has(this.key(cx, cz))) this.hole.value.set((cx - r) * CH + 1, (cz - r) * CH + 1, (cx + r + 1) * CH - 1, (cz + r + 1) * CH - 1); else this.hole.value.set(0, 0, 0, 0);
    this.updateFar(pos);
    // 물
    this.water.position.x = Math.round(pos.x / 40) * 40; this.water.position.z = Math.round(pos.z / 40) * 40;
    this.waterN.offset.set((this.water.position.x / 40) % 1 + t * 0.004, (-this.water.position.z / 40) % 1 + t * 0.0025);
  }
  setNight(n, power) {
    this.night = n; const m = this.mats;
    m.apt.emissiveIntensity = n * 0.9 * power; m.office.emissiveIntensity = n * 0.7 * power; m.sign.emissiveIntensity = n * 0.6 * power;
    m.lamp.emissiveIntensity = n * 2.2 * power; m.farCity.emissiveIntensity = n * 0.5 * power;
  }
  unload(c) {
    this.scene.remove(c.group); c.group.traverse(o => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
    this.col.removeOwner(c.owner); this.game.items.removeOwner(c.owner); this.game.inter.removeOwner(c.owner);
    for (const v of c.vehicles) if (!v.driving) v.dispose(); this.game.vehicles = this.game.vehicles.filter(v => v.driving || !c.vehicles.includes(v));
    this.game.fx.removeOwner(c.owner);
    this.chunks.delete(this.key(c.cx, c.cz));
  }
  gen(cx, cz) {
    const ox = cx * CH, oz = cz * CH, owner = 'c' + cx + ',' + cz;
    const R = rng((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) + 12345);
    const g = new THREE.Group(); g.position.set(ox, 0, oz);
    const c = { cx, cz, ox, oz, owner, group: g, spawns: [], vehicles: [], R, mb: {}, inst: {}, items: [], cars: [], corpses: [] };
    c.B = (k) => c.mb[k] ||= new MB();
    c.tree = (type, x, y, z, s = 1, rot = 0) => (c.inst[type] ||= []).push([x, y, z, s, rot]);
    this.chunks.set(this.key(cx, cz), c);
    this.terrain(c);
    const u = Math.max(urban(ox + 120, oz + 120), urban(ox, oz), urban(ox + CH, oz), urban(ox, oz + CH), urban(ox + CH, oz + CH));
    const land = landDist(ox + 120, oz + 120) > -200;
    c.urban = u >= 0.3 && land;
    if (c.urban) this.city(c); else if (land) this.rural(c);
    this.highways(c); this.dmz(c);
    // 메시 확정
    const shadowless = new Set(['cross', 'blood', 'glass', 'sign', 'aptNum', 'roadM', 'roadm', 'asphalt']);
    for (const k in c.mb) { if (c.mb[k].empty) continue; const m = c.mb[k].mesh(this.mats[k], !shadowless.has(k)); if (k === 'glass' || k === 'blood') m.renderOrder = 2; g.add(m); }
    for (const type in c.inst) {
      const L = c.inst[type], im = new THREE.InstancedMesh(this.treeG[type], this.mats.tree, L.length); im.userData.shared = true;
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
      L.forEach(([x, y, z, s, r], i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r); M.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * (0.85 + (i % 7) * 0.05), s)); im.setMatrixAt(i, M); const k = 0.8 + hash2(i, cx, cz) * 0.4; im.setColorAt(i, col.setRGB(k, k, k)); });
      im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); g.add(im);
    }
    this.buildCars(c); this.buildCorpses(c);
    this.scene.add(g);
    g.updateMatrixWorld(true);
    if (c.items.length) this.game.items.spawn(c.items, owner);
    return c;
  }
  terrain(c) {
    const N = CN, n1 = N + 1, pos = new Float32Array(n1 * n1 * 3), nor = new Float32Array(n1 * n1 * 3), uv = new Float32Array(n1 * n1 * 2), col = new Float32Array(n1 * n1 * 3);
    const gx0 = c.cx * N, gz0 = c.cz * N;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const gx = gx0 + i, gz = gz0 + j, h = gridH(gx, gz), k = j * n1 + i;
      pos[k * 3] = i * TG; pos[k * 3 + 1] = h; pos[k * 3 + 2] = j * TG;
      const nx = gridH(gx - 1, gz) - gridH(gx + 1, gz), nz = gridH(gx, gz - 1) - gridH(gx, gz + 1), ny = 2 * TG, l = Math.hypot(nx, ny, nz);
      nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
      uv[k * 2] = i * TG / 6; uv[k * 2 + 1] = j * TG / 6;
      const cc = this.groundColor(gx * TG, gz * TG, h, 1 - ny / l);
      col[k * 3] = cc[0]; col[k * 3 + 1] = cc[1]; col[k * 3 + 2] = cc[2];
    }
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * n1 + i, b = a + 1, cc = a + n1, d = cc + 1; idx.push(a, cc, b, cc, d, b); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.mats.terrain); m.receiveShadow = true; c.group.add(m);
  }
  groundColor(x, z, h, slope) {
    const n = fbm(x / 90, z / 90, 1e6, 3, 7), u = urban(x, z);
    let r, g, b;
    if (h < -0.5) { r = 0.2; g = 0.2; b = 0.18; }
    else if (h < 1.6) { r = 0.55; g = 0.5; b = 0.4; }
    else if (u > 0.3) { r = 0.33 + n * 0.08; g = 0.31 + n * 0.06; b = 0.26; }
    else {
      const field = fbm(x / 400, z / 400, 1e6, 3, 9);
      if (slope < 0.05 && h < 160 && field > 0.45) { r = 0.58 + n * 0.1; g = 0.48 + n * 0.08; b = 0.28; } // 추수 끝난 논
      else if (slope < 0.12 && h < 250) { r = 0.4 + n * 0.1; g = 0.4 + n * 0.08; b = 0.22; } // 마른 풀
      else { r = 0.27 + n * 0.08; g = 0.23 + n * 0.06; b = 0.13; } // 숲 바닥(낙엽)
      if (slope > 0.45) { r = 0.42; g = 0.4; b = 0.37; } // 암석
      if (h > 1100) { const k = smooth(1100, 1500, h); r = lerp(r, 0.55, k); g = lerp(g, 0.53, k); b = lerp(b, 0.5, k); }
    }
    return [r * r * 1.6, g * g * 1.6, b * b * 1.6];
  }
  // ---------- 도시 ----------
  city(c) {
    const { ox, oz, R } = c, B = c.B;
    const strip = (k, x0, z0, x1, z1, alongZ, u0, u1, vs, lift = 0.07) => { // 도로 띠
      const mb = B(k), len = alongZ ? z1 - z0 : x1 - x0, n = Math.max(1, Math.ceil(len / 8));
      for (let s = 0; s < n; s++) {
        const a = s / n, b = (s + 1) / n;
        const P = (t, w) => { const x = alongZ ? lerp(x0, x1, w) : lerp(x0, x1, t), z = alongZ ? lerp(z0, z1, t) : lerp(z0, z1, w); return [x, terrainH(ox + x, oz + z) + lift, z]; };
        for (const [w0, w1] of [[0, 0.5], [0.5, 1]]) {
          const p00 = P(a, w0), p10 = P(a, w1), p11 = P(b, w1), p01 = P(b, w0), uu0 = lerp(u0, u1, w0), uu1 = lerp(u0, u1, w1), v0 = a * len / vs, v1 = b * len / vs;
          const i0 = mb.vert(...p00, 0, 1, 0, uu0, v0), i1 = mb.vert(...p10, 0, 1, 0, uu1, v0), i2 = mb.vert(...p11, 0, 1, 0, uu1, v1), i3 = mb.vert(...p01, 0, 1, 0, uu0, v1);
          if (alongZ) mb.i.push(i0, i3, i1, i1, i3, i2); else mb.i.push(i0, i1, i3, i1, i2, i3);
        }
      }
    };
    const wet = (x, z) => terrainH(ox + x, oz + z) < 0.6;
    // 도로
    for (const [x0, x1, t] of XB) {
      const k = t === 'M' ? 'roadM' : 'roadm', u0 = x0 === 0 && t === 'M' ? 0.5 : 0, u1 = x1 === 240 ? 0.5 : 1;
      for (let s = 0; s < 3; s++) { const z0 = XB[s][1], z1 = XB[s + 1][0]; if (!wet((x0 + x1) / 2, (z0 + z1) / 2)) strip(k, x0, z0, x1, z1, true, u0, u1, t === 'M' ? 24 : 10); }
    }
    for (const [z0, z1, t] of XB) {
      const k = t === 'M' ? 'roadM' : 'roadm', u0 = z0 === 0 && t === 'M' ? 0.5 : 0, u1 = z1 === 240 ? 0.5 : 1;
      for (let s = 0; s < 3; s++) { const x0 = XB[s][1], x1 = XB[s + 1][0]; if (!wet((x0 + x1) / 2, (z0 + z1) / 2)) strip(k, x0, z0, x1, z1, false, u0, u1, t === 'M' ? 24 : 10); }
    }
    for (const [x0, x1, tx] of XB) for (const [z0, z1, tz] of XB) {
      if (wet((x0 + x1) / 2, (z0 + z1) / 2)) continue;
      strip('asphalt', x0, z0, x1, z1, true, 0, (x1 - x0) / 6, 6, 0.075);
      if (tx === 'M' || tz === 'M') { // 횡단보도
        if (z1 < 240) strip('cross', x0, z1, x1, z1 + 4, true, 0, (x1 - x0) / 8, 1e9, 0.09);
        if (x1 < 240) strip('cross', x1, z0, x1 + 4, z1, false, 0, (z1 - z0) / 8, 1e9, 0.09);
      }
    }
    // 도로 위 차량/스폰/핏자국
    for (const [x0, x1, t] of XB) for (let z = 15; z < 230; z += 18) {
      const xc = (x0 + x1) / 2 + (x0 === 0 ? 6 : x1 === 240 ? -6 : 0), wz = z + R() * 8;
      if (wet(xc, wz)) continue;
      c.spawns.push([ox + xc + (R() - 0.5) * 6, oz + wz]);
      if (R() < (t === 'M' ? 0.3 : 0.18)) this.addCar(c, xc + (R() < 0.5 ? -1 : 1) * (t === 'M' ? 3 : 2.4), wz, R() < 0.7 ? (R() < 0.5 ? 0 : Math.PI) + (R() - 0.5) * 0.3 : R() * 6.28, R);
      if (R() < 0.12) this.blood(c, xc + (R() - 0.5) * 8, wz, 1 + R() * 2);
      if (R() < 0.05) c.corpses.push([xc + (R() - 0.5) * 6, wz, R() * 6.28]);
    }
    for (const [z0, z1, t] of XB) for (let x = 15; x < 230; x += 18) {
      const zc = (z0 + z1) / 2 + (z0 === 0 ? 6 : z1 === 240 ? -6 : 0), wx = x + R() * 8;
      if (wet(wx, zc)) continue;
      c.spawns.push([ox + wx, oz + zc + (R() - 0.5) * 6]);
      if (R() < (t === 'M' ? 0.3 : 0.18)) this.addCar(c, wx, zc + (R() < 0.5 ? -1 : 1) * (t === 'M' ? 3 : 2.4), (R() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (R() - 0.5) * 0.3, R);
      if (R() < 0.1) this.blood(c, wx, zc + (R() - 0.5) * 6, 1 + R() * 2);
    }
    if (R() < 0.35) c.fire = true;
    if (R() < 0.12 || (c.cx === 0 && c.cz === 0)) this.addDrivable(c, R);
    // 블록
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) this.block(c, i, j);
    if (c.fire) { const p = pick(R, c.spawns); if (p) this.game.fx.addFire(new THREE.Vector3(p[0], terrainH(p[0], p[1]), p[1]), c.owner, R() < 0.5); }
  }
  block(c, i, j) {
    const { ox, oz, R, B } = c;
    const x0 = BLK[i][0], x1 = BLK[i][1], z0 = BLK[j][0], z1 = BLK[j][1];
    const hs = [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2]].map(([x, z]) => terrainH(ox + x, oz + z));
    const hmin = Math.min(...hs), hmax = Math.max(...hs);
    if (hmin < 0.7 || hmax - hmin > 9) { this.parkish(c, x0, z0, x1, z1, hmax - hmin > 9); return; }
    const top = hmax + 0.15;
    // 인도 패드(연석)
    B('paver').box(x0, hmin - 1.5, z0, x1, top, z1, { faces: 4, tu: 3, col: [0.95, 0.95, 0.95] });
    B('concrete').box(x0, hmin - 1.5, z0, x1, top, z1, { faces: 1 | 2 | 16 | 32, su: 3, col: [0.75, 0.75, 0.72] });
    this.col.box(ox + x0, hmin - 2, oz + z0, ox + x1, top, oz + z1, c.owner);
    // 가로수 / 가로등 (블록 가장자리)
    for (let x = x0 + 4; x < x1 - 2; x += 11) { c.tree('ginkgo', x, top, z0 + 1.4, 0.8 + R() * 0.3, R() * 6); c.tree('ginkgo', x, top, z1 - 1.4, 0.8 + R() * 0.3, R() * 6); }
    for (let x = x0 + 8; x < x1; x += 30) { this.streetLight(c, x, top, z0 + 0.6, 1); this.streetLight(c, x, top, z1 - 0.6, -1); }
    const ix0 = x0 + 3, ix1 = x1 - 3, iz0 = z0 + 3, iz1 = z1 - 3;
    const sp = this.special.get(`${c.cx},${c.cz},${i},${j}`);
    if (sp) { sp(c, { x0: ix0, x1: ix1, z0: iz0, z1: iz1, top }); return; }
    const u = urban(ox + (x0 + x1) / 2, oz + (z0 + z1) / 2), r = R();
    let type;
    if (u > 0.75) type = r < 0.35 ? 'apt' : r < 0.65 ? 'shops' : r < 0.8 ? 'office' : r < 0.9 ? 'villa' : 'park';
    else if (u > 0.5) type = r < 0.35 ? 'apt' : r < 0.6 ? 'shops' : r < 0.85 ? 'villa' : r < 0.95 ? 'park' : 'parking';
    else type = r < 0.45 ? 'villa' : r < 0.6 ? 'shops' : r < 0.72 ? 'apt' : r < 0.87 ? 'park' : 'house';
    const rect = { x0: ix0, x1: ix1, z0: iz0, z1: iz1, top };
    if (c.cx === 0 && c.cz === 0 && i === 0 && j === 1) type = 'shops';
    this[type](c, rect, u, i, j);
    for (let k = 0; k < 2; k++) c.spawns.push([ox + lerp(x0, x1, R()), oz + (R() < 0.5 ? z0 + 1.5 : z1 - 1.5)]);
  }
  parkish(c, x0, z0, x1, z1, steep) {
    const { ox, oz, R } = c;
    for (let k = 0; k < 14 * this.treeDensity; k++) { const x = lerp(x0, x1, R()), z = lerp(z0, z1, R()), h = terrainH(ox + x, oz + z); if (h > 0.8) c.tree(steep ? (R() < 0.6 ? 'pine' : 'oak') : (R() < 0.5 ? 'maple' : 'ginkgo'), x, h - 0.1, z, 0.8 + R() * 0.5, R() * 6); }
  }
  facade(c, k, x0, y0, z0, x1, y1, z1, su, sv, R) {
    const uo = Math.floor(R() * 4), t = 0.9 + R() * 0.15, col = [t, t, t * 0.98];
    c.B(k).box(x0, y0, z0, x1, y1, z1, { faces: 1 | 2 | 16 | 32, su, sv, uo, col });
    c.B('concrete').box(x0, y1 - 0.01, z0, x1, y1, z1, { faces: 4, su: 4, topCol: R() < 0.5 ? [0.45, 0.62, 0.5] : [0.62, 0.62, 0.6] }); // 옥상(초록 방수페인트)
    this.col.box(c.ox + x0, y0 - 0.5, c.oz + z0, c.ox + x1, y1, c.oz + z1, c.owner);
  }
  apt(c, r, u) {
    const R = c.R, floors = Math.floor(u > 0.7 ? 13 + R() * 12 : 8 + R() * 8), H = floors * 3, len = Math.min(r.x1 - r.x0 - 6, 52), dep = 12;
    const rows = r.z1 - r.z0 > 52 ? 2 : 1;
    for (let k = 0; k < rows; k++) {
      const z0 = r.z0 + 4 + k * (dep + 20), x0 = r.x0 + (r.x1 - r.x0 - len) / 2, x1 = x0 + len, z1 = z0 + dep, y0 = r.top;
      this.facade(c, 'apt', x0, y0, z0, x1, y0 + H, z1, 16, 12, R);
      c.B('concrete').box(x0 - 0.01, y0, z0, x0, y0 + H, z1, { faces: 2, su: 4, col: [0.92, 0.89, 0.82] });
      c.B('concrete').box(x1, y0, z0, x1 + 0.01, y0 + H, z1, { faces: 1, su: 4, col: [0.92, 0.89, 0.82] });
      const n = Math.floor(R() * 16), uu = (n % 4) / 4, vv = 1 - (Math.floor(n / 4) + 1) / 4;
      c.B('aptNum').quad([x1 + 0.03, y0 + H - 7, z1 - 3], [x1 + 0.03, y0 + H - 7, z0 + 3], [x1 + 0.03, y0 + H - 1, z0 + 3], [x1 + 0.03, y0 + H - 1, z1 - 3], [1, 0, 0], [uu, vv, uu + 0.25, vv + 0.25]);
      c.B('concrete').box(x0 + len * 0.4, y0 + H, z0 + 3, x0 + len * 0.6, y0 + H + 3, z1 - 3, { su: 4, col: [0.85, 0.83, 0.78] }); // 옥탑
      c.B('concrete').box(x0 + len / 2 - 2, y0, z1, x0 + len / 2 + 2, y0 + 3, z1 + 2.5, { su: 4, col: [0.5, 0.5, 0.52] }); // 출입구
      this.col.box(c.ox + x0 + len / 2 - 2, y0, c.oz + z1, c.ox + x0 + len / 2 + 2, y0 + 3, c.oz + z1 + 2.5, c.owner);
      for (let x = x0; x < x1 - 4; x += 5.5) if (R() < 0.5) this.addCar(c, x + 2, z1 + 6 + (k ? -3 : 0), Math.PI / 2 * (R() < 0.5 ? 1 : -1) + Math.PI / 2, R);
    }
    for (let k = 0; k < 6 * this.treeDensity; k++) c.tree(R() < 0.5 ? 'maple' : 'ginkgo', lerp(r.x0, r.x1, R()), r.top, lerp(r.z0, r.z1, R()) > (r.z0 + r.z1) / 2 ? r.z1 - 1 : r.z0 + 1, 0.8 + R() * 0.3, R() * 6);
  }
  office(c, r) {
    const R = c.R, w = 24 + R() * 10, d = 22 + R() * 8, f = Math.floor(10 + R() * 22), cxm = (r.x0 + r.x1) / 2, czm = (r.z0 + r.z1) / 2;
    const x0 = cxm - w / 2, z0 = czm - d / 2, H = f * 3.5;
    this.facade(c, 'office', x0, r.top, z0, x0 + w, r.top + H, z0 + d, 16, 14, R);
    c.B('concrete').box(x0 + 4, r.top + H, z0 + 4, x0 + w - 4, r.top + H + 4, z0 + d - 4, { su: 4, col: [0.6, 0.62, 0.64] });
    for (let k = 0; k < 6; k++) this.addCar(c, r.x0 + 4 + k * 5, r.z1 - 4, Math.PI / 2, R);
  }
  villa(c, r) {
    const R = c.R, nx = Math.floor((r.x1 - r.x0) / 16), nz = Math.floor((r.z1 - r.z0) / 15);
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      if (R() < 0.12) continue;
      const w = 11 + R() * 2.5, d = 10 + R() * 2, x0 = r.x0 + a * 16 + (16 - w) / 2, z0 = r.z0 + b * 15 + (15 - d) / 2, f = 3 + Math.floor(R() * 3);
      this.facade(c, 'villa', x0, r.top, z0, x0 + w, r.top + f * 3, z0 + d, 12, 6, R);
      if (R() < 0.1) this.cross(c, x0 + w / 2, r.top + f * 3, z0 + d / 2);
    }
  }
  house(c, r) {
    const R = c.R;
    for (let a = 0; a < 6; a++) {
      const x0 = lerp(r.x0, r.x1 - 12, R()), z0 = lerp(r.z0, r.z1 - 10, R()), w = 9 + R() * 3, d = 8 + R() * 2;
      this.facade(c, 'villa', x0, r.top, z0, x0 + w, r.top + 6, z0 + d, 12, 6, R);
      const rc = pick(R, [[0.2, 0.35, 0.6], [0.6, 0.18, 0.15], [0.25, 0.45, 0.3], [0.7, 0.45, 0.2]]);
      c.B('concrete').box(x0 - 0.5, r.top + 6, z0 - 0.5, x0 + w + 0.5, r.top + 6.4, z0 + d + 0.5, { su: 4, col: rc });
    }
  }
  park(c, r) {
    const R = c.R;
    for (let k = 0; k < 22 * this.treeDensity; k++) c.tree(pick(R, ['maple', 'ginkgo', 'oak', 'pine']), lerp(r.x0, r.x1, R()), r.top, lerp(r.z0, r.z1, R()), 0.8 + R() * 0.5, R() * 6);
    // 야외 운동기구(노란/초록) & 벤치
    for (let k = 0; k < 4; k++) { const x = lerp(r.x0 + 5, r.x1 - 5, R()), z = lerp(r.z0 + 5, r.z1 - 5, R()); c.B('metal').box(x, r.top, z, x + 0.12, r.top + 2, z + 0.12, { col: [0.9, 0.8, 0.1] }); c.B('metal').box(x - 0.6, r.top + 1.9, z, x + 0.7, r.top + 2, z + 0.12, { col: [0.2, 0.6, 0.3] }); }
    for (let k = 0; k < 5; k++) { const x = lerp(r.x0 + 3, r.x1 - 3, R()), z = lerp(r.z0 + 3, r.z1 - 3, R()); c.B('concrete').box(x, r.top + 0.4, z, x + 1.8, r.top + 0.48, z + 0.5, { col: [0.45, 0.3, 0.2] }); }
  }
  parking(c, r) { const R = c.R; for (let x = r.x0 + 3; x < r.x1 - 3; x += 3) for (let z of [r.z0 + 5, r.z0 + 18, r.z1 - 18, r.z1 - 5]) if (R() < 0.65) this.addCar(c, x, z, (z < (r.z0 + r.z1) / 2 ? 0 : Math.PI) + (R() - 0.5) * 0.1, R); }
  // 상가: 북/남쪽 줄, 1층 상점 + 간판, 편의점은 내부 진입 가능
  shops(c, r, u, bi, bj) {
    const R = c.R, forceStore = c.cx === 0 && c.cz === 0 && bi === 0 && bj === 1;
    let storePlaced = !(forceStore || R() < 0.55);
    for (const side of [0, 1]) {
      let x = r.x0 + 1; const d = 14;
      while (x < r.x1 - 9) {
        const w = Math.min(10 + R() * 8, r.x1 - x - 1); if (w < 8) break;
        const z0 = side ? r.z1 - d : r.z0, z1 = z0 + d, front = side ? 16 : 32, y0 = r.top;
        if (!storePlaced && w >= 11 && (side === 0 || !forceStore)) { this.store(c, x, z0, x + 12, z1, y0, side ? 1 : -1); storePlaced = true; x += 13; continue; }
        const f = 2 + Math.floor(R() * (u > 0.7 ? 6 : 3)), H = 3.8 + (f - 1) * 3.2;
        // 1층 상점 정면
        c.B('store').box(x, y0, z0, x + w, y0 + 3.6, z1, { faces: front, su: 16, sv: 3.6, uo: R() * 4 | 0 });
        c.B('concrete').box(x, y0, z0, x + w, y0 + 3.6, z1, { faces: 1 | 2 | (63 & ~front & (16 | 32)), su: 4, col: [0.7, 0.68, 0.64] });
        // 상층
        const kind = R() < 0.5 ? 'office' : 'villa';
        this.facade(c, kind, x, y0 + 3.6, z0, x + w, y0 + H, z1, kind === 'office' ? 16 : 12, kind === 'office' ? 14 : 6, R);
        this.col.box(c.ox + x, y0, c.oz + z0, c.ox + x + w, y0 + 3.6, c.oz + z1, c.owner);
        // 간판
        const sz = side ? z1 + 0.18 : z0 - 0.18, si = Math.floor(R() * 16);
        this.sign(c, x + 0.4, x + w - 0.4, y0 + 3.7, y0 + 4.9, sz, side ? 1 : -1, si);
        for (let k = 0; k < Math.min(f - 1, 3); k++) if (R() < 0.6) { const sx = x + 1 + R() * (w - 6); this.sign(c, sx, sx + 4, y0 + 5.5 + k * 3.2, y0 + 6.4 + k * 3.2, sz, side ? 1 : -1, Math.floor(R() * 16)); }
        if (R() < 0.08) this.cross(c, x + w / 2, y0 + H, (z0 + z1) / 2);
        x += w + 0.3;
      }
    }
    for (let k = 0; k < 5; k++) this.addCar(c, lerp(r.x0 + 4, r.x1 - 4, R()), (r.z0 + r.z1) / 2 + (R() - 0.5) * 8, R() * 6.28, R);
  }
  sign(c, x0, x1, y0, y1, z, dir, si) {
    const u0 = (si % 2) * 0.5, v1 = 1 - Math.floor(si / 2) / 8, v0 = v1 - 1 / 8;
    if (dir > 0) c.B('sign').quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, 1], [u0, v0, u0 + 0.5, v1]);
    else c.B('sign').quad([x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z], [0, 0, -1], [u0, v0, u0 + 0.5, v1]);
    c.B('concrete').box(x0, y0, Math.min(z, z - dir * 0.18), x1, y1, Math.max(z, z - dir * 0.18) - 0.01 * dir, { faces: 4 | 8 | 1 | 2, col: [0.3, 0.3, 0.3] });
  }
  cross(c, x, y, z) { // 교회 붉은 네온 십자가
    c.B('metal').box(x - 0.08, y, z - 0.08, x + 0.08, y + 4, z + 0.08, { col: [0.3, 0.3, 0.3] });
    const n = new MB(); n.box(x - 0.12, y + 4, z - 0.12, x + 0.12, y + 8, z + 0.12); n.box(x - 1.3, y + 6.2, z - 0.12, x + 1.3, y + 6.5, z + 0.12);
    const m = n.mesh(this.mats.neon, false); c.group.add(m);
  }
  // 진입 가능한 편의점 (dir: 정면이 +z(1) 또는 -z(-1))
  store(c, x0, z0, x1, z1, y0, dir) {
    const { B, ox, oz, R } = c, H = 3.6, t = 0.25, fz = dir > 0 ? z1 : z0, bz = dir > 0 ? z0 : z1, sgn = dir;
    const wall = (ax, az, bx, bz2, yA = y0, yB = y0 + H) => {
      const X0 = Math.min(ax, bx), X1 = Math.max(ax, bx), Z0 = Math.min(az, bz2), Z1 = Math.max(az, bz2);
      B('concrete').box(X0, yA, Z0, X1, yB, Z1, { su: 4, col: [0.85, 0.85, 0.82] });
      this.col.box(ox + X0, yA, oz + Z0, ox + X1, yB, oz + Z1, c.owner);
    };
    wall(x0, bz, x1, bz + (dir > 0 ? t : -t)); wall(x0, z0, x0 + t, z1); wall(x1 - t, z0, x1, z1);
    // 정면: 유리 + 문(가운데 2m 개방)
    const dx0 = (x0 + x1) / 2 - 1, dx1 = dx0 + 2, ft = fz - sgn * t;
    wall(x0, ft, x0 + 0.4, fz); wall(x1 - 0.4, ft, x1, fz); wall(x0, ft, x1, fz, y0 + 2.6, y0 + H);
    for (const [a, b] of [[x0 + 0.4, dx0], [dx1, x1 - 0.4]]) {
      B('glass').box(a, y0 + 0.4, Math.min(ft, fz) + 0.1, b, y0 + 2.6, Math.max(ft, fz) - 0.1, { faces: 16 | 32 });
      B('concrete').box(a, y0, Math.min(ft, fz), b, y0 + 0.4, Math.max(ft, fz), { col: [0.4, 0.4, 0.4] });
      this.col.box(ox + a, y0, oz + Math.min(ft, fz), ox + b, y0 + 2.6, oz + Math.max(ft, fz), c.owner);
    }
    // 바닥/천장
    B('tile').box(x0, y0, z0, x1, y0 + 0.02, z1, { faces: 4, tu: 1.6 });
    B('concrete').box(x0, y0 + H, z0, x1, y0 + H + 0.3, z1, { su: 4, col: [0.9, 0.9, 0.9] });
    for (let k = 0; k < 3; k++) B('cooler').box(x0 + 1.5 + k * 3, y0 + H - 0.03, z0 + 2, x0 + 2.7 + k * 3, y0 + H, z1 - 2, { faces: 8, col: [1, 1, 1] });
    // 간판
    this.sign(c, x0 + 0.5, x1 - 0.5, y0 + H - 0.05, y0 + H + 1.1, fz + sgn * 0.2, sgn, 0);
    // 진열대 + 계산대 + 냉장고
    const items = [];
    for (let k = 0; k < 3; k++) {
      const sx0 = x0 + 1.4, sx1 = x1 - 4.2, sz = lerp(z0 + 2.6, z1 - 2.6, k / 2) - 0.35;
      B('metal').box(sx0, y0, sz, sx1, y0 + 1.5, sz + 0.7, { col: [0.85, 0.86, 0.88] });
      this.col.box(ox + sx0, y0, oz + sz, ox + sx1, y0 + 1.5, oz + sz + 0.7, c.owner);
      for (let q = 0; q < 2; q++) if (R() < 0.75) items.push([lerp(sx0 + 0.5, sx1 - 0.5, R()), y0 + 1.5, sz + 0.35]);
    }
    const cz0 = dir > 0 ? z1 - 3.2 : z0 + 2.2;
    B('metal').box(x1 - 3.4, y0, cz0, x1 - 1.2, y0 + 1.05, cz0 + 1, { col: [0.35, 0.3, 0.28] }); this.col.box(ox + x1 - 3.4, y0, oz + cz0, ox + x1 - 1.2, y0 + 1.05, oz + cz0 + 1, c.owner);
    const bz0 = dir > 0 ? z0 + t : z0 + (z1 - z0) - t - 0.8;
    B('cooler').box(x0 + 1, y0, bz0, x1 - 1, y0 + 2.1, bz0 + 0.8, { col: [0.8, 0.85, 0.9] }); this.col.box(ox + x0 + 1, y0, oz + bz0, ox + x1 - 1, y0 + 2.1, oz + bz0 + 0.8, c.owner);
    for (let q = 0; q < 3; q++) if (R() < 0.7) items.push([lerp(x0 + 1.5, x1 - 1.5, R()), y0 + 0.9, dir > 0 ? bz0 + 1.0 : bz0 - 0.2]);
    items.forEach((p, k) => c.items.push({ id: `${c.owner}s${k}`, type: pick(R, LOOT_STORE), x: ox + p[0], y: p[1], z: oz + p[2] }));
    c.spawns.push([ox + (x0 + x1) / 2, oz + (z0 + z1) / 2]);
  }
  streetLight(c, x, y, z, dir) {
    const B = c.B('metal');
    B.box(x - 0.07, y, z - 0.07, x + 0.07, y + 8, z + 0.07, { col: [0.55, 0.57, 0.6] });
    B.box(x - 0.05, y + 7.8, Math.min(z, z - dir * 2.2), x + 0.05, y + 7.9, Math.max(z, z - dir * 2.2), { col: [0.55, 0.57, 0.6] });
    c.B('lamp').box(x - 0.18, y + 7.65, z - dir * 2.2 - 0.3, x + 0.18, y + 7.8, z - dir * 2.2 + 0.3, { col: [1, 1, 1] });
  }
  blood(c, x, z, s) {
    const y = terrainH(c.ox + x, c.oz + z) + 0.1, B = c.B('blood'), R = c.R;
    for (let k = 0; k < 4; k++) { const a = x + (R() - 0.5) * s, b = z + (R() - 0.5) * s, r = s * (0.2 + R() * 0.35); B.quad([a - r, y, b + r], [a + r, y, b + r], [a + r, y, b - r], [a - r, y, b - r], [0, 1, 0]); }
  }
  addCar(c, x, z, yaw, R) {
    const h = terrainH(c.ox + x, c.oz + z); if (h < 0.6) return;
    const van = R() < 0.18, col = R() < 0.06 ? 0x1b1715 : pick(R, CAR_COLORS);
    c.cars.push([x, h, z, yaw, col, van]);
    const cs = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw)), hx = 0.9 * cs + 2.3 * sn, hz = 0.9 * sn + 2.3 * cs;
    this.col.box(c.ox + x - hx * 0.85, h + 0.25, c.oz + z - hz * 0.85, c.ox + x + hx * 0.85, h + (van ? 1.85 : 1.4), c.oz + z + hz * 0.85, c.owner);
    if (R() < 0.12) { // 차량 수색
      const id = `${c.owner}car${c.cars.length}`;
      if (!this.game.taken.has(id)) {
        const it = this.game.inter.add({ pos: new THREE.Vector3(c.ox + x, h + 1, c.oz + z), r: 2.8, label: '차량 수색', hold: 1.6, owner: c.owner,
          act: () => { const t = pick(R, LOOT_CAR); this.game.player.give(t, 1); this.game.taken.add(id); this.game.inter.remove(it); this.game.audio.play('rummage'); } });
      }
    }
  }
  buildCars(c) {
    if (!c.cars.length) return;
    const M = carMaterials();
    for (const van of [false, true]) {
      const L = c.cars.filter(k => k[5] === van); if (!L.length) continue;
      const G = van ? this.vanG : this.carG, body = new THREE.InstancedMesh(G.body, M.paint, L.length), det = new THREE.InstancedMesh(G.detail, M.detail, L.length);
      body.userData.shared = det.userData.shared = true;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
      L.forEach(([x, h, z, yaw, cc], i) => { q.setFromEuler(new THREE.Euler(0, yaw, 0)); m4.compose(new THREE.Vector3(x, h, z), q, new THREE.Vector3(1, 1, 1)); body.setMatrixAt(i, m4); det.setMatrixAt(i, m4); body.setColorAt(i, col.set(cc)); });
      body.castShadow = det.castShadow = true; body.receiveShadow = true; body.computeBoundingSphere(); det.computeBoundingSphere();
      c.group.add(body, det);
    }
  }
  buildCorpses(c) {
    if (!c.corpses.length) return;
    this.corpseG ||= [bakeCorpseGeo(3), bakeCorpseGeo(11)];
    c.corpses.forEach(([x, z, r], i) => {
      const m = new THREE.Mesh(this.corpseG[i % 2], this.mats.corpse); m.userData.shared = true;
      m.position.set(x, terrainH(c.ox + x, c.oz + z) + 0.08, z); m.rotation.y = r; m.castShadow = true; c.group.add(m);
      this.blood(c, x, z, 2.2);
    });
  }
  addDrivable(c, R) {
    let p = null, yaw = 0;
    if (c.cx === 0 && c.cz === 0) { p = [66, 67]; yaw = Math.PI / 2; }
    else { const s = pick(R, c.spawns); if (!s) return; p = [s[0] - c.ox, s[1] - c.oz]; yaw = R() * 6.28; }
    const v = new Vehicle(this.game, c.ox + p[0], c.oz + p[1], yaw, pick(R, CAR_COLORS), c.owner);
    c.vehicles.push(v); this.game.vehicles.push(v);
  }
  // ---------- 시골/산 ----------
  rural(c) {
    const { ox, oz, R } = c, d = this.treeDensity;
    const forest = fbm(ox / 900, oz / 900, 1e6, 3, 21);
    const n = Math.floor(260 * d * (0.4 + forest));
    for (let k = 0; k < n; k++) {
      const x = R() * CH, z = R() * CH, h = terrainH(ox + x, oz + z);
      if (h < 2) continue;
      const hx = terrainH(ox + x + 4, oz + z) - h, hz = terrainH(ox + x, oz + z + 4) - h, slope = Math.hypot(hx, hz) / 4;
      const fl = fbm((ox + x) / 400, (oz + z) / 400, 1e6, 3, 9);
      if (slope < 0.06 && h < 160 && fl > 0.42) continue; // 논밭
      if (slope > 0.9) continue;
      const type = h > 500 ? (R() < 0.8 ? 'pine' : 'oak') : h > 120 ? pick(R, ['pine', 'oak', 'maple', 'pine']) : pick(R, ['oak', 'maple', 'pine', 'ginkgo']);
      c.tree(type, x, h - 0.2, z, 0.75 + R() * 0.6, R() * 6);
    }
    // 논: 곤포 사일리지 / 비닐하우스 / 농가
    const flat = (x, z) => { const h = terrainH(ox + x, oz + z), s = Math.abs(terrainH(ox + x + 8, oz + z) - h) + Math.abs(terrainH(ox + x, oz + z + 8) - h); return s < 0.7 && h > 2 && h < 160 && fbm((ox + x) / 400, (oz + z) / 400, 1e6, 3, 9) > 0.45 ? h : null; };
    const hay = new MB(), vin = new MB();
    for (let k = 0; k < 10; k++) { const x = 20 + R() * 200, z = 20 + R() * 200, h = flat(x, z); if (h === null) continue; const g = new THREE.CylinderGeometry(0.75, 0.75, 1.3, 14); g.rotateZ(Math.PI / 2); g.rotateY(R() * 3); g.translate(x, h + 0.7, z); hay.geo(g); this.col.box(ox + x - 0.8, h, oz + z - 0.8, ox + x + 0.8, h + 1.4, oz + z + 0.8, c.owner); }
    if (R() < 0.35) { const x = 30 + R() * 150, z = 30 + R() * 150, h = flat(x, z); if (h !== null) for (let k = 0; k < 5; k++) { const g = new THREE.CylinderGeometry(2.8, 2.8, 40, 12, 1, true, 0, Math.PI); g.rotateZ(Math.PI / 2); g.rotateY(Math.PI / 2); g.translate(x + k * 7, h, z + 20); vin.geo(g); } }
    if (!hay.empty) { const m = hay.mesh(this.mats.hay); c.group.add(m); }
    if (!vin.empty) c.group.add(vin.mesh(this.mats.vinyl, false));
    if (R() < 0.3) { const x = 40 + R() * 150, z = 40 + R() * 150, h = flat(x, z); if (h !== null) { this.house(c, { x0: x, x1: x + 30, z0: z, z1: z + 30, top: h + 0.1 }); } }
    for (let k = 0; k < 3; k++) { const x = R() * CH, z = R() * CH; if (terrainH(ox + x, oz + z) > 2) c.spawns.push([ox + x, oz + z]); }
  }
  // ---------- 고속도로 ----------
  highways(c) {
    const { ox, oz } = c, X0 = ox - 2, X1 = ox + CH + 2, Z0 = oz - 2, Z1 = oz + CH + 2, mb = c.B('roadM');
    for (const s of HIGHWAYS) {
      // Liang–Barsky 클리핑
      let t0 = 0, t1 = 1; const dx = s.bx - s.ax, dz = s.bz - s.az;
      const clip = (p, q) => { if (p === 0) return q >= 0; const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } return true; };
      if (!(clip(-dx, s.ax - X0) && clip(dx, X1 - s.ax) && clip(-dz, s.az - Z0) && clip(dz, Z1 - s.az))) continue;
      const L = Math.hypot(dx, dz), fx = dx / L, fz = dz / L, px = -fz * 11, pz = fx * 11;
      const n = Math.max(1, Math.ceil((t1 - t0) * L / 6)); let prev = null;
      for (let k = 0; k <= n; k++) {
        const t = t0 + (t1 - t0) * k / n, x = s.ax + dx * t, z = s.az + dz * t;
        const ok = urban(x, z) < 0.45 && terrainH(x, z) > 0.3;
        const lft = [x - px - ox, terrainH(x - px, z - pz) + 0.35, z - pz - oz], rgt = [x + px - ox, terrainH(x + px, z + pz) + 0.35, z + pz - oz], cen = [x - ox, terrainH(x, z) + 0.35, z - oz];
        const v = t * L / 24;
        const cur = ok ? [mb.vert(...lft, 0, 1, 0, 0, v), mb.vert(...cen, 0, 1, 0, 0.5, v), mb.vert(...rgt, 0, 1, 0, 1, v)] : null;
        if (cur && prev) mb.i.push(prev[0], cur[0], prev[1], prev[1], cur[0], cur[1], prev[1], cur[1], prev[2], prev[2], cur[1], cur[2]);
        prev = cur;
        if (ok && k % 9 === 4 && c.R() < (Math.hypot(x, z) < 40000 ? 0.7 : 0.15)) { // 피난 정체 차량
          const off = (c.R() - 0.5) * 16; this.addCar(c, x - ox + (-fz) * off, z - oz + fx * off, Math.atan2(fx, fz) + (c.R() - 0.5) * 0.4, c.R);
        }
      }
    }
  }
  dmz(c) {
    const { ox, oz } = c, X0 = ox, X1 = ox + CH, Z0 = oz, Z1 = oz + CH;
    for (let i = 0; i < DMZ.length - 1; i++) {
      const [ax, az] = DMZ[i], [bx, bz] = DMZ[i + 1];
      if (Math.max(ax, bx) < X0 || Math.min(ax, bx) > X1 || Math.max(az, bz) < Z0 - 2000 || Math.min(az, bz) > Z1 + 2000) continue;
      const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 4);
      for (let k = 0; k < n; k++) {
        const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n; if (x < X0 || x >= X1 || z < Z0 || z >= Z1) continue;
        const h = terrainH(x, z), lx = x - ox, lz = z - oz;
        c.B('metal').box(lx - 0.06, h, lz - 0.06, lx + 0.06, h + 3.2, lz + 0.06, { col: [0.3, 0.32, 0.3] });
        const x2 = ax + (bx - ax) * (k + 1) / n - ox, z2 = az + (bz - az) * (k + 1) / n - oz;
        for (const y of [0.6, 1.4, 2.2, 3.0]) c.B('metal').quad([lx, h + y, lz], [x2, h + y, z2], [x2, h + y + 0.04, z2], [lx, h + y + 0.04, lz], [0, 0, 1], undefined, [0.25, 0.25, 0.25]);
        this.col.box(x - 2.2, h - 1, z - 2.2, x + 2.2, h + 3.2, z + 2.2, c.owner);
      }
    }
  }
  // ---------- 원경 지형 ----------
  updateFar(pos) {
    const step = 1000, cx = Math.round(pos.x / step) * step, cz = Math.round(pos.z / step) * step;
    if (!this.farJob && (!this.farCenter || Math.abs(this.farCenter[0] - cx) > 1500 || Math.abs(this.farCenter[1] - cz) > 1500)) this.farJob = this.buildFar(cx, cz);
    if (this.farJob) { const t0 = performance.now(); while (performance.now() - t0 < 4) { const r = this.farJob.next(); if (r.done) { this.farJob = null; break; } } }
  }
  *buildFar(cx, cz) {
    const N = this.farN || 96, S = 14000, sp = S / N, n1 = N + 1;
    const pos = new Float32Array(n1 * n1 * 3), col = new Float32Array(n1 * n1 * 3), hs = new Float32Array(n1 * n1);
    const city = [];
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = cx - S / 2 + i * sp, z = cz - S / 2 + j * sp, h = heightRaw(x, z), k = j * n1 + i;
        hs[k] = h; pos[k * 3] = x - cx; pos[k * 3 + 1] = h - 1.2; pos[k * 3 + 2] = z - cz;
        const u = urban(x, z), cc = this.groundColor(x, z, h, 0.2);
        const kk = u > 0.3 ? 0.7 : 1; col[k * 3] = cc[0] * kk; col[k * 3 + 1] = cc[1] * kk; col[k * 3 + 2] = cc[2] * kk;
        if (u > 0.4 && h > 1 && i < N && j < N && this.farCity) { const r = hash2(Math.round(x), Math.round(z), 5); for (let q = 0; q < (u > 0.7 ? 2 : 1); q++) city.push([x - cx + (hash2(i, j, q) - 0.5) * sp * 0.8, h, z - cz + (hash2(j, i, q + 9) - 0.5) * sp * 0.8, 14 + r * 30 * u + hash2(i, j, q + 3) * 25 * u]); }
      }
      if (j % 6 === 0) yield;
    }
    const nor = new Float32Array(n1 * n1 * 3);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const k = j * n1 + i, l = hs[j * n1 + Math.max(0, i - 1)], r = hs[j * n1 + Math.min(N, i + 1)], d = hs[Math.max(0, j - 1) * n1 + i], u = hs[Math.min(N, j + 1) * n1 + i];
      const nx = l - r, ny = 2 * sp, nz = d - u, L = Math.hypot(nx, ny, nz); nor[k * 3] = nx / L; nor[k * 3 + 1] = ny / L; nor[k * 3 + 2] = nz / L;
    }
    const idx = []; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1; idx.push(a, c, b, c, d, b); }
    yield;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeBoundingSphere();
    const grp = new THREE.Group(); grp.position.set(cx, 0, cz);
    const m = new THREE.Mesh(g, this.mats.far); m.receiveShadow = false; grp.add(m);
    if (city.length) {
      const bg = new THREE.BoxGeometry(1, 1, 1); bg.translate(0, 0.5, 0);
      const im = new THREE.InstancedMesh(bg, this.mats.farCity, city.length), M = new THREE.Matrix4();
      city.forEach(([x, h, z, H], i) => { M.makeScale(12 + (i % 5) * 6, H, 12 + (i % 3) * 5); M.setPosition(x, h - 2, z); im.setMatrixAt(i, M); });
      im.computeBoundingSphere(); grp.add(im);
    }
    if (this.far) { this.scene.remove(this.far); this.far.traverse(o => o.geometry && o.geometry.dispose()); }
    this.far = grp; this.scene.add(grp); this.farCenter = [cx, cz];
  }
  spawnPointsNear(x, z, rMin, rMax) {
    const out = [];
    for (const c of this.chunks.values()) for (const s of c.spawns) { const d = Math.hypot(s[0] - x, s[1] - z); if (d > rMin && d < rMax) out.push(s); }
    return out;
  }
  urbanAt(x, z) { const c = this.chunks.get(this.key(Math.floor(x / CH), Math.floor(z / CH))); return c ? (c.urban ? urban(x, z) : 0.05) : urban(x, z); }
}
