// 피부 재질 (MeshPhysicalMaterial 패치)
//  · 색·주름·모공·핏줄은 손·팔 모델의 텍스처(색, 노멀맵, 거칠기·AO)를 그대로 쓴다
//  · SSS 근사: 빛이 살 속에서 퍼져 명암 경계가 붉고 부드러움 + 역광일 때 손가락이 붉게 비침
//  · 손가락 굵기 보정(girth): 스캔한 내 손가락 굵기에 맞게 뼈 축 기준으로만 살을 넓히거나 좁힘
import * as THREE from 'three';

export const SSS = {
  sssColor: { value: new THREE.Color(1.0, 0.32, 0.2) },
  sssWrap: { value: 0.5 },
  sssTrans: { value: 1.8 },
};
const DIRECT = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

const VERT_PARS = /* glsl */`
attribute float thin;
varying float vThin;
#ifdef SKIN_GIRTH
attribute float fingerId;
attribute vec4 girthData;
uniform float girth[ 5 ];
#endif`;
const VERT_MAIN = /* glsl */`
vThin = thin;
#ifdef SKIN_GIRTH
transformed += girthData.xyz * ( girth[ int( fingerId + 0.5 ) ] - 1.0 ) * girthData.w;
#endif`;

const FRAG_PARS = /* glsl */`
uniform vec3 sssColor;
uniform float sssWrap;
uniform float sssTrans;
varying float vThin;
void skinSSS( const in IncidentLight dl, const in vec3 n, const in vec3 v, const in PhysicalMaterial mat, inout ReflectedLight rl ) {
  float ndl = dot( n, dl.direction );
  float wrapped = max( 0.0, ( ndl + sssWrap ) / ( 1.0 + sssWrap ) );
  float scatter = max( wrapped - max( ndl, 0.0 ), 0.0 );
  vec3 bh = normalize( dl.direction + n * 0.3 );
  float trans = pow( saturate( dot( v, -bh ) ), 4.0 ) * sssTrans * vThin;
  rl.directDiffuse += dl.color * mat.diffuseColor * sssColor * ( scatter + trans ) * RECIPROCAL_PI;
}`;

// opts.girth: Float32Array(5) 손가락 굵기 배율 (참조로 실시간 반영). 나머지는 MeshPhysicalMaterial 옵션
export function makeSkin({ girth = null, ...opts } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    roughness: 0.56, metalness: 0, specularIntensity: 0.5, ior: 1.42,
    sheen: 0.15, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffb0a0),
    clearcoat: 0.08, clearcoatRoughness: 0.4,
    ...opts,
  });
  if (girth) m.defines = { SKIN_GIRTH: '' };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, SSS);
    if (girth) sh.uniforms.girth = { value: girth };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + FRAG_PARS)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replaceAll(DIRECT,
        DIRECT + '\n\t\tskinSSS( directLight, geometryNormal, geometryViewDir, material, reflectedLight );'));
  };
  m.customProgramCacheKey = () => 'handvr-skin';
  return m;
}
