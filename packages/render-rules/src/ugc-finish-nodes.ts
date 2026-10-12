/**
 * A UGC video's finish nodes — the join of its clips, the overlay drawing its screenshot
 * cards, the captions on its caption plan — for the editor's newer-run lanes: a newer run's
 * video lands over an older one on them as it does on UGC Clip's take (the ended run's
 * reopen, the reopen of a run still going, the poll restored after a reload, the reload's
 * recovery, a canvas run, a canvas pass-through).
 *
 * The video's own by their PLACE in the chain (`ugcVideoPlaces`), whatever else they hold or
 * take: a join that also takes an intro, or an overlay with a logo of its own, is still where
 * the video's clips are joined or its cards drawn. Not the price rule (`ugcChains`), which
 * leaves those two out because they render anyway and keep their own price.
 */
import { UGC_FINISH_NODE_TYPES, ugcVideoPlaces } from "./ugc-estimate-input"

interface FinishNode {
  readonly id?: unknown
  readonly type?: unknown
  readonly data?: unknown
}
interface FinishEdge {
  readonly source?: string
  readonly target?: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

/**
 * The finish nodes of every UGC video in the graph, by their place in the chain. Empty, with no
 * chain read, for a graph with no node of a finish type.
 */
export function ugcFinishNodeIds(nodes: ReadonlyArray<FinishNode>, edges: ReadonlyArray<FinishEdge> | undefined): Set<string> {
  if (!nodes.some((n) => typeof n.type === "string" && UGC_FINISH_NODE_TYPES.has(n.type))) return new Set()
  const graph = nodes.map((n) => ({ id: typeof n.id === "string" ? n.id : undefined, type: typeof n.type === "string" ? n.type : null, data: n.data }))
  const ids = new Set<string>()
  for (const place of ugcVideoPlaces(graph, edges)) {
    for (const id of [...place.joinIds, ...place.overlayIds, ...place.captionIds]) ids.add(id)
  }
  return ids
}
