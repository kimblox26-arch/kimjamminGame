// 손그림 세계지도: 밀러 도법, 나라/도시 영역 래스터, 흔들리는 해안선·국경선
(function () {
  const PX = 7; // 래스터 해상도 (픽셀 / 지도 단위)
  const D2R = Math.PI / 180;
  const miller = (lat) => {
    const p = Math.max(-85, Math.min(85, lat)) * D2R;
    return (-1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * p))) / D2R;
  };

  const PALETTE = [
    [231, 196, 126], [166, 202, 128], [226, 165, 158], [196, 178, 220], [240, 214, 140],
    [158, 207, 196], [217, 180, 140], [190, 214, 140], [229, 183, 206], [206, 196, 140],
  ];
  const KOREA_RGB = [222, 86, 72];

  function parseTable(txt) {
    const m = {};
    txt.trim().split('\n').forEach((line) => {
      const [en, ko, tier, cs] = line.split('|');
      m[en] = {
        ko, tier: +tier,
        cities: cs.split(';').map((s) => { const [n, lon, lat] = s.split(','); return { name: n, lon: +lon, lat: +lat }; }),
      };
    });
    return m;
  }

  class WorldMap {
    constructor(geo, tableTxt) {
      const q = geo.q;
      this.arcs = geo.arcs.map((a) => {
        const out = new Float32Array(a.length);
        let X = 0, Y = 0, prev = null, off = 0;
        for (let i = 0; i < a.length; i += 2) {
          X += a[i]; Y += a[i + 1];
          let lon = X / q + off;
          if (prev !== null && lon - prev > 180) { off -= 360; lon -= 360; }
          else if (prev !== null && lon - prev < -180) { off += 360; lon += 360; }
          prev = lon;
          out[i] = lon; out[i + 1] = miller(Y / q);
        }
        return out;
      });
      this.kind = geo.kind;
      const table = parseTable(tableTxt);
      let ymin = 1e9, ymax = -1e9;
      this.arcs.forEach((a) => { for (let i = 1; i < a.length; i += 2) { ymin = Math.min(ymin, a[i]); ymax = Math.max(ymax, a[i]); } });
      this.ymin = Math.floor(ymin - 2); this.ymax = Math.ceil(ymax + 2);

      // 나라
      const arcOwners = this.arcs.map(() => []);
      this.countries = geo.countries.map((c, ci) => {
        const t = table[c.n] || { ko: c.n, tier: 1, cities: [] };
        const rings = [];
        c.p.forEach((poly) => poly.forEach((ring) => {
          const pts = [];
          ring.forEach((ai) => {
            const rev = ai < 0, a = this.arcs[rev ? ~ai : ai];
            arcOwners[rev ? ~ai : ai].push(ci);
            const n = a.length / 2;
            const fx = a[(rev ? n - 1 : 0) * 2];
            const sh = pts.length ? 360 * Math.round((pts[pts.length - 2] - fx) / 360) : 0;
            for (let k = 0; k < n; k++) {
              const idx = rev ? n - 1 - k : k;
              if (k === 0 && pts.length) continue;
              pts.push(a[idx * 2] + sh, a[idx * 2 + 1]);
            }
          });
          rings.push(pts);
        }));
        return { key: c.n, name: t.ko, tier: t.tier, rings, cityDefs: t.cities, cities: [] };
      });
      this.koreaIdx = this.countries.findIndex((c) => c.key === 'South Korea');

      // 이웃 → 색 칠하기 (이웃끼리 다른 색)
      const nb = this.countries.map(() => new Set());
      arcOwners.forEach((o) => { if (o.length > 1 && o[0] !== o[1]) { nb[o[0]].add(o[1]); nb[o[1]].add(o[0]); } });
      this.neighbors = nb;
      const order = this.countries.map((_, i) => i).sort((a, b) => nb[b].size - nb[a].size);
      order.forEach((i) => {
        const used = new Set([...nb[i]].map((j) => this.countries[j].colorIdx));
        let k = (i * 7) % PALETTE.length;
        for (let t = 0; t < PALETTE.length && used.has(k); t++) k = (k + 1) % PALETTE.length;
        this.countries[i].colorIdx = k;
      });
      this.countries.forEach((c, i) => { c.rgb = i === this.koreaIdx ? KOREA_RGB : PALETTE[c.colorIdx]; });

      this._buildRaster();
      this._buildCities();
      this._assignPixels();
      this._labels();
      this._buildPaths();
      this._buildSea();
      this.view = { cx: 127.5, cy: miller(36.5), s: 30 };
      this.W = 800; this.H = 600;
    }

    project(lon, lat) { return [lon, miller(lat)]; }

    _buildRaster() {
      const W = (this.RW = 360 * PX), H = (this.RH = Math.round((this.ymax - this.ymin) * PX));
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      this.countries.forEach((cn, ci) => {
        g.fillStyle = `rgb(${ci + 1},${200 - ci},123)`;
        g.beginPath();
        for (const sh of [-360, 0, 360]) cn.rings.forEach((r) => {
          let mn = 1e9, mx = -1e9;
          for (let i = 0; i < r.length; i += 2) { mn = Math.min(mn, r[i] + sh); mx = Math.max(mx, r[i] + sh); }
          if (mx < -180 || mn > 180) return;
          for (let i = 0; i < r.length; i += 2) {
            const x = (r[i] + sh + 180) * PX, y = (r[i + 1] - this.ymin) * PX;
            i ? g.lineTo(x, y) : g.moveTo(x, y);
          }
          g.closePath();
        });
        g.fill('evenodd');
      });
      const d = g.getImageData(0, 0, W, H).data;
      const cid = (this.cid = new Int16Array(W * H));
      for (let p = 0, i = 0; p < W * H; p++, i += 4) {
        if (d[i + 3] === 0) { cid[p] = -1; continue; }
        const id = d[i] - 1;
        cid[p] = d[i + 3] === 255 && d[i + 2] === 123 && id >= 0 && d[i + 1] === 200 - id && id < this.countries.length ? id : -2;
      }
      // 경계의 애매한 픽셀은 이웃 값으로
      for (let it = 0; it < 2; it++) {
        for (let p = 0; p < W * H; p++) {
          if (cid[p] !== -2) continue;
          const x = p % W;
          const n = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W];
          for (const q of n) if (q >= 0 && q < W * H && cid[q] >= 0) { cid[p] = cid[q]; break; }
        }
      }
      for (let p = 0; p < W * H; p++) if (cid[p] === -2) cid[p] = -1;
    }

    _buildCities() {
      this.cities = [];
      this.countries.forEach((cn, ci) => {
        let defs = cn.cityDefs;
        if (!defs.length) defs = [{ name: cn.name, lon: null, lat: null }];
        defs.forEach((d, k) => {
          const id = this.cities.length;
          let x = d.lon, y = d.lat == null ? null : miller(d.lat);
          if (x == null) { // 데이터 없는 나라: 영토 아무 곳
            for (let p = 0; p < this.cid.length; p++) if (this.cid[p] === ci) { x = (p % this.RW) / PX - 180; y = Math.floor(p / this.RW) / PX + this.ymin; break; }
          }
          this.cities.push({ id, name: d.name, lon: d.lon ?? x, lat: d.lat ?? 0, x, y, country: ci, capital: k === 0 });
          cn.cities.push(id);
        });
        cn.capital = cn.cities[0];
      });
    }

    _assignPixels() {
      const W = this.RW, H = this.RH, cid = this.cid;
      const city = (this.pcity = new Int16Array(W * H));
      for (let p = 0; p < W * H; p++) {
        const c = cid[p];
        if (c < 0) { city[p] = -1; continue; }
        const list = this.countries[c].cities;
        if (list.length === 1) { city[p] = list[0]; continue; }
        const wx = (p % W) / PX - 180, wy = Math.floor(p / W) / PX + this.ymin;
        let best = list[0], bd = 1e18;
        for (const id of list) {
          const ct = this.cities[id], dy = ct.y - wy;
          let dx = ct.x - wx; dx -= 360 * Math.round(dx / 360);
          const dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; best = id; }
        }
        city[p] = best;
      }
      // 해안 바깥으로 2px 번지게 (클립 여유)
      for (let it = 0; it < 2; it++) {
        const src = city.slice();
        for (let p = W; p < W * H - W; p++) {
          if (src[p] >= 0) continue;
          const x = p % W;
          if (x === 0 || x === W - 1) continue;
          const v = src[p - 1] >= 0 ? src[p - 1] : src[p + 1] >= 0 ? src[p + 1] : src[p - W] >= 0 ? src[p - W] : src[p + W];
          if (v >= 0) city[p] = v;
        }
      }
      // 물감 얼룩 노이즈
      const nz = (this.noise = new Int8Array(W * H));
      const r = SK.rng(1234), G = 22, gw = Math.ceil(W / G) + 2, gh = Math.ceil(H / G) + 2;
      const grid = new Float32Array(gw * gh).map(() => r() - 0.5);
      for (let y = 0; y < H; y++) {
        const gy = y / G, y0 = Math.floor(gy), fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
        for (let x = 0; x < W; x++) {
          const gx = x / G, x0 = Math.floor(gx), fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
          const a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1], c = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x0 + 1];
          const v = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
          nz[y * W + x] = Math.round(v * 34 + (r() - 0.5) * 12);
        }
      }
      this.rasterCanvas = document.createElement('canvas');
      this.rasterCanvas.width = W; this.rasterCanvas.height = H;
      this.rctx = this.rasterCanvas.getContext('2d');
      this.img = this.rctx.createImageData(W, H);
    }

    _labels() {
      // 나라 안쪽에서 가장 넓은 곳 (거리 변환)
      const W = this.RW, H = this.RH, cid = this.cid, N = W * H;
      const dist = new Float32Array(N);
      for (let p = 0; p < N; p++) dist[p] = cid[p] < 0 ? 0 : 1e6;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = y * W + x; if (!dist[p]) continue;
        let v = dist[p];
        if (x > 0) v = Math.min(v, cid[p - 1] === cid[p] ? dist[p - 1] + 1 : 1);
        if (y > 0) v = Math.min(v, cid[p - W] === cid[p] ? dist[p - W] + 1 : 1);
        if (x > 0 && y > 0) v = Math.min(v, cid[p - W - 1] === cid[p] ? dist[p - W - 1] + 1.414 : 1);
        if (x < W - 1 && y > 0) v = Math.min(v, cid[p - W + 1] === cid[p] ? dist[p - W + 1] + 1.414 : 1);
        if (x === 0 || y === 0) v = Math.min(v, 1);
        dist[p] = v;
      }
      for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
        const p = y * W + x; if (!dist[p]) continue;
        let v = dist[p];
        if (x < W - 1) v = Math.min(v, cid[p + 1] === cid[p] ? dist[p + 1] + 1 : 1);
        if (y < H - 1) v = Math.min(v, cid[p + W] === cid[p] ? dist[p + W] + 1 : 1);
        if (x < W - 1 && y < H - 1) v = Math.min(v, cid[p + W + 1] === cid[p] ? dist[p + W + 1] + 1.414 : 1);
        if (x > 0 && y < H - 1) v = Math.min(v, cid[p + W - 1] === cid[p] ? dist[p + W - 1] + 1.414 : 1);
        dist[p] = v;
      }
      const best = this.countries.map(() => [0, 0]);
      for (let p = 0; p < N; p++) { const c = cid[p]; if (c >= 0 && dist[p] > best[c][0]) best[c] = [dist[p], p]; }
      this.countries.forEach((cn, i) => {
        const [d, p] = best[i];
        cn.lx = (p % W) / PX - 180; cn.ly = Math.floor(p / W) / PX + this.ymin; cn.lr = d / PX;
      });
    }

    _buildPaths() {
      const r = SK.rng(99), J = 0.045;
      this.land = new Path2D();
      this.countries.forEach((cn) => cn.rings.forEach((rg) => {
        for (let i = 0; i < rg.length; i += 2) i ? this.land.lineTo(rg[i], rg[i + 1]) : this.land.moveTo(rg[i], rg[i + 1]);
        this.land.closePath();
      }));
      this.coast = []; this.border = [];
      for (let v = 0; v < 3; v++) {
        const cp = new Path2D(), bp = new Path2D();
        this.arcs.forEach((a, ai) => {
          const k = this.kind[ai]; if (k === 2) return;
          const P = k === 0 ? cp : bp;
          let px = a[0], py = a[1];
          P.moveTo(px + (r() - 0.5) * J, py + (r() - 0.5) * J);
          for (let i = 2; i < a.length; i += 2) {
            const x = a[i], y = a[i + 1], L = Math.hypot(x - px, y - py);
            const n = Math.min(8, Math.floor(L / 0.5));
            for (let s = 1; s <= n; s++) {
              const t = s / (n + 1);
              P.lineTo(px + (x - px) * t + (r() - 0.5) * J * 2, py + (y - py) * t + (r() - 0.5) * J * 2);
            }
            P.lineTo(x + (r() - 0.5) * J, y + (r() - 0.5) * J);
            px = x; py = y;
          }
        });
        this.coast.push(cp); this.border.push(bp);
      }
    }

    _buildSea() {
      const S = 512, c = document.createElement('canvas');
      c.width = c.height = S;
      const g = c.getContext('2d'), r = SK.rng(4242);
      g.fillStyle = '#6aa6d6'; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 70; i++) {
        const x = r() * S, y = r() * S, rad = 30 + r() * 110, light = r() < 0.5;
        for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
          const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
          gr.addColorStop(0, light ? 'rgba(160,205,236,.28)' : 'rgba(55,120,185,.22)');
          gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
        }
      }
      g.globalAlpha = 0.25; g.globalCompositeOperation = 'multiply';
      g.drawImage(SK.paper(), 0, 0); g.drawImage(SK.paper(), 384, 0); g.drawImage(SK.paper(), 0, 384); g.drawImage(SK.paper(), 384, 384);
      this.seaTile = c;
      // 파도 표시 위치
      this.waves = [];
      const W = this.RW, H = this.RH;
      for (let i = 0; i < 9000 && this.waves.length < 5000; i++) {
        const px = Math.floor(r() * W), py = Math.floor(r() * H), p = py * W + px;
        let ok = this.pcity[p] < 0;
        for (const q of [p - 12, p + 12, p - 12 * W, p + 12 * W]) if (q >= 0 && q < W * H && this.pcity[q] >= 0) ok = false;
        if (ok) this.waves.push({ x: px / PX - 180, y: py / PX + this.ymin, l: r(), z: 0.7 + r() * 0.6 });
      }
    }

    // ownerOf(cityId) → 소유 나라 인덱스
    recolor(ownerOf) {
      const W = this.RW, H = this.RH, city = this.pcity, nz = this.noise, d = this.img.data;
      const own = new Int16Array(this.cities.length);
      this.cities.forEach((c) => (own[c.id] = ownerOf(c.id)));
      const cols = this.countries.map((c) => c.rgb);
      for (let p = 0; p < W * H; p++) {
        const ci = city[p], i = p * 4;
        if (ci < 0) { d[i + 3] = 0; continue; }
        const o = own[ci], rgb = cols[o];
        let k = 1;
        const x = p % W;
        const nb = [x > 0 ? city[p - 1] : -1, x < W - 1 ? city[p + 1] : -1, p >= W ? city[p - W] : -1, p < W * H - W ? city[p + W] : -1];
        for (const q of nb) {
          if (q < 0) { k = Math.min(k, 0.86); continue; }
          if (own[q] !== o) k = Math.min(k, o === this.koreaIdx ? 0.62 : 0.75);
        }
        const n = nz[p];
        d[i] = rgb[0] * k + n; d[i + 1] = rgb[1] * k + n; d[i + 2] = rgb[2] * k + n * 0.8; d[i + 3] = 255;
      }
      this.rctx.putImageData(this.img, 0, 0);
    }

    cityAt(wx, wy) {
      wx = ((((wx + 180) % 360) + 360) % 360) - 180;
      const px = Math.floor((wx + 180) * PX), py = Math.floor((wy - this.ymin) * PX);
      if (px < 0 || py < 0 || px >= this.RW || py >= this.RH) return -1;
      return this.cid[py * this.RW + px] >= 0 ? this.pcity[py * this.RW + px] : -1;
    }

    // ───── 시점 ─────
    resize(W, H) { this.W = W; this.H = H; this.clamp(); }
    minScale() { return Math.max(this.W / 360, this.H / (this.ymax - this.ymin)) * 0.98; }
    clamp() {
      const v = this.view;
      v.s = Math.max(this.minScale(), Math.min(110, v.s));
      v.cx = ((((v.cx + 180) % 360) + 360) % 360) - 180;
      const half = this.H / 2 / v.s;
      const lo = this.ymin + half, hi = this.ymax - half;
      v.cy = lo > hi ? (this.ymin + this.ymax) / 2 : Math.max(lo, Math.min(hi, v.cy));
    }
    toScreen(x, y) {
      const v = this.view;
      let dx = x - v.cx; dx -= 360 * Math.round(dx / 360);
      return [dx * v.s + this.W / 2, (y - v.cy) * v.s + this.H / 2];
    }
    toWorld(sx, sy) {
      const v = this.view;
      return [(sx - this.W / 2) / v.s + v.cx, (sy - this.H / 2) / v.s + v.cy];
    }
    zoomAt(sx, sy, f) {
      const [wx, wy] = this.toWorld(sx, sy);
      this.view.s *= f; this.clamp();
      const [nx, ny] = this.toWorld(sx, sy);
      this.view.cx += wx - nx; this.view.cy += wy - ny; this.clamp();
    }
    focus(lon, lat, s) {
      this.view.cx = lon; this.view.cy = miller(lat);
      if (s) this.view.s = s;
      this.clamp();
    }

    // ───── 그리기 ─────
    drawBase(ctx, dpr, opt = {}) {
      const W = this.W, H = this.H, v = this.view, s = v.s;
      const frame = SK.wobble ? SK.frame % 3 : 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 바다
      if (!this.seaPat) this.seaPat = ctx.createPattern(this.seaTile, 'repeat');
      const k = (s * 50) / 512;
      this.seaPat.setTransform(new DOMMatrix([k, 0, 0, k, W / 2 - v.cx * s, H / 2 - v.cy * s]));
      ctx.fillStyle = this.seaPat; ctx.fillRect(0, 0, W, H);
      // 파도
      const dens = Math.min(1, Math.max(0.012, (s / 40) ** 2));
      ctx.strokeStyle = 'rgba(25,65,115,.42)'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      ctx.beginPath();
      for (const w of this.waves) {
        if (w.l > dens) continue;
        const [x, y] = this.toScreen(w.x, w.y);
        if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
        const ww = 6 * w.z, hh = 3.2 * w.z;
        ctx.moveTo(x - ww, y); ctx.quadraticCurveTo(x - ww / 2, y - hh, x, y); ctx.quadraticCurveTo(x + ww / 2, y - hh, x + ww, y);
      }
      ctx.stroke();
      // 세계 복사본 (날짜변경선 넘어가기)
      for (const c of [-1, 0, 1]) {
        const tx = W / 2 + (c * 360 - 180 - v.cx) * s;
        if (tx > W || tx + 360 * s < 0) continue;
        ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (W / 2 + (c * 360 - v.cx) * s), dpr * (H / 2 - v.cy * s));
        // 경위선
        ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1 / s; ctx.setLineDash([4 / s, 6 / s]);
        ctx.beginPath();
        for (let lon = -180; lon <= 180; lon += 30) { ctx.moveTo(lon, this.ymin); ctx.lineTo(lon, this.ymax); }
        for (let lat = -60; lat <= 80; lat += 20) { const y = miller(lat); ctx.moveTo(-180, y); ctx.lineTo(180, y); }
        ctx.stroke(); ctx.setLineDash([]);
        // 해안 물결 테두리
        ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 13 / s; ctx.stroke(this.land);
        ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 5 / s; ctx.stroke(this.land);
        // 땅 (물감)
        ctx.save(); ctx.clip(this.land);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        for (const o of [-360, 0, 360]) ctx.drawImage(this.rasterCanvas, -180 + o, this.ymin, 360, this.RH / PX);
        ctx.restore();
        // 국경 (점선 연필)
        ctx.strokeStyle = 'rgba(70,45,30,.75)'; ctx.lineWidth = 1.3 / s; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.setLineDash([5 / s, 3.5 / s]); ctx.stroke(this.border[frame]); ctx.setLineDash([]);
        // 해안선 (진한 연필 두 번)
        ctx.strokeStyle = 'rgba(48,36,28,.9)'; ctx.lineWidth = 1.9 / s; ctx.stroke(this.coast[frame]);
        ctx.strokeStyle = 'rgba(48,36,28,.4)'; ctx.lineWidth = 0.9 / s; ctx.stroke(this.coast[(frame + 1) % 3]);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 나라 이름
      if (opt.labels !== false) {
        for (const cn of this.countries) {
          const fs = Math.min(30, cn.lr * s * 0.55);
          if (fs < 11) continue;
          const [x, y] = this.toScreen(cn.lx, cn.ly);
          if (x < -150 || y < -40 || x > W + 150 || y > H + 40) continue;
          if (SK.measure(ctx, cn.name, fs) > cn.lr * s * 3.2) continue;
          SK.text(ctx, cn.name, x, y, { size: fs, color: 'rgba(60,40,28,.5)', stroke: 'rgba(255,250,235,.35)', strokeW: 3, seed: cn.key.length * 13 });
        }
      }
      if (opt.compass !== false) this.drawCompass(ctx, W - 52, H - 56, 30);
    }

    drawCompass(ctx, x, y, r) {
      SK.ellipse(ctx, x, y, r, r, { fill: 'rgba(250,244,228,.75)', w: 1.6, seed: 31 });
      SK.poly(ctx, [[x, y - r * 0.9], [x + r * 0.2, y], [x, y + r * 0.9], [x - r * 0.2, y]], { fill: '#c0392b', w: 1.2, seed: 32, passes: 1 });
      SK.poly(ctx, [[x - r * 0.9, y], [x, y - r * 0.18], [x + r * 0.9, y], [x, y + r * 0.18]], { fill: '#e8dcc0', w: 1.2, seed: 33, passes: 1 });
      SK.text(ctx, '북', x, y - r - 10, { size: 15, seed: 3 });
    }
  }

  window.WorldMap = WorldMap;
  window.miller = miller;
})();
