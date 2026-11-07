package com.kimjammin.chessbot.engine;

import java.util.HashMap;
import java.util.Map;

import static com.kimjammin.chessbot.engine.Board.*;

/** 상대의 수를 국면별로 기억하고 성향(공격/수비)을 분석해 다음 수를 예측한다. */
public final class OpponentModel {
    private final HashMap<Long, HashMap<Integer, Integer>> book = new HashMap<>();
    public int moves, captures, checks, retreats, games, botWins, botLosses, draws, hits, predictions;

    public synchronized void record(Board before, int move) {
        int pred = predict(before);
        if (pred != 0) { predictions++; if (pred == move) hits++; }
        HashMap<Integer, Integer> m = book.get(before.hash);
        if (m == null) {
            if (book.size() > 6000) book.clear();
            m = new HashMap<>();
            book.put(before.hash, m);
        }
        m.merge(move, 1, Integer::sum);
        moves++;
        if ((flags(move) & F_CAP) != 0) captures++;
        int dir = (to(move) >> 4) - (from(move) >> 4);
        if (dir * before.side < 0) retreats++;
        before.make(move);
        if (before.inCheck()) checks++;
        before.unmake();
    }

    /** 이 국면에서 상대가 가장 자주 둔 수 (없으면 0) */
    public synchronized int predict(Board b) {
        HashMap<Integer, Integer> m = book.get(b.hash);
        if (m == null) return 0;
        int best = 0, bc = 0;
        for (Map.Entry<Integer, Integer> e : m.entrySet()) if (e.getValue() > bc) { bc = e.getValue(); best = e.getKey(); }
        return best != 0 && b.isLegal(best) ? best : 0;
    }

    /** 2번 이상, 60% 이상 같은 수를 둔 경우만 */
    public synchronized int predictConfident(Board b) {
        HashMap<Integer, Integer> m = book.get(b.hash);
        if (m == null) return 0;
        int best = 0, bc = 0, total = 0;
        for (Map.Entry<Integer, Integer> e : m.entrySet()) {
            total += e.getValue();
            if (e.getValue() > bc) { bc = e.getValue(); best = e.getKey(); }
        }
        return bc >= 2 && bc * 10 >= total * 6 && b.isLegal(best) ? best : 0;
    }

    /** 0=데이터 부족, 1=공격형, 2=수비형, 3=균형형 */
    public synchronized int style() {
        if (moves < 12) return 0;
        float aggr = (captures + checks * 1.5f) / moves, def = (float) retreats / moves;
        if (aggr > 0.28f) return 1;
        if (def > 0.18f) return 2;
        return 3;
    }

    public synchronized int accuracy() { return predictions == 0 ? 0 : hits * 100 / predictions; }

    public synchronized String save() {
        StringBuilder sb = new StringBuilder();
        sb.append(moves).append(',').append(captures).append(',').append(checks).append(',').append(retreats)
                .append(',').append(games).append(',').append(botWins).append(',').append(botLosses).append(',')
                .append(draws).append(',').append(hits).append(',').append(predictions).append('|');
        for (Map.Entry<Long, HashMap<Integer, Integer>> e : book.entrySet()) {
            sb.append(Long.toHexString(e.getKey()));
            for (Map.Entry<Integer, Integer> x : e.getValue().entrySet())
                sb.append(':').append(Integer.toHexString(x.getKey())).append('=').append(x.getValue());
            sb.append(';');
        }
        return sb.toString();
    }

    public synchronized void load(String s) {
        if (s == null || s.isEmpty()) return;
        try {
            String[] parts = s.split("\\|", 2);
            String[] st = parts[0].split(",");
            moves = Integer.parseInt(st[0]); captures = Integer.parseInt(st[1]); checks = Integer.parseInt(st[2]);
            retreats = Integer.parseInt(st[3]); games = Integer.parseInt(st[4]); botWins = Integer.parseInt(st[5]);
            botLosses = Integer.parseInt(st[6]); draws = Integer.parseInt(st[7]);
            hits = Integer.parseInt(st[8]); predictions = Integer.parseInt(st[9]);
            if (parts.length < 2) return;
            for (String pos : parts[1].split(";")) {
                if (pos.isEmpty()) continue;
                String[] f = pos.split(":");
                HashMap<Integer, Integer> m = new HashMap<>();
                for (int i = 1; i < f.length; i++) {
                    String[] kv = f[i].split("=");
                    m.put(Integer.parseUnsignedInt(kv[0], 16), Integer.parseInt(kv[1]));
                }
                book.put(Long.parseUnsignedLong(f[0], 16), m);
            }
        } catch (RuntimeException e) {
            book.clear();
        }
    }

    public synchronized void reset() {
        book.clear();
        moves = captures = checks = retreats = games = botWins = botLosses = draws = hits = predictions = 0;
    }
}
