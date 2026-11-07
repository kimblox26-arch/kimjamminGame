// 효과음 (WebAudio 합성 — 외부 파일 없음)
import { S } from './store.js';

let ctx;
const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

function tone({ f0 = 440, f1 = f0, dur = 0.12, type = 'sine', vol = 0.3, delay = 0 }) {
  if (!S.settings.sfx) return;
  const a = ac(); if (a.state === 'suspended') a.resume();
  const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  const v = vol * (S.settings.volume / 100);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  click: () => tone({ f0: 900, f1: 700, dur: 0.05, type: 'triangle', vol: 0.15 }),
  jump: () => tone({ f0: 280, f1: 520, dur: 0.12, type: 'square', vol: 0.08 }),
  land: () => tone({ f0: 140, f1: 80, dur: 0.06, type: 'triangle', vol: 0.12 }),
  die: () => { tone({ f0: 420, f1: 150, dur: 0.35, type: 'sawtooth', vol: 0.12 }); },
  buy: () => { tone({ f0: 660, dur: 0.08, type: 'triangle', vol: 0.2 }); tone({ f0: 990, dur: 0.14, type: 'triangle', vol: 0.2, delay: 0.08 }); },
  coin: () => { tone({ f0: 988, dur: 0.07, type: 'square', vol: 0.08 }); tone({ f0: 1318, dur: 0.16, type: 'square', vol: 0.08, delay: 0.07 }); },
  intro: () => [262, 330, 392, 523].forEach((f, i) => tone({ f0: f, dur: 0.25, type: 'triangle', vol: 0.15, delay: i * 0.11 })),
  swing: () => tone({ f0: 900, f1: 250, dur: 0.18, type: 'sawtooth', vol: 0.05 }),
  shoot: () => tone({ f0: 200, f1: 900, dur: 0.25, type: 'sawtooth', vol: 0.06 }),
  boom: () => { tone({ f0: 120, f1: 30, dur: 0.6, type: 'sawtooth', vol: 0.25 }); tone({ f0: 60, f1: 20, dur: 0.8, type: 'square', vol: 0.15 }); },
  place: () => tone({ f0: 520, f1: 380, dur: 0.07, type: 'triangle', vol: 0.15 }),
  remove: () => tone({ f0: 300, f1: 140, dur: 0.1, type: 'triangle', vol: 0.15 }),
  badge: () => [523, 659, 784, 1047].forEach((f, i) => tone({ f0: f, dur: 0.3, type: 'triangle', vol: 0.14, delay: i * 0.09 })),
  shutter: () => tone({ f0: 2000, f1: 600, dur: 0.08, type: 'square', vol: 0.06 }),
  notify: () => tone({ f0: 740, f1: 990, dur: 0.15, type: 'sine', vol: 0.15 }),
};
export function unlockAudio() { try { ac().resume(); } catch { } }
