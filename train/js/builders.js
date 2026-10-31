// 타일 내용 만들기: 지형, 건물, 나무, 선로·구조물, 역, 랜드마크
import * as THREE from 'three';
import { smooth, clamp, lerp, hash, rng, noise, toXZ } from './geo.js';
import { ST } from './network.js';
import { LANDMARKS } from './data/places.js';

const TILE = 2000;
const lin = h => new THREE.Color(h);
const GLSL_NOISE = `
  float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
  float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+1.),f.x), f.y); }`;

// ───────── 재질 ─────────
export function makeMaterials(U) {
  const M = {};
  const terrain = far => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    m.onBeforeCompile = s => {
      Object.assign(s.uniforms, { uOrigin: U.uOrigin, uHole: U.uHole });
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 cover; varying vec3 vCover; varying vec3 vWP;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCover = cover; vWP = (modelMatrix * vec4(transformed,1.)).xyz;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec2 uOrigin; uniform vec3 uHole; varying vec3 vCover; varying vec3 vWP;' + GLSL_NOISE)
        .replace('#include <color_fragment>', `#include <color_fragment>
          ${far ? 'if (uHole.z > 0. && abs(vWP.x - uHole.x) < uHole.z && abs(vWP.z - uHole.y) < uHole.z) discard;' : ''}
          vec2 P = vWP.xz + uOrigin; float dist = length(vWP - cameraPosition);
          float fade = 1. - smoothstep(1200., 7000., dist);
          float n1 = vnoise(P*.045), n2 = vnoise(P*.37), n3 = vnoise(P*2.3);
          diffuseColor.rgb *= .86 + .2*n1 + .08*n2*fade + .05*n3*(1.-smoothstep(50.,300.,dist));
          if (vCover.x > .01) {
            vec2 b = mod(P, 80.); vec2 bid = floor(P/80.);
            float road = 1. - step(11., b.x) * step(11., b.y);
            float walk = (1. - step(13.5, b.x)*step(13.5, b.y)) - road;
            vec3 blk = vec3(.16 + .1*h21(bid)) * vec3(1., .98, .95);
            if (h21(bid+7.) > .82) blk = vec3(.07,.12,.05) * (.8+.4*n2);
            vec3 asph = vec3(.035) * (.85+.3*n3);
            float lane = step(5.2, b.x)*step(b.x, 5.8)*step(11., b.y) + step(5.2, b.y)*step(b.y, 5.8)*step(11., b.x);
            asph = mix(asph, vec3(.5,.45,.2), lane*.6*(1.-step(.5, mod(P.x+P.y, 6.)/6.)));
            vec3 urb = mix(blk, asph, road); urb = mix(urb, vec3(.22,.2,.19), walk);
            diffuseColor.rgb = mix(diffuseColor.rgb, urb, vCover.x * fade);
          }
          if (vCover.y > .01) {
            vec2 c = floor(P/vec2(50.,40.)); float r = h21(c);
            vec3 fc = r < .38 ? vec3(.31,.25,.09) : r < .62 ? vec3(.24,.22,.08) : r < .82 ? vec3(.13,.19,.05) : vec3(.2,.13,.07);
            vec2 f = fract(P/vec2(50.,40.));
            float lev = 1. - smoothstep(.0, .035, min(min(f.x,1.-f.x), min(f.y,1.-f.y)));
            fc = mix(fc*(.85+.3*n2), vec3(.2,.21,.11), lev*.7);
            diffuseColor.rgb = mix(diffuseColor.rgb, fc, vCover.y * fade * .85);
          }
          if (vCover.z > .01) { float cn = vnoise(P*.16)*.6 + vnoise(P*.55)*.4; diffuseColor.rgb *= mix(1., .62 + .6*cn, vCover.z * (1.-smoothstep(3000.,9000.,dist))); }`);
    };
    m.customProgramCacheKey = () => far ? 'terrain-far' : 'terrain';
    return m;
  };
  M.terrain = terrain(false); M.terrainFar = terrain(true);

  // 건물: 인스턴스 크기(scale)로 창문 격자를 그린다
  M.building = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
  M.building.onBeforeCompile = s => {
    s.uniforms.uNight = U.uNight;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aStyle; varying vec4 vSty; varying vec3 vLoc; varying vec3 vNL; varying vec3 vDim;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSty = aStyle; vNL = normal;
        vDim = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vLoc = position * vDim;`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight; varying vec4 vSty; varying vec3 vLoc; varying vec3 vNL; varying vec3 vDim;' + GLSL_NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float typ = vSty.x, pal = vSty.y, seed = vSty.z;
        float side = step(.5, abs(vNL.x));
        float F = mix(vLoc.x, vLoc.z, side) + 200.;
        float V = vLoc.y;
        float roof = step(.5, vNL.y);
        float fh = typ > .5 && typ < 1.5 ? 3.9 : 2.85;
        float wx = typ < .5 ? 3.1 : typ < 1.5 ? 1.7 : typ < 2.5 ? 3.4 : 4.2;
        float fl = floor(V/fh), fv = fract(V/fh), cu = floor(F/wx), fu = fract(F/wx);
        float win = 0.;
        vec3 wall;
        if (typ < .5) { // 아파트
          wall = mix(vec3(.78,.76,.7), vec3(.7,.66,.58), pal);
          win = step(.3, fv)*step(fv,.9)*step(.07,fu)*step(fu,.93)*(1.-side);
          float rail = step(.05, fv)*step(fv,.3)*(1.-side);
          wall = mix(wall, wall*.82, rail);
          vec3 band = pal < .25 ? vec3(.05,.3,.15) : pal < .5 ? vec3(.06,.18,.45) : pal < .75 ? vec3(.5,.12,.08) : vec3(.55,.3,.05);
          wall = mix(wall, band, side * step(vDim.y - 9., V) * step(.35, fract(F/7.)));
          wall = mix(wall, band*.9, (1.-side) * step(vDim.y - 1.4, V));
        } else if (typ < 1.5) { // 업무용 유리 빌딩
          wall = mix(vec3(.16,.2,.24), vec3(.3,.33,.36), pal);
          win = 1. - max(step(fu,.07), step(fv,.12));
        } else if (typ < 2.5) { // 빌라·상가
          wall = pal < .33 ? vec3(.42,.2,.13) : pal < .66 ? vec3(.68,.6,.48) : vec3(.55,.55,.53);
          win = step(.35, fv)*step(fv,.8)*step(.22,fu)*step(fu,.78);
          if (fl < .5 && pal > .4) win = step(.12, fv)*step(fv,.85)*step(.05,fu)*step(fu,.95);
        } else { // 주택
          wall = pal < .5 ? vec3(.75,.72,.65) : vec3(.6,.5,.38);
          win = step(.38, fv)*step(fv,.75)*step(.3,fu)*step(fu,.6);
        }
        if (roof > .5) { wall = vec3(.33,.33,.32) * (.85 + .3*vnoise(vLoc.xz*.3)); win = 0.; }
        if (vNL.y < -.5) win = 0.;
        float litP = typ < .5 ? .3 : typ < 1.5 ? .42 : .28;
        float lit = step(h21(vec2(cu + seed*31., fl + seed*17.)), litP) * win;
        // 멀리서는 창문 무늬 대신 평균값 (지글거림 방지)
        float aa = clamp(max(fwidth(F/wx), fwidth(V/fh)) * 3. - .3, 0., 1.);
        float avgW = typ < .5 ? .5 : typ < 1.5 ? .78 : typ < 2.5 ? .25 : .12;
        if (roof < .5 && vNL.y > -.5) { win = mix(win, avgW, aa); lit = mix(lit, avgW * litP, aa); }
        vec3 glass = typ < 1.5 && typ > .5 ? vec3(.06,.1,.14) : vec3(.05,.07,.09);
        diffuseColor.rgb = mix(wall * (.92 + .16*h21(vec2(seed, fl))), glass, win);
        float gWin = win * (typ > .5 && typ < 1.5 ? 1. : .6);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .08, gWin);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, .7, gWin);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 lc = h21(vec2(cu*1.3, fl+seed)) > .4 ? vec3(1.,.78,.5) : vec3(.85,.92,1.);
        totalEmissiveRadiance += lc * lit * uNight * 1.6;`);
  };
  const std = (o) => new THREE.MeshStandardMaterial(o);
  M.roof = std({ roughness: 0.7 });
  M.greenhouse = std({ color: 0xe8ecec, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.88 });
  M.tree = std({ vertexColors: true, roughness: 0.92 });
  const gravel = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#6d6860'; g.fillRect(0, 0, w, h); for (let i = 0; i < 1800; i++) { const v = 70 + Math.random() * 90 | 0; g.fillStyle = `rgb(${v},${v - 4},${v - 10})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 2 + Math.random() * 3); } });
  gravel.wrapS = gravel.wrapT = THREE.RepeatWrapping;
  M.ballast = std({ map: gravel, roughness: 1, side: THREE.DoubleSide });
  M.rail = std({ color: 0x9a9a98, metalness: 0.9, roughness: 0.32, side: THREE.DoubleSide });
  M.sleeper = std({ color: 0x8f8b84, roughness: 0.9 });
  M.concrete = std({ color: 0xa9a59c, roughness: 0.88, side: THREE.DoubleSide });
  M.tunnel = std({ color: 0x77736b, roughness: 0.95, side: THREE.DoubleSide, emissive: 0x2a2824, emissiveIntensity: 1 });
  M.subway = std({ color: 0xb9b6ad, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x302e2a, emissiveIntensity: 1 });
  M.stationWall = std({ color: 0xe4e1d8, roughness: 0.6, side: THREE.DoubleSide, emissive: 0x6a6862, emissiveIntensity: 1 });
  M.platform = std({ color: 0x9c978e, roughness: 0.85, side: THREE.DoubleSide });
  M.platformU = std({ color: 0xb4ada0, roughness: 0.55, side: THREE.DoubleSide, emissive: 0x3a3833, emissiveIntensity: 1 });
  M.yellow = std({ color: 0xe0b81a, roughness: 0.6, side: THREE.DoubleSide });
  M.metal = std({ color: 0x70767c, metalness: 0.6, roughness: 0.45 });
  M.roofMetal = std({ color: 0x8d949a, metalness: 0.5, roughness: 0.5, side: THREE.DoubleSide });
  M.lamp = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
  M.glass = std({ color: 0x9fc3d0, metalness: 0.3, roughness: 0.05, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  M.wire = new THREE.LineBasicMaterial({ color: 0x1c1c1c });
  M.water = std({ color: 0x0a2830, roughness: 0.1, metalness: 0.05, normalMap: waterNormal(), normalScale: new THREE.Vector2(0.22, 0.22), envMapIntensity: 0.85 });
  M.water.normalMap.repeat.set(400000 / 90, 400000 / 90);
  M.lineColor = {};
  M.line = c => M.lineColor[c] || (M.lineColor[c] = std({ color: c, roughness: 0.5, side: THREE.DoubleSide, emissive: c, emissiveIntensity: 0.25 }));
  return M;
}

export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const WAVES = [[3, 1, 0.3], [-2, 3, 1.1], [5, -2, 2.0], [-4, -5, 0.7], [7, 3, 2.6], [-6, 8, 1.9], [11, -4, 0.4], [-9, -10, 3.0], [14, 9, 1.4], [-17, 6, 2.2]];
function waterNormal() {
  const N = 256, hgt = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0; for (const [kx, ky, ph] of WAVES) v += Math.sin((x * kx + y * ky) * 2 * Math.PI / N + ph) / Math.hypot(kx, ky);
    hgt[y * N + x] = v;
  }
  const t = canvasTex(N, N, (g) => {
    const img = g.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = hgt[y * N + (x + 1) % N] - hgt[y * N + (x + N - 1) % N], dy = hgt[((y + 1) % N) * N + x] - hgt[((y + N - 1) % N) * N + x];
      const nx = -dx * 1.6, ny = -dy * 1.6, nz = 1, l = Math.hypot(nx, ny, nz), o = (y * N + x) * 4;
      img.data[o] = (nx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[o + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// ───────── 지표 색 ─────────
const PAL = {
  farm: lin('#9a8c55'), farm2: lin('#7d8a4c'), forest: lin('#34502c'), autumn: lin('#7c5a2b'), autumn2: lin('#8a3d22'),
  urban: lin('#8b8a86'), rock: lin('#77716a'), sand: lin('#cdbd94'), grass: lin('#6b8a46'), seabed: lin('#4c5a50'), mud: lin('#6e6656'),
};
const _c = new THREE.Color();
export function groundColor(T, x, z, h, ny, col, cov, o) {
  const city = T.cityAt(x, z), slope = 1 - ny, land = T.landAt(x, z), river = T.riverAt(x, z);
  let urban = smooth(0.18, 0.5, city) * (1 - smooth(0.2, 0.45, slope)) * smooth(2, 6, h);
  let forest = Math.max(smooth(0.05, 0.16, slope), smooth(60, 200, h)) * (1 - urban);
  const farm = (1 - forest) * (1 - urban);
  const n = noise(x / 1400, z / 1400), n2 = noise(x / 380 + 9, z / 380);
  _c.copy(PAL.farm).lerp(PAL.farm2, clamp(0.5 + n, 0, 1)).multiplyScalar(farm);
  const fc = PAL.forest.clone().lerp(PAL.autumn, clamp(0.35 + n2 * 0.8, 0, 0.8)).lerp(PAL.autumn2, clamp(n * 0.7 - 0.1, 0, 0.35));
  _c.add(fc.multiplyScalar(forest)).add(PAL.urban.clone().multiplyScalar(urban));
  _c.lerp(PAL.rock, smooth(0.45, 0.75, slope));
  if (h < 5 && land < 0.995 && land > 0) _c.lerp(PAL.sand, smooth(5, 1.5, h) * (1 - urban) * 0.9);
  const val = T.sampleGrid(T.valley, x, z);
  if (val > 0.15 && river < 0.5) _c.lerp(PAL.grass, smooth(0.15, 0.5, val) * 0.55 * (1 - smooth(4, 12, h)));
  if (h < 0.5) _c.copy(PAL.seabed).lerp(PAL.mud, clamp(0.5 + n, 0, 1));
  col[o] = _c.r; col[o + 1] = _c.g; col[o + 2] = _c.b;
  cov[o] = urban; cov[o + 1] = farm * (1 - smooth(0.06, 0.12, slope)) * (h > 2 ? 1 : 0); cov[o + 2] = forest;
}

// ───────── 지형 타일 ─────────
export function* terrainTile(W, tx, tz, seg, lod) {
  const T = W.terrain, x0 = tx * TILE, z0 = tz * TILE, step = TILE / seg, n = seg + 1, m = seg + 3;
  const H = new Float32Array(m * m), hf = lod === 2 ? (x, z) => T.natural(x, z) : (x, z) => T.height(x, z);
  for (let j = 0; j < m; j++) { for (let i = 0; i < m; i++) H[j * m + i] = hf(x0 + (i - 1) * step, z0 + (j - 1) * step); if (j % 6 === 5) yield; }
  const vc = n * n + 4 * n;
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), col = new Float32Array(vc * 3), cov = new Float32Array(vc * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i, h = H[(j + 1) * m + i + 1];
      const dx = H[(j + 1) * m + i] - H[(j + 1) * m + i + 2], dz = H[j * m + i + 1] - H[(j + 2) * m + i + 1];
      const l = Math.hypot(dx, 2 * step, dz);
      pos[k * 3] = i * step; pos[k * 3 + 1] = h; pos[k * 3 + 2] = j * step;
      nor[k * 3] = dx / l; nor[k * 3 + 1] = 2 * step / l; nor[k * 3 + 2] = dz / l;
      groundColor(T, x0 + i * step, z0 + j * step, h, 2 * step / l, col, cov, k * 3);
    }
    if (j % 10 === 9) yield;
  }
  const idx = [];
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
  // 치마(틈 가리기)
  const edges = [[...Array(n).keys()].map(i => i), [...Array(n).keys()].map(i => (n - 1) * n + i), [...Array(n).keys()].map(j => j * n), [...Array(n).keys()].map(j => j * n + n - 1)];
  let v = n * n;
  for (const e of edges) {
    const s0 = v;
    for (const k of e) { for (let c = 0; c < 3; c++) { pos[v * 3 + c] = pos[k * 3 + c]; nor[v * 3 + c] = nor[k * 3 + c]; col[v * 3 + c] = col[k * 3 + c]; } pos[v * 3 + 1] -= 40; v++; }
    for (let q = 0; q < n - 1; q++) { const a = e[q], b = e[q + 1], c = s0 + q, d = c + 1; idx.push(a, b, c, b, d, c, a, c, b, b, c, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('cover', new THREE.BufferAttribute(cov, 3));
  g.setIndex(idx); g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, W.mats.terrain); mesh.userData.cast = false;
  return mesh;
}

// ───────── 역 공간 색인 ─────────
function stationGrid(net) {
  if (net._sg) return net._sg;
  const g = net._sg = new Map();
  for (const { line, st } of net.stationList) { const k = Math.floor(st.x / 1000) + ',' + Math.floor(st.z / 1000); (g.get(k) || g.set(k, []).get(k)).push(st); }
  return g;
}
function nearestStation(net, x, z) {
  const g = stationGrid(net), gx = Math.floor(x / 1000), gz = Math.floor(z / 1000); let bd = 1e9;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const s of g.get((gx + a) + ',' + (gz + b)) || []) bd = Math.min(bd, Math.hypot(s.x - x, s.z - z));
  return bd;
}

// ───────── 건물 ─────────
let boxGeo, prismGeo, ghGeo;
function geos() {
  if (boxGeo) return;
  boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);
  prismGeo = new THREE.BufferGeometry();
  const p = [-.5, 0, -.5, .5, 0, -.5, .5, 1, 0, -.5, 1, 0, -.5, 0, .5, .5, 0, .5, .5, 1, 0, -.5, 1, 0];
  prismGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  prismGeo.setIndex([0, 3, 1, 1, 3, 2, 4, 5, 7, 5, 6, 7, 0, 4, 3, 4, 7, 3, 1, 2, 5, 5, 2, 6]);
  prismGeo = prismGeo.toNonIndexed(); prismGeo.computeVertexNormals();
  ghGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, true, -Math.PI / 2, Math.PI); ghGeo.rotateZ(Math.PI / 2); ghGeo.scale(1, 2, 1);
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _up = new THREE.Vector3(0, 1, 0);

export function* buildings(W, tx, tz, lod) {
  geos();
  const T = W.terrain, net = W.net, x0 = tx * TILE, z0 = tz * TILE, q = W.q.bld;
  const B = [], R = [], G = [];
  const BS = 80;
  const cityMax = Math.max(T.cityAt(x0, z0), T.cityAt(x0 + TILE, z0), T.cityAt(x0, z0 + TILE), T.cityAt(x0 + TILE, z0 + TILE), T.cityAt(x0 + 1000, z0 + 1000));
  const land = T.landAt(x0 + 1000, z0 + 1000) + T.landAt(x0, z0) + T.landAt(x0 + TILE, z0 + TILE);
  if (land <= 0 || (lod === 2 && cityMax < 0.4)) return null;
  let cnt = 0;
  for (let bj = 0; bj < TILE / BS; bj++) {
    for (let bi = 0; bi < TILE / BS; bi++) {
      const bx = x0 + bi * BS + BS / 2, bz = z0 + bj * BS + BS / 2;
      const r = rng((Math.floor(bx / BS) * 7349 + Math.floor(bz / BS) * 92821) ^ 0x5bd1e995);
      const c = cityMax > 0.05 ? T.cityAt(bx, bz) : 0, roll = r();
      if (c < 0.06 && roll > 0.09) continue;
      if (T.landAt(bx, bz) < 0.97 || T.riverAt(bx, bz) > 0.02) continue;
      const hs = [T.height(bx - 30, bz - 30), T.height(bx + 30, bz - 30), T.height(bx - 30, bz + 30), T.height(bx + 30, bz + 30)];
      const hmin = Math.min(...hs), hmax = Math.max(...hs);
      if (hmax - hmin > 9 || hmin < 1.5) continue;
      const nt = net.nearestTrack(bx, bz, 60, false); if (nt && nt.d < 48) continue;
      const add = (x, z, w, d, h, typ, yaw = 0) => { if (lod === 2 && h < 45) return; if (lod === 1 && h < 14 && typ > 1) return; B.push(x - x0, hmin - 0.5, z - z0, w, h, d, yaw, typ, r(), r()); };
      if (c >= 0.06) {
        if (r() > q * (0.45 + c * 0.6)) continue;
        const hsc = T.cityHeightAt(bx, bz) || 0.7;
        const ds = nearestStation(net, bx, bz), com = c * (1 - smooth(250, 1100, ds));
        if (com > 0.42 && roll < 0.8) {
          const k = 1 + (r() * 2.4 | 0);
          for (let i = 0; i < k; i++) {
            const w = 22 + r() * 24, d = 18 + r() * 20, h = (24 + r() * r() * 170) * hsc * (0.55 + com * 0.7);
            add(bx + (r() - 0.5) * (BS - w - 16), bz + (r() - 0.5) * (BS - d - 16), w, d, Math.max(14, h), r() < 0.75 ? 1 : 2);
          }
        } else if (c > 0.32 && roll < 0.58) {
          const k = 2 + (r() * 1.6 | 0), len = 38 + r() * 26, fl = 12 + (r() * 14 | 0), sp = (BS - 12) / k;
          const yaw = (r() - 0.5) * 0.25;
          for (let i = 0; i < k; i++) add(bx + (r() - 0.5) * (BS - len - 14), bz - BS / 2 + 6 + sp * (i + 0.5), len, 12.5, fl * 2.85 * Math.min(1.25, 0.6 + hsc * 0.5), 0, yaw);
        } else if (c > 0.22) {
          const k = 3 + (r() * 6 | 0);
          for (let i = 0; i < k; i++) { const w = 11 + r() * 8, d = 11 + r() * 8; add(bx + (r() - 0.5) * (BS - w - 14), bz + (r() - 0.5) * (BS - d - 14), w, d, 2.85 * (3 + (r() * 4 | 0)), 2); }
        } else {
          const k = 1 + (r() * 4 | 0);
          for (let i = 0; i < k; i++) {
            const w = 9 + r() * 6, d = 8 + r() * 5, h = r() < 0.75 ? 3.2 : 6.2, x = bx + (r() - 0.5) * (BS - w - 16), z = bz + (r() - 0.5) * (BS - d - 16);
            add(x, z, w, d, h, 3);
            if (lod < 2) R.push(x - x0, hmin - 0.5 + h, z - z0, w + 0.8, 2.2, d + 0.8, 0, r());
          }
        }
      } else if (lod < 2) {
        // 농촌: 농가와 비닐하우스
        if (roll < 0.04) {
          const k = 1 + (r() * 3 | 0);
          for (let i = 0; i < k; i++) {
            const w = 9 + r() * 5, d = 7 + r() * 4, x = bx + (r() - 0.5) * 50, z = bz + (r() - 0.5) * 50;
            B.push(x - x0, hmin - 0.5, z - z0, w, 3.3, d, 0, 3, r(), r()); R.push(x - x0, hmin + 2.8, z - z0, w + 1, 2.3, d + 1, 0, r());
          }
        } else if (hmax - hmin < 2.5 && T.cityAt(bx, bz) < 0.05) {
          const k = 4 + (r() * 6 | 0);
          for (let i = 0; i < k; i++) G.push(bx - x0 - 30 + 0.5, hmin - 0.2, bz - z0 - BS / 2 + 6 + i * 8.5, 62, 3.2, 7);
        }
      }
      if (++cnt % 40 === 0) yield;
    }
  }
  const grp = new THREE.Group();
  if (B.length) grp.add(instBuildings(W, B));
  if (R.length) {
    const n = R.length / 8, im = new THREE.InstancedMesh(prismGeo, W.mats.roof, n);
    const roofCols = ['#3c5f8a', '#8a3a2e', '#3f6b4a', '#6b6b6b', '#2f4a6b', '#9a5530'].map(lin);
    for (let i = 0; i < n; i++) { const o = i * 8; _p.set(R[o], R[o + 1], R[o + 2]); _q.identity(); _s.set(R[o + 3], R[o + 4], R[o + 5]); im.setMatrixAt(i, _m.compose(_p, _q, _s)); im.setColorAt(i, roofCols[R[o + 7] * roofCols.length | 0]); }
    grp.add(im);
  }
  if (G.length) {
    const n = G.length / 6, im = new THREE.InstancedMesh(ghGeo, W.mats.greenhouse, n);
    for (let i = 0; i < n; i++) { const o = i * 6; _p.set(G[o], G[o + 1], G[o + 2]); _q.identity(); _s.set(G[o + 3], G[o + 4] / 2, G[o + 5]); im.setMatrixAt(i, _m.compose(_p, _q, _s)); }
    im.userData.cast = false; grp.add(im);
  }
  return grp.children.length ? grp : null;
}

// B: [x,y,z,w,h,d,yaw,type,pal,seed] 묶음
export function instBuildings(W, B) {
  geos();
  const n = B.length / 10, im = new THREE.InstancedMesh(boxGeo, W.mats.building, n), sty = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 10; _p.set(B[o], B[o + 1], B[o + 2]); _q.setFromAxisAngle(_up, B[o + 6]); _s.set(B[o + 3], B[o + 4], B[o + 5]);
    im.setMatrixAt(i, _m.compose(_p, _q, _s)); sty.set([B[o + 7], B[o + 8], B[o + 9] * 10, 0], i * 4);
  }
  im.geometry = boxGeo.clone(); im.geometry.setAttribute('aStyle', new THREE.InstancedBufferAttribute(sty, 4));
  im.computeBoundingSphere();
  return im;
}

// ───────── 나무 ─────────
let pineGeo, leafGeo;
function treeGeos() {
  if (pineGeo) return;
  const paint = (g, c) => { const a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const trunk = () => paint(new THREE.CylinderGeometry(0.06, 0.1, 0.35, 5).translate(0, 0.175, 0), lin('#3b2a1c'));
  const merge = (a, b) => { const g = new THREE.BufferGeometry(), A = a.index ? a.toNonIndexed() : a, Bg = b.index ? b.toNonIndexed() : b;
    for (const k of ['position', 'normal', 'color']) { const x = A.attributes[k].array, y = Bg.attributes[k].array, z = new Float32Array(x.length + y.length); z.set(x); z.set(y, x.length); g.setAttribute(k, new THREE.BufferAttribute(z, 3)); } return g; };
  pineGeo = merge(trunk(), paint(new THREE.ConeGeometry(0.32, 0.8, 7).translate(0, 0.6, 0), lin('#ffffff')));
  const ico = new THREE.IcosahedronGeometry(0.36, 1); ico.scale(1, 0.85, 1); ico.translate(0, 0.62, 0);
  const p = ico.attributes.position; for (let i = 0; i < p.count; i++) { const k = 0.85 + 0.3 * hash(i * 7, 3); p.setXYZ(i, p.getX(i) * k, 0.62 + (p.getY(i) - 0.62) * k, p.getZ(i) * k); }
  ico.computeVertexNormals();
  leafGeo = merge(trunk(), paint(ico, lin('#ffffff')));
}
const TREE_COL = { pine: ['#1f3a22', '#284a2a', '#2c4227'].map(lin), leaf: ['#4a6a2c', '#8a7a2a', '#a3521f', '#b8862a', '#6d4a1e', '#3f5f2a', '#9c3a1a'].map(lin) };

export function* trees(W, tx, tz) {
  treeGeos();
  const T = W.terrain, net = W.net, x0 = tx * TILE, z0 = tz * TILE;
  const N = Math.round(5200 * W.q.trees); if (!N) return null;
  const r = rng(tx * 9176 + tz * 3331 + 17);
  const P = [], L = [];
  for (let i = 0; i < N; i++) {
    const x = x0 + r() * TILE, z = z0 + r() * TILE, a = r(), b = r();
    if (T.landAt(x, z) < 0.98 || T.riverAt(x, z) > 0.01) continue;
    const c = T.cityAt(x, z); if (c > 0.42 && a > 0.04) continue;
    const h = T.height(x, z); if (h < 2) continue;
    const sl = Math.abs(T.height(x + 12, z) - h) + Math.abs(T.height(x, z + 12) - h);
    const pf = sl > 2.2 || h > 140 ? 0.95 : c > 0.1 ? 0.08 : 0.04;
    if (a > pf) continue;
    const nt = net.nearestTrack(x, z, 20, false); if (nt && nt.d < 16) continue;
    const s = 9 + b * 11, pine = r() < 0.42;
    (pine ? P : L).push(x - x0, h - 0.3, z - z0, s * (pine ? 0.75 : 1), s, r());
    if (i % 300 === 299) yield;
  }
  const grp = new THREE.Group();
  for (const [arr, geo, cols] of [[P, pineGeo, TREE_COL.pine], [L, leafGeo, TREE_COL.leaf]]) {
    const n = arr.length / 6; if (!n) continue;
    const im = new THREE.InstancedMesh(geo, W.mats.tree, n);
    for (let i = 0; i < n; i++) {
      const o = i * 6; _p.set(arr[o], arr[o + 1], arr[o + 2]); _q.setFromAxisAngle(_up, arr[o + 5] * 6.28); _s.set(arr[o + 3], arr[o + 4], arr[o + 3]);
      im.setMatrixAt(i, _m.compose(_p, _q, _s)); im.setColorAt(i, cols[(arr[o + 5] * 997 | 0) % cols.length]);
    }
    im.computeBoundingSphere(); grp.add(im);
  }
  return grp;
}

// ───────── 선로 ─────────
class Batch {
  constructor(x0, z0) { this.x0 = x0; this.z0 = z0; this.S = {}; this.Bx = {}; this.lines = []; }
  // 측면 오프셋 lat, 높이 y 인 선분(p0→p1)을 샘플 idx 를 따라 밀어낸다
  strip(mat, L, idx, p0, p1, lat = 0) {
    const s = this.S[mat] || (this.S[mat] = { p: [], i: [], uv: [] }), base = s.p.length / 3;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], hd = L.hd[i], nx = -Math.sin(hd), nz = Math.cos(hd), X = L.x[i] - this.x0, Z = L.z[i] - this.z0, Y = L.y[i];
      s.p.push(X + nx * (p0[0] + lat), Y + p0[1], Z + nz * (p0[0] + lat), X + nx * (p1[0] + lat), Y + p1[1], Z + nz * (p1[0] + lat));
      const u = i * L.ds / 4; s.uv.push(u, 0, u, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 4);
      if (k) { const a = base + (k - 1) * 2; s.i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
  }
  prof(mat, L, idx, pts, lat = 0) { for (let k = 0; k < pts.length - 1; k++) this.strip(mat, L, idx, pts[k], pts[k + 1], lat); }
  box(mat, x, y, z, yaw, sx, sy, sz) { (this.Bx[mat] || (this.Bx[mat] = [])).push(x - this.x0, y, z - this.z0, yaw, sx, sy, sz); }
  line(pts) { this.lines.push(pts); }
  build(M) {
    geos();
    const g = new THREE.Group();
    for (const k in this.S) {
      const s = this.S[k]; if (!s.i.length) continue;
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(s.p, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(s.uv, 2));
      geo.setIndex(s.i); geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, typeof k === 'string' && k.startsWith('#') ? M.line(k) : M[k]);
      if (k === 'glass' || k === 'lamp') mesh.userData.cast = false;
      g.add(mesh);
    }
    for (const k in this.Bx) {
      const a = this.Bx[k], n = a.length / 7, im = new THREE.InstancedMesh(boxGeo, k.startsWith('#') ? M.line(k) : M[k], n);
      for (let i = 0; i < n; i++) { const o = i * 7; _p.set(a[o], a[o + 1], a[o + 2]); _q.setFromAxisAngle(_up, a[o + 3]); _s.set(a[o + 4], a[o + 5], a[o + 6]); im.setMatrixAt(i, _m.compose(_p, _q, _s)); }
      im.computeBoundingSphere(); if (k === 'lamp') im.userData.cast = false; g.add(im);
    }
    if (this.lines.length) {
      const p = []; for (const l of this.lines) for (let i = 0; i < l.length - 3; i += 3) p.push(l[i], l[i + 1], l[i + 2], l[i + 3], l[i + 4], l[i + 5]);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.add(new THREE.LineSegments(geo, M.wire));
    }
    return g;
  }
}

function tileRuns(net, tx, tz) {
  if (!net._runs) {
    const map = net._runs = new Map();
    for (const L of net.lines) {
      let prev = null, run = null;
      for (let i = 0; i < L.n; i++) {
        const k = Math.floor(L.x[i] / TILE) + ',' + Math.floor(L.z[i] / TILE);
        if (k !== prev || !run) { run = { L, idx: [] }; (map.get(k) || map.set(k, []).get(k)).push(run); prev = k; }
        run.idx.push(i);
      }
    }
  }
  return net._runs.get(tx + ',' + tz) || [];
}

const RAILS = [-0.7535, 0.7535];
export function* tracks(W, tx, tz, simple = false) {
  const runs = tileRuns(W.net, tx, tz); if (!runs.length) return null;
  const T = W.terrain, b = new Batch(tx * TILE, tz * TILE);
  for (const run of runs) {
    const L = run.L, n = L.n;
    const ext = [Math.max(0, run.idx[0] - 1), ...run.idx, Math.min(n - 1, run.idx[run.idx.length - 1] + 1)].filter((v, i, a) => i === 0 || v !== a[i - 1]);
    // 구조물 종류·역 구간별로 나눈다
    let a = 0;
    while (a < ext.length - 1) {
      const st = L.st[ext[a]], zn = L.zone[ext[a]] >= 0; let c = a;
      while (c < ext.length - 1 && L.st[ext[c + 1]] === st && (L.zone[ext[c + 1]] >= 0) === zn) c++;
      const idx = ext.slice(a, Math.min(c + 2, ext.length)).filter(i => !L.sh[i]);
      if (idx.length >= 2) emitRun(W, b, L, idx, st, zn, simple, T);
      a = c + 1;
    }
    yield;
  }
  return b.build(W.mats);
}

function stationGeom(L) {
  const h = L.cfg.gap / 2, pw = L.type === 'hsr' ? 8 : L.type === 'rail' ? 7 : L.type === 'light' ? 4.5 : 6;
  const e = h + 1.65; return { h, pw, e, Wd: e + pw };
}

function emitRun(W, b, L, idx, st, zone, simple, T) {
  const { h, Wd } = stationGeom(L);
  const first = idx[0], last = idx[idx.length - 1];
  if (st === ST.GROUND) {
    b.prof('ballast', L, idx, [[-(h + 3.4), -1.0], [-(h + 2.1), -0.3], [h + 2.1, -0.3], [h + 3.4, -1.0]]);
  } else if (st === ST.BRIDGE) {
    const w = zone ? Wd + 0.6 : h + 3.0, sub = L.type === 'metro' || L.type === 'light';
    b.prof('concrete', L, idx, [[-w + 0.3, -0.35], [-w + 0.3, 1.0], [-w, 1.0], [-w, -2.4], [w, -2.4], [w, 1.0], [w - 0.3, 1.0], [w - 0.3, -0.35], [-w + 0.3, -0.35]]);
    const sp = Math.max(1, Math.round((sub ? 25 : 35) / L.ds));
    for (let k = 0; k < idx.length; k += sp) {
      const i = idx[k], g = Math.max(T.height(L.x[i], L.z[i]), -40);
      const top = L.y[i] - 2.4; if (top - g < 1) continue;
      b.box('concrete', L.x[i], g - 2, L.z[i], -L.hd[i], 2.2, top - g + 2, sub ? 2.2 : w * 1.1);
      b.box('concrete', L.x[i], top - 1.2, L.z[i], -L.hd[i], 2.6, 1.2, w * 2 - 0.4);
    }
  } else if (st === ST.TUNNEL && !simple) {
    const r = h + 3.7, pts = [[-r, -1.0], [-r, 1.6]];
    for (let k = 1; k < 12; k++) { const a = Math.PI - k * Math.PI / 12; pts.push([Math.cos(a) * r, 1.6 + Math.sin(a) * r * 0.95]); }
    pts.push([r, 1.6], [r, -1.0], [-r, -1.0]);
    b.prof('tunnel', L, idx, pts);
    b.prof('concrete', L, idx, [[-(h + 1.8), -0.3], [h + 1.8, -0.3]]);
    for (let k = 0; k < idx.length; k += Math.max(1, Math.round(30 / L.ds))) { const i = idx[k], nx = -Math.sin(L.hd[i]), nz = Math.cos(L.hd[i]); b.box('lamp', L.x[i] + nx * (r - 0.2), L.y[i] + 2.6, L.z[i] + nz * (r - 0.2), -L.hd[i], 1.2, 0.15, 0.12); }
  } else if (st === ST.SUBWAY && !simple) {
    if (!zone) {
      const w = h + 2.7;
      b.prof('subway', L, idx, [[-w, -1.0], [-w, 5.0], [w, 5.0], [w, -1.0], [-w, -1.0]]);
      b.prof('concrete', L, idx, [[-(h + 1.8), -0.3], [h + 1.8, -0.3]]);
      for (let k = 0; k < idx.length; k += Math.max(1, Math.round(20 / L.ds))) for (const sd of [-1, 1]) {
        const i = idx[k], nx = -Math.sin(L.hd[i]), nz = Math.cos(L.hd[i]); b.box('lamp', L.x[i] + nx * sd * (w - 0.1), L.y[i] + 2.4, L.z[i] + nz * sd * (w - 0.1), -L.hd[i], 1.6, 0.12, 0.1);
      }
    }
  }
  // 터널 입구
  if ((st === ST.TUNNEL || st === ST.SUBWAY) && !simple) {
    for (const [i, j] of [[first, first - 1], [last, last + 1]]) {
      if (j < 0 || j >= L.n || L.st[j] === ST.TUNNEL || L.st[j] === ST.SUBWAY) continue;
      const w = st === ST.TUNNEL ? h + 3.7 : h + 2.7, top = st === ST.TUNNEL ? 2 + w : 5, nx = -Math.sin(L.hd[i]), nz = Math.cos(L.hd[i]);
      const yaw = -L.hd[i];
      b.box('concrete', L.x[i] + nx * (w + 2.5), L.y[i] - 3, L.z[i] + nz * (w + 2.5), yaw, 1.6, top + 6, 5);
      b.box('concrete', L.x[i] - nx * (w + 2.5), L.y[i] - 3, L.z[i] - nz * (w + 2.5), yaw, 1.6, top + 6, 5);
      b.box('concrete', L.x[i], L.y[i] + top, L.z[i], yaw, 1.6, 4, 2 * w + 10);
    }
  }
  if (simple) return;
  // 레일과 침목
  for (const tr of [-h, h]) {
    for (const r of RAILS) b.prof('rail', L, idx, [[-0.036, -0.16], [-0.036, 0], [0.036, 0], [0.036, -0.16]], tr + r);
  }
  const s0 = first * L.ds, s1 = last * L.ds, P = {};
  for (let s = Math.ceil(s0 / 0.65) * 0.65; s < s1; s += 0.65) {
    L.at(s, P); if (L.sh[P.i]) continue;
    const nx = -Math.sin(P.hd), nz = Math.cos(P.hd);
    for (const tr of [-h, h]) b.box('sleeper', P.x + nx * tr, P.y - 0.36, P.z + nz * tr, -P.hd, 0.24, 0.2, 2.5);
  }
  // 전차선
  const ch = st === ST.SUBWAY ? 4.6 : 5.3, sub = st === ST.SUBWAY || st === ST.TUNNEL;
  for (const tr of [-h, h]) {
    const wire = [], mess = [];
    for (const i of idx) { const nx = -Math.sin(L.hd[i]), nz = Math.cos(L.hd[i]), zz = (i % 4 < 2 ? 0.2 : -0.2) + tr; wire.push(L.x[i] - b.x0 + nx * zz, L.y[i] + ch, L.z[i] - b.z0 + nz * zz); if (!sub) mess.push(L.x[i] - b.x0 + nx * tr, L.y[i] + 6.5, L.z[i] - b.z0 + nz * tr); }
    b.line(wire); if (mess.length) b.line(mess);
  }
  if (!sub) {
    const mw = st === ST.BRIDGE ? (zone ? Wd + 0.3 : h + 2.6) : zone ? Wd + 0.8 : h + 3.4;
    for (let s = Math.ceil(s0 / 50) * 50; s < s1; s += 50) {
      L.at(s, P); const nx = -Math.sin(P.hd), nz = Math.cos(P.hd);
      for (const sd of [-1, 1]) {
        b.box('metal', P.x + nx * sd * mw, P.y - 0.8, P.z + nz * sd * mw, -P.hd, 0.3, 8.4, 0.3);
        b.box('metal', P.x + nx * sd * (mw - (mw - h + 0.6) / 2), P.y + 6.6, P.z + nz * sd * (mw - (mw - h + 0.6) / 2), -P.hd, 0.12, 0.12, mw - h + 0.6);
      }
    }
  }
}

// ───────── 역 ─────────
const signCache = new Map();
export function signTexture(name, prev, next, color, korail) {
  const key = [name, prev, next, color, korail].join('|');
  if (signCache.has(key)) return signCache.get(key);
  const t = canvasTex(1024, 256, (g, w, hh) => {
    g.fillStyle = korail ? '#0b2f6b' : '#ffffff'; g.fillRect(0, 0, w, hh);
    g.fillStyle = color; g.fillRect(0, hh - 46, w, 46);
    g.fillStyle = korail ? '#ffffff' : '#1a1a1a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${name.length > 7 ? 88 : 112}px "Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif`; g.fillText(name, w / 2, 96);
    g.font = '600 40px "Noto Sans KR","Malgun Gothic",sans-serif'; g.fillStyle = '#fff';
    const tri = (x, dir) => { g.beginPath(); g.moveTo(x, hh - 23); g.lineTo(x - dir * 16, hh - 36); g.lineTo(x - dir * 16, hh - 10); g.closePath(); g.fill(); };
    if (prev) { g.textAlign = 'left'; g.fillText(prev, 54, hh - 22); tri(24, -1); }
    if (next) { g.textAlign = 'right'; g.fillText(next, w - 54, hh - 22); tri(w - 24, 1); }
  });
  signCache.set(key, t); return t;
}
const signMats = new Map();
function signMat(tex) { let m = signMats.get(tex); if (!m) { m = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }); signMats.set(tex, m); } return m; }

