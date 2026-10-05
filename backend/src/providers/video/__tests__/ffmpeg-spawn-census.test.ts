/**
 * EVERY FFMPEG GOES THROUGH ONE LAUNCHER — a build-enforced invariant.
 *
 * ffmpeg's auto-threading counts the host's cores, not the container's CPU
 * quota; on a 2-vCPU box that shows 48 cores a 4K render ran libx264 with 67
 * frame threads and was killed for memory (`ffmpeg-threads.ts`). The box's
 * budget is placed into the argv by `ffmpeg-process.ts`, the one module that
 * starts the ffmpeg binary (decided 2026-10-05: every ffmpeg, not only Apply
 * EDL). A spawn written anywhere else would run with the host's count again,
 * silently — nothing fails until a big render on a quota box runs out of
 * memory. This scan fails the build instead.
 *
 * The scan is textual, and enough: every launch here passes "ffmpeg" as a
 * literal command to a child_process function.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
/** Everything under backend/src — ffmpeg runs from providers, workers, routes,
 *  utils and ee alike, so the scan is not scoped to one folder. */
const SRC_DIR = join(HERE, "..", "..", "..")

/** The one file allowed to start the ffmpeg binary itself. */
const LAUNCHER = "providers/video/ffmpeg-process.ts"

/** A child_process call whose command is the literal `ffmpeg`. */
const DIRECT_LAUNCH = /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)\s*\(\s*["'`]ffmpeg["'`\s]/g

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full)
  }
  return out
}

/** The line of every launch in `source`. Matched over the whole file, not line
 *  by line: a call Prettier wraps (`execFile(` then `"ffmpeg",` on the next
 *  line) has no single line holding both halves, and `\s*` spans the newline. */
function launchLines(source: string): number[] {
  const lines: number[] = []
  for (const m of source.matchAll(DIRECT_LAUNCH)) {
    lines.push(source.slice(0, m.index).split("\n").length)
  }
  return lines
}

describe("ffmpeg launch census", () => {
  it("recognizes every way a file could start ffmpeg itself", () => {
    // Guards the matcher: a regex that matched nothing would make the scan
    // below a test that can never fail.
    const sample = [
      `const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] })`,
      `execFile('ffmpeg', ["-version"], cb)`,
      "spawnSync(`ffmpeg`, args)",
      `execFileSync("ffmpeg", ["-i", out], { stdio: "ignore" })`,
      `exec("ffmpeg -i a.mp4 out.mp4")`,
      `execSync(  "ffmpeg", [])`,
      // Prettier breaks a long call across lines — the shape thumbnail.ts had
      // before every ffmpeg moved to the launcher. Reported at the call's line.
      `await execFile(`,
      `  "ffmpeg",`,
      `  ["-ss", String(time), "-i", input, "-frames:v", "1", output],`,
      `  { timeout: 30_000 },`,
      `)`,
    ].join("\n")
    expect(launchLines(sample)).toEqual([1, 2, 3, 4, 5, 6, 7])
    // ffprobe, and ffmpeg named only as data, are not launches.
    expect(launchLines(`spawn("ffprobe", args)\nconst bin = "ffmpeg-static"\nlabel: "ffmpeg"`)).toEqual([])
  })

  it("no file but the launcher starts the ffmpeg binary", () => {
    const offenders: string[] = []
    let launcherSeen = false
    for (const file of walk(SRC_DIR)) {
      const rel = relative(SRC_DIR, file).split("\\").join("/")
      const lines = launchLines(readFileSync(file, "utf8"))
      if (rel === LAUNCHER) {
        launcherSeen = lines.length > 0
        continue
      }
      for (const line of lines) offenders.push(`${rel}:${line}`)
    }
    expect(
      offenders,
      `ffmpeg started outside ${LAUNCHER} — it would run with the host's core count, not the box's ` +
        `CPU quota. Use spawnFfmpeg / execFileFfmpeg, or runFfmpeg and its siblings in ffmpeg-utils.`,
    ).toEqual([])
    // The scan reaches the launcher itself — a moved or renamed launcher must
    // fail here, not leave the census guarding nothing.
    expect(launcherSeen).toBe(true)
  })
})
