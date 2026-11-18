// 손그림 장면들: 스토리 3장, 전투, 엔딩, 메뉴 행진, 작별
(function () {
  const ART = (window.ART = {});
  const OUR = '#2a2420', HELM = '#5f7a3a';

  function wash(g, W, H, top, bottom, seed) {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, top); gr.addColorStop(1, bottom);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const r = SK.rng(seed);
    for (let i = 0; i < 16; i++) {
      const x = r() * W, y = r() * H, rad = 40 + r() * 140;
      const c = g.createRadialGradient(x, y, 0, x, y, rad);
      c.addColorStop(0, r() < 0.5 ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.10)');
      c.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = c; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }
  function ground(g, W, H, y, fill, seed) {
    const r = SK.rng(seed), p = [[-10, H + 10]];
    for (let x = -10; x <= W + 10; x += 40) p.push([x, y + Math.sin(x * 0.01 + seed) * 8 + (r() - 0.5) * 5]);
    p.push([W + 10, H + 10]);
    SK.poly(g, p, { fill, w: 2.2, seed, hatch: { gap: 9, color: 'rgba(0,0,0,.08)' } });
  }
  function skyline(g, W, y, s, fill, seed) {
    const r = SK.rng(seed);
    for (let x = 10; x < W; x += s * (0.9 + r() * 0.6)) SK.building(g, x, y, s * (0.6 + r() * 0.5), { fill, seed: seed + x });
  }
  ART.paperFrame = (g, W, H) => {
    g.save(); g.globalAlpha = 0.35; g.globalCompositeOperation = 'multiply';
    const p = SK.paper();
    for (let x = 0; x < W; x += 384) for (let y = 0; y < H; y += 384) g.drawImage(p, x, y);
    g.restore();
  };

  // ───── 스토리 ─────
  ART.story = [
    (g, W, H, t) => { // 푸른 밤
      wash(g, W, H, '#16224a', '#3b4f86', 11);
      const r = SK.rng(5);
      g.fillStyle = '#fff8d8';
      for (let i = 0; i < 70; i++) { const x = r() * W, y = r() * H * 0.6, s = r() * 1.8 + 0.4; g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 3 + i); g.fillRect(x, y, s, s); }
      g.globalAlpha = 1;
      for (let i = 0; i < 9; i++) {
        const p = ((t * 0.35 + i / 9) % 1), sx = W * (0.15 + ((i * 0.37) % 0.9)), x = sx + p * W * 0.35, y = -20 + p * H * 0.75;
        SK.line(g, x - 70, y - 42, x, y, { w: 3, color: 'rgba(130,200,255,.75)', seed: i });
        SK.ellipse(g, x, y, 6, 6, { fill: '#bfe6ff', w: 1.5, color: '#4aa0e0', seed: i + 50 });
      }
      ground(g, W, H, H * 0.8, '#2d3a2a', 3);
      skyline(g, W, H * 0.81, 34, '#4a5568', 8);
      [[0.22, 0.86], [0.55, 0.9], [0.8, 0.85]].forEach(([u, v], i) => {
        const x = u * W, y = v * H, glow = 0.5 + 0.5 * Math.sin(t * 4 + i);
        const c = g.createRadialGradient(x, y, 0, x, y, 40); c.addColorStop(0, `rgba(120,220,255,${0.5 * glow})`); c.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = c; g.fillRect(x - 40, y - 40, 80, 80);
        SK.poly(g, [[x - 10, y + 4], [x - 4, y - 14], [x + 6, y - 10], [x + 11, y + 4]], { fill: '#7fd6ff', w: 1.8, color: '#1c5c8a', seed: 70 + i });
      });
      SK.stick(g, W * 0.4, H * 0.93, 54, { pose: 'wave', color: '#f3ead6', face: '#dfe6f0', t, seed: 4 });
    },
    (g, W, H, t) => { // 무너진 세계
      wash(g, W, H, '#c9763c', '#e8c08a', 21);
      for (let i = 0; i < 4; i++) {
        const x = W * (0.15 + i * 0.25), y = H * 0.45 - ((t * 20 + i * 30) % 60);
        SK.ellipse(g, x, y, 50, 28, { fill: 'rgba(80,70,60,.35)', w: 0, seed: i });
      }
      ground(g, W, H, H * 0.78, '#9b8a5a', 6);
      const r = SK.rng(9);
      for (let i = 0; i < 5; i++) {
        SK.stick(g, W * (0.08 + i * 0.07), H * 0.92 - (i % 2) * 10, 46, { pose: 'shoot', dir: 1, helmet: HELM, seed: i });
        SK.stick(g, W * (0.92 - i * 0.07), H * 0.92 - (i % 2) * 10, 46, { pose: 'shoot', dir: -1, helmet: '#8a3a2a', color: '#3a1e1a', seed: 20 + i });
      }
      SK.tank(g, W * 0.3, H * 0.86, 30, { seed: 3 });
      SK.tank(g, W * 0.7, H * 0.86, 30, { dir: -1, color: '#8a6a4a', seed: 4 });
      const bt = (t * 0.8) % 1;
      SK.boom(g, W * (0.45 + r() * 0.1), H * 0.7, 34 + bt * 30, bt, Math.floor(t * 0.8));
      // 찢어진 평화의 깃발
      SK.line(g, W * 0.5, H * 0.78, W * 0.5, H * 0.32, { w: 3, color: '#5a4630', seed: 7 });
      SK.poly(g, [[W * 0.5, H * 0.32], [W * 0.62, H * 0.34], [W * 0.58, H * 0.4], [W * 0.63, H * 0.45], [W * 0.5, H * 0.46]], { fill: '#f6f2e6', w: 2, seed: 8 });
      SK.text(g, '평화', W * 0.555, H * 0.39, { size: 18, color: '#5a7ab0' });
      for (let i = 0; i < 6; i++) {
        const a = (t * 2 + i) % 1;
        if (a < 0.15) SK.line(g, W * (0.14 + i * 0.07), H * 0.82, W * (0.86 - i * 0.07), H * 0.82 - 8, { w: 1.2, color: 'rgba(255,230,120,.9)', passes: 1, seed: i });
      }
    },
    (g, W, H, t) => { // 대통령
      wash(g, W, H, '#9ccbea', '#e9f2f7', 31);
      SK.flag(g, W * 0.68, H * 0.62, 70, { korea: true, t, seed: 3 });
      SK.flag(g, W * 0.32, H * 0.62, 70, { korea: true, t: t + 1, seed: 4 });
      ground(g, W, H, H * 0.8, '#b9c98a', 12);
      SK.stick(g, W * 0.5, H * 0.6, 70, { pose: 'wave', tie: '#c8303a', t, seed: 1 });
      SK.poly(g, [[W * 0.43, H * 0.5], [W * 0.57, H * 0.5], [W * 0.55, H * 0.72], [W * 0.45, H * 0.72]], { fill: '#8a5a3a', w: 2.4, seed: 2, hatch: { gap: 7, color: 'rgba(0,0,0,.15)' } });
      SK.taeguk(g, W * 0.5, H * 0.6, 9);
      const r = SK.rng(17);
      for (let i = 0; i < 16; i++) {
        const x = W * (0.04 + i * 0.062), y = H * (0.92 + (i % 3) * 0.03);
        SK.stick(g, x, y, 34 + r() * 8, { pose: 'cheer', t: t + i, dir: x < W / 2 ? 1 : -1, seed: 40 + i, eyes: false });
      }
      // 말풍선
      const bx = W * 0.66, by = H * 0.16;
      SK.ellipse(g, bx, by, 112, 34, { fill: '#fffdf5', w: 2.4, seed: 5 });
      SK.poly(g, [[bx - 60, by + 22], [W * 0.54, H * 0.42], [bx - 30, by + 28]], { fill: '#fffdf5', w: 2, seed: 6, open: true });
      SK.text(g, '세계를 하나로!', bx, by, { size: 26, color: '#c8303a' });
    },
  ];

  ART.wash = wash; ART.ground = ground;

  // ───── 엔딩 ─────
  ART.sad = (g, W, H, t) => {
    wash(g, W, H, '#4a4f5a', '#8a8e96', 41);
    for (let i = 0; i < 5; i++) SK.ellipse(g, (i * 260 + t * 8) % (W + 300) - 150, 60 + (i % 2) * 30, 150, 46, { fill: '#5d626c', w: 2, color: '#3a3d44', seed: i });
    ground(g, W, H, H * 0.74, '#6a6e62', 3);
    // 시위대
    const r = SK.rng(8);
    for (let i = 0; i < 12; i++) {
      const x = W * (0.55 + i * 0.038), y = H * (0.86 + (i % 3) * 0.035);
      SK.stick(g, x, y, 46, { pose: 'stand', dir: -1, seed: 60 + i, eyes: false, color: '#222' });
      if (i % 2 === 0) {
        SK.line(g, x + 4, y - 30, x + 4, y - 72, { w: 2, color: '#5a4630', passes: 1, seed: i });
        SK.rect(g, x - 18, y - 96, 44, 26, { fill: '#f6f2e6', w: 1.8, seed: 80 + i, passes: 1 });
        SK.text(g, '탄핵', x + 4, y - 83, { size: 17, color: '#b0302a', seed: i });
      }
    }
    // 떠나는 대통령
    const px = W * 0.42 - (t * 14) % (W * 0.4);
    SK.stick(g, px, H * 0.9, 62, { pose: 'sad', dir: -1, tie: '#c8303a', t: t * 4, seed: 2 });
    SK.rect(g, px - 30, H * 0.9 - 26, 22, 17, { fill: '#7a4b22', w: 2, seed: 4 });
    // 비
    g.strokeStyle = 'rgba(220,230,240,.45)'; g.lineWidth = 1.2; g.beginPath();
    for (let i = 0; i < 160; i++) {
      const x = (r() * W + t * 60) % W, y = (r() * H + t * 520) % H;
      g.moveTo(x, y); g.lineTo(x - 4, y + 14);
    }
    g.stroke();
    ART.paperFrame(g, W, H);
  };

  ART.happy = (g, W, H, t, map) => {
    wash(g, W, H, '#7fb8e6', '#fdf1cf', 51);
    // 지구
    const R = Math.min(W, H) * 0.2, cx = W / 2, cy = H * 0.3;
    SK.ellipse(g, cx, cy, R, R, { fill: '#6aa6d6', w: 3, seed: 1 });
    g.save(); g.beginPath(); g.arc(cx, cy, R * 0.97, 0, 7); g.clip();
    if (map) g.drawImage(map.rasterCanvas, ((t * 30) % 360) * 7, 0, 360 * 7 * 0.5, map.RH, cx - R, cy - R * 0.9, R * 2, R * 1.8);
    g.restore();
    SK.ellipse(g, cx, cy, R, R, { w: 3, seed: 2 });
    // 불꽃놀이
    for (let i = 0; i < 5; i++) {
      const p = (t * 0.5 + i * 0.2) % 1, fx = W * (0.12 + i * 0.19), fy = H * (0.15 + (i % 2) * 0.12);
      const cols = ['#e8433a', '#f2c230', '#3b7dd8', '#5fbf5a', '#d860c8'];
      g.save(); g.globalAlpha = 1 - p; g.strokeStyle = cols[i]; g.lineWidth = 2.4; g.lineCap = 'round';
      g.beginPath();
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        g.moveTo(fx + Math.cos(a) * p * 30, fy + Math.sin(a) * p * 30);
        g.lineTo(fx + Math.cos(a) * p * 60, fy + Math.sin(a) * p * 60);
      }
      g.stroke(); g.restore();
    }
    ground(g, W, H, H * 0.72, '#a8cf7a', 5);
    for (let i = 0; i < 14; i++) {
      const x = W * (0.05 + i * 0.065), y = H * (0.88 + (i % 3) * 0.035);
      SK.stick(g, x, y, 44, { pose: 'cheer', t: t * 2 + i, dir: i % 2 ? 1 : -1, seed: 30 + i, helmet: i % 3 === 0 ? HELM : null, eyes: false });
      if (i % 3 === 1) SK.flag(g, x + 14, y - 30, 26, { korea: true, t: t + i, seed: 50 + i });
    }
    SK.stick(g, W * 0.5, H * 0.8, 66, { pose: 'cheer', tie: '#c8303a', t: t * 2, seed: 9 });
    ART.paperFrame(g, W, H);
  };

  ART.unify = (g, W, H, t) => {
    wash(g, W, H, '#bcdcf2', '#fdf1cf', 61);
    for (let i = 0; i < 4; i++) {
      const p = (t * 0.5 + i * 0.25) % 1, fx = W * (0.15 + i * 0.23), fy = H * (0.18 + (i % 2) * 0.1);
      g.save(); g.globalAlpha = 1 - p; g.strokeStyle = ['#e8433a', '#3b7dd8', '#f2c230', '#5fbf5a'][i]; g.lineWidth = 2; g.beginPath();
      for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; g.moveTo(fx + Math.cos(a) * p * 18, fy + Math.sin(a) * p * 18); g.lineTo(fx + Math.cos(a) * p * 36, fy + Math.sin(a) * p * 36); }
      g.stroke(); g.restore();
    }
    ground(g, W, H, H * 0.74, '#a8cf7a', 3);
    SK.flag(g, W * 0.5, H * 0.76, H * 0.32, { korea: true, t, seed: 1 });
    for (let i = 0; i < 8; i++) {
      const x = i < 4 ? W * (0.06 + i * 0.07) : W * (0.73 + (i - 4) * 0.07);
      SK.stick(g, x, H * 0.93, H * 0.2, { pose: 'cheer', t: t * 2 + i, dir: i < 4 ? 1 : -1, helmet: i < 4 ? HELM : '#8a7a9a', seed: 20 + i, eyes: false });
    }
    SK.stick(g, W * 0.42, H * 0.95, H * 0.3, { pose: 'cheer', t: t * 1.5, dir: 1, helmet: HELM, seed: 2 });
    SK.stick(g, W * 0.6, H * 0.95, H * 0.3, { pose: 'cheer', t: t * 1.5 + 1, dir: -1, helmet: '#8a7a9a', seed: 3 });
    SK.text(g, '우리의 소원은 통일', W / 2, H * 0.12, { size: Math.min(34, W / 14), color: '#c8303a', stroke: '#fffdf5', strokeW: 6 });
    ART.paperFrame(g, W, H);
  };

  ART.bye = (g, W, H, t) => {
    g.fillStyle = '#15120f'; g.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.5;
    const c = g.createRadialGradient(cx, cy - 120, 10, cx, cy - 40, 260);
    c.addColorStop(0, 'rgba(255,235,170,.55)'); c.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = c; g.fillRect(0, 0, W, H);
    SK.line(g, cx + 70, cy + 20, cx + 70, cy - 190, { w: 4, color: '#8a7a6a', seed: 1 });
    SK.line(g, cx + 70, cy - 190, cx + 30, cy - 190, { w: 4, color: '#8a7a6a', seed: 2 });
    SK.ellipse(g, cx + 30, cy - 178, 12, 10, { fill: '#ffe9a8', w: 2, color: '#8a7a6a', seed: 3 });
    SK.stick(g, cx - 10, cy + 20, 80, { pose: 'wave', t, color: '#f3ead6', face: '#2a2420', seed: 4 });
  };

  // 메뉴 위 행진하는 졸라맨들
  ART.march = (g, W, H, t) => {
    g.clearRect(0, 0, W, H);
    const y = H - 18, span = W + 400;
    for (let i = 0; i < 7; i++) {
      const x = ((t * 46 + i * 46) % span) - 200;
      SK.stick(g, x, y, 40, { pose: 'walk', t: t * 7 + i * 0.6, gun: true, helmet: HELM, seed: i, eyes: false });
    }
    const tx = ((t * 46 + 7 * 46 + 40) % span) - 200;
    SK.tank(g, tx, y, 26, { seed: 9 });
    SK.flag(g, ((t * 46 - 40) % span) - 200 + span * 0, y - 2, 34, { korea: true, t, seed: 10 });
  };

  ART.loading = (g, W, H, t) => {
    g.clearRect(0, 0, W, H);
    SK.rect(g, 90, 40, 130, 80, { fill: '#cfe3f2', w: 2, seed: 1 });
    SK.poly(g, [[110, 60], [150, 54], [160, 80], [130, 100], [112, 88]], { fill: '#b9d48a', w: 1.6, seed: 2 });
    SK.stick(g, 60, 128, 64, { pose: 'wave', t: t * 1.5, seed: 3 });
    const a = t * 6;
    SK.line(g, 78 + Math.cos(a) * 4, 76 + Math.sin(a) * 4, 96 + Math.cos(a) * 4, 60 + Math.sin(a) * 4, { w: 3, color: '#d8a020', seed: 4 });
  };
})();
