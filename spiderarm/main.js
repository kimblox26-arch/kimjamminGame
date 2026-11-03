// SPIDER ARMS — 로블록스 스타일 캐릭터 + 늘어나는 기계 거미팔 + 장애물 코스
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const rand = (a, b) => a + Math.random() * (b - a);
const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ───────────────────────── 렌더러 ─────────────────────────
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe6ff, 220, 750);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1500);
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

// ───────────────────────── 하늘 / 구름 / 빛 ─────────────────────────
const SUN_DIR = V(0.4, 0.8, -0.45).normalize();
function makeSky(r) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { sun: { value: SUN_DIR } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec3 vP; uniform vec3 sun;
      void main(){ float h = max(vP.y, 0.);
        vec3 c = mix(vec3(0.75,0.88,1.0), vec3(0.12,0.38,0.92), pow(smoothstep(0.,0.55,h), 0.7));
        float s = max(dot(vP, sun), 0.);
        c += vec3(1.,0.95,0.8)*(pow(s,30.)*0.4 + smoothstep(0.998,0.999,s)*2.);
        gl_FragColor = vec4(c,1.); }`
  }));
}
scene.add(makeSky(900));
{
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene();
  es.add(makeSky(50));
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({ color: 0x888888 }));
  fl.rotation.x = -Math.PI / 2; fl.position.y = -2; es.add(fl);
  scene.environment = pm.fromScene(es, 0.03).texture;
}
{ // 뭉게구름
  const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xc8dcff, emissiveIntensity: 0.35, fog: false });
  const sg = new THREE.SphereGeometry(1, 14, 10);
  for (let i = 0; i < 26; i++) {
    const g = new THREE.Group(), a = rand(0, Math.PI * 2), d = rand(250, 520);
    g.position.set(Math.cos(a) * d, rand(90, 190), Math.sin(a) * d + 120);
    for (let k = 0; k < 7; k++) { const m = new THREE.Mesh(sg, cm); m.position.set(rand(-22, 22), rand(-3, 5), rand(-8, 8)); m.scale.setScalar(rand(9, 17)).multiply(V(1.3, 0.7, 1)); g.add(m); }
    scene.add(g);
  }
}
scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x9a8a70, 0.8));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.3);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

// ───────────────────────── 스터드 텍스처 / 재질 ─────────────────────────
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
const studTex = canvasTex(64, 64, (g, w) => {
  g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, w, w);
  g.fillStyle = '#c4c4c4'; g.beginPath(); g.arc(34, 34, 17, 0, 7); g.fill();
  g.fillStyle = '#f7f7f7'; g.beginPath(); g.arc(30, 30, 16, 0, 7); g.fill();
  g.fillStyle = '#ececec'; g.beginPath(); g.arc(32, 32, 13, 0, 7); g.fill();
  g.strokeStyle = '#d2d2d2'; g.lineWidth = 2; g.strokeRect(0, 0, w, w);
});
const matCache = {};
const studMat = c => matCache[c] || (matCache[c] = new THREE.MeshStandardMaterial({ color: c, map: studTex, roughness: 0.75 }));
function boxGeo(w, h, d, tile = 1.5) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
  return g;
}
const M = {
  skin: new THREE.MeshStandardMaterial({ color: 0xf5cd30, roughness: 0.5 }),
  shirt: new THREE.MeshStandardMaterial({ color: 0x0d69ac, roughness: 0.55 }),
  pants: new THREE.MeshStandardMaterial({ color: 0xa4bd47, roughness: 0.55 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1b1e24, metalness: 0.6, roughness: 0.4 }),
  arm: new THREE.MeshStandardMaterial({ color: 0x4a525e, metalness: 0.9, roughness: 0.3 }),
  hex: new THREE.MeshStandardMaterial({ color: 0x272c34, metalness: 0.9, roughness: 0.3, flatShading: true }),
  steel: new THREE.MeshStandardMaterial({ color: 0x9aa3b0, metalness: 1, roughness: 0.22, flatShading: true }),
  legGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3b1f).multiplyScalar(1.6), toneMapped: false }),
  band: new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.9, roughness: 0.2 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 1, roughness: 0.15 }),
  glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x46f0ff).multiplyScalar(1.4), toneMapped: false }),
};
const shadowAll = o => o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });

// ───────────────────────── 월드: 장애물 코스 ─────────────────────────
const solids = []; // {mn,mx,mesh?,dx,dz}
function addBox(x, z, w, d, h, color, y0 = 0) {
  const m = new THREE.Mesh(boxGeo(w, h, d), studMat(color));
  m.position.set(x, y0 + h / 2, z); m.castShadow = m.receiveShadow = true; scene.add(m);
  const s = { mn: [x - w / 2, y0, z - d / 2], mx: [x + w / 2, y0 + h, z + d / 2], mesh: m, w, d, h, dx: 0, dz: 0 };
  solids.push(s); return s;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), studMat(0xf4f1ea));
ground.geometry.attributes.uv.array.forEach((_, i, a) => { a[i] *= 1500; });
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const SAND = 0xe9b46e, SAND2 = 0xd99a52, ICE = 0x9fd8f2, GREEN = 0x5fd35f;
const LEN = 246;
addBox(-17, LEN / 2 - 6, 2, LEN, 30, SAND2); addBox(17, LEN / 2 - 6, 2, LEN, 30, SAND2); addBox(0, -7, 36, 2, 30, SAND2);
addBox(0, 4, 32, 18, 0.4, GREEN);                       // 시작 패드
addBox(0, 26, 32, 4, 10, SAND);                          // 벽 1
const lava = [];
function addLava(z0, z1) {
  const tex = canvasTex(128, 128, (g, w) => {
    g.fillStyle = '#ff5a14'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 60; i++) { g.fillStyle = Math.random() < 0.5 ? '#ffb02e' : '#e8300c'; g.beginPath(); g.arc(rand(0, w), rand(0, w), rand(4, 14), 0, 7); g.fill(); }
  });
  tex.repeat.set(4, (z1 - z0) / 8);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(32, z1 - z0), new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff }));
  m.rotation.x = -Math.PI / 2; m.position.set(0, 0.05, (z0 + z1) / 2); scene.add(m);
  lava.push({ z0, z1, tex });
}
addLava(30, 62);
[[0, 36], [6, 42], [-4, 48], [3, 54], [-2, 59]].forEach(([x, z]) => addBox(x, z, 4, 4, 3, ICE));
const checkpoints = [{ z: 4, y: 0.4 }];
function addPad(z0, z1, h) { addBox(0, (z0 + z1) / 2, 32, z1 - z0, h, GREEN); checkpoints.push({ z: (z0 + z1) / 2, y: h, z0 }); }
addPad(62, 72, 3);
addLava(72, 110);
const movers = [82, 92, 102].map((z, i) => ({ s: addBox(0, z, 6, 6, 3, 0xa66bff), z, ph: i * 2.1 }));
addPad(110, 120, 3);
// 굴러오는 바위 구간 (120~172), 회전 막대 (184)
const spinner = new THREE.Group(); spinner.position.set(0, 0, 184); scene.add(spinner);
addBox(0, 184, 2.4, 2.4, 3.2, 0x555b66);
{
  const bar = new THREE.Mesh(boxGeo(30, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff3b3b, map: studTex, roughness: 0.5 }));
  bar.position.y = 1.6; bar.castShadow = true; spinner.add(bar);
}
// 협곡 (기어오르기) + 정상
addBox(-10, 214, 12, 32, 34, ICE); addBox(10, 214, 12, 32, 34, ICE);
addBox(0, 236, 32, 12, 34, ICE);
const goalZ = 236, goalY = 34;
{
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.4, 40), new THREE.MeshStandardMaterial({ color: 0xffd400, metalness: 0.6, roughness: 0.3 }));
  pad.position.set(0, goalY + 0.2, goalZ); pad.receiveShadow = true; scene.add(pad);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 9), M.chrome); pole.position.set(3, goalY + 4.5, goalZ + 2); scene.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.5), new THREE.MeshStandardMaterial({ color: 0x2ecc40, side: THREE.DoubleSide }));
  flag.position.set(5, goalY + 7.6, goalZ + 2); scene.add(flag);
}
// 바위
const boulders = [];
const rockGeo = new THREE.IcosahedronGeometry(1, 1);
const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9, flatShading: true, map: studTex });
function spawnBoulder() {
  const r = rand(2.2, 3.4), m = new THREE.Mesh(rockGeo, rockMat); m.scale.setScalar(r); m.castShadow = true; scene.add(m);
  const b = { m, r, p: V(rand(-13, 13), r, 172), vz: -rand(13, 21), alive: true }; m.position.copy(b.p); boulders.push(b);
}
const WORLD_MIN = V(-60, 0, -40), WORLD_MAX = V(60, 0, 300);

// 해석적 레이캐스트 (박스 + 지면)
const _O = [0, 0, 0], _D = [0, 0, 0];
function raycast(o, d, maxD) {
  let best = maxD, nrm = null;
  _O[0] = o.x; _O[1] = o.y; _O[2] = o.z; _D[0] = d.x; _D[1] = d.y; _D[2] = d.z;
  if (d.y < -1e-6) { const t = -o.y / d.y; if (t >= 0 && t < best) { best = t; nrm = [1, 1]; } }
  for (const b of solids) {
    let tmin = -Infinity, tmax = Infinity, ax = -1, sg = 0, miss = false;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(_D[i]) < 1e-9) { if (_O[i] < b.mn[i] || _O[i] > b.mx[i]) { miss = true; break; } continue; }
      let t1 = (b.mn[i] - _O[i]) / _D[i], t2 = (b.mx[i] - _O[i]) / _D[i], s = -1;
      if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
      if (t1 > tmin) { tmin = t1; ax = i; sg = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) { miss = true; break; }
    }
    if (!miss && ax >= 0 && tmin >= 0 && tmin < best) { best = tmin; nrm = [ax, sg]; }
  }
  if (!nrm) return null;
  const n = V(); n.setComponent(nrm[0], nrm[1]);
  return { point: o.clone().addScaledVector(d, best), normal: n, dist: best };
}

// ───────────────────────── 로블록스 캐릭터 (R6) ─────────────────────────
function roundedBox(w, h, d, r = 0.12) {
  const s = new THREE.Shape(), x = -w / 2 + r, y = -h / 2 + r, ww = w - 2 * r, hh = h - 2 * r;
  s.moveTo(x, y); s.lineTo(x + ww, y); s.lineTo(x + ww, y + hh); s.lineTo(x, y + hh); s.lineTo(x, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r, bevelEnabled: true, bevelSize: r, bevelThickness: r, bevelSegments: 4, curveSegments: 4 });
  g.translate(0, 0, -(d - 2 * r) / 2); g.computeVertexNormals(); return g;
}
function drawFace(pain) {
  const t = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#f5cd30'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#111'; g.strokeStyle = '#111'; g.lineCap = 'round'; g.lineJoin = 'round';
    const cx = w / 2;
    if (!pain) {
      [-48, 48].forEach(dx => { g.beginPath(); g.ellipse(cx + dx, h * 0.38, 13, 26, 0, 0, Math.PI * 2); g.fill(); });
      g.lineWidth = 11; g.beginPath(); g.arc(cx, h * 0.42, 78, Math.PI * 0.2, Math.PI * 0.8); g.stroke();
      return;
    }
    // 고통: 질끈 감은 눈 > <, 찌푸린 눈썹, 비명 지르는 입, 식은땀
    g.lineWidth = 10;
    g.beginPath(); g.moveTo(cx - 78, h * 0.27); g.lineTo(cx - 36, h * 0.38); g.lineTo(cx - 78, h * 0.49); g.stroke();
    g.beginPath(); g.moveTo(cx + 78, h * 0.27); g.lineTo(cx + 36, h * 0.38); g.lineTo(cx + 78, h * 0.49); g.stroke();
    g.lineWidth = 9;
    g.beginPath(); g.moveTo(cx - 88, h * 0.13); g.lineTo(cx - 30, h * 0.24); g.stroke();
    g.beginPath(); g.moveTo(cx + 88, h * 0.13); g.lineTo(cx + 30, h * 0.24); g.stroke();
    g.beginPath(); g.ellipse(cx, h * 0.72, 46, 40, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.fillRect(cx - 26, h * 0.72 - 31, 52, 10);
    g.fillStyle = '#d4384a'; g.beginPath(); g.ellipse(cx, h * 0.72 + 22, 24, 11, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7fd4ff';
    [[cx - 125, h * 0.22], [cx + 120, h * 0.34], [cx - 112, h * 0.55]].forEach(([x, y]) => {
      g.beginPath(); g.moveTo(x, y - 18); g.quadraticCurveTo(x + 12, y + 4, x, y + 10); g.quadraticCurveTo(x - 12, y + 4, x, y - 18); g.fill();
    });
  });
  t.wrapS = THREE.ClampToEdgeWrapping; return t;
}
function buildCharacter() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const torso = new THREE.Mesh(roundedBox(2, 2, 1, 0.1), M.shirt); torso.position.y = 3; body.add(torso);
  const prof = [new THREE.Vector2(0, -0.6)];
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI / 2; prof.push(new THREE.Vector2(0.5 + Math.cos(a) * 0.14, -0.46 + Math.sin(a) * 0.14)); }
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; prof.push(new THREE.Vector2(0.5 + Math.cos(a) * 0.14, 0.46 + Math.sin(a) * 0.14)); }
  prof.push(new THREE.Vector2(0, 0.6));
  const faceN = drawFace(false), faceP = drawFace(true);
  const headMat = new THREE.MeshStandardMaterial({ map: faceN, roughness: 0.5 });
  const hg = new THREE.LatheGeometry(prof, 40, Math.PI), hp = hg.attributes.position, hu = hg.attributes.uv;
  for (let i = 0; i < hu.count; i++) hu.setY(i, (hp.getY(i) + 0.6) / 1.2); // 얼굴이 옆면(정면)에 오도록 높이 기준 UV
  const head = new THREE.Mesh(hg, headMat);
  head.position.y = 4.62; body.add(head);
  const limb = (mat, px, py, oy) => {
    const p = new THREE.Group(); p.position.set(px, py, 0);
    const m = new THREE.Mesh(roundedBox(1, 2, 1, 0.1), mat); m.position.y = oy; p.add(m); body.add(p); return p;
  };
  const armL = limb(M.skin, 1.5, 3.6, -0.6), armR = limb(M.skin, -1.5, 3.6, -0.6);
  const legL = limb(M.pants, 0.5, 2, -1), legR = limb(M.pants, -0.5, 2, -1);
  // 각성 후 등에 돋아나는 코어
  const pack = new THREE.Group(); pack.position.set(0, 3.15, -0.85); body.add(pack);
  pack.add(new THREE.Mesh(roundedBox(1.9, 2.2, 0.8, 0.22), M.band));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.1, 10, 32), M.arm); ring.position.z = -0.42; pack.add(ring);
  const core = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), M.glow); core.position.z = -0.43; core.rotation.y = Math.PI; pack.add(core);
  for (let i = 0; i < 3; i++) {
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.8, 6), M.chrome);
    sp.position.set(0, 1.25 - i * 0.05, -0.3 - i * 0.25); sp.rotation.x = -0.5 - i * 0.2; pack.add(sp);
  }
  pack.visible = false; pack.scale.setScalar(0.001);
  const backGlow = new THREE.PointLight(0xff2a2a, 0, 16, 2); backGlow.position.set(0, 3.2, -1.7); body.add(backGlow);
  shadowAll(root);
  return { root, body, head, armL, armR, legL, legR, pack, headMat, faceN, faceP, backGlow };
}

// ───────────────────────── 8개의 기계 거미다리 ─────────────────────────
const SEG = 30, REACH = 15, NLEG = 8, BAND_EVERY = 3, NB = Math.floor((SEG - 2) / BAND_EVERY) + 1;
const mkInst = (geo, mat, n, shadow = true) => { const m = new THREE.InstancedMesh(geo, mat, n); m.castShadow = shadow; m.frustumCulled = false; scene.add(m); return m; };
const finGeo = (() => {
  const s = new THREE.Shape(); s.moveTo(-0.42, 0.22); s.lineTo(0.38, 0.22); s.lineTo(0.2, 0.98); s.lineTo(0.02, 0.98); s.lineTo(-0.42, 0.22);
  return new THREE.ExtrudeGeometry(s, { depth: 0.09, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(-0.045, 0, 0);
})();
const coreInst = mkInst(new THREE.CylinderGeometry(0.33, 0.27, 1, 6), M.hex, SEG * NLEG);           // 육각 척추
const hoseInst = mkInst(new THREE.CylinderGeometry(0.055, 0.055, 1, 6), M.chrome, SEG * 2 * NLEG);  // 유압 호스
const collarInst = mkInst(new THREE.CylinderGeometry(0.43, 0.43, 0.24, 6), M.steel, NB * NLEG);     // 강철 마디
const glowInst = mkInst(new THREE.TorusGeometry(0.35, 0.045, 6, 18).rotateX(Math.PI / 2), M.legGlow, NB * NLEG, false);
const finInst = mkInst(finGeo, M.steel, NB * NLEG);                                                   // 장갑 지느러미
const LEG_INST = [coreInst, hoseInst, collarInst, glowInst, finInst];
function makeClaw() {
  const g = new THREE.Group();
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); g.add(m); return m; };
  add(new THREE.CylinderGeometry(0.34, 0.48, 0.75, 6).rotateX(Math.PI / 2).translate(0, 0, 0.37), M.hex);
  add(new THREE.CylinderGeometry(0.5, 0.5, 0.18, 6).rotateX(Math.PI / 2).translate(0, 0, 0.1), M.steel);
  const eye = add(new THREE.SphereGeometry(0.2, 12, 10), M.legGlow); eye.position.z = 0.75;
  g.userData.prongs = [];
  for (let k = 0; k < 3; k++) {
    const piv = new THREE.Group(); piv.position.z = 0.65; piv.rotation.z = k * Math.PI * 2 / 3; g.add(piv);
    const f = new THREE.Group(); f.position.y = 0.3; piv.add(f);
    f.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.95).translate(0, 0, 0.47), M.hex));
    f.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6).rotateX(Math.PI / 2).translate(0, -0.13, 0.4), M.chrome));
    const j = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.28, 8).rotateZ(Math.PI / 2), M.steel); j.position.z = 0.95; f.add(j);
    const tip = new THREE.Group(); tip.position.z = 0.95; tip.rotation.x = 1.0; f.add(tip);
    tip.add(new THREE.Mesh(new THREE.ConeGeometry(0.15, 1.05, 4).rotateX(Math.PI / 2).translate(0, 0, 0.52).scale(0.45, 1, 1), M.chrome));
    g.userData.prongs.push(f);
  }
  shadowAll(g); scene.add(g); return g;
}
function makeSocket() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.5, 6).rotateX(Math.PI / 2), M.steel));
  const r = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 6, 18), M.legGlow); r.position.z = -0.26; g.add(r);
  shadowAll(g); scene.add(g); return g;
}
const ROOTS = [[0.5, 4.05, -1.25], [0.75, 3.55, -1.35], [0.75, 3.0, -1.35], [0.5, 2.5, -1.25]];
const HOMES = [[5.0, 5.8], [6.6, 2.3], [6.6, -1.3], [5.2, -4.8]];
function makeArm(side, k) {
  const [rx, ry, rz] = ROOTS[k], [hx, hz] = HOMES[k];
  return {
    side, k, gait: (k + (side > 0 ? 0 : 1)) % 2, ph: Math.random() * 10,
    root: V(side * rx, ry, rz), home: V(side * hx, 0, hz),
    tip: V(), n: UP.clone(), anchor: null, step: null, strike: null, claw: makeClaw(), grip: 0, grow: 0, growT: 0, growD: 0, socket: makeSocket(),
  };
}
const _m = new THREE.Matrix4(), _s = V(), _a = V(), _c = V(), _x = V(), _y = V(), _z = V(), _ny = V(), _p = V();
const pts = Array.from({ length: SEG + 1 }, () => V());
function bez(p0, p1, p2, p3, t, out) {
  const u = 1 - t;
  return out.set(0, 0, 0).addScaledVector(p0, u * u * u).addScaledVector(p1, 3 * u * u * t).addScaledVector(p2, 3 * u * t * t).addScaledVector(p3, t * t * t);
}
function setInst(inst, i, bx, by, bz, pos, sx, sy, sz) {
  _m.makeBasis(bx, by, bz); _m.scale(_s.set(sx, sy, sz)); _m.setPosition(pos); inst.setMatrixAt(i, _m);
}
function drawArm(A, idx, rootW, t) {
  const g = A.grow, gs = clamp(g, 0.001, 1);
  const sideW = V(A.side, 0, 0).applyQuaternion(char.root.quaternion);
  const backW = V(0, 0, -1).applyQuaternion(char.root.quaternion);
  const outUp = V().copy(sideW).add(UP).normalize();
  const tipD = rootW.clone().lerp(A.tip, g);
  const d = rootW.distanceTo(tipD);
  const loose = A.anchor || A.strike ? 0.25 : 1;
  const w = V(Math.sin(t * 2.3 + A.ph), Math.sin(t * 1.7 + A.ph) * 0.6, Math.cos(t * 2.0 + A.ph)).multiplyScalar(0.45 * loose);
  const rise = (1 - Math.min(1, g)) * 4; // 돋아날 때 위로 솟구침
  const p1 = rootW.clone().addScaledVector(UP, 2.2 + d * 0.28 + rise).addScaledVector(sideW, 1 + d * 0.15).addScaledVector(backW, 0.8 + rise * 0.3).add(w);
  const p2 = tipD.clone().addScaledVector(A.n, (1.5 + d * 0.3) * gs).sub(w);
  const dir = _a.subVectors(tipD, p2).normalize().clone();
  const clawBase = tipD.clone().addScaledVector(dir, -1.8 * gs);
  for (let i = 0; i <= SEG; i++) bez(rootW, p1, p2, clawBase, i / SEG, pts[i]);
  const th0 = clamp(g * 1.4, 0.001, 1);
  for (let i = 0; i < SEG; i++) {
    const a = pts[i], b = pts[i + 1];
    _z.subVectors(b, a); const len = _z.length() || 0.001; _z.divideScalar(len);
    _y.copy(outUp).addScaledVector(_z, -_z.dot(outUp)); if (_y.lengthSq() < 1e-4) _y.copy(sideW); _y.normalize();
    _x.crossVectors(_y, _z); _ny.copy(_y).negate();
    const th = th0 * (1.05 - (i / SEG) * 0.35);
    _p.addVectors(a, b).multiplyScalar(0.5);
    setInst(coreInst, idx * SEG + i, _x, _z, _ny, _p, th, len * 1.15, th);
    for (const s of [-1, 1]) setInst(hoseInst, (idx * SEG + i) * 2 + (s > 0 ? 1 : 0), _x, _z, _ny, _c.copy(_p).addScaledVector(_x, s * 0.33 * th).addScaledVector(_y, -0.1 * th), th, len * 1.15, th);
    if (i % BAND_EVERY === 1) {
      const bi = idx * NB + (i - 1) / BAND_EVERY;
      setInst(collarInst, bi, _x, _z, _ny, a, th, th, th);
      setInst(glowInst, bi, _x, _z, _ny, _c.copy(a).addScaledVector(_z, 0.18 * th), th, th, th);
      const sp = th * (1.1 - (i / SEG) * 0.5);
      setInst(finInst, bi, _x, _y, _z, a, sp, sp, sp);
    }
  }
  A.socket.position.copy(rootW); A.socket.quaternion.copy(char.root.quaternion); A.socket.scale.setScalar(gs);
  A.claw.position.copy(clawBase); A.claw.lookAt(_c.copy(clawBase).add(dir)); A.claw.scale.setScalar(gs);
  const open = A.strike ? (A.strike.hit ? 0 : 0.95) : A.anchor ? 0.05 : A.step ? 0.8 : 0.5;
  A.grip += (open - A.grip) * 0.3;
  A.claw.userData.prongs.forEach(f => f.rotation.x = -A.grip);
}

// ───────────────────────── 플레이어 ─────────────────────────
const char = buildCharacter(); scene.add(char.root);
const arms = [];
for (let k = 0; k < 4; k++) for (const s of [1, -1]) arms.push(makeArm(s, k));
const R = 1.1, GRAV = 62;
const P = { pos: V(0, 0.4, 4), vel: V(), yaw: 0, onGround: true, walkPhase: 0, climbing: false, wallN: null, gs: null, cp: 0, noGrab: 0, finished: false, awake: false, awakenT: -1 };
function setLegsVisible(v) {
  LEG_INST.forEach(m => m.visible = v);
  arms.forEach(A => { A.claw.visible = v; A.socket.visible = v; });
}
setLegsVisible(false);

// ───────────────────────── 입력 ─────────────────────────
const keys = {}; let locked = false, started = false;
let camYaw = Math.PI, camPitch = 0.32, camDist = 20;
const touch = { mx: 0, my: 0, run: false, jump: false };
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'KeyE') startAwaken(); if (e.code === 'KeyF') attack(); });
addEventListener('keyup', e => { keys[e.code] = false; });
function lockPointer() { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
let dragStart = null; // 포인터락이 안 되는 환경(임베드)에서는 드래그로 카메라 회전
canvas.addEventListener('mousedown', e => {
  if (!started || TOUCH) return;
  if (locked) { if (e.button === 0) attack(); return; }
  dragStart = { moved: 0 }; lockPointer();
});
addEventListener('mouseup', e => { if (dragStart && dragStart.moved < 6 && e.button === 0 && !locked) attack(); dragStart = null; });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
addEventListener('mousemove', e => {
  if (!locked) { if (!dragStart) return; dragStart.moved += Math.abs(e.movementX) + Math.abs(e.movementY); }
  camYaw -= e.movementX * 0.0025; camPitch = clamp(camPitch + e.movementY * 0.0022, -0.5, 1.35);
});
addEventListener('wheel', e => { camDist = clamp(camDist + Math.sign(e.deltaY) * 1.5, 9, 40); });
if (TOUCH) {
  document.body.classList.add('touch');
  const stick = document.getElementById('stick'), knob = document.getElementById('knob');
  let stickId = null, camId = null, cx = 0, cy = 0, lx = 0, ly = 0, pinch = null;
  const RAD = 55;
  const tdist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  addEventListener('touchstart', e => {
    if (!started) return;
    for (const t of e.changedTouches) {
      if (t.target.closest && t.target.closest('#jumpBtn, #awakenBtn, #attackBtn')) continue;
      if (t.clientX < innerWidth * 0.45 && stickId === null) {
        stickId = t.identifier; cx = t.clientX; cy = t.clientY;
        stick.style.left = cx + 'px'; stick.style.top = cy + 'px'; stick.classList.add('on');
      } else if (camId === null) { camId = t.identifier; lx = t.clientX; ly = t.clientY; }
    }
    if (e.touches.length === 2 && stickId === null) pinch = tdist(e);
  }, { passive: false });
  addEventListener('touchmove', e => {
    e.preventDefault();
    if (pinch !== null && e.touches.length === 2) { const d = tdist(e); camDist = clamp(camDist * pinch / d, 9, 40); pinch = d; return; }
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        let dx = t.clientX - cx, dy = t.clientY - cy; const l = Math.hypot(dx, dy);
        if (l > RAD) { dx *= RAD / l; dy *= RAD / l; }
        knob.style.transform = `translate(${dx}px,${dy}px)`;
        touch.mx = dx / RAD; touch.my = -dy / RAD; touch.run = l > RAD * 0.95;
      } else if (t.identifier === camId) {
        camYaw -= (t.clientX - lx) * 0.006; camPitch = clamp(camPitch + (t.clientY - ly) * 0.005, -0.5, 1.35);
        lx = t.clientX; ly = t.clientY;
      }
    }
  }, { passive: false });
  const end = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { stickId = null; touch.mx = touch.my = 0; touch.run = false; knob.style.transform = ''; stick.classList.remove('on'); }
      if (t.identifier === camId) camId = null;
    }
    if (e.touches.length < 2) pinch = null;
  };
  addEventListener('touchend', end); addEventListener('touchcancel', end);
  const jb = document.getElementById('jumpBtn');
  jb.addEventListener('touchstart', e => { e.preventDefault(); touch.jump = true; }, { passive: false });
  jb.addEventListener('touchend', e => { e.preventDefault(); touch.jump = false; });
}

// ───────────────────────── 사운드 ─────────────────────────
let AC = null;
function tone(f0, f1, dur, vol, type = 'square') {
  if (!AC) return;
  const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
  o.connect(g); g.connect(AC.destination); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.start(t); o.stop(t + dur + 0.02);
}
const clank = () => tone(160, 60, 0.07, 0.03);
function noise(dur, vol, freq = 800) {
  if (!AC) return;
  const n = Math.floor(AC.sampleRate * dur), buf = AC.createBuffer(1, n, AC.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = buf; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(AC.destination); s.start();
}
function scream(dur, f0, vol) { // 떨리는 비명 (합성)
  if (!AC) return;
  const t = AC.currentTime, f = AC.createBiquadFilter(), g = AC.createGain(), lfo = AC.createOscillator(), lg = AC.createGain();
  f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 1.8; f.connect(g); g.connect(AC.destination);
  lfo.frequency.value = 11; lg.gain.value = f0 * 0.08; lfo.connect(lg);
  const oscs = [['sawtooth', 1], ['square', 1.012]].map(([type, m]) => {
    const o = AC.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0 * m, t); o.frequency.linearRampToValueAtTime(f0 * 1.6 * m, t + dur * 0.35); o.frequency.linearRampToValueAtTime(f0 * 0.7 * m, t + dur);
    lg.connect(o.frequency); o.connect(f); return o;
  });
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.12);
  g.gain.setValueAtTime(vol, t + dur * 0.75); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  [...oscs, lfo].forEach(o => { o.start(t); o.stop(t + dur + 0.05); });
}

// ───────────────────────── 이펙트 ─────────────────────────
const parts = [];
const partGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
const partMats = [0x46f0ff, 0xffd21a, 0xff3a2a, 0xffffff, 0x6b5038].map(c => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.4), toneMapped: false }));
for (let i = 0; i < 260; i++) { const m = new THREE.Mesh(partGeo, partMats[0]); m.visible = false; scene.add(m); parts.push({ m, v: V(), life: 0, max: 1 }); }
let partIdx = 0;
function burst(pos, n, speed, mats, life = 0.8) {
  for (let i = 0; i < n; i++) {
    const p = parts[partIdx++ % parts.length];
    p.m.material = partMats[mats[i % mats.length]]; p.m.position.copy(pos); p.m.visible = true;
    p.v.set(rand(-1, 1), rand(-0.2, 1.3), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.4, 1));
    p.life = p.max = life * rand(0.6, 1.2);
  }
}
const shock = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.3, 48), new THREE.MeshBasicMaterial({ color: 0xbff8ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
shock.rotation.x = -Math.PI / 2; scene.add(shock);
let shockT = -1;
function updateFx(dt) {
  for (const p of parts) {
    if (!p.m.visible) continue;
    p.life -= dt; if (p.life <= 0) { p.m.visible = false; continue; }
    p.v.y -= 25 * dt; p.m.position.addScaledVector(p.v, dt);
    p.m.scale.setScalar(p.life / p.max); p.m.rotation.x += dt * 9; p.m.rotation.y += dt * 7;
  }
  if (shockT >= 0) {
    shockT += dt; const s = 1 + shockT * 45; shock.scale.set(s, s, 1);
    shock.material.opacity = Math.max(0, 0.85 - shockT * 1.3);
    if (shockT > 0.7) shockT = -1;
  }
}

// ───────────────────────── 각성 ─────────────────────────
const AW = { BURST: 2.0, END: 3.8 };
const painEl = document.getElementById('pain'), awakenBtn = document.getElementById('awakenBtn'), attackBtn = document.getElementById('attackBtn');
let shake = 0, beatT = 0;
const backPos = () => char.root.localToWorld(V(0, 3.2, -1.5));
function startAwaken() {
  if (!started || P.awake || P.awakenT >= 0 || P.finished) return;
  P.awakenT = 0; P.vel.x = P.vel.z = 0; P.climbing = false;
  char.headMat.map = char.faceP;
  char.backGlow.color.set(0xff2a2a);
  awakenBtn.classList.add('hidden');
  scream(1.9, 230, 0.1);
}
function updateAwaken(dt) {
  if (P.awakenT < 0) return;
  const t0 = P.awakenT; P.awakenT += dt; const t = P.awakenT;
  if (t < AW.BURST) { // 고통
    const k = t / AW.BURST;
    shake = 0.06 + k * 0.4;
    painEl.style.opacity = (0.3 + 0.5 * k) * (0.75 + 0.25 * Math.sin(t * 16));
    char.backGlow.intensity = k * k * 90;
    beatT -= dt; if (beatT <= 0) { tone(70, 38, 0.2, 0.3, 'sine'); beatT = 0.6 - k * 0.42; }
    if (Math.random() < 0.2 + k) burst(backPos(), 1 + (k > 0.6 ? 1 : 0), 5, [2, 3, 1], 0.45);
  }
  if (t0 < AW.BURST && t >= AW.BURST) { // 등에서 다리가 터져 나옴
    P.awake = true; setLegsVisible(true); char.pack.visible = true;
    char.backGlow.color.set(0x46f0ff);
    burst(backPos(), 110, 24, [0, 1, 2, 3], 1.0);
    noise(1.0, 0.6, 1000); tone(95, 30, 0.7, 0.35, 'sawtooth'); scream(1.4, 400, 0.15);
    shock.position.set(P.pos.x, P.pos.y + 0.15, P.pos.z); shockT = 0;
    fadeEl.style.opacity = 0.85; setTimeout(() => fadeEl.style.opacity = 0, 90);
    arms.forEach(A => {
      A.tip.copy(char.root.localToWorld(A.home.clone())).setY(P.pos.y);
      A.anchor = null; A.step = null; A.grow = 0; A.growT = 0; A.growD = (A.k * 2 + (A.side > 0 ? 0 : 1)) * 0.035;
    });
  }
  if (t >= AW.BURST) { // 회복
    const k = (t - AW.BURST) / (AW.END - AW.BURST);
    painEl.style.opacity = Math.max(0, 0.8 - k * 1.3);
    char.backGlow.intensity = Math.max(0, 120 * (1 - k * 1.8));
    shake = Math.max(0, 1.3 - k * 2.6);
    char.pack.scale.setScalar(Math.min(1, (t - AW.BURST) / 0.2));
    if (k > 0.6) char.headMat.map = char.faceN;
  }
  if (t >= AW.END) { P.awakenT = -1; shake = 0; painEl.style.opacity = 0; char.headMat.map = char.faceN; toast('각성 완료!'); attackBtn.classList.remove('hidden'); }
}

// ───────────────────────── UI ─────────────────────────
const toastEl = document.getElementById('toast'), fadeEl = document.getElementById('fade');
let toastT = null;
function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 1400); }
function respawn() {
  const c = checkpoints[P.cp];
  P.pos.set(0, c.y, c.z); P.vel.set(0, 0, 0); P.yaw = 0; P.onGround = true;
  arms.forEach(A => { A.anchor = null; A.step = null; });
  fadeEl.style.opacity = 1; setTimeout(() => fadeEl.style.opacity = 0, 150);
  tone(300, 80, 0.3, 0.08, 'sawtooth');
}

// ───────────────────────── 플레이어 물리 ─────────────────────────
function updatePlayer(dt) {
  const fwdC = V(-Math.sin(camYaw), 0, -Math.cos(camYaw)), rightC = V(Math.cos(camYaw), 0, -Math.sin(camYaw));
  const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + touch.my;
  const r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + touch.mx;
  const hurting = P.awakenT >= 0;
  const wish = hurting ? V() : V().addScaledVector(fwdC, f).addScaledVector(rightC, r);
  const mag = Math.min(1, wish.length()), moving = mag > 0.08;
  if (moving) wish.normalize().multiplyScalar(mag);
  const run = keys.ShiftLeft || keys.ShiftRight || touch.run;
  const jump = !hurting && (keys.Space || touch.jump), jumpPress = jump && !P.jumpHeld; P.jumpHeld = jump;
  P.noGrab -= dt;

  // 벽 잡기 판정: 이동 방향 앞 벽 / 팔이 잡은 곳
  const chest = P.pos.clone().add(V(0, 2.5, 0));
  const held = arms.filter(A => A.anchor).length;
  let wallAhead = null;
  if (moving) { const h = raycast(chest, wish.clone().normalize(), 4.5); if (h && Math.abs(h.normal.y) < 0.5) wallAhead = h; }
  if (P.awake && P.onGround && wallAhead && wallAhead.dist < 2.2 && P.noGrab <= 0) { P.climbing = true; P.onGround = false; P.vel.y = 6; }
  if (P.onGround || P.noGrab > 0) P.climbing = false;
  if (P.climbing && held === 0 && !arms.some(A => A.step)) P.climbing = false;

  if (P.climbing) {
    // 거미팔로 매달려 이동: 벽 쪽으로 누르면 위로 기어오름
    const tv = V();
    if (moving) {
      if (wallAhead) { tv.addScaledVector(UP, mag * (run ? 17 : 12)).addScaledVector(wish, 3); P.wallFace = wallAhead.normal.clone(); }
      else tv.addScaledVector(wish, run ? 16 : 11).addScaledVector(UP, 2);
    }
    P.vel.lerp(tv, damp(8, dt));
    if (jumpPress) { P.climbing = false; P.noGrab = 0.35; P.vel.y = 22; if (P.wallFace) P.vel.addScaledVector(P.wallFace, 14); }
  } else {
    const speed = run ? 28 : 16;
    const k = damp(P.onGround ? 12 : 2.5, dt);
    P.vel.x += (wish.x * speed - P.vel.x) * k;
    P.vel.z += (wish.z * speed - P.vel.z) * k;
    P.vel.y -= GRAV * dt;
    if (jumpPress && P.onGround) { P.vel.y = 25; P.onGround = false; tone(200, 400, 0.1, 0.05, 'triangle'); }
    // 공중에서 벽 근처면 팔로 붙기
    if (P.awake && !P.onGround && wallAhead && P.noGrab <= 0 && P.vel.y < 8) P.climbing = true;
  }

  // 이동 + 충돌
  const prevY = P.pos.y;
  P.pos.x += P.vel.x * dt; P.pos.z += P.vel.z * dt;
  P.pos.x = clamp(P.pos.x, WORLD_MIN.x, WORLD_MAX.x); P.pos.z = clamp(P.pos.z, WORLD_MIN.z, WORLD_MAX.z);
  P.wallN = null;
  for (const b of solids) {
    if (P.pos.y >= b.mx[1] - 0.6 || P.pos.y + 5 <= b.mn[1]) continue;
    const cx = clamp(P.pos.x, b.mn[0], b.mx[0]), cz = clamp(P.pos.z, b.mn[2], b.mx[2]);
    const dx = P.pos.x - cx, dz = P.pos.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= R * R) continue;
    let n;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); n = V(dx / d, 0, dz / d); P.pos.x = cx + n.x * R; P.pos.z = cz + n.z * R; }
    else {
      const pen = [P.pos.x - b.mn[0], b.mx[0] - P.pos.x, P.pos.z - b.mn[2], b.mx[2] - P.pos.z], i = pen.indexOf(Math.min(...pen));
      n = [V(-1, 0, 0), V(1, 0, 0), V(0, 0, -1), V(0, 0, 1)][i];
      if (i < 2) P.pos.x = (i ? b.mx[0] : b.mn[0]) + n.x * R; else P.pos.z = (i === 3 ? b.mx[2] : b.mn[2]) + n.z * R;
    }
    const vn = P.vel.dot(n); if (vn < 0) P.vel.addScaledVector(n, -vn);
    P.wallN = n;
    if (P.climbing && b.mx[1] - P.pos.y < 1.5 && moving) { P.vel.y = 14; P.vel.addScaledVector(n, -8); } // 꼭대기 넘어가기
  }
  P.pos.y += P.vel.y * dt;
  let gh = 0, gs = null;
  for (const b of solids) {
    const cx = clamp(P.pos.x, b.mn[0], b.mx[0]), cz = clamp(P.pos.z, b.mn[2], b.mx[2]);
    if ((P.pos.x - cx) ** 2 + (P.pos.z - cz) ** 2 > (R * 0.75) ** 2) continue;
    if (prevY >= b.mx[1] - 0.6 && b.mx[1] > gh) { gh = b.mx[1]; gs = b; }
  }
  const wasAir = !P.onGround;
  P.onGround = false; P.gs = null;
  if (P.pos.y <= gh && P.vel.y <= 0) {
    if (wasAir && P.vel.y < -30) tone(120, 40, 0.2, 0.08);
    P.pos.y = gh; P.vel.y = 0; P.onGround = true; P.climbing = false; P.gs = gs;
    if (gs) { P.pos.x += gs.dx; P.pos.z += gs.dz; }
  }
  // 용암
  if (P.onGround && !gs && lava.some(l => P.pos.z > l.z0 && P.pos.z < l.z1)) respawn();
  // 체크포인트 / 골
  for (let i = P.cp + 1; i < checkpoints.length; i++) {
    const c = checkpoints[i];
    if (P.onGround && P.pos.z > c.z0 && Math.abs(P.pos.y - c.y) < 0.1) { P.cp = i; toast('체크포인트!'); tone(500, 1000, 0.25, 0.06, 'sine'); }
  }
  if (!P.finished && P.onGround && P.pos.y >= goalY - 0.1 && Math.hypot(P.pos.x, P.pos.z - goalZ) < 4.2) finish();

  // 바위 / 회전 막대 충돌
  const c2 = P.pos.clone().add(V(0, 2.5, 0));
  for (const b of boulders) {
    const d = c2.distanceTo(b.p);
    if (d < b.r + 1.4) { const n = c2.clone().sub(b.p).setY(0).normalize(); n.z = Math.min(n.z, -0.5); n.normalize(); knock(n, 30); }
  }
  {
    const a = spinner.rotation.y, dir = V(Math.cos(a), 0, -Math.sin(a));
    const rel = V(P.pos.x - spinner.position.x, 0, P.pos.z - spinner.position.z);
    const along = rel.dot(dir), perp = rel.x * dir.z - rel.z * dir.x;
    if (Math.abs(along) < 15 && Math.abs(perp) < 1.5 && P.pos.y < 2.1) {
      const n = V(-dir.z, 0, dir.x).multiplyScalar(Math.sign(perp) || 1); knock(n.negate(), 26);
    }
  }

  // 회전
  const hv = Math.hypot(P.vel.x, P.vel.z);
  let ty = null;
  if (P.faceTo && atkCd > 0) ty = Math.atan2(P.faceTo.x - P.pos.x, P.faceTo.z - P.pos.z);
  else if (P.climbing && P.wallFace) ty = Math.atan2(-P.wallFace.x, -P.wallFace.z);
  else if (moving && hv > 1) ty = Math.atan2(P.vel.x, P.vel.z);
  if (ty !== null) { let dy = ty - P.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); P.yaw += dy * damp(P.faceTo && atkCd > 0 ? 22 : 10, dt); }
  if (!P.climbing) P.wallFace = null;
  char.root.position.copy(P.pos); char.root.rotation.y = P.yaw;
  char.root.updateMatrixWorld(true);
  animateCharacter(dt, hv);
}
function knock(n, s) {
  if (P.noGrab > 0.2) return;
  P.vel.copy(n).multiplyScalar(s).setY(16); P.onGround = false; P.climbing = false; P.noGrab = 0.5;
  arms.forEach(A => { A.anchor = null; A.step = null; });
  tone(150, 50, 0.25, 0.1, 'sawtooth');
}
function finish() {
  P.finished = true; toast('클리어!'); tone(523, 1046, 0.5, 0.08, 'sine');
  setTimeout(() => { document.getElementById('clear').classList.remove('hidden'); document.exitPointerLock(); }, 1200);
}

// ───────────────────────── 다리 공격 ─────────────────────────
let atkPair = 0, atkCd = 0;
function attack() {
  if (!started || !P.awake || P.awakenT >= 0 || atkCd > 0 || P.finished) return;
  atkCd = 0.3;
  const chest = P.pos.clone().add(V(0, 3, 0));
  let best = null, bd = 17;
  for (const b of boulders) { const d = b.p.distanceTo(chest) - b.r; if (d < bd) { bd = d; best = b; } }
  let target;
  if (best) { target = best.p.clone(); P.faceTo = best.p.clone(); }
  else {
    const camF = V(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const dir = camF.clone().add(V(0, -0.35, 0)).normalize();
    const h = raycast(chest, dir, 12);
    target = h ? h.point : chest.clone().addScaledVector(dir, 12);
    P.faceTo = chest.clone().add(camF);
  }
  const pair = arms.filter(A => A.k === atkPair && A.grow > 0.9);
  atkPair = 1 - atkPair;
  pair.forEach((A, j) => {
    const side = V(A.side, 0, 0).applyQuaternion(char.root.quaternion);
    A.strike = { t: -j * 0.15, from: A.tip.clone(), target: target.clone().addScaledVector(side, 0.5), boulder: best, hit: false, main: j === 0 };
    A.anchor = null; A.step = null;
  });
  tone(500, 140, 0.12, 0.05, 'sawtooth');
}
function strikeHit(s) {
  if (s.boulder && s.boulder.alive && s.boulder.p.distanceTo(s.target) < s.boulder.r + 2.5) smashBoulder(s.boulder);
  else if (s.main) { burst(s.target, 14, 10, [3, 1, 2], 0.4); noise(0.15, 0.3, 2500); tone(220, 60, 0.12, 0.08); }
  shake = Math.max(shake, 0.25);
}
function smashBoulder(b) {
  b.alive = false; scene.remove(b.m); boulders.splice(boulders.indexOf(b), 1);
  burst(b.p, 55, 16, [4, 4, 4, 1, 2], 0.9);
  noise(0.5, 0.6, 700); tone(110, 35, 0.4, 0.25, 'sawtooth');
  shake = Math.max(shake, 0.6);
}

// ───────────────────────── 캐릭터 애니메이션 ─────────────────────────
const anim = { aL: 0, aR: 0, lL: 0, lR: 0, azL: 0, azR: 0, lean: 0, bob: 0, hx: 0, t: 0 };
function animateCharacter(dt, hv) {
  anim.t += dt;
  let aL = 0, aR = 0, lL = 0, lR = 0, azL = 0.05, azR = -0.05, lean = 0, bob = 0, hx = 0, jit = 0;
  const at = P.awakenT;
  if (at >= 0) {
    if (at < AW.BURST) { // 몸을 웅크리고 가슴을 움켜쥠
      const k = Math.min(1, at / 0.35); jit = 0.03 + (at / AW.BURST) * 0.13;
      aL = aR = -1.35; azL = -0.85 * k; azR = 0.85 * k; lL = 0.35; lR = -0.2;
      lean = 0.32 * k + Math.sin(at * 9) * 0.06; bob = -0.15 * k; hx = -0.2;
    } else if (at < AW.BURST + 0.9) { // 등을 젖히며 비명
      aL = aR = -0.5; azL = 1.6; azR = -1.6; lean = -0.3; lL = 0.25; lR = -0.25; bob = 0.2; hx = -0.5; jit = 0.07;
    } else { aL = aR = -0.3; azL = 0.25; azR = -0.25; lean = 0.3; hx = 0.25; bob = -0.1; } // 숨 고르기
  } else if (P.climbing) {
    const s = Math.sin(anim.t * 9);
    aL = -2.6 + s * 0.4; aR = -2.6 - s * 0.4; lL = -0.4 - s * 0.4; lR = -0.4 + s * 0.4; lean = 0.1;
  } else if (!P.onGround) {
    aL = aR = -2.9; lL = 0.25; lR = -0.25; azL = 0.15; azR = -0.15;
  } else if (hv > 0.5) {
    P.walkPhase += dt * hv * 0.5;
    const amp = Math.min(1, hv / 16) * 0.95, s = Math.sin(P.walkPhase);
    lL = s * amp; lR = -s * amp; aL = -s * amp * 0.9; aR = s * amp * 0.9;
    lean = Math.min(hv / 28, 1) * 0.14; bob = Math.abs(Math.cos(P.walkPhase)) * 0.12 * amp;
  } else {
    const br = Math.sin(anim.t * 2); azL = 0.06 + br * 0.03; azR = -0.06 - br * 0.03; bob = br * 0.02;
  }
  if (at < 0 && atkCd > 0.05) { aR = -1.7; aL = -0.9; azL = 0.3; lean = 0.15; }
  const k = damp(at >= 0 ? 10 : 16, dt);
  for (const [key, v] of Object.entries({ aL, aR, lL, lR, azL, azR, lean, bob, hx })) anim[key] += (v - anim[key]) * k;
  const J = () => (Math.random() - 0.5) * 2 * jit;
  char.armL.rotation.set(anim.aL + J(), 0, anim.azL + J()); char.armR.rotation.set(anim.aR + J(), 0, anim.azR + J());
  char.legL.rotation.x = anim.lL; char.legR.rotation.x = anim.lR;
  char.body.rotation.set(anim.lean + J() * 0.5, 0, J());
  char.body.position.set(J() * 0.5, anim.bob, 0);
  char.head.rotation.set(anim.hx + J(), J() * 1.5, J() * 1.5);
}

// ───────────────────────── 거미다리: 잡고 · 놓고 · 뻗기 ─────────────────────────
const easeOutBack = x => { const c1 = 2.2, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const CLIMB = [[4.5, 9, 6], [5.5, 6, 5], [5.5, 3, 3.5], [4.5, 0.5, 2.5]];
const DANGLE = [[4.2, 2.6, 5], [5.4, 1.6, 2], [5.4, 0.6, -1], [4.4, -0.4, -4]];
function updateArms(dt) {
  if (!P.awake) return;
  const hv = P.vel.length();
  const stepping = [false, false];
  arms.forEach(A => { if (A.step) stepping[A.gait] = true; });
  arms.forEach((A, i) => {
    A.growT += dt; A.grow = easeOutBack(clamp((A.growT - A.growD) / 0.5, 0, 1));
    const rootW = char.root.localToWorld(A.root.clone());
    if (A.strike) { // 공격: 다리를 내리꽂고 되돌리기
      const s = A.strike; s.t += dt / 0.32;
      if (s.boulder && s.boulder.alive) s.target.copy(s.boulder.p);
      const ph = s.t < 0.4 ? s.t / 0.4 : 1 - (s.t - 0.4) / 0.6, e = 1 - Math.pow(1 - clamp(ph, 0, 1), 3);
      A.tip.lerpVectors(s.from, s.target, e);
      A.n.subVectors(rootW, s.target).setY(0).normalize().multiplyScalar(0.7).add(UP).normalize();
      if (!s.hit && s.t >= 0.4) { s.hit = true; strikeHit(s); }
      if (s.t >= 1) A.strike = null;
      drawArm(A, i, rootW, anim.t); return;
    }
    let desired = null;
    if (A.grow > 0.3 && P.noGrab <= 0 && (P.onGround || P.climbing)) {
      let homeW;
      if (P.climbing) { const c = CLIMB[A.k]; homeW = char.root.localToWorld(V(A.side * c[0], c[1], c[2])).addScaledVector(P.vel, 0.25); }
      else homeW = char.root.localToWorld(A.home.clone()).addScaledVector(P.vel, 0.15).setY(P.pos.y - 1);
      desired = raycast(rootW, homeW.sub(rootW).normalize(), REACH);
      if (!desired && P.climbing) { // 옆벽 탐색
        const side = V(A.side, 0.8 - A.k * 0.35, 0.3).applyQuaternion(char.root.quaternion).normalize();
        desired = raycast(rootW, side, REACH);
      }
    }
    if (A.step) {
      A.step.t += dt / A.step.dur;
      const t = Math.min(1, A.step.t), e = t * t * (3 - 2 * t);
      A.tip.lerpVectors(A.step.from, A.step.to, e).addScaledVector(A.step.n, Math.sin(Math.PI * t) * 2.5);
      A.n.lerp(A.step.n, damp(10, dt)).normalize();
      if (t >= 1) { A.anchor = { p: A.step.to.clone(), n: A.step.n.clone() }; A.step = null; clank(); }
    } else if (desired) {
      const thr = (P.climbing ? 3.2 : 3) + hv * 0.1;
      const far = !A.anchor || A.anchor.p.distanceTo(desired.point) > thr;
      const over = A.anchor && A.anchor.p.distanceTo(rootW) > REACH;
      if ((far && !stepping[1 - A.gait]) || over) {
        A.step = { from: A.tip.clone(), to: desired.point.clone(), n: desired.normal.clone(), t: 0, dur: Math.max(0.1, 0.24 - hv * 0.004) };
        stepping[A.gait] = true;
      } else if (A.anchor) { A.tip.copy(A.anchor.p); A.n.copy(A.anchor.n); }
    } else {
      A.anchor = null;
      const c = DANGLE[A.k], sway = Math.sin(anim.t * 3 + i) * 0.8;
      const dangle = char.root.localToWorld(V(A.side * (c[0] + sway), c[1], c[2]));
      A.tip.lerp(dangle, damp(7, dt)); A.n.lerp(UP, damp(5, dt)).normalize();
    }
    if (A.anchor && A.anchor.p.distanceTo(rootW) > REACH * 1.15) A.anchor = null;
    drawArm(A, i, rootW, anim.t);
  });
  LEG_INST.forEach(m => m.instanceMatrix.needsUpdate = true);
}

// ───────────────────────── 장애물 업데이트 ─────────────────────────
let boulderT = 0;
function updateObstacles(dt, t) {
  movers.forEach(mv => {
    const x = Math.sin(t * 0.9 + mv.ph) * 9, s = mv.s;
    s.dx = x - s.mesh.position.x; s.dz = 0;
    s.mesh.position.x = x; s.mn[0] = x - s.w / 2; s.mx[0] = x + s.w / 2;
  });
  spinner.rotation.y += dt * 1.5;
  boulderT -= dt;
  if (boulderT <= 0 && boulders.length < 6) { spawnBoulder(); boulderT = rand(0.9, 1.8); }
  for (let i = boulders.length - 1; i >= 0; i--) {
    const b = boulders[i]; b.p.z += b.vz * dt;
    b.m.position.copy(b.p); b.m.rotation.x += b.vz * dt / b.r;
    if (b.p.z < 122 + b.r) { b.alive = false; scene.remove(b.m); boulders.splice(i, 1); }
  }
  lava.forEach(l => { l.tex.offset.y = t * 0.05; l.tex.offset.x = Math.sin(t * 0.3) * 0.1; });
}

// ───────────────────────── 카메라 ─────────────────────────
const camTarget = V(0, 4, 0);
let cine = 0;
function updateCamera(dt) {
  camTarget.lerp(_c.copy(P.pos).add(V(0, 4.5, 0)), damp(12, dt));
  // 각성 중에는 얼굴이 보이도록 정면으로 카메라 회전
  cine += ((P.awakenT >= 0 && P.awakenT < AW.END - 0.4 ? 1 : 0) - cine) * damp(3, dt);
  let yaw = camYaw, pitch = camPitch, cd = camDist;
  if (cine > 0.001) {
    let dy = P.yaw + 0.55 - camYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    yaw += dy * cine; pitch += (0.12 - pitch) * cine; cd += (9.5 - cd) * cine;
  }
  const dir = V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  let dist = cd;
  const hit = raycast(camTarget, dir, cd);
  if (hit) dist = Math.max(2, hit.dist - 0.6);
  camera.position.copy(camTarget).addScaledVector(dir, dist);
  camera.position.y = Math.max(camera.position.y, 0.5);
  if (shake > 0) camera.position.add(V(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(shake * 0.45));
  camera.lookAt(camTarget.x, camTarget.y + 1.5, camTarget.z);
  sun.position.copy(P.pos).addScaledVector(SUN_DIR, 120); sun.target.position.copy(P.pos);
}

// ───────────────────────── 시작 ─────────────────────────
function begin() {
  AC = AC || new (window.AudioContext || window.webkitAudioContext)();
  started = true; if (!TOUCH) lockPointer();
}
function resetLegs() {
  P.awake = false; P.awakenT = -1; shake = 0; painEl.style.opacity = 0;
  setLegsVisible(false); char.pack.visible = false; char.pack.scale.setScalar(0.001); char.backGlow.intensity = 0;
  char.headMat.map = char.faceN; awakenBtn.classList.remove('hidden'); attackBtn.classList.add('hidden');
  arms.forEach(A => { A.anchor = null; A.step = null; A.grow = 0; A.growT = 0; });
}
document.getElementById('play').onclick = () => { document.getElementById('start').classList.add('hidden'); begin(); };
document.getElementById('again').onclick = () => {
  document.getElementById('clear').classList.add('hidden');
  P.cp = 0; P.finished = false; resetLegs(); respawn(); begin();
};
awakenBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); startAwaken(); });
attackBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); attack(); });
char.root.position.copy(P.pos); char.root.updateMatrixWorld(true);

const clock = new THREE.Clock();
let T = 0;
function loop() {
  const dt = Math.min(clock.getDelta(), 1 / 30); T += dt;
  updateObstacles(dt, T);
  if (started) { updatePlayer(dt); updateAwaken(dt); atkCd -= dt; if (P.awakenT < 0) shake = Math.max(0, shake - dt * 2.5); }
  else { camYaw += dt * 0.12; char.root.updateMatrixWorld(true); animateCharacter(dt, 0); }
  updateArms(dt);
  updateFx(dt);
  updateCamera(dt);
  composer.render();
  requestAnimationFrame(loop);
}
loop();

