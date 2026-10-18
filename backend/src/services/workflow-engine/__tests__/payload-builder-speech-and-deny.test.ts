/**
 * buildPayload: speech nodes and the run-time deny backstops
 * (text-to-dialogue, text-to-speech, dubbing, the speech cap, voice-gender,
 * model and node availability deny).
 *
 * Merged from 7 test files (CI test de-duplication, plan §5.7 B) so the
 * workflow-engine module graph loads once instead of 7 times. Each original
 * file is one top-level describe named after it, with its own helpers, setup
 * and teardown; test names and assertions are unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest"
import { buildPayload, effectiveDispatchProvider } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"
import { config } from "../../../lib/config.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import { DEFAULT_TTS_PROVIDER, getMaxTtsChars } from "@nodaro/shared/models"
import { ADMIN_VIEWER, USER_VIEWER, type AvailabilityViewer } from "../../../lib/surface-deny.js"
import { __resetAvailabilityOverridesForTests, __availabilityUniverseReadyForTests, GATEABLE_NODE_TYPES } from "../../../lib/availability-override.js"

describe("payload-builder-text-to-dialogue.test.ts", () => {
  /**
   * Payload-parity tests for the `text-to-dialogue` case of buildPayload.
   *
   * The dialogue node runs on TWO engines — the frontend DAG (execute-node.ts →
   * textToDialogueApi) and this orchestrator case. Both must forward the same
   * fields, or a workflow run silently drops what the Run button honours (the
   * exact drift class the TTS parity test exists for). Pins: line filtering,
   * stability/languageCode/seed/applyTextNormalization pass-through, and the
   * per-line B4c premade-gender backstop.
   */
  function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
    return { id, type, data }
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    __resetSurfaceProfileCacheForTests()
  })

  describe("buildPayload — text-to-dialogue", () => {
    it("forwards dialogue lines + stability/languageCode/seed/applyTextNormalization", () => {
      const n = node("d1", "text-to-dialogue", {
        dialogue: [
          { id: "1", text: "Hi", voice: "Rachel" },
          { id: "2", text: "Hello", voice: "W3C2vBPukr5b5jvoXhPK" },
        ],
        stability: 0.5,
        languageCode: "en",
        seed: 42,
        applyTextNormalization: "on",
      })
      const result = buildPayload(n, "job1", {}, "usage1")
      expect(result.jobName).toBe("text-to-dialogue")
      expect(result.modelIdentifier).toBe("elevenlabs-dialogue")
      expect(result.payload.dialogue).toEqual([
        { id: "1", text: "Hi", voice: "Rachel" },
        { id: "2", text: "Hello", voice: "W3C2vBPukr5b5jvoXhPK" },
      ])
      expect(result.payload.stability).toBe(0.5)
      expect(result.payload.languageCode).toBe("en")
      expect(result.payload.seed).toBe(42)
      expect(result.payload.applyTextNormalization).toBe("on")
    })

    it("dispatches and reserves under the node's dialogue model, forwarding similarity", () => {
      const n = node("d1", "text-to-dialogue", { dialogue: [{ id: "1", text: "Hi", voice: "Rachel" }], provider: "elevenlabs-dialogue", similarityBoost: 0.6 })
      const result = buildPayload(n, "job1", {}, "usage1")
      expect(result.modelIdentifier).toBe("elevenlabs-dialogue")
      expect(result.payload.provider).toBe("elevenlabs-dialogue")
      expect(result.payload.similarityBoost).toBe(0.6)
    })

    it.each([undefined, "nope", "elevenlabs-v4", "constructor", ["elevenlabs-dialogue"]])("a node whose provider is %j runs and is billed as v3 dialogue", (provider) => {
      const n = node("d1", "text-to-dialogue", { dialogue: [{ id: "1", text: "Hi", voice: "Rachel" }], provider })
      const result = buildPayload(n, "job1", {}, "usage1")
      expect(result.modelIdentifier).toBe("elevenlabs-dialogue")
      expect(result.payload.provider).toBe("elevenlabs-dialogue")
    })

    it("fails honestly before dispatch when the lines exceed the model's total cap (the route's Zod cannot see this path)", () => {
      const n = node("d1", "text-to-dialogue", {
        dialogue: [{ id: "1", text: "a".repeat(3000), voice: "Rachel" }, { id: "2", text: "b".repeat(2001), voice: "Sarah" }],
      })
      expect(() => buildPayload(n, "job1", {}, "usage1")).toThrow(/5001 characters of dialogue; this model takes at most 5000/)
    })

    it("exactly at the cap still dispatches", () => {
      const n = node("d1", "text-to-dialogue", { dialogue: [{ id: "1", text: "a".repeat(5000), voice: "Rachel" }] })
      expect(() => buildPayload(n, "job1", {}, "usage1")).not.toThrow()
    })

    it("v4's cap is its own (10,000): exactly at it dispatches, one over fails with v4's numbers", () => {
      const at = node("d1", "text-to-dialogue", { provider: "elevenlabs-dialogue-v4", dialogue: [{ id: "1", text: "a".repeat(10000), voice: "Rachel" }] })
      expect(() => buildPayload(at, "job1", {}, "usage1")).not.toThrow()
      const over = node("d1", "text-to-dialogue", {
        provider: "elevenlabs-dialogue-v4",
        dialogue: [{ id: "1", text: "a".repeat(6000), voice: "Rachel" }, { id: "2", text: "b".repeat(4001), voice: "Sarah" }],
      })
      expect(() => buildPayload(over, "job1", {}, "usage1")).toThrow(/10001 characters of dialogue; this model takes at most 10000/)
    })

    it("filters empty lines (matches the frontend engine)", () => {
      const n = node("d1", "text-to-dialogue", {
        dialogue: [
          { id: "1", text: "Hi", voice: "Rachel" },
          { id: "2", text: "   ", voice: "Sarah" },
        ],
      })
      const result = buildPayload(n, "job1", {}, "usage1")
      expect(result.payload.dialogue).toEqual([{ id: "1", text: "Hi", voice: "Rachel" }])
    })

    it("throws honestly when no non-empty lines remain (never a raw provider 422 mid-run)", () => {
      const empty = node("d1", "text-to-dialogue", { dialogue: [] })
      expect(() => buildPayload(empty, "job1", {}, "usage1")).toThrow(/no dialogue lines/)
      const allBlank = node("d2", "text-to-dialogue", { dialogue: [{ id: "1", text: "  ", voice: "Rachel" }] })
      expect(() => buildPayload(allBlank, "job2", {}, "usage2")).toThrow(/no dialogue lines/)
      const missing = node("d3", "text-to-dialogue", {})
      expect(() => buildPayload(missing, "job3", {}, "usage3")).toThrow(/no dialogue lines/)
    })

    it("B4c: rejects a line whose PREMADE voice gender the deployment disallows", () => {
      // Open the surface gate (config snapshots process.env once at import, so
      // mutate the live field) + lock to female-only, then reset the memo —
      // the exact precedent from audio-ai.test.ts's B4c case. Mirrors the
      // text-to-speech case's thrown shape.
      const prevEdition = config.EDITION
      config.EDITION = "business"
      process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["female"] } })
      __resetSurfaceProfileCacheForTests()
      try {
        const n = node("d1", "text-to-dialogue", {
          dialogue: [
            { id: "1", text: "Hi", voice: "Rachel" },
            { id: "2", text: "Hello", voice: "Daniel" },
          ],
        })
        expect(() => buildPayload(n, "job1", {}, "usage1")).toThrowError(
          expect.objectContaining({ code: "voice_not_available" }),
        )
        // Library/custom UUIDs resolve to no gender and must pass.
        const uuidNode = node("d2", "text-to-dialogue", {
          dialogue: [{ id: "1", text: "Hi", voice: "W3C2vBPukr5b5jvoXhPK" }],
        })
        expect(() => buildPayload(uuidNode, "job2", {}, "usage2")).not.toThrow()
      } finally {
        config.EDITION = prevEdition
        delete process.env.NODARO_SURFACE_PROFILE
        __resetSurfaceProfileCacheForTests()
      }
    })
  })
})

