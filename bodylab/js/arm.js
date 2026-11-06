// 업로드한 "사람 손·팔" 모델(handvr/models/arm.glb)로 만든 팔. 왼팔 원본, 오른팔은 좌우 반전.
// 뼈: 위팔·아래팔·손 + 손가락 15마디. 가중치는 불러올 때 계산(팔꿈치·손목 경계면, 가장 가까운 손가락 마디).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const V = THREE.Vector3;
// 모델(왼팔, 미터) 안의 관절 위치: 손 21개(MediaPipe 순서) + 팔꿈치 + 어깨  (handvr/js/hand-rig.js 와 같은 값)
const JOINTS = {
  hand: [[0.0457, 0.1688, 0.1484], [0.0070, 0.1780, 0.1894], [-0.0142, 0.1653, 0.2276], [-0.0449, 0.1595, 0.2475], [-0.0477, 0.1649, 0.2707],
    [0.0561, 0.1520, 0.2634], [0.0422, 0.1160, 0.3125], [0.0263, 0.0915, 0.3411], [0.0164, 0.0876, 0.3645],
    [0.0696, 0.1227, 0.2474], [0.0656, 0.0754, 0.2935], [0.0476, 0.0495, 0.3246], [0.0416, 0.0342, 0.3469],
    [0.0728, 0.1000, 0.2239], [0.0709, 0.0571, 0.2613], [0.0597, 0.0321, 0.2897], [0.0484, 0.0177, 0.3079],
    [0.0697, 0.0837, 0.1970], [0.0565, 0.0418, 0.2211], [0.0469, 0.0176, 0.2393], [0.0423, 0.0065, 0.2515]],
  elbow: [0.0295, 0.3395, -0.0790],
  shoulder: [-0.0250, 0.5740, -0.2940],
};
const GEO = {};
export const CHAINS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _w = new V(), _a = new V(), _b = new V(), _c = new V(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion();

export async function loadArmAsset() {
  const url = n => new URL(`../../handvr/models/${n}`, import.meta.url).href;
  const tl = new THREE.TextureLoader();
  const tex = async (n, srgb) => { const t = await tl.loadAsync(url(n)); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const [gltf, map, normalMap, orm] = await Promise.all([new GLTFLoader().loadAsync(url('arm.glb')), tex('arm-color.jpg', true), tex('arm-normal.jpg'), tex('arm-orm.jpg')]);
  let geo = null;
  gltf.scene.traverse(o => { if (o.isMesh && !geo) geo = o.geometry; });
  return { geo, map, normalMap, orm };
}

// 좌표계: 원점 o, Y축, 경첩 H(→X 축) 로 만든 행렬
const _hx = new V(), _hy = new V(), _hz = new V();
export function hingeFrame(out, o, y, h) {
  _hy.copy(y);
  _hx.copy(h).addScaledVector(_hy, -h.dot(_hy)).normalize();
  _hz.crossVectors(_hx, _hy);
  return out.makeBasis(_hx, _hy, _hz).setPosition(o);
}

export class Arm {
  constructor(asset, side, material) {
    this.side = side;
    const mx = side === 'R' ? -1 : 1;
    const at = p => new V(p[0] * mx, p[1], p[2]);
    const J = this.J = JOINTS.hand.map(at);
    const S = this.S = at(JOINTS.shoulder), E = this.E = at(JOINTS.elbow), W = this.W = J[0];
    this.lenU = S.distanceTo(E); this.lenF = E.distanceTo(W);
    // 손바닥 좌표계 (바인드)
    const sign = side === 'R' ? 1 : -1;
    this.F = new V().subVectors(J[9], J[0]).normalize();
    this.L = new V().subVectors(J[5], J[17]); this.L.addScaledVector(this.F, -this.L.dot(this.F)).normalize();
    const Ub = new V().crossVectors(_a.subVectors(J[5], J[0]), _b.subVectors(J[17], J[0])).multiplyScalar(sign).normalize();
    const FxL = new V().crossVectors(this.F, this.L);
    this.chir = Math.sign(FxL.dot(Ub)) || 1;
    this.U = FxL.multiplyScalar(this.chir); // 손바닥 쪽
    this.G = J[0].clone().addScaledVector(this.F, 0.068).addScaledVector(this.U, 0.034); // 쥔 손 안쪽 중심
    this.palmC = J[0].clone().lerp(J[9], 0.5).addScaledVector(this.U, 0.01);

    let geo = GEO[side];
    const fresh = !geo;
    if (fresh) geo = asset.geo.clone();
    if (fresh && mx < 0) {
      for (const k of ['position', 'normal']) { const a = geo.attributes[k]; for (let i = 0; i < a.count; i++) a.setX(i, -a.getX(i)); }
      const ix = geo.index.array;
      for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    }
    // 손가락 굽힘 축
    this.fingerAxis = CHAINS.map(c => new V().crossVectors(_a.subVectors(J[c[1]], J[c[0]]).normalize(), this.U).normalize());
    if (fresh) { this.computeWeights(geo); GEO[side] = geo; }
    this.Hb = new V().crossVectors(_a.subVectors(S, E), _b.subVectors(W, E)).normalize();
    this.invU = hingeFrame(new THREE.Matrix4(), S, new V().subVectors(S, E).normalize(), this.Hb).invert();
    this.invF = hingeFrame(new THREE.Matrix4(), E, new V().subVectors(E, W).normalize(), this.Hb).invert();
    this.prevH = this.Hb.clone();

    this.bones = [];
    for (let i = 0; i < 18; i++) { const b = new THREE.Bone(); b.matrixAutoUpdate = false; this.bones.push(b); }
    this.skeleton = new THREE.Skeleton(this.bones, this.bones.map(() => new THREE.Matrix4()));
    this.mesh = new THREE.SkinnedMesh(geo, material);
    this.mesh.bind(this.skeleton, new THREE.Matrix4());
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mat = this.bones.map(b => b.matrixWorld);
    // 내부(뼈·근육) 를 붙일 객체: 뼈 행렬을 그대로 쓴다
    this.objs = this.bones.map(() => { const o = new THREE.Object3D(); o.matrixAutoUpdate = false; return o; });
    this.curl = CHAINS.map(() => [0.15, 0.2, 0.15]);
    this.handOverride = null;
  }

  computeWeights(geo) {
    const J = this.J, S = this.S, E = this.E, W = this.W;
    const pos = geo.attributes.position, n = pos.count;
    const nE = new V().subVectors(W, E).normalize().sub(new V().subVectors(S, E).normalize()).normalize();
    const fd = new V().subVectors(W, E).normalize();
    const segs = [];
    CHAINS.forEach((c, f) => { for (let k = 0; k < 3; k++) { const a = J[c[k]], b = J[c[k + 1]], d = new V().subVectors(b, a); segs.push({ f, k, a, d, l2: d.lengthSq(), dir: d.clone().normalize() }); } });
    const jn = CHAINS.map((c, f) => [1, 2].map(k => segs[f * 3 + k - 1].dir.clone().add(segs[f * 3 + k].dir).normalize()));
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const v = new V(), q = new V();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i);
      const wf = sstep(-0.035, 0.035, q.subVectors(v, E).dot(nE));
      const wh = sstep(-0.012, 0.014, q.subVectors(v, W).dot(fd));
      const w = [[0, 1 - wf], [1, wf * (1 - wh)]];
      if (wf * wh > 0) {
        let best = 1e9, bf = -1;
        for (const s of segs) {
          const t = Math.min(1, Math.max(0, q.subVectors(v, s.a).dot(s.d) / s.l2));
          const d = q.copy(s.a).addScaledVector(s.d, t).distanceTo(v);
          if (d < best) { best = d; bf = s.f; }
        }
        const c = CHAINS[bf], s0 = segs[bf * 3];
        let m = bf === 0 ? sstep(-0.004, 0.012, q.subVectors(v, J[c[0]]).dot(s0.dir)) : sstep(-0.006, 0.004, q.subVectors(v, J[c[0]]).dot(s0.dir));
        m *= 1 - sstep(0.016, 0.024, best);
        const b1 = sstep(-0.004, 0.004, q.subVectors(v, J[c[1]]).dot(jn[bf][0]));
        const b2 = sstep(-0.003, 0.003, q.subVectors(v, J[c[2]]).dot(jn[bf][1]));
        const base = wf * wh;
        w.push([2, base * (1 - m)], [3 + bf * 3, base * m * (1 - b1)], [4 + bf * 3, base * m * b1 * (1 - b2)], [5 + bf * 3, base * m * b1 * b2]);
      }
      w.sort((a, b) => b[1] - a[1]);
      let tot = 0; for (let k = 0; k < 4 && k < w.length; k++) tot += w[k][1];
      for (let k = 0; k < 4; k++) { const e = w[k]; si[i * 4 + k] = e ? e[0] : 0; sw[i * 4 + k] = e ? e[1] / tot : 0; }
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }

  // 손 행렬(바인드→월드): 손바닥 방향 F(손목→손가락 뿌리), U(손바닥이 보는 쪽), 쥔 점 grip
  handMatrix(out, Fw, Uw, grip) {
    const F = _a.copy(Fw).normalize(), U = _b.copy(Uw); U.addScaledVector(F, -U.dot(F)).normalize();
    const L = _c.crossVectors(U, F).multiplyScalar(this.chir);
    _m.makeBasis(F, L, new V().crossVectors(F, L));
    const Lb = this.L, Fb = this.F;
    _m2.makeBasis(Fb, Lb, new V().crossVectors(Fb, Lb)).invert();
    out.multiplyMatrices(_m, _m2);
    const g = new V().copy(this.G).applyMatrix4(out);
    out.setPosition(out.elements[12] + grip.x - g.x, out.elements[13] + grip.y - g.y, out.elements[14] + grip.z - g.z);
    return out;
  }
  wristOf(handMat, out) { return out.copy(this.W).applyMatrix4(handMat); }

  update(sh, el, ha) {
    if (this.handOverride) ha = _w.copy(this.W).applyMatrix4(this.handOverride);
    const H = _a.crossVectors(_b.subVectors(sh, el), _c.subVectors(ha, el));
    const len = H.length();
    if (len < 0.004) H.copy(this.prevH); else { H.divideScalar(len); this.prevH.lerp(H, 1).normalize(); }
    const M = this.mat;
    hingeFrame(M[0], sh, _b.subVectors(sh, el).normalize(), H).multiply(this.invU);
    hingeFrame(M[1], el, _b.subVectors(el, ha).normalize(), H).multiply(this.invF);
    if (this.handOverride) M[2].copy(this.handOverride); else M[2].copy(M[1]);
    CHAINS.forEach((c, f) => {
      let P = M[2];
      for (let k = 0; k < 3; k++) {
        const j = this.J[c[k]], out = M[3 + f * 3 + k];
        _q.setFromAxisAngle(this.fingerAxis[f], this.curl[f][k]);
        _m.makeTranslation(j.x, j.y, j.z).multiply(_m2.makeRotationFromQuaternion(_q)).multiply(new THREE.Matrix4().makeTranslation(-j.x, -j.y, -j.z));
        out.multiplyMatrices(P, _m);
        P = out;
      }
    });
    for (let i = 0; i < 18; i++) { this.objs[i].matrix.copy(M[i]); this.objs[i].matrixWorld.copy(M[i]); }
  }
}
