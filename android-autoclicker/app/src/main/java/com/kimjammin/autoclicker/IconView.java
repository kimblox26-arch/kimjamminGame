package com.kimjammin.autoclicker;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.view.View;

/** 마우스 옆 아이콘: 0 = + (추가), 1 = × (삭제), 2 = ≡ (설정). 테두리 있는 굵은 선 */
public class IconView extends View {
    private final int type;
    private final Paint out = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint in = new Paint(Paint.ANTI_ALIAS_FLAG);

    IconView(Context c, int type) {
        super(c);
        this.type = type;
        out.setStyle(Paint.Style.STROKE);
        in.setStyle(Paint.Style.STROKE);
        out.setColor(0xFF111827);
        in.setColor(type == 0 ? 0xFF3730D9 : type == 1 ? 0xFFE11D48 : 0xFF6B7280);
        Paint.Cap cap = type == 2 ? Paint.Cap.SQUARE : Paint.Cap.ROUND;
        out.setStrokeCap(cap);
        in.setStrokeCap(cap);
    }

    @Override protected void onDraw(Canvas c) {
        float w = getWidth(), h = getHeight(), m = w * .2f;
        float[] l;
        if (type == 0) l = new float[]{w / 2, m, w / 2, h - m, m, h / 2, w - m, h / 2};
        else if (type == 1) l = new float[]{m, m, w - m, h - m, w - m, m, m, h - m};
        else l = new float[]{m, h * .27f, w - m, h * .27f, m, h * .5f, w - m, h * .5f, m, h * .73f, w - m, h * .73f};
        float t = type == 2 ? w * .15f : w * .17f;
        out.setStrokeWidth(t + w * .1f);
        in.setStrokeWidth(t);
        c.drawLines(l, out);
        c.drawLines(l, in);
    }
}
