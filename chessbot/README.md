# Chess Auto Bot (Android)

## 설치
GitHub → Actions → `Chess Auto Bot APK` → 최신 실행 → `ChessAutoBot-apk` 다운로드 → `app-debug.apk` 설치

## 화면
| 화면 | 기능 |
|---|---|
| 메인 | 언어 설정(20개 언어) · 봇 시작하기(초록) / 멈추기(빨강) |
| 떠 있는 창 | 봇 작동하기 버튼 · 닫기 |
| 닫기 | 체스 나이트 그림 원형 버튼으로 축소 → 누르면 다시 창으로 |

- 앱을 나가도 창이 계속 떠 있습니다('다른 앱 위에 표시' 권한 필요).
- 다른 체스 앱을 자동으로 터치해 두는 기능은 들어 있지 않습니다.

## 빌드
```
cd chessbot && gradle assembleDebug   # Android SDK 필요 (compileSdk 34, minSdk 26)
```
