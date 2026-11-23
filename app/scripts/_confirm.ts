// dev: open the team page on the latest helper job, screenshot the "which one" card, tap a candidate
import { chromium } from "playwright-core";
const jobs = await (await fetch("http://127.0.0.1:47615/jobs")).json();
const id = jobs[jobs.length - 1].id;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
p.on("console", m => { if (m.type() === "error") console.log("console:", m.text().slice(0, 200)); });
await p.goto("http://localhost:5173/");
await p.evaluate(i => localStorage.setItem("ftcscout.jobs.12808", JSON.stringify([i])), id);
await p.goto("http://localhost:5173/?team=12808");
await p.waitForTimeout(10000);
const card = await p.$(".confirm-row");
if (!card) { console.log("no confirmation asked"); } else {
  await (await p.$("section.card:has(.confirm-row)"))!.screenshot({ path: "../tools/debug/confirm.png" }); await b.close(); process.exit(0);
  const rows = await p.$$(".confirm-row");
  console.log("asking in", rows.length, "match(es)");
  const before = await (await fetch(`http://127.0.0.1:47615/jobs/${id}`)).json();
  const conf = (j: any) => Object.entries(j.status).map(([k, s]: any) => `${k}:${s.report?.team ? (s.report.team.needsConfirmation ? "?" : "ok") + Math.round(s.report.team.confidence * 100) : "-"}`).join(" ");
  console.log("before", conf(before));
  // tap the candidate that is NOT the current guess in the first row (worst case for the test)
  const btn = await rows[0].$(".cand:not(.picked)") ?? await rows[0].$(".cand");
  await btn!.click();
  await p.waitForTimeout(5000);
  const after = await (await fetch(`http://127.0.0.1:47615/jobs/${id}`)).json();
  console.log("after ", conf(after));
  console.log("rows left", (await p.$$(".confirm-row")).length);
}
await p.screenshot({ path: "../tools/debug/confirm_page.png", fullPage: true });
await b.close();
