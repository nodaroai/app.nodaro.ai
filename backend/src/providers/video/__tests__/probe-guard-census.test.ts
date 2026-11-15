// @test-watches backend/src/**/*.ts
/**
 * EVERY FFPROBE OF A LINK READS THROUGH THE PROBE GUARD — a build-enforced
 * invariant.
 *
 * The link guard (`assertSafeProbeSource`) checks only the first hop; ffprobe
 * then follows redirects and the links a playlist names on its own. What
 * keeps those hops public is the proxy each guarded run reads through
 * (`probe-guard.ts`), and the one way to get it is `readProbeSource`
 * (`ffmpeg-utils.ts`). The shape that slipped through before was "check the
 * link, then hand it to a plain ffprobe" (the draft finalize's stream
 * length). Two textual scans keep it from coming back:
 *
 * 1. Only the guard module names a protocol whitelist that lets ffprobe reach
 *    the network (`probeInputArgs`); a file that writes its own (`http` in a
 *    `-protocol_whitelist` literal) is reading a link outside the guard.
 * 2. `assertSafeProbeSource` is called only where the read that follows goes
 *    through the guard, each listed with why it calls it itself.
 * 3. A raw probe helper — the ones that read a LOCAL file with no guard
 *    (`runFfprobe`, `getVideoDuration`, `getVideoStreamDuration`, …) — is
 *    never handed a link: no call passes an argument named like one (`…Url`,
 *    `…URL`) or an http(s) literal. A link is read with a guarded probe
 *    (`probeMediaDuration`, `probeVideoStreamDurationSource`, … or
 *    `readProbeSource` itself).
 *
 * Scan 3 is only a fast hint (a link in a variable named `src` passes it). The
 * invariant itself is at run time: `runFfprobe`, `runFfprobeCapture` and the
 * packet scan refuse any argument naming a link unless the run carries a
 * guarded run's environment (`probe-guard.e2e.test.ts` holds it).
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = join(HERE, "..", "..", "..")
const GUARD = "providers/video/probe-guard.ts"

/** The files that call the link guard themselves, and why that is safe. */
const GUARD_CALLERS: Record<string, string> = {
  "providers/video/ffmpeg-utils.ts": "readProbeSource: the first hop, before its proxied read or its own-storage fallback",
  "providers/video/ffmpeg-reading-links.ts": "the toolkit's ffmpeg runners: the first hop of each -i link, before the run reads them all through withProbeEgress",
  "lib/video-utility-length.ts":
    "the measure runs the first-hop check under a route's deadline, then reads through probeClipLengthSec (sourceChecked) or readOwnStoredCopy",
  "lib/nemotron-transcribe-input.ts": "its own refusal message for a blocked link; the length is then read by probeMediaDurationAndSize (readProbeSource)",
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__" || entry === "__characterization__") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full)
  }
  return out
}

