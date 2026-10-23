// 서버 없이 더블클릭으로 실행되는 단일 HTML(싱글플레이)을 만든다: node tools/build_standalone.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const meta = read('data/countries.json');
const map = fs.readFileSync(path.join(root, 'data/map.bin.gz')).toString('base64');
const html = read('public/index.html')
  .replace(/<link rel="stylesheet" href="https:[^>]+>\n/, '')
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${read('public/style.css')}</style>`)
  .replace('<script src="sim.js"></script>', () => `<script>window.WAR_EMBED = { meta: ${meta}, map: "${map}" };</script>\n<script>\n${read('public/sim.js')}</script>`)
  .replace('<script src="client.js"></script>', () => `<script>\n${read('public/client.js')}</script>`);
const out = path.join(root, 'dist/pixel-world-war.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out} (${(html.length / 1024).toFixed(0)} KB)`);
