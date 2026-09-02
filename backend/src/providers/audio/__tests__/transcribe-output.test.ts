import { describe, it, expect } from "vitest"
import { mapWhisperOutput, mapFastWhisperOutput } from "../transcribe-output.js"

describe("mapWhisperOutput", () => {
  it("maps openai/whisper output to the handler's output_data shape", () => {
    const out = mapWhisperOutput(
      {
        transcription: "hello world",
        detected_language: "english",
        segments: [{ start: 0, end: 1.5, text: "hello world" }],
      } as never,
      {},
    )
    expect(out).toEqual({
      text: "hello world",
      language: "english",
      segments: [{ start: 0, end: 1.5, text: "hello world" }],
    })
  })

  it("falls back to 'unknown' language and an empty transcript", () => {
    expect(mapWhisperOutput({} as never, {})).toEqual({ text: "", language: "unknown" })
  })
})

describe("mapFastWhisperOutput", () => {
  it("maps chunk timestamps to segments and honours an explicit language", () => {
    const out = mapFastWhisperOutput(
      { text: "hi", chunks: [{ timestamp: [0, 2], text: "hi" }] } as never,
      { language: "he" },
    )
    expect(out.text).toBe("hi")
    expect(out.language).toBe("he")
    expect(out.segments).toEqual([{ start: 0, end: 2, text: "hi" }])
  })
})
