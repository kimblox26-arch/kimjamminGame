// 띠부씰 기록장: 도감 번호별로 가진 개수·가격·메모·사진을 기록한다
import { $, D, bus, won, toast, stickers, saveStickers, stickerTotals, load, save } from './store.js';

const GENS = [[1, 151], [152, 251], [252, 386], [387, 493], [494, 649], [650, 721], [722, 809], [810, 905], [906, 1025]];
let filter = 'g1';
let editing = 0, qty = 0;
const photoKey = n => 'pc.stkphoto.' + n;
const pad = n => String(n).padStart(3, '0');

export function initStickers() {
  const chips = [['have', '모은 것'], ...GENS.map((_, i) => ['g' + (i + 1), `${i + 1}세대`]), ['all', '전체']];
  $('stkGens').innerHTML = chips.map(([k, t]) => `<button class="chip" data-k="${k}">${t}</button>`).join('');
  $('stkGens').onclick = e => {
    const k = e.target.dataset?.k;
    if (k) { filter = k; renderStickers(); }
  };
  $('stkSearch').oninput = renderStickers;
  $('stkMinus').onclick = () => { qty = Math.max(0, qty - 1); $('stkQty').textContent = qty; };
  $('stkPlus').onclick = () => { qty = Math.min(999, qty + 1); $('stkQty').textContent = qty; };
  $('stkFile').onchange = onPhoto;
  $('stkSave').onclick = saveEdit;
  $('stkClear').onclick = () => {
    if (!confirm('이 띠부씰 기록을 지울까요?')) return;
    delete stickers[editing];
    try { localStorage.removeItem(photoKey(editing)); } catch {}
    saveStickers();
    $('stkSheet').hidden = true;
    renderStickers();
    toast('기록을 지웠어요');
  };
  bus.addEventListener('change', () => { if (!$('v-stickers').hidden && $('stkSheet').hidden) renderStickers(); });
}

function range() {
  if (filter.startsWith('g')) return GENS[Number(filter.slice(1)) - 1];
  return [1, D.ko.length];
}

export function renderStickers() {
  document.querySelectorAll('#stkGens .chip').forEach(c => c.classList.toggle('on', c.dataset.k === filter));
  const t = stickerTotals();
  $('stkKinds').textContent = `${t.kinds}종`;
  $('stkQtyAll').textContent = `${t.qty}장`;
  $('stkTotal').textContent = won(t.krw);
  const grid = $('stkGrid');
  grid.innerHTML = '';
  if (!D.ko.length) { grid.innerHTML = '<p class="stk-empty">불러오는 중…</p>'; return; }

  const [a, b] = range();
  let have = 0;
  for (let n = a; n <= b; n++) if (stickers[n]?.qty) have++;
  const label = filter.startsWith('g') ? `${filter.slice(1)}세대` : '전체';
  $('stkProg').textContent = `${label} ${b - a + 1}종 중 ${have}종 모음`;
  $('stkBar').style.width = `${(100 * have) / (b - a + 1)}%`;

  const q = $('stkSearch').value.trim().toLowerCase();
  const frag = document.createDocumentFragment();
  for (let n = a; n <= b; n++) {
    const s = stickers[n];
    if (filter === 'have' && !s?.qty) continue;
    const ko = D.ko[n - 1];
    if (q && !(ko.includes(q) || D.en[n - 1].toLowerCase().includes(q) || String(n) === q.replace(/^0+/, ''))) continue;
    const el = document.createElement('button');
    el.className = 'stk' + (s?.qty ? ' have' : '');
    const photo = s?.qty ? load(photoKey(n), null) : null;
    el.innerHTML = `<div class="art">${photo ? '<img alt="">' : stickerArt(n, !!s?.qty)}</div><div class="no">No.${pad(n)}</div><div class="nm"></div>` +
      (s?.qty ? `<span class="qty">${s.qty}장</span>` : '');
    if (photo) el.querySelector('img').src = photo;
    el.querySelector('.nm').textContent = ko;
    el.onclick = () => openEdit(n);
    frag.appendChild(el);
  }
  grid.appendChild(frag);
  if (!grid.children.length) grid.innerHTML = `<p class="stk-empty">${filter === 'have' ? '아직 기록한 띠부씰이 없어요.<br>세대 탭에서 포켓몬을 눌러 기록해 보세요.' : '찾는 포켓몬이 없어요.'}</p>`;
}

// 귀퉁이가 살짝 떨어진 동그란 스티커 그림. 모은 것은 번호마다 다른 색, 안 모은 것은 점선
function stickerArt(n, have) {
  const body = 'M56.43 24.11A26 26 0 1 1 40.89 8.57Z';
  const flap = 'M56.43 24.11L40.89 8.57Q45.03 19.97 56.43 24.11Z';
  if (!have) return `<svg viewBox="0 0 64 64"><path d="${body}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="4 4"/><text x="32" y="39" text-anchor="middle" font-size="15" font-weight="900" fill="currentColor">${n}</text></svg>`;
  const h = (n * 47) % 360;
  return `<svg viewBox="0 0 64 64"><defs><linearGradient id="sg${n}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 95% 68%)"/><stop offset="1" stop-color="hsl(${(h + 55) % 360} 85% 55%)"/></linearGradient></defs>` +
    `<path d="${body}" fill="url(#sg${n})" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/>` +
    `<path d="${flap}" fill="#fff" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<path d="M32 19l2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4z" fill="#fff" opacity=".9"/>` +
    `<text x="32" y="51" text-anchor="middle" font-size="11" font-weight="900" fill="#fff">${n}</text></svg>`;
}

function openEdit(n) {
  editing = n;
  const s = stickers[n] || {};
  qty = s.qty ?? 1;
  const ko = D.ko[n - 1];
  $('stkNo').textContent = `No.${pad(n)}`;
  $('stkName').textContent = ko;
  $('stkEn').textContent = D.en[n - 1];
  $('stkQty').textContent = qty;
  $('stkPrice').value = s.price ?? '';
  $('stkMemo').value = s.memo ?? '';
  setPhoto(load(photoKey(n), null));
  $('stkBunjang').href = `https://m.bunjang.co.kr/search/products?q=${encodeURIComponent('띠부씰 ' + ko)}`;
  $('stkNaver').href = `https://search.naver.com/search.naver?query=${encodeURIComponent(ko + ' 띠부씰 시세')}`;
  $('stkClear').hidden = !stickers[n];
  $('stkSheet').hidden = false;
}

function setPhoto(src) {
  $('stkPhoto').hidden = !src;
  if (src) $('stkPhoto').src = src;
  $('stkPhotoTxt').hidden = !!src;
}

// 사진을 정사각형 256px JPEG 로 줄여서 저장
async function onPhoto(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const bmp = await createImageBitmap(file);
    const side = Math.min(bmp.width, bmp.height);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    cv.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
    const url = cv.toDataURL('image/jpeg', 0.72);
    if (!save(photoKey(editing), url)) { toast('저장 공간이 부족해서 사진을 못 넣었어요'); return; }
    setPhoto(url);
  } catch {
    toast('사진을 읽지 못했어요');
  }
}

function saveEdit() {
  const price = Math.max(0, Math.round(Number($('stkPrice').value) || 0));
  const memo = $('stkMemo').value.trim();
  if (!qty && !price && !memo) delete stickers[editing];
  else stickers[editing] = { qty, price, memo };
  saveStickers();
  $('stkSheet').hidden = true;
  renderStickers();
  toast(`${D.ko[editing - 1]} 저장했어요`);
}
