# CoD4 스타일 에딧 영상 제작 도구

`media/freefreely_cod4_edit.mp4` 를 만든 스크립트입니다. 게임을 헤드리스 크로미움에서 **가상 시간**으로 한 프레임씩 진행시키며 촬영하고,
CoD4 프랙무비 스타일(컬러그레이딩·레터박스·셰이크·줌펀치·플래시·RGB 분리·힛마커·킬피드·AC-130 열화상·FINAL KILLCAM)로 합성합니다.
음악(140BPM 덥스텝)과 효과음은 모두 numpy 로 직접 합성합니다.

| 파일 | 역할 |
|---|---|
| `harness.mjs` | Playwright 로 게임 실행, `performance.now`/`requestAnimationFrame` 을 가상 시간으로 교체 |
| `rt.js` | 페이지 안 런타임: 기체 자세 제어, 시네마틱 카메라, 플레어 연기 꼬리, 폭발/충격파 보정 |
| `shots.mjs` | 13개 샷 정의 (기체 조작 + 카메라 + 샷별 슬로모 dt) |
| `render.mjs` | 샷을 프레임 JPEG 로 렌더 (`meta.json` 에 폭발/통과/충돌 프레임 기록) |
| `music.py`, `dsp.py` | 140BPM 트랙 합성 (인트로 → 빌드업 → 드롭 → 브레이크 → 드롭2 → 아웃트로) |
| `edit.py` | 비트에 맞춘 타임라인 + 이펙트 + 자막 합성 → raw RGB 출력 |
| `sfx.py` | 기관포·폭발·소닉붐·휘시·힛마커·타자기 효과음 합성 후 음악과 믹스 |

## 다시 만들기

```bash
# 1) 게임 서버
python3 -m http.server 8080 &          # 저장소 루트에서
cd tools/edit-video
npm i playwright                        # 또는 전역 playwright 를 node_modules 에 링크

# 2) 샷 렌더 (1280x720, 소프트웨어 렌더링 기준 프레임당 수 초)
W=1280 H=720 node render.mjs final runway takeoff climb strafe_cockpit strafe_kill flyby \
  flares roll ac130 crash outro space cockpit_roll
#   PREVIEW=1 W=480 H=270 ... 로 저해상도 미리보기 가능

# 3) 음악 + 효과음
python3 music.py music.wav
python3 sfx.py final music.wav mix.wav

# 4) 합성 + 인코딩
python3 edit.py final | ffmpeg -f rawvideo -pix_fmt rgb24 -s 1280x720 -r 30 -i - -i mix.wav \
  -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -c:a aac -b:a 256k -shortest out.mp4
```

## TikTok 세로 에딧 (`media/freefreely_tiktok_edit.mp4`)

720x1280 · 16.6초 · 120BPM. 음악은 slowed 점프스타일 느낌의 **오리지널 합성 트랙**입니다(`tiktok_music.py`).
세로 화면에서는 `rt.js` 가 화각을 자동 보정하고, `NEED` 로 필요한 프레임 구간만 렌더합니다.

```bash
NEED='{"runway":[0,72],"takeoff":[0,95],"climb":[0,60],"strafe_kill":[10,108],"flyby":[38,86],"cockpit_roll":[8,44],"flares":[4,56],"roll":[3,38],"crash":[44,100],"outro":[0,62]}'
W=720 H=1280 NEED="$NEED" node render.mjs tt takeoff strafe_kill flyby roll runway climb cockpit_roll flares crash outro
python3 tiktok_music.py tiktok.wav
python3 tiktok.py tt | ffmpeg -f rawvideo -pix_fmt rgb24 -s 720x1280 -r 30 -i - -i tiktok.wav \
  -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -c:a aac -b:a 256k -shortest out.mp4
```

원하는 곡으로 바꾸려면(곡 사용 권한은 직접 확인) 영상의 오디오만 교체하면 됩니다. 컷은 120BPM(0.5초) 격자에 맞춰져 있습니다.

```bash
ffmpeg -i media/freefreely_tiktok_edit.mp4 -ss <곡 시작초> -i song.mp3 -map 0:v -map 1:a -c:v copy -c:a aac -shortest my_edit.mp4
```
