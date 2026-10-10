# 매뜨 땅먹 시네마틱 트레일러 (16:9 · 30초)

- `index.html`: 장면 전체 (별 → 한반도 해안선 → 육각 땅따먹기 → 큰 글자 → 1,657,648칸 → 휴대폰 기능 소개 → 몽타주 → 로고)
  `render(t)` 로 원하는 순간을 그린다. 화면 사진은 `shots/`, 글꼴은 `fonts/` (Black Han Sans · Jua · Pretendard) 에 넣는다.
- `render.js`: `node render.js 0 900` 으로 30fps 장면을 `frames/` 에 JPEG 로 (`still 1.5,10.8` 은 미리보기)
- `score.py`: 배경 음악 (90 BPM, 직접 만든 소리) → `score.wav`
- 합치기: `ffmpeg -framerate 30 -i frames/%04d.jpg -i score.wav -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a aac -shortest trailer.mp4`
