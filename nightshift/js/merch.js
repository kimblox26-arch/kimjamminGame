// 진열 상품 다양화: 모양별로 포장 그림 64종을 한 장(아틀라스)에 그리고, 상품마다 다른 칸을 쓰게 한다 (그리기 1번/모양)
import * as THREE from 'three';
import { geoByKind, SHARED } from './products.js';

const FONT = '"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif';
const N = 8, CELL = 256;                    // 8×8 = 64종, 2048px
const R = (a) => a[Math.random() * a.length | 0];
const NAMES = {
  bag: [['바삭', '고소', '매콤', '달콤', '치즈', '허니', '양파', '콘', '새우', '감자', '고구마', '오징어', '버터', '마늘', '바베큐', '김'], ['칩', '볼', '스틱', '링', '깡', '콘', '튀김', '구이', '팝']],
  box: [['초코', '딸기', '바나나', '크림', '버터', '녹차', '우유', '카스텔라', '모카', '쿠키', '치즈'], ['파이', '쿠키', '케이크', '샌드', '웨하스', '롤', '타르트', '비스킷']],
  cup: [['매운', '짜장', '해물', '사골', '김치', '카레', '얼큰', '진한', '튀김', '새우', '육개장', '짬뽕'], ['컵면', '큰사발', '왕컵', '우동', '라면', '국수', '탕면']],
  can: [['콜라', '사이다', '오렌지', '포도', '복숭아', '레몬', '자몽', '파인', '커피', '밀크티', '에너지', '탄산수', '식혜', '수정과'], ['', ' 제로', ' 라이트', ' 스파클링']],
  bottle: [['보리차', '옥수수차', '녹차', '이온', '비타민', '오렌지', '포도', '아이스티', '생수', '헛개차', '아쿠아', '홍차'], ['', ' 500', ' 플러스', ' 제로']],
  small: [['자일리톨', '민트', '박하', '레몬', '포도', '딸기', '홍삼', '비타', '목캔디', '젤리', '마이쮸', '캬라멜'], ['껌', '캔디', '정', '구미', '사탕', '']],
  jar: [['바나나', '딸기', '초코', '커피', '멜론', '요구르트', '두유', '흰우유'], ['우유', '맛우유', ' 라떼', '']],
  soju: [['처음', '참', '새로', '진로', '청하', '좋은', '대선', '한라'], ['이야', '이슬', '소주', '처럼', '데이', '']],
};
const BRANDS = ['달빛푸드', '한빛제과', '새벽식품', '미소', '온누리', '참좋은', '해맑음', '바람제과', '하늘음료', '별빛', '산들', '푸른들'];
const PAL = [['#d62828', '#ffd166'], ['#f77f00', '#fff3b0'], ['#1d3557', '#f1faee'], ['#2a9d8f', '#e9c46a'], ['#6a4c93', '#ffca3a'], ['#118ab2', '#ffffff'], ['#ef476f', '#ffffff'],
  ['#073b4c', '#06d6a0'], ['#ffb703', '#023047'], ['#2b2d42', '#ef233c'], ['#e63946', '#f1faee'], ['#264653', '#f4a261'], ['#9b2226', '#e9d8a6'], ['#3a86ff', '#ffbe0b'], ['#8338ec', '#ffffff'], ['#008000', '#ffffff'], ['#111111', '#ffcc00']];

