// 공용 도구: DOM 헬퍼, 저장소, 네트워크, 효과음
import { randomName, ageOf, CHILD_AGE } from './shared/data.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const h = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const stage = () => $('#stage');
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function modal(html, { cls = '', onClose, close = true, parent } = {}) {
  const back = h(`<div class="modal-back"><div class="modal ${cls}">${close ? '<button class="xbtn" aria-label="닫기">✕</button>' : ''}${html}</div></div>`);
  (parent || stage()).append(back);
  const m = { el: back.firstElementChild, back, close() { back.remove(); onClose?.(); } };
  if (close) $('.xbtn', back).onclick = () => { sfx('click'); m.close(); };
  return m;
}
export function toast(msg, ms = 2600) {
  const t = h(`<div class="toast">${esc(msg)}</div>`);
  stage().append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}
export function confirmBox(msg, yes = '확인', no = '취소') {
  return new Promise(res => {
    const m = modal(`<p class="cb-msg">${msg}</p><div class="row-c"><button class="obtn yes">${yes}</button>${no ? `<button class="obtn no">${no}</button>` : ''}</div>`, { cls: 'small', onClose: () => res(false) });
    $('.yes', m.el).onclick = () => { m.back.remove(); res(true); };
    if (no) $('.no', m.el).onclick = () => { m.back.remove(); res(false); };
  });
}

// ---------- 저장소 ----------
const load = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k)) }; } catch { return { ...d }; } };
const DEF_SETTINGS = { music: 0.5, sfx: 0.8, joySize: 1, control: 'joystick', censor: true, invites: true, streamer: false, colorblind: false,
  resolution: 1, fps: 60, lighting: true, bgAnim: true, ads: false, analytics: true, lang: 'ko' };
export const settings = load('au_settings', DEF_SETTINGS);
export const saveSettings = () => localStorage.setItem('au_settings', JSON.stringify(settings));

// 기기 정보 (생일/토큰/게스트 이름)
export const device = load('au_device', { birth: '', token: '', guestName: '', chose: false, region: 'as' });
if (!device.guestName) device.guestName = randomName();
export const saveDevice = () => localStorage.setItem('au_device', JSON.stringify(device));
saveDevice();

const DEF_PROFILE = () => ({ look: { color: 0, hat: 'none', visor: 'none', skin: 'none', pet: 'none', plate: 'none' }, owned: [], beans: 100, xp: 0, level: 1,
  stats: { started: 0, finished: 0, crewWins: 0, impWins: 0, tasks: 0, allTasks: 0, kills: 0, ejected: 0, meetings: 0, reports: 0, sabFixed: 0, impGames: 0, crewGames: 0 },
  daily: '', readNews: [], shopSeen: false });
export let profile = null;
let profileKey = '';
export function useProfile(key) {
  profileKey = 'au_profile_' + key;
  profile = load(profileKey, DEF_PROFILE());
  profile.stats = { ...DEF_PROFILE().stats, ...profile.stats };
  profile.look = { ...DEF_PROFILE().look, ...profile.look };
}
useProfile('guest');
export const saveProfile = () => localStorage.setItem(profileKey, JSON.stringify(profile));
export function addXp(n) {
  profile.xp += n;
  while (profile.xp >= 100 + profile.level * 20) { profile.xp -= 100 + profile.level * 20; profile.level++; }
  saveProfile();
}
export const xpNeed = () => 100 + profile.level * 20;
export const isChildBirth = b => { const a = ageOf(b); return a >= 0 && a < CHILD_AGE; };

// 현재 접속 상태 (서버 welcome 메시지로 채워짐)
export const me = { id: null, status: 'off', name: '', account: null, friends: { friends: [], requests: [] } };

