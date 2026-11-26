# 실제 녹음 사운드로 교체하기

게임의 모든 소리는 기본적으로 WebAudio로 **실시간 합성**됩니다(저작권 문제 없음).
직접 구한 실제 녹음(무료/CC0 효과음 등)을 쓰고 싶다면:

1. 이 폴더에 파일을 넣습니다. 파일 이름(확장자 제외)이 사운드 이름과 같아야 합니다.
2. `manifest.json` 에 파일 목록을 적습니다. 예: `["gunshot.mp3", "scream.ogg", "alert.mp3"]`

교체 가능한 이름: `alert`(재난문자), `vibrate`, `scream`, `groan`, `zgrowl`, `zscream`, `zattack`, `zpain`, `zstep`, `step`,
`gunshot`, `dryfire`, `reload`, `swing`, `meleeFlesh`, `bulletFlesh`, `bodyfall`, `doorBang`, `doorOpen`, `lock`, `drag`,
`glass`, `curtain`, `click`, `pickup`, `rummage`, `eat`, `drink`, `heartbeat`, `breath`, `hurt`, `crash`, `carHit`,
`explosion`, `horn`, `dog`, `crow`, `sirenPass`, `tvOn`, `jingle`, `splash`, `heliPass`

※ 위 이름은 한 번 재생되는 소리입니다. 반복 소리(물, 비, 바람, 엔진, 사이렌 등)는 합성음을 사용합니다.
