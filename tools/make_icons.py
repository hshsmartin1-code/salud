"""Render the PWA PNG icons (no external assets). Run: python -I -X utf8 tools/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
BG = (15, 21, 19, 255)
FG = (61, 220, 151, 255)
# Pulse path in a 64x64 design grid (same as favicon.svg)
PTS = [(12, 35), (21, 35), (25.5, 25), (32.5, 44), (38.5, 30), (42, 35), (52, 35)]


def render(size: int, maskable: bool, radius_ratio: float) -> Image.Image:
    ss = 4  # supersample
    S = size * ss
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, S, S], fill=BG)
        scale, off = S * 0.72 / 64, S * 0.14  # glyph inside the 80% safe zone
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius_ratio), fill=BG)
        scale, off = S / 64, 0
    pts = [(off + x * scale, off + y * scale) for x, y in PTS]
    w = max(2, int(5 * scale))
    d.line(pts, fill=FG, width=w, joint="curve")
    r = w / 2
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - r, y - r, x + r, y + r], fill=FG)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    render(192, False, 0.23).save(OUT / "icon-192.png")
    render(512, False, 0.23).save(OUT / "icon-512.png")
    render(512, True, 0).save(OUT / "icon-maskable-512.png")
    render(180, True, 0).save(OUT / "apple-touch-icon.png")
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
