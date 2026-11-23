import { chromium } from "playwright-core";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
await p.goto("http://localhost:5173/");
await p.evaluate(() => localStorage.removeItem("ftcscout.field.USORSFM1")); // like a browser without field mapping
await p.goto("http://localhost:5173/?team=12808");
await p.waitForTimeout(10000);
const cards = await p.$$("article.result");
for (const c of cards) if ((await c.textContent())!.includes("Q-18")) await c.screenshot({ path: "../tools/debug/q18_card.png" });
await (await p.$(".heatmap"))!.screenshot({ path: "../tools/debug/heat_now.png" });
await b.close();
