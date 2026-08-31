/**
 * Dubbing payload parity — the orchestrator engine must forward the same
 * source-precedence and full-surface fields the frontend engine sends
 * (sourceUrl wins, then video, then audio; exactly one reaches the worker).
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"

function node(data: Record<string, unknown> = {}): SimpleNode {
  return { id: "dub1", type: "dubbing", data: { targetLanguage: "es", ...data } }
}

describe("buildPayload — dubbing source precedence + full surface", () => {
  it("audio input alone rides audioUrl", () => {
    const result = buildPayload(node(), "job1", { audioUrl: "https://x/a.mp3" }, "usage1")
    expect(result.modelIdentifier).toBe("elevenlabs-dubbing")
    expect(result.payload.audioUrl).toBe("https://x/a.mp3")
    expect(result.payload.videoUrl).toBeUndefined()
    expect(result.payload.sourceUrl).toBeUndefined()
  })

  it("video wins over audio when both resolve", () => {
    const result = buildPayload(node(), "job1", { audioUrl: "https://x/a.mp3", videoUrl: "https://x/c.mp4" }, "usage1")
    expect(result.payload.videoUrl).toBe("https://x/c.mp4")
    expect(result.payload.audioUrl).toBeUndefined()
  })

  it("a panel sourceUrl beats every wired input", () => {
    const result = buildPayload(
      node({ sourceUrl: "https://youtube.com/watch?v=x" }),
      "job1",
      { audioUrl: "https://x/a.mp3", videoUrl: "https://x/c.mp4" },
      "usage1",
    )
    expect(result.payload.sourceUrl).toBe("https://youtube.com/watch?v=x")
    expect(result.payload.videoUrl).toBeUndefined()
    expect(result.payload.audioUrl).toBeUndefined()
  })

  it("forwards the full-surface fields", () => {
    const result = buildPayload(
      node({
        sourceLanguage: "en", numSpeakers: 0, disableVoiceCloning: true, dropBackgroundAudio: true,
        startTime: 5, endTime: 65, highestResolution: true, useProfanityFilter: true,
        targetAccent: "british", watermark: true,
      }),
      "job1",
      { videoUrl: "https://x/c.mp4" },
      "usage1",
    )
    expect(result.payload).toEqual(expect.objectContaining({
      targetLanguage: "es", sourceLanguage: "en", numSpeakers: 0,
      disableVoiceCloning: true, dropBackgroundAudio: true,
      startTime: 5, endTime: 65, highestResolution: true,
      useProfanityFilter: true, targetAccent: "british", watermark: true,
    }))
  })
})
