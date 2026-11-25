// 손님·사장님: 실제 사람 3D 모델(스킨+뼈대) + Mixamo 동작(걷기·서있기·끄덕·도리도리)을 뼈 이름으로 옮겨 붙임
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { hairMesh } from './hair.js';

const base = {};
const PHONE_BODY = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.3, metalness: 0.6 }), PHONE_SCR = new THREE.MeshBasicMaterial({ color: 0x9cc8ff, toneMapped: false });
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

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _ax = new THREE.Vector3(), _ay = new THREE.Vector3(), _az = new THREE.Vector3();
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
    this.rArm = findBone(this.model, 'RightArm'); this.rFore = findBone(this.model, 'RightForeArm');
    const fb = n => findBone(this.model, n);
    this.B = { hips: fb('Hips'), spine: fb('Spine'), spine1: fb('Spine1'), spine2: this.spine, neck: fb('Neck'), head: this.head, top: top,
      L: { arm: fb('LeftArm'), fore: fb('LeftForeArm'), hand: fb('LeftHand'), up: fb('LeftUpLeg'), leg: fb('LeftLeg'), foot: fb('LeftFoot') },
      R: { arm: this.rArm, fore: this.rFore, hand: this.rHand, up: fb('RightUpLeg'), leg: fb('RightLeg'), foot: fb('RightFoot') } };
    this.model.updateMatrixWorld(true);
    this.kneeH = (this.B.L.leg?.getWorldPosition(new THREE.Vector3()).y || this.height * 0.28) - 0.03;
    // 몸 반응 상태: 무릎 꿇기·한쪽 무릎·웅크림·손 들기·빌기(손 비비기)·상처 움켜쥐기
    this.P = { kneel: 0, knee1: 0, hunch: 0, up: 0, beg: 0, clutch: 0, spread: 0, phone: 0, call: 0, cover: 0, mouth: 0, watch: 0 }; this.PT = { ...this.P }; this.fl = []; this.side = 'R'; this.zone = null;
    this.reachW = 0; this.reachT = 0; this.reachP = new THREE.Vector3(); this.lookOff = 0; this.lookT = 2 + Math.random() * 4;
    this.hairs = []; this.hairV = new THREE.Vector2(); this.hairO = new THREE.Vector2(); this.lastHead = null;
    this.accessories(type);
    // 휴대폰 (매 프레임 오른손 손가락 쪽에 놓고 화면이 얼굴을 향하게; 볼 때·통화할 때만 보임)
    { const ph = new THREE.Group(); ph.add(new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.15, 0.008), new THREE.MeshStandardMaterial({ color: pick([0xd9dadf, 0x1d3d6b, 0xe8c8c8, 0xc9b28a, 0x7fa8c9]), roughness: 0.35, metalness: 0.5 })));
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.064, 0.138), PHONE_SCR); sc.position.z = 0.0045; ph.add(sc);
      ph.visible = false; this.root.add(ph); this.phoneObj = ph; this.rMid = findBone(this.model, 'RightHandMiddle1'); }
    this.fidget = false; this.fidT = 4 + Math.random() * 8;
    // 동작
    // 맞추기 판정용 보이지 않는 원기둥
    const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, this.height, 8), new THREE.MeshBasicMaterial()); hb.visible = false; hb.position.y = this.height / 2; hb.userData.personRef = this; this.root.add(hb); this.hitbox = hb;
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
    if (this.kind === 'man') { // 머리카락 (머리결 카드 수백 장)
      const style = type.id === 'boss' ? 'bald' : type.hat ? (type.hat === 'cap' || type.hat === 'police' ? 'sides' : null) : pick(['short', 'short', 'side', 'side', 'buzz']);
      if (style) { const g = hairMesh(style, type.id === 'boss' ? '#8f8b86' : pick(['#16110d', '#1d1712', '#0e0c0b', '#2e2219', '#3a2a1e']), ht); add(g, 0, 0, 0); this.hairs.push(g); }
    }
    if (type.hat === 'police') {
      const g = new THREE.Group(), cm = M('#14213d', 0.6);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.1, 0.09, 20), cm); crown.position.y = 0.045; g.add(crown);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 20, 1, false, -Math.PI / 2, Math.PI), M('#0b0b0b', 0.3)); brim.position.set(0, 0, 0.07); g.add(brim);
      const badge = new THREE.Mesh(new THREE.CircleGeometry(0.022, 12), M('#d4af37', 0.3, 0.8)); badge.position.set(0, 0.05, 0.112); g.add(badge);
      add(g, 0, ht - 0.07, 0.0);
    }
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
  walk(points) { if (this.down || this.dead) return new Promise(() => { }); this.path = points.map(p => p.clone()); if (!this.frozen) this.play(this.speed > 2.2 ? 'run' : 'walk'); return new Promise(r => (this.onArrive = r)); }
  // 총구를 겨누면 그 자리에 멈춰 손 듦 (풀리면 다시 걸음)
  freeze(on) { if (on === !!this.frozen || this.dead) return; this.frozen = on; this.surrender(on); if (!this.down) this.play(on || !this.path.length ? 'idle' : (this.speed > 2.2 ? 'run' : 'walk'), 0.25); }
  // 걷던 걸 잠깐 멈춤 (손은 안 듦) — 놀라서 멈칫, 통화, 시체 발견
  pause(on) { if (this.dead || on === !!this.frozen) return; this.frozen = on; if (!this.down) this.play(on || !this.path.length ? 'idle' : (this.speed > 2.2 ? 'run' : 'walk'), 0.2); }
  lookAt(p) { this.faceTarget = p.clone(); }
  // 맞은 부위별 움찔: zone = head|chest|stomach|arm|leg, dir = 총알 방향(월드), side = 'L'|'R'
  hurt(zone = 'chest', dir = new THREE.Vector3(0, 0, -1), side = 'R') {
    const d = dir.clone().setY(0).normalize();
    this.fl.push({ zone, side, t: 0, T: zone === 'leg' ? 0.5 : 0.38, axis: new THREE.Vector3(0, 1, 0).cross(d).normalize(), amp: 1 });
    this.zone = zone; this.side = side; this.PT.clutch = zone === 'head' ? 0.6 : 1;
    if (zone === 'chest' || zone === 'stomach') this.PT.hunch = zone === 'stomach' ? 0.9 : 0.5;
  }
  // 다리 맞음 → 한쪽 무릎 꿇고 주저앉음 (못 걸음)
  goDown(side = 'R') { this.down = true; this.side = side; this.path = []; this.PT.knee1 = 1; this.play('idle', 0.3); }
  kneel() { this.down = true; this.path = []; this.PT.kneel = 1; this.PT.knee1 = 0; this.play('idle', 0.3); }
  surrender(on) { this.PT.up = on ? 1 : 0; if (on) this.PT.beg = 0; }
  beg(on) { this.PT.beg = on ? 1 : 0; if (on) { this.PT.up = 0; this.PT.clutch = 0; } }
  // 죽음: 부위·총알 방향에 따라 쓰러지는 방식이 다름
  die({ zone = 'chest', dir = null, side = 'R' } = {}) {
    this.dead = true; this.path = []; this.talk = 0; this.dieT = 0; this.zone = zone; this.side = side;
    const r = this.root, d = (dir ? dir.clone() : r.getWorldDirection(new THREE.Vector3()).negate()).setY(0).normalize();
    const kneeling = this.P.kneel > 0.5 || this.P.knee1 > 0.5;
    // 넘어지는 방향(월드): 머리·가슴 → 총알 방향(뒤로), 배 → 앞으로 고꾸라짐, 다리·팔 → 맞은 쪽 옆으로, 무릎 꿇고 있었으면 앞으로
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(r.quaternion).multiplyScalar(side === 'R' ? -1 : 1);
    let f = zone === 'stomach' || kneeling ? d.clone().negate() : (zone === 'arm' || zone === 'leg') ? right.add(d.clone().multiplyScalar(0.6)).normalize() : d.clone();
    if (zone === 'head' && Math.random() < 0.35) f = d.clone().negate();
    // 진열대·벽 속으로 쓰러지지 않게: 막히면 옆이나 반대쪽으로
    const B0 = Person.blockers || [], blocked = v => { for (let d0 = 0.5; d0 <= 1.6; d0 += 0.35) { const x = r.position.x + v.x * d0, z = r.position.z + v.z * d0; if (B0.some(b => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1)) return true; } return false; };
    if (blocked(f)) { const alt = [f.clone().applyAxisAngle(_ay.set(0, 1, 0), Math.PI / 2), f.clone().applyAxisAngle(_ay.set(0, 1, 0), -Math.PI / 2), f.clone().negate()].find(v => !blocked(v)); if (alt) f = alt; }
    this.fallW = f; this.fallLocal = f.clone().applyQuaternion(r.quaternion.clone().invert()).normalize();
    this.fallAxis = new THREE.Vector3(0, 1, 0).cross(this.fallLocal).normalize();
    this.Ta = zone === 'head' ? 0.08 : zone === 'stomach' ? 0.75 : zone === 'chest' ? 0.42 : 0.3;
    this.Tb = zone === 'head' ? 0.5 : 0.62; this.stagger = zone === 'chest' && !blocked(d) ? d.clone().multiplyScalar(0.5) : null;
    this.fl.push({ zone, side, t: 0, T: 0.3, axis: new THREE.Vector3(0, 1, 0).cross(d).normalize(), amp: zone === 'head' ? 1.6 : 1 });
    Object.assign(this.PT, { up: 0, beg: 0, clutch: zone === 'head' ? 0 : 1, hunch: zone === 'stomach' ? 1 : 0.4, kneel: zone === 'stomach' || zone === 'chest' || kneeling ? 1 : 0.5, knee1: 0 });
    this.spreadSign = Math.random() < 0.5 ? 1 : -1;
  }
  // 차에 치이거나 밀려서 날아감 (속도 벡터, 점점 느려짐)
  knock(v) { this.kv = v.clone(); }
  // 바닥에 누운 위치(피 웅덩이용)
  bodyCenter() { return this.root.position.clone().add(this.fallW ? this.fallW.clone().multiplyScalar(this.height * 0.45) : new THREE.Vector3()); }
  update(dt, camPos) {
    if (this.kv) { this.root.position.addScaledVector(this.kv, dt); this.kv.multiplyScalar(Math.exp(-dt * 3.2)); if (this.kv.lengthSq() < 0.01) this.kv = null; if (this.still) { this.root.updateMatrixWorld(true); return; } }
    if (this.dead) {
      if (this.still) return;
      this.dieT += dt; this.t += dt; const T = this.dieT;
      this.mixer.update(T < this.Ta ? dt * 0.4 : 0);
      // 1단계: 다리 풀림·움켜쥠·비틀거림  2단계: 넘어짐  3단계: 바닥에 튕기고 멈춤
      if (this.stagger && T < this.Ta) this.root.position.addScaledVector(this.stagger, dt / this.Ta);
      let ang = 0, lift = 0;
      if (T >= this.Ta) {
        const k = Math.min(1, (T - this.Ta) / this.Tb), e = k * k * (1.6 - 0.6 * k);
        const bounce = T > this.Ta + this.Tb ? Math.exp(-(T - this.Ta - this.Tb) * 9) * Math.sin((T - this.Ta - this.Tb) * 22) * 0.05 : 0;
        ang = e * Math.PI / 2 * 0.985 - bounce; lift = e;
        Object.assign(this.PT, { kneel: 0, clutch: k > 0.35 ? 0 : this.PT.clutch, hunch: 0.15, spread: k > 0.45 ? 1 : 0 });
        if (T > this.Ta + this.Tb + 0.5) this.stillNext = true;
      }
      this.model.quaternion.setFromAxisAngle(this.fallAxis, ang);
      this.posture(dt * (T >= this.Ta ? 2.2 : 1));
      const kn = Math.max(this.P.kneel, this.P.knee1);
      this.model.position.y = -this.kneeH * kn * (1 - lift) + 0.11 * lift;
      if (this.stillNext) this.still = true;
      return;
    }
    this.t += dt; this.mixer.update(this.frozen ? dt * 0.5 : dt);
    this.posture(dt);
    this.model.position.y = -this.kneeH * Math.max(this.P.kneel, this.P.knee1 * 0.97);
    const r = this.root;
    if (this.path.length && !this.frozen && !this.down) {
      const tgt = this.path[0]; _v.subVectors(tgt, r.position); _v.y = 0; const d = _v.length();
      const want = Math.atan2(_v.x, _v.z); this.face = want;
      const step = this.speed * dt;
      r.position.y += (tgt.y - r.position.y) * Math.min(1, step / Math.max(d, 1e-3));
      // 다른 사람에 밀려 지점에 딱 못 닿아도 도착으로 침 (+ 1.5초 넘게 못 가면 건너뜀)
      this.stuckT = (this.stuckT || 0) + dt; if (d < (this.lastD ?? 1e9) - 0.05) { this.stuckT = 0; this.lastD = d; }
      if (d <= Math.max(step, 0.32) || this.stuckT > 1.5) { this.stuckT = 0; this.lastD = undefined; if (d <= 0.32) r.position.copy(tgt); this.path.shift(); if (!this.path.length) { this.play('idle'); const f = this.onArrive; this.onArrive = null; f?.(); } }
      else r.position.addScaledVector(_v.normalize(), step);
      this.act.walk.timeScale = this.speed / 1.05 * (this.P.clutch > 0.5 ? 0.8 : 1); if (this.act.run) this.act.run.timeScale = Math.max(0.7, this.speed / 3.6);
      if (this.cur === this.act.walk && this.speed > 2.2) this.play('run', 0.2);
      if ((this.stepT -= dt) <= 0) { this.stepT = 0.52 / this.speed; this.audio.play(Math.random() < 0.5 ? 'step1' : 'step2', { pos: r.position, vol: 0.5, rate: 0.85 + Math.random() * 0.2 }); }
    } else if (this.faceTarget) { _v.subVectors(this.faceTarget, r.position); this.face = Math.atan2(_v.x, _v.z); }
    // 부드럽게 돌기
    let dy = this.face - r.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); r.rotation.y += dy * Math.min(1, dt * 6);
    // 취객 비틀비틀
    if (this.sway) { this.model.rotation.z = Math.sin(this.t * 1.3) * 0.06; this.model.rotation.x = Math.sin(this.t * 0.9) * 0.04; }
    // 말할 때 입 (모프) + 고개
    const mouth = this.talk > 0 ? Math.max(0, Math.sin(this.t * 17) * 0.5 + Math.sin(this.t * 7.3) * 0.4) * 0.8 : 0;
    for (const m of this.morphs) { m.morphTargetInfluences[m.morphTargetDictionary.mouthOpen] = mouth; m.morphTargetInfluences[m.morphTargetDictionary.mouthSmile] = this.smile || 0; }
    if (this.head && camPos && (!this.path.length || this.frozen || this.down)) {
      // 머리를 카메라 쪽으로 살짝 (뼈 회전 덧붙이기)
      this.head.getWorldPosition(_v); const dx = camPos.x - _v.x, dz = camPos.z - _v.z, dyy = camPos.y - _v.y;
      const yaw = Math.atan2(dx, dz) - r.rotation.y, pitch = Math.atan2(dyy, Math.hypot(dx, dz));
      const ya = Math.max(-0.7, Math.min(0.7, Math.atan2(Math.sin(yaw), Math.cos(yaw))));
      _q.setFromEuler(new THREE.Euler(-pitch * 0.6, ya * 0.8, this.talk > 0 ? Math.sin(this.t * 3) * 0.04 : 0, 'YXZ'));
      this.head.quaternion.multiply(_q);
    }
    // 기다리는 동안 휴대폰 보기·시계 보기 (손님·행인)
    if (this.fidget && !this.down && !this.frozen && !this.talk && this.PT.call < 0.5) {
      if ((this.fidT -= dt) < 0) { const r = Math.random(); this.fidT = 6 + Math.random() * 10; this.PT.phone = r < 0.5 ? 1 : 0; this.PT.watch = r > 0.5 && r < 0.7 ? 1 : 0; this.fidEnd = r < 0.5 ? 3 + Math.random() * 5 : 1.6; }
      if (this.fidEnd !== undefined && (this.fidEnd -= dt) < 0) { this.PT.phone = 0; this.PT.watch = 0; this.fidEnd = undefined; }
    } else if (!this.keepPhone) { this.PT.phone = 0; this.PT.watch = 0; }
    if (this.phoneObj) { const on = this.P.phone > 0.3 || this.P.call > 0.3; this.phoneObj.visible = on;
      if (on && this.rHand && this.rMid) { this.model.updateMatrixWorld(true); const hp = this.rHand.getWorldPosition(new THREE.Vector3()), fd = this.rMid.getWorldPosition(new THREE.Vector3()).sub(hp).normalize(); this.phoneObj.position.copy(this.root.worldToLocal(hp.addScaledVector(fd, 0.05))); this.phoneObj.lookAt(this.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.08, 0))); } }
    // 가끔 두리번 (말 안 할 때)
    if ((this.lookT -= dt) < 0) { this.lookT = 2.5 + Math.random() * 5; this.lookTgt = this.talk > 0 ? 0 : (Math.random() - 0.5) * 1.2; }
    this.lookOff += ((this.lookTgt || 0) - this.lookOff) * Math.min(1, dt * 2.5);
    if (this.head && Math.abs(this.lookOff) > 0.01) this.head.quaternion.multiply(_q.setFromEuler(new THREE.Euler(0, this.lookOff * 0.5, 0)));
    // 팔 뻗기 (부드럽게 올렸다 내림)
    if (this.reachT > 0) this.reachT -= dt;
    this.reachW += ((this.reachT > 0 ? 1 : 0) - this.reachW) * Math.min(1, dt * 5);
    if (this.reachW > 0.01 && this.rArm && this.rFore && this.rHand) {
      this.model.updateMatrixWorld(true);
      const sh = this.rArm.getWorldPosition(new THREE.Vector3());
      const mid = sh.clone().lerp(this.reachP, 0.5).add(new THREE.Vector3(0, -0.12, 0));
      this.aimBone(this.rArm, this.rFore, mid, this.reachW);
      this.aimBone(this.rFore, this.rHand, this.reachP, this.reachW);
    }
    // 머리카락 흔들림: 머리 움직임 반대로 살짝 처졌다가 돌아옴
    if (this.hairs.length && this.head) {
      const hp = this.head.getWorldPosition(new THREE.Vector3());
      if (this.lastHead) { const v = hp.clone().sub(this.lastHead).divideScalar(Math.max(dt, 1e-3)); this.hairV.x += (-v.x * 0.6 - this.hairO.x * 60 - this.hairV.x * 6) * dt; this.hairV.y += (-v.z * 0.6 - this.hairO.y * 60 - this.hairV.y * 6) * dt; }
      this.lastHead = hp; this.hairO.addScaledVector(this.hairV, dt); this.hairO.clampLength(0, 0.12);
      for (const h of this.hairs) { h.rotation.z = this.hairO.x * 0.6; h.rotation.x = (h.userData.rx ??= h.rotation.x) + this.hairO.y * 0.6; }
    }
  }
  // ── 몸 자세 (애니메이션 위에 뼈 회전을 덧붙임). 축은 몸 기준(오른쪽·위·앞) ──
  rotW(bone, axis, a) {
    if (!bone || Math.abs(a) < 1e-4) return;
    const bw = bone.getWorldQuaternion(_qa), pw = bone.parent.getWorldQuaternion(_qb).invert();
    bone.quaternion.copy(pw.multiply(_qc.setFromAxisAngle(axis, a).multiply(bw))); bone.updateMatrixWorld(true);
  }
  armTo(S, elbow, hand, w) { if (w < 0.01 || !S.arm) return; this.aimBone(S.arm, S.fore, elbow, w); this.aimBone(S.fore, S.hand, hand, w); }
  posture(dt) {
    const P = this.P, PT = this.PT, k = Math.min(1, dt * 6);
    for (const key in P) P[key] += (PT[key] - P[key]) * k;
    for (const f of this.fl) f.t += dt; this.fl = this.fl.filter(f => f.t < f.T);
    let any = this.fl.length > 0; for (const key in P) if (P[key] > 0.01) any = true;
    if (!any) return;
    const B = this.B, t = this.t;
    this.model.updateMatrixWorld(true);
    const Q = this.model.getWorldQuaternion(new THREE.Quaternion()), R = _ax.set(1, 0, 0).applyQuaternion(Q).clone(), U = _ay.set(0, 1, 0).applyQuaternion(Q).clone(), F = _az.set(0, 0, 1).applyQuaternion(Q).clone();
    const sideB = s => s === 'R' ? B.R : B.L, other = s => s === 'R' ? 'L' : 'R';
    // 다리: 두 무릎 꿇기 / 한쪽 무릎 꿇기(다친 다리가 바닥)
    if (P.kneel > 0.01) { for (const S of [B.L, B.R]) { this.rotW(S.up, R, -0.12 * P.kneel); this.rotW(S.leg, R, 1.55 * P.kneel); this.rotW(S.foot, R, 0.5 * P.kneel); } }
    if (P.knee1 > 0.01) { const d = sideB(this.side), o = sideB(other(this.side)); this.rotW(d.up, R, 0.05 * P.knee1); this.rotW(d.leg, R, 1.55 * P.knee1); this.rotW(d.foot, R, 0.6 * P.knee1); this.rotW(o.up, R, -1.45 * P.knee1); this.rotW(o.leg, R, 1.45 * P.knee1); }
    // 허리 굽힘 (배·가슴 맞음, 빌 때)
    const hunch = P.hunch + P.beg * 0.35 + P.knee1 * 0.15;
    if (hunch > 0.01) { this.rotW(B.spine, R, 0.32 * hunch); this.rotW(B.spine1, R, 0.22 * hunch); this.rotW(B.spine2, R, 0.12 * hunch); }
    // 맞은 순간 움찔 (총알 방향으로 젖혀짐)
    for (const f of this.fl) {
      const a = Math.sin(Math.PI * f.t / f.T) * f.amp, S = sideB(f.side);
      if (f.zone === 'head') { this.rotW(B.neck, f.axis, a * 0.45); this.rotW(B.head, f.axis, a * 0.55); this.rotW(B.spine2, f.axis, a * 0.12); }
      else if (f.zone === 'chest') { this.rotW(B.spine1, f.axis, a * 0.28); this.rotW(B.spine2, f.axis, a * 0.3); this.rotW(B.head, f.axis, a * 0.2); }
      else if (f.zone === 'stomach') { this.rotW(B.spine, R, a * 0.45); this.rotW(B.spine1, R, a * 0.3); }
      else if (f.zone === 'arm') { this.rotW(S.arm, f.axis, a * 0.9); this.rotW(S.fore, f.axis, a * 0.5); this.rotW(B.spine2, f.axis, a * 0.12); }
      else if (f.zone === 'leg') { this.rotW(S.up, f.axis, a * 0.35); this.rotW(S.leg, R, a * 0.7); this.rotW(B.spine, f.axis, a * 0.1); }
    }
    if (P.phone + P.watch > 0.01) this.rotW(B.neck, R, 0.32 * Math.max(P.phone, P.watch));
    if (P.cover > 0.01) { this.rotW(B.neck, R, 0.45 * P.cover); this.rotW(B.spine2, R, Math.sin(t * 25) * 0.02 * P.cover); }
    // 빌 때 고개 숙였다 들었다
    if (P.beg > 0.01) this.rotW(B.neck, R, P.beg * (0.25 + 0.18 * Math.sin(t * 4.2)));
    // 팔
    const sp2 = B.spine2.getWorldPosition(new THREE.Vector3());
    for (const s of ['L', 'R']) {
      const S = sideB(s); if (!S.arm) continue;
      const sh = S.arm.getWorldPosition(new THREE.Vector3()), out = sh.clone().sub(sp2); out.addScaledVector(U, -out.dot(U)).normalize();
      if (P.up > 0.01) { const sh2 = Math.sin(t * 11 + (s === 'L' ? 1 : 0)) * 0.015; this.armTo(S, sh.clone().addScaledVector(out, 0.24).addScaledVector(U, 0.06).addScaledVector(F, 0.06), sh.clone().addScaledVector(out, 0.2).addScaledVector(U, 0.4 + sh2).addScaledVector(F, 0.1), P.up); }
      if (P.beg > 0.01) { // 두 손 모아 싹싹 비비기
        const rub = Math.sin(t * 9) * 0.025 * (s === 'L' ? 1 : -1), c = sp2.clone().addScaledVector(F, 0.3).addScaledVector(U, 0.06 + Math.sin(t * 4.2) * 0.04);
        this.armTo(S, sh.clone().addScaledVector(F, 0.12).addScaledVector(U, -0.2).addScaledVector(out, 0.1), c.addScaledVector(out, 0.012).addScaledVector(U, rub), P.beg);
      }
      if (P.clutch > 0.01) { // 상처 움켜쥐기
        const z = this.zone; let tgt = null;
        if (z === 'chest') tgt = sp2.clone().addScaledVector(F, 0.13).addScaledVector(U, 0.02).addScaledVector(out, s === this.side ? 0.05 : -0.02);
        else if (z === 'stomach') tgt = B.spine.getWorldPosition(new THREE.Vector3()).addScaledVector(F, 0.15).addScaledVector(out, 0.04);
        else if (z === 'arm' && s !== this.side) tgt = sideB(this.side).fore.getWorldPosition(new THREE.Vector3()).addScaledVector(F, 0.05);
        else if (z === 'leg' && s === this.side) tgt = sideB(s).leg.getWorldPosition(new THREE.Vector3()).addScaledVector(F, 0.1).addScaledVector(U, 0.08);
        else if (z === 'head' && s === 'R') tgt = B.head.getWorldPosition(new THREE.Vector3()).addScaledVector(F, 0.1);
        if (tgt) this.armTo(S, sh.clone().lerp(tgt, 0.5).addScaledVector(out, 0.14).addScaledVector(U, -0.1), tgt, P.clutch * (1 - P.up) * (1 - P.beg));
      }
      const hp = B.head.getWorldPosition(new THREE.Vector3()), tr = Math.sin(t * 23 + (s === 'L' ? 2 : 0)) * 0.008;
      if (s === 'R' && P.phone > 0.01) this.armTo(S, sh.clone().addScaledVector(out, 0.06).addScaledVector(U, -0.25).addScaledVector(F, 0.06), sp2.clone().addScaledVector(F, 0.3).addScaledVector(U, 0.03).addScaledVector(out, 0.07), P.phone * (1 - P.up));
      if (s === 'R' && P.call > 0.01) this.armTo(S, sh.clone().addScaledVector(out, 0.16).addScaledVector(U, -0.17).addScaledVector(F, 0.1), hp.clone().addScaledVector(out, 0.095).addScaledVector(F, 0.03).addScaledVector(U, 0.06), P.call * (1 - P.up));
      if (s === 'L' && P.watch > 0.01) this.armTo(S, sh.clone().addScaledVector(out, 0.08).addScaledVector(U, -0.24).addScaledVector(F, 0.08), sp2.clone().addScaledVector(F, 0.28).addScaledVector(U, 0.06).addScaledVector(out, 0.02), P.watch);
      if (s === 'L' && P.mouth > 0.01) this.armTo(S, sh.clone().addScaledVector(U, -0.16).addScaledVector(F, 0.16).addScaledVector(out, 0.06), hp.clone().addScaledVector(F, 0.11).addScaledVector(U, 0.035 + tr), P.mouth);
      if (P.cover > 0.01) this.armTo(S, sh.clone().addScaledVector(out, 0.17).addScaledVector(U, 0.08).addScaledVector(F, 0.16), hp.clone().addScaledVector(U, 0.1 + tr).addScaledVector(out, 0.06).addScaledVector(F, -0.01), P.cover);
      if (P.spread > 0.01) { // 쓰러진 뒤 팔이 축 늘어져 벌어짐
        const a = s === 'L' ? 1 : -1, v = this.spreadSign * a;
        this.armTo(S, sh.clone().addScaledVector(out, 0.24).addScaledVector(U, -0.06 + 0.07 * v).addScaledVector(F, 0.03), sh.clone().addScaledVector(out, 0.42).addScaledVector(U, -0.12 + 0.2 * v).addScaledVector(F, 0.07 - 0.04 * v), P.spread);
      }
    }
    if (P.spread > 0.01) this.rotW(B.head, F, 0.45 * this.spreadSign * P.spread);
  }
  // 오른팔을 월드 좌표 p 쪽으로 뻗었다가(ms 동안) 돌아온다 — 물건 놓기, 카드·돈 건네기, 거스름돈 받기
  reach(p, ms = 1400) { this.reachP.copy(p); this.reachT = ms / 1000; }
  aimBone(bone, child, target, w) {
    if (!bone || !child || w <= 0) return;
    const bp = bone.getWorldPosition(new THREE.Vector3()), cp = child.getWorldPosition(new THREE.Vector3());
    const cur = cp.sub(bp).normalize(), want = target.clone().sub(bp).normalize();
    const d = new THREE.Quaternion().setFromUnitVectors(cur, want);
    const bw = bone.getWorldQuaternion(new THREE.Quaternion()), pw = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const nw = d.multiply(bw); bone.quaternion.slerp(pw.invert().multiply(nw), w); bone.updateMatrixWorld(true);
  }
  dispose() { this.root.removeFromParent(); this.mixer.stopAllAction(); }
}
