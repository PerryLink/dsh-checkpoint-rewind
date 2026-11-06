#!/usr/bin/env python3
"""Generate the README art for dsh-checkpoint-rewind.

Outputs (idempotent overwrite):
  docs/assets/dsh-checkpoint-rewind-hero-{zh,en}-{light,dark}.webp
      1440x576 hero banner: left copy column, right a faithful mock of the
      shipped Settings -> Plugins -> Checkpoints panel (real client strings:
      timeline rows, pairwise diff sections, copy-/rewind action).
  docs/assets/dsh-checkpoint-rewind-flow-v5-{light,dark}.svg
      1100x660 hand-written SVG: the real pipeline as a dual-channel
      confluence (git | copy snapshots) into one `checkpoints` record, then a
      confirmed -> guarded three-step restore ladder and the session fork.
      Vector on purpose: the labels are command/config tokens only, so all
      five README languages share the same light/dark pair.

Run:  python scripts/gen-readme-assets.py
Needs: Pillow (+ numpy), and the Windows fonts below (msyh / msyhbd / consola).
"""
from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

SANS = r"C:\Windows\Fonts\msyh.ttc"        # Microsoft YaHei
SANS_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"  # Microsoft YaHei Bold
MONO = r"C:\Windows\Fonts\consola.ttf"     # Consolas
MONO_BOLD = r"C:\Windows\Fonts\consolab.ttf"

for _path in (SANS, SANS_BOLD, MONO, MONO_BOLD):
    if not os.path.exists(_path):
        raise SystemExit(f"FATAL: missing font {_path}")

WEBP_QUALITY = 92

# ---------------------------------------------------------------------------
# Hero: palette, copy, and the (real) Settings-panel mock.
# ---------------------------------------------------------------------------
HERO_W, HERO_H = 1440, 576

P = {
    "light": dict(
        bg0=(249, 246, 253), bg1=(228, 234, 248),
        glow=(75, 103, 180),
        title=(26, 33, 54), value=(43, 51, 80), sub=(77, 86, 115),
        meta=(107, 117, 144), footer=(107, 117, 144),
        family=(75, 103, 180),
        panel=(252, 252, 255, 255), panel_line=(212, 218, 235, 255),
        shadow=(43, 50, 69, 46),
        row=(252, 253, 255, 255), row_line=(222, 228, 242, 255),
        row_sel=(239, 243, 255, 255), row_sel_line=(75, 103, 180, 255),
        inner=(245, 248, 255, 255), inner_line=(224, 229, 243, 255),
        chip=(239, 242, 250, 255), chip_line=(214, 221, 237, 255),
        accent_pill=(232, 236, 247, 255), accent_pill_line=(198, 207, 229, 255),
        green=(23, 132, 92), green_badge=(229, 243, 236, 255),
        divider=(204, 211, 231, 255),
        label=(107, 117, 144),
    ),
    "dark": dict(
        bg0=(19, 26, 42), bg1=(12, 16, 22),
        glow=(132, 150, 245),
        title=(238, 242, 255), value=(219, 226, 247), sub=(170, 181, 212),
        meta=(136, 146, 176), footer=(136, 146, 176),
        family=(132, 150, 245),
        panel=(22, 30, 47, 255), panel_line=(56, 68, 99, 255),
        shadow=(0, 0, 0, 120),
        row=(28, 38, 60, 255), row_line=(44, 55, 84, 255),
        row_sel=(33, 45, 76, 255), row_sel_line=(132, 150, 245, 255),
        inner=(19, 27, 44, 255), inner_line=(38, 49, 75, 255),
        chip=(32, 43, 68, 255), chip_line=(51, 64, 95, 255),
        accent_pill=(31, 41, 66, 255), accent_pill_line=(61, 75, 111, 255),
        green=(87, 201, 154), green_badge=(25, 48, 42, 255),
        divider=(42, 53, 78, 255),
        label=(136, 146, 176),
    ),
}

