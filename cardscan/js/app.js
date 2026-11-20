import { integral, toGray, sample, bestMatches } from './hash.js';
import { makeQueries } from './scan.js';

const $ = id => document.getElementById(id);
const IMG = 'https://images.pokemontcg.io/';
const imgUrl = c => c[5].startsWith('http') ? c[5] : IMG + c[5];
const ACCEPT = 25;          // 이 점수 이하면 "같은 카드"로 인정 (0~128, 작을수록 닮음. 시뮬레이션: 정답 90%가 20 이하, 카드 없음은 28 이상)
const STORE = 'cardscan.list.v1';

// ---------- 데이터 ----------
let cards = [];             // [id, name, number, setName, printedTotal, img, prices, rarity]
let db = null;              // Uint32Array (카드당 4칸)
let priceDate = null;
const byId = new Map();
let rate = { KRW: 1400, EUR: 0.92, date: null };

const CONDS = [
  ['NM', '최상 (새것 같음)', 1], ['LP', '좋음 (살짝 사용감)', 0.85],
  ['MP', '보통 (사용감 있음)', 0.7], ['HP', '나쁨 (많이 닳음)', 0.5], ['DMG', '손상 (찢김·접힘)', 0.3],
];
const VARIANT_NAME = { n: '일반', h: '홀로', r: '리버스 홀로', fh: '1판 홀로', fn: '1판 일반',
  uh: '무제한 홀로', u: '무제한', f: '1판', eur: '유럽 시세' };
const VARIANT_ORDER = ['n', 'h', 'fh', 'fn', 'uh', 'u', 'f', 'r'];

async function loadData() {
  const [meta, bin] = await Promise.all([
    fetch('data/cards.json').then(r => r.json()),
    fetch('data/hashes.bin').then(r => r.arrayBuffer()),
  ]);
  cards = meta.cards;
  priceDate = meta.priceDate;
  db = new Uint32Array(bin);
  cards.forEach((c, i) => byId.set(c[0], i));
}

async function loadRate() {
  try {
    const saved = JSON.parse(localStorage.getItem('cardscan.rate') || 'null');
    if (saved && Date.now() - saved.t < 12 * 3600e3) { rate = saved.rate; return; }
  } catch {}
  try {
    const j = await fetch('https://open.er-api.com/v6/latest/USD').then(r => r.json());
    if (j.rates?.KRW) {
      rate = { KRW: j.rates.KRW, EUR: j.rates.EUR || 0.92, date: (j.time_last_update_utc || '').slice(5, 16) };
      try { localStorage.setItem('cardscan.rate', JSON.stringify({ t: Date.now(), rate })); } catch {}
    }
  } catch {}
}

// ---------- 가격 ----------
const card = id => cards[byId.get(id)];
function variantsOf(c) {
  const p = c[6] || {};
  const keys = Object.keys(p).filter(k => k !== 'eur');
  keys.sort((a, b) => (VARIANT_ORDER.indexOf(a) + 99) % 99 - (VARIANT_ORDER.indexOf(b) + 99) % 99);
  if (!keys.length && p.eur) keys.push('eur');
  return keys;
}
function krwOf(c, variant) {
  const p = c[6] || {};
  const v = variant && p[variant] != null ? variant : variantsOf(c)[0];
  if (!v) return null;
  return v === 'eur' ? p.eur * rate.KRW / rate.EUR : p[v] * rate.KRW;
}
function itemKrw(it) {
  const c = card(it.id);
  const base = c && krwOf(c, it.variant);
  if (base == null) return null;
  return base * (CONDS.find(x => x[0] === it.cond)?.[2] ?? 1);
}
const won = v => v == null ? '시세 없음' : '₩' + (Math.round(v / 10) * 10).toLocaleString('ko-KR');
const usdText = (c, variant) => {
  const p = c[6] || {};
  const v = variant && p[variant] != null ? variant : variantsOf(c)[0];
  if (!v) return '';
  return v === 'eur' ? `€${p.eur}` : `$${p[v]}`;
};
const metaText = c => `${c[3]} · ${c[2]}${c[4] ? '/' + c[4] : ''}`;

// ---------- 스캔 목록 ----------
let list = [];
try { list = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch {}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(list)); } catch {} };

