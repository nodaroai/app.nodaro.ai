// @vitest-environment node
/**
 * The editor's mirror of the backend speech estimator (lib/speech-estimate.ts):
 * what a Text to Speech / Text to Dialogue node will send, as far as its data
 * can tell, and the price the pill, the panel and the Run total quote: the
 * server's price for the whole request. Pure: the prices are passed in — the
 * unit row's absence IS the flag (the server serves a `:per-100-chars` row only
 * while length pricing is on).
 *
 * The shared fixture (tools/fixtures/speech-estimate-cases.json) pins this
 * engine to the backend's case for case — and its quote to the server's charge.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { SPEECH_FLOOR_UNITS, speechPriceUnits, speechQuoteCreditId } from "@nodaro/shared/credits"
import {
  speechEstimateChars,
  speechFlatId,
  speechPriceIdsFor,
  speechQuote,
  speechQuoteIds,
  upstreamSpeechText,
  type SpeechEstimateContext,
} from "../speech-estimate"

type Repeat = { repeat: number; of: string; prefix?: string }
type Case = {
  name: string
  nodeType: string
  data: Record<string, unknown>
  ctx?: Record<string, unknown>
  expect: { runsAs: string; chars: number; exact: boolean; units: number; quoteId: string; credits: number }
}

const FIXTURE = resolve(__dirname, "../../../../tools/fixtures/speech-estimate-cases.json")
const { cases, pricing } = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  cases: Case[]
  pricing: { chargePercent: number; unitRows: Record<string, number> }
}

/** What the server serves at the fixture's percent: ONE unit's price, as a lookup of the unit row answers it (rounded up). */
const servedUnit = (id: string) => {
  const row = pricing.unitRows[id]
  return row === undefined ? undefined : Math.ceil((row * (100 + pricing.chargePercent)) / 100)
}

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
const NONE = () => undefined

describe("the speech estimate fixture — editor engine", () => {
  it("has a meaningful number of cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20)
  })

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const data = expand(c.data) as Record<string, unknown>
    const ctx = (c.ctx ? expand(c.ctx) : {}) as SpeechEstimateContext
    const e = speechEstimateChars(c.nodeType, data, ctx)
    const units = speechPriceUnits(e.chars)
    expect({ runsAs: e.runsAs, chars: e.chars, exact: e.exact, units, quoteId: speechQuoteCreditId(e.runsAs, units), credits: c.expect.credits }).toEqual(c.expect)
  })

  // The backend suite (ee/billing/__tests__/speech-quote-equals-charge.test.ts) holds every server lane
  // to `credits`; here the editor's quote is held to it, served the way the server serves it: a price
  // for the unit row, and the server's own price for the case's whole request under its `quoteId`.
  it.each(cases.map((c) => [c.name, c] as const))("quotes what the server charges: %s", (_name, c) => {
    const data = expand(c.data) as Record<string, unknown>
    const ctx = (c.ctx ? expand(c.ctx) : {}) as SpeechEstimateContext
    const asked: string[] = []
    const served = (id: string) => {
      asked.push(id)
      return id === c.expect.quoteId ? c.expect.credits : servedUnit(id)
    }
    const q = speechQuote(c.nodeType, data, ctx, served)
    expect(q).toMatchObject({ quoteId: c.expect.quoteId, credits: c.expect.credits, served: true, priced: { id: c.expect.quoteId, units: 1 } })
    expect(asked).toContain(c.expect.quoteId)
    expect(speechQuoteIds(c.nodeType, data, ctx)).toContain(c.expect.quoteId)
    // The old rule — one served unit × the units — would have quoted more than the charge.
    expect(servedUnit(q!.id)! * q!.units).toBeGreaterThan(c.expect.credits)
  })
})