COPY = {
    "zh": dict(
        kicker="DSH 插件 · 检查点 / 回退",
        title="回到任意一步",
        value=["工作区、配置、会话，一个检查点。",
               "一条命令回退，原会话历史一行不丢。"],
        subtitle="每步自动捕获 · git / copy 双 provider · fork 回退",
        meta="Apache-2.0 · DSH ≥0.2.1 <0.3.0 · Node 22.19+ / 24 · 纯 ESM",
        footer="github.com/PerryLink/dsh-checkpoint-rewind",
        panel_title="检查点时间线",
        panel_sub="会话 + 工作区 + 配置 三态统一快照",
        refresh="刷新",
        panel_meta="共 3 个检查点 · 已存 1.6 MiB",
        kinds=["保护", "自动", "手动"],
        rows=[("#c3d4e5f6", "git", "turn 3 step 1", "4 files · 1.2 MiB"),
              ("#b2c3d4e5", "git", "turn 2 step 1", "2 files · 310 KiB"),
              ("#a1b2c3d4", "copy", "turn 1 step 2", "2 files · 90 KiB")],
        diff_label="对比 ", diff_ids="#a1b2c3d4 → #b2c3d4e5",
        renderer="逐行",
        sections=[("工作区文件", "2 个变更"),
                  ("配置快照", "3 行差异"),
                  ("会话游标", "18 → 26 · 丢 2 条")],
        cmd="/rewind b2c3d4e5",
        cmd_note="会话内执行 · 需审批",
        copy_btn="复制 /rewind",
    ),
    "en": dict(
        kicker="DSH PLUGIN · CHECKPOINTS / REWIND",
        title="Rewind a step",
        value=["One checkpoint, three states.",
               "One approved command, history kept."],
        subtitle="auto per step · git | copy · fork rollback",
        meta="Apache-2.0 · DSH ≥0.2.1 <0.3.0 · Node 22.19+ / 24 · pure ESM",
        footer="github.com/PerryLink/dsh-checkpoint-rewind",
        panel_title="Checkpoint timeline",
        panel_sub="Unified workspace + session + config snapshots",
        refresh="Refresh",
        panel_meta="3 of 3 checkpoints · 1.6 MiB stored",
        kinds=["guard", "auto", "manual"],
        rows=[("#c3d4e5f6", "git", "turn 3 step 1", "4 files · 1.2 MiB"),
              ("#b2c3d4e5", "git", "turn 2 step 1", "2 files · 310 KiB"),
              ("#a1b2c3d4", "copy", "turn 1 step 2", "2 files · 90 KiB")],
        diff_label="Diff ", diff_ids="#a1b2c3d4 → #b2c3d4e5",
        renderer="pairwise",
        sections=[("Workspace files", "2 changed"),
                  ("Config snapshot", "3 lines"),
                  ("Session cursor", "18 → 26 · drops 2")],
        cmd="/rewind b2c3d4e5",
        cmd_note="in-session · approval-gated",
        copy_btn="Copy /rewind",
    ),
}

_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    key = (path, size)
    if key not in _FONT_CACHE:
        _FONT_CACHE[key] = ImageFont.truetype(path, size)
    return _FONT_CACHE[key]


def gradient(w: int, h: int, c0: tuple[int, int, int],
             c1: tuple[int, int, int]) -> Image.Image:
    xs = np.linspace(0.0, 1.0, w)[None, :]
    ys = np.linspace(0.0, 1.0, h)[:, None]
    t = np.clip(xs * 0.58 + ys * 0.42, 0.0, 1.0)
    arr = np.empty((h, w, 3), dtype=np.float32)
    for i in range(3):
        arr[:, :, i] = c0[i] + (c1[i] - c0[i]) * t
    return Image.fromarray(arr.astype(np.uint8), "RGB").convert("RGBA")


def glow(img: Image.Image, cx: float, cy: float, radius: float,
         color: tuple[int, int, int], alpha: int) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse((cx - radius, cy - radius, cx + radius, cy + radius),
              fill=(*color, alpha))
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(radius * 0.5)))


def soft_shadow(img: Image.Image, box: tuple[float, float, float, float],
                radius: int, color: tuple[int, int, int, int],
                blur: int = 26, dy: int = 12) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = box
    d.rounded_rectangle((x0, y0 + dy, x1, y1 + dy), radius=radius, fill=color)
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


def tlen(draw: ImageDraw.ImageDraw, s: str, f: ImageFont.FreeTypeFont) -> float:
    return draw.textlength(s, font=f)


