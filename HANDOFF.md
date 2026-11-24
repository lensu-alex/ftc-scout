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
  Remote Login is on and accepts the Linux key. claude-sync installed 2026-11-24 (`paths.local` points ftc-scout at
  `~/Developer/ftc-scout`; `proj` on PATH via `~/.zprofile`).

## Next
1. Get the clips onto the Linux laptop (owner chose: Mac Remote Login, Linux pulls). **Mac side is ready** (2026-11-24):
   Remote Login on, the Linux key (from github.com/lensu-alex.keys) is in `~/.ssh/authorized_keys`, `lensu` is allowed
   to SSH in, data present (~860 MB: clips 275M, clips1080 164M, models 180M, gt/frames 119M, gt/grid 122M, frames 2M).
   **On Linux** (Mac must be awake and on the same Wi-Fi; it idle-sleeps after 1 min, so keep it awake during the copy):
   ```
   ssh lensu@192.168.1.102 true                                   # first time: accept the host key
   ssh lensu@192.168.1.102 'caffeinate -i -t 1800' &              # keeps the Mac awake 30 min
   tools/sync-data.sh pull lensu@192.168.1.102 Developer/ftc-scout
   ```
   then run `check-all quick` and compare with the Mac baseline above (should match: same code, same models).
   - If the IP doesn't answer: the Mac's IP can change; try `Lensus-MacBook-Air.local` or ask the owner to run
     `ipconfig getifaddr en0` on the Mac.
   - The Mac's rsync is Apple's `openrsync` (protocol 29). It accepted the script's flags locally but wasn't tested
     against Linux rsync. If the pull errors out with a protocol error, use `scp -r` or `sftp` for the folders as a
     fallback, or ask the owner to `brew install rsync` on the Mac and add `--rsync-path=/opt/homebrew/bin/rsync`.
   - `~/.ftc-scout/config.json` (API key) is not synced on purpose; copy it by hand if needed.
2. Open vision items (from PLAN.md): Netherlands-type high-angle camera still over-counts (5 volleys, true ~2);
   ~15% of volleys stay possible-for-both robots; disc counter only for top-down cameras.
3. Later phases: field coordinates for heatmaps, shared results database (PLAN §5, §6 phase 8).
