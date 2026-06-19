import { describe, it, expect } from "vitest"
import { AUDIO_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared"
import { classifyMergeSource } from "../merge-audio-classify"

describe("classifyMergeSource", () => {
  it("classifies voice-changer as an audio track (the reported bug)", () => {
    // voice-changer's default output is audio; it must be a controllable
    // audio track in the merge-video-audio config, not silently dropped.
    expect(classifyMergeSource("voice-changer")).toBe("audio")
  })

  it("routes a dual-output node's video lane by source handle", () => {
    // voice-changer in video mode emits on its `video` source handle.
    expect(classifyMergeSource("voice-changer", "video")).toBe("video")
  })

  it("routes a dual-output node's audio lane by source handle", () => {
    expect(classifyMergeSource("voice-changer", "audio")).toBe("audio")
  })

  it("classifies a video producer as the video source", () => {
    expect(classifyMergeSource("image-to-video")).toBe("video")
  })

  it("classifies an audio producer as an audio track", () => {
    expect(classifyMergeSource("generate-music")).toBe("audio")
  })

  it("resolves sub-workflow output ports pre-classified by the caller", () => {
    expect(classifyMergeSource("__audio__")).toBe("audio")
    expect(classifyMergeSource("__video__")).toBe("video")
  })

  it("preserves split-media as an audio track", () => {
    expect(classifyMergeSource("split-media")).toBe("audio")
  })

  it("returns null for non-media node types so they never render as tracks", () => {
    expect(classifyMergeSource("list")).toBeNull()
    expect(classifyMergeSource("reduce")).toBeNull()
    expect(classifyMergeSource("generate-script")).toBeNull()
  })

  // Invariant guards: the panel consumes the shared single source of truth,
  // so a node type can never again be accepted on the handle/executor but
  // dropped by this config panel (the drift that caused the voice-changer bug).
  it("classifies EVERY shared AUDIO_PRODUCER_TYPE as audio", () => {
    for (const t of AUDIO_PRODUCER_TYPES) {
      expect(classifyMergeSource(t), `${t} should classify as audio`).toBe("audio")
    }
  })

  it("classifies EVERY shared VIDEO_PRODUCER_TYPE as video", () => {
    for (const t of VIDEO_PRODUCER_TYPES) {
      expect(classifyMergeSource(t), `${t} should classify as video`).toBe("video")
    }
  })
})
