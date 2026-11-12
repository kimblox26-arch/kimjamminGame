// 전기를 쓰는 곳: 계곡 가로등과 오두막 (밤에 배터리/발전 전기로 불이 켜진다)
import * as THREE from 'three';
import { groundAt, centerX, floorHalf } from './terrain.js';

export const lamps = [], cabins = [];
const sites = [], lampSites = [];
// 지형 메시를 만들기 전에 호출: 집터를 평평하게 다지고, 돌이 놓이면 안 되는 자리를 돌려준다
export function prepare() {
  // 계곡 바닥이 넓은 곳, 강에서 멀리(벽 쪽) — 땅은 깎지 않고 콘크리트 기초 위에 짓는다
  for (const [z, side] of [[29, 1], [37, -1], [64, 1]]) {
    const F = floorHalf(z), yaw = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    // 가장 평평한 자리를 골라, 바닥은 땅 높이 아래쪽에 맞춘다 (높이 떠 보이지 않게, 오르막 쪽은 땅에 살짝 묻힘)
    let best = null;
    for (let f = 0.5; f <= 0.9; f += 0.05) {
      const x = centerX(z) + side * F * f; let gmin = 1e9, gmax = -1e9;
      for (const u of [-1.7, 0, 1.7]) for (const v of [-1.5, 0, 1.5]) { const g = groundAt(x + v, z + u); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); }
      if (!best || gmax - gmin < best.d - 0.05) best = { x, gmin, gmax, d: gmax - gmin };
    }
    const { x, gmin, gmax } = best;
    sites.push({ x, z, y: gmin + (gmax - gmin) * 0.25 + 0.05, base: gmin - 0.25, yaw, side });
  }
  for (let z = 9, n = 0; z < 69; z += 7.5, n++) {
    const side = n % 2 ? -1 : 1; lampSites.push({ x: centerX(z) + side * floorHalf(z) * 0.78, z, side });
  }
  return [...sites.map(t => [t.x, t.z, 3.0]), ...lampSites.map(l => [l.x, l.z, 0.7])];
}
const glow = [], pools = [];
let headMat, winMat;

function radial() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function fixedBox(R, world, x, y, z, hx, hy, hz, ry = 0) {
  const b = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(ry / 2), z: 0, w: Math.cos(ry / 2) }));
  world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz), b);
}

export function build(scene, R, world) {
  const tex = radial();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c3236, roughness: 0.5, metalness: 0.7 });
  headMat = new THREE.MeshStandardMaterial({ color: 0x3a3428, emissive: 0xffc37a, emissiveIntensity: 0, roughness: 0.4 });
  const pole = new THREE.CylinderGeometry(0.045, 0.065, 3, 8).translate(0, 1.5, 0);
  const arm = new THREE.BoxGeometry(0.55, 0.05, 0.05).translate(0.25, 2.95, 0);
  const head = new THREE.CylinderGeometry(0.1, 0.17, 0.16, 10).translate(0.5, 2.86, 0);
  const glowMat = new THREE.SpriteMaterial({ map: tex, color: 0xffc98a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
  const poolMat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffb870, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
  const poolGeo = new THREE.PlaneGeometry(7, 7).rotateX(-Math.PI / 2);
  for (const { x, z, side } of lampSites) {
    const y = groundAt(x, z);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(pole, dark), new THREE.Mesh(arm, dark), new THREE.Mesh(head, headMat));
    g.children.forEach(m => { m.castShadow = true; });
    g.position.set(x, y - 0.05, z); g.rotation.y = side > 0 ? Math.PI : 0; // 팔이 물 쪽을 향하게
    scene.add(g);
    const hx = x - side * 0.5;
    const sp = new THREE.Sprite(glowMat); sp.position.set(hx, y + 2.8, z); sp.scale.setScalar(1.6); scene.add(sp); glow.push(sp);
    const pool = new THREE.Mesh(poolGeo, poolMat); pool.position.set(hx, groundAt(hx, z) + 0.06, z); pool.renderOrder = 3; scene.add(pool); pools.push(pool);
    fixedBox(R, world, x, y + 1.5, z, 0.08, 1.5, 0.08);
    lamps.push(g);
  }
  // 오두막
  const wood = new THREE.MeshStandardMaterial({ color: 0x7b5a3e, roughness: 0.85 });
  const roofM = new THREE.MeshStandardMaterial({ color: 0x4a3a33, roughness: 0.75 });
  winMat = new THREE.MeshStandardMaterial({ color: 0x1e2a33, emissive: 0xffd69a, emissiveIntensity: 0, roughness: 0.2 });
  const plinthM = new THREE.MeshStandardMaterial({ color: 0x8f8a82, roughness: 0.9 });
  for (const { x, z, y, base, side } of sites) {
    const h = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.3, 2.8).translate(0, 1.15, 0), wood);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.4, 4).rotateY(Math.PI / 4).scale(1.05, 1, 0.92).translate(0, 3.0, 0), roofM);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.6).translate(0, 0.8, 1.41), roofM);
    const w1 = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.6).translate(-0.95, 1.35, 1.41), winMat);
    const w2 = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.6).translate(0.95, 1.35, 1.41), winMat);
    const w3 = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6).rotateY(Math.PI / 2).translate(1.61, 1.35, 0), winMat);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.5, y - base + 0.02, 3.1).translate(0, -(y - base) / 2, 0), plinthM); // 기초
    h.add(walls, roof, door, w1, w2, w3, plinth);
    h.children.forEach(m => { m.castShadow = true; m.receiveShadow = true; });
    h.position.set(x, y, z); h.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; // 문이 계곡을 향하게
    scene.add(h);
    const sp = new THREE.Sprite(glowMat); sp.position.set(x - side * 1.6, y + 1.3, z); sp.scale.setScalar(2.4); scene.add(sp); glow.push(sp);
    fixedBox(R, world, x, (base + y + 2.3) / 2, z, 1.7, (y + 2.3 - base) / 2, 1.5, h.rotation.y); // 기초까지 포함
    cabins.push(h);
  }
}
// f: 0(꺼짐)~1(켜짐), flick: 배터리가 거의 없을 때 깜빡임
export function setLit(f) {
  headMat.emissiveIntensity = f * 4; winMat.emissiveIntensity = f * 2.6;
  glow[0] && (glow[0].material.opacity = f * 0.9);
  pools[0] && (pools[0].material.opacity = f * 0.5);
}
export const demandKW = () => lamps.length * 0.1 + cabins.length * 0.6;