describe("payload-builder-text-to-speech.test.ts", () => {
  /**
   * Payload-builder tests for the `text-to-speech` auto-wire consumer seam.
   *
   * The Character Studio Voice page auto-wires an upstream Character node's voice
   * into a connected text-to-speech node (input-resolver emits
   * resolvedInputs.voice/.provider/.voiceType). The runtime effect lives in the
   * `text-to-speech` case of buildPayload, which reads
   * `resolvedInputs.voice || data.voiceId`, `resolvedInputs.provider || data.provider`,
   * and `resolvedInputs.voiceType || data.voiceType`. These tests pin that
   * consumer contract so a future payload-builder refactor can't silently break
   * the auto-wire feature.
   */
  function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
    return { id, type, data }
  }

  describe("buildPayload — text-to-speech voice auto-wire", () => {
    it("text-to-speech consumes auto-wired resolvedInputs.voice/.provider/.voiceType over node data", () => {
      const n = node("t1", "text-to-speech", { voiceId: "node-default", provider: "elevenlabs-v3", voiceType: "premade", textSource: "direct", directText: "hi" })
      const result = buildPayload(n, "job1", { voice: "vid_123", provider: "elevenlabs-turbo", voiceType: "library" }, "usage1")
      expect(result.payload.voice).toBe("vid_123")
      expect(result.payload.provider).toBe("elevenlabs-turbo")
      expect(result.payload.voiceType).toBe("library")
    })

    it("text-to-speech falls back to node data when no voice is auto-wired", () => {
      const n = node("t1", "text-to-speech", { voiceId: "node-default", provider: "elevenlabs-v3", textSource: "direct", directText: "hi" })
      const result = buildPayload(n, "job1", {}, "usage1")
      expect(result.payload.voice).toBe("node-default")
      expect(result.payload.provider).toBe("elevenlabs-v3")
    })

    it("dispatches the character-auto-wired provider via effectiveDispatchProvider (single source with the deny check)", () => {
      // No data.provider — the character node auto-wires resolvedInputs.provider.
      const n = node("n1", "text-to-speech", { voiceId: "Rachel", textSource: "direct", directText: "hi" })
      const resolvedInputs = { provider: "elevenlabs-v3", voice: "Rachel" }
      const built = buildPayload(n, "job-1", resolvedInputs)
      // The provider actually dispatched (modelIdentifier + payload.provider) must be
      // exactly what the surface deny check reads via effectiveDispatchProvider.
      expect(built.modelIdentifier).toBe(effectiveDispatchProvider("text-to-speech", n.data, resolvedInputs))
      expect(built.payload.provider).toBe("elevenlabs-v3")
    })
  })

  describe("buildPayload — text-to-speech with no model anywhere", () => {
    it("dispatches AND bills the default speech model (ElevenLabs v4) for a node that stores no provider", () => {
      const n = node("t1", "text-to-speech", { voiceId: "Rachel", textSource: "direct", directText: "hi" })
      const built = buildPayload(n, "job1", {}, "usage1")
      expect(DEFAULT_TTS_PROVIDER).toBe("elevenlabs-v4")
      expect(built.payload.provider).toBe(DEFAULT_TTS_PROVIDER)
      expect(built.modelIdentifier).toBe(DEFAULT_TTS_PROVIDER)
    })

    it("treats an empty-string provider as none (the `||` precedence)", () => {
      const n = node("t1", "text-to-speech", { voiceId: "Rachel", provider: "", textSource: "direct", directText: "hi" })
      const built = buildPayload(n, "job1", {}, "usage1")
      expect(built.payload.provider).toBe(DEFAULT_TTS_PROVIDER)
      expect(built.modelIdentifier).toBe(DEFAULT_TTS_PROVIDER)
    })

    it("leaves a node that stores v3 on v3 — the flip changes only nodes with no provider", () => {
      const n = node("t1", "text-to-speech", { voiceId: "Rachel", provider: "elevenlabs-v3", textSource: "direct", directText: "hi" })
      const built = buildPayload(n, "job1", {}, "usage1")
      expect(built.payload.provider).toBe("elevenlabs-v3")
      expect(built.modelIdentifier).toBe("elevenlabs-v3")
    })

    // The same length rule as the REST route's omitted-provider default (one function):
    // the default model up to its own cap, turbo above it — so the model billed is the
    // model run, and a long text is never sent to a model that cannot take it.
    it("runs AND bills turbo for a node with no provider whose text is over the default model's cap", () => {
      expect(getMaxTtsChars(DEFAULT_TTS_PROVIDER)).toBe(10000)
      const n = node("t1", "text-to-speech", { voiceId: "Rachel", textSource: "direct", directText: "a".repeat(12000) })
      const built = buildPayload(n, "job1", {}, "usage1")
      expect(built.payload.provider).toBe("elevenlabs-turbo")
      expect(built.modelIdentifier).toBe("elevenlabs-turbo")
      expect(built.payload.text).toHaveLength(12000)
    })

    it("keeps the default model for a node with no provider at and under its cap", () => {
      for (const len of [9000, 10000]) {
        const n = node("t1", "text-to-speech", { voiceId: "Rachel", textSource: "direct", directText: "a".repeat(len) })
        const built = buildPayload(n, "job1", {}, "usage1")
        expect(built.payload.provider, `${len}`).toBe(DEFAULT_TTS_PROVIDER)
        expect(built.modelIdentifier, `${len}`).toBe(DEFAULT_TTS_PROVIDER)
      }
    })

    it("measures the text the node actually sends (pre/post text included)", () => {
      const n = node("t1", "text-to-speech", {
        voiceId: "Rachel", textSource: "direct", directText: "a".repeat(9990), promptPrefix: "b".repeat(20),
      })
      const built = buildPayload(n, "job1", {}, "usage1")
      expect((built.payload.text as string).length).toBeGreaterThan(10000)
      expect(built.payload.provider).toBe("elevenlabs-turbo")
      expect(built.modelIdentifier).toBe("elevenlabs-turbo")
    })

    it("never applies the length rule to a stored model, v3 or v4", () => {
      for (const provider of ["elevenlabs-v3", "elevenlabs-v4"]) {
        // Within the stored model's own cap: it runs as stored.
        const within = node("t1", "text-to-speech", { voiceId: "Rachel", provider, textSource: "direct", directText: "a".repeat(getMaxTtsChars(provider)) })
        const built = buildPayload(within, "job1", {}, "usage1")
        expect(built.payload.provider, provider).toBe(provider)
        expect(built.modelIdentifier, provider).toBe(provider)
        // Over the default model's cap (where an OMITTED model would route to turbo): the
        // stored model is kept and judged by ITS cap — refused honestly before any reservation
        // (decided 2026-10-06), never silently rerouted to turbo. The refusal names it.
        const over = node("t1", "text-to-speech", { voiceId: "Rachel", provider, textSource: "direct", directText: "a".repeat(12000) })
        expect(() => buildPayload(over, "job1", {}, "usage1"), provider).toThrow(`${provider} takes at most ${getMaxTtsChars(provider)} per request`)
      }
    })
  })

  describe("buildPayload — text-to-speech neighbour text", () => {
    it("copies previousText / nextText from node data onto the job payload, verbatim (the exit normalises)", () => {
      const n = node("t1", "text-to-speech", { voiceId: "Rachel", provider: "elevenlabs-v4", textSource: "direct", directText: "Middle.", previousText: "  Before. ", nextText: "After." })
      const built = buildPayload(n, "job1", {}, "usage1")
      expect(built.payload.previousText).toBe("  Before. ")
      expect(built.payload.nextText).toBe("After.")
    })

    it("a node without them puts no neighbour key on the payload", () => {
      const n = node("t1", "text-to-speech", { voiceId: "Rachel", provider: "elevenlabs-v4", textSource: "direct", directText: "hi" })
      const built = buildPayload(n, "job1", {}, "usage1")
      expect(built.payload.previousText).toBeUndefined()
      expect(built.payload.nextText).toBeUndefined()
    })

    it("a value a field mapping wrote (any type) travels as it is — the funnel drops garbage", () => {
      const n = node("t1", "text-to-speech", { voiceId: "Rachel", provider: "elevenlabs-v4", textSource: "direct", directText: "hi", previousText: ["not", "a", "string"] })
      expect(buildPayload(n, "job1", {}, "usage1").payload.previousText).toEqual(["not", "a", "string"])
    })
  })
})

