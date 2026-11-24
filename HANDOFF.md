# Handoff

_Last updated 2026-11-24 evening by Claude on the Linux laptop._

## Mac: do this first
History on GitHub was rewritten on 2026-11-24 (owner's request: only `lensu-alex` as author, no Claude
co-author lines; files unchanged). The Mac's clone of `main` now looks diverged. If it has no local commits:
`git fetch && git reset --hard origin/main` (check `git log origin/main..main` is empty first; if not, rebase:
`git rebase origin/main`, the old copies drop out). Same for `~/.claude-sync`. Then `~/.claude-sync/install.sh`
once (turns off Claude attribution, sets git identity to the noreply address).

## State
- Last vision work (Mac, 2026-11-23/24): hive counter robust across cameras, top-down disc mode, team vs partner
  settled (chain → one-place-at-a-time → looks only when very clear). Details at the end of PLAN.md.
- Linux laptop works: `npm install`, `tsc -b`, vitest 14/14, helper native modules load.
- `check-all quick` on Linux (720p clips copied from the Mac), vs the Mac baseline in PLAN.md:

  | match | Linux volleys/tips, clear | Mac volleys/tips, clear |
  |---|---|---|
  | or1 | 34/6, 29 | 36/6, 29 |
  | or5 | 40/6, 36 | 40/6, 35 |
  | or9 | 46/7, 34 | 44/7, 28 |
  | or18 | 42/14, 34 | 43/14, 39 |
  | q10 | 22/5, 18 | 24/5, 21 |
  | m1 | 12/2, 10 | 13/2, 9 |
  | nlron | 5/1, 4 | 5/0, 4 |
  | micoq | 3/1, 1 | 3/1, 1 |

  Same code and models, yet volleys differ by up to ±2 and "clear shooter" by up to ±6: decoding (ffmpeg build)
  and float differences (onnxruntime x86 vs ARM) flip borderline thresholds. **Compare regressions on the same
  machine only**; the Linux numbers above are the Linux baseline. The clear-shooter count being this sensitive is
  itself worth a look (margins sit close to the 0.6 cut).
- GPU (Linux, RTX 3050 4 GB): `tools/.venv` (uv, Python 3.12) has PyTorch with CUDA, ultralytics, albumentations,
  opencv, yt-dlp. A 3-epoch YOLO11n test trained on the GPU (0.6 GB peak). `tools/train.py` now picks
  CUDA / MPS / CPU automatically (`FTC_DEVICE`, `FTC_BATCH` override). The app/helper still run on CPU on purpose
  (lightweight rule, PLAN §0.1).

## Machines
- Linux laptop (`omarchy`): Tailscale `100.79.183.64`, project at `~/Projects/ftc-scout`. Has: tools/clips (all),
  tools/clips1080 (partial), tools/.venv (CUDA). Missing: tools/models, tools/gt/*, tools/frames, tools/dataset.
- Mac (`lensus-macbook-air`, Tailscale `100.102.240.7`): project at `~/Developer/ftc-scout`, has all the data.

## Next
1. With the Mac awake: on Linux `proj data pull` (missing .sync-data folders), and `proj data pull tools/dataset`
   (1.9 GB) before training on the GPU: `cd tools && FTC_BATCH=16 .venv/bin/python train.py <name> <base.pt> 640`.
2. Open vision items (PLAN.md): Netherlands-type high-angle camera still over-counts (5 volleys, true ~2);
   ~15% of volleys stay possible-for-both robots; clear-shooter margins are fragile (see table).
3. Later phases: field coordinates for heatmaps, shared results database (PLAN §5, §6 phase 8).
