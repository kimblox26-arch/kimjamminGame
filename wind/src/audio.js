// 실시간 합성 사운드: 바람 소음, 붓 소리, 종소리, 잔잔한 생성 음악
const PENTA = [0, 2, 4, 7, 9];

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('wind.mute') === '1'; } catch { /* 저장소 없음 */ }
    this.nextNote = 0;
    this.root = 57;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);

    // 잔향: 생성한 감쇠 노이즈 임펄스
    this.verb = c.createConvolver();
    const len = c.sampleRate * 2.6, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.verb.buffer = ir;
    this.verbGain = c.createGain();
    this.verbGain.gain.value = 0.35;
    this.verb.connect(this.verbGain).connect(this.master);

    // 바람: 루프 노이즈 → 대역 필터
    const nb = c.createBuffer(1, c.sampleRate * 3, c.sampleRate), nd = nb.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < nd.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048;
      nd[i] = (b0 + b1 + b2) * 0.9;
    }
    this.noise = nb;
    const mk = (freq, q) => {
      const src = c.createBufferSource(); src.buffer = nb; src.loop = true;
      src.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { f, g };
    };
    this.windBed = mk(420, 0.6);
    this.rush = mk(900, 1.2);
    this.brush = mk(1600, 2.2);
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('wind.mute', m ? '1' : '0'); } catch { /* 무시 */ }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  // 매 프레임: 주변 바람 세기, 비행 속도, 붓질 속도
  update(dt, ambient, airspeed, brushSpeed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const amb = Math.min(1, ambient / 10);
    this.windBed.g.gain.setTargetAtTime(0.05 + amb * 0.12, t, 0.3);
    this.windBed.f.frequency.setTargetAtTime(300 + amb * 400, t, 0.3);
    const a = Math.min(1, airspeed / 18);
    this.rush.g.gain.setTargetAtTime(a * a * 0.22, t, 0.12);
    this.rush.f.frequency.setTargetAtTime(500 + a * 1400, t, 0.12);
    const b = Math.min(1, brushSpeed / 60);
    this.brush.g.gain.setTargetAtTime(b * 0.2, t, 0.05);
    this.brush.f.frequency.setTargetAtTime(1100 + b * 1600, t, 0.05);
    this._music(t);
  }

  _music(t) {
    if (t < this.nextNote) return;
    this.nextNote = t + 1.6 + Math.random() * 2.6;
    const deg = PENTA[(Math.random() * 5) | 0] + (Math.random() < 0.3 ? 12 : 0);
    this.tone(this.root + deg, 0.035, 3.5, 'sine', 1.2);
    if (Math.random() < 0.35) this.tone(this.root - 12 + PENTA[(Math.random() * 3) | 0], 0.03, 5, 'triangle', 2);
  }

  tone(midi, vol, dur, type = 'sine', attack = 0.005, when = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    o.connect(g);
    g.connect(this.master);
    g.connect(this.verb);
    o.start(t);
    o.stop(t + attack + dur + 0.1);
  }

  burstNoise(freq, q, vol, dur, sweep = 1) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    g.connect(this.verb);
    s.start(t, Math.random() * 2);
    s.stop(t + dur + 0.05);
  }

  sfx(name) {
    if (!this.ctx) return;
    const r = this.root;
    switch (name) {
      case 'launch': this.burstNoise(500, 0.8, 0.35, 0.7, 4); break;
      case 'mote': this.tone(r + 24, 0.12, 0.9); this.tone(r + 31, 0.08, 1.1, 'sine', 0.005, 0.07); break;
      case 'goal': this.tone(r + 19, 0.1, 1.4); break;
      case 'win': [0, 4, 7, 12, 16, 19].forEach((d, i) => this.tone(r + 12 + d, 0.1, 2.2, i % 2 ? 'triangle' : 'sine', 0.01, i * 0.11)); break;
      case 'crash': this.burstNoise(1800, 1.5, 0.5, 0.25, 0.3); this.tone(r - 24, 0.18, 0.4, 'triangle'); break;
      case 'splash': this.burstNoise(900, 0.7, 0.5, 0.9, 0.25); break;
      case 'fail': this.tone(r + 3, 0.07, 1.6, 'triangle'); this.tone(r - 2, 0.06, 2, 'triangle', 0.01, 0.2); break;
      case 'stroke': this.tone(r + 12 + PENTA[(Math.random() * 5) | 0], 0.04, 0.8, 'sine'); break;
      case 'erase': this.burstNoise(2500, 2, 0.12, 0.18, 0.5); break;
      case 'click': this.tone(r + 24, 0.05, 0.25, 'triangle'); break;
      case 'nope': this.tone(r - 5, 0.06, 0.3, 'square'); break;
      default: break;
    }
  }
}