describe("payload-builder-dubbing.test.ts", () => {
  /**
   * Dubbing payload parity — the orchestrator engine must forward the same
   * source-precedence and full-surface fields the frontend engine sends
   * (sourceUrl wins, then video, then audio; exactly one reaches the worker).
   */
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

  it("uses the project model for Hebrew billing as well as generation", () => {
    const result = buildPayload(node({ targetLanguage: "he" }), "job1", { videoUrl: "https://x/c.mp4" }, "usage1")
    expect(result.modelIdentifier).toBe("elevenlabs-dubbing-v2")
  })
})

describe("payload-builder-speech-cap.test.ts", () => {
  /**
   * The workflow lane refuses speech text over the model's per-request cap
   * BEFORE anything is reserved (decided 2026-10-06, Q-OVERCAP) — with the MCP
   * tool's wording and the numbers — instead of sending it unclamped. A throw
   * inside buildPayload leaves no jobs row (node-executor deletes the placeholder).
   */
  function node(type: string, data: Record<string, unknown>): SimpleNode {
    return { id: "n1", type, data }
  }

  describe("text-to-speech over the cap on the workflow lane", () => {
    it("a named model over its cap is refused with the numbers, before dispatch", () => {
      const text = "a".repeat(5001)
      expect(() => buildPayload(node("text-to-speech", { provider: "elevenlabs-v3", textSource: "direct", directText: text }), "job1", {}))
        .toThrow("text is 5001 characters; elevenlabs-v3 takes at most 5000 per request. Split the script into several calls, or pick a model with a larger cap.")
    })

    it("the refusal carries a stable code", () => {
      try {
        buildPayload(node("text-to-speech", { provider: "elevenlabs-v4", textSource: "direct", directText: "a".repeat(10001) }), "job1", {})
        expect.unreachable()
      } catch (err) {
        expect((err as Error & { errorCode?: string }).errorCode).toBe("text_too_long")
      }
    })

    it("exactly the cap runs", () => {
      const built = buildPayload(node("text-to-speech", { provider: "elevenlabs-v3", textSource: "direct", directText: "a".repeat(5000) }), "job1", {})
      expect(built.payload.text).toHaveLength(getMaxTtsChars("elevenlabs-v3"))
    })

    it("the alias runs as turbo and is judged by turbo's cap", () => {
      const built = buildPayload(node("text-to-speech", { provider: "elevenlabs", textSource: "direct", directText: "a".repeat(12000) }), "job1", {})
      expect(built.payload.provider).toBe("elevenlabs")
      expect(() => buildPayload(node("text-to-speech", { provider: "elevenlabs", textSource: "direct", directText: "a".repeat(40001) }), "job1", {}))
        .toThrow("elevenlabs-turbo takes at most 40000")
    })

    it("an omitted model follows the length rule (turbo above the default's cap) and is not refused", () => {
      const built = buildPayload(node("text-to-speech", { textSource: "direct", directText: "a".repeat(12000) }), "job1", {})
      expect(built.payload.provider).toBe("elevenlabs-turbo")
      expect(getMaxTtsChars(DEFAULT_TTS_PROVIDER)).toBe(10000)
    })

    it("an unknown model id (written straight into workflow JSON) runs as the fallback model and is judged by ITS cap", () => {
      expect(() => buildPayload(node("text-to-speech", { provider: "not-a-model", textSource: "direct", directText: "a".repeat(12000) }), "job1", {})).not.toThrow()
    })
  })

  describe("text-to-dialogue over the total cap on the workflow lane", () => {
    it("is refused with the numbers (the model's capability-sheet cap) and a stable code", () => {
      const dialogue = [{ text: "a".repeat(3000), voice: "Rachel" }, { text: "b".repeat(2001), voice: "George" }]
      expect(() => buildPayload(node("text-to-dialogue", { dialogue }), "job1", {}))
        .toThrow("Text to Dialogue has 5001 characters of dialogue; this model takes at most 5000 characters in total")
      try {
        buildPayload(node("text-to-dialogue", { dialogue }), "job1", {})
        expect.unreachable()
      } catch (err) {
        expect((err as Error & { errorCode?: string }).errorCode).toBe("text_too_long")
      }
    })

    it("exactly the cap runs; empty lines are dropped before counting (as today)", () => {
      const dialogue = [{ text: "a".repeat(5000), voice: "Rachel" }, { text: "   ", voice: "George" }]
      const built = buildPayload(node("text-to-dialogue", { dialogue }), "job1", {})
      expect(built.payload.dialogue).toHaveLength(1)
    })

    it("Dialogue v4 is judged by ITS cap (10,000): a script v3 refuses runs on v4, and v4 refuses with its own numbers", () => {
      const overV3 = [{ text: "a".repeat(3000), voice: "Rachel" }, { text: "b".repeat(2001), voice: "George" }]
      expect(() => buildPayload(node("text-to-dialogue", { provider: "elevenlabs-dialogue-v4", dialogue: overV3 }), "job1", {})).not.toThrow()
      const overV4 = [{ text: "a".repeat(6000), voice: "Rachel" }, { text: "b".repeat(4001), voice: "George" }]
      expect(() => buildPayload(node("text-to-dialogue", { provider: "elevenlabs-dialogue-v4", dialogue: overV4 }), "job1", {}))
        .toThrow("Text to Dialogue has 10001 characters of dialogue; this model takes at most 10000 characters in total")
    })
  })
})

