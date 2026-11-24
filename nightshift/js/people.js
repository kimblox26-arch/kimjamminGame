// 손님·사장님: 실제 사람 3D 모델(스킨+뼈대) + Mixamo 동작(걷기·서있기·끄덕·도리도리)을 뼈 이름으로 옮겨 붙임
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const base = {};
const pick = a => a[Math.floor(Math.random() * a.length)];
export async function loadPeople(onProgress) {
  const L = new GLTFLoader(); let n = 0;
  const get = async (k, f) => { base[k] = await L.loadAsync('assets/models/' + f); onProgress?.(++n / 3); };
  await Promise.all([get('man', 'man.glb'), get('woman', 'Michelle.glb'), get('anim', 'anims.glb')]);
  // 동작 옮기기: 뼈마다 '기본자세 대비 월드 회전 변화'를 대상 모델 뼈에 그대로 적용 (모델마다 뼈 축이 달라도 맞게)
  base.clips = { man: {}, woman: {} };
  for (const k of ['man', 'woman']) for (const clip of base.anim.animations) base.clips[k][clip.name] = retarget(base.anim.scene, base[k].scene, clip);
  // 정면 방향 맞추기 위해 기본 자세 정보
  for (const k of ['man', 'woman']) base[k].scene.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const strip = n => n.replace('mixamorig', '');
function retarget(srcScene, tgtScene, clip) {
  srcScene.updateMatrixWorld(true); tgtScene.updateMatrixWorld(true);
  const Q = () => new THREE.Quaternion(), qW = o => o.getWorldQuaternion(Q());
  const srcBy = {}, srcOrder = [], srcRest = new Map(), tgtRest = new Map(), tgtBones = [];
  srcScene.traverse(o => { srcOrder.push(o); srcRest.set(o, qW(o)); if (o.name) srcBy[strip(o.name)] = o; });
  tgtScene.traverse(o => { tgtRest.set(o, qW(o)); if (o.isBone) tgtBones.push(o); });
  // 기본자세 차이(T자/A자) 보정: 대상 뼈가 원본 뼈와 같은 방향을 가리키게 만드는 회전
  const P = o => o.getWorldPosition(new THREE.Vector3());
  const PREF = ['Spine', 'Neck', 'Head', 'Middle1'];
  const mainChild = (o, ok) => { const ch = o.children.filter(c => c.name && ok(c)); return ch.find(c => PREF.some(p => strip(c.name).includes(p))) || ch[0]; };
  const align = new Map();
  for (const b of tgtBones) {
    const src = srcBy[strip(b.name)]; if (!src) continue;
    const ct = mainChild(b, c => c.isBone && srcBy[strip(c.name)]); if (!ct) continue;
    const cs = srcBy[strip(ct.name)];
    const dt = P(ct).sub(P(b)).normalize(), ds = P(cs).sub(P(src)).normalize();
    if (dt.lengthSq() > 0.5 && ds.lengthSq() > 0.5) align.set(b, Q().setFromUnitVectors(dt, ds));
  }
  const interp = {};
  for (const t of clip.tracks) if (t.name.endsWith('.quaternion')) interp[t.name.slice(0, -11)] = t.createInterpolant();
  const hip = clip.tracks.find(t => /Hips\.quaternion$/.test(t.name)) || clip.tracks[0];
  const times = hip.times, out = new Map(tgtBones.map(b => [b, []]));
  for (const t of times) {
    const sW = new Map();
    for (const o of srcOrder) {
      const pw = sW.get(o.parent) || (o.parent ? srcRest.get(o.parent) : Q());
      const loc = interp[o.name] ? Q().fromArray(interp[o.name].evaluate(t)) : o.quaternion;
      sW.set(o, pw.clone().multiply(loc));
    }
    const tW = new Map();
    for (const b of tgtBones) {
      const pw = tW.get(b.parent) || tgtRest.get(b.parent) || Q();
      const src = srcBy[strip(b.name)];
      const rest = align.has(b) ? align.get(b).clone().multiply(tgtRest.get(b)) : tgtRest.get(b);
      const w = src && sW.has(src) ? sW.get(src).clone().multiply(srcRest.get(src).clone().invert()).multiply(rest) : pw.clone().multiply(b.quaternion);
      tW.set(b, w);
      const l = pw.clone().invert().multiply(w); out.get(b).push(l.x, l.y, l.z, l.w);
    }
  }
  const tracks = tgtBones.filter(b => srcBy[strip(b.name)]).map(b => new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, out.get(b)));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
function findBone(root, name) { let b = null; root.traverse(o => { if (!b && o.isBone && o.name.replace('mixamorig', '') === name) b = o; }); return b; }

export class Person {
  constructor(type, audio) {
    this.type = type; this.audio = audio; this.kind = type.model;
    const src = base[this.kind];
    this.model = SkeletonUtils.clone(src.scene);
    this.root = new THREE.Group(); this.root.add(this.model);
    this.morphs = []; this.mats = {};
    this.model.traverse(o => {
      if (!o.isMesh) return;
      if (o.morphTargetDictionary?.mouthOpen !== undefined) this.morphs.push(o);
      const mn = o.material.name;
      o.material = o.material.clone(); this.mats[mn] = o.material;
      if (mn === 'Wolf3D_Headwear') o.visible = !!type.cowboy;
      if (mn === 'Wolf3D_Beard') o.visible = type.id === 'boss' || type.id === 'drunk' || Math.random() < 0.15;
    });
    // 키 맞추기
    this.model.updateMatrixWorld(true);
    const top = findBone(this.model, 'HeadTop_End') || findBone(this.model, 'Head');
    const h0 = top.getWorldPosition(_v).y + 0.02;
    const hj = type.h * (0.97 + Math.random() * 0.06);
    this.model.scale.multiplyScalar(hj / h0);
    this.height = hj;
    // 옷 색
    const tint = (n, c) => { const m = this.mats[n]; if (m && c) m.color.set(c); };
    tint('Wolf3D_Outfit_Top', type.top); tint('Wolf3D_Outfit_Bottom', type.bottom);
    if (this.kind === 'man' && type.id !== 'office' && type.id !== 'boss') for (const n of ['Wolf3D_Outfit_Top', 'Wolf3D_Outfit_Bottom']) { const m = this.mats[n]; if (m) { m.map = null; m.roughness = 0.9; m.metalness = 0; m.needsUpdate = true; } }
    if (type.id === 'drunk') tint('Wolf3D_Skin', '#ffc9b8');
    if (this.kind === 'woman' && this.mats.Ch03_Body) this.mats.Ch03_Body.color.setHSL(Math.random(), 0.12, 0.85 + Math.random() * 0.15);
    this.head = findBone(this.model, 'Head'); this.spine = findBone(this.model, 'Spine2') || findBone(this.model, 'Spine1');
    this.rHand = findBone(this.model, 'RightHand');
    this.accessories(type);
    // 동작
    this.mixer = new THREE.AnimationMixer(this.model);
    this.act = {};
    for (const [k, c] of Object.entries(base.clips[this.kind])) this.act[k] = this.mixer.clipAction(c);
    this.cur = this.act.idle; this.cur.play();
    this.path = []; this.speed = type.id === 'drunk' ? 0.75 : (type.id === 'thief' ? 1.25 : 1.05);
    this.talk = 0; this.stepT = 0; this.t = Math.random() * 10; this.sway = type.id === 'drunk' ? 1 : 0;
    this.face = 0; this.faceTarget = null;
  }
  accessories(type) {
    if (!this.head) return;
    this.head.updateWorldMatrix(true, false);
    // 머리 뼈 축이 모델마다 달라서, 모델 기준(위=+y, 앞=+z, 미터) 좌표계를 머리에 붙인다
    const anchor = new THREE.Object3D(), hq = this.head.getWorldQuaternion(new THREE.Quaternion()), rq = this.root.getWorldQuaternion(new THREE.Quaternion());
    anchor.quaternion.copy(hq.invert().multiply(rq)); anchor.scale.setScalar(1 / this.head.getWorldScale(new THREE.Vector3()).x); this.head.add(anchor);
    const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); anchor.add(mesh); return mesh; };
    const M = (c, r = 0.7, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    const topB = findBone(this.model, 'HeadTop_End'), hw = this.head.getWorldPosition(new THREE.Vector3());
    const ht = topB ? (topB.getWorldPosition(new THREE.Vector3()).y - hw.y) : 0.2; // 머리뼈 → 정수리 높이(m)
    if (type.hat === 'cap') {
      const g = new THREE.Group(); const cm = M(type.top === '#111111' ? '#c02020' : '#1a1a1a');
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), cm); dome.scale.set(1, 0.75, 1.08); g.add(dome);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.01, 18, 1, false, -Math.PI / 2, Math.PI), cm); brim.scale.set(1, 1, 0.9); brim.position.set(0, 0, 0.08); g.add(brim);
      add(g, 0, ht - 0.075, 0.005);
    } else if (type.hat === 'helmet') {
      const g = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), M('#f1f1f1', 0.25, 0.1)); shell.scale.set(1, 0.95, 1.12); g.add(shell);
      const stripe = new THREE.Mesh(new THREE.SphereGeometry(0.127, 6, 10, Math.PI / 2 - 0.15, 0.3, 0, Math.PI * 0.5), M('#1d6bd6', 0.3)); stripe.scale.copy(shell.scale); g.add(stripe);
      add(g, 0, ht - 0.11, -0.01);
    } else if (type.hat === 'beanie') {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.108, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M('#2f3a20', 0.95)); b.scale.set(1, 0.95, 1.06); add(b, 0, ht - 0.095, -0.005);
    } else if (type.hat === 'hood') {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 12, Math.PI * 0.78, Math.PI * 1.44, 0, Math.PI * 0.7), M(type.top || '#222', 0.95)); h.material.side = THREE.DoubleSide; h.scale.set(1.05, 1.1, 1.1); add(h, 0, ht - 0.115, -0.035);
    }
    if (this.kind === 'man' && !type.hat && type.id !== 'boss') { // 머리카락
      const hc = pick(['#1a1410', '#221a14', '#0f0d0c', '#3a2a1e']);
      const hm = new THREE.MeshStandardMaterial({ color: hc, roughness: 0.85 });
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), hm); hair.scale.set(1.03, 0.9, 1.12); hair.rotation.x = -0.25;
      const g = new THREE.Group(); g.add(hair);
      const fr = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 6, Math.PI * 0.12, Math.PI * 0.76, Math.PI * 0.3, Math.PI * 0.12), hm); fr.scale.set(1.04, 1, 1.13); g.add(fr);
      add(g, 0, ht - 0.088, -0.012);
    }
    if (type.id === 'boss') { const sideHair = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.022, 8, 20, Math.PI * 1.1), new THREE.MeshStandardMaterial({ color: '#8d8a86', roughness: 0.9 })); sideHair.rotation.set(Math.PI / 2, 0, Math.PI * 0.95); add(sideHair, 0, ht - 0.1, -0.015); }
    if (type.mask) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 8, -Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.35, Math.PI * 0.35), M('#222', 0.9)); m.scale.set(1.15, 1.1, 1); add(m, 0, ht - 0.175, 0.04); }
    if (type.glasses) {
      const g = new THREE.Group(), fm = M('#111', 0.3, 0.5);
      for (const x of [-0.033, 0.033]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.003, 6, 18), fm); r.position.x = x; g.add(r); }
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.003, 0.003), fm); g.add(br);
      add(g, 0, ht - 0.115, 0.085);
    }
    if (type.bottle && this.rHand) {
      const a = new THREE.Object3D(), hq = this.rHand.getWorldQuaternion(new THREE.Quaternion()), rq = this.root.getWorldQuaternion(new THREE.Quaternion());
      a.quaternion.copy(hq.invert().multiply(rq)); a.scale.setScalar(1 / this.rHand.getWorldScale(new THREE.Vector3()).x); this.rHand.add(a);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.033, 0.22, 12), new THREE.MeshStandardMaterial({ color: '#2e8b3e', roughness: 0.1, transparent: true, opacity: 0.85 }));
      b.position.set(0, -0.07, 0.03); a.add(b);
    }
  }
  play(name, fade = 0.3, once = false) {
    const a = this.act[name]; if (!a || a === this.cur) return;
    a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat); a.clampWhenFinished = once;
    a.enabled = true; a.setEffectiveWeight(1); a.crossFadeFrom(this.cur, fade, false); a.play();
    this.cur = a;
    if (once) setTimeout(() => { if (this.cur === a) this.play(this.path.length ? 'walk' : 'idle', 0.4); }, a.getClip().duration * 1000 - 300);
  }
  gesture(name) { if (!this.path.length) this.play(name, 0.25, true); }
  // 경로 걷기 (점 목록). 도착하면 resolve
  walk(points) { this.path = points.map(p => p.clone()); this.play('walk'); return new Promise(r => (this.onArrive = r)); }
  lookAt(p) { this.faceTarget = p.clone(); }
  update(dt, camPos) {
    this.t += dt; this.mixer.update(dt);
    const r = this.root;
    if (this.path.length) {
      const tgt = this.path[0]; _v.subVectors(tgt, r.position); _v.y = 0; const d = _v.length();
      const want = Math.atan2(_v.x, _v.z); this.face = want;
      const step = this.speed * dt;
      if (d <= step) { r.position.copy(tgt); this.path.shift(); if (!this.path.length) { this.play('idle'); const f = this.onArrive; this.onArrive = null; f?.(); } }
      else r.position.addScaledVector(_v.normalize(), step);
      this.act.walk.timeScale = this.speed / 1.05;
      if ((this.stepT -= dt) <= 0) { this.stepT = 0.52 / this.speed; this.audio.play(Math.random() < 0.5 ? 'step1' : 'step2', { pos: r.position, vol: 0.5, rate: 0.85 + Math.random() * 0.2 }); }
    } else if (this.faceTarget) { _v.subVectors(this.faceTarget, r.position); this.face = Math.atan2(_v.x, _v.z); }
    // 부드럽게 돌기
    let dy = this.face - r.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); r.rotation.y += dy * Math.min(1, dt * 6);
    // 취객 비틀비틀
    if (this.sway) { this.model.rotation.z = Math.sin(this.t * 1.3) * 0.06; this.model.rotation.x = Math.sin(this.t * 0.9) * 0.04; }
    // 말할 때 입 (모프) + 고개
    const mouth = this.talk > 0 ? Math.max(0, Math.sin(this.t * 17) * 0.5 + Math.sin(this.t * 7.3) * 0.4) * 0.8 : 0;
    for (const m of this.morphs) { m.morphTargetInfluences[m.morphTargetDictionary.mouthOpen] = mouth; m.morphTargetInfluences[m.morphTargetDictionary.mouthSmile] = this.smile || 0; }
    if (this.head && camPos && !this.path.length) {
      // 머리를 카메라 쪽으로 살짝 (뼈 회전 덧붙이기)
      this.head.getWorldPosition(_v); const dx = camPos.x - _v.x, dz = camPos.z - _v.z, dyy = camPos.y - _v.y;
      const yaw = Math.atan2(dx, dz) - r.rotation.y, pitch = Math.atan2(dyy, Math.hypot(dx, dz));
      const ya = Math.max(-0.7, Math.min(0.7, Math.atan2(Math.sin(yaw), Math.cos(yaw))));
      _q.setFromEuler(new THREE.Euler(-pitch * 0.6, ya * 0.8, this.talk > 0 ? Math.sin(this.t * 3) * 0.04 : 0, 'YXZ'));
      this.head.quaternion.multiply(_q);
    }
  }
  dispose() { this.root.removeFromParent(); this.mixer.stopAllAction(); }
}