def draw_hero(lang: str, skin: str) -> Image.Image:
    c = P[skin]
    t = COPY[lang]
    img = gradient(HERO_W, HERO_H, c["bg0"], c["bg1"])

    glow(img, 1210, 90, 430, c["glow"], 30 if skin == "light" else 46)
    glow(img, 150, 560, 380, c["glow"], 14 if skin == "light" else 24)

    # ---- settings panel (right) ------------------------------------------
    panel_box = (744, 60, 1390, 516)
    soft_shadow(img, panel_box, 22, c["shadow"], blur=30, dy=14)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(panel_box, radius=22, fill=c["panel"],
                        outline=c["panel_line"], width=2)

    x0, x1 = 772, 1362
    f_title = font(SANS_BOLD, 23)
    f_sub = font(SANS, 17)
    f_meta = font(SANS, 15)
    f_btn = font(SANS, 15)
    f_row_id = font(MONO_BOLD, 19)
    f_badge = font(SANS, 14)
    f_row = font(SANS, 16)
    f_row_meta = font(MONO, 14)
    f_diff_head = font(MONO, 15)
    f_sec = font(SANS, 15)
    f_val = font(SANS, 18)
    f_cmd = font(MONO, 18)
    f_note = font(SANS, 15)

    d.text((x0, 106), t["panel_title"], font=f_title, fill=c["title"], anchor="ls")
    d.text((x0, 132), t["panel_sub"], font=f_sub, fill=c["sub"], anchor="ls")
    d.text((x0, 156), t["panel_meta"], font=f_meta, fill=c["meta"], anchor="ls")

    btn = (1282, 82, 1362, 112)
    d.rounded_rectangle(btn, radius=10, fill=c["inner"], outline=c["inner_line"], width=1)
    d.text(((btn[0] + btn[2]) / 2, (btn[1] + btn[3]) / 2 + 1), t["refresh"],
           font=f_btn, fill=c["sub"], anchor="mm")

    d.line((x0, 170, x1, 170), fill=c["inner_line"], width=1)

    row_ys = [180, 233, 286]
    row_h = 46
    for i, (cid, prov, turn, right) in enumerate(t["rows"]):
        y = row_ys[i]
        box = (x0, y, x1, y + row_h)
        selected = i == 1
        fill = c["row_sel"] if selected else c["row"]
        line = c["row_sel_line"] if selected else c["row_line"]
        d.rounded_rectangle(box, radius=12, fill=fill, outline=line,
                            width=2 if selected else 1)
        if i == 0:
            # guard checkpoint: green marker, the undo point of a rewind
            d.rounded_rectangle((x0 + 8, y + 13, x0 + 12, y + row_h - 13),
                                radius=2, fill=c["green"])
        if selected:
            d.rounded_rectangle((x0 + 8, y + 13, x0 + 12, y + row_h - 13),
                                radius=2, fill=c["family"])
        base = y + 29
        d.text((x0 + 22, base), cid, font=f_row_id, fill=c["title"], anchor="ls")
        kind = t["kinds"][i]
        badge_fill = c["green_badge"] if i == 0 else c["chip"]
        badge_line = c["green"] if i == 0 else c["chip_line"]
        badge_fg = c["green"] if i == 0 else c["sub"]
        bw = tlen(d, kind, f_badge) + 20
        bx = x0 + 132
        d.rounded_rectangle((bx, y + 12, bx + bw, y + 34),
                            radius=11, fill=badge_fill, outline=badge_line, width=1)
        d.text((bx + bw / 2, y + 23), kind, font=f_badge, fill=badge_fg, anchor="mm")
        px = bx + bw + 16
        d.text((px, base), prov, font=f_row, fill=c["sub"], anchor="ls")
        tx = px + tlen(d, prov, f_row) + 18
        d.text((tx, base), turn, font=f_row, fill=c["sub"], anchor="ls")
        d.text((x1 - 18, base), right, font=f_row_meta, fill=c["meta"], anchor="rs")

    # ---- pairwise diff card (real sections) -------------------------------
    diff_box = (x0, 346, x1, 452)
    d.rounded_rectangle(diff_box, radius=14, fill=c["inner"], outline=c["inner_line"], width=1)
    d.text((x0 + 18, 376), t["diff_label"], font=f_sec, fill=c["sub"], anchor="ls")
    dx = x0 + 18 + tlen(d, t["diff_label"], f_sec)
    d.text((dx, 376), t["diff_ids"], font=f_diff_head, fill=c["sub"], anchor="ls")
    rw = tlen(d, t["renderer"], f_sec) + 20
    d.rounded_rectangle((x1 - 18 - rw, 360, x1 - 18, 382), radius=11,
                        fill=c["chip"], outline=c["chip_line"], width=1)
    d.text((x1 - 18 - rw / 2, 371), t["renderer"], font=f_sec, fill=c["meta"], anchor="mm")
    d.line((x0 + 18, 390, x1 - 18, 390), fill=c["inner_line"], width=1)
    cols = [x0 + 18, x0 + 204, x0 + 378]
    for (head, value), cx in zip(t["sections"], cols):
        d.text((cx, 414), head, font=f_sec, fill=c["label"], anchor="ls")
        d.text((cx, 438), value, font=f_val, fill=c["title"], anchor="ls")

    # ---- copy-/rewind strip ----------------------------------------------
    cmd_box = (x0, 464, x1, 504)
    d.rounded_rectangle(cmd_box, radius=12, fill=c["inner"], outline=c["inner_line"], width=1)
    d.text((x0 + 18, 488), t["cmd"], font=f_cmd, fill=c["title"], anchor="ls")
    d.text((x0 + 212, 487), t["cmd_note"], font=f_note, fill=c["meta"], anchor="ls")
    bw2 = tlen(d, t["copy_btn"], f_btn) + 30
    bx0 = x1 - 18 - bw2
    d.rounded_rectangle((bx0, 468, x1 - 18, 500), radius=10, fill=c["family"])
    d.text(((bx0 + x1 - 18) / 2, 485), t["copy_btn"], font=f_btn,
           fill=(255, 255, 255) if skin == "light" else (14, 18, 28), anchor="mm")

    # ---- left copy column -------------------------------------------------
    f_kick = font(SANS_BOLD, 20)
    f_hero = font(SANS_BOLD, 88 if lang == "zh" else 84)
    f_value = font(SANS, 32)
    f_sub = font(SANS, 26)
    f_meta = font(SANS, 20)
    f_foot = font(MONO, 19)

    kick_w = tlen(d, t["kicker"], f_kick) + 52
    d.rounded_rectangle((72, 92, 72 + kick_w, 136), radius=22,
                        fill=c["accent_pill"], outline=c["accent_pill_line"], width=1)
    d.ellipse((92, 109, 102, 119), fill=c["family"])
    d.text((112, 115), t["kicker"], font=f_kick, fill=c["family"], anchor="lm")

    d.text((70, 250), t["title"], font=f_hero, fill=c["title"], anchor="ls")
    for i, line in enumerate(t["value"]):
        d.text((71, 314 + i * 44), line, font=f_value, fill=c["value"], anchor="ls")
    d.text((71, 412), t["subtitle"], font=f_sub, fill=c["sub"], anchor="ls")
    d.text((71, 456), t["meta"], font=f_meta, fill=c["meta"], anchor="ls")
    d.line((72, 482, 312, 482), fill=c["divider"], width=2)
    d.text((71, 510), t["footer"], font=f_foot, fill=c["footer"], anchor="ls")
    return img


