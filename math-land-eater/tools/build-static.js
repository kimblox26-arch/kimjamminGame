#!/usr/bin/env node
'use strict';
/* 서버 없이 돌아가는 판 만들기 → dist/static/
 *   index.html     어느 정적 호스팅(GitHub Pages 등)에나 올릴 수 있는 완성된 페이지
 *   artifact.html  claude.ai 페이지로 올릴 때 쓰는 본문 (html/head/body 태그 없이)
 *   map.json, style.css, js/*.js
 * 게임 서버 역할은 js/backend.js 가 브라우저 안에서 한다. */
const fs = require('fs');
const path = require('path');
const { buildMap } = require('../lib/mapgen.js');

const root = path.join(__dirname, '..'), out = path.join(root, 'dist', 'static');
fs.mkdirSync(path.join(out, 'js'), { recursive: true });

const map = buildMap({ landFile: path.join(root, 'mapdata/korea-land.json'), schoolsFile: path.join(root, 'mapdata/schools.txt') });
fs.writeFileSync(path.join(out, 'map.json'), map.clientJSON);
for (const f of ['style.css', 'js/shared.js', 'js/problems.js', 'js/backend.js', 'js/app.js']) fs.copyFileSync(path.join(root, 'public', f), path.join(out, f));

const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const links = (html.match(/<link [^>]*>/g) || []).filter(l => !/rel="icon"/.test(l)).join('\n');
let body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
body = body.replace('<script src="js/app.js"></script>', '<script>window.MLE_MAP_URL = "map.json";</script>\n<script src="js/backend.js"></script>\n<script src="js/app.js"></script>');
const page = `${title}\n${links}\n${body.trim()}\n`;
fs.writeFileSync(path.join(out, 'artifact.html'), page);
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n${page.replace(body.trim(), '')}</head>\n<body>\n${body.trim()}\n</body>\n</html>\n`);
console.log(`dist/static 에 만들었어요. (땅 ${map.stats.cells}칸, map.json ${(map.clientJSON.length / 1048576).toFixed(1)}MB)`);
