// 화면(UI): 메뉴, 화면 그리기, 창, 알림, 실시간 갱신
import { COMPANIES, VOL_INFO, GLOSSARY, LESSONS, QUIZ, GUIDES } from './data.js';
import { icon, tri, coin, logo, owl, pic } from './art.js';
import * as E from './engine.js';
import { lineChart, spark, donut, candleChart } from './chart.js';

const BY_ID = E.BY_ID;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = n => Math.round(Math.abs(n) < 0.5 ? 0 : n).toLocaleString('ko-KR');
const sgn = n => (Math.round(n) > 0 ? '+' : Math.round(n) < 0 ? '-' : '');
const fmtS = n => sgn(n) + fmt(Math.abs(n));
const pct = n => { const v = Math.round(n * 100) / 100; return (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(v).toFixed(2) + '%'; };
const dirOf = n => (n > 0.004 ? 'up' : n < -0.004 ? 'down' : 'flat');
const C = n => `${fmt(n)}<small class="unit">코인</small>`;
const CS = n => `${fmtS(n)}<small class="unit">코인</small>`;
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const term = (t, label = t) => `<button type="button" class="term" data-term="${t}">${label}</button>`;
const live = (key, id = '', cls = '') => `<span class="${cls}" data-live="${key}"${id ? ` data-id="${id}"` : ''}></span>`;
const volBadge = v => `<span class="vol v${v}" title="변동 정도: ${VOL_INFO[v].label}"><i></i><i></i><i></i></span>`;
const RANGE_NAME = { day: '하루', week: '일주일', month: '한 달' };

const ui = { sort: 'name', range: { stock: 'day', assets: 'week', term: 'day' }, learnTab: 'lessons', histFilter: 'all', quiz: null,
  term: { id: COMPANIES[0].id, side: 'buy', qty: 1 }, tape: {}, newsFilter: 'all', bankTab: 'dep', bankAmt: 0 };
let cur = { name: 'home', id: null };
const trail = [];
let backing = false, lastHash = location.hash;

// ---------- 소리 ----------
let actx = null;
const SFX = { buy: [[523, 0.1], [784, 0.16]], sell: [[784, 0.1], [523, 0.16]], news: [[880, 0.07]], coin: [[988, 0.07], [1319, 0.18]], ok: [[660, 0.08], [880, 0.12]], no: [[330, 0.16]] };
function sfx(name) {
  if (!E.S.settings.sound) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    let t = actx.currentTime;
    for (const [f, d] of SFX[name]) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(actx.destination);
      o.start(t); o.stop(t + d + 0.03);
      t += d * 0.85;
    }
  } catch (e) { /* 소리를 낼 수 없는 환경 */ }
}

// ---------- 데이터 묶음 ----------
function series(id, range) {
  const st = E.S.stocks[id];
  if (range === 'day') return st.h.slice(-25);
  if (range === 'week') return st.h.slice();
  return [...st.d.slice(-30), st.p];
}
function assetSeries(range) {
  if (range === 'day') return E.S.assetsH.slice(-25);
  if (range === 'week') return E.S.assetsH.slice();
  return [...E.S.assetsD.slice(-30), E.totalAssets()];
}
const dayLabel = d => (d >= 1 ? `${d}일째` : `시작 ${1 - d}일 전`);
function chartOpts(range, n) {
  const hourly = range !== 'month';
  const ago = n - 1;
  const xl = hourly ? (ago < 24 ? `${ago}시간 전` : `${Math.round(ago / 24)}일 전`) : `${ago}일 전`;
  return {
    xl, xr: '지금',
    fmt: v => fmt(v),
    label: i => {
      const back = n - 1 - i;
      if (back === 0) return '지금';
      return hourly ? E.clockText(E.S.tick - back) : `${dayLabel(E.day() - back)} 마감`;
    },
  };
}

// ---------- 실시간 값 ----------
const LIVE = {
  price: id => [C(E.price(id))],
  priceN: id => [fmt(E.price(id))],
  priceC: id => [fmt(E.price(id)), dirOf(E.changeRate(id))],
  prevN: id => [fmt(E.prevClose(id))],
  chgR: id => { const r = E.changeRate(id); return [pct(r), dirOf(r)]; },
  tOpen: id => { const k = E.todayCandle(id); return [fmt(k[0]), dirOf(k[0] - E.prevClose(id))]; },
  tHigh: id => { const k = E.todayCandle(id); return [fmt(k[1]), dirOf(k[1] - E.prevClose(id))]; },
  tLow: id => { const k = E.todayCandle(id); return [fmt(k[2]), dirOf(k[2] - E.prevClose(id))]; },
  tVol: id => [fmt(E.todayCandle(id)[4])],
  bankBal: () => [C(E.S.bank.bal)],
  bankEarned: () => [C(E.S.bank.earned)],
  bankNext: () => [C(E.expectedInterest())],
  intIn: () => [`${E.nextInterestIn()}시간 뒤`],
  prev: id => [C(E.prevClose(id))],
  chg: id => { const r = E.changeRate(id), d = dirOf(r); return [tri(d) + pct(r), d]; },
  chgText: id => {
    const v = E.change(id), r = E.changeRate(id), d = dirOf(r);
    return [d === 'flat' ? '어제와 거의 같아요' : `어제보다 ${fmt(Math.abs(v))} 코인 ${d === 'up' ? '올랐어요' : '내렸어요'}`, d];
  },
  cash: () => [C(E.S.cash)],
  total: () => [C(E.totalAssets())],
  stockVal: () => [C(E.stockValue())],
  profit: () => { const v = E.profit(); return [CS(v), dirOf(v)]; },
  profitRate: () => { const v = E.profitRate(); return [tri(dirOf(v)) + pct(v), dirOf(v)]; },
  unreal: () => { const v = E.unrealized(); return [CS(v), dirOf(v)]; },
  clock: () => [E.clockText()],
  hq: id => [`${fmt(E.S.hold[id]?.q || 0)}주`],
  hval: id => [C((E.S.hold[id]?.q || 0) * E.price(id))],
  hpl: id => { const v = E.holdPL(id); return [CS(v), dirOf(v)]; },
  hplr: id => { const v = E.holdPLRate(id); return [pct(v), dirOf(v)]; },
  avg: id => [C(E.avgPrice(id))],
  divPer: id => [fmt(Math.max(1, Math.round(E.price(id) * BY_ID[id].div)))],
  divIn: () => { const h = E.nextDividendIn(); return [h >= 24 ? `${Math.ceil(h / 24)}일 뒤` : `${h}시간 뒤`]; },
  period: (id, el) => {
    const s = id === '__assets' ? assetSeries(el.dataset.range) : series(id, el.dataset.range);
    const a = s[0], b = s[s.length - 1], v = b - a, r = a ? (v / a) * 100 : 0, d = dirOf(r);
    return [`${RANGE_NAME[el.dataset.range]} 동안 ${tri(d)} ${pct(r)} <span class="muted">(${fmtS(v)} 코인)</span>`, d];
  },
};

function refresh(root = document) {
  for (const el of root.querySelectorAll('[data-live]')) {
    const f = LIVE[el.dataset.live];
    if (!f) continue;
    const [html, d] = f(el.dataset.id, el);
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
    if (d !== undefined) for (const k of ['up', 'down', 'flat']) el.classList.toggle(k, d === k);
    if (el.hasAttribute('data-flash')) {
      const v = E.price(el.dataset.id);
      if (el._fv != null && v !== el._fv) { el.classList.remove('fl-up', 'fl-down'); void el.offsetWidth; el.classList.add(v > el._fv ? 'fl-up' : 'fl-down'); }
      el._fv = v;
    }
  }
  for (const el of root.querySelectorAll('[data-chart]')) drawChart(el);
}

function drawChart(el) {
  const k = el.dataset.chart, id = el.dataset.id, rg = el.dataset.range;
  if (k === 'spark') el.innerHTML = spark(series(id, 'day'));
  else if (k === 'assetSpark') el.innerHTML = spark(assetSeries('week'), 300, 48);
  else if (k === 'stock') { const s = series(id, rg); lineChart(el, s, chartOpts(rg, s.length)); }
  else if (k === 'assets') { const s = assetSeries(rg); lineChart(el, s, chartOpts(rg, s.length)); }
  else if (k === 'donut') el.innerHTML = donutHTML();
  else if (k === 'candle') { const cs = E.candles(id, rg); candleChart(el, cs, candleOpts(rg, cs.length, id)); }
  else if (k === 'book') el.innerHTML = bookHTML(id);
  else if (k === 'tape') el.innerHTML = tapeHTML(id);
}

