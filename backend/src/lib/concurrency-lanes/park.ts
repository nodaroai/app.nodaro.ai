// backend/src/lib/concurrency-lanes/park.ts — parking a job its lane refused,
// and waking it again.
//
// Park: the row is first stamped with its environment, its BullMQ entry and
// the payload it can be added again with (columns.ts) — and only once the row
// stamps are confirmed on it is it moved `pending → queued` (a re-park keeps
// `queued`; a row that started, or ended, never parks). A row the stamps did
// not reach is never left waiting, since no sweep would see it: it times out
// only from `lane_queued_at` and is found again only by `lane_env`. Such a job
// runs at once, ungated and counted, its row as it was. Then
// the BullMQ job is moved to the delayed set with a long BACKSTOP delay —
// never a short poll — at the priority it was added with. `DelayedError` then
// ends the attempt without spending one (BullMQ 5). Right after the move the
// job re-checks for a reservation and promotes itself if one landed meanwhile:
// a wake that arrived while the job was still active could not promote it.
//
// Wake: a release (or any gate script that passes a slot on) reserves the
// slot for the next waiter and returns it as a wake target; the releaser
// promotes it by its stored BullMQ id here, and the gate also publishes it,
// so the subscriber of the process that runs that queue promotes it too
// (wake-subscriber.ts). Promoting a job that is not delayed — already woken,
// active or waiting — is a no-op: it finds its reservation at pickup. Turning
// enforcement off promotes every waiter (wakeAllWaiters, the off-transition
// waker); woken, each is granted, since the flag is already off.
//
// Wiring: the workers register the park and the wake handlers when they are
// created (registerLaneParking); each process entrypoint calls
// startLaneParking, which gives queueOf its connection, registers the
// off-transition waker and subscribes for the process's own queues. This
// module loads no connection itself: the queue module and the subscriber are
// imported there, lazily.
import { DelayedError, Job, Queue, type ConnectionOptions } from "bullmq"
import { supabase } from "../supabase.js"
import { stampQueued, type LaneTable } from "./columns.js"
import type { WakeTarget } from "./gate.js"
import { loadConcurrencyGate, warnLaneRateLimited } from "./hold.js"
import type { LaneQueueName, WaitInfo } from "./types.js"
import { registerServerShareWaker } from "./server-share.js"
import { registerWithdrawWaker } from "./withdraw.js"
import {
  registerNotAdmittedHandler, registerWakeTargetsHandler, runRefusedJobUngated,
  type AdmittedBullJob, type BullJobOpts, type NotAdmittedHandler,
} from "./worker-admit.js"

/** How long a parked job sleeps when nothing wakes it (= the reservation TTL). */
export const LANE_PARK_BACKSTOP_MS = 600_000

/** The row is no longer waiting (cancelled, failed, done, or started): it is not parked. */
export class LaneRowNotParkableError extends Error {
  constructor(readonly table: LaneTable, readonly rowId: string) {
    super(`${table} row ${rowId} is no longer waiting; not parked`)
    this.name = "LaneRowNotParkableError"
  }
}

// ---------------------------------------------------------------- queues

/** The lane queues BullMQ carries; `live` and `inline` are not BullMQ queues. */
const BULL_QUEUES: ReadonlySet<LaneQueueName> = new Set<LaneQueueName>([
  "video-generation", "video-render", "workflow-orchestration", "pipeline-orchestration", "video-director",
])

let connection: ConnectionOptions | null = null
const queues = new Map<LaneQueueName, Queue>()

/** The connection queueOf's Queue objects share (the BullMQ one; set by startLaneParking). */
export function setLaneQueueConnection(c: unknown): void {
  connection = c as ConnectionOptions
  queues.clear()
}

/**
 * The BullMQ Queue object for a lane queue name, created once on the shared
 * connection; null for `live` / `inline`, and before startLaneParking gave a
 * connection.
 */
export function queueOf(name: LaneQueueName): Queue | null {
  if (!BULL_QUEUES.has(name) || connection === null) return null
  let q = queues.get(name)
  if (!q) {
    q = new Queue(name, { connection })
    queues.set(name, q)
  }
  return q
}

