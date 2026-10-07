import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { renderConfirmDetail, groupedLabels } from "../render-confirm-detail"
import type { RunCreditLine } from "../types"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * U1 (R16 a, decided 2026-10-06): what the Render final and Update preview
 * confirms list beside the per-node lines — the render's executable ancestors
 * that keep their saved output ("Kept as is"), the nodes an Update preview
 * leaves for Render final, and which lines re-run before the render.
 */
// The stop rule is rolled out under a flag; every case here is with it on.
beforeEach(() => {
  window.__NODARO_RUNTIME__ = { previewStopRule: true }
})
afterEach(() => {
  delete window.__NODARO_RUNTIME__
})

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const wire = (source: string, target: string, targetHandle?: string): WorkflowEdge =>
  ({ id: `${source}->${target}`, source, target, ...(targetHandle ? { targetHandle } : {}) }) as WorkflowEdge
const line = (n: WorkflowNode, credits: number): RunCreditLine => ({
  nodeId: n.id,
  label: String((n.data as { label?: string }).label),
  quantity: { fanOut: 1, units: 1, unitKind: null },
  credits,
})

// M12: Recording → Transcribe → Silence → Tighten Plan → Apply Cut → Add Captions.
const REC = node("rec", "upload-video", { label: "Recording" })
const TR = node("tr", "transcribe", { label: "Transcribe" })
const SIL = node("sil", "silence-detect", { label: "Silence" })
const PLAN = node("plan", "edit-plan", { label: "Tighten Plan" })
const CUT = node("cut", "apply-edl", { label: "Apply Cut", quality: "final" })
const CAP = node("cap", "add-captions", { label: "Add Captions" })
const TIGHTEN = {
  nodes: [CAP, CUT, PLAN, SIL, TR, REC], // canvas order is not run order
  edges: [wire("rec", "tr"), wire("rec", "sil"), wire("tr", "plan", "transcript"), wire("sil", "plan"), wire("plan", "cut", "edl"), wire("rec", "cut", "sources"), wire("cut", "cap")],
}

describe("renderConfirmDetail — Render final (M12)", () => {
  const detail = renderConfirmDetail("cut", "render-final", [CUT, CAP], [line(CAP, 50), line(CUT, 480)], TIGHTEN.nodes, TIGHTEN.edges)

  it("kept: the render's executable ancestors outside the run; an upload is not listed", () => {
    // Graph order (what feeds what), ties broken by canvas order.
    expect(detail.kept).toEqual(["Silence", "Transcribe", "Tighten Plan"])
    expect(detail.kept).not.toContain("Recording")
  })

  it("lines run in graph order: the render, then what follows it", () => {
    expect(detail.lines.map((l) => l.nodeId)).toEqual(["cut", "cap"])
  })

  it("the render's line carries its quality; nothing re-runs first", () => {
    expect(detail.lines.find((l) => l.nodeId === "cut")!.renderQuality).toBe("final")
    expect(detail.lines.find((l) => l.nodeId === "cap")!.renderQuality).toBeUndefined()
    expect(detail.lines.some((l) => l.rerunsFirst)).toBe(false)
  })

  it("gated is empty for Render final", () => {
    expect(detail.gated).toEqual([])
  })

  it("the lines keep their credits: the total stays the sum of the lines", () => {
    expect(detail.lines.reduce((s, l) => s + l.credits, 0)).toBe(530)
  })
})

// M13: three cameras, each transcribed, through Camera Switch.
describe("renderConfirmDetail — multicam (M13)", () => {
  const cams = [1, 2, 3].map((i) => node(`v${i}`, "upload-video", { label: `Camera ${i}` }))
  const trs = [1, 2, 3].map((i) => node(`t${i}`, "transcribe", { label: "Transcribe" }))
  const CAM = node("cam", "camera-switch", { label: "Camera Switch" })
  const cut = node("cut", "apply-edl", { label: "Apply Cut", quality: "proxy" })
  const nodes = [...cams, ...trs, PLAN, CAM, cut, CAP]
  const edges = [
    ...[1, 2, 3].map((i) => wire(`v${i}`, `t${i}`)),
    ...[1, 2, 3].map((i) => wire(`t${i}`, "plan", "transcript")),
    wire("plan", "cam", "edl"), wire("cam", "cut", "edl"), wire("cut", "cap"),
  ]

  it("Camera Switch re-runs first, ahead of the render; repeated labels stay one per node (the dialog groups them after translating)", () => {
    const d = renderConfirmDetail("cut", "render-final", [cut, CAM, CAP], [line(CAP, 50), line(cut, 480), line(CAM, 10)], nodes, edges)
    expect(d.lines.map((l) => l.nodeId)).toEqual(["cam", "cut", "cap"])
    expect(d.lines.find((l) => l.nodeId === "cam")!.rerunsFirst).toBe(true)
    expect(d.lines.find((l) => l.nodeId === "cut")!.rerunsFirst).toBeFalsy()
    expect(d.kept).toEqual(["Transcribe", "Transcribe", "Transcribe", "Tighten Plan"])
  })

  it("Update preview (M15): what the preview gates waits for Render final, and has no line", () => {
    const d = renderConfirmDetail("cut", "update-preview", [cut, CAM, CAP], [line(cut, 48), line(CAM, 10)], nodes, edges)
    expect(d.gated).toEqual(["Add Captions"])
    expect(d.lines.map((l) => l.nodeId)).toEqual(["cam", "cut"])
    expect(d.lines.find((l) => l.nodeId === "cut")!.renderQuality).toBe("proxy")
  })
})

