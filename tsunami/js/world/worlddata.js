// 세계 데이터 로더 — 수심 격자(정거원통, 1024×512) · 육지 삼각망 · 해안선/국경 선분
// 원본: Natural Earth (50m 육지·호수·국경, 10m 수심대) → data/world/*.bin (변환 스크립트는 저장소 밖)
// 격자 규약: 열 0 = 경도 -180, 행 0 = 위도 +90, 셀 중심 기준. 값 = 고도(m), 바다는 음수 수심, 육지는 +40

export const WORLD_W = 1024;
export const WORLD_H = 512;

async function fetchBin(base, name) {
  const res = await fetch(new URL(name, base));
  if (!res.ok) throw new Error(`세계 데이터 로드 실패: ${name} (${res.status})`);
  return res.arrayBuffer();
}

/**
 * @param {URL|string} baseUrl data/world/ 폴더 URL
 * @returns {Promise<WorldData>}
 */
export async function loadWorldData(baseUrl = new URL('../../data/world/', import.meta.url)) {
  let base = String(baseUrl);
  if (!base.endsWith('/')) base += '/';
  base = new URL(base, location.href);
  const [bb, lb, nb] = await Promise.all([fetchBin(base, 'bathy.bin'), fetchBin(base, 'land.bin'), fetchBin(base, 'lines.bin')]);
  const W = WORLD_W, H = WORLD_H;
  if (bb.byteLength !== W * H * 2) throw new Error('bathy.bin 크기 불일치');
  const elev = new Int16Array(bb);

  const lh = new Uint32Array(lb, 0, 2);
  const landPos = new Float32Array(lb, 8, lh[0] * 2);
  const landIdx = new Uint32Array(lb, 8 + lh[0] * 8, lh[1]);

  const nh = new Uint32Array(nb, 0, 2);
  const coast = new Float32Array(nb, 8, nh[0]);
  const borders = new Float32Array(nb, 8 + nh[0] * 4, nh[1]);

  // 셀 인덱스 (최근접)
  const cellOf = (lon, lat) => {
    let i = Math.floor(((lon + 180) / 360) * W);
    i = ((i % W) + W) % W;
    let j = Math.floor(((90 - lat) / 180) * H);
    j = j < 0 ? 0 : j >= H ? H - 1 : j;
    return j * W + i;
  };
  // 쌍선형 보간 고도 (경도 순환)
  const elevAt = (lon, lat) => {
    const fx = ((lon + 180) / 360) * W - 0.5, fy = ((90 - lat) / 180) * H - 0.5;
    const x0f = Math.floor(fx), y0f = Math.floor(fy);
    const tx = fx - x0f, ty = fy - y0f;
    const x0 = ((x0f % W) + W) % W, x1 = (x0 + 1) % W;
    const y0 = y0f < 0 ? 0 : y0f >= H ? H - 1 : y0f;
    const y1 = y0f + 1 < 0 ? 0 : y0f + 1 >= H ? H - 1 : y0f + 1;
    const a = elev[y0 * W + x0], b = elev[y0 * W + x1], c = elev[y1 * W + x0], d = elev[y1 * W + x1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
  const isOcean = (lon, lat) => elevAt(lon, lat) < 0;
  const depthAt = (lon, lat) => Math.max(0, -elevAt(lon, lat));
  const lonOf = (i) => -180 + ((i + 0.5) * 360) / W;
  const latOf = (j) => 90 - ((j + 0.5) * 180) / H;

  /** 가장 가까운 바다 셀 중심 (해안 근처 터치 보정용). maxCells 안에 없으면 null */
  const nearestOcean = (lon, lat, maxCells = 4) => {
    const k = cellOf(lon, lat), ci = k % W, cj = (k / W) | 0;
    if (elev[k] < 0 && isOcean(lon, lat)) return { lon, lat };
    let best = null, bd = Infinity;
    const cosl = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    for (let dj = -maxCells; dj <= maxCells; dj++) {
      const j = cj + dj;
      if (j < 0 || j >= H) continue;
      for (let di = -maxCells; di <= maxCells; di++) {
        const i = (((ci + di) % W) + W) % W;
        if (elev[j * W + i] >= 0) continue;
        const d = (di * cosl) ** 2 + dj * dj;
        if (d < bd) { bd = d; best = { lon: lonOf(i), lat: latOf(j) }; }
      }
    }
    return best;
  };

  return { W, H, elev, landPos, landIdx, coast, borders, isOcean, depthAt, elevAt, cellOf, lonOf, latOf, nearestOcean };
}
