import { describe, it, expect } from "vitest"
import {
  TRANSCRIBE_PROVIDERS,
  TRANSCRIBE_LANES,
  TRANSCRIBE_PROVIDER_CAPABILITIES,
  CAPTION_TRANSCRIBE_LANES,
  TRANSCRIBE_TARGET_LANGUAGES,
  transcribeProvidersWithWordTimestamps,
  transcribeLaneSupportsWordTimestamps,
  transcribeProvidersWithTranslation,
  transcribeLaneSupportsTranslation,
  DEFAULT_TRANSCRIBE_PROVIDER,
  DEFAULT_TRANSCRIBE_NODE_PROVIDER,
} from "../model-constants.js"

describe("transcribe lane capabilities", () => {
  it("every lane has a capability entry", () => {
    const missing = TRANSCRIBE_LANES.filter((p) => TRANSCRIBE_PROVIDER_CAPABILITIES[p] === undefined)
    expect(missing, `lanes without a capability row: ${missing.join(", ")}`).toEqual([])
  })

  it("every TRANSCRIBE_PROVIDERS member is a lane with a capability entry", () => {
    // The user-facing enum is a SUBSET of the lanes. A provider a caller can
    // name but whose capabilities are unknown is the bug this pins.
    const lanes = new Set<string>(TRANSCRIBE_LANES)
    const orphans = TRANSCRIBE_PROVIDERS.filter((p) => !lanes.has(p))
    expect(orphans, `TRANSCRIBE_PROVIDERS members missing from TRANSCRIBE_LANES: ${orphans.join(", ")}`).toEqual([])
    for (const p of TRANSCRIBE_PROVIDERS) {
      expect(TRANSCRIBE_PROVIDER_CAPABILITIES[p]).toBeDefined()
    }
  })

  it("the capability map has no entry that is not a lane", () => {
    const lanes = new Set<string>(TRANSCRIBE_LANES)
    const extra = Object.keys(TRANSCRIBE_PROVIDER_CAPABILITIES).filter((k) => !lanes.has(k))
    expect(extra, `capability rows for unknown lanes: ${extra.join(", ")}`).toEqual([])
  })

  it("openai/whisper cannot do word timestamps; the other three can", () => {
    // Not a taste call: openai/whisper on Replicate has no `word_timestamps`
    // input in any published version, so the key is silently dropped.
    expect(TRANSCRIBE_PROVIDER_CAPABILITIES.whisper.wordTimestamps).toBe(false)
    expect(TRANSCRIBE_PROVIDER_CAPABILITIES["incredibly-fast-whisper"].wordTimestamps).toBe(true)
    expect(TRANSCRIBE_PROVIDER_CAPABILITIES["elevenlabs-stt"].wordTimestamps).toBe(true)
    expect(TRANSCRIBE_PROVIDER_CAPABILITIES["nemotron-3-5-transcribe"].wordTimestamps).toBe(true)
  })

  it("transcribeProvidersWithWordTimestamps derives from the capability map", () => {
    expect(transcribeProvidersWithWordTimestamps()).toEqual(["incredibly-fast-whisper", "elevenlabs-stt", "nemotron-3-5-transcribe"])
  })

  it("only Nemotron 3.5 Transcribe translates", () => {
    expect(transcribeProvidersWithTranslation()).toEqual(["nemotron-3-5-transcribe"])
    expect(transcribeLaneSupportsTranslation("nemotron-3-5-transcribe")).toBe(true)
    expect(transcribeLaneSupportsTranslation("elevenlabs-stt")).toBe(false)
    expect(transcribeLaneSupportsTranslation("deepgram")).toBe(false)
    expect(transcribeLaneSupportsTranslation(undefined)).toBe(false)
  })

  it("the target languages are KIE's 32 (English first)", () => {
    expect(TRANSCRIBE_TARGET_LANGUAGES[0]).toBe("en")
    expect(TRANSCRIBE_TARGET_LANGUAGES).toHaveLength(32)
    expect(new Set(TRANSCRIBE_TARGET_LANGUAGES).size).toBe(32)
  })

  it("the new engine joins at the END, so the first word-capable provider stays ElevenLabs STT", () => {
    // Several call sites take "the first enabled word-capable provider" from
    // TRANSCRIBE_PROVIDERS (add-captions' cloud relay among them).
    expect(TRANSCRIBE_PROVIDERS[0]).toBe("elevenlabs-stt")
    expect(TRANSCRIBE_PROVIDERS.find((p) => TRANSCRIBE_PROVIDER_CAPABILITIES[p].wordTimestamps)).toBe("elevenlabs-stt")
    expect(TRANSCRIBE_PROVIDERS[TRANSCRIBE_PROVIDERS.length - 1]).toBe("nemotron-3-5-transcribe")
  })

  it("Add Captions keeps its three lanes: no length-priced engine runs inside its flat price", () => {
    expect([...CAPTION_TRANSCRIBE_LANES].sort()).toEqual(["elevenlabs-stt", "incredibly-fast-whisper", "whisper"])
    for (const lane of CAPTION_TRANSCRIBE_LANES) expect(TRANSCRIBE_LANES).toContain(lane)
  })

  it("the defaults do not move", () => {
    expect(DEFAULT_TRANSCRIBE_PROVIDER).toBe("whisper")
    expect(DEFAULT_TRANSCRIBE_NODE_PROVIDER).toBe("elevenlabs-stt")
  })

  it("the default lane is itself a lane", () => {
    expect(TRANSCRIBE_LANES).toContain(DEFAULT_TRANSCRIBE_PROVIDER)
  })

  it("the transcribe NODE default is a lane, is ENABLED, and is word-capable", () => {
    // The canvas node and the DAG both resolve an absent provider to this one,
    // so it has to be a lane the route still accepts AND one that can answer the
    // word-timings request a wired `json` handle infers.
    expect(TRANSCRIBE_LANES).toContain(DEFAULT_TRANSCRIBE_NODE_PROVIDER)
    expect(TRANSCRIBE_PROVIDERS as readonly string[]).toContain(DEFAULT_TRANSCRIBE_NODE_PROVIDER)
    expect(TRANSCRIBE_PROVIDER_CAPABILITIES[DEFAULT_TRANSCRIBE_NODE_PROVIDER].wordTimestamps).toBe(true)
  })
})

