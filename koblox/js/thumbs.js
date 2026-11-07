// 아이템/아바타/게임 썸네일을 3D로 찍어 이미지로 만든다
import * as THREE from 'three';
import { buildAvatar, animateAvatar, disposeAvatar, drawFace } from './avatar.js';
import { DEFAULT_EQUIP } from './items.js';

let R, scene, cam;
function init() {
  if (R) return;
  const c = document.createElement('canvas');
  R = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
  R.setSize(256, 256, false); R.setClearColor(0x000000, 0); R.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777788, 1.6));
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
  const av = buildAvatar(equip); animateAvatar(av, 0.016, {});
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
export function gameThumb(equip, w = 480, h = 270) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, preserveDrawingBuffer: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  const sc = new THREE.Scene();
  const sky = document.createElement('canvas'); sky.width = 2; sky.height = 128; const g = sky.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#2f8cff'); gr.addColorStop(1, '#cfe9ff'); g.fillStyle = gr; g.fillRect(0, 0, 2, 128);
  const st = new THREE.CanvasTexture(sky); st.colorSpace = THREE.SRGBColorSpace; sc.background = st;
  sc.add(new THREE.HemisphereLight(0xe6f3ff, 0x6b6f76, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(6, 12, 8); sc.add(sun);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(300, 1, 300), new THREE.MeshLambertMaterial({ color: 0x8c9098 })); floor.position.y = -0.5; sc.add(floor);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(8, 0.6, 8), new THREE.MeshLambertMaterial({ color: 0x5d626b })); pad.position.y = 0.3; sc.add(pad);
  const av = buildAvatar(equip); av.root.position.y = 0.6; av.root.rotation.y = 0.4; animateAvatar(av, 0.016, { emote: 'emote_wave', emoteT: 0.1 }); sc.add(av.root);
  const cm2 = new THREE.PerspectiveCamera(40, w / h, 0.1, 500); cm2.position.set(5, 5, 13); cm2.lookAt(0, 3, 0);
  r.render(sc, cm2);
  const url = c.toDataURL('image/jpeg', 0.85);
  disposeAvatar(av); r.dispose(); r.forceContextLoss?.();
  return url;
}
