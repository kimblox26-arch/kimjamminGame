// SPIDER ARMS — 로블록스 스타일 캐릭터 + 기계 거미팔 (procedural IK)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const rand = (a, b) => a + Math.random() * (b - a);

// ───────────────────────── 렌더러 ─────────────────────────
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const FOG = new THREE.Color(0x2b2f52);
scene.fog = new THREE.FogExp2(FOG, 0.0065);
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 1500);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.4, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

// ───────────────────────── 하늘 / 환경광 ─────────────────────────
const SUN_DIR = V(-0.55, 0.32, -0.75).normalize();
function makeSky(r) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { sun: { value: SUN_DIR } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec3 vP; uniform vec3 sun;
      void main(){ float h = vP.y;
        vec3 top = vec3(0.04,0.06,0.18), mid = vec3(0.33,0.22,0.45), hor = vec3(1.0,0.52,0.32), low = vec3(0.12,0.12,0.2);
        vec3 c = h > 0. ? mix(hor, mix(mid, top, smoothstep(0.15,0.7,h)), smoothstep(0.0,0.18,h)) : mix(hor*0.6, low, smoothstep(0.,0.15,-h));
        float s = max(dot(vP, sun), 0.);
        c += vec3(1.0,0.6,0.35)*pow(s,8.)*0.6 + vec3(1.0,0.85,0.6)*smoothstep(0.9975,0.999,s)*4.;
        gl_FragColor = vec4(c,1.); }`
  }));
}
const sky = makeSky(900); scene.add(sky);
{ // 별
  const g = new THREE.BufferGeometry(), p = [];
  for (let i = 0; i < 900; i++) { const v = V(rand(-1, 1), rand(0.25, 1), rand(-1, 1)).normalize().multiplyScalar(850); p.push(v.x, v.y, v.z); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, color: 0xcfe6ff, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })));
}
{ // 반사용 환경맵
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene();
  es.add(makeSky(50));
  const bm = new THREE.MeshBasicMaterial({ color: 0xffffff });
  [[0, 30, 0, 30, 1, 30], [40, 5, 0, 1, 10, 30], [-40, 8, 10, 1, 6, 20]].forEach(([x, y, z, w, h, d]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bm); m.position.set(x, y, z); es.add(m); });
  scene.environment = pm.fromScene(es, 0.03).texture;
}
scene.add(new THREE.HemisphereLight(0x8fa6ff, 0x2a1d2a, 0.7));
const sun = new THREE.DirectionalLight(0xffc59a, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 300 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
const flashLight = new THREE.PointLight(0xff8a3a, 0, 40, 2); scene.add(flashLight);

// ───────────────────────── 도시 생성 ─────────────────────────
const solids = []; // {mn:[x,y,z], mx:[x,y,z]}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace; return t;
}
const CELL = 26, N = 4; // -N..N
{ // 지면 (도로 + 인도)
  const tex = canvasTex(512, 512, (g, w) => {
    g.fillStyle = '#16181f'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`; g.fillRect(Math.random() * w, Math.random() * w, 2, 2); }
    const s = w * 3.5 / 26; g.fillStyle = '#3a3d47'; g.fillRect(s, s, w - 2 * s, w - 2 * s);
    g.strokeStyle = '#555a66'; g.lineWidth = 6; g.strokeRect(s, s, w - 2 * s, w - 2 * s);
    g.strokeStyle = '#d9a72b'; g.lineWidth = 4; g.setLineDash([26, 22]);
    g.beginPath(); g.moveTo(2, 0); g.lineTo(2, w); g.moveTo(0, 2); g.lineTo(w, 2); g.stroke();
  });
  tex.repeat.set(2 * N + 1, 2 * N + 1);
  const size = CELL * (2 * N + 1);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x15161d, roughness: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; outer.receiveShadow = true; scene.add(outer);
}
function windowTextures() {
  const lit = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) lit.push(Math.random() < 0.28 ? (Math.random() < 0.75 ? '#ffd69a' : '#9fe8ff') : null);
  const draw = emissive => (g, w, h) => {
    g.fillStyle = emissive ? '#000' : '#262a38'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) {
      const c = lit[y * 8 + x];
      g.fillStyle = c ? c : (emissive ? '#000' : '#10131c');
      g.fillRect(x * 32 + 6, y * 32 + 7, 20, 18);
    }
  };
  return [canvasTex(256, 512, draw(false)), canvasTex(256, 512, draw(true))];
}
const winSets = [windowTextures(), windowTextures(), windowTextures()];
const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a3e4a, roughness: 0.9 });
const trimMats = [0x3ef0ff, 0xff3bd4, 0xffb13b].map(c => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2), toneMapped: false }));
const blinkMat = new THREE.MeshBasicMaterial({ color: 0xff2222, toneMapped: false });
const acMat = new THREE.MeshStandardMaterial({ color: 0x8a909c, metalness: 0.6, roughness: 0.4 });
const roofSpots = [];
function addSolid(x, z, w, d, h) { solids.push({ mn: [x - w / 2, 0, z - d / 2], mx: [x + w / 2, h, z + d / 2] }); }
for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
  if (Math.abs(i) <= 0 && Math.abs(j) <= 0) continue; // 중앙 광장
  if (Math.random() < 0.1) continue;
  const w = rand(11, 18), d = rand(11, 18);
  const far = Math.hypot(i, j);
  const h = Math.random() < 0.15 ? rand(6, 10) : rand(14, 30 + far * 9);
  const x = i * CELL + rand(-1.5, 1.5), z = j * CELL + rand(-1.5, 1.5);
  const [ct, et] = winSets[(Math.random() * 3) | 0];
  const side = (rx) => {
    const m = ct.clone(), e = et.clone(); m.repeat.set(rx / 9, h / 18); e.repeat.copy(m.repeat);
    return new THREE.MeshStandardMaterial({ map: m, emissiveMap: e, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.45, metalness: 0.35, color: new THREE.Color().setHSL(rand(0.55, 0.7), 0.15, rand(0.55, 0.85)) });
  };
  const sx = side(d), sz = side(w);
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sx, sx, roofMat, roofMat, sz, sz]);
  b.position.set(x, h / 2, z); b.castShadow = b.receiveShadow = true; scene.add(b);
  addSolid(x, z, w, d, h);
  roofSpots.push(V(x + rand(-w / 3, w / 3), h, z + rand(-d / 3, d / 3)));
  if (Math.random() < 0.55) { // 네온 테두리
    const tm = trimMats[(Math.random() * 3) | 0], t = 0.25;
    [[0, -d / 2, w, t], [0, d / 2, w, t]].forEach(([ox, oz, ww]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(ww + t, t, t), tm); m.position.set(x + ox, h, z + oz); scene.add(m); });
    [[-w / 2, 0], [w / 2, 0]].forEach(([ox]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(t, t, d + t), tm); m.position.set(x + ox, h, z); scene.add(m); });
  }
  for (let k = 0; k < 2; k++) { // 옥상 실외기
    const ac = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 2), acMat);
    ac.position.set(x + rand(-w / 2 + 2, w / 2 - 2), h + 0.6, z + rand(-d / 2 + 2, d / 2 - 2)); ac.castShadow = true; scene.add(ac);
  }
  if (h > 30) { // 안테나 + 깜빡이
    const an = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 6), acMat); an.position.set(x, h + 3, z); scene.add(an);
    const bl = new THREE.Mesh(new THREE.SphereGeometry(0.3), blinkMat); bl.position.set(x, h + 6.1, z); scene.add(bl);
  }
}
const WORLD = CELL * (N + 0.5);

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
const insideSolid = p => p.y < 0 || solids.some(b => p.x > b.mn[0] && p.x < b.mx[0] && p.y < b.mx[1] && p.z > b.mn[2] && p.z < b.mx[2]);

