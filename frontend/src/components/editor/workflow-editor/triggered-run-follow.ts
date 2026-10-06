/**
 * A run the editor did not start — a Telegram message, an MCP client, the
 * API, a schedule, a webhook — used to leave the open canvas silent: the
 * editor puts back only the runs it starts itself
 * (`use-workflow-persistence.ts` keeps to `triggerType === "manual"`), so the
 * person saw the result only by digging in the Executions tab. These rules
 * decide what the canvas does instead — follow such a run live the way a Run
 * is followed, or show the newest one that ended while nobody was looking —
 * without ever painting a run over something newer or over edits made since.
 */
import { isProjectedTriggerNodeType } from "@nodaro/shared"
import { settledBeforeClear } from "@/lib/results-cleared"
import { isSeededState } from "@/lib/seeded-node-state"

/**
 * The run lanes the canvas follows LIVE: a person deliberately started the run
 * — a Telegram message, an MCP client — and may be watching the flow for its
 * result.
 */
export const LIVE_FOLLOWED_LANES: ReadonlySet<string> = new Set(["telegram", "telegram_account", "mcp"])

/**
 * The lanes the canvas paints only once a run ENDED: a schedule, a webhook or
 * an API token's integration can fire every minute, and following one would
 * keep the editor in running mode (and hand a person a Stop button for an
 * integration's run). Their newest ended run still lands on the nodes.
 */
export const ENDED_ONLY_LANES: ReadonlySet<string> = new Set(["schedule", "webhook", "api"])

/** Every lane whose results belong on this canvas (an app run has its own surface). */
export const CANVAS_RUN_LANES: ReadonlySet<string> = new Set([...LIVE_FOLLOWED_LANES, ...ENDED_ONLY_LANES])

/** The lanes the editor starts itself. */
const EDITOR_LANES: ReadonlySet<string> = new Set(["manual", "single-node"])

const ACTIVE: ReadonlySet<string> = new Set(["pending", "running", "stopping"])
/** Ended with something to show. A run stopped on purpose (cancelled, discarded) is not painted. */
const ENDED: ReadonlySet<string> = new Set(["completed", "failed", "timed_out"])
/** The node states an ended run paints: a node still "running" in an ended run was orphaned, not running. */
const NODE_ENDED: ReadonlySet<string> = new Set(["completed", "failed"])

/**
 * On a node: the id of the run whose results it shows (registered in
 * EXECUTION_DATA_KEYS) — a run a Telegram message started, and the editor's own
 * runs too (the live lane stamps each node as it ends, and the reopen lane as it
 * loads one), so no reload ever paints the same run again over edits made since.
 */
export const RESULTS_RUN_ID_KEY = "resultsRunId"

/**
 * On a node, beside {@link RESULTS_RUN_ID_KEY}: when that run ended the node
 * (its node state's `completedAt`, else the run's end). The reopen lane reads
 * it to keep a result a NEWER run left that its own listing cannot see — a
 * run another member started, one that was discarded, a Telegram run
 * (newer-run-review.ts). Registered in EXECUTION_DATA_KEYS.
 */
export const RESULTS_RUN_ENDED_AT_KEY = "resultsRunEndedAt"

/** The two marks a node gets when a run ends it: which run, and when (always
 *  both, so an earlier run's end time never stays paired with a later run). */
export function resultsRunMark(runId: string, endedAt: string | null | undefined): Record<string, string | undefined> {
  return { [RESULTS_RUN_ID_KEY]: runId, [RESULTS_RUN_ENDED_AT_KEY]: endedAt || undefined }
}

/** The fields of a listed run these rules read. */
export interface FollowRun {
  readonly id: string
  /** "job" for a single-node job listed beside the runs — there is no run to follow or paint. */
  readonly kind?: string
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
  /** The run passed the node's saved output through (see lib/seeded-node-state.ts). */
  readonly fromSavedData?: boolean
  /** The job the run gave the node; a node a Router skipped has none. */
  readonly jobId?: string | null
}

interface NodeLike {
  readonly id: string
  readonly type?: string
  readonly data: unknown
}

/** A row that is a run on a canvas lane (a single-node job says "mcp" too, and is not one). */
function isCanvasRun(row: FollowRun): boolean {
  return row.kind !== "job" && CANVAS_RUN_LANES.has(row.triggerType)
}

function isFollowedActive(row: FollowRun): boolean {
  return isCanvasRun(row) && LIVE_FOLLOWED_LANES.has(row.triggerType) && ACTIVE.has(row.status)
}

/** The newest run a live lane started that is still going, unless already handled. Rows come newest first. */
export function runToFollow<R extends FollowRun>(rows: readonly R[], handled: ReadonlySet<string>): R | null {
  return rows.find((row) => isFollowedActive(row) && !handled.has(row.id)) ?? null
}

/** Every live-lane run still going: once the newest is followed, the older ones are not (they would paint over it). */
export function activeFollowedIds(rows: readonly FollowRun[]): string[] {
  return rows.filter(isFollowedActive).map((row) => row.id)
}

function timeOf(value: string | null | undefined): number {
  const ms = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY
}

/**
 * The run whose results the canvas should show: of the runs on a canvas lane
 * that ENDED, the one that ended last (the list is in START order, so the end
 * is what decides) — unless a live-lane run is still going (that one is
 * followed instead, and the next look picks up what is left), or the editor's
 * own run is still going or ended at or after it (its result is the newer
 * one). A schedule or webhook run still going is simply not looked at: it
 * neither blocks an older ended run nor is followed.
 */
export function endedRunToShow<R extends FollowRun>(rows: readonly R[]): R | null {
  if (rows.some(isFollowedActive)) return null
  let candidate: R | null = null
  let candidateEndedAt = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    if (!isCanvasRun(row) || !ENDED.has(row.status)) continue
    const endedAt = timeOf(row.completedAt ?? row.createdAt)
    if (candidate === null || endedAt > candidateEndedAt) {
      candidate = row
      candidateEndedAt = endedAt
    }
  }
  if (!candidate) return null
  const editorNewer = rows.some(
    (row) =>
      EDITOR_LANES.has(row.triggerType) &&
      (ACTIVE.has(row.status) || timeOf(row.completedAt ?? row.createdAt) >= candidateEndedAt),
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
 *     over edits made since);
 *   - for a run that ended: never a node whose result came from a run that
 *     ended at or after this one (a schedule fired since, or the editor's own
 *     run) — an older run must not paint over a newer result.
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
      if (isSeededState(state)) return false
      const endedAt = state.completedAt ?? run.completedAt
      if (!run.active && showsLaterRun(data, endedAt)) return false
      return !settledBeforeClear(data, endedAt)
    }),
  )
}

/** The node already shows a result from a run that ended at or after `endedAt` (unreadable times keep the node). */
function showsLaterRun(data: Record<string, unknown>, endedAt: string | null | undefined): boolean {
  const shown = data[RESULTS_RUN_ENDED_AT_KEY]
  if (typeof shown !== "string" || !endedAt) return false
  const shownMs = Date.parse(shown)
  const endedMs = Date.parse(endedAt)
  return Number.isFinite(shownMs) && Number.isFinite(endedMs) && shownMs >= endedMs
}

/** The trigger nodes a run started from: their cards show that the run is going. */
export function triggerNodesOf(nodes: readonly NodeLike[], states: Readonly<Record<string, unknown>>): string[] {
  return nodes.filter((node) => node.id in states && isProjectedTriggerNodeType(node.type)).map((node) => node.id)
}
