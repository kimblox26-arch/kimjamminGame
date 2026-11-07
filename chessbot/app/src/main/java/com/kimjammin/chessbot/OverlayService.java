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
import android.widget.LinearLayout;
import android.widget.TextView;

/** 다른 앱 위에 떠 있는 체스 봇 창. 닫으면 체스 버튼(원형)으로 축소된다. */
public class OverlayService extends Service {
    public static final String ACTION_REFRESH = "refresh";
    public static volatile boolean running;
    private static final String CH = "chessbot";

    private WindowManager wm;
    private View panel;
    private BubbleView bubble;
    private WindowManager.LayoutParams panelLp, bubbleLp;
    private GameController game;
    private TextView title, status, analysis, runBtn, newBtn, flipBtn, oppBtn;
    private boolean expanded;

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        startAsForeground();
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        game = new GameController(this);
        buildPanel();
        buildBubble();
        game.listener = this::updateTexts;
        game.attach(boardView);
        showPanel();
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
        game.shutdown();
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

    private WindowManager.LayoutParams params(int w) {
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(w, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        return lp;
    }

    private BoardView boardView;

    @SuppressLint("ClickableViewAccessibility")
    private void buildPanel() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int w = Math.min(dm.widthPixels - Ui.dp(this, 24), Ui.dp(this, 360));
        int pad = Ui.dp(this, 12);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad / 2, pad, pad);
        root.setBackground(Ui.bg(new int[]{0xF2182241, 0xF20B1224}, Ui.dp(this, 22), 0x88F5C451, Ui.dp(this, 1.5f)));
        root.setElevation(Ui.dp(this, 12));

        // 제목 줄 (드래그 가능) + 닫기
        FrameLayout bar = new FrameLayout(this);
        title = Ui.text(this, "♞  CHESS AUTO BOT", 15, Ui.GOLD, true);
        title.setLetterSpacing(0.08f);
        title.setPadding(Ui.dp(this, 4), Ui.dp(this, 8), 0, Ui.dp(this, 8));
        bar.addView(title);
        TextView close = Ui.text(this, "✕", 18, Ui.TEXT, true);
        close.setGravity(Gravity.CENTER);
        close.setBackground(Ui.bg(new int[]{0x33FFFFFF, 0x22FFFFFF}, Ui.dp(this, 18), 0, 0));
        FrameLayout.LayoutParams clp = new FrameLayout.LayoutParams(Ui.dp(this, 36), Ui.dp(this, 36), Gravity.END | Gravity.CENTER_VERTICAL);
        bar.addView(close, clp);
        close.setOnClickListener(v -> collapse());
        root.addView(bar);

        boardView = new BoardView(this);
        FrameLayout boardFrame = new FrameLayout(this);
        boardFrame.setBackground(Ui.bg(new int[]{0xFF5A3D24, 0xFF3A2614}, Ui.dp(this, 8), 0, 0));
        int bp = Ui.dp(this, 4);
        boardFrame.setPadding(bp, bp, bp, bp);
        boardFrame.addView(boardView);
        root.addView(boardFrame);

        status = Ui.text(this, "", 14, Ui.TEXT, true);
        status.setPadding(Ui.dp(this, 4), Ui.dp(this, 10), 0, Ui.dp(this, 2));
        root.addView(status);
        analysis = Ui.text(this, "", 11.5f, Ui.MUTED, false);
        analysis.setPadding(Ui.dp(this, 4), 0, 0, Ui.dp(this, 10));
        analysis.setLineSpacing(0, 1.15f);
        root.addView(analysis);

        runBtn = Ui.button(this, "", Ui.GREEN, 16);
        runBtn.setOnClickListener(v -> game.setBotActive(!game.botActive));
        root.addView(runBtn, new LinearLayout.LayoutParams(-1, Ui.dp(this, 50)));

