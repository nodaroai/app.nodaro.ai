/**
 * Where an LLM call with a video or audio reference runs (`mediaLaneParams`):
 * pinned to the vendor's own API where this install can serve it there, else
 * its own lane with a floor of prompt tokens that catches an unread file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const env = vi.hoisted(() => ({ geminiKey: "gem" as string | undefined, metered: true }))
vi.mock("../config.js", () => ({
  config: {
    get GEMINI_API_KEY() {
      return env.geminiKey
    },
  },
  llmMeteredPricing: () => env.metered,
}))

const { MEDIA_NOT_READ_MESSAGE, isMediaNotRead, mediaLaneParams } = await import("../llm-media-lane.js")

beforeEach(() => {
  env.geminiKey = "gem"
  env.metered = true
})

const VIDEO = ["https://media.example/cut.mp4"]
const AUDIO = ["https://media.example/mix.mp3"]

describe("mediaLaneParams", () => {
  it("changes nothing for a call with no video and no audio", () => {
    expect(mediaLaneParams({ modelId: "gemini-3.8-flash", text: ["", "hello"] })).toEqual({})
    expect(mediaLaneParams({ modelId: "gemini-3.8-flash", videos: [], audios: [], text: ["", "hello"] })).toEqual({})
  })

  it.each([
    ["a video", { videos: VIDEO }],
    ["an audio clip", { audios: AUDIO }],
    ["both", { videos: VIDEO, audios: AUDIO }],
  ])("pins a Gemini call with %s to the vendor's own API", (_name, refs) => {
    expect(mediaLaneParams({ modelId: "gemini-3.8-flash", ...refs, text: ["", "describe it"] })).toEqual({ requireLane: "direct" })
  })

  it("keeps the lane and sets the floor where the vendor's API cannot serve: no Gemini key", () => {
    env.geminiKey = "  "
    // "describe it" is 11 characters: 1 token at 8 a token, plus one video.
    expect(mediaLaneParams({ modelId: "gemini-3.8-flash", videos: VIDEO, text: ["", "describe it"] })).toEqual({ minPromptTokens: 61 })
  })

  it("keeps the lane and sets the floor under tier pricing, which charges one lane's price", () => {
    env.metered = false
    expect(mediaLaneParams({ modelId: "gemini-3.8-flash", audios: AUDIO, text: ["", "describe it"] })).toEqual({ minPromptTokens: 21 })
  })

  it("never moves a run kept to the cheap lanes", () => {
    expect(mediaLaneParams({ modelId: "gemini-3.8-flash", videos: VIDEO, text: ["", ""], cheapLanesOnly: true })).toEqual({ minPromptTokens: 60 })
  })

  // A document never moves a call (decided 2026-11-17): a file-only call runs
  // on its own lane like a text call, with a floor for its pages on a model
  // whose lane can drop a document and still answer (Gemini 4 Hydrogen).
  it("never pins a call for its documents: a Hydrogen file-only call keeps its lane, with a floor of 450 tokens a page", () => {
    // "summarise" is 9 characters: 1 token; 5 pages at 450 a page.
    expect(mediaLaneParams({ modelId: "gemini-4-hydrogen", filePages: 5, text: ["", "summarise"] })).toEqual({ minPromptTokens: 2251 })
    expect(mediaLaneParams({ modelId: "gemini-4-hydrogen", filePages: 14, text: ["", ""], cheapLanesOnly: true })).toEqual({ minPromptTokens: 6_300 })
    env.geminiKey = ""
    expect(mediaLaneParams({ modelId: "gemini-4-hydrogen", filePages: 5, text: ["", "summarise"] })).toEqual({ minPromptTokens: 2251 })
  })

  it("the floor sits under what a read file reported, and above what a long prompt alone could reach", () => {
    // Measured 2026-11-17: 13,357 prompt tokens for 5 pages, 28,068 for 14; a read page is never below its 520 image tokens.
    expect(mediaLaneParams({ modelId: "gemini-4-hydrogen", filePages: 5, text: ["", ""] }).minPromptTokens).toBeLessThan(13_357)
    expect(mediaLaneParams({ modelId: "gemini-4-hydrogen", filePages: 14, text: ["", ""] }).minPromptTokens).toBeLessThan(28_068)
    expect(mediaLaneParams({ modelId: "gemini-4-hydrogen", filePages: 1, text: ["", ""] }).minPromptTokens).toBeLessThan(520)
    // A 3,000-character prompt is about 750 real tokens: with one unread page it stays under the floor (375 + 450).
    expect(mediaLaneParams({ modelId: "gemini-4-hydrogen", filePages: 1, text: ["", "x".repeat(3000)] }).minPromptTokens).toBe(825)
  })

  it("a call that also carries a video or an audio clip follows their rule: pinned where it can be, and the floor counts the pages too where it cannot", () => {
    expect(mediaLaneParams({ modelId: "gemini-4-hydrogen", videos: VIDEO, filePages: 5, text: ["", "summarise"] })).toEqual({ requireLane: "direct" })
    env.geminiKey = ""
    expect(mediaLaneParams({ modelId: "gemini-4-hydrogen", videos: VIDEO, filePages: 5, text: ["", "summarise"] })).toEqual({ minPromptTokens: 2311 })
  })

  it("a model with no page floor is untouched by its documents: no pin, no floor (GPT-6.1 Terra)", () => {
    expect(mediaLaneParams({ modelId: "gpt-6.1-terra", filePages: 40, text: ["", "summarise"] })).toEqual({})
    expect(mediaLaneParams({ modelId: "gpt-6.1-terra", filePages: 40, text: ["", "summarise"], cheapLanesOnly: true })).toEqual({})
    // No document and no media: nothing, on any model.
    expect(mediaLaneParams({ modelId: "gemini-4-hydrogen", filePages: 0, text: ["", "hi"] })).toEqual({})
  })

  it("a model with no vendor lane for media keeps its own, with the floor", () => {
    expect(mediaLaneParams({ modelId: "gpt-5.4", videos: VIDEO, text: ["", ""] })).toEqual({ minPromptTokens: 60 })
    expect(mediaLaneParams({ modelId: "no-such-model", videos: VIDEO, text: ["", ""] })).toEqual({ minPromptTokens: 60 })
  })

  it("the floor counts each reference and the text, low enough for what a dropped video reports", () => {
    const floor = (text: string[], videos: number, audios: number) => {
      env.geminiKey = undefined
      return mediaLaneParams({ modelId: "gemini-3.8-flash", videos: Array(videos).fill(VIDEO[0]), audios: Array(audios).fill(AUDIO[0]), text }).minPromptTokens
    }
    expect(floor(["", ""], 2, 1)).toBe(140)
    expect(floor(["a".repeat(80), "b".repeat(80)], 1, 0)).toBe(80)
    // Production, 2026-11-16: a 44-character prompt whose video was dropped reported 11 prompt tokens, a 330-character one 88.
    expect(floor(["", "x".repeat(44)], 1, 0)).toBeGreaterThan(11)
    expect(floor(["", "x".repeat(330)], 1, 0)).toBeGreaterThan(88)
    // The same 330-character prompt with its video read reported 2,810.
    expect(floor(["", "x".repeat(330)], 1, 0)).toBeLessThan(2810)
  })
})

describe("isMediaNotRead", () => {
  it("knows the client's refusal of an answer made without its media, and nothing else", () => {
    expect(isMediaNotRead(new Error("media_not_ingested:gemini-3.8-flash — provider reported 11 prompt tokens, below the 61 floor"))).toBe(true)
    expect(isMediaNotRead(new Error("LLM API call failed"))).toBe(false)
    expect(isMediaNotRead("media_not_ingested:x")).toBe(false)
    expect(MEDIA_NOT_READ_MESSAGE).not.toMatch(/provider|token/i)
  })
})
