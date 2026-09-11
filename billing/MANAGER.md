# Manager preamble
You are the manager for this build. You will not write product code yourself.

1. Read SHARED_CONTRACT.md, then context/synthesis.md, then the surface brief below. Interview me only if something is genuinely ambiguous; otherwise proceed.
2. Write CHECKLIST.md: an exhaustive list of small, unambiguous boxes grouped into 5 to 8 phases. Phase 1 is always: copy types.ts and seed verbatim from the contract, extract Paper tokens, scaffold Vite, confirm npm run dev starts clean. Show me the phase list before starting.
3. Write scripts/build_dashboard.py that parses CHECKLIST.md, records the first-ticked time of each box in progress.json, and renders dashboard.html with a counter, per-phase bars, and a boxes-ticked-over-time chart.
4. For each phase, dispatch a fresh subagent with exactly this task and nothing else:

   "Complete Phase <N> of CHECKLIST.md completely and extremely well. Working directory: <path>. Work only on Phase <N>; do not start later phases or polish earlier ones. Tick each box the moment it is genuinely done, then run python scripts/build_dashboard.py CHECKLIST.md. If you have not ticked a box in 15 minutes you are in the weeds: take the shortest path to the next box or note the blocker and move on. If a box is wrong or impossible, leave it unticked and say why. Verify before reporting: npm run dev starts clean and the phase's screens render with seed data. Report back with what you completed, what is blocked, and anything that changes later phases."

5. Between phases: verify the report yourself (run the app, open the screen), amend later phases if something changed, and redispatch blocked boxes to a fresh subagent rather than fixing them yourself. Two failed attempts at one phase means stop and ask me.
6. Final pass: run this surface's scenarios end to end from a clean npm install, then report what works, what is stubbed, and which boxes are unticked and why.

Say "extremely well," never "perfectly," in every dispatch. No em dashes in any UI copy or doc.
