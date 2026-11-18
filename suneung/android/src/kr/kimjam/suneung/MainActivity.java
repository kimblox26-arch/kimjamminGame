package kr.kimjam.suneung;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

// 게임(HTML/JS)을 앱 안의 assets 에서 https 주소처럼 열어 주는 WebView 앱
public class MainActivity extends Activity {
  private static final String HOST = "appassets.androidplatform.net";
  private WebView web;

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setMediaPlaybackRequiresUserGesture(false);
    web.setWebViewClient(new WebViewClient() {
      @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
        Uri u = r.getUrl();
        if (!HOST.equals(u.getHost()) || u.getPath() == null) return null;
        String p = u.getPath().substring(1);
        try { return new WebResourceResponse(mime(p), "utf-8", getAssets().open(p)); } catch (Exception e) { return null; }
      }
    });
    setContentView(web);
    hideBars();
    web.loadUrl("https://" + HOST + "/suneung/index.html");
  }
  private static String mime(String p) {
    if (p.endsWith(".html")) return "text/html";
    if (p.endsWith(".js")) return "text/javascript";
    if (p.endsWith(".css")) return "text/css";
    return "application/octet-stream";
  }
  private void hideBars() {
    web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
      | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
  }
  @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) hideBars(); }
  @Override protected void onPause() { super.onPause(); web.onPause(); }
  @Override protected void onResume() { super.onResume(); web.onResume(); }
}
