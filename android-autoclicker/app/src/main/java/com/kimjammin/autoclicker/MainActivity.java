package com.kimjammin.autoclicker;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        SharedPreferences prefs = getSharedPreferences("cfg", MODE_PRIVATE);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        TextView help = new TextView(this);
        help.setText("1) '접근성 설정 열기' → 오토 마우스 켜기\n"
                + "2) 화면에 빨간 ⊕ 표적과 조작 패널이 뜹니다\n"
                + "3) ⊕를 클릭할 위치로 끌어다 놓고 ▶ 누르기\n"
                + "비상정지: 볼륨 아래 버튼\n\n클릭 간격 (ms, 0 = 최대 속도)");
        root.addView(help);

        EditText interval = new EditText(this);
        interval.setInputType(InputType.TYPE_CLASS_NUMBER);
        interval.setText(String.valueOf(prefs.getLong("interval", 1)));
        root.addView(interval);

        Button save = new Button(this);
        save.setText("간격 저장");
        save.setOnClickListener(v -> {
            long ms;
            try { ms = Long.parseLong(interval.getText().toString().trim()); } catch (Exception e) { ms = 1; }
            prefs.edit().putLong("interval", Math.max(0, ms)).apply();
            Toast.makeText(this, "저장됨: " + ms + "ms", Toast.LENGTH_SHORT).show();
        });
        root.addView(save);

        Button acc = new Button(this);
        acc.setText("접근성 설정 열기");
        acc.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        root.addView(acc);

        Button show = new Button(this);
        show.setText("패널 다시 띄우기");
        show.setOnClickListener(v -> {
            if (ClickService.instance != null) ClickService.instance.showOverlay();
            else Toast.makeText(this, "먼저 접근성에서 오토 마우스를 켜세요", Toast.LENGTH_SHORT).show();
        });
        root.addView(show);

        setContentView(root);
    }
}
