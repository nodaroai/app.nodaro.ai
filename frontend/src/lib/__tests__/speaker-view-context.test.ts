/**
 * What the canvas knows about the edit wired into a Speaker View node (SV10,
 * SV23): the saved upstream output, read ONE way for the panel, the strip, the
 * badge and the face. These pin the reader against the graphs it meets — an
 * Edit Plan straight in (a tighten plan, a clips plan), a Camera Switch (a
 * single run, a clips-mode batch, its transcript), an inline EDL.
 */
import { describe, it, expect } from "vitest"
import { speakerViewContextOf, speakerViewEdits, speakerViewTranscript } from "../speaker-view-context"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, target: string, targetHandle: string): WorkflowEdge => ({ id: `${source}-${target}-${targetHandle}`, source, target, targetHandle }) as unknown as WorkflowEdge

const src = (id: string) => ({ id, url: `https://x/${id}.mp4`, kind: "video" })
const seg = (id: string, inS: number, video: string, speaker: string) => ({ id, inMs: inS * 1000, outMs: (inS + 5) * 1000, video, speaker })
const TWO = { version: 1, clock: "master", sources: [src("a"), src("b")], segments: [seg("s0", 0, "a", "Host"), seg("s1", 5, "b", "Guest")] }
const THREE = { version: 1, clock: "master", sources: [src("a"), src("b"), src("c")], segments: [seg("s0", 0, "a", "H"), seg("s1", 5, "b", "G"), seg("s2", 10, "c", "P")] }
const WORDS = { version: 1, words: [{ text: "a", startMs: 0, endMs: 1, speaker: "speaker_0" }, { text: "b", startMs: 2, endMs: 3, speaker: "speaker_1" }] }

describe("speakerViewEdits", () => {
  it("reads an Edit Plan's tighten plan as one edit", () => {
    const nodes = [node("plan", "edit-plan", { generatedJson: TWO }), node("sv", "speaker-view")]
    expect(speakerViewEdits("sv", nodes, [edge("plan", "sv", "edl")])).toEqual([TWO])
  })

  it("reads an Edit Plan's clips plan as one edit per clip", () => {
    const nodes = [node("plan", "edit-plan", { generatedJson: [TWO, THREE] }), node("sv", "speaker-view")]
    expect(speakerViewEdits("sv", nodes, [edge("plan", "sv", "edl")])).toHaveLength(2)
  })

  it("reads a Camera Switch's single result, and its whole clips-mode batch (SV23)", () => {
    const single = [node("cs", "camera-switch", { generatedJson: { edl: TWO, transcript: WORDS } }), node("sv", "speaker-view")]
    expect(speakerViewEdits("sv", single, [edge("cs", "sv", "edl")])).toEqual([TWO])
    const batch = [node("cs", "camera-switch", { __listResults: [JSON.stringify(TWO), JSON.stringify(THREE)], generatedJson: { edl: TWO } }), node("sv", "speaker-view")]
    expect(speakerViewEdits("sv", batch, [edge("cs", "sv", "edl")])).toEqual([JSON.stringify(TWO), JSON.stringify(THREE)])
  })

  it("falls back to the node's own inline EDL when nothing is wired", () => {
    expect(speakerViewEdits("sv", [node("sv", "speaker-view", { edl: TWO })], [])).toEqual([TWO])
    expect(speakerViewEdits("sv", [node("sv", "speaker-view")], [])).toEqual([])
  })

  it("is empty while the upstream has not run", () => {
    expect(speakerViewEdits("sv", [node("plan", "edit-plan"), node("sv", "speaker-view")], [edge("plan", "sv", "edl")])).toEqual([])
  })

  it("keeps the LAST wire on the handle, as both engines do", () => {
    const nodes = [node("p1", "edit-plan", { generatedJson: TWO }), node("p2", "edit-plan", { generatedJson: THREE }), node("sv", "speaker-view")]
    expect(speakerViewEdits("sv", nodes, [edge("p1", "sv", "edl"), edge("p2", "sv", "edl")])).toEqual([THREE])
  })
})

describe("speakerViewTranscript", () => {
  it("reads a Transcribe's last result, else a Camera Switch's renamed transcript", () => {
    const tx = [node("tx", "transcribe", { generatedResults: [{ url: "", transcript: WORDS }], activeResultIndex: 0 }), node("sv", "speaker-view")]
    expect(speakerViewTranscript("sv", tx, [edge("tx", "sv", "transcript")])).toEqual(WORDS)
    const cs = [node("cs", "camera-switch", { generatedJson: { edl: TWO, transcript: WORDS } }), node("sv", "speaker-view")]
    expect(speakerViewTranscript("sv", cs, [edge("cs", "sv", "transcript")])).toEqual(WORDS)
  })
  it("is undefined with nothing wired", () => {
    expect(speakerViewTranscript("sv", [node("sv", "speaker-view")], [])).toBeUndefined()
  })
})

describe("speakerViewContextOf", () => {
  it("counts speakers and cameras of a Camera Switch pack, and is undefined before an edit is known", () => {
    const nodes = [node("cs", "camera-switch", { __listResults: [JSON.stringify(TWO), JSON.stringify(THREE)] }), node("sv", "speaker-view")]
    const ctx = speakerViewContextOf("sv", nodes, [edge("cs", "sv", "edl")])!
    expect(ctx.clips.map((c) => [c.speakerCount, c.cameras])).toEqual([[2, 2], [3, 3]])
    expect(speakerViewContextOf("sv", [node("sv", "speaker-view")], [])).toBeUndefined()
  })
  it("names the speakers from the wired transcript when the edit names none", () => {
    const unnamed = { ...TWO, segments: TWO.segments.map(({ speaker: _s, ...rest }) => rest) }
    const nodes = [node("plan", "edit-plan", { generatedJson: unnamed }), node("tx", "transcribe", { generatedResults: [{ url: "", transcript: WORDS }] }), node("sv", "speaker-view")]
    const ctx = speakerViewContextOf("sv", nodes, [edge("plan", "sv", "edl"), edge("tx", "sv", "transcript")])!
    expect(ctx.clips[0]!.speakers).toEqual(["speaker_0", "speaker_1"])
  })
})
