#!/bin/zsh
# one event: locate matches (if not done yet), then pull training frames
cd /Users/lensu/Developer/ftc-scout/app
export FTC_YTDLP=../tools/.venv/bin/yt-dlp
code=$1; id=${2##*=}
[[ -s ../tools/debug/locate/$code.txt && $(grep -c '^Q.* (' ../tools/debug/locate/$code.txt) -gt 0 ]] || npx tsx scripts/eval-locate.ts $id $code > ../tools/debug/locate/$code.txt 2>&1
echo "$code: $(grep -c '^Q.* (' ../tools/debug/locate/$code.txt) located, $(npx tsx scripts/extract-train.ts $code 2>&1 | grep -v Warning | tail -1)"
