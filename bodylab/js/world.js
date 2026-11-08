// 실험실 방: 벽, 바닥, 물(수영장), 장치(회전 톱, 유압 프레스, 가시 함정, 전기 바닥, 발사대)
import * as THREE from 'three';
import { fbm, noise2, paint, heightToNormal, toTex } from './tex.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = THREE.Vector3;
export const MAP = 150; // 이동 가능한 범위 (±)
export const POOL = { min: new V(16, -2.2, -16), max: new V(30, 0, -5), surface: -0.3 };

function box(x0, y0, z0, x1, y1, z1, extra = {}) { return { min: new V(x0, y0, z0), max: new V(x1, y1, z1), ...extra }; }

function makeMaterials() {
  const S = 512;
  const conc = (u, v) => fbm(u * 8, v * 8, 8, 6, 3) * 0.7 + fbm(u * 40, v * 40, 40, 3, 9) * 0.3;
  const concrete = new THREE.MeshStandardMaterial({
    map: toTex(paint(S, (u, v) => { const n = conc(u, v), s = fbm(u * 3, v * 3, 3, 4, 21); const c = 120 + n * 70 - Math.max(0, s - 0.55) * 160; return [c, c * 0.98, c * 0.95]; }), { srgb: true, repeat: 1 }),
    normalMap: toTex(heightToNormal(S, (u, v) => conc(u, v), 3)),
    roughnessMap: toTex(paint(S, (u, v) => { const r = 170 + fbm(u * 6, v * 6, 6, 4, 5) * 80; return [r, r, r]; })),
    roughness: 1, envMapIntensity: 0.6,
  });
  // 바닥: 광택 에폭시 콘크리트 + 2m 줄눈
  const floorH = (u, v) => { const t = 4, fu = (u * t) % 1, fv = (v * t) % 1; const seam = Math.min(fu, 1 - fu, fv, 1 - fv) < 0.006 ? 1 : 0; return fbm(u * 16, v * 16, 16, 5, 7) * 0.4 - seam; };
  const floor = new THREE.MeshStandardMaterial({
    map: toTex(paint(S, (u, v) => { const h = floorH(u, v), s = fbm(u * 5, v * 5, 5, 5, 31); const c = 92 + h * 60 + (s - 0.5) * 40; return [c * 0.95, c * 0.97, c]; }), { srgb: true }),
    normalMap: toTex(heightToNormal(S, floorH, 4)),
    roughnessMap: toTex(paint(S, (u, v) => { const r = 70 + fbm(u * 10, v * 10, 10, 4, 11) * 120; return [r, r, r]; })),
    roughness: 1, envMapIntensity: 1,
  });
  // 수영장 타일 (물속은 빛 무늬 caustics)
  const tileH = (u, v) => { const t = 16, fu = (u * t) % 1, fv = (v * t) % 1; return Math.min(fu, 1 - fu, fv, 1 - fv) < 0.05 ? 0 : 1; };
  const tile = new THREE.MeshStandardMaterial({
    map: toTex(paint(S, (u, v) => { const g = tileH(u, v), n = noise2(Math.floor(u * 16), Math.floor(v * 16), 16, 4); return g ? [190 + n * 30, 222 + n * 20, 232] : [120, 130, 135]; }), { srgb: true }),
    normalMap: toTex(heightToNormal(S, tileH, 1.5)), roughness: 0.25, envMapIntensity: 0.8,
  });
  const caus = { value: 0 };
  tile.onBeforeCompile = sh => {
    sh.uniforms.uTime = caus;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWP; uniform float uTime;
float cz(vec2 p){ vec2 i=p; float c=1.0; for(int n=0;n<4;n++){ float t=uTime*(1.0-(3.5/float(n+1))); i=p+vec2(cos(t-i.x)+sin(t+i.y),sin(t-i.y)+cos(t+i.x)); c+=1.0/length(vec2(p.x/(sin(i.x+t)/0.005),p.y/(cos(i.y+t)/0.005))); } c/=4.0; c=1.17-pow(clamp(c,0.0,1.17),1.4); return clamp(pow(abs(c),8.0),0.0,1.5); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if(vWP.y < ${POOL.surface.toFixed(2)}){ float k = cz(vWP.xz*1.7+vec2(20.0)); totalEmissiveRadiance += vec3(0.35,0.7,0.8)*k*0.35; diffuseColor.rgb *= vec3(0.75,0.92,1.0); }`);
  };
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 1, roughness: 0.32,
    roughnessMap: toTex(paint(256, (u, v) => { const r = 90 + noise2(u * 4, v * 256, 256, 3) * 70; return [r, r, r]; })) });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24272b, metalness: 0.7, roughness: 0.45 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe8ecf0, metalness: 1, roughness: 0.08 });
  const paintY = new THREE.MeshStandardMaterial({ color: 0xd8a514, metalness: 0.3, roughness: 0.45 });
  const stripes = new THREE.MeshStandardMaterial({ map: toTex(paint(128, (u, v) => ((u + v) * 4 % 1) < 0.5 ? [230, 175, 20] : [25, 25, 25]), { srgb: true, repeat: 2 }), roughness: 0.6 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xc9744a, metalness: 1, roughness: 0.3 });
  const red = new THREE.MeshStandardMaterial({ color: 0xa31818, metalness: 0.3, roughness: 0.4 });
  // 잔디: 반복 무늬 + 넓은 얼룩 (셰이더에서 월드 좌표로)
  const grassH = (u, v) => fbm(u * 32, v * 32, 32, 4, 41) * 0.6 + fbm(u * 128, v * 128, 128, 2, 43) * 0.4;
  const grass = new THREE.MeshStandardMaterial({
    map: toTex(paint(S, (u, v) => { const n = grassH(u, v), d = fbm(u * 6, v * 6, 6, 3, 47); return [52 + n * 40 + d * 25, 88 + n * 55 + d * 20, 34 + n * 20]; }), { srgb: true, repeat: 60 }),
    normalMap: toTex(heightToNormal(S, grassH, 3), { repeat: 60 }), roughness: 0.95, envMapIntensity: 0.5,
  });
  grass.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWXZ = (modelMatrix*vec4(transformed,1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;\nfloat gh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }\nfloat gn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(gh(i),gh(i+vec2(1,0)),f.x),mix(gh(i+vec2(0,1)),gh(i+vec2(1,1)),f.x),f.y); }')
      .replace('#include <map_fragment>', '#include <map_fragment>\nfloat mac = gn(vWXZ*0.03)*0.6+gn(vWXZ*0.11)*0.4; diffuseColor.rgb *= mix(vec3(0.78,0.82,0.7), vec3(1.12,1.08,0.92), mac);');
  };
  // 아스팔트 (차선은 따로)
  const asphaltH = (u, v) => fbm(u * 24, v * 24, 24, 4, 61);
  const asphalt = new THREE.MeshStandardMaterial({
    map: toTex(paint(S, (u, v) => { const n = asphaltH(u, v); const c = 46 + n * 30; return [c, c, c * 1.03]; }), { srgb: true, repeat: 1 }),
    normalMap: toTex(heightToNormal(S, asphaltH, 2)), roughness: 0.82, envMapIntensity: 0.5,
  });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xe8e2c8, roughness: 0.6 });
  const lineY = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.6 });
  return { concrete, floor, tile, metal, dark, chrome, paintY, stripes, copper, red, caus, grass, asphalt, lineMat, lineY };
}


// ───────── 하늘 (해·그러데이션) ─────────
export const SUN_DIR = new V(0.45, 0.62, 0.35).normalize();
function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }',
    fragmentShader: `uniform vec3 uSun; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float h = d.y;
        vec3 zen = vec3(0.16,0.34,0.72), hor = vec3(0.70,0.80,0.90), gnd = vec3(0.32,0.34,0.33);
        vec3 c = h > 0.0 ? mix(hor, zen, pow(h, 0.55)) : mix(hor, gnd, pow(-h, 0.4));
        float sd = max(dot(d, uSun), 0.0);
        c += vec3(1.0,0.85,0.6)*pow(sd, 8.0)*0.35 + vec3(1.0,0.9,0.75)*pow(sd, 64.0)*0.8;
        c += vec3(20.0,18.0,15.0)*smoothstep(0.9995, 0.99975, sd);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  m.frustumCulled = false; m.renderOrder = -1;
  return m;
}
function envMap(renderer, sky) {
  const s = new THREE.Scene(); s.add(sky.clone());
  const g = new THREE.Mesh(new THREE.CircleGeometry(800, 32), new THREE.MeshBasicMaterial({ color: 0x3d4a33 })); g.rotation.x = -Math.PI / 2; g.position.y = -1; s.add(g);
  const pm = new THREE.PMREMGenerator(renderer); const rt = pm.fromScene(s, 0.02, 1, 1000); pm.dispose();
  return rt.texture;
}

export function createWorld(renderer, scene) {
  const M = makeMaterials();
  const sky = makeSky(); scene.add(sky);
  scene.environment = envMap(renderer, sky);
  scene.background = new THREE.Color(0xb4c6d6);
  scene.fog = new THREE.FogExp2(0xb4c6d6, 0.0065);

  const boxes = [], solids = [];
  const addSolid = (b, mat, { visible = true, uvScale = 0.25, shadow = true } = {}) => {
    b.fric = b.fric ?? 1; boxes.push(b); solids.push(b);
    if (!visible || !mat) return b;
    const size = new V().subVectors(b.max, b.min), g = new THREE.BoxGeometry(size.x, size.y, size.z);
    const uv = g.attributes.uv, pos = g.attributes.position, nrm = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i));
      const px = pos.getX(i) + (b.min.x + b.max.x) / 2, py = pos.getY(i) + (b.min.y + b.max.y) / 2, pz = pos.getZ(i) + (b.min.z + b.max.z) / 2;
      if (ay > 0.5) uv.setXY(i, px * uvScale, pz * uvScale); else if (ax > 0.5) uv.setXY(i, pz * uvScale, py * uvScale); else uv.setXY(i, px * uvScale, py * uvScale);
    }
    const m = new THREE.Mesh(g, mat);
    m.position.addVectors(b.min, b.max).multiplyScalar(0.5);
    m.castShadow = shadow; m.receiveShadow = true;
    scene.add(m); b.mesh = m;
    return b;
  };
  const flat = (x0, z0, x1, z1, mat, y = 0.002, uvs = 0.25) => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + (x0 + x1) / 2) * uvs, (p.getZ(i) + (z0 + z1) / 2) * uvs);
    const m = new THREE.Mesh(g, mat); m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.receiveShadow = true; scene.add(m); return m;
  };

  // ───────── 땅 (저수지 구멍 제외) ─────────
  const Y0 = -2.7, P = POOL, E = 400;
  for (const [x0, z0, x1, z1] of [[-E, -E, P.min.x, E], [P.max.x, -E, E, E], [P.min.x, P.max.z, P.max.x, E], [P.min.x, -E, P.max.x, P.min.z]]) addSolid({ min: new V(x0, Y0, z0), max: new V(x1, 0, z1) }, null);
  // 잔디 판 (저수지 자리에 구멍)
  const gShape = new THREE.Shape([new THREE.Vector2(-E, -E), new THREE.Vector2(E, -E), new THREE.Vector2(E, E), new THREE.Vector2(-E, E)]);
  gShape.holes.push(new THREE.Path([new THREE.Vector2(P.min.x, -P.min.z), new THREE.Vector2(P.min.x, -P.max.z), new THREE.Vector2(P.max.x, -P.max.z), new THREE.Vector2(P.max.x, -P.min.z)]));
  const gg = new THREE.ShapeGeometry(gShape); gg.rotateX(-Math.PI / 2);
  { const uv = gg.attributes.uv, p = gg.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 6.5 / 60, p.getZ(i) / 6.5 / 60); }
  const ground = new THREE.Mesh(gg, M.grass); ground.receiveShadow = true; scene.add(ground);
  // 저수지 바닥·벽 (타일) + 돌 테두리
  addSolid({ min: new V(P.min.x, Y0 - 0.3, P.min.z), max: new V(P.max.x, P.min.y, P.max.z) }, M.tile, { uvScale: 0.25, shadow: false });
  const tileWall = (x0, z0, x1, z1) => { const L = Math.hypot(x1 - x0, z1 - z0), nx = -(z1 - z0) / L, nz = (x1 - x0) / L; const m = new THREE.Mesh(new THREE.PlaneGeometry(L, 2.2), M.tile); m.position.set((x0 + x1) / 2 + nx * 0.01, -1.1, (z0 + z1) / 2 + nz * 0.01); m.lookAt(m.position.x + nx, -1.1, m.position.z + nz); m.receiveShadow = true; scene.add(m);
    const uv = m.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L / 4, uv.getY(i) * 2.2 / 4); };
  tileWall(P.min.x, P.min.z, P.max.x, P.min.z); tileWall(P.max.x, P.min.z, P.max.x, P.max.z); tileWall(P.max.x, P.max.z, P.min.x, P.max.z); tileWall(P.min.x, P.max.z, P.min.x, P.min.z);
  const rim = new THREE.MeshStandardMaterial({ color: 0xc9ccc6, roughness: 0.6 });
  for (const [x0, z0, x1, z1] of [[P.min.x - 0.5, P.min.z - 0.5, P.max.x + 0.5, P.min.z], [P.min.x - 0.5, P.max.z, P.max.x + 0.5, P.max.z + 0.5], [P.min.x - 0.5, P.min.z, P.min.x, P.max.z], [P.max.x, P.min.z, P.max.x + 0.5, P.max.z]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.08, z1 - z0), rim); m.position.set((x0 + x1) / 2, 0.04, (z0 + z1) / 2); m.receiveShadow = m.castShadow = true; scene.add(m);
  }
  // ───────── 실험장 (콘크리트 바닥 + 벽) ─────────
  flat(-24, -20, 13, 22, M.floor, 0.003, 1 / 8);
  addSolid(box(-4.2, 0, 1.5, -3.8, 3, 6.5), M.concrete);
  addSolid(box(-20, 0, -2.2, -15, 3, -1.8), M.concrete);
  addSolid(box(5.5, 0, 0.8, 9.5, 2.2, 1.2), M.concrete);
  addSolid(box(-0.4, 0, -20, 0.4, 3.2, -16), M.concrete);
  addSolid(box(-24.5, 0, -20, -24, 2.5, 4), M.concrete);
  // 창고 건물
  for (const [x, z, w, d, h] of [[-38, -10, 14, 22, 7], [-36, 26, 12, 10, 5], [40, 20, 16, 12, 6]]) {
    addSolid(box(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2), M.concrete, { uvScale: 0.2 });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.3, d + 0.6), M.dark); roof.position.set(x, h + 0.15, z); roof.castShadow = true; scene.add(roof);
  }
  // ───────── 도로 (순환로 + 바깥으로 나가는 길) ─────────
  const road = (x0, z0, x1, z1) => flat(x0, z0, x1, z1, M.asphalt, 0.006, 1 / 6);
  const RX = 62, RZ = 46, RW = 4.5;
  road(-RX - RW, -RZ - RW, RX + RW, -RZ + RW); road(-RX - RW, RZ - RW, RX + RW, RZ + RW);
  road(-RX - RW, -RZ + RW, -RX + RW, RZ - RW); road(RX - RW, -RZ + RW, RX + RW, RZ - RW);
  road(RX + RW, -RW, 150, RW); road(-RW, RZ + RW, RW, 150);
  road(-RW, 22, RW, RZ - RW); // 실험장 → 순환로
  const dash = (x0, z0, x1, z1, along) => { const L = along === 'x' ? x1 - x0 : z1 - z0; for (let t = 1.5; t < L - 1; t += 6) { const g = new THREE.PlaneGeometry(along === 'x' ? 3 : 0.15, along === 'x' ? 0.15 : 3); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, M.lineMat); m.position.set(along === 'x' ? x0 + t + 1.5 : (x0 + x1) / 2, 0.009, along === 'x' ? (z0 + z1) / 2 : z0 + t + 1.5); m.receiveShadow = true; scene.add(m); } };
  dash(-RX, -RZ, RX, -RZ, 'x'); dash(-RX, RZ, RX, RZ, 'x'); dash(-RX, -RZ, -RX, RZ, 'z'); dash(RX, -RZ, RX, RZ, 'z'); dash(RX + RW, 0, 150, 0, 'x'); dash(0, RZ + RW, 0, 150, 'z');
  const onRoad = (x, z) => (Math.abs(Math.abs(z) - RZ) < RW + 2 && Math.abs(x) < RX + RW + 2) || (Math.abs(Math.abs(x) - RX) < RW + 2 && Math.abs(z) < RZ + RW + 2) || (x > RX && Math.abs(z) < RW + 2) || (z > RZ && Math.abs(x) < RW + 2) || (Math.abs(x) < RW + 2 && z > 20 && z < RZ);
  // ───────── 나무 (인스턴스) ─────────
  const trees = [];
  let seed = 9; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 400 && trees.length < 230; i++) {
    const a = rnd() * Math.PI * 2, r = 30 + Math.pow(rnd(), 0.8) * 115, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (onRoad(x, z) || (x > -28 && x < 17 && z > -24 && z < 26) || (x > P.min.x - 3 && x < P.max.x + 3 && z > P.min.z - 3 && z < P.max.z + 3)) continue;
    if (solids.some(b => b.max.y > 0.5 && x > b.min.x - 2 && x < b.max.x + 2 && z > b.min.z - 2 && z < b.max.z + 2)) continue;
    if (trees.some(t => Math.hypot(t.x - x, t.z - z) < 4)) continue;
    trees.push({ x, z, s: 0.8 + rnd() * 0.6, ry: rnd() * 6.28 });
  }
  const bark = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, envMapIntensity: 0.4 });
  const trunkG = new THREE.CylinderGeometry(0.16, 0.24, 3.2, 8); trunkG.translate(0, 1.6, 0);
  const crown = []; for (const [x, y, z, r] of [[0, 4.2, 0, 1.9], [0.8, 3.6, 0.4, 1.4], [-0.7, 3.7, -0.5, 1.5], [0.1, 5.2, -0.2, 1.3]]) { const g = new THREE.IcosahedronGeometry(r, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + (Math.sin(p.getX(i) * 4.1 + x) * Math.sin(p.getY(i) * 3.3 + z) * 0.15); p.setXYZ(i, p.getX(i) * k + x, p.getY(i) * k + y, p.getZ(i) * k + z); } crown.push(g.toNonIndexed()); }
  const crownG = mergeGeometries(crown); crownG.computeVertexNormals();
  { const c = new Float32Array(crownG.attributes.position.count * 3); for (let i = 0; i < c.length / 3; i++) { const t = Math.random(); c[i * 3] = 0.16 + t * 0.08; c[i * 3 + 1] = 0.3 + t * 0.12; c[i * 3 + 2] = 0.1 + t * 0.04; } crownG.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
  const trunks = new THREE.InstancedMesh(trunkG, bark, trees.length), crowns = new THREE.InstancedMesh(crownG, leaf, trees.length);
  const tm = new THREE.Matrix4(), tq = new THREE.Quaternion();
  trees.forEach((t, i) => { tm.compose(new V(t.x, 0, t.z), tq.setFromAxisAngle(new V(0, 1, 0), t.ry), new V(t.s, t.s, t.s)); trunks.setMatrixAt(i, tm); crowns.setMatrixAt(i, tm);
    const b = { min: new V(t.x - 0.22 * t.s, 0, t.z - 0.22 * t.s), max: new V(t.x + 0.22 * t.s, 3.2 * t.s, t.z + 0.22 * t.s), fric: 1 }; boxes.push(b); solids.push(b); });
  trunks.castShadow = crowns.castShadow = true; trunks.receiveShadow = crowns.receiveShadow = true;
  scene.add(trunks, crowns);
  // ───────── 먼 언덕 (지평선) ─────────
  { const g = new THREE.RingGeometry(170, 520, 96, 6); g.rotateX(-Math.PI / 2); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z), a = Math.atan2(z, x); p.setY(i, Math.max(0, (r - 175) * 0.12) * (0.6 + 0.4 * Math.sin(a * 5) * Math.sin(a * 3 + 1)) + Math.sin(a * 17) * 2); }
    g.computeVertexNormals(); const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4f6a3c, roughness: 1 })); m.position.y = -0.05; scene.add(m); }
  // 지도 경계 (보이지 않는 벽)
  for (const [x0, z0, x1, z1] of [[-MAP - 1, -MAP - 1, MAP + 1, -MAP], [-MAP - 1, MAP, MAP + 1, MAP + 1], [-MAP - 1, -MAP, -MAP, MAP], [MAP, -MAP, MAP + 1, MAP]]) addSolid(box(x0, 0, z0, x1, 30, z1), null);

  // ───────── 빛 (해) ─────────
  scene.add(new THREE.HemisphereLight(0xbfd4f0, 0x4a5236, 0.9));
  const sun = new THREE.DirectionalLight(0xfff0dc, 3.2);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
  const sc = sun.shadow.camera; sc.left = sc.bottom = -28; sc.right = sc.top = 28; sc.near = 1; sc.far = 160;
  scene.add(sun, sun.target);

  // ───────── 물 ─────────
  const wn = toTex(heightToNormal(256, (u, v) => fbm(u * 6, v * 6, 6, 4, 77), 6), { repeat: 3 });
  const waterMat = new THREE.MeshPhysicalMaterial({ color: 0x9fe3f0, roughness: 0.09, metalness: 0, transmission: 0.92, thickness: 2, ior: 1.33,
    attenuationColor: new THREE.Color(0x1f7f96), attenuationDistance: 2.5, normalMap: wn, normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 1.1, transparent: true, opacity: 0.96 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(P.max.x - P.min.x, P.max.z - P.min.z, 1, 1), waterMat);
  water.rotation.x = -Math.PI / 2; water.position.set((P.min.x + P.max.x) / 2, P.surface, (P.min.z + P.max.z) / 2);
  scene.add(water);
  const waterRegion = { min: new V(P.min.x, P.min.y, P.min.z), max: new V(P.max.x, P.surface, P.max.z), surface: P.surface, mesh: water };

  const world = {
    M, boxes, solids, obbs: [], water: waterRegion, devices: [], sun, sky, trees: { trunks, crowns, n: trees.length },
    groundAt(x, z) { return (x > P.min.x && x < P.max.x && z > P.min.z && z < P.max.z) ? P.min.y : 0; },
    inPool(x, z, m = 0) { return x > P.min.x - m && x < P.max.x + m && z > P.min.z - m && z < P.max.z + m; },
    // 그림자 카메라를 보는 곳 주변으로 (텍셀 단위로 맞춰 떨림 방지)
    follow(p) {
      const t = 56 / sun.shadow.mapSize.x; const x = Math.round(p.x / t) * t, z = Math.round(p.z / t) * t;
      sun.target.position.set(x, 0, z); sun.position.set(x + SUN_DIR.x * 80, SUN_DIR.y * 80, z + SUN_DIR.z * 80);
      sky.position.copy(p);
    },
    setQuality(q) { // 0 고화질 · 1 최적화 · 2 최대 최적화(그림자 없음)
      sun.castShadow = q < 2;
      const ms = q ? 1024 : 2048; if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); sun.shadow.map?.dispose(); sun.shadow.map = null; }
      waterMat.transmission = q ? 0 : 0.92; waterMat.opacity = q ? 0.8 : 0.96; waterMat.color.set(q ? 0x2a7d90 : 0x9fe3f0); waterMat.needsUpdate = true;
      scene.fog.density = [0.0065, 0.011, 0.016][q];
      trunks.count = crowns.count = Math.floor(trees.length * [1, 0.55, 0.35][q]);
    },
    update(dt, time) {
      M.caus.value = time * 0.6;
      wn.offset.set(time * 0.02, time * 0.013);
      for (const d of this.devices) d.update(dt, time);
    },
  };
  return world;
}
