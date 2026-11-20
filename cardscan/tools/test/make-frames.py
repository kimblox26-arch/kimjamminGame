# 시뮬레이션용 "카메라 사진" 만들기: 실제 카드 이미지를 기울이고, 흐리게, 빛 반사, 배경 등을 섞는다.
# 사용: python3 make-frames.py <raw-cards.json> <출력폴더> [개수]
import json, random, sys, io, os, urllib.request
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw
random.seed(7)
raw, out, n = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 200
os.makedirs(out, exist_ok=True)
cards = [c for c in json.load(open(raw)) if c.get('images', {}).get('small', '').startswith('https://images.pokemontcg.io/')]
ok = json.load(open(os.path.join(os.path.dirname(raw), 'hash-cache.json')))  # 이미지가 있는 카드만
cards = [c for c in cards if c['id'] in ok]
picks = random.sample(cards, n)
GW = 214; GH = round(GW / (63 / 88)); M = 0.2
W, H = round(GW * (1 + 2 * M)), round(GH * (1 + 2 * M))

def background():
    kind = random.choice(['white', 'wood', 'dark', 'gray'])
    base = {'white': (232, 230, 225), 'wood': (150, 105, 65), 'dark': (35, 35, 40), 'gray': (120, 120, 125)}[kind]
    bg = Image.new('RGB', (W, H), base)
    noise = Image.effect_noise((W, H), 18).convert('RGB')
    return Image.blend(bg, noise, 0.08)

labels = []
for i in range(n + 40):
    bg = background()
    cid = None
    if i < n:
        c = picks[i]; cid = c['id']
        req = urllib.request.urlopen(urllib.request.Request(c['images']['small'], headers={'User-Agent': 'cardscan-test'}), timeout=30)
        im = Image.open(io.BytesIO(req.read())).convert('RGBA')
        s = random.uniform(0.88, 1.12)
        cw, ch = round(GW * s), round(GH * s)
        im = im.resize((cw, ch), Image.BICUBIC).rotate(random.uniform(-4, 4), Image.BICUBIC, expand=True)
        x = round(W / 2 - im.width / 2 + random.uniform(-0.05, 0.05) * GW)
        y = round(H / 2 - im.height / 2 + random.uniform(-0.05, 0.05) * GH)
        bg.paste(im, (x, y), im)
    else:
        # 카드 없음: 손/물건 비슷한 덩어리
        d = ImageDraw.Draw(bg)
        for _ in range(random.randint(0, 3)):
            x, y = random.randint(0, W), random.randint(0, H)
            d.ellipse([x, y, x + random.randint(40, 200), y + random.randint(40, 200)],
                      fill=tuple(random.randint(60, 230) for _ in range(3)))
    img = ImageEnhance.Brightness(bg).enhance(random.uniform(0.7, 1.2))
    img = ImageEnhance.Contrast(img).enhance(random.uniform(0.75, 1.1))
    r, g, b = img.split()
    tint = [random.uniform(0.9, 1.1) for _ in range(3)]
    img = Image.merge('RGB', [ch.point(lambda v, t=t: min(255, int(v * t))) for ch, t in zip((r, g, b), tint)])
    if random.random() < 0.5:  # 빛 반사
        glare = Image.new('L', (W, H), 0); d = ImageDraw.Draw(glare)
        x, y = random.randint(0, W), random.randint(0, H)
        d.ellipse([x - 60, y - 40, x + 60, y + 40], fill=random.randint(60, 140))
        glare = glare.filter(ImageFilter.GaussianBlur(25))
        img = Image.composite(Image.new('RGB', (W, H), (255, 255, 255)), img, glare)
    img = img.filter(ImageFilter.GaussianBlur(random.uniform(0, 1.3)))
    buf = io.BytesIO(); img.save(buf, 'JPEG', quality=random.randint(60, 85))
    Image.open(buf).save(f'{out}/{i}.png')
    labels.append({'file': f'{i}.png', 'id': cid})
json.dump({'W': W, 'H': H, 'guide': [GW * M, GH * M, GW * (1 + M), GH * (1 + M)], 'frames': labels}, open(f'{out}/labels.json', 'w'))
print('frames', len(labels), W, H)
