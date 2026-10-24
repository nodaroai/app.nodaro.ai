/**
 * `followPreviewMasking` decides from the body it was given (what is sent),
 * never from a separate flag a caller could pass out of step with it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const from = vi.fn()
vi.mock("../../../../lib/supabase.js", () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

import { followPreviewMasking } from "../run-helpers.js"
import type { ComposedTrendRun } from "../compose.js"

const PREVIEW_JOB = "0b7d4b8e-3f1e-4c55-9d1a-6f2c1e9a7b10"

function composed(preview: boolean): ComposedTrendRun {
  return {
    body: {
      videoUrl: "https://cdn.example/clip.mp4",
      roles: [],
      references: [],
      faceMasking: { mode: "auto" },
      preview,
      previewStart: 0,
      resolution: "480p",
      draft: true,
      trendRun: { display: { trend: { id: "t", slug: "s", version: 1, name: "N" }, example: 1, slots: [] } },
    },
    display: { trend: { id: "t", slug: "s", version: 1, name: "N" }, example: 1, slots: [] },
    needs: { roleKinds: new Set(), fixedReferences: false, faceMasking: true, trendPrePrompt: false, engine: "seedance-2-5" },
    maskingZoneLeftOut: true,
  } as ComposedTrendRun
}

describe("followPreviewMasking", () => {
  beforeEach(() => from.mockReset())

  it("reads no job, and keeps auto, when the body it sends is a preview", async () => {
    const c = composed(true)
    await followPreviewMasking(c, { userId: "u", trendId: "t", previewJobId: PREVIEW_JOB })
    expect(from).not.toHaveBeenCalled()
    expect(c.body.faceMasking).toEqual({ mode: "auto" })
  })
})
