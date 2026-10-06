// 월드: 하늘 · 태양 · 지형(하이트필드) · 작업장 건물 · 시험 주행로 · 소품
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { blockGeo } from '../gfx/geometry.js';
import { mulberry, clamp, smooth } from '../core/util.js';

const SIZE = 1400, CELLS = 280;
const perlin = new ImprovedNoise();

// 지형 높이: 작업장·주행로 주변은 평탄, 바깥은 언덕/산
export function groundH(x, z) {
  const d = Math.hypot(x * 0.9, z - 55);
  const t = smooth(clamp((d - 175) / 110, 0, 1));
  if (t <= 0) return 0;
  const n = perlin.noise(x * 0.0045, 0.3, z * 0.0045) * 0.6 + perlin.noise(x * 0.012, 1.7, z * 0.012) * 0.25 + perlin.noise(x * 0.04, 3.1, z * 0.04) * 0.06;
  const ridge = 1 - Math.abs(perlin.noise(x * 0.0022, 7.7, z * 0.0022));
  return t * (8 + (n * 0.5 + 0.5) * 38 + ridge * ridge * 55 * smooth(clamp((d - 300) / 300, 0, 1)));
}

export class World {
  constructor({ scene, renderer, physics, mats, quality }) {
    this.scene = scene; this.renderer = renderer; this.ph = physics; this.mats = mats; this.q = quality;
    this.tops = []; // 스파크/파편이 튀는 정적 윗면 [x0,x1,z0,z1,y]
    this.R = mulberry(1234);
  }
  build() {
    this.sky(); this.terrain(); this.yard(); this.workshop(); this.outdoor();
  }
  surfaceY(x, z, y) {
    let g = Math.abs(x) < 170 && Math.abs(z - 55) < 170 ? 0 : groundH(x, z);
    for (const t of this.tops) if (x > t[0] && x < t[1] && z > t[2] && z < t[3] && t[4] <= y && t[4] > g) g = t[4];
    return g;
  }
  // ─── 하늘 / 조명 ───
  sky() {
    const sky = (this.skyMesh = new Sky()); sky.scale.setScalar(9000);
    // 하늘 밝기 보정 (예제는 노출 0.5 기준) → 지상 조명과 균형
    sky.material.fragmentShader = sky.material.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * 0.42, 1.0 );');
    const u = sky.material.uniforms;
    u.turbidity.value = 3.2; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.003; u.mieDirectionalG.value = 0.85;
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 40), THREE.MathUtils.degToRad(32));
    u.sunPosition.value.copy(this.sunDir);
    this.scene.add(sky);
    // 환경맵 (반사)
    const pm = new THREE.PMREMGenerator(this.renderer), envScene = new THREE.Scene();
    const sky2 = new Sky(); sky2.material.fragmentShader = sky.material.fragmentShader; sky2.scale.setScalar(9000); for (const k in u) sky2.material.uniforms[k].value = u[k].value; envScene.add(sky2);
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(4000, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a3d33 })); gnd.position.y = -5; envScene.add(gnd);
    this.env = pm.fromScene(envScene, 0.02).texture; this.scene.environment = this.env; pm.dispose();
    this.mats.envMap = this.env;
    this.scene.fog = new THREE.FogExp2(0x9fb2c4, 0.00042);
    const sun = (this.sun = new THREE.DirectionalLight(0xfff1e0, 3.0));
    sun.castShadow = true; sun.shadow.mapSize.setScalar(this.q.shadow);
    const c = sun.shadow.camera; c.left = c.bottom = -38; c.right = c.top = 38; c.near = 1; c.far = 300;
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.025; sun.shadow.radius = 2;
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x5a4a38, 0.4));
  }
  followSun(p) { // 그림자 카메라를 플레이어 주변으로
    const snap = 2, cx = Math.round(p.x / snap) * snap, cz = Math.round(p.z / snap) * snap;
    this.sun.target.position.set(cx, 0, cz); this.sun.position.set(cx, 0, cz).addScaledVector(this.sunDir, 150);
  }
  // ─── 지형 ───
  terrain() {
    const R = this.ph.R, n = CELLS, h = new Float32Array((n + 1) * (n + 1));
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, n, n); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), dirt = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = groundH(x, z); pos.setY(i, y > 0 ? y : -0.03); // 평지는 바닥 마감면 아래로
      const v = perlin.noise(x * 0.02, 5, z * 0.02) * 0.5 + 0.5, v2 = perlin.noise(x * 0.11, 9, z * 0.11) * 0.5 + 0.5;
      col[i * 3] = 0.8 + v * 0.35; col[i * 3 + 1] = 0.85 + v * 0.25; col[i * 3 + 2] = 0.8 + v2 * 0.2;
      dirt[i] = clamp(y / 60 - 0.1 + (v2 - 0.5) * 0.6, 0, 0.85);
    }
    // 하이트필드: 열 우선(column-major), 행=z, 열=x
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = -SIZE / 2 + (j / n) * SIZE, z = -SIZE / 2 + (i / n) * SIZE, y = groundH(x, z); h[i + j * (n + 1)] = y > 0 ? y : -0.08;
    }
    this.ph.addStatic(R.ColliderDesc.heightfield(n, n, h, { x: SIZE, y: 1, z: SIZE }).setFriction(0.9), 'dirt');
    // 평지 구역은 두꺼운 박스 바닥(윗면 y=0): 얇은 철판이 하이트필드 삼각형을 관통하지 않도록
    this.ph.addStatic(R.ColliderDesc.cuboid(200, 2, 182).setTranslation(0, -2, 55).setFriction(0.85), 'concrete');
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('dirt', new THREE.BufferAttribute(dirt, 1));
    geo.computeVertexNormals();
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * SIZE, uv.getY(i) * SIZE);
    const sk = this.mats.skins, m = new THREE.MeshStandardMaterial({ map: sk.grass.map, normalMap: sk.grass.normalMap, roughness: 1, metalness: 0, vertexColors: true });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.dirtMap = { value: sk.dirt.map };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float dirt; varying float vDirt;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvDirt = dirt;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D dirtMap; varying float vDirt;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(dirtMap, vMapUv * 0.9).rgb, vDirt);');
    };
    const mesh = new THREE.Mesh(geo, m); mesh.receiveShadow = true; this.scene.add(mesh);
  }
  // 정적 박스 (시각 + 충돌)
  box(x, y, z, sx, sy, sz, skin, { mat = 'metal', paint = null, col = true, cast = true, rx = 0, ry = 0, rz = 0, top = false, seg = 0 } = {}) {
    const g = blockGeo(sx, sy, sz, { bevel: Math.min(0.01, Math.min(sx, sy, sz) * 0.2), seg });
    const m = new THREE.Mesh(g, typeof skin === 'string' ? this.mats.get(skin, paint) : skin);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = cast; m.receiveShadow = true; this.scene.add(m);
    if (col) {
      const R = this.ph.R, q = m.quaternion;
      this.ph.addStatic(R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.7), mat);
    }
    if (top && !rx && !rz) { const hx = Math.abs(Math.cos(ry)) * sx / 2 + Math.abs(Math.sin(ry)) * sz / 2, hz = Math.abs(Math.sin(ry)) * sx / 2 + Math.abs(Math.cos(ry)) * sz / 2; this.tops.push([x - hx, x + hx, z - hz, z + hz, y + sy / 2]); }
    return m;
  }
  flat(geo, skin, y = 0.004, opts = {}) {
    const m = new THREE.Mesh(geo, this.mats.get(skin)); m.receiveShadow = true; m.position.y = y; this.scene.add(m); return m;
  }
  // ─── 마당 · 주행로 ───
  yard() {
    // 콘크리트 바닥 (작업장 내부 + 앞마당), UV = 미터
    const pg = (w, d, cx, cz) => { const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); g.translate(cx, 0, cz); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w + cx, uv.getY(i) * d + cz); return g; };
    this.flat(pg(34, 25, 0, -12.5), 'concrete', 0);
    this.flat(pg(46, 26, 0, 13), 'concrete', 0);
    // 타원형 시험 주행로 (초타원)
    const cx = 0, cz = 92, rx = 95, rz = 58, W = 13, N = 220, pos = [], uv = [], idx = [];
    let acc = 0, prev = null;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), e = 0.5;
      const p = new THREE.Vector2(cx + rx * Math.sign(c) * Math.pow(Math.abs(c), e), cz + rz * Math.sign(s) * Math.pow(Math.abs(s), e));
      if (prev) acc += p.distanceTo(prev);
      const a2 = ((i + 1) / N) * Math.PI * 2, c2 = Math.cos(a2), s2 = Math.sin(a2);
      const p2 = new THREE.Vector2(cx + rx * Math.sign(c2) * Math.pow(Math.abs(c2), e), cz + rz * Math.sign(s2) * Math.pow(Math.abs(s2), e));
      const t = p2.clone().sub(p).normalize(), nrm = new THREE.Vector2(-t.y, t.x);
      for (const sd of [-1, 1]) { pos.push(p.x + nrm.x * sd * W / 2, 0, p.y + nrm.y * sd * W / 2); uv.push(sd * W / 2, acc); }
      if (i < N) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      prev = p;
    }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    tg.setIndex(idx); tg.computeVertexNormals(); if (tg.attributes.normal.getY(0) < 0) { tg.index.array.reverse(); tg.computeVertexNormals(); }
    this.flat(tg, 'asphalt', 0.003);
    // 차선 (흰 점선) + 연결 도로
    const lane = new THREE.MeshStandardMaterial({ color: 0xdedbd0, roughness: 0.7 }), dashes = [];
    for (let i = 0; i < N; i += 2) {
      const k = i * 2 * 3, x = (pos[k] + pos[k + 3]) / 2, z = (pos[k + 2] + pos[k + 5]) / 2, k2 = (i + 1) * 2 * 3;
      const x2 = (pos[k2] + pos[k2 + 3]) / 2, z2 = (pos[k2 + 2] + pos[k2 + 5]) / 2;
      const g = new THREE.PlaneGeometry(0.18, Math.hypot(x2 - x, z2 - z) * 0.9); g.rotateX(-Math.PI / 2); g.rotateY(-Math.atan2(z2 - z, x2 - x) + Math.PI / 2); g.translate((x + x2) / 2, 0.006, (z + z2) / 2); dashes.push(g);
    }
    const dm = new THREE.Mesh(mergeGeometries(dashes), lane); dm.receiveShadow = true; this.scene.add(dm);
    this.flat(pg(12, 12, 0, 31), 'asphalt', 0.0015);
  }
  // ─── 작업장 건물 ───
  workshop() {
    const W = 32, D = 24, H = 8, ridge = 10.2, x0 = -W / 2, z0 = -D;
    const wallMat = this.mats.get('corrugated');
    // 벽: 뒷벽, 양 측벽, 앞벽(문 위/양옆) — 바깥 골강판 + 안쪽 하단 블록벽
    this.box(0, H / 2, z0 - 0.1, W + 0.4, H, 0.2, wallMat, { mat: 'metal' });
    for (const s of [-1, 1]) {
      this.box(s * (W / 2 + 0.1), H / 2, -D / 2, 0.2, H, D, wallMat, { mat: 'metal' });
      this.box(s * (W / 2 - 0.1), 0.6, -D / 2, 0.2, 1.2, D - 0.4, 'block', { mat: 'concrete', col: false });
      this.box(s * 11.5, H / 2, 0.1, 9, H, 0.2, wallMat, { mat: 'metal' });
      // 측벽 창 (반투명)
      for (let k = 0; k < 3; k++) this.box(s * (W / 2 - 0.012), 4.6, -4 - k * 7.5, 0.01, 1.4, 4.5, this.windowMat(), { col: false, cast: false });
    }
    this.box(0, 6.5 + (H - 6.5) / 2, 0.1, 14, H - 6.5, 0.2, wallMat, { mat: 'metal' });
    this.box(0, 0.6, z0 + 0.1, W - 0.4, 1.2, 0.2, 'block', { mat: 'concrete', col: false });
    // 문틀 (노란 안전 도장)
    for (const s of [-1, 1]) this.box(s * 7.05, 3.25, 0.15, 0.25, 6.5, 0.3, 'paint', { paint: 0xe0b020, mat: 'metal' });
    this.box(0, 6.55, 0.15, 14.35, 0.2, 0.3, 'paint', { paint: 0xe0b020, mat: 'metal' });
    // 박공 지붕: 골강판 + 채광창 띠
    const slope = Math.atan2(ridge - H, W / 2), rl = Math.hypot(W / 2, ridge - H) + 0.6;
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const zc = z0 + 3 + k * 6, roof = this.box(s * W / 4, (H + ridge) / 2 + 0.15, zc, rl, 0.08, 4.4, wallMat, { col: false });
        roof.rotation.z = -s * slope;
        const sk = this.box(s * W / 4, (H + ridge) / 2 + 0.14, zc + 3, rl, 0.04, 1.6, this.skylightMat(), { col: false, cast: false });
        sk.rotation.z = -s * slope;
      }
    }
    for (const s of [-1, 1]) { const g = new THREE.Shape([new THREE.Vector2(-W / 2, H), new THREE.Vector2(W / 2, H), new THREE.Vector2(0, ridge)]); const m = new THREE.Mesh(new THREE.ShapeGeometry(g), wallMat); m.position.z = s < 0 ? z0 - 0.2 : 0.2; if (s > 0) m.rotation.y = Math.PI; m.castShadow = true; this.scene.add(m); m.material.side = THREE.DoubleSide; }
    // H빔 기둥 + 지붕 보 (6 m 간격) + 천장 크레인
    const hb = this.mats.get('paint', 0x3c4a5a);
    for (let k = 0; k <= 4; k++) {
      const z = z0 + 0.3 + k * 5.85;
      for (const s of [-1, 1]) {
        this.hbeam(s * (W / 2 - 0.35), H / 2, z, H, hb, true);
        const beam = this.hbeamMesh(Math.hypot(W / 2, ridge - H), hb); beam.position.set(s * W / 4, (H + ridge) / 2 - 0.25, z); beam.rotation.z = -s * slope; this.scene.add(beam);
      }
    }
    const crane = this.mats.get('paint', 0xe8b10f);
    for (const s of [-1, 1]) { const rail = this.hbeamMesh(D - 0.8, hb); rail.rotation.y = Math.PI / 2; rail.position.set(s * (W / 2 - 0.6), 6.9, -D / 2); this.scene.add(rail); }
    const girder = this.box(0, 7.05, -9, W - 1.2, 0.5, 0.35, crane, { col: false });
    this.box(1.5, 6.6, -9, 0.6, 0.45, 0.5, crane, { col: false });
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 8, 16, Math.PI * 1.4), this.mats.get('brushed')); hook.position.set(1.5, 4.1, -9); this.scene.add(hook);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 2.3), this.mats.get('brushed')); cable.position.set(1.5, 5.3, -9); this.scene.add(cable);
    // 조명 (고천장 등) — 개수 고정
    for (let i = 0; i < 6; i++) {
      const x = (i % 3 - 1) * 9, z = -6 - Math.floor(i / 3) * 11;
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.35, 24, 1, true), this.mats.get('paint', 0x2a2d30)); lamp.position.set(x, 7.2, z); lamp.material.side = THREE.DoubleSide; this.scene.add(lamp);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.38, 24).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.8, 3.4), toneMapped: false })); lens.position.set(x, 7.03, z); this.scene.add(lens);
      const L = new THREE.PointLight(0xfff2e2, 110, 34, 1.5); L.position.set(x, 6.8, z); this.scene.add(L);
    }
    this.furniture();
  }
  windowMat() { return this._win || (this._win = new THREE.MeshPhysicalMaterial({ color: 0xcde3ee, roughness: 0.1, transparent: true, opacity: 0.35, emissive: 0x8aa4b8, emissiveIntensity: 0.6, metalness: 0 })); }
  skylightMat() { return this._sky || (this._sky = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, transparent: true, opacity: 0.55, emissive: 0xeef4ff, emissiveIntensity: 1.6, side: THREE.DoubleSide })); }
  hbeamMesh(len, mat) {
    const g = mergeGeometries([blockGeo(len, 0.012, 0.2, { oy: 0.144 }), blockGeo(len, 0.012, 0.2, { oy: -0.144 }), blockGeo(len, 0.28, 0.008, {})]);
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
  }
  hbeam(x, y, z, len, mat, col) {
    const m = this.hbeamMesh(len, mat); m.rotation.z = Math.PI / 2; m.position.set(x, y, z); this.scene.add(m);
    if (col) this.ph.addStatic(this.ph.R.ColliderDesc.cuboid(0.15, len / 2, 0.1).setTranslation(x, y, z), 'metal');
  }
  furniture() {
    // 용접 작업대 (정반)
    const tx = -7, tz = -13;
    this.box(tx, 0.89, tz, 2.4, 0.025, 1.2, 'millscale', { mat: 'metal', top: true });
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(tx + a * 1.1, 0.44, tz + b * 0.5, 0.08, 0.88, 0.08, 'paint', { paint: 0x2f5d3a, mat: 'metal' });
    this.box(tx, 0.18, tz, 2.3, 0.04, 1.1, 'paint', { paint: 0x2f5d3a, mat: 'metal', top: true });
    // 용접기 + 가스통
    this.box(tx - 2.2, 0.5, tz - 0.3, 0.5, 0.75, 0.75, 'paint', { paint: 0x1b4f9a, mat: 'metal', top: true });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.6, 0.6), toneMapped: false })); panel.position.set(tx - 1.94, 0.7, tz - 0.3); panel.rotation.y = Math.PI / 2; this.scene.add(panel);
    for (const [k, c] of [[0, 0x2a6b3a], [1, 0x8a8f96]]) {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 1.45, 24), this.mats.get('paint', c)); cyl.position.set(tx - 2.7 - k * 0.3, 0.73, tz - 1.0); cyl.castShadow = true; this.scene.add(cyl);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.mats.get('paint', c)); cap.position.set(tx - 2.7 - k * 0.3, 1.45, tz - 1.0); this.scene.add(cap);
      this.ph.addStatic(this.ph.R.ColliderDesc.cylinder(0.78, 0.115).setTranslation(tx - 2.7 - k * 0.3, 0.78, tz - 1.0), 'metal');
    }
    // 목공 작업대 + 공구판
    this.box(6, 0.88, -23.1, 2.4, 0.06, 0.8, 'pine', { mat: 'wood', top: true });
    for (const a of [-1, 1]) this.box(6 + a * 1.1, 0.43, -23.1, 0.09, 0.85, 0.7, 'pine', { mat: 'wood' });
    this.box(6, 0.2, -23.1, 2.2, 0.03, 0.7, 'plywood', { mat: 'wood', top: true });
    this.box(6, 2.0, -23.85, 2.4, 1.2, 0.02, 'plywood', { col: false });
    this.box(5.2, 0.99, -22.9, 0.25, 0.14, 0.14, 'paint', { paint: 0x23508f, mat: 'metal' });
    // 공구함 (빨강)
    this.box(12, 0.55, -22.9, 1.2, 1.1, 0.6, 'paint', { paint: 0xb51c1c, mat: 'metal', top: true });
    for (let i = 0; i < 5; i++) this.box(12, 0.25 + i * 0.19, -22.59, 1.1, 0.012, 0.015, 'brushed', { col: false });
    // 자재 랙 (외팔보)
    const rk = this.mats.get('paint', 0x2b5ea8);
    for (let k = 0; k < 4; k++) {
      this.box(-15.2, 2.2, -20 + k * 2.6, 0.2, 4.4, 0.2, rk, { mat: 'metal' });
      for (let l = 0; l < 4; l++) this.box(-14.6, 0.6 + l * 1.0, -20 + k * 2.6, 1.1, 0.08, 0.1, rk, { mat: 'metal', col: false });
    }
    // 랙 위 장식용 자재
    for (let l = 0; l < 4; l++) for (let i = 0; i < 5; i++) {
      const skin = l % 2 ? 'galv' : 'millscale';
      const b = this.box(-14.4 + i * 0.12 - 0.2, 0.68 + l * 1.0, -16.1, 0.08, 0.08, 8.2, skin, { col: false }); b.castShadow = true;
    }
    this.ph.addStatic(this.ph.R.ColliderDesc.cuboid(0.6, 2.2, 4.4).setTranslation(-14.6, 2.2, -16.1), 'metal');
    // 소화기
    const fe = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 16), this.mats.get('paint', 0xc21010)); fe.position.set(15.6, 1.2, -6); this.scene.add(fe);
  }
  // ─── 야외 ───
  outdoor() {
    const R = this.ph.R;
    // 콘크리트 점프대/경사로 (볼록 껍질)
    const ramp = (x, z, w, len, h, ry) => {
      const hw = w / 2;
      const g = new THREE.BufferGeometry();
      const v = [[-hw, 0, 0], [hw, 0, 0], [hw, 0, len], [-hw, 0, len], [-hw, h, len], [hw, h, len]];
      const f = [[0, 2, 1], [0, 3, 2], [0, 1, 5], [0, 5, 4], [3, 4, 5], [3, 5, 2], [0, 4, 3], [1, 2, 5]];
      const p = [], uv = [];
      for (const t of f) { const a = new THREE.Vector3(...v[t[0]]), b = new THREE.Vector3(...v[t[1]]), c = new THREE.Vector3(...v[t[2]]); const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize(); for (const q of [a, b, c]) { p.push(q.x, q.y, q.z); uv.push(Math.abs(n.x) > 0.5 ? q.z : q.x, Math.abs(n.y) > 0.7 ? q.z : q.y); } }
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.mats.get('block')); m.position.set(x, 0, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; this.scene.add(m);
      const q = m.quaternion, arr = new Float32Array(v.flat());
      this.ph.addStatic(R.ColliderDesc.convexHull(arr).setTranslation(x, 0, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }), 'concrete');
    };
    ramp(-30, 75, 6, 9, 1.4, 0); ramp(30, 85, 5, 14, 3.2, Math.PI); ramp(0, 120, 8, 6, 0.6, Math.PI / 2);
    // 둔덕 (요철 구간)
    for (let i = 0; i < 7; i++) {
      const g = new THREE.CylinderGeometry(0.6, 0.6, 7, 20, 1, false, 0, Math.PI); g.rotateZ(Math.PI / 2); g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, this.mats.get('asphalt')); m.position.set(-50 + i * 2.6, -0.25, 105); m.receiveShadow = m.castShadow = true; this.scene.add(m);
      this.ph.addStatic(R.ColliderDesc.cylinder(3.5, 0.6).setTranslation(-50 + i * 2.6, -0.25, 105).setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }), 'concrete');
    }
    // 나무 (인스턴싱)
    const trunkG = new THREE.CylinderGeometry(0.12, 0.22, 3, 7); trunkG.translate(0, 1.5, 0);
    const leafG = mergeGeometries([new THREE.IcosahedronGeometry(1.6, 1).translate(0, 3.6, 0), new THREE.IcosahedronGeometry(1.2, 1).translate(0.6, 4.6, 0.3), new THREE.IcosahedronGeometry(1.1, 1).translate(-0.6, 4.4, -0.4)]);
    const N = 420, trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 }), N);
    const leaves = new THREE.InstancedMesh(leafG, new THREE.MeshStandardMaterial({ color: 0x3d5f2a, roughness: 0.95, flatShading: true }), N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    let k = 0;
    while (k < N) {
      const x = (this.R() - 0.5) * SIZE * 0.9, z = (this.R() - 0.5) * SIZE * 0.9;
      if (Math.hypot(x * 0.9, z - 55) < 185) continue;
      const y = groundH(x, z), sc = 0.8 + this.R() * 1.2;
      m4.compose(p.set(x, y - 0.2, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.R() * 6), s.set(sc, sc * (0.8 + this.R() * 0.6), sc));
      trunks.setMatrixAt(k, m4); leaves.setMatrixAt(k, m4); leaves.setColorAt(k, c.setHSL(0.24 + this.R() * 0.08, 0.45, 0.22 + this.R() * 0.1)); k++;
    }
    trunks.castShadow = leaves.castShadow = true; leaves.receiveShadow = true; this.scene.add(trunks, leaves);
  }
}
