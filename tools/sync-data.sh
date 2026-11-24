#!/usr/bin/env bash
# Copy the large, gitignored dev data (clips, models, ground-truth frames, ...) between two machines
# over SSH. Works on macOS and Linux; only copies what is missing or changed, never deletes.
#
#   tools/sync-data.sh push <user@host> [remote project path]   this machine -> other
#   tools/sync-data.sh pull <user@host> [remote project path]   other -> this machine
#   ALL=1 tools/sync-data.sh ...                                 also datasets, training runs, debug output
#
# The remote project path defaults to ~/Projects/ftc-scout. The other machine needs SSH on
# (macOS: System Settings > General > Sharing > Remote Login; Linux: sudo systemctl enable --now sshd).
# Not copied on purpose: ~/.ftc-scout/config.json (API key) — copy that by hand if you want it.
set -euo pipefail
dir="${1:-}"; host="${2:-}"; remote="${3:-Projects/ftc-scout}"
[[ "$dir" == push || "$dir" == pull ]] && [ -n "$host" ] || { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
cd "$(dirname "$0")/.."

paths=(tools/clips tools/clips1080 tools/models tools/gt/frames tools/gt/grid tools/frames)
[ "${ALL:-}" = 1 ] && paths+=(tools/dataset tools/runs tools/debug)

for p in "${paths[@]}"; do
  if [ "$dir" = push ]; then
    [ -e "$p" ] || continue
    echo "→ $p"
    ssh "$host" "mkdir -p '$remote/$p'"
    rsync -az --partial "$p/" "$host:$remote/$p/"
  else
    echo "← $p"
    mkdir -p "$p"
    rsync -az --partial "$host:$remote/$p/" "$p/" || echo "  (not on the other machine, skipped)"
  fi
done
echo "done"
