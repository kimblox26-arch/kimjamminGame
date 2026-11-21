'use strict';
// ===== 실시간 대결: 지금 접속한 다른 사람과 매칭 =====
// claude.ai 의 room 기능을 써요. 대기열(q)·접속(on)은 로비 presence, 대결은 둘만의 방(join)에서 주고받아요.
const LIVE = {
  room: null, match: null,
  async init() {
    if (!window.claude || !window.claude.use) return;
    this.room = await withTimeout(claude.use('room'), 5000);
    if (this.room) this.room.onPeers(() => document.dispatchEvent(new Event('livechange')), () => { });
  },
  hello(u) { if (this.room) this.room.presence({ on: u ? u.uid : null, q: null }).catch(() => { }); },
  online() {
    if (!this.room) return 0;
    return new Set(this.room.peers().map(p => p.presence && p.presence.on).filter(Boolean)).size;
  },
  // 대기열에 들어가서 짝이 생기면 cb(상대 uid, 내가 방장인지)
  queue(u, cb) {
    const R = this.room, mine = { uid: u.uid, t: Date.now() }; let done = false;
    R.presence({ on: u.uid, q: mine }).catch(() => { });
    const check = () => {
      if (done) return;
      const seen = {};
      R.peers().forEach(p => { const q = p.presence && p.presence.q; if (q && q.uid && D.users[q.uid] && !D.users[q.uid].banned && (!seen[q.uid] || q.t < seen[q.uid].t)) seen[q.uid] = q; });
      seen[u.uid] = mine;
      const list = Object.values(seen).sort((a, b) => a.t - b.t || (a.uid < b.uid ? -1 : 1));
      const i = list.findIndex(q => q.uid === u.uid), j = i % 2 ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) return;
      stop(); cb(list[j].uid, i < j);
    };
    const un = R.onPeers(check, () => { }), iv = setInterval(check, 1000); setTimeout(check, 0);
    const stop = () => { if (done) return; done = true; un(); clearInterval(iv); R.presence({ q: null }).catch(() => { }); };
    return stop;
  },
  // 둘만의 방에 들어가서 상대가 들어오는지 확인
  async connect(u, opp) {
    const name = ('m-' + [u.uid, opp].sort().join('-')).toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 48);
    let M; try { M = await this.room.join(name); } catch (e) { return null; }
    await M.presence({ uid: u.uid, hi: Date.now() }).catch(() => { });
    const ok = await this.waitFor(M, opp, op => !!op, 7000);
    if (!ok) { M.leave().catch(() => { }); return null; }
    return M;
  },
  pres(M, uid) { const p = M.peers().find(p => p.presence && p.presence.uid === uid); return p ? p.presence : null; },
  waitFor(M, uid, fn, ms) {
    return new Promise(res => {
      let un = null, to = null, fin = false;
      const end = v => { if (fin) return; fin = true; un && un(); clearTimeout(to); res(v); };
      const chk = () => { if (fn(this.pres(M, uid))) end(true); };
      un = M.onPeers(chk, () => { }); to = setTimeout(() => end(false), ms); setTimeout(chk, 0);
    });
  },
  end() { if (this.match) { this.match.M.leave().catch(() => { }); this.match = null; } },
};
