#!/usr/bin/env python3
"""Mid-build check-in aggregator.

Reads every surface's CHECKLIST.md, progress.json, seed, types, engine, and tokens,
optionally runs build and test, and writes:
  checkin/status.json     machine readable
  shared/STATUS.md        human readable, committed
  checkin/index.html      the check-in hub (open via checkin/start.sh)

Usage: python3 checkin/build_status.py [--run-builds]
No em dashes in any output.
"""
import json, os, re, subprocess, sys, hashlib, html, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SURFACES = [
    # key, label, persona, port, entry path, one-line purpose
    ("storefront", "Prospective customer storefront", "Customer", 5173, "/", "Address first. Public price, fee stack, pay first cycle, account and delivery order created atomically."),
    ("account", "Account tracker: account view", "Office", 5199, "/account", "One screen that answers a phone call. Services, price source, balance, events, requests, four actions."),
    ("billing", "Account tracker: billing run", "Office", 5179, "/billing", "Batch summary, exception queue, approve, edit, waive with reason, post and lock, leakage tile."),
    ("pricing", "Pricing modeler", "Owner", 5180, "/pricing", "Ratebook by line of business, rate versions, blast radius preview, publish, quote workbench."),
    ("portal", "Customer portal", "Customer", 5175, "/", "Invoices, pay, autopay, extra pickup, vacation hold, cart change, missed pickup report."),
    (".", "Merged app", "All personas", 5200, "/", "One Vite app at the repo root: persona switcher, one store, one seed, the five surfaces wired together."),
]
RUN_BUILDS = "--run-builds" in sys.argv

BOX = re.compile(r"^\s*- \[([ xX])\]\s*(.*)$")
HEAD = re.compile(r"^(#{1,3})\s+(.*)$")

def parse_checklist(path):
    phases, cur = [], None
    for line in open(path, encoding="utf-8"):
        h = HEAD.match(line)
        if h:
            title = h.group(2).strip()
            if re.match(r"(?i)phase\s*\d", title):
                cur = {"title": title, "done": 0, "total": 0, "open": []}
                phases.append(cur)
            else:
                cur = None
            continue
        b = BOX.match(line)
        if b and cur is not None:
            cur["total"] += 1
            if b.group(1).lower() == "x":
                cur["done"] += 1
            else:
                cur["open"].append(b.group(2).strip())
    return phases

def md5(path):
    try:
        return hashlib.md5(open(path, "rb").read()).hexdigest()[:8]
    except FileNotFoundError:
        return None

def types_body(path):
    """md5 of types.ts ignoring leading comment lines and trailing whitespace."""
    try:
        lines = [l.rstrip() for l in open(path, encoding="utf-8")]
    except FileNotFoundError:
        return None
    while lines and (lines[0].startswith("//") or lines[0] == ""):
        lines.pop(0)
    body = re.sub(r"\s+", "", "\n".join(l for l in lines if not l.strip().startswith("//")))
    body = body.replace(";}", "}")  # formatting only: trailing semicolon before a closing brace
    return hashlib.md5(body.encode()).hexdigest()[:8]

def run(cmd, cwd):
    try:
        p = subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=300)
        return p.returncode, (p.stdout + p.stderr)[-2000:]
    except Exception as e:
        return 1, str(e)

def load_seed(surface, names):
    for n in names:
        p = os.path.join(ROOT, surface, "src", "seed", n)
        if os.path.exists(p):
            d = json.load(open(p))
            if isinstance(d, list):
                return d
            if isinstance(d, dict) and "id" in d:
                return [d]
            if isinstance(d, dict):
                return d.get("items") or list(d.values())
    return None

def seed_ids(surface, names):
    d = load_seed(surface, names)
    return set(x.get("id") for x in d if isinstance(x, dict)) if d else None

SHARED_TABLES = {
    "accounts": ["accounts.json", "billing-accounts.json"],
    "catalog": ["catalog.json", "service-catalog.json"],
    "zones": ["zones.json"], "routes": ["routes.json"], "quotes": ["quotes.json"],
    "feeRules": ["feeRules.json", "fee-rules.json"],
}
DERIVED_TABLES = {
    "rateVersions": ["rateVersions.json", "rate-versions.json"],
    "serviceItems": ["serviceItems.json", "service-items.json"],
    "invoices": ["invoices.json"], "charges": ["charges.json"], "payments": ["payments.json"],
}

