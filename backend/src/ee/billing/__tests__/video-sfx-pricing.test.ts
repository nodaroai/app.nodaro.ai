import { describe, it, expect } from "vitest"
import { videoSfxCreditId } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../credits.js"

describe("video-sfx pricing — worked examples (must match docs/nodes/ai-video/video-sfx.md + STATIC_CREDIT_COSTS + migration 288)", () => {
  // (input video seconds, versions, total credits) — the docs' worked-example table.
  const CASES = [
    [5, 1, 10],
    [8, 1, 10],
    [12, 1, 10],
    [30, 1, 20],
    [31, 1, 30],
    [60, 4, 120],
    [180, 1, 110],
  ] as const

  it.each(CASES)("%i s × %i version(s) → %i credits", (seconds, versions, total) => {
    const perVersion = STATIC_CREDIT_COSTS[videoSfxCreditId(seconds)]
    expect(perVersion).toBeDefined()
    expect((perVersion ?? 0) * versions).toBe(total)
  })

  it("the docs' per-version table is the static table, row for row", () => {
    expect([8, 15, 30, 60, 120, 300].map((s) => STATIC_CREDIT_COSTS[videoSfxCreditId(s)])).toEqual([
      10, 10, 20, 30, 50, 110,
    ])
  })
})

describe("video-sfx workflow estimate", () => {
  it("quotes the row an unmeasured clip is charged (8 seconds): the clip is measured only when the run starts", async () => {
    const { CreditsService } = await import("../credits.js")
    expect(
      CreditsService.estimateWorkflowBaseCredits([{ type: "video-sfx", data: { provider: "replicate-mmaudio" } }]),
    ).toBe(STATIC_CREDIT_COSTS["replicate-mmaudio:8s"])
  })
})
