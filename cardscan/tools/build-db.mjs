// 2단계: raw-cards.json 의 모든 카드 이미지를 받아 지문을 계산하고
//        앱이 읽는 data/cards.json + data/hashes.bin 을 만든다.
// 사용: NODE_USE_ENV_PROXY=1 node build-db.mjs <raw-cards.json 폴더> [동시다운로드수]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { toGray, integral, cardHash } from '../js/hash.js';

const dir = process.argv[2] || '.';
const CONC = Number(process.argv[3] || 24);
const OUT = path.resolve(import.meta.dirname, '../data');
const cards = JSON.parse(fs.readFileSync(`${dir}/raw-cards.json`, 'utf8'));
const cachePath = `${dir}/hash-cache.json`;
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function hashImage(url) {
  for (let t = 0; t < 5; t++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('status ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      const { data, info } = await sharp(buf).flatten({ background: '#808080' })
        .raw().toBuffer({ resolveWithObject: true });
      const g = toGray(data, info.width, info.height, info.channels);
      return cardHash(integral(g, info.width, info.height), 0, 0, info.width, info.height);
    } catch (e) {
      await sleep(1000 * (t + 1));
    }
  }
  return null;
}

let done = 0, failed = 0, next = 0;
const t0 = Date.now();
async function worker() {
  while (next < cards.length) {
    const c = cards[next++];
    if (!cache[c.id] && c.images?.small && !process.env.NO_DL) {
      const h = await hashImage(c.images.small);
      if (h) cache[c.id] = h; else failed++;
    }
    if (++done % 500 === 0) {
      console.log(done, '/', cards.length, 'failed', failed, Math.round((Date.now() - t0) / 1000) + 's');
      fs.writeFileSync(cachePath, JSON.stringify(cache));
    }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
fs.writeFileSync(cachePath, JSON.stringify(cache));

// 시세는 짧은 키로 줄여서 저장 (달러, TCGplayer market → 없으면 mid)
const KEY = { normal: 'n', holofoil: 'h', reverseHolofoil: 'r', '1stEditionHolofoil': 'fh',
  '1stEditionNormal': 'fn', unlimitedHolofoil: 'uh', unlimited: 'u', '1stEdition': 'f' };
function prices(c) {
  const p = {};
  for (const [k, v] of Object.entries(c.tcgplayer?.prices || {})) {
    const val = v.market ?? v.mid;
    if (val != null) p[KEY[k] || k] = Math.round(val * 100) / 100;
  }
  const cm = c.cardmarket?.prices;
  const eur = cm?.trendPrice ?? cm?.averageSellPrice;
  if (eur) p.eur = Math.round(eur * 100) / 100;
  return p;
}

// 지문이 있는 카드를 앞에, 없는 카드(이미지 없음)는 뒤에 둔다. 뒤쪽은 "직접 검색"으로만 찾을 수 있다.
const list = [];
const hashes = [];
const row = c => [c.id, c.name, c.number, c.set.name, c.set.printedTotal,
  (c.images?.small || '').replace('https://images.pokemontcg.io/', ''), prices(c), c.rarity || ''];
for (const c of cards) if (cache[c.id]) { list.push(row(c)); hashes.push(...cache[c.id]); }
const hashed = list.length;
for (const c of cards) if (!cache[c.id]) list.push(row(c));
fs.mkdirSync(OUT, { recursive: true });
const updated = cards.map(c => c.tcgplayer?.updatedAt).filter(Boolean).sort().pop();
fs.writeFileSync(`${OUT}/cards.json`, JSON.stringify({
  built: new Date().toISOString().slice(0, 10), priceDate: updated || null, hashed, cards: list,
}));
fs.writeFileSync(`${OUT}/hashes.bin`, Buffer.from(new Uint32Array(hashes).buffer));
console.log('카드', list.length, '장 저장 (사진 인식 가능', hashed, ') / 실패', failed);
