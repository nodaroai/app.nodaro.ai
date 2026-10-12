/**
 * What publishing a workflow holding a UGC video empties, read over a composed graph: the workflow
 * and every sub-workflow graph and component snapshot it references, recursively. "My photo" is
 * always the runner's own photo and nothing made from a UGC run ships, so ONE strip set
 * (`ugcStripSet`) holds, part by part:
 *
 * (a) the photo influence set (`ugcPhotoInfluence`): every node whose value can flow into a UGC
 *     Creator's photo input, read upstream from each photo input, one node at a time:
 *     - in a graph, every way one node feeds another (`ugcGraphFeeds`: a wire, a Group's members, a
 *       field mapping, a Teleport Send to the Receives on its channel, a Preview's items, a fan-out
 *       clone's original), and a node's fan-out clones;
 *     - a sub-workflow node whose graph is in the composition reads from where that graph's output
 *       can come from: the output nodes and terminal nodes a run of its route keeps (`outputSide`);
 *     - a sub-workflow's input node reads from everything that feeds that sub-workflow node in the
 *       graph above, so a photo path crosses sub-workflow ports both ways, at any depth. Both
 *       crossings read the whole node, never one port: a run hands every value given to a
 *       sub-workflow node to its input node, and a port with no value reads another port's;
 *     - a node the walk does not open — a component node (a published snapshot, stripped at its own
 *       publish, never walked into), or a sub-workflow node whose graph is not in the composition —
 *       reads from what feeds it. A component holding a UGC video, and a node whose graph could not
 *       be read, count as a photo input themselves: what feeds them may reach a creator inside.
 *     Nothing stops the walk: an input the runner fills keeps that role, but never the author's value.
 * (b) everything downstream of a node in (a) or of a root — a UGC node, a sub-workflow or component
 *     node whose graph holds one at any depth, a node whose graph could not be read — over the same
 *     feeds and across sub-workflow ports: into a sub-workflow's input nodes from what feeds it, and
 *     out to the sub-workflow node from where its output comes from.
 */
import { PARAMETER_NODE_TYPES, UGC_NODE_TYPES, DYNAMIC_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES, getOutputType } from "@nodaro/shared"
import { ugcGraphFeeds, cloneOriginOf, type FeedGraphEdge, type FeedGraphNode, type UgcGraphFeeds } from "./ugc-graph-feeds"
import { ugcHoldsTaint, ugcTaintOf, type UgcStorageKey, type UgcTaint } from "./ugc-taint"
import { isRunResultKey } from "./run-result-keys"

