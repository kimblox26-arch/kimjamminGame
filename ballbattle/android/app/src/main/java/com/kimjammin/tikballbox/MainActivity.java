package com.kimjammin.tikballbox;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

// 아이콘을 누르면 휴대폰 브라우저(크롬)에서 게임을 열어요.
// 다른 사람과의 실시간 대결·랭킹·영상 공유는 claude.ai 로그인이 필요해서, 이미 로그인된 브라우저에서 여는 게 가장 확실해요.
public class MainActivity extends Activity {
    static final String GAME_URL = "https://claude.ai/artifact/H9zyWVa5dB3p69ydMCYiLj";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(GAME_URL)));
        } catch (Exception ignored) { }
        finish();
    }
}
