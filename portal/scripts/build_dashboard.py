#!/usr/bin/env python3
"""Parse CHECKLIST.md, record first-ticked times in progress.json, render dashboard.html.

Usage: python scripts/build_dashboard.py CHECKLIST.md
"""
import json, re, sys, html
from datetime import datetime, timezone
from pathlib import Path

checklist = Path(sys.argv[1] if len(sys.argv) > 1 else "CHECKLIST.md")
root = checklist.parent
progress_path = root / "progress.json"
dashboard_path = root / "dashboard.html"

phase_re = re.compile(r"^##\s+(Phase\s+\d+.*)$")
box_re = re.compile(r"^-\s+\[( |x|X)\]\s+(.*)$")

phases = []
current = None
for line in checklist.read_text().splitlines():
    m = phase_re.match(line)
    if m:
        current = {"title": m.group(1).strip(), "boxes": []}
        phases.append(current)
        continue
    m = box_re.match(line)
    if m and current is not None:
        current["boxes"].append({"done": m.group(1).lower() == "x", "text": m.group(2).strip()})

progress = json.loads(progress_path.read_text()) if progress_path.exists() else {}
now = datetime.now(timezone.utc).isoformat(timespec="seconds")
for pi, ph in enumerate(phases):
    for bi, box in enumerate(ph["boxes"]):
        key = f"{pi+1}:{bi+1}"
        if box["done"] and key not in progress:
            progress[key] = {"first_ticked": now, "text": box["text"][:120]}
progress_path.write_text(json.dumps(progress, indent=2))

total = sum(len(p["boxes"]) for p in phases)
done = sum(1 for p in phases for b in p["boxes"] if b["done"])

# ticked-over-time series
times = sorted(v["first_ticked"] for v in progress.values())
points = []
count = 0
for t in times:
    count += 1
    points.append((datetime.fromisoformat(t), count))

def chart_svg():
    w, h, pad = 720, 220, 36
    if not points:
        return f'<svg width="{w}" height="{h}"><text x="{pad}" y="{h//2}" fill="#888">No boxes ticked yet</text></svg>'
    t0 = points[0][0]; t1 = points[-1][0]
    span = max((t1 - t0).total_seconds(), 60)
    def sx(t): return pad + (t - t0).total_seconds() / span * (w - 2*pad)
    def sy(c): return h - pad - c / max(total, 1) * (h - 2*pad)
    path = " ".join(f"{'M' if i==0 else 'L'}{sx(t):.1f},{sy(c):.1f}" for i, (t, c) in enumerate(points))
    path += f" L{sx(t1):.1f},{sy(points[-1][1]):.1f}"
    return f'''<svg width="{w}" height="{h}" style="background:#fff;border:1px solid #e5e7eb;border-radius:8px">
<line x1="{pad}" y1="{h-pad}" x2="{w-pad}" y2="{h-pad}" stroke="#d1d5db"/>
<line x1="{pad}" y1="{pad}" x2="{pad}" y2="{h-pad}" stroke="#d1d5db"/>
<text x="{pad}" y="{pad-10}" font-size="11" fill="#6b7280">boxes ticked (of {total})</text>
<text x="{w-pad}" y="{h-pad+16}" font-size="11" fill="#6b7280" text-anchor="end">{t1.strftime('%H:%M')} UTC</text>
<text x="{pad}" y="{h-pad+16}" font-size="11" fill="#6b7280">{t0.strftime('%H:%M')} UTC</text>
<path d="{path}" fill="none" stroke="#2563eb" stroke-width="2"/>
{''.join(f'<circle cx="{sx(t):.1f}" cy="{sy(c):.1f}" r="2.5" fill="#2563eb"/>' for t,c in points)}
</svg>'''

rows = []
for ph in phases:
    n = len(ph["boxes"]); d = sum(1 for b in ph["boxes"] if b["done"])
    pct = int(100 * d / n) if n else 0
    boxes = "".join(
        f'<li class="{"done" if b["done"] else ""}">{"&#10003;" if b["done"] else "&#9633;"} {html.escape(b["text"])}</li>'
        for b in ph["boxes"])
    rows.append(f'''<section>
<h2>{html.escape(ph["title"])} <span class="muted">{d}/{n}</span></h2>
<div class="bar"><div class="fill" style="width:{pct}%"></div></div>
<ul>{boxes}</ul></section>''')

dashboard_path.write_text(f'''<!doctype html><meta charset="utf-8"><title>Portal build dashboard</title>
<style>
body{{font:14px/1.45 -apple-system,Segoe UI,sans-serif;margin:0;padding:24px;background:#f8fafc;color:#111827;max-width:860px}}
h1{{font-size:22px;margin:0 0 4px}} h2{{font-size:15px;margin:22px 0 6px}} .muted{{color:#6b7280;font-weight:normal}}
.counter{{font-size:40px;font-weight:600;margin:8px 0 16px}} .counter small{{font-size:16px;color:#6b7280;font-weight:normal}}
.bar{{height:10px;background:#e5e7eb;border-radius:5px;overflow:hidden}} .fill{{height:100%;background:#16a34a}}
ul{{list-style:none;padding:0;margin:8px 0 0}} li{{padding:3px 0;color:#374151}} li.done{{color:#9ca3af;text-decoration:line-through}}
</style>
<h1>Customer portal build</h1>
<div class="muted">Rendered {now}</div>
<div class="counter">{done} <small>of {total} boxes ticked ({int(100*done/total) if total else 0}%)</small></div>
<div class="bar"><div class="fill" style="width:{int(100*done/total) if total else 0}%"></div></div>
<h2>Boxes ticked over time</h2>
{chart_svg()}
{''.join(rows)}
''')
print(f"{done}/{total} boxes ticked across {len(phases)} phases -> {dashboard_path}")
