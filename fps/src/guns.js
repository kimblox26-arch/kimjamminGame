// 총기 모델링 — 실제 치수(미터) 기반 절차적 모델. 애니메이션 부품(탄창/노리쇠/슬라이드/펌프)과 손 앵커 포함
// 좌표계: 총구 방향 -Z, 위 +Y, 오른쪽 +X. 프로파일은 (f=전방거리, y) 로 정의.
import * as THREE from 'three';
import { MeshBatch } from './core.js';
import { T } from './textures.js';

let MAT = null;
const rep = (t, n) => { if (!t) return null; const c = t.clone(); c.repeat.set(n, n); c.needsUpdate = true; return c; };
export function gunMats() {
  if (MAT) return MAT;
  const an = T.anodized, st = T.stipple, wd = T.gunwood, lt = T.leather;
  const metal = (color, rough = 1, metal = 0.85, n = 10) => new THREE.MeshPhysicalMaterial({ color, map: rep(an.map, n), roughnessMap: rep(an.roughnessMap, n), normalMap: rep(an.normalMap, n), normalScale: new THREE.Vector2(0.35, 0.35), roughness: rough, metalness: metal, envMapIntensity: 1.2, clearcoat: 0.22, clearcoatRoughness: 0.38 });
  const poly = (color, rough = 1) => new THREE.MeshStandardMaterial({ color, roughnessMap: rep(st.roughnessMap, 14), normalMap: rep(st.normalMap, 14), normalScale: new THREE.Vector2(0.6, 0.6), roughness: rough, metalness: 0.0, envMapIntensity: 0.9 });
  const wood = (color) => new THREE.MeshPhysicalMaterial({ color, map: rep(wd.map, 3), roughnessMap: rep(wd.roughnessMap, 3), normalMap: rep(wd.normalMap, 3), normalScale: new THREE.Vector2(0.3, 0.3), roughness: 1.6, clearcoat: 0.18, clearcoatRoughness: 0.5, envMapIntensity: 0.5 });
  MAT = {
    anod: metal(0x252629, 1, 0.5),
    steel: metal(0x2a2b2d, 1.1, 0.7),
    blued: metal(0x202224, 1.1, 0.6),
    bright: metal(0x9a9da0, 0.55, 1),
    nitride: metal(0x2c2e30, 1.15, 0.55),
    poly: poly(0x19191a),
    polyGreen: poly(0x4a5436),
    polyTan: poly(0x8a7657),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.95, normalMap: rep(lt.normalMap, 10) }),
    wood: wood(0xe0c0a8),
    walnut: wood(0x8a6448),
    bakelite: new THREE.MeshPhysicalMaterial({ color: 0x4a1d0c, roughness: 0.45, clearcoat: 0.4, normalMap: rep(st.normalMap, 6), normalScale: new THREE.Vector2(0.15, 0.15) }),
    brass: new THREE.MeshStandardMaterial({ color: 0xd4a84f, roughness: 0.28, metalness: 1 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xb8683d, roughness: 0.3, metalness: 1 }),
    redHull: new THREE.MeshStandardMaterial({ color: 0x8e1712, roughness: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.8 }),
    white: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.5 }),
    tritium: new THREE.MeshStandardMaterial({ color: 0x113311, emissive: new THREE.Color(0.25, 1, 0.3), emissiveIntensity: 2.5 }),
    lensGlass: new THREE.MeshStandardMaterial({ color: 0x0a1420, roughness: 0.02, metalness: 1, envMapIntensity: 2.5 }),
    flGlass: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 0.4, roughness: 0.1, metalness: 0.5 }),
    tint: new THREE.MeshStandardMaterial({ color: 0x6a8aa8, roughness: 0.02, metalness: 1, transparent: true, opacity: 0.08, envMapIntensity: 2, depthWrite: false }),
  };
  return MAT;
}

// ── 지오메트리 헬퍼 (UV 는 미터 단위) ──
function boxG(w, h, l) {
  const g = new THREE.BoxGeometry(w, h, l), uv = g.attributes.uv;
  const dims = [[l, h], [l, h], [w, l], [w, l], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
  return g;
}
function shapeFrom(pts) {
  const s = new THREE.Shape();
  pts.forEach((p, i) => {
    if (p[0] === 'q') s.quadraticCurveTo(p[1], p[2], p[3], p[4]);
    else if (i === 0) s.moveTo(p[0], p[1]); else s.lineTo(p[0], p[1]);
  });
  return s;
}

// 박스 투영 UV (총기 길이 방향 = u) — 나뭇결/질감 방향 통일
const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _be = new THREE.Euler(), _bp = new THREE.Vector3(), _bs = new THREE.Vector3(1, 1, 1);
function boxUV(g) {
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (az > ax && az > ay) { uv[i * 2] = x; uv[i * 2 + 1] = y; }
    else if (ay > ax) { uv[i * 2] = z; uv[i * 2 + 1] = x; }
    else { uv[i * 2] = z; uv[i * 2 + 1] = y; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

class GB {
  constructor() { this.batch = new MeshBatch(); this.group = new THREE.Group(); this.subs = []; }
  add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    _bm.compose(_bp.set(x, y, z), _bq.setFromEuler(_be.set(rx, ry, rz)), _bs);
    geo.applyMatrix4(_bm); boxUV(geo);
    this.batch.add(geo, mat);
    return this;
  }
  box(mat, w, h, f0, f1, y0, y1, x = 0, rx = 0) { return this.add(boxG(w, y1 - y0, f1 - f0), mat, x, (y0 + y1) / 2, -(f0 + f1) / 2, rx); }
  // 총열 축(z) 방향 실린더
  cyl(mat, r0, r1, f0, f1, y = 0, x = 0, seg = 18, rotZ = 0) {
    const L = f1 - f0, g = new THREE.CylinderGeometry(r1, r0, L, seg, 1);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * Math.max(r0, r1), uv.getY(i) * L);
    g.rotateX(-Math.PI / 2); if (rotZ) g.rotateZ(rotZ);
    return this.add(g, mat, x, y, -(f0 + f1) / 2);
  }
  cylX(mat, r, len, f, y, x = 0, seg = 12) { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); return this.add(g, mat, x, y, -f); }
  cylY(mat, r, h, f, y0, x = 0, seg = 14, r2 = r) { const g = new THREE.CylinderGeometry(r2, r, h, seg); return this.add(g, mat, x, y0 + h / 2, -f); }
  sphere(mat, r, f, y, x = 0) { return this.add(new THREE.SphereGeometry(r, 12, 8), mat, x, y, -f); }
  ring(mat, R, r, f, y = 0, x = 0) { return this.add(new THREE.TorusGeometry(R, r, 8, 24), mat, x, y, -f); }
  // 측면 프로파일 압출 (두께 w, x 중심)
  prof(mat, pts, w, x = 0, bevel = 0.0015, holes = null) {
    const s = shapeFrom(pts);
    if (holes) for (const h of holes) s.holes.push(shapeFrom(h));
    const b = Math.min(bevel, w * 0.3), d = Math.max(0.0005, w - 2 * b);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 10 });
    g.translate(0, 0, -d / 2); g.rotateY(Math.PI / 2);
    return this.add(g, mat, x, 0, 0);
  }
  // 정면 프로파일(x, y)을 총열 축으로 압출 (f0 → f1)
  profZ(mat, pts, holes, f0, f1, bevel = 0.001) {
    const sh = shapeFrom(pts);
    if (holes) for (const h of holes) sh.holes.push(shapeFrom(h));
    const L = f1 - f0, b = Math.min(bevel, L * 0.3);
    const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.0005, L - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 8 });
    g.translate(0, 0, -f1 + b);
    return this.add(g, mat);
  }
  // 피카티니 레일
  rail(mat, f0, f1, y, w = 0.021) {
    this.box(mat, w * 0.72, 0.004, f0, f1, y, y + 0.004);
    for (let f = f0 + 0.003; f < f1 - 0.006; f += 0.01) this.box(mat, w, 0.0045, f, f + 0.0053, y + 0.0035, y + 0.008);
    return this;
  }
  sub(name, f, y, x = 0) { const s = new GB(); s.name = name; s.group.position.set(x, y, -f); this.subs.push(s); return s; }
  build() { this.batch.build(this.group); for (const s of this.subs) { s.build(); this.group.add(s.group); } return this.group; }
}

