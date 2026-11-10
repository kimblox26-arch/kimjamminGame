// SCP 캐릭터들: 모델 + 애니메이션 + 능력(플레이어로 조종할 때) + 격리실 NPC 행동
// 모든 디자인은 SCP 위키 문서 설명을 바탕으로 새로 만든 절차적 모델 (CC BY-SA 3.0 원작)
import * as THREE from 'three';
import { buildHumanoid, Pose, applyPose, limbGeo, locomotion } from './rig.js';
import { normalFrom } from './world.js';
import { collideCircle, blocks, cellOf, center, lineClear } from './map.js';

const PI = Math.PI, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), wrap = a => Math.atan2(Math.sin(a), Math.cos(a)), rnd = (a, b) => a + Math.random() * (b - a);

export const ROSTER = [
  { id: 'dclass', name: 'D계급 인원', title: '인간', cls: '—', desc: '키카드를 찾아 탈출하라. SCP 의 얼굴을 보지 마라.' },
  { id: '096', name: 'SCP-096', title: '수줍은 자', cls: 'Keter', desc: '아주 빠른 질주, 강철문 파괴. 능력: 비명' },
  { id: '173', name: 'SCP-173', title: '조각상', cls: 'Euclid', desc: '눈 깜짝할 새 움직이는 콘크리트 조각상. 능력: 순간 이동' },
  { id: '049', name: 'SCP-049', title: '역병 의사', cls: 'Euclid', desc: '느리지만 위엄 있게 걷는 의사. 능력: 손길' },
  { id: '106', name: 'SCP-106', title: '노인', cls: 'Keter', desc: '벽을 통과하고 부식 자국을 남긴다. 능력: 웃음' },
  { id: '939', name: 'SCP-939', title: '수많은 목소리', cls: 'Keter', desc: '빠른 네발 포식자, 높은 점프. 능력: 울음 흉내' },
  { id: '682', name: 'SCP-682', title: '죽일 수 없는 파충류', cls: 'Keter', desc: '거대하고 무엇이든 부순다. 능력: 포효' },
  { id: '999', name: 'SCP-999', title: '간지럼 괴물', cls: 'Safe', desc: '통통 튀는 주황 젤리. 능력: 웃음소리' },
];

function tex(w, h, draw, rep = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep);
  const n = new THREE.CanvasTexture(normalFrom(c, 4)); n.wrapS = n.wrapT = THREE.RepeatWrapping; n.repeat.set(rep, rep);
  return [t, n];
}
const speckle = (x, w, h, n, col, s = 3) => { for (let i = 0; i < n; i++) { x.fillStyle = col(); x.fillRect(Math.random() * w, Math.random() * h, s * Math.random() + 1, s * Math.random() + 1); } };
const M = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; m.frustumCulled = false; parent.add(m); return m; };
const lerpRot = (o, x, y, z, k) => { o.rotation.x += (x - o.rotation.x) * k; o.rotation.y += (y - o.rotation.y) * k; o.rotation.z += (z - o.rotation.z) * k; };

