"""
Pixel shares of a capture: the numbers a before/after review can reproduce.

    python3 tools/pixel_share.py <png> [<png> ...] [--rect=x,y,w,h]

  foliage      green-dominant pixels: G > 1.08 R, G > 1.15 B, G > 25. The sheet D
               coverage probe; for pose 13's terraced facade use --rect=500,90,590,780
               (2026-10-13: 7.5% at 69e675d, where review 5 read 9.4% by eye).
  near-black   max channel < 16/255 (pose 15's dark street).
  warm-bright  R > 120 and R > 1.6 B: fire and lamp light.

Shares are of the rectangle (default: the whole frame). Stdlib only, reusing the PNG
reader in figure_contrast.py. A number for a judged-by-eye quality is evidence for a
reviewer, not a target to tune toward (PROCESS rule 1).
"""
import sys

from figure_contrast import load


def shares(path, rect):
    w, h, bpp, buf = load(path)
    x0, y0, rw, rh = rect or (0, 0, w, h)
    green = black = warm = 0
    for y in range(y0, y0 + rh):
        row = y * w * bpp
        for x in range(x0, x0 + rw):
            i = row + x * bpp
            r, g, b = buf[i], buf[i + 1], buf[i + 2]
            if g > r * 1.08 and g > b * 1.15 and g > 25:
                green += 1
            if max(r, g, b) < 16:
                black += 1
            if r > 120 and r > b * 1.6:
                warm += 1
    n = rw * rh
    return green / n, black / n, warm / n


def main(argv):
    rect = None
    paths = []
    for a in argv:
        if a.startswith('--rect='):
            rect = tuple(int(v) for v in a[7:].split(','))
        else:
            paths.append(a)
    if not paths:
        print(__doc__)
        return 1
    for p in paths:
        g, k, wm = shares(p, rect)
        print(f'{p}  foliage {g * 100:5.1f}%  near-black {k * 100:5.1f}%  warm-bright {wm * 100:5.1f}%')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
