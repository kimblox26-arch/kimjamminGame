// 크루원/꾸미기 아이템을 SVG로 그림 (이미지 파일 없이 전부 코드로 그림)
import { COLORS } from '../shared/data.js';

const K = 'stroke="#000" stroke-linejoin="round"';
const HATS = {
  tophat: `<rect x="40" y="-30" width="46" height="38" rx="3" fill="#2b2b2b" ${K} stroke-width="5"/><rect x="40" y="-4" width="46" height="8" fill="#b3202a"/><rect x="28" y="4" width="70" height="10" rx="5" fill="#2b2b2b" ${K} stroke-width="5"/>`,
  cap: `<path d="M34 16 C34 -8 92 -8 94 16 Z" fill="#d23c3c" ${K} stroke-width="5"/><path d="M86 12 L122 14 C122 22 100 22 86 18 Z" fill="#a62020" ${K} stroke-width="5"/><circle cx="64" cy="-2" r="4" fill="#fff"/>`,
  flower: `<g ${K} stroke-width="3"><circle cx="54" cy="0" r="9" fill="#ff8fd1"/><circle cx="70" cy="0" r="9" fill="#ff8fd1"/><circle cx="62" cy="-12" r="9" fill="#ff8fd1"/><circle cx="62" cy="10" r="9" fill="#ff8fd1"/><circle cx="62" cy="0" r="7" fill="#ffe14d"/></g>`,
  beanie: `<path d="M32 18 C30 -14 98 -14 96 18 Z" fill="#3b7dd8" ${K} stroke-width="5"/><path d="M32 14 H96 V22 H32 Z" fill="#2a5ca8" ${K} stroke-width="5"/><circle cx="64" cy="-12" r="8" fill="#fff" ${K} stroke-width="3"/>`,
  chef: `<path d="M40 14 V-4 C26 -10 30 -34 48 -30 C52 -46 76 -46 80 -30 C98 -34 102 -10 88 -4 V14 Z" fill="#fff" ${K} stroke-width="5"/><path d="M40 6 H88" stroke="#ccc" stroke-width="3"/>`,
  cowboy: `<path d="M20 14 C40 24 90 24 110 10 C104 4 96 8 92 8 C92 -24 38 -24 38 8 C32 8 24 6 20 14 Z" fill="#9b5b2a" ${K} stroke-width="5"/><path d="M40 2 H90" stroke="#5a3010" stroke-width="5"/>`,
  police: `<path d="M34 14 C34 -14 94 -14 94 14 Z" fill="#1f2d6b" ${K} stroke-width="5"/><path d="M30 12 H100 V20 H30 Z" fill="#111" ${K} stroke-width="5"/><path d="M60 -8 L68 -8 L70 4 L64 8 L58 4 Z" fill="#ffd34d" stroke="#000" stroke-width="2"/>`,
  pumpkin: `<ellipse cx="64" cy="-2" rx="34" ry="24" fill="#f28a1d" ${K} stroke-width="5"/><path d="M64 -26 C62 -34 68 -38 72 -36" fill="none" stroke="#3c7a1e" stroke-width="5"/><path d="M50 -6 l6 -8 l6 8 Z M66 -6 l6 -8 l6 8 Z M48 6 Q64 16 80 6 Z" fill="#3a1b00"/>`,
  mushroom: `<path d="M24 14 C24 -30 104 -30 104 14 Z" fill="#8a5a3a" ${K} stroke-width="5"/><circle cx="48" cy="-4" r="6" fill="#f2e3c6"/><circle cx="74" cy="-12" r="7" fill="#f2e3c6"/><circle cx="88" cy="4" r="5" fill="#f2e3c6"/>`,
  crown: `<path d="M36 14 L32 -18 L50 -2 L64 -24 L78 -2 L96 -18 L92 14 Z" fill="#ffd23f" ${K} stroke-width="5"/><circle cx="64" cy="4" r="5" fill="#e0245e"/>`,
  halo: `<ellipse cx="64" cy="-18" rx="30" ry="9" fill="none" stroke="#ffe066" stroke-width="7"/><ellipse cx="64" cy="-18" rx="30" ry="9" fill="none" stroke="#000" stroke-width="1.5"/>`,
  horns: `<path d="M38 14 C30 -2 30 -16 34 -26 C40 -14 46 -4 52 8 Z M90 14 C98 -2 98 -16 94 -26 C88 -14 82 -4 76 8 Z" fill="#d31f1f" ${K} stroke-width="4"/>`,
  party: `<path d="M44 14 L66 -44 L88 14 Z" fill="#4ad6ff" ${K} stroke-width="5"/><path d="M52 -6 L80 -6 M58 -24 L74 -24" stroke="#ff4fa3" stroke-width="6"/><circle cx="66" cy="-46" r="7" fill="#ffe14d" ${K} stroke-width="3"/>`,
  cone: `<path d="M38 14 L58 -42 L74 -42 L94 14 Z" fill="#8e44ff" ${K} stroke-width="5"/><path d="M50 -10 L82 -10 L86 2 L46 2 Z M56 -28 L76 -28 L79 -20 L53 -20 Z" fill="#fff"/><rect x="28" y="10" width="76" height="9" rx="3" fill="#6a28c9" ${K} stroke-width="4"/>`,
};
const VISORS = {
  shades: `<rect x="56" y="26" width="52" height="22" rx="8" fill="#111"/><rect x="64" y="30" width="16" height="5" rx="2" fill="#666"/>`,
  blush: `<ellipse cx="62" cy="60" rx="9" ry="5" fill="#ff7aa8" opacity=".85"/><ellipse cx="98" cy="60" rx="7" ry="5" fill="#ff7aa8" opacity=".85"/>`,
  monocle: `<circle cx="92" cy="40" r="15" fill="none" stroke="#ffd23f" stroke-width="4"/><path d="M92 55 Q80 80 60 86" fill="none" stroke="#ffd23f" stroke-width="2"/>`,
  mask: `<path d="M56 18 H106 Q110 44 100 62 H62 Q52 44 56 18 Z" fill="#f2f2f2" ${K} stroke-width="3"/><g fill="#222"><ellipse cx="72" cy="34" rx="6" ry="5"/><ellipse cx="94" cy="34" rx="6" ry="5"/><circle cx="76" cy="50" r="2"/><circle cx="84" cy="52" r="2"/><circle cx="92" cy="50" r="2"/></g>`,
};
const SKINS = {
  suit: `<path d="M30 74 H98 V104 H30 Z" fill="#232838"/><path d="M58 74 L66 92 L74 74 Z" fill="#fff"/><path d="M64 78 L68 78 L67 96 L65 96 Z" fill="#c22"/>`,
  police: `<path d="M30 74 H98 V104 H30 Z" fill="#2a3f8f"/><path d="M80 80 l5 -3 l5 3 l-1 7 h-8 Z" fill="#ffd34d"/><path d="M30 98 H98" stroke="#111" stroke-width="6"/>`,
  doctor: `<path d="M30 70 H98 V104 H30 Z" fill="#f4f7fb"/><path d="M60 70 V104" stroke="#b9c4d4" stroke-width="3"/><path d="M82 84 h10 M87 79 v10" stroke="#e33" stroke-width="4"/>`,
};
const CAPE = `<path d="M10 40 C2 70 0 100 8 126 L36 118 L36 44 Z" fill="#3a1f5c" ${K} stroke-width="5"/>`;

