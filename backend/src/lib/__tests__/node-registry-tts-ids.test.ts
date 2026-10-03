/**
 * Text to Speech's descriptor in GET /v1/nodes advertises the ids its route
 * takes. It listed ElevenLabs' own wire names (eleven_v3 …) under a `model`
 * field; the route takes `provider` from TTS_PROVIDERS (elevenlabs-v3 …), so
 * a caller following the descriptor got a 400, or its `model` was silently
 * dropped and the run used the default (item 12 of the docs rebuild).
 */
import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, TTS_PROVIDERS } from "@nodaro/shared"
import { NODE_REGISTRY } from "../node-registry.js"

const tts = NODE_REGISTRY.find((n) => n.type === "text-to-speech")!

describe("text-to-speech descriptor", () => {
  it("advertises catalog models the route accepts", () => {
    expect(tts.providers?.length).toBeGreaterThan(0)
    for (const id of tts.providers ?? []) {
      expect((TTS_PROVIDERS as readonly string[]).includes(id), id).toBe(true)
      expect(MODEL_CATALOG[id], id).toBeDefined()
    }
  })

  it("names the field the route reads (`provider`), with the same options", () => {
    const fields = tts.inputSchema?.fields ?? []
    expect(fields.some((f) => f.key === "model")).toBe(false)
    expect(fields.find((f) => f.key === "provider")?.options).toEqual(tts.providers)
  })
})