// ── SCP-173: 콘크리트와 철근으로 거칠게 만든 조각상 (스프레이 자국) ──
function make173() {
  const [map, normalMap] = tex(256, 256, (x, w, h) => {
    x.fillStyle = '#8b8780'; x.fillRect(0, 0, w, h);
    speckle(x, w, h, 5000, () => `rgba(${Math.random() < 0.5 ? '40,38,35' : '200,195,185'},${Math.random() * 0.25})`);
    x.strokeStyle = 'rgba(30,28,25,0.6)'; for (let i = 0; i < 8; i++) { x.lineWidth = 1 + Math.random(); x.beginPath(); let a = Math.random() * w, b = Math.random() * h; x.moveTo(a, b); for (let k = 0; k < 6; k++) x.lineTo(a += rnd(-20, 20), b += rnd(5, 25)); x.stroke(); }
    for (const col of ['rgba(150,30,25,', 'rgba(40,110,50,', 'rgba(90,60,30,']) for (let i = 0; i < 4; i++) { // 스프레이 페인트
      x.strokeStyle = col + rnd(0.4, 0.75) + ')'; x.lineWidth = rnd(6, 16); x.lineCap = 'round'; x.beginPath(); x.moveTo(rnd(0, w), rnd(0, h)); x.quadraticCurveTo(rnd(0, w), rnd(0, h), rnd(0, w), rnd(0, h)); x.stroke();
    }
  });
  const con = new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(1.5, 1.5), roughness: 0.97, flatShading: true });
  const rebar = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.6, metalness: 0.5 });
  const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5; return s - Math.floor(s); };
  const rough = (g, a) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = (hash(+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)) - 0.5) * a; p.setXYZ(i, x * (1 + n), y + n * 0.3 * a, z * (1 + n)); } g.computeVertexNormals(); return g; };
  const box = (w, h, d, s = 2) => rough(new THREE.BoxGeometry(w, h, d, s, s * 2, s), 0.18);
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  for (const s of [1, -1]) {
    M(box(0.17, 0.95, 0.2), con, body, s * 0.12, 0.5, 0).rotation.z = s * 0.03;
    M(box(0.2, 0.1, 0.32), con, body, s * 0.13, 0.05, 0.05);
    const arm = M(box(0.12, 0.82, 0.13), con, body, s * 0.33, 1.3, 0.02); arm.rotation.z = s * 0.07;
    M(box(0.13, 0.17, 0.07), con, body, s * 0.36, 0.84, 0.04);
  }
  M(box(0.44, 0.24, 0.26), con, body, 0, 1.03, 0);
  const torso = M(rough(new THREE.CylinderGeometry(0.27, 0.21, 0.66, 6, 3), 0.15), con, body, 0, 1.45, 0); torso.scale.z = 0.62;
  M(rough(new THREE.CylinderGeometry(0.075, 0.09, 0.14, 6), 0.1), con, body, 0, 1.84, 0);
  const head = M(box(0.27, 0.36, 0.28, 3), con, body, 0, 2.07, 0.01);
  M(box(0.3, 0.06, 0.12), con, head, 0, 0.05, 0.11); // 거칠게 튀어나온 이마 덩어리
  for (const [x, y, z, rx, rz, l] of [[0.05, 2.25, 0, 0.3, -0.4, 0.35], [-0.07, 2.24, -0.04, -0.2, 0.5, 0.28], [0.28, 1.76, 0, 0, -1.1, 0.3], [-0.29, 1.74, 0.02, 0.3, 1.2, 0.26], [0.1, 0.95, -0.12, 1.3, 0, 0.22], [0.35, 0.8, 0.02, 0, -0.2, 0.15]]) {
    const r = M(new THREE.CylinderGeometry(0.011, 0.011, l, 6), rebar, body, x, y, z); r.rotation.set(rx, 0, rz); // 삐져나온 철근
  }
  return { id: '173', root, radius: 0.36, camH: 2.0, camDist: 3.4, walk: 6, run: 13, jump: 0, heavy: true, strong: true, statue: true,
    animate(dt, s) { body.position.x = s.speed > 0.3 ? rnd(-0.012, 0.012) : 0; body.position.z = s.speed > 0.3 ? rnd(-0.012, 0.012) : 0; },
    ability(pl, audio) { // 순간 이동: 앞으로 최대 5m
      const dx = Math.sin(pl.yaw), dz = Math.cos(pl.yaw);
      for (let i = 0; i < 25; i++) { const nx = pl.pos.x + dx * 0.2, nz = pl.pos.z + dz * 0.2; if (blocks(cellOf(nx + dx * 0.4), cellOf(nz + dz * 0.4))) break; pl.pos.x = nx; pl.pos.z = nz; }
      audio.sfx('scrape', pl.pos);
    } };
}

// ── 사람형 SCP 공통 ──
function humanoidAvatar(id, rig, extra) {
  const P = new Pose();
  return { id, root: rig.root, rig, head: rig.bones.head, radius: 0.34, camH: 1.7, camDist: 3.1, jump: 6, ...extra,
    animate(dt, s) {
      P.clear(); locomotion(P, { ...s, ws: this.walk, rs: this.run });
      this.pose?.(P, s);
      applyPose(rig, P, dt, 12);
      this.after?.(dt, s);
    } };
}

