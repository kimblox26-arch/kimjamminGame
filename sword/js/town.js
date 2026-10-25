// SKY BLADE — 실제 서울 도로망 위의 사람·자동차·버스·택시·지하철
//  - 자동차: Overture 도로 그래프 (커넥터 = 노드) 를 따라 우측 통행, 차로 유지, 앞차와 간격, 실제 신호등 위치에서 신호 대기
//  - 사람: 보도·보행로를 따라 걷고, 저마다 목적(출근·점심·산책…)과 성격이 있음
//      감정 (기쁨·두려움·화남·놀람·슬픔) 이 주변 사건 (플레이어가 날거나 칼을 뽑음, 폭발, 건물 붕괴, 핵) 에 반응해 바뀌고
//      감정에 따라 행동 (구경·사진 찍기·도망·주먹 흔들기·주저앉기) 과 얼굴 표정, 머릿속 생각 (말풍선) 이 달라짐
//  - 지하철·기차: 철도 그래프를 달리고 지하 구간에선 땅속으로 (보이지 않음), 지상·고가·다리에선 보임
import * as THREE from 'three';
import { origin } from './frame.js';
import { personGeo, sedanGeo, suvGeo, taxiGeo, busGeo, railCarGeo, vehicleMat } from './models.js';

const G = 9.81;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
const _e = new THREE.Euler(), Y = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3();
// 분류별 제한 속도 (m/s): 고속 90, 도시고속 80, 간선 60, 보조 50, 집산 40, 주거 30 km/h …
const VMAX = [25, 22, 16, 14, 11, 8, 5, 8, 5];
const SIDE = [0, 3.0, 3.5, 3.0, 2.5, 1.2, 0, 0.8, 0, 0, 0, 0, 0, 0, 0];

