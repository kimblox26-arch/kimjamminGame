// FREE FREELY - 절차적 사운드 엔진 (WebAudio 합성)
// 모든 소리는 실시간 합성이다. 샘플 파일 없이 노이즈/발진기/필터를 조합해
// 프로펠러, 제트, 로켓, 바람, 폭발, 물보라, 화재 등을 물리 상태에 연동시킨다.
import { clamp, lerp, rand, randInt } from './utils.js';
import { Settings } from './settings.js';

/* ------------------------------------------------------------------ */
/* 버퍼 생성 도우미                                                     */
/* ------------------------------------------------------------------ */
function makeNoiseBuffer(ctx, seconds = 2, type = 'white') {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'white') {
        d[i] = w;
      } else if (type === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else { // brown
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
  }
  return buf;
}

/** 야외 반사음을 위한 합성 임펄스 응답 */
function makeImpulse(ctx, seconds = 2.6, decay = 3.1, bright = 0.4) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      const n = (Math.random() * 2 - 1) * env;
      lp = lerp(lp, n, 0.06 + bright * 0.5);
      d[i] = lp * (1 + (ch === 1 ? 0.08 : -0.08));
    }
  }
  return buf;
}

function makeDistortionCurve(amount = 40) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / n) * 2 - 1;
    curve[i] = ((3 + amount) * x * 20 * Math.PI / 180) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

/* ------------------------------------------------------------------ */
/* 엔진 보이스 — 기체 종류별 소리                                        */
/* ------------------------------------------------------------------ */
class EngineVoice {
  constructor(audio, kind, opts = {}) {
    this.audio = audio;
    this.ctx = audio.ctx;
    this.kind = kind;
    this.opts = opts;
    this.out = this.ctx.createGain();
    this.out.gain.value = 0;
    this.panner = audio.makePanner();
    this.out.connect(this.panner);
    this.panner.connect(audio.engineBus);
    this.nodes = [];
    this.alive = true;
    this.rpm = 0;
    this._build();
  }

