/**
 * A run whose UGC Creator is set to "My photo" with no photo of the runner's own. "My photo" is
 * always the runner's own photo: publishing empties every value that can flow into a creator's
 * photo input (`ugcStripSet`, @nodaro/render-rules), so a creator has a photo only when the runner
 * gives one, as an image that can reach it (`ugcCreatorPhotoSources`):
 * - its own photo (`photoUrl` in the run's inputs);
 * - an image of the runner's given to a node that can carry one into the photo — an upload's image,
 *   a List's rows, a sub-workflow input port that takes an image;
 * - a value of the runner's given to what sets up a node that makes the image in the run from
 *   nothing an image brings it (a Text node or a picker prompting a generator).
 * A value given to a node that can carry no image — a Text node or a picker setting up a step whose
 * image comes from an emptied upload, a port that takes text — is no photo. Without one the run
 * would stop at UGC Creator, or at a step before it, after the script had been paid for — so the run
 * is refused before anything is written or spent, with a sentence the runner can act on and a code
 * the runner's language translates (`ugc_photo_required`). The same refusal guards a presentation
 * share link's viewer and a published component's run (`/v1/component/execute`), for every creator
 * the run reaches at any depth, and for a component the run reaches that holds a My photo creator
 * (never walked into: what feeds it must bring the runner's image).
 */
import {
  ugcComposedCreators,
  ugcComposedKey,
  ugcComposedOf,
  ugcComposedPath,
  ugcComposedPathRuns,
  ugcCreatorPhotoSources,
  ugcPhotoValueKey,
  type UgcComposedGraph,
} from "@nodaro/render-rules"
import { loadUgcComposedGraph } from "./ugc-composed-graph.js"

/** The refusal: a fixed meaning, so the app runner shows it in the person's language. */
export const UGC_APP_PHOTO_REQUIRED = {
  code: "ugc_photo_required",
  message: "This app needs a photo of you. Add one, then run it again.",
} as const

interface SnapshotNode {
  readonly id: string
  readonly type?: string | null
  readonly data?: Record<string, unknown>
}
interface SnapshotEdge {
  readonly source?: string
  readonly target?: string
  readonly targetHandle?: string | null
}
type Overrides = Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined
type GraphNode = { readonly id?: unknown; readonly type?: unknown; readonly data?: unknown }

const dataOf = (n: GraphNode | undefined): Record<string, unknown> =>
  n && n.data && typeof n.data === "object" && !Array.isArray(n.data) ? (n.data as Record<string, unknown>) : {}
const ADDRESS = /^\s*(?:https?:|data:|blob:)/i

/** A value the runner gave: a non-empty string, or a list or a row holding one. */
function given(x: unknown, depth = 0): boolean {
  if (typeof x === "string") return x.trim() !== ""
  if (depth > 4 || !x || typeof x !== "object") return false
  return (Array.isArray(x) ? x : Object.values(x)).some((item) => given(item, depth + 1))
}

/** Does `x` hold an address the runner gave? */
function givesAddress(x: unknown, depth = 0): boolean {
  if (typeof x === "string") return ADDRESS.test(x)
  if (depth > 4 || !x || typeof x !== "object") return false
  return (Array.isArray(x) ? x : Object.values(x)).some((item) => givesAddress(item, depth + 1))
}

/**
 * Did the run give an image of the runner's own to this node: on a key that holds its value (an
 * upload's image, a List's rows, a file's address), or on one of a sub-workflow input's ports that
 * takes an image (`__injectedPortValues`; a port of no stated kind counts when it is given an address).
 */
function runnerGaveImage(node: GraphNode | undefined, override: Readonly<Record<string, unknown>> | undefined): boolean {
  if (!node || !override) return false
  const type = typeof node.type === "string" ? node.type : ""
  return Object.entries(override).some(([key, value]) => {
    if (key === "__injectedPortValues") {
      if (!value || typeof value !== "object") return false
      const ports = Array.isArray(dataOf(node).ports) ? (dataOf(node).ports as Array<{ id?: unknown; mediaType?: unknown }>) : []
      return Object.entries(value as Record<string, unknown>).some(([portId, portValue]) => {
        const kind = ports.find((p) => p.id === portId)?.mediaType
        return kind === "image" ? given(portValue) : (kind === undefined || kind === "any") && givesAddress(portValue)
      })
    }
    return ugcPhotoValueKey(key, type) && given(value)
  })
}

/** Did the run give this node any value of the runner's own (what sets up a node that makes the image)? */
function runnerGaveAny(override: Readonly<Record<string, unknown>> | undefined): boolean {
  return !!override && Object.entries(override).some(([key, value]) => key !== "label" && given(value))
}

/** The graphs a run reaches: its own, and those inside the sub-workflows it executes (none frozen on the way down). */
function reached(composed: UgcComposedGraph, key: string, nodeId: string, nodeIds: readonly string[] | undefined): boolean {
  const path = ugcComposedPath(key)
  const inRun = nodeIds ? new Set(nodeIds) : undefined
  if (path.length === 0) return !inRun || inRun.has(nodeId)
  if (inRun && !inRun.has(path[0]!)) return false
  return ugcComposedPathRuns(composed, key)
}

