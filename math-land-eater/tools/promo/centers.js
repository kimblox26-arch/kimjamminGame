// map.bin → 칸 가운데 좌표 (홍보 영상용 땅 고르기)
const fs = require('fs'), dir = '/home/user/kimjamminGame/docs/play/';
const m = JSON.parse(fs.readFileSync(dir + 'map.json')), buf = new Uint8Array(fs.readFileSync(dir + 'map.bin'));
const n = new DataView(buf.buffer, buf.byteOffset).getUint32(4, true);
let p = 8 + n;
const u = () => { let v = 0, sh = 0, b; do { b = buf[p++]; v += (b & 0x7f) * 2 ** sh; sh += 7; } while (b & 0x80); return v; };
const z = () => { const v = u(); return v % 2 ? -(v + 1) / 2 : v / 2; };
const cx = new Float32Array(n), cy = new Float32Array(n);
let px = 0, py = 0;
for (let i = 0; i < n; i++) {
  const rc = u(); let sx = 0, sy = 0, c = 0;
  for (let k = 0; k < rc; k++) { const L = u(); let x = (px += z()), y = (py += z()); if (k === 0) { sx += x; sy += y; c++; } for (let q = 1; q < L; q++) { x += z(); y += z(); if (k === 0) { sx += x; sy += y; c++; } } }
  cx[i] = sx / c; cy[i] = sy / c;
}
fs.writeFileSync('centers.bin', Buffer.concat([Buffer.from(cx.buffer), Buffer.from(cy.buffer)]));
console.log('n', n, 'schools', m.schools.length, 'sample', cx[0], cy[0], m.schools[0]);
