// 투척물·폭약 — M67 파편 수류탄 / M18 연막탄 / M112 C4 + 무선 격발기
// 뷰모델(핀 뽑기 → 오버핸드·언더핸드 투척, 설치, 격발), 투척 물리(바운스·구름·부착), 폭발·연막 효과
import * as THREE from 'three';
import { GB } from './guns.js';
import { preset, solveGrasp, proxyFromMesh } from './hand.js';
import { Audio } from './audio.js';
import { T } from './textures.js';
import { WIND } from './human.js';
import { clamp, rand, sampleKeys, sampleAnchor } from './core.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const INFO = {
  frag: { name: 'M67 파편 수류탄', sub: '지연신관 4초 · 살상반경 5m', hint: '좌클릭 유지 → 놓으면 투척 · 우클릭 함께 = 언더핸드', max: 3, mode: '투척' },
  smoke: { name: 'M18 연막탄', sub: '백색 연막 약 25초', hint: '좌클릭 유지 → 놓으면 투척', max: 2, mode: '투척' },
  c4: { name: 'M112 C4', sub: '1.25lb 복합 폭약 · 무선 뇌관', hint: '좌클릭 = 던져서 부착', max: 2, mode: '설치' },
  det: { name: '무선 격발기', sub: '설치된 C4 원격 기폭', hint: '좌클릭 = 기폭 · 우클릭 = C4 추가 설치', max: 0, mode: '격발' },
};
const SLOT = { frag: 2, smoke: 3, c4: 4, det: 4 };

// ── 재질 ──
let MATS;
function rep(tex, s) { const t = tex.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(s, s); t.needsUpdate = true; return t; }
function mats() {
  if (MATS) return MATS;
  const n = (s) => rep(T.anodized.normalMap, s), st = (s) => rep(T.stipple.normalMap, s);
  MATS = {
    od: new THREE.MeshPhysicalMaterial({ color: 0x4a5030, roughness: 0.6, metalness: 0.3, clearcoat: 0.3, clearcoatRoughness: 0.45, normalMap: n(8), normalScale: new THREE.Vector2(0.5, 0.5) }),
    smk: new THREE.MeshPhysicalMaterial({ color: 0x5e6448, roughness: 0.7, metalness: 0.35, clearcoat: 0.2, normalMap: n(8), normalScale: new THREE.Vector2(0.4, 0.4) }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9a9c98, roughness: 0.32, metalness: 1 }),
    spoon: new THREE.MeshStandardMaterial({ color: 0x55593f, roughness: 0.45, metalness: 0.75 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xc19a22, roughness: 0.6 }),
    white: new THREE.MeshStandardMaterial({ color: 0xd9d8cc, roughness: 0.75 }),
    film: new THREE.MeshPhysicalMaterial({ color: 0x575636, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.25, normalMap: st(10), normalScale: new THREE.Vector2(0.25, 0.25) }),
    label: new THREE.MeshStandardMaterial({ color: 0xcdc6aa, roughness: 0.85 }),
    tape: new THREE.MeshStandardMaterial({ color: 0x1d1d1c, roughness: 0.7, normalMap: st(20), normalScale: new THREE.Vector2(0.3, 0.3) }),
    black: new THREE.MeshStandardMaterial({ color: 0x141515, roughness: 0.5, normalMap: st(24), normalScale: new THREE.Vector2(0.3, 0.3) }),
    red: new THREE.MeshStandardMaterial({ color: 0x9a1510, roughness: 0.4 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xb8b8b0, roughness: 0.3, metalness: 1 }),
    wire: new THREE.MeshStandardMaterial({ color: 0x2e5a2a, roughness: 0.6 }),
    led: new THREE.MeshStandardMaterial({ color: 0x220202, emissive: new THREE.Color(1, 0.06, 0.03), emissiveIntensity: 0 }),
    ledG: new THREE.MeshStandardMaterial({ color: 0x021a04, emissive: new THREE.Color(0.1, 1, 0.2), emissiveIntensity: 1.5 }),
  };
  return MATS;
}