/** Does a component's snapshot, or a graph within it, hold a UGC Creator set to My photo? */
function componentHoldsMyPhoto(composed: UgcComposedGraph, componentKey: string): boolean {
  const prefix = componentKey.slice(0, -1)
  for (const [key, part] of composed) {
    if (key !== componentKey && !key.startsWith(`${prefix},`)) continue
    if (part.nodes.some((n) => n.type === "ugc-creator" && dataOf(n).source === "photo")) return true
  }
  return false
}

/** Did the runner give what this photo needs: an image to a node that can carry one in, or a value to what sets up a node that makes it? */
function photoGiven(composed: UgcComposedGraph, key: string, id: string, overrides: Overrides, everyInput: boolean): boolean {
  const root = ugcComposedKey([])
  const own = composed.get(root)
  const nodeOf = (nodeId: string) => own?.nodes.find((n) => n.id === nodeId)
  const sources = ugcCreatorPhotoSources(composed, key, id, { everyInput })
  for (const nodeId of sources.image.get(root) ?? []) if (runnerGaveImage(nodeOf(nodeId), overrides?.[nodeId])) return true
  for (const nodeId of sources.originFeeders.get(root) ?? []) if (runnerGaveAny(overrides?.[nodeId])) return true
  return false
}

/** Is any graph on the way down to `key` a component's snapshot (never walked into)? */
function insideComponent(composed: UgcComposedGraph, key: string): boolean {
  const path = ugcComposedPath(key)
  return path.some((_, i) => composed.get(ugcComposedKey(path.slice(0, i + 1)))?.component === true)
}

/** True when a creator, or a component holding one, that the run reaches is set to "My photo" and the runner gave it no photo (see the file comment). */
function missesPhoto(composed: UgcComposedGraph, overrides: Overrides, nodeIds: readonly string[] | undefined): boolean {
  const root = ugcComposedKey([])
  for (const { key, node } of ugcComposedCreators(composed)) {
    const id = node.id as string
    if (insideComponent(composed, key) || !reached(composed, key, id, nodeIds)) continue
    const stored = dataOf(node)
    const atTop = key === root
    // The run's inputs land on its own graph only.
    const source = atTop && overrides?.[id] && "source" in overrides[id]! ? overrides[id]!.source : stored.source
    if (source !== "photo") continue
    if (atTop && given(overrides?.[id]?.photoUrl)) continue
    if (!photoGiven(composed, key, id, overrides, false)) return true
  }
  // A component holding a My photo creator: what feeds it must bring the runner's image.
  for (const [key, part] of composed) {
    if (insideComponent(composed, key)) continue
    for (const node of part.nodes) {
      const id = typeof node.id === "string" ? node.id : undefined
      if (!id || node.type !== "component" || !reached(composed, key, id, nodeIds)) continue
      const componentKey = ugcComposedKey([...ugcComposedPath(key), id])
      if (!composed.get(componentKey)?.component || !componentHoldsMyPhoto(composed, componentKey)) continue
      if (!photoGiven(composed, key, id, overrides, true)) return true
    }
  }
  return false
}

/**
 * True when a UGC Creator this run reaches is set to "My photo" (the run's input first) and the
 * runner gave it no photo (see the file comment). Read on the run's own graph alone: a
 * sub-workflow or component node is read from what feeds it. `ugcRunMissesPhoto` reads every graph.
 */
export function ugcAppRunMissesPhoto(
  nodes: readonly SnapshotNode[],
  edges: readonly SnapshotEdge[],
  inputOverrides: Overrides,
  /** The nodes the run executes, when it runs a part of the app. */
  nodeIds?: readonly string[],
): boolean {
  return missesPhoto(ugcComposedOf(nodes, edges), inputOverrides, nodeIds)
}

/** The nodes a run executes: all of them, or the part `nodeIds` names. */
export function ugcRunNodes<T extends SnapshotNode>(nodes: readonly T[], nodeIds: readonly string[] | undefined): T[] {
  if (!nodeIds) return [...nodes]
  const inRun = new Set(nodeIds)
  return nodes.filter((n) => inRun.has(n.id))
}

/**
 * The refusal over every graph the run reaches: its own, and the sub-workflow graphs and component
 * snapshots it references (`loadUgcComposedGraph`: the owner's own, at every depth, read as
 * publishing reads them).
 */
export async function ugcRunMissesPhoto(
  nodes: readonly SnapshotNode[],
  edges: readonly SnapshotEdge[],
  inputOverrides: Overrides,
  nodeIds: readonly string[] | undefined,
  ownerId: string,
): Promise<boolean> {
  return missesPhoto((await loadUgcComposedGraph(nodes, edges, ownerId)).graph, inputOverrides, nodeIds)
}
