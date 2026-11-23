// Browser end-to-end test of link mode in Chromium (auto-accepts tab sharing).
// SAFARI=1 hides Region Capture so the marker calibration path is used, like in Safari/Firefox.
// usage: tsx scripts/e2e-browser.ts <team> [matches] [minutes]
import { chromium } from "playwright-core";

const [team, n = "2", minutes = "8"] = process.argv.slice(2);
const browser = await chromium.launch({
  headless: false,
  args: ["--auto-accept-this-tab-capture", "--autoplay-policy=no-user-gesture-required", "--window-size=1400,1000"],
});
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
if (process.env.SAFARI) await page.addInitScript(() => { delete (window as any).CropTarget; });
page.on("console", m => { if (m.type() === "error") console.log("console:", m.text().slice(0, 200)); });
await page.goto(`http://localhost:4173/?team=${team}`);
await page.waitForSelector("input[type=number]", { timeout: 30000 });
await page.fill("input[type=number]", n);
await page.click("button.primary");
const end = Date.now() + +minutes * 60000;
let last = "";
while (Date.now() < end) {
  await page.waitForTimeout(5000);
  const status = await page.$$eval(".matches tbody tr", rows => rows.map(r => r.textContent));
  const log = await page.$eval(".log", e => e.textContent).catch(() => "");
  const snap = status.join(" | ");
  if (snap !== last) { console.log(new Date().toISOString().slice(11, 19), snap); last = snap; }
  if (status.every(s => /done|not in this stream|error/.test(s ?? ""))) { console.log("LOG:\n" + log); break; }
}
await page.screenshot({ path: "../tools/debug/e2e.png", fullPage: true });
await browser.close();
