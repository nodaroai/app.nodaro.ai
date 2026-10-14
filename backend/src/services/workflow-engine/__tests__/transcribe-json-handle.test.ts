import { describe, it, expect } from "vitest"
import { getPrimaryOutput, extractSavedNodeOutput } from "../output-extractor.js"
import { buildNodeRefMap } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"
import type { Transcript } from "@nodaro/shared/edl"

/**
 * transcribe gains a `json` output handle carrying a normalized `Transcript`
 * beside the existing `text` handle. DAG parity: on a SERVER run the `json`
 * edge must resolve the transcript (not the transcript's text or a URL), the
 * `text` handle and `{Label}` refs must keep resolving the plain text
 * unchanged, and the saved-node-data path must match the live path.
 */

const transcript: Transcript = {
  version: 1,
  language: "en",
  words: [
    { text: "hello", startMs: 0, endMs: 500 },
    { text: " world", startMs: 500, endMs: 1000 },
  ],
}
const other: Transcript = {
  version: 1,
  language: "en",
  words: [{ text: "second", startMs: 0, endMs: 300 }],
}

describe("transcribe json handle — getPrimaryOutput (live output_data)", () => {
  const live = { text: "hello world", json: transcript }

  it("routes the `json` handle to the stringified Transcript, not the text", () => {
    expect(getPrimaryOutput(live, "transcribe", "json")).toBe(JSON.stringify(transcript))
  })

  it("keeps the `text` handle on the plain transcript (unchanged)", () => {
    expect(getPrimaryOutput(live, "transcribe", "text")).toBe("hello world")
  })

  it("keeps a no-handle / {Label} default read on the plain text (unchanged)", () => {
    expect(getPrimaryOutput(live, "transcribe", undefined)).toBe("hello world")
  })

  it("returns undefined on the `json` handle when no transcript was produced", () => {
    expect(getPrimaryOutput({ text: "hello world" }, "transcribe", "json")).toBeUndefined()
  })
})

describe("transcribe json handle — extractSavedNodeOutput (saved node data)", () => {
  function saved(data: Record<string, unknown>): SimpleNode {
    return { id: "T", type: "transcribe", data: { label: "Transcribe", ...data } }
  }

  it("carries both the active result's transcript (json) and its text", () => {
    const node = saved({
      generatedText: "hello world",
      generatedJson: transcript,
      generatedResults: [{ text: "hello world", language: "en", jobId: "j1", timestamp: "t", transcript }],
      activeResultIndex: 0,
    })
    const out = extractSavedNodeOutput(node)
    expect(out?.text).toBe("hello world")
    expect(out?.json).toEqual(transcript)
    // And routing the saved output by handle matches the live path exactly.
    expect(getPrimaryOutput(out!, "transcribe", "json")).toBe(JSON.stringify(transcript))
    expect(getPrimaryOutput(out!, "transcribe", "text")).toBe("hello world")
  })

  it("follows the active result — switching results carries that result's transcript", () => {
    const node = saved({
      generatedText: "second",
      generatedJson: other, // bare = latest, but the active result wins
      generatedResults: [
        { text: "second", language: "en", jobId: "j2", timestamp: "t2", transcript: other },
        { text: "hello world", language: "en", jobId: "j1", timestamp: "t1", transcript },
      ],
      activeResultIndex: 1,
    })
    const out = extractSavedNodeOutput(node)
    expect(out?.json).toEqual(transcript)
    expect(out?.text).toBe("hello world")
  })

  it("falls back to the bare generatedJson when there is no per-result entry", () => {
    const node = saved({ generatedText: "hello world", generatedJson: transcript })
    const out = extractSavedNodeOutput(node)
    expect(out?.json).toEqual(transcript)
  })
})

describe("transcribe json handle — {Label} refs stay on text (buildNodeRefMap)", () => {
  const transcribeNode: SimpleNode = { id: "Transcribe", type: "transcribe", data: { label: "Transcribe" } }
  const consumer: SimpleNode = { id: "Prompt", type: "llm-chat", data: { label: "Prompt", userInput: "Say: {Transcribe}" } }
  const edges: SimpleEdge[] = [
    { id: "e", source: "Transcribe", target: "Prompt", sourceHandle: "text", targetHandle: "prompt" },
  ]

  it("resolves a {Transcribe} label to the plain text even when a transcript is present", () => {
    const nodeStates: Record<string, NodeExecutionState> = {
      Transcribe: { status: "completed", output: { text: "hello world", json: transcript } },
    }
    const map = buildNodeRefMap("Prompt", { nodes: [transcribeNode, consumer], edges, nodeStates })
    expect(map.get("transcribe")).toBe("hello world")
  })
})
