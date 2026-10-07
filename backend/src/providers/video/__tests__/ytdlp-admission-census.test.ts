/**
 * EVERY yt-dlp RUN IS CLASSIFIED — transcoding runs are admitted, the rest are
 * exempt with a reason (round 3 of #1860, decided 2026-10-05).
 *
 * yt-dlp starts its own ffmpeg, which the ffmpeg census
 * (`ffmpeg-spawn-census.test.ts`) cannot see: no `spawnFfmpeg(` appears in the
 * code that causes it. A section cut at keyframes is a full video encode at the
 * stream's resolution, an audio conversion encodes audio — and neither carries
 * the backend's thread counts or a memory reservation. The classifier
 * (`ytdlp-transcode.ts`) decides, from the flags, whether a run may encode; the
 * funnel (`ytdlp-admission.ts`) holds a slot and a reservation sized to the request for it,
 * and pins the quota's thread counts into the argv it spawns (`ytdlp-ffmpeg-limits.ts`).
 *
 * This census keeps a NEW yt-dlp invocation from skipping that: every way of
 * starting yt-dlp must go through the funnel, and every file that composes
 * yt-dlp flags must be classified here. Textual, like the ffmpeg census, and
 * checked per top-level function, not per file — and the library's calls are
 * counted against their wrappers (R3-3), so one wrapped call cannot vouch for a
 * second raw one in the same function.
 *
 *  1. `youtubedl(` (the library) — every call sits in a function that calls
 *     `withYtDlpOptionsAdmission(`, and the table says whether its options encode.
 *     The library stops its child by Node's `signal`, which cannot reach yt-dlp's
 *     own ffmpeg: a library lane may NOT encode (round 4, decided 2026-10-05 —
 *     the audio lanes run through `runYtDlpOptions` and kill the process group),
 *     and `withYtDlpOptionsAdmission` refuses one at runtime.
 *  2. The process spawners (`spawnYtDlpProcess`, `spawnYtDlpDownloadWith`,
 *     `runYtDlpCaptureWith`, `runYtDlpToEndWith`) are called only by the wrappers —
 *     `spawnYtDlpDownload` / `runYtDlpCapture` in `youtube-video.ts` and
 *     `runYtDlpOptions` in `ytdlp-options-run.ts` — which call `withYtDlpAdmission(`.
 *  3. No other file starts a `yt-dlp` binary with child_process.
 *  4. Every file that composes yt-dlp flags is listed with its lane's class.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = join(HERE, "..", "..", "..")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full)
  }
  return out
}

/** Code only: block comments and whole-line comments dropped, so a flag NAMED in a comment is not a flag USED. */
const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const files = walk(SRC_DIR).map((file) => ({
  rel: relative(SRC_DIR, file).split("\\").join("/"),
  source: withoutComments(readFileSync(file, "utf8")),
}))

/** A top-level (column 0) declaration: function, arrow const, or class. */
const TOP_LEVEL = /^(?:export\s+)?(?:default\s+)?(?:(?:async\s+)?function\*?\s+(\w+)|(?:const|let)\s+(\w+)\s*=|class\s+(\w+))/gm

function declarations(source: string): Array<{ name: string; at: number; text: string }> {
  const found = [...source.matchAll(TOP_LEVEL)].map((m) => ({ at: m.index ?? 0, name: m[1] ?? m[2] ?? m[3] ?? "" }))
  return found.map((d, i) => ({ ...d, text: source.slice(d.at, found[i + 1]?.at ?? source.length) }))
}

/** For every match of `call` in `source`: the top-level declaration around it. */
function sitesOf(source: string, call: RegExp): Array<{ fn: string; body: string }> {
  const decls = declarations(source)
  return [...source.matchAll(call)].map((m) => {
    const at = m.index ?? 0
    const around = [...decls].reverse().find((d) => d.at <= at)
    return { fn: around?.name ?? "<module level>", body: around?.text ?? "" }
  })
}

