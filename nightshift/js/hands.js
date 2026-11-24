// 1인칭 내 손·팔: 실제 사람 팔 조각 모델(CC BY 4.0) + 긴팔 티셔츠 소매 + 편의점 조끼(명찰)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { canvasTex } from './store.js';

// 모델(왼팔) 관절 위치 (handvr/js/hand-rig.js 와 같은 값)
const J = {
  wrist: [0.0457, 0.1688, 0.1484], mid: [0.0696, 0.1227, 0.2474], idx: [0.0561, 0.1520, 0.2634], pinky: [0.0697, 0.0837, 0.1970],
  elbow: [0.0295, 0.3395, -0.0790], shoulder: [-0.0250, 0.5740, -0.2940],
};
const V = (a, mx = 1) => new THREE.Vector3(a[0] * mx, a[1], a[2]);
const FONT = '"Apple SD Gothic Neo","Noto Sans KR",sans-serif';

function basis(f, a) { // f: 손가락 방향, a: 새끼→검지 방향
  const F = f.clone().normalize(), A = a.clone().addScaledVector(F, -a.dot(F)).normalize(), U = new THREE.Vector3().crossVectors(F, A);
  return new THREE.Matrix4().makeBasis(A, U, F);
}

export async function buildHands(camera, yawObj, name) {
  const L = new GLTFLoader(), T = new THREE.TextureLoader();
  const [gltf, map, nrm, orm] = await Promise.all([L.loadAsync('assets/models/arm.glb'), T.loadAsync('assets/models/arm-color.jpg'), T.loadAsync('assets/models/arm-normal.jpg'), T.loadAsync('assets/models/arm-orm.jpg')]);
  map.colorSpace = THREE.SRGBColorSpace;
  let geo; gltf.scene.traverse(o => { if (o.isMesh) geo = o.geometry; });
  const skin = new THREE.MeshStandardMaterial({ map, normalMap: nrm, roughnessMap: orm, aoMap: orm, roughness: 0.75, envMapIntensity: 0.5, color: 0xfff1ea });
  const cloth = canvasTex('cloth', 128, 128, (g, w, h) => { g.fillStyle = '#26324a'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.03})`; g.fillRect(0, y, w, 1); } });
  cloth.repeat.set(3, 3);
  const mSleeve = new THREE.MeshStandardMaterial({ map: cloth, roughness: 0.95, envMapIntensity: 0.3 });
  const mCuff = new THREE.MeshStandardMaterial({ color: 0x1d273a, roughness: 0.95 });

  const make = (side) => {
    const mx = side === 'R' ? -1 : 1;
    const wrist = V(J.wrist, mx), mid = V(J.mid, mx), palm = wrist.clone().lerp(mid, 0.55);
    const model = new THREE.Group();
    const mesh = new THREE.Mesh(geo, skin); mesh.scale.x = mx; model.add(mesh);
    // 소매: 어깨→팔꿈치, 팔꿈치→손목 6cm 앞
    const sh = V(J.shoulder, mx), el = V(J.elbow, mx), cuffP = el.clone().lerp(wrist, 0.8);
    const tube = (a, b, r0, r1, mat) => { const d = b.clone().sub(a), len = d.length(); const g = new THREE.CylinderGeometry(r1, r0, len, 16, 1, true); const m = new THREE.Mesh(g, mat); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); m.material.side = THREE.DoubleSide; model.add(m); return m; };
    tube(sh, el, 0.068, 0.058, mSleeve); tube(el, cuffP, 0.058, 0.047, mSleeve);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.058, 14, 10), mSleeve); ball.position.copy(el); model.add(ball);
    tube(cuffP.clone().lerp(el, 0.08), cuffP, 0.049, 0.048, mCuff);
    model.position.copy(palm).multiplyScalar(-1);
    const pivot = new THREE.Group(); pivot.add(model);
    const holder = new THREE.Group(); holder.position.set(0, -0.035, 0.0); pivot.add(holder); // 손바닥 아래 물건 놓는 곳
    // 모델 손 방향 → 원하는 방향
    const fM = mid.clone().sub(wrist), aM = V(J.idx, mx).sub(V(J.pinky, mx));
    const inv = basis(fM, aM).invert();
    const pose = (f, a) => new THREE.Quaternion().setFromRotationMatrix(basis(f, a).multiply(inv));
    const s = side === 'R' ? 1 : -1;
    const rest = { pos: new THREE.Vector3(0.23 * s, -0.27, -0.44), q: pose(new THREE.Vector3(-0.35 * s, 0.25, -1), new THREE.Vector3(-s, -0.45, 0.1)) };
    const reach = pose(new THREE.Vector3(-0.15 * s, -0.55, -1), new THREE.Vector3(-s, -0.1, 0));
    const give = pose(new THREE.Vector3(-0.1 * s, 0.05, -1), new THREE.Vector3(-s * 0.3, -1, 0)); // 손바닥 위로
    pivot.position.copy(rest.pos); pivot.quaternion.copy(rest.q);
    camera.add(pivot);
    return { side, pivot, holder, rest, reach, give, tPos: rest.pos.clone(), tQ: rest.q.clone(), held: null, busy: false };
  };
  const hands = { R: make('R'), L: make('L') };

  // 몸통 + 조끼 (아래 보면 보임)
  const body = new THREE.Group(); yawObj.add(body);
  const vestTex = canvasTex('vest', 512, 512, (g, w, h) => {
    g.fillStyle = '#0f8f7a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.fillStyle = '#ff7a2e'; g.fillRect(0, h * 0.62, w, 26); g.fillStyle = '#fff'; g.fillRect(0, h * 0.62 + 26, w, 8);
    g.fillStyle = '#c9ccd1'; g.fillRect(w / 2 - 5, 0, 10, h); // 지퍼
    g.fillStyle = '#fff'; g.font = `900 40px ${FONT}`; g.fillText('NIGHT', w * 0.56, h * 0.3); g.fillStyle = '#ff9a4a'; g.fillText('24', w * 0.56 + 130, h * 0.3);
  });
  const mVest = new THREE.MeshStandardMaterial({ map: vestTex, roughness: 0.8 });
  const mShirt = new THREE.MeshStandardMaterial({ map: cloth, roughness: 0.95 });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.62, 20, 1, false, -Math.PI * 0.62, Math.PI * 1.24), mVest);
  torso.scale.set(1, 1, 0.62); torso.position.set(0, -0.62, 0.06); torso.rotation.y = Math.PI; body.add(torso);
  const under = new THREE.Mesh(new THREE.CylinderGeometry(0.195, 0.165, 0.62, 20), mShirt); under.scale.set(1, 1, 0.6); under.position.set(0, -0.62, 0.07); body.add(under);
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.03), new THREE.MeshStandardMaterial({ roughness: 0.3 }));
  tag.position.set(-0.08, -0.43, -0.065); tag.rotation.set(-0.2, Math.PI, 0); tag.rotation.y = 0; tag.rotation.x = -0.25; body.add(tag);
  const setName = (n) => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 96); g.fillStyle = '#0f8f7a'; g.fillRect(0, 0, 256, 22); g.fillStyle = '#fff'; g.font = `800 16px ${FONT}`; g.fillText('NIGHT24  STAFF', 10, 17);
    g.fillStyle = '#111'; g.font = `900 46px ${FONT}`; g.textAlign = 'center'; g.fillText(n, 128, 78);
    tag.material.map?.dispose(); tag.material.map = new THREE.CanvasTexture(c); tag.material.map.colorSpace = THREE.SRGBColorSpace; tag.material.needsUpdate = true;
  };
  setName(name);

  const tmp = new THREE.Vector3();
  const api = {
    hands, body, setName,
    // 월드 좌표 p 로 손 뻗기 → 도착하면 resolve
    reachTo(side, p, kind = 'reach', hold = 0.25) {
      const h = hands[side]; h.busy = true;
      tmp.copy(p); camera.worldToLocal(tmp);
      h.tPos.copy(tmp).add(new THREE.Vector3(0, 0.05, 0.03)); h.tQ.copy(kind === 'give' ? h.give : h.reach);
      return new Promise(r => setTimeout(() => r(), 260 + hold * 0));
    },
    rest(side) { const h = hands[side]; h.tPos.copy(h.rest.pos); h.tQ.copy(h.rest.q); h.busy = false; },
    hold(side, obj) { const h = hands[side]; if (h.held) h.held.removeFromParent(); h.held = obj; if (obj) { obj.position.set(0, -0.02, 0); obj.rotation.set(0, 0, 0); h.holder.add(obj); } },
    update(dt, t) {
      for (const h of Object.values(hands)) {
        const k = 1 - Math.exp(-dt * 11);
        const bob = h.busy ? 0 : Math.sin(t * 1.6 + (h.side === 'R' ? 0 : 1.3)) * 0.004;
        h.pivot.position.lerp(tmp.copy(h.tPos).setY(h.tPos.y + bob), k);
        h.pivot.quaternion.slerp(h.tQ, k);
      }
    },
  };
  return api;
}
