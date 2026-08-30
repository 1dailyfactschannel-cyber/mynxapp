# Generates Chrome Web Store promo images for the Mynx extension.
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
ICON = os.path.join(ROOT, "..", "icons", "icon128.png")
OUT = ROOT

BG = (10, 10, 15)          # #0a0a0f
EMERALD_D = (5, 150, 105)  # #059669
EMERALD_L = (16, 185, 129) # #10b981
WHITE = (240, 245, 244)
MUTED = (148, 163, 184)    # #94a3b8

FONT_DIR = "C:/Windows/Fonts"

def font(size, bold=True):
    name = "segoeuib.ttf" if bold else "segoeui.ttf"
    path = os.path.join(FONT_DIR, name)
    if not os.path.exists(path):
        path = os.path.join(FONT_DIR, "arialbd.ttf" if bold else "arial.ttf")
    return ImageFont.truetype(path, size)

def gradient_band(draw, w, h, y0, y1):
    # horizontal emerald gradient band
    for x in range(w):
        t = x / max(w - 1, 1)
        c = tuple(int(EMERALD_D[i] + (EMERALD_L[i] - EMERALD_D[i]) * t) for i in range(3))
        draw.line([(x, y0), (x, y1)], fill=c)

def make(width, height, icon_h, title_size, sub_size, out_name):
    img = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(img)

    # subtle gradient band at the bottom
    band_h = max(6, height // 40)
    gradient_band(draw, width, height, height - band_h, height)

    icon = Image.open(ICON).convert("RGBA")
    icon = icon.resize((icon_h, icon_h), Image.LANCZOS)

    title = "Mynx"
    sub = "Offline password manager"
    f_title = font(title_size)
    f_sub = font(sub_size, bold=False)

    tw = draw.textlength(title, font=f_title)
    sw = draw.textlength(sub, font=f_sub)
    gap = icon_h // 8
    total_h = icon_h + gap + title_size + sub_size // 2 + sub_size
    y = (height - total_h) // 2

    ix = (width - icon_h) // 2
    img.paste(icon, (ix, y), icon)
    y += icon_h + gap

    draw.text(((width - tw) / 2, y), title, font=f_title, fill=EMERALD_L)
    y += title_size + sub_size // 2
    draw.text(((width - sw) / 2, y), sub, font=f_sub, fill=MUTED)

    img.save(os.path.join(OUT, out_name))
    print("saved", out_name, img.size)

make(440, 280, icon_h=96, title_size=44, sub_size=20, out_name="promo-tile-440x280.png")
make(1400, 560, icon_h=220, title_size=110, sub_size=48, out_name="marquee-1400x560.png")