// 신관 + 스푼 + 안전핀 (y0 = 신관 바닥, 스푼은 +x 쪽을 따라 내려감)
function fuse(G, M, y0, bodyR, bodyY) {
  G.add(new THREE.CylinderGeometry(0.0085, 0.0095, 0.012, 20), M.steel, 0, y0 + 0.006, 0);
  G.add(new THREE.CylinderGeometry(0.0068, 0.0078, 0.008, 18), M.steel, 0, y0 + 0.016, 0);
  G.add(new THREE.CylinderGeometry(0.0026, 0.0026, 0.02, 10), M.steel, 0.002, y0 + 0.014, 0, 0, 0, Math.PI / 2);
  // 스푼(레버): 신관 위 → 바깥으로 꺾여 몸통을 따라 내려감
  const path = [[-0.005, y0 + 0.021], [0.012, y0 + 0.021], [0.0138, y0 + 0.008]];
  if (bodyY === null) path.push([bodyR + 0.0018, y0 - 0.006], [bodyR + 0.0018, y0 - 0.058]);
  else { const R = bodyR + 0.0019; for (let a = 1.02; a >= -0.4; a -= 0.2) path.push([Math.cos(a) * R, bodyY + Math.sin(a) * R]); }
  for (let i = 1; i < path.length; i++) {
    const [x0, y1] = path[i - 1], [x1, y2] = path[i], dx = x1 - x0, dy = y2 - y1, L = Math.hypot(dx, dy);
    G.add(new THREE.BoxGeometry(0.0016, L + 0.0012, 0.012), M.spoon, (x0 + x1) / 2, (y1 + y2) / 2, 0, 0, 0, Math.atan2(-dx, dy));
  }
  // 안전핀 + 링 (서브 그룹 — 뽑기 애니메이션)
  const pin = G.sub('pin', 0, y0 + 0.014, 0);
  pin.add(new THREE.CylinderGeometry(0.0011, 0.0011, 0.026, 8), M.steel, -0.003, 0, 0, 0, 0, Math.PI / 2);
  pin.add(new THREE.TorusGeometry(0.0115, 0.00115, 8, 28), M.steel, -0.027, -0.004, 0, 0, Math.PI / 2, 0.25);
  return pin;
}

function handAnchor(parent, name, p, X, Y, pose) {
  const o = new THREE.Object3D(); o.name = name; o.position.set(...p);
  const vx = V(...X).normalize(), vy = V(...Y);
  vy.addScaledVector(vx, -vy.dot(vx)).normalize();
  o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(vx, vy, V(0, 0, 0).crossVectors(vx, vy)));
  o.userData.pose = pose;
  parent.add(o);
  return o;
}

function buildFrag() {
  const M = mats(), G = new GB();
  G.add(new THREE.SphereGeometry(0.032, 32, 22), M.od, 0, 0, 0);
  G.add(new THREE.TorusGeometry(0.0321, 0.0007, 6, 48), M.od, 0, -0.002, 0, Math.PI / 2);
  G.add(new THREE.TorusGeometry(0.0297, 0.0011, 6, 48), M.yellow, 0, 0.0125, 0, Math.PI / 2);
  G.add(new THREE.CylinderGeometry(0.0095, 0.011, 0.006, 20), M.od, 0, 0.0305, 0);
  fuse(G, M, 0.032, 0.032, 0);
  return G;
}

function buildSmoke() {
  const M = mats(), G = new GB();
  G.add(new THREE.CylinderGeometry(0.0315, 0.0315, 0.1, 30), M.smk, 0, -0.012, 0);
  G.add(new THREE.CylinderGeometry(0.0318, 0.0318, 0.02, 30), M.white, 0, 0.026, 0);
  G.add(new THREE.CylinderGeometry(0.0275, 0.0315, 0.006, 30), M.smk, 0, 0.039, 0);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; G.add(new THREE.CylinderGeometry(0.0035, 0.0035, 0.002, 10), M.black, Math.cos(a) * 0.019, 0.0421, Math.sin(a) * 0.019); }
  G.add(new THREE.CylinderGeometry(0.0315, 0.029, 0.004, 30), M.smk, 0, -0.064, 0);
  fuse(G, M, 0.042, 0.0315, null);
  return G;
}

function buildC4() {
  const M = mats(), G = new GB();
  const L = 0.125, H = 0.019, W = 0.051;
  G.prof(M.film, [[-L, -H], [L, -H], [L, H], [-L, H]], W, 0, 0.004);
  G.box(M.label, W * 0.8, 0, -0.08, 0.06, H, H + 0.0006);
  for (const f of [-0.1, 0.085]) G.box(M.tape, W + 0.002, 0, f, f + 0.018, -H - 0.001, H + 0.001);
  // 무선 수신기 + 안테나 + LED
  G.box(M.black, 0.034, 0, -0.035, 0.02, H + 0.0006, H + 0.019, 0.004);
  G.box(M.black, 0.03, 0, -0.03, 0.015, H + 0.019, H + 0.022, 0.004);
  G.cylY(M.black, 0.0014, 0.075, 0.012, H + 0.02, 0.016, 8);
  G.add(new THREE.SphereGeometry(0.0022, 10, 8), M.led, -0.008, H + 0.022, 0.03);
  // 뇌관 + 도선
  G.cyl(M.alu, 0.0036, 0.0036, -0.034, -0.012, H + 0.008, -0.012, 12);
  G.cyl(M.wire, 0.0012, 0.0012, -0.012, 0.004, H + 0.008, -0.012, 6);
  G.add(new THREE.TorusGeometry(0.012, 0.0012, 6, 16, Math.PI), M.wire, -0.012, H + 0.008, -0.01, 0, Math.PI / 2, 0);
  return G;
}

