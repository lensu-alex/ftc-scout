# Handoff

_Last updated 2026-11-25 ~05:30 on the Mac (night run, owner asleep)._

## Morning summary (2026-11-25 night)
**Improved**
- Hive tips from the see-saw: |error| vs official tips on the 10 full clips **22 → 4** (area counter: 16).
  Two general changes: split the see-saw pictures along their main direction of change (q10 blue 0 → 5 of 5), and
  on side cameras a flip only counts if the cell held ≥ 2 balls' worth of yellow (people standing behind the hive
  made 8 fake flips on Alabama Q4). The 2-ball threshold was fitted on the same clips (1.5 / 2 / 2.5 give 8 / 6 / 6).
- Wired into the app (`hiveTimeline`): tips = flips, volleys read only inside each stable see-saw position.
  `check-all quick` tips |error| **11 → 4** on 8 matches (it now prints official tips next to ours).
  or1 marked 12808 volleys found 12 → 13 of 15.

**Didn't improve / found out**
- Ball counts per volley are still about half of what was launched (or1: marked 4, counted 1-2). The frames show
  why: in one see-saw position the tag panel hides the balls once they roll behind it; in the other they overlap.
  The resting yellow is a lower bound. Per-position ball area, robot-cover filtering, watching past the buzzer,
  30 fps entry counting: all measured, none kept (PLAN.md lists each).
- Shooter attribution: still ~1/3 right on or18 (5/15). Why: the true shooter is often tracked but labelled with
  the other alliance (id switches), or not tracked at all. The evidence score itself is fine when the right robot
  is a candidate (5 of 7). One override rule kept, but its gain didn't hold up: unproven.
- iadaim10's clip ends 25 s before the match does: its tips can't be scored.

**Questions for you**
1. Could you label the 28 or5/or9 shooter clips (`cd tools/gt/shooters && python3 serve.py 8765`)? Everything on
   shooters is fitted on or18's 14 volleys until then. Dumps for the current code are ready (`dumps/*_mac1125.json`).
2. Ball counts: show them on the page as "at least N" (they are lower bounds), or keep plain numbers?
3. Worth a 30 fps burst at the hive cell after each rise to count balls going in (heavier, needs blob tracking)?
4. A tip at the buzzer: or1's frames show a tip at 159-160 s that the official count leaves out, so I stop at the
   buzzer. Does that match the rule as you know it?

## Next
1. Shooters: score or5/or9 labels with `python3 score.py labels.json mac1125:dumps`; the weak link is tracking /
   alliance labels (PLAN.md 2026-11-25 Mac entry).
2. Remaining tip errors: nlron +2, micoq blue +1 (far/top-down cameras), or9 red -1 (unexplained).

## Machines
- Mac: `~/Developer/ftc-scout`, all data. Caches of all 11 clips in `/tmp/ftc-cache` (regenerate with
  `cd app && scripts/cache-all.sh /tmp/ftc-cache`, ~2 min per match on the M5).
- Linux laptop (`omarchy`, Tailscale `100.79.183.64`): `~/Projects/ftc-scout`, all data + `tools/.venv` (CUDA).
