/**
 * What Render final and Update preview run (TA17 a, decided 2026-10-04):
 * `(desc(plan) ∩ anc(render)) ∪ desc(render)`, minus the plan.
 *
 * The plan is the Edit Plan behind the render's `edl` wire (`renderPlanPath`).
 * It never re-runs: its saved output, with the person's review applied
 * (`editPlanSavedOutput`), is what the run seeds. Everything between the plan
 * and the render re-runs — for Tighten and a single-camera Clip Pack that is
 * nothing, so the set is exactly "from the render node onward"; in multicam
 * Camera Switch re-runs first and restored spans get its cameras. With no plan
 * behind the render the set is the render onward.
 *
 * "Feeds" is the stop rule's own definition (`buildFeedMaps`: wires, Group
 * membership, field mappings), so the tail a Preview gated is exactly what a
 * Render final runs: nothing the preview held back is left unrun.
 *
 * A wire the render reads at rest (`RENDER_SAVED_INPUT_HANDLES`) is not
 * crossed on the way up: what feeds the render only through it keeps its
 * saved output. Speaker View's `tracks` is one — Render final reads the face
 * tracks Speaker Frames saved and never re-runs it (P3-20 (i), decided
 * 2026-10-06), even though Speaker Frames reads the same edit Camera Switch
 * rewrites: Preview and Final read the same paid tracks (P3-17).
 *
 * ONE home for every caller (decided 2026-10-06): the editor's Render final,
 * the agent route (`renderFinal` on POST /v1/workflows/:id/run, which an
 * agent's SDK `renderFinal` and MCP `render_final` send), the app runner's
 * Render final (POST /v1/app/:slug/runs/:runId/render-final — a caller never
 * names the nodes it runs) and the listing estimator's final part all read
 * this rule, so the set an agent or an app runs, and the set a listing prices,
 * is the set the editor runs. A guard test fails the build on a copy anywhere
 * else; both engines read one parity fixture.
 */
import { buildFeedMaps, type FeedEdge, type FeedNode } from "@nodaro/shared/workflow"
import { PREVIEW_RENDER_NODE_TYPES, renderPlanPath } from "@nodaro/shared/nodes"
import { descendantsOf } from "./graph-walk"

/** A node and a wire as the walk reads them: either engine's graph fits. */
export interface RenderFinalGraphNode {
  readonly id: string
  readonly type?: string | null
  readonly data?: unknown
  readonly parentId?: string | null
}
export interface RenderFinalGraphEdge {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
  readonly data?: unknown
}

/** Every node reached from `start` through `next`, `start` included. */
function reach(start: string, next: ReadonlyMap<string, ReadonlyArray<string>>): Set<string> {
  const seen = new Set<string>([start])
  const queue = [start]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const id of next.get(current) ?? []) {
      if (!seen.has(id)) {
        seen.add(id)
        queue.push(id)
      }
    }
  }
  return seen
}

/**
 * The render inputs a Render final reads AT REST, by render type: the saved
 * output on such a wire is the input, and the producer behind it is not
 * re-run for it (P3-20 (i): Speaker View's face tracks).
 */
export const RENDER_SAVED_INPUT_HANDLES: Readonly<Record<string, readonly string[]>> = {
  "speaker-view": ["tracks"],
}

/** Whether `edge` is a wire a render reads at rest (`RENDER_SAVED_INPUT_HANDLES`). */
function readsAtRest(edge: RenderFinalGraphEdge, typeOf: ReadonlyMap<string, string>): boolean {
  const handles = RENDER_SAVED_INPUT_HANDLES[typeOf.get(edge.target) ?? ""]
  return !!handles && typeof edge.targetHandle === "string" && handles.includes(edge.targetHandle)
}

/** The ids a Render final on `renderId` runs. Empty when the node is not on the graph. */
export function renderFinalRunSet(
  renderId: string,
  nodes: readonly RenderFinalGraphNode[],
  edges: readonly RenderFinalGraphEdge[],
): ReadonlySet<string> {
  if (!nodes.some((n) => n.id === renderId)) return new Set()
  const { children } = buildFeedMaps(nodes as readonly FeedNode[], edges as readonly FeedEdge[])
  const set = reach(renderId, children)
  const planId = renderPlanPath(renderId, nodes, edges)?.planId
  if (planId) {
    // Upward, a wire read at rest is not crossed: its producer keeps its saved output.
    const typeOf = new Map(nodes.map((n) => [n.id, n.type ?? ""] as const))
    const { parents } = buildFeedMaps(nodes as readonly FeedNode[], edges.filter((e) => !readsAtRest(e, typeOf)) as readonly FeedEdge[])
    const ancestors = reach(renderId, parents)
    for (const id of reach(planId, children)) if (ancestors.has(id)) set.add(id)
    set.delete(planId)
  }
  return set
}

