package com.kimjammin.chessbot;

import android.Manifest;
import android.animation.ObjectAnimator;
import android.animation.PropertyValuesHolder;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.graphics.*;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

public class MainActivity extends Activity {
    private TextView startBtn, statusText, subtitle, hint, langBtn;
    private final TextView[] feats = new TextView[3];
    private BubbleView logo;
    private ObjectAnimator pulse;
    private boolean pendingStart;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(Ui.NAVY);
        getWindow().setNavigationBarColor(Ui.NAVY);

        FrameLayout root = new FrameLayout(this);
        root.addView(new Backdrop(this));
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        int pad = Ui.dp(this, 24);
        col.setPadding(pad, Ui.dp(this, 16), pad, pad);
        scroll.addView(col);
        root.addView(scroll);

        // 언어 버튼
        langBtn = Ui.button(this, "", Ui.DARK, 14);
        langBtn.setPadding(Ui.dp(this, 16), Ui.dp(this, 8), Ui.dp(this, 16), Ui.dp(this, 8));
        langBtn.setOnClickListener(v -> pickLanguage());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.gravity = Gravity.END;
        col.addView(langBtn, lp);

        logo = new BubbleView(this);
        LinearLayout.LayoutParams llp = new LinearLayout.LayoutParams(Ui.dp(this, 150), Ui.dp(this, 150));
        llp.topMargin = Ui.dp(this, 36);
        col.addView(logo, llp);
        ObjectAnimator float1 = ObjectAnimator.ofFloat(logo, "translationY", 0, -Ui.dp(this, 10));
        float1.setDuration(1800);
        float1.setRepeatMode(ValueAnimator.REVERSE);
        float1.setRepeatCount(ValueAnimator.INFINITE);
        float1.start();

        TextView title = Ui.text(this, "CHESS AUTO BOT", 30, Ui.GOLD, true);
        title.setLetterSpacing(0.12f);
        title.setGravity(Gravity.CENTER);
        title.setShadowLayer(Ui.dp(this, 12), 0, 0, 0x88F5C451);
        title.getPaint().setShader(new LinearGradient(0, 0, 0, Ui.dp(this, 36), 0xFFFFF3C4, 0xFFE0A93A, Shader.TileMode.CLAMP));
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(-2, -2);
        tlp.topMargin = Ui.dp(this, 24);
        col.addView(title, tlp);

        subtitle = Ui.text(this, "", 14, Ui.MUTED, false);
        subtitle.setGravity(Gravity.CENTER);
        subtitle.setPadding(0, Ui.dp(this, 6), 0, 0);
        col.addView(subtitle);

        // 기능 칩
        LinearLayout chips = new LinearLayout(this);
        chips.setGravity(Gravity.CENTER);
        chips.setPadding(0, Ui.dp(this, 22), 0, 0);
        for (int i = 0; i < 3; i++) {
            feats[i] = Ui.text(this, "", 12, Ui.TEXT, true);
            feats[i].setGravity(Gravity.CENTER);
            feats[i].setPadding(Ui.dp(this, 10), Ui.dp(this, 7), Ui.dp(this, 10), Ui.dp(this, 7));
            feats[i].setBackground(Ui.bg(new int[]{0x2238BDF8, 0x1138BDF8}, Ui.dp(this, 20), 0x5538BDF8, Ui.dp(this, 1)));
            LinearLayout.LayoutParams c = new LinearLayout.LayoutParams(-2, -2);
            if (i > 0) c.leftMargin = Ui.dp(this, 6);
            chips.addView(feats[i], c);
        }
        col.addView(chips);

        // 상태 카드
        statusText = Ui.text(this, "", 15, Ui.TEXT, true);
        statusText.setGravity(Gravity.CENTER);
        statusText.setPadding(Ui.dp(this, 18), Ui.dp(this, 10), Ui.dp(this, 18), Ui.dp(this, 10));
        statusText.setBackground(Ui.bg(new int[]{0x22FFFFFF, 0x11FFFFFF}, Ui.dp(this, 14), 0x22FFFFFF, Ui.dp(this, 1)));
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(-2, -2);
        slp.topMargin = Ui.dp(this, 32);
        col.addView(statusText, slp);

        // 시작 / 멈추기
        startBtn = Ui.button(this, "", Ui.GREEN, 20);
        startBtn.setElevation(Ui.dp(this, 10));
        startBtn.setOnClickListener(v -> toggle());
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(-1, Ui.dp(this, 66));
        blp.topMargin = Ui.dp(this, 22);
        col.addView(startBtn, blp);
        pulse = ObjectAnimator.ofPropertyValuesHolder(startBtn,
                PropertyValuesHolder.ofFloat("scaleX", 1f, 1.04f), PropertyValuesHolder.ofFloat("scaleY", 1f, 1.04f));
        pulse.setDuration(700);
        pulse.setRepeatMode(ValueAnimator.REVERSE);
        pulse.setRepeatCount(ValueAnimator.INFINITE);

