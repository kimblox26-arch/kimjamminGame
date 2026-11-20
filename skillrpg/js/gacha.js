// ───────── 뽑기 연출 (상자 낙하 → 흔들림/등급 상승 → 개봉 → 결과 카드) ─────────
const Gacha = (() => {
  const GW = 200, GH = 120;
  let ov, cv, c, resultsEl, okBtn, hintEl, titleEl;
  let st = null, raf = 0, last = 0;
  const parts = [];

  function init() {
    ov = document.getElementById('gacha-ov');
    cv = document.getElementById('gacha-cv'); c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
    resultsEl = document.getElementById('gacha-results');
    okBtn = document.getElementById('gacha-ok');
    hintEl = document.getElementById('gacha-hint');
    titleEl = document.getElementById('gacha-title');
    ov.addEventListener('pointerdown', e => { if (st && st.phase === 'shake' && e.target !== okBtn) openNow(); });
    okBtn.addEventListener('click', () => { SFX.click(); close(); });
  }

  // results: [{kind, item, rar, isNew, lv}]
  function play(box, results, kindName) {
    const best = Math.max(...results.map(r => r.rar));
    st = { box, results, best, phase: 'drop', t: 0, y: -40, vy: 0, glowR: 0, steps: [], lid: 0, lidVy: 0, lidRot: 0, shown: false };
    // 흔들림 동안 0 → best 까지 등급 상승
    for (let r = 1; r <= best; r++) st.steps.push(0.35 + (r / (best + 1)) * 1.3);
    parts.length = 0;
    titleEl.textContent = box.title || `${box.name} · ${kindName} ${results.length}회`;
    resultsEl.innerHTML = ''; resultsEl.className = 'results';
    okBtn.hidden = true; hintEl.hidden = false; hintEl.textContent = '화면을 누르면 바로 열려요!';
    ov.hidden = false; ov.className = 'ov';
    document.body.classList.add('noscroll');
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  function close() {
    ov.hidden = true; st = null; cancelAnimationFrame(raf);
    document.body.classList.remove('noscroll');
    Gacha.onClose && Gacha.onClose();
  }
  function openNow() {
    if (!st || st.phase !== 'shake') return;
    while (st.glowR < st.best) { st.glowR++; }
    st.phase = 'open'; st.t = 0; st.lidVy = -160; st.lidRot = 0;
    const col = RAR[st.best].color;
    SFX.open(st.best);
    burst(GW / 2, GH - 34, 60 + st.best * 25, st.best, 120 + st.best * 20);
    if (st.best >= 4) ov.classList.add('flash');
    if (st.best >= 3) ov.classList.add('shake');
    ov.style.setProperty('--glow', col);
    hintEl.hidden = true;
  }
  function burst(x, y, n, r, spd) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = spd * (0.3 + Math.random() * 0.7);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.6 + Math.random() * 0.9, max: 1.5, r, size: Math.random() < 0.3 ? 2 : 1, hue: Math.random() * 360 });
    }
  }
  const colOf = (r, t, h) => r === 5 ? PX.hsl(h + t * 300, 100, 65) : RAR[r].color;

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!st) return;
    st.t += dt;
    const T = now / 1000;
    const cx = GW / 2, floor = GH - 22;
    // ── 업데이트 ──
    if (st.phase === 'drop') {
      st.vy += 900 * dt; st.y += st.vy * dt;
      if (st.y >= 0) { st.y = 0; if (st.vy > 120) { st.vy = -st.vy * 0.3; SFX.chestDrop(); } else { st.vy = 0; st.phase = 'shake'; st.t = 0; } }
    } else if (st.phase === 'shake') {
      if (st.steps.length && st.t >= st.steps[0]) {
        st.steps.shift(); st.glowR++;
        SFX.upgrade(st.glowR);
        burst(cx, floor - 14, 14 + st.glowR * 4, st.glowR, 70);
      }
      if (Math.random() < 0.25 + st.t * 0.2) SFX.shakeTick(Math.min(1, st.t / 2));
      if (st.t > 1.9) openNow();
    } else if (st.phase === 'open') {
      st.lidVy += 400 * dt; st.lid -= st.lidVy * dt; st.lidRot += dt * 5;
      if (Math.random() < 0.6) parts.push({ x: cx + (Math.random() - 0.5) * 20, y: floor - 14, vx: (Math.random() - 0.5) * 30, vy: -60 - Math.random() * 60, life: 1.2, max: 1.2, r: st.best, size: 1, hue: Math.random() * 360 });
      if (st.t > 0.55 && !st.shown) { st.shown = true; showResults(); }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vx *= 1 - 1.5 * dt; p.vy = p.vy * (1 - 1.5 * dt) + 60 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    // ── 그리기 ──
    c.clearRect(0, 0, GW, GH);
    const g = st.glowR, gcol = colOf(g, T, 0);
    // 바닥 빛
    c.globalAlpha = 0.35; PX.ellipse(c, cx, floor + 1, 30 + g * 3, 4, gcol); c.globalAlpha = 1;
    // 회전 광선 (개봉 후 / 에픽 이상은 흔들릴 때도 은은하게)
    if (st.phase === 'open' || (st.phase === 'shake' && g >= 2)) {
      const n = 8 + st.best * 2, strong = st.phase === 'open';
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const a = T * 0.6 + i * Math.PI * 2 / n, w = 0.09;
        c.globalAlpha = strong ? 0.28 : 0.08 + 0.04 * g;
        c.fillStyle = colOf(strong ? st.best : g, T, i * 40);
        c.beginPath(); c.moveTo(cx, floor - 14);
        c.lineTo(cx + Math.cos(a - w) * 220, floor - 14 + Math.sin(a - w) * 220);
        c.lineTo(cx + Math.cos(a + w) * 220, floor - 14 + Math.sin(a + w) * 220);
        c.fill();
      }
      c.restore();
    }
    // 상자
    let sx = 0, sy = st.y;
    if (st.phase === 'shake') { const a = 0.5 + st.t * 1.4; sx = Math.round((Math.random() - 0.5) * 2 * a); sy += Math.round((Math.random() - 0.5) * a * 0.6); }
    const glow = st.phase === 'shake' && g >= 0 ? gcol : null;
    if (st.phase === 'shake') {
      c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.5 + 0.3 * Math.sin(T * 20);
      PX.ellipse(c, cx + sx, floor - 12 + sy, 20 + g * 2, 10 + g, gcol); c.restore();
    }
    c.save();
    c.translate(cx + sx, floor + sy); c.scale(2, 2); c.translate(-cx, -floor);
    drawChest(c, cx, floor, st.box.tier, { lid: st.phase === 'open' ? Math.max(1, -st.lid) : 0, lidRot: st.phase === 'open' ? st.lidRot : 0, glow, time: T });
    c.restore();
    // 개봉 빛기둥
    if (st.phase === 'open') {
      c.save(); c.globalCompositeOperation = 'lighter';
      const w = Math.min(1, st.t * 4) * (10 + st.best * 3);
      c.globalAlpha = 0.6; PX.rect(c, cx - w, 0, w * 2, floor - 14, colOf(st.best, T, 0));
      c.globalAlpha = 0.9; PX.rect(c, cx - w * 0.35, 0, w * 0.7, floor - 14, '#ffffff');
      c.restore();
    }
    c.save(); c.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      c.globalAlpha = Math.min(1, p.life * 2);
      c.fillStyle = Math.random() < 0.15 ? '#ffffff' : colOf(p.r, T, p.hue);
      c.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    c.restore();
    raf = requestAnimationFrame(loop);
  }

  function showResults() {
    const many = st.results.length > 1;
    resultsEl.className = 'results' + (many ? ' many' : ' one');
    if (many) ov.classList.add('done');
    st.results.forEach((res, i) => {
      const el = document.createElement('div');
      el.className = `rcard r${res.rar}`;
      const icon = res.kind === 'skill' ? skillIcon(res.item.id) : gearIcon(res.item);
      fitIcon(icon, many ? 56 : 112);
      const kind = res.kind === 'skill' ? '스킬' : SLOT_NAME[res.item.slot];
      el.innerHTML = `<div class="rc-rar">${RAR[res.rar].name} · ${kind}</div><div class="rc-icon"></div><div class="rc-name">${res.item.name}</div><div class="rc-tag ${res.isNew ? 'new' : ''}">${res.isNew ? 'NEW!' : 'Lv.' + res.lv + ' ▲'}</div>`;
      el.querySelector('.rc-icon').appendChild(icon);
      resultsEl.appendChild(el);
      setTimeout(() => { el.classList.add('show'); SFX.flip(res.rar); }, (many ? 120 : 0) * i + 50);
    });
    setTimeout(() => { okBtn.hidden = false; okBtn.focus({ preventScroll: true }); }, (many ? 120 * st.results.length : 0) + 300);
  }

  return { init, play, close, onClose: null };
})();
