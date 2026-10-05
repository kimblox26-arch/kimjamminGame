// SpaceSim — 천체 시각화: 절차적 행성 셰이더, 항성 표면/코로나, 대기, 구름, 고리
import * as THREE from 'three';
import { NOISE, BLACKBODY, BUMP, RING } from './glsl.js';
import { blackbody } from './util.js';

// 공용 조명 유니폼 (최대 2개 항성)
export const LIGHTS = {
  uStarPos: { value: [new THREE.Vector3(), new THREE.Vector3()] },
  uStarCol: { value: [new THREE.Color(1, 1, 1), new THREE.Color(0, 0, 0)] },
  uStarCount: { value: 1 },
  uTime: { value: 0 },
};

const LIGHT_GLSL = /* glsl */ `
uniform vec3 uStarPos[2]; uniform vec3 uStarCol[2]; uniform int uStarCount;
`;

// 스타일 번호
export const STYLE = { rocky: 0, earth: 1, mars: 2, cloudy: 3, gas: 4, ice: 5, io: 6, europa: 7, lava: 8, pluto: 9 };

const PLANET_VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vWorld; varying vec3 vNormalW;
void main(){
  vObj = position;
  vec4 w = modelMatrix*vec4(position,1.);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix)*normal);
  gl_Position = projectionMatrix*viewMatrix*w;
}`;

const PLANET_FRAG = /* glsl */ `
${NOISE}
${BUMP}
${RING}
${LIGHT_GLSL}
uniform vec3 uColA, uColB, uColC; uniform float uSeed, uRadius, uTime2, uSpot, uBands, uBump;
uniform vec3 uRingN; uniform float uRingIn, uRingOut;
varying vec3 vObj; varying vec3 vWorld; varying vec3 vNormalW;