function buildDet() {
  const M = mats(), G = new GB();
  G.prof(M.black, [[-0.014, -0.065], [0.014, -0.065], [0.016, 0.03], [0.012, 0.045], [-0.012, 0.045], [-0.016, 0.03]], 0.046, 0, 0.004);
  for (let i = 0; i < 5; i++) G.box(M.tape, 0.047, 0, -0.012, 0.012, -0.055 + i * 0.012, -0.05 + i * 0.012);
  G.cylY(M.black, 0.004, 0.02, 0.006, 0.045, 0.014, 10);
  G.cylY(M.black, 0.0022, 0.085, 0.006, 0.064, 0.014, 8);
  G.cylY(M.red, 0.006, 0.004, -0.004, 0.045, -0.006, 16);
  G.add(new THREE.SphereGeometry(0.0018, 8, 6), M.ledG, -0.008, 0.035, 0.0165);
  const cover = G.sub('cover', 0.004, 0.049, -0.006);
  cover.box(M.red, 0.016, 0, -0.018, 0.0, 0.0, 0.004);
  return G;
}

const BUILD = { frag: buildFrag, smoke: buildSmoke, c4: buildC4, det: buildDet };
const IDLE = {
  frag: { p: [0.1, -0.13, -0.3], r: [0.15, 0.3, -0.1] },
  smoke: { p: [0.1, -0.13, -0.3], r: [0.15, 0.3, -0.1] },
  c4: { p: [0.05, -0.15, -0.32], r: [0.3, 0.95, 0.05] },
  det: { p: [0.085, -0.12, -0.3], r: [0.12, 0.12, -0.05] },
};
const COCK = [[0.3, 0.07, 0.1, 0.14], [-0.55, 0.2, -0.3]];
const CLIPS = {
  draw: { d: 0.45, pos: [[0, 0.02, -0.25, 0.1], [0.45, 0, 0, 0]], rot: [[0, -0.9, 0, 0.3], [0.45, 0, 0, 0]], lh: [[0, 'lrest']] },
  stow: { d: 0.3, pos: [[0, 0, 0, 0], [0.3, 0.02, -0.25, 0.1]], rot: [[0, 0, 0, 0], [0.3, -0.9, 0, 0.3]], lh: [[0, 'lrest']] },
  pin: {
    d: 0.72, pos: [[0, 0, 0, 0], [0.2, -0.05, 0.02, -0.02], [0.52, -0.03, 0.01, 0], [0.72, 0, 0, 0]], rot: [[0, 0, 0, 0], [0.2, 0.1, -0.5, 0.2], [0.52, 0.06, -0.3, 0.1], [0.72, 0, 0, 0]],
    lh: [[0, 'lrest'], [0.22, 'ring'], [0.38, 'ring'], [0.62, 'lrest']], pinOut: [[0.3, 0], [0.5, 1]], pinVis: [[0, 1], [0.58, 1], [0.6, 0]], ev: [[0.32, 'pinpull']],
  },
  ready: { d: 0.3, pos: [[0, 0, 0, 0], COCK[0]], rot: [[0, 0, 0, 0], [0.3, ...COCK[1]]], lh: [[0, 'lrest'], [0.3, 'lpoint']], pinVis: [[0, 0]] },
  throw: {
    d: 0.55, pos: [[0, ...COCK[0].slice(1)], [0.1, 0, 0.06, -0.2], [0.16, -0.06, -0.02, -0.3], [0.55, -0.05, -0.3, -0.05]], rot: [[0, ...COCK[1]], [0.1, 0.5, 0.1, 0.1], [0.16, 0.9, 0, 0.2], [0.55, 0.3, 0, 0.4]],
    lh: [[0, 'lpoint'], [0.2, 'lpoint'], [0.45, 'lrest']], rh: [[0, 'hold'], [0.1, 'hold'], [0.18, 'open']], ev: [[0.11, 'release']], pinVis: [[0, 0]], nadeVis: [[0, 1], [0.11, 1], [0.115, 0]],
  },
  lob: {
    d: 0.6, pos: [[0, ...COCK[0].slice(1)], [0.14, 0.02, -0.22, 0], [0.24, 0, -0.1, -0.25], [0.6, 0, -0.3, -0.1]], rot: [[0, ...COCK[1]], [0.14, -0.6, 0, 0], [0.24, 0.3, 0, 0], [0.6, 0.2, 0, 0]],
    lh: [[0, 'lpoint'], [0.3, 'lrest']], rh: [[0, 'hold'], [0.2, 'hold'], [0.28, 'open']], ev: [[0.21, 'release']], pinVis: [[0, 0]], nadeVis: [[0, 1], [0.21, 1], [0.215, 0]],
  },
  place: {
    d: 0.7, pos: [[0, 0, 0, 0], [0.25, -0.02, -0.06, -0.2], [0.38, -0.02, -0.1, -0.26], [0.7, 0, -0.3, -0.05]], rot: [[0, 0, 0, 0], [0.25, 0.5, 0, 0], [0.38, 0.7, 0, 0], [0.7, 0.2, 0, 0]],
    lh: [[0, 'lrest']], rh: [[0, 'hold'], [0.36, 'hold'], [0.44, 'open']], ev: [[0.37, 'release']], nadeVis: [[0, 1], [0.37, 1], [0.375, 0]],
  },
  press: { d: 0.4, pos: [[0, 0, 0, 0], [0.12, 0, -0.006, -0.012], [0.4, 0, 0, 0]], rot: [[0, 0, 0, 0], [0.12, 0.06, 0, 0], [0.4, 0, 0, 0]], lh: [[0, 'lrest']], cover: [[0, 0], [0.06, 1], [0.34, 1], [0.4, 0]], ev: [[0.12, 'boom']] },
};