// ───────────────────────── 재질 ─────────────────────────
const M = {
  skin: new THREE.MeshStandardMaterial({ color: 0xf5cd30, roughness: 0.5 }),
  shirt: new THREE.MeshStandardMaterial({ color: 0x0d69ac, roughness: 0.55 }),
  pants: new THREE.MeshStandardMaterial({ color: 0xa4bd47, roughness: 0.55 }),
  gun: new THREE.MeshStandardMaterial({ color: 0x2b313a, metalness: 0.9, roughness: 0.32 }),
  plate: new THREE.MeshStandardMaterial({ color: 0x5b6573, metalness: 0.85, roughness: 0.28 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 1, roughness: 0.12 }),
  red: new THREE.MeshStandardMaterial({ color: 0xb8262c, metalness: 0.6, roughness: 0.35 }),
  glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3ef0ff).multiplyScalar(1.5), toneMapped: false }),
};

function roundedBox(w, h, d, r = 0.12) {
  const s = new THREE.Shape(), x = -w / 2 + r, y = -h / 2 + r, ww = w - 2 * r, hh = h - 2 * r;
  s.moveTo(x, y); s.lineTo(x + ww, y); s.lineTo(x + ww, y + hh); s.lineTo(x, y + hh); s.lineTo(x, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r, bevelEnabled: true, bevelSize: r, bevelThickness: r, bevelSegments: 4, curveSegments: 4 });
  g.translate(0, 0, -(d - 2 * r) / 2); g.computeVertexNormals(); return g;
}
const shadowAll = o => o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });

// ───────────────────────── 로블록스 캐릭터 (R6) ─────────────────────────
function buildCharacter() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const torso = new THREE.Mesh(roundedBox(2, 2, 1, 0.1), M.shirt); torso.position.y = 3; body.add(torso);
  // 머리: 둥근 원통 (lathe) + 얼굴 텍스처
  const prof = [];
  prof.push(new THREE.Vector2(0, -0.6));
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI / 2; prof.push(new THREE.Vector2(0.5 + Math.cos(a) * 0.14, -0.46 + Math.sin(a) * 0.14)); }
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; prof.push(new THREE.Vector2(0.5 + Math.cos(a) * 0.14, 0.46 + Math.sin(a) * 0.14)); }
  prof.push(new THREE.Vector2(0, 0.6));
  const face = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#f5cd30'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#111';
    [-48, 48].forEach(dx => { g.beginPath(); g.ellipse(w / 2 + dx, h * 0.38, 13, 26, 0, 0, Math.PI * 2); g.fill(); });
    g.lineWidth = 11; g.lineCap = 'round'; g.strokeStyle = '#111';
    g.beginPath(); g.arc(w / 2, h * 0.42, 78, Math.PI * 0.2, Math.PI * 0.8); g.stroke();
  });
  face.wrapS = THREE.ClampToEdgeWrapping; face.colorSpace = THREE.SRGBColorSpace;
  const head = new THREE.Mesh(new THREE.LatheGeometry(prof, 40, Math.PI), new THREE.MeshStandardMaterial({ map: face, roughness: 0.5 }));
  head.position.y = 4.62; body.add(head);
  const limb = (mat, px, py, oy) => {
    const p = new THREE.Group(); p.position.set(px, py, 0);
    const m = new THREE.Mesh(roundedBox(1, 2, 1, 0.1), mat); m.position.y = oy; p.add(m); body.add(p); return p;
  };
  const armL = limb(M.skin, 1.5, 3.6, -0.6), armR = limb(M.skin, -1.5, 3.6, -0.6);
  const legL = limb(M.pants, 0.5, 2, -1), legR = limb(M.pants, -0.5, 2, -1);
  // 기계 백팩
  const pack = new THREE.Group(); pack.position.set(0, 3.1, -0.85); body.add(pack);
  const shell = new THREE.Mesh(roundedBox(1.7, 1.9, 0.75, 0.15), M.gun); pack.add(shell);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.08, 10, 32), M.chrome); ring.position.z = -0.4; pack.add(ring);
  const core = new THREE.Mesh(new THREE.CircleGeometry(0.36, 32), M.glow); core.position.z = -0.41; core.rotation.y = Math.PI; pack.add(core);
  for (let i = 0; i < 3; i++) { const v = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.1), M.plate); v.position.set(0, 0.62 - i * 0.14, -0.4); pack.add(v); }
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.2, 0.35), M.plate); spine.position.set(0, 0, -0.3); pack.add(spine);
  shadowAll(root);
  return { root, body, head, torso, armL, armR, legL, legR, core };
}

// ───────────────────────── 기계 거미팔 ─────────────────────────
function makeSegment(r, len) {
  const g = new THREE.Group();
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m); return m; };
  const cyl = (r1, r2) => new THREE.CylinderGeometry(r1, r2, 1, 14).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  add(cyl(r, r * 0.8), M.gun);
  add(new THREE.BoxGeometry(r * 1.6, r * 0.55, 0.78).translate(0, r * 0.75, 0.5), M.plate);
  add(new THREE.BoxGeometry(r * 0.35, r * 0.2, 0.7).translate(0, r * 1.08, 0.5), M.glow);
  add(new THREE.CylinderGeometry(r * 0.22, r * 0.22, 0.9, 8).rotateX(Math.PI / 2).translate(0, -r * 0.85, 0.48), M.chrome);
  add(new THREE.BoxGeometry(r * 2.1, r * 0.5, 0.12).translate(0, 0, 0.12), M.red);
  g.userData.len = len; return g;
}
function makeLeg(side, front) {
  const L = { side, front, a: front ? 2.7 : 2.5, b: front ? 3.3 : 3.1, foot: V(), planted: null, step: null, ext: 0, override: null };
  L.a0 = L.a; L.b0 = L.b;
  L.root = V(side * 0.55, front ? 3.75 : 2.55, -1.15);
  L.home = V(side * 2.9, -0.6, front ? 1.9 : -2.3);
  L.hip = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 14), M.chrome);
  L.upper = makeSegment(0.33); L.lower = makeSegment(0.26);
  L.knee = new THREE.Group();
  const kn = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 12), M.gun); L.knee.add(kn);
  const kr = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.06, 8, 24), M.glow); L.knee.add(kr);
  L.kneeRing = kr;
  L.claw = new THREE.Group();
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.9, 10).rotateX(Math.PI / 2).translate(0, 0, 0.35), M.chrome); L.claw.add(tip);
  for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.6, 6).rotateX(Math.PI / 2).translate(0, 0, 0.3), M.plate); c.position.x = s * 0.18; c.rotation.y = s * 0.45; L.claw.add(c); }
  [L.hip, L.upper, L.lower, L.knee, L.claw].forEach(o => { scene.add(o); shadowAll(o); });
  return L;
}

const _t1 = V(), _t2 = V(), _t3 = V();
function solveIK(L, rootW, target, pole) {
  const d0 = rootW.distanceTo(target);
  const reach = L.a + L.b;
  if (d0 > reach * 0.995) { const s = d0 / (reach * 0.995); L.a *= s; L.b *= s; }
  const a = L.a, b = L.b;
  const d = clamp(d0, Math.abs(a - b) + 0.01, a + b - 0.001);
  const n = _t1.subVectors(target, rootW).normalize();
  const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
  const p = _t2.subVectors(pole, rootW); p.addScaledVector(n, -p.dot(n)).normalize();
  const knee = rootW.clone().addScaledVector(n, x).addScaledVector(p, h);
  const foot = rootW.clone().addScaledVector(n, d);
  L.hip.position.copy(rootW);
  place(L.upper, rootW, knee); place(L.lower, knee, foot);
  L.knee.position.copy(knee); L.knee.lookAt(_t3.copy(knee).add(p));
  L.claw.position.copy(foot); L.claw.lookAt(_t3.copy(foot).add(_t1.subVectors(foot, knee)));
}
function place(seg, A, B) { seg.position.copy(A); seg.lookAt(B); seg.scale.set(1, 1, A.distanceTo(B)); }

// ───────────────────────── 플레이어 ─────────────────────────
const char = buildCharacter(); scene.add(char.root);
const legs = [makeLeg(1, true), makeLeg(-1, true), makeLeg(1, false), makeLeg(-1, false)]; // FL FR BL BR
const GAIT = [0, 1, 1, 0];
const P = {
  pos: V(0, 0, 0), vel: V(), yaw: 0, onGround: true, climbing: false, wallN: null,
  hp: 100, score: 0, grapple: null, attackCd: 0, walkPhase: 0, alive: true,
};
const R = 1.1, GRAV = 62;

