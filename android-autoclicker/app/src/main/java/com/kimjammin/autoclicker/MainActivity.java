package com.kimjammin.autoclicker;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    static final int BG = 0xFF0F172A, CARD = 0xFF1E293B, LINE = 0xFF334155, MUTED = 0xFF94A3B8;
    static final int[] GRAD = {0xFF7C3AED, 0xFFEC4899};
    private TextView status;

    private int dp(int v) { return Ui.dp(this, v); }

    private LinearLayout card(int orientation) {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(orientation);
        c.setPadding(dp(18), dp(16), dp(18), dp(16));
        c.setBackground(Ui.rounded(this, CARD, 20, LINE));
        return c;
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        SharedPreferences sp = getSharedPreferences("cfg", MODE_PRIVATE);
        if (!sp.getBoolean("arrow_default", false)) // 기본 모양 = 컴퓨터 화살표
            sp.edit().putInt("style", CursorView.DEFAULT).putBoolean("arrow_default", true).apply();
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(22), dp(28), dp(22), dp(22));
        root.setBackgroundColor(BG);

        // 헤더: 로고 + 이름
        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        header.addView(logo, new LinearLayout.LayoutParams(dp(52), dp(52)));
        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setPadding(dp(14), 0, 0, 0);
        titles.addView(Ui.text(this, "오토 마우스", 24, Color.WHITE, true));
        titles.addView(Ui.text(this, "자동 클릭 도우미", 13, MUTED, false));
        header.addView(titles);
        root.addView(header);

        status = Ui.text(this, "", 13, Color.WHITE, true);
        status.setPadding(dp(12), dp(6), dp(12), dp(6));
        status.setBackground(Ui.rounded(this, CARD, 20, 0));
        LinearLayout.LayoutParams sl = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        sl.topMargin = dp(16);
        root.addView(status, sl);

        // 가운데: 큰 원형 시작 버튼
        LinearLayout center = new LinearLayout(this);
        center.setOrientation(LinearLayout.VERTICAL);
        center.setGravity(Gravity.CENTER);
        FrameLayout ringBox = new FrameLayout(this);
        View ring = new View(this);
        GradientDrawable rg = new GradientDrawable();
        rg.setShape(GradientDrawable.OVAL);
        rg.setStroke(dp(2), 0x66A855F7);
        ring.setBackground(rg);
        ringBox.addView(ring, new FrameLayout.LayoutParams(dp(224), dp(224), Gravity.CENTER));
        TextView start = Ui.text(this, "▶\n시작", 26, Color.WHITE, true);
        start.setGravity(Gravity.CENTER);
        start.setLineSpacing(0, 1.1f);
        GradientDrawable sg = new GradientDrawable(GradientDrawable.Orientation.TL_BR, GRAD);
        sg.setShape(GradientDrawable.OVAL);
        start.setBackground(sg);
        start.setElevation(dp(10));
        ringBox.addView(start, new FrameLayout.LayoutParams(dp(180), dp(180), Gravity.CENTER));
        center.addView(ringBox, new LinearLayout.LayoutParams(dp(232), dp(232)));
        TextView hint = Ui.text(this, "누르면 화면에 마우스가 나타나요", 14, MUTED, false);
        hint.setPadding(0, dp(14), 0, 0);
        center.addView(hint);
        root.addView(center, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        start.setOnClickListener(v -> {
            if (ClickService.instance == null) {
                Toast.makeText(this, "접근성에서 '오토 마우스'를 먼저 켜 주세요", Toast.LENGTH_LONG).show();
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            } else {
                ClickService.instance.showPanel();
                moveTaskToBack(true); // 다른 앱 위에 마우스가 보이도록 이 화면을 뒤로
            }
        });

        // 설정 카드
        LinearLayout settings = card(LinearLayout.HORIZONTAL);
        settings.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout st = new LinearLayout(this);
        st.setOrientation(LinearLayout.VERTICAL);
        st.addView(Ui.text(this, "⚙  설정", 17, Color.WHITE, true));
        TextView sd = Ui.text(this, "모양 · 크기 · 투명도 · 속도", 13, MUTED, false);
        sd.setPadding(0, dp(2), 0, 0);
        st.addView(sd);
        settings.addView(st, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        settings.addView(Ui.text(this, "›", 28, MUTED, false));
        settings.setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class)));
        Ui.add(this, root, settings, 0);

        // 사용법 카드
        LinearLayout help = card(LinearLayout.VERTICAL);
        help.addView(Ui.text(this, "사용법", 15, Color.WHITE, true));
        TextView lines = Ui.text(this, "• 마우스 탭: 그 마우스만 시작 / 정지\n• 마우스 끌기: 위치 이동\n"
                + "• + 추가 · × 삭제 · ≡ 설정\n• 볼륨 ↓: 모두 정지", 13, 0xFFCBD5E1, false);
        lines.setLineSpacing(0, 1.35f);
        lines.setPadding(0, dp(6), 0, 0);
        help.addView(lines);
        Ui.add(this, root, help, 12);

        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        boolean on = ClickService.instance != null;
        status.setText(on ? "● 접근성 켜짐" : "● 접근성 꺼짐 · 시작을 누르면 설정으로 이동");
        status.setTextColor(on ? 0xFF4ADE80 : 0xFFF87171);
    }
}