canon_types = types_body(os.path.join(ROOT, "shared", "types.ts"))
# Carry forward the last build and test results when this run does not rebuild.
prev = {}
try:
    prev = {x["key"]: x for x in json.load(open(os.path.join(ROOT, "checkin", "status.json")))["surfaces"]}
except Exception:
    pass
now = datetime.datetime.now().astimezone().isoformat(timespec="minutes")
status = {"generatedAt": now, "surfaces": [], "drift": {}}

for key, label, persona, port, entry, purpose in SURFACES:
    d = os.path.normpath(os.path.join(ROOT, key))
    if not os.path.exists(os.path.join(d, "CHECKLIST.md")):
        continue
    phases = parse_checklist(os.path.join(d, "CHECKLIST.md"))
    done = sum(p["done"] for p in phases); total = sum(p["total"] for p in phases)
    current = next((p for p in phases if p["done"] < p["total"]), None)
    last_done = None
    pj = os.path.join(d, "progress.json")
    if os.path.exists(pj):
        try:
            vals = list(json.load(open(pj)).values())
            vals = [v for v in vals if isinstance(v, str)]
            last_done = max(vals) if vals else None
        except Exception:
            pass
    skey = "merged" if key == "." else key
    s = {
        "key": skey, "label": label, "persona": persona, "port": port, "entry": entry, "purpose": purpose,
        "url": f"http://localhost:{port}{entry}",
        "done": done, "total": total, "pct": round(100 * done / total) if total else 0,
        "phases": phases,
        "currentPhase": current["title"] if current else "All phases complete",
        "nextBoxes": current["open"][:6] if current else [],
        "lastTick": last_done,
        "typesMatchesShared": types_body(os.path.join(d, "src", "types.ts")) == canon_types,
        "tokensMd5": md5(os.path.join(d, "src", "styles", "tokens.css")),
        "engineLines": sum(1 for _ in open(os.path.join(d, "src", "store", "engine.ts"))) if os.path.exists(os.path.join(d, "src", "store", "engine.ts")) else 0,
        "hasDist": os.path.isdir(os.path.join(d, "dist")),
        "screenshot": f"shots/{skey}.png" if os.path.exists(os.path.join(ROOT, "checkin", "shots", f"{skey}.png")) else None,
        "build": None, "test": None,
    }
    if not RUN_BUILDS and key in prev:
        s["build"], s["test"] = prev[key].get("build"), prev[key].get("test")
    if RUN_BUILDS and not os.path.exists(os.path.join(d, "package.json")):
        s["build"] = {"ok": False, "tail": "no package.json yet"}; s["test"] = None
    elif RUN_BUILDS:
        rc, out = run("npm run build", d); s["build"] = {"ok": rc == 0, "tail": out[-600:]}
        rc, out = run("npm test", d)
        m = re.search(r"Tests\s+(\d+) passed", out)
        s["test"] = {"ok": rc == 0, "passed": int(m.group(1)) if m else None, "tail": out[-600:]}
    status["surfaces"].append(s)

# Seed drift across surfaces
keys = [s[0] for s in SURFACES if s[0] != "."]
for group, tables in (("shared", SHARED_TABLES), ("derived", DERIVED_TABLES)):
    for t, names in tables.items():
        sets = {k: seed_ids(k, names) for k in keys}
        present = [v for v in sets.values() if v]
        inter = set.intersection(*present) if present else set()
        union = set.union(*present) if present else set()
        status["drift"][t] = {"group": group, "counts": {k: (len(v) if v is not None else None) for k, v in sets.items()},
                              "sharedIds": len(inter), "unionIds": len(union)}

json.dump(status, open(os.path.join(ROOT, "checkin", "status.json"), "w"), indent=2)

# STATUS.md
L = [f"# Status (generated {now})", "", "Generated by checkin/build_status.py. Do not edit. Regenerate with `python3 checkin/build_status.py` (add --run-builds to run npm build and test per surface).", "",
     "| Surface | Persona | Boxes | Current phase | Types = shared | Build | Tests | URL |", "|---|---|---|---|---|---|---|---|"]
for s in status["surfaces"]:
    b = "not run" if s["build"] is None else ("pass" if s["build"]["ok"] else "FAIL")
    t = "not run" if s["test"] is None else (f"{s['test']['passed']} pass" if s["test"]["ok"] else "FAIL")
    L.append(f"| {s['key']} | {s['persona']} | {s['done']}/{s['total']} ({s['pct']}%) | {s['currentPhase']} | {'yes' if s['typesMatchesShared'] else 'NO'} | {b} | {t} | {s['url']} |")
