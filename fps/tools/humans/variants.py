# 인물 변형: MakeHuman 매크로(성별/근육/체중/인종) + 얼굴 세부 모프
def tri(x):
    if x < 0.5: return {'min': 1 - x / 0.5, 'average': x / 0.5}
    return {'average': 1 - (x - 0.5) / 0.5, 'max': (x - 0.5) / 0.5}

def macro(gender=1.0, muscle=0.5, weight=0.5, prop=0.5, eth=(0.33, 0.33, 0.34), age=0.12):
    # age: 25세(young)→90세(old) 보간 비율. 0.12 ≈ 33세
    W = {}
    for G, wg in (('female', 1 - gender), ('male', gender)):
        if wg <= 0: continue
        for A, wa in (('young', 1 - age), ('old', age)):
            if wa <= 0: continue
            for e, we in zip(('african', 'asian', 'caucasian'), eth):
                if we > 0: W[f'macrodetails/{e}-{G}-{A}.target'] = wg * we * wa
            for M, wm in tri(muscle).items():
                for Wt, ww in tri(weight).items():
                    k = wg * wm * ww * wa
                    if k <= 1e-4: continue
                    W[f'macrodetails/universal-{G}-{A}-{M}muscle-{Wt}weight.target'] = k
                    if prop > 0: W[f'macrodetails/proportions/{G}-{A}-{M}muscle-{Wt}weight-idealproportions.target'] = k * prop
    return W

def face(**mods):
    """mods: 'nose/nose-scale-horiz' = -1..1 (decr/incr), 단일 타깃은 'head/head-square'= 0..1"""
    W = {}
    PAIRS = {'decr': 'incr', 'down': 'up', 'in': 'out', 'backward': 'forward', 'concave': 'convex', 'compress': 'uncompress'}
    for k, v in mods.items():
        k = k.replace('__', '/')
        if k.endswith('!'): W[k[:-1] + '.target'] = v; continue
        lo, hi = SUFFIX.get(k, ('decr', 'incr'))
        W[f'{k}-{hi if v > 0 else lo}.target'] = abs(v)
    return W

SUFFIX = {}
def sym(prefix, names, v):
    return {f'{prefix}/{s}-{prefix}-{n}': v for s in ('l', 'r') for n in names}

def V(macro_kw, faces, sfx=None):
    W = macro(**macro_kw)
    W.update(face(**faces))
    return W

# 접미사 규칙 (decr/incr 이 아닌 쌍)
for k, s in {
    'nose/nose-trans': ('down', 'up'), 'nose/nose-point': ('down', 'up'), 'nose/nose-base': ('down', 'up'), 'nose/nose-curve': ('concave', 'convex'),
    'mouth/mouth-trans': ('down', 'up'), 'mouth/mouth-angles': ('down', 'up'), 'chin/chin-jaw-drop': ('decr', 'incr'),
    'eyebrows/eyebrows-trans': ('down', 'up'), 'eyebrows/eyebrows-angle': ('down', 'up'), 'head/head-trans': ('down', 'up'),
    'forehead/forehead-trans': ('backward', 'forward'), 'mouth/mouth-dimples': ('in', 'out'), 'mouth/mouth-laugh-lines': ('in', 'out'),
}.items(): SUFFIX[k] = s
for side in 'lr':
    SUFFIX[f'eyes/{side}-eye-trans'] = ('down', 'up')
    SUFFIX[f'eyes/{side}-eye-epicanthus'] = ('in', 'out')
    SUFFIX[f'eyes/{side}-eye-eyefold-angle'] = ('down', 'up')
    SUFFIX[f'eyes/{side}-eye-bag'] = ('decr', 'incr')

def both(name, v):
    return {f'eyes/l-eye-{name}': v, f'eyes/r-eye-{name}': v} if not name.startswith('cheek') else {f'cheek/l-{name}': v, f'cheek/r-{name}': v}

