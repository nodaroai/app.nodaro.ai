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
import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"
import { config } from "../../../lib/config.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"

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
