import { describe, it, expect } from "vitest"
import { renderNodeOf } from "@nodaro/shared"
import { applyEdlCutFields, applyEdlRunCutFields, applyEdlTakeTranscriptField } from "../apply-edl-cut"

// The node's medium is the render registry's rule (RENDER_NODE_TYPES, SV18).
const applyEdlMedium = (data: Readonly<Record<string, unknown>>) => renderNodeOf("apply-edl")!.mediumOf(data)

describe("applyEdlMedium — the node's Output setting", () => {
  it("is audio only when Output says so; video otherwise (the node's default)", () => {
    expect(applyEdlMedium({ output: "audio" })).toBe("audio")
    expect(applyEdlMedium({ output: "video" })).toBe("video")
    expect(applyEdlMedium({})).toBe("video")
  })
})

describe("applyEdlCutFields — one cut on the node", () => {
  it("sets the medium's field and clears the other one", () => {
    expect(applyEdlCutFields("audio", "https://m/a.m4a")).toStrictEqual({ generatedAudioUrl: "https://m/a.m4a", generatedVideoUrl: undefined })
    expect(applyEdlCutFields("video", "https://m/v.mp4")).toStrictEqual({ generatedVideoUrl: "https://m/v.mp4", generatedAudioUrl: undefined })
  })
})

const TRANSCRIPT = { version: 1, words: [{ text: "back", startMs: 420, endMs: 760 }] }

describe("applyEdlRunCutFields — what a run-result lane writes beside the media", () => {
  it("clears the medium the run did NOT produce", () => {
    expect(applyEdlRunCutFields("apply-edl", { audioUrl: "https://m/a.m4a" })).toHaveProperty("generatedVideoUrl", undefined)
    expect(applyEdlRunCutFields("apply-edl", { videoUrl: "https://m/v.mp4" })).toHaveProperty("generatedAudioUrl", undefined)
  })

  it("sets the Transcript output to the one the render was cut with", () => {
    expect(applyEdlRunCutFields("apply-edl", { videoUrl: "https://m/v.mp4", json: TRANSCRIPT })).toStrictEqual({
      generatedAudioUrl: undefined,
      generatedJson: TRANSCRIPT,
    })
    expect(applyEdlRunCutFields("apply-edl", { audioUrl: "https://m/a.m4a", json: TRANSCRIPT })).toStrictEqual({
      generatedVideoUrl: undefined,
      generatedJson: TRANSCRIPT,
    })
  })

  it("CLEARS the Transcript output when the render was cut with none: what the node held is another cut's", () => {
    expect(applyEdlRunCutFields("apply-edl", { videoUrl: "https://m/v.mp4" })).toStrictEqual({
      generatedAudioUrl: undefined,
      generatedJson: undefined,
    })
    expect(applyEdlRunCutFields("apply-edl", { videoUrl: "https://m/v.mp4", json: null })).toStrictEqual({
      generatedAudioUrl: undefined,
      generatedJson: undefined,
    })
  })

  it("writes nothing for any other node type, or an output with no single medium", () => {
    expect(applyEdlRunCutFields("voice-changer", { audioUrl: "https://m/a.mp3" })).toBeUndefined()
    expect(applyEdlRunCutFields("camera-switch", { videoUrl: "https://m/v.mp4", json: TRANSCRIPT })).toBeUndefined()
    expect(applyEdlRunCutFields("apply-edl", { json: TRANSCRIPT })).toBeUndefined()
    expect(applyEdlRunCutFields("apply-edl", { videoUrl: "https://m/v.mp4", audioUrl: "https://m/a.m4a" })).toBeUndefined()
    expect(applyEdlRunCutFields("apply-edl", { audioUrl: "" })).toBeUndefined()
    expect(applyEdlRunCutFields("apply-edl", null)).toBeUndefined()
    expect(applyEdlRunCutFields(undefined, { audioUrl: "https://m/a.m4a" })).toBeUndefined()
  })
})

describe("applyEdlTakeTranscriptField — what a landed take keeps", () => {
  it("the take that IS the render keeps the Transcript it was cut with — or, as an own `undefined`, that it was cut with none", () => {
    expect(applyEdlTakeTranscriptField("apply-edl", { videoUrl: "https://m/v.mp4", json: TRANSCRIPT }, "https://m/v.mp4")).toStrictEqual({ generatedJson: TRANSCRIPT })
    expect(applyEdlTakeTranscriptField("apply-edl", { audioUrl: "https://m/a.m4a", json: TRANSCRIPT }, "https://m/a.m4a")).toStrictEqual({ generatedJson: TRANSCRIPT })
    const none = applyEdlTakeTranscriptField("apply-edl", { videoUrl: "https://m/v.mp4" }, "https://m/v.mp4")
    expect(none).toStrictEqual({ generatedJson: undefined })
    expect(none).toHaveProperty("generatedJson")
  })

  it("a take whose file is not the render the output describes keeps nothing (a list run's other renders)", () => {
    expect(applyEdlTakeTranscriptField("apply-edl", { videoUrl: "https://m/clip-a.mp4", json: TRANSCRIPT }, "https://m/clip-b.mp4")).toBeUndefined()
  })

  it("keeps nothing for any other node type, or an output with no single medium", () => {
    expect(applyEdlTakeTranscriptField("trim-video", { videoUrl: "https://m/v.mp4", json: TRANSCRIPT }, "https://m/v.mp4")).toBeUndefined()
    expect(applyEdlTakeTranscriptField("apply-edl", { videoUrl: "https://m/v.mp4", audioUrl: "https://m/v.mp4" }, "https://m/v.mp4")).toBeUndefined()
    expect(applyEdlTakeTranscriptField("apply-edl", null, "https://m/v.mp4")).toBeUndefined()
  })
})

describe("Speaker View — its transcript output moves with the cut beside its EDL (decided 2026-10-08)", () => {
  const DRAWN = { version: 1, clock: "master", sources: [], segments: [] }
  const out = { videoUrl: "https://m/sv.mp4", json: DRAWN, transcript: TRANSCRIPT }

  it("a run lands the EDL on generatedJson and the remapped transcript on generatedTranscript", () => {
    expect(applyEdlRunCutFields("speaker-view", out)).toStrictEqual({ generatedAudioUrl: undefined, generatedJson: DRAWN, generatedTranscript: TRANSCRIPT })
  })

  it("CLEARS the transcript output when the render carries none (no transcript wired, or an older plugin)", () => {
    expect(applyEdlRunCutFields("speaker-view", { videoUrl: "https://m/sv.mp4", json: DRAWN })).toStrictEqual({ generatedAudioUrl: undefined, generatedJson: DRAWN, generatedTranscript: undefined })
  })

  it("the take that IS the render keeps both, each as an own field", () => {
    expect(applyEdlTakeTranscriptField("speaker-view", out, "https://m/sv.mp4")).toStrictEqual({ generatedJson: DRAWN, generatedTranscript: TRANSCRIPT })
    const none = applyEdlTakeTranscriptField("speaker-view", { videoUrl: "https://m/sv.mp4", json: DRAWN }, "https://m/sv.mp4")
    expect(none).toHaveProperty("generatedTranscript", undefined)
    expect(applyEdlTakeTranscriptField("speaker-view", out, "https://m/other.mp4")).toBeUndefined()
  })

  it("Apply EDL lands no generatedTranscript: its transcript IS its json", () => {
    expect(applyEdlRunCutFields("apply-edl", { videoUrl: "https://m/v.mp4", json: TRANSCRIPT, transcript: { stray: 1 } })).not.toHaveProperty("generatedTranscript")
  })
})
