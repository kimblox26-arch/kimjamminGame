// FREE FREELY 우주 탐사 - 지형 타일 생성 워커 (모듈 워커)
import { PlanetTerrain, buildTile } from './terrainfn.js';

const terrains = new Map();

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'planet') {
    terrains.set(m.id, new PlanetTerrain(m.cfg, m.R));
    return;
  }
  if (m.type === 'tile') {
    const t = terrains.get(m.planet);
    if (!t) { self.postMessage({ type: 'tile', key: m.key, planet: m.planet, error: true }); return; }
    const d = buildTile(t, m.face, m.level, m.ix, m.iy, m.N);
    const transfer = [d.pos.buffer, d.nrm.buffer, d.morph.buffer, d.aux.buffer];
    if (d.ocean) transfer.push(d.ocean.buffer);
    self.postMessage({ type: 'tile', key: m.key, planet: m.planet, data: d }, transfer);
    return;
  }
  if (m.type === 'scatter') {
    // 식생·바위 배치: 지표 높이 샘플 (격자 + 지터)
    const t = terrains.get(m.planet);
    if (!t) return;
    const out = new Float32Array(m.points.length / 3 * 4);
    for (let i = 0, j = 0; i < m.points.length; i += 3, j += 4) {
      const x = m.points[i], y = m.points[i + 1], z = m.points[i + 2];
      const h = t.height(x, y, z, m.minW || 2);
      out[j] = h; out[j + 1] = t.out.moist; out[j + 2] = t.out.extra;
      // 경사: 주변 두 점 차분
      const e = m.eps;
      const hx = t.height(x + m.tx[0] * e, y + m.tx[1] * e, z + m.tx[2] * e, m.minW || 2);
      const hz = t.height(x + m.tz[0] * e, y + m.tz[1] * e, z + m.tz[2] * e, m.minW || 2);
      out[j + 3] = Math.hypot(hx - h, hz - h) / (e * t.R);
    }
    self.postMessage({ type: 'scatter', id: m.id, planet: m.planet, data: out }, [out.buffer]);
  }
};
