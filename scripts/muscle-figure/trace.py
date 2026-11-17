"""Vectorise the Blender renders into src/features/training/muscleFigure.data.ts and encode the base images.

Usage: python scripts/muscle-figure/trace.py <render dir> <repo root>

- ID map -> one closed path per app muscle id and side (pixel-edge boundary tracing, Douglas-Peucker,
  implicit-lineto polygons, even-odd holes, specks dropped).
- PART map -> optional internal hairlines between anatomical parts of the same id (off: HAIRLINES).
- Shaded Cycles render (muscles, skeleton, connective tissue, body surface cropped to head/hands/feet) ->
  levels + S-curve, face softened -> greyscale + alpha base -> public/muscle-figure/<view>.webp (ffmpeg,
  libwebp) and the body silhouette path from its alpha. Same camera as the id map: pixel-exact alignment.
- Synthesised region: BodyParts3D 4.0 has no latissimus dorsi mesh. Inside a proportional box on the back,
  pixels that show ribs, deep (neutral) muscles or the serratus anterior become 'lats', shaded from the
  uncropped body surface. (No rectus abdominis either, but the external oblique element includes its
  aponeurosis over the whole anterior abdominal wall, so the front needs no synthesis.) See README.
Deterministic: no randomness; output depends only on the inputs.
"""
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

RENDERS, REPO = Path(sys.argv[1]), Path(sys.argv[2])
VB_H = 800  # viewBox height of the generated data
BASE_H = 720  # pixel height of the shaded base images: 2x a 360 px tall display
WEBP_Q = 80
HAIRLINES = False  # the occlusion grooves in the base already separate the parts
SPINE_HALF = 0.018  # half-width of the spine strip kept visible inside the lats box (fraction of height)
GROOVE = 0.35  # darkening of the synthesised region's border
FACE_BLUR = 0.006  # face softening radius (fraction of height)
CUT_BLEND = 6  # half-width (render px) of the blend across the skin cut lines
TONE_POINTS = [0.02, 0.12, 0.47, 0.58, 0.68, 0.86, 0.94]  # out values for 0, p1, p25, p50, p75, p99, max
DP_TOL = 1.15  # Douglas-Peucker tolerance in viewBox units
MIN_AREA = 40.0  # drop loops smaller than this (viewBox units^2): slivers are no use as tap targets
LINE_MIN = 9.0  # drop hairlines shorter than this (viewBox units)
# Rows of the back trunk searched for the synthesised latissimus: (top, bottom) as fractions of body height.
BOX = {"back": (0.20, 0.47)}
THIN_R = 2  # opening radius (render px) that removes id structures thinner than ~5 px (~5.5 mm)

pal = json.loads((RENDERS / "palette.json").read_text(encoding="utf-8"))


def load_rgba(p):
    return np.asarray(Image.open(p).convert("RGBA"), dtype=np.int16)


def decode(img, table):
    """Label image from flat colours: nearest palette colour, 0 for transparent/black."""
    keys = list(table)
    cols = np.array([[int(v) for v in k.split(",")] for k in keys], dtype=np.int32)
    rgb = img[..., :3].astype(np.int32)
    lab = np.zeros(img.shape[:2], dtype=np.int32)
    on = (img[..., 3] > 127) & (rgb.sum(-1) > 30)
    px = rgb[on]
    d = ((px[:, None, :] - cols[None, :, :]) ** 2).sum(-1)
    best = d.argmin(1)
    ok = d[np.arange(len(best)), best] < 300
    vals = np.where(ok, best + 1, 0)
    lab[on] = vals
    return lab, keys


