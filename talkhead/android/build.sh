#!/usr/bin/env bash
# 보이스 엑스레이 안드로이드 APK 빌드 (Ubuntu: apt install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23)
# 사용: talkhead/android/build.sh   → talkhead/apk/VoiceXRay.apk
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"
SDK_JAR=${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
OUT="$ROOT/apk"; B="${BUILD_DIR:-$(mktemp -d)}"
KS="${KEYSTORE:-$HOME/.android/voicexray.keystore}"; KP="${KEYPASS:-voicexray}"
mkdir -p "$OUT" "$B/assets/www" "$B/gen" "$B/classes" "$(dirname "$KS")"
cp -r "$ROOT/index.html" "$ROOT/style.css" "$ROOT/js" "$B/assets/www/"
aapt package -f -M "$HERE/AndroidManifest.xml" -S "$HERE/res" -A "$B/assets" -I "$SDK_JAR" -J "$B/gen" \
  --min-sdk-version 26 --target-sdk-version 34 --version-code "${VERSION_CODE:-3}" --version-name "${VERSION_NAME:-1.2}" -F "$B/unsigned.apk"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -bootclasspath "$SDK_JAR" -d "$B/classes" \
  $(find "$B/gen" "$HERE/src" -name '*.java')
dalvik-exchange --dex --min-sdk-version=26 --output="$B/classes.dex" "$B/classes"
(cd "$B" && aapt add -f unsigned.apk classes.dex >/dev/null)
zipalign -f 4 "$B/unsigned.apk" "$B/aligned.apk"
[ -f "$KS" ] || keytool -genkeypair -keystore "$KS" -storepass "$KP" -keypass "$KP" -alias voicexray \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Voice X-Ray" >/dev/null 2>&1
apksigner sign --v4-signing-enabled false --ks "$KS" --ks-pass "pass:$KP" --key-pass "pass:$KP" --out "$OUT/VoiceXRay.apk" "$B/aligned.apk"
apksigner verify --print-certs "$OUT/VoiceXRay.apk" | head -2
ls -l "$OUT/VoiceXRay.apk"
