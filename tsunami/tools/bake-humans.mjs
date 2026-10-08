// 사람 메시 굽기: js/humans/body.js (SDF → Surface Nets) 결과를 양자화 이진 파일로 저장 → data/humans/*.bin
// 실행: node tsunami/tools/bake-humans.mjs   (브라우저에서 매번 수 초씩 다각형화하지 않도록 미리 계산)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const threeUrl = pathToFileURL(join(root, '..', 'vendor', 'three', 'three.module.min.js')).href;
const tmp = mkdtempSync(join(tmpdir(), 'bake-'));
const src = readFileSync(join(root, 'js', 'humans', 'body.js'), 'utf8').replace("from 'three'", `from '${threeUrl}'`);
writeFileSync(join(tmp, 'body.mjs'), src);
const { buildGeometry, VARIANTS } = await import(pathToFileURL(join(tmp, 'body.mjs')).href);

// 형식: 'HUM1' u32 nv u32 ni | pos i16×3 (÷12000) | nrm i8×3 (÷127) | bone u8×4 | w u8×4 | zone u8×4 | misc u8×4 | idx u16/u32
for (const v of VARIANTS) for (const lod of [1, 2, 3]) {
  const g = buildGeometry(v, lod), nv = g.attributes.position.count, idx = g.index.array, ni = idx.length;
  const big = nv > 65535;
  const size = 12 + nv * (6 + 3 + 4 + 4 + 4 + 4) + ni * (big ? 4 : 2) + 4;
  const buf = new ArrayBuffer(size), dv = new DataView(buf);
  dv.setUint32(0, 0x314d5548, true); dv.setUint32(4, nv, true); dv.setUint32(8, ni, true);
  let o = 12;
  const P = g.attributes.position.array, N = g.attributes.normal.array, BI = g.attributes.aBoneIdx.array, BW = g.attributes.aBoneW.array, Z = g.attributes.aZone.array, M = g.attributes.aMisc.array;
  const q8 = (x) => Math.max(0, Math.min(255, Math.round(x)));
  for (let i = 0; i < nv * 3; i++) { dv.setInt16(o, Math.round(P[i] * 12000), true); o += 2; }
  for (let i = 0; i < nv * 3; i++) { dv.setInt8(o, Math.max(-127, Math.min(127, Math.round(N[i] * 127)))); o += 1; }
  for (let i = 0; i < nv * 4; i++) dv.setUint8(o++, BI[i]);
  for (let i = 0; i < nv * 4; i++) dv.setUint8(o++, BW[i]);
  for (let i = 0; i < nv; i++) {
    dv.setUint8(o++, q8(Z[i * 4] * 255)); dv.setUint8(o++, q8((Z[i * 4 + 1] + 2) * 50));
    dv.setUint8(o++, q8(Z[i * 4 + 2] * 255)); dv.setUint8(o++, q8((Z[i * 4 + 3] + 2) * 50));
  }
  for (let i = 0; i < nv; i++) {
    dv.setUint8(o++, q8(M[i * 4] * 255)); dv.setUint8(o++, q8(M[i * 4 + 1]));
    dv.setUint8(o++, q8(M[i * 4 + 2] * 255)); dv.setUint8(o++, q8(M[i * 4 + 3] * 100));
  }
  o = (o + 3) & ~3;
  for (let i = 0; i < ni; i++) { if (big) { dv.setUint32(o, idx[i], true); o += 4; } else { dv.setUint16(o, idx[i], true); o += 2; } }
  writeFileSync(join(root, 'data', 'humans', `${v}_${lod}.bin`), new Uint8Array(buf, 0, o));
  console.log(v, lod, nv, ni / 3, (o / 1024).toFixed(0) + ' KB');
}
