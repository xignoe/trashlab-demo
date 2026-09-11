#!/usr/bin/env python3
"""Parse CHECKLIST.md, record first-ticked times in progress.json, render dashboard.html.

Usage: python3 scripts/build_dashboard.py CHECKLIST.md

- Boxes are lines starting with "- [ ]" or "- [x]" under "## Phase N: ..." headings.
- progress.json maps a stable box key (phase title + box text) to the ISO time it was first seen ticked.
- dashboard.html shows a counter, per-phase bars, and a boxes-ticked-over-time chart (inline SVG).
"""
import hashlib
import html
import json
import os
import re
import sys
from datetime import datetime, timezone

PHASE_RE = re.compile(r"^##\s+(Phase\s+\d+[^\n]*)$")
BOX_RE = re.compile(r"^-\s+\[( |x|X)\]\s+(.*)$")


def parse(path):
    phases = []
    current = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            m = PHASE_RE.match(line)
            if m:
                current = {"title": m.group(1).strip(), "boxes": []}
                phases.append(current)
                continue
            m = BOX_RE.match(line)
            if m and current is not None:
                current["boxes"].append({"ticked": m.group(1).lower() == "x", "text": m.group(2).strip()})
    return phases


def box_key(phase_title, text):
    h = hashlib.sha1((phase_title + "||" + text).encode("utf-8")).hexdigest()[:12]
    return f"{phase_title[:20]}::{h}"


def load_progress(path):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_progress(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)


def render(phases, progress, out_path, checklist_name):
    total = sum(len(p["boxes"]) for p in phases)
    done = sum(1 for p in phases for b in p["boxes"] if b["ticked"])
    now = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M")

    # Time series of ticks
    times = sorted(datetime.fromisoformat(t) for t in progress.values())
    chart = ""
    if times:
        w, h, pad = 720, 220, 36
        t0, t1 = times[0], times[-1]
        span = max((t1 - t0).total_seconds(), 1.0)
        pts = []
        for i, t in enumerate(times, start=1):
            x = pad + (w - 2 * pad) * ((t - t0).total_seconds() / span)
            y = h - pad - (h - 2 * pad) * (i / max(total, 1))
            pts.append((x, y))
        # step line
        d = f"M {pad} {h - pad} "
        prev_y = h - pad
        for x, y in pts:
            d += f"L {x:.1f} {prev_y:.1f} L {x:.1f} {y:.1f} "
            prev_y = y
        d += f"L {w - pad} {prev_y:.1f}"
        ticks = "".join(
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="var(--accent)"/>' for x, y in pts
        )
        label0 = html.escape(t0.strftime("%m-%d %H:%M"))
        label1 = html.escape(t1.strftime("%m-%d %H:%M"))
        chart = f"""
<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="Boxes ticked over time">
  <line x1="{pad}" y1="{h - pad}" x2="{w - pad}" y2="{h - pad}" stroke="var(--line)"/>
  <line x1="{pad}" y1="{pad}" x2="{pad}" y2="{h - pad}" stroke="var(--line)"/>
  <text x="{pad}" y="{h - pad + 18}" font-size="11" fill="var(--ink-3)">{label0}</text>
  <text x="{w - pad}" y="{h - pad + 18}" font-size="11" fill="var(--ink-3)" text-anchor="end">{label1}</text>
  <text x="{pad - 6}" y="{pad + 4}" font-size="11" fill="var(--ink-3)" text-anchor="end">{total}</text>
  <text x="{pad - 6}" y="{h - pad + 4}" font-size="11" fill="var(--ink-3)" text-anchor="end">0</text>
  <path d="{d}" fill="none" stroke="var(--ink)" stroke-width="2"/>
  {ticks}
</svg>"""
    else:
        chart = '<p class="muted">No boxes ticked yet.</p>'

    phase_rows = []
    for p in phases:
        n = len(p["boxes"])
        k = sum(1 for b in p["boxes"] if b["ticked"])
        pct = (100.0 * k / n) if n else 0
        items = "".join(
            f'<li class="{"done" if b["ticked"] else ""}">{"&#10003;" if b["ticked"] else "&#9675;"} {html.escape(b["text"])}</li>'
            for b in p["boxes"]
        )
        phase_rows.append(
            f"""
<section class="phase">
  <h2>{html.escape(p["title"])} <span class="count">{k} / {n}</span></h2>
  <div class="bar"><div class="fill" style="width:{pct:.1f}%"></div></div>
  <details><summary>Boxes</summary><ul>{items}</ul></details>
</section>"""
        )

    doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Build dashboard</title>