// ───────────────────────── 입력 ─────────────────────────
const keys = {}; let mouseL = false, mouseR = false, locked = false, started = false;
let camYaw = Math.PI * 0.8, camPitch = 0.25, camDist = 13;
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'KeyF') attack(); if (e.code === 'KeyQ') startGrapple(); });
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'KeyQ') P.grapple && releaseGrapple(); });
addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  if (!started) return;
  if (!locked) { canvas.requestPointerLock(); }
  if (e.button === 0) attack();
  if (e.button === 2) { mouseR = true; startGrapple(); }
});
addEventListener('mouseup', e => { if (e.button === 2) { mouseR = false; P.grapple && releaseGrapple(); } });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
addEventListener('mousemove', e => {
  if (!locked) return;
  camYaw -= e.movementX * 0.0025;
  camPitch = clamp(camPitch + e.movementY * 0.0022, -0.6, 1.25);
});
addEventListener('wheel', e => { camDist = clamp(camDist + Math.sign(e.deltaY) * 1.5, 7, 28); });

// ───────────────────────── 오디오 (합성) ─────────────────────────
let AC = null;
function sfx(type) {
  if (!AC) return;
  const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
  o.connect(g); g.connect(AC.destination);
  const cfg = {
    step: ['square', 140, 60, 0.05, 0.06], strike: ['sawtooth', 600, 120, 0.12, 0.12], grap: ['sawtooth', 220, 900, 0.18, 0.08],
    boom: ['sawtooth', 120, 30, 0.5, 0.25], hit: ['square', 200, 80, 0.2, 0.15], pick: ['sine', 660, 1320, 0.2, 0.12], shot: ['triangle', 900, 300, 0.12, 0.05],
  }[type];
  o.type = cfg[0]; o.frequency.setValueAtTime(cfg[1], t); o.frequency.exponentialRampToValueAtTime(cfg[2], t + cfg[3]);
  g.gain.setValueAtTime(cfg[4], t); g.gain.exponentialRampToValueAtTime(0.001, t + cfg[3]);
  o.start(t); o.stop(t + cfg[3] + 0.02);
}

// ───────────────────────── 파티클 ─────────────────────────
const parts = [];
const partGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
const partMats = [0xffa13b, 0xff5a2a, 0x3ef0ff, 0xfff1b0].map(c => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(3), toneMapped: false }));
for (let i = 0; i < 220; i++) { const m = new THREE.Mesh(partGeo, partMats[0]); m.visible = false; scene.add(m); parts.push({ m, v: V(), life: 0, max: 1 }); }
let partIdx = 0;
function burst(pos, n, speed, matIdx = 0, life = 0.7) {
  for (let i = 0; i < n; i++) {
    const p = parts[partIdx++ % parts.length];
    p.m.material = partMats[Array.isArray(matIdx) ? matIdx[i % matIdx.length] : matIdx];
    p.m.position.copy(pos); p.m.visible = true;
    p.v.set(rand(-1, 1), rand(-0.3, 1.2), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.4, 1));
    p.life = p.max = life * rand(0.6, 1.2);
  }
}

// ───────────────────────── 적 드론 / 탄환 / 코어 ─────────────────────────
const drones = [], bolts = [], cores = [];
const droneMat = new THREE.MeshStandardMaterial({ color: 0x1d2028, metalness: 0.9, roughness: 0.3 });
const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a3c).multiplyScalar(3), toneMapped: false });
function spawnDrone() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), droneMat); body.scale.set(1, 0.7, 1); g.add(body);
  const band = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.1, 8, 32), M.plate); band.rotation.x = Math.PI / 2; g.add(band);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), eyeMat); eye.position.z = 0.85; g.add(eye);
  const rotors = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4, arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 1.4), M.gun);
    arm.position.set(Math.sin(a) * 1.3, 0.2, Math.cos(a) * 1.3); arm.rotation.y = a; g.add(arm);
    const rot = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.04, 20), new THREE.MeshBasicMaterial({ color: 0x99aabb, transparent: true, opacity: 0.25 }));
    rot.position.set(Math.sin(a) * 1.9, 0.35, Math.cos(a) * 1.9); g.add(rot); rotors.push(rot);
  }
  shadowAll(g);
  const ang = rand(0, Math.PI * 2), dist = rand(45, 75);
  g.position.set(clamp(P.pos.x + Math.cos(ang) * dist, -WORLD, WORLD), P.pos.y + rand(15, 30), clamp(P.pos.z + Math.sin(ang) * dist, -WORLD, WORLD));
  scene.add(g);
  drones.push({ g, v: V(), cd: rand(2, 4), orbit: rand(0, Math.PI * 2), rotors, hp: 1 });
}
const boltGeo = new THREE.CapsuleGeometry(0.18, 0.9, 4, 8).rotateX(Math.PI / 2);
function fireBolt(from, to) {
  const m = new THREE.Mesh(boltGeo, eyeMat); m.position.copy(from);
  const v = to.clone().sub(from).normalize().multiplyScalar(34); m.lookAt(to); scene.add(m);
  bolts.push({ m, v, life: 4 }); sfx('shot');
}
const coreGeo = new THREE.IcosahedronGeometry(0.8, 0);
function spawnCore() {
  const spot = Math.random() < 0.8 ? roofSpots[(Math.random() * roofSpots.length) | 0].clone() : V(rand(-WORLD, WORLD), 0, rand(-WORLD, WORLD));
  if (spot.y === 0 && insideSolid(V(spot.x, 1, spot.z))) spot.set(0, 0, 0);
  const g = new THREE.Group(); g.position.copy(spot).add(V(0, 1.8, 0));
  const m = new THREE.Mesh(coreGeo, M.glow); g.add(m);
  const sh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), new THREE.MeshStandardMaterial({ color: 0x3ef0ff, transparent: true, opacity: 0.25, metalness: 0.5, roughness: 0.1 })); g.add(sh);
  scene.add(g); cores.push({ g, base: g.position.y, t: rand(0, 6) });
}
for (let i = 0; i < 14; i++) spawnCore();

