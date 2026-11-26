#!/bin/bash
# 야간 편의점 APK 빌드 (Gradle 없이 Android SDK build-tools 로 직접)
#   필요: JDK, Android SDK (platforms;android-34, build-tools;35.0.0)
#   사용: ANDROID_HOME=/path/to/sdk ./build-apk.sh   → ../release/night-shift.apk
set -e
SDK=${ANDROID_HOME:-/opt/android-sdk}; BT=$SDK/build-tools/35.0.0; PLAT=$SDK/platforms/android-34/android.jar
D=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$D/../.." && pwd); OUT=$D/build
KS=${KEYSTORE:-$HOME/.android/nightshift.keystore}
rm -rf "$OUT"; mkdir -p "$OUT/assets/www/nightshift" "$OUT/assets/www/vendor/three" "$OUT/classes" "$OUT/gen" "$ROOT/nightshift/release"
# 웹 게임 파일 → assets/www
cp -r "$ROOT/nightshift/index.html" "$ROOT/nightshift/style.css" "$ROOT/nightshift/js" "$ROOT/nightshift/assets" "$OUT/assets/www/nightshift/"
cp -r "$ROOT/vendor/three/three.module.min.js" "$ROOT/vendor/three/addons" "$OUT/assets/www/vendor/three/"
mkdir -p "$OUT/assets/www/vendor/cannon-es" && cp "$ROOT/vendor/cannon-es/cannon-es.js" "$OUT/assets/www/vendor/cannon-es/"
# 리소스·매니페스트
"$BT/aapt2" compile --dir "$D/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$PLAT" --manifest "$D/AndroidManifest.xml" "$OUT/res.zip" -A "$OUT/assets" --java "$OUT/gen" -0 ogg -0 glb -0 jpg -0 png
# 자바 → dex
javac -nowarn --release 11 -cp "$PLAT" -d "$OUT/classes" $(find "$D/src" "$OUT/gen" -name '*.java') 2>&1 | grep -v "warning: \[options\]" || true
"$BT/d8" --min-api 24 --lib "$PLAT" --output "$OUT" $(find "$OUT/classes" -name '*.class')
(cd "$OUT" && zip -q base.apk classes.dex)
"$BT/zipalign" -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"
# 서명 (키가 없으면 새로 만든다. 같은 키로 서명해야 덮어쓰기 설치 가능)
if [ ! -f "$KS" ]; then mkdir -p "$(dirname "$KS")"; keytool -genkeypair -keystore "$KS" -storepass nightshift -keypass nightshift -alias nightshift -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=NightShift, O=kimjammin, C=KR" >/dev/null 2>&1; fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:nightshift --key-pass pass:nightshift --ks-key-alias nightshift --out "$ROOT/nightshift/release/night-shift.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify "$ROOT/nightshift/release/night-shift.apk" && ls -la "$ROOT/nightshift/release/night-shift.apk"