export class Explosives {
  constructor(g, W) {
    this.g = g; this.W = W;
    this.count = { frag: 3, smoke: 2, c4: 2 };
    this.kind = null; this.state = null; this.anim = null;
    this.proj = []; this.smokes = []; this.placed = [];
    this.models = {}; this.world = {};
    for (const k of Object.keys(BUILD)) {
      const G = BUILD[k]();
      const grp = G.build();
      grp.visible = false;
      grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      W.root.add(grp);
      const pin = G.subs.find((s) => s.name === 'pin')?.group, cover = G.subs.find((s) => s.name === 'cover')?.group;
      if (pin) pin.name = 'pin'; if (cover) cover.name = 'cover';
      this.models[k] = { group: grp, pin, cover, pin0: pin ? pin.position.clone() : null };
      if (k !== 'det') this.world[k] = G;
    }
    // 손 앵커
    const A = this.anchors = {};
    const m = this.models;
    m.frag.hold = handAnchor(m.frag.group, 'hold', [0.012, -0.004, 0.002], [1, -0.2, 0.3], [0, 0.1, 1], null);
    m.smoke.hold = handAnchor(m.smoke.group, 'hold', [0.014, -0.012, 0.002], [1, -0.1, 0.3], [0, 0.1, 1], null);
    m.c4.hold = handAnchor(m.c4.group, 'hold', [0.0, -0.034, 0.03], [0, -1, 0], [0, 0, -1], null);
    m.det.hold = handAnchor(m.det.group, 'hold', [0.0, -0.02, 0.0], [1, 0, 0], [0, 1, 0.15], null);
    // 실제 모델 단면에 맞춘 파지 (수류탄: 손바닥 전체로 감쌈, 격발기: 권총 쥐듯 + 엄지는 버튼 위)
    for (const [k, rsel, opp] of [['frag', 0.06, 1.0], ['smoke', 0.06, 1.0], ['c4', 0.07, 0.9], ['det', 0.05, 0.3]]) {
      let p = null;
      try { p = solveGrasp(proxyFromMesh(m[k].group, m[k].hold, 'R', { rsel }), { thumbOpp: opp, spread: 0.35 }); } catch (e) { console.warn('grasp', k, e); }
      m[k].hold.userData.pose = p || preset('fist');
    }
    for (const k of ['frag', 'smoke']) m[k].ring = handAnchor(m[k].pin, 'ring', [-0.03, -0.006, 0.008], [1, 0, 0], [0, 0, 1], preset('ring'));
    for (const k of Object.keys(m)) m[k].open = handAnchor(m[k].group, 'open', m[k].hold.position.toArray(), [1, 0, 0.2], [0, 0.4, 1], { ...preset('open'), off: m[k].hold.userData.pose.off });
    A.lrest = W.freeAnchor; W.freeAnchor.userData.pose = preset('relaxed');
    A.lpoint = handAnchor(W.root, 'lpoint', [-0.12, -0.12, -0.5], [0.1, -1, 0], [1, 0, 0], preset('open'));
    this.tmp = [0, 0, 0];
    this.blink = 0;
  }

  label(k) { return INFO[k].name; }
  has(k) { return k === 'c4' ? this.count.c4 > 0 || this.placed.length > 0 : this.count[k] > 0; }
  reset() {
    this.count = { frag: 3, smoke: 2, c4: 2 };
    for (const p of this.proj) this.g.scene.remove(p.mesh);
    this.proj = []; this.smokes = []; this.placed = [];
    this.hide(); this.kind = null; this.state = null;
  }
  refill() { this.count = { frag: 3, smoke: 2, c4: 2 }; if (this.W.item) this.hud(); }

