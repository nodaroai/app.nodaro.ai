import type { JobQueueInfo } from "@/lib/api"

/**
 * `data.queueInfo`: the read's `queue`, stamped with the job it is about. The
 * badge shows it only while that job is the node's own (`currentJobId`, or any
 * job of a running List fan-out), so a place in line left behind by a job the
 * node has moved on from — a Stop, a re-run, a later run of the server — can
 * never come back on the card.
 */
export type NodeQueueInfo = JobQueueInfo & { readonly jobId: string }

/** The workflow store's state, as far as this needs it — handed in by the
 *  caller, so this module stays out of the editor's import cycle. */
export interface QueueInfoStore {
  readonly nodes?: ReadonlyArray<{ readonly id: string; readonly data?: unknown }>
  readonly updateNodeData: (id: string, data: Record<string, unknown>) => void
}

/** Whether `jobId` is the job `data` runs now: its `currentJobId`, or any of a
 *  List fan-out's jobs (they share the one slot) — abandon-guard.ts's rule. */
export function isNodesJob(data: Record<string, unknown> | undefined, jobId: string): boolean {
  return data?.__listRunning === true || data?.currentJobId === jobId
}

/** The fields of a queue the badge says something about: `waitedSeconds`
 *  moves on every read and is left out, so a job that stays put in line does
 *  not re-render its node on every tick. */
function samePlaceInLine(a: NodeQueueInfo, b: NodeQueueInfo): boolean {
  return a.jobId === b.jobId && a.lane === b.lane && a.position === b.position && a.limit === b.limit && a.running === b.running && a.reason === b.reason && a.upgradeHint === b.upgradeHint
}

/**
 * Keep `data.queueInfo` — where the node's job stands in line while it waits
 * for a free concurrency slot, read by BaseNode's queue badge — in step with
 * one read of job `jobId`: the read's `queue` while the job is `queued`, else
 * nothing.
 *
 * Writes ONLY when that changes, and only for the node's own job: a node whose
 * job never waited is never written (with nothing queued every poll loop
 * behaves exactly as before), and the loop of a job the node has moved on from
 * (a re-run, a discard) writes nothing, so two loops never take turns on the
 * badge. An unchanged place in line keeps the `waitedSeconds` it was first
 * stored with. Called by `getJobStatusLeanForNode` (poll-job.ts) for every
 * node-owning poll loop, and by the component executor's own loop.
 */
export function updateQueueInfoIfChanged(
  nodeId: string,
  jobId: string,
  job: { readonly status?: string; readonly queue?: JobQueueInfo },
  store: QueueInfoStore,
): void {
  const data = store.nodes?.find((n) => n.id === nodeId)?.data as Record<string, unknown> | undefined
  if (!data || !isNodesJob(data, jobId)) return
  const next: NodeQueueInfo | undefined = job.status === "queued" && job.queue ? { ...job.queue, jobId } : undefined
  const prev = data.queueInfo as NodeQueueInfo | undefined
  if (!next && !prev) return
  if (next && prev && samePlaceInLine(next, prev)) return
  store.updateNodeData(nodeId, { queueInfo: next })
}