// ---------- 창(모달) ----------
const modalRoot = $('#modals');
let stack = [];
function modal({ title, body, buttons = [], cls = '', onTick, onClose, closable = true }) {
  const wrap = document.createElement('div');
  wrap.className = 'overlay';
  wrap.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title.replace(/<[^>]+>/g, ''))}">
    <div class="m-head"><h3>${title}</h3>${closable ? `<button type="button" class="icon-btn" data-close aria-label="닫기">${icon('close')}</button>` : ''}</div>
    <div class="m-body">${body}</div>
    ${buttons.length ? `<div class="m-foot">${buttons.map((b, i) => `<button type="button" class="btn ${b.kind || ''}" data-bi="${i}"${b.id ? ` data-bid="${b.id}"` : ''}>${b.label}</button>`).join('')}</div>` : ''}
  </div>`;
  const m = { el: wrap, onTick, close, closed: false };
  wrap.addEventListener('click', e => {
    if (e.target === wrap && closable) return close();
    if (e.target.closest('[data-close]')) return close();
    const b = e.target.closest('[data-bi]');
    if (b && !b.disabled) {
      const def = buttons[+b.dataset.bi];
      const r = def.onClick ? def.onClick(m) : undefined;
      if (r !== false) close();
    }
  });
  function close() {
    if (m.closed) return;
    m.closed = true;
    stack = stack.filter(x => x !== m);
    wrap.classList.add('out');
    setTimeout(() => wrap.remove(), 160);
    if (!stack.length) document.body.classList.remove('modal-open');
    onClose && onClose();
  }
  modalRoot.appendChild(wrap);
  stack.push(m);
  document.body.classList.add('modal-open');
  refresh(wrap);
  const fb = wrap.querySelector('.m-foot .btn:last-child') || wrap.querySelector('[data-close]');
  if (fb) fb.focus({ preventScroll: true });
  return m;
}
const alertBox = (title, text) => modal({ title, cls: 'small', body: `<div class="guide-body">${owl('owl-md')}<div><p>${text}</p></div></div>`, buttons: [{ label: '확인', kind: 'primary' }] });

function showGuide(key) {
  if (!GUIDES[key] || E.S.seen[key]) return;
  E.S.seen[key] = true; E.save();
  const g = GUIDES[key];
  modal({ cls: 'guide', title: g.title, body: `<div class="guide-body">${owl('owl-lg')}<div>${g.text.map(t => `<p>${t}</p>`).join('')}</div></div>`, buttons: [{ label: '알겠어요', kind: 'primary' }] });
}

function openTerm(t) {
  const g = GLOSSARY.find(x => x.t === t);
  if (!g) return;
  modal({ cls: 'small', title: g.t, body: `<p class="term-def">${g.d}</p><div class="ex-box"><b>예를 들면</b><p>${g.ex}</p></div>`,
    buttons: [{ label: '용어 사전 보기', kind: 'ghost', onClick: () => { ui.learnTab = 'terms'; go('learn'); } }, { label: '알겠어요', kind: 'primary' }] });
}

// ---------- 알림(토스트) ----------
function toast(html, { kind = '', onClick, ms = 4500 } = {}) {
  const root = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = html;
  if (onClick) { t.classList.add('clickable'); t.setAttribute('role', 'button'); t.addEventListener('click', () => { onClick(); t.remove(); }); }
  root.appendChild(t);
  while (root.children.length > 3) root.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------- 뉴스 ----------
function newsKind(n) { return n.good === true ? 'up' : n.good === false ? 'down' : 'flat'; }
function newsTag(n) { return n.good === true ? '좋은 소식' : n.good === false ? '나쁜 소식' : '경제 소식'; }
function newsItem(n) {
  const c = n.cid ? BY_ID[n.cid] : null, d = newsKind(n);
  return `<button type="button" class="news-item" data-act="news" data-nid="${n.id}">
    <span class="news-ic">${c ? logo(c, 38) : `<span class="news-gen">${icon('news')}</span>`}</span>
    <span class="news-body"><span class="news-meta"><b class="tag ${d}">${newsTag(n)}</b><span>${c ? c.name : '여러 회사'} · ${E.clockText(n.tick)}</span></span>
    <span class="news-text">${esc(n.text)}</span></span>${icon('chevron', 'muted-ic')}</button>`;
}
function newsList(cid, limit) {
  const list = E.S.news.filter(n => !cid || n.cid === cid || (n.ids && n.ids.includes(cid)) || (n.market && n.good !== null && !n.ids?.length)).slice(0, limit);
  return list.length ? list.map(newsItem).join('') : `<p class="empty-line">아직 새로운 소식이 없어요. 시간이 지나면 소식이 들려와요.</p>`;
}
function openNews(id) {
  const n = E.S.news.find(x => x.id === id);
  if (!n) return;
  const ids = n.cid ? [n.cid] : n.ids?.length ? n.ids : [];
  modal({ title: newsTag(n), body: `
    <p class="news-big">${esc(n.text)}</p>
    <p class="muted small">${E.clockText(n.tick)}</p>
    <div class="ex-box">${icon('bulb')}<div><b>왜 주가가 바뀔까요?</b><p>${n.why}</p></div></div>
    ${ids.length ? `<h4 class="mini-title">관련 회사</h4><div class="mini-list">${ids.map(i => `<a class="mini-row" href="#stock-${i}" data-closeall>${logo(BY_ID[i], 36)}<b>${BY_ID[i].name}</b>${live('chg', i, 'chg')}${icon('chevron', 'muted-ic')}</a>`).join('')}</div>`
      : `<p class="muted">이 소식은 많은 회사에 함께 영향을 줘요.</p>`}`,
    buttons: [{ label: '닫기', kind: 'primary' }] });
}

// ---------- 화면들 ----------
// ---------- 주식창 (홈) ----------
const BANK_LOGO = size => logo({ name: '은행', color: '#2E8C8C', logo: 'bank' }, size);
const CANDLE_UNIT = { day: '1시간', week: '4시간', month: '하루' };
function candleOpts(rg, n, id) {
  const step = rg === 'week' ? 4 : 1;
  return {
    xl: { day: '24시간 전', week: '7일 전', month: '30일 전' }[rg], xr: '지금', base: E.prevClose(id),
    label: i => {
      const back = n - 1 - i;
      if (rg === 'month') return back === 0 ? '오늘 (지금까지)' : `${dayLabel(E.day() - back)}`;
      return back === 0 ? '지금' : E.clockText(E.S.tick - back * step);
    },
  };
}
function seeded(seed) { let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function bookHTML(id) {
  const p = E.price(id), t = E.tickSize(p), prev = E.prevClose(id);
  const base = Math.max(30, (E.S.stocks[id].c.at(-1)?.[4] || 600) / 5);
  const rnd = seeded(E.S.tick * 7919 + id.charCodeAt(0) * 131 + id.length * 17);
  const asks = [5, 4, 3, 2, 1].map(k => ({ pr: p + k * t, q: Math.round(base * (0.3 + rnd() * 1.2) * (1 + k * 0.12)) }));
  const bids = [0, 1, 2, 3, 4].map(k => ({ pr: p - k * t, q: Math.round(base * (0.3 + rnd() * 1.2) * (1 + k * 0.12)) }));
  const mx = Math.max(...asks.map(a => a.q), ...bids.map(b => b.q));
  const cell = pr => `<span class="b-p ${dirOf(((pr - prev) / prev) * 100)}">${fmt(pr)}<small>${pct(((pr - prev) / prev) * 100)}</small></span>`;
  const bar = q => `<i style="width:${((q / mx) * 100).toFixed(0)}%"></i><em>${fmt(q)}</em>`;
  return `<div class="b-row b-headrow"><span class="b-q muted small">팔고 싶어요</span><span class="b-p muted small">가격</span><span class="b-q muted small">사고 싶어요</span></div>
    ${asks.map(a => `<div class="b-row ask"><span class="b-q">${bar(a.q)}</span>${cell(a.pr)}<span class="b-q"></span></div>`).join('')}
    ${bids.map((b, k) => `<div class="b-row bid${k === 0 ? ' now' : ''}"><span class="b-q"></span>${cell(b.pr)}<span class="b-q">${bar(b.q)}</span></div>`).join('')}
    <div class="b-foot"><span>${fmt(asks.reduce((s, a) => s + a.q, 0))}</span><span>잔량 합계</span><span>${fmt(bids.reduce((s, b) => s + b.q, 0))}</span></div>`;
}
function addTape(id, n = 2 + Math.floor(Math.random() * 3)) {
  const list = (ui.tape[id] ||= []);
  const p = E.price(id), t = E.tickSize(p), h = E.hour();
  const mins = Array.from({ length: n }, () => Math.floor(Math.random() * 60)).sort((a, b) => a - b);
  for (const mm of mins) {
    const pr = p + (Math.random() < 0.5 ? 0 : Math.random() < 0.5 ? t : -t);
    const last = list[0]?.p ?? pr;
    list.unshift({ time: `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, p: pr, q: 1 + Math.floor(Math.random() * Math.random() * 300), d: pr > last ? 'up' : pr < last ? 'down' : (list[0]?.d || 'up') });
  }
  if (list.length > 10) list.length = 10;
}
function tapeHTML(id) {
  if (!ui.tape[id]) addTape(id, 8);
  return `<div class="t-head"><span>시간</span><span>체결 가격</span><span>수량</span></div>${ui.tape[id].map(x => `<div class="t-row"><span class="muted">${x.time}</span><span class="${x.d}">${fmt(x.p)}</span><span class="${x.d}">${fmt(x.q)}</span></div>`).join('')}`;
}
function tickerHTML() {
  const n = E.S.news[0], un = E.unreadNews();
  return `<span class="tk-label">${icon('news')}뉴스</span>${n ? `<b class="tag ${newsKind(n)}">${newsTag(n)}</b><span class="tk-text">${esc(n.text)}</span>` : '<span class="tk-text muted">아직 새로운 소식이 없어요. 소식은 가끔씩 들려와요.</span>'}<span class="tk-more${un ? ' new' : ''}">${un ? `새 소식 ${un}개` : '모두 보기'} ${icon('chevron', 'muted-ic')}</span>`;
}
function orderHTML() {
  const { id, side } = ui.term, c = BY_ID[id], buy = side === 'buy', h = E.S.hold[id];
  return `<div class="o-tabs" role="tablist"><button type="button" role="tab" class="${buy ? 'on buy' : ''}" data-act="tside" data-v="buy">매수 <small>사기</small></button><button type="button" role="tab" class="${!buy ? 'on sell' : ''}" data-act="tside" data-v="sell">매도 <small>팔기</small></button></div>
  <div class="o-row"><span>주문 방법</span><b>${term('시장가')} (지금 가격)</b></div>
  <div class="o-row"><span>1주 가격</span><b>${live('price', id)}</b></div>
  <div class="o-row"><label for="tQty">${buy ? '살' : '팔'} 수량</label></div>
  <div class="stepper sm"><button type="button" class="step" data-tq="-1" aria-label="1주 빼기">${icon('minus')}</button><div class="qty-box"><input id="tQty" type="number" inputmode="numeric" min="0" step="1" value="${ui.term.qty}"><span>주</span></div><button type="button" class="step" data-tq="1" aria-label="1주 더하기">${icon('plus')}</button></div>
  <div class="chips sm"><button type="button" data-tqs="1">1주</button><button type="button" data-tqa="5">+5주</button><button type="button" data-tqa="10">+10주</button><button type="button" data-tqs="half">절반</button><button type="button" data-tqs="max">${buy ? '최대' : '전부'}</button></div>
  <div class="o-sum"><div><span>주문 금액</span><b data-o="amt"></b></div><div><span>${buy ? '주문 가능 현금' : '팔 수 있는 수량'}</span><b data-o="avail"></b></div>${buy ? '' : `<div><span>예상 ${term('수익')}/${term('손실')}</span><b data-o="pl"></b></div>`}</div>
  <p class="sheet-warn" data-o="warn" hidden></p>
  <button type="button" class="btn ${buy ? 'buy' : 'sell'} full" data-act="tgo">${buy ? '매수 주문 (사기)' : '매도 주문 (팔기)'}</button>
  <div class="o-hold">${h ? `가진 주식 <b>${live('hq', id)}</b> · 평균 ${live('avg', id)} · ${live('hpl', id, 'pl')}` : `${c.name} 주식을 아직 가지고 있지 않아요.`}</div>`;
}
function updateOrder(fromInput) {
  const el = $('#orderPanel');
  if (!el) return;
  const { id, side } = ui.term, buy = side === 'buy';
  const p = E.price(id), max = buy ? E.maxBuy(id) : E.S.hold[id]?.q || 0, q = ui.term.qty, amt = q * p;
  const inp = $('#tQty', el);
  if (!fromInput && inp && document.activeElement !== inp) inp.value = q;
  $('[data-o="amt"]', el).innerHTML = C(amt);
  $('[data-o="avail"]', el).innerHTML = buy ? C(E.S.cash) : `${fmt(max)}주`;
  if (!buy) { const pl = Math.round(amt - E.avgPrice(id) * q), d = dirOf(pl); const b = $('[data-o="pl"]', el); b.innerHTML = q && max ? CS(pl) : '-'; b.className = 'pl ' + d; }
  let warn = '';
  if (!buy && max < 1) warn = '이 회사 주식을 가지고 있지 않아서 팔 수 없어요.';
  else if (buy && max < 1) warn = '현금이 부족해서 1주도 살 수 없어요.';
  else if (q > max) warn = buy ? `현금이 부족해요. 지금은 최대 ${fmt(max)}주까지 살 수 있어요.` : `가지고 있는 주식은 ${fmt(max)}주예요.`;
  else if (q < 1) warn = '1주 이상을 골라 주세요.';
  const w = $('[data-o="warn"]', el); w.textContent = warn; w.hidden = !warn;
  $('[data-act="tgo"]', el).disabled = q < 1 || q > max;
}
function termMax() { return ui.term.side === 'buy' ? E.maxBuy(ui.term.id) : E.S.hold[ui.term.id]?.q || 0; }
function setOrderPanel() { const el = $('#orderPanel'); if (!el) return; el.innerHTML = orderHTML(); refresh(el); updateOrder(); }

