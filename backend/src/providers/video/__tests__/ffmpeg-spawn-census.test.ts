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

/**
 * EVERY LAUNCH IS ADMITTED — or exempt with a reason (decided 2026-10-05).
 *
 * The launcher above decides the argv; WHEN a launch may start is the
 * admission's (`ffmpeg-admission.ts`): a slot, and a reservation of the
 * memory it is predicted to need from the container's budget. A launch that
 * skips it is invisible to the budget — the 4K OOM again, from a lane nobody
 * counted. The two heavy launches that used to skip it (`reencodeToH264`'s x264
 * re-encode, the HD section mux) now go through it; this census keeps the next
 * one from doing the same.
 *
 * Textual, like the scan above: every file that calls `spawnFfmpeg(` or
 * `execFileFfmpeg(` must be listed, either as ADMITTED or as EXEMPT, with the
 * reason. The check is PER LAUNCH SITE, not per file: the top-level function
 * around each launch must itself hold a slot (`withFfmpegSlot(` / `holdSlot(`),
 * or be named in EXEMPT — a new raw launch in a file that already holds slots
 * elsewhere fails here.
 */
describe("ffmpeg admission census", () => {
  /** Files whose launches hold a slot (and a memory reservation). */
  const ADMITTED: Record<string, { how: string; heldBy?: Record<string, string> }> = {
    "providers/video/ffmpeg-utils.ts": {
      how: "runFfmpeg / runFfmpegCapture / runFfmpegWithProgress each hold a slot through holdSlot",
    },
    "providers/video/ffmpeg-cancellable.ts": { how: "withFfmpegSlot around the spawn" },
    "providers/video/video-file-stages.ts": {
      how: "reencodeToH264: withFfmpegSlot with the canvas model's prediction",
      // runReencode only spawns; its one caller holds the slot around it.
      heldBy: { runReencode: "reencodeToH264" },
    },
    "providers/video/youtube-video.ts": { how: "muxSectionStreams: withFfmpegSlot (copy video, aac audio: the default estimate)" },
    "providers/audio/audio-sync.ts": { how: "withFfmpegSlot around the spawn" },
  }

  /** Launches that deliberately do NOT reserve, and why — keyed by file, then by
   *  the top-level function that holds the launch. */
  const EXEMPT: Record<string, { fn: string; reason: string }> = {
    "utils/thumbnail.ts": {
      fn: "extractFrame",
      reason:
        "extractFrame: ONE frame from a just-uploaded clip (-vframes 1) — a few MiB and milliseconds, in the API " +
        "process; queueing an upload's thumbnail behind a 4K render would stall the upload for nothing",
    },
    "providers/video/ffmpeg-utils.ts": {
      fn: "logFfmpegVersion",
      reason: "logFfmpegVersion: `ffmpeg -version` once per process boot — it decodes nothing and exits at once",
    },
  }

  const CALL = /\b(?:spawnFfmpeg|execFileFfmpeg)\s*\(/g
  const SLOT = /\b(?:withFfmpegSlot|holdSlot)\s*\(/g
  const count = (source: string, re: RegExp): number => [...source.matchAll(re)].length

  /** A top-level (column 0) declaration: function, arrow const, or class. */
  const TOP_LEVEL = /^(?:export\s+)?(?:default\s+)?(?:(?:async\s+)?function\*?\s+(\w+)|(?:const|let)\s+(\w+)\s*=|class\s+(\w+))/gm

  /** The top-level declarations of `source`: name, start, and text up to the next one. */
  function declarations(source: string): Array<{ name: string; at: number; text: string }> {
    const found = [...source.matchAll(TOP_LEVEL)].map((m) => ({ at: m.index ?? 0, name: m[1] ?? m[2] ?? m[3] ?? "" }))
    return found.map((d, i) => ({ ...d, text: source.slice(d.at, found[i + 1]?.at ?? source.length) }))
  }

  /** For every launch in `source`: the top-level declaration around it. */
  function launchSites(source: string): Array<{ fn: string; body: string }> {
    const decls = declarations(source)
    return [...source.matchAll(CALL)].map((m) => {
      const at = m.index ?? 0
      const around = [...decls].reverse().find((d) => d.at <= at)
      return { fn: around?.name ?? "<module level>", body: around?.text ?? "" }
    })
  }

  it("recognizes the call shapes it counts", () => {
    expect(count(`spawnFfmpeg(args, o)\nexecFileFfmpeg(\n  [`, CALL)).toBe(2)
    expect(count(`import { spawnFfmpeg } from "./x.js"\nexport function spawnFfmpeg(`, CALL)).toBe(1) // the import is not a call
    expect(count(`withFfmpegSlot(() => 1, o)\nreturn holdSlot(fn, o)\nasync function holdSlot<T>(`, SLOT)).toBe(2)
  })

  it("pins each launch to the top-level function around it", () => {
    const source = [
      `export async function runA() {`,
      `  return holdSlot(() => execFileFfmpeg(args, o), o)`,
      `}`,
      `export const runB = async () => {`,
      `  return spawnFfmpeg(args, o)`,
      `}`,
    ].join("\n")
    const sites = launchSites(source)
    expect(sites.map((x) => x.fn)).toEqual(["runA", "runB"])
    expect(sites.map((x) => count(x.body, SLOT))).toEqual([1, 0]) // runB would fail the census
  })

  it("every file that launches ffmpeg is admitted or exempt — and every listed file still does", () => {
    const unlisted: string[] = []
    const seen = new Set<string>()
    for (const file of walk(SRC_DIR)) {
      const rel = relative(SRC_DIR, file).split("\\").join("/")
      if (rel === LAUNCHER) continue // defines the launch functions
      const source = readFileSync(file, "utf8")
      const calls = count(source, CALL)
      if (calls === 0) continue
      seen.add(rel)
      const admitted = ADMITTED[rel]
      const exempt = EXEMPT[rel]
      if (!admitted && !exempt) {
        unlisted.push(`${rel} (${calls} launch${calls === 1 ? "" : "es"})`)
        continue
      }
      for (const site of launchSites(source)) {
        if (exempt && site.fn === exempt.fn) continue
        const holder = admitted?.heldBy?.[site.fn]
        if (holder) {
          const text = declarations(source).find((d) => d.name === holder)?.text ?? ""
          expect(
            count(text, SLOT) > 0 && text.includes(`${site.fn}(`),
            `${rel}: ${site.fn}() launches ffmpeg and ${holder}() must hold the slot around it`,
          ).toBe(true)
          continue
        }
        expect(
          admitted && count(site.body, SLOT) > 0,
          `${rel}: the launch in ${site.fn}() holds no slot — wrap it in withFfmpegSlot / holdSlot, or list ` +
            `${site.fn} as EXEMPT with the reason`,
        ).toBe(true)
      }
    }
    expect(
      unlisted,
      "ffmpeg launched without an admission: hold a slot with the launch's predicted peak memory " +
        "(runFfmpeg and its siblings, or withFfmpegSlot({ peakMemoryMiB })) — or list it as EXEMPT with the reason",
    ).toEqual([])
    // A listed file that no longer launches is stale: the census must not drift.
    for (const rel of [...Object.keys(ADMITTED), ...Object.keys(EXEMPT)]) {
      expect(seen.has(rel), `${rel} is listed but no longer launches ffmpeg`).toBe(true)
    }
    // An exempt function that no longer launches is stale too.
    for (const [rel, e] of Object.entries(EXEMPT)) {
      const names = launchSites(readFileSync(join(SRC_DIR, rel), "utf8")).map((x) => x.fn)
      expect(names, `${rel}: ${e.fn} is listed as exempt but no longer launches ffmpeg`).toContain(e.fn)
    }
  })

  it("every exemption states its reason", () => {
    for (const [rel, e] of Object.entries(EXEMPT)) expect(e.reason.length, rel).toBeGreaterThan(30)
  })
})
