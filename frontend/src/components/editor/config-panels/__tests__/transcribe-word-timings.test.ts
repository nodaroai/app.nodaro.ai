// @vitest-environment node
import { describe, it, expect } from "vitest"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { wordlessTranscriptWarning } from "../transcribe-word-timings"

/**
 * The Transcribe panel's inline warning: a whisper transcript feeding Add
 * Captions can only end as a paid transcription plus a failed captions node,
 * and the panel is the last place the user can fix it for free. The warning is
 * scoped to the node whose panel is open — a sibling Transcribe node's broken
 * chain must not light up this one.
 */
const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle, targetHandle }) as unknown as WorkflowEdge

describe("wordlessTranscriptWarning", () => {
  it("warns when this node's whisper transcript reaches add-captions", () => {
    const msg = wordlessTranscriptWarning(
      "t1",
      [node("t1", "transcribe", { provider: "whisper" }), node("c1", "add-captions")],
      [edge("t1", "json", "c1", "transcript")],
    )
    // The helper names the offending ENGINE; the panel renders the localized
    // sentence (audiocfg.wordlessTranscriptWarning) — no English leaks into he.
    expect(msg).toEqual({ engine: "whisper" })
  })

  it("follows the chain through apply-edl, which re-emits the transcript", () => {
    expect(
      wordlessTranscriptWarning(
        "t1",
        [
          node("t1", "transcribe", { provider: "whisper" }),
          node("e1", "apply-edl"),
          node("c1", "add-captions"),
        ],
        [edge("t1", "json", "e1", "transcript"), edge("e1", "json", "c1", "transcript")],
      ),
    ).toEqual({ engine: "whisper" })
  })

  it("stays silent for a word-capable lane", () => {
    expect(
      wordlessTranscriptWarning(
        "t1",
        [node("t1", "transcribe", { provider: "elevenlabs-stt" }), node("c1", "add-captions")],
        [edge("t1", "json", "c1", "transcript")],
      ),
    ).toBeNull()
  })

  it("stays silent when the transcript feeds no captions node", () => {
    expect(
      wordlessTranscriptWarning(
        "t1",
        [node("t1", "transcribe", { provider: "whisper" }), node("p1", "preview")],
        [edge("t1", "json", "p1", "in")],
      ),
    ).toBeNull()
  })

  it("is scoped to this node — a sibling's broken chain doesn't light it up", () => {
    const nodes = [
      node("t1", "transcribe", { provider: "elevenlabs-stt" }),
      node("t2", "transcribe", { provider: "whisper" }),
      node("c1", "add-captions"),
    ]
    const edges = [edge("t2", "json", "c1", "transcript")]
    expect(wordlessTranscriptWarning("t1", nodes, edges)).toBeNull()
    expect(wordlessTranscriptWarning("t2", nodes, edges)).toEqual({ engine: "whisper" })
  })

  it("returns null with no node id and tolerates an absent edge list", () => {
    const nodes = [node("t1", "transcribe", { provider: "whisper" }), node("c1", "add-captions")]
    expect(wordlessTranscriptWarning(undefined, nodes, [])).toBeNull()
    expect(wordlessTranscriptWarning("t1", nodes, undefined)).toBeNull()
  })
})
