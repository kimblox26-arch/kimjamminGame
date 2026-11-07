package com.kimjammin.chessbot.engine;

import static com.kimjammin.chessbot.engine.Board.*;

/**
 * 반복 심화 + PVS 알파-베타 + 치환표 + 정지 탐색 + 널무브/LMR/퓨틸리티 가지치기.
 * 탐색이 끝나면 상대 패턴 모델로 "상대가 습관적으로 실수하는 수순"을 추가로 노린다.
 */
public final class Search {
    public static final int INF = 1_000_000, MATE = 900_000;
    static final int MAXPLY = 96;
    static final int TT_BITS = 19, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
    static final byte EXACT = 0, LOWER = 1, UPPER = 2;

    public static final class Result {
        public int move, score, depth, predicted;
        public long nodes;
        public boolean exploited;
    }

    public interface Progress { void onIteration(int depth, int score, int move, long nodes); }

    private final long[] ttKey = new long[TT_SIZE];
    private final int[] ttMove = new int[TT_SIZE], ttScore = new int[TT_SIZE];
    private final byte[] ttDepth = new byte[TT_SIZE], ttFlag = new byte[TT_SIZE];
    private final int[][] killers = new int[MAXPLY][2];
    private final int[] history = new int[128 * 128];
    private final int[][] moveBuf = new int[MAXPLY][256], scoreBuf = new int[MAXPLY][256];
    private final Eval ev = new Eval();

    private Board b;
    private long deadline, nodes;
    private boolean stop;
    private int rootBest, rootScore;
    public volatile boolean abort;

    /** 치환표 초기화 (새 게임) */
    public void clear() {
        java.util.Arrays.fill(ttKey, 0);
        java.util.Arrays.fill(history, 0);
    }

    public Result think(Board board, long timeMs, int maxDepth, OpponentModel model, Progress cb) {
        b = board;
        abort = false;
        stop = false;
        nodes = 0;
        long start = System.currentTimeMillis();
        deadline = start + timeMs;
        for (int[] k : killers) { k[0] = 0; k[1] = 0; }
        for (int i = 0; i < history.length; i++) history[i] >>= 2;

        Result res = new Result();
        int[] legal = new int[256];
        int nLegal = b.legal(legal);
        if (nLegal == 0) return res;
        res.move = legal[0];
        if (nLegal == 1) { res.score = ev.eval(b); res.depth = 1; return res; }

        for (int d = 1; d <= maxDepth; d++) {
            rootBest = 0;
            int s = search(d, -INF, INF, 0, true);
            if (rootBest != 0) { res.move = rootBest; res.score = stop ? Math.max(res.score, rootScore) : s; }
            if (stop) break;
            res.depth = d;
            if (cb != null) cb.onIteration(d, s, res.move, nodes);
            if (Math.abs(s) > MATE - 200) break; // 메이트 발견 → 즉시 둔다
            // 다음 반복이 시간 안에 끝나지 않을 것 같으면 중단
            if (System.currentTimeMillis() - start > timeMs * 0.55) break;
        }
        res.nodes = nodes;
        if (model != null && !abort) exploit(res, model, legal, nLegal);
        return res;
    }

    /** 상대 패턴 공략: 상대가 자주 두는 응수가 실수라면 그 수순을 유도한다 */
    private void exploit(Result res, OpponentModel model, int[] legal, int n) {
        if (Math.abs(res.score) > MATE - 200 || res.depth < 3) return;
        int d = Math.min(res.depth - 1, 5);
        deadline = System.currentTimeMillis() + 600;
        stop = false;
        int bestGain = 60, bestMove = 0, bestPred = 0;
        b.make(res.move);
        res.predicted = model.predict(b);
        b.unmake();
        for (int i = 0; i < n && !stop; i++) {
            int m = legal[i];
            b.make(m);
            int pred = model.predictConfident(b);
            if (pred != 0) {
                int normal = -search(d - 1, -INF, INF, 1, true);
                if (!stop && normal >= res.score - 40) {
                    b.make(pred);
                    int after = search(d - 1, -INF, INF, 2, true);
                    b.unmake();
                    int gain = after - res.score;
                    if (!stop && gain > bestGain) { bestGain = gain; bestMove = m; bestPred = pred; }
                }
            }
            b.unmake();
        }
        if (bestMove != 0 && bestMove != res.move) {
            res.move = bestMove;
            res.predicted = bestPred;
            res.exploited = true;
        }
    }

    private boolean timeUp() {
        if ((++nodes & 2047) == 0 && (abort || System.currentTimeMillis() > deadline)) stop = true;
        return stop;
    }

