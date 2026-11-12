// 실시간 합성 사운드 (WebAudio)
let hum, motorS, ctx, master, white, brown, river, riverHi, fall, wind, rain, on = false;

function noiseBuf(kind) {
  const n = ctx.sampleRate * 3, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (kind) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
  return b;
}
function loop(buf, type, freq, q) {
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0;
  s.connect(f).connect(g).connect(master); s.start(0, Math.random() * 2);
  return { g, f };
}
function osc(f, type, ftype, ff) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
  const fl = ctx.createBiquadFilter(); fl.type = ftype; fl.frequency.value = ff; fl.Q.value = 1.2;
  const g = ctx.createGain(); g.gain.value = 0; o.connect(fl).connect(g).connect(master); o.start();
  return { g, o };
}
export function machine(humLv, motorLv) {
  if (!on) return;
  hum.g.gain.setTargetAtTime(Math.min(0.12, humLv * 0.12), ctx.currentTime, 0.4);
  motorS.g.gain.setTargetAtTime(Math.min(0.06, motorLv * 0.06), ctx.currentTime, 0.15);
  motorS.o.frequency.setTargetAtTime(300 + motorLv * 80, ctx.currentTime, 0.2);
}
export function init() {
  if (ctx) { ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(comp).connect(ctx.destination);
  white = noiseBuf(0); brown = noiseBuf(1);
  river = loop(brown, 'lowpass', 700, 0.4);
  riverHi = loop(white, 'bandpass', 2400, 0.6);
  fall = loop(brown, 'lowpass', 1100, 0.3);
  wind = loop(brown, 'bandpass', 380, 0.8);
  rain = loop(white, 'highpass', 1800, 0.4);
  // 발전기 웅웅 소리(120 Hz) · 수문 모터 소리
  hum = osc(120, 'sawtooth', 'lowpass', 420); motorS = osc(330, 'sawtooth', 'bandpass', 900);
  on = true; birds();
}
const T = (p, v, tc = 0.3) => p.setTargetAtTime(v, ctx.currentTime, tc);
export function update(o) {
  if (!on) return;
  T(river.g.gain, Math.min(0.55, o.flow * 0.5));
  T(riverHi.g.gain, Math.min(0.12, o.turb * 0.12));
  T(fall.g.gain, 0.5 / (1 + o.fallDist * o.fallDist * 0.02));
  T(wind.g.gain, 0.05 + o.rain * 0.12 + 0.03 * Math.sin(ctx.currentTime * 0.3));
  T(wind.f.frequency, 320 + 120 * Math.sin(ctx.currentTime * 0.17));
  T(rain.g.gain, o.rain * 0.22);
}
function burst({ dur = 0.15, freq = 1000, q = 1, type = 'bandpass', gain = 0.3, buf, attack = 0.004, pitch = 1, sweep = 0, delay = 0 }) {
  if (!on) return;
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(); s.buffer = buf || white; s.playbackRate.value = pitch;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
}
function tone(freq, dur, gain, type = 'sine', delay = 0, f2) {
  if (!on) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}
export function impact(s, under) {
  s = Math.min(1, s);
  if (under) { burst({ dur: 0.25, freq: 380, q: 1.5, gain: 0.35 * s, type: 'lowpass', buf: brown }); return; }
  const f = 1400 + Math.random() * 1600;
  burst({ dur: 0.07 + s * 0.05, freq: f, q: 4, gain: 0.45 * s });
  burst({ dur: 0.05, freq: f * 2.1, q: 8, gain: 0.15 * s, delay: 0.004 });
  tone(140 + Math.random() * 60, 0.12, 0.25 * s, 'sine', 0, 70);
}
export function splash(s) {
  s = Math.min(1, s);
  burst({ dur: 0.35 + s * 0.3, freq: 1600, q: 0.8, gain: 0.45 * s, sweep: 0.4 });
  burst({ dur: 0.2, freq: 500, q: 1, gain: 0.3 * s, type: 'lowpass', buf: brown });
  for (let i = 0; i < 4; i++) tone(600 + Math.random() * 900, 0.08, 0.05 * s, 'sine', 0.08 + Math.random() * 0.25, 1400 + Math.random() * 800);
}
export function dig() { burst({ dur: 0.22, freq: 900, q: 0.7, gain: 0.35, type: 'lowpass', buf: brown }); for (let i = 0; i < 5; i++) burst({ dur: 0.03, freq: 2500 + Math.random() * 2000, q: 3, gain: 0.08, delay: Math.random() * 0.15 }); }
export function dump() { burst({ dur: 0.3, freq: 2200, q: 0.5, gain: 0.12, sweep: 0.5 }); burst({ dur: 0.2, freq: 300, q: 1, gain: 0.3, type: 'lowpass', buf: brown, delay: 0.05 }); }
export function step(wet) {
  if (wet) burst({ dur: 0.18, freq: 1200, q: 0.9, gain: 0.18, sweep: 0.5 });
  else for (let i = 0; i < 3; i++) burst({ dur: 0.04, freq: 1800 + Math.random() * 2500, q: 2, gain: 0.05, delay: i * 0.02 });
}
export function lift() { burst({ dur: 0.12, freq: 700, q: 1, gain: 0.15, type: 'lowpass', buf: brown }); }
export function whoosh() { burst({ dur: 0.35, freq: 600, q: 1.2, gain: 0.2, sweep: 3 }); }
export function clink() { tone(2400, 0.15, 0.08, 'triangle'); tone(3600, 0.1, 0.04, 'triangle', 0.01); }
export function chip() { tone(2600 + Math.random() * 800, 0.09, 0.1, 'triangle'); burst({ dur: 0.06, freq: 3500, q: 3, gain: 0.25 }); burst({ dur: 0.1, freq: 600, q: 1, gain: 0.2, type: 'lowpass', buf: brown }); }
export function crack(s = 0.6) {
  burst({ dur: 0.08, freq: 3000, q: 2, gain: 0.35 });
  burst({ dur: 0.45 + s * 0.3, freq: 420, q: 0.8, gain: 0.5 * (0.5 + s), type: 'lowpass', buf: brown, delay: 0.02 });
  tone(90 + Math.random() * 30, 0.35, 0.35 * (0.5 + s), 'sine', 0.02, 45);
  for (let i = 0; i < 6; i++) burst({ dur: 0.04, freq: 1800 + Math.random() * 2500, q: 3, gain: 0.1, delay: 0.08 + Math.random() * 0.35 });
}
export function rumble(dur = 4) { // 큰 공사 소리
  if (!on) return;
  for (let t = 0; t < dur; t += 0.35) burst({ dur: 0.6, freq: 160 + Math.random() * 80, q: 0.7, gain: 0.3, type: 'lowpass', buf: brown, delay: t });
  for (let t = 0.2; t < dur; t += 0.9) { tone(70, 0.4, 0.2, 'sine', t, 50); burst({ dur: 0.05, freq: 2600, q: 4, gain: 0.08, delay: t + 0.1 }); }
}
export function snap(big) { // 레고 블록 끼워지는 '딸깍'
  tone(big ? 1700 : 2300, 0.05, 0.12, 'square'); burst({ dur: 0.04, freq: 4200, q: 6, gain: 0.12 });
  if (big) burst({ dur: 0.18, freq: 260, q: 1, gain: 0.25, type: 'lowpass', buf: brown, delay: 0.01 });
}
export function chime() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.6, 0.12, 'triangle', i * 0.11)); }
function birds() {
  const sing = () => {
    if (!on) return;
    const base = 2200 + Math.random() * 1800, n = 2 + (Math.random() * 5) | 0;
    for (let i = 0; i < n; i++) tone(base * (0.9 + Math.random() * 0.25), 0.09, 0.025, 'sine', i * 0.12, base * (1.2 + Math.random() * 0.3));
    setTimeout(sing, 2500 + Math.random() * 7000);
  };
  setTimeout(sing, 1500);
}
export function setMuted(m) { if (master) master.gain.value = m ? 0 : 0.9; }
