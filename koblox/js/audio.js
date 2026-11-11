// 효과음 — 파일 없이 직접 만든 소리.
// 단순한 삐 소리 대신 잡음(바람·타격감), 종소리(FM 합성), 사람 목소리 같은 모음(포먼트), 잔향(리버브)을 섞어 만든다.
import { S } from './store.js';

let ctx, master, rev, noiseBuf;
function ac() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
  master = ctx.createGain(); master.connect(comp).connect(ctx.destination);
  rev = ctx.createConvolver(); rev.buffer = impulse(1.8, 3);
  const rg = ctx.createGain(); rg.gain.value = 0.6; rev.connect(rg).connect(master);
  const n = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}
function impulse(sec, decay) {
  const len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
  return b;
}
const vol = () => (S.settings.volume ?? 70) / 100;
const ready = () => { if (!S.settings.sfx) return null; const a = ac(); if (a.state === 'suspended') a.resume(); return a; };

// 출력: 원음 + 잔향 보내기
function send(node, wet = 0.12) {
  node.connect(master);
  if (wet > 0) { const g = ctx.createGain(); g.gain.value = wet; node.connect(g).connect(rev); }
}
function envGain(t, peak, attack, dur) {
  const g = ctx.createGain(), p = Math.max(peak * vol(), 0.0002);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(p, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  return g;
}
// 음정 있는 소리
function tone({ f0, f1 = f0, t = 0, dur = 0.2, peak = 0.2, type = 'sine', attack = 0.005, wet = 0.12, glide }) {
  const T = ctx.currentTime + t, o = ctx.createOscillator(), g = envGain(T, peak, attack, dur);
  o.type = type; o.frequency.setValueAtTime(f0, T);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, T + (glide ?? dur));
  o.connect(g); send(g, wet); o.start(T); o.stop(T + attack + dur + 0.05);
  return o;
}
// 잡음 (필터로 모양을 만든다)
function hiss({ t = 0, dur = 0.2, peak = 0.2, attack = 0.005, type = 'bandpass', f0 = 1000, f1 = f0, Q = 1, wet = 0.1, rate = 1 }) {
  const T = ctx.currentTime + t, src = ctx.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = rate;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = Q; f.frequency.setValueAtTime(f0, T);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, T + attack + dur);
  const g = envGain(T, peak, attack, dur);
  src.connect(f).connect(g); send(g, wet); src.start(T, Math.random() * 0.5); src.stop(T + attack + dur + 0.05);
}
// 종소리 (FM 합성) — 맑은 금속성 울림
function bell({ f, t = 0, dur = 1.2, peak = 0.16, ratio = 3.5, index = 2.2, wet = 0.3 }) {
  const T = ctx.currentTime + t;
  const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain();
  car.frequency.value = f; mod.frequency.value = f * ratio;
  mg.gain.setValueAtTime(f * index, T); mg.gain.exponentialRampToValueAtTime(f * 0.05, T + dur);
  mod.connect(mg).connect(car.frequency);
  const g = envGain(T, peak, 0.003, dur);
  car.connect(g); send(g, wet); car.start(T); mod.start(T); car.stop(T + dur + 0.05); mod.stop(T + dur + 0.05);
}
// 사람 목소리 같은 모음 ("우오" 같은 소리) — 톱니파를 모음 공명대로 거른다
function voice({ f0, f1, t = 0, dur = 0.4, peak = 0.3, formants = [[500, 1], [900, 0.6], [2500, 0.2]], wet = 0.15 }) {
  const T = ctx.currentTime + t, o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(f0, T); o.frequency.exponentialRampToValueAtTime(f1, T + dur);
  const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 6; vg.gain.value = f0 * 0.02; vib.connect(vg).connect(o.frequency);
  const g = envGain(T, peak, 0.03, dur), sum = ctx.createGain(); sum.gain.value = 1;
  formants.forEach(([ff, a]) => { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = 8; const ag = ctx.createGain(); ag.gain.value = a * 3; o.connect(bp).connect(ag).connect(sum); });
  sum.connect(g); send(g, wet); o.start(T); vib.start(T); o.stop(T + dur + 0.1); vib.stop(T + dur + 0.1);
}

