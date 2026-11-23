// FTCScout public API (no key needed, CORS enabled).
// Only schedule / participation / timing data is used. Official scores are NOT used for analysis.

const GQL = "https://api.ftcscout.org/graphql";
const REST = "https://api.ftcscout.org/rest/v1";
export const SEASON = 2026; // BIOBUZZ

export interface TeamSummary { number: number; name: string; city?: string; country?: string }

export interface MatchTeam { teamNumber: number; alliance: "Red" | "Blue"; station: "One" | "Two" }

export interface EventInfo {
  code: string;
  name: string;
  start: string;
  end: string;
  timezone: string;
  liveStreamURL: string | null;
  livestreamsByDay: { day: string; liveStreamURL: string }[];
}

export interface TeamMatch {
  key: string;                 // `${eventCode}-${matchId}`
  eventCode: string;
  matchId: number;
  matchNum: number;
  series: number;
  level: "Quals" | "Playoffs" | "DoubleElim" | "Finals" | string;
  description: string;         // e.g. "Q-7"
  actualStartTime: string | null;
  played: boolean;
  alliance: "Red" | "Blue";
  station: "One" | "Two";
  teams: MatchTeam[];
  event: EventInfo;
}

const DOWN = "The FTCScout data service isn't responding right now (their server, not this app). Try again in a few minutes.";

async function call(url: string, init?: RequestInit, tries = 3): Promise<Response> {
  for (let i = 1; i < tries; i++) {
    try { return await callOnce(url, init); } catch { await new Promise(r => setTimeout(r, 1000 * i)); }
  }
  return callOnce(url, init);
}

async function callOnce(url: string, init?: RequestInit): Promise<Response> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
    if (r.status >= 500 || !(r.headers.get("content-type") ?? "").includes("json")) throw new Error(DOWN);
    return r;
  } catch (e) {
    throw new Error(DOWN, { cause: e });
  }
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await call(GQL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data as T;
}

export async function searchTeams(text: string): Promise<TeamSummary[]> {
  const r = await call(`${REST}/teams/search?searchText=${encodeURIComponent(text)}&limit=20`);
  if (!r.ok) throw new Error(`team search failed (${r.status})`);
  const rows = (await r.json()) as { number: number; name: string; city?: string; country?: string }[];
  return rows.map(t => ({ number: t.number, name: t.name, city: t.city, country: t.country }));
}

const EVENT_FIELDS = "code name start end timezone liveStreamURL livestreamsByDay { day liveStreamURL }";

const HELPER = "http://127.0.0.1:47615";
/** Official FTC Events API through the local helper (it holds the key). */
async function viaHelper<T>(path: string): Promise<T> {
  const r = await fetch(`${HELPER}${path}`, { signal: AbortSignal.timeout(30000) }).catch(() => null);
  if (!r || !r.ok) throw new Error(DOWN);
  return r.json();
}
let helperFallback = typeof window !== "undefined"; // the helper itself calls FTC Events directly

export function disableHelperFallback() { helperFallback = false; }

export async function teamMatches(number: number, season = SEASON): Promise<{ team: TeamSummary; matches: TeamMatch[] }> {
  try {
    return await teamMatchesScout(number, season);
  } catch (e) {
    if (!helperFallback || (e as Error).message !== DOWN) throw e;
    return viaHelper(`/data/team/${number}?season=${season}`);
  }
}

export async function eventMatches(eventCode: string, season = SEASON) {
  try {
    return await eventMatchesScout(eventCode, season);
  } catch (e) {
    if (!helperFallback || (e as Error).message !== DOWN) throw e;
    return viaHelper<Awaited<ReturnType<typeof eventMatchesScout>>>(`/data/event/${eventCode}?season=${season}`);
  }
}

async function teamMatchesScout(number: number, season: number): Promise<{ team: TeamSummary; matches: TeamMatch[] }> {
  const q = `query($n: Int!, $s: Int!) { teamByNumber(number: $n) { number name matches(season: $s) {
      eventCode alliance station onField
      match { id matchNum series tournamentLevel description actualStartTime hasBeenPlayed teams { teamNumber alliance station } }
      event { ${EVENT_FIELDS} } } } }`;
  type Row = { eventCode: string; alliance: "Red" | "Blue"; station: "One" | "Two"; onField: boolean;
    match: { id: number; matchNum: number; series: number; tournamentLevel: string; description: string; actualStartTime: string | null; hasBeenPlayed: boolean; teams: MatchTeam[] };
    event: EventInfo };
  const d = await gql<{ teamByNumber: { number: number; name: string; matches: Row[] } | null }>(q, { n: number, s: season });
  if (!d.teamByNumber) throw new Error(`team ${number} not found`);
  const matches = d.teamByNumber.matches
    .filter(m => m.onField)
    .map(m => ({
      key: `${m.eventCode}-${m.match.id}`, eventCode: m.eventCode, matchId: m.match.id, matchNum: m.match.matchNum,
      series: m.match.series, level: m.match.tournamentLevel, description: m.match.description,
      actualStartTime: m.match.actualStartTime, played: m.match.hasBeenPlayed,
      alliance: m.alliance, station: m.station, teams: m.match.teams, event: m.event,
    }))
    .sort((a, b) => (a.actualStartTime ?? "").localeCompare(b.actualStartTime ?? ""));
  return { team: { number: d.teamByNumber.number, name: d.teamByNumber.name }, matches };
}

/** Every match at an event with its start time: used to turn one on-screen match into a stream offset. */
async function eventMatchesScout(eventCode: string, season: number) {
  const q = `query($c: String!, $s: Int!) { eventByCode(season: $s, code: $c) { matches { id matchNum series tournamentLevel description actualStartTime } } }`;
  const d = await gql<{ eventByCode: { matches: { id: number; matchNum: number; series: number; tournamentLevel: string; description: string; actualStartTime: string | null }[] } | null }>(q, { c: eventCode, s: season });
  return d.eventByCode?.matches ?? [];
}

/** Stream link for the day a match was played (falls back to the event-wide link). */
export function streamFor(m: TeamMatch): string | null {
  const day = m.actualStartTime ? localDay(m.actualStartTime, m.event.timezone) : null;
  const byDay = m.event.livestreamsByDay.find(d => day && d.day.startsWith(day));
  return byDay?.liveStreamURL ?? m.event.liveStreamURL ?? null;
}

function localDay(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** Map the API's level/number to the name the overlay shows, so OCR results can be matched. */
export function overlayKey(level: string, matchNum: number, series: number): string {
  if (level === "Quals") return `Q${matchNum}`;
  if (level === "Finals") return `F${matchNum}`;
  return `P${series || matchNum}`;
}

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (!u.hostname.endsWith("youtube.com")) return null;
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(?:live|embed|shorts)\/([\w-]{6,})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
