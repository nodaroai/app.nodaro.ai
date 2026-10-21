// @test-watches backend/src/**/*.ts
/**
 * Every estimate surface prices a use-case node as its viewer's run reads it
 * (decided 2026-10-19): on every recording and the Master audio only for a
 * viewer who may use Speaker Map (`WorkflowEstimateOptions.multicam`,
 * `usecaseMulticamEstimateFor`), else on its first recording, exactly as
 * before multicam. Static prices, unmarked.
 *
 * - The listing (an app's, a component's or a template's stored price) is
 *   shown to everyone, so it is priced as a GENERAL user's run (decided
 *   2026-10-20): several recordings only while Speaker Map is available to
 *   users (`usecaseMulticamForEveryone`, the Speaker Map half of the
 *   `usecaseViewerForEveryone` every listing site passes), never by who publishes it.
 * - An `auto` framing source (decided 2026-10-20) follows faces only for a
 *   viewer Speaker Frames is available to (`framesWithheld` otherwise), and a
 *   listing reads a general user's answer (`usecaseViewerForEveryone`).
 * - The app-run Retry's run-set price takes its runner's flags.
 * - Every file outside the billing module that prices a run for a viewer
 *   passes that viewer's flag, or is named here with the reason it has no use-case
 *   node to expand; no listing site asks a viewer's answer.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { afterEach, beforeAll, describe, it, expect, vi } from "vitest"
vi.mock("@/lib/config.js", async (orig) => ({ ...(await orig<typeof import("@/lib/config.js")>()), hasCredits: () => false }))
import { STATIC_CREDIT_COSTS, estimateRunSetCreditsWithoutUgc, estimateWorkflowListingCredits } from "../credits.js"
import { __availabilityUniverseReadyForTests, __resetAvailabilityOverridesForTests } from "@/lib/availability-override.js"
import { usecaseMulticamForEveryone, usecaseViewerForEveryone } from "@/lib/use-case/inner-availability.js"

const cam = (n: number) => ({ id: `cam${n}`, type: "upload-video", data: { url: `https://r2/cam${n}.mp4`, metadata: { durationSeconds: 5400 } } })
const master = { id: "mic", type: "upload-audio", data: { url: "https://r2/master.wav", metadata: { durationSeconds: 5400 } } }
const tighten = { id: "t1", type: "tighten-episode", data: { label: "Tighten Episode", captions: false, cameras: { wide: 3 } } }
const media = (n: number) => ({ source: `cam${n}`, target: "t1", sourceHandle: "video", targetHandle: "media" })
const masterWire = { source: "mic", target: "t1", sourceHandle: "audio", targetHandle: "masterAudio" }

/** Three cameras + a Master audio wired into one Tighten Episode. */
const MULTICAM = { nodes: [cam(1), cam(2), cam(3), master, tighten], edges: [media(1), media(2), media(3), masterWire] }
/** The same node on its first recording alone: what any other viewer's run reads. */
const ONE = { nodes: [cam(1), tighten], edges: [media(1)] }
/** What a run on the three cameras + master adds to the one-recording run (the render and plan read the same 90 minutes). */
const MULTICAM_STEPS = STATIC_CREDIT_COSTS["audio-sync:4src"]! + STATIC_CREDIT_COSTS["speaker-map"]! + STATIC_CREDIT_COSTS["camera-switch"]!

