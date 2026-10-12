/**
 * Every way one node of a graph feeds another, as what publishing a UGC video reads it by: what
 * is made from the video (downstream, `ugcDownstreamIds`) and where a creator's photo comes from
 * (upstream, `ugcCreatorPhotoPath`).
 *
 * - The codebase's one feed reading (`buildFeedMaps`, @nodaro/shared): a wire, a Group a node sits
 *   in (it feeds the Group), a field mapping.
 * - A Teleport Send feeds every Receive on its channel, wired or not.
 * - A Preview holds a copy of each item's source output: each source feeds the Preview.
 * - A fan-out clone holds one of its original's results: the original feeds the clone.
 */
import { buildFeedMaps } from "@nodaro/shared"

export interface FeedGraphNode {
  readonly id?: unknown
  readonly type?: unknown
  readonly parentId?: unknown
  readonly data?: unknown
}
export interface FeedGraphEdge {
  readonly source?: string
  readonly target?: string
}

export interface UgcGraphFeeds {
  /** node id → the ids it feeds */
  readonly children: ReadonlyMap<string, readonly string[]>
  /** node id → the ids that feed it */
  readonly parents: ReadonlyMap<string, readonly string[]>
}

type Data = Record<string, unknown>
const isData = (x: unknown): x is Data => !!x && typeof x === "object" && !Array.isArray(x)
const idOf = (n: FeedGraphNode): string | undefined => (typeof n.id === "string" ? n.id : undefined)
const typeOf = (n: FeedGraphNode): string => (typeof n.type === "string" ? n.type : "")
const channelOf = (n: FeedGraphNode): string | undefined =>
  isData(n.data) && typeof n.data.channel === "string" && n.data.channel !== "" ? n.data.channel : undefined

/** The fan-out clone's original: the node it was expanded from (`node_7_iter_0` from `node_7`). */
export function cloneOriginOf(n: FeedGraphNode): string | undefined {
  const from = isData(n.data) ? n.data.__expandedFrom : undefined
  if (typeof from === "string" && from !== "") return from
  const id = idOf(n)
  const match = id !== undefined ? /^(.+)_iter_\d+$/.exec(id) : null
  return match ? match[1] : undefined
}

/** Every way one node feeds another (see the file comment), both ways round. */
export function ugcGraphFeeds(nodes: ReadonlyArray<FeedGraphNode>, edges: ReadonlyArray<FeedGraphEdge> | undefined): UgcGraphFeeds {
  const feedNodes = nodes.flatMap((n) => {
    const id = idOf(n)
    return id !== undefined ? [{ id, parentId: typeof n.parentId === "string" ? n.parentId : undefined, data: n.data }] : []
  })
  const feedEdges = (edges ?? []).flatMap((e) => (typeof e.source === "string" && typeof e.target === "string" ? [{ source: e.source, target: e.target }] : []))
  const base = buildFeedMaps(feedNodes, feedEdges)
  const children = new Map<string, string[]>([...base.children].map(([id, to]) => [id, [...to]]))
  const parents = new Map<string, string[]>([...base.parents].map(([id, from]) => [id, [...from]]))
  const live = new Set(feedNodes.map((n) => n.id))
  const feeds = (from: string, to: string) => {
    if (!live.has(from) || !live.has(to) || from === to) return
    children.set(from, [...(children.get(from) ?? []), to])
    parents.set(to, [...(parents.get(to) ?? []), from])
  }
  // A Teleport Send hands its value to every Receive on its channel, wired or not.
  const receives = new Map<string, string[]>()
  for (const n of nodes) {
    const channel = channelOf(n)
    const id = idOf(n)
    if (typeOf(n) === "teleport-receive" && id !== undefined && channel) receives.set(channel, [...(receives.get(channel) ?? []), id])
  }
  for (const n of nodes) {
    const channel = channelOf(n)
    const id = idOf(n)
    if (typeOf(n) === "teleport-send" && id !== undefined && channel) for (const r of receives.get(channel) ?? []) feeds(id, r)
  }
  for (const n of nodes) {
    const id = idOf(n)
    if (id === undefined) continue
    // A Preview holds a copy of each item's source output.
    if (typeOf(n) === "preview" && isData(n.data) && Array.isArray(n.data.previewItems)) {
      for (const item of n.data.previewItems) {
        const source = isData(item) ? item.sourceNodeId : undefined
        if (typeof source === "string") feeds(source, id)
      }
    }
    // A fan-out clone holds one of its original's results.
    const origin = cloneOriginOf(n)
    if (origin !== undefined) feeds(origin, id)
  }
  return { children, parents }
}
