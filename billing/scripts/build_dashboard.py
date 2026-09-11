#!/usr/bin/env python3
"""Parse CHECKLIST.md, record first-ticked times in progress.json, render dashboard.html.

Usage: python scripts/build_dashboard.py CHECKLIST.md
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

PHASE_RE = re.compile(r"^##\s+Phase\s+(\d+)\s*[:.]?\s*(.*)$")
BOX_RE = re.compile(r"^\s*-\s*\[( |x|X)\]\s+(.*)$")


def parse(path: Path):
    phases = []
    current = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        m = PHASE_RE.match(raw.strip())
        if m:
            current = {"number": int(m.group(1)), "title": m.group(2).strip(), "boxes": []}
            phases.append(current)
            continue
        b = BOX_RE.match(raw)
        if b and current is not None:
            idx = len(current["boxes"]) + 1
            key = f"P{current['number']}.{idx}"
            current["boxes"].append({"key": key, "text": b.group(2).strip(), "done": b.group(1).lower() == "x"})
    return phases


def update_progress(phases, progress_path: Path):
    progress = {}
    if progress_path.exists():
        try:
            progress = json.loads(progress_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            progress = {}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for ph in phases:
        for box in ph["boxes"]:
            if box["done"] and box["key"] not in progress:
                progress[box["key"]] = {"ticked_at": now, "text": box["text"]}
    progress_path.write_text(json.dumps(progress, indent=2, sort_keys=True), encoding="utf-8")
    return progress


def render(phases, progress, out_path: Path):
    total = sum(len(p["boxes"]) for p in phases)
    done = sum(1 for p in phases for b in p["boxes"] if b["done"])
    events = sorted(v["ticked_at"] for v in progress.values())
    points = [{"t": t, "n": i + 1} for i, t in enumerate(events)]

    phase_rows = []
    for p in phases:
        n = len(p["boxes"])
        d = sum(1 for b in p["boxes"] if b["done"])
        pct = 0 if n == 0 else round(100 * d / n)
        boxes_html = "".join(
            f'<li class="{ "done" if b["done"] else "todo" }"><span class="key">{b["key"]}</span> {esc(b["text"])}'
            + (f'<span class="ts">{progress.get(b["key"], {}).get("ticked_at", "")}</span>' if b["done"] else "")
            + "</li>"
            for b in p["boxes"]
        )
        phase_rows.append(
            f"""<section class="phase">
  <header><h2>Phase {p['number']}: {esc(p['title'])}</h2><span class="count">{d} / {n}</span></header>
  <div class="bar"><div class="fill" style="width:{pct}%"></div></div>
  <ul>{boxes_html}</ul>
</section>"""
        )

    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Billing build dashboard</title>
<style>
  :root {{ --ink:#1c1c1c; --muted:#6b6b6b; --line:#e3e3e3; --accent:#0f6b4f; --bg:#fafafa; }}
  body {{ margin:0; padding:32px; font:14px/1.5 -apple-system, system-ui, sans-serif; color:var(--ink); background:var(--bg); }}
  h1 {{ font-size:28px; margin:0 0 4px; }}
  .counter {{ font-size:48px; font-weight:700; letter-spacing:-0.02em; }}
  .counter small {{ font-size:16px; color:var(--muted); font-weight:400; margin-left:8px; }}
  .phase {{ background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px 20px; margin:16px 0; }}
  .phase header {{ display:flex; justify-content:space-between; align-items:baseline; }}
  .phase h2 {{ font-size:16px; margin:0; }}
  .count {{ color:var(--muted); }}
  .bar {{ height:8px; background:var(--line); border-radius:4px; margin:10px 0; overflow:hidden; }}
  .fill {{ height:100%; background:var(--accent); }}
  ul {{ list-style:none; padding:0; margin:8px 0 0; }}
  li {{ padding:3px 0; border-top:1px solid var(--line); }}
  li.done {{ color:var(--muted); text-decoration:line-through; }}
  .key {{ display:inline-block; width:56px; color:var(--muted); font-variant-numeric:tabular-nums; }}
  .ts {{ float:right; font-size:11px; color:var(--muted); text-decoration:none; }}
  svg {{ background:#fff; border:1px solid var(--line); border-radius:8px; }}
  .meta {{ color:var(--muted); font-size:12px; }}
</style></head>
<body>
<h1>Billing run build</h1>
<div class="meta">Rendered {datetime.now(timezone.utc).isoformat(timespec='seconds')}</div>
<div class="counter">{done} / {total}<small>boxes ticked</small></div>
<h2 style="font-size:16px;margin-top:24px">Boxes ticked over time</h2>
{chart_svg(points, total)}
{''.join(phase_rows)}
</body></html>"""
    out_path.write_text(html, encoding="utf-8")


def chart_svg(points, total):
    w, h, pad = 720, 220, 36
    if not points:
        return f'<svg width="{w}" height="{h}"><text x="{pad}" y="{h//2}" fill="#6b6b6b">No boxes ticked yet</text></svg>'
    times = [datetime.fromisoformat(p["t"]) for p in points]
    t0, t1 = times[0], times[-1]
    span = max((t1 - t0).total_seconds(), 1)
    ymax = max(total, 1)

    def X(t):
        return pad + (w - 2 * pad) * ((t - t0).total_seconds() / span)

    def Y(n):
        return h - pad - (h - 2 * pad) * (n / ymax)

    # step chart
    d = f"M {X(t0):.1f} {Y(0):.1f}"
    prev_n = 0
    for t, p in zip(times, points):
        d += f" L {X(t):.1f} {Y(prev_n):.1f} L {X(t):.1f} {Y(p['n']):.1f}"
        prev_n = p["n"]
    d += f" L {w - pad} {Y(prev_n):.1f}"
    label0 = t0.strftime("%H:%M")
    label1 = t1.strftime("%H:%M")
    return f"""<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}">
  <line x1="{pad}" y1="{h-pad}" x2="{w-pad}" y2="{h-pad}" stroke="#e3e3e3"/>
  <line x1="{pad}" y1="{pad}" x2="{pad}" y2="{h-pad}" stroke="#e3e3e3"/>
  <text x="{pad}" y="{h-pad+16}" font-size="11" fill="#6b6b6b">{label0}</text>
  <text x="{w-pad}" y="{h-pad+16}" font-size="11" fill="#6b6b6b" text-anchor="end">{label1}</text>
  <text x="{pad-6}" y="{pad+4}" font-size="11" fill="#6b6b6b" text-anchor="end">{total}</text>
  <text x="{pad-6}" y="{h-pad+4}" font-size="11" fill="#6b6b6b" text-anchor="end">0</text>
  <path d="{d}" fill="none" stroke="#0f6b4f" stroke-width="2"/>
</svg>"""


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    checklist = Path(sys.argv[1]).resolve()
    root = checklist.parent
    phases = parse(checklist)
    progress = update_progress(phases, root / "progress.json")
    render(phases, progress, root / "dashboard.html")
    total = sum(len(p["boxes"]) for p in phases)
    done = sum(1 for p in phases for b in p["boxes"] if b["done"])
    print(f"{done}/{total} boxes ticked. Wrote progress.json and dashboard.html")


if __name__ == "__main__":
    main()
