package kr.kimjam.suneung;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

// https://appassets.androidplatform.net/... 요청을 앱 assets 파일로 응답
public class AssetClient extends WebViewClient {
  public static final String HOST = "appassets.androidplatform.net";
  private final AssetManager assets;
  public AssetClient(AssetManager a) { assets = a; }
  @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
    Uri u = r.getUrl();
    if (!HOST.equals(u.getHost()) || u.getPath() == null) return null;
    String p = u.getPath().substring(1);
    try { return new WebResourceResponse(mime(p), "utf-8", assets.open(p)); } catch (Exception e) { return null; }
  }
  private static String mime(String p) {
    if (p.endsWith(".html")) return "text/html";
    if (p.endsWith(".js")) return "text/javascript";
    if (p.endsWith(".css")) return "text/css";
    return "application/octet-stream";
  }
}
