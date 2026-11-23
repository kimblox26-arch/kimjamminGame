package com.kimjammin.autoclicker;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.CornerPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.View;

public class CursorView extends View {
    static final String[] NAMES = {"기본 화살표", "치즈", "삼각자", "피라미드", "삼각형", "피자",
            "수박", "삼각김밥", "경고 표지판", "산", "삼각 깃발"};
    static final int DEFAULT = 0;
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
        line.setStrokeCap(Paint.Cap.ROUND);
    }

    void setStyle(int s) { style = s; invalidate(); }

    private float pad() { return 2 * getResources().getDisplayMetrics().density; }
    private float side() { return Math.min(getWidth(), getHeight()) - 2 * pad(); }

    private void color(int f, int l) { fill.setColor(f); line.setColor(l); }

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

    /** x, y, r 세 개씩 원 그리기 */
    private void dots(Canvas cv, float s, int color, float... d) {
        fill.setColor(color);
        for (int i = 0; i + 2 < d.length; i += 3) cv.drawCircle(d[i] * s, d[i + 1] * s, d[i + 2] * s, fill);
    }

    @Override protected void onDraw(Canvas cv) {
        float s = side();
        float w = Math.max(1.5f, s / 24f);
        cv.translate(pad(), pad());
        fill.setPathEffect(null);
        line.setPathEffect(null);
        if (!(style == 0 || style == 2)) {
            // 왼쪽 위가 뾰족하지 않은 모양: 왼쪽 위 빨간 삼각형 끝 = 클릭 위치
            float k = s * .22f;
            color(0xFFDC2626, 0xFF111827);
            line.setStrokeWidth(w);
            poly(cv, 1f, 0, 0, k, 0, 0, k);
            float off = s * .14f;
            cv.translate(off, off);
            s -= off;
            w = Math.max(1.5f, s / 24f);
        }
        line.setStrokeWidth(w);
        switch (style) {
            case 0: // 컴퓨터 기본 화살표
                color(Color.WHITE, Color.BLACK);
                poly(cv, s, 0,0, 0,.85f, .22f,.66f, .40f,1f, .52f,.93f, .36f,.60f, .64f,.60f);
                break;
            case 1: // 치즈
                color(0xFFFFD54F, 0xFFE0A800);
                poly(cv, s, 0,.85f, 1f,.2f, 1f,.85f);
                dots(cv, s, 0xFFF9A825, .7f,.65f,.07f, .86f,.45f,.05f, .45f,.75f,.05f);
                break;
            case 2: // 삼각자
                color(0xFF90CAF9, 0xFF1565C0);
                poly(cv, s, 0,0, 0,1f, 1f,1f);
                dots(cv, s, Color.WHITE, .3f,.7f,.1f);
                break;
            case 3: // 피라미드
                color(0xFFE6C78A, 0xFF8D6E63);
                poly(cv, s, .5f,0, 1f,1f, 0,1f);
                cv.drawLine(.25f*s, .5f*s, .75f*s, .5f*s, line);
                cv.drawLine(.125f*s, .75f*s, .875f*s, .75f*s, line);
                break;
            case 4: // 삼각형
                color(0xFFEF9A9A, 0xFFC62828);
                poly(cv, s, .5f,0, 1f,1f, 0,1f);
                break;
            case 5: // 피자
                color(0xFFFFC857, 0xFFB45309);
                poly(cv, s, 0,.05f, 1f,.05f, .5f,1f);
                line.setStrokeWidth(s * .1f); line.setColor(0xFFC2410C);
                cv.drawLine(.03f*s, .05f*s, .97f*s, .05f*s, line);
                dots(cv, s, 0xFFDC2626, .35f,.28f,.08f, .63f,.3f,.07f, .5f,.55f,.06f);
                break;
            case 6: // 수박
                color(0xFFEF4444, 0xFFB91C1C);
                poly(cv, s, 0,.08f, 1f,.08f, .5f,1f);
                line.setStrokeWidth(s * .12f); line.setColor(0xFF16A34A);
                cv.drawLine(.04f*s, .08f*s, .96f*s, .08f*s, line);
                dots(cv, s, 0xFF111827, .35f,.32f,.03f, .62f,.32f,.03f, .48f,.5f,.03f, .5f,.7f,.03f);
                break;
            case 7: { // 삼각김밥
                CornerPathEffect round = new CornerPathEffect(s * .15f);
                fill.setPathEffect(round); line.setPathEffect(round);
                color(Color.WHITE, 0xFF9CA3AF);
                poly(cv, s, .5f,.03f, .97f,.92f, .03f,.92f);
                fill.setPathEffect(null);
                fill.setColor(0xFF1F2937);
                cv.drawRect(.36f*s, .55f*s, .64f*s, .92f*s, fill);
                break;
            }
            case 8: { // 경고 표지판
                CornerPathEffect round = new CornerPathEffect(s * .06f);
                fill.setPathEffect(round); line.setPathEffect(round);
                color(0xFFFACC15, 0xFF111827);
                line.setStrokeWidth(w * 1.5f);
                poly(cv, s, .5f,.05f, .97f,.92f, .03f,.92f);
                line.setPathEffect(null);
                line.setStrokeWidth(s * .08f);
                cv.drawLine(.5f*s, .38f*s, .5f*s, .62f*s, line);
                dots(cv, s, 0xFF111827, .5f,.77f,.045f);
                break;
            }
            case 9: // 산
                color(0xFF64748B, 0xFF334155);
                poly(cv, s, .5f,.05f, 1f,.95f, 0,.95f);
                color(Color.WHITE, 0xFF334155);
                poly(cv, s, .5f,.05f, .68f,.37f, .32f,.37f);
                break;
            default: // 삼각 깃발
                line.setColor(0xFF374151); line.setStrokeWidth(s * .06f);
                cv.drawLine(.06f*s, 0, .06f*s, s, line);
                line.setStrokeWidth(w);
                color(0xFF8B5CF6, 0xFF5B21B6);
                poly(cv, s, .08f,.08f, 1f,.35f, .08f,.62f);
                break;
        }
    }
}
