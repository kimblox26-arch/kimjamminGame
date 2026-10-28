// 맵: 하얀 바닥 + 파란 하늘 + 구름 + 해
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.36, 0.4, -0.84).normalize();

function gridTexture(renderer) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#eef2f7'; g.lineWidth = 2;
  for (let i = 1; i < 4; i++) { const p = i * 128; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.moveTo(0, p); g.lineTo(512, p); g.stroke(); }
  g.strokeStyle = '#e1e7ef'; g.lineWidth = 4;
  g.strokeRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createWorld(scene, renderer) {
  scene.background = new THREE.Color(0xa9d3ff);
  scene.fog = new THREE.Fog(0xc4e0ff, 90, 700);

  // ── 하늘 (그라디언트 + 해 원반/빛무리)
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        zenith: { value: new THREE.Color(0x1360d6) },
        horizon: { value: new THREE.Color(0xa9d3ff) },
        ground: { value: new THREE.Color(0xf2f7ff) },
        sunDir: { value: SUN_DIR },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 zenith, horizon, ground, sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 col = mix(horizon, zenith, pow(clamp(d.y, 0.0, 1.0), 0.42));
          col = mix(col, ground, smoothstep(0.0, -0.06, d.y));
          float s = max(dot(d, sunDir), 0.0);
          col += vec3(1.0, 0.86, 0.62) * (pow(s, 7.0) * 0.18 + pow(s, 60.0) * 0.5 + pow(s, 500.0) * 1.5);
          col += vec3(1.0, 0.97, 0.88) * smoothstep(0.99945, 0.99965, s) * 8.0;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // ── 환경광(반사): 하늘 + 하얀 바닥을 큐브맵으로 구워서 피부·손톱·공에 하늘이 비치게
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  // 직접광(햇빛·하늘빛)과 겹치므로 반사용 하늘은 어둡게 (밝으면 화면이 뿌옇게 뜬다)
  const envSky = sky.material.clone();
  for (const k of ['zenith', 'horizon', 'ground']) envSky.uniforms[k].value.multiplyScalar(0.38);
  envScene.add(new THREE.Mesh(sky.geometry, envSky));
  const envFloor = new THREE.Mesh(new THREE.CircleGeometry(1400, 48), new THREE.MeshBasicMaterial({ color: 0x9a9da2 }));
  envFloor.rotation.x = -Math.PI / 2;
  envFloor.position.y = -1.5;
  envScene.add(envFloor);
  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 3000).texture;
  pmrem.dispose();

  // ── 빛: 하늘빛 + 햇빛(그림자)
  const hemi = new THREE.HemisphereLight(0xd4e8ff, 0xffffff, 1.05);
  const sun = new THREE.DirectionalLight(0xfff2de, 3.3);
  sun.castShadow = true;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  // 그림자 품질: 고품질이면 주변 4.5m 를 4096 해상도로 (손가락 그림자까지 또렷하게)
  const setShadowQuality = high => {
    const big = high && renderer.capabilities.maxTextureSize >= 4096;
    const size = big ? 4096 : 2048, ext = high ? 4.5 : 7;
    sun.shadow.mapSize.set(size, size);
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = high ? 0.004 : 0.012;
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  };
  setShadowQuality(true);
  scene.add(hemi, sun, sun.target);

  // ── 하얀 바닥 (거리감용 아주 옅은 격자)
  const floorTex = gridTexture(renderer);
  floorTex.repeat.set(1000, 1000); // 4m 타일
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: floorTex, roughness: 0.93, metalness: 0, emissive: 0xffffff, emissiveMap: floorTex, emissiveIntensity: 0.12 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ── 구름: 둥근 덩어리 여러 개를 뭉친 뭉게구름 (InstancedMesh 1개)
  const clouds = new THREE.Group();
  const rand = mulberry(7);
  const puffs = [];
  for (let c = 0; c < 48; c++) {
    const ang = rand() * Math.PI * 2, dist = 160 + rand() * 620, hgt = 75 + rand() * 140, size = 14 + rand() * 30;
    const cx = Math.cos(ang) * dist, cz = Math.sin(ang) * dist, rot = rand() * Math.PI;
    const n = 7 + Math.floor(rand() * 8);
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * 2 - 1;
      const lx = t * size * 1.3 + (rand() - 0.5) * size * 0.4, lz = (rand() - 0.5) * size * 0.7;
      const s = size * (0.45 + (1 - Math.abs(t)) * 0.45 + rand() * 0.2);
      puffs.push({
        x: cx + lx * Math.cos(rot) - lz * Math.sin(rot), y: hgt + s * 0.25 + rand() * size * 0.2,
        z: cz + lx * Math.sin(rot) + lz * Math.cos(rot), sx: s, sy: s * (0.55 + rand() * 0.2), sz: s * 0.85,
      });
    }
  }
  const cloudMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 3),
    new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xc9d8ea, emissiveIntensity: 0.6, fog: false }),
    puffs.length,
  );
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  puffs.forEach((pf, i) => cloudMesh.setMatrixAt(i, m.compose(p.set(pf.x, pf.y, pf.z), q, s.set(pf.sx, pf.sy, pf.sz))));
  clouds.add(cloudMesh);
  scene.add(clouds);

  return {
    setShadowQuality,
    update(dt, playerPos) {
      sky.position.copy(playerPos);
      clouds.position.set(playerPos.x, 0, playerPos.z);
      clouds.rotation.y += dt * 0.0035; // 천천히 흘러가는 구름
      sun.target.position.copy(playerPos);
      sun.position.copy(playerPos).addScaledVector(SUN_DIR, 40);
    },
  };
}

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
