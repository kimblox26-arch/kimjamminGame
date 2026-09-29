// WebAudio 실시간 합성 사운드 — 총성/기계음/탄피/발걸음/피격/폭발 모두 코드로 생성
import * as THREE from 'three';

const SR = 44100;
let rng = 12345;
const rnd = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff * 2 - 1; };

class Biquad {
  constructor(type, f, q = 0.707) {
    const w = 2 * Math.PI * f / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
    a0 = 1 + al; a1 = -2 * c; a2 = 1 - al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  p(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y;
  }
}
const env = (t, a, tau) => (t < a ? t / a : Math.exp(-(t - a) / tau));

// 채널별 샘플 함수로 버퍼 생성
function make(ctx, dur, fn, stereo = true, norm = 0.9) {
  const len = Math.floor(dur * SR), ch = stereo ? 2 : 1;
  const buf = ctx.createBuffer(ch, len, SR);
  let peak = 0;
  const data = [];
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c), f = fn(c);
    for (let i = 0; i < len; i++) { d[i] = f(i / SR, i); peak = Math.max(peak, Math.abs(d[i])); }
    data.push(d);
  }
  if (peak > 0 && norm) for (const d of data) for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] / peak * 1.4) * norm;
  return buf;
}

// ── 총성 합성 ──
// p: crack(초음속 균열), body(총구 폭풍), thump(저역 충격), mech(기계음), tail(반향), low(저역 필터)
function gunshot(ctx, p) {
  return make(ctx, p.dur || 1.6, (c) => {
    const hp = new Biquad('hp', p.crackHP || 1800), lp = new Biquad('lp', p.bodyLP || 900), lp2 = new Biquad('lp', p.bodyLP2 || 3200);
    const bp = new Biquad('bp', p.mechF || 3400, 4), tl = new Biquad('lp', p.tailLP || 600), tl2 = new Biquad('lp', 1800);
    const echoes = p.echoes || [[0.085, 0.35], [0.16, 0.22], [0.31, 0.15], [0.52, 0.08]];
    const hist = new Float32Array(Math.floor(SR * 0.8));
    let phase = 0;
    return (t, i) => {
      const n = rnd();
      const crack = hp.p(n) * env(t, 0.0004, p.crackT || 0.012) * (p.crack ?? 1.0);
      const body = lp.p(n) * env(t, 0.001, p.bodyT || 0.07) * (p.body ?? 1.2) + lp2.p(n) * env(t, 0.0008, 0.025) * 0.6;
      const f = (p.thumpF || 90) * Math.exp(-t * 18) + 30;
      phase += 2 * Math.PI * f / SR;
      const thump = Math.sin(phase) * env(t, 0.002, p.thumpT || 0.06) * (p.thump ?? 1.0);
      const mech = bp.p(n) * (env(Math.max(0, t - (p.mechAt || 0.04)), 0.001, 0.012) * (t > (p.mechAt || 0.04) ? 1 : 0)) * (p.mech ?? 0.15);
      let dry = crack + body + thump + mech;
      hist[i % hist.length] = dry;
      let wet = 0;
      for (const [d, g] of echoes) { const k = i - Math.floor(d * SR * (1 + c * 0.03)); if (k >= 0) wet += hist[k % hist.length] * g; }
      const tail = tl.p(tl2.p(n)) * env(t, 0.02, p.tailT || 0.35) * (p.tail ?? 0.5);
      return dry + tl.p(wet) * 0.6 + wet * 0.25 + tail;
    };
  });
}

// 짧은 금속/기계음
function mech(ctx, parts, dur = 0.3) {
  return make(ctx, dur, () => {
    const fs = parts.map((q) => ({ ...q, f: new Biquad(q.type || 'bp', q.freq, q.q || 3) }));
    return (t) => {
      let s = 0;
      for (const q of fs) {
        if (t < q.at) { q.f.p(0); continue; }
        const tt = t - q.at, n = rnd();
        s += q.f.p(n) * env(tt, 0.0005, q.tau) * q.g;
        if (q.ping) for (const [fr, g] of q.ping) s += Math.sin(2 * Math.PI * fr * tt) * env(tt, 0.0005, q.tau * 2) * g;
      }
      return s;
    };
  }, false, 0.8);
}

