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
 *
 * The rule lives in `@nodaro/render-rules` (decided 2026-10-07), where the
 * listing a published app, component or template stores reads it too; this
 * module is the editor's face of it.
 */
export {
  EDIT_PLAN_LEGACY_DURATION_KEYS,
  mediaLengthSecOf,
  resolveEditPlanEstimateDurationSec,
  resolveGraphOrigin,
} from "@nodaro/render-rules"

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
