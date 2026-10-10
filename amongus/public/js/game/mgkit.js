// 미니게임 공용 도구 (tasks.js / tasks2.js 공용)
// 미니게임 계약: GAMES[id] = (el, done, ctx) => cleanup|undefined
//   el   : 620x620 논리 크기의 .mg 컨테이너 (SVG viewBox 0 0 620 620 권장)
//   done : 성공 시 1번 호출
//   ctx  : { station, task, step, params, map, visual(kind,on), fix(on), sab, onClose }
import { sfx } from '../core.js';
export const S = 620;
export { sfx };
export const at = (e, el) => { const r = el.getBoundingClientRect(); return [(e.clientX - r.left) * S / r.width, (e.clientY - r.top) * S / r.height]; };
export const svg = (el, inner) => { el.insertAdjacentHTML('beforeend', `<svg class="full" viewBox="0 0 ${S} ${S}">${inner}</svg>`); return el.lastElementChild; };
export function dragger(el, { down, move, up }) {
  let on = false;
  el.addEventListener('pointerdown', e => { const p = at(e, el); if (down(p, e) !== false) { on = true; el.setPointerCapture(e.pointerId); } });
  el.addEventListener('pointermove', e => on && move?.(at(e, el), e));
  const end = e => { if (on) { on = false; up?.(at(e, el), e); } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
export const msg = (el, text) => { let m = el.querySelector('.t'); if (!m) { m = document.createElement('div'); m.className = 't'; el.append(m); } m.textContent = text; };
export const rand = (a, b) => a + Math.random() * (b - a);
export const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// requestAnimationFrame 루프 헬퍼: loop(dt, t) 가 false 를 돌려주면 멈춤. 정리 함수 반환.
export function animate(loop) {
  let raf, last = performance.now();
  const f = t => { const dt = Math.min(0.05, (t - last) / 1000); last = t; if (loop(dt, t) === false) return; raf = requestAnimationFrame(f); };
  raf = requestAnimationFrame(f);
  return () => cancelAnimationFrame(raf);
}
