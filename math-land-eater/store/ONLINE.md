# 매뜨 땅먹 — 온라인 대결 켜기 (Firebase, 무료)

✅ **설정 완료 (2026-10-03)**: 프로젝트 `math-land-eater` 의 설정값이 `public/js/firebase-config.js` 에 들어 있어서, 사이트는 **온라인**이에요. 아래는 처음부터 다시 만들 때의 방법이에요.
구글 계정이 필요하니 **부모님과 함께** 해 주세요. 무료 요금제(Spark)로 충분해요.

## 1. 프로젝트 만들기
1. https://console.firebase.google.com 에 구글 계정으로 들어가요.
2. **프로젝트 추가** → 이름 `math-land-eater` → Google 애널리틱스는 **끄기** → 만들기.

## 2. 익명 로그인 켜기
1. 왼쪽 **빌드 → Authentication → 시작하기**.
2. **로그인 방법** 탭 → **익명** → 사용 설정 → 저장.
3. **설정** 탭 → **승인된 도메인** → 도메인 추가 → `math-land-eater.github.io`.

## 3. 데이터베이스 만들기 (Realtime Database)
1. 왼쪽 **빌드(데이터베이스 및 스토리지) → Realtime Database → 데이터베이스 만들기**.
2. 위치: `싱가포르 (asia-southeast1)` → **잠금 모드** → 사용 설정.
3. **규칙** 탭에 저장소의 [`database.rules.json`](../database.rules.json) 내용을 그대로 붙여 넣고 **게시**.
4. **데이터** 탭 맨 위의 주소(`https://...firebasedatabase.app`)를 `firebase-config.js` 의 `databaseURL` 에 넣어요.

> 예전에 쓰던 Firestore 는 `databaseURL` 이 없을 때만 써요. ([`firestore.rules`](../firestore.rules))

## 4. 웹 앱 설정값 받기
1. 왼쪽 위 톱니바퀴 → **프로젝트 설정** → 아래 **내 앱** → 웹 아이콘 `</>`.
2. 앱 닉네임 `매뜨 땅먹` → 앱 등록.
3. 나오는 `const firebaseConfig = { ... }` 안의 값을 복사해서 **저(Claude)에게 보내 주세요.**
   - `apiKey` 같은 이 값은 비밀번호가 아니에요. 사이트에 공개돼도 괜찮은 값이에요. (지키는 일은 2·3번의 로그인과 규칙이 해요.)
4. 제가 [`public/js/firebase-config.js`](../public/js/firebase-config.js) 에 넣고 사이트를 다시 올리면 끝!
   게임 왼쪽 위 표시가 **오프라인** → **온라인** 으로 바뀌어요.

## 알아둘 것
- **계정은 기기마다 따로**예요. 다른 폰에서는 새로 가입해야 해요. (아이디는 전국에서 하나뿐이라 겹치지 않아요.)
- 무료 한도: **읽기·쓰기 횟수 제한이 없어요.** 한 달에 주고받는 양 10GB, 저장 1GB, 동시 접속 100명까지. 게임은 바뀐 칸·새 채팅만 주고받아서 아주 조금씩 써요.
- 운영자 초대, 밴, 학교 깃발도 모두 친구들과 함께 써요.

## 오래오래 유지하려면
- **서버를 켜 둘 필요가 없어요.** GitHub Pages(사이트)와 Firebase(땅·채팅 저장)는 24시간 알아서 돌아가요. 무료 요금제에는 끝나는 날이 없어요.
- **지우지 말아야 할 것**: 구글 계정(kimblox26), GitHub 계정과 단체 `math-land-eater`, 저장소 `math-land-eater.github.io`(공개로 두기), Firebase 프로젝트 `math-land-eater`, Realtime Database 와 규칙.
- **보호자를 Firebase 소유자로 추가**: 프로젝트 설정 → 사용자 및 권한 → 구성원 추가 → 역할 **소유자**. 계정을 잃어버려도 보호자가 게임 서버를 지킬 수 있어요.
- **무료 한도**(한 달 10GB · 동시 100명)를 넘으면 그 달은 연결이 잘 안 될 수 있어요. 카드를 등록하지 않았으면 **돈은 절대 나가지 않아요.** 사용량은 Realtime Database → 사용량 탭에서 볼 수 있어요.
- 서버 초기화를 하면 지난 땅 기록은 저절로 지워져서 저장소가 가볍게 유지돼요. 3일 지난 소식·채팅도 가끔 저절로 지워져요.
