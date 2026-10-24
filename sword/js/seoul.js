// SKY BLADE — 실제 서울 데이터 로더
//  출처: 고도 = AWS Terrain Tiles (SRTM 등, terrarium), 건물·도로·철도·시설·물·토지 = Overture Maps (OSM 기여자, ODbL 등)
//  만드는 법: tools/seoul/*.py (Python) → assets/seoul/*.bin.gz
//  좌표: 게임 평면 좌표 (서울시청 기준, x 동 / z 남, m) — frame.js flatToPlanet 과 같은 사상
//
//  지형 격자 (core 15 m × 2560², outer 100 m × 1024², 중심 = 원점)
//    h  : Int16 (0.1 m), 행마다 차분 부호화
//    cw : Uint16 = 분류(하위 4비트) | 수심(상위 12비트, 0.05 m) — 수위 = 바닥 + 수심
//         분류 0 풀밭, 1 도시, 2 숲, 3 공원·잔디, 4 농경지, 5 바위, 6 물, 7 도로, 8 습지, 9 모래
//  건물: 회전 박스 (중심, 폭, 깊이, 높이, 방향, 종류, 시드, 띄운 높이)
//  도로·철도: 조각 (분류, 플래그 1 다리 2 터널 4 램프 8 공사중, 층, 폭, 시작/끝 노드, 점 목록)
//  시설 점: 0 가로등, 1 신호등, 2 횡단보도, 3 버스정류장, 4 벤치, 5 송전탑, 6 지하철역, 7 기차역, 8 가로수

async function bytes(url) {
  // 정적 호스팅에 따라 .gz 바이너리를 못 올리는 곳이 있어 같은 내용을 '.wasm' 이름으로도 찾음
  let res = null;
  for (const u of [url, url + '.wasm']) {
    try {
      const r = await fetch(u);
      if (r.ok && !(r.headers.get('content-type') || '').includes('text/html')) { res = r; break; }
    } catch (e) { /* 다음 이름 */ }
  }
  if (!res) throw new Error(url + ' 없음');
  const buf = new Uint8Array(await res.arrayBuffer());
  // 서버가 이미 풀어서 줄 수도 있음 (gzip 매직 넘버로 판별)
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return buf.buffer;
  const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(ds).arrayBuffer();
}

function grid(hBuf, cwBuf, n, step) {
  const d = new Int16Array(hBuf), h = new Int16Array(n * n);
  for (let j = 0; j < n; j++) {
    let acc = 0;
    const o = j * n;
    for (let i = 0; i < n; i++) { acc += d[o + i]; h[o + i] = acc; }
  }
  return { n, step, half: n * step / 2, h, cw: new Uint16Array(cwBuf) };
}

export async function loadSeoul(base = './assets/seoul/') {
  try {
    const meta = await (await fetch(base + 'meta.json')).json();
    const [ch, ccw, oh, ocw] = await Promise.all(['core_h', 'core_cw', 'outer_h', 'outer_cw'].map((f) => bytes(base + f + '.bin.gz')));
    const terrain = { core: grid(ch, ccw, meta.core.n, meta.core.step), outer: grid(oh, ocw, meta.outer.n, meta.outer.step) };
    return { meta, terrain, base, peaks: meta.peaks || [] };
  } catch (e) {
    console.warn('[seoul] 실제 서울 데이터를 불러오지 못함 — 절차적 도시 사용', e);
    return null;
  }
}

/** 건물 박스 (지형 다음에 불러도 됨) */
export async function loadBuildings(base) {
  const meta = await (await fetch(base + 'buildings.json')).json();
  const buf = await bytes(base + 'buildings.bin.gz');
  const n = meta.n;
  let o = 0;
  const take = (T, sz) => { const a = new T(buf, o, n); o += n * sz; return a; };
  const dx = take(Int32Array, 4), dz = take(Int32Array, 4);
  const w = take(Uint16Array, 2), d = take(Uint16Array, 2), h = take(Uint16Array, 2), yaw = take(Uint16Array, 2);
  const kind = take(Uint8Array, 1), seed = take(Uint8Array, 1);
  // Uint16 정렬 (바이트 오프셋 짝수)
  const minH = new Uint16Array(buf.slice(o, o + n * 2));
  const x = new Float64Array(n), z = new Float64Array(n);
  let ax = 0, az = 0;
  for (let i = 0; i < n; i++) { ax += dx[i]; az += dz[i]; x[i] = ax * 0.1; z[i] = az * 0.1; }
  return { n, x, z, w, d, h, yaw, kind, seed, minH };
}

/** 도로/철도 조각 */
export async function loadLines(base, name) {
  const buf = await bytes(base + name + '.bin.gz');
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true), np = dv.getUint32(4, true);
  const cls = new Uint8Array(n), flags = new Uint8Array(n), level = new Int8Array(n), width = new Float32Array(n);
  const na = new Uint32Array(n), nb = new Uint32Array(n), start = new Uint32Array(n + 1), nameIx = new Uint16Array(n);
  let o = 8, s = 0;
  for (let i = 0; i < n; i++) {
    cls[i] = dv.getUint8(o); flags[i] = dv.getUint8(o + 1); level[i] = dv.getInt8(o + 2); width[i] = dv.getUint8(o + 3) * 0.25;
    na[i] = dv.getUint32(o + 4, true); nb[i] = dv.getUint32(o + 8, true);
    start[i] = s; s += dv.getUint16(o + 12, true); nameIx[i] = dv.getUint16(o + 14, true);
    o += 16;
  }
  start[n] = s;
  const pts = new Float64Array(np * 2);
  let ax = 0, az = 0;
  for (let k = 0; k < np; k++) {
    ax += dv.getInt32(o, true); az += dv.getInt32(o + 4, true); o += 8;
    pts[k * 2] = ax * 0.1; pts[k * 2 + 1] = az * 0.1;
  }
  let names = [];
  try { names = await (await fetch(base + name + '_names.json')).json(); } catch (e) { /* 이름 없음 */ }
  return { n, cls, flags, level, width, na, nb, start, pts, nameIx, names };
}

/** 시설 점 */
export async function loadPoints(base) {
  const buf = await bytes(base + 'points.bin.gz');
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true);
  const kind = new Uint8Array(n), x = new Float64Array(n), z = new Float64Array(n), nameIx = new Uint16Array(n);
  let o = 4;
  for (let i = 0; i < n; i++) {
    kind[i] = dv.getUint8(o); x[i] = dv.getInt32(o + 1, true) * 0.1; z[i] = dv.getInt32(o + 5, true) * 0.1; nameIx[i] = dv.getUint16(o + 9, true);
    o += 11;
  }
  let names = [];
  try { names = await (await fetch(base + 'points_names.json')).json(); } catch (e) { /* 없음 */ }
  return { n, kind, x, z, nameIx, names };
}

export const ROAD_CLS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified', 'service',
  'pedestrian', 'footway', 'path', 'steps', 'cycleway', 'track'];
export const RAIL_CLS = ['subway', 'standard_gauge', 'light_rail', 'monorail', 'tram', 'unknown', 'funicular', 'narrow_gauge'];