function newsScreenList() {
  const f = ui.newsFilter;
  const list = E.S.news.filter(n => f === 'all' || (f === 'good' && n.good === true) || (f === 'bad' && n.good === false) || (f === 'market' && n.market));
  return list.length ? list.map(newsItem).join('') : `<p class="empty-line">아직 이런 소식이 없어요. 시간이 지나면 소식이 들려와요.</p>`;
}
function updateBadge() {
  const b = $('#newsBadge'); if (!b) return;
  const n = E.unreadNews();
  b.textContent = n > 99 ? '99+' : n; b.hidden = !n;
}
function updateBank(fromInput) {
  const el = $('#bankForm'); if (!el) return;
  const dep = ui.bankTab === 'dep', a = ui.bankAmt, max = dep ? E.S.cash : E.S.bank.bal;
  const inp = $('#bankAmt', el);
  if (!fromInput && inp && document.activeElement !== inp) inp.value = a || '';
  $('[data-b="cash"]', el).innerHTML = C(E.S.cash + (dep ? -a : a));
  $('[data-b="bal"]', el).innerHTML = C(E.S.bank.bal + (dep ? a : -a));
  $('[data-b="int"]', el).innerHTML = C(Math.floor(Math.max(0, E.S.bank.bal + (dep ? a : -a)) * E.BANK_RATE));
  let warn = '';
  if (max < 1) warn = dep ? '지갑에 맡길 현금이 없어요.' : '은행에 맡긴 돈이 없어요.';
  else if (a > max) warn = dep ? `지갑에 있는 현금은 ${fmt(max)} 코인이에요.` : `은행에 맡긴 돈은 ${fmt(max)} 코인이에요.`;
  else if (a < 1) warn = `${dep ? '맡길' : '찾을'} 돈을 써 주세요.`;
  const w = $('[data-b="warn"]', el); w.textContent = warn; w.hidden = !warn;
  $('[data-act="bankGo"]', el).disabled = a < 1 || a > max;
}

function stockRow(c) {
  const h = E.S.hold[c.id];
  return `<a class="stock-row" href="#stock-${c.id}">
    ${logo(c, 44)}
    <span class="sr-name"><b>${c.name}</b><span class="muted small">${c.sector} ${volBadge(c.vol)}${h ? ` <span class="own">${fmt(h.q)}주 보유</span>` : ''}</span></span>
    <span class="sr-spark" data-chart="spark" data-id="${c.id}"></span>
    <span class="sr-price"><b>${live('priceN', c.id)}</b>${live('chg', c.id, 'chg')}</span>
  </a>`;
}
function rangeSeg(group, rg) {
  return `<div class="seg" role="tablist">${['day', 'week', 'month'].map(r => `<button type="button" role="tab" class="${r === rg ? 'on' : ''}" aria-selected="${r === rg}" data-act="range" data-group="${group}" data-range="${r}">${RANGE_NAME[r]}</button>`).join('')}</div>`;
}

