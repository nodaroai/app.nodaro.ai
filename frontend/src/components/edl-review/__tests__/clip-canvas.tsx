/**
 * The canvas and helpers the Clip Pack inspector's tests mount it on: an Edit
 * Plan in Clips mode with four clips, the Apply EDL render its `edl` wire feeds
 * and a Caption node after the render, written straight into the workflow
 * store (the Tighten canvas of `review-canvas.ts`'s sibling).
 */
import { render } from "@testing-library/react"
import { vi } from "vitest"
import { planClipKeyAt, renderPlanPath, renderReadBasis, type RenderGraphEdge } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyEdlRenderSettings, resolveApplyEdlRenders } from "@/lib/apply-edl-render-input"
import { clipRenderBases } from "@/lib/edl-review/build-clip-cards"
import { ClipInspector } from "../clip-pack/clip-inspector"

const SOURCES = [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }]
/** Clip i: 60 s from i × 100 s, one segment. */
export const clip = (i: number) => ({
  version: 1,
  clock: "master",
  sources: SOURCES,
  segments: [{ id: `c${i}`, inMs: i * 100_000, outMs: i * 100_000 + 60_000, video: "cam" }],
  dropped: [],
  meta: { title: `Clip ${i + 1}`, hook: `Hook ${i + 1}` },
})
export const CLIPS = Array.from({ length: 4 }, (_, i) => clip(i))
export const keyOf = (row: number, plan: readonly unknown[] = CLIPS) => planClipKeyAt(plan, row)!

const at = { x: 0, y: 0 }
const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: at, data })
const edge = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string, data?: Record<string, unknown>) =>
  ({ id, source, sourceHandle, target, targetHandle, ...(data ? { data } : {}) })

export interface ClipCanvasOptions {
  readonly plan?: unknown
  readonly planData?: Record<string, unknown>
  readonly cut?: Record<string, unknown>
  /** Data on the wire from the plan to the render (a range selector). */
  readonly wire?: Record<string, unknown>
  readonly caption?: boolean
  readonly readOnly?: boolean
  /** The render node's type (a render-node registry id); Apply EDL by default. */
  readonly renderType?: string
}

export function loadClipCanvas(opts: ClipCanvasOptions = {}): void {
  const nodes = [
    node("plan", "edit-plan", { label: "Find Clips", mode: "clips", generatedJson: opts.plan ?? CLIPS, ...opts.planData }),
    node("cut", opts.renderType ?? "apply-edl", { label: "Render Clip", quality: "final", ...opts.cut }),
    ...(opts.caption === false ? [] : [node("cap", "add-captions", { label: "Caption Clip" })]),
  ]
  const edges = [
    edge("e", "plan", "edl", "cut", "edl", { outputMode: "each", ...opts.wire }),
    ...(opts.caption === false ? [] : [edge("e2", "cut", "video", "cap", "video", { outputMode: "each" })]),
  ]
  useWorkflowStore.setState({ nodes: nodes as never, edges: edges as never, isReadOnly: !!opts.readOnly, workflowId: null })
}

export const planNodeData = () => useWorkflowStore.getState().nodes.find((n) => n.id === "plan")!.data as Record<string, unknown>
export const renderNodeData = () => useWorkflowStore.getState().nodes.find((n) => n.id === "cut")!.data as Record<string, unknown>

export function patchNode(id: string, data: Record<string, unknown>): void {
  useWorkflowStore.setState({ nodes: useWorkflowStore.getState().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)) as never })
}

/** The settings basis each clip's render would stamp now, as the inspector reads it. */
export function basisNow(): string {
  const { nodes, edges } = useWorkflowStore.getState()
  const cut = nodes.find((n) => n.id === "cut")!
  const hops = renderPlanPath("cut", nodes, edges as unknown as RenderGraphEdge[])!.hops
  const bases = clipRenderBases(resolveApplyEdlRenders(cut, nodes, edges), applyEdlRenderSettings(cut.data as Record<string, unknown>), (nodes.find((n) => n.id === "plan")!.data as { generatedJson: unknown }).generatedJson, hops)
  return [...bases.values()][0]!
}

/** A take of clip `row` stamped as the engines stamp it, current against the plan unless overridden. */
export function take(row: number, quality: "proxy" | "final", extra: Record<string, unknown> = {}, plan: readonly unknown[] = CLIPS) {
  return {
    url: `https://cdn.test/${quality}-${row}.mp4`,
    jobId: `job-${quality}-${row}`,
    thumbnailUrl: `https://cdn.test/thumb-${row}.jpg`,
    quality,
    clipKey: keyOf(row, plan),
    planBasis: renderReadBasis(plan[row]),
    renderBasis: basisNow(),
    ...extra,
  }
}

export function mountClipInspector(renderId = "cut") {
  const onClose = vi.fn()
  const view = render(<ClipInspector open renderId={renderId} onClose={onClose} />)
  return { ...view, onClose }
}
