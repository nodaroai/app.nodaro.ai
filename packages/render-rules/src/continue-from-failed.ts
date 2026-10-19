/**
 * What a continue-from-failed of a saved workflow's run executes
 * (`continueMode: "from-failed"` on `POST /v1/workflows/:id/run`), as ONE rule
 * the server runs and the editor predicts, prices and clears by (its
 * Continue from failed). Pure; either engine's graph and states fit.
 *
 * 1. The nodes it CONSIDERS (`fromFailedConsidered`): sent no `nodeIds`, the
 *    lineage's node scope (what its first run was started on; `null` = every
 *    node) plus every node a run it continues or builds on left unfinished
 *    (`leftUnfinishedBy`), in graph order.
 * 2. The nodes it RUNS (`fromFailedClosedRunSet`): those of (1) the run it is
 *    seeded from did not complete, closed over the incomplete nodes they need
 *    upstream.
 *
 * What counts as completed (`completedFor`) is one rule too: a `completed`
 * state, except — for a node the caller NAMED in `nodeIds` — one that is only
 * a placeholder (`isPlaceholder`): a node no run of the chain ever ran, which
 * each run only handed on from its saved data. A named node like that runs
 * (explicit `nodeIds` always win). Unnamed, a placeholder still counts as
 * completed, so a run sent no `nodeIds`, and every node a run reads from
 * saved data upstream of the ones it runs, behaves as before.
 */
import { ancestorsOf, type WalkEdge } from "./graph-walk"
import { bypassTeleports } from "./teleport-bypass"

/** A node's state as the rule reads it: either engine's `node_states` entry fits. */
export interface FromFailedNodeState {
  readonly status?: unknown
  /** A seed of a node the run it was seeded from left unfinished (`continuationSeeds`). */
  readonly carriedUnfinished?: unknown
  /** When the run started the node: only a node it ran has one. */
  readonly startedAt?: unknown
  /** The job the run ran for the node, when it ran one. */
  readonly jobId?: unknown
  /** The state is a seed: the execution it was handed on from. */
  readonly seededFromExecution?: unknown
  /** A seed of a placeholder (`isPlaceholder`): the run it was seeded from never ran the node either (`continuationSeeds`). */
  readonly carriedPlaceholder?: unknown
}

/** A run's `node_states`, as the rule reads them. */
export interface FromFailedRun {
  readonly nodeStates?: Readonly<Record<string, FromFailedNodeState | undefined>> | null
}

/**
 * The nodes a run set out to run and did not complete: each that failed, each
 * still `pending` or `running` when it stopped (held back by the failure), and
 * each it was handed on as unfinished — seeded `skipped` from a run it built
 * on that left it so (`carriedUnfinished`), so a failure survives a narrower
 * hop. A node it was not started on is seeded `completed`, one a router or an
 * empty input skipped is `skipped` with no such mark, and one added to the
 * workflow since has no state: none of them is among these.
 */
export function leftUnfinishedBy(run: FromFailedRun): string[] {
  return Object.entries(run.nodeStates ?? {})
    .filter(([, state]) => isUnfinished(state))
    .map(([id]) => id)
}

/** Is this state one a continue-from-failed counts as left unfinished (`leftUnfinishedBy`)? */
export function isUnfinished(state: FromFailedNodeState | undefined): boolean {
  const status = state?.status
  if (status === "failed" || status === "pending" || status === "running") return true
  return status === "skipped" && state?.carriedUnfinished === true
}

/**
 * Is this state only a placeholder — `completed` without the node ever having
 * run anywhere in the chain? A run writes such a state for a node it hands on
 * from its saved data (one outside its `nodeIds`, a frozen one, a source):
 * it has no start time and no job. A seed has neither either, so a seed is a
 * placeholder only when it carries the mark (`carriedPlaceholder`) that the
 * state it was seeded from was one. A seed written before the mark existed
 * reads as a node that ran.
 */
export function isPlaceholder(state: FromFailedNodeState | undefined): boolean {
  if (state?.status !== "completed") return false
  if (state.startedAt || state.jobId) return false
  return !state.seededFromExecution || state.carriedPlaceholder === true
}

/**
 * Does a continue-from-failed count this node as completed — handed on, never
 * run or charged again? A `completed` state does, unless the caller named the
 * node (`named`) and the state is only a placeholder (`isPlaceholder`): then
 * it runs.
 */
export function completedFor(state: FromFailedNodeState | undefined, named: boolean): boolean {
  return state?.status === "completed" && !(named && isPlaceholder(state))
}

/**
 * The nodes a continue-from-failed sent no `nodeIds` considers, in `order`:
 * every node when the lineage has no scope (`null`), otherwise the scope plus
 * what each of `runs` — the run asked for, and the newer one it builds on —
 * left unfinished. Of the nodes in `order` only (one no longer on the
 * workflow is left out).
 */
export function fromFailedConsidered(
  order: readonly string[],
  scope: readonly string[] | null | undefined,
  runs: readonly FromFailedRun[],
): string[] {
  if (!scope) return [...order]
  const considered = new Set(scope)
  for (const run of runs) for (const id of leftUnfinishedBy(run)) considered.add(id)
  return order.filter((id) => considered.has(id))
}

/**
 * The nodes a continue-from-failed run executes: every one of `nodeIds` the
 * run it is seeded from did not complete (`completedFor`: a node of `named`,
 * the ids the caller sent, that was only ever a placeholder is not complete),
 * in the order given.
 */
export function fromFailedRunSet(
  nodeIds: readonly string[],
  source: FromFailedRun,
  named: Iterable<string> = [],
): string[] {
  const ids = new Set(named)
  return nodeIds.filter((id) => !completedFor(source.nodeStates?.[id], ids.has(id)))
}

/**
 * A saved workflow's continue-from-failed run set: the nodes of `nodeIds` the
 * run it is seeded from did not complete (`fromFailedRunSet`), closed over what
 * they need — every node upstream of one of them that the run did not complete
 * either, reached through such nodes only (a completed node hands on its seed,
 * so nothing above it is needed). Without the closure a narrow `nodeIds` would
 * run a node on an upstream that never produced anything. Wires as the
 * orchestrator reads them (a Teleport pair bypassed). In `order`. `named`: the
 * ids the caller sent (`fromFailedRunSet`); a placeholder upstream that is not
 * among them hands on its saved data, as it did, and is never added.
 */
export function fromFailedClosedRunSet(
  order: readonly string[],
  nodeIds: readonly string[],
  graph: {
    readonly nodes: ReadonlyArray<{ readonly id?: string; readonly type?: string | null; readonly data?: unknown }>
    readonly edges: ReadonlyArray<WalkEdge>
  },
  source: FromFailedRun,
  named: Iterable<string> = [],
): string[] {
  const ids = new Set(named)
  const remaining = fromFailedRunSet(nodeIds, source, ids)
  const completed = (id: string) => completedFor(source.nodeStates?.[id], ids.has(id))
  // Only wires out of a node that did not complete lead further up.
  const open = bypassTeleports(graph.nodes, graph.edges).filter((e) => !completed(e.source))
  const run = new Set(remaining)
  for (const id of remaining) for (const up of ancestorsOf(id, open)) if (!completed(up)) run.add(up)
  return order.filter((id) => run.has(id))
}
