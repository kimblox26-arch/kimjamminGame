// 게임 엔진: 시간, 주가 변화(캔들), 뉴스, 거래, 배당금, 은행, 저장
import { COMPANIES, START_CASH, DAY_HOURS, WEEK_HOURS, MARKET_NEWS, GOOD_WHY, BAD_WHY } from './data.js';

const KEY = 'kidstock.save.v1';
const VOL = { 1: 0.0035, 2: 0.0065, 3: 0.0105 };
const MAX_DAYS = 60;
const MAX_TRADES = 300;
const MAX_NEWS = 40;
export const BANK_RATE = 0.001; // 하루 이자율 0.1%
export const SPEEDS = { slow: 8000, normal: 5000, fast: 2500 }; // 게임 속 1시간이 걸리는 시간(밀리초)
export const BY_ID = Object.fromEntries(COMPANIES.map(c => [c.id, c]));

export let S = null;
const listeners = {};
export function on(ev, fn) { (listeners[ev] ||= []).push(fn); }
function emit(ev, data) { (listeners[ev] || []).forEach(fn => fn(data)); }

function gauss() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const rand = (a, b) => a + Math.random() * (b - a);

// 호가 단위: 가격에 따라 한 칸의 크기가 달라요
export const tickSize = p => (p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : 100);
export const roundTick = p => { const t = tickSize(p); return Math.max(t, Math.round(p / t) * t); };

function defaultSettings() {
  return { speed: 'normal', paused: false, sound: true, big: false, dark: null, name: '', newsPop: false, portraitOk: false };
}

function newState(keepSettings) {
  const s = {
    v: 1, tick: 0, cash: START_CASH, start: START_CASH,
    hold: {}, trades: [], news: [], stocks: {}, newsId: 0, newsSeen: 0,
    bank: { bal: 0, earned: 0 },
    assetsH: [], assetsD: [],
    settings: keepSettings || defaultSettings(),
    seen: {}, quizBest: 0, lessonsRead: {},
  };
  // 게임 시작 전 30일 동안의 주가 기록을 미리 만들어요
  for (const c of COMPANIES) {
    const st = { p: roundTick(c.price * rand(0.82, 1.12)), fair: c.price, trend: 0, push: [], h: [], c: [], d: [], dc: [] };
    for (let t = 1; t <= 30 * DAY_HOURS + 9; t++) {
      move(c, st);
      if (t % DAY_HOURS === 0 && t <= 30 * DAY_HOURS) closeDay(st);
    }
    s.stocks[c.id] = st;
  }
  s.tick = 9; // 1일째 오전 9시에 시작
  s.assetsH = [START_CASH];
  return s;
}

function move(c, st) {
  const sig = VOL[c.vol];
  const prev = st.p;
  st.trend = st.trend * 0.96 + gauss() * sig * 0.12;
  let r = c.growth + st.trend + gauss() * sig + Math.log(st.fair / st.p) * 0.012;
  if (st.push.length) {
    for (const p of st.push) { r += p.per; p.n--; }
    st.push = st.push.filter(p => p.n > 0);
  }
  st.fair *= Math.exp(c.growth);
  const p = roundTick(Math.max(100, prev * Math.exp(r)));
  const hi = roundTick(Math.max(prev, p) * (1 + Math.abs(gauss()) * sig * 0.6));
  const lo = roundTick(Math.min(prev, p) * (1 - Math.abs(gauss()) * sig * 0.6));
  const vol = Math.round((4e7 / c.price) * rand(0.6, 1.4) * (1 + Math.min(4, Math.abs(r) / sig) * 0.5));
  st.p = p;
  st.h.push(p); st.c.push([prev, Math.max(hi, prev, p), Math.min(lo, prev, p), p, vol]);
  if (st.h.length > WEEK_HOURS + 1) st.h.shift();
  if (st.c.length > WEEK_HOURS + 1) st.c.shift();
}

// 하루가 끝나면 그날의 캔들(시가, 고가, 저가, 종가, 거래량)을 만들어요
function aggregate(list, fallback) {
  if (!list.length) return [fallback, fallback, fallback, fallback, 0];
  return [list[0][0], Math.max(...list.map(x => x[1])), Math.min(...list.map(x => x[2])), list[list.length - 1][3], list.reduce((a, x) => a + x[4], 0)];
}
function closeDay(st) {
  st.d.push(st.p); if (st.d.length > MAX_DAYS) st.d.shift();
  st.dc.push(aggregate(st.c.slice(-DAY_HOURS), st.p)); if (st.dc.length > MAX_DAYS) st.dc.shift();
}
export function todayCandle(id) { const st = S.stocks[id]; return aggregate(hour() ? st.c.slice(-hour()) : [], st.p); }
export function candles(id, range) {
  const st = S.stocks[id];
  if (range === 'day') return st.c.slice(-DAY_HOURS);
  if (range === 'month') return [...st.dc.slice(-30), todayCandle(id)];
  const src = st.c.slice(-WEEK_HOURS), out = [];
  for (let i = src.length; i > 0; i -= 4) out.unshift(aggregate(src.slice(Math.max(0, i - 4), i), st.p));
  return out;
}