describe("payload-builder-voice-gender-deny.test.ts", () => {
  /**
   * B4c — voice-gender dispatch backstop in buildPayload (text-to-speech case).
   *
   * `voice.allowedGenders` was enforced ONLY at the direct /v1/text-to-speech
   * route; the orchestrator/worker TTS path had NO backstop, so an auto-wired
   * Character voice (input-resolver) or an imported/MCP-authored premade voice of
   * a DISALLOWED gender reached the provider under a gender lock — the B1
   * model-deny bypass class. buildPayload now vets the EFFECTIVE (auto-wired ??
   * data ?? default) voice's premade gender and throws `voice_not_available`,
   * mirroring the model-deny thrown shape. Inert by default (empty
   * allowedGenders allows every gender).
   */
  afterEach(() => {
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
  })

  const ttsNode = (data: Record<string, unknown> = {}): SimpleNode => ({
    id: "tts-1",
    type: "text-to-speech",
    data: { textSource: "direct", directText: "hello", ...data },
  })
  const giNode = (provider: string): SimpleNode => ({
    id: "gi-1",
    type: "generate-image",
    data: { provider, prompt: "a red bird on a branch" },
  })
  const ctx = (n: SimpleNode) => ({ nodes: [n], edges: [], nodeStates: {} })

  const maleOnly = () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["male"] } })
    __resetSurfaceProfileCacheForTests()
  }

  describe("buildPayload — voice-gender dispatch backstop (B4c)", () => {
    it("throws voice_not_available when an AUTO-WIRED (resolvedInputs) voice is a disallowed gender", () => {
      // The confirmed bypass: input-resolver auto-injects an upstream Character
      // node's voice into resolvedInputs.voice, and the TTS case dispatches
      // `resolvedInputs.voice || data.voiceId || data.voice`. With data unset, a
      // disallowed-gender premade voice (Rachel = female) reaches the provider
      // under a male-only lock unless the backstop catches the EFFECTIVE voice.
      maleOnly()
      const n = ttsNode()
      const resolved = { voice: "Rachel", voiceType: "premade" as const }
      expect(() => buildPayload(n, "job-vgd-1", resolved, undefined, ctx(n))).toThrow(
        /not available on this deployment/,
      )
      try {
        buildPayload(n, "job-vgd-1", resolved, undefined, ctx(n))
        expect.unreachable("buildPayload should have thrown for the disallowed-gender voice")
      } catch (e) {
        expect((e as { code?: string }).code).toBe("voice_not_available")
      }
    })

    it("throws voice_not_available for a disallowed-gender voice carried on node DATA (import/MCP)", () => {
      maleOnly()
      const n = ttsNode({ voiceId: "Rachel", voiceType: "premade" })
      expect(() => buildPayload(n, "job-vgd-2", {}, undefined, ctx(n))).toThrow(
        /not available on this deployment/,
      )
    })

    it("builds normally when the effective voice is an ALLOWED gender", () => {
      maleOnly()
      const n = ttsNode()
      const resolved = { voice: "Adam", voiceType: "premade" as const }
      const result = buildPayload(n, "job-vgd-3", resolved, undefined, ctx(n))
      expect(result.jobName).toBe("text-to-speech")
      expect(result.payload.voice).toBe("Adam")
    })

    it("does NOT reject a custom/library voice (unknown premade gender) under the lock", () => {
      maleOnly()
      const n = ttsNode()
      const resolved = { voice: "someClonedId", voiceType: "custom" as const }
      const result = buildPayload(n, "job-vgd-4", resolved, undefined, ctx(n))
      expect(result.payload.voice).toBe("someClonedId")
    })

    it("is inert by default — empty allowedGenders never rejects a female voice", () => {
      // No NODARO_SURFACE_PROFILE → allowedGenders is [] → every gender allowed.
      const n = ttsNode()
      const resolved = { voice: "Rachel", voiceType: "premade" as const }
      const result = buildPayload(n, "job-vgd-5", resolved, undefined, ctx(n))
      expect(result.payload.voice).toBe("Rachel")
    })

    it("does NOT affect a NON-TTS node under the same male-only lock", () => {
      maleOnly()
      const n = giNode("nano-banana")
      const result = buildPayload(n, "job-vgd-6", {}, undefined, ctx(n))
      expect(result.jobName).toBe("generate-image")
      expect(result.payload.prompt).toBe("a red bird on a branch")
    })
  })
})

