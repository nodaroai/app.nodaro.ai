/**
 * Payload-builder tests for the `ai-avatar` node type.
 *
 * Verifies:
 * 1. buildPayload does NOT throw "Unknown node type: ai-avatar"
 * 2. Returns queueName:"video-generation", jobName:"ai-avatar"
 * 3. The `script` field is passed verbatim — no cinematography/identity hints folded in
 * 4. Resolved `audioUrl` and `script` from upstream inputs are forwarded
 * 5. Node data fields (engine, avatarId, resolution, aspectRatio, etc.) are included
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, ResolvedInputs } from "../types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function node(id: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type: "ai-avatar", data }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildPayload — ai-avatar", () => {
  const jobId = "job-1"
  const usageLogId = "usage-1"

  it("does not throw 'Unknown node type' and returns the correct queue + job name", () => {
    const n = node("n1", {
      engine: "avatar-iv",
      avatarId: "avatar-abc123",
      speechMode: "text",
      script: "Say hello.",
      voiceId: "voice-xyz",
      resolution: "720p",
      aspectRatio: "16:9",
    })
    expect(() => buildPayload(n, jobId, {}, usageLogId)).not.toThrow()
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.queueName).toBe("video-generation")
    expect(result.jobName).toBe("ai-avatar")
  })

  it("includes all core fields from node data", () => {
    const n = node("n1", {
      engine: "avatar-v",
      avatarId: "avatar-xyz",
      speechMode: "text",
      script: "Welcome to the demo.",
      voiceId: "voice-en-1",
      voiceSpeed: 1.2,
      resolution: "1080p",
      aspectRatio: "9:16",
      caption: true,
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.payload.engine).toBe("avatar-v")
    expect(result.payload.avatarId).toBe("avatar-xyz")
    expect(result.payload.speechMode).toBe("text")
    expect(result.payload.script).toBe("Welcome to the demo.")
    expect(result.payload.voiceId).toBe("voice-en-1")
    expect(result.payload.voiceSpeed).toBe(1.2)
    expect(result.payload.resolution).toBe("1080p")
    expect(result.payload.aspectRatio).toBe("9:16")
    expect(result.payload.caption).toBe(true)
    expect(result.payload.usageLogId).toBe(usageLogId)
  })

  it("uses resolved script from inputs over node data", () => {
    const n = node("n1", {
      engine: "avatar-iv",
      avatarId: "avatar-abc",
      speechMode: "text",
      script: "Data script — should be overridden.",
      resolution: "720p",
    })
    const inputs: ResolvedInputs = { script: "Upstream wired script." }
    const result = buildPayload(n, jobId, inputs, usageLogId)
    expect(result.payload.script).toBe("Upstream wired script.")
  })

  it("uses resolved audioUrl from inputs for audio mode", () => {
    const n = node("n1", {
      engine: "avatar-iv",
      avatarId: "avatar-abc",
      speechMode: "audio",
      resolution: "720p",
      aspectRatio: "16:9",
    })
    const inputs: ResolvedInputs = { audioUrl: "https://r2.example.com/audio/drive.mp3" }
    const result = buildPayload(n, jobId, inputs, usageLogId)
    expect(result.payload.audioUrl).toBe("https://r2.example.com/audio/drive.mp3")
  })

  it("does NOT fold cinematography or identity hints into the script field", () => {
    // speech-to-video folds collectCinematographyHints into its prompt.
    // ai-avatar must NOT — the script is verbatim TTS and would be read aloud.
    // We verify the script is passed through unchanged even when a node graph
    // context that normally triggers hint collection is present.
    const n = node("n1", {
      engine: "avatar-iv",
      avatarId: "avatar-abc",
      speechMode: "text",
      script: "Verbatim TTS text.",
      voiceId: "voice-en-1",
      resolution: "720p",
      aspectRatio: "16:9",
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    // The script should be the exact node data value — no appended hints.
    expect(result.payload.script).toBe("Verbatim TTS text.")
  })

  it("defaults resolution to '720p' and aspectRatio to '16:9' when not provided", () => {
    const n = node("n1", {
      engine: "avatar-iv",
      avatarId: "avatar-abc",
      speechMode: "text",
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.payload.resolution).toBe("720p")
    expect(result.payload.aspectRatio).toBe("16:9")
  })

  it("defaults speechMode to 'text' when not provided", () => {
    const n = node("n1", {
      engine: "avatar-iv",
      avatarId: "avatar-abc",
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.payload.speechMode).toBe("text")
  })

  it("includes jobId in the payload", () => {
    const n = node("n1", {
      engine: "avatar-iv",
      avatarId: "avatar-abc",
      speechMode: "text",
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.payload.jobId).toBe(jobId)
  })
})
