package com.kimjammin.voicexray;

import android.app.Activity;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.ArrayList;
import java.util.Locale;

/** 게임(웹)을 WebView 로 띄우고, 안드로이드 음성 엔진(TTS)을 자바스크립트에 연결한다. */
public class MainActivity extends Activity {
    private WebView web;
    private TextToSpeech tts;
    private boolean ready = false;
    private final ArrayList<String[]> pending = new ArrayList<>();

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xFF060D14);
        getWindow().setNavigationBarColor(0xFF060D14);
        web = new WebView(this);
        web.setBackgroundColor(0xFF03070B);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Bridge(), "AndroidTTS");

        tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
            @Override public void onInit(int status) {
                synchronized (pending) {
                    ready = status == TextToSpeech.SUCCESS;
                    for (String[] p : pending) {
                        if (ready) say(p[0], p[1], p[2], Float.parseFloat(p[3]), Float.parseFloat(p[4]));
                        else send(p[0], "error", 0);
                    }
                    pending.clear();
                }
            }
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { send(id, "start", 0); }
            @Override public void onDone(String id) { send(id, "done", 0); }
            @Override public void onError(String id) { send(id, "error", 0); }
            @Override public void onStop(String id, boolean interrupted) { send(id, "error", 0); }
            // API 26+: 단어 경계 → 입 모양 동기화
            public void onRangeStart(String id, int start, int end, int frame) { send(id, "range", start); }
        });
        web.loadUrl("file:///android_asset/www/index.html");
    }

    private void say(String id, String text, String lang, float pitch, float rate) {
        tts.setLanguage(Locale.forLanguageTag(lang));
        tts.setPitch(pitch);
        tts.setSpeechRate(rate);
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, new Bundle(), id);
    }

    private void send(final String id, final String ev, final int a) {
        final String js = "window.__tts&&window.__tts('" + id.replace("'", "") + "','" + ev + "'," + a + ")";
        web.post(new Runnable() { @Override public void run() { web.evaluateJavascript(js, null); } });
    }

    class Bridge {
        @JavascriptInterface public boolean ready() { return ready; }
        @JavascriptInterface public void speak(String id, String text, String lang, float pitch, float rate) {
            synchronized (pending) {
                if (!ready) { pending.add(new String[]{id, text, lang, String.valueOf(pitch), String.valueOf(rate)}); return; }
            }
            say(id, text, lang, pitch, rate);
        }
        @JavascriptInterface public void stop() { tts.stop(); }
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.TalkHead&&TalkHead.back()", new ValueCallback<String>() {
            @Override public void onReceiveValue(String v) { if (!"true".equals(v)) finish(); }
        });
    }

    @Override protected void onPause() { super.onPause(); if (tts != null) tts.stop(); }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
