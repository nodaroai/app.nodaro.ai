/**
 * The estimator reads the wire the way the run does: the run keeps ONE edge
 * into `prompt` (the last it routes), and a blank text is absent, so it falls
 * through to the other text. An estimate may over-quote, never under-quote.
 * (The editor's mirror is pinned to the same cases in
 * frontend/src/lib/__tests__/speech-estimate-wire.test.ts.)
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, speechLengthPricingEnabled: () => true }
})

import { getMaxTtsChars } from "@nodaro/shared"
import { speechEstimateChars, upstreamSpeechText } from "../speech-estimate.js"

const tts = (data: Record<string, unknown>) => ({ textSource: "direct", provider: "elevenlabs-v4", ...data })
const CAP = getMaxTtsChars("elevenlabs-v4")

describe("two edges into prompt", () => {
  const tts1 = { id: "t", type: "text-to-speech", data: tts({ textSource: "connected" }) }
  const short = { id: "a", type: "text-prompt", data: { text: "hi" } }
  const long = { id: "b", type: "text-prompt", data: { text: "x".repeat(2500) } }
  const edges = [
    { source: "a", target: "t", targetHandle: "prompt" },
    { source: "b", target: "t", targetHandle: "prompt" },
  ]

  it("are unknown, whichever order they come in: the first short literal must not price the node", () => {
    expect(upstreamSpeechText(tts1, [tts1, short, long], edges, {})).toEqual({ wireUnknown: true })
    expect(upstreamSpeechText(tts1, [tts1, short, long], [...edges].reverse(), {})).toEqual({ wireUnknown: true })
    // a null handle is the same input as `prompt`
    expect(upstreamSpeechText(tts1, [tts1, short, long], [edges[0]!, { source: "b", target: "t", targetHandle: null }], {})).toEqual({ wireUnknown: true })
    const ctx = upstreamSpeechText(tts1, [tts1, short, long], edges, {})
    expect(speechEstimateChars("text-to-speech", tts1.data, ctx)).toMatchObject({ exact: false, chars: CAP })
  })
})

describe("a blank text falls through to the other", () => {
  const direct = { id: "t", type: "text-to-speech", data: tts({ directText: "" }) }
  const text = { id: "s", type: "text-prompt", data: { text: "a".repeat(700) } }
  const edge = { source: "s", target: "t", targetHandle: "prompt" }

  it("a direct node with a blank text sends the wired Text node's text (exact)", () => {
    const ctx = upstreamSpeechText(direct, [direct, text], [edge], {})
    expect(ctx).toEqual({ upstreamText: "a".repeat(700) })
    expect(speechEstimateChars("text-to-speech", direct.data, ctx)).toMatchObject({ exact: true, chars: 700 })
  })

  it("a direct node with a blank text and a wire that cannot be read is unknown: the wire outranks the blank", () => {
    const llm = { id: "l", type: "llm-chat", data: {} }
    const ctx = upstreamSpeechText(direct, [direct, llm], [{ source: "l", target: "t", targetHandle: "prompt" }], {})
    expect(speechEstimateChars("text-to-speech", direct.data, ctx)).toMatchObject({ exact: false, chars: CAP })
  })

  it("a typed direct text is read even though a Text node is wired: the run prefers it", () => {
    const typed = { ...direct, data: tts({ directText: "b".repeat(300) }) }
    expect(speechEstimateChars("text-to-speech", typed.data, upstreamSpeechText(typed, [typed, text], [edge], {}))).toMatchObject({ exact: true, chars: 300 })
  })

  it("a connected node whose own text is an exposed input and whose wire is blank is priced at that input's limit; a present wire still wins", () => {
    const connected = { id: "t", type: "text-to-speech", data: tts({ textSource: "connected" }) }
    const blank = { id: "s", type: "text-prompt", data: { text: "" } }
    const own = upstreamSpeechText(connected, [connected, blank], [edge], { "t:directText": 400 })
    expect(own).toEqual({ exposed: true, upstreamText: "", textCap: 400 })
    expect(speechEstimateChars("text-to-speech", connected.data, own)).toMatchObject({ exact: false, chars: 400 })
    expect(speechEstimateChars("text-to-speech", connected.data, upstreamSpeechText(connected, [connected, text], [edge], { "t:directText": 400 }))).toMatchObject({ exact: true, chars: 700 })
  })

  it("a connected node with a blank wired Text node sends its own typed text", () => {
    const connected = { id: "t", type: "text-to-speech", data: tts({ textSource: "connected", directText: "c".repeat(250) }) }
    const blank = { id: "s", type: "text-prompt", data: { text: "   " } }
    const ctx = upstreamSpeechText(connected, [connected, blank], [edge], {})
    expect(speechEstimateChars("text-to-speech", connected.data, ctx)).toMatchObject({ exact: true, chars: 250 })
  })
})

describe("a limit under pre/post text", () => {
  it("is priced as the run sends it: the pre-text joins the input (the widest join), up to the model's cap", () => {
    const data = tts({ textSource: "connected", promptPrefix: "p".repeat(500) })
    expect(speechEstimateChars("text-to-speech", data, { textCap: 1000 })).toMatchObject({ exact: false, chars: 1501 })
    expect(speechEstimateChars("text-to-speech", { ...data, promptPrefix: undefined, promptSuffix: "s".repeat(500) }, { textCap: 9900 })).toMatchObject({ chars: CAP })
    // with no affix the limit is the ceiling, as before
    expect(speechEstimateChars("text-to-speech", tts({ textSource: "connected" }), { textCap: 1000 })).toMatchObject({ chars: 1000 })
    // a {Reference} in an affix has no readable length: the cap
    expect(speechEstimateChars("text-to-speech", tts({ textSource: "connected", promptPrefix: "{Tone} " }), { textCap: 1000 })).toMatchObject({ chars: CAP })
  })
})
