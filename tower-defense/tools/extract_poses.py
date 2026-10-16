"""엄마·아빠 포즈 스프라이트 추출 (캐릭터 인식 3단계).

1) 잔디 위 포즈: 초록(잔디)을 배경으로 지우고 가장 큰 덩어리만 남긴다. 겹친 농부는 영역을 지정해 지운다.
2) 만세(집 앞 뒷모습): 집만 있는 장면을 SIFT로 정렬해 차이로 사람을 찾고,
   자막 띠가 가린 부분은 위·아래 옷 색을 세로로 이어 칠해 복원한다.

모든 결과는 '서 있는 키 = STD_H 픽셀' 기준으로 같은 배율로 저장된다.
사용법: python3 tools/extract_poses.py <스크린샷 폴더> [출력 폴더]
필요: pip install pillow numpy scipy opencv-python-headless
"""
import sys
import cv2
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as nd

STD_H = 420            # 서 있는 사람 키(px)
S = 1.2                # 900 기준 좌표 → 1080 스크린샷
# 이름: (파일, 크롭(900 기준), 서 있는 키(900 기준, None=크롭 높이 그대로))
POSES = {
    'mom_front_0': ('ca7bedcd', (175, 755, 375, 1340), None),
    'mom_front_1': ('0c20e888', (205, 845, 405, 1420), None),
    'dad_front_0': ('ca7bedcd', (470, 775, 665, 1345), None),
    'dad_front_1': ('0c20e888', (505, 860, 690, 1425), None),
    'mom_surprised': ('939e64be', (535, 630, 825, 1345), None),
    'dad_wave': ('cb04e8de', (110, 630, 410, 1310), None),
    'mom_hip': ('cb04e8de', (550, 620, 815, 1330), None),
    'mom_hips': ('2e4869c9', (65, 640, 330, 1235), None),
    'mom_smoke': ('1686b624', (565, 615, 845, 1345), None),
    'dad_lunge': ('1686b624', (55, 980, 430, 1340), 665),
    'dad_rest': ('e17a7958', (240, 850, 655, 1260), 665),
    'dad_walk_0': ('8a9da2c1', (230, 500, 670, 1660), None),
    'dad_walk_1': ('97156bee', (225, 445, 615, 1545), None),
    'dad_walk_2': ('e73e4819', (195, 440, 590, 1450), None),
    'dad_walk_3': ('fb805c45', (195, 455, 590, 1475), None),
}
# 겹친 농부 등 지울 영역 (크롭 기준 비율)
KILL = {
    'dad_wave': [(0.66, 0.78, 1, 1)],
    'mom_hip': [(0.80, 0.85, 1, 1)],
    'mom_smoke': [(0, 0.9, 0.12, 1)],
    'dad_lunge': [(0, 0.58, 0.62, 1)],
    'dad_rest': [(0, 0.5, 0.07, 1)],
    'mom_hips': [(0.6, 0.76, 1, 1), (0.55, 0.93, 1, 1)],
    'dad_front_1': [(0.76, 0.75, 1, 1)],
}


def largest(m):
    lab, n = nd.label(m)
    return lab == (np.argmax(nd.sum(m, lab, range(1, n + 1))) + 1)


def green_cut(src, name):
    f, box, std = POSES[name]
    box = tuple(int(v * S) for v in box)
    a = np.asarray(Image.open(f'{src}{f}-image.jpg').convert('RGB').crop(box)).astype(int)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    fg = ~((G > R + 18) & (G > B + 18))
    H, W = fg.shape
    for x0, y0, x1, y1 in KILL.get(name, []):
        fg[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)] = False
    fg = largest(nd.binary_opening(fg, iterations=2))
    hl, hn = nd.label(nd.binary_fill_holes(fg) & ~fg)        # 작은 구멍만 메움
    for j in range(1, hn + 1):
        if (hl == j).sum() < 300: fg |= hl == j
    fg = nd.binary_erosion(fg, iterations=1)
    al = np.array(Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))).astype(float)
    al = np.clip((al - 50) * 1.5, 0, 255).astype(np.uint8)
    o = a.copy(); o[..., 1] = np.minimum(G, np.maximum(R, B) + 12)   # 초록 번짐 제거
    im = Image.fromarray(np.dstack([o.astype(np.uint8), al]), 'RGBA')
    im = im.crop(im.getbbox())
    stand = (std * S) if std else im.height
    k = STD_H / stand
    return im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)


