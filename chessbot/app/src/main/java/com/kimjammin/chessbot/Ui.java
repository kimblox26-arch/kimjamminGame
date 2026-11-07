package com.kimjammin.chessbot;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

final class Ui {
    static final int GOLD = 0xFFF5C451, NAVY = 0xFF0B1224, TEXT = 0xFFE8ECF5;
    static final int[] GREEN = {0xFF34D399, 0xFF10B981, 0xFF059669};
    static final int[] RED = {0xFFF87171, 0xFFEF4444, 0xFFB91C1C};
    static final int[] DARK = {0xFF26324F, 0xFF1B2540};

    static int dp(Context c, float v) { return Math.round(v * c.getResources().getDisplayMetrics().density); }

    static GradientDrawable bg(int[] colors, float radius, int stroke, int strokeW) {
        GradientDrawable g = new GradientDrawable(GradientDrawable.Orientation.TL_BR, colors);
        g.setCornerRadius(radius);
        if (strokeW > 0) g.setStroke(strokeW, stroke);
        return g;
    }

    static TextView text(Context c, String s, float sp, int color) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        t.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        return t;
    }

    static void setColors(View v, int[] colors) {
        v.setBackground(new RippleDrawable(ColorStateList.valueOf(0x55FFFFFF),
                bg(colors, dp(v.getContext(), 100), 0x33FFFFFF, dp(v.getContext(), 1)), null));
    }

    /** 그림 아이콘 + 글자 버튼 (가운데 정렬) */
    static final class IconButton extends LinearLayout {
        final ImageView icon;
        final TextView label;

        IconButton(Context c, float sp, int iconDp) {
            super(c);
            setGravity(Gravity.CENTER);
            setClickable(true);
            setFocusable(true);
            int p = dp(c, 10);
            setPadding(p, p / 2, p, p / 2);
            icon = new ImageView(c);
            addView(icon, new LayoutParams(dp(c, iconDp), dp(c, iconDp)));
            label = text(c, "", sp, 0xFFFFFFFF);
            LayoutParams lp = new LayoutParams(-2, -2);
            lp.setMarginStart(dp(c, 8));
            addView(label, lp);
        }

        void set(int iconRes, String s, int[] colors) {
            icon.setImageResource(iconRes);
            label.setText(s);
            setColors(this, colors);
        }
    }
}
