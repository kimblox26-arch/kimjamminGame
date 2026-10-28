// 브라우저 전용판 만들기: node tools/build-web.mjs [출력 폴더=dist/web]
// public/ 을 복사하고, 서버 게임 로직(rooms·game·roles·bots·mod)을 js/srv/ 로 옮겨 페이지 안에서 돌린다.
// 결과물은 정적 파일뿐이라 어떤 웹 호스팅(Claude 아티팩트 포함)에도 올릴 수 있다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.argv[2] || 'dist/web');
const PW = process.env.MOD_PASSWORD || 'amongus_2-gamestudio-;;';

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
const SRV = path.join(OUT, 'js', 'srv');
fs.mkdirSync(SRV, { recursive: true });

const fix = s => s.replaceAll("'../public/js/", "'../");
for (const f of ['rooms.js', 'game.js', 'roles.js', 'bots.js']) {
  const src = fix(fs.readFileSync(path.join(ROOT, 'server', f), 'utf8'));
  if (/from 'node:|process\.(?!env\.MIN_PLAYERS)/.test(src)) throw new Error(`${f}: 브라우저에서 못 쓰는 Node 기능`);
  fs.writeFileSync(path.join(SRV, f), src);
}
// mod.js: 비밀번호는 해시로만 넣고, 비밀값은 브라우저 저장소에
let mod = fix(fs.readFileSync(path.join(ROOT, 'server', 'mod.js'), 'utf8'));
const a = mod.indexOf("import crypto from 'node:crypto';"), b = mod.indexOf('export const checkKey');
if (a < 0 || b < 0 || !mod.includes('same(m.pw, PASSWORD())')) throw new Error('mod.js 구조가 바뀜: build-web.mjs 를 고치세요');
const hash = crypto.createHash('sha256').update(PW, 'utf8').digest('hex');
const head = mod.slice(a, b).split('\n').filter(l => /^import \* as|^import \{/.test(l) && !l.includes('node:')).join('\n');
mod = mod.slice(0, a) + `${head}
import { sha256 } from './sha256.js';
// 브라우저판: 비밀번호 원문은 없고 SHA-256 해시만 있음
const PW_HASH = '${hash}';
let secret = null;
function getSecret() {
  if (secret) return secret;
  try { secret = localStorage.getItem('au_srv_secret'); } catch { /* 저장소 없음 */ }
  if (!secret) {
    secret = [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('au_srv_secret', secret); } catch { /* 저장 불가 */ }
  }
  return secret;
}
export const modKey = () => sha256(getSecret() + ':mod');
const same = (x, y) => String(x) === String(y);
` + mod.slice(b);
mod = mod.replace('same(m.pw, PASSWORD())', 'sha256(m.pw) === PW_HASH');
{ const bad = mod.match(/node:|process\.|PASSWORD\(\)/); if (bad || mod.includes(PW)) throw new Error('mod.js 변환 실패: ' + (bad ? mod.slice(bad.index - 80, bad.index + 40) : '원문')); }
fs.writeFileSync(path.join(SRV, 'mod.js'), mod);
for (const f of ['local.js', 'env.js', 'sha256.js']) fs.copyFileSync(path.join(ROOT, 'tools', 'web', f), path.join(SRV, f));

// 페이지: 아티팩트처럼 문서 뼈대를 씌워 주는 곳에서도 쓰도록 본문만 둔 index.html + 일반 호스팅용 full.html
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const links = [...html.matchAll(/<link rel="(?:stylesheet|icon)"[^>]*>/g)].map(x => x[0]).join('\n');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace('<script type="module" src="js/main.js"></script>', '<script type="module" src="js/srv/local.js"></script>\n<script type="module" src="js/main.js"></script>').trim();
fs.writeFileSync(path.join(OUT, 'index.html'), `<title>AMONG US 팬 제작판</title>
<meta name="theme-color" content="#000000">
${links}
${body}
`);
fs.writeFileSync(path.join(OUT, 'full.html'), html.replace('<script type="module" src="js/main.js"></script>', '<script type="module" src="js/srv/local.js"></script>\n<script type="module" src="js/main.js"></script>').replace('<title>AMONG US (팬 제작)</title>', '<title>AMONG US 팬 제작판</title>'));

// 비밀번호 원문이 어디에도 없는지 확인
const all = [];
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else all.push(p); } };
walk(OUT);
for (const f of all) if (fs.readFileSync(f, 'utf8').includes(PW)) throw new Error(`비밀번호 원문이 들어감: ${f}`);
console.log(`브라우저 전용판 완성: ${path.relative(ROOT, OUT)} (파일 ${all.length}개)`);
