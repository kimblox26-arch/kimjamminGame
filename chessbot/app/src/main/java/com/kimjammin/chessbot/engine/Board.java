package com.kimjammin.chessbot.engine;

import java.util.Random;

/**
 * 0x88 체스 보드. 흰 말은 양수, 검은 말은 음수 (P=1 N=2 B=3 R=4 Q=5 K=6).
 * 수(move) 인코딩: from | to<<7 | promo<<14 | flags<<17
 * flags: 1=잡기, 2=앙파상, 4=캐슬링, 8=폰 2칸 전진
 */
public final class Board {
    public static final int P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
    public static final int F_CAP = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8;
    static final int[] N_OFF = {33, 31, 18, 14, -33, -31, -18, -14};
    static final int[] K_OFF = {1, -1, 16, -16, 15, 17, -15, -17};
    static final int[] B_OFF = {15, 17, -15, -17};
    static final int[] R_OFF = {1, -1, 16, -16};

    static final long[][] Z = new long[13][128];
    static final long[] Z_CASTLE = new long[16];
    static final long[] Z_EP = new long[128];
    static final long Z_SIDE;
    static final int[] CM = new int[128];

    static {
        Random r = new Random(20261107L); // 고정 시드 → 실행마다 같은 해시 (패턴 학습 저장용)
        for (long[] a : Z) for (int i = 0; i < 128; i++) a[i] = r.nextLong();
        for (int i = 0; i < 16; i++) Z_CASTLE[i] = r.nextLong();
        for (int i = 0; i < 128; i++) Z_EP[i] = r.nextLong();
        Z_SIDE = r.nextLong();
        for (int i = 0; i < 128; i++) CM[i] = 15;
        CM[0] = ~2 & 15; CM[7] = ~1 & 15; CM[4] = ~3 & 15;
        CM[112] = ~8 & 15; CM[119] = ~4 & 15; CM[116] = ~12 & 15;
    }

    public final int[] sq = new int[128];
    public int side = 1, castle, ep = -1, half, fullmove = 1, wk, bk;
    public long hash;

    final long[] hist = new long[4096];
    int hp;
    private final int[] uCap = new int[4096], uCastle = new int[4096], uEp = new int[4096],
            uHalf = new int[4096], uMove = new int[4096];
    private final long[] uHash = new long[4096];
    private int up;

    public static final String START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    public Board() { setFen(START); }

    public Board copy() {
        Board b = new Board();
        System.arraycopy(sq, 0, b.sq, 0, 128);
        b.side = side; b.castle = castle; b.ep = ep; b.half = half; b.fullmove = fullmove;
        b.wk = wk; b.bk = bk; b.hash = hash;
        System.arraycopy(hist, 0, b.hist, 0, hp);
        b.hp = hp;
        return b;
    }

    public static int from(int m) { return m & 0x7F; }
    public static int to(int m) { return (m >>> 7) & 0x7F; }
    public static int promo(int m) { return (m >>> 14) & 7; }
    public static int flags(int m) { return m >>> 17; }
    static int mv(int f, int t, int pr, int fl) { return f | (t << 7) | (pr << 14) | (fl << 17); }

    public void setFen(String fen) {
        java.util.Arrays.fill(sq, 0);
        String[] p = fen.trim().split("\\s+");
        int r = 7, f = 0;
        for (char c : p[0].toCharArray()) {
            if (c == '/') { r--; f = 0; continue; }
            if (Character.isDigit(c)) { f += c - '0'; continue; }
            int t = "pnbrqk".indexOf(Character.toLowerCase(c)) + 1;
            int s = r * 16 + f;
            sq[s] = Character.isUpperCase(c) ? t : -t;
            if (sq[s] == K) wk = s; else if (sq[s] == -K) bk = s;
            f++;
        }
        side = p.length > 1 && p[1].equals("b") ? -1 : 1;
        castle = 0;
        if (p.length > 2) {
            if (p[2].contains("K")) castle |= 1;
            if (p[2].contains("Q")) castle |= 2;
            if (p[2].contains("k")) castle |= 4;
            if (p[2].contains("q")) castle |= 8;
        }
        ep = (p.length > 3 && !p[3].equals("-")) ? sqIndex(p[3]) : -1;
        half = p.length > 4 ? Integer.parseInt(p[4]) : 0;
        fullmove = p.length > 5 ? Integer.parseInt(p[5]) : 1;
        hash = computeHash();
        hp = 0; up = 0;
        hist[hp++] = hash;
    }

