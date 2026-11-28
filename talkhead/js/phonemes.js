'use strict';
/* 글자 → 음소 → 조음(입·혀·턱·성대) 목표값
   좌표는 head.js 의 가상좌표(머리가 왼쪽을 보는 옆 단면) 기준 */
const P = (() => {
  const V = (body, jaw, o) => Object.assign({ v: 1, body, jaw, voice: 1, d: 1 }, o);
  const C = o => Object.assign({ v: 0, voice: 0, d: 0.6 }, o);
  const ALV = [289, 575], DEN = [262, 602], POS = [304, 569];
  const REST = [398, 592];

  // jaw 턱 벌림, lc 입술 닫힘, lr 입술 둥글게, ls 입술 옆으로, ld 아랫입술-윗니, tip 혀끝 위치,
  // body 혓몸 위치, back 혀뒤-연구개 접촉, vel 연구개 내림(코 소리), voice 성대 떨림, fric 마찰 바람
  const PH = {
    a: V([410, 642], .85), ʌ: V([432, 616], .45), o: V([446, 602], .35, { lr: .75 }), u: V([452, 582], .15, { lr: 1 }),
    ɯ: V([430, 584], .15, { ls: .6 }), i: V([348, 575], .12, { ls: .85 }), e: V([362, 593], .3, { ls: .5 }), ɛ: V([368, 603], .45, { ls: .4 }),
    æ: V([382, 630], .7, { ls: .45 }), ə: V([402, 610], .35, { d: .7 }), ɪ: V([360, 585], .22, { ls: .5, d: .8 }),
    ʊ: V([442, 592], .25, { lr: .55, d: .8 }), ɔ: V([446, 622], .55, { lr: .6 }), ɑ: V([420, 642], .8),
    j: C({ body: [345, 572], ls: .5, voice: 1, d: .35, jaw: .1 }), w: C({ body: [452, 582], lr: 1, voice: 1, d: .35, jaw: .1 }),
    p: C({ lc: 1, jaw: .05, stop: 1, lab: 1 }), b: C({ lc: 1, jaw: .05, stop: 1, lab: 1, voice: 1 }), m: C({ lc: 1, lab: 1, jaw: .05, vel: 1, voice: 1 }),
    f: C({ ld: 1, jaw: .08, fric: 1, d: .7 }), v: C({ ld: 1, jaw: .08, fric: .6, voice: 1 }),
    θ: C({ tip: DEN, jaw: .14, fric: .6, d: .7 }), ð: C({ tip: DEN, jaw: .14, fric: .4, voice: 1, d: .5 }),
    t: C({ tip: ALV, jaw: .08, stop: 1, d: .5 }), d: C({ tip: ALV, jaw: .08, stop: 1, voice: 1, d: .45 }), n: C({ tip: ALV, jaw: .08, vel: 1, voice: 1 }),
    s: C({ tip: [291, 582], jaw: .05, fric: 1, ls: .3, d: .75 }), z: C({ tip: [291, 582], jaw: .05, fric: .7, voice: 1 }),
    ʃ: C({ tip: POS, body: [360, 575], lr: .55, jaw: .07, fric: 1, d: .75 }), ʒ: C({ tip: POS, body: [360, 575], lr: .5, jaw: .07, fric: .7, voice: 1 }),
    tʃ: C({ tip: POS, body: [360, 575], lr: .45, jaw: .07, stop: 1, fric: .8, d: .7 }), dʒ: C({ tip: POS, body: [360, 575], lr: .4, jaw: .07, stop: 1, fric: .6, voice: 1 }),
    tɕ: C({ tip: [297, 588], body: [342, 563], jaw: .07, stop: 1, fric: .8, d: .65 }),
    l: C({ tip: ALV, jaw: .16, voice: 1, d: .5 }), ɾ: C({ tip: [292, 578], jaw: .14, voice: 1, d: .3 }),
    r: C({ tip: [318, 584], body: [420, 596], lr: .4, jaw: .14, voice: 1, d: .5 }),
    k: C({ back: 1, jaw: .12, stop: 1, d: .55 }), g: C({ back: 1, jaw: .12, stop: 1, voice: 1, d: .5 }), ŋ: C({ back: 1, jaw: .12, vel: 1, voice: 1 }),
    h: C({ glot: .6, fric: .35, d: .45 }),
    _: { v: 0, rest: 1, d: 1.6, jaw: .06, lc: .5, vel: .6, voice: 0 },
  };

  const DESC = {
    a: ['모음 ㅏ', '입을 크게 벌리고 혀를 아래로'], ʌ: ['모음 ㅓ', '턱을 반쯤 열고 혀를 뒤쪽으로'], o: ['모음 ㅗ', '입술을 동그랗게, 혀 뒤를 올려요'],
    u: ['모음 ㅜ', '입술을 쭉 내밀고 혀 뒤를 높이'], ɯ: ['모음 ㅡ', '입술은 옆으로, 혀 뒤를 높이'], i: ['모음 ㅣ', '입꼬리를 옆으로, 혀 앞을 높이'],
    e: ['모음 ㅔ', '혀 앞을 중간 높이로'], ɛ: ['모음 ㅐ', '턱을 조금 더 열고 혀를 앞으로'], æ: ['모음 æ', '턱을 크게, 혀는 앞쪽 아래'],
    ə: ['약모음 ə', '힘을 뺀 가운데 모음'], ɪ: ['모음 ɪ', 'ㅣ보다 살짝 느슨하게'], ʊ: ['모음 ʊ', '입술을 살짝 모아요'],
    ɔ: ['모음 ɔ', '입술을 둥글게, 턱을 열어요'], ɑ: ['모음 ɑ', '입을 크게, 혀는 뒤쪽 아래'],
    j: ['반모음 j', '혀가 ㅣ 자리에서 미끄러져요'], w: ['반모음 w', '오므린 입술이 펴져요'],
    p: ['양순 파열음', '두 입술을 닫았다가 팍! 터뜨려요'], b: ['양순 파열음(유성)', '입술을 닫았다 떼며 성대가 떨려요'],
    m: ['양순 비음', '입술을 닫고 코로 소리를 내요'], f: ['순치 마찰음', '아랫입술을 윗니에 대고 바람'],
    v: ['순치 마찰음(유성)', '아랫입술+윗니, 성대도 떨려요'], θ: ['치간 마찰음', '혀끝을 이 사이에 살짝 물어요'],
    ð: ['치간 마찰음(유성)', '혀끝을 이 사이에, 성대 떨림'], t: ['치조 파열음', '혀끝을 윗잇몸에 붙였다 떼요'],
    d: ['치조 파열음(유성)', '혀끝을 잇몸에 붙였다 떼요'], n: ['치조 비음', '혀끝은 잇몸에, 연구개를 내려 코로'],
    s: ['치조 마찰음', '혀끝과 잇몸 사이로 쉬익'], z: ['치조 마찰음(유성)', '쉬익 + 성대 떨림'],
    ʃ: ['후치조 마찰음', '혀를 입천장 쪽으로, 입술은 앞으로'], ʒ: ['후치조 마찰음(유성)', '쉿 + 성대 떨림'],
    tʃ: ['파찰음', '막았다가 쉿 하고 풀어요'], dʒ: ['파찰음(유성)', '막았다 풀며 성대 떨림'],
    tɕ: ['파찰음 ㅈ', '혓바닥을 입천장에 붙였다 떼요'], l: ['설측음 ㄹ', '혀끝은 잇몸에, 공기는 혀 옆으로'],
    ɾ: ['탄음 ㄹ', '혀끝으로 잇몸을 톡 튕겨요'], r: ['접근음 r', '혀를 뒤로 말아 올려요'],
    k: ['연구개 파열음', '혀 뒤를 여린입천장에 붙였다 떼요'], g: ['연구개 파열음(유성)', '혀 뒤로 막았다 떼요'],
    ŋ: ['연구개 비음 ㅇ', '혀 뒤로 막고 코로 소리'], h: ['성문 마찰음', '성대 사이로 바람이 흘러요'], _: ['쉼', '숨을 쉬어요'],
  };

  // ---------- 한글 ----------
  const CHO_P = ['k', 'k', 'n', 't', 't', 'ɾ', 'm', 'p', 'p', 's', 's', '', 'tɕ', 'tɕ', 'tɕ', 'k', 't', 'p', 'h'];
  const CHO_G = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const JUNG_P = ['a', 'ɛ', 'j a', 'j ɛ', 'ʌ', 'e', 'j ʌ', 'j e', 'o', 'w a', 'w ɛ', 'w e', 'j o', 'u', 'w ʌ', 'w e', 'w i', 'j u', 'ɯ', 'ɯ i', 'i'];
  const JUNG_G = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
  const JONG_P = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ŋ', 't', 't', 'k', 't', 'p', 't'];
  const JONG_G = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
  const ph = (k, g, x) => Object.assign({ k, g }, x);

  function ko(ch, out) {
    const c = ch.charCodeAt(0);
    if (c >= 0xAC00 && c <= 0xD7A3) {
      const n = c - 0xAC00, a = Math.floor(n / 588), b = Math.floor(n % 588 / 28), z = n % 28;
      if (CHO_P[a]) out.push(ph(CHO_P[a], CHO_G[a], { asp: a >= 14, tense: [1, 4, 8, 10, 13].includes(a) }));
      JUNG_P[b].split(' ').forEach(k => out.push(ph(k, JUNG_G[b])));
      if (z) out.push(ph(JONG_P[z], JONG_G[z], { nb: 1 }));
      return true;
    }
    const ci = CHO_G.indexOf(ch);
    if (ci >= 0) { if (CHO_P[ci]) out.push(ph(CHO_P[ci], ch)); out.push(ph('ɯ', ch)); return true; }
    const vi = JUNG_G.indexOf(ch);
    if (vi >= 0) { JUNG_P[vi].split(' ').forEach(k => out.push(ph(k, ch))); return true; }
    return false;
  }

  // ---------- 영어 (간단 규칙) ----------
  const EX = {
    the: 'ð ə', a: 'ə', i: 'a ɪ', you: 'j u', to: 't u', of: 'ʌ v', is: 'ɪ z', was: 'w ʌ z', are: 'ɑ r', one: 'w ʌ n',
    two: 't u', what: 'w ʌ t', love: 'l ʌ v', eight: 'e ɪ t', my: 'm a ɪ', me: 'm i', we: 'w i', he: 'h i', she: 'ʃ i',
    be: 'b i', do: 'd u', who: 'h u', hello: 'h ɛ l o ʊ', oh: 'o ʊ', said: 's ɛ d', there: 'ð ɛ r', they: 'ð e ɪ',
    this: 'ð ɪ s', that: 'ð æ t', with: 'w ɪ ð', have: 'h æ v', come: 'k ʌ m', some: 's ʌ m', four: 'f ɔ r',
    five: 'f a ɪ v', nine: 'n a ɪ n', zero: 'z ɪ r o ʊ', three: 'θ r i', six: 's ɪ k s', seven: 's ɛ v ə n',
    little: 'l ɪ t ə l', world: 'w ə r l d', your: 'j ɔ r', no: 'n o ʊ', so: 's o ʊ', go: 'g o ʊ',
  };
  const RULES = [['tch', 'tʃ'], ['igh', 'a ɪ'], ['ough', 'o ʊ'], ['augh', 'ɔ'], ['eigh', 'e ɪ'], ['sh', 'ʃ'], ['ch', 'tʃ'],
    ['th', 'θ'], ['ph', 'f'], ['ng', 'ŋ'], ['ck', 'k'], ['qu', 'k w'], ['wh', 'w'], ['gh', ''], ['ee', 'i'], ['ea', 'i'],
    ['oo', 'u'], ['ou', 'a ʊ'], ['ow', 'o ʊ'], ['ai', 'e ɪ'], ['ay', 'e ɪ'], ['oi', 'ɔ ɪ'], ['oy', 'ɔ ɪ'], ['au', 'ɔ'],
    ['aw', 'ɔ'], ['ie', 'i'], ['oa', 'o ʊ'], ['ew', 'j u'], ['er', 'ə r'], ['ir', 'ə r'], ['ur', 'ə r'], ['ar', 'ɑ r'],
    ['or', 'ɔ r'], ['ey', 'i'], ['x', 'k s']];
  const SGL = { a: 'æ', b: 'b', c: 'k', d: 'd', e: 'ɛ', f: 'f', g: 'g', h: 'h', i: 'ɪ', j: 'dʒ', k: 'k', l: 'l', m: 'm', n: 'n',
    o: 'ɑ', p: 'p', q: 'k', r: 'r', s: 's', t: 't', u: 'ʌ', v: 'v', w: 'w', y: 'j', z: 'z' };
  const LONG = { a: 'e ɪ', e: 'i', i: 'a ɪ', o: 'o ʊ', u: 'j u' };

  function en(word, out) {
    let w = word.toLowerCase().replace(/[’']/g, '');
    if (EX[w]) { EX[w].split(' ').forEach(k => out.push(ph(k, word))); return; }
    let longAt = -1;
    if (w.length > 2 && /[aeiou][^aeiouwy]e$/.test(w)) { longAt = w.length - 3; w = w.slice(0, -1); }
    else if (w.length > 3 && /[^e]e$/.test(w)) w = w.slice(0, -1);
    if (/^(kn|wr)/.test(w)) { w = w.slice(1); longAt--; }
    for (let i = 0; i < w.length;) {
      let m = null;
      for (const r of RULES) if (w.startsWith(r[0], i)) { m = r; break; }
      if (!m) {
        const ch = w[i];
        if (!SGL[ch] || (i > 0 && ch === w[i - 1] && !'aeiou'.includes(ch))) { i++; continue; }
        let v = i === longAt ? LONG[ch] : SGL[ch];
        if (ch === 'c' && /[eiy]/.test(w[i + 1] || '')) v = 's';
        if (ch === 'y' && i > 0) v = i === w.length - 1 ? 'i' : 'ɪ';
        if (ch === 's' && i > 0 && i === w.length - 1 && /[bdgmnlrvaeiou]/.test(w[i - 1])) v = 'z';
        m = [ch, v];
      }
      if (m[1]) m[1].split(' ').forEach(k => out.push(ph(k, w.substr(i, m[0].length))));
      i += m[0].length;
    }
  }

  // 그 밖의 문자: 글자 코드로 자음+모음을 골라 입이 움직이게
  const CS = ['m', 'n', 'k', 't', 's', 'p', 'l', 'h'], VS = ['a', 'i', 'u', 'e', 'o'];
  const KD = '영일이삼사오육칠팔구', ED = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

  function word2ph(word, lang, out) {
    for (const s of word.match(/[a-zA-Z'’]+|\d|./gu) || []) {
      if (/^[a-zA-Z]/.test(s)) en(s, out);
      else if (/\d/.test(s)) lang.startsWith('ko') ? ko(KD[+s], out) : en(ED[+s], out);
      else if (!ko(s, out) && /\p{L}/u.test(s)) {
        const c = s.codePointAt(0);
        out.push(ph(CS[c % 8], s)); out.push(ph(VS[(c >> 3) % 5], s));
      }
    }
  }

  // 자음은 다음(없으면 이전) 모음의 혀·입술 모양을 미리 따라감 (동시조음)
  function resolve(flat) {
    const vow = i => {
      for (let j = i + 1; j < Math.min(flat.length, i + 4); j++) { const b = flat[j].base; if (b.v) return b; if (b.rest) break; }
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) { const b = flat[j].base; if (b.v) return b; }
      return null;
    };
    flat.forEach((f, i) => {
      const b = f.base, p = Object.assign({}, b);
      if (!b.v && !b.rest) {
        const nv = vow(i);
        if (nv) {
          if (!p.body) p.body = nv.body;
          if (p.lr == null) p.lr = (nv.lr || 0) * .8;
          if (p.ls == null) p.ls = (nv.ls || 0) * .5;
          p.jaw = (p.jaw || .1) + (nv.jaw || 0) * (p.lc || p.ld ? .15 : .3);
        }
      }
      if (f.q.asp) { p.fric = Math.max(p.fric || 0, .45); p.asp = 1; }
      if (f.q.nb && p.stop) { p.stop = 0; p.hold = 1; }
      f.p = p;
    });
  }

  function build(text, lang, sing) {
    const words = [], re = /[\p{L}\p{N}'’]+|[.,!?;:…~。、\n]+/gu;
    let m;
    while ((m = re.exec(text))) {
      const s = m[0];
      if (/^[\p{L}\p{N}]/u.test(s)) {
        const pl = []; word2ph(s, lang, pl);
        if (pl.length) words.push({ s: m.index, e: m.index + s.length, ph: pl, gap: .12 });
      } else if (words.length) words[words.length - 1].gap += /[.!?…。\n]/.test(s) ? 2.6 : 1.4;
    }
    const flat = []; let u = 0;
    words.forEach((w, wi) => {
      w.u0 = u; w.f0 = flat.length;
      for (const q of w.ph) {
        const base = PH[q.k] || PH.ə;
        const d = base.d * (q.tense ? 1.2 : 1) * (sing && base.v ? 3 : 1);
        flat.push({ q, base, wi, u0: u, u1: u + d }); u += d;
      }
      if (w.gap > .5) flat.push({ q: { k: '_', g: '' }, base: PH._, wi, u0: u, u1: u + w.gap });
      else flat[flat.length - 1].u1 += w.gap;
      u += w.gap; w.u1 = u;
    });
    resolve(flat);
    return { text, lang, words, flat, units: u };
  }

  return { PH, DESC, REST, build };
})();
