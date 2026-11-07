package com.kimjammin.chessbot.engine;

import static com.kimjammin.chessbot.engine.Board.*;

/**
 * 연습 상대 AI. 국면마다 '습관'이 정해져 있어(시드 기반) 같은 국면에선 대체로 같은 수를 둔다.
 * → 봇이 패턴을 학습하고 공략할 수 있다. style: 1=공격형, 2=수비형, 3=균형형
 */
public final class SparringAI {
    private final Search search = new Search();
    private final java.util.Random rnd = new java.util.Random();
    public final int style;
    private final long seed;

    public SparringAI(int style) {
        this.style = style;
        this.seed = 0x5EEDL * (style + 7);
    }

    public int choose(Board b) {
        int[] legal = new int[256];
        int n = b.legal(legal);
        if (n == 0) return 0;
        int best = legal[0], bestScore = Integer.MIN_VALUE;
        for (int i = 0; i < n; i++) {
            int m = legal[i];
            int dir = ((to(m) >> 4) - (from(m) >> 4)) * b.side;
            boolean cap = (flags(m) & F_CAP) != 0;
            b.make(m);
            int s = -search.quickScore(b);
            boolean check = b.inCheck();
            long h = (b.hash ^ seed) * 0x9E3779B97F4A7C15L;
            b.unmake();
            s += (int) ((h >>> 40) % 90); // 국면별 고정 습관 (실수 포함)
            if (style == 1) s += (cap ? 35 : 0) + (check ? 45 : 0) + (dir > 0 ? 10 : 0);
            else if (style == 2) s += (dir < 0 ? 25 : 0) - (cap ? 10 : 0);
            if (rnd.nextInt(100) < 8) s += rnd.nextInt(60); // 가끔 변칙
            if (s > bestScore) { bestScore = s; best = m; }
        }
        return best;
    }
}