    long computeHash() {
        long h = 0;
        for (int s = 0; s < 128; s++) if ((s & 0x88) == 0 && sq[s] != 0) h ^= Z[sq[s] + 6][s];
        h ^= Z_CASTLE[castle];
        if (ep >= 0) h ^= Z_EP[ep];
        if (side == -1) h ^= Z_SIDE;
        return h;
    }

    public static int sqIndex(String s) { return (s.charAt(1) - '1') * 16 + (s.charAt(0) - 'a'); }
    public static String sqName(int s) { return "" + (char) ('a' + (s & 7)) + (char) ('1' + (s >> 4)); }

    public static String uci(int m) {
        if (m == 0) return "-";
        String s = sqName(from(m)) + sqName(to(m));
        return promo(m) != 0 ? s + " nbrq".charAt(promo(m) - 1) : s;
    }

    /** sq가 bySide(1/-1)에 의해 공격받는가 */
    public boolean attacked(int s, int by) {
        int pawn = by * P;
        if (by == 1) {
            if (((s - 15) & 0x88) == 0 && sq[s - 15] == pawn) return true;
            if (((s - 17) & 0x88) == 0 && sq[s - 17] == pawn) return true;
        } else {
            if (((s + 15) & 0x88) == 0 && sq[s + 15] == pawn) return true;
            if (((s + 17) & 0x88) == 0 && sq[s + 17] == pawn) return true;
        }
        for (int o : N_OFF) { int t = s + o; if ((t & 0x88) == 0 && sq[t] == by * N) return true; }
        for (int o : K_OFF) { int t = s + o; if ((t & 0x88) == 0 && sq[t] == by * K) return true; }
        for (int o : B_OFF) {
            int t = s + o;
            while ((t & 0x88) == 0) {
                int pc = sq[t];
                if (pc != 0) { if (pc == by * B || pc == by * Q) return true; break; }
                t += o;
            }
        }
        for (int o : R_OFF) {
            int t = s + o;
            while ((t & 0x88) == 0) {
                int pc = sq[t];
                if (pc != 0) { if (pc == by * R || pc == by * Q) return true; break; }
                t += o;
            }
        }
        return false;
    }

    public boolean inCheck() { return attacked(side == 1 ? wk : bk, -side); }

    /** 방금 수를 둔 쪽의 킹이 공격받는가 (불법수 판정) */
    public boolean leftInCheck() { return attacked(side == 1 ? bk : wk, side); }

