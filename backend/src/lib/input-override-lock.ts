/**
 * The run-request override lock (issue #1555).
 *
 * A run request's `inputOverrides` is a per-node field map merged over the
 * saved node data — the mechanism behind every published-app input, every
 * share-for-run input card and the SDK's `promptPrefix` escape hatch. Five
 * entry points accept it (`/v1/workflows/:id/run`, `/v1/app/:slug/run`,
 * `/v1/present/:token/run`, `/v1/component/execute`, `/v1/api/run`) and all of
 * them meet the graph in ONE place: `applyInputOverridesToNodes`.
 *
 * What none of them may do is re-point an OUTBOUND node. A published app runs
 * the creator's snapshot for a stranger; if that stranger could set the `url`
 * of a Webhook Output, the run's outputs would be POSTed to a host the stranger
 * chose. So: an override that sets a destination-shaped field (`isLockedField`)
 * on a node in `DENIED_NODE_TYPES` is refused — at the route with a 400 where
 * the graph is already in hand, and unconditionally at the merge. Ordinary
 * fields on those nodes (a caption, a limit) stay overridable; destination
 * fields on ordinary nodes (an upload's `url`) stay overridable too. The
 * vocabulary is the copilot's, in `lib/outbound-node-lock.ts`.
 *
 * The lock also refuses every key of a UGC node that is not in the allow-list
 * `UGC_OVERRIDABLE_FIELDS` (`@nodaro/shared`): a runner may choose a creator's
 * source, gender and photo and a script's length, but may never inject a run's
 * state (a kept creator, a plan, a clip ticket) into the publisher's graph.
 */

import { findUgcLockedFields } from "@nodaro/shared"
import {
  DENIED_NODE_TYPES,
  OUTBOUND_SELECTOR_FIELDS,
  isPlainObject,
  lockedFieldPaths,
} from "./outbound-node-lock.js"

export interface LockedOverride {
  readonly nodeId: string
  readonly nodeType: string
  /** Dotted path of the refused field inside the node's override map. */
  readonly field: string
  /** Why it is refused. Absent means an outbound-node destination. */
  readonly kind?: "outbound" | "ugc"
}

/** The node shape the lock needs — id and type; data is irrelevant. */
export interface LockableNode {
  readonly id: string
  readonly type?: string
}

/**
 * Every override entry that would set a locked field on an outbound node, or
 * any non-allow-listed key on a UGC node. Pure: neither argument is touched.
 *
 * Walks the GRAPH and looks each node up in the map — the same iteration and
 * the same `inputOverrides[node.id]` lookup `applyInputOverridesToNodes` does
 * — so the two can never disagree about which nodes an entry reaches: a
 * numeric id coerces identically on both sides, and a duplicated id is checked
 * for every node that carries it, exactly as the merge writes to every one of
 * them. An entry whose id matches no node is not a violation — nothing merges
 * onto a node that does not exist, and the run route already drops such entries.
 */
export function findLockedOverrides(
  nodes: ReadonlyArray<LockableNode> | null | undefined,
  inputOverrides: Record<string, Record<string, unknown>> | null | undefined,
): LockedOverride[] {
  if (!inputOverrides || !nodes) return []
  const found: LockedOverride[] = []
  const seen = new Set<string>()
  for (const node of nodes) {
    if (!node) continue
    const nodeType = node.type
    if (typeof nodeType !== "string" || !DENIED_NODE_TYPES.has(nodeType)) continue
    const fields = inputOverrides[node.id]
    if (!isPlainObject(fields)) continue
    const nodeId = String(node.id)
    // One walk for destinations AND selectors, so a selector reached through a
    // nested object (`fieldMappings.mode`) is refused exactly like a nested url.
    for (const field of lockedFieldPaths(fields, "", { extraKeys: OUTBOUND_SELECTOR_FIELDS })) {
      const key = `${nodeId}\u0000${field}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ nodeId, nodeType, field, kind: "outbound" })
    }
  }
  for (const entry of findUgcLockedFields(nodes, inputOverrides)) {
    const key = `${entry.nodeId}\u0000${entry.field}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ ...entry, kind: "ugc" })
  }
  return found
}

/** How many refusals the message spells out; the rest are counted. */
const MESSAGE_MAX_ENTRIES = 10
/** Longest field path echoed back — a path is caller-shaped, so it is bounded too. */
const MESSAGE_MAX_PATH_CHARS = 120

function clip(value: string, max: number): string {
  // Code points, not UTF-16 units — a cut inside a surrogate pair would put a
  // lone surrogate into an error_message column.
  const chars = [...value]
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : value
}

/**
 * The caller-facing sentence. Names the field, the node type and the node id
 * — all three came from the request — and never the node's current value.
 * Bounded: at most `MESSAGE_MAX_ENTRIES` refusals spelled out, each path
 * clipped, so a body stuffed with locked keys cannot echo itself back as a
 * megabyte 400 or a megabyte `error_message`.
 */
export function describeLockedOverrides(locked: ReadonlyArray<LockedOverride>): string {
  const shown = locked.slice(0, MESSAGE_MAX_ENTRIES)
  const rest = locked.length - shown.length
  const outbound = shown.filter((entry) => entry.kind !== "ugc")
  const ugc = shown.filter((entry) => entry.kind === "ugc")
  const parts: string[] = []
  if (outbound.length > 0) {
    const list =
      outbound
        .map(
          (entry) =>
            `"${clip(entry.field, MESSAGE_MAX_PATH_CHARS)}" on ${entry.nodeType} node "${clip(entry.nodeId, MESSAGE_MAX_PATH_CHARS)}"`,
        )
        .join(", ") + (ugc.length === 0 && rest > 0 ? `, and ${rest} more` : "")
    parts.push(
      "inputOverrides cannot set a destination — or the selector that chooses one — on an outbound node: " +
        `where a workflow sends to or fetches from is decided by the workflow itself, not by a run request. Refused: ${list}`,
    )
  }
  for (const entry of ugc) {
    parts.push(
      `inputOverrides cannot set "${clip(entry.field, MESSAGE_MAX_PATH_CHARS)}" on a UGC node "${clip(entry.nodeId, MESSAGE_MAX_PATH_CHARS)}".`,
    )
  }
  // With a UGC sentence in the message the overflow cannot ride on the outbound list.
  if (ugc.length > 0 && rest > 0) parts.push(`${rest} more refused.`)
  return parts.join(" ")
}

/** Thrown by the merge; the orchestrator turns it into a failed execution. */
export class LockedOverrideError extends Error {
  readonly code = "locked_field" as const
  readonly locked: ReadonlyArray<LockedOverride>

  constructor(locked: ReadonlyArray<LockedOverride>) {
    super(describeLockedOverrides(locked))
    this.name = "LockedOverrideError"
    this.locked = locked
  }
}

/** Refuse the whole request when any entry is locked — nothing partial. */
export function assertNoLockedOverrides(
  nodes: ReadonlyArray<LockableNode> | null | undefined,
  inputOverrides: Record<string, Record<string, unknown>> | null | undefined,
): void {
  const locked = findLockedOverrides(nodes, inputOverrides)
  if (locked.length > 0) throw new LockedOverrideError(locked)
}