const P = (fn) => (...a) => { try { if (ready()) fn(...a); } catch { } };
export const sfx = {
  // 화면 버튼: 부드러운 "톡"
  click: P(() => { tone({ f0: 900, f1: 380, dur: 0.05, peak: 0.12, wet: 0 }); hiss({ dur: 0.02, peak: 0.04, type: 'highpass', f0: 4000, wet: 0 }); }),
  // 점프: 몸이 휙 뜨는 바람 + 짧은 숨소리
  jump: P(() => { hiss({ dur: 0.18, peak: 0.16, f0: 500, f1: 1800, Q: 1.2, attack: 0.02 }); tone({ f0: 180, f1: 260, dur: 0.1, peak: 0.08, type: 'triangle', wet: 0 }); }),
  // 착지: 쿵
  land: P(() => { hiss({ dur: 0.09, peak: 0.25, type: 'lowpass', f0: 500, f1: 120, wet: 0.02 }); tone({ f0: 95, f1: 50, dur: 0.1, peak: 0.25, wet: 0 }); }),
  // 발소리: 플라스틱 바닥을 딛는 소리
  step: P(() => { const r = 0.85 + Math.random() * 0.3; hiss({ dur: 0.045, peak: 0.1, type: 'bandpass', f0: 900 * r, Q: 1.4, wet: 0.02 }); tone({ f0: 140 * r, f1: 80, dur: 0.05, peak: 0.07, wet: 0 }); }),
  // 캐릭터가 부서질 때: "우워" 하는 목소리 + 블록 흩어지는 소리
  die: P(() => {
    voice({ f0: 260, f1: 150, dur: 0.38, peak: 0.32, formants: [[450, 1], [800, 0.7], [2600, 0.15]] });
    for (let i = 0; i < 6; i++) hiss({ t: 0.05 + i * 0.05 + Math.random() * 0.04, dur: 0.05, peak: 0.12, type: 'bandpass', f0: 1200 + Math.random() * 1500, Q: 3, wet: 0.08 });
  }),
  // 구매: 계산대 같은 맑은 두 음 + 반짝
  buy: P(() => { bell({ f: 1047, peak: 0.12 }); bell({ f: 1568, t: 0.09, peak: 0.12 }); hiss({ t: 0.05, dur: 0.4, peak: 0.04, type: 'highpass', f0: 6000, wet: 0.3 }); }),
  // 코인: 반짝이는 종소리
  coin: P(() => { bell({ f: 1319, dur: 0.5, peak: 0.12, ratio: 2.01, index: 1.5 }); bell({ f: 1976, t: 0.07, dur: 0.8, peak: 0.12, ratio: 2.01, index: 1.5 }); }),
  // 인트로: 따뜻한 화음이 차오르다 종이 울린다
  intro: P(() => {
    [262, 330, 392, 494].forEach((f, i) => { tone({ f0: f, dur: 1.6, peak: 0.05, type: 'triangle', attack: 0.5, wet: 0.5 }); tone({ f0: f * 1.004, dur: 1.6, peak: 0.04, attack: 0.6, wet: 0.5, t: i * 0.02 }); });
    [784, 1047, 1319].forEach((f, i) => bell({ f, t: 0.5 + i * 0.12, peak: 0.08, dur: 1.4, wet: 0.5 }));
  }),
  // 검: 휙 가르는 바람
  swing: P(() => hiss({ dur: 0.22, peak: 0.22, f0: 2600, f1: 500, Q: 2, attack: 0.03, wet: 0.05 })),
  // 로켓 발사: 쉬익 하고 올라가는 분사음
  shoot: P(() => { hiss({ dur: 0.5, peak: 0.25, type: 'lowpass', f0: 600, f1: 3500, attack: 0.02, wet: 0.1 }); tone({ f0: 120, f1: 60, dur: 0.15, peak: 0.2, wet: 0 }); }),
  // 폭발: 낮게 울리는 쾅 + 파편
  boom: P(() => {
    hiss({ dur: 1.2, peak: 0.6, type: 'lowpass', f0: 3000, f1: 80, attack: 0.005, wet: 0.35, rate: 0.6 });
    tone({ f0: 70, f1: 28, dur: 0.9, peak: 0.5, wet: 0.1 });
    for (let i = 0; i < 5; i++) hiss({ t: 0.15 + Math.random() * 0.5, dur: 0.05, peak: 0.06, f0: 2000 + Math.random() * 2000, Q: 4, wet: 0.2 });
  }),
  // 블록 놓기: 나무 블록 "딱"
  place: P(() => { tone({ f0: 620, f1: 560, dur: 0.07, peak: 0.16, wet: 0.05 }); hiss({ dur: 0.03, peak: 0.12, f0: 2200, Q: 2, wet: 0.03 }); }),
  // 블록 지우기: "뽁"
  remove: P(() => { tone({ f0: 500, f1: 200, dur: 0.08, peak: 0.16, wet: 0.03 }); hiss({ dur: 0.04, peak: 0.08, type: 'lowpass', f0: 1500, wet: 0 }); }),
  // 배지: 반짝이는 종소리 아르페지오
  badge: P(() => { [1047, 1319, 1568, 2093].forEach((f, i) => bell({ f, t: i * 0.08, dur: 1.4, peak: 0.09, ratio: 2.01, index: 1.2, wet: 0.45 })); hiss({ dur: 1.2, peak: 0.03, type: 'highpass', f0: 7000, attack: 0.2, wet: 0.5 }); }),
  // 체크포인트: 올라가는 두 음
  check: P(() => { bell({ f: 784, peak: 0.12, ratio: 2.01, index: 1 }); bell({ f: 1175, t: 0.1, peak: 0.12, ratio: 2.01, index: 1 }); }),
  // 점프대: 스프링 "뾰잉"
  boing: P(() => { const o = tone({ f0: 160, f1: 620, dur: 0.35, peak: 0.18, type: 'triangle', glide: 0.25, wet: 0.1 }); const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 18; lg.gain.value = 40; l.connect(lg).connect(o.frequency); l.start(); l.stop(ctx.currentTime + 0.4); }),
  // 캡처: 카메라 셔터
  shutter: P(() => { hiss({ dur: 0.025, peak: 0.25, type: 'highpass', f0: 2500, wet: 0 }); hiss({ t: 0.07, dur: 0.035, peak: 0.2, type: 'bandpass', f0: 1800, wet: 0 }); }),
  notify: P(() => { bell({ f: 1319, peak: 0.1 }); bell({ f: 1760, t: 0.12, peak: 0.1 }); }),
};