describe("the listing prices a use-case node as a general user's run reads it (decided 2026-10-20)", () => {
  beforeAll(() => __availabilityUniverseReadyForTests())
  afterEach(() => __resetAvailabilityOverridesForTests())
  /** The deployment's override: Speaker Map withheld from users (admins keep it), or released to all. */
  const speakerMapWithheld = () => __resetAvailabilityOverridesForTests({ nodes: new Set(["tighten-episode", "upload-video", "upload-audio"]) })
  const speakerMapForAll = () => __resetAvailabilityOverridesForTests({ nodes: new Set(["tighten-episode", "upload-video", "upload-audio", "speaker-map"]) })
  // As every listing site calls it (published-apps.ts, workflow-templates.ts, the backfills): the general user's flag.
  const listing = (g: { readonly nodes: ReadonlyArray<{ id: string; type: string; data: Record<string, unknown> }>; readonly edges: typeof MULTICAM.edges }, snapshotSettings?: Record<string, unknown>) =>
    estimateWorkflowListingCredits(g.nodes, g.edges, {
      publishType: "app",
      replaceableMediaNodeIds: new Set(),
      multicam: usecaseMulticamForEveryone(g.nodes),
      ...(snapshotSettings ? { snapshotSettings } : {}),
    })

  it("while Speaker Map is withheld from users: an admin-published multicam listing quotes the one-recording price", async () => {
    speakerMapWithheld()
    expect(await listing(MULTICAM)).toEqual(await listing(ONE))
  })

  it("once Speaker Map is available to all: every recording and the Master audio (Audio Sync, Speaker Map, Camera Switch)", async () => {
    speakerMapForAll()
    const one = await listing(ONE)
    expect(MULTICAM_STEPS).toBeGreaterThan(0)
    expect((await listing(MULTICAM)).preview).toBe(one.preview + MULTICAM_STEPS)
  })

  it("Trailer the same way (decided 2026-10-20): its first recording while Speaker Map is withheld from users, every recording once it is available to all", async () => {
    const trailer = { id: "t1", type: "episode-trailer", data: { label: "Trailer", cameras: { wide: 3 } } }
    const multi = { nodes: [cam(1), cam(2), cam(3), master, trailer], edges: [media(1), media(2), media(3), masterWire] }
    const one = { nodes: [cam(1), trailer], edges: [media(1)] }
    const nodesWith = (extra: string[]) => new Set(["episode-trailer", "upload-video", "upload-audio", ...extra])
    __resetAvailabilityOverridesForTests({ nodes: nodesWith([]) })
    expect(await listing(multi)).toEqual(await listing(one))
    __resetAvailabilityOverridesForTests({ nodes: nodesWith(["speaker-map"]) })
    expect((await listing(multi)).preview).toBe((await listing(one)).preview + MULTICAM_STEPS)
  })

  it("Clip Pack the same way (decided 2026-10-20): its first recording while Speaker Map is withheld from users; every recording once it is available to all, Camera Switch once per clip", async () => {
    const pack = { id: "t1", type: "clip-pack", data: { label: "Clip Pack", cameras: { wide: 3 } } }
    const multi = { nodes: [cam(1), cam(2), cam(3), master, pack], edges: [media(1), media(2), media(3), masterWire] }
    const one = { nodes: [cam(1), pack], edges: [media(1)] }
    const nodesWith = (extra: string[]) => new Set(["clip-pack", "upload-video", "upload-audio", ...extra])
    __resetAvailabilityOverridesForTests({ nodes: nodesWith([]) })
    expect(await listing(multi)).toEqual(await listing(one))
    __resetAvailabilityOverridesForTests({ nodes: nodesWith(["speaker-map"]) })
    // The default pack: 8 clips, each switched on its own.
    const steps = STATIC_CREDIT_COSTS["audio-sync:4src"]! + STATIC_CREDIT_COSTS["speaker-map"]! + 8 * STATIC_CREDIT_COSTS["camera-switch"]!
    expect((await listing(multi)).preview).toBe((await listing(one)).preview + steps)
  })

  it("the range's ceiling follows the same rule", async () => {
    speakerMapWithheld()
    expect((await listing(MULTICAM, {})).ceiling).toEqual((await listing(ONE, {})).ceiling)
    speakerMapForAll()
    const one = await listing(ONE, {})
    expect((await listing(MULTICAM, {})).ceiling!.preview).toBe(one.ceiling!.preview + MULTICAM_STEPS)
  })
})

describe("the listing prices an auto framing source as a general user's run reads it (decided 2026-10-20)", () => {
  beforeAll(() => __availabilityUniverseReadyForTests())
  afterEach(() => __resetAvailabilityOverridesForTests())
  const framed = (framingSource?: string) => ({ ...tighten, data: { label: "Tighten Episode", captions: false, framing: { aspect: "9:16", layout: "stacked" }, ...(framingSource ? { framingSource } : {}) } })
  const graph = (framingSource?: string) => ({ nodes: [cam(1), framed(framingSource)], edges: [media(1)] })
  const listing = (g: ReturnType<typeof graph>) =>
    estimateWorkflowListingCredits(g.nodes, g.edges, { publishType: "app", replaceableMediaNodeIds: new Set(), ...usecaseViewerForEveryone(g.nodes) })
  const BASE = ["tighten-episode", "upload-video"]

  it("while Speaker Frames is withheld from users: the even split's price, exactly a node with no framing source", async () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set(BASE) })
    expect(await listing(graph("auto"))).toEqual(await listing(graph()))
  })

  it("once Speaker Frames is every user's: following faces (more than the even split)", async () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set([...BASE, "speaker-frames"]) })
    expect((await listing(graph("auto"))).preview).toBeGreaterThan((await listing(graph())).preview)
    expect(await listing(graph("auto"))).toEqual(await listing(graph("tracking")))
  })
})

