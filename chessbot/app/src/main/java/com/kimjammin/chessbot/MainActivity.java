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
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {
    private Ui.IconButton startBtn, langBtn;
    private ImageView chevron;
    private ObjectAnimator pulse;
    private boolean pendingStart;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(Ui.NAVY);
        getWindow().setNavigationBarColor(Ui.NAVY);

        FrameLayout root = new FrameLayout(this);
        root.addView(new Backdrop(this));
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        int pad = Ui.dp(this, 24);
        col.setPadding(pad, Ui.dp(this, 16), pad, pad);
        root.addView(col);

        // 언어 설정
        langBtn = new Ui.IconButton(this, 14, 18);
        langBtn.setPadding(Ui.dp(this, 14), Ui.dp(this, 8), Ui.dp(this, 10), Ui.dp(this, 8));
        chevron = new ImageView(this);
        chevron.setImageResource(R.drawable.ic_chevron);
        langBtn.addView(chevron, new LinearLayout.LayoutParams(Ui.dp(this, 20), Ui.dp(this, 20)));
        langBtn.setOnClickListener(v -> pickLanguage());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.gravity = Gravity.END;
        col.addView(langBtn, lp);

        View top = new View(this);
        col.addView(top, new LinearLayout.LayoutParams(1, 0, 1));

        BubbleView logo = new BubbleView(this);
        col.addView(logo, new LinearLayout.LayoutParams(Ui.dp(this, 160), Ui.dp(this, 160)));
        ObjectAnimator float1 = ObjectAnimator.ofFloat(logo, "translationY", 0, -Ui.dp(this, 10));
        float1.setDuration(1800);
        float1.setRepeatMode(ValueAnimator.REVERSE);
        float1.setRepeatCount(ValueAnimator.INFINITE);
        float1.start();

        TextView title = Ui.text(this, "CHESS AUTO BOT", 30, Ui.GOLD);
        title.setLetterSpacing(0.12f);
        title.setGravity(Gravity.CENTER);
        title.setShadowLayer(Ui.dp(this, 12), 0, 0, 0x88F5C451);
        title.getPaint().setShader(new LinearGradient(0, 0, 0, Ui.dp(this, 36), 0xFFFFF3C4, 0xFFE0A93A, Shader.TileMode.CLAMP));
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(-2, -2);
        tlp.topMargin = Ui.dp(this, 26);
        col.addView(title, tlp);

        // 봇 시작하기 / 멈추기
        startBtn = new Ui.IconButton(this, 20, 24);
        startBtn.setElevation(Ui.dp(this, 10));
        startBtn.setOnClickListener(v -> toggle());
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(-1, Ui.dp(this, 66));
        blp.topMargin = Ui.dp(this, 48);
        col.addView(startBtn, blp);
        pulse = ObjectAnimator.ofPropertyValuesHolder(startBtn,
                PropertyValuesHolder.ofFloat("scaleX", 1f, 1.04f), PropertyValuesHolder.ofFloat("scaleY", 1f, 1.04f));
        pulse.setDuration(700);
        pulse.setRepeatMode(ValueAnimator.REVERSE);
        pulse.setRepeatCount(ValueAnimator.INFINITE);

        View bottom = new View(this);
        col.addView(bottom, new LinearLayout.LayoutParams(1, 0, 1));

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
                .setIcon(R.drawable.ic_globe)
                .setTitle(I18n.t(this, I18n.LANG))
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
        langBtn.set(R.drawable.ic_globe, I18n.NAMES[I18n.current(this)], Ui.DARK);
        startBtn.set(on ? R.drawable.ic_stop : R.drawable.ic_play,
                I18n.t(this, on ? I18n.STOP : I18n.START), on ? Ui.RED : Ui.GREEN);
        if (on) { if (!pulse.isStarted()) pulse.start(); }
        else { pulse.cancel(); startBtn.setScaleX(1); startBtn.setScaleY(1); }
        int dir = I18n.rtl(this) ? View.LAYOUT_DIRECTION_RTL : View.LAYOUT_DIRECTION_LTR;
        getWindow().getDecorView().setLayoutDirection(dir);
    }

    /** 배경: 남색 그라데이션 + 비스듬한 체스판 + 떠다니는 나이트 그림 */
    static final class Backdrop extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Drawable knight;
        private float t;

        Backdrop(Context c) {
            super(c);
            knight = c.getDrawable(R.drawable.knight).mutate();
        }

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
            for (int i = 0; i < 9; i++) {
                float ph = (t * (0.6f + i * 0.07f) + i * 0.137f) % 1f;
                float x = w * ((i * 0.31f + 0.07f) % 1f), y = h * (1.1f - ph * 1.2f);
                float kh = w * (0.08f + (i % 3) * 0.04f), kw = kh * 46f / 58f;
                knight.setAlpha((int) (45 * Math.sin(ph * Math.PI)));
                knight.setBounds((int) (x - kw / 2), (int) (y - kh / 2), (int) (x + kw / 2), (int) (y + kh / 2));
                knight.draw(c);
            }
            postInvalidateDelayed(33);
        }
    }
}
