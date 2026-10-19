/**
 * The ONE reader of what is wired into a use-case node's Recordings and Master
 * audio (decided 2026-10-17) — for its settings panel, the store's audio lock,
 * the store's Cameras invariant and its review, so they cannot read the wires
 * differently:
 *  - the wires are read as they CARRY (`bypassTeleports`, a no-op on edges
 *    already carried): a wire leaving a Teleport Receive is the wire leaving
 *    the node feeding its Send;
 *  - each recording is keyed by the id its wire was DRAWN from
 *    (`drawnSourceId`, the Receive — what `mediaOrder` is saved under, and
 *    what both engines map to the run's ids) and ordered by the node's
 *    `mediaOrder` (`usecaseRecordingsOf`, the run's own rule);
 *  - each is judged, and looked up, by the node it carries (`origin`): its
 *    kind (`usecaseMediaKindOf`, the estimate's rule), and its file in what
 *    the canvas resolver hands the node (keyed by the carried node);
 *  - the Master audio is none when it comes from the node one of the
 *    recordings read comes from (`usecaseDistinctMaster`, compared by the
 *    carried nodes, as both engines compare them).
 * Pure.
 */
import { bypassTeleports, drawnSourceId, usecaseDescriptor, usecaseDistinctMaster, usecaseMediaKindOf, usecaseRecordingsOf, type UseCaseNodeType } from "@nodaro/render-rules"

type GraphNode = { readonly id: string; readonly type?: string | null; readonly data?: unknown }
type GraphEdge = { readonly source: string; readonly target: string; readonly sourceHandle?: string | null; readonly targetHandle?: string | null }

/** One wire into a use-case node, as every reader reads it. */
export interface UseCaseCarriedWire {
  /** The id the wire was drawn from (the key of `mediaOrder` and every per-wire setting). */
  readonly nodeId: string
  /** The node it carries (a Teleport Receive's origin): what the run reads, and what the resolver keys its file by. */
  readonly origin: string
  readonly handle: string | null | undefined
  readonly kind: "video" | "audio"
}

export interface UseCaseCarriedWires {
  /** Every wire into Recordings, in the node's order (one per drawn node). */
  readonly wired: readonly UseCaseCarriedWire[]
  /** The recordings a run reads: `wired` (those `readable`, when asked) up to `maxRecordings`. */
  readonly recordings: readonly UseCaseCarriedWire[]
  /** The Master audio, unless it comes from one of those recordings' nodes. */
  readonly master: UseCaseCarriedWire | undefined
}

/**
 * What a reader may count as a recording: by default every wire; a reader
 * that sees the files (the review) passes the run's own test — a wire whose
 * node holds no file yet is skipped by both engines' resolvers, so the run
 * reads the next one in order.
 */
export interface UseCaseWiresOptions {
  readonly readable?: (wire: UseCaseCarriedWire) => boolean
}

/** The wires into `node` over edges already carried (see the module note). */
export function usecaseCarriedWiresOver(
  node: { readonly id: string; readonly data?: unknown },
  maxRecordings: number,
  nodes: readonly GraphNode[],
  carried: readonly GraphEdge[],
  opts: UseCaseWiresOptions = {},
): UseCaseCarriedWires {
  const into = (handle: string): UseCaseCarriedWire[] =>
    carried.filter((w) => w.target === node.id && w.targetHandle === handle && !!w.source).map((w) => ({
      nodeId: drawnSourceId(w),
      origin: w.source,
      handle: w.sourceHandle,
      kind: usecaseMediaKindOf(nodes.find((n) => n.id === w.source), w.sourceHandle),
    }))
  const wired = usecaseRecordingsOf(into("media"), node.data, Number.MAX_SAFE_INTEGER)
  // The run's rule: the wires that hold a file, in the node's order, up to the limit.
  const recordings = (opts.readable ? wired.filter(opts.readable) : wired).slice(0, maxRecordings)
  const master = into("masterAudio")[0]
  return { wired, recordings, master: master && usecaseDistinctMaster(master.origin, recordings.map((r) => r.origin)) ? master : undefined }
}

/** `usecaseCarriedWiresOver` on the store's raw edges or a panel's carried ones alike. */
export function usecaseCarriedWires(
  node: { readonly id: string; readonly data?: unknown },
  maxRecordings: number,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  opts: UseCaseWiresOptions = {},
): UseCaseCarriedWires {
  return usecaseCarriedWiresOver(node, maxRecordings, nodes, bypassTeleports(nodes, edges), opts)
}

export interface UseCaseWiredRecording {
  readonly nodeId: string
  readonly kind: "video" | "audio"
}

/** What a use-case node's settings panel lists: the recordings its TYPE reads, and its Master audio's drawn id. */
export function usecaseWiredRecordings(
  node: { readonly id: string; readonly type: UseCaseNodeType; readonly data: unknown },
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): { readonly recordings: readonly UseCaseWiredRecording[]; readonly masterId: string | undefined } {
  const w = usecaseCarriedWires(node, usecaseDescriptor(node.type).maxRecordings, nodes, edges)
  return { recordings: w.recordings.map((r) => ({ nodeId: r.nodeId, kind: r.kind })), masterId: w.master?.nodeId }
}
