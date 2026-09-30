// 무기 시스템 — 발사/반동/조준/재장전/볼트·펌프 동작/무기 흔들림/총구화염/탄피
import * as THREE from 'three';
import { GUN_BUILDERS } from './guns.js';
import './guns2.js';
import { Arms, VM_GRIP_OFF } from './vmarms.js';
import { preset, lerpPose, gunPose } from './hand.js';
import { Explosives } from './explosives.js';
import { Audio } from './audio.js';
import { T } from './textures.js';
import { clamp, lerp, damp, smooth, gauss, rand, Spring3, sampleKeys, sampleAnchor, DEG } from './core.js';

// ── 무기 정의 (실총 제원 기반) ──
const BASE = {
  AR: { reserve: 180, rpm: 750, modes: ['AUTO', 'SEMI'], pellets: 1, spreadHip: 2.4, spreadAds: 0.06, moveSpread: 2.2, bloom: 0.35, recoil: { v: 0.62, h: 0.24, bias: 0.06, kick: 0.028, rot: 0.05, ads: 0.62 }, adsFov: 0.78, adsTime: 0.2, eye: 0.17, hip: [0.105, -0.145, -0.3], casing: '556', tracer: 4, chamber: true, action: 'rifle', boltTravel: 0.07, chargeTravel: 0.075, headMul: 2.6, limbMul: 0.75, range: [70, 250, 0.72], weight: 1, slot: 0, cat: '돌격소총' },
  SMG: { reserve: 180, rpm: 800, modes: ['AUTO', 'SEMI'], pellets: 1, spreadHip: 1.9, spreadAds: 0.1, moveSpread: 1.3, bloom: 0.3, recoil: { v: 0.36, h: 0.16, bias: 0.03, kick: 0.02, rot: 0.035, ads: 0.65 }, adsFov: 0.82, adsTime: 0.16, eye: 0.2, hip: [0.1, -0.14, -0.3], casing: '9mm', tracer: 0, chamber: true, action: 'rifle', boltTravel: 0.05, chargeTravel: 0.06, headMul: 2.4, limbMul: 0.8, range: [25, 80, 0.6], weight: 0.8, slot: 0, cat: '기관단총' },
  HG: { reserve: 85, rpm: 900, modes: ['SEMI'], pellets: 1, spreadHip: 1.8, spreadAds: 0.12, moveSpread: 1.2, bloom: 0.6, recoil: { v: 1.25, h: 0.35, bias: 0, kick: 0.03, rot: 0.14, ads: 0.75 }, adsFov: 0.86, adsTime: 0.14, eye: 0.5, hip: [0.085, -0.115, -0.4], casing: '9mm', tracer: 0, chamber: true, action: 'pistol', slideTravel: 0.028, headMul: 2.4, limbMul: 0.8, range: [25, 60, 0.6], weight: 0.5, lockBack: true, slot: 1, cat: '권총' },
  SR: { reserve: 30, rpm: 60, modes: ['BOLT'], pellets: 1, spreadHip: 4.5, spreadAds: 0, moveSpread: 3.5, bloom: 0, recoil: { v: 3.2, h: 0.6, bias: 0, kick: 0.07, rot: 0.12, ads: 0.8 }, adsFov: 0.72, adsTime: 0.32, eye: 0.085, hip: [0.11, -0.16, -0.42], casing: '338', tracer: 1, chamber: true, action: 'bolt', boltTravel: 0.09, headMul: 3, limbMul: 0.8, range: [300, 800, 0.85], weight: 1.5, slot: 0, cat: '저격소총' },
  SG: { reserve: 42, rpm: 90, modes: ['PUMP'], pellets: 9, pelletSpread: 2.6, spreadHip: 1.2, spreadAds: 0.3, moveSpread: 1, bloom: 0, recoil: { v: 3.6, h: 0.8, bias: 0, kick: 0.07, rot: 0.14, ads: 0.8 }, adsFov: 0.86, adsTime: 0.22, eye: 0.3, hip: [0.105, -0.14, -0.3], casing: 'shell', tracer: 0, chamber: true, action: 'pump', pumpTravel: 0.085, headMul: 2, limbMul: 0.8, range: [12, 35, 0.35], weight: 1.2, slot: 0, cat: '산탄총' },
};
const D = (base, o) => ({ ...BASE[base], ...o, recoil: { ...BASE[base].recoil, ...(o.recoil || {}) } });
export const DEFS = [
  D('AR', { id: 'm4', name: 'M4A1', cal: '5.56×45mm NATO', mag: 30, rpm: 800, dmg: 34, vel: 900, sound: 'm4', lockBack: true, desc: '미군 표준 카빈. EOTech 홀로그래픽.' }),
  D('AR', { id: 'hk416', name: 'HK416', cal: '5.56×45mm NATO', mag: 30, rpm: 850, dmg: 34, vel: 880, sound: 'hk416', lockBack: true, eye: 0.2, recoil: { v: 0.56, h: 0.2 }, desc: '가스피스톤 AR. Aimpoint 레드닷.' }),
  D('AR', { id: 'm16', name: 'M16A4', cal: '5.56×45mm NATO', mag: 30, rpm: 800, modes: ['BURST', 'SEMI'], dmg: 36, vel: 950, sound: 'm16', lockBack: true, scope: 4, eye: 0.05, adsFov: 0.7, adsTime: 0.26, hip: [0.105, -0.15, -0.3], recoil: { v: 0.5, h: 0.18 }, range: [100, 300, 0.75], weight: 1.15, desc: '20인치 소총. ACOG 4배율, 3점사.' }),
  D('AR', { id: 'ak', name: 'AKM', cal: '7.62×39mm', mag: 30, reserve: 150, rpm: 600, dmg: 44, vel: 715, spreadHip: 2.8, spreadAds: 0.09, moveSpread: 2.6, bloom: 0.45, recoil: { v: 0.95, h: 0.38, bias: 0.12, kick: 0.036, rot: 0.07, ads: 0.66 }, adsFov: 0.8, adsTime: 0.24, eye: 0.4, hip: [0.105, -0.15, -0.26], sound: 'ak', casing: '762', action: 'ak', boltTravel: 0.085, range: [60, 200, 0.68], weight: 1.2, desc: '목재 개머리의 고전. 강한 반동.' }),
  D('AR', { id: 'ak74', name: 'AK-74M', cal: '5.45×39mm', mag: 30, rpm: 650, dmg: 36, vel: 900, recoil: { v: 0.68, h: 0.24, bias: 0.08 }, eye: 0.4, hip: [0.105, -0.15, -0.26], sound: 'ak74', casing: '556', action: 'ak', boltTravel: 0.085, desc: '5.45mm 폴리머 AK. 반동 제어 우수.' }),
  D('AR', { id: 'scar', name: 'SCAR-H', cal: '7.62×51mm NATO', mag: 20, reserve: 120, rpm: 600, dmg: 50, vel: 850, recoil: { v: 1.05, h: 0.34, bias: 0.08, kick: 0.036, rot: 0.07 }, sound: 'scar', casing: '762', lockBack: true, eye: 0.17, hip: [0.105, -0.15, -0.28], range: [90, 300, 0.75], weight: 1.25, desc: '7.62 NATO 전투소총. 강력한 저지력.' }),
  D('AR', { id: 'aug', name: 'AUG A3', cal: '5.56×45mm NATO', mag: 30, rpm: 700, dmg: 33, vel: 940, sound: 'aug', scope: 1.5, eye: 0.07, adsFov: 0.85, hip: [0.1, -0.13, -0.18], recoil: { v: 0.52, h: 0.2 }, lockBack: true, rpose: [[-0.06, 0.0, -0.02], [0.3, 0.6, -0.45]], desc: '오스트리아 불펍. 1.5배 광학.' }),
  D('AR', { id: 'g36c', name: 'G36C', cal: '5.56×45mm NATO', mag: 30, rpm: 750, dmg: 31, vel: 725, sound: 'g36', eye: 0.19, hip: [0.1, -0.14, -0.28], recoil: { v: 0.5, h: 0.22 }, lockBack: true, weight: 0.9, desc: '독일 단축형 카빈. 반투명 탄창.' }),
  D('SMG', { id: 'mp5', name: 'MP5A3', cal: '9×19mm', mag: 30, rpm: 800, dmg: 26, vel: 400, sound: 'mp5', eye: 0.19, hip: [0.1, -0.13, -0.3], desc: '롤러 지연식 명작 SMG.' }),
  D('SMG', { id: 'ump', name: 'UMP45', cal: '.45 ACP', mag: 25, reserve: 150, rpm: 600, dmg: 31, vel: 280, sound: 'ump', casing: '45', eye: 0.2, recoil: { v: 0.48, h: 0.2 }, desc: '.45 구경 폴리머 SMG.' }),
  D('SMG', { id: 'p90', name: 'P90', cal: '5.7×28mm', mag: 50, reserve: 200, rpm: 900, dmg: 25, vel: 715, sound: 'p90', casing: '9mm', eye: 0.24, hip: [0.1, -0.13, -0.22], recoil: { v: 0.3, h: 0.14 }, rpose: [[-0.05, -0.02, -0.02], [0.45, 0.3, 0.25]], desc: '상부 50발 탄창 불펍 PDW.' }),
  D('AR', { id: 'm249', name: 'M249 SAW', cal: '5.56×45mm NATO', mag: 100, reserve: 300, rpm: 850, modes: ['AUTO'], dmg: 33, vel: 915, sound: 'm249', action: 'lmg', eye: 0.3, hip: [0.12, -0.17, -0.3], spreadHip: 3.2, moveSpread: 3.2, recoil: { v: 0.42, h: 0.3, bias: 0.04, ads: 0.7 }, adsTime: 0.35, weight: 1.9, cat: '경기관총', desc: '분대지원화기. 100발 탄약상자.' }),
  D('SR', { id: 'awm', name: 'AWM', cal: '.338 Lapua Magnum', mag: 5, dmg: 160, vel: 900, sound: 'awm', scope: 6, desc: '볼트액션 저격소총. 6배율 스코프.' }),
  D('SR', { id: 'svd', name: 'SVD 드라구노프', cal: '7.62×54mmR', mag: 10, reserve: 50, rpm: 180, modes: ['SEMI'], dmg: 95, vel: 830, sound: 'svd', casing: '762', action: 'ak', boltTravel: 0.085, scope: 4, eye: 0.075, recoil: { v: 1.9, h: 0.4 }, tracer: 0, hip: [0.11, -0.16, -0.3], cat: '지정사수소총', desc: '반자동 지정사수소총. PSO-1 4배율.' }),
  D('SR', { id: 'barrett', name: 'M82A1 바렛', cal: '.50 BMG', mag: 10, reserve: 30, rpm: 100, modes: ['SEMI'], dmg: 260, vel: 853, sound: 'barrett', casing: '50', action: 'rifle', chargeTravel: 0.1, boltTravel: 0.06, scope: 10, eye: 0.09, recoil: { v: 5.5, h: 1.0, kick: 0.09, rot: 0.14 }, hip: [0.12, -0.18, -0.5], weight: 2.2, cat: '대물저격총', desc: '12.7mm 대물 반자동 저격총. 10배율.' }),
  D('SG', { id: 'm870', name: 'M870', cal: '12 Gauge 00 Buck', mag: 7, dmg: 19, vel: 400, sound: 'm870', desc: '펌프액션 산탄총.' }),
  D('SG', { id: 'saiga', name: 'Saiga-12', cal: '12 Gauge 00 Buck', mag: 8, reserve: 48, rpm: 300, modes: ['SEMI'], dmg: 17, vel: 400, sound: 'saiga', action: 'ak', boltTravel: 0.085, eye: 0.4, hip: [0.105, -0.15, -0.26], recoil: { v: 2.6, h: 0.7 }, desc: 'AK 기반 반자동 산탄총. 박스탄창.' }),
  D('HG', { id: 'glock', name: 'GLOCK 17', cal: '9×19mm Parabellum', mag: 17, rpm: 1100, dmg: 27, vel: 375, sound: 'glock', desc: '폴리머 프레임 권총. 삼중수소 조준.' }),
  D('HG', { id: 'm1911', name: 'M1911A1', cal: '.45 ACP', mag: 7, reserve: 56, rpm: 800, dmg: 38, vel: 255, sound: 'm1911', casing: '45', recoil: { v: 1.6, h: 0.35 }, desc: '100년 전통의 .45 권총.' }),
  D('HG', { id: 'deagle', name: 'Desert Eagle', cal: '.50 AE', mag: 7, reserve: 42, rpm: 300, dmg: 62, vel: 450, sound: 'deagle', casing: '50ae', recoil: { v: 3.6, h: 0.9, rot: 0.25 }, eye: 0.52, hip: [0.085, -0.12, -0.41], slideTravel: 0.03, headMul: 2.6, desc: '가스작동식 대구경 권총.' }),
  D('HG', { id: 'python', name: 'Colt Python', cal: '.357 Magnum', mag: 6, reserve: 42, rpm: 220, dmg: 56, vel: 440, sound: 'python', casing: '357', action: 'revolver', chamber: false, recoil: { v: 2.9, h: 0.7, rot: 0.22 }, eye: 0.55, hip: [0.085, -0.12, -0.41], lockBack: false, desc: '6인치 .357 매그넘 리볼버.' }),
];

