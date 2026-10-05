/**
 * What an Apply EDL node would render if it ran now — the input its render
 * rule judges (`applyEdlRendersValidity`): every render its Run would make, each
 * with the EDL it reads and the media its `sources` wires give it, and the
 * node's own settings. Read by the browser engine itself, the way its Run plans
 * and sends (`getListFanOutForNode` + `planFanOut`, then `resolveNodeInputs` on
 * each render's row; the server's input resolver, fan-out and DAG payload
 * builder mirror them), so the panel's badge judges exactly what the run would
 * send. Pinned against both engines by
 * `__tests__/apply-edl-render-rule-parity.test.ts`.
 */
import { planFanOut, withWiredSettings } from "@nodaro/shared"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { getListFanOutForNode, resolveNodeInputs } from "@/components/editor/workflow-editor/node-input-resolver"
import type { GraphEdge, GraphNode } from "@/lib/edit-plan-estimate"
import type { ApplyEdlRenderInput, ApplyEdlRenderSettings } from "@/lib/edl-validity"

const dataOf = (n: GraphNode): Record<string, unknown> => (n.data as Record<string, unknown> | undefined) ?? {}

/**
 * Every render a Run of an Apply EDL node makes now, in run order, as the
 * browser engine makes them (decided 2026-10-05: each combination of EDL and
 * Sources the engine pairs):
 *
 *  - The fan-out is the engine's own plan. Whatever list fans the render out —
 *    a plan's clips, a Camera Switch batch, a List's rows, a list transform,
 *    Generate Text's `items`, wired into EDL OR into Sources — gives one render
 *    per row it runs (a row the run skips is not a render); lists that share
 *    rows pair up row by row. Nothing fans out: one render.
 *  - Each render reads what `resolveNodeInputs` resolves on its row: the LAST
 *    `edl` wire that delivers a value (a wire from a producer holding nothing
 *    is skipped; an edge set to one item delivers that item; Camera Switch's
 *    transcript handle delivers the transcript), else the node's own EDL; and
 *    the `sources` wires' media in edge order, one slot per wire that delivers
 *    a value on that row (the overrides are POSITIONAL onto `EdlSource[i].url`,
 *    so a wire with nothing moves the next one up).
 */
export function resolveApplyEdlRenders(
  node: GraphNode,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): ApplyEdlRenderInput[] {
  const n = node as unknown as WorkflowNode
  const ns = nodes as unknown as WorkflowNode[]
  const es = edges as unknown as WorkflowEdge[]
  const plan = planFanOut(
    getListFanOutForNode(n, ns, es),
    n.type ?? "",
    withWiredSettings(n, ns, es).data as Record<string, unknown>,
  )
  const rows: Array<number | undefined> = plan ? plan.rows : [undefined]
  return rows.map((row) => {
    const inputs = resolveNodeInputs(n, ns, es, row)
    return {
      ...(row !== undefined ? { row } : {}),
      edl: inputs.edl ?? dataOf(node).edl,
      sources: inputs.sources ?? [],
    }
  })
}

const sameRender = (a: ApplyEdlRenderInput, b: ApplyEdlRenderInput): boolean =>
  a.row === b.row &&
  a.edl === b.edl &&
  a.sources.length === b.sources.length &&
  a.sources.every((url, i) => url === b.sources[i])

/** `prev` when `next` holds the same renders (a wired EDL is a string, an
 *  inline one the node's own object), else `next`: a store selector needs the
 *  same value back while nothing changed. */
export function stableApplyEdlRenders(
  prev: readonly ApplyEdlRenderInput[],
  next: readonly ApplyEdlRenderInput[],
): readonly ApplyEdlRenderInput[] {
  return prev.length === next.length && prev.every((r, i) => sameRender(r, next[i]!)) ? prev : next
}

/** The node's settings as the render reads them — the DAG payload builder's
 *  defaults: any `output` other than "audio" is a video render, and a missing
 *  crossfade is a hard cut. */
export function applyEdlRenderSettings(data: {
  readonly output?: unknown
  readonly crossfadeMs?: unknown
}): ApplyEdlRenderSettings {
  return {
    output: data.output === "audio" ? "audio" : "video",
    crossfadeMs: typeof data.crossfadeMs === "number" ? data.crossfadeMs : 0,
  }
}
