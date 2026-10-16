"""캐릭터 인식(배경 제거) 스크립트.
게임 화면 스크린샷에서 잔디(초록)·흙길(노랑)을 배경으로 판별해 지우고,
가장 큰 덩어리(사람)만 남겨 투명 PNG 스프라이트로 저장한다.

사용법: python3 tools/extract_sprites.py <스크린샷 폴더> [출력 폴더]
필요: pip install pillow numpy scipy
"""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as nd
C={
 'sideA':('3fed8db3-image.jpg',(380,770,560,1260)),
 'sideB':('e73ada91-image.jpg',(390,915,540,1355)),
 'backA':('45dc20f5-image.jpg',(290,630,560,1390)),
 'backB':('98c2000a-image.jpg',(270,780,540,1380)),
 'frontA':('de12d9b8-image.jpg',(330,460,670,1300)),
}
def bgmask(a,strict=False):
    f=a.astype(float)/255; r,g,b=f[...,0],f[...,1],f[...,2]
    mx=f.max(-1); mn=f.min(-1); s=(mx-mn)/(mx+1e-6)
    h=np.zeros_like(mx); d=mx-mn+1e-6
    h=np.where(mx==r,((g-b)/d)%6,np.where(mx==g,(b-r)/d+2,(r-g)/d+4))*60
    green=(h>55)&(h<170)&(s>0.25)&(g>=r*0.9)
    sand=(((h>=38)&(h<=62)&(s>0.35)&(mx>0.3))|((h>=26)&(h<38)&(s>0.62)&(mx>0.45))) if strict else ((h>=26)&(h<=60)&(s>0.5)&(mx>0.45))
    return green|sand, h, s, mx
def run(name, kills=()):
    f,b=C[name]; b=tuple(int(v*1.2) for v in b)
    a=np.array(Image.open(U+f).convert('RGB').crop(b))
    bg,h,s,v=bgmask(a,name.startswith('back'))
    fg=~bg
    H,W=fg.shape
    yy,xx=np.mgrid[0:H,0:W]
    for k in kills: fg&=~k(xx/W,yy/H,a,h,s,v)
    fg=nd.binary_opening(fg,iterations=2)
    lab,n=nd.label(fg); sz=nd.sum(fg,lab,range(1,n+1))
    fg=lab==(np.argmax(sz)+1)
    fg=nd.binary_closing(fg,iterations=2)
    holes=nd.binary_fill_holes(fg)&~fg
    hl,hn=nd.label(holes); hs=nd.sum(holes,hl,range(1,hn+1))
    for i,z in enumerate(hs):
        if z<400: fg|=hl==i+1
    fg=nd.binary_erosion(fg,iterations=1)
    al=Image.fromarray((fg*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    al=np.array(al).astype(float); al=np.clip((al-60)*1.6,0,255).astype(np.uint8)
    out=np.dstack([a,al]); im=Image.fromarray(out,'RGBA')
    im=im.crop(im.getbbox()); return im
blue=lambda h,s,v:(h>190)&(h<250)&(s>0.15)&(v>0.28)
K={
 'backB':[lambda x,y,a,h,s,v:(y<0.17)&blue(h,s,v)],
 'frontA':[lambda x,y,a,h,s,v:(x<0.17)&(y<0.8)&blue(h,s,v), lambda x,y,a,h,s,v:(y>0.915)&(x<0.5)],
}
# 출력 파일명 -> 원본 포즈 (방향_프레임)
OUT={'side_0':'sideA','side_1':'sideB','back_0':'backA','back_1':'backB','front_0':'frontA'}
if __name__=='__main__':
    from PIL import ImageOps
    U=sys.argv[1].rstrip('/')+'/'
    D=(sys.argv[2] if len(sys.argv)>2 else 'assets/characters/farmer').rstrip('/')+'/'
    for o,k in OUT.items():
        im=run(k,K.get(k,())); w,h=im.size
        im=im.resize((round(w*300/h),300),Image.LANCZOS)
        im.save(D+o+'.png',optimize=True)
        if o=='front_0': ImageOps.mirror(im).save(D+'front_1.png',optimize=True)
        print(o,im.size)
