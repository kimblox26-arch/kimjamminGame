package com.kimjammin.chessbot;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import com.kimjammin.chessbot.engine.Board;
import com.kimjammin.chessbot.engine.OpponentModel;
import com.kimjammin.chessbot.engine.Search;
import com.kimjammin.chessbot.engine.SparringAI;

import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 게임 진행: 봇(탐색 엔진) vs 사람(터치) 또는 연습 AI. 상대의 수를 학습한다. */
final class GameController {
    interface Listener { void onChanged(); }

    private final Context ctx;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService exec = Executors.newSingleThreadExecutor();
    private final Search search = new Search();
    private final SharedPreferences prefs;
    final OpponentModel model = new OpponentModel();
    private SparringAI sparring = new SparringAI(1 + (int) (Math.random() * 3));

    Board board = new Board();
    BoardView view;
    Listener listener;
    int botSide = 1, lastFrom = -1, lastTo = -1, sel = -1, eval, depth, predicted;
    boolean botActive, oppAI, busy, exploited;
    int result; // 0 진행, 1 봇 승, -1 봇 패, 2 무승부
    private int token;
    private final int[] targets = new int[64];
    private int nTargets;

    GameController(Context c) {
        ctx = c;
        prefs = c.getSharedPreferences("chessbot", Context.MODE_PRIVATE);
        model.load(prefs.getString("model", ""));
    }

    void attach(BoardView v) {
        view = v;
        v.setListener(this::onSquare);
        refresh();
    }

    void setBotActive(boolean on) {
        botActive = on;
        if (!on) { search.abort = true; token++; busy = false; }
        sel = -1; nTargets = 0;
        refresh();
        tick();
    }

    void toggleOpponent() {
        oppAI = !oppAI;
        token++; search.abort = true; busy = false;
        refresh();
        tick();
    }

    void flip() {
        botSide = -botSide;
        token++; search.abort = true; busy = false;
        refresh();
        tick();
    }

    void newGame() {
        token++; search.abort = true; busy = false;
        board = new Board();
        lastFrom = lastTo = sel = -1; nTargets = 0;
        result = 0; eval = 0; depth = 0; exploited = false; predicted = 0;
        exec.execute(search::clear);
        if (oppAI) sparring = new SparringAI(1 + (int) (Math.random() * 3));
        refresh();
        ui.postDelayed(this::tick, 300);
    }

    void shutdown() {
        search.abort = true;
        token++;
        exec.shutdownNow();
        saveModel();
    }

    private void saveModel() { prefs.edit().putString("model", model.save()).apply(); }

    /** 다음에 누가 둘지 결정 */
    private void tick() {
        if (result != 0 || busy || view == null) return;
        if (board.side == botSide) { if (botActive) botMove(); }
        else if (oppAI && botActive) aiMove();
    }

    private void botMove() {
        busy = true;
        final int tk = ++token;
        final Board copy = board.copy();
        long time = board.fullmove < 6 ? 500 : 1100;
        exec.execute(() -> {
            Search.Result r = search.think(copy, time, 64, model, (d, s, m, n) -> ui.post(() -> {
                if (tk != token) return;
                depth = d; eval = s;
                refresh();
            }));
            ui.post(() -> {
                if (tk != token || r.move == 0) return;
                eval = r.score; depth = r.depth; exploited = r.exploited; predicted = r.predicted;
                view.animateMove(r.move, true, () -> {
                    if (tk != token) return;
                    apply(r.move);
                    busy = false;
                    tick();
                });
            });
        });
    }

    private void aiMove() {
        busy = true;
        final int tk = ++token;
        final Board copy = board.copy();
        final SparringAI ai = sparring;
        exec.execute(() -> {
            int m = ai.choose(copy);
            ui.postDelayed(() -> {
                if (tk != token || m == 0) return;
                model.record(board, m);
                view.animateMove(m, false, () -> {
                    if (tk != token) return;
                    apply(m);
                    busy = false;
                    tick();
                });
            }, 250);
        });
    }