describe("an app run's Retry prices its run set as its runner's run reads it", () => {
  it("multicam for a runner who may use Speaker Map; the first recording for anyone else", async () => {
    const runSet = new Set(["t1"])
    const one = await estimateRunSetCreditsWithoutUgc(ONE.nodes, ONE.edges, runSet)
    expect(await estimateRunSetCreditsWithoutUgc(MULTICAM.nodes, MULTICAM.edges, runSet, { multicam: true })).toBe(one + MULTICAM_STEPS)
    expect(await estimateRunSetCreditsWithoutUgc(MULTICAM.nodes, MULTICAM.edges, runSet)).toBe(one)
  })
  it("an auto framing source as the even split for a runner Speaker Frames is withheld from; following faces for anyone else", async () => {
    const runSet = new Set(["t1"])
    const framed = (framingSource?: string) => [cam(1), { ...tighten, data: { label: "Tighten Episode", captions: false, framing: { aspect: "9:16", layout: "stacked" }, ...(framingSource ? { framingSource } : {}) } }]
    const evenSplit = await estimateRunSetCreditsWithoutUgc(framed(), ONE.edges, runSet)
    expect(await estimateRunSetCreditsWithoutUgc(framed("auto"), ONE.edges, runSet, { framesWithheld: true })).toBe(evenSplit)
    expect(await estimateRunSetCreditsWithoutUgc(framed("auto"), ONE.edges, runSet)).toBe(await estimateRunSetCreditsWithoutUgc(framed("tracking"), ONE.edges, runSet))
    expect(await estimateRunSetCreditsWithoutUgc(framed("auto"), ONE.edges, runSet)).toBeGreaterThan(evenSplit)
  })
})

// ── Site totality ──────────────────────────────────────────────────────────

const SRC = join(__dirname, "..", "..", "..")
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(path)
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : []
  })
}
/** A call of a run estimator that expands use-case nodes for a viewer (the billing module's own definitions excluded). */
const ESTIMATE_CALL = /\b(?:estimateWorkflowCredits(?:Detailed)?|estimateRunSetCredits|estimateRunSetCreditsWithoutUgc|appRunResumeCredits)\s*\(/
/** A listing: priced for everyone (`usecaseViewerForEveryone`: Speaker Map and Speaker Frames), never per viewer. */
const LISTING_CALL = /\bestimateWorkflowListingCredits\s*\(/
/** A viewer's own answer (Speaker Map's or Speaker Frames'). */
const VIEWER_FLAG = /\busecase(?:Multicam(?:Available|EstimateFor)|ViewerEstimateFor|FramesAvailable|RunViewer)\(/
/** Files that price a graph that holds no use-case node to expand (or define the estimators). */
const NO_VIEWER: Readonly<Record<string, string>> = {
  "ee/billing/credits.ts": "the estimators themselves",
  "ee/billing/use-case-estimate.ts": "prices a use-case run's built chain: no use-case node to expand",
  "lib/use-case/continue-credits.ts": "prices a continuation's stored chain: no use-case node to expand",
}

/** The source with its comments blanked (a word in a comment is never a call site's flag). */
function codeOf(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length))
}

/** Each call of `call` in `code`: its line, the text of its arguments (to the matching paren) and the code just before it. */
function callSites(code: string, call: RegExp): Array<{ line: number; args: string; before: string }> {
  const out: Array<{ line: number; args: string; before: string }> = []
  const re = new RegExp(call.source, "g")
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const open = m.index + m[0].length - 1
    let depth = 0
    let end = open
    for (let i = open; i < code.length; i++) {
      if (code[i] === "(") depth++
      else if (code[i] === ")" && --depth === 0) { end = i; break }
    }
    out.push({ line: code.slice(0, m.index).split("\n").length, args: code.slice(open + 1, end), before: code.slice(Math.max(0, m.index - 300), m.index) })
  }
  return out
}