// ------------------------------------------------------------------ park

/**
 * The row stamps a waiting row needs (`lane_env`, `lane_queued_at`) could not
 * be written or confirmed. The row is left as it was and the caller runs the
 * job ungated (counted): with the lane columns absent, every refused job runs.
 */
export class LaneRowNotStampedError extends Error {
  constructor(readonly table: LaneTable, readonly rowId: string) {
    super(`${table} row ${rowId} could not be stamped as waiting; not parked`)
    this.name = "LaneRowNotStampedError"
  }
}

/** The CAS that marks a row as waiting; throws LaneRowNotParkableError when it is not. */
async function markWaiting(table: LaneTable, rowId: string): Promise<void> {
  // jobs: pending → queued (a re-park keeps queued). A workflow execution stays
  // `pending`, a pipeline stays `queued`: the read only checks it still waits.
  const { data, error } = table === "jobs"
    ? await supabase.from("jobs").update({ status: "queued" }).eq("id", rowId).in("status", ["pending", "queued"]).select("id")
    : await supabase.from(table).select("id").eq("id", rowId).eq("status", table === "pipelines" ? "queued" : "pending")
  if (error) throw new Error(`could not mark ${table} row ${rowId} as waiting: ${error.message ?? error.code}`)
  if (!Array.isArray(data) || data.length === 0) throw new LaneRowNotParkableError(table, rowId)
}

/**
 * Put a row this park moved `pending → queued` back to `pending`, for a job
 * that runs ungated after all (its BullMQ entry could not be parked): a CAS
 * from `queued` only, so a cancel or a claim in between wins. Best effort.
 */
async function unmarkWaiting(table: LaneTable, rowId: string): Promise<void> {
  if (table !== "jobs") return
  try {
    const { error } = (await supabase.from("jobs").update({ status: "pending" }).eq("id", rowId).eq("status", "queued")) ?? {}
    if (error) warnLaneRateLimited(`could not put job ${rowId} back to pending after a failed park`, error)
  } catch (err) {
    warnLaneRateLimited(`could not put job ${rowId} back to pending after a failed park`, err)
  }
}

const requeueOpts = (opts: BullJobOpts | undefined): BullJobOpts => ({
  priority: opts?.priority,
  attempts: opts?.attempts,
  backoff: opts?.backoff,
  removeOnComplete: opts?.removeOnComplete,
  removeOnFail: opts?.removeOnFail,
})

/**
 * moveToDelayed refused because the entry is no longer this attempt's: its
 * lock is gone or another worker holds it, the job is not active, or it no
 * longer exists (a stall re-pick, a command replayed after a reconnect).
 * BullMQ's own texts (Scripts.finishedErrors).
 */
function isLostEntryError(err: unknown): boolean {
  const message = (err as Error)?.message ?? ""
  return /Missing lock for job|Lock mismatch for job|is not in the active state|Missing key for job/.test(message)
}

/** "Not delayed" (already promoted, active or waiting) and "no such job" are not failures of a wake. */
function isHarmlessPromoteError(err: unknown): boolean {
  const message = (err as Error)?.message ?? ""
  return /not in the delayed state|Missing key for job/.test(message)
}

/**
 * Promote a parked job; true when it was moved off the delayed set. A job that
 * is not delayed any more (already promoted, waiting or active) or is gone is
 * not a failure; anything else is logged at most once a minute. Never throws.
 */
export async function promoteQuietly(promote: () => Promise<void>, jobId: string): Promise<boolean> {
  try {
    await promote()
    return true
  } catch (err) {
    if (!isHarmlessPromoteError(err)) warnLaneRateLimited(`could not promote waiting job ${jobId}`, err)
    return false
  }
}

