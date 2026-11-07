// 맵(플레이스) 데이터를 3D 월드로. 게임과 스튜디오가 함께 쓴다.
import * as THREE from 'three';
import { rboxGeo, partMat, boxUV, makeSky, envFromSky, disposeTree, tex } from './gfx.js';

export const SKIES = {
  day: { name: '맑은 하늘', top: '#0d4fd0', hor: '#6aaeff', bot: '#cfe6ff', sun: [0.45, 0.75, 0.35], sunCol: 0xffffff, sunI: 2.6, hemi: [0xdcecff, 0x7b7f86, 1.0], fog: 0x9cc8ff },
  sunset: { name: '노을', top: '#2b3d8f', hor: '#ff9a5c', bot: '#ffd0a6', sun: [0.8, 0.12, -0.4], sunCol: 0xffb070, sunI: 2.2, hemi: [0xffc6a0, 0x5a4a5a, 0.9], fog: 0xf0b38a },
  night: { name: '밤', top: '#030817', hor: '#1a2a58', bot: '#0d1428', sun: [-0.3, 0.6, 0.4], sunCol: 0x9fb8ff, sunI: 0.7, hemi: [0x5068a8, 0x1a1a24, 0.5], fog: 0x15203f, stars: true },
};
export const KINDS = [['normal', '블록'], ['spawn', '스폰'], ['check', '체크포인트'], ['kill', '용암'], ['jump', '점프대'], ['coin', '코인']];
export const SHAPES = [['block', '블록'], ['ball', '공'], ['cyl', '원통']];

export const TEST_PLACE = { id: 'test', name: 'Test', sky: 'day', baseplate: true, parts: [{ t: 'block', k: 'spawn', p: [0, 0.5, 0], s: [12, 1, 12], c: '#5d626b', m: 'plastic' }] };

export const TEMPLATES = {
  base: () => ({ sky: 'day', baseplate: true, parts: [{ t: 'block', k: 'spawn', p: [0, 0.5, 0], s: [8, 1, 8], c: '#5d626b', m: 'plastic' }] }),
  obby: () => {
    const parts = [{ t: 'block', k: 'spawn', p: [0, 0.5, 0], s: [8, 1, 8], c: '#5d626b', m: 'plastic' }];
    const cols = ['#ff4d4d', '#ffb02e', '#ffe14d', '#3ddc84', '#3b9bff', '#a66bff'];
    let z = -10, y = 2;
    for (let i = 0; i < 12; i++) {
      parts.push({ t: 'block', k: 'normal', p: [(i % 3 - 1) * 4, y, z], s: [4, 1, 4], c: cols[i % 6], m: 'plastic' });
      if (i % 4 === 3) parts.push({ t: 'block', k: 'check', p: [(i % 3 - 1) * 4, y + 0.6, z], s: [3, 0.2, 3], c: '#22c55e', m: 'neon' });
      if (i % 3 === 1) parts.push({ t: 'block', k: 'coin', p: [(i % 3 - 1) * 4, y + 2.5, z], s: [1.6, 1.6, 0.3], c: '#ffcc33', m: 'metal' });
      z -= 7; y += 1.5;
    }
    parts.push({ t: 'block', k: 'kill', p: [0, 0.2, -45], s: [30, 0.4, 80], c: '#ff4a1a', m: 'neon' });
    parts.push({ t: 'block', k: 'jump', p: [0, y, z], s: [5, 1, 5], c: '#ffd400', m: 'plastic' });
    parts.push({ t: 'block', k: 'normal', p: [0, y + 18, z - 12], s: [10, 1, 10], c: '#ffffff', m: 'glass' });
    return { sky: 'sunset', baseplate: true, parts };
  },
  sky: () => ({ sky: 'night', baseplate: false, parts: [{ t: 'block', k: 'spawn', p: [0, 40, 0], s: [8, 1, 8], c: '#5d626b', m: 'plastic' }, { t: 'block', k: 'normal', p: [0, 39, -14], s: [6, 1, 6], c: '#3b9bff', m: 'neon' }] }),
};

function padTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256); g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = 12; g.strokeRect(6, 6, 244, 244);
  g.fillStyle = 'rgba(255,255,255,.9)'; g.globalCompositeOperation = 'difference';
  g.fillRect(86, 60, 22, 136); g.beginPath(); g.moveTo(108, 128); g.lineTo(160, 60); g.lineTo(186, 60); g.lineTo(132, 128); g.lineTo(186, 196); g.lineTo(160, 196); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
let PAD_T;
const geoCache = new Map();
function partGeo(t, w, h, d) {
  const key = `${t}|${w}|${h}|${d}`;
  if (geoCache.has(key)) return geoCache.get(key);
  let g;
  if (t === 'ball') { g = new THREE.SphereGeometry(0.5, 32, 20); g.scale(w, h, d); }
  else if (t === 'cyl') { g = new THREE.CylinderGeometry(0.5, 0.5, 1, 32); g.scale(w, h, d); }
  else { g = rboxGeo(w, h, d, Math.min(w, h, d) * 0.06, 1).clone(); boxUV(g, w, h, d, 4); }
  g.userData.shared = true; geoCache.set(key, g);
  return g;
}