// ── 애니메이션 클립 ──
const Z3 = [0, 0, 0];
function clips(def) {
  const C = {};
  C.draw = { d: 0.5, pos: [[0, 0.02, -0.22, 0.06], [0.5, 0, 0, 0]], rot: [[0, -0.9, 0.3, 0.4], [0.5, 0, 0, 0]], ev: [[0, 'cloth']] };
  C.holster = { d: 0.28, pos: [[0, 0, 0, 0], [0.28, 0.02, -0.22, 0.06]], rot: [[0, 0, 0, 0], [0.28, -0.9, 0.3, 0.4]] };
  C.inspect = { d: 3.4, pos: [[0, ...Z3], [0.5, -0.05, 0.03, 0.03], [2.8, -0.05, 0.03, 0.03], [3.4, ...Z3]],
    rot: [[0, ...Z3], [0.55, 0.15, 0.75, 0.55], [1.5, 0.12, 0.85, 0.6], [2.05, 0.05, -0.35, -0.7], [2.8, 0.08, -0.3, -0.75], [3.4, ...Z3]], ev: [[0.1, 'cloth'], [1.9, 'cloth']] };
  C.mode = { d: 0.35, rot: [[0, ...Z3], [0.12, 0.02, 0.05, -0.12], [0.35, ...Z3]], ev: [[0.12, 'select']] };
  const a = def.action;
  if (a === 'rifle' || a === 'ak') {
    const ak = a === 'ak';
    const TP = def.rpose ? def.rpose[0] : [-0.055, 0.05, 0.06], TR = def.rpose ? def.rpose[1] : [0.3, 0.32, -0.8];
    const tacRot = [[0, ...Z3], [0.3, ...TR], [0.62, TR[0] - 0.02, TR[1] + 0.02, TR[2] - 0.05], [1.3, ...TR], [1.4, TR[0] + 0.08, TR[1], TR[2] + 0.03], [1.55, ...TR], [2.05, ...Z3]];
    const tacPos = [[0, ...Z3], [0.3, ...TP], [1.65, ...TP], [2.05, ...Z3]];
    C.reload = { d: 2.25, pos: tacPos, rot: tacRot, lh: [[0, 'fore'], [0.32, 'mag'], [1.58, 'mag'], [2.0, 'fore']],
      mag: [[0.42, ...Z3], [0.6, 0, -0.07, 0], [0.85, -0.08, -0.5, 0.12], [1.02, -0.08, -0.5, 0.12], [1.25, 0, -0.07, 0], [1.38, ...Z3]],
      magR: ak ? [[0.42, 0], [0.55, 0.4], [0.7, 0.4], [1.2, 0.35], [1.25, 0.35], [1.38, 0]] : null,
      ev: [[0.05, 'cloth'], [0.45, 'magout'], [1.38, 'magin'], [1.38, 'load']] };
    const CR = ak ? [0.2, 0.25, -0.55] : [0.25, 0.1, 0.45], CP = ak ? [-0.04, 0.05, 0.06] : [-0.03, 0.035, 0.07];
    C.reloadEmpty = { d: 2.95,
      pos: [[0, ...Z3], [0.3, ...TP], [1.5, ...TP], [1.85, ...CP], [2.3, ...CP], [2.75, ...Z3]],
      rot: [[0, ...Z3], [0.3, ...TR], [1.25, ...TR], [1.35, TR[0] + 0.08, TR[1], TR[2] + 0.03], [1.5, ...TR], [1.85, ...CR], [2.3, ...CR], [2.4, CR[0] + 0.05, CR[1], CR[2]], [2.8, ...Z3]],
      magV: [[0, 1], [0.38, 1], [0.39, 0], [0.7, 0], [0.71, 1]],
      mag: [[0, ...Z3], [0.38, ...Z3], [0.39, -0.08, -0.5, 0.12], [0.95, -0.08, -0.5, 0.12], [1.2, 0, -0.07, 0], [1.32, ...Z3]],
      magR: ak ? [[0.9, 0.35], [1.2, 0.35], [1.32, 0]] : null,
      lh: [[0, 'fore'], [0.25, 'fore'], [0.62, 'mag'], [1.5, 'mag'], [1.85, 'charge'], [2.3, 'charge'], [2.75, 'fore']],
      charge: ak ? null : [[1.95, 0], [2.1, 1], [2.18, 1], [2.22, 0]],
      bolt: ak ? [[1.95, 0], [2.1, 1], [2.18, 1], [2.22, 0]] : [[0, def.lockBack ? 1 : 0], [2.1, 1], [2.18, 1], [2.22, 0]],
      ev: [[0.05, 'cloth'], [0.38, 'magout'], [0.38, 'dropmag'], [1.32, 'magin'], [1.32, 'load'], [2.08, 'boltback'], [2.22, 'boltfwd']] };
  } else if (a === 'lmg') {
    // 급탄덮개 열기 → 탄약상자 교체 → 벨트 걸기 → 덮개 닫기
    const P1 = [-0.06, 0.07, 0.08], R1 = [0.35, 0.3, 0.45];
    const base = { d: 4.6, pos: [[0, ...Z3], [0.4, ...P1], [4.1, ...P1], [4.55, ...Z3]], rot: [[0, ...Z3], [0.4, ...R1], [2.3, ...R1], [2.5, 0.35, 0.3, -0.5], [3.2, 0.35, 0.3, -0.5], [3.4, ...R1], [4.55, ...Z3]],
      cover: [[0.5, 0], [0.8, 1], [3.5, 1], [3.75, 0]],
      lh: [[0, 'fore'], [0.4, 'cover'], [0.85, 'cover'], [1.2, 'mag'], [2.9, 'mag'], [3.35, 'cover'], [3.8, 'cover'], [4.4, 'fore']],
      mag: [[1.3, ...Z3], [1.5, 0, -0.08, 0], [1.8, -0.1, -0.5, 0.1], [2.0, -0.1, -0.5, 0.1], [2.4, 0, -0.08, 0], [2.6, ...Z3]],
      ev: [[0.1, 'cloth'], [0.75, 'boltopen'], [1.45, 'magout'], [2.6, 'magin'], [2.9, 'cloth'], [3.72, 'boltclose'], [3.72, 'load']] };
    C.reload = base;
    C.reloadEmpty = { ...base, d: 5.2, pos: [...base.pos.slice(0, -1), [4.2, -0.02, 0.03, 0.07], [4.7, -0.02, 0.03, 0.07], [5.15, ...Z3]], rot: [...base.rot.slice(0, -1), [4.2, 0.2, -0.1, 0.3], [4.7, 0.2, -0.1, 0.3], [5.15, ...Z3]],
      lh: [...base.lh.slice(0, -1), [4.2, 'charge'], [4.65, 'charge'], [5.05, 'fore']], charge: [[4.3, 0], [4.45, 1], [4.52, 1], [4.58, 0]], ev: [...base.ev, [4.44, 'boltback'], [4.58, 'boltfwd']] };
  } else if (a === 'revolver') {
    const RP = [-0.02, 0.05, 0.1], RR = [0.4, 0.2, 0.75], UP = [0.95, 0.15, 0.5];
    C.reload = { d: 3.3, pos: [[0, ...Z3], [0.25, ...RP], [2.9, ...RP], [3.25, ...Z3]],
      rot: [[0, ...Z3], [0.3, ...RR], [0.7, ...RR], [0.85, ...UP], [1.1, ...UP], [1.3, ...RR], [2.5, ...RR], [2.65, RR[0] - 0.1, RR[1], RR[2] - 0.3], [3.25, ...Z3]],
      cylOut: [[0.3, 0], [0.5, 1], [2.45, 1], [2.6, 0]],
      lh: [[0, 'fore'], [0.25, 'cyl'], [1.2, 'cyl'], [1.45, 'mag'], [2.25, 'mag'], [2.4, 'cyl'], [2.7, 'cyl'], [3.1, 'fore']],
      magV: [[0, 0], [1.3, 0], [1.31, 1], [2.22, 1], [2.23, 0]],
      mag: [[1.3, -0.1, -0.4, 0.2], [1.95, 0, 0.0, -0.08], [2.1, 0, 0, 0]],
      ev: [[0.45, 'boltopen'], [0.95, 'ejectAll'], [2.1, 'magin'], [2.1, 'load'], [2.6, 'boltclose']] };
    C.reloadEmpty = C.reload;
  } else if (a === 'pistol') {
    const mag = [[0.3, ...Z3], [0.42, 0, -0.1, 0], [0.7, -0.06, -0.45, 0.1], [0.85, -0.06, -0.45, 0.1], [1.05, 0, -0.1, 0], [1.18, ...Z3]];
    const PP = [-0.04, 0.045, 0.08], PR = [0.45, 0.3, -0.55];
    C.reload = { d: 1.65, pos: [[0, ...Z3], [0.25, ...PP], [1.3, ...PP], [1.6, ...Z3]],
      rot: [[0, ...Z3], [0.25, ...PR], [1.18, ...PR], [1.25, PR[0] + 0.07, PR[1], PR[2]], [1.6, ...Z3]],
      lh: [[0, 'fore'], [0.3, 'mag'], [1.2, 'mag'], [1.5, 'fore']], mag, ev: [[0.32, 'magout'], [1.18, 'magin'], [1.18, 'load']] };
    C.reloadEmpty = { d: 2.05, pos: [[0, ...Z3], [0.25, ...PP], [1.3, ...PP], [1.5, -0.02, 0.03, 0.05], [2.0, ...Z3]],
      rot: [[0, ...Z3], [0.25, ...PR], [1.18, ...PR], [1.25, PR[0] + 0.07, PR[1], PR[2]], [1.45, 0.25, 0.1, 0.35], [1.62, 0.3, 0.1, 0.35], [2.0, ...Z3]],
      magV: [[0, 1], [0.3, 1], [0.31, 0], [0.6, 0], [0.61, 1]],
      mag: [[0, ...Z3], [0.3, ...Z3], [0.31, -0.06, -0.45, 0.1], [0.85, -0.06, -0.45, 0.1], [1.05, 0, -0.1, 0], [1.18, ...Z3]],
      lh: [[0, 'fore'], [0.3, 'fore'], [0.55, 'mag'], [1.2, 'mag'], [1.42, 'slide'], [1.6, 'slide'], [1.95, 'fore']],
      slide: [[0, 1], [1.5, 1], [1.56, 1.08], [1.6, 0]],
      ev: [[0.3, 'magout'], [0.3, 'dropmag'], [1.18, 'magin'], [1.18, 'load'], [1.6, 'slide']] };
  } else if (a === 'bolt') {
    const cyc = (t0) => ({
      rh: [[t0, 'grip'], [t0 + 0.16, 'bolt'], [t0 + 0.78, 'bolt'], [t0 + 0.95, 'grip']],
      boltRot: [[t0 + 0.2, 0], [t0 + 0.3, 1], [t0 + 0.62, 1], [t0 + 0.7, 0]],
      bolt: [[t0 + 0.3, 0], [t0 + 0.44, 1], [t0 + 0.5, 1], [t0 + 0.62, 0]],
    });
    C.cycle = { d: 1.0, ...cyc(0), rot: [[0, ...Z3], [0.25, 0.06, 0.05, 0.22], [0.7, 0.06, 0.05, 0.22], [0.95, ...Z3]], pos: [[0, ...Z3], [0.25, -0.01, 0.01, 0.02], [0.95, ...Z3]],
      ev: [[0.28, 'boltopen'], [0.44, 'eject'], [0.68, 'boltclose'], [0.7, 'chamber']] };
    const SP = [-0.05, 0.04, 0.06], SR = [0.25, 0.3, -0.7];
    const swap = { pos: [[0, ...Z3], [0.3, ...SP], [1.8, ...SP], [2.2, ...Z3]],
      rot: [[0, ...Z3], [0.3, ...SR], [1.4, ...SR], [1.5, SR[0] + 0.06, SR[1], SR[2]], [1.65, ...SR], [2.2, ...Z3]],
      lh: [[0, 'fore'], [0.32, 'mag'], [1.6, 'mag'], [2.1, 'fore']],
      mag: [[0.45, ...Z3], [0.6, 0, -0.06, 0], [0.9, -0.08, -0.5, 0.1], [1.05, -0.08, -0.5, 0.1], [1.35, 0, -0.06, 0], [1.48, ...Z3]] };
    C.reload = { d: 2.35, ...swap, ev: [[0.05, 'cloth'], [0.48, 'magout'], [1.48, 'magin'], [1.48, 'load']] };
    const c2 = cyc(2.15);
    C.reloadEmpty = { d: 3.2, ...swap, ...c2, rot: [...swap.rot.slice(0, -1), [2.2, 0.03, 0, 0.1], [2.9, 0.03, 0, 0.1], [3.15, ...Z3]],
      ev: [[0.05, 'cloth'], [0.48, 'magout'], [1.48, 'magin'], [1.48, 'load'], [2.43, 'boltopen'], [2.83, 'boltclose'], [2.85, 'chamber']] };
  } else if (a === 'pump') {
    C.cycle = { d: 0.62, pump: [[0.05, 0], [0.2, 1], [0.3, 1], [0.45, 0]], rot: [[0, ...Z3], [0.18, 0.04, 0, -0.05], [0.5, ...Z3]], pos: [[0.05, ...Z3], [0.2, 0, -0.005, 0.02], [0.5, ...Z3]],
      ev: [[0.16, 'pumpback'], [0.2, 'eject'], [0.42, 'pumpfwd'], [0.43, 'chamber']] };
    const R = [0.32, 0.3, -0.75];
    C.rStart = { d: 0.45, rot: [[0, ...Z3], [0.4, ...R]], pos: [[0, ...Z3], [0.4, -0.05, 0.04, 0.06]], lh: [[0, 'fore'], [0.4, 'port']] };
    C.rShell = { d: 0.55, rot: [[0, ...R], [0.36, ...R], [0.42, R[0] + 0.05, R[1], R[2]], [0.55, ...R]], pos: [[0, -0.05, 0.04, 0.06]], lh: [[0, 'port'], [0.14, 'free'], [0.2, 'free'], [0.36, 'port']], shell: [[0, 0], [0.12, 0], [0.13, 1], [0.39, 1], [0.4, 0]], ev: [[0.4, 'shellin'], [0.4, 'load1']] };
    C.rEnd = { d: 0.4, rot: [[0, ...R], [0.4, ...Z3]], pos: [[0, -0.05, 0.04, 0.06], [0.4, ...Z3]], lh: [[0, 'port'], [0.38, 'fore']] };
  }
  return C;
}

