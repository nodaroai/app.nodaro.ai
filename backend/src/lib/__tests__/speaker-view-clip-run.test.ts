import { describe, it, expect, vi } from "vitest"
import { ClipMeasureError } from "../clip-measure.js"
import { speakerViewClipOfRun } from "../speaker-view-clip-run.js"

const URL = "https://cdn.example.test/uploads/videos/clip.mp4"
const TRANSCRIPT = JSON.stringify({ words: [{ text: "a", start: 0, end: 1, speaker: "A" }] })
const deps = (over: { videoModeLive?: boolean; measure?: (u: string) => Promise<{ durationMs: number }> } = {}) => ({
  videoModeLive: () => over.videoModeLive ?? true,
  measure: vi.fn(over.measure ?? (async () => ({ durationMs: 14_600, width: 640, height: 360 }))),
})

describe("speakerViewClipOfRun", () => {
  it("measures the wired video once and returns its facts", async () => {
    const d = deps()
    await expect(speakerViewClipOfRun({ videoUrl: URL, transcript: TRANSCRIPT }, d)).resolves.toEqual({ durationMs: 14_600, width: 640, height: 360 })
    expect(d.measure).toHaveBeenCalledWith(URL)
  })

  it("measures nothing when there is no video, or an edit is wired beside it", async () => {
    const d = deps()
    await expect(speakerViewClipOfRun({ transcript: TRANSCRIPT }, d)).resolves.toBeUndefined()
    await expect(speakerViewClipOfRun({ videoUrl: URL, edl: "{}", transcript: TRANSCRIPT }, d)).resolves.toBeUndefined()
    expect(d.measure).not.toHaveBeenCalled()
  })

  it("measures nothing when the edit sits inline on the node beside the wired video (the builder refuses it)", async () => {
    const d = deps()
    await expect(speakerViewClipOfRun({ videoUrl: URL, inlineEdl: { version: 1 }, transcript: TRANSCRIPT }, d)).resolves.toBeUndefined()
    await expect(speakerViewClipOfRun({ videoUrl: URL, inlineEdl: "{}", transcript: TRANSCRIPT }, d)).resolves.toBeUndefined()
    expect(d.measure).not.toHaveBeenCalled()
    // An empty inline edit is no edit.
    await expect(speakerViewClipOfRun({ videoUrl: URL, inlineEdl: "", transcript: TRANSCRIPT }, d)).resolves.toEqual({ durationMs: 14_600, width: 640, height: 360 })
  })

  it("measures nothing while Speaker View has no price", async () => {
    const d = deps({ videoModeLive: false })
    await expect(speakerViewClipOfRun({ videoUrl: URL, transcript: TRANSCRIPT }, d)).resolves.toBeUndefined()
    expect(d.measure).not.toHaveBeenCalled()
  })

  it("measures nothing for a run the transcript rule refuses", async () => {
    const d = deps()
    await expect(speakerViewClipOfRun({ videoUrl: URL }, d)).resolves.toBeUndefined()
    await expect(speakerViewClipOfRun({ videoUrl: URL, transcript: JSON.stringify({ words: [{ text: "a", start: 0, end: 1 }] }) }, d)).resolves.toBeUndefined()
    expect(d.measure).not.toHaveBeenCalled()
  })

  it("fails with the measurement's sentence, prefixed like every Speaker View refusal", async () => {
    const d = deps({ measure: async () => { throw new ClipMeasureError("unmeasured", "Could not tell exactly how long this video runs.") } })
    await expect(speakerViewClipOfRun({ videoUrl: URL, transcript: TRANSCRIPT }, d)).rejects.toThrow("speaker-view: Could not tell exactly how long this video runs.")
  })
})
