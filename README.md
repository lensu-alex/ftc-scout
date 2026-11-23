# FTC Scout (BIOBUZZ)

Scout any FTC team from match video, analysed on the viewer's own device. See `PLAN.md` for the full plan.

## Run the app

```bash
cd app
npm install
npm run helper     # terminal 1: background analysis on this computer (no window, no screen sharing)
npm run dev        # terminal 2: open the printed localhost URL in any browser
```

1. Search a team, pick how many recent matches to analyse.
2. Each event's stream link is filled in from the FTC API when it exists. Otherwise paste a YouTube link.
3. **Start analysis**. With the helper running it works in the background: you can close the tab and come back.
   Without the helper the page falls back to playing the video itself and asking to share the tab/window, or a video file.

If YouTube says "confirm you're not a bot" (too many requests from one computer), wait a while, or start the
helper with `FTC_YT_BROWSER=safari npm run helper` to use your browser's YouTube login (reads its cookies; off by default).

The helper downloads `yt-dlp` once into `~/.ftc-scout/bin` (ffmpeg comes with `npm install`). It reads the match at 720p, then
short 1080p bursts (1.6 s before each volley the hive saw) to tell which robot shot; streams without 1080p get alliance totals only.

### Backup match data (official FTC Events API)
When FTCScout is down the helper uses FIRST's official API. Get a free key at
https://ftc-events.firstinspires.org/services/API, then create `~/.ftc-scout/config.json`:
```json
{ "ftcEventsUser": "your-username", "ftcEventsToken": "your-token" }
```

## What works now (v0.1)

| Part | Status |
|---|---|
| Team search, match list, last-N | ✅ FTCScout API |
| Stream link per event/day | ✅ from API; manual link or file as fallback |
| Overlay detection (any position/scale, normal or mirrored) | ✅ tested on 10 streams |
| Match clock + match name reading | ✅ tiny template reader, 0.5 ms, no download (matches Tesseract on 136/136 clocks, 133/136 names, 3 unread) |
| Finding matches in a stream | ✅ 1 seek per match after anchoring (8/9 streams; Utah has no API times) |
| Camera cuts / views / % of match seen | ✅ robust to people walking in front of the camera |
| Time + data estimate | ✅ (seek count measured on test streams) |
| Background helper (no tab to keep open) | ✅ `npm run helper`, ~25 s per match (8 parallel fetches) |
| Backup data (FTC Events API) | ✅ needs your free key |
| Robot/ball detector (YOLO11n, trained from auto-labels on 26 events) | ✅ v2 shipped; 🔄 v3 labels (motion-checked) training |
| Motion check (weak robot detections confirmed by what moves) | ✅ top-4 track coverage 65% → 75% avg on 5 test matches |
| Robot tracking + identification (which robot is the team) | ✅ ≈0 identity switches; team followed 36–83% of a match on the hardest test stream |
| "Which one is your team?" (only when unsure) | ✅ tap a picture once, every match is re-identified |
| Team stats from video (distance, speed, time moving, heatmap, flags) | ✅ (helper mode) |
| Pollen scored per alliance + hive tips (read inside the hive, found automatically per camera view) | ✅ helper; ±1 ball per volley |
| Pollen scored per robot (team vs partner) | ✅ helper pass 2: 1080p bursts before each volley (720p when the stream has no 1080p), launch evidence above each robot; ~85% of volleys get a clear shooter on 4 Oregon matches; team vs partner decided by the shooter's look at the shot; shown as sure–possible range, with a per-volley timeline on the match page |
| Cameras looking straight down on the hive | ⚠️ robots drive under the hive and the sign rides into the box when it turns: alliance pollen over-counts there (see PLAN); a disc counter for that case exists as a dev tool |
| Launch counting at the robot (720p) | ❌ dead end at 720p (balls 3-8 px, blurred); the 1080p pass sees them |
| Field mapping, heatmaps in field coordinates | ⏳ next |
| Database | ⏳ later |

Overlay scores are never read or used.

## Dev tools

`tools/` (Python, dev only, not part of the app): `sample_stream.py` pulls frames from a stream into `tools/dataset/`,
`seq.py` makes contact sheets. Set up with `uv venv --python 3.12 tools/.venv && uv pip install --python tools/.venv/bin/python "yt-dlp[default]" opencv-python-headless numpy imageio-ffmpeg`.

`app/scripts/` (Node, run with `npx tsx`), all using the same vision code as the browser:

| Script | What it checks |
|---|---|
| `eval-overlay.ts` | overlay + OCR on every sampled frame → `tools/debug/overlay/*.jpg` |
| `eval-clock.ts <clip>` | clock/name timeline of a clip |
| `eval-locate.ts <ytId> <event> [team] [Q1,Q5]` | finding matches in a real stream |
| `eval-shots.ts <clip> <start>` | camera shots/views of a match |
| `eval-cuts-synthetic.ts` | two streams spliced every 15 s: all switches found? |
| `eval-run.ts <team> <event> <ytId> [n]` | the whole pipeline end to end |
| `build-templates.ts` / `eval-tinyocr.ts` | learn the overlay glyph templates (Tesseract labels, dev only) / compare with Tesseract |
| `helper-job.ts <team> <ytId> [n]` | send a job to the running helper and follow it |
| `e2e-browser.ts <team>` | the page in Chromium, start to results (`SAFARI=1` = no Region Capture) |
| `eval-track.ts <clip> <start>` | tracking: tracks per match, coverage, identity jumps, path picture |
| `eval-hive.ts <clip> <start> x0,y0,x1,y1 [marks.json]` | pollen scored + hive tips read inside the hive box, against hand-marked launches |
| `eval-pass2.ts <clip720> <start> <clip1080> <start> <blueBox> <redBox>` | two passes: robots + hive volleys at 720p, then 1080p bursts before each volley → which robot scored it (`ALLIANCE` env = track ids per alliance) |
| `_detcount.ts`, `_detviz.ts`, `_flight.ts`, `_shot.ts`, `_confirm.ts` | scratch checks: robots per frame, boxes on a frame, ball flights, page screenshots, the confirmation flow |

Launch-counting experiments (`tools/`, 30 fps native): `flights.py` (balls in flight from robots), `hive_activity.py`, `cell_count.py`, `rim_cross.py`, `row_count.py <clip> <start> <out> x0,y0,x1,y1` (balls resting in a hive cell).

Model work (`tools/`): `prelabel.py [student.pt]` (auto-labels, v3 = motion-checked; `PRELABEL_ONLY`, `PRELABEL_ROOT`),
`train.py <name> <base.pt> <imgsz> [epochs]` and `bench.py <names…>` (`FTC_DATA` = dataset folder).
`label_server.py [dataset/yolo3]` → http://127.0.0.1:47620: correct robot boxes by hand (drag = add, click = remove,
Enter = next). Frames with the fewest robots found come first. Saved to `tools/dataset/human/`; the next
`prelabel.py` run uses them instead of the automatic robot boxes.
