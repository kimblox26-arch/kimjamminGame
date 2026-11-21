'use strict';
const API = 'https://api.tcgdex.net/v2';
const OCR_LANG = { ko: 'kor+eng', en: 'eng', ja: 'jpn+eng' };
const $ = (s) => document.querySelector(s);
const video = $('#video'), statusEl = $('#status'), results = $('#results');
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let lang = store.get('cardscan.lang', 'ko');
let collection = store.get('cardscan.collection', []);
let worker = null, workerLang = null, busy = false;
const setsCache = {}, setCache = {}, cardCache = {};

const status = (t) => { statusEl.textContent = t; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const img = (base, q = 'low') => (base ? `${base}/${q}.webp` : 'icon.svg');

/* ---------- 카메라 ---------- */
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
    });
    video.srcObject = stream;
    await video.play();
    $('#camStart').hidden = true;
    status('카드를 틀 안에 꽉 차게 맞추고 찍어주세요.');
  } catch {
    status('카메라를 열 수 없어요. "사진 올리기"나 검색을 이용해주세요.');
  }
}

// 화면의 가이드 틀 영역만 잘라 630x880 카드 이미지로 만든다 (video는 object-fit:cover)
function grabGuide() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const r = video.getBoundingClientRect(), g = $('#guide').getBoundingClientRect();
  const sc = Math.max(r.width / vw, r.height / vh);
  const ox = (r.width - vw * sc) / 2, oy = (r.height - vh * sc) / 2;
  const c = document.createElement('canvas');
  c.width = 630; c.height = 880;
  c.getContext('2d').drawImage(video, (g.left - r.left - ox) / sc, (g.top - r.top - oy) / sc, g.width / sc, g.height / sc, 0, 0, 630, 880);
  return c;
}

function imageToCanvas(im) {
  const c = document.createElement('canvas');
  const s = Math.min(1, 1600 / Math.max(im.width, im.height));
  c.width = im.width * s; c.height = im.height * s;
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  return c;
}

/* ---------- OCR ---------- */
// 영역을 잘라 확대 + 흑백 + 대비 늘리기
function region(src, x, y, w, h, scale = 2) {
  const o = document.createElement('canvas');
  o.width = Math.round(src.width * w * scale); o.height = Math.round(src.height * h * scale);
  const ctx = o.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, src.width * x, src.height * y, src.width * w, src.height * h, 0, 0, o.width, o.height);
  const d = ctx.getImageData(0, 0, o.width, o.height), p = d.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < p.length; i += 4) {
    const v = p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114;
    p[i] = v; if (v < lo) lo = v; if (v > hi) hi = v;
  }
  const k = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < p.length; i += 4) p[i] = p[i + 1] = p[i + 2] = (p[i] - lo) * k;
  ctx.putImageData(d, 0, 0);
  return o;
}

async function getWorker() {
  const code = OCR_LANG[lang];
  if (worker && workerLang === code) return worker;
  if (!window.Tesseract) throw new Error('글자 인식 엔진을 불러오지 못했어요 (인터넷 연결 확인)');
  if (worker) await worker.terminate();
  status('글자 인식 엔진 준비 중… (처음 한 번만 조금 걸려요)');
  worker = await Tesseract.createWorker(code);
  workerLang = code;
  return worker;
}

const ocr = async (canvas) => (await (await getWorker()).recognize(canvas)).data.text || '';

function parseNumber(t) {
  const m = t.replace(/[oO]/g, '0').replace(/[Il|]/g, '1').match(/(\d{1,3})\s*[\/⁄]\s*(\d{2,3})/);
  return m ? { n: +m[1], total: +m[2] } : null;
}

