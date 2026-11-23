// Client for the background helper running on this computer (see app/helper).
import type { TeamMatch } from "./ftcscout";
import type { MatchReport } from "../analysis/report";

const BASE = "http://127.0.0.1:47615";

export type HelperMatchStatus =
  | { state: "waiting" } | { state: "locating" } | { state: "not-found" }
  | { state: "analysing"; start: number; progress: number }
  | { state: "done"; start: number; report: MatchReport }
  | { state: "error"; message: string };

export interface HelperJob {
  id: string;
  videoId: string;
  title?: string;
  state: "queued" | "running" | "done" | "error" | "cancelled";
  error?: string;
  status: Record<string, HelperMatchStatus>;
  log: string[];
}

export async function helperAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function startJob(videoId: string, matches: TeamMatch[]): Promise<string> {
  const r = await fetch(`${BASE}/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId, matches }) });
  if (!r.ok) throw new Error((await r.json()).error ?? `helper error ${r.status}`);
  return (await r.json()).id;
}

export async function listJobs(): Promise<{ id: string; state: HelperJob["state"]; videoId: string }[]> {
  const r = await fetch(`${BASE}/jobs`);
  return r.ok ? r.json() : [];
}

export async function getJob(id: string): Promise<HelperJob | null> {
  const r = await fetch(`${BASE}/jobs/${id}`);
  return r.ok ? r.json() : null;
}

export async function cancelJob(id: string) {
  await fetch(`${BASE}/jobs/${id}`, { method: "DELETE" });
}

/** Tell the helper which robot is the team in one match; it re-identifies the other matches too. */
export async function confirmRobot(id: string, matchKey: string, trackId: number, add = false) {
  const r = await fetch(`${BASE}/jobs/${id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matchKey, trackId, add }) });
  if (!r.ok) throw new Error((await r.json()).error ?? `helper error ${r.status}`);
}
