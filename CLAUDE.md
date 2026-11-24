# ftc-scout

Scouts FTC teams (BIOBUZZ / DECODE season) from match video. Read `HANDOFF.md` first (current state + next step),
then `PLAN.md` (goal, progress log, dead ends already measured: don't redo them). `README.md` covers how to run.

- Worked on from two machines: MacBook (`~/Developer/ftc-scout`) and Linux laptop (`~/Projects/ftc-scout`).
  GitHub `main` is the source of truth; finish every session by updating `HANDOFF.md`, committing and pushing.
- Large dev data is gitignored (`tools/clips`, `tools/clips1080`, `tools/models`, `tools/dataset`, ...).
  The synced folders are listed in `.sync-data`; copy them between the laptops with `proj data pull|push`
  (claude-sync, over Tailscale; see the `sync-data` skill).
- Checks: `cd app && npx tsc -b && npx vitest run`; vision regression `npx tsx scripts/check-all.ts quick`
  (needs the clips; compare with the latest baseline in PLAN.md).
- The owner's rules: keep the pipeline light (PLAN §0.1); report honest ranges, not guesses; plate reading is an
  optional cue only. Heavy YouTube fetching from one IP triggers "not a bot" blocks: both machines share the home IP.
- Keep code and scripts portable: no hard-coded `/Users/...` or `/home/...` paths, bash not zsh.