    /** 의사합법수 생성. capturesOnly면 잡기 + 퀸 승격만. */
    public int gen(int[] out, boolean capturesOnly) {
        int n = 0, us = side;
        for (int f = 0; f < 128; f++) {
            if ((f & 0x88) != 0) { f += 7; continue; }
            int pc = sq[f];
            if (pc == 0 || (pc > 0) != (us > 0)) continue;
            int t = pc * us;
            if (t == P) {
                int dir = 16 * us, to = f + dir, rank = to >> 4;
                boolean promoRank = rank == (us == 1 ? 7 : 0);
                if ((to & 0x88) == 0 && sq[to] == 0) {
                    if (promoRank) {
                        out[n++] = mv(f, to, Q, 0);
                        if (!capturesOnly) { out[n++] = mv(f, to, N, 0); out[n++] = mv(f, to, R, 0); out[n++] = mv(f, to, B, 0); }
                    } else if (!capturesOnly) {
                        out[n++] = mv(f, to, 0, 0);
                        int to2 = to + dir;
                        if ((f >> 4) == (us == 1 ? 1 : 6) && sq[to2] == 0) out[n++] = mv(f, to2, 0, F_DOUBLE);
                    }
                }
                for (int d = -1; d <= 1; d += 2) {
                    int c = to + d;
                    if ((c & 0x88) != 0) continue;
                    int v = sq[c];
                    if (v != 0 && (v > 0) != (us > 0)) {
                        if (promoRank) {
                            out[n++] = mv(f, c, Q, F_CAP);
                            if (!capturesOnly) { out[n++] = mv(f, c, N, F_CAP); out[n++] = mv(f, c, R, F_CAP); out[n++] = mv(f, c, B, F_CAP); }
                        } else out[n++] = mv(f, c, 0, F_CAP);
                    } else if (c == ep) out[n++] = mv(f, c, 0, F_CAP | F_EP);
                }
            } else if (t == N || t == K) {
                for (int o : (t == N ? N_OFF : K_OFF)) {
                    int to = f + o;
                    if ((to & 0x88) != 0) continue;
                    int v = sq[to];
                    if (v == 0) { if (!capturesOnly) out[n++] = mv(f, to, 0, 0); }
                    else if ((v > 0) != (us > 0)) out[n++] = mv(f, to, 0, F_CAP);
                }
                if (t == K && !capturesOnly) n = genCastle(out, n);
            } else {
                int[] offs = t == B ? B_OFF : t == R ? R_OFF : K_OFF;
                for (int o : offs) {
                    int to = f + o;
                    while ((to & 0x88) == 0) {
                        int v = sq[to];
                        if (v == 0) { if (!capturesOnly) out[n++] = mv(f, to, 0, 0); }
                        else { if ((v > 0) != (us > 0)) out[n++] = mv(f, to, 0, F_CAP); break; }
                        to += o;
                    }
                }
            }
        }
        return n;
    }

    private int genCastle(int[] out, int n) {
        if (side == 1) {
            if ((castle & 1) != 0 && sq[5] == 0 && sq[6] == 0 && sq[7] == R
                    && !attacked(4, -1) && !attacked(5, -1) && !attacked(6, -1)) out[n++] = mv(4, 6, 0, F_CASTLE);
            if ((castle & 2) != 0 && sq[3] == 0 && sq[2] == 0 && sq[1] == 0 && sq[0] == R
                    && !attacked(4, -1) && !attacked(3, -1) && !attacked(2, -1)) out[n++] = mv(4, 2, 0, F_CASTLE);
        } else {
            if ((castle & 4) != 0 && sq[117] == 0 && sq[118] == 0 && sq[119] == -R
                    && !attacked(116, 1) && !attacked(117, 1) && !attacked(118, 1)) out[n++] = mv(116, 118, 0, F_CASTLE);
            if ((castle & 8) != 0 && sq[115] == 0 && sq[114] == 0 && sq[113] == 0 && sq[112] == -R
                    && !attacked(116, 1) && !attacked(115, 1) && !attacked(114, 1)) out[n++] = mv(116, 114, 0, F_CASTLE);
        }
        return n;
    }

