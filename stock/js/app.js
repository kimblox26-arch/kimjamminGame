// 화면(UI): 메뉴, 화면 그리기, 창, 알림, 실시간 갱신
import { COMPANIES, VOL_INFO, GLOSSARY, LESSONS, QUIZ, GUIDES } from './data.js';
import { icon, tri, coin, logo, owl, pic } from './art.js';
import * as E from './engine.js';
import { lineChart, spark, donut } from './chart.js';

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

const ui = { sort: 'name', range: { stock: 'day', assets: 'week' }, learnTab: 'lessons', histFilter: 'all', quiz: null };
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
function quick(href, ic, label, sub) {
  return `<a class="quick-btn" href="#${href}"><span class="q-ic">${icon(ic)}</span><b>${label}</b><span class="muted small">${sub}</span></a>`;
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
function moverList(list, emptyText) {
  return list.length ? list.map(c => `<a class="mini-row" href="#stock-${c.id}">${logo(c, 36)}<b>${c.name}</b>${live('chg', c.id, 'chg')}</a>`).join('') : `<p class="empty-line">${emptyText}</p>`;
}
function rangeSeg(group, rg) {
  return `<div class="seg" role="tablist">${['day', 'week', 'month'].map(r => `<button type="button" role="tab" class="${r === rg ? 'on' : ''}" aria-selected="${r === rg}" data-act="range" data-group="${group}" data-range="${r}">${RANGE_NAME[r]}</button>`).join('')}</div>`;
}

const SCREENS = {
  home() {
    const name = E.S.settings.name;
    const movers = [...COMPANIES].sort((a, b) => E.changeRate(b.id) - E.changeRate(a.id));
    return `
    <section class="card hello">${owl('owl-md')}<div>
      <h2>${name ? `${esc(name)}님, 안녕하세요!` : '꼬마 투자자님, 안녕하세요!'}</h2>
      <p class="muted">뉴스를 읽고 회사를 살펴본 뒤, 똑똑하게 투자해 봐요.</p></div></section>
    <section class="card asset-hero">
      <div class="row-between"><span class="label">내 ${term('총자산')}</span><a class="link" href="#assets">자세히 보기 ${icon('chevron')}</a></div>
      <div class="big-num">${live('total')}</div>
      <div class="pl-line">${live('profit', '', 'pill')}${live('profitRate', '', 'pill')}<span class="muted small">처음 받은 돈 ${fmt(E.S.start)} 코인과 비교한 ${term('수익')}과 ${term('수익률')}</span></div>
      <div class="spark-wide" data-chart="assetSpark"></div>
      <div class="split">
        <div><span class="label">${term('현금')}</span><b>${live('cash')}</b></div>
        <div><span class="label">주식 ${term('평가 금액')}</span><b>${live('stockVal')}</b></div>
      </div>
    </section>
    <section class="quick">
      ${quick('market', 'market', '주식 시장', '회사 주식 구경하기')}
      ${quick('assets', 'wallet', '내 자산', '내 돈 모두 보기')}
      ${quick('holdings', 'briefcase', '보유 주식', '내가 가진 주식')}
      ${quick('history', 'list', '거래 기록', '사고판 기록')}
      ${quick('learn', 'book', '주식 공부하기', '이야기와 퀴즈')}
      ${quick('settings', 'gear', '설정', '속도, 글자, 소리')}
    </section>
    <section class="card">
      <div class="row-between"><h3 class="sec-title">${icon('news')} 새로운 ${term('뉴스')}</h3></div>
      <div class="news-list" data-newslist="" data-limit="5">${newsList(null, 5)}</div>
    </section>
    <section class="two-col">
      <div class="card"><h3 class="sec-title up">${icon('arrowUp')} 오늘 많이 오른 회사</h3><div class="mini-list">${moverList(movers.filter(c => E.changeRate(c.id) > 0.004).slice(0, 3), '오늘은 오른 회사가 없어요.')}</div></div>
      <div class="card"><h3 class="sec-title down">${icon('arrowDown')} 오늘 많이 내린 회사</h3><div class="mini-list">${moverList(movers.filter(c => E.changeRate(c.id) < -0.004).reverse().slice(0, 3), '오늘은 내린 회사가 없어요.')}</div></div>
    </section>`;
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
        <div><span class="label">${term('수익률')}</span><b>${live('profitRate', '', 'pl')}</b></div>
      </div>
      <p class="formula">${term('총자산')} = ${term('현금')} + 주식 ${term('평가 금액')}</p>
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
    const items = all.filter(t => f === 'all' || t.t === f);
    const real = all.filter(t => t.t === 'sell').reduce((s, t) => s + t.pl, 0);
    const divs = all.filter(t => t.t === 'div').reduce((s, t) => s + t.amt, 0);
    const fl = [['all', '전체'], ['buy', '매수'], ['sell', '매도'], ['div', '배당금']];
    return `
    <section class="card"><div class="kv-grid">
      <div><span class="label">판 주식의 ${term('수익')} / ${term('손실')}</span><b class="pl ${dirOf(real)}">${CS(real)}</b></div>
      <div><span class="label">받은 ${term('배당금')}</span><b>${C(divs)}</b></div>
      <div><span class="label">${term('매수')} 횟수</span><b>${all.filter(t => t.t === 'buy').length}번</b></div>
      <div><span class="label">${term('매도')} 횟수</span><b>${all.filter(t => t.t === 'sell').length}번</b></div>
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
      ${row('user', '내 이름', '메인 화면에서 이름을 불러 줘요.', `<form class="name-form" data-form="name"><input id="nameInput" maxlength="10" value="${esc(s.name)}" placeholder="이름 쓰기" aria-label="내 이름"><button class="btn primary sm" type="submit">저장</button></form>`)}
      ${row('speed', '게임 속도', '빠를수록 게임 속 시간이 빨리 흘러요.', seg('speed', s.speed, [['slow', '느리게'], ['normal', '보통'], ['fast', '빠르게']]))}
      ${row('pause', '시간 멈추기', '켜면 주가가 움직이지 않아요. 천천히 생각할 때 써요.', sw('paused', s.paused))}
      ${row(s.sound ? 'sound' : 'mute', '소리 효과', '사고팔 때와 소식이 올 때 작은 소리가 나요.', sw('sound', s.sound))}
      ${row('text', '글자 크기', '글씨가 작으면 크게 바꿔 보세요.', seg('big', s.big ? 1 : 0, [[0, '보통'], [1, '크게']]))}
      ${row(s.dark ? 'moon' : 'sun', '화면 밝기', '자동은 기기 설정을 따라가요. 밤에는 어두운 화면이 눈이 편해요.', seg('dark', s.dark == null ? 'auto' : s.dark ? 1 : 0, [['auto', '자동'], [0, '밝게'], [1, '어둡게']]))}
    </section>
    <section class="card set-list">
      ${row('info', '안내 창 다시 보기', '각 화면에 처음 들어갈 때 나오는 안내 창을 다시 보여 줘요.', `<button type="button" class="btn ghost sm" data-act="resetGuides">다시 보기</button>`)}
      ${row('refresh', '처음부터 다시 하기', '모든 기록을 지우고 100,000 코인으로 다시 시작해요.', `<button type="button" class="btn danger sm" data-act="resetGame">다시 시작</button>`)}
    </section>
    <section class="card note">${icon('alert')}<div><b>알아 두세요</b><p>이 게임의 코인은 진짜 돈이 아니에요. 회사와 뉴스도 모두 공부를 위해 만든 이야기예요. 게임 기록은 지금 쓰는 기기의 브라우저에 저장돼요.</p></div></section>`;
  },
};

const TITLES = { home: '메인 화면', market: '주식 시장', stock: '주식 상세 정보', assets: '내 자산', holdings: '보유 주식', history: '거래 기록', learn: '주식 공부하기', settings: '설정' };
const PARENT = { stock: 'market', holdings: 'assets', history: 'assets' };

function tradeRow(t) {
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
  const parts = [{ v: E.S.cash, color: '#A7B0C0', label: '현금' }, ...ids.map(id => ({ v: E.S.hold[id].q * E.price(id), color: BY_ID[id].color, label: BY_ID[id].name }))];
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
        sheet.close();
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
  $('#title').textContent = cur.name === 'stock' ? BY_ID[cur.id].name : TITLES[cur.name];
  document.title = `${TITLES[cur.name]} - 어린이 주식 놀이터`;
  $('#backBtn').hidden = !PARENT[cur.name];
  for (const a of $$('[data-nav]')) a.classList.toggle('on', a.dataset.nav.split(' ').includes(cur.name));
  refresh(document.body);
  window.scrollTo(0, keepScroll ? y : 0);
  if (!keepScroll) showGuide(cur.name);
}

function updateNewsLists() {
  for (const el of $$('[data-newslist]')) el.innerHTML = newsList(el.dataset.newslist || null, +el.dataset.limit || 5);
  refresh(document.body);
}

function applySettings() {
  const s = E.S.settings;
  document.documentElement.classList.toggle('big', !!s.big);
  if (s.dark === null || s.dark === undefined) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = s.dark ? 'dark' : 'light';
  document.body.classList.toggle('paused', !!s.paused);
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
      for (const b of $$(`[data-act="range"][data-group="${g}"]`)) { b.classList.toggle('on', b.dataset.range === r); b.setAttribute('aria-selected', b.dataset.range === r); }
      for (const el of $$(`[data-rgroup="${g}"]`)) { el.dataset.range = r; el._hi = null; }
      refresh(view); break;
    }
    case 'speed': s.speed = a.dataset.v; E.save(); schedule(); render(true); toast(`${icon('speed')}<span>게임 속도를 "${a.textContent}"(으)로 바꿨어요.</span>`, { ms: 2200 }); break;
    case 'big': s.big = a.dataset.v === '1'; E.save(); applySettings(); render(true); break;
    case 'dark': s.dark = a.dataset.v === 'auto' ? null : a.dataset.v === '1'; E.save(); applySettings(); render(true); break;
    case 'toggle': s[a.dataset.key] = !s[a.dataset.key]; E.save(); applySettings(); render(true); if (a.dataset.key === 'sound' && s.sound) sfx('ok'); break;
    case 'resetGuides': E.S.seen = {}; E.save(); toast(`${icon('info')}<span>각 화면에 들어가면 안내 창을 다시 보여 줄게요.</span>`, { ms: 2600 }); break;
    case 'resetGame':
      modal({ cls: 'small', title: '처음부터 다시 할까요?', body: `<div class="guide-body">${owl('owl-md')}<div><p>지금까지의 주식, 현금, 거래 기록이 모두 지워지고 100,000 코인으로 다시 시작해요.</p><p class="muted small">설정(속도, 글자 크기 등)은 그대로 남아요.</p></div></div>`,
        buttons: [{ label: '아니요', kind: 'ghost' }, { label: '네, 다시 할게요', kind: 'danger', onClick: () => { E.reset(); } }] });
      break;
  }
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
  refresh(document.body);
  for (const m of stack) m.onTick && m.onTick();
  $('#dayIcon').innerHTML = icon(E.hour() >= 6 && E.hour() < 18 ? 'sun' : 'moon');
});
E.on('news', n => {
  updateNewsLists();
  sfx('news');
  const c = n.cid ? BY_ID[n.cid] : null;
  toast(`<span class="t-ic">${c ? logo(c, 34) : `<span class="news-gen">${icon('news')}</span>`}</span><span class="t-body"><b class="tag ${newsKind(n)}">${newsTag(n)}</b><span>${esc(n.text)}</span></span>`, { onClick: () => openNews(n.id), ms: 5000 });
});
E.on('dividend', sum => {
  sfx('coin');
  toast(`${coin()}<span class="t-body"><b>${term('배당금', '배당금')}을 받았어요</b><span>가지고 있는 주식의 회사들이 ${fmt(sum)} 코인을 나눠 줬어요.</span></span>`, { kind: 'gold', ms: 6000 });
  if (['history', 'assets', 'home'].includes(cur.name)) render(true);
});
E.on('day', d => toast(`${icon('sun')}<span>${d}일째 새날이 시작됐어요. 이제 변동률은 ${d - 1}일째 마감 가격과 비교해요.</span>`, { ms: 3000 }));
E.on('trade', () => render(true));
E.on('reset', () => { ui.quiz = null; ui.sort = 'name'; applySettings(); toast(`${icon('refresh')}<span>새 게임을 시작했어요. 100,000 코인을 받았어요.</span>`); if (cur.name === 'home') render(); else go('home'); });

// ---------- 시작 ----------
E.load();
applySettings();
render();
schedule();
