// GameAudio — 완전 합성 WebAudio 사운드 엔진 (오디오 파일 없음)
//  연속 레이어: 바람(스테레오 돌풍) · 하울링 · 저역 버핏/지면 러시 · 부스트 추력 · 증기 원뿔 히스 · 플라즈마 불꽃 굉음
//  원샷: jump, takeoff, land, heroLand, roll, flip, boost, sonicBoom, brake, step, dash
//  체인: sfx/amb → pre → DynamicsCompressor → 소프트 클리퍼 → master(음소거) → destination  (+ 공용 야외 리버브 센드)
//  AudioContext 가 없거나 막혀 있어도 절대 throw 하지 않는다.

const MAX_VOICES = 16;          // 동시 원샷 보이스 상한
const UPDATE_DT = 1 / 60;       // 연속 파라미터 갱신 주기 (오토메이션 이벤트 수 제한)

// 원샷별 [최소 재생 간격(s), 같은 이름 최대 동시 수, 우선순위(높을수록 보존)]
const RULES = {
  step: [0.045, 3, 0],
  jump: [0.06, 2, 2],
  land: [0.06, 2, 2],
  dash: [0.05, 2, 2],
  roll: [0.08, 2, 2],
  flip: [0.08, 2, 2],
  brake: [0.12, 2, 3],
  takeoff: [0.12, 2, 3],
  boost: [0.1, 2, 3],
  heroLand: [0.2, 2, 5],
  sonicBoom: [0.25, 2, 5],
  slash: [0.05, 3, 3],
  clang: [0.05, 3, 3],
  charge: [0.3, 1, 3],
  beam: [0.2, 2, 5],
  splash: [0.1, 3, 3],
};

// 원샷 출력 레벨 (튜닝용)
const LEVEL = {
  step: 1, jump: 1, land: 1, dash: 1, roll: 1, flip: 1, brake: 1,
  takeoff: 1, boost: 1, heroLand: 1, sonicBoom: 1, slash: 1, clang: 0.8, charge: 0.8, beam: 1, splash: 1,
};

// 연속 레이어 믹스 (튜닝용)
const MIX = {
  ambient: 0.05,    // 정지 상태의 잔잔한 야외 바람
  wind: 1.0,        // 속도 바람
  howl: 1.0,        // 공명 하울링
  rumble: 1.0,      // 저역 버핏 / 지면 러시
  thrust: 1.0,      // 부스트 유지 추력
  vapor: 1.0,       // 증기 원뿔 히스
  fire: 1.0,        // 플라즈마 굉음
};

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const num = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);

// 값 노이즈 (돌풍/깜빡임 변조용, 할당 없음) → 0..1
const VN = new Float32Array(256);
for (let i = 0; i < 256; i++) VN[i] = Math.random();
function vnoise(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const a = VN[i & 255], b = VN[(i + 1) & 255];
  return a + (b - a) * u;
}
function fbm(x) { return vnoise(x) * 0.62 + vnoise(x * 2.17 + 31.7) * 0.38; }

// ───────────────────────── 버퍼/커브 생성 (초기화 때 한 번) ─────────────────────────

function genNoise(kind, out) {
  const n = out.length;
  if (kind === 'white') {
    for (let i = 0; i < n; i++) out[i] = Math.random() * 2 - 1;
  } else if (kind === 'pink') {
    // Paul Kellet 정밀 핑크 필터
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  } else {
    // 브라운(레드) 노이즈: 누설 적분기, 꺾임 ~110 Hz (초저역 낭비 없음)
    let b = 0;
    for (let i = 0; i < n; i++) { b = 0.985 * b + (Math.random() * 2 - 1) * 0.15; out[i] = b; }
  }
  // DC 제거
  let m = 0;
  for (let i = 0; i < n; i++) m += out[i];
  m /= n;
  for (let i = 0; i < n; i++) out[i] -= m;
}

// 스테레오(채널 독립) 루프 노이즈, RMS 정규화, 루프 지점 크로스페이드
function noiseBuf(ctx, kind, sec, rms) {
  const sr = ctx.sampleRate, n = Math.floor(sr * sec), F = Math.floor(sr * 0.06);
  const buf = ctx.createBuffer(2, n, sr);
  const tmp = new Float32Array(n + F);
  for (let ch = 0; ch < 2; ch++) {
    genNoise(kind, tmp);
    let ss = 0;
    for (let i = 0; i < tmp.length; i++) ss += tmp[i] * tmp[i];
    const k = rms / Math.sqrt(ss / tmp.length);
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = tmp[i] * k;
    for (let i = 0; i < F; i++) {
      const w = (i / F) * Math.PI * 0.5;
      d[i] = (tmp[i] * Math.sin(w) + tmp[n + i] * Math.cos(w)) * k;
    }
    for (let i = 0; i < n; i++) d[i] = clamp(d[i], -1, 1);
  }
  return buf;
}

// 불꽃 탁탁 튀는 소리: 희소한 감쇠 임펄스 (루프 경계는 감싸서 끊김 없음)
function crackleBuf(ctx, sec) {
  const sr = ctx.sampleRate, n = Math.floor(sr * sec);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let t = 0;
    while (true) {
      t += (-Math.log(1 - Math.random()) * sr) / 110;
      if (t >= n) break;
      const big = Math.random() < 0.09;
      const r = Math.random();
      const A = (big ? 0.55 + 0.45 * r : 0.04 + 0.5 * r * r) * (Math.random() < 0.5 ? -1 : 1);
      const len = Math.floor(sr * (big ? 0.004 + 0.007 * Math.random() : 0.0005 + 0.0025 * Math.random()));
      const tau = len / 4.5;
      let lp = 0;
      const a = big ? 0.25 : 0.85;
      const t0 = Math.floor(t);
      for (let k = 0; k < len; k++) {
        lp += a * (Math.random() * 2 - 1 - lp);
        d[(t0 + k) % n] += A * Math.exp(-k / tau) * lp;
      }
    }
    let pk = 1e-6;
    for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(d[i]));
    for (let i = 0; i < n; i++) d[i] *= 0.95 / pk;
  }
  return buf;
}