interface PathEdge extends FeedGraphEdge {
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

/** The creator's photo input. */
export const UGC_CREATOR_PHOTO_HANDLE = "photo"

/** One graph of a composed graph: its nodes and edges, whether it is a component's snapshot, and whose workflows its own sub-workflows reference. */
export interface UgcGraphPart {
  readonly nodes: ReadonlyArray<FeedGraphNode>
  readonly edges: ReadonlyArray<PathEdge>
  /** A published component's snapshot: never walked into for a photo, read only for the UGC video it holds. */
  readonly component?: boolean
  /** Whose workflows this graph's sub-workflow nodes reference (a component's: its creator's). */
  readonly ownerId?: string
}

/**
 * A workflow and every graph it references, recursively, each keyed by the node ids that lead to it
 * from the top, outermost first (`ugcComposedKey([])` is the workflow itself).
 */
export type UgcComposedGraph = ReadonlyMap<string, UgcGraphPart>

/** A set over a composed graph, graph by graph: a composed key → the node ids of that graph in it. */
export type UgcPhotoInfluence = ReadonlyMap<string, ReadonlySet<string>>

/** The key of the graph a chain of node ids leads to. */
export function ugcComposedKey(path: readonly string[]): string {
  return JSON.stringify(path)
}

/** The chain of node ids a composed key names. */
export function ugcComposedPath(key: string): string[] {
  const path = JSON.parse(key) as unknown
  return Array.isArray(path) ? path.filter((x): x is string => typeof x === "string") : []
}

/** A composed graph of one workflow, with no other graph read. */
export function ugcComposedOf(nodes: ReadonlyArray<FeedGraphNode>, edges: ReadonlyArray<PathEdge> | undefined): UgcComposedGraph {
  return new Map([[ugcComposedKey([]), { nodes, edges: edges ?? [] }]])
}

const idOf = (n: FeedGraphNode): string | undefined => (typeof n.id === "string" ? n.id : undefined)
const typeOf = (n: FeedGraphNode | undefined): string => (n && typeof n.type === "string" ? n.type : "")
const dataOf = (n: FeedGraphNode | undefined): Record<string, unknown> =>
  n && n.data && typeof n.data === "object" && !Array.isArray(n.data) ? (n.data as Record<string, unknown>) : {}
const ROOT = ugcComposedKey([])

/** The workflow a sub-workflow node references: the one the editor writes (`referencedWorkflowId`), or the one a run reads (`workflowId`). */
export function ugcSubWorkflowReference(node: FeedGraphNode): string | undefined {
  if (typeOf(node) !== "sub-workflow") return undefined
  const data = dataOf(node)
  for (const ref of [data.referencedWorkflowId, data.workflowId]) if (typeof ref === "string" && ref !== "") return ref
  return undefined
}

/** The published component a component node runs: its slug, and the version it is pinned to. */
export function ugcComponentReference(node: FeedGraphNode): { readonly appSlug: string; readonly version?: number } | undefined {
  if (typeOf(node) !== "component") return undefined
  const data = dataOf(node)
  if (typeof data.appSlug !== "string" || data.appSlug === "") return undefined
  return typeof data.pinnedVersion === "number" && data.pinnedVersion > 0 ? { appSlug: data.appSlug, version: data.pinnedVersion } : { appSlug: data.appSlug }
}

/** A graph the read asked for: loaded, missing (no such graph, or not the owner's), or failed (an error, never "missing"). */
export type UgcPartLoad = { readonly kind: "loaded"; readonly part: UgcGraphPart } | { readonly kind: "missing" } | { readonly kind: "error" }

/** How a read loads the graphs a composed graph references. */
export interface UgcGraphReaders {
  /** A sub-workflow node's graph: the workflow `referenceId` of the owner `ownerId`. */
  readonly subWorkflow: (referenceId: string, ownerId: string | undefined) => Promise<UgcPartLoad>
  /** A component node's published snapshot, with its creator as the part's `ownerId`. Absent: component nodes are not read. */
  readonly component?: (appSlug: string, version: number | undefined) => Promise<UgcPartLoad>
}

/** A composed graph as a read left it. */
export interface UgcComposedRead {
  readonly graph: UgcComposedGraph
  /**
   * Sub-workflow and component nodes, graph by graph, whose graph is not in `graph` — missing, an
   * error, a cycle, past the depth limit or the read's caps, or a node that names none and holds
   * outputs of its own. A strip reads each as holding a UGC video, and what feeds it as reaching a
   * creator's photo.
   */
  readonly opaque: ReadonlyMap<string, ReadonlySet<string>>
  /** Whether a load failed with an error (not a missing graph). */
  readonly failed: boolean
  /** How many graphs were loaded (each distinct graph once per read). */
  readonly loads: number
}

/** The most DISTINCT graphs one read loads (an owner's workflow, a component version); past it a node is read as opaque. */
export const UGC_COMPOSED_MAX_PARTS = 200
/** The most places one read composes (a graph reached by several paths is one place per path), a bound on the read's size. */
export const UGC_COMPOSED_MAX_PLACES = 5000

/** Does a node hold an output of its own — an address under a key a run writes? */
function holdsOutputs(node: FeedGraphNode): boolean {
  const type = typeOf(node)
  return Object.entries(dataOf(node)).some(([key, value]) => isRunResultKey(key, type) && /(?:https?:|data:|blob:)/i.test(JSON.stringify(value ?? "")))
}

/**
 * A workflow composed with every sub-workflow graph and component snapshot it references,
 * recursively — the ONE reading of a composition, the server's and the editor's. Each graph is
 * loaded once per read however often it is referenced (`readers` are memoized by owner and
 * reference), read whole (every route, so a set is never narrower than what any route's run reads),
 * a frozen node's too. A reference is followed once on each path (a sub-workflow's by its route, as
 * a run's cycle check reads it), to `maxDepth` levels of nesting. The cap counts distinct graphs
 * (`maxParts`): a graph reached again costs no load and composes again at each place, up to
 * `UGC_COMPOSED_MAX_PLACES` places. Each level's new graphs load together. A node that names no
 * graph is a plain node, unless it holds outputs nothing can account for.
 */
export async function ugcReadComposedGraph(
  nodes: ReadonlyArray<FeedGraphNode>,
  edges: ReadonlyArray<PathEdge> | undefined,
  readers: UgcGraphReaders,
  opts: { readonly maxDepth: number; readonly ownerId?: string; readonly maxParts?: number; readonly maxPlaces?: number },
): Promise<UgcComposedRead> {
  const maxParts = opts.maxParts ?? UGC_COMPOSED_MAX_PARTS
  const maxPlaces = opts.maxPlaces ?? UGC_COMPOSED_MAX_PLACES
  const graph = new Map<string, UgcGraphPart>([[ROOT, { nodes, edges: edges ?? [], ...(opts.ownerId ? { ownerId: opts.ownerId } : {}) }]])
  const opaque = new Map<string, Set<string>>()
  const memo = new Map<string, Promise<UgcPartLoad>>()
  let failed = false
  let loads = 0
  const load = (memoKey: string, start: () => Promise<UgcPartLoad>): Promise<UgcPartLoad> => {
    const known = memo.get(memoKey)
    if (known) return known
    const started = start()
      .then((result) => {
        if (result.kind === "loaded") loads++
        if (result.kind === "error") failed = true
        return result
      })
      .catch((): UgcPartLoad => {
        failed = true
        return { kind: "error" }
      })
    memo.set(memoKey, started)
    return started
  }
  const markOpaque = (key: string, id: string) => opaque.set(key, new Set([...(opaque.get(key) ?? []), id]))
  // Breadth first, so a graph is composed at its shallowest place before a cap can bite.
  let frontier: Array<{ readonly key: string; readonly part: UgcGraphPart; readonly onPath: ReadonlySet<string> }> = [{ key: ROOT, part: graph.get(ROOT)!, onPath: new Set() }]
  for (let depth = 0; frontier.length > 0; depth++) {
    // Every reference of this level, in order; each new distinct graph is loaded once, all together.
    const wanted: Array<{ readonly key: string; readonly id: string; readonly memoKey: string; readonly cycleKey: string; readonly onPath: ReadonlySet<string>; readonly path: readonly string[]; readonly comp: boolean; readonly start: () => Promise<UgcPartLoad>; readonly ownerId?: string }> = []
    for (const { key, part, onPath } of frontier) {
      const path = ugcComposedPath(key)
      for (const node of part.nodes) {
        const id = idOf(node)
        const type = typeOf(node)
        if (id === undefined || (type !== "sub-workflow" && type !== "component")) continue
        const sub = ugcSubWorkflowReference(node)
        const comp = ugcComponentReference(node)
        const cycleKey = sub !== undefined ? `sub:${sub}:${String(dataOf(node).selectedRouteId ?? "default")}` : comp ? `component:${comp.appSlug}` : undefined
        if (cycleKey === undefined) {
          // Names no graph: a plain node — unless it holds outputs, which nothing can then account for.
          if (holdsOutputs(node)) markOpaque(key, id)
          continue
        }
        if (onPath.has(cycleKey) || depth >= opts.maxDepth || (comp && !readers.component)) {
          markOpaque(key, id)
          continue
        }
        const memoKey = sub !== undefined ? `sub:${part.ownerId ?? ""}:${sub}` : `component:${comp!.appSlug}:${comp!.version ?? "latest"}`
        const start = sub !== undefined ? () => readers.subWorkflow(sub, part.ownerId) : () => readers.component!(comp!.appSlug, comp!.version)
        wanted.push({ key, id, memoKey, cycleKey, onPath, path, comp: comp !== undefined, start, ...(part.ownerId ? { ownerId: part.ownerId } : {}) })
      }
    }
    // The cap counts distinct graphs: a graph not loaded yet, past it, is never loaded.
    const admitted = new Set(memo.keys())
    for (const w of wanted) if (!admitted.has(w.memoKey) && admitted.size < maxParts) admitted.add(w.memoKey)
    const results = await Promise.all(wanted.map((w) => (admitted.has(w.memoKey) ? load(w.memoKey, w.start) : Promise.resolve<UgcPartLoad | null>(null))))
    const next: typeof frontier = []
    wanted.forEach((w, i) => {
      const result = results[i]
      if (!result || result.kind !== "loaded" || graph.size >= maxPlaces) {
        markOpaque(w.key, w.id)
        return
      }
      const child: UgcGraphPart = {
        ...result.part,
        ...(w.comp ? { component: true } : {}),
        ...(result.part.ownerId ?? w.ownerId ? { ownerId: result.part.ownerId ?? w.ownerId } : {}),
      }
      const childKey = ugcComposedKey([...w.path, w.id])
      graph.set(childKey, child)
      next.push({ key: childKey, part: child, onPath: new Set([...w.onPath, w.cycleKey]) })
    })
    frontier = next
  }
  return { graph, opaque, failed, loads }
}

/** Does a run reach the graph at `key`: is every node on the way down to it run, none frozen? */
export function ugcComposedPathRuns(composed: UgcComposedGraph, key: string): boolean {
  const path = ugcComposedPath(key)
  return path.every((id, i) => {
    const holder = composed.get(ugcComposedKey(path.slice(0, i)))
    const node = holder?.nodes.find((n) => idOf(n) === id)
    // A frozen node (`skipped`, read as a run reads it) hands on its saved output instead of running its graph.
    return node !== undefined && !dataOf(node).skipped
  })
}

/** A part, read once. */
interface ReadPart {
  readonly path: readonly string[]
  readonly edges: ReadonlyArray<PathEdge>
  readonly byId: ReadonlyMap<string, FeedGraphNode>
  readonly feeds: UgcGraphFeeds
  /** original id → its fan-out clones */
  readonly clones: ReadonlyMap<string, readonly string[]>
  readonly component: boolean
}

function readParts(composed: UgcComposedGraph): Map<string, ReadPart> {
  const parts = new Map<string, ReadPart>()
  for (const [key, part] of composed) {
    const byId = new Map(part.nodes.flatMap((n) => { const id = idOf(n); return id !== undefined ? [[id, n] as const] : [] }))
    const clones = new Map<string, string[]>()
    for (const n of part.nodes) {
      const id = idOf(n)
      const origin = cloneOriginOf(n)
      if (id !== undefined && origin !== undefined && byId.has(origin)) clones.set(origin, [...(clones.get(origin) ?? []), id])
    }
    parts.set(key, { path: ugcComposedPath(key), edges: part.edges, byId, feeds: ugcGraphFeeds(part.nodes, part.edges), clones, component: part.component === true })
  }
  return parts
}

/** The far end of each wire into a creator's photo input. */
function photoInputFeeders(part: ReadPart, creatorId: string): string[] {
  return part.edges.flatMap((e) =>
    e.target === creatorId && e.targetHandle === UGC_CREATOR_PHOTO_HANDLE && typeof e.source === "string" && part.byId.has(e.source) ? [e.source] : [],
  )
}

/** The node ids reached from `start` along the wires, forward or backward. */
function reach(edges: ReadonlyArray<PathEdge>, start: string, forward: boolean): Set<string> {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of edges) {
      const [from, to] = forward ? [e.source, e.target] : [e.target, e.source]
      if (from === id && typeof to === "string" && !seen.has(to)) queue.push(to)
    }
  }
  return seen
}

