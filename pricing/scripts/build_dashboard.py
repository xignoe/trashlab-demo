#!/usr/bin/env python3
"""Parse CHECKLIST.md, record first-ticked times in progress.json, render dashboard.html.

Usage: python3 scripts/build_dashboard.py CHECKLIST.md
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

PHASE_RE = re.compile(r"^##\s+(Phase\s+\d+.*)$")
BOX_RE = re.compile(r"^-\s+\[( |x|X)\]\s+(\S+)\s+(.*)$")


def parse(checklist_path: Path):
    phases = []
    current = None
    for line in checklist_path.read_text(encoding="utf-8").splitlines():
        m = PHASE_RE.match(line.strip())
        if m:
            current = {"name": m.group(1).strip(), "boxes": []}
            phases.append(current)
            continue
        m = BOX_RE.match(line.strip())
        if m and current is not None:
            current["boxes"].append(
                {
                    "id": m.group(2),
                    "text": m.group(3).strip(),
                    "ticked": m.group(1).lower() == "x",
                }
            )
    return phases


def load_progress(path: Path):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def render(phases, progress, out: Path, started_at: str):
    total = sum(len(p["boxes"]) for p in phases)
    done = sum(1 for p in phases for b in p["boxes"] if b["ticked"])

    # Time series of ticks
    events = sorted(
        ((v, k) for k, v in progress.get("firstTicked", {}).items()), key=lambda t: t[0]
    )
    series = []
    count = 0
    for ts, box_id in events:
        count += 1
        series.append({"t": ts, "n": count, "id": box_id})

    phase_rows = []
    for p in phases:
        n = len(p["boxes"])
        d = sum(1 for b in p["boxes"] if b["ticked"])
        pct = int(round(100 * d / n)) if n else 0
        boxes_html = "".join(
            f'<li class="{"done" if b["ticked"] else "todo"}"><span class="id">{b["id"]}</span> {esc(b["text"])}'
            + (
                f' <span class="ts">{progress.get("firstTicked", {}).get(b["id"], "")}</span>'
                if b["ticked"]
                else ""
            )
            + "</li>"
            for b in p["boxes"]
        )
        phase_rows.append(
            f"""
<section class="phase">
  <div class="phase-head"><h2>{esc(p["name"])}</h2><span class="count">{d} / {n}</span></div>
  <div class="bar"><div class="fill" style="width:{pct}%"></div></div>
  <details><summary>Boxes</summary><ul>{boxes_html}</ul></details>
