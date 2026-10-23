import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World, G, radiusFor } from './physics.js';

const $ = id => document.getElementById(id);
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 20000);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.3, 0.9));
composer.addPass(new OutputPass());
scene.add(new THREE.AmbientLight(0xffffff, 0.12));

// 배경 별
{
  const n = 3000, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(8000);
    p.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(p, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1, sizeAttenuation: false })));
}

// ───── 천체 ─────
const sphere = new THREE.SphereGeometry(1, 48, 32);
const TRAIL = 500;
let world = new World(), uid = 0, sel = null, follow = null;
const PALETTE = [0x4f8cff, 0xff7a4f, 0x6fdc8c, 0xf2c94c, 0xbb6bd9, 0x56ccf2, 0xeb5757, 0xd9d9d9];

function addBody(o) {
  const b = { id: ++uid, name: o.name || `천체 ${uid}`, mass: o.mass, star: !!o.star, pos: o.pos, vel: o.vel,
    color: new THREE.Color(o.color ?? (o.star ? 0xffd27a : PALETTE[uid % PALETTE.length])) };
  b.radius = radiusFor(b.mass, b.star);
  const mat = b.star ? new THREE.MeshBasicMaterial({ color: b.color.clone().multiplyScalar(1.6) })
    : new THREE.MeshPhysicalMaterial({ color: b.color, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
  b.mesh = new THREE.Mesh(sphere, mat); b.mesh.userData.body = b;
  if (b.star) b.mesh.add(b.light = new THREE.PointLight(b.color, 3, 0, 0));
  const tg = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
  b.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: b.color, transparent: true, opacity: 0.45 }));
  b.trail.frustumCulled = false; b.tn = 0;
  scene.add(b.mesh, b.trail);
  world.bodies.push(b);
  return b;
}
function removeBody(b) {
  scene.remove(b.mesh, b.trail); b.mesh.material.dispose(); b.trail.geometry.dispose();
  if (sel === b) sel = null; if (follow === b) follow = null;
}
const heaviest = () => world.bodies.reduce((a, b) => (b.mass > a.mass ? b : a), world.bodies[0]);

// 원궤도 속도로 배치
function orbit(center, r, m, ang, o = {}) {
  const v = Math.sqrt(G * (center.mass + m) / r), c = Math.cos(ang), s = Math.sin(ang);
  return addBody({ ...o, mass: m, pos: [center.pos[0] + r * c, 0, center.pos[2] + r * s], vel: [center.vel[0] - v * s, 0, center.vel[2] + v * c] });
}

const SCENES = {
  solar: ['태양계', 170, () => {
    const sun = addBody({ name: '태양', mass: 1000, star: true, pos: [0, 0, 0], vel: [0, 0, 0] });
    const P = [['수성', 20, 0.05, 0xa8a29e], ['금성', 30, 0.8, 0xf2c94c], ['지구', 42, 1, 0x4f8cff], ['화성', 56, 0.1, 0xeb5757],
      ['목성', 90, 30, 0xe0a96d], ['토성', 130, 9, 0xf5deb3], ['천왕성', 170, 1.5, 0x7fdbda], ['해왕성', 210, 1.7, 0x3f6fff]];
    for (const [name, r, m, color] of P) {
      const p = orbit(sun, r, m, Math.random() * 6.28, { name, color });
      if (name === '지구') orbit(p, 2.4, 0.012, 0, { name: '달', color: 0xcccccc });
    }
  }],
  binary: ['쌍성계', 220, () => {
    const v = Math.sqrt(G * 500 / 60);
    addBody({ name: '항성 A', mass: 500, star: true, pos: [-15, 0, 0], vel: [0, 0, -v], color: 0xffc46b });
    addBody({ name: '항성 B', mass: 500, star: true, pos: [15, 0, 0], vel: [0, 0, v], color: 0x9cc8ff });
    const c = { mass: 1000, pos: [0, 0, 0], vel: [0, 0, 0] };
    orbit(c, 100, 2, 0, { name: '행성 1' }); orbit(c, 150, 5, 2.5, { name: '행성 2' });
  }],
  fig8: ['삼체 문제 (8자 궤도)', 70, () => {
    const L = 20, V = Math.sqrt(G * 100 / L), x = [0.97000436, -0.24308753], v = [-0.93240737, -0.86473146];
    addBody({ name: '별 1', mass: 100, star: true, pos: [x[0] * L, 0, x[1] * L], vel: [-v[0] / 2 * V, 0, -v[1] / 2 * V], color: 0xffa36b });
    addBody({ name: '별 2', mass: 100, star: true, pos: [-x[0] * L, 0, -x[1] * L], vel: [-v[0] / 2 * V, 0, -v[1] / 2 * V], color: 0x8fb8ff });
    addBody({ name: '별 3', mass: 100, star: true, pos: [0, 0, 0], vel: [v[0] * V, 0, v[1] * V], color: 0xfff1a8 });
  }],
  empty: ['빈 우주', 150, () => addBody({ name: '항성', mass: 1000, star: true, pos: [0, 0, 0], vel: [0, 0, 0] })],
};
for (const [k, [name]] of Object.entries(SCENES)) $('scene').add(new Option(name, k));

