// SPIDER ARMS — 로블록스 스타일 캐릭터 + 거대 기계 거미팔 (procedural IK)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ───────────────────────── 렌더러 ─────────────────────────
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd6e8fb, 200, 700);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 1500);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

// ───────────────────────── 푸른 하늘 + 하얀 바닥 ─────────────────────────
const SUN_DIR = V(0.45, 0.8, 0.35).normalize();
function makeSky(r) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sun: { value: SUN_DIR } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec3 vP; uniform vec3 sun;
      void main(){ float h = max(vP.y, 0.);
        vec3 c = mix(vec3(0.84,0.91,0.98), vec3(0.16,0.45,0.9), pow(smoothstep(0.,0.6,h), 0.8));
        float s = max(dot(vP, sun), 0.);
        c += vec3(1.,0.95,0.85)*(pow(s,40.)*0.35 + smoothstep(0.9985,0.9995,s)*2.);
        gl_FragColor = vec4(c,1.); }`
  }));
}
scene.add(makeSky(900));
{ // 반사용 환경맵 (하늘 + 하얀 바닥)
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene();
  es.add(makeSky(50));
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({ color: 0x777777 }));
  fl.rotation.x = -Math.PI / 2; fl.position.y = -2; es.add(fl);
  scene.environment = pm.fromScene(es, 0.03).texture;
}
scene.add(new THREE.HemisphereLight(0xbfdcff, 0xb0b0b0, 0.6));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 200 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// ───────────────────────── 재질 ─────────────────────────
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const M = {
  skin: new THREE.MeshStandardMaterial({ color: 0xf5cd30, roughness: 0.5 }),
  shirt: new THREE.MeshStandardMaterial({ color: 0x0d69ac, roughness: 0.55 }),
  pants: new THREE.MeshStandardMaterial({ color: 0xa4bd47, roughness: 0.55 }),
  gun: new THREE.MeshStandardMaterial({ color: 0x1e2329, metalness: 0.7, roughness: 0.38 }),
  plate: new THREE.MeshStandardMaterial({ color: 0x5b6573, metalness: 0.85, roughness: 0.28 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 1, roughness: 0.12 }),
  red: new THREE.MeshStandardMaterial({ color: 0xb8262c, metalness: 0.6, roughness: 0.35 }),
  glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3ef0ff).multiplyScalar(1.5), toneMapped: false }),
};
function roundedBox(w, h, d, r = 0.12) {
  const s = new THREE.Shape(), x = -w / 2 + r, y = -h / 2 + r, ww = w - 2 * r, hh = h - 2 * r;
  s.moveTo(x, y); s.lineTo(x + ww, y); s.lineTo(x + ww, y + hh); s.lineTo(x, y + hh); s.lineTo(x, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r, bevelEnabled: true, bevelSize: r, bevelThickness: r, bevelSegments: 4, curveSegments: 4 });
  g.translate(0, 0, -(d - 2 * r) / 2); g.computeVertexNormals(); return g;
}
const shadowAll = o => o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });

// ───────────────────────── 로블록스 캐릭터 (R6) ─────────────────────────
function buildCharacter() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const torso = new THREE.Mesh(roundedBox(2, 2, 1, 0.1), M.shirt); torso.position.y = 3; body.add(torso);
  const prof = [new THREE.Vector2(0, -0.6)];
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI / 2; prof.push(new THREE.Vector2(0.5 + Math.cos(a) * 0.14, -0.46 + Math.sin(a) * 0.14)); }
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; prof.push(new THREE.Vector2(0.5 + Math.cos(a) * 0.14, 0.46 + Math.sin(a) * 0.14)); }
  prof.push(new THREE.Vector2(0, 0.6));
  const face = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#f5cd30'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#111';
    [-48, 48].forEach(dx => { g.beginPath(); g.ellipse(w / 2 + dx, h * 0.38, 13, 26, 0, 0, Math.PI * 2); g.fill(); });
    g.lineWidth = 11; g.lineCap = 'round'; g.strokeStyle = '#111';
    g.beginPath(); g.arc(w / 2, h * 0.42, 78, Math.PI * 0.2, Math.PI * 0.8); g.stroke();
  });
  const head = new THREE.Mesh(new THREE.LatheGeometry(prof, 40, Math.PI), new THREE.MeshStandardMaterial({ map: face, roughness: 0.5 }));
  head.position.y = 4.62; body.add(head);
  const limb = (mat, px, py, oy) => {
    const p = new THREE.Group(); p.position.set(px, py, 0);
    const m = new THREE.Mesh(roundedBox(1, 2, 1, 0.1), mat); m.position.y = oy; p.add(m); body.add(p); return p;
  };
  const armL = limb(M.skin, 1.5, 3.6, -0.6), armR = limb(M.skin, -1.5, 3.6, -0.6);
  const legL = limb(M.pants, 0.5, 2, -1), legR = limb(M.pants, -0.5, 2, -1);
  // 기계 백팩 (거미팔 장착부)
  const pack = new THREE.Group(); pack.position.set(0, 3.1, -0.9); body.add(pack);
  pack.add(new THREE.Mesh(roundedBox(2.1, 2.2, 0.9, 0.18), M.gun));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 10, 32), M.chrome); ring.position.z = -0.48; pack.add(ring);
  const core = new THREE.Mesh(new THREE.CircleGeometry(0.43, 32), M.glow); core.position.z = -0.49; core.rotation.y = Math.PI; pack.add(core);
  for (let i = 0; i < 3; i++) { const v = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.09, 0.1), M.plate); v.position.set(0, 0.75 - i * 0.16, -0.48); pack.add(v); }
  shadowAll(root);
  return { root, body, head, armL, armR, legL, legR };
}

// ───────────────────────── 거대 기계 거미팔 ─────────────────────────
function makeSegment(r) {
  const g = new THREE.Group();
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); g.add(m); };
  add(new THREE.CylinderGeometry(r, r * 0.8, 1, 16).rotateX(Math.PI / 2).translate(0, 0, 0.5), M.gun);
  add(new THREE.BoxGeometry(r * 1.6, r * 0.55, 0.78).translate(0, r * 0.75, 0.5), M.plate);
  add(new THREE.BoxGeometry(r * 0.35, r * 0.2, 0.7).translate(0, r * 1.08, 0.5), M.glow);
  add(new THREE.CylinderGeometry(r * 0.22, r * 0.22, 0.9, 10).rotateX(Math.PI / 2).translate(0, -r * 0.85, 0.48), M.chrome);
  add(new THREE.BoxGeometry(r * 2.1, r * 0.5, 0.08).translate(0, 0, 0.1), M.red);
  shadowAll(g); return g;
}
const LS = 1.75; // 다리 크기 배율
function makeLeg(side, front) {
  const L = { side, front, a: (front ? 2.7 : 2.5) * LS, b: (front ? 3.3 : 3.1) * LS, foot: V(), planted: null, step: null };
  L.root = V(side * 0.7, front ? 3.9 : 2.5, -1.3);
  L.home = V(side * 5.2, 0, front ? 3.6 : -4.2);
  L.hip = new THREE.Mesh(new THREE.SphereGeometry(0.4 * LS, 20, 14), M.chrome);
  L.upper = makeSegment(0.33 * LS); L.lower = makeSegment(0.26 * LS);
  L.knee = new THREE.Group();
  L.knee.add(new THREE.Mesh(new THREE.SphereGeometry(0.36 * LS, 18, 12), M.gun));
  L.knee.add(new THREE.Mesh(new THREE.TorusGeometry(0.36 * LS, 0.06 * LS, 8, 24), M.glow));
  L.claw = new THREE.Group();
  L.claw.add(new THREE.Mesh(new THREE.ConeGeometry(0.2 * LS, 0.9 * LS, 10).rotateX(Math.PI / 2).translate(0, 0, 0.35 * LS), M.chrome));
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.08 * LS, 0.6 * LS, 6).rotateX(Math.PI / 2).translate(0, 0, 0.3 * LS), M.plate);
    c.position.x = s * 0.18 * LS; c.rotation.y = s * 0.45; L.claw.add(c);
  }
  [L.hip, L.upper, L.lower, L.knee, L.claw].forEach(o => { scene.add(o); shadowAll(o); });
  return L;
}
const _n = V(), _p = V(), _t = V();
function place(seg, A, B) { seg.position.copy(A); seg.lookAt(B); seg.scale.set(1, 1, A.distanceTo(B)); }
function solveIK(L, rootW, target, pole) {
  const a = L.a, b = L.b;
  const d = clamp(rootW.distanceTo(target), Math.abs(a - b) + 0.01, a + b - 0.001);
  _n.subVectors(target, rootW).normalize();
  const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
  _p.subVectors(pole, rootW); _p.addScaledVector(_n, -_p.dot(_n)).normalize();
  const knee = rootW.clone().addScaledVector(_n, x).addScaledVector(_p, h);
  const foot = rootW.clone().addScaledVector(_n, d);
  L.hip.position.copy(rootW);
  place(L.upper, rootW, knee); place(L.lower, knee, foot);
  L.knee.position.copy(knee); L.knee.lookAt(_t.copy(knee).add(_p));
  L.claw.position.copy(foot); L.claw.lookAt(_t.copy(foot).multiplyScalar(2).sub(knee));
}

// ───────────────────────── 플레이어 ─────────────────────────
const char = buildCharacter(); scene.add(char.root);
const legs = [makeLeg(1, true), makeLeg(-1, true), makeLeg(1, false), makeLeg(-1, false)]; // FL FR BL BR
const GAIT = [0, 1, 1, 0];
const P = { pos: V(), vel: V(), yaw: 0, onGround: true, walkPhase: 0 };
const GRAV = 62;

// ───────────────────────── 입력 (키보드/마우스 + 터치) ─────────────────────────
const keys = {}; let locked = false, started = false;
let camYaw = Math.PI * 0.8, camPitch = 0.3, camDist = 18;
const touch = { mx: 0, my: 0, run: false, jump: false };
addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('mousedown', () => { if (started && !TOUCH && !locked) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
addEventListener('mousemove', e => {
  if (!locked) return;
  camYaw -= e.movementX * 0.0025;
  camPitch = clamp(camPitch + e.movementY * 0.0022, -0.4, 1.3);
});
addEventListener('wheel', e => { camDist = clamp(camDist + Math.sign(e.deltaY) * 1.5, 9, 36); });

if (TOUCH) {
  document.body.classList.add('touch');
  const stick = document.getElementById('stick'), knob = document.getElementById('knob');
  let stickId = null, camId = null, cx = 0, cy = 0, lx = 0, ly = 0, pinch = null;
  const RAD = 55;
  const tdist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  addEventListener('touchstart', e => {
    if (!started) return;
    for (const t of e.changedTouches) {
      if (t.target.closest && t.target.closest('#jumpBtn')) continue;
      if (t.clientX < innerWidth * 0.45 && stickId === null) {
        stickId = t.identifier; cx = t.clientX; cy = t.clientY;
        stick.style.left = cx + 'px'; stick.style.top = cy + 'px'; stick.classList.add('on');
      } else if (camId === null) { camId = t.identifier; lx = t.clientX; ly = t.clientY; }
    }
    if (e.touches.length === 2 && stickId === null) pinch = tdist(e);
  }, { passive: false });
  addEventListener('touchmove', e => {
    e.preventDefault();
    if (pinch !== null && e.touches.length === 2) { const d = tdist(e); camDist = clamp(camDist * pinch / d, 9, 36); pinch = d; return; }
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        let dx = t.clientX - cx, dy = t.clientY - cy; const l = Math.hypot(dx, dy);
        if (l > RAD) { dx *= RAD / l; dy *= RAD / l; }
        knob.style.transform = `translate(${dx}px,${dy}px)`;
        touch.mx = dx / RAD; touch.my = -dy / RAD; touch.run = l > RAD * 0.95;
      } else if (t.identifier === camId) {
        camYaw -= (t.clientX - lx) * 0.006; camPitch = clamp(camPitch + (t.clientY - ly) * 0.005, -0.4, 1.3);
        lx = t.clientX; ly = t.clientY;
      }
    }
  }, { passive: false });
  const end = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { stickId = null; touch.mx = touch.my = 0; touch.run = false; knob.style.transform = ''; stick.classList.remove('on'); }
      if (t.identifier === camId) camId = null;
    }
    if (e.touches.length < 2) pinch = null;
  };
  addEventListener('touchend', end); addEventListener('touchcancel', end);
  const jb = document.getElementById('jumpBtn');
  jb.addEventListener('touchstart', e => { e.preventDefault(); touch.jump = true; }, { passive: false });
  jb.addEventListener('touchend', e => { e.preventDefault(); touch.jump = false; });
}

// ───────────────────────── 발소리 (합성) ─────────────────────────
let AC = null;
function clank(vol = 0.05) {
  if (!AC) return;
  const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
  o.connect(g); g.connect(AC.destination); o.type = 'square';
  o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.07);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  o.start(t); o.stop(t + 0.09);
}

// ───────────────────────── 플레이어 물리 ─────────────────────────
function updatePlayer(dt) {
  const fwdC = V(-Math.sin(camYaw), 0, -Math.cos(camYaw)), rightC = V(Math.cos(camYaw), 0, -Math.sin(camYaw));
  const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + touch.my;
  const r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + touch.mx;
  const wish = V().addScaledVector(fwdC, f).addScaledVector(rightC, r);
  const mag = Math.min(1, wish.length()); const moving = mag > 0.08;
  if (moving) wish.normalize().multiplyScalar(mag);
  const speed = (keys.ShiftLeft || keys.ShiftRight || touch.run) ? 28 : 16;
  const k = damp(P.onGround ? 12 : 3, dt);
  P.vel.x += (wish.x * speed - P.vel.x) * k;
  P.vel.z += (wish.z * speed - P.vel.z) * k;
  P.vel.y -= GRAV * dt;
  const jump = keys.Space || touch.jump;
  if (jump && !P.jumpHeld && P.onGround) { P.vel.y = 25; clank(0.08); }
  P.jumpHeld = jump;
  P.pos.addScaledVector(P.vel, dt);
  const wasAir = !P.onGround;
  P.onGround = false;
  if (P.pos.y <= 0) { if (wasAir && P.vel.y < -25) clank(0.12); P.pos.y = 0; P.vel.y = 0; P.onGround = true; }

  const hv = Math.hypot(P.vel.x, P.vel.z);
  if (moving && hv > 1) {
    let dy = Math.atan2(P.vel.x, P.vel.z) - P.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    P.yaw += dy * damp(10, dt);
  }
  char.root.position.copy(P.pos); char.root.rotation.y = P.yaw;
  char.root.updateMatrixWorld(true);
  animateCharacter(dt, hv);
}

// ───────────────────────── 캐릭터 애니메이션 ─────────────────────────
const anim = { aL: 0, aR: 0, lL: 0, lR: 0, azL: 0, azR: 0, lean: 0, bob: 0, t: 0 };
function animateCharacter(dt, hv) {
  anim.t += dt;
  let aL = 0, aR = 0, lL = 0, lR = 0, azL = 0.05, azR = -0.05, lean = 0, bob = 0;
  if (!P.onGround) {
    aL = aR = -2.9; lL = 0.25; lR = -0.25; azL = 0.15; azR = -0.15;
  } else if (hv > 0.5) {
    P.walkPhase += dt * hv * 0.5;
    const amp = Math.min(1, hv / 16) * 0.95, s = Math.sin(P.walkPhase);
    lL = s * amp; lR = -s * amp; aL = -s * amp * 0.9; aR = s * amp * 0.9;
    lean = Math.min(hv / 28, 1) * 0.14; bob = Math.abs(Math.cos(P.walkPhase)) * 0.12 * amp;
  } else {
    const br = Math.sin(anim.t * 2);
    azL = 0.06 + br * 0.03; azR = -0.06 - br * 0.03; bob = br * 0.02;
  }
  const k = damp(16, dt);
  for (const [key, v] of Object.entries({ aL, aR, lL, lR, azL, azR, lean, bob })) anim[key] += (v - anim[key]) * k;
  char.armL.rotation.set(anim.aL, 0, anim.azL); char.armR.rotation.set(anim.aR, 0, anim.azR);
  char.legL.rotation.x = anim.lL; char.legR.rotation.x = anim.lR;
  char.body.rotation.x = anim.lean; char.body.position.y = anim.bob;
  char.head.rotation.y = Math.sin(anim.t * 0.7) * 0.08;
}

// ───────────────────────── 거미팔 걷기 ─────────────────────────
function updateLegs(dt) {
  const hv = Math.hypot(P.vel.x, P.vel.z);
  const stepping = [false, false];
  legs.forEach((L, i) => { if (L.step) stepping[GAIT[i]] = true; });
  legs.forEach((L, i) => {
    const rootW = char.root.localToWorld(L.root.clone());
    const pole = char.root.localToWorld(V(L.side * 5, 9, L.front ? 1.5 : -4));
    if (L.step) {
      L.step.t += dt / L.step.dur;
      const t = Math.min(1, L.step.t), e = t * t * (3 - 2 * t);
      L.foot.lerpVectors(L.step.from, L.step.to, e); L.foot.y += Math.sin(Math.PI * t) * 2;
      if (t >= 1) { L.planted = L.step.to.clone(); L.step = null; clank(); }
    } else if (P.onGround) {
      const desired = char.root.localToWorld(L.home.clone()).addScaledVector(P.vel, 0.14).setY(0);
      const thr = 2.2 + hv * 0.1;
      const far = !L.planted || L.planted.distanceTo(desired) > thr;
      const over = L.planted && L.planted.distanceTo(rootW) > (L.a + L.b) * 0.99;
      if ((far && !stepping[1 - GAIT[i]]) || over) {
        L.step = { from: L.foot.clone(), to: desired, t: 0, dur: Math.max(0.1, 0.24 - hv * 0.005) };
        stepping[GAIT[i]] = true;
      } else L.foot.copy(L.planted);
    } else {
      L.planted = null;
      const sway = Math.sin(anim.t * 3 + i) * 0.6;
      const dangle = char.root.localToWorld(V(L.side * (4.4 + sway), L.front ? 0.5 : -0.5, L.front ? 3.2 : -3.8));
      L.foot.lerp(dangle, damp(8, dt));
    }
    solveIK(L, rootW, L.foot, pole);
  });
}

// ───────────────────────── 카메라 ─────────────────────────
const camTarget = V(0, 4, 0);
function updateCamera(dt) {
  camTarget.lerp(_t.copy(P.pos).add(V(0, 4.5, 0)), damp(12, dt));
  const dir = V(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
  camera.position.copy(camTarget).addScaledVector(dir, camDist);
  camera.position.y = Math.max(camera.position.y, 0.5);
  camera.lookAt(camTarget.x, camTarget.y + 1.5, camTarget.z);
  sun.position.copy(P.pos).addScaledVector(SUN_DIR, 80); sun.target.position.copy(P.pos);
}

// ───────────────────────── 시작 ─────────────────────────
document.getElementById('play').onclick = () => {
  document.getElementById('start').classList.add('hidden');
  AC = AC || new (window.AudioContext || window.webkitAudioContext)();
  started = true;
  if (!TOUCH) canvas.requestPointerLock();
};
char.root.updateMatrixWorld(true);
legs.forEach(L => { L.foot.copy(char.root.localToWorld(L.home.clone())).setY(0); L.planted = L.foot.clone(); });

const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  if (started) updatePlayer(dt);
  else { camYaw += dt * 0.12; animateCharacter(dt, 0); }
  updateLegs(dt);
  updateCamera(dt);
  composer.render();
  requestAnimationFrame(loop);
}
loop();
