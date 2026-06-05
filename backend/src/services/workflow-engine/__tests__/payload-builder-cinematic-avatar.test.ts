/**
 * Payload-builder tests for the `cinematic-avatar` node type.
 *
 * Verifies:
 * 1. buildPayload does NOT throw "Unknown node type: cinematic-avatar"
 * 2. Returns queueName:"video-generation", jobName:"cinematic-avatar"
 * 3. All node data fields (prompt, avatarLooks, duration, etc.) are included
 * 4. Resolved prompt from upstream inputs takes priority over node data
 * 5. modelIdentifier is always a member of CINEMATIC_RESERVE_IDS (no 503 trap)
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { CINEMATIC_RESERVE_IDS } from "@nodaro/shared"
import type { SimpleNode, ResolvedInputs } from "../types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A valid cinematic-avatar node carries a non-empty prompt (the payload
// validator requires it on ALL paths). Tests that exercise prompt resolution
// override `prompt` explicitly; the default keeps the other cases valid.
function node(id: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type: "cinematic-avatar", data: { prompt: "A cinematic test clip.", ...data } }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildPayload — cinematic-avatar", () => {
  const jobId = "job-1"
  const usageLogId = "usage-1"

  it("does not throw 'Unknown node type' and returns the correct queue + job name", () => {
    const n = node("n1", {
      prompt: "A cinematic aerial shot of a city at night.",
      avatarLooks: ["look-abc123"],
      duration: 10,
      resolution: "720p",
      aspectRatio: "16:9",
    })
    expect(() => buildPayload(n, jobId, {}, usageLogId)).not.toThrow()
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.queueName).toBe("video-generation")
    expect(result.jobName).toBe("cinematic-avatar")
  })

  it("includes all core fields from node data", () => {
    const n = node("n1", {
      prompt: "A majestic mountain sunrise.",
      avatarLooks: ["look-1", "look-2"],
      duration: 12,
      autoDuration: false,
      aspectRatio: "9:16",
      resolution: "1080p",
      enhancePrompt: true,
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.payload.prompt).toBe("A majestic mountain sunrise.")
    expect(result.payload.avatarLooks).toEqual(["look-1", "look-2"])
    expect(result.payload.duration).toBe(12)
    expect(result.payload.autoDuration).toBe(false)
    expect(result.payload.aspectRatio).toBe("9:16")
    expect(result.payload.resolution).toBe("1080p")
    expect(result.payload.enhancePrompt).toBe(true)
    expect(result.payload.usageLogId).toBe(usageLogId)
  })

  it("uses resolved prompt from inputs over node data", () => {
    const n = node("n1", {
      prompt: "Node data prompt — should be overridden.",
      avatarLooks: ["look-abc"],
      resolution: "720p",
    })
    const inputs: ResolvedInputs = { prompt: "Upstream wired prompt." }
    const result = buildPayload(n, jobId, inputs, usageLogId)
    expect(result.payload.prompt).toBe("Upstream wired prompt.")
  })

  it("defaults aspectRatio to '16:9' and resolution to '720p' when not provided", () => {
    const n = node("n1", {
      avatarLooks: ["look-abc"],
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.payload.aspectRatio).toBe("16:9")
    expect(result.payload.resolution).toBe("720p")
  })

  it("includes jobId in the payload", () => {
    const n = node("n1", {
      avatarLooks: ["look-abc"],
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.payload.jobId).toBe(jobId)
  })

  // ── modelIdentifier must be a SEEDED reserve id (no 503 price_not_configured) ──

  it("emits a SEEDED reserve credit id (member of CINEMATIC_RESERVE_IDS)", () => {
    // The orchestrator passes this modelIdentifier to reserveCredits →
    // getModelCreditBaseCost, which hard-fails (503) for any unseeded id.
    // Every id buildPayload can emit MUST be one of the 24 seeded exact-duration ids.
    const n = node("n1", {
      prompt: "A beautiful sunset.",
      avatarLooks: ["look-abc"],
      duration: 10,
      resolution: "720p",
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(CINEMATIC_RESERVE_IDS).toContain(result.modelIdentifier)
  })

  it("emits a seeded reserve id for every (resolution, duration) combination", () => {
    const resolutions = ["720p", "1080p"]
    for (const resolution of resolutions) {
      for (let d = 4; d <= 15; d++) {
        const n = node("n1", {
          avatarLooks: ["look-abc"],
          duration: d,
          resolution,
        })
        const result = buildPayload(n, jobId, {}, usageLogId)
        expect(
          CINEMATIC_RESERVE_IDS,
          `Expected CINEMATIC_RESERVE_IDS to contain "${result.modelIdentifier}" for ${resolution}:${d}s`,
        ).toContain(result.modelIdentifier)
        expect(result.modelIdentifier).toBe(`cinematic-avatar:${resolution}:${d}s`)
      }
    }
  })

  it("reserves the 15s ceiling id when autoDuration is true (refund-only invariant)", () => {
    // autoDuration drops `duration`; HeyGen picks the length. The reserve MUST be
    // the 15s ceiling so the metered true-up can only refund, never undercharge.
    const n = node("n1", {
      avatarLooks: ["look-abc"],
      duration: 4, // stale short value — must be ignored under autoDuration
      autoDuration: true,
      resolution: "720p",
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.modelIdentifier).toBe("cinematic-avatar:720p:15s")
    expect(CINEMATIC_RESERVE_IDS).toContain(result.modelIdentifier)
  })

  it("clamps an out-of-range duration to a seeded id (no 503 trap)", () => {
    // duration=2 should be clamped to 4s min
    const n1 = node("n1", { avatarLooks: ["look-abc"], duration: 2, resolution: "720p" })
    const r1 = buildPayload(n1, jobId, {}, usageLogId)
    expect(CINEMATIC_RESERVE_IDS).toContain(r1.modelIdentifier)

    // duration=99 should be clamped to 15s max
    const n2 = node("n2", { avatarLooks: ["look-abc"], duration: 99, resolution: "1080p" })
    const r2 = buildPayload(n2, jobId, {}, usageLogId)
    expect(CINEMATIC_RESERVE_IDS).toContain(r2.modelIdentifier)
  })

  // ── references assembly ───────────────────────────────────────────────────

  it("omits references from the payload when none are wired or configured", () => {
    const n = node("n1", { avatarLooks: ["look-abc"] })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.payload).not.toHaveProperty("references")
  })

  it("assembles references from resolved ref-handle inputs", () => {
    const n = node("n1", { avatarLooks: ["look-abc"] })
    const inputs: ResolvedInputs = {
      refVideoUrl: "https://r2.example.com/clip.mp4",
      refAudioUrl: "https://r2.example.com/voice.mp3",
      refImageUrl: "https://r2.example.com/ref.png",
    }
    const result = buildPayload(n, jobId, inputs, usageLogId)
    expect(result.payload.references).toEqual([
      { type: "video", url: "https://r2.example.com/clip.mp4" },
      { type: "audio", url: "https://r2.example.com/voice.mp3" },
      { type: "image", url: "https://r2.example.com/ref.png" },
    ])
  })

  it("includes data.references (single-node Run path) when no handles are wired", () => {
    const n = node("n1", {
      avatarLooks: ["look-abc"],
      references: [
        { type: "video", url: "https://r2.example.com/d-clip.mp4" },
        { type: "image", url: "https://r2.example.com/d-ref.png" },
      ],
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.payload.references).toEqual([
      { type: "video", url: "https://r2.example.com/d-clip.mp4" },
      { type: "image", url: "https://r2.example.com/d-ref.png" },
    ])
  })

  it("merges wired ref inputs with data.references and dedupes by url", () => {
    const n = node("n1", {
      avatarLooks: ["look-abc"],
      references: [
        // Same url as the wired refVideoUrl — must be dropped (no double-send).
        { type: "video", url: "https://r2.example.com/clip.mp4" },
        // Distinct image — must be appended after the wired inputs.
        { type: "image", url: "https://r2.example.com/extra.png" },
      ],
    })
    const inputs: ResolvedInputs = { refVideoUrl: "https://r2.example.com/clip.mp4" }
    const result = buildPayload(n, jobId, inputs, usageLogId)
    expect(result.payload.references).toEqual([
      { type: "video", url: "https://r2.example.com/clip.mp4" },
      { type: "image", url: "https://r2.example.com/extra.png" },
    ])
  })

  it("ignores malformed data.references entries", () => {
    const n = node("n1", {
      avatarLooks: ["look-abc"],
      references: [
        null,
        { type: "bogus", url: "https://r2.example.com/x.mp4" },
        { type: "video" }, // missing url
        { type: "image", url: "https://r2.example.com/ok.png" },
      ],
    })
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.payload.references).toEqual([
      { type: "image", url: "https://r2.example.com/ok.png" },
    ])
  })

  // ── Structural validation gate (workflow/app/MCP bypass the route Zod) ──────

  it("throws when prompt is empty/missing", () => {
    const n: SimpleNode = {
      id: "n1",
      type: "cinematic-avatar",
      data: { avatarLooks: ["look-abc"] }, // no prompt
    }
    expect(() => buildPayload(n, jobId, {}, usageLogId)).toThrow(/prompt is required/)
  })

  it("throws when avatarLooks is empty", () => {
    const n = node("n1", { avatarLooks: [] })
    expect(() => buildPayload(n, jobId, {}, usageLogId)).toThrow(/avatarLooks must contain/)
  })

  it("throws when avatarLooks has more than 3 entries", () => {
    const n = node("n1", { avatarLooks: ["a", "b", "c", "d"] })
    expect(() => buildPayload(n, jobId, {}, usageLogId)).toThrow(/avatarLooks must contain/)
  })

  it("throws when avatarLooks is missing entirely", () => {
    const n: SimpleNode = {
      id: "n1",
      type: "cinematic-avatar",
      data: { prompt: "A clip." }, // avatarLooks omitted
    }
    expect(() => buildPayload(n, jobId, {}, usageLogId)).toThrow(/avatarLooks/)
  })

  it("throws when more than 3 video references are assembled", () => {
    const n = node("n1", {
      avatarLooks: ["look-abc"],
      references: [
        { type: "video", url: "https://r2.example.com/v1.mp4" },
        { type: "video", url: "https://r2.example.com/v2.mp4" },
        { type: "video", url: "https://r2.example.com/v3.mp4" },
        { type: "video", url: "https://r2.example.com/v4.mp4" },
      ],
    })
    expect(() => buildPayload(n, jobId, {}, usageLogId)).toThrow(/at most 3 video references/)
  })

  it("throws when avatarLooks + image references exceed the 9-image budget", () => {
    // 3 looks + 7 image refs = 10 images > 9.
    const n = node("n1", {
      avatarLooks: ["l1", "l2", "l3"],
      references: Array.from({ length: 7 }, (_, i) => ({
        type: "image" as const,
        url: `https://r2.example.com/img${i}.png`,
      })),
    })
    expect(() => buildPayload(n, jobId, {}, usageLogId)).toThrow(/at most 9 images/)
  })

  it("allows exactly 3 looks + 6 image refs (9-image boundary)", () => {
    const n = node("n1", {
      avatarLooks: ["l1", "l2", "l3"],
      references: Array.from({ length: 6 }, (_, i) => ({
        type: "image" as const,
        url: `https://r2.example.com/img${i}.png`,
      })),
    })
    expect(() => buildPayload(n, jobId, {}, usageLogId)).not.toThrow()
  })
})
