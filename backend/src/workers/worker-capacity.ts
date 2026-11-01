/**
 * Per-process capacity groups of the video worker (decided 2026-11-01): the
 * background scrapes hold a worker slot mostly waiting on I/O for up to ~10
 * minutes each, so one account's burst could fill the whole media pool. At
 * most `VIDEO_WORKER_SCRAPE_CONCURRENCY` scrapes run in one process at once.
 *
 * This is a capacity guard, not a concurrency lane: it is active whatever the
 * lanes' switch says, and a job over it is neither failed nor counted as a
 * stall. It is handed back to the queue's delayed set — the BullMQ slot frees
 * at once, nothing on its row changes, no attempt is spent (the quiet-stop and
 * drain primitive) — and promoted, oldest first, when one of this process's
 * jobs of its group ends. A job deferred again keeps its place. The backstop
 * delay is what wakes it when the process that deferred it never frees a slot
 * (another replica's capacity, or a restart).
 */
import { DelayedError, type Job } from "bullmq"
import { config } from "../lib/config.js"

/** How long a deferred job waits before it looks again when nothing promotes it. */
export const CAPACITY_RECHECK_MS = 15_000

export type CapacityGroupName = "scrape"

/** Each group's per-process cap. */
export function capacityOf(group: CapacityGroupName): number {
  switch (group) {
    case "scrape":
      return config.VIDEO_WORKER_SCRAPE_CONCURRENCY ?? 10
  }
}

interface Waiter {
  readonly id: string
  readonly job: Job
}

const running = new Map<CapacityGroupName, number>()
const waiting = new Map<CapacityGroupName, Waiter[]>()

/** Take a place in `group` for the job `jobId`; false when the group is at its cap here. */
export function enterCapacity(group: CapacityGroupName, jobId: string): boolean {
  const n = running.get(group) ?? 0
  if (n >= capacityOf(group)) return false
  running.set(group, n + 1)
  // Running now: no longer one of this process's waiters.
  const queue = waiting.get(group)
  if (queue) waiting.set(group, queue.filter((w) => w.id !== jobId))
  return true
}

/** Give the place back, and promote this group's oldest job this process deferred (best effort, never throws). */
export async function leaveCapacity(group: CapacityGroupName): Promise<void> {
  running.set(group, Math.max(0, (running.get(group) ?? 0) - 1))
  const queue = waiting.get(group) ?? []
  while (queue.length > 0) {
    const next = queue.shift()!
    try {
      await next.job.promote()
      return
    } catch {
      // No longer delayed: its backstop already moved it, another process ran it, or it was removed.
    }
  }
}

/**
 * Hand `job` back to the queue's delayed set until a place frees, holding no
 * worker slot; throws BullMQ's DelayedError (the processor's way to end
 * without completing or failing). A job deferred again keeps its place in line.
 */
export async function deferForCapacity(group: CapacityGroupName, job: Job, token: string | undefined): Promise<never> {
  const queue = waiting.get(group) ?? []
  const id = String(job.id)
  if (!queue.some((w) => w.id === id)) queue.push({ id, job })
  waiting.set(group, queue)
  await job.moveToDelayed(Date.now() + CAPACITY_RECHECK_MS, token)
  throw new DelayedError()
}

/**
 * Run `process` for a job of capacity group `group` (none: at once). A job
 * over its group's per-process cap waits on the queue holding no worker slot
 * (deferForCapacity), before anything else: no row read, no lane slot, no
 * pickup claim. Its place is given back however `process` ends.
 */
export async function runWithinCapacity<T>(
  group: CapacityGroupName | undefined,
  job: Job,
  token: string | undefined,
  process: (job: Job, token?: string) => Promise<T>,
): Promise<T> {
  if (!group) return process(job, token)
  if (!enterCapacity(group, String(job.id))) return deferForCapacity(group, job, token)
  try {
    return await process(job, token)
  } finally {
    await leaveCapacity(group)
  }
}

/** What runs and waits here, by group (tests, diagnostics). */
export function capacitySnapshot(group: CapacityGroupName): { running: number; waiting: number; cap: number } {
  return { running: running.get(group) ?? 0, waiting: (waiting.get(group) ?? []).length, cap: capacityOf(group) }
}

export function resetCapacityForTests(): void {
  running.clear()
  waiting.clear()
}
