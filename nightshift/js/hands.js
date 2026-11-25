// 1인칭 내 손·팔: 실제 사람 손 모델 + 손가락 뼈 25개(handvr 리그)로 손가락 마디마다 따로 굽힌다.
// 평소엔 화면 아래로 내려가 있다가, 물건을 집거나 돈을 넣을 때만 올라온다. 팔은 긴팔 티셔츠 소매.
import * as THREE from 'three';
import { loadHandRigs, setSkinTone } from './rig/hand-rig.js';
import { canvasTex, drawBrand } from './store.js';

const FONT = '"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const FN = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
// 21개 관절 순서 → 뼈 이름
const J_NAMES = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  ...FN.slice(1).flatMap(n => [`${n}-phalanx-proximal`, `${n}-phalanx-intermediate`, `${n}-phalanx-distal`, `${n}-tip`])];

// 손 모양: 손가락별 [뿌리, 둘째, 끝마디] 추가 굽힘(도) + 벌림, 엄지 [굽힘1, 굽힘2, 손바닥 쪽으로 모으기 0~1]
export const POSES = {
  relax: { f: [[14, 20, 10], [16, 24, 12], [18, 26, 14], [22, 30, 16]], spread: 0, thumb: [10, 8, 0.15] },
  open: { f: [[2, 4, 2], [2, 4, 2], [2, 4, 2], [3, 5, 3]], spread: 4, thumb: [0, 0, 0] },
  grip: { f: [[42, 58, 30], [46, 62, 34], [50, 66, 36], [54, 70, 40]], spread: -3, thumb: [22, 22, 0.55] },
  pinch: { f: [[34, 36, 14], [42, 58, 34], [52, 72, 44], [58, 78, 50]], spread: -2, thumb: [18, 16, 0.5] },
  point: { f: [[2, 6, 2], [72, 92, 58], [78, 96, 60], [80, 96, 60]], spread: 0, thumb: [28, 30, 0.6] },
  trigger: { f: [[24, 30, 12], [58, 72, 44], [62, 74, 46], [66, 76, 48]], spread: -3, thumb: [16, 14, 0.7] },
  support: { f: [[48, 56, 30], [52, 60, 32], [55, 62, 34], [58, 64, 36]], spread: -2, thumb: [8, 6, 0.35] },
  fist: { f: [[80, 100, 70], [84, 104, 72], [86, 104, 72], [88, 104, 72]], spread: -4, thumb: [34, 40, 0.75] },
};

