/**
 * The preview stop rule (`@nodaro/shared` `preview-gate`) over the run the
 * server will actually execute, and the refusal for a run nobody can review.
 *
 * A Preview render ends a run at a 720p preview; only a person in the editor
 * or in an app's runner can review it and press Render final. A run with
 * nobody there — a trigger, an API / SDK / MCP call, a present link, an app
 * run without the runner's mark — would bill the
 * upstream and the preview while every delivery node downstream stays silent.
 * So such a run is refused before any node runs, unless it overrides every
 * Preview render to Final (decided 2026-10-04). Whether a reviewer is present
 * is decided at enqueue (`WorkflowExecutionJob.reviewerPresent`).
 *
 * ONE scope rule for the routes that refuse synchronously, the fire lanes that
 * refuse before they enqueue, and the orchestrator's wall: an explicit subset
 * wins, else a triggered run runs the branch behind its trigger
 * (`triggerRunScope`), else the whole graph; a frozen node never executes.
 */
import {
  PREVIEW_REVIEW_REQUIRED,
  withRunOverrides,
  type PreviewStops,
  type SavedRenderStampReader,
} from "@nodaro/shared"
import { getEffectivelySkippedIds, triggerRunScope } from "../services/workflow-engine/execution-graph.js"
import { previewStopsWhenEnabled } from "./preview-stop-rule.js"
import { previewStopRuleEnabled } from "./preview-stop-rule-flag.js"
import type { SimpleEdge, SimpleNode } from "../services/workflow-engine/types.js"

/** The refusal's copy (TA12, en). Clients branch on the code; a client that
 *  shows the message as is (Studio, Voice, an SDK script) must still tell its
 *  reader why and what to do, with no editor context. */
export const PREVIEW_REVIEW_REQUIRED_MESSAGE =
  "This workflow stops for a review: its render is set to Preview, and only a run started in the Nodaro editor or on an app's own page can stop for one. " +
  "Open it there to run it, or set the render to Final (or send a Final quality override for it)."

export interface PreviewRefusal {
  readonly code: string
  readonly message: string
}

/** A node as a route or a lane holds it (its saved graph row). */
type LooseNode = { id: string; type?: string; data?: Record<string, unknown> | null; parentId?: string | null; hidden?: boolean }
type LooseEdge = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: unknown }

/**
 * The stop rule over one run: a node executes when it is in the run's subset
 * (`null` = every node) and not frozen. `nodes` are the run's nodes AFTER its
 * input overrides.
 */
export function runPreviewStops(
  nodes: readonly SimpleNode[],
  edges: readonly SimpleEdge[],
  opts: {
    readonly nodeSubset: ReadonlySet<string> | null
    /** How a render the run does not execute is read; default: its saved
     *  results. A continued run reads its seeds (`continuationRenderStamps`). */
    readonly savedRenders?: SavedRenderStampReader
  },
): PreviewStops {
  const frozen = getEffectivelySkippedIds(nodes as SimpleNode[], edges as SimpleEdge[])
  return previewStopsWhenEnabled(nodes, edges, {
    executes: (id) => !frozen.has(id) && (!opts.nodeSubset || opts.nodeSubset.has(id)),
    ...(opts.savedRenders ? { savedRenders: opts.savedRenders } : {}),
  })
}

/** True when the run executes a Preview render or hands a saved Preview on. */
export function runHoldsPreview(stops: PreviewStops): boolean {
  return stops.previewRenderIds.length > 0 || stops.savedPreviewRenderIds.length > 0
}

/**
 * The refusal for a run with nobody to review it, or `null` when the run holds
 * no Preview render (or overrides each one to Final). Pure: the caller's saved
 * graph, the run's subset / trigger and its input overrides. Always `null`
 * while the rollout flag is off (`PREVIEW_STOP_RULE_ENABLED`).
 */
export function previewReviewRefusal(
  rawNodes: readonly LooseNode[],
  rawEdges: readonly LooseEdge[],
  run: {
    readonly triggerType: string
    readonly triggerNodeId?: string | null
    readonly nodeIds?: readonly string[] | null
    readonly inputOverrides?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
    /** How a render the run does not execute is read, built over the run's
     *  nodes AFTER its overrides (the very objects the rule reads — a reader
     *  may key on a node's `data`). Default: its saved results. A continued
     *  run passes the orchestrator's reader over its seeds
     *  (`continuationRenderStamps`), so both judge the run alike. */
    readonly savedRenders?: (nodes: readonly SimpleNode[]) => SavedRenderStampReader
  },
): PreviewRefusal | null {
  if (!previewStopRuleEnabled()) return null
  const live = rawNodes.filter((node) => node && typeof node.id === "string" && !node.hidden)
  const nodes: SimpleNode[] = withRunOverrides(
    live.map((node) => ({
      id: node.id,
      type: node.type ?? "",
      data: (node.data ?? {}) as SimpleNode["data"],
      ...(node.parentId ? { parentId: node.parentId } : {}),
    })),
    run.inputOverrides,
  )
  const ids = new Set(nodes.map((node) => node.id))
  const edges = rawEdges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) as SimpleEdge[]
  const nodeSubset = run.nodeIds
    ? new Set(run.nodeIds)
    : triggerRunScope(nodes, edges, { triggerType: run.triggerType, triggerNodeId: run.triggerNodeId })
  const savedRenders = run.savedRenders?.(nodes)
  return runHoldsPreview(runPreviewStops(nodes, edges, { nodeSubset, ...(savedRenders ? { savedRenders } : {}) }))
    ? { code: PREVIEW_REVIEW_REQUIRED, message: PREVIEW_REVIEW_REQUIRED_MESSAGE }
    : null
}