// ───────────────────────── 공격 / 그래플 ─────────────────────────
const chest = () => P.pos.clone().add(V(0, 3.4, 0));
function legRootW(L) { return char.root.localToWorld(L.root.clone()); }
function pickFrontLeg(worldPt) {
  const local = char.root.worldToLocal(worldPt.clone());
  const pref = local.x >= 0 ? 0 : 1;
  const cand = [legs[pref], legs[1 - pref], legs[2 + pref], legs[3 - pref]];
  return cand.find(l => !l.override) || null;
}
function attack() {
  if (!started || !P.alive || P.attackCd > 0) return;
  P.attackCd = 0.28;
  const c = chest();
  let best = null, bd = 13;
  for (const d of drones) { const dd = d.g.position.distanceTo(c); if (dd < bd) { bd = dd; best = d; } }
  const fwd = V(Math.sin(P.yaw), 0, Math.cos(P.yaw));
  const target = best ? best.g.position.clone() : c.clone().addScaledVector(fwd, 7).add(V(0, 0.5, 0));
  const L = pickFrontLeg(target); if (!L) return;
  L.override = { type: 'strike', t: 0, target, drone: best, from: L.foot.clone(), hit: false };
  L.planted = null; L.step = null;
  if (best) P.faceTo = target.clone();
  sfx('strike');
}
function startGrapple() {
  if (!started || !P.alive || P.grapple) return;
  const dir = V(); camera.getWorldDirection(dir);
  const hit = raycast(camera.position, dir, 170);
  if (!hit || hit.point.distanceTo(P.pos) < 4) return;
  const L = pickFrontLeg(hit.point); if (!L) return;
  L.override = { type: 'grapple', t: 0, target: hit.point.clone(), from: L.foot.clone() };
  L.planted = null; L.step = null;
  P.grapple = { point: hit.point.clone(), leg: L, len: hit.point.distanceTo(chest()), latched: false };
  sfx('grap');
}
function releaseGrapple() {
  const L = P.grapple.leg; L.override = null; P.grapple = null;
}