    public void make(int m) {
        int f = from(m), t = to(m), pr = promo(m), fl = flags(m);
        int pc = sq[f], cap = sq[t], u = up++;
        uCap[u] = cap; uCastle[u] = castle; uEp[u] = ep; uHalf[u] = half; uHash[u] = hash; uMove[u] = m;
        long h = hash;
        if (ep >= 0) h ^= Z_EP[ep];
        h ^= Z_CASTLE[castle] ^ Z[pc + 6][f];
        sq[f] = 0;
        if (cap != 0) h ^= Z[cap + 6][t];
        if ((fl & F_EP) != 0) {
            int cs = t - 16 * side;
            h ^= Z[-side * P + 6][cs];
            sq[cs] = 0;
        }
        int np = pr != 0 ? pr * side : pc;
        sq[t] = np;
        h ^= Z[np + 6][t];
        if ((fl & F_CASTLE) != 0) {
            int rf = t > f ? f + 3 : f - 4, rt = t > f ? f + 1 : f - 1, rk = sq[rf];
            sq[rf] = 0; sq[rt] = rk;
            h ^= Z[rk + 6][rf] ^ Z[rk + 6][rt];
        }
        if (pc == K) wk = t; else if (pc == -K) bk = t;
        castle &= CM[f] & CM[t];
        h ^= Z_CASTLE[castle];
        ep = -1;
        if ((fl & F_DOUBLE) != 0) { ep = f + 16 * side; h ^= Z_EP[ep]; }
        half = (pc == P || pc == -P || cap != 0) ? 0 : half + 1;
        if (side == -1) fullmove++;
        side = -side;
        hash = h ^ Z_SIDE;
        hist[hp++] = hash;
    }

    public void unmake() {
        int u = --up, m = uMove[u];
        hp--;
        side = -side;
        if (side == -1) fullmove--;
        int f = from(m), t = to(m), fl = flags(m);
        int pc = promo(m) != 0 ? P * side : sq[t];
        sq[f] = pc;
        if ((fl & F_EP) != 0) { sq[t] = 0; sq[t - 16 * side] = -side * P; }
        else sq[t] = uCap[u];
        if ((fl & F_CASTLE) != 0) {
            int rf = t > f ? f + 3 : f - 4, rt = t > f ? f + 1 : f - 1;
            sq[rf] = sq[rt]; sq[rt] = 0;
        }
        if (pc == K) wk = f; else if (pc == -K) bk = f;
        castle = uCastle[u]; ep = uEp[u]; half = uHalf[u]; hash = uHash[u];
    }

    public void makeNull() {
        uEp[up] = ep; uHash[up] = hash; uMove[up] = 0; up++;
        long h = hash;
        if (ep >= 0) h ^= Z_EP[ep];
        ep = -1; side = -side;
        hash = h ^ Z_SIDE;
        hist[hp++] = hash;
    }

    public void unmakeNull() {
        up--; hp--;
        side = -side; ep = uEp[up]; hash = uHash[up];
    }

    /** 합법수 목록 */
    public int legal(int[] out) {
        int[] tmp = new int[256];
        int n = gen(tmp, false), k = 0;
        for (int i = 0; i < n; i++) {
            make(tmp[i]);
            if (!leftInCheck()) out[k++] = tmp[i];
            unmake();
        }
        return k;
    }

    public boolean isLegal(int m) {
        int[] l = new int[256];
        int n = legal(l);
        for (int i = 0; i < n; i++) if (l[i] == m) return true;
        return false;
    }

    /** 탐색용: 이전 동일 국면이 있으면 true */
    public boolean isRepetition() {
        for (int i = hp - 3; i >= 0 && i >= hp - 1 - half; i -= 2) if (hist[i] == hash) return true;
        return false;
    }

    public int repetitionCount() {
        int c = 0;
        for (int i = hp - 1; i >= 0 && i >= hp - 1 - half; i -= 2) if (hist[i] == hash) c++;
        return c;
    }

    public boolean insufficient() {
        int minors = 0;
        for (int s = 0; s < 128; s++) {
            if ((s & 0x88) != 0) { s += 7; continue; }
            int t = Math.abs(sq[s]);
            if (t == P || t == R || t == Q) return false;
            if (t == N || t == B) minors++;
        }
        return minors <= 1;
    }

    public boolean hasNonPawn(int s) {
        for (int i = 0; i < 128; i++) {
            if ((i & 0x88) != 0) { i += 7; continue; }
            int v = sq[i] * s;
            if (v > P && v < K) return true;
        }
        return false;
    }

    public int moveCount() { return up; }
}