// ── SCP-049: 역병 의사 (부리 가면, 렌즈, 두건, 긴 로브) ──
function make049() {
  const [cm, cn] = tex(256, 256, (x, w, h) => { x.fillStyle = '#1c1915'; x.fillRect(0, 0, w, h); speckle(x, w, h, 3000, () => `rgba(${Math.random() < 0.5 ? '0,0,0' : '90,80,65'},${Math.random() * 0.2})`, 2); for (let i = 0; i < w; i += 4) { x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(i, 0, 1, h); } }, 3);
  const cloak = new THREE.MeshStandardMaterial({ map: cm, normalMap: cn, roughness: 0.88, side: THREE.DoubleSide });
  const leather = new THREE.MeshStandardMaterial({ color: 0x3a2c20, roughness: 0.45, metalness: 0.05 });
  const rig = buildHumanoid({ kind: '049', noFace: true, skin: leather, cloth: cloak, cloth2: cloak, sleeve: cloak, pants: cloak, shoe: leather, hairMat: leather,
    hipH: 1.0, thigh: 0.47, shin: 0.45, ankleH: 0.08, spine: 0.21, chest: 0.32, neck: 0.08, headS: [0.098, 0.118, 0.108], upper: 0.31, fore: 0.28, palmL: 0.088, fingerL: 0.078, fingerR: 0.0105,
    shoulderW: 0.205, hipW: 0.095, chestR: 0.175, waist: 0.155, depth: 0.7, pelvis: [0.17, 0.12, 0.13], armR: 0.056, legR: 0.08, neckR: 0.056, footL: 0.27 });
  const hd = rig.bones.head;
  const beak = M(new THREE.ConeGeometry(0.046, 0.27, 16), leather, hd, 0, 0.065, 0.2); beak.rotation.x = PI / 2 + 0.38;
  const lens = new THREE.MeshPhysicalMaterial({ color: 0x0c1414, roughness: 0.05, metalness: 0.5, clearcoat: 1 }), brass = new THREE.MeshStandardMaterial({ color: 0x8a6a2c, roughness: 0.3, metalness: 0.9 });
  for (const s of [1, -1]) { const l = M(new THREE.CylinderGeometry(0.026, 0.026, 0.014, 18), lens, hd, s * 0.042, 0.118, 0.098); l.rotation.x = PI / 2; const r = M(new THREE.TorusGeometry(0.027, 0.005, 6, 18), brass, hd, s * 0.042, 0.118, 0.106); }
  M(new THREE.SphereGeometry(0.14, 24, 16, PI / 2 + 0.85, 2 * PI - 1.7, 0, PI * 0.64), cloak, hd, 0, 0.11, -0.012).scale.set(1, 1.12, 1.12); // 두건
  const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(0.17 + 0.25 * Math.pow(t, 1.3) + 0.01 * Math.sin(t * 30), 0.32 - t * 1.25)); }
  const robe = M(new THREE.LatheGeometry(pts, 28), cloak, rig.bones.hips, 0, 0, 0); robe.scale.z = 0.85;
  M(new THREE.TorusGeometry(0.16, 0.012, 6, 24), leather, rig.bones.spine, 0, 0.05, 0).rotation.x = PI / 2; // 허리띠
  return humanoidAvatar('049', rig, { walk: 1.7, run: 3.8,
    pose(P, s) {
      const idle = 1 - clamp(s.speed / 1.2, 0, 1);
      P.rot('armL', -0.35, 0, -0.28, idle).rot('armR', -0.35, 0, 0.28, idle).rot('foreL', -1.25, 0, 0, idle).rot('foreR', -1.25, 0, 0, idle); // 손을 모음
      if (s.act >= 0 && s.act < 1.4) P.rot('armR', -1.5, 0, 0.1).rot('foreR', -0.1).rot('head', 0.15, -0.2, 0).val('curlR', -0.3); // 손길
      P.rot('neck', 0.08).rot('spine', -0.04);
    },
    after(dt, s) { robe.rotation.x += (-clamp(s.speed * 0.05, 0, 0.25) + Math.sin(s.t * 2.2) * 0.02 - robe.rotation.x) * Math.min(1, dt * 6); } });
}

