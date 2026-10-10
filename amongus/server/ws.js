// 의존성 없는 최소 WebSocket 서버 구현 (RFC 6455)
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const MAX = 1 << 20;

class Socket extends EventEmitter {
  constructor(s) {
    super();
    this.s = s; this.buf = Buffer.alloc(0); this.frags = []; this.open = true;
    s.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this.parse(); });
    s.on('close', () => this.close());
    s.on('error', () => this.close());
  }
  parse() {
    while (this.open) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > MAX) return this.close();
      const mOff = off;
      if (masked) off += 4;
      if (b.length < off + len) return;
      let p = Buffer.from(b.subarray(off, off + len));
      if (masked) for (let i = 0; i < p.length; i++) p[i] ^= b[mOff + (i & 3)];
      this.buf = b.subarray(off + len);
      if (op === 8) return this.close();
      if (op === 9) { this.frame(10, p); continue; }
      if (op > 2) continue;
      this.frags.push(p);
      if (this.frags.reduce((n, f) => n + f.length, 0) > MAX) return this.close();
      if (fin) { const msg = Buffer.concat(this.frags).toString('utf8'); this.frags = []; this.emit('message', msg); }
    }
  }
  frame(op, p) {
    const n = p.length;
    const h = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    if (n >= 126 && n < 65536) { h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
    else if (n >= 65536) { h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
    if (!this.s.destroyed) this.s.write(Buffer.concat([h, p]));
  }
  send(str) { if (this.open) this.frame(1, Buffer.from(str)); }
  close() {
    if (!this.open) return;
    this.open = false;
    try { this.frame(8, Buffer.alloc(0)); this.s.end(); } catch { /* 이미 닫힘 */ }
    setTimeout(() => this.s.destroy(), 1000);
    this.emit('close');
  }
}

export function acceptUpgrade(req, socket, onConn) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  onConn(new Socket(socket));
}
