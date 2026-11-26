// 국기 그리기 + 라벨(국가/지방/도시/바다) 배치
import { M, mapXY, emit } from './world.js';

export const FONT = '"Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif';
let atlas = null, FL = null;
export async function loadFlags() {
  FL = await fetch('data/flags.json').then((r) => r.json());
  FL.idx = Object.fromEntries(FL.codes.map((c, i) => [c, i]));
  atlas = new Image();
  await new Promise((ok) => { atlas.onload = ok; atlas.onerror = ok; atlas.src = 'data/flags.png'; });
}
export const flagCodes = () => (FL ? FL.codes : []);
const imgCache = new Map();
// 국기: 'kr' 같은 코드 또는 data:image URL
export function drawFlag(g, flag, x, y, w, h) {
  if (!flag) return false;
  if (flag.startsWith('data:')) {
    let im = imgCache.get(flag);
    if (!im) { im = new Image(); im.onload = () => emit('labels'); im.src = flag; imgCache.set(flag, im); }
    if (!im.complete || !im.naturalWidth) return false;
    g.drawImage(im, x, y, w, h);
  } else {
    const i = FL && FL.idx[flag];
    if (i === undefined || !atlas.naturalWidth) return false;
    g.drawImage(atlas, (i % FL.cols) * FL.w, Math.floor(i / FL.cols) * FL.h, FL.w, FL.h, x, y, w, h);
  }
  return true;
}
export function flagEl(flag, w = 30) {
  const c = document.createElement('canvas');
  const r = devicePixelRatio || 1, h = Math.round(w * 0.75);
  c.width = w * r; c.height = h * r; c.style.width = w + 'px'; c.style.height = h + 'px'; c.className = 'flag';
  const g = c.getContext('2d'); g.scale(r, r);
  if (!drawFlag(g, flag, 0, 0, w, h)) {
    if (flag && flag.startsWith('data:')) { const im = new Image(); im.onload = () => g.drawImage(im, 0, 0, w, h); im.src = flag; } else c.classList.add('empty');
  }
  return c;
}

const textW = (s, size) => { let w = 0; for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.6; return w * size; };
const overlaps = (list, r) => list.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);

export let hits = []; // 라벨 편집 도구용 화면 위치

