// GLSL 셰이더 (절차적 행성 표면 · 대기 산란 · 고리 · 항성 · 은하수 · 입자 · 중력렌즈)
const NOISE = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 nm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=nm.x; p1*=nm.y; p2*=nm.z; p3*=nm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p, int o){ float s=0.0, a=0.5; for(int i=0;i<8;i++){ if(i>=o) break; s+=a*snoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }
`;
const RING = /* glsl */`
float ringD(float x){
  float b = 0.55 + 0.2*sin(x*97.0) + 0.12*sin(x*263.0+1.7) + 0.08*sin(x*611.0);
  float c = (1.0-smoothstep(0.26,0.30,x))*0.32;
  float B = smoothstep(0.26,0.30,x)*(1.0-smoothstep(0.67,0.69,x));
  float A = smoothstep(0.75,0.77,x)*0.72*(1.0-0.85*smoothstep(0.944,0.948,x)*(1.0-smoothstep(0.956,0.96,x)));
  float cas = smoothstep(0.67,0.69,x)*(1.0-smoothstep(0.75,0.77,x))*0.06;
  return clamp((c+B+A+cas)*b*1.45,0.0,1.0)*smoothstep(0.0,0.02,x)*(1.0-smoothstep(0.98,1.0,x));
}
`;
const VS_BODY = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vObj; varying vec3 vW; varying vec3 vN;
void main(){
  vObj = position; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal);
  gl_Position = projectionMatrix*viewMatrix*w;
  #include <logdepthbuf_vertex>
}`;
const LIGHTS = /* glsl */`
uniform vec3 uLPos[2]; uniform vec3 uLCol[2]; uniform float uLRad[2]; uniform int uNL;
uniform vec4 uOcc[4]; uniform int uNO;
uniform vec3 uCenter; uniform float uRadius; uniform float uRingIn; uniform float uRingOut; uniform vec3 uRingN;
float occlude(vec3 P, vec3 Lp, float Rl){
  float sh = 1.0; vec3 toL = Lp-P; float dL = length(toL); vec3 ld = toL/dL; float aL = Rl/dL;
  for(int i=0;i<4;i++){
    if(i>=uNO) break;
    vec3 o = uOcc[i].xyz-P; float dO = length(o); float t = dot(o,ld);
    if(t<=0.0 || t>dL) continue;
    float aO = uOcc[i].w/dO; float sep = length(cross(o/dO, ld));
    float cover = 1.0-smoothstep(abs(aO-aL), aO+aL, sep);
    sh *= 1.0 - cover*min(1.0, (aO*aO)/(aL*aL+1e-14));
  }
  if(uRingOut>0.0){
    float dn = dot(ld,uRingN);
    if(abs(dn)>1e-4){ float t = dot(uCenter-P,uRingN)/dn;
      if(t>0.0){ float r = length(P+ld*t-uCenter); if(r>uRingIn && r<uRingOut) sh *= 1.0-0.85*ringD((r-uRingIn)/(uRingOut-uRingIn)); } }
  }
  return sh;
}`;

export const planetVS = VS_BODY;
export const planetFS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform int uKind; uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform vec4 uP;
uniform float uSeed; uniform float uTime; uniform float uBump; uniform vec3 uAtmo; uniform float uAtmoK;
varying vec3 vObj; varying vec3 vW; varying vec3 vN;
${NOISE}${RING}${LIGHTS}
float craters(vec3 q){ float s=0.0, f=2.5, a=1.0;
  for(int i=0;i<4;i++){ float n = snoise(q*f+float(i)*7.3);
    s += a*(smoothstep(0.42,0.55,n)*(1.0-smoothstep(0.55,0.62,n))*0.6 - smoothstep(0.58,0.85,n)*0.8); f*=2.2; a*=0.6; }
  return s; }
void main(){
  #include <logdepthbuf_fragment>
  vec3 p = normalize(vObj); vec3 n = normalize(vN); vec3 V = normalize(cameraPosition-vW);
  vec3 alb; float h=0.0, spec=0.0, cloud=0.0, night=0.0; vec3 emis=vec3(0.0);
  vec3 q = p*2.0 + vec3(uSeed);
  if(uKind==1){ // 지구형
    float c = fbm(q*1.3,7) + 0.25*fbm(q*6.0,4);
    float land = smoothstep(0.02,0.06,c), lat = abs(p.y);
    vec3 ocean = mix(uA*0.85, uA*1.2+vec3(0.0,0.05,0.06), smoothstep(-0.12,0.04,c));
    float dry = smoothstep(0.1,0.45, fbm(q*2.7+5.0,4) + (0.32-abs(lat-0.28))*0.9);
    vec3 g = mix(uB, vec3(0.64,0.53,0.35), dry);
    g = mix(g, vec3(0.42,0.40,0.38), smoothstep(0.32,0.6,c));
    alb = mix(ocean, g, land);
    float ice = smoothstep(0.74,0.8, lat + 0.06*fbm(q*4.0,3));
    alb = mix(alb, vec3(0.93,0.95,1.0), ice);
    h = land*(c-0.04); spec = (1.0-land)*(1.0-ice);
    cloud = smoothstep(0.18,0.7, fbm(p*3.0 + vec3(uTime*0.003,0.0,0.0) + 0.8*fbm(p*1.5+vec3(uSeed),3) + 11.0, 6) + 0.12);
    night = land*(1.0-ice)*smoothstep(0.55,0.9, snoise(q*60.0)*0.6+fbm(q*7.0,3)*0.6+0.2)*(1.0-dry*0.85);
  } else if(uKind==2){ // 가스 행성
    float lat = p.y;
    float turb = fbm(vec3(p.x*3.0, lat*9.0, p.z*3.0)+vec3(uSeed, 0.0, uTime*0.0005), 5)*uP.y;
    float bands = sin(lat*uP.x + turb*3.0)*0.5+0.5, fine = sin(lat*uP.x*3.1 + turb*5.0)*0.5+0.5;
    alb = mix(uB, uC, bands); alb = mix(alb, uA, fine*0.35);
    if(uP.z>0.5){
      vec2 sp = vec2(atan(p.z,p.x), lat); vec2 c0 = uP.z<1.5 ? vec2(1.2,-0.36) : vec2(-0.5,-0.32);
      vec2 d = (sp-c0)*vec2(1.0,2.2); float s = exp(-dot(d,d)*(uP.z<1.5?20.0:34.0));
      alb = mix(alb, uP.z<1.5 ? vec3(0.76,0.36,0.2) : vec3(0.06,0.1,0.32), s*0.9);
    }
    alb *= 0.9 + 0.15*fbm(p*12.0+vec3(uSeed),3);
  } else if(uKind==3){ // 얼음 위성
    float c = fbm(q*1.5,5);
    alb = mix(uA, uA*0.82, c*0.5+0.5);
    float cr = 1.0-smoothstep(0.0,0.05,abs(snoise(q*3.0))), cr2 = 1.0-smoothstep(0.0,0.035,abs(snoise(q*7.0+3.0)));
    float k = max(cr, cr2*0.7);
    alb = mix(alb, uB, k*0.8); h = -k*0.3 + c*0.2; spec = 0.12;
  } else if(uKind==4){ // 화산 위성 (이오)
    float c = fbm(q*1.8,6);
    alb = mix(uA, uB, smoothstep(-0.2,0.4,c));
    float spots = smoothstep(0.55,0.7, fbm(q*4.0+7.0,4)+0.3);
    alb = mix(alb, uC, spots);
    emis = vec3(1.0,0.3,0.04)*spots*smoothstep(0.75,0.95, fbm(q*9.0,3)+0.5)*0.5; h = c*0.5;
  } else if(uKind==5){ // 짙은 구름 (금성·타이탄)
    float c = fbm(vec3(p.x*2.0, p.y*5.0, p.z*2.0) + vec3(uTime*0.002,0.0,0.0) + fbm(p*2.0+vec3(uSeed),4), 6);
    alb = mix(uB, uA, smoothstep(-0.4,0.5,c));
  } else if(uKind==6){ // 화성형
    float c = fbm(q*1.2,7);
    alb = mix(uB, uA, smoothstep(-0.25,0.25, c+0.3*fbm(q*3.5,4)));
    float cap = smoothstep(0.83,0.87, abs(p.y)+0.04*fbm(q*5.0,3));
    alb = mix(alb, vec3(0.95,0.93,0.9), cap);
    float cr = craters(q*0.8); alb *= 0.9+0.2*cr; h = c*0.6 + cr*0.4;
  } else { // 크레이터 암석
    float c = fbm(q*1.6,6);
    alb = mix(uA, uB, smoothstep(-0.35,0.35,c));
    float mare = smoothstep(0.1,0.3, fbm(q*0.8+4.0,3));
    alb = mix(alb, uA*0.72, mare*0.6);
    float cr = craters(q); alb *= 0.85+0.3*cr; h = c*0.4 + cr*0.6;
  }
  // 범프 매핑 (Mikkelsen 미분 기반)
  vec3 nb = n;
  if(uBump>0.0){
    float hw = h*uRadius*uBump; vec3 dpx = dFdx(vW), dpy = dFdy(vW);
    float dhx = dFdx(hw), dhy = dFdy(hw); vec3 r1 = cross(dpy,n), r2 = cross(n,dpx); float det = dot(dpx,r1);
    if(abs(det)>1e-30){ vec3 gr = sign(det)*(dhx*r1+dhy*r2); nb = normalize(abs(det)*n - gr); }
  }
  vec3 col = vec3(0.0); float lit = 0.0, day = 0.0;
  for(int i=0;i<2;i++){
    if(i>=uNL) break;
    vec3 L = normalize(uLPos[i]-vW);
    float sh = occlude(vW, uLPos[i], uLRad[i]);
    float nl = max(dot(nb,L),0.0), ng = max(dot(n,L),0.0);
    vec3 H = normalize(L+V);
    float sp = pow(max(dot(n,H),0.0), 70.0)*spec*0.7;
    vec3 c = alb*nl + vec3(sp)*smoothstep(0.0,0.1,ng);
    if(uKind==1) c = mix(c, vec3(ng*0.82+0.01), cloud*0.85);
    col += c*uLCol[i]*sh; lit += ng*sh;
    day += smoothstep(-0.3,0.6,dot(n,L))*sh*length(uLCol[i]);
  }
  col += alb*0.01;
  if(uKind==1) col += vec3(1.0,0.7,0.35)*night*(1.0-smoothstep(0.0,0.12,lit))*(1.0-cloud)*0.55;
  col += emis*(1.0-smoothstep(0.0,0.3,lit)*0.6);
  if(uAtmoK>0.0){ float fr = pow(1.0-max(dot(n,V),0.0), 2.6); col += uAtmo*fr*day*0.55; col = mix(col, uAtmo*day*0.35, fr*0.2); }
  gl_FragColor = vec4(col,1.0);
}`;

export const atmoVS = VS_BODY;
export const atmoFS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCenter; uniform vec3 uAtmo; uniform float uR; uniform float uRa; uniform float uK;
uniform vec3 uLPos[2]; uniform vec3 uLCol[2]; uniform int uNL;
varying vec3 vObj; varying vec3 vW; varying vec3 vN;
void main(){
  #include <logdepthbuf_fragment>
  vec3 ro = cameraPosition, rd = normalize(vW-ro);
  float tca = dot(uCenter-ro, rd); vec3 pc = ro + rd*max(tca,0.0); float d = length(pc-uCenter);
  float hN = clamp((d-uR)/(uRa-uR),0.0,1.0);
  float dens = exp(-hN*5.0)*(1.0-hN);
  vec3 up = normalize(pc-uCenter), c = vec3(0.0);
  for(int i=0;i<2;i++){
    if(i>=uNL) break;
    vec3 L = normalize(uLPos[i]-pc); float mu = dot(up,L);
    float dayk = smoothstep(-0.35,0.5,mu), fw = pow(max(dot(rd,L),0.0),8.0)*0.8;
    vec3 tint = mix(vec3(1.0,0.42,0.18), uAtmo, smoothstep(-0.12,0.35,mu));
    c += tint*uLCol[i]*dayk*(1.0+fw);
  }
  gl_FragColor = vec4(c*dens*uK, 1.0);
}`;

export const ringVS = VS_BODY;
export const ringFS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCenter; uniform vec3 uCol; uniform float uIn; uniform float uOut; uniform float uR; uniform float uOp;
uniform vec3 uLPos[2]; uniform vec3 uLCol[2]; uniform int uNL;
varying vec3 vObj; varying vec3 vW; varying vec3 vN;
${RING}
void main(){
  #include <logdepthbuf_fragment>
  float r = length(vW-uCenter), x = (r-uIn)/(uOut-uIn);
  if(x<0.0 || x>1.0) discard;
  float d = ringD(x)*uOp;
  vec3 c = vec3(0.0), V = normalize(cameraPosition-vW);
  for(int i=0;i<2;i++){
    if(i>=uNL) break;
    vec3 ld = normalize(uLPos[i]-vW), oc = vW-uCenter;
    float b = dot(oc,ld), cc = dot(oc,oc)-uR*uR, disc = b*b-cc;
    float sh = (b<0.0) ? smoothstep(0.0, uR*uR*0.02, -disc) : 1.0;
    float fwd = 0.7 + 0.6*pow(max(dot(-V,ld),0.0),4.0);
    c += uLCol[i]*max(sh,0.04)*fwd;
  }
  vec3 col = uCol*(0.8+0.2*sin(x*340.0))*c;
  gl_FragColor = vec4(col, d);
}`;

export const starVS = VS_BODY;
export const starFS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCol; uniform float uTime; uniform float uI;
varying vec3 vObj; varying vec3 vW; varying vec3 vN;
${NOISE}
void main(){
  #include <logdepthbuf_fragment>
  vec3 p = normalize(vObj), V = normalize(cameraPosition-vW);
  float mu = max(dot(normalize(vN),V),0.0);
  float g = fbm(p*30.0+vec3(0.0,uTime*0.02,0.0),4), g2 = fbm(p*5.0-vec3(uTime*0.004),3);
  float spots = smoothstep(0.42,0.55,g2);
  vec3 c = uCol*(0.78+0.4*g)*(1.0-0.65*spots)*pow(mu,0.4);
  c = mix(c, uCol*vec3(1.0,0.7,0.45), (1.0-mu)*0.45);
  gl_FragColor = vec4(c*uI,1.0);
}`;

export const glowVS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);
  #include <logdepthbuf_vertex>
}`;
export const glowFS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCol; uniform float uTime; uniform float uI; uniform float uRays; uniform float uCore;
varying vec2 vUv;
${NOISE}
void main(){
  #include <logdepthbuf_fragment>
  vec2 d = vUv*2.0-1.0; float r = length(d); if(r>1.0) discard;
  float a = atan(d.y,d.x);
  float glow = exp(-r*uCore)*1.1 + exp(-r*2.4)*0.22;
  float rays = uRays*pow(abs(snoise(vec3(a*3.0, r*1.5-uTime*0.03, 1.0))),2.0)*exp(-r*3.2)*0.7;
  gl_FragColor = vec4(uCol*(glow+rays)*uI*(1.0-smoothstep(0.6,1.0,r)), 1.0);
}`;