const PRICE = { bag: [1500, 2500], box: [2000, 4800], cup: [1100, 1900], can: [1200, 2200], bottle: [1000, 2500], small: [800, 1500], jar: [1500, 1900], soju: [1900, 2100] };
export const INFO = {};
function drawCell(g, kind, x, y, s, idx) {
  const [c1, c2] = R(PAL), name = R(NAMES[kind][0]) + R(NAMES[kind][1]), brand = R(BRANDS);
  const [pa, pb] = PRICE[kind]; (INFO[kind] ||= [])[idx] = { name: name.trim(), brand, price: Math.round((pa + Math.random() * (pb - pa)) / 100) * 100, promo: Math.random() < 0.22 ? R(['1+1', '2+1', '할인']) : '' };
  g.save(); g.beginPath(); g.rect(x, y, s, s); g.clip();
  const gr = g.createLinearGradient(x, y, x, y + s); gr.addColorStop(0, c1); gr.addColorStop(1, shade(c1, -0.22)); g.fillStyle = gr; g.fillRect(x, y, s, s);
  const wrap = kind === 'can' || kind === 'bottle' || kind === 'cup' || kind === 'jar' || kind === 'soju';
  const reps = wrap ? [0, s / 2] : [0];
  for (const ox of reps) {
    const w = wrap ? s / 2 : s, cx = x + ox + w / 2;
    // 그림 (음식 사진 느낌: 둥근 덩어리들 + 하이라이트)
    if (kind === 'bag' || kind === 'box' || kind === 'cup') {
      for (let i = 0; i < 7; i++) { const r = w * (0.06 + Math.random() * 0.08); g.fillStyle = shade(R(['#e8b04a', '#c96b2c', '#f2d16b', '#8a4b20', '#f6e1a6', '#d63c2a']), Math.random() * 0.2 - 0.1); g.beginPath(); g.ellipse(cx - w * 0.2 + Math.random() * w * 0.4, y + s * 0.66 + Math.random() * s * 0.15, r, r * 0.7, Math.random() * 3, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(cx - w * 0.2 + Math.random() * w * 0.4, y + s * 0.62 + Math.random() * s * 0.15, r * 0.3, r * 0.15, 0, 0, 7); g.fill(); }
    } else { g.fillStyle = c2; g.globalAlpha = 0.9; g.beginPath(); g.moveTo(x + ox, y + s * 0.6); g.bezierCurveTo(cx - w * 0.2, y + s * 0.5, cx + w * 0.2, y + s * 0.75, x + ox + w, y + s * 0.58); g.lineTo(x + ox + w, y + s * 0.7); g.bezierCurveTo(cx + w * 0.2, y + s * 0.88, cx - w * 0.2, y + s * 0.62, x + ox, y + s * 0.74); g.fill(); g.globalAlpha = 1; }
    // 상표·이름
    g.fillStyle = c2; g.font = `800 ${w * 0.075}px ${FONT}`; g.textAlign = 'center'; g.fillText(brand, cx, y + s * 0.13);
    g.font = `900 ${Math.min(w * 0.22, (w * 0.9) / Math.max(2, name.length) * 1.1)}px ${FONT}`;
    g.lineWidth = w * 0.025; g.strokeStyle = shade(c1, -0.45); g.strokeText(name, cx, y + s * 0.38); g.fillStyle = c2; g.fillText(name, cx, y + s * 0.38);
    g.font = `700 ${w * 0.06}px ${FONT}`; g.fillStyle = c2; g.fillText(R(kind === 'can' ? ['355ml', '250ml', '500ml'] : kind === 'bottle' ? ['500ml', '340ml', '1.5L'] : kind === 'cup' ? ['110g', '86g', '컵라면'] : ['80g', '120g', '60g', '대용량']), cx, y + s * 0.93);
    if (Math.random() < 0.3) { g.fillStyle = '#ffdd00'; g.beginPath(); g.arc(x + ox + w * 0.82, y + s * 0.22, w * 0.11, 0, 7); g.fill(); g.fillStyle = '#d00'; g.font = `900 ${w * 0.06}px ${FONT}`; g.fillText(R(['NEW', '증량', '1+1', '한정']), x + ox + w * 0.82, y + s * 0.24); }
  }
  // 바코드
  g.fillStyle = '#fff'; g.fillRect(x + s * 0.8, y + s * 0.74, s * 0.15, s * 0.12); g.fillStyle = '#000'; for (let p = 0; p < s * 0.13; p += 2 + (Math.random() * 2 | 0)) g.fillRect(x + s * 0.81 + p, y + s * 0.75, 1, s * 0.09);
  // 광택·주름
  const sh = g.createLinearGradient(x, y, x + s, y); sh.addColorStop(0, 'rgba(0,0,0,.22)'); sh.addColorStop(0.3, 'rgba(255,255,255,.16)'); sh.addColorStop(0.55, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,.2)'); g.fillStyle = sh; g.fillRect(x, y, s, s);
  if (kind === 'bag') { g.strokeStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(x, y + i * 3 + 2); g.lineTo(x + s, y + i * 3 + 2); g.moveTo(x, y + s - i * 3 - 2); g.lineTo(x + s, y + s - i * 3 - 2); g.stroke(); } }
  g.restore();
}
function shade(hex, k) { const c = new THREE.Color(hex); c.offsetHSL(0, 0, k); return '#' + c.getHexString(); }

