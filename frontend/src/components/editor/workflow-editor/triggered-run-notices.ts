/**
 * Runs that start without the editor (a Telegram post, a webhook call, a
 * schedule) used to leave the open canvas silent: the editor restores only
 * the runs it starts itself (`use-workflow-persistence.ts` keeps to
 * `triggerType === "manual"`). These helpers decide what the editor tells the
 * person instead: a run started, finished or failed. They are view-only by
 * design: a background run's results are never written into the workflow,
 * so content a trigger brought in lives only in the run history.
 */
import type { NodeState } from "../execution-utils"

/** The lanes the editor starts itself; a run on any other lane started somewhere else. */
const EDITOR_LANES: ReadonlySet<string> = new Set(["manual", "single-node"])

export type RunNoticeKind = "started" | "finished" | "failed"

export interface RunNotice {
  readonly executionId: string
  readonly triggerType: string
  readonly kind: RunNoticeKind
}

/** The fields of a listed run the notices read. */
export interface NoticeRun {
  readonly id: string
  readonly status: string
  readonly triggerType: string
}

/** Each run on the last page looked at, by id, with the status it had. Null before the first look. */
export type SeenRuns = ReadonlyMap<string, string>

/**
 * How a run ended: "finished", "failed" (a time-out too), or null while it is
 * still going and for one stopped on purpose. The one check both the notices
 * and the Executions tab's View use.
 */
export function runEndOf(status: string): "finished" | "failed" | null {
  if (status === "completed") return "finished"
  if (status === "failed" || status === "timed_out") return "failed"
  return null
}

function isOver(status: string): boolean {
  return runEndOf(status) !== null || status === "cancelled" || status === "discarded"
}

/**
 * Compare a fresh page of runs with the last one looked at. The first look is
 * history and says nothing; after it, a run on another lane says "started"
 * when it appears and "finished" or "failed" when it ends (once, however
 * often it is polled). A run first seen already over says how it ended.
 */
export function diffTriggeredRuns(
  seen: SeenRuns | null,
  rows: readonly NoticeRun[],
): { seen: SeenRuns; notices: readonly RunNotice[] } {
  const notices: RunNotice[] = []
  for (const row of rows) {
    if (seen === null || EDITOR_LANES.has(row.triggerType)) continue
    const before = seen.get(row.id)
    const ended = runEndOf(row.status)
    if (before === undefined) {
      if (ended !== null || !isOver(row.status)) {
        notices.push({ executionId: row.id, triggerType: row.triggerType, kind: ended ?? "started" })
      }
    } else if (ended !== null && !isOver(before)) {
      notices.push({ executionId: row.id, triggerType: row.triggerType, kind: ended })
    }
  }
  // Only this page is kept: newer runs push older ones off it for good.
  return { seen: new Map(rows.map((row) => [row.id, row.status])), notices }
}

/**
 * The node whose result an ended run is ABOUT. For a failed run, the node that
 * failed (its detail carries the error), whether or not it got to start.
 * Otherwise, the last executed node that produced something (a job or an
 * output). Nodes that only passed their saved data through (no `startedAt`),
 * skipped ones, and a fanned-out node (one job per item, opened item by item
 * in the list) never count.
 */
export function pickResultNode(
  nodeStates: Readonly<Record<string, NodeState>>,
  runStatus: string,
): { nodeId: string; state: NodeState } | null {
  const wanted = runEndOf(runStatus) === "failed" ? "failed" : "completed"
  let best: { nodeId: string; state: NodeState } | null = null
  for (const [nodeId, state] of Object.entries(nodeStates)) {
    if (state.status !== wanted) continue
    if (wanted === "completed" && !state.startedAt) continue
    if (state.jobIds && state.jobIds.length > 1) continue
    const produced = wanted === "failed" || Boolean(state.jobId) || (state.output !== undefined && Object.keys(state.output).length > 0)
    if (!produced) continue
    if (!best || (state.completedAt ?? "") > (best.state.completedAt ?? "")) best = { nodeId, state }
  }
  return best
}
