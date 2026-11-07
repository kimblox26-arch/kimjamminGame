package com.kimjammin.chessbot;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.*;
import android.view.MotionEvent;
import android.view.View;
import android.view.animation.DecelerateInterpolator;

import com.kimjammin.chessbot.engine.Board;

/** 체스판 + 봇의 '자동 터치' 애니메이션 */
public class BoardView extends View {
    public interface OnSquare { void onSquare(int sq); }

    private static final String[] GLYPH = {"", "♟︎", "♞︎", "♝︎", "♜︎", "♛︎", "♚︎"};
    private static final int LIGHT = 0xFFEBD9B4, DARK = 0xFFB0805A;
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG), stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final int[] pos = new int[128];
    private boolean flipped;
    private int sel = -1, lastFrom = -1, lastTo = -1, checkSq = -1;
    private boolean[] targets = new boolean[128];
    private int animFrom = -1, animTo = -1, animPiece;
    private float slide = -1, tapT = -1;
    private int tapSq = -1;
    private OnSquare listener;

    public BoardView(Context c) {
        super(c);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeJoin(Paint.Join.ROUND);
    }

    public void setListener(OnSquare l) { listener = l; }

    public void update(Board b, boolean flip, int lf, int lt, int selected, int[] tg, int ntg) {
        System.arraycopy(b.sq, 0, pos, 0, 128);
        flipped = flip;
        lastFrom = lf; lastTo = lt; sel = selected;
        targets = new boolean[128];
        for (int i = 0; i < ntg; i++) targets[tg[i]] = true;
        checkSq = b.inCheck() ? (b.side == 1 ? b.wk : b.bk) : -1;
        invalidate();
    }

    /** 봇의 수: 출발 칸 터치 → 말 이동 → 도착 칸 터치 */
    public void animateMove(int m, boolean tap, Runnable done) {
        animFrom = Board.from(m); animTo = Board.to(m); animPiece = pos[animFrom];
        ValueAnimator a = ValueAnimator.ofFloat(0, 1);
        a.setDuration(tap ? 460 : 170);
        a.setInterpolator(new DecelerateInterpolator());
        a.addUpdateListener(v -> {
            float t = (float) v.getAnimatedValue();
            if (tap) {
                if (t < 0.35f) { tapSq = animFrom; tapT = t / 0.35f; slide = 0; }
                else { slide = Math.min(1, (t - 0.35f) / 0.45f); tapSq = t > 0.7f ? animTo : -1; tapT = (t - 0.7f) / 0.3f; }
            } else { slide = t; tapSq = -1; }
            invalidate();
        });
        a.addListener(new android.animation.AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(android.animation.Animator an) {
                slide = -1; tapSq = -1; animFrom = -1;
                done.run();
            }
        });
        a.start();
    }

    @Override
    protected void onMeasure(int w, int h) {
        int s = MeasureSpec.getSize(w);
        setMeasuredDimension(s, s);
    }

    private float cx(int s, float cell) { int f = s & 7; return ((flipped ? 7 - f : f) + 0.5f) * cell; }
    private float cy(int s, float cell) { int r = s >> 4; return ((flipped ? r : 7 - r) + 0.5f) * cell; }

    @Override
    protected void onDraw(Canvas c) {
        float cell = getWidth() / 8f;
        p.setShader(null);
        for (int s = 0; s < 128; s++) {
            if ((s & 0x88) != 0) { s += 7; continue; }
            float x = cx(s, cell) - cell / 2, y = cy(s, cell) - cell / 2;
            boolean light = (((s >> 4) + (s & 7)) & 1) == 1;
            p.setColor(light ? LIGHT : DARK);
            c.drawRect(x, y, x + cell, y + cell, p);
            if (s == lastFrom || s == lastTo) { p.setColor(0x66F5D04A); c.drawRect(x, y, x + cell, y + cell, p); }
            if (s == sel) { p.setColor(0x7738BDF8); c.drawRect(x, y, x + cell, y + cell, p); }
            if (s == checkSq) {
                p.setShader(new RadialGradient(x + cell / 2, y + cell / 2, cell * 0.7f, 0xEEFF2222, 0x00FF0000, Shader.TileMode.CLAMP));
                c.drawRect(x, y, x + cell, y + cell, p);
                p.setShader(null);
            }
        }
        // 좌표
        p.setTextSize(cell * 0.2f);
        p.setTextAlign(Paint.Align.LEFT);
        for (int i = 0; i < 8; i++) {
            int file = flipped ? 7 - i : i, rank = flipped ? i : 7 - i;
            p.setColor((i & 1) == 0 ? LIGHT : DARK);
            c.drawText(String.valueOf((char) ('a' + file)), i * cell + cell * 0.06f, 8 * cell - cell * 0.06f, p);
            p.setColor((i & 1) == 0 ? DARK : LIGHT);
            c.drawText(String.valueOf((char) ('1' + rank)), cell * 0.06f, i * cell + cell * 0.24f, p);
        }
        // 말
        p.setTextAlign(Paint.Align.CENTER);
        p.setTextSize(cell * 0.84f);
        stroke.setTextAlign(Paint.Align.CENTER);
        stroke.setTextSize(cell * 0.84f);
        stroke.setStrokeWidth(cell * 0.05f);
        Paint.FontMetrics fm = p.getFontMetrics();
        float off = -(fm.ascent + fm.descent) / 2;
        for (int s = 0; s < 128; s++) {
            if ((s & 0x88) != 0) { s += 7; continue; }
            if (pos[s] == 0 || (slide >= 0 && s == animFrom)) continue;
            if (slide >= 0 && s == animTo) continue;
            drawPiece(c, pos[s], cx(s, cell), cy(s, cell) + off);
        }
        if (slide >= 0 && animFrom >= 0) {
            float x = cx(animFrom, cell) + (cx(animTo, cell) - cx(animFrom, cell)) * slide;
            float y = cy(animFrom, cell) + (cy(animTo, cell) - cy(animFrom, cell)) * slide;
            drawPiece(c, animPiece, x, y + off);
        }
        // 이동 가능 표시
        p.setColor(0x55102030);
        for (int s = 0; s < 128; s++) {
            if ((s & 0x88) != 0 || !targets[s]) continue;
            if (pos[s] != 0) {
                stroke.setColor(0x88102030);
                stroke.setStrokeWidth(cell * 0.07f);
                c.drawCircle(cx(s, cell), cy(s, cell), cell * 0.44f, stroke);
            } else c.drawCircle(cx(s, cell), cy(s, cell), cell * 0.15f, p);
        }
        // 자동 터치 표시
        if (tapSq >= 0 && tapT >= 0) {
            float x = cx(tapSq, cell), y = cy(tapSq, cell), t = Math.min(1, tapT);
            p.setColor(Color.argb((int) (160 * (1 - t)), 56, 189, 248));
            c.drawCircle(x, y, cell * (0.25f + 0.55f * t), p);
            p.setColor(0xCCFFFFFF);
            c.drawCircle(x, y, cell * 0.16f, p);
            stroke.setColor(0xFF38BDF8);
            stroke.setStrokeWidth(cell * 0.05f);
            c.drawCircle(x, y, cell * 0.16f, stroke);
        }
    }

    private void drawPiece(Canvas c, int pc, float x, float y) {
        boolean white = pc > 0;
        stroke.setColor(white ? 0xFF1A1A1A : 0xFFF0F0F0);
        stroke.setStrokeWidth(getWidth() / 8f * (white ? 0.06f : 0.03f));
        String g = GLYPH[Math.abs(pc)];
        c.drawText(g, x, y, stroke);
        p.setColor(white ? 0xFFFFFFFF : 0xFF1E1E24);
        c.drawText(g, x, y, p);
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        if (e.getAction() == MotionEvent.ACTION_DOWN) return true;
        if (e.getAction() == MotionEvent.ACTION_UP && listener != null) {
            float cell = getWidth() / 8f;
            int col = (int) (e.getX() / cell), row = (int) (e.getY() / cell);
            if (col < 0 || col > 7 || row < 0 || row > 7) return true;
            int file = flipped ? 7 - col : col, rank = flipped ? row : 7 - row;
            listener.onSquare(rank * 16 + file);
            performClick();
        }
        return true;
    }

    @Override public boolean performClick() { return super.performClick(); }
}