// ───────────────────────── 플레이어 물리 ─────────────────────────
function updatePlayer(dt) {
  const fwdC = V(-Math.sin(camYaw), 0, -Math.cos(camYaw)), rightC = V(Math.cos(camYaw), 0, -Math.sin(camYaw));
  const wish = V().addScaledVector(fwdC, (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0)).addScaledVector(rightC, (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0));
  const moving = wish.lengthSq() > 0.01; if (moving) wish.normalize();
  const sprint = keys.ShiftLeft || keys.ShiftRight;
  const speed = sprint ? 27 : 16;
  P.attackCd -= dt;

  // 그래플: 당기기 + 로프 제약
  if (P.grapple) {
    const g = P.grapple, L = g.leg;
    if (L.override && L.override.t >= 1) g.latched = true;
    if (g.latched) {
      const to = g.point.clone().sub(chest()), dist = to.length(); to.normalize();
      g.len = Math.max(3, g.len - 34 * dt);
      P.vel.addScaledVector(to, 75 * dt);
      if (dist > g.len) { const vr = P.vel.dot(to); if (vr < 0) P.vel.addScaledVector(to, -vr); }
      P.vel.addScaledVector(wish, 22 * dt);
      if (dist < 3.2) { releaseGrapple(); P.vel.y = Math.max(P.vel.y, 14); }
    }
  }

  const grappling = P.grapple && P.grapple.latched;
  // 벽타기
  P.climbing = false;
  if (P.wallN && moving && !grappling && wish.dot(P.wallN) < -0.45) {
    P.climbing = true;
    P.vel.set(-P.wallN.x * 3, sprint ? 17 : 12, -P.wallN.z * 3);
  } else if (!grappling) {
    const k = P.onGround ? 14 : 2.5;
    const tx = wish.x * speed, tz = wish.z * speed;
    P.vel.x += (tx - P.vel.x) * damp(k, dt) * (P.onGround || moving ? 1 : 0.15);
    P.vel.z += (tz - P.vel.z) * damp(k, dt) * (P.onGround || moving ? 1 : 0.15);
  }
  if (!P.climbing) P.vel.y -= GRAV * dt * (grappling ? 0.55 : 1);

  if (keys.Space && !P.jumpHeld) {
    if (P.onGround) { P.vel.y = 24; sfx('step'); }
    else if (P.wallN) { P.vel.y = 22; P.vel.addScaledVector(P.wallN, 20); sfx('step'); }
  }
  P.jumpHeld = keys.Space;

  // 수평 이동 + 벽 충돌
  const prevY = P.pos.y;
  P.pos.x += P.vel.x * dt; P.pos.z += P.vel.z * dt;
  P.pos.x = clamp(P.pos.x, -WORLD * 1.6, WORLD * 1.6); P.pos.z = clamp(P.pos.z, -WORLD * 1.6, WORLD * 1.6);
  P.wallN = null;
  for (const b of solids) {
    if (P.pos.y >= b.mx[1] - 0.6) continue;
    const cx = clamp(P.pos.x, b.mn[0], b.mx[0]), cz = clamp(P.pos.z, b.mn[2], b.mx[2]);
    let dx = P.pos.x - cx, dz = P.pos.z - cz, d2 = dx * dx + dz * dz;
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
    if (P.climbing && b.mx[1] - P.pos.y < 1.4) { P.vel.y = 16; P.vel.addScaledVector(n, -9); } // 꼭대기 넘어가기
  }
  // 수직
  P.pos.y += P.vel.y * dt;
  let gh = 0;
  const fr = R * 0.75;
  for (const b of solids) {
    const cx = clamp(P.pos.x, b.mn[0], b.mx[0]), cz = clamp(P.pos.z, b.mn[2], b.mx[2]);
    if ((P.pos.x - cx) ** 2 + (P.pos.z - cz) ** 2 > fr * fr) continue;
    if (prevY >= b.mx[1] - 0.6) gh = Math.max(gh, b.mx[1]);
  }
  const wasAir = !P.onGround;
  P.onGround = false;
  if (P.pos.y <= gh && P.vel.y <= 0) {
    if (wasAir && P.vel.y < -30) { burst(P.pos.clone().add(V(0, 0.2, 0)), 14, 9, 3, 0.4); sfx('boom'); }
    P.pos.y = gh; P.vel.y = 0; P.onGround = true;
  }

  // 회전
  let targetYaw = P.yaw;
  const hv = Math.hypot(P.vel.x, P.vel.z);
  if (P.climbing && P.wallN) targetYaw = Math.atan2(-P.wallN.x, -P.wallN.z);
  else if (P.faceTo) { targetYaw = Math.atan2(P.faceTo.x - P.pos.x, P.faceTo.z - P.pos.z); }
  else if (grappling) { const to = P.grapple.point.clone().sub(P.pos); targetYaw = Math.atan2(to.x, to.z); }
  else if (moving && hv > 1) targetYaw = Math.atan2(P.vel.x, P.vel.z);
  let dy = targetYaw - P.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  P.yaw += dy * damp(P.faceTo ? 20 : 12, dt);
  if (P.attackCd < 0) P.faceTo = null;

  char.root.position.copy(P.pos); char.root.rotation.y = P.yaw;
  char.root.updateMatrixWorld(true);
  animateCharacter(dt, hv, moving, grappling);
}

// ───────────────────────── 캐릭터 애니메이션 ─────────────────────────
const anim = { aL: 0, aR: 0, lL: 0, lR: 0, azL: 0, azR: 0, lean: 0, bob: 0, t: 0 };
function animateCharacter(dt, hv, moving, grappling) {
  anim.t += dt;
  let aL = 0, aR = 0, lL = 0, lR = 0, azL = 0.05, azR = -0.05, lean = 0, bob = 0;
  if (P.climbing) {
    const s = Math.sin(anim.t * 11);
    aL = -2.7 + s * 0.45; aR = -2.7 - s * 0.45; lL = -0.5 - s * 0.5; lR = -0.5 + s * 0.5; lean = 0.15;
  } else if (grappling) {
    aR = -2.2; aL = -0.6; lL = 0.4; lR = -0.3; azL = 0.4;
  } else if (!P.onGround) {
    aL = aR = -2.9; lL = 0.25; lR = -0.25; azL = 0.15; azR = -0.15;
  } else if (hv > 0.5) {
    P.walkPhase += dt * hv * 0.5;
    const amp = Math.min(1, hv / 16) * 0.95, s = Math.sin(P.walkPhase);
    lL = s * amp; lR = -s * amp; aL = -s * amp * 0.9; aR = s * amp * 0.9;
    lean = Math.min(hv / 27, 1) * 0.14; bob = Math.abs(Math.cos(P.walkPhase)) * 0.12 * amp;
  } else {
    const br = Math.sin(anim.t * 2);
    azL = 0.06 + br * 0.03; azR = -0.06 - br * 0.03; bob = br * 0.02;
  }
  if (P.attackCd > 0.05) aR = -1.6;
  const k = damp(16, dt);
  for (const [key, v] of Object.entries({ aL, aR, lL, lR, azL, azR, lean, bob })) anim[key] += (v - anim[key]) * k;
  char.armL.rotation.set(anim.aL, 0, anim.azL); char.armR.rotation.set(anim.aR, 0, anim.azR);
  char.legL.rotation.x = anim.lL; char.legR.rotation.x = anim.lR;
  char.body.rotation.x = anim.lean; char.body.position.y = anim.bob;
  char.head.rotation.y = Math.sin(anim.t * 0.7) * 0.08;
  M.glow.color.setRGB(0.2, 1.3, 1.6).multiplyScalar(0.85 + Math.sin(anim.t * 4) * 0.15);
}

