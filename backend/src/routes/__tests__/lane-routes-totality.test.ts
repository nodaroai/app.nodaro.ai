// @test-watches backend/src/routes/**/*.ts backend/src/nodes/**/*.ts backend/src/ee/routes/**/*.ts
/**
 * LIVE ROUTES TAKE THEIR LANE BEFORE THEY RESERVE.
 *
 * A route that bills an LLM call in the request (any of the billing markers
 * below) takes its lane slot itself: `laneGuard(` as the LAST of its
 * preHandlers — after the credit check and any auth or validation, before the
 * handler reserves — or, for a stream, `acquireStreamLane(` /
 * `acquireLiveLane(` right after the stream opens. Without it the call still
 * takes a slot at the LLM funnel, but only after the reservation, and a
 * route's own catch can turn the funnel's "busy" into a 502. A file that needs
 * no slot of its own is listed WITH the reason.
 *
 * Beyond the markers, the routes that do provider work or an LLM draft in the
 * request without a billing marker are pinned by name; every marked stream
 * must acquire inside the stream (a laneGuard cannot tell its client it
 * waits) and stamp its provider call's start again after a wait; and the
 * approval routes are never blocked by a busy lane — their caption takes its
 * slot only if one is free (`takeLiveLaneIfFree(`), never through laneGuard.
 *
 * A stale entry fails, so a file that changes leaves no permanent hole. It is
 * file-level: a file that guards one route passes when it adds a second one
 * unguarded (each route's behaviour is tested in live.test.ts).
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..")

const BILLING_MARKER = /stampSyncLlmCallStart|reserveLlmCall|llmGuardPrecheck|maybeProxyLlmRouteToCloud|finishMeteredSyncLlmJob|spendLlmCall|LlmSpend/
const LANE_TAKE = /\b(?:laneGuard|acquireLiveLane|acquireStreamLane|takeLiveLaneIfFree)\(/
const STREAM_TAKE = /\b(?:acquireLiveLane|acquireStreamLane)\(/
const OPENS_STREAM = /\bcreateSSEStream\(/

/** Route files with a billing marker that take no lane slot of their own, and why. */
const LANE_EXEMPT_ROUTE_FILES: ReadonlyMap<string, string> = new Map([
  ["routes/generate-script.ts", "only inserts a worker job: its LLM call runs in the worker, which takes its slot at pickup"],
  ["routes/llm-structured-jobs.ts", "only inserts a worker job: its LLM call runs in the worker, which takes its slot at pickup"],
  ["routes/3d-scene.ts", "only inserts a worker job: its LLM calls run in the worker, which takes its slot at pickup"],
])

/** Routes with provider work or an in-request LLM draft but no billing marker: each keeps its guard. */
const GUARDED_WITHOUT_MARKER: ReadonlyMap<string, string> = new Map([
  ["routes/web-scrape.ts", "a synchronous scrape runs its provider work in the request"],
  ["routes/suno.ts", "voice validate, voice create and the style boost call the provider in the request"],
  ["routes/generate-character-asset.ts", "drafts a missing description with an LLM before it reserves"],
  ["routes/generate-character-motion.ts", "drafts a missing description / motion with an LLM before it reserves"],
  ["routes/generate-creature-asset.ts", "drafts a missing description with an LLM before it reserves"],
  ["routes/generate-object-asset.ts", "drafts a missing description with an LLM before it reserves"],
  ["routes/image-to-image.ts", "drafts a missing description with an LLM before it reserves"],
  ["routes/generate-character.ts", "extracts facets with an LLM before it reserves"],
])

/** Approvals: never blocked by a lane (decided 2026-11-01) — the caption runs only if a slot is free now. */
const APPROVAL_ROUTES: ReadonlyMap<string, string> = new Map([
  ["routes/character-portrait-approval.ts", "/v1/characters/:id/approve-portrait"],
  ["routes/creature-main-image-approval.ts", "/v1/creatures/:id/approve-main-image"],
  ["routes/location-main-image-approval.ts", "/v1/locations/:id/approve-main-image"],
  ["routes/object-main-image-approval.ts", "/v1/objects/:id/approve-main-image"],
])

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name === "node_modules" || e.name === "test") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...tsFiles(p))
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") && !e.name.endsWith(".test.ts")) out.push(p)
  }
  return out
}

function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ")
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length)))
}

const relOf = (abs: string) => abs.slice(SRC.length + 1).split("\\").join("/")

interface RouteFile { file: string; src: string; billed: boolean; takes: boolean }

function routeFiles(): RouteFile[] {
  return ["routes", "ee/routes", "nodes"]
    .flatMap((r) => tsFiles(join(SRC, r)))
    .map((abs) => {
      const src = blankComments(readFileSync(abs, "utf8"))
      return { file: relOf(abs), src, billed: BILLING_MARKER.test(src), takes: LANE_TAKE.test(src) }
    })
}

