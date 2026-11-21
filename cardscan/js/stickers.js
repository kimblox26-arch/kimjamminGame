// 띠부씰: 스캔(내가 한 번 등록한 띠부씰을 지문으로 알아봄) + 내 띠부씰 목록 + 정보 수정
import { $, D, won, toast, stickers, saveStickers, stickerTotals, load, save, stkPrice, REF, REF_NOTE } from './store.js?v=7';
import { stickerHash, bestMatches } from './hash.js?v=7';

const GENS = [[1, 151], [152, 251], [252, 386], [387, 493], [494, 649], [650, 721], [722, 809], [810, 905], [906, 1025]];
const photoKey = n => 'pc.stkphoto.' + n;
const pad = n => String(n).padStart(3, '0');
export const stkName = n => D.ko[n - 1] || `No.${n}`;
export const stkPhoto = n => load(photoKey(n), null);

// ================= 지문 저장소 =================
let hashes = load('pc.stkhash.v1', []); // [{ n, h: [4 x uint32] }]
let hdb = new Uint32Array(0);
const rebuild = () => { hdb = new Uint32Array(hashes.flatMap(x => x.h)); };
const saveHashes = () => { save('pc.stkhash.v1', hashes); rebuild(); };
rebuild();

// ================= 스캔 =================
const ACCEPT = 30; // 같은 띠부씰로 인정하는 거리 (0~128). 시뮬레이션: 등록한 것 90%가 32 이하, 미등록은 34 이상
const st = { armed: true, last: 0, pending: 0, miss: 0, unknown: 0 };
export const recent = [];          // 최근 스캔한 도감번호
let lastScan = null;               // { n, added: 지문 객체 or null }

function queries(I, g) {
  const out = [];
  const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2, w = g.x1 - g.x0, h = g.y1 - g.y0;
  for (const s of [0.9, 0.96, 1.02, 1.08])
    for (const dx of [-0.04, 0, 0.04])
      for (const dy of [-0.04, 0, 0.04]) {
        const nw = w * s, nh = h * s, x = cx + dx * w, y = cy + dy * h;
        out.push(stickerHash(I, x - nw / 2, y - nh / 2, x + nw / 2, y + nh / 2));
      }
  return out;
}

export function resetScan() { Object.assign(st, { armed: true, pending: 0, miss: 0, unknown: 0 }); }

// 카메라 한 장면 처리. ui = { hint, pop, offerRegister }
export function stickerStep(I, guide, thumb, ui) {
  // 뭔가 놓여 있는지: 축소본 밝기의 표준편차
  let m = 0; for (const v of thumb) m += v; m /= thumb.length;
  let sd = 0; for (const v of thumb) sd += (v - m) ** 2; sd = Math.sqrt(sd / thumb.length);
  const present = sd > 15; // 시뮬레이션: 띠부씰 21 이상, 빈 바닥 11 이하

  let best = null;
  if (hdb.length) {
    const top = bestMatches(hdb, queries(I, guide), 1)[0];
    if (top && top.score <= ACCEPT) best = { n: hashes[top.index].n, score: top.score };
  }
  if (!best) {
    st.pending = 0;
    if (!present) {
      st.unknown = 0;
      if (++st.miss >= 2) st.armed = true;
      ui.offerRegister(false);
      ui.hint('띠부씰을 네모 안에 놓아 주세요');
      return;
    }
    st.miss = 0;
    st.unknown++;
    if (!st.armed && st.unknown >= 6) st.armed = true; // 다른 띠부씰로 바뀐 것
    if (st.armed && st.unknown >= 3) { ui.offerRegister(true); ui.hint('처음 보는 띠부씰이에요'); }
    return;
  }
  st.miss = 0; st.unknown = 0;
  ui.offerRegister(false);
  if (!st.armed && st.last === best.n) return;          // 방금 센 것이 그대로 있음
  if (st.pending !== best.n) { st.pending = best.n; ui.hint('인식 중…'); return; } // 두 번 연속 같아야 확정

  st.armed = false; st.last = best.n; st.pending = 0;
  let added = null;
  if (best.score > 8 && hashes.filter(x => x.n === best.n).length < 6) { // 조금 다르게 보였으면 지문 추가 (점점 잘 알아봄)
    added = { n: best.n, h: stickerHash(I, guide.x0, guide.y0, guide.x1, guide.y1) };
    hashes.push(added); saveHashes();
  }
  addOne(best.n);
  lastScan = { n: best.n, added };
  ui.pop(best.n);
}

function addOne(n) {
  stickers[n] = { ...(stickers[n] || {}), qty: (stickers[n]?.qty || 0) + 1 };
  saveStickers();
  recent.unshift(n);
}

