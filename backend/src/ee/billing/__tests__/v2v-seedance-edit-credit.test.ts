import { describe, it, expect } from "vitest"
import { SEEDANCE_VIDEO_EDIT_PROVIDERS, VIDEO_TO_VIDEO_PROVIDERS, seedanceVideoEditCreditId, MODEL_CATALOG } from "@nodaro/shared"
import { CreditsService, STATIC_CREDIT_COSTS } from "../credits.js"

/**
 * The Video to Video node's Seedance EDIT lane is a text-to-video job in edit
 * shape (Seedance has no v2v endpoint), so it reserves on the REFERENCE-VIDEO
 * ladder at the model's longest clip and settles down to what was delivered.
 *
 * Four surfaces must agree on that identifier: this pre-run estimate, the
 * orchestrator's reservation (payload-builder.ts), the node's cost pill, and
 * the frontend's run-level estimate. They all call `seedanceVideoEditCreditId`,
 * so what is left to pin is (a) that the estimator reaches it at all, and
 * (b) that every id it can produce is actually priced — the documented
 * `price_not_configured` 503 / blank-pill trap.
 */
describe("video-to-video — Seedance edit lane credit identifier", () => {
  const estimate = (data: Record<string, unknown>) =>
    CreditsService.estimateWorkflowBaseCredits([{ type: "video-to-video", data }])

  it("every (provider × resolution) the node can be configured to is priced", () => {
    for (const provider of SEEDANCE_VIDEO_EDIT_PROVIDERS) {
      const resolutions = MODEL_CATALOG[provider]?.resolutions ?? []
      expect(resolutions.length, `${provider} declares no resolutions`).toBeGreaterThan(0)
      // …plus the unset case, which prices the model's own UI fill.
      for (const resolution of [...resolutions, undefined]) {
        const id = seedanceVideoEditCreditId(provider, resolution)
        expect(id).toMatch(/-ref$/) // the reference-video ladder, always
        expect(
          STATIC_CREDIT_COSTS[id],
          `${id} has no price — the pre-run estimate would 503 price_not_configured`,
        ).toBeGreaterThan(0)
      }
    }
  })

  it("the pre-run estimate quotes the reservation's id, not the bare provider key", () => {
    for (const provider of SEEDANCE_VIDEO_EDIT_PROVIDERS) {
      for (const v2vResolution of MODEL_CATALOG[provider]?.resolutions ?? []) {
        expect(estimate({ provider, v2vResolution })).toBe(
          STATIC_CREDIT_COSTS[seedanceVideoEditCreditId(provider, v2vResolution)],
        )
      }
      // The bare key is the 8s 720p row — an under-quote this branch exists to
      // avoid, so the estimate must NOT land on it for a longer/pricier tier.
      expect(estimate({ provider, v2vResolution: "1080p" })).not.toBe(STATIC_CREDIT_COSTS[provider])
    }
  })

  it("leaves every /v1/video-to-video ROUTE provider on its own flat key", () => {
    for (const provider of VIDEO_TO_VIDEO_PROVIDERS) {
      const flat = STATIC_CREDIT_COSTS[provider]
      if (flat === undefined) continue // priced in model_pricing only
      expect(estimate({ provider, v2vResolution: "1080p" }), provider).toBe(flat)
    }
  })
})

/**
 * Generate Video with Seedance 2.5 and a wired reference video makes the same
 * KIE call as the Video to Video edit lane, so the pre-run estimate quotes them
 * from the same identifier: the reference-video ladder (known from the
 * `videoReferences` EDGE — never node data), at the resolution the run sends
 * (the model's UI fill when unset, 480p for a draft). Mirrors the editor's
 * `seedance-ref-quote-parity.test.ts`.
 */
describe("Seedance 2.5 reference-video estimate — Generate Video ≡ Video to Video", () => {
  const clip = { id: "clip", type: "upload-video", data: { videoUrl: "https://cdn.example/clip.mp4" } }
  const base = CreditsService.estimateWorkflowBaseCredits([clip])
  const generateVideo = (data: Record<string, unknown>, wired = true) =>
    CreditsService.estimateWorkflowBaseCredits(
      [clip, { id: "gv", type: "generate-video", data: { provider: "seedance-2-5", duration: -1, ...data } }],
      wired ? [{ source: "clip", target: "gv", sourceHandle: "video", targetHandle: "videoReferences" }] : [],
    ) - base
  const videoToVideo = (data: Record<string, unknown>) =>
    CreditsService.estimateWorkflowBaseCredits(
      [clip, { id: "v2v", type: "video-to-video", data: { provider: "seedance-2-5", ...data } }],
      [{ source: "clip", target: "v2v", sourceHandle: "video", targetHandle: "video" }],
    ) - base

  it("quotes the same id for the same KIE call (Auto, resolution unset)", () => {
    expect(generateVideo({})).toBe(STATIC_CREDIT_COSTS["seedance-2-5:30s:480p-ref"])
    expect(videoToVideo({})).toBe(STATIC_CREDIT_COSTS["seedance-2-5:30s:480p-ref"])
  })

  it("quotes the same id at a chosen resolution", () => {
    expect(generateVideo({ resolution: "720p" })).toBe(STATIC_CREDIT_COSTS["seedance-2-5:30s:720p-ref"])
    expect(videoToVideo({ v2vResolution: "720p" })).toBe(STATIC_CREDIT_COSTS["seedance-2-5:30s:720p-ref"])
  })

  it("a draft is quoted at 480p on both nodes", () => {
    expect(generateVideo({ resolution: "720p", draft: true })).toBe(STATIC_CREDIT_COSTS["seedance-2-5:30s:480p-ref"])
    expect(videoToVideo({ v2vResolution: "720p", draft: true })).toBe(STATIC_CREDIT_COSTS["seedance-2-5:30s:480p-ref"])
  })

  it("no reference video wired (or no edges known) stays on the plain ladder — never under-quoted", () => {
    expect(generateVideo({ resolution: "720p" }, false)).toBe(STATIC_CREDIT_COSTS["seedance-2-5:30s:720p"])
    expect(
      CreditsService.estimateWorkflowBaseCredits([{ type: "generate-video", data: { provider: "seedance-2-5", duration: -1, resolution: "720p" } }]),
    ).toBe(STATIC_CREDIT_COSTS["seedance-2-5:30s:720p"])
  })
})
