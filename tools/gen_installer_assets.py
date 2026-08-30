# -*- coding: utf-8 -*-
"""One-off: generate NSIS installer branding assets for Mynx.

Outputs (into src-tauri/icons/):
  installer.ico        — app icon with install badge (multi-size)
  nsis-sidebar.bmp     — 164x314 brand panel (welcome/finish pages)
  nsis-header.bmp      — 150x57 header strip image
Previews (PNG) are written next to this script for visual check.
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.abspath(__file__))
ICONS = os.path.join(ROOT, "..", "src-tauri", "icons")

FONT_BOLD = "C:/Windows/Fonts/segoeuib.ttf"
FONT_REG = "C:/Windows/Fonts/segoeui.ttf"

# Brand palette (from assets/icon.svg)
SLATE = (15, 23, 42)       # #0f172a
EMERALD_DEEP = (6, 78, 59)  # #064e3b
EMERALD = (16, 185, 129)    # #10b981
EMERALD_DARK = (5, 150, 105)  # #059669
TEXT_MUTED = (148, 163, 184)  # #94a3b8


def vgradient(size, top, bottom):
    w, h = size
    img = Image.new("RGB", size)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(h - 1, 1)
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=c)
    return img


def soft_glow(size, center, radius, color, alpha):
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    cx, cy = center
    d.ellipse([cx - radius, cy - radius, cx + radius, cy + radius],
              fill=color + (alpha,))
    return glow.filter(ImageFilter.GaussianBlur(radius * 0.55))


def load_icon():
    return Image.open(os.path.join(ICONS, "icon.png")).convert("RGBA")


# ---------------------------------------------------------------- installer.ico
def make_installer_ico():
    base = load_icon().resize((256, 256), Image.LANCZOS)

    # Install badge: emerald circle, white ring, white down-arrow
    badge_d = 112
    bx, by = 256 - badge_d - 6, 256 - badge_d - 6
    badge = Image.new("RGBA", (badge_d, badge_d), (0, 0, 0, 0))
    bd = ImageDraw.Draw(badge)
    bd.ellipse([0, 0, badge_d - 1, badge_d - 1], fill=EMERALD_DARK + (255,),
               outline=(255, 255, 255, 255), width=6)
    # Arrow: shaft + head
    cx = badge_d // 2
    shaft_w = 16
    bd.rectangle([cx - shaft_w // 2, 26, cx + shaft_w // 2, 62], fill=(255, 255, 255, 255))
    bd.polygon([(cx - 26, 58), (cx + 26, 58), (cx, 90)], fill=(255, 255, 255, 255))
    base.alpha_composite(badge, (bx, by))

    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base.save(os.path.join(ICONS, "installer.ico"), format="ICO", sizes=sizes)
    base.save(os.path.join(ROOT, "preview_installer.png"))


# ---------------------------------------------------------------- sidebar 164x314
def make_sidebar():
    W, H = 164, 314
    img = vgradient((W, H), SLATE, EMERALD_DEEP).convert("RGBA")

    # Soft emerald glow bottom-left + faint top light
    img.alpha_composite(soft_glow((W, H), (30, 280), 90, EMERALD, 60))
    img.alpha_composite(soft_glow((W, H), (150, 20), 80, (226, 232, 240), 28))

    # Faint inset ring (glass-panel feel, как в иконке)
    ring = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    rd.rounded_rectangle([6, 6, W - 7, H - 7], radius=14,
                         outline=(255, 255, 255, 26), width=2)
    img.alpha_composite(ring)

    d = ImageDraw.Draw(img)

    # App icon
    icon = load_icon().resize((86, 86), Image.LANCZOS)
    img.alpha_composite(icon, ((W - 86) // 2, 58))

    # Wordmark
    f_name = ImageFont.truetype(FONT_BOLD, 30)
    name = "Mynx"
    tw = d.textlength(name, font=f_name)
    d.text(((W - tw) / 2, 152), name, font=f_name, fill=(255, 255, 255, 255))

    # Tagline
    f_tag = ImageFont.truetype(FONT_REG, 10)
    tag = "Offline password manager"
    tw = d.textlength(tag, font=f_tag)
    d.text(((W - tw) / 2, 190), tag, font=f_tag, fill=TEXT_MUTED + (255,))

    # Bottom version
    f_ver = ImageFont.truetype(FONT_REG, 9)
    ver = "v1.0.0"
    tw = d.textlength(ver, font=f_ver)
    d.text(((W - tw) / 2, H - 24), ver, font=f_ver, fill=(100, 116, 139, 255))

    img.convert("RGB").save(os.path.join(ICONS, "nsis-sidebar.bmp"), format="BMP")
    img.save(os.path.join(ROOT, "preview_sidebar.png"))


# ---------------------------------------------------------------- header 150x57
def make_header():
    W, H = 150, 57
    img = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    d = ImageDraw.Draw(img)

    icon = load_icon().resize((36, 36), Image.LANCZOS)
    img.alpha_composite(icon, (14, (H - 36) // 2))

    f_name = ImageFont.truetype(FONT_BOLD, 22)
    d.text((58, 8), "Mynx", font=f_name, fill=SLATE + (255,))

    f_tag = ImageFont.truetype(FONT_REG, 8)
    d.text((59, 33), "Offline password manager", font=f_tag,
           fill=(100, 116, 139, 255))

    img.convert("RGB").save(os.path.join(ICONS, "nsis-header.bmp"), format="BMP")
    img.save(os.path.join(ROOT, "preview_header.png"))


if __name__ == "__main__":
    make_installer_ico()
    make_sidebar()
    make_header()
    print("assets written to", os.path.abspath(ICONS))
