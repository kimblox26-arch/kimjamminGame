// 실제 차량 3D 모델: 지나가는 자동차(Jeep Wrangler), 가게 앞에 세워둔 배달 스쿠터(Yamaha Vino)
// 모바일에서 가볍게: 재질이 같은 조각은 하나로 합쳐서 그리기 횟수를 줄인다
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function toFloat(geo) {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(geo.attributes)) {
    if (!['position', 'normal', 'uv', 'uv1', 'color'].includes(k)) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent ? a.getComponent(i, c) : [a.getX(i), a.getY(i), a.getZ(i), a.getW(i)][c];
    g.setAttribute(k, new THREE.BufferAttribute(out, a.itemSize));
  }
  if (geo.index) g.setIndex(Array.from(geo.index.array));
  return g;
}
function mergeByMaterial(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  root.traverse(o => {
    if (!o.isMesh) return;
    const g = toFloat(o.geometry); g.applyMatrix4(o.matrixWorld);
    const key = o.material.uuid + '|' + Object.keys(g.attributes).sort().join(',');
    if (!groups.has(key)) groups.set(key, { mat: o.material, geos: [] });
    groups.get(key).geos.push(g.index ? g : g);
  });
  const out = new THREE.Group();
  for (const { mat, geos } of groups.values()) {
    const anyIdx = geos.some(g => g.index), list = anyIdx ? geos.map(g => g.index ? g : (g.setIndex([...Array(g.attributes.position.count).keys()]), g)) : geos;
    const m = new THREE.Mesh(list.length > 1 ? mergeGeometries(list) : list[0], mat);
    m.matrixAutoUpdate = false; out.add(m);
  }
  return out;
}
function prep(scene, { night = 0.55 } = {}) {
  scene.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m.transmission) { m.transmission = 0; m.transparent = true; m.opacity = 0.35; m.depthWrite = false; }
    m.envMapIntensity = night;
  });
  const merged = mergeByMaterial(scene);
  const box = new THREE.Box3().setFromObject(merged);
  merged.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  const g = new THREE.Group(); g.add(merged); g.userData.size = box.getSize(new THREE.Vector3());
  return g;
}
// 몸체 페인트 재질: 클리어코트가 있고 정점이 가장 많은 것
function paintOf(group) {
  let best = null, n = 0;
  group.traverse(o => { if (o.isMesh && o.material.clearcoat > 0 && !o.material.map) { const c = o.geometry.attributes.position.count; if (c > n) { n = c; best = o.material; } } });
  return best;
}

export async function loadVehicles(scene, onProgress) {
  const L = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  let done = 0;
  const get = n => L.loadAsync(`assets/models/${n}.glb`).then(g => { onProgress?.(++done / 6); return g.scene; });
  const [carS, scootS, ferS, fridgeS, sofaS, chairS] = await Promise.all([get('car'), get('scooter'), get('ferrari'), get('fridge'), get('sofa'), get('chair')]);
  // 스포츠카 (페라리 458): 바퀴·핸들이 따로 움직임, 실내(가죽 시트·카본) 있음
  const ferrari = new THREE.Group(); { const m = ferS; m.rotation.y = Math.PI; m.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(m); m.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2); ferrari.add(m); ferrari.userData.size = box.getSize(new THREE.Vector3());
    m.traverse(o => { if (!o.isMesh) return; o.castShadow = true; const mt = o.material; mt.envMapIntensity = 0.9; if (mt.name === 'Body_Color') { o.material = new THREE.MeshPhysicalMaterial({ color: 0xc21a1a, metalness: 0.6, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.2 }); o.material.name = 'Body_Color'; } if (/Glass/i.test(mt.name)) { mt.transparent = true; mt.opacity = mt.name === 'Glass_Gray' ? 0.35 : 0.7; mt.depthWrite = false; } });
    ferrari.userData.ferrari = true; ferrari.visible = false; scene.add(ferrari); }
  const prop = (s) => { s.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material.transmission) { o.material.transmission = 0; o.material.transparent = true; o.material.opacity = 0.28; o.material.depthWrite = false; } } }); return s; };

  // 가게 앞 인도에 세워둔 배달 스쿠터 + 배달통
  const scooter = prep(scootS, { night: 0.7 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.42), new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.35, envMapIntensity: 0.6 }));
  box.position.set(0, scooter.userData.size.y * 0.78, -scooter.userData.size.z * 0.3); scooter.add(box);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.04, 0.44), new THREE.MeshStandardMaterial({ color: 0xd62828, roughness: 0.4 })); lid.position.copy(box.position).y += 0.2; scooter.add(lid);
  scooter.position.set(3.3, 0.06, 5.3); scooter.rotation.y = -0.5; scene.add(scooter);


  // 지나가는 자동차
  const car = prep(carS, { night: 0.6 });
  car.userData.paint = paintOf(car);
  const beam = new THREE.SpotLight(0xfff2d0, 80, 30, 0.45, 0.6, 1.5); beam.position.set(0, 0.8, car.userData.size.z / 2); beam.target.position.set(0, 0, 12); car.add(beam, beam.target);
  car.visible = false; scene.add(car);
  return { car, scooter, ferrari, fridge: prop(fridgeS), sofa: prop(sofaS), chair: prop(chairS) };
}
export const CAR_COLORS = [0xf4f4f2, 0x111214, 0x9aa1a8, 0x1c2c52, 0x7a1414, 0x2d3b2a];
