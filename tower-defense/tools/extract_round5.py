"""5단계 스프라이트 추출: 일어선 아기(2자세), 아기 뒷모습, Lv.2 잼민이(아군, 3자세), 학교.

- 잔디/흙길 위에 선 사람: 초록·노랑(흙길)을 지우고 가장 큰 덩어리
- 건물 앞에 선 사람: 사람 없는 장면을 SIFT로 정렬해 차이 나는 곳만. 머리 위에 걸친 자막은 머리 둥근 윤곽으로 걷어냄
- 학교: 잔디를 테두리부터 지우고, 깃발 주변 꽃가루는 꽃가루 없는 장면에서 바꿔 끼움

사용법: python3 tools/extract_round5.py <스크린샷 폴더> [assets 폴더]
필요: pip install pillow numpy scipy opencv-python-headless
"""
import sys, os
import numpy as np, cv2
from PIL import Image, ImageFilter
from scipy import ndimage as nd

U = sys.argv[1].rstrip('/') + '/' if len(sys.argv) > 1 else './'
S = 1.2
def keybg(a):
    f = a.astype(float) / 255; r,g,b=f[...,0],f[...,1],f[...,2]
    mx=f.max(-1); mn=f.min(-1); d=mx-mn+1e-6; s=d/(mx+1e-6)
    h=np.where(mx==r,((g-b)/d)%6,np.where(mx==g,(b-r)/d+2,(r-g)/d+4))*60
    green=(h>55)&(h<170)&(s>0.25)&(g>=r*0.9)
    sand=(h>=30)&(h<=60)&(s>0.45)&(mx>0.45)
    return green|sand

B={
 'baby_stand':('7c3998eb',(350,745,580,1350)),
 'baby_stand2':('2df5f074',(340,780,595,1345)),
 'jam2_a':('1bc63392',(385,885,575,1375)),
 'jam2_b':('41afa2c8',(345,950,605,1450)),
 'jam2_laugh':('d571a139',(280,740,605,1635)),
 'baby_back':('622f0a1b',(390,970,495,1220)),
 'school6':('a6b21c01',(80,770,800,1190)),
 'school5':('ea5b55bd',(230,840,708,1128)),
}

def load(f): return np.asarray(Image.open(U+f+'-image.jpg').convert('RGB'))
def box(name): return tuple(int(v*S) for v in B[name][1])
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
def keyed(name,kill=(),sand=True):
    f=B[name][0]; x0,y0,x1,y1=box(name); a=load(f)[y0:y1,x0:x1]
    m=(~keybg(a) if sand else np.ones(a.shape[:2],bool))&~green(a)
    H,W=m.shape
    for k in kill: m[int(k[1]*H):int(k[3]*H),int(k[0]*W):int(k[2]*W)]=False
    m=fill_small(largest(nd.binary_opening(m,iterations=2)))
    return finish(a,nd.binary_erosion(m,iterations=1))
def align(ref,tgt,refmask,tgtmask):
    C=cv2.imread(U+ref+'-image.jpg'); T=cv2.imread(U+tgt+'-image.jpg')
    sift=cv2.SIFT_create(6000)
    mc=np.zeros(C.shape[:2],np.uint8); mt=np.zeros(T.shape[:2],np.uint8)
    for (x0,y0,x1,y1) in refmask: mc[y0:y1,x0:x1]=255
    for (x0,y0,x1,y1) in tgtmask: mt[y0:y1,x0:x1]=255
    k1,d1=sift.detectAndCompute(cv2.cvtColor(C,cv2.COLOR_BGR2GRAY),mc)
    k2,d2=sift.detectAndCompute(cv2.cvtColor(T,cv2.COLOR_BGR2GRAY),mt)
    good=[p for p,q in cv2.BFMatcher().knnMatch(d1,d2,k=2) if p.distance<0.75*q.distance]
    A,inl=cv2.estimateAffinePartial2D(np.float32([k1[g.queryIdx].pt for g in good]),np.float32([k2[g.trainIdx].pt for g in good]),method=cv2.RANSAC,ransacReprojThreshold=2)
    W=cv2.warpAffine(C,A,(T.shape[1],T.shape[0]),borderMode=cv2.BORDER_REPLICATE)
    return W,T
