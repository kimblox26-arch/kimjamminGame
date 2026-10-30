// 맵: 하얀 바닥 + 파란 하늘 (그 밖의 것은 없음)
import * as THREE from 'three';
import { G } from './game.js';

export const BOUND = 240;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.boxes = [];
    this.spawn = new THREE.Vector3(0, 0, 0);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color('#2b7ff2') }, hor: { value: new THREE.Color('#9fd0ff') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 top, hor; varying vec3 vP;
        void main(){ gl_FragColor = vec4(mix(hor, top, clamp(vP.y / 0.5, 0., 1.)), 1.0);
        #include <colorspace_fragment>
        }`,
    }));
    scene.add(sky); this.sky = sky;
    scene.fog = new THREE.Fog('#9fd0ff', 300, 1100);
    scene.add(new THREE.HemisphereLight('#e2f0ff', '#ffffff', 1.85));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -80; sc.right = sc.top = 80; sc.near = 1; sc.far = 400;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.4;
    scene.add(sun, sun.target);
    this.sun = sun;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshLambertMaterial({ color: '#ffffff' }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    ground.userData = { kind: 'world', ground: true };
    scene.add(ground); G.hitList.push(ground);
    // 보이지 않는 경계 (멀리 나가지 않게)
    const B = BOUND, t = 4, h = 30;
    for (const [x, z, w, d] of [[0, -B - t, 2 * B + 4 * t, 2 * t], [0, B + t, 2 * B + 4 * t, 2 * t], [-B - t, 0, 2 * t, 2 * B + 4 * t], [B + t, 0, 2 * t, 2 * B + 4 * t]]) {
      this.boxes.push({ min: new THREE.Vector3(x - w / 2, 0, z - d / 2), max: new THREE.Vector3(x + w / 2, h, z + d / 2) });
    }
  }
  update(dt, focus) {
    this.sky.position.copy(G.camera.position);
    const fx = Math.round(focus.x / 4) * 4, fz = Math.round(focus.z / 4) * 4;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + 60, 160, fz + 50);
  }
  boxesNear(p, r) { return this.boxes.filter((b) => p.x > b.min.x - r && p.x < b.max.x + r && p.z > b.min.z - r && p.z < b.max.z + r); }
  groundHeight() { return 0; }
  collide(pos, r, h, vel) {
    let hit = false;
    for (const b of this.boxes) {
      if (b.min.y >= pos.y + h) continue;
      const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x)), cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
      let dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2) || 1e-5;
      if (d2 < 1e-10) { dx = -Math.sign(pos.x) || 1; dz = 0; } else { dx /= d; dz /= d; }
      pos.x = cx + dx * r; pos.z = cz + dz * r;
      if (vel) { const vn = vel.x * dx + vel.z * dz; if (vn < 0) { vel.x -= vn * dx; vel.z -= vn * dz; } }
      hit = true;
    }
    return hit;
  }
  isOpen(x, z, r = 2) { return Math.abs(x) < BOUND - r && Math.abs(z) < BOUND - r; }
  randomOpen(r = 2, near = null, rad = 60) {
    for (let i = 0; i < 40; i++) {
      const x = near ? near.x + (Math.random() - 0.5) * 2 * rad : (Math.random() - 0.5) * 2 * (BOUND - 10);
      const z = near ? near.z + (Math.random() - 0.5) * 2 * rad : (Math.random() - 0.5) * 2 * (BOUND - 10);
      if (this.isOpen(x, z, r)) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(0, 0, 0);
  }
  // 경계 밖으로 나가는 방향인지 (NPC 길찾기용)
  edgeDist(o, d, maxT) {
    let t = maxT;
    for (const a of ['x', 'z']) if (Math.abs(d[a]) > 1e-6) { const lim = (Math.sign(d[a]) * (BOUND - 2) - o[a]) / d[a]; if (lim < t) t = Math.max(0, lim); }
    return t;
  }
}
