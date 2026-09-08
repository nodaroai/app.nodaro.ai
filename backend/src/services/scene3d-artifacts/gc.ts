import {
  callScene3DClaimGc,
  callScene3DCompleteGc,
  callScene3DSweepExpired,
  callScene3DSweepExpiredIntents,
} from "./db.js"
import type { Scene3DObjectStore } from "./object-store.js"

/**
 * Retention, in two halves that must not be one.
 *
 * **Metadata first.** `sweepExpiredScene3DArtifacts` deletes expired,
 * *unpinned* artifact rows. That is the step that revokes access: the moment
 * the row is gone no read can resolve, whatever is still sitting in the
 * bucket. It never touches an artifact a retained revision pins — the sweep
 * checks, and the pin's foreign key refuses independently, so a bug in the
 * check cannot cost somebody a scene they still have open.
 *
 * **Objects second, durably.** Deleting the row fires a trigger that writes a
 * `scene3d_artifact_gc` task in the same transaction, so the cleanup task
 * exists exactly when the metadata stops existing — including when the rows go
 * away by cascade, because the user or the workflow was deleted. A worker then
 * claims tasks with an attempt clock, deletes the object, and marks the task
 * resolved. Crash anywhere in that sequence and the task is still pending; the
 * next pass past `retryAfter` picks it up, and deleting an object twice is
 * free.
 *
 * Tasks are never removed. The row is also the artifact id's tombstone: once
 * cleanup has heard of an id, nothing may reserve or publish it again, which is
 * the only thing that closes the window where a worker holds a claim it has not
 * executed yet.
 *
 * Root wires the schedule. Both halves are safe to run concurrently with
 * anything, including themselves.
 */

export const SCENE3D_GC_DEFAULT_LIMIT = 50
export const SCENE3D_GC_DEFAULT_RETRY_AFTER = "10 minutes"

export async function sweepExpiredScene3DArtifacts(
  options: { limit?: number } = {},
): Promise<number> {
  return callScene3DSweepExpired(Math.max(0, options.limit ?? SCENE3D_GC_DEFAULT_LIMIT))
}

/**
 * Reservations whose upload window and grace period have both passed.
 *
 * The other half of retention: an artifact row covers bytes that were
 * published, and this covers bytes that never were — a build that failed after
 * writing its output. Publication consumes a reservation in the same
 * transaction that makes its bytes readable, so this can only ever reach the
 * abandoned ones.
 */
export async function sweepExpiredScene3DUploadIntents(
  options: { limit?: number } = {},
): Promise<number> {
  return callScene3DSweepExpiredIntents(Math.max(0, options.limit ?? SCENE3D_GC_DEFAULT_LIMIT))
}

export interface Scene3DGcOutcome {
  claimed: number
  deleted: number
  /** Tasks left alone because they name a bucket this process does not own. */
  skipped: number
  /** Tasks whose object delete failed; they stay for the next pass. */
  failed: number
}

export async function runScene3DArtifactGcBatch(
  store: Scene3DObjectStore,
  options: { limit?: number; retryAfter?: string } = {},
): Promise<Scene3DGcOutcome> {
  const tasks = await callScene3DClaimGc(
    Math.max(0, options.limit ?? SCENE3D_GC_DEFAULT_LIMIT),
    options.retryAfter ?? SCENE3D_GC_DEFAULT_RETRY_AFTER,
  )
  const outcome: Scene3DGcOutcome = { claimed: tasks.length, deleted: 0, skipped: 0, failed: 0 }

  for (const task of tasks) {
    // A task naming another bucket is not this worker's to run. The public
    // media bucket is one misconfiguration away from being named here, and a
    // cleanup worker that deletes from it would delete users' finished videos.
    if (task.bucket !== store.bucket) {
      outcome.skipped += 1
      continue
    }
    try {
      await store.delete(task.objectKey)
      await callScene3DCompleteGc(task.artifactId)
      outcome.deleted += 1
    } catch {
      // Left in place on purpose — the attempt clock will offer it again.
      outcome.failed += 1
    }
  }
  return outcome
}
