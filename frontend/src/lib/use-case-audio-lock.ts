/**
 * The audio lock of a use-case node (Tighten Episode, Clip Pack — decided
 * 2026-10-18): an audio-only recording wired into `media` turns the picture
 * settings off (no framing, no captions — the run reads them so), and the
 * person's own values are remembered on the node, so wiring a video again
 * gives them back.
 *
 * It is an invariant of the graph, not of a panel: the workflow store applies
 * it whenever the kind of recording on a node's wire changes
 * (`usecaseAudioLockGraph`, from its one `set`), in the same write as the
 * change itself — one undo step, whether the panel is open or not, for a
 * drawn wire, a deleted one, a paste, an import or an upstream Output
 * switched. A graph adopted as stored (a load, a remote change, a save
 * conflict's merge) is taken as it is; the first lock on it — the panel's
 * fail-safe snapping the forced values — remembers what the node then held.
 *
 * What was set is kept in `settingsBeforeAudio`, an editor-only lever: a key
 * present holds the value it had (a `null` framing is "None"), a key absent
 * was never set (it comes back as the run's default). An edit of one of those
 * settings while the memory is held wins: it replaces the remembered value,
 * so the next video wire gives back the edit. The server's run never reads
 * it (a run sends only its descriptor's setting keys), and a node preset
 * never carries it (`PRESET_EXCLUDED_KEYS`). Pure.
 */
import {
  USE_CASE_NODE_TYPES,
  bypassTeleports,
  isUseCaseNodeType,
  usecaseDescriptor,
  usecaseRecordingsKind,
  usecaseRunMaxRecordings,
} from "@nodaro/render-rules"
import { usecaseCarriedWiresOver } from "@/lib/use-case-wired-recordings"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/** The node field the remembered values live in. */
export const SETTINGS_BEFORE_AUDIO = "settingsBeforeAudio"

/**
 * What an audio recording forces on each node type that has the lock: every
 * use-case node whose spec declares it (`audioForced` — Tighten Episode's
 * output and captions, its framing only hidden on an audio episode, never
 * cleared; Clip Pack's framing and captions).
 */
export const USE_CASE_AUDIO_LOCKS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze(Object.fromEntries(
  USE_CASE_NODE_TYPES.flatMap((t) => {
    const forced = usecaseDescriptor(t).audioForced
    return forced ? [[t, forced] as const] : []
  }),
))

type Data = Readonly<Record<string, unknown>>
type Patch = Record<string, unknown>

const memoryOf = (data: Data): Data | undefined => {
  const m = data[SETTINGS_BEFORE_AUDIO]
  return m && typeof m === "object" && !Array.isArray(m) ? (m as Data) : undefined
}

/**
 * The one write the recording on the wire asks of a node, or undefined when
 * it already reads as it should:
 *  - audio: the forced values, with what was set remembered (only on the
 *    first lock — a lock already in place keeps what it remembered);
 *  - video: what was remembered, given back, and the memory cleared;
 *  - nothing wired (or not known): nothing.
 */
export function usecaseAudioLockPatch(
  wired: "audio" | "video" | undefined,
  data: Data,
  forced: Readonly<Record<string, unknown>>,
): Patch | undefined {
  const keys = Object.keys(forced)
  const memory = memoryOf(data)
  if (wired === "audio") {
    if (keys.every((k) => data[k] === forced[k])) return undefined
    const remember = memory ? {} : { [SETTINGS_BEFORE_AUDIO]: Object.fromEntries(keys.filter((k) => data[k] !== undefined).map((k) => [k, data[k]])) }
    return { ...remember, ...forced }
  }
  if (wired === "video" && memory) {
    return { ...Object.fromEntries(keys.map((k) => [k, k in memory ? memory[k] : undefined])), [SETTINGS_BEFORE_AUDIO]: undefined }
  }
  return undefined
}

/**
 * The kind of the recordings a run of node `id` reads, by the run's own rules
 * (decided 2026-10-18): the wires into `media` in the node's order, as many
 * as this viewer's run reads (`usecaseRecordingsOf`, `usecaseRunMaxRecordings`
 * — the first alone unless `multicam`), each kind by the estimate's rule
 * (`usecaseMediaKindOf`); video when any has picture, audio only when every
 * one is sound only (`usecaseRecordingsKind`); undefined when nothing is
 * wired. `masterAudio` is another handle and never counts. A wire through a
 * Teleport pair is judged by what it carries (raw or carried edges alike).
 */
