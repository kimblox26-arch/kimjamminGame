// 로블록스 베이컨 헤어 캐릭터 — R15 블록 몸(머리·위/아래 몸통·위/아래 팔·손·위/아래 다리·발)
// + 로블록스 기본 애니메이션처럼 부드럽게 섞이는 동작 (가만히·걷기·달리기·점프·낙하·비행·기 모으기·착지)
import * as THREE from 'three';

export const U = 0.36;              // 1 스터드 = 0.36 m → 키 약 5.2 스터드 ≈ 1.87 m
export const CENTER_Y = 2.75 * U;   // 몸을 기울이는 중심(가슴 높이, m)

const COL = {
  skin: 0xf3c7a0, jacket: 0x26272d, tee: 0xf2f3f5, print: 0x5b8de0, jeans: 0x3b5a8f, belt: 0x2b3f63,
  shoe: 0xf7f7f7, sole: 0x5a5f67, hair: 0x6b3b1d, hairHi: 0xa0623a,
};
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });

// 모서리가 둥근 상자 (로블록스 블록 몸 느낌)
function rbox(w, h, d, r = 0.07, s = 2) {
  const n = 2 * s + 1, g = new THREE.BoxGeometry(1, 1, 1, n, n, n);
  const P = g.attributes.position, N = g.attributes.normal, half = [w / 2, h / 2, d / 2];
  const p = [0, 0, 0], q = [0, 0, 0];
  for (let i = 0; i < P.count; i++) {
    p[0] = P.getX(i); p[1] = P.getY(i); p[2] = P.getZ(i);
    for (let a = 0; a < 3; a++) {
      const k = Math.round((p[a] + 0.5) * n), H = half[a];
      p[a] = k <= s ? -H + r * (k / s) : H - r * ((n - k) / s);
      q[a] = p[a] - THREE.MathUtils.clamp(p[a], -(H - r), H - r);
    }
    const l = Math.hypot(q[0], q[1], q[2]);
    if (l > 1e-6) {
      for (let a = 0; a < 3; a++) { q[a] /= l; p[a] = p[a] - q[a] * l + q[a] * r; }
      N.setXYZ(i, q[0], q[1], q[2]);
    }
    P.setXYZ(i, p[0], p[1], p[2]);
  }
  return g;
}