    private int search(int depth, int alpha, int beta, int ply, boolean nullOk) {
        if (timeUp()) return 0;
        boolean pv = beta - alpha > 1;
        if (ply > 0) {
            if (b.half >= 100 || b.isRepetition() || b.insufficient()) return 0;
            alpha = Math.max(alpha, -MATE + ply);
            beta = Math.min(beta, MATE - ply - 1);
            if (alpha >= beta) return alpha;
        }
        if (ply >= MAXPLY - 2) return ev.eval(b);
        boolean inCheck = b.inCheck();
        if (inCheck) depth++;
        if (depth <= 0) return qsearch(alpha, beta, ply);

        int idx = (int) (b.hash & TT_MASK), hashMove = 0;
        if (ttKey[idx] == b.hash) {
            hashMove = ttMove[idx];
            if (ply > 0 && !pv && ttDepth[idx] >= depth) {
                int s = fromTT(ttScore[idx], ply), fl = ttFlag[idx];
                if (fl == EXACT || (fl == LOWER && s >= beta) || (fl == UPPER && s <= alpha)) return s;
            }
        }

        int stat = inCheck ? -INF : ev.eval(b);
        if (!pv && !inCheck && depth <= 3 && Math.abs(beta) < MATE - 500 && stat - 110 * depth >= beta)
            return stat - 110 * depth;
        if (nullOk && !pv && !inCheck && depth >= 3 && stat >= beta && b.hasNonPawn(b.side)) {
            b.makeNull();
            int s = -search(depth - 1 - (2 + depth / 4), -beta, -beta + 1, ply + 1, false);
            b.unmakeNull();
            if (stop) return 0;
            if (s >= beta) return s >= MATE - 500 ? beta : s;
        }

        int[] mv = moveBuf[ply], sc = scoreBuf[ply];
        int n = b.gen(mv, false);
        for (int i = 0; i < n; i++) sc[i] = order(mv[i], hashMove, ply);

        int best = -INF, bestMove = 0, legal = 0, origAlpha = alpha;
        for (int i = 0; i < n; i++) {
            pick(mv, sc, i, n);
            int m = mv[i];
            boolean quiet = (flags(m) & F_CAP) == 0 && promo(m) == 0;
            b.make(m);
            if (b.leftInCheck()) { b.unmake(); continue; }
            legal++;
            boolean givesCheck = b.inCheck();
            if (!pv && !inCheck && quiet && !givesCheck && legal > 1 && depth <= 2
                    && stat + 140 * depth <= alpha) { b.unmake(); continue; }
            int s;
            if (legal == 1) s = -search(depth - 1, -beta, -alpha, ply + 1, true);
            else {
                int r = 0;
                if (depth >= 3 && quiet && legal > 3 && !inCheck && !givesCheck) {
                    r = 1 + (legal > 8 ? 1 : 0) + (depth > 6 ? 1 : 0);
                    if (pv) r--;
                }
                s = -search(depth - 1 - r, -alpha - 1, -alpha, ply + 1, true);
                if (s > alpha && r > 0) s = -search(depth - 1, -alpha - 1, -alpha, ply + 1, true);
                if (s > alpha && s < beta) s = -search(depth - 1, -beta, -alpha, ply + 1, true);
            }
            b.unmake();
            if (stop) return 0;
            if (s > best) {
                best = s;
                bestMove = m;
                if (ply == 0) { rootBest = m; rootScore = s; }
                if (s > alpha) {
                    alpha = s;
                    if (s >= beta) {
                        if (quiet) {
                            if (killers[ply][0] != m) { killers[ply][1] = killers[ply][0]; killers[ply][0] = m; }
                            int h = from(m) * 128 + to(m);
                            history[h] = Math.min(history[h] + depth * depth, 60000);
                        }
                        break;
                    }
                }
            }
        }
        if (legal == 0) return inCheck ? -MATE + ply : 0;

        ttKey[idx] = b.hash;
        ttMove[idx] = bestMove;
        ttScore[idx] = toTT(best, ply);
        ttDepth[idx] = (byte) Math.min(depth, 127);
        ttFlag[idx] = best >= beta ? LOWER : best > origAlpha ? EXACT : UPPER;
        return best;
    }

    /** 잡는 수만 보는 정지 탐색 (수평선 효과 방지) */
    public int qsearch(int alpha, int beta, int ply) {
        if (timeUp()) return 0;
        int stand = ev.eval(b);
        if (ply >= MAXPLY - 2 || stand >= beta) return stand;
        if (stand > alpha) alpha = stand;
        int[] mv = moveBuf[ply], sc = scoreBuf[ply];
        int n = b.gen(mv, true);
        for (int i = 0; i < n; i++) sc[i] = order(mv[i], 0, ply);
        for (int i = 0; i < n; i++) {
            pick(mv, sc, i, n);
            int m = mv[i];
            int victim = (flags(m) & F_EP) != 0 ? P : Math.abs(b.sq[to(m)]);
            if (promo(m) == 0 && stand + Eval.VAL[victim] + 200 < alpha) continue;
            b.make(m);
            if (b.leftInCheck()) { b.unmake(); continue; }
            int s = -qsearch(-beta, -alpha, ply + 1);
            b.unmake();
            if (stop) return 0;
            if (s >= beta) return s;
            if (s > alpha) alpha = s;
        }
        return alpha;
    }

    /** 외부용: 주어진 보드를 얕게 평가 (스파링 AI) */
    public int quickScore(Board board) {
        b = board;
        stop = false;
        deadline = Long.MAX_VALUE;
        return qsearch(-INF, INF, 0);
    }

    private int order(int m, int hashMove, int ply) {
        if (m == hashMove) return 2_000_000;
        int fl = flags(m);
        if ((fl & F_CAP) != 0) {
            int victim = (fl & F_EP) != 0 ? P : Math.abs(b.sq[to(m)]);
            int attacker = Math.abs(b.sq[from(m)]);
            return 1_000_000 + victim * 100 - attacker + (promo(m) == Q ? 500 : 0);
        }
        if (promo(m) == Q) return 950_000;
        if (killers[ply][0] == m) return 900_000;
        if (killers[ply][1] == m) return 890_000;
        return history[from(m) * 128 + to(m)];
    }

    private static void pick(int[] mv, int[] sc, int i, int n) {
        int bi = i;
        for (int j = i + 1; j < n; j++) if (sc[j] > sc[bi]) bi = j;
        if (bi != i) {
            int t = mv[i]; mv[i] = mv[bi]; mv[bi] = t;
            t = sc[i]; sc[i] = sc[bi]; sc[bi] = t;
        }
    }

    private static int toTT(int s, int ply) { return s > MATE - 500 ? s + ply : s < -MATE + 500 ? s - ply : s; }
    private static int fromTT(int s, int ply) { return s > MATE - 500 ? s - ply : s < -MATE + 500 ? s + ply : s; }
}
