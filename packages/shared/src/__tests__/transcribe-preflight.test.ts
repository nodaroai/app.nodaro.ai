import { describe, it, expect } from "vitest"
import { findWordlessTranscriptFeeds, transcribeWordTimestampsRefusal } from "../transcribe-preflight.js"

const n = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data })
const e = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({ source, sourceHandle, target, targetHandle })

describe("transcribeWordTimestampsRefusal", () => {
  it("null for the word-capable lanes and for an absent provider (node default = elevenlabs-stt)", () => {
    expect(transcribeWordTimestampsRefusal("elevenlabs-stt")).toBeNull()
    expect(transcribeWordTimestampsRefusal("incredibly-fast-whisper")).toBeNull()
    expect(transcribeWordTimestampsRefusal(undefined)).toBeNull()
    expect(transcribeWordTimestampsRefusal("")).toBeNull()
  })
  it("names the lane and the capable alternatives for whisper / an unknown lane", () => {
    const msg = transcribeWordTimestampsRefusal("whisper")!
    expect(msg).toContain('"whisper"')
    expect(msg).toContain("elevenlabs-stt")
    expect(msg).toContain("incredibly-fast-whisper")
    expect(transcribeWordTimestampsRefusal("made-up-lane")).toContain('"made-up-lane"')
  })
})

describe("findWordlessTranscriptFeeds", () => {
  it("flags whisper.json → add-captions.transcript", () => {
    const hits = findWordlessTranscriptFeeds(
      [n("t", "transcribe", { provider: "whisper" }), n("c", "add-captions")],
      [e("t", "json", "c", "transcript")],
    )
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ transcribeNodeId: "t", consumerNodeId: "c", provider: "whisper" })
    expect(hits[0]!.message).toContain("word timings")
  })
  it("follows the transcript THROUGH apply-edl (transcript in → json out)", () => {
    const hits = findWordlessTranscriptFeeds(
      [n("t", "transcribe", { provider: "whisper" }), n("x", "apply-edl"), n("c", "add-captions")],
      [e("t", "json", "x", "transcript"), e("x", "json", "c", "transcript")],
    )
    expect(hits.map((h) => h.consumerNodeId)).toEqual(["c"])
  })
  it("follows the transcript THROUGH speaker-view (transcript in → its own transcript out, decided 2026-10-08), never its EDL json", () => {
    const nodes = [n("t", "transcribe", { provider: "whisper" }), n("sv", "speaker-view"), n("c", "add-captions")]
    expect(findWordlessTranscriptFeeds(nodes, [e("t", "json", "sv", "transcript"), e("sv", "transcript", "c", "transcript")]).map((h) => h.consumerNodeId)).toEqual(["c"])
    expect(findWordlessTranscriptFeeds(nodes, [e("t", "json", "sv", "transcript"), e("sv", "json", "c", "transcript")])).toEqual([])
  })
  it("does NOT flag a word-capable lane, the text handle, or a non-caption consumer", () => {
    const nodes = [n("ok", "transcribe", { provider: "elevenlabs-stt" }), n("w", "transcribe", { provider: "whisper" }), n("c", "add-captions"), n("p", "edit-plan")]
    expect(findWordlessTranscriptFeeds(nodes, [e("ok", "json", "c", "transcript")])).toEqual([])
    expect(findWordlessTranscriptFeeds(nodes, [e("w", "text", "c", "in")])).toEqual([])
    expect(findWordlessTranscriptFeeds(nodes, [e("w", "json", "p", "transcript")])).toEqual([]) // edit-plan works off segments
  })
  it("ignores skipped nodes on either end, and survives an apply-edl cycle", () => {
    expect(findWordlessTranscriptFeeds(
      [n("t", "transcribe", { provider: "whisper", skipped: true }), n("c", "add-captions")],
      [e("t", "json", "c", "transcript")],
    )).toEqual([])
    expect(findWordlessTranscriptFeeds(
      [n("t", "transcribe", { provider: "whisper" }), n("c", "add-captions", { skipped: true })],
      [e("t", "json", "c", "transcript")],
    )).toEqual([])
    expect(findWordlessTranscriptFeeds(
      [n("t", "transcribe", { provider: "whisper" }), n("a", "apply-edl"), n("b", "apply-edl")],
      [e("t", "json", "a", "transcript"), e("a", "json", "b", "transcript"), e("b", "json", "a", "transcript")],
    )).toEqual([])
  })
})
