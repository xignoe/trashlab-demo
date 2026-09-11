#!/usr/bin/env python3
"""Parse CHECKLIST.md, record first-ticked times in progress.json, render dashboard.html.

Usage: python scripts/build_dashboard.py CHECKLIST.md
Box identity is phase title plus box text, so editing a box's wording resets its record.
"""
import hashlib, html, json, re, sys
from datetime import datetime, timezone
from pathlib import Path

PHASE_RE = re.compile(r"^##\s+(.*)$")
BOX_RE = re.compile(r"^- \[( |x|X)\]\s+(.*)$")


def parse(path: Path):
    phases = []
    current = None
    for line in path.read_text(encoding="utf-8").splitlines():
        m = PHASE_RE.match(line)
        if m:
            current = {"title": m.group(1).strip(), "boxes": []}
            phases.append(current)
            continue
        m = BOX_RE.match(line)
        if m and current is not None:
            text = m.group(2).strip()
            key = hashlib.sha1(f"{current['title']}::{text}".encode()).hexdigest()[:12]
            current["boxes"].append({"key": key, "text": text, "done": m.group(1).lower() == "x"})
    return [p for p in phases if p["boxes"]]


def update_progress(phases, progress_path: Path):
    progress = {}
    if progress_path.exists():
        try:
            progress = json.loads(progress_path.read_text())
        except json.JSONDecodeError:
            progress = {}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    progress.setdefault("started", now)
    ticks = progress.setdefault("ticks", {})
    for p in phases:
        for b in p["boxes"]:
            if b["done"] and b["key"] not in ticks:
                ticks[b["key"]] = {"at": now, "phase": p["title"], "text": b["text"]}
    progress["lastRun"] = now
    progress_path.write_text(json.dumps(progress, indent=2))
    return progress


def chart_svg(progress, total):
    events = sorted(progress.get("ticks", {}).values(), key=lambda t: t["at"])
    start = datetime.fromisoformat(progress["started"])
    last = datetime.fromisoformat(progress["lastRun"])
    span = max((last - start).total_seconds(), 60)
    W, H, L, B = 720, 220, 40, 30
    pts = [(0, 0)]
    for i, e in enumerate(events, 1):
        t = (datetime.fromisoformat(e["at"]) - start).total_seconds()
        pts.append((t, i))
    pts.append((span, len(events)))
    def sx(t): return L + (t / span) * (W - L - 10)
    def sy(n): return H - B - (n / max(total, 1)) * (H - B - 10)
    path = ""
    prev = None
    for t, n in pts:
        x, y = sx(t), sy(n)
        if prev is None:
            path += f"M{x:.1f},{y:.1f}"
        else:
            path += f" H{x:.1f} V{y:.1f}"
        prev = (x, y)
    grid = "".join(
        f'<line x1="{L}" y1="{sy(n):.1f}" x2="{W-10}" y2="{sy(n):.1f}" stroke="#e5e7eb"/>'
        f'<text x="{L-6}" y="{sy(n)+4:.1f}" font-size="11" text-anchor="end" fill="#6b7280">{n}</text>'
        for n in range(0, total + 1, max(total // 5, 1))
    )
    hours = span / 3600
    return (
        f'<svg viewBox="0 0 {W} {H}" width="100%" style="max-width:{W}px">{grid}'
        f'<path d="{path}" fill="none" stroke="#2563eb" stroke-width="2"/>'
        f'<text x="{L}" y="{H-8}" font-size="11" fill="#6b7280">start {start.strftime("%H:%M")}Z</text>'
        f'<text x="{W-10}" y="{H-8}" font-size="11" text-anchor="end" fill="#6b7280">{hours:.1f} h elapsed</text></svg>'
    )


def render(phases, progress, out: Path):
    total = sum(len(p["boxes"]) for p in phases)
    done = sum(b["done"] for p in phases for b in p["boxes"])
    rows = ""
    for p in phases:
        n, d = len(p["boxes"]), sum(b["done"] for b in p["boxes"])
        pct = int(100 * d / n) if n else 0
        items = "".join(
            f'<li class="{"done" if b["done"] else ""}">{"&#10003;" if b["done"] else "&#9744;"} {html.escape(b["text"])}</li>'
            for b in p["boxes"]
        )
        rows += (
            f'<section><h2>{html.escape(p["title"])} <span>{d}/{n}</span></h2>'
            f'<div class="bar"><div style="width:{pct}%"></div></div>'
            f'<details><summary>boxes</summary><ul>{items}</ul></details></section>'
        )
    doc = f"""<!doctype html><meta charset="utf-8"><title>Storefront build dashboard</title>
<style>body{{font:14px/1.5 system-ui;margin:0;padding:24px;max-width:860px;color:#111827}}
h1{{font-size:22px;margin:0 0 4px}}.counter{{font-size:40px;font-weight:700}}
section{{margin:18px 0}}h2{{font-size:15px;margin:0 0 6px}}h2 span{{color:#6b7280;font-weight:400}}
.bar{{height:10px;background:#e5e7eb;border-radius:5px;overflow:hidden}}.bar div{{height:100%;background:#2563eb}}
ul{{list-style:none;padding:0;margin:6px 0 0}}li{{padding:2px 0;color:#6b7280}}li.done{{color:#111827}}
summary{{cursor:pointer;color:#6b7280;font-size:12px}}.meta{{color:#6b7280;font-size:12px}}</style>
<h1>Storefront build dashboard</h1>
<div class="counter">{done} / {total} boxes</div>
<div class="meta">last run {html.escape(progress["lastRun"])}</div>
<h2 style="margin-top:20px">Boxes ticked over time</h2>{chart_svg(progress, total)}
{rows}"""
    out.write_text(doc, encoding="utf-8")
    return done, total


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "CHECKLIST.md")
    phases = parse(src)
    progress = update_progress(phases, src.parent / "progress.json")
    done, total = render(phases, progress, src.parent / "dashboard.html")
    print(f"{done}/{total} boxes ticked; dashboard.html and progress.json updated")


if __name__ == "__main__":
    main()
