// 수능 감독관 — 사실적인 사람 모델: 그려 넣은 얼굴 · 머리카락 결 · 원단 노멀맵 · 손가락 · 1인칭 팔
import * as THREE from 'three';
import { R, merge, K, M, mkCanvas, ctex, rand, pick, normalFrom } from './world.js';

const PI = Math.PI, HP = PI / 2, C = {};
const hx = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const shade = (h, k) => { const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); const [r, g, b] = hx(h); return `rgb(${f(r)},${f(g)},${f(b)})`; };
const rgba = (h, a) => { const [r, g, b] = hx(h); return `rgba(${r},${g},${b},${a})`; };
const SP = (r, w = 20, h = 14, a, b, c, d) => new THREE.SphereGeometry(r, w, h, a, b, c, d);
const CY = (a, b, h, s = 16, open = false, t0, tl) => new THREE.CylinderGeometry(a, b, h, s, 1, open, t0, tl);
const CA = (r, l, s = 10) => new THREE.CapsuleGeometry(r, l, 4, s);
const TO = (r, t, rs = 8, ts = 24, arc = PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc);
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const LA = (pts, s = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), s);

export const SKIN = ['#efc9a6', '#e6b993', '#f3d3b5', '#ddae86', '#ebc29c'];
const HAIR = ['#161210', '#221913', '#2e2118', '#0f0f10', '#3d2b1d'];
const EYES = ['#4a2c1a', '#3b2416', '#5a3a22', '#2e1d12'];
const TOPS = ['#2b3a67', '#555b66', '#1f1f24', '#e6e6e4', '#6e2a36', '#2f5444', '#3d6aa0', '#5f4a86', '#1d2b40', '#121418', '#3a3d44', '#7d8590', '#24443a', '#8c2f2f', '#2d4f7c'];
const PANTS = ['#1f2536', '#18181c', '#363d4c', '#2b313b', '#455066', '#2b3a58'];
const SHOES = ['#f0f0ee', '#1a1a1a', '#b8302e', '#2b5aa8', '#e3ddcf', '#6d6f73'];