// view: { w, h, k: 화면px/지도px, proj(mx,my) -> [sx,sy] | null }
export function drawLabels(g, view) {
  const { w, h, k, proj } = view, o = M.opts;
  hits = [];
  const placedA = [], placedB = [];
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const halo = (txt, x, y, size, fill, stroke, weight = 700, italic = '', spacing = 0) => {
    g.font = `${italic}${weight} ${size}px ${FONT}`;
    if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
    g.lineWidth = Math.max(2.5, size * 0.2); g.strokeStyle = stroke; g.strokeText(txt, x, y);
    g.fillStyle = fill; g.fillText(txt, x, y);
  };
  const inView = (s, pad = 40) => s && s[0] > -pad && s[0] < w + pad && s[1] > -pad && s[1] < h + pad;

  // 바다
  if (o.oceans) M.oceans.forEach((oc, i) => {
    if (oc.rank > (k < 0.35 ? 0 : k < 0.6 ? 1 : k < 1.1 ? 2 : k < 2 ? 3 : 9)) return;
    const size = [22, 17, 14, 12, 11, 10][Math.min(5, oc.rank)] * Math.min(1.8, Math.max(0.75, k * 1.6));
    const s = proj(...mapXY(oc.lon, oc.lat)); if (!inView(s)) return;
    const sz = Math.min(size, 30);
    halo(oc.name, s[0], s[1], sz, 'rgba(28,62,108,0.62)', 'rgba(255,255,255,0.25)', 500, 'italic ', sz * 0.18);
    const tw = textW(oc.name, sz) * 1.15;
    hits.push({ type: 'ocean', i, r: [s[0] - tw / 2, s[1] - sz / 2, s[0] + tw / 2, s[1] + sz / 2] });
  });

  // 국가 이름
  const cl = [];
  if (o.cLabels || o.flags) M.cstat.forEach((s, i) => {
    const c = M.countries[i];
    if (!c || !c.alive || s.root < 0 || !s.cnt) return;
    const base = Math.sqrt(s.cnt) * 1.25 / (Math.max(2, [...c.name].length) * 0.62 + 0.6);
    let size = Math.min(base * k, 38);
    if (size < 8.5) { if (k < 1.5) return; size = 8.5; }
    const sc = proj(s.lx, s.ly); if (!inView(sc, 200)) return;
    cl.push({ i, c, s, size, sc });
  });
  cl.sort((a, b) => b.s.cnt - a.s.cnt);
  for (const L of cl) {
    const { c, size, sc } = L;
    const tw = textW(c.name, size) * 1.05, fh = o.flags && c.flag ? Math.max(9, Math.min(34, size * 0.95)) : 0;
    const showName = o.cLabels;
    const top = sc[1] - (showName ? size / 2 : 0) - (fh ? fh + 3 : 0);
    const r = [sc[0] - Math.max(tw / 2, fh * 0.67), top, sc[0] + Math.max(tw / 2, fh * 0.67), sc[1] + (showName ? size / 2 : 0)];
    if (overlaps(placedA, r)) continue;
    placedA.push(r);
    if (fh) {
      const fw = fh * 4 / 3, fx = sc[0] - fw / 2, fy = top;
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(fx - 1, fy - 1, fw + 2, fh + 2);
      drawFlag(g, c.flag, fx, fy, fw, fh);
    }
    if (showName) halo(c.name, sc[0], sc[1], size, L.i === M.sel ? '#000' : '#1d1f2b', 'rgba(255,255,255,0.88)', 800, '', size * 0.06);
  }

  // 도시
  if (o.cities) {
    const maxRank = k < 0.45 ? -1 : k < 0.8 ? 1 : k < 1.4 ? 3 : k < 2.6 ? 5 : 9;
    M.cities.forEach((ct, i) => {
      if (ct.rank > maxRank && !(ct.cap && k >= 0.55)) return;
      const s = proj(...mapXY(ct.lon, ct.lat)); if (!inView(s, 10)) return;
      const size = ct.cap ? 12.5 : ct.rank <= 2 ? 12 : 11;
      const tw = textW(ct.name, size);
      const r = [s[0] - 5, s[1] - size / 2 - 1, s[0] + 8 + tw, s[1] + size / 2 + 1];
      if (overlaps(placedB, r) || overlaps(placedA, r)) return;
      placedB.push(r);
      g.beginPath(); g.arc(s[0], s[1], ct.cap ? 4 : 2.6, 0, Math.PI * 2);
      g.fillStyle = ct.cap ? '#fff' : '#2b2b33'; g.fill();
      g.lineWidth = ct.cap ? 2.2 : 1; g.strokeStyle = ct.cap ? '#c0262d' : '#fff'; g.stroke();
      g.textAlign = 'left';
      halo(ct.name, s[0] + 7, s[1], size, '#24252e', 'rgba(255,255,255,0.9)', ct.cap ? 700 : 500);
      g.textAlign = 'center';
      hits.push({ type: 'city', i, r, dot: s });
    });
  }

  // 지방 이름
  if (o.pLabels && k >= 0.9) {
    for (let p = 1; p < M.prov.length; p++) {
      const q = M.prov[p]; if (!q || !q.cnt) continue;
      const size = Math.min(15, Math.sqrt(q.cnt) * 0.55 * k / (Math.max(2, [...q.name].length) * 0.6 + 0.5));
      if (size < 9) continue;
      const s = proj(q.cx, q.cy); if (!inView(s, 0)) continue;
      const tw = textW(q.name, size), r = [s[0] - tw / 2, s[1] - size / 2, s[0] + tw / 2, s[1] + size / 2];
      if (overlaps(placedA, r) || overlaps(placedB, r)) continue;
      placedB.push(r);
      halo(q.name, s[0], s[1], size, 'rgba(40,40,52,0.78)', 'rgba(255,255,255,0.55)', 500);
    }
  }
  if ('letterSpacing' in g) g.letterSpacing = '0px';
}
