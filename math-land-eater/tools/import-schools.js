#!/usr/bin/env node
'use strict';
/* 공공데이터포털 "전국초중등학교위치표준데이터" CSV → mapdata/schools.txt
 *
 *   1) https://www.data.go.kr/data/15021148/standard.do 에서 CSV 를 내려받는다.
 *   2) node tools/import-schools.js 내려받은파일.csv [학교기본정보.csv]
 *      (나이스 교육정보 개방 포털의 "학교기본정보" CSV 를 함께 주면 학교 홈페이지 주소도 넣어 준다)
 *   3) 서버를 다시 켜면 전국 모든 초등학교가 실제 위치에 놓인 새 지도가 만들어진다. (땅 주인은 처음부터 다시)
 */
const fs = require('fs');
const path = require('path');

// --level=m (중학교) / --level=h (고등학교): mapdata/schools-m.txt, schools-h.txt 를 만든다 (없으면 초등학교 → schools.txt)
const args = process.argv.slice(2), lvArg = (args.find(a => a.startsWith('--level=')) || '').slice(8) || 'e';
const LV = { e: ['초등학교', 'schools.txt'], m: ['중학교', 'schools-m.txt'], h: ['고등학교', 'schools-h.txt'] }[lvArg];
const [file, infoFile] = args.filter(a => !a.startsWith('--'));
if (!file || !LV) { console.error('사용법: node tools/import-schools.js 전국초중등학교위치표준데이터.csv [학교기본정보.csv] [--level=m|h]'); process.exit(1); }

function readText(f) {
  const buf = fs.readFileSync(f);
  let t = new TextDecoder('utf-8').decode(buf);
  if (!/학교명/.test(t)) t = new TextDecoder('euc-kr').decode(buf); // 옛 파일은 EUC-KR
  return t.replace(/^\uFEFF/, '');
}
const text = readText(file);

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

// 학교 홈페이지 주소 (시도 + 학교명으로 찾는다)
const homepage = new Map();
if (infoFile) {
  const ir = parseCsv(readText(infoFile)), ih = ir.shift().map(h => h.trim());
  const ic = names => ih.findIndex(h => names.some(n => h === n || h.includes(n)));
  const N = ic(['학교명']), U = ic(['홈페이지']), A = ic(['소재지명', '도로명주소', '시도교육청명']);
  if (N < 0 || U < 0) { console.error('학교기본정보 CSV 에서 "학교명", "홈페이지주소" 열을 찾을 수 없어요.'); process.exit(1); }
  for (const r of ir) {
    let u = (r[U] || '').trim();
    if (!u || /[\s|;"'<>]/.test(u)) continue;
    if (!/^https?:\/\//.test(u)) u = 'http://' + u.replace(/^\/+/, '');
    homepage.set(shortSido(((A >= 0 && r[A]) || '').trim()) + '|' + (r[N] || '').trim(), u);
  }
}

const groups = new Map();
let count = 0, skipped = 0;
for (const r of rows) {
  if (!r[C.name]) continue;
  if (!(r[C.level] || r[C.name]).includes(LV[0])) continue;
  if (C.state >= 0 && r[C.state] && !/운영/.test(r[C.state])) continue;
  const lat = parseFloat(r[C.lat]), lon = parseFloat(r[C.lon]);
  const addr = (r[C.addr] || (C.road >= 0 ? r[C.road] : '') || '').trim().split(/\s+/);
  const sido = shortSido(addr[0] || '');
  if (!sido || !(lat > 32.5 && lat < 39 && lon > 124 && lon < 132.5)) { skipped++; continue; }
  // "수원시 영통구"처럼 구가 있는 시는 구까지 쓴다
  const gu = /시$/.test(addr[1] || '') && /구$/.test(addr[2] || '') ? ' ' + addr[2] : '';
  const sigungu = sido === '세종' ? '세종시' : ((addr[1] || '') + gu).replace(/[|;:,@]/g, '');
  const dong = (addr.slice(1).find(t => /(동|읍|면|\d가)$/.test(t)) || '').replace(/[|;:,@]/g, '');
  const name = r[C.name].trim().replace(/[|;:,@]/g, '');
  if (lvArg !== 'e' && !name.endsWith(LV[0])) { skipped++; continue; } // 중·고: 캠퍼스·실습지·국제학교 같은 것은 뺀다
  const key = sido + '|' + sigungu;
  if (!groups.has(key)) groups.set(key, []);
  const url = homepage.get(sido + '|' + name);
  groups.get(key).push(`${name}${dong ? '@' + dong : ''}:${lat.toFixed(5)},${lon.toFixed(5)}${url ? ',' + url : ''}`);
  count++;
}

const out = [`# 공공데이터포털 전국초중등학교위치표준데이터에서 만든 ${LV[0]} 목록`, `# 원본: ${path.basename(file)}  (${new Date().toISOString().slice(0, 10)})`, '# 형식: 시도|시군구|학교[@동]:위도,경도[,홈페이지주소];…'];
for (const [key, list] of [...groups.entries()].sort()) out.push(`${key}|${list.join(';')}`);
const dest = path.join(__dirname, '..', 'mapdata', LV[1]);
fs.writeFileSync(dest, out.join('\n') + '\n');
console.log(`${LV[0]} ${count}곳을 ${dest} 에 저장했어요. (위치가 이상해서 뺀 학교 ${skipped}곳${infoFile ? `, 홈페이지 ${homepage.size}곳` : ''})`);
console.log('서버를 다시 켜면 새 지도가 만들어져요.');