  _osc(type, freq, gain, target) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    o.connect(g).connect(target || this.out);
    o.start();
    this.nodes.push(o, g);
    return { o, g };
  }

  _noise(bufType, filterType, freq, q, gain, target) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.audio.noise[bufType];
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(target || this.out);
    src.start(0, Math.random() * 1.5);
    this.nodes.push(src, f, g);
    return { src, f, g };
  }

  _build() {
    const K = this.kind;
    if (K === 'prop') {
      // 블레이드 통과음(저음 기음 + 배음) + 배기 파열음 + 공기 소음
      this.blade = this._osc('sawtooth', 80, 0.14);
      this.blade2 = this._osc('square', 160, 0.05);
      this.blade3 = this._osc('triangle', 240, 0.035);
      this.exhaust = this._noise('brown', 'lowpass', 300, 0.9, 0.22);
      this.air = this._noise('white', 'bandpass', 900, 0.8, 0.05);
      this.lp = this.ctx.createBiquadFilter();
      this.lp.type = 'lowpass'; this.lp.frequency.value = 2400;
    } else if (K === 'jet' || K === 'turbofan') {
      // 팬 휘슬(고주파) + 코어 럼블 + 배기 제트
      this.whine = this._osc('sawtooth', 900, 0.035);
      this.whine2 = this._osc('sine', 1810, 0.02);
      this.fan = this._osc('triangle', 420, 0.03);
      this.core = this._noise('brown', 'lowpass', 260, 1.0, 0.3);
      this.jetStream = this._noise('white', 'bandpass', 1400, 0.5, 0.12);
      this.ab = this._noise('white', 'lowpass', 500, 1.2, 0.0); // 애프터버너
      this.abShaper = this.ctx.createWaveShaper();
      this.abShaper.curve = makeDistortionCurve(60);
      this.ab.g.disconnect();
      this.ab.g.connect(this.abShaper).connect(this.out);
      this.nodes.push(this.abShaper);
    } else if (K === 'rocket') {
      // 초저역 럼블 + 광대역 파열 + 랜덤 크래클
      this.rumble = this._osc('sine', 38, 0.25);
      this.roar = this._noise('brown', 'lowpass', 420, 0.7, 0.45);
      this.hiss = this._noise('white', 'highpass', 2200, 0.4, 0.1);
      this.shaper = this.ctx.createWaveShaper();
      this.shaper.curve = makeDistortionCurve(25);
      this.roar.g.disconnect();
      this.roar.g.connect(this.shaper).connect(this.out);
      this.nodes.push(this.shaper);
    } else if (K === 'electric' || K === 'ion') {
      this.hum = this._osc('sine', 620, 0.06);
      this.hum2 = this._osc('triangle', 1240, 0.025);
      this.hiss = this._noise('white', 'bandpass', 4200, 3.0, 0.05);
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const lg = this.ctx.createGain(); lg.gain.value = 12;
      lfo.connect(lg).connect(this.hum.o.frequency);
      lfo.start();
      this.nodes.push(lfo, lg);
    } else if (K === 'burner') {
      // 열기구 버너: 굵은 화염 분사음 (트리거식)
      this.flame = this._noise('brown', 'bandpass', 260, 0.6, 0.0);
      this.roarHi = this._noise('white', 'highpass', 1600, 0.5, 0.0);
    }
  }

  /** state: { rpm(0..1), throttle, airspeed, afterburner, load, health } */
  update(state, dt) {
    if (!this.alive) return;
    const t = this.ctx.currentTime;
    const K = this.kind;
    const thr = clamp(state.throttle, 0, 1);
    const rpm = clamp(state.rpm !== undefined ? state.rpm : thr, 0, 1.2);
    const health = state.health === undefined ? 1 : clamp(state.health, 0, 1);
    const sp = clamp((state.airspeed || 0) / 250, 0, 1.5);
    const smooth = (param, value, time = 0.08) => {
      try { param.setTargetAtTime(value, t, time); } catch (e) { param.value = value; }
    };

    if (K === 'prop') {
      const blades = this.opts.blades || 3;
      const f = lerp(12, 46, rpm) * blades;      // 블레이드 통과 주파수
      smooth(this.blade.o.frequency, f, 0.05);
      smooth(this.blade2.o.frequency, f * 2.02, 0.05);
      smooth(this.blade3.o.frequency, f * 3.05, 0.05);
      smooth(this.exhaust.f.frequency, lerp(180, 700, rpm));
      smooth(this.air.g.gain, 0.02 + sp * 0.06);
      const rough = 1 - health;                  // 손상 시 거칠어짐
      smooth(this.blade.g.gain, (0.10 + rpm * 0.16) * (1 + rough * 0.6));
      smooth(this.blade2.g.gain, 0.03 + rpm * 0.06 + rough * 0.05);
      smooth(this.out.gain, (0.05 + rpm * 0.95) * (0.5 + 0.5 * health));
    } else if (K === 'jet' || K === 'turbofan') {
      const n1 = lerp(0.18, 1, rpm);
      smooth(this.whine.o.frequency, 620 + n1 * 2600, 0.12);
      smooth(this.whine2.o.frequency, 1240 + n1 * 5200, 0.12);
      smooth(this.fan.o.frequency, 180 + n1 * 620, 0.12);
      smooth(this.whine.g.gain, 0.012 + n1 * 0.05);
      smooth(this.core.f.frequency, 140 + n1 * 420);
      smooth(this.core.g.gain, 0.1 + n1 * 0.42);
      smooth(this.jetStream.f.frequency, 900 + n1 * 2200);
      smooth(this.jetStream.g.gain, 0.04 + n1 * 0.22 + sp * 0.05);
      const ab = state.afterburner ? 1 : 0;
      smooth(this.ab.g.gain, ab * 0.55, 0.25);
      smooth(this.ab.f.frequency, 300 + ab * 900, 0.3);
      smooth(this.out.gain, (0.06 + n1 * 0.9 + ab * 0.4) * (0.4 + 0.6 * health));
    } else if (K === 'rocket') {
      smooth(this.rumble.o.frequency, 30 + thr * 22, 0.2);
      smooth(this.roar.f.frequency, 240 + thr * 700);
      smooth(this.roar.g.gain, thr * 0.6);
      smooth(this.hiss.g.gain, thr * 0.18);
      smooth(this.out.gain, thr * 1.25);
    } else if (K === 'electric' || K === 'ion') {
      smooth(this.hum.o.frequency, 380 + rpm * 1400, 0.1);
      smooth(this.hum2.o.frequency, 760 + rpm * 2800, 0.1);
      smooth(this.out.gain, 0.05 + rpm * 0.5);
    } else if (K === 'burner') {
      const on = state.burner ? 1 : 0;
      smooth(this.flame.g.gain, on * 0.75, 0.05);
      smooth(this.roarHi.g.gain, on * 0.22, 0.05);
      smooth(this.flame.f.frequency, 180 + on * 260, 0.1);
      smooth(this.out.gain, 0.15 + on * 1.1);
    }
  }

  setPosition(v) { this.audio.setPannerPos(this.panner, v); }

  stop() {
    if (!this.alive) return;
    this.alive = false;
    const t = this.ctx.currentTime;
    try { this.out.gain.setTargetAtTime(0, t, 0.1); } catch (e) { /* noop */ }
    setTimeout(() => {
      for (const n of this.nodes) { try { n.stop ? n.stop() : n.disconnect(); } catch (e) { /* noop */ } }
      try { this.out.disconnect(); this.panner.disconnect(); } catch (e) { /* noop */ }
    }, 400);
  }
}

