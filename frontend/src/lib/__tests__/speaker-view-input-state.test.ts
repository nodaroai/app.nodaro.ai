/**
 * The states of the Speaker View panel's INPUT section (U2b, SV24): no edit
 * wired, an upstream that has not run, a transcript whose speakers are not the
 * edit's, an edit the plugin cannot read speakers from, and the counts that say
 * how many speaker changes a Pan or a Crossfade can apply to (SV5, SV21 c).
 */
import { describe, it, expect } from "vitest"
import {
  speakerViewChangeCounts,
  speakerViewInputProblem,
  speakerViewInputState,
  speakerViewLabelMismatch,
} from "../speaker-view-input-state"
import { speakerViewContext } from "@nodaro/render-rules"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, target: string, targetHandle: string): WorkflowEdge => ({ id: `${source}-${target}-${targetHandle}`, source, target, targetHandle }) as unknown as WorkflowEdge
const src = (id: string) => ({ id, url: `https://x/${id}.mp4`, kind: "video" })
const MIC = { id: "mic", url: "https://x/mic.wav", kind: "audio", role: "master-audio" }
const seg = (id: string, inMs: number, outMs: number, video: string, speaker?: string) => ({ id, inMs, outMs, video, ...(speaker ? { speaker } : {}) })
const edl = (sources: unknown[], segments: unknown[]) => ({ version: 1, clock: "master", sources, segments })
const words = (...speakers: string[]) => ({ version: 1, words: speakers.map((speaker, i) => ({ text: "w", startMs: i * 10, endMs: i * 10 + 5, speaker })) })

const TWO = edl([MIC, src("a"), src("b")], [seg("s0", 0, 5000, "a", "Host"), seg("s1", 5000, 9000, "b", "Guest")])

describe("speakerViewInputState", () => {
  it("no wire and no inline edit: nothing to read", () => {
    expect(speakerViewInputState("sv", [node("sv", "speaker-view")], [])).toEqual({ kind: "no-edit" })
  })

  it("a wire whose producer has no saved output yet: names the producer that has not run", () => {
    const nodes = [node("plan", "edit-plan", { label: "Edit Plan" }), node("sv", "speaker-view")]
    expect(speakerViewInputState("sv", nodes, [edge("plan", "sv", "edl")])).toEqual({ kind: "not-run", producer: "Edit Plan" })
  })

  it("an unlabelled producer is named by its node type's label, never the raw type id", () => {
    const unlabelled = (type: string) => ({ id: "plan", type, position: { x: 0, y: 0 }, data: {} }) as unknown as WorkflowNode
    const blank = { id: "plan", type: "camera-switch", position: { x: 0, y: 0 }, data: { label: "  " } } as unknown as WorkflowNode
    expect(speakerViewInputState("sv", [unlabelled("edit-plan"), node("sv", "speaker-view")], [edge("plan", "sv", "edl")])).toEqual({ kind: "not-run", producer: "Edit Plan" })
    expect(speakerViewInputState("sv", [blank, node("sv", "speaker-view")], [edge("plan", "sv", "edl")])).toEqual({ kind: "not-run", producer: "Camera Switch" })
  })

  it("a producer with output is ready", () => {
    const nodes = [node("plan", "edit-plan", { generatedJson: TWO }), node("sv", "speaker-view")]
    expect(speakerViewInputState("sv", nodes, [edge("plan", "sv", "edl")])).toEqual({ kind: "ready" })
  })

  it("an inline edit is ready", () => {
    expect(speakerViewInputState("sv", [node("sv", "speaker-view", { edl: TWO })], [])).toEqual({ kind: "ready" })
  })

  it("a wire to a node that is gone reads as no edit", () => {
    expect(speakerViewInputState("sv", [node("sv", "speaker-view")], [edge("ghost", "sv", "edl")])).toEqual({ kind: "no-edit" })
  })
})

