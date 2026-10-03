// SKYBREAKER — 전투기 HUD (등각 피치 사다리, 속도/고도 테이프, 표적 지시, 리드 조준점, 레이더)
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const RED = '#ff4b3e', AMBER = '#ffc04a', WHITE = '#f4fbff';
export const HUD_COLORS = { green: '#7dffb0', cyan: '#7fe9ff', amber: '#ffcf5a', white: '#f0f6ff' };

export class HUD {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.color = HUD_COLORS.green;
    this.visible = false;
    this.mobile = false;
    this.hitT = 0;
    this.hitKill = false;
    this._v = new THREE.Vector3();
    this._cs = new THREE.Vector3();
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
    this.cv.style.width = this.W + 'px';
    this.cv.style.height = this.H + 'px';
    this.s = clamp(Math.min(this.W, this.H) / 800, 0.62, 1.3);
  }

  hitMarker(kill) { this.hitT = kill ? 0.45 : 0.2; this.hitKill = kill; }

  _proj(p) {
    const cs = this._cs.copy(p).applyMatrix4(this.cam.matrixWorldInverse);
    const front = cs.z < -0.5;
    const v = this._v.copy(cs).applyMatrix4(this.cam.projectionMatrix);
    return { x: (v.x * 0.5 + 0.5) * this.W, y: (-v.y * 0.5 + 0.5) * this.H, front, csx: cs.x, csy: cs.y };
  }

  _font(px, bold = true) { this.ctx.font = `${bold ? 700 : 500} ${Math.round(px * this.s)}px Rajdhani, 'Noto Sans KR', sans-serif`; }

  _text(t, x, y, align = 'center', color) {
    const c = this.ctx;
    c.textAlign = align;
    if (color) c.fillStyle = color;
    c.fillText(t, x, y);
  }

  render(st) {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    if (!this.visible || !st) return;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cam = st.camera;
    this.hitT = Math.max(0, this.hitT - st.dt);
    const P = st.player, fm = P.fm, s = this.s;
    const col = this.color;
    c.lineWidth = 1.7 * s;
    c.strokeStyle = col; c.fillStyle = col;
    c.textBaseline = 'middle';
    c.shadowColor = col;
    c.shadowBlur = this.mobile ? 0 : 6;

    const far = (dir, d = 1000) => this._v.copy(fm.pos).addScaledVector(dir, d);
    const bs = this._proj(far(fm.forward));
    const bsx = bs.x, bsy = bs.y;

    if (P.alive) {
      this._ladder(st, bsx, bsy);
      // 비행 경로 마커 (FPV)
      if (fm.speed > 20) {
        const vd = fm.vel.clone().normalize();
        const fp = this._proj(far(vd));
        if (fp.front) this._fpv(fp.x, fp.y);
      }
      this._boresight(bsx, bsy);
      this._targets(st, bsx, bsy);
      this._tapes(st);
      this._heading(st);
      this._weapons(st);
      this._warnings(st);
    }
    this._radar(st);
    this._score(st);
    // 히트 마커
    if (this.hitT > 0) {
      const k = this.hitT / (this.hitKill ? 0.45 : 0.2);
      c.strokeStyle = this.hitKill ? RED : WHITE;
      c.shadowColor = c.strokeStyle;
      c.lineWidth = (this.hitKill ? 3.2 : 2.4) * s;
      const r1 = (9 + (1 - k) * 6) * s, r2 = r1 + 9 * s;
      c.globalAlpha = clamp(k * 1.6, 0, 1);
      c.beginPath();
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        c.moveTo(bsx + dx * r1 * 0.7, bsy + dy * r1 * 0.7);
        c.lineTo(bsx + dx * r2 * 0.7, bsy + dy * r2 * 0.7);
      }
      c.stroke();
      c.globalAlpha = 1;
    }
    c.shadowBlur = 0;
  }

  _boresight(x, y) {
    const c = this.ctx, s = this.s;
    c.beginPath();
    c.moveTo(x - 16 * s, y); c.lineTo(x - 7 * s, y); c.lineTo(x - 3.5 * s, y + 5 * s); c.lineTo(x, y);
    c.lineTo(x + 3.5 * s, y + 5 * s); c.lineTo(x + 7 * s, y); c.lineTo(x + 16 * s, y);
    c.stroke();
  }

  _fpv(x, y) {
    const c = this.ctx, s = this.s, r = 7 * s;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    c.moveTo(x - r, y); c.lineTo(x - r - 11 * s, y);
    c.moveTo(x + r, y); c.lineTo(x + r + 11 * s, y);
    c.moveTo(x, y - r); c.lineTo(x, y - r - 7 * s);
    c.stroke();
  }

  _ladder(st, bx, by) {
    const c = this.ctx, s = this.s, fm = st.player.fm;
    const f = fm.forward;
    const hl = Math.hypot(f.x, f.z);
    if (hl < 0.02) return;
    const hdg = new THREE.Vector3(f.x / hl, 0, f.z / hl);
    const rH = new THREE.Vector3(-hdg.z, 0, hdg.x);
    const pitchDeg = Math.asin(clamp(f.y, -1, 1)) * 180 / Math.PI;
    c.save();
    c.beginPath();
    c.arc(bx, by, Math.min(this.W, this.H) * 0.34, 0, Math.PI * 2);
    c.clip();
    this._font(13);
    const base = Math.round(pitchDeg / 10) * 10;
    for (let a = base - 40; a <= base + 40; a += 10) {
      if (a < -90 || a > 90) continue;
      const th = a * Math.PI / 180;
      const dir = hdg.clone().multiplyScalar(Math.cos(th)); dir.y += Math.sin(th);
      const ctr = this._proj(this._v.copy(fm.pos).addScaledVector(dir, 1000));
      if (!ctr.front) continue;
      const cx = ctr.x, cy = ctr.y;
      const pr = this._proj(this._v.copy(fm.pos).addScaledVector(dir.clone().addScaledVector(rH, 0.04), 1000));
      let dx = pr.x - cx, dy = pr.y - cy;
      const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      const half = (a === 0 ? 220 : 82) * s, gap = (a === 0 ? 34 : 26) * s;
      c.setLineDash(a < 0 ? [7 * s, 5 * s] : []);
      c.beginPath();
      c.moveTo(cx - dx * half, cy - dy * half); c.lineTo(cx - dx * gap, cy - dy * gap);
      c.moveTo(cx + dx * gap, cy + dy * gap); c.lineTo(cx + dx * half, cy + dy * half);
      if (a !== 0) {
        const tick = (a > 0 ? 8 : -8) * s;
        c.moveTo(cx - dx * half, cy - dy * half); c.lineTo(cx - dx * half - dy * tick * -1, cy - dy * half + dx * tick);
        c.moveTo(cx + dx * half, cy + dy * half); c.lineTo(cx + dx * half - dy * tick * -1, cy + dy * half + dx * tick);
      }
      c.stroke();
      c.setLineDash([]);
      if (a !== 0) {
        c.save();
        c.translate(cx + dx * (half + 16 * s), cy + dy * (half + 16 * s));
        c.rotate(Math.atan2(dy, dx));
        this._text(String(Math.abs(a)), 0, 0);
        c.restore();
      }
    }
    c.restore();
  }

  _heading(st) {
    const c = this.ctx, s = this.s, fm = st.player.fm;
    const hdg = fm.heading;
    const cx = this.W / 2, y = 34 * s;
    const w = 300 * s, pxPerDeg = w / 60;
    c.save();
    c.beginPath(); c.rect(cx - w / 2, y - 14 * s, w, 40 * s); c.clip();
    this._font(13);
    c.beginPath();
    const start = Math.floor((hdg - 32) / 5) * 5;
    for (let d = start; d <= hdg + 32; d += 5) {
      const x = cx + (d - hdg) * pxPerDeg;
      const big = d % 10 === 0;
      c.moveTo(x, y); c.lineTo(x, y + (big ? 9 : 5) * s);
      if (big) {
        const dd = ((d % 360) + 360) % 360;
        const lbl = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[dd] || String(dd / 10).padStart(2, '0');
        this._text(lbl, x, y + 19 * s);
      }
    }
    c.stroke();
    c.restore();
    c.beginPath();
    c.moveTo(cx, y - 2 * s); c.lineTo(cx - 6 * s, y - 10 * s); c.lineTo(cx + 6 * s, y - 10 * s); c.closePath();
    c.fill();
    this._font(15);
    this._text(String(Math.round(hdg) % 360).padStart(3, '0') + '°', cx, y - 20 * s);
  }

  _box(x, y, w, h, txt, align, color) {
    const c = this.ctx;
    c.strokeStyle = color || this.color;
    c.strokeRect(x - w / 2, y - h / 2, w, h);
    this._text(txt, align === 'right' ? x + w / 2 - 6 * this.s : x, y, align === 'right' ? 'right' : 'center', color || this.color);
    c.strokeStyle = this.color;
  }

  _tapes(st) {
    const c = this.ctx, s = this.s, P = st.player, fm = P.fm;
    const kmh = fm.speed * 3.6;
    const off = this.mobile ? this.W * 0.17 : Math.min(this.W * 0.3, 330 * s);
    const lx = this.W / 2 - off, rx = this.W / 2 + off, y = this.mobile ? this.H * 0.4 : this.H / 2;
    const th = (this.mobile ? 130 : 170) * s;
    // 속도 테이프
    c.save();
    c.beginPath(); c.rect(lx - 50 * s, y - th / 2, 70 * s, th); c.clip();
    c.beginPath();
    this._font(12, false);
    const sp = Math.floor(kmh / 50) * 50;
    for (let v = sp - 250; v <= sp + 250; v += 50) {
      const yy = y - (v - kmh) * (th / 400);
      c.moveTo(lx + 8 * s, yy); c.lineTo(lx + 18 * s, yy);
      if (v % 100 === 0 && v >= 0) this._text(String(v), lx + 4 * s, yy, 'right');
    }
    c.stroke();
    c.restore();
    c.beginPath(); c.moveTo(lx + 18 * s, y - th / 2); c.lineTo(lx + 18 * s, y + th / 2); c.stroke();
    this._font(17);
    c.fillStyle = 'rgba(0,10,6,0.35)';
    c.fillRect(lx - 50 * s, y - 13 * s, 66 * s, 26 * s);
    c.fillStyle = this.color;
    this._box(lx - 17 * s, y, 66 * s, 26 * s, String(Math.round(kmh)), 'right');
    this._font(13);
    const mach = fm.mach;
    this._text('M ' + mach.toFixed(2), lx - 2 * s, y + th / 2 + 16 * s, 'right', mach >= 1 ? AMBER : this.color);
    const g = fm.gLoad;
    this._text('G ' + g.toFixed(1), lx - 2 * s, y + th / 2 + 34 * s, 'right', Math.abs(g) > 7.5 ? RED : this.color);
    this._text('α ' + (fm.aoa * 57.3).toFixed(0) + '°', lx - 2 * s, y + th / 2 + 52 * s, 'right', fm.stall > 0.1 ? RED : this.color);
    this._text('km/h', lx - 2 * s, y - th / 2 - 12 * s, 'right');
    // 스로틀
    if (!this.mobile) {
      const bx = lx - 70 * s, bh = 110 * s;
      c.strokeRect(bx - 5 * s, y - bh / 2, 10 * s, bh);
      const fill = clamp(fm.throttle, 0, 1) * bh;
      c.fillStyle = fm.ab ? AMBER : this.color;
      c.fillRect(bx - 3 * s, y + bh / 2 - fill, 6 * s, fill);
      this._font(11);
      this._text(fm.ab ? 'A/B' : Math.round(fm.throttle * 100) + '%', bx, y + bh / 2 + 12 * s, 'center', fm.ab ? AMBER : this.color);
      c.fillStyle = this.color;
    }
    // 고도 테이프
    const alt = fm.pos.y;
    c.save();
    c.beginPath(); c.rect(rx - 20 * s, y - th / 2, 80 * s, th); c.clip();
    c.beginPath();
    this._font(12, false);
    const ap = Math.floor(alt / 100) * 100;
    for (let v = ap - 600; v <= ap + 600; v += 100) {
      const yy = y - (v - alt) * (th / 1000);
      c.moveTo(rx - 18 * s, yy); c.lineTo(rx - 8 * s, yy);
      if (v % 200 === 0) this._text(String(v), rx - 4 * s, yy, 'left');
    }
    c.stroke();
    c.restore();
    c.beginPath(); c.moveTo(rx - 18 * s, y - th / 2); c.lineTo(rx - 18 * s, y + th / 2); c.stroke();
    this._font(17);
    c.fillStyle = 'rgba(0,10,6,0.35)';
    c.fillRect(rx - 16 * s, y - 13 * s, 74 * s, 26 * s);
    c.fillStyle = this.color;
    this._box(rx + 21 * s, y, 74 * s, 26 * s, String(Math.round(alt)), 'right');
    this._font(13);
    const agl = st.agl;
    this._text('R ' + Math.round(agl), rx + 4 * s, y + th / 2 + 16 * s, 'left', agl < 150 ? RED : this.color);
    const vs = fm.vel.y;
    this._text('VS ' + (vs >= 0 ? '+' : '') + Math.round(vs), rx + 4 * s, y + th / 2 + 34 * s, 'left');
    this._text('m', rx + 4 * s, y - th / 2 - 12 * s, 'left');
  }

  _weapons(st) {
    const c = this.ctx, s = this.s, P = st.player, cb = st.combat;
    const x = this.mobile ? 14 * s : this.W - 30 * s;
    let y = this.mobile ? 96 * s : this.H - 150 * s;
    const align = this.mobile ? 'left' : 'right';
    this._font(15);
    const gun = P.jet.stats.gun;
    this._text(`GUN ${Math.floor(P.ammo)}`, x, y, align, P.ammo < gun.ammo * 0.15 ? AMBER : this.color);
    y += 20 * s;
    const n = Math.floor(P.missiles), max = P.jet.stats.missiles;
    let msl = 'MSL ';
    for (let i = 0; i < max; i++) msl += i < n ? '■' : '□';
    this._text(msl, x, y, align, n === 0 ? AMBER : this.color);
    y += 20 * s;
    this._text(`FLR ${Math.floor(P.flares)}`, x, y, align);
    y += 20 * s;
    const L = cb.lock;
    if (L.target) this._text(L.locked ? '◆ LOCK ' + (L.target.name || '') : 'SEEK ' + Math.round(L.progress * 100) + '%', x, y, align, L.locked ? RED : this.color);
    // 내구도
    const hp = clamp(P.hp / P.maxHp, 0, 1);
    const bw = 180 * s, bx = this.W / 2 - bw / 2, by = this.H - (this.mobile ? 16 : 34) * s;
    c.strokeRect(bx, by, bw, 7 * s);
    c.fillStyle = hp < 0.3 ? RED : hp < 0.6 ? AMBER : this.color;
    c.fillRect(bx + 1, by + 1, (bw - 2) * hp, 7 * s - 2);
    this._font(11);
    this._text('ARMOR ' + Math.round(hp * 100) + '%', this.W / 2, by - 9 * s, 'center', this.color);
  }

  _targets(st, bsx, bsy) {
    const c = this.ctx, s = this.s, P = st.player, cb = st.combat;
    const cx = this.W / 2, cy = this.H / 2;
    const ringR = Math.min(this.W, this.H) * 0.42;
    const L = cb.lock;
    const draw = (t) => {
      const p = this._proj(t.pos);
      const d = t.pos.distanceTo(P.fm.pos);
      const isLock = L.target === t;
      const hostile = t.hostile;
      const colr = t.kind === 'ground' ? AMBER : hostile ? RED : '#ff8a6a';
      c.strokeStyle = colr; c.fillStyle = colr; c.shadowColor = colr;
      const on = p.front && p.x > 0 && p.x < this.W && p.y > 0 && p.y < this.H;
      if (on) {
        const r = (t.kind === 'ground' ? 9 : 13) * s;
        if (t.kind === 'ground') c.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
        else {
          c.beginPath();
          c.moveTo(p.x - r, p.y - r * 0.5); c.lineTo(p.x - r, p.y - r); c.lineTo(p.x - r * 0.5, p.y - r);
          c.moveTo(p.x + r * 0.5, p.y - r); c.lineTo(p.x + r, p.y - r); c.lineTo(p.x + r, p.y - r * 0.5);
          c.moveTo(p.x + r, p.y + r * 0.5); c.lineTo(p.x + r, p.y + r); c.lineTo(p.x + r * 0.5, p.y + r);
          c.moveTo(p.x - r * 0.5, p.y + r); c.lineTo(p.x - r, p.y + r); c.lineTo(p.x - r, p.y + r * 0.5);
          c.stroke();
        }
        if (d < 9000) {
          this._font(11);
          this._text((d / 1000).toFixed(1) + 'km', p.x, p.y + r + 10 * s, 'center', colr);
          if (t.kind === 'air' && d < 3000) this._text(t.name, p.x, p.y - r - 9 * s, 'center', colr);
        }
        if (isLock) {
          const k = L.locked ? 0 : 1 - L.progress;
          const rr = (18 + k * 60) * s;
          c.lineWidth = 2.2 * s;
          c.beginPath();
          c.moveTo(p.x, p.y - rr); c.lineTo(p.x + rr, p.y); c.lineTo(p.x, p.y + rr); c.lineTo(p.x - rr, p.y); c.closePath();
          c.stroke();
          if (L.locked) {
            c.globalAlpha = 0.25 + 0.2 * Math.sin(st.time * 20);
            c.fill();
            c.globalAlpha = 1;
            this._font(13);
            this._text('LOCK', p.x, p.y + rr + 12 * s, 'center', RED);
          }
          c.lineWidth = 1.7 * s;
        }
        // 피해 막대
        if (t.hp < t.maxHp && t.hp > 0) {
          c.fillRect(p.x - 12 * s, p.y + r + 18 * s, 24 * s * (t.hp / t.maxHp), 3 * s);
        }
      } else if (t.kind === 'air' && d < 12000) {
        // 화면 밖 표적 화살표
        let ax = p.csx, ay = -p.csy;
        if (!p.front && Math.hypot(ax, ay) < 1e-3) ay = 1;
        const al = Math.hypot(ax, ay) || 1;
        ax /= al; ay /= al;
        const px = cx + ax * ringR, py = cy + ay * ringR;
        const ang = Math.atan2(ay, ax);
        c.save();
        c.translate(px, py); c.rotate(ang);
        c.beginPath(); c.moveTo(10 * s, 0); c.lineTo(-6 * s, -7 * s); c.lineTo(-6 * s, 7 * s); c.closePath();
        c.globalAlpha = isLock ? 1 : 0.75;
        c.fill();
        c.restore();
        c.globalAlpha = 1;
        this._font(10);
        this._text((d / 1000).toFixed(1), px - ax * 18 * s, py - ay * 18 * s, 'center', colr);
      }
      c.strokeStyle = this.color; c.fillStyle = this.color; c.shadowColor = this.color;
    };
    for (const e of cb.enemies) if (e.alive) draw(e);
    for (const t of cb.ground) if (t.alive && t.pos.distanceTo(P.fm.pos) < 9000) draw(t);

    // 리드 조준점 (기관포)
    const T = cb.gunTarget;
    if (T) {
      const gun = P.jet.stats.gun;
      const d = T.pos.distanceTo(P.fm.pos);
      const tof = d / gun.speed;
      const aim = T.pos.clone().addScaledVector(T.vel, tof).addScaledVector(P.fm.vel, -tof);
      aim.y += 0.5 * 9.81 * 0.6 * tof * tof;
      // 탄환은 기체 속도를 물려받으므로 상대 운동 기준 조준 방향을 경계선(1km)에 투영
      const aimDir = aim.sub(P.fm.pos).normalize();
      const p = this._proj(this._v.copy(P.fm.pos).addScaledVector(aimDir, 1000));
      if (p.front) {
        const onTarget = Math.hypot(p.x - bsx, p.y - bsy) < 22 * s;
        const colr = onTarget ? RED : this.color;
        c.strokeStyle = colr; c.shadowColor = colr;
        c.beginPath(); c.arc(p.x, p.y, 15 * s, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.arc(p.x, p.y, 2 * s, 0, Math.PI * 2); c.fillStyle = colr; c.fill();
        // 거리 호
        const k = clamp(1 - d / 1600, 0, 1);
        c.beginPath(); c.arc(p.x, p.y, 20 * s, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); c.stroke();
        if (onTarget) { this._font(12); this._text('SHOOT', p.x, p.y + 32 * s, 'center', RED); }
        c.strokeStyle = this.color; c.fillStyle = this.color; c.shadowColor = this.color;
      }
    }
    // 미사일 탐색 원
    if (P.missiles >= 1 && !L.locked) {
      c.globalAlpha = 0.35;
      const rr = Math.tan(0.42) / Math.tan((this.cam.fov * Math.PI / 180) / 2) * (this.H / 2);
      c.beginPath(); c.arc(bsx, bsy, rr, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = 1;
    }
    // 내 미사일 표시
    for (const m of cb.missiles) {
      if (m.owner !== 'player') continue;
      const p = this._proj(m.pos);
      if (!p.front) continue;
      c.beginPath(); c.arc(p.x, p.y, 3 * s, 0, Math.PI * 2); c.stroke();
    }
  }

  _warnings(st) {
    const c = this.ctx, s = this.s;
    const blink = Math.sin(st.time * 14) > 0;
    let y = this.H / 2 + Math.min(this.H * 0.22, 170 * s);
    const warn = (txt, color) => {
      if (!blink) { y += 34 * s; return; }
      this._font(26);
      c.strokeStyle = color; c.shadowColor = color;
      const w = c.measureText(txt).width + 26 * s;
      c.lineWidth = 2.4 * s;
      c.strokeRect(this.W / 2 - w / 2, y - 16 * s, w, 32 * s);
      this._text(txt, this.W / 2, y, 'center', color);
      c.lineWidth = 1.7 * s;
      c.strokeStyle = this.color; c.shadowColor = this.color; c.fillStyle = this.color;
      y += 40 * s;
    };
    if (st.warn.pullUp) warn('PULL UP', RED);
    if (st.combat.incoming) warn('MISSILE', RED);
    if (st.warn.stall) warn('STALL', AMBER);
    if (st.warn.overG) warn('OVER-G', AMBER);
    if (st.warn.boundary) warn('작전 구역 이탈 — 선회하십시오', AMBER);
    // 접근 미사일 방향
    if (st.combat.incoming) {
      const P = st.player;
      for (const m of st.combat.missiles) {
        if (m.owner === 'player' || m.target !== st.playerTarget) continue;
        const p = this._proj(m.pos);
        let ax = p.csx, ay = -p.csy;
        const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
        const r = Math.min(this.W, this.H) * 0.3;
        const px = this.W / 2 + ax * r, py = this.H / 2 + ay * r;
        c.fillStyle = RED;
        c.save(); c.translate(px, py); c.rotate(Math.atan2(ay, ax));
        c.beginPath(); c.moveTo(16 * s, 0); c.lineTo(-8 * s, -10 * s); c.lineTo(-8 * s, 10 * s); c.closePath(); c.fill();
        c.restore();
        this._font(11);
        this._text((m.pos.distanceTo(P.fm.pos) / 1000).toFixed(1), px, py + 18 * s, 'center', RED);
        c.fillStyle = this.color;
      }
    }
  }

  _radar(st) {
    const c = this.ctx, s = this.s, P = st.player, cb = st.combat;
    const R = (this.mobile ? 54 : 74) * s;
    const cx = this.W - R - (this.mobile ? 70 : 22) * s, cy = R + (this.mobile ? 14 : 22) * s;
    const range = 8000;
    c.save();
    c.fillStyle = 'rgba(0,14,8,0.42)';
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 0.7;
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(cx, cy, R / 2, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.stroke();
    c.globalAlpha = 1;
    // 스윕
    const sw = (st.time * 2.2) % (Math.PI * 2);
    const gr = c.createConicGradient ? c.createConicGradient(sw - Math.PI / 2 - 0.9, cx, cy) : null;
    if (gr) {
      gr.addColorStop(0, 'rgba(125,255,176,0)');
      gr.addColorStop(0.14, 'rgba(125,255,176,0.22)');
      gr.addColorStop(0.142, 'rgba(125,255,176,0)');
      c.fillStyle = gr;
      c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
    }
    const hdg = P.fm.heading * Math.PI / 180;
    const ch = Math.cos(hdg), sh = Math.sin(hdg);
    const plot = (pos, draw) => {
      const dx = pos.x - P.fm.pos.x, dz = pos.z - P.fm.pos.z;
      // 기수 방향이 위가 되도록 회전
      const fx = dx * ch + dz * sh;
      const fy = -(-dx * sh + dz * ch);
      let x = fx / range * R, y = -fy / range * R;
      const l = Math.hypot(x, y);
      const edge = l > R;
      if (edge) { x *= R / l; y *= R / l; }
      draw(cx + x, cy + y, edge);
    };
    for (const t of cb.ground) {
      if (!t.alive) continue;
      plot(t.pos, (x, y, e) => { if (!e) { c.fillStyle = AMBER; c.fillRect(x - 2 * s, y - 2 * s, 4 * s, 4 * s); } });
    }
    for (const e of cb.enemies) {
      if (!e.alive) continue;
      plot(e.pos, (x, y, edge) => {
        c.fillStyle = e.hostile ? RED : '#ff8a6a';
        const a = Math.atan2(e.fwd.x, -e.fwd.z) - hdg;
        c.save(); c.translate(x, y); c.rotate(a);
        c.globalAlpha = edge ? 0.5 : 1;
        c.beginPath(); c.moveTo(0, -5 * s); c.lineTo(4 * s, 4 * s); c.lineTo(-4 * s, 4 * s); c.closePath(); c.fill();
        c.restore();
      });
    }
    for (const m of cb.missiles) {
      plot(m.pos, (x, y) => { c.fillStyle = m.owner === 'player' ? WHITE : RED; c.fillRect(x - 1.5 * s, y - 1.5 * s, 3 * s, 3 * s); });
    }
    c.fillStyle = this.color;
    c.beginPath(); c.moveTo(cx, cy - 6 * s); c.lineTo(cx + 4.5 * s, cy + 5 * s); c.lineTo(cx - 4.5 * s, cy + 5 * s); c.closePath(); c.fill();
    this._font(10);
    this._text('8km', cx + R - 4 * s, cy + R - 4 * s, 'right');
    c.restore();
  }

  _score(st) {
    const s = this.s, c = this.ctx;
    const x = (this.mobile ? 14 : 22) * s, y = (this.mobile ? 22 : 28) * s;
    this._font(this.mobile ? 16 : 20);
    this._text('SCORE ' + st.score.toLocaleString(), x, y, 'left', this.color);
    this._font(14);
    this._text(`격추 ${st.kills}   지상 ${st.groundKills}` + (st.mode === 'dogfight' ? `   WAVE ${st.wave}` : ''), x, y + 22 * s, 'left');
    if (st.combo > 1 && st.comboT > 0) {
      this._font(22);
      this._text(`x${st.combo} COMBO`, x, y + 48 * s, 'left', AMBER);
      c.fillStyle = AMBER;
      c.fillRect(x, y + 62 * s, 110 * s * clamp(st.comboT / 8, 0, 1), 3 * s);
      c.fillStyle = this.color;
    }
  }
}
