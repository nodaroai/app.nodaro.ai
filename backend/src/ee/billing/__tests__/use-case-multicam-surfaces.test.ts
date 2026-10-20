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
 *   users (`usecaseMulticamForEveryone`, which every listing site passes),
 *   never by who publishes it.
 * - The app-run Retry's run-set price takes its runner's flag.
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
import { usecaseMulticamForEveryone } from "@/lib/use-case/inner-availability.js"

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

  it("the range's ceiling follows the same rule", async () => {
    speakerMapWithheld()
    expect((await listing(MULTICAM, {})).ceiling).toEqual((await listing(ONE, {})).ceiling)
    speakerMapForAll()
    const one = await listing(ONE, {})
    expect((await listing(MULTICAM, {})).ceiling!.preview).toBe(one.ceiling!.preview + MULTICAM_STEPS)
  })
})

describe("an app run's Retry prices its run set as its runner's run reads it", () => {
  it("multicam for a runner who may use Speaker Map; the first recording for anyone else", async () => {
    const runSet = new Set(["t1"])
    const one = await estimateRunSetCreditsWithoutUgc(ONE.nodes, ONE.edges, runSet)
    expect(await estimateRunSetCreditsWithoutUgc(MULTICAM.nodes, MULTICAM.edges, runSet, true)).toBe(one + MULTICAM_STEPS)
    expect(await estimateRunSetCreditsWithoutUgc(MULTICAM.nodes, MULTICAM.edges, runSet)).toBe(one)
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
const ESTIMATE_CALL = /\b(?:estimateWorkflowCredits|estimateRunSetCredits|estimateRunSetCreditsWithoutUgc|appRunResumeCredits)\s*\(/
/** A listing: priced for everyone (`usecaseMulticamForEveryone`), never per viewer. */
const LISTING_CALL = /\bestimateWorkflowListingCredits\s*\(/
/** A viewer's own answer. */
const VIEWER_FLAG = /\busecaseMulticam(?:Available|EstimateFor)\(/
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

/** A call's arguments that carry a multicam answer: the `multicam` option, or the viewer's answer asked in place. */
const CARRIES_FLAG = /\bmulticam\b|\busecaseMulticam(?:Available|EstimateFor)\(/
/**
 * The other branch of a choice ON the flag (`multicam ? f(…, multicam) : f(…)`):
 * the call without it is the viewer-who-may-not's, kept byte-identical on purpose.
 */
const ELSE_OF_FLAG = /\bmulticam\s*\?[^;?]*:\s*(?:await\s+)?(?:[\w$]+\.)*$/
/** The branch a choice on the flag takes when it is true (the flag passed positionally, `true`). */
const THEN_OF_FLAG = /\bmulticam\s*\?\s*(?:await\s+)?(?:[\w$]+\.)*$/
const passesFlag = (c: { args: string; before: string }) => CARRIES_FLAG.test(c.args) || ELSE_OF_FLAG.test(c.before) || THEN_OF_FLAG.test(c.before)

describe("every estimate site passes its viewer's multicam flag (site totality)", () => {
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

  it("each other call site passes a multicam flag in its own arguments (a comment, or another call in the file, does not count)", () => {
    const missing = callers
      .filter((f) => !(f.rel in NO_VIEWER))
      .flatMap((f) => callSites(codeOf(f.text), ESTIMATE_CALL).filter((c) => !passesFlag(c)).map((c) => `${f.rel}:${c.line}`))
    expect(missing).toEqual([])
  })

  it("the call-site check sees what a file-level word would miss", () => {
    const code = codeOf("// multicam\nestimateWorkflowCredits(nodes, edges)\nestimateWorkflowCredits(nodes, edges, { multicam: true })\nconst x = multicam ? await estimateWorkflowCredits(n, e, { multicam }) : await estimateWorkflowCredits(n, e)")
    expect(callSites(code, ESTIMATE_CALL).map(passesFlag)).toEqual([false, true, true, true])
  })

  it("every listing site passes the general user's flag, never a viewer's answer", () => {
    const listingSites = files.filter((f) => f.rel !== "ee/billing/credits.ts" && LISTING_CALL.test(f.text))
    expect(listingSites.map((f) => f.rel)).toEqual(
      expect.arrayContaining(["routes/published-apps.ts", "routes/workflow-templates.ts", "ee/scripts/backfill-listing-range.ts", "ee/scripts/backfill-speech-app-prices.ts"]),
    )
    expect(listingSites.filter((f) => VIEWER_FLAG.test(f.text)).map((f) => f.rel)).toEqual([])
    const unflagged = listingSites.flatMap((f) =>
      callSites(codeOf(f.text), LISTING_CALL).filter((c) => !/\busecaseMulticamForEveryone\(/.test(c.args)).map((c) => `${f.rel}:${c.line}`),
    )
    expect(unflagged).toEqual([])
  })
})