// 손 앵커: X'(손바닥 반대), Y'(쥠 축) 벡터로 방향 지정
const WRIST_SUPPORT = new THREE.Vector3(0.062, -0.055, 0.03);
function anchor(parent, name, f, y, x, X, Y, wrist) {
  const o = new THREE.Object3D(); o.name = name;
  if (wrist || /fore|port|mag/.test(name)) o.userData.wrist = wrist || WRIST_SUPPORT;
  o.position.set(x, y, -f);
  const vx = new THREE.Vector3(...X).normalize(), vy = new THREE.Vector3(...Y);
  vy.addScaledVector(vx, -vy.dot(vx)).normalize();
  const vz = new THREE.Vector3().crossVectors(vx, vy);
  o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(vx, vy, vz));
  parent.add(o);
  return o;
}
const point = (parent, f, y, x = 0) => { const o = new THREE.Object3D(); o.position.set(x, y, -f); parent.add(o); return o; };

// ── 홀로그래픽 조준경 레티클 셰이더 (무한 원점 투영: 시차 없음) ──
export function holoMaterial(color = new THREE.Color(3.2, 0.12, 0.08)) {
  return new THREE.ShaderMaterial({
    uniforms: { uAxis: { value: new THREE.Vector3(0, 0, -1) }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uColor: { value: color }, uOn: { value: 1 } },
    vertexShader: `varying vec3 vView; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vView = mv.xyz; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uAxis; uniform vec3 uUp; uniform vec3 uColor; uniform float uOn; varying vec3 vView;
      void main(){
        vec3 d = normalize(vView), a = normalize(uAxis), r = normalize(cross(a, uUp)), u = cross(r, a);
        vec2 q = vec2(dot(d,r), dot(d,u)) / max(dot(d,a), 1e-3);
        float rad = length(q);
        float dotm = 1. - smoothstep(0.0011, 0.0019, rad);
        float ring = 1. - smoothstep(0.00035, 0.0008, abs(rad - 0.0125));
        float ticks = (1. - smoothstep(0.00035, 0.0008, abs(q.x))) * step(0.0125, abs(q.y)) * step(abs(q.y), 0.0165) * step(q.y, 0.)
                    + (1. - smoothstep(0.00035, 0.0008, abs(q.y))) * step(0.0125, abs(q.x)) * step(abs(q.x), 0.0165);
        float m = clamp(max(max(dotm, ring), ticks), 0., 1.) * uOn;
        gl_FragColor = vec4(uColor * m + vec3(0.03,0.05,0.05), max(m, 0.04));
      }`,
    transparent: true, depthWrite: false,
  });
}

