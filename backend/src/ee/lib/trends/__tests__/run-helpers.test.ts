/**
 * `followPreviewMasking` decides from the body it was given (what is sent),
 * never from a separate flag a caller could pass out of step with it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const from = vi.fn()
vi.mock("../../../../lib/supabase.js", () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

import {
  engineSupports,
  followPreviewMasking,
  fullQualityEligible,
  runEngineOf,
  toTrendRun,
  withPreparedPreview,
  withoutUnsupportedFields,
  withoutUnsupportedPulseAudio,
  withoutUnsupportedPrismReferenceAudio,
  withoutUnsupportedStoredMask,
  type RunJobRow,
} from "../run-helpers.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import { PREVIEW_CLIP_RECIPE } from "../preview-clip.js"
import type { ComposedTrendRun } from "../compose.js"
import type { TrendPreviewClip } from "../types.js"
import type { RunCredits } from "../../../../lib/job-credit-status.js"

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
    needs: { roleKinds: new Set(), fixedReferences: false, faceMasking: true, faceMaskTarget: "head", faceMaskSource: "faces", storedFaceMask: false, trendPrePrompt: false, engine: "seedance-2-5" },
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

describe("pulseAudio on the wire", () => {
  beforeEach(() => _resetPluginSupportsForTests())
  const BASE = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }
  function pulse(): ComposedTrendRun {
    const c = composed(false)
    c.body.engine = "kling-4"
    c.body.pulseAudio = "generated"
    return c
  }

  it("is kept for an engine that declares castSwap.pulseAudio", () => {
    setPluginSupports({ castSwap: { ...BASE, pulseAudio: true } })
    const c = pulse()
    withoutUnsupportedFields(c)
    expect(c.body.pulseAudio).toBe("generated")
  })

  it("is dropped for an engine that does not (absent or false), so the body is today's", () => {
    for (const castSwap of [BASE, { ...BASE, pulseAudio: false }]) {
      setPluginSupports({ castSwap })
      const c = pulse()
      withoutUnsupportedPulseAudio(c)
      expect(c.body).not.toHaveProperty("pulseAudio")
      const d = pulse()
      withoutUnsupportedFields(d)
      expect(d.body).not.toHaveProperty("pulseAudio")
    }
  })

  it("adds nothing to a body without it", () => {
    setPluginSupports({ castSwap: { ...BASE, pulseAudio: true } })
    const c = composed(false)
    withoutUnsupportedPulseAudio(c)
    expect(c.body).not.toHaveProperty("pulseAudio")
  })
})

describe("prismReferenceAudio on the wire", () => {
  beforeEach(() => _resetPluginSupportsForTests())
  const BASE = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["480p" as const], trendRun: true }
  const MIXED = { "720p": "none", "1080p": "voice" } as const
  // As composeTrendRun puts it on the body: the non-"full" resolutions.
  function prism(value: ComposedTrendRun["body"]["prismReferenceAudio"], over: Partial<ComposedTrendRun["body"]> = {}, preview = false): ComposedTrendRun {
    const c = composed(preview)
    Object.assign(c.body, over)
    c.body.prismReferenceAudio = value
    return c
  }

  it("is kept as the object (estimate and preview alike) for an engine that declares castSwap.prismReferenceAudioPerResolution", () => {
    for (const castSwap of [{ ...BASE, prismReferenceAudioPerResolution: true }, { ...BASE, prismReferenceAudio: true, prismReferenceAudioPerResolution: true }]) {
      setPluginSupports({ castSwap })
      for (const preview of [false, true]) {
        for (const over of [{}, { resolution: "720p" as const, draft: false }]) {
          const c = prism(MIXED, over, preview)
          withoutUnsupportedFields(c)
          expect(c.body.prismReferenceAudio).toEqual(MIXED)
        }
      }
    }
  })

  it("is the run's own resolution's mode for an engine that declares only castSwap.prismReferenceAudio, and dropped when that is the full audio", () => {
    setPluginSupports({ castSwap: { ...BASE, prismReferenceAudio: true } })
    // The 480p draft: 480p is the full audio here, so no key.
    const draft = prism(MIXED)
    withoutUnsupportedFields(draft)
    expect(draft.body).not.toHaveProperty("prismReferenceAudio")
    for (const [resolution, mode] of [["720p", "none"], ["1080p", "voice"]] as const) {
      const c = prism(MIXED, { resolution, draft: false })
      withoutUnsupportedFields(c)
      expect(c.body.prismReferenceAudio, resolution).toBe(mode)
    }
    // A draft is 480p, whatever else the body says.
    const voiceDraft = prism({ "480p": "voice" })
    withoutUnsupportedPrismReferenceAudio(voiceDraft)
    expect(voiceDraft.body.prismReferenceAudio).toBe("voice")
    // Shaping twice changes nothing.
    withoutUnsupportedPrismReferenceAudio(voiceDraft)
    expect(voiceDraft.body.prismReferenceAudio).toBe("voice")
  })

  it("is dropped for an engine that declares neither (absent or false), so the body is today's", () => {
    for (const castSwap of [BASE, { ...BASE, prismReferenceAudio: false, prismReferenceAudioPerResolution: false }]) {
      setPluginSupports({ castSwap })
      for (const value of [MIXED, { "480p": "voice" as const }]) {
        const c = prism(value)
        withoutUnsupportedPrismReferenceAudio(c)
        expect(c.body).not.toHaveProperty("prismReferenceAudio")
        const d = prism(value, { resolution: "720p", draft: false })
        withoutUnsupportedFields(d)
        expect(d.body).not.toHaveProperty("prismReferenceAudio")
      }
    }
  })

  it("adds nothing to a body without it", () => {
    for (const castSwap of [{ ...BASE, prismReferenceAudio: true }, { ...BASE, prismReferenceAudioPerResolution: true }]) {
      setPluginSupports({ castSwap })
      const c = composed(false)
      withoutUnsupportedFields(c)
      expect(c.body).not.toHaveProperty("prismReferenceAudio")
    }
  })
})

describe("withPreparedPreview — the preview's prepared input clip on the wire", () => {
  beforeEach(() => _resetPluginSupportsForTests())
  const BASE = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["480p" as const], trendRun: true, faceMasking: true, storedFaceMask: true, storedFaceMaskRequired: true }
  const SOURCE = "https://cdn.example/clip.mp4"
  const MASK = { url: "https://cdn.example/trends/t/mask.mp4", frames: 360 }
  const CLIP: TrendPreviewClip = {
    videoUrl: "https://cdn.example/trends/t/preview.mp4",
    durationSec: 5,
    width: 720,
    height: 1280,
    frames: 150,
    sha256: "b".repeat(64),
    sourceVideoUrl: SOURCE,
    startSec: 2,
    recipe: PREVIEW_CLIP_RECIPE,
    madeAt: "2026-10-27T10:00:00.000Z",
  }
  const CLIP_MASK = { url: "https://cdn.example/trends/t/preview-mask.mp4", frames: 150, sha256: "c".repeat(64), sourceMaskUrl: MASK.url }
  const FULL_ASSET = { kind: "full" as const, sha256: "a".repeat(64), durationSec: 12 }

  /** A composed run as compose.ts hands it over: today's body, `sourceAsset` full, and the candidate when given. */
  function run(opts: { preview: boolean; clip?: TrendPreviewClip; mask?: { url: string; frames: number; required?: true } }): ComposedTrendRun {
    const c = composed(opts.preview)
    c.body.previewStart = 2
    c.body.sourceAsset = { ...FULL_ASSET }
    if (opts.mask) c.body.storedFaceMask = { ...opts.mask }
    if (opts.clip) c.preparedPreview = { clip: opts.clip }
    return c
  }
  const wire = (c: ComposedTrendRun) => JSON.parse(JSON.stringify(c.body)) as Record<string, unknown>

  it("an engine that does not declare it gets exactly today's body: no preparedPreview, no sourceAsset, the whole source from previewStart", () => {
    setPluginSupports({ castSwap: BASE })
    const c = run({ preview: true, clip: CLIP, mask: MASK })
    const before = wire(c)
    withPreparedPreview(c)
    const { sourceAsset: _s, ...todays } = before
    expect(wire(c)).toEqual(todays)
    expect(c.body.videoUrl).toBe(SOURCE)
    expect(c.body.previewStart).toBe(2)
    expect(c.body.storedFaceMask).toEqual(MASK)
    expect(c.body).not.toHaveProperty("preparedPreview")
    expect(c.body).not.toHaveProperty("sourceAsset")
    // A full run on such an engine likewise loses its sourceAsset and nothing else.
    const full = run({ preview: false })
    withPreparedPreview(full)
    expect(full.body).not.toHaveProperty("sourceAsset")
    expect(full.body.videoUrl).toBe(SOURCE)
  })

  it("an engine that declares it is sent the clip from 0, preparedPreview true, and sourceAsset naming the clip", () => {
    setPluginSupports({ castSwap: { ...BASE, preparedPreview: true } })
    const c = run({ preview: true, clip: CLIP })
    withPreparedPreview(c)
    expect(c.body.videoUrl).toBe(CLIP.videoUrl)
    expect(c.body.previewStart).toBe(0)
    expect(c.body.preview).toBe(true)
    expect(c.body.preparedPreview).toBe(true)
    expect(c.body.sourceAsset).toEqual({ kind: "preview", sha256: CLIP.sha256, startSec: 2, durationSec: 5, recipe: PREVIEW_CLIP_RECIPE })
    expect(c.body).not.toHaveProperty("storedFaceMask")
  })

  it("on such an engine a run without a candidate (a full run, no current clip) keeps today's body and its sourceAsset full", () => {
    setPluginSupports({ castSwap: { ...BASE, preparedPreview: true } })
    for (const c of [run({ preview: false }), run({ preview: true }), run({ preview: false, clip: CLIP })]) {
      withPreparedPreview(c)
      expect(c.body.videoUrl).toBe(SOURCE)
      expect(c.body.previewStart).toBe(2)
      expect(c.body).not.toHaveProperty("preparedPreview")
      expect(c.body.sourceAsset).toEqual(FULL_ASSET)
    }
  })

  it("swaps the stored face mask for the clip's own cut, keeping `required`", () => {
    setPluginSupports({ castSwap: { ...BASE, preparedPreview: true } })
    const plain = run({ preview: true, clip: { ...CLIP, faceMask: CLIP_MASK }, mask: MASK })
    withPreparedPreview(plain)
    expect(plain.body.storedFaceMask).toEqual({ url: CLIP_MASK.url, frames: 150 })
    expect(plain.body.preparedPreview).toBe(true)
    const required = run({ preview: true, clip: { ...CLIP, faceMask: CLIP_MASK }, mask: { ...MASK, required: true } })
    withPreparedPreview(required)
    expect(required.body.storedFaceMask).toEqual({ url: CLIP_MASK.url, frames: 150, required: true })
  })

  it("a run sent the whole-source mask on a clip with no mask cut keeps today's body (never a clip beside the wrong mask)", () => {
    setPluginSupports({ castSwap: { ...BASE, preparedPreview: true } })
    const c = run({ preview: true, clip: CLIP, mask: MASK })
    withPreparedPreview(c)
    expect(c.body.videoUrl).toBe(SOURCE)
    expect(c.body.previewStart).toBe(2)
    expect(c.body.storedFaceMask).toEqual(MASK)
    expect(c.body).not.toHaveProperty("preparedPreview")
    expect(c.body.sourceAsset).toEqual(FULL_ASSET)
  })

  it("a run whose mask the engine does not take sends the clip without a mask cut (withoutUnsupportedFields order)", () => {
    // Takes prepared previews but no stored mask: the mask goes first, then the clip rides with none.
    setPluginSupports({ castSwap: { ...BASE, storedFaceMask: false, storedFaceMaskRequired: false, preparedPreview: true } })
    const c = run({ preview: true, clip: { ...CLIP, faceMask: CLIP_MASK }, mask: MASK })
    withoutUnsupportedFields(c)
    expect(c.body).not.toHaveProperty("storedFaceMask")
    expect(c.body.videoUrl).toBe(CLIP.videoUrl)
    expect(c.body.preparedPreview).toBe(true)
  })

  it("the candidate itself is never on the wire", () => {
    setPluginSupports({ castSwap: { ...BASE, preparedPreview: true } })
    const c = run({ preview: true, clip: CLIP })
    withPreparedPreview(c)
    expect(JSON.stringify(c.body)).not.toContain("madeAt")
    expect(JSON.stringify(c.body)).not.toContain("sourceVideoUrl")
  })
})

