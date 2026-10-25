// SKY BLADE — 사람·탈것 모형 (실제 비율, 한국 도시 차량)
//  - 차: 옆모습 윤곽을 밀어 만든 차체 + 좁은 유리 지붕(텀블홈) + 바퀴(타이어·휠) + 전조등·미등(스스로 빛남) + 번호판
//  - 버스: 서울 시내버스 (저상, 큰 창, 앞·가운데 문, 행선지 LED). 도색 부분만 노선 색 (간선 파랑·지선 초록·광역 빨강·순환 노랑)
//  - 전동차: 스테인리스 차체, 양쪽 4개 출입문, 노선 색 띠, 앞 칸은 운전실 (비스듬한 앞면, 행선지 표시)
//  - 사람: 둥근 머리·목·어깨가 있는 몸통, 원기둥 팔다리, 머리카락(짧은/긴), 치마/바지, 가방
//  정점 속성: color (기본 색), aPaint (1 = 인스턴스 색으로 칠함), aEm (스스로 빛나는 정도), aPart (사람 관절)
import * as THREE from 'three';

function attr(g, col, paint, em, part) {
  const n = g.attributes.position.count;
  const c = new THREE.Color(col);
  const ca = new Float32Array(n * 3), pa = new Float32Array(n).fill(paint), ea = new Float32Array(n).fill(em), pp = new Float32Array(n).fill(part);
  for (let i = 0; i < n; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
  g.setAttribute('aPaint', new THREE.BufferAttribute(pa, 1));
  g.setAttribute('aEm', new THREE.BufferAttribute(ea, 1));
  g.setAttribute('aPart', new THREE.BufferAttribute(pp, 1));
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  return g.index ? g.toNonIndexed() : g;
}
function merge(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'color', 'aPaint', 'aEm', 'aPart']) {
    const sz = list[0].attributes[k].itemSize, arr = new Float32Array(n * sz);
    let o = 0;
    for (const g of list) { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, sz));
  }
  out.computeBoundingSphere();
  return out;
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
// 옆모습 (z, y) 점들을 x 방향으로 width 만큼 밀어냄 (가운데 정렬), 모서리 둥글게
function sideExtrude(pts, width, bevel = 0.05) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  // 모양 좌표 (x=길이, y=높이) → (z, y), 밀어낸 방향 → x
  g.rotateY(-Math.PI / 2);
  g.translate(-(width - bevel * 2) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}
function wheel(r, w, x, y, z, rim = 0xb8bcc2) {
  const t = new THREE.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2).translate(x, y, z);
  const m = new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 10).rotateZ(Math.PI / 2).translate(x, y, z);
  return [attr(t, 0x161616, 0, 0, 0), attr(m, rim, 0, 0, 0)];
}