const SCREENS = {
  home() {
    const t = ui.term;
    if (!BY_ID[t.id]) t.id = COMPANIES[0].id;
    const id = t.id, c = BY_ID[id], rg = ui.range.term;
    return `
    <section class="acct" aria-label="내 계좌">
      <div class="acct-item"><span>${term('총자산')}</span><b>${live('total')}</b></div>
      <div class="acct-item"><span>${term('수익률')}</span><b>${live('profitRate')}</b></div>
      <div class="acct-item"><span>주문 가능 ${term('현금')}</span><b>${live('cash')}</b></div>
      <div class="acct-item"><span>주식 ${term('평가 금액')}</span><b>${live('stockVal')}</b></div>
      <div class="acct-item"><span>은행 ${term('예금')}</span><b>${live('bankBal')}</b></div>
    </section>
    <button type="button" class="ticker" data-act="goNews" data-newsticker>${tickerHTML()}</button>
    <div class="trm">
      <section class="panel watch" aria-label="관심 종목">
        <div class="p-head"><b>관심 종목</b><span class="muted small">${COMPANIES.length}개 회사</span></div>
        <div class="w-head"><span>회사</span><span>현재가</span><span>${term('변동률', '등락률')}</span></div>
        <div class="w-list">${COMPANIES.map(x => `<button type="button" class="w-row${x.id === id ? ' on' : ''}" data-act="tsel" data-id="${x.id}" aria-pressed="${x.id === id}">${logo(x, 26)}<span class="w-name">${x.name}${E.S.hold[x.id] ? '<i class="own-dot" title="가지고 있어요"></i>' : ''}</span><span class="w-price" data-live="priceC" data-id="${x.id}" data-flash></span><span class="w-chg" data-live="chgR" data-id="${x.id}"></span></button>`).join('')}</div>
      </section>
      <section class="panel chartp">
        <div class="q-head">${logo(c, 40)}
          <div class="q-name"><b>${c.name}</b><span class="muted small">${c.sector} ${volBadge(c.vol)}</span></div>
          <div class="q-price"><b class="qp" data-live="priceC" data-id="${id}" data-flash></b>${live('chg', id, 'chg')}</div>
          <a class="link" href="#stock-${id}">회사 정보 ${icon('chevron')}</a>
        </div>
        <div class="q-stats">
          <div><span>오늘 ${term('시가')}</span><b data-live="tOpen" data-id="${id}"></b></div>
          <div><span>오늘 ${term('고가')}</span><b data-live="tHigh" data-id="${id}"></b></div>
          <div><span>오늘 ${term('저가')}</span><b data-live="tLow" data-id="${id}"></b></div>
          <div><span>어제 ${term('종가')}</span><b data-live="prevN" data-id="${id}"></b></div>
          <div><span>오늘 ${term('거래량')}</span><b data-live="tVol" data-id="${id}"></b></div>
        </div>
        <div class="row-between c-tools">${rangeSeg('term', rg)}<span class="legend-mini"><i class="lg-ma5"></i>최근 5개 평균 <i class="lg-ma20"></i>최근 20개 평균</span></div>
        <div class="chart cchart" data-chart="candle" data-id="${id}" data-range="${rg}" data-rgroup="term"></div>
        <p class="hint">${icon('info')}<span>${term('캔들')} 막대 하나는 ${CANDLE_UNIT[rg]} 동안의 가격이에요. 빨간 막대는 올랐고 파란 막대는 내렸어요. 막대를 누르면 시가, 고가, 저가, 종가가 보여요. 아래쪽 작은 막대는 ${term('거래량')}이에요.</span></p>
      </section>
      <div class="side-col">
        <section class="panel book"><div class="p-head"><b>${term('호가')}창</b><span class="muted small">지금 가격 테두리</span></div><div data-chart="book" data-id="${id}"></div></section>
        <section class="panel order" id="orderPanel">${orderHTML()}</section>
      </div>
      <section class="panel tape"><div class="p-head"><b>실시간 체결</b><span class="muted small">다른 사람들이 사고판 기록</span></div><div data-chart="tape" data-id="${id}"></div></section>
    </div>`;
  },

  news() {
    const fl = [['all', '전체'], ['good', '좋은 소식'], ['bad', '나쁜 소식'], ['market', '경제 소식']];
    return `
    <section class="toolbar">
      <p class="muted">회사와 경제에 생긴 소식이에요. 소식은 가끔씩 들려오고, 새 소식이 오면 메뉴의 뉴스 버튼에 숫자가 생겨요. 소식을 누르면 왜 주가가 바뀌는지 알려 줘요.</p>
      <div class="seg">${fl.map(([k, l]) => `<button type="button" class="${ui.newsFilter === k ? 'on' : ''}" data-act="nfilter" data-f="${k}">${l}</button>`).join('')}</div>
    </section>
    <section class="card news-list" data-newslist="__all">${newsScreenList()}</section>`;
  },

  bank() {
    const dep = ui.bankTab === 'dep';
    const recs = E.S.trades.filter(t => t.t === 'dep' || t.t === 'wd' || t.t === 'int').slice(0, 8);
    return `
    <div class="bank-grid">
      <div class="bank-col">
        <section class="card">
          <div class="bank-top">${BANK_LOGO(56)}<div><span class="label">은행에 맡긴 돈 (${term('예금')})</span><div class="big-num">${live('bankBal')}</div></div></div>
          <div class="kv-grid">
            <div><span class="label">${term('이자율')}</span><b>하루에 ${(E.BANK_RATE * 100).toFixed(1)}%</b></div>
            <div><span class="label">다음 ${term('이자')}</span><b>${live('intIn')}</b></div>
            <div><span class="label">이번에 받을 이자</span><b>${live('bankNext')}</b></div>
            <div><span class="label">지금까지 받은 이자</span><b>${live('bankEarned')}</b></div>
          </div>
          <p class="hint">${icon('info')}<span>매일 밤 12시에 맡긴 돈의 0.1%가 이자로 붙어요. 1,000 코인 이상 맡겨야 이자가 생겨요.</span></p>
        </section>
        <section class="card" id="bankForm">
          <div class="seg two"><button type="button" class="${dep ? 'on' : ''}" data-act="bankTab" data-v="dep">맡기기 (입금)</button><button type="button" class="${!dep ? 'on' : ''}" data-act="bankTab" data-v="wd">찾기 (출금)</button></div>
          <label class="label" for="bankAmt">${dep ? '지갑에서 은행으로 옮길 돈' : '은행에서 지갑으로 꺼낼 돈'}</label>
          <div class="amt-box"><input id="bankAmt" type="number" inputmode="numeric" min="0" step="1" placeholder="0" value="${ui.bankAmt || ''}"><span>코인</span></div>
          <div class="chips"><button type="button" data-act="bankAdd" data-v="1000">+1천</button><button type="button" data-act="bankAdd" data-v="10000">+1만</button><button type="button" data-act="bankAdd" data-v="50000">+5만</button><button type="button" data-act="bankAdd" data-v="all">전부</button><button type="button" data-act="bankAdd" data-v="0">지우기</button></div>
          <div class="summary">
            <div><span>${dep ? '맡긴 뒤' : '찾은 뒤'} 지갑 ${term('현금')}</span><b data-b="cash"></b></div>
            <div><span>${dep ? '맡긴 뒤' : '찾은 뒤'} 은행 예금</span><b data-b="bal"></b></div>
            <div><span>그러면 하루 이자는</span><b data-b="int"></b></div>
          </div>
          <p class="sheet-warn" data-b="warn" hidden></p>
          <button type="button" class="btn primary big full" data-act="bankGo">${dep ? '은행에 맡기기' : '은행에서 찾기'}</button>
        </section>
      </div>
      <div class="bank-col">
        <section class="card">
          <h3>은행과 주식은 어떻게 다를까요?</h3>
          <div class="cmp-wrap"><table class="cmp"><thead><tr><th></th><th>은행 예금</th><th>주식</th></tr></thead><tbody>
            <tr><td>안전한가요?</td><td>맡긴 돈이 줄어들지 않아요.</td><td>주가가 내리면 줄어들 수 있어요.</td></tr>
            <tr><td>얼마나 늘까요?</td><td>조금씩 꾸준히 늘어요. (하루 0.1%)</td><td>크게 늘 수도, 크게 줄 수도 있어요.</td></tr>
            <tr><td>언제 쓸 수 있나요?</td><td>언제든 바로 찾을 수 있어요.</td><td>팔아야 현금이 돼요.</td></tr>
          </tbody></table></div>
          <p class="tip-box">${icon('bulb')}<span>돈의 일부는 은행에, 일부는 주식에 나눠 두는 것도 좋은 방법이에요. 곧 쓸 돈은 은행에 두면 안전해요.</span></p>
        </section>
        <section class="card list-card"><div class="p-head"><b>은행 기록</b><a class="link" href="#history">모든 기록 ${icon('chevron')}</a></div>${recs.length ? recs.map(tradeRow).join('') : '<p class="empty-line">아직 은행 기록이 없어요. 돈을 맡기면 여기에 적혀요.</p>'}</section>
      </div>
    </div>`;
  },

  market() {
    const list = [...COMPANIES];
    const by = { name: (a, b) => a.name.localeCompare(b.name, 'ko'), up: (a, b) => E.changeRate(b.id) - E.changeRate(a.id), down: (a, b) => E.changeRate(a.id) - E.changeRate(b.id), high: (a, b) => E.price(b.id) - E.price(a.id), low: (a, b) => E.price(a.id) - E.price(b.id) };
    list.sort(by[ui.sort]);
    const sorts = [['name', '이름순'], ['up', '많이 오른 순'], ['down', '많이 내린 순'], ['high', '비싼 순'], ['low', '싼 순']];
    return `
    <section class="toolbar">
      <p class="muted">회사를 누르면 자세한 정보와 그래프를 볼 수 있어요.</p>
      <div class="seg wrap">${sorts.map(([k, l]) => `<button type="button" class="${ui.sort === k ? 'on' : ''}" data-act="sort" data-sort="${k}">${l}</button>`).join('')}</div>
      <div class="legend-line"><span class="up">${tri('up')} 빨간색: 어제보다 올랐어요</span><span class="down">${tri('down')} 파란색: 어제보다 내렸어요</span><span>${volBadge(2)} ${term('변동 정도')}</span><span>오른쪽 % = ${term('변동률')}</span></div>
    </section>
    <section class="card stock-list">${list.map(stockRow).join('')}</section>`;
  },

  stock(id) {
    const c = BY_ID[id], h = E.S.hold[id], rg = ui.range.stock;
    return `
    <section class="card stock-head">
      <div class="sh-top">${logo(c, 56)}<div><h2>${c.name}</h2><span class="muted">${c.sector} · 지금 ${term('주가')} (1주 가격)</span></div></div>
      <div class="big-num">${live('price', id)}</div>
      <div class="pl-line">${live('chg', id, 'pill')}${live('chgText', id, 'chg-text')}</div>
    </section>
    <div class="trade-bar">
      <button type="button" class="btn buy big" data-act="buy" data-id="${id}">사기 <small>${'매수'}</small></button>
      <button type="button" class="btn sell big" data-act="sell" data-id="${id}">팔기 <small>${'매도'}</small></button>
    </div>
    <section class="card">
      <div class="row-between wrap-gap"><h3>주가 그래프</h3>${rangeSeg('stock', rg)}</div>
      <div class="chart" data-chart="stock" data-id="${id}" data-range="${rg}" data-rgroup="stock"></div>
      <p class="period" data-live="period" data-id="${id}" data-range="${rg}" data-rgroup="stock"></p>
      <p class="hint">${icon('info')}<span>그래프를 누르거나 손가락으로 밀면 그때의 가격이 보여요. 점선은 기간이 시작할 때의 가격이에요. 선이 빨간색이면 그 기간 동안 올랐고, 파란색이면 내렸다는 뜻이에요.</span></p>
    </section>
    <section class="card">
      <h3>내가 가진 ${c.name} 주식</h3>
      ${h ? `<div class="kv-grid">
        <div><span class="label">보유 수량</span><b>${live('hq', id)}</b></div>
        <div><span class="label">${term('평균 구매가')}</span><b>${live('avg', id)}</b></div>
        <div><span class="label">${term('평가 금액')}</span><b>${live('hval', id)}</b></div>
        <div><span class="label">${term('수익')} / ${term('손실')}</span><b>${live('hpl', id, 'pl')} ${live('hplr', id, 'pl small')}</b></div>
      </div>` : `<p class="muted">아직 이 회사의 주식을 가지고 있지 않아요. "사기" 버튼을 눌러 이 회사의 ${term('주주')}가 되어 보세요.</p>`}
    </section>
    <section class="card">
      <h3>회사 정보</h3>
      <p class="desc">${c.desc}</p>
      <div class="info-rows">
        <div class="info-row"><span class="label">하는 일</span><div><b>${c.sector}</b></div></div>
        <div class="info-row"><span class="label">${term('변동 정도')}</span><div><b>${volBadge(c.vol)} ${VOL_INFO[c.vol].label}</b><span class="muted small">${VOL_INFO[c.vol].desc}</span></div></div>
        <div class="info-row"><span class="label">${term('배당금')}</span><div>${c.div ? `<b>일주일마다 1주에 약 ${live('divPer', id)} 코인</b><span class="muted small">다음 배당금: ${live('divIn')}</span>` : `<b>주지 않아요</b><span class="muted small">번 돈을 회사를 키우는 데 써요.</span>`}</div></div>
        <div class="info-row"><span class="label">어제 마감 가격</span><div><b>${live('prev', id)}</b></div></div>
      </div>
    </section>
    <section class="card">
      <h3 class="sec-title">${icon('news')} ${c.name} 관련 소식</h3>
      <div class="news-list" data-newslist="${id}" data-limit="5">${newsList(id, 5)}</div>
    </section>`;
  },

  assets() {
    const rg = ui.range.assets;
    return `
    <section class="card asset-hero">
      <span class="label">내 ${term('총자산')}</span>
      <div class="big-num">${live('total')}</div>
      <div class="pl-line">${live('profit', '', 'pill')}${live('profitRate', '', 'pill')}</div>
      <div class="kv-grid">
        <div><span class="label">처음 받은 돈</span><b>${C(E.S.start)}</b></div>
        <div><span class="label">${term('현금')}</span><b>${live('cash')}</b></div>
        <div><span class="label">주식 ${term('평가 금액')}</span><b>${live('stockVal')}</b></div>
        <div><span class="label">은행 ${term('예금')}</span><b>${live('bankBal')}</b></div>
        <div><span class="label">${term('수익률')}</span><b>${live('profitRate', '', 'pl')}</b></div>
      </div>
      <p class="formula">${term('총자산')} = ${term('현금')} + 주식 ${term('평가 금액')} + 은행 ${term('예금')}</p>
    </section>
    <section class="card">
      <div class="row-between wrap-gap"><h3>총자산 그래프</h3>${rangeSeg('assets', rg)}</div>
      <div class="chart" data-chart="assets" data-range="${rg}" data-rgroup="assets"></div>
      <p class="period" data-live="period" data-id="__assets" data-range="${rg}" data-rgroup="assets"></p>
    </section>
    <section class="card">
      <h3>내 돈은 어디에 있을까요?</h3>
      <div class="donut-wrap" data-chart="donut"></div>
      ${spreadTip()}
    </section>
    <div class="two-btns">
      <a class="btn ghost big" href="#holdings">${icon('briefcase')} 보유 주식 보기</a>
      <a class="btn ghost big" href="#history">${icon('list')} 거래 기록 보기</a>
      <a class="btn ghost big" href="#bank">${icon('bank')} 은행 가기</a>
    </div>`;
  },

  holdings() {
    const ids = Object.keys(E.S.hold);
    if (!ids.length) return `<section class="card empty">${pic('empty')}<h3>아직 가지고 있는 주식이 없어요</h3><p class="muted">주식 시장에서 마음에 드는 회사를 찾아 주식을 사 보세요.</p><a class="btn primary big" href="#market">${icon('market')} 주식 시장 가기</a></section>`;
    return `
    <section class="card"><div class="kv-grid">
      <div><span class="label">가진 회사 수</span><b>${ids.length}곳</b></div>
      <div><span class="label">주식 ${term('평가 금액')}</span><b>${live('stockVal')}</b></div>
      <div class="span2"><span class="label">아직 팔지 않은 주식의 ${term('수익')} / ${term('손실')}</span><b>${live('unreal', '', 'pl')}</b></div>
    </div></section>
    ${ids.map(id => { const c = BY_ID[id]; return `<section class="card hold-card">
      <a class="hc-top" href="#stock-${id}">${logo(c, 44)}<span class="hc-name"><b>${c.name}</b><span class="muted small">${live('hq', id)} 가지고 있어요</span></span><span class="hc-pl">${live('hpl', id, 'pl')}${live('hplr', id, 'pl small')}</span></a>
      <div class="kv-grid four">
        <div><span class="label">${term('평균 구매가')}</span><b>${live('avg', id)}</b></div>
        <div><span class="label">지금 가격</span><b>${live('price', id)}</b></div>
        <div><span class="label">${term('평가 금액')}</span><b>${live('hval', id)}</b></div>
        <div><span class="label">어제보다</span><b>${live('chg', id, 'chg')}</b></div>
      </div>
      <div class="two-btns"><button type="button" class="btn buy" data-act="buy" data-id="${id}">더 사기</button><button type="button" class="btn sell" data-act="sell" data-id="${id}">팔기</button></div>
    </section>`; }).join('')}`;
  },

  history() {
    const f = ui.histFilter, all = E.S.trades;
    const BANKT = ['dep', 'wd', 'int'];
    const items = all.filter(t => f === 'all' || t.t === f || (f === 'bank' && BANKT.includes(t.t)));
    const real = all.filter(t => t.t === 'sell').reduce((s, t) => s + t.pl, 0);
    const divs = all.filter(t => t.t === 'div').reduce((s, t) => s + t.amt, 0);
    const fl = [['all', '전체'], ['buy', '매수'], ['sell', '매도'], ['div', '배당금'], ['bank', '은행']];
    return `
    <section class="card"><div class="kv-grid">
      <div><span class="label">판 주식의 ${term('수익')} / ${term('손실')}</span><b class="pl ${dirOf(real)}">${CS(real)}</b></div>
      <div><span class="label">받은 ${term('배당금')}</span><b>${C(divs)}</b></div>
      <div><span class="label">${term('매수')} 횟수</span><b>${all.filter(t => t.t === 'buy').length}번</b></div>
      <div><span class="label">${term('매도')} 횟수</span><b>${all.filter(t => t.t === 'sell').length}번</b></div>
      <div><span class="label">은행에서 받은 ${term('이자')}</span><b>${C(E.S.bank.earned)}</b></div>
      <div><span class="label">은행 ${term('예금')}</span><b>${live('bankBal')}</b></div>
    </div></section>
    <div class="seg">${fl.map(([k, l]) => `<button type="button" class="${f === k ? 'on' : ''}" data-act="hist" data-f="${k}">${l}</button>`).join('')}</div>
    <section class="card list-card">${items.length ? items.map(tradeRow).join('') : `<div class="empty">${pic('empty')}<p class="muted">아직 기록이 없어요. 주식을 사거나 팔면 여기에 적혀요.</p><a class="btn primary" href="#market">주식 시장 가기</a></div>`}</section>`;
  },

  learn() {
    const tab = ui.learnTab;
    const tabs = [['lessons', '주식 이야기'], ['terms', '용어 사전'], ['quiz', '퀴즈']];
    let inner = '';
    if (tab === 'lessons') {
      inner = `<div class="lesson-grid">${LESSONS.map((l, i) => `<button type="button" class="lesson-card card" data-act="lesson" data-i="${i}">${pic(l.pic)}<span class="lc-title"><span class="lc-no">${i + 1}</span><b>${l.title}</b>${E.S.lessonsRead[l.id] ? `<span class="read">${icon('check')} 읽었어요</span>` : ''}</span></button>`).join('')}</div>`;
    } else if (tab === 'terms') {
      inner = `<div class="term-grid">${GLOSSARY.map(g => `<div class="card term-card"><h4>${g.t}</h4><p>${g.d}</p><p class="ex">예: ${g.ex}</p></div>`).join('')}</div>`;
    } else inner = quizHTML();
    return `<div class="seg big-seg">${tabs.map(([k, l]) => `<button type="button" class="${tab === k ? 'on' : ''}" data-act="ltab" data-tab="${k}">${l}</button>`).join('')}</div>${inner}`;
  },

  settings() {
    const s = E.S.settings;
    const seg = (act, cur, opts) => `<div class="seg">${opts.map(([v, l]) => `<button type="button" class="${String(cur) === String(v) ? 'on' : ''}" data-act="${act}" data-v="${v}">${l}</button>`).join('')}</div>`;
    const sw = (key, on) => `<button type="button" class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-act="toggle" data-key="${key}"><span></span></button>`;
    const row = (ic, title, sub, ctrl) => `<div class="set-row"><span class="set-ic">${icon(ic)}</span><div class="set-txt"><b>${title}</b><span class="muted small">${sub}</span></div><div class="set-ctrl">${ctrl}</div></div>`;
    return `
    <section class="card set-list">
      ${row('user', '내 이름', '안내 창과 알림에서 이름을 불러 줘요.', `<form class="name-form" data-form="name"><input id="nameInput" maxlength="10" value="${esc(s.name)}" placeholder="이름 쓰기" aria-label="내 이름"><button class="btn primary sm" type="submit">저장</button></form>`)}
      ${row('speed', '게임 속도', '빠를수록 게임 속 시간이 빨리 흘러요.', seg('speed', s.speed, [['slow', '느리게'], ['normal', '보통'], ['fast', '빠르게']]))}
      ${row('pause', '시간 멈추기', '켜면 주가가 움직이지 않아요. 천천히 생각할 때 써요.', sw('paused', s.paused))}
      ${row('news', '뉴스 알림 띄우기', '켜면 새 소식이 올 때 화면 위에 잠깐 보여 줘요. 꺼 두면 뉴스 버튼에서만 볼 수 있어요.', sw('newsPop', s.newsPop))}
      ${row(s.sound ? 'sound' : 'mute', '소리 효과', '사고팔 때와 소식이 올 때 작은 소리가 나요.', sw('sound', s.sound))}
      ${row('text', '글자 크기', '글씨가 작으면 크게 바꿔 보세요.', seg('big', s.big ? 1 : 0, [[0, '보통'], [1, '크게']]))}
      ${row(s.dark ? 'moon' : 'sun', '화면 밝기', '자동은 기기 설정을 따라가요. 밤에는 어두운 화면이 눈이 편해요.', seg('dark', s.dark == null ? 'auto' : s.dark ? 1 : 0, [['auto', '자동'], [0, '밝게'], [1, '어둡게']]))}
    </section>
    <section class="card set-list">
      ${row('info', '안내 창 다시 보기', '각 화면에 처음 들어갈 때 나오는 안내 창과 가로 화면 안내를 다시 보여 줘요.', `<button type="button" class="btn ghost sm" data-act="resetGuides">다시 보기</button>`)}
      ${row('refresh', '처음부터 다시 하기', '모든 기록을 지우고 100,000 코인으로 다시 시작해요.', `<button type="button" class="btn danger sm" data-act="resetGame">다시 시작</button>`)}
    </section>
    <section class="card note">${icon('alert')}<div><b>알아 두세요</b><p>이 게임의 코인은 진짜 돈이 아니에요. 회사와 뉴스도 모두 공부를 위해 만든 이야기예요. 게임 기록은 지금 쓰는 기기의 브라우저에 저장돼요.</p></div></section>`;
  },
};