export const skyVS = /* glsl */`
varying vec3 vD;
void main(){ vD = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
export const skyFS = /* glsl */`
uniform vec3 uGC; uniform vec3 uNGP; uniform float uI;
varying vec3 vD;
${NOISE}
void main(){
  vec3 d = normalize(vD); float b = dot(d,uNGP);
  vec3 e1 = normalize(uGC), e2 = cross(uNGP,e1); float l = atan(dot(d,e2), dot(d,e1));
  float band = exp(-b*b/0.018)*(0.5+0.5*exp(-l*l/1.4));
  float n = fbm(d*5.0,5)*0.5+0.5;
  float dust = smoothstep(0.45,0.75, fbm(d*9.0+3.0,5)*0.5+0.5)*exp(-b*b/0.004);
  float bulge = exp(-(l*l+b*b*5.0)/0.22);
  vec3 col = vec3(0.55,0.6,0.78)*band*n*0.11 + vec3(1.0,0.8,0.58)*bulge*0.12;
  col *= 1.0-dust*0.85;
  float neb = smoothstep(0.58,0.92, fbm(d*2.2+11.0,4)*0.5+0.5);
  col += mix(vec3(0.28,0.05,0.12), vec3(0.04,0.12,0.28), fbm(d*1.5,2)*0.5+0.5)*neb*0.04;
  gl_FragColor = vec4(col*uI,1.0);
}`;

export const starsVS = /* glsl */`
attribute float aSize; attribute vec3 aCol; uniform float uPR; varying vec3 vC;
void main(){ vC = aCol; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize*uPR; }`;
export const starsFS = /* glsl */`
varying vec3 vC;
void main(){ vec2 d = gl_PointCoord*2.0-1.0; float r2 = dot(d,d); if(r2>1.0) discard; gl_FragColor = vec4(vC*exp(-r2*4.0),1.0); }`;

export const partVS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aCol; attribute vec3 aVel; uniform float uSize; uniform float uPR; uniform float uBeam; varying vec4 vC;
void main(){
  vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
  float b = 1.0;
  if(uBeam>0.5){ vec3 vv = mat3(viewMatrix)*aVel; float be = min(length(aVel),0.99); float g = 1.0/sqrt(1.0-be*be);
    float D = 1.0/(g*(1.0-dot(vv, normalize(-mv.xyz)))); b = clamp(D*D*D, 0.02, 12.0); }
  vC = vec4(aCol.rgb*b, aCol.a);
  gl_PointSize = aCol.a>0.0 ? uSize*uPR : 0.0;
  #include <logdepthbuf_vertex>
}`;
export const partFS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec4 vC;
void main(){
  #include <logdepthbuf_fragment>
  vec2 d = gl_PointCoord*2.0-1.0; float r2 = dot(d,d); if(r2>1.0) discard;
  gl_FragColor = vec4(vC.rgb*exp(-r2*3.0)*vC.a,1.0);
}`;

export const plumeVS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv; varying float vF;
void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vec3 n = normalize(normalMatrix*normal);
  vF = abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix*mv;
  #include <logdepthbuf_vertex>
}`;
export const plumeFS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCol; uniform float uT; uniform float uTime; varying vec2 vUv; varying float vF;
void main(){
  #include <logdepthbuf_fragment>
  float y = vUv.y, fl = 0.85+0.15*sin(uTime*70.0+y*25.0);
  float a = pow(y,2.2)*vF*vF*uT*fl;
  vec3 c = mix(uCol, vec3(1.0), pow(y,6.0)*0.8)*a*3.0;
  gl_FragColor = vec4(c,1.0);
}`;

export const lensShader = {
  uniforms: { tDiffuse: { value: null }, uC: { value: [0.5, 0.5] }, uR: { value: 0 }, uAsp: { value: 1 }, uOn: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse; uniform vec2 uC; uniform float uR; uniform float uAsp; uniform float uOn; varying vec2 vUv;
void main(){
  if(uOn<0.5){ gl_FragColor = texture2D(tDiffuse,vUv); return; }
  vec2 d = vUv-uC; d.x *= uAsp; float b = max(length(d),1e-6); vec2 dir = d/b;
  float te = uR*1.55, bs = b - te*te/b;
  vec2 s = uC + vec2(dir.x/uAsp, dir.y)*bs;
  vec3 c = texture2D(tDiffuse, clamp(s,0.001,0.999)).rgb;
  c *= smoothstep(uR*0.97, uR*1.04, b);
  c += vec3(1.0,0.8,0.55)*exp(-pow((b-uR*1.06)/(uR*0.035),2.0))*0.25;
  gl_FragColor = vec4(c,1.0);
}`,
};