/**
 * Where a sub-workflow node's output can come from in its graph, read as a run hands it out: the
 * graph's nodes a run keeps (with the route's input and output node named on the sub-workflow node,
 * only those on a path between them; else all), and of those every output node and every terminal
 * node (no kept wire leaves it) — a run collects every output node's ports, falls back from a port
 * with no value to another port's, and from output nodes that hand out nothing to the terminal
 * nodes. Read wider than any one port on purpose: a value reaches the node above through any of them.
 */
function outputSide(child: ReadPart, sub: FeedGraphNode): string[] {
  const data = dataOf(sub)
  const snapshot = data.routeSnapshot && typeof data.routeSnapshot === "object" ? (data.routeSnapshot as Record<string, unknown>) : {}
  const inputId = typeof snapshot.inputNodeId === "string" && snapshot.inputNodeId !== "" ? snapshot.inputNodeId : undefined
  const outputId = typeof snapshot.outputNodeId === "string" && snapshot.outputNodeId !== "" ? snapshot.outputNodeId : undefined
  let kept: Set<string> = new Set(child.byId.keys())
  if (inputId !== undefined && outputId !== undefined) {
    const forward = reach(child.edges, inputId, true)
    const backward = reach(child.edges, outputId, false)
    kept = new Set([...forward].filter((id) => backward.has(id) && child.byId.has(id)))
    for (const id of [inputId, outputId]) if (child.byId.has(id)) kept.add(id)
  }
  const leaving = new Set(child.edges.flatMap((e) => (typeof e.source === "string" && typeof e.target === "string" && kept.has(e.source) && kept.has(e.target) ? [e.source] : [])))
  return [...kept].filter((id) => typeOf(child.byId.get(id)) === "sub-workflow-output" || !leaving.has(id))
}

