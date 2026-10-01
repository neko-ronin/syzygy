"""
Figure/ground contrast in a street frame, measured in linear light from pixels.

    python3 tools/figure_contrast.py <frame.png>

Why this exists. `docs/LEGIBILITY_TARGETS.md` sets >= 2.5:1 between a figure's
body and the ground behind it. Measuring that needs two things an eyeballed
coordinate does not give you: the *linear* value, because the frame is sRGB
after a filmic tonemap; and the right pair of regions, because a figure is
identified by being locally brighter than its surround, not by where someone
guessed it was.

So it finds figures instead of being told where they are: it scans the lower
half in blocks, keeps the ones whose core mean luminance beats a ring around
them, and reports the WCAG contrast of the best. No hand-placed boxes, and no
result that depends on an estimate.

Known limitation, and it is the reason the round-7 emissive floor could not be
evaluated: if the street has no figures in it, this reports the brightest lit
building edge instead and says so. Read the coordinates before believing a
number from a frame with nobody in it.
"""
import struct, sys, zlib, pathlib

def load(path):
    raw = pathlib.Path(path).read_bytes()
    pos, idat = 8, b''
    w = h = bd = ct = None
    while pos < len(raw):
        ln = struct.unpack('>I', raw[pos:pos + 4])[0]
        typ = raw[pos + 4:pos + 8]
        data = raw[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, bd, ct = struct.unpack('>IIBB', data[:10])
        elif typ == b'IDAT':
            idat += data
        pos += 12 + ln
    bpp = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    buf = zlib.decompress(idat)
    stride = w * bpp
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ft = buf[p]; p += 1
        line = bytearray(buf[p:p + stride]); p += stride
        if ft == 1:
            for i in range(bpp, stride): line[i] = (line[i] + line[i - bpp]) & 255
        elif ft == 2:
            for i in range(stride): line[i] = (line[i] + prev[i]) & 255
        elif ft == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif ft == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                c = prev[i - bpp] if i >= bpp else 0
                b = prev[i]
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, bpp, out

def srgb_to_lin(v):
    v = v / 255.0
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

def rel_lum(px):
    r, g, b = (srgb_to_lin(c) for c in px)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def ratio(a, b):
    la, lb = rel_lum(a), rel_lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

def patch(w, bpp, buf, x0, y0, x1, y1):
    """Mean linear rgb over a rect, and the peak-to-mean spread inside it."""
    acc = [0.0, 0.0, 0.0]; n = 0; lums = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            i = (y * w + x) * bpp
            px = (buf[i], buf[i + 1], buf[i + 2])
            acc[0] += srgb_to_lin(px[0]); acc[1] += srgb_to_lin(px[1]); acc[2] += srgb_to_lin(px[2])
            lums.append(rel_lum(px)); n += 1
    mean = tuple(v / n for v in acc)
    return mean, max(lums) - min(lums), len(lums)

if __name__ == '__main__':
    path = sys.argv[1]
    w, h, bpp, buf = load(path)
    print(f'{path}: {w}x{h} bpp={bpp}')
    # (figure box, adjacent ground box) pairs, read off the frame by eye.
    spots = [
        ('green figure + ground', (530, 590, 580, 660), (600, 620, 700, 680)),
        ('red figure + ground',   (975, 600, 1065, 700), (1090, 640, 1180, 700)),
        ('pale figure + ground',  (1285, 610, 1395, 700), (1420, 650, 1500, 700)),
        ('empty deck, left',      (200, 520, 320, 600), (200, 620, 320, 700)),
    ]
    for name, f, g in spots:
        fm, fspread, fn = patch(w, bpp, buf, *f)
        gm, gspread, gn = patch(w, bpp, buf, *g)
        print(f'  {name:24} figure mean lum {rel_lum(fm):.5f}  ground {rel_lum(gm):.5f}  '
              f'contrast {ratio(fm, gm):.2f}:1  (within-patch lum spread f {fspread:.5f} g {gspread:.5f})')