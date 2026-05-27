import { isValidGenerateImageConnection } from "./generate-image-handles"
import { isValidGenerateVideoConnection } from "./generate-video-handles"
import { FFMPEG_NODE_TYPES, isValidFfmpegConnection } from "./ffmpeg-handles"
import {
  isValidListNodeConnection,
  isValidWebScrapeConnection,
  isValidExtractFieldConnection,
  isValidFilterListConnection,
  isValidDeduplicateConnection,
  isValidMergeListsConnection,
  isValidSortListConnection,
  isValidLoopCoarse,
} from "./data-handles"
import { isVisualPickerType } from "./parameter-picker-types"
import { ACCEPTS_CHARACTER_REF, ACCEPTS_PARAMETER_PICKER } from "./target-handle-registry"

const MEDIA_ONLY_HANDLES: ReadonlySet<string> = new Set([
  "image",
  "video",
  "audio",
  "startFrame",
  "endFrame",
  "video1",
  "video2",
  "video3",
  "video4",
  "audio1",
  "audio2",
  "audio3",
  "audio4",
  "audio5",
  "ref-audio",
])

export interface ConnectionShape {
  readonly source?: string | null
  readonly target?: string | null
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

export interface EdgeShape {
  readonly source: string
  readonly target: string
}

/**
 * Adjacency index: source-id → list of target-ids. Build once per
 * connection-validation pass (memoize on the edges array) and reuse across
 * every probe — the alternative, rescanning all edges per probe, is
 * O(N×E) and gets very slow on large flows during drag-to-connect (React
 * Flow probes isValidConnection on every cursor move).
 */
export type AdjacencyIndex = ReadonlyMap<string, readonly string[]>

export function buildAdjacency(edges: readonly EdgeShape[]): AdjacencyIndex {
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    const arr = adj.get(e.source)
    if (arr) arr.push(e.target)
    else adj.set(e.source, [e.target])
  }
  return adj
}

/**
 * Pure validity check for a workflow connection. Mirrors the rules enforced
 * by `<ReactFlow isValidConnection>` in `workflow-canvas.tsx` so any code path
 * that creates edges outside of drag-to-connect (e.g., HandlePopover's
 * Connect button) can reuse the SAME rules without duplicating logic.
 *
 * Pass `getNodeType(id)` so the helper stays decoupled from React Flow's
 * `getNode` API — call sites either reach into the store or the React Flow
 * instance and project to just the type string.
 *
 * Pass `graph` (a precomputed `AdjacencyIndex`) to enable acyclic-DAG
 * enforcement (rejects self-loops and connections whose target already has
 * a downstream path to the source). Optional so call sites without the
 * edge list still get type-validation; every UI surface should pass it.
 */