</section>"""
        )

    series_json = json.dumps(series)
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Pricing build dashboard</title>
<meta http-equiv="refresh" content="60">
<style>
  :root {{ --bg:#f6f7f8; --surface:#fff; --border:#e2e5e9; --text:#111418; --muted:#6b7280; --accent:#1f6f4a; --fill:#2f9e6a; }}
  body {{ margin:0; font:14px/1.5 -apple-system, "Manrope", system-ui, sans-serif; background:var(--bg); color:var(--text); }}
  main {{ max-width:1000px; margin:0 auto; padding:32px 24px 64px; }}
  h1 {{ font-size:22px; margin:0 0 4px; }}
  .sub {{ color:var(--muted); margin-bottom:24px; }}
  .counter {{ display:flex; gap:24px; align-items:baseline; margin-bottom:24px; }}
  .counter .big {{ font-size:48px; font-weight:700; color:var(--accent); }}
  .phase {{ background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px 20px; margin-bottom:12px; }}
  .phase-head {{ display:flex; justify-content:space-between; align-items:baseline; }}
  .phase h2 {{ font-size:15px; margin:0; }}
  .count {{ color:var(--muted); font-variant-numeric:tabular-nums; }}
  .bar {{ height:8px; background:var(--border); border-radius:4px; overflow:hidden; margin:10px 0; }}
  .fill {{ height:100%; background:var(--fill); transition:width .3s; }}
  details summary {{ cursor:pointer; color:var(--muted); font-size:13px; }}
  ul {{ list-style:none; padding:0; margin:8px 0 0; }}
  li {{ padding:4px 0; border-top:1px solid var(--border); font-size:13px; }}
  li.done {{ color:var(--muted); text-decoration:line-through; }}
  li .id {{ font-family:ui-monospace, monospace; color:var(--accent); margin-right:6px; }}
  li.done .id {{ color:var(--muted); }}
  .ts {{ float:right; font-family:ui-monospace, monospace; font-size:11px; color:var(--muted); }}
  .chart {{ background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px 20px; margin-bottom:24px; }}
  svg text {{ font-size:11px; fill:var(--muted); }}
</style></head>
<body><main>
<h1>Pricing modeler build</h1>
<div class="sub">Started {esc(started_at)}. Rendered {datetime.now(timezone.utc).isoformat(timespec="seconds")}. Refreshes every minute.</div>
<div class="counter"><span class="big">{done} / {total}</span><span>boxes ticked ({int(round(100*done/total)) if total else 0}%)</span></div>
<div class="chart"><h2 style="font-size:15px;margin:0 0 8px">Boxes ticked over time</h2><svg id="chart" width="940" height="220"></svg></div>
{''.join(phase_rows)}
</main>
<script>
const series = {series_json};
const total = {total};
const svg = document.getElementById('chart');
const W = 940, H = 220, padL = 40, padR = 10, padT = 10, padB = 30;
if (series.length === 0) {{
  svg.innerHTML = '<text x="'+(W/2)+'" y="'+(H/2)+'" text-anchor="middle">No boxes ticked yet</text>';
}} else {{
  const t0 = new Date(series[0].t).getTime();
  const t1 = Math.max(new Date(series[series.length-1].t).getTime(), t0 + 60000);
  const x = t => padL + (W - padL - padR) * (new Date(t).getTime() - t0) / (t1 - t0);
  const y = n => H - padB - (H - padT - padB) * n / total;
  let d = 'M ' + x(series[0].t) + ' ' + y(0);
  let prev = 0;
  for (const p of series) {{ d += ' L ' + x(p.t) + ' ' + y(prev) + ' L ' + x(p.t) + ' ' + y(p.n); prev = p.n; }}
  const dots = series.map(p => '<circle cx="'+x(p.t)+'" cy="'+y(p.n)+'" r="2.5" fill="#2f9e6a"><title>'+p.id+' at '+p.t+'</title></circle>').join('');
  const gridY = [0, 0.25, 0.5, 0.75, 1].map(f => {{ const n = Math.round(total*f); return '<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+y(n)+'" y2="'+y(n)+'" stroke="#e2e5e9"/><text x="4" y="'+(y(n)+4)+'">'+n+'</text>'; }}).join('');
  const fmt = t => new Date(t).toLocaleTimeString([], {{hour:'2-digit', minute:'2-digit'}});
  svg.innerHTML = gridY + '<path d="'+d+'" fill="none" stroke="#1f6f4a" stroke-width="2"/>' + dots +
    '<text x="'+padL+'" y="'+(H-8)+'">'+fmt(series[0].t)+'</text><text x="'+(W-padR)+'" y="'+(H-8)+'" text-anchor="end">'+fmt(series[series.length-1].t)+'</text>';
}}
</script>
</body></html>"""
    out.write_text(html, encoding="utf-8")


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    checklist = Path(sys.argv[1]).resolve()
    root = checklist.parent
    progress_path = root / "progress.json"
    dashboard_path = root / "dashboard.html"

    phases = parse(checklist)
    progress = load_progress(progress_path)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    progress.setdefault("startedAt", now)
    first = progress.setdefault("firstTicked", {})
    for p in phases:
        for b in p["boxes"]:
            if b["ticked"] and b["id"] not in first:
                first[b["id"]] = now
    progress["lastRun"] = now
    progress["totals"] = {
        "boxes": sum(len(p["boxes"]) for p in phases),
        "ticked": sum(1 for p in phases for b in p["boxes"] if b["ticked"]),
    }
    progress_path.write_text(json.dumps(progress, indent=2), encoding="utf-8")
    render(phases, progress, dashboard_path, progress["startedAt"])
    t = progress["totals"]
    print(f"{t['ticked']} / {t['boxes']} boxes ticked. Wrote {dashboard_path.name} and {progress_path.name}.")


if __name__ == "__main__":
    main()
