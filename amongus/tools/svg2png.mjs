// SVG 미리보기를 PNG로: node tools/svg2png.mjs in.svg out.png  (Playwright 필요)
import fs from 'node:fs';
const { chromium } = await import(process.env.PW || 'playwright').catch(() => import('/opt/node-tools/node_modules/playwright/index.mjs'));
const [inp, out] = process.argv.slice(2);
const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.setContent(`<body style="margin:0;background:#000">${fs.readFileSync(inp, 'utf8').replace(/width="[\d.]+"/, 'width="1600"')}</body>`);
await p.locator('svg').screenshot({ path: out }); await b.close();
