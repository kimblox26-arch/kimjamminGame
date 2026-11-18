#!/usr/bin/env bash
# 수능 감독관 APK 빌드 (Gradle 없이 Android SDK 기본 도구만 사용)
# 사용: ANDROID_SDK=<SDK 경로> ./build.sh   → suneung/android/suneung.apk
# 필요: JDK 17+, Android SDK 의 "platforms;android-34", "build-tools;34.0.0"
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_SDK:?ANDROID_SDK 를 SDK 경로로 지정하세요}"; BT="$SDK/build-tools/34.0.0"; JAR="$SDK/platforms/android-34/android.jar"
ROOT="$(cd ../.. && pwd)"; OUT=build; rm -rf "$OUT"; mkdir -p "$OUT/assets/suneung" "$OUT/assets/vendor" "$OUT/obj" "$OUT/dex"
cp -r "$ROOT/suneung/index.html" "$ROOT/suneung/style.css" "$ROOT/suneung/js" "$OUT/assets/suneung/"
cp -r "$ROOT/vendor/three" "$OUT/assets/vendor/"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$JAR" --manifest AndroidManifest.xml -A "$OUT/assets" \
  --min-sdk-version 24 --target-sdk-version 34 --version-code 1 --version-name 1.0
javac -source 8 -target 8 -bootclasspath "$JAR" -d "$OUT/obj" src/kr/kimjam/suneung/*.java 2>/dev/null
"$BT/d8" --release --lib "$JAR" --output "$OUT/dex" $(find "$OUT/obj" -name '*.class')
(cd "$OUT/dex" && zip -q ../base.apk classes.dex)
"$BT/zipalign" -f 4 "$OUT/base.apk" "$OUT/aligned.apk"
[ -f debug.keystore ] || keytool -genkeypair -keystore debug.keystore -storepass android -keypass android -alias debug \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Suneung Debug" >/dev/null 2>&1
"$BT/apksigner" sign --ks debug.keystore --ks-pass pass:android --out suneung.apk "$OUT/aligned.apk"
echo "완성: $(pwd)/suneung.apk"
