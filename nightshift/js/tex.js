// 실사 텍스처 불러오기 (assets/tex): 색은 sRGB, 노멀·거칠기는 선형. 반복·이방성 필터
import * as THREE from 'three';
const L = new THREE.TextureLoader(), cache = {};
export function tex(name, rep = [1, 1], color = true) {
  const k = name + rep.join(','); if (cache[k]) return cache[k];
  const t = L.load('assets/tex/' + name); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace; return (cache[k] = t);
}
// 색·노멀·거칠기 한 벌
export function pbr(base, rep, o = {}) {
  return { map: tex(base + '_col.jpg', rep), normalMap: tex(base + '_nrm.jpg', rep, false), roughnessMap: tex(base + '_rgh.jpg', rep, false), roughness: 1, ...o };
}
