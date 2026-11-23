// Finds (or installs once) the two programs the helper needs: ffmpeg (decoding) and yt-dlp (YouTube URLs).
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export const HOME = join(homedir(), ".ftc-scout");
const BIN = join(HOME, "bin");
const require = createRequire(import.meta.url);

function onPath(cmd: string): string | null {
  try {
    return execFileSync(platform() === "win32" ? "where" : "which", [cmd]).toString().split("\n")[0].trim() || null;
  } catch { return null; }
}

export function ffmpegPath(): string {
  const p = process.env.FTC_FFMPEG ?? (require("ffmpeg-static") as string | null) ?? onPath("ffmpeg");
  if (!p || !existsSync(p)) throw new Error("ffmpeg not found: run `npm install` in the app folder");
  return p;
}

const YTDLP_ASSET = { darwin: "yt-dlp_macos", win32: "yt-dlp.exe", linux: "yt-dlp_linux" } as Record<string, string>;
const ytdlpLocal = join(BIN, platform() === "win32" ? "yt-dlp.exe" : "yt-dlp");

export function ytdlpPath(): string | null {
  return process.env.FTC_YTDLP ?? (existsSync(ytdlpLocal) ? ytdlpLocal : onPath("yt-dlp"));
}

/** Download the standalone yt-dlp release (one file, no Python needed) into ~/.ftc-scout/bin. */
export async function installYtdlp(): Promise<string> {
  const asset = YTDLP_ASSET[platform()];
  if (!asset) throw new Error(`no yt-dlp build for ${platform()}`);
  mkdirSync(BIN, { recursive: true });
  const r = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`);
  if (!r.ok) throw new Error(`yt-dlp download failed (${r.status})`);
  writeFileSync(ytdlpLocal, Buffer.from(await r.arrayBuffer()));
  chmodSync(ytdlpLocal, 0o755);
  return ytdlpLocal;
}

/** Keep yt-dlp current: YouTube changes often and old versions stop working. */
export function updateYtdlp(p: string) {
  try { execFileSync(p, ["-U"], { stdio: "ignore", timeout: 60000 }); } catch { /* not fatal */ }
}
