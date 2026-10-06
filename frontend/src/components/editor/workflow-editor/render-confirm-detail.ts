/**
 * What the Render final and Update preview confirms show beside the total
 * (U1, R16 a, decided 2026-10-06):
 *
 *  - `lines`: one per node the run executes (from `estimateRunCreditLines`, so
 *    they sum to the total), in graph order, each marked with what the dialog
 *    says about it: a node that runs before the render ("re-runs first":
 *    Camera Switch in multicam) and an Apply EDL render's quality in this run;
 *  - `kept`: the render's EXECUTABLE ancestors outside the run — they keep
 *    their saved output ("Kept as is"). An upload is not executable, so a
 *    Recording is never listed. One label per node: the dialog translates
 *    them and only then groups the repeats ("Transcribe ×3"), since a grouped
 *    string would miss the label tables;
 *  - `gated`: Update preview only — the nodes of the run set the preview
 *    leaves for THIS render's Render final (the stop rule), not billed now;
 *  - `waits`: the nodes of the run set behind ANOTHER render still set to
 *    Preview (round 2, decided 2026-10-06; Update preview too, decided
 *    2026-10-06). Render final overrides only its own render, so the stop rule
 *    still holds at the second one: those nodes get no line and wait for that
 *    render's own Render final. In a Render final they are the run set less
 *    the lines. In an Update preview they are what the run would still hold
 *    back with this render at Final — the stop rule on the graph a Render
 *    final runs (`renderRunOverrides`) — and `gated` is the rest of what the
 *    preview holds back.
 *
 * "Feeds" is the stop rule's own definition (`buildFeedMaps`), as for the run
 * set itself (`render-final-set.ts`).
 */
import { buildFeedMaps, isRenderNodeType, withRunOverrides, type FeedEdge, type FeedNode } from "@nodaro/shared"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { isExecutableNode, type RunConfirmInfo, type RunConfirmLine, type RunCreditLine } from "./types"
import { runNodeLabel } from "./estimate-run-credits"
import { previewRunnable } from "./preview-gate"
import { renderRunOverrides } from "./render-final-set"

export interface RenderConfirmDetail {
  readonly lines: RunConfirmLine[]
  readonly kept: string[]
  readonly gated: string[]
  readonly waits: string[]
}

/** Every node that feeds `start`, directly or not (`start` excluded). */
function ancestorsOf(start: string, parents: ReadonlyMap<string, ReadonlyArray<string>>): Set<string> {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const id of parents.get(current) ?? []) {
      if (id !== start && !seen.has(id)) {
        seen.add(id)
        queue.push(id)
      }
    }
  }
  return seen
}

/**
 * Each node's place in the graph's run order: a node comes after everything
 * that feeds it; ties keep canvas order. A cycle (never runnable) goes last.
 */
function graphOrder(
  nodes: readonly WorkflowNode[],
  children: ReadonlyMap<string, ReadonlyArray<string>>,
  parents: ReadonlyMap<string, ReadonlyArray<string>>,
): Map<string, number> {
  const canvasIndex = new Map(nodes.map((n, i) => [n.id, i]))
  const waiting = new Map(nodes.map((n) => [n.id, new Set(parents.get(n.id) ?? []).size]))
  const ready = nodes.filter((n) => waiting.get(n.id) === 0).map((n) => n.id)
  const rank = new Map<string, number>()
  while (ready.length > 0) {
    ready.sort((a, b) => canvasIndex.get(a)! - canvasIndex.get(b)!)
    const id = ready.shift()!
    rank.set(id, rank.size)
    for (const child of new Set(children.get(id) ?? [])) {
      const left = (waiting.get(child) ?? 0) - 1
      waiting.set(child, left)
      if (left === 0) ready.push(child)
    }
  }
  for (const n of nodes) if (!rank.has(n.id)) rank.set(n.id, nodes.length + canvasIndex.get(n.id)!)
  return rank
}

/** Labels in order, a repeated one counted once: ["Transcribe ×3", "Tighten Plan"]. */
export function groupedLabels(labels: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  return [...counts].map(([label, count]) => (count > 1 ? `${label} ×${count}` : label))
}

export function renderConfirmDetail(
  renderId: string,
  trigger: Extract<RunConfirmInfo["trigger"], "render-final" | "update-preview">,
  executable: readonly WorkflowNode[],
  lines: readonly RunCreditLine[],
  allNodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): RenderConfirmDetail {
  const { children, parents } = buildFeedMaps(allNodes as unknown as readonly FeedNode[], edges as unknown as readonly FeedEdge[])
  const order = graphOrder(allNodes, children, parents)
  const byOrder = (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0)
  const byId = new Map(allNodes.map((n) => [n.id, n]))
  const ancestors = ancestorsOf(renderId, parents)
  const inRun = new Set(executable.map((n) => n.id))
  const runs = new Set(lines.map((l) => l.nodeId))

  const shown: RunConfirmLine[] = [...lines]
    .sort((a, b) => byOrder(a.nodeId, b.nodeId))
    .map((line) => {
      const node = byId.get(line.nodeId)
      const quality = (node?.data as { quality?: unknown } | undefined)?.quality
      return {
        ...line,
        ...(ancestors.has(line.nodeId) ? { rerunsFirst: true } : {}),
        ...(isRenderNodeType(node?.type) ? { renderQuality: quality === "proxy" ? ("proxy" as const) : ("final" as const) } : {}),
      }
    })

  const kept = [...ancestors]
    .filter((id) => !inRun.has(id))
    .map((id) => byId.get(id))
    .filter((n): n is WorkflowNode => n !== undefined && isExecutableNode(n))
    .sort((a, b) => byOrder(a.id, b.id))
    .map(runNodeLabel)

  // What the run set holds that the run does not execute (the stop rule). In a
  // Render final it can only be what a second Preview render holds back.
  const held = executable.filter((n) => !runs.has(n.id)).sort((a, b) => byOrder(a.id, b.id))
  if (trigger === "render-final") return { lines: shown, kept, gated: [], waits: held.map(runNodeLabel) }

  // An Update preview also holds back this render's own tail. What a Render
  // final of this render would still hold back waits for another render's own.
  const waitsOwn = heldAtFinal(renderId, executable, inRun, allNodes, edges)
  return {
    lines: shown,
    kept,
    gated: held.filter((n) => !waitsOwn.has(n.id)).map(runNodeLabel),
    waits: held.filter((n) => waitsOwn.has(n.id)).map(runNodeLabel),
  }
}

/**
 * The run set's nodes a Render final of `renderId` would not execute: the stop
 * rule on the graph that run executes (this render at Final, every other
 * render at its own quality). A render that does not run keeps its saved
 * output either way, so its graph is left as is.
 */
function heldAtFinal(
  renderId: string,
  executable: readonly WorkflowNode[],
  inRun: ReadonlySet<string>,
  allNodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): Set<string> {
  const asFinal = inRun.has(renderId) ? withRunOverrides(allNodes, renderRunOverrides(renderId, "final", inRun)) : allNodes
  const runsAtFinal = new Set(previewRunnable(executable, asFinal, edges).map((n) => n.id))
  return new Set(executable.filter((n) => !runsAtFinal.has(n.id)).map((n) => n.id))
}