export function* stations(W, tx, tz, tile) {
  const net = W.net, x0 = tx * TILE, z0 = tz * TILE, b = new Batch(x0, z0), signs = new THREE.Group(), bld = [];
  const built = W._builtSt || (W._builtSt = []);
  let any = false;
  for (const L of net.lines) for (const st of L.stations) {
    if (st.x < x0 || st.x >= x0 + TILE || st.z < z0 || st.z >= z0 + TILE) continue;
    const ci = Math.round(st.s / L.ds); if (L.sh[Math.min(ci, L.n - 1)]) continue;
    any = true;
    const g = stationGeom(L), half = L.platLen / 2;
    const ia = Math.max(0, Math.round((st.s - half) / L.ds)), ib = Math.min(L.n - 1, Math.round((st.s + half) / L.ds));
    const idx = []; for (let i = ia; i <= ib; i++) idx.push(i);
    if (idx.length < 2) continue;
    const P0 = {}, kind = L.st[Math.min(ci, L.n - 1)], under = kind === ST.SUBWAY || kind === ST.TUNNEL, elev = kind === ST.BRIDGE;
    const { e, pw, Wd, h } = g;
    for (const sd of [-1, 1]) {
      const P0 = [sd * e, -1.0], P1 = [sd * e, 1.1], P2 = [sd * (e + pw), 1.1], P3 = [sd * (e + pw), -1.0];
      b.prof(under ? 'platformU' : 'platform', L, idx, [P0, P1, P2, P3]);
      b.strip('yellow', L, idx, [sd * (e + 0.3), 1.11], [sd * (e + 0.7), 1.11]);
      if (under) {
        b.strip('glass', L, idx, [sd * (e + 0.12), 1.1], [sd * (e + 0.12), 3.2]);
        b.strip('metal', L, idx, [sd * (e + 0.12), 3.2], [sd * (e + 0.12), 3.75]);
      } else {
        const ry = elev ? 5.6 : 4.8, r0 = elev ? sd * (h - 0.4) : sd * (e - 0.4);
        b.prof('roofMetal', L, idx, [[r0, ry], [sd * (e + pw + 0.5), ry], [sd * (e + pw + 0.5), ry + 0.35], [r0, ry + 0.35], [r0, ry]]);
        b.strip('lamp', L, idx, [sd * (e + pw / 2 - 0.2), ry - 0.02], [sd * (e + pw / 2 + 0.2), ry - 0.02]);
      }
    }
    if (under) {
      const w = Wd + 0.25;
      b.prof('stationWall', L, idx, [[-w, -1.0], [-w, 5.8], [w, 5.8], [w, -1.0]]);
      b.strip(L.color, L, idx, [-w + 0.02, 2.3], [-w + 0.02, 2.75]); b.strip(L.color, L, idx, [w - 0.02, 2.3], [w - 0.02, 2.75]);
      for (const sd of [-1, 1]) b.strip('lamp', L, idx, [sd * (e + pw / 2 - 0.3), 5.75], [sd * (e + pw / 2 + 0.3), 5.75]);
      b.prof('concrete', L, idx, [[-(h + 1.8), -0.3], [h + 1.8, -0.3]]);
      // 역 양 끝 벽 (터널 입구만 뚫림)
      const tw = h + 2.7;
      for (const se of [st.s - half, st.s + half]) {
        L.at(se, P0); const nx = -Math.sin(P0.hd), nz = Math.cos(P0.hd), yaw = -P0.hd, sw = w - tw, cl = (w + tw) / 2;
        for (const sd of [-1, 1]) b.box('stationWall', P0.x + nx * sd * (cl + 3), P0.y - 1, P0.z + nz * sd * (cl + 3), yaw, 0.6, 16, sw + 6);
        b.box('stationWall', P0.x, P0.y + 5, P0.z, yaw, 0.6, 10, 2 * tw);
      }
    }
    // 기둥
    const P = {};
    for (let s = st.s - half + 6; s < st.s + half; s += 12) {
      L.at(s, P); const nx = -Math.sin(P.hd), nz = Math.cos(P.hd);
      for (const sd of [-1, 1]) {
        const lat = sd * (e + pw * 0.62), top = under ? 5.8 : elev ? 5.6 : 4.8;
        b.box(under ? 'stationWall' : 'metal', P.x + nx * lat, P.y + 1.1, P.z + nz * lat, -P.hd, 0.45, top - 1.1, 0.45);
      }
    }
    // 정지 위치 표지
    for (const dir of [1, -1]) {
      const sd = (L.drive === 'L' ? -1 : 1) * dir, sStop = st.s + dir * (half - 8);
      L.at(sStop, P); const nx = -Math.sin(P.hd), nz = Math.cos(P.hd), lat = sd * (e + 0.25);
      b.box('yellow', P.x + nx * lat, P.y + 1.1, P.z + nz * lat, -P.hd, 0.12, 1.6, 0.12);
      b.box('#202020', P.x + nx * lat, P.y + 2.5, P.z + nz * lat, -P.hd, 0.08, 0.5, 0.7);
    }
    // 역명판
    const k = st.k, prev = L.stations[k - 1]?.name || (L.loop ? L.stations[L.stations.length - 1].name : ''), next = L.stations[k + 1]?.name || (L.loop ? L.stations[0].name : '');
    const korail = L.type === 'hsr' || L.type === 'rail';
    for (const sd of [-1, 1]) {
      const tex = signTexture(st.name, sd > 0 ? prev : next, sd > 0 ? next : prev, L.color, korail), mat = signMat(tex);
      for (let s = st.s - half + 20; s < st.s + half - 10; s += 45) {
        L.at(s, P); const nx = -Math.sin(P.hd), nz = Math.cos(P.hd);
        const lat = under ? sd * (Wd + 0.2) : sd * (e + 0.9), y = under ? 3.6 : 3.5;
        const m = new THREE.Mesh(planeGeo(), mat); m.scale.set(4.2, 1.05, 1);
        m.position.set(P.x + nx * lat - x0, P.y + y, P.z + nz * lat - z0); m.rotation.y = -P.hd + (sd > 0 ? Math.PI : 0); m.userData.cast = false; signs.add(m);
      }
      // 진입하는 열차를 향한 표지
      L.at(st.s - sd * (half - 3), P); const nx = -Math.sin(P.hd), nz = Math.cos(P.hd), lat = (L.drive === 'L' ? -1 : 1) * sd * (e + 1.8);
      const m = new THREE.Mesh(planeGeo(), mat); m.scale.set(3.4, 0.85, 1);
      m.position.set(P.x + nx * lat - x0, P.y + 3.4, P.z + nz * lat - z0); m.rotation.y = Math.atan2(-sd * Math.cos(P.hd), -sd * Math.sin(P.hd)); m.userData.cast = false; signs.add(m);
    }
    // 역사 건물과 육교
    if (!under) {
      const near = built.find(o => o.name === st.name && Math.hypot(o.x - st.x, o.z - st.z) < 400);
      if (!near) {
        built.push({ name: st.name, x: st.x, z: st.z });
        L.at(st.s, P); const nx = -Math.sin(P.hd), nz = Math.cos(P.hd);
        const big = L.type === 'hsr' ? 1 : L.type === 'rail' ? 0.75 : 0.5, side = L.drive === 'L' ? 1 : -1;
        const bw = 26 * big + 6, off = Wd + 8 + bw / 2;
        const bx = P.x + nx * side * off, bz = P.z + nz * side * off, gy = Math.min(W.terrain.height(bx, bz), P.y - 1);
        if (W.terrain.height(bx, bz) < 1.2 || W.terrain.riverAt(bx, bz) > 0.05) { yield; continue; }
        bld.push(bx - x0, gy, bz - z0, L.platLen * 0.32 * big + 30, (elev ? 14 : 11) * (0.7 + big * 0.5), bw, -P.hd, 1, 0.8, hash(k, L.index));
        if (!elev && L.type !== 'metro' && L.type !== 'light') {
          b.box('concrete', P.x, P.y + 7.4, P.z, -P.hd, 5, 3.2, 2 * Wd + 6);
          b.box('glass', P.x, P.y + 7.6, P.z, -P.hd, 5.2, 2.6, 2 * Wd + 6.2);
        }
        // 역 이름 큰 간판
        const tex = signTexture(st.name, '', '', L.color, korail);
        const m = new THREE.Mesh(planeGeo(), signMat(tex)); m.scale.set(16 * big + 6, (16 * big + 6) / 4, 1);
        m.position.set(bx - x0 - nx * side * (bw / 2 + 0.3), gy + (elev ? 14 : 11) * (0.7 + big * 0.5) + 2.6, bz - z0 - nz * side * (bw / 2 + 0.3));
        m.rotation.y = -P.hd + (side > 0 ? Math.PI : 0); m.userData.cast = false; signs.add(m);
      }
    }
    yield;
  }
  if (!any) return null;
  const g = b.build(W.mats); g.add(signs);
  if (bld.length) g.add(instBuildings(W, bld));
  return g;
}
let _plane; const planeGeo = () => _plane || (_plane = new THREE.PlaneGeometry(1, 1));

