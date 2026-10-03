/* 매뜨 땅먹 — 온라인 대결(친구들과 같은 지도) 설정
 * Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹) 의 firebaseConfig 값을 아래 null 대신 넣으면
 * 사이트판(math-land-eater.github.io)에서 전국 친구들이 같은 지도에서 땅을 뺏고 지킬 수 있어요.
 * 비어 있으면(null) 지금처럼 '혼자 하기 (이 기기)'로 돌아가요. 자세한 방법: store/ONLINE.md
 * 예)
 * window.MLE_FIREBASE = {
 *   apiKey: "AIza...", authDomain: "math-land-eater.firebaseapp.com", projectId: "math-land-eater",
 *   storageBucket: "math-land-eater.appspot.com", messagingSenderId: "123...", appId: "1:123...:web:abc..."
 * };
 */
window.MLE_FIREBASE = null;
