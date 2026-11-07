package com.kimjammin.chessbot;

import android.content.Context;
import android.graphics.*;
import android.view.View;

/** 체스 나이트 엠블럼 원형 버튼 (축소 상태 / 메인 로고) */
public class BubbleView extends View {
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private boolean active;
    private float pulse;

    public BubbleView(Context c) {
        super(c);
        setLayerType(LAYER_TYPE_SOFTWARE, null); // 그림자 효과
    }

    public void setActive(boolean a) { active = a; invalidate(); }

    @Override
    protected void onDraw(Canvas c) {
        float w = getWidth(), h = getHeight(), cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - w * 0.06f;
        p.setShader(null);
        p.setStyle(Paint.Style.FILL);
        // 바깥 글로우
        p.setShadowLayer(w * 0.06f, 0, w * 0.02f, active ? 0xAA22C55E : 0x99F5C451);
        p.setColor(0xFF0B1224);
        c.drawCircle(cx, cy, r, p);
        p.clearShadowLayer();
        // 금색 링
        p.setShader(new SweepGradient(cx, cy, new int[]{0xFFFFE08A, 0xFFD49B1F, 0xFFFFF3C4, 0xFFB7791F, 0xFFFFE08A}, null));
        c.drawCircle(cx, cy, r, p);
        // 안쪽: 체스판 무늬 + 남색 그라데이션
        float ir = r * 0.86f;
        p.setShader(new RadialGradient(cx, cy - ir * 0.4f, ir * 1.4f, 0xFF2A3A66, 0xFF070B18, Shader.TileMode.CLAMP));
        c.drawCircle(cx, cy, ir, p);
        c.save();
        Path clip = new Path();
        clip.addCircle(cx, cy, ir, Path.Direction.CW);
        c.clipPath(clip);
        p.setShader(null);
        p.setColor(0x14FFFFFF);
        float cell = ir / 2;
        for (int i = -2; i < 2; i++)
            for (int j = -2; j < 2; j++)
                if (((i + j) & 1) == 0) c.drawRect(cx + i * cell, cy + j * cell, cx + (i + 1) * cell, cy + (j + 1) * cell, p);
        c.restore();
        // 나이트
        p.setTextAlign(Paint.Align.CENTER);
        p.setTextSize(ir * 1.45f);
        p.setTypeface(Typeface.DEFAULT_BOLD);
        Paint.FontMetrics fm = p.getFontMetrics();
        float ty = cy - (fm.ascent + fm.descent) / 2 + ir * 0.03f;
        p.setShadowLayer(ir * 0.12f, 0, ir * 0.06f, 0xCC000000);
        p.setShader(new LinearGradient(0, cy - ir, 0, cy + ir, 0xFFFFF6D6, 0xFFE0A93A, Shader.TileMode.CLAMP));
        c.drawText("♞︎", cx, ty, p);
        p.clearShadowLayer();
        p.setShader(null);
        // 작동 표시
        if (active) {
            pulse = (pulse + 0.04f) % 1f;
            float dr = r * 0.2f, dx = cx + r * 0.68f, dy = cy - r * 0.68f;
            p.setColor(Color.argb((int) (120 * (1 - pulse)), 34, 197, 94));
            c.drawCircle(dx, dy, dr * (1 + pulse), p);
            p.setColor(0xFF22C55E);
            c.drawCircle(dx, dy, dr, p);
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(dr * 0.3f);
            p.setColor(0xFF0B1224);
            c.drawCircle(dx, dy, dr, p);
            postInvalidateDelayed(40);
        }
    }
}
