import { integral, toGray, sample, bestMatches } from './hash.js';
import { makeQueries } from './scan.js';
import {
  $, bus, D, rate, loadData, loadRate, card, imgUrl, won, metaText, toast, cardName,
  CONDS, condMul, VARIANT_NAME, variantsOf, krwOf, foreignText,
  list, setList, saveList, itemKrw, cardsTotal, addItem, stickerTotals,
} from './store.js';
import { initStickers, renderStickers } from './stickers.js';

const ACCEPT = 25; // 이 점수 이하면 "같은 카드"로 인정 (0~128, 작을수록 닮음. 시뮬레이션: 정답 90%가 20 이하, 카드 없음은 28 이상)

// ================= 화면 이동 =================
const VIEWS = ['home', 'scan', 'cards', 'stickers'];
function route() {
  const name = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'home';
  const view = VIEWS.includes(name) ? name : 'home';
  VIEWS.forEach(v => { $('v-' + v).hidden = v !== view; });
  document.querySelectorAll('.sheet').forEach(s => { s.hidden = true; });
  if (view === 'scan') startCamera(); else stopCamera();
  if (view === 'home') renderHome();
  if (view === 'cards') renderCards();
  if (view === 'stickers') renderStickers();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// 시트(아래에서 올라오는 창)
function openSheet(id) { $(id).hidden = false; }
document.querySelectorAll('.sheet').forEach(s => {
  s.addEventListener('click', e => {
    if (e.target === s || e.target.closest('[data-close]')) closeSheet(s);
  });
});
function closeSheet(s) {
  s.hidden = true;
  if (!$('v-cards').hidden) renderCards();
}

// ================= 홈 =================
function renderHome() {
  const ct = cardsTotal(), st = stickerTotals();
  $('homeTotal').textContent = won(ct + st.krw);
  $('homeCardsN').textContent = `카드 ${list.length}장`;
  $('homeCards').textContent = won(ct);
  $('homeStkN').textContent = `띠부씰 ${st.qty}장`;
  $('homeStk').textContent = won(st.krw);
  const strip = $('homeRecent');
  strip.innerHTML = '';
  if (!D.ready) return;
  for (const it of list.slice(0, 12)) {
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
  if (!strip.children.length) strip.innerHTML = '<div class="blank"><svg><use href="#art-cards"/></svg><span>아직 스캔한 카드가 없어요.<br>카드 스캔으로 시작해 보세요.</span></div>';
  $('homeFoot').innerHTML = `카드 ${D.cards.length.toLocaleString('ko-KR')}장 · 시세 TCGplayer 기준${D.priceDate ? ` (${D.priceDate})` : ''}<br>환율 1달러 = ${Math.round(rate.KRW).toLocaleString('ko-KR')}원`;
}

// ================= 카메라 스캔 =================
const video = $('video'), work = $('work');
const ctx = work.getContext('2d', { willReadFrequently: true });
let stream = null, running = false, paused = false, timer = 0;
let prevThumb = null, stableCount = 0;
const st = { armed: true, lastIds: [], pending: null, miss: 0 };

function hint(t) { $('hint').textContent = t; }

async function startCamera() {
  renderScanBottom();
  if (running) return;
  if (!D.ready) { hint('카드 데이터를 불러오는 중…'); bus.addEventListener('change', () => !$('v-scan').hidden && startCamera(), { once: true }); return; }
  $('camMsg').hidden = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
    });
    if ($('v-scan').hidden) { stopCamera(); return; } // 그 사이 화면을 나갔으면
    video.srcObject = stream;
    await video.play();
    running = true;
    Object.assign(st, { armed: true, pending: null, miss: 0 });
    hint('카드를 네모 안에 맞춰 주세요');
    timer = setTimeout(tick, 300);
  } catch (e) {
    $('camMsg').hidden = false;
    $('camMsg').innerHTML = `카메라를 켤 수 없어요.<br>브라우저 설정에서 카메라 권한을 허용해 주세요.<br><small>(${e.name})</small><br><br><a class="btn-accent" href="#/">홈으로</a>`;
  }
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

function tick() {
  if (!running) return;
  if (!paused && video.readyState >= 2 && video.videoWidth) {
    try { step(); } catch (e) { console.error(e); }
  }
  timer = setTimeout(tick, 120);
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
  const top = bestMatches(D.db, queries, 5);
  const ids = top.map(t => D.cards[t.index][0]);
  const best = top[0];

  if (!best || best.score > ACCEPT) {
    if (++st.miss >= 2) { st.armed = true; st.pending = null; }
    if (st.armed) hint('카드를 네모 안에 맞춰 주세요');
    return;
  }
  st.miss = 0;
  // 방금 넣은 카드가 아직 그대로 있으면 다시 세지 않음
  if (!st.armed && st.lastIds.slice(0, 3).includes(ids[0])) return;
  // 연속 2번 같은 카드(또는 같은 그림의 카드)로 나와야 확정
  if (!st.pending || !ids.slice(0, 3).includes(st.pending)) { st.pending = ids[0]; hint('인식 중…'); return; }

  st.armed = false; st.lastIds = ids; st.pending = null;
  const alts = top.filter(t => t.score <= ACCEPT + 10).map(t => D.cards[t.index][0]).filter(x => x !== ids[0]);
  const it = addItem(ids[0], alts.slice(0, 4));
  showPop(it);
}