/** A `youtubedl(` that is the body of a funnel call's callback: `withYtDlpOptionsAdmission(options, () => youtubedl(`. */
const WRAPPED_CALL = /withYtDlpOptionsAdmission\(\s*[\w.]+\s*,\s*(?:async\s*)?\(\s*\w*\s*\)\s*=>\s*(?:\{\s*(?:return\s+|await\s+)?)?youtubedl\s*\(/g

/**
 * Calls counted against wrappers, per function: every `youtubedl(` must be the
 * callback body of a funnel call, so one wrapped call can never vouch for a
 * second, raw one in the same (large) function.
 */
function libraryCalls(body: string): { calls: number; wrapped: number; funnels: number } {
  return {
    calls: [...body.matchAll(/\byoutubedl\s*\(/g)].length,
    wrapped: [...body.matchAll(WRAPPED_CALL)].length,
    funnels: [...body.matchAll(/\bwithYtDlpOptionsAdmission\(/g)].length,
  }
}

/** What marks a `youtube-dl-exec` options object as one that encodes (its keys are the flags, camelCased). */
const ENCODING_OPTION = /\b(?:extractAudio|audioFormat|recodeVideo|recode|postprocessorArgs|downloaderArgs|externalDownloaderArgs|forceKeyframesAtCuts)\b/

describe("yt-dlp admission census", () => {
  it("recognizes the shapes it counts", () => {
    const source = [
      `import youtubedl from "youtube-dl-exec"`,
      `// youtubedl(url) in a comment is not a call`,
      `export async function a() {`,
      `  await withYtDlpOptionsAdmission(o, () => youtubedl(url, o))`,
      `}`,
      `export const b = async () => youtubedl(url, {})`,
    ].join("\n")
    expect(sitesOf(withoutComments(source), /\byoutubedl\s*\(/g).map((s) => s.fn)).toEqual(["a", "b"])
    expect(sitesOf(withoutComments(source), /\byoutubedl\s*\(/g).map((s) => s.body.includes("withYtDlpOptionsAdmission("))).toEqual([true, false])
    // One wrapped call must not vouch for a second raw one in the same function.
    const twoCalls = withoutComments([
      `export async function big() {`,
      `  await withYtDlpOptionsAdmission(o, () => youtubedl(url, o))`,
      `  await youtubedl(url, { extractAudio: true })`,
      `}`,
    ].join("\n"))
    expect(libraryCalls(sitesOf(twoCalls, /\byoutubedl\s*\(/g)[0]!.body)).toEqual({ calls: 2, wrapped: 1, funnels: 1 })
    const funneledTwice = withoutComments([
      `export async function big() {`,
      `  await withYtDlpOptionsAdmission(o, () => youtubedl(url, o))`,
      `  await withYtDlpOptionsAdmission(p, async () => { return youtubedl(url, p) })`,
      `}`,
    ].join("\n"))
    expect(libraryCalls(sitesOf(funneledTwice, /\byoutubedl\s*\(/g)[0]!.body)).toEqual({ calls: 2, wrapped: 2, funnels: 2 })
    // A funnel call whose callback does something else, with the raw call beside it, is not wrapped.
    const beside = withoutComments(`export async function f() {\n  await withYtDlpOptionsAdmission(o, () => other())\n  await youtubedl(url, o)\n}`)
    expect(libraryCalls(sitesOf(beside, /\byoutubedl\s*\(/g)[0]!.body)).toEqual({ calls: 1, wrapped: 0, funnels: 1 })
    expect(ENCODING_OPTION.test("extractAudio: true,")).toBe(true)
    expect(ENCODING_OPTION.test("mergeOutputFormat: \"mp4\"")).toBe(false)
    expect(/\b(?:spawn|execFile)\s*\(\s*["'`][^"'`]*yt-dlp/.test(`spawn("yt-dlp", args)`)).toBe(true)
  })

  /**
   * 1. The library's call sites: file -> function -> does its options object encode?
   * Only runs that COPY streams may use the library (`encodes: false`): it stops its
   * child by Node's `signal`, which cannot reach yt-dlp's own ffmpeg. The audio lanes
   * (`routes/youtube-audio.ts`, `workers/shared.ts`) run through `runYtDlpOptions`.
   */
  const LIBRARY_LANES: Record<string, { fn: string; calls: number; encodes: boolean; why: string }> = {
    "providers/video/trim-audio.ts": {
      fn: "trimAudio",
      calls: 1,
      encodes: false,
      why: "downloads and MERGES into mp4 (stream copy); the audio is cut afterwards by the admitted runFfmpeg",
    },
  }

  it("every youtubedl() call is made through the funnel, and the table says whether its options encode", () => {
    const seen = new Set<string>()
    const unlisted: string[] = []
    for (const { rel, source } of files) {
      const sites = sitesOf(source, /\byoutubedl\s*\(/g)
      if (sites.length === 0) continue
      seen.add(rel)
      const lane = LIBRARY_LANES[rel]
      if (!lane) {
        unlisted.push(`${rel} (${sites.length} call${sites.length === 1 ? "" : "s"})`)
        continue
      }
      for (const site of sites) {
        expect(site.fn, `${rel}: unexpected function around a youtubedl() call`).toBe(lane.fn)
      }
      // Counted per call, not per function: each youtubedl() is the callback of its own funnel call, and the
      // table says how many there are — a new one (wrapped or not) must be classified here, not vouched for.
      const counts = libraryCalls(sites[0]!.body)
      expect(counts.calls, `${rel}: ${lane.fn}() has ${counts.calls} youtubedl() calls, the table lists ${lane.calls} — classify the new one (does its flag set re-encode?)`).toBe(lane.calls)
      expect(
        counts.wrapped,
        `${rel}: ${lane.fn}() calls youtubedl() outside withYtDlpOptionsAdmission(options, () => youtubedl(...)) — yt-dlp's own ffmpeg would run unreserved`,
      ).toBe(counts.calls)
      expect(counts.funnels, `${rel}: ${lane.fn}() has a funnel call that wraps no youtubedl()`).toBe(counts.calls)
      // The options object only: from its declaration to the funnel call (the function's own parameters are not flags).
      const options = sites[0]!.body.slice(sites[0]!.body.indexOf("ytDlpOptions"), sites[0]!.body.indexOf("withYtDlpOptionsAdmission("))
      expect(ENCODING_OPTION.test(options), `${rel}: ${lane.fn}() — the table says ${lane.encodes ? "it encodes" : "it only copies"}, its options say otherwise`).toBe(lane.encodes)
    }
    expect(
      unlisted,
      "a youtube-dl-exec call outside the census: run it through withYtDlpOptionsAdmission and classify it in LIBRARY_LANES — does its flag set re-encode (ytdlp-transcode.ts)?",
    ).toEqual([])
    for (const rel of Object.keys(LIBRARY_LANES)) expect(seen.has(rel), `${rel} is listed but no longer calls youtubedl()`).toBe(true)
    for (const lane of Object.values(LIBRARY_LANES)) expect(lane.why.length).toBeGreaterThan(30)
  })

  it("youtube-dl-exec is imported only by the files the table lists", () => {
    const importers = files.filter(({ source }) => /from\s+["']youtube-dl-exec["']/.test(source)).map(({ rel }) => rel).sort()
    expect(importers, "a new youtube-dl-exec importer: list it in LIBRARY_LANES").toEqual(Object.keys(LIBRARY_LANES).sort())
  })

  it("the process spawners are called only by the wrappers, which hold the funnel", () => {
    const SPAWNERS = /\b(?:spawnYtDlpProcess|spawnYtDlpDownloadWith|runYtDlpCaptureWith|runYtDlpToEndWith)\s*\(/g
    const WRAPPERS: Record<string, string[]> = {
      "providers/video/youtube-video.ts": ["spawnYtDlpDownload", "runYtDlpCapture"],
      "providers/video/ytdlp-options-run.ts": ["runYtDlpOptions"],
    }
    const offenders: string[] = []
    let wrappersSeen = 0
    for (const { rel, source } of files) {
      // ytdlp-process.ts DEFINES the spawners (and the `*With` pair call spawnYtDlpProcess).
      if (rel === "providers/video/ytdlp-process.ts") continue
      for (const site of sitesOf(source, SPAWNERS)) {
        const wrappers = WRAPPERS[rel]
        if (!wrappers?.includes(site.fn)) {
          offenders.push(`${rel} :: ${site.fn}`)
          continue
        }
        wrappersSeen++
        expect(site.body.includes("withYtDlpAdmission("), `${rel}: ${site.fn}() must run yt-dlp through withYtDlpAdmission`).toBe(true)
      }
    }
    expect(offenders, "yt-dlp started outside the wrappers (youtube-video.ts, ytdlp-options-run.ts) — it would run its ffmpeg unreserved").toEqual([])
    expect(wrappersSeen, "the census reaches every wrapper").toBe(3)
  })

  it("each wrapper spawns the argv the admission hands it (hold.args), never its own — or the threads would never reach yt-dlp's ffmpeg", () => {
    const WRAPPER_SITES: Array<[string, string]> = [
      ["providers/video/youtube-video.ts", "spawnYtDlpDownload"],
      ["providers/video/youtube-video.ts", "runYtDlpCapture"],
      ["providers/video/ytdlp-options-run.ts", "runYtDlpOptions"],
    ]
    for (const [rel, fn] of WRAPPER_SITES) {
      const source = files.find((f) => f.rel === rel)!.source
      const body = declarations(source).find((d) => d.name === fn)?.text ?? ""
      expect(body.includes("hold?.args ?? args"), `${rel}: ${fn}() must spawn \`hold?.args ?? args\``).toBe(true)
    }
  })

  /** 5. The options-object lanes that ENCODE run through `runYtDlpOptions`: file -> function. */
  const OPTIONS_LANES: Record<string, string> = {
    "routes/youtube-audio.ts": "youtubeAudioRoutes",
    "workers/shared.ts": "downloadAudioToR2",
  }

  it("the audio lanes encode, run through runYtDlpOptions, and no longer touch the library", () => {
    for (const [rel, fn] of Object.entries(OPTIONS_LANES)) {
      const source = files.find((f) => f.rel === rel)!.source
      const sites = sitesOf(source, /\brunYtDlpOptions\s*\(/g)
      expect(sites.map((s) => s.fn), `${rel}: one runYtDlpOptions() call, in ${fn}()`).toEqual([fn])
      const body = sites[0]!.body
      const options = body.slice(body.indexOf("ytDlpOptions"), body.indexOf("runYtDlpOptions("))
      expect(ENCODING_OPTION.test(options), `${rel}: ${fn}() — its options no longer encode; is it still an audio lane?`).toBe(true)
      expect(/\byoutubedl\b/.test(source), `${rel} still uses youtube-dl-exec, which cannot stop yt-dlp's ffmpeg`).toBe(false)
    }
  })

  it("no file but ytdlp-process.ts starts a yt-dlp binary with child_process", () => {
    const LAUNCH = /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)\s*\(\s*["'`][^"'`]*yt-dlp/g
    const offenders = files.filter(({ source }) => LAUNCH.test(source)).map(({ rel }) => rel)
    expect(offenders).toEqual([])
  })

  /**
   * 4. Every file that COMPOSES yt-dlp flags — recognised by flags only yt-dlp
   * has — with its lane's class. A new file here is a new yt-dlp lane: classify it.
   */
  const FLAG_FILES: Record<string, string> = {
    "providers/video/youtube-video.ts":
      "whole-video download = merge + thumbnail (exempt); sections = --force-keyframes-at-cuts (ENCODES, admitted by spawnYtDlpDownload); probe = --dump-json (no ffmpeg)",
    "providers/audio/youtube-extractor.ts": "--extract-audio --audio-format mp3 (ENCODES audio, admitted by spawnYtDlpDownload)",
    "providers/video/social-post-video.ts": "the hardened whole-video lane's extras (extractors, length filter) and a --print probe: no encoding",
    "providers/video/ytdlp-transcode.ts": "the classifier itself",
    "providers/video/ytdlp-ffmpeg-limits.ts": "the thread pin and the reservation of a transcoding run: they read the classifier's flags (the funnel applies them)",
    "providers/video/trim-audio.ts": "library options (LIBRARY_LANES): merge only",
    "routes/youtube-audio.ts": "options object for runYtDlpOptions: audio mp3 encode (ENCODES audio, admitted, group-killed at the hold)",
    "workers/shared.ts": "options object for runYtDlpOptions: audio mp3 encode (ENCODES audio, admitted, group-killed at the hold)",
  }
  /** Flags (and their library spellings) only yt-dlp understands. */
  const YTDLP_FLAGS = /["']--(?:no-playlist|download-sections|extract-audio|merge-output-format|force-keyframes-at-cuts|dump-json|extractor-args|use-extractors|break-match-filters)["']|\b(?:noPlaylist|extractAudio|mergeOutputFormat|extractorArgs|downloadSections)\s*:/

  it("every file that composes yt-dlp flags is classified", () => {
    const composing = files.filter(({ source }) => YTDLP_FLAGS.test(source)).map(({ rel }) => rel)
    const unlisted = composing.filter((rel) => !(rel in FLAG_FILES))
    expect(
      unlisted,
      "a new file composes yt-dlp flags: does the run re-encode (ytdlp-transcode.ts)? Send it through spawnYtDlpDownload / withYtDlpOptionsAdmission and list it in FLAG_FILES",
    ).toEqual([])
    for (const rel of Object.keys(FLAG_FILES)) expect(composing, `${rel} is listed but composes no yt-dlp flags any more`).toContain(rel)
    for (const why of Object.values(FLAG_FILES)) expect(why.length).toBeGreaterThan(20)
  })
})
