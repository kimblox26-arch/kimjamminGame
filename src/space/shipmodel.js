// FREE FREELY 우주 탐사 - 우주선 모델 (PBR 패널 재질, 엔진 발광, 항법등, 착륙장치, 조종석, 재진입 플라스마)
// 좌표: -Z 기수, +Y 위, +X 오른쪽. 길이 약 22 m.
import * as THREE from 'three';
import { makeHullTextures } from './textures.js';

const FLAME_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying float vY;
void main() {
  vUv = uv;
  vY = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const FLAME_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uPower;
uniform float uTime;
uniform vec3 uColA;
uniform vec3 uColB;
varying vec2 vUv;
varying float vY;
void main() {
  float t = vUv.y;                  // 0 노즐, 1 끝
  float ring = abs(sin((t * 9.0 - uTime * 30.0))) * 0.25 + 0.75;   // 충격파 다이아몬드
  float core = exp(-t * 3.2) * ring;
  float flick = 0.85 + 0.15 * sin(uTime * 70.0 + vUv.x * 30.0);
  vec3 col = mix(uColB, uColA, exp(-t * 2.0)) * core * flick * uPower;
  float edge = pow(max(0.0, sin(vUv.x * 3.14159)), 0.8);
  gl_FragColor = vec4(col * edge * 6.0, 0.0);
  #include <logdepthbuf_fragment>
}`;

const PLASMA_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uFlowL;   // 기체 로컬 좌표의 유입 방향 (진행 방향)
varying float vFace;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vN = normalize(normal);
  vFace = dot(vN, -uFlowL);
  vec3 p = position + vN * 0.25;
  // 뒤쪽으로 끌리는 플라스마 꼬리
  float back = max(0.0, -vFace);
  p += uFlowL * back * 2.5;
  vP = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const PLASMA_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uHeat;
uniform float uTime;
varying float vFace;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  float front = smoothstep(-0.2, 0.9, vFace);
  float n = sin(vP.z * 3.0 + uTime * 40.0) * sin(vP.x * 4.0 - uTime * 33.0) * 0.5 + 0.5;
  vec3 c = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.75, 0.45), front) * (0.6 + n * 0.6);
  c = mix(c, vec3(0.75, 0.55, 1.0), smoothstep(0.7, 1.0, uHeat) * 0.4);
  gl_FragColor = vec4(c * uHeat * (front * 4.0 + 0.6), 0.0);
  #include <logdepthbuf_fragment>
}`;

const ADD = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };

