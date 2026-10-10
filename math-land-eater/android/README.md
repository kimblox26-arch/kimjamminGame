# 매뜨 땅먹 안드로이드 앱 (APK)

게임 사이트(`https://math-land-eater.github.io/play/`)를 화면 가득 여는 앱이에요. 사진 · 동영상 고르기와 뒤로 가기를 지원해요.

- `src/`: 앱 소스 (apktool 형식: `AndroidManifest.xml`, `res/`, `smali/`)
- `math-land-eater.apk`: 서명된 앱 파일 → `node tools/build-static.js` 가 `docs/app/` 으로 복사해서 사이트에서 받을 수 있게 해요

## 구글 플레이용 AAB 만들기

1. `aapt2 compile --dir src/res -o res.zip`
2. `aapt2 link --proto-format -o base.apk -I android-framework.jar --manifest src/AndroidManifest.xml --min-sdk-version 24 --target-sdk-version 36 --version-code N --version-name X --auto-add-overlay res.zip`
   (aapt2 와 android-framework.jar 는 apktool 2.4.1 jar 안에 들어 있어요)
3. base.apk 를 풀어서 `manifest/AndroidManifest.xml`, `resources.pb`, `res/`, `dex/classes.dex`(APK에서 꺼낸 것) 모양으로 다시 묶어 `base.zip`
4. `java -jar bundletool-all-1.17.2.jar build-bundle --modules=base.zip --output=math-land-eater.aab` (bundletool 은 npm `bundletoolheavy` 안에 있어요)
5. `jarsigner ... math-land-eater.aab mle` 로 업로드 서명, `bundletool validate` 로 확인

## 다시 만들기 (APK)

1. apktool 2.4.1 (`npm pack apktool-jar` 안의 `bin/apktool_2.4.1.jar`)로 묶기: `java -jar apktool_2.4.1.jar b src -o unsigned.apk`
2. 서명: `jarsigner -sigalg SHA256withRSA -digestalg SHA-256 -keystore math-land-eater.keystore unsigned.apk mle`
3. 앱을 고쳐서 다시 낼 때는 `apktool.yml` 의 `versionCode` 를 1씩 올려요.

⚠️ 서명 열쇠(`math-land-eater.keystore`)와 비밀번호는 이 저장소에 **올리지 않아요** (공개 저장소). 따로 안전하게 보관해 주세요. 열쇠를 잃어버리면 같은 앱으로 업데이트할 수 없고, 지우고 다시 설치해야 해요.
