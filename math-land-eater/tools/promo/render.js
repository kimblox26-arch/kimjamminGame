// compose.html 을 한 장씩 그려서 JPEG 로 (30fps × 22.5초 = 675장)
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs'), dir = __dirname + '/frames/';
const FPS = 30, SEC = 22.5, from = +(process.argv[2] || 0), to = +(process.argv[3] || Math.round(FPS * SEC)), only = process.argv[4];
fs.mkdirSync(dir, { recursive: true });
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: '192.0.2.2' } });
  const p = await (await b.newContext({ viewport: { width: 1080, height: 1920 }, ignoreHTTPSErrors: true })).newPage();
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://192.0.2.2:3301/compose.html');
  console.log('ready', JSON.stringify(await p.evaluate(() => window.ready)));
  const list = only ? only.split(',').map(Number) : Array.from({ length: to - from }, (_, k) => from + k);
  for (const f of list) {
    const d = await p.evaluate(t => { render(t); return document.getElementById('c').toDataURL('image/jpeg', 0.93); }, f / FPS);
    fs.writeFileSync(dir + String(f).padStart(4, '0') + '.jpg', Buffer.from(d.split(',')[1], 'base64'));
  }
  console.log('frames', list.length);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