/** A walk's entry: a node of a part. */
type Entry = readonly [key: string, id: string]
const entryKey = ([key, id]: Entry) => `${key}\u0000${id}`

function add(out: Map<string, Set<string>>, key: string, id: string): boolean {
  const held = out.get(key) ?? new Set<string>()
  if (held.has(id)) return false
  held.add(id)
  out.set(key, held)
  return true
}

/**
 * The walk upstream from `starts` (see the file comment, (a)); `skip` holds the creators the walk
 * began at; `passes` (optional) decides which nodes the walk may enter at all.
 */
function walkUp(parts: ReadonlyMap<string, ReadPart>, starts: readonly Entry[], skip: ReadonlySet<string>, passes?: (node: FeedGraphNode | undefined) => boolean): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const queue: Entry[] = [...starts]
  while (queue.length > 0) {
    const [key, id] = queue.shift()!
    const part = parts.get(key)
    if (!part || !part.byId.has(id) || skip.has(entryKey([key, id]))) continue
    const node = part.byId.get(id)
    if (passes && !passes(node)) continue
    if (!add(out, key, id)) continue
    const type = typeOf(node)
    const childKey = ugcComposedKey([...part.path, id])
    const child = type === "sub-workflow" ? parts.get(childKey) : undefined
    if (child && !child.component) {
      for (const start of outputSide(child, node!)) queue.push([childKey, start])
    } else {
      for (const from of part.feeds.parents.get(id) ?? []) queue.push([key, from])
    }
    for (const copy of part.clones.get(id) ?? []) queue.push([key, copy])
    if (type === "sub-workflow-input" && part.path.length > 0 && !part.component) {
      const aboveKey = ugcComposedKey(part.path.slice(0, -1))
      const above = parts.get(aboveKey)
      for (const from of above?.feeds.parents.get(part.path[part.path.length - 1]!) ?? []) queue.push([aboveKey, from])
    }
  }
  return out
}

