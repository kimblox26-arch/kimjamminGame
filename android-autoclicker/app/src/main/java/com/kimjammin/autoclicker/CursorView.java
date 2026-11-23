package com.kimjammin.autoclicker;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.View;

public class CursorView extends View {
    static final String[] NAMES = {"기본 화살표", "치즈", "삼각자", "피라미드", "삼각형"};
    private int style;
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();

    CursorView(Context c, int style) {
        super(c);
        this.style = style;
        fill.setStyle(Paint.Style.FILL);
        line.setStyle(Paint.Style.STROKE);
        line.setStrokeJoin(Paint.Join.ROUND);
    }

    void setStyle(int s) { style = s; invalidate(); }

    private float pad() { return 2 * getResources().getDisplayMetrics().density; }
    private float side() { return Math.min(getWidth(), getHeight()) - 2 * pad(); }

    /** 클릭이 찍히는 지점 (뷰 기준 픽셀). 화살표는 몸통 안쪽, 나머지는 중심. */
    float[] hot() {
        boolean arrow = style == 0;
        return new float[]{pad() + (arrow ? .12f : .5f) * side(), pad() + (arrow ? .45f : .5f) * side()};
    }

    private void poly(Canvas cv, float s, float... p) {
        path.reset();
        for (int i = 0; i < p.length; i += 2) {
            if (i == 0) path.moveTo(p[0] * s, p[1] * s);
            else path.lineTo(p[i] * s, p[i + 1] * s);
        }
        path.close();
        cv.drawPath(path, fill);
        cv.drawPath(path, line);
    }

    @Override protected void onDraw(Canvas cv) {
        float s = side();
        cv.translate(pad(), pad());
        line.setStrokeWidth(Math.max(1.5f, s / 24f));
        switch (style) {
            case 0: // 컴퓨터 기본 화살표
                fill.setColor(Color.WHITE); line.setColor(Color.BLACK);
                poly(cv, s, 0,0, 0,.85f, .22f,.66f, .40f,1f, .52f,.93f, .36f,.60f, .64f,.60f);
                break;
            case 1: // 치즈
                fill.setColor(0xFFFFD54F); line.setColor(0xFFF9A825);
                poly(cv, s, 0,.3f, .9f,0, 1f,.9f, .05f,1f);
                fill.setColor(0xFFF9A825);
                cv.drawCircle(.42f*s, .6f*s, .07f*s, fill);
                cv.drawCircle(.70f*s, .42f*s, .05f*s, fill);
                cv.drawCircle(.30f*s, .85f*s, .05f*s, fill);
                break;
            case 2: // 삼각자
                fill.setColor(0xFF90CAF9); line.setColor(0xFF1565C0);
                poly(cv, s, 0,0, 0,1f, 1f,1f);
                fill.setColor(Color.WHITE);
                cv.drawCircle(.30f*s, .70f*s, .10f*s, fill);
                break;
            case 3: // 피라미드
                fill.setColor(0xFFE6C78A); line.setColor(0xFF8D6E63);
                poly(cv, s, .5f,0, 1f,1f, 0,1f);
                cv.drawLine(.25f*s, .5f*s, .75f*s, .5f*s, line);
                cv.drawLine(.125f*s, .75f*s, .875f*s, .75f*s, line);
                break;
            default: // 삼각형
                fill.setColor(0xFFEF9A9A); line.setColor(0xFFC62828);
                poly(cv, s, .5f,0, 1f,1f, 0,1f);
                break;
        }
    }
}