/* ------------------------------------------------------------------ */
/* 메인 오디오 엔진                                                     */
/* ------------------------------------------------------------------ */
export class AudioEngine {
  constructor() {
    this.ready = false;
    this.ctx = null;
    this.voices = [];
    this._warnings = new Map();
    this._loops = new Map();
    this._lastBoom = 0;
    this.muted = false;
  }

  init() {
    if (this.ready) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.noise = {
      white: makeNoiseBuffer(ctx, 2, 'white'),
      pink: makeNoiseBuffer(ctx, 2, 'pink'),
      brown: makeNoiseBuffer(ctx, 2.5, 'brown'),
    };

    // 마스터 체인: 리미터 역할의 컴프레서 → 출력
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -10;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.master.connect(this.comp).connect(ctx.destination);

    // 버스
    this.engineBus = ctx.createGain();
    this.windBus = ctx.createGain();
    this.fxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    // 실내(조종석) 차폐 필터
    this.cabinFilter = ctx.createBiquadFilter();
    this.cabinFilter.type = 'lowpass';
    this.cabinFilter.frequency.value = 20000;
    this.engineBus.connect(this.cabinFilter);
    this.windBus.connect(this.cabinFilter);
    this.cabinFilter.connect(this.master);
    this.fxBus.connect(this.master);
    this.musicBus.connect(this.master);

    // 공간 반향 (폭발/충돌에 사용)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 2.8, 3.4, 0.35);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.5;
    this.reverbSend.connect(this.reverb).connect(this.master);

    this.listenerPos = { x: 0, y: 0, z: 0 };
    this.applyVolumes();
    Settings.onChange(() => this.applyVolumes());
    this.ready = true;
    this._startWind();
    return true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  applyVolumes() {
    if (!this.ready) return;
    const v = Settings.volumeOf;
    const m = this.muted ? 0 : 1;
    this.master.gain.value = 0.9 * m;
    this.engineBus.gain.value = 0.55 * v.engine;
    this.windBus.gain.value = 0.5 * v.wind;
    this.fxBus.gain.value = 0.85 * v.fx;
    this.musicBus.gain.value = 0.4 * v.music;
  }

  setMuted(b) { this.muted = b; this.applyVolumes(); }

  makePanner() {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 12;
    p.maxDistance = 6000;
    p.rolloffFactor = 0.9;
    return p;
  }

  setPannerPos(p, v) {
    if (!p) return;
    const t = this.ctx.currentTime;
    if (p.positionX) {
      p.positionX.setTargetAtTime(v.x, t, 0.02);
      p.positionY.setTargetAtTime(v.y, t, 0.02);
      p.positionZ.setTargetAtTime(v.z, t, 0.02);
    } else p.setPosition(v.x, v.y, v.z);
  }

  /** 카메라 위치/방향으로 리스너 갱신 */
  updateListener(pos, forward, up, velocity) {
    if (!this.ready) return;
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    this.listenerPos = pos;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.02);
      L.positionY.setTargetAtTime(pos.y, t, 0.02);
      L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(forward.x, t, 0.03);
      L.forwardY.setTargetAtTime(forward.y, t, 0.03);
      L.forwardZ.setTargetAtTime(forward.z, t, 0.03);
      L.upX.setTargetAtTime(up.x, t, 0.05);
      L.upY.setTargetAtTime(up.y, t, 0.05);
      L.upZ.setTargetAtTime(up.z, t, 0.05);
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /** 조종석 내부 여부에 따른 차폐 */
  setCabin(inside, closed = true) {
    if (!this.ready) return;
    const target = inside ? (closed ? 1400 : 6000) : 20000;
    this.cabinFilter.frequency.setTargetAtTime(target, this.ctx.currentTime, 0.25);
  }

  createEngineVoice(kind, opts) {
    if (!this.ready) return null;
    const v = new EngineVoice(this, kind, opts);
    this.voices.push(v);
    return v;
  }

  removeVoice(v) {
    if (!v) return;
    v.stop();
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  /* --------------------------- 바람 / 대기 --------------------------- */
  _startWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise.pink;
    src.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass'; low.frequency.value = 700; low.Q.value = 0.7;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass'; band.frequency.value = 1200; band.Q.value = 0.9;
    const g = ctx.createGain(); g.gain.value = 0;
    const gb = ctx.createGain(); gb.gain.value = 0;
    src.connect(low).connect(g).connect(this.windBus);
    src.connect(band).connect(gb).connect(this.windBus);
    src.start();
    this.wind = { src, low, band, g, gb };

    // 기체 진동 (버핏) 채널
    const bsrc = ctx.createBufferSource();
    bsrc.buffer = this.noise.brown; bsrc.loop = true;
    const bf = ctx.createBiquadFilter(); bf.type = 'lowpass'; bf.frequency.value = 90;
    const bg = ctx.createGain(); bg.gain.value = 0;
    bsrc.connect(bf).connect(bg).connect(this.windBus);
    bsrc.start();
    this.buffet = { bf, bg };
  }

  /** airspeed m/s, altitude m, stall 0..1, gearOut, flap 0..1 */
  updateAtmos(state) {
    if (!this.ready || !this.wind) return;
    const t = this.ctx.currentTime;
    const v = clamp(state.airspeed / 180, 0, 2.2);
    const density = clamp(state.density === undefined ? 1 : state.density, 0, 1.3);
    const drag = 1 + (state.gear ? 0.35 : 0) + (state.flap || 0) * 0.3 + (state.airbrake ? 0.5 : 0);
    const amp = Math.pow(v, 2.1) * 0.5 * density * drag;
    this.wind.g.gain.setTargetAtTime(clamp(amp, 0, 1.2), t, 0.12);
    this.wind.gb.gain.setTargetAtTime(clamp(amp * 0.5, 0, 0.7), t, 0.12);
    this.wind.low.frequency.setTargetAtTime(320 + v * 900, t, 0.2);
    this.wind.band.frequency.setTargetAtTime(700 + v * 2600, t, 0.2);
    const buf = clamp((state.stall || 0) * 0.9 + (state.turbulence || 0) * 0.4, 0, 1);
    this.buffet.bg.gain.setTargetAtTime(buf * 0.55, t, 0.08);
    this.buffet.bf.frequency.setTargetAtTime(45 + buf * 90, t, 0.1);
  }

  /* ----------------------------- 효과음 ----------------------------- */
  _fxNode(pos, gain = 1, reverbAmount = 0.35) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    if (pos) {
      const p = this.makePanner();
      this.setPannerPos(p, pos);
      g.connect(p);
      p.connect(this.fxBus);
      const rs = this.ctx.createGain();
      rs.gain.value = reverbAmount;
      p.connect(rs).connect(this.reverbSend);
      setTimeout(() => { try { p.disconnect(); rs.disconnect(); } catch (e) { /* noop */ } }, 12000);
    } else {
      g.connect(this.fxBus);
      const rs = this.ctx.createGain(); rs.gain.value = reverbAmount;
      g.connect(rs).connect(this.reverbSend);
    }
    return g;
  }

