// 바람에 흔들리는 풀 포기 (high/ultra): 카메라를 따라 반복되는 인스턴스 타일.
// 각 포기는 월드에 고정된 격자 위치(타일 크기 S로 반복)에 있어 카메라가 움직여도 미끄러지지 않음.
// 배치 가능 여부는 CPU에서 만든 밀도 마스크(콘크리트·아스팔트·건물·경사로 제외)를 정점 셰이더에서 샘플.
import * as THREE from 'three';
import { mulberry } from '../core/util.js';

const BLADES = 5;

function tuftGeometry(R) {
  const pos = [], h = [];
  for (let b = 0; b < BLADES; b++) {
    const a = R() * Math.PI * 2, r = 0.02 + R() * 0.07, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const fa = R() * Math.PI, w = 0.014 + R() * 0.012, ht = 0.2 + R() * 0.22, lean = 0.05 + R() * 0.09;
    const ux = Math.cos(fa) * w, uz = Math.sin(fa) * w, lx = Math.cos(a) * lean, lz = Math.sin(a) * lean; // 바깥쪽으로 기울어짐
    pos.push(cx - ux, 0, cz - uz, cx + ux, 0, cz + uz, cx + lx, ht, cz + lz); h.push(0, 0, 1);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('gH', new THREE.Float32BufferAttribute(h, 1));
  return g;
}

export class Grass {
  // density(x, z) → 0..1 , rect = [x0, z0, x1, z1] 마스크 범위 (m)
  constructor(scene, { count = 20000, radius = 30 } = {}, density, rect = [-200, -145, 200, 255]) {
    const R = mulberry(4242), S = radius * 2;
    // 밀도 마스크 (1 m/texel)
    const mw = rect[2] - rect[0], mh = rect[3] - rect[1], md = new Uint8Array(mw * mh);
    for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) md[j * mw + i] = Math.round(Math.max(0, Math.min(1, density(rect[0] + i + 0.5, rect[1] + j + 0.5))) * 255);
    const mask = new THREE.DataTexture(md, mw, mh, THREE.RedFormat, THREE.UnsignedByteType);
    mask.magFilter = mask.minFilter = THREE.LinearFilter; mask.needsUpdate = true;
    const geo = tuftGeometry(R), off = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { off[i * 4] = R() * S; off[i * 4 + 1] = R() * S; off[i * 4 + 2] = R(); off[i * 4 + 3] = R(); }
    geo.setAttribute('iOff', new THREE.InstancedBufferAttribute(off, 4)); geo.instanceCount = count;
    this.u = {
      uCam: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector2(0, -1) }, uTime: { value: 0 }, uS: { value: S }, uR: { value: radius },
      uMask: { value: mask }, uMaskRect: { value: new THREE.Vector4(rect[0], rect[1], 1 / mw, 1 / mh) },
    };
    const mat = (this.mat = new THREE.MeshStandardMaterial({ color: 0x6b8a3a, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5 }));
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 iOff; attribute float gH;
          uniform vec3 uCam; uniform vec2 uFwd; uniform float uTime; uniform float uS; uniform float uR; uniform sampler2D uMask; uniform vec4 uMaskRect;
          varying float vGH; varying float vGV;`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );')
        .replace('#include <begin_vertex>', `
          vec2 gb = iOff.xy + uS * floor( ( uCam.xz - iOff.xy ) / uS + 0.5 );
          vec2 gdv = gb - uCam.xz; float gd = length( gdv );
          float gm = texture2D( uMask, ( gb - uMaskRect.xy ) * uMaskRect.zw ).r;
          float gk = step( iOff.z, gm * mix( 1.0, 0.4, smoothstep( uR * 0.3, uR, gd ) ) );   // 멀수록 성기게
          gk *= step( - 0.35, dot( gdv, uFwd ) / max( gd, 1e-3 ) ) + step( gd, 2.5 );       // 카메라 뒤쪽은 생략
          float gs = min( gk, 1.0 ) * ( 1.0 - smoothstep( uR * 0.8, uR, gd ) ) * ( 0.7 + 0.6 * iOff.w );
          float ga = iOff.z * 37.0 + iOff.w * 11.0, gc = cos( ga ), gn = sin( ga );
          vec3 lp = position * gs; lp.y *= 0.75 + 0.6 * fract( iOff.z * 13.7 );
          lp = vec3( lp.x * gc - lp.z * gn, lp.y, lp.x * gn + lp.z * gc );
          float w1 = sin( uTime * 1.5 + gb.x * 0.15 + gb.y * 0.09 ), w2 = sin( uTime * 3.4 + gb.x * 0.8 - gb.y * 0.55 + iOff.w * 6.28 );
          float gust = 0.3 + 0.5 * ( 0.5 + 0.5 * sin( uTime * 0.37 + gb.x * 0.03 ) );
          vec2 gw = vec2( 0.85, 0.5 ) * ( gust * ( 0.55 + 0.45 * w1 ) + 0.12 * w2 );
          float gh2 = gH * gH;
          lp.xz += gw * gh2 * 0.17 * gs; lp.y -= dot( gw, gw ) * gh2 * 0.05 * gs;
          vec3 transformed = vec3( gb.x, - 0.025, gb.y ) + lp;
          vGH = gH; vGV = iOff.w;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGH; varying float vGV;')
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb *= mix( vec3( 0.28, 0.36, 0.2 ), vec3( 1.05, 1.08, 0.78 ), vGH ) * ( 0.78 + 0.44 * vGV ) * mix( vec3( 1.0 ), vec3( 1.25, 1.05, 0.62 ), step( 0.82, vGV ) * 0.6 );`);
    };
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }
  update(t, camera) {
    this.u.uTime.value = t; this.u.uCam.value.copy(camera.position);
    const f = camera.getWorldDirection(_f); this.u.uFwd.value.set(f.x, f.z).normalize();
    this.mesh.visible = camera.position.y < 60;
  }
  dispose() { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); this.mat.dispose(); this.u.uMask.value.dispose(); }
}
const _f = new THREE.Vector3();
