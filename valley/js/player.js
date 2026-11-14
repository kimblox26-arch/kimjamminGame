// 1인칭 플레이어: 이동 · 돌 줍기/놓기/던지기 · 삽으로 흙 파기/붓기
import * as THREE from 'three';
import * as T from './terrain.js';
import * as W from './water.js';
import * as S from './stones.js';
import * as D from './dam.js';

const LOAD_VIS = 0.3; // 삽에 보이는 흙더미 크기 기준 (담는 양 제한 없음)
// 작업 속도: 0 보통 · 1 약간 빠르게 · 2 엄청 빠르게
export const SPEEDS = [
  { name: '보통', dig: 0.26, depth: 0.075, digR: 0.38, dump: 0.2, dumpAmt: 0.022, mud: 0.12, mudAmt: 0.03, mudR: 0.36, fx: 1 },
  { name: '약간 빠르게', dig: 0.12, depth: 0.085, digR: 0.42, dump: 0.09, dumpAmt: 0.04, mud: 0.06, mudAmt: 0.05, mudR: 0.42, fx: 0.6 },
  { name: '엄청 빠르게', dig: 0.04, depth: 0.11, digR: 0.5, dump: 0.035, dumpAmt: 0.09, mud: 0.03, mudAmt: 0.12, mudR: 0.5, fx: 0.3 },
];
// 삽 동작: 파기 = 날 쪽으로 쑥 찔러 넣기, 붓기 = 손잡이를 축으로 날을 옆으로 뒤집기
const SH = { idle: [0, 0, 0], dig: [-0.14, 0.04, 0], dump: [0.02, -0.05, 1.6] }; // [앞으로 밀기 m, 숙이기, 뒤집기]
function shPose(kind, dt) {
  const [push, tilt, roll] = SH[kind], k = Math.min(1, dt * 14);
  shInner.position.y += (push - shInner.position.y) * k;
  shInner.rotation.x += (tilt - shInner.rotation.x) * k;
  shInner.rotation.y += (roll - shInner.rotation.y) * k;
}
const PAINTS = [0xd94a3a, 0xf0b429, 0xf4f1e8, 0x3f8f5a, 0x2f6fd1, 0x8b4fc4, 0x2a2a2a];
const kg = m => (m >= 1000 ? (m / 1000).toFixed(1) + ' t' : Math.round(m) + ' kg');
export const P = {
  yaw: Math.PI, pitch: -0.25, vy: 0, grounded: false, tool: 'hand', held: null, holdDist: 1.7,
  holdYaw: 0, holdTilt: 0, speed: 0, bucket: 0, moved: 0, dug: 0, placed: 0, pour: 0, paint: 0xd94a3a, snap: false, bob: 0, stepAcc: 0, target: null, aim: null, inWater: 0,
};
const keys = new Set(), btn = { l: false, r: false }, touchMove = { x: 0, y: 0 };
let shInner, R, world, body, col, cc, camera, hooks, shovel, pick, load, ring, lastAct = 0, farT = 0, lockEl;
const fwd = new THREE.Vector3(), tmp = new THREE.Vector3(), qY = new THREE.Quaternion(), qT = new THREE.Quaternion(), qC = new THREE.Quaternion();

export function init(_R, _world, _camera, scene, _hooks, startPos) {
  R = _R; world = _world; camera = _camera; hooks = _hooks;
  body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(startPos.x, startPos.y, startPos.z));
  col = world.createCollider(R.ColliderDesc.capsule(0.55, 0.28).setFriction(0.5), body);
  cc = world.createCharacterController(0.03);
  cc.enableAutostep(0.42, 0.12, true); cc.enableSnapToGround(0.35);
  cc.setMaxSlopeClimbAngle(48 * Math.PI / 180); cc.setMinSlopeSlideAngle(55 * Math.PI / 180);
  cc.setApplyImpulsesToDynamicBodies(true); cc.setCharacterMass(70);
  buildShovel(); camera.add(shovel);
  buildPick(); camera.add(pick);
  ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe6a8, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  ring.visible = false; scene.add(ring);
  bindInput();
}
export const playerCollider = () => col;

