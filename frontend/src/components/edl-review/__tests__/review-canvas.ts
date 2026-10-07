/**
 * The canvas the review inspector is mounted on: a Transcribe node, the Edit
 * Plan (Tighten) it feeds and the Apply Cut render the plan feeds, written
 * straight into the workflow store. Free of the test runner, so the
 * real-browser harness (playwright/perf) loads the same canvas the jsdom tests
 * do.
 */
import { useWorkflowStore } from "@/hooks/use-workflow-store"

export const PLAN = {
  version: 1,
  clock: "master",
  sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
  segments: [
    { id: "s0", inMs: 0, outMs: 4000, video: "cam" },
    { id: "s1", inMs: 5000, outMs: 9000, video: "cam" },
  ],
  dropped: [{ inMs: 4000, outMs: 5000, reason: "filler" }],
}
// Words 0..4: So the thing [um] | is — "um" is the filler the plan cut.
export const TRANSCRIPT = {
  version: 1,
  words: [
    { text: "So", startMs: 100, endMs: 400, speaker: "A" },
    { text: "the", startMs: 500, endMs: 800, speaker: "A" },
    { text: "thing", startMs: 900, endMs: 1300, speaker: "A" },
    { text: "um", startMs: 4200, endMs: 4600, speaker: "A" },
    { text: "is", startMs: 5100, endMs: 5400, speaker: "B" },
  ],
}

const at = { x: 0, y: 0 }
const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: at, data })

export interface CanvasOptions {
  readonly plan?: unknown
  readonly transcript?: unknown
  readonly wired?: { readonly transcript?: boolean; readonly plan?: boolean }
  readonly cut?: Record<string, unknown>
  readonly readOnly?: boolean
  readonly extraRender?: boolean
}

export function loadCanvas(opts: CanvasOptions = {}): void {
  const nodes = [
    node("tr", "transcribe", { label: "Transcribe", generatedJson: opts.transcript ?? TRANSCRIPT }),
    node("plan", "edit-plan", { label: "Tighten Plan", mode: "tighten", generatedJson: opts.plan ?? PLAN }),
    node("cut", "apply-edl", { label: "Apply Cut", quality: "proxy", ...opts.cut }),
    ...(opts.extraRender ? [node("cut2", "apply-edl", { label: "Audio Master", output: "audio" })] : []),
  ]
  const edges = [
    ...(opts.wired?.transcript === false ? [] : [{ id: "t", source: "tr", sourceHandle: "json", target: "plan", targetHandle: "transcript" }]),
    ...(opts.wired?.plan === false ? [] : [{ id: "e", source: "plan", sourceHandle: "edl", target: "cut", targetHandle: "edl" }]),
    ...(opts.extraRender ? [{ id: "e2", source: "plan", sourceHandle: "edl", target: "cut2", targetHandle: "edl" }] : []),
  ]
  useWorkflowStore.setState({ nodes: nodes as never, edges: edges as never, isReadOnly: !!opts.readOnly, workflowId: null })
}
