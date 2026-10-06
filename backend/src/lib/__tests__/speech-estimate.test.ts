/**
 * What a speech NODE will send, as far as its data can tell, and the
 * (unit row, units) every estimate surface prices it with. Exact when the text
 * is literal on the node; the cap (or the exposed input's limit) when it arrives
 * at run time — an estimate may over-quote, never under-quote. Undefined for
 * every node while the flag is off, so each estimate loop keeps today's branch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const flag = vi.hoisted(() => ({ on: true }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", ELEVENLABS_API_KEY: "k" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  speechLengthPricingEnabled: () => flag.on,
}))
// The module carries the marked-up job override, which reads app settings
// (→ the database client); the estimator itself touches neither.
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: vi.fn() }))

import { getMaxTtsChars, getDialogueCapabilities, SPEECH_FLOOR_UNITS } from "@nodaro/shared"
import { billableSpeechChars } from "../speech-credits.js"
import { speechEstimate, speechEstimateChars, speechLineEstimate, upstreamSpeechText } from "../speech-estimate.js"

const tts = (data: Record<string, unknown>) => ({ textSource: "direct", provider: "elevenlabs-v4", ...data })

beforeEach(() => {
  flag.on = true
})

describe("speechEstimateChars — text-to-speech", () => {
  it("literal text is exact: affixes applied, then the one counter (clamp, tag strip)", () => {
    const e = speechEstimateChars("text-to-speech", tts({ directText: "a".repeat(950), promptPrefix: "[calm] ", promptSuffix: " end" }))
    expect(e).toMatchObject({ exact: true, runsAs: "elevenlabs-v4" })
    expect(e.chars).toBe(billableSpeechChars("elevenlabs-v4", "[calm] " + "a".repeat(950) + " end"))
    const turbo = speechEstimateChars("text-to-speech", tts({ provider: "elevenlabs-turbo", directText: "[whispers] " + "a".repeat(100) }))
    expect(turbo.chars).toBe(100) // the tag is stripped on turbo, as the worker sends it
  })

  it.each([
    ["connected text", tts({ textSource: "connected", directText: "ignored" })],
    ["a {Reference} in the text", tts({ directText: "Read this: {Script}" })],
    ["a reference inside an affix", tts({ directText: "hello", promptPrefix: "{Tone} " })],
    ["a field mapping onto directText", tts({ directText: "hello", fieldMappings: { directText: { sourceNodeId: "n0" } } })],
    ["no text at all", tts({ directText: undefined })],
  ])("%s is unknown → the model's cap", (_label, data) => {
    const e = speechEstimateChars("text-to-speech", data)
    expect(e.exact).toBe(false)
    expect(e.chars).toBe(getMaxTtsChars("elevenlabs-v4"))
  })

  it("an exposed input's limit caps an unknown text, never raises it above the model's cap", () => {
    expect(speechEstimateChars("text-to-speech", tts({ textSource: "connected" }), { textCap: 1200 }).chars).toBe(1200)
    expect(speechEstimateChars("text-to-speech", tts({ textSource: "connected" }), { textCap: 99_999 }).chars).toBe(getMaxTtsChars("elevenlabs-v4"))
    // a limit never shrinks LITERAL text: the run sends the literal
    expect(speechEstimateChars("text-to-speech", tts({ directText: "a".repeat(3000) }), { textCap: 1200 }).chars).toBe(3000)
  })

  it("a literal upstream Text node makes a connected text exact — the one-hop rule the caller resolves", () => {
    const ctx = { upstreamText: "[calm] " + "a".repeat(950) }
    expect(speechEstimateChars("text-to-speech", tts({ textSource: "connected" }), ctx)).toMatchObject({ exact: true, chars: 957 })
    // the omitted-provider length rule reads the upstream text too
    expect(speechEstimateChars("text-to-speech", tts({ provider: undefined, textSource: "connected" }), { upstreamText: "a".repeat(12_000) }).runsAs).toBe("elevenlabs-turbo")
  })

  it("upstreamSpeechText: Text node with literal, unexposed text → exact; exposed with a limit → the limit; exposed without one → nothing; anything else → nothing", () => {
    const tts1 = { id: "t", type: "text-to-speech", data: tts({ textSource: "connected" }) }
    const text = { id: "s", type: "text-prompt", data: { text: "a".repeat(500) } }
    const llm = { id: "l", type: "llm-chat", data: {} }
    const edge = (source: string) => ({ source, target: "t", targetHandle: "prompt" })
    expect(upstreamSpeechText(tts1, [tts1, text], [edge("s")], {})).toEqual({ upstreamText: "a".repeat(500) })
    expect(upstreamSpeechText(tts1, [tts1, text], [edge("s")], { "s:text": 300 })).toEqual({ textCap: 300 })
    // exposed, no limit: the stored text is the author's placeholder — unknown, the cap
    expect(upstreamSpeechText(tts1, [tts1, text], [edge("s")], { "s:text": null })).toEqual({ wireUnknown: true })
    expect(upstreamSpeechText(tts1, [tts1, { ...text, data: { text: "{Topic} intro" } }], [edge("s")], {})).toEqual({ wireUnknown: true })
    expect(upstreamSpeechText(tts1, [tts1, llm], [edge("l")], {})).toEqual({ wireUnknown: true })
    // a null handle counts as the prompt (the resolver's `inputs.prompt = output` fallback)
    expect(upstreamSpeechText(tts1, [tts1, text], [{ source: "s", target: "t", targetHandle: null }], {})).toEqual({ upstreamText: "a".repeat(500) })
    // an edge into another handle (a Character's voice) is not the text
    expect(upstreamSpeechText(tts1, [tts1, text], [{ source: "s", target: "t", targetHandle: "character" }], {})).toEqual({})
    const direct = { ...tts1, data: tts({ directText: "x" }) }
    // exposed WITH a limit is still exposed: the stored default is a placeholder, the limit is the ceiling
    expect(upstreamSpeechText(direct, [direct], [], { "t:directText": 800 })).toEqual({ exposed: true, textCap: 800 })
    expect(upstreamSpeechText(direct, [direct], [], { "t:directText": null })).toEqual({ exposed: true })
    expect(upstreamSpeechText(direct, [direct], [], {})).toEqual({})
  })

  it("an exposed direct text with no limit is unknown even though the node holds a default", () => {
    expect(speechEstimateChars("text-to-speech", tts({ directText: "a".repeat(200) }), { exposed: true })).toMatchObject({ exact: false, chars: getMaxTtsChars("elevenlabs-v4") })
    expect(speechEstimateChars("text-to-speech", tts({ directText: "a".repeat(200) }), { exposed: true, textCap: 800 })).toMatchObject({ exact: false, chars: 800 })
  })

  it("the model: named → as it runs (alias → turbo, unknown id → the fallback); omitted → the length rule on literal text, the default model on unknown text", () => {
    expect(speechEstimateChars("text-to-speech", tts({ provider: "elevenlabs", directText: "a".repeat(12_000) })).runsAs).toBe("elevenlabs-turbo")
    expect(speechEstimateChars("text-to-speech", tts({ provider: "not-a-model", directText: "x" })).runsAs).toBe("elevenlabs-turbo")
    expect(speechEstimateChars("text-to-speech", tts({ provider: undefined, directText: "a".repeat(100) })).runsAs).toBe("elevenlabs-v4")
    expect(speechEstimateChars("text-to-speech", tts({ provider: undefined, directText: "a".repeat(12_000) })).runsAs).toBe("elevenlabs-turbo")
    const unknown = speechEstimateChars("text-to-speech", tts({ provider: undefined, textSource: "connected" }))
    expect(unknown).toMatchObject({ runsAs: "elevenlabs-v4", chars: getMaxTtsChars("elevenlabs-v4") }) // Review Focus 2
    // a MAPPED provider is unknown too → the default model
    expect(speechEstimateChars("text-to-speech", tts({ provider: "elevenlabs-turbo", directText: "x", fieldMappings: { provider: { sourceNodeId: "p" } } })).runsAs).toBe("elevenlabs-v4")
  })
})

describe("speechEstimateChars — text-to-dialogue", () => {
  it("literal lines are exact (sum, unstripped, capped at the model's total); a reference or a mapping is the cap", () => {
    const lines = [{ text: "a".repeat(1234), voice: "R" }, { text: "[laughs] " + "b".repeat(900), voice: "G" }]
    expect(speechEstimateChars("text-to-dialogue", { dialogue: lines })).toMatchObject({ exact: true, chars: 1234 + 909, runsAs: "elevenlabs-dialogue" })
    expect(speechEstimateChars("text-to-dialogue", { dialogue: [{ text: "{Script}", voice: "R" }] })).toMatchObject({ exact: false, chars: getDialogueCapabilities("elevenlabs-dialogue").maxChars })
    expect(speechEstimateChars("text-to-dialogue", { dialogue: lines, fieldMappings: { dialogue: { sourceNodeId: "s" } } })).toMatchObject({ exact: false })
    expect(speechEstimateChars("text-to-dialogue", { dialogue: lines, provider: "elevenlabs-dialogue-v4" }).runsAs).toBe("elevenlabs-dialogue-v4")
    expect(speechEstimateChars("text-to-dialogue", { dialogue: "not lines" })).toMatchObject({ exact: false })
    expect(speechEstimateChars("text-to-dialogue", { dialogue: [] }, { textCap: 500 })).toMatchObject({ exact: true, chars: 0 })
  })
})

describe("speechEstimate — the (row, units) pair", () => {
  it("prices on the unit row of the model the run uses, units = started hundreds, at least the floor", () => {
    expect(speechEstimate("text-to-speech", tts({ directText: "a".repeat(100) }))).toMatchObject({ id: "elevenlabs-v4:per-100-chars", units: SPEECH_FLOOR_UNITS })
    expect(speechEstimate("text-to-speech", tts({ directText: "a".repeat(801) }))).toMatchObject({ id: "elevenlabs-v4:per-100-chars", units: 9 })
    expect(speechEstimate("text-to-speech", tts({ provider: "elevenlabs", directText: "a".repeat(1000) }))).toMatchObject({ id: "elevenlabs-turbo:per-100-chars", units: 10 })
    expect(speechEstimate("text-to-speech", tts({ textSource: "connected" }))).toMatchObject({ id: "elevenlabs-v4:per-100-chars", units: 100 })
    expect(speechEstimate("text-to-dialogue", { dialogue: [{ text: "a".repeat(2500), voice: "R" }, { text: "b".repeat(2500), voice: "G" }] })).toMatchObject({ id: "elevenlabs-dialogue:per-100-chars", units: 50 })
  })

  it("is undefined for every other node type, and for every node while the flag is off", () => {
    expect(speechEstimate("generate-image", { prompt: "x" })).toBeUndefined()
    flag.on = false
    expect(speechEstimate("text-to-speech", tts({ directText: "a".repeat(5000) }))).toBeUndefined()
    expect(speechEstimate("text-to-dialogue", { dialogue: [] })).toBeUndefined()
  })

  it("speechLineEstimate: one literal line as its own job — the one counter, no reference heuristic", () => {
    expect(speechLineEstimate("elevenlabs-turbo", "a".repeat(150))).toEqual({ id: "elevenlabs-turbo:per-100-chars", units: SPEECH_FLOOR_UNITS })
    expect(speechLineEstimate("elevenlabs", "a".repeat(1001))).toEqual({ id: "elevenlabs-turbo:per-100-chars", units: 11 })
    // an LLM-written `{` is text here
    expect(speechLineEstimate("elevenlabs-v4", "{" + "a".repeat(899) + "}")).toEqual({ id: "elevenlabs-v4:per-100-chars", units: 10 })
  })
})
