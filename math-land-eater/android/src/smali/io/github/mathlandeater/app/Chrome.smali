.class public Lio/github/mathlandeater/app/Chrome;
.super Landroid/webkit/WebChromeClient;
.source "Chrome.java"

# 게임에서 사진 · 동영상 파일을 고를 때 폰의 파일 고르기 창을 띄운다
.field private act:Lio/github/mathlandeater/app/MainActivity;

.method public constructor <init>(Lio/github/mathlandeater/app/MainActivity;)V
    .registers 2
    invoke-direct {p0}, Landroid/webkit/WebChromeClient;-><init>()V
    iput-object p1, p0, Lio/github/mathlandeater/app/Chrome;->act:Lio/github/mathlandeater/app/MainActivity;
    return-void
.end method

.method public onShowFileChooser(Landroid/webkit/WebView;Landroid/webkit/ValueCallback;Landroid/webkit/WebChromeClient$FileChooserParams;)Z
    .registers 8
    iget-object v0, p0, Lio/github/mathlandeater/app/Chrome;->act:Lio/github/mathlandeater/app/MainActivity;
    iget-object v1, v0, Lio/github/mathlandeater/app/MainActivity;->cb:Landroid/webkit/ValueCallback;
    if-eqz v1, :cond_0
    const/4 v2, 0x0
    invoke-interface {v1, v2}, Landroid/webkit/ValueCallback;->onReceiveValue(Ljava/lang/Object;)V
    :cond_0
    iput-object p2, v0, Lio/github/mathlandeater/app/MainActivity;->cb:Landroid/webkit/ValueCallback;
    :try_start_0
    invoke-virtual {p3}, Landroid/webkit/WebChromeClient$FileChooserParams;->createIntent()Landroid/content/Intent;
    move-result-object v1
    const/4 v2, 0x1
    invoke-virtual {v0, v1, v2}, Landroid/app/Activity;->startActivityForResult(Landroid/content/Intent;I)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0
    const/4 v1, 0x1
    return v1
    :catch_0
    move-exception v1
    const/4 v2, 0x0
    iput-object v2, v0, Lio/github/mathlandeater/app/MainActivity;->cb:Landroid/webkit/ValueCallback;
    const/4 v1, 0x0
    return v1
.end method