describe("payload-builder-model-deny.test.ts", () => {
  /**
   * S3 — deployment-surface MODEL deny run-time backstop in buildPayload.
   *
   * Node deny already throws at the top of buildPayload; model deny used to be
   * DISCOVERY-only, so a denied model still ran + billed when its `provider`
   * reached the orchestrator via an imported/templated workflow row or a
   * FieldMapping-injected value (neither passes a write guard). buildPayload now
   * throws for a denied `data.provider` too, mirroring the node-deny shape.
   */
  afterEach(() => {
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
  })

  const giNode = (provider: string): SimpleNode => ({
    id: "gi-1",
    type: "generate-image",
    data: { provider, prompt: "a red bird on a branch" },
  })
  const ttsNode = (data: Record<string, unknown>): SimpleNode => ({
    id: "tts-1",
    type: "text-to-speech",
    data,
  })
  const ctx = (n: SimpleNode) => ({ nodes: [n], edges: [], nodeStates: {} })

  describe("buildPayload — surface MODEL deny run-time backstop (S3)", () => {
    it("throws model_not_available for a node whose data.provider is a denied model", () => {
      process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["nano-banana"] } })
      __resetSurfaceProfileCacheForTests()
      const n = giNode("nano-banana")
      expect(() => buildPayload(n, "job-model-deny-1", {}, undefined, ctx(n))).toThrow(
        /not available on this deployment/,
      )
      try {
        buildPayload(n, "job-model-deny-1", {}, undefined, ctx(n))
        expect.unreachable("buildPayload should have thrown for a denied model")
      } catch (e) {
        expect((e as { code?: string }).code).toBe("model_not_available")
        expect((e as Error).message).toMatch(/nano-banana/)
      }
    })

    it("does NOT raise model_not_available when the model is not denied (default profile)", () => {
      // Default profile denies nothing — the top-of-buildPayload backstop must be
      // inert. (Any other build error is fine; only model_not_available is barred.)
      const n = giNode("nano-banana")
      try {
        buildPayload(n, "job-model-deny-2", {}, undefined, ctx(n))
      } catch (e) {
        expect((e as { code?: string }).code).not.toBe("model_not_available")
      }
    })
  })

  describe("buildPayload — MODEL deny checks the EFFECTIVE dispatched provider (B1, 2nd cycle)", () => {
    it("throws model_not_available for a text-to-speech node whose auto-wired resolvedInputs.provider is denied while data.provider is UNSET", () => {
      // The confirmed bypass: input-resolver auto-injects a wired Character/creature
      // node's recommended TTS provider into resolvedInputs.provider (alongside
      // voice/voiceType) when the TTS node has no explicit voice, and the TTS case
      // dispatches + bills `resolvedInputs.provider || data.provider || "elevenlabs-v3"`.
      // With data.provider UNSET, the old backstop (which read only data.provider)
      // let the denied model run + bill. It must throw on the effective provider.
      process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["elevenlabs-v3"] } })
      __resetSurfaceProfileCacheForTests()
      const n = ttsNode({ textSource: "direct", directText: "hi" })
      const resolved = { voice: "vid_123", voiceType: "premade" as const, provider: "elevenlabs-v3" }
      expect(() => buildPayload(n, "job-tts-deny-1", resolved, undefined, ctx(n))).toThrow(
        /not available on this deployment/,
      )
      try {
        buildPayload(n, "job-tts-deny-1", resolved, undefined, ctx(n))
        expect.unreachable("buildPayload should have thrown for the denied dispatched provider")
      } catch (e) {
        expect((e as { code?: string }).code).toBe("model_not_available")
        expect((e as Error).message).toMatch(/elevenlabs-v3/)
      }
    })

    it("does NOT deny a text-to-speech node whose effective (auto-wired) provider is allowed", () => {
      // deny lists elevenlabs-v3, but the effective dispatched provider is the
      // auto-wired elevenlabs-turbo → the node must build normally and dispatch it.
      process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["elevenlabs-v3"] } })
      __resetSurfaceProfileCacheForTests()
      const n = ttsNode({ textSource: "direct", directText: "hi" })
      const resolved = { voice: "vid_123", voiceType: "premade" as const, provider: "elevenlabs-turbo" }
      const result = buildPayload(n, "job-tts-allow-1", resolved, undefined, ctx(n))
      expect(result.payload.provider).toBe("elevenlabs-turbo")
    })

    it("a text-to-dialogue node is denied on the model it RUNS as: an unset or unknown provider dispatches v3 dialogue, so denying v3 dialogue refuses it", () => {
      // The dialogue case dispatches and bills `dialogueProviderOf(data.provider)`;
      // the deny check must read the same resolved id, or a node that simply
      // omits `provider` (every node saved before the field existed) runs and
      // bills a model the deployment declared unavailable.
      process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["elevenlabs-dialogue"] } })
      __resetSurfaceProfileCacheForTests()
      for (const provider of [undefined, "nope", "constructor"]) {
        const n: SimpleNode = { id: "dlg-1", type: "text-to-dialogue", data: { dialogue: [{ id: "1", text: "Hi", voice: "Rachel" }], provider } }
        try {
          buildPayload(n, "job-dlg-deny-1", {}, undefined, ctx(n))
          expect.unreachable(`buildPayload should have thrown for provider ${String(provider)}`)
        } catch (e) {
          expect((e as { code?: string }).code, String(provider)).toBe("model_not_available")
          expect((e as Error).message, String(provider)).toMatch(/elevenlabs-dialogue/)
        }
      }
    })

    it("does NOT deny a text-to-dialogue node when only a text-to-speech model is denied", () => {
      process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["elevenlabs-v3"] } })
      __resetSurfaceProfileCacheForTests()
      const n: SimpleNode = { id: "dlg-2", type: "text-to-dialogue", data: { dialogue: [{ id: "1", text: "Hi", voice: "Rachel" }] } }
      const result = buildPayload(n, "job-dlg-allow-1", {}, undefined, ctx(n))
      expect(result.modelIdentifier).toBe("elevenlabs-dialogue")
    })

    it("a video-depth node is denied on the model it RUNS as: an unset or unknown provider dispatches video-depth-anything, so denying it refuses the node", () => {
      // The video-depth case dispatches and bills `resolveVideoDepthProvider(data.provider)`
      // — the route does the same (its preHandler writes the resolved provider back
      // before the guard's deny). Reading raw data.provider here would let a node
      // that omits it run a model the deployment declared unavailable.
      process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["video-depth-anything"] } })
      __resetSurfaceProfileCacheForTests()
      for (const provider of [undefined, "nope", "constructor"]) {
        const n: SimpleNode = { id: "vd-1", type: "video-depth", data: { provider } }
        try {
          buildPayload(n, "job-vd-deny-1", { videoUrl: "https://cdn.example.com/clip.mp4" }, undefined, ctx(n))
          expect.unreachable(`buildPayload should have thrown for provider ${String(provider)}`)
        } catch (e) {
          expect((e as { code?: string }).code, String(provider)).toBe("model_not_available")
          expect((e as Error).message, String(provider)).toMatch(/video-depth-anything/)
        }
      }
    })

    it("does NOT deny a video-depth node on the default provider when only the Replicate provider is denied", () => {
      process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["depth-anything-frames"] } })
      __resetSurfaceProfileCacheForTests()
      const n: SimpleNode = { id: "vd-2", type: "video-depth", data: {} }
      const result = buildPayload(n, "job-vd-allow-1", { videoUrl: "https://cdn.example.com/clip.mp4" }, undefined, ctx(n))
      expect(result.payload.provider).toBe("video-depth-anything")
    })

    it("does NOT falsely deny a NON-TTS node that merely carries an unrelated resolvedInputs.provider (no over-reach)", () => {
      // generate-image dispatches on data.provider ONLY. A stray (denied)
      // resolvedInputs.provider must not gate it — the helper deliberately reads
      // resolvedInputs.provider for text-to-speech ONLY, so non-TTS nodes are
      // unchanged and can't be falsely denied.
      process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["elevenlabs-v3"] } })
      __resetSurfaceProfileCacheForTests()
      const n = giNode("nano-banana")
      const result = buildPayload(n, "job-nontts-1", { provider: "elevenlabs-v3" }, undefined, ctx(n))
      expect(result.modelIdentifier).toBeDefined()
      expect(result.modelIdentifier).not.toBe("elevenlabs-v3")
    })
  })
})

