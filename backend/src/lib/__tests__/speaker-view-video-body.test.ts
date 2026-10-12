/**
 * `POST /v1/speaker-view` with a `videoUrl` instead of an `edl` (decided
 * 2026-10-11): one guard in front of the cloud plugin's route and the
 * self-host shim alike turns the video into the one-clip edit the plugin
 * already reads (D8), after the same checks and the same server-side length
 * measurement (D16) a workflow run makes.
 */
import { describe, it, expect, vi } from "vitest"
import { isWholeClipEdl } from "@nodaro/render-rules"
import { ClipMeasureError } from "../clip-measure.js"
import { speakerViewVideoBody, speakerViewVideoPrecheck } from "../speaker-view-video-body.js"

const URL = "https://cdn.example.test/uploads/videos/clip.mp4"
const words = (labels: string[]) => ({ words: labels.map((speaker, i) => ({ text: `w${i}`, start: i, end: i + 0.5, speaker })) })
const TRANSCRIPT = words(["Alex", "Alex", "Sam", "Sam"])
const EDL = { version: 1, clock: "master", sources: [{ id: "a", kind: "video", url: URL }], segments: [{ id: "s", inMs: 0, outMs: 1000, video: "a" }] }

const deps = (over: Partial<Parameters<typeof speakerViewVideoBody>[1]> = {}) => ({
  videoModeLive: true,
  measure: vi.fn(async () => ({ durationMs: 14_600, width: 3840, height: 2160 })),
  ...over,
})

