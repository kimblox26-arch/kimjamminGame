// 아이템/아바타/게임 썸네일을 3D로 찍어 이미지로 만든다
import * as THREE from 'three';
import { buildAvatar, animateAvatar, disposeAvatar, drawFace, buildGear } from './avatar.js';
import { envFromSky, disposeTree, gfxProfile } from './gfx.js';
import { buildWorld, TEST_PLACE } from './world.js';
import { S } from './store.js';
import { DEFAULT_EQUIP } from './items.js';

let R, scene, cam;
function init() {
  if (R) return;
  const c = document.createElement('canvas');
  R = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
  R.setSize(256, 256, false); R.setClearColor(0x000000, 0); R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.ACESFilmicToneMapping;
  scene = new THREE.Scene();
  scene.environment = envFromSky(R, { top: '#9fb4d8', hor: '#e8eef8', bot: '#8a8d94' });
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777788, 0.8));
  const d = new THREE.DirectionalLight(0xffffff, 1.4); d.position.set(3, 6, 8); scene.add(d);
  cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
}

function shoot(av, frame) {
  scene.add(av.root);
  const H = av.height, hy = av.legH + av.torH;
  const hs = av.look.head.size[1];
  if (frame === 'head') { const y = hy + hs * 0.85; cam.position.set(1.9, y + 0.6, 7.6); cam.lookAt(0, y, 0); }
  else if (frame === 'upper') { const y = hy; cam.position.set(2.5, y + 0.8, 8.5); cam.lookAt(0, y, 0); }
  else if (frame === 'back') { const y = H * 0.55; av.root.rotation.y = Math.PI * 0.82; cam.position.set(0, y + 1, 14); cam.lookAt(0, y, 0); }
  else { const y = H * 0.5; cam.position.set(3.5, y + 1.2, Math.max(13, H * 2.4)); cam.lookAt(0, y, 0); }
  R.render(scene, cam);
  const url = R.domElement.toDataURL('image/png');
  scene.remove(av.root); disposeAvatar(av);
  return url;
}

export function avatarShot(equip, frame = 'full') {
  init();
  const av = buildAvatar(equip, S.scales); animateAvatar(av, 0.016, {});
  av.root.rotation.y = frame === 'head' ? 0.35 : 0.3;
  return shoot(av, frame);
}

const FRAME = { hat: 'head', hair: 'head', faceacc: 'head', head: 'upper', neck: 'upper', back: 'back' };
const cache = new Map();
export function itemThumb(it) {
  if (cache.has(it.id)) return cache.get(it.id);
  let url;
  if (it.slot === 'skin') url = swatch(it.color);
  else if (it.slot === 'face') url = faceSwatch(it.id);
  else if (it.slot === 'gear') {
    init();
    const g = buildGear(it.id); g.rotation.set(0.5, 0.6, 2.3); scene.add(g);
    const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    cam.position.set(c.x, c.y, c.z + r / Math.tan(THREE.MathUtils.degToRad(15)) * 1.05); cam.lookAt(c);
    R.render(scene, cam); url = R.domElement.toDataURL('image/png'); scene.remove(g); disposeTree(g);
  }
  else {
    init();
    const eq = { ...DEFAULT_EQUIP, hair: null };
    if (it.slot !== 'emote') eq[it.slot] = it.id;
    if (it.slot === 'hat' || it.slot === 'faceacc') eq.hair = 'hair_short_brown';
    if (it.slot === 'head' && it.headless) eq.hat = null;
    const av = buildAvatar(eq);
    av.root.rotation.y = 0.35;
    if (it.slot === 'emote') animateAvatar(av, 0.016, { emote: it.id, emoteT: 0.15 });
    else if (it.slot === 'anim') { av.phase = 1.4; animateAvatar(av, 0.016, { speed: 16 }); }
    else animateAvatar(av, 0.016, {});
    url = shoot(av, FRAME[it.slot] || 'full');
  }
  cache.set(it.id, url);
  return url;
}

function swatch(color) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = color; g.beginPath(); g.arc(64, 64, 46, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.arc(50, 48, 14, 0, 7); g.fill();
  return c.toDataURL();
}
function faceSwatch(id) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#f5cd30'; g.beginPath(); g.roundRect(14, 14, 100, 100, 16); g.fill();
  g.translate(14, 14); drawFace(g, id, 100);
  return c.toDataURL();
}

// 게임 썸네일: 파란 하늘 + 회색 바닥 + 캐릭터
// 사용자가 만든 체험 썸네일: 월드를 위에서 비스듬히 찍는다
const placeCache = new Map();
export function placeThumb(place, w = 480, h = 270) {
  const key = place.id + '|' + place.updated;
  if (placeCache.has(key)) return placeCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, preserveDrawingBuffer: true });
  r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.shadowMap.enabled = true;
  const sc = new THREE.Scene(), prof = gfxProfile(6); prof.shadowRange = 120;
  const world = buildWorld(sc, place, prof, r);
  const box = new THREE.Box3();
  (place.parts || []).forEach(p => box.expandByPoint(new THREE.Vector3(...p.p)));
  if (box.isEmpty()) box.set(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 4, 10));
  const ctr = box.getCenter(new THREE.Vector3()), size = Math.max(16, box.getSize(new THREE.Vector3()).length());
  world.follow(ctr);
  const cm = new THREE.PerspectiveCamera(45, w / h, 0.5, 3000); cm.position.set(ctr.x + size * 0.55, ctr.y + size * 0.45, ctr.z + size * 0.75); cm.lookAt(ctr);
  r.render(sc, cm);
  const url = c.toDataURL('image/jpeg', 0.85);
  world.dispose(); r.dispose(); r.forceContextLoss?.();
  placeCache.set(key, url);
  return url;
}

export function gameThumb(equip, w = 480, h = 270) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, preserveDrawingBuffer: true });
  r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  const sc = new THREE.Scene(), prof = gfxProfile(8);
  const world = buildWorld(sc, TEST_PLACE, prof, r);
  const av = buildAvatar(equip, S.scales); av.root.position.y = 1; av.root.rotation.y = 0.4; animateAvatar(av, 0.016, { emote: 'emote_wave', emoteT: 0.1 }); sc.add(av.root);
  world.follow(new THREE.Vector3());
  const cm2 = new THREE.PerspectiveCamera(40, w / h, 0.1, 3000); cm2.position.set(6, 5.5, 14); cm2.lookAt(0, 3.4, 0);
  r.render(sc, cm2);
  const url = c.toDataURL('image/jpeg', 0.88);
  disposeAvatar(av); world.dispose(); r.dispose(); r.forceContextLoss?.();
  return url;
}
