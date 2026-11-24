package com.kimjammin.nightshift;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONArray;
import org.json.JSONObject;
import android.speech.tts.Voice;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

// 게임(HTML/JS)을 앱 안에서 띄우고, 음성인식(SpeechRecognizer)·한국어 음성합성(TTS)을 JS 에 연결한다
public class MainActivity extends Activity {
    static final String HOST = "app.nightshift.local";
    WebView web; TextToSpeech tts; boolean ttsReady; SpeechRecognizer sr; boolean listenAfterPerm;
    final Handler ui = new Handler(Looper.getMainLooper());

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        web = new WebView(this);
        setContentView(web);
        immersive();
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false); s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.setBackgroundColor(0xff05070c);
        web.addJavascriptInterface(new Bridge(), "NativeApp");
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest r) { r.grant(r.getResources()); }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) { return serve(r.getUrl()); }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return !HOST.equals(r.getUrl().getHost()); }
        });
        String eng = getSharedPreferences("ns", MODE_PRIVATE).getString("engine", null);
        initTts(eng != null ? eng : (hasPkg("com.google.android.tts") ? "com.google.android.tts" : null));
        web.loadUrl("https://" + HOST + "/nightshift/index.html");
    }

    // 음성합성 엔진 준비 (구글 TTS 가 있으면 그걸 기본으로: 한국어 남/여 신경망 목소리)
    void initTts(String engine) {
        ttsReady = false;
        if (tts != null) { try { tts.shutdown(); } catch (Exception e) { } }
        TextToSpeech.OnInitListener l = st -> {
            if (st == TextToSpeech.SUCCESS) {
                tts.setLanguage(Locale.KOREAN); ttsReady = true;
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { }
                    @Override public void onDone(String id) { js("window.__nativeTts&&__nativeTts('done'," + JSONObject.quote(id) + ")"); }
                    @Override public void onError(String id) { onDone(id); }
                });
                js("window.__nativeTtsReady&&__nativeTtsReady()");
            } else if (engine != null) initTts(null);
        };
        tts = engine == null ? new TextToSpeech(this, l) : new TextToSpeech(this, l, engine);
    }
    boolean hasPkg(String p) { try { getPackageManager().getPackageInfo(p, 0); return true; } catch (Exception e) { return false; } }
    Voice findVoice(String name) {
        if (name == null || name.isEmpty()) return null;
        try { for (Voice v : tts.getVoices()) if (name.equals(v.getName())) return v; } catch (Exception e) { }
        return null;
    }

    // 앱 안의 assets/www 파일을 https://app.nightshift.local/ 주소로 제공 (ES 모듈이 동작하도록)
    WebResourceResponse serve(Uri u) {
        if (!HOST.equals(u.getHost())) return null;
        String p = u.getPath(); if (p == null || p.endsWith("/")) p = (p == null ? "/" : p) + "index.html";
        try {
            InputStream in = getAssets().open("www" + p);
            WebResourceResponse res = new WebResourceResponse(mime(p), p.matches(".*\\.(html|js|css|json|md)$") ? "utf-8" : null, in);
            Map<String, String> h = new HashMap<>(); h.put("Access-Control-Allow-Origin", "*"); h.put("Cache-Control", "no-cache");
            res.setResponseHeaders(h);
            return res;
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
        }
    }
    static String mime(String p) {
        String e = p.substring(p.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (e) {
            case "html": return "text/html"; case "js": case "mjs": return "application/javascript"; case "css": return "text/css";
            case "json": return "application/json"; case "glb": return "model/gltf-binary"; case "jpg": case "jpeg": return "image/jpeg";
            case "png": return "image/png"; case "ogg": return "audio/ogg"; case "mp3": return "audio/mpeg"; case "svg": return "image/svg+xml";
            default: return "application/octet-stream";
        }
    }
    void js(String code) { ui.post(() -> web.evaluateJavascript(code, null)); }
    void immersive() {
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) immersive(); }
    @Override public void onBackPressed() { js("window.__nativeBack&&__nativeBack()"); }
    @Override protected void onPause() { super.onPause(); web.onPause(); if (tts != null) tts.stop(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onDestroy() { if (tts != null) tts.shutdown(); if (sr != null) sr.destroy(); web.destroy(); super.onDestroy(); }

    boolean hasMic() { return Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED; }
    void askMic() { if (Build.VERSION.SDK_INT >= 23) requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 7); }
    @Override public void onRequestPermissionsResult(int c, String[] p, int[] r) {
        boolean ok = r.length > 0 && r[0] == PackageManager.PERMISSION_GRANTED;
        if (ok && listenAfterPerm) beginListen(); else if (!ok && listenAfterPerm) js("window.__nativeSpeech&&__nativeSpeech('error','perm')");
        listenAfterPerm = false;
    }

    void beginListen() {
        if (!hasMic()) { listenAfterPerm = true; askMic(); return; }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { js("window.__nativeSpeech&&__nativeSpeech('error','unsupported')"); return; }
        if (sr == null) {
            sr = SpeechRecognizer.createSpeechRecognizer(this);
            sr.setRecognitionListener(new RecognitionListener() {
                public void onReadyForSpeech(Bundle p) { }
                public void onBeginningOfSpeech() { }
                public void onRmsChanged(float v) { js("window.__nativeSpeech&&__nativeSpeech('level'," + v + ")"); }
                public void onBufferReceived(byte[] b) { }
                public void onEndOfSpeech() { }
                public void onError(int e) { js("window.__nativeSpeech&&__nativeSpeech('error','" + e + "')"); }
                public void onResults(Bundle r) { send("final", r); }
                public void onPartialResults(Bundle r) { send("partial", r); }
                public void onEvent(int t, Bundle p) { }
                void send(String ev, Bundle r) {
                    ArrayList<String> l = r.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    String t = l != null && !l.isEmpty() ? l.get(0) : "";
                    js("window.__nativeSpeech&&__nativeSpeech('" + ev + "'," + JSONObject.quote(t) + ")");
                }
            });
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR");
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        sr.startListening(i);
    }

    class Bridge {
        @JavascriptInterface public void speak(String text, float pitch, float rate, String id, String voice) {
            if (!ttsReady) { js("window.__nativeTts&&__nativeTts('done'," + JSONObject.quote(id) + ")"); return; }
            Voice v = findVoice(voice);
            if (v != null) tts.setVoice(v); else tts.setLanguage(Locale.KOREAN);
            tts.setPitch(pitch); tts.setSpeechRate(rate);
            Bundle p = new Bundle(); tts.speak(text, TextToSpeech.QUEUE_ADD, p, id);
        }
        @JavascriptInterface public String voices() {
            JSONArray a = new JSONArray();
            if (!ttsReady) return "[]";
            try {
                for (Voice v : tts.getVoices()) {
                    Locale l = v.getLocale(); if (l == null || !"ko".equals(l.getLanguage())) continue;
                    JSONObject o = new JSONObject();
                    o.put("name", v.getName()); o.put("quality", v.getQuality()); o.put("network", v.isNetworkConnectionRequired());
                    o.put("notInstalled", v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED));
                    a.put(o);
                }
            } catch (Exception e) { }
            return a.toString();
        }
        @JavascriptInterface public String engines() {
            JSONArray a = new JSONArray();
            try {
                for (TextToSpeech.EngineInfo e : tts.getEngines()) { JSONObject o = new JSONObject(); o.put("name", e.name); o.put("label", e.label); a.put(o); }
                JSONObject r = new JSONObject(); r.put("list", a); r.put("current", tts.getDefaultEngine()); return r.toString();
            } catch (Exception e) { return "{\"list\":[]}"; }
        }
        @JavascriptInterface public void setEngine(String pkg) {
            getSharedPreferences("ns", MODE_PRIVATE).edit().putString("engine", pkg).apply();
            ui.post(new Runnable() { public void run() { initTts(pkg); } });
        }
        @JavascriptInterface public String engine() { return getSharedPreferences("ns", MODE_PRIVATE).getString("engine", hasPkg("com.google.android.tts") ? "com.google.android.tts" : ""); }
        @JavascriptInterface public void stopSpeak() { if (tts != null) tts.stop(); }
        @JavascriptInterface public void startListen() { ui.post(new Runnable() { public void run() { MainActivity.this.beginListen(); } }); }
        @JavascriptInterface public void stopListen() { ui.post(() -> { if (sr != null) sr.stopListening(); }); }
        @JavascriptInterface public void requestMic() { ui.post(() -> { if (!hasMic()) askMic(); }); }
        @JavascriptInterface public boolean ttsReady() { return ttsReady; }
    }
}
