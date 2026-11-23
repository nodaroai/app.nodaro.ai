/**
 * The cover's own limit (decided 2026-11-23, review round): a change that
 * sends a cover reads, decodes and copies a file of up to 10 MB, so each
 * user may send at most `JOB_COVER_WRITE_LIMIT.max` of them a minute — asked
 * by `updateJobOwnerFields` (lib/job-update.ts), the one place every surface
 * goes through (`PATCH /v1/jobs/:id`, MCP `update_job`), so no surface can
 * skip it. On top of each surface's own request limit.
 *
 * Per process, in memory, like the request limiter (app.ts): a fixed window
 * per user. The map is pruned of finished windows when it grows, so it stays
 * bounded by the users active in the last minute.
 */
export const JOB_COVER_WRITE_LIMIT = { max: 20, windowMs: 60_000 } as const

/** Above this many users, finished windows are dropped before a new one is added. */
const PRUNE_ABOVE = 10_000

const windows = new Map<string, { startedAt: number; count: number }>()

export type CoverWriteVerdict = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSec: number }

/** Count one cover change for `userId`; refused once the user's window is full. */
export function takeCoverWrite(userId: string, now: number = Date.now()): CoverWriteVerdict {
  const current = windows.get(userId)
  if (!current || now - current.startedAt >= JOB_COVER_WRITE_LIMIT.windowMs) {
    if (!current && windows.size >= PRUNE_ABOVE) {
      for (const [user, w] of windows) if (now - w.startedAt >= JOB_COVER_WRITE_LIMIT.windowMs) windows.delete(user)
    }
    windows.set(userId, { startedAt: now, count: 1 })
    return { allowed: true }
  }
  if (current.count >= JOB_COVER_WRITE_LIMIT.max) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((current.startedAt + JOB_COVER_WRITE_LIMIT.windowMs - now) / 1000)) }
  }
  windows.set(userId, { startedAt: current.startedAt, count: current.count + 1 })
  return { allowed: true }
}

/** For tests: forget every window. */
export function resetCoverWriteLimitForTests(): void {
  windows.clear()
}
