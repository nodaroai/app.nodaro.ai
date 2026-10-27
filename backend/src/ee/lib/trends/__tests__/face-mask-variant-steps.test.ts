/**
 * A per-person face mask variant's next step (lib/trends/face-mask-variant-steps.ts):
 * from its erase job and its fill job, as the advance route reads them.
 */
import { describe, expect, it } from "vitest"
import { nextVariantStep } from "../face-mask-variant-steps.js"

const erased = (over: Record<string, unknown> = {}) => ({
  status: "completed",
  output_data: { videoUrl: "https://out.test/erased.mp4", frames: 360, coverage: 0.03, droppedRegions: 4, kept: true, ...over },
})

describe("nextVariantStep", () => {
  it("waits while a step runs, and fails on a failed or missing one with its words", () => {
    expect(nextVariantStep({ eraseJobId: "e" }, { status: "processing" }, null, 360)).toEqual({ kind: "wait" })
    expect(nextVariantStep({ eraseJobId: "e" }, { status: "failed", error_message: "disk full" }, null, 360)).toEqual({ kind: "fail", message: "The mask erase failed: disk full" })
    expect(nextVariantStep({ eraseJobId: "e" }, null, null, 360).kind).toBe("fail")
    expect(nextVariantStep({ eraseJobId: "e", makeJobId: "m" }, erased(), { status: "cancelled" }, 360)).toEqual({ kind: "fail", message: "The face mask fill cancelled." })
    expect(nextVariantStep({ eraseJobId: "e", makeJobId: "m" }, erased(), { status: "pending" }, 360)).toEqual({ kind: "wait" })
  })

  it("fills a finished erase that left something, and says nothing is left when it did not", () => {
    expect(nextVariantStep({ eraseJobId: "e" }, erased(), null, 360)).toEqual({ kind: "make", maskUrl: "https://out.test/erased.mp4" })
    expect(nextVariantStep({ eraseJobId: "e" }, erased({ kept: false, coverage: 0 }), null, 360)).toEqual({ kind: "nothing_left", stats: { coverage: 0, erasedRegions: 4 } })
    // `coverage` is rounded: a mask of a few pixels reads 0 there, but `kept` says it holds some.
    expect(nextVariantStep({ eraseJobId: "e" }, erased({ kept: true, coverage: 0 }), null, 360).kind).toBe("make")
  })

  it("refuses an erase or a fill that changed the frame count (a mark's frames are the clip's)", () => {
    expect(nextVariantStep({ eraseJobId: "e" }, erased({ frames: 359 }), null, 360).kind).toBe("fail")
    const made = { status: "completed", output_data: { maskedUrl: "https://out.test/v.mp4", frames: 361 } }
    expect(nextVariantStep({ eraseJobId: "e", makeJobId: "m" }, erased(), made, 360).kind).toBe("fail")
  })

  it("asks the erase first when the record has none yet", () => {
    expect(nextVariantStep({}, null, null, 360)).toEqual({ kind: "erase" })
  })

  it("fails an erase that was sent keep or eraseAlways boxes but does not say it kept any (a worker that predates them)", () => {
    expect(nextVariantStep({ eraseJobId: "e" }, erased(), null, 360, true).kind).toBe("fail")
    expect(nextVariantStep({ eraseJobId: "e" }, erased({ keptRegions: 0 }), null, 360, true).kind).toBe("make")
    // Without those lists, any worker erases the same.
    expect(nextVariantStep({ eraseJobId: "e" }, erased(), null, 360, false).kind).toBe("make")
  })

  it("is done with the fill's clip and the erase's stats", () => {
    const made = { status: "completed", output_data: { maskedUrl: "https://out.test/v.mp4", frames: 360 } }
    expect(nextVariantStep({ eraseJobId: "e", makeJobId: "m" }, erased(), made, 360)).toEqual({ kind: "done", maskedUrl: "https://out.test/v.mp4", stats: { coverage: 0.03, erasedRegions: 4 } })
  })
})