<style>
  :root {{ --bg:#F2F4F6; --surface:#fff; --ink:#17202B; --ink-2:#4A5563; --ink-3:#7A8592; --line:#CBD2DA; --accent:#C9541F; }}
  @media (prefers-color-scheme: dark) {{ :root {{ --bg:#12171D; --surface:#1A2129; --ink:#E8ECF0; --ink-2:#B4BDC7; --ink-3:#7F8A96; --line:#36414D; --accent:#E8823F; }} }}
  body {{ margin:0; background:var(--bg); color:var(--ink); font: 15px/1.5 "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif; padding:32px 24px 64px; }}
  .wrap {{ max-width: 900px; margin: 0 auto; }}
  h1 {{ font-family: Archivo, "Helvetica Neue", Arial, sans-serif; font-size: 32px; margin: 0 0 4px; }}
  .muted {{ color: var(--ink-3); }}
  .counter {{ font-family: "IBM Plex Mono", Menlo, monospace; font-size: 48px; font-weight: 600; margin: 8px 0 24px; }}
  .counter small {{ font-size: 18px; color: var(--ink-2); }}
  .card {{ background: var(--surface); border: 1px solid var(--line); padding: 16px 20px; margin-bottom: 16px; }}
  .phase h2 {{ font-family: Archivo, sans-serif; font-size: 16px; margin: 0 0 8px; display:flex; justify-content: space-between; }}
  .count {{ font-family: "IBM Plex Mono", Menlo, monospace; color: var(--ink-2); font-weight: 500; }}
  .bar {{ height: 10px; background: var(--bg); border: 1px solid var(--line); }}
  .fill {{ height: 100%; background: var(--accent); }}
  details {{ margin-top: 8px; }}
  summary {{ cursor: pointer; color: var(--ink-2); font-size: 13px; }}
  ul {{ list-style: none; padding: 0; margin: 8px 0 0; font-size: 13px; }}
  li {{ padding: 3px 0; border-top: 1px solid var(--line); color: var(--ink-2); }}
  li.done {{ color: var(--ink); }}
</style>
</head>
<body>
<div class="wrap">
  <h1>Build dashboard</h1>
  <p class="muted">{html.escape(checklist_name)} · rendered {now}</p>
  <div class="counter">{done} <small>of {total} boxes ticked</small></div>
  <div class="card"><h2 style="font-family:Archivo,sans-serif;font-size:16px;margin:0 0 8px">Boxes ticked over time</h2>{chart}</div>
  {''.join(phase_rows).replace('<section class="phase">', '<section class="phase card">')}
</div>
</body>
</html>
"""
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(doc)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    checklist = sys.argv[1]
    base = os.path.dirname(os.path.abspath(checklist))
    progress_path = os.path.join(base, "progress.json")
    out_path = os.path.join(base, "dashboard.html")

    phases = parse(checklist)
    progress = load_progress(progress_path)
    now_iso = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    for p in phases:
        for b in p["boxes"]:
            key = box_key(p["title"], b["text"])
            if b["ticked"] and key not in progress:
                progress[key] = now_iso
    save_progress(progress_path, progress)
    render(phases, progress, out_path, os.path.basename(checklist))

    total = sum(len(p["boxes"]) for p in phases)
    done = sum(1 for p in phases for b in p["boxes"] if b["ticked"])
    print(f"{done}/{total} boxes ticked across {len(phases)} phases. Wrote {out_path}")
    for p in phases:
        k = sum(1 for b in p["boxes"] if b["ticked"])
        print(f"  {p['title']}: {k}/{len(p['boxes'])}")


if __name__ == "__main__":
    main()
