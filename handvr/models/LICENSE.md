# 손·팔 3D 모델 (arm.glb, arm-color.jpg, arm-normal.jpg, arm-orm.jpg)

"Hand and arm - Zbrush sculpt" by Andy Woodhead (https://sketchfab.com/Andywoodhead) is licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
Source: https://sketchfab.com/3d-models/hand-and-arm-zbrush-sculpt-75640a16ffe04ed38464100c8dde65a5.
Changes: Cleaned up (centered, grounded, renamed), converted to GLB/FBX/OBJ/BLEND. Distributed by AiZity (https://aizity.com).

이 프로젝트에서 바꾼 것:
- FBX 를 GLB(위치·법선·UV, 같은 정점 합침)로 변환, 텍스처를 JPG 로 다시 저장 (거칠기·AO 는 arm-orm.jpg 의 G·R 채널)
- 뼈대와 스킨 가중치는 게임이 실행될 때 `js/hand-rig.js` 가 계산 (손 관절 위치는 모델을 여러 방향에서 렌더링해 손 인식 AI 로 찾고, 손가락 단면 중심으로 보정한 값)
- 오른팔은 이 왼팔 모델을 좌우로 뒤집어서 사용
