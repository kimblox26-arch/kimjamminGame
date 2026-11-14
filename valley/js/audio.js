// 소리: 직접 합성해 만든 소리 파일(sound/*.ogg, tools/valley_sounds.py)을 쓰고, 불러오기 전에는 실시간 합성 소리로 대신한다
let hum, motorS, ctx, master, white, brown, river, riverHi, fall, wind, rain, on = false;
const B = {}; let ready = false, amb = null, sfxBus, last = { night: 0, rain: 0 };
const FILES = ['river', 'fall', 'waves', 'wind', 'rain', 'night', 'hum', 'motor', 'chime', 'whoosh', 'brush',
  ...[0, 1, 2, 3, 4, 5].flatMap(i => ['bird' + i, 'hit' + i]), ...[0, 1, 2, 3].flatMap(i => ['splash' + i, 'dig' + i]),
  ...['mud', 'gravel', 'cement'].flatMap(k => [0, 1].map(i => `pour_${k}${i}`)), 'chip0', 'chip1', 'chip2', 'crack0', 'crack1', 'snap0', 'snap1',
  ...[0, 1, 2].flatMap(i => ['step_dry' + i, 'step_wet' + i])];
async function loadAll() {
  await Promise.allSettled(FILES.map(async n => { const r = await fetch(`sound/${n}.ogg`); if (!r.ok) throw 0; B[n] = await ctx.decodeAudioData(await r.arrayBuffer()); }));
  if (!B.river) return; // 파일이 없으면 합성 소리를 계속 쓴다
  sfxBus = ctx.createGain(); sfxBus.connect(master);
  // 환경음: 같은 모노 소리를 시작점을 어긋나게 둘 겹쳐 좌우로 펼친다
  const loopAmb = n => {
    const g = ctx.createGain(); g.gain.value = 0; g.connect(master);
    if (!B[n]) return { g };
    for (const [pan, off] of [[-0.55, 0], [0.55, 0.5]]) {
      const src = ctx.createBufferSource(); src.buffer = B[n]; src.loop = true;
      const p = ctx.createStereoPanner(); p.pan.value = pan; src.connect(p).connect(g); src.start(0, off * B[n].duration);
    }
    return { g };
  };
  amb = Object.fromEntries(['river', 'fall', 'waves', 'wind', 'rain', 'night', 'hum', 'motor'].map(n => [n, loopAmb(n)]));
  for (const x of [river, riverHi, fall, wind, rain]) x.g.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
  hum.g.gain.setTargetAtTime(0, ctx.currentTime, 0.2); motorS.g.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
  ready = true;
}
// 효과음 재생 (높낮이·크기를 조금씩 달리)
function play(name, gain = 1, rate = 1, pan = 0, lp = 0) {
  const b = B[name]; if (!on || !b) return false;
  const src = ctx.createBufferSource(); src.buffer = b; src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
  const g = ctx.createGain(); g.gain.value = gain; let node = src;
  if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node = node.connect(f); }
  if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
  node.connect(g).connect(sfxBus); src.start();
  return true;
}
const pick = (base, n) => base + ((Math.random() * n) | 0);
// 배경음악: 긴 파일이라 스트리밍(<audio>)으로 — 낮 · 밤 · 바다
const music = { on: true, vol: 0.32, cur: null, els: {} };
try { music.on = localStorage.getItem('valley.music') !== '0'; } catch {}
function musicEl(m) { let e = music.els[m]; if (!e) { e = music.els[m] = new Audio(`sound/music_${m}.ogg`); e.loop = true; e.volume = 0; e.preload = 'auto'; } return e; }
export function setMusic(onOff) { music.on = onOff; try { localStorage.setItem('valley.music', onOff ? '1' : '0'); } catch {} if (!onOff) for (const e of Object.values(music.els)) e.pause(); }
export const musicOn = () => music.on;
function musicUpdate(mood, dt) {
  if (!on) return;
  if (music.on && mood !== music.cur) { music.cur = mood; const e = musicEl(mood); if (e.paused) e.play().catch(() => {}); }
  for (const [m, e] of Object.entries(music.els)) {
    const want = music.on && m === music.cur ? music.vol : 0;
    e.volume = Math.max(0, Math.min(1, e.volume + Math.sign(want - e.volume) * Math.min(Math.abs(want - e.volume), dt * 0.25)));
    if (e.volume === 0 && !e.paused && m !== music.cur) e.pause();
  }
}

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
  if (ready) { amb.hum.g.gain.setTargetAtTime(Math.min(0.3, humLv * 0.3), ctx.currentTime, 0.4); amb.motor.g.gain.setTargetAtTime(Math.min(0.2, motorLv * 0.2), ctx.currentTime, 0.15); return; }
  hum.g.gain.setTargetAtTime(Math.min(0.12, humLv * 0.12), ctx.currentTime, 0.4);
  motorS.g.gain.setTargetAtTime(Math.min(0.06, motorLv * 0.06), ctx.currentTime, 0.15);
  motorS.o.frequency.setTargetAtTime(300 + motorLv * 80, ctx.currentTime, 0.2);
}
export function init() {
  if (ctx) { ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  master = ctx.createGain(); master.gain.value = 0.9;
  uw = ctx.createBiquadFilter(); uw.type = 'lowpass'; uw.frequency.value = 20000; uw.Q.value = 0.7; // 물속: 소리가 먹먹하게
  master.connect(uw).connect(comp).connect(ctx.destination);
  white = noiseBuf(0); brown = noiseBuf(1);
  river = loop(brown, 'lowpass', 700, 0.4);
  riverHi = loop(white, 'bandpass', 2400, 0.6);
  fall = loop(brown, 'lowpass', 1100, 0.3);
  wind = loop(brown, 'bandpass', 380, 0.8);
  rain = loop(white, 'highpass', 1800, 0.4);
  // 발전기 웅웅 소리(120 Hz) · 수문 모터 소리
  hum = osc(120, 'sawtooth', 'lowpass', 420); motorS = osc(330, 'sawtooth', 'bandpass', 900);
  on = true; birds(); loadAll();
}
const T = (p, v, tc = 0.3) => p.setTargetAtTime(v, ctx.currentTime, tc);
export function update(o) {
  if (!on) return;
  last = o; musicUpdate(o.mood || 'day', o.dt || 0.1);
  if (ready) {
    T(amb.river.g.gain, Math.min(0.7, o.flow * 0.55 + o.turb * 0.1));
    T(amb.fall.g.gain, o.sea ? 0 : 0.6 / (1 + o.fallDist * o.fallDist * 0.02));
    T(amb.waves.g.gain, Math.min(0.85, o.surf || 0));
    T(amb.wind.g.gain, 0.1 + o.rain * 0.2 + 0.04 * Math.sin(ctx.currentTime * 0.3));
    T(amb.rain.g.gain, o.rain * 0.45);
    T(amb.night.g.gain, (o.night || 0) * (1 - o.rain) * 0.35);
    return;
  }
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
  if (ready && play(s > 0.6 ? pick('hit', 2) === 'hit0' ? 'hit4' : 'hit5' : pick('hit', 4), 0.25 + s * 0.75, under ? 0.7 : 1, 0, under ? 600 : 0)) return;
  if (under) { burst({ dur: 0.25, freq: 380, q: 1.5, gain: 0.35 * s, type: 'lowpass', buf: brown }); return; }
  const f = 1400 + Math.random() * 1600;
  burst({ dur: 0.07 + s * 0.05, freq: f, q: 4, gain: 0.45 * s });
  burst({ dur: 0.05, freq: f * 2.1, q: 8, gain: 0.15 * s, delay: 0.004 });
  tone(140 + Math.random() * 60, 0.12, 0.25 * s, 'sine', 0, 70);
}
export function splash(s) {
  s = Math.min(1, s);
  if (ready && play(pick('splash', 4), 0.2 + s * 0.8, 1.15 - s * 0.3)) return;
  burst({ dur: 0.35 + s * 0.3, freq: 1600, q: 0.8, gain: 0.45 * s, sweep: 0.4 });
  burst({ dur: 0.2, freq: 500, q: 1, gain: 0.3 * s, type: 'lowpass', buf: brown });
  for (let i = 0; i < 4; i++) tone(600 + Math.random() * 900, 0.08, 0.05 * s, 'sine', 0.08 + Math.random() * 0.25, 1400 + Math.random() * 800);
}
export function dig() { if (ready && play(pick('dig', 4), 0.7)) return; burst({ dur: 0.22, freq: 900, q: 0.7, gain: 0.35, type: 'lowpass', buf: brown }); for (let i = 0; i < 5; i++) burst({ dur: 0.03, freq: 2500 + Math.random() * 2000, q: 3, gain: 0.08, delay: Math.random() * 0.15 }); }
export function pour(kind = 0) { if (!(ready && play(`pour_${['mud', 'gravel', 'cement'][kind]}${(Math.random() * 2) | 0}`, 0.6))) dump(); }
export function brush() { if (ready) play('brush', 0.35, 1, (Math.random() - 0.5) * 0.3); }
export function dump() { burst({ dur: 0.3, freq: 2200, q: 0.5, gain: 0.12, sweep: 0.5 }); burst({ dur: 0.2, freq: 300, q: 1, gain: 0.3, type: 'lowpass', buf: brown, delay: 0.05 }); }
export function step(wet) {
  if (ready && play(pick(wet ? 'step_wet' : 'step_dry', 3), 0.35)) return;
  if (wet) burst({ dur: 0.18, freq: 1200, q: 0.9, gain: 0.18, sweep: 0.5 });
  else for (let i = 0; i < 3; i++) burst({ dur: 0.04, freq: 1800 + Math.random() * 2500, q: 2, gain: 0.05, delay: i * 0.02 });
}
export function lift() { burst({ dur: 0.12, freq: 700, q: 1, gain: 0.15, type: 'lowpass', buf: brown }); }
export function whoosh() { if (ready && play('whoosh', 0.6)) return; burst({ dur: 0.35, freq: 600, q: 1.2, gain: 0.2, sweep: 3 }); }
export function clink() { tone(2400, 0.15, 0.08, 'triangle'); tone(3600, 0.1, 0.04, 'triangle', 0.01); }
export function chip() { if (ready && play(pick('chip', 3), 0.8)) return; tone(2600 + Math.random() * 800, 0.09, 0.1, 'triangle'); burst({ dur: 0.06, freq: 3500, q: 3, gain: 0.25 }); burst({ dur: 0.1, freq: 600, q: 1, gain: 0.2, type: 'lowpass', buf: brown }); }
export function crack(s = 0.6) {
  if (ready && play(pick('crack', 2), 0.5 + s * 0.5)) return;
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
  if (ready && play(pick('snap', 2), big ? 0.8 : 0.5, big ? 0.8 : 1.1)) return;
  tone(big ? 1700 : 2300, 0.05, 0.12, 'square'); burst({ dur: 0.04, freq: 4200, q: 6, gain: 0.12 });
  if (big) burst({ dur: 0.18, freq: 260, q: 1, gain: 0.25, type: 'lowpass', buf: brown, delay: 0.01 });
}
export function chime() { if (ready && play('chime', 0.7)) return; [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.6, 0.12, 'triangle', i * 0.11)); }
function birds() {
  const sing = () => {
    if (!on) return;
    if (ready) { // 낮에만, 비 오면 조용히
      if ((last.night || 0) < 0.4 && (last.rain || 0) < 0.4 && !last.sea) play(pick('bird', 6), 0.08 + Math.random() * 0.14, 0.9 + Math.random() * 0.25, (Math.random() - 0.5) * 1.6);
      setTimeout(sing, 2500 + Math.random() * 7000); return;
    }
    const base = 2200 + Math.random() * 1800, n = 2 + (Math.random() * 5) | 0;
    for (let i = 0; i < n; i++) tone(base * (0.9 + Math.random() * 0.25), 0.09, 0.025, 'sine', i * 0.12, base * (1.2 + Math.random() * 0.3));
    setTimeout(sing, 2500 + Math.random() * 7000);
  };
  setTimeout(sing, 1500);
}
let uw;
export function underwater(on) { if (uw) uw.frequency.setTargetAtTime(on ? 520 : 20000, ctx.currentTime, 0.08); }
export function setMuted(m) { if (master) master.gain.value = m ? 0 : 0.9; }