  hide() { for (const k in this.models) this.models[k].group.visible = false; this.anim = null; }

  // 아이템 꺼내기
  begin(k) {
    this.qL = false;
    if (k === 'c4' && this.count.c4 === 0 && this.placed.length) k = 'det';
    this.hide();
    this.kind = k; this.state = 'draw';
    const md = this.models[k];
    md.group.visible = true;
    if (md.pin) { md.pin.visible = true; md.pin.position.copy(md.pin0); }
    this.anchors.hold = md.hold; this.anchors.open = md.open; this.anchors.ring = md.ring;
    this.play('draw');
    Audio.play('cloth', { vol: 0.35 });
    this.hud();
    if (this.g.hud && this.lastHint !== k) { this.lastHint = k; this.g.hud.message(`<small>${INFO[k].hint}</small>`, 2.4); }
  }
  stow(done) {
    if (this.state === 'stow') return;
    if (this.state === 'ready' || this.state === 'pin') { // 핀 뽑은 상태로 교체 불가 → 그냥 던짐
      this.pendingThrow = true; return;
    }
    this.state = 'stow'; this.play('stow', () => { this.hide(); done(); });
  }
  play(name, onEnd) { this.anim = { name, clip: CLIPS[name], t: 0, fired: new Set(), onEnd }; }

  hud() {
    const H = this.g.hud; if (!H) return;
    const k = this.kind, I = INFO[k];
    H.el.wname.textContent = I.name; H.el.wcal.textContent = I.sub; H.el.wmode.textContent = I.mode;
    H.el.ammo.textContent = k === 'det' ? this.placed.length : this.count[k];
    H.el.res.textContent = k === 'det' ? '설치됨' : '';
    H.el.ammo.classList.remove('low'); H.el.rounds.innerHTML = ''; H.el.lowAmmo.style.opacity = 0; H._rn = -1;
    H.buildSlots();
    [...H.el.slots.children].forEach((c, i) => c.classList.toggle('on', i === SLOT[k]));
    H.el.slots.classList.add('show'); H.slotT = 2.5;
  }

  // ── 뷰모델 갱신 ──
  update(dt, input) {
    const W = this.W, k = this.kind;
    // 상태 전이
    if (this.anim) {
      const an = this.anim; an.t += dt;
      for (const [t, e] of an.clip.ev || []) if (an.t >= t && !an.fired.has(e)) { an.fired.add(e); this.event(e, input); }
      if (an.t >= an.clip.d) { this.anim = null; an.onEnd?.(); }
    }
    let lmbP = input.mousePressed(0);
    const rmbP = input.mousePressed(2);
    const st = this.state;
    if (st === 'draw') { if (lmbP) this.qL = true; if (!this.anim) this.state = 'idle'; }
    if (st === 'idle' && this.qL) { lmbP = true; this.qL = false; }
    if (st === 'idle') {
      if (k === 'frag' || k === 'smoke') { if (lmbP || this.pendingThrow) { this.state = 'pin'; this.play('pin', () => { this.state = 'ready'; this.play('ready'); }); } }
      else if (k === 'c4') { if (lmbP) { this.state = 'place'; this.play('place', () => this.after()); } else if (rmbP && this.placed.length) this.swapTo('det'); }
      else if (k === 'det') { if (lmbP && this.placed.length) { this.state = 'press'; this.play('press', () => this.after()); } else if (rmbP && this.count.c4 > 0) this.swapTo('c4'); }
    } else if (st === 'ready') {
      if ((!input.mouse[0] || this.pendingThrow) && !this.anim) {
        this.pendingThrow = false;
        this.lob = !!input.mouse[2];
        this.state = 'throw'; this.play(this.lob ? 'lob' : 'throw', () => this.after());
      }
    }
    this.pose(dt, input);
  }

  swapTo(k) { this.state = 'stow'; this.play('stow', () => this.begin(k)); }

  after() {
    const k = this.kind, W = this.W;
    if (this.g.mode === 'training') for (const x of ['frag', 'smoke', 'c4']) if (this.count[x] === 0 && (x !== 'c4' || !this.placed.length)) this.count[x] = INFO[x].max;
    if (k === 'c4') { this.begin('det'); return; }
    if (k === 'det') { if (this.count.c4 > 0) this.begin('c4'); else this.W.fromItem(W.slot); return; }
    if (this.count[k] > 0) this.begin(k); else W.fromItem(W.slot);
  }

