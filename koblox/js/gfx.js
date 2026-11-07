// 그래픽 공통: 둥근 블록, 재질, 하늘, 환경광, 후처리, 품질 단계(1~10)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ── 모서리가 둥근 상자 ──
const rbCache = new Map();
export function rboxGeo(w, h, d, r = 0.1, seg = 2) {
  const key = [w, h, d, r, seg].map(v => +v.toFixed(3)).join('|');
  if (rbCache.has(key)) return rbCache.get(key);
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const n = seg * 2 + 1, half = 0.5 / n;
  const g = new THREE.BoxGeometry(1, 1, 1, n, n, n);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const box = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r), p = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    v.copy(p); v.x -= Math.sign(v.x) * half; v.y -= Math.sign(v.y) * half; v.z -= Math.sign(v.z) * half; v.normalize();
    pos.setXYZ(i, v.x * r + Math.sign(p.x) * box.x, v.y * r + Math.sign(p.y) * box.y, v.z * r + Math.sign(p.z) * box.z);
    nor.setXYZ(i, v.x, v.y, v.z);
  }
  g.userData.shared = true;
  rbCache.set(key, g);
  return g;
}

// ── 재질 ──
function canvasTex(size, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function rnd(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
const TEX = {};
export function tex(kind) {
  if (TEX[kind]) return TEX[kind];
  const r = rnd(kind.length * 977 + 13);
  const noise = (g, s, a, n = 2500) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${r() > .5 ? '255,255,255' : '0,0,0'},${r() * a})`; g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2); } };
  const T = {
    plastic: g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128); noise(g, 128, 0.035, 900); },
    wood: g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128); for (let y = 0; y < 128; y += 2) { g.fillStyle = `rgba(90,50,20,${0.05 + 0.12 * Math.abs(Math.sin(y * 0.21 + Math.sin(y * 0.05) * 3))})`; g.fillRect(0, y, 128, 2); } noise(g, 128, 0.05); },
    grass: g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128); for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(${r() > .5 ? '255,255,200' : '0,40,0'},${r() * 0.18})`; g.fillRect(r() * 128, r() * 128, 1, 2 + r() * 4); } },
    brick: g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128); g.fillStyle = 'rgba(0,0,0,.28)'; for (let row = 0; row < 8; row++) { g.fillRect(0, row * 16, 128, 2); for (let x = (row % 2) * 16; x < 128; x += 32) g.fillRect(x, row * 16, 2, 16); } noise(g, 128, 0.08); },
    metal: g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128); for (let y = 0; y < 128; y++) { g.fillStyle = `rgba(0,0,0,${r() * 0.07})`; g.fillRect(0, y, 128, 1); } },
    neon: g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 8, 8); },
    glass: g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 8, 8); },
    stud: g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128); g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(0, 0, 128, 3); g.fillRect(0, 0, 3, 128); noise(g, 128, 0.03, 600); },
  };
  TEX[kind] = canvasTex(kind === 'neon' || kind === 'glass' ? 8 : 128, T[kind] || T.plastic);
  return TEX[kind];
}
export const MATERIALS = [['plastic', '플라스틱'], ['wood', '나무'], ['brick', '벽돌'], ['grass', '잔디'], ['metal', '금속'], ['neon', '네온'], ['glass', '유리']];
const matCache = new Map();
export function partMat(color, kind = 'plastic') {
  const key = color + '|' + kind;
  if (matCache.has(key)) return matCache.get(key);
  const o = { color, map: tex(kind), roughness: 0.55, metalness: 0 };
  if (kind === 'metal') Object.assign(o, { roughness: 0.32, metalness: 0.85 });
  if (kind === 'wood' || kind === 'brick' || kind === 'grass') o.roughness = 0.85;
  if (kind === 'neon') Object.assign(o, { emissive: new THREE.Color(color), emissiveIntensity: 1.1, roughness: 1 });
  if (kind === 'glass') Object.assign(o, { transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2 });
  const m = new THREE.MeshStandardMaterial(o);
  m.userData.shared = true;
  matCache.set(key, m);
  return m;
}
// 상자 UV 를 면 크기에 맞춰 늘려 무늬가 늘어지지 않게 한다 (scale = 무늬 1장 크기)
export function boxUV(geo, w, h, d, scale = 4) {
  const uv = geo.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const per = uv.count / 6;
  for (let f = 0; f < 6; f++) for (let i = 0; i < per; i++) { const k = f * per + i; uv.setXY(k, uv.getX(k) * dims[f][0] / scale, uv.getY(k) * dims[f][1] / scale); }
  return geo;
}

