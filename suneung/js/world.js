// 수능 감독관 — 3D 월드 (고화질): PBR 재질 · 환경 반사 · 블룸 · 창문 햇빛 · 정밀 모델
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { studentBody, teacherBody, viewArms } from './human.js';

export const R = { students: [], obstacles: [], debris: [], decals: [] };
export const Q = { level: 'high' };
export const rand = (a, b) => a + Math.random() * (b - a);
export const ri = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = (a) => a[Math.floor(Math.random() * a.length)];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const PI = Math.PI, HP = PI / 2;
const lerp = (a, b, k) => a + (b - a) * k;
const F = '"Gothic A1","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
const FT = '"Black Han Sans",' + F;
const SUN_POS = new THREE.Vector3(-10, 7.5, 2.5);

export function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function ctex(c, rx = 1, ry = 1, data = false) {
  const t = new THREE.CanvasTexture(c); if (!data) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); return t;
}

// ───────── 지오메트리 병합 (정점색 + 거칠기/금속도 + UV) ─────────
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
export const K = { skin: [.5, 0], cloth: [.93, 0], hair: [.42, 0], metal: [.3, .9], chrome: [.15, 1], plastic: [.38, 0], rubber: [.85, 0], shoe: [.45, 0], leather: [.28, 0], eye: [.06, 0], paper: [.9, 0], paint: [.25, 0], wood: [.5, 0], gloss: [.2, 0] };
export function merge(parts) {
  const pos = [], nor = [], col = [], rm = [], uv = [];
  for (const pt of parts) {
    const g = pt.g.index ? pt.g.toNonIndexed() : pt.g.clone();
    _e.set(...(pt.r || [0, 0, 0])); _q.setFromEuler(_e); _p.set(...(pt.p || [0, 0, 0]));
    if (typeof pt.s === 'number') _s.set(pt.s, pt.s, pt.s); else _s.set(...(pt.s || [1, 1, 1]));
    _m.compose(_p, _q, _s); g.applyMatrix4(_m); _c.set(pt.c || '#fff');
    const P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv ? g.attributes.uv.array : null, k = pt.k || [.75, 0];
    for (let i = 0; i < P.length; i++) { pos.push(P[i]); nor.push(N[i]); }
    for (let i = 0; i < P.length / 3; i++) { col.push(_c.r, _c.g, _c.b); rm.push(k[0], k[1]); uv.push(U ? U[i * 2] : 0, U ? U[i * 2 + 1] : 0); }
    g.dispose(); pt.g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('rm', new THREE.Float32BufferAttribute(rm, 2));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.computeBoundingSphere(); return out;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const SP = (r, w = 20, h = 14, a, b, c, d) => new THREE.SphereGeometry(r, w, h, a, b, c, d);
const CY = (a, b, h, s = 16) => new THREE.CylinderGeometry(a, b, h, s);
const CA = (r, l, s = 12) => new THREE.CapsuleGeometry(r, l, 4, s);
const TO = (r, t, rs = 8, ts = 24, arc = PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc);
const LA = (pts, s = 28) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), s);
function EX(pts, depth, bev = .004) {
  const sh = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -depth / 2); g.rotateY(HP); return g; // 모양의 x = 앞(-z), y = 위, 두께 = x축
}
export function M(geo, mat = R.mV, cast = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; return m; }

// 정점 속성 rm(거칠기, 금속도)을 쓰는 PBR 재질
const patchRM = (sh) => {
  sh.vertexShader = 'attribute vec2 rm;\nvarying vec2 vRM;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vRM = rm;');
  sh.fragmentShader = 'varying vec2 vRM;\n' + sh.fragmentShader.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;');
};
function stdV(extra = {}) { const m = new THREE.MeshStandardMaterial({ vertexColors: true, ...extra }); m.onBeforeCompile = patchRM; m.customProgramCacheKey = () => 'rmv'; return m; }
const matCache = {};
export function lam(color, extra) { const k = 's' + color + JSON.stringify(extra || {}); return matCache[k] || (matCache[k] = new THREE.MeshStandardMaterial({ color, roughness: .6, ...(extra || {}) })); }
export function basic(color, extra) { const k = 'b' + color + JSON.stringify(extra || {}); return matCache[k] || (matCache[k] = new THREE.MeshBasicMaterial({ color, ...(extra || {}) })); }
export function paintMat(color) { const k = 'p' + color; return matCache[k] || (matCache[k] = new THREE.MeshStandardMaterial({ color, roughness: .12, metalness: 0, emissive: color, emissiveIntensity: .12 })); }

// ───────── 초기화 ─────────
export function buildWorld(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = .95;
  R.renderer = r; R.scene = new THREE.Scene(); R.scene.background = new THREE.Color('#151b26');
  R.cam = new THREE.PerspectiveCamera(55, 1, .05, 80);
  textures(); misc(); initMats(); lights(); room(); furniture(); sunbeams();
  R.teacher = buildTeacher(); R.scene.add(R.teacher.root);
  shopItems(); viewModel(); envMap(); R.vmScene.environment = R.scene.environment;
  R.pfxA = new PFX(1600, true, R.glowTex); R.pfxN = new PFX(1400, false, R.glowTex); R.pfxS = new PFX(700, false, R.smokeTex);
  setQuality(matchMedia('(pointer:coarse)').matches ? 'mid' : 'high');
}

