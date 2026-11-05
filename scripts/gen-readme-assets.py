#!/usr/bin/env python3
"""Generate README image assets for dsh-checkpoint-rewind (docs/assets/).

Outputs (idempotent overwrite):
  dsh-checkpoint-rewind-flow-light.svg / dsh-checkpoint-rewind-flow-dark.svg
      Hero flow diagram. Two hand-written SVG files (vector — never
      rasterized to webp). Text inside is command-surface tokens only
      (fs/write-intent, /rewind, SessionStore.fork, ...), so all five
      README languages share the same pair.

No evidence chart is generated: this repository has no benchmark/measured
data set in-tree (the old docs/assets/*-evidence.png chart counted README
comparison-table cells, not measurements). The previous single-version
flow.svg / hero.png / demo.gif stay in place so existing external links
never 404; the READMEs reference only the new pair.

Run once:  python scripts/gen-readme-assets.py
Requires:  Pillow (pip install pillow)
"""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw, ImageFont  # noqa: F401  (Pillow is the documented toolchain)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

# --- palette: PerryLink family (accent) + GitHub page backgrounds ----------
FAMILY = "#4B67B4"   # family accent (badges labelColor family uses #2B3245)
GREEN = {"light": "#16a34a", "dark": "#3fb950"}
SKIN = {
    "light": dict(bg="#ffffff", box="#f6f8fa", border="#d0d7de",
                  text="#1f2328", sub="#57606a", track="#eaeef2"),
    "dark": dict(bg="#0d1117", box="#161b22", border="#30363d",
                 text="#f0f6fc", sub="#8b949e", track="#21262d"),
}

# --- CJK font probe: Chinese must never render as tofu boxes ----------------
# The SVG below uses command tokens only (ASCII), but the family template
# requires a loud font probe so a future localized variant cannot silently
# render tofu; abort if no CJK font is installed.
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",      # Microsoft YaHei
    r"C:\Windows\Fonts\simhei.ttf",    # SimHei
    r"C:\Windows\Fonts\Deng.ttf",      # DengXian
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]
FONT_PATH = next((p for p in FONT_CANDIDATES if os.path.exists(p)), None)
if FONT_PATH is None:
    sys.exit("FATAL: no CJK font found (looked for msyh.ttc, simhei.ttf, "
             "Deng.ttf, Noto Sans CJK, PingFang). Refusing to render Chinese "
             "as tofu boxes; install one of the probed fonts and re-run.")

WEBP_QUALITY = 90  # shared with the family image pipeline (evidence charts)


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_PATH, size)


# ---------------------------------------------------------------------------
# Hero flow SVG (light + dark): capture lane on top, rewind lane below.
# Labels are command/event/config tokens only — no natural-language sentences.
# ---------------------------------------------------------------------------
def box(x: int, y: int, w: int, h: int, label: str, sub: str,
        s: dict, accent: str) -> list[str]:
    parts = [
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" '
        f'fill="{s["box"]}" stroke="{accent}" stroke-width="2"/>',
        f'<text x="{x + w // 2}" y="{y + 27}" fill="{s["text"]}" '
        f'text-anchor="middle" font-family="ui-monospace,monospace" '
        f'font-size="15" font-weight="700">{label}</text>',
    ]
    if sub:
        parts.append(
            f'<text x="{x + w // 2}" y="{y + 47}" fill="{s["sub"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="12">{sub}</text>')
    return parts


def arrow(x1: int, y1: int, x2: int, y2: int, s: dict, accent: str) -> list[str]:
    return [
        f'<path d="M{x1} {y1}L{x2} {y2}" stroke="{accent}" stroke-width="2" '
        f'stroke-linecap="round"/>',
        f'<path d="M{x2 - 9} {y2 - 5}l9 5-9 5" fill="none" stroke="{accent}" '
        f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    ]


