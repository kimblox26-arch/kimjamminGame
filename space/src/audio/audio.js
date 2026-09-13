// ORBITER — 사운드
// 외부 오디오 파일 없이 WebAudio 로 전부 합성한다.
// 로켓 굉음, 대기 마찰음, 폭발, RCS, 경고음, UI 클릭, 그리고 앰비언트 음악.

import { clamp, clamp01, lerp, rand } from '../core/math.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.master = null;
    this.buses = {};
    this.volumes = { master: 0.8, sfx: 0.9, music: 0.5, ui: 0.7 };
    this.loops = new Map();
    this.noiseBuffer = null;
    this.musicNodes = null;
    this.suspended = false;
  }

  /** 사용자 제스처 이후에 호출해야 한다 */
  init() {
    if (this.ready) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      console.warn('[audio] WebAudio 를 지원하지 않는 브라우저입니다.');
      this.enabled = false;
      return false;
    }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(this.ctx.destination);

    // 약간의 룸 리버브 — 발사대 울림
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(1.8, 2.4);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.18;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    for (const name of ['sfx', 'music', 'ui']) {
      const g = this.ctx.createGain();
      g.gain.value = this.volumes[name];
      g.connect(this.master);
      this.buses[name] = g;
    }
    this.buses.sfx.connect(this.reverb);

    this.noiseBuffer = this._makeNoise(4);
    this.ready = true;
    return true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    this.suspended = false;
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
    this.suspended = true;
  }

  setVolume(name, value) {
    this.volumes[name] = clamp01(value);
    if (!this.ready) return;
    if (name === 'master') this.master.gain.value = this.volumes.master;
    else if (this.buses[name]) this.buses[name].gain.value = this.volumes[name];
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /* ── 버퍼 생성 ────────────────────────────────────────── */

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    // 브라운 노이즈 — 로켓 굉음에 가깝다
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buf;
  }

  _makeImpulse(duration, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * duration);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] =
          (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /* ── 저수준 헬퍼 ──────────────────────────────────────── */

  _osc(type, freq, bus = 'sfx') {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  }

  _gain(value = 1) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return g;
  }

  _filter(type, freq, q = 1) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  _noiseSource(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuffer;
    s.loop = loop;
    return s;
  }

  /* ── 지속음 (엔진, 바람) ──────────────────────────────── */

  /**
   * 로켓 엔진 루프 시작.
   * @param {string} id 식별자 (엔진별)
   * @param {object} opts { size: 0..1 }
   */
  startEngine(id, opts = {}) {
    if (!this.ready || this.loops.has(id)) return;
    const size = clamp01(opts.size ?? 0.5);

    const noise = this._noiseSource();
    const lp = this._filter('lowpass', lerp(900, 260, size), 0.8);
    const bp = this._filter('bandpass', lerp(160, 55, size), 1.4);
    const gain = this._gain(0);

    // 저역 럼블 오실레이터
    const rumble = this._osc('sawtooth', lerp(70, 26, size));
    const rumbleGain = this._gain(0);

    noise.connect(lp);
    lp.connect(bp);
    bp.connect(gain);
    rumble.connect(rumbleGain);
    rumbleGain.connect(gain);
    gain.connect(this.buses.sfx);

    noise.start();
    rumble.start();

    this.loops.set(id, {
      kind: 'engine',
      nodes: [noise, rumble],
      gain,
      rumbleGain,
      lp,
      bp,
      size,
    });
  }

  /**
   * 엔진 파라미터 갱신.
   * @param {number} throttle 0..1
   * @param {number} atmo 0..1 (대기 밀도 — 진공에서는 소리가 작아진다)
   */
  updateEngine(id, throttle, atmo = 1) {
    const l = this.loops.get(id);
    if (!l || !this.ready) return;
    const t = clamp01(throttle);
    const vol = t * lerp(0.06, 0.42, clamp01(atmo)) + t * 0.06;
    const now = this.now;
    l.gain.gain.setTargetAtTime(vol, now, 0.08);
    l.rumbleGain.gain.setTargetAtTime(t * 0.22, now, 0.12);
    l.lp.frequency.setTargetAtTime(
      lerp(400, 1800, t) * lerp(0.6, 1, clamp01(atmo)),
      now,
      0.15
    );
  }

  stopEngine(id, fade = 0.25) {
    const l = this.loops.get(id);
    if (!l) return;
    const now = this.now;
    l.gain.gain.setTargetAtTime(0, now, fade / 3);
    setTimeout(() => {
      for (const n of l.nodes) {
        try {
          n.stop();
        } catch (e) {
          /* 이미 정지됨 */
        }
      }
      this.loops.delete(id);
    }, fade * 1000 + 120);
  }

  /** 대기 마찰(바람) 루프 */
  startWind() {
    if (!this.ready || this.loops.has('wind')) return;
    const noise = this._noiseSource();
    const bp = this._filter('bandpass', 600, 0.7);
    const hp = this._filter('highpass', 200);
    const gain = this._gain(0);
    noise.connect(bp);
    bp.connect(hp);
    hp.connect(gain);
    gain.connect(this.buses.sfx);
    noise.start();
    this.loops.set('wind', { kind: 'wind', nodes: [noise], gain, bp });
  }

  /**
   * @param {number} q 동압 (Pa)
   * @param {number} mach
   */
  updateWind(q, mach) {
    const l = this.loops.get('wind');
    if (!l || !this.ready) return;
    const vol = clamp01(q / 40000) * 0.4;
    const now = this.now;
    l.gain.gain.setTargetAtTime(vol, now, 0.15);
    l.bp.frequency.setTargetAtTime(
      clamp(400 + mach * 900, 200, 4200),
      now,
      0.2
    );
  }

  stopWind() {
    this.stopEngine('wind', 0.4);
  }

  /** 재진입 플라즈마 굉음 */
  startReentry() {
    if (!this.ready || this.loops.has('reentry')) return;
    const noise = this._noiseSource();
    const lp = this._filter('lowpass', 700, 1.2);
    const gain = this._gain(0);
    noise.connect(lp);
    lp.connect(gain);
    gain.connect(this.buses.sfx);
    noise.start();
    this.loops.set('reentry', { kind: 'reentry', nodes: [noise], gain, lp });
  }

  updateReentry(intensity) {
    const l = this.loops.get('reentry');
    if (!l) return;
    l.gain.gain.setTargetAtTime(clamp01(intensity) * 0.45, this.now, 0.2);
  }

  stopReentry() {
    this.stopEngine('reentry', 0.6);
  }

  /* ── 단발 효과음 ──────────────────────────────────────── */

  play(name, opts = {}) {
    if (!this.ready || !this.enabled) return;
    const fn = this[`sfx_${name}`];
    if (typeof fn === 'function') fn.call(this, opts);
  }

  sfx_explosion(opts = {}) {
    const scale = opts.scale ?? 1;
    const now = this.now;
    const noise = this._noiseSource(false);
    const lp = this._filter('lowpass', 1400 / scale, 0.9);
    const gain = this._gain(0.8 * clamp01(scale));
    noise.connect(lp);
    lp.connect(gain);
    gain.connect(this.buses.sfx);
    gain.gain.setValueAtTime(0.9 * clamp01(scale), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.6 * scale);
    lp.frequency.setValueAtTime(2200, now);
    lp.frequency.exponentialRampToValueAtTime(90, now + 1.4 * scale);
    noise.start(now);
    noise.stop(now + 2 * scale);

    // 저역 붐
    const boom = this._osc('sine', 64);
    const bg = this._gain(0.6 * scale);
    boom.connect(bg);
    bg.connect(this.buses.sfx);
    boom.frequency.setValueAtTime(90, now);
    boom.frequency.exponentialRampToValueAtTime(26, now + 0.7);
    bg.gain.setValueAtTime(0.55 * scale, now);
    bg.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    boom.start(now);
    boom.stop(now + 1);
  }

  sfx_stage(opts = {}) {
    const now = this.now;
    const noise = this._noiseSource(false);
    const bp = this._filter('bandpass', 900, 1.6);
    const gain = this._gain(0.45);
    noise.connect(bp);
    bp.connect(gain);
    gain.connect(this.buses.sfx);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    noise.start(now);
    noise.stop(now + 0.6);

    const clank = this._osc('square', 220);
    const cg = this._gain(0.18);
    clank.connect(cg);
    cg.connect(this.buses.sfx);
    cg.gain.setValueAtTime(0.2, now);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    clank.start(now);
    clank.stop(now + 0.25);
  }

  sfx_rcs() {
    const now = this.now;
    const noise = this._noiseSource(false);
    const hp = this._filter('highpass', 1800);
    const gain = this._gain(0.12);
    noise.connect(hp);
    hp.connect(gain);
    gain.connect(this.buses.sfx);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    noise.start(now);
    noise.stop(now + 0.2);
  }

  sfx_chute() {
    const now = this.now;
    const noise = this._noiseSource(false);
    const bp = this._filter('bandpass', 500, 0.8);
    const gain = this._gain(0.3);
    noise.connect(bp);
    bp.connect(gain);
    gain.connect(this.buses.sfx);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
    noise.start(now);
    noise.stop(now + 1.2);
  }

  sfx_touchdown(opts = {}) {
    const now = this.now;
    const scale = clamp01(opts.scale ?? 0.5);
    const thud = this._osc('sine', 110);
    const g = this._gain(0.3 * scale + 0.1);
    thud.connect(g);
    g.connect(this.buses.sfx);
    thud.frequency.setValueAtTime(130, now);
    thud.frequency.exponentialRampToValueAtTime(45, now + 0.3);
    g.gain.setValueAtTime(0.35, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    thud.start(now);
    thud.stop(now + 0.5);
  }

  sfx_splash() {
    const now = this.now;
    const noise = this._noiseSource(false);
    const bp = this._filter('bandpass', 1400, 0.6);
    const gain = this._gain(0.4);
    noise.connect(bp);
    bp.connect(gain);
    gain.connect(this.buses.sfx);
    bp.frequency.setValueAtTime(2400, now);
    bp.frequency.exponentialRampToValueAtTime(320, now + 0.8);
    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    noise.start(now);
    noise.stop(now + 1.1);
  }

  sfx_warning(opts = {}) {
    const now = this.now;
    const freq = opts.freq ?? 880;
    for (let i = 0; i < 2; i++) {
      const o = this._osc('square', freq);
      const g = this._gain(0);
      o.connect(g);
      g.connect(this.buses.ui);
      const t = now + i * 0.18;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + 0.12);
      o.start(t);
      o.stop(t + 0.14);
    }
  }

  sfx_success() {
    const now = this.now;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const o = this._osc('triangle', f);
      const g = this._gain(0);
      o.connect(g);
      g.connect(this.buses.ui);
      const t = now + i * 0.09;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.start(t);
      o.stop(t + 0.55);
    });
  }

  sfx_fail() {
    const now = this.now;
    const notes = [440, 370, 294];
    notes.forEach((f, i) => {
      const o = this._osc('sawtooth', f);
      const g = this._gain(0);
      const lp = this._filter('lowpass', 1200);
      o.connect(lp);
      lp.connect(g);
      g.connect(this.buses.ui);
      const t = now + i * 0.14;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.13, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      o.start(t);
      o.stop(t + 0.65);
    });
  }

  sfx_click() {
    const now = this.now;
    const o = this._osc('square', 1400);
    const g = this._gain(0);
    o.connect(g);
    g.connect(this.buses.ui);
    g.gain.setValueAtTime(0.07, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    o.start(now);
    o.stop(now + 0.06);
  }

  sfx_place() {
    const now = this.now;
    const o = this._osc('sine', 520);
    const g = this._gain(0);
    o.connect(g);
    g.connect(this.buses.ui);
    o.frequency.setValueAtTime(420, now);
    o.frequency.linearRampToValueAtTime(640, now + 0.07);
    g.gain.setValueAtTime(0.11, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    o.start(now);
    o.stop(now + 0.14);
  }

  sfx_sonicBoom() {
    const now = this.now;
    const noise = this._noiseSource(false);
    const lp = this._filter('lowpass', 400, 1.5);
    const gain = this._gain(0.5);
    noise.connect(lp);
    lp.connect(gain);
    gain.connect(this.buses.sfx);
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    noise.start(now);
    noise.stop(now + 0.8);
  }

  sfx_dock() {
    const now = this.now;
    const o = this._osc('sine', 300);
    const g = this._gain(0);
    o.connect(g);
    g.connect(this.buses.sfx);
    g.gain.setValueAtTime(0.2, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    o.frequency.setValueAtTime(300, now);
    o.frequency.linearRampToValueAtTime(180, now + 0.3);
    o.start(now);
    o.stop(now + 0.4);
  }

  /* ── 앰비언트 음악 ────────────────────────────────────── */

  /**
   * 느린 패드 코드 진행 — 메뉴/우주 배경용.
   */
  startMusic(mood = 'space') {
    if (!this.ready || this.musicNodes) return;
    const ctx = this.ctx;
    const out = this._gain(0);
    out.connect(this.buses.music);

    const chords =
      mood === 'tension'
        ? [
            [146.83, 174.61, 220.0],
            [130.81, 164.81, 196.0],
            [155.56, 185.0, 233.08],
          ]
        : [
            [130.81, 164.81, 196.0],
            [146.83, 174.61, 220.0],
            [110.0, 138.59, 164.81],
            [123.47, 155.56, 185.0],
          ];

    const voices = [];
    for (let i = 0; i < 3; i++) {
      const o = this._osc('sine', chords[0][i]);
      const g = this._gain(0.2 / (i + 1));
      const lp = this._filter('lowpass', 900);
      o.connect(lp);
      lp.connect(g);
      g.connect(out);
      o.start();
      voices.push({ osc: o, gain: g });
    }

    // 아주 느린 노이즈 스웰
    const pad = this._noiseSource();
    const padFilter = this._filter('bandpass', 320, 0.5);
    const padGain = this._gain(0.02);
    pad.connect(padFilter);
    padFilter.connect(padGain);
    padGain.connect(out);
    pad.start();

    out.gain.setTargetAtTime(0.5, this.now, 2.5);

    let chordIndex = 0;
    const timer = setInterval(() => {
      chordIndex = (chordIndex + 1) % chords.length;
      const chord = chords[chordIndex];
      const now = this.now;
      voices.forEach((v, i) => {
        v.osc.frequency.setTargetAtTime(chord[i], now, 1.8);
      });
      padFilter.frequency.setTargetAtTime(rand(220, 520), now, 3);
    }, 8000);

    this.musicNodes = { out, voices, pad, timer };
  }

  stopMusic(fade = 2) {
    if (!this.musicNodes) return;
    const m = this.musicNodes;
    this.musicNodes = null;
    clearInterval(m.timer);
    m.out.gain.setTargetAtTime(0, this.now, fade / 3);
    setTimeout(() => {
      try {
        for (const v of m.voices) v.osc.stop();
        m.pad.stop();
      } catch (e) {
        /* 이미 정지 */
      }
    }, fade * 1000 + 200);
  }

  /** 모든 루프 정지 */
  stopAll() {
    for (const id of [...this.loops.keys()]) this.stopEngine(id, 0.2);
    this.stopMusic(0.5);
  }
}

/** 전역 인스턴스 */
export const audio = new AudioEngine();
