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
