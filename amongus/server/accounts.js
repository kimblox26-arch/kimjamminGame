// 계정 저장소 + 보호자 인증 메일 발송
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { ageOf, CHILD_AGE, randomName } from '../public/js/shared/data.js';

const DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = path.join(DIR, 'accounts.json');
let db = { accounts: {} };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* 첫 실행 */ }
let saveT = null;
const save = () => {
  clearTimeout(saveT);
  saveT = setTimeout(() => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db, null, 1)); }, 300);
};

const hash = (p, salt) => crypto.scryptSync(String(p), salt, 32).toString('hex');
const all = () => Object.values(db.accounts);
const WORDS = ['clastic', 'brave', 'lunar', 'cosmic', 'swift', 'quiet', 'pixel', 'nova', 'rusty', 'mint', 'echo', 'frost'];
const TAILS = ['den', 'fox', 'orb', 'cat', 'jet', 'bee', 'owl', 'ray'];
function friendCode() {
  let c;
  do c = WORDS[crypto.randomInt(WORDS.length)] + TAILS[crypto.randomInt(TAILS.length)] + '#' + crypto.randomInt(1000, 10000);
  while (all().some(a => a.friendCode === c));
  return c;
}
const emailOk = e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 120;
export const validBirth = b => /^\d{4}-\d{2}-\d{2}$/.test(b) && ageOf(b) >= 0 && ageOf(b) < 120;
export const validName = n => typeof n === 'string' && n.trim().length >= 1 && n.trim().length <= 10 && !/[<>]/.test(n);
export const isChild = acc => ageOf(acc.birth) < CHILD_AGE;
export const status = acc => (isChild(acc) ? 'teal' : 'green');

function newToken(acc) {
  const t = crypto.randomBytes(24).toString('hex');
  acc.tokens = [...(acc.tokens || []).slice(-9), t];
  return t;
}
export function register({ email, pass, name, birth, parentEmail }, baseUrl) {
  email = String(email || '').trim().toLowerCase();
  if (!emailOk(email)) throw new Error('올바른 이메일을 입력하세요.');
  if (all().some(a => a.email === email)) throw new Error('이미 가입된 이메일입니다.');
  if (String(pass || '').length < 6) throw new Error('비밀번호는 6자 이상이어야 합니다.');
  if (!validBirth(birth)) throw new Error('생일이 올바르지 않습니다.');
  const child = ageOf(birth) < CHILD_AGE;
  if (child && !emailOk(parentEmail)) throw new Error('만 14세 미만은 보호자 이메일이 필요합니다.');
  if (!child && !validName(name)) throw new Error('이름은 1~10자로 입력하세요.');
  const salt = crypto.randomBytes(16).toString('hex');
  const acc = {
    id: crypto.randomUUID(), email, salt, pass: hash(pass, salt), birth, created: Date.now(),
    name: child ? randomName() : name.trim(), friendCode: friendCode(), friends: [], requests: [],
    parentEmail: child ? parentEmail.trim().toLowerCase() : null, parentVerified: false,
  };
  db.accounts[acc.id] = acc;
  const token = newToken(acc);
  save();
  if (child) sendParentMail(acc, baseUrl);
  return { acc, token };
}
export function login(email, pass) {
  const acc = all().find(a => a.email === String(email || '').trim().toLowerCase());
  if (!acc || hash(pass, acc.salt) !== acc.pass) throw new Error('이메일 또는 비밀번호가 틀렸습니다.');
  const token = newToken(acc);
  save();
  return { acc, token };
}
export const byToken = t => (t ? all().find(a => a.tokens?.includes(t)) : null);
export const byId = id => db.accounts[id];
export function logout(acc, t) { acc.tokens = (acc.tokens || []).filter(x => x !== t); save(); }
export function rename(acc, name) {
  if (isChild(acc)) throw new Error('이 계정은 이름을 바꿀 수 없습니다.');
  if (!validName(name)) throw new Error('이름은 1~10자로 입력하세요.');
  acc.name = name.trim(); save();
}
export function remove(acc) {
  for (const a of all()) { a.friends = a.friends.filter(f => f !== acc.id); a.requests = a.requests.filter(f => f !== acc.id); }
  delete db.accounts[acc.id]; save();
}
export function publicAcc(acc) {
  const mask = e => e && e.replace(/^(.{2}).*(@.*)$/, '$1***$2');
  return { id: acc.id, email: acc.email, name: acc.name, friendCode: acc.friendCode, birth: acc.birth, child: isChild(acc),
    parentEmail: mask(acc.parentEmail), parentVerified: !!acc.parentVerified };
}