/** Every UGC Creator of a composed graph, with the key of the graph it is in (never inside a component's snapshot). */
export function ugcComposedCreators(composed: UgcComposedGraph): Array<{ readonly key: string; readonly node: FeedGraphNode }> {
  return [...composed]
    .filter(([, part]) => part.component !== true)
    .flatMap(([key, part]) => part.nodes.filter((n) => typeOf(n) === "ugc-creator" && idOf(n) !== undefined).map((node) => ({ key, node })))
}

/**
 * The nodes, graph by graph, whose own graph holds a UGC node at any depth: a sub-workflow node, or a
 * component node. A frozen node counts: its saved outputs still stand in for it.
 */
export function ugcHoldersOfUgc(composed: UgcComposedGraph): Map<string, Set<string>> {
  const holds = new Map<string, boolean>()
  const holdsUgc = (key: string): boolean => {
    const known = holds.get(key)
    if (known !== undefined) return known
    holds.set(key, false)
    const part = composed.get(key)
    const path = ugcComposedPath(key)
    const found =
      !!part &&
      part.nodes.some((n) => {
        const id = idOf(n)
        if (UGC_NODE_TYPES.has(typeOf(n))) return true
        return (typeOf(n) === "sub-workflow" || typeOf(n) === "component") && id !== undefined && holdsUgc(ugcComposedKey([...path, id]))
      })
    holds.set(key, found)
    return found
  }
  const out = new Map<string, Set<string>>()
  for (const [key, part] of composed) {
    const path = ugcComposedPath(key)
    for (const n of part.nodes) {
      const id = idOf(n)
      if ((typeOf(n) !== "sub-workflow" && typeOf(n) !== "component") || id === undefined) continue
      const childKey = ugcComposedKey([...path, id])
      if (composed.has(childKey) && holdsUgc(childKey)) add(out, key, id)
    }
  }
  return out
}

