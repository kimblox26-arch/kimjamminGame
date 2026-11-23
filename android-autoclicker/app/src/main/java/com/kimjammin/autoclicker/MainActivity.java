package com.kimjammin.autoclicker;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private TextView status;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(Ui.dp(this, 24), Ui.dp(this, 72), Ui.dp(this, 24), Ui.dp(this, 24));
        root.setBackgroundColor(0xFFF5F7FA);

        root.addView(Ui.text(this, "오토 마우스", 30, 0xFF111827, true));
        Ui.add(this, root, Ui.text(this, "화면 위에 마우스를 띄워 자동으로 클릭합니다", 14, 0xFF6B7280, false), 8);

        Button start = Ui.button(this, "시작", true);
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

        Button settings = Ui.button(this, "설정", false);
        settings.setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class)));
        Ui.add(this, root, settings, 12);

        status = Ui.text(this, "", 13, 0xFF6B7280, false);
        Ui.add(this, root, status, 24);

        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        status.setText(ClickService.instance != null
                ? "● 접근성 켜짐" : "○ 접근성 꺼짐 (시작을 누르면 설정으로 이동합니다)");
    }
}