function buildShovel() {
  shovel = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.7 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8d9296, roughness: 0.38, metalness: 0.85 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.95, 12), wood);
  handle.position.y = 0.42;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.14, 10).rotateZ(Math.PI / 2), wood); grip.position.y = 0.9;
  const bg = new THREE.BoxGeometry(0.22, 0.27, 0.006, 8, 8, 1), p = bg.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, p.getZ(i) + x * x * 1.4 - (y < -0.08 ? (y + 0.08) * 0 : 0)); if (y < -0.1) p.setX(i, x * (1 - (-0.1 - y) * 2.2)); }
  bg.computeVertexNormals();
  const blade = new THREE.Mesh(bg, metal); blade.position.y = -0.12;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.1, 10), metal); neck.position.y = 0.03;
  load = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10).scale(1, 0.45, 0.8), new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 1 }));
  load.position.set(0, -0.1, 0.035); load.visible = false;
  shInner = new THREE.Group(); shInner.add(handle, grip, blade, neck, load); shovel.add(shInner);
  shovel.traverse(o => { o.castShadow = false; });
  // 1인칭 자세: 손잡이 끝은 오른쪽 아래(손), 삽날은 화면 아래 가운데 앞쪽 땅을 향함. 날의 오목한 면이 위를 보게
  const G = new THREE.Vector3(0.36, -0.22, -0.28), N = new THREE.Vector3(0.1, -0.3, -1.0);
  const Y = G.clone().sub(N).normalize(), Z = new THREE.Vector3(0, 1, 0.8); Z.addScaledVector(Y, -Z.dot(Y)).normalize(); const X = new THREE.Vector3().crossVectors(Y, Z);
  shovel.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z)); shovel.position.copy(N);
  shovel.visible = false;
}

function buildPick() {
  pick = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e4a2c, roughness: 0.75 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x7d8288, roughness: 0.35, metalness: 0.9 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.85, 12), wood); handle.position.y = 0.36;
  const head = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.02, 8, 24, Math.PI * 0.85).scale(1, 0.55, 1), metal);
  head.rotation.z = Math.PI * 0.075; head.position.y = 0.66;
  const tip1 = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.07, 8), metal); tip1.position.set(0.205, 0.68, 0); tip1.rotation.z = -1.15;
  const tip2 = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.07, 8), metal); tip2.position.set(-0.2, 0.62, 0); tip2.rotation.z = 1.45;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.07, 12), metal); collar.position.y = 0.73;
  pick.add(handle, head, tip1, tip2, collar);
  pick.position.set(0.36, -0.55, -0.55); pick.rotation.set(-0.35, 0.1, 0.25);
  pick.visible = false;
}
function bindInput() {
  addEventListener('keydown', e => {
    if (e.repeat) return; keys.add(e.code);
    if (e.code === 'Digit1') setTool('hand');
    if (e.code === 'Digit2') setTool('shovel');
    if (e.code === 'Digit3') setTool('pick');
    if (e.code === 'Digit4') { if (P.tool === 'mud') { P.pour = (P.pour + 1) % 3; hooks.ui?.pour?.(P.pour); hooks.toast?.(`붓기: ${['진흙', '자갈', '시멘트'][P.pour]}`); } else setTool('mud'); }
    if (e.code === 'Digit6') setTool('dam');
    if (e.code === 'Digit7') setTool('erase');
    if (e.code === 'Digit8') setTool('flatten');
    if (e.code === 'Digit9') setTool('carve');
    if (e.code === 'Digit0') { if (P.tool === 'paint') { const i = (PAINTS.indexOf(P.paint) + 1) % PAINTS.length; P.paint = PAINTS[i]; hooks.ui?.paint?.(P.paint); hooks.toast?.('페인트 색 바꿈'); } else setTool('paint'); }
    if (e.code === 'KeyF') cycleSpeed();
    if (e.code === 'KeyE') primary();
    if (e.code === 'KeyQ') P.holdYaw += Math.PI / 6;
    if (e.code === 'KeyR') P.holdTilt += Math.PI / 6;
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); btn.l = btn.r = false; });
  addEventListener('mousedown', e => {
    if (!document.pointerLockElement) return;
    if (e.button === 0) { btn.l = true; if (P.tool === 'hand') primary(); }
    if (e.button === 2) { btn.r = true; if (P.tool === 'hand' && P.held) throwStone(); }
  });
  addEventListener('mouseup', e => { if (e.button === 0) btn.l = false; if (e.button === 2) btn.r = false; });
  addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('mousemove', e => {
    if (!document.pointerLockElement) return;
    look(e.movementX * 0.0022, e.movementY * 0.0022);
  });
  addEventListener('wheel', e => { if (P.held) P.holdDist = THREE.MathUtils.clamp(P.holdDist - Math.sign(e.deltaY) * 0.15, P.held.rb * 1.2 + 0.8, 3.0 + P.held.rb); }, { passive: true });
}
export function look(dx, dy) { P.yaw -= dx; P.pitch = THREE.MathUtils.clamp(P.pitch - dy, -1.45, 1.35); }
export function setTool(t) {
  if (P.held && t !== 'hand') drop(0);
  P.tool = t; shovel.visible = t === 'shovel' || t === 'mud' || t === 'flatten'; pick.visible = t === 'pick' || t === 'carve'; hooks.ui?.tool(t);
}
export function cycleSpeed() { P.speed = (P.speed + 1) % SPEEDS.length; hooks.ui?.speed?.(P.speed); hooks.toast?.(`작업 속도: ${SPEEDS[P.speed].name}`); }
export function toggleTool() { setTool(P.tool === 'hand' ? 'shovel' : P.tool === 'shovel' ? 'pick' : 'hand'); }
export const touch = { move: touchMove, btn, primary: () => primary(), secondary: () => { if (P.tool === 'hand' && P.held) throwStone(); }, rotate: () => { P.holdYaw += Math.PI / 6; }, jump: () => { P.jumpReq = true; } };

