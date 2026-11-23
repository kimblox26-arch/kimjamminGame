package com.kimjammin.autoclicker;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.util.ArrayList;

/**
 * 화면에 마우스를 띄우고 자동 클릭.
 * - 마우스를 탭하면 그 마우스만 시작/정지, 끌면 이동
 * - 클릭 위치는 마우스 창의 왼쪽 위 모서리 바로 바깥 → 실행 중에도 마우스를 눌러 멈출 수 있음
 */
public class ClickService extends AccessibilityService {
    static ClickService instance;
    static final int MAX = 5;
    private static final long[] UNIT_MS = {3600000L, 60000L, 1000L, 1L};

    private final Handler h = new Handler(Looper.getMainLooper());
    private final ArrayList<Mouse> mice = new ArrayList<>();
    private WindowManager wm;
    private boolean looping;
    private int idx;
    private long interval, press;

    @Override protected void onServiceConnected() {
        instance = this;
        wm = getSystemService(WindowManager.class);
    }
    @Override public void onAccessibilityEvent(AccessibilityEvent e) {}
    @Override public void onInterrupt() { stopAll(); }
    @Override public boolean onUnbind(Intent i) { hideAll(); instance = null; return super.onUnbind(i); }

    @Override protected boolean onKeyEvent(KeyEvent e) { // 볼륨 아래 = 모두 정지
        if (anyRunning() && e.getKeyCode() == KeyEvent.KEYCODE_VOLUME_DOWN) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) stopAll();
            return true;
        }
        return false;
    }

    private int dp(int v) { return Ui.dp(this, v); }

    private WindowManager.LayoutParams params(int w, int hh, int x, int y) {
        WindowManager.LayoutParams p = new WindowManager.LayoutParams(w, hh,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        p.gravity = Gravity.TOP | Gravity.START;
        p.x = x; p.y = y;
        return p;
    }

    /** 투명도 1(불투명) ~ 100(가장 투명) → alpha 1.0 ~ 0.1 */
    static float alphaOf(int t) { return 1f - (Math.max(1, Math.min(t, 100)) - 1) / 99f * 0.9f; }

    static int styleOf(SharedPreferences sp) {
        int s = sp.getInt("style", CursorView.DEFAULT);
        return s >= 0 && s < CursorView.NAMES.length ? s : CursorView.DEFAULT;
    }

    boolean anyRunning() {
        for (Mouse m : mice) if (m.running) return true;
        return false;
    }

    /** 메인 화면 '시작': 마우스가 없으면 하나 띄우기 */
    void showPanel() {
        wm = getSystemService(WindowManager.class);
        if (mice.isEmpty()) addMouse();
    }

    void addMouse() {
        if (mice.size() >= MAX) {
            Toast.makeText(this, "마우스는 최대 " + MAX + "개까지 추가할 수 있어요", Toast.LENGTH_SHORT).show();
            return;
        }
        int n = mice.size();
        Mouse m = newMouse(dp(120 + n * 40), dp(240 + n * 40));
        mice.add(m);
        wm.addView(m.root, m.lp);
    }

    private Mouse newMouse(int x, int y) {
        SharedPreferences sp = getSharedPreferences("cfg", MODE_PRIVATE);
        Mouse m = new Mouse(styleOf(sp), sp.getInt("size", 5), x, y);
        m.root.setAlpha(alphaOf(sp.getInt("alpha", 1)));
        return m;
    }

    /** 설정 저장 후 떠 있는 마우스에 바로 반영 (위치 유지) */
    void refreshMice() {
        if (anyRunning() || wm == null) return;
        ArrayList<Mouse> old = new ArrayList<>(mice);
        mice.clear();
        for (Mouse o : old) {
            wm.removeView(o.root);
            Mouse m = newMouse(o.lp.x, o.lp.y);
            mice.add(m);
            wm.addView(m.root, m.lp);
        }
    }

    void removeMouse(Mouse m) {
        if (m.running) return;
        mice.remove(m);
        wm.removeView(m.root);
    }

    void hideAll() {
        stopAll();
        if (wm != null) for (Mouse m : mice) wm.removeView(m.root);
        mice.clear();
    }

    private void startMouse(Mouse m) {
        m.setRunning(true);
        if (looping) return;
        SharedPreferences sp = getSharedPreferences("cfg", MODE_PRIVATE);
        interval = Math.max(0, sp.getLong("value", 1)) * UNIT_MS[sp.getInt("unit", 3)];
        press = Math.max(1, Math.min(sp.getLong("press", 5), 10000));
        looping = true;
        idx = 0;
        h.post(this::clickNext);
    }

    private void stopMouse(Mouse m) {
        m.setRunning(false);
        if (!anyRunning()) stopLoop();
    }

    private void stopAll() {
        for (Mouse m : mice) m.setRunning(false);
        stopLoop();
    }

    private void stopLoop() {
        looping = false;
        h.removeCallbacksAndMessages(null);
    }

    /**
     * 실행 중인 마우스들만 번갈아 클릭. 터치를 최대 20개씩 제스처 하나에 묶어서 보냄(약 0.2초 분량).
     * 한 번 클릭 주기 = 누르는 시간 + 쉬는 시간(간격, 최소 1ms)
     */
    private void clickNext() {
        if (!looping) return;
        ArrayList<Mouse> act = new ArrayList<>();
        for (Mouse m : mice) if (m.running) act.add(m);
        if (act.isEmpty()) { stopLoop(); return; }
        long period = press + Math.max(1, interval);
        boolean batch = period <= 200;
        int n = batch ? (int) Math.max(1, Math.min(GestureDescription.getMaxStrokeCount(), 200 / period)) : 1;
        GestureDescription.Builder b = new GestureDescription.Builder();
        int[] loc = new int[2];
        int out = dp(1) + 1; // 마우스 창 바로 바깥
        for (int i = 0; i < n; i++) {
            idx = (idx + 1) % act.size();
            act.get(idx).root.getLocationOnScreen(loc);
            Path p = new Path();
            p.moveTo(Math.max(0, loc[0] - out), Math.max(0, loc[1] - out));
            b.addStroke(new GestureDescription.StrokeDescription(p, i * period, press));
        }
        boolean ok = dispatchGesture(b.build(), new GestureResultCallback() {
            @Override public void onCompleted(GestureDescription d) { next(batch); }
            @Override public void onCancelled(GestureDescription d) { next(batch); }
        }, null);
        if (!ok) next(batch);
    }

    private void next(boolean batch) {
        if (!looping) return;
        if (batch || interval <= 0) h.post(this::clickNext);
        else h.postDelayed(this::clickNext, interval);
    }

    /** 화면에 뜨는 마우스 하나 (+ 추가 / × 삭제 / ≡ 설정) */
    class Mouse {
        final int S;
        final FrameLayout root = new FrameLayout(ClickService.this);
        final CursorView shape;
        final IconView plus, minus, menu;
        final WindowManager.LayoutParams lp;
        boolean running;

        Mouse(int style, int size, int x, int y) {
            S = dp(24 + size * 6);
            shape = new CursorView(ClickService.this, style);
            root.addView(shape, new FrameLayout.LayoutParams(S, S, Gravity.TOP | Gravity.START));
            plus = icon(0, Gravity.TOP | Gravity.END);
            minus = icon(1, Gravity.BOTTOM | Gravity.START);
            menu = icon(2, Gravity.BOTTOM | Gravity.END);
            plus.setOnClickListener(v -> addMouse());
            minus.setOnClickListener(v -> removeMouse(this));
            menu.setOnClickListener(v -> startActivity(new Intent(ClickService.this, SettingsActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
            lp = params(S + dp(14), S + dp(28), x, y);
            shape.setOnTouchListener(touch());
        }

        private IconView icon(int type, int gravity) {
            IconView v = new IconView(ClickService.this, type);
            root.addView(v, new FrameLayout.LayoutParams(dp(26), dp(26), gravity));
            return v;
        }

        /** 탭 = 이 마우스 시작/정지, 끌기 = 이동 (실행 중엔 닿는 순간 바로 정지) */
        private View.OnTouchListener touch() {
            final int slop = ViewConfiguration.get(ClickService.this).getScaledTouchSlop();
            return new View.OnTouchListener() {
                float sx, sy;
                int ox, oy;
                boolean moved, stoppedNow;
                @Override public boolean onTouch(View v, MotionEvent e) {
                    switch (e.getActionMasked()) {
                        case MotionEvent.ACTION_DOWN:
                            stoppedNow = running;
                            if (running) { stopMouse(Mouse.this); return true; }
                            sx = e.getRawX(); sy = e.getRawY(); ox = lp.x; oy = lp.y; moved = false;
                            return true;
                        case MotionEvent.ACTION_MOVE:
                            if (stoppedNow) return true;
                            float dx = e.getRawX() - sx, dy = e.getRawY() - sy;
                            if (!moved && Math.hypot(dx, dy) > slop) moved = true;
                            if (moved) {
                                lp.x = ox + (int) dx;
                                lp.y = oy + (int) dy;
                                wm.updateViewLayout(root, lp);
                            }
                            return true;
                        case MotionEvent.ACTION_UP:
                            if (!stoppedNow && !moved) startMouse(Mouse.this);
                            return true;
                    }
                    return true;
                }
            };
        }

        void setRunning(boolean r) {
            running = r;
            int vis = r ? View.GONE : View.VISIBLE;
            plus.setVisibility(vis);
            minus.setVisibility(vis);
            menu.setVisibility(vis);
        }
    }
}
