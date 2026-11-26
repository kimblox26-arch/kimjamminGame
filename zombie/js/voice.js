// 음성: Web Speech API(한국어 TTS) + 자막. 화자별 음높이/속도, 감정에 따른 떨림
export class Voice {
  constructor(game) {
    this.game = game; this.voices = []; this.enabled = true; this.subs = true; this.queue = Promise.resolve(); this.el = document.getElementById('subtitle'); this.cur = null;
    const load = () => { this.voices = (speechSynthesis.getVoices() || []).filter(v => /ko/i.test(v.lang)); };
    if ('speechSynthesis' in window) { load(); speechSynthesis.onvoiceschanged = load; }
  }
  pick(gender) {
    const V = this.voices; if (!V.length) return null;
    const male = V.filter(v => /injoon|male|남|hyunsu|gukmin|seoyeon?x/i.test(v.name)), fem = V.filter(v => /yuna|sunhi|heami|female|여|google|jimin/i.test(v.name));
    return gender === 'm' ? (male[0] || V[0]) : (fem[0] || V[0]);
  }
  static SPK = {
    player: { name: '나', g: 'm', pitch: 0.8, rate: 0.98 }, anchor: { name: '앵커', g: 'f', pitch: 1.08, rate: 1.06 },
    radio: { name: '라디오', g: 'm', pitch: 0.72, rate: 1.02 }, soldier: { name: '군인', g: 'm', pitch: 0.7, rate: 1.1 },
    reporter: { name: '현장 기자', g: 'm', pitch: 0.9, rate: 1.12 }, neighbor: { name: '이웃', g: 'f', pitch: 1.2, rate: 1.15 }
  };
  // 반환: 말이 끝나면 resolve
  say(text, who = 'player', o = {}) {
    const spk = Voice.SPK[who] || Voice.SPK.player;
    return new Promise(res => {
      this.show(spk.name, text, who);
      const est = (900 + text.length * 115 / (spk.rate * (o.rate || 1))) / (this.game.timeScale || 1);
      let done = false; const fin = () => { if (done) return; done = true; clearTimeout(tm); this.hide(text); res(); };
      const tm = setTimeout(fin, est + 2500);
      const v = this.enabled && 'speechSynthesis' in window ? this.pick(spk.g) : null;
      if (!v) { setTimeout(fin, est); return; }
      const u = new SpeechSynthesisUtterance(text); u.voice = v; u.lang = 'ko-KR';
      const fear = who === 'player' ? (this.game.player?.fear || 0) / 100 : 0;
      u.pitch = Math.min(2, (spk.pitch + fear * 0.25) * (o.pitch || 1)); u.rate = spk.rate * (o.rate || 1) * (1 + fear * 0.12); u.volume = (o.vol ?? 1) * (this.game.audio.vol || 1);
      u.onend = fin; u.onerror = () => setTimeout(fin, est);
      this.cur = u; speechSynthesis.speak(u);
    });
  }
  show(name, text, who) { if (!this.subs) return; this.el.innerHTML = `<span class="who">${name}</span>${text}`; this.el.dataset.t = text; this.el.style.opacity = 1; }
  hide(text) { if (this.el.dataset.t === text) this.el.style.opacity = 0; }
  stop() { if ('speechSynthesis' in window) speechSynthesis.cancel(); this.el.style.opacity = 0; }
  // 순차 대사
  async lines(arr) { for (const [who, t, o] of arr) await this.say(t, who, o); }
}
