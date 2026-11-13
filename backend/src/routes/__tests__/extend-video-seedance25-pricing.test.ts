import { describe, it, expect } from "vitest"
import { resolveExtendVideoIdentifier } from "@/routes/extend-video.js"
import { buildPayload } from "@/services/workflow-engine/payload-builder.js"
import { CreditsService, STATIC_CREDIT_COSTS, getNodeModelIdentifier } from "@/ee/billing/credits.js"
import { pixverseExtendCreditId, tailExtendCreditId, tailExtendResolution } from "@nodaro/shared/credits"
import { EXTEND_VIDEO_PROVIDERS, RETIRED_VIDEO_PROVIDERS, canonicalVideoProvider, isTailExtendProvider } from "@nodaro/shared/models"
import { isSeedanceExtendPricedBySecondsSent, seedanceExtendPrice, seedanceExtendRateCreditId } from "@nodaro/render-rules"
import { quoteBaseCredits } from "@/lib/credit-base-cost.js"
import { tailRecipeSeconds } from "@/lib/extend-recipe.js"
import type { SimpleNode } from "@/services/workflow-engine/types.js"

// ---------------------------------------------------------------------------
// THREE places name the credit identifier an Extend Video run is priced at:
// the HTTP route (guard + reservation), the workflow payload builder
// (orchestrator reservation), and the workflow estimate. If they disagree, a
// run reserves one price against a generation that costs another — and
// commit_credits only ever refunds a surplus, it never collects an upward
// delta, so a shortfall is permanent. Seedance 2.5 is charged per second sent
// and added, on its resolution's two-second row (`seedanceExtendRateCreditId`,
// decided 2026-11-12); every other tail-recipe provider (Seedance 2.0, Kling 4)
// on its own rows (`tailExtendCreditId`); the retired `seedance-2-extend` runs
// as Seedance 2.5 and is priced on its rows. Agreement alone is not enough:
// three producers naming the same UNPRICED id agree too, so every id must be a row.
// ---------------------------------------------------------------------------

const node = (data: Record<string, unknown>): SimpleNode => ({
  id: "n1",
  type: "extend-video",
  data,
})

/** The three producers' ids for one Extend Video request. */
function producers(data: Record<string, unknown>) {
  return {
    route: resolveExtendVideoIdentifier(data),
    run: buildPayload(node({ prompt: "keep going", ...data }), "job-1", { videoUrl: "https://cdn.example.com/source.mp4", kieTaskId: "task-1" }).modelIdentifier,
    estimate: getNodeModelIdentifier({ type: "extend-video", data }),
  }
}

// Unset, under the window, inside both windows, over Seedance 2.0's, over
// Seedance 2.5's, and a string.
const DURATIONS = [undefined, 1, 4, 6, 8, 12, 15, 16, 25, 30, 45, "12"] as const
const RESOLUTIONS = [undefined, "480p", "720p", "1080p", "4k"] as const
// Every tail-recipe provider and every retired id that runs as one of them.
const TAIL_PROVIDERS = [
  ...EXTEND_VIDEO_PROVIDERS.filter(isTailExtendProvider),
  ...Object.keys(RETIRED_VIDEO_PROVIDERS).filter((id) => isTailExtendProvider(RETIRED_VIDEO_PROVIDERS[id])),
]

