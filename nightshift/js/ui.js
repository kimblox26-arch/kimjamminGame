// 화면 위 UI 도우미
export const $ = (id) => document.getElementById(id);
// 그림 아이콘 (SVG, 글자색을 따라감)
const P = {
  pos: '<rect x="3" y="4" width="18" height="12" rx="1.6"/><path d="M12 16v4M8 20.5h8M6.5 8h7M6.5 11.5h4.5"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="1.6"/><circle cx="12" cy="12" r="2.7"/><path d="M6 9.2v.01M18 14.8v.01"/>',
  bag: '<path d="M5 8.5h14l-1.1 11.6a1.2 1.2 0 0 1-1.2 1.1H7.3a1.2 1.2 0 0 1-1.2-1.1z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
  turn: '<path d="M20 12.5a8 8 0 1 1-2.4-5.9"/><path d="M20.2 3.8v4.9h-4.9"/>',
  talk: '<path d="M4 4.5h16v11.5H10l-6 4.5z"/><path d="M8 9h8M8 12.3h5"/>',
  mic: '<rect x="9" y="2.8" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.6v3.4M8.6 21h6.8"/>',
  siren: '<path d="M7 18.5V13a5 5 0 0 1 10 0v5.5"/><path d="M4.5 18.5h15v2.7h-15zM12 2.5v2.2M3.6 6l1.6 1.6M20.4 6l-1.6 1.6M12 10.5a2.5 2.5 0 0 0-2.5 2.5"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13" stroke-width="3"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  cctv: '<path d="M3.5 7.2l11.8 3.6-1.6 5L2 12.2z"/><path d="M13.8 14.8l2.4.8V19h4.3M18 9.5l2.5.8"/>',
  warn: '<path d="M12 3.2l9.6 17H2.4z"/><path d="M12 10v4.8M12 17.6v.01"/>',
  police: '<path d="M3 17v-3.2L5.2 9h13.6L21 13.8V17z"/><circle cx="7.5" cy="17.2" r="1.9"/><circle cx="16.5" cy="17.2" r="1.9"/><path d="M10 5.5h4M12 5.5V9"/>',
  check: '<path d="M5 12.6l4.4 4.4L19 7.4"/>',
  card: '<rect x="2.5" y="5.5" width="19" height="13" rx="2"/><path d="M2.5 9.5h19M6 15h4"/>',
};
const STAR = '<path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z"/>';
export const ic = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;
export function paintIcons(root = document) { root.querySelectorAll('[data-ic]').forEach(el => (el.innerHTML = ic(el.dataset.ic))); }
export const won = (n) => (Math.round(n)).toLocaleString('ko-KR') + '원';
let subT = 0, mineT = 0, toastT = 0, hintTxt = '';

export function subtitle(who, text, boss = false, ms = 3500) {
  const el = $('sub'); el.innerHTML = `<b>${who}</b>${text}`; el.className = 'subtitle on' + (boss ? ' boss' : '');
  clearTimeout(subT); subT = setTimeout(() => el.classList.remove('on'), ms);
}
export function mine(text, partial = false) {
  const el = $('mine'); el.textContent = (partial ? '… ' : '나: ') + text; el.classList.add('on');
  clearTimeout(mineT); mineT = setTimeout(() => el.classList.remove('on'), partial ? 4000 : 2600);
}
export function toast(text, kind = '', ms = 1600) {
  const el = $('toast'); el.innerHTML = text; el.className = 'on ' + kind;
  clearTimeout(toastT); toastT = setTimeout(() => (el.className = ''), ms);
}
export function hint(text) { if (text === hintTxt) return; hintTxt = text; const el = $('hint'); el.innerHTML = text || ''; el.classList.toggle('on', !!text); }
export function show(id, on = true) { $(id).classList.toggle('hidden', !on); }
export function modal(html, buttons) {
  $('modalBody').innerHTML = html; const row = $('modalBtns'); row.innerHTML = '';
  for (const [label, cls, fn] of buttons) { const b = document.createElement('button'); b.textContent = label; b.className = cls; b.onclick = () => { if (fn() !== false) show('modal', false); }; row.appendChild(b); }
  show('modal');
}
export const stars = (rep) => { const n = Math.max(0, Math.min(5, Math.round(rep / 20))); let h = ''; for (let i = 0; i < 5; i++) h += `<svg class="ico star ${i < n ? 'on' : ''}" viewBox="0 0 24 24">${STAR}</svg>`; return h; };