// ---------- 계산 도우미 ----------
export const price = id => S.stocks[id].p;
export const prevClose = id => { const d = S.stocks[id].d; return d.length ? d[d.length - 1] : S.stocks[id].h[0]; };
export const change = id => price(id) - prevClose(id);
export const changeRate = id => (change(id) / prevClose(id)) * 100;
export function stockValue() { let v = 0; for (const id in S.hold) v += S.hold[id].q * price(id); return v; }
export const totalAssets = () => S.cash + stockValue() + S.bank.bal;
export const profit = () => totalAssets() - S.start;
export const profitRate = () => (profit() / S.start) * 100;
export const avgPrice = id => { const h = S.hold[id]; return h ? h.cost / h.q : 0; };
export function holdPL(id) { const h = S.hold[id]; if (!h) return 0; return h.q * price(id) - h.cost; }
export function holdPLRate(id) { const h = S.hold[id]; if (!h || !h.cost) return 0; return (holdPL(id) / h.cost) * 100; }
export function unrealized() { let v = 0; for (const id in S.hold) v += holdPL(id); return v; }
export const day = (t = S.tick) => Math.floor(t / DAY_HOURS) + 1;
export const hour = (t = S.tick) => ((t % DAY_HOURS) + DAY_HOURS) % DAY_HOURS;
export function clockText(t = S.tick) {
  const d = day(t), h = hour(t);
  const ampm = h < 12 ? '오전' : '오후';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return d >= 1 ? `${d}일째 ${ampm} ${hh}시` : `시작 ${1 - d}일 전 ${ampm} ${hh}시`;
}
export const nextDividendIn = () => WEEK_HOURS - (S.tick % WEEK_HOURS);
export const nextInterestIn = () => DAY_HOURS - hour();
export const expectedInterest = () => Math.floor(S.bank.bal * BANK_RATE);
export const unreadNews = () => Math.max(0, S.newsId - S.newsSeen);
export function markNewsRead() { if (S.newsSeen !== S.newsId) { S.newsSeen = S.newsId; save(); emit('newsread'); } }

// ---------- 시간 흐름 ----------
export function step() {
  S.tick++;
  for (const c of COMPANIES) move(c, S.stocks[c.id]);
  if (Math.random() < 0.05) companyNews();
  else if (Math.random() < 0.012) marketNews();
  if (S.tick % DAY_HOURS === 0) {
    for (const c of COMPANIES) closeDay(S.stocks[c.id]);
    payInterest();
    S.assetsD.push(totalAssets()); if (S.assetsD.length > MAX_DAYS) S.assetsD.shift();
    emit('day', day());
  }
  if (S.tick % WEEK_HOURS === 0) payDividends();
  S.assetsH.push(totalAssets());
  if (S.assetsH.length > WEEK_HOURS + 1) S.assetsH.shift();
  if (S.tick % 4 === 0) save();
  emit('tick');
}

function addNews(item) {
  item.id = ++S.newsId;
  item.tick = S.tick;
  S.news.unshift(item);
  if (S.news.length > MAX_NEWS) S.news.pop();
  emit('news', item);
}

function impulse(id, sign, mag) {
  const st = S.stocks[id];
  const n = 3 + Math.floor(Math.random() * 4);
  st.push.push({ n, per: (sign * mag) / n });
  st.fair *= Math.exp(sign * mag * 0.5);
}

function companyNews() {
  const c = COMPANIES[Math.floor(Math.random() * COMPANIES.length)];
  const good = Math.random() < 0.53;
  const list = good ? c.good : c.bad;
  const mag = rand(0.03, 0.09) * (c.vol === 3 ? 1.5 : c.vol === 1 ? 0.65 : 1);
  impulse(c.id, good ? 1 : -1, mag);
  addNews({ cid: c.id, good, text: list[Math.floor(Math.random() * list.length)], why: good ? GOOD_WHY : BAD_WHY });
}

function marketNews() {
  const n = MARKET_NEWS[Math.floor(Math.random() * MARKET_NEWS.length)];
  const ids = [];
  if (n.all) {
    for (const c of COMPANIES) impulse(c.id, n.all, rand(0.015, 0.035));
  } else {
    for (const id in n.fx) { impulse(id, Math.sign(n.fx[id]), Math.abs(n.fx[id]) * rand(0.03, 0.06)); ids.push(id); }
  }
  addNews({ cid: null, ids, good: n.all ? n.all > 0 : null, text: n.text, why: n.why, market: true });
}