describe("engineSupports — a trend with marks", () => {
  beforeEach(() => _resetPluginSupportsForTests())
  const BASE = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["480p" as const], trendRun: true, faceMasking: true }
  it("runs only on an engine that takes the stored mask (else it would mask per run, covering the faces the marks leave out)", () => {
    const c = composed(false)
    c.needs.storedFaceMask = true
    setPluginSupports({ castSwap: BASE })
    expect(engineSupports(c)).toBe(false)
    // Taking a stored mask is not enough: an engine that strips `required` would mask per run.
    setPluginSupports({ castSwap: { ...BASE, storedFaceMask: true } })
    expect(engineSupports(c)).toBe(false)
    setPluginSupports({ castSwap: { ...BASE, storedFaceMask: true, storedFaceMaskRequired: true } })
    expect(engineSupports(c)).toBe(true)
    c.needs.storedFaceMask = false
    setPluginSupports({ castSwap: BASE })
    expect(engineSupports(c)).toBe(true)
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

  it("runs a trend that hides whole people (faces hidden) only on an engine whose `faceMaskHideTargets` names it", () => {
    const hide = (source: "faces" | null) => {
      const c = composed(false)
      c.needs.faceMaskTarget = "body"
      c.needs.faceMaskSource = source
      return c
    }
    // An engine from before the declaration lists "body" for keep people while refusing it with faces hidden.
    setPluginSupports({ castSwap: { ...BASE, faceMaskTargets: ["face", "head", "body"] } })
    expect(engineSupports(hide("faces"))).toBe(false)
    expect(engineSupports(hide(null))).toBe(false)
    setPluginSupports({ castSwap: { ...BASE, faceMaskTargets: ["face", "head", "body"], faceMaskHideTargets: ["face", "head"] } })
    expect(engineSupports(hide("faces"))).toBe(false)
    setPluginSupports({ castSwap: { ...BASE, faceMaskTargets: ["face", "head", "body"], faceMaskHideTargets: ["face", "head", "body"] } })
    expect(engineSupports(hide("faces"))).toBe(true)
  })
})

/**
 * Nodaro Motion's engine ids (renamed 2026-10-26): every path that reads what
 * a plugin advertises or records works on plugin 0.397.0's ids (the earlier
 * public ids beside the internal ones) AND on a plugin that names only the
 * new ids, before that plugin is ever pinned.
 */
const DECLARED = {
  "0.397.0": ["motion-pro", "motion-lite", "seedance-2-5", "kling-4"],
  "new ids only": ["motion-prism", "motion-pulse"],
} as const
/** What each generation records as a run's engine (a plugin with engine aliases records the public id). */
const RECORDED = {
  "0.397.0": { prism: "motion-pro", pulse: "motion-lite" },
  "new ids only": { prism: "motion-prism", pulse: "motion-pulse" },
} as const

describe.each(Object.keys(DECLARED) as (keyof typeof DECLARED)[])("Nodaro Motion engine ids on a plugin that names %s", (gen) => {
  beforeEach(() => _resetPluginSupportsForTests())
  const BASE = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["480p" as const, "720p" as const], trendRun: true, faceMasking: true }
  const onEngine = (engine: "seedance-2-5" | "kling-4", resolution: "480p" | "720p") => {
    const c = composed(false)
    c.needs.engine = engine
    c.body.resolution = resolution
    return c
  }

  it("runs a trend on either engine (engineSupports)", () => {
    setPluginSupports({ castSwap: { ...BASE, engines: DECLARED[gen], engineAliases: true } })
    expect(engineSupports(onEngine("seedance-2-5", "480p"))).toBe(true)
    expect(engineSupports(onEngine("kling-4", "720p"))).toBe(true)
  })

  it("reads a run's recorded engine, and its Full Quality eligibility, in that plugin's ids", () => {
    const { prism, pulse } = RECORDED[gen]
    expect(runEngineOf({ engine: prism })).toBe("seedance-2-5")
    expect(runEngineOf({ engine: pulse })).toBe("kling-4")
    expect(fullQualityEligible({ engine: pulse, resolution: "720p" })).toBe(true)
    expect(fullQualityEligible({ engine: pulse, resolution: "1080p" })).toBe(false)
    expect(fullQualityEligible({ engine: prism, resolution: "720p" })).toBe(false)
  })

  it("labels a recorded run by the current public id and name (toTrendRun)", () => {
    // No run figures loaded (lib/job-credit-status.ts `runCreditsFor`): the charge reads null.
    const NO_RUN_CREDITS = new Map() as unknown as RunCredits
    const row = (engine: string): RunJobRow => ({
      id: "j-1",
      status: "completed",
      progress: 100,
      input_data: { type: "cast-swap", trend: { id: "t", slug: "s", version: 1, name: "N" }, engine, resolution: "720p" },
      output_data: { videoUrl: "https://cdn.example/out.mp4" },
      error_message: null,
      error_hint: null,
      created_at: "2026-10-26T10:00:00.000Z",
      started_at: null,
      completed_at: "2026-10-26T10:01:00.000Z",
      usage_log_id: null,
    })
    const pulse = toTrendRun(row(RECORDED[gen].pulse), undefined, NO_RUN_CREDITS)!
    expect(pulse).toMatchObject({ engine: "motion-pulse", engineName: "Nodaro Motion Pulse" })
    expect(pulse.fullQualityUntil).not.toBeNull()
    expect(toTrendRun(row(RECORDED[gen].prism), undefined, NO_RUN_CREDITS)).toMatchObject({
      engine: "motion-prism",
      engineName: "Nodaro Motion Prism",
      fullQualityUntil: null,
    })
  })
})