// ---------- 네트워크 ----------
const handlers = new Map();
let ws = null, retry = 0, pingT = null;
export const net = {
  ping: 0, open: false,
  on(t, fn) { if (!handlers.has(t)) handlers.set(t, new Set()); handlers.get(t).add(fn); return () => handlers.get(t).delete(fn); },
  emit(t, m) { handlers.get(t)?.forEach(f => f(m)); },
  send(m) { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); },
  connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => {
      net.open = true; retry = 0;
      net.send({ t: 'hello', token: device.token, birth: device.birth, guestName: device.guestName, look: profile.look, lvl: profile.level });
      clearInterval(pingT);
      pingT = setInterval(() => net.send({ t: 'ping', ts: performance.now() }), 2000);
      net.emit('open');
    };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m.t === 'pong') net.ping = Math.round(performance.now() - m.ts); net.emit(m.t, m); net.emit('*', m); };
    ws.onclose = () => {
      const was = net.open; net.open = false; clearInterval(pingT);
      if (was) net.emit('close');
      setTimeout(() => net.connect(), Math.min(8000, 800 * 2 ** retry++));
    };
  },
};

// ---------- 효과음 / 음악 (WebAudio로 즉석 합성) ----------
let ac = null, musicNode = null;
const ctx = () => { if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (A) ac = new A(); } if (ac?.state === 'suspended') ac.resume(); return ac; };
const SFX = {
  click: [[660, 0.05, 'square', 0.15]], hover: [[880, 0.03, 'sine', 0.05]],
  task: [[523, 0.08, 'triangle'], [659, 0.08, 'triangle', 0.4, 0.08], [784, 0.15, 'triangle', 0.4, 0.16]],
  kill: [[120, 0.25, 'sawtooth', 0.5], [60, 0.4, 'square', 0.4, 0.05]],
  alarm: [[880, 0.25, 'square', 0.3], [660, 0.25, 'square', 0.3, 0.25], [880, 0.25, 'square', 0.3, 0.5], [660, 0.25, 'square', 0.3, 0.75]],
  vote: [[440, 0.08, 'square', 0.2]], vent: [[200, 0.12, 'sawtooth', 0.3], [140, 0.12, 'sawtooth', 0.3, 0.1]],
  win: [[523, 0.2, 'triangle'], [659, 0.2, 'triangle', 0.4, 0.2], [784, 0.2, 'triangle', 0.4, 0.4], [1046, 0.5, 'triangle', 0.4, 0.6]],
  lose: [[392, 0.3, 'sawtooth', 0.3], [311, 0.3, 'sawtooth', 0.3, 0.3], [233, 0.6, 'sawtooth', 0.3, 0.6]],
  sab: [[300, 0.4, 'sawtooth', 0.25], [300, 0.4, 'sawtooth', 0.25, 0.6]], step: [[90, 0.04, 'triangle', 0.08]],
};
export function sfx(name) {
  const a = ctx(); if (!a || !settings.sfx) return;
  for (const [f, d, type = 'sine', vol = 0.3, at = 0] of SFX[name] || []) {
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(vol * settings.sfx * 0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + 0.02);
  }
}
// 메뉴 배경음: 잔잔한 우주 앰비언트
export function music(on) {
  const a = ctx(); if (!a) return;
  if (musicNode) { musicNode.g.gain.setTargetAtTime(0, a.currentTime, 0.4); const n = musicNode; setTimeout(() => n.oscs.forEach(o => o.stop()), 1500); musicNode = null; }
  if (!on || !settings.music) return;
  const g = a.createGain(); g.gain.value = 0; g.connect(a.destination);
  const oscs = [110, 164.8, 220, 277.2].map((f, i) => {
    const o = a.createOscillator(), lfo = a.createOscillator(), lg = a.createGain(), og = a.createGain();
    o.type = 'sine'; o.frequency.value = f; lfo.frequency.value = 0.05 + i * 0.03; lg.gain.value = 0.5; og.gain.value = 0.25;
    lfo.connect(lg).connect(og.gain); o.connect(og).connect(g); o.start(); lfo.start();
    return o;
  });
  g.gain.setTargetAtTime(0.05 * settings.music, a.currentTime, 1.5);
  musicNode = { g, oscs };
}
export const updateMusicVolume = () => { if (musicNode && ac) musicNode.g.gain.setTargetAtTime(0.05 * settings.music, ac.currentTime, 0.2); };

// 채팅 검열 (설정 켜짐일 때 표시만 가림)
const BAD = ['시발', '씨발', '병신', '개새끼', '좆', '존나', 'fuck', 'shit', 'bitch'];
export const censor = s => (settings.censor ? BAD.reduce((t, w) => t.replace(new RegExp(w, 'gi'), '*'.repeat(w.length)), s) : s);