// ───────── 승용차 (중형 세단) ─────────
export function sedanGeo() {
  const W = 1.86;
  const body = sideExtrude([[2.42, 0.32], [2.46, 0.6], [2.25, 0.8], [0.95, 0.93], [-1.75, 0.98], [-2.38, 0.9], [-2.45, 0.6], [-2.4, 0.32],
    [-1.83, 0.32], [-1.6, 0.62], [-1.1, 0.62], [-0.87, 0.32], [0.87, 0.32], [1.1, 0.62], [1.6, 0.62], [1.83, 0.32]], W, 0.07);
  const glass = sideExtrude([[1.0, 0.9], [0.12, 1.38], [-0.95, 1.4], [-1.82, 0.97]], 1.62, 0.06);
  const roof = sideExtrude([[0.1, 1.38], [-0.92, 1.41], [-0.95, 1.46], [0.08, 1.44]], 1.5, 0.03);
  const parts = [attr(body, 0xffffff, 1, 0, 0), attr(glass, 0x0e1418, 0, 0, 0), attr(roof, 0xffffff, 1, 0, 0)];
  // B 필러 (도색)
  parts.push(attr(box(1.64, 0.42, 0.1, 0, 1.17, -0.42), 0xffffff, 1, 0, 0));
  for (const [z, s] of [[1.45, 1], [-1.45, 1]]) for (const x of [-0.82, 0.82]) parts.push(...wheel(0.34, 0.24, x, 0.34, z));
  // 전조등 (얇은 LED), 미등 (가로 일자), 번호판 (흰색), 사이드미러
  parts.push(attr(box(0.42, 0.08, 0.05, -0.62, 0.72, 2.4), 0xfff4dd, 0, 2.5, 0), attr(box(0.42, 0.08, 0.05, 0.62, 0.72, 2.4), 0xfff4dd, 0, 2.5, 0));
  parts.push(attr(box(1.66, 0.07, 0.05, 0, 0.86, -2.4), 0xd01010, 0, 1.2, 0));
  parts.push(attr(box(0.52, 0.11, 0.02, 0, 0.45, 2.47), 0xf0f0f0, 0, 0, 0), attr(box(0.52, 0.11, 0.02, 0, 0.6, -2.47), 0xf0f0f0, 0, 0, 0));
  parts.push(attr(box(0.2, 0.1, 0.14, -0.98, 0.98, 0.85), 0xffffff, 1, 0, 0), attr(box(0.2, 0.1, 0.14, 0.98, 0.98, 0.85), 0xffffff, 1, 0, 0));
  parts.push(attr(box(1.4, 0.16, 0.06, 0, 0.42, 2.44), 0x111111, 0, 0, 0));   // 그릴
  return merge(parts);
}
// ───────── SUV ─────────
export function suvGeo() {
  const W = 1.92;
  const body = sideExtrude([[2.3, 0.4], [2.36, 0.78], [2.15, 0.98], [1.15, 1.08], [-2.2, 1.12], [-2.32, 0.8], [-2.3, 0.4],
    [-1.8, 0.4], [-1.55, 0.74], [-1.0, 0.74], [-0.78, 0.4], [0.82, 0.4], [1.05, 0.74], [1.6, 0.74], [1.85, 0.4]], W, 0.08);
  const glass = sideExtrude([[1.2, 1.05], [0.35, 1.62], [-2.05, 1.66], [-2.22, 1.1]], 1.7, 0.06);
  const roof = sideExtrude([[0.32, 1.62], [-2.02, 1.66], [-2.0, 1.72], [0.3, 1.69]], 1.62, 0.03);
  const parts = [attr(body, 0xffffff, 1, 0, 0), attr(glass, 0x0e1418, 0, 0, 0), attr(roof, 0xffffff, 1, 0, 0)];
  parts.push(attr(box(1.72, 0.5, 0.1, 0, 1.36, -0.35), 0xffffff, 1, 0, 0), attr(box(1.72, 0.5, 0.1, 0, 1.36, -1.3), 0xffffff, 1, 0, 0));
  for (const z of [1.42, -1.42]) for (const x of [-0.84, 0.84]) parts.push(...wheel(0.38, 0.26, x, 0.38, z));
  parts.push(attr(box(0.45, 0.1, 0.05, -0.62, 0.9, 2.33), 0xfff4dd, 0, 2.5, 0), attr(box(0.45, 0.1, 0.05, 0.62, 0.9, 2.33), 0xfff4dd, 0, 2.5, 0));
  parts.push(attr(box(0.3, 0.3, 0.05, -0.75, 1.0, -2.3), 0xc01010, 0, 1.2, 0), attr(box(0.3, 0.3, 0.05, 0.75, 1.0, -2.3), 0xc01010, 0, 1.2, 0));
  parts.push(attr(box(0.52, 0.11, 0.02, 0, 0.55, 2.37), 0xf0f0f0, 0, 0, 0), attr(box(0.52, 0.11, 0.02, 0, 0.7, -2.32), 0xf0f0f0, 0, 0, 0));
  parts.push(attr(box(1.92, 0.22, 4.4, 0, 0.42, 0), 0x2a2a2a, 0, 0, 0));    // 아래 검은 몰딩
  return merge(parts);
}
// ───────── 택시 (세단 + 지붕 표시등) ─────────
export function taxiGeo() {
  const g = sedanGeo();
  const sign = [attr(box(0.62, 0.22, 0.26, 0, 1.58, -0.4), 0xfff2c0, 0, 1.4, 0), attr(box(0.66, 0.04, 0.3, 0, 1.47, -0.4), 0x222222, 0, 0, 0)];
  return merge([g, ...sign]);
}
// ───────── 시내버스 (저상, 11 m) ─────────
export function busGeo() {
  const parts = [];
  const body = sideExtrude([[5.45, 0.32], [5.55, 1.1], [5.42, 3.05], [5.2, 3.2], [-5.4, 3.2], [-5.55, 3.0], [-5.55, 0.32],
    [-3.6, 0.32], [-3.45, 0.95], [-2.55, 0.95], [-2.4, 0.32], [2.75, 0.32], [2.9, 0.95], [3.8, 0.95], [3.95, 0.32]], 2.5, 0.08);
  parts.push(attr(body, 0xf2f2f2, 0, 0, 0));
  // 도색: 창 아래 띠와 지붕 끝 (노선 색)
  parts.push(attr(box(2.54, 0.55, 10.9, 0, 0.98, 0), 0xffffff, 1, 0, 0), attr(box(2.54, 0.35, 10.9, 0, 2.98, -0.05), 0xffffff, 1, 0, 0));
  // 옆 창 (기둥으로 나뉨), 앞 유리, 뒷 유리
  for (let z = -4.9; z < 4.1; z += 1.42) parts.push(attr(box(2.56, 1.3, 1.24, 0, 2.05, z + 0.62), 0x0d1318, 0, 0, 0));
  parts.push(attr(box(2.3, 1.75, 0.08, 0, 1.95, 5.5), 0x0d1318, 0, 0, 0), attr(box(2.1, 0.9, 0.06, 0, 2.3, -5.56), 0x0d1318, 0, 0, 0));
  // 문 (오른쪽: 앞·가운데), 행선지 LED
  parts.push(attr(box(0.06, 2.4, 1.15, 1.27, 1.55, 4.65), 0x101820, 0, 0, 0), attr(box(0.06, 2.4, 1.15, 1.27, 1.55, -0.4), 0x101820, 0, 0, 0));
  parts.push(attr(box(1.9, 0.26, 0.05, 0, 2.95, 5.5), 0xff9a20, 0, 2.2, 0), attr(box(0.05, 0.22, 1.4, 1.28, 2.95, 1.6), 0xff9a20, 0, 1.6, 0));
  parts.push(attr(box(0.4, 0.14, 0.05, -0.9, 0.72, 5.56), 0xfff4dd, 0, 2.5, 0), attr(box(0.4, 0.14, 0.05, 0.9, 0.72, 5.56), 0xfff4dd, 0, 2.5, 0));
  parts.push(attr(box(0.25, 0.4, 0.05, -1.05, 0.9, -5.58), 0xc01010, 0, 1.2, 0), attr(box(0.25, 0.4, 0.05, 1.05, 0.9, -5.58), 0xc01010, 0, 1.2, 0));
  parts.push(attr(box(1.6, 0.25, 2.6, 0, 3.32, -3.8), 0xd8d8d8, 0, 0, 0));   // 지붕 위 냉방기
  for (const z of [3.35, -3.0]) for (const x of [-1.06, 1.06]) parts.push(...wheel(0.5, 0.32, x, 0.5, z, 0x9aa0a6));
  return merge(parts);
}
// ───────── 전동차 (한 칸 19.5 m). cab: 운전실 칸 (앞이 +z) ─────────
export function railCarGeo(cab = false) {
  const parts = [];
  const L = 19.5, hz = L / 2;
  const prof = cab
    ? [[hz - 0.9, 0.95], [hz, 1.25], [hz - 0.15, 3.1], [hz - 0.7, 3.75], [-hz, 3.75], [-hz, 0.95]]
    : [[hz, 0.95], [hz, 3.75], [-hz, 3.75], [-hz, 0.95]];
  parts.push(attr(sideExtrude(prof, 3.12, 0.1), 0xc6cacf, 0, 0, 0));
  // 노선 색 띠 (창 아래·위), 창 띠, 출입문 4개 × 양쪽
  // (띠는 인스턴스 색 = 노선 색)
  parts.push(attr(box(3.16, 0.32, L - (cab ? 1.2 : 0.2), 0, 1.55, cab ? -0.5 : 0), 0xffffff, 1, 0, 0), attr(box(3.16, 0.12, L - (cab ? 1.2 : 0.2), 0, 3.25, cab ? -0.5 : 0), 0xffffff, 1, 0, 0));
  for (let k = -1.5; k <= 1.5; k += 1) {
    const z = k * 4.6 - (cab ? 0.3 : 0);
    // 문 사이 창
    if (k < 1.5) parts.push(attr(box(3.15, 0.95, 2.6, 0, 2.45, z + 2.3), 0x0c1216, 0, 0, 0));
    parts.push(attr(box(3.17, 1.95, 1.35, 0, 1.98, z), 0x8d949b, 0, 0, 0), attr(box(3.18, 1.0, 0.5, 0, 2.3, z - 0.3), 0x0c1216, 0, 0, 0), attr(box(3.18, 1.0, 0.5, 0, 2.3, z + 0.3), 0x0c1216, 0, 0, 0));
  }
  if (cab) {
    parts.push(attr(sideExtrude([[hz - 0.18, 2.0], [hz - 0.2, 3.05], [hz - 0.65, 3.6], [hz - 0.75, 2.0]], 2.7, 0.03), 0x0b1014, 0, 0, 0));
    parts.push(attr(box(1.6, 0.25, 0.08, 0, 3.35, hz - 0.5), 0xff8a1a, 0, 2.2, 0));
    parts.push(attr(box(0.35, 0.16, 0.08, -1.05, 1.35, hz - 0.05), 0xfff4dd, 0, 2.5, 0), attr(box(0.35, 0.16, 0.08, 1.05, 1.35, hz - 0.05), 0xfff4dd, 0, 2.5, 0));
    parts.push(attr(box(2.4, 0.25, 0.5, 0, 0.8, hz - 0.25), 0x222222, 0, 0, 0));
  }
  // 대차·바퀴 (앞뒤), 지붕 냉방기, 팬터그래프 받침
  for (const z of [6.2, -6.2]) {
    parts.push(attr(box(2.5, 0.55, 3.2, 0, 0.55, z), 0x262626, 0, 0, 0));
    for (const dz of [-1.05, 1.05]) for (const x of [-0.72, 0.72]) parts.push(...wheel(0.43, 0.14, x, 0.43, z + dz, 0x555555));
    parts.push(attr(box(2.2, 0.3, 2.6, 0, 3.92, z * 0.9), 0xb8bcc0, 0, 0, 0));
  }
  parts.push(attr(box(2.9, 0.25, L - 1, 0, 0.82, 0), 0x303030, 0, 0, 0));
  return merge(parts);
}

