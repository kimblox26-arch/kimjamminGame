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
    private LinearLayout bar, content;
    private TextView toggle, info, tab;
    private boolean running;
    private int idx;
    private long interval, press, count, lastCount, lastTime;

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

    /** 패널 표시: 오른쪽 조작바 + 마우스 1개 */
    void showPanel() {
        if (bar != null) return;
        wm = getSystemService(WindowManager.class);

        bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        GradientDrawable bg = new GradientDrawable();
        float r = dp(20);
        bg.setCornerRadii(new float[]{r, r, 0, 0, 0, 0, r, r}); // 왼쪽만 둥글게
        bg.setColor(0xE6111827);
        bar.setBackground(bg);

        tab = new TextView(this); // 숨겼을 때 보이는 작은 손잡이
        tab.setText("‹");
        tab.setTextColor(0xFFFFFFFF);
        tab.setTextSize(26);
        tab.setGravity(Gravity.CENTER);
        tab.setPadding(dp(10), dp(18), dp(10), dp(18));
        tab.setVisibility(View.GONE);

        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setPadding(dp(10), dp(12), dp(10), dp(12));

        info = new TextView(this);
        info.setTextColor(0xFFFFFFFF);
        info.setTextSize(12);
        info.setGravity(Gravity.CENTER);
        toggle = pill("▶ 실행", 0xFF2563EB);
        TextView hide = pill("숨기기", 0xFF374151);
        TextView close = pill("닫기", 0xFF4B5563);
        content.addView(info);
        content.addView(toggle);
        content.addView(hide);
        content.addView(close);
        bar.addView(tab);
        bar.addView(content);

        // 자동 클릭이 사람 터치를 계속 취소시키므로, 손가락이 닿는 순간(DOWN)에 바로 반응
        onDown(toggle, () -> { if (running) stop(); else start(); });
        onDown(hide, () -> setBarHidden(true));
        onDown(tab, () -> setBarHidden(false));
        onDown(close, this::hidePanel);
        onDown(info, this::stop);

        wm.addView(bar, params(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                0, 0, Gravity.END | Gravity.CENTER_VERTICAL));
        if (mice.isEmpty()) addMouse();
        updateInfo();
    }

    private void setBarHidden(boolean hidden) {
        content.setVisibility(hidden ? View.GONE : View.VISIBLE);
        tab.setVisibility(hidden ? View.VISIBLE : View.GONE);
    }

    private void onDown(View v, Runnable r) {
        v.setOnTouchListener((view, e) -> {
            if (e.getActionMasked() == MotionEvent.ACTION_DOWN) r.run();
            return true;
        });
    }

    private TextView pill(String t, int color) {
        TextView b = new TextView(this);
        b.setText(t);
        b.setTextColor(0xFFFFFFFF);
        b.setTextSize(13);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(12), dp(8), dp(12), dp(8));
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(16));
        g.setColor(color);
        b.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(8);
        b.setLayoutParams(lp);
        return b;
    }

    void addMouse() {
        if (bar == null) return;
        if (mice.size() >= MAX) {
            Toast.makeText(this, "마우스는 최대 " + MAX + "개까지 추가할 수 있어요", Toast.LENGTH_SHORT).show();
            return;
        }
        int n = mice.size();
        Mouse m = newMouse(dp(120 + n * 40), dp(240 + n * 40));
        mice.add(m);
        wm.addView(m.root, m.lp);
        updateInfo();
    }

    /** 투명도 1(불투명) ~ 100(가장 투명) → alpha 1.0 ~ 0.1 */
    static float alphaOf(int t) { return 1f - (Math.max(1, Math.min(t, 100)) - 1) / 99f * 0.9f; }

    private Mouse newMouse(int x, int y) {
        SharedPreferences sp = getSharedPreferences("cfg", MODE_PRIVATE);
        Mouse m = new Mouse(sp.getInt("style", CursorView.DEFAULT), sp.getInt("size", 5), x, y);
        m.root.setAlpha(alphaOf(sp.getInt("alpha", 1)));
        return m;
    }

    /** 설정 저장 후 떠 있는 마우스에 바로 반영 (위치 유지) */
    void refreshMice() {
        if (bar == null || running) return;
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
        if (running) return;
        mice.remove(m);
        wm.removeView(m.root);
        updateInfo();
    }

    private void updateInfo() {
        if (info != null && !running) info.setText("마우스\n" + mice.size() + "/" + MAX);
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
        if (mice.isEmpty()) { addMouse(); return; } // 마우스가 없으면 하나 다시 띄우기
        SharedPreferences sp = getSharedPreferences("cfg", MODE_PRIVATE);
        interval = Math.max(0, sp.getLong("value", 1)) * UNIT_MS[sp.getInt("unit", 3)];
        press = Math.max(1, Math.min(sp.getLong("press", 5), 10000));
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

    /**
     * 여러 번의 터치를 제스처 하나에 묶어서 보냄 (최대 20개, 약 0.2초 분량).
     * 터치마다 시스템과 주고받는 지연이 없어져 훨씬 빨라짐.
     * 한 번 클릭 주기 = 누르는 시간 + 쉬는 시간(간격, 최소 1ms)
     */
    private void clickNext() {
        if (!running) return;
        if (mice.isEmpty()) { stop(); return; }
        long period = press + Math.max(1, interval);
        boolean batch = period <= 200;
        int n = batch ? (int) Math.max(1, Math.min(GestureDescription.getMaxStrokeCount(), 200 / period)) : 1;
        GestureDescription.Builder b = new GestureDescription.Builder();
        int[] loc = new int[2];
        for (int i = 0; i < n; i++) {
            if (idx >= mice.size()) idx = 0;
            Mouse m = mice.get(idx++);
            m.shape.getLocationOnScreen(loc);
            float[] hot = m.shape.hot();
            Path p = new Path();
            p.moveTo(loc[0] + hot[0], loc[1] + hot[1]);
            b.addStroke(new GestureDescription.StrokeDescription(p, i * period, press));
        }
        final int sent = n;
        boolean ok = dispatchGesture(b.build(), new GestureResultCallback() {
            @Override public void onCompleted(GestureDescription d) { count += sent; next(batch); }
            @Override public void onCancelled(GestureDescription d) { next(batch); }
        }, null);
        if (!ok) next(batch);
    }

    private void next(boolean batch) {
        if (!running) return;
        if (batch || interval <= 0) h.post(this::clickNext);
        else h.postDelayed(this::clickNext, interval);
    }

    private void tick() {
        if (!running) return;
        long now = SystemClock.uptimeMillis();
        long cps = (count - lastCount) * 1000 / Math.max(1, now - lastTime);
        lastCount = count;
        lastTime = now;
        info.setText(cps + "/초\n총 " + count);
        h.postDelayed(this::tick, 500);
    }

    /** 화면에 뜨는 마우스 하나 (+ 추가 / × 삭제 버튼 포함) */
    class Mouse {
        final int S;
        final FrameLayout root = new FrameLayout(ClickService.this);
        final CursorView shape;
        final TextView plus, minus, menu;
        final WindowManager.LayoutParams lp;

        Mouse(int style, int size, int x, int y) {
            S = dp(24 + size * 6);
            shape = new CursorView(ClickService.this, style);
            root.addView(shape, new FrameLayout.LayoutParams(S, S, Gravity.TOP | Gravity.START));
            plus = badge("+", 0xFF16A34A, Gravity.TOP | Gravity.END);
            minus = badge("×", 0xFFDC2626, Gravity.BOTTOM | Gravity.START);
            menu = badge("≡", 0xFF6B7280, Gravity.BOTTOM | Gravity.END);
            plus.setOnClickListener(v -> addMouse());
            minus.setOnClickListener(v -> removeMouse(this));
            menu.setOnClickListener(v -> startActivity(new Intent(ClickService.this, SettingsActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
            root.addView(plus);
            root.addView(minus);
            root.addView(menu);
            lp = params(S + dp(12), S + dp(26), x, y, Gravity.TOP | Gravity.START);
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
            menu.setVisibility(vis);
            wm.updateViewLayout(root, lp);
        }
    }
}
