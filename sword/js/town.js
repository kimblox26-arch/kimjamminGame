// SKY BLADE — 실제 서울 도로망 위의 사람·자동차·버스·택시·지하철
//  - 자동차: Overture 도로 그래프 (커넥터 = 노드) 를 따라 우측 통행, 차로 유지, 앞차와 간격, 실제 신호등 위치에서 신호 대기
//  - 사람: 보도·보행로를 따라 걷고, 저마다 목적(출근·점심·산책…)과 성격이 있음
//      감정 (기쁨·두려움·화남·놀람·슬픔) 이 주변 사건 (플레이어가 날거나 칼을 뽑음, 폭발, 건물 붕괴, 핵) 에 반응해 바뀌고
//      감정에 따라 행동 (구경·사진 찍기·도망·주먹 흔들기·주저앉기) 과 얼굴 표정, 머릿속 생각 (말풍선) 이 달라짐
//  - 지하철·기차: 철도 그래프를 달리고 지하 구간에선 땅속으로 (보이지 않음), 지상·고가·다리에선 보임
import * as THREE from 'three';
import { origin } from './frame.js';
import { boxes } from './life.js';

const G = 9.81;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
const _e = new THREE.Euler(), Y = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3();
// 분류별 제한 속도 (m/s): 고속 90, 도시고속 80, 간선 60, 보조 50, 집산 40, 주거 30 km/h …
const VMAX = [25, 22, 16, 14, 11, 8, 5, 8, 5];
const SIDE = [0, 3.0, 3.5, 3.0, 2.5, 1.2, 0, 0.8, 0, 0, 0, 0, 0, 0, 0];

