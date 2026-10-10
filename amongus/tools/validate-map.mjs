// 맵 검증: node tools/validate-map.mjs [mapId...] [--svg out.svg]
// 도달 가능성(스폰에서 걸어서), 참조 무결성, 임무 수, 미니게임 id 등을 확인한다.
import fs from 'node:fs';
import { MAP_LIST, getMap, canStand, walkable, inPoly, spawnAt } from '../public/js/shared/maps/index.js';
import { ALL_GAMES, TASK_GAMES, SAB_GAMES } from '../public/js/shared/games.js';

const args = process.argv.slice(2), svgAt = args.indexOf('--svg');
const svgOut = svgAt >= 0 ? args.splice(svgAt, 2)[1] : null;
const ids = args.length ? args : MAP_LIST.map(m => m.id);
let fail = 0;

for (const id of ids) {
  const m = getMap(id), errs = [], warns = [];
  if (m.id !== id) { console.log(`✗ ${id}: 레지스트리에 없음`); fail++; continue; }
  const cell = 25, gw = Math.ceil(m.w / cell), gh = Math.ceil(m.h / cell), seen = new Uint8Array(gw * gh);
  const sp = m.spawn ? spawnAt(m, m.spawn, 0, 1) : null;
  if (!sp || !canStand(m, sp.x, sp.y)) errs.push('spawn 위치에 설 수 없음');
  // 스폰에서 BFS
  if (sp) {
    const q = [[Math.floor(sp.x / cell), Math.floor(sp.y / cell)]];
    seen[q[0][1] * gw + q[0][0]] = 1;
    while (q.length) {
      const [i, j] = q.pop();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= gw || b >= gh || seen[b * gw + a]) continue;
        if (!canStand(m, (a + 0.5) * cell, (b + 0.5) * cell)) continue;
        seen[b * gw + a] = 1; q.push([a, b]);
      }
    }
  }
  const reach = (x, y, d) => {
    for (let j = Math.max(0, Math.floor((y - d) / cell)); j <= Math.min(gh - 1, Math.floor((y + d) / cell)); j++)
      for (let i = Math.max(0, Math.floor((x - d) / cell)); i <= Math.min(gw - 1, Math.floor((x + d) / cell)); i++)
        if (seen[j * gw + i] && Math.hypot((i + 0.5) * cell - x, (j + 0.5) * cell - y) <= d) return true;
    return false;
  };
  const inBounds = (x, y, what) => { if (!(x >= 0 && y >= 0 && x <= m.w && y <= m.h)) errs.push(`${what} 좌표가 맵 범위(w,h) 밖 (${x | 0},${y | 0})`); };
  const roomIds = new Set();
  for (const r of m.rooms) {
    if (!r.id || roomIds.has(r.id)) errs.push(`방 id 없음/중복: ${r.id}`);
    roomIds.add(r.id);
    if (!r.name) errs.push(`방 이름 없음: ${r.id}`);
    r.poly.forEach(([x, y]) => inBounds(x, y, `방 ${r.id}`));
    let ok = false;
    for (let j = 0; j < gh && !ok; j++) for (let i = 0; i < gw && !ok; i++) if (seen[j * gw + i] && inPoly((i + 0.5) * cell, (j + 0.5) * cell, r.poly)) ok = true;
    if (!ok) errs.push(`방 '${r.name}'(${r.id})에 걸어서 갈 수 없음`);
  }
  for (const [k, s] of Object.entries(m.stations)) { inBounds(s.x, s.y, `장소 ${k}`); if (!reach(s.x, s.y, 210)) errs.push(`장소 '${k}' 근처(210)에 갈 수 없음`); }
  for (const [k, v] of Object.entries(m.vents)) { if (!reach(v.x, v.y, 200)) errs.push(`벤트 '${k}' 근처에 갈 수 없음`); if (!v.links.length) warns.push(`벤트 '${k}' 연결 없음`); }
  if (!m.button) errs.push('긴급 버튼(button) 없음'); else if (!reach(m.button.x, m.button.y, 320)) errs.push('긴급 버튼에 갈 수 없음');
  const kinds = { common: 0, long: 0, short: 0 }, tids = new Set();
  for (const t of m.tasks) {
    if (tids.has(t.id)) errs.push(`임무 id 중복 ${t.id}`);
    tids.add(t.id);
    if (!(t.kind in kinds)) errs.push(`임무 ${t.id}: kind 오류 ${t.kind}`); else kinds[t.kind]++;
    const sts = t.pick ? [...t.pool, ...(t.then ? [t.then] : [])] : (t.seq || []).flatMap(s => (typeof s === 'string' ? [s] : s.pool));
    if (!sts.length) errs.push(`임무 ${t.id}: 장소 없음 (seq 또는 pick/pool 필요)`);
    for (const s of sts) if (!m.stations[s]) errs.push(`임무 ${t.id}: 없는 장소 '${s}'`);
    for (const g of t.games || [t.game]) if (!TASK_GAMES[g]) errs.push(`임무 ${t.id}: 카탈로그에 없는 미니게임 '${g}'`);
    const steps = t.pick ? t.pick + (t.then ? 1 : 0) : t.seq?.length;
    if (t.games && t.games.length !== steps) errs.push(`임무 ${t.id}: games 길이(${t.games.length}) ≠ 단계 수(${steps})`);
    if (t.labels && t.labels.length !== steps) errs.push(`임무 ${t.id}: labels 길이 ≠ 단계 수`);
    if (t.pick && t.pick > t.pool.length) errs.push(`임무 ${t.id}: pick > pool`);
  }
  if (kinds.common < 2 || kinds.long < 3 || kinds.short < 5) warns.push(`임무 수 부족 (일반 ${kinds.common}/2, 긴 ${kinds.long}/3, 짧은 ${kinds.short}/5 이상 권장)`);
  for (const [k, sb] of Object.entries(m.sabotages)) {
    if (!['critical', 'lights', 'comms', 'mixup'].includes(sb.type)) errs.push(`사보타주 ${k}: type 오류 ${sb.type}`);
    if (!SAB_GAMES[sb.game]) errs.push(`사보타주 ${k}: 카탈로그에 없는 게임 '${sb.game}'`);
    if (sb.type === 'critical' && !(sb.time > 0)) errs.push(`사보타주 ${k}: time 필요`);
    for (const s of Object.keys(sb.fix || {})) if (!m.stations[s]) errs.push(`사보타주 ${k}: 없는 수리 장소 '${s}'`);
    if (sb.room && !roomIds.has(sb.room)) errs.push(`사보타주 ${k}: 없는 방 '${sb.room}'`);
  }
  for (const d of m.doors) {
    if (!roomIds.has(d.room)) errs.push(`문 ${d.id}: 없는 방 '${d.room}'`);
    let ok = false;
    for (let y = d.y; y <= d.y + d.h && !ok; y += 10) for (let x = d.x; x <= d.x + d.w && !ok; x += 10) if (m.walk.some(p => inPoly(x, y, p))) ok = true;
    if (!ok) errs.push(`문 ${d.id}: 걸을 수 있는 곳과 겹치지 않음`);
  }
  for (const k of ['admin', 'vitals', 'doorlog']) if (m[k] && !m.stations[m[k]]) errs.push(`${k}: 없는 장소 '${m[k]}'`);
  if (m.cams && !m.stations[m.cams.station]) errs.push(`cams.station 없는 장소 '${m.cams.station}'`);
  for (const t of m.transports) for (const e of [t.a, t.b]) if (!reach(e.x, e.y, 200)) errs.push(`이동수단 ${t.id} 끝점에 갈 수 없음`);
  for (const area of [m.spawn, m.meetingSpawn].filter(Boolean)) for (let i = 0; i < 15; i++) { const p = spawnAt(m, area, i, 15); if (!canStand(m, p.x, p.y)) { errs.push('스폰 원 위에 설 수 없는 자리 있음'); break; } }
  for (const p of m.spawnPoints || []) if (!reach(p.x, p.y, 120)) errs.push(`spawnPoint '${p.name}'에 갈 수 없음`);
  let walkCells = 0; for (let i = 0; i < seen.length; i++) walkCells += seen[i];
  console.log(`${errs.length ? '✗' : '✓'} ${m.id}  방 ${m.rooms.length} · 복도 ${m.halls.length} · 장소 ${Object.keys(m.stations).length} · 벤트 ${Object.keys(m.vents).length} · 문 ${m.doors.length} · 임무 ${m.tasks.length} (일반 ${kinds.common}/긴 ${kinds.long}/짧은 ${kinds.short}) · 사보타주 ${Object.keys(m.sabotages).join(',')} · 도달 면적 ${walkCells} 칸`);
  errs.forEach(e => console.log('   오류:', e)); warns.forEach(w => console.log('   경고:', w));
  if (errs.length) fail++;
  if (svgOut) {
    const pts = p => p.map(q => q.join(',')).join(' '), lab = (x, y, t, c = '#fff', s = 60) => `<text x="${x}" y="${y}" fill="${c}" font-size="${s}" text-anchor="middle" font-family="sans-serif">${t}</text>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.w} ${m.h}" width="${Math.min(2400, m.w / 3)}"><rect width="${m.w}" height="${m.h}" fill="#111"/>
${m.halls.map(h => `<polygon points="${pts(h.poly)}" fill="#556" stroke="#889" stroke-width="6"/>`).join('')}
${m.rooms.map(r => `<polygon points="${pts(r.poly)}" fill="#2a4a9a" stroke="#9cf" stroke-width="10"/>`).join('')}
${m.blockers.map(o => (o.r ? `<circle cx="${o.x}" cy="${o.y}" r="${o.r}" fill="#a63"/>` : `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="#a63"/>`)).join('')}
${m.doors.map(d => `<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" fill="#f80"/>`).join('')}
${m.rooms.map(r => lab(r.label.x, r.label.y, r.name, '#fff', 90)).join('')}
${Object.entries(m.stations).map(([k, s]) => `<circle cx="${s.x}" cy="${s.y}" r="30" fill="#fd0"/>${lab(s.x, s.y - 40, k, '#fd0', 40)}`).join('')}
${Object.entries(m.vents).map(([k, v]) => `<rect x="${v.x - 50}" y="${v.y - 28}" width="100" height="56" fill="#f33"/>${v.links.map(l => `<line x1="${v.x}" y1="${v.y}" x2="${m.vents[l].x}" y2="${m.vents[l].y}" stroke="#f33" stroke-width="6" stroke-dasharray="30 20"/>`).join('')}`).join('')}
${m.button ? `<circle cx="${m.button.x}" cy="${m.button.y}" r="60" fill="#f0f"/>` : ''}${m.spawn ? `<ellipse cx="${m.spawn.x}" cy="${m.spawn.y}" rx="${m.spawn.rx}" ry="${m.spawn.ry}" fill="none" stroke="#0f0" stroke-width="10"/>` : ''}
${m.transports.map(t => `<line x1="${t.a.x}" y1="${t.a.y}" x2="${t.b.x}" y2="${t.b.y}" stroke="#0ff" stroke-width="12"/>`).join('')}</svg>`;
    const out = ids.length > 1 ? svgOut.replace(/(\.svg)?$/, `-${m.id}.svg`) : svgOut;
    fs.writeFileSync(out, svg);
    console.log('   미리보기:', out);
  }
}
process.exit(fail ? 1 : 0);