// ── 저격 조준경 렌즈 (PIP 렌더 타깃 + 레티클) ──
export function scopeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { tScene: { value: null }, uEye: { value: new THREE.Vector2() }, uAds: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform sampler2D tScene; uniform vec2 uEye; uniform float uAds; varying vec2 vUv;
      void main(){
        vec2 p = vUv*2. - 1.;
        float r = length(p);
        vec2 uv = vUv;
        // 가장자리 색수차
        vec3 col;
        col.r = texture2D(tScene, 0.5 + (uv-0.5)*(1.0 + 0.012*r*r)).r;
        col.g = texture2D(tScene, uv).g;
        col.b = texture2D(tScene, 0.5 + (uv-0.5)*(1.0 - 0.012*r*r)).b;
        // 듀플렉스 레티클 + 밀도트
        float px = 0.0035, thick = 0.018;
        float lv = 1. - smoothstep(px*0.6, px, abs(p.x)); if (abs(p.y) > 0.42) lv = 1. - smoothstep(thick*0.8, thick, abs(p.x));
        float lh = 1. - smoothstep(px*0.6, px, abs(p.y)); if (abs(p.x) > 0.42) lh = 1. - smoothstep(thick*0.8, thick, abs(p.y));
        float mil = 0.;
        for (int i = 1; i <= 4; i++) { float o = float(i)*0.085; mil += (1. - smoothstep(0.006, 0.009, length(p - vec2(0., -o)))) + (1. - smoothstep(0.006, 0.009, length(p - vec2(o, 0.)))) + (1. - smoothstep(0.006, 0.009, length(p - vec2(-o, 0.)))) + (1. - smoothstep(0.006, 0.009, length(p - vec2(0., o)))); }
        float ret = clamp(lv + lh + mil, 0., 1.);
        col = mix(col, vec3(0.0), ret * 0.95);
        col = mix(col, vec3(6., 0.15, 0.05), 1. - smoothstep(0.004, 0.007, r));
        // 아이박스 그림자 (정렬 어긋나면 초승달 그림자)
        float eb = smoothstep(1.0, 0.72, length(p + uEye * 5.0));
        col *= eb * smoothstep(1.0, 0.94, r);
        col *= smoothstep(0.35, 0.9, uAds);
        // 렌즈 반사
        col += vec3(0.02,0.03,0.05) * (1. - smoothstep(0.35, 0.9, uAds)) * (0.6 + 0.4*p.y);
        gl_FragColor = vec4(col, 1.);
      }`,
  });
}

// ════════════════════ M4A1 카빈 ════════════════════
function buildM4() {
  const m = gunMats(), G = new GB();
  // 하부 리시버
  G.prof(m.anod, [[-0.085, -0.004], [0.158, -0.004], [0.158, -0.03], [0.072, -0.03], [0.068, -0.052], [-0.045, -0.056], [-0.07, -0.05], [-0.085, -0.035]], 0.024);
  G.prof(m.anod, [[0.068, -0.028], [0.162, -0.028], [0.164, -0.108], [0.158, -0.118], [0.074, -0.118], [0.068, -0.11]], 0.031, 0, 0.002);
  for (let y = -0.1; y < -0.04; y += 0.012) G.box(m.anod, 0.032, 0.003, 0.157, 0.163, y, y + 0.003);
  G.prof(m.anod, [[-0.012, -0.052], [0.07, -0.052], [0.07, -0.084], [-0.012, -0.084]], 0.01, 0, 0.001, [[[-0.004, -0.057], [0.062, -0.057], [0.062, -0.078], [-0.004, -0.078]]]);
  // 권총 손잡이 (A2 핑거 그루브)
  G.prof(m.poly, [[-0.036, -0.05], [0.02, -0.05], [0.016, -0.068], [0.008, -0.078], [0.01, -0.09], [0.003, -0.1], [0.004, -0.112], [-0.004, -0.122], [-0.018, -0.152], [-0.055, -0.156], [-0.058, -0.146], [-0.046, -0.1], [-0.04, -0.066]], 0.028, 0, 0.004);
  // 상부 리시버 + 레일
  G.prof(m.anod, [[-0.085, -0.004], [0.162, -0.004], [0.162, 0.03], [-0.085, 0.03]], 0.027, 0, 0.002);
  G.rail(m.anod, -0.084, 0.162, 0.03);
  G.box(m.dark, 0.002, 0.017, 0.018, 0.088, 0.001, 0.018, 0.0133);          // 배출구
  G.box(m.anod, 0.0015, 0.018, 0.018, 0.088, -0.02, -0.002, 0.0152);          // 열린 먼지덮개
  G.cyl(m.anod, 0.0065, 0.0065, -0.075, -0.035, 0.012, 0.017);                 // 전진보조기
  G.cyl(m.bright, 0.0055, 0.0055, -0.083, -0.075, 0.012, 0.017);
  G.box(m.anod, 0.006, 0.012, -0.012, 0.006, 0.008, 0.02, 0.016);             // 탄피 편향기
  G.cylX(m.anod, 0.0048, 0.036, 0.09, -0.045, 0);                              // 탄창 멈치
  G.box(m.anod, 0.003, 0.018, 0.05, 0.066, -0.04, -0.022, -0.0135);            // 노리쇠 멈치
  G.cylX(m.bright, 0.0024, 0.029, 0.14, -0.018, 0); G.cylX(m.bright, 0.0024, 0.029, -0.07, -0.016, 0);
  // 버퍼튜브 + 개머리판
  G.cyl(m.anod, 0.0145, 0.0145, -0.26, -0.085, 0);
  G.cyl(m.anod, 0.017, 0.017, -0.095, -0.085, 0, 0, 10);
  G.prof(m.poly, [[-0.17, 0.023], [-0.34, 0.023], [-0.345, 0.012], [-0.35, -0.098], [-0.335, -0.104], [-0.3, -0.075], [-0.235, -0.032], [-0.17, -0.027]], 0.042, 0, 0.004);
  G.prof(m.rubber, [[-0.344, 0.025], [-0.358, 0.025], [-0.362, -0.1], [-0.35, -0.108], [-0.338, -0.104]], 0.045, 0, 0.003);
  G.box(m.poly, 0.012, 0.012, -0.2, -0.17, -0.04, -0.028);
  // 핸드가드 (8각 프리플로트)
  G.cyl(m.anod, 0.028, 0.028, 0.158, 0.168, 0, 0, 16);
  G.cyl(m.anod, 0.026, 0.026, 0.168, 0.37, 0, 0, 8, Math.PI / 8);
  G.box(m.anod, 0.019, 0.007, 0.168, 0.368, 0.023, 0.03);
  G.rail(m.anod, 0.168, 0.368, 0.03);
  for (let f = 0.185; f < 0.35; f += 0.04) for (const s of [-1, 1]) {
    G.box(m.dark, 0.003, 0.008, f, f + 0.026, -0.004, 0.004, s * 0.0242);
    G.box(m.dark, 0.012, 0.003, f, f + 0.026, -0.0255, -0.0235, s * 0.009);
  }
  // 전술 라이트 (3시 방향)
  G.box(m.anod, 0.014, 0.01, 0.3, 0.33, -0.005, 0.005, 0.03);
  G.cyl(m.anod, 0.0105, 0.0105, 0.27, 0.36, 0, 0.042, 14);
  G.cyl(m.anod, 0.013, 0.013, 0.345, 0.368, 0, 0.042, 14);
  G.cyl(m.flGlass, 0.011, 0.011, 0.368, 0.369, 0, 0.042, 14);
  // 총열 + 가늠쇠 + 소염기
  G.cyl(m.steel, 0.0095, 0.0095, 0.3, 0.5, 0);
  G.box(m.steel, 0.022, 0.026, 0.382, 0.41, -0.013, 0.013);
  G.prof(m.steel, [[0.372, 0.011], [0.414, 0.011], [0.401, 0.058], [0.386, 0.058]], 0.016);
  G.box(m.steel, 0.003, 0.018, 0.391, 0.395, 0.058, 0.076);
  for (const s of [-1, 1]) G.box(m.steel, 0.003, 0.022, 0.386, 0.4, 0.056, 0.078, s * 0.008);
  G.box(m.steel, 0.01, 0.012, 0.396, 0.412, -0.026, -0.012);
  G.cyl(m.steel, 0.0114, 0.0114, 0.5, 0.553, 0);
  for (const a of [0.6, 1.57, 2.54, -0.6, -2.54]) G.box(m.dark, 0.0035, 0.0035, 0.515, 0.548, Math.sin(a) * 0.0105 - 0.0017, Math.sin(a) * 0.0105 + 0.0017, Math.cos(a) * 0.0105);
  G.cyl(m.dark, 0.0045, 0.0045, 0.5525, 0.5535, 0);
  // 홀로그래픽 조준경 (EOTech 스타일)
  G.box(m.anod, 0.034, 0.012, -0.02, 0.085, 0.038, 0.05);
  G.prof(m.anod, [[0.03, 0.05], [0.086, 0.05], [0.086, 0.066], ['q', 0.084, 0.074, 0.074, 0.075], [0.03, 0.075]], 0.036, 0, 0.003);
  G.box(m.anod, 0.036, 0.004, -0.02, 0.032, 0.05, 0.054);
  const hood = [[-0.02, 0.05], [0.02, 0.05], [0.02, 0.084], ['q', 0.02, 0.093, 0.011, 0.093], [-0.011, 0.093], ['q', -0.02, 0.093, -0.02, 0.084]];
  const win = [[-0.0158, 0.0545], [0.0158, 0.0545], [0.0158, 0.083], ['q', 0.0158, 0.0885, 0.01, 0.0885], [-0.01, 0.0885], ['q', -0.0158, 0.0885, -0.0158, 0.083]];
  G.profZ(m.anod, hood, [win], -0.021, 0.03, 0.0015);
  G.box(m.anod, 0.006, 0.012, -0.012, 0.018, 0.093, 0.096);
  for (const sx of [-1, 1]) G.box(m.dark, 0.0008, 0.018, -0.014, 0.024, 0.06, 0.078, sx * 0.0205);
  G.box(m.poly, 0.007, 0.005, -0.024, -0.02, 0.043, 0.048, 0.008); G.box(m.poly, 0.007, 0.005, -0.024, -0.02, 0.043, 0.048, -0.008);
  G.box(m.poly, 0.005, 0.005, -0.024, -0.02, 0.043, 0.048, 0);
  G.box(m.anod, 0.01, 0.01, 0.04, 0.06, 0.04, 0.05, 0.02); G.cylX(m.anod, 0.004, 0.012, 0.05, 0.045, 0.028);
  const holo = new THREE.Mesh(new THREE.PlaneGeometry(0.031, 0.031), holoMaterial()); holo.position.set(0, 0.069, 0.016); holo.renderOrder = 5; G.group.add(holo);
  const tint = new THREE.Mesh(new THREE.PlaneGeometry(0.031, 0.031), m.tint); tint.position.set(0, 0.069, -0.028); tint.renderOrder = 4; G.group.add(tint);

  // ── 애니메이션 부품 ──
  const bolt = G.sub('bolt', 0, 0);
  bolt.box(m.bright, 0.0022, 0.012, 0.024, 0.082, 0.004, 0.016, 0.0136);
  bolt.cylX(m.bright, 0.0035, 0.003, 0.075, 0.01, 0.0142);
  const charge = G.sub('charge', -0.085, 0.024);
  charge.box(m.anod, 0.01, 0.006, 0, 0.06, -0.003, 0.003);
  charge.box(m.anod, 0.05, 0.008, -0.013, 0, -0.004, 0.004);
  charge.box(m.anod, 0.012, 0.006, -0.014, -0.004, 0.003, 0.007, -0.02);
  const sel = G.sub('selector', -0.035, -0.022, -0.0135);
  sel.box(m.anod, 0.003, 0.004, -0.014, 0.012, -0.002, 0.002); sel.cylX(m.anod, 0.005, 0.003, 0, 0, -0.001);
  const trig = G.sub('trigger', 0.03, -0.052);
  trig.prof(m.bright, [[-0.002, 0], [0.004, 0], [0.004, -0.008], ['q', 0.004, -0.02, -0.006, -0.024], [-0.004, -0.018], ['q', -0.002, -0.012, -0.002, -0.006]], 0.006);
  const mag = G.sub('mag', 0.115, -0.03);
  mag.prof(m.poly, [[0.036, 0], ['q', 0.042, -0.1, 0.062, -0.18], [0.068, -0.192], [0.068, -0.2], [-0.016, -0.206], [-0.02, -0.196], ['q', -0.03, -0.1, -0.034, 0]], 0.022, 0, 0.002);
  mag.prof(m.poly, [[0.072, -0.19], [0.073, -0.207], [-0.02, -0.214], [-0.024, -0.198]], 0.026, 0, 0.003);
  for (const y of [-0.028, -0.05, -0.072]) mag.box(m.poly, 0.024, 0.004, -0.028, 0.034, y, y + 0.004);
  mag.cyl(m.brass, 0.0029, 0.0029, -0.026, 0.012, 0.003, 0.002);
  mag.cyl(m.copper, 0.0029, 0.0008, 0.012, 0.03, 0.003, 0.002, 10);

  G.build();
  const P = {};
  G.subs.forEach((s) => (P[s.name] = s.group));
  const A = {
    grip: anchor(G.group, 'grip', -0.02, -0.1, 0, [1, 0, 0], [0, 0.104, 0.03]),
    fore: anchor(G.group, 'fore', 0.285, -0.008, -0.004, [0.45, 0.9, 0], [0, 0, -1]),
    mag: anchor(P.mag, 'mag', 0.012, -0.1, -0.004, [1, 0, 0.1], [0, 1, 0]),
    charge: anchor(P.charge, 'charge', -0.012, 0.022, -0.018, [0, 1, 0.3], [1, 0, 0]),
  };
  return { group: G.group, parts: P, anchors: A, sight: new THREE.Vector3(0, 0.069, 0.016), muzzle: point(G.group, 0.558, 0), eject: point(G.group, 0.055, 0.01, 0.016), holo, magBase: P.mag.position.clone() };
}

// ════════════════════ AKM ════════════════════
function buildAK() {
  const m = gunMats(), G = new GB();
  // 리시버 (프레스 강판)
  G.prof(m.blued, [[-0.105, 0.018], [0.162, 0.018], [0.162, -0.032], [0.13, -0.032], [0.13, -0.05], [0.05, -0.05], [0.04, -0.052], [-0.09, -0.052], [-0.105, -0.035]], 0.03, 0, 0.0015);
  G.prof(m.steel, [[-0.112, 0.018], [0.1, 0.018], [0.1, 0.029], [-0.08, 0.031], ['q', -0.106, 0.031, -0.113, 0.022]], 0.029, 0, 0.006);
  for (const f of [-0.1, -0.05, 0.02]) G.cylX(m.blued, 0.0035, 0.032, f, -0.03, 0);
  G.box(m.blued, 0.033, 0.006, 0.05, 0.13, -0.052, -0.046);
  // 조정간 (우측 대형 레버)
  G.prof(m.blued, [[-0.1, 0.012], [0.03, 0.006], [0.035, 0.0], [-0.1, 0.004]], 0.002, 0.0165, 0.0005);
  G.box(m.dark, 0.002, 0.014, -0.02, 0.07, 0.003, 0.017, 0.0152);             // 배출구
  // 가늠자 블록 + 탄젠트 가늠자
  G.box(m.blued, 0.03, 0.024, 0.1, 0.18, 0.012, 0.036);
  G.prof(m.blued, [[0.105, 0.036], [0.172, 0.043], [0.172, 0.047], [0.105, 0.04]], 0.013);
  G.box(m.blued, 0.013, 0.006, 0.162, 0.172, 0.043, 0.049);
  G.box(m.dark, 0.0025, 0.004, 0.161, 0.173, 0.045, 0.0495);
  // 방아쇠울 + 손잡이
  G.prof(m.blued, [[-0.022, -0.05], [0.082, -0.05], [0.082, -0.078], [-0.022, -0.078]], 0.011, 0, 0.001, [[[-0.014, -0.055], [0.074, -0.055], [0.074, -0.072], [-0.014, -0.072]]]);
  G.prof(m.bakelite, [[-0.02, -0.05], [0.028, -0.05], [0.016, -0.08], [-0.012, -0.152], [-0.046, -0.15], [-0.03, -0.1], [-0.028, -0.05]], 0.029, 0, 0.004);
  for (let y = -0.14; y < -0.06; y += 0.01) G.box(m.bakelite, 0.03, 0.002, -0.03 + (y + 0.05) * 0.35, -0.02 + (y + 0.05) * 0.35, y, y + 0.002);
  // 목재 개머리판
  G.prof(m.wood, [[-0.103, 0.016], [-0.375, -0.028], [-0.382, -0.03], [-0.386, -0.146], [-0.37, -0.148], [-0.2, -0.084], ['q', -0.14, -0.062, -0.103, -0.052]], 0.037, 0, 0.005);
  G.prof(m.blued, [[-0.382, -0.026], [-0.392, -0.026], [-0.396, -0.15], [-0.386, -0.152]], 0.04, 0, 0.002);
  // 총열덮개 (하부/상부 목재) + 가스관
  G.prof(m.wood, [[0.17, 0.006], [0.372, 0.006], [0.374, -0.03], ['q', 0.3, -0.042, 0.17, -0.034]], 0.046, 0, 0.007);
  for (let f = 0.2; f < 0.35; f += 0.035) G.box(m.dark, 0.047, 0.003, f, f + 0.003, -0.03, -0.004);
  G.cyl(m.blued, 0.009, 0.009, 0.19, 0.44, 0.028);
  G.prof(m.wood, [[0.19, 0.016], [0.365, 0.016], [0.365, 0.036], ['q', 0.28, 0.048, 0.19, 0.038]], 0.034, 0, 0.006);
  G.box(m.blued, 0.036, 0.028, 0.162, 0.175, -0.034, 0.018);
  G.box(m.blued, 0.05, 0.012, 0.372, 0.382, -0.032, -0.02);
  // 총열, 가스블록, 가늠쇠, 소염기, 꽂을대
  G.cyl(m.steel, 0.0088, 0.0088, 0.16, 0.54, 0);
  G.box(m.blued, 0.022, 0.05, 0.43, 0.455, -0.012, 0.038);
  G.box(m.blued, 0.02, 0.022, 0.5, 0.53, -0.012, 0.01);
  G.box(m.blued, 0.004, 0.034, 0.512, 0.518, 0.01, 0.043);
  G.add(new THREE.TorusGeometry(0.012, 0.0022, 6, 16, Math.PI * 1.2), m.blued, 0, 0.033, -0.515, 0, 0, -0.1 * Math.PI);
  G.cyl(m.blued, 0.012, 0.011, 0.54, 0.575, 0, 0, 16);
  G.box(m.dark, 0.012, 0.004, 0.556, 0.575, 0.009, 0.013);
  G.cyl(m.dark, 0.0045, 0.0045, 0.575, 0.576, 0);
  G.cyl(m.bright, 0.003, 0.003, 0.22, 0.528, -0.016);
  G.box(m.blued, 0.008, 0.014, 0.49, 0.505, -0.028, -0.014);
  // ── 애니메이션 부품 ──
  const bolt = G.sub('bolt', 0, 0);
  bolt.box(m.bright, 0.0022, 0.012, -0.018, 0.068, 0.004, 0.016, 0.0156);
  bolt.cylX(m.blued, 0.0055, 0.024, 0.115, 0.004, 0.026, 12);
  bolt.sphere(m.blued, 0.007, 0.117, 0.004, 0.038);
  const trig = G.sub('trigger', 0.035, -0.05);
  trig.prof(m.blued, [[-0.002, 0], [0.004, 0], [0.004, -0.008], ['q', 0.004, -0.02, -0.006, -0.022], [-0.004, -0.017], ['q', -0.002, -0.01, -0.002, -0.004]], 0.006);
  const mag = G.sub('mag', 0.13, -0.035);
  mag.prof(m.bakelite, [[0.0, 0.0], ['q', 0.01, -0.12, 0.058, -0.205], [0.062, -0.218], [-0.012, -0.232], ['q', -0.05, -0.12, -0.082, 0.0]], 0.025, 0, 0.003);
  mag.prof(m.blued, [[0.058, -0.203], [0.066, -0.22], [-0.014, -0.237], [-0.018, -0.226]], 0.027, 0, 0.002);
  mag.box(m.bakelite, 0.027, 0.012, -0.004, 0.006, -0.006, 0.006);
  for (const [a, b] of [[-0.03, -0.1], [-0.05, -0.16]]) mag.box(m.bakelite, 0.027, 0.004, -0.07 + a * 0.35, 0.0 + a * 0.3, a, a + 0.004);
  mag.cyl(m.brass, 0.0033, 0.0033, -0.062, -0.022, 0.003, 0.002);
  mag.cyl(m.copper, 0.0033, 0.0009, -0.022, 0.0, 0.003, 0.002, 10);
  G.build();
  const P = {};
  G.subs.forEach((s) => (P[s.name] = s.group));
  const A = {
    grip: anchor(G.group, 'grip', -0.01, -0.1, 0, [1, 0, 0], [0, 0.1, -0.034]),
    fore: anchor(G.group, 'fore', 0.285, -0.014, -0.004, [0.5, 0.9, 0], [0, 0, -1]),
    mag: anchor(P.mag, 'mag', -0.02, -0.12, -0.004, [1, 0, 0.1], [0, 1, -0.2]),
    charge: anchor(P.bolt, 'charge', 0.11, 0.012, 0.05, [-0.3, 1, 0], [0, 0, -1]),
  };
  return { group: G.group, parts: P, anchors: A, sight: new THREE.Vector3(0, 0.0475, -0.167), muzzle: point(G.group, 0.58, 0), eject: point(G.group, 0.03, 0.01, 0.017), magBase: P.mag.position.clone() };
}

// ════════════════════ Glock 17 ════════════════════
function buildGlock() {
  const m = gunMats(), G = new GB();
  // 프레임 (폴리머) + 방아쇠울
  G.prof(m.poly, [[-0.036, -0.009], [0.14, -0.009], [0.14, -0.028], [0.046, -0.028], [0.04, -0.022], [0.006, -0.022], [0.006, -0.032], ['q', 0.012, -0.055, 0.004, -0.07], ['q', 0.012, -0.09, 0.0, -0.118], [-0.034, -0.121], ['q', -0.052, -0.06, -0.044, -0.022], [-0.054, -0.012], [-0.042, -0.009]], 0.027, 0, 0.003);
  G.prof(m.poly, [[0.0, -0.02], [0.068, -0.024], [0.07, -0.05], [0.0, -0.052]], 0.013, 0, 0.002, [[[0.008, -0.026], [0.06, -0.028], [0.06, -0.045], [0.008, -0.046]]]);
  for (const f of [0.08, 0.1, 0.12]) G.box(m.poly, 0.029, 0.004, f, f + 0.01, -0.03, -0.026);
  G.cylX(m.bright, 0.0022, 0.029, 0.03, -0.016, 0); G.cylX(m.bright, 0.0022, 0.029, -0.02, -0.016, 0);
  G.box(m.poly, 0.006, 0.01, 0.017, 0.02, -0.02, -0.01, 0.0135);
  // 총열 (슬라이드 안, 총구 부분)
  G.cyl(m.steel, 0.0064, 0.0064, 0.02, 0.157, 0);
  G.cyl(m.dark, 0.0045, 0.0045, 0.157, 0.158, 0);
  G.box(m.steel, 0.018, 0.012, 0.02, 0.075, 0.005, 0.018);
  // ── 슬라이드 ──
  const slide = G.sub('slide', 0, 0);
  slide.prof(m.nitride, [[-0.03, -0.009], [0.155, -0.009], [0.158, 0.0], [0.158, 0.016], ['q', 0.157, 0.022, 0.15, 0.022], [-0.028, 0.022], [-0.032, 0.015]], 0.0254, 0, 0.0018);
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) slide.box(m.dark, 0.0012, 0.02, -0.024 + i * 0.0055, -0.022 + i * 0.0055, -0.004, 0.018, s * 0.0128);
  slide.box(m.dark, 0.012, 0.002, 0.024, 0.078, 0.0212, 0.0226, 0.004);
  slide.box(m.dark, 0.0015, 0.012, 0.024, 0.078, 0.008, 0.021, 0.0129);
  // 가늠쇠/가늠자 (삼중수소 도트)
  slide.box(m.nitride, 0.004, 0.006, 0.144, 0.152, 0.022, 0.028);
  slide.sphere(m.tritium, 0.0014, 0.148, 0.026, 0);
  slide.box(m.nitride, 0.018, 0.007, -0.024, -0.014, 0.022, 0.029);
  slide.box(m.dark, 0.004, 0.005, -0.025, -0.013, 0.025, 0.03);
  for (const s of [-1, 1]) slide.sphere(m.tritium, 0.0013, -0.0125, 0.0265, s * 0.0055);
  slide.cyl(m.bright, 0.0022, 0.0022, -0.034, -0.031, 0.004);
  const trig = G.sub('trigger', 0.028, -0.022);
  trig.prof(m.poly, [[-0.002, 0], [0.004, 0], [0.004, -0.006], ['q', 0.004, -0.018, -0.004, -0.02], [-0.004, -0.014], ['q', -0.002, -0.008, -0.002, -0.004]], 0.006);
  const mag = G.sub('mag', -0.012, -0.025);
  mag.group.rotation.x = -0.36;
  mag.prof(m.nitride, [[0.013, 0.0], [0.013, -0.1], [-0.02, -0.1], [-0.02, 0.0]], 0.021, 0, 0.001);
  mag.prof(m.poly, [[0.016, -0.096], [0.016, -0.108], [-0.024, -0.108], [-0.024, -0.096]], 0.025, 0, 0.002);
  mag.cyl(m.brass, 0.0045, 0.0045, -0.016, 0.0, 0.004, 0);
  mag.cyl(m.copper, 0.0045, 0.002, 0.0, 0.009, 0.004, 0, 10);
  G.build();
  const P = {};
  G.subs.forEach((s) => (P[s.name] = s.group));
  const A = {
    grip: anchor(G.group, 'grip', -0.02, -0.07, 0, [1, 0, 0], [0, 0.94, -0.34]),
    fore: anchor(G.group, 'fore', -0.012, -0.085, -0.014, [1, -0.1, 0.35], [0, 0.94, -0.34]),
    mag: anchor(P.mag, 'mag', 0.0, -0.08, -0.004, [1, 0, 0.1], [0, 1, 0]),
    slide: anchor(P.slide, 'slide', -0.01, 0.03, 0.0, [0, 1, 0.2], [1, 0, 0]),
  };
  return { group: G.group, parts: P, anchors: A, sight: new THREE.Vector3(0, 0.0275, 0.019), muzzle: point(G.group, 0.162, 0), eject: point(G.group, 0.05, 0.02, 0.012), magBase: P.mag.position.clone() };
}

// ════════════════════ AWM 계열 볼트액션 저격소총 ════════════════════
function buildAWM() {
  const m = gunMats(), G = new GB();
  // 섬홀 스톡 (올리브 드랩)
  G.prof(m.polyGreen, [[0.37, -0.012], [0.37, -0.048], [0.12, -0.056], [0.105, -0.072], [0.025, -0.072], [-0.005, -0.06], [-0.05, -0.15], [-0.098, -0.155], [-0.13, -0.1], [-0.32, -0.118], [-0.52, -0.142], [-0.53, -0.132], [-0.53, 0.018], [-0.5, 0.036], [-0.26, 0.03], [-0.16, 0.0], [-0.09, -0.012]],
    0.046, 0, 0.006, [[[-0.07, -0.03], [-0.128, -0.036], ['q', -0.14, -0.06, -0.125, -0.09], [-0.1, -0.09], ['q', -0.08, -0.06, -0.07, -0.03]]]);
  G.prof(m.rubber, [[-0.528, 0.02], [-0.548, 0.02], [-0.548, -0.145], [-0.528, -0.14]], 0.05, 0, 0.004);
  // 양각대 (접힌 상태)
  for (const s of [-1, 1]) G.cyl(m.anod, 0.005, 0.005, 0.12, 0.34, -0.06, s * 0.014, 10);
  G.box(m.anod, 0.04, 0.016, 0.335, 0.36, -0.064, -0.048);
  // 리시버 + 볼트 멈치
  G.cyl(m.blued, 0.018, 0.018, -0.09, 0.15, 0.005, 0, 22);
  G.box(m.blued, 0.03, 0.012, -0.08, 0.14, -0.012, 0.0);
  G.box(m.dark, 0.002, 0.014, 0.0, 0.07, 0.0, 0.016, 0.0178);
  // 탄창 (5발)
  G.box(m.anod, 0.028, 0.03, 0.03, 0.1, -0.098, -0.068);
  // 방아쇠울
  G.prof(m.anod, [[-0.03, -0.055], [0.03, -0.055], [0.024, -0.086], [-0.028, -0.086]], 0.012, 0, 0.001, [[[-0.022, -0.06], [0.022, -0.06], [0.018, -0.08], [-0.022, -0.08]]]);
  // 총열 (헤비 플루티드) + 제퇴기
  G.cyl(m.steel, 0.0135, 0.0105, 0.15, 0.64, 0.005, 0, 20);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; G.box(m.dark, 0.003, 0.003, 0.2, 0.5, 0.005 + Math.sin(a) * 0.0115 - 0.0015, 0.005 + Math.sin(a) * 0.0115 + 0.0015, Math.cos(a) * 0.0115); }
  G.cyl(m.blued, 0.017, 0.017, 0.64, 0.72, 0.005, 0, 18);
  for (const f of [0.655, 0.69]) for (const s of [-1, 1]) G.box(m.dark, 0.004, 0.018, f, f + 0.022, -0.004, 0.014, s * 0.0158);
  G.cyl(m.dark, 0.006, 0.006, 0.72, 0.721, 0.005);
  // 스코프 마운트 + 링
  G.rail(m.anod, -0.07, 0.14, 0.023, 0.02);
  for (const f of [-0.01, 0.11]) { G.box(m.anod, 0.03, 0.02, f - 0.012, f + 0.012, 0.028, 0.046); G.ring(m.anod, 0.0175, 0.004, f, 0.062); G.add(new THREE.CylinderGeometry(0.02, 0.02, 0.022, 20, 1, true), m.anod, 0, 0.062, -f, Math.PI / 2); }
  // 스코프 (30mm 튜브, 56mm 대물)
  const sy = 0.062;
  G.cyl(m.anod, 0.015, 0.015, -0.07, 0.2, sy, 0, 24);
  G.cyl(m.anod, 0.015, 0.028, 0.2, 0.26, sy, 0, 24);
  G.cyl(m.anod, 0.028, 0.029, 0.26, 0.335, sy, 0, 24);
  G.cyl(m.lensGlass, 0.025, 0.025, 0.328, 0.333, sy, 0, 24);
  G.cyl(m.anod, 0.015, 0.021, -0.1, -0.07, sy, 0, 24);
  G.cyl(m.anod, 0.021, 0.021, -0.17, -0.1, sy, 0, 24);
  for (let f = -0.165; f < -0.11; f += 0.006) G.ring(m.anod, 0.0212, 0.0011, f, sy);
  G.add(new THREE.CylinderGeometry(0.022, 0.022, 0.016, 24, 1, true).rotateX(-Math.PI / 2), m.rubber, 0, sy, 0.178);
  G.ring(m.rubber, 0.0215, 0.002, -0.186, sy);
  G.cylY(m.anod, 0.012, 0.024, 0.05, sy + 0.012); G.cylY(m.anod, 0.0125, 0.004, 0.05, sy + 0.03);
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; G.box(m.dark, 0.0012, 0.018, 0.05 + Math.sin(a) * 0.0125 - 0.0006, 0.05 + Math.sin(a) * 0.0125 + 0.0006, sy + 0.015, sy + 0.033, Math.cos(a) * 0.0125); }
  G.cylX(m.anod, 0.011, 0.022, 0.05, sy, 0.024); G.cylX(m.anod, 0.011, 0.02, 0.05, sy, -0.023);
  G.box(m.anod, 0.024, 0.016, 0.03, 0.07, sy - 0.008, sy + 0.008);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0195, 40), scopeMaterial());
  lens.position.set(0, sy, 0.174); lens.renderOrder = 3; G.group.add(lens);
  // ── 볼트 (회전 + 후퇴) ──
  const bolt = G.sub('bolt', 0, 0.005);
  bolt.cyl(m.bright, 0.0095, 0.0095, -0.14, 0.06, 0, 0, 16);
  bolt.cyl(m.blued, 0.013, 0.012, -0.16, -0.12, 0, 0, 16);
  const hdl = new THREE.CylinderGeometry(0.004, 0.0045, 0.055, 10); hdl.rotateZ(Math.PI / 2 - 0.5);
  bolt.add(hdl, m.blued, 0.034, -0.012, 0.1);
  bolt.sphere(m.blued, 0.0115, -0.1, -0.026, 0.058);
  const trig = G.sub('trigger', 0.005, -0.055);
  trig.prof(m.bright, [[-0.002, 0], [0.004, 0], [0.004, -0.006], ['q', 0.004, -0.018, -0.004, -0.02], [-0.004, -0.014]], 0.006);
  const mag = G.sub('mag', 0.065, -0.07);
  mag.box(m.anod, 0.026, 0.05, -0.035, 0.035, -0.05, 0.0);
  mag.box(m.anod, 0.03, 0.006, -0.037, 0.037, -0.056, -0.05);
  mag.cyl(m.brass, 0.0068, 0.0068, -0.034, 0.022, 0.003, 0);
  mag.cyl(m.copper, 0.0045, 0.0018, 0.022, 0.034, 0.003, 0, 10);
  G.build();
  const P = {};
  G.subs.forEach((s) => (P[s.name] = s.group));
  const A = {
    grip: anchor(G.group, 'grip', -0.085, -0.095, 0, [1, 0, 0], [0, 0.1, -0.05]),
    fore: anchor(G.group, 'fore', 0.26, -0.05, -0.004, [0.3, 0.95, 0], [0, 0, -1]),
    mag: anchor(P.mag, 'mag', 0.0, -0.035, -0.004, [1, 0, 0.1], [0, 1, 0]),
    bolt: anchor(P.bolt, 'bolt', -0.1, -0.03, 0.078, [1, 0.3, 0], [0, 1, 0]),
  };
  return { group: G.group, parts: P, anchors: A, sight: new THREE.Vector3(0, sy, 0.174), muzzle: point(G.group, 0.725, 0.005), eject: point(G.group, 0.03, 0.015, 0.02), lens, magBase: P.mag.position.clone() };
}

// ════════════════════ Remington 870 펌프액션 산탄총 ════════════════════
function buildM870() {
  const m = gunMats(), G = new GB();
  G.prof(m.blued, [[-0.085, 0.02], [0.135, 0.02], [0.135, -0.036], [-0.06, -0.038], [-0.085, -0.022]], 0.031, 0, 0.002);
  G.box(m.dark, 0.002, 0.018, 0.02, 0.085, -0.004, 0.014, 0.0156);
  G.box(m.dark, 0.016, 0.002, 0.0, 0.09, -0.039, -0.037);
  G.box(m.dark, 0.006, 0.002, -0.07, 0.12, 0.0205, 0.0215);
  G.prof(m.anod, [[-0.05, -0.036], [0.03, -0.036], [0.03, -0.068], [-0.05, -0.068]], 0.012, 0, 0.001, [[[-0.042, -0.041], [0.022, -0.041], [0.022, -0.062], [-0.042, -0.062]]]);
  G.cylX(m.bright, 0.004, 0.034, 0.045, -0.03, 0);
  // 개머리판 (호두나무)
  G.prof(m.walnut, [[-0.083, 0.0], ['q', -0.12, -0.01, -0.16, -0.022], [-0.41, -0.04], [-0.418, -0.04], [-0.422, -0.16], [-0.405, -0.163], ['q', -0.24, -0.1, -0.15, -0.085], ['q', -0.1, -0.07, -0.083, -0.036]], 0.042, 0, 0.007);
  G.prof(m.rubber, [[-0.418, -0.032], [-0.442, -0.032], [-0.446, -0.165], [-0.422, -0.165]], 0.046, 0, 0.004);
  // 총열 + 탄창관 + 조준 비드
  G.cyl(m.blued, 0.0118, 0.0112, 0.135, 0.6, 0, 0, 20);
  G.cyl(m.dark, 0.0095, 0.0095, 0.6, 0.601, 0);
  G.sphere(m.brass, 0.0026, 0.592, 0.0135);
  G.cyl(m.blued, 0.011, 0.011, 0.135, 0.52, -0.025, 0, 16);
  G.box(m.blued, 0.022, 0.036, 0.505, 0.522, -0.032, 0.004);
  G.cyl(m.blued, 0.012, 0.012, 0.52, 0.528, -0.025);
  // ── 펌프 (포엔드) ──
  const pump = G.sub('pump', 0, 0);
  pump.prof(m.walnut, [[0.2, -0.008], [0.385, -0.008], [0.39, -0.02], [0.385, -0.048], [0.2, -0.048], [0.195, -0.03]], 0.05, 0, 0.01);
  for (let f = 0.22; f < 0.37; f += 0.012) pump.box(m.dark, 0.051, 0.002, f, f + 0.004, -0.044, -0.012);
  for (const s of [-1, 1]) pump.box(m.bright, 0.003, 0.005, 0.03, 0.2, -0.028, -0.023, s * 0.0135);
  const trig = G.sub('trigger', 0.0, -0.036);
  trig.prof(m.anod, [[-0.002, 0], [0.004, 0], [0.004, -0.006], ['q', 0.004, -0.018, -0.004, -0.02], [-0.004, -0.014]], 0.006);
  G.build();
  const P = {};
  G.subs.forEach((s) => (P[s.name] = s.group));
  const A = {
    grip: anchor(G.group, 'grip', -0.1, -0.075, 0, [1, 0, 0], [0, 0.1, -0.08]),
    fore: anchor(P.pump, 'fore', 0.3, -0.03, -0.004, [0.5, 0.9, 0], [0, 0, -1]),
    port: anchor(G.group, 'port', 0.05, -0.06, -0.01, [0.3, 1, 0], [0, 0, -1]),
  };
  return { group: G.group, parts: P, anchors: A, sight: new THREE.Vector3(0, 0.0235, 0.07), muzzle: point(G.group, 0.602, 0), eject: point(G.group, 0.05, 0.005, 0.017) };
}

export const GUN_BUILDERS = { m4: buildM4, ak: buildAK, glock: buildGlock, awm: buildAWM, m870: buildM870 };

// 탄피 지오메트리 (선반 회전체)
export function casingGeo(type) {
  const spec = {
    '556': [0.0048, 0.0045, 0.0032, 0.045, 0.036],
    '762': [0.0056, 0.0052, 0.004, 0.039, 0.03],
    '9mm': [0.0049, 0.0048, 0.0048, 0.019, 0.019],
    '338': [0.0074, 0.007, 0.0045, 0.069, 0.055],
  }[type];
  if (!spec) {
    const g = new THREE.CylinderGeometry(0.0105, 0.0105, 0.068, 12);
    return g;
  }
  const [rb, rs, rn, L, sh] = spec;
  const pts = [[0, 0], [rb * 1.02, 0], [rb * 1.02, 0.0012], [rb * 0.82, 0.0018], [rb * 0.82, 0.003], [rb, 0.0034], [rs, sh], [rn, sh + (L - sh) * 0.45], [rn, L], [rn * 0.7, L]];
  const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y - L / 2)), 12);
  return g;
}
