// SpaceSim — 공용 GLSL 조각 (노이즈 · 셀룰러 · 흑체 · 범프)

export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
#ifndef OCT
#define OCT 6
#endif
float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<OCT;i++){ s+=a*snoise(p); p=p*2.02+vec3(1.7,9.2,3.1); a*=.5; } return s; }
float fbmN(vec3 p, int n){ float a=.5,s=0.; for(int i=0;i<8;i++){ if(i>=n) break; s+=a*snoise(p); p=p*2.03+vec3(5.1,1.3,7.7); a*=.5; } return s; }
float ridged(vec3 p, int n){ float a=.5,s=0.; for(int i=0;i<8;i++){ if(i>=n) break; s+=a*(1.-abs(snoise(p))); p=p*2.1+vec3(3.3,.7,9.1); a*=.5; } return s; }
vec3 hash33(vec3 p){ p=fract(p*vec3(.1031,.1030,.0973)); p+=dot(p,p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
float hash13(vec3 p){ p=fract(p*.1031); p+=dot(p,p.zyx+31.32); return fract((p.x+p.y)*p.z); }
// 셀룰러 크레이터 높이 (0=바닥, 0..+ 림)
float craters(vec3 x){
  vec3 p=floor(x), f=fract(x); float h=0.;
  for(int k=-1;k<=1;k++) for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec3 b=vec3(float(i),float(j),float(k)); vec3 rnd=hash33(p+b);
    vec3 r=b+rnd-f; float d=length(r); float rad=.25+.3*rnd.x;
    if(rnd.y>.55) continue;
    float t=d/rad;
    h+= (t<1. ? (t*t-1.)*.8 : 0.) + exp(-pow((t-1.)*4.,2.))*.35;
  }
  return h;
}
`;

export const BLACKBODY = /* glsl */ `
vec3 blackbody(float T){
  float t=clamp(T,1000.,40000.)/100.; vec3 c;
  if(t<=66.){ c.r=1.; c.g=clamp(.39008157876*log(t)-.63184144378,0.,1.); c.b= t<=19. ? 0. : clamp(.54320678911*log(t-10.)-1.19625408914,0.,1.); }
  else { c.r=clamp(1.29293618606*pow(t-60.,-.1332047592),0.,1.); c.g=clamp(1.12989086089*pow(t-60.,-.0755148492),0.,1.); c.b=1.; }
  return pow(c,vec3(2.2));
}
`;

// 스크린 공간 미분 기반 범프 (Mikkelsen)
export const BUMP = /* glsl */ `
vec3 bumpNormal(vec3 pos, vec3 n, float h, float k){
  vec3 dpx=dFdx(pos), dpy=dFdy(pos); float dhx=dFdx(h), dhy=dFdy(h);
  vec3 r1=cross(dpy,n), r2=cross(n,dpx); float det=dot(dpx,r1);
  vec3 grad=sign(det)*(dhx*r1+dhy*r2);
  return normalize(abs(det)*n - k*grad);
}
`;

// 토성 고리 밀도 프로파일 (t: 0=안쪽, 1=바깥)
export const RING = /* glsl */ `
float ringDensity(float t){
  if(t<0.||t>1.) return 0.;
  float d = t<.2 ? .18+.1*sin(t*90.) : (t<.56 ? .85+.12*sin(t*210.)+.06*sin(t*530.) : .55+.1*sin(t*160.));
  d *= 1.-smoothstep(.56,.575,t)*(1.-smoothstep(.62,.635,t));   // 카시니 간극
  d *= 1.-.85*smoothstep(.855,.86,t)*(1.-smoothstep(.868,.873,t)); // 엥케 간극
  d *= smoothstep(0.,.03,t)*(1.-smoothstep(.93,1.,t));
  return clamp(d,0.,1.);
}
`;