  event(e) {
    const g = this.g, k = this.kind;
    if (e === 'pinpull') { Audio.play('pin', { vol: 0.7 }); }
    else if (e === 'release') {
      this.count[k]--;
      const md = this.models[k];
      md.group.updateMatrixWorld(true);
      // 뷰모델 위치 → 월드 위치 (뷰모델 카메라 공간 = 월드 카메라 공간)
      const lp = V(0, 0, 0).applyMatrix4(md.group.matrix);
      const cam = g.camera, p = lp.clone().applyQuaternion(cam.quaternion).add(cam.position);
      const fwd = V(0, 0, -1).applyQuaternion(cam.quaternion);
      // 손이 벽을 관통하지 않도록 눈 → 손 경로 검사
      const toP = p.clone().sub(cam.position), dl = toP.length();
      const wh = g.world.raycast(cam.position, toP.clone().normalize(), dl + 0.05, { solid: true });
      if (wh) p.copy(cam.position).addScaledVector(toP.normalize(), Math.max(0, wh.t - 0.08));
      let v;
      if (k === 'c4') v = fwd.clone().multiplyScalar(6).add(V(0, 1.2, 0));
      else if (this.lob) v = fwd.clone().multiplyScalar(8.5).add(V(0, 3.2, 0));
      else v = fwd.clone().multiplyScalar(17).add(V(0, 2.6, 0));
      v.addScaledVector(g.player.vel, 0.8);
      this.spawn(k, p, v, md.group.getWorldQuaternion(new THREE.Quaternion()));
      Audio.play(k === 'c4' ? 'cloth' : 'spoon', { vol: 0.6 });
      Audio.play('cloth', { vol: 0.4, rate: 1.3 });
      this.hud();
    } else if (e === 'boom') {
      Audio.play('clicker', { vol: 0.8 });
      const L = this.placed.slice(); this.placed = [];
      L.forEach((pr, i) => setTimeout(() => this.detonate(pr), 60 + i * 90));
      this.hud();
    }
  }

  pose(dt, input) {
    const W = this.W, k = this.kind, md = this.models[k], A = this.anim, tmp = this.tmp;
    const id = IDLE[k];
    const pos = V(...id.p), rot = V(...id.r);
    W.motion(pos, rot, 0, dt, input);
    const c = A?.clip;
    if (A) {
      if (sampleKeys(c.pos, A.t, tmp)) { pos.x += tmp[0]; pos.y += tmp[1]; pos.z += tmp[2]; }
      if (sampleKeys(c.rot, A.t, tmp)) { rot.x += tmp[0]; rot.y += tmp[1]; rot.z += tmp[2]; }
    } else if (this.state === 'ready') { pos.add(V(...COCK[0].slice(1))); rot.add(V(...COCK[1])); }
    md.group.position.copy(pos);
    md.group.rotation.set(rot.x, rot.y, rot.z, 'YXZ');
    const trk = (n) => (A && c[n] ? sampleKeys(c[n], A.t, tmp)[0] : null);
    if (md.pin) {
      const o = trk('pinOut') ?? (this.state === 'ready' || this.state === 'throw' ? 1 : 0);
      md.pin.position.copy(md.pin0).add(V(-0.1 * o, 0.035 * o, 0.02 * o));
      const pv = trk('pinVis'); md.pin.visible = pv == null ? !(this.state === 'ready' || this.state === 'throw') : pv > 0.5;
    }
    const nv = trk('nadeVis'); md.group.visible = nv == null ? true : nv > 0.5;
    if (md.cover) md.cover.rotation.x = -(trk('cover') ?? 0) * 1.9;
    const L = A && c.lh ? sampleAnchor(c.lh, A.t) : { a: this.state === 'ready' ? 'lpoint' : 'lrest', b: 'lrest', u: 0 };
    const R = A && c.rh ? sampleAnchor(c.rh, A.t) : { a: 'hold', b: 'hold', u: 0 };
    W.ikArms(L, R);
    // C4 LED 깜빡임
    this.blink += dt;
    mats().led.emissiveIntensity = this.placed.length && (this.blink % 1) < 0.12 ? 3 : 0;
  }

  // ── 월드: 투척물 물리 ──
  spawn(kind, p, v, q) {
    const mesh = this.world[kind].group.clone();
    mesh.visible = true; mesh.position.copy(p); mesh.quaternion.copy(q);
    mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    for (const s of mesh.children) if (s.name === 'pin' || s.name === 'cover') s.visible = false;
    this.g.scene.add(mesh);
    const pr = { kind, mesh, p: p.clone(), v: v.clone(), w: V(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(8, 16)), t: 0, rest: false, stuck: false, r: kind === 'c4' ? 0.02 : 0.033, lastHit: 0 };
    if (kind === 'frag') pr.fuse = 4.0;
    if (kind === 'smoke') { pr.fuse = 1.6; pr.emit = 0; }
    this.proj.push(pr);
    return pr;
  }