/** @deprecated The sub-workflow nodes among `ugcHoldersOfUgc`. */
export function ugcSubWorkflowsHoldingUgc(composed: UgcComposedGraph): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [key, ids] of ugcHoldersOfUgc(composed)) {
    const part = composed.get(key)
    for (const id of ids) if (typeOf(part?.nodes.find((n) => idOf(n) === id)) === "sub-workflow") add(out, key, id)
  }
  return out
}

/** The nodes whose own feeders are read as reaching a creator's photo: a component holding a UGC video, and an opaque node. */
function photoSinks(composed: UgcComposedGraph, opaque: ReadonlyMap<string, ReadonlySet<string>>): Entry[] {
  const holders = ugcHoldersOfUgc(composed)
  const out: Entry[] = []
  for (const [key, ids] of opaque) for (const id of ids) out.push([key, id])
  for (const [key, ids] of holders) {
    const part = composed.get(key)
    for (const id of ids) if (typeOf(part?.nodes.find((n) => idOf(n) === id)) === "component") out.push([key, id])
  }
  return out
}

/**
 * Every node of a composed graph whose value can flow into any UGC Creator's photo input (see the
 * file comment, (a)). With `opaque` (a read's opaque nodes), what feeds an opaque node or a component
 * holding a UGC video is in it too.
 */
export function ugcPhotoInfluence(composed: UgcComposedGraph, opaque: ReadonlyMap<string, ReadonlySet<string>> = new Map()): Map<string, Set<string>> {
  const parts = readParts(composed)
  const starts: Entry[] = []
  for (const { key, node } of ugcComposedCreators(composed)) {
    for (const from of photoInputFeeders(parts.get(key)!, idOf(node)!)) starts.push([key, from])
  }
  for (const [key, id] of photoSinks(composed, opaque)) {
    const part = parts.get(key)
    for (const from of part?.feeds.parents.get(id) ?? []) starts.push([key, from])
  }
  // A creator whose image feeds another creator's photo is in the set, with what feeds it.
  return walkUp(parts, starts, new Set())
}

/** Every node of a composed graph whose value can flow into one UGC Creator's photo input: the creator `creatorId` in the graph at `key`. */
export function ugcCreatorPhotoInfluence(composed: UgcComposedGraph, key: string, creatorId: string): Map<string, Set<string>> {
  const parts = readParts(composed)
  const part = parts.get(key)
  if (!part) return new Map()
  return walkUp(parts, photoInputFeeders(part, creatorId).map((from) => [key, from] as const), new Set([entryKey([key, creatorId])]))
}