function addItem(id, alts = []) {
  const it = { uid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), id, cond: 'NM', variant: null, alts };
  list.unshift(it);
  save();
  renderSummary();
  return it;
}

function renderSummary() {
  const total = list.reduce((s, it) => s + (itemKrw(it) || 0), 0);
  $('sumCount').textContent = $('listCount').textContent = `${list.length}장`;
  $('sumTotal').textContent = $('listTotal').textContent = won(total);
  $('listBtn').textContent = list.length ? `목록 보기 (${list.length})` : '목록 보기';
}

// ---------- 카메라 & 자동 인식 ----------
const video = $('video'), work = $('work');
const ctx = work.getContext('2d', { willReadFrequently: true });
let running = false, paused = false;
let prevThumb = null, stableCount = 0;
const st = { armed: true, lastIds: [], pending: null, miss: 0 };

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
    });
    video.srcObject = stream;
    await video.play();
    $('start').hidden = true;
    $('pauseBtn').disabled = false;
    running = true;
    hint('카드를 네모 안에 맞춰 주세요');
    setTimeout(tick, 300);
  } catch (e) {
    $('loadInfo').textContent = '카메라를 켤 수 없어요. 브라우저 설정에서 카메라 권한을 허용해 주세요. (' + e.name + ')';
  }
}

function hint(t) { $('hint').textContent = t; }

// 화면의 가이드 네모 → 영상 좌표
function guideInVideo() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const box = $('cam').getBoundingClientRect(), g = $('guide').getBoundingClientRect();
  const s = Math.max(box.width / vw, box.height / vh);
  const ox = (box.width - vw * s) / 2, oy = (box.height - vh * s) / 2;
  return {
    x: (g.left - box.left - ox) / s, y: (g.top - box.top - oy) / s, w: g.width / s, h: g.height / s, vw, vh,
  };
}

function grabFrame() {
  const g = guideInVideo();
  const m = 0.2;
  const sx = Math.max(0, g.x - g.w * m), sy = Math.max(0, g.y - g.h * m);
  const ex = Math.min(g.vw, g.x + g.w * (1 + m)), ey = Math.min(g.vh, g.y + g.h * (1 + m));
  const k = 300 / (ex - sx);
  const W = Math.round((ex - sx) * k), H = Math.round((ey - sy) * k);
  if (work.width !== W || work.height !== H) { work.width = W; work.height = H; }
  ctx.drawImage(video, sx, sy, ex - sx, ey - sy, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  const guide = { x0: (g.x - sx) * k, y0: (g.y - sy) * k, x1: (g.x + g.w - sx) * k, y1: (g.y + g.h - sy) * k };
  return { data, W, H, guide };
}

function tick() {
  if (!running) return;
  if (!paused && video.readyState >= 2) {
    try { step(); } catch (e) { console.error(e); }
  }
  setTimeout(tick, 120);
}

function step() {
  const f = grabFrame();
  // 움직임 확인: 가이드 영역 16x16 축소본을 이전 프레임과 비교
  const I = integral(toGray(f.data, f.W, f.H, 4), f.W, f.H);
  const thumb = sample(I, f.guide.x0, f.guide.y0, f.guide.x1, f.guide.y1, 16);
  let diff = 255;
  if (prevThumb) { diff = 0; for (let i = 0; i < 256; i++) diff += Math.abs(thumb[i] - prevThumb[i]); diff /= 256; }
  prevThumb = thumb;
  if (diff > 7) { stableCount = 0; return; }
  if (++stableCount < 2) return;

  const { queries } = makeQueries(f.data, f.W, f.H, f.guide);
  const top = bestMatches(db, queries, 5);
  const ids = top.map(t => cards[t.index][0]);
  const best = top[0];

  if (!best || best.score > ACCEPT) {
    if (++st.miss >= 2) { st.armed = true; st.pending = null; }
    hint('카드를 네모 안에 맞춰 주세요');
    return;
  }
  st.miss = 0;
  // 방금 넣은 카드가 아직 그대로 있으면 다시 세지 않음
  if (!st.armed && st.lastIds.slice(0, 3).includes(ids[0])) return;
  // 연속 2번 같은 카드(또는 같은 그림의 카드)로 나와야 확정
  if (!st.pending || !ids.slice(0, 3).includes(st.pending)) { st.pending = ids[0]; hint('인식 중…'); return; }

  st.armed = false; st.lastIds = ids; st.pending = null;
  const alts = top.filter(t => t.score <= ACCEPT + 10).map(t => cards[t.index][0]).filter(x => x !== ids[0]);
  const it = addItem(ids[0], alts.slice(0, 4));
  showResult(it);
}

let resultTimer = 0, lastShown = null;
function showResult(it) {
  const c = card(it.id);
  lastShown = it;
  $('resImg').src = imgUrl(c);
  $('resName').textContent = c[1];
  $('resMeta').textContent = metaText(c);
  $('resPrice').textContent = won(itemKrw(it));
  $('result').hidden = false;
  const g = $('guide');
  g.classList.remove('hit'); void g.offsetWidth; g.classList.add('hit');
  navigator.vibrate?.(40);
  beep();
  hint('인식 완료! 다음 카드를 넣어 주세요');
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => { $('result').hidden = true; g.classList.remove('hit'); }, 4000);
}

