package com.kimjammin.chessbot;

import android.content.Context;
import android.graphics.*;
import android.graphics.drawable.Drawable;
import android.view.View;

/** 체스 나이트 그림이 들어간 원형 버튼 (축소 상태 / 메인 로고) */
public class BubbleView extends View {
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Drawable knight;

    public BubbleView(Context c) {
        super(c);
        setLayerType(LAYER_TYPE_SOFTWARE, null); // 그림자 효과
        knight = c.getDrawable(R.drawable.knight);
    }

    @Override
    protected void onDraw(Canvas c) {
        float w = getWidth(), h = getHeight(), cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - w * 0.06f;
        p.setShader(null);
        p.setShadowLayer(w * 0.06f, 0, w * 0.02f, 0x99F5C451);
        p.setColor(Ui.NAVY);
        c.drawCircle(cx, cy, r, p);
        p.clearShadowLayer();
        // 금색 링
        p.setShader(new SweepGradient(cx, cy, new int[]{0xFFFFE08A, 0xFFD49B1F, 0xFFFFF3C4, 0xFFB7791F, 0xFFFFE08A}, null));
        c.drawCircle(cx, cy, r, p);
        // 안쪽: 남색 그라데이션 + 체스판 무늬
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
        // 나이트 그림
        float kh = ir * 1.2f, kw = kh * 46f / 58f;
        knight.setBounds((int) (cx - kw / 2), (int) (cy - kh / 2), (int) (cx + kw / 2), (int) (cy + kh / 2));
        knight.draw(c);
    }
}
