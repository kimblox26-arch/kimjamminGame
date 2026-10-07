# 홍보 영상 만들기 (`branding/promo.mp4`)

1. `node centers.js` → `node plan.js` : 지도 칸 가운데 좌표를 풀고, 영상에 쓸 학교 땅(알록달록한 덩어리)을 고른다.
2. `node cap.js` : 게임 테스트 서버(Realtime Database 에뮬레이터)에 땅을 채우고 진짜 게임 화면을 장면마다 1080×1920 으로 찍는다 (`shots/`).
3. `python3 music.py music.wav` : 128 BPM 배경 음악과 효과음을 코드로 만든다 (저작권 걱정 없음).
4. `compose.html` 을 같은 폴더에서 http 로 열고 (`fonts/` 에 Black Han Sans · Jua 글꼴 파일), `node render.js` 로 675장(22.5초 × 30fps)을 그린다.
5. `ffmpeg -framerate 30 -i frames/%04d.jpg -i music.wav -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -af loudnorm=I=-14:TP=-1.5 -shortest -movflags +faststart promo.mp4`

`cap.js` · `render.js` 의 주소와 경로는 만든 사람의 테스트 환경 기준이라 쓸 때 맞춰 바꿔요.