let audio;
function beep() {
  try {
    audio ||= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 1320; g.gain.setValueAtTime(0.08, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.13);
  } catch {}
}

// ---------- 화면: 목록 ----------
let selecting = false;
const selected = new Set();

function open(id) { $(id).hidden = false; }
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => {
  b.closest('.sheet').hidden = true;
  if (b.closest('#detailSheet') && !$('listSheet').hidden) renderList();
});

function renderList() {
  const grid = $('grid');
  grid.innerHTML = '';
  for (const it of list) {
    const c = card(it.id);
    if (!c) continue;
    const el = document.createElement('div');
    el.className = 'tile' + (selected.has(it.uid) ? ' sel' : '');
    el.innerHTML = `<img loading="lazy" alt=""><div class="name"></div><div class="p"></div>`;
    el.querySelector('img').src = imgUrl(c);
    el.querySelector('.name').textContent = c[1];
    el.querySelector('.p').textContent = won(itemKrw(it));
    el.onclick = () => {
      if (selecting) {
        selected.has(it.uid) ? selected.delete(it.uid) : selected.add(it.uid);
        el.classList.toggle('sel');
        $('selInfo').textContent = `${selected.size}장 선택`;
      } else openDetail(it);
    };
    grid.appendChild(el);
  }
  $('emptyMsg').hidden = list.length > 0;
  $('priceNote').textContent = `시세: TCGplayer 기준${priceDate ? ` (${priceDate})` : ''} · 환율 1달러 = ${Math.round(rate.KRW).toLocaleString('ko-KR')}원`;
  renderSummary();
}

$('listBtn').onclick = () => { open('listSheet'); renderList(); };
$('selectBtn').onclick = () => {
  selecting = !selecting;
  selected.clear();
  $('selectBtn').textContent = selecting ? '취소' : '선택';
  $('selectBar').hidden = !selecting;
  $('selInfo').textContent = '0장 선택';
  renderList();
};
$('selAll').onclick = () => {
  if (selected.size === list.length) selected.clear(); else list.forEach(it => selected.add(it.uid));
  $('selInfo').textContent = `${selected.size}장 선택`;
  renderList();
};
$('selDel').onclick = () => {
  if (!selected.size || !confirm(`${selected.size}장을 삭제할까요?`)) return;
  list = list.filter(it => !selected.has(it.uid));
  selected.clear();
  save();
  $('selInfo').textContent = '0장 선택';
  renderList();
};

