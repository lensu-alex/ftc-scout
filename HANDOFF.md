# Handoff

_Last updated 2026-11-24 by Claude on the Mac._

## State
- Last vision work (Mac, 2026-11-23/24 overnight): hive counter robust across cameras, top-down disc mode,
  team vs partner settled (chain → one-place-at-a-time → looks only when very clear). Latest regression
  baseline is at the end of PLAN.md (`check-all quick`: or1 36/6, or5 40/6, or9 44/7, or18 43/14, q10 24/5,
  m1 13/2, nlron 5/0, micoq 3/1).
- Linux laptop set up (2026-11-24): clone at `~/Projects/ftc-scout`, `npm install` fine, `tsc -b` clean,
  vitest 14/14, onnxruntime-node + sharp + ffmpeg-static load. **No dev data here yet** (clips/models only on the Mac),
  so `check-all` reports the clips as missing.
- Added `tools/sync-data.sh` (rsync the gitignored data over SSH, either direction) and made
  `tools/train.py`, `tools/more_data*.sh` path-independent (were hard-coded to the Mac).

## Machines
- Linux laptop: `lensu@192.168.1.106`, project at `~/Projects/ftc-scout`, no SSH server (needs sudo).
- Mac: `lensu@192.168.1.102` (LAN IP, may change with DHCP; check `ipconfig getifaddr en0`), project at `~/Developer/ftc-scout`.
  Remote Login is on. claude-sync installed 2026-11-24 (`paths.local` points ftc-scout at `~/Developer/ftc-scout`).

## Next
1. Get the clips onto the Linux laptop (owner chose: Mac Remote Login, Linux pulls). **Mac to-do** (for Claude on the Mac,
   after the owner switches on System Settings > General > Sharing > Remote Login):
   - trust the Linux laptop's key (it's the only key on the GitHub account, comment `lensu@omarchy`):
     `mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && curl -fsS https://github.com/lensu-alex.keys | grep -vxFf ~/.ssh/authorized_keys >> ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys`
   - write the Mac's `whoami` and LAN IP (`ipconfig getifaddr en0`) here under "Machines", commit, push. **Done.**
   - **Still open:** the key step above isn't done yet (Claude's safety check blocked it; the owner runs it by hand).
     Check with `grep -c . ~/.ssh/authorized_keys` on the Mac.
   Then on Linux: `tools/sync-data.sh pull <mac-user>@<mac-ip> Developer/ftc-scout`, run `check-all quick`,
   compare with the Mac baseline (should match: same code, same models).
2. Open vision items (from PLAN.md): Netherlands-type high-angle camera still over-counts (5 volleys, true ~2);
   ~15% of volleys stay possible-for-both robots; disc counter only for top-down cameras.
3. Later phases: field coordinates for heatmaps, shared results database (PLAN §5, §6 phase 8).