        hint = Ui.text(this, "", 12.5f, Ui.MUTED, false);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(Ui.dp(this, 8), Ui.dp(this, 18), Ui.dp(this, 8), 0);
        col.addView(hint);

        setContentView(root);

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != 0)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pendingStart && Settings.canDrawOverlays(this)) { pendingStart = false; startOverlay(); }
        refresh();
    }

    private void toggle() {
        if (OverlayService.running) {
            stopService(new Intent(this, OverlayService.class));
            OverlayService.running = false;
            refresh();
            return;
        }
        if (!Settings.canDrawOverlays(this)) {
            new AlertDialog.Builder(this)
                    .setTitle(I18n.t(this, I18n.PERM_TITLE))
                    .setMessage(I18n.t(this, I18n.PERM_MSG))
                    .setPositiveButton(I18n.t(this, I18n.OK), (d, w) -> {
                        pendingStart = true;
                        startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:" + getPackageName())));
                    })
                    .setNegativeButton(I18n.t(this, I18n.CANCEL), null)
                    .show();
            return;
        }
        startOverlay();
    }

    private void startOverlay() {
        startForegroundService(new Intent(this, OverlayService.class));
        OverlayService.running = true;
        refresh();
    }

    private void pickLanguage() {
        new AlertDialog.Builder(this)
                .setTitle("🌐 " + I18n.t(this, I18n.LANG))
                .setSingleChoiceItems(I18n.NAMES, I18n.current(this), (d, which) -> {
                    I18n.set(this, which);
                    d.dismiss();
                    refresh();
                    if (OverlayService.running)
                        startService(new Intent(this, OverlayService.class).setAction(OverlayService.ACTION_REFRESH));
                })
                .show();
    }

    private void refresh() {
        boolean on = OverlayService.running;
        langBtn.setText("🌐  " + I18n.NAMES[I18n.current(this)] + "  ▾");
        subtitle.setText(I18n.t(this, I18n.SUBTITLE));
        feats[0].setText("⚡ " + I18n.t(this, I18n.F_FAST));
        feats[1].setText("🧠 " + I18n.t(this, I18n.F_BRAIN));
        feats[2].setText("🎯 " + I18n.t(this, I18n.F_AUTO));
        hint.setText(I18n.t(this, I18n.HINT));
        statusText.setText((on ? "🟢  " : "⚪  ") + I18n.t(this, on ? I18n.ST_RUN : I18n.ST_IDLE));
        startBtn.setText(on ? "■  " + I18n.t(this, I18n.STOP) : "▶  " + I18n.t(this, I18n.START));
        Ui.setColors(startBtn, on ? Ui.RED : Ui.GREEN);
        logo.setActive(on);
        if (on) { if (!pulse.isStarted()) pulse.start(); }
        else { pulse.cancel(); startBtn.setScaleX(1); startBtn.setScaleY(1); }
        int dir = I18n.rtl(this) ? View.LAYOUT_DIRECTION_RTL : View.LAYOUT_DIRECTION_LTR;
        getWindow().getDecorView().setLayoutDirection(dir);
    }

    /** 배경: 남색 그라데이션 + 비스듬한 체스판 + 떠다니는 말 */
    static final class Backdrop extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final String[] glyphs = {"♚", "♛", "♜", "♝", "♞", "♟"};
        private float t;

        Backdrop(Context c) { super(c); }

        @Override
        protected void onDraw(Canvas c) {
            float w = getWidth(), h = getHeight();
            p.setShader(new LinearGradient(0, 0, w, h, new int[]{0xFF101A36, 0xFF0B1224, 0xFF050810}, null, Shader.TileMode.CLAMP));
            c.drawRect(0, 0, w, h, p);
            p.setShader(new RadialGradient(w * 0.5f, h * 0.28f, w * 0.8f, 0x33F5C451, 0x00000000, Shader.TileMode.CLAMP));
            c.drawRect(0, 0, w, h, p);
            p.setShader(null);
            c.save();
            c.rotate(-18, w / 2, h);
            float cell = w / 7;
            p.setColor(0x0CFFFFFF);
            for (int i = -6; i < 14; i++)
                for (int j = 0; j < 8; j++)
                    if (((i + j) & 1) == 0) c.drawRect(i * cell, h - j * cell * 0.9f, (i + 1) * cell, h - (j - 1) * cell * 0.9f, p);
            c.restore();
            t += 0.004f;
            p.setTextAlign(Paint.Align.CENTER);
            for (int i = 0; i < 9; i++) {
                float ph = (t * (0.6f + i * 0.07f) + i * 0.137f) % 1f;
                float x = w * ((i * 0.31f + 0.07f) % 1f), y = h * (1.1f - ph * 1.2f);
                p.setTextSize(w * (0.07f + (i % 3) * 0.035f));
                p.setColor(Color.argb((int) (40 * Math.sin(ph * Math.PI)), 245, 196, 81));
                c.drawText(glyphs[i % 6], x, y, p);
            }
            postInvalidateDelayed(33);
        }
    }
}