const TITLES = { home: '주식창', news: '뉴스', bank: '은행', market: '주식 시장', stock: '주식 상세 정보', assets: '내 자산', holdings: '보유 주식', history: '거래 기록', learn: '주식 공부하기', settings: '설정' };
const PARENT = { stock: 'market', holdings: 'assets', history: 'assets' };

function tradeRow(t) {
  if (!t.id) {
    const lab = { dep: '입금', wd: '출금', int: '이자' }[t.t];
    const sub = t.t === 'int' ? '은행이 이자를 줬어요' : t.t === 'dep' ? '지갑에서 은행으로 옮겼어요' : '은행에서 지갑으로 꺼냈어요';
    return `<a class="trade-row" href="#bank"><span class="badge ${t.t}">${lab}</span>${BANK_LOGO(36)}
    <span class="tr-main"><b>은행</b><span class="muted small">${E.clockText(t.tick)} · ${sub}</span></span>
    <span class="tr-amt"><b>${t.t === 'wd' ? '-' : '+'}${fmt(t.amt)}</b><span class="muted small">예금 ${fmt(t.bal)} 코인</span></span></a>`;
  }
  const c = BY_ID[t.id];
  const lab = { buy: '매수', sell: '매도', div: '배당금' }[t.t];
  const sub = t.t === 'div' ? `${fmt(t.q)}주 × 1주당 ${fmt(t.p)} 코인` : `${fmt(t.q)}주 × ${fmt(t.p)} 코인`;
  const right = t.t === 'sell' ? `<span class="pl ${dirOf(t.pl)} small">${t.pl >= 0 ? '수익' : '손실'} ${CS(t.pl)}</span>` : `<span class="muted small">${t.t === 'buy' ? '현금을 썼어요' : '현금이 들어왔어요'}</span>`;
  return `<a class="trade-row" href="#stock-${t.id}"><span class="badge ${t.t}">${lab}</span>${logo(c, 36)}
    <span class="tr-main"><b>${c.name}</b><span class="muted small">${E.clockText(t.tick)} · ${sub}</span></span>
    <span class="tr-amt"><b>${t.t === 'buy' ? '-' : '+'}${fmt(t.amt)}</b>${right}</span></a>`;
}