describe("speakerViewVideoBody", () => {
  it("passes an edl body through untouched, without measuring", async () => {
    const d = deps()
    await expect(speakerViewVideoBody({ edl: EDL, quality: "final" }, d)).resolves.toEqual({ kind: "pass" })
    expect(d.measure).not.toHaveBeenCalled()
  })

  it("passes anything that is not a body", async () => {
    await expect(speakerViewVideoBody(undefined, deps())).resolves.toEqual({ kind: "pass" })
    await expect(speakerViewVideoBody("x", deps())).resolves.toEqual({ kind: "pass" })
  })

  it("refuses an edl and a videoUrl together", async () => {
    const v = await speakerViewVideoBody({ edl: EDL, videoUrl: URL, transcript: TRANSCRIPT }, deps())
    expect(v).toMatchObject({ kind: "refuse", status: 400, code: "invalid_input" })
    if (v.kind === "refuse") expect(v.message).toMatch(/not both/i)
  })

  it("refuses neither, naming both inputs", async () => {
    const v = await speakerViewVideoBody({ transcript: TRANSCRIPT }, deps())
    expect(v).toMatchObject({ kind: "refuse", status: 400, code: "invalid_input" })
  })

  it("answers video_mode_not_live before measuring anything", async () => {
    const d = deps({ videoModeLive: false })
    const v = await speakerViewVideoBody({ videoUrl: URL, transcript: TRANSCRIPT }, d)
    expect(v).toMatchObject({ kind: "refuse", status: 503, code: "video_mode_not_live" })
    expect(d.measure).not.toHaveBeenCalled()
  })

  it("refuses an address the schema rejects, before measuring", async () => {
    const d = deps()
    const v = await speakerViewVideoBody({ videoUrl: "http://127.0.0.1/a.mp4", transcript: TRANSCRIPT }, d)
    expect(v).toMatchObject({ kind: "refuse", status: 400, code: "validation_error" })
    expect(d.measure).not.toHaveBeenCalled()
  })

  it("requires the transcript (D3), before measuring", async () => {
    const d = deps()
    const none = await speakerViewVideoBody({ videoUrl: URL }, d)
    expect(none).toMatchObject({ kind: "refuse", status: 400, code: "transcript_required" })
    const unlabelled = await speakerViewVideoBody({ videoUrl: URL, transcript: { words: [{ text: "hi", start: 0, end: 1 }] } }, d)
    expect(unlabelled).toMatchObject({ kind: "refuse", status: 422, code: "no_speakers" })
    expect(d.measure).not.toHaveBeenCalled()
  })

  it("rewrites to the whole-clip edl, drops videoUrl, keeps every other field", async () => {
    const d = deps()
    const v = await speakerViewVideoBody({ videoUrl: URL, transcript: JSON.stringify(TRANSCRIPT), quality: "proxy", targetAspect: "9:16", layout: "single" }, d)
    if (v.kind !== "rewrite") throw new Error(JSON.stringify(v))
    expect(d.measure).toHaveBeenCalledWith(URL)
    expect(v.body.videoUrl).toBeUndefined()
    expect(isWholeClipEdl(v.body.edl)).toBe(true)
    expect(v.body).toMatchObject({ quality: "proxy", targetAspect: "9:16", layout: "single", transcript: JSON.stringify(TRANSCRIPT) })
    const edl = v.body.edl as { sources: Array<{ speakers?: string[] }>; segments: Array<{ outMs: number }> }
    expect(edl.segments[0]?.outMs).toBe(14_600)
    expect(edl.sources[0]?.speakers).toEqual(["Alex", "Sam"])
  })

  it("draws at the body's aspect, else 9:16", async () => {
    const a = await speakerViewVideoBody({ videoUrl: URL, transcript: TRANSCRIPT, targetAspect: "1:1" }, deps())
    const b = await speakerViewVideoBody({ videoUrl: URL, transcript: TRANSCRIPT }, deps())
    if (a.kind !== "rewrite" || b.kind !== "rewrite") throw new Error("expected rewrites")
    expect((a.body.edl as { meta: { targetAspect: string } }).meta.targetAspect).toBe("1:1")
    expect((b.body.edl as { meta: { targetAspect: string } }).meta.targetAspect).toBe("9:16")
  })

  it("answers an unreadable clip with the measurement's sentence", async () => {
    const d = deps({ measure: vi.fn(async () => { throw new ClipMeasureError("unmeasured", "Could not tell exactly how long this video runs.") }) })
    const v = await speakerViewVideoBody({ videoUrl: URL, transcript: TRANSCRIPT }, d)
    expect(v).toMatchObject({ kind: "refuse", status: 422, code: "video_unreadable", message: "Could not tell exactly how long this video runs." })
  })

  it("D18: refuses a source that is not wider than the target, before any charge", async () => {
    const d = deps({ measure: vi.fn(async () => ({ durationMs: 5000, width: 1080, height: 1920 })) })
    const v = await speakerViewVideoBody({ videoUrl: URL, transcript: TRANSCRIPT }, d)
    expect(v).toMatchObject({ kind: "refuse", status: 400, code: "source_not_wider" })
  })

  it("does not swallow an unexpected failure as a refusal", async () => {
    const d = deps({ measure: vi.fn(async () => { throw new Error("boom") }) })
    await expect(speakerViewVideoBody({ videoUrl: URL, transcript: TRANSCRIPT }, d)).rejects.toThrow("boom")
  })
})

describe("speakerViewVideoPrecheck (the phase that runs before auth)", () => {
  it("never measures: a passing video request defers with the idle one-clip edit and the facts the run needs", () => {
    const v = speakerViewVideoPrecheck({ videoUrl: URL, transcript: TRANSCRIPT, quality: "proxy" }, { videoModeLive: true })
    expect(v.kind).toBe("defer")
    if (v.kind !== "defer") return
    expect(v.body.videoUrl).toBeUndefined()
    expect(isWholeClipEdl(v.body.edl)).toBe(true)
    expect(v.pending).toMatchObject({ url: URL, quality: "proxy" })
  })

  it("refuses with the cheap checks alone and passes an edl request through", () => {
    expect(speakerViewVideoPrecheck({ videoUrl: URL }, { videoModeLive: true })).toMatchObject({ kind: "refuse", code: "transcript_required" })
    expect(speakerViewVideoPrecheck({ videoUrl: URL, transcript: TRANSCRIPT }, { videoModeLive: false })).toMatchObject({ kind: "refuse", code: "video_mode_not_live" })
    expect(speakerViewVideoPrecheck({ edl: EDL }, { videoModeLive: true })).toEqual({ kind: "pass" })
  })
})
