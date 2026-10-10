// index.html 을 한 장씩 그려서 JPEG 로 (30fps × 30초 = 900장). 인자: 시작 끝 (또는 still t1,t2,...)
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs'), dir = __dirname + '/frames/';
const FPS = 30, a = process.argv[2], b = process.argv[3];
fs.mkdirSync(dir, { recursive: true });
(async () => {
  const br = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: '192.0.2.2' } });
  const p = await br.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://192.0.2.2:3302/index.html');
  console.log('ready', JSON.stringify(await p.evaluate(() => window.ready)));
  if (a === 'still') {
    for (const t of b.split(',').map(Number)) { await p.evaluate(t => render(t), t); await p.screenshot({ path: __dirname + `/still-${t}.jpg`, type: 'jpeg', quality: 85 }); }
  } else {
    for (let f = +a; f < +b; f++) { await p.evaluate(t => render(t), f / FPS); await p.screenshot({ path: dir + String(f).padStart(4, '0') + '.jpg', type: 'jpeg', quality: 92 }); }
  }
  await br.close();
})().catch(e => { console.error(e); process.exit(1); });