function donutHTML() {
  const ids = Object.keys(E.S.hold);
  const total = E.totalAssets() || 1;
  const parts = [{ v: E.S.cash, color: '#A7B0C0', label: '현금' }, { v: E.S.bank.bal, color: '#C9A227', label: '은행 예금' }, ...ids.map(id => ({ v: E.S.hold[id].q * E.price(id), color: BY_ID[id].color, label: BY_ID[id].name }))];
  return `<div class="donut-box">${donut(parts)}<div class="donut-center"><span class="muted small">총자산</span><b>${fmt(total)}</b></div></div>
    <ul class="legend">${parts.map(p => `<li><i style="background:${p.color}"></i><span>${p.label}</span><b>${((p.v / total) * 100).toFixed(1)}%</b></li>`).join('')}</ul>`;
}

function spreadTip() {
  const ids = Object.keys(E.S.hold);
  if (!ids.length) return `<p class="tip-box">${icon('bulb')}<span>아직 주식이 없어서 모두 현금이에요. 주식 시장에서 마음에 드는 회사를 찾아보세요.</span></p>`;
  const sv = E.stockValue() || 1;
  const top = ids.reduce((a, b) => (E.S.hold[a].q * E.price(a) >= E.S.hold[b].q * E.price(b) ? a : b));
  const share = (E.S.hold[top].q * E.price(top)) / sv;
  if (ids.length === 1 || share > 0.6) return `<p class="tip-box warn">${icon('bulb')}<span>주식이 ${BY_ID[top].name}에 많이 몰려 있어요. 여러 회사에 나눠 담는 ${term('분산 투자')}를 생각해 봐요.</span></p>`;
  return `<p class="tip-box ok">${icon('check')}<span>여러 회사에 잘 나눠서 투자하고 있어요. 멋진 ${term('분산 투자')}예요.</span></p>`;
}

function quizHTML() {
  const q = ui.quiz;
  if (!q) return `<section class="card quiz-intro">${owl('owl-lg')}<div><h3>주식 퀴즈 ${QUIZ.length}문제</h3><p class="muted">배운 내용을 확인해 봐요. 틀려도 괜찮아요. 설명을 읽으면 더 잘 알게 돼요.</p><p>${icon('trophy')} 나의 최고 점수: <b>${E.S.quizBest} / ${QUIZ.length}</b></p><button type="button" class="btn primary big" data-act="quizStart">퀴즈 시작하기</button></div></section>`;
  if (q.i >= QUIZ.length) {
    const msg = q.score === QUIZ.length ? '모두 맞혔어요! 주식 박사예요.' : q.score >= QUIZ.length * 0.7 ? '아주 잘했어요! 조금만 더 공부하면 완벽해요.' : '괜찮아요. 주식 이야기를 읽고 다시 도전해 봐요.';
    return `<section class="card quiz-intro">${owl('owl-lg')}<div><h3>퀴즈 끝!</h3><p class="quiz-score"><b>${q.score}</b> / ${QUIZ.length}</p><p>${msg}</p><div class="two-btns"><button type="button" class="btn primary" data-act="quizStart">다시 풀기</button><button type="button" class="btn ghost" data-act="ltab" data-tab="lessons">주식 이야기 읽기</button></div></div></section>`;
  }
  const item = QUIZ[q.i];
  const done = q.ans !== null;
  return `<section class="card quiz">
    <div class="quiz-top"><span class="muted">문제 ${q.i + 1} / ${QUIZ.length}</span><span class="muted">맞힌 문제 ${q.score}개</span></div>
    <div class="progress"><i style="width:${(q.i / QUIZ.length) * 100}%"></i></div>
    <h3 class="quiz-q">${item.q}</h3>
    <div class="quiz-opts">${item.opts.map((o, k) => `<button type="button" class="opt ${done ? (k === item.a ? 'right' : k === q.ans ? 'wrong' : '') : ''}" data-act="quizAns" data-o="${k}" ${done ? 'disabled' : ''}><span class="opt-no">${k + 1}</span>${o}${done && k === item.a ? icon('check') : ''}${done && k === q.ans && k !== item.a ? icon('close') : ''}</button>`).join('')}</div>
    ${done ? `<div class="ex-box ${q.ans === item.a ? 'ok' : 'bad'}">${icon(q.ans === item.a ? 'check' : 'info')}<div><b>${q.ans === item.a ? '정답이에요!' : '아쉬워요. 정답을 확인해 봐요.'}</b><p>${item.ex}</p></div></div>
    <button type="button" class="btn primary big full" data-act="quizNext">${q.i + 1 < QUIZ.length ? '다음 문제' : '결과 보기'}</button>` : ''}
  </section>`;
}

// ---------- 사기 / 팔기 창 ----------
function tradeSheet(kind, id) {
  const c = BY_ID[id];
  const isBuy = kind === 'buy';
  if (!isBuy && !E.S.hold[id]) {
    sfx('no');
    return alertBox('아직 팔 주식이 없어요', `${c.name} 주식을 가지고 있지 않아서 팔 수 없어요. 먼저 "사기" 버튼으로 주식을 사야 팔 수 있어요.`);
  }
  const maxQ = () => (isBuy ? E.maxBuy(id) : E.S.hold[id]?.q || 0);
  let qty = maxQ() > 0 ? 1 : 0;
  const m = modal({
    cls: 'sheet',
    title: `${c.name} 주식 ${isBuy ? '사기' : '팔기'} <span class="title-sub">${isBuy ? term('매수') : term('매도')}</span>`,
    body: `
      <div class="trade-head">${logo(c, 48)}<div class="th-name"><b>${c.name}</b><span class="muted small">지금 1주 가격</span></div><div class="th-price"><b>${live('price', id)}</b>${live('chg', id, 'chg')}</div></div>
      ${isBuy ? '' : `<div class="kv-grid compact"><div><span class="label">가지고 있는 주식</span><b>${live('hq', id)}</b></div><div><span class="label">${term('평균 구매가')}</span><b>${live('avg', id)}</b></div></div>`}
      <label class="label" for="qtyInput">몇 주를 ${isBuy ? '살까요' : '팔까요'}?</label>
      <div class="stepper">
        <button type="button" class="step" data-q="-1" aria-label="1주 빼기">${icon('minus')}</button>
        <div class="qty-box"><input id="qtyInput" type="number" inputmode="numeric" min="0" step="1" value="${qty}"><span>주</span></div>
        <button type="button" class="step" data-q="1" aria-label="1주 더하기">${icon('plus')}</button>
      </div>
      <div class="chips"><button type="button" data-qs="1">1주</button><button type="button" data-qa="5">+5주</button><button type="button" data-qa="10">+10주</button><button type="button" data-qs="half">절반</button><button type="button" data-qs="max">${isBuy ? '최대' : '전부'}</button></div>
      <div class="summary">
        <div><span>${isBuy ? '필요한 돈' : '받을 돈'}</span><b data-s="amt"></b></div>
        <div><span>지금 내 ${term('현금')}</span><b>${live('cash')}</b></div>
        <div><span>${isBuy ? '사고 난 뒤 남는 현금' : '팔고 난 뒤 현금'}</span><b data-s="left"></b></div>
        ${isBuy ? '' : `<div class="sum-pl"><span>산 가격과 비교하면</span><b data-s="pl"></b></div>`}
      </div>
      <p class="sheet-warn" data-s="warn" hidden></p>`,
    buttons: [{ label: '취소', kind: 'ghost' }, { label: isBuy ? '사기' : '팔기', kind: isBuy ? 'buy' : 'sell', id: 'go', onClick: () => { confirmTrade(kind, id, qty, m); return false; } }],
    onTick: () => update(false),
  });
  const input = $('#qtyInput', m.el);
  const S_ = k => $(`[data-s="${k}"]`, m.el);
  function update(fromInput) {
    if (!fromInput) input.value = qty;
    const p = E.price(id), max = maxQ(), amt = qty * p;
    S_('amt').innerHTML = C(amt);
    let warn = '';
    if (isBuy) {
      S_('left').innerHTML = C(E.S.cash - amt);
      S_('left').classList.toggle('down', E.S.cash - amt < 0);
      if (max < 1) warn = '현금이 부족해서 1주도 살 수 없어요. 주식을 팔거나 배당금을 기다려 보세요.';
      else if (qty > max) warn = `현금이 부족해요. 지금은 최대 ${fmt(max)}주까지 살 수 있어요.`;
    } else {
      S_('left').innerHTML = C(E.S.cash + amt);
      const pl = Math.round(amt - E.avgPrice(id) * qty), d = dirOf(pl);
      S_('pl').innerHTML = qty ? `${CS(pl)} ${d === 'up' ? '수익' : d === 'down' ? '손실' : '(같아요)'}` : '-';
      S_('pl').className = 'pl ' + d;
      if (qty > max) warn = `가지고 있는 주식은 ${fmt(max)}주예요.`;
    }
    if (qty < 1 && !warn) warn = '1주 이상을 골라 주세요.';
    const w = S_('warn'); w.textContent = warn; w.hidden = !warn;
    $('[data-bid="go"]', m.el).disabled = qty < 1 || qty > max;
  }
  const setQ = v => { qty = Math.max(0, Math.floor(Number(v) || 0)); update(false); };
  m.el.addEventListener('click', e => {
    const b = e.target.closest('[data-q],[data-qs],[data-qa]');
    if (!b) return;
    const max = maxQ();
    if (b.dataset.q) setQ(Math.min(Math.max(qty + Number(b.dataset.q), 0), Math.max(max, 0)));
    else if (b.dataset.qa) setQ(Math.min(qty + Number(b.dataset.qa), max));
    else if (b.dataset.qs === 'max') setQ(max);
    else if (b.dataset.qs === 'half') setQ(Math.max(Math.min(1, max), Math.floor(max / 2)));
    else setQ(Math.min(Number(b.dataset.qs), max));
  });
  input.addEventListener('input', () => { qty = Math.max(0, Math.floor(Number(input.value) || 0)); update(true); });
  input.addEventListener('blur', () => update(false));
  update(false);
  showGuide(kind);
}

