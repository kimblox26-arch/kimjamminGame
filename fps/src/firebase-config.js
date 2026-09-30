// Firebase 프로젝트 설정 (로그인·회원가입·클라우드 저장)
// 1) https://console.firebase.google.com → 프로젝트 만들기 → 웹 앱 추가 → 아래 값 복사
// 2) Authentication → 로그인 방법: Google · 이메일/비밀번호 · 전화 사용 설정
// 3) Authentication → 설정 → 승인된 도메인에 게임 주소(예: kimblox26-arch.github.io) 추가
// 4) Firestore Database 만들기 (규칙: players/{uid} 는 본인만 읽기/쓰기)
// 값이 null 이면 게스트 모드(이 기기 localStorage 저장)로만 동작합니다.
export const FIREBASE_CONFIG = null;
// 예시:
// export const FIREBASE_CONFIG = { apiKey: 'AIza...', authDomain: 'my-game.firebaseapp.com', projectId: 'my-game', appId: '1:123:web:abc' };
