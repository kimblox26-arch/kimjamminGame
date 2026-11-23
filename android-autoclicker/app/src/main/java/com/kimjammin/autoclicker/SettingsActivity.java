package com.kimjammin.autoclicker;

import android.app.Activity;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

public class SettingsActivity extends Activity {
    private static final int BG = MainActivity.BG, CARD = MainActivity.CARD, LINE = MainActivity.LINE,
            MUTED = MainActivity.MUTED, ACCENT = 0xFFA855F7;

    private abstract static class OnSeek implements SeekBar.OnSeekBarChangeListener {
        @Override public void onStartTrackingTouch(SeekBar s) {}
        @Override public void onStopTrackingTouch(SeekBar s) {}
    }

    private int dp(int v) { return Ui.dp(this, v); }

    private FrameLayout.LayoutParams lpFor(int size) {
        int px = dp(24 + size * 6);
        return new FrameLayout.LayoutParams(px, px, Gravity.CENTER);
    }

    private static String alphaText(int a) { return "투명도 " + a + "  (1 불투명 · 100 가장 투명)"; }

    private TextView muted(String s) { return Ui.text(this, s, 13, MUTED, false); }

    private Spinner spinner(String[] items, int sel) {
        Spinner s = new Spinner(this);
        s.setAdapter(new ArrayAdapter<String>(this, android.R.layout.simple_spinner_dropdown_item, items) {
            @Override public View getView(int pos, View cv, ViewGroup parent) {
                TextView t = (TextView) super.getView(pos, cv, parent);
                t.setTextColor(Color.WHITE);
                return t;
            }
            @Override public View getDropDownView(int pos, View cv, ViewGroup parent) {
                TextView t = (TextView) super.getDropDownView(pos, cv, parent);
                t.setTextColor(Color.WHITE);
                return t;
            }
        });
        s.setSelection(Math.max(0, Math.min(sel, items.length - 1)));
        s.setBackground(Ui.rounded(this, BG, 12, LINE));
        s.setPopupBackgroundDrawable(Ui.rounded(this, CARD, 12, LINE));
        return s;
    }

    private EditText number(long v) {
        EditText e = new EditText(this);
        e.setInputType(InputType.TYPE_CLASS_NUMBER);
        e.setText(String.valueOf(v));
        e.setTextColor(Color.WHITE);
        e.setBackground(Ui.rounded(this, BG, 12, LINE));
        e.setPadding(dp(14), dp(12), dp(14), dp(12));
        return e;
    }

    private SeekBar seek(int max, int progress) {
        SeekBar s = new SeekBar(this);
        s.setMax(max);
        s.setProgress(progress);
        ColorStateList c = ColorStateList.valueOf(ACCENT);
        s.setProgressTintList(c);
        s.setThumbTintList(c);
        return s;
    }

    private LinearLayout section(LinearLayout root, String title) {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(dp(16), dp(14), dp(16), dp(16));
        c.setBackground(Ui.rounded(this, CARD, 18, LINE));
        c.addView(Ui.text(this, title, 15, Color.WHITE, true));
        Ui.add(this, root, c, 12);
        return c;
    }

    private static long parse(EditText e, long def) {
        try { return Long.parseLong(e.getText().toString().trim()); } catch (NumberFormatException x) { return def; }
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        SharedPreferences sp = getSharedPreferences("cfg", MODE_PRIVATE);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(20), dp(20), dp(24));

        LinearLayout head = new LinearLayout(this);
        head.setGravity(Gravity.CENTER_VERTICAL);
        TextView back = Ui.text(this, "‹", 32, Color.WHITE, false);
        back.setPadding(0, 0, dp(14), 0);
        back.setOnClickListener(v -> finish());
        head.addView(back);
        head.addView(Ui.text(this, "설정", 24, Color.WHITE, true));
        root.addView(head);

        int style0 = ClickService.styleOf(sp), size0 = sp.getInt("size", 5), alpha0 = sp.getInt("alpha", 1);

        // 미리보기
        FrameLayout box = new FrameLayout(this);
        box.setBackground(Ui.rounded(this, CARD, 18, LINE));
        box.setMinimumHeight(dp(150));
        CursorView preview = new CursorView(this, style0);
        preview.setAlpha(ClickService.alphaOf(alpha0));
        box.addView(preview, lpFor(size0));
        Ui.add(this, root, box, 16);

        // 마우스 모양
        LinearLayout look = section(root, "마우스 모양");
        Spinner style = spinner(CursorView.NAMES, style0);
        style.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) { preview.setStyle(pos); }
            @Override public void onNothingSelected(AdapterView<?> p) {}
        });
        Ui.add(this, look, style, 10);
        TextView sizeLabel = muted("크기 " + size0);
        Ui.add(this, look, sizeLabel, 14);
        SeekBar size = seek(9, size0 - 1);
        size.setOnSeekBarChangeListener(new OnSeek() {
            @Override public void onProgressChanged(SeekBar s, int p, boolean u) {
                sizeLabel.setText("크기 " + (p + 1));
                preview.setLayoutParams(lpFor(p + 1));
            }
        });
        Ui.add(this, look, size, 4);
        TextView alphaLabel = muted(alphaText(alpha0));
        Ui.add(this, look, alphaLabel, 14);
        SeekBar alpha = seek(99, alpha0 - 1);
        alpha.setOnSeekBarChangeListener(new OnSeek() {
            @Override public void onProgressChanged(SeekBar s, int p, boolean u) {
                alphaLabel.setText(alphaText(p + 1));
                preview.setAlpha(ClickService.alphaOf(p + 1));
            }
        });
        Ui.add(this, look, alpha, 4);

        // 클릭 속도
        LinearLayout speed = section(root, "클릭 속도");
        Ui.add(this, speed, muted("클릭 간격 (0 = 최대 속도)"), 10);
        EditText value = number(sp.getLong("value", 1));
        Spinner unit = spinner(new String[]{"시간", "분", "초", "밀리초"}, sp.getInt("unit", 3));
        LinearLayout row = new LinearLayout(this);
        row.addView(value, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        LinearLayout.LayoutParams ul = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f);
        ul.leftMargin = dp(8);
        row.addView(unit, ul);
        Ui.add(this, speed, row, 8);
        Ui.add(this, speed, muted("누르는 시간 (밀리초) · 짧을수록 빠름, 안 눌리면 늘리기"), 14);
        EditText press = number(sp.getLong("press", 5));
        Ui.add(this, speed, press, 8);

        // 저장
        TextView save = Ui.text(this, "저장", 17, Color.WHITE, true);
        save.setGravity(Gravity.CENTER);
        save.setPadding(0, dp(16), 0, dp(16));
        GradientDrawable g = new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, MainActivity.GRAD);
        g.setCornerRadius(dp(16));
        save.setBackground(g);
        save.setOnClickListener(v -> {
            sp.edit()
                .putInt("style", style.getSelectedItemPosition())
                .putInt("size", size.getProgress() + 1)
                .putInt("alpha", alpha.getProgress() + 1)
                .putLong("value", Math.max(0, parse(value, 1)))
                .putInt("unit", unit.getSelectedItemPosition())
                .putLong("press", Math.max(1, Math.min(parse(press, 5), 10000)))
                .apply();
            if (ClickService.instance != null) ClickService.instance.refreshMice();
            Toast.makeText(this, "저장됨", Toast.LENGTH_SHORT).show();
            finish();
        });
        Ui.add(this, root, save, 20);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(BG);
        scroll.setFillViewport(true);
        scroll.addView(root);
        setContentView(scroll);
    }
}