        LinearLayout row = new LinearLayout(this);
        row.setPadding(0, Ui.dp(this, 8), 0, 0);
        newBtn = Ui.button(this, "", Ui.DARK, 12.5f);
        flipBtn = Ui.button(this, "", Ui.DARK, 12.5f);
        oppBtn = Ui.button(this, "", Ui.DARK, 12.5f);
        newBtn.setOnClickListener(v -> game.newGame());
        flipBtn.setOnClickListener(v -> game.flip());
        oppBtn.setOnClickListener(v -> game.toggleOpponent());
        int gap = Ui.dp(this, 6);
        TextView[] bs = {newBtn, flipBtn, oppBtn};
        for (int i = 0; i < 3; i++) {
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, Ui.dp(this, 42), 1);
            if (i > 0) lp.leftMargin = gap;
            bs[i].setSingleLine(true);
            row.addView(bs[i], lp);
        }
        root.addView(row);

        panel = root;
        panelLp = params(w);
        panelLp.x = (dm.widthPixels - w) / 2;
        panelLp.y = Ui.dp(this, 80);
        dragOn(bar, panel, panelLp, null);
        dragOn(title, panel, panelLp, null);
    }

    private void buildBubble() {
        bubble = new BubbleView(this);
        int s = Ui.dp(this, 64);
        bubbleLp = params(s);
        bubbleLp.height = s;
        dragOn(bubble, bubble, bubbleLp, this::expand);
    }

    /** 드래그 이동 + 탭 감지 */
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
                        lp.x = (int) (st[2] + dx);
                        lp.y = (int) Math.max(0, st[3] + dy);
                        wm.updateViewLayout(win, lp);
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    if (!moved[0] && onTap != null) onTap.run();
                    else if (moved[0] && win == bubble) snapBubble();
                    return true;
            }
            return false;
        });
    }

    private void snapBubble() {
        int sw = getResources().getDisplayMetrics().widthPixels;
        bubbleLp.x = bubbleLp.x + bubbleLp.width / 2 < sw / 2 ? Ui.dp(this, 6) : sw - bubbleLp.width - Ui.dp(this, 6);
        if (bubble.isAttachedToWindow()) wm.updateViewLayout(bubble, bubbleLp);
    }

    private void showPanel() {
        if (!panel.isAttachedToWindow()) wm.addView(panel, panelLp);
        expanded = true;
        updateTexts();
    }

    private void collapse() {
        bubbleLp.x = Math.max(0, panelLp.x + panel.getWidth() - bubbleLp.width);
        bubbleLp.y = panelLp.y;
        removeSafe(panel);
        if (!bubble.isAttachedToWindow()) wm.addView(bubble, bubbleLp);
        snapBubble();
        expanded = false;
        bubble.setActive(game.botActive);
    }

    private void expand() {
        removeSafe(bubble);
        DisplayMetrics dm = getResources().getDisplayMetrics();
        panelLp.x = Math.max(0, Math.min(dm.widthPixels - panelLp.width, bubbleLp.x - panelLp.width / 2));
        panelLp.y = Math.max(0, Math.min(dm.heightPixels - Ui.dp(this, 560), bubbleLp.y));
        showPanel();
    }

    private void updateTexts() {
        if (game == null || runBtn == null) return;
        boolean on = game.botActive;
        runBtn.setText(on ? "⏸  " + I18n.t(this, I18n.BOT_OFF) : "▶  " + I18n.t(this, I18n.BOT_ON));
        Ui.setColors(runBtn, on ? Ui.RED : Ui.GREEN);
        newBtn.setText(I18n.t(this, I18n.NEW_GAME));
        flipBtn.setText(I18n.t(this, I18n.FLIP));
        oppBtn.setText(I18n.t(this, game.oppAI ? I18n.OPP_AI : I18n.OPP_HUMAN));
        status.setText(game.status());
        analysis.setText(game.analysis());
        int dir = I18n.rtl(this) ? View.LAYOUT_DIRECTION_RTL : View.LAYOUT_DIRECTION_LTR;
        status.setLayoutDirection(dir);
        analysis.setLayoutDirection(dir);
        if (!expanded) bubble.setActive(on);
    }
}
