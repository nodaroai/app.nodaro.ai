/**
 * `followPreviewMasking` decides from the body it was given (what is sent),
 * never from a separate flag a caller could pass out of step with it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const from = vi.fn()
vi.mock("../../../../lib/supabase.js", () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

import { engineSupports, followPreviewMasking, withoutUnsupportedStoredMask } from "../run-helpers.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
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
    needs: { roleKinds: new Set(), fixedReferences: false, faceMasking: true, faceMaskTarget: "head", trendPrePrompt: false, engine: "seedance-2-5" },
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

describe("the stored face mask on the wire", () => {
  beforeEach(() => {
    from.mockReset()
    _resetPluginSupportsForTests()
  })

  const STORED = { url: "https://cdn.example/trends/t/mask.mp4", frames: 360 }
  const withStored = (masking: Record<string, unknown>) => {
    const c = composed(false)
    c.body.faceMasking = masking as never
    c.body.storedFaceMask = { ...STORED }
    return c
  }
  /** A completed masked preview of trend "t" by "u", masked with `fill` and `zone`. */
  function previewJob(stored: Record<string, unknown>, output: Record<string, unknown> = { faceMasking: { applied: true } }) {
    const row = {
      id: PREVIEW_JOB,
      user_id: "u",
      status: "completed",
      input_data: { type: "cast-swap", preview: true, trend: { id: "t" }, __faceMasking: stored },
      output_data: output,
    }
    const chain = { select: () => chain, eq: () => chain, is: () => chain, maybeSingle: async () => ({ data: row, error: null }) }
    from.mockReturnValue(chain)
  }

  it("is kept for an engine that takes it, and dropped for one that does not", () => {
    setPluginSupports({ castSwap: { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: [], trendRun: true, storedFaceMask: true } })
    const kept = withStored({ mode: "always" })
    withoutUnsupportedStoredMask(kept)
    expect(kept.body.storedFaceMask).toEqual(STORED)

    setPluginSupports({ castSwap: { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: [], trendRun: true } })
    const dropped = withStored({ mode: "always" })
    withoutUnsupportedStoredMask(dropped)
    expect(dropped.body).not.toHaveProperty("storedFaceMask")
  })

  it("a full run that follows its masked preview keeps the stored mask (sent as always)", async () => {
    // The usual Auto trend: fill and zone left out; its preview stored the resolved ones.
    previewJob({ fill: "blur", zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 } })
    const c = withStored({ mode: "auto", zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 } })
    await followPreviewMasking(c, { userId: "u", trendId: "t", previewJobId: PREVIEW_JOB })
    expect(c.body.faceMasking).toMatchObject({ mode: "always", fill: "blur" })
    expect(c.body.storedFaceMask).toEqual(STORED)
  })

  it("reads the preview's outcome from the completion's `privacy` (0.394.0+), else its old `faceMasking`", async () => {
    for (const output of [{ privacy: { applied: true } }, { privacy: { applied: true }, faceMasking: { applied: true } }, { faceMasking: { applied: true } }]) {
      previewJob({ fill: "blur" }, output)
      const c = withStored({ mode: "auto" })
      await followPreviewMasking(c, { userId: "u", trendId: "t", previewJobId: PREVIEW_JOB })
      expect(c.body.faceMasking, JSON.stringify(output)).toMatchObject({ mode: "always" })
    }
    // `privacy` wins: a preview it says was not masked is not followed.
    previewJob({ fill: "blur" }, { privacy: { applied: false }, faceMasking: { applied: true } })
    const c = withStored({ mode: "auto" })
    await followPreviewMasking(c, { userId: "u", trendId: "t", previewJobId: PREVIEW_JOB })
    expect(c.body.faceMasking).toMatchObject({ mode: "auto" })
  })

  it("a full run that follows its masked preview keeps the trend's target", async () => {
    previewJob({ fill: "blur" })
    const c = withStored({ mode: "auto", target: "face" })
    await followPreviewMasking(c, { userId: "u", trendId: "t", previewJobId: PREVIEW_JOB })
    expect(c.body.faceMasking).toMatchObject({ mode: "always", target: "face" })
  })
})

describe("engineSupports — what the masks cover", () => {
  beforeEach(() => _resetPluginSupportsForTests())
  const BASE = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["480p" as const], trendRun: true, faceMasking: true }
  const target = (t: "face" | "head") => {
    const c = composed(false)
    c.needs.faceMaskTarget = t
    return c
  }

  it("runs a head trend on any masking engine, declared or not", () => {
    setPluginSupports({ castSwap: BASE })
    expect(engineSupports(target("head"))).toBe(true)
    setPluginSupports({ castSwap: { ...BASE, faceMaskTargets: ["face", "head"] } })
    expect(engineSupports(target("head"))).toBe(true)
  })

  it("holds back a face-only trend from an engine that does not declare it (it would strip the target and mask heads)", () => {
    setPluginSupports({ castSwap: BASE })
    expect(engineSupports(target("face"))).toBe(false)
    setPluginSupports({ castSwap: { ...BASE, faceMaskTargets: ["head"] } })
    expect(engineSupports(target("face"))).toBe(false)
    setPluginSupports({ castSwap: { ...BASE, faceMaskTargets: ["face", "head"] } })
    expect(engineSupports(target("face"))).toBe(true)
  })
})
