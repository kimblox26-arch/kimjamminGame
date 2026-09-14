// 고요(GOYO) — 절차적 사운드
// 샘플 파일 없이 WebAudio 합성만으로 발소리·숨소리·바람·새·풀벌레·물소리·음악을 만든다.
import { clamp, clamp01, lerp, rand, randInt, pick, TAU } from '../core/utils.js';

/* ------------------------------------------------------------------ */
/* 버퍼                                                                */
/* ------------------------------------------------------------------ */
function noiseBuffer(ctx, seconds, type = 'white') {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'white') d[i] = w;
      else if (type === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
    }
  }
  return buf;
}

/** 숲의 잔향을 흉내낸 합성 임펄스 */
function impulse(ctx, seconds = 2.4, decay = 3.4) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      const n = (Math.random() * 2 - 1) * env;
      lp = lp + (n - lp) * 0.22;                    // 고역을 눌러 부드럽게
      d[i] = lp * (ch === 0 ? 1.0 : 0.94);
    }
    // 초기 반사
    for (let k = 0; k < 8; k++) {
      const idx = Math.floor(ctx.sampleRate * (0.012 + k * 0.017 + Math.random() * 0.008));
      if (idx < len) d[idx] += (Math.random() * 2 - 1) * 0.35 * Math.pow(1 - k / 8, 2);
    }
  }
  return buf;
}

/* ------------------------------------------------------------------ */
export class StrollAudio {
  constructor() {
    this.ready = false;
    this.enabled = true;
    this.volumes = { master: 0.85, ambient: 0.9, sfx: 0.95, music: 0.5 };
    this._breathT = 0;
    this._breathPhase = 0;
    this._stepAcc = 0;
    this._birdT = 4;
    this._crickT = 2;
    this._owlT = 30;
    this._frogT = 12;
    this._musicT = 1.5;
    this._chordIdx = 0;
    this._heartT = 0;
    this.listener = { x: 0, z: 0, sin: 0, cos: 1 };
  }

  /** 사용자 제스처 뒤에 호출해야 한다 */
  init() {
    if (this.ready) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = this.ctx = new Ctx();

    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    this.master.connect(comp).connect(ctx.destination);

    this.busAmbient = ctx.createGain(); this.busAmbient.gain.value = this.volumes.ambient;
    this.busSfx = ctx.createGain(); this.busSfx.gain.value = this.volumes.sfx;
    this.busMusic = ctx.createGain(); this.busMusic.gain.value = this.volumes.music;
    this.busAmbient.connect(this.master);
    this.busSfx.connect(this.master);
    this.busMusic.connect(this.master);

    // 잔향
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.9;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this.nWhite = noiseBuffer(ctx, 2, 'white');
    this.nPink = noiseBuffer(ctx, 3, 'pink');
    this.nBrown = noiseBuffer(ctx, 4, 'brown');

    this._buildWind();
    this._buildWater();
    this.ready = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }

  setVolume(kind, v) {
    this.volumes[kind] = v;
    if (!this.ready) return;
    const node = { master: this.master, ambient: this.busAmbient, sfx: this.busSfx, music: this.busMusic }[kind];
    if (node) node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /* ------------------------- 보조 도구 ------------------------- */
  _now() { return this.ctx.currentTime; }

  _src(buffer, loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = loop;
    return s;
  }

  _env(gain, t, peak, attack, decay, hold = 0) {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    if (hold) gain.gain.setValueAtTime(Math.max(peak, 0.0002), t + attack + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
  }

  /** 위치에 따른 좌우/거리 감쇠 */
  _spatial(x, z, refDist = 14, dest = null) {
    const ctx = this.ctx;
    const L = this.listener;
    const dx = x - L.x, dz = z - L.z;
    const dist = Math.hypot(dx, dz);
    // 카메라 오른쪽 벡터(cos(yaw), 0, -sin(yaw))에 투영해 좌우를 정한다
    const right = dx * L.cos - dz * L.sin;
    const pan = clamp(right / Math.max(dist, 0.6), -1, 1);
    const g = ctx.createGain();
    g.gain.value = 1 / (1 + dist / refDist) ** 1.4;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan * 0.85; g.connect(p); p.connect(dest || this.busSfx); }
    else g.connect(dest || this.busSfx);
    // 거리가 멀수록 고역이 줄어든다
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = clamp(16000 - dist * 220, 900, 16000);
    lp.connect(g);
    return { input: lp, gain: g, dist };
  }

  _sendReverb(node, amount = 0.25) {
    const g = this.ctx.createGain();
    g.gain.value = amount;
    node.connect(g);
    g.connect(this.reverb);
  }

  /* ------------------------- 바람 / 물 ------------------------- */
  _buildWind() {
    const ctx = this.ctx;
    // 저역 바람
    const src = this._src(this.nBrown, true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.0;
    src.connect(bp).connect(g).connect(this.busAmbient);
    src.start();

    // 나뭇잎 스치는 소리
    const lsrc = this._src(this.nWhite, true);
    const lbp = ctx.createBiquadFilter();
    lbp.type = 'bandpass'; lbp.frequency.value = 3200; lbp.Q.value = 0.55;
    const lhp = ctx.createBiquadFilter();
    lhp.type = 'highpass'; lhp.frequency.value = 1200;
    const lg = ctx.createGain(); lg.gain.value = 0;
    lsrc.connect(lbp).connect(lhp).connect(lg).connect(this.busAmbient);
    lsrc.start();

    this.wind = { g, bp, lg, lbp, gust: 0.4, gustTarget: 0.4, t: 0 };
  }

  _buildWater() {
    const ctx = this.ctx;
    const src = this._src(this.nPink, true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.9;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 300;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp).connect(hp).connect(g).connect(this.busAmbient);
    src.start();
    // 잔물결 진폭 변화
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.35;
    lfo.connect(lfoG).connect(g.gain);
    lfo.start();
    this.water = { g, bp };
  }

  /* ------------------------- 발소리 ------------------------- */
  footstep(surface = 'grass', intensity = 1, running = false, foot = 1) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now();
    const vol = clamp01(intensity) * (running ? 1.15 : 0.85);

    // 충격(저역)
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    const tf = surface === 'rock' ? 96 : surface === 'water' ? 70 : 72;
    thump.frequency.setValueAtTime(tf * rand(0.92, 1.1), t);
    thump.frequency.exponentialRampToValueAtTime(tf * 0.55, t + 0.08);
    const tg = ctx.createGain();
    this._env(tg, t, 0.16 * vol, 0.004, surface === 'rock' ? 0.06 : 0.1);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    thump.connect(tg);
    if (pan) { pan.pan.value = foot * 0.12; tg.connect(pan).connect(this.busSfx); }
    else tg.connect(this.busSfx);
    thump.start(t); thump.stop(t + 0.3);

    // 재질 노이즈
    const src = this._src(this.nWhite);
    src.playbackRate.value = rand(0.85, 1.2);
    const bp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    let decay = 0.12, peak = 0.16 * vol;

    switch (surface) {
      case 'grass':
        bp.type = 'bandpass'; bp.frequency.value = rand(1900, 2900); bp.Q.value = 0.7;
        decay = running ? 0.13 : 0.17; peak = 0.2 * vol;
        break;
      case 'dirt':
        bp.type = 'lowpass'; bp.frequency.value = rand(800, 1300); bp.Q.value = 0.9;
        decay = 0.09; peak = 0.24 * vol;
        break;
      case 'sand':
        bp.type = 'bandpass'; bp.frequency.value = rand(3800, 5600); bp.Q.value = 0.5;
        decay = 0.16; peak = 0.18 * vol;
        break;
      case 'rock':
        bp.type = 'bandpass'; bp.frequency.value = rand(2600, 4200); bp.Q.value = 2.2;
        decay = 0.07; peak = 0.2 * vol;
        break;
      case 'water':
        bp.type = 'bandpass'; bp.Q.value = 0.8;
        bp.frequency.setValueAtTime(500, t);
        bp.frequency.exponentialRampToValueAtTime(2600, t + 0.12);
        decay = 0.3; peak = 0.3 * vol;
        break;
      default:
        bp.type = 'bandpass'; bp.frequency.value = 2000; bp.Q.value = 0.8;
    }
    this._env(g, t, peak, 0.004, decay);
    src.connect(bp).connect(g);
    if (pan) g.connect(pan); else g.connect(this.busSfx);
    this._sendReverb(g, surface === 'rock' ? 0.3 : 0.14);
    src.start(t); src.stop(t + 0.6);

    // 돌길에서는 짧은 울림
    if (surface === 'rock') {
      const ring = ctx.createOscillator();
      ring.type = 'triangle';
      ring.frequency.value = rand(700, 1400);
      const rg = ctx.createGain();
      this._env(rg, t, 0.035 * vol, 0.003, 0.07);
      ring.connect(rg).connect(this.busSfx);
      ring.start(t); ring.stop(t + 0.2);
    }
    if (surface === 'water') this.splash(this.listener.x, this.listener.z, 0.35 * vol);

    // 옷깃 스치는 소리
    this.cloth(vol * (running ? 0.9 : 0.5));
  }

  cloth(intensity = 0.5) {
    if (!this.ready || !this.enabled || intensity < 0.05) return;
    const ctx = this.ctx, t = this._now();
    const src = this._src(this.nPink);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = rand(1400, 2400); bp.Q.value = 0.5;
    const g = ctx.createGain();
    this._env(g, t, 0.035 * intensity, 0.02, 0.16);
    src.connect(bp).connect(g).connect(this.busSfx);
    src.start(t); src.stop(t + 0.4);
  }

  splash(x, z, amount = 0.5) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now();
    const sp = this._spatial(x, z, 12);
    const src = this._src(this.nWhite);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + 0.14);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.45);
    const g = ctx.createGain();
    this._env(g, t, 0.26 * amount, 0.006, 0.4);
    src.connect(bp).connect(g).connect(sp.input);
    this._sendReverb(sp.gain, 0.2);
    src.start(t); src.stop(t + 0.8);

    // 물방울 톡
    const drop = ctx.createOscillator();
    drop.type = 'sine';
    drop.frequency.setValueAtTime(rand(700, 1300), t + 0.05);
    drop.frequency.exponentialRampToValueAtTime(rand(1600, 2600), t + 0.12);
    const dg = ctx.createGain();
    this._env(dg, t + 0.05, 0.05 * amount, 0.004, 0.09);
    drop.connect(dg).connect(sp.input);
    drop.start(t + 0.05); drop.stop(t + 0.3);
  }

  /* ------------------------- 호흡 ------------------------- */
  /** exertion 0(쉼)~1(전력질주 직후) */
  breath(inhale, exertion) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now();
    const src = this._src(this.nPink);
    src.playbackRate.value = rand(0.9, 1.1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = lerp(0.75, 1.5, exertion);
    const f0 = inhale ? lerp(420, 620, exertion) : lerp(330, 500, exertion);
    const f1 = inhale ? f0 * 1.9 : f0 * 0.62;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.linearRampToValueAtTime(f1, t + (inhale ? 0.35 : 0.45));
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 180;
    const g = ctx.createGain();
    const dur = lerp(inhale ? 0.75 : 0.95, inhale ? 0.32 : 0.38, exertion);
    const peak = lerp(0.03, 0.17, exertion) * (inhale ? 1 : 0.85);
    this._env(g, t, peak, dur * 0.35, dur * 0.65);
    src.connect(bp).connect(hp).connect(g).connect(this.busSfx);
    this._sendReverb(g, 0.06);
    src.start(t); src.stop(t + dur + 0.3);

    // 거친 숨에는 성대의 떨림이 섞인다
    if (exertion > 0.55 && !inhale) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(rand(110, 150), t);
      o.frequency.exponentialRampToValueAtTime(rand(80, 110), t + dur);
      const og = ctx.createGain();
      this._env(og, t, 0.012 * (exertion - 0.5) * 2, dur * 0.3, dur * 0.6);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      o.connect(lp).connect(og).connect(this.busSfx);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }

  heartbeat(intensity) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now();
    for (const [off, amp] of [[0, 1], [0.19, 0.7]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(62, t + off);
      o.frequency.exponentialRampToValueAtTime(38, t + off + 0.12);
      const g = ctx.createGain();
      this._env(g, t + off, 0.1 * intensity * amp, 0.006, 0.13);
      o.connect(g).connect(this.busSfx);
      o.start(t + off); o.stop(t + off + 0.35);
    }
  }

  /* ------------------------- 동물 소리 ------------------------- */
  chirp(x, z, style = 'warble', vol = 1) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const sp = this._spatial(x, z, 22);
    this._sendReverb(sp.gain, 0.35);
    const t0 = this._now() + rand(0, 0.1);
    const base = rand(2100, 3600);
    const notes = style === 'trill' ? randInt(5, 9) : style === 'whistle' ? 1 : randInt(2, 4);
    for (let i = 0; i < notes; i++) {
      const t = t0 + i * (style === 'trill' ? rand(0.055, 0.08) : rand(0.11, 0.2));
      const dur = style === 'whistle' ? rand(0.3, 0.55) : rand(0.05, 0.11);
      const f = base * rand(0.88, 1.14) * (1 + i * 0.02);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * (style === 'whistle' ? 0.8 : 0.92), t);
      o.frequency.exponentialRampToValueAtTime(f * rand(1.05, 1.3), t + dur * 0.55);
      o.frequency.exponentialRampToValueAtTime(f * rand(0.8, 1.0), t + dur);
      const g = ctx.createGain();
      this._env(g, t, 0.055 * vol, dur * 0.25, dur * 0.8);
      // 배음을 조금 섞어 새소리다운 질감을 만든다
      const o2 = ctx.createOscillator();
      o2.type = 'triangle';
      o2.frequency.setValueAtTime(f * 2, t);
      o2.frequency.exponentialRampToValueAtTime(f * 2.3, t + dur);
      const g2 = ctx.createGain();
      this._env(g2, t, 0.012 * vol, dur * 0.3, dur * 0.7);
      o.connect(g).connect(sp.input);
      o2.connect(g2).connect(sp.input);
      o.start(t); o.stop(t + dur + 0.1);
      o2.start(t); o2.stop(t + dur + 0.1);
    }
  }

  animalCall(kind, x, z, vol = 1) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now();
    const sp = this._spatial(x, z, 18);
    this._sendReverb(sp.gain, 0.3);

    if (kind === 'deer') {
      // 콧바람 섞인 울음
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(rand(300, 380), t);
      o.frequency.exponentialRampToValueAtTime(rand(180, 240), t + 0.4);
      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass'; f1.frequency.value = 700; f1.Q.value = 3;
      const g = ctx.createGain();
      this._env(g, t, 0.1 * vol, 0.03, 0.45);
      o.connect(f1).connect(g).connect(sp.input);
      o.start(t); o.stop(t + 0.7);
      const n = this._src(this.nWhite);
      const nb = ctx.createBiquadFilter();
      nb.type = 'bandpass'; nb.frequency.value = 1500; nb.Q.value = 0.8;
      const ng = ctx.createGain();
      this._env(ng, t, 0.05 * vol, 0.02, 0.35);
      n.connect(nb).connect(ng).connect(sp.input);
      n.start(t); n.stop(t + 0.6);
    } else if (kind === 'fox') {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(rand(850, 1050), t);
      o.frequency.exponentialRampToValueAtTime(rand(420, 560), t + 0.22);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 2200;
      const g = ctx.createGain();
      this._env(g, t, 0.075 * vol, 0.01, 0.22);
      o.connect(lp).connect(g).connect(sp.input);
      o.start(t); o.stop(t + 0.4);
    } else if (kind === 'rabbit') {
      // 발구르기
      for (let i = 0; i < 3; i++) {
        const tt = t + i * 0.16;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(90, tt);
        o.frequency.exponentialRampToValueAtTime(48, tt + 0.09);
        const g = ctx.createGain();
        this._env(g, tt, 0.09 * vol, 0.004, 0.11);
        o.connect(g).connect(sp.input);
        o.start(tt); o.stop(tt + 0.25);
      }
    }
  }

  owl(x, z) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now();
    const sp = this._spatial(x, z, 40);
    this._sendReverb(sp.gain, 0.5);
    for (const [off, len] of [[0, 0.45], [0.75, 0.6]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f = rand(270, 330);
      o.frequency.setValueAtTime(f, t + off);
      o.frequency.linearRampToValueAtTime(f * 0.93, t + off + len);
      const vib = ctx.createOscillator();
      vib.frequency.value = 11;
      const vibG = ctx.createGain(); vibG.gain.value = 5;
      vib.connect(vibG).connect(o.frequency);
      const g = ctx.createGain();
      this._env(g, t + off, 0.075, 0.09, len);
      o.connect(g).connect(sp.input);
      o.start(t + off); o.stop(t + off + len + 0.2);
      vib.start(t + off); vib.stop(t + off + len + 0.2);
    }
  }

  cricket(x, z, vol = 1) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t0 = this._now();
    const sp = this._spatial(x, z, 16);
    const pulses = randInt(3, 6);
    const f = rand(4200, 5200);
    for (let i = 0; i < pulses; i++) {
      const t = t0 + i * 0.075;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 12;
      const g = ctx.createGain();
      this._env(g, t, 0.03 * vol, 0.004, 0.035);
      o.connect(bp).connect(g).connect(sp.input);
      o.start(t); o.stop(t + 0.09);
    }
  }

  frog(x, z, vol = 1) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now();
    const sp = this._spatial(x, z, 26);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = rand(150, 230);
    const am = ctx.createOscillator();
    am.type = 'square';
    am.frequency.value = rand(22, 34);
    const amG = ctx.createGain(); amG.gain.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = 0;
    am.connect(amG).connect(g.gain);
    this._env(g, t, 0.06 * vol, 0.03, 0.26);
    o.connect(lp).connect(g).connect(sp.input);
    o.start(t); o.stop(t + 0.45);
    am.start(t); am.stop(t + 0.45);
  }

  /* ------------------------- 음악 ------------------------- */
  _chord(notes, dur) {
    const ctx = this.ctx, t = this._now();
    for (let i = 0; i < notes.length; i++) {
      const f = notes[i];
      for (const [mul, amp, type] of [[1, 1, 'sine'], [2, 0.28, 'sine'], [3.01, 0.1, 'triangle']]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f * mul * rand(0.999, 1.001);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05 * amp / (i + 1), t + dur * 0.35);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 1800;
        o.connect(lp).connect(g).connect(this.busMusic);
        this._sendReverb(g, 0.5);
        o.start(t); o.stop(t + dur + 0.2);
      }
    }
  }

  _pluck(freq) {
    const ctx = this.ctx, t = this._now();
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * 2.01;
    const modG = ctx.createGain(); modG.gain.value = freq * 1.2;
    mod.connect(modG).connect(o.frequency);
    const g = ctx.createGain();
    this._env(g, t, 0.07, 0.01, 1.9);
    o.connect(g).connect(this.busMusic);
    this._sendReverb(g, 0.7);
    o.start(t); o.stop(t + 2.4);
    mod.start(t); mod.stop(t + 2.4);
  }

  /* ------------------------- 프레임 갱신 ------------------------- */
  /**
   * ctx: { dt, exertion, windStrength, treeDensity, waterDist, night, dayFactor,
   *        player:{x,z}, yaw, moving, music }
   */
  update(s) {
    if (!this.ready || !this.enabled) return;
    const dt = Math.min(s.dt, 0.1);
    this.listener.x = s.player.x;
    this.listener.z = s.player.z;
    this.listener.sin = Math.sin(s.yaw);
    this.listener.cos = Math.cos(s.yaw);

    // 바람 — 완만한 무작위 돌풍
    const w = this.wind;
    w.t -= dt;
    if (w.t <= 0) { w.t = rand(2.5, 9); w.gustTarget = rand(0.15, 1); }
    w.gust += (w.gustTarget - w.gust) * Math.min(1, dt * 0.5);
    const base = clamp01(s.windStrength);
    const wg = (0.012 + w.gust * 0.05) * lerp(0.5, 1.25, base);
    w.g.gain.setTargetAtTime(wg, this.ctx.currentTime, 0.4);
    w.bp.frequency.setTargetAtTime(lerp(300, 900, w.gust), this.ctx.currentTime, 0.8);
    const leaves = (0.004 + w.gust * 0.03) * clamp01(s.treeDensity) * lerp(0.6, 1.3, base);
    w.lg.gain.setTargetAtTime(leaves, this.ctx.currentTime, 0.4);
    w.lbp.frequency.setTargetAtTime(lerp(2400, 4200, w.gust), this.ctx.currentTime, 0.9);
    this.gust = w.gust;

    // 물가
    const wd = s.waterDist;
    const wv = clamp01(1 - wd / 55) ** 1.6 * 0.09;
    this.water.g.gain.setTargetAtTime(wv, this.ctx.currentTime, 0.5);

    // 호흡 — 운동량에 따라 빨라지고 커진다
    const ex = clamp01(s.exertion);
    this._breathT -= dt;
    if (this._breathT <= 0) {
      const period = lerp(4.4, 1.15, ex);
      this._breathPhase ^= 1;
      this._breathT = period * (this._breathPhase ? 0.45 : 0.55) * rand(0.92, 1.08);
      this.breath(this._breathPhase === 1, ex);
    }
    if (ex > 0.72) {
      this._heartT -= dt;
      if (this._heartT <= 0) {
        this._heartT = lerp(0.85, 0.44, clamp01((ex - 0.7) / 0.3));
        this.heartbeat(clamp01((ex - 0.7) / 0.3) * 0.8);
      }
    }

    // 새 — 낮에, 특히 아침에 많이 운다
    const dayBias = clamp01(s.dayFactor) * (1 - clamp01(s.night));
    this._birdT -= dt;
    if (this._birdT <= 0) {
      this._birdT = lerp(14, 2.2, dayBias * clamp01(s.treeDensity + 0.35)) * rand(0.6, 1.5);
      if (dayBias > 0.12) {
        const a = rand(0, TAU), d = rand(6, 45);
        this.chirp(s.player.x + Math.cos(a) * d, s.player.z + Math.sin(a) * d,
          pick(['warble', 'warble', 'trill', 'whistle']), rand(0.5, 1));
      }
    }

    // 밤 — 풀벌레 / 부엉이 / 개구리
    const nightBias = clamp01(s.night);
    this._crickT -= dt;
    if (this._crickT <= 0) {
      this._crickT = lerp(3.5, 0.45, nightBias) * rand(0.5, 1.6);
      if (nightBias > 0.15) {
        const a = rand(0, TAU), d = rand(3, 26);
        this.cricket(s.player.x + Math.cos(a) * d, s.player.z + Math.sin(a) * d, rand(0.4, 1) * nightBias);
      }
    }
    this._owlT -= dt;
    if (this._owlT <= 0) {
      this._owlT = rand(25, 80);
      if (nightBias > 0.4) {
        const a = rand(0, TAU), d = rand(25, 70);
        this.owl(s.player.x + Math.cos(a) * d, s.player.z + Math.sin(a) * d);
      }
    }
    this._frogT -= dt;
    if (this._frogT <= 0) {
      this._frogT = rand(1.5, 6);
      if (wd < 45 && (nightBias > 0.3 || Math.random() < 0.3)) {
        const a = rand(0, TAU), d = rand(4, 20);
        this.frog(s.player.x + Math.cos(a) * d, s.player.z + Math.sin(a) * d, clamp01(1 - wd / 45));
      }
    }

    // 음악 — 아주 느린 화음
    if (s.music) {
      this._musicT -= dt;
      if (this._musicT <= 0) {
        this._musicT = rand(11, 17);
        const prog = [
          [174.61, 261.63, 329.63],   // F  A  C... (F maj)
          [196.00, 293.66, 349.23],   // G  D  F
          [146.83, 220.00, 293.66],   // D  A  D
          [130.81, 196.00, 261.63],   // C  G  C
        ];
        const chord = prog[this._chordIdx % prog.length];
        this._chordIdx++;
        this._chord(chord, rand(10, 15));
        const scale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33];
        setTimeout(() => { if (this.ready) this._pluck(pick(scale)); }, rand(500, 3500));
        setTimeout(() => { if (this.ready && Math.random() < 0.6) this._pluck(pick(scale) * 2); }, rand(3500, 8000));
      }
    }
  }
}

export const Audio = new StrollAudio();