export function buildShipModel() {
  const root = new THREE.Group();
  root.name = 'ship';
  const tex = makeHullTextures(1024);
  const hull = new THREE.MeshStandardMaterial({
    color: 0xc9d2da, metalness: 0.82, roughness: 0.34, normalMap: tex.normal, normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: tex.rough, emissive: new THREE.Color(0xff5a1a), emissiveIntensity: 0,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.7, roughness: 0.5, normalMap: tex.normal, emissive: new THREE.Color(0xff4a10), emissiveIntensity: 0 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff8a2a, metalness: 0.4, roughness: 0.4, emissive: new THREE.Color(0xff4a10), emissiveIntensity: 0 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0e1a26, metalness: 1.0, roughness: 0.06, transparent: true, opacity: 0.62 });
  const nozzle = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, metalness: 0.9, roughness: 0.42, emissive: new THREE.Color(0xff7a30), emissiveIntensity: 0 });
  const materials = { hull, dark, accent, glass, nozzle };

  // 동체: 회전체(lathe)를 기수 방향으로 눕히고 상하로 납작하게
  const prof = [];
  const L = 22;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const r = t < 0.28 ? Math.pow(t / 0.28, 0.62) * 1.75 : t < 0.8 ? 1.75 + Math.sin((t - 0.28) / 0.52 * Math.PI) * 0.2 : 1.75 - (t - 0.8) / 0.2 * 0.45;
    prof.push(new THREE.Vector2(Math.max(0.02, r), t * L - L * 0.55));
  }
  const fuseGeo = new THREE.LatheGeometry(prof, 40);
  fuseGeo.rotateX(-Math.PI / 2);     // Y축 → -Z 축 (기수가 -Z)
  fuseGeo.scale(1, 0.62, 1);
  fuseGeo.computeVertexNormals();
  scaleUV(fuseGeo, 3, 6);
  const fuse = new THREE.Mesh(fuseGeo, hull);
  root.add(fuse);

  // 등줄기 · 배면 장갑
  const spine = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 13), dark);
  spine.position.set(0, 1.05, 2.5);
  root.add(spine);
  const belly = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 12), dark);
  belly.position.set(0, -1.05, 1.5);
  root.add(belly);

  // 주익 (델타)
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, -3.5);
  wingShape.lineTo(7.8, 4.8);
  wingShape.lineTo(8.2, 6.4);
  wingShape.lineTo(0, 6.8);
  wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.32, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 1 });
  wingGeo.rotateX(Math.PI / 2);
  wingGeo.translate(0, 0.16, 0);
  scaleUV(wingGeo, 0.15, 0.15);
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(wingGeo, hull);
    w.scale.x = s;
    w.position.set(s * 0.9, -0.35, 1.2);
    w.rotation.z = s * -0.06;
    root.add(w);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.36, 0.5), accent);
    stripe.position.set(s * 4.6, -0.33, 6.6);
    root.add(stripe);
  }
  // 수직 꼬리날개 (경사형 쌍발)
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0); finShape.lineTo(3.4, 0); finShape.lineTo(4.4, 3.2); finShape.lineTo(2.9, 3.4); finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.22, bevelEnabled: false });
  finGeo.rotateY(Math.PI / 2);
  scaleUV(finGeo, 0.2, 0.2);
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(finGeo, hull);
    f.position.set(s * 1.6, 0.6, 9.4);
    f.rotation.set(0, Math.PI, s * -0.36);
    root.add(f);
  }
  // 엔진 나셀 + 노즐
  const engines = [];
  for (const s of [-1, 1]) {
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 8, 24), dark);
    nac.rotation.x = Math.PI / 2;
    nac.position.set(s * 2.3, -0.2, 6.6);
    root.add(nac);
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.75, 1.6, 24, 1, true), nozzle);
    noz.rotation.x = Math.PI / 2;
    noz.position.set(s * 2.3, -0.2, 11.3);
    root.add(noz);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.72, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.4, 0.5) }));
    inner.position.set(s * 2.3, -0.2, 11.1);
    root.add(inner);
    const flameMat = new THREE.ShaderMaterial({
      vertexShader: FLAME_VS, fragmentShader: FLAME_FS, ...ADD, side: THREE.DoubleSide,
      uniforms: { uPower: { value: 0 }, uTime: { value: 0 }, uColA: { value: new THREE.Vector3(1.0, 0.75, 0.5) }, uColB: { value: new THREE.Vector3(0.35, 0.5, 1.0) } },
    });
    const flameGeo = new THREE.ConeGeometry(0.7, 1, 24, 1, true);
    flameGeo.translate(0, 0.5, 0);
    flameGeo.rotateX(Math.PI / 2);      // 넓은 쪽이 노즐(z=0), 끝이 +Z
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(s * 2.3, -0.2, 11.9);
    flame.renderOrder = 20;
    root.add(flame);
    engines.push({ flame, inner, mat: flameMat, pos: new THREE.Vector3(s * 2.3, -0.2, 12) });
  }
  // RCS 노즐 블록
  for (const p of [[1.5, 0.4, -6], [-1.5, 0.4, -6], [1.5, 0.4, 8], [-1.5, 0.4, 8]]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.5), dark);
    r.position.set(...p);
    root.add(r);
  }
  // 조종석 캐노피
  const canopyGeo = new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  canopyGeo.scale(1.05, 0.75, 2.8);
  const canopy = new THREE.Mesh(canopyGeo, glass);
  canopy.position.set(0, 0.62, -5.0);
  root.add(canopy);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.07, 6, 24, Math.PI), dark);
  frame.position.set(0, 0.62, -4.4);
  root.add(frame);

  // 항법등
  const navGeo = new THREE.SphereGeometry(0.14, 8, 6);
  const mk = (c) => new THREE.MeshBasicMaterial({ color: c });
  const navRed = new THREE.Mesh(navGeo, mk(new THREE.Color(6, 0.3, 0.2)));
  navRed.position.set(-8.9, -0.3, 7.4);
  const navGreen = new THREE.Mesh(navGeo, mk(new THREE.Color(0.3, 6, 0.6)));
  navGreen.position.set(8.9, -0.3, 7.4);
  const strobe = new THREE.Mesh(navGeo, mk(new THREE.Color(8, 8, 8)));
  strobe.position.set(0, 1.4, 9.8);
  const beacon = new THREE.Mesh(navGeo, mk(new THREE.Color(8, 0.6, 0.2)));
  beacon.position.set(0, -1.3, 0);
  root.add(navRed, navGreen, strobe, beacon);
  const landingLight = new THREE.SpotLight(0xfff2dd, 0, 900, 0.45, 0.4, 1.4);
  landingLight.position.set(0, -0.9, -8);
  landingLight.target.position.set(0, -6, -60);
  root.add(landingLight, landingLight.target);

  // 착륙장치 (3점)
  const gearGroup = new THREE.Group();
  const gearLegs = [];
  for (const p of [[0, -1.0, -6.5], [-2.8, -1.0, 4.5], [2.8, -1.0, 4.5]]) {
    const leg = new THREE.Group();
    leg.position.set(p[0], p[1], p[2]);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.8, 8), dark);
    strut.position.y = -0.9;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.18, 14), dark);
    pad.position.y = -1.85;
    leg.add(strut, pad);
    gearGroup.add(leg);
    gearLegs.push(leg);
  }
  root.add(gearGroup);

  // 재진입 플라스마 껍질 (동체 형상 확장)
  const plasmaMat = new THREE.ShaderMaterial({
    vertexShader: PLASMA_VS, fragmentShader: PLASMA_FS, ...ADD, side: THREE.FrontSide,
    uniforms: { uHeat: { value: 0 }, uTime: { value: 0 }, uFlowL: { value: new THREE.Vector3(0, 0, 1) } },
  });
  const plasmaGeo = fuseGeo.clone();
  plasmaGeo.scale(1.25, 1.5, 1.08);
  const plasma = new THREE.Mesh(plasmaGeo, plasmaMat);
  plasma.renderOrder = 21;
  plasma.visible = false;
  root.add(plasma);

  // 조종석 내부 (1인칭 전용)
  const cockpit = buildCockpit(dark);
  cockpit.position.set(0, 1.05, -5.4);
  root.add(cockpit);

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.layers.enable(1); } });
  plasma.layers.disable(1);
  for (const e of engines) e.flame.layers.disable(1);

  return {
    root, materials, engines, nav: { red: navRed, green: navGreen, strobe, beacon }, gearLegs, gearGroup, plasma, plasmaMat, canopy,
    cockpit, landingLight, eye: new THREE.Vector3(0, 1.05, -5.4),
    gearPoints: [new THREE.Vector3(0, -2.95, -6.5), new THREE.Vector3(-2.8, -2.95, 4.5), new THREE.Vector3(2.8, -2.95, 4.5)],
    hullPoints: [new THREE.Vector3(0, -1.2, -11), new THREE.Vector3(0, -1.2, 9), new THREE.Vector3(-8.5, -0.4, 7), new THREE.Vector3(8.5, -0.4, 7), new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, -1.2, 0)],
  };
}

