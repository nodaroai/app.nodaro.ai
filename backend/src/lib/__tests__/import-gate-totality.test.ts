// @test-watches backend/src/**/*.ts
/**
 * IMPORT-GATE TOTALITY (copyright plan, PR 1: "every call of the download
 * engine passes the rights, or the build fails").
 *
 * Every import of a link runs through ONE of the engines below, and every
 * engine asks the gate (`lib/import-gate.ts`) itself: a refusal before any
 * fetch, the confirmation spent right before the bytes move. A new file that
 * starts yt-dlp on its own, or that reaches a runner without being an engine,
 * is a lane the gate cannot see — the way `routes/youtube-audio.ts` and
 * `providers/video/trim-audio.ts` fetched for months beside `/v1/download-video`.
 *
 * Textual, like the yt-dlp admission census. Two nets, both closed by one
 * allowlist with a reason per file:
 *  1. by IMPORT: a file that imports the yt-dlp library, or a runner's name
 *     (under any alias) from a runner's home;
 *  2. by CALL: a file whose code names a runner call.
 * Each engine must contain both halves of the gate. The engines take
 * `ImportRights` as a required parameter, so the compiler names a caller that
 * forgets; this guard names a caller that bypasses the engines.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = join(HERE, "..", "..")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full)
  }
  return out
}

const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/** The engines: each fetches a link and asks the gate itself. */
export const ENGINES = [
  "lib/video-download.ts", // the video downloader (route + run)
  "workers/download-audio.ts", // downloadAudioToR2 (a run's audio, Suno's cover / upload-extend)
  "providers/audio/youtube-extractor.ts", // extractYouTubeAudio[WithMeta] (extract-youtube-audio, transcribe)
  "providers/video/trim-audio.ts", // trimAudio (the Trim Audio node / route, given a social link)
  "routes/youtube-audio.ts", // the sync audio route: its own yt-dlp run, gated in place
  "routes/media-import-url.ts", // a picture from a link (safeFetch, no yt-dlp), gated in place
  "routes/media-url-import.ts", // a recording from a link (safeFetch, no yt-dlp), gated in place
] as const

/** Engines that fetch through safeFetch, not a yt-dlp runner: held to the gate, not to the runner check. */
const FETCHES_WITHOUT_A_RUNNER: ReadonlySet<string> = new Set(["routes/media-import-url.ts", "routes/media-url-import.ts"])

/**
 * The runners, by name: the yt-dlp runners (the library itself, `youtube-dl-exec`,
 * and the spawners' home are runner modules) and the two safeFetch importers
 * of `lib/media-import.ts` / `lib/media-url-import.ts`.
 */
const RUNNER_NAMES = [
  "importImageFromUrl",
  "importRecordingFromUrl",
  "youtubedl",
  "runYtDlpOptions",
  "spawnYtDlpDownload",
  "spawnYtDlpDownloadWith",
  "runYtDlpCapture",
  "runYtDlpCaptureWith",
  "runYtDlpToEndWith",
  "spawnYtDlpProcess",
  "downloadYouTubeVideo",
  "downloadSocialPostVideo",
  "runThroughClientLadder",
] as const
const RUNNER_CALL = new RegExp(`\\b(?:${RUNNER_NAMES.join("|")})\\s*\\(`)
const RUNNER_MODULE = /(?:^|\/)(?:youtube-dl-exec|ytdlp-process\.js|ytdlp-options-run\.js|ytdlp-bin\.js|youtube-video\.js|social-post-video\.js|media-import\.js|media-url-import\.js)$/

/** Every file that may reach a runner, with why; anything else that does is a stray lane. */
const MAY_REACH_A_RUNNER: ReadonlyMap<string, string> = new Map([
  ...ENGINES.map((f) => [f, "an engine: asks the gate itself"] as [string, string]),
  ["providers/video/youtube-video.ts", "the runners' home (downloadYouTubeVideo, the probe, the client ladder)"],
  ["providers/video/ytdlp-options-run.ts", "runYtDlpOptions itself"],
  ["providers/video/ytdlp-process.ts", "the spawners themselves"],
  ["providers/video/social-post-video.ts", "the social post probe and its download, reached only through the engines and the plugin toolkit"],
  ["lib/media-import.ts", "importImageFromUrl itself (safeFetch)"],
  ["lib/media-url-import.ts", "importRecordingFromUrl itself (safeFetch)"],
  ["lib/mcp/flows/import-inputs.ts", "the MCP flow's copy of an outside picture: reads the gate, spends nothing (it carries no confirmation; an agent's standing authorization is a later change)"],
  ["lib/private-plugins/toolkit.ts", "the private plugin lane: hands the runners to a plugin — asks the account's measures (refuseBlockedImports), not the confirmation yet"],
  ["lib/private-plugins/types.ts", "the plugin contract: the TYPE of what the toolkit hands over, no call"],
])