function parseName(t) {
  const junk = /\b(basic|stage\s*\d|evolves?\s+from.*|trainer|supporter|item|energy)\b|기본|\d?\s*진화|たね|\d進化|HP\s*\d+|\d+/gi;
  for (const line of t.split('\n')) {
    const s = line.replace(junk, ' ').replace(/[^\p{L}\s'.-]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (s.replace(/\s/g, '').length >= 2) return s;
  }
  return '';
}

async function recognize(card, isGuide) {
  // 카드 틀 기준: 위쪽 = 이름, 아래쪽 = 카드번호
  let name = parseName(await ocr(region(card, 0.04, 0.02, 0.72, 0.09)));
  let num = parseNumber(await ocr(region(card, 0, 0.87, 1, 0.12, 2.5)));
  if (!isGuide || (!name && !num)) { // 일반 사진이면 전체에서도 찾아본다
    const all = await ocr(region(card, 0, 0, 1, 1, 1));
    num = num || parseNumber(all);
    name = name || parseName(all);
  }
  return { name, num };
}

/* ---------- TCGdex 검색 ---------- */
async function api(path) {
  const r = await fetch(`${API}/${lang}${path}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`카드 DB 응답 오류 (${r.status})`);
  return r.json();
}
const cached = async (cache, key, fn) => (key in cache ? cache[key] : (cache[key] = await fn()));
const getSets = () => cached(setsCache, lang, () => api('/sets'));
const getSet = (id) => cached(setCache, lang + id, () => api('/sets/' + encodeURIComponent(id)));
const getCard = (id) => cached(cardCache, lang + id, () => api('/cards/' + encodeURIComponent(id)));
const nameHit = (c, name) => name && c.name && c.name.toLowerCase().includes(name.toLowerCase());

async function findByNumber({ n, total }) {
  const sets = ((await getSets()) || []).filter((s) => s.cardCount && (s.cardCount.official === total || s.cardCount.total === total));
  const out = [];
  await Promise.all(sets.slice(-12).map(async (s) => {
    const full = await getSet(s.id).catch(() => null);
    const c = full?.cards?.find((c) => parseInt(c.localId, 10) === n);
    if (c) out.push(c);
  }));
  return out;
}

async function search({ name, num }) {
  let list = [];
  if (num) list = await findByNumber(num);
  if (name) {
    if (list.some((c) => nameHit(c, name))) list = list.filter((c) => nameHit(c, name));
    else if (!list.length || !num) {
      const byName = (await api('/cards?name=' + encodeURIComponent(name))) || [];
      const sameNum = num ? byName.filter((c) => parseInt(c.localId, 10) === num.n) : [];
      list = sameNum.length ? sameNum : byName;
    }
  }
  const top = list.slice(0, 12);
  const full = await Promise.all(top.map((c) => getCard(c.id).catch(() => null)));
  return full.map((c, i) => c || top[i]);
}

/* ---------- 시세 ---------- */
function price(c) {
  const p = c.pricing || {};
  for (const v of Object.values(p.tcgplayer || {})) if (v && v.marketPrice) return { v: v.marketPrice, cur: 'USD' };
  const cm = p.cardmarket;
  if (cm && (cm.avg || cm.trend)) return { v: cm.avg || cm.trend, cur: 'EUR' };
  return null;
}
const fmt = (p) => (p ? (p.cur === 'USD' ? '$' : '€') + p.v.toFixed(2) : '시세 정보 없음');

/* ---------- 화면 ---------- */
function cardInfo(c) {
  return {
    id: c.id, lang, name: c.name, img: c.image || null,
    set: c.set?.name || '', number: c.localId + (c.set?.cardCount?.official ? '/' + c.set.cardCount.official : ''),
    rarity: c.rarity || '', price: price(c),
  };
}

function itemHTML(it, extra) {
  return `<div class="item">${extra?.best ? '<span class="best">가장 비슷해요</span>' : ''}
    <img src="${esc(img(it.img))}" data-big="${esc(img(it.img, 'high'))}" alt="${esc(it.name)}" loading="lazy">
    <b>${esc(it.name)}</b><small>${esc(it.set)} · ${esc(it.number)}${it.rarity ? ' · ' + esc(it.rarity) : ''}</small>
    <span class="price">${fmt(it.price)}</span>${extra?.html || ''}</div>`;
}

function showResults(cards, q) {
  if (!cards.length) {
    results.innerHTML = '';
    status(`"${q}" 카드를 찾지 못했어요. 더 밝은 곳에서 다시 찍거나, 위의 카드 언어를 바꿔보세요.`);
    return;
  }
  status(`${cards.length}장 찾았어요 — ${q}`);
  const infos = cards.map(cardInfo);
  results.innerHTML = infos.map((it, i) => itemHTML(it, { best: i === 0, html: `<button data-add="${i}">+ 컬렉션에 담기</button>` })).join('');
  results.onclick = (e) => {
    const i = e.target.dataset.add;
    if (i == null) return;
    addToCollection(infos[i]);
    e.target.textContent = '✓ 담았어요';
  };
}

async function run(task) {
  if (busy) return;
  busy = true; $('#shot').disabled = true;
  try { await task(); } catch (e) { status('⚠️ ' + e.message); } finally { busy = false; $('#shot').disabled = false; }
}

async function scanCanvas(canvas, isGuide) {
  status('카드 글자를 읽는 중…');
  const r = await recognize(canvas, isGuide);
  if (!r.name && !r.num) { status('글자를 읽지 못했어요. 카드를 틀에 맞추고 흔들리지 않게 다시 찍어주세요.'); return; }
  const q = [r.name, r.num && `${r.num.n}/${r.num.total}`].filter(Boolean).join(' · ');
  status(`인식: ${q} — 카드 찾는 중…`);
  showResults(await search(r), q);
}

function textQuery(t) {
  const num = parseNumber(t);
  const name = t.replace(/\d{1,3}\s*\/\s*\d{2,3}/, '').trim();
  return { name, num };
}

/* ---------- 컬렉션 ---------- */
function saveCol() { store.set('cardscan.collection', collection); renderCol(); }
function addToCollection(it) {
  const f = collection.find((c) => c.id === it.id && c.lang === it.lang);
  if (f) f.qty++; else collection.unshift({ ...it, qty: 1, added: Date.now() });
  saveCol();
}
function renderCol() {
  const n = collection.reduce((a, c) => a + c.qty, 0);
  $('#colCount').textContent = n;
  const sum = { USD: 0, EUR: 0 };
  collection.forEach((c) => { if (c.price) sum[c.price.cur] += c.price.v * c.qty; });
  const total = [sum.USD && '$' + sum.USD.toFixed(2), sum.EUR && '€' + sum.EUR.toFixed(2)].filter(Boolean).join(' + ') || '—';
  $('#colSummary').innerHTML = n ? `<b>${collection.length}종 ${n}장</b> · 예상 가치 <b>${total}</b>` : '아직 담은 카드가 없어요. 스캔해서 담아보세요!';
  $('#colList').innerHTML = collection.map((c, i) => itemHTML({ ...c, name: `${c.name}${c.qty > 1 ? ' ×' + c.qty : ''}` }, {
    html: `<div class="qty"><button data-dec="${i}">−</button><button data-inc="${i}">+</button></div>`,
  })).join('');
}
$('#colList').onclick = (e) => {
  const { inc, dec } = e.target.dataset;
  if (inc != null) collection[inc].qty++;
  else if (dec != null && --collection[dec].qty <= 0) collection.splice(dec, 1);
  else return;
  saveCol();
};

/* ---------- 이벤트 ---------- */
$('#lang').value = lang;
$('#lang').onchange = (e) => { lang = e.target.value; store.set('cardscan.lang', lang); status('카드 언어: ' + e.target.selectedOptions[0].text); };
$('#camStart').onclick = startCamera;
$('#shot').onclick = () => run(async () => {
  if (!video.videoWidth) { await startCamera(); if (!video.videoWidth) return; }
  await scanCanvas(grabGuide(), true);
});
$('#file').onchange = (e) => run(async () => {
  const f = e.target.files[0];
  if (!f) return;
  const bmp = await createImageBitmap(f);
  e.target.value = '';
  await scanCanvas(imageToCanvas(bmp), false);
});
$('#searchForm').onsubmit = (e) => {
  e.preventDefault();
  const t = $('#q').value.trim();
  if (t) run(async () => { status('찾는 중…'); showResults(await search(textQuery(t)), t); });
};
document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.tab,.view').forEach((x) => x.classList.remove('on'));
  b.classList.add('on'); $('#' + b.dataset.view).classList.add('on');
}));
document.addEventListener('click', (e) => {
  const z = $('#zoom');
  if (e.target.dataset.big) { z.querySelector('img').src = e.target.dataset.big; z.hidden = false; }
  else if (e.target.closest('#zoom')) z.hidden = true;
});
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
renderCol();
status('카메라 켜기를 누르거나, 사진을 올리거나, 이름으로 검색하세요.');
