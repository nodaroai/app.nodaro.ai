/**
 * buildPayload: avatar and subject nodes (AI avatar, cinematic avatar, the
 * character and face subjectMinor flag).
 *
 * Merged from 4 test files (CI test de-duplication, plan §5.7 B) so the
 * workflow-engine module graph loads once instead of 4 times. Each original
 * file is one top-level describe named after it, with its own helpers, setup
 * and teardown; test names and assertions are unchanged.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { AI_AVATAR_RESERVE_IDS, CINEMATIC_RESERVE_IDS } from "@nodaro/shared/credits"
import type { SimpleNode, ResolvedInputs } from "../types.js"

describe("payload-builder-ai-avatar.test.ts", () => {
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

    it("emits a seeded reserve id for audio mode (modest 120s fallback, NOT 900s)", () => {
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
      // The orchestrator path has no ffprobe, so audio mode reserves the MODEST
      // 120s fallback (not the old 900s top bucket that over-reserved thousands).
      // The metered commit is refund-only, so this never over-charges.
      expect(result.modelIdentifier).toBe("heygen-avatar-v:1080p:120s")
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
})

describe("payload-builder-cinematic-avatar.test.ts", () => {
  /**
   * Payload-builder tests for the `cinematic-avatar` node type.
   *
   * Verifies:
   * 1. buildPayload does NOT throw "Unknown node type: cinematic-avatar"
   * 2. Returns queueName:"video-generation", jobName:"cinematic-avatar"
   * 3. All node data fields (prompt, avatarLooks, duration, etc.) are included
   * 4. Typed node prompt takes priority over a wired input (typed-primary);
   *    the wired input is used only as a fallback when the typed prompt is empty
   * 5. modelIdentifier is always a member of CINEMATIC_RESERVE_IDS (no 503 trap)
   */
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

    it("prefers the typed node prompt over a wired input (typed-primary)", () => {
      const n = node("n1", {
        prompt: "Node data prompt — wins under typed-primary.",
        avatarLooks: ["look-abc"],
        resolution: "720p",
      })
      const inputs: ResolvedInputs = { prompt: "Upstream wired prompt." }
      const result = buildPayload(n, jobId, inputs, usageLogId)
      expect(result.payload.prompt).toBe("Node data prompt — wins under typed-primary.")
    })

    it("falls back to the wired input when the typed prompt is empty", () => {
      const n = node("n1", {
        prompt: "",
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
})

describe("payload-builder-character-subject-minor.test.ts", () => {
  /**
   * W1-a minor-age floor — the DAG lane.
   *
   * `case "character"` is the orchestrator's equivalent of POST
   * /v1/generate-character: it assembles the entity prompt itself and enqueues
   * straight to the entity worker. It must therefore make the SAME age decision
   * the route makes — once, from the node's `person` picker value — and ride it
   * to the worker as `subjectMinor`, where the minor-age-floor policy fires.
   *
   * Note the DAG prompt is built by `buildCharacterPrompt`, not
   * `buildPortraitPrompt`, so no scaffolding function runs on this lane: the
   * policy at the entity handler is this lane's only Layer-2 point, and
   * `subjectMinor` is what arms it.
   */
  function characterNode(data: Record<string, unknown>): SimpleNode {
    return { id: "char-1", type: "character", data: { name: "Kira", provider: "nano-banana", ...data } }
  }

  function build(data: Record<string, unknown>) {
    const n = characterNode(data)
    return buildPayload(n, "job-1", {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
  }

  describe("payload-builder case \"character\" — subjectMinor (W1-a)", () => {
    it("adult byte-identity pin: the payload prompt is the pre-change string", () => {
      const result = build({ description: "young woman, auburn hair", person: { age: "age-30s" } })
      expect(result.jobName).toBe("generate-character")
      expect(result.payload.prompt).toBe(
        "Kira, young woman, auburn hair, realistic style, front view, looking at camera, full body portrait, 4k, highly detailed, clean background.",
      )
    })

    it("adult person value -> subjectMinor false", () => {
      expect(build({ description: "young woman", person: { age: "age-30s" } }).payload.subjectMinor).toBe(false)
    })

    it("minor person value -> subjectMinor true", () => {
      expect(build({ description: "a child", person: { age: "age-child" } }).payload.subjectMinor).toBe(true)
    })

    it("a custom age under 20 is a minor; 20+ is not", () => {
      expect(build({ description: "a kid", person: { age: "age-custom", customAge: 12 } }).payload.subjectMinor).toBe(true)
      expect(build({ description: "an adult", person: { age: "age-custom", customAge: 34 } }).payload.subjectMinor).toBe(false)
    })

    it("a minor-implying type with no age is a minor", () => {
      expect(build({ description: "a storybook girl", person: { type: "alice-wonderland" } }).payload.subjectMinor).toBe(true)
    })

    it("no person value at all -> subjectMinor false (mainline nodes are untouched)", () => {
      expect(build({ description: "young woman" }).payload.subjectMinor).toBe(false)
    })

    // The DAG lane's own incident shape: a node written straight into workflow
    // JSON (agent / import / template) carries prompt text but no picker value.
    it("no person value, but the assembled text describes a minor -> subjectMinor true", () => {
      expect(build({ description: "a young child around 5 years old, red raincoat" }).payload.subjectMinor).toBe(true)
      expect(build({ description: "a 7 year old on a swing" }).payload.subjectMinor).toBe(true)
    })

    it("no person value and adult text -> subjectMinor false, prompt byte-identical", () => {
      const adult = build({ description: "a woman in her 30s holding her child" })
      expect(adult.payload.subjectMinor).toBe(false)
      expect(adult.payload.prompt).toBe(
        "Kira, a woman in her 30s holding her child, realistic style, front view, looking at camera, full body portrait, 4k, highly detailed, clean background.",
      )
    })

    it("the nameless path reads the node's own prompt field", () => {
      const n: SimpleNode = {
        id: "char-2",
        type: "character",
        data: { provider: "nano-banana", prompt: "a pre-teen around 11 years old in a school corridor" },
      }
      const result = buildPayload(n, "job-2", {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
      expect(result.payload.subjectMinor).toBe(true)
    })
  })
})

describe("payload-builder-face-subject-minor.test.ts", () => {
  /**
   * W1-a minor-age floor — the generate-face DAG lane.
   *
   * `case "face"` is the orchestrator's equivalent of POST /v1/generate-face, and
   * both feed `makeEntityImageHandler("generate-face")` — the same entity-image
   * chokepoint the character lanes use. The whole-branch review found this lane
   * had NO age signal at all: a face node carrying the incident wording enqueued
   * with `subjectMinor` absent, so the policy at the handler was the identity and
   * the flagged text reached the provider.
   *
   * A face node carries no `person` picker value (FaceNodeData has no such
   * field), so the text signal is the whole signal here.
   */
  function faceNode(data: Record<string, unknown>): SimpleNode {
    return { id: "face-1", type: "face", data: { provider: "nano-banana", ...data } }
  }

  function build(data: Record<string, unknown>) {
    const n = faceNode(data)
    return buildPayload(n, "job-1", {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
  }

  describe('payload-builder case "face" — subjectMinor (W1-a)', () => {
    it("adult byte-identity pin: the payload prompt is the pre-change string", () => {
      const result = build({ name: "Ana", description: "a woman in her 30s, auburn hair", style: "realistic" })
      expect(result.jobName).toBe("generate-face")
      expect(result.payload.prompt).toBe(
        "Create a professional close-up face portrait headshot: Ana, a woman in her 30s, auburn hair. " +
          "Style: realistic. Looking directly at camera, sharp focus on facial features, clean background, " +
          "studio lighting, high resolution. Maintain exact facial identity and features from the reference image.",
      )
      expect(result.payload.subjectMinor).toBe(false)
    })

    it("a minor described in the node's description -> subjectMinor true", () => {
      expect(build({ name: "Ana", description: "a young child around 5 years old" }).payload.subjectMinor).toBe(true)
      expect(build({ name: "Ana", description: "a 7 year old on a swing" }).payload.subjectMinor).toBe(true)
    })

    // The colloquial shapes Commit A added — the lane must inherit them for free.
    it("reads the colloquial age spellings too", () => {
      expect(build({ name: "Ana", description: "aged 12, school portrait" }).payload.subjectMinor).toBe(true)
      expect(build({ name: "Ana", description: "12yo, school portrait" }).payload.subjectMinor).toBe(true)
      expect(build({ name: "Ana", description: "aged 45, studio portrait" }).payload.subjectMinor).toBe(false)
    })

    it("the nameless path reads the node's own description / prompt field", () => {
      expect(build({ description: "a pre-teen around 11 years old in a school corridor" }).payload.subjectMinor).toBe(true)
      expect(build({ prompt: "a 9 year old in a school corridor" }).payload.subjectMinor).toBe(true)
      expect(build({ prompt: "a woman in her 30s in a school corridor" }).payload.subjectMinor).toBe(false)
    })

    it("no age evidence at all -> subjectMinor false (mainline nodes are untouched)", () => {
      expect(build({ name: "Ana", description: "auburn hair, green eyes" }).payload.subjectMinor).toBe(false)
    })
  })
})