export async function buildHands(camera, yawObj, name) {
  const rigs = await loadHandRigs();
  setSkinTone('asian');
  const cloth = canvasTex('cloth', 256, 256, (g, w, h) => {
    g.fillStyle = '#28344c'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(255,255,255,${0.025 + Math.random() * 0.03})`; g.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 3) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; g.fillRect(x, 0, 1, h); }
  });
  // 천 주름 (범프맵): 팔 방향으로 늘어진 굵은 주름 + 잔주름
  const wrinkle = canvasTex('wrinkle', 256, 256, (g, w, h) => {
    const id = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = 128 + 50 * Math.sin(y * 0.09 + Math.sin(x * 0.05) * 2.2) * Math.sin(x * 0.024 + 1) + 22 * Math.sin(y * 0.31 + x * 0.07) + (Math.random() - 0.5) * 18;
      const i = (y * w + x) * 4; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
  }, false);
  cloth.repeat.set(2, 3); wrinkle.repeat.set(1, 2);
  const mSleeve = new THREE.MeshStandardMaterial({ map: cloth, bumpMap: wrinkle, bumpScale: 3, roughness: 0.95, envMapIntensity: 0.3 });
  const mCuff = new THREE.MeshStandardMaterial({ color: 0x1d273a, roughness: 0.95, bumpMap: wrinkle, bumpScale: 1 });
  const unitTube = (r0, r1) => new THREE.CylinderGeometry(r1, r0, 1, 20, 1, true).translate(0, 0.5, 0);

  // 리그 팔 메시에서 어깨·위팔 맨살 부분을 잘라낸다 (그 자리는 소매가 덮음)
  for (const r of Object.values(rigs)) {
    const g = r.mesh.geometry, pos = g.attributes.position, S = r.bindP.upperarm, E = r.bindP.forearm, se = E.clone().sub(S), l2 = se.lengthSq(), v = V();
    const ok = i => v.fromBufferAttribute(pos, i).sub(S).dot(se) / l2 > 0.6;
    const idx = g.index.array, keep = [];
    for (let i = 0; i < idx.length; i += 3) if (ok(idx[i]) && ok(idx[i + 1]) && ok(idx[i + 2])) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    g.setIndex(keep);
  }
  const make = (side) => {
    const rig = rigs[side], s = side === 'R' ? 1 : -1;
    camera.add(rig.group);
    // 소매 (팔 뼈를 따라감): 어깨→팔꿈치, 팔꿈치→손목 6cm 앞, 소맷부리
    const upper = new THREE.Mesh(unitTube(0.072, 0.064), mSleeve), fore = new THREE.Mesh(unitTube(0.062, 0.05), mSleeve), cuff = new THREE.Mesh(unitTube(0.052, 0.051), mCuff);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.064, 16, 12), mSleeve);
    for (const m of [upper, fore, cuff, elbow]) { m.material.side = THREE.DoubleSide; m.visible = false; camera.add(m); }
    const local = J_NAMES.map(n => rig.bindP[n].clone());
    const J = J_NAMES.map(() => V());
    const h = {
      side, s, rig, local, J, sleeves: { upper, fore, cuff, elbow },
      pos: V(0.22 * s, -0.75, -0.3), F: V(-0.2 * s, 0.3, -1).normalize(), up: V(0, 1, 0),
      tPos: V(0.22 * s, -0.75, -0.3), tF: V(-0.2 * s, 0.3, -1).normalize(), tUp: V(0, 1, 0), palmUp: false,
      cur: structuredClone(POSES.relax), target: 'relax', shown: 0, want: false, held: null, holdMode: 'palm',
      holder: new THREE.Group(),
    };
    camera.add(h.holder);
    return h;
  };
  const hands = { R: make('R'), L: make('L') };

  // ── 몸통 + 편의점 조끼 (아래 보면 보임) ──
  const body = new THREE.Group(); yawObj.add(body);
  const vestTex = canvasTex('vest', 1024, 1024, (g, w, h) => {
    g.fillStyle = '#1f2d4a'; g.fillRect(0, 0, w, h);                       // 남색 조끼
    for (let y = 0; y < h; y += 3) for (let x = (y / 3) % 2 ? 0 : 1.5; x < w; x += 3) { g.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.025})`; g.fillRect(x, y, 1.5, 1.5); } // 원단 짜임
    g.fillStyle = '#ffc53d'; g.fillRect(0, h * 0.6, w, 30); g.fillStyle = '#2fd3b4'; g.fillRect(0, h * 0.6 + 30, w, 10); // 반사띠
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 3; g.setLineDash([10, 7]);           // 박음질
    g.strokeRect(w * 0.08, h * 0.7, w * 0.3, h * 0.18); g.strokeRect(w * 0.62, h * 0.7, w * 0.3, h * 0.18); // 주머니
    g.setLineDash([]); g.fillStyle = '#9aa3ad'; g.fillRect(w / 2 - 7, 0, 14, h);           // 지퍼
    for (let y = 0; y < h; y += 8) { g.fillStyle = '#d8dde2'; g.fillRect(w / 2 - 9 + (y / 8 % 2) * 9, y, 9, 4); }
    drawBrand(g, w * 0.6, h * 0.22, 64, true);                                             // 가슴 로고 자수
  });
  const vestBump = canvasTex('vestbump', 512, 512, (g, w, h) => {
    const id = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = 128 + 35 * Math.sin(x * 0.045 + Math.sin(y * 0.03) * 3) * Math.sin(y * 0.02) + ((x + y) % 4 < 2 ? 6 : -6) + (Math.random() - 0.5) * 10;
      const i = (y * w + x) * 4; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
  }, false);
  const mVest = new THREE.MeshStandardMaterial({ map: vestTex, bumpMap: vestBump, bumpScale: 2.5, roughness: 0.75 });
  const mShirt = new THREE.MeshStandardMaterial({ map: cloth, bumpMap: wrinkle, bumpScale: 2, roughness: 0.95 });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.175, 0.64, 32, 1, true, -Math.PI * 0.64, Math.PI * 1.28), mVest);
  torso.scale.set(1, 1, 0.62); torso.position.set(0, -0.72, 0.06); torso.rotation.y = Math.PI; body.add(torso);
  // 어깨·가슴 윗부분 (둥글게) — 아래를 내려다보면 보임
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.205, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), mVest);
  chest.scale.set(1, 0.42, 0.62); chest.position.set(0, -0.4, 0.06); chest.rotation.y = Math.PI; body.add(chest);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 16), mShirt); neck.position.set(0, -0.33, 0.07); body.add(neck);
  const under = new THREE.Mesh(new THREE.CylinderGeometry(0.195, 0.165, 0.64, 24), mShirt); under.scale.set(1, 1, 0.6); under.position.set(0, -0.72, 0.07); body.add(under);
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.032), new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.1 }));
  tag.position.set(-0.085, -0.47, -0.07); tag.rotation.set(0.25, Math.PI, 0); body.add(tag);
  const setName = (n) => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 120; const g = c.getContext('2d');
    g.fillStyle = '#f7f7f4'; g.fillRect(0, 0, 320, 120); g.fillStyle = '#1f2d4a'; g.fillRect(0, 0, 320, 30);
    drawBrand(g, 10, 6, 20, false); g.fillStyle = '#ffd36b'; g.font = `800 15px ${FONT}`; g.textAlign = 'right'; g.fillText('STAFF', 308, 22);
    g.fillStyle = '#111'; g.font = `900 56px ${FONT}`; g.textAlign = 'center'; g.fillText(n, 160, 98);
    tag.material.map?.dispose(); tag.material.map = new THREE.CanvasTexture(c); tag.material.map.colorSpace = THREE.SRGBColorSpace; tag.material.needsUpdate = true;
  };
  setName(name);

  const tmp = V(), tq = new THREE.Quaternion(), camQ = new THREE.Quaternion();
  const lerpPose = (cur, tgt, k) => {
    cur.f.forEach((a, i) => a.forEach((v, j) => (a[j] = v + (tgt.f[i][j] - v) * k)));
    cur.spread += (tgt.spread - cur.spread) * k; cur.thumb.forEach((v, j) => (cur.thumb[j] = v + (tgt.thumb[j] - v) * k));
  };
  // 손 모양(굽힘값) → 리그가 쓰는 관절 각도
  const toRigPose = (rig, cur) => {
    const A0 = rig.bindAng, out = { fingers: [null], thumb: null };
    for (let f = 1; f < 5; f++) { const b = A0.fingers[f], c = cur.f[f - 1]; out.fingers[f] = { a: b.a + cur.spread * (f - 2.5) * 0.6, m: b.m + c[0], p: b.p + c[1], d: b.d + c[2] }; }
    const t = A0.thumb, dir = t.dir.clone().lerp(V(0.55, 0.35 * (rig.side === 'R' ? 1 : 1), -0.75), cur.thumb[2] * 0.6).normalize();
    out.thumb = { dir, t1: t.t1 + cur.thumb[0], t2: t.t2 + cur.thumb[1] };
    return out;
  };
  const tube = (m, a, b) => { tmp.subVectors(b, a); const len = tmp.length(); m.position.copy(a); m.quaternion.setFromUnitVectors(V(0, 1, 0), tmp.normalize()); m.scale.set(1, len, 1); };
  const wp = (rig, n) => camera.worldToLocal(rig.bone[n].getWorldPosition(V()));

  const api = {
    hands, body, setName, enabled: true,
    // 수감되면 수용복(회청색 상의, 조끼·명찰 없음) / 풀려나면 원래대로
    prison(on) { mSleeve.color.setHex(on ? 0x8a9db0 : 0xffffff); mShirt.color.setHex(on ? 0x8a9db0 : 0xffffff); torso.visible = chest.visible = tag.visible = !on; },
    sideOf(p) { tmp.copy(p); camera.worldToLocal(tmp); return tmp.x > -0.03 ? 'R' : 'L'; },
    // 월드 좌표 p 로 손 뻗기. pose: 손 모양, kind: 'down'(손바닥 아래) | 'up'(손바닥 위, 건네기) | 'front'(누르기)
    reachTo(side, p, pose = 'open', kind = 'down', ms = 380) {
      const h = hands[side]; h.fast = false; h.want = true; h.target = pose;
      camera.getWorldQuaternion(camQ).invert();
      const up = V(0, 1, 0).applyQuaternion(camQ);
      tmp.copy(p); if (kind === 'down') tmp.addScaledVector(V(0, 1, 0), 0.07); camera.worldToLocal(tmp);
      const sh = V(0.2 * h.s, -0.35, 0.05), F = tmp.clone().sub(sh).normalize();
      if (kind === 'down') F.addScaledVector(up, -0.6).normalize();
      if (kind === 'front') F.addScaledVector(up, -0.2).normalize();
      h.tF.copy(F); h.tUp.copy(up); h.palmUp = kind === 'up';
      // 손목은 손바닥 중심이 목표에 오도록 손가락 방향 반대로 8cm
      h.tPos.copy(tmp).addScaledVector(F, -0.08);
      return new Promise(r => setTimeout(r, ms));
    },
    pose(side, pose) { hands[side].target = pose; },
    // 총 쥐기: 카메라 기준 손목 위치·손가락 방향(F)·손등 방향(up)을 매 프레임 지정 (총에 딱 붙어 따라감)
    place(side, pos, F, up, pose) { const h = hands[side]; h.want = true; h.target = pose; h.fast = true; h.tPos.copy(pos); h.tF.copy(F).normalize(); h.tUp.copy(up).addScaledVector(h.tF, -up.dot(h.tF)).normalize(); h.palmUp = false; },
    // 카메라 기준 고정 위치로 손 올리기 (총 들기, 손 들기)
    raise(side, posCam, pose = 'grip') { const h = hands[side]; h.fast = false; h.want = true; h.target = pose; h.tPos.copy(posCam); h.tF.set(-0.05 * h.s, posCam.y > 0 ? 1 : 0.05, -1).normalize(); h.tUp.set(0, 1, 0); h.palmUp = false; },
    rest(side) { const h = hands[side]; h.fast = false; h.want = false; h.target = 'relax'; h.tPos.set(0.22 * h.s, -0.78, -0.25); h.tF.set(-0.2 * h.s, 0.4, -1).normalize(); h.palmUp = false; },
    // 물건 쥐기: mode 'palm'(손바닥 아래 쥐기) | 'pinch'(엄지·검지 사이)
    hold(side, obj, mode = 'palm') {
      const h = hands[side]; if (h.held && h.held !== obj) h.held.removeFromParent();
      h.held = obj; h.holdMode = mode;
      if (obj) { h.holder.add(obj); obj.position.set(0, 0, 0); obj.rotation.set(0, 0, 0); }
    },
    update(dt, t) {
      for (const h of Object.values(hands)) {
        const k = h.fast ? 1 : 1 - Math.exp(-dt * 9);
        h.pos.lerp(h.tPos, k); h.F.lerp(h.tF, k).normalize(); h.up.lerp(h.tUp, k).normalize();
        lerpPose(h.cur, POSES[h.target] || POSES.relax, 1 - Math.exp(-dt * 12));
        h.shown = h.want ? 1 : (h.pos.y < -0.62 ? 0 : 1);
        const vis = h.shown > 0 && api.enabled;
        // 손바닥 좌표: F = 손가락 방향, L = 새끼→검지 방향 (오른손 손바닥이 아래면 왼쪽)
        const L = V().crossVectors(h.up, h.F).multiplyScalar(h.s).normalize(); if (h.palmUp) L.negate();
        const W = h.pos.clone().add(V(0, Math.sin(t * 1.7 + h.s) * 0.003, 0));
        h.J[0].copy(W); h.J[9].copy(W).addScaledVector(h.F, 0.09);
        h.J[5].copy(h.J[9]).addScaledVector(L, 0.022); h.J[17].copy(h.J[9]).addScaledVector(L, -0.03);
        h.rig.update(h.J, h.local, toRigPose(h.rig, h.cur), null, dt, null, vis);
        const sl = h.sleeves;
        for (const m of Object.values(sl)) m.visible = vis;
        if (vis) {
          const S = wp(h.rig, 'upperarm'), E = wp(h.rig, 'forearm'), Wr = wp(h.rig, 'wrist');
          const cuffEnd = Wr.clone().lerp(E, 0.24), cuffStart = Wr.clone().lerp(E, 0.3);
          tube(sl.upper, S.clone().lerp(E, -0.6), E); tube(sl.fore, E, cuffEnd); tube(sl.cuff, cuffStart, cuffEnd.clone().lerp(Wr, 0.02)); sl.elbow.position.copy(E);
          // 쥔 물건 위치
          if (h.held) {
            // 손바닥 방향: 손목·검지뿌리·새끼뿌리 평면의 법선 중 손가락 끝이 굽는 쪽
            const I = wp(h.rig, 'index-finger-phalanx-proximal'), P = wp(h.rig, 'pinky-finger-phalanx-proximal'), Mt = wp(h.rig, 'middle-finger-tip'), Mm = wp(h.rig, 'middle-finger-phalanx-proximal');
            const n = V().crossVectors(I.clone().sub(Wr), P.clone().sub(Wr)).normalize(); if (Mt.clone().sub(Wr).dot(n) < 0) n.negate();
            const across = I.clone().sub(P).normalize(), fwd = Mm.clone().sub(Wr).normalize();
            if (h.holdMode === 'pinch') { const a = wp(h.rig, 'thumb-tip'), b = wp(h.rig, 'index-finger-tip'); h.holder.position.copy(a).lerp(b, 0.5).addScaledVector(n, 0.004); }
            else h.holder.position.copy(Wr).lerp(Mm, 0.75).addScaledVector(n, 0.04);
            const y = across, z = n.clone().addScaledVector(y, -n.dot(y)).normalize(), x = V().crossVectors(y, z);
            h.holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
            if (h.holdMode !== 'pinch') h.holder.position.addScaledVector(y, -0.03);
            void fwd;
          }
        }
        h.holder.visible = vis;
      }
    },
  };
  for (const s of ['R', 'L']) api.rest(s);
  return api;
}
