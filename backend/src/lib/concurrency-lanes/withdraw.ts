// backend/src/lib/concurrency-lanes/withdraw.ts — the one withdraw every
// cancel and failure path reaches.
//
// A job (or a run: a workflow execution or a pipeline, by its own id) that
// stops waiting must leave its line at once, or it stands at the head and
// blocks everyone behind it — a ghost. withdrawFromLane takes it out of its
// line and out of any server-share wait; when it held a slot reserved for it,
// the slot passes to the next waiter, whose parked BullMQ job is promoted here
// (the gate also publishes the wake, so a process that cannot promote it here
// leaves that to the subscriber of the process running its queue).
//
// It only drops WAIT entries: a lease (a job that is running) is never
// touched — its worker releases it when the job ends. So it is harmless on a
// job that never waited, and idempotent.
//
// Reached from the shared removal funnel (lib/queue.ts tryRemoveFromQueue),
// from markJobFailed, and right after each cancel write that won: a writer
// that still skips all three is caught by the waiter TTL and the head
// reconcile, never later than LANE_WAITER_TTL_MS.
//
// Never throws, and never holds its caller longer than LANE_WITHDRAW_DEADLINE_MS
// in all: ONE deadline covers loading the gate, the withdraw script, the wake
// publish and the promote of a woken job, so a slow Redis cannot stack their
// separate bounds. Past it the caller goes on; whatever is still in flight
// finishes (or fails) on its own, and is safe to: the withdraw is idempotent,
// a reservation passes on after its TTL, and a waiter left behind is dropped
// within the waiter TTL. The promote is the park module's, registered by the
// processes that park (registerLaneParking) — never imported here, so a cancel
// or failure path does not load BullMQ and the admission graph. Without one,
// the gate's published wake reaches the subscriber of the process running the
// queue.
import type { WakeTarget } from "./gate.js"
import { loadConcurrencyGate, warnLaneRateLimited } from "./hold.js"

/** The most a withdraw holds its caller, gate call, wake publish and promote together. */
export const LANE_WITHDRAW_DEADLINE_MS = 5_000

let waker: ((targets: WakeTarget[]) => Promise<void>) | null = null

/** Who promotes the parked jobs a withdraw handed a reserved slot to, in this process (the park module). */
export function registerWithdrawWaker(fn: (targets: WakeTarget[]) => Promise<void>): void {
  waker = fn
}

/** For tests: no waker. */
export function resetWithdrawWakerForTests(): void {
  waker = null
}

/** Resolves with `promise`, or false once `ms` have passed (the timer never outlives it). */
function withinDeadline(promise: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
    timer.unref?.()
  })
  return Promise.race([promise.then(() => true), deadline]).finally(() => clearTimeout(timer))
}

async function withdrawAndWake(jobId: string): Promise<void> {
  let targets: WakeTarget[]
  try {
    targets = await (await loadConcurrencyGate()).withdraw(jobId)
  } catch (err) {
    warnLaneRateLimited("could not withdraw a job from its lane", err)
    return
  }
  if (targets.length === 0 || !waker) return
  try {
    await waker(targets)
  } catch (err) {
    // The reservation stands and the gate published the wake; the waiter's backstop brings it back.
    warnLaneRateLimited("could not wake the waiter a withdraw handed its slot to", err)
  }
}

/**
 * Take a job (or a run, by its id) out of its line and any server-share wait,
 * and wake whoever gets the slot it held reserved. Idempotent; never throws
 * (a failure is logged at most once a minute); returns within
 * LANE_WITHDRAW_DEADLINE_MS.
 */
export async function withdrawFromLane(jobId: string): Promise<void> {
  if (!jobId) return
  // withdrawAndWake never rejects: every step catches and logs.
  if (!(await withinDeadline(withdrawAndWake(jobId), LANE_WITHDRAW_DEADLINE_MS))) {
    warnLaneRateLimited("a withdraw did not finish in time; its caller went on", new Error(`no answer within ${LANE_WITHDRAW_DEADLINE_MS} ms`))
  }
}
