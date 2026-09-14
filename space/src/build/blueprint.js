// ORBITER — 청사진 공유 코드
//
// Spaceflight Simulator 의 블루프린트 공유처럼, 설계를 짧은 문자열 하나로
// 주고받는다. JSON → 키 축약 → 사전 압축 → Base64URL 순으로 만든다.
// 외부 라이브러리 없이 동작해야 하므로 압축은 직접 구현한 LZ 계열이다.

import { Craft } from './craft.js';

const MAGIC = 'ORB1';

/** 사전 용량 한계. 넘으면 사전을 얼린다 (초기화하면 복호기와 어긋난다) */
const MAX_CODE = 0xffff;

/* ──────────────────────────────────────────────────────────────
 * LZ77 계열 압축 — 반복되는 부품 정의 문자열에 특히 잘 듣는다
 * ────────────────────────────────────────────────────────────── */

function lzCompress(str) {
  const dict = new Map();
  const out = [];
  let phrase = str[0] ?? '';
  let code = 256;
  for (let i = 1; i < str.length; i++) {
    const c = str[i];
    const next = phrase + c;
    if (dict.has(next)) {
      phrase = next;
    } else {
      out.push(phrase.length > 1 ? dict.get(phrase) : phrase.charCodeAt(0));
      if (code <= MAX_CODE) dict.set(next, code++);
      phrase = c;
    }
  }
  if (phrase !== '') {
    out.push(phrase.length > 1 ? dict.get(phrase) : phrase.charCodeAt(0));
  }
  return out;
}

function lzDecompress(codes) {
  if (!codes.length) return '';
  const dict = new Map();
  let code = 256;
  let prev = String.fromCharCode(codes[0]);
  let out = prev;
  for (let i = 1; i < codes.length; i++) {
    const k = codes[i];
    let entry;
    if (k < 256) entry = String.fromCharCode(k);
    else if (dict.has(k)) entry = dict.get(k);
    else entry = prev + prev[0];
    out += entry;
    if (code <= MAX_CODE) dict.set(code++, prev + entry[0]);
    prev = entry;
  }
  return out;
}

/* ── 가변폭 비트 패킹 ↔ Base64URL ──────────────────────────
 *
 * 코드를 무조건 16비트로 쓰면 작은 설계에서는 오히려 커진다.
 * 사전 크기에 맞춰 9~16비트로 늘려 가며 채운다 (표준 LZW 패킹).
 * ────────────────────────────────────────────────────────── */

/** 코드 n 번째를 쓸 때 필요한 비트 수 (사전 크기 = 256 + n) */
function widthFor(dictSize) {
  let w = 9;
  while (dictSize > (1 << w) - 1 && w < 16) w++;
  return w;
}

function codesToBase64(codes) {
  const bytes = [];
  let acc = 0;
  let bits = 0;
  let dictSize = 256;
  for (const code of codes) {
    const w = widthFor(dictSize);
    acc = (acc << w) | (code & ((1 << w) - 1));
    bits += w;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >>> bits) & 0xff);
    }
    if (dictSize <= MAX_CODE) dictSize++;
  }
  if (bits > 0) bytes.push((acc << (8 - bits)) & 0xff);

  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.slice(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64ToCodes(b64, expected) {
  const pad = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '==='.slice((pad.length + 3) % 4));
  const codes = [];
  let acc = 0;
  let bits = 0;
  let dictSize = 256;
  for (let i = 0; i < bin.length; i++) {
    acc = (acc << 8) | bin.charCodeAt(i);
    bits += 8;
    let w = widthFor(dictSize);
    while (bits >= w) {
      bits -= w;
      codes.push((acc >>> bits) & ((1 << w) - 1));
      if (dictSize <= MAX_CODE) dictSize++;
      if (codes.length === expected) return codes;
      w = widthFor(dictSize);
    }
    acc &= (1 << bits) - 1;
  }
  return codes;
}

/* ──────────────────────────────────────────────────────────────
 * 공개 API
 * ────────────────────────────────────────────────────────────── */

/**
 * 기체 → 공유 코드 문자열.
 * @param {Craft} craft
 * @returns {string}
 */
export function craftToCode(craft) {
  // 사전 코드가 256 부터 시작하므로 입력은 반드시 ASCII 여야 한다.
  // 한글 기체 이름은 \uXXXX 로 이스케이프해 둔다 (JSON.parse 가 되돌린다).
  const json = JSON.stringify(craft.toBlueprint()).replace(
    /[\u0080-\uffff]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
  );
  const codes = lzCompress(json);
  // 코드 개수를 같이 적어 둔다 — 마지막 바이트의 패딩 비트를 구분하기 위해서
  return `${MAGIC}:${codes.length.toString(36)}:${codesToBase64(codes)}`;
}

/**
 * 공유 코드 → 기체.
 * @param {string} code
 * @returns {Craft}
 * @throws {Error} 형식이 틀리면
 */
export function codeToCraft(code) {
  const text = String(code ?? '').trim().replace(/\s+/g, '');
  if (!text) throw new Error('빈 코드입니다');

  // 순수 JSON 을 붙여 넣은 경우도 받아준다
  if (text.startsWith('{')) return Craft.fromBlueprint(JSON.parse(text));

  const parts = text.split(':');
  if (parts[0] !== MAGIC) {
    throw new Error(`알 수 없는 청사진 형식입니다 (${parts[0] || '표식 없음'})`);
  }
  if (parts.length < 3) throw new Error('청사진 코드가 손상되었습니다');
  const count = parseInt(parts[1], 36);
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error('청사진 코드가 손상되었습니다');
  }
  const json = lzDecompress(base64ToCodes(parts[2], count));
  const obj = JSON.parse(json);
  return Craft.fromBlueprint(obj);
}

/** 코드가 유효해 보이는가 (붙여넣기 검증용) */
export function looksLikeCode(text) {
  const t = String(text ?? '').trim();
  return t.startsWith(`${MAGIC}:`) || t.startsWith('{');
}

/**
 * 클립보드에 복사한다. 권한이 없으면 임시 textarea 로 대체한다.
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    /* 아래 대체 경로로 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

/** 클립보드에서 읽는다 (권한이 없으면 null) */
export async function readClipboard() {
  try {
    if (navigator.clipboard?.readText) return await navigator.clipboard.readText();
  } catch (e) {
    /* 사용자가 직접 붙여넣게 한다 */
  }
  return null;
}
