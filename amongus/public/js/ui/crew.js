// 크루원/꾸미기 아이템을 SVG로 그림 (이미지 파일 없이 전부 코드로 그림)
// 몸 좌표계(오른쪽을 봄): 발 중심 (64,120), 몸통 x 28~101, 머리 꼭대기 y 11, 바이저 x 54~108.
// 같은 경로 문자열을 캔버스(render.js, Path2D)도 그대로 써서 메뉴와 게임 속 모습이 똑같다.
import { COLORS } from '../shared/data.js';

// ---------- 색 ----------
const hx = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const mix = (a, b, k) => { const A = hx(a), B = hx(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join(''); };
export const colorOf = c => COLORS[c ?? 0] || COLORS[0];
// 크루원 색 묶음: 몸, 그림자, 테두리 빛
export const pal = look => {
  const c = colorOf(look?.color);
  return { name: c[0], body: c[1], shadow: c[2], rim: mix(c[1], '#ffffff', 0.42), deep: mix(c[2], '#000000', 0.35) };
};
export const VISOR = { main: '#95CADC', shade: '#4C7C8F', hi: '#ffffff' };

// ---------- 몸 모양 (경로) ----------
export const BODY = {
  torso: 'M28 92V56C28 28 44 11 66 11C88 11 101 27 101 52V92Q101 100 93 100H36Q28 100 28 92Z',
  main: 'M37 90C34 72 34 52 38 40C44 23 55 16 68 16C87 16 96 30 96 52V89Q72 95 37 90Z',
  pack: 'M32 42H23Q12 42 12 53V83Q12 94 23 94H32Z',
  packSh: 'M12 79V83Q12 94 23 94H32V79Z',
  packHi: 'M17 52Q17 47 22 47',
  visor: 'M69 25H93A15 15 0 0 1 93 55H69A15 15 0 0 1 69 25Z',
  visorSh: 'M55 44Q79 53 107 43Q106 55 93 55H69Q57 55 55 44Z',
  visorHi: 'M74 32H95',
  rim: 'M37 54C36 34 47 20 62 15',
};
// 시체: 허리에서 잘린 아랫몸 + 뼈
export const DEAD = {
  torso: 'M28 92V68Q45 61 63 65Q83 69 101 62V92Q101 100 93 100H36Q28 100 28 92Z',
  main: 'M37 90V71Q50 66 63 69Q81 72 96 68V89Q72 95 37 90Z',
  pack: 'M32 69H23Q12 69 12 77V83Q12 94 23 94H32Z',
  packSh: 'M12 82V83Q12 94 23 94H32V82Z',
  cut: 'M28 68Q45 59 63 63Q83 67 101 62Q99 72 82 73Q63 74 46 73Q30 73 28 68Z',
  cutIn: 'M40 68Q52 64 64 66Q78 68 90 66Q82 70 64 70Q50 71 40 68Z',
  bone: 'M58 66V46',
  knobs: [[53, 42], [64, 41]],
};
// 등 모습 (사다리 오르기)
export const BACK = {
  torso: 'M26 92V56C26 28 44 11 64 11C84 11 102 28 102 56V92Q102 100 94 100H34Q26 100 26 92Z',
  main: 'M34 90C31 72 31 50 36 38C42 22 52 16 64 16C82 16 96 30 96 56V89Q66 95 34 90Z',
  pack: 'M48 36H80Q90 36 90 46V80Q90 90 80 90H48Q38 90 38 80V46Q38 36 48 36Z',
  packSh: 'M38 76V80Q38 90 48 90H80Q90 90 90 80V76Z',
};
const legD = (x0, lift) => {
  const b = Math.round((120 - lift) * 10) / 10, x = Math.round(x0 * 10) / 10;
  return `M${x} 86V${b - 9}Q${x} ${b} ${x + 9} ${b}H${x + 19}Q${x + 28} ${b} ${x + 28} ${b - 9}V86Z`;
};
// 걷기: phase 0~1 (null = 서 있음). [뒷다리, 앞다리]
export const legsD = phase => {
  if (phase == null) return [legD(31, 0), legD(69, 0)];
  const a = phase * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
  return [legD(31 - s * 11, Math.max(0, -c) * 10), legD(69 + s * 11, Math.max(0, c) * 10)];
};
export const bobY = phase => (phase == null ? 0 : -Math.abs(Math.cos(phase * Math.PI * 2)) * 5);
// 유령: 다리 대신 물결 꼬리. w = 물결 위상
export const ghostD = (w = 0) => {
  const a = Math.sin(w) * 5, b = Math.cos(w) * 5, r = n => Math.round(n * 10) / 10;
  return `M28 56C28 28 44 11 66 11C88 11 101 27 101 52V86Q103 ${r(104 + a)} 92 ${r(103 + b)}Q84 ${r(98 - a)} 77 ${r(108 + b)}Q70 ${r(118 + a)} 60 ${r(108 - b)}Q52 ${r(99 + a)} 45 ${r(110 - a)}Q37 ${r(121 + b)} 31 ${r(106 + a)}Q27 98 28 86Z`;
};
export const GHOST_MAIN = 'M37 84C34 70 34 52 38 40C44 23 55 16 68 16C87 16 96 30 96 52V84Q66 92 37 84Z';

// ---------- 꾸미기 ----------
const K = 'stroke="#000" stroke-linejoin="round" stroke-linecap="round"';
export const HATS = {
  tophat: `<path d="M45 12V-30Q45-34 49-34H85Q89-34 89-30V12Z" fill="#26262b"/><path d="M45 1H89V10H45Z" fill="#b3202a"/><path d="M45 12V-30Q45-34 49-34H85Q89-34 89-30V12Z" fill="none" ${K} stroke-width="5"/>
    <path d="M51-27V-4" stroke="#5c5c66" stroke-width="5" stroke-linecap="round"/><path d="M28 14Q66 5 106 12Q112 15 106 20Q66 13 30 22Q22 19 28 14Z" fill="#26262b" ${K} stroke-width="5"/>`,
  cap: `<path d="M33 24C31-7 99-9 101 22Z" fill="#d63a3a" ${K} stroke-width="5"/><path d="M88 15Q113 11 131 20Q129 29 112 27L89 25Z" fill="#a82525" ${K} stroke-width="5"/>
    <path d="M44 8Q55-3 71-3" fill="none" stroke="#f08080" stroke-width="5" stroke-linecap="round"/><path d="M66-4V22" stroke="#a82525" stroke-width="2.5"/><circle cx="66" cy="-7" r="4.5" fill="#a82525" ${K} stroke-width="3"/>`,
  flower: `<path d="M66 14Q63 2 68-8" stroke="#000" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M66 14Q63 2 68-8" stroke="#3c8a2e" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M65 8Q53 1 50 10Q58 15 65 10Z" fill="#4fb33c" stroke="#000" stroke-width="3"/>
    <g ${K} stroke-width="3.5" fill="#ff8fd1"><circle cx="59" cy="-13" r="8"/><circle cx="77" cy="-13" r="8"/><circle cx="68" cy="-23" r="8"/><circle cx="62" cy="-2" r="8"/><circle cx="74" cy="-2" r="8"/></g>
    <circle cx="68" cy="-10" r="7" fill="#ffd93b" ${K} stroke-width="3"/><circle cx="66" cy="-12" r="2.4" fill="#fff" opacity=".85"/>`,
  beanie: `<path d="M31 24C29-17 103-17 101 24Z" fill="#3b7dd8" ${K} stroke-width="5"/><path d="M44 0V16M56-6V16M68-8V16M80-6V16M91 0V16" stroke="#2a5ca8" stroke-width="3"/>
    <path d="M29 13Q66 5 103 13V26Q66 18 29 26Z" fill="#2a5ca8" ${K} stroke-width="5"/><path d="M40 10Q52-6 66-8" stroke="#79aef0" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="66" cy="-15" r="9" fill="#fff" ${K} stroke-width="3.5"/>`,
  chef: `<path d="M42 18V0C26-4 28-32 48-28C52-46 80-46 84-28C104-32 106-4 90 0V18Z" fill="#fff" ${K} stroke-width="5"/><path d="M42 8H90" stroke="#c9ced6" stroke-width="3"/>
    <path d="M56-20Q58-8 56 2M72-22Q74-8 72 2" stroke="#dde2e8" stroke-width="3" fill="none"/>`,
  cowboy: `<path d="M14 16C34 31 98 31 120 12C114 4 103 8 96 10C96-26 36-26 36 10C29 8 21 6 14 16Z" fill="#9b5b2a" ${K} stroke-width="5"/><path d="M37 2Q66 10 95 2" stroke="#5a3010" stroke-width="6" fill="none"/>
    <path d="M47-13Q55-20 66-18" stroke="#c98a52" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  police: `<path d="M33 14C29-13 103-15 105 8Z" fill="#1f2d6b" ${K} stroke-width="5"/><path d="M37 7H101V19H37Z" fill="#141414" ${K} stroke-width="5"/><path d="M90 16Q116 15 126 24Q108 29 90 25Z" fill="#141414" ${K} stroke-width="5"/>
    <path d="M62-8L70-8L72 3L66 7L60 3Z" fill="#ffd34d" stroke="#000" stroke-width="2"/><path d="M42 1Q50-7 60-9" stroke="#4459a8" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  pumpkin: `<ellipse cx="66" cy="-4" rx="37" ry="26" fill="#f28a1d" ${K} stroke-width="5"/><path d="M49-26Q43-4 49 20M83-26Q89-4 83 20M66-30V22" stroke="#c96a0d" stroke-width="3" fill="none"/>
    <path d="M66-30C64-40 70-45 77-42" stroke="#000" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M66-30C64-40 70-45 77-42" stroke="#3c7a1e" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M52-10l7-9l7 9ZM70-10l7-9l7 9ZM49 2Q66 15 85 2Q79 7 75 5L73 9L68 5Q62 9 58 5L56 9Z" fill="#3a1b00"/><path d="M40-12Q44-22 52-25" stroke="#ffb35c" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  mushroom: `<path d="M21 20C19-35 113-35 111 20Q66 31 21 20Z" fill="#b8573a" ${K} stroke-width="5"/><g fill="#f6e7c8"><circle cx="47" cy="-3" r="7"/><circle cx="74" cy="-13" r="8"/><circle cx="93" cy="5" r="6"/><circle cx="62" cy="10" r="4.5"/></g>
    <path d="M32 2Q38-16 54-22" stroke="#d98a6a" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  crown: `<path d="M38 18L34-18L52-2L66-27L80-2L98-18L94 18Z" fill="#ffd23f" ${K} stroke-width="5"/><path d="M38 10H94" stroke="#d9a400" stroke-width="4"/>
    <circle cx="66" cy="4" r="5.5" fill="#e0245e" stroke="#000" stroke-width="2.5"/><circle cx="50" cy="5" r="4" fill="#2ab3ff" stroke="#000" stroke-width="2"/><circle cx="82" cy="5" r="4" fill="#2ab3ff" stroke="#000" stroke-width="2"/>
    <g fill="#ffd23f" stroke="#000" stroke-width="2.5"><circle cx="34" cy="-19" r="4"/><circle cx="66" cy="-28" r="4"/><circle cx="98" cy="-19" r="4"/></g><path d="M44 12V-6" stroke="#fff4b0" stroke-width="3" stroke-linecap="round"/>`,
  halo: `<ellipse cx="66" cy="-14" rx="32" ry="10" fill="none" stroke="#000" stroke-width="12"/><ellipse cx="66" cy="-14" rx="32" ry="10" fill="none" stroke="#ffe066" stroke-width="7"/>
    <path d="M42-20Q58-26 78-24" stroke="#fffbe0" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
  horns: `<path d="M40 18C30 2 30-14 36-26C42-12 50-2 56 10ZM92 18C102 2 102-14 96-26C90-12 82-2 76 10Z" fill="#d31f1f" ${K} stroke-width="4.5"/>
    <path d="M37-6Q37-17 39-21M95-6Q95-17 93-21" stroke="#ff7a7a" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  party: `<path d="M44 18L68-46L92 18Z" fill="#4ad6ff"/><path d="M52-4H84M60-24H76" stroke="#ff4fa3" stroke-width="7"/><path d="M44 18L68-46L92 18Z" fill="none" ${K} stroke-width="5"/>
    <circle cx="68" cy="-48" r="8" fill="#ffe14d" ${K} stroke-width="3.5"/>`,
  cone: `<path d="M40 16L60-42L72-42L92 16Z" fill="#8e44ff"/><path d="M52-8L80-8L84 4L48 4ZM57-26L75-26L78-18L54-18Z" fill="#fff"/><path d="M40 16L60-42L72-42L92 16Z" fill="none" ${K} stroke-width="5"/>
    <rect x="28" y="12" width="76" height="10" rx="4" fill="#6a28c9" ${K} stroke-width="4"/>`,
};
export const VISORS = {
  shades: `<path d="M54 30H110V38Q110 50 99 50H90Q83 50 82 42L80 39L78 42Q77 50 70 50H63Q54 50 54 40Z" fill="#141414" ${K} stroke-width="3"/><path d="M60 35H72M86 35H101" stroke="#5c6670" stroke-width="3.5" stroke-linecap="round"/>`,
  blush: `<ellipse cx="62" cy="63" rx="9" ry="5" fill="#ff7aa8" opacity=".85"/><ellipse cx="97" cy="63" rx="7" ry="5" fill="#ff7aa8" opacity=".85"/>`,
  monocle: `<circle cx="93" cy="40" r="14" fill="#fff" fill-opacity=".15" stroke="#000" stroke-width="7"/><circle cx="93" cy="40" r="14" fill="none" stroke="#ffd23f" stroke-width="4"/><path d="M93 54Q86 76 64 84" fill="none" stroke="#ffd23f" stroke-width="2.5"/>`,
  mask: `<path d="M54 20H108Q113 46 102 66H62Q49 46 54 20Z" fill="#f2f2f2" ${K} stroke-width="4"/><g fill="#222"><ellipse cx="70" cy="34" rx="7" ry="5.5"/><ellipse cx="94" cy="34" rx="7" ry="5.5"/><circle cx="74" cy="51" r="2.2"/><circle cx="82" cy="54" r="2.2"/><circle cx="90" cy="51" r="2.2"/><circle cx="82" cy="46" r="2.2"/></g><path d="M66 24L72 28M98 24L92 28" stroke="#d01e1e" stroke-width="3"/>`,
};
// 스킨: svg = 몸통 위에 덧그림(몸통 모양으로 잘림), leg = 다리 색, back = 몸 뒤
export const SKINS = {
  suit: { leg: '#232838', svg: `<path d="M20 58H110V110H20Z" fill="#232838"/><path d="M70 58L81 80L92 58Z" fill="#f4f4f4"/><path d="M79 61H83L84 77L81 83L78 77Z" fill="#c22"/><path d="M70 58L79 92M92 58L83 92" stroke="#0e1018" stroke-width="3" fill="none"/><circle cx="88" cy="86" r="2.2" fill="#555"/><path d="M20 58H110" stroke="#000" stroke-width="3"/>` },
  police: { leg: '#1f2d6b', svg: `<path d="M20 58H110V110H20Z" fill="#2a3f8f"/><path d="M20 86H110V94H20Z" fill="#141414"/><rect x="74" y="86" width="12" height="8" fill="#d9b02a"/><path d="M84 66l5-4l5 4l-1.5 8h-7Z" fill="#ffd34d" stroke="#000" stroke-width="1.5"/><path d="M20 58H110" stroke="#000" stroke-width="3"/>` },
  doctor: { leg: null, svg: `<path d="M20 56H110V110H20Z" fill="#f4f7fb"/><path d="M82 56V110" stroke="#b9c4d4" stroke-width="3"/><path d="M72 56L82 70L92 56" fill="none" stroke="#b9c4d4" stroke-width="3"/><path d="M88 77h10M93 72v10" stroke="#e33" stroke-width="4"/><path d="M20 56H110" stroke="#000" stroke-width="3"/>` },
  cape: { leg: null, svg: `<circle cx="36" cy="58" r="5" fill="#ffd23f" stroke="#000" stroke-width="2"/>`,
    back: `<path d="M34 38C16 54 4 92 8 122Q24 127 42 114L42 44Z" fill="#3a1f5c" ${K} stroke-width="5"/><path d="M27 60Q18 86 16 112" stroke="#5b3690" stroke-width="4" fill="none" stroke-linecap="round"/>` },
};

const EYE = (x, y) => `<circle cx="${x}" cy="${y}" r="2.8" fill="#000"/><circle cx="${x + 0.9}" cy="${y - 0.9}" r="1" fill="#fff"/>`;
export const PETS = {
  mini: c => `<path d="M14 18H9Q4 18 4 23V35Q4 40 9 40H14Z" fill="${c[1]}" ${K} stroke-width="3.5"/>
    <path d="M12 42V22C12 9 20 4 29 4C39 4 46 10 46 21V42Q46 46 42 46H36Q33 46 33 42V40H25V42Q25 46 21 46H16Q12 46 12 42Z" fill="${c[2]}" ${K} stroke-width="3.5"/>
    <path d="M16 38C15 30 15 20 18 15C21 9 25 7 30 7C38 7 43 13 43 21V37Q30 40 16 38Z" fill="${c[1]}"/>
    <rect x="26" y="12" width="23" height="13" rx="6.5" fill="#95CADC" ${K} stroke-width="3"/><path d="M31 16H42" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`,
  dog: () => `<path d="M9 30Q2 24 6 17" stroke="#000" stroke-width="7" stroke-linecap="round" fill="none"/><path d="M9 30Q2 24 6 17" stroke="#c98a4b" stroke-width="3.5" stroke-linecap="round" fill="none"/>
    <path d="M14 40V46M22 41V46M30 41V46M36 40V46" stroke="#000" stroke-width="6.5" stroke-linecap="round"/><path d="M14 40V46M22 41V46M30 41V46M36 40V46" stroke="#c98a4b" stroke-width="3.5" stroke-linecap="round"/>
    <ellipse cx="24" cy="32" rx="17" ry="11" fill="#c98a4b" ${K} stroke-width="3"/><ellipse cx="22" cy="36" rx="10" ry="5" fill="#e0aa70"/>
    <circle cx="40" cy="20" r="12" fill="#c98a4b" ${K} stroke-width="3"/><ellipse cx="48" cy="24" rx="7" ry="5" fill="#f0d2a8" ${K} stroke-width="2.5"/><circle cx="53" cy="22" r="2.6" fill="#000"/>
    <path d="M32 12Q28 22 34 28Q38 20 36 12Z" fill="#7a4a1f" ${K} stroke-width="2.5"/>${EYE(43, 16)}`,
  hamster: () => `<ellipse cx="26" cy="30" rx="21" ry="16" fill="#f0c27a" ${K} stroke-width="3"/><ellipse cx="32" cy="35" rx="11" ry="8" fill="#fff3dc"/>
    <circle cx="15" cy="16" r="5.5" fill="#e8a7a0" ${K} stroke-width="2.5"/><circle cx="33" cy="15" r="5.5" fill="#e8a7a0" ${K} stroke-width="2.5"/>
    ${EYE(38, 25)}<ellipse cx="45" cy="30" rx="2.5" ry="2" fill="#e86a8a"/><ellipse cx="39" cy="33" rx="4" ry="2.5" fill="#ff9fb0" opacity=".7"/><path d="M12 22Q16 17 22 16" stroke="#fff3dc" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  ufo: () => `<path d="M17 36L10 48H42L35 36Z" fill="#fff6a8" opacity=".35"/><ellipse cx="26" cy="20" rx="13" ry="11" fill="#9fe7ff" ${K} stroke-width="3"/><path d="M20 14Q24 11 28 12" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <ellipse cx="26" cy="28" rx="25" ry="8.5" fill="#9aa4ae" ${K} stroke-width="3"/><ellipse cx="26" cy="26" rx="18" ry="3.5" fill="#c3cbd3"/>
    <circle cx="12" cy="29" r="2.6" fill="#ffe14d"/><circle cx="26" cy="32" r="2.6" fill="#ff5d5d"/><circle cx="40" cy="29" r="2.6" fill="#7dff8a"/>`,
  ghost: () => `<path d="M8 44V20C8 7 17 2 26 2C36 2 44 8 44 20V44L38 39L32 45L26 39L20 45L14 39Z" fill="#fff" ${K} stroke-width="3" opacity=".92"/><ellipse cx="21" cy="21" rx="3.4" ry="4.4" fill="#000"/><ellipse cx="33" cy="21" rx="3.4" ry="4.4" fill="#000"/><ellipse cx="27" cy="31" rx="3" ry="2.4" fill="#000"/><path d="M13 12Q16 7 22 6" stroke="#dfe8ff" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
};

// ---------- 크루원 조립 ----------
let uid = 0;
const visorG = () => `<path d="${BODY.visor}" fill="${VISOR.main}"/><path d="${BODY.visorSh}" fill="${VISOR.shade}"/><path d="${BODY.visor}" fill="none" ${K} stroke-width="6.5"/>
  <path d="${BODY.visorHi}" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".92"/><circle cx="101" cy="33" r="2.4" fill="#fff" opacity=".75"/>`;
function aliveG(p, look, phase, id) {
  const [bl, fl] = legsD(phase), sk = SKINS[look.skin];
  const lf = sk?.leg || p.body, lb = sk?.leg ? mix(sk.leg, '#000000', 0.3) : p.shadow;
  const lean = phase == null ? '' : ' rotate(3 64 120)';
  return `<g transform="translate(0 ${bobY(phase).toFixed(1)})${lean}">${sk?.back || ''}
    <path d="${BODY.pack}" fill="${p.body}"/><path d="${BODY.packSh}" fill="${p.shadow}"/><path d="${BODY.packHi}" stroke="${p.rim}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/><path d="${BODY.pack}" fill="none" ${K} stroke-width="10"/>
    <g fill="none" ${K} stroke-width="13"><path d="${BODY.torso}"/><path d="${bl}"/><path d="${fl}"/></g>
    <path d="${bl}" fill="${lb}"/><path d="${fl}" fill="${lf}"/><path d="${BODY.torso}" fill="${p.shadow}"/><path d="${BODY.main}" fill="${p.body}"/>
    ${sk ? `<clipPath id="${id}"><path d="${BODY.torso}"/></clipPath><g clip-path="url(#${id})">${sk.svg}</g>` : ''}
    <path d="${BODY.rim}" fill="none" stroke="${p.rim}" stroke-width="5" stroke-linecap="round" opacity=".8"/>
    ${visorG()}${VISORS[look.visor] || ''}${HATS[look.hat] || ''}</g>`;
}
function deadG(p, look, id) {
  const [bl, fl] = legsD(null), sk = SKINS[look.skin];
  const lf = sk?.leg || p.body, lb = sk?.leg ? mix(sk.leg, '#000000', 0.3) : p.shadow;
  const [k1, k2] = DEAD.knobs;
  return `<path d="${DEAD.pack}" fill="${p.body}"/><path d="${DEAD.packSh}" fill="${p.shadow}"/><path d="${DEAD.pack}" fill="none" ${K} stroke-width="10"/>
    <g fill="none" ${K} stroke-width="13"><path d="${DEAD.torso}"/><path d="${bl}"/><path d="${fl}"/></g>
    <path d="${bl}" fill="${lb}"/><path d="${fl}" fill="${lf}"/><path d="${DEAD.torso}" fill="${p.shadow}"/><path d="${DEAD.main}" fill="${p.body}"/>
    ${sk ? `<clipPath id="${id}"><path d="${DEAD.torso}"/></clipPath><g clip-path="url(#${id})">${sk.svg}</g>` : ''}
    <path d="${DEAD.cut}" fill="${p.deep}" ${K} stroke-width="4"/><path d="${DEAD.cutIn}" fill="${mix(p.shadow, '#ff9a9a', 0.25)}" opacity=".75"/>
    <path d="${DEAD.bone}" stroke="#000" stroke-width="16" stroke-linecap="round"/><circle cx="${k1[0]}" cy="${k1[1]}" r="8.5" fill="#000"/><circle cx="${k2[0]}" cy="${k2[1]}" r="8.5" fill="#000"/>
    <path d="${DEAD.bone}" stroke="#f1eee2" stroke-width="9" stroke-linecap="round"/><circle cx="${k1[0]}" cy="${k1[1]}" r="5.5" fill="#f1eee2"/><circle cx="${k2[0]}" cy="${k2[1]}" r="5.5" fill="#f1eee2"/>
    <path d="M56 62V50" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".8"/>`;
}
function ghostG(p, look, w) {
  const gd = ghostD(w);
  return `<path d="M32 46H24Q15 46 15 55V76Q15 84 24 84H32Z" fill="${p.body}" ${K} stroke-width="9"/>
    <path d="${gd}" fill="${p.shadow}" ${K} stroke-width="6.5"/><path d="${GHOST_MAIN}" fill="${p.body}"/><path d="${gd}" fill="none" ${K} stroke-width="6.5"/>
    <path d="${BODY.rim}" fill="none" stroke="${p.rim}" stroke-width="5" stroke-linecap="round" opacity=".8"/>${visorG()}${VISORS[look.visor] || ''}${HATS[look.hat] || ''}`;
}

// 크루원 SVG. o: {frame(0=서 있음, 1~6 걷기), phase, dead, ghost, flip, noPet, head(머리만 크게), petLeft, wave}
export function crewSVG(look = {}, o = {}) {
  look = look || {};
  const p = pal(look), id = 'au' + (++uid).toString(36);
  const phase = o.phase ?? (o.frame > 0 ? ((o.frame - 1) % 6) / 6 : null);
  const inner = o.dead ? deadG(p, look, id) : o.ghost ? ghostG(p, look, o.wave ?? 0) : aliveG(p, look, phase, id);
  const pet = !o.noPet && !o.dead && !o.ghost && !o.head && PETS[look.pet] ? `<g transform="translate(${o.petLeft ? -54 : 112} 76) scale(.9)">${PETS[look.pet](colorOf(look.color))}</g>` : '';
  const flip = o.flip ? ' transform="translate(128 0) scale(-1 1)"' : '';
  const vb = o.head ? '-2 -34 128 92' : '-60 -50 250 180';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" class="crew"><g${o.ghost ? ' opacity=".6"' : ''}><g${flip}>${inner}</g>${pet}</g></svg>`;
}
// 몸통 중심이 이미지 안에서 차지하는 위치 (캔버스 그리기용): viewBox(-60,-50,250,180)
export const CREW_BOX = { w: 250, h: 180, cx: 124, foot: 170 };

// 꾸미기 한 겹만 담은 SVG 문서 (캔버스에서 비트맵으로 굽기용). 좌표 = 몸 좌표계
export const COS_BOX = { x: -40, y: -70, w: 220, h: 210 };
export function cosmeticSVG(kind, id, look = {}) {
  let body = '';
  if (kind === 'hat') body = HATS[id] || '';
  else if (kind === 'visor') body = VISORS[id] || '';
  else if (kind === 'skin' || kind === 'skinDead') {
    const sk = SKINS[id];
    if (sk) body = `<clipPath id="c"><path d="${kind === 'skin' ? BODY.torso : DEAD.torso}"/></clipPath><g clip-path="url(#c)">${sk.svg}</g>`;
  } else if (kind === 'skinBack') body = SKINS[id]?.back || '';
  else if (kind === 'pet') return PETS[id] ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 60 56" width="60" height="56">${PETS[id](colorOf(look.color))}</svg>` : '';
  if (!body) return '';
  const b = COS_BOX;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" width="${b.w}" height="${b.h}">${body}</svg>`;
}

const cache = new Map();
const svgUrl = s => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
export function crewImg(look = {}, o = {}) {
  const key = JSON.stringify([look.color, look.hat, look.visor, look.skin, o.frame | 0, !!o.dead, !!o.ghost, !!o.flip, !!o.head]);
  let img = cache.get(key);
  if (!img) {
    img = new Image();
    img.src = svgUrl(crewSVG(look, { ...o, noPet: true }));
    cache.set(key, img);
  }
  return img;
}
const petCache = new Map();
export function petImg(look = {}) {
  if (!PETS[look.pet]) return null;
  const key = look.pet + ':' + look.color;
  let img = petCache.get(key);
  if (!img) {
    img = new Image();
    img.src = svgUrl(cosmeticSVG('pet', look.pet, look));
    petCache.set(key, img);
  }
  return img;
}
export const itemSVG = (type, id, color = 0) => {
  const look = { color, hat: 'none', visor: 'none', skin: 'none', pet: 'none', [type]: id };
  if (type === 'pet') return PETS[id] ? `<svg viewBox="-4 -4 60 56">${PETS[id](colorOf(color))}</svg>` : '';
  if (type === 'plate') return `<div class="plate plate-${id}"></div>`;
  return crewSVG(look);
};
// 맵 아이콘 (원형)
export const MAP_ICONS = {
  skeld: `<circle cx="50" cy="50" r="46" fill="#b9c3c3"/><path d="M22 60 L40 30 L62 26 L80 44 L70 70 L44 76 Z" fill="#5d6b6b" stroke="#2a3333" stroke-width="4"/><path d="M40 30 L50 52 L80 44 M50 52 L44 76" stroke="#2a3333" stroke-width="3" fill="none"/>`,
  mira: `<circle cx="50" cy="50" r="46" fill="#ffd6d0"/><path d="M28 62 C16 52 26 34 40 38 C42 24 62 22 66 34 C80 30 88 48 76 58 C80 72 60 78 52 68 C42 78 26 74 28 62 Z" fill="#ff6a5c" stroke="#7a1c14" stroke-width="4"/><circle cx="50" cy="52" r="8" fill="#ffd6d0"/>`,
  polus: `<circle cx="50" cy="50" r="46" fill="#2a1f3d"/><path d="M62 18 A32 32 0 1 0 78 72 A26 26 0 1 1 62 18 Z" fill="#e8d6ff" stroke="#000" stroke-width="3"/><circle cx="56" cy="58" r="10" fill="#ff8a3c"/>`,
  airship: `<circle cx="50" cy="50" r="46" fill="#ffe7e0"/><ellipse cx="48" cy="44" rx="34" ry="16" fill="#d32f2f" stroke="#5a0f0f" stroke-width="4"/><rect x="36" y="58" width="26" height="12" rx="4" fill="#fff" stroke="#5a0f0f" stroke-width="3"/><path d="M80 40 L94 30 L92 56 Z" fill="#d32f2f"/>`,
  fungle: `<circle cx="50" cy="50" r="46" fill="#ffd9a8"/><path d="M18 50 C18 18 82 18 82 50 Z" fill="#ff7b2e" stroke="#6b2a00" stroke-width="4"/><circle cx="38" cy="38" r="6" fill="#ffe6c8"/><circle cx="60" cy="34" r="5" fill="#ffe6c8"/><rect x="42" y="50" width="16" height="30" rx="6" fill="#fff3dc" stroke="#6b2a00" stroke-width="4"/>`,
};
export const mapIcon = id => `<svg viewBox="0 0 100 100">${MAP_ICONS[id] || ''}</svg>`;