def flow_svg(skin: str) -> str:
    s = SKIN[skin]
    w, h = 1200, 660
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" role="img" '
        f'aria-label="dsh-checkpoint-rewind three-state checkpoint flow">',
        '<title>dsh-checkpoint-rewind three-state checkpoint flow</title>',
        f'<rect width="{w}" height="{h}" rx="18" fill="{s["bg"]}"/>',
        f'<text x="60" y="58" fill="{s["text"]}" '
        f'font-family="ui-sans-serif,system-ui,sans-serif" font-size="30" '
        f'font-weight="700">dsh-checkpoint-rewind</text>',
        f'<text x="60" y="88" fill="{s["sub"]}" '
        f'font-family="ui-monospace,monospace" font-size="15">'
        f'/checkpoint · /rewind · session + workspace + config</text>',
        f'<line x1="60" y1="108" x2="1140" y2="108" stroke="{s["border"]}"/>',
        f'<text x="60" y="136" fill="{FAMILY}" '
        f'font-family="ui-monospace,monospace" font-size="13" '
        f'font-weight="700">capture</text>',
    ]

    # Capture triggers, stacked left.
    triggers = [
        ("fs/write-intent", ""),
        ("fs/edit-intent", ""),
        ("tools/pre-execute", "prepend · next()"),
        ("step/start · /checkpoint", "autoCheckpoint"),
    ]
    ys = [152, 214, 276, 338]
    for (label, sub), y in zip(triggers, ys):
        accent = FAMILY if sub else s["border"]
        parts += box(60, y, 250, 54, label, sub, s, accent)
        # Each trigger feeds the provider registry bus.
        parts.append(
            f'<path d="M310 {y + 27}H340" stroke="{s["sub"]}" stroke-width="2"/>')
    parts.append(
        f'<path d="M340 179V365" stroke="{s["sub"]}" stroke-width="2"/>')
    parts += arrow(340, 268, 372, 268, s, FAMILY)

    parts += box(372, 210, 210, 116, "ProviderRegistry", "resolve(auto)", s, FAMILY)
    parts += arrow(582, 268, 614, 268, s, FAMILY)
    parts += box(614, 210, 206, 116, "git / copy", "stash create · commit-tree", s, FAMILY)
    parts += arrow(820, 268, 852, 268, s, FAMILY)
    parts += box(852, 210, 288, 116, "checkpoints", "domain · global slot", s, FAMILY)
    parts.append(
        f'<text x="996" y="352" fill="{s["sub"]}" text-anchor="middle" '
        f'font-family="ui-monospace,monospace" font-size="12">'
        f'checkpoint/snapshot · bound · prune · rewind</text>')

    # Rewind lane.
    parts.append(
        f'<line x1="60" y1="418" x2="1140" y2="418" stroke="{s["border"]}"/>')
    parts.append(
        f'<text x="60" y="446" fill="{GREEN[skin]}" '
        f'font-family="ui-monospace,monospace" font-size="13" '
        f'font-weight="700">rewind</text>')

    parts += box(60, 474, 200, 62, "/rewind &lt;target&gt;", "workspace|session|config", s, FAMILY)
    parts += arrow(260, 505, 300, 505, s, FAMILY)
    parts += box(300, 474, 180, 62, "confirm", "userQuestions · approval", s, FAMILY)
    parts += arrow(480, 505, 520, 505, s, FAMILY)
    parts += box(520, 474, 170, 62, "guard", "preRewindCheckpoint", s, GREEN[skin])

    targets = [
        ("workspace", "restore · reset-hard", 452),
        ("config", "settings write-back", 514),
        ("session", "SessionStore.fork", 576),
    ]
    for label, sub, y in targets:
        parts += box(800, y, 250, 52, label, sub, s, s["border"])
        parts += arrow(690, 505, 792, y + 26, s, s["sub"])
    parts.append(
        f'<text x="800" y="650" fill="{s["sub"]}" '
        f'font-family="ui-monospace,monospace" font-size="12">'
        f'command/run · command/done · /rewind preview</text>')

    parts.append('</svg>')
    return "\n".join(parts) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin in ("light", "dark"):
        with open(os.path.join(OUT, f"dsh-checkpoint-rewind-flow-{skin}.svg"),
                  "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
    print("wrote 2 SVG flow assets to docs/assets/")


if __name__ == "__main__":
    main()
