// 공용 데이터(카드 DB, 포켓몬 이름, 환율)와 저장소
export const $ = id => document.getElementById(id);
export const bus = new EventTarget();
export const changed = () => bus.dispatchEvent(new Event('change'));

const IMG = 'https://images.pokemontcg.io/';
export const D = {
  cards: [],        // [id, name, number, setName, printedTotal, img, prices, rarity]
  db: null,         // Uint32Array, 카드당 4칸 (앞쪽 hashed 장만)
  byId: new Map(),
  priceDate: null,
  ko: [], en: [],   // 포켓몬 이름 (도감번호-1 순서)
  ready: false,
};
export const rate = { KRW: 1400, EUR: 0.92 };

export function load(key, def) {
  try { const v = localStorage.getItem(key); return v == null ? def : JSON.parse(v); } catch { return def; }
}
export function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
}

export async function loadData() {
  const [meta, bin, names] = await Promise.all([
    fetch('data/cards.json').then(r => r.json()),
    fetch('data/hashes.bin').then(r => r.arrayBuffer()),
    fetch('data/pokemon-names.json').then(r => r.json()),
  ]);
  D.cards = meta.cards;
  D.priceDate = meta.priceDate;
  D.db = new Uint32Array(bin);
  D.ko = names.ko; D.en = names.en;
  D.cards.forEach((c, i) => D.byId.set(c[0], i));
  buildNameIndex();
  D.ready = true;
  changed();
}

export async function loadRate() {
  const saved = load('pc.rate', null);
  if (saved && Date.now() - saved.t < 12 * 3600e3) { Object.assign(rate, saved.rate); return; }
  try {
    const j = await fetch('https://open.er-api.com/v6/latest/USD').then(r => r.json());
    if (j.rates?.KRW) {
      Object.assign(rate, { KRW: j.rates.KRW, EUR: j.rates.EUR || 0.92 });
      save('pc.rate', { t: Date.now(), rate: { ...rate } });
      changed();
    }
  } catch {}
}

// ---------- 표시 도우미 ----------
export const card = id => D.cards[D.byId.get(id)];
export const imgUrl = c => c[5].startsWith('http') ? c[5] : IMG + c[5];
export const won = v => v == null ? '시세 없음' : '₩' + (Math.round(v / 10) * 10).toLocaleString('ko-KR');
export const metaText = c => `${c[3]} · ${c[2]}${c[4] ? '/' + c[4] : ''}`;
let toastTimer = 0;
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- 영어 카드 이름 → 한글 ----------
let nameRe = null;
const nameIdx = new Map();
const norm = s => s.toLowerCase().replace(/[’']/g, "'");
export function buildNameIndex() {
  D.en.forEach((n, i) => nameIdx.set(norm(n).replace(/\s/g, ''), i));
  const esc = D.en.map(norm).sort((a, b) => b.length - a.length)
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]").replace(/([♀♂])/g, '\\s?$1'));
  nameRe = new RegExp(`(^|[^a-z])(${esc.join('|')})(?![a-z])`, 'gi');
}
// 카드 이름 속 포켓몬 영어 이름을 모두 한글로 (예: "Charizard & Braixen-GX" → "리자몽 & 테르나-GX")
export function koName(en) {
  if (!nameRe) return null;
  let hit = false;
  const out = en.replace(nameRe, (m, pre, nm) => {
    const i = nameIdx.get(norm(nm).replace(/\s/g, ''));
    if (i == null) return m;
    hit = true;
    return pre + D.ko[i];
  });
  return hit ? out : null;
}
export const cardName = c => koName(c[1]) || c[1];

// ---------- 가격 ----------
export const CONDS = [
  ['NM', '최상 (새것 같음)', 1], ['LP', '좋음 (살짝 사용감)', 0.85],
  ['MP', '보통 (사용감 있음)', 0.7], ['HP', '나쁨 (많이 닳음)', 0.5], ['DMG', '손상 (찢김·접힘)', 0.3],
];
export const condMul = k => CONDS.find(x => x[0] === k)?.[2] ?? 1;
export const VARIANT_NAME = { n: '일반', h: '홀로', r: '리버스 홀로', fh: '1판 홀로', fn: '1판 일반',
  uh: '무제한 홀로', u: '무제한', f: '1판', eur: '유럽 시세' };
const ORDER = ['n', 'h', 'fh', 'fn', 'uh', 'u', 'f', 'r'];
export function variantsOf(c) {
  const p = c[6] || {};
  const keys = Object.keys(p).filter(k => k !== 'eur');
  const rank = k => { const i = ORDER.indexOf(k); return i < 0 ? 99 : i; };
  keys.sort((a, b) => rank(a) - rank(b));
  if (!keys.length && p.eur) keys.push('eur');
  return keys;
}
const pickVariant = (c, v) => (v && (c[6] || {})[v] != null ? v : variantsOf(c)[0]);
export function krwOf(c, variant) {
  const v = pickVariant(c, variant);
  if (!v) return null;
  const p = c[6];
  return v === 'eur' ? p.eur * rate.KRW / rate.EUR : p[v] * rate.KRW;
}
export function foreignText(c, variant) {
  const v = pickVariant(c, variant);
  if (!v) return '';
  return v === 'eur' ? `€${c[6].eur}` : `$${c[6][v]}`;
}

// ---------- 스캔한 카드 목록 ----------
export let list = load('cardscan.list.v1', []);
export const saveList = () => { save('cardscan.list.v1', list); changed(); };
export function setList(l) { list = l; saveList(); }
export function itemKrw(it) {
  const c = card(it.id);
  const base = c && krwOf(c, it.variant);
  return base == null ? null : base * condMul(it.cond);
}
export const cardsTotal = () => list.reduce((s, it) => s + (itemKrw(it) || 0), 0);
export function addItem(id, alts = []) {
  const it = { uid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), id, cond: 'NM', variant: null, alts };
  list.unshift(it);
  saveList();
  return it;
}

// ---------- 띠부씰 ----------
// stickers[도감번호] = { qty, price, memo }  (사진은 'pc.stkphoto.<번호>' 에 따로)
export const stickers = load('pc.stickers.v1', {});
export const saveStickers = () => { save('pc.stickers.v1', stickers); changed(); };
export function stickerTotals() {
  let kinds = 0, qty = 0, krw = 0;
  for (const s of Object.values(stickers)) {
    if (!s.qty) continue;
    kinds++; qty += s.qty; krw += s.qty * (s.price || 0);
  }
  return { kinds, qty, krw };
}
