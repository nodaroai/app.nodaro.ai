/**
 * Which yt-dlp binary the platform runs — one answer for every path that starts
 * it (`youtube-video.ts`'s direct spawns, `ytdlp-options-run.ts`'s audio lanes,
 * `trim-audio.ts` through `youtube-dl-exec`).
 */
import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

const isWindows = process.platform === "win32"
const require = createRequire(import.meta.url)

/**
 * Resolve the yt-dlp binary — in the SAME order `youtube-dl-exec` itself does,
 * so the library-based callers (trim-audio, youtube-extractor, youtube-audio,
 * workers/shared) and this direct-spawn path can never disagree about which
 * binary runs.
 *
 * WHY this is not just `<pkg>/bin/yt-dlp`: the image sets
 * `YOUTUBE_DL_SKIP_DOWNLOAD=1` (deps AND prod-deps stages), which tells
 * `youtube-dl-exec`'s postinstall NOT to fetch that binary — deliberately, since
 * a system yt-dlp was apt-installed instead. But nothing ever pointed the code at
 * the system one, so every yt-dlp path in the platform spawned a file that does
 * not exist and died with `ENOENT`, silently (see the route's catch). The image
 * now installs the official pinned binary and sets `YOUTUBE_DL_DIR`; honour that
 * first, then the bundled copy (local dev, where the download is not skipped),
 * then a bare PATH lookup.
 */
export function resolveYtDlpBin(env: NodeJS.ProcessEnv = process.env): string {
  const name = `yt-dlp${isWindows ? ".exe" : ""}`
  if (env.YOUTUBE_DL_DIR) {
    const fromEnv = join(env.YOUTUBE_DL_DIR, env.YOUTUBE_DL_FILENAME ?? name)
    if (existsSync(fromEnv)) return fromEnv
  }
  const bundled = join(
    dirname(require.resolve("youtube-dl-exec/package.json")),
    "bin",
    name,
  )
  if (existsSync(bundled)) return bundled
  // Last resort: let the OS find it on PATH rather than spawning a path we
  // already know does not exist (which is what produced the silent ENOENT).
  return name
}

let resolved: string | undefined

/** The yt-dlp this process runs, resolved on first use and then fixed — lazily, so importing a module that merely RUNS yt-dlp touches no file system. */
export function ytDlpBin(): string {
  resolved ??= resolveYtDlpBin()
  return resolved
}
