// 실험실 방: 벽, 바닥, 물(수영장), 장치(회전 톱, 유압 프레스, 가시 함정, 전기 바닥, 발사대)
import * as THREE from 'three';
import { fbm, noise2, paint, heightToNormal, toTex } from './tex.js';

const V = THREE.Vector3;
export const ROOM = 14, WALL_H = 6;
export const POOL = { min: new V(4, -2.2, -12), max: new V(12, 0, -5), surface: -0.3 };

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
  return { concrete, floor, tile, metal, dark, chrome, paintY, stripes, copper, red, caus };
}

function envMap(renderer) {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(30, 8, 30), new THREE.MeshBasicMaterial({ color: 0x3a3c40, side: THREE.BackSide }));
  room.position.y = 3; s.add(room);
  const lamp = new THREE.MeshBasicMaterial({ color: 0xffffff });
  lamp.color.setScalar(18);
  for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6], [0, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 0.8), lamp); m.position.set(x, 6.9, z); s.add(m);
  }
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: 0x1c1d1f }));
  fl.rotation.x = -Math.PI / 2; fl.position.y = -0.9; s.add(fl);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.03);
  pm.dispose();
  return rt.texture;
}

export function createWorld(renderer, scene) {
  const M = makeMaterials();
  scene.environment = envMap(renderer);
  scene.background = new THREE.Color(0x0b0c0e);
  scene.fog = new THREE.Fog(0x0b0c0e, 30, 60);

  const boxes = [];      // 물리 충돌 (정적 + 움직이는)
  const solids = [];     // 총알·카메라가 막히는 정적 박스
  const addSolid = (b, mat, { visible = true, uvScale = 0.25, shadow = true } = {}) => {
    b.fric = b.fric ?? 1; boxes.push(b); solids.push(b);
    if (!visible) return b;
    const size = new V().subVectors(b.max, b.min), g = new THREE.BoxGeometry(size.x, size.y, size.z);
    // 월드 크기에 맞춘 UV
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

  // 바닥 (수영장 구멍 제외) — 두께가 수영장 깊이까지라 구멍 벽이 저절로 생긴다
  const Y0 = -2.7, P = POOL;
  addSolid(box(-ROOM, Y0, -ROOM, P.min.x, 0, ROOM), M.floor, { uvScale: 0.125, shadow: false });
  addSolid(box(P.max.x, Y0, -ROOM, ROOM, 0, ROOM), M.floor, { uvScale: 0.125, shadow: false });
  addSolid(box(P.min.x, Y0, P.max.z, P.max.x, 0, ROOM), M.floor, { uvScale: 0.125, shadow: false });
  addSolid(box(P.min.x, Y0, -ROOM, P.max.x, 0, P.min.z), M.floor, { uvScale: 0.125, shadow: false });
  addSolid(box(P.min.x, Y0 - 0.3, P.min.z, P.max.x, P.min.y, P.max.z), M.tile, { uvScale: 0.25, shadow: false });
  // 수영장 안쪽 타일 벽 (얇은 판, 보이는 용도)
  const tileWall = (x0, z0, x1, z1) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(x1 - x0, z1 - z0), 2.2), M.tile); const L = Math.hypot(x1 - x0, z1 - z0), nx = -(z1 - z0) / L, nz = (x1 - x0) / L; m.position.set((x0 + x1) / 2 + nx * 0.01, -1.1, (z0 + z1) / 2 + nz * 0.01); m.lookAt(m.position.x + nx, -1.1, m.position.z + nz); m.receiveShadow = true; scene.add(m);
    const uv = m.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.hypot(x1 - x0, z1 - z0) / 4, uv.getY(i) * 2.2 / 4); };
  tileWall(P.min.x, P.min.z, P.max.x, P.min.z); tileWall(P.max.x, P.min.z, P.max.x, P.max.z); tileWall(P.max.x, P.max.z, P.min.x, P.max.z); tileWall(P.min.x, P.max.z, P.min.x, P.min.z);
  // 수영장 테두리 (흰 돌)
  const rim = new THREE.MeshStandardMaterial({ color: 0xd9dcd8, roughness: 0.5 });
  for (const [x0, z0, x1, z1] of [[P.min.x - 0.3, P.min.z - 0.3, P.max.x + 0.3, P.min.z], [P.min.x - 0.3, P.max.z, P.max.x + 0.3, P.max.z + 0.3], [P.min.x - 0.3, P.min.z, P.min.x, P.max.z], [P.max.x, P.min.z, P.max.x + 0.3, P.max.z]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.04, z1 - z0), rim); m.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2); m.receiveShadow = true; scene.add(m);
  }
  // 벽 (방 둘레 + 안쪽 엄폐벽)
  const T = 0.5;
  addSolid(box(-ROOM - T, 0, -ROOM - T, ROOM + T, WALL_H, -ROOM), M.concrete);
  addSolid(box(-ROOM - T, 0, ROOM, ROOM + T, WALL_H, ROOM + T), M.concrete);
  addSolid(box(-ROOM - T, 0, -ROOM, -ROOM, WALL_H, ROOM), M.concrete);
  addSolid(box(ROOM, 0, -ROOM, ROOM + T, WALL_H, ROOM), M.concrete);
  addSolid(box(-4.2, 0, 1.5, -3.8, 3, 6.5), M.concrete);
  addSolid(box(-12, 0, -2.2, -6.5, 3, -1.8), M.concrete);
  addSolid(box(5.5, 0, 0.8, 9.5, 2.2, 1.2), M.concrete);
  addSolid(box(-0.4, 0, -14, 0.4, 3.2, -11.6), M.concrete);
  { const c = box(-ROOM - T, WALL_H, -ROOM - T, ROOM + T, WALL_H + 0.5, ROOM + T); boxes.push(c); solids.push(c); }
  // 천장 + 조명
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2 * ROOM + 1, 2 * ROOM + 1), new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.9 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = WALL_H; scene.add(ceil);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff4e6, emissiveIntensity: 6 });
  scene.add(new THREE.HemisphereLight(0x9aa6b8, 0x2a2622, 0.35));
  for (const [x, z] of [[-7, -7], [7, -7], [-7, 7], [7, 7], [0, 0]]) {
    const lm = new THREE.Mesh(new THREE.BoxGeometry(3, 0.08, 0.5), lampMat); lm.position.set(x, WALL_H - 0.05, z); scene.add(lm);
    const sp = new THREE.SpotLight(0xfff1e0, 55, 26, 1.05, 0.55, 2);
    sp.position.set(x, WALL_H - 0.15, z); sp.target.position.set(x, 0, z);
    if (x === 0 || (x === 7 && z === -7) || (x === -7 && z === 7)) { sp.castShadow = true; sp.shadow.mapSize.set(2048, 2048); sp.shadow.bias = -0.0002; sp.shadow.normalBias = 0.02; sp.shadow.camera.near = 0.5; sp.shadow.camera.far = 20; }
    scene.add(sp, sp.target);
  }

  // 물
  const wn = toTex(heightToNormal(256, (u, v) => fbm(u * 6, v * 6, 6, 4, 77), 6), { repeat: 3 });
  const wn2 = wn.clone(); wn2.needsUpdate = true; wn2.repeat.set(5, 5);
  const waterMat = new THREE.MeshPhysicalMaterial({ color: 0x9fe3f0, roughness: 0.09, metalness: 0, transmission: 0.92, thickness: 2, ior: 1.33,
    attenuationColor: new THREE.Color(0x1f8fa6), attenuationDistance: 2.5, normalMap: wn, normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 1.2, transparent: true, opacity: 0.96 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(P.max.x - P.min.x, P.max.z - P.min.z, 1, 1), waterMat);
  water.rotation.x = -Math.PI / 2; water.position.set((P.min.x + P.max.x) / 2, P.surface, (P.min.z + P.max.z) / 2);
  scene.add(water);
  const waterRegion = { min: new V(P.min.x, P.min.y, P.min.z), max: new V(P.max.x, P.surface, P.max.z), surface: P.surface, mesh: water };

  const world = {
    M, boxes, solids, water: waterRegion, devices: [],
    groundAt(x, z) { return (x > P.min.x && x < P.max.x && z > P.min.z && z < P.max.z) ? P.min.y : 0; },
    inPool(x, z, m = 0) { return x > P.min.x - m && x < P.max.x + m && z > P.min.z - m && z < P.max.z + m; },
    update(dt, time) {
      M.caus.value = time * 0.6;
      wn.offset.set(time * 0.02, time * 0.013);
      for (const d of this.devices) d.update(dt, time);
    },
  };
  return world;
}
