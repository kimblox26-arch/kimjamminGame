"""4단계 스프라이트 추출: Lv.2 집, 무너진 집, 금화, 하트, 2레벨 잼민이(농부), Lv.2 엄마, 걸어 나오는 아빠, 비는 아빠, 아기.

- Lv.2 집: 검은 배경을 테두리에서부터 지움
- 무너진 집·하트·금화: 잔디(초록)/반투명 판(어두운 초록)을 지움
- 2레벨 잼민이 앞모습: 줄지어 선 같은 사진 복사본을 이용해, 아래 복사본과 같은 픽셀은 배경으로 보고 다리만 남김
- 아기: 사람 없는 장면을 SIFT로 정렬한 차이로 분리, 계단과 겹치는 등 윗부분은 둥근 윤곽으로 채움

사용법: python3 tools/extract_round4.py <스크린샷 폴더> [assets 폴더]
필요: pip install pillow numpy scipy opencv-python-headless
"""
import sys, os
import numpy as np, cv2
from PIL import Image, ImageFilter, ImageOps
from scipy import ndimage as nd

U = sys.argv[1].rstrip('/') + '/' if len(sys.argv) > 1 else './'
def keybg(a):
    f=a.astype(float)/255; r,g,b=f[...,0],f[...,1],f[...,2]
    mx=f.max(-1); mn=f.min(-1); d=mx-mn+1e-6; s=d/(mx+1e-6)
    h=np.where(mx==r,((g-b)/d)%6,np.where(mx==g,(b-r)/d+2,(r-g)/d+4))*60
    green=(h>55)&(h<170)&(s>0.25)&(g>=r*0.9)
    sand=(h>=30)&(h<=60)&(s>0.45)&(mx>0.45)
    return green|sand
def front_farmer():
    I=np.asarray(Image.open(U+'69d43f66-image.jpg').convert('RGB')).astype(np.float32)
    DX,DY=6,437
    X0,X1,Y0,Y1=548,880,455,1150
    bg=keybg(I)
    fg=~bg
    m=np.zeros(I.shape[:2],bool)
    m[Y0:905,X0:X1]=fg[Y0:905,X0:X1]
    ys=np.arange(905,Y1)[:,None]; xs=np.arange(X0,X1)[None,:]
    cur=I[905:Y1,X0:X1]
    dmin=np.full(cur.shape[:2],1e9)
    for sy in range(-4,5):
        for sx in range(-4,5):
            src=I[ys-DY+sy,xs-DX+sx]
            dmin=np.minimum(dmin,np.abs(cur-src).sum(-1))
    s2=fg[ys-DY,xs-DX]
    leg=np.where(s2,dmin>60,fg[905:Y1,X0:X1])
    R,G,B=cur[...,0],cur[...,1],cur[...,2]
    red=(R>G+60)&(R>B+50)
    leg&=~red
    m[905:Y1,X0:X1]=leg
    m=nd.binary_opening(m,iterations=2)
    lab,n=nd.label(m); m=lab==(np.argmax(nd.sum(m,lab,range(1,n+1)))+1)
    m=nd.binary_closing(m,iterations=3)
    hl,hn=nd.label(nd.binary_fill_holes(m)&~m)
    for j in range(1,hn+1):
        if (hl==j).sum()<250: m|=hl==j
    m=nd.binary_erosion(m,iterations=1)
    al=np.array(Image.fromarray((m*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))).astype(float)
    al=np.clip((al-50)*1.5,0,255).astype(np.uint8)
    im=Image.fromarray(np.dstack([I.astype(np.uint8),al]),'RGBA'); return im.crop(im.getbbox())
S=1.2
def load(f): return np.asarray(Image.open(U+f+'-image.jpg').convert('RGB'))
def crop(a,b): b=tuple(int(v*S) for v in b); return a[b[1]:b[3],b[0]:b[2]]
def largest(m):
    lab,n=nd.label(m); return lab==(np.argmax(nd.sum(m,lab,range(1,n+1)))+1)
