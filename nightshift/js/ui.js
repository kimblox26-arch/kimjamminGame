// 화면 위 UI 도우미
export const $ = (id) => document.getElementById(id);
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
export function hint(text) { if (text === hintTxt) return; hintTxt = text; const el = $('hint'); el.textContent = text || ''; el.classList.toggle('on', !!text); }
export function show(id, on = true) { $(id).classList.toggle('hidden', !on); }
export function modal(html, buttons) {
  $('modalBody').innerHTML = html; const row = $('modalBtns'); row.innerHTML = '';
  for (const [label, cls, fn] of buttons) { const b = document.createElement('button'); b.textContent = label; b.className = cls; b.onclick = () => { if (fn() !== false) show('modal', false); }; row.appendChild(b); }
  show('modal');
}
export const stars = (rep) => { const n = Math.max(0, Math.min(5, Math.round(rep / 20))); return '★'.repeat(n) + '☆'.repeat(5 - n); };
