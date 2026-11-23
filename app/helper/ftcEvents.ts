// Backup data source: the official FTC Events API (needs a free key from
// https://ftc-events.firstinspires.org/services/API). Used when FTCScout is down.
// Key: env FTC_EVENTS_USER / FTC_EVENTS_TOKEN, or ~/.ftc-scout/config.json {"ftcEventsUser","ftcEventsToken"}.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HOME } from "./bins";
import type { EventInfo, MatchTeam, TeamMatch, TeamSummary } from "../src/api/ftcscout";

const BASE = "https://ftc-api.firstinspires.org/v2.0";

function auth(): string | null {
  let user = process.env.FTC_EVENTS_USER, token = process.env.FTC_EVENTS_TOKEN;
  const cfg = join(HOME, "config.json");
  if ((!user || !token) && existsSync(cfg)) {
    const c = JSON.parse(readFileSync(cfg, "utf8"));
    user ??= c.ftcEventsUser; token ??= c.ftcEventsToken;
  }
  return user && token ? `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}` : null;
}

export const ftcEventsConfigured = () => auth() !== null;

async function get<T>(path: string): Promise<T> {
  const a = auth();
  if (!a) throw new Error("FTC Events API key not set up");
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: a, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`FTC Events API ${r.status}`);
  return r.json() as Promise<T>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const station = (s: string): Pick<MatchTeam, "alliance" | "station"> =>
  ({ alliance: s.startsWith("Red") ? "Red" : "Blue", station: s.endsWith("2") ? "Two" : "One" });
const level = (l: string) => /QUAL/i.test(l) ? "Quals" : /FINAL/i.test(l) ? "Finals" : "Playoffs";

function eventInfo(e: any): EventInfo {
  return {
    code: e.code, name: e.name, start: (e.dateStart ?? "").slice(0, 10), end: (e.dateEnd ?? "").slice(0, 10),
    timezone: e.timezone ?? "UTC", liveStreamURL: e.liveStreamUrl ?? null,
    livestreamsByDay: (e.webcasts ?? []).filter((w: any) => typeof w === "string").map((w: string) => ({ day: (e.dateStart ?? "").slice(0, 10), liveStreamURL: w })),
  };
}

export async function team(season: number, n: number): Promise<TeamSummary> {
  const d = await get<any>(`/${season}/teams?teamNumber=${n}`);
  const t = d.teams?.[0];
  if (!t) throw new Error(`team ${n} not found`);
  return { number: t.teamNumber, name: t.nameShort ?? t.nameFull, city: t.city, country: t.country };
}

async function eventResults(season: number, code: string) {
  const [q, p] = await Promise.all(["qual", "playoff"].map(l => get<any>(`/${season}/matches/${code}?tournamentLevel=${l}`).catch(() => ({ matches: [] }))));
  return [...q.matches, ...p.matches] as any[];
}

export async function teamMatches(season: number, n: number): Promise<{ team: TeamSummary; matches: TeamMatch[] }> {
  const [t, ev] = await Promise.all([team(season, n), get<any>(`/${season}/events?teamNumber=${n}`)]);
  const out: TeamMatch[] = [];
  for (const e of ev.events ?? []) {
    const info = eventInfo(e);
    for (const m of await eventResults(season, e.code)) {
      const me = (m.teams ?? []).find((x: any) => x.teamNumber === n);
      if (!me || me.onField === false) continue;
      const lv = level(m.tournamentLevel);
      out.push({
        key: `${e.code}-${lv}-${m.series ?? 0}-${m.matchNumber}`, eventCode: e.code, matchId: m.matchNumber, matchNum: m.matchNumber,
        series: m.series ?? 0, level: lv, description: m.description, actualStartTime: m.actualStartTime ?? null, played: true,
        ...station(me.station),
        teams: m.teams.map((x: any) => ({ teamNumber: x.teamNumber, ...station(x.station) })), event: info,
      });
    }
  }
  out.sort((a, b) => (a.actualStartTime ?? "").localeCompare(b.actualStartTime ?? ""));
  return { team: t, matches: out };
}

export async function eventMatches(season: number, code: string) {
  return (await eventResults(season, code)).map(m => ({
    id: m.matchNumber, matchNum: m.matchNumber, series: m.series ?? 0, tournamentLevel: level(m.tournamentLevel),
    description: m.description, actualStartTime: m.actualStartTime ?? null,
  }));
}