// 탈것 재질: aPaint 인 부분만 인스턴스 색, aEm 은 스스로 빛남 (밤에도 보이는 등)
export function vehicleMat(metal = 0.45, rough = 0.38) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: metal, roughness: rough });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPaint; attribute float aEm; varying float vEm;')
      .replace('#include <color_vertex>', `vColor = vec3(1.0);
#ifdef USE_COLOR
vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
if (aPaint > 0.5) vColor *= instanceColor.xyz;
#endif
vEm = aEm;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEm;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vEm;');
  };
  m.customProgramCacheKey = () => 'sky-vehicle';
  return m;
}

// ───────── 사람 ─────────
//  part: 0 몸통, 1 머리·목, 2/3 다리, 4/5 팔, 6 머리카락, 7/8 신발, 9/10 손, 11 가방, 12 긴 머리 (뒤), 13 치마
export function personGeo() {
  const P = [];
  const add = (g, part, col = 0xffffff) => P.push(attr(g, col, 0, 0, part));
  // 몸통: 어깨가 넓고 허리가 좁은 타원 기둥 + 골반
  add(new THREE.CylinderGeometry(0.19, 0.15, 0.5, 12).scale(1, 1, 0.62).translate(0, 1.15, 0), 0);
  add(new THREE.SphereGeometry(0.19, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.32, 0.62).translate(0, 1.39, 0), 0);
  add(new THREE.CylinderGeometry(0.15, 0.16, 0.18, 12).scale(1, 1, 0.66).translate(0, 0.86, 0), 2.5);
  // 목, 머리 (살짝 갸름한 공), 귀, 코
  add(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8).translate(0, 1.44, 0), 1);
  add(new THREE.SphereGeometry(0.105, 16, 12).scale(0.93, 1.12, 1.0).translate(0, 1.56, 0.005), 1);
  add(new THREE.SphereGeometry(0.022, 6, 4).scale(0.6, 1, 1).translate(-0.098, 1.56, 0), 1);
  add(new THREE.SphereGeometry(0.022, 6, 4).scale(0.6, 1, 1).translate(0.098, 1.56, 0), 1);
  add(new THREE.SphereGeometry(0.016, 6, 4).scale(0.8, 1.2, 1).translate(0, 1.55, 0.104), 1);
  // 머리카락: 정수리를 덮는 반구, 긴 머리 (뒤로 늘어짐)
  add(new THREE.SphereGeometry(0.114, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.08, 1.04).translate(0, 1.575, -0.008), 6);
  add(new THREE.CylinderGeometry(0.1, 0.085, 0.3, 10, 1, true, Math.PI * 0.55, Math.PI * 0.9).scale(1, 1, 1).translate(0, 1.47, -0.01), 12);
  // 다리 (허벅지~종아리), 신발
  for (const [x, pl, ps] of [[-0.085, 2, 7], [0.085, 3, 8]]) {
    add(new THREE.CylinderGeometry(0.075, 0.055, 0.8, 10).translate(x, 0.44, 0), pl);
    add(new THREE.BoxGeometry(0.1, 0.07, 0.25).translate(x, 0.035, 0.035), ps, 0x111111);
    add(new THREE.SphereGeometry(0.05, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1.2).translate(x, 0.07, 0.11), ps, 0x111111);
  }
  // 치마 (보이면 다리 위를 덮음)
  add(new THREE.CylinderGeometry(0.16, 0.25, 0.42, 14, 1, true).translate(0, 0.66, 0), 13);
  // 팔 (어깨~손목), 손
  for (const [x, pa, ph] of [[-0.225, 4, 9], [0.225, 5, 10]]) {
    add(new THREE.CylinderGeometry(0.05, 0.04, 0.58, 8).translate(x, 1.08, 0), pa);
    add(new THREE.SphereGeometry(0.045, 8, 6).scale(0.8, 1.1, 0.6).translate(x, 0.76, 0), ph);
  }
  // 가방 (백팩)
  add(new THREE.BoxGeometry(0.26, 0.34, 0.12).translate(0, 1.15, -0.16), 11);
  return merge(P);
}

export { attr, merge, box, sideExtrude };