// ───────── 사람: 몸 + 얼굴 (표정은 셰이더), 모형은 models.js ─────────
const P_COMMON = /* glsl */`
attribute float aPart;
attribute vec4 iAnim;     // 걸음 위상, 팔다리 흔들림, 팔 (0 보통, 1 만세·도망, 2 사진, 3 주먹), 시드
attribute vec3 iShirt;
attribute vec3 iPants;
attribute vec4 iMood;     // 기쁨, 두려움, 화남, 놀람
varying vec3 vPC;
varying vec3 vObj;
varying vec3 vObjN;
varying float vPart;
varying vec4 vMood;
float limbAng(out float piv) {
  float ph = iAnim.x, amp = iAnim.y, arm = iAnim.z;
  piv = 0.0;
  bool L = aPart > 1.5 && aPart < 2.5 || aPart > 6.5 && aPart < 7.5;
  bool R = aPart > 2.5 && aPart < 3.5 || aPart > 7.5 && aPart < 8.5;
  bool AL = aPart > 3.5 && aPart < 4.5 || aPart > 8.5 && aPart < 9.5;
  bool AR = aPart > 4.5 && aPart < 5.5 || aPart > 9.5 && aPart < 10.5;
  if (L) { piv = 0.84; return sin(ph) * amp; }
  if (R) { piv = 0.84; return -sin(ph) * amp; }
  if (AL || AR) {
    piv = 1.36;
    float swing = (AL ? -1.0 : 1.0) * sin(ph) * amp * 0.8;
    if (arm < 0.5) return swing;
    if (arm < 1.5) return -2.7 + 0.35 * sin(ph * 2.0 + (AL ? 0.0 : 1.6));               // 만세 (도망)
    if (arm < 2.5) return AR ? -1.45 : swing * 0.3 - 0.4;                                 // 휴대폰으로 사진
    return AR ? -2.2 + 0.5 * sin(ph * 3.0) : swing * 0.3;                                 // 주먹 흔들기
  }
  return 0.0;
}
vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
`;
function personMat() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + P_COMMON)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n{ float pv; objectNormal = rotX(objectNormal, limbAng(pv)); }')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vObj = position; vObjN = normal; vPart = aPart; vMood = iMood;
{ float pv; float a = limbAng(pv); transformed.y -= pv; transformed = rotX(transformed, a); transformed.y += pv; }
// 사람마다: 긴 머리 / 치마 / 가방 있음·없음
bool longHair = fract(iAnim.w * 3.71) < 0.4;
bool skirt = fract(iAnim.w * 9.13) < 0.22;
bool hasBag = fract(iAnim.w * 5.3) < 0.55;
if ((aPart > 11.5 && aPart < 12.5 && !longHair) || (aPart > 12.5 && !skirt) || (aPart > 10.5 && aPart < 11.5 && !hasBag)) transformed = vec3(0.0, 1.0, 0.0);
float sk = fract(iAnim.w * 7.31);
vec3 skin = mix(vec3(0.78, 0.58, 0.45), vec3(0.5, 0.33, 0.22), sk * sk);
vec3 hair = mix(vec3(0.025, 0.02, 0.018), vec3(0.3, 0.18, 0.08), step(0.82, fract(iAnim.w * 13.7)));
vec3 bag = fract(iAnim.w * 5.3) < 0.5 ? vec3(0.05) : iPants * 0.7;
vec3 legs = skirt ? mix(skin, vec3(0.06), 0.45) : iPants;
vPC = aPart < 0.5 ? iShirt : aPart < 1.5 ? skin : aPart < 2.25 ? legs : aPart < 2.75 ? iPants : aPart < 3.5 ? legs : aPart < 5.5 ? iShirt : aPart < 6.5 ? hair : aPart < 8.5 ? vec3(0.04) : aPart < 10.5 ? skin : aPart < 11.5 ? bag : aPart < 12.5 ? hair : iPants;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPC; varying vec3 vObj; varying vec3 vObjN; varying float vPart; varying vec4 vMood;')
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = vPC;
// 얼굴 (머리 앞면): 눈·눈썹·입 — 기쁨은 웃는 입, 두려움·놀람은 벌린 입, 화남은 찌푸린 눈썹
if (vPart > 0.5 && vPart < 1.5 && vObjN.z > 0.55 && vObj.y > 1.47) {
  vec2 f = vec2(vObj.x, vObj.y - 1.56);
  float joy = vMood.x, fear = vMood.y, ang = vMood.z, sur = vMood.w;
  float eyeR = 0.014 + 0.008 * max(fear, sur);
  float eye = step(length(vec2(abs(f.x) - 0.045, f.y - 0.02)), eyeR);
  float browY = 0.05 + 0.012 * sur - 0.006 * ang;
  float brow = step(abs(f.y - browY - (abs(f.x) - 0.045) * (ang * 0.6 - fear * 0.4) * sign(f.x) * sign(f.x)), 0.006) * step(abs(abs(f.x) - 0.045), 0.025);
  float smile = joy - ang * 0.6 - fear * 0.3;
  float mouthY = -0.05 + smile * 0.015 * (1.0 - (f.x * f.x) / 0.0016);
  float open = max(fear, sur) * 0.02;
  float mouth = step(abs(f.x), 0.04) * step(abs(f.y - mouthY), 0.006 + open * (1.0 - f.x * f.x / 0.0016));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.02, 0.02), max(max(eye, brow), mouth));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.1, 0.1), mouth * step(0.008, open) * 0.6);
}`);
  };
  return m;
}

// ───────── 차 (모형은 models.js) ─────────
const CAR_COLORS = [0xf2f2f2, 0xf2f2f2, 0xeeeeee, 0x15161a, 0x15161a, 0x9aa0a6, 0x9aa0a6, 0x7a7f86, 0x2b4a7a, 0x8a1c1c, 0xd8c8a0];
const BUS_COLORS = [0x1f5fb5, 0x1f5fb5, 0x2e9e4a, 0x2e9e4a, 0xd03030, 0xe8b018];
// 노선 색 (서울 수도권 전철)
const LINE_COL = { 1: 0x0052a4, 2: 0x00a84d, 3: 0xef7c1c, 4: 0x00a5de, 5: 0x996cac, 6: 0xcd7c2f, 7: 0x747f00, 8: 0xe6186c, 9: 0xbdb092 };
const _white = new THREE.Color(1, 1, 1);
function lineColor(name, cls) {
  name = name || '';
  const m = name.match(/(\d)\s*호선/);
  let c = m ? LINE_COL[+m[1]] : null;
  if (!c) c = /신분당/.test(name) ? 0xd4003b : /경의|중앙/.test(name) ? 0x77c4a3 : /공항/.test(name) ? 0x0090d2 : /분당|수인/.test(name) ? 0xfabe00 : /경춘/.test(name) ? 0x0c8e72 : /우이|신림/.test(name) ? 0xb0ce18 : cls === 0 ? 0x00a84d : 0x1f5fb5;
  return new THREE.Color(c);
}

// ───────── 생각 (말풍선 문장) ─────────
const GOALS = {
  '출근': ['지각하면 안 되는데…', '오늘 회의 몇 시였지?', '월요병이다…', '커피부터 마셔야겠다'],
  '점심': ['오늘 점심 뭐 먹지?', '김치찌개 먹고 싶다', '국밥 한 그릇 할까', '줄 서는 집 가볼까?'],
  '카페': ['아아 한 잔 해야지', '디저트도 시킬까?', '자리 있으려나'],
  '산책': ['날씨 좋다~', '바람 시원하네', '오늘 만 보 걷기!'],
  '쇼핑': ['세일 한다던데', '이 옷 살까 말까…', '택배 언제 오지'],
  '학교': ['숙제 안 했다…', '시험 망했어', '학원 늦겠다!'],
  '데이트': ['늦으면 혼나는데!', '꽃이라도 살까?', '어디 가지?'],
  '퇴근': ['드디어 퇴근!', '오늘 치킨이다', '집에 가고 싶다'],
  '운동': ['헉헉… 조금만 더!', '오늘은 하체 날', '물 마셔야지'],
  '배달': ['다음 배달 어디지?', '시간 안에 가야 돼'],
};
const GOAL_LIST = Object.keys(GOALS);
const SAY = {
  fly: ['와… 사람이 날아다녀!', '저거 영화 촬영인가?', '슈퍼히어로다!', '사진 찍어야지!', '내가 꿈꾸나…?'],
  sword: ['칼…? 무서워', '저 사람 칼 들었어!', '경찰 불러야 하나?', '조심해!'],
  swordBrave: ['칼 집어넣어요!', '여기서 뭐 하는 거예요!'],
  fast: ['깜짝이야!', '뭐가 지나갔지?', '바람이…!'],
  blast: ['살려줘!', '도망쳐!!', '무슨 일이야?!', '폭탄이야?!', '엄마…!'],
  collapse: ['건물이 무너진다!', '피해!!', '119 불러!'],
  nuke: ['핵…?! 세상이 끝났어', '저 버섯구름 뭐야…', '하늘이 하얘…'],
  calm: ['휴… 이제 괜찮나?', '심장 떨려…', '뉴스에 나오겠다'],
  hit: ['아야!', '으악!', '날아간다~!'],
  car: ['빵빵! 비켜요!', '저거 뭐야?!'],
};
const EMOJI = ['😊', '😱', '😠', '😮', '😢', '💭'];

export class Town {
  constructor(scene, game, opts = {}) {
    this.scene = scene; this.game = game;
    this.roads = game.roads;
    this.time = 0;
    this.events = [];
    this.setEco(!!opts.eco);
    const R = this.roads.roads;
    // 걷는 그래프 (고속·도시고속·터널 제외)
    this.padj = new Map();
    this.nodePos = new Map();
    for (let i = 0; i < R.n; i++) {
      const a = R.start[i], b = R.start[i + 1] - 1;
      if (!this.nodePos.has(R.na[i])) this.nodePos.set(R.na[i], [R.pts[a * 2], R.pts[a * 2 + 1]]);
      if (!this.nodePos.has(R.nb[i])) this.nodePos.set(R.nb[i], [R.pts[b * 2], R.pts[b * 2 + 1]]);
      if (R.cls[i] <= 1 || (R.flags[i] & 2)) continue;
      for (const nd of [R.na[i], R.nb[i]]) { let l = this.padj.get(nd); if (!l) { l = []; this.padj.set(nd, l); } l.push(i); }
    }
    // 신호등이 있는 교차로 노드 (위상 = 신호등 불빛과 같은 식)
    this.sig = new Map();
    const P = this.roads.points;
    if (P) for (let j = 0; j < P.n; j++) {
      if (P.kind[j] !== 1) continue;
      const nr = this.roads.nearestRoad(P.x[j], P.z[j], 30, true);
      if (!nr) continue;
      const i = nr[0];
      const ph = ((P.x[j] * 0.37 + P.z[j] * 0.11) % 60 + 60) % 60;
      for (const nd of [R.na[i], R.nb[i]]) { const q = this.nodePos.get(nd); if (q && Math.hypot(q[0] - P.x[j], q[1] - P.z[j]) < 35 && !this.sig.has(nd)) this.sig.set(nd, ph); }
    }
    // 철도 그래프
    const RL = this.roads.rails;
    this.radj = new Map();
    if (RL) for (let i = 0; i < RL.n; i++) for (const nd of [RL.na[i], RL.nb[i]]) { let l = this.radj.get(nd); if (!l) { l = []; this.radj.set(nd, l); } l.push(i); }
    // 메시
    const NP = 360;
    const pg = personGeo();
    this.pA = { anim: new THREE.InstancedBufferAttribute(new Float32Array(NP * 4), 4), shirt: new THREE.InstancedBufferAttribute(new Float32Array(NP * 3), 3),
      pants: new THREE.InstancedBufferAttribute(new Float32Array(NP * 3), 3), mood: new THREE.InstancedBufferAttribute(new Float32Array(NP * 4), 4) };
    for (const k in this.pA) this.pA[k].setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('iAnim', this.pA.anim); pg.setAttribute('iShirt', this.pA.shirt); pg.setAttribute('iPants', this.pA.pants); pg.setAttribute('iMood', this.pA.mood);
    this.pMesh = new THREE.InstancedMesh(pg, personMat(), NP);
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pMesh.castShadow = true; this.pMesh.frustumCulled = false; this.pMesh.count = 0;
    scene.add(this.pMesh);
    const SH = [0xf5f5f5, 0x202020, 0x2d4e8a, 0x8a2d2d, 0x3f6e46, 0xd9c49a, 0x6b6b6b, 0xe6a23a, 0x5a3f7a, 0x9ec7e8, 0x111111, 0x111111, 0x4a4a52];
    const PA = [0x1d2333, 0x2a2a2a, 0x3b4b63, 0x6b5a45, 0xbcb5a5, 0x161616, 0x161616];
    this.people = [];
    for (let i = 0; i < NP; i++) {
      this.people.push({ alive: false, i, shirt: new THREE.Color(pick(SH)).multiplyScalar(rnd(0.8, 1.1)), pants: new THREE.Color(pick(PA)), seed: Math.random(),
        p: 0, d: 0, dir: 1, side: 1, x: 0, y: 0, z: 0, h: 0, v: 1.3, ph: 0, st: 'walk', t: 0, arm: 0,
        mood: [0, 0, 0, 0, 0], brave: Math.random(), cheer: Math.random(), goal: pick(GOAL_LIST), thought: '', tt: 0, think: rnd(2, 12), look: 0,
        vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, wx: 0, wz: 0, shock: -1, sense: Math.random() * 0.5 });
    }
    const mkCars = (geo, n, colors) => {
      const m = new THREE.InstancedMesh(geo, this.vMat || (this.vMat = vehicleMat()), n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.castShadow = true; m.frustumCulled = false; m.count = 0;
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      scene.add(m);
      return { mesh: m, colors };
    };
    this.kinds = { car: mkCars(sedanGeo(), 120, CAR_COLORS), suv: mkCars(suvGeo(), 80, CAR_COLORS), taxi: mkCars(taxiGeo(), 40, [0xf08a1e, 0xf2f2f2, 0xe8e8e8]), bus: mkCars(busGeo(), 30, BUS_COLORS) };
    this.cars = [];
    for (let i = 0; i < 200; i++) {
      const r = Math.random(), kind = r < 0.08 ? 'bus' : r < 0.2 ? 'taxi' : r < 0.48 ? 'suv' : 'car';
      this.cars.push({ alive: false, i, kind, col: new THREE.Color(pick(this.kinds[kind].colors)), p: 0, d: 0, dir: 1, lane: 0, x: 0, y: 0, z: 0, h: 0, v: 0, vmax: 10, st: 'drive', t: 0,
        vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, wx: 0, wz: 0, shock: -1, hidden: false });
    }
    // 전동차
    // 칸: 가운데 칸 / 운전실 칸 (띠 색 = 노선 색, 인스턴스 색)
    this.tMesh = {};
    const tMat = vehicleMat(0.7, 0.3);
    for (const [k, cab] of [['mid', false], ['cab', true]]) {
      const m = new THREE.InstancedMesh(railCarGeo(cab), tMat, 160);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.castShadow = true; m.frustumCulled = false; m.count = 0;
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      scene.add(m);
      this.tMesh[k] = m;
    }
    this.trains = [];
    for (let i = 0; i < 16; i++) this.trains.push({ alive: false, p: 0, d: 0, dir: 1, v: 0, n: 8, hist: [], kind: 'sub', player: false, derailed: false, cars: null, steer: 0 });
    // 말풍선 (화면 위 DOM)
    this.bubbles = [];
    const hud = document.getElementById('hud') || document.body;
    for (let i = 0; i < 7; i++) {
      const el = document.createElement('div');
      el.className = 'bubble';
      el.style.display = 'none';
      hud.appendChild(el);
      this.bubbles.push(el);
    }
  }

  setEco(eco, k = 1) { this.eco = eco; this.R = eco ? 260 : 420; this.maxP = Math.round((eco ? 120 : 340) * k); this.maxC = Math.round((eco ? 60 : 190) * k); this.maxT = Math.max(3, Math.round((eco ? 8 : 16) * k)); }

  _h(x, z) { return this.game.heightAt(x, z); }

  // 조각 위 거리 d 의 위치 → o.x, o.z, o.y, 진행 방향 (tx, tz)
  _at(L, i, d, o, rail) {
    const a = L.start[i], b = L.start[i + 1];
    let s = 0, k = a;
    for (; k < b - 2; k++) {
      const l = Math.hypot(L.pts[k * 2 + 2] - L.pts[k * 2], L.pts[k * 2 + 3] - L.pts[k * 2 + 1]);
      if (s + l >= d) break;
      s += l;
    }
    const x0 = L.pts[k * 2], z0 = L.pts[k * 2 + 1], x1 = L.pts[k * 2 + 2], z1 = L.pts[k * 2 + 3];
    const l = Math.hypot(x1 - x0, z1 - z0) || 1, u = clamp((d - s) / l, 0, 1);
    o.x = x0 + (x1 - x0) * u; o.z = z0 + (z1 - z0) * u;
    o.tx = (x1 - x0) / l; o.tz = (z1 - z0) / l;
    const H = this.roads.deck.get((rail ? 1e7 : 0) + i);
    o.deckY = H ? H[k - a] + (H[k + 1 - a] - H[k - a]) * u : null;
    o.tunnel = (L.flags[i] & 2) !== 0 && !(H && !rail);       // 도로 터널은 단면이 있어 보임 (철도 지하 구간만 숨김)
    return o;
  }

  // 노드에서 다음 조각 고르기 (prev 로는 되도록 안 돌아감)
  _next(adj, L, node, prev, pref) {
    const list = adj.get(node);
    if (!list || !list.length) return -1;
    let best = -1, bw = -1;
    for (const j of list) {
      if (j === prev && list.length > 1) continue;
      let w = Math.random() + (pref ? pref(j) : 0);
      if (w > bw) { bw = w; best = j; }
    }
    return best;
  }

  // ───────── 사건 ─────────
  event(type, x, z, R, s = 1) { this.events.push({ type, x, z, R, s, t: this.time }); if (this.events.length > 24) this.events.shift(); }
  blast(x, y, z, R, power = 20) {
    this.event(power > 30 ? 'blast' : 'collapse', x, z, R * 4, 1);
    for (const o of this.people) if (o.alive) {
      const d = Math.hypot(o.x - x, o.y - y, o.z - z);
      if (d < R) this._fling(o, x, z, power * (1 - d / R) + 4);
      if (d < R * 0.35 && power >= 20) o.dead = true;
    }
    for (const o of this.cars) if (o.alive && !o.hidden) {
      const d = Math.hypot(o.x - x, o.y - y, o.z - z);
      if (d < R * 0.8) { this._fling(o, x, z, power * 0.6 * (1 - d / R) + 2); if (power >= 20 && d < R * 0.4) this._wreck(o, true); }
      else if (d < R * 3 && o.st === 'drive') { o.st = 'stop'; o.t = 0; }
    }
  }
  panic(x, z, R) { this.event('collapse', x, z, R, 0.7); }
  // 해일 물벽에 휩쓸림
  sweep(F, dt) {
    for (const list of [this.people, this.cars]) for (const o of list) {
      if (!o.alive || o.hidden) continue;
      const c = F.crestAt(o.x, o.z);
      if (!c || o.y > c[2]) continue;
      if (o.st !== 'fly') { this.event('collapse', o.x, o.z, 300, 1); this._fling(o, o.x - c[0], o.z - c[1], c[3] * (list === this.cars ? 0.6 : 0.9)); o.vy = Math.min(o.vy, 3); }
      else { o.vx += c[0] * c[3] * dt * 1.5; o.vz += c[1] * c[3] * dt * 1.5; }
    }
  }
  shock(id, x, gy, z, front, vap, R5, Rmax) {
    if (!this._nukeEv || this._nukeEv !== id) { this._nukeEv = id; this.event('nuke', x, z, 40000, 1); }
    const hit = (o, car) => {
      if (!o.alive || o.shock === id) return;
      const d = Math.hypot(o.x - x, o.z - z);
      if (d > front || d > Rmax) return;
      o.shock = id;
      if (d < vap) { o.alive = false; return; }
      this._fling(o, x, z, clamp(Math.pow(R5 / Math.max(d, 30), 1.4) * (car ? 35 : 45), 3, 250));
      if (car && d < R5 * 2) this._wreck(o, false);
    };
    for (const o of this.people) hit(o, false);
    for (const o of this.cars) if (!o.hidden) hit(o, true);
  }
  _fling(o, x, z, v) {
    const dx = o.x - x, dz = o.z - z, l = Math.hypot(dx, dz) || 1;
    if (o.mood && v > 24) o.dead = true;                // 사람: 세게 날아가면 죽음
    o.vx = dx / l * v; o.vz = dz / l * v; o.vy = v * rnd(0.25, 0.6) + 1;
    o.wx = rnd(-8, 8); o.wz = rnd(-8, 8);
    if (o.st !== 'fly') { o.rx = 0; o.rz = 0; }
    o.st = 'fly'; o.t = 0;
    if (o.mood) { if (o.dead) this._die(o); else { o.mood[1] = 1; this._say(o, pick(SAY.hit), 3); if (Math.random() < 0.6) this._sfx('scream', o, 0.8); } }
  }
  // 죽음: 그 자리에 쓰러져 다시 일어나지 않음, 주변 사람들은 겁에 질려 달아남
  _die(o) {
    if (!o.dead || o.tt > 0) this._sfx('scream', o, 1);
    o.dead = true; o.tt = 0; o.thought = '';
    o.mood[0] = 0; o.mood[1] = 0; o.mood[2] = 0; o.mood[3] = 0; o.mood[4] = 0;
    this.event('blast', o.x, o.z, 90, 1);
  }
  // 차량 파괴: 불타는 잔해 (폭발 + 연기), 다시 움직이지 않음
  _wreck(o, boom) {
    if (o.broken) return;
    o.broken = true; o.burn = boom ? 40 : 15;
    this._sfx('crash', o, 1); if (boom) this._sfx('boom', o, 1.2);
    o.col = o.col.clone().multiplyScalar(0.18);
    if (o.st !== 'fly') { o.st = 'wreck'; o.t = 0; }
    const fx = this.game.fx;
    if (boom && fx) {
      _p.set(o.x - origin.x, o.y + 1 - origin.y, o.z - origin.z);
      if (fx.energyBurst) fx.energyBurst(_p, o.kind === 'bus' ? 6 : 4, 2.4, 1.2, 0.4, true);
      if (fx.sparks) fx.sparks(_p, _v.set(0, 1, 0), 30, 1.2, 25, 2.4, 1.4, 0.5, 0.08);
      this.game.audio && this.game.audio.play('clang', 1);
    }
    this.event('blast', o.x, o.z, 150, 1);
  }
  // 칼·검기·빔이 지나간 선분 (a→b, 반지름 r) 안의 사람은 죽고 차는 부서짐
  hit(ax, ay, az, bx, by, bz, r, power = 1) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz || 1;
    const near = (o, h) => {
      const t = clamp(((o.x - ax) * dx + (o.y + h - ay) * dy + (o.z - az) * dz) / L2, 0, 1);
      return Math.hypot(ax + dx * t - o.x, ay + dy * t - o.y - h, az + dz * t - o.z) < r;
    };
    const l = Math.sqrt(L2), ux = dx / l, uz = dz / l;
    let n = 0;
    for (const o of this.people) if (o.alive && !o.dead && near(o, 0.9)) {
      o.dead = true; n++;
      o.vx = ux * 6 * power; o.vz = uz * 6 * power; o.vy = 2; o.wx = rnd(-6, 6); o.wz = rnd(-6, 6); o.st = 'fly'; o.t = 0;
      this._die(o);
    }
    for (const o of this.cars) if (o.alive && !o.hidden && !o.broken && near(o, 0.8)) {
      this._fling(o, o.x - ux, o.z - uz, 8 * power); this._wreck(o, true); n++;
    }
    return n;
  }
  _say(o, text, dur = 4) { o.thought = text; o.tt = dur; }
  // 소리 사건 (cityaudio.js)
  _sfx(type, o, k = 1) { const A = this.game.audio; if (A && A.city && this.cam) A.city.event(type, o.x, o.y + 1, o.z, this.cam, k); }

  _physics(o, dt) {
    const gy = this._h(o.x, o.z);
    o.vy -= G * dt;
    const dr = Math.exp(-0.08 * dt * Math.hypot(o.vx, o.vy, o.vz));
    o.vx *= dr; o.vy *= dr; o.vz *= dr;
    const nx = o.x + o.vx * dt, nz = o.z + o.vz * dt;
    // 건물 벽: 안으로 못 들어감 (튕겨 나옴, 벽에 부딪히면 크게 감속)
    const C = this.game.city, roof = C && C.roofAt ? C.roofAt(nx, nz) : -Infinity;
    if (roof > o.y + 0.6 && roof > this._h(nx, nz) + 1) {
      const sp = Math.hypot(o.vx, o.vz);
      if (Math.abs(this.game.city.roofAt(nx, o.z) - roof) < 1e-3) o.vx = -o.vx * 0.25; else o.vz = -o.vz * 0.25;
      if (Math.abs(o.vx) * 4 > sp && Math.abs(o.vz) * 4 > sp) { o.vx *= -0.25; o.vz *= -0.25; }
      o.wx *= 0.5; o.wz *= 0.5;
      if (o.mood && sp > 18) o.dead = true;
      if (!o.mood && sp > 15 && !o.broken) this._wreck(o, false);
    } else { o.x = nx; o.z = nz; }
    o.y += o.vy * dt;
    o.rx += o.wx * dt; o.rz += o.wz * dt;
    if (o.y <= gy) {
      o.y = gy;
      if (o.vy < -3) { o.vy *= -0.25; o.vx *= 0.5; o.vz *= 0.5; o.wx *= 0.5; o.wz *= 0.5; }
      else { o.vy = 0; o.vx *= Math.exp(-6 * dt); o.vz *= Math.exp(-6 * dt); o.wx *= Math.exp(-8 * dt); o.wz *= Math.exp(-8 * dt); }
      return Math.hypot(o.vx, o.vz) < 0.4 && Math.abs(o.vy) < 0.5;
    }
    return false;
  }

  // ───────── 매 프레임 ─────────
  update(dt, cam, pa, pv, info, show) {
    this.time += dt;
    this.cam = info.camera;
    const agl = cam.y - this._h(cam.x, cam.z);
    const near = show && agl < 2500;
    this.pMesh.visible = near;
    for (const k in this.kinds) this.kinds[k].mesh.visible = near;
    this.tMesh.mid.visible = this.tMesh.cab.visible = show && agl < 6000;
    if (dt > 0 && show) {
      if (near) { this._stepCars(dt, cam, pa, pv); this._stepPeople(dt, cam, pa, pv, info); }
      this._stepTrains(dt, cam);
    }
    this._render(near, show);
    this._bubbles(info.camera, near);
  }

  // 도로 위 무작위 시작점 (카메라 주변 고리)
  _spawnOn(o, cam, rMin, rMax, car) {
    const L = this.roads.roads;
    for (let tries = 0; tries < 3; tries++) {
      const a = Math.random() * Math.PI * 2, r = rnd(rMin, rMax);
      const x = cam.x + Math.sin(a) * r, z = cam.z + Math.cos(a) * r;
      const nr = this.roads.nearestRoad(x, z, 60, car);
      if (!nr) continue;
      const i = nr[0], c = L.cls[i];
      if (L.flags[i] & 2) continue;
      if (car && c > 8) continue;
      if (!car && c <= 1) continue;
      // 조각 위 거리
      let s = 0;
      for (let k = L.start[i]; k < nr[1]; k++) s += Math.hypot(L.pts[k * 2 + 2] - L.pts[k * 2], L.pts[k * 2 + 3] - L.pts[k * 2 + 1]);
      s += Math.hypot(L.pts[nr[1] * 2 + 2] - L.pts[nr[1] * 2], L.pts[nr[1] * 2 + 3] - L.pts[nr[1] * 2 + 1]) * nr[6];
      o.p = i; o.d = s;
      o.dir = car && c <= 2 ? 1 : Math.random() < 0.5 ? 1 : -1;
      return true;
    }
    return false;
  }

  _stepCars(dt, cam, pa, pv) {
    const L = this.roads.roads, R = this.R * 1.8;
    let spawns = this.eco ? 2 : 4;
    const pSp = pv.length();
    // 공간 해시 (앞차 찾기)
    const hash = new Map();
    for (const o of this.cars) if (o.alive && !o.hidden) { const k = Math.floor(o.x / 25) * 100000 + Math.floor(o.z / 25); let a = hash.get(k); if (!a) { a = []; hash.set(k, a); } a.push(o); }
    for (const o of this.cars) {
      if (o.alive && o.st !== 'player' && Math.hypot(o.x - cam.x, o.z - cam.z) > R * 1.25 && o.st !== 'fly') o.alive = false;
      if (!o.alive) {
        if (o.i >= this.maxC || spawns <= 0) continue;
        spawns--;
        if (!this._spawnOn(o, cam, this.time < 2 ? 15 : R * 0.7, R, true)) continue;
        if (o.kind === 'bus' && L.cls[o.p] > 4) continue;
        o.alive = true; o.st = 'drive'; o.v = 0; o.t = 0; o.rx = o.rz = 0; o.shock = -1;
        if (o.broken) { o.broken = false; o.col = new THREE.Color(pick(this.kinds[o.kind].colors)); }
        const c = L.cls[o.p], hw = L.width[o.p] / 2;
        const lanes = c <= 2 ? Math.max(1, Math.round(hw * 2 / 3.3)) : Math.max(1, Math.floor(hw / 3.2));
        o.lane = Math.floor(Math.random() * lanes);
        this._at(L, o.p, o.d, o); o.y = o.deckY !== null ? o.deckY : this._h(o.x, o.z);
      }
      o.t += dt;
      if (o.st === 'fly') {
        // 날아가는 차가 다른 차에 부딪힘: 운동량을 나눔
        const sp = Math.hypot(o.vx, o.vz);
        if (sp > 4) for (const q of this.cars) {
          if (q === o || !q.alive || q.hidden || q.st === 'fly' || q.st === 'player') continue;
          const dx = q.x - o.x, dz = q.z - o.z;
          if (Math.abs(dx) > 4 || Math.abs(dz) > 4 || Math.abs(q.y - o.y) > 2.5 || dx * dx + dz * dz > 10) continue;
          const v2 = sp * 0.5;
          this._fling(q, o.x, o.z, v2); o.vx *= 0.5; o.vz *= 0.5;
          if (sp > 12) this._wreck(q, sp > 25);
        }
        if (this._physics(o, dt) && o.t > 0.5) { o.st = 'wreck'; o.t = 0; o.rx = Math.round(o.rx / Math.PI) * Math.PI; o.rz = Math.round(o.rz / Math.PI) * Math.PI; }
        continue;
      }
      if (o.st === 'player') continue;
      if (o.broken && o.burn > 0) {
        // 불타는 잔해: 연기
        o.burn -= dt;
        const fx = this.game.fx;
        if (fx && fx.puff && Math.random() < dt * 6 && Math.hypot(o.x - cam.x, o.z - cam.z) < 600)
          fx.puff({ x: o.x - origin.x + rnd(-1, 1), y: o.y + 1.4 - origin.y, z: o.z - origin.z + rnd(-1, 1), vx: rnd(-0.5, 0.5), vy: rnd(2, 4), vz: rnd(-0.5, 0.5), life: rnd(4, 7), s0: 1, s1: 6, a: 0.5, r0: 0.12, g0: 0.11, b0: 0.1, r1: 0.25, g1: 0.24, b1: 0.23, fin: 0.05, drag: 0.3, rotv: rnd(-0.4, 0.4) }, 'smoke');
      }
      if (o.st === 'wreck') continue;
      // 플레이어와 충돌
      if (!o.hidden && Math.hypot(o.x - pa.x, o.y + 0.8 - pa.y, o.z - pa.z) < 3 && pSp > 15) {
        o.vx = pv.x * 0.6; o.vy = Math.max(2, pSp * 0.15); o.vz = pv.z * 0.6; o.wx = rnd(-3, 3); o.wz = rnd(-3, 3); o.st = 'fly'; o.t = 0;
        if (pSp > 35) this._wreck(o, pSp > 60);
        this.game.audio && this.game.audio.play('clang', 0.8);
        continue;
      }
      const c = L.cls[o.p], hw = L.width[o.p] / 2, len = L.len[o.p];
      let want = o.st === 'stop' ? 0 : Math.min(VMAX[c] || 8, o.kind === 'bus' ? 14 : 99);
      if (o.st === 'stop' && o.t > 10) o.st = 'drive';
      // 신호등: 진행 방향 끝 노드에 신호가 있으면 빨강·노랑일 때 정지선 앞에 섬
      const end = o.dir > 0 ? L.nb[o.p] : L.na[o.p];
      const toEnd = o.dir > 0 ? len - o.d : o.d;
      const ph = this.sig.get(end);
      if (ph !== undefined && toEnd < 45) {
        const st = this.roads.signalState(ph, this.time);
        const stopAt = Math.min(hw + 5, 14);
        if (st !== 2 && toEnd > stopAt - 1.5) want = Math.min(want, Math.max(0, (toEnd - stopAt) * 0.9));
      }
      // 앞차
      const fx = Math.sin(o.h), fz = Math.cos(o.h);
      const k0x = Math.floor(o.x / 25), k0z = Math.floor(o.z / 25);
      for (let j = -1; j <= 1; j++) for (let i2 = -1; i2 <= 1; i2++) {
        const a = hash.get((k0x + i2) * 100000 + (k0z + j));
        if (!a) continue;
        for (const q of a) {
          if (q === o) continue;
          const dx = q.x - o.x, dz = q.z - o.z, ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
          if (ahead > 0 && ahead < 20 && side < 1.8 && Math.cos(q.h - o.h) > 0.5) want = Math.min(want, Math.max(0, (ahead - (o.kind === 'bus' || q.kind === 'bus' ? 9 : 6.5)) * 0.8), q.v + 1);
          // 교차로: 옆에서 들어오는 차가 앞을 막으면 양보 (서로 보면 번호가 큰 쪽만 양보 → 교착 없음)
          else if (ahead > 0 && ahead < 9 && side < 2.6 && Math.cos(q.h - o.h) <= 0.5) {
            const qx = o.x - q.x, qz = o.z - q.z, qa = qx * Math.sin(q.h) + qz * Math.cos(q.h), qs = Math.abs(qx * Math.cos(q.h) - qz * Math.sin(q.h));
            if (!(qa > 0 && qa < 9 && qs < 2.6) || o.i > q.i) want = Math.min(want, Math.max(0, (ahead - 5) * 0.6));
          }
        }
      }
      // 플레이어가 길에 서 있으면 멈춤 (빵빵)
      { const dx = pa.x - o.x, dz = pa.z - o.z, ahead = dx * fx + dz * fz;
        if (ahead > 0 && ahead < 14 && Math.abs(dx * fz - dz * fx) < 1.8 && Math.abs(pa.y - o.y) < 3) {
          want = 0; o.blockT = (o.blockT || 0) + dt;
          if (o.blockT > 1.2 && this.time > (o.hornAt || 0)) { o.hornAt = this.time + 3 + Math.random() * 4; this._sfx('horn', o, 1); }
        } else o.blockT = 0; }
      const v0 = o.v;
      o.v += clamp(want - o.v, -6 * dt, 2.2 * dt);
      if (o.kind === 'bus' && v0 > 0.4 && o.v <= 0.4) this._sfx('brake', o, 0.8);
      o.d += o.v * dt * o.dir;
      // 노드 넘어가기
      if (o.d > len || o.d < 0) {
        const over = o.d > len ? o.d - len : -o.d;
        const nxt = this._next(this.roads.adj, L, end, o.p, (j) => (L.cls[j] <= c + 1 ? 0.6 : 0) - (L.cls[j] > 8 ? 9 : 0) - (o.kind === 'bus' && L.cls[j] > 4 ? 5 : 0));
        if (nxt < 0) { o.dir = -o.dir; o.d = clamp(o.d, 0, len); }
        else {
          o.p = nxt;
          const nl = L.len[nxt];
          if (L.na[nxt] === end) { o.dir = 1; o.d = Math.min(over, nl); }
          else { o.dir = -1; o.d = Math.max(0, nl - over); }
          // 일방 간선을 거꾸로 들어가면 되돌림
          if (L.cls[nxt] <= 2 && o.dir < 0) { o.dir = 1; o.d = 0; }
          const nhw = L.width[nxt] / 2, nc = L.cls[nxt];
          const lanes = nc <= 2 ? Math.max(1, Math.round(nhw * 2 / 3.3)) : Math.max(1, Math.floor(nhw / 3.2));
          o.lane = Math.min(o.lane, lanes - 1);
        }
      }
      this._at(L, o.p, o.d, o);
      const tx = o.tx * o.dir, tz = o.tz * o.dir;
      const C2 = L.cls[o.p], HW = L.width[o.p] / 2;
      let off;
      if (C2 <= 2) { const n = Math.max(1, Math.round(HW * 2 / 3.3)), w = HW * 2 / n; off = (o.lane + 0.5) * w - HW; }
      else { const n = Math.max(1, Math.floor(HW / 3.2)), w = HW / n; off = (o.lane + 0.5) * w; if (HW < 3) off = HW * 0.45; }
      // 건물 때문에 좁아진 곳: 차 폭(반 1.1 m)이 차도 안에 들도록
      { const side = (off > 0) === (o.dir > 0) ? 0 : 1, rw = this.roads.edges(o.p, o.d, side)[0];
        const lim = Math.max(0, rw - 1.1); if (Math.abs(off) > lim) off = Math.sign(off) * lim; }
      o.x += -tz * off; o.z += tx * off;
      const ty = o.deckY !== null ? o.deckY : this._h(o.x, o.z);
      o.y += (ty - o.y) * Math.min(1, dt * 8);
      if (o.tunnel) o.y = ty - 30;
      o.hidden = o.tunnel;
      const th = Math.atan2(tx, tz);
      let dh = th - o.h; dh -= Math.round(dh / (Math.PI * 2)) * Math.PI * 2;
      o.h += dh * Math.min(1, dt * 6);
    }
  }

  _stepPeople(dt, cam, pa, pv, info) {
    const L = this.roads.roads, R = this.R;
    let spawns = this.eco ? 3 : 6;
    const pSp = pv.length();
    // 서로 비켜 걷기: 1.5 m 칸 해시 → 0.7 m 안에 다른 사람이 있으면 옆으로 비킴
    const ph = this._ph || (this._ph = new Map());
    ph.clear();
    for (const o of this.people) if (o.alive && o.st === 'walk') { const k = Math.floor(o.x / 1.5) * 100000 + Math.floor(o.z / 1.5); let a = ph.get(k); if (!a) { a = []; ph.set(k, a); } a.push(o); }
    for (const o of this.people) {
      if (!o.alive || o.st !== 'walk') continue;
      o.lo = (o.lo || 0) * Math.exp(-0.4 * dt);
      const kx = Math.floor(o.x / 1.5), kz = Math.floor(o.z / 1.5);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const a = ph.get((kx + i) * 100000 + (kz + j));
        if (a) for (const q of a) {
          if (q === o) continue;
          const d = Math.hypot(q.x - o.x, q.z - o.z);
          if (d < 0.7) o.lo = clamp(o.lo + ((o.lo >= (q.lo || 0)) === (o.i > q.i) ? 1 : -1) * dt * 1.6, -0.8, 0.8);
        }
      }
    }
    for (const o of this.people) {
      if (o.alive && Math.hypot(o.x - cam.x, o.z - cam.z) > R * 1.3 && o.st !== 'fly') o.alive = false;
      if (!o.alive) {
        if (o.i >= this.maxP || spawns <= 0) continue;
        spawns--;
        if (!this._spawnOn(o, cam, this.time < 2 ? 6 : R * 0.65, R, false)) continue;
        o.alive = true; o.dead = false; o.st = 'walk'; o.v = rnd(1.1, 1.6); o.side = Math.random() < 0.5 ? 1 : -1; o.t = 0; o.rx = o.rz = 0; o.shock = -1;
        o.mood = [0.15 + o.cheer * 0.3, 0, 0, 0, (1 - o.cheer) * 0.15]; o.goal = pick(GOAL_LIST); o.tt = 0; o.think = rnd(1, 10); o.arm = 0;
        this._place(o, L);
        o.y = this._h(o.x, o.z);
      }
      o.t += dt;
      // 감정: 성격 기준으로 천천히 돌아옴
      const M = o.mood;
      M[0] += ((0.15 + o.cheer * 0.3) - M[0]) * dt * 0.08;
      for (let k = 1; k < 4; k++) M[k] *= Math.exp(-dt * (k === 3 ? 0.5 : 0.12));
      M[4] += ((1 - o.cheer) * 0.15 - M[4]) * dt * 0.05;
      o.tt -= dt; o.think -= dt;
      if (o.st === 'fly') { if (this._physics(o, dt) && o.t > 0.4) { o.st = o.dead ? 'dead' : 'down'; o.t = 0; o.rx = Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1); o.rz = 0; M[4] = Math.max(M[4], 0.6); } continue; }
      if (o.st === 'dead' || o.dead) { if (o.st !== 'dead') { o.st = 'fly'; o.t = 0; } continue; }
      if (o.st === 'down') {
        if (o.t > rnd(4, 8)) { o.rx = o.rz = 0; o.st = 'flee'; o.t = 0; const a = Math.random() * 6.28; o.fx = Math.sin(a); o.fz = Math.cos(a); o.v = rnd(2.5, 4.2); this._say(o, pick(SAY.calm), 3); }
        continue;
      }
      // 지각: 0.4 초마다 주변을 살핌
      o.sense -= dt;
      if (o.sense <= 0) { o.sense = 0.4; this._perceive(o, pa, pSp, info); }
      // 부딪힘
      const dp = Math.hypot(o.x - pa.x, o.y + 0.9 - pa.y, o.z - pa.z);
      if (dp < (info.driving ? 2.6 : 1.6) && pSp > 6) { o.vx = pv.x * 0.8; o.vy = Math.max(3, pv.y * 0.5 + pSp * 0.25); o.vz = pv.z * 0.8; o.wx = rnd(-10, 10); o.wz = rnd(-10, 10); o.st = 'fly'; o.t = 0; M[1] = 1; if (pSp > (info.driving ? 11 : 18)) this._die(o); else this._say(o, pick(SAY.hit), 2.5); continue; }
      if (o.st === 'walk') {
        o.d += o.v * dt * o.dir;
        const len = L.len[o.p];
        if (o.d > len || o.d < 0) {
          const end = o.dir > 0 ? L.nb[o.p] : L.na[o.p];
          const over = o.d > len ? o.d - len : -o.d;
          const nxt = this._next(this.padj, L, end, o.p, (j) => (L.cls[j] >= 9 ? 0.5 : 0) + (SIDE[L.cls[j]] > 0 ? 0.4 : 0));
          if (nxt < 0) { o.dir = -o.dir; o.d = clamp(o.d, 0, len); }
          else { o.p = nxt; if (L.na[nxt] === end) { o.dir = 1; o.d = Math.min(over, L.len[nxt]); } else { o.dir = -1; o.d = Math.max(0, L.len[nxt] - over); } }
        }
        this._place(o, L);
        o.ph += dt * o.v * 4.2;
        o.arm = 0;
      } else if (o.st === 'stare' || o.st === 'photo' || o.st === 'angry') {
        // 멈춰서 플레이어를 바라봄
        o.h = Math.atan2(pa.x - o.x, pa.z - o.z);
        o.arm = o.st === 'photo' ? 2 : o.st === 'angry' ? 3 : 0;
        o.ph += dt * (o.st === 'angry' ? 5 : 0.5);
        if (o.t > o.look) { o.st = 'walk'; o.arm = 0; }
      } else if (o.st === 'flee') {
        o.x += o.fx * o.v * dt; o.z += o.fz * o.v * dt; o.h = Math.atan2(o.fx, o.fz);
        o.ph += dt * o.v * 3.2; o.arm = 1;
        const gy = this._h(o.x, o.z), roof = this.game.city ? this.game.city.roofAt(o.x + o.fx * 2, o.z + o.fz * 2) : -1e9;
        if (roof > gy + 1) { const t = o.fx; o.fx = -o.fz; o.fz = t; }
        o.y += (gy - o.y) * Math.min(1, dt * 10);
        if (o.t > 18 && M[1] < 0.3) {
          // 다시 길로
          if (this._spawnOn(o, { x: o.x, z: o.z }, 0, 25, false)) { o.st = 'walk'; o.v = rnd(1.1, 1.6); o.arm = 0; this._place(o, L); }
          else o.t = 10;
        }
      }
    }
  }

  _place(o, L) {
    this._at(L, o.p, o.d, o);
    const c = L.cls[o.p];
    // 보도 가운데 (건물까지 여유에 맞춤)
    const off = this.roads.walkOff(o.p, o.d, o.side) + (o.lo || 0);
    const tx = o.tx * o.dir, tz = o.tz * o.dir;
    o.x += -o.tz * off; o.z += o.tx * off;
    o.h = Math.atan2(tx, tz);
    const gy = o.deckY !== null ? o.deckY + 0.15 : this._h(o.x, o.z) + (SIDE[c] > 0 ? 0.15 : 0);
    o.y = o.tunnel ? gy - 30 : gy;
  }

  // 주변을 보고 감정·행동·생각을 정함
  _perceive(o, pa, pSp, info) {
    const M = o.mood;
    const dp = Math.hypot(o.x - pa.x, o.z - pa.z), dy = pa.y - o.y;
    // 사건 (폭발·붕괴·핵)
    for (const e of this.events) {
      const age = this.time - e.t;
      if (age > 15) continue;
      const d = Math.hypot(o.x - e.x, o.z - e.z);
      if (d > e.R) continue;
      const k = e.s * (1 - d / e.R) * (age < 3 ? 1 : 0.4);
      if (k < 0.05) continue;
      if (e.type === 'nuke') { M[1] = Math.max(M[1], 0.9); M[3] = Math.max(M[3], 1); if (o.tt <= 0) this._say(o, pick(SAY.nuke), 5); }
      else { M[1] = Math.max(M[1], Math.min(1, k * 1.6)); M[3] = Math.max(M[3], k); if (o.tt <= 0) this._say(o, pick(e.type === 'blast' ? SAY.blast : SAY.collapse), 3.5); }
      if (M[1] > 0.45 && o.st !== 'flee') {
        const dx = o.x - e.x, dz = o.z - e.z, l = Math.hypot(dx, dz) || 1;
        o.st = 'flee'; o.t = 0; o.fx = dx / l; o.fz = dz / l; o.v = rnd(3.8, 5.6);
      }
    }
    if (o.st === 'flee') return;
    // 플레이어
    if (dp < 28) {
      if (info.sword && dp < 9) {
        if (o.brave > 0.8) { M[2] = Math.max(M[2], 0.8); if (o.tt <= 0) this._say(o, pick(SAY.swordBrave), 3.5); if (o.st === 'walk') { o.st = 'angry'; o.t = 0; o.look = rnd(3, 5); } }
        else { M[1] = Math.max(M[1], 0.75); if (o.tt <= 0) this._say(o, pick(SAY.sword), 3.5); if (M[1] > 0.6) { const l = dp || 1; o.st = 'flee'; o.t = 0; o.fx = (o.x - pa.x) / l; o.fz = (o.z - pa.z) / l; o.v = rnd(3.5, 5); } }
      } else if (info.flying && dy > 1.5 && dy < 80) {
        M[3] = Math.max(M[3], 0.9); M[0] = Math.max(M[0], 0.4 + o.cheer * 0.5);
        if (o.tt <= 0) this._say(o, pick(SAY.fly), 4);
        if (o.st === 'walk' && Math.random() < 0.5) { o.st = Math.random() < 0.55 ? 'photo' : 'stare'; o.t = 0; o.look = rnd(3, 7); }
      } else if (pSp > 25 && dp < 15) {
        M[3] = Math.max(M[3], 1); if (o.tt <= 0) this._say(o, pick(SAY.fast), 2.5);
      }
    }
    // 평소 생각
    if (o.think <= 0) {
      o.think = rnd(8, 22);
      if (o.tt <= 0 && Math.random() < 0.55) this._say(o, pick(GOALS[o.goal]), 4);
    }
  }

  _stepTrains(dt, cam) {
    const RL = this.roads.rails;
    if (!RL) return;
    let spawns = 1;
    for (const T of this.trains) {
      if (T.alive && !T.player && Math.hypot(T.x - cam.x, T.z - cam.z) > 7000) T.alive = false;
      if (T.alive && T.derailed) { this._stepDerailed(T, dt); continue; }
      if (T.alive && T.player) continue;     // 플레이어가 운전 (vehicle.js)
      const idx = this.trains.indexOf(T);
      if (!T.alive) {
        if (idx >= this.maxT || spawns <= 0) continue;
        spawns--;
        // 카메라 근처 철도 조각 아무거나 (지상 구간이면 더 좋음)
        let best = -1, bs = -1e9;
        for (let tries = 0; tries < 40; tries++) {
          const i = (Math.random() * RL.n) | 0;
          if (RL.cls[i] > 2) continue;
          const a = RL.start[i];
          const d = Math.hypot(RL.pts[a * 2] - cam.x, RL.pts[a * 2 + 1] - cam.z);
          if (d > 5000) continue;
          // 지상 구간(터널 아님)·일반 철도를 더 자주 → 땅 위를 달리는 열차가 잘 보임
          const sc = -d / 1000 + ((RL.flags[i] & 2) ? 0 : 6) + (RL.cls[i] === 1 ? 2 : 0) + Math.random();
          if (sc > bs) { bs = sc; best = i; }
        }
        if (best < 0) continue;
        T.alive = true; T.derailed = false; T.cars = null; T.player = false; T.p = best; T.d = 0; T.dir = 1; T.v = rnd(16, 22);
        T.color = lineColor(RL.names && RL.names[RL.nameIx[best]], RL.cls[best]); T.kind = RL.cls[best] === 0 ? 'sub' : 'rail'; T.n = T.kind === 'sub' ? 8 : 6; T.hist.length = 0;
        // 미리 열차 길이만큼 달려 둠 (뒤 칸 자리 기록)
        for (let s = 0; s < T.n * 20.5 + 10; s += 2) this._trainStep(T, 2);
      }
      T.v += (19 - T.v) * Math.min(1, dt * 0.3);
      this._trainStep(T, T.v * dt);
    }
  }
  _trainStep(T, ds) {
    const RL = this.roads.rails;
    T.d += ds * T.dir;
    const len = RL.len[T.p];
    if (T.d > len || T.d < 0) {
      const end = T.dir > 0 ? RL.nb[T.p] : RL.na[T.p];
      const over = T.d > len ? T.d - len : -T.d;
      const steer = T.player ? T.steer : 0, ctx = T.tx * T.dir, ctz = T.tz * T.dir;
      const nxt = this._next(this.radj, RL, end, T.p, (j) => {
        let w = RL.cls[j] === RL.cls[T.p] ? 2 : 0;
        if (steer) {
          // 갈림길: 조종 방향(왼쪽/오른쪽)으로 꺾이는 선로
          const a = RL.start[j], b = RL.start[j + 1] - 1, fwd = RL.na[j] === end;
          const i0 = fwd ? a : b, i1 = fwd ? a + 1 : b - 1;
          const dx = RL.pts[i1 * 2] - RL.pts[i0 * 2], dz = RL.pts[i1 * 2 + 1] - RL.pts[i0 * 2 + 1], l = Math.hypot(dx, dz) || 1;
          w += steer * (ctx * dz - ctz * dx) / l * 6;
        }
        return w;
      });
      if (nxt < 0) { T.dir = -T.dir; T.d = clamp(T.d, 0, len); T.hist.length = 0; }
      else { T.p = nxt; if (RL.na[nxt] === end) { T.dir = 1; T.d = Math.min(over, RL.len[nxt]); } else { T.dir = -1; T.d = Math.max(0, RL.len[nxt] - over); } }
    }
    const o = this._at(RL, T.p, T.d, T, true);
    const y = o.deckY !== null ? o.deckY : o.tunnel ? this._h(o.x, o.z) - 25 : this._h(o.x, o.z);
    const H = T.hist;
    const last = H.length ? H[H.length - 1] : null;
    if (!last || Math.hypot(o.x - last[0], o.z - last[2]) > 1.5) {
      H.push([o.x, y, o.z, (last ? last[3] : 0) + (last ? Math.hypot(o.x - last[0], o.z - last[2]) : 0), o.tunnel ? 1 : 0]);
      if (H.length > 160) H.shift();
    }
  }

  // 열차 칸들의 현재 위치·방향 (기록된 길을 따라)
  trainCars(T, out = []) {
    out.length = 0;
    if (T.derailed && T.cars) { for (const c of T.cars) out.push({ x: c.x, y: c.y, z: c.z, h: c.h }); return out; }
    const H = T.hist;
    if (H.length < 2) return out;
    const end = H[H.length - 1][3];
    let hi = H.length - 1;
    for (let j = 0; j < T.n; j++) {
      const sc = end - 10 - j * 20.5;
      while (hi > 0 && H[hi - 1][3] > sc) hi--;
      if (hi <= 0) break;
      const a = H[hi - 1], b = H[hi];
      const u = clamp((sc - a[3]) / Math.max(b[3] - a[3], 1e-3), 0, 1);
      out.push({ x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, z: a[2] + (b[2] - a[2]) * u, h: Math.atan2(b[0] - a[0], b[2] - a[2]), tunnel: a[4] && b[4] });
    }
    return out;
  }
  // 앞 칸 진행 방향의 곡률 (1/m): 최근 기록 몇 개로
  trainCurv(T) {
    const H = T.hist, n = H.length;
    if (n < 8) return 0;
    const a = H[n - 8], b = H[n - 4], c = H[n - 1];
    const h1 = Math.atan2(b[0] - a[0], b[2] - a[2]), h2 = Math.atan2(c[0] - b[0], c[2] - b[2]);
    let dh = h2 - h1; dh -= Math.round(dh / (Math.PI * 2)) * Math.PI * 2;
    const s = Math.max(1, (c[3] - a[3]) * 0.5);
    return dh / s;
  }
  // 탈선: 칸마다 따로 날아가 구르고 미끄러짐
  derail(T) {
    if (T.derailed) return;
    const cars = this.trainCars(T);
    const k = this.trainCurv(T), side = k > 0 ? -1 : 1;
    T.cars = cars.map((c, j) => {
      const fx = Math.sin(c.h), fz = Math.cos(c.h), v = T.v * (1 - j * 0.02);
      // 원심력 쪽(커브 바깥)으로 튕겨 나감
      return { x: c.x, y: c.y + 0.3, z: c.z, h: c.h, vx: fx * v + fz * side * v * 0.25, vy: 2 + Math.random() * 3, vz: fz * v - fx * side * v * 0.25,
        rx: 0, rz: 0, wx: rnd(-0.5, 0.5), wz: side * rnd(1.2, 2.6) * (1 + j * 0.05), wh: rnd(-0.6, 0.6), rest: 0 };
    });
    T.derailed = true; T.t = 0;
    const fx = this.game.fx;
    if (fx && fx.sparks && cars[0]) { _p.set(cars[0].x - origin.x, cars[0].y + 1 - origin.y, cars[0].z - origin.z); fx.sparks(_p, _v.set(0, 1, 0), 60, 1.2, 30, 2.4, 1.6, 0.8, 0.08); }
    this.game.audio && this.game.audio.play('clang', 1);
    this.event('blast', T.x, T.z, 300, 1);
  }
  _stepDerailed(T, dt) {
    T.t += dt;
    if (T.t > 120) { T.alive = false; return; }
    const fx = this.game.fx;
    for (const c of T.cars) {
      if (c.rest > 2) continue;
      const gy = this._h(c.x, c.z);
      c.vy -= G * dt;
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      c.rx += c.wx * dt; c.rz += c.wz * dt; c.h += c.wh * dt;
      if (c.y <= gy) {
        c.y = gy;
        if (c.vy < -2) c.vy *= -0.2; else c.vy = 0;
        // 땅에 끌리며 감속 (구르는 회전도 줄어듦)
        const k = Math.exp(-1.6 * dt);
        c.vx *= k; c.vz *= k; c.wx *= Math.exp(-2.5 * dt); c.wz *= Math.exp(-2.5 * dt); c.wh *= Math.exp(-3 * dt);
        const sp = Math.hypot(c.vx, c.vz);
        if (sp > 6 && fx && fx.puff && Math.random() < dt * 8) fx.puff({ x: c.x - origin.x, y: gy + 0.5 - origin.y, z: c.z - origin.z, vx: rnd(-1, 1), vy: rnd(1, 3), vz: rnd(-1, 1), life: rnd(2, 4), s0: 2, s1: 8, a: 0.4, r0: 0.5, g0: 0.45, b0: 0.38, r1: 0.6, g1: 0.56, b1: 0.5, fin: 0.05, drag: 0.5 }, 'smoke', 1);
        if (sp < 0.5 && Math.abs(c.wz) < 0.3) {
          c.rest += dt;
          // 옆으로 눕거나 바로 섬
          c.rz += (Math.round(c.rz / (Math.PI / 2)) * (Math.PI / 2) - c.rz) * Math.min(1, dt * 3);
        }
      }
    }
    // 칸끼리 사람·차를 침
    for (const c of T.cars) {
      const sp = Math.hypot(c.vx, c.vz);
      if (sp < 5) continue;
      for (const o of this.people) if (o.alive && !o.dead && Math.hypot(o.x - c.x, o.z - c.z) < 3) { this._fling(o, c.x, c.z, sp); this._die(o); }
      for (const o of this.cars) if (o.alive && !o.hidden && o.st !== 'player' && Math.hypot(o.x - c.x, o.z - c.z) < 3.5) { this._fling(o, c.x, c.z, sp * 0.6); this._wreck(o, sp > 20); }
    }
  }

  // ───────── 그리기 ─────────
  _render(near, show) {
    if (near) {
      let n = 0;
      const A = this.pA;
      for (const o of this.people) {
        if (!o.alive || (o.y < this._h(o.x, o.z) - 10)) continue;
        _q.setFromAxisAngle(Y, o.h || 0);
        if (o.rx || o.rz) _q.premultiply(_q2.setFromEuler(_e.set(o.rx, 0, o.rz)));
        _p.set(o.x - origin.x, o.y - origin.y + (o.st === 'down' ? 0.12 : 0), o.z - origin.z);
        this.pMesh.setMatrixAt(n, _m.compose(_p, _q, _s));
        const moving = o.st === 'walk' || o.st === 'flee';
        A.anim.setXYZW(n, o.ph, moving ? (o.st === 'flee' ? 0.85 : 0.45) : 0, o.st === 'fly' ? 1 : o.arm, o.seed);
        A.shirt.setXYZ(n, o.shirt.r, o.shirt.g, o.shirt.b); A.pants.setXYZ(n, o.pants.r, o.pants.g, o.pants.b);
        A.mood.setXYZW(n, o.mood[0], o.mood[1], o.mood[2], o.mood[3]);
        n++;
      }
      this.pMesh.count = n;
      this.pMesh.instanceMatrix.needsUpdate = true;
      for (const k in A) A[k].needsUpdate = true;
      const cnt = { car: 0, suv: 0, taxi: 0, bus: 0 };
      for (const o of this.cars) {
        if (!o.alive || o.hidden) continue;
        const K = this.kinds[o.kind];
        _q.setFromAxisAngle(Y, o.h || 0);
        if (o.rx || o.rz) _q.premultiply(_q2.setFromEuler(_e.set(o.rx, 0, o.rz)));
        _p.set(o.x - origin.x, o.y - origin.y, o.z - origin.z);
        const j = cnt[o.kind]++;
        K.mesh.setMatrixAt(j, _m.compose(_p, _q, _s));
        K.mesh.setColorAt(j, o.col);
      }
      for (const k in this.kinds) { const m = this.kinds[k].mesh; m.count = cnt[k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    }
    // 전동차: 기록된 길을 따라 칸마다 배치 (맨 앞·맨 뒤는 운전실 칸)
    const tc = { mid: 0, cab: 0 };
    const put = (k, col) => { const M = this.tMesh[k]; if (tc[k] < 160) { M.setMatrixAt(tc[k], _m.compose(_p, _q, _s)); M.setColorAt(tc[k], col); tc[k]++; } };
    for (const T of this.trains) {
      const col = T.color || _white;
      if (T.alive && T.derailed && T.cars) {
        T.cars.forEach((c, j) => {
          _q.setFromAxisAngle(Y, c.h + (j === T.cars.length - 1 && j > 0 ? Math.PI : 0)).premultiply(_q2.setFromEuler(_e.set(c.rx, 0, c.rz)));
          _p.set(c.x - origin.x, c.y - origin.y, c.z - origin.z);
          put(j === 0 || j === T.cars.length - 1 ? 'cab' : 'mid', col);
        });
        continue;
      }
      if (!T.alive || T.hist.length < 2) continue;
      const H = T.hist, end = H[H.length - 1][3];
      let hi = H.length - 1;
      for (let j = 0; j < T.n; j++) {
        const sc = end - 10 - j * 20.5;
        while (hi > 0 && H[hi - 1][3] > sc) hi--;
        if (hi <= 0) break;
        const a = H[hi - 1], b = H[hi];
        const u = clamp((sc - a[3]) / Math.max(b[3] - a[3], 1e-3), 0, 1);
        if (a[4] && b[4]) continue;                                           // 터널 속
        const x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u, z = a[2] + (b[2] - a[2]) * u;
        const last = j === T.n - 1;
        _q.setFromAxisAngle(Y, Math.atan2(b[0] - a[0], b[2] - a[2]) + (last ? Math.PI : 0));
        _p.set(x - origin.x, y - origin.y, z - origin.z);
        put(j === 0 || last ? 'cab' : 'mid', col);
      }
    }
    for (const k in this.tMesh) { const M = this.tMesh[k]; M.count = tc[k]; M.instanceMatrix.needsUpdate = true; if (M.instanceColor) M.instanceColor.needsUpdate = true; }
  }

  // 가장 가까운 사람들의 생각을 말풍선으로
  _bubbles(camera, near) {
    const B = this.bubbles;
    if (!near || !camera || this.showBubbles === false) { for (const b of B) b.style.display = 'none'; return; }
    const cx = camera.position.x + origin.x, cy = camera.position.y + origin.y, cz = camera.position.z + origin.z;
    const list = [];
    for (const o of this.people) {
      if (!o.alive || o.tt <= 0 || !o.thought) continue;
      const d = Math.hypot(o.x - cx, o.y - cy, o.z - cz);
      if (d < 45) list.push([d, o]);
    }
    list.sort((a, b) => a[0] - b[0]);
    const W = innerWidth, H = innerHeight;
    for (let i = 0; i < B.length; i++) {
      const el = B[i], it = list[i];
      if (!it) { el.style.display = 'none'; continue; }
      const o = it[1];
      _v.set(o.x - origin.x, o.y + 2.05 - origin.y, o.z - origin.z).project(camera);
      if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) { el.style.display = 'none'; continue; }
      const M = o.mood;
      let e = 5, best = 0.35;
      for (let k = 0; k < 5; k++) if (M[k] > best) { best = M[k]; e = k; }
      const txt = EMOJI[e] + ' ' + o.thought;
      if (el._t !== txt) { el.textContent = txt; el._t = txt; }
      el.style.display = 'block';
      el.style.opacity = String(clamp(1.3 - it[0] / 45, 0.25, 1) * clamp(o.tt * 2, 0, 1));
      el.style.transform = `translate(${((_v.x + 1) / 2 * W).toFixed(0)}px, ${((1 - _v.y) / 2 * H).toFixed(0)}px) translate(-50%, -100%)`;
    }
  }

  reset() {
    for (const o of this.people) o.alive = false;
    for (const o of this.cars) o.alive = false;
    for (const T of this.trains) { T.alive = false; T.player = false; T.derailed = false; T.cars = null; }
    this.events.length = 0;
  }
}