def diffcut(name,ref,refmask,tgtmask,T1=70,soft=None,label_rows=0):
    """건물 앞에 선 사람: 사람 없는 장면을 정렬해 차이 나는 곳만 (잔디는 녹색 키)."""
    f=B[name][0]; x0,y0,x1,y1=box(name)
    W,T=align(ref,f,refmask,tgtmask)
    d=np.abs(cv2.GaussianBlur(W,(5,5),0).astype(int)-cv2.GaussianBlur(T,(5,5),0).astype(int)).sum(-1)[y0:y1,x0:x1]
    a=T[y0:y1,x0:x1,::-1].copy()
    Tm=np.full(d.shape,T1,float)
    if soft:                                   # 머리처럼 배경과 색이 비슷한 곳은 기준을 낮춤
        x0s,y0s,x1s,y1s,ts=soft; Tm[y0s:y1s,x0s:x1s]=ts
    m=(d>Tm)&~green(a)
    m=nd.binary_closing(nd.binary_opening(m,iterations=2),iterations=2)
    if label_rows:                             # 머리 위에 걸친 자막: 머리 둥근 윤곽 안의 어두운 머리카락만
        m=largest(m)
        r0=label_rows; cols=np.where(m[r0])[0]
        c0,c1=cols.min(),cols.max(); cx=(c0+c1)/2; ah=(c1-c0)/2; bh=min(ah*1.05,r0-12)
        V=a.max(-1)
        for r in range(r0):
            k=1-((r0-r)/bh)**2
            band=np.zeros(m.shape[1],bool)
            if k>0:
                hw=ah*np.sqrt(k); band[int(cx-hw):int(cx+hw)+1]=True
            px=a[r].astype(int); mx,mn=px.max(-1),px.min(-1)
            white=(mn>165)&(mx-mn<45); gold=(px[:,0]>170)&(px[:,1]>140)&(px[:,2]<120)
            m[r]=band&~white&~gold&~green(a[r:r+1])[0]
        m=largest(nd.binary_opening(m,iterations=1))
    m=fill_small(largest(m),900)
    m=nd.binary_erosion(m,iterations=1)
    return finish(a,m), d, a

def school():
    x0,y0,x1,y1=box('school6')
    # 깃발 주변 꽃가루: 꽃가루 없는 장면(애기 강화 표시)을 정렬해 깃발 윗부분만 바꿔 끼움
    W,T=align('108c0f07','a6b21c01',[(240,1080,880,1330)],[(150,1010,950,1420)])
    a=T[y0:y1,x0:x1,::-1].copy(); w=W[y0:y1,x0:x1,::-1]
    top=105
    a[:top,:]=w[:top,:]
    A=a.astype(int)
    grass=(A[...,1]>A[...,0]+20)&(A[...,1]>A[...,2]+45)
    lab,_=nd.label(grass)
    border=set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])))-{0}
    fg=~np.isin(lab,list(border))
    fg=nd.binary_opening(fg,iterations=1)
    fg=largest(fg)
    fg=nd.binary_fill_holes(fg)
    al=np.array(Image.fromarray((fg*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)))
    im=Image.fromarray(np.dstack([a,al]),'RGBA'); return im.crop(im.getbbox())


def scaled(im, h): return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)

if __name__ == '__main__':
    dst = (sys.argv[2] if len(sys.argv) > 2 else 'assets').rstrip('/') + '/'
    F = dst + 'characters/family/'
    os.makedirs(F, exist_ok=True)
    out = {
        'baby_stand': keyed('baby_stand', sand=False),
        'jam2_front_0': keyed('jam2_a'),
        'jam2_front_1': keyed('jam2_b'),
        'baby_stand2': diffcut('baby_stand2', '1c377b25', [(36, 912, 1014, 1566)], [(130, 790, 414, 1338), (708, 790, 960, 1338)], soft=(100, 0, 205, 110, 30))[0],
        'jam2_laugh': diffcut('jam2_laugh', 'a6b21c01', [(106, 1000, 948, 1420)], [(66, 996, 330, 1404), (730, 996, 1014, 1404)], label_rows=44, soft=(115, 150, 255, 340, 30))[0],
        'baby_back': diffcut('baby_back', 'a6b21c01', [(106, 1000, 948, 1420)], [(54, 930, 460, 1440), (600, 930, 1020, 1440)])[0],
    }
    for k, im in out.items():
        im = scaled(im, 420); im.save(F + k + '.png', optimize=True); print(k, im.size)
    sc = school(); sc = sc.resize((640, round(sc.height * 640 / sc.width)), Image.LANCZOS)
    sc.save(dst + 'school.png', optimize=True); print('school', sc.size)
