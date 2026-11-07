package com.kimjammin.chessbot;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.view.Gravity;
import android.widget.TextView;

final class Ui {
    static final int GOLD = 0xFFF5C451, NAVY = 0xFF0B1224, PANEL = 0xFF121A30, TEXT = 0xFFE8ECF5, MUTED = 0xFF8D97B0;
    static final int[] GREEN = {0xFF34D399, 0xFF10B981, 0xFF059669};
    static final int[] RED = {0xFFF87171, 0xFFEF4444, 0xFFB91C1C};
    static final int[] GOLDS = {0xFFFFE08A, 0xFFF5C451, 0xFFD49B1F};
    static final int[] DARK = {0xFF26324F, 0xFF1B2540};

    static int dp(Context c, float v) { return Math.round(v * c.getResources().getDisplayMetrics().density); }

    static GradientDrawable bg(int[] colors, float radius, int stroke, int strokeW) {
        GradientDrawable g = new GradientDrawable(GradientDrawable.Orientation.TL_BR, colors);
        g.setCornerRadius(radius);
        if (strokeW > 0) g.setStroke(strokeW, stroke);
        return g;
    }

    static TextView text(Context c, String s, float sp, int color, boolean bold) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        return t;
    }

    static TextView button(Context c, String s, int[] colors, float sp) {
        TextView b = text(c, s, sp, 0xFFFFFFFF, true);
        b.setGravity(Gravity.CENTER);
        b.setClickable(true);
        b.setFocusable(true);
        setColors(b, colors);
        int p = dp(c, 10);
        b.setPadding(p, p, p, p);
        return b;
    }

    static void setColors(TextView b, int[] colors) {
        float r = dp(b.getContext(), 100);
        b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x55FFFFFF), bg(colors, r, 0x33FFFFFF, dp(b.getContext(), 1)), null));
    }
}
