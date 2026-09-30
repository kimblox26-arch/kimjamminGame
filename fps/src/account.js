// 계정: 닉네임 · 로그인/회원가입 (Google / 이메일 / 전화번호 SMS) — Firebase Authentication + Firestore 동기화
import { FIREBASE_CONFIG } from './firebase-config.js';

const $ = (id) => document.getElementById(id);
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const ERR = {
  'auth/invalid-email': '이메일 형식이 올바르지 않습니다.', 'auth/missing-password': '비밀번호를 입력하세요.', 'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
  'auth/email-already-in-use': '이미 가입된 이메일입니다. 로그인하세요.', 'auth/invalid-credential': '이메일 또는 비밀번호가 틀렸습니다.', 'auth/user-not-found': '가입되지 않은 이메일입니다.',
  'auth/wrong-password': '비밀번호가 틀렸습니다.', 'auth/popup-closed-by-user': '로그인 창이 닫혔습니다.', 'auth/popup-blocked': '팝업이 차단되었습니다. 팝업을 허용해 주세요.',
  'auth/invalid-phone-number': '전화번호 형식이 올바르지 않습니다.', 'auth/invalid-verification-code': '인증번호가 틀렸습니다.', 'auth/too-many-requests': '요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
  'auth/unauthorized-domain': '이 도메인이 Firebase 승인 도메인에 없습니다.', 'auth/operation-not-allowed': 'Firebase 콘솔에서 이 로그인 방법을 사용 설정해야 합니다.',
};
// 010-1234-5678 → +821012345678 (이미 + 로 시작하면 그대로)
export function toE164(s) {
  const d = s.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  if (d.startsWith('0')) return '+82' + d.slice(1);
  return '+' + d;
}
export function validNick(n) { return /^[\p{L}\p{N}_\- ]{2,12}$/u.test(n.trim()); }

export class Account {
  constructor(game) {
    this.g = game; this.P = game.profile; this.fb = null; this.user = null; this.confirm = null;
    $('btn-account').onclick = () => this.open();
    $('btn-account-done').onclick = () => this.g.showScreen(this.from || 'menu');
    $('acc-nick-save').onclick = () => this.saveNick();
    $('acc-google').onclick = () => this.run(() => this.google());
    $('acc-em-login').onclick = () => this.run(() => this.email(false));
    $('acc-em-signup').onclick = () => this.run(() => this.email(true));
    $('acc-ph-send').onclick = () => this.run(() => this.phoneSend());
    $('acc-ph-verify').onclick = () => this.run(() => this.phoneVerify());
    $('acc-logout').onclick = () => this.run(() => this.logout());
    $('acc-tab-email').onclick = () => this.tab('email'); $('acc-tab-phone').onclick = () => this.tab('phone');
    this.P.onChange(() => { this.badge(); this.queueSync(); });
    this.badge();
    if (FIREBASE_CONFIG) this.init().catch((e) => this.msg('로그인 서버 연결 실패: ' + e.message));
  }

  async init() {
    const [app, auth, fs] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
    const a = app.initializeApp(FIREBASE_CONFIG);
    this.fb = { app, auth, fs, A: auth.getAuth(a), D: fs.getFirestore(a) };
    this.fb.A.languageCode = 'ko';
    auth.onAuthStateChanged(this.fb.A, (u) => this.onUser(u));
  }
  need() { if (!this.fb) throw new Error(FIREBASE_CONFIG ? '로그인 서버에 연결하는 중입니다. 잠시 후 다시 시도하세요.' : '로그인 서버가 아직 설정되지 않았습니다 (src/firebase-config.js). 지금은 게스트로 이 기기에 저장됩니다.'); return this.fb; }

  async run(f) { try { this.msg('처리 중…'); await f(); } catch (e) { this.msg(ERR[e.code] || e.message); } }
  msg(t) { $('acc-msg').textContent = t || ''; }
  tab(t) { $('acc-email').hidden = t !== 'email'; $('acc-phone').hidden = t !== 'phone'; $('acc-tab-email').classList.toggle('on', t === 'email'); $('acc-tab-phone').classList.toggle('on', t === 'phone'); }