/**
 * Park a job its lane refused (see the module comment). Always throws:
 * `DelayedError` once the job is on the delayed set — the worker ends its
 * attempt, no attempt spent — or when its BullMQ entry turned out to be no
 * longer this attempt's (another pickup runs it); LaneRowNotParkableError (the
 * row no longer waits); or an error (no BullMQ entry or lock to park with, row
 * stamps that could not be written — LaneRowNotStampedError — or a database,
 * Redis or network failure), which the caller turns into an ungated run.
 */
export async function parkForLane(args: {
  job: AdmittedBullJob
  token: string | undefined
  queue: LaneQueueName
  table: LaneTable
  rowId: string
  wait: WaitInfo
}): Promise<never> {
  const { job, token, queue, table, rowId } = args
  const bullJobId = job.id
  if (!token || !bullJobId || typeof job.moveToDelayed !== "function") {
    throw new Error(`job ${rowId} has no BullMQ entry or lock to park with`)
  }
  // Stamps first, on the row only while it still waits: the sweep times a
  // waiting row out from lane_queued_at and finds it by lane_env, so a row is
  // marked waiting only once both are on it. Never throws.
  const stamp = await stampQueued(table, rowId, { bullQueue: queue, bullJobId, requeue: { name: job.name, data: job.data, opts: requeueOpts(job.opts) } })
  if (stamp.row === "not-waiting") throw new LaneRowNotParkableError(table, rowId)
  if (stamp.row === "failed") throw new LaneRowNotStampedError(table, rowId)
  // A missing payload only costs the re-add after Redis lost the entry (the job then fails as lost and is refunded).
  await markWaiting(table, rowId)
  // Its own options stand: BullMQ promotes it at the priority it was added with.
  try {
    await job.moveToDelayed(Date.now() + LANE_PARK_BACKSTOP_MS, token)
  } catch (err) {
    // The entry is not ours any more: whoever holds it runs it (from `queued`).
    // Running it here too would run the job twice, so this attempt ends as
    // parked and the waiter entry stays. A Redis or network failure is thrown
    // on, and the caller runs the job ungated rather than lose it — from the
    // status the row had, when this park is what made it `queued`.
    if (isLostEntryError(err)) {
      warnLaneRateLimited(`a parking job's BullMQ entry was no longer this attempt's (job ${rowId})`, err)
      throw new DelayedError()
    }
    if (stamp.status === "pending") await unmarkWaiting(table, rowId)
    throw err
  }
  // Nothing below may throw: the job is parked, and only DelayedError ends the attempt.
  try {
    const gate = await loadConcurrencyGate()
    if (await gate.hasReservation(rowId)) {
      await promoteQuietly(() => (job.promote ? job.promote() : promoteById(queue, bullJobId)), rowId)
    }
  } catch (err) {
    // The wake that reserved the slot, or the backstop, brings it back.
    warnLaneRateLimited("could not re-check a parked job for a reservation", err)
  }
  throw new DelayedError()
}

/**
 * The table a queue's waiting rows live in: a workflow execution (it stays
 * `pending` while it waits), a pipeline (it stays `queued`), else a `jobs` row
 * (it becomes `queued`) — the video, render and director queues.
 */
export function laneTableOfQueue(queue: LaneQueueName): LaneTable {
  if (queue === "workflow-orchestration") return "workflow_executions"
  if (queue === "pipeline-orchestration") return "pipelines"
  return "jobs"
}

/**
 * Every worker's not-admitted handler — one per process, so it names the
 * table from the queue (laneTableOfQueue): park the job. A row that stopped
 * waiting goes on to the pickup claim (a run: to the worker, which finds it
 * started or ended).
 */
export const parkRefusedJob: NotAdmittedHandler = async (args) => {
  try {
    await parkForLane({ job: args.job, token: args.token, queue: args.queue, table: laneTableOfQueue(args.queue), rowId: args.row.id, wait: args.wait })
  } catch (err) {
    if (err instanceof DelayedError) return "parked"
    // Not pending or queued any more: its entry is withdrawn and the pickup
    // claim decides — it discards a cancelled or ended row; a row another
    // pickup already started is claimed as a re-pick, as without lanes.
    if (err instanceof LaneRowNotParkableError) return runRefusedJobUngated(args, false)
    throw err
  }
  // parkForLane never returns.
  throw new Error("parkForLane returned")
}

