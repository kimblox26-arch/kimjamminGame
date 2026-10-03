// SKYBREAKER — 전투 효과음 + 합성 음악 (기존 AudioEngine 위에 구축)
import { Audio } from '../../src/core/audio.js';

const rand = (a, b) => a + Math.random() * (b - a);

class FighterSfx {
  constructor() {
    this._loops = new Map();
    this._music = null;
  }
  get ok() { return Audio.ready && Audio.ctx; }

  /** 기관포 연사 루프 (총열 회전 + 발사 파열) */
  gun(on, rof = 80, heavy = false) {
    if (!this.ok) return;
    const ctx = Audio.ctx;
    let L = this._loops.get('gun');
    if (on && !L) {
      const out = Audio._fxNode(null, heavy ? 0.95 : 0.8, 0.35);
      const src = ctx.createBufferSource();
      src.buffer = Audio.noise.white; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = heavy ? 1600 : 3200; f.Q.value = 0.8;
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = Math.min(rof, 110);
      const lg = ctx.createGain(); lg.gain.value = 0.42;
      lfo.connect(lg).connect(g.gain);
      const body = ctx.createOscillator(); body.type = 'sawtooth'; body.frequency.value = heavy ? 42 : Math.min(rof, 95);
      const bg = ctx.createGain(); bg.gain.value = heavy ? 0.5 : 0.3;
      const bf = ctx.createBiquadFilter(); bf.type = 'lowpass'; bf.frequency.value = 420;
      src.connect(f).connect(g).connect(out);
      body.connect(bf).connect(bg).connect(out);
      const master = out.gain;
      master.setValueAtTime(0.0001, ctx.currentTime);
      master.exponentialRampToValueAtTime(heavy ? 0.95 : 0.8, ctx.currentTime + 0.02);
      src.start(); lfo.start(); body.start();
      L = { out, stop: () => {
        const t = ctx.currentTime;
        master.cancelScheduledValues(t);
        master.setTargetAtTime(0, t, 0.03);
        setTimeout(() => { try { src.stop(); lfo.stop(); body.stop(); out.disconnect(); } catch (e) { /* noop */ } }, 300);
        // 총열 감속 여운
        const o2 = Audio._fxNode(null, 0.25, 0.3);
        Audio._tone(o2, { type: 'sawtooth', f0: 180, f1: 40, dur: 0.35, peak: 0.25 });
      } };
      this._loops.set('gun', L);
    } else if (!on && L) {
      L.stop();
      this._loops.delete('gun');
    }
  }

  missileLaunch() {
    if (!this.ok) return;
    const out = Audio._fxNode(null, 1.0, 0.5);
    Audio._tone(out, { type: 'sine', f0: 140, f1: 45, dur: 0.35, peak: 0.8 });
    Audio._burst(out, { noise: 'white', filter: 'bandpass', f0: 600, f1: 3800, dur: 1.4, peak: 0.7, q: 0.8, attack: 0.05 });
    Audio._burst(out, { noise: 'brown', filter: 'lowpass', f0: 1800, f1: 200, dur: 1.8, peak: 0.6 });
  }

