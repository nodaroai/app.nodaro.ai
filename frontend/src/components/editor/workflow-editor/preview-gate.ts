/**
 * The editor's side of the preview stop rule (`@nodaro/shared` `preview-gate`,
 * decided 2026-10-04): a run stops at a render set to Preview, and nothing
 * downstream of it runs until Render final.
 *
 * - `previewRunnable` — what a run of a set of nodes actually executes: the
 *   set less the rule's closure. Every pre-run surface that prices or flips a
 *   run (the confirm gate, the credit precheck, the Run-from-here quote, the
 *   live estimate, the editor badge, the Copilot card and chips) takes its set
 *   through it, so none can quote a node the run will not execute.
 * - `editorPreviewGatedIds` — the closure of a toolbar Run on the canvas as it
 *   stands (each render at its own quality). It drives the "After Render final"
 *   chip and refuses a single-node ▶ inside it.
 * - `previewRenderPreflight` — a nested graph (a sub-workflow) holding a
 *   Preview render: refused, permanently.
 * - `triggerBranchHoldsPreview` — an armed trigger whose runs the server
 *   will refuse, because nobody is there to review them.
 *
 * Every answer here goes through the rollout flag (`PREVIEW_STOP_RULE_ENABLED`,
 * read from /config.js — decided 2026-10-05). Off, the editor behaves as it did
 * before the rule existed: nothing gated, refused, warned about or left out of
 * an estimate. This is the ONLY editor module that calls the shared rule (a
 * guard test in preview-gate-sites.test.ts holds that).
 */
import {
  buildFeedMaps,
  previewGatedNodeIds,
  previewStops,
  type FeedEdge,
  type FeedNode,
  type PreviewGateEdge,
  type PreviewGateNode,
} from "@nodaro/shared"
import { tx } from "@/lib/i18n"
import { runtimePreviewStopRule } from "@/lib/runtime-config"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

type GraphNode = Pick<WorkflowNode, "id" | "type" | "data" | "parentId">
type GraphEdge = Pick<WorkflowEdge, "source" | "target" | "sourceHandle" | "targetHandle" | "data">

const isFrozen = (n: GraphNode | undefined): boolean => (n?.data as { skipped?: unknown } | undefined)?.skipped === true

function asGate(nodes: readonly GraphNode[]): PreviewGateNode[] {
  return nodes as unknown as PreviewGateNode[]
}
function asGateEdges(edges: readonly GraphEdge[]): PreviewGateEdge[] {
  return edges as unknown as PreviewGateEdge[]
}

/**
 * The nodes of `executable` that a run of exactly those nodes executes: the
 * stop rule's closure removed. A render in the set runs at its own quality;
 * one outside it hands on its saved output.
 */
export function previewRunnable<N extends GraphNode>(
  executable: readonly N[],
  allNodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): N[] {
  if (!runtimePreviewStopRule()) return [...executable]
  const runIds = new Set(executable.map((n) => n.id))
  const byId = new Map(allNodes.map((n) => [n.id, n]))
  const gated = previewGatedNodeIds(asGate(allNodes), asGateEdges(edges), {
    executes: (id) => runIds.has(id) && !isFrozen(byId.get(id)),
  })
  return gated.size === 0 ? [...executable] : executable.filter((n) => !gated.has(n.id))
}

let memo: { nodes: readonly GraphNode[]; edges: readonly GraphEdge[]; ids: ReadonlySet<string> } | null = null
/** The answer while the rule is off: one shared empty set, so a node card's
 *  store selector stays as cheap as it was before the rule. */
const NONE_GATED: ReadonlySet<string> = new Set<string>()

/**
 * The nodes a toolbar Run of this canvas would NOT run, because they would
 * consume a preview. Memoised on the graph's identity: every node's chip asks
 * on every store change, and the answer only changes with the graph.
 */
export function editorPreviewGatedIds(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): ReadonlySet<string> {
  if (!runtimePreviewStopRule()) return NONE_GATED
  if (memo && memo.nodes === nodes && memo.edges === edges) return memo.ids
  const ids = previewGatedNodeIds(asGate(nodes), asGateEdges(edges))
  memo = { nodes, edges, ids }
  return ids
}

/** The single-node ▶ refusal for a node a Preview render gates, or null. The
 *  render's own run stays allowed: it is never inside its own closure. */
export function previewSingleRunRefusal(
  nodeId: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): string | null {
  return editorPreviewGatedIds(nodes, edges).has(nodeId) ? tx("previewGate.singleRefusal") : null
}

/** A nested graph that holds a Preview render cannot stop for a review. Every
 *  node of a nested graph runs, except a frozen one. */
export function previewRenderPreflight(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): string | null {
  if (!runtimePreviewStopRule()) return null
  const stops = previewStops(asGate(nodes), asGateEdges(edges))
  return stops.previewRenderIds.length > 0 || stops.savedPreviewRenderIds.length > 0 ? tx("previewGate.nestedRefusal") : null
}

/**
 * What a run fired by `triggerId` executes, as the server scopes it
 * (`triggerRunScope`): a trigger wired to something runs its descendants plus
 * every node they need; a trigger wired to nothing runs the whole workflow
 * (`null`). Built on the same feed definition (`buildFeedMaps`). A copy of the
 * server's walk, kept here rather than in the Apache shared package; the two
 * are held together by a parity test on one shared fixture
 * (`trigger-branch-scope.json`, run by both suites).
 */
export function triggerBranch(triggerId: string, nodes: readonly GraphNode[], edges: readonly GraphEdge[]): ReadonlySet<string> | null {
  const { children, parents } = buildFeedMaps(nodes as unknown as FeedNode[], edges as unknown as FeedEdge[])
  if ((children.get(triggerId) ?? []).length === 0) return null
  const scope = new Set<string>([triggerId])
  const walk = (start: string, next: ReadonlyMap<string, ReadonlyArray<string>>) => {
    const queue = [start]
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const id of next.get(current) ?? []) {
        if (!scope.has(id)) {
          scope.add(id)
          queue.push(id)
        }
      }
    }
  }
  walk(triggerId, children)
  for (const id of [...scope]) walk(id, parents)
  return scope
}

/**
 * Does a run this trigger fires hold a Preview render? Such a run has nobody
 * to review it, so the server refuses every fire (`preview_review_required`);
 * the card warns before the first one.
 */
export function triggerBranchHoldsPreview(
  triggerId: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): boolean {
  if (!runtimePreviewStopRule()) return false
  const scope = triggerBranch(triggerId, nodes, edges)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const stops = previewStops(asGate(nodes), asGateEdges(edges), {
    executes: (id) => (!scope || scope.has(id)) && !isFrozen(byId.get(id)),
  })
  return stops.previewRenderIds.length > 0 || stops.savedPreviewRenderIds.length > 0
}