// 친구
export function addFriend(acc, code) {
  const t = all().find(a => a.friendCode.toLowerCase() === String(code || '').trim().toLowerCase());
  if (!t) throw new Error('친구 코드를 찾을 수 없습니다.');
  if (t.id === acc.id) throw new Error('내 친구 코드입니다.');
  if (acc.friends.includes(t.id)) throw new Error('이미 친구입니다.');
  if (acc.requests.includes(t.id)) return acceptFriend(acc, t.id);
  if (!t.requests.includes(acc.id)) t.requests.push(acc.id);
  save();
  return t;
}
export function acceptFriend(acc, id) {
  const t = db.accounts[id];
  acc.requests = acc.requests.filter(r => r !== id);
  if (t && !acc.friends.includes(id)) { acc.friends.push(id); t.friends.push(acc.id); t.requests = t.requests.filter(r => r !== acc.id); }
  save();
  return t;
}
export function removeFriend(acc, id) {
  acc.friends = acc.friends.filter(f => f !== id); acc.requests = acc.requests.filter(r => r !== id);
  const t = db.accounts[id];
  if (t) t.friends = t.friends.filter(f => f !== acc.id);
  save();
}
export function friendList(acc, isOnline) {
  const info = id => { const a = db.accounts[id]; return a && { id, name: a.name, code: a.friendCode, online: isOnline(id) }; };
  return { friends: acc.friends.map(info).filter(Boolean), requests: acc.requests.map(info).filter(Boolean) };
}

// 보호자 인증
export function sendParentMail(acc, baseUrl) {
  acc.verifyToken = crypto.randomBytes(16).toString('hex'); save();
  const link = `${baseUrl}/verify?token=${acc.verifyToken}`;
  return sendMail(acc.parentEmail, '[AMONG US] 자녀 계정 보호자 인증 요청',
    `안녕하세요.\n\n자녀(생년월일 ${acc.birth})가 AMONG US 계정을 만들었습니다.\n` +
    `아래 링크를 눌러 보호자 인증을 완료하면 온라인 플레이가 허용됩니다.\n(만 14세 미만 계정은 빠른 채팅만 사용할 수 있습니다.)\n\n${link}\n\n` +
    `요청한 적이 없다면 이 메일을 무시하세요.`);
}
export function verifyParent(token) {
  const acc = token && all().find(a => a.verifyToken === token);
  if (!acc) return null;
  acc.parentVerified = true; acc.verifyToken = null; save();
  return acc;
}

// 메일: SMTP_HOST 등이 설정되어 있으면 실제 발송, 아니면 개발용 보낸편지함(/outbox)에 저장
export const outbox = [];
export const smtpReady = () => !!process.env.SMTP_HOST;
export async function sendMail(to, subject, text) {
  if (!smtpReady()) {
    outbox.unshift({ to, subject, text, at: new Date().toISOString() }); outbox.length = Math.min(outbox.length, 50);
    console.log(`\n[메일 - 개발용 보낸편지함] 받는 사람: ${to}\n제목: ${subject}\n${text}\n`);
    return;
  }
  try { await smtp(to, subject, text); console.log(`[메일] ${to} 에게 발송 완료`); }
  catch (e) { console.error('[메일 발송 실패]', e.message); outbox.unshift({ to, subject, text, at: new Date().toISOString(), error: e.message }); }
}
function smtp(to, subject, text) {
  const { SMTP_HOST: host, SMTP_PORT: port = 465, SMTP_USER: user, SMTP_PASS: pass, SMTP_FROM: from = process.env.SMTP_USER } = process.env;
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port: +port, servername: host });
    sock.setTimeout(15000, () => { sock.destroy(); reject(new Error('SMTP 시간 초과')); });
    sock.on('error', reject);
    let buf = '', waiting = null; const lines = [];
    sock.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); if (/^\d{3} /.test(l)) lines.push(l); }
      if (waiting && lines.length) { const w = waiting; waiting = null; w(lines.shift()); }
    });
    const read = () => new Promise(r => (lines.length ? r(lines.shift()) : (waiting = r)));
    const cmd = async (c, code) => { if (c !== null) sock.write(c + '\r\n'); const l = await read(); if (!l.startsWith(code)) throw new Error(l); };
    const b64 = s => Buffer.from(s).toString('base64');
    (async () => {
      await cmd(null, '220'); await cmd('EHLO amongus.local', '250');
      if (user) { await cmd('AUTH LOGIN', '334'); await cmd(b64(user), '334'); await cmd(b64(pass), '235'); }
      await cmd(`MAIL FROM:<${from}>`, '250'); await cmd(`RCPT TO:<${to}>`, '25'); await cmd('DATA', '354');
      const msg = [`From: AMONG US <${from}>`, `To: <${to}>`, `Subject: =?UTF-8?B?${b64(subject)}?=`, 'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(text).replace(/.{76}/g, '$&\r\n'), '.'].join('\r\n');
      await cmd(msg, '250'); sock.write('QUIT\r\n'); sock.end(); resolve();
    })().catch(e => { sock.destroy(); reject(e); });
  });
}
