import { chromium } from "playwright-core";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
p.on("pageerror", e => console.log("pageerror:", e.message));
await p.goto("http://localhost:5173/?team=12808");
await p.waitForTimeout(10000);
const card = await p.$("section.card:has(.confirm-done), section.card:has(.confirm-row)");
if (card) await card.screenshot({ path: "../tools/debug/card_now.png" }); else console.log("no card");
await b.close();