// 파편: 작은 돌/조각이 튀며 여러 번 통통 튀는 소리 (공진기 + 바운스 간격 감소)
function debrisBuf(ctx, sec) {
  const sr = ctx.sampleRate, n = Math.floor(sr * sec);
  const buf = ctx.createBuffer(2, n, sr);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const ring = Math.floor(sr * 0.045);
  for (let p = 0; p < 18; p++) {
    const chunk = p < 5;
    const f = chunk ? rand(450, 1100) : rand(1500, 5600);
    const rr = chunk ? 0.988 : rand(0.990, 0.995);
    const w = (2 * Math.PI * f) / sr, c1 = 2 * rr * Math.cos(w), c2 = -rr * rr;
    const pan = rand(-1, 1), gl = Math.sqrt((1 - pan) * 0.5), gr = Math.sqrt((1 + pan) * 0.5);
    let t = rand(0.06, 0.5), A = rand(0.35, 1) * (chunk ? 1 : 0.6), gap = rand(0.09, 0.24);
    const bounces = 2 + Math.floor(Math.random() * 4);
    for (let b = 0; b < bounces && t < sec - 0.06; b++) {
      const t0 = Math.floor(t * sr);
      let y1 = 0, y2 = 0;
      const ex = Math.floor(sr * 0.0012);
      for (let k = 0; k < ring && t0 + k < n; k++) {
        const x = k < ex ? (Math.random() * 2 - 1) * (1 - k / ex) : 0;
        const y = c1 * y1 + c2 * y2 + x;
        y2 = y1; y1 = y;
        const s = y * A * (1 - rr) * 2.2 * (k > ring - 200 ? (ring - k) / 200 : 1);
        L[t0 + k] += s * gl;
        R[t0 + k] += s * gr;
      }
      t += gap;
      gap *= rand(0.55, 0.72);
      A *= rand(0.42, 0.62);
    }
  }
  // 자잘한 자갈 쏴아 (감쇠하는 노이즈)
  let lpL = 0, lpR = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / sr;
    const env = tt < 0.04 ? tt / 0.04 : Math.exp(-(tt - 0.04) / 0.35);
    lpL += 0.6 * (Math.random() * 2 - 1 - lpL);
    lpR += 0.6 * (Math.random() * 2 - 1 - lpR);
    L[i] += lpL * env * 0.035;
    R[i] += lpR * env * 0.035;
  }
  let pk = 1e-6;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const fadeN = Math.floor(sr * 0.08);
  for (let i = 0; i < n; i++) {
    const fo = i > n - fadeN ? (n - i) / fadeN : 1;
    L[i] *= (0.9 / pk) * fo;
    R[i] *= (0.9 / pk) * fo;
  }
  return buf;
}

// 소닉붐 N-파: 급격한 압력 상승 → 선형 감소 → 급격한 복귀 (두 번의 '쾅-쾅' 크랙, 약 86 ms 간격)
// + 지면 반사(좌우 지연 다름) + 충격면 크랙 노이즈 + 초저역 제거
function nwaveBuf(ctx) {
  const sr = ctx.sampleRate, dur = 0.42, n = Math.floor(sr * dur);
  const buf = ctx.createBuffer(2, n, sr);
  const T = 0.086, r1 = 0.00028, r2 = 0.00045, off = 0.004;
  const sm = (x) => x * x * (3 - 2 * x);
  const shape = (tt) => {
    if (tt <= 0) return 0;
    if (tt < r1) return sm(tt / r1);
    if (tt < T) return 1 - (2 * (tt - r1)) / (T - r1);
    if (tt < T + r2) return -1 + sm((tt - T) / r2);
    return 0;
  };
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const rd = ch ? 0.0127 : 0.0093;   // 지면 반사 지연 (좌우 다르게 → 넓은 공간감)
    const shocks = [off, off + T, off + rd, off + T + rd];
    const camp = [0.42, 0.36, 0.2, 0.17];
    let lpR = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const refl = shape(t - off - rd);
      lpR += 0.35 * (refl - lpR);           // 반사는 살짝 둔하게
      let v = shape(t - off) + 0.55 * lpR;
      for (let k = 0; k < 4; k++) {
        const dt = t - shocks[k];
        if (dt > 0 && dt < 0.03) v += (Math.random() * 2 - 1) * camp[k] * Math.exp(-dt / 0.0032);
      }
      d[i] = v;
    }
    // 1차 LPF ~12 kHz (디지털 날카로움 완화) + 1차 HPF ~28 Hz (초저역 압력 성분 제거)
    let lp = 0, hpX = 0, hpY = 0;
    const aL = 1 - Math.exp((-2 * Math.PI * 12000) / sr), aH = Math.exp((-2 * Math.PI * 28) / sr);
    let pk = 1e-6;
    for (let i = 0; i < n; i++) {
      lp += aL * (d[i] - lp);
      hpY = aH * (hpY + lp - hpX);
      hpX = lp;
      d[i] = hpY;
      pk = Math.max(pk, Math.abs(hpY));
    }
    const fadeN = Math.floor(sr * 0.05);
    for (let i = 0; i < n; i++) d[i] *= (0.95 / pk) * (i > n - fadeN ? (n - i) / fadeN : 1);
  }
  return buf;
}

// 야외 리버브 IR: 지면/먼 지형 반사 + 시간이 갈수록 어두워지는 확산 꼬리
function irBuf(ctx, sec) {
  const sr = ctx.sampleRate, n = Math.floor(sr * sec);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    const pre = 0.014;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if (t < pre) continue;
      const tt = t - pre;
      const env = 0.5 * Math.exp(-tt / 0.2) + 0.5 * Math.exp(-tt / 0.8);
      const a = 0.7 - 0.62 * Math.min(1, tt / 1.8);
      lp += a * (Math.random() * 2 - 1 - lp);
      d[i] = lp * env * (t > sec - 0.15 ? (sec - t) / 0.15 : 1);
    }
    const taps = ch ? [[0.021, 0.55], [0.052, -0.3], [0.083, 0.22], [0.131, -0.16], [0.24, 0.12]]
      : [[0.018, 0.55], [0.047, -0.32], [0.091, 0.2], [0.122, -0.17], [0.27, 0.11]];
    for (const [tt, g] of taps) {
      const i0 = Math.floor(tt * sr);
      for (let k = 0; k < 24; k++) d[i0 + k] += g * Math.exp(-k / 6) * (k === 0 ? 1 : 0.5);
    }
  }
  return buf;
}

let _tanh3 = null, _crunch = null, _clip = null;
function shaperCurves() {
  if (_tanh3) return;
  const N = 2048;
  _tanh3 = new Float32Array(N);
  _crunch = new Float32Array(N);
  _clip = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1;
    _tanh3[i] = Math.tanh(3 * x) / Math.tanh(3);
    // 비대칭 크런치 (짝수 배음으로 거친 질감)
    const y = Math.tanh(5 * x + 0.6 * x * x) ;
    _crunch[i] = y / Math.tanh(5.6);
    // 소프트 클리퍼: 앞단 0.5배 → 입력 u = 2x, 0.7 까지 선형, 그 위로 부드럽게 0.98 에 수렴
    const u = 2 * x, au = Math.abs(u);
    _clip[i] = au < 0.7 ? u : Math.sign(u) * (0.7 + 0.28 * Math.tanh((au - 0.7) / 0.28));
  }
}

