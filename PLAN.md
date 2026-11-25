# FTC Scout: Plan (BIOBUZZ 2026–27)

Goal: a web app where you search any FTC team, pick how many recent matches to analyse,
and get full stats about the team on its own and as part of an alliance. **Per-robot stats come from what the
camera sees** (launches, shot heatmap, movement). The number of balls each robot scored is **estimated**
from those plus its usual stats, and unusual games are marked as outliers. The heavy analysis runs on the **viewer's own device** (in the browser), and
finished results are **saved to a shared database** so no match is analysed twice.

End state: **fully automated**. Type a team → the app finds its matches, finds the streams,
finds each match inside the stream, handles camera switches, identifies the robot, and counts what
it does. It only asks you something when it isn't confident.

---

## 0. Progress log

**2026-11-18, v0.1 built** (see README.md). Findings from 10 real BIOBUZZ streams:
- FTC Live overlay: same layout everywhere, but top or bottom, any scale, and **mirrored at some events** (blue | timer | red).
  Found by the white timer box sitting between a red and a blue block.
- Clock: 2:30 shown before the start, AUTO 2:30→2:01, transition 0:08→0:01, TELEOP 2:00→0:00. "0:01–0:08" is ambiguous (transition or end).
- The team-list overlay = setup before a match; the timer bar appears when the match starts.
- API `actualStartTime` + one match read on screen locates every other match: **1 seek per match**.
  Some events never upload quals (Utah scrimmage): name-based search fallback exists but is weak (deprioritised).
- League events used **one fixed camera during matches** (side, high corner, or top-down at Michigan); cuts happen
  between matches. People walking in front of low cameras looked like cuts: fixed with block-wise comparison.
- Streams are 720p max (some 720p60). Non-YouTube links (fimav.us, ftcwa.live) are pages that link to YouTube.

**2026-11-19:** the FTCScout API went down for a while → the app needs a backup data source (official FTC Events
API with a free key, used by the helper) and must show a clear message when data is unavailable.

**2026-11-19, background helper:** user wants analysis to run in the background (no tab to keep open, no screen
sharing). `app/helper` = small local program (`npm run helper`) that runs the same pipeline with ffmpeg + yt-dlp,
fetching only the match segments. The page finds it on 127.0.0.1:47615, sends jobs, follows progress, and picks
jobs up again after the tab is reopened. Screen sharing (any browser, marker calibration) and video files stay as
no-install fallbacks.

**2026-11-19, lighter + faster:** Tesseract replaced by a tiny glyph-template reader (0.5 ms, nothing to download);
the helper fetches each match as 8 parallel parts (YouTube limits each connection to ~1.3x real time): ~25 s per match.

**2026-11-19, detector + identification (in progress):**
- Training data: 215 match frames from 9 events, pre-labelled by a large open-vocabulary model (YOLO-World,
  dev only; "toy car" finds FTC robots, hives are filtered out because they don't move within a match and are
  thin coloured outlines with no dark parts; unclear boxes are greyed out). Classes: robot, pollen, nectar_red, nectar_blue.
- App model: YOLO11-nano at 640 px (~2.6 M params). One whole event (Ohio) held out to test generalisation.
- Robot tracking (constant-velocity, overlap matching), identification = cross-match cosine similarity of
  MobileNetV3-small embeddings (3.7 MB) with alliance colours greyed out; alliance from marking colour.
- Known gap: tracks break when robots are hidden; linking track pieces by appearance comes next, then field mapping.

**2026-11-20 (night), model optimisation + team stats:**
- Data: 1,266 frames from 26 events (2 whole events held out for testing: USOHCON, USIANON).
- Labeller v2: YOLO-World on full frame + mirrored + 2x2 zoomed tiles + previous student model, boxes fused;
  static boxes (hive, posts) and hive-looking boxes (colourful outline, no dark parts) removed; unclear boxes greyed.
- Training: stream augmentation (JPEG 30-90, motion blur, downscale to ~480p, noise), tiny hue shifts only.
  Comparing YOLO11n@640, YOLO11n@832, YOLO11s@640.
- Tracker v2: distance gating in robot lengths (perspective-safe), colour fingerprints, tentative tracks.
  Top-4 track coverage: 94% (high corner), 85% (top-down), 66% (high side), 33% (low side camera).
- Team robot = all its track pieces that look like the team's cross-match reference (no time overlap).
- Team stats (video only): distance/auto distance/top & moving speed in robot lengths (~ft), time moving,
  coverage, per-event heatmap over the camera image, per-match table with flags; matches followed <40% excluded.
- Lesson: heavy use from one IP makes YouTube ask "are you a bot?". Helper now caches media links (4 h) and can
  optionally use the user's browser login (FTC_YT_BROWSER, off by default).

**2026-11-19 (morning), first full real test + motion:**
- 5 matches of team 12808 (Silicon Forest Meet 1) in 4 min via the helper; robot picked in 5/5, 2 confident.
  But only 14-42% of each match followed: the detector found ~0.5 of 4 robots per frame on that camera
  (dark robots, motion blur, reflections from the field walls). Tracker was fine (≈0 identity jumps).
- Motion check (vision/motion.ts): per-view median background at 160x90; weak robot detections (≥0.08) count
  when the box is over something moving. Never creates robots on its own (people move too).
  Top-4 coverage, old model → YOLO11n@640 v2, both with motion: Oregon 45→60, m1 45→74, Michigan 83→93,
  Iowa 58→66, Netherlands 96→84 (avg 65→75). n640 v2 is now the shipped model (v1 kept in tools/models).
- Root cause in the data: robot labels were missing on several events (Oregon ~1.2 of 4 per frame), so the
  model was taught that those robots are background. Labeller v3 (tools/prelabel.py, v2 kept): weak teacher /
  student robots kept if they moved compared to the median of the same match's frames and stand on the field
  (outline of all balls seen in the match); unexplained robot-sized moving areas on the field are greyed out.
  Oregon 1.2→2.0, Iowa 2.8→3.3 robots per frame on the trial.
  First full run had a bug (weak student guesses skipped the motion check: green posts, hives labelled as robots;
  training stopped). Fixed: weak guesses are their own class, kept only if moving + on the field + robot-like.
  Remaining gap: still robots (before the start, parked) that both models score 0.07-0.4 get no label; motion
  can't help there. Best next step: ~100 frames corrected by a person (tiny labelling page), then retrain.
- Real test again (12808, n640 + motion): team robot followed 36-83% of each match (was 14-42%); 3/5 sure.
- Confirmation step built (components/ConfirmRobot.tsx, helper POST /jobs/:id/confirm): unsure matches show a
  crop of each candidate; one tap fixes that match and re-identifies the rest. On 12808 the guess in Q-9 was wrong;
  one tap fixed it and Q-1 became sure as a side effect (5/5).
- Idea (strong, next): robots must show their team number, and it's readable on the crops. Reading it (we only
  need to tell apart the 2 known alliance numbers) would make identification nearly certain. Tesseract can't read
  them on the crops (12808 in red LED digits read as "58"): needs its own small digit model.
