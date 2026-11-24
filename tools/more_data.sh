#!/usr/bin/env bash
# Locate matches in more event streams, then pull training frames from them (dev only).
cd "$(dirname "$0")/../app"
export FTC_YTDLP=../tools/.venv/bin/yt-dlp
while read code url; do
  id=${url##*=}
  [[ -s ../tools/debug/locate/$code.txt ]] || npx tsx scripts/eval-locate.ts $id $code > ../tools/debug/locate/$code.txt 2>&1
  echo "$code: $(grep -c '^Q.* (' ../tools/debug/locate/$code.txt) matches located"
  npx tsx scripts/extract-train.ts $code 2>&1 | grep -v Warning | tail -1
done < ../tools/streams_more.txt
# the first 9 events: more matches/moments with the new extraction settings
while read code url; do npx tsx scripts/extract-train.ts $code 2>&1 | grep -v Warning | tail -1; done < ../tools/streams.txt
ls ../tools/dataset/train_raw | wc -l
