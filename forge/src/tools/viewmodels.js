// 1인칭 공구 모델 (카메라에 부착) + 애니메이션
import * as THREE from 'three';
import { blockGeo } from '../gfx/geometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const cyl = (r1, r2, h, seg = 16) => new THREE.CylinderGeometry(r1, r2, h, seg);
const box = (x, y, z, b = 0.003) => blockGeo(x, y, z, { bevel: b });
const mesh = (g, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = false; return o; };

export function buildViewmodels(lib) {
  const steel = lib.get('brushed'), dark = lib.get('paint', 0x1c1c1c), wood = lib.get('pine'), red = lib.get('paint', 0xc0161c);
  const yellow = lib.get('paint', 0xe8a812), blue = lib.get('paint', 0x1f5fb0), rubber = lib.get('tire'), cast = lib.get('cast'), green = lib.get('paint', 0x2a7a3c);
  const vm = {};
  // 장갑 낀 손 (작업 장갑)
  const glove = lib.plain('glove', { color: 0x6e5236, roughness: 0.95, metalness: 0 }), cuff = lib.plain('cuff', { color: 0x2a2e33, roughness: 0.9 });
  const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 8);
  const hand = () => { // 작업 장갑 낀 손 (손바닥 + 굽힌 손가락 4 + 엄지 + 소매)
    const g = new THREE.Group(); g.scale.setScalar(0.85);
    g.add(mesh(blockGeo(0.064, 0.026, 0.072, { bevel: 0.011 }), glove, 0, 0, 0.012));
    for (let i = 0; i < 4; i++) { const f = new THREE.Group(); f.position.set(-0.024 + i * 0.016, 0.004, -0.024); f.rotation.x = 1.25; f.add(mesh(cap(0.0075, 0.03 - Math.abs(i - 1.5) * 0.004), glove, 0, 0.02, 0)); g.add(f); }
    g.add(mesh(cap(0.0085, 0.03), glove, 0.036, -0.004, 0.0, 0.4, 0, -0.9));
    g.add(mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.05, 14), cuff, 0, -0.002, 0.07, Math.PI / 2));
    return g;
  };
  // 손
  { const g = new THREE.Group(); const h = hand(); h.position.set(0.02, -0.03, 0.02); h.rotation.set(-0.5, 0.35, 0.5); g.add(h); vm.hand = g; }
  // 줄자 (배치)
  { const g = new THREE.Group(); g.add(mesh(cyl(0.035, 0.035, 0.03, 24), yellow, 0, 0, 0, Math.PI / 2, 0, Math.PI / 2)); g.add(mesh(box(0.02, 0.0006, 0.16, 0.0002), lib.get('paint', 0xf2d23a), -0.0, -0.03, -0.09)); g.add(mesh(box(0.024, 0.008, 0.004, 0.001), steel, 0, -0.026, -0.17)); const h = hand(); h.position.set(0.01, -0.035, 0.03); g.add(h); vm.place = g; }
  // MIG 용접 토치
  {
    const g = new THREE.Group();
    g.add(mesh(cyl(0.017, 0.02, 0.13, 16), dark, 0, 0, 0.02, Math.PI / 2));
    g.add(mesh(cyl(0.011, 0.011, 0.11, 12), steel, 0, 0.025, -0.08, Math.PI / 2 - 0.6));
    const noz = mesh(cyl(0.008, 0.012, 0.04, 16), lib.get('paint', 0xb08a50), 0, 0.058, -0.135, Math.PI / 2 - 0.6); g.add(noz);
    g.add(mesh(box(0.012, 0.025, 0.02, 0.003), red, 0, -0.025, -0.01));
    g.add(mesh(cyl(0.012, 0.012, 0.3, 8), dark, 0, -0.02, 0.22, Math.PI / 2 + 0.2));
    const tip = new THREE.Object3D(); tip.position.set(0, 0.08, -0.17); g.add(tip); g.userData.tip = tip;
    const h = hand(); h.position.set(0, -0.02, 0.03); g.add(h); vm.weld = g;
  }
  // 망치 (장도리)
  {
    const g = new THREE.Group(), piv = new THREE.Group(); g.add(piv);
    piv.add(mesh(box(0.028, 0.32, 0.022, 0.008), wood, 0, 0.12, 0));
    piv.add(mesh(box(0.03, 0.08, 0.026, 0.006), rubber, 0, 0.0, 0));
    const head = new THREE.Group(); head.position.set(0, 0.29, 0); piv.add(head);
    head.add(mesh(cyl(0.016, 0.016, 0.09, 16), steel, 0, 0, -0.03, Math.PI / 2));
    head.add(mesh(cyl(0.019, 0.019, 0.012, 16), steel, 0, 0, -0.078, Math.PI / 2));
    head.add(mesh(box(0.012, 0.016, 0.08, 0.003), steel, 0, 0.012, 0.045, -0.5));
    const h = hand(); h.position.set(0, 0.02, 0.02); h.rotation.x = -1.4; piv.add(h);
    g.userData.piv = piv; vm.hammer = g;
  }
  // 임팩트 드라이버
  {
    const g = new THREE.Group();
    g.add(mesh(box(0.05, 0.06, 0.15, 0.015), yellow, 0, 0.05, -0.02));
    g.add(mesh(box(0.04, 0.12, 0.045, 0.012), dark, 0, -0.03, 0.03, 0.15));
    g.add(mesh(box(0.06, 0.04, 0.08, 0.01), dark, 0, -0.1, 0.035));
    const chuck = mesh(cyl(0.012, 0.014, 0.04, 6), steel, 0, 0.05, -0.115, Math.PI / 2); g.add(chuck);
    const bit = mesh(cyl(0.003, 0.003, 0.05, 6), steel, 0, 0.05, -0.155, Math.PI / 2); g.add(bit);
    g.userData.spin = [chuck, bit];
    const h = hand(); h.position.set(0, -0.04, 0.05); h.rotation.x = 0.3; g.add(h);
    const tip = new THREE.Object3D(); tip.position.set(0, 0.05, -0.18); g.add(tip); g.userData.tip = tip; vm.drill = g;
  }
  // 흙손
  {
    const g = new THREE.Group();
    const blade = new THREE.Shape([new THREE.Vector2(0, 0.12), new THREE.Vector2(0.055, -0.04), new THREE.Vector2(-0.055, -0.04)]);
    const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.002, bevelEnabled: false }); bg.rotateX(-Math.PI / 2);
    g.add(mesh(bg, steel, 0, -0.01, -0.06));
    g.add(mesh(cyl(0.004, 0.004, 0.05), steel, 0, 0.012, 0.0, 0.5));
    g.add(mesh(cyl(0.013, 0.015, 0.1, 12), wood, 0, 0.035, 0.05, Math.PI / 2));
    const mort = mesh(new THREE.SphereGeometry(0.03, 10, 6).scale(1.2, 0.35, 1.4), lib.plain('mortar', { color: 0xa8a49a, roughness: 1 }), 0, -0.003, -0.07); g.add(mort);
    const h = hand(); h.position.set(0, 0.02, 0.06); g.add(h); vm.trowel = g;
  }
  // 앵글 그라인더
  {
    const g = new THREE.Group();
    g.add(mesh(cyl(0.032, 0.03, 0.24, 20), green, 0, 0, 0.04, Math.PI / 2));
    g.add(mesh(box(0.06, 0.06, 0.07, 0.01), cast, 0, 0, -0.1));
    const disc = mesh(cyl(0.062, 0.062, 0.003, 32), lib.plain('disc', { color: 0x3a3530, roughness: 0.9, metalness: 0.2 }), -0.0, -0.045, -0.11, 0, 0, 0); g.add(disc);
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.02, 24, 1, true, 0, Math.PI), steel); guard.position.set(0, -0.035, -0.11); guard.material.side = THREE.DoubleSide; g.add(guard);
    g.add(mesh(cyl(0.012, 0.012, 0.1, 10), dark, 0.07, 0, -0.09, 0, 0, Math.PI / 2));
    g.add(mesh(cyl(0.008, 0.008, 0.25, 8), dark, 0, 0, 0.27, Math.PI / 2));
    g.userData.disc = disc;
    const tip = new THREE.Object3D(); tip.position.set(0, -0.045, -0.17); g.add(tip); g.userData.tip = tip;
    const h = hand(); h.position.set(0, -0.03, 0.06); g.add(h); vm.grinder = g;
  }
  // 스프레이 건
  {
    const g = new THREE.Group();
    g.add(mesh(box(0.035, 0.05, 0.12, 0.01), blue, 0, 0.04, -0.02));
    g.add(mesh(box(0.03, 0.11, 0.035, 0.01), dark, 0, -0.03, 0.03, 0.2));
    const cup = mesh(cyl(0.035, 0.03, 0.08, 20), lib.plain('cup', { color: 0xdedede, roughness: 0.3, metalness: 0.6 }), 0, 0.11, 0.0); g.add(cup);
    g.add(mesh(cyl(0.006, 0.01, 0.04, 10), steel, 0, 0.04, -0.1, Math.PI / 2));
    const paint = mesh(cyl(0.031, 0.031, 0.05, 20), lib.plain('paintcup', { color: 0xb3121a, roughness: 0.4 }), 0, 0.1, 0); g.add(paint);
    g.userData.paint = paint;
    const tip = new THREE.Object3D(); tip.position.set(0, 0.04, -0.13); g.add(tip); g.userData.tip = tip;
    const h = hand(); h.position.set(0, -0.04, 0.05); g.add(h); vm.paint = g;
  }
  for (const k in vm) { vm[k].visible = false; vm[k].traverse((o) => { if (o.isMesh) { o.renderOrder = 10; o.frustumCulled = false; } }); }
  return vm;
}
