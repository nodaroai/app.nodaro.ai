/**
 * text-to-dialogue gains a `json` output handle carrying the Transcript the
 * worker wrote to output_data.transcript. DAG parity with the canvas: the json
 * edge resolves the stringified transcript, the audio handle (and a no-handle
 * read) keeps resolving the audio URL unchanged, and a skipped node's saved
 * data hydrates both — mirror of transcribe-json-handle.test.ts.
 */
import { describe, it, expect } from "vitest"
import type { Transcript } from "@nodaro/shared"
import { getPrimaryOutput, extractSavedNodeOutput, buildNodeOutputFromJobData } from "../output-extractor.js"
import { resolveNodeInputs } from "../input-resolver.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

const AUDIO = "https://cdn.example.com/dialogue.mp3"
const transcript: Transcript = {
  version: 1,
  words: [{ text: "Hi", startMs: 0, endMs: 200, speaker: "Rachel" }, { text: "Hello.", startMs: 300, endMs: 900, speaker: "George" }],
  segments: [{ startMs: 0, endMs: 200, text: "Hi", speaker: "Rachel" }, { startMs: 300, endMs: 900, text: "Hello.", speaker: "George" }],
}

describe("text-to-dialogue — output_data → NodeOutput", () => {
  it("carries the transcript on output.json beside the audio", () => {
    const out = buildNodeOutputFromJobData({ audioUrl: AUDIO, transcript }, "text-to-dialogue")
    expect(out.audioUrl).toBe(AUDIO)
    expect(out.json).toEqual(transcript)
  })

  it("a job without timings has no json (a model without them, or an older cloud)", () => {
    const out = buildNodeOutputFromJobData({ audioUrl: AUDIO }, "text-to-dialogue")
    expect(out.audioUrl).toBe(AUDIO)
    expect(out.json).toBeUndefined()
  })
})

describe("text-to-dialogue — getPrimaryOutput", () => {
  const live = { audioUrl: AUDIO, json: transcript }
  it("json handle → the stringified transcript", () => {
    expect(getPrimaryOutput(live, "text-to-dialogue", "json")).toBe(JSON.stringify(transcript))
  })
  it("audio handle and no handle → the audio URL, unchanged", () => {
    expect(getPrimaryOutput(live, "text-to-dialogue", "audio")).toBe(AUDIO)
    expect(getPrimaryOutput(live, "text-to-dialogue", undefined)).toBe(AUDIO)
  })
  it("json handle with no transcript → undefined (never the audio URL)", () => {
    expect(getPrimaryOutput({ audioUrl: AUDIO }, "text-to-dialogue", "json")).toBeUndefined()
  })
})

describe("text-to-dialogue — saved node data (skipped / run from here)", () => {
  const saved = (data: Record<string, unknown>): SimpleNode => ({ id: "D", type: "text-to-dialogue", data: { label: "Dialogue", ...data } })

  it("exposes the ACTIVE result's url and transcript", () => {
    const other: Transcript = { version: 1, words: [{ text: "second", startMs: 0, endMs: 100 }] }
    const out = extractSavedNodeOutput(saved({
      generatedAudioUrl: "https://cdn.example.com/second.mp3",
      generatedJson: other,
      generatedResults: [
        { url: "https://cdn.example.com/second.mp3", jobId: "j2", timestamp: "t2", transcript: other },
        { url: AUDIO, jobId: "j1", timestamp: "t1", transcript },
      ],
      activeResultIndex: 1,
    }))
    expect(out?.audioUrl).toBe(AUDIO)
    expect(out?.json).toEqual(transcript)
  })

  it("a result without a transcript hydrates the audio alone", () => {
    const out = extractSavedNodeOutput(saved({ generatedAudioUrl: AUDIO, generatedResults: [{ url: AUDIO, jobId: "j1", timestamp: "t" }], activeResultIndex: 0 }))
    expect(out).toEqual({ audioUrl: AUDIO })
  })
})

describe("text-to-dialogue json → add-captions transcript (server input resolver)", () => {
  const dialogue: SimpleNode = { id: "D", type: "text-to-dialogue", data: { label: "Dialogue" } }
  const captions: SimpleNode = { id: "C", type: "add-captions", data: { label: "Captions" } }
  const video: SimpleNode = { id: "V", type: "upload-video", data: { label: "Video", videoUrl: "https://cdn.example.com/in.mp4" } }
  const edges: SimpleEdge[] = [
    { id: "e1", source: "V", target: "C", sourceHandle: "video", targetHandle: "in" },
    { id: "e2", source: "D", target: "C", sourceHandle: "json", targetHandle: "transcript" },
  ]
  const states = (output: Record<string, unknown>): Record<string, NodeExecutionState> => ({
    D: { status: "completed", output } as NodeExecutionState,
    V: { status: "completed", output: { videoUrl: "https://cdn.example.com/in.mp4" } } as NodeExecutionState,
  })

  it("with timings: inputs.transcript is the stringified Transcript and the audio never lands in audioUrl", () => {
    const inputs = resolveNodeInputs(captions, edges, states({ audioUrl: AUDIO, json: transcript }), [dialogue, captions, video])
    expect(inputs.transcript).toBe(JSON.stringify(transcript))
    expect(inputs.audioUrl).toBeUndefined()
    expect(inputs.videoUrl).toBe("https://cdn.example.com/in.mp4")
  })

  it("without timings: inputs.transcript is undefined, so Add Captions auto-transcribes as today", () => {
    const inputs = resolveNodeInputs(captions, edges, states({ audioUrl: AUDIO }), [dialogue, captions, video])
    expect(inputs.transcript).toBeUndefined()
    expect(inputs.audioUrl).toBeUndefined()
  })
})
