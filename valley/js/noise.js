// 노이즈 유틸 (JS + GLSL)
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function h2(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), d = h2(xi + 1, yi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
export function fbm(x, y, oct = 5) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f + i * 17.3, y * f - i * 9.1); f *= 2.03; a *= 0.5; }
  return s;
}
export const sstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export const GLSL_NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float hash13(vec3 p3){ p3=fract(p3*.1031); p3+=dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
float vnoise2(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x),u.y); }
float vnoise3(vec3 p){ vec3 i=floor(p), f=fract(p); vec3 u=f*f*(3.-2.*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),u.x), mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),u.x),u.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),u.x), mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),u.x),u.y),u.z); }
float fbm2(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise2(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
float fbm3(vec3 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise3(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5; } return s; }
vec3 voronoi(vec2 x){ vec2 n=floor(x), f=fract(x); float md=8., md2=8.; float id=0.;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(i,j); vec2 o=hash22(n+g); vec2 r=g+o-f; float d=dot(r,r);
    if(d<md){ md2=md; md=d; id=hash12(n+g); } else if(d<md2) md2=d; }
  return vec3(sqrt(md), id, sqrt(md2)-sqrt(md)); }
float caustic(vec2 p, float t){
  vec3 a = voronoi(p*1.7 + vec2(t*.31, t*.22));
  vec3 b = voronoi(p*2.3 - vec2(t*.27, -t*.35) + 3.1);
  return pow(1.-smoothstep(0.,.22,a.z),3.) + pow(1.-smoothstep(0.,.18,b.z),3.)*.7;
}
// 물 데이터 텍스처 샘플 (R=수면높이, G=수심, B=젖음, A=거품)
uniform sampler2D tWater; uniform vec4 uWInfo; uniform vec2 uWSize;
vec4 waterAt(vec2 xz){
  vec2 c = (xz - uWInfo.xy) * uWInfo.z;
  vec2 uv = (c + .5) / uWSize;
  if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.) return vec4(-100.,0.,0.,0.);
  return texture2D(tWater, uv);
}
// 범프: 높이 h 의 화면 미분으로 노멀 교란
vec3 bumpN(vec3 surfPos, vec3 n, float h, float strength){
  vec3 dpx = dFdx(surfPos), dpy = dFdy(surfPos);
  float dhx = dFdx(h)*strength, dhy = dFdy(h)*strength;
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det) * (dhx*r1 + dhy*r2);
  return normalize(abs(det)*n - g);
}
`;
