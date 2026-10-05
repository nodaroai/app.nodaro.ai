/**
 * The duration an Edit Plan node's credit ESTIMATE buckets on — one resolver for
 * every frontend surface that quotes it (the node's cost pill, the config
 * panel's Run button, the Execute badge, the run-confirm dialog, the precheck),
 * so they cannot disagree. It is the MASTER source's known length, read the way
 * both run resolvers read it: master chosen by `master-audio` role → the node's
 * `sourceOrder` → first wired, and resolved THROUGH teleport pairs to the
 * producing node.
 *
 * Unknown → undefined → the tier's CEILING bucket. That is deliberate, and it is
 * why there is NO transcript fallback here even though the reserve has one
 * (`masterRow?.duration ?? transcriptDurationSec(transcript)`): the server reads
 * THIS run's transcript, while the browser only ever holds the PREVIOUS run's.
 * Reusing a workflow for a new, longer episode is the normal case, and this
 * estimate is not display-only — Execute-All prechecks the balance against it.
 * A stale transcript would UNDER-quote, pass the precheck, charge Transcribe and
 * then fail the Edit Plan reserve mid-run. The ceiling over-quotes instead, which
 * refuses up front and charges nothing. A master with no readable length (a
 * URL-sourced one) is fixed at the source — by recording the length on the
 * master node, bound to its media — never by borrowing one from a neighbour.
 */
import { editPlanSourceDurationSec } from "@nodaro/shared"

export interface GraphNode {
  readonly id: string
  readonly type?: string
  readonly data: unknown
}
export interface GraphEdge {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

const dataOf = (n: GraphNode | undefined): Record<string, unknown> | undefined =>
  n?.data as Record<string, unknown> | undefined

/**
 * Design-time length fields some video producers carry INSTEAD of `duration`
 * (render-video `durationSeconds`, video-to-video `videoDuration`, video-retake
 * `videoDurationSec`, edit-video-pro `sourceDurationSec`). The pill read these
 * before it shared this resolver; dropping them would quote the ceiling for a
 * short composition wired in as a source. Each must exist on a node data type —
 * pinned by `__tests__/edit-plan-estimate.test.ts`, because a key nothing writes
 * is silently dead.
 */
export const EDIT_PLAN_LEGACY_DURATION_KEYS = [
  "durationSeconds",
  "videoDuration",
  "videoDurationSec",
  "sourceDurationSec",
] as const

/** Walk a teleport-send/receive chain back to the producing node — the same
 *  transparency both run resolvers apply (frontend `resolveTeleportOrigin`,
 *  backend input-resolver). A teleport node carries no media fields of its own.
 *  Exported for the sibling estimate resolvers (`lib/apply-edl-estimate`). */
export function resolveGraphOrigin(
  start: GraphNode | undefined,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): GraphNode | undefined {
  let current = start
  const visited = new Set<string>()
  while (
    current &&
    (current.type === "teleport-send" || current.type === "teleport-receive") &&
    !visited.has(current.id)
  ) {
    visited.add(current.id)
    const id = current.id
    const inEdge = edges.find((e) => e.target === id)
    const upstream = inEdge ? nodes.find((n) => n.id === inEdge.source) : undefined
    if (!upstream) break
    current = upstream
  }
  return current
}

/** The master source's node data: the `master-audio` role when one is set, else
 *  the first source in the node's own `sourceOrder`, else first-wired. */
function masterSourceData(
  node: GraphNode,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): Record<string, unknown> | undefined {
  const data = dataOf(node) ?? {}
  const cfg = (data.sourceConfig as Record<string, { role?: string }> | undefined) ?? {}
  const order = (data.sourceOrder as string[] | undefined) ?? []
  const srcIds = edges
    .filter((e) => e.target === node.id && e.targetHandle === "sources")
    .map((e) => e.source)
  const ordered = order.length
    ? [...order.filter((id) => srcIds.includes(id)), ...srcIds.filter((id) => !order.includes(id))]
    : srcIds
  const masterId = ordered.find((id) => cfg[id]?.role === "master-audio") ?? ordered[0]
  return masterId ? dataOf(resolveGraphOrigin(nodes.find((n) => n.id === masterId), nodes, edges)) : undefined
}

/**
 * The master source's known length in seconds, or undefined (→ ceiling bucket).
 * O(edges) and returns a primitive, so it is safe inside a store selector.
 */
export function resolveEditPlanEstimateDurationSec(
  node: GraphNode,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): number | undefined {
  return mediaLengthSecOf(masterSourceData(node, nodes, edges))
}

/**
 * A media node's own recorded length in seconds, from its DATA: the shared
 * reserve-parity read first, then the legacy design-time keys. The one read every
 * estimate resolver uses, so "how long is this source" has a single answer.
 */
export function mediaLengthSecOf(data: Record<string, unknown> | undefined): number | undefined {
  if (!data) return undefined
  const known = editPlanSourceDurationSec(data)
  if (known !== undefined) return known
  for (const key of EDIT_PLAN_LEGACY_DURATION_KEYS) {
    const v = data[key]
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v
  }
  return undefined
}