export function makePartMesh(p) {
  const [w, h, d] = p.s;
  let mesh;
  if (p.k === 'coin') {
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.18, 28), new THREE.MeshStandardMaterial({ color: p.c, metalness: 1, roughness: 0.25, emissive: 0x553300, emissiveIntensity: 0.6 }));
    mesh.geometry.rotateX(Math.PI / 2); mesh.scale.set(w, h, 1);
  } else if (p.k === 'spawn') {
    PAD_T ||= padTex();
    const side = partMat(p.c, p.m), top = new THREE.MeshStandardMaterial({ color: p.c, map: PAD_T, roughness: 0.6 });
    mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, top, side, side, side]);
  } else {
    mesh = new THREE.Mesh(partGeo(p.t, w, h, d), partMat(p.c, p.k === 'kill' ? 'neon' : p.m));
  }
  mesh.position.set(...p.p);
  if (p.r) mesh.rotation.y = p.r;
  mesh.castShadow = p.m !== 'glass' && p.k !== 'coin'; mesh.receiveShadow = true;
  mesh.userData.part = p;
  return mesh;
}

export function buildWorld(scene, place, prof, renderer) {
  const sky = SKIES[place.sky] || SKIES.day;
  const root = new THREE.Group(); scene.add(root);
  const skyMesh = makeSky(sky); root.add(skyMesh);
  scene.environment = envFromSky(renderer, sky);
  scene.fog = new THREE.Fog(sky.fog, prof.fog * 0.35, prof.fog);
  const hemi = new THREE.HemisphereLight(sky.hemi[0], sky.hemi[1], sky.hemi[2]); root.add(hemi);
  const sun = new THREE.DirectionalLight(sky.sunCol, sky.sunI);
  const sunDir = new THREE.Vector3(...sky.sun).normalize();
  sun.castShadow = prof.shadows;
  sun.shadow.mapSize.set(prof.shadowSize, prof.shadowSize);
  const R = prof.shadowRange; Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 500 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  root.add(sun, sun.target);
  if (sky.stars) {
    const N = 1500, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const v = new THREE.Vector3().randomDirection(); v.y = Math.abs(v.y) * 0.9 + 0.05; v.normalize().multiplyScalar(1200); pos.set([v.x, v.y, v.z], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const st = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, depthWrite: false }));
    root.add(st);
  }

  const colliders = [], meshes = [], coins = [];
  let spawn = new THREE.Vector3(0, 1, 0);
  if (place.baseplate) {
    const top = new THREE.MeshStandardMaterial({ color: 0x8e9299, map: tex('stud'), roughness: 0.8 });
    top.map = tex('stud').clone(); top.map.needsUpdate = true; top.map.repeat.set(128, 128);
    const side = new THREE.MeshStandardMaterial({ color: 0x777b83, roughness: 0.9 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(512, 4, 512), [side, side, top, side, side, side]);
    base.position.y = -2; base.receiveShadow = true; root.add(base); meshes.push(base);
    base.userData.part = { k: 'base' };
    colliders.push({ min: new THREE.Vector3(-256, -4, -256), max: new THREE.Vector3(256, 0, 256), mesh: base, part: base.userData.part });
  }
  const addPart = (p) => {
    const m = makePartMesh(p); root.add(m);
    if (p.k === 'coin') { coins.push({ m, p, home: m.position.clone(), taken: 0 }); return m; }
    meshes.push(m);
    const hw = p.s[0] / 2, hh = p.s[1] / 2, hd = p.s[2] / 2;
    const c = { min: new THREE.Vector3(p.p[0] - hw, p.p[1] - hh, p.p[2] - hd), max: new THREE.Vector3(p.p[0] + hw, p.p[1] + hh, p.p[2] + hd), mesh: m, part: p };
    colliders.push(c); m.userData.col = c;
    return m;
  };
  const removeMesh = (m) => {
    const i = meshes.indexOf(m); if (i >= 0) meshes.splice(i, 1);
    const j = colliders.indexOf(m.userData.col); if (j >= 0) colliders.splice(j, 1);
    root.remove(m); if (!m.geometry.userData.shared) m.geometry.dispose();
  };
  let firstSpawn = null;
  (place.parts || []).forEach(p => { addPart(p); if (p.k === 'spawn' && !firstSpawn) firstSpawn = p; });
  if (firstSpawn) spawn = new THREE.Vector3(firstSpawn.p[0], firstSpawn.p[1] + firstSpawn.s[1] / 2 + 0.05, firstSpawn.p[2]);

  // 구름
  const clouds = new THREE.Group(); root.add(clouds);
  if (place.sky !== 'night') {
    const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.25, transparent: true, opacity: 0.95, fog: false });
    const n = prof.lv >= 6 ? 28 : 14;
    for (let i = 0; i < n; i++) {
      const c = new THREE.Group(), k = 3 + (Math.random() * 4 | 0);
      for (let j = 0; j < k; j++) { const b = new THREE.Mesh(new THREE.SphereGeometry(8 + Math.random() * 8, 14, 10), cm); b.scale.y = 0.55; b.position.set(j * 12 - k * 6, Math.random() * 4, Math.random() * 12 - 6); c.add(b); }
      c.position.set(Math.random() * 1000 - 500, 120 + Math.random() * 70, Math.random() * 1000 - 500); clouds.add(c);
    }
  }

  return {
    root, colliders, meshes, coins, spawn, sun, sunDir, addPart, removeMesh,
    follow(target) { sun.position.copy(target).addScaledVector(sunDir, 200); sun.target.position.copy(target); skyMesh.position.copy(target); },
    update(dt, t) {
      clouds.children.forEach(c => { c.position.x += dt * 2.5; if (c.position.x > 500) c.position.x = -500; });
      coins.forEach(c => { c.m.rotation.y = t * 2.5; c.m.position.y = c.home.y + Math.sin(t * 2) * 0.2; if (c.taken && t > c.taken) { c.taken = 0; c.m.visible = true; } });
    },
    dispose() { scene.remove(root); disposeTree(root); scene.environment?.dispose(); scene.environment = null; },
  };
}
