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

def best_local_contrast(w, h, bpp, buf, y_lo=430, y_hi=880):
    """Blocks whose core beats a ring around them, best WCAG contrast first.

    A figure is found by being locally brighter than what is behind it, so this
    needs no coordinates from the caller and cannot inherit a bad estimate.
    """
    def lum(x, y):
        i = (y * w + x) * bpp
        return rel_lum((buf[i], buf[i + 1], buf[i + 2]))
    hits = []
    for y0 in range(y_lo, min(h - 40, y_hi - 40), 20):
        for x0 in range(0, w - 40, 20):
            core = [lum(x, y) for y in range(y0 + 10, y0 + 30, 4)
                                for x in range(x0 + 10, x0 + 30, 4)]
            cm = sum(core) / len(core)
            ring = [lum(x, y) for y in range(max(0, y0 - 14), min(h, y0 + 44), 6)
                                  for x in range(max(0, x0 - 14), min(w, x0 + 54), 6)
                                  if not (y0 + 8 < y < y0 + 32 and x0 + 8 < x < x0 + 32)]
            if len(ring) < 20:
                continue
            rm = sum(ring) / len(ring)
            hits.append(((cm + 0.05) / (rm + 0.05), cm, rm, x0, y0))
    hits.sort(reverse=True)
    return hits


if __name__ == '__main__':
    for path in sys.argv[1:]:
        w, h, bpp, buf = load(path)
        hits = best_local_contrast(w, h, bpp, buf)
        print(f'{path}: {w}x{h}')
        if not hits:
            print('   no locally-brighter blocks found in the lower half')
            continue
        for r, cm, rm, x, y in hits[:6]:
            print(f'   block ({x:4d},{y:4d})  core lum {cm:.5f}  surround {rm:.5f}  contrast {r:.2f}:1')
        print(f'   best {hits[0][0]:.2f}:1   (threshold 2.5:1)')
