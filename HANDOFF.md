# Handoff

_Last updated 2026-11-25 ~01:20 on the Linux laptop. Owner switching to the Mac (Linux laptop too loud)._

## Mac: start here
- `git pull` in `~/Developer/ftc-scout` (the Mac copy was moved to the rewritten history on 2026-11-24; should
  fast-forward). If the labelling server from yesterday is still running (`pgrep -f "serve.py 8765"`), it can stay
  or be stopped; `tools/gt/shooters/labels.json` may have new answers: commit them if so.
- `~/.claude-sync`: if the SessionStart hook says it diverged, it was rewritten on GitHub (no Claude co-author lines):
  `cd ~/.claude-sync && git fetch && git reset --hard origin/main` (only if `git status` shows no local changes),
  then `./install.sh` once (attribution off, git identity = lensu-alex noreply).

## What happened tonight (details: last entries of PLAN.md)
1. **Shooter attribution is unreliable** (owner's labels, or18: right 3-9 of 16 depending on machine/version;
   "clear" confidence not calibrated). Labelling page `tools/gt/shooters` (`python3 serve.py 8765`), 28 clips
   left (or5, or9); score with `python3 score.py labels.json linold:dumps macold:dumps`.
2. **Hive tips**: official tips per alliance are truth we have for free (`tools/gt/tips.json`, 11 clips).
   The yellow-area counter misses ~20% of tips. New `seesawFlips()` in `app/src/vision/hive.ts` watches the
   see-saw flip between its two positions: |error| 9 vs 14 on 8 matches, perfect on or18/or1/or5.
   Hive samples now also carry `shape` (12x12) and `look` (16x16) of the see-saw (computed every sample, cheap).

## Next (in order)
1. Cache all 11 clips on the Mac (`cd app && scripts/cache-all.sh /tmp/ftc-cache`, ~15-20 min) and run
   `npx tsx scripts/eval-tips.ts ../tools/gt/tips.json /tmp/ftc-cache`. The last 3 (micoq21, alatq4, iadaim10)
   were never cached; Mac numbers may differ a little from Linux.
2. Fix the misses: q10 blue (0 of 5 found), or9 red (5/6); false flips on nlron blue (+2) and micoq blue (+1),
   hives that never tipped (a "second position" was made from noise: require a minimum separation, or a
   minimum quality, before trusting any flip).
3. Wire it in (`analyzeMatch.ts`, where `hiveEvents` is called): when the see-saw split is clean, tips = flips;
   count volleys only inside each stable position (a flip changes the view of the cell: the level jump at a flip
   is not balls). That should also fix wrong ball counts per volley (the owner noticed them).
   Then re-run `check-all quick` and record the new baseline.
4. Ball counts per volley: no truth yet. The official `dcHivePollenNectar` (elements in the hive at the end) is a
   weak check on the final level. The AprilTag panel hides half the row in one position: with the position now
   known, calibrate one ball's area per position.
5. Shooter attribution rework against the owner's labels (more labels on or5/or9 first).

## Machines
- Linux laptop (`omarchy`, Tailscale `100.79.183.64`): `~/Projects/ftc-scout`, all data + `tools/.venv` (CUDA,
  RTX 3050). Caches from tonight are only in its `/tmp/ftc-night/cache` (8 matches; regenerate on the Mac).
- Mac (`lensus-macbook-air`, Tailscale `100.102.240.7`): `~/Developer/ftc-scout`, all data.
