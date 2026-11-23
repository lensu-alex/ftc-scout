// FTC Scout helper: runs match analysis in the background on this computer.
// The web app talks to it on http://127.0.0.1:47615. Nothing is stored on disk.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { cancelJob, confirmRobot, createJob, getJob, listJobs } from "./jobs";
import * as ftcEvents from "./ftcEvents";

export const PORT = Number(process.env.FTC_HELPER_PORT ?? 47615);
const VERSION = "0.1.0";
// pages allowed to use the helper: the local dev/preview server (+ the hosted app later)
const ALLOWED = [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

function send(req: IncomingMessage, res: ServerResponse, code: number, body?: unknown) {
  const origin = req.headers.origin ?? "";
  if (ALLOWED.some(r => r.test(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function body(req: IncomingMessage) {
  let s = "";
  for await (const c of req) { s += c; if (s.length > 2e6) throw new Error("request too large"); }
  return JSON.parse(s || "{}");
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    const [, a, id] = url.pathname.split("/");
    if (req.method === "OPTIONS") return send(req, res, 204);
    if (a === "health") return send(req, res, 200, { ok: true, version: VERSION, ftcEvents: ftcEvents.ftcEventsConfigured() });
    if (a === "data") {
      // backup match data from the official FTC Events API (when FTCScout is down)
      const season = Number(url.searchParams.get("season") ?? 2026);
      const rest = url.pathname.split("/").slice(3).join("/");
      if (id === "team") return send(req, res, 200, await ftcEvents.teamMatches(season, Number(rest)));
      if (id === "event") return send(req, res, 200, await ftcEvents.eventMatches(season, rest));
    }
    if (a === "jobs" && req.method === "POST" && !id) {
      const { videoId, matches } = await body(req);
      if (typeof videoId !== "string" || !/^[\w-]{6,}$/.test(videoId) || !Array.isArray(matches) || !matches.length)
        return send(req, res, 400, { error: "videoId and matches required" });
      const j = createJob(videoId, matches);
      return send(req, res, 201, { id: j.id });
    }
    if (a === "jobs" && req.method === "POST" && id && url.pathname.endsWith("/confirm")) {
      const { matchKey, trackId, add } = await body(req);
      if (typeof matchKey !== "string" || !Number.isInteger(trackId)) return send(req, res, 400, { error: "matchKey and trackId required" });
      await confirmRobot(id, matchKey, trackId, add === true);
      return send(req, res, 200, { ok: true });
    }
    if (a === "jobs" && !id) return send(req, res, 200, listJobs().map(j => ({ id: j.id, state: j.state, videoId: j.videoId })));
    if (a === "jobs" && req.method === "GET") {
      const j = getJob(id);
      return j ? send(req, res, 200, j) : send(req, res, 404, { error: "no such job" });
    }
    if (a === "jobs" && req.method === "DELETE") { cancelJob(id); return send(req, res, 200, { ok: true }); }
    send(req, res, 404, { error: "not found" });
  } catch (e) {
    send(req, res, 500, { error: (e as Error).message });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`FTC Scout helper ${VERSION} running on http://127.0.0.1:${PORT}`);
  console.log("Leave this running; open the FTC Scout page in any browser. Ctrl+C to stop.");
});