interface ImportedRunner {
  readonly module: string
  readonly names: readonly string[]
}

/** Imports from a runner module: the module and the runner names bound (an alias counts by its ORIGINAL name). */
export function runnerImportsOf(source: string): ImportedRunner[] {
  const out: ImportedRunner[] = []
  const IMPORT = /import\s+(?:type\s+)?(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g
  for (const m of source.matchAll(IMPORT)) {
    const [, defaultName, named, spec] = m
    if (!RUNNER_MODULE.test(spec!)) continue
    if (/^import\s+type\b/.test(m[0])) continue
    const bound = (named ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("type "))
      .map((s) => s.split(/\s+as\s+/)[0]!.trim())
    const names = [...(defaultName ? [defaultName === "youtubedl" || spec!.endsWith("youtube-dl-exec") ? "youtubedl" : defaultName] : []), ...bound]
      .filter((n) => (RUNNER_NAMES as readonly string[]).includes(n))
    if (names.length) out.push({ module: spec!, names })
  }
  return out
}

const files = walk(SRC_DIR).map((file) => ({
  rel: relative(SRC_DIR, file).split("\\").join("/"),
  source: withoutComments(readFileSync(file, "utf8")),
}))

describe("import-gate totality", () => {
  it("recognizes the shapes it counts", () => {
    const aliased = `import { runYtDlpOptions as dl } from "../providers/video/ytdlp-options-run.js"\nawait dl(url, o)`
    expect(runnerImportsOf(aliased)).toEqual([{ module: "../providers/video/ytdlp-options-run.js", names: ["runYtDlpOptions"] }])
    expect(RUNNER_CALL.test(aliased)).toBe(false) // the call net alone would miss the alias
    const library = `import youtubedl from "youtube-dl-exec"\nawait youtubedl(url, o)`
    expect(runnerImportsOf(library)).toEqual([{ module: "youtube-dl-exec", names: ["youtubedl"] }])
    const spawner = `import { spawnYtDlpDownloadWith } from "./ytdlp-process.js"`
    expect(runnerImportsOf(spawner)[0]?.names).toEqual(["spawnYtDlpDownloadWith"])
    const reference = `import { downloadYouTubeVideo } from "./youtube-video.js"\nconst lanes = { download: downloadYouTubeVideo }`
    expect(runnerImportsOf(reference)[0]?.names).toEqual(["downloadYouTubeVideo"])
    expect(RUNNER_CALL.test(reference)).toBe(false) // a reference is not a call; the import net catches it
    const fetcher = `import { importImageFromUrl } from "../../media-import.js"`
    expect(runnerImportsOf(fetcher)[0]?.names).toEqual(["importImageFromUrl"])
    const probeOnly = `import { ytMetadataProbe, type VideoSection } from "../providers/video/youtube-video.js"`
    expect(runnerImportsOf(probeOnly)).toEqual([])
    const typeOnly = `import type { YtDlpRunLimits } from "./ytdlp-process.js"`
    expect(runnerImportsOf(typeOnly)).toEqual([])
    expect(RUNNER_CALL.test(withoutComments("// runYtDlpOptions(url) in a comment is not a call"))).toBe(false)
  })

  it("every engine asks both halves of the gate", () => {
    for (const engine of ENGINES) {
      const file = files.find((f) => f.rel === engine)
      expect(file, `${engine} exists`).toBeDefined()
      expect(file!.source, `${engine} reads the gate`).toMatch(/\brequireImportAllowed\s*\(/)
      expect(file!.source, `${engine} spends the confirmation`).toMatch(/\bspendImportConfirmation\s*\(/)
    }
  })

  it("no file outside the allowlist imports a runner or names a runner call", () => {
    const strays = files
      .filter((f) => !MAY_REACH_A_RUNNER.has(f.rel))
      .filter((f) => runnerImportsOf(f.source).length > 0 || RUNNER_CALL.test(f.source))
      .map((f) => f.rel)
    expect(strays, "a new lane that fetches a link must run through an engine (lib/import-gate.ts)").toEqual([])
  })

  it("the allowlist names only files that exist and still reach a runner (an engine may fetch without one)", () => {
    for (const [rel, why] of MAY_REACH_A_RUNNER) {
      const file = files.find((f) => f.rel === rel)
      expect(file, `${rel} (${why}) exists`).toBeDefined()
      if (FETCHES_WITHOUT_A_RUNNER.has(rel)) continue
      const reaches = runnerImportsOf(file!.source).length > 0 || RUNNER_CALL.test(file!.source)
      expect(reaches, `${rel} (${why}) still reaches a runner; drop it from the list otherwise`).toBe(true)
    }
  })
})
