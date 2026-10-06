/**
 * The editor's mirror of the backend speech estimator (lib/speech-estimate.ts):
 * what a Text to Speech / Text to Dialogue node will send, as far as its data
 * can tell, and the (unit row, units) pair the pill, the panel and the Run total
 * price it with. Pure: the unit price is passed in — its absence IS the flag
 * (the server serves a `:per-100-chars` row only while length pricing is on).
 *
 * The shared fixture (tools/fixtures/speech-estimate-cases.json) pins this
 * engine to the backend's case for case.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { SPEECH_FLOOR_UNITS, speechPriceUnits } from "@nodaro/shared"
import {
  speechEstimateChars,
  speechFlatId,
  speechQuote,
  speechUnitIdsFor,
  upstreamSpeechText,
  type SpeechEstimateContext,
} from "../speech-estimate"

type Repeat = { repeat: number; of: string; prefix?: string }
type Case = {
  name: string
  nodeType: string
  data: Record<string, unknown>
  ctx?: Record<string, unknown>
  expect: { runsAs: string; chars: number; exact: boolean; units: number }
}

const FIXTURE = resolve(__dirname, "../../../../tools/fixtures/speech-estimate-cases.json")
const { cases } = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: Case[] }

function expand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expand)
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>
    if (typeof o.repeat === "number" && typeof o.of === "string") {
      const r = o as Repeat
      return (r.prefix ?? "") + r.of.repeat(r.repeat)
    }
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, expand(v)]))
  }
  return value
}

const tts = (data: Record<string, unknown>) => ({ textSource: "direct", provider: "elevenlabs-v4", ...data })
const FOUR = () => 4
const NONE = () => undefined

describe("the speech estimate fixture — editor engine", () => {
  it("has a meaningful number of cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20)
  })

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const data = expand(c.data) as Record<string, unknown>
    const ctx = (c.ctx ? expand(c.ctx) : {}) as SpeechEstimateContext
    const e = speechEstimateChars(c.nodeType, data, ctx)
    expect({ runsAs: e.runsAs, chars: e.chars, exact: e.exact, units: speechPriceUnits(e.chars) }).toEqual(c.expect)
  })
})

describe("speechQuote — the (row, units, credits) the editor shows", () => {
  it("a literal text is exact: the unit row of the model it runs as × started hundreds, at least the floor", () => {
    const q = speechQuote("text-to-speech", tts({ directText: "a".repeat(1000) }), {}, FOUR)
    expect(q).toMatchObject({ id: "elevenlabs-v4:per-100-chars", unit: 4, units: 10, chars: 1000, exact: true, credits: 40 })
    expect(q?.range).toBeUndefined()
    const floor = speechQuote("text-to-speech", tts({ directText: "a".repeat(100) }), {}, FOUR)
    expect(floor).toMatchObject({ units: SPEECH_FLOOR_UNITS, credits: 32 })
    const alias = speechQuote("text-to-speech", tts({ provider: "elevenlabs", directText: "a".repeat(1000) }), {}, FOUR)
    expect(alias).toMatchObject({ id: "elevenlabs-turbo:per-100-chars", units: 10 })
  })

  it("an unknown text is a range: from the floor up to the ceiling it is priced at", () => {
    const q = speechQuote("text-to-speech", tts({ textSource: "connected" }), {}, FOUR)
    expect(q).toMatchObject({ id: "elevenlabs-v4:per-100-chars", units: 100, exact: false, credits: 400, range: { min: 32, max: 400 } })
    // An exposed input's limit tightens the ceiling.
    expect(speechQuote("text-to-speech", tts({ textSource: "connected" }), { textCap: 1200 }, FOUR)).toMatchObject({ credits: 48, range: { min: 32, max: 48 } })
  })

  it("dialogue prices its lines on its own model's unit row", () => {
    const lines = [{ text: "a".repeat(2500), voice: "R" }, { text: "b".repeat(2500), voice: "G" }]
    expect(speechQuote("text-to-dialogue", { provider: "elevenlabs-dialogue-v4", dialogue: lines }, {}, FOUR)).toMatchObject({ id: "elevenlabs-dialogue-v4:per-100-chars", units: 50, credits: 200, exact: true })
  })

  it("is undefined for a non-speech node, and for a speech node while the unit row is not served (flag off / cold cache)", () => {
    expect(speechQuote("generate-image", { prompt: "x" }, {}, FOUR)).toBeUndefined()
    expect(speechQuote("text-to-speech", tts({ directText: "a".repeat(5000) }), {}, NONE)).toBeUndefined()
    expect(speechQuote("text-to-dialogue", { dialogue: [] }, {}, NONE)).toBeUndefined()
  })

  it("asks the price of the unit row of the model the estimate runs as — never another id", () => {
    const asked: string[] = []
    speechQuote("text-to-speech", tts({ provider: "elevenlabs", directText: "a".repeat(12_000) }), {}, (id) => { asked.push(id); return 2 })
    expect(asked).toEqual(["elevenlabs-turbo:per-100-chars"])
  })
})

describe("upstreamSpeechText — the one-hop rule over the canvas graph", () => {
  const node = { id: "t", type: "text-to-speech", data: tts({ textSource: "connected" }) }
  const text = { id: "s", type: "text-prompt", data: { text: "a".repeat(500) } }
  const llm = { id: "l", type: "llm-chat", data: {} }
  const edge = (source: string, targetHandle: string | null = "prompt") => ({ id: `${source}-t`, source, target: "t", targetHandle })

  it("a literal, unexposed Text node wired into prompt → exact; any other source → nothing", () => {
    expect(upstreamSpeechText(node, [node, text], [edge("s")], {})).toEqual({ upstreamText: "a".repeat(500) })
    expect(upstreamSpeechText(node, [node, text], [edge("s", null)], {})).toEqual({ upstreamText: "a".repeat(500) })
    expect(upstreamSpeechText(node, [node, { ...text, data: { text: "{Topic} intro" } }], [edge("s")], {})).toEqual({ wireUnknown: true })
    expect(upstreamSpeechText(node, [node, llm], [edge("l")], {})).toEqual({ wireUnknown: true })
    expect(upstreamSpeechText(node, [node, text], [], {})).toEqual({})
  })

  it("an exposed Text input: its limit, or nothing when it has none; an exposed direct text is exposed (with its limit)", () => {
    expect(upstreamSpeechText(node, [node, text], [edge("s")], { "s:text": 300 })).toEqual({ textCap: 300 })
    expect(upstreamSpeechText(node, [node, text], [edge("s")], { "s:text": null })).toEqual({ wireUnknown: true })
    const direct = { ...node, data: tts({ directText: "x" }) }
    expect(upstreamSpeechText(direct, [direct], [], { "t:directText": 800 })).toEqual({ exposed: true, textCap: 800 })
    expect(upstreamSpeechText(direct, [direct], [], { "t:directText": null })).toEqual({ exposed: true })
    expect(upstreamSpeechText(direct, [direct], [], {})).toEqual({})
  })
})

describe("the ids the editor asks the server for", () => {
  it("speechFlatId is today's row: the stored model (the default when none) / the dialogue model it runs as", () => {
    expect(speechFlatId("text-to-speech", {})).toBe("elevenlabs-v4")
    expect(speechFlatId("text-to-speech", { provider: "elevenlabs-turbo" })).toBe("elevenlabs-turbo")
    expect(speechFlatId("text-to-speech", { provider: "elevenlabs" })).toBe("elevenlabs")
    expect(speechFlatId("text-to-dialogue", {})).toBe("elevenlabs-dialogue")
    expect(speechFlatId("text-to-dialogue", { provider: "elevenlabs-dialogue-v4" })).toBe("elevenlabs-dialogue-v4")
  })

  it("speechUnitIdsFor names each speech node's unit row (on the model its estimate runs as), once", () => {
    const a = { id: "a", type: "text-to-speech", data: tts({ provider: "elevenlabs", directText: "x" }) }
    const b = { id: "b", type: "text-to-speech", data: tts({ textSource: "connected" }) }
    const d = { id: "d", type: "text-to-dialogue", data: { dialogue: [] } }
    const img = { id: "i", type: "generate-image", data: {} }
    expect(speechUnitIdsFor([a, b, d, img, b], [a, b, d, img], [])).toEqual(["elevenlabs-turbo:per-100-chars", "elevenlabs-v4:per-100-chars", "elevenlabs-dialogue:per-100-chars"])
  })
})
