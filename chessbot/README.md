# Chess Auto Bot (Android)

## 설치
GitHub → Actions → `Chess Auto Bot APK` → 최신 실행 → `ChessAutoBot-apk` 다운로드 → `app-debug.apk` 설치

## 화면
| 화면 | 기능 |
|---|---|
| 메인 | 언어 설정(20개 언어) · 봇 시작하기(초록) / 멈추기(빨강) |
| 떠 있는 창 | 봇 작동하기 버튼 · 닫기 |
| 닫기 | 체스 나이트 그림 원형 버튼으로 축소 → 누르면 다시 창으로 |

## 봇 작동 방식
1. 봇 시작하기 → 떠 있는 창이 나옴 (앱을 나가도 계속 떠 있음)
2. 내 체스 게임(`chess/`)을 열고 창의 **봇 작동하기**를 누름
3. 처음 한 번은 접근성 설정 화면이 열림 → `Chess Auto Bot` 켜기
   - 안드로이드 13 이상에서 회색으로 막혀 있으면: 설정 → 애플리케이션 → Chess Auto Bot → 오른쪽 위 ⋮ → **제한된 설정 허용** 후 다시 켜기
4. 봇이 판을 읽고 가장 좋은 수를 찾아 직접 터치해서 둠. 상대가 둔 수는 국면별로 기억해 패턴을 학습함

봇은 판에 `KJBOT|FEN|판 뒤집힘|봇 차례` 접근성 라벨이 붙은 게임에서만 작동합니다.
내 체스 게임에 아래 코드를 넣어야 합니다 (`chess/js/main.js`의 `$('btnHome').addEventListener('click', showMenu);` 바로 아래).

```js
  // ---------- Chess Auto Bot(안드로이드 앱) 연동 ----------
  // 판에 현재 국면을 접근성 라벨로 붙여 둔다: KJBOT|FEN|판 뒤집힘(0/1)|봇이 둘 차례(0/1)
  boardEl.setAttribute('role', 'img');
  let botLabel = '';
  setInterval(() => {
    if (!state) return;
    let fen = '';
    for (let r = 0; r < 8; r++) {
      let e = 0;
      for (let c = 0; c < 8; c++) {
        const p = state.board[r * 8 + c];
        if (!p) { e++; continue; }
        if (e) { fen += e; e = 0; }
        fen += p.color === 'w' ? p.type.toUpperCase() : p.type;
      }
      fen += (e || '') + (r < 7 ? '/' : '');
    }
    const cs = state.castling;
    const cas = (cs.wK ? 'K' : '') + (cs.wQ ? 'Q' : '') + (cs.bK ? 'k' : '') + (cs.bQ ? 'q' : '') || '-';
    const ep = state.ep >= 0 ? 'abcdefgh'[state.ep & 7] + (8 - (state.ep >> 3)) : '-';
    fen += ` ${state.turn} ${cas} ${ep} ${state.half} ${state.full}`;
    const ready = !gameEl.hidden && readyEl.hidden && veilEl.hidden && !busy && !over && humanSide(state.turn);
    const label = `KJBOT|${fen}|${flipped ? 1 : 0}|${ready ? 1 : 0}`;
    if (label !== botLabel) boardEl.setAttribute('aria-label', (botLabel = label));
  }, 150);
```