def cheer_cut(src):
    """만세 장면: 집만 있는 장면과의 차이 + 자막 띠 복원."""
    C = cv2.imread(src + '5603c844-image.jpg'); T = cv2.imread(src + '758076d1-image.jpg')
    sift = cv2.SIFT_create(5000)
    mc = np.zeros(C.shape[:2], np.uint8); mc[900:1450, 180:900] = 255
    mt = np.zeros(T.shape[:2], np.uint8); mt[1000:1500, 380:640] = 255; mt[800:1000, 330:700] = 255
    k1, d1 = sift.detectAndCompute(cv2.cvtColor(C, cv2.COLOR_BGR2GRAY), mc)
    k2, d2 = sift.detectAndCompute(cv2.cvtColor(T, cv2.COLOR_BGR2GRAY), mt)
    good = [a for a, b in cv2.BFMatcher().knnMatch(d1, d2, k=2) if a.distance < 0.75 * b.distance]
    p1 = np.float32([k1[a.queryIdx].pt for a in good]); p2 = np.float32([k2[a.trainIdx].pt for a in good])
    A, _ = cv2.estimateAffinePartial2D(p1, p2, method=cv2.RANSAC, ransacReprojThreshold=2)
    W = cv2.warpAffine(C, A, (T.shape[1], T.shape[0]), borderMode=cv2.BORDER_REPLICATE).astype(np.float32)
    T = T.astype(np.float32)
    by0, by1, bx0, bx1 = 1296, 1401, 222, 873                       # 자막 띠
    band = np.zeros(T.shape[:2], bool); band[by0:by1, bx0:bx1] = True
    hsv = cv2.cvtColor(T.astype(np.uint8), cv2.COLOR_BGR2HSV)
    text = cv2.dilate((band & (hsv[..., 2] > 170) & (hsv[..., 1] < 70)).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    ref = band.copy(); ref[:, :430] = False; ref[:, 620:] = False; ref &= ~text
    k = T[ref].mean(0) / W[ref].mean(0)                              # 띠의 투과율
    Tf = T.copy(); Tf[band] = np.clip(T[band] / k, 0, 255)
    Tf = cv2.inpaint(Tf.astype(np.uint8), (text & band).astype(np.uint8), 5, cv2.INPAINT_TELEA)
    d = np.abs(cv2.GaussianBlur(Tf, (5, 5), 0).astype(int) - cv2.GaussianBlur(W.astype(np.uint8), (5, 5), 0).astype(int)).sum(-1)
    m = d > 75; m[:560] = False; m[1820:] = False; m[:, 1000:] = False
    m = nd.binary_closing(nd.binary_opening(m, iterations=2), iterations=5)
    lab, n = nd.label(m); sz = nd.sum(m, lab, range(1, n + 1))
    hv = cv2.cvtColor(Tf, cv2.COLOR_BGR2HSV).astype(int); H, Sa, V = hv[..., 0] * 2, hv[..., 1] / 255, hv[..., 2] / 255
    Bc, Gc, Rc = (Tf[..., i].astype(int) for i in range(3))
    junk = (((H < 14) | (H > 340)) & (Sa > 0.55) & (V > 0.35)) | ((Gc > Rc + 25) & (Gc > Bc + 40))
    out = {}
    # (x 범위, 몸통 시작 y, 서 있는 키 비율: 팔을 뺀 머리~발)
    for who, (x0, x1, ty0, stand_frac) in {'dad': (0, 520, 990, 0.81), 'mom': (520, 1000, 1070, 0.867)}.items():
        best = next(i + 1 for i in np.argsort(-sz)[:8] if x0 <= np.where(lab == i + 1)[1].mean() < x1)
        base = lab == best; pm = nd.binary_fill_holes(base)
        hl, hn = nd.label(pm & ~base)
        for j in range(1, hn + 1):
            r = hl == j
            if d[r].mean() < 45 and V[r].mean() > 0.3: pm &= ~r
        yy = np.arange(pm.shape[0])[:, None]
        torso = (yy > ty0) & (yy < 1420)                             # 팔이 없는 몸통 높이: 집 색(나무·벽) 제거
        housey = torso & (((H >= 5) & (H <= 40) & (Sa > 0.3) & (V > 0.25)) | ((H > 35) & (H <= 60) & (Sa > 0.12) & (V > 0.6)))
        pm = largest(nd.binary_opening(pm & ~junk & ~housey, iterations=2))
        pm = nd.binary_fill_holes(pm)
        a0, a1 = by0 - 4, by1 + 3
        for x in range(bx0, bx1):                                    # 자막 띠: 위아래 옷 색을 이어 칠함
            if pm[a0, x] and pm[a1, x]:
                pm[a0:a1, x] = True
                mid = (a0 + a1) // 2; Tf[a0:mid, x] = Tf[a0, x]; Tf[mid:a1, x] = Tf[a1, x]
            else:
                pm[a0:a1, x] = False
        pm = np.where(torso, nd.binary_opening(pm, iterations=4), nd.binary_opening(pm, iterations=2))
        pm = nd.binary_erosion(largest(pm), iterations=1)
        a = cv2.GaussianBlur((pm * 255).astype(np.uint8), (3, 3), 0)
        rgba = np.dstack([Tf[..., ::-1], a]); ys, xs = np.where(a > 0)
        im = Image.fromarray(rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1], 'RGBA')
        k = STD_H / (im.height * stand_frac)
        out[who] = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    return out


if __name__ == '__main__':
    src = sys.argv[1].rstrip('/') + '/'
    dst = (sys.argv[2] if len(sys.argv) > 2 else 'assets/characters/family').rstrip('/') + '/'
    for name in POSES:
        im = green_cut(src, name); im.save(dst + name + '.png', optimize=True); print(name, im.size)
    for who, im in cheer_cut(src).items():
        im.save(f'{dst}{who}_cheer.png', optimize=True); print(who + '_cheer', im.size)
