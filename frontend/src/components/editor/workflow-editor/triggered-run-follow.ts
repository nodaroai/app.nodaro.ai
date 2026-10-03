/**
 * A Telegram message that starts a run used to leave the open canvas silent:
 * the editor puts back only the runs it starts itself
 * (`use-workflow-persistence.ts` keeps to `triggerType === "manual"`), so the
 * person saw the result only by digging in the Executions tab. These rules
 * decide what the canvas does instead — follow such a run live the way a Run
 * is followed, and show the newest one that ended while nobody was looking —
 * without ever painting a run over something newer or over edits made since.
 */
import { isProjectedTriggerNodeType } from "@nodaro/shared"
import { settledBeforeClear } from "@/lib/results-cleared"

/**
 * The run lanes the canvas follows: a Telegram message started them, and the
 * person expects the result where the flow is. Not a schedule or a webhook:
 * those can fire every minute and would keep the editor in running mode.
 */
export const FOLLOWED_LANES: ReadonlySet<string> = new Set(["telegram", "telegram_account"])

/** The trigger node types that start a followed lane's runs. */
export const FOLLOWED_TRIGGER_NODE_TYPES: ReadonlySet<string> = new Set(["telegram-trigger", "telegram-account-trigger"])

/** The lanes the editor starts itself. */
const EDITOR_LANES: ReadonlySet<string> = new Set(["manual", "single-node"])

const ACTIVE: ReadonlySet<string> = new Set(["pending", "running", "stopping"])
/** Ended with something to show. A run stopped on purpose (cancelled, discarded) is not painted. */
const ENDED: ReadonlySet<string> = new Set(["completed", "failed", "timed_out"])
/** The node states an ended run paints: a node still "running" in an ended run was orphaned, not running. */
const NODE_ENDED: ReadonlySet<string> = new Set(["completed", "failed"])

/** On a node: the id of the trigger-started run whose results it shows (registered in EXECUTION_DATA_KEYS). */
export const RESULTS_RUN_ID_KEY = "resultsRunId"

/** The fields of a listed run these rules read. */
export interface FollowRun {
  readonly id: string
  readonly status: string
  readonly triggerType: string
  readonly createdAt?: string
  readonly completedAt?: string | null
  readonly nodeStates?: Record<string, unknown>
}

/** The fields of a node state these rules read. */
export interface PaintState {
  readonly status: string
  readonly startedAt?: string | null
  readonly completedAt?: string | null
}

interface NodeLike {
  readonly id: string
  readonly type?: string
  readonly data: unknown
}

function isFollowedActive(row: FollowRun): boolean {
  return FOLLOWED_LANES.has(row.triggerType) && ACTIVE.has(row.status)
}

/** The newest run a followed lane started that is still going, unless already handled. Rows come newest first. */
export function runToFollow<R extends FollowRun>(rows: readonly R[], handled: ReadonlySet<string>): R | null {
  return rows.find((row) => isFollowedActive(row) && !handled.has(row.id)) ?? null
}

/** Every followed run still going: once the newest is followed, the older ones are not (they would paint over it). */
export function activeFollowedIds(rows: readonly FollowRun[]): string[] {
  return rows.filter(isFollowedActive).map((row) => row.id)
}

function timeOf(value: string | null | undefined): number {
  const ms = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY
}

/**
 * The run whose results the canvas should show: the newest run a followed
 * lane started, once it ended — unless a newer followed run is still going
 * (that one is followed instead), or the editor's own run is still going or
 * ended at or after it (its result is the newer one; the list is in START
 * order, so the end is what decides).
 */
export function endedRunToShow<R extends FollowRun>(rows: readonly R[]): R | null {
  const candidate = rows.find((row) => FOLLOWED_LANES.has(row.triggerType))
  if (!candidate || !ENDED.has(candidate.status)) return null
  const endedAt = timeOf(candidate.completedAt ?? candidate.createdAt)
  const editorNewer = rows.some(
    (row) => EDITOR_LANES.has(row.triggerType) && (ACTIVE.has(row.status) || timeOf(row.completedAt ?? row.createdAt) >= endedAt),
  )
  return editorNewer ? null : candidate
}

/**
 * The part of a run's node states the canvas takes:
 *   - while the run is going, a node it is running or about to run — newer
 *     than any "Clear results" (the editor refuses a clear while a run shows);
 *   - a node that ended in it: completed after it ran (never one that only
 *     passed its saved data through), or failed;
 *   - never a trigger node: its state carries the message, and the message
 *     stays in the run history (the card only shows that it is working);
 *   - never a node emptied with "Clear results" after that node ended;
 *   - never a node already showing this run (a reload must not paint it again
 *     over edits made since).
 */
export function paintableStates<S extends PaintState>(
  nodes: readonly NodeLike[],
  states: Readonly<Record<string, S>>,
  run: { readonly id: string; readonly completedAt?: string | null; readonly active: boolean },
): Record<string, S> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return Object.fromEntries(
    Object.entries(states).filter(([nodeId, state]) => {
      const node = byId.get(nodeId)
      if (!node || isProjectedTriggerNodeType(node.type)) return false
      const data = (node.data ?? {}) as Record<string, unknown>
      if (data[RESULTS_RUN_ID_KEY] === run.id) return false
      if (run.active && (state.status === "pending" || state.status === "running")) return true
      if (!NODE_ENDED.has(state.status)) return false
      if (state.status === "completed" && !state.startedAt) return false
      return !settledBeforeClear(data, state.completedAt ?? run.completedAt)
    }),
  )
}

/** The trigger nodes a run started from: their cards show that the run is going. */
export function triggerNodesOf(nodes: readonly NodeLike[], states: Readonly<Record<string, unknown>>): string[] {
  return nodes.filter((node) => node.id in states && isProjectedTriggerNodeType(node.type)).map((node) => node.id)
}