describe("speechQuote — the (row, units, credits) the editor shows", () => {
  /** A server that serves the unit row at 5 and each whole request at its own (lower) price: 9 per 2 units. */
  const WHOLE = (id: string) => {
    const m = /:per-100-chars:(\d+)u$/.exec(id)
    if (m) return Math.ceil((Number(m[1]) * 9) / 2)
    return id.endsWith(":per-100-chars") ? 5 : undefined
  }
  /** A server whose whole-request prices are not cached yet: only the unit row. */
  const UNIT_ONLY = (id: string) => (id.endsWith(":per-100-chars") ? 5 : undefined)

  it("a literal text is exact: the server's price for the whole request, on the model it runs as", () => {
    const q = speechQuote("text-to-speech", tts({ directText: "a".repeat(1000) }), {}, WHOLE)
    expect(q).toMatchObject({ id: "elevenlabs-v4:per-100-chars", unit: 5, units: 10, chars: 1000, exact: true, quoteId: "elevenlabs-v4:per-100-chars:10u", credits: 45, served: true, priced: { id: "elevenlabs-v4:per-100-chars:10u", units: 1 } })
    expect(q?.range).toBeUndefined()
    const floor = speechQuote("text-to-speech", tts({ directText: "a".repeat(100) }), {}, WHOLE)
    expect(floor).toMatchObject({ units: SPEECH_FLOOR_UNITS, quoteId: "elevenlabs-v4:per-100-chars:8u", credits: 36 })
    const alias = speechQuote("text-to-speech", tts({ provider: "elevenlabs", directText: "a".repeat(1000) }), {}, WHOLE)
    expect(alias).toMatchObject({ id: "elevenlabs-turbo:per-100-chars", quoteId: "elevenlabs-turbo:per-100-chars:10u", units: 10 })
  })

  it("until the whole request's price is cached, the unit row × the units — an upper bound, priced on the unit row", () => {
    const q = speechQuote("text-to-speech", tts({ directText: "a".repeat(1000) }), {}, UNIT_ONLY)
    expect(q).toMatchObject({ credits: 50, served: false, priced: { id: "elevenlabs-v4:per-100-chars", units: 10 } })
  })

  it("an unknown text is a range: from the floor's price up to the ceiling's", () => {
    const q = speechQuote("text-to-speech", tts({ textSource: "connected" }), {}, WHOLE)
    expect(q).toMatchObject({ id: "elevenlabs-v4:per-100-chars", units: 100, exact: false, quoteId: "elevenlabs-v4:per-100-chars:100u", credits: 450, range: { min: 36, max: 450 } })
    // An exposed input's limit tightens the ceiling.
    expect(speechQuote("text-to-speech", tts({ textSource: "connected" }), { textCap: 1200 }, WHOLE)).toMatchObject({ credits: 54, range: { min: 36, max: 54 } })
    // Cold whole prices: the bound, never a floor above the ceiling.
    expect(speechQuote("text-to-speech", tts({ textSource: "connected" }), { textCap: 1200 }, UNIT_ONLY)).toMatchObject({ credits: 60, range: { min: 40, max: 60 } })
  })

  it("dialogue prices its lines on its own model", () => {
    const lines = [{ text: "a".repeat(2500), voice: "R" }, { text: "b".repeat(2500), voice: "G" }]
    expect(speechQuote("text-to-dialogue", { provider: "elevenlabs-dialogue-v4", dialogue: lines }, {}, WHOLE)).toMatchObject({ id: "elevenlabs-dialogue-v4:per-100-chars", quoteId: "elevenlabs-dialogue-v4:per-100-chars:50u", units: 50, credits: 225, exact: true })
  })

  it("is undefined for a non-speech node, and for a speech node while the unit row is not served (flag off / cold cache)", () => {
    expect(speechQuote("generate-image", { prompt: "x" }, {}, WHOLE)).toBeUndefined()
    expect(speechQuote("text-to-speech", tts({ directText: "a".repeat(5000) }), {}, NONE)).toBeUndefined()
    expect(speechQuote("text-to-dialogue", { dialogue: [] }, {}, NONE)).toBeUndefined()
  })

  it("asks the prices of the unit row and the whole request of the model the estimate runs as — never another id", () => {
    const asked: string[] = []
    speechQuote("text-to-speech", tts({ provider: "elevenlabs", directText: "a".repeat(12_000) }), {}, (id) => { asked.push(id); return 2 })
    expect(asked).toEqual(["elevenlabs-turbo:per-100-chars", "elevenlabs-turbo:per-100-chars:120u"])
    expect(speechQuoteIds("text-to-speech", tts({ provider: "elevenlabs", directText: "a".repeat(12_000) }), {})).toEqual(asked)
    // An unknown text also reads the floor's price.
    expect(speechQuoteIds("text-to-speech", tts({ textSource: "connected" }), {})).toEqual(["elevenlabs-v4:per-100-chars", "elevenlabs-v4:per-100-chars:100u", "elevenlabs-v4:per-100-chars:8u"])
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

  it("speechPriceIdsFor names each speech node's unit row and whole-request price (on the model its estimate runs as), once", () => {
    const a = { id: "a", type: "text-to-speech", data: tts({ provider: "elevenlabs", directText: "x" }) }
    const b = { id: "b", type: "text-to-speech", data: tts({ textSource: "connected" }) }
    const d = { id: "d", type: "text-to-dialogue", data: { dialogue: [] } }
    const img = { id: "i", type: "generate-image", data: {} }
    expect(speechPriceIdsFor([a, b, d, img, b], [a, b, d, img], [])).toEqual([
      "elevenlabs-turbo:per-100-chars", "elevenlabs-turbo:per-100-chars:8u",
      "elevenlabs-v4:per-100-chars", "elevenlabs-v4:per-100-chars:100u", "elevenlabs-v4:per-100-chars:8u",
      "elevenlabs-dialogue:per-100-chars", "elevenlabs-dialogue:per-100-chars:8u",
    ])
  })
})
