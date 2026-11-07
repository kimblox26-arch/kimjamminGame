// 저장 데이터 (브라우저 localStorage)
import { ITEMS, DEFAULT_EQUIP } from './items.js';

const KEY = 'koblox.save.v1';
const freeIds = () => ITEMS.filter(i => i.price === 0).map(i => i.id);

export const DEFAULT_SETTINGS = {
  theme: 'dark', volume: 70, music: true, sfx: true, sensitivity: 1, invertY: false, quality: 'auto', shadows: true,
  nameTags: true, showFps: false, vibrate: true, notifications: true, chat: true, profilePublic: true, language: 'ko',
  cameraShake: true, reduceMotion: false, fov: 70, gfx: 'auto', shiftLock: false, accent: '',
};

function fresh() {
  return {
    user: null, // { username, displayName, about, joined }
    kobux: 100, plus: false, owned: freeIds(), equip: { ...DEFAULT_EQUIP }, outfits: [],
    settings: { ...DEFAULT_SETTINGS }, favorites: [], history: [], visits: {}, likes: {},
    scales: { height: 1, width: 1, head: 1 }, badges: {}, stats: { jumps: 0, deaths: 0, built: 0, coins: 0 }, places: [],
    notifs: [{ id: 'n_test', game: 'test', title: 'Test 에 오신 걸 환영해요!', body: '파란 하늘, 회색 바닥 — 첫 번째 체험을 지금 플레이해 보세요.', time: Date.now(), action: '참가' }],
  };
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (!d) return fresh();
    const f = fresh();
    const s = { ...f, ...d, settings: { ...f.settings, ...d.settings }, equip: { ...f.equip, ...d.equip }, scales: { ...f.scales, ...d.scales }, stats: { ...f.stats, ...d.stats } };
    s.owned = [...new Set([...f.owned, ...(d.owned || [])])];
    return s;
  } catch { return fresh(); }
}

export const S = load();
const subs = new Set();
export function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { } subs.forEach(f => f()); }
export function onChange(f) { subs.add(f); }
export function resetAll() { try { localStorage.removeItem(KEY); } catch { } Object.assign(S, fresh()); save(); }
export const owns = id => S.owned.includes(id);
export const priceOf = it => S.plus ? Math.floor(it.price * 0.8) : it.price;

// 배지 주기: 새로 얻었으면 true
const badgeSubs = new Set();
export function onBadge(f) { badgeSubs.add(f); return () => badgeSubs.delete(f); }
export function award(id) {
  if (S.badges[id]) return false;
  S.badges[id] = Date.now(); save(); badgeSubs.forEach(f => f(id));
  return true;
}
