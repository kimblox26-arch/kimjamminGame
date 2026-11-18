// 수능 감독관 — 사운드 엔진: 교실 잔향(컨볼루션) · 3D 위치 음향(HRTF) · 겹겹이 합성한 효과음 · 한국어 음성(TTS)
'use strict';
const R1 = (a, b) => a + Math.random() * (b - a);

export const SFX = {
  ctx: null, on: true, voiceOn: true, vq: 0,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext, c = (this.ctx = new C());
      const comp = c.createDynamicsCompressor(); Object.assign(comp, {}); comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = .003; comp.release.value = .25;
      this.master = c.createGain(); this.master.gain.value = this.on ? .95 : 0; this.master.connect(comp); comp.connect(c.destination);
      this.dry = c.createGain(); this.dry.connect(this.master);
      this.rev = c.createConvolver(); this.rev.buffer = this.ir(1.5, 3); const wet = c.createGain(); wet.gain.value = .5; this.rev.connect(wet); wet.connect(this.master);
      const mk = (fn) => { const n = c.sampleRate * 3, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0); fn(d, n); return b; };
      this.white = mk((d, n) => { for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; });
      this.pink = mk((d, n) => { let b0 = 0, b1 = 0, b2 = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; b0 = .99765 * b0 + w * .099; b1 = .963 * b1 + w * .2965; b2 = .57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * .1848) * .18; } });
      this.brown = mk((d, n) => { let l = 0; for (let i = 0; i < n; i++) { l = (l + .02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } });
      this.ambience();
      if ('speechSynthesis' in window) { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => (this._vs = null); }
    } catch (e) { this.ctx = null; }
  },
  setOn(v) { this.on = v; if (this.master) this.master.gain.setTargetAtTime(v ? .95 : 0, this.ctx.currentTime, .05); if (!v && 'speechSynthesis' in window) speechSynthesis.cancel(); },
  // 교실 잔향: 초기 반사 + 고음이 점점 줄어드는 꼬리
  ir(dur, decay) {
    const c = this.ctx, n = Math.floor(c.sampleRate * dur), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < n; i++) { const t = i / n, v = (Math.random() * 2 - 1) * Math.pow(1 - t, decay), k = .9 - .75 * t; lp += (v - lp) * k; d[i] = lp; }
      for (const ms of [7, 11, 17, 23, 31, 41]) { const i = Math.floor(c.sampleRate * (ms + ch * 1.3) / 1000); d[i] += R1(.25, .55) * (Math.random() < .5 ? -1 : 1); }
    }
    return b;
  },
  listen(cam) {
    if (!this.ctx) return; const L = this.ctx.listener, p = cam.position, f = cam.getWorldDirection(this._f || (this._f = cam.position.clone()));
    if (L.positionX) { const t = this.ctx.currentTime; L.positionX.setTargetAtTime(p.x, t, .02); L.positionY.setTargetAtTime(p.y, t, .02); L.positionZ.setTargetAtTime(p.z, t, .02); L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  },
  bus(pos, send = .3, life = 3) {
    const c = this.ctx, g = c.createGain(); let out = g, pn = null;
    if (pos) {
      pn = c.createPanner(); pn.panningModel = 'HRTF'; pn.distanceModel = 'inverse'; pn.refDistance = 1.3; pn.maxDistance = 50; pn.rolloffFactor = 1;
      if (pn.positionX) { pn.positionX.value = pos.x; pn.positionY.value = pos.y; pn.positionZ.value = pos.z; } else pn.setPosition(pos.x, pos.y, pos.z);
      g.connect(pn); out = pn;
    }
    out.connect(this.dry); const s = c.createGain(); s.gain.value = send; out.connect(s); s.connect(this.rev);
    if (life) setTimeout(() => { try { g.disconnect(); out.disconnect(); s.disconnect(); } catch (e) { /* 이미 해제 */ } }, life * 1000);
    g.pn = pn; return g;
  },
  ok() { return this.on && this.ctx; },
  N(dst, { t = 0, d = .1, v = .3, type = 'lowpass', f = 1000, f2 = 0, q = .7, a = .002, buf = 'white', rate = 1 } = {}) {
    const c = this.ctx, T = c.currentTime + t, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this[buf]; s.playbackRate.value = rate; fl.type = type; fl.frequency.setValueAtTime(f, T); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, T + d); fl.Q.value = q;
    g.gain.setValueAtTime(.0001, T); g.gain.linearRampToValueAtTime(v, T + a); g.gain.exponentialRampToValueAtTime(.0001, T + d);
    s.connect(fl).connect(g).connect(dst); s.start(T, Math.random() * 2); s.stop(T + d + .05);
  },
  O(dst, { t = 0, d = .2, v = .2, f = 440, f2 = 0, type = 'sine', a = .002, filt = 0 } = {}) {
    const c = this.ctx, T = c.currentTime + t, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, T); if (f2) o.frequency.exponentialRampToValueAtTime(f2, T + d);
    g.gain.setValueAtTime(.0001, T); g.gain.linearRampToValueAtTime(v, T + a); g.gain.exponentialRampToValueAtTime(.0001, T + d);
    let n = o; if (filt) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = filt; o.connect(fl); n = fl; }
    n.connect(g).connect(dst); o.start(T); o.stop(T + d + .05);
  },
  // ───── 효과음 ─────
  step(p) { if (!this.ok()) return; const b = this.bus(p, .25), r = R1(.9, 1.1); this.N(b, { d: .045, v: .32, type: 'bandpass', f: 2100 * r, q: 1.6 }); this.N(b, { d: .1, v: .45, f: 320 * r, buf: 'pink' }); this.O(b, { d: .07, v: .18, f: 120 * r, f2: 70 }); },
  whoosh(p) { if (!this.ok()) return; const b = this.bus(p, .2); this.N(b, { d: .28, v: .45, type: 'bandpass', f: 380, f2: 2600, q: 2.2, a: .09, buf: 'pink' }); },
  bonk(p) { if (!this.ok()) return; const b = this.bus(p, .45); this.N(b, { d: .012, v: 1, type: 'highpass', f: 2500 }); this.O(b, { d: .1, v: .45, f: 980, f2: 760, type: 'triangle' }); this.O(b, { d: .07, v: .18, f: 1720 }); this.N(b, { d: .14, v: .8, f: 450, buf: 'pink' }); this.O(b, { d: .16, v: .55, f: 150, f2: 70 }); },
  punch(p) { if (!this.ok()) return; const b = this.bus(p, .35); this.N(b, { d: .12, v: .9, f: 750, buf: 'pink' }); this.O(b, { d: .15, v: .6, f: 115, f2: 55 }); this.N(b, { d: .03, v: .4, type: 'bandpass', f: 1900, q: 1.2 }); },
  shot(p, auto) { if (!this.ok()) return; const b = this.bus(p, .4); this.N(b, { d: auto ? .055 : .075, v: .8, type: 'bandpass', f: 950, q: .8 }); this.N(b, { d: .025, v: .45, type: 'highpass', f: 4200 }); this.O(b, { d: .05, v: .28, f: 230, f2: 115 }); if (auto) this.O(b, { d: .012, v: .07, f: 2200, type: 'square' }); },
  splat(p) { if (!this.ok()) return; const b = this.bus(p, .3); this.N(b, { d: .2, v: .55, f: 2600, f2: 380, buf: 'pink' }); for (let i = 0; i < 4; i++) this.O(b, { t: R1(.02, .14), d: .025, v: .06, f: R1(500, 1300), f2: 300 }); },
  rocket(p) { if (!this.ok()) return; const b = this.bus(p, .6, 4); this.N(b, { d: .45, v: 1, f: 300, buf: 'brown' }); this.O(b, { d: .4, v: .7, f: 75, f2: 35 }); this.N(b, { d: 1.3, v: .55, type: 'bandpass', f: 700, f2: 3200, q: .7, a: .04 }); },
  rocketLoop(p) {
    if (!this.ok()) return null; const c = this.ctx, b = this.bus(p, .3, 0), s = c.createBufferSource(), f = c.createBiquadFilter();
    s.buffer = this.white; s.loop = true; f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = .6; b.gain.value = .45; s.connect(f).connect(b); s.start();
    return { set(q) { const pn = b.pn; if (!pn) return; if (pn.positionX) { pn.positionX.value = q.x; pn.positionY.value = q.y; pn.positionZ.value = q.z; } else pn.setPosition(q.x, q.y, q.z); }, stop() { b.gain.setTargetAtTime(0, c.currentTime, .03); setTimeout(() => { try { s.stop(); b.disconnect(); } catch (e) { /* 끝 */ } }, 300); } };
  },
  boom(p) {
    if (!this.ok()) return; const b = this.bus(p, .75, 6);
    this.N(b, { d: .05, v: 1.4, type: 'highpass', f: 1400 }); this.N(b, { d: 2.8, v: 1.6, f: 240, f2: 70, buf: 'brown', a: .004 });
    this.O(b, { d: 1.5, v: 1.1, f: 58, f2: 22 }); this.N(b, { d: .7, v: .7, type: 'bandpass', f: 650, q: .6, buf: 'pink' });
    for (let i = 0; i < 28; i++) this.N(b, { t: R1(.06, 1.7), d: R1(.008, .02), v: R1(.15, .45), type: 'highpass', f: 2800 });
    for (let i = 0; i < 16; i++) { const f = R1(260, 950), t = R1(.3, 2.1); this.O(b, { t, d: .07, v: .14, f, type: 'triangle' }); this.N(b, { t, d: .03, v: .12, type: 'bandpass', f, q: 3 }); }
    for (const f of [430, 1170, 1930]) this.O(b, { t: R1(.5, 1.2), d: .7, v: .05, f });
  },
  snap(p) { if (!this.ok()) return; const b = this.bus(p, .3); for (const t of [0, .018, .042]) this.N(b, { t, d: .01, v: .8, type: 'highpass', f: 4500 }); this.O(b, { d: .035, v: .12, f: 2400, f2: 900 }); this.O(b, { t: .05, d: .2, v: .045, f: 4300 }); this.O(b, { t: .07, d: .14, v: .035, f: 5700 }); },
  thud(p) { if (!this.ok()) return; const b = this.bus(p, .35); this.N(b, { d: .26, v: 1, f: 260, buf: 'brown' }); this.O(b, { d: .22, v: .7, f: 85, f2: 45 }); this.N(b, { d: .06, v: .25, type: 'bandpass', f: 1300 }); },
  clang(p) { if (!this.ok()) return; const b = this.bus(p, .45); this.N(b, { d: .02, v: .4, type: 'highpass', f: 3000 }); [[420, .9], [1150, .6], [1910, .45], [2730, .3]].forEach(([f, d], i) => this.O(b, { d, v: .09 / (i + 1) + .03, f: f * R1(.95, 1.05) })); },
  door(p) { if (!this.ok()) return; const c = this.ctx, b = this.bus(p, .5), T = c.currentTime, o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), fl = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = 170; lfo.frequency.value = 23; lg.gain.value = 40; lfo.connect(lg).connect(o.frequency); fl.type = 'bandpass'; fl.frequency.value = 950; fl.Q.value = 7;
    g.gain.setValueAtTime(.0001, T); g.gain.linearRampToValueAtTime(.16, T + .1); g.gain.exponentialRampToValueAtTime(.0001, T + .8); o.connect(fl).connect(g).connect(b); o.start(T); lfo.start(T); o.stop(T + .85); lfo.stop(T + .85);
    this.N(b, { t: .78, d: .03, v: .5, type: 'bandpass', f: 3000, q: 2 }); this.O(b, { t: .78, d: .08, v: .2, f: 160 }); },
  bell() {
    if (!this.ok()) return; const b = this.bus({ x: 0, y: 2.8, z: -7.7 }, .65, 9);
    const note = (f, t) => [[1, 1], [2, .5], [2.76, .34], [4.07, .2], [5.4, .12], [.5, .25]].forEach(([r, a]) => this.O(b, { t, d: r > 2 ? 1.6 : 2.6, v: .13 * a, f: f * r, a: .003 }));
    [659.3, 523.3, 587.3, 392].forEach((f, i) => note(f, i * .6)); [392, 587.3, 659.3, 523.3].forEach((f, i) => note(f, 2.7 + i * .6));
  },
  coin() { if (!this.ok()) return; const b = this.bus(null, .25); this.O(b, { d: .3, v: .16, f: 1568 }); this.O(b, { t: .07, d: .45, v: .16, f: 2093 }); this.O(b, { t: .07, d: .3, v: .05, f: 4186 }); },
  click() { if (!this.ok()) return; const b = this.bus(null, .05); this.N(b, { d: .012, v: .25, type: 'bandpass', f: 3800, q: 2 }); this.O(b, { d: .02, v: .05, f: 1400 }); },
  hurt() { if (!this.ok()) return; const b = this.bus(null, .3); this.O(b, { d: .45, v: .22, f: 220, f2: 110, type: 'sawtooth', filt: 1400 }); this.O(b, { d: .45, v: .14, f: 233, f2: 116, type: 'square', filt: 1000 }); this.O(b, { d: .3, v: .4, f: 70, f2: 40 }); },
  jump(p) { if (!this.ok()) return; const b = this.bus(p, .2); this.N(b, { d: .07, v: .35, f: 400, buf: 'pink' }); this.N(b, { d: .15, v: .12, type: 'bandpass', f: 900, f2: 1800, q: 1.5 }); },
  buy() { if (!this.ok()) return; this.coin(); const b = this.bus(null, .4); [784, 988, 1175, 1568].forEach((f, i) => this.O(b, { t: .12 + i * .07, d: .35, v: .09, f, type: 'triangle' })); },
  alarm(p) { if (!this.ok()) return; const c = this.ctx, b = this.bus(p, .5); for (const t0 of [0, .45]) { const T = c.currentTime + t0, o = c.createOscillator(), l = c.createOscillator(), lg = c.createGain(), g = c.createGain(); o.frequency.value = 2650; l.frequency.value = 38; lg.gain.value = 90; l.connect(lg).connect(o.frequency); g.gain.setValueAtTime(.0001, T); g.gain.linearRampToValueAtTime(.12, T + .02); g.gain.setValueAtTime(.12, T + .3); g.gain.exponentialRampToValueAtTime(.0001, T + .38); o.connect(g).connect(b); o.start(T); l.start(T); o.stop(T + .4); l.stop(T + .4); this.N(b, { t: t0, d: .35, v: .06, type: 'bandpass', f: 2600, q: 3 }); } },
  type() { if (!this.ok()) return; const b = this.bus(null, .05, 1); this.N(b, { d: .01, v: .1, type: 'bandpass', f: 3500, q: 2 }); },
  talk(p) { if (!this.ok()) return; const b = this.bus(p, .3); for (let i = 0; i < 5; i++) { const t = i * .08; this.O(b, { t, d: .07, v: .05, f: R1(160, 230), type: 'sawtooth', filt: 1200 }); } },
  scratch(p) { if (!this.ok()) return; const b = this.bus(p, .15, 1); this.N(b, { d: R1(.06, .16), v: .05, type: 'bandpass', f: R1(3800, 5600), q: 3, a: .02 }); },
  page(p) { if (!this.ok()) return; const b = this.bus(p, .25, 1); this.N(b, { d: .28, v: .14, type: 'bandpass', f: 1600, f2: 3600, q: .9, a: .06, buf: 'pink' }); this.N(b, { t: .2, d: .05, v: .08, type: 'highpass', f: 3000 }); },
  cough(p) { if (!this.ok()) return; const b = this.bus(p, .4, 2); for (const t of [0, .26]) { this.N(b, { t, d: .14, v: .3, type: 'bandpass', f: 480, q: 1.4, a: .01 }); this.N(b, { t, d: .1, v: .14, type: 'bandpass', f: 1250, q: 2, a: .01 }); } },
  gasp(p) { if (!this.ok()) return; const b = this.bus(p, .4, 2), r = R1(.85, 1.3); this.N(b, { d: .32, v: .2, type: 'bandpass', f: 900 * r, f2: 1400 * r, q: 4, a: .05 }); this.O(b, { d: .28, v: .07, f: 240 * r, f2: 330 * r, type: 'sawtooth', filt: 1500 }); },
  creak(p) { if (!this.ok()) return; const b = this.bus(p, .3, 2); this.O(b, { d: .25, v: .04, f: R1(300, 500), f2: R1(250, 400), type: 'sawtooth', filt: 900 }); },
  ambience() {
    const c = this.ctx, mk = (buf, f, v) => { const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain(); s.buffer = buf; s.loop = true; fl.type = 'lowpass'; fl.frequency.value = f; g.gain.value = v; s.connect(fl).connect(g).connect(this.master); s.start(); };
    mk(this.brown, 260, .07); mk(this.pink, 1800, .006);
    const h = c.createOscillator(), hg = c.createGain(); h.frequency.value = 120; hg.gain.value = .0035; h.connect(hg).connect(this.master); h.start();
  },
  // ───── 총 · 재장전 · 유리 ─────
  gun(k, p) {
    if (!this.ok()) return; const b = this.bus(p, k === 'sniper' ? .8 : .55, 3), big = { pistol: 1, ak: .9, shotgun: 1.5, sniper: 1.7 }[k] || 1;
    this.N(b, { d: .012, v: 1.3 * big, type: 'highpass', f: 3200 }); this.N(b, { d: .14 * big, v: .95 * big, type: 'bandpass', f: k === 'shotgun' ? 700 : 1150, q: .8 });
    this.O(b, { d: .12 * big, v: .55 * big, f: k === 'shotgun' ? 110 : 170, f2: 45 }); this.N(b, { d: .4 * big, v: .45 * big, f: 600, buf: 'brown', a: .004 });
    this.O(b, { t: .028, d: .01, v: .06, f: 2600, type: 'square' }); if (k === 'sniper') this.N(b, { t: .05, d: 1.2, v: .25, type: 'lowpass', f: 1200, f2: 200, buf: 'pink' });
  },
  dry(p) { if (!this.ok()) return; const b = this.bus(p, .1, 1); this.N(b, { d: .015, v: .5, type: 'bandpass', f: 3200, q: 3 }); this.O(b, { d: .02, v: .08, f: 1800, type: 'square' }); },
  magOut(p) { if (!this.ok()) return; const b = this.bus(p, .2, 1); this.N(b, { d: .03, v: .55, type: 'bandpass', f: 2300, q: 3 }); this.N(b, { t: .03, d: .12, v: .25, type: 'bandpass', f: 1200, f2: 600, q: 1.5 }); this.O(b, { d: .05, v: .1, f: 900 }); },
  magIn(p) { if (!this.ok()) return; const b = this.bus(p, .2, 1); this.N(b, { d: .06, v: .3, type: 'bandpass', f: 900, f2: 1600, q: 2 }); this.N(b, { t: .06, d: .025, v: .75, type: 'bandpass', f: 2600, q: 4 }); this.O(b, { t: .06, d: .05, v: .15, f: 520 }); },
  rack(p) { if (!this.ok()) return; const b = this.bus(p, .25, 1); this.N(b, { d: .08, v: .55, type: 'bandpass', f: 3200, f2: 1500, q: 2 }); this.N(b, { t: .13, d: .05, v: .8, type: 'bandpass', f: 2400, q: 3 }); this.O(b, { t: .13, d: .06, v: .18, f: 700, f2: 400 }); },
  pump(p) { if (!this.ok()) return; const b = this.bus(p, .3, 1); this.N(b, { d: .11, v: .6, type: 'bandpass', f: 1100, f2: 2100, q: 1.6 }); this.N(b, { t: .18, d: .1, v: .7, type: 'bandpass', f: 1900, f2: 900, q: 1.6 }); this.O(b, { t: .27, d: .05, v: .2, f: 600 }); },
  shellIn(p) { if (!this.ok()) return; const b = this.bus(p, .2, 1); this.N(b, { d: .04, v: .45, type: 'bandpass', f: 2000, q: 3 }); this.O(b, { d: .03, v: .1, f: 1300 }); },
  bolt(p) { if (!this.ok()) return; const b = this.bus(p, .2, 2); this.N(b, { d: .02, v: .5, type: 'bandpass', f: 3000, q: 4 }); this.N(b, { t: .12, d: .1, v: .4, type: 'bandpass', f: 1800, f2: 1000, q: 2 }); this.N(b, { t: .38, d: .1, v: .45, type: 'bandpass', f: 1000, f2: 1900, q: 2 }); this.N(b, { t: .55, d: .02, v: .6, type: 'bandpass', f: 3200, q: 4 }); },
  chalk(p) { if (!this.ok()) return; const b = this.bus(p, .3, 1); this.N(b, { d: .012, v: .6, type: 'highpass', f: 4200 }); this.O(b, { d: .03, v: .12, f: 2500, f2: 1600 }); },
  beep(level, p) { if (!this.ok()) return; const b = this.bus(p, .05, 1); this.O(b, { d: .06, v: .04 + .1 * level, f: 1100 + 1600 * level, type: 'square', filt: 4000 }); },
  thunk(p) { if (!this.ok()) return; const b = this.bus(p, .35, 1); this.N(b, { d: .08, v: .6, f: 900, buf: 'pink' }); this.O(b, { d: .08, v: .25, f: 220, f2: 120 }); },
  glassCrack(p) { if (!this.ok()) return; const b = this.bus(p, .4, 2); this.N(b, { d: .05, v: .7, type: 'highpass', f: 3500 }); for (let i = 0; i < 4; i++) this.O(b, { t: R1(0, .08), d: .12, v: .04, f: R1(3000, 6500) }); },
  glassShatter(p) { if (!this.ok()) return; const b = this.bus(p, .6, 3); this.N(b, { d: .7, v: 1, type: 'highpass', f: 2500 }); this.N(b, { d: 1, v: .3, type: 'bandpass', f: 5000, q: .8 }); for (let i = 0; i < 26; i++) this.O(b, { t: R1(.05, 1.1), d: R1(.06, .18), v: R1(.02, .07), f: R1(2500, 7500) }); },
  sob(p) { if (!this.ok()) return; const b = this.bus(p, .4, 2), r = R1(.9, 1.3); for (const t of [0, .22, .4]) this.O(b, { t, d: .16, v: .05, f: 330 * r, f2: 250 * r, type: 'sawtooth', filt: 1400 }); },
  // ───── 한국어 음성 ─────
  voices() { if (!this._vs) this._vs = ('speechSynthesis' in window) ? speechSynthesis.getVoices().filter((v) => /^ko/i.test(v.lang)) : []; return this._vs; },
  speak(text, { pitch = 1, rate = 1.05, vol = 1, who = 0, prio = false } = {}) {
    if (!this.on || !this.voiceOn || !('speechSynthesis' in window)) return;
    const clean = String(text).replace(/\([^)]*\)/g, '').replace(/[@_~^ㅠㅜ]/g, '').trim(); if (!/[가-힣a-zA-Z0-9]/.test(clean)) return;
    if (this.vq > 2) { if (!prio) return; speechSynthesis.cancel(); this.vq = 0; }
    const u = new SpeechSynthesisUtterance(clean), vs = this.voices(); u.lang = 'ko-KR'; if (vs.length) u.voice = vs[who % vs.length];
    u.pitch = pitch; u.rate = rate; u.volume = vol; this.vq++; u.onend = u.onerror = () => (this.vq = Math.max(0, this.vq - 1));
    speechSynthesis.speak(u);
  },
};
