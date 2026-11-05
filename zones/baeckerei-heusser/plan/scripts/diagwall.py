import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I: own scripts only
from common import *
V, f, C, files = mesh(); fr = bframe()
P = np.c_[to_b(V[:, :2], fr), V[:, 2]]; FL = 244.25; r2 = np.sqrt(2)
T = (P[:, 0] + P[:, 1]) / r2; Cc = (P[:, 0] - P[:, 1]) / r2
Q = np.c_[Cc, P[:, 2] - FL, T]
print(" t     wall(p10 c, h .3-2.2, c<11)   shelf-front(max c, h .3-1.9, c<11.2)  counter c-range (h .3-.8, c 11.2-12.8)  counter top h")
for t in np.arange(13.0, 18.76, 0.25):
    S, _ = slice_mesh(Q, f, t)
    if len(S) == 0: continue
    pts = S.reshape(-1, 2)
    w = pts[(pts[:, 1] > 0.3) & (pts[:, 1] < 2.2) & (pts[:, 0] > 9.4) & (pts[:, 0] < 11.0)]
    sh = pts[(pts[:, 1] > 0.3) & (pts[:, 1] < 1.9) & (pts[:, 0] > 9.4) & (pts[:, 0] < 11.2)]
    ct = pts[(pts[:, 1] > 0.3) & (pts[:, 1] < 0.8) & (pts[:, 0] > 11.2) & (pts[:, 0] < 12.8)]
    ctop = pts[(pts[:, 1] > 0.3) & (pts[:, 1] < 1.2) & (pts[:, 0] > 11.3) & (pts[:, 0] < 12.4)]
    print(f"{t:5.2f}  {np.percentile(w[:,0],10) if len(w) else np.nan:6.2f} ({len(w):3d})   {np.percentile(sh[:,0],90) if len(sh) else np.nan:6.2f}   "
          f"{(np.percentile(ct[:,0],5) if len(ct) else np.nan):6.2f}..{(np.percentile(ct[:,0],95) if len(ct) else np.nan):6.2f} ({len(ct):3d})   {(np.percentile(ctop[:,1],90) if len(ctop) else np.nan):5.2f}")
