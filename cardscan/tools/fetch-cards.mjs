// 1단계: pokemontcg.io 에서 전체 카드 목록(+시세)을 받아 raw-cards.json 으로 저장
// 사용: NODE_USE_ENV_PROXY=1 node fetch-cards.mjs <작업폴더> [동시요청수]
// 페이지별로 저장해서 중간에 끊겨도 다시 실행하면 이어서 받는다.
import fs from 'node:fs';
const dir = process.argv[2] || '.';
const CONC = Number(process.argv[3] || 6);
const SEL = 'id,name,number,rarity,set,images,tcgplayer,cardmarket';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(`${dir}/pages`, { recursive: true });
const file = p => `${dir}/pages/${p}.json`;
async function page(p) {
  if (fs.existsSync(file(p))) return JSON.parse(fs.readFileSync(file(p), 'utf8'));
  for (let t = 0; t < 10; t++) {
    try {
      const r = await fetch(`https://api.pokemontcg.io/v2/cards?page=${p}&pageSize=250&select=${SEL}`);
      if (r.ok) {
        const j = await r.json();
        fs.writeFileSync(file(p), JSON.stringify(j));
        return j;
      }
      console.error('page', p, 'status', r.status);
    } catch (e) { console.error('page', p, e.message); }
    await sleep(3000 * (t + 1));
  }
  throw new Error('failed page ' + p);
}
const first = await page(1);
const pages = Math.ceil(first.totalCount / 250);
console.log('total', first.totalCount, 'pages', pages);
let next = 2, got = 1;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (next <= pages) { const p = next++; await page(p); console.log('page', p, 'ok', ++got, '/', pages); }
}));
const all = [];
const seen = new Set();
for (let p = 1; p <= pages; p++) for (const c of JSON.parse(fs.readFileSync(file(p), 'utf8')).data)
  if (!seen.has(c.id)) { seen.add(c.id); all.push(c); }
fs.writeFileSync(`${dir}/raw-cards.json`, JSON.stringify(all));
console.log('done', all.length);
