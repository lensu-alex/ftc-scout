import { chromium } from "playwright-core";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
await p.goto("http://localhost:5173/");
await p.evaluate(() => localStorage.setItem("ftcscout.jobs.12808", JSON.stringify(["vtgzodf5"])));
await p.goto("http://localhost:5173/?team=12808");
await p.waitForTimeout(12000);
await (await p.$(".heatmap"))!.screenshot({ path: "../tools/debug/heat12808.png" });
await b.close();
