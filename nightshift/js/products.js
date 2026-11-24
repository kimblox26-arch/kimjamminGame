// 상품 3D: 실제 포장처럼 (뚜껑·라벨띠·병목·캔 윗면·과자 봉지 주름) + 들고 흔들면 안의 물이 출렁임
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PRODUCTS } from './data.js';

const FONT = '"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif';
const cache = {};
function tex(key, w, h, draw) {
  if (cache[key]) return cache[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = THREE.RepeatWrapping;
  return (cache[key] = t);
}
const barcode = (g, x, y, w, h) => { g.fillStyle = '#fff'; g.fillRect(x - 3, y - 3, w + 6, h + 14); g.fillStyle = '#000'; let p = x; while (p < x + w) { const b = 1 + (Math.random() * 3 | 0); g.fillRect(p, y, b, h); p += b + 1 + (Math.random() * 2 | 0); } g.font = `600 9px monospace`; g.fillText('8801234' + (Math.random() * 1e5 | 0), x, y + h + 9); };
const shade = (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(0,0,0,.18)'); gr.addColorStop(0.35, 'rgba(255,255,255,.12)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,.15)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); };
// 라벨: 바탕 그라디언트, 상표 띠, 상품명, 작은 글씨, 바코드, 영양정보
function labelTex(key) {
  const P = PRODUCTS[key];
  return tex('lbl_' + key, 512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, P.c1); gr.addColorStop(1, shadeHex(P.c1, -0.25)); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = P.c2; g.globalAlpha = 0.95;
    g.beginPath(); g.moveTo(0, h * 0.62); g.bezierCurveTo(w * 0.3, h * 0.5, w * 0.6, h * 0.78, w, h * 0.6); g.lineTo(w, h * 0.72); g.bezierCurveTo(w * 0.6, h * 0.9, w * 0.3, h * 0.62, 0, h * 0.74); g.fill();
    g.globalAlpha = 1;
    const txtCol = lum(P.c1) > 0.6 ? '#1a1a1a' : '#fff';
    for (const ox of [0, w / 2]) {
      g.fillStyle = txtCol; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `900 ${P.txt.length > 3 ? 48 : 64}px ${FONT}`; g.fillText(P.txt, ox + w / 4, h * 0.38);
      g.font = `700 15px ${FONT}`; g.globalAlpha = 0.85; g.fillText(P.name, ox + w / 4, h * 0.13); g.globalAlpha = 1;
      g.font = `600 12px ${FONT}`; g.fillText(P.kind === 'can' ? '355ml' : P.kind === 'bottle' ? '500ml' : P.kind === 'soju' ? '360ml · 16.5%' : P.kind === 'jar' ? '240ml' : '', ox + w / 4, h * 0.9);
    }
    g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(w * 0.44, h * 0.18, 34, 44); g.fillStyle = '#222'; g.font = `600 6px ${FONT}`; g.textAlign = 'left';
    for (let i = 0; i < 6; i++) g.fillRect(w * 0.44 + 3, h * 0.18 + 5 + i * 6, 20 + Math.random() * 8, 1.2);
    barcode(g, w * 0.92, h * 0.3, 34, 36);
    shade(g, w, h);
  });
}
function shadeHex(hex, k) { const c = new THREE.Color(hex); c.offsetHSL(0, 0, k * 0.5); return '#' + c.getHexString(); }
function lum(hex) { const c = new THREE.Color(hex); return 0.3 * c.r + 0.6 * c.g + 0.1 * c.b; }