// ───────── 랜드마크 ─────────
export function landmarks(W) {
  const T = W.terrain, grp = new THREE.Group(), M = W.mats;
  const std = o => new THREE.MeshStandardMaterial(o);
  const glassM = std({ color: 0x9fb4c4, metalness: 0.85, roughness: 0.12 });
  const goldM = std({ color: 0xc9a24a, metalness: 0.95, roughness: 0.18 });
  const white = std({ color: 0xe8e8e4, roughness: 0.55 });
  const red = std({ color: 0x8a2a20, roughness: 0.7 }), tile = std({ color: 0x3c3e42, roughness: 0.75 }), stone = std({ color: 0xb8b0a0, roughness: 0.9 });
  const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; grp.add(mesh); return mesh; };
  const lathe = (pts, seg = 32) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg);
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
  for (const [name, type, la, lo, ...o] of LANDMARKS) {
    const [x, z] = toXZ(la, lo), y = T.natural(x, z) - 1;
    if (type === 'lotte') {
      const pts = []; for (let i = 0; i <= 20; i++) { const t = i / 20; pts.push([34 * (1 - t) ** 1.25 + 9 * t, t * 500]); }
      const m = add(new THREE.Mesh(lathe(pts, 40), glassM), x, y, z); m.scale.set(1, 1, 0.92);
      add(new THREE.Mesh(lathe([[9, 0], [6, 40], [2, 55]], 12), std({ color: 0xd0d6dc, metalness: 0.7, roughness: 0.3, wireframe: true })), x, y + 500, z);
      add(new THREE.Mesh(box(60, 40, 60), glassM), x + 70, y, z + 30);
    } else if (type === 'ntower') {
      add(new THREE.Mesh(lathe([[6, 0], [5, 60], [3.6, 120], [3.4, 130]]), white), x, y, z);
      add(new THREE.Mesh(lathe([[3.4, 0], [10, 2], [11.5, 8], [11.5, 24], [8, 30], [3, 32]]), white), x, y + 112, z);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.8, 92, 8).translate(0, 46, 0), std({ color: 0xc8352a })), x, y + 144, z);
    } else if (type === 'sixtythree') {
      const sh = new THREE.Shape(); sh.moveTo(-40, -14); sh.lineTo(40, -14); sh.lineTo(28, 14); sh.lineTo(-28, 14); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: 249, bevelEnabled: false }); g.rotateX(-Math.PI / 2);
      const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const t = p.getY(i) / 249; p.setX(i, p.getX(i) * (1 - t * 0.55)); } g.computeVertexNormals();
      add(new THREE.Mesh(g, goldM), x, y, z).rotation.y = 0.5;
    } else if (type === 'assembly') {
      add(new THREE.Mesh(box(122, 22, 82), white), x, y, z);
      for (let i = -5; i <= 5; i++) add(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 22, 10).translate(0, 11, 0), white), x + i * 11, y, z + 43);
      add(new THREE.Mesh(new THREE.SphereGeometry(32, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1), std({ color: 0x5f8f86, metalness: 0.4, roughness: 0.5 })), x, y + 22, z);
    } else if (type === 'palace' || type === 'gate') {
      const p = type === 'palace' ? { w: 30, d: 21, base: 4, hh: 13 } : { w: 30, d: 12, base: 9, hh: 10 };
      add(new THREE.Mesh(box(p.w + 10, p.base, p.d + 10), stone), x, y, z);
      add(new THREE.Mesh(box(p.w, p.hh * 0.45, p.d), red), x, y + p.base, z);
      for (let k = 0; k < 2; k++) {
        const r = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4), tile); r.scale.set((p.w + 10 - k * 6) / 1.4, 6 - k, (p.d + 9 - k * 5) / 1.4);
        add(r, x, y + p.base + p.hh * 0.45 + 3 + k * 5.5, z);
      }
    } else if (type === 'ddp') {
      add(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24).scale(150, 28, 85), std({ color: 0xb7bcc0, metalness: 0.75, roughness: 0.3 })), x, y, z);
    } else if (type === 'glass') {
      add(new THREE.Mesh(box(48, o[0], 48), glassM), x, y, z);
      add(new THREE.Mesh(box(30, 12, 30), M.metal), x, y + o[0], z);
    } else if (type === 'stadium') {
      const r = o[0] / 2;
      add(new THREE.Mesh(lathe([[r * 0.55, 0], [r * 0.6, 0.5], [r, 28], [r * 1.02, 32], [r * 0.93, 33], [r * 0.7, 26]], 48), white), x, y, z);
    } else if (type === 'lct') {
      for (const [dx, dz, hh] of [[0, 0, 411], [70, -40, 339], [-60, 45, 339]])
        add(new THREE.Mesh(new THREE.CylinderGeometry(22, 26, hh, 6).translate(0, hh / 2, 0), glassM), x + dx, y, z + dz);
    } else if (type === 'busantower') {
      add(new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 100, 12).translate(0, 50, 0), white), x, y, z);
      add(new THREE.Mesh(new THREE.CylinderGeometry(9, 7, 14, 12).translate(0, 7, 0), white), x, y + 100, z);
    } else if (type === 'tower83') {
      add(new THREE.Mesh(lathe([[7, 0], [5, 140], [4, 160]]), white), x, y, z);
      add(new THREE.Mesh(lathe([[4, 0], [12, 3], [12, 18], [4, 22]]), glassM), x, y + 140, z);
    } else if (type === 'gwangan' || type === 'cablebridge') {
      const [x2, z2] = toXZ(o[0], o[1]), len = Math.hypot(x2 - x, z2 - z), yaw = Math.atan2(z2 - z, x2 - x);
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = -yaw; grp.add(g);
      const deckH = type === 'gwangan' ? 32 : 60;
      const prof = t => deckH * Math.sin(Math.PI * Math.min(1, Math.min(t, 1 - t) * 6) / 2) * 0.8 + 6;
      const segs = 60;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs, t1 = (i + 1) / segs, y0 = prof(t0), y1 = prof(t1), l = len / segs;
        const d = new THREE.Mesh(new THREE.BoxGeometry(l + 0.5, 3, 28), white); d.position.set((t0 + t1) / 2 * len, (y0 + y1) / 2, 0); d.rotation.z = Math.atan2(y1 - y0, l); g.add(d);
        const pier = new THREE.Mesh(box(4, (y0 + y1) / 2 + 30, 10), white); pier.position.set((t0 + t1) / 2 * len, -30, 0); g.add(pier);
      }
      const span = type === 'gwangan' ? 500 : 800, ph = type === 'gwangan' ? 105 : 238;
      for (const sd of [-1, 1]) {
        const tx = len / 2 + sd * span / 2;
        for (const zz of [-13, 13]) { const t = new THREE.Mesh(box(5, ph, 5), white); t.position.set(tx, -10, zz); g.add(t); }
        const cab = []; for (let k = 1; k <= 12; k++) for (const s2 of [-1, 1]) for (const zz of [-13, 13]) cab.push(tx, ph - 15, zz, tx + s2 * k * span / 26, prof(0.5 + (tx + s2 * k * span / 26 - len / 2) / len), zz);
        const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(cab, 3)); g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xdddddd })));
      }
      g.traverse(m => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
    }
  }
  return grp;
}