function primary() {
  if (P.tool !== 'hand') return;
  if (P.held) { drop(0); return; }
  const t = P.target;
  if (!t) return;
  if (t.cemented) { hooks.toast?.('시멘트로 굳어 붙었어요 — 곡괭이로 깨야 해요'); return; }
  if (t.fixed) S.makeDynamic(t); // 큰 바위도 들 수 있다 (무거울수록 느리게 움직임)
  P.held = t; t.held = true; t.moved = true;
  t.body.setGravityScale(0, true); t.body.setAngularDamping(4);
  t.body.resetForces(true);
  P.holdYaw = 0; P.holdTilt = 0;
  // 현재 돌 방향을 유지하도록 시작 회전 오프셋 기억
  const r = t.body.rotation(); qC.set(r.x, r.y, r.z, r.w);
  qY.setFromAxisAngle(tmp.set(0, 1, 0), P.yaw);
  t.qOff = qY.clone().invert().multiply(qC);
  P.holdDist = Math.max(THREE.MathUtils.clamp(P.aim?.dist ?? 1.7, 1.2, 2.2), t.rb * 1.2 + 0.8);
  hooks.audio?.lift();
}
function drop(speed) {
  const t = P.held; if (!t) return;
  t.held = false; P.held = null;
  t.body.setGravityScale(1, true); t.body.setAngularDamping(0.5);
  const v = t.body.linvel();
  if (speed) {
    camera.getWorldDirection(fwd);
    const k = Math.min(1, 45 / t.mass) * speed + 1.5;
    t.body.setLinvel({ x: fwd.x * k, y: fwd.y * k + 1, z: fwd.z * k }, true);
  } else t.body.setLinvel({ x: v.x * 0.3, y: Math.min(v.y, 0) * 0.3, z: v.z * 0.3 }, true);
  t.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  P.placed++;
}
function throwStone() { drop(8); hooks.audio?.whoosh(); }

