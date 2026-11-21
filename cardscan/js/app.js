import { integral, toGray, sample, bestMatches, stickerHash } from './hash.js?v=7';
import { makeQueries } from './scan.js?v=7';
import {
  $, bus, D, rate, loadData, loadRate, card, imgUrl, won, metaText, toast, cardName,
  CONDS, condMul, VARIANT_NAME, variantsOf, krwOf, foreignText,
  list, setList, saveList, itemKrw, cardsTotal, addItem, stickerTotals, stkPrice,
} from './store.js?v=7';
import { initStickers, renderStickers, stickerStep, openRegister, resetScan, recent as stkRecent, stkName, stkPhoto, openEdit } from './stickers.js?v=7';

const ACCEPT = 25; // 카드: 이 점수 이하면 같은 카드로 인정 (0~128. 시뮬레이션: 정답 90%가 20 이하, 카드 없음은 28 이상)
const pad3 = n => String(n).padStart(3, '0');

// ================= 화면 이동 =================
const VIEWS = ['home', 'scan', 'cards', 'stickers'];
function route() {
  const m = location.hash.match(/^#\/(\w+)(?:\/(\w+))?/) || [];
  const view = VIEWS.includes(m[1]) ? m[1] : 'home';
  VIEWS.forEach(v => { $('v-' + v).hidden = v !== view; });
  document.querySelectorAll('.sheet').forEach(s => { s.hidden = true; });
  regOpen = false;
  if (view === 'scan') { setMode(m[2] === 'sticker' ? 'sticker' : 'card'); startCamera(); } else stopCamera();
  if (view === 'home') renderHome();
  if (view === 'cards') renderCards();
  if (view === 'stickers') renderStickers();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

function openSheet(id) { $(id).hidden = false; }
document.querySelectorAll('.sheet').forEach(s => {
  s.addEventListener('click', e => { if (e.target === s || e.target.closest('[data-close]')) closeSheet(s); });
});
function closeSheet(s) {
  s.hidden = true;
  if (s.id === 'regSheet') regOpen = false;
  if (!$('v-cards').hidden) renderCards();
  if (!$('v-scan').hidden) renderScanBottom();
}

// ================= 홈 =================
function renderHome() {
  const ct = cardsTotal(), st = stickerTotals();
  $('homeTotal').textContent = won(ct + st.krw);
  $('homeCardsN').textContent = `내 카드 ${list.length}장`;
  $('homeCards').textContent = won(ct);
  $('homeStkN').textContent = `내 띠부씰 ${st.qty}장`;
  $('homeStk').textContent = won(st.krw);
  const strip = $('homeRecent');
  strip.innerHTML = '';
  if (D.ready) for (const it of list.slice(0, 12)) {
    const c = card(it.id);
    if (!c) continue;
    const b = document.createElement('button');
    b.className = 'mini';
    b.innerHTML = '<img loading="lazy" alt=""><div class="n"></div><div class="p"></div>';
    b.querySelector('img').src = imgUrl(c);
    b.querySelector('.n').textContent = cardName(c);
    b.querySelector('.p').textContent = won(itemKrw(it));
    b.onclick = () => openDetail(it);
    strip.appendChild(b);
  }
  if (!strip.children.length) strip.innerHTML = '<div class="blank"><svg><use href="#art-cards"/></svg><span>아직 스캔한 카드가 없어요.</span></div>';
  if (D.ready) $('homeFoot').innerHTML = `카드 ${D.cards.length.toLocaleString('ko-KR')}장 · 시세 TCGplayer 기준${D.priceDate ? ` (${D.priceDate})` : ''}<br>환율 1달러 = ${Math.round(rate.KRW).toLocaleString('ko-KR')}원`;
}

// ================= 카메라 =================
const video = $('video'), work = $('work');
const ctx = work.getContext('2d', { willReadFrequently: true });
let stream = null, running = false, paused = false, regOpen = false, timer = 0;
let prevThumb = null, stableCount = 0, mode = 'card';
const cst = { armed: true, lastIds: [], pending: null, miss: 0 };

function hint(t) { $('hint').textContent = t; }

function setMode(m) {
  if (m !== mode) {
    mode = m;
    $('pop').hidden = true;
    Object.assign(cst, { armed: true, pending: null, miss: 0 });
    resetScan();
    prevThumb = null; stableCount = 0;
  }
  const stk = mode === 'sticker';
  $('guide').classList.toggle('square', stk);
  $('modeCard').classList.toggle('on', !stk);
  $('modeStk').classList.toggle('on', stk);
  $('pill').href = stk ? '#/stickers' : '#/cards';
  $('searchBtn').hidden = stk;
  $('regBtn').hidden = true;
  hint(stk ? '띠부씰을 네모 안에 놓아 주세요' : '카드를 네모 안에 맞춰 주세요');
  renderScanBottom();
}

let starting = false;
async function startCamera() {
  renderScanBottom();
  if (running || starting) return;
  if (!D.ready) { hint('데이터를 불러오는 중…'); bus.addEventListener('change', () => !$('v-scan').hidden && startCamera(), { once: true }); return; }
  $('camMsg').hidden = true;
  if (!navigator.mediaDevices?.getUserMedia) { camError('NoMedia'); return; }
  starting = true;
  hint('카메라를 켜는 중…');
  try {
    const ask = c => Promise.race([navigator.mediaDevices.getUserMedia(c),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'Timeout' })), 15000))]);
    try {
      stream = await ask({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) {
      if (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError') throw e;
      stream = await ask({ video: true, audio: false }); // 조건 없이 아무 카메라나
    }
    if ($('v-scan').hidden) { stopCamera(); return; }
    video.srcObject = stream;
    await video.play().catch(() => {});
    // 실제로 화면이 나오는지 최대 4초 확인
    for (let i = 0; i < 20 && !video.videoWidth; i++) await new Promise(r => setTimeout(r, 200));
    if (!video.videoWidth) { stopCamera(); camError('NoFrames'); return; }
    running = true;
    hint(mode === 'sticker' ? '띠부씰을 네모 안에 놓아 주세요' : '카드를 네모 안에 맞춰 주세요');
    timer = setTimeout(tick, 300);
  } catch (e) {
    stopCamera();
    camError(e.name);
  } finally {
    starting = false;
  }
}
function camError(name) {
  const inApp = /KAKAOTALK|NAVER\(|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp/i.test(navigator.userAgent);
  const why = {
    NotAllowedError: '카메라 권한이 막혀 있어요.<br>주소창의 자물쇠(또는 브라우저 설정)에서 카메라를 <b>허용</b>한 뒤 다시 시도해 주세요.',
    NotReadableError: '다른 앱이 카메라를 쓰고 있어요.<br>카메라를 쓰는 다른 앱을 닫고 다시 시도해 주세요.',
    NotFoundError: '카메라를 찾지 못했어요.',
    Timeout: '카메라 권한 창이 뜨지 않았어요.',
    NoMedia: '이 브라우저에서는 카메라를 쓸 수 없어요.',
    NoFrames: '카메라 화면이 나오지 않아요.',
  }[name] || `카메라를 켜지 못했어요. (${name})`;
  const tip = inApp || name === 'NoMedia' || name === 'Timeout'
    ? '<p class="tip">카카오톡·네이버 앱 안에서 열었다면 오른쪽 위 메뉴에서 <b>다른 브라우저로 열기</b>를 눌러 <b>크롬이나 사파리</b>로 열어 주세요.</p>' : '';
  $('camMsg').innerHTML = `<div><svg class="cam-ic"><use href="#i-cam"/></svg><p>${why}</p>${tip}<button class="btn-accent" id="camRetry">다시 시도</button><br><a class="link" href="#/">홈으로</a></div>`;
  $('camMsg').hidden = false;
  $('camRetry').onclick = () => startCamera();
  hint('');
}
function stopCamera() {
  running = false;
  clearTimeout(timer);
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
  prevThumb = null;
}

// 화면의 가이드 네모 → 영상 좌표
function guideInVideo() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const box = $('v-scan').getBoundingClientRect(), g = $('guide').getBoundingClientRect();
  const s = Math.max(box.width / vw, box.height / vh);
  const ox = (box.width - vw * s) / 2, oy = (box.height - vh * s) / 2;
  return { x: (g.left - box.left - ox) / s, y: (g.top - box.top - oy) / s, w: g.width / s, h: g.height / s, vw, vh };
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
function capturePhoto() {
  const g = guideInVideo();
  const side = Math.min(g.w, g.h);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  cv.getContext('2d').drawImage(video, g.x + (g.w - side) / 2, g.y + (g.h - side) / 2, side, side, 0, 0, 256, 256);
  return cv.toDataURL('image/jpeg', 0.75);
}

function tick() {
  if (!running) return;
  if (!paused && !regOpen && video.readyState >= 2 && video.videoWidth) {
    try { step(); } catch (e) { console.error(e); }
  }
  timer = setTimeout(tick, 120);
}

function step() {
  const f = grabFrame();
  const I = integral(toGray(f.data, f.W, f.H, 4), f.W, f.H);
  // 움직임 확인: 가이드 영역 16x16 축소본을 이전 프레임과 비교
  const thumb = sample(I, f.guide.x0, f.guide.y0, f.guide.x1, f.guide.y1, 16);
  let diff = 255;
  if (prevThumb) { diff = 0; for (let i = 0; i < 256; i++) diff += Math.abs(thumb[i] - prevThumb[i]); diff /= 256; }
  prevThumb = thumb;
  if (diff > 7) { stableCount = 0; return; }
  if (++stableCount < 2) return;
  if (mode === 'sticker') { stickerStep(I, f.guide, thumb, stkUI); return; }

  const { queries } = makeQueries(f.data, f.W, f.H, f.guide);
  const top = bestMatches(D.db, queries, 5);
  const ids = top.map(t => D.cards[t.index][0]);
  const best = top[0];
  if (!best || best.score > ACCEPT) {
    if (++cst.miss >= 2) { cst.armed = true; cst.pending = null; }
    if (cst.armed) hint('카드를 네모 안에 맞춰 주세요');
    return;
  }
  cst.miss = 0;
  if (!cst.armed && cst.lastIds.slice(0, 3).includes(ids[0])) return; // 방금 센 카드가 그대로 있음
  if (!cst.pending || !ids.slice(0, 3).includes(cst.pending)) { cst.pending = ids[0]; hint('인식 중…'); return; }
  cst.armed = false; cst.lastIds = ids; cst.pending = null;
  const alts = top.filter(t => t.score <= ACCEPT + 10).map(t => D.cards[t.index][0]).filter(x => x !== ids[0]);
  const it = addItem(ids[0], alts.slice(0, 4));
  const c = card(it.id);
  showPop({ price: itemKrw(it), name: `${cardName(c)} · ${c[2]}/${c[4] || '?'}`, wrong: '다른 카드예요', onWrong: () => openDetail(it) });
}

// 띠부씰 스캔이 쓰는 화면 기능
const stkUI = {
  hint,
  pop: n => showPop({ price: stkPrice(n), name: `${stkName(n)} · No.${pad3(n)}`, wrong: '다른 띠부씰이에요', onWrong: () => beginRegister(true) }),
  offerRegister: show => { $('regBtn').hidden = !show || !$('pop').hidden; },
  resume: () => { regOpen = false; prevThumb = null; },
};
function beginRegister(replace) {
  if (!running) return;
  const f = grabFrame();
  const I = integral(toGray(f.data, f.W, f.H, 4), f.W, f.H);
  const h = stickerHash(I, f.guide.x0, f.guide.y0, f.guide.x1, f.guide.y1);
  regOpen = true;
  $('regBtn').hidden = true;
  $('pop').hidden = true;
  openRegister(h, capturePhoto(), stkUI, replace);
}
$('regBtn').onclick = () => beginRegister(false);

// ---------- 가격 크게 띄우기 ----------
let popTimer = 0, onWrong = null;
function countUp(el, v) {
  const t0 = performance.now(), dur = 500;
  const f = t => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = won(v * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}
function showPop({ price, name, wrong, onWrong: cb }) {
  const pe = $('popPrice');
  pe.classList.toggle('none', price == null);
  if (price == null) pe.textContent = '가격 미입력'; else countUp(pe, price);
  $('popName').textContent = name;
  $('popWrong').textContent = wrong;
  onWrong = cb;
  $('regBtn').hidden = true;
  const pop = $('pop');
  pop.hidden = true; void pop.offsetWidth; pop.hidden = false;
  const g = $('guide');
  g.classList.add('hit');
  renderScanBottom(true);
  navigator.vibrate?.(40);
  beep();
  hint('인식 완료!');
  clearTimeout(popTimer);
  popTimer = setTimeout(() => { pop.hidden = true; g.classList.remove('hit'); }, 2600);
}
$('popWrong').onclick = () => { onWrong?.(); };

function renderScanBottom(bump) {
  const stack = $('stack');
  stack.innerHTML = '';
  const stk = mode === 'sticker';
  stack.classList.toggle('sq', stk);
  let price = null, count;
  if (stk) {
    for (const n of stkRecent.slice(0, 3).reverse()) {
      const p = stkPhoto(n);
      if (!p) continue;
      const im = document.createElement('img'); im.src = p; im.alt = ''; stack.appendChild(im);
    }
    if (stkRecent[0]) price = stkPrice(stkRecent[0]);
    count = stickerTotals().qty;
    $('pillText').textContent = `띠부씰 (${count})`;
  } else {
    for (const it of list.slice(0, 3).reverse()) {
      const c = card(it.id);
      if (!c) continue;
      const im = document.createElement('img'); im.src = imgUrl(c); im.alt = ''; stack.appendChild(im);
    }
    if (list[0]) price = itemKrw(list[0]);
    $('pillText').textContent = `포켓몬 카드 (${list.length})`;
  }
  if (stack.children.length) {
    const sp = document.createElement('span');
    sp.className = 'sp'; sp.textContent = price == null ? '' : won(price);
    stack.appendChild(sp);
  }
  stack.hidden = !stack.children.length;
  const pill = $('pill');
  if (bump) { pill.classList.remove('bump'); void pill.offsetWidth; pill.classList.add('bump'); }
}
$('stack').onclick = () => {
  if (mode === 'sticker') { if (stkRecent[0]) openEdit(stkRecent[0]); }
  else if (list[0]) openDetail(list[0]);
};

let audio;
function beep() {
  try {
    audio ||= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.setValueAtTime(880, audio.currentTime);
    o.frequency.exponentialRampToValueAtTime(1760, audio.currentTime + 0.08);
    g.gain.setValueAtTime(0.09, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.14);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.15);
  } catch {}
}
$('pauseBtn').onclick = () => {
  paused = !paused;
  $('pauseIcon').setAttribute('href', paused ? '#i-play' : '#i-pause');
  $('v-scan').classList.toggle('paused', paused);
  hint(paused ? '일시정지됨' : (mode === 'sticker' ? '띠부씰을 네모 안에 놓아 주세요' : '카드를 네모 안에 맞춰 주세요'));
};

// ================= 스캔한 카드 목록 =================
let selecting = false;
const selected = new Set();
function renderCards() {
  const grid = $('grid');
  grid.innerHTML = '';
  grid.classList.toggle('selecting', selecting);
  for (const it of list) {
    const c = card(it.id);
    if (!c) continue;
    const el = document.createElement('button');
    el.className = 'ccard' + (selected.has(it.uid) ? ' sel' : '');
    el.innerHTML = '<img loading="lazy" alt=""><div class="set"></div><div class="n"></div><div class="p"></div>';
    el.querySelector('img').src = imgUrl(c);
    el.querySelector('.set').textContent = metaText(c);
    el.querySelector('.n').textContent = cardName(c);
    el.querySelector('.p').textContent = won(itemKrw(it));
    if (it.cond !== 'NM') {
      const b = document.createElement('span');
      b.className = 'badge'; b.textContent = CONDS.find(x => x[0] === it.cond)[1].split(' ')[0];
      el.appendChild(b);
    }
    el.onclick = () => {
      if (!selecting) return openDetail(it);
      selected.has(it.uid) ? selected.delete(it.uid) : selected.add(it.uid);
      el.classList.toggle('sel');
      updateSelectTitle();
    };
    grid.appendChild(el);
  }
  $('cardsEmpty').hidden = list.length > 0;
  updateSelectTitle();
  $('cardsTotal').textContent = won(cardsTotal());
  $('priceNote').textContent = list.length ? `시세: TCGplayer 기준${D.priceDate ? ` (${D.priceDate})` : ''} · 환율 1달러 = ${Math.round(rate.KRW).toLocaleString('ko-KR')}원` : '';
}
function updateSelectTitle() {
  $('cardsCount').textContent = selecting ? `${selected.size}장 선택됨` : `${list.length}장 스캔됨`;
  $('selInfo').textContent = selected.size === list.length && list.length ? '선택 해제' : '전체 선택';
}
function setSelecting(on) {
  selecting = on;
  selected.clear();
  $('selectBtn').textContent = on ? '완료' : '선택';
  $('selectBtn').classList.toggle('done', on);
  $('selectBar').hidden = !on;
  renderCards();
}
$('selectBtn').onclick = () => setSelecting(!selecting);
$('selAll').onclick = () => {
  if (selected.size === list.length) selected.clear(); else list.forEach(it => selected.add(it.uid));
  renderCards();
};
$('selDel').onclick = () => {
  if (!selected.size || !confirm(`${selected.size}장을 삭제할까요?`)) return;
  const n = selected.size;
  setList(list.filter(it => !selected.has(it.uid)));
  toast(`${n}장 삭제했어요`);
  setSelecting(false);
};

// ================= 카드 상세 =================
let detailItem = null;
function openDetail(it) {
  detailItem = it;
  const c = card(it.id);
  $('detImg').src = imgUrl(c);
  $('detName').textContent = cardName(c);
  $('detEn').textContent = cardName(c) !== c[1] ? c[1] : '';
  $('detMeta').textContent = metaText(c) + (c[7] ? ` · ${c[7]}` : '');
  $('detLink').href = `https://prices.pokemontcg.io/tcgplayer/${c[0]}`;
  const vs = variantsOf(c);
  $('detVariant').innerHTML = vs.length
    ? vs.map(v => `<option value="${v}">${VARIANT_NAME[v] || v} — ${foreignText(c, v)}</option>`).join('')
    : '<option value="">시세 정보 없음</option>';
  $('detVariant').value = it.variant || vs[0] || '';
  $('detCond').innerHTML = CONDS.map(([k, n, m]) => `<option value="${k}">${n} · ${Math.round(m * 100)}%</option>`).join('');
  $('detCond').value = it.cond;
  updateDetailPrice();
  const alts = $('detAlts');
  alts.innerHTML = '';
  for (const id of it.alts || []) {
    const a = card(id);
    if (!a) continue;
    alts.appendChild(cardRow(a, () => {
      it.alts = [it.id, ...it.alts.filter(x => x !== id)];
      it.id = id; it.variant = null;
      saveList(); openDetail(it); toast('카드를 바꿨어요');
    }));
  }
  if (!alts.children.length) alts.innerHTML = '<p class="note">비슷한 다른 카드가 없어요. 틀렸다면 삭제하고 직접 검색을 써 보세요.</p>';
  openSheet('detailSheet');
}
function updateDetailPrice() {
  const it = detailItem, c = card(it.id);
  $('detPrice').textContent = won(itemKrw(it));
  const f = foreignText(c, it.variant);
  $('detCalc').textContent = f ? `${f} × 상태 ${Math.round(condMul(it.cond) * 100)}%` : '';
}
$('detVariant').onchange = e => { detailItem.variant = e.target.value || null; saveList(); updateDetailPrice(); };
$('detCond').onchange = e => { detailItem.cond = e.target.value; saveList(); updateDetailPrice(); };
$('detDel').onclick = () => {
  setList(list.filter(x => x !== detailItem));
  closeSheet($('detailSheet'));
  toast('삭제했어요');
};
function cardRow(c, onclick) {
  const b = document.createElement('button');
  b.className = 'row';
  b.innerHTML = '<img loading="lazy" alt=""><div class="info"><div class="n"></div><div class="sub"></div></div><div class="p"></div>';
  b.querySelector('img').src = imgUrl(c);
  b.querySelector('.n').textContent = cardName(c);
  b.querySelector('.sub').textContent = metaText(c);
  b.querySelector('.p').textContent = won(krwOf(c));
  b.onclick = onclick;
  return b;
}

// ================= 카드 직접 검색 =================
$('searchBtn').onclick = () => { openSheet('searchSheet'); setTimeout(() => $('searchInput').focus(), 250); };
$('searchInput').oninput = () => {
  const q = $('searchInput').value.trim().toLowerCase();
  const rows = $('searchRows');
  rows.innerHTML = '';
  if (q.length < 2 && !/^\d+$/.test(q)) return;
  const num = q.match(/^#?0*([a-z]{0,3}\d+[a-z]?)\s*(?:\/\s*0*(\d+))?$/i); // 025/165, TG05 등
  const enNames = /[가-힣]/.test(q) ? D.ko.map((k, i) => (k.includes(q) ? D.en[i].toLowerCase() : null)).filter(Boolean) : null;
  const found = [];
  for (const c of D.cards) {
    const name = c[1].toLowerCase();
    let ok;
    if (num) ok = c[2].toLowerCase().replace(/^0+/, '') === num[1] && (!num[2] || String(c[4]) === num[2]);
    else if (enNames) ok = enNames.some(n => name.includes(n));
    else ok = name.includes(q);
    if (ok) { found.push(c); if (found.length >= 50) break; }
  }
  for (const c of found) rows.appendChild(cardRow(c, () => {
    const it = addItem(c[0]);
    closeSheet($('searchSheet'));
    $('searchInput').value = ''; rows.innerHTML = '';
    renderScanBottom(true);
    toast(`${cardName(c)} 추가했어요 · ${won(itemKrw(it))}`);
  }));
  if (!found.length) rows.innerHTML = '<p class="note">찾는 카드가 없어요.</p>';
};

// ================= 시작 =================
bus.addEventListener('change', () => {
  if (!$('v-home').hidden) renderHome();
  if (!$('v-cards').hidden && $('detailSheet').hidden) renderCards();
  if (!$('v-scan').hidden) renderScanBottom();
  if (!$('v-stickers').hidden && $('stkSheet').hidden) renderStickers();
});
initStickers();
route();
loadRate();
loadData().catch(e => { $('homeFoot').textContent = '카드 데이터를 불러오지 못했어요: ' + e.message; });
