// 사실적인 머리카락: 두피(타원체) 위에 가는 머리카락 다발 카드 수백 장을 결 방향대로 심음.
// 뿌리는 어둡고 끝은 밝게, 끝으로 갈수록 가늘게, 투명 머리결 텍스처 + 은은한 광택(sheen).
import * as THREE from 'three';

let strandTex = null;
function makeTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 256);
  for (let i = 0; i < 150; i++) {
    const x0 = Math.random() * 128, len = 256 * (0.55 + Math.random() * 0.45), l = 55 + Math.random() * 45, a = 0.55 + Math.random() * 0.45, wv = (Math.random() - 0.5) * 6;
    const gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, `hsla(0,0%,${l}%,${a})`); gr.addColorStop(0.75, `hsla(0,0%,${l + 8}%,${a * 0.9})`); gr.addColorStop(1, `hsla(0,0%,${l + 12}%,0)`);
    g.strokeStyle = gr; g.lineWidth = 0.8 + Math.random() * 1.4; g.beginPath(); g.moveTo(x0, 0); g.quadraticCurveTo(x0 + wv, len * 0.5, x0 + wv * 0.3, len); g.stroke();
  }
  strandTex = new THREE.CanvasTexture(c); strandTex.colorSpace = THREE.SRGBColorSpace; strandTex.anisotropy = 4;
  return strandTex;
}
const cache = {};
// style: short(댄디컷) | side(가르마) | buzz(짧게 깎음) | sides(모자 아래 옆·뒤만) | bald(정수리 빠짐)
function build(style, ht) {
  const C = new THREE.Vector3(0, ht - 0.088, -0.012), R = new THREE.Vector3(0.099, 0.089, 0.109);
  const pos = [], uv = [], col = [], idx = [];
  const P = (phi, al) => new THREE.Vector3(C.x + R.x * Math.sin(phi) * Math.sin(al), C.y + R.y * Math.cos(phi), C.z + R.z * Math.sin(phi) * Math.cos(al));
  const normalAt = p => new THREE.Vector3((p.x - C.x) / (R.x * R.x), (p.y - C.y) / (R.y * R.y), (p.z - C.z) / (R.z * R.z)).normalize();
  const snap = (p, off) => { const q = new THREE.Vector3((p.x - C.x) / R.x, (p.y - C.y) / R.y, (p.z - C.z) / R.z); q.multiplyScalar((1 + off / 0.1) / q.length()); return new THREE.Vector3(C.x + q.x * R.x, C.y + q.y * R.y, C.z + q.z * R.z); };
  const lift = (p, off) => { const q = new THREE.Vector3((p.x - C.x) / R.x, (p.y - C.y) / R.y, (p.z - C.z) / R.z), r = q.length(), want = 1 + off / 0.1; if (r < want) q.multiplyScalar(want / r); return new THREE.Vector3(C.x + q.x * R.x, C.y + q.y * R.y, C.z + q.z * R.z); };
  const maxPhi = al => { const f = Math.cos(al); return f > 0 ? 1.72 - 0.72 * f : 1.72 + 0.36 * -f; };
  const card = (phi, al, len, w, off, flow, grav, shade, hug = false) => {
    let p = lift(P(phi, al), off), n = normalAt(p), d = flow(p, n, phi, al).addScaledVector(n, -0.15).normalize();
    const S = 4, base = pos.length / 3, sl = len / S;
    for (let k = 0; k <= S; k++) {
      const t = k / S, side = new THREE.Vector3().crossVectors(d, n).normalize().multiplyScalar(w * (1 - 0.65 * t) / 2);
      const a = p.clone().add(side), b = p.clone().sub(side);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z); uv.push(0, 1 - t, 1, 1 - t);
      const c = shade * (0.5 + 0.5 * t); col.push(c, c, c, c, c, c);
      if (k < S) {
        let np = p.clone().addScaledVector(d, sl); np.y -= grav * sl * (k + 1) / S; np = hug ? snap(np, off + 0.0008 * (k + 1)) : lift(np, off + 0.0012 * (k + 1));
        d = np.clone().sub(p).normalize(); p = np; n = normalAt(p);
        idx.push(base + k * 2, base + k * 2 + 1, base + k * 2 + 2, base + k * 2 + 1, base + k * 2 + 3, base + k * 2 + 2);
      }
    }
  };
  const down = (p, n) => new THREE.Vector3(0, -1, 0).addScaledVector(n, n.y).normalize();
  // 결 방향: 정수리 뒤쪽(가마)에서 앞·옆·뒤로 흘러내림
  const crown = new THREE.Vector3(0.012, C.y + R.y * 0.92, C.z - R.z * 0.35);
  const fromCrown = (p, n) => { const v = p.clone().sub(crown); v.addScaledVector(n, -v.dot(n)); return v.lengthSq() < 1e-6 ? new THREE.Vector3(0, 0, 1) : v.normalize(); };
  const partAl = 0.42; // 가르마 위치(왼쪽)
  const fromPart = (p, n, phi, al) => { const s = Math.sign(Math.sin(al - partAl)) || 1, v = new THREE.Vector3(Math.cos(al) * s, -0.15, -Math.sin(al) * s); v.addScaledVector(n, -v.dot(n)); return v.normalize().lerp(down(p, n), phi > 1.1 ? 0.7 : 0.15).normalize(); };
  const N = { short: 620, side: 640, buzz: 520, sides: 360, bald: 260 }[style] || 560;
  for (let i = 0; i < N; i++) {
    const al = Math.random() * Math.PI * 2, mp = maxPhi(al), u = Math.random(), phi = Math.acos(1 - u * (1 - Math.cos(mp)));
    const top = phi < 1.05, layer = i % 3 === 0 ? 0.003 : 0.0062, shade = 0.75 + Math.random() * 0.35;
    if ((style === 'sides' || style === 'bald') && phi < (style === 'bald' ? 1.15 : 1.25)) continue;
    if (style === 'buzz' || style === 'sides') { card(phi, al, 0.016 + Math.random() * 0.01, 0.016, layer * 0.5, fromCrown, 0.1, shade, true); continue; }
    if (style === 'bald') { card(phi, al, 0.03 + Math.random() * 0.015, 0.016, layer * 0.6, down, 0.3, shade, true); continue; }
    if (style === 'side') { card(phi, al, top ? 0.075 + Math.random() * 0.03 : 0.03 + Math.random() * 0.012, 0.018, top ? layer : layer * 0.6, fromPart, top ? 0.25 : 0.5, shade, !top); continue; }
    // short: 윗머리는 앞으로 내려온 앞머리, 옆·뒤는 짧게 (투블럭)
    card(phi, al, top ? 0.07 + Math.random() * 0.03 : 0.024 + Math.random() * 0.01, top ? 0.018 : 0.015, top ? layer : layer * 0.55, top ? fromCrown : down, top ? 0.4 : 0.4, shade, !top);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return { geo: g, C, R };
}
export function hairMesh(style, color, ht) {
  const key = style + ht.toFixed(3); const b = cache[key] ||= build(style, ht);
  const c = new THREE.Color(color);
  const mat = new THREE.MeshPhysicalMaterial({ color: c, map: strandTex || makeTex(), alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.55, vertexColors: true, sheen: 0.7, sheenRoughness: 0.32, sheenColor: c.clone().lerp(new THREE.Color(0xffffff), 0.35), envMapIntensity: 0.4 });
  const g = new THREE.Group(); const m = new THREE.Mesh(b.geo, mat); m.frustumCulled = false; g.add(m);
  // 두피 (머리카락 사이로 살이 비치지 않게 어두운 머리색 캡)
  if (style !== 'bald') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, style === 'sides' ? Math.PI * 0.62 : Math.PI * 0.56), new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.55), roughness: 0.9 }));
    cap.scale.copy(b.R).multiplyScalar(1.01); cap.position.copy(b.C); cap.rotation.x = -0.3; g.add(cap);
  }
  return g;
}