// ── 무기 인스턴스 ──
class Weapon {
  constructor(def, root) {
    this.def = def;
    this.m = GUN_BUILDERS[def.id]();
    this.m.group.visible = false;
    root.add(this.m.group);
    this.clips = clips(def);
    this.ammo = def.mag + (def.chamber && def.action !== 'bolt' && def.action !== 'pump' ? 1 : 0);
    this.reserve = def.reserve;
    this.mode = 0;
    this.locked = false;       // 슬라이드/노리쇠 후퇴 고정
    this.needsCycle = false;   // 볼트/펌프 수동 장전 필요
    this.cycleT = 1;           // 자동 노리쇠 왕복
    this.shotIdx = 0;
    this.nextFire = 0;
    this.burst = 0;
    this.cylA = 0;
    this.m.group.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  }
}

const _X = new THREE.Vector3(1, 0, 0), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();

export class WeaponSystem {
  constructor(game) {
    this.g = game;
    this.root = game.vmRoot;
    this.arms = new Arms(this.root);
    this.list = DEFS.map((d) => new Weapon(d, this.root));
    this.byId = Object.fromEntries(this.list.map((w, i) => [w.def.id, i]));
    this.loadout = [this.byId.m4, this.byId.glock];
    this.slot = 0;
    this.idx = 0; this.cur = this.list[0];
    this.ads = 0; this.sprintT = 0; this.blockT = 0;
    this.anim = null; this.pending = null;
    this.swayRot = new Spring3(120, 16); this.swayPos = new Spring3(140, 18);
    this.recPos = new Spring3(260, 22); this.recRot = new Spring3(220, 18);
    this.land = new Spring3(90, 11);
    this.bloom = 0;
    this.flashT = 0; this.time = 0;
    this.fireLatch = false;
    this.freeAnchor = new THREE.Object3D(); this.freeAnchor.position.set(-0.16, -0.45, -0.15); this.freeAnchor.rotation.set(0.4, 0, 0.3); this.root.add(this.freeAnchor);
    this.buildFlash();
    // 산탄총 장전 중 손에 든 쉘
    const shell = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.058, 12), new THREE.MeshStandardMaterial({ color: 0x8e1712, roughness: 0.5 }));
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.0108, 0.0108, 0.014, 12), new THREE.MeshStandardMaterial({ color: 0xd4a84f, roughness: 0.3, metalness: 1 }));
    base.position.y = -0.03; shell.add(hull, base);     shell.position.copy(VM_GRIP_OFF.L); shell.rotation.set(Math.PI / 2, 0, 0);
    shell.visible = false; this.arms.side.L.hand.add(shell); this.handShell = shell;
    this.item = null;
    this.ex = new Explosives(game, this);
    this.equip(this.loadout[0], true);
  }

  buildFlash() {
    const mk = (tex, w, h) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(4, 2.6, 1.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true }));
    const f = this.flash = new THREE.Group();
    const front = mk(T.flash.map, 0.16, 0.16);
    const s1 = mk(T.flashSide.map, 0.07, 0.22); s1.geometry.translate(0, 0.11, 0); s1.rotation.set(-Math.PI / 2, 0, 0);
    const s2 = mk(T.flashSide.map, 0.07, 0.22); s2.geometry = s1.geometry; s2.rotation.set(-Math.PI / 2, Math.PI / 2, 0);
    f.add(front, s1, s2); f.visible = false;
    this.flashParts = [front, s1, s2];
    this.flashLight = new THREE.PointLight(0xffb060, 0, 2.5, 2);
    this.root.add(this.flashLight);
  }

  get def() { return this.cur.def; }
  busy() { return !!this.anim; }

  equip(i, instant = false) {
    const w = this.list[i];
    this.reloadAt = this.pumpAt = 0; this.shotgunLoading = false; this.stopShells = false;
    if (!w) return;
    if (!instant && (i === this.idx && !this.pending)) return;
    const doDraw = () => {
      this.cur.m.group.visible = false;
      this.idx = i; this.cur = w; w.m.group.visible = true;
      w.m.muzzle.add(this.flash);
      this.play('draw');
      this.g.hud?.weapon(w);
    };
    if (instant) { this.pending = null; doDraw(); this.anim = null; return; }
    this.cancelAnim();
    this.pending = i;
    this.play('holster', () => { this.pending = null; doDraw(); });
  }

  selectSlot(i) {
    if (this.item) { this.ex.stow(() => this.fromItem(i)); return; }
    this.slot = i; this.equip(this.loadout[i]);
  }
  // 투척물/폭약 (3 파편, 4 연막, 5 C4)
  selectItem(k) {
    if (this.pending != null) return;
    if (this.item) { if (this.item !== k || this.ex.state === 'det') this.ex.stow(() => { this.item = k; this.ex.begin(k); }); return; }
    if (!this.ex.has(k)) { this.g.hud?.message(`${this.ex.label(k)} 없음`, 1.2); return; }
    this.cancelAnim(); this.ads = Math.min(this.ads, 0.3);
    this.pending = -1;
    this.play('holster', () => { this.pending = null; this.cur.m.group.visible = false; this.item = k; this.ex.begin(k); });
  }
  fromItem(i) {
    this.item = null; this.ex.hide();
    const w = this.list[this.loadout[i]];
    this.slot = i; this.idx = this.loadout[i]; this.cur = w; w.m.group.visible = true; w.m.muzzle.add(this.flash);
    this.play('draw'); this.g.hud?.weapon(w);
  }
  setLoadout(slot, id) {
    const i = this.byId[id]; if (i == null) return;
    this.loadout[slot] = i;
    const w = this.list[i]; w.ammo = w.def.mag + (w.def.chamber && w.def.action !== 'bolt' && w.def.action !== 'pump' ? 1 : 0); w.reserve = w.def.reserve; w.locked = false; w.needsCycle = false;
    if (this.item) this.ex.hud(); else if (this.slot === slot) this.equip(i, false); else this.g.hud?.weapon(this.cur);
  }

  cancelAnim() { this.anim = null; this.handShell.visible = false; }

  play(name, onEnd) {
    const clip = this.cur.clips[name];
    if (!clip) { onEnd?.(); return; }
    this.anim = { name, clip, t: 0, fired: new Set(), onEnd };
  }

  // 애니메이션 이벤트
  event(e) {
    const w = this.cur, d = w.def, g = this.g;
    switch (e) {
      case 'load': {
        const want = d.mag + (d.chamber && !w.wasEmpty && d.action !== 'bolt' ? 1 : 0) - w.ammo;
        const take = Math.min(want, w.reserve);
        w.ammo += take; w.reserve -= take; w.locked = false;
        break;
      }
      case 'load1': if (w.reserve > 0) { w.ammo++; w.reserve--; } break;
      case 'chamber': w.needsCycle = false; w.locked = false; break;
      case 'dropmag': g.fx.dropMag(w, this); Audio.play('magout', { vol: 0.2, rate: 0.7 }); break;
      case 'eject': g.fx.eject(w, this); break;
      case 'ejectAll': { const n = d.mag - w.ammo; for (let i = 0; i < n; i++) g.fx.eject(w, this, w.m.parts.cyl, true); w.ammo = 0; break; }
      case 'slide': w.locked = false; Audio.play('slide', { vol: 0.8 }); break;
      case 'boltfwd': w.locked = false; Audio.play('boltfwd', { vol: 0.8 }); break;
      case 'select': Audio.play('select', { vol: 0.7 }); break;
      case 'cloth': Audio.play('cloth', { vol: 0.35 }); break;
      default: Audio.play(e, { vol: 0.8 });
    }
    g.hud?.ammo(w);
  }

  reload() {
    const w = this.cur, d = w.def;
    if (this.anim || w.reserve <= 0) return;
    const full = w.ammo >= d.mag + (d.chamber && d.action !== 'bolt' && d.action !== 'pump' ? 1 : 0);
    if (full || (d.action === 'pump' && w.ammo >= d.mag)) return;
    w.wasEmpty = w.ammo === 0;
    if (d.action === 'pump') { this.shotgunReload(); return; }
    this.play(w.wasEmpty ? 'reloadEmpty' : 'reload');
    this.g.player.stopSprint?.();
  }

  shotgunReload() {
    const w = this.cur;
    this.play('rStart', () => this.shellLoop());
    this.shotgunLoading = true;
    w.needsCycle = w.ammo === 0;
  }
  shellLoop() {
    const w = this.cur;
    if (w.ammo >= w.def.mag || w.reserve <= 0 || this.stopShells) { this.stopShells = false; this.play('rEnd', () => { this.shotgunLoading = false; if (w.needsCycle) this.play('cycle'); }); return; }
    this.play('rShell', () => this.shellLoop());
  }

  cycleMode() {
    const w = this.cur;
    if (w.def.modes.length < 2 || this.anim) return;
    w.mode = (w.mode + 1) % w.def.modes.length;
    this.play('mode');
    this.g.hud?.ammo(w);
  }

  inspect() { if (!this.anim && this.ads < 0.1) this.play('inspect'); }

  // ── 발사 ──
  tryFire(held, pressed) {
    const w = this.cur, d = w.def, p = this.g.player;
    if (d.modes[w.mode] === 'BURST') {
      if (!held) this.fireLatch = false;
      if (pressed && w.burst <= 0 && !this.fireLatch && !this.anim && this.sprintT < 0.35 && w.ammo > 0) { w.burst = 3; this.fireLatch = true; }
      if (w.burst > 0 && this.time >= w.nextFire) {
        if (w.ammo <= 0 || this.anim) { w.burst = 0; return; }
        w.nextFire = this.time + 60 / d.rpm; w.burst--; this.fire();
      }
      if (pressed && w.ammo <= 0 && !this.anim) { Audio.play('dry', { vol: 0.8 }); if (w.reserve > 0) this.reloadAt = this.time + 0.25; }
      return;
    }
    if (!held) this.fireLatch = false;
    if (this.shotgunLoading && pressed && w.ammo > 0) { this.stopShells = true; return; }
    if (!held) return;
    if (this.anim) { if (this.anim.name === 'inspect') this.cancelAnim(); else return; }
    if (this.sprintT > 0.35 || this.pending != null) return;
    const mode = d.modes[w.mode];
    if (mode !== 'AUTO' && this.fireLatch) return;
    if (w.needsCycle) { if (pressed && !this.anim) this.play('cycle'); return; }
    if (this.time < w.nextFire) return;
    if (w.ammo <= 0) {
      if (!this.fireLatch) { Audio.play('dry', { vol: 0.8 }); this.fireLatch = true; if (w.reserve > 0) this.reloadAt = this.time + 0.25; }
      return;
    }
    this.fireLatch = true;
    const interval = 60 / d.rpm;
    w.nextFire = w.nextFire + interval > this.time ? w.nextFire + interval : this.time + interval;
    this.fire();
  }

  fire() {
    const w = this.cur, d = w.def, g = this.g, p = g.player;
    w.ammo--;
    w.shotIdx++;
    g.stats.shots++;
    // 사운드 (실내면 더 울림)
    Audio.play(d.sound, { vol: 1.0, jitter: 0.03 });
    if (w.ammo <= 3 && d.mag > 8 && w.ammo > 0) Audio.play('select', { vol: 0.12, rate: 1.4 });
    // 탄도
    const spread = this.currentSpread();
    const cam = g.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    // 총기 흔들림/반동 방향을 반영 (비조준 사격 시 약간)
    const muzzleW = this.worldPointOf(w.m.muzzle);
    const tracerOn = d.tracer && (w.shotIdx % d.tracer === 1 || d.tracer === 1);
    for (let k = 0; k < d.pellets; k++) {
      const s = (spread + (d.pellets > 1 ? d.pelletSpread : 0)) * DEG;
      const r = Math.sqrt(Math.random()) * Math.tan(s / 2), a = Math.random() * Math.PI * 2;
      const dir = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      g.ballistics.fire({ origin, dir, speed: d.vel * rand(0.98, 1.02), dmg: d.dmg, owner: 'player', def: d, tracer: tracerOn && k === 0, from: muzzleW });
    }
    // 반동
    const R = d.recoil, adsK = lerp(1, R.ads, this.ads) * (p.crouching ? 0.82 : 1) * (p.grounded ? 1 : 1.4);
    const n = w.shotIdx;
    const climb = R.v * (1 + Math.min(n, 10) * 0.035) * adsK;
    const drift = (R.bias * (n < 6 ? 0.5 : Math.sin(n * 0.45) * 1.6) + gauss() * R.h) * adsK;
    p.applyRecoil(climb, drift);
    this.recPos.impulse(gauss() * 0.02, 0.05 * R.kick * 20, R.kick * 55 * (1 - this.ads * 0.35));
    this.recRot.impulse(R.rot * 45 * (1 - this.ads * 0.4), gauss() * R.rot * 12, gauss() * R.rot * 22);
    this.bloom = Math.min(this.bloom + d.bloom, 4);
    // 총구 화염 + 조명
    this.flashT = 0.045;
    this.flash.visible = true;
    const sc = rand(0.8, 1.25) * (d.id === 'awm' || d.id === 'm870' ? 1.6 : d.id === 'glock' ? 0.7 : 1);
    this.flash.scale.setScalar(sc);
    this.flashParts[0].rotation.z = Math.random() * 6;
    this.flash.rotation.z = Math.random() * 6;
    this.flashLight.intensity = 6;
    g.fx.muzzle(muzzleW, fwd, d);
    // 노리쇠/슬라이드 왕복 + 탄피
    if (d.action === 'rifle' || d.action === 'ak' || d.action === 'pistol' || d.action === 'lmg') {
      w.cycleT = 0;
      g.fx.eject(w, this);
      if (w.ammo === 0 && d.lockBack) w.locked = true;
    } else if (d.action === 'revolver') {
      w.cycleT = 0; w.cylA += Math.PI / 3;
    } else {
      w.needsCycle = true;
      if (d.action === 'pump') this.pumpAt = this.time + 0.18;
    }
    // 주변 적 경계
    g.alert(origin, d.id === 'glock' ? 45 : 80);
    g.hud?.ammo(w);
  }

  currentSpread() {
    const d = this.def, p = this.g.player;
    const speed = Math.min(1, p.hSpeed() / 5);
    let s = lerp(d.spreadHip, d.spreadAds, smooth(this.ads)) + d.moveSpread * speed * (1 - this.ads * 0.6) + this.bloom * (1 - this.ads * 0.7);
    if (!p.grounded) s += 4;
    if (p.crouching) s *= 0.8;
    return s;
  }

  // 뷰모델 점 → 월드 좌표 (FOV 차이 보정)
  worldPointOf(obj) {
    const g = this.g;
    obj.getWorldPosition(_v2);
    const vmCam = g.vmCam;
    const depth = -_v2.clone().applyMatrix4(vmCam.matrixWorldInverse).z;
    const ndc = _v2.clone().project(vmCam);
    const dir = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(g.camera).sub(g.camera.position).normalize();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(g.camera.quaternion);
    return g.camera.position.clone().addScaledVector(dir, depth / Math.max(0.2, dir.dot(fwd)));
  }

  // ── 매 프레임 ──
  update(dt, input) {
    const g = this.g, p = g.player, w = this.cur, d = w.def;
    this.time += dt;
    // 입력
    if (input.pressed('Digit1')) this.selectSlot(0); if (input.pressed('Digit2')) this.selectSlot(1);
    if (input.pressed('Digit3') || input.pressed('KeyG')) this.selectItem('frag');
    if (input.pressed('Digit4')) this.selectItem('smoke');
    if (input.pressed('Digit5')) this.selectItem('c4');
    if (input.wheel && !this.item) this.selectSlot(this.slot ? 0 : 1);
    if (this.item) {
      this.ads = Math.max(0, this.ads - dt * 6); this.bloom = 0;
      this.sprintT = damp(this.sprintT, p.sprinting ? 1 : 0, 8, dt); this.blockT = damp(this.blockT, 0, 10, dt);
      this.ex.update(dt, input); return;
    }
    if (input.pressed('KeyR')) this.reload();
    if (input.pressed('KeyB')) this.cycleMode();
    if (input.pressed('KeyF') && !g.nearAmmo) this.inspect();
    const wantAds = input.mouse[2] && !p.sprinting && this.pending == null && !(this.anim && /reload|rStart|rShell|rEnd|inspect|holster/.test(this.anim.name));
    this.ads = clamp(this.ads + (wantAds ? 1 : -1) * dt / d.adsTime, 0, 1);
    this.tryFire(input.mouse[0] && !g.paused, input.mousePressed(0));
    if (input.mouse[0] && p.sprinting) p.stopSprint();
    if (!input.mouse[0]) w.shotIdx = 0;
    // 지연 동작 (자동 재장전 / 펌프)
    if (this.reloadAt && this.time >= this.reloadAt) { this.reloadAt = 0; this.reload(); }
    if (this.pumpAt && this.time >= this.pumpAt) { this.pumpAt = 0; if (d.action === 'pump' && w.needsCycle && !this.anim) this.play('cycle'); }
    // 볼트액션: 방아쇠 놓으면 자동 장전
    if (d.action === 'bolt' && w.needsCycle && !input.mouse[0] && !this.anim && w.ammo > 0 && this.time > w.nextFire - 60 / d.rpm + 0.25) this.play('cycle');
    if (d.action === 'bolt' && w.needsCycle && w.ammo === 0 && !this.anim && w.reserve > 0) { w.needsCycle = false; this.reload(); }

    // 애니메이션 진행
    let A = null;
    if (this.anim) {
      const an = this.anim;
      an.t += dt;
      for (const [t, e] of an.clip.ev || []) if (an.t >= t && !an.fired.has(t + e)) { an.fired.add(t + e); this.event(e); }
      if (an.t >= an.clip.d) { this.anim = null; this.handShell.visible = false; an.onEnd?.(); }
      A = an;
    }
    this.bloom = Math.max(0, this.bloom - dt * (input.mouse[0] ? 1.5 : 5));
    this.sprintT = damp(this.sprintT, p.sprinting && !this.anim?.name?.startsWith('r') ? 1 : 0, 8, dt);
    // 벽 근접 시 총 들어올림
    const block = g.wallDist != null ? clamp(1 - (g.wallDist - 0.25) / 0.55, 0, 1) : 0;
    this.blockT = damp(this.blockT, block * (1 - this.ads * 0.5), 10, dt);

    this.pose(dt, A, input);
  }

  pose(dt, A, input) {
    const g = this.g, p = g.player, w = this.cur, d = w.def, m = w.m;
    const e = smooth(this.ads);
    const hip = d.hip, s = m.sight;
    const adsP = [-s.x, -s.y, -d.eye - s.z];
    const pos = _v.set(lerp(hip[0], adsP[0], e), lerp(hip[1], adsP[1], e), lerp(hip[2], adsP[2], e));
    const rot = new THREE.Vector3(0, 0, 0);
    this.motion(pos, rot, e, dt, input);
    // 애니메이션 트랙
    const tmp = [0, 0, 0];
    if (A) {
      const t = A.t, c = A.clip;
      if (sampleKeys(c.pos, t, tmp)) { pos.x += tmp[0]; pos.y += tmp[1]; pos.z += tmp[2]; }
      if (sampleKeys(c.rot, t, tmp)) { rot.x += tmp[0]; rot.y += tmp[1]; rot.z += tmp[2]; }
    }
    m.group.position.copy(pos);
    m.group.rotation.set(rot.x, rot.y, rot.z, 'YXZ');
    this.poseParts(dt, A, w, d, m, tmp);
  }

  // 공통 뷰모델 움직임: 스프린트/벽/걷기/호흡/스웨이/착지/반동/앉기
  motion(pos, rot, e, dt, input) {
    const g = this.g, p = g.player;
    const sp = smooth(this.sprintT) * (1 - e);
    pos.x += -0.03 * sp; pos.y += -0.05 * sp; pos.z += 0.03 * sp;
    rot.x += -0.35 * sp; rot.y += 0.75 * sp; rot.z += 0.45 * sp;
    // 벽 차단
    const b = smooth(this.blockT);
    pos.z += 0.12 * b; pos.y -= 0.03 * b; rot.x += 0.75 * b; rot.y += 0.2 * b;
    // 걷기 흔들림 (8자)
    const bob = p.bobAmt * (1 - e * 0.85) * (p.sprinting ? 1.8 : 1);
    const ph = p.bobPhase;
    pos.x += Math.sin(ph) * 0.007 * bob; pos.y += -Math.abs(Math.cos(ph)) * 0.009 * bob;
    rot.z += Math.sin(ph) * 0.02 * bob; rot.y += Math.sin(ph) * 0.01 * bob;
    // 호흡
    const breath = (1 - e * 0.8) * (p.holdBreath ? 0.1 : 1);
    pos.y += Math.sin(this.time * 1.7) * 0.0016 * breath; rot.x += Math.sin(this.time * 1.7 + 0.5) * 0.004 * breath; rot.y += Math.sin(this.time * 0.9) * 0.003 * breath;
    // 마우스 스웨이
    const sk = 1 - e * 0.7;
    this.swayRot.impulse(-input.dy * 0.0025 * sk, -input.dx * 0.0025 * sk, -input.dx * 0.0012 * sk);
    this.swayPos.impulse(-input.dx * 0.00012 * sk, input.dy * 0.00012 * sk, 0);
    const sr = this.swayRot.update(dt), spp = this.swayPos.update(dt);
    rot.x += sr.x; rot.y += sr.y; rot.z += sr.z; pos.x += spp.x; pos.y += spp.y;
    // 착지/점프
    const l = this.land.update(dt);
    pos.y += l.y * 0.02; rot.x += l.y * 0.05;
    // 반동
    const rp = this.recPos.update(dt), rr = this.recRot.update(dt);
    pos.x += rp.x * 0.01; pos.y += rp.y * 0.01; pos.z += rp.z * 0.01;
    rot.x += rr.x * 0.01; rot.y += rr.y * 0.01; rot.z += rr.z * 0.01;
    // 앉기 기울임
    rot.z += (p.crouchT || 0) * 0.06 * (1 - e);
  }

  poseParts(dt, A, w, d, m, tmp) {
    const g = this.g;
    // 부품
    const P = m.parts;
    const trk = (k) => (A && A.clip[k] ? sampleKeys(A.clip[k], A.t, tmp)[0] : null);
    w.cycleT = Math.min(1, w.cycleT + dt / Math.max(0.05, 60 / d.rpm * 0.9));
    const cyc = w.cycleT < 1 ? Math.sin(Math.PI * w.cycleT) : 0;
    if (P.mag) {
      const baseRot = m.magRot ?? (d.id === 'glock' ? -0.36 : 0);
      P.mag.position.copy(m.magBase);
      if (A && A.clip.mag) {
        sampleKeys(A.clip.mag, A.t, tmp);
        if (m.magDir) P.mag.position.add(_v2.set(tmp[0], 0, tmp[2])).addScaledVector(m.magDir, -tmp[1]);
        else P.mag.position.add(_v2.set(tmp[0], tmp[1], tmp[2]).applyAxisAngle(_X, baseRot));
      }
      P.mag.rotation.x = baseRot + (trk('magR') ?? 0);
      const mv = trk('magV');
      P.mag.visible = mv == null ? d.action !== 'revolver' : mv > 0.5;
    }
    if (P.cover) P.cover.rotation.x = -(trk('cover') ?? 0) * 1.05;
    if (P.cyl) { const o = trk('cylOut') ?? 0; P.cyl.position.x = -0.032 * o; P.cyl.position.y = -0.002 - 0.012 * o; P.cyl.rotation.set(0, o * 0.15, 0); P.cyl.rotateZ(-w.cylA); }
    if (P.hammer) P.hammer.rotation.x = w.cycleT < 1 ? Math.sin(Math.PI * w.cycleT) * 0.9 : (d.action === 'revolver' && g.input.mouse[0] && !this.anim ? 0.4 : 0);
    if (P.bolt) {
      const bt = trk('bolt');
      const bv = bt ?? (w.locked ? 1 : cyc);
      P.bolt.position.z = bv * (d.boltTravel || 0.07);
      if (d.id === 'awm') P.bolt.rotation.z = (trk('boltRot') ?? 0) * 1.05;
    }
    if (P.charge) P.charge.position.z = (trk('charge') ?? 0) * d.chargeTravel;
    if (P.slide) P.slide.position.z = (trk('slide') ?? (w.locked ? 1 : cyc)) * d.slideTravel;
    if (P.pump) P.pump.position.z = (trk('pump') ?? 0) * d.pumpTravel;
    if (P.trigger) P.trigger.rotation.x = g.input.mouse[0] && !this.anim ? -0.25 : 0;
    if (P.selector) P.selector.rotation.x = w.mode === 0 ? -1.2 : -0.6;
    if (A && A.clip.shell) this.handShell.visible = trk('shell') > 0.5;
    // 총구 화염
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 160);
    if (this.flashLight.intensity > 0) m.muzzle.getWorldPosition(this.flashLight.position), this.root.worldToLocal(this.flashLight.position);

    // 조준경/홀로 셰이더
    if (m.holo) {
      m.group.updateMatrixWorld(true);
      m.holo.material.uniforms.uAxis.value.set(0, 0, -1).applyQuaternion(m.group.quaternion);
      m.holo.material.uniforms.uUp.value.set(0, 1, 0).applyQuaternion(m.group.quaternion);
    }
    // 팔 IK (검지: 사격 중이거나 정조준 시 방아쇠로)
    const wantTrig = (g.input.mouse[0] && !this.anim) || (this.ads > 0.6 && !this.anim) ? 1 : 0;
    this.trigW = damp(this.trigW ?? 0, wantTrig, wantTrig ? 22 : 6, dt);
    const anchorName = (k, def) => (A && A.clip[k] ? sampleAnchor(A.clip[k], A.t) : { a: def, b: def, u: 0 });
    this.ikArms(anchorName('lh', 'fore'), anchorName('rh', 'grip'));
  }

  ikArms(L, Rr) {
    this.root.updateMatrixWorld(true);
    _m.copy(this.root.matrixWorld).invert();
    const tr = this.blendAnchors(Rr, 'R'), tl = this.blendAnchors(L, 'L');
    this.arms.updateSide('R', tr, tr.pose);
    this.arms.updateSide('L', tl, tl.pose);
  }

  // 로딩 후 백그라운드에서 모든 총의 손 자세를 미리 계산 (첫 교체 시 끊김 방지)
  warmPoses() {
    const jobs = [];
    for (const w of this.list) for (const [n, side] of [['grip', 'R'], ['fore', 'L'], ['mag', 'L'], ['slide', 'L'], ['cyl', 'L']]) if (w.m.anchors[n]) jobs.push([w, n, side]);
    const step = () => {
      const t0 = performance.now();
      while (jobs.length && performance.now() - t0 < 12) {
        const [w, n, side] = jobs.shift(), c = w.poses || (w.poses = {});
        if (!c[n + side]) c[n + side] = gunPose(w.m, w.m.anchors[n], n, side, w.def.slot === 1);
      }
      if (jobs.length) setTimeout(step, 30);
    };
    setTimeout(step, 200);
  }

  // ── 손 자세: 실제 총 메쉬 단면에 맞춰 손가락을 감싸 쥔 자세 (총·앵커별 1회 계산 후 캐시) ──
  poseFor(A, name, side) {
    if (A.userData.pose) return A.userData.pose;
    if (A === this.freeAnchor) return this._relaxed || (this._relaxed = preset('relaxed'));
    const w = this.cur, c = w.poses || (w.poses = {}), key = name + side;
    return c[key] || (c[key] = gunPose(w.m, A, name, side, w.def.slot === 1));
  }

  getAnchor(name) { if (this.item) return this.ex.anchors[name] || this.freeAnchor; return name === 'free' ? this.freeAnchor : this.cur.m.anchors[name] || this.cur.m.anchors.fore; }
  blendAnchors({ a, b, u }, side) {
    const A = this.getAnchor(a), B = this.getAnchor(b);
    const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), sa = new THREE.Vector3();
    _m2.multiplyMatrices(_m, A.matrixWorld).decompose(pa, qa, sa);
    let pose = this.poseFor(A, a, side);
    if (A !== B && u > 0) pose = lerpPose(pose, this.poseFor(B, b, side), u, {});
    // 방아쇠 규율: 쏠 때만 검지를 방아쇠에, 평소엔 프레임 위에 곧게
    const tp = a === 'grip' ? pose : (A !== B && b === 'grip' && u > 0.5 ? pose : null);
    if (tp && tp.indexTrig && !this.item) {
      const k = this.trigW, o = { ...tp };
      o.index = tp.indexFrame.map((x, i) => x + (tp.indexTrig[i] - x) * k);
      pose = o;
    }
    if (A !== B && u > 0) {
      const pb = new THREE.Vector3(), qb = new THREE.Quaternion();
      _m2.multiplyMatrices(_m, B.matrixWorld).decompose(pb, qb, sa);
      pa.lerp(pb, u); qa.slerp(qb, u);
      // 경로를 아래로 살짝 휘게 (손이 총을 관통하지 않도록)
      pa.y -= Math.sin(u * Math.PI) * 0.05;
    }
    return { p: pa, q: qa, pose };
  }
}