// ───────────────────────── 거미팔 업데이트 ─────────────────────────
function updateLegs(dt) {
  const hv = Math.hypot(P.vel.x, P.vel.z);
  const stepping = [false, false];
  legs.forEach((L, i) => { if (L.step) stepping[GAIT[i]] = true; });
  legs.forEach((L, i) => {
    const rootW = legRootW(L);
    // 길이 복원 (망원경식 팔)
    L.a += (L.a0 - L.a) * damp(8, dt); L.b += (L.b0 - L.b) * damp(8, dt);
    const outward = char.root.localToWorld(V(L.side * 3, 5.5, L.front ? 1 : -2.5));

    if (L.override) {
      const o = L.override;
      if (o.type === 'strike') {
        o.t += dt / 0.26;
        if (o.drone && o.drone.g.parent) o.target.copy(o.drone.g.position);
        const ph = o.t < 0.45 ? o.t / 0.45 : 1 - (o.t - 0.45) / 0.55;
        const e = 1 - Math.pow(1 - clamp(ph, 0, 1), 3);
        L.foot.lerpVectors(o.from, o.target, e);
        if (!o.hit && o.t >= 0.45) {
          o.hit = true;
          burst(o.target, 10, 10, [0, 3], 0.35);
          if (o.drone && o.drone.g.parent) killDrone(o.drone);
        }
        if (o.t >= 1) L.override = null;
      } else { // grapple
        o.t = Math.min(1, o.t + dt / 0.14);
        L.foot.lerpVectors(o.from, o.target, o.t * o.t);
        if (o.t >= 1 && !o.sparked) { o.sparked = true; burst(o.target, 12, 8, [2, 3], 0.4); sfx('step'); }
      }
      solveIK(L, rootW, L.foot, outward);
      return;
    }

    const grounded = P.onGround || P.climbing;
    let desired = null;
    if (grounded) {
      const home = P.climbing ? V(L.side * 2.4, L.front ? 6.2 : 1.2, 2.6) : L.home.clone();
      const homeW = char.root.localToWorld(home);
      if (!P.climbing) homeW.addScaledVector(P.vel, 0.13).setY(homeW.y);
      const dir = homeW.clone().sub(rootW), len = dir.length(); dir.normalize();
      const hit = raycast(rootW, dir, Math.min(len * 1.5, (L.a0 + L.b0) * 1.05));
      if (hit) desired = hit.point;
    }
    if (L.step) {
      L.step.t += dt / L.step.dur;
      const t = Math.min(1, L.step.t), e = t * t * (3 - 2 * t);
      L.foot.lerpVectors(L.step.from, L.step.to, e).addScaledVector(L.step.lift, Math.sin(Math.PI * t) * 1.1);
      if (t >= 1) { L.planted = L.step.to.clone(); L.step = null; sfx('step'); }
    } else if (desired) {
      const thr = 1.3 + hv * 0.07;
      const far = !L.planted || L.planted.distanceTo(desired) > thr;
      const over = L.planted && L.planted.distanceTo(rootW) > (L.a0 + L.b0) * 1.02;
      if ((far && !stepping[1 - GAIT[i]]) || over || (!L.planted)) {
        const lift = P.climbing && P.wallN ? P.wallN.clone() : UP.clone();
        L.step = { from: L.foot.clone(), to: desired.clone(), t: 0, dur: Math.max(0.08, 0.2 - hv * 0.0045), lift };
        stepping[GAIT[i]] = true;
      } else L.foot.copy(L.planted);
    } else {
      // 공중: 늘어뜨리고 흔들리기
      L.planted = null;
      const sway = Math.sin(anim.t * 3 + i) * 0.4;
      const dangle = char.root.localToWorld(V(L.side * (2.6 + sway), L.front ? 1.2 : 0.2, L.front ? 2.2 : -2.4));
      L.foot.lerp(dangle, damp(9, dt));
    }
    solveIK(L, rootW, L.foot, outward);
  });
}

