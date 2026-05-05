import { describe, it, expect } from "vitest"
import {
  fastWhisperWordsToCaptions,
  whisperWordsToCaptions,
  syntheticCaptionsFromText,
} from "../captions-mappers.js"

describe("fastWhisperWordsToCaptions", () => {
  it("maps incredibly-fast-whisper word chunks to Caption[]", () => {
    const out = fastWhisperWordsToCaptions({
      text: "hello world",
      chunks: [
        { text: "hello", timestamp: [0.0, 0.5] },
        { text: " world", timestamp: [0.5, 1.0] },
      ],
    })
    expect(out).toEqual([
      { text: "hello", startMs: 0, endMs: 500, timestampMs: 0, confidence: null },
      { text: " world", startMs: 500, endMs: 1000, timestampMs: 500, confidence: null },
    ])
  })

  it("returns [] when chunks missing", () => {
    expect(fastWhisperWordsToCaptions({ text: "hi", chunks: undefined })).toEqual([])
  })
})

describe("whisperWordsToCaptions", () => {
  it("flattens whisper segments[].words[] into Caption[]", () => {
    const out = whisperWordsToCaptions({
      transcription: "hi there",
      detected_language: "en",
      segments: [
        {
          id: 0,
          start: 0,
          end: 1,
          text: "hi there",
          words: [
            { word: "hi", start: 0.0, end: 0.4, probability: 0.99 },
            { word: " there", start: 0.4, end: 1.0, probability: 0.95 },
          ],
        },
      ],
    })
    expect(out).toEqual([
      { text: "hi", startMs: 0, endMs: 400, timestampMs: 0, confidence: 0.99 },
      { text: " there", startMs: 400, endMs: 1000, timestampMs: 400, confidence: 0.95 },
    ])
  })
})

describe("syntheticCaptionsFromText", () => {
  it("evenly slices a sentence's duration across whitespace-split words", () => {
    const out = syntheticCaptionsFromText("one two three", { startMs: 0, endMs: 3000 })
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ text: "one", startMs: 0, endMs: 1000, confidence: null })
    expect(out[2]).toMatchObject({ text: " three", startMs: 2000, endMs: 3000, confidence: null })
  })
})
