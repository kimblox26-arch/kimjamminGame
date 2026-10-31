// 3D 세계: 하늘, 바다, 빛, 지형 타일(LOD), 작업 대기열, 원점 이동
import * as THREE from 'three';
import { smooth, clamp, lerp, noise } from './geo.js';
import * as B from './builders.js';

export const TILE = 2000;
export const QUALITY = {
  low: { name: '최적화', seg0: 48, r0: 1, r1: 2, r2: 4, trees: 0.25, bld: 0.55, shadow: 0, bloom: false, pr: 0.75, msaa: 0, far: 60000 },
  mid: { name: '보통', seg0: 80, r0: 1, r1: 3, r2: 6, trees: 0.6, bld: 0.8, shadow: 1024, bloom: false, pr: 1, msaa: 0, far: 90000 },
  high: { name: '높음', seg0: 112, r0: 1, r1: 3, r2: 7, trees: 1, bld: 1, shadow: 2048, bloom: true, pr: 1, msaa: 4, far: 120000 },
  ultra: { name: '최상', seg0: 128, r0: 1, r1: 4, r2: 9, trees: 1.5, bld: 1, shadow: 4096, bloom: true, pr: 1.5, msaa: 4, far: 150000 },
};

const C = h => new THREE.Color(h);

export class World {
  constructor(renderer, terrain, net) {
    this.renderer = renderer; this.terrain = terrain; this.net = net;
    this.scene = new THREE.Scene();
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.origin = new THREE.Vector2(0, 0);
    this.tiles = new Map(); this.jobs = []; this.time = 0; this.hour = 12;
    this.q = QUALITY.high;
    this.uniforms = { uNight: { value: 0 }, uOrigin: { value: new THREE.Vector2() }, uTime: { value: 0 }, uHole: { value: new THREE.Vector3(0, 0, -1) } };
    this.mats = B.makeMaterials(this.uniforms);
    this.makeLights(); this.makeSky(); this.makeWater();
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.lastEnvSun = -9;
    this.stationObjs = new Map();
    this.underground = 0;
  }

  setQuality(q) {
    this.q = q;
    this.sun.castShadow = !!q.shadow;
    if (q.shadow) { this.sun.shadow.mapSize.set(q.shadow, q.shadow); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    this.scene.fog.density = 1.6 / q.far;
    this.skyMat.uniforms.oct.value = q === QUALITY.low ? 3 : 5;
    this.clearTiles();
  }
  clearTiles() {
    for (const t of this.tiles.values()) this.disposeTile(t);
    this.tiles.clear(); this.jobs.length = 0; this.center = null; this.holeW = null; this.pendingRemove = null; this.uniforms.uHole.value.z = -1;
  }

  makeLights() {
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.shadow.camera.left = -170; this.sun.shadow.camera.right = 170; this.sun.shadow.camera.top = 170; this.sun.shadow.camera.bottom = -170;
    this.sun.shadow.camera.near = 10; this.sun.shadow.camera.far = 1600; this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.camera.layers.enable(1);
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd4f0, 0x5a5444, 0.6); this.scene.add(this.hemi);
    this.scene.fog = new THREE.FogExp2(0xbfd2e6, 1.4e-5);
  }