export function isValidWorkflowConnection(
  connection: ConnectionShape,
  getNodeType: (id: string) => string | undefined,
  graph?: AdjacencyIndex,
): boolean {
  // Helper to resolve a connection endpoint to its node type. Uses the
  // ternary form (not `?? ""`) so we don't do a Map lookup with an empty-
  // string key — both spellings yield the same answer today, but the
  // ternary makes the intent explicit and matches the pattern used below.
  const typeOf = (id: string | null | undefined): string | undefined =>
    id ? getNodeType(id) : undefined

  // Reject self-loops outright (cycle of length 1). Also covers the case
  // where the user drags an output handle back to a different input on the
  // same node — the workflow engine is a DAG and cannot execute a node
  // before itself.
  if (connection.source && connection.target && connection.source === connection.target) {
    return false
  }

  // Reject any connection that would close a directed cycle. Starting from
  // the prospective target, DFS downstream along existing edges — if we
  // reach the prospective source, adding source→target closes a cycle.
  if (graph && connection.source && connection.target) {
    if (wouldCreateCycle(graph, connection.source, connection.target)) {
      return false
    }
  }

  // Composition output may ONLY target render-video. (Same rule as in
  // workflow-canvas.tsx::isValidConnection.)
  if (connection.sourceHandle === "composition") {
    return typeOf(connection.target) === "render-video"
  }

  // JSON output cannot feed media-only inputs.
  if (connection.sourceHandle === "json") {
    const th = connection.targetHandle ?? ""
    if (MEDIA_ONLY_HANDLES.has(th)) return false
  }

  // Generate Image v2.1 — enforce typed-handle compatibility.
  const targetType = typeOf(connection.target)
  if (targetType === "generate-image" && connection.targetHandle) {
    const sourceType = typeOf(connection.source)
    // Use `?? ""` and let the predicate's switch reject unknown source
    // types — safer than `if (sourceType) ... else fall through to true`,
    // which silently allows malformed connections with an undefined source.
    return isValidGenerateImageConnection(
      connection.targetHandle,
      sourceType ?? "",
      isVisualPickerType,
    )
  }

  // Camera Motion — startState/endState only accept hint-producer nodes
  // (their wires carry prompt fragments, not image frames; see
  // packages/shared/src/parameter-prompt-hint.ts:195-307). Other handles
  // (legacy/external) are not validated here.
  if (targetType === "camera-motion" && connection.targetHandle) {
    if (connection.targetHandle !== "startState" && connection.targetHandle !== "endState") {
      return true
    }
    // `?? ""` so unknown / undefined source types route to the predicate's
    // negative branch instead of falling through to default `return true`.
    return ACCEPTS_PARAMETER_PICKER(typeOf(connection.source) ?? "")
  }

  // Transition — same semantics as camera-motion. startState/endState wires
  // carry prompt hints, not image frames; see
  // packages/shared/src/parameter-prompt-hint.ts:150-176.
  if (targetType === "transition" && connection.targetHandle) {
    if (connection.targetHandle !== "startState" && connection.targetHandle !== "endState") {
      return true
    }
    return ACCEPTS_PARAMETER_PICKER(typeOf(connection.source) ?? "")
  }

  // Character-fx — `target` accepts ONLY identity refs (character/face/
  // object/location). The shared hint-builder reads `characterName` etc.
  // from the source; see packages/shared/src/parameter-prompt-hint.ts:178-202.
  if (targetType === "character-fx" && connection.targetHandle) {
    if (connection.targetHandle !== "target") return true
    return ACCEPTS_CHARACTER_REF(typeOf(connection.source) ?? "")
  }

  // Generate Video — enforce typed-handle compatibility.
  if (targetType === "generate-video" && connection.targetHandle) {
    const sourceType = typeOf(connection.source)
    if (sourceType) {
      return isValidGenerateVideoConnection(
        connection.targetHandle,
        sourceType,
        isVisualPickerType,
      )
    }
  }

  // FFmpeg / pure-processing nodes (trim-video, combine-videos,
  // merge-video-audio, extract-frame, loop-video, resize-video,
  // add-captions, trim-audio, adjust-volume, combine-audio, mix-audio).
  // Shared validator in `ffmpeg-handles.ts` — all 11 nodes route through
  // a single switch so the type rules stay co-located. `?? ""` so unknown
  // / undefined source types route to the predicate's negative branch
  // instead of falling through to default `return true`.
  if (targetType && FFMPEG_NODE_TYPES.has(targetType) && connection.targetHandle) {
    return isValidFfmpegConnection(
      targetType,
      connection.targetHandle,
      typeOf(connection.source) ?? "",
    )
  }

  // ─── Data root-category nodes ─────────────────────────────────────────
  // Each predicate covers one node's full set of typed input handles. The
  // loop-node case uses a coarse gate (any-column-type producer) because
  // the per-column accepts depend on the column's type stored in node
  // data — unreachable from `getNodeType`. Per-column refinement happens
  // in `loop-node.tsx`'s per-pip `accepts` predicate (which drives the
  // drag-glow visual and popover candidate filtering).
  if (targetType === "list" && connection.targetHandle) {
    return isValidListNodeConnection(
      connection.targetHandle,
      typeOf(connection.source) ?? "",
      isVisualPickerType,
    )
  }
  if (targetType === "web-scrape" && connection.targetHandle) {
    return isValidWebScrapeConnection(
      connection.targetHandle,
      typeOf(connection.source) ?? "",
    )
  }
  if (targetType === "extract-field" && connection.targetHandle) {
    return isValidExtractFieldConnection(
      connection.targetHandle,
      typeOf(connection.source) ?? "",
    )
  }
  if (targetType === "filter-list" && connection.targetHandle) {
    return isValidFilterListConnection(
      connection.targetHandle,
      typeOf(connection.source) ?? "",
      isVisualPickerType,
    )
  }
  if (targetType === "deduplicate" && connection.targetHandle) {
    return isValidDeduplicateConnection(
      connection.targetHandle,
      typeOf(connection.source) ?? "",
    )
  }
  if (targetType === "merge-lists" && connection.targetHandle) {
    return isValidMergeListsConnection(
      connection.targetHandle,
      typeOf(connection.source) ?? "",
    )
  }
  if (targetType === "sort-list" && connection.targetHandle) {
    return isValidSortListConnection(
      connection.targetHandle,
      typeOf(connection.source) ?? "",
    )
  }
  if (targetType === "loop" && connection.targetHandle) {
    // Coarse gate applies to BOTH col_add and per-column handles. Identity
    // refs (character/face/object/location) and other non-producer source
    // types are rejected outright — they have no sensible mapping in
    // detectLoopColumnType's type-inference. Pickers, media producers,
    // and data producers pass; the col_add handler then auto-detects the
    // column type from the source, and per-column refinement happens in
    // the loop component's per-pip `accepts` predicate.
    return isValidLoopCoarse(typeOf(connection.source) ?? "", isVisualPickerType)
  }

  return true
}

