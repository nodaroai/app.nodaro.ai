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
import { AI_AVATAR_RESERVE_IDS } from "@nodaro/shared"
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
      voiceId: "voice-xyz",
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

  // ── CRITICAL: wired-script reserve must bucket on the SENT script ──────────
  // In a workflow/published-app run, the `script` can be wired from an upstream
  // text producer while `data.script` is empty. The reserve bucket MUST be
  // estimated from the RESOLVED (wired) script — not the empty data.script —
  // otherwise the metered true-up (refund-only) silently undercharges the
  // overage. (Finding R2 #1.)
  it("buckets the reserve on the WIRED script when data.script is empty", () => {
    const longScript = "x".repeat(4000) // ≈ 333s at speed 1 → far above the 30s bucket
    const n = node("n1", {
      engine: "avatar-iv",
      avatarId: "avatar-abc",
      speechMode: "text",
      // data.script intentionally empty — script arrives wired.
      voiceId: "voice-xyz",
      resolution: "720p",
    })
    const inputs: ResolvedInputs = { script: longScript }
    const result = buildPayload(n, jobId, inputs, usageLogId)
    // The wired script is what gets sent.
    expect(result.payload.script).toBe(longScript)
    // estimateScriptDurationSec(4000) ≈ ceil(4000/12) = 334s → 360s bucket.
    // The reserve id must reflect that bucket, NOT the 30s data.script=empty bucket.
    expect(result.modelIdentifier).toBe("heygen-avatar-iv:720p:360s")
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
      script: "Say hello.",
      voiceId: "voice-xyz",
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.payload.resolution).toBe("720p")
    expect(result.payload.aspectRatio).toBe("16:9")
  })

  it("defaults speechMode to 'text' when not provided", () => {
    const n = node("n1", {
      engine: "avatar-iv",
      avatarId: "avatar-abc",
      script: "Say hello.",
      voiceId: "voice-xyz",
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.payload.speechMode).toBe("text")
  })

  it("includes jobId in the payload", () => {
    const n = node("n1", {
      engine: "avatar-iv",
      avatarId: "avatar-abc",
      speechMode: "text",
      script: "Say hello.",
      voiceId: "voice-xyz",
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.payload.jobId).toBe(jobId)
  })

  // ── modelIdentifier must be a SEEDED reserve id (no 503 price_not_configured) ──

  it("emits a SEEDED reserve credit id (member of AI_AVATAR_RESERVE_IDS)", () => {
    // The orchestrator passes this modelIdentifier to reserveCredits →
    // getModelCreditBaseCost, which hard-fails (503) for any unseeded id.
    // Every id buildPayload can emit MUST be one of the 42 seeded bucket ids.
    const n = node("n1", {
      engine: "avatar-iv",
      avatarId: "avatar-abc",
      speechMode: "text",
      script: "Say hello.",
      voiceId: "voice-xyz",
      resolution: "720p",
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(AI_AVATAR_RESERVE_IDS).toContain(result.modelIdentifier)
  })

  it("emits a seeded reserve id for audio mode (top bucket)", () => {
    const n = node("n1", {
      engine: "avatar-v",
      avatarId: "avatar-abc",
      speechMode: "audio",
      resolution: "1080p",
      aspectRatio: "16:9",
    })
    const inputs: ResolvedInputs = { audioUrl: "https://r2.example.com/audio/clip.mp3" }
    const result = buildPayload(n, jobId, inputs, usageLogId)
    expect(AI_AVATAR_RESERVE_IDS).toContain(result.modelIdentifier)
    // Audio mode reserves the 900s top bucket at the requested engine/resolution.
    expect(result.modelIdentifier).toBe("heygen-avatar-v:1080p:900s")
  })

  it("pins the credit engine to avatar-iv in image-source mode (regardless of stored engine)", () => {
    // Image-source mode is IV-class — billing must NOT use avatar-v even if the
    // stale stored engine says so. resolveAiAvatarCreditId enforces this.
    const n = node("n1", {
      avatarSource: "image",
      engine: "avatar-v", // ignored for billing in image mode
      imageUrl: "https://r2.example.com/portrait.png",
      speechMode: "text",
      script: "Hi.",
      voiceId: "voice-xyz",
      resolution: "720p",
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.modelIdentifier).toMatch(/^heygen-avatar-iv:/)
    expect(AI_AVATAR_RESERVE_IDS).toContain(result.modelIdentifier)
  })

  // ── Structural validation gate (workflow/app/MCP bypass the route Zod) ──────
  it("throws when avatar-mode payload is missing avatarId", () => {
    const n = node("n1", {
      avatarSource: "avatar",
      engine: "avatar-iv",
      speechMode: "text",
      script: "Hi.",
      voiceId: "voice-xyz",
    })
    expect(() => buildPayload(n, jobId, {}, usageLogId)).toThrow(/avatarId is required/)
  })

  it("throws when text-mode payload is missing the script", () => {
    const n = node("n1", {
      engine: "avatar-iv",
      avatarId: "avatar-abc",
      speechMode: "text",
      voiceId: "voice-xyz",
    })
    expect(() => buildPayload(n, jobId, {}, usageLogId)).toThrow(/script is required/)
  })

  it("throws when audio-mode payload is missing the audioUrl", () => {
    const n = node("n1", {
      engine: "avatar-iv",
      avatarId: "avatar-abc",
      speechMode: "audio",
    })
    expect(() => buildPayload(n, jobId, {}, usageLogId)).toThrow(/audioUrl is required/)
  })

  it("throws when voiceSpeed is out of the 0.5–1.5 range", () => {
    const n = node("n1", {
      engine: "avatar-iv",
      avatarId: "avatar-abc",
      speechMode: "text",
      script: "Hi.",
      voiceId: "voice-xyz",
      voiceSpeed: 3,
    })
    expect(() => buildPayload(n, jobId, {}, usageLogId)).toThrow(/voiceSpeed/)
  })
})
