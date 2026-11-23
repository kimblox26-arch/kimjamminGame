package com.kimjammin.autoclicker;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    static final int BG = 0xFFF8FAFC, CARD = 0xFFFFFFFF, LINE = 0xFFE5E7EB, MUTED = 0xFF6B7280,
            TEXT = 0xFF111827, ACCENT = 0xFF4F46E5;
    private TextView status;

    private int dp(int v) { return Ui.dp(this, v); }

    private TextView button(String t, boolean primary) {
        TextView b = Ui.text(this, t, 17, primary ? 0xFFFFFFFF : TEXT, true);
        b.setGravity(Gravity.CENTER);
        b.setPadding(0, dp(16), 0, dp(16));
        b.setBackground(Ui.rounded(this, primary ? ACCENT : CARD, 14, primary ? 0 : LINE));
        return b;
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        SharedPreferences sp = getSharedPreferences("cfg", MODE_PRIVATE);
        if (!sp.getBoolean("arrow_default", false)) // 기본 모양 = 컴퓨터 화살표
            sp.edit().putInt("style", CursorView.DEFAULT).putBoolean("arrow_default", true).apply();
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        getWindow().getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(24), dp(64), dp(24), dp(24));
        root.setBackgroundColor(BG);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        root.addView(logo, new LinearLayout.LayoutParams(dp(88), dp(88)));
        TextView title = Ui.text(this, "오토 마우스", 28, TEXT, true);
        title.setGravity(Gravity.CENTER);
        Ui.add(this, root, title, 16);
        TextView sub = Ui.text(this, "원하는 곳을 자동으로 클릭해요", 14, MUTED, false);
        sub.setGravity(Gravity.CENTER);
        Ui.add(this, root, sub, 6);
        status = Ui.text(this, "", 13, MUTED, false);
        status.setGravity(Gravity.CENTER);
        Ui.add(this, root, status, 10);

        TextView start = button("시작", true);
        start.setOnClickListener(v -> {
            if (ClickService.instance == null) {
                Toast.makeText(this, "접근성에서 '오토 마우스'를 먼저 켜 주세요", Toast.LENGTH_LONG).show();
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            } else {
                ClickService.instance.showPanel();
                moveTaskToBack(true);
            }
        });
        Ui.add(this, root, start, 48);
        TextView settings = button("설정", false);
        settings.setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class)));
        Ui.add(this, root, settings, 12);

        TextView help = Ui.text(this, "마우스 탭: 시작 / 정지\n끌기: 이동  ·  + 추가  ·  × 삭제  ·  ≡ 설정\n볼륨 ↓: 모두 정지", 13, MUTED, false);
        help.setGravity(Gravity.CENTER);
        help.setLineSpacing(0, 1.4f);
        Ui.add(this, root, help, 32);

        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        boolean on = ClickService.instance != null;
        status.setText(on ? "● 준비됨" : "● 접근성 권한이 꺼져 있어요");
        status.setTextColor(on ? 0xFF16A34A : 0xFFDC2626);
    }
}
