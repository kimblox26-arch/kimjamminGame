// 21개 관절 위치로 실제 사람 손 형태의 3D 메시를 만든다.
// 손가락 = 관절을 지나는 곡선을 따라 굵기가 변하는 매끈한 튜브(납작한 타원 단면, 마디 살짝 도톰),
// 손바닥 = 매 프레임 다시 짜는 둥근 쿠션형 메시,
// 손톱, 손목, 팔뚝, 소매까지 붙여서 '떠다니는 손'이 아니라 내 팔처럼 보이게 한다.
import * as THREE from 'three';
import { FINGERS } from './hands.js';

export const SKIN_TONES = { light: 0xf3cbb0, medium: 0xdca47f, tan: 0xb87b53, deep: 0x7b4a2f };

// 관절별 반지름 (m) — 성인 손 기준
const RAD = [0, 0.0138, 0.0122, 0.0107, 0.0096, 0.0106, 0.0095, 0.0085, 0.0077, 0.0111, 0.0099, 0.0088, 0.0079,
  0.0104, 0.0092, 0.0082, 0.0075, 0.0092, 0.0081, 0.0073, 0.0067];
const TIPS = new Set([4, 8, 12, 16, 20]);

const sphereGeo = new THREE.SphereGeometry(1, 28, 18);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4();
const F = new THREE.Vector3(), L = new THREE.Vector3(), U = new THREE.Vector3(), X = new THREE.Vector3();
const tips = Array.from({ length: 21 }, () => new THREE.Vector3());

// 손바닥 메시 해상도
const PN = 44, PR = 14, PEXP = 2.5, H_PALM = 0.0145, H_BACK = 0.0105;

// 손가락 튜브 해상도: 둘레 분할, 몸통 링 수, 손끝 반구 링 수
const FSEG = 14, FRING = 30, FCAP = 6, NRING = FRING + FCAP;
const _T = new THREE.Vector3(), _B = new THREE.Vector3(), _S = new THREE.Vector3(), _P = new THREE.Vector3();