function scaleUV(g, su, sv) {
  const uv = g.getAttribute('uv');
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

/** 조종석 내부: 계기판 · 화면 · 캐노피 프레임 (그룹 원점 = 조종사 눈 위치) */
function buildCockpit(dark) {
  const g = new THREE.Group();
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x20262e, metalness: 0.4, roughness: 0.55 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x3a434e, metalness: 0.7, roughness: 0.35 });
  // 계기판 (시야 아래쪽, 앞으로 기울어진 면)
  const dashShape = new THREE.Shape();
  dashShape.moveTo(-0.62, 0); dashShape.lineTo(0.62, 0); dashShape.lineTo(0.5, 0.42); dashShape.lineTo(-0.5, 0.42); dashShape.closePath();
  const dashGeo = new THREE.ExtrudeGeometry(dashShape, { depth: 0.05, bevelEnabled: false });
  const dash = new THREE.Mesh(dashGeo, panelMat);
  dash.rotation.x = -1.05;
  dash.position.set(0, -0.5, -0.62);
  g.add(dash);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.08), trimMat);
  lip.position.set(0, -0.3, -0.82);
  g.add(lip);
  const screens = [];
  const scrColors = [new THREE.Color(0.1, 0.9, 1.2), new THREE.Color(1.2, 0.6, 0.15), new THREE.Color(0.2, 1.1, 0.5)];
  for (let i = 0; i < 3; i++) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 160;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshBasicMaterial({ map: tex, color: scrColors[i] });
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), m);
    sc.position.set((i - 1) * 0.34, -0.4, -0.7);
    sc.rotation.x = -0.52;
    sc.rotation.y = -(i - 1) * 0.18;
    g.add(sc);
    screens.push({ canvas: c, tex, mesh: sc });
  }
  // 캐노피 앞 아치 · 중앙 기둥 (가는 프레임)
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.018, 6, 40, Math.PI), trimMat);
  arch.position.set(0, -0.32, -0.95);
  g.add(arch);
  const arch2 = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.02, 6, 40, Math.PI), trimMat);
  arch2.position.set(0, -0.36, 0.35);
  g.add(arch2);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 1.3), trimMat);
  spine.position.set(0, 0.5, -0.3);
  g.add(spine);
  // 측면 콘솔
  for (const s of [-1, 1]) {
    const con = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.8), panelMat);
    con.position.set(s * 0.62, -0.62, -0.2);
    g.add(con);
  }
  // 조종간 · 스로틀
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.32, 8), dark);
  stick.position.set(0, -0.78, -0.38);
  g.add(stick);
  const thr = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05), dark);
  thr.position.set(-0.6, -0.5, -0.3);
  g.add(thr);
  g.userData.screens = screens;
  g.userData.stick = stick;
  g.userData.throttle = thr;
  g.visible = false;
  return g;
}
