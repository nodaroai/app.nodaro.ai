import { describe, expect, it } from "vitest"
import {
  SIDE_BY_SIDE_FIELD,
  SIDE_BY_SIDE_RECIPE,
  recordedSideBySide,
  sideBySideObjectKey,
  sideBySidePlan,
  staleSideBySideRecipe,
  type SideBySideRun,
} from "../video-remake-side-by-side.js"
import { isOwnedObjectKey } from "../../../lib/job-policy-outputs.js"

/**
 * Which stretch of which clip a finished Video Remake run was made from (the
 * rows below are shaped as real runs record them), who may have it, and
 * where its file is kept.
 */
const JOB = "61c80648-e2e6-487c-8b04-2a865f6a0e63"
const CLIP = "https://cdn.nodaro.ai/uploads/videos/4870d06e.mp4"
const RESULT = `https://cdn.nodaro.ai/videos/${JOB}.mp4`

const run = (input: Record<string, unknown>, output: Record<string, unknown> = {}, over: Partial<SideBySideRun> = {}): SideBySideRun => ({
  id: JOB,
  status: "completed",
  job_type: "cast-swap",
  input_data: { type: "cast-swap", videoUrl: CLIP, ...input },
  output_data: { videoUrl: RESULT, durationSec: 4.042, ...output },
  ...over,
})

describe("sideBySidePlan", () => {
  it("a preview: its start and its recorded length", () => {
    const plan = sideBySidePlan(run({ preview: true, previewStart: 2, sourceDurationSec: 11.96 }, { __castSwapClipSec: 4 }), null, { admin: false })
    expect(plan).toEqual({ ok: true, resultUrl: RESULT, source: { originalUrl: CLIP, startSec: 2, lengthSec: 4 }, keepOffRun: false })
  })

  it("a preview that recorded no length: the preview's 4 s", () => {
    const plan = sideBySidePlan(run({ preview: true, previewStart: 0 }), null, { admin: false })
    expect(plan.ok && plan.source).toEqual({ originalUrl: CLIP, startSec: 0, lengthSec: 4 })
  })

  it("a full Pulse run that sent a cut: the cut (the neutral name, the old one, then the checkpoint)", () => {
    const cut = { startSec: 1, durationSec: 8 }
    for (const output of [{ motionCut: cut }, { klingCut: cut }, { __castSwapKlingCut: cut }]) {
      const plan = sideBySidePlan(run({ preview: false, sourceDurationSec: 9.5 }, { ...output, __castSwapClipSec: 8 }), null, { admin: false })
      expect(plan.ok && plan.source).toEqual({ originalUrl: CLIP, startSec: 1, lengthSec: 8 })
    }
  })

  it("any other full run: the clip from its start, its recorded length, else its own", () => {
    expect(sideBySidePlan(run({ preview: false, sourceDurationSec: 7.3 }, { __castSwapClipSec: 7.3 }), null, { admin: false })).toMatchObject({ source: { startSec: 0, lengthSec: 7.3 } })
    expect(sideBySidePlan(run({ preview: false, sourceDurationSec: 7.3 }), null, { admin: false })).toMatchObject({ source: { startSec: 0, lengthSec: 7.3 } })
    expect(sideBySidePlan(run({ preview: false }), null, { admin: false })).toMatchObject({ source: { startSec: 0, lengthSec: 4.042 } })
  })

  it("a Full Quality version: its draft's clip and stretch", () => {
    const fq = run({ fullQualityOf: "draft-1", preview: false, previewStart: 0, videoUrl: undefined }, {}, { job_type: "cast-swap-full-quality" })
    const draft = run({ preview: true, previewStart: 3 }, { __castSwapClipSec: 4 }, { id: "draft-1" })
    expect(sideBySidePlan(fq, draft, { admin: false })).toEqual({ ok: true, resultUrl: RESULT, source: { originalUrl: CLIP, startSec: 3, lengthSec: 4 }, keepOffRun: false })
    expect(sideBySidePlan(fq, null, { admin: false })).toEqual({ ok: false, refusal: "no_clip" })
  })

  it("a trend run: refused for its runner, its hidden clip for an administrator", () => {
    const trend = run({ trend: { slug: "happy-dancer" }, videoUrl: undefined, __videoUrl: "https://cdn.nodaro.ai/trends/t/src.mp4", preview: true, previewStart: 0, preparedPreview: true }, { __castSwapClipSec: 4 })
    expect(sideBySidePlan(trend, null, { admin: false })).toEqual({ ok: false, refusal: "trend_run" })
    expect(sideBySidePlan(trend, null, { admin: true })).toMatchObject({ ok: true, source: { originalUrl: "https://cdn.nodaro.ai/trends/t/src.mp4", startSec: 0, lengthSec: 4 } })
  })

  it("keeps an administrator's side by side of a trend run off the run's row, which its runner reads", () => {
    const hidden = "https://cdn.nodaro.ai/trends/t/src.mp4"
    const trend = run({ trend: { slug: "happy-dancer" }, videoUrl: undefined, __videoUrl: hidden, preview: true, previewStart: 0 }, { __castSwapClipSec: 4 })
    expect(sideBySidePlan(trend, null, { admin: true })).toMatchObject({ ok: true, keepOffRun: true })
    // A Full Quality version of a trend draft: the draft decides.
    const fq = run({ fullQualityOf: "draft-1", preview: false, videoUrl: undefined }, {}, { job_type: "cast-swap-full-quality" })
    expect(sideBySidePlan(fq, { ...trend, id: "draft-1" }, { admin: true })).toMatchObject({ ok: true, keepOffRun: true })
    expect(sideBySidePlan(fq, { ...trend, id: "draft-1" }, { admin: false })).toEqual({ ok: false, refusal: "trend_run" })
    // Any clip read from the server-only source, trend or not.
    expect(sideBySidePlan(run({ videoUrl: undefined, __videoUrl: hidden }), null, { admin: true })).toMatchObject({ ok: true, keepOffRun: true })
    // The person's own clip: on the run.
    expect(sideBySidePlan(run({ preview: true }), null, { admin: true })).toMatchObject({ ok: true, keepOffRun: false })
  })

  it("never for a run not finished, with no video, with no clip, or of another kind", () => {
    expect(sideBySidePlan(run({}, {}, { status: "processing" }), null, { admin: true })).toEqual({ ok: false, refusal: "not_finished" })
    expect(sideBySidePlan(run({}, { videoUrl: null }), null, { admin: true })).toEqual({ ok: false, refusal: "not_finished" })
    expect(sideBySidePlan(run({ videoUrl: undefined }), null, { admin: true })).toEqual({ ok: false, refusal: "no_clip" })
    expect(sideBySidePlan(run({ type: "generate-video" }, {}, { job_type: "generate-video" }), null, { admin: true })).toEqual({ ok: false, refusal: "not_video_remake" })
  })
})

