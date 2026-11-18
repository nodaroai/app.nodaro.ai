/**
 * Which planned clips of a Clip Pack could not be rendered (decided
 * 2026-11-17): `failedClipList` names the clips `failedClips` counts, in plan
 * order, each with its title, hook and place in the recording.
 */
import { describe, it, expect } from "vitest"
import { CLIP_PACK_DEFAULTS, buildClipPackGraph, resolveClipPackSettings, toStoredInlineGraph } from "@nodaro/render-rules"
import { edlSpanKey } from "@nodaro/shared/nodes"
import { usecaseWrapperOutput } from "../wrapper-output.js"
import { usecaseJobOutput } from "../../../services/workflow-engine/use-case-output.js"
import { assembleFanOutResult, type FanOutIterationValue } from "../../../workers/fan-out-result.js"

const done = (output: object) => ({ status: "completed", output })
const ok = (index: number, url: string, output: Record<string, unknown> = {}): PromiseSettledResult<FanOutIterationValue> => ({
  status: "fulfilled",
  value: { index, resultValue: url, result: { output: { videoUrl: url, ...output }, creditsUsed: 2, jobId: `job-${index}-${url}` } } as FanOutIterationValue,
})
const fail = (msg: string): PromiseSettledResult<FanOutIterationValue> => ({ status: "rejected", reason: new Error(msg) })

describe("a Clip Pack on one recording", () => {
  const g = toStoredInlineGraph(buildClipPackGraph(CLIP_PACK_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video" } }), CLIP_PACK_DEFAULTS)
  const CAM = { id: "cam", url: "https://r2/ep.mp4", kind: "video" }
  const clip = (i: number, meta: Record<string, unknown>) =>
    ({ version: 1, sources: [CAM], segments: [{ id: `s${i}`, video: "cam", inMs: i * 60_000, outMs: i * 60_000 + 30_000 }], meta })
  const plan = [clip(0, { title: "Intro" }), clip(1, { title: "The pivot", hook: "We almost quit." }), clip(2, { title: "Outro" }), clip(3, { title: "Bonus" })]
  const keyOf = (i: number) => edlSpanKey(plan[i]) as string
  const sent = plan.map((_, i) => ({ quality: "final" as const, clipKey: keyOf(i) }))
  const renderOf = (settled: PromiseSettledResult<FanOutIterationValue>[]) => assembleFanOutResult(settled, settled.length, "speaker-view", sent.slice(0, settled.length)).output
  const captionsOf = (settled: PromiseSettledResult<FanOutIterationValue>[]) => assembleFanOutResult(settled, settled.length, "add-captions").output
  const rendered = (i: number) => ok(i, `https://r2/r${i}.mp4`, { quality: "final", clipKey: keyOf(i) })

  it("the clips whose render failed, by name and place, in plan order", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: plan }),
      "uc-render": done(renderOf([fail("Resource temporarily unavailable"), rendered(1), fail("Resource temporarily unavailable"), rendered(3)])),
      "uc-captions": done(captionsOf([ok(0, "https://r2/c1.mp4"), ok(1, "https://r2/c3.mp4")])),
    }, "exec-1")
    expect(out.failedClips).toBe(2)
    expect(out.failedClipList).toEqual([
      { clipKey: keyOf(0), title: "Intro", sourceStartMs: 0, sourceEndMs: 30_000 },
      { clipKey: keyOf(2), title: "Outro", sourceStartMs: 120_000, sourceEndMs: 150_000 },
    ])
    // A delivered clip is never listed as failed.
    expect(out.clips!.map((c) => c.clipKey)).toEqual([keyOf(1), keyOf(3)])
  })

  it("every clip rendered: no list", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: plan.slice(0, 2) }),
      "uc-render": done(renderOf([rendered(0), rendered(1)])),
      "uc-captions": done(captionsOf([ok(0, "https://r2/c0.mp4"), ok(1, "https://r2/c1.mp4")])),
    }, "exec-1")
    expect(out).not.toHaveProperty("failedClips")
    expect(out).not.toHaveProperty("failedClipList")
  })

  it("a row a Stop left never started is not a failure", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: plan.slice(0, 2) }),
      "uc-render": done(renderOf([rendered(0), fail("Execution cancelled")])),
    }, "exec-1")
    expect(out).not.toHaveProperty("failedClipList")
  })

  it("a render that failed outright failed every planned clip: all are listed, as all are counted", () => {
    const out = usecaseWrapperOutput(g, { "uc-plan": done({ json: plan.slice(0, 2) }), "uc-render": { status: "failed", error: "boom" } }, "exec-1")
    expect(out.failedClips).toBe(2)
    expect(out.failedClipList!.map((c) => c.clipKey)).toEqual([keyOf(0), keyOf(1)])
    expect(out.failedClipList![1]).toMatchObject({ title: "The pivot", hook: "We almost quit." })
  })

  it("a job saved before the field shipped reads as it always did on the canvas", () => {
    const old = { videoUrl: "https://r2/c1.mp4", quality: "final", failedClips: 1, clips: [{ url: "https://r2/c1.mp4", quality: "final", clipKey: keyOf(1) }] }
    expect(usecaseJobOutput({ ...old, failedClipList: [{ clipKey: keyOf(0) }] }, "job-1")).toEqual(usecaseJobOutput(old, "job-1"))
  })
})

describe("a Clip Pack on several cameras", () => {
  const cam = (n: number) => ({ url: `https://r2/c${n}.mp4`, kind: "video" as const })
  const settings = resolveClipPackSettings({}, "video", { recordings: 2, masterAudio: true })
  const g = toStoredInlineGraph(buildClipPackGraph(settings, { media: cam(1), moreMedia: [cam(2)], masterAudio: { url: "https://r2/m.wav", kind: "audio" } }), settings)
  const CAMS = [{ id: "uc-source", url: "https://r2/c1.mp4", kind: "video" }, { id: "uc-cam-2", url: "https://r2/c2.mp4", kind: "video" }]
  const clip = (i: number) => ({ version: 1, sources: CAMS, segments: [{ id: `s${i}`, video: "uc-source", inMs: i * 60_000, outMs: i * 60_000 + 30_000 }], meta: { title: `Clip ${i + 1}` } })
  const plan = [0, 1, 2].map(clip)
  const keyOf = (i: number) => edlSpanKey(plan[i]) as string
  const switchOf = (settled: PromiseSettledResult<FanOutIterationValue>[]) => assembleFanOutResult(settled, settled.length, "camera-switch", settled.map(() => ({}))).output
  const switched = (i: number) => ok(i, JSON.stringify({ ...plan[i], switched: true }))
  const renderOf = (clips: number[], settled: PromiseSettledResult<FanOutIterationValue>[]) =>
    assembleFanOutResult(settled, settled.length, "speaker-view", clips.map((i) => ({ quality: "final" as const, clipKey: keyOf(i) }))).output
  const rendered = (row: number, i: number) => ok(row, `https://r2/r${i}.mp4`, { quality: "final", clipKey: keyOf(i) })

  it("a failed Camera Switch row names its planned clip; a failed render row beside it names its own", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: plan }),
      "uc-switch": done(switchOf([switched(0), fail("camera switch failed"), switched(2)])),
      "uc-render": done(renderOf([0, 2], [rendered(0, 0), fail("render failed")])),
    }, "exec-m")
    expect(out.failedClips).toBe(2)
    expect(out.failedClipList!.map((c) => [c.clipKey, c.title])).toEqual([[keyOf(1), "Clip 2"], [keyOf(2), "Clip 3"]])
  })
})
