// 음성 인식: 앱(APK)에서는 안드로이드 SpeechRecognizer, 브라우저에서는 Web Speech API
import { Native } from './audio.js';

export class Voice {
  constructor({ onText, onPartial, onLevel, onState }) {
    Object.assign(this, { onText, onPartial, onLevel, onState });
    this.on = false;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.available = !!(Native?.startListen || SR);
    window.__nativeSpeech = (ev, data) => {
      if (ev === 'partial') this.onPartial?.(data);
      else if (ev === 'final') { this.stopUi(); if (data) this.onText?.(data); }
      else if (ev === 'level') this.onLevel?.(Math.max(0, Math.min(1, (+data + 2) / 12)));
      else if (ev === 'end' || ev === 'error') { this.stopUi(); if (ev === 'error') this.onState?.('error', data); }
    };
    if (!Native?.startListen && SR) {
      const r = this.rec = new SR(); r.lang = 'ko-KR'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
      r.onresult = e => {
        let fin = '', part = '';
        for (const res of e.results) (res.isFinal ? (fin += res[0].transcript) : (part += res[0].transcript));
        if (part) this.onPartial?.(part);
        if (fin) { this.stopUi(); this.onText?.(fin.trim()); }
      };
      r.onend = () => this.stopUi();
      r.onerror = e => { this.stopUi(); this.onState?.('error', e.error); };
    }
  }
  toggle() { this.on ? this.stop() : this.start(); }
  start() {
    if (!this.available) { this.onState?.('error', 'unsupported'); return; }
    this.on = true; this.onState?.('on');
    try { Native?.startListen ? Native.startListen() : this.rec.start(); } catch (e) { this.stopUi(); }
  }
  stop() { try { Native?.stopListen ? Native.stopListen() : this.rec?.stop(); } catch (e) { } this.stopUi(); }
  stopUi() { if (this.on) { this.on = false; this.onState?.('off'); } }
}

// 한국어 숫자 말 → 숫자 ("삼천오백원" → 3500, "만 원" → 10000, "4,800원" → 4800)
export function parseWon(t) {
  const m = t.replace(/,/g, '').match(/(\d+)\s*원/); if (m) return +m[1];
  const D = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 }, U = { 십: 10, 백: 100, 천: 1000 };
  const s = (t.match(/([일이삼사오육칠팔구십백천만]+)\s*원/) || [])[1]; if (!s) return null;
  let total = 0, sec = 0, d = 0;
  for (const ch of s) {
    if (D[ch]) d = D[ch];
    else if (U[ch]) { sec += (d || 1) * U[ch]; d = 0; }
    else if (ch === '만') { total += (sec + d || 1) * 10000; sec = 0; d = 0; }
  }
  return total + sec + d;
}
