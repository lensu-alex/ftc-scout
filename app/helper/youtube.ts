// Direct 720p media URL for a YouTube video (via yt-dlp). Only the needed parts are ever fetched.
import { execFile } from "node:child_process";
import { installYtdlp, updateYtdlp, ytdlpPath } from "./bins";

let ready: Promise<string> | null = null;
function ytdlp(): Promise<string> {
  ready ??= (async () => {
    const p = ytdlpPath() ?? await installYtdlp();
    updateYtdlp(p);
    return p;
  })();
  return ready;
}

// Media links stay valid for hours: asking YouTube once per video (not once per job) keeps the
// helper far below the rate at which YouTube starts asking "are you a bot?".
const cache = new Map<string, { at: number; v: { url: string; duration: number; title: string; height: number } }>();
const KEEP_MS = 4 * 3600 * 1000;

/** height 720 (default, pass 1) or 1080 (short bursts for launch attribution; most streams have it). */
export async function resolveStream(id: string, fresh = false, height: 720 | 1080 = 720): Promise<{ url: string; duration: number; title: string; height: number }> {
  const key = `${id}@${height}`;
  const hit = fresh ? undefined : cache.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.v;
  const bin = await ytdlp();
  // optional, off by default: use the YouTube login of the user's own browser (reads its cookies)
  const browser = process.env.FTC_YT_BROWSER;
  const out = await new Promise<string>((res, rej) => execFile(bin,
    ["-q", "--no-warnings", ...(browser ? ["--cookies-from-browser", browser] : []),
      "-f", height === 1080 ? "137/bv*[height<=1080][ext=mp4]/136/bv*[height<=720]" : "136/22/bv*[height<=720]/b[height<=720]", "--print", "duration", "--print", "title", "--print", "height", "--print", "urls",
      `https://www.youtube.com/watch?v=${id}`], { timeout: 90000 },
    (err, stdout, stderr) => err ? rej(new Error(friendly(stderr.trim().split("\n").pop() || err.message))) : res(stdout)));
  const [duration, title, h, url] = out.trim().split("\n");
  const v = { url, duration: +duration, title, height: +h || height };
  cache.set(key, { at: Date.now(), v });
  return v;
}

function friendly(msg: string) {
  if (/not a bot/i.test(msg)) {
    return "YouTube is temporarily limiting this computer (too many requests). Try again later, or start the helper with " +
      "FTC_YT_BROWSER=safari (or chrome/firefox) to use your browser's YouTube login.";
  }
  return msg;
}