# ---------------------------------------------------------------------------
# Flow SVG: dual-channel confluence -> one record -> guarded restore ladder.
# ---------------------------------------------------------------------------
F = {
    "light": dict(
        bg0="#f9f6fd", bg1="#e4eaf8",
        card="#ffffff", card_line="#d7dcec",
        inner="#f6f8ff", inner_line="#e1e6f3",
        text="#1c2338", sub="#5b6684", meta="#7a849f",
        family="#4B67B4", family_soft="#4b67b41a", family_line="#4b67b459",
        chip="#f1f4fc", chip_line="#dbe1f0",
        green="#17845c", green_soft="#17845c14", green_line="#17845c66",
        shadow="#202a48", shadow_op="0.10",
    ),
    "dark": dict(
        bg0="#131a2a", bg1="#0c1016",
        card="#1f2b47", card_line="#44547f",
        inner="#182137", inner_line="#33415f",
        text="#edf1ff", sub="#9aa6c4", meta="#8591b2",
        family="#8496f5", family_soft="#8496f522", family_line="#8496f577",
        chip="#273357", chip_line="#44547f",
        green="#57c99a", green_soft="#57c99a1f", green_line="#57c99a70",
        shadow="#000000", shadow_op="0.55",
    ),
}

FS = "Segoe UI, Microsoft YaHei, Noto Sans, sans-serif"
FM = "Consolas, ui-monospace, SFMono-Regular, monospace"