class FingerTube {
  constructor(mat) {
    this.pos = new Float32Array(NRING * FSEG * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let k = 0; k < NRING - 1; k++) for (let i = 0; i < FSEG; i++) {
      const a = k * FSEG + i, b = k * FSEG + (i + 1) % FSEG, c = a + FSEG, d = b + FSEG;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    this.mesh = shadowed(new THREE.Mesh(geo, mat));
    this.pts = Array.from({ length: 5 }, () => new THREE.Vector3());
    this.curve = new THREE.CatmullRomCurve3(this.pts, false, 'centripetal');
    this.rad = [0, 0, 0, 0, 0];
  }

  // pts/rad: 손바닥 안쪽 시작점 → 뿌리 → 둘째 → 셋째 마디 → 손끝 구 중심. dorsal(T): 손등 방향을 돌려주는 함수
  update(dorsal) {
    const P = this.pos, R = this.rad;
    let k = 0;
    const ring = (center, T, r, w, h) => {
      dorsal(T, _B);
      _B.addScaledVector(T, -_B.dot(T)).normalize();
      _S.crossVectors(_B, T);
      for (let i = 0; i < FSEG; i++) {
        const a = (i / FSEG) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        P[k++] = center.x + (_S.x * c * w + _B.x * s * h) * r;
        P[k++] = center.y + (_S.y * c * w + _B.y * s * h) * r;
        P[k++] = center.z + (_S.z * c * w + _B.z * s * h) * r;
      }
    };
    for (let j = 0; j < FRING; j++) {
      const u = j / (FRING - 1);
      const seg = Math.min(3, Math.floor(u * 4)), t = u * 4 - seg;
      // 마디(둘째·셋째)는 살짝 도톰하고 손등 쪽으로 튀어나오게
      const bump = Math.exp(-(((u - 0.5) / 0.045) ** 2)) + 0.7 * Math.exp(-(((u - 0.75) / 0.04) ** 2));
      const r = (R[seg] + (R[seg + 1] - R[seg]) * t) * (1 + 0.05 * bump);
      this.curve.getPoint(u, _P);
      this.curve.getTangent(u, _T);
      dorsal(_T, _B);
      _P.addScaledVector(_B, r * 0.06 * bump);
      ring(_P, _T, r, 1.07, 0.93);
    }
    // 손끝: 반구로 닫기 (손톱 쪽이 조금 더 납작)
    this.curve.getTangent(1, _T);
    const rt = R[4];
    for (let c = 1; c <= FCAP; c++) {
      const ph = (c / FCAP) * Math.PI / 2;
      _P.copy(this.pts[4]).addScaledVector(_T, rt * Math.sin(ph));
      ring(_P, _T, rt * Math.max(Math.cos(ph), 0.02), 1.07, 0.88);
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
  }
}
function placeBasis(mesh, pos, x, y, z, sx, sy, sz) {
  _m.makeBasis(x, y, z);
  mesh.quaternion.setFromRotationMatrix(_m);
  mesh.position.copy(pos);
  mesh.scale.set(sx, sy, sz);
}
const shadowed = m => { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; return m; };

export class HandMesh {
  constructor(side, tone = 'medium') {
    this.side = side;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.skin = new THREE.MeshPhysicalMaterial({
      color: SKIN_TONES[tone] ?? SKIN_TONES.medium, roughness: 0.55, metalness: 0,
      sheen: 0.5, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xff9c80),
      clearcoat: 0.12, clearcoatRoughness: 0.55, emissive: 0x3a1206, emissiveIntensity: 0.18,
    });
    this.nailMat = new THREE.MeshPhysicalMaterial({ color: 0xe8b3a6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 });
    this.sleeveMat = new THREE.MeshStandardMaterial({ color: 0x35598f, roughness: 0.92, side: THREE.DoubleSide });

    this.fingers = FINGERS.map(() => { const t = new FingerTube(this.skin); this.group.add(t.mesh); return t; });
    this.nails = FINGERS.map(() => { const m = shadowed(new THREE.Mesh(sphereGeo, this.nailMat)); this.group.add(m); return m; });

    // 손바닥
    const geo = new THREE.BufferGeometry();
    this.palmPos = new Float32Array((PR + 1) * PN * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.palmPos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let r = 0; r < PR; r++) for (let i = 0; i < PN; i++) {
      const a = r * PN + i, b = r * PN + (i + 1) % PN, c = (r + 1) * PN + i, d = (r + 1) * PN + (i + 1) % PN;
      idx.push(a, c, b, b, c, d);
    }
    geo.setIndex(idx);
    this.palm = shadowed(new THREE.Mesh(geo, this.skin));
    this.group.add(this.palm);
    this.outline = Array.from({ length: 10 }, () => new THREE.Vector3());
    this.curve = new THREE.CatmullRomCurve3(this.outline, true, 'centripetal');
    this.ring = Array.from({ length: PN }, () => new THREE.Vector3());
    this.center = new THREE.Vector3();

    // 손목 · 팔뚝 · 소매
    this.wrist = shadowed(new THREE.Mesh(sphereGeo, this.skin));
    const armGeo = new THREE.CylinderGeometry(1.28, 1, 1, 26, 1, true); armGeo.translate(0, 0.5, 0);
    this.arm = shadowed(new THREE.Mesh(armGeo, this.skin));
    const slvGeo = new THREE.CylinderGeometry(1.06, 1, 1, 28, 1, true); slvGeo.translate(0, 0.5, 0);
    this.sleeve = shadowed(new THREE.Mesh(slvGeo, this.sleeveMat));
    this.cuff = shadowed(new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 10, 32), this.sleeveMat));
    this.group.add(this.wrist, this.arm, this.sleeve, this.cuff);
  }

  setTone(tone) { this.skin.color.setHex(SKIN_TONES[tone] ?? SKIN_TONES.medium); }

  // J: 카메라(그룹) 공간 관절 21개, sign: 오른손 +1 / 왼손 -1
  update(J, sign) {
    F.subVectors(J[9], J[0]).normalize();                       // 손목 → 손가락 방향
    L.subVectors(J[5], J[17]).normalize();                      // 새끼 → 엄지 쪽
    U.crossVectors(_v.subVectors(J[5], J[0]), _w.subVectors(J[17], J[0])).normalize().multiplyScalar(sign); // 손바닥 쪽

    // 손끝: 관절점이 손가락 끝이므로 구 중심은 반지름만큼 안쪽
    for (const t of TIPS) tips[t].copy(J[t]).addScaledVector(_v.subVectors(J[t], J[t - 1]).normalize(), -RAD[t] * 0.85);

    // 손등 방향: 네 손가락은 굽힘 평면(새끼↔엄지 축에 수직) 기준, 엄지는 옆·위를 향함
    const back = _w.copy(U).negate();
    const flip = Math.sign(X.crossVectors(F, L).dot(back)) || 1;
    const fingerDorsal = (T, out) => {
      out.crossVectors(T, L).multiplyScalar(flip);
      if (out.lengthSq() < 1e-6) out.copy(back);
      return out;
    };
    const thumbDorsal = (T, out) => out.copy(L).multiplyScalar(0.75).addScaledVector(back, 0.65);
    FINGERS.forEach(([a, b, c, d], f) => {
      const tube = this.fingers[f];
      const p = tube.pts;
      p[0].copy(J[a]).addScaledVector(_v.subVectors(J[0], J[a]).normalize(), f === 0 ? 0.01 : 0.016);
      p[1].copy(J[a]); p[2].copy(J[b]); p[3].copy(J[c]); p[4].copy(tips[d]);
      const r = tube.rad;
      r[0] = RAD[a] * 1.06; r[1] = RAD[a] * 1.05; r[2] = RAD[b]; r[3] = RAD[c]; r[4] = RAD[d];
      tube.update(f === 0 ? thumbDorsal : fingerDorsal);
    });

    // 손톱: 손끝 마디의 손등 쪽에 붙임
    FINGERS.forEach(([, , c, d], f) => {
      const r = RAD[d];
      const dir = _v.subVectors(tips[d], J[c]).normalize();
      const nb = new THREE.Vector3();
      if (f === 0) nb.copy(L).multiplyScalar(0.75).addScaledVector(back, 0.65);
      else nb.crossVectors(dir, L).multiplyScalar(flip);
      nb.addScaledVector(dir, -nb.dot(dir));
      if (nb.lengthSq() < 1e-8) nb.copy(back);
      nb.normalize();
      const side = X.crossVectors(nb, dir).normalize();
      const pos = new THREE.Vector3().copy(tips[d]).addScaledVector(dir, -r * 0.35).addScaledVector(nb, r * 0.86);
      placeBasis(this.nails[f], pos, side, nb, dir, r * 0.74, r * 0.26, r * 0.9);
    });

    this.updatePalm(J);

    // 손목/팔뚝: 손 방향을 이어받되 팔꿈치가 있을 만한 쪽(아래·몸쪽·바깥)으로 휘게
    const y = U.clone().addScaledVector(F, -U.dot(F)).normalize();
    const x = new THREE.Vector3().crossVectors(y, F).normalize();
    placeBasis(this.wrist, _v.copy(J[0]).addScaledVector(F, 0.008), x, y, F, 0.028, 0.0185, 0.03);
    const s = this.side === 'R' ? 1 : -1;
    const armDir = new THREE.Vector3(s * 0.28, -0.72, 0.62).normalize().multiplyScalar(0.55).addScaledVector(F, -0.45).normalize();
    const ax = x.clone().addScaledVector(armDir, -x.dot(armDir)).normalize();
    const az = new THREE.Vector3().crossVectors(ax, armDir);
    placeBasis(this.arm, J[0], ax, armDir, az, 0.028, 0.36, 0.0195);
    const sp = _v.copy(J[0]).addScaledVector(armDir, 0.13);
    placeBasis(this.sleeve, sp, ax, armDir, az, 0.046, 0.3, 0.039);
    placeBasis(this.cuff, sp, ax, az.clone().negate(), armDir, 0.046, 0.039, 0.046);
  }

  updatePalm(J) {
    const o = this.outline, C = this.center;
    const lerp = (out, a, b, t) => out.copy(a).lerp(b, t);
    o[0].copy(J[0]).addScaledVector(L, 0.026).addScaledVector(F, 0.006);              // 손목 엄지쪽
    o[1].copy(J[1]).addScaledVector(L, 0.006);                                         // 엄지 뿌리
    lerp(o[2], J[1], J[5], 0.4).addScaledVector(L, 0.014);                             // 엄지두덩
    lerp(o[3], J[1], J[5], 0.78).addScaledVector(L, 0.006);                            // 엄지-검지 사이
    o[4].copy(J[5]).addScaledVector(L, 0.005).addScaledVector(F, 0.003);
    o[5].copy(J[9]).addScaledVector(F, 0.005);
    o[6].copy(J[13]).addScaledVector(F, 0.004);
    o[7].copy(J[17]).addScaledVector(L, -0.006).addScaledVector(F, 0.001);
    lerp(o[8], J[17], J[0], 0.5).addScaledVector(L, -0.013);                          // 새끼두덩
    o[9].copy(J[0]).addScaledVector(L, -0.024).addScaledVector(F, 0.006);             // 손목 새끼쪽
    C.copy(J[0]).add(J[5]).add(J[9]).add(J[13]).add(J[17]).add(o[2]).multiplyScalar(1 / 6);

    // 엄지를 손바닥 위로 접으면 윤곽이 꼬이므로, 손바닥 평면에 투영한 볼록 껍질만 윤곽으로 사용
    const fo = _v.copy(F), lo = X.copy(L).addScaledVector(F, -L.dot(F)).normalize();
    const pts = o.map(p => ({ p, x: _w.subVectors(p, C).dot(lo), y: _w.dot(fo) })).sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const hull = [];
    for (const pass of [pts, [...pts].reverse()]) {
      const start = hull.length;
      for (const q of pass) {
        while (hull.length >= start + 2 && cross(hull[hull.length - 2], hull[hull.length - 1], q) <= 0) hull.pop();
        hull.push(q);
      }
      hull.pop();
    }
    this.curve.points = hull.map(h => h.p);

    for (let i = 0; i < PN; i++) this.curve.getPoint(i / PN, this.ring[i]);
    // 윤곽 방향(시계/반시계)에 따라 순서를 맞춰 면이 항상 바깥을 향하게
    let area = 0;
    for (let i = 0; i < PN; i++) {
      _v.subVectors(this.ring[i], C); _w.subVectors(this.ring[(i + 1) % PN], C);
      area += X.crossVectors(_v, _w).dot(U);
    }
    const rev = area < 0;
    const P = this.palmPos;
    let k = 0;
    for (let r = 0; r <= PR; r++) {
      const th = Math.PI * r / PR, sn = Math.abs(Math.sin(th)), cs = Math.cos(th);
      const rho = Math.pow(sn, 2 / PEXP);
      const h = Math.sign(cs) * Math.pow(Math.abs(cs), 2 / PEXP) * (cs >= 0 ? H_PALM : H_BACK);
      for (let i = 0; i < PN; i++) {
        const q = this.ring[rev ? PN - 1 - i : i];
        P[k++] = C.x + (q.x - C.x) * rho + U.x * h;
        P[k++] = C.y + (q.y - C.y) * rho + U.y * h;
        P[k++] = C.z + (q.z - C.z) * rho + U.z * h;
      }
    }
    const g = this.palm.geometry;
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
  }
}
