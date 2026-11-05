import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I: own scripts only
from common import *
import scipy.ndimage as nd
V, f, C, files = mesh(); fr = bframe()
P = np.c_[to_b(V[:, :2], fr), V[:, 2]]; n, ar = face_normals(P, f); cen = P[f].mean(1); FL = 244.25
ang = np.degrees(np.arctan2(n[:, 1], n[:, 0])) % 360
def wall(name, th, u0, u1, v0, v1, h0=0.3, h1=2.0, tol=15):
    t = np.radians(th); nn = np.array([np.cos(t), np.sin(t)]); tt = np.array([-nn[1], nn[0]])
    da = np.abs((ang - th + 180) % 360 - 180)
    s = (np.abs(n[:, 2]) < 0.35) & (da < tol) & (cen[:, 0] > u0) & (cen[:, 0] < u1) & (cen[:, 1] > v0) & (cen[:, 1] < v1) & (cen[:, 2] > FL + h0) & (cen[:, 2] < FL + h1)
    if s.sum() < 3: print(f"{name:28s} n/a"); return None
    d = cen[s, :2] @ nn; w = ar[s]; al = cen[s, :2] @ tt
    med = np.median(d); m = np.abs(d - med) < 0.15
    dm = np.average(d[m], weights=w[m]); sd = np.sqrt(np.average((d[m] - dm) ** 2, weights=w[m]))
    print(f"{name:28s} normal {th:3d}  offset {dm:7.3f}  spread {sd:.3f}  along {np.percentile(al[m],2):7.2f}..{np.percentile(al[m],98):7.2f}  area {w[m].sum():.2f} n {m.sum()}  h {cen[s][m][:,2].min()-FL:.2f}..{cen[s][m][:,2].max()-FL:.2f}")
    return dm
print("normal 90: offset = v; normal 0: offset = u; normal 180: offset = -u; normal 270: offset = -v; 315: (u-v)/rt2; 225: (-u-v)/rt2")
wall("facade inner @pier1", 90, 18.6, 19.15, 0.05, 1.0)
wall("facade inner @pier2", 90, 21.35, 21.8, 0.05, 1.0)
wall("facade inner @SW wall", 90, 15.0, 16.8, 0.05, 1.0)
wall("pier1 SW face (window1 NE reveal)", 180, 18.3, 18.9, 0.0, 0.9, 0.3, 1.7)
wall("pier1 NE face", 0, 18.9, 19.5, 0.0, 0.9, 0.3, 1.7)
wall("pier2 SW face", 180, 21.0, 21.5, 0.0, 0.9, 0.3, 1.7)
wall("pier2 NE face (entrance left)", 0, 21.6, 22.1, 0.0, 1.6, -0.6, 1.8)
wall("corner pillar SW face", 180, 24.0, 24.5, 0.0, 0.7, -0.6, 1.8)
wall("SW room wall", 0, 16.5, 17.2, 0.3, 2.4, 0.3, 2.1)
wall("diag back wall (shelf)", 315, 16.8, 20.8, 2.2, 6.2, 1.5, 2.15)
wall("diag back wall low", 315, 16.8, 20.8, 2.2, 6.2, 0.2, 1.5)
wall("diag right wall", 225, 20.8, 22.3, 4.0, 5.9, 0.3, 2.15)
wall("cafe back wall", 270, 22.0, 24.4, 3.6, 4.5, 0.3, 2.15)
wall("north inner wall", 180, 23.9, 24.6, 0.8, 4.2, 0.3, 2.15)
wall("store door niche W", 0, 20.3, 20.95, 5.6, 7.3, 0.3, 2.15)
wall("store door niche E", 180, 21.2, 22.0, 5.6, 7.3, 0.3, 2.15)
wall("store niche back", 270, 20.3, 22.0, 6.6, 7.5, 0.3, 2.15)
wall("door plane (entrance) +v", 270, 21.8, 24.4, 1.0, 2.0, 0.3, 2.0)
wall("door plane (entrance) -v", 90, 21.8, 24.4, 0.9, 2.0, 0.3, 2.0)
wall("passage-side opening N", 180, 24.3, 24.8, 0.4, 2.0, -0.4, 1.8)