L += ["", "## Per-phase", ""]
for s in status["surfaces"]:
    L.append(f"### {s['key']}")
    for p in s["phases"]:
        bar = "#" * round(20 * p["done"] / p["total"]) if p["total"] else ""
        L.append(f"- {p['title']}: {p['done']}/{p['total']} `{bar:<20}`")
    if s["nextBoxes"]:
        L.append("- Next up:")
        for b in s["nextBoxes"]:
            L.append(f"  - {b}")
    L.append("")
L += ["## Seed drift", "", "Shared tables must agree on ids across all five. Derived tables are allowed to differ until merge (addendum D2).", "",
      "| Table | Group | " + " | ".join(keys) + " | Shared ids / union |", "|---|---|" + "---|" * len(keys) + "---|"]
for t, v in status["drift"].items():
    L.append(f"| {t} | {v['group']} | " + " | ".join(str(v['counts'][k] if v['counts'][k] is not None else '-') for k in keys) + f" | {v['sharedIds']}/{v['unionIds']} |")
open(os.path.join(ROOT, "shared", "STATUS.md"), "w").write("\n".join(L) + "\n")

# index.html hub
def esc(x): return html.escape(str(x))
cards = []
for s in status["surfaces"]:
    ph = "".join(
        f'<div class="ph"><div class="ph-t"><span>{esc(p["title"])}</span><span>{p["done"]}/{p["total"]}</span></div>'
        f'<div class="bar"><i style="width:{(100*p["done"]/p["total"]) if p["total"] else 0:.0f}%"></i></div></div>'
        for p in s["phases"])
    nxt = "".join(f"<li>{esc(b)}</li>" for b in s["nextBoxes"])
    shot = f'<a class="shot" href="{s["url"]}" target="_blank"><img src="{s["screenshot"]}" alt="{esc(s["label"])} screenshot"></a>' if s["screenshot"] else f'<a class="shot empty" href="{s["url"]}" target="_blank">No screenshot yet. Open the surface.</a>'
    flags = []
    if not s["typesMatchesShared"]: flags.append("types.ts differs from shared/types.ts")
    if s["build"] and not s["build"]["ok"]: flags.append("build failing")
    if s["test"] and not s["test"]["ok"]: flags.append("tests failing")
    fl = "".join(f'<span class="flag">{esc(f)}</span>' for f in flags) or '<span class="flag ok">no drift flags</span>'
    tests = "" if not s["test"] else (f'{s["test"]["passed"]} tests pass' if s["test"]["ok"] else "tests FAIL")
    build = "" if not s["build"] else ("build ok" if s["build"]["ok"] else "build FAIL")
    cards.append(f'''
<section class="card" id="{s["key"]}">
  <header>
    <div><span class="persona">{esc(s["persona"])}</span><h2>{esc(s["label"])}</h2><p class="purpose">{esc(s["purpose"])}</p></div>
    <div class="big">{s["pct"]}%<small>{s["done"]}/{s["total"]} boxes</small></div>
  </header>
  {shot}
  <div class="meta"><a class="btn" href="{s["url"]}" target="_blank">Open :{s["port"]}</a> <span>{esc(s["currentPhase"])}</span> <span class="dim">{esc(build)} {esc(tests)}</span></div>
  <div class="flags">{fl}</div>
  <div class="phases">{ph}</div>
  <details><summary>Next boxes in the current phase</summary><ul>{nxt or "<li>none</li>"}</ul></details>
</section>''')

drift_rows = "".join(
    f"<tr class='{v['group']}'><td>{esc(t)}</td><td>{v['group']}</td>" + "".join(f"<td>{v['counts'][k] if v['counts'][k] is not None else '-'}</td>" for k in keys) + f"<td><b>{v['sharedIds']}</b>/{v['unionIds']}</td></tr>"
    for t, v in status["drift"].items())