// ───────────────────────── 엔진 ─────────────────────────

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.volume = 0.9;
    this._muted = false;
    this._dead = false;           // AudioContext 사용 불가 → 모든 호출 무시
    this._offline = false;
    this._voices = [];
    this._last = Object.create(null);
    this._acc = UPDATE_DT;
    this._gustPh = Math.random() * 100;
    this._gustRate = 0.3;
    this._flickPh = Math.random() * 100;
    this._B = null;               // 미리 만든 버퍼
    this._L = null;               // 연속 레이어 노드
    this._P = null;               // 연속 레이어 파라미터 래퍼
    this.master = null;
    this._onGesture = this._onGesture.bind(this);
    this._onVis = this._onVis.bind(this);
  }

  get muted() { return this._muted; }
  set muted(v) {
    this._muted = !!v;
    if (!this.ctx || !this.master) return;
    try {
      const now = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(this._muted ? 0 : this.volume, now, 0.03);
      if (this._muted) this._killAll(now);
    } catch (e) { /* noop */ }
  }

  // 첫 사용자 제스처에서 호출 (여러 번 호출해도 안전)
  unlock() {
    if (this._dead) return;
    try {
      if (!this.ctx) {
        const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
        if (!AC) { this._dead = true; return; }
        let ctx;
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
        this._init(ctx);
        // iOS: 제스처 안에서 무음 버퍼를 한 번 재생해야 출력이 열린다
        const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource();
        s.buffer = b; s.connect(ctx.destination); s.start(0);
        window.addEventListener('pointerdown', this._onGesture, { passive: true });
        window.addEventListener('touchend', this._onGesture, { passive: true });
        window.addEventListener('keydown', this._onGesture, { passive: true });
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._onVis);
      }
      this._resume();
    } catch (e) {
      this._dead = true;
      try { if (this.ctx && this.ctx.close) this.ctx.close(); } catch (_) { /* noop */ }
      this.ctx = null; this._L = null; this._P = null; this.master = null;
    }
  }

  _resume() {
    const c = this.ctx;
    if (!c || this._offline || c.state === 'running' || c.state === 'closed') return;
    if (typeof document !== 'undefined' && document.hidden) return;
    try { const p = c.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* noop */ }
  }
  _onGesture() { this._resume(); }
  _onVis() {
    const c = this.ctx;
    if (!c || this._offline) return;
    try {
      // 탭이 가려지면 일시정지 (게임 루프가 멈춘 채 굉음이 계속 나지 않도록)
      if (document.hidden) { if (c.state === 'running') { const p = c.suspend(); if (p && p.catch) p.catch(() => {}); } }
      else this._resume();
    } catch (e) { /* noop */ }
  }

  _ready() {
    const c = this.ctx;
    return !!(this._L && !this._muted && (this._offline || c.state === 'running'));
  }

  // 그래프 생성. ctx 는 AudioContext 또는 (테스트용) OfflineAudioContext
  _init(ctx) {
    this.ctx = ctx;
    this._offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    shaperCurves();
    this._B = {
      white: noiseBuf(ctx, 'white', 2.0, 0.3),
      pink: noiseBuf(ctx, 'pink', 3.0, 0.25),
      brown: noiseBuf(ctx, 'brown', 3.0, 0.25),
      crackle: crackleBuf(ctx, 2.5),
      debris: debrisBuf(ctx, 1.8),
      nwave: nwaveBuf(ctx),
      ir: irBuf(ctx, 2.4),
    };

    // 마스터 체인
    const pre = ctx.createGain(); pre.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 9;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.22;
    const drive = ctx.createGain(); drive.gain.value = 0.5;
    const clip = ctx.createWaveShaper(); clip.curve = _clip; clip.oversample = '2x';
    const master = ctx.createGain(); master.gain.value = this._muted ? 0 : this.volume;
    pre.connect(comp); comp.connect(drive); drive.connect(clip); clip.connect(master); master.connect(ctx.destination);
    this.pre = pre; this.comp = comp; this.master = master;

    this.sfx = ctx.createGain(); this.sfx.connect(pre);
    this.amb = ctx.createGain(); this.amb.connect(pre);

    // 공용 리버브 (큰 소리만 센드)
    const rev = ctx.createConvolver(); rev.buffer = this._B.ir;
    this.revIn = ctx.createGain();
    const revOut = ctx.createGain(); revOut.gain.value = 0.5;
    this.revIn.connect(rev); rev.connect(revOut); revOut.connect(pre);

    this._buildLayers();
  }

  _buildLayers() {
    const c = this.ctx, B = this._B, amb = this.amb;
    const L = this._L = {};
    const loop = (buf, rate) => {
      const s = c.createBufferSource();
      s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
      s.start(0, Math.random() * buf.duration * 0.95);
      return s;
    };
    const bq = (type, f, q, g) => {
      const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q;
      if (g !== undefined) b.gain.value = g;
      return b;
    };
    const gn = (v) => { const g = c.createGain(); g.gain.value = v; return g; };
    const osc = (type, f) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.start(0); return o; };

    const pinkA = loop(B.pink, 1), pinkB = loop(B.pink, 0.87), brown = loop(B.brown, 1);
    const white = loop(B.white, 1), crackle = loop(B.crackle, 1);

    // 1) 바람: 핑크 → BP → LP → 좌/우 독립 돌풍 게인
    L.windBP = bq('bandpass', 300, 0.55);
    L.windLP = bq('lowpass', 800, 0.5);
    const split = c.createChannelSplitter(2), merge = c.createChannelMerger(2);
    L.windL = gn(0); L.windR = gn(0);
    pinkA.connect(L.windBP); L.windBP.connect(L.windLP); L.windLP.connect(split);
    split.connect(L.windL, 0); split.connect(L.windR, 1);
    L.windL.connect(merge, 0, 0); L.windR.connect(merge, 0, 1);
    merge.connect(amb);

    // 2) 하울링: 좁은 공명 두 개 (휘파람 같은 바람 소리)
    L.howlBP = bq('bandpass', 700, 6);
    L.howlBP2 = bq('bandpass', 1030, 9);
    L.howl = gn(0); L.howl2 = gn(0);
    pinkB.connect(L.howlBP); L.howlBP.connect(L.howl); L.howl.connect(amb);
    pinkB.connect(L.howlBP2); L.howlBP2.connect(L.howl2); L.howl2.connect(amb);

    // 3) 저역 버핏 / 지면 러시: 브라운 → LP → 레벨 → AM(버핏 떨림)
    L.rumLP = bq('lowpass', 120, 0.8);
    L.rum = gn(0); L.rumAM = gn(1);
    brown.connect(L.rumLP); L.rumLP.connect(L.rum); L.rum.connect(L.rumAM); L.rumAM.connect(amb);
    L.buffetLFO = osc('sine', 7);
    L.buffetDepth = gn(0.15);
    L.buffetLFO.connect(L.buffetDepth); L.buffetDepth.connect(L.rumAM.gain);

    // 4) 부스트 유지 추력: 제트 같은 중역 노이즈 + 저역 포효
    L.thrBP = bq('bandpass', 900, 0.9);
    L.thr = gn(0);
    pinkB.connect(L.thrBP); L.thrBP.connect(L.thr); L.thr.connect(amb);
    L.thrLP = bq('lowpass', 300, 0.7);
    L.thrLow = gn(0);
    brown.connect(L.thrLP); L.thrLP.connect(L.thrLow); L.thrLow.connect(amb);

    // 5) 증기 원뿔 히스: 화이트 → HP → 피킹 → 떨림 AM
    L.vapHP = bq('highpass', 2600, 0.7);
    L.vapPK = bq('peaking', 7200, 0.8, 5);
    L.vap = gn(0); L.vapAM = gn(1);
    white.connect(L.vapHP); L.vapHP.connect(L.vapPK); L.vapPK.connect(L.vap); L.vap.connect(L.vapAM); L.vapAM.connect(amb);
    const v1 = osc('sine', 13.7), v2 = osc('sine', 21.3);
    const vd1 = gn(0.35), vd2 = gn(0.22);
    v1.connect(vd1); vd1.connect(L.vapAM.gain); v2.connect(vd2); vd2.connect(L.vapAM.gain);

    // 6) 플라즈마 불꽃 굉음: 깊은 럼블 + 포화된 로어 + 탁탁 크래클 + 지글거림, 전체에 무작위 깜빡임 AM
    L.fireAM = gn(1);
    L.fireAM.connect(amb);
    L.fRumLP = bq('lowpass', 150, 1.0);
    L.fRum = gn(0);
    brown.connect(L.fRumLP); L.fRumLP.connect(L.fRum); L.fRum.connect(L.fireAM);
    L.fRoarSrc = loop(B.pink, 0.8);
    L.fRoarBP = bq('bandpass', 380, 0.7);
    const roarDrive = gn(2.4);
    const roarSh = c.createWaveShaper(); roarSh.curve = _tanh3;
    L.fRoarLP = bq('lowpass', 2400, 0.6);
    L.fRoar = gn(0);
    L.fRoarSrc.connect(L.fRoarBP); L.fRoarBP.connect(roarDrive); roarDrive.connect(roarSh);
    roarSh.connect(L.fRoarLP); L.fRoarLP.connect(L.fRoar); L.fRoar.connect(L.fireAM);
    L.crkHP = bq('highpass', 1100, 0.7);
    L.crk = gn(0);
    crackle.connect(L.crkHP); L.crkHP.connect(L.crk); L.crk.connect(L.fireAM);
    L.sizHP = bq('highpass', 5200, 0.7);
    L.siz = gn(0);
    white.connect(L.sizHP); L.sizHP.connect(L.siz); L.siz.connect(L.fireAM);
    // 오디오 레이트 무작위 깜빡임: 브라운 노이즈를 아주 느리게 재생해 변조원으로 사용
    const flick = loop(B.brown, 0.012);
    const flickD = gn(0.9);
    flick.connect(flickD); flickD.connect(L.fireAM.gain);

    // setTargetAtTime 래퍼 (값이 거의 같으면 이벤트를 만들지 않음)
    const P = (param) => ({ param, last: param.value });
    this._P = {
      windL: P(L.windL.gain), windR: P(L.windR.gain), windBP: P(L.windBP.frequency), windLP: P(L.windLP.frequency),
      howl: P(L.howl.gain), howl2: P(L.howl2.gain), howlF: P(L.howlBP.frequency), howlF2: P(L.howlBP2.frequency),
      rum: P(L.rum.gain), rumF: P(L.rumLP.frequency), bufD: P(L.buffetDepth.gain), bufF: P(L.buffetLFO.frequency),
      thr: P(L.thr.gain), thrF: P(L.thrBP.frequency), thrLow: P(L.thrLow.gain),
      vap: P(L.vap.gain),
      fireAM: P(L.fireAM.gain), fRum: P(L.fRum.gain), fRoar: P(L.fRoar.gain), fRate: P(L.fRoarSrc.playbackRate),
      fRoarF: P(L.fRoarBP.frequency), crk: P(L.crk.gain), siz: P(L.siz.gain),
    };
  }

  _s(p, v, now, tau) {
    const d = v - p.last;
    if (d < 0 ? -d <= 1e-5 + p.last * 0.002 : d <= 1e-5 + p.last * 0.002) return;
    p.last = v;
    p.param.setTargetAtTime(v, now, tau);
  }

  // s = { speed, mach, flying, grounded, boost 0..1, plasma 0..1, vapor 0..1, altitude }
  update(dt, s) {
    if (!this._ready() || !s) return;
    try {
      dt = clamp(num(dt, 0), 0, 0.25);
      this._gustPh += dt * this._gustRate;
      const plasma = clamp(num(s.plasma, 0), 0, 1);
      this._flickPh += dt * (2.2 + 3.5 * plasma);
      this._acc += dt;
      if (this._acc < UPDATE_DT) return;
      this._acc = 0;
      const now = this.ctx.currentTime;
      this._reap(now);
      this._apply(s, plasma, now);
    } catch (e) { /* noop */ }
  }

  _apply(s, plasma, now) {
    const P = this._P;
    const v = Math.max(0, num(s.speed, 0));
    const mach = num(s.mach, v / 343);
    const fly = s.flying ? 1 : 0;
    const boost = clamp(num(s.boost, 0), 0, 1);
    const vapor = clamp(num(s.vapor, 0), 0, 1);
    const alt = Math.max(0, num(s.altitude, 0));

    const loud = 1 - Math.exp(-v / 85);                       // 0 → 1 (85 m/s 에서 63%)
    const thin = smooth(2500, 15000, alt);                    // 고공의 옅은 공기
    const lowAlt = fly * (1 - smooth(2, 16, alt)) * smooth(15, 90, v);   // 저공 고속: 지면 러시
    this._gustRate = 0.22 + 1.6 * loud;                       // 빠를수록 난류가 잦다
    const gL = fbm(this._gustPh), gR = fbm(this._gustPh + 41.3), g = 0.5 * (gL + gR);
    const T = 0.07;

    // 1) 바람
    const base = (MIX.ambient * (1 + 0.6 * fly) + MIX.wind * 1.15 * Math.pow(loud, 1.3)) *
      (1 - 0.35 * plasma) * (1 - 0.35 * thin);
    const depth = 0.95 - 0.6 * loud;                          // 저속일수록 돌풍 변화가 크다
    this._s(P.windL, base * (1 - 0.5 * depth + depth * gL), now, T);
    this._s(P.windR, base * (1 - 0.5 * depth + depth * gR), now, T);
    this._s(P.windBP, 260 + 1500 * loud + 280 * (g - 0.5), now, T);
    this._s(P.windLP, Math.min(14000, (650 + 9000 * Math.pow(loud, 1.4)) * (0.8 + 0.4 * g) * (1 - 0.3 * thin)), now, T);

    // 2) 하울링
    const hw = MIX.howl * 0.5 * smooth(16, 140, v) * (1 - 0.7 * smooth(320, 900, v)) * (1 - plasma) * (0.35 + 1.3 * g * g);
    const hf = 380 + 1250 * loud;
    this._s(P.howl, hw, now, T);
    this._s(P.howl2, hw * 0.55 * (0.4 + 1.2 * gR), now, T);
    this._s(P.howlF, hf + 240 * (gL - 0.5), now, 0.12);
    this._s(P.howlF2, hf * 1.47 + 320 * (gR - 0.5), now, 0.12);

    // 3) 저역 버핏 / 지면 러시
    this._s(P.rum, MIX.rumble * (0.5 * smooth(25, 420, v) + 0.9 * lowAlt + 0.7 * vapor + 0.25 * plasma), now, T);
    this._s(P.rumF, 85 + 140 * loud + 170 * lowAlt, now, T);
    this._s(P.bufD, 0.12 + 0.5 * vapor + 0.25 * lowAlt + 0.15 * smooth(150, 600, v), now, T);
    this._s(P.bufF, 4 + 8 * loud + 6 * vapor + 3 * (g - 0.5), now, 0.15);

    // 4) 부스트 유지 추력
    this._s(P.thr, MIX.thrust * 0.9 * boost * (0.55 + 0.45 * loud) * (1 - 0.5 * plasma), now, 0.05);
    this._s(P.thrF, 650 + 900 * loud, now, 0.1);
    this._s(P.thrLow, MIX.thrust * 0.5 * boost * (1 - 0.4 * plasma), now, 0.05);

    // 5) 증기 원뿔
    this._s(P.vap, MIX.vapor * 0.55 * vapor, now, 0.05);

    // 6) 플라즈마 (보우쇼크)
    const fl = 0.8 + 0.4 * fbm(this._flickPh);
    const p = plasma, F = MIX.fire;
    this._s(P.fireAM, fl, now, 0.04);
    this._s(P.fRum, F * 1.2 * p, now, 0.08);
    this._s(P.fRoar, F * 0.45 * Math.pow(p, 0.8), now, 0.08);
    this._s(P.fRate, 0.7 + 0.35 * p + 0.12 * smooth(3, 5, mach), now, 0.1);
    this._s(P.fRoarF, 300 + 240 * p, now, 0.1);
    this._s(P.crk, F * 0.5 * p * (0.5 + fbm(this._flickPh * 1.7 + 9)), now, 0.04);
    this._s(P.siz, F * 0.14 * p, now, 0.08);
  }

  // ───────────── 원샷 ─────────────

  // name: RULES 키, strength 0..1, pan(선택): -1 왼쪽 … +1 오른쪽 (roll 은 회전 방향 부호로 사용)
  play(name, strength = 1, pan = 0) {
    if (!this._ready()) return;
    const rule = RULES[name];
    if (!rule) return;
    try {
      const c = this.ctx, now = c.currentTime;
      const st = clamp(num(strength, 1), 0, 1);
      if (st <= 0.001) return;
      const last = this._last[name];
      if (last !== undefined && now - last < rule[0] && now >= last) return;
      this._reap(now);
      if (!this._admit(name, rule, now)) return;
      this._last[name] = now;
      const t = now + 0.006;
      const pn = clamp(num(pan, 0), -1, 1);
      switch (name) {
        case 'step': this._step(st, pn, t); break;
        case 'jump': this._jump(st, pn, t); break;
        case 'land': this._land(st, pn, t); break;
        case 'dash': this._dash(st, pn, t); break;
        case 'roll': this._roll(st, pn, t); break;
        case 'flip': this._flip(st, pn, t); break;
        case 'brake': this._brake(st, pn, t); break;
        case 'takeoff': this._takeoff(st, pn, t); break;
        case 'boost': this._boost(st, pn, t); break;
        case 'heroLand': this._heroLand(st, pn, t); break;
        case 'sonicBoom': this._sonicBoom(st, pn, t); break;
        case 'slash': this._slash(st, pn, t); break;
        case 'clang': this._clang(st, pn, t); break;
        case 'charge': this._charge(st, pn, t); break;
        case 'beam': this._beam(st, pn, t); break;
        case 'splash': this._splash(st, pn, t); break;
        default: break;
      }
    } catch (e) { /* noop */ }
  }

  // 보이스 상한: 같은 이름 상한 → 가장 오래된 것을 페이드아웃, 전체 상한 → 우선순위 낮고 오래된 것부터
  _admit(name, rule, now) {
    const V = this._voices;
    let same = 0, oldestSame = null, alive = 0, victim = null;
    for (let i = 0; i < V.length; i++) {
      const v = V[i];
      if (v.dying) continue;
      alive++;
      if (v.name === name) { same++; if (!oldestSame || v.t0 < oldestSame.t0) oldestSame = v; }
      if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.t0 < victim.t0)) victim = v;
    }
    if (same >= rule[1] && oldestSame) { this._stealVoice(oldestSame, now); alive--; if (victim === oldestSame) victim = null; }
    if (alive >= MAX_VOICES) {
      if (!victim) {
        for (let i = 0; i < V.length; i++) {
          const v = V[i];
          if (!v.dying && (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.t0 < victim.t0))) victim = v;
        }
      }
      if (!victim || victim.prio > rule[2]) return false;
      this._stealVoice(victim, now);
    }
    return true;
  }

  _stealVoice(v, now) {
    v.dying = true;
    try { v.out.gain.setTargetAtTime(0, now, 0.012); } catch (e) { /* noop */ }
    for (let i = 0; i < v.srcs.length; i++) { try { v.srcs[i].stop(now + 0.09); } catch (e) { /* noop */ } }
    v.end = Math.min(v.end, now + 0.1);
  }

  _killAll(now) {
    for (let i = 0; i < this._voices.length; i++) if (!this._voices[i].dying) this._stealVoice(this._voices[i], now);
  }

  _reap(now) {
    const V = this._voices;
    for (let i = V.length - 1; i >= 0; i--) {
      const v = V[i];
      if (v.end < now) {
        try { v.out.disconnect(); if (v.pan) v.pan.disconnect(); if (v.send) v.send.disconnect(); } catch (e) { /* noop */ }
        V.splice(i, 1);
      }
    }
  }

  // 보이스 생성: out(Gain) → [StereoPanner] → sfx  (+ 리버브 센드)
  _v(name, t, life, rev, pan) {
    const c = this.ctx, out = c.createGain();
    out.gain.value = LEVEL[name] || 1;
    let pn = null;
    if (c.createStereoPanner) {
      pn = c.createStereoPanner(); pn.pan.value = pan;
      out.connect(pn); pn.connect(this.sfx);
    } else out.connect(this.sfx);
    let send = null;
    if (rev > 0) { send = c.createGain(); send.gain.value = rev; out.connect(send); send.connect(this.revIn); }
    const v = { name, prio: RULES[name][2], t0: t, end: t + life, out, pan: pn, send, srcs: [], dying: false };
    this._voices.push(v);
    return v;
  }

  _g() { const g = this.ctx.createGain(); g.gain.value = 0; return g; }
  _bq(type, f, q) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  _chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); }

  // 노이즈 소스 (무작위 위치에서 시작)
  _noise(v, buf, t, dur, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    s.start(t, Math.random() * buf.duration * 0.9);
    s.stop(t + dur);
    v.srcs.push(s);
    return s;
  }
  // 일회성 버퍼 (처음부터 재생)
  _shot(v, buf, t, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.playbackRate.value = rate;
    s.start(t);
    s.stop(t + buf.duration / rate + 0.02);
    v.srcs.push(s);
    return s;
  }
  _tone(v, type, t, dur, f0, f1, glide) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f0;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
    o.start(t); o.stop(t + dur);
    v.srcs.push(o);
    return o;
  }
  // 어택-감쇠 (감쇠 d 초 동안 -60 dB 까지 지수 감소 → 0)
  _env(param, t, a, peak, d) {
    peak = Math.max(peak, 1e-4);
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(peak * 1e-3, t + a + d);
    param.linearRampToValueAtTime(0, t + a + d + 0.012);
    return t + a + d + 0.012;
  }
  // 비대칭 종 모양 엔벨로프 x^p (1-x)^q (p < q 면 빠른 상승·긴 꼬리)
  _bell(param, t, dur, peak, p, q) {
    const N = 64, cv = new Float32Array(N), m = p / (p + q);
    const norm = peak / (Math.pow(m, p) * Math.pow(1 - m, q));
    for (let i = 0; i < N; i++) { const x = i / (N - 1); cv[i] = norm * Math.pow(x, p) * Math.pow(1 - x, q); }
    param.setValueCurveAtTime(cv, t, dur);
    return t + dur;
  }
  _sweep(param, t, f0, f1, dur) {
    param.setValueAtTime(f0, t);
    param.exponentialRampToValueAtTime(f1, t + dur);
  }

  // 발걸음: 아주 작은 탭
  _step(s, pan, t) {
    const B = this._B, r = Math.random();
    const v = this._v('step', t, 0.16, 0, clamp(pan + rand(-0.15, 0.15), -1, 1));
    const n = this._noise(v, B.pink, t, 0.08, 1);
    const lp = this._bq('lowpass', 900 + 800 * r, 0.8), hp = this._bq('highpass', 140, 0.7), g = this._g();
    this._env(g.gain, t, 0.0015, 0.55 * s, 0.035 + 0.02 * r);
    this._chain(n, lp, hp, g, v.out);
    const o = this._tone(v, 'sine', t, 0.12, 150 + 60 * r, 80, 0.05);
    const og = this._g();
    this._env(og.gain, t, 0.002, 0.16 * s, 0.06);
    this._chain(o, og, v.out);
  }

  // 점프: 부드러운 휙 + 발 구름 쿵
  _jump(s, pan, t) {
    const B = this._B;
    const v = this._v('jump', t, 0.55, 0.05, pan);
    const o = this._tone(v, 'sine', t, 0.34, 140, 50, 0.13);
    const og = this._g();
    this._env(og.gain, t, 0.003, 0.32 * (0.45 + 0.55 * s), 0.24);
    this._chain(o, og, v.out);
    const n = this._noise(v, B.pink, t, 0.14, 1);
    const nf = this._bq('lowpass', 800 + 800 * s, 0.7), ng = this._g();
    this._env(ng.gain, t, 0.002, 0.5 * s, 0.08);
    this._chain(n, nf, ng, v.out);
    const w = this._noise(v, B.pink, t, 0.46, 1);
    const wf = this._bq('bandpass', 420, 1.1);
    this._sweep(wf.frequency, t, 420, 1800, 0.32);
    const wg = this._g();
    this._bell(wg.gain, t + 0.008, 0.4, 1.2 * s, 1.8, 3);
    this._chain(w, wf, wg, v.out);
  }

  // 이륙: 상승하는 휙 + 저역 펀치
  _takeoff(s, pan, t) {
    const B = this._B, k = 0.5 + 0.5 * s;
    const v = this._v('takeoff', t, 1.3, 0.18, pan);
    const o = this._tone(v, 'sine', t, 0.6, 105, 36, 0.32);
    const og = this._g();
    this._env(og.gain, t, 0.003, 0.6 * k, 0.45);
    this._chain(o, og, v.out);
    const p = this._noise(v, B.brown, t, 0.4, 1);
    const pf = this._bq('lowpass', 340, 0.8), pg = this._g();
    this._env(pg.gain, t, 0.002, 1.1 * s, 0.24);
    this._chain(p, pf, pg, v.out);
    const w = this._noise(v, B.pink, t, 1.15, 1);
    const wf = this._bq('bandpass', 260, 1.3);
    this._sweep(wf.frequency, t, 260, 2900, 0.85);
    const wg = this._g();
    this._bell(wg.gain, t, 1.1, 1.5 * s, 2.4, 2.2);
    this._chain(w, wf, wg, v.out);
    const h = this._noise(v, B.white, t, 1.1, 1);
    const hf = this._bq('highpass', 1800, 0.7);
    this._sweep(hf.frequency, t, 1800, 5400, 0.9);
    const hg = this._g();
    this._bell(hg.gain, t + 0.05, 1.0, 0.16 * s, 3, 2);
    this._chain(h, hf, hg, v.out);
  }

  // 착지: 세기에 비례하는 쿵 (세면 몸통 럼블 + 파편)
  _land(s, pan, t) {
    const B = this._B;
    const v = this._v('land', t, 0.6 + 0.9 * s, 0.04 + 0.12 * s, pan);
    const o = this._tone(v, 'sine', t, 0.5 + 0.35 * s, 118 - 22 * s, 42, 0.1 + 0.12 * s);
    const og = this._g();
    this._env(og.gain, t, 0.002, 0.24 + 0.5 * s, 0.14 + 0.34 * s);
    this._chain(o, og, v.out);
    const n = this._noise(v, B.pink, t, 0.25, 1);
    const nf = this._bq('lowpass', 600 + 1900 * s, 0.7), ng = this._g();
    this._env(ng.gain, t, 0.001, 0.7 + 0.9 * s, 0.05 + 0.11 * s);
    this._chain(n, nf, ng, v.out);
    if (s > 0.45) {
      const b = this._noise(v, B.brown, t, 0.9, 1);
      const bf = this._bq('lowpass', 210, 0.8), bg = this._g();
      this._env(bg.gain, t, 0.006, 2.2 * (s - 0.45), 0.35 + 0.45 * s);
      this._chain(b, bf, bg, v.out);
    }
    if (s > 0.6) {
      const d = this._shot(v, B.debris, t + 0.02, 1.35);
      const df = this._bq('highpass', 1600, 0.7), dg = this._g();
      dg.gain.setValueAtTime(0, t);
      dg.gain.linearRampToValueAtTime(0.9 * (s - 0.6), t + 0.03);
      dg.gain.setTargetAtTime(0, t + 0.5, 0.15);
      this._chain(d, df, dg, v.out);
    }
  }

  // 슈퍼히어로 착지: 서브베이스 드롭 + 크런치 + 거대한 쿵 꼬리 + 튀는 파편
  _heroLand(s, pan, t) {
    const B = this._B, k = 0.55 + 0.45 * s;
    const v = this._v('heroLand', t, 3.6, 0.32, pan);
    const sub = this._tone(v, 'sine', t, 2.3, 78, 24, 1.0);
    const sg = this._g();
    this._env(sg.gain, t, 0.004, 0.85 * k, 1.8);
    this._chain(sub, sg, v.out);
    const body = this._tone(v, 'triangle', t, 0.7, 170, 52, 0.3);
    const bg = this._g();
    this._env(bg.gain, t, 0.002, 0.32 * k, 0.4);
    this._chain(body, bg, v.out);
    const cr = this._noise(v, B.white, t, 0.5, 1);
    const cf = this._bq('lowpass', 4200, 0.7);
    this._sweep(cf.frequency, t, 4200, 480, 0.45);
    const csh = this.ctx.createWaveShaper(); csh.curve = _crunch;
    const cpre = this.ctx.createGain(); cpre.gain.value = 2.5;
    const cg = this._g();
    this._env(cg.gain, t, 0.0008, 0.55 * k, 0.34);
    this._chain(cr, cf, cpre, csh, cg, v.out);
    const sn = this._noise(v, B.white, t, 0.1, 1);
    const snf = this._bq('highpass', 2200, 0.7), sng = this._g();
    this._env(sng.gain, t, 0.0006, 0.9 * k, 0.05);
    this._chain(sn, snf, sng, v.out);
    const tl = this._noise(v, B.brown, t, 3.2, 1);
    const tf = this._bq('lowpass', 260, 0.8);
    this._sweep(tf.frequency, t, 260, 70, 2.8);
    const tg = this._g();
    this._env(tg.gain, t, 0.03, 2.4 * k, 2.9);
    this._chain(tl, tf, tg, v.out);
    const d = this._shot(v, B.debris, t + 0.03, rand(0.9, 1.08));
    const df = this._bq('highpass', 900, 0.7), dg = this._g();
    dg.gain.setValueAtTime(0, t);
    dg.gain.linearRampToValueAtTime(0.75 * k, t + 0.04);
    this._chain(d, df, dg, v.out);
  }

  // 배럴 롤 / 옆돌기: 몸이 돌며 두 번 지나가는 휙-휙 + 좌→우 팬 스윕
  _roll(s, pan, t) {
    const B = this._B, dir = pan !== 0 ? Math.sign(pan) : (Math.random() < 0.5 ? -1 : 1);
    const v = this._v('roll', t, 0.8, 0.05, 0);
    const dur = 0.66;
    if (v.pan) { v.pan.pan.setValueAtTime(-0.6 * dir, t); v.pan.pan.linearRampToValueAtTime(0.6 * dir, t + 0.55); }
    const w = this._noise(v, B.pink, t, dur + 0.05, 1);
    const wf = this._bq('bandpass', 500, 2.0);
    const f = wf.frequency;
    f.setValueAtTime(500, t);
    f.exponentialRampToValueAtTime(2400, t + 0.16);
    f.exponentialRampToValueAtTime(780, t + 0.34);
    f.exponentialRampToValueAtTime(1900, t + 0.48);
    f.exponentialRampToValueAtTime(600, t + dur);
    const wg = this._g();
    const N = 96, cv = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      const b1 = Math.exp(-Math.pow((x - 0.25) / 0.11, 2)), b2 = Math.exp(-Math.pow((x - 0.7) / 0.12, 2));
      cv[i] = 1.7 * s * (b1 + 0.6 * b2) * Math.min(1, x * 12) * Math.min(1, (1 - x) * 8);
    }
    wg.gain.setValueCurveAtTime(cv, t, dur);
    this._chain(w, wf, wg, v.out);
    const lo = this._noise(v, B.brown, t, 0.6, 1);
    const lf = this._bq('lowpass', 380, 0.8), lg = this._g();
    this._bell(lg.gain, t, 0.55, 0.7 * s, 2, 2.4);
    this._chain(lo, lf, lg, v.out);
  }

  // 공중제비: 더 낮고 긴 스윕 + 머리 위를 지나는 팬 + 회전 덩어리감
  _flip(s, pan, t) {
    const B = this._B, dur = 0.72;
    const v = this._v('flip', t, 0.85, 0.06, 0);
    if (v.pan) { v.pan.pan.setValueAtTime(0.22 + pan * 0.3, t); v.pan.pan.linearRampToValueAtTime(-0.22 + pan * 0.3, t + dur); }
    const w = this._noise(v, B.pink, t, dur + 0.05, 1);
    const wf = this._bq('bandpass', 320, 1.5);
    wf.frequency.setValueAtTime(320, t);
    wf.frequency.exponentialRampToValueAtTime(1600, t + 0.32);
    wf.frequency.exponentialRampToValueAtTime(420, t + dur);
    const wg = this._g();
    this._bell(wg.gain, t, dur, 1.6 * s, 2, 2.2);
    this._chain(w, wf, wg, v.out);
    const o = this._tone(v, 'sine', t, 0.6, 72, 52, 0.5);
    const og = this._g();
    this._bell(og.gain, t, 0.56, 0.18 * s, 2, 2);
    this._chain(o, og, v.out);
    const h = this._noise(v, B.white, t, 0.6, 1);
    const hf = this._bq('highpass', 3500, 0.7), hg = this._g();
    this._bell(hg.gain, t + 0.05, 0.5, 0.12 * s, 3, 2);
    this._chain(h, hf, hg, v.out);
  }

  // 부스트: 점화 펀치 + 제트처럼 부풀어 오르는 추진음 + 애프터버너 히스
  _boost(s, pan, t) {
    const B = this._B, k = 0.45 + 0.55 * s;
    const v = this._v('boost', t, 2.1, 0.22, pan);
    const o = this._tone(v, 'sine', t, 0.7, 88, 34, 0.28);
    const og = this._g();
    this._env(og.gain, t, 0.003, 0.55 * k, 0.45);
    this._chain(o, og, v.out);
    const c = this._noise(v, B.white, t, 0.12, 1);
    const cf = this._bq('bandpass', 2600, 0.7), cg = this._g();
    this._env(cg.gain, t, 0.0008, 1.0 * k, 0.06);
    this._chain(c, cf, cg, v.out);
    const j = this._noise(v, B.pink, t, 1.8, 1);
    const jf = this._bq('bandpass', 520, 0.85);
    this._sweep(jf.frequency, t, 520, 1500, 1.1);
    const jg = this._g();
    this._bell(jg.gain, t, 1.75, 1.6 * k, 1.3, 3.2);
    this._chain(j, jf, jg, v.out);
    const r = this._noise(v, B.brown, t, 1.7, 1);
    const rf = this._bq('lowpass', 300, 0.8);
    this._sweep(rf.frequency, t, 300, 480, 0.6);
    const rg = this._g();
    this._bell(rg.gain, t, 1.65, 1.5 * k, 1.1, 3);
    this._chain(r, rf, rg, v.out);
    const h = this._noise(v, B.white, t, 1.4, 1);
    const hf = this._bq('highpass', 3200, 0.7);
    this._sweep(hf.frequency, t, 3200, 7000, 1.0);
    const hg = this._g();
    this._bell(hg.gain, t, 1.35, 0.22 * k, 1.5, 3);
    this._chain(h, hf, hg, v.out);
  }

  // 소닉붐: N-파 이중 크랙(약 86 ms 간격) + 초저역 쿵 + 길게 굴러가는 천둥 꼬리 + 먼 메아리
  _sonicBoom(s, pan, t) {
    const B = this._B, k = 0.6 + 0.4 * s;
    const v = this._v('sonicBoom', t, 4.6, 0.55, pan);
    const nw = this._shot(v, B.nwave, t, 1);
    const nf = this._bq('lowpass', 9000, 0.6);
    const ng = this.ctx.createGain(); ng.gain.value = 1.0 * k;
    this._chain(nw, nf, ng, v.out);
    const sub = this._tone(v, 'sine', t, 1.8, 54, 27, 0.7);
    const sg = this._g();
    this._env(sg.gain, t, 0.004, 0.75 * k, 1.4);
    this._chain(sub, sg, v.out);
    // 굴러가는 꼬리: 브라운 → 내려가는 LPF → 무작위 AM → 엔벨로프
    const tl = this._noise(v, B.brown, t, 4.2, 1);
    const tf = this._bq('lowpass', 340, 0.8);
    this._sweep(tf.frequency, t, 340, 80, 3.6);
    const am = this.ctx.createGain(); am.gain.value = 1;
    const mod = this._noise(v, B.brown, t, 4.2, 0.008);
    const md = this.ctx.createGain(); md.gain.value = 1.6;
    mod.connect(md); md.connect(am.gain);
    const tg = this._g();
    this._env(tg.gain, t + 0.02, 0.07, 2.2 * k, 3.7);
    this._chain(tl, tf, am, tg, v.out);
    const mid = this._noise(v, B.pink, t, 2.2, 1);
    const mf = this._bq('bandpass', 380, 0.7);
    this._sweep(mf.frequency, t, 380, 150, 2.0);
    const mg = this._g();
    this._env(mg.gain, t + 0.01, 0.03, 1.2 * k, 1.9);
    this._chain(mid, mf, mg, v.out);
    // 먼 지형 메아리: 낮게 늘린 N-파
    const ec = this._shot(v, B.nwave, t + 0.46, 0.55);
    const ef = this._bq('lowpass', 1500, 0.6);
    const eg = this.ctx.createGain(); eg.gain.value = 0.3 * k;
    this._chain(ec, ef, eg, v.out);
  }

  // 급제동: 아래로 쓸려 내려가는 공기 폭발
  // 검 휘두르기: 짧고 날카로운 바람 가르는 소리 (고역 스윕)
  _slash(s, pan, t) {
    const B = this._B, dur = 0.26;
    const v = this._v('slash', t, 0.4, 0.08, pan);
    const w = this._noise(v, B.white, t, dur, 1);
    const f = this._bq('bandpass', 900, 2.6);
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(5200, t + 0.09);
    f.frequency.exponentialRampToValueAtTime(1400, t + dur);
    const g = this._g();
    this._bell(g.gain, t, dur, 1.4 * s, 1.5, 3.5);
    this._chain(w, f, g, v.out);
    const o = this._tone(v, 'sine', t, 0.18, 220, 90, 0.15);
    const og = this._g();
    this._env(og.gain, t, 0.004, 0.12 * s, 0.12);
    this._chain(o, og, v.out);
  }
  // 금속/콘크리트 타격: 날카로운 땡 + 부서지는 잡음
  _clang(s, pan, t) {
    const B = this._B;
    const v = this._v('clang', t, 1.2, 0.2, pan);
    for (const [fr, a] of [[1870, 0.25], [2930, 0.16], [4410, 0.1]]) {
      const o = this._tone(v, 'sine', t, 0.9, fr, fr * 0.98, 0.8);
      const og = this._g();
      this._env(og.gain, t, 0.001, a * s, 0.35);
      this._chain(o, og, v.out);
    }
    const n = this._noise(v, B.pink, t, 0.4, 1);
    const nf = this._bq('bandpass', 1200, 0.8), ng = this._g();
    this._env(ng.gain, t, 0.002, 0.9 * s, 0.18);
    this._chain(n, nf, ng, v.out);
  }
  // 기 모으기: 점점 올라가는 웅웅거림
  _charge(s, pan, t) {
    const B = this._B, dur = 2.0;
    const v = this._v('charge', t, dur + 0.2, 0.2, pan);
    const o = this._tone(v, 'sawtooth', t, dur, 70, 260, 1.8);
    const of = this._bq('lowpass', 400, 4);
    this._sweep(of.frequency, t, 400, 2600, dur);
    const og = this._g();
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.16 * s, t + dur * 0.9); og.gain.linearRampToValueAtTime(0, t + dur);
    this._chain(o, of, og, v.out);
    const n = this._noise(v, B.white, t, dur, 1);
    const nf = this._bq('bandpass', 2000, 3); this._sweep(nf.frequency, t, 2000, 7000, dur);
    const ng = this._g();
    ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.25 * s, t + dur * 0.9); ng.gain.linearRampToValueAtTime(0, t + dur);
    this._chain(n, nf, ng, v.out);
  }
  // 에너지 빔 발사: 쿵 하는 발사음 + 지글거리는 굉음
  _beam(s, pan, t) {
    const B = this._B, dur = 1.6;
    const v = this._v('beam', t, dur + 0.3, 0.45, pan);
    const o = this._tone(v, 'sine', t, 0.8, 140, 40, 0.5);
    const og = this._g();
    this._env(og.gain, t, 0.002, 0.8 * s, 0.5);
    this._chain(o, og, v.out);
    const z = this._tone(v, 'sawtooth', t, dur, 110, 95, dur);
    const zf = this._bq('bandpass', 900, 1.2), zg = this._g();
    this._bell(zg.gain, t, dur, 0.35 * s, 1.2, 4);
    this._chain(z, zf, zg, v.out);
    const n = this._noise(v, B.pink, t, dur, 1);
    const nf = this._bq('bandpass', 1500, 0.7), ng = this._g();
    this._bell(ng.gain, t, dur, 1.3 * s, 1.1, 3.5);
    this._chain(n, nf, ng, v.out);
  }
  // 물 첨벙
  _splash(s, pan, t) {
    const B = this._B, dur = 0.5 + 0.9 * s;
    const v = this._v('splash', t, dur + 0.2, 0.25, pan);
    const n = this._noise(v, B.white, t, dur, 1);
    const nf = this._bq('bandpass', 2400, 0.6);
    this._sweep(nf.frequency, t, 3800, 900, dur);
    const ng = this._g();
    this._env(ng.gain, t, 0.004, 1.2 * s, dur * 0.4);
    this._chain(n, nf, ng, v.out);
    const lo = this._noise(v, B.brown, t, dur, 1);
    const lf = this._bq('lowpass', 260, 0.7), lg = this._g();
    this._env(lg.gain, t, 0.006, 0.9 * s, dur * 0.5);
    this._chain(lo, lf, lg, v.out);
  }

  _brake(s, pan, t) {
    const B = this._B, k = 0.45 + 0.55 * s;
    const v = this._v('brake', t, 1.0, 0.12, pan);
    const a = this._noise(v, B.pink, t, 0.75, 1);
    const af = this._bq('bandpass', 2400, 0.8);
    this._sweep(af.frequency, t, 2400, 420, 0.5);
    const ag = this._g();
    this._env(ag.gain, t, 0.012, 1.7 * k, 0.6);
    this._chain(a, af, ag, v.out);
    const h = this._noise(v, B.white, t, 0.35, 1);
    const hf = this._bq('highpass', 2600, 0.7), hg = this._g();
    this._env(hg.gain, t, 0.006, 0.35 * k, 0.26);
    this._chain(h, hf, hg, v.out);
    const o = this._tone(v, 'sine', t, 0.36, 92, 44, 0.22);
    const og = this._g();
    this._env(og.gain, t, 0.003, 0.32 * k, 0.26);
    this._chain(o, og, v.out);
    const b = this._noise(v, B.brown, t, 0.5, 1);
    const bf = this._bq('lowpass', 260, 0.8), bg = this._g();
    this._env(bg.gain, t, 0.01, 1.1 * k, 0.4);
    this._chain(b, bf, bg, v.out);
  }

  // 대시: 짧고 날카로운 휙 + 작은 펀치
  _dash(s, pan, t) {
    const B = this._B;
    const v = this._v('dash', t, 0.6, 0.06, pan);
    const w = this._noise(v, B.pink, t, 0.4, 1);
    const wf = this._bq('bandpass', 600, 1.5);
    this._sweep(wf.frequency, t, 600, 2700, 0.22);
    const wg = this._g();
    this._bell(wg.gain, t, 0.36, 1.5 * s, 1.4, 3);
    this._chain(w, wf, wg, v.out);
    const h = this._noise(v, B.white, t, 0.25, 1);
    const hf = this._bq('highpass', 3000, 0.7), hg = this._g();
    this._bell(hg.gain, t, 0.22, 0.12 * s, 1.4, 3);
    this._chain(h, hf, hg, v.out);
    const o = this._tone(v, 'sine', t, 0.25, 108, 48, 0.12);
    const og = this._g();
    this._env(og.gain, t, 0.003, 0.28 * s, 0.15);
    this._chain(o, og, v.out);
  }
}
