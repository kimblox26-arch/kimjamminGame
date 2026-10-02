#!/usr/bin/env node
'use strict';
/* 서버 없이 돌아가는 판 만들기 → dist/static/
 *   index.html     어느 정적 호스팅(GitHub Pages 등)에나 올릴 수 있는 완성된 페이지
 *   artifact.html  claude.ai 페이지로 올릴 때 쓰는 본문 (html/head/body 태그 없이)
 *   map.json, style.css, js/*.js
 * 그리고 게임 사이트 → dist/web/ 과 저장소 맨 위 docs/ (GitHub Pages 로 올린다)
 *   index.html 소개 페이지(site/), play/ 게임 앱(PWA)판: 지도는 바이너리 map.bin 하나, 홈 화면 아이콘(manifest), 오프라인 저장(sw.js)
 *   privacy.html 개인정보처리방침
 * 게임 서버 역할은 js/backend.js 가 브라우저 안에서 한다. */
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { buildMap } = require('../lib/mapgen.js');

const root = path.join(__dirname, '..'), out = path.join(root, 'dist', 'static');
fs.mkdirSync(path.join(out, 'js'), { recursive: true });

const map = buildMap({ landFile: path.join(root, 'mapdata/korea-land.json'), schoolsFile: path.join(root, 'mapdata/schools.txt'), cacheDir: path.join(root, 'data') }); // data/ 에 만들어 둔 지도를 다시 쓴다
fs.writeFileSync(path.join(out, 'map.json'), map.clientJSON);
// 아티팩트는 바이너리 파일을 못 올리므로 base64 글자로 바꿔 둔다 (브라우저가 다시 바이트로 푼다).
// 한 파일이 16MB를 넘으면 안 되니 12MB씩 나눈다 (4글자 단위로 잘라야 base64 가 안 깨진다).
const b64 = map.clientBin.toString('base64'), PART = 12 * 1024 * 1024, parts = [];
for (const f of fs.readdirSync(out)) if (/^map\.bin/.test(f)) fs.rmSync(path.join(out, f));
for (let k = 0; k * PART < b64.length; k++) { const name = `map.bin.${k}.txt`; fs.writeFileSync(path.join(out, name), b64.slice(k * PART, (k + 1) * PART)); parts.push(name); }
for (const f of ['style.css', 'js/intro.js', 'js/shared.js', 'js/problems.js', 'js/backend.js', 'js/app.js']) fs.copyFileSync(path.join(root, 'public', f), path.join(out, f));

const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const links = (html.match(/<link [^>]*>/g) || []).filter(l => !/rel="icon"/.test(l)).join('\n');
let body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
body = body.replace('<script src="js/app.js"></script>', `<script>window.MLE_MAP_URL = "map.json"; window.MLE_MAP_BIN_URL = ${JSON.stringify(parts)};</script>\n<script src="js/backend.js"></script>\n<script src="js/app.js"></script>`);
const page = `${title}\n${links}\n${body.trim()}\n`;
fs.writeFileSync(path.join(out, 'artifact.html'), page);
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n${page.replace(body.trim(), '')}</head>\n<body>\n${body.trim()}\n</body>\n</html>\n`);
console.log(`dist/static 에 만들었어요. (땅 ${map.stats.cells}칸, map.json ${(map.clientJSON.length / 1048576).toFixed(1)}MB, map.bin ${(map.clientBin.length / 1048576).toFixed(1)}MB)`);

// ---------- 게임 사이트: dist/web → ../docs ----------
// 맨 위 = 소개 페이지(site/), play/ = 게임 앱(PWA)판, privacy.html = 개인정보처리방침
const web = path.join(root, 'dist', 'web'), app = path.join(web, 'play'), docs = path.join(root, '..', 'docs');
fs.rmSync(web, { recursive: true, force: true });
fs.cpSync(path.join(root, 'site'), web, { recursive: true });
fs.copyFileSync(path.join(root, 'public/icons/icon-192.png'), path.join(web, 'img/icon-192.png'));
fs.copyFileSync(path.join(root, 'store/feature-graphic.png'), path.join(web, 'img/og.png'));
fs.copyFileSync(path.join(root, 'store/privacy.html'), path.join(web, 'privacy.html'));
fs.mkdirSync(path.join(app, 'js'), { recursive: true }); fs.mkdirSync(path.join(app, 'icons'), { recursive: true });
fs.writeFileSync(path.join(app, 'map.json'), map.clientJSON);
fs.writeFileSync(path.join(app, 'map.bin'), map.clientBin);
const ver = crypto.createHash('sha1').update(map.clientBin).update(map.clientJSON);
for (const f of ['style.css', 'manifest.webmanifest', 'js/intro.js', 'js/shared.js', 'js/problems.js', 'js/backend.js', 'js/app.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png']) {
  fs.copyFileSync(path.join(root, 'public', f), path.join(app, f)); ver.update(fs.readFileSync(path.join(app, f)));
}
const v = ver.digest('hex').slice(0, 10), mv = map.stats.cells.toString(36) + '-' + v; // 지도 주소에 판 번호를 붙여 새 지도면 새로 받게
fs.writeFileSync(path.join(app, 'sw.js'), fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8').replace("const VERSION = 'dev', MAPS = [];", `const VERSION = '${v}', MAPS = ${JSON.stringify(['map.json?v=' + mv, 'map.bin?v=' + mv])};`));
const head = `<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" type="image/png" href="icons/icon-192.png">\n<link rel="apple-touch-icon" href="icons/icon-192.png">\n<meta name="mobile-web-app-capable" content="yes">\n${title}\n${links}\n`;
const webBody = body.replace(/window\.MLE_MAP_URL = [^<]*;/, `window.MLE_MAP_URL = "map.json?v=${mv}"; window.MLE_MAP_BIN_URL = "map.bin?v=${mv}";`)
  .replace('<script src="js/app.js"></script>', `<script src="js/app.js"></script>\n<script>if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});</script>`);
fs.writeFileSync(path.join(app, 'index.html'), `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n<meta name="theme-color" content="#ff7a1a">\n${head}</head>\n<body>\n${webBody.trim()}\n</body>\n</html>\n`);
fs.writeFileSync(path.join(web, '.nojekyll'), '');
fs.rmSync(docs, { recursive: true, force: true });
fs.cpSync(web, docs, { recursive: true });
console.log(`dist/web 과 docs/ 에 게임 사이트를 만들었어요. (소개 페이지 + play/ 게임, 판 ${v})`);