def boundary_loops(mask):
    """Closed loops of pixel edges around a boolean mask (inside on the left). Vertices in pixel corners."""
    m = np.pad(mask, 1).astype(np.int8)
    nxt = {}
    # Horizontal edges: between rows r-1 and r. Moving +x when the pixel below is inside (top border).
    dv = m[1:, :] - m[:-1, :]  # shape (H+1, W+2)
    ys, xs = np.nonzero(dv == 1)  # top border of a region: go right
    for y, x in zip(ys.tolist(), xs.tolist()):
        nxt.setdefault((x, y + 1), []).append((x + 1, y + 1))
    ys, xs = np.nonzero(dv == -1)  # bottom border: go left
    for y, x in zip(ys.tolist(), xs.tolist()):
        nxt.setdefault((x + 1, y + 1), []).append((x, y + 1))
    dh = m[:, 1:] - m[:, :-1]
    ys, xs = np.nonzero(dh == 1)  # left border: go up
    for y, x in zip(ys.tolist(), xs.tolist()):
        nxt.setdefault((x + 1, y + 1), []).append((x + 1, y))
    ys, xs = np.nonzero(dh == -1)  # right border: go down
    for y, x in zip(ys.tolist(), xs.tolist()):
        nxt.setdefault((x + 1, y), []).append((x + 1, y + 1))
    loops = []
    while nxt:
        start = next(iter(nxt))
        loop = [start]
        cur = start
        while True:
            outs = nxt.get(cur)
            if not outs:
                break
            n = outs.pop()
            if not outs:
                del nxt[cur]
            if n == start:
                break
            loop.append(n)
            cur = n
        if len(loop) > 3:
            loops.append(np.array(loop, dtype=np.float64) - 1.0)  # undo padding
    return loops