def fill_small(m,lim=300):
    hl,hn=nd.label(nd.binary_fill_holes(m)&~m)
    for j in range(1,hn+1):
        if (hl==j).sum()<lim: m|=hl==j
    return m
def finish(a,m,blur=1.0,despill=True):
    al=np.array(Image.fromarray((m*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))).astype(float)
    al=np.clip((al-50)*1.5,0,255).astype(np.uint8)
    o=a.astype(int).copy()
    if despill: o[...,1]=np.minimum(o[...,1],np.maximum(o[...,0],o[...,2])+12)
    im=Image.fromarray(np.dstack([o.astype(np.uint8),al]),'RGBA'); return im.crop(im.getbbox())
def green(a): a=a.astype(int); return (a[...,1]>a[...,0]+18)&(a[...,1]>a[...,2]+18)

def house2():
    a=crop(load('df430527'),(40,665,845,1195))
    dark=a.max(-1)<28
    lab,_=nd.label(dark)
    border=set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])))-{0}
    m=~np.isin(lab,list(border))
    m=fill_small(largest(nd.binary_opening(m,iterations=1)),2000)
    al=np.array(Image.fromarray((m*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)))
    im=Image.fromarray(np.dstack([a,al]),'RGBA'); return im.crop(im.getbbox())
def rubble():
    a=crop(load('83a23060'),(150,770,750,1190))
    m=~green(a)
    m=nd.binary_opening(m,iterations=1)
    lab,n=nd.label(m); sz=nd.sum(m,lab,range(1,n+1))
    m=np.isin(lab,[i+1 for i,z in enumerate(sz) if z>40])
    return finish(a,m,0.7,False)
def coin():
    a=crop(load('163cd371'),(220,882,330,996)).astype(int)
    m=~(a[...,1]>a[...,0]+5)
    m=nd.binary_fill_holes(largest(nd.binary_opening(m,iterations=1)))
    return finish(a,m,0.8,False)
def heart():
    a=crop(load('1c377b25'),(375,570,562,756))
    m=nd.binary_fill_holes(largest(~green(a)))
    return finish(a,m,1.0,False)
def generic(f,b,kill=(),key='green'):
    a=crop(load(f),b)
    m=~(keybg(a) if key=='path' else green(a))
    H,W=m.shape
    for x0,y0,x1,y1 in kill: m[int(y0*H):int(y1*H),int(x0*W):int(x1*W)]=False
    m=fill_small(largest(nd.binary_opening(m,iterations=2)))
    m=nd.binary_erosion(m,iterations=1)
    return finish(a,m)
