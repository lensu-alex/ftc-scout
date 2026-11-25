# Handoff

_Last updated 2026-11-25 ~02:50 on the Mac (owner asleep, night run in progress)._

## State
- Hive tips now come from the see-saw's flips (`seesawFlips` / `hiveTimeline` in `app/src/vision/hive.ts`, used by
  `analyzeMatch`). Volleys are read only inside each stable see-saw position; one ball's area per position.
- Tips vs official on all 11 cached clips (`eval-tips.ts`): see-saw |error| 6 (was 22), area counter 18.
  `check-all quick` (8 matches): tips |error| 4 (was 11). Details + dead ends: PLAN.md, 2026-11-25 (night, Mac).
- Ball counts per volley are still ~half of what 12808 launched in or1 (owner's marks): unknown how much is misses.

## Next
1. Remaining tip errors are top-down/far cameras (nlron, micoq blue, iadaim10) and a tip at the buzzer (or9 red).
2. Ball counts per volley (no scored-ball truth yet).
3. Shooter attribution: needs more owner labels (or5/or9, `tools/gt/shooters`, `python3 serve.py 8765`).

## Machines
- Mac: `~/Developer/ftc-scout`, all data. Caches of all 11 clips in `/tmp/ftc-cache` (regenerate with
  `cd app && scripts/cache-all.sh /tmp/ftc-cache`, ~2 min per match).
- Linux laptop (`omarchy`, Tailscale `100.79.183.64`): `~/Projects/ftc-scout`, all data + `tools/.venv` (CUDA).