describe("payload-builder-node-deny-viewer.test.ts", () => {
  /**
   * The run-time node-availability backstop in buildPayload asks WHO the run
   * belongs to.
   *
   * The admin switch hides a node from the deployment's users. The run executes
   * as a specific user — an app run as its runner, a scheduled run as the
   * workflow's owner — and `node-executor.ts` hands that user's viewer in through
   * `PayloadBuildContext.viewer`. An admin's run keeps a hidden node; a user's
   * run (including a user running an admin-built app or template) fails with the
   * coded `node_not_available`. A caller that names no viewer is a USER — the
   * admin's view is never the default.
   */
  beforeAll(() => __availabilityUniverseReadyForTests())

  afterEach(() => {
    __resetAvailabilityOverridesForTests()
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
  })

  const node: SimpleNode = {
    id: "gi-1",
    type: "generate-image",
    data: { provider: "nano-banana", prompt: "a red bird on a branch" },
  }

  /** The stored override: everything on except `generate-image`. */
  function hideFromUsers(): void {
    __resetAvailabilityOverridesForTests({
      nodes: new Set([...GATEABLE_NODE_TYPES].filter((t) => t !== "generate-image")),
    })
  }

  /** The error code buildPayload throws for this run, or undefined when it builds. */
  function codeFor(viewer: AvailabilityViewer | undefined): string | undefined {
    try {
      buildPayload(node, "job-1", {}, undefined, { nodes: [node], edges: [], nodeStates: {}, ...(viewer ? { viewer } : {}) })
      return undefined
    } catch (e) {
      return (e as { code?: string }).code
    }
  }

  describe("buildPayload — node availability is asked as the run's own user", () => {
    it("a user's run of a hidden node fails with node_not_available", () => {
      hideFromUsers()
      expect(codeFor(USER_VIEWER)).toBe("node_not_available")
    })

    it("a run that names NO viewer is a user's run — the admin view is never the default", () => {
      hideFromUsers()
      expect(codeFor(undefined)).toBe("node_not_available")
      // …and the same holds with no build context at all.
      expect(() => buildPayload(node, "job-1", {})).toThrow(/not available on this deployment: generate-image/)
    })

    it("an admin's run of a hidden node is not refused for availability", () => {
      hideFromUsers()
      expect(codeFor(ADMIN_VIEWER)).not.toBe("node_not_available")
    })

    it("an admin's run still fails for a node the deployment PROFILE removed", () => {
      process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["generate-image"] } })
      __resetSurfaceProfileCacheForTests()
      expect(codeFor(ADMIN_VIEWER)).toBe("node_not_available")
    })

    it("inert when nothing is hidden", () => {
      expect(codeFor(USER_VIEWER)).not.toBe("node_not_available")
      expect(codeFor(undefined)).not.toBe("node_not_available")
    })
  })
})