def svg_text(x, y, s, *, size=14, fill="#000", family="sans", weight=400,
             anchor="start", spacing=None, opacity=None):
    fam = FS if family == "sans" else FM
    extra = ""
    if weight != 400:
        extra += f' font-weight="{weight}"'
    if spacing is not None:
        extra += f' letter-spacing="{spacing}"'
    if opacity is not None:
        extra += f' opacity="{opacity}"'
    return (f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}"'
            f'{extra} fill="{fill}" text-anchor="{anchor}">{s}</text>')


def svg_card(out, x, y, w, h, c, *, fill=None, line=None, r=14, shadow=True):
    sh = ' filter="url(#soft)"' if shadow else ""
    out.append(
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" '
        f'fill="{fill or c["card"]}" stroke="{line or c["card_line"]}" '
        f'stroke-width="1.2"{sh}/>')


def svg_chip(out, x, y, w, h, c, *, fill=None, line=None):
    out.append(
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h / 2}" '
        f'fill="{fill or c["chip"]}" stroke="{line or c["chip_line"]}" stroke-width="1"/>')


def svg_head(out, x, y, angle, color, size=9.0):
    """Filled arrow head at (x, y), pointing along `angle` (radians)."""
    p1 = (x - size * 1.05 * math.cos(angle - 0.44), y - size * 1.05 * math.sin(angle - 0.44))
    p2 = (x - size * 1.05 * math.cos(angle + 0.44), y - size * 1.05 * math.sin(angle + 0.44))
    out.append(
        f'<path d="M{x:.1f} {y:.1f}L{p1[0]:.1f} {p1[1]:.1f}L{p2[0]:.1f} {p2[1]:.1f}Z" '
        f'fill="{color}"/>')


def svg_arrow(out, x1, y1, x2, y2, color, width=1.8, head=8.5):
    ang = math.atan2(y2 - y1, x2 - x1)
    hx = x2 - head * math.cos(ang)
    hy = y2 - head * math.sin(ang)
    out.append(
        f'<path d="M{x1} {y1}L{hx:.1f} {hy:.1f}" stroke="{color}" '
        f'stroke-width="{width}" stroke-linecap="round" fill="none"/>')
    svg_head(out, x2, y2, ang, color, size=head)