def area(pts):
    x, y = pts[:, 0], pts[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def dp(pts, tol):
    """Douglas-Peucker on an open polyline (iterative)."""
    if len(pts) < 3:
        return pts
    keep = np.zeros(len(pts), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = pts[a], pts[b]
        seg = q - p
        n = np.hypot(*seg)
        rel = pts[a + 1:b] - p
        d = np.abs(seg[0] * rel[:, 1] - seg[1] * rel[:, 0]) / n if n > 1e-9 else np.hypot(rel[:, 0], rel[:, 1])
        i = int(d.argmax())
        if d[i] > tol:
            k = a + 1 + i
            keep[k] = True
            stack += [(a, k), (k, b)]
    return pts[keep]


def simplify_closed(pts, tol):
    # Split at the farthest point from the first one so DP works on two open halves.
    far = int(np.hypot(*(pts - pts[0]).T).argmax())
    a = dp(np.vstack([pts[: far + 1]]), tol)
    b = dp(np.vstack([pts[far:], pts[:1]]), tol)
    return np.vstack([a[:-1], b[:-1]])


def smooth(pts, iters=1):
    """Chaikin corner cutting on a closed polygon (keeps outlines organic after DP)."""
    for _ in range(iters):
        q = np.roll(pts, -1, axis=0)
        pts = np.vstack([np.column_stack([0.75 * pts[:, 0] + 0.25 * q[:, 0], 0.75 * pts[:, 1] + 0.25 * q[:, 1]]),
                         np.column_stack([0.25 * pts[:, 0] + 0.75 * q[:, 0], 0.25 * pts[:, 1] + 0.75 * q[:, 1]])])
        n = len(pts) // 2
        out = np.empty_like(pts)
        out[0::2], out[1::2] = pts[:n], pts[n:]
        pts = out
    return pts


def fmt(v):
    r = round(v * 2) / 2
    return str(int(r)) if r == int(r) else f"{r:.1f}"


def path_of(loops):
    parts = []
    for pts in loops:
        coords = " ".join(f"{fmt(x)} {fmt(y)}" for x, y in pts)
        parts.append(f"M{coords}Z")
    return "".join(parts)


def mask_path(mask, scale, tol=DP_TOL, min_area=MIN_AREA):
    loops = []
    for lp in boundary_loops(mask):
        lp = lp * scale
        if abs(area(lp)) < min_area:
            continue
        s = simplify_closed(lp, tol)
        if len(s) < 3:
            continue
        s = dp(np.vstack([smooth(s, 1), smooth(s, 1)[:1]]), tol * 0.5)[:-1]
        loops.append(s)
    return path_of(loops) if loops else None


def hairlines(id_lab, part_lab, scale):
    """Open polylines along part boundaries inside one id region."""
    H, W = id_lab.shape
    adj = defaultdict(list)
    same_v = (id_lab[1:, :] == id_lab[:-1, :]) & (id_lab[1:, :] > 0) & (part_lab[1:, :] != part_lab[:-1, :])
    for y, x in zip(*np.nonzero(same_v)):
        a, b = (int(x), int(y) + 1), (int(x) + 1, int(y) + 1)
        adj[a].append(b)
        adj[b].append(a)
    same_h = (id_lab[:, 1:] == id_lab[:, :-1]) & (id_lab[:, 1:] > 0) & (part_lab[:, 1:] != part_lab[:, :-1])
    for y, x in zip(*np.nonzero(same_h)):
        a, b = (int(x) + 1, int(y)), (int(x) + 1, int(y) + 1)
        adj[a].append(b)
        adj[b].append(a)
    seen = set()
    lines = []
    for v0 in sorted(adj):
        if len(adj[v0]) == 2 or v0 in seen:
            continue
        for n0 in adj[v0]:
            if (v0, n0) in seen:
                continue
            line = [v0, n0]
            seen.add((v0, n0)); seen.add((n0, v0))
            cur, prev = n0, v0
            while len(adj[cur]) == 2:
                n = adj[cur][0] if adj[cur][0] != prev else adj[cur][1]
                if (cur, n) in seen:
                    break
                seen.add((cur, n)); seen.add((n, cur))
                line.append(n)
                prev, cur = cur, n
            pts = np.array(line, float) * scale
            if np.hypot(*np.diff(pts, axis=0).T).sum() < LINE_MIN:
                continue
            s = dp(pts, DP_TOL)
            lines.append("M" + " ".join(f"{fmt(x)} {fmt(y)}" for x, y in s))
    return lines


def box_blur(a, r):
    """Separable box blur (applied 3 times ~ Gaussian) on a 2-D array."""
    for _ in range(3):
        for axis in (0, 1):
            c = np.cumsum(np.pad(a, [(r + 1, r) if i == axis else (0, 0) for i in range(2)], mode="edge"), axis=axis)
            a = (np.take(c, range(2 * r + 1, c.shape[axis]), axis=axis) - np.take(c, range(0, c.shape[axis] - 2 * r - 1), axis=axis)) / (2 * r + 1)
    return a


def open_mask(m, r=1):
    """Morphological opening (removes specks and one-pixel bridges)."""
    er = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            er &= np.roll(np.roll(m, dy, 0), dx, 1)
    return dilate(er, r)


def dilate(m, r=1):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def tone_curve(g, ref):
    """Histogram-anchored tone curve set on the muscle pixels: their 1/25/50/75/99th percentiles go to
    TONE_POINTS (more local contrast, mid grey muscle); lighter bone and skin land above the muscle."""
    qs = np.percentile(g[ref], [1, 25, 50, 75, 99])
    xs = [0.0, *qs, max(float(g.max()), qs[-1] + 1e-3)]
    return np.interp(g, xs, TONE_POINTS)


frame = pal["frame"]
views = {}
for view in ("front", "back"):
    idimg = load_rgba(RENDERS / f"id_{view}.png")
    partimg = load_rgba(RENDERS / f"part_{view}.png")
    kindimg = load_rgba(RENDERS / f"kind_{view}.png")
    shaded = np.asarray(Image.open(RENDERS / f"shaded_{view}.png").convert("RGBA"), dtype=np.float32) / 255
    skinfull = np.asarray(Image.open(RENDERS / f"skinfull_{view}.png").convert("RGBA"), dtype=np.float32) / 255
    H, W = idimg.shape[:2]
    scale = VB_H / H
    id_lab, id_keys = decode(idimg, pal["id"])
    part_lab, _ = decode(partimg, pal["part"])
    kind_lab, kind_keys = decode(kindimg, pal["kind"])
    kind_of = {pal["kind"][k]: i + 1 for i, k in enumerate(kind_keys)}
    is_bone = kind_lab == kind_of["bone"]
    is_skin = kind_lab == kind_of["skin"]
    # Thin structures (tendon wisps) never become a tappable region.
    thick = dilate(open_mask(id_lab > 0, THIN_R), 1)
    id_lab = np.where(thick, id_lab, 0)
    part_lab = np.where(thick, part_lab, 0)
    alpha = shaded[..., 3]
    body_alpha = alpha > 0.5

    shapes = []
    by_key = defaultdict(lambda: np.zeros((H, W), bool))
    for i, k in enumerate(id_keys):
        info = pal["id"][k]
        by_key[(info["muscle"], info["side"])] |= id_lab == i + 1

    rows = np.nonzero(body_alpha.any(1))[0]
    top, bottom = rows.min(), rows.max()
    h = bottom - top
    yy, xx = np.mgrid[0:H, 0:W]
    cols = np.nonzero(body_alpha.any(0))[0]
    cx = (cols.min() + cols.max()) / 2
    serratus = np.zeros((H, W), bool)
    for i, k in enumerate(id_keys):
        if pal["id"][k]["muscle"] == "abdominals":
            serratus |= id_lab == i + 1
    synth = np.zeros((H, W), bool)
    spine = is_bone & (np.abs(xx - cx) < SPINE_HALF * h)
    if view == "back":
        # Latissimus dorsi (absent from BodyParts3D): inside a proportional trunk box, every pixel that shows
        # a rib, a deep (neutral) muscle or the serratus anterior becomes 'lats'. The spine stays visible.
        t, b = BOX["back"]
        # The trunk: per row, the run of body pixels that contains the centre column (arms are separate).
        trunk = np.zeros((H, W), bool)
        icx = int(round(cx))
        for y in range(int(top + t * h), int(top + b * h)):
            row = body_alpha[y]
            if not row[icx]:
                continue
            l = icx - int(np.argmin(row[icx::-1])) + 1 if not row[:icx + 1].all() else 0
            r = icx + int(np.argmin(row[icx:])) if not row[icx:].all() else W
            trunk[y, l:r] = True
        synth = open_mask(trunk & ((id_lab == 0) | serratus) & ~spine & ~is_skin, 2)
        # Close the pinholes left by tiny structures inside it.
        synth = ~dilate(~dilate(synth, 4), 4) & trunk & ~spine & ~is_skin
        for k in [k for k in by_key if k[0] == "abdominals"]:
            by_key[k] &= ~synth
        for side, sel in (("left", xx >= cx), ("right", xx < cx)):
            # Back view: image right is the person's right.
            by_key[("lats", "right" if side == "left" else "left")] |= synth & sel

    if view == "back" and (RENDERS / "deep_back.png").exists():
        # Middle back: the rhomboids lie under the middle trapezius and barely show in the visible id map.
        # Their footprint (rendered alone) becomes the 'middle back' region, cut out of traps/lats: that zone
        # of the base shows the middle trapezius over the rhomboids, the muscles a row trains together.
        deep_lab, deep_keys = decode(load_rgba(RENDERS / "deep_back.png"), pal["id"])
        free = body_alpha & ~is_skin & ~spine
        for i, k in enumerate(deep_keys):
            info = pal["id"][k]
            if info["muscle"] != "middle back":
                continue
            m = open_mask((deep_lab == i + 1) & free, 2)
            for key in by_key:
                if key[0] in ("traps", "lats", "abdominals"):
                    by_key[key] &= ~m
            by_key[("middle back", info["side"])] |= m

    for (muscle, side), m in sorted(by_key.items()):
        d = mask_path(m, scale)
        if d:
            shapes.append({"muscleId": muscle, "side": None if side == "mid" else side, "d": d})
    lines = hairlines(id_lab, part_lab, scale) if HAIRLINES else []
    sil = mask_path(dilate(body_alpha, 1), scale, tol=DP_TOL, min_area=200)

    # Shaded base (greyscale + alpha). Synthesised lats: the body surface's shading, darkened to muscle tone.
    g = shaded[..., :3].mean(-1)
    is_muscle = (id_lab > 0) & body_alpha
    if synth.any():
        # Body-surface shading, matched to the mean tone of the real muscle around it, with a soft groove
        # along its border so it reads as one more muscle.
        sk = skinfull[..., :3].mean(-1)
        ring = dilate(synth, 12) & ~synth & is_muscle
        sk = sk * (g[ring].mean() / max(sk[synth].mean(), 1e-3))
        edge = dilate(synth, 2) & ~open_mask(synth, 3)
        groove = np.clip(box_blur(edge.astype(np.float32), 2), 0, 1)
        soft_synth = np.clip(box_blur(synth.astype(np.float32), 1), 0, 1)
        g = g * (1 - soft_synth) + sk * soft_synth
        g = g * (1 - GROOVE * groove)
    # Head: soften the face into a plain volume (eyes, lips and nostrils are distracting at this size).
    chin_y = int(round(((frame["min_z_mm"] + frame["max_z_mm"]) / 2 + frame["ortho_mm"] / 2 - frame["chin_z_mm"]) / frame["ortho_mm"] * H))
    head = is_skin & (yy < chin_y + 0.01 * h)
    if view == "front":
        r = max(2, int(FACE_BLUR * h))
        a = (alpha > 0.5).astype(np.float32)
        soft = box_blur(g * a, r) / np.maximum(box_blur(a, r), 1e-3)
        hm = np.clip(box_blur(head.astype(np.float32), 3), 0, 1)
        g = g * (1 - hm) + soft * hm
    g = tone_curve(g, is_muscle & (alpha > 0.99))
    # Soften the skin cut lines (neck, wrists, ankles): a short blend across the skin / non-skin border.
    body = alpha > 0.5
    seam = dilate(is_skin, CUT_BLEND) & dilate(~is_skin & body, CUT_BLEND) & body
    if seam.any():
        a = body.astype(np.float32)
        soft = box_blur(g * a, CUT_BLEND) / np.maximum(box_blur(a, CUT_BLEND), 1e-3)
        w = np.clip(box_blur(seam.astype(np.float32), 2), 0, 1)
        g = g * (1 - w) + soft * w
    out = np.dstack([g, g, g, alpha])
    img = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "RGBA")
    bw = int(round(W * BASE_H / H))
    img = img.resize((bw, BASE_H), Image.LANCZOS)
    pub = REPO / "public" / "muscle-figure"
    pub.mkdir(parents=True, exist_ok=True)
    png = RENDERS / f"base_{view}.png"
    img.save(png)
    webp = pub / f"{view}.webp"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(png), "-c:v", "libwebp", "-lossless", "0", "-q:v", str(WEBP_Q),
                    "-compression_level", "6", "-pix_fmt", "yuva420p", str(webp)], check=True)
    views[view] = {
        "viewBox": {"x": 0, "y": 0, "w": round(W * scale, 1), "h": VB_H},
        "silhouette": [sil] if sil else [],
        "shapes": shapes,
        "lines": lines,
        "base": {"href": f"muscle-figure/{view}.webp", "width": bw, "height": BASE_H},
    }
    print(view, len(shapes), "shapes", len(lines), "lines", f"base {bw}x{BASE_H}", webp.stat().st_size, "bytes webp")

