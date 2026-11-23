import { chromium } from "playwright-core";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
await p.goto("http://localhost:5173/?team=12808");
await p.waitForTimeout(10000);
console.log("tiles:", (await p.$$(".tile")).length, "| match results:", (await p.$$("article.result")).length);
await b.close();
