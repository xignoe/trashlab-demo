# TrashLab MVP, parallel build

Five surfaces are built in parallel by five agents against one contract, then merged.

| Folder | What | Persona | Port |
|---|---|---|---|
| storefront/ | Prospective customer storefront | Customer | 5173 |
| portal/ | Customer portal | Customer | 5175 |
| billing/ | Billing run and exception queue | Office | 5179 |
| pricing/ | Ratebook and quote workbench | Owner | 5180 |
| account/ | Account view | Office | 5199 |
| shared/ | The universal source of truth: contract addendum, ownership map, canonical types and tokens, generated status | | |
| checkin/ | Check-in hub and status aggregator | | 5170 |
| prompts/ | The original agent prompts, contract, manager preamble, merge brief | | |
| trashlab/ | Original brief and research context | | |

## Open what we have so far

```bash
bash checkin/start.sh
```

Then open http://localhost:5170/. It shows every surface's progress by phase, a screenshot, build and test state, drift flags, and a link to each running app. `python3 checkin/build_status.py --run-builds` regenerates it and shared/STATUS.md.

## Before resuming any agent

Paste shared/RESUME_PROMPT.md into the agent's session. It makes the agent read shared/CONTRACT_ADDENDUM.md and shared/OWNERSHIP.md, add the addendum boxes to its next phase, and continue.

## Rules
- Surface agents write only inside their own folder. shared/ is written by the check-in or merge agent only.
- prompts/ and trashlab/ are read-only inputs.
- No em dashes anywhere.

## Merged app (repo root)

The five prototypes merge into one Vite app at the repo root, following CHECKLIST.md. The prototype folders above stay
untouched as inputs and keep running on their own ports.

### Start

```bash
npm install
npm run dev        # http://localhost:5200/ (strictPort: fails instead of moving if 5200 is taken)
npm test           # vitest, src/** only
npm run build      # typecheck and production build into dist/
npm run seed       # regenerate src/seed/*.json from scripts/gen_seed.ts
bash scripts/deploy_pages.sh   # publish the built app to https://xignoe.github.io/trashlab-demo/
```

The hosted demo is a static build on GitHub Pages (repo xignoe/trashlab-demo, branch gh-pages). Only the built files are
pushed; source stays local. Rerun the deploy script after any change to update the live site.

In Claude Code, the `merged` configuration in .claude/launch.json runs the same dev server. All state is in memory:
reload or click **Reset seed** in the persona bar to return to the seed and the demo clock (Sep 10, 2026).

### Ports

| Port | What |
|---|---|
| 5200 | Merged app |
| 5170 | Check-in hub |
| 5173, 5175, 5179, 5180, 5199 | The five prototypes (storefront, portal, billing, pricing, account) |

### Routes

| Persona | Screen | Route |
|---|---|---|
| Owner | Ratebook | /owner/pricing |
| Office | Account view | /office/account/:accountId (defaults to acct_res_maple) |
| Office | Billing run | /office/billing (also where `/` lands) |
| Customer | Storefront | /customer/store/* |
| Customer | Portal | /customer/portal |

### Folder map

| Path | What |
|---|---|
| index.html, vite.config.ts, tsconfig.json, package.json | The app's build setup. Tailwind and vitest read only src/ |
| public/ | Static files: favicon.svg and the evidence photos under photos/ |
| scripts/gen_seed.ts | Seed generator (billing's, plus eventRates.extraPickup) |
| src/types.ts | The canonical types, shared/types.ts byte for byte |
| src/seed/ | The one seed: billing's JSON tables, plus addresses.json (storefront) and the photo resolver |
| src/store/ | The one engine (engine.ts), db binding, clock, selectors, and the single zustand store (useStore.ts) |
| src/store/slices/ | One slice per surface. types.ts is the contract every slice follows |
| src/styles/ | tokens.css (Paper tokens), theme.css (the theme bridge), shell.css, and surfaces/<name>.css per surface |
| src/shell/ | Persona bar, layout, route map, not-found screen, and the route test |
| src/surfaces/<name>/ | Each surface's screens, mounted inside its `.surface-<name>` wrapper |
| CHECKLIST.md | The merge plan, phase by phase |
| DECISIONS.md | The merge's judgment calls, each with the alternative and the reason |
| DESIGN.md | How the theme bridge lets five styles share one build |