function confirmTrade(kind, id, qty, sheet) {
  const c = BY_ID[id], isBuy = kind === 'buy';
  const p = E.price(id), amt = p * qty;
  const pl = isBuy ? 0 : Math.round(amt - E.avgPrice(id) * qty);
  const plLine = isBuy ? '' : `<p>산 가격과 비교하면 <b class="pl ${dirOf(pl)}">${CS(pl)} ${pl > 0 ? '수익' : pl < 0 ? '손실' : '(같아요)'}</b>이에요.</p>`;
  modal({
    cls: 'small confirm',
    title: isBuy ? '정말 살까요?' : '정말 팔까요?',
    body: `<div class="confirm-head">${logo(c, 52)}<div><b>${c.name}</b><span class="muted small">${fmt(qty)}주</span></div></div>
      <p><b>${c.name}</b> 주식 <b>${fmt(qty)}주</b>를 1주에 <b>${fmt(p)} 코인</b>씩, 모두 <b>${fmt(amt)} 코인</b>에 ${isBuy ? '살까요' : '팔까요'}?</p>${plLine}
      <p class="muted small">"${isBuy ? '네, 살게요' : '네, 팔게요'}"를 누르면 위의 가격으로 바로 ${isBuy ? '사요' : '팔아요'}.</p>`,
    buttons: [{ label: '아니요', kind: 'ghost' }, {
      label: isBuy ? '네, 살게요' : '네, 팔게요', kind: isBuy ? 'buy' : 'sell', onClick: () => {
        const r = isBuy ? E.buy(id, qty, p) : E.sell(id, qty, p);
        if (!r.ok) { sfx('no'); alertBox('거래할 수 없어요', r.msg); return; }
        if (sheet) sheet.close();
        sfx(isBuy ? 'buy' : 'sell');
        doneTrade(kind, id, qty, amt, r.pl);
      },
    }],
  });
}

function doneTrade(kind, id, qty, amt, pl) {
  const c = BY_ID[id], isBuy = kind === 'buy', h = E.S.hold[id];
  const plText = isBuy ? '' : `<p>이번 거래의 결과: <b class="pl ${dirOf(pl)}">${CS(pl)} ${pl > 0 ? '수익' : pl < 0 ? '손실' : ''}</b></p><p class="muted small">${pl > 0 ? '산 가격보다 비싸게 팔아서 돈을 벌었어요.' : pl < 0 ? '산 가격보다 싸게 팔아서 돈을 잃었어요. 왜 내렸는지 뉴스를 확인해 봐요.' : '산 가격과 같은 가격에 팔았어요.'}</p>`;
  modal({
    cls: 'small done',
    title: isBuy ? '주식을 샀어요' : '주식을 팔았어요',
    body: `<div class="done-mark ${isBuy ? 'buy' : 'sell'}">${icon('check')}</div>
      <p class="center"><b>${c.name}</b> 주식 <b>${fmt(qty)}주</b>를 ${isBuy ? '샀어요' : '팔았어요'}. (${isBuy ? '쓴 돈' : '받은 돈'} ${fmt(amt)} 코인)</p>
      ${plText}
      <div class="kv-grid compact"><div><span class="label">이제 가진 주식</span><b>${fmt(h ? h.q : 0)}주</b></div><div><span class="label">남은 ${term('현금')}</span><b>${live('cash')}</b></div></div>`,
    buttons: [{ label: '보유 주식 보기', kind: 'ghost', onClick: () => go('holdings') }, { label: '확인', kind: 'primary' }],
  });
}

function openLesson(i) {
  const l = LESSONS[i];
  E.S.lessonsRead[l.id] = true; E.save();
  const btns = [];
  if (i > 0) btns.push({ label: '이전 이야기', kind: 'ghost', onClick: () => { setTimeout(() => openLesson(i - 1), 10); } });
  btns.push(i < LESSONS.length - 1 ? { label: '다음 이야기', kind: 'primary', onClick: () => { setTimeout(() => openLesson(i + 1), 10); } } : { label: '다 읽었어요', kind: 'primary' });
  modal({ cls: 'lesson', title: `${i + 1}. ${l.title}`, body: `<div class="lesson-pic">${pic(l.pic)}</div>${l.body.map(t => `<p>${t}</p>`).join('')}<p class="muted small">${i + 1} / ${LESSONS.length}</p>`, buttons: btns,
    onClose: () => { if (cur.name === 'learn' && ui.learnTab === 'lessons') render(true); } });
}

// ---------- 화면 이동 ----------
const view = $('#view');
function go(name) { location.hash = '#' + (name === 'settings' ? 'options' : name); }
function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, '')) || 'home';
  let [n, id] = h.startsWith('stock-') ? ['stock', h.slice(6)] : h.split('/');
  if (n === 'options') n = 'settings';
  return SCREENS[n] ? { name: n, id: id || null } : { name: 'home', id: null };
}
function render(keepScroll = false) {
  cur = parseHash();
  if (cur.name === 'stock' && !BY_ID[cur.id]) { go('market'); return; }
  const y = window.scrollY;
  view.innerHTML = SCREENS[cur.name](cur.id);
  view.classList.toggle('wide', cur.name === 'home');
  if (cur.name === 'news') E.markNewsRead();
  if (cur.name === 'home') updateOrder();
  if (cur.name === 'bank') updateBank();
  updateBadge();
  $('#title').textContent = cur.name === 'stock' ? BY_ID[cur.id].name : TITLES[cur.name];
  document.title = `${TITLES[cur.name]} - 어린이 주식 놀이터`;
  $('#backBtn').hidden = !PARENT[cur.name];
  for (const a of $$('[data-nav]')) a.classList.toggle('on', a.dataset.nav.split(' ').includes(cur.name));
  refresh(document.body);
  window.scrollTo(0, keepScroll ? y : 0);
  if (!keepScroll) showGuide(cur.name);
}

function updateNewsLists() {
  for (const el of $$('[data-newslist]')) el.innerHTML = el.dataset.newslist === '__all' ? newsScreenList() : newsList(el.dataset.newslist || null, +el.dataset.limit || 5);
  for (const el of $$('[data-newsticker]')) el.innerHTML = tickerHTML();
  refresh(document.body);
}

function applySettings() {
  const s = E.S.settings;
  document.documentElement.classList.toggle('big', !!s.big);
  if (s.dark === null || s.dark === undefined) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = s.dark ? 'dark' : 'light';
  document.body.classList.toggle('paused', !!s.paused);
  document.body.classList.toggle('portrait-ok', !!s.portraitOk);
  const pb = $('#pauseBtn');
  pb.innerHTML = s.paused ? `${icon('play')}<span>계속</span>` : `${icon('pause')}<span>멈춤</span>`;
  pb.setAttribute('aria-label', s.paused ? '시간 다시 흐르게 하기' : '시간 멈추기');
  pb.classList.toggle('on', !!s.paused);
  $('#dayIcon').innerHTML = icon(E.hour() >= 6 && E.hour() < 18 ? 'sun' : 'moon');
}