  /** 락온 탐색음(그롤) / 락 확정음 */
  lockTone(state) {
    if (!this.ok) return;
    const ctx = Audio.ctx;
    let L = this._loops.get('lock');
    if (state === 'off') {
      if (L) { L.stop(); this._loops.delete('lock'); }
      return;
    }
    if (!L) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 900;
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 9;
      const lg = ctx.createGain(); lg.gain.value = 0.05;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(Audio.fxBus);
      o.start(); lfo.start();
      L = { o, g, lfo, lg, state: '', stop: () => { try { o.stop(); lfo.stop(); } catch (e) { /* noop */ } } };
      this._loops.set('lock', L);
    }
    if (L.state !== state) {
      const t = ctx.currentTime;
      if (state === 'seek') { L.o.frequency.setTargetAtTime(880, t, 0.02); L.lfo.frequency.setTargetAtTime(8, t, 0.02); L.lg.gain.setTargetAtTime(0.05, t, 0.02); L.g.gain.setTargetAtTime(0.0, t, 0.02); }
      else if (state === 'lock') { L.o.frequency.setTargetAtTime(1760, t, 0.01); L.lfo.frequency.setTargetAtTime(0.001, t, 0.01); L.lg.gain.setTargetAtTime(0, t, 0.01); L.g.gain.setTargetAtTime(0.09, t, 0.01); }
      L.state = state;
    }
  }

  /** 명중 틱 (쾌감용 짧은 고음) */
  hit(heavy = false) {
    if (!this.ok) return;
    const now = Audio.ctx.currentTime;
    if (this._lastHit && now - this._lastHit < 0.045) return;
    this._lastHit = now;
    const out = Audio._fxNode(null, 0.5, 0.05);
    Audio._tone(out, { type: 'square', f0: heavy ? 1800 : 2600, f1: heavy ? 900 : 1700, dur: 0.05, peak: 0.22 });
    Audio._burst(out, { noise: 'white', filter: 'highpass', f0: 4000, f1: 6000, dur: 0.04, peak: 0.2 });
    if (heavy) Audio._tone(out, { type: 'sine', f0: 220, f1: 90, dur: 0.12, peak: 0.4 });
  }

  /** 격추 확정: 저음 드롭 + 상승 차임 */
  kill(combo = 1) {
    if (!this.ok) return;
    const out = Audio._fxNode(null, 0.9, 0.4);
    Audio._tone(out, { type: 'sine', f0: 110, f1: 32, dur: 0.9, peak: 0.9, attack: 0.004 });
    const base = 660 * Math.pow(1.122, Math.min(combo - 1, 6));
    Audio._tone(out, { type: 'triangle', f0: base, dur: 0.12, peak: 0.22, delay: 0.05 });
    Audio._tone(out, { type: 'triangle', f0: base * 1.5, dur: 0.18, peak: 0.2, delay: 0.13 });
    Audio._tone(out, { type: 'sine', f0: base * 2, dur: 0.5, peak: 0.16, delay: 0.22 });
  }

  flare() {
    if (!this.ok) return;
    const out = Audio._fxNode(null, 0.5, 0.3);
    for (let i = 0; i < 3; i++) Audio._burst(out, { noise: 'white', filter: 'highpass', f0: 2000, f1: 5000, dur: 0.12, peak: 0.35, delay: i * 0.09 });
    Audio._tone(out, { type: 'sine', f0: 320, f1: 120, dur: 0.15, peak: 0.25 });
  }

  /** 근접 통과 휙 소리 */
  flyby(pos) {
    if (!this.ok) return;
    const out = Audio._fxNode(pos, 1.2, 0.5);
    Audio._burst(out, { noise: 'pink', filter: 'bandpass', f0: 3000, f1: 300, dur: 1.2, peak: 0.9, q: 0.7, attack: 0.25 });
    Audio._burst(out, { noise: 'brown', filter: 'lowpass', f0: 900, f1: 80, dur: 1.4, peak: 0.7, attack: 0.2 });
  }

  bonus() {
    if (!this.ok) return;
    const out = Audio._fxNode(null, 0.4, 0.3);
    Audio._tone(out, { type: 'sine', f0: 988, dur: 0.08, peak: 0.18 });
    Audio._tone(out, { type: 'sine', f0: 1319, dur: 0.16, peak: 0.16, delay: 0.07 });
  }

  /** 피격 경보 RWR */
  rwr(on) { if (Audio.ready) Audio.warning('missile', on); }

  /* ------------------------------ 음악 ------------------------------ */
  /** intensity 0..1 (메뉴=0.6, 전투=1, 자유비행=0.4) */
  music(on, intensity = 0.7) {
    if (!this.ok) return;
    const ctx = Audio.ctx;
    if (!on) {
      if (this._music) {
        const m = this._music;
        this._music = null;
        clearInterval(m.timer);
        m.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
        setTimeout(() => { try { m.bus.disconnect(); } catch (e) { /* noop */ } }, 3000);
      }
      return;
    }
    if (this._music) { this._music.intensity = intensity; return; }
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.gain.setTargetAtTime(0.85, ctx.currentTime, 1.2);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    bus.connect(comp).connect(Audio.musicBus);
    const rv = ctx.createGain(); rv.gain.value = 0.25;
    comp.connect(rv).connect(Audio.reverbSend);

    const bpm = 132, step = 60 / bpm / 4;
    // Am - F - C - G (마이너 에픽 진행)
    const roots = [45, 41, 48, 43];
    const chordTones = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]];
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const m = { bus, intensity, timer: 0, next: ctx.currentTime + 0.1, i: 0 };
    const play = (t, i) => {
      const I = m.intensity;
      const bar = Math.floor(i / 16) % 4, s16 = i % 16;
      const root = roots[bar], tones = chordTones[bar];
      // 킥
      if (s16 % 4 === 0 && I > 0.3) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        g.gain.setValueAtTime(0.9 * I, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.connect(g).connect(bus); o.start(t); o.stop(t + 0.32);
      }
      // 스네어
      if ((s16 === 4 || s16 === 12) && I > 0.45) {
        const src = ctx.createBufferSource(); src.buffer = Audio.noise.white;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.45 * I, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        src.connect(f).connect(g).connect(bus); src.start(t, Math.random()); src.stop(t + 0.22);
      }
      // 하이햇
      if (s16 % 2 === 1 && I > 0.55) {
        const src = ctx.createBufferSource(); src.buffer = Audio.noise.white;
        const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.12 * I, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        src.connect(f).connect(g).connect(bus); src.start(t, Math.random()); src.stop(t + 0.06);
      }
      // 베이스 (16분 질주)
      if (s16 % 2 === 0 || I > 0.8) {
        const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = mtof(root - 12 + (s16 % 8 === 6 ? 12 : 0));
        f.type = 'lowpass'; f.frequency.setValueAtTime(300 + I * 900, t); f.frequency.exponentialRampToValueAtTime(140, t + step * 1.8); f.Q.value = 6;
        g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.001, t + step * 1.9);
        o.connect(f).connect(g).connect(bus); o.start(t); o.stop(t + step * 2);
      }
      // 아르페지오
      if (I > 0.35) {
        const n = root + 24 + tones[s16 % 3] + (s16 >= 8 ? 12 : 0);
        const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        o.type = 'square'; o.frequency.value = mtof(n);
        f.type = 'lowpass'; f.frequency.value = 2400;
        g.gain.setValueAtTime(0.045 * I, t); g.gain.exponentialRampToValueAtTime(0.001, t + step * 0.9);
        o.connect(f).connect(g).connect(bus); o.start(t); o.stop(t + step);
      }
      // 패드 (마디 시작)
      if (s16 === 0) {
        for (const tt of tones) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sawtooth'; o.frequency.value = mtof(root + 12 + tt); o.detune.value = rand(-8, 8);
          const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.4); g.gain.exponentialRampToValueAtTime(0.001, t + step * 16);
          o.connect(f).connect(g).connect(bus); o.start(t); o.stop(t + step * 16 + 0.05);
        }
      }
    };
    m.timer = setInterval(() => {
      if (m.next < ctx.currentTime - 0.2) m.next = ctx.currentTime + 0.05;
      while (m.next < ctx.currentTime + 0.25) {
        play(m.next, m.i);
        m.i++;
        m.next += step;
      }
    }, 60);
    this._music = m;
  }

  stopAll() {
    for (const [, l] of this._loops) l.stop();
    this._loops.clear();
    if (Audio.ready) Audio.warning('missile', false);
  }
}

export const Sfx = new FighterSfx();