const M = (o) => new THREE.MeshStandardMaterial({ roughness: 0.5, envMapIntensity: 0.8, ...o });
const lathe = (pts, seg = 24) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg);
const cyl = (r0, r1, h, y, seg = 24, open = false) => new THREE.CylinderGeometry(r1, r0, h, seg, 1, open).translate(0, y + h / 2, 0);
const merge = (parts) => mergeGeometries(parts.map(g => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; }), true);
const sharedMat = {
  cap: M({ color: 0x1e5fb8, roughness: 0.4 }), capW: M({ color: 0xf2f2f2, roughness: 0.4 }), capG: M({ color: 0x2b7a3a, roughness: 0.25, metalness: 0.6 }),
  metal: M({ color: 0xd8dade, roughness: 0.25, metalness: 0.9 }), pet: M({ color: 0xd8eef8, roughness: 0.05, transparent: true, opacity: 0.28, depthWrite: false }),
  green: M({ color: 0x2f9a4a, roughness: 0.04, transparent: true, opacity: 0.72 }), foil: null, tray: M({ color: 0x111111, roughness: 0.4 }),
  lidClear: M({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false }),
};
// 모양별 지오메트리 (그룹 0 = 라벨, 1.. = 다른 재질)
const GEO = {
  cup: () => merge([cyl(0.044, 0.058, 0.105, 0, 28, true), cyl(0.059, 0.059, 0.004, 0.104, 28), cyl(0.044, 0.044, 0.002, 0, 28)]),
  tri: () => { const g = new THREE.CylinderGeometry(0.072, 0.072, 0.035, 3, 1); g.rotateX(Math.PI / 2); g.rotateZ(Math.PI / 2); return g.translate(0, 0.062, 0); },
  tray: () => new THREE.BoxGeometry(0.21, 0.055, 0.16).translate(0, 0.0275, 0),
  jar: () => merge([lathe([[0, 0], [0.033, 0], [0.037, 0.03], [0.035, 0.07], [0.022, 0.095], [0.019, 0.105]]), cyl(0.02, 0.02, 0.012, 0.103)]),
  bottle: () => merge([cyl(0.0335, 0.0335, 0.07, 0.04, 24, true), lathe([[0, 0], [0.031, 0], [0.033, 0.01], [0.033, 0.14], [0.028, 0.165], [0.014, 0.19], [0.013, 0.2]]), cyl(0.0145, 0.0145, 0.018, 0.198)]),
  can: () => { const g = new THREE.CylinderGeometry(0.033, 0.033, 0.122, 28); return g.translate(0, 0.061, 0); },
  soju: () => merge([lathe([[0, 0], [0.034, 0], [0.035, 0.005], [0.035, 0.14], [0.027, 0.168], [0.013, 0.2], [0.013, 0.222]]), cyl(0.0355, 0.0355, 0.06, 0.05, 24, true), cyl(0.014, 0.014, 0.016, 0.218)]),
  bag: () => { const g = new THREE.BoxGeometry(0.15, 0.21, 0.06, 8, 10, 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 0.105, x = p.getX(i) / 0.075; p.setZ(i, p.getZ(i) * (1 - 0.75 * y ** 4) * (1 - 0.35 * x * x) + Math.sin(x * 9 + y * 4) * 0.002); } g.computeVertexNormals(); return g.translate(0, 0.105, 0); },
  box: () => new THREE.BoxGeometry(0.19, 0.12, 0.07).translate(0, 0.06, 0),
  small: () => new THREE.BoxGeometry(0.07, 0.1, 0.025).translate(0, 0.05, 0),
};
function matsFor(key) {
  if (cache['m_' + key]) return cache['m_' + key];
  const P = PRODUCTS[key], L = labelTex(key), k = P.kind;
  const label = M({ map: L, roughness: k === 'can' ? 0.28 : 0.45, metalness: k === 'can' ? 0.55 : 0 });
  let mats;
  if (k === 'cup') mats = [label, M({ map: tex('lid_' + key, 256, 256, (g, w, h) => { g.fillStyle = '#eee'; g.fillRect(0, 0, w, h); g.fillStyle = P.c1; g.beginPath(); g.arc(w / 2, h / 2, w * 0.36, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = `900 40px ${FONT}`; g.textAlign = 'center'; g.fillText(P.txt, w / 2, h / 2 + 14); g.fillStyle = '#c33'; g.fillRect(w * 0.78, h * 0.1, 40, 18); }), roughness: 0.35, metalness: 0.3 }), sharedMat.capW];
  else if (k === 'tri') mats = M({ map: tex('tri_' + key, 256, 256, (g, w, h) => { g.fillStyle = '#16301f'; g.fillRect(0, 0, w, h); for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(80,120,80,${Math.random() * 0.3})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 1); } g.fillStyle = '#fff'; g.fillRect(0, h * 0.35, w, h * 0.3); g.fillStyle = P.c1; g.font = `900 30px ${FONT}`; g.textAlign = 'center'; g.fillText(P.txt, w / 2, h / 2 + 10); g.fillStyle = '#d22'; g.fillRect(w / 2 - 6, 0, 12, h); }), roughness: 0.2 });
  else if (k === 'tray') { const top = M({ map: tex('food_' + key, 256, 256, (g, w, h) => { g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, w * 0.45, h); for (let i = 0; i < 400; i++) { g.fillStyle = '#fffdf6'; g.fillRect(Math.random() * w * 0.45, Math.random() * h, 4, 2); } g.fillStyle = '#9c3b1c'; g.fillRect(w * 0.47, 0, w * 0.53, h * 0.6); for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(${150 + Math.random() * 60},${40 + Math.random() * 30},20,.9)`; g.fillRect(w * 0.47 + Math.random() * w * 0.5, Math.random() * h * 0.58, 14, 7); } g.fillStyle = '#3f7a2a'; g.fillRect(w * 0.47, h * 0.62, w * 0.25, h * 0.38); g.fillStyle = '#e8c04a'; g.fillRect(w * 0.74, h * 0.62, w * 0.26, h * 0.38); g.fillStyle = 'rgba(255,255,255,.92)'; g.fillRect(0, h * 0.78, w, h * 0.12); g.fillStyle = P.c1; g.font = `900 22px ${FONT}`; g.fillText(P.name, 8, h * 0.87); }), roughness: 0.15 }); mats = [sharedMat.tray, sharedMat.tray, top, sharedMat.tray, label, label]; }
  else if (k === 'jar') mats = [M({ map: L, roughness: 0.3, transparent: true, opacity: 0.95 }), M({ color: P.c2, roughness: 0.35, metalness: 0.4 })];
  else if (k === 'bottle') mats = [label, sharedMat.pet, sharedMat.cap];
  else if (k === 'can') mats = [label, sharedMat.metal, sharedMat.metal];
  else if (k === 'soju') mats = [sharedMat.green, M({ map: L, roughness: 0.4 }), sharedMat.capG];
  else mats = label;
  return (cache['m_' + key] = mats);
}
const geoCache = {};
export function productGeo(key) { const k = PRODUCTS[key].kind; return (geoCache[k] ||= GEO[k]()); }
export function productMats(key) { return matsFor(key); }
export const liquids = new Set();
// liquid: 들고 다닐 낱개 상품이면 안에 물(술·우유)을 넣는다
export function productMesh(key, liquid = false) {
  const m = new THREE.Mesh(productGeo(key), matsFor(key)); m.userData.key = key;
  const k = PRODUCTS[key].kind;
  if (liquid && (k === 'bottle' || k === 'soju' || k === 'jar')) addLiquid(m, k, key);
  return m;
}
// 물: 병 안쪽 모양, 수면 위는 잘라내고(셰이더) 수면은 흔들림 스프링에 따라 기울어진다
function addLiquid(mesh, k, key) {
  const r = k === 'jar' ? 0.031 : 0.03, hgt = k === 'jar' ? 0.085 : 0.15;
  const geo = lathe([[0, 0.004], [r, 0.004], [r, hgt * 0.95], [r * 0.6, hgt]], 20);
  const col = k === 'soju' ? 0xe8f4ea : k === 'jar' ? 0xfff0a0 : 0xcfe9ff;
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.05, transparent: true, opacity: k === 'jar' ? 0.95 : 0.55, side: THREE.DoubleSide, depthWrite: false });
  const plane = { value: new THREE.Vector4(0, 1, 0, 0) };
  mat.onBeforeCompile = sh => {
    sh.uniforms.uPlane = plane;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; uniform vec4 uPlane;').replace('void main() {', 'void main() {\n if (dot(uPlane.xyz, vWp) + uPlane.w > 0.0) discard;');
  };
  mat.customProgramCacheKey = () => 'liquid';
  const liq = new THREE.Mesh(geo, mat); liq.renderOrder = 1; mesh.add(liq);
  liq.userData = { plane, level: hgt * (k === 'jar' ? 0.85 : 0.8), tilt: new THREE.Vector2(), vel: new THREE.Vector2(), last: null, lastV: new THREE.Vector3() };
  liquids.add(liq);
  mesh.userData.liquid = liq;
}
const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _a = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();
// 매 프레임: 병의 가속도로 수면 기울기 스프링을 흔든다
export function updateLiquids(dt) {
  if (!dt) return;
  for (const liq of liquids) {
    if (!liq.parent || !liq.parent.parent) { liquids.delete(liq); continue; }
    const u = liq.userData;
    liq.getWorldPosition(_p);
    if (!u.last) { u.last = _p.clone(); continue; }
    _v.subVectors(_p, u.last).divideScalar(dt); _a.subVectors(_v, u.lastV).divideScalar(dt); u.last.copy(_p); u.lastV.copy(_v);
    _a.clampLength(0, 30);
    // 스프링: 가속 반대로 기울고, 출렁이다가 가라앉음
    u.vel.x += (-u.tilt.x * 120 - u.vel.x * 3.2 - _a.x * 0.9) * dt; u.vel.y += (-u.tilt.y * 120 - u.vel.y * 3.2 - _a.z * 0.9) * dt;
    u.tilt.addScaledVector(u.vel, dt); u.tilt.clampLength(0, 0.9);
    _n.set(u.tilt.x, 1, u.tilt.y).normalize();
    liq.localToWorld(_c.set(0, u.level, 0));
    u.plane.value.set(_n.x, _n.y, _n.z, -_n.dot(_c));
  }
}

// 담배 갑: 앞뒤 그림, 경고 문구, 윗면 뚜껑 선
const cigMats = {}, cigGeo = new THREE.BoxGeometry(0.056, 0.088, 0.022).translate(0, 0.044, 0);
export function cigMesh(cig) {
  if (!cigMats[cig.id]) {
    const t = tex('cig' + cig.id, 256, 384, (g, w, h) => {
      g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, w, h);
      const gr = g.createLinearGradient(0, 0, w, h * 0.5); gr.addColorStop(0, cig.color); gr.addColorStop(1, shadeHex(cig.color, -0.3)); g.fillStyle = gr; g.fillRect(0, 0, w, h * 0.46);
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, h * 0.13); g.lineTo(w, h * 0.13); g.stroke();
      g.fillStyle = '#fff'; g.font = `900 52px ${FONT}`; g.textAlign = 'center'; g.fillText(cig.name.split(' ')[0], w / 2, 110);
      g.fillStyle = cig.color; g.font = `800 34px ${FONT}`; g.fillText(cig.name.split(' ')[1] || '', w / 2, 220);
      g.fillStyle = '#111'; g.fillRect(14, 268, w - 28, 100); g.fillStyle = '#fff'; g.font = `800 19px ${FONT}`; g.fillText('흡연은 폐암 등', w / 2, 306); g.fillText('각종 질병의 원인!', w / 2, 340);
      shade(g, w, h);
    });
    cigMats[cig.id] = M({ map: t, roughness: 0.35 });
  }
  return new THREE.Mesh(cigGeo, cigMats[cig.id]);
}
// 진열대용 저폴리 (멀리서 보이는 수천 개)
const LOW = {
  cup: () => merge([cyl(0.044, 0.058, 0.105, 0, 12, true), cyl(0.059, 0.059, 0.004, 0.104, 12), cyl(0.044, 0.044, 0.002, 0, 12)]),
  jar: () => merge([lathe([[0, 0], [0.033, 0], [0.037, 0.03], [0.035, 0.07], [0.022, 0.095], [0.019, 0.105]], 10), cyl(0.02, 0.02, 0.012, 0.103, 8)]),
  bottle: () => merge([cyl(0.0335, 0.0335, 0.07, 0.04, 10, true), lathe([[0, 0], [0.033, 0.01], [0.033, 0.14], [0.026, 0.168], [0.013, 0.195]], 10), cyl(0.0145, 0.0145, 0.018, 0.198, 8)]),
  can: () => new THREE.CylinderGeometry(0.033, 0.033, 0.122, 12).translate(0, 0.061, 0),
  soju: () => merge([lathe([[0, 0], [0.035, 0.005], [0.035, 0.14], [0.026, 0.17], [0.013, 0.2], [0.013, 0.222]], 10), cyl(0.0355, 0.0355, 0.06, 0.05, 10, true), cyl(0.014, 0.014, 0.016, 0.218, 8)]),
  bag: () => { const g = new THREE.BoxGeometry(0.15, 0.21, 0.06, 2, 4, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 0.105, x = p.getX(i) / 0.075; p.setZ(i, p.getZ(i) * (1 - 0.75 * y ** 4) * (1 - 0.3 * x * x)); } g.computeVertexNormals(); return g.translate(0, 0.105, 0); },
};
const lowCache = {};
export function geoByKind(k) { return (lowCache[k] ||= (LOW[k] || GEO[k])()); }
export const SHARED = sharedMat;
