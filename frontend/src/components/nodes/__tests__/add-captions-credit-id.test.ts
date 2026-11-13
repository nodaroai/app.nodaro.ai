import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/**
 * The Add Captions node's own badge and hover Run pill quoted the generic
 * `ffmpeg` row (10) while every canvas run reserves 30 or 50 — a 5x under-quote
 * on the default node, and two prices for one node on one screen (the config
 * panel's Generate button already followed the renderer). The pill now reads the
 * SAME id `getModelIdentifier` gives the panel and the run estimate, so the two
 * cannot drift apart again.
 */

let storeState: { nodes: WorkflowNode[]; edges: WorkflowEdge[] } = { nodes: [], edges: [] }
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: <T,>(selector: (s: typeof storeState) => T) => selector(storeState),
}))

const { useAddCaptionsCreditId } = await import("../use-add-captions-credit-id")
const { getModelIdentifier } = await import("@/components/editor/config-panels/helpers")

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle: "json", targetHandle }) as unknown as WorkflowEdge

/** Renders the hook against a graph and returns the id it asks for, asserting
 *  on the way that the panel's estimator agrees with it for the same graph. */
function idFor(captions: WorkflowNode, edges: WorkflowEdge[] = [], others: WorkflowNode[] = []): string {
  storeState = { nodes: [captions, ...others], edges }
  const { result } = renderHook(() =>
    useAddCaptionsCreditId(captions.id, captions.data as Record<string, unknown>),
  )
  expect(result.current, "the badge and the panel must quote one row").toBe(
    getModelIdentifier(captions, edges, storeState.nodes),
  )
  return result.current
}

describe("useAddCaptionsCreditId", () => {
  beforeEach(() => {
    storeState = { nodes: [], edges: [] }
  })

  // The canvas node has no text field and only takes a video + a Transcript, so
  // the default node auto-transcribes: timed captions, Remotion, kinetic row.
  it("the default canvas node quotes the row its run reserves — never the ffmpeg row", () => {
    const id = idFor(node("ac", "add-captions", { style: "subtitle" }))
    expect(id).toBe("add-captions:kinetic")
    expect(id).not.toBe("ffmpeg")
  })

  it("a plain subtitle burning inline text stays on the cheap FFmpeg row", () => {
    expect(idFor(node("ac", "add-captions", { style: "subtitle", text: "Hello" }))).toBe("add-captions")
  })

  it("a styling lever moves it to the Remotion row", () => {
    expect(idFor(node("ac", "add-captions", { style: "subtitle", text: "Hello", positionY: 65 }))).toBe(
      "add-captions:kinetic",
    )
  })

  // Edge-aware: the wired source is what the run resolves, whatever the node
  // data says — the price has to follow the graph, not only the node.
  it("a Transcript wired into the transcript handle prices the Remotion row", () => {
    const captions = node("ac", "add-captions", { style: "subtitle", text: "Hello" })
    expect(idFor(captions, [edge("t1", "ac", "transcript")], [node("t1", "apply-edl")])).toBe(
      "add-captions:kinetic",
    )
  })

  it("a transcribe node wired in on the default handle prices the Remotion row", () => {
    const captions = node("ac", "add-captions", { style: "subtitle", text: "Hello" })
    expect(idFor(captions, [edge("t1", "ac", "in")], [node("t1", "transcribe")])).toBe("add-captions:kinetic")
  })

  it("an unrelated edge leaves the cheap row alone", () => {
    const captions = node("ac", "add-captions", { style: "subtitle", text: "Hello" })
    expect(idFor(captions, [edge("v1", "ac", "in")], [node("v1", "upload-video")])).toBe("add-captions")
  })
})

/**
 * Nemotron 3.5 Transcribe (decided 2026-11-13): a node that transcribes on it is
 * ONE charge, the render plus the video's started minutes — the badge and the
 * panel quote the per-minute id its run holds, at the length the graph knows,
 * else at 60 minutes; a node that transcribes nothing stays on the render's row.
 */
describe("useAddCaptionsCreditId — Nemotron 3.5 Transcribe", () => {
  const nemotron = (data: Record<string, unknown> = {}) =>
    node("ac", "add-captions", { style: "word-highlight", transcribeProvider: "nemotron-3-5-transcribe", ...data })

  beforeEach(() => {
    storeState = { nodes: [], edges: [] }
  })

  it("an unknown video length quotes the 60-minute id, never the render's row alone", () => {
    expect(idFor(nemotron())).toBe("add-captions:kinetic:nemotron:60m")
  })

  it("an uploaded video quotes its own started minutes (4:50 → 5)", () => {
    const video = node("v1", "upload-video", { url: "https://cdn.example/v.mp4", duration: 290 })
    expect(idFor(nemotron(), [edge("v1", "ac", "in")], [video])).toBe("add-captions:kinetic:nemotron:5m")
  })

  it("a node that transcribes nothing — its own captions, auto-transcribe off, a subtitle's text — is the render's row", () => {
    expect(idFor(nemotron({ captions: [{ text: "hi", startMs: 0, endMs: 1 }] }))).toBe("add-captions:kinetic")
    expect(idFor(nemotron({ autoTranscribe: false, text: "Hello" }))).toBe("add-captions:kinetic")
    expect(idFor(nemotron({ style: "subtitle", text: "Hello" }))).toBe("add-captions")
  })

  it("a Transcript or a transcribe node that returns words wired in replaces the transcription: the render's row", () => {
    expect(idFor(nemotron(), [edge("t1", "ac", "transcript")], [node("t1", "apply-edl")])).toBe("add-captions:kinetic")
    expect(idFor(nemotron(), [edge("t1", "ac", "in")], [node("t1", "transcribe")])).toBe("add-captions:kinetic")
    expect(idFor(nemotron(), [edge("t1", "ac", "in")], [node("t1", "transcribe", { provider: "incredibly-fast-whisper", wordTimestamps: true })])).toBe(
      "add-captions:kinetic",
    )
  })

  // The run hands the node a Transcribe node's words only when there are some: a wordless one leaves it
  // transcribing (its text is only a kinetic style's fallback), so the quote stays the dearer one.
  it("a transcribe node that returns no words does not: the per-minute id still", () => {
    expect(idFor(nemotron(), [edge("t1", "ac", "in")], [node("t1", "transcribe", { provider: "whisper" })])).toBe("add-captions:kinetic:nemotron:60m")
    expect(idFor(nemotron(), [edge("t1", "ac", "in")], [node("t1", "transcribe", { provider: "nemotron-3-5-transcribe", targetLanguage: "es" })])).toBe(
      "add-captions:kinetic:nemotron:60m",
    )
    // A lane that gives words only when asked: its text pip wired in, its json pip nowhere, not asked.
    const textPip = { ...edge("t1", "ac", "in"), sourceHandle: "text" } as WorkflowEdge
    expect(idFor(nemotron(), [textPip], [node("t1", "transcribe", { provider: "incredibly-fast-whisper" })])).toBe("add-captions:kinetic:nemotron:60m")
  })
})

/**
 * Structural: the card must ASK for that id. The defect was a hardcoded model id
 * in the card itself, which no behavioural test of the hook can see.
 */
describe("the Add Captions card prices itself on the row the run reserves", () => {
  const source = readFileSync(join(__dirname, "..", "add-captions-node.tsx"), "utf8")

  it("reads the renderer-following id, not a hardcoded model", () => {
    expect(source).toMatch(/useAddCaptionsCreditId\(/)
    expect(source).not.toMatch(/useModelCredits\(\s*"[a-z]/)
  })
})