export function usecaseWiredMediaKind(id: string, nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], multicam = false): "audio" | "video" | undefined {
  return kindOverCarried(id, nodes, bypassTeleports(nodes, edges), multicam)
}

/**
 * `usecaseWiredMediaKind` over edges already carried through any Teleport
 * pair: a wire is ordered by the id it was drawn from (the key `mediaOrder`
 * is saved under) and judged by the node it carries.
 */
function kindOverCarried(id: string, nodes: readonly WorkflowNode[], carried: readonly WorkflowEdge[], multicam: boolean): "audio" | "video" | undefined {
  const node = nodes.find((n) => n.id === id)
  const type = node?.type ?? undefined
  const max = isUseCaseNodeType(type) ? usecaseDescriptor(type).maxRecordings : 1
  // The one wire reader (lib/use-case-wired-recordings.ts), as many as this viewer's run reads.
  const { recordings } = usecaseCarriedWiresOver({ id, data: node?.data }, usecaseRunMaxRecordings(max, multicam), nodes, carried)
  return recordings.length === 0 ? undefined : usecaseRecordingsKind(recordings.map((r) => r.kind))
}

const isForced = (data: Data, forced: Readonly<Record<string, unknown>>): boolean => Object.keys(forced).every((k) => data[k] === forced[k])

/**
 * What a write to a locked node itself asks of it, judged against the node as
 * it was (`prev`) and the recording now on its wire:
 *  - a manual edit of a remembered setting wins: the memory takes the edited
 *    value (an edit back to unset forgets it) — and, while an audio recording
 *    is wired, the setting itself stays forced, so the stored data keeps
 *    reading as the run reads it. The forced value written while audio is
 *    wired is not an edit;
 *  - the first lock on a graph that arrived already wired (the panel's
 *    fail-safe writing the forced values onto a node with no memory)
 *    remembers what the node held before that write.
 * `undefined` when the write asks nothing more.
 */
function ownWritePatch(prev: Data, next: Data, forced: Readonly<Record<string, unknown>>, wired: "audio" | "video" | undefined): Patch | undefined {
  const memory = memoryOf(next)
  const keys = Object.keys(forced)
  if (!memory) {
    if (wired !== "audio" || isForced(prev, forced) || !isForced(next, forced)) return undefined
    return { [SETTINGS_BEFORE_AUDIO]: Object.fromEntries(keys.filter((k) => prev[k] !== undefined).map((k) => [k, prev[k]])) }
  }
  let changed = false
  const kept: Patch = { ...memory }
  for (const key of keys) {
    if (next[key] === prev[key] || (wired === "audio" && next[key] === forced[key])) continue
    changed = true
    if (next[key] === undefined) delete kept[key]
    else kept[key] = next[key]
  }
  if (!changed) return undefined
  return { [SETTINGS_BEFORE_AUDIO]: kept, ...(wired === "audio" ? forced : {}) }
}

const isLocked = (n: WorkflowNode): boolean => !!n.type && n.type in USE_CASE_AUDIO_LOCKS

/** The nodes whose data a write changed (or that it added), by id. */
function changedIds(prevNodes: readonly WorkflowNode[], nodes: readonly WorkflowNode[]): Set<string> {
  const out = new Set<string>()
  if (prevNodes.length === nodes.length) {
    // The common case — an update in place — compared index by index, no map.
    let aligned = true
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i]!.id !== prevNodes[i]!.id) { aligned = false; break }
      if (nodes[i]!.data !== prevNodes[i]!.data) out.add(nodes[i]!.id)
    }
    if (aligned) return out
    out.clear()
  }
  const before = new Map(prevNodes.map((n) => [n.id, n.data]))
  for (const n of nodes) if (before.get(n.id) !== n.data) out.add(n.id)
  return out
}