// 머리: 둥근 원기둥(로블록스 기본 머리) — 옆모습 윤곽을 같은 길이로 나눠 얼굴 그림이 찌그러지지 않게
function headGeometry(r = 0.62, h = 1.2, e = 0.3) {
  const raw = [], y0 = -h / 2, y1 = h / 2;
  for (let i = 0; i <= 8; i++) raw.push([(r - e) * i / 8, y0]);
  for (let i = 1; i <= 12; i++) { const a = -Math.PI / 2 + Math.PI / 2 * i / 12; raw.push([r - e + Math.cos(a) * e, y0 + e + Math.sin(a) * e]); }
  for (let i = 1; i <= 8; i++) raw.push([r, y0 + e + (h - 2 * e) * i / 8]);
  for (let i = 1; i <= 12; i++) { const a = Math.PI / 2 * i / 12; raw.push([r - e + Math.cos(a) * e, y1 - e + Math.sin(a) * e]); }
  for (let i = 1; i <= 8; i++) raw.push([(r - e) * (1 - i / 8), y1]);
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const L = cum[cum.length - 1], M = 56, pts = [];
  for (let k = 0, j = 1; k <= M; k++) {
    const s = L * k / M;
    while (j < raw.length - 1 && cum[j] < s) j++;
    const t = (s - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
    pts.push(new THREE.Vector2(Math.max(raw[j - 1][0] + (raw[j][0] - raw[j - 1][0]) * t, 1e-4), raw[j - 1][1] + (raw[j][1] - raw[j - 1][1]) * t));
  }
  const g = new THREE.LatheGeometry(pts, 64, Math.PI, Math.PI * 2); // 앞(+z)이 u=0.5
  return { g, L, mid: (r - e) + Math.PI * e / 2 + (h - 2 * e) / 2, circ: Math.PI * 2 * r };
}

// 로블록스 기본 웃는 얼굴 (세로로 긴 두 눈 + 얇은 미소)
function faceTexture({ L, mid, circ }) {
  const W = 1024, H = 512, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#' + new THREE.Color(COL.skin).getHexString();
  g.fillRect(0, 0, W, H);
  const sx = W / circ, sy = H / L;
  const X = dx => W / 2 + dx * sx, Y = dy => (1 - (mid + dy) / L) * H;
  g.fillStyle = '#151515';
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(X(s * 0.2), Y(0.12), 0.058 * sx, 0.125 * sy, 0, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#151515'; g.lineCap = 'round'; g.lineWidth = 0.05 * sx;
  g.beginPath();
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI * (0.22 + 0.56 * i / 24);
    const x = X(Math.cos(a) * 0.36), y = Y(0.1 - Math.sin(a) * 0.36);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 끝이 가늘어지는 관 (머리카락 가닥)
function strand(points, radius) {
  const curve = new THREE.CatmullRomCurve3(points);
  const TS = 40, RS = 8, g = new THREE.TubeGeometry(curve, TS, radius, RS, false);
  const P = g.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= TS; i++) {
    const t = i / TS, k = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.04)), 0.45);
    curve.getPointAt(t, c);
    for (let j = 0; j <= RS; j++) {
      const idx = i * (RS + 1) + j;
      v.fromBufferAttribute(P, idx).sub(c).multiplyScalar(k).add(c);
      P.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

// 베이컨 헤어(Pal Hair): 머리 위·뒤를 덮는 바탕 + 앞에서 뒤로 넘어가는 굵은 물결 가닥 + 옆으로 넘긴 앞머리
function makeHair(mats) {
  const g = new THREE.Group();
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.57), mats[0]);
  cap.scale.set(0.69, 0.6, 0.71);
  cap.position.set(0, 0.11, -0.03);
  cap.rotation.x = -0.34;
  cap.updateMatrix();
  g.add(cap);
  const side = new THREE.Vector3(), p = new THREE.Vector3(), rot = new THREE.Matrix4();
  for (let i = -3; i <= 3; i++) {
    const b = i * 0.3, pts = [];
    rot.makeRotationZ(b);
    side.set(1, 0, 0).applyMatrix4(rot);
    for (let k = 0; k <= 16; k++) {
      const f = 0.28 + (Math.PI + 0.25 - 0.28) * k / 16;
      p.set(0, Math.sin(f), Math.cos(f)).applyMatrix4(rot).multiplyScalar(1.05)
        .addScaledVector(side, 0.075 * Math.sin(f * 6 + i * 1.7));
      pts.push(p.clone().applyMatrix4(cap.matrix));
    }
    g.add(new THREE.Mesh(strand(pts, 0.105 - Math.abs(i) * 0.006), mats[(i + 3) % 2 ? 1 : 0]));
  }
  // 앞머리: 이마 위에서 오른쪽(-x)으로 쓸어 넘긴 물결
  const bangs = [
    [[0.32, 0.56, 0.4], [0.12, 0.44, 0.6], [-0.12, 0.36, 0.64], [-0.36, 0.3, 0.56], [-0.56, 0.18, 0.36]],
    [[0.42, 0.5, 0.34], [0.26, 0.36, 0.6], [0.04, 0.27, 0.66], [-0.2, 0.22, 0.63], [-0.44, 0.12, 0.5]],
    [[0.1, 0.62, 0.3], [-0.08, 0.52, 0.52], [-0.3, 0.42, 0.55], [-0.52, 0.3, 0.42], [-0.64, 0.12, 0.2]],
  ];
  bangs.forEach((b, i) => g.add(new THREE.Mesh(strand(b.map(v => new THREE.Vector3(...v)), 0.1), mats[i % 2])));
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

const JOINTS = ['pelvis', 'waist', 'neck', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR'];
const ANIMS = ['idle', 'walk', 'run', 'jump', 'fall', 'hover', 'fly', 'charge'];
const newPose = () => { const p = { y: 0 }; for (const j of JOINTS) p[j] = [0, 0, 0]; return p; };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Bacon {
  constructor() {
    this.root = new THREE.Group();    // 발 위치 + 바라보는 방향
    this.tilt = new THREE.Group();    // 가슴 높이에서 몸 기울이기 (비행)
    this.tilt.position.y = CENTER_Y;
    this.tilt.rotation.order = 'YXZ';
    this.root.add(this.tilt);
    this.body = new THREE.Group();    // 스터드 단위 모델
    this.body.scale.setScalar(U);
    this.body.position.y = -CENTER_Y;
    this.tilt.add(this.body);

    const M = {
      skin: mat(COL.skin, { roughness: 0.55 }), jacket: mat(COL.jacket, { roughness: 0.7 }), tee: mat(COL.tee),
      print: mat(COL.print), jeans: mat(COL.jeans, { roughness: 0.75 }), belt: mat(COL.belt), shoe: mat(COL.shoe, { roughness: 0.5 }),
      sole: mat(COL.sole), hair: mat(COL.hair, { roughness: 0.72 }), hairHi: mat(COL.hairHi, { roughness: 0.68 }),
    };
    this.mats = M;
    const J = this.j = {};
    const joint = (name, parent, x, y, z) => { const o = new THREE.Group(); o.position.set(x, y, z); parent.add(o); J[name] = o; return o; };
    const part = (parent, geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };

    // 몸통
    const pelvis = joint('pelvis', this.body, 0, 2.0, 0);
    part(pelvis, rbox(2, 0.42, 1, 0.07), M.jeans, 0, 0.2, 0);
    part(pelvis, rbox(2.02, 0.1, 1.02, 0.04), M.belt, 0, 0.36, 0);
    const waist = joint('waist', pelvis, 0, 0.4, 0);
    part(waist, rbox(2, 1.6, 1, 0.08), M.jacket, 0, 0.8, 0);
    part(waist, rbox(0.86, 1.48, 0.06, 0.025), M.tee, 0, 0.76, 0.5);          // 열린 재킷 사이 티셔츠
    part(waist, rbox(0.46, 0.4, 0.04, 0.12), M.print, 0, 0.92, 0.53);         // 티셔츠 그림
    for (const s of [-1, 1]) part(waist, rbox(0.14, 1.52, 0.1, 0.04), M.jacket, s * 0.5, 0.78, 0.5); // 재킷 앞섶
    // 머리
    const neck = joint('neck', waist, 0, 1.6, 0);
    const hg = headGeometry();
    const head = part(neck, hg.g, new THREE.MeshStandardMaterial({ map: faceTexture(hg), roughness: 0.55 }), 0, 0.62, 0);
    head.add(makeHair([M.hair, M.hairHi]));
    // 팔·다리 (L = +x, R = -x, 앞 = +z)
    for (const [S, sx] of [['L', 1], ['R', -1]]) {
      const sh = joint('sh' + S, waist, sx * 1.5, 1.25, 0);
      part(sh, rbox(1, 0.95, 1, 0.08), M.jacket, 0, -0.125, 0);
      const el = joint('el' + S, sh, 0, -0.6, 0);
      part(el, rbox(0.98, 0.86, 0.98, 0.08), M.jacket, 0, -0.33, 0);
      const wr = joint('wr' + S, el, 0, -0.75, 0);
      part(wr, rbox(0.94, 0.32, 0.94, 0.08), M.skin, 0, -0.15, 0);
      const hip = joint('hip' + S, pelvis, sx * 0.5, 0, 0);
      part(hip, rbox(1, 1.0, 1, 0.07), M.jeans, 0, -0.45, 0);
      const kn = joint('kn' + S, hip, 0, -0.95, 0);
      part(kn, rbox(0.98, 0.9, 0.98, 0.07), M.jeans, 0, -0.36, 0);
      const an = joint('an' + S, kn, 0, -0.8, 0);
      part(an, rbox(1, 0.22, 1.1, 0.07), M.shoe, 0, -0.1, 0.05);
      part(an, rbox(1.02, 0.07, 1.14, 0.03), M.sole, 0, -0.215, 0.05);
    }
    this.base = {};
    for (const j of JOINTS) this.base[j] = J[j].position.clone();

    this.poses = {}; for (const a of ANIMS) this.poses[a] = newPose();
    this.out = newPose();
    this.cur = newPose();
    this.w = { idle: 1 }; for (const a of ANIMS) this.w[a] ??= 0;
    this.phase = 0; this.t = 0; this.land = 0; this.scream = 0;
    this.hairBase = [new THREE.Color(COL.hair), new THREE.Color(COL.hairHi)];
  }

  // 각성 색으로 머리카락 물들이기 (3단계 노랑 = 초사이어인처럼 금발)
  tintHair(color, k) {
    const [a, b] = this.hairBase;
    this.mats.hair.color.copy(a).lerp(color, k * 0.85);
    this.mats.hairHi.color.copy(b).lerp(color, k * 0.9);
    this.mats.hair.emissive.copy(color).multiplyScalar(k * 0.35);
    this.mats.hairHi.emissive.copy(color).multiplyScalar(k * 0.45);
  }

  landed(strength) { this.land = Math.max(this.land, Math.min(1, strength)); }
  burst() { this.scream = 1; }

  // s: { speed (수평 m/s), vy, grounded, flying, fast(0~1), charging, strain(0~1), level }
  update(dt, s) {
    this.t += dt;
    const t = this.t, P = this.poses;
    // ── 어떤 동작을 얼마나 섞을지
    const tw = {}; for (const a of ANIMS) tw[a] = 0;
    if (s.charging) tw.charge = 1;
    else if (s.flying) { tw.fly = s.fast; tw.hover = 1 - s.fast; }
    else if (!s.grounded) { if (s.vy > 2) tw.jump = 1; else tw.fall = 1; }
    else {
      const mv = sstep(0.25, 2.2, s.speed), run = sstep(6.5, 9, s.speed);
      tw.idle = 1 - mv; tw.walk = mv * (1 - run); tw.run = mv * run;
    }
    const kb = 1 - Math.exp(-dt * 11);
    let sum = 0;
    for (const a of ANIMS) { this.w[a] += (tw[a] - this.w[a]) * kb; sum += this.w[a]; }

    // ── 걸음 위상: 실제 이동 거리에 맞춰 (미끄러지는 발 없이)
    const studs = s.grounded && !s.flying ? s.speed / U : 0;
    const cyc = 10 + 4 * sstep(6.5, 9, s.speed);
    this.phase += dt * Math.PI * 2 * studs / cyc;
    const ph = this.phase, sn = Math.sin(ph), cs = Math.cos(ph);
    const shake = (k) => (Math.sin(t * 61) * 0.6 + Math.sin(t * 89 + 1) * 0.4) * k;

    let p = P.idle; // 가만히: 숨쉬기 + 살짝 둘러보기
    const br = Math.sin(t * 1.9);
    set(p, 'waist', 0.015 * br, 0, 0); set(p, 'neck', -0.01 * br + 0.03 * Math.sin(t * 0.37), 0.18 * Math.sin(t * 0.43) * Math.sin(t * 0.17), 0);
    set(p, 'shL', 0.03 * br, 0, 0.07 + 0.015 * br); set(p, 'shR', 0.03 * br, 0, -0.07 - 0.015 * br);
    set(p, 'elL', -0.08, 0, 0); set(p, 'elR', -0.08, 0, 0);
    set(p, 'hipL', 0, 0, 0.03); set(p, 'hipR', 0, 0, -0.03); set(p, 'knL', 0.03, 0, 0); set(p, 'knR', 0.03, 0, 0);
    p.y = 0.012 * br;

    p = P.walk; // 걷기
    const kL = Math.max(0, cs), kR = Math.max(0, -cs);
    set(p, 'hipL', -0.58 * sn, 0, 0.02); set(p, 'hipR', 0.58 * sn, 0, -0.02);
    set(p, 'knL', 0.12 + 0.95 * kL ** 1.4, 0, 0); set(p, 'knR', 0.12 + 0.95 * kR ** 1.4, 0, 0);
    set(p, 'anL', -0.25 * kL + 0.15 * Math.max(0, sn), 0, 0); set(p, 'anR', -0.25 * kR + 0.15 * Math.max(0, -sn), 0, 0);
    set(p, 'shL', 0.55 * sn, 0, 0.06); set(p, 'shR', -0.55 * sn, 0, -0.06);
    set(p, 'elL', -0.25 - 0.3 * Math.max(0, -sn), 0, 0); set(p, 'elR', -0.25 - 0.3 * Math.max(0, sn), 0, 0);
    set(p, 'pelvis', 0, -0.07 * sn, 0); set(p, 'waist', 0.04, 0.13 * sn, 0); set(p, 'neck', -0.03, -0.06 * sn, 0);
    p.y = 0.13 * (Math.abs(cs) - 0.65);

    p = P.run; // 달리기: 크게 흔들고 앞으로 숙이기
    set(p, 'hipL', -0.95 * sn - 0.15, 0, 0.02); set(p, 'hipR', 0.95 * sn - 0.15, 0, -0.02);
    set(p, 'knL', 0.25 + 1.5 * kL ** 1.2, 0, 0); set(p, 'knR', 0.25 + 1.5 * kR ** 1.2, 0, 0);
    set(p, 'anL', -0.35 * kL, 0, 0); set(p, 'anR', -0.35 * kR, 0, 0);
    set(p, 'shL', 1.0 * sn, 0, 0.1); set(p, 'shR', -1.0 * sn, 0, -0.1);
    set(p, 'elL', -1.15 - 0.25 * Math.max(0, -sn), 0, 0); set(p, 'elR', -1.15 - 0.25 * Math.max(0, sn), 0, 0);
    set(p, 'pelvis', 0.1, -0.1 * sn, 0); set(p, 'waist', 0.16, 0.2 * sn, 0); set(p, 'neck', -0.18, -0.1 * sn, 0);
    p.y = 0.22 * (Math.abs(cs) - 0.7);

    p = P.jump; // 점프: 팔 위로, 다리 모으기
    set(p, 'shL', -2.65, 0, 0.25); set(p, 'shR', -2.65, 0, -0.25); set(p, 'elL', -0.15, 0, 0); set(p, 'elR', -0.15, 0, 0);
    set(p, 'hipL', -0.35, 0, 0.04); set(p, 'hipR', 0.12, 0, -0.04); set(p, 'knL', 0.55, 0, 0); set(p, 'knR', 0.3, 0, 0);
    set(p, 'waist', -0.06, 0, 0); set(p, 'neck', -0.12, 0, 0); p.y = 0;

    p = P.fall; // 낙하: 팔 벌려 허우적
    const fw = Math.sin(t * 7);
    set(p, 'shL', -0.35 + 0.1 * fw, 0, 2.1 + 0.12 * fw); set(p, 'shR', -0.35 - 0.1 * fw, 0, -2.1 - 0.12 * fw);
    set(p, 'elL', -0.25, 0, 0); set(p, 'elR', -0.25, 0, 0);
    set(p, 'hipL', -0.25, 0, 0.12); set(p, 'hipR', 0.15, 0, -0.12); set(p, 'knL', 0.45, 0, 0); set(p, 'knR', 0.6, 0, 0);
    set(p, 'neck', 0.12, 0, 0); p.y = 0;

    p = P.hover; // 공중에 떠 있기: 다리 늘어뜨리고 둥실둥실
    const hv = Math.sin(t * 2.1);
    set(p, 'shL', 0.12 + 0.05 * hv, 0, 0.22); set(p, 'shR', 0.12 - 0.05 * hv, 0, -0.22);
    set(p, 'elL', -0.45, 0, 0); set(p, 'elR', -0.45, 0, 0);
    set(p, 'hipL', -0.1 + 0.05 * hv, 0, 0.06); set(p, 'hipR', 0.12 - 0.05 * hv, 0, -0.06);
    set(p, 'knL', 0.35, 0, 0); set(p, 'knR', 0.75, 0, 0); set(p, 'anL', 0.35, 0, 0); set(p, 'anR', 0.45, 0, 0);
    set(p, 'neck', 0.04, 0, 0); set(p, 'waist', 0.03 * hv, 0, 0); p.y = 0.25 * hv;

    p = P.fly; // 빠른 비행: 오른 주먹을 앞으로 (몸은 진행 방향으로 눕힘)
    const fl = Math.sin(t * 13) * 0.04;
    set(p, 'shR', -3.0 + fl, 0, 0.12); set(p, 'elR', -0.05, 0, 0);
    set(p, 'shL', 0.25 - fl, 0, 0.18); set(p, 'elL', -0.35, 0, 0);
    set(p, 'hipL', 0.06 + fl, 0, 0.04); set(p, 'hipR', 0.12 - fl, 0, -0.04); set(p, 'knL', 0.18, 0, 0); set(p, 'knR', 0.55, 0, 0);
    set(p, 'anL', 0.6, 0, 0); set(p, 'anR', 0.7, 0, 0); set(p, 'neck', -0.75, 0, 0); set(p, 'waist', -0.08, 0, 0); p.y = 0;

    p = P.charge; // 기 모으기 (사진처럼 다리 넓게 벌리고 주먹 쥐고 버티기)
    const st = Math.max(s.strain, this.scream), tr = 0.02 + 0.05 * st + 0.012 * s.level;
    set(p, 'hipL', -0.55 + shake(tr), 0, 0.42); set(p, 'hipR', -0.55 - shake(tr), 0, -0.42);
    set(p, 'knL', 1.0, 0, -0.1); set(p, 'knR', 1.0, 0, 0.1); set(p, 'anL', -0.45, 0, -0.3); set(p, 'anR', -0.45, 0, 0.3);
    set(p, 'shL', 0.15 + shake(tr), 0, 0.55 + 0.4 * st); set(p, 'shR', 0.15 - shake(tr), 0, -0.55 - 0.4 * st);
    set(p, 'elL', -1.35 + 0.3 * st, 0, 0); set(p, 'elR', -1.35 + 0.3 * st, 0, 0);
    set(p, 'wrL', -0.25, 0, 0); set(p, 'wrR', -0.25, 0, 0);
    set(p, 'waist', 0.14 - 0.36 * st + shake(tr * 0.6), shake(tr * 0.5), 0); set(p, 'neck', 0.1 - 0.5 * st + shake(tr), 0, 0);
    set(p, 'pelvis', 0.08, 0, 0);
    p.y = -0.46 + shake(tr * 0.4);

    // ── 섞기
    const o = this.out;
    for (const j of JOINTS) { o[j][0] = o[j][1] = o[j][2] = 0; }
    o.y = 0;
    for (const a of ANIMS) {
      const w = this.w[a] / (sum || 1);
      if (w < 1e-4) continue;
      const q = P[a];
      for (const j of JOINTS) { o[j][0] += q[j][0] * w; o[j][1] += q[j][1] * w; o[j][2] += q[j][2] * w; }
      o.y += q.y * w;
    }
    // 착지 충격: 무릎 굽혀 쿵
    if (this.land > 0.001) {
      const L = this.land;
      o.hipL[0] -= 0.7 * L; o.hipR[0] -= 0.7 * L; o.knL[0] += 1.2 * L; o.knR[0] += 1.2 * L; o.anL[0] -= 0.5 * L; o.anR[0] -= 0.5 * L;
      o.waist[0] += 0.3 * L; o.shL[2] += 0.5 * L; o.shR[2] -= 0.5 * L; o.y -= 0.55 * L;
      this.land *= Math.exp(-dt * 6);
    }
    this.scream *= Math.exp(-dt * 2.2);

    // ── 적용 (한 번 더 부드럽게)
    const ks = 1 - Math.exp(-dt * 24), c = this.cur, J = this.j;
    for (const j of JOINTS) {
      for (let k = 0; k < 3; k++) c[j][k] += (o[j][k] - c[j][k]) * ks;
      J[j].rotation.set(c[j][0], c[j][1], c[j][2]);
    }
    c.y += (o.y - c.y) * ks;
    J.pelvis.position.y = this.base.pelvis.y + c.y;
  }
}

function set(p, j, x, y, z) { const a = p[j]; a[0] = x; a[1] = y; a[2] = z; }