    private void onSquare(int s) {
        if (result != 0 || busy) return;
        boolean humanTurn = !botActive || (board.side != botSide && !oppAI);
        if (!humanTurn) return;
        if (sel >= 0) {
            int[] l = new int[256];
            int n = board.legal(l);
            for (int i = 0; i < n; i++) {
                if (Board.from(l[i]) == sel && Board.to(l[i]) == s
                        && (Board.promo(l[i]) == 0 || Board.promo(l[i]) == Board.Q)) {
                    int m = l[i];
                    if (botActive) model.record(board, m);
                    sel = -1; nTargets = 0; busy = true;
                    final int tk = token;
                    view.animateMove(m, false, () -> {
                        if (tk != token) return;
                        busy = false;
                        apply(m);
                        tick();
                    });
                    return;
                }
            }
        }
        int pc = board.sq[s];
        if (pc != 0 && (pc > 0) == (board.side > 0)) {
            sel = s;
            nTargets = 0;
            int[] l = new int[256];
            int n = board.legal(l);
            for (int i = 0; i < n; i++) if (Board.from(l[i]) == s && nTargets < 64) targets[nTargets++] = Board.to(l[i]);
        } else { sel = -1; nTargets = 0; }
        refresh();
    }

    private void apply(int m) {
        board.make(m);
        lastFrom = Board.from(m);
        lastTo = Board.to(m);
        int[] l = new int[256];
        if (board.legal(l) == 0) {
            if (board.inCheck()) result = board.side == botSide ? -1 : 1;
            else result = 2;
        } else if (board.half >= 100 || board.repetitionCount() >= 3 || board.insufficient()) result = 2;
        if (result != 0 && botActive) {
            model.games++;
            if (result == 1) model.botWins++; else if (result == -1) model.botLosses++; else model.draws++;
            saveModel();
            if (oppAI) ui.postDelayed(() -> { if (botActive && oppAI && result != 0) newGame(); }, 2500);
        }
        refresh();
    }

    private void refresh() {
        if (view != null) view.update(board, botSide == -1, lastFrom, lastTo, sel, targets, nTargets);
        if (listener != null) listener.onChanged();
    }

    // ---- 상태 문자열 ----
    String status() {
        if (result == 1) return "🏆 " + I18n.t(ctx, I18n.BOT_WIN);
        if (result == -1) return "✖ " + I18n.t(ctx, I18n.BOT_LOSE);
        if (result == 2) return "½ " + I18n.t(ctx, I18n.DRAW);
        String ev = depth > 0 ? "  ·  d" + depth + "  " + fmtEval(eval) : "";
        if (busy && board.side == botSide) return "🧠 " + I18n.t(ctx, I18n.THINKING) + "…" + ev;
        if (botActive && board.side != botSide && !oppAI) return "👉 " + I18n.t(ctx, I18n.YOUR_MOVE) + ev;
        return (lastTo >= 0 ? "▶ " + Board.sqName(lastFrom) + Board.sqName(lastTo) : "♞") + ev;
    }

    String analysis() {
        int st = model.style();
        String style = st == 1 ? I18n.t(ctx, I18n.AGGR) : st == 2 ? I18n.t(ctx, I18n.DEFN)
                : st == 3 ? I18n.t(ctx, I18n.BAL) : I18n.t(ctx, I18n.LEARNING);
        StringBuilder sb = new StringBuilder();
        sb.append("🔍 ").append(I18n.t(ctx, I18n.OPP)).append(": ").append(style)
                .append(" · ").append(model.moves).append(" · ")
                .append(I18n.t(ctx, I18n.ACCURACY)).append(' ').append(model.accuracy()).append('%');
        sb.append("\n📊 ").append(I18n.t(ctx, I18n.RECORD)).append(' ')
                .append(model.botWins).append("W ").append(model.botLosses).append("L ").append(model.draws).append('D');
        if (predicted != 0) sb.append("  ·  ").append(I18n.t(ctx, I18n.PREDICT)).append(' ').append(Board.uci(predicted));
        if (exploited) sb.append("  🎯 ").append(I18n.t(ctx, I18n.EXPLOIT));
        return sb.toString();
    }

    private static String fmtEval(int s) {
        if (Math.abs(s) > Search.MATE - 500) {
            int n = (Search.MATE - Math.abs(s) + 1) / 2;
            return (s > 0 ? "#" : "#-") + n;
        }
        return String.format(Locale.US, "%+.2f", s / 100f);
    }
}