describe("the file", () => {
  it("is in the run's key family, so the run's reapers and a restriction reach it", () => {
    expect(isOwnedObjectKey(JOB, sideBySideObjectKey(JOB, "s".repeat(32)))).toBe(true)
  })

  it("cannot be guessed from the run's id: its name carries a hash keyed by the server's secret", () => {
    const a = sideBySideObjectKey(JOB, "a".repeat(32))
    expect(a).toBe(sideBySideObjectKey(JOB, "a".repeat(32)))
    expect(a).not.toBe(sideBySideObjectKey(JOB, "b".repeat(32)))
    expect(a).toMatch(new RegExp(`^videos/${JOB}-side-by-side-v${SIDE_BY_SIDE_RECIPE}-[0-9a-f]{20}\\.mp4$`))
  })

  it("is read back only when recorded by the current recipe; an older one's recipe is given, to rebuild its key and remove it", () => {
    const record = { v: SIDE_BY_SIDE_RECIPE, url: "https://cdn.nodaro.ai/videos/x.mp4", width: 1440, height: 1280, layout: "side" }
    expect(recordedSideBySide({ [SIDE_BY_SIDE_FIELD]: record })).toEqual(record)
    expect(recordedSideBySide({ [SIDE_BY_SIDE_FIELD]: { ...record, v: SIDE_BY_SIDE_RECIPE + 1 } })).toBeNull()
    expect(staleSideBySideRecipe({ [SIDE_BY_SIDE_FIELD]: { ...record, v: SIDE_BY_SIDE_RECIPE + 1 } })).toBe(SIDE_BY_SIDE_RECIPE + 1)
    expect(staleSideBySideRecipe({ [SIDE_BY_SIDE_FIELD]: { ...record, v: "1" } })).toBeNull()
    expect(staleSideBySideRecipe({ [SIDE_BY_SIDE_FIELD]: record })).toBeNull()
  })
})
