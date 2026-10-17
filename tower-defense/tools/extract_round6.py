"""6단계 스프라이트 추출: Lv.2 아빠(파란 옷, 코딱지), Lv.3 아빠(정장), 인사하는 엄마,
아군 잼민이 주먹 자세, 빨간 옷 잼민이 뒷모습, 회사 건물.

- 사람: 잔디(초록)·흙길(노랑)을 지우고 가장 큰 덩어리만. 발에 걸친 공격 고리는 색으로 걷어냄
- 회사: '아빠 강화' 표시가 가린 왼쪽은 좌우 대칭인 오른쪽을 거울로 비춰 채우고,
  잔디는 색 범위가 좁아 좁게 지운 뒤 배경에 닿은 밝은 풀잎만 조금씩 번져 지움 (나무는 남김)

사용법: python3 tools/extract_round6.py <스크린샷 폴더> [assets 폴더]
필요: pip install pillow numpy scipy opencv-python-headless
"""
import sys, os
import numpy as np, cv2
from PIL import Image, ImageFilter
from scipy import ndimage as nd

U = sys.argv[1].rstrip('/') + '/' if len(sys.argv) > 1 else './'
S = 1.2
def keybg(a):
    f=a.astype(float)/255; r,g,b=f[...,0],f[...,1],f[...,2]
    mx=f.max(-1); mn=f.min(-1); d=mx-mn+1e-6; s=d/(mx+1e-6)
    h=np.where(mx==r,((g-b)/d)%6,np.where(mx==g,(b-r)/d+2,(r-g)/d+4))*60
    green=(h>55)&(h<170)&(s>0.25)&(g>=r*0.9)
    sand=(h>=30)&(h<=60)&(s>0.45)&(mx>0.45)
    return green|sand

def load(f): return np.asarray(Image.open(U+f+'-image.jpg').convert('RGB'))
def largest(m):
    lab,n=nd.label(m); return lab==(np.argmax(nd.sum(m,lab,range(1,n+1)))+1)
def fill_small(m,lim=300):
    hl,hn=nd.label(nd.binary_fill_holes(m)&~m)
    for j in range(1,hn+1):
        if (hl==j).sum()<lim: m|=hl==j
    return m
def green(a): a=a.astype(int); return (a[...,1]>a[...,0]+18)&(a[...,1]>a[...,2]+18)
def finish(a,m,blur=1.0):
    al=np.array(Image.fromarray((m*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))).astype(float)
    al=np.clip((al-50)*1.5,0,255).astype(np.uint8)
    o=a.astype(int).copy(); o[...,1]=np.minimum(o[...,1],np.maximum(o[...,0],o[...,2])+12)
    im=Image.fromarray(np.dstack([o.astype(np.uint8),al]),'RGBA'); return im.crop(im.getbbox())
# 이름: (파일, 크롭(900 기준), 배경키 'g'=잔디 'p'=잔디+흙길, 지울영역(비율), 아래 자르기(비율))
SPEC={
 'dad2_idle':('853d198b',(400,940,600,1475),'g',[],0.985),
 'dad2_flick':('e4b447f3',(340,800,560,1395),'g',[],1.0),
 'dad2_pick':('24f3a539',(270,520,600,1410),'g',[],0.985),
 'dad2_think':('bf70cc36',(85,760,215,1100),'g',[],1.0),
 'dad3':('af92022d',(290,630,590,1615),'g',[],1.0),
 'mom_bow':('af92022d',(0,790,293,1610),'g',[],1.0),
 'jam2_guard':('ce1771ad',(530,1160,730,1660),'p',[],1.0),
 'jam2_punch':('bf70cc36',(430,1100,590,1445),'p',[],1.0),
 'jam2_hips':('fa0abd2e',(600,890,790,1660),'g',[],1.0),
 'farmer2_back':('c405cb27',(195,320,385,805),'p',[],0.985),
}
def cut(name):
    f,b,key,kill,keep=SPEC[name]
    x0,y0,x1,y1=(int(v*S) for v in b); a=load(f)[y0:y1,x0:x1]
    bg=keybg(a)|green(a) if key=='p' else green(a)
    m=~bg
    H,W=m.shape
    m[int(H*keep):]=False
    A=a.astype(int)
    ring=(A[...,2]>A[...,0]+25)&(A[...,1]>A[...,0]+10)&(np.arange(H)[:,None]>H*0.9)   # 바닥에 걸친 파란 고리
    m&=~ring
    for k in kill: m[int(k[1]*H):int(k[3]*H),int(k[0]*W):int(k[2]*W)]=False
    m=fill_small(largest(nd.binary_opening(m,iterations=2)))
    return finish(a,nd.binary_erosion(m,iterations=1))
def company():
    """회사: 왼쪽을 가린 '아빠 강화' 표시는 좌우 대칭인 오른쪽을 거울로 비춰 채우고, 잔디는 색이 좁은 범위라 좁게 지움."""
    A=load('efad1470').copy()
    cx=449                                         # 건물 가운데 (900 기준)
    for y in range(int(980*S),int(1080*S)):
        for x in range(int(150*S),int(445*S)):
            A[y,x]=A[y,int((2*cx)*S)-x]
    x0,y0,x1,y1=(int(v*S) for v in (195,640,705,1265))
    a=A[y0:y1,x0:x1].copy(); R,G,B=(a[...,i].astype(int) for i in range(3))
    grass=(np.abs(R-75)<18)&(np.abs(G-150)<18)&(B<20)
    grass=nd.binary_dilation(nd.binary_erosion(grass,iterations=1),iterations=1)|grass&nd.binary_erosion(grass,iterations=1)
    labl,_=nd.label(grass)
    border=set(np.unique(np.concatenate([labl[0],labl[-1],labl[:,0],labl[:,-1]])))-{0}
    bg=np.isin(labl,list(border))
    loose=(G>R+35)&(G>B+60)&(B<60)                # 밝은 풀잎 등: 배경에 닿은 것만 조금씩 번져 지움 (나무 외곽선에서 멈춤)
    for _ in range(6): bg|=nd.binary_dilation(bg)&loose
    fg=nd.binary_fill_holes(largest(nd.binary_opening(~bg,iterations=1)))
    al=np.array(Image.fromarray((fg*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)))
    im=Image.fromarray(np.dstack([a,al]),'RGBA'); return im.crop(im.getbbox()), cx


# 저장할 키(px): 사람은 '서 있는 키'가 같도록 맞춤
HEIGHT = {'dad2_idle': 420, 'dad2_flick': 420, 'dad2_pick': 420, 'dad2_think': 420, 'dad3': 440,
          'mom_bow': 430, 'jam2_guard': 410, 'jam2_punch': 400, 'jam2_hips': 420}

def scaled(im, h): return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)

if __name__ == '__main__':
    dst = (sys.argv[2] if len(sys.argv) > 2 else 'assets').rstrip('/') + '/'
    F = dst + 'characters/family/'
    for k, h in HEIGHT.items():
        im = scaled(cut(k), h); im.save(F + k + '.png', optimize=True); print(k, im.size)
    im = scaled(cut('farmer2_back'), 300); im.save(dst + 'characters/farmer2/back_1.png', optimize=True); print('farmer2/back_1', im.size)
    c, _ = company(); c = c.resize((520, round(c.height * 520 / c.width)), Image.LANCZOS)
    c.save(dst + 'company.png', optimize=True); print('company', c.size)