// 물리 스텝 전에 호출
export function prePhysics(dt) {
  const t = P.held; if (!t) return;
  camera.getWorldDirection(fwd);
  const cp = camera.getWorldPosition(tmp);
  let tx = cp.x + fwd.x * P.holdDist, tz = cp.z + fwd.z * P.holdDist;
  let ty = cp.y + fwd.y * P.holdDist - 0.1;
  // 겨눈 곳이 가까우면(돌 위·돌 사이 틈·땅) 그 자리 바로 위에 맞춘다 → 놓으면 그대로 얹히거나 틈에 끼워진다
  const a = P.aim, rad = Math.max(t.ext[0], t.ext[1], t.ext[2]);
  P.snap = !!(a && a.dist < P.holdDist + rad * 1.5 && (a.normal?.y ?? 1) > -0.2);
  if (P.snap) { const n = a.normal || { x: 0, y: 1, z: 0 }, off = rad * 0.7 + 0.03; tx = a.point.x + n.x * off; tz = a.point.z + n.z * off; ty = a.point.y + Math.max(0.3, n.y) * off; }
  ty = Math.max(ty, T.groundAt(tx, tz) + t.ext[1] * 0.6);
  const p = t.body.translation();
  const k = THREE.MathUtils.clamp(Math.pow(70 / t.mass, 0.35), 0.18, 1);
  let vx = (tx - p.x) * 11 * k, vy = (ty - p.y) * 11 * k, vz = (tz - p.z) * 11 * k;
  const vm = Math.hypot(vx, vy, vz), vmax = 7 * k + 1;
  if (vm > vmax) { vx *= vmax / vm; vy *= vmax / vm; vz *= vmax / vm; }
  t.body.setLinvel({ x: vx, y: vy, z: vz }, true);
  qY.setFromAxisAngle(tmp.set(0, 1, 0), P.yaw + P.holdYaw);
  qT.copy(qY).multiply(new THREE.Quaternion().setFromAxisAngle(tmp.set(1, 0, 0), P.holdTilt)).multiply(t.qOff);
  const r = t.body.rotation(); qC.set(r.x, r.y, r.z, r.w);
  const qe = qT.clone().multiply(qC.clone().invert());
  if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; qe.w = -qe.w; }
  const ang = 2 * Math.acos(Math.min(1, qe.w)), s = Math.sqrt(1 - qe.w * qe.w) || 1;
  const w = Math.min(ang * 7 * k, 8);
  t.body.setAngvel({ x: qe.x / s * w, y: qe.y / s * w, z: qe.z / s * w }, true);
  const dist = Math.hypot(tx - p.x, ty - p.y, tz - p.z);
  farT = dist > 1.6 + (t.rb || 0) ? farT + dt : 0;
  if (farT > (t.mass > 1000 ? 2.5 : 0.6)) { drop(0); hooks.toast?.('돌을 놓쳤어요'); }
}

export function update(dt, time) {
  // 이동
  let mx = 0, mz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) mz += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) mz -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
  mx += touchMove.x; mz += touchMove.y;
  const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
  const p = body.translation();
  const ws = W.sample(p.x, p.z);
  const feet = p.y - 0.83;
  P.inWater = ws && ws.h > 0.01 ? Math.max(0, ws.surf - feet) : 0;
  // 수영: 가슴보다 깊은 물에서는 떠서 헤엄친다 (머리는 물 위, 물살에 떠밀림)
  const depth = ws && ws.h > 0.01 ? ws.surf - T.groundAt(p.x, p.z) : 0;
  const wasSwim = P.swim; P.swim = depth > (P.swim ? 0.95 : 1.15) && !P.held;
  if (P.swim && !wasSwim) { hooks.audio?.splash?.(0.5); hooks.fx?.splash(p.x, ws.surf, p.z, 0.5); hooks.toast?.('수영 중 — 아래를 보며 앞으로 가면 잠수, 점프로 떠올라요'); }
  let speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 5.2 : 3.0;
  if (P.swim) speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.3 : 1.5;
  if (P.held) speed *= 1 - Math.min(0.6, Math.pow(P.held.mass / 3000, 0.5) * 0.6);
  else if (P.inWater > 0.08) speed *= 0.62;
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  let dx = (-sy * mz + cy * mx) * speed, dz = (-cy * mz - sy * mx) * speed;
  if (P.swim) {
    // 잠수: 아래를 보며 앞으로 헤엄치면 물속으로, 가만히 있으면 천천히 떠오른다
    const under = p.y + 0.72 < ws.surf - 0.08, vDive = mz * speed * Math.sin(P.pitch) * 1.4;
    if (under || vDive < -0.15) {
      const k = Math.max(0.35, Math.cos(P.pitch)); dx *= k; dz *= k;
      P.vy += ((vDive + 0.3) - P.vy) * Math.min(1, dt * 3);
      if (keys.has('Space') || P.jumpReq) P.vy = Math.max(P.vy, 1.8);
    } else {
      const target = ws.surf - 0.48; // 눈이 물 위로 20cm 쯤 나오는 높이 (파도에 잠기지 않게)
      P.vy += ((target - p.y) * 7 - P.vy * 3) * dt;
      if (keys.has('Space') || P.jumpReq) P.vy = Math.max(P.vy, 2.6); // 위로 차고 올라가기 (기슭으로 나오기)
    }
    dx += ws.vx * 0.6; dz += ws.vz * 0.6; // 물살에 떠밀림
    P.grounded = false;
  } else {
    if (P.inWater > 0.3) { dx += (ws?.vx || 0) * 0.2; dz += (ws?.vz || 0) * 0.2; } // 허리까지 오면 물살에 조금 밀림
    P.vy -= 9.81 * dt;
    if (P.grounded && (keys.has('Space') || P.jumpReq)) { P.vy = 4.3; P.grounded = false; hooks.audio?.jump?.(); }
  }
  P.jumpReq = false;
  const held = P.held?.collider;
  cc.computeColliderMovement(col, { x: dx * dt, y: P.vy * dt, z: dz * dt }, undefined, undefined, c => c !== held);
  const mv = cc.computedMovement();
  let nx = p.x + mv.x, ny = p.y + mv.y, nz = p.z + mv.z;
  nx = THREE.MathUtils.clamp(nx, -16.5, 16.5); nz = THREE.MathUtils.clamp(nz, 1.5, 70.5); // 투명 벽: 지형 끝 근처
  const gmin = T.groundAt(nx, nz) + 0.83 - 0.05; if (ny < gmin - 0.3) ny = gmin;
  body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
  P.grounded = cc.computedGrounded();
  if (P.grounded && P.vy < 0) P.vy = -0.5;
  const hs = Math.hypot(mv.x, mv.z) / dt;
  if (P.swim && Math.hypot(mx, mz) > 0.1) { // 헤엄치는 물소리·물보라
    P.bob += dt * 3; P.stepAcc += dt;
    if (P.stepAcc > 0.9) { P.stepAcc = 0; hooks.audio?.splash?.(0.25); hooks.fx?.splash(nx + (Math.random() - 0.5) * 0.6, ws.surf, nz + (Math.random() - 0.5) * 0.6, 0.25); }
  } else if (P.grounded && hs > 0.4) {
    P.bob += dt * hs * 2.1; P.stepAcc += hs * dt;
    if (P.stepAcc > (speed > 4 ? 0.85 : 0.7)) {
      P.stepAcc = 0; hooks.audio?.step(P.inWater > 0.03); if (P.inWater > 0.03) hooks.fx?.splash(nx, feet + P.inWater, nz, 0.4);
      else if (T.trample(nx, nz)) hooks.grass?.(nx, nz); // 자주 밟은 풀은 눕고 닳아 길이 생긴다
    }
  }
  // 카메라
  camera.position.set(nx, ny + 0.72 + Math.sin(P.bob * 2) * 0.025, nz);
  camera.rotation.set(P.pitch, P.yaw, Math.sin(P.bob) * 0.006, 'YXZ');
  camera.updateMatrixWorld();
  aim();
  toolUpdate(dt, time);
}

