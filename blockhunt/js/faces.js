// 얼굴: 사용자가 준 사진에서 그대로 따낸 얼굴(faces/*.png)만 쓴다.
// 사진이 아직 없는 감정은 가장 가까운 사진 얼굴로 대신 보여주고, faces/<감정>.png 를 넣으면 자동으로 바뀐다.
import * as THREE from 'three';

export const EMOTIONS = ['neutral', 'scared', 'panic', 'pain', 'sad', 'angry', 'happy', 'dead'];
const FALLBACK = { panic: 'scared', pain: 'scared', sad: 'scared', dead: 'scared', angry: 'neutral', happy: 'neutral' };
const loader = new THREE.TextureLoader();
const mats = {};

function prep(t) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
const mk = (map) => new THREE.MeshLambertMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
mats.neutral = mk(prep(loader.load('./faces/neutral.png')));
mats.scared = mk(prep(loader.load('./faces/scared.png')));
for (const e of EMOTIONS) {
  if (mats[e]) continue;
  const m = (mats[e] = mk(mats[FALLBACK[e]].map));
  loader.load(`./faces/${e}.png`, (t) => { m.map = prep(t); m.needsUpdate = true; }, undefined, () => {});
}
export const faceMaterial = (e) => mats[e] || mats.neutral;
