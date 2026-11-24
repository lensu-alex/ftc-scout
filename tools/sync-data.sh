#!/usr/bin/env bash
# Moved to claude-sync: the folders are listed in .sync-data and copied with `proj data`.
#   tools/sync-data.sh check|pull|push [--host user@host] [path...]
# Without --host the other laptop is found on Tailscale.
exec "$HOME/.claude-sync/bin/proj" data "$@"