/**
 * A node type whose output can never carry an image into a photo: a picker or a Text node, or a node
 * that hands out text or audio alone. A dynamic carrier (a List, a sub-workflow) can carry one.
 */
export function carriesNoImage(type: string): boolean {
  if (type === "text-prompt" || PARAMETER_NODE_TYPES.has(type)) return true
  if (DYNAMIC_PRODUCER_TYPES.has(type)) return false
  const output = getOutputType(type)
  return output === "text" || output === "audio"
}

/** Where one creator's photo can come from as an image (`ugcCreatorPhotoSources`). */
export interface UgcCreatorPhotoSources {
  /** The nodes, graph by graph, that can carry an image into the photo: the creator's set without the nodes that carry none. */
  readonly image: Map<string, Set<string>>
  /**
   * The nodes, graph by graph, that set up a node that makes the image in the run from nothing an
   * image brings it (an image producer with no image-carrying feeder in `image`): the Text nodes
   * and pickers that feed it.
   */
  readonly originFeeders: Map<string, Set<string>>
}

/**
 * Where one creator's photo can come from as an image: its photo influence set without the nodes
 * that carry no image (a value the runner gives one of those is no photo), and what sets up a node
 * that makes the image in the run (a value the runner gives one of those makes it).
 */
export function ugcCreatorPhotoSources(
  composed: UgcComposedGraph,
  key: string,
  creatorId: string,
  /** Read from every input of the node, not only a creator's photo input: a component holding a My photo creator, which is never walked into. */
  opts: { readonly everyInput?: boolean } = {},
): UgcCreatorPhotoSources {
  const parts = readParts(composed)
  const part = parts.get(key)
  if (!part) return { image: new Map(), originFeeders: new Map() }
  const feeders = opts.everyInput ? [...(part.feeds.parents.get(creatorId) ?? [])] : photoInputFeeders(part, creatorId)
  const image = walkUp(parts, feeders.map((from) => [key, from] as const), new Set([entryKey([key, creatorId])]), (n) => !carriesNoImage(typeOf(n)))
  const originFeeders = new Map<string, Set<string>>()
  for (const [partKey, ids] of image) {
    const read = parts.get(partKey)!
    for (const id of ids) {
      const node = read.byId.get(id)
      if (!IMAGE_PRODUCER_TYPES.has(typeOf(node)) || typeOf(node) === "upload-image") continue
      const feeders = read.feeds.parents.get(id) ?? []
      // An image producer fed by something that can carry an image makes it from that image.
      if (feeders.some((from) => ids.has(from))) continue
      for (const from of feeders) if (carriesNoImage(typeOf(read.byId.get(from)))) add(originFeeders, partKey, from)
    }
  }
  return { image, originFeeders }
}

/** The ONE strip set over a composed graph (see the file comment), and its (a) part. */
export interface UgcStripSet {
  /** Every node, graph by graph, that ships empty: (a) and (b). Every composed key has an entry. */
  readonly strip: ReadonlyMap<string, ReadonlySet<string>>
  /** (a): every node whose value can flow into a creator's photo input. */
  readonly photo: ReadonlyMap<string, ReadonlySet<string>>
  /** The nodes that take the photo themselves: a component holding a UGC video, a node whose graph could not be read. */
  readonly sinks?: ReadonlyMap<string, ReadonlySet<string>>
  /**
   * The nodes that hold a tainted value of their own (`ugcHoldsTaint`): the author's photo or a UGC
   * render used again elsewhere — a copy of the photo's upload, a take dropped into an Upload Video.
   * Roots of (b), stripped strictly.
   */
  readonly promoted?: ReadonlyMap<string, ReadonlySet<string>>
  /** The composition's tainted values (ugc-taint.ts): what no node keeps at any address. */
  readonly taint?: UgcTaint
}

