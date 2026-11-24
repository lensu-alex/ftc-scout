#!/usr/bin/env bash
# Dev: cache pass 1 (with raw hive samples) for every local clip that has official tips in tools/gt/tips.json.
# usage: app/scripts/cache-all.sh [outDir=/tmp/ftc-cache] [name ...]     then: npx tsx scripts/eval-tips.ts ../tools/gt/tips.json <outDir>
# Heavy (~1.5 min per match on the M5, ~2 on the Linux laptop). Clip start = rough match start in the clip; the clock reader refines it.
cd "$(dirname "$0")/.." || exit 1
out="${1:-/tmp/ftc-cache}"; shift || true; mkdir -p "$out"
all="or18:or18.mp4.webm:14 or1:or1.webm:15.5 or5:or5.webm:15 or9:or9.webm:10 q10:USORHIN_q10.mp4:3 m1:m1.mp4:19 nlron:NLRON_13760.mp4:0 micoq:USMICOQ_8530.mp4:21 micoq21:USMICOQ_14320.mp4:0 alatq4:USALATQ_2250.mp4:26 iadaim10:USIADAIM1_5100.mp4:67"
for m in $all; do
  IFS=: read -r n c s <<< "$m"
  if [ $# -gt 0 ] && ! printf '%s\n' "$@" | grep -qx "$n"; then continue; fi
  npx tsx scripts/cache-pass1.ts "../tools/clips/$c" "$s" "$out/$n.json"
done
