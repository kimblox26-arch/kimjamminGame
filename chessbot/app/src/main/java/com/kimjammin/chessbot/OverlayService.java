package com.kimjammin.chessbot;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/** 다른 앱 위에 떠 있는 창. 닫으면 체스 그림 원형 버튼으로 축소, 누르면 다시 창으로. */
public class OverlayService extends Service {
    public static final String ACTION_REFRESH = "refresh";
    public static volatile boolean running;
    private static final String CH = "chessbot";

    private WindowManager wm;
    private View panel;
    private BubbleView bubble;
    private WindowManager.LayoutParams panelLp, bubbleLp;
    private Ui.IconButton runBtn;
    private boolean botOn;

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        startAsForeground();
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        buildPanel();
        buildBubble();
        wm.addView(panel, panelLp);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_REFRESH.equals(intent.getAction())) {
            updateTexts();
            startAsForeground();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        removeSafe(panel);
        removeSafe(bubble);
        super.onDestroy();
    }

    private void removeSafe(View v) {
        if (v != null && v.isAttachedToWindow()) wm.removeView(v);
    }

    private void startAsForeground() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CH, "Chess Bot", NotificationManager.IMPORTANCE_LOW));
        PendingIntent pi = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, CH)
                .setSmallIcon(R.drawable.ic_notif)
                .setContentTitle("Chess Auto Bot")
                .setContentText(I18n.t(this, I18n.NOTIF))
                .setContentIntent(pi)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, n);
    }

    private WindowManager.LayoutParams params(int w, int h) {
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(w, h,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        return lp;
    }

    private void buildPanel() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int w = Math.min(dm.widthPixels - Ui.dp(this, 48), Ui.dp(this, 300));
        int pad = Ui.dp(this, 14);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad / 2, pad, pad);
        root.setBackground(Ui.bg(new int[]{0xF2182241, 0xF20B1224}, Ui.dp(this, 22), 0x88F5C451, Ui.dp(this, 1.5f)));
        root.setElevation(Ui.dp(this, 12));

        // 제목 줄 (끌어서 이동) + 닫기
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(0, Ui.dp(this, 6), 0, Ui.dp(this, 10));
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.knight);
        bar.addView(logo, new LinearLayout.LayoutParams(Ui.dp(this, 18), Ui.dp(this, 22)));
        TextView title = Ui.text(this, "CHESS AUTO BOT", 14, Ui.GOLD);
        title.setLetterSpacing(0.08f);
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(0, -2, 1);
        tlp.setMarginStart(Ui.dp(this, 8));
        bar.addView(title, tlp);
        ImageView close = new ImageView(this);
        close.setImageResource(R.drawable.ic_close);
        int cp = Ui.dp(this, 7);
        close.setPadding(cp, cp, cp, cp);
        close.setBackground(Ui.bg(new int[]{0x33FFFFFF, 0x22FFFFFF}, Ui.dp(this, 18), 0, 0));
        close.setOnClickListener(v -> collapse());
        bar.addView(close, new LinearLayout.LayoutParams(Ui.dp(this, 34), Ui.dp(this, 34)));
        root.addView(bar);

        // 봇 작동하기
        runBtn = new Ui.IconButton(this, 16, 20);
        runBtn.setOnClickListener(v -> { botOn = !botOn; updateTexts(); });
        root.addView(runBtn, new LinearLayout.LayoutParams(-1, Ui.dp(this, 52)));

        panel = root;
        panelLp = params(w, WindowManager.LayoutParams.WRAP_CONTENT);
        panelLp.x = (dm.widthPixels - w) / 2;
        panelLp.y = Ui.dp(this, 100);
        dragOn(bar, panel, panelLp, null);
        updateTexts();
    }

    private void buildBubble() {
        bubble = new BubbleView(this);
        int s = Ui.dp(this, 64);
        bubbleLp = params(s, s);
        dragOn(bubble, bubble, bubbleLp, this::expand);
    }

    /** 끌어서 이동 + 탭 감지 */
    @SuppressLint("ClickableViewAccessibility")
    private void dragOn(View handle, View win, WindowManager.LayoutParams lp, Runnable onTap) {
        final int slop = ViewConfiguration.get(this).getScaledTouchSlop();
        final float[] st = new float[4];
        final boolean[] moved = new boolean[1];
        handle.setOnTouchListener((v, e) -> {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    st[0] = e.getRawX(); st[1] = e.getRawY(); st[2] = lp.x; st[3] = lp.y;
                    moved[0] = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = e.getRawX() - st[0], dy = e.getRawY() - st[1];
                    if (!moved[0] && Math.hypot(dx, dy) > slop) moved[0] = true;
                    if (moved[0] && win.isAttachedToWindow()) {
                        lp.x = (int) Math.max(0, st[2] + dx);
                        lp.y = (int) Math.max(0, st[3] + dy);
                        wm.updateViewLayout(win, lp);
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    if (!moved[0] && onTap != null) onTap.run();
                    return true;
            }
            return false;
        });
    }

    private void collapse() {
        bubbleLp.x = Math.max(0, panelLp.x + panel.getWidth() - bubbleLp.width);
        bubbleLp.y = panelLp.y;
        removeSafe(panel);
        if (!bubble.isAttachedToWindow()) wm.addView(bubble, bubbleLp);
    }

    private void expand() {
        removeSafe(bubble);
        DisplayMetrics dm = getResources().getDisplayMetrics();
        panelLp.x = Math.max(0, Math.min(dm.widthPixels - panelLp.width, bubbleLp.x + bubbleLp.width - panelLp.width));
        panelLp.y = bubbleLp.y;
        if (!panel.isAttachedToWindow()) wm.addView(panel, panelLp);
    }

    private void updateTexts() {
        if (runBtn == null) return;
        runBtn.set(botOn ? R.drawable.ic_stop : R.drawable.ic_play,
                I18n.t(this, botOn ? I18n.BOT_OFF : I18n.BOT_ON), botOn ? Ui.RED : Ui.GREEN);
    }
}