function tone(ctx, dur, fn) { return make(ctx, dur, () => fn, false, 0.8); }

class AudioSys {
  constructor() { this.ctx = null; this.buf = {}; this.listener = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, -1) }; this.vol = 0.8; this.indoor = 0; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = this.vol;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    // 반향 (야외 슬랩백 + 실내 잔향)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = make(ctx, 2.2, (c) => { const lp = new Biquad('lp', 2500); return (t) => lp.p(rnd()) * Math.exp(-t / 0.55) * (t < 0.01 ? t / 0.01 : 1); }, true, 0.5);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.25;
    this.reverb.connect(this.wet).connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master); this.sfxBus.connect(this.reverb);
    this.uiBus = ctx.createGain(); this.uiBus.connect(this.master);
    this.duck = ctx.createGain(); this.duck.connect(this.sfxBus);
    this.buildBuffers();
    this.startAmbience();
  }

  buildBuffers() {
    const c = this.ctx, B = this.buf;
    B.m4 = gunshot(c, { crackHP: 1700, crackT: 0.011, bodyLP: 1100, bodyT: 0.06, thumpF: 110, thumpT: 0.05, tail: 0.55, tailT: 0.4 });
    B.ak = gunshot(c, { crackHP: 1300, crackT: 0.014, crack: 1.1, bodyLP: 850, bodyT: 0.085, body: 1.4, thumpF: 80, thumpT: 0.07, thump: 1.2, tail: 0.65, tailT: 0.45, mechF: 2500 });
    B.glock = gunshot(c, { crackHP: 2400, crackT: 0.008, crack: 0.9, bodyLP: 1600, bodyT: 0.035, body: 0.9, thumpF: 150, thumpT: 0.03, thump: 0.6, tail: 0.35, tailT: 0.25, mechAt: 0.03, mech: 0.3, dur: 1.1 });
    B.awm = gunshot(c, { crackHP: 1100, crackT: 0.02, crack: 1.2, bodyLP: 650, bodyT: 0.14, body: 1.6, thumpF: 60, thumpT: 0.12, thump: 1.6, tail: 0.9, tailT: 0.8, tailLP: 450, dur: 2.4, echoes: [[0.12, 0.45], [0.25, 0.3], [0.48, 0.22], [0.8, 0.12]] });
    B.m870 = gunshot(c, { crackHP: 900, crackT: 0.018, crack: 0.9, bodyLP: 700, bodyT: 0.12, body: 1.7, thumpF: 70, thumpT: 0.1, thump: 1.5, tail: 0.8, tailT: 0.6, dur: 2.0 });
    const G = (k, o) => { B[k] = gunshot(c, o); };
    G('hk416', { crackHP: 1750, crackT: 0.011, bodyLP: 1050, bodyT: 0.055, thumpF: 115, thumpT: 0.05, tail: 0.5, tailT: 0.4 });
    G('m16', { crackHP: 1900, crackT: 0.012, crack: 1.1, bodyLP: 1150, bodyT: 0.05, thumpF: 120, thumpT: 0.045, tail: 0.55, tailT: 0.45 });
    G('ak74', { crackHP: 1700, crackT: 0.011, crack: 1.1, bodyLP: 950, bodyT: 0.06, thumpF: 100, thumpT: 0.05, tail: 0.6, tailT: 0.42 });
    G('scar', { crackHP: 1200, crackT: 0.015, crack: 1.15, bodyLP: 800, bodyT: 0.09, body: 1.5, thumpF: 75, thumpT: 0.08, thump: 1.3, tail: 0.7, tailT: 0.5 });
    G('aug', { crackHP: 1800, crackT: 0.011, bodyLP: 1000, bodyT: 0.06, thumpF: 110, thumpT: 0.05, tail: 0.5, tailT: 0.4 });
    G('g36', { crackHP: 1850, crackT: 0.01, bodyLP: 1150, bodyT: 0.05, thumpF: 120, thumpT: 0.045, tail: 0.5, tailT: 0.38 });
    G('mp5', { crackHP: 2600, crackT: 0.006, crack: 0.7, bodyLP: 1400, bodyT: 0.03, body: 0.9, thumpF: 150, thumpT: 0.03, thump: 0.5, tail: 0.3, tailT: 0.25, mech: 0.35, mechAt: 0.02, dur: 1.0 });
    G('ump', { crackHP: 2000, crackT: 0.007, crack: 0.6, bodyLP: 900, bodyT: 0.045, body: 1.1, thumpF: 95, thumpT: 0.05, thump: 0.8, tail: 0.35, tailT: 0.28, mech: 0.3, dur: 1.1 });
    G('p90', { crackHP: 2800, crackT: 0.008, crack: 1.0, bodyLP: 1600, bodyT: 0.03, body: 0.8, thumpF: 160, thumpT: 0.03, thump: 0.5, tail: 0.35, tailT: 0.3, dur: 1.0 });
    G('m249', { crackHP: 1600, crackT: 0.012, crack: 1.1, bodyLP: 1000, bodyT: 0.065, body: 1.3, thumpF: 100, thumpT: 0.06, thump: 1.1, tail: 0.6, tailT: 0.45, mech: 0.25 });
    G('svd', { crackHP: 1100, crackT: 0.018, crack: 1.2, bodyLP: 700, bodyT: 0.11, body: 1.5, thumpF: 70, thumpT: 0.1, thump: 1.4, tail: 0.8, tailT: 0.7, dur: 2.0 });
    G('barrett', { crackHP: 700, crackT: 0.03, crack: 1.3, bodyLP: 450, bodyT: 0.2, body: 1.8, thumpF: 45, thumpT: 0.18, thump: 2.0, tail: 1.0, tailT: 1.1, tailLP: 380, dur: 2.8, echoes: [[0.14, 0.5], [0.3, 0.35], [0.55, 0.25], [0.9, 0.15]] });
    G('saiga', { crackHP: 950, crackT: 0.017, crack: 0.9, bodyLP: 720, bodyT: 0.11, body: 1.6, thumpF: 72, thumpT: 0.09, thump: 1.4, tail: 0.75, tailT: 0.55, dur: 1.8 });
    G('m1911', { crackHP: 1800, crackT: 0.008, crack: 0.8, bodyLP: 1000, bodyT: 0.05, body: 1.1, thumpF: 100, thumpT: 0.05, thump: 0.9, tail: 0.4, tailT: 0.3, mech: 0.3, dur: 1.2 });
    G('deagle', { crackHP: 1200, crackT: 0.014, crack: 1.2, bodyLP: 700, bodyT: 0.09, body: 1.6, thumpF: 70, thumpT: 0.09, thump: 1.5, tail: 0.7, tailT: 0.6, dur: 1.8 });
    G('python', { crackHP: 1500, crackT: 0.013, crack: 1.3, bodyLP: 900, bodyT: 0.08, body: 1.4, thumpF: 85, thumpT: 0.07, thump: 1.2, tail: 0.65, tailT: 0.55, mech: 0.0, dur: 1.7 });
    B.bot = B.ak;
    // 기계음
    B.dry = mech(c, [{ at: 0, freq: 4200, tau: 0.004, g: 1 }, { at: 0.012, freq: 2200, tau: 0.01, g: 0.6 }], 0.08);
    B.magout = mech(c, [{ at: 0, freq: 2600, tau: 0.01, g: 1, ping: [[1900, 0.2]] }, { at: 0.02, freq: 900, tau: 0.05, g: 0.8, q: 1.2 }], 0.25);
    B.magin = mech(c, [{ at: 0, freq: 1200, tau: 0.02, g: 1, q: 1 }, { at: 0.035, freq: 3800, tau: 0.008, g: 1.2, ping: [[2800, 0.3], [4100, 0.2]] }], 0.25);
    B.boltback = mech(c, [{ at: 0, freq: 1800, tau: 0.05, g: 0.7, q: 1.5 }, { at: 0.07, freq: 3200, tau: 0.012, g: 1.1, ping: [[2400, 0.25]] }], 0.25);
    B.boltfwd = mech(c, [{ at: 0, freq: 2000, tau: 0.03, g: 0.6, q: 1.5 }, { at: 0.04, freq: 2600, tau: 0.02, g: 1.4, ping: [[1700, 0.35], [3300, 0.2]] }], 0.3);
    B.slide = mech(c, [{ at: 0, freq: 3000, tau: 0.015, g: 1.1, ping: [[2100, 0.3], [3900, 0.2]] }], 0.2);
    B.pumpback = mech(c, [{ at: 0, freq: 700, tau: 0.04, g: 0.8, q: 1 }, { at: 0.06, freq: 2300, tau: 0.02, g: 1.1, ping: [[1500, 0.3]] }], 0.25);
    B.pumpfwd = mech(c, [{ at: 0, freq: 800, tau: 0.03, g: 0.7, q: 1 }, { at: 0.05, freq: 1900, tau: 0.025, g: 1.2, ping: [[1250, 0.35], [2600, 0.2]] }], 0.3);
    B.shellin = mech(c, [{ at: 0, freq: 1400, tau: 0.02, g: 1, q: 1.5 }, { at: 0.05, freq: 2800, tau: 0.01, g: 0.8 }], 0.2);
    B.select = mech(c, [{ at: 0, freq: 5200, tau: 0.004, g: 1, ping: [[3700, 0.2]] }], 0.1);
    B.cloth = mech(c, [{ at: 0, freq: 1200, tau: 0.08, g: 0.6, q: 0.6 }], 0.3);
    B.boltopen = mech(c, [{ at: 0, freq: 2500, tau: 0.02, g: 1, ping: [[1800, 0.2]] }, { at: 0.12, freq: 1500, tau: 0.06, g: 0.6, q: 1 }], 0.3);
    B.boltclose = mech(c, [{ at: 0, freq: 1400, tau: 0.05, g: 0.5, q: 1 }, { at: 0.08, freq: 2900, tau: 0.015, g: 1.2, ping: [[2200, 0.3]] }], 0.3);
    // 탄피
    B.casing = tone(c, 0.5, (t) => {
      let s = 0; const hits = [0, 0.09, 0.16, 0.21, 0.245];
      hits.forEach((h, k) => { if (t >= h) { const tt = t - h, g = Math.pow(0.6, k); s += (Math.sin(2 * Math.PI * 5300 * tt) * 0.5 + Math.sin(2 * Math.PI * 7900 * tt) * 0.35 + Math.sin(2 * Math.PI * 11200 * tt) * 0.2) * Math.exp(-tt / 0.035) * g; } });
      return s;
    });
    B.shell = tone(c, 0.35, (t) => { let s = 0; [0, 0.11, 0.18].forEach((h, k) => { if (t >= h) { const tt = t - h; s += (rnd() * 0.5 + Math.sin(2 * Math.PI * 900 * tt)) * Math.exp(-tt / 0.02) * Math.pow(0.5, k); } }); return s; });
    // 발걸음
    const step = (lpF, hpG, res, resF) => make(c, 0.25, () => { const lp = new Biquad('lp', lpF), hp = new Biquad('hp', 3000), rb = new Biquad('bp', resF || 900, 8); return (t) => { const n = rnd(); const e = env(t, 0.002, 0.018) + (t > 0.035 ? env(t - 0.035, 0.002, 0.025) * 0.7 : 0); return lp.p(n) * e + hp.p(n) * e * hpG + rb.p(n) * e * res; }; }, false, 0.8);
    B.stepConcrete = step(700, 0.15, 0);
    B.stepMetal = step(900, 0.2, 2.5, 1100);
    B.stepDirt = step(450, 0.35, 0);
    B.stepWood = step(500, 0.1, 1.5, 420);
    B.land = make(c, 0.3, () => { const lp = new Biquad('lp', 300); return (t) => lp.p(rnd()) * env(t, 0.003, 0.05) * 2; }, false);
    // 탄착
    B.hitConcrete = make(c, 0.35, () => { const hp = new Biquad('hp', 1200), lp = new Biquad('lp', 500); return (t) => hp.p(rnd()) * env(t, 0.0005, 0.012) + lp.p(rnd()) * env(t, 0.001, 0.04) * 0.8; }, false);
    B.hitMetal = make(c, 0.7, () => { const hp = new Biquad('hp', 2000); return (t) => hp.p(rnd()) * env(t, 0.0005, 0.006) + (Math.sin(2 * Math.PI * 2150 * t) * 0.6 + Math.sin(2 * Math.PI * 3470 * t) * 0.4 + Math.sin(2 * Math.PI * 5720 * t) * 0.25) * env(t, 0.0005, 0.12); }, false);
    B.ricochet = tone(c, 0.5, (t) => Math.sin(2 * Math.PI * (3200 - t * 3000) * t) * env(t, 0.005, 0.12) * 0.7 + rnd() * env(t, 0.001, 0.01) * 0.3);
    B.hitWood = make(c, 0.3, () => { const lp = new Biquad('lp', 350), bp = new Biquad('bp', 1100, 2); return (t) => lp.p(rnd()) * env(t, 0.001, 0.04) * 1.4 + bp.p(rnd()) * env(t, 0.001, 0.02); }, false);
    B.hitDirt = make(c, 0.3, () => { const lp = new Biquad('lp', 600); return (t) => lp.p(rnd()) * env(t, 0.001, 0.05); }, false);
    B.hitFlesh = make(c, 0.3, () => { const lp = new Biquad('lp', 260), bp = new Biquad('bp', 700, 1.5); return (t) => lp.p(rnd()) * env(t, 0.001, 0.05) * 1.6 + bp.p(rnd()) * env(t, 0.004, 0.03); }, false);
    B.glass = tone(c, 1.0, (t) => { let s = rnd() * env(t, 0.001, 0.03) * 0.6; for (let k = 0; k < 14; k++) { const h = k * 0.045 + (k % 3) * 0.013; if (t > h) { const tt = t - h; s += Math.sin(2 * Math.PI * (3000 + ((k * 2711) % 5000)) * tt) * Math.exp(-tt / 0.04) * 0.3 * Math.exp(-h * 2); } } return s; });
    // HUD 피드백
    B.hitmark = tone(c, 0.06, (t) => Math.sin(2 * Math.PI * 2400 * t) * env(t, 0.001, 0.01) + rnd() * env(t, 0.0005, 0.004) * 0.3);
    B.headshot = tone(c, 0.5, (t) => (Math.sin(2 * Math.PI * 1580 * t) * 0.6 + Math.sin(2 * Math.PI * 3950 * t) * 0.3 + Math.sin(2 * Math.PI * 6120 * t) * 0.15) * env(t, 0.001, 0.09));
    B.kill = tone(c, 0.25, (t) => Math.sin(2 * Math.PI * 900 * t) * env(t, 0.001, 0.05) + Math.sin(2 * Math.PI * 1350 * t) * env(Math.max(0, t - 0.06), 0.001, 0.06) * (t > 0.06 ? 1 : 0));
    // 근접 탄 통과(초음속 크랙 + 휘파람)
    B.whiz = make(c, 0.4, () => { const bp = new Biquad('bp', 1500, 3), hp = new Biquad('hp', 2500); return (t) => hp.p(rnd()) * env(t, 0.0003, 0.005) * 1.2 + bp.p(rnd()) * Math.sin(Math.PI * Math.min(1, t / 0.3)) * 0.8 * Math.exp(-t * 4); }, true);
    // 피격
    B.hurt = make(c, 0.35, () => { const lp = new Biquad('lp', 220); return (t) => lp.p(rnd()) * env(t, 0.002, 0.06) * 2 + Math.sin(2 * Math.PI * 70 * t) * env(t, 0.002, 0.08); }, false);
    B.heart = tone(c, 0.9, (t) => { const b = (tt) => (tt > 0 ? Math.sin(2 * Math.PI * 48 * tt) * env(tt, 0.01, 0.06) : 0); return b(t) + b(t - 0.28) * 0.7; });
    // 폭발
    B.explosion = make(c, 3.2, (ch) => { const lp = new Biquad('lp', 500), lp2 = new Biquad('lp', 120), hp = new Biquad('hp', 1500); let ph = 0; return (t) => { const n = rnd(); ph += 2 * Math.PI * (55 * Math.exp(-t * 3) + 22) / SR; return lp.p(n) * env(t, 0.003, 0.5) * 1.5 + lp2.p(n) * env(t, 0.01, 1.1) * 3 + Math.sin(ph) * env(t, 0.004, 0.35) * 1.4 + hp.p(n) * env(t, 0.0005, 0.03) + (Math.random() < 0.002 * Math.exp(-t) ? rnd() * 2 : 0); }; });
    // 투척물/폭약
    const P2 = 2 * Math.PI;
    B.frag = make(c, 2.8, () => { const lp = new Biquad('lp', 1400), lp2 = new Biquad('lp', 160), hp = new Biquad('hp', 2500); let ph = 0; return (t) => { const n = rnd(); ph += P2 * (70 * Math.exp(-t * 5) + 30) / SR; return lp.p(n) * env(t, 0.001, 0.18) * 1.8 + lp2.p(n) * env(t, 0.005, 0.7) * 2.2 + Math.sin(ph) * env(t, 0.002, 0.2) * 1.2 + hp.p(n) * env(t, 0.0003, 0.02) * 1.4 + (Math.random() < 0.004 * Math.exp(-t * 1.5) ? rnd() * 1.5 : 0); }; });
    B.pin = mech(c, [{ at: 0, freq: 5200, tau: 0.006, g: 0.8, ping: [[4300, 0.12]] }, { at: 0.05, freq: 3600, tau: 0.01, g: 0.9, ping: [[6100, 0.15], [3900, 0.1]] }], 0.3);
    B.spoon = tone(c, 0.6, (t) => (Math.sin(P2 * 2900 * t) * 0.5 + Math.sin(P2 * 4700 * t) * 0.3 + Math.sin(P2 * 7300 * t) * 0.2) * env(t, 0.001, 0.12) * (1 + 0.5 * Math.sin(P2 * 28 * t)) + rnd() * env(t, 0.0005, 0.006) * 0.5);
    B.nadeBounce = make(c, 0.3, () => { const lp = new Biquad('lp', 900), bp = new Biquad('bp', 1700, 4); return (t) => lp.p(rnd()) * env(t, 0.001, 0.025) * 1.2 + bp.p(rnd()) * env(t, 0.0005, 0.03) * 0.8 + Math.sin(P2 * 1250 * t) * env(t, 0.001, 0.04) * 0.35; }, false);
    B.nadeMetal = make(c, 0.5, () => { const hp = new Biquad('hp', 1500); return (t) => hp.p(rnd()) * env(t, 0.0005, 0.008) + (Math.sin(P2 * 1830 * t) * 0.6 + Math.sin(P2 * 2990 * t) * 0.4) * env(t, 0.0005, 0.09); }, false);
    B.smokePop = make(c, 0.5, () => { const lp = new Biquad('lp', 600); return (t) => lp.p(rnd()) * env(t, 0.002, 0.06) * 2 + rnd() * env(t, 0.0005, 0.01) * 0.6; }, false);
    B.hiss = make(c, 12, () => { const bp = new Biquad('bp', 2600, 0.7), lp = new Biquad('lp', 5000); return (t) => lp.p(bp.p(rnd())) * Math.min(1, t / 0.15) * (t > 10 ? Math.max(0, 1 - (t - 10) / 2) : 1) * (0.8 + 0.2 * Math.sin(t * 23 + Math.sin(t * 3) * 2)); }, false, 0.6);
    B.c4stick = make(c, 0.3, () => { const lp = new Biquad('lp', 500), bp = new Biquad('bp', 1200, 2); return (t) => lp.p(rnd()) * env(t, 0.002, 0.05) * 1.5 + bp.p(rnd()) * env(t, 0.001, 0.02); }, false);
    B.beep = tone(c, 0.3, (t) => (t < 0.07 || (t > 0.14 && t < 0.21) ? Math.sin(P2 * 2750 * t) * 0.5 : 0));
    B.clicker = mech(c, [{ at: 0, freq: 3300, tau: 0.006, g: 1, ping: [[2500, 0.15]] }, { at: 0.07, freq: 2800, tau: 0.008, g: 1.1 }], 0.2);
    // 자연: 새소리 4종, 돌풍(+나뭇잎), 풀벌레
    { let ph = 0; B.chirp0 = tone(c, 1.1, (t) => { const k = Math.floor(t / 0.13), tt = t - k * 0.13; if (k > 6 || tt > 0.06) return 0; const f = 6200 - tt / 0.06 * 2600 + (k % 2) * 400; ph += P2 * f / SR; return (Math.sin(ph) + 0.25 * Math.sin(ph * 2)) * Math.sin(Math.PI * tt / 0.06); }); }
    { let ph = 0; B.chirp1 = tone(c, 1.4, (t) => { const f = (Math.floor(t * 18) % 2 ? 4300 : 5200) + Math.sin(t * P2 * 60) * 250; ph += P2 * f / SR; const e = Math.sin(Math.PI * Math.min(1, t / 1.3)) * (0.5 + 0.5 * Math.abs(Math.sin(t * Math.PI * 18))); return t < 1.3 ? Math.sin(ph) * e : 0; }); }
    { let ph = 0; B.chirp2 = tone(c, 0.9, (t) => { const n = t < 0.32 ? 0 : t < 0.42 ? -1 : t < 0.8 ? 1 : -1; if (n < 0) return 0; const tt = n ? t - 0.42 : t, L = n ? 0.38 : 0.32; const f = n ? 3350 - tt * 300 : 4100 + tt * 250; ph += P2 * f / SR; return (Math.sin(ph) + 0.12 * Math.sin(ph * 2)) * Math.sin(Math.PI * tt / L); }); }
    { let ph = 0; B.chirp3 = tone(c, 1.8, (t) => { const seg = [[0, 0.35], [0.5, 1.05], [1.15, 1.6]]; for (const [a, b] of seg) if (t >= a && t < b) { const u = (t - a) / (b - a); ph += P2 * (560 + Math.sin(Math.PI * u) * 60) / SR; return (Math.sin(ph) + 0.3 * Math.sin(ph * 2)) * Math.sin(Math.PI * u) ** 1.5; } return 0; }); }
    B.gust = make(c, 5, (ch) => { const bp = new Biquad('bp', 380, 0.6), lp = new Biquad('lp', 160), hp = new Biquad('hp', 2800); return (t) => { const e = Math.pow(Math.sin(Math.PI * Math.min(1, t / 5)), 1.5); const n = rnd(); return bp.p(n) * e * 1.2 + lp.p(n) * e * 2 + hp.p(rnd()) * e * (Math.random() < 0.25 * e ? 1.2 : 0.15); }; }, true, 0.8);
    B.bugs = make(c, 4, (ch) => { const bugs = [[4700, 0.7, 0.1], [5200, 0.9, 0.45], [4400, 1.1, 0.8]]; return (t) => { let s = 0; for (const [f, per, off] of bugs) { const u = ((t + off + ch * 0.13) % per) / per; const g = u < 0.18 ? Math.max(0, Math.sin(u / 0.18 * Math.PI * 3)) : 0; s += Math.sin(P2 * f * t) * g; } return s * 0.5; }; }, true, 0.5);
    B.ding = tone(c, 1.6, (t) => (Math.sin(P2 * 1830 * t) * 0.5 + Math.sin(P2 * 2750 * t) * 0.35 + Math.sin(P2 * 4460 * t) * 0.2 + Math.sin(P2 * 6200 * t) * 0.1) * env(t, 0.0005, 0.35) * (1 + 0.15 * Math.sin(P2 * 7 * t)) + rnd() * env(t, 0.0003, 0.004) * 0.6);
    B.gong = tone(c, 2.4, (t) => (Math.sin(P2 * 620 * t) * 0.5 + Math.sin(P2 * 1040 * t) * 0.4 + Math.sin(P2 * 1590 * t) * 0.3 + Math.sin(P2 * 2400 * t) * 0.15) * env(t, 0.0008, 0.6) * (1 + 0.2 * Math.sin(P2 * 4 * t)) + rnd() * env(t, 0.0005, 0.006) * 0.5);
    B.ui = tone(c, 0.08, (t) => Math.sin(2 * Math.PI * 1800 * t) * env(t, 0.001, 0.015));
    B.pickup = tone(c, 0.3, (t) => Math.sin(2 * Math.PI * (700 + t * 1500) * t) * env(t, 0.005, 0.08));
    B.breath = make(c, 1.6, () => { const bp = new Biquad('bp', 900, 0.8); return (t) => bp.p(rnd()) * Math.sin(Math.PI * Math.min(1, t / 1.6)) * 0.6; }, false);
    B.wave = tone(c, 1.8, (t) => (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 330 * t) * 0.6 + Math.sin(2 * Math.PI * 110 * t) * 0.5) * env(t, 0.05, 0.6) * 0.5);
  }

  startAmbience() {
    const c = this.ctx;
    const b = make(c, 6, () => { let s = 0; const lp = new Biquad('lp', 380); return (t) => { s = s * 0.985 + rnd() * 0.015; return lp.p(s) * 8 * (0.7 + 0.3 * Math.sin(t / 6 * Math.PI * 2)); }; }, true, 0.5);
    const src = c.createBufferSource(); src.buffer = b; src.loop = true;
    this.ambGain = c.createGain(); this.ambGain.gain.value = 0.18;
    src.connect(this.ambGain).connect(this.master); src.start();
    const bugs = c.createBufferSource(); bugs.buffer = this.buf.bugs; bugs.loop = true;
    this.bugGain = c.createGain(); this.bugGain.gain.value = 0.035;
    bugs.connect(this.bugGain).connect(this.master); bugs.start();
  }
  setWind(k) { if (this.ambGain) this.ambGain.gain.setTargetAtTime(0.1 + k * 0.1, this.ctx.currentTime, 0.4); }

  setListener(pos, fwd) { this.listener.pos.copy(pos); this.listener.fwd.copy(fwd); }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  setIndoor(k) { this.indoor = k; if (this.wet) this.wet.gain.value = 0.2 + k * 0.5; }

  // 2D (플레이어 자신) 재생
  play(name, { vol = 1, rate = 1, jitter = 0.04, delay = 0, bus = 'sfx' } = {}) {
    if (!this.ctx || !this.buf[name]) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.buf[name];
    s.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
    const g = this.ctx.createGain(); g.gain.value = vol;
    s.connect(g).connect(bus === 'ui' ? this.uiBus : this.duck);
    s.start(this.ctx.currentTime + delay);
    return s;
  }

  // 3D 위치 재생: 거리 감쇠 + 저역 필터 + 소리 전파 지연 + 입체 패닝
  play3D(name, pos, { vol = 1, rate = 1, jitter = 0.05, ref = 4, maxLP = 20000, speedDelay = true } = {}) {
    if (!this.ctx || !this.buf[name]) return;
    const L = this.listener, dx = pos.x - L.pos.x, dy = pos.y - L.pos.y, dz = pos.z - L.pos.z;
    const d = Math.hypot(dx, dy, dz);
    const gain = vol * ref / Math.max(ref, d);
    if (gain < 0.004) return;
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.buf[name];
    s.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = Math.min(maxLP, 18000 * Math.exp(-d / 70) + 400);
    const g = c.createGain(); g.gain.value = gain;
    const right = new THREE.Vector3(-L.fwd.z, 0, L.fwd.x).normalize();
    const pan = c.createStereoPanner(); pan.pan.value = d > 0.01 ? THREE.MathUtils.clamp((dx * right.x + dz * right.z) / d, -1, 1) * 0.85 : 0;
    s.connect(f).connect(g).connect(pan).connect(this.duck);
    s.start(c.currentTime + (speedDelay ? d / 343 : 0));
  }

  // 폭발/피격 시 청각 둔화 (이명 효과)
  deafen(amount = 0.6, time = 1.5) {
    if (!this.ctx) return;
    const g = this.duck.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(Math.max(0.05, 1 - amount), t); g.linearRampToValueAtTime(1, t + time);
  }
}

export const Audio = new AudioSys();