/**
 * The graph's nodes once the lock holds, after a store write from
 * (`prevNodes`, `prevEdges`) to (`nodes`, `edges`). A locked node is locked
 * or given back when the KIND of recording on its `media` wire changes — a
 * wire drawn or removed, or an upstream node's Output switched between video
 * and audio — judged on the graph as this write leaves it, and repeated to a
 * fixpoint so a chain locks in one write (Upload Audio → Tighten Episode →
 * Clip Pack: Clip Pack sees Tighten's forced audio). A write to a locked node
 * itself is judged by `ownWritePatch`. A write that changes neither the wire
 * kinds nor a locked node (a selection, an edge's own settings, a move) is
 * handed back untouched: `nodes` itself, the same array.
 */
export function usecaseAudioLockGraph(
  prevNodes: readonly WorkflowNode[],
  prevEdges: readonly WorkflowEdge[],
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  /** The viewer's run reads several recordings (`usecaseMulticamOffered`): the lock judges what that run reads. */
  opts: { readonly multicam?: boolean } = {},
): readonly WorkflowNode[] {
  const multicam = opts.multicam === true
  const edgesChanged = edges !== prevEdges
  if (!edgesChanged && nodes === prevNodes) return nodes
  if (!nodes.some(isLocked)) return nodes
  const changed = changedIds(prevNodes, nodes)
  if (!edgesChanged && changed.size === 0) return nodes

  let current = nodes as WorkflowNode[]
  let copied = false
  const index = new Map(nodes.map((n, i) => [n.id, i]))
  const write = (id: string, data: Data) => {
    if (!copied) { current = [...current]; copied = true }
    const i = index.get(id)!
    current[i] = { ...current[i]!, data: data as WorkflowNode["data"] }
  }
  // The wires as they carry (through any Teleport pair): the node types and wires decide it, never a data write.
  const carried = bypassTeleports(nodes, edges)
  let prevCarried: readonly WorkflowEdge[] | undefined
  const prevKinds = new Map<string, "audio" | "video" | undefined>()
  const kindBefore = (id: string) => {
    if (!prevKinds.has(id)) prevKinds.set(id, kindOverCarried(id, prevNodes, (prevCarried ??= bypassTeleports(prevNodes, prevEdges)), multicam))
    return prevKinds.get(id)
  }

  // A write to a locked node itself.
  const before = changed.size > 0 ? new Map(prevNodes.map((n) => [n.id, n])) : undefined
  for (const id of changed) {
    const node = current[index.get(id)!]!
    const prev = before?.get(id)
    if (!isLocked(node) || !prev) continue
    const forced = USE_CASE_AUDIO_LOCKS[node.type!]!
    const patch = ownWritePatch(prev.data as Data, node.data as Data, forced, kindOverCarried(id, current, carried, multicam))
    if (patch) write(id, { ...(node.data as Data), ...patch })
  }

  // The kind on each wire, to a fixpoint (a chain settles in as many passes as it is long).
  let frontier: Set<string> | undefined = edgesChanged ? undefined : changed
  for (let pass = 0; pass <= nodes.length; pass++) {
    const reached = frontier === undefined ? undefined : new Set(edges.filter((e) => frontier!.has(e.source)).map((e) => e.target))
    const locked: string[] = []
    for (const node of current) {
      if (!isLocked(node)) continue
      if (frontier !== undefined && !frontier.has(node.id) && !reached!.has(node.id)) continue
      const after = kindOverCarried(node.id, current, carried, multicam)
      if (after === kindBefore(node.id)) continue
      const patch = usecaseAudioLockPatch(after, node.data as Data, USE_CASE_AUDIO_LOCKS[node.type!]!)
      if (!patch) continue
      write(node.id, { ...(node.data as Data), ...patch })
      locked.push(node.id)
    }
    if (locked.length === 0) break
    frontier = new Set(locked)
  }
  return current
}

/**
 * The panel's fail-safe, for a graph that arrived already wired (a load, a
 * remote change — the store's lock runs on wire-kind changes): an audio
 * recording's forced values, when the node does not read so yet. The store
 * remembers what the node held in that same write (`ownWritePatch`), so a
 * video wired later gives it back.
 */
export function usecaseAudioLockFailSafe(
  wired: "audio" | "video" | undefined,
  data: Data,
  forced: Readonly<Record<string, unknown>>,
): Patch | undefined {
  return wired === "audio" && Object.keys(forced).some((k) => data[k] !== forced[k]) ? { ...forced } : undefined
}