function load(k) {
  for (const b of world.bodies) removeBody(b);
  world = new World(); sel = follow = null;
  SCENES[k][2]();
  // 질량중심 정지 좌표계
  const M = world.bodies.reduce((s, b) => s + b.mass, 0);
  for (let i = 0; i < 3; i++) {
    const p = world.bodies.reduce((s, b) => s + b.mass * b.pos[i], 0) / M, v = world.bodies.reduce((s, b) => s + b.mass * b.vel[i], 0) / M;
    for (const b of world.bodies) { b.pos[i] -= p; b.vel[i] -= v; }
  }
  cam.dist = SCENES[k][1]; cam.target.set(0, 0, 0);
}

// ───── 카메라 ─────
const cam = { yaw: 0.6, pitch: 0.75, dist: 260, target: new THREE.Vector3() };
function updateCamera() {
  if (follow) cam.target.lerp(new THREE.Vector3(...follow.pos), 0.15);
  const c = Math.cos(cam.pitch);
  camera.position.set(c * Math.sin(cam.yaw), Math.sin(cam.pitch), c * Math.cos(cam.yaw)).multiplyScalar(cam.dist).add(cam.target);
  camera.lookAt(cam.target);
}

// ───── 입력 ─────
let drag = null, adding = false, place = null, lastClick = 0;
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = e => new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
function planePoint(e) { ray.setFromCamera(ndc(e), camera); return ray.ray.intersectPlane(plane, new THREE.Vector3()); }
function pick(e) {
  ray.setFromCamera(ndc(e), camera);
  const hit = ray.intersectObjects(world.bodies.map(b => b.mesh))[0];
  if (hit) return hit.object.userData.body;
  let best = null, bd = 14; // 작은 천체는 화면 거리로 선택
  for (const b of world.bodies) {
    const p = b.mesh.position.clone().project(camera), d = Math.hypot((p.x + 1) / 2 * innerWidth - e.clientX, (1 - p.y) / 2 * innerHeight - e.clientY);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
const arrow = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)), new THREE.LineBasicMaterial({ color: 0x6dffb0 }));
arrow.visible = false; arrow.frustumCulled = false; scene.add(arrow);

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
  if (adding) { plane.constant = -cam.target.y; const p = planePoint(e); if (p) place = { a: p, b: p.clone() }; }
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
  if (place) { const p = planePoint(e); if (p) place.b = p; return; }
  cam.yaw -= dx * 0.005; cam.pitch = Math.min(1.55, Math.max(-1.55, cam.pitch + dy * 0.005));
});
canvas.addEventListener('pointerup', e => {
  if (place) {
    const m = 10 ** +$('mass').value * ($('kind').value === 'star' ? 100 : 1), a = place.a;
    let vel;
    if (drag.moved < 6) { // 클릭: 가장 강하게 끌어당기는 천체 주위 원궤도
      const c = world.bodies.reduce((best, b) => { const f = b.mass / a.distanceToSquared(new THREE.Vector3(...b.pos)); return !best || f > best.f ? { b, f } : best; }, null);
      if (c) { const r = a.clone().sub(new THREE.Vector3(...c.b.pos)), v = Math.sqrt(G * (c.b.mass + m) / r.length()), t = new THREE.Vector3(-r.z, 0, r.x).normalize().multiplyScalar(v);
        vel = [c.b.vel[0] + t.x, c.b.vel[1], c.b.vel[2] + t.z]; } else vel = [0, 0, 0];
    } else { const d = place.b.clone().sub(a).multiplyScalar(0.12); vel = [d.x, 0, d.z]; } // 드래그: 던지기
    addBody({ mass: m, star: $('kind').value === 'star', pos: [a.x, a.y, a.z], vel });
    place = null;
  } else if (drag && drag.moved < 5) {
    const b = pick(e), now = performance.now();
    sel = b; if (b && now - lastClick < 350) follow = b;
    lastClick = now;
  }
  drag = null;
});
canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist = Math.min(5000, Math.max(3, cam.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });

// ───── UI ─────
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64];
let speedI = 2, paused = false;
const setSpeed = i => { speedI = Math.max(0, Math.min(SPEEDS.length - 1, i)); $('speed').textContent = SPEEDS[speedI] + '×'; };
$('scene').onchange = e => { load(e.target.value); e.target.blur(); };
$('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? '▶' : '⏸'; };
$('slow').onclick = () => setSpeed(speedI - 1); $('fast').onclick = () => setSpeed(speedI + 1);
$('reset').onclick = () => load($('scene').value);
$('add').onclick = () => { adding = !adding; $('add').classList.toggle('on', adding); canvas.style.cursor = adding ? 'crosshair' : ''; };
$('mass').oninput = () => { $('massv').textContent = (10 ** +$('mass').value * ($('kind').value === 'star' ? 100 : 1)).toPrecision(2); };
$('kind').onchange = $('mass').oninput;
$('follow').onclick = () => { follow = sel; };
$('del').onclick = () => { if (sel) { world.bodies = world.bodies.filter(b => b !== sel); removeBody(sel); } };
addEventListener('keydown', e => {
  if (e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); $('pause').click(); }
  if (e.code === 'Escape') { follow = null; if (adding) $('add').click(); }
});
function toast(msg) {
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; $('toasts').append(d);
  setTimeout(() => d.remove(), 2500);
}
function resize() { renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ───── 루프 ─────
let last = performance.now(), frame = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!paused) world.advance(dt * SPEEDS[speedI]);
  for (const { big, small } of world.events) { removeBody(small); toast(`💥 ${small.name} → ${big.name} 충돌`); if (sel === small) sel = big; }
  world.events.length = 0;
  const showTrail = $('trails').checked;
  frame++;
  for (const b of world.bodies) {
    b.mesh.position.set(...b.pos); b.mesh.scale.setScalar(b.radius);
    if (b.star && !b.light) b.mesh.add(b.light = new THREE.PointLight(b.color, 3, 0, 0));
    const arr = b.trail.geometry.attributes.position.array;
    if (frame % 2 === 0) {
      if (b.tn === TRAIL) arr.copyWithin(0, 3); else b.tn++;
      arr.set(b.pos, (b.tn - 1) * 3); b.trail.geometry.attributes.position.needsUpdate = true; b.trail.geometry.setDrawRange(0, b.tn);
    }
    b.trail.visible = showTrail;
  }
  arrow.visible = !!place;
  if (place) { arrow.geometry.attributes.position.array.set([...place.a.toArray(), ...place.b.toArray()]); arrow.geometry.attributes.position.needsUpdate = true; }
  updateCamera();
  composer.render();
  if (frame % 10 === 0) {
    $('info').classList.toggle('hidden', !sel);
    if (sel) {
      const h = heaviest(), sp = Math.hypot(...sel.vel), d = h && h !== sel ? Math.hypot(sel.pos[0] - h.pos[0], sel.pos[1] - h.pos[1], sel.pos[2] - h.pos[2]) : 0;
      $('info-name').textContent = sel.name; $('info-name').style.color = '#' + sel.color.getHexString();
      $('info-body').innerHTML = `질량 ${sel.mass.toPrecision(3)}<br>반지름 ${sel.radius.toFixed(2)}<br>속도 ${sp.toFixed(2)}` + (d ? `<br>${h.name}까지 ${d.toFixed(1)}` : '');
    }
    $('count').textContent = `천체 ${world.bodies.length}개 · 시간 ${world.t.toFixed(0)}`;
  }
}
load('solar');
requestAnimationFrame(loop);
