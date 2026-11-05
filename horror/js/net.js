// 같이하기 — claude.ai 게임 링크의 실시간 방(room) 기능으로 로비 · 방 만들기 · 위치 공유
// 게임 링크 밖(깃허브·내 컴퓨터)에서는 자동으로 혼자 하기(+AI 친구)로 동작한다.
export class Net {
  constructor() { this.room = null; this.game = null; this.code = null; this.isHost = false; this.status = 'checking'; this.lobbyFn = null; this.peerFn = null; this.me = {}; this.lastSend = 0; this.pending = null; }
  // 10초 안에 대답이 없으면 혼자 하기
  async init(onStatus) {
    const c = window.claude;
    if (!c || typeof c.use !== 'function') { this.status = 'offline'; onStatus && onStatus(this.status); return false; }
    try { this.room = await Promise.race([c.use('room'), new Promise(r => setTimeout(() => r(null), 11000))]); } catch (e) { this.room = null; }
    this.status = this.room ? 'online' : 'offline'; onStatus && onStatus(this.status);
    if (!this.room) return false;
    this.room.onPeers(ch => this.lobbyFn && this.lobbyFn(this.listRooms(ch.peers), ch.peers.length), () => { this.status = 'offline'; onStatus && onStatus('offline'); });
    return true;
  }
  get online() { return !!this.room; }
  lobbyPresence(p) { if (this.room) this.room.presence(p).catch(() => { }); }
  listRooms(peers = this.room ? this.room.peers() : []) {
    const out = [];
    for (const p of peers) { const h = p.presence && p.presence.host; if (h && typeof h.code === 'string') out.push({ code: h.code.slice(0, 8), name: String(h.name || '방').slice(0, 24), n: +h.n || 1, max: +h.max || 4, started: !!h.st, bots: +h.bots || 0, mine: p.isMe && p.sameTab }); }
    return out;
  }
  async create(cfg) {
    const code = Math.random().toString(36).slice(2, 6);
    await this.enter(code); this.isHost = true; this.cfg = cfg;
    return code;
  }
  async enter(code) {
    if (!this.room) return null;
    await this.leave();
    this.game = await this.room.join('gh-' + code.toLowerCase().replace(/[^a-z0-9]/g, ''));
    this.code = code; this.isHost = false; this.me = {};
    this.game.onPeers(ch => this.peerFn && this.peerFn(ch));
    return this.game;
  }
  async leave() { if (this.game) { try { await this.game.leave(); } catch (e) { } } this.game = null; this.code = null; this.isHost = false; this.lobbyPresence({ host: null }); }
  // 내 상태 보내기 (초당 최대 10번)
  set(patch, now = performance.now()) {
    Object.assign(this.me, patch);
    if (!this.game) return;
    if (now - this.lastSend < 100) { this.pending = true; return; }
    this.flush(now);
  }
  flush(now = performance.now()) {
    if (!this.game) return; this.lastSend = now; this.pending = false;
    this.game.presence(this.me).catch(e => { if (e && e.code === 'invalid_argument') { this.me.mm = (this.me.mm || []).slice(-2); } });
  }
  tick(now = performance.now()) { if (this.pending && now - this.lastSend >= 100) this.flush(now); }
  peers() { return this.game ? this.game.peers() : []; }
  others() { return this.peers().filter(p => !(p.isMe && p.sameTab) && p.kind === 'viewer'); }
  hostPeer() { return this.peers().find(p => p.presence && p.presence.host === true); }
}