// ------------------------------------------------------------------ wake

async function promoteById(queue: LaneQueueName, bullJobId: string): Promise<void> {
  const q = queueOf(queue)
  if (!q) return
  const job = await Job.fromId(q, bullJobId)
  if (job) await job.promote()
}

/** Promote one target; true when it was moved off the delayed set here. */
async function wakeOne(t: WakeTarget): Promise<boolean> {
  const q = queueOf(t.queue)
  if (!q || !t.bullJobId) return false
  try {
    const job = await Job.fromId(q, t.bullJobId)
    if (!job) return false
    return await promoteQuietly(() => job.promote(), t.jobId)
  } catch (err) {
    warnLaneRateLimited(`could not look up waiting job ${t.jobId}`, err)
    return false
  }
}

/** How many promotes a wake runs at once (an off-transition may wake thousands). */
export const WAKE_ALL_CONCURRENCY = 25

/** Wake every target, at most WAKE_ALL_CONCURRENCY at once; how many were moved. */
async function wakeEach(targets: WakeTarget[]): Promise<number> {
  let next = 0
  let woken = 0
  const runner = async (): Promise<void> => {
    while (next < targets.length) {
      const t = targets[next++]!
      if (await wakeOne(t)) woken++
    }
  }
  await Promise.all(Array.from({ length: Math.min(WAKE_ALL_CONCURRENCY, targets.length) }, runner))
  return woken
}

/**
 * Promote the parked jobs a release reserved slots for, by their stored
 * BullMQ ids. Never throws. Live and inline targets were published by the gate.
 */
export async function wakeTargets(targets: WakeTarget[]): Promise<void> {
  await wakeEach(targets)
}

/** wakeTargets, answering how many jobs it moved off the delayed set (the server share's waker falls through on 0). */
export function wakeTargetsCounted(targets: WakeTarget[]): Promise<number> {
  return wakeEach(targets)
}

/**
 * Promote every parked job (enforcement went off), WAKE_ALL_CONCURRENCY at a
 * time. Idempotent: a job already promoted is skipped. Waiting live and inline
 * calls re-check on their own within seconds and are granted. Returns how many
 * jobs it moved.
 */
export async function wakeAllWaiters(): Promise<number> {
  const gate = await loadConcurrencyGate()
  return wakeEach(await gate.allWaiters())
}

// ---------------------------------------------------------------- wiring

/**
 * Make refused jobs park and reserved wakes promote (a release's and a
 * withdraw's, and a server-share leave's), in this process.
 */
export function registerLaneParking(): void {
  registerNotAdmittedHandler(parkRefusedJob)
  registerWakeTargetsHandler(wakeTargets)
  registerWithdrawWaker(wakeTargets)
  registerServerShareWaker(wakeTargetsCounted)
}

/**
 * For a process entrypoint: give queueOf the BullMQ connection, register the
 * park, the wakes and the off-transition waker, and subscribe to wakes for
 * this process's own queues (none: no subscriber). Returns the stop function,
 * which closes the subscriber.
 */
export async function startLaneParking(subscribeTo: LaneQueueName[]): Promise<() => void> {
  // Registered before anything that can fail: a refused job must park, not run ungated.
  registerLaneParking()
  try {
    const [{ redis }, { registerOffTransitionWaker }] = await Promise.all([import("../queue.js"), import("./enforcement.js")])
    setLaneQueueConnection(redis)
    registerOffTransitionWaker(wakeAllWaiters)
    if (subscribeTo.length === 0) return () => {}
    const { startLaneWakeSubscriber } = await import("./wake-subscriber.js")
    return startLaneWakeSubscriber(subscribeTo, wakeTargets)
  } catch (err) {
    // Never stops a process: parked jobs still come back on their backstop.
    warnLaneRateLimited("could not start lane wakes in this process", err)
    return () => {}
  }
}

/** For tests: no connection, no queues. */
export function resetLaneParkingForTests(): void {
  connection = null
  queues.clear()
}
