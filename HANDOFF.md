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
  Reach it over Tailscale (name from `tailscale status`). Remote Login is on and accepts the Linux key. claude-sync installed 2026-11-24 (`paths.local` points ftc-scout at
  `~/Developer/ftc-scout`; `proj` on PATH via `~/.zprofile`).

## Next
1. Get the clips onto the Linux laptop. **Now over Tailscale (works on any network), not the LAN IP.**
   Data copying moved into claude-sync: folders listed in `.sync-data`, copied with `proj data pull|push`; the
   SessionStart hook prints a `[data]` line in every project with a `.sync-data`; the global `sync-data` skill
   says how to fetch and troubleshoot. `tools/sync-data.sh` is now a wrapper for `proj data`.
   Mac side ready: Remote Login on, Linux key in `authorized_keys`, data present (~860 MB).
   Mac still needs (owner, needs their password): `brew install --cask tailscale-app`, open Tailscale, log in.
   **On Linux** (owner runs the sudo lines, same Tailscale account as the Mac):
   ```
   proj sync                                              # gets the new proj + sync-data skill
   sudo pacman -S --needed tailscale rsync && sudo systemctl enable --now tailscaled
   sudo tailscale up --ssh                                # --ssh: lets the Mac reach Linux too, no sshd needed
   tailscale status                                       # the Mac should be listed
   cd ~/Projects/ftc-scout && proj data pull              # Mac must be on; it's kept awake during the copy
   ```
   then `check-all quick` and compare with the Mac baseline above (should match: same code, same models).
   Bigger optional folders, only if needed: `proj data pull tools/dataset` (1.9G), `tools/runs`, `tools/debug` (1.6G).
   `~/.ftc-scout/config.json` (API key) is not synced on purpose.
2. Open vision items (from PLAN.md): Netherlands-type high-angle camera still over-counts (5 volleys, true ~2);
   ~15% of volleys stay possible-for-both robots; disc counter only for top-down cameras.
3. Later phases: field coordinates for heatmaps, shared results database (PLAN §5, §6 phase 8).