/**
 * A call's arguments that carry the viewer's answers — BOTH (decided
 * 2026-10-20): the `viewer` flags (`usecaseViewerEstimateFor`: Speaker Map's
 * and Speaker Frames'), or that answer asked in place. A bare `multicam`
 * carries Speaker Map's alone, so it no longer counts.
 */
const CARRIES_FLAG = /\bviewer\b|\busecaseViewerEstimateFor\(/
/**
 * The other branch of a choice ON the flags (`viewer.multicam || viewer.framesWithheld ? f(…, viewer) : f(…)`):
 * the call without them is the as-before viewer's, kept byte-identical on purpose.
 */
const ELSE_OF_FLAG = /\b(?:viewer(?:\.framesWithheld)?|flagged)\s*\?[^;?]*:\s*(?:await\s+)?(?:[\w$]+\.)*$/
/** The branch a choice on the flags takes when it is true. */
const THEN_OF_FLAG = /\b(?:viewer(?:\.framesWithheld)?|flagged)\s*\?\s*(?:await\s+)?(?:[\w$]+\.)*$/
const passesFlag = (c: { args: string; before: string }) => CARRIES_FLAG.test(c.args) || ELSE_OF_FLAG.test(c.before) || THEN_OF_FLAG.test(c.before)

describe("every estimate site passes its viewer's flags — Speaker Map's and Speaker Frames' (site totality)", () => {
  const files = sourceFiles(SRC).map((path) => ({ rel: relative(SRC, path).split("\\").join("/"), text: readFileSync(path, "utf8") }))
  const callers = files.filter((f) => ESTIMATE_CALL.test(f.text))

  it("the census finds the estimate surfaces", () => {
    expect(callers.map((f) => f.rel)).toEqual(
      expect.arrayContaining([
        "ee/routes/credits.ts",
        "lib/render-final-run.ts",
        "routes/presentation.ts",
        "routes/api-tokens.ts",
        "routes/component-execute.ts",
        "routes/app-run-resume.ts",
        "ee/lib/app-run-resume-price.ts",
      ]),
    )
  })

  it.each(Object.keys(NO_VIEWER))("%s is still an estimate caller (or leave the list)", (rel) => {
    expect(callers.map((f) => f.rel)).toContain(rel)
  })

  it("each other call site passes the viewer's flags in its own arguments (a comment, or another call in the file, does not count)", () => {
    const missing = callers
      .filter((f) => !(f.rel in NO_VIEWER))
      .flatMap((f) => callSites(codeOf(f.text), ESTIMATE_CALL).filter((c) => !passesFlag(c)).map((c) => `${f.rel}:${c.line}`))
    expect(missing).toEqual([])
  })

  it("the call-site check sees what a file-level word would miss", () => {
    const code = codeOf(
      "// viewer\nestimateWorkflowCredits(nodes, edges)\nestimateWorkflowCredits(nodes, edges, { multicam: true })\nestimateWorkflowCredits(nodes, edges, viewer)\n" +
        "const x = viewer.multicam || viewer.framesWithheld ? await estimateWorkflowCredits(n, e, viewer) : await estimateWorkflowCredits(n, e)",
    )
    // A bare multicam flag no longer counts: it would price an `auto` framing source for the wrong viewer.
    expect(callSites(code, ESTIMATE_CALL).map(passesFlag)).toEqual([false, false, true, true, true])
  })

  it("every listing site passes the general user's flags (Speaker Map's and Speaker Frames'), never a viewer's answer", () => {
    const listingSites = files.filter((f) => f.rel !== "ee/billing/credits.ts" && LISTING_CALL.test(f.text))
    expect(listingSites.map((f) => f.rel)).toEqual(
      expect.arrayContaining(["routes/published-apps.ts", "routes/workflow-templates.ts", "ee/scripts/backfill-listing-range.ts", "ee/scripts/backfill-speech-app-prices.ts"]),
    )
    expect(listingSites.filter((f) => VIEWER_FLAG.test(f.text)).map((f) => f.rel)).toEqual([])
    const unflagged = listingSites.flatMap((f) =>
      callSites(codeOf(f.text), LISTING_CALL).filter((c) => !/\busecaseViewerForEveryone\(/.test(c.args)).map((c) => `${f.rel}:${c.line}`),
    )
    expect(unflagged).toEqual([])
  })
})
