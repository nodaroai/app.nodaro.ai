import { describe, it, expect } from "vitest"
import { resolveExtendVideoIdentifier } from "@/routes/extend-video.js"
import { buildPayload } from "@/services/workflow-engine/payload-builder.js"
import { CreditsService, STATIC_CREDIT_COSTS, getNodeModelIdentifier } from "@/ee/billing/credits.js"
import { seedanceExtendCreditId } from "@nodaro/shared/credits"
import { EXTEND_VIDEO_PROVIDERS, RETIRED_VIDEO_PROVIDERS, canonicalVideoProvider, isSeedanceExtendProvider } from "@nodaro/shared/models"
import type { SimpleNode } from "@/services/workflow-engine/types.js"

// ---------------------------------------------------------------------------
// THREE places name the credit identifier an Extend Video run is priced at:
// the HTTP route (guard + reservation), the workflow payload builder
// (orchestrator reservation), and the workflow estimate. If they disagree, a
// run reserves one price against a generation that costs another — and
// commit_credits only ever refunds a surplus, it never collects an upward
// delta, so a shortfall is permanent. Each Seedance provider is priced on its
// own rows (`seedanceExtendCreditId`); the retired `seedance-2-extend` runs as
// Seedance 2.5 and is priced on its rows. Agreement alone is not enough: three
// producers naming the same UNPRICED id agree too, so every id must be a row.
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
// Both Seedance providers and every retired id that runs as one of them.
const SEEDANCE_PROVIDERS = [
  "seedance-2-5-extend",
  "seedance-2-0-extend",
  ...Object.keys(RETIRED_VIDEO_PROVIDERS).filter((id) => isSeedanceExtendProvider(RETIRED_VIDEO_PROVIDERS[id])),
]

describe("route, payload builder and estimate name one id for every Seedance extend provider × duration × resolution", () => {
  it("the retired seedance-2-extend is among the providers checked", () => {
    expect(SEEDANCE_PROVIDERS).toContain("seedance-2-extend")
  })

  it.each(SEEDANCE_PROVIDERS)("%s: one priced row, the own row of the provider it runs as", (provider) => {
    const runsAs = canonicalVideoProvider(provider)
    if (!isSeedanceExtendProvider(runsAs)) throw new Error(`${provider} runs as no Seedance extend provider`)
    for (const duration of DURATIONS) {
      for (const resolution of RESOLUTIONS) {
        const label = `${provider} ${String(duration)} ${String(resolution)}`
        const ids = producers({ provider, duration, resolution })
        const want = seedanceExtendCreditId(runsAs, duration, resolution)
        expect(ids, label).toEqual({ route: want, run: want, estimate: want })
        expect(STATIC_CREDIT_COSTS[want], label).toBeGreaterThan(0)
        // The workflow run queues exactly the length and resolution it reserved:
        // a stored value the model does not offer (4k, 45 s) never reaches the
        // worker, so the render can never cost more than the row.
        const queued = buildPayload(node({ prompt: "keep going", provider, duration, resolution }), "job-1", { videoUrl: "https://cdn.example.com/source.mp4" }).payload
        expect(`${runsAs}:${String(queued.duration)}s:${String(queued.resolution)}`, label).toBe(want)
      }
    }
  })

  it("the retired seedance-2-extend is priced as seedance-2-5-extend, never on a 2.0 row", () => {
    expect(producers({ provider: "seedance-2-extend", duration: 12, resolution: "1080p" })).toEqual({
      route: "seedance-2-5-extend:12s:1080p",
      run: "seedance-2-5-extend:12s:1080p",
      estimate: "seedance-2-5-extend:12s:1080p",
    })
  })

  it("Seedance 2.0 is priced per second added, on its own rows", () => {
    expect(producers({ provider: "seedance-2-0-extend", duration: 6, resolution: "480p" }).run).toBe("seedance-2-0-extend:6s:480p")
    expect(producers({ provider: "seedance-2-0-extend" }).run).toBe("seedance-2-0-extend:8s:720p")
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

describe("workflow estimate — the quote the user is shown", () => {
  it("each Seedance provider's default run (8 s, 720p) is quoted at its own row", () => {
    expect(CreditsService.estimateWorkflowBaseCredits([
      { type: "extend-video", data: { provider: "seedance-2-0-extend" } },
    ])).toBe(STATIC_CREDIT_COSTS["seedance-2-0-extend:8s:720p"])
    expect(CreditsService.estimateWorkflowBaseCredits([
      { type: "extend-video", data: { provider: "seedance-2-5-extend" } },
    ])).toBe(STATIC_CREDIT_COSTS["seedance-2-5-extend:8s:720p"])
  })

  it("a stored node on the retired id is quoted as Seedance 2.5", () => {
    expect(CreditsService.estimateWorkflowBaseCredits([
      { type: "extend-video", data: { provider: "seedance-2-extend", duration: 12, resolution: "1080p" } },
    ])).toBe(STATIC_CREDIT_COSTS["seedance-2-5-extend:12s:1080p"])
  })
})
