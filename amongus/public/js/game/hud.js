// 게임 HUD: 행동 버튼(아이콘·쿨다운), 임무 목록/진행 바, 사보타주 경보, 숨바꼭질 HUD, 역할 소개, 알림·효과음
import { $, $$, h, esc, stage, sfx, settings } from '../core.js';
import { COLORS } from '../shared/data.js';
import { stepLabel, taskById, lineClear } from '../shared/maps/index.js';
import { crewSVG } from '../ui/crew.js';
import { scene } from './scene.js';
import { G, R, act, alive, isImp, commsOn, roleDef, roleName, roleColor, roleOpt, nameOf, lookOf, now, KILL_D, myTasksDone, sabDef, hnsMode, isSeeker } from './play.js';

// ---------- 아이콘 (SVG, viewBox 0 0 100 100) ----------
const K = 'stroke="#000" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"';
const sector = (a, r1, r2, w = 30) => {
  const p = (r, d) => { const t = ((a + d) * Math.PI) / 180; return `${(50 + r * Math.cos(t)).toFixed(1)} ${(50 + r * Math.sin(t)).toFixed(1)}`; };
  return `M${p(r1, -w)} L${p(r2, -w)} A${r2} ${r2} 0 0 1 ${p(r2, w)} L${p(r1, w)} A${r1} ${r1} 0 0 0 ${p(r1, -w)}Z`;
};
const BEAN = (x, y, s, c, v = '#9fd3e6') => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-22 30 V-6 C-22 -24 -10 -32 2 -32 C16 -32 24 -22 24 -6 V30 H8 V20 H-6 V30 Z" fill="${c}" ${K}/><rect x="-2" y="-20" width="30" height="16" rx="8" fill="${v}" ${K} stroke-width="4"/><rect x="-32" y="-8" width="12" height="28" rx="5" fill="${c}" ${K} stroke-width="4"/></g>`;
export const ICON = {
  use: `<path d="M30 94 C20 82 12 68 14 58 C16 50 26 50 30 57 L36 66 V24 C36 15 47 15 47 24 V50 V14 C47 5 58 5 58 14 V50 V18 C58 9 69 9 69 18 V52 V30 C69 21 80 21 80 30 V68 C80 82 74 90 66 94 Z" fill="#f5f7f8" ${K}/><path d="M36 66 C40 74 46 78 56 78" fill="none" stroke="#b8c4cb" stroke-width="5" stroke-linecap="round"/><path d="M47 46 V24 M58 46 V20 M69 48 V30" stroke="#c9d3d8" stroke-width="4" stroke-linecap="round"/>`,
  report: `<path d="M14 40 H30 L70 16 V84 L30 60 H14 Z" fill="#e8463c" ${K}/><path d="M30 40 V60" stroke="#000" stroke-width="5"/><path d="M14 40 H30 V60 H14Z" fill="#f2f2f2" ${K}/><path d="M22 60 L28 84 H40 L36 60" fill="#bdbdbd" ${K} stroke-width="4"/><ellipse cx="70" cy="50" rx="8" ry="34" fill="#c22a22" ${K}/><path d="M84 34 Q92 50 84 66 M90 24 Q104 50 90 76" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`,
  kill: `<path d="M24 76 L70 26 C76 20 84 16 90 12 C88 22 82 32 76 38 L32 84 Z" fill="#e2e8ec" ${K}/><path d="M30 72 L72 28" stroke="#9aa6ad" stroke-width="4"/><path d="M14 72 L28 86 M10 86 L24 72 L36 84 L22 98 Z" fill="#3b2a1d" ${K}/><path d="M74 30 C78 36 76 42 72 40" fill="#c00" stroke="none"/>`,
  sabotage: `<circle cx="50" cy="50" r="42" fill="#d61f1f" ${K}/><circle cx="50" cy="50" r="34" fill="#ff4a3a"/>${[90, 210, 330].map(a => `<path d="${sector(a, 12, 32)}" fill="#1a1a1a"/>`).join('')}<circle cx="50" cy="50" r="7" fill="#1a1a1a"/>`,
  vent: `<rect x="10" y="30" width="80" height="50" rx="8" fill="#56616a" ${K}/><rect x="16" y="36" width="68" height="38" rx="4" fill="#2d343a"/>${[24, 35, 46, 57, 68].map(x => `<rect x="${x}" y="38" width="7" height="34" rx="2" fill="#7e8a93"/>`).join('')}<path d="M50 2 L66 20 H57 V30 H43 V20 H34 Z" fill="#46e06a" ${K} stroke-width="4"/>`,
  vitals: `<rect x="8" y="16" width="84" height="60" rx="8" fill="#22343a" ${K}/><path d="M14 48 H32 L38 30 L46 64 L54 36 L58 48 H86" fill="none" stroke="#3dff6e" stroke-width="5" stroke-linejoin="round"/><path d="M40 76 L36 90 H64 L60 76" fill="#6b777d" ${K} stroke-width="4"/>`,
  protect: `<path d="M50 16 L80 26 V50 C80 70 66 84 50 92 C34 84 20 70 20 50 V26 Z" fill="#8fe3ff" ${K}/><path d="M50 26 L70 33 V50 C70 64 61 74 50 80 Z" fill="#c9f4ff"/><ellipse cx="50" cy="8" rx="20" ry="6" fill="none" stroke="#ffe066" stroke-width="5"/><path d="M20 40 C8 36 4 26 6 18 C14 24 18 26 22 30 M80 40 C92 36 96 26 94 18 C86 24 82 26 78 30" fill="#fff" stroke="#000" stroke-width="3"/>`,
  shift: `${BEAN(34, 56, 0.9, '#c51111')}${BEAN(68, 50, 0.9, '#132ed1')}<path d="M30 12 Q50 0 70 12 M64 6 L70 12 L62 16" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="50" cy="50" r="46" fill="none" stroke="#ff5a5a" stroke-width="3" stroke-dasharray="6 6" opacity=".7"/>`,
  unshift: `${BEAN(50, 54, 1.05, '#c51111')}<path d="M18 22 Q50 -2 82 22 M76 12 L82 22 L72 26" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`,
  vanish: `<g opacity=".95"><circle cx="34" cy="60" r="20" fill="#cfd6db" ${K} stroke-width="4"/><circle cx="58" cy="48" r="24" fill="#e7ecef" ${K} stroke-width="4"/><circle cx="74" cy="66" r="16" fill="#cfd6db" ${K} stroke-width="4"/><circle cx="48" cy="70" r="18" fill="#e7ecef" stroke="none"/></g><g opacity=".55">${BEAN(52, 48, 0.75, '#c51111')}</g>`,
  appear: `${BEAN(50, 52, 1, '#c51111')}<g fill="#e7ecef" stroke="#000" stroke-width="3" opacity=".9"><circle cx="18" cy="76" r="10"/><circle cx="84" cy="80" r="9"/><circle cx="82" cy="22" r="7"/></g>`,
  track: `<circle cx="50" cy="50" r="34" fill="#173b23" ${K}/><circle cx="50" cy="50" r="22" fill="none" stroke="#45ff7a" stroke-width="4"/><path d="M50 6 V30 M50 70 V94 M6 50 H30 M70 50 H94" stroke="#000" stroke-width="9" stroke-linecap="round"/><path d="M50 8 V30 M50 70 V92 M8 50 H30 M70 50 H92" stroke="#45ff7a" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="50" r="7" fill="#45ff7a" stroke="#000" stroke-width="3"/>`,
  untrack: `<circle cx="50" cy="50" r="34" fill="#3b1717" ${K}/><path d="M28 28 L72 72 M72 28 L28 72" stroke="#ff5a5a" stroke-width="9" stroke-linecap="round"/>`,
  interrogate: `<circle cx="42" cy="42" r="28" fill="#cfe9ff" ${K}/><circle cx="42" cy="42" r="20" fill="#e9f6ff"/><path d="M62 62 L88 88" stroke="#000" stroke-width="14" stroke-linecap="round"/><path d="M62 62 L88 88" stroke="#7a4b23" stroke-width="7" stroke-linecap="round"/><path d="M34 34 C34 24 52 24 50 36 C49 42 42 42 42 50" fill="none" stroke="#1b4d8a" stroke-width="6" stroke-linecap="round"/><circle cx="42" cy="58" r="3.5" fill="#1b4d8a"/>`,
  notes: `<rect x="18" y="10" width="62" height="80" rx="6" fill="#f3e2b3" ${K}/><path d="M18 22 H10 M18 38 H10 M18 54 H10 M18 70 H10" stroke="#000" stroke-width="5"/><path d="M30 30 H68 M30 44 H68 M30 58 H58" stroke="#8a7a52" stroke-width="4"/><path d="M58 88 L88 40 L96 46 L66 94 L56 96 Z" fill="#ffcf3a" ${K} stroke-width="4"/>`,
  acid: `<path d="M50 6 C62 30 78 46 78 64 C78 82 64 94 50 94 C36 94 22 82 22 64 C22 46 38 30 50 6 Z" fill="#7dff3a" ${K}/><path d="M40 60 C40 72 46 80 56 80" fill="none" stroke="#d8ffb8" stroke-width="6" stroke-linecap="round"/><circle cx="62" cy="58" r="5" fill="#3a9a10"/>`,
  message: `<path d="M12 18 H88 V68 H46 L26 86 V68 H12 Z" fill="#b48cff" ${K}/><rect x="22" y="28" width="16" height="16" rx="3" fill="#ffe14d" stroke="#000" stroke-width="3"/><circle cx="52" cy="36" r="9" fill="#5ad1ff" stroke="#000" stroke-width="3"/><path d="M66 46 L74 28 L82 46 Z" fill="#ff6a6a" stroke="#000" stroke-width="3"/>`,
  overrule: `<rect x="20" y="22" width="44" height="22" rx="5" transform="rotate(-30 42 33)" fill="#8a5a2b" ${K}/><path d="M48 44 L82 84" stroke="#000" stroke-width="13" stroke-linecap="round"/><path d="M48 44 L82 84" stroke="#c48a4a" stroke-width="6" stroke-linecap="round"/><rect x="8" y="80" width="46" height="12" rx="4" fill="#6b4220" ${K} stroke-width="4"/>`,
  cams: `<rect x="14" y="30" width="54" height="34" rx="6" fill="#d9dee2" ${K}/><path d="M68 40 L90 30 V64 L68 54 Z" fill="#7e8a93" ${K}/><circle cx="32" cy="47" r="9" fill="#2a3338" stroke="#000" stroke-width="3"/><circle cx="56" cy="38" r="4" fill="#f22"/><path d="M40 64 V84 M28 84 H52" stroke="#000" stroke-width="6" stroke-linecap="round"/>`,
  admin: `<ellipse cx="50" cy="64" rx="42" ry="20" fill="#2c3d47" ${K}/><path d="M22 60 L36 44 L60 40 L78 54 L66 72 L38 74 Z" fill="#3ef08a" stroke="#0b5" stroke-width="3" opacity=".9"/><path d="M50 10 V40" stroke="#3ef08a" stroke-width="5" stroke-dasharray="4 5"/>`,
  doorlog: `<rect x="16" y="12" width="68" height="76" rx="6" fill="#2d3a40" ${K}/><path d="M26 30 H74 M26 46 H74 M26 62 H60" stroke="#57e3ff" stroke-width="5"/><rect x="24" y="24" width="10" height="10" fill="#c51111"/><rect x="24" y="40" width="10" height="10" fill="#132ed1"/><rect x="24" y="56" width="10" height="10" fill="#117f2d"/>`,
  ladder: `<path d="M30 6 V94 M70 6 V94" stroke="#000" stroke-width="12" stroke-linecap="round"/><path d="M30 6 V94 M70 6 V94" stroke="#c9a067" stroke-width="6" stroke-linecap="round"/>${[20, 38, 56, 74].map(y => `<path d="M30 ${y} H70" stroke="#000" stroke-width="9"/><path d="M30 ${y} H70" stroke="#e0bd85" stroke-width="4"/>`).join('')}`,
  zipline: `<path d="M4 24 L96 60" stroke="#000" stroke-width="5"/><path d="M48 40 V56" stroke="#000" stroke-width="5"/><rect x="38" y="30" width="22" height="14" rx="4" fill="#ffb000" ${K} stroke-width="4"/>${BEAN(50, 74, 0.6, '#132ed1')}`,
  platform: `<rect x="14" y="54" width="72" height="18" rx="4" fill="#9aa6ad" ${K}/><path d="M24 72 L18 90 M76 72 L82 90" stroke="#000" stroke-width="6"/>${BEAN(50, 30, 0.6, '#c51111')}<path d="M6 64 H0 M100 64 H94" stroke="#fff" stroke-width="5"/>`,
  stairs: `<path d="M8 90 V74 H26 V58 H44 V42 H62 V26 H80 V10 H92 V90 Z" fill="#a9b3b9" ${K}/>`,
  decon: `<rect x="20" y="8" width="60" height="84" rx="6" fill="#86a3ad" ${K}/><path d="M32 30 Q50 20 68 30 M32 50 Q50 40 68 50 M32 70 Q50 60 68 70" fill="none" stroke="#e7fbff" stroke-width="5" stroke-linecap="round"/>`,
  door: `<rect x="22" y="8" width="56" height="84" rx="4" fill="#7e8a93" ${K}/><rect x="30" y="16" width="40" height="68" fill="#5b666d"/><path d="M50 16 V84" stroke="#000" stroke-width="4"/><rect x="58" y="44" width="14" height="14" rx="3" fill="#ffd400" stroke="#000" stroke-width="3"/>`,
  button: `<ellipse cx="50" cy="70" rx="42" ry="18" fill="#ffb300" ${K}/><ellipse cx="50" cy="56" rx="32" ry="16" fill="#9a0b0b" ${K}/><ellipse cx="50" cy="50" rx="30" ry="14" fill="#e53935" stroke="#000" stroke-width="3"/><ellipse cx="42" cy="46" rx="10" ry="4" fill="#ff8a80"/>`,
  customize: `<rect x="16" y="20" width="68" height="46" rx="4" fill="#d6dbdf" ${K}/><rect x="22" y="26" width="56" height="34" fill="#2a9d5a"/><path d="M8 72 H92 L84 84 H16 Z" fill="#b9c0c5" ${K}/>${BEAN(50, 44, 0.42, '#c51111')}`,
  map: `<path d="M8 22 L34 12 L66 22 L92 12 V78 L66 88 L34 78 L8 88 Z" fill="#7ec8ff" ${K}/><path d="M34 12 V78 M66 22 V88" stroke="#000" stroke-width="4"/><path d="M14 64 L28 46 L44 56 L58 38 L86 48" fill="none" stroke="#ff4d4d" stroke-width="4" stroke-dasharray="5 4"/>`,
  gear: `<circle cx="50" cy="50" r="30" fill="#cfd6db" ${K}/>${[0, 45, 90, 135, 180, 225, 270, 315].map(a => `<rect x="44" y="6" width="12" height="18" rx="3" fill="#cfd6db" ${K} stroke-width="4" transform="rotate(${a} 50 50)"/>`).join('')}<circle cx="50" cy="50" r="24" fill="#cfd6db"/><circle cx="50" cy="50" r="11" fill="#5b666d" stroke="#000" stroke-width="4"/>`,
  chat: `<path d="M10 16 H90 V68 H44 L22 88 V68 H10 Z" fill="#fff" ${K}/><circle cx="32" cy="42" r="6"/><circle cx="50" cy="42" r="6"/><circle cx="68" cy="42" r="6"/>`,
  guide: `<rect x="18" y="14" width="64" height="80" rx="8" fill="#d8b47a" ${K}/><rect x="26" y="24" width="48" height="62" fill="#fff"/><rect x="36" y="6" width="28" height="16" rx="4" fill="#9aa6ad" ${K} stroke-width="4"/><path d="M32 40 H68 M32 54 H68 M32 68 H58" stroke="#5b666d" stroke-width="5"/>`,
  players: `${BEAN(36, 56, 0.8, '#132ed1')}${BEAN(64, 52, 0.85, '#c51111')}`,
  mixup: `<path d="M14 54 C14 22 86 22 86 54 Z" fill="#ff7b2e" ${K}/><circle cx="36" cy="40" r="6" fill="#ffe6c8"/><circle cx="60" cy="34" r="5" fill="#ffe6c8"/><rect x="40" y="54" width="20" height="34" rx="7" fill="#fff3dc" ${K}/>`,
  lights: `<path d="M50 8 C28 8 18 26 22 42 C25 54 36 58 36 70 H64 C64 58 75 54 78 42 C82 26 72 8 50 8 Z" fill="#ffe14d" ${K}/><rect x="36" y="70" width="28" height="18" rx="4" fill="#9aa6ad" ${K} stroke-width="4"/><path d="M42 28 L54 46 L46 50 L58 64" fill="none" stroke="#000" stroke-width="5"/>`,
  comms: `<path d="M26 92 L50 40 L74 92" fill="none" stroke="#000" stroke-width="9"/><path d="M26 92 L50 40 L74 92 M36 70 H64" fill="none" stroke="#b9c0c5" stroke-width="4"/><circle cx="50" cy="34" r="10" fill="#ff4a3a" stroke="#000" stroke-width="4"/><path d="M28 18 Q50 0 72 18 M18 8 Q50 -14 82 8" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`,
  reactor: `<circle cx="50" cy="50" r="40" fill="#ffd400" ${K}/>${[90, 210, 330].map(a => `<path d="${sector(a, 12, 34)}" fill="#1a1a1a"/>`).join('')}<circle cx="50" cy="50" r="7" fill="#1a1a1a"/>`,
  o2: `<circle cx="50" cy="50" r="40" fill="#59c2ff" ${K}/><text x="50" y="64" text-anchor="middle" font-size="40" font-weight="900" font-family="Arial,sans-serif" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">O₂</text>`,
  seismic: `<circle cx="50" cy="50" r="40" fill="#ff8a2a" ${K}/><path d="M12 54 H28 L36 30 L46 72 L56 22 L64 62 L70 48 H88" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>`,
  crash: `<circle cx="50" cy="50" r="40" fill="#ff5252" ${K}/><path d="M24 64 L64 32 L76 26 L72 38 L40 74 Z" fill="#fff" stroke="#000" stroke-width="4"/><path d="M48 46 L30 40 L26 46 L44 54 M56 58 L60 76 L54 78 L48 62" fill="#fff" stroke="#000" stroke-width="3"/>`,
};
export const icon = (k, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 100 100">${ICON[k] || ICON.use}</svg>`;
// 사보타주 종류 → 아이콘
export const sabIcon = (k, d = {}) => d.type === 'lights' ? 'lights' : d.type === 'comms' ? 'comms' : d.type === 'mixup' ? 'mixup'
  : /o2|oxy/i.test(k) ? 'o2' : /seis|quake/i.test(k) ? 'seismic' : /crash|heli|avert/i.test(k) ? 'crash' : 'reactor';

// ---------- 효과음 (WebAudio 합성, core.sfx 에 없는 것들) ----------
let AC = null, noiseBuf = null;
const ac = () => {
  if (!AC) { const A = window.AudioContext || window.webkitAudioContext; if (A) AC = new A(); }
  if (AC?.state === 'suspended') AC.resume();
  return AC;
};
export function tone(seq) {
  const a = ac(); if (!a || !settings.sfx) return;
  for (const [f, d, type = 'sine', vol = 0.3, at = 0, f2] of seq) {
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(vol * settings.sfx * 0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + 0.02);
  }
}
function noise(dur, vol = 0.3, hp = 2000, at = 0) {
  const a = ac(); if (!a || !settings.sfx) return;
  if (!noiseBuf) { noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + at;
  s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = hp;
  g.gain.setValueAtTime(vol * settings.sfx * 0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(a.destination); s.start(t); s.stop(t + dur + 0.05);
}
export const SND = {
  shh: () => noise(0.9, 0.25, 3500),
  alarm: () => tone([[620, 0.45, 'sawtooth', 0.22, 0, 900], [900, 0.45, 'sawtooth', 0.22, 0.5, 620]]),
  beat: lv => tone([[60 + lv * 20, 0.12, 'sine', 0.5 + lv * 0.4], [55 + lv * 20, 0.14, 'sine', 0.4 + lv * 0.3, 0.18]]),
  squeak: () => tone([[1400, 0.18, 'square', 0.18, 0, 2400], [2200, 0.25, 'square', 0.15, 0.2, 1500]]),
  gavel: () => { tone([[90, 0.25, 'square', 0.6], [60, 0.4, 'sine', 0.6, 0.02]]); noise(0.7, 0.45, 2500, 0.05); tone([[3200, 0.3, 'triangle', 0.12, 0.08], [4100, 0.25, 'triangle', 0.1, 0.16]]); },
  poof: () => noise(0.35, 0.2, 800),
  shield: () => tone([[880, 0.15, 'triangle', 0.25], [1320, 0.3, 'triangle', 0.2, 0.1]]),
  ping: () => tone([[1200, 0.12, 'sine', 0.2], [1600, 0.18, 'sine', 0.15, 0.12]]),
  door: () => tone([[160, 0.18, 'square', 0.25], [110, 0.22, 'square', 0.25, 0.12]]),
  open: () => tone([[300, 0.1, 'triangle', 0.2], [450, 0.15, 'triangle', 0.2, 0.08]]),
  unlock: () => tone([[660, 0.1, 'triangle', 0.25], [990, 0.2, 'triangle', 0.25, 0.1]]),
  msg: () => tone([[700, 0.1, 'sine', 0.2], [1050, 0.1, 'sine', 0.2, 0.1], [1400, 0.2, 'sine', 0.2, 0.2]]),
};

// ---------- 공통 요소 ----------
export const overlay = html => { const el = h(html); stage().append(el); G.overlays.push(el); return el; };
export const dropOverlay = el => { el?.remove(); G.overlays = G.overlays.filter(o => o !== el); };
const crewImg = (look, o = {}, w = 120, hh = 86) => crewSVG(look || {}, { noPet: true, ...o }).replace('<svg', `<svg width="${w}" height="${hh}"`);
export { crewImg };

export function centerMsg(text, ms = 1600, cls = '') {
  const el = G.hud && $('.center-msg', G.hud);
  if (!el) return;
  el.innerHTML = `<span class="${cls}">${text}</span>`;
  clearTimeout(el._t); el._t = setTimeout(() => (el.innerHTML = ''), ms);
}
export function notice(text, ms = 4000) {
  const el = G.hud && $('.notice-left', G.hud);
  if (!el) return;
  el.textContent = text; clearTimeout(el._t); el._t = setTimeout(() => (el.textContent = ''), ms);
}

// ---------- 행동 버튼 ----------
// 버튼 하나: <button class="act k-{kind}" data-act=...><svg/><i class="cdv"/><b class="cdn"/><span class="lb"/></button>
const actBtn = (a, ic, label, slot) => `<button class="act" data-act="${a}" data-slot="${slot}"><span class="icw">${icon(ic)}</span><i class="cdv"></i><b class="cdn"></b><em class="sub"></em><span class="lb">${label}</span></button>`;
// 역할별 버튼 배치 (슬롯: 0=오른쪽 아래, 1=그 왼쪽, 2=0 위, 3=1 위, 4=3 왼쪽, 5=1 왼쪽)
export function buildActs() {
  const S = G.S, r = S.role, imp = isImp(), hns = hnsMode(), seek = isSeeker();
  const list = [['use', 'use', '사용', 0]];
  if (hns) {
    if (seek) list.push(['kill', 'kill', '처치', 1]);
    else list.push(['vent', 'vent', '환풍구', 1]);
  } else if (imp) {
    list.push(['kill', r === 'viper' ? 'acid' : 'kill', r === 'viper' ? '산' : '처치', 1], ['report', 'report', '신고', 2], ['sabotage', 'sabotage', '방해 공작', 3], ['vent', 'vent', '환풍구', 4]);
  } else {
    list.push(['report', 'report', '신고', 1]);
    if (r === 'engineer') list.push(['vent', 'vent', '환풍구', 2]);
  }
  // 역할 능력 버튼
  if (!hns) {
    let slot = imp ? 5 : r === 'engineer' ? 3 : 2;
    for (const ab of abilitiesOf(r)) {
      if (['vent', 'acid', 'kill', 'overrule'].includes(ab.id)) continue;
      list.push([`ab:${ab.id}`, abIcon(ab.id), ab.label || ABL[ab.id] || '능력', slot]);
      slot = slot === 2 ? 3 : slot === 3 ? 4 : slot + 1;
    }
  }
  return list.map(([a, ic, l, s]) => actBtn(a, ic, l, s)).join('');
}
const ABL = { vitals: '바이탈', track: '추적', protect: '보호', shift: '변신', vanish: '사라지기', interrogate: '심문', notes: '노트', message: '메시지', overrule: '기각' };
const abIcon = id => ({ vitals: 'vitals', track: 'track', protect: 'protect', shift: 'shift', vanish: 'vanish', interrogate: 'interrogate', notes: 'notes', message: 'message', overrule: 'overrule' })[id] || 'use';
// 역할의 능력 목록 (roles.js 의 ability/abilities + 탐정 노트)
export function abilitiesOf(r) {
  const d = roleDef(r) || {};
  const list = [...(d.abilities || []), ...(d.ability ? [d.ability] : [])].filter(a => a?.id);
  if (r === 'detective' && !list.some(a => a.id === 'notes')) list.unshift({ id: 'notes', label: '노트' });
  const seen = new Set();
  return list.filter(a => !seen.has(a.id) && seen.add(a.id));
}

// 버튼 상태 갱신 헬퍼 (바뀐 것만 DOM 수정)
function setBtn(el, { show = true, ok = false, cd = 0, cdMax = 0, label, ic, sub = '' } = {}) {
  if (!el) return;
  if (el._show !== show) { el._show = show; el.classList.toggle('hide', !show); }
  if (!show) return;
  if (el._ok !== ok) { el._ok = ok; el.classList.toggle('ok', ok); }
  const n = cd > 0 ? Math.ceil(cd / 1000) : 0;
  if (el._n !== n) { el._n = n; $('.cdn', el).textContent = n || ''; el.classList.toggle('oncd', !!n); }
  const p = n && cdMax ? Math.max(0, Math.min(1, cd / cdMax)) : 0;
  const pr = Math.round(p * 100);
  if (el._p !== pr) { el._p = pr; $('.cdv', el).style.height = `${pr}%`; }
  if (label !== undefined && el._lb !== label) { el._lb = label; $('.lb', el).textContent = label; }
  if (ic !== undefined && el._ic !== ic) { el._ic = ic; $('.icw', el).innerHTML = icon(ic); }
  if (el._sub !== sub) { el._sub = sub; $('.sub', el).textContent = sub; }
}

// ---------- 매 프레임 HUD 갱신 (게임 중) ----------
const USE_D = 210;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function nearest(list, from, max, los) {
  let best = null, bd = max;
  for (const it of list) {
    const d = dist(it, from) - (it.r || 0);
    if (d < bd && (!los || lineClear(G.map, from.x, from.y, it.x, it.y, scene.doorsClosed))) { bd = d; best = it; }
  }
  return best;
}
// 사용 가능한 대상 목록
function useCands(meP, live) {
  const S = G.S, m = G.map, imp = isImp(), hns = hnsMode(), c = [];
  const comms = commsOn();
  // 내 임무 (유령도 클래식에서는 가능)
  if (!imp && !comms && (live || !hns) && !S.vanished) {
    S.tasks.forEach((t, i) => {
      if (t.step >= t.st.length) return;
      const st = m.stations[t.st[t.step]];
      if (st) c.push({ kind: 'task', i, id: t.st[t.step], x: st.x, y: st.y });
    });
  }
  if (!live) return c;
  // 사보타주 수리
  if (S.sab && !S.vanished) {
    const d = sabDef(S.sab.k);
    for (const [id, part] of Object.entries(d?.fix || {})) {
      if (S.sab.parts.includes(part) && !d.together) continue;
      const st = m.stations[id];
      if (st) c.push({ kind: 'fix', id, part, x: st.x, y: st.y });
    }
  }
  if (!hns && m.button) c.push({ kind: 'button', id: 'button', x: m.button.x, y: m.button.y, r: 90 });
  // 장비
  const eq = [['cams', m.cams?.station], ['admin', m.admin], ['vitals', m.vitals], ['doorlog', m.doorlog]];
  for (const [kind, id] of eq) { const st = id && m.stations[id]; if (st) c.push({ kind, id, x: st.x, y: st.y }); }
  // 수동 문
  if (m.doorMode === 'manual') for (const id of scene.doorsClosed || []) {
    const d = m.doorById?.[id];
    if (d) c.push({ kind: 'door', id, x: d.x + d.w / 2, y: d.y + d.h / 2, r: Math.max(d.w, d.h) / 2 + 30 });
  }
  // 사다리·짚라인 등
  for (const t of m.transports || []) {
    if (t.a) c.push({ kind: 'transport', id: t.id, tk: t.kind, end: 'a', x: t.a.x, y: t.a.y });
    if (t.b && !t.oneWay) c.push({ kind: 'transport', id: t.id, tk: t.kind, end: 'b', x: t.b.x, y: t.b.y });
  }
  return c;
}
const USE_IC = { task: 'use', fix: 'use', button: 'button', cams: 'cams', admin: 'admin', vitals: 'vitals', doorlog: 'doorlog', door: 'door', custom: 'customize' };
const USE_LB = { cams: '보안', admin: '관리', vitals: '바이탈', doorlog: '문 기록', door: '문 열기', transport: '사용' };
const TR_IC = { ladder: 'ladder', zipline: 'zipline', platform: 'platform', stairs: 'stairs', decon: 'decon' };

export function updateHud() {
  const S = G.S, hud = G.hud;
  if (!S?.game || !hud) return;
  const g = S.game, s = g.settings, meP = scene.players.get(S.you);
  if (!meP) return;
  const t = now(), live = alive(), imp = isImp(), hns = hnsMode(), seek = isSeeker();
  const inPlay = S.phase === 'play' && !G.mg && !scene.frozen && !S.busy;
  const comms = commsOn();
  // 1) 사용
  const cands = inPlay ? useCands(meP, live) : [];
  let use = nearest(cands.filter(c => c.kind !== 'button' && c.kind !== 'door'), meP, USE_D, live)
    || nearest(cands.filter(c => c.kind === 'door'), meP, 120, false)
    || nearest(cands.filter(c => c.kind === 'button'), meP, 200, live);
  if (use?.kind === 'transport' && S.transportUntil > t) use = null;
  S.use = use;
  scene.hl = use?.id ?? null;
  setBtn($('[data-act=use]', hud), { ok: !!use, ic: use ? (use.kind === 'transport' ? TR_IC[use.tk] || 'ladder' : USE_IC[use.kind] || 'use') : 'use', label: use ? USE_LB[use.kind] || '사용' : '사용' });
  // 2) 신고
  const rep = $('[data-act=report]', hud);
  if (rep) {
    const body = live && inPlay && !hns && !S.vanished ? nearest(scene.bodies.filter(b => !b.gone), meP, 330, true) : null;
    S.report = body; scene.reportId = body?.id ?? null;
    setBtn(rep, { ok: !!body });
  }
  // 3) 처치 (바이퍼는 산)
  const kb = $('[data-act=kill]', hud);
  scene.killId = null; S.kill = null;
  if (kb) {
    if (scene.inVent && S.killAt > t) S.killAt += G.dt * 1000; // 환풍구 안에서는 쿨다운 멈춤
    const cd = Math.max(0, S.killAt - t);
    const range = hns ? KILL_D[0] * 0.8 : KILL_D[s.killDistance ?? 1] ?? 260;
    const targets = live && inPlay && !scene.inVent && !S.vanished && !S.hnsLocked
      ? [...scene.players.values()].filter(p => p.id !== S.you && !S.dead.has(p.id) && !p.vent && !(hns ? false : S.mates.has(p.id)) && !(hns && S.mates.has(p.id))) : [];
    const tg = nearest(targets, meP, range, true);
    if (tg && !cd) { S.kill = tg; scene.killId = tg.id; }
    setBtn(kb, { show: live, ok: !!S.kill, cd: live ? cd : 0, cdMax: (hns ? 5 : s.killCooldown) * 1000 });
  }
  // 4) 사보타주 버튼
  const sb = $('[data-act=sabotage]', hud);
  if (sb) setBtn(sb, { ok: S.phase === 'play' && !G.mg, cd: 0 });
  // 5) 환풍구
  const vb = $('[data-act=vent]', hud);
  S.vent = null;
  if (vb) {
    const eng = S.role === 'engineer';
    const cd = eng ? Math.max(0, (S.cd.vent || 0) - t) : 0;
    const usesLeft = hns ? S.hns?.vents : undefined;
    const blocked = (eng && comms) || (hns && usesLeft !== undefined && usesLeft <= 0 && !scene.inVent);
    let v = null;
    if (live && inPlay && !blocked) {
      if (scene.inVent) v = { id: scene.inVent };
      else if (!cd) v = nearest(Object.values(G.map.vents || {}), meP, 170, false);
    }
    S.vent = v;
    if (v && !scene.inVent && !use) scene.hl = v.id;
    let sub = '';
    if (eng && scene.inVent && S.ventOutAt) sub = `${Math.max(0, Math.ceil((S.ventOutAt - t) / 1000))}`;
    if (hns && usesLeft !== undefined) sub = `${usesLeft}`;
    setBtn(vb, { show: live, ok: !!v, cd, cdMax: (roleOpt('engineer', /cool/i, 30)) * 1000, label: scene.inVent ? '나가기' : '환풍구', sub });
  }
  // 6) 역할 능력
  for (const b of $$('[data-act^="ab:"]', hud)) updateAbility(b, b.dataset.act.slice(3), meP, live, inPlay, comms, t);
  // 채팅 버튼 (유령이거나 회의 중)
  const showChat = !!S.meeting || (!live && !g.practice);
  const cb = $('.chatb', hud);
  if (cb) {
    cb.classList.toggle('hidden', !showChat);
    const bd = $('.badge', cb); bd.textContent = S.unread; bd.classList.toggle('hidden', !S.unread);
  }
  // 사보타주/숨바꼭질 타이머
  sabTick(t);
  if (hns) hnsTick(t, meP);
  if (S.sab || S.track || S.hns || S.role === 'judge' || S.role === 'scientist') renderTasksThrottled();
  // 과학자 배터리
  batteryTick(t);
}

// 역할 능력 버튼 하나
function updateAbility(b, id, meP, live, inPlay, comms, t) {
  const S = G.S, s = S.game.settings, cdLeft = Math.max(0, (S.cd[id] || 0) - t);
  const cdMax = S.cdMax[id] || cdLeft || 1;
  const near = (alivePlayersOnly, max) => nearest([...scene.players.values()].filter(p => p.id !== S.you && !S.dead.has(p.id) && !p.vent && (!alivePlayersOnly || !p.dead)), meP, max, live);
  let ok = false, label, ic, sub = '', show = true, target = null;
  switch (id) {
    case 'vitals': {
      const bat = S.battery ?? 1;
      ok = !comms && (bat > 0.05) && !cdLeft && S.phase === 'play' && !G.mg;
      sub = S.batteryMax ? `${Math.round((bat / S.batteryMax) * 100)}%` : '';
      if (!live && S.role === 'scientist') show = true;
      break;
    }
    case 'track':
      if (S.track) { ok = !comms; label = '추적 해제'; ic = 'untrack'; sub = `${Math.max(0, Math.ceil((S.track.until - t) / 1000))}`; }
      else { target = live && inPlay && !comms && !cdLeft ? near(true, KILL_D[1]) : null; ok = !!target; label = '추적'; ic = 'track'; }
      show = live;
      break;
    case 'protect':
      target = !live && inPlay && !comms && !cdLeft ? near(true, 320) : null; ok = !!target; show = !live;
      break;
    case 'message':
      target = !live && inPlay && !cdLeft ? near(true, 320) : null; ok = !!target; show = !live;
      break;
    case 'shift':
      ok = live && inPlay && (S.shifted ? true : !cdLeft); label = S.shifted ? '변신 해제' : '변신'; ic = S.shifted ? 'unshift' : 'shift'; show = live;
      if (S.shifted && S.shiftUntil) sub = `${Math.max(0, Math.ceil((S.shiftUntil - t) / 1000))}`;
      break;
    case 'vanish':
      ok = live && inPlay && !scene.inVent && (S.vanished ? true : !cdLeft && !comms); label = S.vanished ? '나타나기' : '사라지기'; ic = S.vanished ? 'appear' : 'vanish'; show = live;
      if (S.vanished && S.vanishUntil) sub = `${Math.max(0, Math.ceil((S.vanishUntil - t) / 1000))}`;
      break;
    case 'interrogate': {
      const cs = S.cases?.[S.activeCase];
      const lim = roleOpt('detective', /suspect|limit/i, 3);
      const can = live && inPlay && !comms && !cdLeft && cs && (cs.suspects.length < lim);
      target = can ? near(true, KILL_D[1]) : null; ok = !!target; show = live;
      sub = cs ? `${cs.suspects.length}/${lim}` : '';
      break;
    }
    case 'notes': ok = !G.mg || S.meeting; show = true; break;
    default:
      target = live && inPlay && !cdLeft ? near(true, KILL_D[1]) : null;
      ok = roleDef(S.role)?.ability?.target ? !!target : live && inPlay && !cdLeft;
  }
  if (target && !scene.killId) { scene.abilityId = target.id; }
  b._target = target?.id ?? null;
  setBtn(b, { show, ok, cd: cdLeft, cdMax, label, ic, sub });
}

// ---------- 임무 목록 / 진행 바 ----------
let lastTasksDraw = 0;
function renderTasksThrottled() { const t = now(); if (t - lastTasksDraw > 400) renderTasks(); }
export function renderTasks() {
  const S = G.S, hud = G.hud;
  if (!S?.game || !hud) return;
  lastTasksDraw = now();
  const m = G.map, s = S.game.settings, imp = isImp(), hns = hnsMode(), comms = commsOn();
  // 진행 바
  const bar = $('.taskbar', hud);
  if (bar) {
    const mode = s.taskBar ?? 0;
    bar.classList.toggle('hidden', mode === 2 || hns);
    bar.classList.toggle('comms', comms);
    const p = S.bar?.total ? (S.bar.done / S.bar.total) * 100 : 0;
    $('i', bar).style.width = `${comms ? 0 : p}%`;
    $('b', bar).textContent = comms ? '통신 방해됨' : mode === 1 ? '총 임무 완료 (회의 때 갱신)' : '총 임무 완료';
  }
  const lines = [];
  const sab = S.sab, sd = sab && sabDef(sab.k);
  if (sab && sd) {
    const parts = new Set(Object.values(sd.fix || {})).size || 1;
    const sec = Math.max(0, Math.ceil((S.sabEnd - now()) / 1000));
    const txt = sd.type === 'critical' ? `${esc(sd.name)}까지: ${sec}초 (${sab.parts.length}/${parts})`
      : sd.type === 'lights' ? '조명 수리하기' : sd.type === 'comms' ? '통신실에 방해 공작 발생' : sd.type === 'mixup' ? `${esc(sd.name)} — ${sec ? `${sec}초 뒤 회복` : '수리하기'}` : esc(sd.name);
    lines.push(`<div class="sab">${txt}</div>`);
  }
  const dead = !alive();
  if (dead) lines.push(`<div class="ghostl">${hns ? '죽었습니다. 혼란을 즐기세요.' : imp ? '죽었습니다. 방해 공작은 계속 가능합니다.' : '죽었습니다. 승리할 수 있게 임무를 끝내세요.'}</div>`);
  if (hns) {
    lines.push(isSeeker() ? '<div class="fake">제한 시간 내에 크루원을 모두 처치하세요!</div>' : '<div class="role">시간이 다 될 때까지 살아남으세요. 임무를 완료하면 타이머가 줄어듭니다.</div>');
  } else if (imp) lines.push('<div class="fake">방해 공작을 펼치고 모두를 처치하세요.</div><div class="fake">가짜 임무:</div>');
  // 역할 안내 줄
  const rl = roleLine();
  if (rl) lines.push(`<div class="role">${rl}</div>`);
  if (comms && !imp) lines.push('<div class="sab">통신 방해 — 임무 목록을 볼 수 없습니다</div>');
  else if (!(hns && isSeeker())) {
    let all = S.tasks.length > 0;
    for (const t of S.tasks) {
      const T = taskById(m, t.id) || { name: t.name || t.id };
      const n = t.st.length, done = t.step >= n, cur = Math.min(t.step, n - 1);
      if (!done) all = false;
      const st = m.stations[t.st[cur]], room = st?.room || '복도';
      const lb = stepLabel(T, cur) || T.name;
      lines.push(`<div class="${done ? 'done' : t.step ? 'part' : ''}">${esc(room)}: ${esc(lb)}${n > 1 ? ` (${t.step}/${n})` : ''}${t.wait ? ` <small>${esc(t.wait)}</small>` : ''}</div>`);
    }
    if (all && !imp && S.phase === 'play') lines.push('<div class="done">모든 임무 완료!</div>');
  }
  const box = $('.tasklist .tl', hud);
  if (box) { const html = lines.join(''); if (box._h !== html) { box._h = html; box.innerHTML = html; } }
  // 내 임무 위치 강조
  scene.taskStations = new Set(imp || comms ? [] : S.tasks.filter(t => t.step < t.st.length).map(t => t.st[t.step]));
}
function roleLine() {
  const S = G.S, r = S.role, t = now();
  if (r === 'judge') {
    if (S.overruled) return '기각: 이미 사용함';
    const need = roleOpt('judge', /task|pct|percent|unlock/i, 50);
    const [d, n] = myTasksDone();
    const req = Math.ceil((n * need) / 100);
    return d >= req ? '<b style="color:#ffd84a">기각 사용 가능 — 회의 중 투표할 때 판결을 내리세요</b>' : `기각 잠김: 임무 ${req - d}개 더 완료하면 해제`;
  }
  if (r === 'scientist' && S.batteryMax) return `바이탈 배터리 ${Math.round(((S.battery ?? 0) / S.batteryMax) * 100)}%${S.batCdEnd > t ? ` · 충전까지 ${Math.ceil((S.batCdEnd - t) / 1000)}초` : ''}`;
  if (S.track) return `추적 중: ${esc(nameOf(S.track.id))} (${Math.max(0, Math.ceil((S.track.until - t) / 1000))}초)`;
  if (r === 'noisemaker' && alive()) return '처치당하면 모두에게 경보가 울립니다.';
  if (r === 'detective') { const cs = S.cases?.[S.activeCase]; return cs ? `사건: ${esc(cs.name)} — 용의자 ${cs.suspects.length}명 조사함` : '시체가 신고되면 사건 파일이 생깁니다.'; }
  return '';
}

// ---------- 사보타주 경보 ----------
let alarmT = 0;
export function setSabUI() {
  const S = G.S, hud = G.hud;
  if (!hud) return;
  const sd = S.sab && sabDef(S.sab.k), crit = sd?.type === 'critical';
  hud.classList.toggle('crit', !!crit);
  const box = $('.critbox', hud);
  if (box) box.classList.toggle('hidden', !crit);
  if (crit) { $('.critbox .nm', hud).textContent = `${sd.name}까지`; }
}
function sabTick(t) {
  const S = G.S, sd = S.sab && sabDef(S.sab.k);
  if (sd?.type === 'critical') {
    const sec = Math.max(0, Math.ceil((S.sabEnd - t) / 1000));
    const el = $('.critbox .sec', G.hud);
    if (el && el.textContent !== String(sec)) el.textContent = sec;
    if (t - alarmT > 1100 && S.phase === 'play') { alarmT = t; SND.alarm(); }
  }
  if (sd?.type === 'mixup' && S.sabEnd && t > S.sabEnd + 500 && S.sab) { /* 서버가 해제 메시지를 보냄 */ }
}

// ---------- 과학자 배터리 ----------
export function batteryTick(t) {
  const S = G.S;
  if (S.role !== 'scientist' || !S.batteryMax) return;
  const dt = (t - (S.batT || t)) / 1000; S.batT = t;
  if (S.vitalsOpen === 'ability') {
    S.battery = Math.max(0, S.battery - dt);
    if (S.battery <= 0) G.closePanel?.();
  }
  // 임무를 모두 끝냈으면 쿨다운 뒤 자동 충전
  const [d, n] = myTasksDone();
  if (S.battery <= 0.05 && d >= n && !S.vitalsOpen) {
    if (!S.batCdEnd) S.batCdEnd = t + roleOpt('scientist', /cool/i, 15) * 1000;
    else if (t > S.batCdEnd) { S.battery = S.batteryMax; S.batCdEnd = 0; }
  }
}

// ---------- 숨바꼭질 HUD ----------
let beatT = 0;
function hnsTick(t, meP) {
  const S = G.S, H = S.hns, hud = G.hud;
  if (!H) return;
  const left = Math.max(0, (H.end || t) - t);
  const top = $('.hnsbar', hud);
  if (top) {
    const fin = H.phase === 'final';
    top.classList.toggle('final', fin);
    $('.lab', top).textContent = H.phase === 'hide' ? (isSeeker() ? '술래 출발까지:' : '숨으세요!') : fin ? '마지막 숨기:' : '크루원 탈출까지:';
    $('.tm', top).textContent = fmtTime(left);
    const tot = H.total || left || 1;
    $('.fill', top).style.width = `${Math.max(0, Math.min(100, (left / tot) * 100))}%`;
  }
  // 위험 측정기: 가장 가까운 술래와의 거리 (원작: d² 55→15 단위², 1단위≈172)
  const dm = $('.danger', hud);
  if (dm && !isSeeker() && alive()) {
    let best = 1e9;
    for (const id of S.mates) { const p = scene.players.get(id); if (p && !S.dead.has(id)) best = Math.min(best, dist(p, meP)); }
    const u = best / 172, d2 = u * u;
    const l1 = Math.max(0, Math.min(1, (55 - d2) / 40)), l2 = Math.max(0, Math.min(1, (15 - d2) / 15));
    const lv = l1 * 0.6 + l2 * 0.4;
    dm.style.setProperty('--lv', lv.toFixed(3));
    dm.classList.toggle('l1', l1 > 0); dm.classList.toggle('l2', l2 > 0);
    dm.classList.remove('hidden');
    const gap = l2 > 0 ? 450 : l1 > 0 ? 900 - l1 * 350 : 0;
    if (gap && t - beatT > gap && S.phase === 'play') { beatT = t; SND.beat(l2 > 0 ? 1 : l1); }
  } else dm?.classList.add('hidden');
  // 마지막 숨기: 술래에게 핑
  if (isSeeker() && H.phase === 'final' && S.game.settings.hnsPings !== false && S.game.settings.hnsFinalPings !== false) {
    const iv = (S.game.settings.hnsPingInterval ?? S.game.settings.pingInterval ?? 6) * 1000;
    if (!H.lastPing || t - H.lastPing > iv) {
      H.lastPing = t;
      if (!H.serverPings) {
        const pts = [...scene.players.values()].filter(p => p.id !== S.you && !S.dead.has(p.id) && !S.mates.has(p.id)).map(p => ({ x: p.x, y: p.y }));
        addPings(pts);
      }
    }
  }
}
export function addPings(pts) {
  const until = now() + 2000;
  scene.noises = [...(scene.noises || []).filter(n => n.until > now()), ...pts.map(p => ({ x: p.x, y: p.y, until, ping: true }))];
  for (const p of pts) scene.effect?.('noise', { x: p.x, y: p.y, ping: true });
  if (pts.length) SND.ping();
}
export const fmtTime = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- 역할 소개 화면 ----------
export function roleIntro(players, done) {
  const S = G.S, s = S.game.settings, imp = isImp(), hns = hnsMode(), seek = isSeeker();
  const teamCol = hns ? (seek ? '#FF1919' : '#8CFFFF') : imp ? '#FF1919' : '#8CFFFF';
  const meP = players.find(p => p.id === S.you) || { look: lookOf(S.you) };
  const nImp = Math.max(S.mates.size, imp ? S.mates.size : 0) || s.impostors || 1;
  const team = hns ? players : imp ? players.filter(p => S.mates.has(p.id) || p.id === S.you) : players;
  const others = team.filter(p => p.id !== S.you).slice(0, 14);
  const lineup = [...others.slice(0, Math.ceil(others.length / 2)).reverse(), meP, ...others.slice(Math.ceil(others.length / 2))];
  const el = overlay(`<div class="intro2"><div class="shh"><div class="shhcrew">${crewImg({ color: 0 }, {}, 380, 274)}<i class="finger"></i></div><h1>쉿!</h1></div></div>`);
  SND.shh();
  const fast = S.game.practice;
  const T1 = fast ? 900 : 1500, T2 = fast ? 1900 : 3300, T3 = fast ? 1500 : 2600;
  const showRole = !hns && !['crewmate', 'impostor'].includes(S.role);
  const teamHtml = () => {
    const sub = hns ? (seek ? '제한 시간 내에 크루원을 모두 처치하세요!' : `술래: <b style="color:#ff3b3b">${esc(nameOf([...S.mates][0]))}</b> — 끝까지 살아남으세요!`)
      : imp ? (S.mates.size > 1 ? '동료 임포스터와 함께 크루원을 처치하세요' : '크루원을 처치하세요') : `우리 중에 <b style="color:#ff3b3b">임포스터가 ${nImp}명</b> 있습니다`;
    const title = hns ? (seek ? '술래' : '크루원') : imp ? '임포스터' : '크루원';
    return `<div class="teamscr" style="--tc:${teamCol}"><h1>${title}</h1><p>${sub}</p><div class="glow"></div>
      <div class="lineup">${lineup.map((p, i) => {
        const k = i - lineup.indexOf(meP), a = Math.abs(k);
        return `<div class="lc" style="--k:${k};--a:${a};z-index:${20 - a}">${crewImg(p.look, {}, 260, 187)}<span style="${S.mates.has(p.id) && (imp || hns) ? 'color:#ff3b3b' : ''}">${esc(p.name)}</span></div>`;
      }).join('')}</div>${hns ? hnsCards(seek) : ''}</div>`;
  };
  const roleHtml = () => {
    const d = roleDef(S.role) || {};
    return `<div class="rolescr" style="--tc:${roleColor(S.role)}"><div class="you">당신의 역할은</div><h1>${esc(roleName(S.role))}</h1><p>${esc(d.desc || '')}</p>
      <div class="solo">${crewImg(meP.look, {}, 360, 259)}</div></div>`;
  };
  const timers = [setTimeout(() => { el.firstElementChild.innerHTML = teamHtml(); }, T1)];
  if (showRole) timers.push(setTimeout(() => { el.firstElementChild.innerHTML = roleHtml(); }, T1 + T2));
  timers.push(setTimeout(() => { el.classList.add('out'); }, T1 + T2 + (showRole ? T3 : 0) - 350));
  timers.push(setTimeout(() => { dropOverlay(el); done?.(); }, T1 + T2 + (showRole ? T3 : 0)));
  el.onclick = () => { if (fast) { timers.forEach(clearTimeout); dropOverlay(el); done?.(); } };
  return el;
}
function hnsCards(seek) {
  const cards = seek
    ? [['빠르게 처치하세요', '제한 시간 내에 크루원을 모두 처치하세요!'], ['찾기', '빠르게 움직이세요. 시야가 제한되며 환풍구에 접근할 수 없습니다.'], ['마지막 숨기', '마지막에 가까워지면 속도 부스트와 추적 힌트를 받습니다!']]
    : [['임무를 수행하세요', '시간이 다 될 때까지 살아남으세요. 임무를 완료하면 타이머가 줄어듭니다.'], ['꼭꼭 숨으세요', '환풍구와 위험 측정기를 사용해 숨으세요!'], ['마지막 숨기', '타이머가 끝나면 임포스터가 당신을 추적할 수 있습니다!']];
  return `<div class="hnscards">${cards.map(([a, b], i) => `<div class="hc" style="--i:${i}"><b>${a}</b><span>${b}</span></div>`).join('')}</div>`;
}

// ---------- 처치당함 연출 (피해자 화면) ----------
export function killSplash(killerLook, victimLook) {
  const el = overlay(`<div class="killsplash"><div class="ks-bg"></div><div class="ks-row"><div class="ks-k">${crewImg(killerLook, {}, 380, 274)}</div>
    <div class="ks-knife">${icon('kill')}</div><div class="ks-v">${crewImg(victimLook, { dead: true }, 380, 274)}</div></div></div>`);
  setTimeout(() => el.classList.add('out'), 1700);
  setTimeout(() => dropOverlay(el), 2100);
}

// ---------- 화면 가장자리 화살표 (추적자·노이즈 메이커·사보타주 보조) ----------
export function drawArrows() {
  const S = G.S, box = G.hud && $('.arrows', G.hud);
  if (!box || !S?.game) return;
  const t = now(), items = [];
  if (S.track && S.track.until > t && S.trackPos) items.push({ ...S.trackPos, c: S.track.color || '#3cff6a' });
  for (const n of S.alerts || []) if (n.until > t) items.push({ x: n.x, y: n.y, c: '#ff2a2a', noise: true });
  S.alerts = (S.alerts || []).filter(n => n.until > t);
  const html = items.map(it => {
    const [sx, sy] = scene.toScreen?.(it.x, it.y) || [0, 0];
    const cv = document.getElementById('world'), r = cv?.getBoundingClientRect();
    if (!r?.width) return '';
    const st = stage().getBoundingClientRect(), k = st.width / 1600;
    // 월드 → 화면(px) → 스테이지 좌표
    const px = (sx * r.width) / cv.width + r.left, py = (sy * r.height) / cv.height + r.top;
    const lx = (px - st.left) / k, ly = (py - st.top) / k;
    const cx = 800, cy = 360, inside = lx > 40 && lx < 1560 && ly > 40 && ly < 680;
    if (inside && !it.noise) return '';
    const a = Math.atan2(ly - cy, lx - cx);
    const ex = inside ? lx : cx + Math.cos(a) * 560, ey = inside ? ly - 90 : cy + Math.sin(a) * 300;
    return `<i class="arw ${it.noise ? 'noise' : ''}" style="left:${ex}px;top:${ey}px;--a:${inside ? 90 : (a * 180) / Math.PI}deg;--c:${it.c}"></i>`;
  }).join('');
  if (box._h !== html) { box._h = html; box.innerHTML = html; }
}

// ---------- 인플루언서 이미지 표시 (받는 쪽) ----------
export function showInfluence(imgs, fromLook) {
  const el = overlay(`<div class="influx"><div class="ifx-ghost">${fromLook ? crewImg(fromLook, { ghost: true }, 160, 115) : ''}</div><div class="ifx-row">${imgs.map((k, i) => `<div class="ifx" style="--i:${i}">${G.influenceSVG?.(k) || ''}</div>`).join('')}</div></div>`);
  SND.msg();
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => dropOverlay(el), 4800);
}

// ---------- 색 ----------
export const colorOf = id => COLORS[lookOf(id)?.color ?? 0]?.[1] || '#888';
