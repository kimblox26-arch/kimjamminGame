package com.kimjammin.autoclicker;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private TextView status;

    private int dp(int v) { return Ui.dp(this, v); }

    private Button bigButton(String t, int bg, int fg, int stroke) {
        Button b = new Button(this);
        b.setText(t);
        b.setAllCaps(false);
        b.setTextSize(18);
        b.setTypeface(null, Typeface.BOLD);
        b.setTextColor(fg);
        b.setBackground(Ui.rounded(this, bg, 18, stroke));
        b.setMinHeight(dp(60));
        b.setStateListAnimator(null);
        return b;
    }

    private LinearLayout.LayoutParams wrap(int topDp) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.topMargin = dp(topDp);
        return p;
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        android.content.SharedPreferences sp = getSharedPreferences("cfg", MODE_PRIVATE);
        if (!sp.getBoolean("cone_default", false))
            sp.edit().putInt("style", CursorView.DEFAULT).putBoolean("cone_default", true).apply();
        getWindow().setStatusBarColor(0xFF1E1B4B);
        getWindow().setNavigationBarColor(0xFF1D4ED8);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(28), dp(24), dp(28), dp(24));
        root.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0xFF1E1B4B, 0xFF3730A3, 0xFF1D4ED8}));

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        root.addView(logo, new LinearLayout.LayoutParams(dp(104), dp(104)));

        TextView title = Ui.text(this, "오토 마우스", 34, Color.WHITE, true);
        title.setGravity(Gravity.CENTER);
        Ui.add(this, root, title, 20);
        TextView sub = Ui.text(this, "원하는 곳에 마우스를 올려두면\n자동으로 클릭해 드려요", 15, 0xCCFFFFFF, false);
        sub.setGravity(Gravity.CENTER);
        sub.setLineSpacing(0, 1.2f);
        Ui.add(this, root, sub, 10);

        Button start = bigButton("▶  시작", Color.WHITE, 0xFF312E81, 0);
        start.setOnClickListener(v -> {
            if (ClickService.instance == null) {
                Toast.makeText(this, "접근성에서 '오토 마우스'를 먼저 켜 주세요", Toast.LENGTH_LONG).show();
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            } else {
                ClickService.instance.showPanel();
                moveTaskToBack(true); // 다른 앱 위에 마우스가 보이도록 이 화면을 뒤로
            }
        });
        Ui.add(this, root, start, 48);

        Button settings = bigButton("⚙  설정", 0x26FFFFFF, Color.WHITE, 0x66FFFFFF);
        settings.setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class)));
        Ui.add(this, root, settings, 12);

        status = Ui.text(this, "", 13, Color.WHITE, true);
        status.setPadding(dp(14), dp(6), dp(14), dp(6));
        status.setBackground(Ui.rounded(this, 0x33000000, 20, 0));
        root.addView(status, wrap(28));

        root.addView(Ui.text(this, "마우스를 누르면 시작/정지 · 볼륨 ↓ 비상정지", 12, 0x99FFFFFF, false), wrap(12));

        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        boolean on = ClickService.instance != null;
        status.setText(on ? "● 접근성 켜짐" : "● 접근성 꺼짐 · 시작을 누르면 설정으로 이동");
        status.setTextColor(on ? 0xFF86EFAC : 0xFFFCA5A5);
    }
}