// ── SCP-106: 부식된 검은 노인 (번들거리는 점액, 흐르는 방울, 벽 통과, 부식 웅덩이) ──
function make106() {
  const [tm, tn] = tex(256, 256, (x, w, h) => {
    x.fillStyle = '#1d1712'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(${60 + Math.random() * 60},${30 + Math.random() * 30},${10},${Math.random() * 0.35})`; x.beginPath(); x.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 18, 0, 7); x.fill(); }
    speckle(x, w, h, 4000, () => `rgba(0,0,0,${Math.random() * 0.4})`, 3);
    x.strokeStyle = 'rgba(0,0,0,0.6)'; for (let i = 0; i < 40; i++) { x.lineWidth = rnd(1, 3); x.beginPath(); const a = rnd(0, w), b = rnd(0, h); x.moveTo(a, b); x.lineTo(a + rnd(-30, 30), b + rnd(-10, 10)); x.stroke(); } // 주름
  }, 2);
  const tar = new THREE.MeshPhysicalMaterial({ map: tm, normalMap: tn, normalScale: new THREE.Vector2(1.2, 1.2), color: 0x6a5a4a, roughness: 0.35, clearcoat: 0.9, clearcoatRoughness: 0.2 });
  const rig = buildHumanoid({ kind: '106', skin: tar, cloth: tar, cloth2: tar, sleeve: tar, pants: tar, shoe: tar, hairMat: tar,
    hipH: 0.93, thigh: 0.44, shin: 0.42, ankleH: 0.07, spine: 0.2, chest: 0.29, neck: 0.085, headS: [0.092, 0.114, 0.1], upper: 0.33, fore: 0.3, palmL: 0.09, fingerL: 0.1, fingerR: 0.0085,
    shoulderW: 0.18, hipW: 0.085, chestR: 0.142, waist: 0.112, depth: 0.66, pelvis: [0.14, 0.1, 0.11], armR: 0.037, legR: 0.061, neckR: 0.043, footL: 0.25 });
  const drop = new THREE.MeshPhysicalMaterial({ color: 0x0d0906, roughness: 0.1, clearcoat: 1 }), drips = [];
  for (const [b, x, y, z] of [['jaw', 0, -0.06, 0.08], ['handL', 0, -0.13, 0], ['handR', 0, -0.12, 0.01], ['chest', 0.06, 0.1, 0.11], ['chest', -0.08, 0.04, 0.1], ['foreL', 0.02, -0.2, 0.03]]) {
    const d = M(new THREE.SphereGeometry(0.012, 8, 6), drop, rig.bones[b], x, y, z); drips.push(d);
  }
  // 부식 웅덩이(월드 좌표) — 걸을 때 남김
  const trail = new THREE.Group(), pm = new THREE.MeshPhysicalMaterial({ color: 0x0b0806, roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  const pools = []; for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(new THREE.CircleGeometry(1, 20), pm); m.rotation.x = -PI / 2; m.visible = false; m.receiveShadow = true; trail.add(m); pools.push(m); }
  let pi = 0;
  return humanoidAvatar('106', rig, { walk: 1.4, run: 3.3, phase: true, extra: trail,
    pose(P, s) {
      P.rot('spine', 0.32).rot('chest', 0.12).rot('neck', 0.25).rot('head', -0.2, 0.15 * Math.sin(s.t * 0.7), 0.12).rot('jaw', 0.22);
      P.rot('armL', -0.25, 0, 0.05).rot('armR', -0.25, 0, -0.05).val('curlL', 0.6).val('curlR', 0.6).val('hipY', -0.04);
      if (s.act >= 0 && s.act < 2) P.rot('jaw', 0.7 + 0.15 * Math.sin(s.t * 20)).rot('armL', -1.0, 0, 0.3).rot('armR', -1.0, 0, -0.3).rot('head', -0.3);
    },
    after(dt, s) { drips.forEach((d, i) => { const k = (s.t * 0.6 + i * 0.37) % 1; d.scale.set(1 - k * 0.3, 1 + k * 2.5, 1 - k * 0.3); }); },
    onStep(p) { const m = pools[pi++ % pools.length]; m.visible = true; m.position.set(p.x + rnd(-0.1, 0.1), 0.006 + (pi % 7) * 0.0004, p.z + rnd(-0.1, 0.1)); m.scale.setScalar(rnd(0.18, 0.38)); } });
}

// ── 네발 짐승 공통 (939, 682) ──
function makeQuad(o) {
  const root = new THREE.Group(), body = new THREE.Group(); body.position.y = o.h; root.add(body);
  const lay = (g, dir = 1) => g.rotateX(-dir * PI / 2); // -Y → +Z(앞) / -Z(뒤)
  const torso = M(lay(limbGeo(o.L * 1.08, o.r * 0.82, o.r, o.r * 0.18, 20, 0.55)), o.skin, body, 0, 0, -o.L * 0.54); torso.scale.y = 1.15;
  if (o.ribs) for (let i = 0; i < 6; i++) { const r = M(new THREE.TorusGeometry(o.r * (0.98 - i * 0.02), o.r * 0.045, 6, 20, PI * 1.3), o.skin, body, 0, 0, o.L * (0.32 - i * 0.07)); r.rotation.z = -PI * 0.15 - PI / 2 - 0.0; r.rotation.y = 0; r.scale.y = 1.15; }
  const neck = new THREE.Group(); neck.position.set(0, o.r * 0.2, o.L * 0.58); body.add(neck);
  M(lay(limbGeo(o.neck, o.r * 0.68, o.r * 0.55, o.r * 0.05)), o.skin, neck);
  const head = new THREE.Group(); head.position.z = o.neck; neck.add(head);
  const skull = M(lay(limbGeo(o.head, o.r * 0.64, o.r * 0.3, o.r * 0.1, 18, 0.3)), o.skin, head, 0, o.r * 0.1, 0); skull.scale.set(o.headW || 0.85, 0.8, 1);
  const jaw = new THREE.Group(); jaw.position.set(0, -o.r * 0.12, o.head * 0.12); head.add(jaw);
  M(lay(limbGeo(o.head * 0.88, o.r * 0.44, o.r * 0.22, 0)), o.skin, jaw).scale.set(o.headW || 0.85, 0.55, 1);
  const tooth = new THREE.MeshStandardMaterial({ color: 0xe0d6b8, roughness: 0.35 }), tg = new THREE.ConeGeometry(o.r * 0.035, o.r * 0.16, 5);
  for (let i = 0; i < 9; i++) for (const s of [1, -1]) {
    const z = o.head * (0.3 + i * 0.075), w = (o.headW || 0.85) * o.r * (0.5 - i * 0.03);
    M(tg, tooth, head, s * w, -o.r * 0.2 + i * o.r * 0.012, z).rotation.x = PI;
    M(tg, tooth, jaw, s * w * 0.9, o.r * 0.1, z - o.head * 0.12);
  }
  if (o.eyes) for (const s of [1, -1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(o.r * 0.06, 10, 8), o.eyes); e.position.set(s * o.r * 0.3, o.r * 0.22, o.head * 0.2); head.add(e); }
  if (o.spikes) for (let i = 0; i < 9; i++) { const sp = M(new THREE.ConeGeometry(o.r * 0.1, o.r * (0.5 - Math.abs(i - 3) * 0.05), 6), o.spikeMat || o.skin, body, 0, o.r * 1.05, o.L * (0.45 - i * 0.12)); sp.rotation.x = -0.4; }
  const legs = [];
  for (const front of [true, false]) for (const s of [1, -1]) {
    const l = front ? o.fl : o.bl, hip = new THREE.Group(); hip.position.set(s * o.r * 0.68, -o.r * 0.3, (front ? 0.42 : -0.46) * o.L); body.add(hip);
    M(limbGeo(l[0], o.legR, o.legR * 0.72, o.legR * 0.25, 12, 0.35), o.skin, hip);
    const knee = new THREE.Group(); knee.position.y = -l[0]; hip.add(knee);
    M(limbGeo(l[1], o.legR * 0.7, o.legR * 0.5, o.legR * 0.1), o.skin, knee);
    const ank = new THREE.Group(); ank.position.y = -l[1]; knee.add(ank);
    M(limbGeo(l[2], o.legR * 0.5, o.legR * 0.42), o.skin, ank);
    const claw = new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.3 });
    for (let k = -1; k <= 1; k++) { const c = M(new THREE.ConeGeometry(o.legR * 0.13, o.legR * 0.9, 5), claw, ank, k * o.legR * 0.35, -l[2] - o.legR * 0.2, o.legR * 0.45); c.rotation.x = PI / 2 + 0.6; }
    legs.push({ hip, knee, ank, front, s });
  }
  const tail = []; let par = body, z = -o.L * 0.55;
  for (let i = 0; i < o.tailN; i++) {
    const t = new THREE.Group(); t.position.set(0, i ? 0 : o.r * 0.1, i ? -o.tailL : z); par.add(t);
    M(lay(limbGeo(o.tailL * 1.1, o.r * 0.42 * (1 - i / o.tailN), o.r * 0.42 * (1 - (i + 1) / o.tailN) + 0.01), -1), o.skin, t);
    if (o.spikes && i < o.tailN - 1) M(new THREE.ConeGeometry(o.r * 0.07, o.r * 0.3, 6), o.spikeMat || o.skin, t, 0, o.r * 0.4 * (1 - i / o.tailN), -o.tailL * 0.5).rotation.x = -0.6;
    tail.push(t); par = t;
  }
  const rest = { f: [0.12, -0.32, 0.25], b: [-0.45, 0.95, -0.55] };
  return { id: o.id, root, head, radius: o.radius, camH: o.camH, camDist: o.camDist, walk: o.walk, run: o.run, jump: o.jump, heavy: o.heavy, strong: o.strong,
    animate(dt, s) {
      const k = Math.min(1, dt * 14), sp = s.speed, m = clamp(sp / this.walk, 0, 1), r = clamp((sp - this.walk) / (this.run - this.walk), 0, 1), φ = s.phase, air = s.air;
      for (const L of legs) {
        const trot = L.front ? (L.s > 0 ? 0 : PI) : (L.s > 0 ? PI : 0), gal = L.front ? (L.s > 0 ? 0 : 0.5) : (L.s > 0 ? PI : PI + 0.5);
        const ph = φ + trot + (gal - trot) * r, sw = Math.sin(ph), lift = Math.max(0, Math.cos(ph)) * m, A = (0.35 + 0.4 * r) * m, R = L.front ? rest.f : rest.b;
        const tuck = air * (L.front ? -0.7 : 0.7);
        lerpRot(L.hip, R[0] - A * sw + tuck, 0, L.s * 0.04, k);
        lerpRot(L.knee, R[1] + 0.7 * lift * (L.front ? 1 : 0.6) + air * 0.6 * (L.front ? 1 : -0.3), 0, 0, k);
        lerpRot(L.ank, R[2] - 0.5 * lift, 0, 0, k);
      }
      const act = s.act >= 0 && s.act < 1.8 ? Math.sin(Math.min(1, s.act / 0.3) * PI / 2) : 0;
      body.position.y += (o.h - 0.04 * r + 0.035 * Math.abs(Math.sin(2 * φ)) * m - body.position.y) * k;
      lerpRot(body, 0.05 * Math.sin(2 * φ) * r - 0.12 * act, 0, 0.03 * Math.sin(φ) * m, k);
      lerpRot(neck, -0.12 + 0.06 * Math.sin(2 * φ) * m - 0.25 * act + 0.02 * Math.sin(s.t * 1.5), 0.15 * Math.sin(s.t * 0.4) * (1 - m), 0, k);
      lerpRot(head, 0.05 + 0.15 * act, 0, 0.1 * act * Math.sin(s.t * 18), k);
      lerpRot(jaw, 0.06 + 0.04 * Math.sin(s.t * 2) + 0.75 * act + 0.15 * r, 0, 0, k);
      tail.forEach((t, i) => lerpRot(t, -0.08 + 0.05 * i * (1 - r), Math.sin(s.t * (2 + 3 * r) - i * 0.7) * (0.12 + 0.12 * m), 0, k));
    } };
}
function make939() {
  const [map, normalMap] = tex(256, 256, (x, w, h) => { x.fillStyle = '#7a1a14'; x.fillRect(0, 0, w, h); for (let i = 0; i < 220; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '40,5,5' : '170,60,50'},${Math.random() * 0.25})`; x.beginPath(); x.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 14, 0, 7); x.fill(); } speckle(x, w, h, 3000, () => `rgba(30,0,0,${Math.random() * 0.3})`, 2); }, 2);
  const skin = new THREE.MeshPhysicalMaterial({ map, normalMap, color: 0xd09088, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: new THREE.Color(0xff6050) });
  return makeQuad({ id: '939', skin, L: 1.1, h: 0.92, r: 0.26, legR: 0.075, fl: [0.36, 0.36, 0.15], bl: [0.38, 0.4, 0.18], neck: 0.32, head: 0.52, headW: 0.8, tailN: 6, tailL: 0.17, ribs: true,
    radius: 0.42, camH: 1.4, camDist: 3.3, walk: 3, run: 9, jump: 9 });
}
function make682() {
  const [map, normalMap] = tex(256, 256, (x, w, h) => {
    x.fillStyle = '#3b4128'; x.fillRect(0, 0, w, h);
    for (let yy = 0; yy < h; yy += 10) for (let xx = (yy / 10 % 2) * 6; xx < w; xx += 12) { const v = 40 + Math.random() * 40; x.fillStyle = `rgb(${v + 10},${v + 18},${v - 5})`; x.beginPath(); x.ellipse(xx, yy, 5.5, 4.5, 0, 0, 7); x.fill(); x.strokeStyle = 'rgba(10,12,5,0.7)'; x.lineWidth = 1.2; x.stroke(); }
    for (let i = 0; i < 30; i++) { x.fillStyle = `rgba(90,20,10,${Math.random() * 0.3})`; x.beginPath(); x.arc(Math.random() * w, Math.random() * h, 3 + Math.random() * 12, 0, 7); x.fill(); } // 재생 중인 상처
  }, 3);
  const skin = new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.6 });
  return makeQuad({ id: '682', skin, L: 2.0, h: 1.15, r: 0.5, legR: 0.16, fl: [0.46, 0.42, 0.2], bl: [0.46, 0.46, 0.22], neck: 0.4, head: 0.85, headW: 1.0, tailN: 8, tailL: 0.34, spikes: true,
    spikeMat: new THREE.MeshStandardMaterial({ color: 0x1d1a14, roughness: 0.4 }), eyes: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.2, 0.1), toneMapped: false }),
    radius: 0.85, camH: 2.3, camDist: 5.5, walk: 2.6, run: 7, jump: 5, heavy: true, strong: true });
}

