#!/usr/bin/env node
'use strict';
/* 공공데이터포털 "전국초중등학교위치표준데이터" CSV → mapdata/schools.txt
 *
 *   1) https://www.data.go.kr/data/15021148/standard.do 에서 CSV 를 내려받는다.
 *   2) node tools/import-schools.js 내려받은파일.csv
 *   3) 서버를 다시 켜면 전국 모든 초등학교가 실제 위치에 놓인 새 지도가 만들어진다. (땅 주인은 처음부터 다시)
 */
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) { console.error('사용법: node tools/import-schools.js 전국초중등학교위치표준데이터.csv'); process.exit(1); }

let buf = fs.readFileSync(file), text = new TextDecoder('utf-8').decode(buf);
if (!/학교명/.test(text)) text = new TextDecoder('euc-kr').decode(buf); // 옛 파일은 EUC-KR
text = text.replace(/^﻿/, '');

function parseCsv(s) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const rows = parseCsv(text), head = rows.shift().map(h => h.trim());
const col = names => head.findIndex(h => names.some(n => h === n || h.includes(n)));
const C = { name: col(['학교명']), level: col(['학교급구분']), state: col(['운영상태']), addr: col(['소재지지번주소', '소재지도로명주소']), road: col(['소재지도로명주소']), lat: col(['위도']), lon: col(['경도']) };
for (const [k, v] of Object.entries(C)) if (v < 0 && k !== 'state' && k !== 'road') { console.error(`CSV 에서 "${k}" 열을 찾을 수 없어요. 열 이름: ${head.join(', ')}`); process.exit(1); }

const SIDO = { 서울: '서울', 부산: '부산', 대구: '대구', 인천: '인천', 광주: '광주', 대전: '대전', 울산: '울산', 세종: '세종', 경기: '경기', 강원: '강원', 충청북: '충북', 충북: '충북', 충청남: '충남', 충남: '충남', 전라북: '전북', 전북: '전북', 전라남: '전남', 전남: '전남', 경상북: '경북', 경북: '경북', 경상남: '경남', 경남: '경남', 제주: '제주' };
const shortSido = s => { for (const [k, v] of Object.entries(SIDO)) if (s.startsWith(k)) return v; return null; };

const groups = new Map();
let count = 0, skipped = 0;
for (const r of rows) {
  if (!r[C.name]) continue;
  if (!/초등학교/.test(r[C.level] || r[C.name])) continue;
  if (C.state >= 0 && r[C.state] && !/운영/.test(r[C.state])) continue;
  const lat = parseFloat(r[C.lat]), lon = parseFloat(r[C.lon]);
  const addr = (r[C.addr] || (C.road >= 0 ? r[C.road] : '') || '').trim().split(/\s+/);
  const sido = shortSido(addr[0] || '');
  if (!sido || !(lat > 32.5 && lat < 39 && lon > 124 && lon < 132.5)) { skipped++; continue; }
  const sigungu = sido === '세종' ? '세종시' : (addr[1] || '').replace(/[|;:,]/g, '');
  const name = r[C.name].trim().replace(/[|;:,]/g, '');
  const key = sido + '|' + sigungu;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(`${name}:${lat.toFixed(5)},${lon.toFixed(5)}`);
  count++;
}

const out = ['# 공공데이터포털 전국초중등학교위치표준데이터에서 만든 초등학교 목록', `# 원본: ${path.basename(file)}  (${new Date().toISOString().slice(0, 10)})`, '# 형식: 시도|시군구|학교:위도,경도;…'];
for (const [key, list] of [...groups.entries()].sort()) out.push(`${key}|${list.join(';')}`);
const dest = path.join(__dirname, '..', 'mapdata', 'schools.txt');
fs.writeFileSync(dest, out.join('\n') + '\n');
console.log(`초등학교 ${count}곳을 ${dest} 에 저장했어요. (위치가 이상해서 뺀 학교 ${skipped}곳)`);
console.log('서버를 다시 켜면 새 지도가 만들어져요.');