const EYE = (x, y) => `<circle cx="${x}" cy="${y}" r="4" fill="#000"/>`;
export const PETS = {
  mini: c => `<path d="M10 40 V20 C10 6 20 2 26 2 C36 2 42 8 42 20 V44 H30 V38 H22 V44 H10 Z" fill="${c[1]}" ${K} stroke-width="3"/><rect x="24" y="12" width="20" height="12" rx="6" fill="#95CADC" stroke="#000" stroke-width="3"/>`,
  dog: () => `<ellipse cx="26" cy="32" rx="20" ry="13" fill="#c98a4b" ${K} stroke-width="3"/><circle cx="40" cy="18" r="11" fill="#c98a4b" ${K} stroke-width="3"/><path d="M34 10 l-4 -8 l8 4 Z" fill="#7a4a1f"/>${EYE(43, 16)}<path d="M8 28 l-6 -6" stroke="#000" stroke-width="3"/>`,
  hamster: () => `<ellipse cx="26" cy="28" rx="20" ry="16" fill="#f0c27a" ${K} stroke-width="3"/><ellipse cx="30" cy="34" rx="10" ry="8" fill="#fff3dc"/>${EYE(32, 22)}<circle cx="18" cy="14" r="5" fill="#e8a7a0" stroke="#000" stroke-width="2"/>`,
  ufo: () => `<ellipse cx="26" cy="20" rx="12" ry="10" fill="#9fe7ff" ${K} stroke-width="3"/><ellipse cx="26" cy="28" rx="24" ry="8" fill="#9aa4ae" ${K} stroke-width="3"/><circle cx="14" cy="29" r="2.5" fill="#ffe14d"/><circle cx="26" cy="31" r="2.5" fill="#ffe14d"/><circle cx="38" cy="29" r="2.5" fill="#ffe14d"/>`,
  ghost: () => `<path d="M8 44 V20 C8 6 18 2 26 2 C36 2 44 8 44 20 V44 L38 38 L32 44 L26 38 L20 44 L14 38 Z" fill="#fff" ${K} stroke-width="3" opacity=".9"/>${EYE(22, 20)}${EYE(34, 20)}`,
};

