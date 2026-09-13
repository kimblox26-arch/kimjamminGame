// SpaceSim — Barnes-Hut 8분트리 (O(N log N) 중력 계산)
//
// 노드는 typed array 로 평탄화해 저장한다. 노드 i 에 대해
//   com[3i..3i+2] : 질량중심,  mass[i] : 총질량,  size[i] : 변 길이
//   child[8i..8i+7] : 자식 노드 인덱스 (-1 = 없음)
//   body[i] : 잎 노드가 담고 있는 입자 인덱스 (-1 = 내부 노드)

export class BarnesHut {
  constructor(capacity = 4096) {
    this.alloc(capacity);
    this.theta = 0.5;
  }

  alloc(cap) {
    this.cap = cap;
    this.com = new Float64Array(cap * 3);
    this.mass = new Float64Array(cap);
    this.size = new Float64Array(cap);
    this.min = new Float64Array(cap * 3);
    this.child = new Int32Array(cap * 8).fill(-1);
    this.body = new Int32Array(cap).fill(-1);
  }

  grow() {
    const old = {
      com: this.com, mass: this.mass, size: this.size,
      min: this.min, child: this.child, body: this.body, cap: this.cap,
    };
    this.alloc(this.cap * 2);
    this.com.set(old.com); this.mass.set(old.mass);
    this.size.set(old.size); this.min.set(old.min);
    this.child.set(old.child); this.body.set(old.body);
    this.child.fill(-1, old.cap * 8);
    this.body.fill(-1, old.cap);
  }

  newNode(minx, miny, minz, size) {
    if (this.n >= this.cap) this.grow();
    const i = this.n++;
    const c3 = i * 3;
    this.com[c3] = this.com[c3 + 1] = this.com[c3 + 2] = 0;
    this.mass[i] = 0;
    this.size[i] = size;
    this.min[c3] = minx; this.min[c3 + 1] = miny; this.min[c3 + 2] = minz;
    this.child.fill(-1, i * 8, i * 8 + 8);
    this.body[i] = -1;
    return i;
  }

  /** 활성 입자로부터 트리를 재구성 */
  build(pos, mass, count, active) {
    let lo = Infinity, hi = -Infinity;
    for (let p = 0; p < count; p++) {
      if (active && !active[p]) continue;
      for (let k = 0; k < 3; k++) {
        const v = pos[p * 3 + k];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!isFinite(lo)) { this.n = 0; return; }
    const size = Math.max(hi - lo, 1e-9) * 1.0001;
    this.n = 0;
    const root = this.newNode(lo, lo, lo, size);

    for (let p = 0; p < count; p++) {
      if (active && !active[p]) continue;
      this.insert(root, p, pos, mass);
    }
    this.summarize(root, pos, mass);
  }

  insert(node, p, pos, mass) {
    let cur = node;
    for (let depth = 0; depth < 64; depth++) {
      if (this.body[cur] === -1 && this.child[cur * 8] === -1 && this.mass[cur] === 0) {
        // 빈 잎
        this.body[cur] = p;
        this.mass[cur] = mass[p];
        this.com[cur * 3] = pos[p * 3];
        this.com[cur * 3 + 1] = pos[p * 3 + 1];
        this.com[cur * 3 + 2] = pos[p * 3 + 2];
        return;
      }
      if (this.body[cur] !== -1) {
        // 점유된 잎 → 분할
        const q = this.body[cur];
        this.body[cur] = -1;
        if (this.sameCell(cur, q, p, pos)) {
          // 수치적으로 동일 위치 — 합쳐서 질량만 누적 (무한 분할 방지)
          this.mass[cur] += mass[p];
          return;
        }
        this.pushChild(cur, q, pos, mass);
      }
      const oct = this.octant(cur, p, pos);
      let c = this.child[cur * 8 + oct];
      if (c === -1) c = this.makeChild(cur, oct);
      cur = c;
    }
  }

  sameCell(node, a, b, pos) {
    const s = this.size[node] * 1e-12;
    return Math.abs(pos[a * 3] - pos[b * 3]) < s
      && Math.abs(pos[a * 3 + 1] - pos[b * 3 + 1]) < s
      && Math.abs(pos[a * 3 + 2] - pos[b * 3 + 2]) < s;
  }

  pushChild(node, p, pos, mass) {
    const oct = this.octant(node, p, pos);
    let c = this.child[node * 8 + oct];
    if (c === -1) c = this.makeChild(node, oct);
    this.insert(c, p, pos, mass);
  }

  makeChild(node, oct) {
    const h = this.size[node] / 2;
    const m3 = node * 3;
    const c = this.newNode(
      this.min[m3] + (oct & 1 ? h : 0),
      this.min[m3 + 1] + (oct & 2 ? h : 0),
      this.min[m3 + 2] + (oct & 4 ? h : 0),
      h,
    );
    this.child[node * 8 + oct] = c;
    return c;
  }

  octant(node, p, pos) {
    const h = this.size[node] / 2, m3 = node * 3;
    return (pos[p * 3] - this.min[m3] >= h ? 1 : 0)
      | (pos[p * 3 + 1] - this.min[m3 + 1] >= h ? 2 : 0)
      | (pos[p * 3 + 2] - this.min[m3 + 2] >= h ? 4 : 0);
  }

  summarize(node, pos, mass) {
    if (this.body[node] !== -1) return;
    let m = 0, cx = 0, cy = 0, cz = 0;
    let hasChild = false;
    for (let k = 0; k < 8; k++) {
      const c = this.child[node * 8 + k];
      if (c === -1) continue;
      hasChild = true;
      this.summarize(c, pos, mass);
      const mc = this.mass[c];
      m += mc;
      cx += this.com[c * 3] * mc;
      cy += this.com[c * 3 + 1] * mc;
      cz += this.com[c * 3 + 2] * mc;
    }
    if (!hasChild) return;
    this.mass[node] = m;
    if (m > 0) {
      this.com[node * 3] = cx / m;
      this.com[node * 3 + 1] = cy / m;
      this.com[node * 3 + 2] = cz / m;
    }
  }

  /** 입자 p 에 대한 중력가속도 누적 (out 에 += ) */
  accel(p, pos, G, eps2, out) {
    if (this.n === 0) return;
    const px = pos[p * 3], py = pos[p * 3 + 1], pz = pos[p * 3 + 2];
    const theta2 = this.theta * this.theta;
    const stack = this._stack || (this._stack = new Int32Array(4096));
    let sp = 0;
    stack[sp++] = 0;
    let ax = 0, ay = 0, az = 0;

    while (sp > 0) {
      const node = stack[--sp];
      const m = this.mass[node];
      if (m === 0) continue;
      const n3 = node * 3;
      const dx = this.com[n3] - px;
      const dy = this.com[n3 + 1] - py;
      const dz = this.com[n3 + 2] - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const s = this.size[node];

      if (this.body[node] === p) continue;
      if (this.body[node] !== -1 || s * s < theta2 * d2) {
        const r2 = d2 + eps2;
        if (r2 < 1e-24) continue;
        const inv = G * m / (r2 * Math.sqrt(r2));
        ax += dx * inv; ay += dy * inv; az += dz * inv;
      } else {
        for (let k = 0; k < 8; k++) {
          const c = this.child[node * 8 + k];
          if (c !== -1) {
            if (sp >= stack.length) break;
            stack[sp++] = c;
          }
        }
      }
    }
    out[p * 3] += ax; out[p * 3 + 1] += ay; out[p * 3 + 2] += az;
  }
}