  _burst(out, opts) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise[opts.noise || 'white'];
    src.loop = true;
    src.playbackRate.value = opts.rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = opts.filter || 'lowpass';
    f.frequency.setValueAtTime(opts.f0 || 800, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.f1 || 200), t0 + (opts.dur || 0.6));
    f.Q.value = opts.q || 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.peak || 0.8, t0 + (opts.attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (opts.dur || 0.6));
    src.connect(f).connect(g).connect(out);
    src.start(t0, Math.random());
    src.stop(t0 + (opts.dur || 0.6) + 0.05);
    return { src, f, g };
  }

  _tone(out, opts) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay || 0);
    const o = ctx.createOscillator();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(opts.f0 || 200, t0);
    if (opts.f1) o.frequency.exponentialRampToValueAtTime(Math.max(10, opts.f1), t0 + (opts.dur || 0.4));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.peak || 0.5, t0 + (opts.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (opts.dur || 0.4));
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + (opts.dur || 0.4) + 0.05);
    return o;
  }

  /** 폭발: 서브 충격 + 광대역 파열 + 파편 + 잔향 */
  explosion(pos, size = 1) {
    if (!this.ready) return;
    const s = clamp(size, 0.3, 3);
    const out = this._fxNode(pos, clamp(0.9 * s, 0.2, 1.6), 0.55);
    this._tone(out, { type: 'sine', f0: 120 * (1 / s), f1: 24, dur: 1.1 * s, peak: 0.9, attack: 0.008 });
    this._tone(out, { type: 'triangle', f0: 70, f1: 18, dur: 1.6 * s, peak: 0.5, delay: 0.02 });
    this._burst(out, { noise: 'white', filter: 'lowpass', f0: 5200, f1: 120, dur: 1.4 * s, peak: 1.0, q: 0.9 });
    this._burst(out, { noise: 'brown', filter: 'lowpass', f0: 900, f1: 60, dur: 2.2 * s, peak: 0.8, delay: 0.03 });
    // 파편/잔해
    for (let i = 0; i < randInt(4, 9); i++) {
      this._burst(out, {
        noise: 'white', filter: 'bandpass', f0: rand(1200, 5200), f1: rand(400, 1200),
        dur: rand(0.06, 0.2), peak: rand(0.1, 0.32), delay: rand(0.08, 0.9 * s), q: rand(2, 8),
      });
    }
  }

  /** 금속/지면 충돌음 — 재질과 에너지에 따라 변화 */
  impact(pos, energy = 1, material = 'metal') {
    if (!this.ready) return;
    const e = clamp(energy, 0.05, 3);
    const out = this._fxNode(pos, clamp(0.35 + e * 0.4, 0.1, 1.3), 0.4);
    if (material === 'metal') {
      for (let i = 0; i < 4; i++) {
        this._tone(out, { type: 'triangle', f0: rand(180, 900) * (1 + i * 0.6), f1: rand(80, 300), dur: rand(0.12, 0.5), peak: rand(0.08, 0.3) * e, delay: rand(0, 0.03) });
      }
      this._burst(out, { filter: 'bandpass', f0: 2600, f1: 600, dur: 0.22, peak: 0.4 * e, q: 1.6 });
      this._tone(out, { type: 'sine', f0: 90, f1: 40, dur: 0.4, peak: 0.35 * e });
    } else if (material === 'ground') {
      this._burst(out, { noise: 'brown', filter: 'lowpass', f0: 700, f1: 90, dur: 0.5, peak: 0.7 * e });
      this._tone(out, { type: 'sine', f0: 70, f1: 32, dur: 0.5, peak: 0.5 * e });
    } else if (material === 'glass') {
      for (let i = 0; i < 14; i++) {
        this._tone(out, { type: 'sine', f0: rand(2400, 7800), dur: rand(0.05, 0.22), peak: rand(0.03, 0.12) * e, delay: rand(0, 0.25) });
      }
    } else { // 나무/기타
      this._burst(out, { noise: 'pink', filter: 'bandpass', f0: 1100, f1: 300, dur: 0.35, peak: 0.6 * e, q: 1.1 });
    }
  }

  /** 착수/물튀김 — 속도에 따라 임팩트 → 거품 */
  splash(pos, energy = 1) {
    if (!this.ready) return;
    const e = clamp(energy, 0.1, 3);
    const out = this._fxNode(pos, clamp(0.5 + e * 0.35, 0.2, 1.5), 0.45);
    this._burst(out, { noise: 'white', filter: 'lowpass', f0: 6000, f1: 400, dur: 0.5 * e, peak: 0.9, q: 0.6 });
    this._burst(out, { noise: 'white', filter: 'highpass', f0: 900, f1: 2600, dur: 0.8 * e, peak: 0.35, delay: 0.04 });
    this._tone(out, { type: 'sine', f0: 150, f1: 45, dur: 0.6 * e, peak: 0.4 });
    // 물방울/거품
    for (let i = 0; i < randInt(6, 16); i++) {
      this._tone(out, { type: 'sine', f0: rand(400, 2200), f1: rand(900, 3600), dur: rand(0.04, 0.12), peak: rand(0.02, 0.1), delay: rand(0.1, 0.9 * e) });
    }
  }

  /** 수중 침몰 거품 루프 */
  bubbles(pos, on) {
    if (!this.ready) return;
    if (on && !this._loops.has('bubbles')) {
      const out = this._fxNode(pos, 0.5, 0.3);
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise.white; src.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 1.2;
      const g = this.ctx.createGain(); g.gain.value = 0.25;
      src.connect(f).connect(g).connect(out);
      src.start();
      const timer = setInterval(() => {
        if (!this._loops.has('bubbles')) return;
        this._tone(out, { type: 'sine', f0: rand(300, 1400), f1: rand(600, 2400), dur: rand(0.05, 0.15), peak: rand(0.04, 0.14) });
      }, 90);
      this._loops.set('bubbles', { stop: () => { clearInterval(timer); try { src.stop(); } catch (e) { /* noop */ } } });
    } else if (!on && this._loops.has('bubbles')) {
      this._loops.get('bubbles').stop();
      this._loops.delete('bubbles');
    }
  }

  /** 화재 루프 — 지속 연소 + 랜덤 크래클 */
  fire(on, pos) {
    if (!this.ready) return;
    if (on && !this._loops.has('fire')) {
      const out = this._fxNode(pos, 0.7, 0.3);
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise.brown; src.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 0.8;
      const g = this.ctx.createGain(); g.gain.value = 0.35;
      src.connect(f).connect(g).connect(out);
      src.start();
      const timer = setInterval(() => {
        if (!this._loops.has('fire')) return;
        this._burst(out, { noise: 'white', filter: 'bandpass', f0: rand(900, 3600), f1: rand(300, 900), dur: rand(0.03, 0.1), peak: rand(0.05, 0.22), q: rand(1, 5) });
      }, 110);
      this._loops.set('fire', { out, stop: () => { clearInterval(timer); try { src.stop(); } catch (e) { /* noop */ } } });
    } else if (!on && this._loops.has('fire')) {
      this._loops.get('fire').stop();
      this._loops.delete('fire');
    }
  }

  gearThump(pos, energy = 1) {
    if (!this.ready) return;
    const out = this._fxNode(pos, clamp(0.4 + energy * 0.4, 0.1, 1.2), 0.25);
    this._tone(out, { type: 'sine', f0: 110, f1: 45, dur: 0.28, peak: 0.7 });
    this._burst(out, { noise: 'pink', filter: 'lowpass', f0: 1600, f1: 240, dur: 0.2, peak: 0.5 });
  }

  tireSqueal(pos, amount) {
    if (!this.ready) return;
    const key = 'squeal';
    if (amount > 0.05) {
      if (!this._loops.has(key)) {
        const out = this._fxNode(pos, 0.35, 0.2);
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = 1200;
        const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 6;
        const g = this.ctx.createGain(); g.gain.value = 0;
        o.connect(f).connect(g).connect(out);
        o.start();
        this._loops.set(key, { g, o, stop: () => { try { o.stop(); } catch (e) { /* noop */ } } });
      }
      const L = this._loops.get(key);
      L.g.gain.setTargetAtTime(clamp(amount, 0, 1) * 0.25, this.ctx.currentTime, 0.05);
      L.o.frequency.setTargetAtTime(900 + amount * 1400, this.ctx.currentTime, 0.1);
    } else if (this._loops.has(key)) {
      const L = this._loops.get(key);
      L.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    }
  }

  gunShot(pos) {
    if (!this.ready) return;
    const out = this._fxNode(pos, 0.55, 0.5);
    this._burst(out, { noise: 'white', filter: 'lowpass', f0: 7000, f1: 300, dur: 0.14, peak: 0.85, attack: 0.002 });
    this._tone(out, { type: 'square', f0: 160, f1: 50, dur: 0.12, peak: 0.4 });
  }

  sonicBoom(pos) {
    if (!this.ready) return;
    const now = performance.now();
    if (now - this._lastBoom < 4000) return;
    this._lastBoom = now;
    const out = this._fxNode(pos, 1.3, 0.7);
    this._tone(out, { type: 'sine', f0: 60, f1: 18, dur: 1.4, peak: 1.0, attack: 0.004 });
    this._burst(out, { noise: 'brown', filter: 'lowpass', f0: 2400, f1: 60, dur: 1.0, peak: 0.9 });
  }

  thunder(pos) {
    if (!this.ready) return;
    const out = this._fxNode(pos, 1.0, 0.8);
    for (let i = 0; i < 4; i++) {
      this._burst(out, { noise: 'brown', filter: 'lowpass', f0: rand(300, 1400), f1: rand(40, 120), dur: rand(0.8, 2.4), peak: rand(0.3, 0.9), delay: rand(0, 0.8) });
    }
  }

  /** 경고음 루프: stall / overspeed / pullup / fire / gear */
  warning(kind, on) {
    if (!this.ready) return;
    const key = 'warn:' + kind;
    if (on && !this._warnings.has(key)) {
      const cfg = {
        stall: { f: 800, rate: 5.5, type: 'square', gain: 0.10 },
        overspeed: { f: 1500, rate: 11, type: 'square', gain: 0.07 },
        pullup: { f: 560, rate: 2.4, type: 'triangle', gain: 0.12 },
        fire: { f: 1000, rate: 3.0, type: 'square', gain: 0.12 },
        gear: { f: 700, rate: 1.6, type: 'sine', gain: 0.08 },
        master: { f: 440, rate: 2.0, type: 'sine', gain: 0.1 },
      }[kind] || { f: 900, rate: 4, type: 'square', gain: 0.08 };
      const o = this.ctx.createOscillator();
      o.type = cfg.type; o.frequency.value = cfg.f;
      const g = this.ctx.createGain(); g.gain.value = 0;
      const lfo = this.ctx.createOscillator();
      lfo.type = 'square'; lfo.frequency.value = cfg.rate;
      const lg = this.ctx.createGain(); lg.gain.value = cfg.gain;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(this.fxBus);
      o.start(); lfo.start();
      this._warnings.set(key, { o, lfo, g });
    } else if (!on && this._warnings.has(key)) {
      const w = this._warnings.get(key);
      try { w.o.stop(); w.lfo.stop(); } catch (e) { /* noop */ }
      this._warnings.delete(key);
    }
  }

  clearWarnings() {
    for (const [k, w] of this._warnings) {
      try { w.o.stop(); w.lfo.stop(); } catch (e) { /* noop */ }
      this._warnings.delete(k);
    }
  }

  /* ----------------------------- UI 사운드 ----------------------------- */
  ui(kind = 'click') {
    if (!this.ready) return;
    const out = this._fxNode(null, 0.5, 0.12);
    if (kind === 'click') {
      this._tone(out, { type: 'square', f0: 1250, f1: 620, dur: 0.055, peak: 0.16 });
      this._burst(out, { filter: 'highpass', f0: 3200, f1: 5200, dur: 0.04, peak: 0.09 });
    } else if (kind === 'hover') {
      this._tone(out, { type: 'sine', f0: 1750, f1: 1980, dur: 0.05, peak: 0.05 });
    } else if (kind === 'confirm') {
      this._tone(out, { type: 'sine', f0: 660, dur: 0.1, peak: 0.16 });
      this._tone(out, { type: 'sine', f0: 990, dur: 0.16, peak: 0.14, delay: 0.08 });
      this._tone(out, { type: 'sine', f0: 1320, dur: 0.3, peak: 0.1, delay: 0.16 });
    } else if (kind === 'back') {
      this._tone(out, { type: 'sine', f0: 620, f1: 320, dur: 0.16, peak: 0.14 });
    } else if (kind === 'error') {
      this._tone(out, { type: 'sawtooth', f0: 220, f1: 140, dur: 0.26, peak: 0.18 });
    } else if (kind === 'place') {
      this._tone(out, { type: 'triangle', f0: 900, f1: 1400, dur: 0.07, peak: 0.12 });
    } else if (kind === 'radio') {
      this._burst(out, { filter: 'bandpass', f0: 2200, f1: 1800, dur: 0.08, peak: 0.14, q: 6 });
      this._tone(out, { type: 'square', f0: 1800, dur: 0.05, peak: 0.06, delay: 0.09 });
    }
  }

  /** 메인 메뉴 앰비언트 — 느린 패드 코드 진행 + 바람 */
  music(on) {
    if (!this.ready) return;
    if (on && !this._loops.has('music')) {
      const ctx = this.ctx;
      const bus = ctx.createGain(); bus.gain.value = 0.0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
      const rev = ctx.createGain(); rev.gain.value = 0.6;
      bus.connect(lp).connect(this.musicBus);
      lp.connect(rev).connect(this.reverbSend);
      bus.gain.setTargetAtTime(0.5, ctx.currentTime, 2.0);

      const chords = [
        [130.81, 196.00, 246.94, 329.63],   // Cadd9
        [110.00, 164.81, 220.00, 277.18],   // Am
        [146.83, 220.00, 293.66, 349.23],   // Dm7
        [98.00, 146.83, 196.00, 246.94],    // G
      ];
      const oscs = [];
      for (let i = 0; i < 4; i++) {
        const o = ctx.createOscillator();
        o.type = i < 2 ? 'triangle' : 'sawtooth';
        const g = ctx.createGain(); g.gain.value = i < 2 ? 0.1 : 0.035;
        const det = ctx.createOscillator();
        det.frequency.value = 0.07 + i * 0.03;
        const dg = ctx.createGain(); dg.gain.value = 0.7;
        det.connect(dg).connect(o.frequency);
        o.connect(g).connect(bus);
        o.start(); det.start();
        oscs.push({ o, g, det });
      }
      // 고음 반짝임
      const shimmer = ctx.createOscillator();
      shimmer.type = 'sine';
      const sg = ctx.createGain(); sg.gain.value = 0.012;
      const slfo = ctx.createOscillator(); slfo.frequency.value = 0.13;
      const slg = ctx.createGain(); slg.gain.value = 0.012;
      slfo.connect(slg).connect(sg.gain);
      shimmer.connect(sg).connect(bus);
      shimmer.start(); slfo.start();

      let idx = 0;
      const step = () => {
        if (!this._loops.has('music')) return;
        const ch = chords[idx % chords.length];
        idx++;
        const t = ctx.currentTime;
        oscs.forEach((v, i) => v.o.frequency.setTargetAtTime(ch[i], t, 1.6));
        shimmer.frequency.setTargetAtTime(ch[3] * 4, t, 2.2);
      };
      step();
      const timer = setInterval(step, 7200);
      this._loops.set('music', {
        stop: () => {
          clearInterval(timer);
          bus.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
          setTimeout(() => {
            oscs.forEach((v) => { try { v.o.stop(); v.det.stop(); } catch (e) { /* noop */ } });
            try { shimmer.stop(); slfo.stop(); } catch (e) { /* noop */ }
          }, 1500);
        },
      });
    } else if (!on && this._loops.has('music')) {
      this._loops.get('music').stop();
      this._loops.delete('music');
    }
  }

  stopAll() {
    for (const [, l] of this._loops) l.stop();
    this._loops.clear();
    this.clearWarnings();
    for (const v of this.voices.slice()) this.removeVoice(v);
  }
}

export const Audio = new AudioEngine();
