// 사실적인 머리카락: 두피(타원체) 위에 가는 머리카락 다발 카드 1천여 장을 결 방향대로 심음.
// 기본 스타일 'soft' = 이마를 덮으며 부드럽게 내려앉은 앞머리 + 귀를 살짝 덮는 옆머리 + 정수리 볼륨(한국 남자 자연스러운 커트).
// 뿌리는 어둡고 끝은 밝고 가늘게, 투명 머리결 텍스처 + 광택(sheen) + 끝부분이 살랑이는 움직임.
import * as THREE from 'three';

let strandTex = null;
export const HAIR_TIME = { value: 0 };
function makeTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512; const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 512);
  for (let i = 0; i < 420; i++) {
    const x0 = Math.random() * 256, len = 512 * (0.6 + Math.random() * 0.4), l = 38 + Math.random() * 40, a = 0.5 + Math.random() * 0.5, wv = (Math.random() - 0.5) * 14;
    const gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, `hsla(25,10%,${l}%,${a})`); gr.addColorStop(0.7, `hsla(25,12%,${l + 10}%,${a * 0.9})`); gr.addColorStop(1, `hsla(25,12%,${l + 16}%,0)`);
    g.strokeStyle = gr; g.lineWidth = 0.6 + Math.random() * 1.6; g.beginPath(); g.moveTo(x0, 0); g.bezierCurveTo(x0 + wv * 0.3, len * 0.35, x0 + wv, len * 0.7, x0 + wv * 0.6, len); g.stroke();
  }
  strandTex = new THREE.CanvasTexture(c); strandTex.colorSpace = THREE.SRGBColorSpace; strandTex.anisotropy = 8;
  return strandTex;
}
const cache = {};
// style: soft(내린 머리) | side(가르마) | buzz(짧게) | sides(모자 아래) | bald(정수리 빠짐)
function build(style, ht) {
  const C = new THREE.Vector3(0, ht - 0.088, -0.012), R = new THREE.Vector3(0.099, 0.089, 0.109);
  const pos = [], uv = [], col = [], idx = [];
  const P = (phi, al) => new THREE.Vector3(C.x + R.x * Math.sin(phi) * Math.sin(al), C.y + R.y * Math.cos(phi), C.z + R.z * Math.sin(phi) * Math.cos(al));
  const normalAt = p => new THREE.Vector3((p.x - C.x) / (R.x * R.x), (p.y - C.y) / (R.y * R.y), (p.z - C.z) / (R.z * R.z)).normalize();
  const radius = p => new THREE.Vector3((p.x - C.x) / R.x, (p.y - C.y) / R.y, (p.z - C.z) / R.z).length();
  const toR = (p, r) => { const q = new THREE.Vector3((p.x - C.x) / R.x, (p.y - C.y) / R.y, (p.z - C.z) / R.z); q.multiplyScalar(r / q.length()); return new THREE.Vector3(C.x + q.x * R.x, C.y + q.y * R.y, C.z + q.z * R.z); };
  // 머리선: 앞(이마)은 높게, 옆은 귀 위, 뒤는 목덜미
  const maxPhi = al => { const f = Math.cos(al); return f > 0 ? 1.74 - 0.78 * f : 1.74 + 0.4 * -f; };
  // 카드 하나: 뿌리 → 끝까지 S마디, 매 마디 결 방향 + 중력, 두피에서 lift 만큼 떠 있음 (끝으로 갈수록 살짝 더)
  const card = (phi, al, len, w, lift, flow, grav, shade, hug) => {
    let p = toR(P(phi, al), 1 + lift / 0.1), n = normalAt(p), d = flow(p, n, phi, al).addScaledVector(n, -0.1).normalize();
    const S = 5, base = pos.length / 3, sl = len / S;
    for (let k = 0; k <= S; k++) {
      const t = k / S, side = new THREE.Vector3().crossVectors(d, n).normalize().multiplyScalar(w * (1 - 0.7 * t) / 2);
      const a = p.clone().add(side), b = p.clone().sub(side);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z); uv.push(0, 1 - t, 1, 1 - t);
      const c = shade * (0.42 + 0.58 * Math.pow(t, 0.7)); col.push(c, c, c, c, c, c);
      if (k < S) {
        let np = p.clone().addScaledVector(d, sl); np.y -= grav * sl * (k + 1) / S;
        const want = 1 + (lift + 0.0016 * (k + 1)) / 0.1, r = radius(np);
        if (r < want || (hug && r > want)) np = toR(np, hug ? want : Math.max(r, want));
        d = np.clone().sub(p).normalize(); p = np; n = normalAt(p);
        idx.push(base + k * 2, base + k * 2 + 1, base + k * 2 + 2, base + k * 2 + 1, base + k * 2 + 3, base + k * 2 + 2);
      }
    }
  };
  const down = (p, n) => new THREE.Vector3(0, -1, 0).addScaledVector(n, -new THREE.Vector3(0, -1, 0).dot(n)).normalize();
  const crown = new THREE.Vector3(0.008, C.y + R.y * 0.9, C.z - R.z * 0.42);
  const fromCrown = (p, n) => { const v = p.clone().sub(crown); v.addScaledVector(n, -v.dot(n)); return v.lengthSq() < 1e-6 ? new THREE.Vector3(0, 0, 1) : v.normalize(); };
  // 내린 앞머리: 앞쪽은 이마로 쏟아지고(가운데에서 살짝 좌우로 갈림), 옆·뒤는 아래로
  const softFlow = (p, n, phi, al) => {
    const fr = Math.cos(al);
    if (fr > 0.25) { const v = new THREE.Vector3(Math.sin(al) * 0.45, -0.25, 1); v.addScaledVector(n, -v.dot(n)); return v.normalize().lerp(fromCrown(p, n), 0.25).normalize(); }
    return fromCrown(p, n).lerp(down(p, n), Math.min(1, phi / 1.3)).normalize();
  };
  const partAl = 0.42;
  const fromPart = (p, n, phi, al) => { const s = Math.sign(Math.sin(al - partAl)) || 1, v = new THREE.Vector3(Math.cos(al) * s, -0.15, -Math.sin(al) * s); v.addScaledVector(n, -v.dot(n)); return v.normalize().lerp(down(p, n), phi > 1.1 ? 0.7 : 0.15).normalize(); };
  const N = { soft: 1500, side: 1000, buzz: 1700, sides: 700, bald: 300 }[style] || 900;
  for (let i = 0; i < N; i++) {
    const al = Math.random() * Math.PI * 2, mp = maxPhi(al), u = Math.random(), phi = Math.acos(1 - u * (1 - Math.cos(mp)));
    const layer = [0.0025, 0.005, 0.008][i % 3], shade = 0.7 + Math.random() * 0.4, top = phi < 1.0, front = Math.cos(al) > 0.25;
    if ((style === 'sides' || style === 'bald') && phi < (style === 'bald' ? 1.15 : 1.25)) continue;
    if (style === 'buzz' || style === 'sides') { card(phi, al, 0.013 + Math.random() * 0.008, 0.006, layer * 0.35, fromCrown, 0.15, 0.85 + Math.random() * 0.15, true); continue; }
    if (style === 'bald') { card(phi, al, 0.03 + Math.random() * 0.015, 0.014, layer * 0.6, down, 0.3, shade, true); continue; }
    if (style === 'side') { card(phi, al, top ? 0.075 + Math.random() * 0.025 : 0.04 + Math.random() * 0.015, 0.009, top ? layer : layer * 0.7, fromPart, top ? 0.4 : 0.6, shade, true); continue; }
    // soft: 머리 모양을 따라 가라앉는 결. 앞머리는 이마를 덮고 눈썹 위에서 끝남, 옆머리는 관자놀이·귀 윗부분, 뒷머리는 목덜미
    const fr = Math.cos(al), bang = front && phi < 1.05;
    const len = bang ? Math.min(0.12, Math.max(0.045, (1.12 - phi) * 0.1 + 0.035)) : top ? 0.075 + Math.random() * 0.02 : 0.05 + Math.random() * 0.022 + (fr < -0.3 ? 0.012 : 0);
    card(phi, al, len * (0.92 + Math.random() * 0.16), 0.008 + Math.random() * 0.005, layer + (top ? 0.0015 : 0) + Math.random() * 0.0015, softFlow, bang ? 0.9 : 0.7, shade, true);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return { geo: g, C, R };
}
export function hairMesh(style, color, ht) {
  const key = style + ht.toFixed(3); const b = cache[key] ||= build(style, ht);
  const c = new THREE.Color(color);
  const mat = new THREE.MeshPhysicalMaterial({ color: c, map: strandTex || makeTex(), alphaTest: 0.3, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.5, vertexColors: true, sheen: 0.8, sheenRoughness: 0.3, sheenColor: c.clone().lerp(new THREE.Color(0xffffff), 0.4), envMapIntensity: 0.45 });
  // 머리카락 끝이 살랑살랑 (뿌리는 고정)
  mat.onBeforeCompile = sh => { sh.uniforms.uHT = HAIR_TIME; sh.vertexShader = 'uniform float uHT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    float tipw = pow(1.0 - uv.y, 2.0); transformed.x += sin(uHT * 1.7 + position.y * 40.0 + position.z * 25.0) * 0.0025 * tipw; transformed.y += cos(uHT * 1.3 + position.x * 35.0) * 0.0015 * tipw;`); };
  const g = new THREE.Group(); const m = new THREE.Mesh(b.geo, mat); m.frustumCulled = false; m.castShadow = true; g.add(m);
  // 두피 (머리카락 사이로 살이 비치지 않게 어두운 머리색 캡)
  if (style !== 'bald') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, style === 'sides' ? Math.PI * 0.62 : Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.5), roughness: 0.9, map: strandTex }));
    cap.scale.copy(b.R).multiplyScalar(1.012); cap.position.copy(b.C); cap.rotation.x = -0.32; g.add(cap);
  }
  return g;
}
