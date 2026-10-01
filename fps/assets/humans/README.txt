인물 메시/텍스처는 fps/tools/humans 의 스크립트로 생성됩니다.
원본: MakeHuman 베이스 메시·모프 타깃·기본 리그/가중치 (https://github.com/makehumancommunity/makehuman)
라이선스: MakeHuman 에셋은 CC0 1.0 Universal 로 공개되어 있습니다.
피부 텍스처(_d.jpg, skin_n.jpg)는 절차적으로 생성되었습니다.

재생성:
  python3 fps/tools/humans/bake_mesh.py <makehuman>/makehuman/data fps/assets/humans
  python3 fps/tools/humans/bake_skin.py fps/assets/humans 1024