// ───────── 텍스처 ─────────
const shade2 = (h, k) => '#' + hx(h).map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('');
export function skinMat(skin) { const k = 's' + skin; return C[k] || (C[k] = new THREE.MeshStandardMaterial({ color: skin, roughness: .52, emissive: 0x3a1208, emissiveIntensity: .35 })); }
function hairMat(col) {
  const k = 'h' + col; if (C[k]) return C[k];
  const c = mkCanvas(128, 256), g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 260; i++) { const x = rand(0, 128); g.strokeStyle = Math.random() < .5 ? '#9a9a9a' : '#666'; g.lineWidth = rand(.6, 1.6); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + rand(-4, 4), 256); g.stroke(); }
  const n = ctex(normalFrom(c, 1.2), 3, 1, true);
  return (C[k] = new THREE.MeshStandardMaterial({ color: col, roughness: .5, normalMap: n, normalScale: new THREE.Vector2(.35, .35), side: THREE.DoubleSide }));
}
function fabricN(kind) {
  const key = 'n' + kind; if (C[key]) return C[key];
  const S = 256, c = mkCanvas(S, S), g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
  if (kind === 'quilt') { const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, '#202020'); gr.addColorStop(.12, '#9a9a9a'); gr.addColorStop(.5, '#f0f0f0'); gr.addColorStop(.88, '#9a9a9a'); gr.addColorStop(1, '#202020'); g.fillStyle = gr; g.fillRect(0, 0, S, S); }
  else if (kind === 'knit') { for (let y = 0; y < S; y += 8) for (let x = 0; x < S; x += 8) { g.fillStyle = '#c8c8c8'; g.beginPath(); g.ellipse(x + 2, y + 4, 2, 4, .5, 0, 7); g.ellipse(x + 6, y + 4, 2, 4, -.5, 0, 7); g.fill(); } }
  else if (kind === 'denim') { g.strokeStyle = '#b0b0b0'; g.lineWidth = 1.5; for (let i = -S; i < S; i += 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke(); } }
  else if (kind === 'suit') { g.strokeStyle = '#999'; g.lineWidth = 1; for (let i = -S; i < S; i += 3) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke(); } }
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? 0 : 255},${Math.random() < .5 ? 0 : 255},${Math.random() < .5 ? 0 : 255},${rand(0, .12)})`; g.fillRect(rand(0, S), rand(0, S), 1, 1); }
  const t = ctex(normalFrom(c, kind === 'quilt' ? 4 : 2), 1, 1, true);
  if (kind === 'quilt') t.repeat.set(1, 6); else t.repeat.set(kind === 'knit' ? 6 : 8, kind === 'knit' ? 6 : 8);
  return (C[key] = t);
}
export function clothMat(col, kind) {
  const key = 'c' + col + kind; if (C[key]) return C[key];
  const n = fabricN(kind), q = kind === 'quilt';
  return (C[key] = new THREE.MeshStandardMaterial({ color: col, roughness: q ? .45 : kind === 'suit' ? .72 : .9, normalMap: n, normalScale: new THREE.Vector2(q ? 1 : .5, q ? 1 : .5) }));
}

// ───────── 지오메트리 ─────────
const GA = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
function deform(g, front = .93, face = true) {
  const p = g.attributes.position, r = .118;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i); const nx = x / r, ny = y / r, nz = z / r;
    if (ny < 0) { const t = -ny; x *= 1 - .2 * t * t; z *= 1 - .07 * t; }
    z *= nz < 0 ? front : 1.05; y *= 1.1;
    if (ny < -.55 && nz < -.3) z -= .01 * (-ny - .55);
    if (face && nz < -.2) { // 얼굴 조각: 콧대·코끝·눈두덩·광대·입술·턱
      const w = Math.min(1, (-nz - .2) / .5);
      const dz = .017 * GA(nx, ny, 0, -.12, .07, .13) + .011 * GA(nx, ny, 0, -.22, .065, .055) - .007 * (GA(nx, ny, .36, .04, .13, .09) + GA(nx, ny, -.36, .04, .13, .09))
        + .004 * GA(nx, ny, 0, .2, .5, .06) + .005 * (GA(nx, ny, .46, -.14, .14, .12) + GA(nx, ny, -.46, -.14, .14, .12)) + .005 * GA(nx, ny, 0, -.5, .2, .07) + .006 * GA(nx, ny, 0, -.8, .22, .1);
      z -= dz * w;
    }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals(); return g;
}
function bandUV(g, t0, tl) { const uv = g.attributes.uv, lo = 1 - (t0 + tl) / PI, sc = PI / tl; for (let i = 0; i < uv.count; i++) uv.setY(i, (uv.getY(i) - lo) * sc); return g; }
const LAP = (pts, s, a, b) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), s, a, b);
function limb(len, r0, r1, mid = 1, s = 12) {
  const pts = [[0, -len - r1 * .55], [r1 * .72, -len - r1 * .4], [r1, -len]];
  for (let i = 1; i < 6; i++) { const t = i / 6; pts.push([r1 + (r0 - r1) * t + Math.sin(t * PI) * (mid - 1) * r0, -len + len * t]); }
  pts.push([r0, 0], [r0 * .72, r0 * .4], [0, r0 * .55]);
  return LA(pts, s);
}
function torso(sc = 1, female = false, sy = 1) {
  const p = female ? [[0, -.02], [.15, 0], [.168, .05], [.155, .13], [.128, .2], [.14, .27], [.162, .33], [.166, .4], [.156, .45], [.11, .5], [.064, .53], [0, .545]]
    : [[0, -.02], [.14, 0], [.155, .05], [.15, .13], [.14, .2], [.152, .27], [.172, .34], [.178, .41], [.17, .46], [.12, .5], [.066, .53], [0, .545]];
  const g = LA(p.map(([r, y]) => [r * sc, y * sy]), 22); g.scale(1, 1, .64); return g;
}
// 관절 있는 손: 손가락 3마디 + 엄지 2마디 + 손톱 (손바닥 = +z, 손가락 = -y)
const nailM = () => C.nail || (C.nail = new THREE.MeshStandardMaterial({ color: '#efd0c4', roughness: .25 }));
export function handRig(side, skinM, seg = 8) {
  const root = new THREE.Group(), F = [], T = [];
  root.add(M(merge([{ g: SP(.039, 14, 10), p: [0, -.046, 0], s: [1.08, 1.12, .5] }, { g: SP(.021, 10, 8), p: [-side * .021, -.032, .008], s: [1, 1.3, .8] },
    ...[-1.5, -.5, .5, 1.5].map((i) => ({ g: SP(.0092, 8, 6), p: [i * .0142 * side, -.084, -.007] }))]), skinM, false));
  const segm = (par, l, r, tip) => {
    par.add(M(merge([{ g: CA(r, l * .82, seg), p: [0, -l / 2, 0] }]), skinM, false));
    if (tip) { const n = new THREE.Mesh(B(r * 1.5, l * .55, .002), nailM()); n.position.set(0, -l * .58, -r * .93); par.add(n); }
    const j = new THREE.Group(); j.position.y = -l; par.add(j); return j;
  };
  [[-.021, -.088, .026, .017, .014, .0085], [-.007, -.09, .029, .019, .015, .0088], [.007, -.088, .027, .018, .014, .0082], [.021, -.083, .021, .014, .012, .0072]].forEach(([x, y, l1, l2, l3, r]) => {
    const j0 = new THREE.Group(); j0.position.set(x * side, y, 0); root.add(j0);
    const j1 = segm(j0, l1, r), j2 = segm(j1, l2, r * .93); segm(j2, l3, r * .86, true); F.push([j0, j1, j2]);
  });
  const t0 = new THREE.Group(); t0.position.set(-side * .03, -.026, .012); t0.rotation.set(.35, 0, -side * .78); root.add(t0);
  const t1 = segm(t0, .024, .0098); segm(t1, .021, .009, true); T.push(t0, t1);
  return { root, F, T, side };
}
export function poseHand(h, c, t = c, spread = .06) {
  h.F.forEach((f, i) => { f[0].rotation.set(c * .95, 0, (i - 1.5) * spread * h.side); f[1].rotation.x = c * 1.15; f[2].rotation.x = c * .78; });
  h.T[0].rotation.x = .35 + t * .55; h.T[1].rotation.x = t * .9;
}
function bakeHand(side, skinM, c, t, y) {
  const h = handRig(side, skinM, 6); poseHand(h, c, t); h.root.updateMatrixWorld(true);
  const sk = [], nl = []; h.root.traverse((o) => { if (o.isMesh) (o.material === skinM ? sk : nl).push({ g: o.geometry, m: o.matrixWorld.clone() }); });
  const g = new THREE.Group(); g.position.y = y; g.add(M(merge(sk), skinM, false)); g.add(M(merge(nl), nailM(), false)); return g;
}
function shoes(col, x) {
  return [{ g: SP(.05, 18, 12), c: col, p: [x, -.43, -.055], s: [1.04, .78, 2.35], k: K.shoe }, { g: SP(.052, 18, 10), c: '#f6f6f4', p: [x, -.462, -.055], s: [1.08, .3, 2.45], k: K.rubber },
    { g: CY(.047, .05, .03, 16), c: '#f0f0f0', p: [x, -.4, 0], k: K.cloth }, { g: B(.03, .004, .008), c: '#fff', p: [x, -.396, -.09], k: K.cloth }, { g: B(.03, .004, .008), c: '#fff', p: [x, -.4, -.11], k: K.cloth }];
}
function headMeshes(group, o) {
  const face = M(deform(SP(.118, 40, 28), .95, false), skinMat(o.skin)); face.position.y = .13; group.add(face);
  const H = [], st = o.style, top = st === 'buzz' ? 1.25 : 1.16;
  H.push({ g: deform(SP(.1255, 36, 16, 0, 2 * PI, 0, top), .96, false), p: [0, .134, .004] });
  H.push({ g: SP(.1265, 32, 10, HP - 1.9, 3.8, top - .03, (st === 'buzz' ? 1.75 : 1.98) - top + .03), p: [0, .134, .008], s: [1, 1.1, 1.05] });
  if (st !== 'buzz') H.push({ g: LAP(o.female ? [[.131, .172], [.135, .19], [.134, .215], [.124, .242], [.1, .26]] : [[.131, .19], [.134, .205], [.131, .228], [.115, .252]], 32, PI - 1.05, 2.1) });
  if (st === 'long') H.push({ g: LAP([[.128, -.2], [.152, -.185], [.156, -.12], [.15, -.02], [.142, .07], [.134, .15], [.12, .21], [.09, .25], [.05, .265]], 32, -1.9, 3.8) });
  if (st === 'bob') H.push({ g: LAP([[.13, -.005], [.15, .015], [.149, .08], [.138, .14], [.12, .2], [.09, .245], [.05, .265]], 32, -2.2, 4.4) });
  if (st === 'pony') H.push({ g: SP(.032, 14, 10), p: [0, .17, .128] }, { g: LA([[0, -.22], [.016, -.19], [.03, -.09], [.034, 0], [0, .02]], 16), p: [0, .16, .145], r: [.35, 0, 0] });
  if (st === 'two') H.push({ g: SP(.07, 20, 12), p: [0, .222, -.005], s: [1.3, .6, 1.4] });
  group.add(M(merge(H), hairMat(o.hair)));
  return face;
}

// ───────── 학생 ─────────
export function studentBody(st) {
  const female = Math.random() < .5, skin = pick(SKIN), hair = pick(HAIR), top = pick(TOPS), pants = pick(PANTS), shoe = pick(SHOES);
  const style = female ? pick(['long', 'long', 'pony', 'bob']) : pick(['short', 'short', 'two', 'buzz']);
  const cloth = pick(['hoodie', 'padding', 'sweater', 'hoodie', 'padding', 'zip']), kind = cloth === 'padding' ? 'quilt' : cloth === 'sweater' ? 'knit' : 'cotton';
  const topM = clothMat(top, kind), pantM = clothMat(pants, Math.random() < .5 ? 'denim' : 'cotton'), skinM = skinMat(skin), puffy = cloth === 'padding';
  const fig = new THREE.Group(); fig.position.set(0, .52, .14); st.seat.add(fig); st.fig = fig;
  st.thigh = new THREE.Group(); st.thigh.rotation.x = HP; fig.add(st.thigh);
  st.thigh.add(M(merge([-1, 1].map((s) => ({ g: limb(.42, .086, .06, 1.05), p: [s * .1, 0, 0] }))), pantM));
  st.shin = new THREE.Group(); st.shin.position.y = -.42; st.shin.rotation.x = -HP; st.thigh.add(st.shin);
  st.shin.add(M(merge([-1, 1].map((s) => ({ g: limb(.39, .058, .043, 1.08), p: [s * .1, 0, 0] }))), pantM));
  st.shin.add(M(merge([...shoes(shoe, -.1), ...shoes(shoe, .1)]), R.mV, false));
  st.spine = new THREE.Group(); st.spine.position.set(0, 0, .03); fig.add(st.spine);
  const tp = [{ g: torso(puffy ? 1.1 : 1, female) }], tv = [];
  if (cloth === 'hoodie') { tp.push({ g: TO(.088, .042, 10, 18), p: [0, .49, .072], r: [1.25, 0, 0] }, { g: SP(.1, 16, 10), p: [0, .14, -.088], s: [1, .5, .25] }); }
  if (puffy) { tp.push({ g: CY(.085, .095, .08, 20), p: [0, .5, 0] }); tv.push({ g: B(.006, .4, .008), c: '#c8ccd0', p: [0, .27, -.118], k: K.chrome }, { g: B(.012, .03, .006), c: '#d8dce0', p: [0, .47, -.114], k: K.chrome }); }
  if (cloth === 'zip') tv.push({ g: B(.006, .44, .008), c: '#b8bcc0', p: [0, .26, -.11], k: K.chrome });
  if (cloth === 'sweater') tp.push({ g: TO(.06, .016, 8, 22), p: [0, .5, 0], r: [HP, 0, 0] });
  st.spine.add(M(merge(tp), topM)); if (tv.length) st.spine.add(M(merge(tv)));
  st.spine.add(M(merge([{ g: CY(.046, .052, .12, 18), p: [0, .5, 0] }]), skinMat(shade2(skin, .86))));
  st.head = new THREE.Group(); st.head.position.y = .56; st.spine.add(st.head);
  st.headMesh = headMeshes(st.head, { skin, hair, style, female });
  const ar = puffy ? 1.16 : 1;
  const arm = (s) => {
    const sh = new THREE.Group(); sh.position.set(s * .195, .45, 0); st.spine.add(sh);
    sh.add(M(merge([{ g: limb(.27, .058 * ar, .046 * ar, 1.04) }, { g: SP(.064 * ar, 16, 12), p: [0, -.01, 0] }]), topM));
    const el = new THREE.Group(); el.position.y = -.27; sh.add(el);
    el.add(M(merge([{ g: limb(.19, .046 * ar, .04 * ar, 1.02) }, { g: TO(.037, .007, 8, 18), p: [0, -.19, 0], r: [HP, 0, 0] }]), topM));
    el.add(bakeHand(s, skinM, s > 0 ? .95 : .45, s > 0 ? .8 : .4, -.2));
    if (s > 0) { const pg = new THREE.Group(); pg.position.set(0, -.27, .03); pg.add(M(merge([{ g: CY(.0016, .0072, .15, 8), c: '#f5c400', p: [0, 0, .03], r: [2.04, 0, 0], k: K.gloss }, { g: CY(.0016, .0068, .03, 8), c: '#2a2a2a', p: [0, -.035, .098], r: [2.04, 0, 0], k: K.metal }]), R.mV, false)); el.add(pg); st.pencil = pg; }
    return { sh, el };
  };
  st.armL = arm(-1); st.armR = arm(1);
}

// ───────── 감독관 (3인칭 · 학생 모드 NPC) ─────────
const TSKIN = '#e6bb96';
export function teacherBody(T) {
  const suitM = clothMat('#222a3c', 'suit'), pantM = clothMat('#262a33', 'suit'), shirtM = clothMat('#f3f3f1', 'cotton'), skinM = skinMat(TSKIN);
  const leg = (s) => {
    const p = new THREE.Group(); p.position.set(s * .1, .92, 0); T.root.add(p);
    p.add(M(merge([{ g: limb(.86, .09, .058, 1.04) }]), pantM));
    p.add(M(merge([{ g: SP(.052, 18, 12), c: '#141414', p: [0, -.86, -.05], s: [1, .72, 2.45], k: K.leather }, { g: SP(.054, 16, 10), c: '#0a0a0a', p: [0, -.895, -.05], s: [1.05, .28, 2.5], k: K.rubber }])));
    return p;
  };
  T.legL = leg(-1); T.legR = leg(1);
  T.body = new THREE.Group(); T.body.position.y = .92; T.root.add(T.body);
  T.body.add(M(merge([{ g: torso(1.16, false, 1.15) }, { g: EXs([[0, .02], [.05, -.04], [.04, -.3], [0, -.32]], .01), p: [-.05, .6, -.128], r: [0, .25, 0] }, { g: EXs([[0, .02], [-.05, -.04], [-.04, -.3], [0, -.32]], .01), p: [.05, .6, -.128], r: [0, -.25, 0] }]), suitM));
  T.body.add(M(merge([{ g: EXs([[-.06, .02], [.06, .02], [0, -.2]], .006), p: [0, .6, -.124] }, { g: TO(.056, .013, 8, 20), p: [0, .62, 0], r: [HP, 0, 0], s: [1, .8, 1] }]), shirtM));
  T.body.add(M(merge([
    { g: B(.032, .028, .02), c: '#a51c2c', p: [0, .6, -.14], k: [.4, 0] }, { g: EXs([[0, .012], [.022, -.22], [0, -.25], [-.022, -.22]], .007), c: '#b8202f', p: [0, .585, -.138], k: [.4, 0] },
    { g: SP(.011, 10, 8), c: '#111', p: [0, .28, -.14], k: K.gloss }, { g: SP(.011, 10, 8), c: '#111', p: [0, .19, -.138], k: K.gloss },
    { g: CY(.205, .205, .04, 26), c: '#33200f', p: [0, .1, 0], s: [1, 1, .66], k: K.leather }, { g: B(.042, .03, .01), c: '#d8c06a', p: [0, .1, -.137], k: K.chrome },
    { g: B(.06, .085, .004), c: '#fff', p: [.1, .35, -.136], k: K.gloss }, { g: B(.06, .02, .005), c: '#1a4fb0', p: [.1, .385, -.137], k: K.plastic },
    { g: B(.007, .2, .004), c: '#1a4fb0', p: [.07, .48, -.134], r: [0, 0, -.3], k: K.cloth }, { g: B(.007, .2, .004), c: '#1a4fb0', p: [.13, .48, -.132], r: [0, 0, .3], k: K.cloth },
    { g: B(.045, .014, .005), c: '#fafafa', p: [-.11, .45, -.132], k: K.cloth },
  ])));
  T.body.add(M(merge([{ g: CY(.056, .062, .12, 18), p: [0, .66, 0] }]), skinMat(shade2(TSKIN, .86))));
  T.head = new THREE.Group(); T.head.position.y = .7; T.body.add(T.head);
  headMeshes(T.head, { skin: TSKIN, hair: '#221e1b', style: 'two', female: false });
  const arm = (s) => {
    const sh = new THREE.Group(); sh.position.set(s * .255, .56, 0); T.body.add(sh);
    sh.add(M(merge([{ g: limb(.3, .068, .054, 1.03) }, { g: SP(.074, 16, 12), p: [0, -.01, 0] }]), suitM));
    const el = new THREE.Group(); el.position.y = -.3; sh.add(el);
    el.add(M(merge([{ g: limb(.24, .054, .045, 1.02) }]), suitM)); el.add(M(merge([{ g: CY(.046, .046, .03, 16), p: [0, -.235, 0] }]), shirtM));
    el.add(bakeHand(s, skinM, .35, .3, -.25));
    if (s < 0) el.add(M(merge([{ g: CY(.046, .046, .02, 18), c: '#c9ced6', p: [0, -.225, 0], k: K.chrome }, { g: CY(.017, .017, .008, 16), c: '#1a1a1a', p: [0, -.225, -.045], r: [HP, 0, 0], k: K.gloss }])));
    return { sh, el };
  };
  T.armL = arm(-1); T.armR = arm(1);
}
function EXs(pts, depth) {
  const sh = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: .002, bevelSize: .002, bevelSegments: 1 }); g.translate(0, 0, -depth / 2); return g;
}

// ───────── 1인칭 팔 (화면용) ─────────
export function viewArms() {
  const suitM = clothMat('#222a3c', 'suit'), shirtM = clothMat('#f3f3f1', 'cotton'), skinM = skinMat(TSKIN);
  const mk = (s) => {
    const a = new THREE.Group();
    a.add(M(merge([{ g: limb(.36, .06, .047, 1.03, 22) }]), suitM, false));
    a.add(M(merge([{ g: CY(.046, .047, .035, 20), p: [0, -.352, 0] }]), shirtM, false));
    const hand = new THREE.Group(); hand.position.y = -.37; a.add(hand);
    const rig = handRig(s, skinM, 10); poseHand(rig, 1.1, .9); hand.add(rig.root);
    if (s < 0) a.add(M(merge([{ g: CY(.049, .049, .022, 22), c: '#c9ced6', p: [0, -.335, 0], k: K.chrome }, { g: CY(.019, .019, .008, 18), c: '#151515', p: [0, -.335, .05], r: [HP, 0, 0], k: K.gloss }]), R.mV, false));
    return { a, hand, rig };
  };
  return { r: mk(1), l: mk(-1) };
}
