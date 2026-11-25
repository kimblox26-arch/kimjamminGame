// 지도: 왼쪽 위 원형 미니맵(내가 보는 방향이 위) + 누르면 전체 지도(북쪽 위, 건물·도로·장소 이름·경찰·사람 표시)
import { ROADS } from './city.js';
import { STORAGE } from './places.js';
import { UNDER } from './underpass.js';
import { PRISON } from './places.js';
import { TOWER, CAFE } from './world2.js';

const FONT = '"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
const PLACES = [
  { name: '달빛24 편의점', x0: -5.2, x1: 4.8, z0: -4.1, z1: 4.1, col: '#2fd3b4' },
  { name: '창고', x0: STORAGE.x0, x1: STORAGE.x1, z0: STORAGE.z0, z1: STORAGE.z1, col: '#c9a26b' },
  { name: '달빛타워', x0: TOWER.x0, x1: TOWER.x1, z0: TOWER.z0, z1: TOWER.z1, col: '#9b8cff' },
  { name: '달빛 커피', x0: CAFE.x0, x1: CAFE.x1, z0: CAFE.z0, z1: CAFE.z1, col: '#d89a5b' },
];
const PR = { x0: PRISON.x - 37, x1: PRISON.x + 37, z0: PRISON.z - 44, z1: PRISON.z + 44 };
export class MiniMap {
  constructor({ city, yawObj, look, markers }) {
    Object.assign(this, { city, yawObj, look, markers }); this.t = 0;
    this.mini = document.getElementById('mmap'); this.big = document.getElementById('bigmap'); this.bigC = this.big.querySelector('canvas');
    this.mini.addEventListener('pointerdown', e => { e.stopPropagation(); this.open(true); });
    // 큰 지도: 끌어서 이동, +/− 확대·축소, 짧게 누르면 닫기
    this.zoom = 1; this.pan = { x: 0, z: 0 }; let drag = null;
    this.big.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.target.closest('.mzoom')) return; drag = { x: e.clientX, y: e.clientY, px: this.pan.x, pz: this.pan.z, moved: 0 }; });
    this.big.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y, k = Math.min(2, devicePixelRatio || 1) / (this.bigS || 1); drag.moved = Math.max(drag.moved, Math.hypot(dx, dy)); this.pan.x = drag.px - dx * k; this.pan.z = drag.pz - dy * k; this.draw(this.bigC, true); });
    this.big.addEventListener('pointerup', e => { if (drag && drag.moved < 8 && !e.target.closest('.mzoom')) this.open(false); drag = null; });
    for (const b of this.big.querySelectorAll('.mzoom button')) b.addEventListener('pointerdown', e => { e.stopPropagation(); const z = +b.dataset.z; if (z) this.zoom = Math.min(6, Math.max(0.18, this.zoom * z)); else { this.pan = { x: 0, z: 0 }; this.zoom = 1; } this.draw(this.bigC, true); });
  }
  open(on) { this.big.classList.toggle('hidden', !on); this.isOpen = on; if (on) { this.pan = { x: 0, z: 0 }; this.draw(this.bigC, true); } }
  // 도시 그리기 (월드 x→오른쪽, z→아래)
  world(g, s, big) {
    const W = this.city.ROADW, { X0, X1, Z0, Z1, EW, NS } = ROADS, B = 520;
    g.fillStyle = '#0b0f14'; g.fillRect(-B, -B, B * 2, B * 2); g.fillStyle = '#10151c'; g.fillRect(X0, Z0, X1 - X0, Z1 - Z0);
    // 보도
    g.fillStyle = '#262c34';
    for (const r of EW) g.fillRect(X0, r.z0 - 3.2, X1 - X0, r.z1 - r.z0 + 6.4);
    for (const cx of NS) g.fillRect(cx - W / 2 - 3.2, Z0, W + 6.4, Z1 - Z0);
    // 도로 + 중앙선
    g.fillStyle = '#3b424c';
    for (const r of EW) g.fillRect(X0, r.z0, X1 - X0, r.z1 - r.z0);
    for (const cx of NS) g.fillRect(cx - W / 2, Z0, W, Z1 - Z0);
    g.strokeStyle = '#d8b04a'; g.lineWidth = 0.35; g.setLineDash([3, 3]); g.beginPath();
    for (const r of EW) { const z = (r.z0 + r.z1) / 2; g.moveTo(X0, z); g.lineTo(X1, z); }
    for (const cx of NS) { g.moveTo(cx, Z0); g.lineTo(cx, Z1); }
    g.stroke(); g.setLineDash([]);
    // 건물 (높을수록 밝게)
    const vw = big ? this.view || 160 : 60, mx = big ? this.cx : this.yawObj.position.x, mz = big ? this.cz : this.yawObj.position.z;
    for (const b of this.city.blds) { if (b.x1 < mx - vw || b.x0 > mx + vw || b.z1 < mz - vw || b.z0 > mz + vw) continue; const l = 16 + Math.min(18, b.h * 0.4); g.fillStyle = `hsl(215,12%,${l}%)`; g.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 0.4 / s * 2; g.strokeRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0); }
    for (const p of PLACES) { g.fillStyle = p.col; g.globalAlpha = 0.85; g.fillRect(p.x0, p.z0, p.x1 - p.x0, p.z1 - p.z0); g.globalAlpha = 1; }
    // 달빛교도소: 외벽·운동장·수용동·감시탑
    g.fillStyle = '#2a2320'; g.fillRect(PR.x0, PR.z0, PR.x1 - PR.x0, PR.z1 - PR.z0);
    g.fillStyle = '#3a3532'; g.fillRect(PRISON.x - 26, PRISON.z - 34, 52, 39.7); g.fillStyle = '#6b625c'; g.fillRect(PRISON.x - 22, PRISON.z + 6, 44, 20); g.fillRect(PRISON.x + 27.8, PRISON.z - 36, 8, 16);
    g.strokeStyle = '#e0785a'; g.lineWidth = 1.1; g.strokeRect(PR.x0, PR.z0, PR.x1 - PR.x0, PR.z1 - PR.z0); g.fillStyle = '#e0785a'; for (const [x, z] of [[PR.x0 + 2.6, PR.z0 + 2.6], [PR.x1 - 2.6, PR.z0 + 2.6], [PR.x0 + 2.6, PR.z1 - 2.6], [PR.x1 - 2.6, PR.z1 - 2.6]]) { g.beginPath(); g.arc(x, z, 2.2, 0, 7); g.fill(); }
    g.fillStyle = '#c9c4b6'; g.fillRect(PRISON.x - 5.5, PR.z0 - 0.6, 11, 1.2);
    // 공원·학교 운동장
    for (const p of this.city.parks || []) { g.fillStyle = '#1e3a22'; g.fillRect(p.x - 40, p.z - 33, 80, 66); g.fillStyle = '#0d2236'; g.beginPath(); g.arc(p.x + 18, p.z - 14, 9, 0, 7); g.fill(); }
    // 지하도 (점선 = 지하, 파란 칸 = 계단 입구)
    const H = UNDER.hall, ug = this.yawObj.position.y < -1;
    g.globalAlpha = ug ? 0.95 : 0.5; g.fillStyle = '#2b3f5c'; g.fillRect(H.x0, H.z0, H.x1 - H.x0, H.z1 - H.z0); g.globalAlpha = 1;
    g.strokeStyle = '#7fb2ff'; g.lineWidth = 0.5; g.setLineDash([1.5, 1.2]); g.strokeRect(H.x0, H.z0, H.x1 - H.x0, H.z1 - H.z0); g.setLineDash([]);
    g.fillStyle = '#3b8bff'; for (const st of UNDER.stairs) g.fillRect(st.x0, st.z0, st.x1 - st.x0, st.z1 - st.z0);
    // 버스 정류장
    g.fillStyle = '#4aa3ff'; g.fillRect(13.8, ROADS.main.z0 - 2.5, 4.4, 1);
  }
  label(g, x, y, txt, col, size) { g.font = `800 ${size}px ${FONT}`; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(txt, x, y); g.fillStyle = col; g.fillText(txt, x, y); }
  draw(cv, big) {
    const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth * dpr, h = cv.clientHeight * dpr;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'), me = this.yawObj.position, yaw = this.look.yaw;
    const s = big ? Math.min(w / 140, h / 80) * this.zoom : w / 70;   // 픽셀/미터
    const cx = me.x + (big ? this.pan.x : 0), cz = me.z + (big ? this.pan.z : 0);
    if (big) { this.bigS = s; this.cx = cx; this.cz = cz; this.view = Math.max(w, h) / s / 2 + 20; }
    g.save(); g.clearRect(0, 0, w, h); g.translate(w / 2, h / 2); if (!big) g.rotate(yaw); g.scale(s, s); g.translate(-cx, -cz);
    this.world(g, s, big);
    // 표시: 경찰차·경찰·사람·쓰러진 사람
    const blink = Math.floor(performance.now() / 250) % 2;
    for (const m of this.markers()) {
      const r = (m.r || 1) * (big ? 2.2 : 1.6);
      g.fillStyle = m.kind === 'police' ? (blink ? '#ff3b3b' : '#3b7bff') : m.kind === 'dead' ? '#b3131b' : m.kind === 'cop' ? '#3b7bff' : m.kind === 'goal' ? (blink ? '#ffd36b' : '#ff9f1c') : '#f2f2f2';
      if (m.kind === 'ride') { g.fillStyle = '#ffb84a'; g.fillRect(m.x - r, m.z - r, r * 2, r * 2); continue; }
      g.beginPath(); g.arc(m.x, m.z, r * (m.kind === 'police' ? 1.4 : 1), 0, 7); g.fill();
    }
    // 나 (화살표)
    g.save(); g.translate(me.x, me.z); g.rotate(-yaw); const a = big ? 4 : 2.6;
    g.fillStyle = '#ffd36b'; g.strokeStyle = '#000'; g.lineWidth = 0.4; g.beginPath(); g.moveTo(0, -a * 1.3); g.lineTo(a * 0.85, a); g.lineTo(0, a * 0.45); g.lineTo(-a * 0.85, a); g.closePath(); g.fill(); g.stroke(); g.restore();
    g.restore();
    // 이름표 (화면 좌표)
    const toScr = (x, z) => { let dx = (x - cx) * s, dz = (z - cz) * s; if (!big) { const c = Math.cos(yaw), si = Math.sin(yaw); [dx, dz] = [dx * c - dz * si, dx * si + dz * c]; } return [w / 2 + dx, h / 2 + dz]; };
    if (big) {
      for (const p of PLACES) { const [x, y] = toScr((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2); this.label(g, x, y - 12 * dpr, p.name, p.col, 13 * dpr); }
      const bs = toScr(16, ROADS.main.z0 - 4); this.label(g, bs[0], bs[1], '버스 정류장', '#4aa3ff', 11 * dpr);
      const RN = ['북부순환로', '아파트길', '뒷골목길', '달빛대로', '시장길', '남부로'];
      ROADS.EW.forEach((r, i) => { for (const x of [cx - 60 / this.zoom, cx + 60 / this.zoom]) { const q = toScr(x, (r.z0 + r.z1) / 2 + 1); this.label(g, q[0], q[1], RN[i], '#c8ced6', 11 * dpr); } });
      const hs = toScr((UNDER.hall.x0 + UNDER.hall.x1) / 2, (UNDER.hall.z0 + UNDER.hall.z1) / 2); this.label(g, hs[0], hs[1] + 4 * dpr, '달빛 지하상가(지하도)', '#7fb2ff', 11 * dpr);
      for (const p of this.city.parks || []) { const q = toScr(p.x, p.z); this.label(g, q[0], q[1], '달빛공원', '#7fd08a', 13 * dpr); }
      for (const p of this.city.schools || []) { const q = toScr(p.x, p.z); this.label(g, q[0], q[1], '달빛초등학교', '#f0c27a', 13 * dpr); }
      for (const [t, x, z] of [['아파트 단지', -40, -200], ['아파트 단지', 190, -200], ['도심 빌딩가', 290, -30], ['옛 골목', -290, -30], ['도심 빌딩가', 290, 130]]) { const q = toScr(x, z); this.label(g, q[0], q[1], t, '#aab4c0', 14 * dpr); }
      { const q = toScr(PRISON.x, PRISON.z - 10); this.label(g, q[0], q[1], '달빛교도소', '#e0785a', 15 * dpr); }
      const mp = toScr(me.x, me.z); this.label(g, mp[0], mp[1] + 22 * dpr, '나', '#ffd36b', 12 * dpr);
    } else {
      // 북쪽 표시
      const [nx, ny] = (() => { const ang = yaw; return [w / 2 - Math.sin(-ang) * (w / 2 - 9 * dpr), h / 2 - Math.cos(-ang) * (h / 2 - 9 * dpr)]; })();
      this.label(g, nx, ny + 4 * dpr, 'N', '#ff6b6b', 11 * dpr);
    }
  }
  update(dt) {
    if ((this.t += dt) < 1 / 7) return; this.t = 0;
    if (this.mini.offsetParent) this.draw(this.mini, false);
    if (this.isOpen) this.draw(this.bigC, true);
  }
}
