import { describe, it, expect } from "vitest"
import {
  DEFAULT_TTS_PROVIDER,
  TTS_PROVIDERS,
  MODEL_CATALOG,
  MODEL_RECOMMENDATIONS,
  getTtsCapabilities,
  getMaxTtsChars,
} from "../index.js"

/**
 * The speech model a request runs on when it names none. Every lane reads this one
 * constant — the REST route's credit guard and handler, the workflow engine's
 * text-to-speech dispatch, the worker's defensive default, the MCP `generate_speech`
 * tool, the narration pipeline, the video director and the editor's new-node default —
 * so none of them can run one model and bill another.
 *
 * This file is the ONE place the literal is pinned; every other test asserts against
 * the constant.
 */
describe("DEFAULT_TTS_PROVIDER", () => {
  it("is ElevenLabs v4 (the default flip, decided 2026-10-05)", () => {
    expect(DEFAULT_TTS_PROVIDER).toBe("elevenlabs-v4")
  })

  it("is a real text-to-speech model: listed, priced, with a complete capability sheet", () => {
    expect(TTS_PROVIDERS).toContain(DEFAULT_TTS_PROVIDER)
    const entry = MODEL_CATALOG[DEFAULT_TTS_PROVIDER]
    expect(entry?.modes as readonly string[] | undefined).toContain("tts")
    expect(entry?.pricing.map((p) => p.identifier)).toContain(DEFAULT_TTS_PROVIDER)
    expect(getTtsCapabilities(DEFAULT_TTS_PROVIDER).maxChars).toBe(getMaxTtsChars(DEFAULT_TTS_PROVIDER))
  })

  it("is not the legacy `elevenlabs` alias (that id runs, and is billed, as turbo)", () => {
    expect(DEFAULT_TTS_PROVIDER).not.toBe("elevenlabs")
  })

  it("is the one featured speech model, and leads the narration recommendation", () => {
    const featuredTts = Object.values(MODEL_CATALOG)
      .filter((m) => (m.modes as readonly string[]).includes("tts") && m.featured === true)
      .map((m) => m.id)
    expect(featuredTts).toEqual([DEFAULT_TTS_PROVIDER])
    const narration = MODEL_RECOMMENDATIONS.find((r) => r.intent === "voice over / narration")
    expect(narration?.modelIds[0]).toBe(DEFAULT_TTS_PROVIDER)
  })
})