  updateWorld(dt) {
    const g = this.g, W = g.world;
    const d = new THREE.Vector3(), q = new THREE.Quaternion();
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const pr = this.proj[i];
      pr.t += dt;
      if (!pr.rest && !pr.stuck) {
        const n = Math.max(1, Math.ceil(dt / (1 / 120)));
        const h = dt / n;
        for (let s = 0; s < n && !pr.rest && !pr.stuck; s++) {
          pr.v.y -= 9.81 * h;
          pr.v.multiplyScalar(1 - 0.015 * h);
          const L = pr.v.length() * h;
          if (L < 1e-6) continue;
          d.copy(pr.v).normalize();
          const hit = W.raycast(pr.p, d, L + pr.r, { solid: true });
          if (hit) {
            pr.p.copy(hit.point).addScaledVector(hit.n, pr.r);
            if (pr.kind === 'c4') { this.stick(pr, hit); break; }
            const vn = pr.v.dot(hit.n);
            if (vn < 0) {
              pr.v.addScaledVector(hit.n, -vn); // 접선 성분만 남김
              if (-vn > 0.8) { // 충돌: 반발 + 마찰 + 무작위 회전
                pr.v.multiplyScalar(0.72).addScaledVector(hit.n, -vn * (pr.kind === 'frag' ? 0.32 : 0.24));
                pr.w.multiplyScalar(0.5).add(V(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(-vn * 2.5));
              } else { // 굴림
                pr.v.multiplyScalar(Math.exp(-(pr.kind === 'frag' ? 1.6 : 3.5) * h));
                pr.w.crossVectors(hit.n, pr.v).divideScalar(pr.r);
              }
              if (-vn > 1.1 && pr.t - pr.lastHit > 0.08) {
                pr.lastHit = pr.t;
                Audio.play3D(hit.surf === 'metal' ? 'nadeMetal' : 'nadeBounce', pr.p, { vol: clamp(-vn / 6, 0.2, 1), ref: 5 });
              }
              if (hit.n.y > 0.6 && pr.v.length() < 0.06) { pr.w.set(0, 0, 0); pr.rest = true; pr.v.set(0, 0, 0); pr.p.y = hit.point.y + pr.r * (pr.kind === 'smoke' ? 0.95 : 1); }
            }
          } else pr.p.addScaledVector(pr.v, h);
        }
        // 굴러가는 회전
        const sp = pr.w.length();
        if (sp > 1e-3) { q.setFromAxisAngle(d.copy(pr.w).divideScalar(sp), sp * dt); pr.mesh.quaternion.premultiply(q); }
        pr.mesh.position.copy(pr.p);
      }
      // 신관
      if (pr.fuse != null && pr.t >= pr.fuse) {
        if (pr.kind === 'frag') { this.detonate(pr); continue; }
        if (pr.kind === 'smoke') this.emitSmoke(pr, dt);
      }
      if (pr.kind === 'smoke' && pr.emit > 26) { g.scene.remove(pr.mesh); this.proj.splice(i, 1); }
    }
  }

