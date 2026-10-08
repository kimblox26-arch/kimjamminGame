// 절차적 사운드 (WebAudio 합성): 파도 · 바람 · 지진 굉음 · 쓰나미 포효 · 사이렌 · 군중 · 비명 · 붕괴 · 심장박동 · 재난문자
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass'; this.lp.frequency.value = 20000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(this.lp); this.lp.connect(comp); comp.connect(ctx.destination);
    const sr = ctx.sampleRate;
    const mk = (fn, sec = 4) => {
      const b = ctx.createBuffer(1, sr * sec, sr), d = b.getChannelData(0);
      fn(d); return b;
    };
    this.white = mk((d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    this.brown = mk((d) => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } });
    this.pink = mk((d) => {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
    });
    const loop = (buf, type, freq, q = 0.7) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
      s.playbackRate.value = 0.9 + Math.random() * 0.2;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(this.master); s.start();
      return { s, f, g };
    };
    this.surf = loop(this.pink, 'lowpass', 900);
    this.wind = loop(this.white, 'bandpass', 500, 0.4);
    this.roar = loop(this.brown, 'lowpass', 300);
    this.crash = loop(this.white, 'bandpass', 1400, 0.5);
    this.rumble = loop(this.brown, 'lowpass', 70);
    this.crowd = loop(this.pink, 'bandpass', 700, 1.2);
    // 사이렌
    const so = ctx.createOscillator(); so.type = 'sawtooth'; so.frequency.value = 500;
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 1800;
    const sg = ctx.createGain(); sg.gain.value = 0;
    so.connect(sf); sf.connect(sg); sg.connect(this.master); so.start();
    this.siren = { o: so, g: sg };
    this.sirenT = 0;
    this.nextScream = 0;
    this.nextBeat = 0;
    this.nextBird = 2;
  }

  set(node, v, t = 0.15) { if (node) node.gain.setTargetAtTime(v, this.ctx.currentTime, t); }

  /** 매 프레임 연속음 갱신 */
  update(dt, s) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const on = this.enabled ? 1 : 0;
    this.master.gain.setTargetAtTime(this.volume * on, now, 0.1);
    this.lp.frequency.setTargetAtTime(s.underwater ? 420 : 20000, now, 0.08);
    const wave = 0.5 + 0.5 * Math.sin(now * 0.45) * Math.sin(now * 0.17 + 1);
    this.set(this.surf.g, s.surf * (0.12 + 0.12 * wave));
    this.set(this.wind.g, 0.025 + s.altitude * 0.06);
    this.set(this.roar.g, Math.min(1.3, s.roar * 0.9));
    this.roar.f.frequency.setTargetAtTime(160 + s.roar * 420, now, 0.2);
    this.set(this.crash.g, Math.min(0.5, s.roar * 0.35) * (0.6 + 0.4 * Math.random()), 0.05);
    this.set(this.rumble.g, Math.min(1.5, s.quake * 1.6));
    this.set(this.crowd.g, Math.min(0.25, s.crowd * 0.25) * (0.7 + 0.3 * Math.sin(now * 5.3) * Math.sin(now * 3.1)), 0.05);
    this.crowd.f.frequency.setTargetAtTime(600 + 500 * Math.abs(Math.sin(now * 2.3)), now, 0.05);
    // 사이렌: 4초 주기 상승·하강
    if (s.siren > 0) {
      this.sirenT += dt;
      const ph = (this.sirenT % 8) / 8;
      const f = 380 + 520 * Math.sin(Math.min(1, ph * 2) * Math.PI / 2) * (ph < 0.5 ? 1 : 1 - (ph - 0.5) * 2);
      this.siren.o.frequency.setTargetAtTime(f, now, 0.08);
      this.set(this.siren.g, 0.05 * s.siren);
    } else this.set(this.siren.g, 0);
    // 비명 (공포 군중)
    if (s.screamRate > 0 && now > this.nextScream) {
      this.nextScream = now + (0.4 + Math.random() * 1.6) / Math.min(4, s.screamRate);
      this.scream(Math.min(1, s.screamVol));
    }
    // 심장박동 (1인칭)
    if (s.heart > 0 && s.heartVol > 0.05 && now > this.nextBeat) {
      this.nextBeat = now + 60 / s.heart;
      this.thump(now, s.heartVol); this.thump(now + 0.16, s.heartVol * 0.7);
    }
    // 평화로운 새소리
    if (s.calm && now > this.nextBird) { this.nextBird = now + 2 + Math.random() * 6; this.bird(); }
  }

  thump(t, v) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.2);
  }

  scream(v) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = 520 + Math.random() * 600;
    o.frequency.setValueAtTime(f0 * 0.85, t);
    o.frequency.linearRampToValueAtTime(f0, t + 0.12);
    o.frequency.linearRampToValueAtTime(f0 * (0.7 + Math.random() * 0.2), t + 0.9);
    const vib = ctx.createOscillator(), vg = ctx.createGain();
    vib.frequency.value = 6 + Math.random() * 3; vg.gain.value = f0 * 0.03;
    vib.connect(vg); vg.connect(o.frequency);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 900 + Math.random() * 300; f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 2600 + Math.random() * 500; f2.Q.value = 4;
    const g = ctx.createGain(); g.gain.value = 0;
    const dur = 0.6 + Math.random() * 0.7;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 * v, t + 0.06); g.gain.setValueAtTime(0.05 * v, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; g.connect(pan); pan.connect(this.master); } else g.connect(this.master);
    o.start(t); vib.start(t); o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
  }

  burst(buf, type, freq, dur, vol, sweepTo) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    const off = Math.max(0, Math.min(Math.random() * 2, buf.duration - dur - 0.05));
    if (dur > buf.duration - 0.1) s.loop = true;
    s.start(t, off); s.stop(t + dur + 0.05);
  }

  collapse(v = 1) { this.burst(this.brown, 'lowpass', 900, 2.6, 1.2 * v, 80); this.burst(this.white, 'bandpass', 2400, 0.9, 0.25 * v, 600); }
  splash(v = 1) { this.burst(this.white, 'bandpass', 1800, 1.2, 0.5 * v, 400); }
  /** 유리 깨짐: 고역 잡음 + 짧은 금속성 울림 여러 개 */
  glass(v = 1) {
    if (!this.ctx || v < 0.03) return;
    this.burst(this.white, 'highpass', 3500, 0.35, 0.6 * v, 7000);
    const ctx = this.ctx, t0 = ctx.currentTime;
    for (let i = 0; i < 7; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + 0.03 + Math.random() * 0.5;
      o.type = 'sine'; o.frequency.value = 2800 + Math.random() * 4200;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06 * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12 + Math.random() * 0.2);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.4);
    }
  }

  /** 전기 아크: 지직거리는 잡음 + 낮은 웅웅거림 */
  zap(v = 1) {
    if (!this.ctx) return;
    this.burst(this.white, 'bandpass', 2600, 0.25 + Math.random() * 0.2, 0.45 * v, 900);
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 120;
    g.gain.setValueAtTime(0.12 * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.4);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  boom() { this.burst(this.brown, 'lowpass', 400, 6, 2.2, 30); this.burst(this.white, 'lowpass', 6000, 1.5, 0.8, 200); }
  whoosh() { this.burst(this.white, 'bandpass', 300, 3.2, 0.5, 3000); }
  click() { if (!this.ctx) return; this.burst(this.white, 'highpass', 3000, 0.04, 0.15); }

  alertTone() {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = i % 2 ? 1560 : 1040;
      const t = t0 + i * 0.32;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.02); g.gain.setValueAtTime(0.08, t + 0.26); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.32);
    }
  }

  bird() {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      const tt = t + i * 0.13, f = 2800 + Math.random() * 1600;
      o.frequency.setValueAtTime(f, tt); o.frequency.exponentialRampToValueAtTime(f * 1.4, tt + 0.08);
      g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(0.012, tt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.1);
      o.connect(g); g.connect(this.master); o.start(tt); o.stop(tt + 0.12);
    }
  }
}
