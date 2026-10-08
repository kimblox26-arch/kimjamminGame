// 1인칭 공구 모델 (카메라에 부착) + 애니메이션
import * as THREE from 'three';
import { blockGeo } from '../gfx/geometry.js';
import { HandModel, HandRig, POSES, GRIP, alignHandToHandle, fitGrip } from './hand.js';

const cyl = (r1, r2, h, seg = 16) => new THREE.CylinderGeometry(r1, r2, h, seg);
const box = (x, y, z, b = 0.003) => blockGeo(x, y, z, { bevel: b });
const mesh = (g, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = false; return o; };

const V = (a) => new THREE.Vector3(...a);

// 공구 손잡이 정의 (공구 좌표): c 중심, up 엄지·검지 쪽 끝 방향, palm 손잡이 축에서 손바닥 쪽, R 반지름, wf/wd 손목 굽힘/편위
// palm 을 생략하면 팔뚝이 화면 오른쪽(왼손은 왼쪽) 아래 뒤에서 오도록 자동 탐색
const ARM_R = [0.42, -0.62, 0.66], ARM_L = [-0.42, -0.62, 0.66];
function gripHand(model, parent, spec, left = false) {
  const rig = new HandRig(model, left);
  if (!spec.palm) { const f = fitGrip(V(spec.up), V(spec.arm || (left ? ARM_L : ARM_R)), left); spec = { ...spec, palm: f.palm.toArray(), wf: f.wf, wd: f.wd }; }
  alignHandToHandle(rig, V(spec.c), V(spec.up), V(spec.palm), spec.R, spec.wf || 0, spec.wd || 0, left);
  const pose = HandRig.gripPose(GRIP.center(spec.R), GRIP.axis, spec.R, { trigger: !!spec.trigger });
  pose[21] = spec.wf || 0; pose[22] = spec.wd || 0;
  rig.basePose = pose; rig.x.set(pose); rig.target.set(pose); rig.tension = 1; rig.apply();
  parent.add(rig.group);
  return rig;
}

export function buildViewmodels(lib, quality = 'high') {
  const steel = lib.get('brushed'), dark = lib.get('paint', 0x1c1c1c), wood = lib.get('pine'), red = lib.get('paint', 0xc0161c);
  const yellow = lib.get('paint', 0xe8a812), blue = lib.get('paint', 0x1f5fb0), rubber = lib.get('tire'), cast = lib.get('cast'), green = lib.get('paint', 0x2a7a3c);
  const vm = {};
  const model = new HandModel(quality);
  if (lib.skins.fabric) model.setSleeveMap(lib.skins.fabric.map, lib.skins.fabric.normalMap);
  // 맨손 (양손): 잡기 · 운반
  {
    const g = new THREE.Group();
    const r = new HandRig(model, false); r.group.position.set(0.02, -0.025, 0.1); r.group.rotation.set(0.36, 0.34, -0.62); g.add(r.group);
    const l = new HandRig(model, true); l.group.position.set(-0.42, -0.035, 0.08); l.group.rotation.set(0.34, -0.32, 0.62); g.add(l.group);
    g.userData.rigs = [r, l]; vm.hand = g;
  }
  // 자재 배치: 놓을 곳을 가리키는 손
  {
    const g = new THREE.Group();
    const r = new HandRig(model, false); r.group.position.set(0.03, -0.035, 0.12); r.group.rotation.set(0.4, 0.38, -0.85); g.add(r.group);
    r.basePose = POSES.point; r.x.set(POSES.point); r.target.set(POSES.point); r.apply();
    g.userData.rigs = [r]; vm.place = g;
  }
  // MIG 용접 토치
  {
    const g = new THREE.Group();
    g.add(mesh(cyl(0.017, 0.02, 0.13, 16), dark, 0, 0, 0.02, Math.PI / 2));
    g.add(mesh(cyl(0.011, 0.011, 0.11, 12), steel, 0, 0.025, -0.08, Math.PI / 2 - 0.6));
    const noz = mesh(cyl(0.008, 0.012, 0.04, 16), lib.get('paint', 0xb08a50), 0, 0.058, -0.135, Math.PI / 2 - 0.6); g.add(noz);
    g.add(mesh(box(0.012, 0.025, 0.02, 0.003), red, 0, -0.025, -0.01));
    g.add(mesh(cyl(0.012, 0.012, 0.3, 8), dark, 0, -0.02, 0.22, Math.PI / 2 + 0.2));
    const tip = new THREE.Object3D(); tip.position.set(0, 0.08, -0.17); g.add(tip); g.userData.tip = tip;
    g.userData.rigs = [gripHand(model, g, { c: [0, 0, 0.034], up: [0, 0, -1], R: 0.019, trigger: true })]; vm.weld = g;
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
    g.userData.rigs = [gripHand(model, piv, { c: [0, 0.004, 0], up: [0, 1, 0], R: 0.0155 })];
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
    g.userData.rigs = [gripHand(model, g, { c: [0, -0.034, 0.03], up: [0, Math.cos(0.15), Math.sin(0.15)], R: 0.021, trigger: true })];
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
    g.userData.rigs = [gripHand(model, g, { c: [0, 0.035, 0.062], up: [0, 0, -1], R: 0.0145 })]; vm.trowel = g;
  }
  // 앵글 그라인더
  {
    const g = new THREE.Group();
    g.add(mesh(cyl(0.032, 0.03, 0.24, 20), green, 0, 0, 0.04, Math.PI / 2));
    g.add(mesh(box(0.06, 0.06, 0.07, 0.01), cast, 0, 0, -0.1));
    const disc = mesh(cyl(0.062, 0.062, 0.003, 32), lib.plain('disc', { color: 0x3a3530, roughness: 0.9, metalness: 0.2 }), -0.0, -0.045, -0.11, 0, 0, 0); g.add(disc);
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.02, 24, 1, true, 0, Math.PI), steel); guard.position.set(0, -0.035, -0.11); guard.material.side = THREE.DoubleSide; g.add(guard);
    g.add(mesh(cyl(0.012, 0.012, 0.1, 10), dark, -0.075, 0, -0.09, 0, 0, Math.PI / 2)); // 보조 손잡이 (왼손)
    g.add(mesh(cyl(0.008, 0.008, 0.25, 8), dark, 0, 0, 0.27, Math.PI / 2));
    g.userData.disc = disc;
    const tip = new THREE.Object3D(); tip.position.set(0, -0.045, -0.17); g.add(tip); g.userData.tip = tip;
    g.userData.rigs = [gripHand(model, g, { c: [0, 0, 0.095], up: [0, 0, -1], R: 0.031 }), gripHand(model, g, { c: [-0.09, 0, -0.09], up: [1, 0, 0], R: 0.012, arm: [-0.3, -0.5, 0.8] }, true)]; vm.grinder = g;
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
    g.userData.rigs = [gripHand(model, g, { c: [0, -0.034, 0.03], up: [0, Math.cos(0.2), Math.sin(0.2)], R: 0.018, trigger: true })]; vm.paint = g;
  }
  for (const k in vm) { vm[k].visible = false; vm[k].traverse((o) => { if (o.isMesh) { o.renderOrder = 10; o.frustumCulled = false; o.receiveShadow = true; } }); }
  vm.hand.userData.model = model;
  return vm;
}