/** Index of the bracket closing the one opened at `open` (code with comments blanked; strings skipped). */
function closingOf(src: string, open: number): number {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]!
    if (c === "\"" || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++
      continue
    }
    if (c === "(" || c === "[" || c === "{") depth++
    else if (c === ")" || c === "]" || c === "}") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Each laneGuard( call in `src` that is not the last of its route's preHandlers, as a line number. */
function guardsNotLast(src: string): number[] {
  const bad: number[] = []
  for (const m of src.matchAll(/\blaneGuard\(/g)) {
    const close = closingOf(src, m.index! + "laneGuard".length)
    const after = src.slice(close + 1).replace(/^[\s,]*/, "")
    const before = src.slice(0, m.index).trimEnd()
    // The last element of a preHandler array, or the preHandler on its own.
    const ok = after.startsWith("]") || (/preHandler:$/.test(before) && /^[},]/.test(after))
    if (!ok) bad.push(src.slice(0, m.index).split("\n").length)
  }
  return bad
}

describe("live routes take their lane before they reserve", () => {
  const files = routeFiles()
  const byName = new Map(files.map((f) => [f.file, f]))

  it("scans the real population", () => {
    expect(files.filter((f) => f.billed).length).toBeGreaterThanOrEqual(25)
    expect(byName.get("routes/llm-chat.ts")?.billed).toBe(true)
  })

  it("the totality test lists offenders", () => {
    const offenders = files
      .filter((f) => f.billed && !f.takes && !LANE_EXEMPT_ROUTE_FILES.has(f.file))
      .map((f) => `  • ${f.file}`)
    expect(
      offenders,
      `These routes bill an LLM call in the request but take no lane slot of their own, so they reserve credits ` +
        `before they wait (and a route's own catch can answer a busy lane as a 502). Append ` +
        `laneGuard("llm", { provider }) (lib/concurrency-lanes/request-scope.js) LAST in the route's preHandlers; a ` +
        `stream calls acquireStreamLane( (lib/concurrency-lanes/live-routes.js) right after it opens. If the file ` +
        `makes no LLM call in the request, add it to LANE_EXEMPT_ROUTE_FILES *with the reason*.\n\n` +
        offenders.join("\n"),
    ).toEqual([])
  })

  it("the routes with work but no billing marker keep their guard", () => {
    const lost = [...GUARDED_WITHOUT_MARKER.keys()].filter((f) => !byName.get(f)?.takes)
    expect(lost, `These routes do provider or LLM work in the request and lost their laneGuard:\n${lost.join("\n")}`).toEqual([])
  })

  it("a billed stream acquires inside the stream", () => {
    const streams = files.filter((f) => f.billed && OPENS_STREAM.test(f.src) && !LANE_EXEMPT_ROUTE_FILES.has(f.file))
    expect(streams.map((f) => f.file)).toEqual(expect.arrayContaining(["routes/llm-chat.ts", "routes/ai-writer.ts", "routes/describe-to-picker.ts"]))
    const offenders = streams.filter((f) => !STREAM_TAKE.test(f.src)).map((f) => f.file)
    expect(offenders, `These streams open without taking their slot inside the stream (acquireStreamLane):\n${offenders.join("\n")}`).toEqual([])
  })

  it("a stream stamps its provider call's start again after it waited", () => {
    const offenders = files.filter((f) => /\bacquireStreamLane\(/.test(f.src) && !/\brestampProviderCallStart\(/.test(f.src)).map((f) => f.file)
    expect(offenders, `These streams wait for their slot after stamping their call's start, so the reconcile sweep would count the wait. Pass afterWait: restampProviderCallStart(jobId) to acquireStreamLane:\n${offenders.join("\n")}`).toEqual([])
  })

  it("an approval is never blocked by a lane: its caption takes a slot only if one is free", () => {
    for (const [file, url] of APPROVAL_ROUTES) {
      const src = byName.get(file)?.src ?? ""
      expect(src, file).toMatch(/\btakeLiveLaneIfFree\(/)
      const at = src.indexOf(`"${url}"`)
      expect(at, `${file} registers ${url}`).toBeGreaterThan(0)
      // The approval's own options: no laneGuard among its preHandlers.
      const options = src.slice(at, src.indexOf("async (req", at))
      expect(options, `${url} must not wait for a lane`).not.toMatch(/\blaneGuard\(/)
    }
  })

  it("laneGuard is the last preHandler", () => {
    const offenders = files.flatMap((f) => guardsNotLast(f.src).map((line) => `  • ${f.file}:${line}`))
    expect(offenders, `laneGuard( must be the LAST preHandler (after the credit check, auth and validation):\n${offenders.join("\n")}`).toEqual([])
    // Anti-vacuity: the check sees the guards it is about.
    const guards = files.reduce((n, f) => n + (f.src.match(/\blaneGuard\(/g)?.length ?? 0), 0)
    expect(guards).toBeGreaterThanOrEqual(30)
    expect(guardsNotLast(`a.post("/x", { preHandler: [laneGuard("llm"), creditGuard(() => "x")] }, h)`)).toEqual([1])
    expect(guardsNotLast(`a.post("/x", { preHandler: [creditGuard(() => "x"), laneGuard("llm")] }, h)`)).toEqual([])
    expect(guardsNotLast(`a.post("/x", { preHandler: laneGuard("llm") }, h)`)).toEqual([])
  })

  it("has no stale entry", () => {
    const stale = [...LANE_EXEMPT_ROUTE_FILES.keys()].filter((f) => {
      const r = byName.get(f)
      return !r || !r.billed || r.takes
    })
    expect(stale, `Exempt files that are gone, carry no billing marker, or now take a slot — delete them:\n${stale.join("\n")}`).toEqual([])
    const gone = [...GUARDED_WITHOUT_MARKER.keys()].filter((f) => !byName.has(f) || byName.get(f)!.billed)
    expect(gone, `Pinned files that are gone or now carry a billing marker (the totality covers them) — delete them:\n${gone.join("\n")}`).toEqual([])
  })
})