function payDividends() {
  let sum = 0;
  for (const id in S.hold) {
    const c = BY_ID[id];
    if (!c.div) continue;
    const per = Math.max(1, Math.round(price(id) * c.div));
    const amt = per * S.hold[id].q;
    S.cash += amt; sum += amt;
    S.trades.unshift({ t: 'div', id, q: S.hold[id].q, p: per, amt, tick: S.tick });
  }
  trimTrades();
  if (sum > 0) { save(); emit('dividend', sum); }
}

function payInterest() {
  const amt = expectedInterest();
  if (amt < 1) return;
  S.bank.bal += amt; S.bank.earned += amt;
  S.trades.unshift({ t: 'int', amt, bal: S.bank.bal, tick: S.tick });
  trimTrades(); save(); emit('interest', amt);
}

function trimTrades() { if (S.trades.length > MAX_TRADES) S.trades.length = MAX_TRADES; }

// ---------- 거래 ----------
export function maxBuy(id, p = price(id)) { return Math.floor(S.cash / p); }

export function buy(id, qty, p) {
  qty = Math.floor(qty);
  if (!BY_ID[id] || qty < 1) return { ok: false, msg: '살 수량을 다시 확인해 주세요.' };
  const cost = qty * p;
  if (cost > S.cash) return { ok: false, msg: '현금이 부족해서 살 수 없어요.' };
  S.cash -= cost;
  const h = S.hold[id] || (S.hold[id] = { q: 0, cost: 0 });
  h.q += qty; h.cost += cost;
  S.trades.unshift({ t: 'buy', id, q: qty, p, amt: cost, tick: S.tick });
  trimTrades(); save(); emit('trade');
  return { ok: true };
}

export function sell(id, qty, p) {
  qty = Math.floor(qty);
  const h = S.hold[id];
  if (!h || qty < 1 || qty > h.q) return { ok: false, msg: '팔 수 있는 수량이 아니에요.' };
  const avg = h.cost / h.q;
  const amt = qty * p;
  const pl = Math.round(amt - avg * qty);
  h.cost -= avg * qty; h.q -= qty;
  if (h.q === 0) delete S.hold[id];
  S.cash += amt;
  S.trades.unshift({ t: 'sell', id, q: qty, p, amt, pl, tick: S.tick });
  trimTrades(); save(); emit('trade');
  return { ok: true, pl };
}

// ---------- 은행 ----------
export function deposit(amt) {
  amt = Math.floor(amt);
  if (amt < 1) return { ok: false, msg: '맡길 돈을 1 코인 이상 써 주세요.' };
  if (amt > S.cash) return { ok: false, msg: '지갑에 있는 현금보다 많이 맡길 수 없어요.' };
  S.cash -= amt; S.bank.bal += amt;
  S.trades.unshift({ t: 'dep', amt, bal: S.bank.bal, tick: S.tick });
  trimTrades(); save(); emit('trade');
  return { ok: true };
}
export function withdraw(amt) {
  amt = Math.floor(amt);
  if (amt < 1) return { ok: false, msg: '찾을 돈을 1 코인 이상 써 주세요.' };
  if (amt > S.bank.bal) return { ok: false, msg: '은행에 맡긴 돈보다 많이 찾을 수 없어요.' };
  S.bank.bal -= amt; S.cash += amt;
  S.trades.unshift({ t: 'wd', amt, bal: S.bank.bal, tick: S.tick });
  trimTrades(); save(); emit('trade');
  return { ok: true };
}

// ---------- 저장 / 불러오기 ----------
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 저장할 수 없는 환경이면 넘어가요 */ }
}

function migrate(s) {
  s.settings = { ...defaultSettings(), ...s.settings };
  s.seen ||= {}; s.lessonsRead ||= {}; s.assetsD ||= [];
  s.bank ||= { bal: 0, earned: 0 };
  if (s.newsSeen == null) s.newsSeen = s.newsId || 0;
  for (const id in s.stocks) {
    const st = s.stocks[id];
    if (!st.c) st.c = st.h.map((p, i) => { const o = i ? st.h[i - 1] : p; return [o, Math.max(o, p), Math.min(o, p), p, 0]; });
    if (!st.dc) st.dc = st.d.map((p, i) => { const o = i ? st.d[i - 1] : p; return [o, Math.max(o, p), Math.min(o, p), p, 0]; });
  }
  s.assetsH ||= [s.cash];
  return s;
}

export function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
  if (s && s.v === 1 && s.stocks && COMPANIES.every(c => s.stocks[c.id])) {
    S = migrate(s);
  } else {
    S = newState();
    save();
  }
  return S;
}

export function reset() {
  const keep = { ...S.settings, paused: false };
  S = newState(keep);
  save();
  emit('reset');
}