- Model comparison (held-out events, v2 labels): n640 mAP50 0.792, robot R0.78/P0.78, 15 ms; n832 mAP50 0.825,
  robot R0.79/P0.83, balls clearly better, 27 ms (2 CPU threads, ~10.7 MB each). s640 skipped (better labels are
  the bigger lever). On real matches n832 tracks robots *worse* (Oregon 46 vs 60%, m1 60 vs 74%), so n640 stays
  shipped. Model input size now comes from ftc-det.json next to the model (default 640).
  v3 chain running: relabel with n832 as student → train n832v3 and n640v3 → bench on the v3 held-out labels.
- Launch counting, first look (scripts/_flight.ts, Oregon Q18 at 6 fps): one-off ball detections are mostly floor
  flicker + balls dropping inside the transparent hives; nearest-neighbour chains of moving balls give ~30
  "rising" chains, mostly zig-zag noise, only a few real arcs. Needs: smooth near-parabolic, consistent-direction
  trajectories; short higher-fps bursts when a robot is near its launch zone; hive area learned per stream (where
  balls pile up above the field); count arrivals in the hive and attribute to the robot the arc started from.

**2026-11-19 (day), with the user:**
- User verdict on the app: "mostly gibberish". Overlay of the picked robot on Q18 showed why: right ~half the time,
  boxes on empty floor otherwise, auto untracked, and image-space distances meaningless.
- Field mapping (vision/field.ts, components/FieldMap.tsx): 4 clicks per event → homography → paths in feet,
  stats in real feet, top-down heatmap with 2 ft tiles; gaps no longer drawn as straight drives.
- Tracking fixes: every track gets an appearance crop (big tracks had none: a duplicate box always "overlapped");
  pieces join only if physically reachable and on the same camera view.
- Hand labels (tools/label_server.py → dataset/human, make_human_set.py): user labelled 132, then 330 frames.
  Held-out hand-labelled frames: robot recall 0.35 (shipped) → 0.41 (v3 auto labels) → 0.45 (132 hand frames);
  on Oregon Q18 robots/frame at 0.35 conf 1.03 → 3.35, top-4 coverage 60% → 75%, one track spans the whole match.
- Launches (vision/launches.ts), user's rule "a ball leaving a robot is a launch": live marking was too hard for
  the user (balls leave in fractions of a second, volleys of up to 4), so: estimate with a range. Iterated by
  eye on random samples: blob chains 2/12 real → rising + fast 3-4/12 → motion-blur streaks just above a robot
  ~7/12. App shows ≈ 0.6 x detected (0.4-0.8 x), labelled rough; volleys up to 4 per robot per frame.
  Helper now reads 10 fps (detector still ~3 fps).
- Identification: user found 12808 missing from the options → robots = groups of look-alike, non-overlapping
  pieces; every robot offered (up to 8) + "Not shown / can't tell"; static scenery (posts!) excluded — a post is
  the perfect impostor (same look in every match). "Check every match" view: auto picks were right in ~1/5 on
  this stream. Real fix = better detection (fewer pieces), then team-number reading.

**2026-11-19 (afternoon, user away): a real test set, and the 330-label model**
- Ground truth: 100 frames from 5 matches (Oregon Q9/Q18 hard; Netherlands, Michigan, m1 cleaner), every robot
  boxed by annotation agents on gridded frames (tools/gt; scripts/eval-gt.ts det|track). Caveat: all 5 events
  are also in the training data (other frames), so these are in-domain numbers.
- Detector (score >= 0.35), all 393 robots: shipped n640h 83% recall / 80% precision → 330-label model at
  epoch ~40: 89% / 93% (Oregon Q9 73 → 92%). Shipped it.
- Full tracking (10 fps, motion check, tracker, scenery filter) at the annotated moments: 94% recall
  (near 97, far 90) / 87% precision. Oregon 96-97%, Netherlands 96% / 99%, m1 99%; weak: Michigan far robots
  under the see-through hives (70%).
- Scenery filter in analysis: tracks that never move >0.5 robot length over 60 s+ are dropped (posts, hive legs),
  also removing post-top "launches". Netherlands tracking precision 76 → 93%.
- Zoomed tiles (far side at ~2x): no gain by the old coverage proxy, but on ground truth far recall 76 → 84%.
- Launch precision re-checked with the new model: 9/16, then 10/16 after ignoring always-yellow pixels.
- Clean stream (team 22173, Netherlands): followed 97-100% in 3/5 matches; automatic pick right ~3/5
  (Oregon ~1/5). Tesseract reads 0/30 plates even there; blue plates are washed out on video (s ~0.42),
  blue test relaxed. Identification stays a one-tap user choice (user's decision), answers saved to disk.
- Final 330-label model (n640h2, shipped): honest test (hand-labelled frames of the 2 never-seen events) robot
  recall 0.44 → 0.52 → 0.60 as hand labels grew 0 → 132 → 330. Ground-truth tracking: 96% recall
  (near 98, far 94) / 86% precision; Michigan far robots 70 → 84%. Tiles stay on (far +8 points on the detector).
- Video reliability: YouTube throttling (and my own heavy test runs competing for CPU) cut matches short — a run
  once returned an empty Q-18 and a 58-frame Q-9 without any error. Now: parts are only killed after 45 s with no
  data and resume from their last frame (twice); a match read below 85% counts as an error and is retried once
  with a fresh link; the user's saved answers are re-applied to retried matches.
- Team path: pieces never overlap in time (the picked one wins); avoids paths zig-zagging between robots.
- Launches: Oregon Q1 is the counter-example: 12808's own metal/green-lit parts blur when it drives → ~3x too
  many "launches". Orange excluded from streaks (Q18 still ~8/12 real). Open: require the smear to leave the
  robot's box over 2+ frames, or learn a tiny streak classifier from the hand-checked strips.

**2026-11-25 (night, Mac, owner asleep): see-saw tips on all 11 clips**
- Mac baseline (all 11 cached with `cache-all.sh`, ~2 min per match after a slow first one): area counter found 45
  of 59 official tips, |error| 18 (auto 5); see-saw v1 |error| 22 (auto 3). On the 8 Linux matches the Mac gives
  the same numbers as Linux (|error| 9). The 3 new clips broke v1: Alabama Q4 red +8 and blue +2 (the camera looks
  at the hive from the front: people stand and move right behind the red see-saw, robots park in front),
  Iowa Q10 red +2 / blue -1, both top-down.
- q10 blue 0/5 cause: v1 seeded its 2-means with the first second, which on that camera is a third look (pre-start)
  and the two real positions ended up "ambiguous". Fix: project the smoothed pictures on their first principal
  component and split that line (Otsu); score d' = gap / pooled spread; the kind with the larger d' wins.
  q10 blue 0 → 5/5, the rest unchanged: |error| 22 → 19.
- d' does not tell a hive that never tipped: nlron blue (0 official tips) has d' 20, the cleanest split of all.
  Something real changes there (people, robots, the sign), just not a tip. Requiring both pictures to flip
  together: no (or1 blue, or18 blue and micoq21 blue are right in one picture only). Dead end.
- **A see-saw only tips under load.** Per flip, the yellow in the cell (1 s median, the 3 s before and during
  the move): on side cameras all clean-hive flips had >= 2.2 balls' worth except the auto ones still filling,
  which still peak >= 2.6; false ones <= 1.8 except nlron (far, high camera: 2.3 and 2.7). Rule: on side
  cameras (area mode) a flip counts only at >= 2 balls. **Fitted on the same 11 clips it is scored on**; 1.5 / 2 /
  2.5 give |error| 8 / 6 / 6, so not knife-edge. Not applied to top-down cameras (the load there is mostly nectar).
- Result: see-saw |error| 22 → **6** (auto 3 → 1), area counter 18. 61 found for 59 official. Left: or9 red -1
  (a tip at the buzzer: the see-saw starts moving at 157.5 s and the samples end at 160 before it settles),
  nlron red +1 / blue +1, micoq blue +1, iadaim10 red +1 / blue -1 (top-down and far cameras).
- Wired in (`hiveTimeline` in vision/hive.ts, used by analyzeMatch): tips = the see-saw's flips; volleys are read
  only inside each stable position, so the level jump at a flip is not counted as balls; falls back to the area
  counter when the see-saw doesn't split. `check-all quick` on the Mac, old → new (same machine, same day):
  tips or1 6 → 10, or5 6 → 8, or9 7 → 8, or18 14 → 16, q10 5 → 6, m1 2, nlron 0 → 2, micoq 1 → 2;
  official 10 / 8 / 9 / 16 / 6 / 2 / 0 / 1: **tips |error| 11 → 4**. Volleys 36/40/44/43/24/13/5/3 →
  36/43/46/43/24/11/4/3; clear shooter 29/35/28/39/21/9/4/1 → 26/35/31/38/22/10/3/1 (not a truth measure).
- Ball counts per volley, truth = the owner's 15 marked 12808 volleys in or1 (launches, so scored <= marked):
  found 12/15 → 13/15, exact 2 → 3, never more than launched. Counts are still about half of what was launched
  (marked 4, counted 1-2): misses or under-reading, can't tell without scored-ball truth.
- One ball's area per see-saw position (median of the smallest third of the rises in that position, kept within
  0.6-1.3x the box guess): one position reads ~70-87 px, the other ~97-104 (the tag panel), on every Oregon match.
  Small gain only: or1 exact 2 → 3; the spread of "balls in the cell just before a tip" (should be ~constant if a
  cell tips at a fixed load) cv 0.45 → 0.44. The load at a tip is not constant across cameras either (or18 red
  tips at 2-4 "balls", the others 6-8), so that check is weak. Kept on.
