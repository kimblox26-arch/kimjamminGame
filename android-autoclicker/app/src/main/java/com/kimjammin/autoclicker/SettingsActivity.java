package com.kimjammin.autoclicker;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

public class SettingsActivity extends Activity {
    private FrameLayout.LayoutParams lpFor(int size) {
        int px = Ui.dp(this, 24 + size * 6);
        return new FrameLayout.LayoutParams(px, px, Gravity.CENTER);
    }

    private Spinner spinner(String[] items, int sel) {
        Spinner s = new Spinner(this);
        s.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, items));
        s.setSelection(sel);
        return s;
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        SharedPreferences sp = getSharedPreferences("cfg", MODE_PRIVATE);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(Ui.dp(this, 24), Ui.dp(this, 32), Ui.dp(this, 24), Ui.dp(this, 24));
        root.setBackgroundColor(0xFFF5F7FA);
        root.addView(Ui.text(this, "설정", 26, 0xFF111827, true));

        // 미리보기
        int size0 = sp.getInt("size", 5);
        CursorView preview = new CursorView(this, sp.getInt("style", 0));
        FrameLayout box = new FrameLayout(this);
        box.setBackground(Ui.rounded(this, 0xFFFFFFFF, 16, 0));
        box.setMinimumHeight(Ui.dp(this, 140));
        box.addView(preview, lpFor(size0));
        Ui.add(this, root, box, 20);

        // 마우스 크기 1~10
        TextView sizeLabel = Ui.text(this, "마우스 크기: " + size0, 14, 0xFF374151, false);
        Ui.add(this, root, sizeLabel, 24);
        SeekBar seek = new SeekBar(this);
        seek.setMax(9);
        seek.setProgress(size0 - 1);
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar s, int p, boolean user) {
                sizeLabel.setText("마우스 크기: " + (p + 1));
                preview.setLayoutParams(lpFor(p + 1));
            }
            @Override public void onStartTrackingTouch(SeekBar s) {}
            @Override public void onStopTrackingTouch(SeekBar s) {}
        });
        Ui.add(this, root, seek, 8);

        // 마우스 스타일
        Ui.add(this, root, Ui.text(this, "마우스 스타일", 14, 0xFF374151, false), 24);
        Spinner style = spinner(CursorView.NAMES, sp.getInt("style", 0));
        style.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) { preview.setStyle(pos); }
            @Override public void onNothingSelected(AdapterView<?> p) {}
        });
        Ui.add(this, root, style, 8);

        // 클릭 간격: 숫자 + 단위
        Ui.add(this, root, Ui.text(this, "클릭 간격 (0 = 최대 속도)", 14, 0xFF374151, false), 24);
        EditText value = new EditText(this);
        value.setInputType(InputType.TYPE_CLASS_NUMBER);
        value.setText(String.valueOf(sp.getLong("value", 1)));
        Spinner unit = spinner(new String[]{"시간", "분", "초", "밀리초"}, sp.getInt("unit", 3));
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.addView(value, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(unit, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        Ui.add(this, root, row, 8);

        Button save = Ui.button(this, "저장", true);
        save.setOnClickListener(v -> {
            long val;
            try { val = Long.parseLong(value.getText().toString().trim()); } catch (NumberFormatException e) { val = 1; }
            sp.edit()
                .putInt("size", seek.getProgress() + 1)
                .putInt("style", style.getSelectedItemPosition())
                .putLong("value", Math.max(0, val))
                .putInt("unit", unit.getSelectedItemPosition())
                .apply();
            Toast.makeText(this, "저장됨", Toast.LENGTH_SHORT).show();
            finish();
        });
        Ui.add(this, root, save, 32);

        setContentView(root);
    }
}