void main(){
  vec3 p = normalize(vObj) ;
  vec3 q = p + vec3(uSeed);
  vec3 albedo = uColA; float h = 0.; float spec = 0.; vec3 emit = vec3(0.); float bumpK = 0.; float rough = 40.;
  float lat = p.y;

#if STYLE == 0
  // 암석 위성/행성: 크레이터 + 바다(마리아)
  float base = fbm(q*2.2);
  float maria = smoothstep(.05,.35, fbmN(q*1.3+3.,4)) * uSpot;
  float cr = craters(q*6.)*.6 + craters(q*15.)*.3 + craters(q*34.)*.15;
  h = cr + base*.4;
  albedo = mix(uColA, uColB, clamp(.5+base*.8,0.,1.));
  albedo = mix(albedo, uColC, maria);
  albedo *= .85 + .2*fbmN(q*40.,3);
  bumpK = .9;
#elif STYLE == 1
  // 지구형: 대륙/해양/빙하/사막/도시 불빛
  float c = fbm(q*1.5) + .5*fbmN(q*5.,4)*.5;
  float landM = smoothstep(.0,.035,c-.04);
  float moist = fbmN(q*3.+7.,4);
  float alat = abs(lat);
  vec3 ocean = mix(vec3(.004,.02,.07), vec3(.01,.09,.16), smoothstep(-.25,.04,c));
  vec3 green = mix(vec3(.04,.14,.03), vec3(.1,.17,.05), moist*.5+.5);
  vec3 desert = vec3(.42,.32,.18);
  float dry = smoothstep(.1,.35,1.-abs(alat-.3)*3.) * smoothstep(.1,-.2,moist);
  vec3 land = mix(green, desert, dry);
  float mount = smoothstep(.25,.5,c);
  land = mix(land, vec3(.22,.18,.14), mount*.7);
  float ice = smoothstep(.72,.8, alat + fbmN(q*6.,3)*.08) ;
  float snow = smoothstep(.45,.6,c) * smoothstep(.35,.6,alat+.2);
  albedo = mix(ocean, land, landM);
  albedo = mix(albedo, vec3(.8,.85,.9), max(ice,snow));
  spec = (1.-landM)*(1.-ice)*.9; rough = 70.;
  h = landM*(c*.6 + ridged(q*14.,4)*.25*mount);
  bumpK = .35;
  float city = landM*(1.-ice)*(1.-dry*.7)*smoothstep(.55,.85, fbmN(q*22.,4)+.35*snoise(q*70.));
  emit = vec3(1.,.62,.28)*city*1.6;
#elif STYLE == 2
  // 화성: 산화철 지표, 어두운 지역, 협곡, 극관
  float n = fbm(q*2.);
  float dark = smoothstep(.0,.3,fbmN(q*1.6+2.,5));
  albedo = mix(uColA, uColB, dark*.75);
  albedo = mix(albedo, uColC, smoothstep(.3,.6,n)*.5);
  float canyon = smoothstep(.9,.98, ridged(q*vec3(3.,9.,3.),3)) * smoothstep(.35,0.,abs(lat+.05));
  float cr = craters(q*7.)*.35 + craters(q*18.)*.15;
  h = n*.5 + cr - canyon*.6;
  albedo *= 1.-canyon*.3;
  float cap = smoothstep(.82,.88, abs(lat)+fbmN(q*5.,3)*.06);
  albedo = mix(albedo, vec3(.85,.86,.88), cap);
  bumpK = .7;
#elif STYLE == 3
  // 두꺼운 대기 (금성/타이탄): 소용돌이 구름
  vec3 w = q*vec3(1.,3.,1.);
  float sw = fbm(w*1.5 + vec3(uTime2*.02,0.,0.) + fbmN(w*2.,3));
  albedo = mix(uColA, uColB, smoothstep(-.4,.5, sw));
  albedo = mix(albedo, uColC, smoothstep(.3,.8, fbmN(q*4.+sw,3))*.4);
  spec = .1; rough = 12.;
#elif STYLE == 4
  // 가스 행성: 띠, 난류, 대적점
  float warp = fbm(vec3(p.x*2.,p.y*6.,p.z*2.)+vec3(uSeed+uTime2*.01));
  float y = lat + warp*.06 + .015*snoise(q*vec3(12.,40.,12.));
  float band = sin(y*uBands*3.14159 + 1.3) * .5 + .5;
  float band2 = sin(y*uBands*7.3 + .7)*.5+.5;
  albedo = mix(uColA, uColB, smoothstep(.25,.75,band));
  albedo = mix(albedo, uColC, band2*.35*smoothstep(.0,.6,abs(lat)));
  albedo *= .9 + .15*snoise(q*vec3(4.,30.,4.));
  albedo = mix(albedo, uColA*.7, smoothstep(.75,.98,abs(lat))*.5);
  if(uSpot>0.){
    vec3 sc = normalize(vec3(.6,-.36,.72));
    vec3 dd = p - sc; float e = length(dd*vec3(1.,2.4,1.)) ;
    float swirl = snoise(p*18.+e*6.)*.25;
    float spot = smoothstep(.2,.08,e+swirl*.05);
    albedo = mix(albedo, vec3(.62,.25,.12), spot*.85);
    albedo = mix(albedo, vec3(.95,.88,.8), smoothstep(.22,.18,e)*(1.-spot)*.3);
  }
#elif STYLE == 5
  // 얼음 거인: 은은한 띠 + 흰 구름
  float y = lat + fbm(q*vec3(2.,5.,2.))*.05;
  float band = sin(y*uBands*3.14)*.5+.5;
  albedo = mix(uColA, uColB, band*.5);
  float cl = smoothstep(.55,.8, fbmN(vec3(p.x*3.,p.y*14.,p.z*3.)+uSeed,4));
  albedo = mix(albedo, vec3(.92,.96,1.), cl*.6);
  if(uSpot>0.){ vec3 sc=normalize(vec3(.7,-.35,.6)); float e=length((p-sc)*vec3(1.,2.,1.)); albedo = mix(albedo, uColC, smoothstep(.16,.08,e)*.8); }
#elif STYLE == 6
  // 이오: 유황 반점, 화산
  float n = fbm(q*3.);
  albedo = mix(uColA, uColB, smoothstep(-.2,.4,n));
  albedo = mix(albedo, uColC, smoothstep(.35,.6,fbmN(q*6.+1.,4))*.6);
  float volc = smoothstep(.82,.9, hash13(floor(q*9.)) ) * smoothstep(.35,.1, length(fract(q*9.)-.5));
  albedo = mix(albedo, vec3(.05,.03,.02), volc);
  emit = vec3(1.,.3,.05)*volc*smoothstep(.15,.0,length(fract(q*9.)-.5))*2.;
  h = n*.3; bumpK = .3;
#elif STYLE == 7
  // 유로파/얼음 위성: 얼음 지각 + 갈색 균열선
  float lines = smoothstep(.93,.99, ridged(q*3.,4)) + smoothstep(.95,.99, ridged(q*7.+4.,3))*.6;
  float n = fbm(q*2.5);
  albedo = mix(uColA, uColB, smoothstep(-.3,.5,n)*.5);
  albedo = mix(albedo, uColC, clamp(lines,0.,1.)*.75);
  h = -lines*.3 + n*.1 + craters(q*10.)*.06; bumpK = .4; spec = .15;
#elif STYLE == 8
  // 용융 원시행성: 균열 사이로 빛나는 마그마
  float n = fbm(q*3.+vec3(uTime2*.02));
  float crack = smoothstep(.88,.97, ridged(q*4.,4));
  albedo = mix(uColA, uColB, smoothstep(-.3,.4,n));
  emit = mix(vec3(1.,.35,.05), vec3(1.,.8,.3), crack) * (crack*2.4 + smoothstep(.3,.6,n)*.25) * uSpot;
  h = n*.4 - crack*.4; bumpK = .6;
#elif STYLE == 9
  // 명왕성형: 질소 얼음 평원 + 적갈색 지대
  float n = fbm(q*2.);
  albedo = mix(uColA, uColB, smoothstep(-.1,.3,n));
  albedo = mix(albedo, vec3(.92,.9,.86), smoothstep(.25,.1,length((p-normalize(vec3(.8,.0,.6)))*vec3(1.,1.3,1.)))*.9);
  h = n*.3 + craters(q*8.)*.2; bumpK = .5;
#endif

  vec3 N = normalize(vNormalW);
  if(bumpK*uBump>0.) N = bumpNormal(vWorld, N, h*uRadius*.02, bumpK);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 col = vec3(0.); float lit = 0.;
  for(int i=0;i<2;i++){
    if(i>=uStarCount) break;
    vec3 L = normalize(uStarPos[i]-vWorld);
    float ndl = dot(N,L);
    float geo = dot(normalize(vNormalW),L);
    float diff = clamp(ndl,0.,1.) * smoothstep(-.08,.12,geo);
#ifdef HAS_RINGS
    float tt = dot(uRingC - vWorld, uRingN)/dot(L,uRingN);
    if(tt>0.){ vec3 hp = vWorld + L*tt; float rr = length(hp-uRingC)/uRadius; diff *= 1. - .85*ringDensity((rr-uRingIn)/(uRingOut-uRingIn)); }
#endif
    vec3 H = normalize(L+V);
    float sp = pow(max(dot(N,H),0.), rough)*spec*smoothstep(0.,.1,geo);
    col += uStarCol[i]*(albedo*diff + sp*vec3(1.,.95,.85));
    lit += clamp(geo*4.+.3,0.,1.);
  }
  col += albedo*.006;
  col += emit*(1.-clamp(lit,0.,1.));
#if STYLE == 8 || STYLE == 6
  col += emit*.5;
#endif
  gl_FragColor = vec4(col,1.);
}`;

const CLOUD_FRAG = /* glsl */ `
#ifndef OCT
#define OCT 5
#endif
${NOISE}
${LIGHT_GLSL}
uniform float uTime2, uSeed;
varying vec3 vObj; varying vec3 vWorld; varying vec3 vNormalW;
void main(){
  vec3 p = normalize(vObj);
  vec3 q = p*2.2 + vec3(uSeed);
  float w = fbmN(q*1.5 + vec3(uTime2*.01), 3);
  float n = fbm(q + vec3(w*.9, w*.4, uTime2*.006));
  float storms = smoothstep(.3,.6, fbmN(p*5.+w,3)) * smoothstep(.15,.45,abs(p.y));
  float a = smoothstep(.02,.45,n + storms*.2) * .92;
  a *= 1. - smoothstep(.85,.98,abs(p.y))*.3;
  vec3 N = normalize(vNormalW); vec3 col = vec3(0.);
  for(int i=0;i<2;i++){ if(i>=uStarCount) break; vec3 L = normalize(uStarPos[i]-vWorld); col += uStarCol[i]*clamp(dot(N,L)*1.1+.05,0.,1.); }
  gl_FragColor = vec4(col*vec3(.95,.97,1.), a);
}`;

const ATMO_VERT = /* glsl */ `
varying vec3 vWorld; varying vec3 vNormalW; varying vec3 vCenter;
void main(){ vec4 w = modelMatrix*vec4(position,1.); vWorld=w.xyz; vNormalW=normalize(mat3(modelMatrix)*normal); vCenter=(modelMatrix*vec4(0,0,0,1)).xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;

const ATMO_FRAG = /* glsl */ `
${LIGHT_GLSL}
uniform vec3 uColor; uniform float uDensity, uPower;
varying vec3 vWorld; varying vec3 vNormalW; varying vec3 vCenter;
void main(){
  vec3 N = normalize(vNormalW); vec3 V = normalize(cameraPosition - vWorld);
  float fres = 1. - abs(dot(N,V));
  float rim = pow(fres, uPower);
  vec3 col = vec3(0.);
  for(int i=0;i<2;i++){ if(i>=uStarCount) break;
    vec3 L = normalize(uStarPos[i]-vCenter);
    float sun = dot(normalize(vWorld-vCenter), L);
    float day = smoothstep(-.35,.4,sun);
    float sunset = smoothstep(-.3,0.,sun)*smoothstep(.35,0.,sun);
    float fwd = pow(max(dot(-V,L),0.),8.)*.6;
    col += uStarCol[i]*(mix(uColor, vec3(1.,.45,.15), sunset*.55)*day + fwd*uColor);
  }
  float a = clamp(rim*uDensity,0.,1.);
  gl_FragColor = vec4(col*a, 1.);
}`;

const STAR_VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vNV; varying vec3 vVP;
void main(){ vObj=position; vec4 mv=modelViewMatrix*vec4(position,1.); vVP=mv.xyz; vNV=normalize(normalMatrix*normal); gl_Position=projectionMatrix*mv; }`;

const STAR_FRAG = /* glsl */ `
#ifndef OCT
#define OCT 5
#endif
${NOISE}
${BLACKBODY}
uniform float uTemp, uIntensity, uTime2, uSeed;
varying vec3 vObj; varying vec3 vNV; varying vec3 vVP;
void main(){
  vec3 p = normalize(vObj) + vec3(uSeed);
  float t = uTime2*.04;
  float gran = fbm(p*22. + vec3(t,-t,t*.7));
  float cells = 1.-abs(snoise(p*60.+vec3(t*2.)));
  float big = fbmN(p*4.+vec3(t*.3),3);
  float spots = smoothstep(.5,.62, fbmN(p*3.2-vec3(t*.1),4)) * smoothstep(.75,.2,abs(normalize(vObj).y));
  float mu = clamp(dot(normalize(vNV), normalize(-vVP)),0.,1.);
  float limb = .35 + .65*pow(mu,.55);
  vec3 hot = blackbody(uTemp*1.05), cool = blackbody(uTemp*.68);
  vec3 col = mix(cool, hot, limb) * (.82 + .22*gran + .12*cells + .1*big);
  col *= 1. - .75*spots;
  col = mix(col, blackbody(uTemp*1.4)*1.4, smoothstep(.55,.8,big)*.25);
  gl_FragColor = vec4(col*uIntensity*limb, 1.);
}`;

const CORONA_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`;

const CORONA_FRAG = /* glsl */ `
${NOISE}
uniform vec3 uColor; uniform float uRatio, uTime2, uIntensity, uSeed;
varying vec2 vUv;
void main(){
  vec2 c = vUv*2.-1.; float r = length(c);
  if(r>1.) discard;
  float d = max(r-uRatio,0.)/(1.-uRatio);
  float ang = atan(c.y,c.x);
  float rays = snoise(vec3(cos(ang)*2.5, sin(ang)*2.5, uTime2*.05+uSeed))*.5+.5;
  rays = pow(rays,2.)*1.4 + snoise(vec3(cos(ang)*9., sin(ang)*9., d*3.-uTime2*.08))*.2;
  float glow = exp(-d*12.)*1.1 + exp(-d*4.5)*.32*(.6+rays) + exp(-d*2.)*.05;
  glow *= 1.-smoothstep(.85,1.,r);
  gl_FragColor = vec4(uColor*glow*uIntensity, 1.);
}`;

const RING_VERT = /* glsl */ `
varying vec2 vLocal; varying vec3 vWorld;
void main(){ vLocal = position.xy; vec4 w = modelMatrix*vec4(position,1.); vWorld=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;

const RING_FRAG = /* glsl */ `
${NOISE}
${RING}
${LIGHT_GLSL}
uniform float uIn, uOut, uPR; uniform vec3 uPC; uniform vec3 uColA, uColB; uniform vec3 uRN;
varying vec2 vLocal; varying vec3 vWorld;
void main(){
  float r = length(vLocal);
  float t = (r-uIn)/(uOut-uIn);
  float dens = ringDensity(t);
  dens *= .82 + .3*snoise(vec3(t*90.,0.,0.));
  if(dens<.01) discard;
  vec3 col = mix(uColA, uColB, .5+.5*sin(t*44.+snoise(vec3(t*20.,1.,1.))*2.));
  vec3 V = normalize(cameraPosition-vWorld);
  vec3 outc = vec3(0.);
  for(int i=0;i<2;i++){ if(i>=uStarCount) break;
    vec3 L = normalize(uStarPos[i]-vWorld);
    vec3 oc = vWorld-uPC; float b = dot(oc,L); float cc = dot(oc,oc)-uPR*uPR; float disc = b*b-cc;
    float shadow = (disc>0. && -b-sqrt(disc)>0.) ? .04 : 1.;
    float lit = abs(dot(uRN,L))*.65+.35;
    float back = (sign(dot(uRN,L))!=sign(dot(uRN,V))) ? .55 + pow(max(dot(-V,L),0.),6.)*.8 : 1.;
    outc += uStarCol[i]*col*lit*shadow*back;
  }
  gl_FragColor = vec4(outc, dens*.92);
}`;

function planetMaterial(style, opts, quality) {
  const uniforms = {
    ...LIGHTS,
    uColA: { value: new THREE.Color(opts.colA ?? 0x888888) },
    uColB: { value: new THREE.Color(opts.colB ?? 0x555555) },
    uColC: { value: new THREE.Color(opts.colC ?? 0x333333) },
    uSeed: { value: opts.seed ?? Math.random() * 10 },
    uRadius: { value: 1 },
    uBump: { value: 1 },
    uTime2: LIGHTS.uTime,
    uSpot: { value: opts.spot ?? 0 },
    uBands: { value: opts.bands ?? 12 },
    uRingN: { value: new THREE.Vector3(0, 1, 0) },
    uRingC: { value: new THREE.Vector3() },
    uRingIn: { value: 1.24 }, uRingOut: { value: 2.27 },
  };
  const defines = { STYLE: STYLE[style] ?? 0, OCT: quality.oct };
  if (opts.rings) defines.HAS_RINGS = 1;
  let frag = PLANET_FRAG;
  if (opts.rings) frag = frag.replace('uniform vec3 uRingN;', 'uniform vec3 uRingN; uniform vec3 uRingC;');
  return new THREE.ShaderMaterial({ vertexShader: PLANET_VERT, fragmentShader: frag, uniforms, defines });
}

const geoCache = new Map();
function sphereGeo(seg) {
  if (!geoCache.has(seg)) geoCache.set(seg, new THREE.SphereGeometry(1, seg, Math.round(seg * 0.66)));
  return geoCache.get(seg);
}
const quadGeo = new THREE.PlaneGeometry(2, 2);

// ───────── 항성 ─────────
export class StarVisual {
  constructor(body, app) {
    this.body = body;
    this.object = new THREE.Group();
    const q = app.quality;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      uniforms: { uTemp: { value: body.temp }, uIntensity: { value: body.glow ?? 2.3 }, uTime2: LIGHTS.uTime, uSeed: { value: Math.random() * 20 } },
      defines: { OCT: q.oct },
    });
    this.mesh = new THREE.Mesh(sphereGeo(q.seg), this.mat);
    this.object.add(this.mesh);
    const col = blackbody(body.temp);
    this.coronaRatio = 1 / 4.2;
    this.coronaMat = new THREE.ShaderMaterial({
      vertexShader: CORONA_VERT, fragmentShader: CORONA_FRAG,
      uniforms: { uColor: { value: col.clone().multiplyScalar(1) }, uRatio: { value: this.coronaRatio }, uTime2: LIGHTS.uTime, uIntensity: { value: body.coronaI ?? 1.3 }, uSeed: { value: Math.random() * 10 } },
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.corona = new THREE.Mesh(quadGeo, this.coronaMat);
    this.corona.frustumCulled = false;
    this.object.add(this.corona);
    this.setRadius(body.visR);
  }
  setRadius(r) {
    this.r = r;
    this.mesh.scale.setScalar(r);
    this.corona.scale.setScalar(r / this.coronaRatio);
  }
  setTemp(T) { this.mat.uniforms.uTemp.value = T; blackbody(T, this.coronaMat.uniforms.uColor.value); }
  update(camera) {
    this.corona.quaternion.copy(camera.quaternion);
    this.mesh.rotation.y = this.body.spin;
  }
  dispose() { this.mat.dispose(); this.coronaMat.dispose(); }
}

// ───────── 행성/위성 ─────────
export class PlanetVisual {
  constructor(body, app) {
    this.body = body;
    const q = app.quality;
    const o = body.look || {};
    this.object = new THREE.Group();
    this.tilt = new THREE.Group();
    this.tilt.rotation.z = (body.tilt || 0) * Math.PI / 180;
    this.object.add(this.tilt);
    const seg = body.small ? Math.max(16, q.seg >> 2) : q.seg;
    this.mat = planetMaterial(body.style || 'rocky', o, q);
    this.mesh = new THREE.Mesh(sphereGeo(seg), this.mat);
    this.tilt.add(this.mesh);
    this.extras = [];

    if (o.clouds) {
      const m = new THREE.ShaderMaterial({
        vertexShader: PLANET_VERT, fragmentShader: CLOUD_FRAG,
        uniforms: { ...LIGHTS, uTime2: LIGHTS.uTime, uSeed: { value: Math.random() * 10 } },
        transparent: true, depthWrite: false, defines: { OCT: Math.min(q.oct, 5) },
      });
      this.clouds = new THREE.Mesh(sphereGeo(seg), m);
      this.clouds.scale.setScalar(1.012);
      this.tilt.add(this.clouds);
      this.extras.push(m);
    }
    if (o.atmo) {
      const m = new THREE.ShaderMaterial({
        vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
        uniforms: { ...LIGHTS, uColor: { value: new THREE.Color(o.atmo) }, uDensity: { value: o.atmoDensity ?? 1.4 }, uPower: { value: o.atmoPower ?? 3.5 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      this.atmo = new THREE.Mesh(sphereGeo(seg), m);
      this.atmo.scale.setScalar(o.atmoScale ?? 1.035);
      this.object.add(this.atmo);
      this.extras.push(m);
    }
    if (o.rings) {
      const inner = 1.24, outer = 2.27;
      const geo = new THREE.RingGeometry(inner, outer, q.seg * 2, 1);
      const m = new THREE.ShaderMaterial({
        vertexShader: RING_VERT, fragmentShader: RING_FRAG,
        uniforms: { ...LIGHTS, uIn: { value: inner }, uOut: { value: outer }, uPR: { value: 1 }, uPC: { value: new THREE.Vector3() }, uRN: { value: new THREE.Vector3(0, 1, 0) }, uColA: { value: new THREE.Color(0xd8c6a4) }, uColB: { value: new THREE.Color(0x9c8a70) } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      this.rings = new THREE.Mesh(geo, m);
      this.rings.rotation.x = -Math.PI / 2;
      this.tilt.add(this.rings);
      this.extras.push(m, geo);
      this.mat.uniforms.uRingIn.value = inner;
      this.mat.uniforms.uRingOut.value = outer;
    }
    this.setRadius(body.visR);
  }
  setRadius(r) {
    this.r = r;
    this.object.scale.setScalar(r);
    this.mat.uniforms.uRadius.value = r;
    this.mat.uniforms.uBump.value = r > 2e-3 ? 1 : 0;
  }
  update() {
    this.mesh.rotation.y = this.body.spin;
    if (this.clouds) this.clouds.rotation.y = this.body.spin * 1.04;
    if (this.rings) {
      this.object.updateMatrixWorld(true);
      const n = new THREE.Vector3(0, 0, 1).transformDirection(this.rings.matrixWorld);
      const c = this.object.getWorldPosition(new THREE.Vector3());
      const u = this.rings.material.uniforms;
      u.uRN.value.copy(n); u.uPC.value.copy(c); u.uPR.value = this.r;
      this.mat.uniforms.uRingN.value.copy(n); this.mat.uniforms.uRingC.value.copy(c);
    }
  }
  dispose() { this.mat.dispose(); this.extras.forEach((m) => m.dispose()); }
}

// ───────── 단순 블랙홀 (샌드박스용, 렌즈 없음) ─────────
export class MiniHoleVisual {
  constructor(body) {
    this.body = body;
    this.object = new THREE.Group();
    this.core = new THREE.Mesh(sphereGeo(32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.object.add(this.core);
    this.ringMat = new THREE.ShaderMaterial({
      vertexShader: CORONA_VERT,
      fragmentShader: /* glsl */ `uniform float uTime2; varying vec2 vUv; void main(){ vec2 c=vUv*2.-1.; float r=length(c); float ring=exp(-pow((r-.36)*14.,2.))*2.5 + exp(-pow((r-.4)*4.,2.))*.4; float a=atan(c.y,c.x); ring*= .8+.2*sin(a*3.+uTime2*2.); gl_FragColor=vec4(vec3(1.,.6,.25)*ring,1.); }`,
      uniforms: { uTime2: LIGHTS.uTime }, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.halo = new THREE.Mesh(quadGeo, this.ringMat);
    this.object.add(this.halo);
    this.setRadius(body.visR);
  }
  setRadius(r) { this.r = r; this.core.scale.setScalar(r); this.halo.scale.setScalar(r * 3); }
  update(camera) { this.halo.quaternion.copy(camera.quaternion); }
  dispose() { this.core.material.dispose(); this.ringMat.dispose(); }
}

export function createBodyVisual(body, app) {
  if (body.kind === 'star') return new StarVisual(body, app);
  if (body.kind === 'blackhole') return new MiniHoleVisual(body, app);
  return new PlanetVisual(body, app);
}