describe("route, payload builder and estimate name one id for every tail-recipe extend provider × duration × resolution", () => {
  it("Kling 4 and the retired seedance-2-extend are among the providers checked", () => {
    expect(TAIL_PROVIDERS).toContain("kling-4-extend")
    expect(TAIL_PROVIDERS).toContain("seedance-2-extend")
  })

  it.each(TAIL_PROVIDERS)("%s: one priced row, the own row of the provider it runs as", (provider) => {
    const runsAs = canonicalVideoProvider(provider)
    if (!isTailExtendProvider(runsAs)) throw new Error(`${provider} runs as no tail-recipe extend provider`)
    for (const duration of DURATIONS) {
      for (const resolution of RESOLUTIONS) {
        const label = `${provider} ${String(duration)} ${String(resolution)}`
        const ids = producers({ provider, duration, resolution })
        const want = isSeedanceExtendPricedBySecondsSent(runsAs)
          ? seedanceExtendRateCreditId(resolution)
          : tailExtendCreditId(runsAs, duration, resolution)
        expect(ids, label).toEqual({ route: want, run: want, estimate: want })
        expect(STATIC_CREDIT_COSTS[want], label).toBeGreaterThan(0)
        // The workflow run queues exactly the length and resolution it reserved:
        // a stored value the model does not offer (4k, 45 s) never reaches the
        // worker, so the render can never cost more than the row.
        const queued = buildPayload(node({ prompt: "keep going", provider, duration, resolution }), "job-1", { videoUrl: "https://cdn.example.com/source.mp4" }).payload
        expect(queued.duration, label).toBe(tailRecipeSeconds(runsAs, duration))
        expect(queued.resolution, label).toBe(tailExtendResolution(runsAs, resolution))
        if (!isSeedanceExtendPricedBySecondsSent(runsAs)) {
          expect(`${runsAs}:${String(queued.duration)}s:${String(queued.resolution)}`, label).toBe(want)
        }
      }
    }
  })

  it("the retired seedance-2-extend is priced as seedance-2-5-extend, never on a 2.0 row", () => {
    expect(producers({ provider: "seedance-2-extend", duration: 12, resolution: "1080p" })).toEqual({
      route: "seedance-2-5-extend:1080p:per-2s",
      run: "seedance-2-5-extend:1080p:per-2s",
      estimate: "seedance-2-5-extend:1080p:per-2s",
    })
  })

  it("Seedance 2.0 is priced per second added, on its own rows", () => {
    expect(producers({ provider: "seedance-2-0-extend", duration: 6, resolution: "480p" }).run).toBe("seedance-2-0-extend:6s:480p")
    expect(producers({ provider: "seedance-2-0-extend" }).run).toBe("seedance-2-0-extend:8s:720p")
  })

  it("Kling 4 is priced per second added, on its own rows, its 5 s 720p by default", () => {
    expect(producers({ provider: "kling-4-extend" })).toEqual({
      route: "kling-4-extend:5s:720p",
      run: "kling-4-extend:5s:720p",
      estimate: "kling-4-extend:5s:720p",
    })
    expect(producers({ provider: "kling-4-extend", duration: 22, resolution: "1080p" }).run).toBe("kling-4-extend:22s:1080p")
  })
})

// PixVerse V6 is no tail recipe, but its price has the same three producers:
// its own rows (`pixverseExtendCreditId`), one per second added and quality,
// `:audio` with the sound on — on unless turned off.
describe("route, payload builder and estimate name one id for PixVerse V6 × duration × quality × sound", () => {
  const PIXVERSE_DURATIONS = [undefined, 1, 5, 7, 15, 16, 30, "12"] as const
  const PIXVERSE_QUALITIES = [undefined, "360p", "480p", "540p", "720p", "1080p", "4k"] as const
  const SOUNDS = [undefined, true, false] as const

  it("one priced row each, and the run queues exactly what it reserved", () => {
    for (const duration of PIXVERSE_DURATIONS) {
      for (const resolution of PIXVERSE_QUALITIES) {
        for (const generateAudio of SOUNDS) {
          const label = `${String(duration)} ${String(resolution)} ${String(generateAudio)}`
          const data = { provider: "pixverse-v6-extend", duration, resolution, generateAudio }
          const want = pixverseExtendCreditId(duration, resolution, generateAudio)
          expect(producers(data), label).toEqual({ route: want, run: want, estimate: want })
          expect(STATIC_CREDIT_COSTS[want], label).toBeGreaterThan(0)
          const queued = buildPayload(node({ prompt: "keep going", ...data }), "job-1", { videoUrl: "https://cdn.example.com/source.mp4" }).payload
          const sound = queued.generateAudio === false ? "" : ":audio"
          expect(`pixverse-v6-extend:${String(queued.duration)}s:${String(queued.resolution)}${sound}`, label).toBe(want)
        }
      }
    }
  })

  it("480p, which PixVerse V6 does not render, is priced and run at the nearest it does, 540p", () => {
    expect(producers({ provider: "pixverse-v6-extend", duration: 5, resolution: "480p", generateAudio: false })).toEqual({
      route: "pixverse-v6-extend:5s:540p",
      run: "pixverse-v6-extend:5s:540p",
      estimate: "pixverse-v6-extend:5s:540p",
    })
  })

  it("a node that says nothing is priced at 5 s, 720p, with sound", () => {
    expect(producers({ provider: "pixverse-v6-extend" })).toEqual({
      route: "pixverse-v6-extend:5s:720p:audio",
      run: "pixverse-v6-extend:5s:720p:audio",
      estimate: "pixverse-v6-extend:5s:720p:audio",
    })
  })
})