// ================= 등록 (어떤 포켓몬인지 고르기) =================
let reg = null; // { h, photo, ui, replace }
export function openRegister(h, photo, ui, replace = false) {
  reg = { h, photo, ui, replace };
  $('regPhoto').src = photo;
  $('regSearch').value = '';
  renderRegRows();
  $('regSheet').hidden = false;
}
function renderRegRows() {
  const q = $('regSearch').value.trim().toLowerCase();
  const rows = $('regRows');
  rows.innerHTML = '';
  let count = 0;
  for (let n = 1; n <= D.ko.length && count < 60; n++) {
    if (q && !(D.ko[n - 1].includes(q) || D.en[n - 1].toLowerCase().includes(q) || String(n) === q.replace(/^0+/, ''))) continue;
    if (!q && n > 151) break; // 처음엔 1세대만
    rows.appendChild(stkRow(n, () => chooseRegister(n)));
    count++;
  }
  if (!rows.children.length) rows.innerHTML = '<p class="note">찾는 포켓몬이 없어요.</p>';
}
function chooseRegister(n) {
  if (reg.replace && lastScan) { // "다른 띠부씰이에요": 방금 센 것 되돌리기
    const p = lastScan.n;
    if (stickers[p]?.qty) { stickers[p].qty--; }
    if (lastScan.added) hashes = hashes.filter(x => x !== lastScan.added);
    recent.shift();
  }
  hashes.push({ n, h: reg.h });
  saveHashes();
  if (!stkPhoto(n)) save(photoKey(n), reg.photo);
  addOne(n);
  lastScan = { n, added: null };
  Object.assign(st, { armed: false, last: n, pending: 0, unknown: 0 });
  $('regSheet').hidden = true;
  reg.ui.pop(n);
  reg.ui.resume();
  toast(`${stkName(n)} 등록했어요. 다음부터 자동으로 알아봐요`);
}

function stkRow(n, onclick) {
  const b = document.createElement('button');
  b.className = 'row';
  const photo = stkPhoto(n);
  b.innerHTML = `<div class="art">${photo ? '' : stickerArt(n, true)}</div><div class="info"><div class="n"></div><div class="sub">No.${pad(n)} · ${D.en[n - 1]}</div></div><div class="p"></div>`;
  if (photo) { const im = new Image(); im.src = photo; im.style.cssText = 'width:46px;height:46px;border-radius:50%;object-fit:cover'; b.querySelector('.art').appendChild(im); }
  b.querySelector('.n').textContent = stkName(n);
  const p = stkPrice(n);
  b.querySelector('.p').textContent = p ? won(p) : '';
  b.onclick = onclick;
  return b;
}

// 귀퉁이가 살짝 떨어진 동그란 스티커 그림 (사진이 없을 때)
export function stickerArt(n, have) {
  const body = 'M56.43 24.11A26 26 0 1 1 40.89 8.57Z';
  const flap = 'M56.43 24.11L40.89 8.57Q45.03 19.97 56.43 24.11Z';
  if (!have) return `<svg viewBox="0 0 64 64"><path d="${body}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="4 4"/><text x="32" y="39" text-anchor="middle" font-size="15" font-weight="800" fill="currentColor">${n}</text></svg>`;
  const h = (n * 47) % 360;
  return `<svg viewBox="0 0 64 64"><defs><linearGradient id="sg${n}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 95% 68%)"/><stop offset="1" stop-color="hsl(${(h + 55) % 360} 85% 55%)"/></linearGradient></defs>` +
    `<path d="${body}" fill="url(#sg${n})" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/>` +
    `<path d="${flap}" fill="#fff" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<path d="M32 19l2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4z" fill="#fff" opacity=".9"/>` +
    `<text x="32" y="51" text-anchor="middle" font-size="11" font-weight="900" fill="#fff">${n}</text></svg>`;
}

// ================= 내 띠부씰 목록 =================
let filter = 'have';
let editing = 0, qty = 0;

export function initStickers() {
  const chips = [['have', '내 띠부씰'], ...GENS.map((_, i) => ['g' + (i + 1), `${i + 1}세대`]), ['all', '전체 도감']];
  $('stkGens').innerHTML = chips.map(([k, t]) => `<button class="chip" data-k="${k}">${t}</button>`).join('');
  $('stkGens').onclick = e => { const k = e.target.dataset?.k; if (k) { filter = k; renderStickers(); } };
  $('stkSearch').oninput = renderStickers;
  $('regSearch').oninput = renderRegRows;
  $('stkMinus').onclick = () => { qty = Math.max(0, qty - 1); $('stkQty').textContent = qty; };
  $('stkPlus').onclick = () => { qty = Math.min(999, qty + 1); $('stkQty').textContent = qty; };
  $('stkFile').onchange = onPhoto;
  $('stkSave').onclick = saveEdit;
  $('stkPrice').oninput = showEditPrice;
  $('stkClear').onclick = () => {
    if (!confirm('이 띠부씰 기록과 등록된 모습을 지울까요?')) return;
    delete stickers[editing];
    hashes = hashes.filter(x => x.n !== editing); saveHashes();
    try { localStorage.removeItem(photoKey(editing)); } catch {}
    saveStickers();
    $('stkSheet').hidden = true;
    renderStickers();
    toast('기록을 지웠어요');
  };
}

