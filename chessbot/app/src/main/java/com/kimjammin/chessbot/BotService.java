package com.kimjammin.chessbot;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.SharedPreferences;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import com.kimjammin.chessbot.engine.Board;
import com.kimjammin.chessbot.engine.OpponentModel;
import com.kimjammin.chessbot.engine.Search;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 내 체스 게임 화면을 읽고 직접 터치해서 두는 봇.
 * 판에 "KJBOT|FEN|뒤집힘(0/1)|내차례(0/1)" 접근성 라벨을 붙인 게임에서만 작동한다.
 */
public class BotService extends AccessibilityService {
    static volatile BotService instance;
    static volatile boolean active;

    private static final String MARK = "KJBOT|";
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService exec = Executors.newSingleThreadExecutor();
    private final Search search = new Search();
    private final OpponentModel model = new OpponentModel();
    private SharedPreferences prefs;
    private String lastFen;
    private Board afterMine;
    private long lastTap;
    private boolean working;

    @Override
    protected void onServiceConnected() {
        instance = this;
        prefs = getSharedPreferences("chessbot", MODE_PRIVATE);
        model.load(prefs.getString("model", ""));
        ui.post(loop);
    }

    @Override
    public boolean onUnbind(android.content.Intent i) {
        instance = null;
        ui.removeCallbacks(loop);
        return super.onUnbind(i);
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent e) { }
    @Override public void onInterrupt() { }

    private final Runnable loop = new Runnable() {
        @Override public void run() {
            if (active && !working) scan();
            ui.postDelayed(this, 250);
        }
    };

    private static final class Marker {
        String fen;
        boolean flipped, ready;
        final Rect rect = new Rect();
    }

    private void scan() {
        Marker m = find();
        if (m == null || !m.ready) return;
        // 같은 국면이면 이미 둔 것 → 터치가 씹혔을 때만 3초 뒤 다시 시도
        if (m.fen.equals(lastFen) && System.currentTimeMillis() - lastTap < 3000) return;
        lastFen = m.fen;
        Board b = new Board();
        try { b.setFen(m.fen); } catch (RuntimeException ex) { return; }
        learnOpponent(b);
        working = true;
        final Board copy = b.copy();
        exec.execute(() -> {
            Search.Result r = search.think(copy, 800, 64, model, null);
            ui.post(() -> {
                if (!active || r.move == 0) { working = false; return; }
                afterMine = b.copy();
                afterMine.make(r.move);
                play(m, r.move);
            });
        });
    }

    /** 상대가 둔 수를 찾아 패턴으로 저장 */
    private void learnOpponent(Board now) {
        if (afterMine == null) return;
        int[] l = new int[256];
        int n = afterMine.legal(l);
        for (int i = 0; i < n; i++) {
            afterMine.make(l[i]);
            boolean same = afterMine.side == now.side && java.util.Arrays.equals(afterMine.sq, now.sq);
            afterMine.unmake();
            if (same) {
                model.record(afterMine, l[i]);
                prefs.edit().putString("model", model.save()).apply();
                return;
            }
        }
    }

    /** 출발 칸 → 도착 칸 (승급이면 도착 칸의 퀸 선택을 한 번 더) */
    private void play(Marker m, int move) {
        int from = Board.from(move), to = Board.to(move);
        float[][] pts = Board.promo(move) != 0
                ? new float[][]{center(m, from), center(m, to), center(m, to)}
                : new float[][]{center(m, from), center(m, to)};
        OverlayService.passThrough(true);
        tapChain(pts, 0);
    }

    private void tapChain(float[][] pts, int i) {
        if (i >= pts.length || !active) {
            lastTap = System.currentTimeMillis();
            ui.postDelayed(() -> { OverlayService.passThrough(false); working = false; }, 150);
            return;
        }
        Path p = new Path();
        p.moveTo(pts[i][0], pts[i][1]);
        GestureDescription g = new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(p, 0, 40)).build();
        boolean ok = dispatchGesture(g, new GestureResultCallback() {
            @Override public void onCompleted(GestureDescription d) { ui.postDelayed(() -> tapChain(pts, i + 1), 140); }
            @Override public void onCancelled(GestureDescription d) { ui.postDelayed(() -> tapChain(pts, i + 1), 140); }
        }, null);
        if (!ok) tapChain(pts, pts.length);
    }

    /** 엔진 칸(0x88, 0=a1) → 화면 좌표 */
    private static float[] center(Marker m, int sq) {
        int file = sq & 7, rank = sq >> 4;
        int col = m.flipped ? 7 - file : file, row = m.flipped ? rank : 7 - rank;
        float w = m.rect.width() / 8f, h = m.rect.height() / 8f;
        return new float[]{m.rect.left + (col + 0.5f) * w, m.rect.top + (row + 0.5f) * h};
    }

    private Marker find() {
        List<AccessibilityWindowInfo> ws = getWindows();
        for (AccessibilityWindowInfo w : ws) {
            AccessibilityNodeInfo root = w.getRoot();
            if (root == null || getPackageName().contentEquals(String.valueOf(root.getPackageName()))) continue;
            Marker m = search(root, 0);
            if (m != null) return m;
        }
        AccessibilityNodeInfo root = getRootInActiveWindow();
        return root == null ? null : search(root, 0);
    }

    private Marker search(AccessibilityNodeInfo n, int depth) {
        if (n == null || depth > 60) return null;
        String label = label(n);
        if (label != null) {
            String[] p = label.substring(label.indexOf(MARK)).split("\\|");
            if (p.length >= 4) {
                Marker m = new Marker();
                m.fen = p[1].trim();
                m.flipped = p[2].trim().equals("1");
                m.ready = p[3].trim().startsWith("1");
                n.getBoundsInScreen(m.rect);
                if (m.rect.width() > 0 && m.rect.height() > 0) return m;
            }
        }
        for (int i = 0; i < n.getChildCount(); i++) {
            Marker m = search(n.getChild(i), depth + 1);
            if (m != null) return m;
        }
        return null;
    }

    private static String label(AccessibilityNodeInfo n) {
        CharSequence d = n.getContentDescription();
        if (d != null && d.toString().contains(MARK)) return d.toString();
        CharSequence t = n.getText();
        if (t != null && t.toString().contains(MARK)) return t.toString();
        return null;
    }
}