/**
 * DFS downstream from `newTarget` along the adjacency index. Returns true
 * iff we can reach `newSource` — meaning a path `newTarget → … → newSource`
 * already exists, and adding `newSource → newTarget` would close a cycle.
 *
 * DFS over BFS: `stack.pop()` is O(1) where `Array.prototype.shift()` is
 * O(n) on a growing queue — a big deal on dense flows. Reachability is
 * direction-agnostic, so DFS is equally correct here.
 *
 * Uses a visited set so dense graphs don't re-explore subtrees. Early-exits
 * the moment `newSource` is hit (typical case: small bounce on a sink).
 */
function wouldCreateCycle(
  adj: AdjacencyIndex,
  newSource: string,
  newTarget: string,
): boolean {
  const visited = new Set<string>()
  const stack: string[] = [newTarget]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === newSource) return true
    if (visited.has(current)) continue
    visited.add(current)
    const outs = adj.get(current)
    if (outs) {
      for (const t of outs) {
        if (!visited.has(t)) stack.push(t)
      }
    }
  }
  return false
}

/**
 * Returns the set of nodes reachable downstream from `root` (inclusive).
 * Run ONCE per consumer in callers that probe many candidate sources —
 * any candidate whose id is in this set would create a cycle if used as
 * the source of an edge into `root`, so candidate filtering collapses
 * from O(N × cycle-BFS) to O(1) membership tests after a single O(V+E)
 * traversal.
 */
export function collectDescendants(
  adj: AdjacencyIndex,
  root: string,
): ReadonlySet<string> {
  const visited = new Set<string>()
  const stack: string[] = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    const outs = adj.get(current)
    if (outs) {
      for (const t of outs) {
        if (!visited.has(t)) stack.push(t)
      }
    }
  }
  return visited
}

/**
 * Reverse adjacency: target-id → list of source-ids. Together with
 * `collectDescendants` this gives ancestor traversal — pass the reverse
 * adjacency as the `adj` arg and the function walks UPSTREAM.
 *
 * Same one-pass build complexity as `buildAdjacency` (O(E)), so building
 * both forward + reverse off a single edges array is still O(E) total.
 */
export function buildReverseAdjacency(edges: readonly EdgeShape[]): AdjacencyIndex {
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    const arr = adj.get(e.target)
    if (arr) arr.push(e.source)
    else adj.set(e.target, [e.source])
  }
  return adj
}

/**
 * Single-entry memo of `collectDescendants(buildReverseAdjacency(edges), fromNodeId)`
 * — the set of nodes that can reach `fromNodeId` upstream, i.e. the
 * ancestors of `fromNodeId` (inclusive of itself).
 *
 * Why a module-level cache: during a drag-to-connect, every visible
 * HandleWithPopover re-derives `isValidCandidate` and needs to ask
 * "would my node create a cycle if I accept this drag?" The answer
 * depends only on (edges ref, drag-source nodeId) — both stable for the
 * duration of one drag. Without the cache, each handle (often dozens
 * per visible viewport) would rebuild the same reverse adjacency + run
 * the same DFS, O(V+E) per handle. With the cache, exactly one of them
 * pays that cost; the rest hit the cache.
 *
 * Cache invalidates on any change to `edges` reference or `fromNodeId`,
 * which matches every drag start/end and every edge mutation.
 */
let cachedAncestorsEdges: readonly EdgeShape[] | null = null
let cachedAncestorsFromId: string | null = null
let cachedAncestorsResult: ReadonlySet<string> | null = null

export function getDragAncestorSet(
  edges: readonly EdgeShape[],
  fromNodeId: string,
): ReadonlySet<string> {
  if (
    edges === cachedAncestorsEdges &&
    fromNodeId === cachedAncestorsFromId &&
    cachedAncestorsResult !== null
  ) {
    return cachedAncestorsResult
  }
  const result = collectDescendants(buildReverseAdjacency(edges), fromNodeId)
  cachedAncestorsEdges = edges
  cachedAncestorsFromId = fromNodeId
  cachedAncestorsResult = result
  return result
}