HEADER = """/**
 * GENERATED by scripts/muscle-figure (build_mapping.py -> render.py in Blender -> trace.py). Do not edit.
 *
 * Source: BodyParts3D 4.0 (isa tree, 99 % polygon reduction), Database Center for Life Science.
 * Licence: CC BY 4.0. Attribution: "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International".
 * Modified: selection of muscle, bone and connective-tissue elements and of the body surface (cropped to
 * head, hands and feet), orthographic rendering in Blender, vector tracing of the rendered id maps; the
 * latissimus dorsi region is synthesised from the body surface because the dataset has no mesh for it
 * (docs/V3_MUSCLE_RECOVERY.md).
 *
 * Regenerate: see scripts/muscle-figure/README.md
 */
import type { FigureData } from './muscleFigure.types'

"""


def ts_view(v):
    shapes = ",\n".join(
        "    { muscleId: %s%s, d: %s }" % (json.dumps(s["muscleId"]), f", side: {json.dumps(s['side'])}" if s["side"] else "", json.dumps(s["d"]))
        for s in v["shapes"])
    lines = ",\n".join("    " + json.dumps(l) for l in v["lines"])
    sil = ", ".join(json.dumps(s) for s in v["silhouette"])
    b = v["base"]
    return (f"{{\n  viewBox: {json.dumps(v['viewBox'])},\n  silhouette: [{sil}],\n  base: {{ href: {json.dumps(b['href'])}, width: {b['width']}, height: {b['height']} }},\n"
            f"  shapes: [\n{shapes},\n  ],\n" + (f"  lines: [\n{lines},\n  ],\n" if lines else "") + "}")


ts = HEADER + "export const FRONT: FigureData = " + ts_view(views["front"]) + "\n\nexport const BACK: FigureData = " + ts_view(views["back"]) + "\n"
dst = REPO / "src" / "features" / "training" / "muscleFigure.data.ts"
dst.write_text(ts, encoding="utf-8")
print("wrote", dst, len(ts.encode()), "bytes")