// ---------- 화면: 상세 ----------
let detailItem = null;
function openDetail(it) {
  detailItem = it;
  const c = card(it.id);
  $('detImg').src = imgUrl(c);
  $('detName').textContent = c[1];
  $('detMeta').textContent = metaText(c) + (c[7] ? ` · ${c[7]}` : '');
  $('detLink').href = `https://prices.pokemontcg.io/tcgplayer/${c[0]}`;
  const vs = variantsOf(c);
  $('detVariant').innerHTML = vs.length
    ? vs.map(v => `<option value="${v}">${VARIANT_NAME[v] || v} — ${usdText(c, v)}</option>`).join('')
    : '<option>시세 정보 없음</option>';
  $('detVariant').value = it.variant || vs[0] || '';
  $('detCond').innerHTML = CONDS.map(([k, n, m]) => `<option value="${k}">${n} · ${Math.round(m * 100)}%</option>`).join('');
  $('detCond').value = it.cond;
  updateDetailPrice();
  const alts = $('detAlts');
  alts.innerHTML = '';
  for (const id of it.alts || []) {
    const a = card(id);
    if (!a) continue;
    alts.appendChild(row(a, () => {
      it.alts = [it.id, ...it.alts.filter(x => x !== id)];
      it.id = id; it.variant = null;
      save(); openDetail(it);
    }));
  }
  if (!alts.children.length) alts.innerHTML = '<p class="note">비슷한 다른 카드가 없어요. 틀렸다면 삭제 후 “직접 검색”을 써 보세요.</p>';
  open('detailSheet');
}
function updateDetailPrice() {
  const it = detailItem, c = card(it.id);
  const v = itemKrw(it);
  $('detPrice').innerHTML = `${won(v)}<small>${usdText(c, it.variant)} 기준 × 상태 ${Math.round((CONDS.find(x => x[0] === it.cond)?.[2] ?? 1) * 100)}%</small>`;
}
$('detVariant').onchange = e => { detailItem.variant = e.target.value; save(); updateDetailPrice(); renderSummary(); };
$('detCond').onchange = e => { detailItem.cond = e.target.value; save(); updateDetailPrice(); renderSummary(); };
$('detDel').onclick = () => {
  list = list.filter(x => x !== detailItem);
  save();
  $('detailSheet').hidden = true;
  if (!$('listSheet').hidden) renderList(); else renderSummary();
};

function row(c, onclick) {
  const b = document.createElement('button');
  b.className = 'row';
  b.innerHTML = `<img loading="lazy" alt=""><div class="info"><div class="name"></div><div class="meta"></div></div><div class="p"></div>`;
  b.querySelector('img').src = imgUrl(c);
  b.querySelector('.name').textContent = c[1];
  b.querySelector('.meta').textContent = metaText(c);
  b.querySelector('.p').textContent = won(krwOf(c));
  b.onclick = onclick;
  return b;
}

// 결과 카드에서 "아니에요" → 상세 열어 다른 후보 고르기
$('resWrong').onclick = () => { if (lastShown) openDetail(lastShown); };
$('result').onclick = e => { if (e.target.id !== 'resWrong' && lastShown) openDetail(lastShown); };

// ---------- 화면: 직접 검색 ----------
$('searchBtn').onclick = () => { open('searchSheet'); $('searchInput').focus(); };
$('searchInput').oninput = () => {
  const q = $('searchInput').value.trim().toLowerCase();
  const rows = $('searchRows');
  rows.innerHTML = '';
  if (q.length < 2) return;
  const num = q.match(/^#?0*([a-z]{0,3}\d+[a-z]?)\s*(?:\/\s*0*(\d+))?$/i); // 025/165, TG05 등
  const found = [];
  for (const c of cards) {
    let ok;
    if (num) ok = c[2].toLowerCase().replace(/^0+/, '') === num[1] && (!num[2] || String(c[4]) === num[2]);
    else ok = c[1].toLowerCase().includes(q);
    if (ok) { found.push(c); if (found.length >= 40) break; }
  }
  for (const c of found) rows.appendChild(row(c, () => {
    addItem(c[0]);
    $('searchSheet').hidden = true;
    $('searchInput').value = ''; rows.innerHTML = '';
    hint(`${c[1]} 추가됨`);
  }));
  if (!found.length) rows.innerHTML = '<p class="note">찾는 카드가 없어요.</p>';
};

// ---------- 시작 ----------
$('pauseBtn').onclick = () => {
  paused = !paused;
  $('pauseBtn').textContent = paused ? '다시 시작' : '일시정지';
  hint(paused ? '일시정지됨' : '카드를 네모 안에 맞춰 주세요');
};
$('startBtn').onclick = startCamera;

renderSummary();
loadRate().then(renderSummary);
loadData().then(() => {
  $('startBtn').disabled = false;
  $('loadInfo').textContent = `카드 ${cards.length.toLocaleString('ko-KR')}장 준비 완료`;
  hint('카메라를 켜 주세요');
  renderSummary();
}).catch(e => {
  $('loadInfo').textContent = '카드 데이터를 불러오지 못했어요: ' + e.message;
});
