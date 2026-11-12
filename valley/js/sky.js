// 하늘 돔 + 대기색 함수(물 반사와 공유)
import * as THREE from 'three';
import { U } from './terrain.js';
import { GLSL_NOISE } from './noise.js';

export const GLSL_SKY = /* glsl */`
uniform vec3 uSunDir; uniform float uRain, uDay;
vec3 skyCol(vec3 d){
  float y = d.y;
  vec3 zen = vec3(0.07,0.21,0.60), hor = vec3(0.60,0.74,0.90);
  vec3 c = mix(hor, zen, pow(clamp(y,0.,1.), 0.45));
  float sd = max(dot(d,uSunDir),0.);
  c += vec3(1.0,0.78,0.52)*(pow(sd,6.)*0.22 + pow(sd,48.)*0.5);
  c = mix(c, vec3(0.40,0.43,0.46)*(0.8+0.2*clamp(y,0.,1.)), uRain*0.85);
  if(y<0.) c = mix(c, vec3(0.30,0.34,0.36)*(1.-uRain*0.4), clamp(-y*4.,0.,1.));
  // 해 질 녘 노을
  float low = 1. - smoothstep(0.0, 0.35, uSunDir.y);
  c = mix(c, c*vec3(1.15,0.75,0.55) + vec3(0.5,0.22,0.08)*pow(max(dot(d,uSunDir),0.),3.)*(1.-abs(y)), low*uDay);
  vec3 night = vec3(0.010,0.016,0.034) + vec3(0.02,0.03,0.06)*pow(1.-clamp(y,0.,1.),3.);
  return mix(night, c*1.25, uDay);
}`;

export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: U, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }`,
    fragmentShader: GLSL_NOISE + GLSL_SKY + /* glsl */`
uniform float uTime; varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir); vec3 c = skyCol(d);
  float sd = dot(d, uSunDir);
  c += vec3(1.,0.92,0.78)*smoothstep(0.99935,0.9997,sd)*45.*(1.-uRain)*uDay;
  c += vec3(0.85,0.9,1.)*smoothstep(0.9996,0.9998,sd)*3.*(1.-uDay)*(1.-uRain); // 달
  if (d.y > 0.) { vec2 sp = d.xz / (d.y + 0.25) * 90.; float st = step(0.9975, hash12(floor(sp))) * hash12(floor(sp) + 3.1);
    c += vec3(st) * (1. - uDay) * (1. - uRain) * 2.; } // 별
  if(d.y>0.){
    vec2 p = d.xz/(d.y+0.12)*1.3 + vec2(uTime*0.006, uTime*0.0025);
    float n = fbm2(p) + 0.35*fbm2(p*3.1+7.);
    float cov = mix(0.78, 0.45, uRain);
    float cl = smoothstep(cov, cov+0.3, n);
    float lit = 0.72 + 0.4*fbm2(p*2.3+3.);
    vec3 cc = mix(vec3(1.06,1.03,0.99)*lit, vec3(0.52,0.54,0.57)*lit, uRain*0.8);
    cc += vec3(1.,0.82,0.6)*pow(max(sd,0.),10.)*0.7;
    c = mix(c, cc*1.15*mix(0.06, 1., uDay), cl*smoothstep(0.,0.15,d.y));
  }
  gl_FragColor = vec4(c,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  m.frustumCulled = false; m.renderOrder = -10;
  return m;
}