  makeSky() {
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: { sunDir: { value: new THREE.Vector3(0, 1, 0) }, zen: { value: C('#2d6cc8') }, hor: { value: C('#bcd6ee') }, sunCol: { value: C('#fff3dd') }, night: { value: 0 }, time: this.uniforms.uTime, cloud: { value: 0.45 }, oct: { value: 5 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 sunDir, zen, hor, sunCol; uniform float night, time, cloud; uniform int oct; varying vec3 vDir;
        float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+1.),f.x), f.y); }
        float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<6;i++){ if (i >= oct) break; s+=a*vn(p); p=p*2.03+1.7; a*=.5; } return s; }
        void main(){
          vec3 d = normalize(vDir); float y = d.y;
          vec3 col = mix(hor, zen, pow(clamp(y,0.,1.), .55));
          col = mix(col, hor*0.82, smoothstep(0.,-.25,y));
          float sd = max(dot(d, sunDir), 0.);
          col += sunCol * (pow(sd, 900.)*28. + pow(sd, 12.)*.28 + pow(sd,3.)*.08) * (1.-night*.9);
          // 별
          if (night > 0.){ vec2 sp = d.xz/(d.y+.25)*240.; float st = step(.997, h21(floor(sp))); col += vec3(st)*night*smoothstep(0.,.3,y)*.9; }
          // 구름
          if (y > 0.01){
            vec2 uv = d.xz / (y + .08) * 1.6 + vec2(time*.004, time*.0015);
            float c = oct > 3 ? fbm(uv) * .65 + fbm(uv*3.1)*.35 : fbm(uv) * 1.1;
            float cov = smoothstep(.62 - cloud*.3, .95, c) * smoothstep(.0, .2, y);
            vec3 cc = mix(hor*1.05, vec3(1.), .55) * (1. - night*.88) + sunCol * pow(sd, 4.) * .25;
            col = mix(col, cc, cov * .85);
          }
          gl_FragColor = vec4(col, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat); this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    this.sky.scale.setScalar(1000); this.sky.layers.set(1);
    this.scene.add(this.sky);
    this.envScene = new THREE.Scene(); this.envSky = new THREE.Mesh(geo, this.skyMat); this.envSky.scale.setScalar(100); this.envScene.add(this.envSky);
  }

  makeWater() {
    const g = new THREE.PlaneGeometry(1, 1, 1, 1); g.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(g, this.mats.water);
    this.water.scale.set(400000, 1, 400000); this.water.renderOrder = -1; this.water.frustumCulled = false;
    this.water.receiveShadow = true; this.water.layers.set(1);
    this.scene.add(this.water);
  }

  setTime(hour) {
    this.hour = ((hour % 24) + 24) % 24;
    const t = this.hour, el = Math.sin((t - 6.2) / 12 * Math.PI) * 46 * Math.PI / 180;
    const az = (90 + (t - 6) / 12 * 180) * Math.PI / 180;
    const sd = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.sunDir = sd;
    const elDeg = el * 180 / Math.PI;
    const day = smooth(-6, 8, elDeg), night = 1 - smooth(-8, 3, elDeg), dusk = smooth(-6, 1, elDeg) * (1 - smooth(4, 20, elDeg));
    this.night = night;
    const zen = C('#050b1c').lerp(C('#2c68c4'), day), hor = C('#141c33').lerp(C('#c4d9ee'), day).lerp(C('#f2a35e'), dusk * 0.75);
    const sunCol = C('#ff9a55').lerp(C('#fff4e2'), smooth(2, 28, elDeg));
    const u = this.skyMat.uniforms; u.sunDir.value.copy(sd); u.zen.value.copy(zen); u.hor.value.copy(hor); u.sunCol.value.copy(sunCol); u.night.value = night;
    this.scene.fog.color.copy(hor).lerp(zen, 0.15);
    // 해와 달
    const moon = night > 0.5;
    this.sun.color.copy(moon ? C('#9fb4e0') : sunCol);
    this.sun.intensity = moon ? 0.35 : 3.2 * smooth(-3, 10, elDeg);
    this.lightDir = moon ? new THREE.Vector3(-sd.x, -sd.y, -sd.z) : sd.clone();
    if (this.lightDir.y < 0.15) this.lightDir.y = 0.15;
    this.lightDir.normalize();
    this.hemi.color.copy(C('#1a2440').lerp(C('#c2d6f2'), day)); this.hemi.groundColor.copy(C('#0b0c10').lerp(C('#5c5444'), day));
    this.hemi.intensity = 0.25 + day * 0.35;
    this.uniforms.uNight.value = night;
    this.renderer.toneMappingExposure = 0.78 + night * 0.55;
    // 환경맵은 해가 많이 움직였을 때만 다시 만든다
    if (Math.abs(elDeg - this.lastEnvSun) > 1.5) {
      this.lastEnvSun = elDeg;
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
      this.envRT?.dispose(); this.envRT = rt; this.scene.environment = rt.texture;
    }
    this.scene.environmentIntensity = 0.25 + day * 0.75;
  }

  // 원점 기준 좌표
  local(x, y, z, out = new THREE.Vector3()) { return out.set(x - this.origin.x, y, z - this.origin.y); }

  update(dt, fx, fy, fz, camera, budget = 6) {
    this.time += dt; this.uniforms.uTime.value = this.time;
    // 원점 이동 (500 m 단위)
    const ox = Math.round(fx / 500) * 500, oz = Math.round(fz / 500) * 500;
    if (ox !== this.origin.x || oz !== this.origin.y) { this.origin.set(ox, oz); this.root.position.set(-ox, 0, -oz); this.uniforms.uOrigin.value.set(ox % 20000, oz % 20000); }
    if (this.holeW) this.uniforms.uHole.value.set(this.holeW[0] - ox, this.holeW[1] - oz, this.holeW[2]);
    this.sky.position.copy(camera.position); this.water.position.set(camera.position.x, 0, camera.position.z);
    this.mats.water.normalMap.offset.set((this.time * 0.004 + (camera.position.x + ox) / 90) % 1, (this.time * 0.003 - (camera.position.z + oz) / 90) % 1);
    // 그림자 카메라를 초점 근처로
    const L = this.lightDir || new THREE.Vector3(0, 1, 0);
    const lx = fx - ox, lz = fz - oz;
    this.sun.target.position.set(lx, fy, lz); this.sun.position.set(lx + L.x * 700, fy + L.y * 700, lz + L.z * 700);
    // 타일 관리
    const ctx = Math.floor(fx / TILE), ctz = Math.floor(fz / TILE), key = ctx + ',' + ctz;
    if (key !== this.center) { this.center = key; this.plan(ctx, ctz); }
    this.runJobs(budget);
    if (!this.jobs.length && this.pendingRemove) {
      for (const t of this.pendingRemove) { this.disposeTile(t); }
      this.pendingRemove = null;
    }
    this.updateStations(fx, fz);
  }

  plan(ctx, ctz) {
    const q = this.q, want = new Map();
    this.planC = [ctx, ctz];
    // 원경 지형은 가장 바깥 고리만 겹치게 남기고 안쪽은 지운다 (타일이 늦게 생겨도 빈틈이 없다)
    this.holeW = [(ctx + 0.5) * TILE, (ctz + 0.5) * TILE, (q.r2 - 0.5) * TILE];
    for (let a = -q.r2; a <= q.r2; a++) for (let b = -q.r2; b <= q.r2; b++) {
      const d = Math.max(Math.abs(a), Math.abs(b)), lod = d <= q.r0 ? 0 : d <= q.r1 ? 1 : 2;
      want.set((ctx + a) + ',' + (ctz + b), { tx: ctx + a, tz: ctz + b, lod, d });
    }
    // 대기 중 작업 정리
    this.jobs = this.jobs.filter(j => { const w = want.get(j.key); return w && w.lod === j.lod; });
    for (const [k, w] of want) {
      const t = this.tiles.get(k);
      if (t && t.lod === w.lod) continue;
      if (this.jobs.some(j => j.key === k)) continue;
      this.jobs.push({ key: k, lod: w.lod, d: w.d, gen: this.buildTile(w.tx, w.tz, w.lod) });
    }
    this.jobs.sort((a, b) => a.d - b.d || a.lod - b.lod);
    const rm = [];
    for (const [k, t] of this.tiles) if (!want.has(k)) { rm.push(t); this.tiles.delete(k); }
    this.pendingRemove = (this.pendingRemove || []).concat(rm);
  }

  runJobs(budget) {
    const t0 = performance.now();
    while (this.jobs.length && performance.now() - t0 < budget) {
      const j = this.jobs[0], r = j.gen.next();
      if (r.done) {
        this.jobs.shift();
        const old = this.tiles.get(j.key); if (old) this.disposeTile(old);
        this.tiles.set(j.key, r.value); this.root.add(r.value.group);
      }
    }
  }
  get loading() { return this.jobs.length; }

  *buildTile(tx, tz, lod) {
    const group = new THREE.Group(); group.position.set(tx * TILE, 0, tz * TILE);
    const tile = { tx, tz, lod, group, stations: [] };
    const seg = lod === 0 ? this.q.seg0 : lod === 1 ? 32 : 12;
    // 레이어 1 = 지상 물체 (지하에 있을 때는 그리지 않는다)
    const surf = o => o.traverse(m => m.layers.set(1));
    const terr = yield* B.terrainTile(this, tx, tz, seg, lod);
    surf(terr); group.add(terr);
    if (lod <= 1 || this.q.r2 > 0) { const b = yield* B.buildings(this, tx, tz, lod); if (b) { surf(b); group.add(b); } }
    if (lod === 0) {
      const tr = yield* B.trees(this, tx, tz); if (tr) { surf(tr); group.add(tr); }
      const tk = yield* B.tracks(this, tx, tz); if (tk) group.add(tk);
      const st = yield* B.stations(this, tx, tz, tile); if (st) group.add(st);
    } else if (lod === 1) {
      const tk = yield* B.tracks(this, tx, tz, true); if (tk) group.add(tk);
    }
    group.traverse(o => { if (o.isMesh) { o.receiveShadow = lod === 0; o.castShadow = lod === 0 && o.userData.cast !== false; } });
    return tile;
  }

  disposeTile(t) {
    this.root.remove(t.group);
    t.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.userData.ownMat) o.material.dispose(); });
    for (const s of t.stations) this.stationObjs.delete(s.id);
  }

  // 멀리 보이는 전국 지형 (낮은 해상도)
  *buildFar() {
    const T = this.terrain, step = 1500;
    const nx = Math.ceil(T.size[0] / step), nz = Math.ceil(T.size[1] / step);
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3), col = new Float32Array(pos.length), cov = new Float32Array(pos.length);
    const hs = new Float32Array((nx + 1) * (nz + 1));
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = T.x0 + i * step, z = T.z0 + j * step, k = j * (nx + 1) + i;
        hs[k] = T.natural(x, z);
      }
      if (j % 20 === 0) yield;
    }
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i, x = T.x0 + i * step, z = T.z0 + j * step, h = hs[k];
      const hx = hs[k + (i < nx ? 1 : 0)] - hs[k - (i > 0 ? 1 : 0)], hz = hs[k + (j < nz ? nx + 1 : 0)] - hs[k - (j > 0 ? nx + 1 : 0)];
      const ny = 2 * step / Math.hypot(hx, 2 * step, hz);
      pos.set([x, Math.max(h, -60) - 4, z], k * 3);
      B.groundColor(T, x, z, h, ny, col, cov, k * 3);
    }
    const idx = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('cover', new THREE.BufferAttribute(cov, 3));
    g.setIndex(idx); g.computeVertexNormals();
    this.far = new THREE.Mesh(g, this.mats.terrainFar); this.far.frustumCulled = false; this.far.layers.set(1); this.root.add(this.far);
  }

  // 정차 중인 역의 스크린도어 등 갱신
  updateStations() {}

  stationAt(lineId, k) { return this.stationObjs.get(lineId + ':' + k); }
}