/**
 * The strip set (see the file comment): (a) the photo influence set, and (b) everything downstream of
 * it or of a root. A node outside it that holds a tainted value of its own joins as a root, and the set
 * and its taint are read again until nothing more joins. `storage` names the deployment's own storage,
 * so an address on it compares by the object it names.
 */
export function ugcStripSet(
  composed: UgcComposedGraph,
  opaque: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  opts: { readonly storage?: UgcStorageKey } = {},
): UgcStripSet {
  const parts = readParts(composed)
  const photo = ugcPhotoInfluence(composed, opaque)
  const holders = ugcHoldersOfUgc(composed)
  // Where each sub-workflow graph's output can come from, read once per graph.
  const outputs = new Map<string, ReadonlySet<string>>()
  for (const [key, part] of parts) {
    if (part.path.length === 0 || part.component) continue
    const sub = parts.get(ugcComposedKey(part.path.slice(0, -1)))?.byId.get(part.path[part.path.length - 1]!)
    if (sub && typeOf(sub) === "sub-workflow") outputs.set(key, new Set(outputSide(part, sub)))
  }
  // A component's snapshot (and what it holds) ships as its own publish left it, and runs by its own
  // route: nothing in it is named.
  const insideComponent = (key: string) => {
    const path = ugcComposedPath(key)
    return path.some((_, i) => parts.get(ugcComposedKey(path.slice(0, i + 1)))?.component === true)
  }
  const sinks = new Map<string, Set<string>>()
  for (const [key, id] of photoSinks(composed, opaque)) add(sinks, key, id)
  const promoted = new Map<string, Set<string>>()
  const closure = (): Map<string, Set<string>> => {
    const strip = new Map<string, Set<string>>([...composed.keys()].map((key) => [key, new Set<string>()]))
    const queue: Entry[] = []
    for (const [key, ids] of photo) for (const id of ids) queue.push([key, id])
    for (const [key, ids] of holders) for (const id of ids) queue.push([key, id])
    for (const [key, ids] of opaque) for (const id of ids) queue.push([key, id])
    for (const [key, ids] of promoted) for (const id of ids) queue.push([key, id])
    for (const [key, part] of parts) for (const [id, node] of part.byId) if (UGC_NODE_TYPES.has(typeOf(node))) queue.push([key, id])
    while (queue.length > 0) {
      const [key, id] = queue.shift()!
      const part = parts.get(key)
      if (!part || !part.byId.has(id) || insideComponent(key) || !add(strip, key, id)) continue
      for (const next of part.feeds.children.get(id) ?? []) {
        queue.push([key, next])
        // Into a sub-workflow: what this node feeds it reaches the sub-workflow's input nodes.
        const childKey = ugcComposedKey([...part.path, next])
        const child = typeOf(part.byId.get(next)) === "sub-workflow" ? parts.get(childKey) : undefined
        if (child && !child.component) for (const [childId, node] of child.byId) if (typeOf(node) === "sub-workflow-input") queue.push([childKey, childId])
      }
      // Out of a sub-workflow: what its output can come from reaches the sub-workflow node above.
      if (outputs.get(key)?.has(id)) queue.push([ugcComposedKey(part.path.slice(0, -1)), part.path[part.path.length - 1]!])
    }
    return strip
  }
  let strip = closure()
  let taint = ugcTaintOf(composed, { strip, photo, sinks, promoted }, opts)
  // A node that holds the author's photo or a UGC render of its own, outside the set: a root too.
  for (let round = 0; round < 32; round++) {
    let joined = false
    for (const [key, part] of parts) {
      if (insideComponent(key)) continue
      for (const [id, node] of part.byId) {
        if (strip.get(key)?.has(id) || !ugcHoldsTaint(taint, node)) continue
        add(promoted, key, id)
        joined = true
      }
    }
    if (!joined) break
    strip = closure()
    taint = ugcTaintOf(composed, { strip, photo, sinks, promoted }, opts)
  }
  return { strip, photo, sinks, promoted, taint }
}