export function renderStickers() {
  document.querySelectorAll('#stkGens .chip').forEach(c => c.classList.toggle('on', c.dataset.k === filter));
  const t = stickerTotals();
  $('stkCount').textContent = `띠부씰 ${t.qty}장`;
  $('stkTotal').textContent = won(t.krw);
  const grid = $('stkGrid');
  grid.innerHTML = '';
  if (!D.ko.length) return;
  const [a, b] = filter.startsWith('g') ? GENS[Number(filter.slice(1)) - 1] : [1, D.ko.length];
  let have = 0;
  for (let n = a; n <= b; n++) if (stickers[n]?.qty) have++;
  $('stkProg').textContent = filter === 'have' ? `${t.kinds}종 모음` : `${filter.startsWith('g') ? filter.slice(1) + '세대' : '전체'} ${b - a + 1}종 중 ${have}종 모음`;

  const q = $('stkSearch').value.trim().toLowerCase();
  const frag = document.createDocumentFragment();
  for (let n = a; n <= b; n++) {
    const s = stickers[n];
    if (filter === 'have' && !s?.qty) continue;
    if (q && !(D.ko[n - 1].includes(q) || D.en[n - 1].toLowerCase().includes(q) || String(n) === q.replace(/^0+/, ''))) continue;
    const el = document.createElement('button');
    el.className = 'ccard sq' + (s?.qty ? '' : ' dim');
    const photo = s?.qty ? stkPhoto(n) : null;
    el.innerHTML = (photo ? '<img alt="">' : `<div class="ph">${stickerArt(n, !!s?.qty)}</div>`) +
      `<div class="set">No.${pad(n)}</div><div class="n"></div><div class="p"></div>` + (s?.qty ? `<span class="badge">${s.qty}장</span>` : '');
    if (photo) el.querySelector('img').src = photo;
    el.querySelector('.n').textContent = stkName(n);
    const p = stkPrice(n);
    const pe = el.querySelector('.p');
    pe.textContent = p ? won(p) : '가격 미입력';
    if (!p) pe.classList.add('none');
    el.onclick = () => openEdit(n);
    frag.appendChild(el);
  }
  grid.appendChild(frag);
  if (!grid.children.length) grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><svg class="empty-art"><use href="#art-sticker"/></svg><p>${filter === 'have' ? '아직 스캔한 띠부씰이 없어요.' : '찾는 포켓몬이 없어요.'}</p>${filter === 'have' ? '<a class="btn-accent" href="#/scan/sticker">띠부씰 스캔하기</a>' : ''}</div>`;
}

export function openEdit(n) {
  editing = n;
  const s = stickers[n] || {};
  qty = s.qty ?? 1;
  $('stkNo').textContent = `No.${pad(n)}`;
  $('stkName').textContent = stkName(n);
  $('stkQty').textContent = qty;
  $('stkPrice').value = s.price || '';
  $('stkMemo').value = s.memo ?? '';
  setPhoto(stkPhoto(n));
  showEditPrice();
  const ko = stkName(n);
  $('stkBunjang').href = `https://m.bunjang.co.kr/search/products?q=${encodeURIComponent('띠부씰 ' + ko)}`;
  $('stkNaver').href = `https://search.naver.com/search.naver?query=${encodeURIComponent(ko + ' 띠부씰 시세')}`;
  $('stkClear').hidden = !stickers[n];
  $('stkSheet').hidden = false;
}
function showEditPrice() {
  const mine = Number($('stkPrice').value) || 0;
  const ref = REF[editing];
  const p = mine || ref;
  $('stkPriceShow').textContent = p ? won(p) : '가격 미입력';
  $('stkPriceShow').classList.toggle('none', !p);
  $('stkRefNote').textContent = mine ? '내가 적은 가격' : ref ? `참고 시세 · ${REF_NOTE}` : '시세 데이터가 없어요. 아래에서 찾아보고 적어 주세요.';
}
function setPhoto(src) {
  $('stkPhoto').hidden = !src;
  if (src) $('stkPhoto').src = src;
  $('stkPhotoTxt').hidden = !!src;
}
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
  } catch { toast('사진을 읽지 못했어요'); }
}
function saveEdit() {
  const price = Math.max(0, Math.round(Number($('stkPrice').value) || 0));
  const memo = $('stkMemo').value.trim();
  if (!qty && !price && !memo) delete stickers[editing];
  else stickers[editing] = { qty, price, memo };
  saveStickers();
  $('stkSheet').hidden = true;
  renderStickers();
  toast(`${stkName(editing)} 저장했어요`);
}