tot_done = sum(s["done"] for s in status["surfaces"]); tot = sum(s["total"] for s in status["surfaces"])
page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TrashLab check-in</title>
<style>
:root{{--bg:#F7F7FF;--surface:#fff;--ink:#1A174F;--muted:#6B7194;--brand:#312D97;--line:#E4E4F4;--ok:#1F6F5F;--warn:#B0402C;--warn-soft:#F7E3DE;--ok-soft:#E1EFEA}}
*{{box-sizing:border-box}}body{{margin:0;font:14px/1.45 Manrope,Inter,system-ui,sans-serif;background:var(--bg);color:var(--ink)}}
.top{{background:var(--brand);color:#fff;padding:18px 32px;display:flex;align-items:baseline;gap:18px;flex-wrap:wrap}}
.top h1{{margin:0;font-size:20px}}.top .dim{{opacity:.75}}.top a{{color:#fff}}
main{{padding:24px 32px;max-width:1500px;margin:0 auto}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:20px}}
.card{{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:12px}}
.card header{{display:flex;justify-content:space-between;gap:12px}}.card h2{{margin:2px 0 4px;font-size:17px}}
.persona{{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--brand)}}
.purpose{{margin:0;color:var(--muted);font-size:13px}}
.big{{font-size:30px;font-weight:800;text-align:right;line-height:1}}.big small{{display:block;font-size:11px;font-weight:500;color:var(--muted);margin-top:4px}}
.shot{{display:block;border:1px solid var(--line);border-radius:8px;overflow:hidden;aspect-ratio:16/10;background:#eee}}.shot img{{width:100%;height:100%;object-fit:cover;object-position:top}}
.shot.empty{{display:flex;align-items:center;justify-content:center;color:var(--muted);text-decoration:none}}
.meta{{display:flex;gap:12px;align-items:center;flex-wrap:wrap}}.dim{{color:var(--muted)}}
.btn{{background:var(--brand);color:#fff;text-decoration:none;padding:6px 12px;border-radius:999px;font-weight:700;font-size:13px}}
.flags{{display:flex;gap:6px;flex-wrap:wrap}}.flag{{background:var(--warn-soft);color:var(--warn);padding:2px 8px;border-radius:999px;font-size:12px}}.flag.ok{{background:var(--ok-soft);color:var(--ok)}}
.ph{{margin:4px 0}}.ph-t{{display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}}
.bar{{height:6px;background:var(--line);border-radius:3px;overflow:hidden}}.bar i{{display:block;height:100%;background:var(--brand)}}
details summary{{cursor:pointer;color:var(--brand);font-weight:600}}details ul{{margin:6px 0 0;padding-left:18px;color:var(--muted)}}
table{{border-collapse:collapse;background:var(--surface);border:1px solid var(--line);border-radius:12px;width:100%;font-size:13px}}th,td{{padding:8px 12px;text-align:left;border-bottom:1px solid var(--line)}}th{{color:var(--muted);font-weight:600}}
tr.shared td:first-child{{font-weight:700}}
h3{{margin:32px 0 10px}}.docs{{display:flex;gap:10px;flex-wrap:wrap}}.docs a{{background:var(--surface);border:1px solid var(--line);padding:8px 12px;border-radius:8px;color:var(--brand);text-decoration:none;font-weight:600}}
</style></head><body>
<div class="top"><h1>TrashLab check-in</h1><span>{tot_done}/{tot} boxes across five surfaces</span><span class="dim">generated {esc(now)}</span><span class="dim">regenerate: python3 checkin/build_status.py --run-builds</span></div>
<main>
<div class="docs"><a href="../shared/README.md">shared/README.md</a><a href="../shared/CONTRACT_ADDENDUM.md">CONTRACT_ADDENDUM.md</a><a href="../shared/OWNERSHIP.md">OWNERSHIP.md</a><a href="../shared/STATUS.md">STATUS.md</a><a href="../shared/DECISIONS_SYNTHESIS.md">DECISIONS_SYNTHESIS.md</a><a href="../shared/RESUME_PROMPT.md">RESUME_PROMPT.md</a></div>
<h3>Surfaces</h3>
<div class="grid">{"".join(cards)}</div>
<h3>Seed id drift</h3>
<p class="dim">Shared tables must agree on ids across all five. Derived tables may differ until the merge regenerates them from billing's generator (addendum D2).</p>
<table><thead><tr><th>Table</th><th>Group</th>{"".join(f"<th>{k}</th>" for k in keys)}<th>Shared / union</th></tr></thead><tbody>{drift_rows}</tbody></table>
</main></body></html>'''
open(os.path.join(ROOT, "checkin", "index.html"), "w").write(page)
print(f"wrote checkin/status.json, shared/STATUS.md, checkin/index.html ({tot_done}/{tot} boxes)")