// ── SCP-999: 출렁이는 주황 젤리 ──
function make999() {
  const root = new THREE.Group(), g = new THREE.SphereGeometry(0.5, 40, 30), base = g.attributes.position.array.slice();
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xff8a1c, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0x5a1a00, emissiveIntensity: 0.6, transparent: true, opacity: 0.93, sheen: 0.6, sheenColor: new THREE.Color(0xffd080) });
  const blob = M(g, mat, root, 0, 0.36, 0);
  const black = new THREE.MeshStandardMaterial({ color: 0x1a0d05, roughness: 0.2 });
  for (const s of [1, -1]) M(new THREE.SphereGeometry(0.045, 12, 10), black, blob, s * 0.15, 0.1, 0.45).scale.set(0.8, 1.2, 0.5);
  const smile = M(new THREE.TorusGeometry(0.12, 0.016, 8, 20, PI * 0.8), black, blob, 0, -0.02, 0.46); smile.rotation.z = PI + PI * 0.1;
  let sq = 0;
  return { id: '999', root, head: null, radius: 0.48, camH: 1.0, camDist: 3.0, walk: 2.6, run: 5.5, jump: 10,
    animate(dt, s) {
      const p = g.attributes.position.array, t = s.t, hop = s.speed > 0.3 && !s.air ? Math.abs(Math.sin(s.phase)) : 0;
      for (let i = 0; i < p.length; i += 3) { const x = base[i], y = base[i + 1], z = base[i + 2], w = 1 + 0.035 * Math.sin(t * 7 + y * 9 + x * 6) + 0.02 * Math.sin(t * 11 + z * 8); p[i] = x * w; p[i + 1] = y * w; p[i + 2] = z * w; }
      g.attributes.position.needsUpdate = true; g.computeVertexNormals();
      const act = s.act >= 0 && s.act < 1.5 ? Math.sin(s.act * 18) * (1 - s.act / 1.5) : 0;
      const tgt = 1 - hop * 0.18 + (s.air ? 0.2 : 0) + act * 0.15; sq += (tgt - sq) * Math.min(1, dt * 12);
      blob.scale.set(1 / Math.sqrt(sq), sq * 0.78, 1 / Math.sqrt(sq)); blob.position.y = 0.39 * sq * 0.92 + hop * 0.25;
      blob.rotation.y = act * 0.6;
    } };
}