// ───────── 사람: 몸 + 얼굴 (표정은 셰이더) ─────────
//  part: 0 몸통, 1 머리, 2/3 다리, 4/5 팔, 6 머리카락, 7/8 신발 (다리와 함께), 9/10 손 (팔과 함께), 11 가방
function personGeo() {
  return boxes([
    [0.34, 0.52, 0.2, 0, 1.12, 0, 0],
    [0.08, 0.06, 0.08, 0, 1.4, 0, 1],
    [0.19, 0.22, 0.2, 0, 1.55, 0.005, 1],
    [0.2, 0.07, 0.21, 0, 1.68, -0.005, 6], [0.2, 0.16, 0.05, 0, 1.6, -0.09, 6],
    [0.13, 0.8, 0.15, -0.09, 0.44, 0, 2], [0.13, 0.8, 0.15, 0.09, 0.44, 0, 3],
    [0.12, 0.08, 0.24, -0.09, 0.04, 0.03, 7], [0.12, 0.08, 0.24, 0.09, 0.04, 0.03, 8],
    [0.09, 0.58, 0.11, -0.225, 1.08, 0, 4], [0.09, 0.58, 0.11, 0.225, 1.08, 0, 5],
    [0.08, 0.1, 0.09, -0.225, 0.75, 0, 9], [0.08, 0.1, 0.09, 0.225, 0.75, 0, 10],
    [0.26, 0.32, 0.1, 0, 1.15, -0.15, 11],
  ]);
}
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
float sk = fract(iAnim.w * 7.31);
vec3 skin = mix(vec3(0.78, 0.58, 0.45), vec3(0.5, 0.33, 0.22), sk * sk);
vec3 hair = mix(vec3(0.025, 0.02, 0.018), vec3(0.3, 0.18, 0.08), step(0.82, fract(iAnim.w * 13.7)));
vec3 bag = fract(iAnim.w * 5.3) < 0.5 ? vec3(0.05) : iPants * 0.7;
vPC = aPart < 0.5 ? iShirt : aPart < 1.5 ? skin : aPart < 3.5 ? iPants : aPart < 5.5 ? iShirt : aPart < 6.5 ? hair : aPart < 8.5 ? vec3(0.04) : aPart < 10.5 ? skin : bag;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPC; varying vec3 vObj; varying vec3 vObjN; varying float vPart; varying vec4 vMood;')
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = vPC;
// 얼굴 (머리 앞면): 눈·눈썹·입 — 기쁨은 웃는 입, 두려움·놀람은 벌린 입, 화남은 찌푸린 눈썹
if (vPart > 0.5 && vPart < 1.5 && vObjN.z > 0.5 && vObj.y > 1.44) {
  vec2 f = vec2(vObj.x, vObj.y - 1.55);
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

// ───────── 차 ─────────
function sedanGeo() {
  return boxes([
    [1.8, 0.72, 4.5, 0, 0.6, 0, 0, 0xffffff], [1.64, 0.58, 2.4, 0, 1.25, -0.2, 0, 0x1d242b], [1.66, 0.07, 2.2, 0, 1.57, -0.25, 0, 0xffffff],
    [0.26, 0.62, 0.62, -0.83, 0.31, 1.4, 0, 0x101010], [0.26, 0.62, 0.62, 0.83, 0.31, 1.4, 0, 0x101010],
    [0.26, 0.62, 0.62, -0.83, 0.31, -1.4, 0, 0x101010], [0.26, 0.62, 0.62, 0.83, 0.31, -1.4, 0, 0x101010],
    [1.5, 0.14, 0.05, 0, 0.75, 2.26, 0, 0xfff6dc], [1.6, 0.12, 0.05, 0, 0.82, -2.26, 0, 0xb00808],
  ]);
}
function busGeo() {
  return boxes([
    [2.5, 2.6, 11.0, 0, 1.75, 0, 0, 0xffffff], [2.52, 1.05, 10.2, 0, 2.15, 0.2, 0, 0x1b2127], [2.3, 0.9, 0.06, 0, 2.2, 5.52, 0, 0x1b2127],
    [0.3, 0.95, 0.95, -1.1, 0.48, 3.4, 0, 0x101010], [0.3, 0.95, 0.95, 1.1, 0.48, 3.4, 0, 0x101010],
    [0.3, 0.95, 0.95, -1.1, 0.48, -3.0, 0, 0x101010], [0.3, 0.95, 0.95, 1.1, 0.48, -3.0, 0, 0x101010],
    [2.0, 0.3, 0.05, 0, 3.0, 5.52, 0, 0xffb020],
  ]);
}
function taxiGeo() {
  const g = sedanGeo();
  return g;
}
const CAR_COLORS = [0xf2f2f2, 0xf2f2f2, 0xeeeeee, 0x15161a, 0x15161a, 0x9aa0a6, 0x9aa0a6, 0x7a7f86, 0x2b4a7a, 0x8a1c1c, 0xd8c8a0];
const BUS_COLORS = [0x1f5fb5, 0x1f5fb5, 0x2e9e4a, 0x2e9e4a, 0xd03030, 0xe8b018];
// ───────── 전동차 (지하철/전철) ─────────
function trainGeo() {
  return boxes([
    [3.1, 3.4, 19.5, 0, 2.05, 0, 0, 0xc9ccd0], [3.12, 1.0, 18.6, 0, 2.6, 0, 0, 0x1a2026], [3.13, 0.3, 19.4, 0, 1.55, 0, 0, 0xffffff],
    [2.6, 0.5, 19.0, 0, 0.3, 0, 0, 0x2a2a2a],
  ]);
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
      const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.35 }), n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.castShadow = true; m.frustumCulled = false; m.count = 0;
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      scene.add(m);
      return { mesh: m, colors };
    };
    this.kinds = { car: mkCars(sedanGeo(), 160, CAR_COLORS), taxi: mkCars(taxiGeo(), 40, [0xf08a1e, 0xf2f2f2]), bus: mkCars(busGeo(), 30, BUS_COLORS) };
    this.cars = [];
    for (let i = 0; i < 200; i++) {
      const r = Math.random(), kind = r < 0.08 ? 'bus' : r < 0.22 ? 'taxi' : 'car';
      this.cars.push({ alive: false, i, kind, col: new THREE.Color(pick(this.kinds[kind].colors)), p: 0, d: 0, dir: 1, lane: 0, x: 0, y: 0, z: 0, h: 0, v: 0, vmax: 10, st: 'drive', t: 0,
        vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, wx: 0, wz: 0, shock: -1, hidden: false });
    }
    // 전동차
    this.tMesh = { sub: null, rail: null };
    for (const [k, stripe] of [['sub', 0x2fa84f], ['rail', 0x1f5fb5]]) {
      const g = trainGeo();
      // 색띠 칸만 노선 색으로 (정점 색이 흰색인 곳)
      const c = g.attributes.color, col = new THREE.Color(stripe);
      for (let j = 0; j < c.count; j++) if (c.getX(j) > 0.99 && c.getY(j) > 0.99) c.setXYZ(j, col.r, col.g, col.b);
      const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.35 }), 120);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.castShadow = true; m.frustumCulled = false; m.count = 0;
      scene.add(m);
      this.tMesh[k] = m;
    }
    this.trains = [];
    for (let i = 0; i < 10; i++) this.trains.push({ alive: false, p: 0, d: 0, dir: 1, v: 0, n: 8, hist: [], kind: 'sub' });
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

  setEco(eco) { this.eco = eco; this.R = eco ? 260 : 420; this.maxP = eco ? 120 : 340; this.maxC = eco ? 60 : 190; this.maxT = eco ? 4 : 9; }

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
    o.tunnel = (L.flags[i] & 2) !== 0;
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
    }
    for (const o of this.cars) if (o.alive && !o.hidden) {
      const d = Math.hypot(o.x - x, o.y - y, o.z - z);
      if (d < R * 0.8) this._fling(o, x, z, power * 0.6 * (1 - d / R) + 2);
      else if (d < R * 3 && o.st === 'drive') { o.st = 'stop'; o.t = 0; }
    }
  }
  panic(x, z, R) { this.event('collapse', x, z, R, 0.7); }
  shock(id, x, gy, z, front, vap, R5, Rmax) {
    if (!this._nukeEv || this._nukeEv !== id) { this._nukeEv = id; this.event('nuke', x, z, 40000, 1); }
    const hit = (o, car) => {
      if (!o.alive || o.shock === id) return;
      const d = Math.hypot(o.x - x, o.z - z);
      if (d > front || d > Rmax) return;
      o.shock = id;
      if (d < vap) { o.alive = false; return; }
      this._fling(o, x, z, clamp(Math.pow(R5 / Math.max(d, 30), 1.4) * (car ? 35 : 45), 3, 250));
    };
    for (const o of this.people) hit(o, false);
    for (const o of this.cars) if (!o.hidden) hit(o, true);
  }
  _fling(o, x, z, v) {
    const dx = o.x - x, dz = o.z - z, l = Math.hypot(dx, dz) || 1;
    o.vx = dx / l * v; o.vz = dz / l * v; o.vy = v * rnd(0.25, 0.6) + 1;
    o.wx = rnd(-8, 8); o.wz = rnd(-8, 8);
    if (o.st !== 'fly') { o.rx = 0; o.rz = 0; }
    o.st = 'fly'; o.t = 0;
    if (o.mood) { o.mood[1] = 1; this._say(o, pick(SAY.hit), 3); }
  }
  _say(o, text, dur = 4) { o.thought = text; o.tt = dur; }

  _physics(o, dt) {
    const gy = this._h(o.x, o.z);
    o.vy -= G * dt;
    const dr = Math.exp(-0.08 * dt * Math.hypot(o.vx, o.vy, o.vz));
    o.vx *= dr; o.vy *= dr; o.vz *= dr;
    o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
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
    const agl = cam.y - this._h(cam.x, cam.z);
    const near = show && agl < 2500;
    this.pMesh.visible = near;
    for (const k in this.kinds) this.kinds[k].mesh.visible = near;
    this.tMesh.sub.visible = this.tMesh.rail.visible = show && agl < 6000;
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
      if (o.alive && Math.hypot(o.x - cam.x, o.z - cam.z) > R * 1.25 && o.st !== 'fly') o.alive = false;
      if (!o.alive) {
        if (o.i >= this.maxC || spawns <= 0) continue;
        spawns--;
        if (!this._spawnOn(o, cam, this.time < 2 ? 15 : R * 0.7, R, true)) continue;
        if (o.kind === 'bus' && L.cls[o.p] > 4) continue;
        o.alive = true; o.st = 'drive'; o.v = 0; o.t = 0; o.rx = o.rz = 0; o.shock = -1;
        const c = L.cls[o.p], hw = L.width[o.p] / 2;
        const lanes = c <= 2 ? Math.max(1, Math.round(hw * 2 / 3.3)) : Math.max(1, Math.floor(hw / 3.2));
        o.lane = Math.floor(Math.random() * lanes);
        this._at(L, o.p, o.d, o); o.y = o.deckY !== null ? o.deckY : this._h(o.x, o.z);
      }
      o.t += dt;
      if (o.st === 'fly') { if (this._physics(o, dt) && o.t > 0.5) { o.st = 'wreck'; o.t = 0; o.rx = Math.round(o.rx / Math.PI) * Math.PI; o.rz = Math.round(o.rz / Math.PI) * Math.PI; } continue; }
      if (o.st === 'wreck') continue;
      // 플레이어와 충돌
      if (!o.hidden && Math.hypot(o.x - pa.x, o.y + 0.8 - pa.y, o.z - pa.z) < 3 && pSp > 15) {
        o.vx = pv.x * 0.6; o.vy = Math.max(2, pSp * 0.15); o.vz = pv.z * 0.6; o.wx = rnd(-3, 3); o.wz = rnd(-3, 3); o.st = 'fly'; o.t = 0;
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
        }
      }
      // 플레이어가 길에 서 있으면 멈춤 (빵빵)
      { const dx = pa.x - o.x, dz = pa.z - o.z, ahead = dx * fx + dz * fz; if (ahead > 0 && ahead < 14 && Math.abs(dx * fz - dz * fx) < 1.8 && Math.abs(pa.y - o.y) < 3) want = 0; }
      o.v += clamp(want - o.v, -6 * dt, 2.2 * dt);
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
    for (const o of this.people) {
      if (o.alive && Math.hypot(o.x - cam.x, o.z - cam.z) > R * 1.3 && o.st !== 'fly') o.alive = false;
      if (!o.alive) {
        if (o.i >= this.maxP || spawns <= 0) continue;
        spawns--;
        if (!this._spawnOn(o, cam, this.time < 2 ? 6 : R * 0.65, R, false)) continue;
        o.alive = true; o.st = 'walk'; o.v = rnd(1.1, 1.6); o.side = Math.random() < 0.5 ? 1 : -1; o.t = 0; o.rx = o.rz = 0; o.shock = -1;
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
      if (o.st === 'fly') { if (this._physics(o, dt) && o.t > 0.4) { o.st = 'down'; o.t = 0; o.rx = Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1); o.rz = 0; M[4] = Math.max(M[4], 0.6); } continue; }
      if (o.st === 'down') {
        if (o.t > rnd(4, 8)) { o.rx = o.rz = 0; o.st = 'flee'; o.t = 0; const a = Math.random() * 6.28; o.fx = Math.sin(a); o.fz = Math.cos(a); o.v = rnd(2.5, 4.2); this._say(o, pick(SAY.calm), 3); }
        continue;
      }
      // 지각: 0.4 초마다 주변을 살핌
      o.sense -= dt;
      if (o.sense <= 0) { o.sense = 0.4; this._perceive(o, pa, pSp, info); }
      // 부딪힘
      const dp = Math.hypot(o.x - pa.x, o.y + 0.9 - pa.y, o.z - pa.z);
      if (dp < 1.6 && pSp > 6) { o.vx = pv.x * 0.8; o.vy = Math.max(3, pv.y * 0.5 + pSp * 0.25); o.vz = pv.z * 0.8; o.wx = rnd(-10, 10); o.wz = rnd(-10, 10); o.st = 'fly'; o.t = 0; M[1] = 1; this._say(o, pick(SAY.hit), 2.5); continue; }
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
    const c = L.cls[o.p], hw = L.width[o.p] / 2;
    const off = c >= 9 ? (o.side * Math.min(hw * 0.5, 0.9)) : (hw + Math.max(0.9, SIDE[c] * 0.55)) * o.side;
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
      if (T.alive && Math.hypot(T.x - cam.x, T.z - cam.z) > 7000) T.alive = false;
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
          const sc = -d / 1000 + ((RL.flags[i] & 2) ? 0 : 3) + Math.random();
          if (sc > bs) { bs = sc; best = i; }
        }
        if (best < 0) continue;
        T.alive = true; T.p = best; T.d = 0; T.dir = 1; T.v = rnd(16, 22); T.kind = RL.cls[best] === 0 ? 'sub' : 'rail'; T.n = T.kind === 'sub' ? 8 : 6; T.hist.length = 0;
        // 미리 열차 길이만큼 달려 둠 (뒤 칸 자리 기록)
        for (let s = 0; s < T.n * 20.5 + 10; s += 2) this._trainStep(T, 2);
      }
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
      const nxt = this._next(this.radj, RL, end, T.p, (j) => (RL.cls[j] === RL.cls[T.p] ? 2 : 0));
      if (nxt < 0) { T.dir = -T.dir; T.d = clamp(T.d, 0, len); T.hist.length = 0; }
      else { T.p = nxt; if (RL.na[nxt] === end) { T.dir = 1; T.d = Math.min(over, RL.len[nxt]); } else { T.dir = -1; T.d = Math.max(0, RL.len[nxt] - over); } }
    }
    const o = this._at(RL, T.p, T.d, T);
    const y = o.deckY !== null ? o.deckY : o.tunnel ? this._h(o.x, o.z) - 25 : this._h(o.x, o.z);
    const H = T.hist;
    const last = H.length ? H[H.length - 1] : null;
    if (!last || Math.hypot(o.x - last[0], o.z - last[2]) > 1.5) {
      H.push([o.x, y, o.z, (last ? last[3] : 0) + (last ? Math.hypot(o.x - last[0], o.z - last[2]) : 0), o.tunnel ? 1 : 0]);
      if (H.length > 160) H.shift();
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
      const cnt = { car: 0, taxi: 0, bus: 0 };
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
    // 전동차: 기록된 길을 따라 칸마다 배치
    const tc = { sub: 0, rail: 0 };
    for (const T of this.trains) {
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
        _q.setFromAxisAngle(Y, Math.atan2(b[0] - a[0], b[2] - a[2]));
        _p.set(x - origin.x, y - origin.y, z - origin.z);
        const M = this.tMesh[T.kind];
        if (tc[T.kind] < 120) M.setMatrixAt(tc[T.kind]++, _m.compose(_p, _q, _s));
      }
    }
    for (const k in this.tMesh) { this.tMesh[k].count = tc[k]; this.tMesh[k].instanceMatrix.needsUpdate = true; }
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
    for (const T of this.trains) T.alive = false;
    this.events.length = 0;
  }
}