// 게임 배경 소리: 잔잔한 바람 + 가끔 새소리 (밤에는 풀벌레)
let amb = null;
export function startAmbient(kind = 'day') {
  stopAmbient();
  if (!S.settings.music || !S.settings.sfx) return;
  try {
    const a = ac(); if (a.state === 'suspended') a.resume();
    const src = a.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const g = a.createGain(); g.gain.value = 0.035 * vol();
    const lfo = a.createOscillator(), lg = a.createGain(); lfo.frequency.value = 0.08; lg.gain.value = 0.02 * vol(); lfo.connect(lg).connect(g.gain);
    src.connect(lp).connect(g).connect(master); src.start(); lfo.start();
    const chirp = () => {
      if (!amb) return;
      if (kind === 'night') { for (let i = 0; i < 6; i++) tone({ f0: 4200, dur: 0.02, peak: 0.015, t: i * 0.05, wet: 0.2 }); }
      else { const base = 2400 + Math.random() * 1400, n = 2 + (Math.random() * 3 | 0); for (let i = 0; i < n; i++) tone({ f0: base, f1: base * 1.35, dur: 0.07, peak: 0.02, t: i * 0.11, glide: 0.06, wet: 0.35 }); }
      amb.timer = setTimeout(chirp, (kind === 'night' ? 900 : 3500) + Math.random() * 5000);
    };
    amb = { src, lfo, g, timer: setTimeout(chirp, 2000) };
  } catch { amb = null; }
}
export function stopAmbient() {
  if (!amb) return;
  clearTimeout(amb.timer);
  try { amb.g.gain.setTargetAtTime(0, ctx.currentTime, 0.2); amb.src.stop(ctx.currentTime + 0.6); amb.lfo.stop(ctx.currentTime + 0.6); } catch { }
  amb = null;
}
export function unlockAudio() { try { ac().resume(); } catch { } }
