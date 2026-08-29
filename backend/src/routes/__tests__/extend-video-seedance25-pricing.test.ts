import { describe, it, expect, afterEach, vi } from "vitest"
import { resolveExtendVideoIdentifier } from "@/routes/extend-video.js"
import { buildPayload } from "@/services/workflow-engine/payload-builder.js"
import { CreditsService } from "@/ee/billing/credits.js"
import type { SimpleNode } from "@/services/workflow-engine/types.js"

// ---------------------------------------------------------------------------
// THREE places build the seedance-extend credit identifier: the HTTP route
// (guard + reservation), the workflow payload builder (orchestrator
// reservation), and the workflow estimate. If only one of them learns
// SEEDANCE_EXTEND_GENERATION_MODEL, a workflow-dispatched extend reserves the
// 2.0 price against a 2.5 generation — and commit_credits only ever refunds a
// surplus, it never collects an upward delta, so the shortfall is permanent.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllEnvs()
})

const node = (data: Record<string, unknown>): SimpleNode => ({
  id: "n1",
  type: "extend-video",
  data,
})

describe("route — resolveExtendVideoIdentifier", () => {
  it("lever unset ⇒ today's composite", () => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", undefined as unknown as string)
    expect(
      resolveExtendVideoIdentifier({ provider: "seedance-2-extend", duration: 8, resolution: "720p" }),
    ).toBe("seedance-2-extend:8s:720p")
  })

  it("lever on ⇒ the 2.5 reference composite at the requested resolution", () => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", "seedance-2-5")
    expect(
      resolveExtendVideoIdentifier({ provider: "seedance-2-extend", duration: 8, resolution: "720p" }),
    ).toBe("seedance-2-5:8s:720p-ref")
    expect(
      resolveExtendVideoIdentifier({ provider: "seedance-2-extend", duration: 12, resolution: "480p" }),
    ).toBe("seedance-2-5:12s:480p-ref")
  })

  it("the lever touches ONLY seedance-2-extend — veo/runway/ltx are untouched", () => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", "seedance-2-5")
    expect(resolveExtendVideoIdentifier({ provider: "veo-extend" })).toBe("veo-extend")
    expect(resolveExtendVideoIdentifier({ provider: "veo-extend", model: "quality" })).toBe("veo-extend:quality")
    expect(resolveExtendVideoIdentifier({ provider: "runway-extend" })).toBe("runway-extend")
    expect(resolveExtendVideoIdentifier({ provider: "ltx-2.3-pro" })).toBe("ltx-2.3-pro")
    expect(resolveExtendVideoIdentifier(undefined)).toBe("veo-extend")
  })
})

describe("workflow payload builder — orchestrator reservation", () => {
  it("lever unset ⇒ seedance-2-extend:12s:1080p (unchanged)", () => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", undefined as unknown as string)
    const result = buildPayload(
      node({ provider: "seedance-2-extend", prompt: "keep going", duration: 12, resolution: "1080p" }),
      "job-1",
      { videoUrl: "https://cdn.example.com/source.mp4" },
    )
    expect(result.modelIdentifier).toBe("seedance-2-extend:12s:1080p")
  })

  it("lever on ⇒ the same 2.5 composite the HTTP route reserves", () => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", "seedance-2-5")
    const result = buildPayload(
      node({ provider: "seedance-2-extend", prompt: "keep going", duration: 12, resolution: "1080p" }),
      "job-1",
      { videoUrl: "https://cdn.example.com/source.mp4" },
    )
    expect(result.modelIdentifier).toBe("seedance-2-5:12s:1080p-ref")
    expect(result.modelIdentifier).toBe(
      resolveExtendVideoIdentifier({ provider: "seedance-2-extend", duration: 12, resolution: "1080p" }),
    )
  })

  it("the dispatched payload itself is unchanged — the lever lives server-side", () => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", "seedance-2-5")
    const result = buildPayload(
      node({ provider: "seedance-2-extend", prompt: "keep going", duration: 12, resolution: "1080p" }),
      "job-1",
      { videoUrl: "https://cdn.example.com/source.mp4" },
    )
    expect(result.payload).toMatchObject({
      provider: "seedance-2-extend",
      video: "https://cdn.example.com/source.mp4",
      duration: 12,
      resolution: "1080p",
    })
  })
})

describe("workflow estimate — the quote the user is shown", () => {
  it("lever unset ⇒ 530 for the 8s/720p default", () => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", undefined as unknown as string)
    expect(
      CreditsService.estimateWorkflowCredits([
        { type: "extend-video", data: { provider: "seedance-2-extend" } },
      ]),
    ).toBe(530)
  })

  it("lever on ⇒ the estimate follows the reservation instead of quoting 2.0", () => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", "seedance-2-5")
    const estimate = CreditsService.estimateWorkflowCredits([
      { type: "extend-video", data: { provider: "seedance-2-extend" } },
    ])
    expect(estimate).toBe(760)
    expect(estimate).toBeGreaterThan(530)
  })
})