const atlases = {};
function atlas(kind) {
  if (atlases[kind]) return atlases[kind];
  const c = document.createElement('canvas'); c.width = c.height = N * CELL; const g = c.getContext('2d');
  for (let i = 0; i < N * N; i++) drawCell(g, kind, (i % N) * CELL, Math.floor(i / N) * CELL, CELL, i);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  return (atlases[kind] = t);
}
const tagAtlases = {};
function tagAtlas(kind) {
  if (tagAtlases[kind]) return tagAtlases[kind];
  atlas(kind); const c = document.createElement('canvas'); c.width = N * 256; c.height = N * 128; const g = c.getContext('2d');
  INFO[kind].forEach((it, i) => {
    const x = (i % N) * 256, y = Math.floor(i / N) * 128;
    g.fillStyle = it.promo ? '#ffe14d' : '#ffffff'; g.fillRect(x + 2, y + 2, 252, 124); g.strokeStyle = '#b8bec6'; g.lineWidth = 2; g.strokeRect(x + 2, y + 2, 252, 124);
    if (it.promo) { g.fillStyle = '#d62828'; g.fillRect(x + 2, y + 2, 80, 30); g.fillStyle = '#fff'; g.font = `900 22px ${FONT}`; g.fillText(it.promo, x + 12, y + 25); }
    g.fillStyle = '#222'; g.font = `700 20px ${FONT}`; g.fillText(it.brand, x + (it.promo ? 92 : 12), y + 26);
    g.font = `800 26px ${FONT}`; g.fillText(it.name.slice(0, 9), x + 12, y + 62);
    g.fillStyle = it.promo ? '#d62828' : '#111'; g.font = `900 40px ${FONT}`; g.textAlign = 'right'; g.fillText(it.price.toLocaleString() + '원', x + 244, y + 112); g.textAlign = 'left';
    g.fillStyle = '#000'; for (let p = 0; p < 70; p += 2 + (Math.random() * 2 | 0)) g.fillRect(x + 12 + p, y + 82, 1, 28);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return (tagAtlases[kind] = t);
}
// 인스턴스마다 아틀라스 칸을 고르는 재질
function atlasMat(kind, opts = {}, tex) {
  const m = new THREE.MeshStandardMaterial({ map: tex || atlas(kind), roughness: kind === 'can' ? 0.3 : kind === 'bag' ? 0.35 : 0.5, metalness: kind === 'can' ? 0.5 : 0, envMapIntensity: 0.9, ...opts });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_INSTANCING\n vMapUv = vMapUv / ${N}.0 + vec2(aCell.x, ${N - 1}.0 - aCell.y) / ${N}.0;\n#endif`);
  };
  m.customProgramCacheKey = () => 'atlas' + N;
  return m;
}
const KIND_MATS = {
  bag: () => atlasMat('bag'), box: () => atlasMat('box'), small: () => atlasMat('small'),
  cup: () => [atlasMat('cup'), new THREE.MeshStandardMaterial({ color: 0xd9dcdf, roughness: 0.3, metalness: 0.7 }), SHARED.capW],
  can: () => [atlasMat('can'), SHARED.metal, SHARED.metal],
  bottle: () => [atlasMat('bottle'), SHARED.pet, SHARED.cap],
  jar: () => [atlasMat('jar', { transparent: true, opacity: 0.96 }), SHARED.capW],
  soju: () => [SHARED.green, atlasMat('soju'), SHARED.capG],
};
export const SPAN = { cup: 0.122, tri: 0.09, tray: 0.24, jar: 0.078, bottle: 0.074, can: 0.072, soju: 0.078, bag: 0.165, box: 0.205, small: 0.082 };

const tagGeo = new THREE.PlaneGeometry(0.078, 0.039).translate(0, -0.0195, 0);
export class Merch {
  constructor() { this.list = {}; this.tags = {}; this.looseList = {}; this.loose = []; }
  mat(x, y, z, ry, s = 1, rx = 0, rz = 0) { return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s)); }
  // kind 모양을 x,y,z 에 (ry 회전), cell = 아틀라스 칸 번호
  add(kind, x, y, z, ry, cell, scale = 1, loose = null) {
    const m = this.mat(x, y, z, ry + (Math.random() - 0.5) * 0.12, scale, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02);
    if (loose) (this.looseList[kind] ||= []).push({ m, cell, aisle: loose }); else (this.list[kind] ||= []).push({ m, cell });
  }
  // 진열칸 하나: 같은 상품 2~4개씩 나란히(페이싱), 깊이 2~3줄, 가끔 빈자리. 묶음마다 가격표
  fillShelf(kind, x0, x1, y, zFront, depthDir, ry, rows = 3, axis = 'x') {
    const step = SPAN[kind]; let pos = x0, cell = 0, left = 0;
    while (pos + step * 0.5 < x1) {
      if (left <= 0) {
        cell = Math.random() * 64 | 0; left = 2 + (Math.random() * 3 | 0);
        const tf = zFront - depthDir * 0.03; (this.tags[kind] ||= []).push({ m: axis === 'x' ? this.mat(pos + step * 0.4, y - 0.004, tf, ry) : this.mat(tf, y - 0.004, pos + step * 0.4, ry), cell });
      }
      const n = Math.random() < 0.07 ? 0 : Math.random() < 0.25 ? rows - 1 : rows;
      for (let d = 0; d < n; d++) {
        const dd = zFront + depthDir * (d * (kind === 'bag' ? 0.07 : step * 1.05) + 0.04);
        const loose = d === 0 && kind !== 'soju' && Math.random() < 0.05 ? { dir: -depthDir, axis } : null;   // 맨 앞줄 일부는 손님이 건드리면 넘어짐
        axis === 'x' ? this.add(kind, pos, y, dd, ry, cell, 1, loose) : this.add(kind, dd, y, pos, ry, cell, 1, loose);
      }
      pos += step * (1.02 + Math.random() * 0.06); left--;
    }
  }
  makeIM(kind, items, mats, geo) {
    geo = (geo || geoByKind(kind)).clone(); const cells = new Float32Array(items.length * 2);
    items.forEach((it, i) => { cells[i * 2] = it.cell % N; cells[i * 2 + 1] = Math.floor(it.cell / N); });
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    const im = new THREE.InstancedMesh(geo, mats, items.length); items.forEach((it, i) => im.setMatrixAt(i, it.m)); im.matrixAutoUpdate = false; im.updateMatrix(); im.computeBoundingSphere?.(); return im;
  }
  build(root) {
    const matsBy = {};
    for (const [kind, items] of Object.entries(this.list)) root.add(this.makeIM(kind, items, matsBy[kind] ||= KIND_MATS[kind]()));
    for (const [kind, items] of Object.entries(this.tags)) { const im = this.makeIM(kind, items, atlasMat(kind, { roughness: 0.4, metalness: 0, envMapIntensity: 0.4 }, tagAtlas(kind)), tagGeo); root.add(im); }
    // 흐트러질 수 있는 상품: 따로 그려서 행렬만 바꾼다. 처음엔 40% 가 넘어져 있음
    for (const [kind, items] of Object.entries(this.looseList)) {
      const im = this.makeIM(kind, items, matsBy[kind] ||= KIND_MATS[kind]()); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.userData.loose = true; root.add(im);
      items.forEach((it, i) => { const e = { kind, im, i, proper: it.m.clone(), aisle: it.aisle, messy: false, pos: new THREE.Vector3().setFromMatrixPosition(it.m) }; this.loose.push(e); im.userData.entries ||= []; im.userData.entries[i] = e; });
    }
    this.looseMeshes = Object.values(this.looseList).length ? root.children.filter(o => o.userData.loose) : [];
  }
  // 넘어뜨리기: 선반 위에 옆으로 눕거나, 바닥(통로)으로 떨어짐
  mess(e, silent) {
    const p = e.pos.clone(), A = e.aisle, r = Math.random();
    let m;
    if (r < 0.55) m = this.mat(p.x, p.y + 0.03, p.z, Math.random() * 6, 1, Math.PI / 2, 0);
    else { const off = 0.35 + Math.random() * 0.5; if (A.axis === 'z') p.x += A.dir * off; else p.z += A.dir * off; m = this.mat(p.x, 0.03, p.z, Math.random() * 6, 1, Math.PI / 2, Math.random() * 0.4); }
    e.im.setMatrixAt(e.i, m); e.im.instanceMatrix.needsUpdate = true; e.messy = true; e.cur = m;
    return silent ? null : (r < 0.55 ? p : new THREE.Vector3(p.x, 0, p.z));
  }
  // 정리: 제자리로 부드럽게
  tidy(e, dur = 0.35) {
    if (!e.messy) return; e.messy = false;
    const a = new THREE.Vector3(), aq = new THREE.Quaternion(), as = new THREE.Vector3(), b = new THREE.Vector3(), bq = new THREE.Quaternion(), bs = new THREE.Vector3();
    e.cur.decompose(a, aq, as); e.proper.decompose(b, bq, bs); const t0 = performance.now();
    const step = () => { const k = Math.min(1, (performance.now() - t0) / 1000 / dur), ee = k * k * (3 - 2 * k), m = new THREE.Matrix4().compose(a.clone().lerp(b, ee).add(new THREE.Vector3(0, Math.sin(k * Math.PI) * 0.12, 0)), aq.clone().slerp(bq, ee), bs); e.im.setMatrixAt(e.i, m); e.im.instanceMatrix.needsUpdate = true; if (k < 1) requestAnimationFrame(step); };
    step();
  }
  knockNear(pos, maxD = 2.5) { const c = this.loose.filter(e => !e.messy && e.pos.distanceTo(pos) < maxD); if (!c.length) return null; return this.mess(c[Math.random() * c.length | 0]); }
  messyCount() { return this.loose.filter(e => e.messy).length; }
}