const ray = { o: new THREE.Vector3(), d: new THREE.Vector3() };
function aim() {
  camera.getWorldPosition(ray.o); camera.getWorldDirection(ray.d);
  const held = P.held?.collider;
  const r = new R.Ray(ray.o, ray.d);
  const hit = world.castRayAndGetNormal(r, P.tool === 'drop' ? 30 : P.tool === 'paint' ? 6 : P.tool === 'dam' || P.tool === 'flatten' || P.tool === 'erase' ? 8 : 4.5, true, undefined, undefined, col, undefined, c => c !== held);
  P.target = null; P.aim = null;
  if (hit) {
    const toi = hit.timeOfImpact ?? hit.toi;
    const st = S.byHandle.get(hit.collider.handle);
    P.aim = { dist: toi, point: ray.o.clone().addScaledVector(ray.d, toi), stone: st, terrain: hit.collider === T.getHF(), block: D.byHandle.get(hit.collider.handle), plant: hooks.ownsPlant?.(hit.collider.handle), normal: hit.normal };
    if (st && toi < 3.2 + (st.rb || 0)) P.target = st;
  }
  const show = (P.tool === 'hand' || P.tool === 'pick') && !P.held ? P.target : null;
  S.setHighlight(show);
  let prompt = '';
  if ((P.tool === 'hand' || P.tool === 'pick') && !P.held && P.target) prompt = kg(P.target.mass);
  hooks.ui?.prompt(prompt, !!(P.held || P.target));
}