  stick(pr, hit) {
    pr.stuck = true; pr.v.set(0, 0, 0);
    pr.p.copy(hit.point).addScaledVector(hit.n, 0.019);
    pr.mesh.position.copy(pr.p);
    // 블록 밑면(-y)을 표면에 붙이고 진행 방향으로 정렬
    const up = hit.n.clone(), fwd = V(0, 0, -1).applyQuaternion(this.g.camera.quaternion);
    fwd.addScaledVector(up, -fwd.dot(up)); if (fwd.lengthSq() < 1e-4) fwd.set(1, 0, 0); fwd.normalize();
    const x = V(0, 0, 0).crossVectors(up, fwd).negate();
    pr.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, fwd.negate()));
    this.placed.push(pr);
    Audio.play3D('c4stick', pr.p, { vol: 0.9, ref: 4 });
    setTimeout(() => Audio.play3D('beep', pr.p, { vol: 0.6, ref: 3 }), 350);
    if (this.W.item) this.hud();
  }

  emitSmoke(pr, dt) {
    const fx = this.g.fx;
    const age = pr.t - pr.fuse;
    if (pr.emit === 0) { Audio.play3D('smokePop', pr.p, { vol: 1, ref: 6 }); Audio.play3D('hiss', pr.p, { vol: 0.9, ref: 6 }); pr.hiss = 1; }
    if (age > pr.hiss * 11 && age < 22) { pr.hiss++; Audio.play3D('hiss', pr.p, { vol: 0.7, ref: 6 }); }
    pr.emit += dt;
    if (age > 24) return;
    const rate = age < 2 ? 26 : age < 18 ? 16 : 16 * (1 - (age - 18) / 6);
    pr.acc = (pr.acc || 0) + rate * dt;
    const wd = WIND.dir.value, wv = V(wd.x, 0, wd.z).normalize().multiplyScalar(0.35 + WIND.strength.value * 0.9);
    const base = pr.p.clone().add(V(0, 0.05, 0));
    while (pr.acc >= 1) {
      pr.acc -= 1;
      const jet = age < 2.5;
      const v = V(rand(-0.4, 0.4), jet ? rand(1.2, 2.4) : rand(0.25, 0.7), rand(-0.4, 0.4)).add(wv);
      const c = rand(0.54, 0.66);
      fx.alpha.add(base, v, { life: rand(9, 14), size: jet ? rand(0.5, 0.9) : rand(0.9, 1.6), grow: rand(0.35, 0.6), drag: 0.08, grav: -0.02, color: [c, c * 1.01, c * 0.98], alpha: rand(0.55, 0.75), spin: 0.25, fadeIn: 0.6 });
    }
  }

  detonate(pr) {
    const g = this.g, fx = g.fx, p = pr.p.clone();
    g.scene.remove(pr.mesh);
    const i = this.proj.indexOf(pr); if (i >= 0) this.proj.splice(i, 1);
    const big = pr.kind === 'c4';
    const R = big ? 9 : 5.5, dmg = big ? 180 : 130;
    // 섬광 + 화구 (짧음) + 흙먼지 + 파편 불꽃 + 연기
    fx.flashLight(p.clone().add(V(0, 0.6, 0)), big ? 1400 : 700, big ? 0.35 : 0.18, big ? 36 : 22, 0xffb070);
    for (let k = 0; k < (big ? 36 : 14); k++) {
      const v = V(rand(-1, 1), rand(0.1, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(3, big ? 12 : 8));
      fx.add.add(p.clone().add(V(rand(-0.2, 0.2), rand(0, 0.3), rand(-0.2, 0.2))), v, { life: rand(0.12, big ? 0.45 : 0.25), size: rand(0.4, big ? 1.4 : 0.8), grow: 3, drag: 6, color: [7, rand(3, 4), 1.2], alpha: 1, spin: 2 });
    }
    const ground = g.world.groundSurf(p.x, p.z) === 'dirt' ? [0.3, 0.25, 0.18] : [0.36, 0.34, 0.31];
    for (let k = 0; k < (big ? 60 : 34); k++) {
      const v = V(rand(-1, 1), rand(0.2, 1.6), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, big ? 9 : 6));
      const c = rand(0.8, 1.15);
      fx.alpha.add(p.clone().add(V(0, 0.2, 0)), v, { life: rand(2.5, big ? 8 : 5), size: rand(0.5, big ? 2 : 1.2), grow: big ? 1.4 : 0.9, drag: 2.2, grav: -0.25, color: [ground[0] * c, ground[1] * c, ground[2] * c], alpha: 0.85, spin: 0.5, fadeIn: 0.05 });
    }
    for (let k = 0; k < (big ? 110 : 80); k++) fx.add.add(p, V(rand(-1, 1), rand(-0.1, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(12, 40)), { life: rand(0.15, 0.5), size: rand(0.015, 0.03), grav: 9.8, drag: 0.8, color: [9, 5, 1.6] });
    for (let k = 0; k < (big ? 60 : 30); k++) fx.dots.add(p, V(rand(-1, 1), rand(0.4, 1.6), rand(-1, 1)).normalize().multiplyScalar(rand(3, 12)), { life: rand(1, 2.2), size: rand(0.02, 0.06), grav: 9.8, drag: 0.4, color: [0.07, 0.06, 0.05] });
    fx.decals.scorch.add(V(p.x, Math.max(0.012, p.y - 0.2), p.z), V(0, 1, 0), big ? rand(3.5, 4.5) : rand(1.6, 2.4));
    Audio.play3D(big ? 'explosion' : 'frag', p, { vol: big ? 3 : 2.4, ref: 10 });
    // 피해·반응
    const P = g.player, dp = P.eye.distanceTo(p);
    if (dp < R && g.world.los(p.clone().add(V(0, 0.3, 0)), P.eye)) P.damage(dmg * Math.pow(1 - dp / R, 1.4), p, 'explosion');
    const k2 = clamp(1 - dp / (big ? 45 : 30), 0, 1);
    P.shake = Math.min(1.3, P.shake + k2 * (big ? 1.6 : 1.1));
    g.flashWhite = Math.max(g.flashWhite || 0, k2 * (big ? 0.35 : 0.2));
    if (k2 > 0.55) Audio.deafen(0.8 * k2, 2.2);
    g.squad.react(p, big ? 30 : 22, big ? 1.5 : 1.1);
    for (const o of g.world.barrels) if (!o.exploded && o.pos.distanceTo(p) < (big ? 6 : 3.5)) setTimeout(() => g.explode(o), 80 + Math.random() * 150);
    for (const c of g.world.glass) if (!c.disabled && c.glass.position.distanceTo(p) < (big ? 14 : 8)) fx.glassBreak(c, c.glass.position, c.glass.position.clone().sub(p).normalize());
    g.onBlast?.(p, R);
  }
}
