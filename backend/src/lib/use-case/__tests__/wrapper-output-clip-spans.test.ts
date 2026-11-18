/**
 * A Clip Pack clip's place in the recording (`sourceStartMs`, `sourceEndMs`,
 * `sourceSpans`): read off the plan clip it renders, on the recording's clock.
 */
import { describe, it, expect } from "vitest"
import { CLIP_PACK_DEFAULTS, buildClipPackGraph, toStoredInlineGraph } from "@nodaro/render-rules"
import { edlSpanKey } from "@nodaro/shared/nodes"
import { usecaseWrapperOutput } from "../wrapper-output.js"
import { clipSourceSpans } from "../wrapper-output-spans.js"
import { usecaseJobOutput } from "../../../services/workflow-engine/use-case-output.js"
import { assembleFanOutResult, type FanOutIterationValue } from "../../../workers/fan-out-result.js"

/** The recording the fixtures are cut from: 20 minutes. */
const RECORDING_MS = 20 * 60_000
const CAM = { id: "cam", url: "https://r2/ep.mp4", kind: "video" }
type Seg = readonly [number, number]
const clip = (segs: readonly Seg[], extra: Record<string, unknown> = {}) =>
  ({ version: 1, sources: [CAM], segments: segs.map(([inMs, outMs], i) => ({ id: `s${i}`, video: "cam", inMs, outMs })), ...extra })

describe("clipSourceSpans", () => {
  it("one stretch: its start and end, no list", () => {
    expect(clipSourceSpans(clip([[372_000, 402_500]]))).toEqual({ sourceStartMs: 372_000, sourceEndMs: 402_500 })
  })
  it("several stretches: sorted by start, touching or overlapping ones merged, start/end the outer bounds", () => {
    const c = clip([[600_000, 610_000], [120_000, 130_000], [130_000, 135_000], [134_000, 140_000], [300_000, 301_000]])
    expect(clipSourceSpans(c)).toEqual({
      sourceStartMs: 120_000,
      sourceEndMs: 610_000,
      sourceSpans: [{ inMs: 120_000, outMs: 140_000 }, { inMs: 300_000, outMs: 301_000 }, { inMs: 600_000, outMs: 610_000 }],
    })
  })
  it("stretches that all merge into one: no list", () => {
    expect(clipSourceSpans(clip([[10_000, 20_000], [20_000, 25_000]]))).toEqual({ sourceStartMs: 10_000, sourceEndMs: 25_000 })
  })
  it("start and end are the clip key's own bounds", () => {
    const c = clip([[600_000, 610_000], [120_000, 130_000]])
    const s = clipSourceSpans(c)!
    expect(`${s.sourceStartMs}-${s.sourceEndMs}`).toBe(edlSpanKey(c))
  })
  it("a JSON-string clip reads the same", () => {
    expect(clipSourceSpans(JSON.stringify(clip([[1_000, 2_000]])))).toEqual({ sourceStartMs: 1_000, sourceEndMs: 2_000 })
  })
  it("nothing for a clip on an output clock, with no usable stretch, or not a clip", () => {
    expect(clipSourceSpans(clip([[1_000, 2_000]], { clock: "output" }))).toBeUndefined()
    expect(clipSourceSpans(clip([[2_000, 2_000], [-5, 10]]))).toBeUndefined()
    expect(clipSourceSpans({ version: 1, sources: [CAM], segments: [{ id: "x", inMs: "a", outMs: null }] })).toBeUndefined()
    expect(clipSourceSpans(undefined)).toBeUndefined()
    expect(clipSourceSpans("{not json")).toBeUndefined()
    expect(clipSourceSpans([clip([[1, 2]])])).toBeUndefined()
  })
  it("an unusable stretch beside usable ones is left out", () => {
    expect(clipSourceSpans(clip([[5_000, 4_000], [1_000, 2_000]]))).toEqual({ sourceStartMs: 1_000, sourceEndMs: 2_000 })
  })
})