  open(from = 'menu') { this.from = from; $('acc-nick').value = this.P.nick; this.status(); this.msg(''); this.g.showScreen('account'); }
  status() {
    const u = this.user;
    $('acc-status').textContent = u ? `로그인됨 — ${u.email || u.phoneNumber || u.displayName || 'Google'} (${this.P.provider})` : '게스트로 플레이 중 (이 기기에 저장)';
    $('acc-login').hidden = !!u; $('acc-logout').hidden = !u;
  }
  badge() { $('pb-nick').textContent = this.P.nick || '게스트'; $('pb-pts').textContent = this.P.points.toLocaleString() + ' P'; }

  async saveNick() {
    const n = $('acc-nick').value.trim();
    if (!validNick(n)) { this.msg('닉네임은 2~12자 (한글·영문·숫자·_ - 공백)'); return; }
    this.P.nick = n; this.P.save();
    if (this.user && this.fb) await this.fb.auth.updateProfile(this.user, { displayName: n }).catch(() => {});
    this.msg('닉네임을 저장했습니다.');
  }

  async google() { const { auth, A } = this.need(); await auth.signInWithPopup(A, new auth.GoogleAuthProvider()); }
  async email(signup) {
    const { auth, A } = this.need(), em = $('acc-em').value.trim(), pw = $('acc-pw').value;
    if (signup) { const c = await auth.createUserWithEmailAndPassword(A, em, pw); if (this.P.nick) await auth.updateProfile(c.user, { displayName: this.P.nick }); this.msg('회원가입 완료!'); }
    else await auth.signInWithEmailAndPassword(A, em, pw);
  }
  async phoneSend() {
    const { auth, A } = this.need();
    this.rv = this.rv || new auth.RecaptchaVerifier(A, 'recaptcha-box', { size: 'invisible' });
    this.confirm = await auth.signInWithPhoneNumber(A, toE164($('acc-ph').value), this.rv);
    $('acc-code').hidden = false; $('acc-ph-verify').hidden = false; this.msg('인증번호를 문자로 보냈습니다.');
  }
  async phoneVerify() { if (!this.confirm) throw new Error('먼저 인증번호를 받으세요.'); await this.confirm.confirm($('acc-code').value.trim()); }
  async logout() { const { auth, A } = this.need(); await auth.signOut(A); this.msg('로그아웃했습니다.'); }

  // 로그인 시: 클라우드 기록과 합침 (포인트·업그레이드는 더 큰 쪽 유지) → 이후 변경 자동 저장
  async onUser(u) {
    this.user = u; this.status();
    if (!u) { this.P.uid = null; this.P.provider = 'guest'; this.P.save(); return; }
    this.P.uid = u.uid; this.P.provider = u.providerData[0]?.providerId || 'firebase';
    if (!this.P.nick && u.displayName) this.P.nick = u.displayName.slice(0, 12);
    try {
      const { fs, D } = this.fb, snap = await fs.getDoc(fs.doc(D, 'players', u.uid));
      if (snap.exists()) {
        const c = snap.data();
        this.P.points = Math.max(this.P.points, c.points || 0); this.P.kills = Math.max(this.P.kills || 0, c.kills || 0); this.P.best = Math.max(this.P.best || 0, c.best || 0);
        for (const id in c.up || {}) for (const k in c.up[id]) { const cur = this.P.level(id, k); if (c.up[id][k] > cur) (this.P.up[id] || (this.P.up[id] = {}))[k] = c.up[id][k]; }
        if (c.nick && !this.P.nick) this.P.nick = c.nick;
      }
    } catch (e) { this.msg('클라우드 기록을 불러오지 못했습니다: ' + e.message); }
    this.P.save(); this.g.weapons.refreshUpgrades(); this.msg('로그인되었습니다. 기록이 클라우드에 저장됩니다.');
  }
  queueSync() {
    if (!this.user || !this.fb) return;
    clearTimeout(this.syncT);
    this.syncT = setTimeout(() => { const { fs, D } = this.fb; fs.setDoc(fs.doc(D, 'players', this.user.uid), { ...this.P.data(), updated: Date.now() }, { merge: true }).catch(() => {}); }, 1500);
  }
}