- Official `dcHivePollenNectar` = elements left in the hive at the end (2 pts each), 0-7 at USORSFM1, 0 for most
  high-tip alliances even where yellow sits in the cell at the end: not usable as a check of the final level.
- or1 blue auto: frames show two tips in auto (~6 s and ~26 s); official says 1 auto + 8 teleop (total 9 = ours).
  The auto/teleop split of tips is the referee's, so auto |error| 1 there is not a detector error.
- iadaim10's clip ends ~25 s before the match does (samples stop at 133 s): its tips can't be scored; eval-tips now
  marks clips ending before 150 s as not scored. On the 10 full clips: see-saw |error| 4, area counter 16.
- Dead end: watching the hive 5 s past the buzzer (to catch or9 red's last tip). Both new flips start after the
  buzzer (or1 blue 160.3 s, or9 red 159.6 s); the or1 frames show a clear tip at 159-160 s that the official
  count leaves out (9 = the flips before the buzzer). Tips after the buzzer don't count, so the window stays
  at +2 s; or9 red's sixth tip stays unexplained (|error| same 4 either way). Reverted.

## 0.1 Lightweight rule (user, 2026-11-18)

The pipeline must stay as light as possible, so it runs on old laptops and phones:
- **Do the least work per frame, on as few frames as possible.** Analyse ~3 fps (not 30), go up to ~10–15 fps only
  in short bursts while a robot is in a shooting position. Skip frames where nothing moved (cheap frame difference first).
- **Cheap checks first, models last.** Overlay = colour run scan (~9 ms per 720p frame, can run on a 640 px copy).
  Camera cuts = 48×27 fingerprints. A neural network only runs inside the field area and only when needed.
- **Tiny models only.** Detector: YOLO-nano class, ~3 M params, 320–416 px input, int8 ONNX (~3–6 MB).
  Robot identity: a small embedding model run only on a few crops per match, not on every frame.
- **OCR is rare.** Tesseract (~4 MB, loaded once and cached) runs a few times per match. Plan: replace the clock
  reading with a tiny digit-template reader (no model) and keep Tesseract only for match names.
- **Nothing stored:** frames are analysed and dropped; only small results are kept.
- Every new stage gets a per-frame time budget, measured by the in-app benchmark and the eval scripts.

## 1. What we verified (Nov 2026)

| Fact | Source |
|---|---|
| Public, no-key API with teams, events, every match, alliance/station per team | FTCScout (`api.ftcscout.org`, REST + GraphQL) |
| BIOBUZZ score breakdown per alliance: `autoHiveTips`, `dcHiveTips`, `dcHivePollenNectar`, `dcGardenPollenNectar`, flower states, leave/park **per robot** (`autoLeave1/2`, `dcParkPoints1/2`), penalties | FTCScout schema `MatchScores2026Alliance` |
| **Each match's actual start time** (`actualStartTime`) | FTCScout GraphQL |
| Event livestream links: `liveStreamURL` and `livestreamsByDay` | FTCScout / FTC Events API |
| BrickBot = **#15996** | FTCScout |

Stream links are often missing: in 2025, only 2 of BrickBot's 8 Romanian events had one, and the
national championship had none. Stream discovery needs fallbacks (§4.2).

## 2. BIOBUZZ facts that shape the vision system (Competition Manual)

- 2 vs 2. **AUTO 0:30 → 8 s transition (robots still) → TELEOP 2:00**. FLOWERs open at 1:00 left.
- **POLLEN**: yellow balls, ~2.8 in, 40 per match. **NECTAR**: red/blue balls, ~3.6 in, 8 of each colour.
  Each robot starts with 4 pollen. Max 4 elements held at once.
- **HIVE**: one see-saw structure in the **field centre** (pivot ~44 in high), a red HIVE + a blue HIVE,
  2 CELLs each. It has two stable positions. **Launching** into the upward-facing CELL is the only way to score there;
  enough balls in it → it **tips** (20 pts). After each tip, the alliance gets one more NECTAR.
- **FLOWERs**: 4 on the perimeter wall, ~4 in opening, ~21.5 in high. Elements are **placed** on top (NECTAR only in
  the last 60 s); whoever has NECTAR on top owns the FLOWER.
- **GARDEN** corner strips (1 pt each), **LOADING ZONE** (PARK 5 pts), **LEAVE** in auto (3 pts).
- The number of balls needed for one tip isn't stated in the manual, so the app learns it from data.

## 3. Architecture

```
┌──────────────────────── Browser (user's device) ─────────────────────────┐
│  UI (React + Vite + TS)                                                   │
│  ├─ Search / match list / stats dashboards                                │
│  ├─ Video input: YouTube embed + tab capture  |  local file               │
│  └─ Web Worker: analysis pipeline                                         │
│       onnxruntime-web (WebGPU → WASM fallback): detector, embeddings     │
│       OpenCV.js: homography, shot-cut detection, image ops               │
│       overlay OCR (small digit model)                                     │
└──────────────┬───────────────────────────────────────────────────────────┘
               │ HTTPS
┌──────────────▼──────────── Backend (Supabase) ───────────────────────────┐
│  Edge functions: proxy for FTC Events API + YouTube Data API (keys hidden)│
│  Postgres: cached API data, streams, match offsets, camera views,         │
│            robot identities, analysis results, user confirmations         │
│  Auth: Google / email login for submitting results                        │
└───────────────────────────────────────────────────────────────────────────┘
```

No video is ever stored. Frames are analysed in memory, then thrown away.

## 4. Pipeline

### 4.1 Video input
1. **Link mode (main, desktop):** YouTube embed controlled through the IFrame API + tab capture (`getDisplayMedia`).
   **1080p, 1× speed** during matches (balls are small and fast). ~70–120 MB of internet data per match, no disk.
2. **File mode (fallback, also on phones):** a local file, seeking with `<video>`/WebCodecs.
3. Embedding disabled → tell the user, offer file mode.

### 4.2 Stream discovery (when no link is given)
`livestreamsByDay` → `liveStreamURL` → YouTube Data API search (event name + date + organizer channels,
user confirms) → user pastes a link. Confirmed links are saved in the DB for everyone.

### 4.3 Finding each match inside the stream
Rough offset = match `actualStartTime` − stream start time (YouTube `liveStreamingDetails`).
Then OCR the FTC Live overlay (match name, timer) in a ±2 min window to find the exact start, and save it.
The overlay timer is also the **match clock** used everywhere else (it doesn't change when the camera switches).

### 4.4 Multiple camera angles + switches
Many streams cut between a wide field camera, close-ups, other angles, replays and graphics.

1. **Cut detection:** compare each frame with the previous one (colour histogram + edge difference), with the
   overlay area masked out. A sudden jump = cut; a gradual one = dissolve.
2. **Which camera is this?** Embed one frame per shot (DINOv2) and **group shots by camera**. A fixed camera
   always shows the same background, so its shots group together. Each group becomes a *camera view*, and
   views are saved per event.
3. **Classify each view** (small classifier + rules): *full field* · *partial field* · *close-up* ·
   *replay* (a match clock that doesn't match the live clock, or a replay graphic) · *not the field* (graphics, crowd).
4. **Field mapping per view:** each usable view gets its own homography (field tile grid / perimeter →
   field inches). This is done once per view per event and cached; if unsure, ask for 4 corner clicks once.
5. **Continuity across cuts:** robot tracks are kept in **field coordinates**, not pixels. After a cut,
   robots are matched again by field position + appearance (the same embeddings as §4.7) + time.
6. **Blind periods:** when no usable view shows the field, the time range is marked as *unseen*. Counts are
   reported as "seen" with % of the match covered, e.g. "launched 14 (92% of match seen)". Nothing is guessed.
7. Close-up views are still used when they're mapped: they show more detail (better for counting balls).

### 4.5 Detection + tracking
- One **ONNX detector** (small YOLO), classes: `robot`, `pollen`, `nectar_red`, `nectar_blue`,
  `hive` (+ which side is up), `flower`. Trained on frames labelled from real BIOBUZZ streams (Roboflow).
- **Robots:** ByteTrack-style tracker in field coordinates, ~8 fps normally.
- **Launches:** only the moment a ball **leaves a robot** is detected (a ball appearing just above/in front of the
  robot and moving away). The ball isn't followed all the way to the HIVE. Frame rate goes up to ~15 fps while a
  robot is in a shooting position, then drops back down.
- **HIVE state:** track which CELL faces up (red/blue pair, tilt angle) → **tip events** with timestamps.

### 4.6 Per-robot stats: measured from video, scored balls estimated

**Update (user, 2026-11-18): overlay scores and API points are not trusted at all.** They are not used as the
alliance total either. Scored balls are estimated from vision only (launches × accuracy by shooting spot,
learned per team across matches, hive tips seen on video as a check).
The video **measures** what's easy to see reliably, and the number of **scored** balls is **estimated** from it.

**Measured per robot and match** (each event has a timestamp, field x/y and confidence):

| Measured | How |
|---|---|
| **Launches** (pollen / nectar, auto / teleop) | Ball leaving the robot (§4.5) |
| **Shot positions** | Robot's field x/y at each launch → **shot heatmap** (distance + angle to the HIVE) |
| **Movement** | Movement heatmap, auto path, time in each zone, time near opponents (defense) |
| **Cycles** | Time between launch bursts → cycle count + cycle time |
| **Hive tips** | Change in HIVE state (whole-alliance event) |
| **Flowers / garden / leave / park** | Robot position + ball near FLOWER opening / GARDEN at the right times |

**Estimated: balls scored per robot**
1. **Accuracy by shooting spot:** each robot's chance of scoring depends on where it shoots from. The app learns
   accuracy per area of the field (heatmap cells: near / mid / far from the HIVE, angle).
2. ~~Alliance total from the API~~ (dropped: scores are unreliable). Instead, **hive tips seen on video** (the HIVE
   flips) give a rough check of how many balls went in.
3. Per robot: *launches × expected accuracy from its shot spots*.
4. **Learn each team's own accuracy across all its matches** at the event (and across partners): a least-squares fit
   like OPR, but on launches instead of points. A team shooting the same way with different partners gets a stable
   estimate, and the estimate gets better with each match.
5. Shown as an estimate with a range: "scored ≈ 11 (9–13) of 16 launched, ≈ 69% accuracy".

**Outlier games**: each match is compared with the team's usual numbers (median + spread, robust to a few bad
games) and classified:

| Type | Signals |
|---|---|
| **Didn't move / disconnected** | Little movement, no launches |
| **Broke mid-match** | Normal launches, then nothing for the rest of the match |
| **Played defense** | Lots of time in the opponents' half / near opponents, few launches |
| **Unusually bad / unusually good shooting** | Launches normal but estimated accuracy far off, or launches far above/below usual |
| **Unusual strategy** | Shot heatmap very different from usual (new shooting spot, new auto) |
| **Bad video** | Low % of match seen, many camera cuts, low-confidence identification |
| **Penalties** | Large penalties from the API |

Outliers are **shown but marked**, and left out of the "usual" averages (with a toggle to include them). The
dashboard shows *usual performance* (outliers left out) next to *all games*.

What the user sees **per robot**: launches, estimated scored and accuracy, shot heatmap, movement heatmap, auto path,
cycles + cycle time, defense time, tips during its shooting, flowers/garden/park. Then for each match, those numbers,
the outlier label, and % seen. Across matches: usual vs all, trend, consistency.

### 4.7 Automatic robot identification
- Qualification matches: crop the target alliance's robots in the first seconds (still in their starting spots),
  mask red/blue alliance markings, embed with **DINOv2-small**, then pick the robot that maximises the average
  cosine similarity across matches. The partner changes every qual match, so the repeated robot = the target team.
- Use the full schedule to identify **every team at the event** (assignment problem). Matching stays within one
  event. Playoffs reuse the identities from quals.
- The same embeddings re-identify robots after camera cuts (§4.4).

### 4.8 Confirmation step (only when unsure)
*Built (v1): after the run, not before; one crop per candidate robot; "can't tell" and camera-corner clicks not yet.*
All questions are asked **together, before the long run**: a screenshot with boxes and the best guess pre-selected;
tap to confirm or fix, or press "can't tell". The same screen is used for unclear camera views (4-corner click).
Clicks become reference data, and answers are saved per event.

### 4.9 Time + data estimate (shown before starting)
- A ~5 s benchmark on the device (detector fps at the normal and burst rates)
- Link mode ≈ match length at 1× + seek/OCR → about **3–4 min per match** on a fast laptop;
  slower devices may need several passes or file mode
- Data = matches × ~100 MB at 1080p
- e.g. "5 matches · ≈ 18 min · ≈ 500 MB · 2 already in database (instant)"

## 5. Database (shared results cache)

- `events`, `matches`, `match_teams`: cached API data
- `streams`: event, day, YouTube id, stream start time, confirmed_by
- `match_segments`: stream, match, start offset, confidence
- `camera_views`: event/stream, view id, view type, reference embedding, homography, confidence
- `robot_identities`: event, team, reference embeddings + crop, source (auto/user)
- `match_events`: match, team, event type (launch/tip/flower/park/…), match time, field x/y, confidence
- `match_analyses`: match, team, **pipeline_version**, summary metrics JSON, estimated scored + range, outlier label, % seen,
  device, submitted_by
- `labels`: user confirmations / corrections (also future training data)

Matches already analysed with the current pipeline version are skipped. Only logged-in users can submit
results, and results from different users are compared (if they disagree, the match is flagged and re-run).

## 6. Phases

| # | Phase | Delivers | Done when |
|---|---|---|---|
| 0 | **Feasibility tests** | (a) YouTube IFrame control + tab capture on the M5; (b) overlay OCR on a Romanian BIOBUZZ stream; (c) WebGPU ONNX speed test; (d) **can a ball be seen at 1080p in a real stream** (measure pixels per ball, motion blur) | Each works, or we know what to change |
| 1 | **Stats site** | Search, match list, last-N, alliance BIOBUZZ stats from the API | Full BrickBot report without video |
| 2 | **Stream + match finding** | §4.1–4.3 | Exact start found for 9/10 test matches |
| 3 | **Camera views** | §4.4: cut detection, grouping views, view types, homography per view | All cuts in 10 test matches found, views labelled correctly |
| 4 | **Dataset + detector** | Labelled BIOBUZZ frames (robots, balls, hive, flowers), trained detector, robot tracker | Robots tracked across cuts |
| 5 | **Robot identification + confirmation** | §4.7–4.8 | Correct robot in ≥90% of qual matches without a click |
| 6 | **Launches + estimates + outliers** | §4.5–4.6: launch detection, shot heatmap, scored-ball estimate, outlier labels | Launch counts within ±10% of hand counts; estimated scored within ±20% of hand counts on 10 test matches; outlier labels match what we'd pick by eye |
| 7 | **Dashboard + estimate** | Per-robot + alliance dashboard, §4.9 | End-to-end "last 5 matches" |
| 8 | **Database + accounts** | §5 | A second user gets instant results |
| 9 | **Polish** | Phone layout / PWA, team comparison, export | — |

The hardest parts are **phases 4 and 6** (labelling data and counting balls) and the time spent hand-counting
test matches to measure accuracy.

## 7. Accounts / keys needed
FTC Events API (free) · YouTube Data API v3 (free key, Google Cloud) · Supabase (free) · Roboflow (free, labelling)

## 8. Risks
| Risk | Mitigation |
|---|---|
| Balls too small or blurry in the stream | Phase 0(d) test first; 1080p; only the release (near the robot) needs to be seen |
| Several balls launched at once (rapid fire) | Count the separate balls when they leave the robot; if they can't be separated, count the burst and use the team's usual balls-per-burst |
| Scored estimate wrong for one match | Alliance total from the API keeps it close; outlier check flags matches where the split looks off |
| Too few matches to learn a team's accuracy | Start from shot-position accuracy learned over all teams at the event; show a wider range |
| Camera cuts / replays / missing views | §4.4, report % of match seen |
| Two robots launch at the same moment | Trace each trajectory back to its start; low confidence → flagged |
| No stream at an event | Show API-only stats and say so |
| Similar-looking robots | Confidence gap → confirmation step |
| Wrong or spam results in the DB | Login, pipeline version, cross-checks between users and against the API |

**2026-11-20 (night): launches, honestly**
- Streak rule fitted on 58 hand-checked candidates: near-vertical smear, at least 2.5 px wide, starting above the robot's top.
  - Added: a falling smear in the next frame means a ball dropping out of a hive.
  - Added: 6+ moving balls around it in one frame means the hive is tipping.
  - Precision went from 39% to roughly 55-65% on Oregon. This is in-sample: the last rule was tuned on the same 38 launches.
- Recall (missed launches) is unmeasured, because there is no true per-robot count. I tried building one by hand from loose candidate windows:
  - Oregon low camera: balls are 3-6 px and mostly blurred out.
  - Netherlands top-down camera: a ball launched upward barely moves in the image and is about 3 px.
  - Both streams are 720p30 at best (checked the YouTube formats), so more resolution isn't available.
- Conclusion: a robot-level launch count within ±7-10 can't be verified, and likely can't be achieved, from these streams with this approach. Options:
  1. The user marks launches on slowed clips proposed by the loose detector (yes/no, or 1-4 balls).
  2. Count balls scored per alliance from the hive cells, which are clearly visible top-down. Split them by robot using which robot was at its shooting spot.
  3. Train a ball-in-flight detector on the labels from option 1.

**2026-11-23: launch counting, a way that works: count at the hive, not at the robot**
Ground truth: the user's 56 hand-marked launches of 12808 in Oregon Q1 (15 volleys of 2-4). Experiments in
`tools/flights.py`, `hive_activity.py`, `cell_count.py`, `rim_cross.py`, `row_count.py` (30 fps, native 1280x720).
- At the robot a ball is 3-8 px, blurred, and the robot's own carried balls move with it: the yellow robot 14687
  produced ~10 false "flights" per volley. Tracking balls in flight from the robot stays unreliable. Dead end.
- **Inside the hive cell the balls are 12-15 px, bright yellow, at a fixed place, and come to rest in a row.**
  A volley of 4 arrives as 4 separate balls ~0.1 s apart (frame sheet `tools/debug/burst/hive_blobs_44.png`).
- Yellow area inside the up-facing cell is a clean staircase over the match: a step up within 0.2-0.8 s of every
  one of the 15 marked volleys (and 4 more steps = the partner's volleys), flat in between, and a drop to zero
  each time the hive tips (8 tips in Q1, each = 20 pts, read for free).
- Per-ball count in the row: 1-D bumps along the row give 3 for 4 balls and 5 for 7 (touching balls merge, the
  row is seen at an angle); yellow run length / 13 px gives ~0.7 x the true count. Needs a calibration fit per
  view (ball width from the first single-ball steps), then expect ±1 per volley.
- Complication: the hive has 2 states (which cell faces up). In one state a white AprilTag panel sits in front
  of the resting row and hides the lower half of the balls; their tops still show as bumps above the panel.
- The red hive's upper cell window showed no pollen all match: the red alliance scored few; a check on a
  stream where red scores is still needed (the state/panel geometry may differ per side).
- What this gives: **scored pollen per volley per alliance** (hard number) + **tip events**. Launched ≈ scored +
  misses: misses are balls that reach the hive region and leave (countable at the hive, untested) or never
  arrive (not countable). So the app should report *scored* as the reliable stat and *launched* as a range.
- Still open, in order: (1) attribute each volley to one of the 2 alliance robots: the approach direction of the
  first ball in the window (from straight below = the robot under the hive; from the side = a far robot) plus
  which robot was in a shooting pose 0.3-1 s before; (2) find the hive cell window automatically per camera view
  (red/blue tube outlines above the field centre; one tap as fallback); (3) the hive-state (panel) switch;
  (4) validate on a second stream and a top-down camera (Michigan) where the cell is seen from above.
- App module `vision/hive.ts` (+ `scripts/eval-hive.ts`), 10 fps, no model, 10 s per match: on Q1 with the
  up-facing blue cell as the box, 13/15 marked volleys show as scored events (the 2 missed: two volleys 2.7 s
  apart merged into one; small steps in the panel-occluded state), 9 tips; counts exact where the row is
  unoccluded (+4, +3), low where the panel hides balls (38 counted vs 56 launched, misses unknown).
  Next: calibrate ball area per hive state; shorter plateaus; attribute volleys to robots; hive box per view.
- Easier streams first (user, 2026-11-23): the two top-down clips (Netherlands, Michigan) are easy for the camera
  but useless for pollen: each hive holds 3 nectar and only 1-2 pollen arrive all match (the counter saw them; false
  steps came from the hive rotating with the yellow BIOBUZZ sign). Real pollen scoring is only on the Oregon side
  camera (12808). Ran the counter on all 6 Oregon matches, both hives: the alliance with 12808 is ahead every time
  (Q1 41-14, Q5 47-27, Q9 red 58-23, Q18 45-23, scrimmage Q10 27-4; m1 red 24-1), matching the overlay's direction.
  By eye on Q5: counts right ±1 with the row in the clear (7, 8), about half when the AprilTag panel is in front.
  Tried reading the true count from the row swinging into view at each tip: no, the yellow sign swings through the
  box too (peak 2000+ px). The watcher now ignores yellow present before the match (`learnStill`).
  Next: panel-state detection (white strip with tags in the box → use half the ball area), hive box per view
  (tap), and attribution: which alliance robot shot each volley.

**2026-11-23 (evening): one team, not the alliance — attribution of each volley to a robot**
Ground truth again Q1 (12808's 15 marked volleys = TEAM, the other 9 hive events = partner or unmarked).
Track identities read from plates: 12808 = track 1 until ~39 s, then track 6 (39-116 s), then 10; 11703 = 9 (and 1 after the swap).
- Ball path from robot to hive (`backtrack.py`, 30 fps native, difference-based): **not visible**. Between the
  robot and the cell the ball is a faint streak 4 diameters long over the grey floor; it only shows up at the cell.
  Dead end on 720p30, like launch counting at the robot.
- Entry direction into the cell (`attribute.py`): the few points inside the cell are bouncing balls; unusable.
- Robot stillness + change inside the box (`stillshoot.py`): shooters are often still, but 12808 also shot while
  moving (speeds up to 1.6 sizes/s at marked volleys). Weak.
- Yellow smear above the robot (`attribute2.py`) and small motion above a robot relative to its usual
  (`attribute3.py`), in the 1.5 s before each arrival: the best cue. Among the blue robots it picks 12808 at
  ~11 of 15 marked volleys (2 of the misses are volleys where 12808's track had a gap), and the partner at the
  unmarked ones in most cases. The clearest case (60 s) shows the smear plainly in a single frame.
  Fails when the ball goes up in front of the white hive, and when another robot or a person moves above the box.
- Honest status: scored balls per *alliance* per volley are solid; per *robot* the automatic cue is ~75% right.
- Proposed design (needs the user's OK): hive counter gives each volley; the smear/motion cue attributes it with a
  margin; volleys with a clear margin are assigned, the rest are shown as one screenshot with the two alliance
  robots boxed at the launch moment ("who shot this?"), one tap each; those taps become training labels for a
  small "shooting now?" classifier on robot crops, which should replace the taps after a few matches. Per-team
  counts are shown as sure + unsure until resolved.

**2026-11-23 (night): the streams are 1080p, and that changes the launch problem**
- `yt-dlp -F` on the test streams: Oregon league, Netherlands, Michigan, Iowa, Ohio all offer **1920x1080** (format 137);
  only the Oregon scrimmage and Alabama are 720p. The helper fetched format 136 (720p) to save bandwidth and the
  plan wrongly recorded "720p max".
- At 1080p, 30 fps, the balls leaving a robot are plainly visible as separate yellow balls above it for several
  frames (`tools/debug/burst/h60_sheet.png`, 59.8-60.6 s of Q1). The plate on that robot reads **11703**: the user's
  mark at 60.4 s ("team") was the partner. Hand marks are not truth.
- `tools/flights1080.py` (chroma-change yellow blobs above a robot, linked over 3+ frames, rising): on a 30 s 1080p
  clip of Q1 it finds launch clusters per robot that precede the hive arrivals for both alliances
  (robot 1 = 11703: 7 launches 58.9-60.9 → blue +1 at 60.85 after the tip; robot 3 = 14687: 4 launches 63.6-64.5 →
  red +1 at 64.55; robot 0 = 11556: 66.0 → red +1 at 66.45). Counts over-read (misses, balls bouncing out) and
  need reconciling with the hive counts.
- Design now: pass 1 at 720p/10 fps as today (tracks, hive volleys + tips). Pass 2: for each volley, a 1080p 30 fps
  burst of the 1.5 s before it (~24 bursts x 1.5 s per match, ~15 MB) → launches per robot → the volley goes to the
  robot whose launch cluster precedes it; the hive count stays the number of balls scored. Launched per robot =
  its launch clusters (with misses), scored per robot = attributed arrivals.
- Dead ends recorded above (720p attribution cues, MIL classifier) stay recorded: at 720p the information is not there.
- Q1 at 1080p, per volley (`tools/attr1080.py` → `attribute_final.py`, alliance of each track fixed by hand from plates):
  blue 26 volleys, 17 with a clear winner (confidence ≥ 0.6), red 12 volleys, 9 clear. Flight clusters agree with the
  winner wherever they fire. Per robot: 12808 ≈ 23 sure + 2 unsure balls (16 volleys), 11703 ≈ 13 + 3, of the blue
  hive's 41; red 11556 ≈ 8 + 1, 14687 ≈ 4 + 1 of 14. The unsure volleys are the ones where both alliance robots sit
  under the hive and shoot in turn.
- Two things the app must get right for per-team numbers, both now feasible at 1080p: (1) which track is which
  team: plates are readable by eye in 1080p frames (11703, 12808) → a plate reader on 1080p crops should replace the
  "which one is your team" tap; (2) alliance of every track: from the start positions (red side / blue side at 0 s)
  carried along by appearance linking; inferring it from launch evidence alone was wrong for 2 of 12 tracks.
- Next build (pass 2 in the helper): fetch 1080p (format 137) bursts of 1.6 s before each hive volley, run the
  above-robot evidence + flight tracker on them, fuse per volley with the alliance constraint; show per-team
  scored = sure + unsure; read plates from the same 1080p bursts.
- App port done (`vision/launchEvidence.ts`, `analysis/attribution.ts`, `helper/ffmpeg.ts` reads any size,
  `helper/youtube.ts` resolves 1080p (format 137) on request, `scripts/eval-pass2.ts`): Q1 → 30 of 38 volleys with a
  clear shooter, pass 1 40 s + pass 2 47 s on the M5. Not yet wired into the helper jobs; alliance per track and the
  hive boxes are still given by hand.
- Helper pass 2 live (`helper/jobs.ts attributeMatch`): job for 12808, 2 matches from YouTube: Q-14 16/20 volleys
  attributed, Q-18 31/38, ~2.5 min total incl. 1080p bursts. Report gets `scoring` (alliance balls/volleys/tips,
  per-volley robot + confidence, team/partner sure+unsure); page shows "Pollen scored" and "Alliance pollen".
  Gap found: the team's count only uses the identified track pieces; the alliance's other pieces count as the
  partner. Needed: assign every piece of the alliance to one of its two robots (time overlap = different robots,
  then appearance + handover), so team vs partner is a full split.
- Team vs partner (`analysis/pieces.ts splitAlliance`): the team's identified piece seeds robot A; pieces that overlap
  it in time are the partner; the rest go by looks + reachability; weak placements count as unsure. Report shows the
  team's pollen as "sure–possible". Offline on Q1 (seed = the 12808 piece): team 17 sure + rest unsure of the blue 41;
  Q5: team 22 sure, partner 10, of 35. Live YouTube retest pending (rate limit after the day's fetches).
- Honest state of the team/partner split (Q1, seed = 12808 piece): team 7 sure + 21 possible, partner 3 + 10, of 41.
  The per-volley shooter is clear ~85% of the time; what is NOT solid is which track pieces belong to which robot
  (the tracker swaps and duplicates pieces when both alliance robots sit under the hive). This is now the main lever:
  read the team-number plates from the 1080p bursts (readable by eye: 11703, 12808) to pin every piece to a team,
  which also replaces the "which one is your team" tap. Then the team's count collapses to one number.
- Team vs partner decided at the moment of the shot (`analysis/whoShot.ts`): the shooter's crop in the 1080p burst
  is embedded and compared with the nearest identified-team piece vs the nearest partner piece; the chain decides
  only when looks are close. Offline: Q5 team 22 sure, partner 13, of 35, nothing unsure; Q1 team 22 sure + 13
  unsure, partner 2 + 4 (two dark, similar robots side by side: looks are weak there). Plate reading stays an
  optional extra cue (user: don't rely on it). Wired into the helper (`scoringFor` → `callVolleys`).
- Plate reading tried (`scripts/_plates.ts`, Tesseract on 4x-upscaled 1080p robot crops, digits only): reads nothing
  usable (one stray "3" in 20 crops) although the plates are legible by eye. Would need its own small digit model
  trained on plate crops; parked as an optional cue, as agreed, not relied on.
- Live helper retest after the day's changes is blocked: YouTube asks this computer to sign in ("not a bot") after
  the many fetches today. Retry later; the offline two-pass eval on the local clips exercises the same code.
- `FTC_YT_BROWSER=safari` fails from a terminal: macOS denies reading Safari's cookie file ("Operation not permitted")
  unless the terminal app has Full Disk Access; no other browser is installed. Live retest waits for YouTube's limit
  to clear (or for the user to run the helper from a Terminal with Full Disk Access).

**2026-11-24: robustness pass across cameras**
- Launch pass falls back to 720p bursts when a stream has no 1080p (Q1 at 720p: 27/35 volleys clear vs 29/35 at 1080p).
- Whole two-pass pipeline run on the other local clips: Netherlands (1 volley, right), scrimmage Q1/Q10 (10 and 22
  volleys, plausible). The hive watcher now ignores yellow inside tracked robot boxes.
- Known limitation, top-down cameras (Michigan): the hive sits over the robots' paths, the hive rotates during the
  match and the BIOBUZZ sign ends up inside the box; robots carrying balls pass under it. The counter reports
  ~20-30 volleys where 1-2 pollen were scored. Tried: stricter pollen colour (loses real balls in side views),
  olive-sign exclusion with/without size+shape (same), 6 s persistence / sticky scenery with hysteresis (no gain on
  top-down, −10% balls on side views), longer plateau hold (loses real volleys). Kept only the robot-box exclusion.
  A top-down-specific counter (count discs inside the cell outlines, robots excluded) is the right fix later.
- Live retest still blocked (2026-11-24): `--print duration` works again but resolving media links still hits the
  "not a bot" check, also with `--js-runtimes node` (yt-dlp 2026.10.26 wants a JS runtime; Node is accepted, no
  deno needed). The block is on the player API for this IP; it should clear with time.
- Live retest done (2026-11-24, YouTube open again): job for 12808, Q-14 and Q-18 from the stream, launch pass at
  1080p, 16/20 and 31/38 volleys attributed, ~2.5 min. Alliance pollen Q-14 blue 34 (4 tips), Q-18 blue 38 (7 tips).
  Suspicious: the team gets only its first 3-5 volleys, the partner all later ones, in both matches — the team's
  identified pieces are early ones and later pieces look "partner" by appearance. Investigating with a 1080p Q-18 clip.
- Team vs partner, settled order: (1) the shooter's track piece's chain when sure; (2) "one place at a time": when a
  surely-team piece is on screen elsewhere at the shot, the shooter is the partner (and vice versa) — this
  resolved Q1 to team 22 sure + 5 possible, partner 15; (3) looks only when very clear (≥ 0.15): the 128 px
  embeddings lean to whichever side has more or later crops (Q-18: every dark-robot volley came out "partner").
  Measured and dropped: burst-crop references (polluted by swapped long tracks), 2-means clustering of shot looks
  (collapses). Unresolved volleys count as possible for both robots: the page shows sure–possible.
- Tracker: a detection overlapping (IoU > 0.45) a track already updated this frame no longer starts a duplicate
  track (ground-truth tracking unchanged at 95% / 85%; Q1 10 pieces instead of 13).
- Live five-match run (12808 Q1/5/9/14/18, 2026-11-24): Q5 37 balls / team 9–15, Q14 34 / 10–25, Q18 38 / 9–27 fine,
  but Q1 and Q9 counted 8 and 1 balls: the hive finder returned 60 px boxes (one cell) on the helper's frames. The
  helper's parallel fetch hands over re-encoded JPEG frames (q 3), which soften the thin red tubes; on the raw clips
  the same frames are found fine. Fixes: looser tube colours, partial boxes grown to hive proportions (1.3x taller
  than wide), group width 5–15% of the picture, a penalty for red things low in the picture (a parked red robot
  won once), and the analysis now takes up to 12 looks and the largest agreeing set. Regression on raw clips:
  Q1 37 volleys, Q5 36, Q9 41, Michigan/Netherlands unchanged.

**2026-11-24 overnight summary (user asleep, working unattended)**
Done: 720p fallback for the launch pass; hive watcher ignores robot boxes; hive finder hardened for the helper's
JPEG frames (live Q1/Q9 now 37 and 56 alliance balls, same as offline); hive looked for before the start (auto
volleys caught); team vs partner settled as chain → one-place-at-a-time → looks only when very clear, with honest
sure–possible ranges; no duplicate tracks; pass-2 bursts fetched 3 at a time; per-volley timeline and a pollen
summary on the page; 9 regression tests; `scripts/check-all.ts`. Dead ends measured and recorded: burst-crop
references, 2-means of shot looks, longer plateau holds, colour/persistence rules for the top-down sign.
Open: top-down cameras over-count alliance pollen (disc counter dev tool is right on Michigan; not integrated);
the 15% of volleys where both alliance robots are active stay possible-for-both; YouTube's link resolving limit
is hit after ~10 helper runs in a day from one IP (the two cheap mitigations are still "not now" per the user).
- Baseline (`check-all quick`, pass 2 on 720p): or1 36 volleys/6 tips, 29/36 clear; or5 40/6, 35/40; or9 44/7, 28/44;
  or18 46/14, 42/46; q10 24/5, 21/24; m1 12/2, 11/12; nlron 21/9 (top-down, over-counts); micoq 31/9 (top-down, over-counts).
- Cameras looking down: when ≥ 8% of the robots' track points fall inside the hive box, the hive is counted in
  disc mode (ball-sized round yellow blobs, a count must hold 2 s). Michigan: 31 → 3 volleys (true 1-2). Side views
  unchanged. Netherlands (high angle, hive at the far end) does not trigger the mode and still over-counts (21).
- Hive samples with a robot over most of the box are treated as missing (not zero): the Netherlands camera had a
  robot parked next to the far hive toggling the count (21 → 13 volleys). One ball's area is now measured from lone
  round blobs seen in the box, used only above the box-size guess (from the side lone blobs are fragments):
  Netherlands 13 → 5 volleys (true ~2), Michigan 3, Oregon unchanged (36 / 40).
- Regression after the night's hive work (`check-all quick`): or1 36/6 29 clear; or5 40/6 35; or9 44/7 28; or18 43/14
  39; q10 24/5 21; m1 13/2 9; nlron 5/0 4; micoq 3/1 1. Top-down matches now at their true scale.

**2026-11-24 (evening, Linux laptop): the "clear shooter" gap between machines was alliance labelling**
- Same code and models give different `check-all` numbers on the Mac (M5) and Linux (x86): or18 43 volleys / 39 clear
  vs 42 / 34. Each machine is repeatable run to run; tiny numeric differences (ffmpeg build, onnxruntime x86 vs ARM)
  change which track pieces join which robot group. Per volley on or18, 7 of 42 shooters were a different robot
  and 6 red volleys had no candidate at all on Linux, many at confidence 1.00 on both machines.
- Cause: a group whose first piece starts after the first 4 s got its alliance from the marking colour, which reads
  blue for nearly every robot (blue tape and walls behind them). Old labelling had 3-4 robots of one alliance on
  screen at once for 83% (Linux) / 59% (Mac) of or18 and 37% / 74% of or9 — impossible in the game.
- `scripts/cache-pass1.ts` saves pass 1 once; `scripts/eval-alliance.ts` scores alliance labelling without labels
  (over-full time, labelled share, agreement between two caches of the same match) on 6 matches x 2 machines.
- Fix shipped: no colour fallback (`groupAlliances`); unknown pieces get their alliance from the hive their launches
  feed (attribution.ts) or stay unknown. Over-full 0% on all 6; Mac/Linux label agreement 86-100% (was 77-100%).
  Linux pass 2 (720p): or18 6 no-robot volleys → 0, clear 34 → 41; or5 same; or9 clear 34 → 32; or1, q10 same; m1 10 → 9.
- Tried and kept as a dev option only: `analysis/alliances.ts` (4 starting robots as slots, later pieces handed to
  a free slot by reach + looks): labels more robot-time but one different hand-off carries through the match
  (or9 agreement 69%). Truth for alliances per piece is still missing; frames at 720p are too small to read
  markings by eye. Cross-machine shooter agreement with the fix is not measured yet (Mac went to sleep mid-run).
- **Hand labels say the shooter call is mostly wrong (2026-11-24).** Labelling page `tools/gt/shooters`
  (click the robot that shot, on 1080p clips of the 2.5 s before a volley). The owner labelled the 18 or18 clips
  (16 shooters, 2 "no launch"; 12 where Mac and Linux picked different robots, 4 where they agreed):
  Linux 9/16 right before the colour change, 3/16 after; Mac 5/16 both ways; even where both machines agreed only
  1-2 of 4 were right; of volleys marked clear (confidence ≥ 0.6) the Mac got 5/15 right. So "~85% of volleys
  have a clear shooter" was a confidence, not an accuracy: on or18 the per-robot split is not usable yet.
  The colour-fallback removal was reverted (scored worse); the alliance tools stay. Two of the Mac's picks
  were a person standing outside the field. Next: labels on or5/or9 (28 clips ready) and a random, unbiased
  sample of volleys, then rework attribution against those labels (`score.py`).

**2026-11-25 (night, Linux laptop): hive tips from the see-saw's position, measured against official tips**
- Truth without the owner: official tips per alliance (FTCScout match results: autoHiveTips, dcHiveTips) for 11 local
  clips, matched by reading the overlay's match name (`tools/gt/tips.json`; m1 = USORHIN Q1, nlron = NLRON Q12,
  micoq = USMICOQ Q12, new: USMICOQ Q21, USALATQ Q4, USIADAIM1 Q10). Official scores are used only to measure.
- The yellow-area counter misses tips: 42 of 52 found on 8 matches (|error| 14). A missed tip also shifts the
  ball counts around it (the cell empties, the next rise is counted from the wrong level).
- New: `seesawFlips` (vision/hive.ts). The see-saw rests in one of two positions and every tip flips it. Each hive
  sample now carries two small pictures of the see-saw (tube colour 12x12, brightness 16x16); samples are split
  into two positions (2-means) per picture kind, the cleaner split wins (blue tubes vanish against a blue wall,
  the tag panel never does), ambiguous samples are ignored, a position must hold 1.2 s.
  8 matches: 49 found of 52, |error| 9 (area 14), auto |error| 2 (area 4); or18 16/16, or1 10/10, or5 8/8.
  Misses: q10 blue 0/5, or9 red 5/6; extra: nlron blue +2, micoq blue +1 (hives with 0 official tips).
- Not wired into the app yet. Tools: `scripts/cache-all.sh` (caches with raw samples), `scripts/eval-tips.ts`.