// ───────── 렌더링 품질 / 후처리 ─────────
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, vig: { value: .3 }, grain: { value: .028 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time,vig,grain; varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
  void main(){ vec4 c=texture2D(tDiffuse,vUv); vec3 col=c.rgb; float l=dot(col,vec3(.299,.587,.114));
    col=mix(vec3(l),col,1.1); col=(col-.5)*1.05+.5; col+=vec3(.018,.006,-.012)*l+vec3(-.006,0.,.012)*(1.-l);
    vec2 d=vUv-.5; col*=1.-vig*dot(d,d)*1.8; col+=(h(vUv*vec2(1733.,977.)+fract(time))-.5)*grain;
    gl_FragColor=vec4(col,c.a); }`,
};
function makeComposer(samples, fxaa) {
  const r = R.renderer, sz = r.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(sz.x, sz.y, { type: THREE.HalfFloatType, samples });
  const c = new EffectComposer(r, rt);
  c.addPass(new RenderPass(R.scene, R.cam));
  R.vmPass = new RenderPass(R.vmScene, R.vmCam); R.vmPass.clear = false; R.vmPass.clearDepth = true; c.addPass(R.vmPass);
  R.bloom = new UnrealBloomPass(new THREE.Vector2(sz.x / 2, sz.y / 2), .28, .45, .92); c.addPass(R.bloom);
  c.addPass(new OutputPass());
  R.grade = new ShaderPass(GradeShader); c.addPass(R.grade);
  R.fxaa = fxaa ? new ShaderPass(FXAAShader) : null; if (R.fxaa) c.addPass(R.fxaa);
  return c;
}
export function setQuality(lv) {
  Q.level = lv; const r = R.renderer, dpr = devicePixelRatio || 1;
  r.setPixelRatio(lv === 'high' ? Math.min(dpr, 2) : lv === 'mid' ? Math.min(dpr, 1.5) : Math.min(dpr, 1));
  R.sun.castShadow = lv !== 'low';
  const ms = lv === 'high' ? 2048 : 1024;
  if (R.sun.shadow.mapSize.x !== ms) { R.sun.shadow.mapSize.set(ms, ms); if (R.sun.shadow.map) { R.sun.shadow.map.dispose(); R.sun.shadow.map = null; } }
  R.lamps.forEach((l, i) => (l.visible = lv === 'high' || (lv === 'mid' && i % 2 === 0)));
  R.beams.visible = lv !== 'low'; R.motes.visible = lv !== 'low';
  if (R.comp) { R.comp.renderTarget1.dispose(); R.comp.renderTarget2.dispose(); R.comp = null; }
  if (lv !== 'low') R.comp = makeComposer(lv === 'high' ? 4 : 0, lv === 'mid');
  resizeGfx();
}
export function resizeGfx() {
  const w = innerWidth, h = innerHeight, r = R.renderer; r.setSize(w, h, false);
  R.cam.aspect = w / h; R.cam.updateProjectionMatrix(); R.vmCam.aspect = w / h; R.vmCam.updateProjectionMatrix();
  if (R.comp) { R.comp.setPixelRatio(r.getPixelRatio()); R.comp.setSize(w, h); if (R.fxaa) R.fxaa.material.uniforms.resolution.value.set(1 / (w * r.getPixelRatio()), 1 / (h * r.getPixelRatio())); }
  const sc = h * r.getPixelRatio() / (2 * Math.tan(R.cam.fov * PI / 360));
  for (const p of [R.pfxA, R.pfxN, R.pfxS]) if (p) p.mat.uniforms.scale.value = sc;
}
export function renderFrame(t) {
  const vm = R.vm.root.visible;
  if (R.comp) { R.vmPass.enabled = vm; R.grade.uniforms.time.value = t; R.comp.render(); }
  else { const r = R.renderer; r.autoClear = false; r.clear(); r.render(R.scene, R.cam); if (vm) { r.clearDepth(); r.render(R.vmScene, R.vmCam); } }
}
function viewModel() {
  const s = (R.vmScene = new THREE.Scene()); R.vmCam = new THREE.PerspectiveCamera(55, 1, .01, 10);
  s.add(new THREE.HemisphereLight(0xfff4e6, 0x6a5440, .8)); const d = new THREE.DirectionalLight(0xffe2c0, 2.4); d.position.set(-2, 3, 1); s.add(d);
  const A = viewArms(), vm = (R.vm = { root: new THREE.Group(), pivot: new THREE.Group(), r: A.r, l: A.l, wpn: {} });
  s.add(vm.root); vm.root.add(vm.pivot); vm.pivot.add(A.r.a, A.l.a);
  for (const k of ['bat', 'pistol', 'ak', 'rpg', 'tackle']) { const w = buildWeapon(k); w.visible = false; w.scale.setScalar(k === 'pistol' ? 1 : .86); vm.pivot.add(w); vm.wpn[k] = w; }
  vm.root.visible = false;
}
// 강조 테두리 (프레넬 림 라이트) — 수능 종료 후 빨강/초록, 해킹 찾기
const RIM = {};
export function rimMat(hex) {
  return RIM[hex] || (RIM[hex] = new THREE.ShaderMaterial({ uniforms: { col: { value: new THREE.Color(hex) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 col; varying vec3 vN; varying vec3 vV; void main(){ float f=pow(1.-abs(dot(vN,vV)),2.); gl_FragColor=vec4(col*(f*2.4+.1),1.); }' }));
}
export function setRim(st, hex) {
  if (!hex) { if (st.rims) st.rims.forEach((m) => (m.visible = false)); return; }
  if (!st.rims) { st.rims = []; st.fig.traverse((o) => { if (o.isMesh && !o.userData.noTint && !o.userData.rim) { const m = new THREE.Mesh(o.geometry, rimMat(hex)); m.userData.rim = true; m.renderOrder = 7; o.add(m); st.rims.push(m); } }); }
  st.rims.forEach((m) => { m.visible = true; m.material = rimMat(hex); });
}

// ───────── 절차적 텍스처 ─────────
function grain(g, w, h, dark, n, vertical, amp = 4) {
  for (let i = 0; i < n; i++) {
    const p = Math.random() * (vertical ? w : h), a = rand(amp * .3, amp), fr = rand(.004, .02), ph = rand(0, 6), L = vertical ? h : w;
    g.strokeStyle = dark; g.globalAlpha = rand(.04, .26); g.lineWidth = rand(.5, 2.4); g.beginPath();
    for (let s = 0; s <= L; s += 6) { const o = p + Math.sin(s * fr + ph) * a + Math.sin(s * fr * 3.3 + ph) * a * .3; vertical ? g.lineTo(o, s) : g.lineTo(s, o); }
    g.stroke();
  }
  g.globalAlpha = 1;
}
function noise(g, w, h, n, a, sz = 2) { for (let i = 0; i < n; i++) { g.fillStyle = Math.random() < .5 ? `rgba(0,0,0,${rand(0, a)})` : `rgba(255,255,255,${rand(0, a)})`; g.fillRect(rand(0, w), rand(0, h), sz, sz); } }
export function normalFrom(hc, st = 2) {
  const w = hc.width, h = hc.height, src = hc.getContext('2d').getImageData(0, 0, w, h).data, out = mkCanvas(w, h), og = out.getContext('2d'), od = og.createImageData(w, h), d = od.data;
  const H = (x, y) => src[((((y + h) % h) * w) + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x - 1, y) - H(x + 1, y)) * st, dy = (H(x, y + 1) - H(x, y - 1)) * st, l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (dx / l * .5 + .5) * 255; d[i + 1] = (dy / l * .5 + .5) * 255; d[i + 2] = (1 / l * .5 + .5) * 255; d[i + 3] = 255;
  }
  og.putImageData(od, 0, 0); return out;
}
function woodTex(w, h, base, dark, vertical, n = 120, knots = 2) {
  const c = mkCanvas(w, h), g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, w, h);
  grain(g, w, h, dark, n, vertical, 5);
  for (let k = 0; k < knots; k++) { const x = rand(0, w), y = rand(0, h); g.strokeStyle = dark; for (let r = 2; r < 18; r += 3) { g.globalAlpha = .15; g.beginPath(); g.ellipse(x, y, vertical ? r * .5 : r * 1.8, vertical ? r * 1.8 : r * .5, 0, 0, 7); g.stroke(); } }
  g.globalAlpha = 1; noise(g, w, h, w * h / 60, .05); return c;
}
function textures() {
  const T = (R.tex = {});
  const S = 1024, c = mkCanvas(S, S), g = c.getContext('2d'), hc = mkCanvas(512, 512), hg = hc.getContext('2d'), rc = mkCanvas(512, 512), rg = rc.getContext('2d');
  hg.fillStyle = '#fff'; hg.fillRect(0, 0, 512, 512); rg.fillStyle = '#6a6a6a'; rg.fillRect(0, 0, 512, 512);
  const ph = S / 8;
  for (let r = 0; r < 8; r++) {
    let x = -((r % 2) * 256) - ri(0, 120);
    while (x < S) {
      const w = ri(340, 520), l = rand(-7, 7);
      g.fillStyle = `hsl(${32 + rand(-3, 3)},${30 + rand(-5, 5)}%,${55 + l}%)`; g.fillRect(x, r * ph, w, ph);
      g.save(); g.beginPath(); g.rect(x, r * ph, w, ph); g.clip(); g.translate(x, r * ph); grain(g, w, ph, '#5a3412', 26, false, 3); g.restore();
      g.fillStyle = 'rgba(40,22,8,.75)'; g.fillRect(x, r * ph, 3, ph);
      hg.fillStyle = '#000'; hg.fillRect(x / 2, r * ph / 2, 1.5, ph / 2);
      rg.fillStyle = `rgb(${90 + l * 6},${90 + l * 6},${90 + l * 6})`; rg.fillRect(x / 2 + 1, r * ph / 2 + 1, w / 2 - 2, ph / 2 - 2);
      x += w;
    }
    g.fillStyle = 'rgba(40,22,8,.8)'; g.fillRect(0, r * ph, S, 3); hg.fillStyle = '#000'; hg.fillRect(0, r * ph / 2, 512, 1.5);
  }
  for (let i = 0; i < 60; i++) { rg.strokeStyle = `rgba(200,200,200,${rand(.1, .3)})`; rg.lineWidth = rand(1, 3); rg.beginPath(); const x = rand(0, 512), y = rand(0, 512); rg.moveTo(x, y); rg.lineTo(x + rand(-40, 40), y + rand(-8, 8)); rg.stroke(); }
  noise(g, S, S, 40000, .04); noise(hg, 512, 512, 20000, .06);
  T.floor = ctex(c, 3.5, 4); T.floorN = ctex(normalFrom(hc, 3), 3.5, 4, true); T.floorR = ctex(rc, 3.5, 4, true);
  const wc = mkCanvas(512, 512), wg = wc.getContext('2d'), wh = mkCanvas(256, 256), whg = wh.getContext('2d');
  wg.fillStyle = '#ece3d0'; wg.fillRect(0, 0, 512, 512); noise(wg, 512, 512, 9000, .035);
  whg.fillStyle = '#888'; whg.fillRect(0, 0, 256, 256); noise(whg, 256, 256, 6000, .25, 1);
  const wy = 512 * (1 - .95 / 3.2);
  wg.fillStyle = '#b4875a'; wg.fillRect(0, wy, 512, 512 - wy);
  wg.save(); wg.beginPath(); wg.rect(0, wy, 512, 512 - wy); wg.clip(); grain(wg, 512, 512, '#5e3a1a', 70, true, 2); wg.restore();
  for (let x = 0; x < 512; x += 64) { wg.fillStyle = 'rgba(50,28,10,.55)'; wg.fillRect(x, wy, 3, 512); whg.fillStyle = '#222'; whg.fillRect(x / 2, wy / 2, 2, 256); }
  wg.fillStyle = '#7d5532'; wg.fillRect(0, wy - 4, 512, 12); whg.fillStyle = '#fff'; whg.fillRect(0, wy / 2 - 2, 256, 6);
  wg.fillStyle = '#4e3220'; wg.fillRect(0, 496, 512, 16); whg.fillStyle = '#ddd'; whg.fillRect(0, 248, 256, 8);
  T.wall = ctex(wc); T.wallN = ctex(normalFrom(wh, 2), 1, 1, true);
  const cc = mkCanvas(256, 256), cg = cc.getContext('2d'); cg.fillStyle = '#f1efe9'; cg.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) { cg.fillStyle = `rgba(120,110,100,${rand(.05, .25)})`; cg.fillRect(rand(0, 256), rand(0, 256), rand(1, 2.5), rand(1, 2.5)); }
  cg.fillStyle = '#c8c3b8'; cg.fillRect(0, 0, 256, 4); cg.fillRect(0, 0, 4, 256);
  T.ceil = ctex(cc, 7, 8);
  T.desk = ctex(woodTex(512, 512, '#d9b88a', '#8a5a2b', false, 110, 1));
  T.chair = ctex(woodTex(256, 256, '#c99e6c', '#6e4520', false, 70, 1));
  T.dark = ctex(woodTex(512, 256, '#6a4429', '#2a1608', false, 90, 2));
  const bc = woodTex(512, 512, '#e2b77c', '#9a6430', true, 70, 0), bg = bc.getContext('2d');
  bg.save(); bg.translate(256, 120); bg.rotate(-HP); bg.fillStyle = '#1b1b1b'; bg.font = `bold 46px ${FT}`; bg.textAlign = 'center'; bg.fillText('KIMJAM', 0, 0); bg.fillStyle = '#c4161c'; bg.font = `bold 22px ${F}`; bg.fillText('PRO MODEL 34', 0, 34); bg.restore();
  T.bat = ctex(bc);
  T.rifle = ctex(woodTex(256, 256, '#8b3d17', '#3a1404', false, 80, 1));
  R.boardC = mkCanvas(1024, 256); R.boardTex = ctex(R.boardC);
  const bn = mkCanvas(256, 64), bng = bn.getContext('2d'); bng.fillStyle = '#808080'; bng.fillRect(0, 0, 256, 64); noise(bng, 256, 64, 4000, .3, 1); T.boardN = ctex(normalFrom(bn, 1), 1, 1, true);
}
const skyCanvas = () => {
  const c = mkCanvas(512, 320), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 320); gr.addColorStop(0, '#5fa6ea'); gr.addColorStop(.65, '#bfe0f6'); gr.addColorStop(1, '#f2f6f8');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 320);
  for (let i = 0; i < 9; i++) { const x = rand(0, 512), y = rand(15, 120); for (let k = 0; k < 6; k++) { const rr = rand(18, 34); const cg = g.createRadialGradient(x + k * 22, y, 0, x + k * 22, y, rr); cg.addColorStop(0, 'rgba(255,255,255,.9)'); cg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = cg; g.fillRect(x + k * 22 - rr, y - rr, rr * 2, rr * 2); } }
  for (let x = 0; x < 512; x += rand(40, 70)) { const bh = rand(70, 140), bw = rand(36, 58); g.fillStyle = `hsl(210,${rand(5, 15)}%,${rand(62, 75)}%)`; g.fillRect(x, 320 - bh - 40, bw, bh + 40); g.fillStyle = 'rgba(255,255,255,.45)'; for (let y = 320 - bh - 30; y < 300; y += 10) for (let wx = x + 4; wx < x + bw - 6; wx += 9) g.fillRect(wx, y, 5, 5); }
  const cols = ['#f0c02a', '#e59a22', '#d97a1e', '#cfa92a', '#a7b34c', '#f6d34a'];
  for (let i = 0; i < 70; i++) { const x = rand(0, 512), y = rand(240, 300), rr = rand(14, 26); const tg = g.createRadialGradient(x - 4, y - 4, 2, x, y, rr); const cl = pick(cols); tg.addColorStop(0, '#fff6c0'); tg.addColorStop(.25, cl); tg.addColorStop(1, 'rgba(90,60,10,.9)'); g.fillStyle = tg; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill(); }
  g.fillStyle = '#6e6e6a'; g.fillRect(0, 300, 512, 20);
  return c;
};

function initMats() {
  R.mV = stdV(); R.mVRed = stdV({ color: 0xff8a8a, emissive: 0x7a0c0c }); R.mVGreen = stdV({ color: 0xa8ffb8, emissive: 0x0a5a1c });
  R.mVOrange = stdV({ color: 0xffc070, emissive: 0x6a3800 }); R.mVSoot = stdV({ color: 0x404040 });
  R.mBasicV = new THREE.MeshBasicMaterial({ vertexColors: true });
  R.ledOn = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.2, 4, 6) }); R.ledOff = new THREE.MeshBasicMaterial({ color: 0x0a1822 });
  R.lens = new THREE.MeshStandardMaterial({ color: 0xdff2ff, transparent: true, opacity: .16, roughness: .02, metalness: .1, depthWrite: false });
  R.lensAI = new THREE.MeshStandardMaterial({ color: 0x5a9cff, transparent: true, opacity: .32, roughness: .02, metalness: .3, depthWrite: false });
  R.lensAIOn = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(.6, 2.2, 2.6), transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending });
  const T = R.tex;
  R.mDesk = new THREE.MeshStandardMaterial({ map: T.desk, roughness: .36 });
  R.mChairW = new THREE.MeshStandardMaterial({ map: T.chair, roughness: .42 });
  R.mDark = new THREE.MeshStandardMaterial({ map: T.dark, roughness: .32 });
  R.mBat = new THREE.MeshStandardMaterial({ map: T.bat, roughness: .3 });
  R.mRifle = new THREE.MeshStandardMaterial({ map: T.rifle, roughness: .38 });
  R.mMetal = new THREE.MeshStandardMaterial({ color: 0x9aa1aa, metalness: .85, roughness: .35 });
  R.mSteel = new THREE.MeshStandardMaterial({ color: 0xd6dbe2, metalness: 1, roughness: .16 });
}

function lights() {
  const s = R.scene;
  s.add(new THREE.HemisphereLight(0xf4f6ff, 0x6a5a48, .6));
  const sun = new THREE.DirectionalLight(0xfff0dc, 3.6); sun.position.copy(SUN_POS); sun.castShadow = true;
  const sh = sun.shadow; sh.mapSize.set(2048, 2048); Object.assign(sh.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 40 });
  sh.bias = -.0003; sh.normalBias = .025; sh.radius = 3; s.add(sun, sun.target); R.sun = sun;
  R.lamps = [];
  for (const x of [-3.5, 3.5]) for (const z of [-3.6, 3.6]) { const l = new THREE.PointLight(0xf6f8ff, 9, 0, 2); l.position.set(x, 2.95, z); s.add(l); R.lamps.push(l); }
  R.flashL = new THREE.PointLight(0xffa040, 0, 16, 2); s.add(R.flashL);
}
function envMap() {
  const pm = new THREE.PMREMGenerator(R.renderer), es = new THREE.Scene();
  const bx = new THREE.Mesh(new THREE.BoxGeometry(14, 3.2, 16), new THREE.MeshBasicMaterial({ color: 0x7d705f, side: THREE.BackSide })); bx.position.y = 1.6; es.add(bx);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(14, 16), new THREE.MeshBasicMaterial({ color: 0x5a3a22 })); fl.rotation.x = -HP; fl.position.y = .02; es.add(fl);
  const lm = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(9, 9, 8.4) });
  for (const x of [-3.5, 0, 3.5]) for (const z of [-4.5, 0, 4.5]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(1.3, .3), lm); p.rotation.x = HP; p.position.set(x, 3.15, z); es.add(p); }
  const wm = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(4, 4.6, 5.4) });
  for (const z of [-4.2, 0, 4.2]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.5), wm); p.rotation.y = HP; p.position.set(-6.95, 1.75, z); es.add(p); }
  const bd = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 1.6), new THREE.MeshBasicMaterial({ color: 0x1e3328 })); bd.position.set(0, 1.6, -7.95); es.add(bd);
  R.scene.environment = pm.fromScene(es, .03).texture; pm.dispose();
}

// ───────── 칠판 / 시계 ─────────
export function drawBoard(info) {
  const g = R.boardC.getContext('2d'), W = 1024, H = 256;
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#22402f'); gr.addColorStop(1, '#1c3628'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 46; i++) { g.fillStyle = `rgba(255,255,255,${rand(.012, .04)})`; g.beginPath(); g.ellipse(rand(0, W), rand(0, H), rand(30, 140), rand(8, 26), rand(-.3, .3), 0, 7); g.fill(); }
  noise(g, W, H, 9000, .05, 1);
  const chalk = (txt, x, y, font, col, al = 'center') => { g.font = font; g.textAlign = al; g.textBaseline = 'middle'; g.fillStyle = col; g.globalAlpha = .9; g.fillText(txt, x, y); g.globalAlpha = .25; g.fillText(txt, x + .8, y + .6); g.globalAlpha = 1; };
  chalk('2027학년도 대학수학능력시험', W / 2, 32, `bold 26px ${F}`, '#f4f4ec');
  g.save(); g.shadowColor = 'rgba(255,255,210,.35)'; g.shadowBlur = 8; chalk('수능 화이팅!', W / 2, 138, `96px ${FT}`, '#fff2a0'); g.restore();
  g.strokeStyle = 'rgba(255,180,200,.85)'; g.lineWidth = 4; g.beginPath(); g.moveTo(300, 196); g.quadraticCurveTo(512, 214, 724, 196); g.stroke();
  const star = (x, y, r) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = i / 10 * 2 * PI - HP, rr = i % 2 ? r * .45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill(); };
  g.fillStyle = 'rgba(255,230,128,.9)'; star(258, 120, 16); star(770, 152, 12); star(286, 168, 9);
  ['제 12 시험실', '감독관 2명', '전자기기 제출!'].forEach((t, i) => chalk(t, 22, 78 + i * 34, `bold 21px ${F}`, '#f4f4ec', 'left'));
  chalk('AI 안경 반입 금지', 22, 180, `bold 21px ${F}`, '#ff9d9d', 'left');
  chalk(`${info.p} ${info.s}${info.s ? ' 영역' : ''}`, W - 22, 78, `bold 21px ${F}`, '#f4f4ec', 'right'); chalk(info.time || '', W - 22, 112, `bold 21px ${F}`, '#f4f4ec', 'right');
  chalk('답안지 마킹 확인', W - 22, 146, `bold 21px ${F}`, '#bfe3ff', 'right'); chalk('수험번호 확인', W - 22, 180, `bold 21px ${F}`, '#f4f4ec', 'right');
  chalk('- 끝까지 포기하지 마세요 -', W / 2, 232, `18px ${F}`, 'rgba(244,244,236,.85)');
  R.boardTex.needsUpdate = true;
}
export function setClock(min) { R.clockM.rotation.z = -(min % 60) / 60 * 2 * PI; R.clockH.rotation.z = -((min / 60) % 12) / 12 * 2 * PI; }
export function updDecor(c) { R.dec.F.visible = c.z > -7.85; R.dec.B.visible = c.z < 7.5; R.dec.L.visible = c.x > -6.8; R.dec.Rt.visible = c.x < 6.9; R.dec.C.visible = c.y < 3.1; }
function canvasPlane(c, w, h, rough = .8) { return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: ctex(c), roughness: rough })); }
function flagCanvas() {
  const c = mkCanvas(300, 200), g = c.getContext('2d'); g.fillStyle = '#fbfbf8'; g.fillRect(0, 0, 300, 200);
  g.save(); g.translate(150, 100); g.rotate(Math.atan2(2, 3)); const r = 50;
  g.fillStyle = '#cd2e3a'; g.beginPath(); g.arc(0, 0, r, PI, 0); g.fill(); g.fillStyle = '#0047a0'; g.beginPath(); g.arc(0, 0, r, 0, PI); g.fill();
  g.fillStyle = '#cd2e3a'; g.beginPath(); g.arc(-r / 2, 0, r / 2, 0, 7); g.fill(); g.fillStyle = '#0047a0'; g.beginPath(); g.arc(r / 2, 0, r / 2, 0, 7); g.fill(); g.restore();
  const tri = (ang, pat) => { g.save(); g.translate(150, 100); g.rotate(ang); g.translate(0, -84); g.fillStyle = '#111'; pat.forEach((s, i) => { const y = -10 + i * 8.5; if (s) g.fillRect(-17, y, 34, 5.5); else { g.fillRect(-17, y, 15, 5.5); g.fillRect(2, y, 15, 5.5); } }); g.restore(); };
  const a = Math.atan2(2, 3); tri(-HP + a - .05, [1, 1, 1]); tri(HP + a + .05, [0, 0, 0]); tri(HP - a - .05, [1, 0, 1]); tri(-HP - a + .05, [0, 1, 0]);
  return c;
}
function clockCanvas() {
  const c = mkCanvas(256, 256), g = c.getContext('2d'); const gr = g.createRadialGradient(128, 110, 10, 128, 128, 128); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#e8e8e2');
  g.fillStyle = gr; g.beginPath(); g.arc(128, 128, 126, 0, 7); g.fill(); g.fillStyle = '#222'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold 28px ${F}`;
  for (let i = 1; i <= 12; i++) { const a = i / 12 * 2 * PI; g.fillText(i, 128 + Math.sin(a) * 94, 128 - Math.cos(a) * 94); }
  for (let i = 0; i < 60; i++) { g.save(); g.translate(128, 128); g.rotate(i / 60 * 2 * PI); g.fillRect(-1, -122, 2, i % 5 ? 6 : 13); g.restore(); }
  g.font = `bold 13px ${F}`; g.fillStyle = '#c22'; g.fillText('SCHOOL', 128, 170); return c;
}
function noticeCanvas() {
  const c = mkCanvas(1024, 224), g = c.getContext('2d'); g.fillStyle = '#b8875a'; g.fillRect(0, 0, 1024, 224); noise(g, 1024, 224, 12000, .2, 2);
  const notes = [['#fffbe0', '수능 D-DAY', '#c22'], ['#e0f3ff', '휴대폰·전자기기\n제출', '#124'], ['#ffe0ea', 'AI 안경 적발 시\n즉시 퇴실', '#c22'], ['#e8ffe0', '정숙', '#262'], ['#fff', '시험 시간표\n1교시 08:40\n2교시 10:30', '#222']];
  notes.forEach(([bg, txt, fg], i) => {
    const x = 30 + i * 200, y = 20 + (i % 2) * 10; g.save(); g.translate(x + 84, y + 88); g.rotate(rand(-.06, .06));
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(-80, -76, 168, 168); g.fillStyle = bg; g.fillRect(-84, -84, 168, 168);
    g.fillStyle = '#d33'; g.beginPath(); g.arc(0, -72, 7, 0, 7); g.fill(); g.fillStyle = fg; g.textAlign = 'center'; g.font = `bold 26px ${F}`;
    txt.split('\n').forEach((l, k, a) => g.fillText(l, 0, 10 + (k - (a.length - 1) / 2) * 32)); g.restore();
  });
  return c;
}
function omrCanvas() {
  const c = mkCanvas(128, 256), g = c.getContext('2d'); g.fillStyle = '#fff6f8'; g.fillRect(0, 0, 128, 256); g.fillStyle = '#e8577a'; g.fillRect(0, 0, 128, 22);
  g.fillStyle = '#fff'; g.font = `bold 11px ${F}`; g.fillText('답 안 지', 40, 15); g.strokeStyle = '#e8577a'; g.lineWidth = 1;
  for (let col = 0; col < 3; col++) for (let r = 0; r < 20; r++) for (let k = 0; k < 5; k++) { const x = 10 + col * 40 + k * 6.8, y = 34 + r * 11; if (Math.random() < .2) { g.fillStyle = '#111'; g.fillRect(x - 2, y - 3.5, 4, 7); } else g.strokeRect(x - 2, y - 3.5, 4, 7); }
  return c;
}