describe("every Extend Video provider is priced on a row, by all three producers alike", () => {
  // The generic video builder names a bare, unpriced id for a provider whose
  // rows it does not know. An Extend Video run priced through it would have no
  // row to reserve and an estimate that falls back to the node-type price.
  const CASES: Array<Record<string, unknown>> = [
    ...EXTEND_VIDEO_PROVIDERS.map((provider) => ({ provider })),
    ...Object.keys(RETIRED_VIDEO_PROVIDERS)
      .filter((id) => (EXTEND_VIDEO_PROVIDERS as readonly string[]).includes(RETIRED_VIDEO_PROVIDERS[id]!))
      .map((provider) => ({ provider })),
    { provider: "veo-extend", model: "quality" },
    { provider: "ltx-2.3-pro", duration: 10 },
    // A node naming no provider runs on the default (VEO), and is quoted so.
    {},
    { model: "quality" },
  ]

  it.each(CASES)("%j", (data) => {
    const ids = producers(data)
    expect(ids.run, "the workflow run reserves what the route reserves").toBe(ids.route)
    expect(ids.estimate, "the estimate quotes what the route reserves").toBe(ids.route)
    expect(STATIC_CREDIT_COSTS[ids.route], ids.route).toBeGreaterThan(0)
  })
})

describe("workflow payload builder — the dispatched payload", () => {
  it("names the provider the run runs as, and carries the node's settings", () => {
    const result = buildPayload(
      node({ provider: "seedance-2-extend", prompt: "keep going", duration: 12, resolution: "1080p" }),
      "job-1",
      { videoUrl: "https://cdn.example.com/source.mp4" },
    )
    expect(result.payload).toMatchObject({
      provider: "seedance-2-5-extend",
      video: "https://cdn.example.com/source.mp4",
      duration: 12,
      resolution: "1080p",
    })
  })
})

describe("workflow payload builder — PixVerse V6", () => {
  it("queues the source, the prompt, the seconds, the quality and the sound it reserved", () => {
    const result = buildPayload(
      node({ provider: "pixverse-v6-extend", prompt: "keep going", duration: 9, resolution: "360p", generateAudio: false }),
      "job-1",
      { videoUrl: "https://cdn.example.com/source.mp4" },
    )
    expect(result.jobName).toBe("extend-video")
    expect(result.modelIdentifier).toBe("pixverse-v6-extend:9s:360p")
    expect(result.payload).toEqual({
      jobId: "job-1",
      provider: "pixverse-v6-extend",
      video: "https://cdn.example.com/source.mp4",
      prompt: "keep going",
      duration: 9,
      resolution: "360p",
      generateAudio: false,
      usageLogId: undefined,
    })
  })

  it.each(["", "ab", "  a  "])("refuses a prompt under 3 characters before anything is reserved (%j)", (prompt) => {
    expect(() =>
      buildPayload(node({ provider: "pixverse-v6-extend", prompt, duration: 5 }), "job-1", { videoUrl: "https://cdn.example.com/source.mp4" }),
    ).toThrow("prompt (what happens next) must be at least 3 characters for pixverse-v6-extend")
  })
})

/** The base credits a Seedance 2.5 extend is charged on a source of `sourceSec` (undefined: not known), as every lane reads it. */
const charge25 = (duration: unknown, resolution: unknown, sourceSec: number | undefined): number => {
  const price = seedanceExtendPrice({ duration, resolution, sourcePictureSec: sourceSec })
  return quoteBaseCredits(STATIC_CREDIT_COSTS[price.rateId]!, price.units)
}