/** The raw probe helpers: each reads a local file as it is, with no link guard. */
const RAW_HELPER_CALL = /\b(runFfprobe|runFfprobeCapture|getVideoDuration|getVideoStreamDuration|getVideoFps|hasAudioStream|probeAudioSampleRate|probeVideoFrameCount|probeVideoStream|probeStreamEnds|probeVideoOverlayBase|probeVideoFramePtsMs|needsTranscode|scanPacketEnds|probeStreams)\s*\(/g
/** An argument that names a link: an identifier ending in Url / URL (Urls), or an http(s) literal. */
const LINK_ARGUMENT = /\b\w*(?:[uU]rl|URL)s?\b|["'`]https?:/

/** The argument text of the call whose `(` is at `open` (balanced parentheses). */
function argumentsAt(source: string, open: number): string {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++
    else if (source[i] === ")" && --depth === 0) return source.slice(open + 1, i)
  }
  return ""
}

/** Every call of a raw probe helper whose arguments name a link, as `file:line helper(args)`. */
function rawHelperCallsWithALink(rel: string, source: string): string[] {
  const out: string[] = []
  for (const m of source.matchAll(RAW_HELPER_CALL)) {
    // A definition (`function runFfprobe(`) or a method of another object is not a call of the helper.
    if (/(?:function\s+|\.)$/.test(source.slice(Math.max(0, m.index - 12), m.index))) continue
    const args = argumentsAt(source, m.index + m[0].length - 1)
    if (LINK_ARGUMENT.test(args)) out.push(`${rel}:${source.slice(0, m.index).split("\n").length} ${m[1]}(${args.replace(/\s+/g, " ").slice(0, 80)})`)
  }
  return out
}

/** A `-protocol_whitelist` literal that lets the reader reach the network. */
const NETWORK_WHITELIST = /["'`]-protocol_whitelist["'`]\s*,\s*["'`][^"'`]*\bhttps?\b/
const GUARD_CALL = /\bassertSafeProbeSource\s*\(/
/** How many times `re` occurs in `text`. */
const count = (re: RegExp, text: string): number => [...text.matchAll(new RegExp(re.source, "g"))].length

const files = walk(SRC_DIR).map((file) => ({ rel: relative(SRC_DIR, file).split("\\").join("/"), source: readFileSync(file, "utf8") }))

describe("probe guard census", () => {
  it("recognizes a network whitelist and a guard call however they are written", () => {
    expect(count(NETWORK_WHITELIST, `"-protocol_whitelist", "file,http,https,tcp,tls"`)).toBe(1)
    expect(count(NETWORK_WHITELIST, `'-protocol_whitelist',\n  'https,tls,tcp'`)).toBe(1)
    expect(count(NETWORK_WHITELIST, `"-protocol_whitelist", "file"`)).toBe(0)
    expect(count(NETWORK_WHITELIST, `"-protocol_whitelist", "file,pipe"`)).toBe(0)
    expect(count(GUARD_CALL, `await assertSafeProbeSource (url)`)).toBe(1)
    expect(rawHelperCallsWithALink("x.ts", `const d = await getVideoDuration(audioUrl)`)).toEqual(["x.ts:1 getVideoDuration(audioUrl)"])
    expect(rawHelperCallsWithALink("x.ts", `await runFfprobe([\n  "-v", "error",\n  job.sourceURL,\n])`)).toHaveLength(1)
    expect(rawHelperCallsWithALink("x.ts", `await getVideoStreamDuration("https://cdn.example/a.mp4")`)).toHaveLength(1)
    expect(rawHelperCallsWithALink("x.ts", `await getVideoDuration(localPath)\nexport function runFfprobe(args: string[]) {}`)).toEqual([])
  })

  it("no file but the guard writes a protocol whitelist that reaches the network", () => {
    const offenders = files.filter((f) => f.rel !== GUARD && NETWORK_WHITELIST.test(f.source)).map((f) => f.rel)
    expect(
      offenders,
      "ffprobe is given a link outside the probe guard: read it with readProbeSource (ffmpeg-utils), which supplies the whitelist and the proxy.",
    ).toEqual([])
  })

  it("the link guard is called only where the read after it goes through the guard", () => {
    const callers = files.filter((f) => f.rel !== GUARD && GUARD_CALL.test(f.source)).map((f) => f.rel).sort()
    expect(
      callers,
      "A new caller of assertSafeProbeSource: checking the first hop and then handing the link to a plain ffprobe leaves every later hop unchecked. Read it with readProbeSource instead (or list it here, saying why its read is guarded).",
    ).toEqual(Object.keys(GUARD_CALLERS).sort())
  })

  it("no raw probe helper is handed a link: a link is read through the guard", () => {
    const offenders = files.flatMap((f) => rawHelperCallsWithALink(f.rel, f.source))
    expect(
      offenders,
      "A link handed to a probe helper that reads local files with no guard: use a guarded probe (probeMediaDuration, probeVideoStreamDurationSource, probeVideoSource …) or readProbeSource.",
    ).toEqual([])
  })

  it("every file that starts ffprobe itself refuses a link it was not given through the guard", () => {
    const SPAWN = /\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*["'`]ffprobe["'`]/
    const spawners = files.filter((f) => SPAWN.test(f.source)).map((f) => f.rel)
    expect(spawners.length).toBeGreaterThan(0)
    // retained-video-probe reads only its own temp file with `-protocol_whitelist file,pipe`: no link can reach it.
    const exempt = new Set(["lib/retained-video-probe.ts"])
    expect(
      spawners.filter((f) => !exempt.has(f) && !files.find((g) => g.rel === f)!.source.includes("unguardedProbeLinkRefusal(")),
      "A file that starts ffprobe itself must check its input with unguardedProbeLinkRefusal (probe-guard.ts), so a link handed to it fails closed.",
    ).toEqual([])
  })
})
