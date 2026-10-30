// 시작점: 렌더러, 게임 루프, NPC·자동차 만들기
import * as THREE from 'three';
import { G } from './game.js';
import { World } from './world.js';
import { Gore } from './gore.js';
import { NPC } from './npc.js';
import { Car } from './vehicle.js';
import { Player } from './player.js';
import { UI, Input } from './ui.js';
import { Sound } from './audio.js';
import { updateWeapons } from './weapons.js';

const mobile = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: !mobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
camera.rotation.order = 'YXZ';
Object.assign(G, { scene, camera, renderer, input: Input, sound: Sound, ui: UI, mobile });

G.world = new World(scene);
if (mobile) G.world.sun.shadow.mapSize.set(1024, 1024);
G.gore = new Gore(scene);
G.player = new Player(camera);
UI.init();
G.player.spawn();

for (const c of [[28, -10, 0, '#d42a2a'], [-30, 25, Math.PI / 2, '#1e63d6'], [45, 50, Math.PI, '#f2b705'], [-55, -45, -Math.PI / 4, '#2e9d4a']]) G.cars.push(new Car(...c));

const COUNT = mobile ? 14 : 20;
function spawnNPC(near) {
  let p;
  for (let i = 0; i < 20; i++) {
    p = near ? G.world.randomOpen(2, G.world.spawn, 70) : G.world.randomOpen(2);
    if (near ? p.length() > 12 : p.distanceTo(G.player.pos) > 70) break;
  }
  G.npcs.push(new NPC(p));
}
for (let i = 0; i < COUNT; i++) spawnNPC(i < COUNT * 0.6);

G.onPlayerChat = (text) => {
  UI.chat(G.player.name, text, '#ffffff');
  const near = G.npcs.filter((n) => n.alive && !n.down && n.pos.distanceTo(G.player.pos) < 40).sort((a, b) => a.pos.distanceTo(G.player.pos) - b.pos.distanceTo(G.player.pos)).slice(0, 2);
  near.forEach((n, i) => setTimeout(() => n.respond(text), 700 + i * 1100 + Math.random() * 500));
};

// 캐릭터끼리 겹치지 않게
function separate() {
  const arr = G.npcs.filter((n) => n.alive && !n.down);
  const P = G.player;
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    for (let j = i + 1; j < arr.length; j++) {
      const b = arr[j], dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 4.4 && d2 > 1e-6) { const d = Math.sqrt(d2), k = ((2.1 - d) / d) * 0.5; a.pos.x -= dx * k; a.pos.z -= dz * k; b.pos.x += dx * k; b.pos.z += dz * k; }
    }
    if (P.alive && !P.car) {
      const dx = P.pos.x - a.pos.x, dz = P.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 4.6 && d2 > 1e-6 && Math.abs(P.pos.y - a.pos.y) < 4) { const d = Math.sqrt(d2), k = (2.15 - d) / d; P.pos.x += dx * k * 0.7; P.pos.z += dz * k * 0.7; a.pos.x -= dx * k * 0.3; a.pos.z -= dz * k * 0.3; }
    }
  }
}
let houseT = 0;
function housekeeping(dt) {
  if ((houseT -= dt) > 0) return;
  houseT = 6;
  while (G.corpses.length > (mobile ? 8 : 14)) G.corpses.shift().dispose();
  if (G.npcs.filter((n) => n.alive).length < COUNT) spawnNPC(false);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  const vc = G.player.vm.cam; vc.aspect = camera.aspect; vc.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!G.paused) {
    G.time += dt;
    UI.poll();
    for (const c of G.cars) c.update(dt);
    G.player.update(dt, Input);
    for (const n of [...G.npcs]) n.update(dt);
    separate();
    updateWeapons(dt);
    G.gore.update(dt);
    housekeeping(dt);
    Input.consume();
  }
  G.world.update(dt, G.player.pos);
  Sound.listener(camera);
  UI.update(dt, camera);
  renderer.clear();
  renderer.render(scene, camera);
  if (G.player.vm.cur) { renderer.clearDepth(); renderer.render(G.player.vm.scene, G.player.vm.cam); }
}
requestAnimationFrame(frame);
window.__G = G;