// ───────────────────────── 적 / 아이템 업데이트 ─────────────────────────
function killDrone(d) {
  scene.remove(d.g); drones.splice(drones.indexOf(d), 1);
  burst(d.g.position, 40, 18, [0, 1, 3], 0.9);
  flashLight.position.copy(d.g.position); flashLight.intensity = 400;
  P.score += 100; sfx('boom');
}
let spawnTimer = 2;
function updateWorld(dt) {
  const c = chest();
  spawnTimer -= dt;
  const maxD = Math.min(10, 3 + Math.floor(P.score / 400));
  if (spawnTimer <= 0 && drones.length < maxD) { spawnDrone(); spawnTimer = rand(2, 4); }
  for (const d of drones) {
    d.orbit += dt * 0.35;
    const tgt = P.pos.clone().add(V(Math.cos(d.orbit) * 13, 7 + Math.sin(d.orbit * 2) * 2, Math.sin(d.orbit) * 13));
    const acc = tgt.sub(d.g.position).clampLength(0, 30);
    d.v.addScaledVector(acc, dt * 1.6).multiplyScalar(1 - dt * 0.9).clampLength(0, 18);
    d.g.position.addScaledVector(d.v, dt);
    if (insideSolid(d.g.position)) { d.g.position.y += 20 * dt; d.v.y = Math.abs(d.v.y) + 5 * dt; }
    d.g.lookAt(c); d.g.rotateX(Math.sin(anim.t * 3 + d.orbit) * 0.1);
    d.rotors.forEach(r => r.rotation.y += dt * 40);
    d.cd -= dt;
    if (d.cd <= 0 && P.alive) {
      d.cd = rand(2.2, 3.8);
      const dist = d.g.position.distanceTo(c);
      const dir = c.clone().sub(d.g.position).normalize();
      const los = raycast(d.g.position, dir, dist);
      if (dist < 50 && !los) fireBolt(d.g.position.clone().addScaledVector(dir, 1.2), c.clone().add(V(rand(-1, 1), rand(-1, 1), rand(-1, 1))));
    }
  }
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i]; b.life -= dt; b.m.position.addScaledVector(b.v, dt);
    let dead = b.life <= 0;
    if (!dead && insideSolid(b.m.position)) { dead = true; burst(b.m.position, 6, 6, 1, 0.3); }
    if (!dead && b.m.position.distanceTo(c) < 1.8 && P.alive) { dead = true; hurt(12); burst(b.m.position, 10, 8, 1, 0.4); }
    if (dead) { scene.remove(b.m); bolts.splice(i, 1); }
  }
  for (let i = cores.length - 1; i >= 0; i--) {
    const k = cores[i]; k.t += dt;
    k.g.rotation.y += dt * 1.5; k.g.rotation.x += dt * 0.7; k.g.position.y = k.base + Math.sin(k.t * 2) * 0.35;
    if (k.g.position.distanceTo(c) < 3.2) {
      burst(k.g.position, 22, 9, 2, 0.6); scene.remove(k.g); cores.splice(i, 1);
      P.score += 50; P.hp = Math.min(100, P.hp + 15); sfx('pick'); spawnCore();
    }
  }
  for (const p of parts) {
    if (!p.m.visible) continue;
    p.life -= dt; if (p.life <= 0) { p.m.visible = false; continue; }
    p.v.y -= 22 * dt; p.m.position.addScaledVector(p.v, dt);
    p.m.scale.setScalar(p.life / p.max); p.m.rotation.x += dt * 8;
  }
  flashLight.intensity *= Math.exp(-dt * 8);
}
const dmgEl = document.getElementById('dmg');
function hurt(n) {
  P.hp -= n; sfx('hit'); dmgEl.style.opacity = 1; setTimeout(() => dmgEl.style.opacity = 0, 120);
  if (P.hp <= 0) gameOver();
}

// ───────────────────────── 카메라 ─────────────────────────
const camTarget = V(0, 4, 0);
const crossEl = document.getElementById('cross');
function updateCamera(dt) {
  camTarget.lerp(P.pos.clone().add(V(0, 4.3, 0)), damp(14, dt));
  const dir = V(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
  let dist = camDist;
  const hit = raycast(camTarget, dir, camDist);
  if (hit) dist = Math.max(1.5, hit.dist - 0.5);
  camera.position.copy(camTarget).addScaledVector(dir, dist);
  camera.position.y = Math.max(camera.position.y, 0.4);
  camera.lookAt(camTarget.clone().add(V(0, 1.2, 0)));
  const sp = P.vel.length();
  camera.fov += (68 + clamp(sp - 16, 0, 40) * 0.45 - camera.fov) * damp(4, dt); camera.updateProjectionMatrix();
  const fwd = V(); camera.getWorldDirection(fwd);
  crossEl.classList.toggle('ok', !!raycast(camera.position, fwd, 170));
  sun.position.copy(P.pos).addScaledVector(SUN_DIR, 120); sun.target.position.copy(P.pos);
}

// ───────────────────────── 게임 흐름 ─────────────────────────
const hpFill = document.getElementById('hpfill'), scEl = document.getElementById('sc');
function reset() {
  P.pos.set(0, 0, 0); P.vel.set(0, 0, 0); P.hp = 100; P.score = 0; P.alive = true; P.grapple = null;
  drones.splice(0).forEach(d => scene.remove(d.g)); bolts.splice(0).forEach(b => scene.remove(b.m));
  legs.forEach(L => { L.override = null; L.planted = null; L.step = null; });
  spawnTimer = 3;
}
function gameOver() {
  P.alive = false;
  burst(chest(), 60, 20, [0, 1, 2, 3], 1.2); sfx('boom');
  document.getElementById('final').textContent = `최종 점수: ${P.score}`;
  setTimeout(() => { document.getElementById('over').classList.remove('hidden'); document.exitPointerLock(); }, 900);
}
function begin() {
  AC = AC || new (window.AudioContext || window.webkitAudioContext)();
  started = true; canvas.requestPointerLock();
}
document.getElementById('play').onclick = () => { document.getElementById('start').classList.add('hidden'); begin(); };
document.getElementById('again').onclick = () => { document.getElementById('over').classList.add('hidden'); reset(); begin(); };

// 초기 다리 위치
char.root.updateMatrixWorld(true);
legs.forEach(L => { L.foot.copy(char.root.localToWorld(L.home.clone())).setY(0); });

const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  if (started && P.alive) updatePlayer(dt);
  else { camYaw += dt * (started ? 0 : 0.12); char.root.updateMatrixWorld(true); animateCharacter(dt, 0, false, false); }
  updateLegs(dt);
  if (started) updateWorld(dt);
  updateCamera(dt);
  char.root.visible = P.alive; legs.forEach(L => [L.hip, L.upper, L.lower, L.knee, L.claw].forEach(o => o.visible = P.alive));
  hpFill.style.width = Math.max(0, P.hp) + '%'; scEl.textContent = P.score;
  composer.render();
  requestAnimationFrame(loop);
}
loop();