describe("workflow estimate — the quote the user is shown", () => {
  it("Seedance 2.0's default run (8 s, 720p) is quoted at its own row", () => {
    expect(CreditsService.estimateWorkflowBaseCredits([
      { type: "extend-video", data: { provider: "seedance-2-0-extend" } },
    ])).toBe(STATIC_CREDIT_COSTS["seedance-2-0-extend:8s:720p"])
  })

  // No source wired (or one not made yet): the whole 10 s window, the most a run sends.
  it("Seedance 2.5 with no known source is quoted at the whole 10 s window: (10 + 8) ÷ 2 of the 720p row", () => {
    expect(CreditsService.estimateWorkflowBaseCredits([
      { type: "extend-video", data: { provider: "seedance-2-5-extend" } },
    ])).toBe(1710)
    expect(charge25(undefined, undefined, undefined)).toBe(1710)
  })

  it("a stored node on the retired id is quoted as Seedance 2.5", () => {
    expect(CreditsService.estimateWorkflowBaseCredits([
      { type: "extend-video", data: { provider: "seedance-2-extend", duration: 12, resolution: "1080p" } },
    ])).toBe(charge25(12, "1080p", undefined))
  })

  // The source an upload gives (its measured length): the estimate counts
  // min(10, it), exactly what the route holds for it and the worker settles.
  it.each([2, 4, 6.04, 10, 25])("a %s s upload, 8 s added at 720p: the estimate is the charge", (sec) => {
    const nodes = [
      { id: "u", type: "upload-video", data: { url: "https://cdn.example.com/u.mp4", duration: sec, videoDurationSec: sec } },
      { id: "x", type: "extend-video", data: { provider: "seedance-2-5-extend", duration: 8, resolution: "720p" } },
    ]
    const edges = [{ source: "u", target: "x", targetHandle: "video" }]
    expect(CreditsService.estimateWorkflowBaseCredits(nodes, edges)).toBe(charge25(8, "720p", sec))
  })

  it("a generation that has made its video is read at the length it recorded; one not made yet, or run again, at the whole window", () => {
    const gen = (data: Record<string, unknown>) => [
      { id: "g", type: "generate-video", data: { provider: "seedance-2-5", duration: 5, ...data } },
      { id: "x", type: "extend-video", data: { provider: "seedance-2-5-extend", duration: 8, resolution: "720p" } },
    ]
    const edges = [{ source: "g", target: "x", targetHandle: "video" }]
    const extendOnly = (nodes: ReturnType<typeof gen>) => CreditsService.estimateWorkflowBaseCredits(nodes, edges) - CreditsService.estimateWorkflowBaseCredits([nodes[0]!])
    const made = gen({ generatedResults: [{ url: "https://cdn.example.com/g.mp4", duration: 5.04 }], activeResultIndex: 0 })
    // Only the extend runs: the generation hands on the video it made, at the length it recorded.
    expect(CreditsService.estimateWorkflowBaseCredits(made, edges, { runNodeIds: new Set(["x"]) })).toBe(charge25(8, "720p", 5.04))
    // The whole graph runs: the generation makes a new video, of a length not known yet — the whole window.
    expect(extendOnly(made)).toBe(charge25(8, "720p", undefined))
    // Recorded at a whole 8 s, its picture measured at 8.04 s by the run: the quote is exactly the charge.
    const made8 = gen({ duration: 8, generatedResults: [{ url: "https://cdn.example.com/g8.mp4", duration: 8 }], activeResultIndex: 0 })
    expect(CreditsService.estimateWorkflowBaseCredits(made8, edges, { runNodeIds: new Set(["x"]) })).toBe(charge25(8, "720p", 8.04))
    // Not made yet, at a set length or at Auto: the whole window.
    expect(extendOnly(gen({}))).toBe(charge25(8, "720p", undefined))
    expect(extendOnly(gen({ duration: -1 }))).toBe(charge25(8, "720p", undefined))
  })

  // The brief's brute force, through the real estimator: for every source
  // length from 1.8 s to 60 s (tenths), seconds added and resolution, a known
  // upload is quoted exactly the charge (the route's hold on that measured
  // length, `seedanceExtendBaseCredits` = the row × the units, rounded up
  // once), and a generation not made yet is never quoted below it.
  it("brute force through the run estimate: an upload is quoted its charge, a generation not made yet never below it", () => {
    const ADDED = [4, 8, 15, 22, 30]
    const RES = ["480p", "720p", "1080p"] as const
    const unmade = new Map<string, number>()
    for (const duration of ADDED) {
      for (const resolution of RES) {
        unmade.set(`${duration}:${resolution}`, CreditsService.estimateWorkflowBaseCredits([
          { id: "g", type: "generate-video", data: { provider: "seedance-2-5", duration: 5 } },
          { id: "x", type: "extend-video", data: { provider: "seedance-2-5-extend", duration, resolution } },
        ], [{ source: "g", target: "x", targetHandle: "video" }], { runNodeIds: new Set(["x"]) }))
      }
    }
    let cases = 0
    for (let tenths = 18; tenths <= 600; tenths++) {
      const sec = tenths / 10
      for (const duration of ADDED) {
        for (const resolution of RES) {
          const charge = charge25(duration, resolution, sec)
          const quote = CreditsService.estimateWorkflowBaseCredits([
            { id: "u", type: "upload-video", data: { url: "https://cdn.example.com/u.mp4", duration: sec, videoDurationSec: sec } },
            { id: "x", type: "extend-video", data: { provider: "seedance-2-5-extend", duration, resolution } },
          ], [{ source: "u", target: "x", targetHandle: "video" }])
          if (quote !== charge) throw new Error(`${sec} s + ${duration} s at ${resolution}: quote ${quote}, charge ${charge}`)
          if (unmade.get(`${duration}:${resolution}`)! < charge) throw new Error(`unmade ${sec} s + ${duration} s at ${resolution}`)
          cases++
        }
      }
    }
    expect(cases).toBe(583 * 5 * 3)
  })
})