// ── 하늘 ──
const SKY_V = `varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position,0.0)).xyz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`;
const SKY_F = `uniform vec3 top; uniform vec3 hor; uniform vec3 bot; uniform vec3 sunDir; varying vec3 vDir;
void main(){ vec3 d = normalize(vDir); float h = d.y;
  vec3 c = mix(hor, top, pow(clamp(h,0.0,1.0), 0.55));
  c = mix(c, bot, smoothstep(0.0, -0.3, h));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  c += vec3(1.0,0.92,0.75) * (pow(s, 1200.0) * 30.0 + pow(s, 60.0) * 0.6 + pow(s, 6.0) * 0.12);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
export function makeSky({ top = '#1f6fe0', hor = '#a8d6ff', bot = '#d9ecff', sun = [0.45, 0.75, 0.35] } = {}) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_V, fragmentShader: SKY_F, side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(top) }, hor: { value: new THREE.Color(hor) }, bot: { value: new THREE.Color(bot) }, sunDir: { value: new THREE.Vector3(...sun).normalize() } },
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  m.scale.setScalar(1500); m.frustumCulled = false; m.renderOrder = -10;
  return m;
}
// 하늘을 찍어서 반사/주변광(환경맵)으로 쓴다
export function envFromSky(renderer, skyOpts) {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene(), sky = makeSky(skyOpts); sky.scale.setScalar(10); s.add(sky);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(8, 24), new THREE.MeshBasicMaterial({ color: 0x8a8d94 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -1; s.add(ground);
  const rt = pm.fromScene(s, 0.02);
  pm.dispose(); sky.geometry.dispose(); sky.material.dispose(); ground.geometry.dispose(); ground.material.dispose();
  return rt.texture;
}

// ── 품질 단계 ──
export function gfxLevel(set) {
  if (set.gfx && set.gfx !== 'auto') return +set.gfx;
  return matchMedia('(pointer: coarse)').matches ? 6 : 8;
}
export function gfxProfile(lv) {
  const dpr = window.devicePixelRatio || 1;
  return {
    lv,
    pixelRatio: lv <= 2 ? 0.6 : lv <= 4 ? 0.85 : lv <= 6 ? Math.min(dpr, 1.25) : lv <= 8 ? Math.min(dpr, 1.75) : Math.min(dpr, 2.25),
    shadows: lv >= 3, shadowSize: lv >= 9 ? 4096 : lv >= 6 ? 2048 : 1024, shadowRange: lv >= 7 ? 90 : 60,
    post: lv >= 4, bloom: lv >= 5, msaa: lv >= 7 ? 4 : lv >= 4 ? 2 : 0, fog: lv >= 8 ? 900 : lv >= 5 ? 650 : 420,
  };
}

export function makeRenderer(canvas, { alpha = false } = {}) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, powerPreference: 'high-performance' });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.95;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  return r;
}

// 렌더러 + (필요하면) 블룸 후처리
export function makePipeline(renderer, scene, camera, prof) {
  if (!prof.post) return { render: () => renderer.render(scene, camera), setSize: () => { }, dispose: () => { } };
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: prof.msaa });
  const comp = new EffectComposer(renderer, rt);
  comp.addPass(new RenderPass(scene, camera));
  let bloom = null;
  if (prof.bloom) { bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.45, 0.92); comp.addPass(bloom); }
  comp.addPass(new OutputPass());
  return {
    render: () => comp.render(),
    setSize: (w, h) => { comp.setPixelRatio(renderer.getPixelRatio()); comp.setSize(w, h); },
    dispose: () => { comp.dispose?.(); rt.dispose(); bloom?.dispose?.(); },
  };
}

export function disposeTree(root) {
  root.traverse(o => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.material) [].concat(o.material).forEach(m => { if (!m.userData.shared) m.dispose(); });
  });
}
