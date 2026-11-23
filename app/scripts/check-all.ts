// Offline regression over the local clips: hive volleys/balls/tips per alliance and clear-shooter share.
// usage: tsx scripts/check-all.ts [quick]   (quick = pass 2 on the 720p clip; otherwise 1080p clips where present)
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
const quick = process.argv[2] === "quick";
const M = [
  { name: "or1", clip: "../tools/clips/or1.webm", start: 15.5, hd: "../tools/clips1080/or1_full.mp4", hdStart: 2.57 },
  { name: "or5", clip: "../tools/clips/or5.webm", start: 15.0, hd: "../tools/clips1080/or5_full.mp4", hdStart: 2.83 },
  { name: "or9", clip: "../tools/clips/or9.webm", start: 10, hd: "", hdStart: 0 },
  { name: "or18", clip: "../tools/clips/or18.mp4.webm", start: 14, hd: "../tools/clips1080/or18_full.mp4", hdStart: 2.18 },
  { name: "q10", clip: "../tools/clips/USORHIN_q10.mp4", start: 3, hd: "", hdStart: 0 },
  { name: "m1", clip: "../tools/clips/m1.mp4", start: 19, hd: "", hdStart: 0 },
  { name: "nlron", clip: "../tools/clips/NLRON_13760.mp4", start: 0, hd: "", hdStart: 0 },
  { name: "micoq", clip: "../tools/clips/USMICOQ_8530.mp4", start: 21, hd: "", hdStart: 0 },
];
console.log("match  | volleys tips | clear shooter | hive (720p box)");
for (const m of M) {
  if (!existsSync(m.clip)) continue;
  const useHd = !quick && m.hd && existsSync(m.hd);
  const args = ["tsx", "scripts/eval-pass2.ts", m.clip, String(m.start), useHd ? m.hd : m.clip, String(useHd ? m.hdStart : m.start), "640,0,810,210", "480,0,640,200"];
  let out = "";
  try { out = execFileSync("npx", args, { encoding: "utf8", env: { ...process.env, PASS2_720: useHd ? "" : "1" }, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
  const vol = /(\d+) volleys, (\d+) tips/.exec(out), clear = /clear volleys: (\d+) \/ (\d+)/.exec(out), hive = /hive (\[.*?\])/.exec(out);
  console.log(`${m.name.padEnd(6)} | ${vol ? `${vol[1].padStart(3)} ${vol[2].padStart(4)}` : "   -    -"} | ${clear ? `${clear[1]}/${clear[2]}`.padStart(13) : "            -"} | ${hive ? hive[1].slice(0, 70) : "-"}`);
}