export function makeCreature(id) { return { '173': make173, '049': make049, '106': make106, '939': make939, '682': make682, '999': make999 }[id](); }

// ── 격리실 안에 갇혀 있는 SCP (NPC) ──
export class ScpNPC {
  constructor(scene, av, rect, home, audio) {
    this.av = av; this.audio = audio; scene.add(av.root); if (av.extra) scene.add(av.extra);
    this.rect = rect; this.pos = new THREE.Vector3(home.x, 0, home.z); this.yaw = rnd(-PI, PI); this.t = rnd(0, 10);
    this.speed = 0; this.phase = 0; this.wait = rnd(1, 4); this.tp = 1; this.cryT = rnd(8, 20); this.lastStep = 0; this.target = this.pick();
    av.root.position.copy(this.pos);
  }
  pick() { const r = this.rect, m = this.av.radius + 0.3; return new THREE.Vector3(rnd(r[0] * 2 + m, r[2] * 2 + 2 - m), 0, rnd(r[1] * 2 + m, r[3] * 2 + 2 - m)); }
  update(dt, cam, frustum, playerPos) {
    const av = this.av; this.t += dt;
    if (av.statue) { // 173: 누가 보고 있으면 절대 움직이지 않는다
      const c = this.pos.clone().setY(1.6), seen = frustum.containsPoint(c) && lineClear(cam.position.x, cam.position.z, c.x, c.z);
      if (!seen && (this.tp -= dt) < 0) {
        const tg = this.pick(), d = tg.clone().sub(this.pos); if (d.length() > 1.6) d.setLength(1.6);
        this.pos.add(d); this.yaw = Math.atan2(playerPos.x - this.pos.x, playerPos.z - this.pos.z); this.tp = rnd(0.25, 0.7); this.audio.sfx('scrape', this.pos);
      }
    } else if (this.wait > 0) { this.wait -= dt; this.speed *= 0.85; }
    else {
      const d = this.target.clone().sub(this.pos); d.y = 0; const L = d.length();
      if (L < 0.4) { this.wait = rnd(2, 7); this.target = this.pick(); }
      else {
        this.yaw += wrap(Math.atan2(d.x, d.z) - this.yaw) * Math.min(1, dt * 3);
        this.speed += (av.walk * 0.85 - this.speed) * Math.min(1, dt * 3);
        this.pos.x += Math.sin(this.yaw) * this.speed * dt; this.pos.z += Math.cos(this.yaw) * this.speed * dt;
      }
      const r = this.rect, m = av.radius; this.pos.x = clamp(this.pos.x, r[0] * 2 + m, r[2] * 2 + 2 - m); this.pos.z = clamp(this.pos.z, r[1] * 2 + m, r[3] * 2 + 2 - m);
      if (!av.phase) collideCircle(this.pos, m);
    }
    this.phase += dt * this.speed / (av.radius * 2.8 + 0.6) * PI * 2;
    const st = Math.floor(this.phase / PI);
    if (st !== this.lastStep && this.speed > 0.3) { av.onStep?.(this.pos); if (av.id === '999') this.audio.sfx('squish', this.pos); else this.audio.step({ x: this.pos.x, y: 0.1, z: this.pos.z }, av.heavy ? 0.5 : 0.15, av.heavy); }
    this.lastStep = st;
    // 가끔 소리(가까울 때)
    if ((this.cryT -= dt) < 0) { this.cryT = rnd(12, 28); if (this.pos.distanceTo(playerPos) < 16 && !av.statue) { this.act = 0; this.audio.sfx(av.id, this.pos); } }
    if (this.act >= 0) this.act += dt; if (this.act > 3) this.act = -1;
    av.root.position.copy(this.pos); av.root.rotation.y = this.yaw;
    av.animate(dt, { speed: this.speed, phase: this.phase, air: 0, vy: 0, crouch: 0, landT: 0, t: this.t, act: this.act ?? -1 });
  }
}