// ───────── 교실 ─────────
function room() {
  const sc = R.scene, T = R.tex;
  R.dec = {}; for (const k of ['F', 'B', 'L', 'Rt', 'C']) { R.dec[k] = new THREE.Group(); sc.add(R.dec[k]); }
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(14, 16), new THREE.MeshStandardMaterial({ map: T.floor, normalMap: T.floorN, normalScale: new THREE.Vector2(.6, .6), roughnessMap: T.floorR, roughness: 1, envMapIntensity: 1.2 }));
  fl.rotation.x = -HP; fl.receiveShadow = true; sc.add(fl);
  const ce = new THREE.Mesh(new THREE.PlaneGeometry(14, 16), new THREE.MeshStandardMaterial({ map: T.ceil, roughness: .95 })); ce.rotation.x = HP; ce.position.y = 3.2; sc.add(ce);
  const wall = (w, h, x, y, z, ry, y0, cast = false) => {
    const t = T.wall.clone(), n = T.wallN.clone();
    for (const q of [t, n]) { q.repeat.set(w / 3, h / 3.2); q.offset.set(0, y0 / 3.2); q.needsUpdate = true; }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, normalMap: n, normalScale: new THREE.Vector2(.5, .5), roughness: .88 }));
    m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; m.castShadow = cast; sc.add(m); return m;
  };
  wall(14, 3.2, 0, 1.6, -8, 0, 0); wall(14, 3.2, 0, 1.6, 8, PI, 0);
  wall(3, 3.2, 7, 1.6, -6.5, -HP, 0); wall(12, 3.2, 7, 1.6, 2, -HP, 0); wall(1, 1, 7, 2.7, -4.5, -HP, 2.2);
  // 왼쪽 벽: 창문 구멍을 남겨 햇빛이 창으로만 들어오게
  wall(16, .98, -7, .49, 0, HP, 0, true); wall(16, .68, -7, 2.86, 0, HP, 2.52, true);
  for (const [z0, z1] of [[-8, -5.6], [-2.8, -1.4], [1.4, 2.8], [5.6, 8]]) wall(z1 - z0, 1.54, -7, 1.75, (z0 + z1) / 2, HP, .98, true);
  const hf = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5), lam('#9c9c96', { roughness: .4 })); hf.rotation.x = -HP; hf.position.set(8.6, .001, -4.5); sc.add(hf);
  const hw = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.2), lam('#dcd8cf', { roughness: .9 })); hw.position.set(10.2, 1.6, -4.5); hw.rotation.y = -HP; sc.add(hw);
  const hc = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5), lam('#f2f0ea')); hc.rotation.x = HP; hc.position.set(8.6, 3.2, -4.5); sc.add(hc);
  const sky = new THREE.MeshBasicMaterial({ map: ctex(skyCanvas()), color: new THREE.Color().setRGB(1.55, 1.55, 1.55) }), fp = [];
  const glass = new THREE.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: .12, roughness: .02, metalness: .2, depthWrite: false });
  for (const z of [-4.2, 0, 4.2]) {
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.54), sky); gl.position.set(-7.25, 1.75, z); gl.rotation.y = HP; sc.add(gl);
    const gp = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.54), glass); gp.position.set(-6.97, 1.75, z); gp.rotation.y = HP; R.dec.L.add(gp);
    const wc = '#eef0f2', km = K.metal;
    fp.push({ g: B(.3, .07, 2.92), c: wc, p: [-7.08, 2.52, z], k: km }, { g: B(.3, .07, 2.92), c: wc, p: [-7.08, .98, z], k: km },
      { g: B(.3, 1.6, .07), c: wc, p: [-7.08, 1.75, z - 1.43], k: km }, { g: B(.3, 1.6, .07), c: wc, p: [-7.08, 1.75, z + 1.43], k: km },
      { g: B(.06, 1.5, .05), c: '#dfe3e8', p: [-6.98, 1.75, z], k: km }, { g: B(.05, .04, 2.8), c: '#dfe3e8', p: [-6.98, 1.3, z], k: km },
      { g: B(.28, .05, 3), c: '#e9e4da', p: [-6.86, .955, z], k: K.plastic },
      { g: B(.12, .55, 2.2), c: '#c7ccd2', p: [-6.9, .45, z], k: K.metal });
    for (let i = 0; i < 9; i++) fp.push({ g: B(.02, .5, .012), c: '#b4bac2', p: [-6.83, .45, z - 1 + i * .25], k: K.metal });
    for (const s of [-1, 1]) for (let f = 0; f < 4; f++) fp.push({ g: CY(.05, .055, 1.95, 10), c: '#a9c2ab', p: [-6.86, 1.98, z + s * (1.48 + f * .07)], s: [.6, 1, 1], k: K.cloth });
    fp.push({ g: CY(.015, .015, 3.4, 8), c: '#c0c4ca', p: [-6.86, 2.97, z], r: [HP, 0, 0], k: K.chrome });
    for (const s of [-1, 1]) fp.push({ g: CY(.035, .035, 1.38, 12), c: '#ece6d8', p: [-6.9, 2.56, z + s * .7], r: [HP, 0, 0], k: K.plastic }, { g: B(.008, .5, 1.36), c: '#ece4d0', p: [-6.9, 2.29, z + s * .7], k: K.cloth }, { g: B(.016, .025, 1.36), c: '#d8d0bc', p: [-6.9, 2.04, z + s * .7], k: K.plastic });
  }
  R.dec.L.add(M(merge(fp)));
  const bd = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 1.65), new THREE.MeshStandardMaterial({ map: R.boardTex, normalMap: T.boardN, normalScale: new THREE.Vector2(.3, .3), roughness: .92 })); bd.position.set(0, 1.62, -7.955); sc.add(bd);
  const al = '#b9c0c8', fr = [
    { g: B(6.8, .08, .06), c: al, p: [0, 2.48, -7.95], k: K.metal }, { g: B(6.8, .08, .06), c: al, p: [0, .76, -7.95], k: K.metal },
    { g: B(.08, 1.8, .06), c: al, p: [-3.36, 1.62, -7.95], k: K.metal }, { g: B(.08, 1.8, .06), c: al, p: [3.36, 1.62, -7.95], k: K.metal },
    { g: B(6.7, .035, .14), c: al, p: [0, .76, -7.88], k: K.metal },
    { g: CY(.007, .007, .09, 8), c: '#fff', p: [-1.2, .785, -7.86], r: [0, 0, HP], k: K.paper }, { g: CY(.007, .007, .07, 8), c: '#ffe36b', p: [-1.05, .785, -7.86], r: [0, 0, HP], k: K.paper },
    { g: CY(.007, .007, .05, 8), c: '#ff9db0', p: [-.95, .785, -7.84], r: [0, .4, HP], k: K.paper },
    { g: B(.14, .035, .05), c: '#2a2a2a', p: [1.4, .795, -7.87], k: K.plastic }, { g: B(.14, .015, .05), c: '#d8c49a', p: [1.4, .773, -7.87], k: K.cloth },
    { g: B(.5, .32, .2), c: '#ededed', p: [-1.8, 2.84, -7.88], k: K.plastic }, { g: B(.42, .22, .01), c: '#3a3a3a', p: [-1.8, 2.84, -7.78], k: K.cloth },
    { g: B(.5, .32, .2), c: '#ededed', p: [1.8, 2.84, -7.88], k: K.plastic }, { g: B(.42, .22, .01), c: '#3a3a3a', p: [1.8, 2.84, -7.78], k: K.cloth },
    { g: B(7.2, .12, 1.3), c: '#6b4a2e', p: [0, .06, -7.35], k: K.wood },
    { g: B(1.5, .9, .05), c: '#111', p: [5.4, 2.3, -7.93], k: K.gloss }, { g: B(1.56, .96, .04), c: '#2a2a2a', p: [5.4, 2.3, -7.955], k: K.plastic },
    { g: B(.5, 1.85, .45), c: '#f1f1ee', p: [-6.4, .925, -7.6], k: K.plastic }, { g: B(.44, .5, .01), c: '#9aa0a6', p: [-6.4, 1.45, -7.37], k: K.metal },
    { g: B(.3, .06, .01), c: '#4ac', p: [-6.4, 1.05, -7.37], k: K.gloss },
  ];
  for (let i = 0; i < 8; i++) fr.push({ g: B(.42, .012, .02), c: '#c9ced4', p: [-6.4, 1.3 - i * .06, -7.37], k: K.metal });
  R.dec.F.add(M(merge(fr)));
  const cf = new THREE.Mesh(new THREE.CircleGeometry(.3, 40), new THREE.MeshStandardMaterial({ map: ctex(clockCanvas()), roughness: .3 })); cf.position.set(3.85, 2.68, -7.945); sc.add(cf);
  R.dec.F.add(M(merge([{ g: TO(.3, .025, 10, 40), c: '#1c1c1c', p: [3.85, 2.68, -7.94], k: K.plastic }]), R.mV, false));
  const hand = (w, l, col) => { const g = new THREE.Group(); g.position.set(3.85, 2.68, -7.935); const m = new THREE.Mesh(B(w, l, .008), lam(col, { roughness: .4 })); m.position.y = l / 2 - .02; g.add(m); R.dec.F.add(g); return g; };
  R.clockH = hand(.022, .17, '#111'); R.clockM = hand(.014, .25, '#111'); setClock(8 * 60 + 40);
  const fg = canvasPlane(flagCanvas(), .9, .6, .85); fg.position.set(-3.85, 2.68, -7.95); sc.add(fg);
  const mc = mkCanvas(256, 96), mg = mc.getContext('2d'); mg.fillStyle = '#fbf7ec'; mg.fillRect(0, 0, 256, 96); mg.fillStyle = '#222'; mg.font = `52px ${FT}`; mg.textAlign = 'center'; mg.textBaseline = 'middle'; mg.fillText('성 실', 128, 50);
  const motto = canvasPlane(mc, .8, .3, .7); motto.position.set(0, 2.88, -7.945); sc.add(motto);
  R.dec.F.add(M(merge([{ g: B(.88, .38, .03), c: '#4a2e18', p: [0, 2.88, -7.965], k: K.wood }])));
  const lk = [{ g: B(12.6, 1.15, .45), c: '#8fa1b5', p: [0, .575, 7.76], k: [.45, .6] }, { g: B(12.7, .04, .48), c: '#71839a', p: [0, 1.17, 7.75], k: [.4, .6] }, { g: B(12.6, .015, .012), c: '#4e5c6b', p: [0, .58, 7.53], k: K.metal }];
  for (let i = 0; i <= 20; i++) lk.push({ g: B(.015, 1.12, .012), c: '#4e5c6b', p: [-6.3 + i * .63, .575, 7.53], k: K.metal });
  for (let i = 0; i < 20; i++) for (const y of [.86, .3]) { lk.push({ g: B(.09, .028, .035), c: '#e2e6ea', p: [-6.0 + i * .63, y, 7.52], k: K.chrome }, { g: B(.12, .06, .004), c: '#ffffff', p: [-6.18 + i * .63, y + .12, 7.528], k: K.paper }); for (let v = 0; v < 3; v++) lk.push({ g: B(.2, .008, .004), c: '#3e4a57', p: [-6.18 + i * .63, y - .12 + v * .02, 7.528], k: K.metal }); }
  R.dec.B.add(M(merge(lk)));
  const nb = canvasPlane(noticeCanvas(), 5, 1.1, .95); nb.position.set(0, 1.95, 7.955); nb.rotation.y = PI; sc.add(nb);
  R.dec.B.add(M(merge([{ g: B(5.12, .06, .05), c: '#5a3a20', p: [0, 2.53, 7.96], k: K.wood }, { g: B(5.12, .06, .05), c: '#5a3a20', p: [0, 1.37, 7.96], k: K.wood }])));
  const df = '#6e563f', dp = [{ g: B(.14, 2.25, .08), c: df, p: [6.98, 1.125, -5.04], k: K.wood }, { g: B(.14, 2.25, .08), c: df, p: [6.98, 1.125, -3.96], k: K.wood }, { g: B(.14, .08, 1.16), c: df, p: [6.98, 2.25, -4.5], k: K.wood }];
  dp.push({ g: B(.06, 2.15, 1), c: '#93714c', p: [6.97, 1.075, 6], k: K.wood }, { g: B(.08, 2.25, .08), c: df, p: [6.98, 1.125, 5.46], k: K.wood }, { g: B(.08, 2.25, .08), c: df, p: [6.98, 1.125, 6.54], k: K.wood }, { g: SP(.035), c: '#d8c06a', p: [6.92, 1.0, 6.4], k: K.chrome });
  dp.push({ g: B(.02, .22, .5), c: '#fff', p: [6.94, 2.45, -4.5], k: K.paper }, { g: B(.01, .14, .42), c: '#1a3b8a', p: [6.93, 2.45, -4.5], k: K.plastic });
  for (const [z0, z1] of [[-3.7, -.1], [.1, 3.7], [3.9, 5.3]]) {
    const L = z1 - z0, zc = (z0 + z1) / 2; dp.push({ g: B(.1, .05, L), c: '#c9ced4', p: [6.96, 2.86, zc], k: K.metal }, { g: B(.1, .05, L), c: '#c9ced4', p: [6.96, 2.29, zc], k: K.metal });
    for (let k = 0; k <= Math.round(L / .9); k++) dp.push({ g: B(.1, .6, .04), c: '#c9ced4', p: [6.96, 2.575, z0 + k * L / Math.round(L / .9)], k: K.metal });
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(L, .52), new THREE.MeshStandardMaterial({ color: 0xe6edf0, emissive: 0xb8c6cc, emissiveIntensity: .45, roughness: .18 })); fg.position.set(6.985, 2.575, zc); fg.rotation.y = -HP; R.dec.Rt.add(fg);
  }
  R.dec.Rt.add(M(merge(dp)));
  R.dec.B.add(M(merge([['#2a64b8', 6.35], ['#2f8a4a', 5.95], ['#6f757c', 5.55]].flatMap(([c, x]) => [{ g: CY(.17, .145, .52, 20), c, p: [x, .26, 7.08], k: K.plastic }, { g: CY(.175, .175, .03, 20), c, p: [x, .53, 7.08], k: K.plastic }, { g: B(.12, .002, .08), c: '#fff', p: [x, .4, 6.93], r: [HP, 0, 0], k: K.paper }]))));
  R.door = new THREE.Group(); R.door.position.set(6.97, 0, -4.0); R.dec.Rt.add(R.door);
  R.door.add(M(merge([{ g: B(.05, 2.15, 1), c: '#93714c', p: [0, 1.075, -.5], k: K.wood }, { g: B(.055, .55, .4), c: '#7d5f40', p: [0, 1.55, -.5], k: K.wood }, { g: CY(.02, .02, .12, 10), c: '#d8c06a', p: [-.06, 1.0, -.88], r: [0, 0, HP], k: K.chrome }, { g: B(.02, .16, .26), c: '#fff', p: [-.035, 1.95, -.5], k: K.paper }])));
  const lp = [], led = [];
  for (const x of [-3.5, 0, 3.5]) for (const z of [-4.5, 0, 4.5]) { lp.push({ g: B(1.26, .04, .66), c: '#e9ecef', p: [x, 3.18, z], k: K.metal }); led.push({ g: B(1.18, .01, .58), p: [x, 3.157, z] }); }
  for (const x of [-1.75, 1.75]) for (const z of [-2.25, 2.25]) {
    lp.push({ g: CY(.012, .012, .36, 8), c: '#f0f0ee', p: [x, 3.02, z], k: K.plastic }, { g: CY(.11, .085, .09, 20), c: '#f2f2f0', p: [x, 2.8, z], k: K.plastic }, { g: CY(.04, .04, .03, 12), c: '#d9dadc', p: [x, 2.74, z], k: K.chrome });
    for (let i = 0; i < 3; i++) { const a = i * 2.094 + x; lp.push({ g: B(.6, .008, .12), c: '#f4f4f2', p: [x + Math.cos(a) * .4, 2.77, z + Math.sin(a) * .4], r: [0, -a, .06], k: K.plastic }); }
  }
  R.dec.C.add(M(merge(lp), R.mV, false)); R.dec.C.add(new THREE.Mesh(merge(led), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(2.4, 2.45, 2.5) })));
}

