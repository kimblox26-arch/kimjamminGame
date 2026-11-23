package com.kimjammin.autoclicker;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.util.ArrayList;

public class ClickService extends AccessibilityService {
    static ClickService instance;
    static final int MAX = 5;
    private static final long[] UNIT_MS = {3600000L, 60000L, 1000L, 1L};

    private final Handler h = new Handler(Looper.getMainLooper());
    private final ArrayList<Mouse> mice = new ArrayList<>();
    private WindowManager wm;
    private LinearLayout bar;
    private TextView toggle, info;
    private boolean running;
    private int idx;
    private long interval, count, lastCount, lastTime;

    @Override protected void onServiceConnected() {
        instance = this;
        wm = getSystemService(WindowManager.class);
    }
    @Override public void onAccessibilityEvent(AccessibilityEvent e) {}
    @Override public void onInterrupt() { stop(); }
    @Override public boolean onUnbind(Intent i) { hidePanel(); instance = null; return super.onUnbind(i); }

    @Override protected boolean onKeyEvent(KeyEvent e) { // 볼륨 아래 = 비상정지
        if (running && e.getKeyCode() == KeyEvent.KEYCODE_VOLUME_DOWN) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) stop();
            return true;
        }
        return false;
    }

    private int dp(int v) { return Ui.dp(this, v); }

    private WindowManager.LayoutParams params(int w, int hh, int x, int y, int gravity) {
        WindowManager.LayoutParams p = new WindowManager.LayoutParams(w, hh,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        p.gravity = gravity; p.x = x; p.y = y;
        return p;
    }

    /** 패널 표시: 하단 조작바 + 마우스 1개 */
    void showPanel() {
        if (bar != null) return;
        wm = getSystemService(WindowManager.class);

        bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(16), dp(8), dp(8), dp(8));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(28));
        bg.setColor(0xE6111827);
        bar.setBackground(bg);

        info = new TextView(this);
        info.setTextColor(0xFFFFFFFF);
        info.setTextSize(13);
        info.setPadding(0, 0, dp(10), 0);
        toggle = pill("▶ 실행", 0xFF2563EB);
        TextView close = pill("닫기", 0xFF4B5563);
        bar.addView(info);
        bar.addView(toggle);
        bar.addView(close);
        toggle.setOnClickListener(v -> { if (running) stop(); else start(); });
        close.setOnClickListener(v -> hidePanel());

        wm.addView(bar, params(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                0, dp(32), Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL));
        if (mice.isEmpty()) addMouse();
        updateInfo();
    }

    private TextView pill(String t, int color) {
        TextView b = new TextView(this);
        b.setText(t);
        b.setTextColor(0xFFFFFFFF);
        b.setTextSize(14);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(14), dp(8), dp(14), dp(8));
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(20));
        g.setColor(color);
        b.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.leftMargin = dp(6);
        b.setLayoutParams(lp);
        return b;
    }

    void addMouse() {
        if (bar == null) return;
        if (mice.size() >= MAX) {
            Toast.makeText(this, "마우스는 최대 " + MAX + "개까지 추가할 수 있어요", Toast.LENGTH_SHORT).show();
            return;
        }
        SharedPreferences sp = getSharedPreferences("cfg", MODE_PRIVATE);
        int n = mice.size();
        Mouse m = new Mouse(sp.getInt("style", 0), sp.getInt("size", 5), dp(120 + n * 40), dp(240 + n * 40));
        mice.add(m);
        wm.addView(m.root, m.lp);
        updateInfo();
    }

    void removeMouse(Mouse m) {
        if (running) return;
        mice.remove(m);
        wm.removeView(m.root);
        updateInfo();
    }

    private void updateInfo() {
        if (info != null && !running) info.setText("마우스 " + mice.size() + "/" + MAX);
    }

    void hidePanel() {
        stop();
        if (wm != null) {
            for (Mouse m : mice) wm.removeView(m.root);
            if (bar != null) wm.removeView(bar);
        }
        mice.clear();
        bar = null;
    }

    private void start() {
        if (mice.isEmpty()) return;
        SharedPreferences sp = getSharedPreferences("cfg", MODE_PRIVATE);
        interval = Math.max(0, sp.getLong("value", 1)) * UNIT_MS[sp.getInt("unit", 3)];
        running = true;
        count = lastCount = 0;
        lastTime = SystemClock.uptimeMillis();
        idx = 0;
        for (Mouse m : mice) m.setRunning(true);
        toggle.setText("■ 정지");
        h.post(this::clickNext);
        h.postDelayed(this::tick, 500);
    }

    private void stop() {
        running = false;
        h.removeCallbacksAndMessages(null);
        for (Mouse m : mice) m.setRunning(false);
        if (toggle != null) toggle.setText("▶ 실행");
        updateInfo();
    }

    /** 마우스를 하나씩 순서대로 클릭 (제스처 완료 후 다음 클릭) */
    private void clickNext() {
        if (!running) return;
        if (mice.isEmpty()) { stop(); return; }
        if (idx >= mice.size()) idx = 0;
        Mouse m = mice.get(idx++);
        int[] loc = new int[2];
        m.shape.getLocationOnScreen(loc);
        float[] hot = m.shape.hot();
        Path p = new Path();
        p.moveTo(loc[0] + hot[0], loc[1] + hot[1]);
        GestureDescription g = new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(p, 0, 1)).build();
        boolean ok = dispatchGesture(g, new GestureResultCallback() {
            @Override public void onCompleted(GestureDescription d) { count++; next(); }
            @Override public void onCancelled(GestureDescription d) { next(); }
        }, null);
        if (!ok) next();
    }

    private void next() {
        if (!running) return;
        if (interval <= 0) h.post(this::clickNext);
        else h.postDelayed(this::clickNext, interval);
    }

    private void tick() {
        if (!running) return;
        long now = SystemClock.uptimeMillis();
        long cps = (count - lastCount) * 1000 / Math.max(1, now - lastTime);
        lastCount = count;
        lastTime = now;
        info.setText(cps + " 클릭/초 · 총 " + count);
        h.postDelayed(this::tick, 500);
    }

    /** 화면에 뜨는 마우스 하나 (+ 추가 / × 삭제 버튼 포함) */
    class Mouse {
        final int S;
        final FrameLayout root = new FrameLayout(ClickService.this);
        final CursorView shape;
        final TextView plus, minus;
        final WindowManager.LayoutParams lp;

        Mouse(int style, int size, int x, int y) {
            S = dp(24 + size * 6);
            shape = new CursorView(ClickService.this, style);
            root.addView(shape, new FrameLayout.LayoutParams(S, S, Gravity.TOP | Gravity.START));
            plus = badge("+", 0xFF16A34A, Gravity.TOP | Gravity.END);
            minus = badge("×", 0xFFDC2626, Gravity.BOTTOM | Gravity.END);
            plus.setOnClickListener(v -> addMouse());
            minus.setOnClickListener(v -> removeMouse(this));
            root.addView(plus);
            root.addView(minus);
            lp = params(S + dp(12), S + dp(12), x, y, Gravity.TOP | Gravity.START);
            shape.setOnTouchListener(drag());
        }

        private TextView badge(String t, int color, int gravity) {
            TextView b = new TextView(ClickService.this);
            b.setText(t);
            b.setTextColor(0xFFFFFFFF);
            b.setTextSize(15);
            b.setGravity(Gravity.CENTER);
            b.setIncludeFontPadding(false);
            GradientDrawable g = new GradientDrawable();
            g.setShape(GradientDrawable.OVAL);
            g.setColor(color);
            b.setBackground(g);
            b.setLayoutParams(new FrameLayout.LayoutParams(dp(22), dp(22), gravity));
            return b;
        }

        private View.OnTouchListener drag() {
            return new View.OnTouchListener() {
                float sx, sy;
                int ox, oy;
                @Override public boolean onTouch(View v, MotionEvent e) {
                    if (running) return false;
                    switch (e.getActionMasked()) {
                        case MotionEvent.ACTION_DOWN:
                            sx = e.getRawX(); sy = e.getRawY(); ox = lp.x; oy = lp.y;
                            return true;
                        case MotionEvent.ACTION_MOVE:
                            lp.x = ox + (int) (e.getRawX() - sx);
                            lp.y = oy + (int) (e.getRawY() - sy);
                            wm.updateViewLayout(root, lp);
                            return true;
                    }
                    return false;
                }
            };
        }

        void setRunning(boolean r) {
            if (r) lp.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
            else lp.flags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
            int vis = r ? View.GONE : View.VISIBLE;
            plus.setVisibility(vis);
            minus.setVisibility(vis);
            wm.updateViewLayout(root, lp);
        }
    }
}