def F(**kw):
    out = {}
    for k, v in kw.items():
        if k.startswith('EYE_'): out.update(both(k[4:].replace('_', '-'), v))
        elif k.startswith('CHEEK_'): out.update(both('cheek-' + k[6:].replace('_', '-'), v))
        else:
            grp, rest = k.split('_', 1)
            out[f'{grp}/{grp}-{rest.replace("_", "-")}'] = v
    return out

VARIANTS = {
    # 아군
    'jin': V(dict(gender=1, muscle=0.75, weight=0.55, eth=(0.0, 0.9, 0.1), age=0.13),
             F(nose_scale_horiz=-0.2, nose_hump=0.1, chin_width=0.25, head_scale_horiz=0.1, EYE_epicanthus=0.35, CHEEK_bones=0.35, mouth_scale_horiz=-0.1, eyebrows_trans=-0.15)),
    'mason': V(dict(gender=1, muscle=0.8, weight=0.66, eth=(0.0, 0.0, 1.0), age=0.2),
               F(nose_scale_vert=0.35, nose_hump=0.45, nose_point_width=0.2, chin_prominent=0.35, chin_width=0.4, forehead_scale_vert=0.2, EYE_bag=0.3, eyebrows_trans=-0.35, head_scale_horiz=0.12)),
    'sofia': V(dict(gender=0.0, muscle=0.6, weight=0.42, eth=(0.15, 0.25, 0.6), age=0.06),
               F(nose_scale_horiz=-0.3, nose_point=0.25, mouth_lowerlip_volume=0.35, mouth_upperlip_volume=0.25, chin_width=-0.3, CHEEK_bones=0.3, EYE_scale=0.2)),
    'dae': V(dict(gender=1, muscle=0.74, weight=0.62, eth=(0.0, 0.85, 0.15), age=0.22),
             F(nose_scale_horiz=0.2, nose_trans=-0.1, chin_height=0.25, chin_width=0.3, head_square=0.35, EYE_epicanthus=0.3, EYE_bag=0.25, mouth_scale_horiz=0.15)),
    # 적
    'op1': V(dict(gender=1, muscle=0.78, weight=0.5, eth=(0.1, 0.25, 0.65), age=0.14),
             F(nose_scale_depth=0.3, nose_hump=0.3, chin_prominent=0.4, chin_width=0.35, head_rectangular=0.4, CHEEK_bones=0.2, eyebrows_trans=-0.4)),
    'op2': V(dict(gender=1, muscle=0.72, weight=0.72, eth=(0.35, 0.05, 0.6), age=0.24),
             F(nose_scale_horiz=0.35, nose_flaring=0.3, chin_width=0.45, head_round=0.3, mouth_scale_horiz=0.2, neck_scale_horiz=0.3, EYE_bag=0.35)),
    'op3': V(dict(gender=1, muscle=0.66, weight=0.42, eth=(0.0, 0.1, 0.9), age=0.1),
             F(nose_scale_vert=0.3, nose_point=-0.2, chin_triangle=0.0, head_oval=0.4, CHEEK_bones=0.45, CHEEK_volume=-0.3, eyebrows_trans=-0.2)),
    'op4': V(dict(gender=1, muscle=0.8, weight=0.62, eth=(0.85, 0.0, 0.15), age=0.26),
             F(nose_scale_horiz=0.4, nose_flaring=0.45, mouth_lowerlip_volume=0.3, mouth_upperlip_volume=0.25, chin_width=0.3, head_square=0.3, forehead_nubian=0.25)),
}
# 단일 타깃(쌍이 아닌 것) 처리
SINGLE = ('head/head-square', 'head/head-round', 'head/head-oval', 'head/head-rectangular', 'chin/chin-triangle')
for k, W in VARIANTS.items():
    fixed = {}
    for t, v in W.items():
        base = t.rsplit('-', 1)[0]
        hit = [s for s in SINGLE if t.startswith(s + '-')]
        if hit: fixed[hit[0] + '.target'] = v
        else: fixed[t] = v
    VARIANTS[k] = {'targets': fixed}