/**
 * What a Render final of a use-case node (Tighten Episode, decided 2026-10-13)
 * runs: the node itself — it continues its own earlier run, rendering at
 * Final what that run held at Preview — and every node after it. Nothing
 * upstream re-runs: the outer graph has no plan of its own to re-cut. ONE set
 * for the editor's Render final and the app runner's, so the node a person
 * presses Render final on runs the same tail on both. Empty when the node is
 * not on the graph.
 */
export function usecaseFinalRunSet(
  nodeId: string,
  nodes: readonly RenderFinalGraphNode[],
  edges: readonly RenderFinalGraphEdge[],
): ReadonlySet<string> {
  if (!nodes.some((n) => n.id === nodeId)) return new Set()
  return new Set([nodeId, ...descendantsOf(nodeId, edges)])
}

/** The run a use-case node's Render final continues: the wrapper job of its Preview take, and the settings that run was built from. */
export interface UseCaseRenderFinalTarget {
  readonly jobId: string
  readonly settings?: Readonly<Record<string, unknown>>
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * What a use-case node's Render final continues, read off its state in a run
 * (an app run's, or the execution a final continues): the wrapper job of its
 * take when that take is ONE Preview (`quality: "proxy"`), with the settings
 * that run was built from (`useCaseSettings`, kept on the take) — a Render
 * final renders with the preview's settings, never the node's later ones.
 * Null for a take that is not a Preview, one whose run is not named, and a
 * node run once per list item (each item is a run of its own: one
 * continuation cannot name them). The app runner offers Render final where
 * this answers, and its route continues what this answers.
 */
export function usecasePreviewTarget(state: unknown): UseCaseRenderFinalTarget | null {
  if (!isRecord(state) || state.status !== "completed" || !isRecord(state.output)) return null
  const output = state.output
  if (Array.isArray(output.listResults) && output.listResults.length > 0) return null
  if (output.quality !== "proxy" || typeof state.jobId !== "string" || state.jobId === "") return null
  return { jobId: state.jobId, ...(isRecord(output.useCaseSettings) ? { settings: output.useCaseSettings } : {}) }
}

/**
 * The one override a use-case node's Render final sends, for that run only:
 * `useCaseContinue: { mode: "render-final", jobId, settings }` on the node.
 * The node's executor turns it into a continue of that run at Final (no fee),
 * and every estimate builds the node as its final chain from it. `base` is
 * any other field the run sends the node (the reviewer's edit of its plan);
 * the continuation is laid over it. The editor and the app runner both build
 * it here, so neither can send a second shape.
 */
export function usecaseRenderFinalOverrides(
  nodeId: string,
  target: UseCaseRenderFinalTarget,
  base?: Readonly<Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const useCaseContinue = { mode: "render-final", jobId: target.jobId, ...(target.settings ? { settings: target.settings } : {}) }
  return { [nodeId]: { ...(base ?? {}), useCaseContinue } }
}

/**
 * A one-shot quality override on the render, as the run's `inputOverrides`
 * (TA18): the node keeps its own Quality, so the toolbar Run always previews
 * and Render final always renders the final. An override clears the overridden
 * node's saved results, so it may only name a node the run re-runs.
 */
export function renderRunOverrides(
  renderId: string,
  quality: "proxy" | "final",
  runSet: ReadonlySet<string>,
): Record<string, Record<string, unknown>> {
  if (!runSet.has(renderId)) {
    throw new Error(`a run override cannot name ${renderId}: it is outside the run's subset, and an override clears the node's saved results`)
  }
  return { [renderId]: { quality } }
}

/**
 * The renders an Edit Plan feeds (its clips or its cut reach the render's `edl`
 * input, through teleports and Camera Switch), in canvas order. A plan-anchored
 * entry point (the plan's context menu) asks WHICH when there are several:
 * one render per click (TA2 item 4, decided 2026-10-04).
 */
export function rendersOfPlan(
  planId: string,
  nodes: readonly RenderFinalGraphNode[],
  edges: readonly RenderFinalGraphEdge[],
): RenderFinalGraphNode[] {
  return nodes.filter(
    (n) => PREVIEW_RENDER_NODE_TYPES.has(n.type ?? "") && renderPlanPath(n.id, nodes, edges)?.planId === planId,
  )
}
