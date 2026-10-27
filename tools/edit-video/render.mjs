// 사용법: node render.mjs <out_dir> shot1 shot2 ...   (PREVIEW=1 → 저해상도 + 3프레임마다 저장)
import fs from 'fs';
import path from 'path';
import { openGame } from './harness.mjs';
import { SHOTS } from './shots.mjs';

const [outDir, ...names] = process.argv.slice(2);
const PREVIEW = !!process.env.PREVIEW;
const NEED = process.env.NEED ? JSON.parse(process.env.NEED) : {};
const rt = fs.readFileSync(new URL('./rt.js', import.meta.url), 'utf8');

const { browser, page } = await openGame();
await page.evaluate(rt);
await page.waitForFunction(() => window.RT && window.RT.ready && window.RT.onStep !== undefined, null, { polling: 100 });

for (const name of names) {
  const s = SHOTS[name];
  const dir = path.join(outDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  await page.evaluate(`(${s.setup.toString().replace(/^setup/, 'function')})()`);
  const upd = s.update.toString().replace(/^update/, 'function');
  await page.evaluate(`window.__upd = ${upd}`);
  const WARM = 3;
  let dt = 1 / 30;
  for (let i = -WARM; i < s.frames; i++) {
    if (NEED[name] && i > NEED[name][1]) break;
    const rg = NEED[name];
    const draw = i < 0 || !rg || (i >= rg[0] - 2 && i <= rg[1]);
    const save = i >= 0 && draw && (!rg || i >= rg[0]) && (!PREVIEW || i % 3 === 0);
    const res = await page.evaluate(([i, n, dt, save, draw]) => {
      const nd = window.__upd(Math.max(0, i), n);
      const vt = window.__vt;
      const d = i < 0 ? 1 / 1000 : dt;
      vt.t += d * 1000;
      const g = window.__FREEFREELY__;
      if (!draw) { g._updateFlight(d); window.__camHook(); return { nd, url: null }; }
      g._lastNow = vt.t - d * 1000;
      const cb = vt.cb; vt.cb = null;
      if (cb) cb();
      return { nd, url: save ? document.getElementById('gl').toDataURL('image/jpeg', 0.95) : null };
    }, [i, s.frames, dt, save, draw]);
    if (i >= 0) dt = res.nd || 1 / 30;
    if (res.url) fs.writeFileSync(path.join(dir, String(i).padStart(4, '0') + '.jpg'), Buffer.from(res.url.split(',')[1], 'base64'));
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(await page.evaluate(() => window.RT.meta || {})));
  console.log(name, 'done', ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
await browser.close();