// ---------- 클릭 처리 ----------
document.addEventListener('click', e => {
  const t = e.target.closest('.term');
  if (t) { e.preventDefault(); openTerm(t.dataset.term); return; }
  if (e.target.closest('[data-closeall]')) { [...stack].forEach(m => m.close()); }
  const a = e.target.closest('[data-act]');
  if (!a || a.disabled) return;
  const act = a.dataset.act, s = E.S.settings;
  switch (act) {
    case 'buy': case 'sell': tradeSheet(act, a.dataset.id); break;
    case 'news': openNews(+a.dataset.nid); break;
    case 'goNews': go('news'); break;
    case 'nfilter': ui.newsFilter = a.dataset.f; render(true); break;
    case 'tsel': ui.term.id = a.dataset.id; ui.term.qty = termMax() > 0 ? 1 : 0; render(true); break;
    case 'tside': ui.term.side = a.dataset.v; ui.term.qty = termMax() > 0 ? 1 : 0; setOrderPanel(); if (a.dataset.v === 'sell') showGuide('sell'); else showGuide('buy'); break;
    case 'tgo': { const q = ui.term.qty; if (q >= 1 && q <= termMax()) confirmTrade(ui.term.side, ui.term.id, q, null); break; }
    case 'bankTab': ui.bankTab = a.dataset.v; ui.bankAmt = 0; render(true); break;
    case 'bankAdd': {
      const v = a.dataset.v, max = ui.bankTab === 'dep' ? E.S.cash : E.S.bank.bal;
      ui.bankAmt = v === 'all' ? max : v === '0' ? 0 : Math.min(max, ui.bankAmt + Number(v));
      updateBank(); break;
    }
    case 'bankGo': {
      const dep = ui.bankTab === 'dep', amt = ui.bankAmt;
      modal({ cls: 'small confirm', title: dep ? '은행에 맡길까요?' : '은행에서 찾을까요?',
        body: `<div class="confirm-head">${BANK_LOGO(52)}<div><b>은행</b><span class="muted small">${dep ? '예금하기' : '찾기'}</span></div></div><p><b>${fmt(amt)} 코인</b>을 ${dep ? '지갑에서 은행으로 옮길까요? 맡긴 돈에는 매일 이자가 붙어요.' : '은행에서 지갑으로 꺼낼까요? 꺼낸 돈으로 주식을 살 수 있어요.'}</p>`,
        buttons: [{ label: '아니요', kind: 'ghost' }, { label: dep ? '네, 맡길게요' : '네, 찾을게요', kind: 'primary', onClick: () => {
          const r = dep ? E.deposit(amt) : E.withdraw(amt);
          if (!r.ok) { sfx('no'); alertBox('할 수 없어요', r.msg); return; }
          ui.bankAmt = 0; sfx('coin'); render(true);
          toast(`${coin()}<span>${fmt(amt)} 코인을 ${dep ? '은행에 맡겼어요' : '은행에서 찾았어요'}. 은행 예금: ${fmt(E.S.bank.bal)} 코인</span>`, { kind: 'gold', ms: 2600 });
        } }] });
      break;
    }
    case 'sort': ui.sort = a.dataset.sort; render(true); break;
    case 'hist': ui.histFilter = a.dataset.f; render(true); break;
    case 'ltab': ui.learnTab = a.dataset.tab; if (a.dataset.tab !== 'quiz') ui.quiz = null; render(true); break;
    case 'lesson': openLesson(+a.dataset.i); break;
    case 'quizStart': ui.quiz = { i: 0, score: 0, ans: null }; ui.learnTab = 'quiz'; render(true); break;
    case 'quizAns': {
      const q = ui.quiz; if (!q || q.ans !== null) break;
      q.ans = +a.dataset.o;
      if (q.ans === QUIZ[q.i].a) { q.score++; sfx('ok'); } else sfx('no');
      render(true); break;
    }
    case 'quizNext': {
      const q = ui.quiz; if (!q) break;
      q.i++; q.ans = null;
      if (q.i >= QUIZ.length && q.score > E.S.quizBest) { E.S.quizBest = q.score; E.save(); }
      render(true); break;
    }
    case 'range': {
      const g = a.dataset.group, r = a.dataset.range;
      ui.range[g] = r;
      if (g === 'term') { render(true); break; }
      for (const b of $$(`[data-act="range"][data-group="${g}"]`)) { b.classList.toggle('on', b.dataset.range === r); b.setAttribute('aria-selected', b.dataset.range === r); }
      for (const el of $$(`[data-rgroup="${g}"]`)) { el.dataset.range = r; el._hi = null; }
      refresh(view); break;
    }
    case 'speed': s.speed = a.dataset.v; E.save(); schedule(); render(true); toast(`${icon('speed')}<span>게임 속도를 "${a.textContent}"(으)로 바꿨어요.</span>`, { ms: 2200 }); break;
    case 'big': s.big = a.dataset.v === '1'; E.save(); applySettings(); render(true); break;
    case 'dark': s.dark = a.dataset.v === 'auto' ? null : a.dataset.v === '1'; E.save(); applySettings(); render(true); break;
    case 'toggle': s[a.dataset.key] = !s[a.dataset.key]; E.save(); applySettings(); render(true); if (a.dataset.key === 'sound' && s.sound) sfx('ok'); break;
    case 'resetGuides': E.S.seen = {}; s.portraitOk = false; E.save(); applySettings(); toast(`${icon('info')}<span>각 화면에 들어가면 안내 창을 다시 보여 줄게요.</span>`, { ms: 2600 }); break;
    case 'resetGame':
      modal({ cls: 'small', title: '처음부터 다시 할까요?', body: `<div class="guide-body">${owl('owl-md')}<div><p>지금까지의 주식, 현금, 거래 기록이 모두 지워지고 100,000 코인으로 다시 시작해요.</p><p class="muted small">설정(속도, 글자 크기 등)은 그대로 남아요.</p></div></div>`,
        buttons: [{ label: '아니요', kind: 'ghost' }, { label: '네, 다시 할게요', kind: 'danger', onClick: () => { E.reset(); } }] });
      break;
  }
});

document.addEventListener('click', e => {
  const b = e.target.closest('[data-tq],[data-tqs],[data-tqa]');
  if (!b) return;
  const max = termMax(), q = ui.term.qty;
  if (b.dataset.tq) ui.term.qty = Math.min(Math.max(q + Number(b.dataset.tq), 0), Math.max(max, 0));
  else if (b.dataset.tqa) ui.term.qty = Math.min(q + Number(b.dataset.tqa), max);
  else if (b.dataset.tqs === 'max') ui.term.qty = max;
  else if (b.dataset.tqs === 'half') ui.term.qty = Math.max(Math.min(1, max), Math.floor(max / 2));
  else ui.term.qty = Math.min(1, max);
  updateOrder();
});
document.addEventListener('input', e => {
  if (e.target.id === 'tQty') { ui.term.qty = Math.max(0, Math.floor(Number(e.target.value) || 0)); updateOrder(true); }
  if (e.target.id === 'bankAmt') { ui.bankAmt = Math.max(0, Math.floor(Number(e.target.value) || 0)); updateBank(true); }
});

document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form="name"]');
  if (!f) return;
  e.preventDefault();
  E.S.settings.name = $('#nameInput').value.trim().slice(0, 10);
  E.save();
  sfx('ok');
  toast(`${icon('check')}<span>${E.S.settings.name ? `"${esc(E.S.settings.name)}" 이름을 저장했어요.` : '이름을 지웠어요.'}</span>`, { ms: 2200 });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close();
});

$('#backBtn').addEventListener('click', () => {
  if (trail.length) { backing = true; location.hash = trail.pop(); } else go(PARENT[cur.name] || 'home');
});
$('#pauseBtn').addEventListener('click', () => {
  E.S.settings.paused = !E.S.settings.paused; E.save(); applySettings();
  if (cur.name === 'settings') render(true);
  toast(`${icon(E.S.settings.paused ? 'pause' : 'play')}<span>${E.S.settings.paused ? '시간을 멈췄어요. 천천히 생각해 보세요.' : '시간이 다시 흘러요.'}</span>`, { ms: 2000 });
});
window.addEventListener('hashchange', () => {
  if (!backing && lastHash !== location.hash) { trail.push(lastHash || '#home'); if (trail.length > 30) trail.shift(); }
  backing = false; lastHash = location.hash;
  [...stack].forEach(m => m.close()); render();
});
let rT = null;
window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => refresh(document.body), 150); });

// ---------- 게임 시간 ----------
let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(loop, E.SPEEDS[E.S.settings.speed] || 1500); }
function loop() {
  try { if (!E.S.settings.paused && !document.hidden) E.step(); } catch (err) { console.error(err); }
  schedule();
}

E.on('tick', () => {
  if (cur.name === 'home') addTape(ui.term.id);
  refresh(document.body);
  if (cur.name === 'home') updateOrder();
  if (cur.name === 'bank') updateBank();
  for (const m of stack) m.onTick && m.onTick();
  $('#dayIcon').innerHTML = icon(E.hour() >= 6 && E.hour() < 18 ? 'sun' : 'moon');
});
E.on('news', n => {
  if (cur.name === 'news') E.markNewsRead();
  updateNewsLists();
  updateBadge();
  if (!E.S.settings.newsPop) return;
  sfx('news');
  const c = n.cid ? BY_ID[n.cid] : null;
  toast(`<span class="t-ic">${c ? logo(c, 34) : `<span class="news-gen">${icon('news')}</span>`}</span><span class="t-body"><b class="tag ${newsKind(n)}">${newsTag(n)}</b><span>${esc(n.text)}</span></span>`, { onClick: () => openNews(n.id), ms: 5000 });
});
E.on('dividend', sum => {
  sfx('coin');
  toast(`${coin()}<span class="t-body"><b>${term('배당금', '배당금')}을 받았어요</b><span>가지고 있는 주식의 회사들이 ${fmt(sum)} 코인을 나눠 줬어요.</span></span>`, { kind: 'gold', ms: 6000 });
  if (['history', 'assets', 'bank'].includes(cur.name)) render(true);
});
E.on('interest', amt => toast(`${coin()}<span>은행에서 이자 ${fmt(amt)} 코인을 받았어요.</span>`, { kind: 'gold', ms: 2600 }));
E.on('newsread', updateBadge);
E.on('trade', () => render(true));
E.on('reset', () => { ui.quiz = null; ui.sort = 'name'; applySettings(); toast(`${icon('refresh')}<span>새 게임을 시작했어요. 100,000 코인을 받았어요.</span>`); if (cur.name === 'home') render(); else go('home'); });

// ---------- 메뉴 버튼, 가로 화면 안내 ----------
const NAV = [['home', 'candle', '주식창'], ['market', 'market', '주식 시장'], ['news', 'news', '뉴스'], ['bank', 'bank', '은행'], ['assets', 'wallet', '내 자산'], ['holdings', 'briefcase', '보유 주식'], ['history', 'list', '거래 기록'], ['learn', 'book', '공부하기'], ['settings', 'gear', '설정']];
$('#rail').innerHTML = NAV.map(([k, ic, l]) => `<a href="#${k === 'settings' ? 'options' : k}" data-nav="${k}${k === 'market' ? ' stock' : ''}"><span class="rail-ic">${icon(ic)}${k === 'news' ? '<b class="nbadge" id="newsBadge" hidden></b>' : ''}</span><span class="rail-lb">${l}</span></a>`).join('');
$('#rotate').innerHTML = `${pic('rotate')}<h2>화면을 가로로 돌려 주세요</h2><p class="muted">이 게임은 가로 화면에 맞춰 만들었어요. 가로로 돌리면 주식창을 넓게 볼 수 있어요.</p><div class="btns"><button type="button" class="btn primary big" id="rotLock">가로 화면으로 바꾸기</button><button type="button" class="btn ghost" id="rotSkip">세로로 그냥 할게요</button></div>`;
$('#rotSkip').addEventListener('click', () => { E.S.settings.portraitOk = true; E.save(); applySettings(); });
$('#rotLock').addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    await screen.orientation.lock('landscape');
  } catch (err) {
    toast(`${icon('info')}<span>기기를 옆으로 돌려 주세요. 화면이 돌아가지 않으면 기기의 자동 회전을 켜 주세요.</span>`, { ms: 4000 });
  }
});

// ---------- 시작 ----------
E.load();
applySettings();
render();
schedule();