// 크루원 SVG. o: {frame(0~2), dead, ghost, flip, noPet}
export function crewSVG(look = {}, o = {}) {
  const c = COLORS[look.color ?? 0] || COLORS[0];
  const f = o.frame || 0, a = f === 1 ? -9 : 0, b = f === 2 ? -9 : 0;
  const body = `M30 ${112 + a} V48 C30 22 46 8 64 8 C84 8 98 22 98 48 V${112 + b} Q98 ${120 + b} 90 ${120 + b} H78 Q70 ${120 + b} 70 ${112 + b} V104 H58 V${112 + a} Q58 ${120 + a} 50 ${120 + a} H38 Q30 ${120 + a} 30 ${112 + a} Z`;
  let inner;
  if (o.dead) {
    inner = `<path d="M30 118 V82 H98 V118 Q98 124 90 124 H38 Q30 124 30 118 Z" fill="${c[1]}" ${K} stroke-width="5"/><path d="M30 104 H98 V118 Q98 124 90 124 H38 Q30 124 30 118Z" fill="${c[2]}"/>
      <rect x="10" y="80" width="22" height="30" rx="8" fill="${c[2]}" ${K} stroke-width="5"/><path d="M56 82 V62" stroke="#f0f0e8" stroke-width="10"/><circle cx="50" cy="60" r="7" fill="#f0f0e8" ${K} stroke-width="3"/><circle cx="62" cy="60" r="7" fill="#f0f0e8" ${K} stroke-width="3"/>
      <ellipse cx="64" cy="82" rx="30" ry="6" fill="#d33"/>`;
  } else {
    const hat = HATS[look.hat] || '', vis = VISORS[look.visor] || '', skin = SKINS[look.skin] || '';
    inner = `${look.skin === 'cape' ? CAPE : ''}<rect x="10" y="42" width="24" height="52" rx="10" fill="${c[2]}" ${K} stroke-width="5"/>
      <path d="${body}" fill="${c[2]}"/><path d="M30 86 V48 C30 22 46 8 64 8 C84 8 98 22 98 48 V78 Q62 100 30 86 Z" fill="${c[1]}"/>${skin}
      <path d="${body}" fill="none" ${K} stroke-width="6"/>
      <rect x="56" y="24" width="50" height="30" rx="15" fill="#95CADC" ${K} stroke-width="5"/><path d="M60 46 Q84 54 104 44 L104 40 Q104 54 90 54 H72 Q60 54 60 46Z" fill="#4c7c8f"/><rect x="72" y="29" width="24" height="8" rx="4" fill="#fff" opacity=".85"/>
      ${vis}${hat}`;
  }
  const pet = !o.noPet && !o.dead && PETS[look.pet] ? `<g transform="translate(${o.petLeft ? -50 : 108} 76)">${PETS[look.pet](c)}</g>` : '';
  const flip = o.flip ? ' transform="translate(128 0) scale(-1 1)"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-60 -50 250 180" class="crew"><g${o.ghost ? ' opacity=".5"' : ''}><g${flip}>${inner}</g>${pet}</g></svg>`;
}
// 몸통 중심이 이미지 안에서 차지하는 위치 (캔버스 그리기용): viewBox(-60,-50,250,180)
export const CREW_BOX = { w: 250, h: 180, cx: 124, foot: 170 };

const cache = new Map();
export function crewImg(look, o = {}) {
  const key = JSON.stringify([look.color, look.hat, look.visor, look.skin, o.frame | 0, !!o.dead, !!o.ghost, !!o.flip]);
  let img = cache.get(key);
  if (!img) {
    img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(crewSVG(look, { ...o, noPet: true }));
    cache.set(key, img);
  }
  return img;
}
const petCache = new Map();
export function petImg(look) {
  const key = look.pet + look.color;
  if (!PETS[look.pet]) return null;
  let img = petCache.get(key);
  if (!img) {
    img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 60 56">${PETS[look.pet](COLORS[look.color] || COLORS[0])}</svg>`);
    petCache.set(key, img);
  }
  return img;
}
export const itemSVG = (type, id, color = 0) => {
  const look = { color, hat: 'none', visor: 'none', skin: 'none', pet: 'none', [type]: id };
  if (type === 'pet') return PETS[id] ? `<svg viewBox="-4 -4 60 56">${PETS[id](COLORS[color])}</svg>` : '';
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
