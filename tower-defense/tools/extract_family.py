"""엄마·아빠 / 집 스프라이트 추출 스크립트 (캐릭터 인식).

1) 엄마·아빠: 사람이 없는 장면(clean)을 SIFT 특징점으로 사람이 있는 장면에 정렬한 뒤
   두 장면의 차이로 사람만 찾아낸다. 지붕(빨강)·잔디(초록) 잔여물은 색으로 한 번 더 지운다.
2) 집: 잔디(강한 초록)를 바깥에서부터 지우고 가장 큰 덩어리만 남긴다. 지붕 위 꽃가루는 지붕 모양으로 걷어낸다.

사용법: python3 tools/extract_family.py <스크린샷 폴더> [assets 폴더]
필요: pip install pillow numpy scipy opencv-python-headless
"""
import sys
import cv2
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as nd

CLEAN = '5603c844-image.jpg'                       # 집만 있는 장면
FRAMES = {'back_0': 'e3abcc30-image.jpg',          # 뒷모습 1
          'back_1': '5a2c116e-image.jpg',          # 뒷모습 2
          'turn': 'f7f547c2-image.jpg'}            # 돌아서는 모습
HOUSE_SRC, HOUSE_GABLE = '2e81843d-image.jpg', (540, 247, 82)   # 집 클로즈업, 박공 꼭대기(x, y, 반폭)


def align(src, target):
    c, t = cv2.imread(src), cv2.imread(target)
    m = np.zeros(c.shape[:2], np.uint8); m[820:1450, 180:900] = 255
    sift = cv2.SIFT_create(4000)
    k1, d1 = sift.detectAndCompute(cv2.cvtColor(c, cv2.COLOR_BGR2GRAY), m)
    k2, d2 = sift.detectAndCompute(cv2.cvtColor(t, cv2.COLOR_BGR2GRAY), m)
    good = [a for a, b in cv2.BFMatcher().knnMatch(d1, d2, k=2) if a.distance < 0.75 * b.distance]
    p1 = np.float32([k1[a.queryIdx].pt for a in good]); p2 = np.float32([k2[a.trainIdx].pt for a in good])
    A, _ = cv2.estimateAffinePartial2D(p1, p2, method=cv2.RANSAC, ransacReprojThreshold=2)
    return cv2.warpAffine(c, A, (c.shape[1], c.shape[0]), borderMode=cv2.BORDER_REPLICATE), t


def people(src_dir, frame, T=70):
    w, t = align(src_dir + CLEAN, src_dir + frame)
    d = np.abs(cv2.GaussianBlur(w, (5, 5), 0).astype(int) - cv2.GaussianBlur(t, (5, 5), 0).astype(int)).sum(-1)
    m = d > T
    m[:700] = False; m[1700:] = False
    m = nd.binary_closing(nd.binary_opening(m, iterations=2), iterations=4)
    lab, n = nd.label(m); sz = nd.sum(m, lab, range(1, n + 1))
    hsv = cv2.cvtColor(t, cv2.COLOR_BGR2HSV).astype(int); H, S, V = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    B, G, R = (t[..., i].astype(int) for i in range(3))
    junk = (((H < 14) | (H > 340)) & (S > 0.55) & (V > 0.35)) | ((G > R + 25) & (G > B + 40))
    out = {}
    for who, (x0, x1) in {'dad': (0, 540), 'mom': (540, 1080)}.items():
        best = next(i + 1 for i in np.argsort(-sz)[:6] if x0 <= np.where(lab == i + 1)[1].mean() < x1)
        base = lab == best
        pm = nd.binary_fill_holes(base)
        hl, hn = nd.label(pm & ~base)
        for j in range(1, hn + 1):                  # 팔·다리 사이로 보이는 배경 구멍은 다시 비움
            r = hl == j
            if d[r].mean() < 45 and V[r].mean() > 0.3: pm &= ~r
        pm = nd.binary_opening(pm & ~junk, iterations=2)
        l2, n2 = nd.label(pm); pm = l2 == (np.argmax(nd.sum(pm, l2, range(1, n2 + 1))) + 1)
        pm = nd.binary_erosion(pm, iterations=1)
        a = cv2.GaussianBlur((pm * 255).astype(np.uint8), (3, 3), 0)
        rgba = np.dstack([t[..., ::-1], a]); ys, xs = np.where(a > 0)
        out[who] = Image.fromarray(rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1], 'RGBA')
    return out


def house(src_dir):
    """선명한 집 클로즈업에서 잔디를 지우고, 지붕 위 꽃가루는 박공·굴뚝만 남기고 지운다."""
    from PIL import ImageDraw
    a = np.asarray(Image.open(src_dir + HOUSE_SRC).convert('RGB'))
    A = a.astype(int)
    grass = (A[..., 1] > A[..., 0] + 20) & (A[..., 1] > A[..., 2] + 50)
    lab, _ = nd.label(grass)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    fg = ~np.isin(lab, list(border))
    H, W = fg.shape
    roof_y, (gx, gy, gw) = 305, HOUSE_GABLE
    zone = Image.new('L', (W, H), 0); ImageDraw.Draw(zone).rectangle((150, 0, 690, roof_y), fill=255)
    keep = Image.new('L', (W, H), 0)
    ImageDraw.Draw(keep).polygon([(gx - gw, roof_y + 4), (gx, gy), (gx + gw, roof_y + 4)], fill=255)
    fg &= ~(np.array(zone) > 0) | (np.array(keep) > 0)
    fg = nd.binary_opening(fg, iterations=1)
    l2, n2 = nd.label(fg); fg = l2 == (np.argmax(nd.sum(fg, l2, range(1, n2 + 1))) + 1)
    fg = nd.binary_fill_holes(fg)
    yy, xx = np.mgrid[-18:19, -18:19]
    cl = nd.binary_closing(np.pad(fg, 24), structure=(xx ** 2 + yy ** 2) <= 324)[24:-24, 24:-24]
    fg[700:] |= cl[700:]                               # 아래쪽 덤불 복구
    fg = nd.binary_fill_holes(fg)
    al = np.array(Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)))
    im = Image.fromarray(np.dstack([a, al]), 'RGBA')
    return im.crop(im.getbbox())


if __name__ == '__main__':
    src = sys.argv[1].rstrip('/') + '/'
    dst = (sys.argv[2] if len(sys.argv) > 2 else 'assets').rstrip('/') + '/'
    for name, frame in FRAMES.items():
        for who, im in people(src, frame).items():
            im = im.resize((round(im.width * 0.5), round(im.height * 0.5)), Image.LANCZOS)
            im.save(f'{dst}characters/family/{who}_{name}.png', optimize=True)
            print(who, name, im.size)
    house(src).save(dst + 'house.png', optimize=True)