def flow_svg(skin: str) -> str:
    c = F[skin]
    w, h = 1100, 660
    o = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" role="img" '
        f'aria-label="dsh-checkpoint-rewind pipeline: git and copy snapshot channels converge into one checkpoints record, then a confirmed, guarded three-step restore">',
        '<title>dsh-checkpoint-rewind — two snapshot channels, one record, a guarded three-step restore</title>',
        '<defs>',
        f'<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{c["bg0"]}"/>'
        f'<stop offset="1" stop-color="{c["bg1"]}"/></linearGradient>',
        f'<filter id="soft" x="-25%" y="-25%" width="150%" height="150%">'
        f'<feDropShadow dx="0" dy="5" stdDeviation="8" flood-color="{c["shadow"]}" '
        f'flood-opacity="{c["shadow_op"]}"/></filter>',
        '</defs>',
        f'<rect width="{w}" height="{h}" rx="18" fill="url(#bg)"/>',
    ]

    # header
    o.append(svg_text(44, 58, "dsh-checkpoint-rewind", size=27, fill=c["text"], weight=700))
    o.append(svg_text(44, 85,
                      "two snapshot channels → one checkpoint record → guarded three-state restore",
                      size=15, fill=c["sub"], family="mono"))
    o.append(f'<line x1="44" y1="102" x2="1056" y2="102" stroke="{c["card_line"]}" stroke-width="1"/>')

    # ---- band 1: capture --------------------------------------------------
    o.append(svg_text(44, 128, "CAPTURE", size=14, fill=c["family"], weight=700, spacing="1.8"))
    o.append(svg_text(128, 128,
                      "before every mutation · prepend → next() · resolve(auto)",
                      size=14, fill=c["sub"]))

    # triggers
    svg_card(o, 44, 142, 216, 190, c)
    chips = ["fs/write-intent", "fs/edit-intent", "tools/pre-execute",
             "step/start (auto)", "/checkpoint · tool"]
    chip_y = [148, 185, 222, 259, 296]
    for label, y in zip(chips, chip_y):
        svg_chip(o, 58, y, 188, 30, c)
        o.append(svg_text(72, y + 20, label, size=14, fill=c["text"], family="mono"))

    # comb into the dedup stage
    o.append(f'<path d="M246 163H266V311" stroke="{c["meta"]}" stroke-width="1.6" fill="none"/>')
    o.append(f'<path d="M246 200H266M246 237H266M246 274H266M246 311H266" '
             f'stroke="{c["meta"]}" stroke-width="1.6"/>')
    svg_arrow(o, 266, 237, 284, 237, c["family"])

    # dedup / capture stage
    svg_card(o, 284, 142, 232, 190, c)
    o.append(svg_text(300, 173, "capture @ step", size=18, fill=c["text"], weight=700))
    o.append(svg_text(300, 205, "one per (session, turn, step)", size=14, fill=c["sub"]))
    o.append(svg_text(300, 229, "shared in-flight promise", size=14, fill=c["sub"]))
    o.append(svg_text(300, 253, "content dedup → null", size=14, fill=c["sub"]))
    o.append(f'<line x1="300" y1="269" x2="500" y2="269" stroke="{c["inner_line"]}" stroke-width="1"/>')
    o.append(svg_text(300, 293, "prepend → next()", size=14, fill=c["meta"], family="mono"))
    o.append(svg_text(300, 317, "provider owns dedup", size=14, fill=c["meta"], family="mono"))

    # provider split
    svg_card(o, 540, 142, 272, 90, c)
    svg_card(o, 540, 242, 272, 90, c)
    o.append(svg_text(556, 169, "git provider", size=17, fill=c["text"], weight=700))
    o.append(svg_text(556, 193, "stash create · commit-tree", size=14, fill=c["sub"], family="mono"))
    o.append(svg_text(556, 215, "restore · explicit paths", size=14, fill=c["sub"], family="mono"))
    o.append(svg_text(556, 269, "copy provider", size=17, fill=c["text"], weight=700))
    o.append(svg_text(556, 293, "incremental dir + hardlinks", size=14, fill=c["sub"], family="mono"))
    o.append(svg_text(556, 315, "hash verify · lstat guard", size=14, fill=c["sub"], family="mono"))

    # dedup -> providers splitter, providers -> record merge (the confluence)
    o.append(f'<path d="M516 237H526V187H538" stroke="{c["family"]}" stroke-width="1.8" fill="none"/>')
    o.append(f'<path d="M526 287H538" stroke="{c["family"]}" stroke-width="1.8" fill="none"/>')
    svg_head(o, 540, 187, 0.0, c["family"], size=7.5)
    svg_head(o, 540, 287, 0.0, c["family"], size=7.5)
    o.append(f'<path d="M812 187H818Q826 187 826 195V228Q826 237 834 237" stroke="{c["family"]}" '
             f'stroke-width="1.8" fill="none"/>')
    o.append(f'<path d="M812 287H818Q826 287 826 279V246Q826 237 834 237" stroke="{c["family"]}" '
             f'stroke-width="1.8" fill="none"/>')
    svg_head(o, 836, 237, 0.0, c["family"], size=8.5)

    # one record
    svg_card(o, 836, 142, 216, 190, c, fill=c["card"], line=c["family_line"])
    o.append(svg_text(852, 173, "checkpoints", size=18, fill=c["text"], weight=700))
    o.append(svg_text(1036, 172, "v2", size=14, fill=c["family"], family="mono", weight=700,
                      anchor="end"))
    for i, line in enumerate([
        "domain · SQLite / JSON",
        "id · #short · turn",
        "step · seq · boundary",
        "provider · ref · tree",
        "global · shortCounters",
    ]):
        o.append(svg_text(852, 201 + i * 22, line, size=14, fill=c["sub"], family="mono"))
    o.append(f'<line x1="852" y1="300" x2="1036" y2="300" stroke="{c["inner_line"]}" stroke-width="1"/>')
    o.append(svg_text(852, 320, "checkpoint/* · gate", size=14, fill=c["meta"], family="mono"))

    # ---- band 2: rewind ---------------------------------------------------
    o.append(svg_text(44, 366, "REWIND", size=14, fill=c["family"], weight=700, spacing="1.8"))
    o.append(svg_text(128, 366, "approved · guarded · ordered 1→2→3", size=14, fill=c["sub"]))

    svg_card(o, 44, 380, 216, 74, c)
    o.append(svg_text(60, 410, "/rewind &lt;target&gt;", size=16, fill=c["text"], family="mono", weight=700))
    o.append(svg_text(60, 436, "list · diff · preview", size=14, fill=c["meta"]))
    svg_arrow(o, 260, 416, 284, 416, c["family"])

    svg_card(o, 284, 380, 224, 74, c)
    o.append(svg_text(300, 406, "confirm", size=17, fill=c["text"], weight=700))
    o.append(svg_text(300, 430, "userQuestions/approval", size=14, fill=c["sub"], family="mono"))
    o.append(svg_text(300, 450, "missing / throw → deny", size=14, fill=c["meta"]))
    svg_arrow(o, 508, 416, 532, 416, c["family"])

    svg_card(o, 532, 380, 192, 74, c, fill=c["green_soft"], line=c["green_line"])
    o.append(svg_text(548, 406, "guard", size=17, fill=c["green"], weight=700))
    o.append(svg_text(548, 430, "pre-rewind checkpoint", size=14, fill=c["sub"]))
    o.append(svg_text(548, 450, "id printed → undoable", size=14, fill=c["meta"]))

    # three-step restore ladder
    svg_arrow(o, 628, 454, 628, 470, c["green"], head=7.5)
    rungs = [
        (284, "1", "workspace", "provider.restore(ref)",
         "restore | reset-hard · explicit paths · no deletion"),
        (332, "2", "config", "settings write-back",
         "profile patch · scope.replace / SettingsForms"),
        (380, "3", "session", "SessionStore.fork(src, boundary)",
         "turn-end fork · original kept"),
    ]
    rung_y = [470, 526, 582]
    for (left, num, title, token, note), y in zip(rungs, rung_y):
        right = 1044
        svg_card(o, left, y, right - left, 46, c, r=13)
        o.append(f'<circle cx="{left + 26}" cy="{y + 23}" r="13" fill="{c["family_soft"]}" '
                 f'stroke="{c["family_line"]}" stroke-width="1"/>')
        o.append(svg_text(left + 26, y + 28, num, size=14, fill=c["family"], weight=700,
                          anchor="middle"))
        o.append(svg_text(left + 50, y + 29, title, size=17, fill=c["text"], weight=700))
        o.append(svg_text(left + 158, y + 28, token, size=14, fill=c["sub"], family="mono"))
        o.append(svg_text(right - 16, y + 28, note, size=14, fill=c["meta"], anchor="end"))
    # stair connectors
    svg_arrow(o, 300, 516, 332, 526, c["family"], width=1.5, head=7)
    svg_arrow(o, 348, 572, 380, 582, c["family"], width=1.5, head=7)

    # the record is what the restore reads (ref + boundaries)
    o.append(f'<path d="M900 336V460" stroke="{c["family"]}" stroke-width="1.4" '
             f'stroke-dasharray="5 5" fill="none" opacity="0.7"/>')
    svg_head(o, 900, 470, math.pi / 2, c["family"], size=7.5)
    o.append(svg_text(912, 404, "restore ref", size=14, fill=c["meta"]))

    # footer
    o.append(svg_text(44, 648,
                      "preview is read-only · diff a b · clear [--all] · prune: newest kept per session",
                      size=14, fill=c["meta"], family="mono"))
    o.append(svg_text(1056, 648, "restore failure → no fork · checkpoint kept",
                      size=14, fill=c["meta"], anchor="end"))
    o.append('</svg>')
    return "\n".join(o) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for lang in ("zh", "en"):
        for skin in ("light", "dark"):
            img = draw_hero(lang, skin).convert("RGB")
            path = os.path.join(OUT, f"dsh-checkpoint-rewind-hero-{lang}-{skin}.webp")
            img.save(path, "WEBP", quality=WEBP_QUALITY, method=6)
            print("wrote", os.path.relpath(path, ROOT))
    for skin in ("light", "dark"):
        path = os.path.join(OUT, f"dsh-checkpoint-rewind-flow-v5-{skin}.svg")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
        print("wrote", os.path.relpath(path, ROOT))


if __name__ == "__main__":
    main()