describe("speakerViewLabelMismatch", () => {
  it("is null when the transcript's labels are the edit's speakers", () => {
    expect(speakerViewLabelMismatch([TWO], words("Host", "Guest"))).toBeNull()
  })

  it("is null when the transcript names more speakers than the edit shows", () => {
    expect(speakerViewLabelMismatch([TWO], words("Host", "Guest", "Producer"))).toBeNull()
  })

  it("names both sides when the edit's speakers are not in the transcript", () => {
    expect(speakerViewLabelMismatch([TWO], words("speaker_0", "speaker_1"))).toEqual({ labels: ["speaker_0", "speaker_1"], names: ["Host", "Guest"] })
  })

  it("has nothing to compare without a transcript, labels, or named segments", () => {
    expect(speakerViewLabelMismatch([TWO], undefined)).toBeNull()
    expect(speakerViewLabelMismatch([TWO], words())).toBeNull()
    expect(speakerViewLabelMismatch([edl([MIC, src("a")], [seg("s0", 0, 5000, "a")])], words("speaker_0"))).toBeNull()
  })

  it("reads a transcript given as JSON, and judges every clip of a pack", () => {
    expect(speakerViewLabelMismatch([TWO, TWO], JSON.stringify(words("x")))).toEqual({ labels: ["x"], names: ["Host", "Guest"] })
  })
})

describe("speakerViewInputProblem (SV24)", () => {
  const THREE_CAMS = [MIC, src("a"), src("b"), src("c")]
  const unnamed = edl(THREE_CAMS, [seg("s0", 0, 5000, "a"), seg("s1", 5000, 9000, "b")])

  it("two or more cameras and no speaker on any segment: wire Camera Switch", () => {
    expect(speakerViewInputProblem([unnamed], words("speaker_0", "speaker_1"), {})).toBe("wire-camera-switch")
  })

  it("a partly named edit with no transcript: wire a transcript", () => {
    const partly = edl(THREE_CAMS, [seg("s0", 0, 5000, "a", "Host"), seg("s1", 5000, 9000, "b")])
    expect(speakerViewInputProblem([partly], undefined, {})).toBe("no-transcript")
  })

  it("a partly named edit with a transcript that has no labels: no speaker labels", () => {
    const partly = edl(THREE_CAMS, [seg("s0", 0, 5000, "a", "Host"), seg("s1", 5000, 9000, "b")])
    expect(speakerViewInputProblem([partly], words(), {})).toBe("no-speaker-labels")
  })

  it("a fully named edit has none, whatever its transcript", () => {
    expect(speakerViewInputProblem([TWO], undefined, {})).toBeNull()
    expect(speakerViewInputProblem([TWO], words("speaker_0"), {})).toBeNull()
  })

  it("is null with nothing wired, and reports the first clip's problem in a pack", () => {
    expect(speakerViewInputProblem([], undefined, {})).toBeNull()
    expect(speakerViewInputProblem([TWO, unnamed], words("speaker_0", "speaker_1"), {})).toBe("wire-camera-switch")
  })
})

describe("speakerViewChangeCounts", () => {
  it("counts the changes Pan (one camera) and Crossfade (a clock jump) apply to", () => {
    const e = edl([MIC, src("a"), src("b")], [
      seg("s0", 0, 5000, "a", "Host"),
      seg("s1", 5000, 9000, "a", "Guest"), // same camera, contiguous
      seg("s2", 12000, 15000, "b", "Host"), // other camera, jump
      seg("s3", 15000, 18000, "b", "Guest"), // same camera, contiguous
    ])
    expect(speakerViewChangeCounts(speakerViewContext(e))).toEqual({ changes: 3, pan: 2, crossfade: 1 })
  })

  it("leaves out a change at a boundary that already carries its own crossfade (Edit Plan)", () => {
    const e = edl([MIC, src("a")], [
      seg("s0", 0, 5000, "a", "Host"),
      { ...seg("s1", 9000, 12000, "a", "Guest"), transition: { type: "crossfade", durationMs: 300 } },
      seg("s2", 14000, 17000, "a", "Host"),
    ])
    expect(speakerViewChangeCounts(speakerViewContext(e))).toEqual({ changes: 2, pan: 1, crossfade: 1 })
  })

  it("adds the clips of a pack", () => {
    const one = edl([MIC, src("a")], [seg("s0", 0, 5000, "a", "H"), seg("s1", 5000, 9000, "a", "G")])
    expect(speakerViewChangeCounts(speakerViewContext([one, one]))).toEqual({ changes: 2, pan: 2, crossfade: 0 })
  })

  it("is null when the changes cannot be counted from the edit, or there are none", () => {
    expect(speakerViewChangeCounts(undefined)).toBeNull()
    expect(speakerViewChangeCounts(speakerViewContext(edl([MIC, src("a")], [seg("s0", 0, 5000, "a"), seg("s1", 6000, 9000, "a")])))).toBeNull()
    expect(speakerViewChangeCounts(speakerViewContext(edl([MIC, src("a")], [seg("s0", 0, 5000, "a", "H"), seg("s1", 5000, 9000, "a", "H")])))).toBeNull()
  })
})