describe("a Clip Pack run's clips carry their place in the recording", () => {
  const g = toStoredInlineGraph(buildClipPackGraph(CLIP_PACK_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video" } }), CLIP_PACK_DEFAULTS)
  const done = (output: object) => ({ status: "completed", output })
  const plan = [
    clip([[372_000, 380_000], [395_000, 402_000]], { meta: { title: "The pivot" } }),
    clip([[60_000, 90_000]]),
    clip([[900_000, 930_000]]),
  ]
  const keyOf = (i: number) => edlSpanKey(plan[i]) as string
  const sent = plan.map((_, i) => ({ quality: "final" as const, clipKey: keyOf(i) }))
  const ok = (index: number, url: string, output: Record<string, unknown> = {}): PromiseSettledResult<FanOutIterationValue> => ({
    status: "fulfilled",
    value: { index, resultValue: url, result: { output: { videoUrl: url, ...output }, creditsUsed: 30, jobId: `job-${url}` } } as FanOutIterationValue,
  })
  const fail = (msg: string): PromiseSettledResult<FanOutIterationValue> => ({ status: "rejected", reason: new Error(msg) })
  const renderOf = (settled: PromiseSettledResult<FanOutIterationValue>[]) => assembleFanOutResult(settled, settled.length, "speaker-view", sent.slice(0, settled.length)).output
  const captionsOf = (settled: PromiseSettledResult<FanOutIterationValue>[]) => assembleFanOutResult(settled, settled.length, "add-captions").output
  const rendered = (i: number) => ok(i, `https://r2/r${i}.mp4`, { quality: "final", clipKey: keyOf(i) })

  const run = () => usecaseWrapperOutput(g, {
    "uc-plan": done({ json: plan }),
    "uc-render": done(renderOf([rendered(0), fail("render failed"), rendered(2)])),
    "uc-captions": done(captionsOf([ok(0, "https://r2/c0.mp4"), ok(1, "https://r2/c2.mp4")])),
  }, "exec-1")

  it("each delivered clip names the stretch of the recording its plan clip is cut from", () => {
    expect(run().clips).toEqual([
      {
        url: "https://r2/c0.mp4", quality: "final", clipKey: keyOf(0), title: "The pivot",
        sourceStartMs: 372_000, sourceEndMs: 402_000,
        sourceSpans: [{ inMs: 372_000, outMs: 380_000 }, { inMs: 395_000, outMs: 402_000 }],
      },
      { url: "https://r2/c2.mp4", quality: "final", clipKey: keyOf(2), sourceStartMs: 900_000, sourceEndMs: 930_000 },
    ])
  })

  it("every time is inside the recording, every stretch has a length, and the stretches are sorted", () => {
    for (const c of run().clips ?? []) {
      expect(c.sourceStartMs).toBeGreaterThanOrEqual(0)
      expect(c.sourceEndMs!).toBeLessThanOrEqual(RECORDING_MS)
      expect(c.sourceStartMs!).toBeLessThan(c.sourceEndMs!)
      const spans = c.sourceSpans ?? [{ inMs: c.sourceStartMs!, outMs: c.sourceEndMs! }]
      spans.forEach((s, i) => {
        expect(s.inMs).toBeLessThan(s.outMs)
        expect(s.inMs).toBeGreaterThanOrEqual(c.sourceStartMs!)
        expect(s.outMs).toBeLessThanOrEqual(c.sourceEndMs!)
        if (i > 0) expect(s.inMs).toBeGreaterThan(spans[i - 1]!.outMs)
      })
    }
  })

  it("a clip whose render carries no clip key, or whose plan is gone, reports no place", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-render": done({ videoUrl: "https://r2/r0.mp4", quality: "final", clipKey: keyOf(0) }),
      "uc-captions": done({ videoUrl: "https://r2/c0.mp4" }),
    }, "exec-2")
    expect(out.clips).toEqual([{ url: "https://r2/c0.mp4", quality: "final", clipKey: keyOf(0) }])
  })

  it("a job saved before the fields shipped reads as it always did on the canvas", () => {
    const old = { videoUrl: "https://r2/c0.mp4", quality: "final", clips: [{ url: "https://r2/c0.mp4", quality: "final", clipKey: keyOf(0), title: "The pivot" }] }
    const withFields = { ...old, clips: [{ ...old.clips[0], sourceStartMs: 372_000, sourceEndMs: 402_000, sourceSpans: [{ inMs: 372_000, outMs: 380_000 }] }] }
    expect(usecaseJobOutput(withFields, "job-1")).toEqual(usecaseJobOutput(old, "job-1"))
  })
})