def baby():
    """아기: 집과 겹치는 머리 부분은 사람 없는 장면과의 차이로 분리."""
    C=cv2.imread(U+'1c377b25-image.jpg'); T=cv2.imread(U+'0342afeb-image.jpg')
    sift=cv2.SIFT_create(5000)
    mc=np.zeros(C.shape[:2],np.uint8); mc[850:1560,60:1020]=255
    mt=np.zeros(T.shape[:2],np.uint8); mt[850:1340,150:930]=255
    k1,d1=sift.detectAndCompute(cv2.cvtColor(C,cv2.COLOR_BGR2GRAY),mc)
    k2,d2=sift.detectAndCompute(cv2.cvtColor(T,cv2.COLOR_BGR2GRAY),mt)
    good=[p for p,q in cv2.BFMatcher().knnMatch(d1,d2,k=2) if p.distance<0.75*q.distance]
    A,_=cv2.estimateAffinePartial2D(np.float32([k1[g.queryIdx].pt for g in good]),np.float32([k2[g.trainIdx].pt for g in good]),method=cv2.RANSAC,ransacReprojThreshold=2)
    W=cv2.warpAffine(C,A,(T.shape[1],T.shape[0]),borderMode=cv2.BORDER_REPLICATE)
    d=np.abs(cv2.GaussianBlur(W,(5,5),0).astype(int)-cv2.GaussianBlur(T,(5,5),0).astype(int)).sum(-1)
    x0,y0,x1,y1=(int(v*S) for v in (360,1100,545,1385))
    a=T[y0:y1,x0:x1,::-1]; dd=d[y0:y1,x0:x1]
    Hc,Wc=dd.shape; yy=np.arange(Hc)[:,None]; xx=np.arange(Wc)[None,:]
    top=int(0.16*Hc)                                  # 계단·디딤돌과 겹치는 위쪽: 등의 둥근 윤곽(포물선)으로 채움
    arc=(yy>=14+0.0062*(xx-123)**2)&(xx>=48)&(xx<=199)
    m=np.where(yy<top,arc,(dd>70)|~green(a))
    a=a.copy()
    band=(yy<top)&arc&(dd<70)                          # 등 윗부분에 비치는 돌은 셔츠 색으로 칠함
    shirt=a[top:top+25,int(0.25*Wc):int(0.4*Wc)].reshape(-1,3)
    shirt=shirt[shirt.mean(1)>150]
    a[band]=np.median(shirt,0).astype(np.uint8)
    m&=~green(a)
    m=fill_small(largest(nd.binary_opening(m,iterations=2)))
    m=nd.binary_erosion(m,iterations=1)
    return finish(a,m)

def scaled(im,h): return im.resize((round(im.width*h/im.height),h),Image.LANCZOS)
def run(dst):
    F=dst+'characters/family/'; E=dst+'characters/farmer2/'; UI=dst+'ui/'
    for p in (F,E,UI): os.makedirs(p,exist_ok=True)
    h2=house2(); h2=h2.resize((780,round(h2.height*780/h2.width)),Image.LANCZOS); h2.save(dst+'house2.png',optimize=True); print('house2',h2.size)
    r=rubble(); r=r.resize((640,round(r.height*640/r.width)),Image.LANCZOS); r.save(dst+'rubble.png',optimize=True); print('rubble',r.size)
    c=coin().resize((96,96),Image.LANCZOS); c.save(UI+'coin.png',optimize=True)
    h=heart(); h=scaled(h,180); h.save(UI+'heart.png',optimize=True)
    # 적 2레벨 (서 있는 키 = 그림 높이 300)
    fs={'side_0':generic('7ddd18be',(375,880,615,1505),key='path'),
        'side_1':generic('a6bf4870',(250,825,620,1540),key='path'),
        'back_0':generic('a4ebd577',(280,860,475,1415),key='path'),
        'front_0':front_farmer()}
    for k,im in fs.items():
        im=scaled(im,300); im.save(E+k+'.png',optimize=True); print('farmer2',k,im.size)
    ImageOps.mirror(scaled(fs['back_0'],300)).save(E+'back_1.png',optimize=True)
    ImageOps.mirror(scaled(fs['front_0'],300)).save(E+'front_1.png',optimize=True)
    # 가족 (서 있는 키 = 420)
    for name,(f,b,kill,h) in {
        'mom2_front_0':('ac6609c0',(310,410,475,950),[(0,0.96,1,1)],420),
        'mom2_front_1':('7ddd18be',(520,170,730,840),[],420),
        'dad_out':('939e64be',(120,645,375,1310),[(0.62,0.86,1,1)],420),
        'dad_beg':('86408e62',(345,1168,610,1452),[],250),
        }.items():
        im=scaled(generic(f,b,kill),h); im.save(F+name+'.png',optimize=True); print(name,im.size)
    b=scaled(baby(),250); b.save(F+'baby.png',optimize=True); print('baby',b.size)
if __name__=='__main__':
    run((sys.argv[2] if len(sys.argv) > 2 else 'assets').rstrip('/')+'/')