let popTimer = 0, lastItem = null;
// 가격 숫자가 0부터 빠르게 올라가는 효과
function countUp(el, v) {
  if (v == null) { el.textContent = won(null); return; }
  const t0 = performance.now(), dur = 550;
  const f = t => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = won(v * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}
function showPop(it) {
  const c = card(it.id);
  lastItem = it;
  countUp($('popPrice'), itemKrw(it));
  $('popName').textContent = `${cardName(c)} · ${c[2]}/${c[4] || '?'}`;
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

function renderScanBottom(bump) {
  const it = list[0], c = it && card(it.id);
  $('lastImg').hidden = !c;
  $('lastPh').hidden = !!c;
  if (c) {
    if (bump) { $('lastImg').style.animation = 'none'; void $('lastImg').offsetWidth; $('lastImg').style.animation = ''; }
    $('lastImg').src = imgUrl(c);
    $('lastName').textContent = cardName(c);
    $('lastPrice').textContent = won(itemKrw(it));
  } else {
    $('lastName').textContent = '카드를 비춰 주세요';
    $('lastPrice').textContent = '';
  }
  $('pillCount').textContent = list.length;
  const pill = $('pill');
  if (bump) { pill.classList.remove('bump'); void pill.offsetWidth; pill.classList.add('bump'); }
}
$('stack').onclick = () => { if (list[0]) openDetail(list[0]); };
$('popWrong').onclick = () => { if (lastItem) openDetail(lastItem); };

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
  hint(paused ? '일시정지됨' : '카드를 네모 안에 맞춰 주세요');
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
      b.className = 'cond'; b.textContent = CONDS.find(x => x[0] === it.cond)[1].split(' ')[0];
      el.appendChild(b);
    }
    el.onclick = () => {
      if (!selecting) return openDetail(it);
      selected.has(it.uid) ? selected.delete(it.uid) : selected.add(it.uid);
      el.classList.toggle('sel');
      $('selInfo').textContent = `${selected.size}장 선택`;
    };
    grid.appendChild(el);
  }
  $('cardsEmpty').hidden = list.length > 0;
  $('cardsCount').textContent = `${list.length}장 스캔됨`;
  $('cardsTotal').textContent = won(cardsTotal());
  $('priceNote').textContent = `시세: TCGplayer 기준${D.priceDate ? ` (${D.priceDate})` : ''} · 환율 1달러 = ${Math.round(rate.KRW).toLocaleString('ko-KR')}원 · 카드를 누르면 상태·종류를 바꿀 수 있어요`;
}
function setSelecting(on) {
  selecting = on;
  selected.clear();
  $('selectBtn').textContent = on ? '완료' : '선택';
  $('selectBar').hidden = !on;
  $('selInfo').textContent = '0장 선택';
  renderCards();
}
$('selectBtn').onclick = () => setSelecting(!selecting);
$('selAll').onclick = () => {
  if (selected.size === list.length) selected.clear(); else list.forEach(it => selected.add(it.uid));
  $('selInfo').textContent = `${selected.size}장 선택`;
  renderCards();
};
$('selDel').onclick = () => {
  if (!selected.size || !confirm(`${selected.size}장을 삭제할까요?`)) return;
  setList(list.filter(it => !selected.has(it.uid)));
  toast(`${selected.size}장 삭제했어요`);
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
  if (!alts.children.length) alts.innerHTML = '<p class="note">비슷한 다른 카드가 없어요. 틀렸다면 삭제하고 “직접 검색”을 써 보세요.</p>';
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
  renderScanBottom();
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
  // 한글로 쓰면 영어 이름으로 바꿔서 찾기
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
    addItem(c[0]);
    closeSheet($('searchSheet'));
    $('searchInput').value = ''; rows.innerHTML = '';
    renderScanBottom(true);
    toast(`${cardName(c)} 추가했어요`);
  }));
  if (!found.length) rows.innerHTML = '<p class="note">찾는 카드가 없어요.</p>';
};

// ================= 시작 =================
bus.addEventListener('change', () => {
  if (!$('v-home').hidden) renderHome();
  if (!$('v-cards').hidden && $('detailSheet').hidden) renderCards();
  if (!$('v-scan').hidden) renderScanBottom();
});
initStickers();
route();
loadRate();
loadData().catch(e => {
  $('homeFoot').textContent = '카드 데이터를 불러오지 못했어요: ' + e.message;
});
