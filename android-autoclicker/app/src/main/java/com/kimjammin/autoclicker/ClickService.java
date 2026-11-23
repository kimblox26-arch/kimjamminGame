package com.kimjammin.autoclicker;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class ClickService extends AccessibilityService {
    static ClickService instance;

    private final Handler h = new Handler(Looper.getMainLooper());
    private WindowManager wm;
    private TextView target, info;
    private LinearLayout bar;
    private Button play;
    private WindowManager.LayoutParams tp, bp;
    private boolean running;
    private long interval, count, lastCount, lastTime;

    @Override protected void onServiceConnected() { instance = this; showOverlay(); }
    @Override public void onAccessibilityEvent(AccessibilityEvent e) {}
    @Override public void onInterrupt() { stop(); }

    @Override public boolean onUnbind(Intent i) {
        stop(); removeOverlay(); instance = null;
        return super.onUnbind(i);
    }

    @Override protected boolean onKeyEvent(KeyEvent e) {
        if (running && e.getKeyCode() == KeyEvent.KEYCODE_VOLUME_DOWN) { stop(); return true; }
        return false;
    }

    private int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density); }

    private WindowManager.LayoutParams params(int w, int hgt, int x, int y) {
        WindowManager.LayoutParams p = new WindowManager.LayoutParams(w, hgt,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        p.gravity = Gravity.TOP | Gravity.START;
        p.x = x; p.y = y;
        return p;
    }

    private View.OnTouchListener drag(View view, WindowManager.LayoutParams p) {
        return new View.OnTouchListener() {
            float sx, sy; int ox, oy;
            @Override public boolean onTouch(View v, MotionEvent e) {
                switch (e.getAction()) {
                    case MotionEvent.ACTION_DOWN: sx = e.getRawX(); sy = e.getRawY(); ox = p.x; oy = p.y; return true;
                    case MotionEvent.ACTION_MOVE:
                        p.x = ox + (int) (e.getRawX() - sx); p.y = oy + (int) (e.getRawY() - sy);
                        wm.updateViewLayout(view, p); return true;
                }
                return false;
            }
        };
    }

    void showOverlay() {
        if (target != null) return;
        wm = getSystemService(WindowManager.class);

        target = new TextView(this);
        target.setText("⊕");
        target.setTextSize(40);
        target.setTextColor(Color.RED);
        target.setGravity(Gravity.CENTER);
        tp = params(dp(64), dp(64), dp(150), dp(350));
        target.setOnTouchListener(drag(target, tp));
        wm.addView(target, tp);

        bar = new LinearLayout(this);
        bar.setBackgroundColor(0xCC222222);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        TextView handle = new TextView(this);
        handle.setText(" ≡ ");
        handle.setTextSize(24);
        handle.setTextColor(Color.WHITE);
        play = new Button(this);
        play.setText("▶");
        play.setOnClickListener(v -> { if (running) stop(); else start(); });
        Button close = new Button(this);
        close.setText("✕");
        close.setOnClickListener(v -> { stop(); removeOverlay(); });
        info = new TextView(this);
        info.setTextColor(Color.WHITE);
        info.setPadding(dp(6), 0, dp(6), 0);
        info.setText("정지");
        bar.addView(handle); bar.addView(play); bar.addView(close); bar.addView(info);
        bp = params(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, dp(10), dp(80));
        handle.setOnTouchListener(drag(bar, bp));
        wm.addView(bar, bp);
    }

    private void removeOverlay() {
        if (target != null) { wm.removeView(target); target = null; }
        if (bar != null) { wm.removeView(bar); bar = null; }
    }

    private void start() {
        if (target == null) return;
        interval = getSharedPreferences("cfg", MODE_PRIVATE).getLong("interval", 1);
        running = true;
        count = lastCount = 0;
        lastTime = SystemClock.uptimeMillis();
        tp.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE; // 표적이 클릭을 가로채지 않게
        wm.updateViewLayout(target, tp);
        play.setText("■");
        h.post(this::clickOnce);
        h.postDelayed(this::updateInfo, 500);
    }

    private void stop() {
        running = false;
        h.removeCallbacksAndMessages(null);
        if (target != null) {
            tp.flags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
            wm.updateViewLayout(target, tp);
            play.setText("▶");
            info.setText("정지 | 총 " + count);
        }
    }

    private void clickOnce() {
        if (!running || target == null) return;
        int[] loc = new int[2];
        target.getLocationOnScreen(loc);
        Path path = new Path();
        path.moveTo(loc[0] + target.getWidth() / 2f, loc[1] + target.getHeight() / 2f);
        GestureDescription g = new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(path, 0, 1)).build();
        boolean ok = dispatchGesture(g, new GestureResultCallback() {
            @Override public void onCompleted(GestureDescription d) { count++; next(); }
            @Override public void onCancelled(GestureDescription d) { next(); }
        }, null);
        if (!ok) next();
    }

    private void next() {
        if (!running) return;
        if (interval <= 0) h.post(this::clickOnce); else h.postDelayed(this::clickOnce, interval);
    }

    private void updateInfo() {
        if (!running) return;
        long now = SystemClock.uptimeMillis();
        long cps = (count - lastCount) * 1000 / Math.max(1, now - lastTime);
        lastCount = count; lastTime = now;
        info.setText(cps + " 클릭/초");
        h.postDelayed(this::updateInfo, 500);
    }
}