// ───────── 창문 햇살 + 먼지 ─────────
function sunbeams() {
  const d = SUN_POS.clone().negate().normalize(), pos = [], al = [];
  const quad = (a, b, c, e, aa, ab, ac, ae) => { pos.push(...a, ...b, ...c, ...a, ...c, ...e); al.push(aa, ab, ac, aa, ac, ae); };
  R.beamBoxes = [];
  for (const zc of [-4.2, 0, 4.2]) {
    const W = [[.98, zc - 1.4], [.98, zc + 1.4], [2.04, zc + 1.4], [2.04, zc - 1.4]].map(([y, z]) => [-6.98, y, z]);
    const Fp = W.map(([x, y, z]) => { const t = y / -d.y; return [x + d.x * t, 0, z + d.z * t]; });
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(W[i], W[j], Fp[j], Fp[i], 1, 1, .1, .1); }
    R.beamBoxes.push({ W, Fp });
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('a', new THREE.Float32BufferAttribute(al, 1));
  const m = new THREE.ShaderMaterial({ uniforms: { col: { value: new THREE.Color(1, .9, .75) }, op: { value: .022 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float a; varying float va; void main(){ va=a; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 col; uniform float op; varying float va; void main(){ gl_FragColor=vec4(col*op*va,1.); }' });
  R.beams = new THREE.Mesh(g, m); R.beams.renderOrder = 4; R.scene.add(R.beams);
  const n = 220, mp = new Float32Array(n * 3); R.moteBase = [];
  for (let i = 0; i < n; i++) {
    const bx = pick(R.beamBoxes), y = lerp(.98, 2.04, Math.random()), z = lerp(bx.W[0][2], bx.W[1][2], Math.random()), tt = y / -d.y * Math.random();
    R.moteBase.push([-6.98 + d.x * tt, y + d.y * tt, z + d.z * tt, rand(0, 6)]);
  }
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  R.motes = new THREE.Points(mg, new THREE.PointsMaterial({ size: .022, map: R.glowTex, color: 0xffe0b0, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
  R.motes.frustumCulled = false; R.scene.add(R.motes);
}
export function updAmbient(t) {
  if (!R.motes.visible) return; const a = R.motes.geometry.attributes.position;
  R.moteBase.forEach(([x, y, z, ph], i) => a.setXYZ(i, x + Math.sin(t * .3 + ph) * .15, y + Math.sin(t * .2 + ph * 2) * .12, z + Math.cos(t * .25 + ph) * .15));
  a.needsUpdate = true;
}

// ───────── 교탁 + 감독관 의자 ─────────
export const CHAIR = { x: 0, z: -6.95 };
function furniture() {
  const sc = R.scene;
  const td = new THREE.Group(); td.position.set(0, 0, -6.0); sc.add(td);
  td.add(M(merge([{ g: B(1.8, .05, .8), p: [0, .8, 0] }, { g: B(1.8, .72, .03), p: [0, .42, .385] }, { g: B(.03, .76, .78), p: [-.885, .4, 0] }, { g: B(.03, .76, .78), p: [.885, .4, 0] }, { g: B(.45, .6, .74), p: [.6, .42, 0] }]), R.mDark));
  td.add(M(merge([{ g: B(.14, .025, .02), c: '#d8c06a', p: [.6, .62, -.38], k: K.chrome }, { g: B(.14, .025, .02), c: '#d8c06a', p: [.6, .32, -.38], k: K.chrome }, { g: B(.5, .14, .02), c: '#f3e7c4', p: [0, .62, .4], k: K.paper }])));
  const cp = [{ g: CA(.22, .06, 10), c: '#22252e', p: [0, .5, 0], s: [1.15, .35, 1.1], k: K.cloth }, { g: CA(.22, .3, 10), c: '#22252e', p: [0, .88, -.25], s: [1.1, 1, .3], r: [-.08, 0, 0], k: K.cloth }, { g: CY(.025, .025, .38), c: '#777', p: [0, .27, 0], k: K.chrome }, { g: B(.05, .05, .3), c: '#333', p: [0, .5, -.2], k: K.metal }];
  for (let i = 0; i < 5; i++) { const a = i / 5 * 2 * PI; cp.push({ g: B(.05, .035, .3), c: '#2a2a2a', p: [Math.sin(a) * .15, .07, Math.cos(a) * .15], r: [0, a, 0], k: K.plastic }, { g: SP(.035, 10, 8), c: '#151515', p: [Math.sin(a) * .29, .035, Math.cos(a) * .29], k: K.rubber }); }
  const ch = M(merge(cp)); ch.position.set(CHAIR.x, 0, CHAIR.z); sc.add(ch);
  R.shopRing = new THREE.Mesh(new THREE.RingGeometry(.48, .52, 64), new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: .4, depthWrite: false }));
  R.shopRing.rotation.x = -HP; R.shopRing.position.set(CHAIR.x, .135, CHAIR.z); sc.add(R.shopRing);
  const lc = mkCanvas(256, 64), g = lc.getContext('2d');
  g.fillStyle = 'rgba(20,24,36,.88)'; g.beginPath(); if (g.roundRect) g.roundRect(4, 6, 248, 52, 26); else g.rect(4, 6, 248, 52); g.fill(); g.strokeStyle = '#ffd23f'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#ffd23f'; g.font = `30px ${FT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('무기 상점', 128, 33);
  R.shopLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex(lc), depthTest: false, transparent: true, toneMapped: false })); R.shopLabel.scale.set(1, .25, 1); R.shopLabel.position.set(CHAIR.x, 1.55, CHAIR.z); sc.add(R.shopLabel);
}

// ───────── 무기 모델 (실제 비율 · 금속/나무/플라스틱 재질) ─────────
function meshes(group, sets) { for (const [mat, parts] of sets) if (parts.length) group.add(M(merge(parts), mat)); }
export function buildWeapon(k) {
  const g = new THREE.Group(); let mz = -.5, my = .07;
  const G = (c = '#24262a', kk = K.metal) => ({ c, k: kk });
  if (k === 'bat') {
    const prof = [[0, 0], [.03, 0], [.034, .008], [.032, .018], [.018, .026], [.016, .06], [.0158, .25], [.018, .36], [.025, .46], [.032, .55], [.0365, .63], [.0375, .78], [.036, .815], [.029, .835], [0, .842]];
    const grip = [{ g: CY(.0172, .0172, .2, 20), c: '#151515', p: [0, 0, .02], r: [HP, 0, 0], k: K.rubber }];
    for (let i = 0; i < 9; i++) grip.push({ g: TO(.0172, .0016, 6, 20), c: '#3a3a3a', p: [0, 0, .1 - i * .022], r: [.25, 0, 0], k: K.rubber });
    grip.push({ g: TO(.031, .003, 6, 24), c: '#c4161c', p: [0, 0, .105], k: K.gloss });
    meshes(g, [[R.mBat, [{ g: LA(prof, 32), r: [-HP, 0, 0], p: [0, 0, .12] }]], [R.mV, grip]]); mz = -.72; my = 0;
  } else if (k === 'pistol') {
    const v = [
      { g: B(.026, .032, .19), ...G('#2a2c30'), p: [0, .046, -.075] }, { g: B(.024, .024, .165), ...G('#1a1b1d', K.plastic), p: [0, .019, -.068] },
      { g: B(.027, .033, .009), c: '#ff6a00', p: [0, .046, -.172], k: K.plastic }, { g: CY(.005, .005, .012, 10), ...G('#0a0a0a'), p: [0, .046, -.178], r: [HP, 0, 0] },
      { g: B(.004, .007, .006), ...G('#111'), p: [0, .065, -.158] }, { g: B(.017, .007, .007), ...G('#111'), p: [0, .065, .012] },
      { g: B(.012, .006, .03), c: '#cfd4da', p: [.013, .052, -.05], k: K.chrome },
      { g: EX([[.014, .008], [-.028, .008], [-.046, -.098], [-.008, -.102], [.006, -.03]], .026, .005), c: '#1c1d20', k: [.7, 0] },
      { g: TO(.02, .0035, 6, 14, PI), ...G('#1a1b1d', K.plastic), p: [0, .006, -.032], r: [0, HP, PI] }, { g: B(.004, .016, .006), ...G('#222'), p: [0, -.002, -.025], r: [.3, 0, 0] },
      { g: B(.03, .008, .046), c: '#111', p: [0, -.1, .026], r: [-.32, 0, 0], k: K.plastic },
    ];
    for (let i = 0; i < 7; i++) v.push({ g: B(.0275, .026, .002), c: '#111', p: [0, .047, i * .004], k: K.metal });
    meshes(g, [[R.mV, v]]); mz = -.18; my = .046;
  } else if (k === 'ak') {
    const bk = [[.05, -.03], [.055, -.08], [.07, -.13], [.095, -.18], [.125, -.222]], fr = [[.11, -.03], [.118, -.08], [.136, -.125], [.163, -.166], [.195, -.2]];
    const metal = [
      { g: B(.046, .072, .38), ...G('#26282c'), p: [0, .028, -.1] }, { g: CA(.022, .3, 14), ...G('#2e3034'), p: [0, .062, -.08], r: [HP, 0, 0], s: [1, 1, .9] },
      { g: CY(.011, .011, .46, 14), ...G('#1d1e21'), p: [0, .018, -.52], r: [HP, 0, 0] }, { g: CY(.0105, .0105, .3, 12), ...G('#33353a'), p: [0, .052, -.36], r: [HP, 0, 0] },
      { g: CY(.015, .015, .05, 12), ...G('#1d1e21'), p: [0, .018, -.765], r: [HP, 0, 0] }, { g: CY(.016, .016, .014, 14), c: '#ff6a00', p: [0, .018, -.796], r: [HP, 0, 0], k: K.plastic },
      { g: B(.026, .04, .035), ...G('#26282c'), p: [0, .03, -.6] }, { g: B(.004, .045, .004), ...G('#111'), p: [0, .072, -.6] }, { g: TO(.012, .003, 6, 12, PI), ...G('#26282c'), p: [0, .065, -.6], r: [0, HP, 0] },
      { g: B(.03, .016, .05), ...G('#26282c'), p: [0, .07, -.27] }, { g: B(.004, .008, .004), ...G('#111'), p: [0, .082, -.25] },
      { g: TO(.026, .004, 6, 16, PI), ...G('#26282c'), p: [0, -.008, -.045], r: [0, HP, PI] }, { g: B(.004, .022, .006), ...G('#222'), p: [0, -.012, -.04], r: [.25, 0, 0] },
      { g: B(.004, .012, .1), ...G('#3a3c40'), p: [.025, .028, -.04], r: [-.08, 0, 0] }, { g: CY(.005, .005, .32, 8), ...G('#3a3c40'), p: [0, -.004, -.55], r: [HP, 0, 0] },
      { g: B(.05, .012, .02), ...G('#26282c'), p: [0, -.004, -.12] }, { g: B(.048, .08, .006), ...G('#1a1b1d'), p: [0, -.035, .425] },
    ];
    for (let i = 0; i < 6; i++) metal.push({ g: B(.046, .004, .006), ...G('#1b1c1f'), p: [0, .084, -i * .04] });
    const wood = [
      { g: CA(.022, .17, 14), p: [0, .002, -.4], r: [HP, 0, 0], s: [.95, 1, 1] }, { g: CA(.018, .13, 14), p: [0, .055, -.38], r: [HP, 0, 0], s: [1, 1, .85] },
      { g: EX([[-.07, .045], [-.42, .0], [-.425, -.012], [-.425, -.115], [-.4, -.118], [-.1, -.035], [-.07, -.02]], .036, .006) },
      { g: EX([[.02, -.03], [.046, -.03], [.004, -.13], [-.028, -.13]], .03, .005) },
    ];
    const mag = [{ g: EX([...bk, ...fr.reverse()], .028, .004), c: '#b04c19', k: [.42, 0] }];
    for (let i = 0; i < 4; i++) mag.push({ g: B(.032, .004, .045), c: '#8a3a12', p: [0, -.07 - i * .035, -.09 - i * .018], r: [-.3 - i * .08, 0, 0], k: [.5, 0] });
    meshes(g, [[R.mV, metal], [R.mRifle, wood], [R.mV, mag]]); mz = -.81; my = .018;
  } else if (k === 'rpg') {
    const tube = [
      { g: CY(.031, .031, .95, 24), c: '#3d4431', p: [0, .07, -.12], r: [HP, 0, 0], k: [.55, .5] }, { g: CY(.052, .033, .14, 24), c: '#30352a', p: [0, .07, .42], r: [HP, 0, 0], k: [.5, .5] },
      { g: CY(.036, .036, .02, 20), c: '#2a2e24', p: [0, .07, -.6], r: [HP, 0, 0], k: K.metal }, { g: CY(.036, .036, .02, 20), c: '#2a2e24', p: [0, .07, .335], r: [HP, 0, 0], k: K.metal },
      { g: EX([[.018, -.004], [-.012, -.004], [-.03, -.11], [.004, -.114], [.016, -.04]], .028, .005), c: '#2a1a10', p: [0, .04, 0], k: [.55, 0] },
      { g: EX([[.02, -.004], [-.01, -.004], [-.02, -.1], [.01, -.1]], .026, .005), c: '#2a1a10', p: [0, .04, -.24], k: [.55, 0] },
      { g: TO(.022, .0035, 6, 14, PI), c: '#222', p: [0, .036, -.03], r: [0, HP, PI], k: K.metal }, { g: B(.004, .02, .006), c: '#222', p: [0, .028, -.025], k: K.metal },
      { g: B(.032, .045, .12), c: '#2b2f26', p: [-.052, .11, -.1], k: [.4, .4] }, { g: CY(.016, .018, .04, 16), c: '#1a1a1a', p: [-.052, .112, -.02], r: [HP, 0, 0], k: K.rubber },
      { g: CY(.016, .016, .01, 16), c: '#3366aa', p: [-.052, .112, -.165], r: [HP, 0, 0], k: [.03, .5] }, { g: B(.03, .012, .03), c: '#2b2f26', p: [-.03, .1, -.1], k: K.metal },
      { g: B(.005, .03, .01), c: '#222', p: [0, .108, -.5], k: K.metal }, { g: B(.012, .022, .01), c: '#222', p: [0, .104, -.05], k: K.metal },
      { g: CY(.017, .017, .14, 12), c: '#555b4a', p: [0, .07, -.67], r: [HP, 0, 0], k: K.metal },
      { g: LA([[0, 0], [.012, .006], [.028, .04], [.043, .085], [.048, .14], [.048, .2], [.036, .228], [.02, .25]], 24), c: '#56603e', p: [0, .07, -.99], r: [HP, 0, 0], k: [.45, .3] },
      { g: CY(.0485, .0485, .018, 24), c: '#ff2a3a', p: [0, .07, -.84], r: [HP, 0, 0], k: K.gloss }, { g: CY(.0485, .0485, .018, 24), c: '#ffd400', p: [0, .07, -.81], r: [HP, 0, 0], k: K.gloss },
      { g: CY(.003, .013, .03, 12), c: '#d8b040', p: [0, .07, -1.0], r: [-HP, 0, 0], k: K.chrome },
    ];
    for (let i = 0; i < 4; i++) { const a = i * HP + PI / 4; tube.push({ g: B(.002, .03, .05), c: '#444a3a', p: [Math.cos(a) * .02, .07 + Math.sin(a) * .02, -.64], r: [0, 0, a], k: K.metal }); }
    meshes(g, [[R.mV, tube], [R.mDark, [{ g: CY(.044, .044, .26, 24), p: [0, .07, -.06], r: [HP, 0, 0] }]]]); mz = -1.0; my = .07;
  } else {
    const st = [];
    for (const s of [-1, 1]) st.push({ g: TO(.04, .0065, 10, 32), p: [s * .07, 0, 0], r: [HP, 0, 0] }, { g: TO(.034, .006, 8, 20, PI * .9), p: [s * .07, 0, 0], r: [HP, 0, s * .4] }, { g: B(.03, .016, .055), p: [s * .07, 0, -.045] }, { g: CY(.004, .004, .02, 8), p: [s * .07, .01, -.05] });
    for (let i = 0; i < 3; i++) st.push({ g: TO(.009, .0026, 6, 12), p: [-.022 + i * .022, 0, -.06], r: [i % 2 ? HP : 0, 0, 0] });
    g.add(M(merge(st), R.mSteel)); mz = 0; my = 0;
  }
  const mo = new THREE.Object3D(); mo.position.set(0, my, mz); g.add(mo); g.userData.muzzle = mo;
  return g;
}
function shopItems() {
  R.shopItems = {}; R.tags = {};
  R.scene.add(M(merge([{ g: B(1.7, .006, .6), c: '#2a2d33', p: [0, .828, -6.02], k: [.95, 0] }, { g: B(1.72, .008, .012), c: '#c9a24a', p: [0, .829, -6.32], k: K.chrome }])));
  ['bat', 'pistol', 'ak', 'rpg', 'tackle'].forEach((k, i) => {
    const w = buildWeapon(k), base = new THREE.Group(); base.add(w);
    w.rotation.set(0, PI, k === 'tackle' ? 0 : HP); w.scale.setScalar({ bat: .62, pistol: 1.35, ak: .44, rpg: .38, tackle: 1.1 }[k]); w.position.z = { bat: .2, pistol: .06, ak: .2, rpg: .2, tackle: 0 }[k];
    base.position.set(-.68 + i * .34, .86, -5.98); base.userData = { k, y: .86 }; R.scene.add(base); R.shopItems[k] = base;
    const c = mkCanvas(320, 128), t = ctex(c), tag = new THREE.Mesh(new THREE.PlaneGeometry(.22, .088), new THREE.MeshStandardMaterial({ map: t, roughness: .4, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: .35 }));
    tag.position.set(-.68 + i * .34, .842, -6.37); tag.lookAt(0, 1.4, -7.25); tag.userData = { k }; R.scene.add(tag); R.tags[k] = { tag, c, t };
  });
}
export function drawTag(k, st) {
  const { c, t } = R.tags[k], g = c.getContext('2d'), W = 320, H = 128; g.clearRect(0, 0, W, H);
  g.fillStyle = st.eq ? 'rgba(255,214,102,.95)' : 'rgba(250,250,248,.94)'; g.beginPath(); if (g.roundRect) g.roundRect(8, 8, W - 16, H - 16, 26); else g.rect(8, 8, W - 16, H - 16); g.fill();
  if (st.sel) { g.lineWidth = 6; g.strokeStyle = '#f5a623'; g.stroke(); }
  g.textBaseline = 'middle'; g.textAlign = 'center'; const y = st.sel ? 52 : H / 2;
  if (st.owned) { g.fillStyle = st.eq ? '#3a2a00' : '#1f7a45'; g.font = `bold 44px ${F}`; g.fillText(st.eq ? '장착 중' : '보유', W / 2, y + 2); }
  else {
    const x = W / 2 - 46, gr = g.createRadialGradient(x - 7, y - 7, 2, x, y, 22); gr.addColorStop(0, '#fff1a8'); gr.addColorStop(.55, '#f7c234'); gr.addColorStop(1, '#b07800');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, 20, 0, 7); g.fill(); g.fillStyle = '#1c1f26'; g.font = `bold 50px ${F}`; g.textAlign = 'left'; g.fillText(st.price, x + 32, y + 3);
  }
  if (st.sel && !st.eq) { g.textAlign = 'center'; g.font = `bold 22px ${F}`; g.fillStyle = '#9a6400'; g.fillText(st.owned ? '한 번 더 탭하면 장착' : '한 번 더 탭하면 구매', W / 2, 98); }
  t.needsUpdate = true;
}

let _blob = null;
function blobMat() {
  if (_blob) return _blob; const c = mkCanvas(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (_blob = new THREE.MeshBasicMaterial({ map: ctex(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
}

// ───────── 감독관 ─────────
export function buildTeacher() {
  const T = { root: new THREE.Group(), walk: 0 }; teacherBody(T);
  T.mount = new THREE.Group(); T.mount.position.y = -.33; T.mount.rotation.x = -HP; T.armR.el.add(T.mount);
  T.stack = M(merge([{ g: B(.3, .1, .22), c: '#f4f1e8', k: K.paper }, { g: B(.31, .012, .23), c: '#c9b089', p: [0, -.055, 0], k: K.paper }, { g: B(.31, .012, .23), c: '#e8577a', p: [0, .055, 0], k: K.paper }]));
  T.stack.position.set(0, -.32, -.1); T.armL.el.add(T.stack); T.stack.visible = false;
  const sh = new THREE.Mesh(R.blobGeo, blobMat()); sh.rotation.x = -HP; sh.scale.set(.8, .8, 1); sh.position.y = .006; T.root.add(sh);
  return T;
}

// ───────── 학생 ─────────
function paperObj() { const pc = mkCanvas(256, 352); return { pc, pg: pc.getContext('2d'), ink: 0 }; }
export function drawPage(o, subj, page) {
  const g = o.pg; g.setTransform(2, 0, 0, 2, 0, 0);
  g.fillStyle = '#fbfaf3'; g.fillRect(0, 0, 128, 176);
  g.fillStyle = '#1a1a1a'; g.font = `bold 10px ${F}`; g.textAlign = 'center'; g.fillText(`${subj || '국어'} 영역`, 64, 13);
  g.fillRect(8, 17, 112, 1.2); g.fillStyle = '#bbb'; g.fillRect(63.5, 21, .8, 145);
  for (let c = 0; c < 2; c++) {
    let y = 24; const x0 = 8 + c * 59;
    for (let k = 0; k < 2; k++) {
      g.fillStyle = '#111'; g.font = `bold 7px ${F}`; g.textAlign = 'left'; g.fillText(`${1 + page * 4 + c * 2 + k}.`, x0, y + 6);
      for (let l = 0; l < 6; l++) { g.fillStyle = 'rgba(50,50,50,.6)'; let x = x0 + (l ? 0 : 9); const end = x0 + 52 - rand(0, 14); while (x < end) { const w = rand(2, 6); g.fillRect(x, y + 2 + l * 5, Math.min(w, end - x), 1.5); x += w + 1; } }
      if (Math.random() < .5) { g.strokeStyle = '#888'; g.lineWidth = .6; g.strokeRect(x0 + 6, y + 33, 38, 16); }
      y += 54;
      for (let ch = 0; ch < 5; ch++) { g.strokeStyle = '#666'; g.lineWidth = .6; g.beginPath(); g.arc(x0 + 4 + ch * 10.5, y - 1, 2.6, 0, 7); g.stroke(); g.fillStyle = '#666'; g.font = `4px ${F}`; g.textAlign = 'center'; g.fillText(ch + 1, x0 + 4 + ch * 10.5, y + .4); }
      y += 15;
    }
  }
  g.font = `8px ${F}`; g.fillStyle = '#555'; g.textAlign = 'center'; g.fillText(`${page + 1}`, 64, 172);
  o.ink = 0; o.wp = null; o.dirty = true;
}
export function inkStroke(o) {
  const g = o.pg;
  if (!o.wp) { const col = ri(0, 1), blk = ri(0, 1); o.wp = { x0: 9 + col * 59, x: 9 + col * 59 + rand(0, 14), y: 26 + blk * 69 + rand(30, 48), n: ri(8, 18), col, blk }; }
  const w = o.wp; g.strokeStyle = 'rgba(28,28,40,.85)'; g.lineWidth = .7; g.lineCap = 'round'; g.beginPath(); g.moveTo(w.x, w.y);
  const nx = w.x + rand(1.5, 3.6), ny = w.y + rand(-1.6, 1.6); g.quadraticCurveTo(w.x + rand(-1, 3), w.y + rand(-3, 3), nx, ny); g.stroke();
  w.x = nx; if (w.x > w.x0 + 50) { w.x = w.x0 + rand(0, 6); w.y += 4.5; }
  w.n--;
  if (w.n <= 0) { if (Math.random() < .5) { const cy = 26 + w.blk * 69 + 53, cx = w.x0 + 4 + ri(0, 4) * 10.5; g.lineWidth = .9; g.beginPath(); g.arc(cx, cy - 1, 3.8, 0, 7); g.stroke(); } o.wp = null; }
  o.ink++; o.dirty = true; if (o.ink > 150) o.wantFlip = true;
}
function buildGlasses(type, thick) {
  const ai = type === 'ai', t = ai ? .0052 : (thick ? .0046 : .0026);
  const col = ai ? '#0e0e0e' : (thick ? '#1a1a1a' : pick(['#b8bec6', '#6b4a2f', '#c9b26b', '#3a3a3a'])), km = ai || thick ? [.25, 0] : K.chrome;
  const parts = [
    { g: TO(.031, t, 8, 28), c: col, p: [-.045, .135, -.128], s: [1.18, .78, 1], k: km }, { g: TO(.031, t, 8, 28), c: col, p: [.045, .135, -.128], s: [1.18, .78, 1], k: km },
    { g: B(.022, t * 1.6, t * 1.6), c: col, p: [0, .14, -.128], k: km },
    { g: B(.04, t * 1.7, t * 1.7), c: col, p: [-.1, .138, -.124], k: km }, { g: B(.04, t * 1.7, t * 1.7), c: col, p: [.1, .138, -.124], k: km },
    { g: B(t * 1.5, t * 1.5, .13), c: col, p: [-.12, .138, -.06], k: km }, { g: B(t * 1.5, t * 1.5, .13), c: col, p: [.12, .138, -.06], k: km },
  ];
  if (ai) parts.push({ g: B(.02, .013, .014), c: '#151515', p: [0, .158, -.13], k: K.gloss }, { g: CY(.0045, .0045, .004, 12), c: '#203a6a', p: [0, .158, -.138], r: [HP, 0, 0], k: [.02, .5] }, { g: B(.016, .018, .055), c: '#151515', p: [.122, .138, -.08], k: K.gloss }, { g: B(.016, .018, .055), c: '#151515', p: [-.122, .138, -.08], k: K.gloss });
  const g = new THREE.Group(), fm = M(merge(parts), R.mV, false); fm.userData.noTint = true; g.add(fm);
  const lens = new THREE.Mesh(merge([{ g: new THREE.CircleGeometry(.03, 24), p: [-.045, .135, -.129], s: [1.18, .78, 1] }, { g: new THREE.CircleGeometry(.03, 24), p: [.045, .135, -.129], s: [1.18, .78, 1] }]), ai ? R.lensAI : R.lens);
  lens.userData.noTint = true; g.add(lens); g.userData = { type, lens };
  if (ai) {
    const led = new THREE.Mesh(R.ledGeo, R.ledOff); led.position.set(.131, .146, -.1); led.userData.noTint = true; g.add(led);
    const glow = new THREE.Sprite(R.glowMat); glow.scale.set(.12, .12, .12); glow.position.copy(led.position); glow.visible = false; g.add(glow);
    g.userData.led = led; g.userData.glow = glow;
  }
  return g;
}
export function buildStudent(i, x, z, o) {
  const st = { i, x, z, name: o.name, t: rand(0, 10), ph: rand(0, 10), act: 'write', actT: rand(.5, 3), inkAcc: 0, burst: 0, page: 0, flipT: 0, lookT: 0, flinchT: 0, scared: 0, blinkT: rand(1, 6), blinkOn: 0, ledState: false, cpos: new THREE.Vector3(), hpos: new THREE.Vector3(), dirty: false };
  const seat = new THREE.Group(); seat.position.set(x, 0, z); R.scene.add(seat); st.seat = seat;
  const mt = '#9aa1aa', km = [.38, .85];
  st.desk = new THREE.Group(); st.desk.position.set(0, 0, -.36); seat.add(st.desk);
  st.desk.add(M(merge([{ g: B(.9, .03, .6), p: [0, .745, 0] }]), R.mDesk));
  const dk = [{ g: B(.906, .012, .606), c: '#5a4636', p: [0, .727, 0], k: K.plastic }, { g: B(.84, .018, .5), c: '#8d949c', p: [0, .6, .02], k: km }, { g: B(.84, .1, .012), c: '#8d949c', p: [0, .65, -.25], k: km }, { g: B(.84, .03, .025), c: mt, p: [0, .71, .27], k: km },
    { g: B(.1, .002, .04), c: '#ffffff', p: [-.34, .7605, .24], k: K.paper }, { g: B(.06, .0021, .01), c: '#333', p: [-.34, .7607, .235], k: K.paper },
    { g: CY(.006, .006, .14, 10), c: '#151515', p: [.15, .766, -.08], r: [0, .5, HP], k: K.gloss }, { g: CY(.0065, .0065, .04, 10), c: '#2a2a2a', p: [.21, .766, -.115], r: [0, .5, HP], k: K.gloss },
    { g: B(.085, .002, .12), c: '#f5f5f0', p: [-.34, .7605, -.17], r: [0, .1, 0], k: K.paper }, { g: B(.085, .0022, .025), c: '#2850a0', p: [-.34, .7607, -.215], r: [0, .1, 0], k: K.paper }, { g: B(.03, .0023, .035), c: '#9aa3ad', p: [-.36, .7608, -.16], r: [0, .1, 0], k: K.paper }];
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) dk.push({ g: B(.03, .72, .03), c: mt, p: [a * .42, .36, b * .27], k: km }, { g: B(.034, .02, .034), c: '#222', p: [a * .42, .01, b * .27], k: K.rubber });
  st.desk.add(M(merge(dk)));
  st.chair = new THREE.Group(); st.chair.position.set(0, 0, .16); seat.add(st.chair);
  st.chair.add(M(merge([{ g: B(.42, .022, .4), p: [0, .45, 0] }, { g: B(.42, .26, .018), p: [0, .75, .2], r: [-.08, 0, 0] }]), R.mChairW));
  const chp = [];
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) chp.push({ g: CY(.011, .011, .44, 8), c: mt, p: [a * .19, .22, b * .17], k: km }, { g: SP(.014, 8, 6), c: '#222', p: [a * .19, .006, b * .17], k: K.rubber });
  chp.push({ g: CY(.011, .011, .42, 8), c: mt, p: [-.19, .66, .19], r: [-.08, 0, 0], k: km }, { g: CY(.011, .011, .42, 8), c: mt, p: [.19, .66, .19], r: [-.08, 0, 0], k: km }, { g: B(.38, .02, .02), c: mt, p: [0, .43, .17], k: km });
  st.chair.add(M(merge(chp)));
  st.blob = new THREE.Mesh(R.blobGeo, blobMat()); st.blob.rotation.x = -HP; st.blob.scale.set(1.25, 1.5, 1); st.blob.position.set(0, .005, -.12); seat.add(st.blob);
  Object.assign(st, paperObj()); st.ptex = ctex(st.pc);
  st.paper = new THREE.Mesh(R.paperGeo, new THREE.MeshStandardMaterial({ map: st.ptex, roughness: .9 })); st.paper.rotation.x = -HP; st.paper.position.set(-.07, .7615, -.38); st.paper.receiveShadow = true; seat.add(st.paper);
  st.omr = new THREE.Mesh(R.omrGeo, R.omrMat); st.omr.rotation.x = -HP; st.omr.rotation.z = rand(-.1, .1); st.omr.position.set(.29, .761, -.4); st.omr.receiveShadow = true; seat.add(st.omr);
  st.flip = new THREE.Group(); st.flip.position.set(-.2, .764, -.38); seat.add(st.flip);
  const fp = new THREE.Mesh(R.paperGeo, R.pageUsedMat); fp.rotation.x = -HP; fp.position.x = .13; st.flip.add(fp); st.flip.visible = false;
  studentBody(st);
  if (o.glasses !== 'none') { st.glasses = buildGlasses(o.glasses, o.thick); st.head.add(st.glasses); }
  st.armR.sh.rotation.set(.9, 0, -.1); st.armR.el.rotation.x = .7; st.armL.sh.rotation.set(.85, 0, .12); st.armL.el.rotation.x = .75;
  st.spine.rotation.x = -.12; st.head.rotation.x = -.45;
  st.marker = new THREE.Mesh(R.markerGeo, R.mkRed); st.marker.visible = false; R.scene.add(st.marker);
  return st;
}

function misc() {
  R.paperGeo = new THREE.PlaneGeometry(.26, .36); R.omrGeo = new THREE.PlaneGeometry(.15, .3); R.blobGeo = new THREE.PlaneGeometry(1, 1);
  R.omrMat = new THREE.MeshStandardMaterial({ map: ctex(omrCanvas()), roughness: .85 });
  const used = paperObj(); drawPage(used, '국어', 0); for (let i = 0; i < 140; i++) inkStroke(used);
  R.pageUsedMat = new THREE.MeshStandardMaterial({ map: ctex(used.pc), side: THREE.DoubleSide, roughness: .9 });
  R.ledGeo = new THREE.BoxGeometry(.012, .012, .012);
  const gc = mkCanvas(128, 128), g = gc.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.6)'); gr.addColorStop(.6, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  R.glowTex = ctex(gc);
  const sc = mkCanvas(128, 128), sg = sc.getContext('2d');
  for (let i = 0; i < 26; i++) { const x = 64 + rand(-26, 26), y = 64 + rand(-26, 26), r = rand(14, 34), cg = sg.createRadialGradient(x, y, 0, x, y, r); cg.addColorStop(0, `rgba(255,255,255,${rand(.25, .55)})`); cg.addColorStop(1, 'rgba(255,255,255,0)'); sg.fillStyle = cg; sg.fillRect(0, 0, 128, 128); }
  const mask = sg.createRadialGradient(64, 64, 20, 64, 64, 64); mask.addColorStop(0, 'rgba(0,0,0,1)'); mask.addColorStop(1, 'rgba(0,0,0,0)'); sg.globalCompositeOperation = 'destination-in'; sg.fillStyle = mask; sg.fillRect(0, 0, 128, 128);
  R.smokeTex = ctex(sc);
  R.glowMat = new THREE.SpriteMaterial({ map: R.glowTex, color: new THREE.Color().setRGB(.8, 2.6, 3.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  R.markerGeo = merge([{ g: new THREE.ConeGeometry(.09, .2, 4), r: [PI, 0, 0] }, { g: SP(.05, 10, 8), p: [0, .16, 0] }]);
  R.mkRed = basic('#ff3344'); R.mkGreen = basic('#36e070'); R.mkOrange = basic('#ff9a2a');
  R.tring = new THREE.Mesh(new THREE.RingGeometry(.38, .48, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.6, 1.3, .3), transparent: true, opacity: .85, depthWrite: false }));
  R.tring.rotation.x = -HP; R.tring.visible = false; R.scene.add(R.tring);
  const star = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = i / 10 * 2 * PI - HP, r = i % 2 ? .022 : .05; i ? star.lineTo(Math.cos(a) * r, Math.sin(a) * r) : star.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  R.starGeo = new THREE.ShapeGeometry(star); R.starMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(2, 1.7, .3), side: THREE.DoubleSide });
  R.ballGeo = new THREE.SphereGeometry(.035, 14, 10); R.sphereGeo = new THREE.SphereGeometry(1, 24, 16); R.ringGeo = new THREE.RingGeometry(.8, 1, 64);
  R.spotGeo = new THREE.SphereGeometry(.05, 12, 10);
  R.halfGlass = ['normal', 'ai'].map((tp) => merge([{ g: TO(.036, tp === 'ai' ? .0075 : .004, 8, 20), c: tp === 'ai' ? '#121212' : '#999', k: [.25, tp === 'ai' ? 0 : .9] }, { g: B(.007, .007, .13), c: tp === 'ai' ? '#121212' : '#999', p: [-.06, .005, .06], k: [.25, 0] }]));
  R.rocketGeo = merge([{ g: CY(.017, .017, .14, 12), c: '#555b4a', p: [0, 0, -.07], r: [HP, 0, 0], k: K.metal }, { g: LA([[0, 0], [.012, .006], [.028, .04], [.043, .085], [.048, .14], [.048, .2], [.036, .228], [.02, .25]], 20), c: '#56603e', p: [0, 0, .25], r: [-HP, 0, 0], k: [.45, .3] }, { g: CY(.0485, .0485, .018, 20), c: '#ff2a3a', p: [0, 0, .1], r: [HP, 0, 0], k: K.gloss }, { g: CY(.0485, .0485, .018, 20), c: '#ffd400', p: [0, 0, .07], r: [HP, 0, 0], k: K.gloss }, { g: B(.12, .004, .05), c: '#444a3a', p: [0, 0, -.13], k: K.metal }, { g: B(.004, .12, .05), c: '#444a3a', p: [0, 0, -.13], k: K.metal }]);
  R.splatGeos = [0, 1, 2].map(() => {
    const sh = new THREE.Shape(), n = 22;
    for (let i = 0; i <= n; i++) { const a = i / n * 2 * PI, r = .75 + Math.random() * .35 + (Math.random() < .2 ? .3 : 0); i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const parts = [{ g: new THREE.ShapeGeometry(sh) }];
    for (let k = 0; k < 6; k++) { const a = rand(0, 7), d = rand(1.2, 1.8); parts.push({ g: new THREE.CircleGeometry(rand(.06, .18), 12), p: [Math.cos(a) * d, Math.sin(a) * d, 0] }); }
    return merge(parts);
  });
}

// ───────── 바닥/벽/책상 자국 ─────────
let decalN = 0;
export function addDecal(pos, r, color, normal = 'y', op = .94) {
  const scorch = color === '#1a1410';
  const mat = lam(color, { transparent: true, opacity: op, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: scorch ? 1 : .18 });
  const m = new THREE.Mesh(pick(R.splatGeos), mat); m.scale.set(r, r, r); m.position.copy(pos); decalN++;
  const e = .003 + (decalN % 40) * .00015;
  if (normal === 'y') { m.rotation.set(-HP, 0, rand(0, 6)); m.position.y += e; }
  else if (normal === '+x') { m.rotation.set(0, HP, rand(0, 6)); m.position.x += e; }
  else if (normal === '-x') { m.rotation.set(0, -HP, rand(0, 6)); m.position.x -= e; }
  else if (normal === '+z') { m.rotation.set(0, 0, rand(0, 6)); m.position.z += e; }
  else { m.rotation.set(0, PI, rand(0, 6)); m.position.z -= e; }
  m.receiveShadow = true; R.scene.add(m); R.decals.push(m);
  if (R.decals.length > 140) R.scene.remove(R.decals.shift());
  return m;
}

// ───────── 파티클 (텍스처 · 회전 · 불꽃 색 변화) ─────────
const VS = `attribute vec3 pc; attribute float psize; attribute float palpha; attribute float prot; uniform float scale; varying vec3 vc; varying float va; varying float vr;
void main(){ vc=pc; va=palpha; vr=prot; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=psize*scale/max(.1,-mv.z); gl_Position=projectionMatrix*mv; }`;
const FS = `uniform sampler2D map; varying vec3 vc; varying float va; varying float vr;
void main(){ vec2 d=gl_PointCoord-.5; float c=cos(vr), s=sin(vr); d=mat2(c,-s,s,c)*d; vec4 t=texture2D(map,d+.5); if(t.a<.01) discard; gl_FragColor=vec4(vc*t.rgb,va*t.a); }`;
const _col = new THREE.Color();
const RAMP = [[0, 4, 3.4, 2.2], [.12, 3.2, 1.7, .5], [.35, 2, .55, .12], [.6, .45, .12, .05], [1, .12, .1, .09]];
export class PFX {
  constructor(max, additive, tex) {
    this.max = max; this.i = 0; const f = (n) => new Float32Array(max * n);
    this.p = f(3); this.v = f(3); this.c = f(3); this.sz = f(1); this.a = f(1); this.rot = f(1); this.spin = f(1); this.life = f(1); this.ml = f(1); this.g = f(1); this.dr = f(1); this.gr = f(1); this.s0 = f(1); this.a0 = f(1); this.ramp = new Uint8Array(max);
    const geo = new THREE.BufferGeometry();
    this.attrs = [['position', this.p, 3], ['pc', this.c, 3], ['psize', this.sz, 1], ['palpha', this.a, 1], ['prot', this.rot, 1]].map(([n, arr, s]) => { const at = new THREE.BufferAttribute(arr, s); at.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(n, at); return at; });
    this.mat = new THREE.ShaderMaterial({ uniforms: { scale: { value: 500 }, map: { value: tex } }, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.pts = new THREE.Points(geo, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = additive ? 6 : 5; R.scene.add(this.pts); this.alive = 0;
  }
  spawn(x, y, z, vx, vy, vz, color, size, life, grav = 0, drag = 0, grow = 0, alpha = 1, ramp = 0, spin = 0) {
    const i = this.i; this.i = (i + 1) % this.max; const j = i * 3;
    this.p[j] = x; this.p[j + 1] = y; this.p[j + 2] = z; this.v[j] = vx; this.v[j + 1] = vy; this.v[j + 2] = vz;
    _col.set(color); this.c[j] = _col.r; this.c[j + 1] = _col.g; this.c[j + 2] = _col.b;
    this.s0[i] = size; this.sz[i] = size; this.life[i] = life; this.ml[i] = life; this.g[i] = grav; this.dr[i] = drag; this.gr[i] = grow; this.a0[i] = alpha; this.a[i] = alpha;
    this.ramp[i] = ramp; this.rot[i] = rand(0, 6.28); this.spin[i] = spin || rand(-1, 1); this.alive = 2;
  }
  clear() { this.life.fill(0); this.a.fill(0); this.sz.fill(0); this.attrs.forEach((a) => (a.needsUpdate = true)); }
  update(dt) {
    if (!this.alive) return; let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt; const j = i * 3;
      if (this.life[i] <= 0) { this.a[i] = 0; this.sz[i] = 0; continue; }
      any = true;
      this.v[j + 1] -= this.g[i] * dt; const d = Math.max(0, 1 - this.dr[i] * dt); this.v[j] *= d; this.v[j + 1] *= d; this.v[j + 2] *= d;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      if (this.p[j + 1] < .02 && this.g[i] > 0) { this.p[j + 1] = .02; this.v[j + 1] *= -.3; this.v[j] *= .5; this.v[j + 2] *= .5; }
      const k = this.life[i] / this.ml[i], age = 1 - k; this.rot[i] += this.spin[i] * dt;
      if (this.ramp[i]) { let a = 0; while (a < RAMP.length - 2 && age > RAMP[a + 1][0]) a++; const A = RAMP[a], Bq = RAMP[a + 1], t = (age - A[0]) / (Bq[0] - A[0]); this.c[j] = lerp(A[1], Bq[1], t); this.c[j + 1] = lerp(A[2], Bq[2], t); this.c[j + 2] = lerp(A[3], Bq[3], t); }
      this.a[i] = this.a0[i] * (k < .35 ? k / .35 : 1) * (age < .06 ? age / .06 : 1); this.sz[i] = this.s0[i] * (1 + this.gr[i] * age);
    }
    this.attrs.forEach((a) => (a.needsUpdate = true));
    if (!any) this.alive--;
  }
}
