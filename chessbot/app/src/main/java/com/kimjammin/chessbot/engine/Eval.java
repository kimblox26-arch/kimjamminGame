package com.kimjammin.chessbot.engine;

import static com.kimjammin.chessbot.engine.Board.*;

/** 정적 평가: 재료 + 위치표(중반/종반 보간) + 폰 구조 + 룩 열린 줄 + 킹 안전 + 종반 몰이(빠른 체크메이트) */
public final class Eval {
    public static final int[] VAL = {0, 100, 320, 330, 500, 900, 0};

    // 8랭크부터 위→아래 (흰 기준)
    static final int[] PAWN = {
            0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10,
            5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5,
            5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0};
    static final int[] KNIGHT = {
            -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30,
            -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30,
            -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50};
    static final int[] BISHOP = {
            -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10,
            -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10,
            -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20};
    static final int[] ROOK = {
            0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5,
            -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
            -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0};
    static final int[] QUEEN = {
            -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10,
            -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10,
            -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20};
    static final int[] KING_MG = {
            -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
            -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
            -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10,
            20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20};
    static final int[] KING_EG = {
            -50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30,
            -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
            -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30,
            -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50};
    static final int[][] PST = {null, PAWN, KNIGHT, BISHOP, ROOK, QUEEN};
    static final int[] PASSED = {0, 5, 10, 20, 35, 60, 100, 0};
    static final int[] PHASE = {0, 0, 1, 1, 2, 4, 0};

    /** 둘 차례 기준 점수 (센티폰) */
    private final int[] wCnt = new int[8], bCnt = new int[8], wMinRank = new int[8], bMaxRank = new int[8],
            wMaxRank = new int[8], bMinRank = new int[8];

    public int eval(Board b) {
        int[] sq = b.sq;
        for (int i = 0; i < 8; i++) {
            wCnt[i] = 0; bCnt[i] = 0; wMinRank[i] = 8; bMaxRank[i] = -1; wMaxRank[i] = -1; bMinRank[i] = 8;
        }
        int phase = 0, mat = 0, pst = 0, wB = 0, bB = 0, wMat = 0, bMat = 0;
        for (int s = 0; s < 128; s++) {
            if ((s & 0x88) != 0) { s += 7; continue; }
            int pc = sq[s];
            if (pc == 0) continue;
            int t = Math.abs(pc), r = s >> 4, f = s & 7;
            phase += PHASE[t];
            if (pc > 0) {
                mat += VAL[t]; if (t != P) wMat += VAL[t];
                if (t != K) pst += PST[t][(7 - r) * 8 + f];
                if (t == P) { wCnt[f]++; wMinRank[f] = Math.min(wMinRank[f], r); wMaxRank[f] = Math.max(wMaxRank[f], r); }
                if (t == B) wB++;
            } else {
                mat -= VAL[t]; if (t != P) bMat += VAL[t];
                if (t != K) pst -= PST[t][r * 8 + f];
                if (t == P) { bCnt[f]++; bMaxRank[f] = Math.max(bMaxRank[f], r); bMinRank[f] = Math.min(bMinRank[f], r); }
                if (t == B) bB++;
            }
        }
        if (phase > 24) phase = 24;
        int mg = 0, eg = 0;
        // 킹 위치표
        int wkr = b.wk >> 4, wkf = b.wk & 7, bkr = b.bk >> 4, bkf = b.bk & 7;
        mg += KING_MG[(7 - wkr) * 8 + wkf] - KING_MG[bkr * 8 + bkf];
        eg += KING_EG[(7 - wkr) * 8 + wkf] - KING_EG[bkr * 8 + bkf];

        int score = mat + pst;
        if (wB >= 2) score += 30;
        if (bB >= 2) score -= 30;

        // 폰 구조
        for (int f = 0; f < 8; f++) {
            if (wCnt[f] > 1) score -= 15 * (wCnt[f] - 1);
            if (bCnt[f] > 1) score += 15 * (bCnt[f] - 1);
            boolean wIso = wCnt[f] > 0 && (f == 0 || wCnt[f - 1] == 0) && (f == 7 || wCnt[f + 1] == 0);
            boolean bIso = bCnt[f] > 0 && (f == 0 || bCnt[f - 1] == 0) && (f == 7 || bCnt[f + 1] == 0);
            if (wIso) score -= 12;
            if (bIso) score += 12;
            // 통과한 폰 (가장 앞선 폰 기준)
            if (wCnt[f] > 0) {
                int r = wMaxRank[f];
                boolean passed = true;
                for (int d = -1; d <= 1 && passed; d++) {
                    int ff = f + d;
                    if (ff >= 0 && ff < 8 && bCnt[ff] > 0 && bMaxRank[ff] > r) passed = false;
                }
                if (passed) { mg += PASSED[r] / 2; eg += PASSED[r] * 2; }
            }
            if (bCnt[f] > 0) {
                int r = bMinRank[f];
                boolean passed = true;
                for (int d = -1; d <= 1 && passed; d++) {
                    int ff = f + d;
                    if (ff >= 0 && ff < 8 && wCnt[ff] > 0 && wMinRank[ff] < r) passed = false;
                }
                if (passed) { mg -= PASSED[7 - r] / 2; eg -= PASSED[7 - r] * 2; }
            }
        }
        // 룩: 열린 줄
        for (int s = 0; s < 128; s++) {
            if ((s & 0x88) != 0) { s += 7; continue; }
            int pc = sq[s];
            if (pc == R) score += wCnt[s & 7] == 0 ? (bCnt[s & 7] == 0 ? 20 : 10) : 0;
            else if (pc == -R) score -= bCnt[s & 7] == 0 ? (wCnt[s & 7] == 0 ? 20 : 10) : 0;
        }
        // 킹 실드 (중반)
        mg += shield(sq, b.wk, 1) - shield(sq, b.bk, -1);

        // 종반 몰이: 크게 이기고 있으면 상대 킹을 구석으로, 내 킹은 가까이 → 빠른 메이트
        int diff = wMat - bMat;
        if (Math.abs(diff) >= 300 && phase <= 10) {
            int strong = diff > 0 ? 1 : -1;
            int lk = strong == 1 ? b.bk : b.wk;
            int lr = lk >> 4, lf = lk & 7;
            int center = Math.max(3 - lr, lr - 4) + Math.max(3 - lf, lf - 4);
            int kd = Math.abs(wkr - bkr) + Math.abs(wkf - bkf);
            eg += strong * (center * 20 + (14 - kd) * 6);
        }

        score += (mg * phase + eg * (24 - phase)) / 24;
        return (score + 8) * b.side; // +8: 둘 차례 보너스
    }

    private static int shield(int[] sq, int k, int s) {
        int r = k >> 4;
        if (s == 1 ? r > 1 : r < 6) return 0;
        int bonus = 0, fwd = 16 * s;
        for (int d = -1; d <= 1; d++) {
            int t = k + fwd + d;
            if ((t & 0x88) == 0 && sq[t] == s * P) bonus += 12;
            else if ((t & 0x88) == 0 && ((t + fwd) & 0x88) == 0 && sq[t + fwd] == s * P) bonus += 6;
        }
        return bonus;
    }
}