// 진흙 무한 붓기 / 하늘에서 바위 떨어뜨리기
function specialUpdate(dt, time) {
  const a = P.aim, drop = P.tool === 'drop', ok = a && a.dist < (drop ? 30 : 4.5);
  ring.visible = !!ok;
  if (ok) {
    ring.position.set(a.point.x, a.point.y + 0.03, a.point.z);
    ring.scale.setScalar(drop ? 1.8 : 1);
    ring.material.color.setHex(drop ? 0xffa45c : [0x9fe39a, 0xc8c2b8, 0xb9c3cc][P.pour]);
  }
  if (!drop) { // 삽에 진흙이 늘 가득
    load.visible = true; load.scale.setScalar(1.2);
    const busy = time - lastAct < 0.2;
    shPose(busy ? 'dump' : 'idle', dt);
  }
  if (!ok || !(btn.l || btn.r)) return;
  if (drop && time - lastAct > 0.45) { lastAct = time; hooks.dropRock?.(a.point.x, a.point.z); }
  else if (!drop && time - lastAct > SPEEDS[P.speed].mud) {
    const SP = SPEEDS[P.speed];
    lastAct = time;
    T.deposit(a.point.x, a.point.z, SP.mudR, SP.mudAmt, W, P.pour); // 0 진흙 · 1 자갈 · 2 시멘트
    if (Math.random() < SP.fx) {
      const ws = W.sample(a.point.x, a.point.z);
      if (ws && ws.h > 0.02) hooks.fx?.splash(a.point.x, ws.surf, a.point.z, 0.4); else hooks.fx?.dirt(a.point.x, T.groundAt(a.point.x, a.point.z) + 0.3, a.point.z, 6);
      if (Math.random() < 0.5) (hooks.audio?.pour ? hooks.audio.pour(P.pour) : hooks.audio?.dump());
    }
    hooks.edit?.(a.point.x, a.point.z, SP.mudR + 0.25);
  }
}
// 댐 도구: 좌클릭 콘크리트 블록 놓기(위에 쌓기·옆에 잇기), 우클릭 블록에 수력발전 터빈 달기/떼기
function damUpdate(dt, time) {
  const a = P.aim, ok = a && a.dist < 7;
  ring.visible = !!ok && !a.block; ring.scale.setScalar(2.4);
  if (ok) { ring.position.set(a.point.x, a.point.y + 0.03, a.point.z); ring.material.color.setHex(0xd8d4c8); }
  if (!ok) return;
  if (btn.l && time - lastAct > 0.35) {
    lastAct = time;
    const b = D.place(a.point, P.yaw, a.block, a.normal);
    if (b) { hooks.audio?.impact?.(0.6, false); hooks.fx?.dirt(b.x, b.y0 + 0.3, b.z, 8); hooks.damChanged?.(); }
  } else if (btn.r && time - lastAct > 0.5) {
    lastAct = time;
    if (!a.block) { hooks.toast?.('댐 블록을 겨누고 터빈을 다세요'); return; }
    const on = D.toggleTurbine(a.block);
    hooks.toast?.(on ? '수력발전 터빈 설치 — 댐 위아래 물높이 차이로 전기를 만들어요' : '터빈을 뗐어요');
    hooks.audio?.clink(); hooks.damChanged?.();
  }
}
// 지우개(돌·바위·댐 블록 없애기) · 땅 평평하게 · 바위 깎기
let flatTarget = null, prevL = false;
// ───── 페인트: 겨눈 돌·댐 블록·땅을 고른 색으로 칠한다 (처음엔 젖어 반짝이고 점점 마른다) ─────
function paintUpdate(dt, time) {
  const a = P.aim, ok = a && a.dist < 6;
  ring.visible = !!ok && !a.stone && !a.block; ring.scale.setScalar(1.2);
  if (ok) { ring.position.set(a.point.x, a.point.y + 0.03, a.point.z); ring.material.color.setHex(P.paint); }
  if (!btn.l || !ok || time - lastAct < 0.12) return;
  lastAct = time;
  const c = new THREE.Color(P.paint);
  if (a.stone && !a.stone.held) { if (a.stone.paint !== P.paint || !(a.stone.paintWet > 0)) { S.paint(a.stone, P.paint, true); hooks.audio?.brush?.(); } }
  else if (a.block) { D.paint(a.block, P.paint); }
  else T.paintAt(a.point.x, a.point.z, 0.4, [c.r, c.g, c.b]);
  if (Math.random() < 0.4) hooks.audio?.brush?.();
}
function editUpdate(dt, time) {
  const a = P.aim, tool = P.tool, SP = P.speed;
  const ok = a && a.dist < 8;
  const rad = tool === 'flatten' ? [0.9, 1.15, 1.5][SP] : tool === 'carve' ? [0.45, 0.55, 0.7][SP] : 0.4;
  ring.visible = !!ok && tool !== 'erase'; ring.scale.setScalar(rad / 0.33);
  if (ok) { ring.position.set(a.point.x, a.point.y + 0.03, a.point.z); ring.material.color.setHex(tool === 'carve' ? 0xb8c4d0 : 0xcfe8a8); }
  const pressed = btn.l && !prevL; prevL = btn.l;
  if (!btn.l) { flatTarget = null; return; }
  if (!ok) return;
  if (tool === 'erase') {
    if (time - lastAct < 0.18) return;
    lastAct = time;
    if (a.stone && !a.stone.held) { const st = a.stone; hooks.fx?.chips?.(st.cx, st.cy, st.cz, 14); S.removeStone(st); hooks.audio?.whoosh(); }
    else if (a.block) { const b = a.block; hooks.fx?.chips?.(b.x, b.y1, b.z, 16); D.remove(b); hooks.damChanged?.(); hooks.audio?.whoosh(); }
    else if (a.plant && pressed) hooks.demolishPlant?.();
    return;
  }
  if (tool === 'flatten') {
    if (pressed || flatTarget === null) flatTarget = T.groundAt(a.point.x, a.point.z); // 처음 누른 곳 높이에 맞춘다
    if (time - lastAct < 0.05) return;
    lastAct = time;
    T.flatten(a.point.x, a.point.z, rad, flatTarget, [0.02, 0.04, 0.08][SP], W);
    if (Math.random() < 0.15) { hooks.fx?.dirt(a.point.x, a.point.y + 0.05, a.point.z, 4); hooks.audio?.dump(); }
    hooks.edit?.(a.point.x, a.point.z, rad + 0.3);
    return;
  }
  // 바위 깎기
  if (time - lastAct < [0.14, 0.07, 0.035][SP]) return;
  lastAct = time;
  T.carve(a.point.x, a.point.z, rad, 0.05);
  if (Math.random() < 0.5) { hooks.fx?.chips?.(a.point.x, a.point.y, a.point.z, 6); hooks.audio?.chip?.(); }
  hooks.edit?.(a.point.x, a.point.z, rad + 0.2);
}
let swingT = -1;
function pickUpdate(dt, time) {
  // 휘두르기 애니메이션: 들어올렸다가 내려찍기
  const k = swingT >= 0 ? Math.min(1, (time - swingT) / 0.42) : 1;
  const rx = k < 0.45 ? -0.35 + 0.5 * (k / 0.45) : k < 0.7 ? 0.15 - 1.55 * ((k - 0.45) / 0.25) : -1.4 + 1.05 * ((k - 0.7) / 0.3);
  pick.rotation.x = k >= 1 ? -0.35 : rx;
  if (!btn.l || time - lastAct < 0.5) return;
  lastAct = time; swingT = time;
  const a = P.aim;
  setTimeout(() => strike(a), 210); // 내려찍는 순간
}
function strike(a) {
  if (!a || a.dist > 3.2) return;
  if (a.block) { // 콘크리트 블록도 여러 번 찍으면 부서진다
    const b = a.block; hooks.fx?.chips?.(a.point.x, a.point.y, a.point.z, 12);
    if (--b.hp > 0) { hooks.audio?.chip?.(); return; }
    D.remove(b); hooks.audio?.crack?.(0.8); hooks.damChanged?.(); hooks.toast?.('댐 블록을 부쉈어요'); return;
  }
  if (a.stone) {
    const st = a.stone;
    if (st.held || !S.stones.includes(st)) return;
    st.hp ??= Math.ceil(1 + Math.cbrt(st.mass) * 0.45);
    st.hp--;
    hooks.fx?.chips?.(a.point.x, a.point.y, a.point.z, 10);
    if (st.hp > 0) { hooks.audio?.chip?.(); return; }
    camera.getWorldDirection(fwd);
    const bp = body.translation(), parts = S.split(st, fwd, { x: bp.x, z: bp.z });
    hooks.audio?.crack?.(Math.min(1, st.r * 1.5));
    hooks.fx?.chips?.(a.point.x, a.point.y, a.point.z, 26);
    hooks.toast?.(parts.length ? `${parts.length}조각으로 깨졌어요` : '부서졌어요');
  } else if (a.terrain && T.hardNear(a.point.x, a.point.z)) { // 굳은 시멘트 깨기
    T.carve(a.point.x, a.point.z, 0.3, 0.1); hooks.edit?.(a.point.x, a.point.z, 0.5);
    hooks.audio?.chip?.(); hooks.fx?.chips?.(a.point.x, a.point.y, a.point.z, 14);
  } else { hooks.audio?.clink(); hooks.fx?.chips?.(a.point.x, a.point.y, a.point.z, 4); }
}
function toolUpdate(dt, time) {
  ring.scale.setScalar(1);
  if (P.tool === 'pick') { ring.visible = false; pickUpdate(dt, time); return; }
  if (P.tool === 'drop' || P.tool === 'mud') { specialUpdate(dt, time); return; }
  if (P.tool === 'dam') { damUpdate(dt, time); return; }
  if (P.tool === 'erase' || P.tool === 'flatten' || P.tool === 'carve') { editUpdate(dt, time); return; }
  if (P.tool === 'paint') { paintUpdate(dt, time); return; }
  if (P.tool === 'hand') { // 들고 있는 돌을 놓을 자리 표시 (돌 위·틈)
    const a = P.aim; ring.visible = !!(P.held && P.snap && a);
    if (ring.visible) { ring.position.set(a.point.x, a.point.y + 0.03, a.point.z); ring.scale.setScalar(Math.max(0.6, P.held.rb || 0.3) / 0.33); ring.material.color.setHex(0x9fd3ff); }
    return;
  }
  const a = P.aim, ok = P.tool === 'shovel' && a && a.dist < 4.2;
  ring.visible = !!ok; ring.scale.setScalar(1);
  if (ok) {
    ring.position.set(a.point.x, a.point.y + 0.03, a.point.z);
    ring.material.color.setHex(btn.r ? 0x9fe39a : 0xffe6a8);
  }
  // 삽 애니메이션
  const busy = time - lastAct < 0.25;
  shPose(busy ? (btn.r ? 'dump' : 'dig') : 'idle', dt);
  load.visible = P.bucket > 0.002; load.scale.setScalar(0.5 + Math.min(1, P.bucket / LOAD_VIS) * 0.7);
  const SP = SPEEDS[P.speed];
  if (!ok) return;
  if (btn.l && time - lastAct > SP.dig) {
    lastAct = time;
    const v = T.dig(a.point.x, a.point.z, SP.digR, SP.depth, W);
    if (v < 0.0004) { hooks.toast?.(T.hardNear(a.point.x, a.point.z) ? '굳은 시멘트는 곡괭이로 깨야 해요' : '바위는 팔 수 없어요'); hooks.audio?.clink(); return; }
    P.bucket += v; P.dug += v; // 삽에 담는 양 제한 없음
    if (Math.random() < SP.fx) hooks.fx?.dirt(a.point.x, T.groundAt(a.point.x, a.point.z), a.point.z, 14);
    if (Math.random() < SP.fx) hooks.audio?.dig();
    hooks.edit?.(a.point.x, a.point.z, SP.digR + 0.07);
  } else if (btn.r && time - lastAct > SP.dump) {
    lastAct = time;
    if (P.bucket < 0.0005) { hooks.toast?.('진흙이 없어요'); return; }
    const amt = Math.min(P.bucket, SP.dumpAmt);
    const used = T.deposit(a.point.x, a.point.z, 0.34 + P.speed * 0.06, amt, W);
    P.bucket = Math.max(0, P.bucket - used);
    if (used > 0) {
      const y = T.groundAt(a.point.x, a.point.z);
      if (Math.random() < SP.fx) { hooks.fx?.dirt(a.point.x, y + 0.4, a.point.z, 10); hooks.audio?.dump(); }
      const ws = W.sample(a.point.x, a.point.z); if (ws && ws.h > 0.02) hooks.fx?.splash(a.point.x, ws.surf, a.point.z, 0.6);
      hooks.edit?.(a.point.x, a.point.z, 0.6);
    }
  }
}
export function lock(el) { lockEl = el; try { const r = el.requestPointerLock?.(); r?.catch?.(() => {}); } catch {} }
export function holding() { return !!P.held; }
export function teleport(x, z) { body.setTranslation({ x, y: T.groundAt(x, z) + 0.9, z }, true); body.setNextKinematicTranslation({ x, y: T.groundAt(x, z) + 0.9, z }); P.vy = 0; }