// Round 2 (decided 2026-10-06): a second render still set to Preview after this
// one stops the Render final there. The confirm names what it holds back: those
// nodes wait for their own Render final.
describe("renderConfirmDetail — another Preview render after this one", () => {
  const CUT2 = node("cut2", "apply-edl", { label: "Render Clips", quality: "proxy" })
  const PACK = node("pack", "edit-plan", { label: "Clip Pack" })
  const POST = node("post", "add-captions", { label: "Caption Clips" })
  const nodes = [...TIGHTEN.nodes, POST, PACK, CUT2]
  const edges = [...TIGHTEN.edges, wire("cap", "cut2", "sources"), wire("cut2", "pack"), wire("pack", "post")]
  // The run set holds them all; the estimate (stop rule) leaves out what the second render gates.
  const exec = [CUT, CAP, CUT2, PACK, POST]
  const lines = [line(CUT, 480), line(CAP, 50), line(CUT2, 12)]

  it("Render final: the nodes behind the second Preview render wait for its own Render final, in graph order", () => {
    const d = renderConfirmDetail("cut", "render-final", exec, lines, nodes, edges)
    expect(d.waits).toEqual(["Clip Pack", "Caption Clips"])
    expect(d.lines.map((l) => l.nodeId)).toEqual(["cut", "cap", "cut2"])
    expect(d.gated).toEqual([])
  })

  it("none when nothing after the render is held back", () => {
    const d = renderConfirmDetail("cut", "render-final", [CUT, CAP], [line(CUT, 480), line(CAP, 50)], TIGHTEN.nodes, TIGHTEN.edges)
    expect(d.waits).toEqual([])
  })

  // Decided 2026-10-06: Update preview names them on the same separate line.
  // A Render final of this render would run up to the second render (it runs
  // as a Preview), so those wait for THIS Render final; what the second render
  // holds back waits for its own.
  it("Update preview: what only this render's Render final runs is gated; what the second Preview render holds back waits for its own", () => {
    const d = renderConfirmDetail("cut", "update-preview", exec, [line(CUT, 48)], nodes, edges)
    expect(d.gated).toEqual(["Add Captions", "Render Clips"])
    expect(d.waits).toEqual(["Clip Pack", "Caption Clips"])
  })

  it("Update preview: a second render set to Final holds nothing back, so everything waits for this Render final", () => {
    const final2 = node("cut2", "apply-edl", { label: "Render Clips", quality: "final" })
    const all = nodes.map((n) => (n.id === "cut2" ? final2 : n))
    const d = renderConfirmDetail("cut", "update-preview", [CUT, CAP, final2, PACK, POST], [line(CUT, 48)], all, edges)
    expect(d.waits).toEqual([])
    expect(d.gated).toEqual(["Add Captions", "Render Clips", "Clip Pack", "Caption Clips"])
  })

  it("Update preview with no second render: nothing waits for another render", () => {
    const proxy = node("cut", "apply-edl", { label: "Apply Cut", quality: "proxy" })
    const all = TIGHTEN.nodes.map((n) => (n.id === "cut" ? proxy : n))
    const d = renderConfirmDetail("cut", "update-preview", [proxy, CAP], [line(proxy, 48)], all, TIGHTEN.edges)
    expect(d.gated).toEqual(["Add Captions"])
    expect(d.waits).toEqual([])
  })
})

describe("renderConfirmDetail — edge cases", () => {
  it("a render with no quality set renders the final", () => {
    const bare = node("cut", "apply-edl", { label: "Apply Cut" })
    const d = renderConfirmDetail("cut", "render-final", [bare], [line(bare, 10)], [bare], [])
    expect(d.lines[0]!.renderQuality).toBe("final")
  })

  it("a skipped ancestor keeps its output too", () => {
    const skipped = node("tr", "transcribe", { label: "Transcribe", skipped: true })
    const d = renderConfirmDetail("cut", "render-final", [CUT], [line(CUT, 10)], [skipped, CUT], [wire("tr", "cut", "edl")])
    expect(d.kept).toEqual(["Transcribe"])
  })
})

describe("groupedLabels", () => {
  it("keeps first-seen order and counts repeats", () => {
    expect(groupedLabels(["A", "B", "A", "A"])).toEqual(["A ×3", "B"])
  })
})