describe("transcribeLaneSupportsWordTimestamps — untrusted lane ids", () => {
  it("answers the capability table for every known lane", () => {
    for (const lane of TRANSCRIBE_LANES) {
      expect(transcribeLaneSupportsWordTimestamps(lane)).toBe(
        TRANSCRIBE_PROVIDER_CAPABILITIES[lane].wordTimestamps,
      )
    }
  })

  it("answers false for a lane it has never heard of", () => {
    // Node data is untrusted: an imported workflow can carry any string. The
    // caller must not index the capability table directly (TypeError) nor
    // assume a capability it cannot verify.
    expect(transcribeLaneSupportsWordTimestamps("deepgram")).toBe(false)
    expect(transcribeLaneSupportsWordTimestamps("")).toBe(false)
    expect(transcribeLaneSupportsWordTimestamps(undefined)).toBe(false)
    expect(transcribeLaneSupportsWordTimestamps(null)).toBe(false)
  })
})

// The catalog is what /v1/models and MCP list_models publish. Every engine a
// caller may name must be listed there, and its "word-timestamps" feature must
// agree with the capability table — the table is the authority, the catalog a
// published copy that this test keeps honest.
describe("MODEL_CATALOG ↔ transcribe capabilities", () => {
  it("lists every nameable transcribe engine as an stt model", async () => {
    const { MODEL_CATALOG } = await import("../model-catalog.js")
    const { TRANSCRIBE_PROVIDERS } = await import("../model-constants.js")
    for (const id of TRANSCRIBE_PROVIDERS) {
      const entry = (MODEL_CATALOG as Record<string, { modes?: readonly string[] } | undefined>)[id]
      expect(entry, `${id} missing from MODEL_CATALOG`).toBeDefined()
      expect(entry!.modes, id).toContain("stt")
    }
  })

  it('the catalog "word-timestamps" feature matches TRANSCRIBE_PROVIDER_CAPABILITIES', async () => {
    const { MODEL_CATALOG } = await import("../model-catalog.js")
    const { TRANSCRIBE_LANES, TRANSCRIBE_PROVIDER_CAPABILITIES } = await import("../model-constants.js")
    for (const id of TRANSCRIBE_LANES) {
      const features = (MODEL_CATALOG as Record<string, { features?: readonly string[] } | undefined>)[id]?.features ?? []
      expect(features.includes("word-timestamps"), id).toBe(TRANSCRIBE_PROVIDER_CAPABILITIES[id].wordTimestamps)
    }
  })
})
