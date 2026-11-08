// 피부 재질: 가볍고 빠르게 (MeshLambertMaterial)
//  · 색·주름·손톱은 손·팔 모델의 텍스처(색, 노멀맵, AO)를 그대로 쓴다
//  · 손가락 굵기 보정(girth): 스캔한 내 손가락 굵기에 맞게 뼈 축 기준으로만 살을 넓히거나 좁힘
import * as THREE from 'three';

const VERT_PARS = /* glsl */`
attribute float fingerId;
attribute vec4 girthData;
uniform float girth[ 5 ];`;
const VERT_MAIN = /* glsl */`
transformed += girthData.xyz * ( girth[ int( fingerId + 0.5 ) ] - 1.0 ) * girthData.w;`;

// opts.girth: Float32Array(5) 손가락 굵기 배율 (참조로 실시간 반영). 나머지는 MeshLambertMaterial 옵션
export function makeSkin({ girth = null, ...opts } = {}) {
  const m = new THREE.MeshLambertMaterial(opts);
  if (girth) {
    m.onBeforeCompile = sh => {
      sh.uniforms.girth = { value: girth };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    };
    m.customProgramCacheKey = () => 'handvr-skin-girth';
  }
  return m;
}
