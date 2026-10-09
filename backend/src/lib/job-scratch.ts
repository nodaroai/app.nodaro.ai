/**
 * A job's temporary provider uploads: written into the job's scratch folder,
 * deleted when the job ends (decided 2026-10-09, independent review of the
 * expiry walk).
 *
 * These copies used to take keys of their own (`randomUUID()`, a timestamp,
 * the job id inside a free-form name) that no output names, so neither the
 * expiry walk nor anything else ever deleted them, and two of them were
 * counted against the user's storage quota for good. Now every one is
 * written by the two writers below, into `tmp/provider-input/<jobId>/`
 * (`job-scratch-keys.ts`), and:
 *
 *   - the video worker calls `discardJobScratch` in a `finally` around the
 *     one place it dispatches a handler, so the folder is emptied on success,
 *     failure and cancel alike (`video-worker-scratch-wiring.test.ts`);
 *   - the delete goes through the storage-delete funnel, so a file storage
 *     did not delete is recorded for the daily retry pass;
 *   - a folder a job's end never reached (a crashed attempt, a job the
 *     reconcile cron ended) is deleted by the daily age sweep once it is
 *     7 days old (`job-scratch-sweep.ts`);
 *   - nothing here counts against anyone's quota: a scratch copy is infra,
 *     like a media proxy, so there is nothing to give back when it goes, on
 *     any path (a delete the retry pass finishes later included).
 *
 * The folder is kept while the job is still in flight: a BullMQ retry, a
 * drain hand-back or a provider task left for the reconcile cron may still
 * need what the provider fetches. A parked job (`pending_review`) has its
 * media already, so its inputs go.
 *
 * `job-output-files-census.test.ts` fails the build on a storage writer whose
 * key is neither in a job's family, nor in its scratch folder, nor listed with
 * a reason — and no reason may describe a staging copy.
 */
import { supabase } from "./supabase.js"
import { isStorageConfigured, listObjectsByPrefixWithMeta, uploadBufferToR2, uploadFileWithKeyToR2 } from "./storage.js"
import { deleteKeysRecordingFailures } from "./storage-delete.js"
import { getJobId } from "./job-cancellation.js"
import { isParkedJobStatus, TERMINAL_JOB_STATUSES } from "./job-status.js"
import { isScratchJobId, jobScratchKey, jobScratchPrefix } from "./job-scratch-keys.js"

export { JOB_SCRATCH_ROOT, jobScratchKey, jobScratchPrefix } from "./job-scratch-keys.js"

/**
 * Store `buffer` in the scratch folder of `jobId` (default: the job whose
 * handler is running). Returns its url. Counted against no one's quota.
 */
export async function uploadJobScratchBuffer(
  buffer: Buffer,
  name: string,
  ext: string,
  contentType: string,
  jobId: string | undefined = getJobId(),
): Promise<string> {
  const key = jobScratchKey(jobId, name, ext)
  return uploadBufferToR2(buffer, key, contentType)
}

/**
 * Stream the local file at `filePath` into the scratch folder of `jobId`
 * (default: the job whose handler is running). Returns its url. Counted
 * against no one's quota.
 */
export async function uploadJobScratchFile(
  filePath: string,
  name: string,
  ext: string,
  contentType: string,
  jobId: string | undefined = getJobId(),
): Promise<string> {
  const key = jobScratchKey(jobId, name, ext)
  return uploadFileWithKeyToR2(filePath, key, contentType)
}

/** Whether the job's provider work is over: a terminal status, or parked on a reviewer. */
function hasEnded(status: string): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status) || isParkedJobStatus(status)
}

/**
 * Empty the job's scratch folder once the job has ended. An empty folder
 * costs one listing and no database read. Never throws.
 */
export async function discardJobScratch(jobId: string): Promise<void> {
  // Everything inside the try: this runs in the worker's `finally`, where a
  // throw would replace the error it is unwinding (a drain hand-back).
  try {
    if (!isStorageConfigured() || !isScratchJobId(jobId)) return
    const prefix = jobScratchPrefix(jobId)
    const listed = await listObjectsByPrefixWithMeta(prefix)
    // Listed BY the prefix, re-asserted anyway: this is the last check before a delete.
    const keys = listed.map((o) => o.key).filter((key) => key.startsWith(prefix))
    if (keys.length === 0) return

    const { data, error } = await supabase.from("jobs").select("status").eq("id", jobId).maybeSingle()
    const status = (data as { status?: string } | null)?.status
    if (error || !status || !hasEnded(status)) return

    const { failed } = await deleteKeysRecordingFailures(keys, "job-scratch", { jobIdOf: () => jobId })
    if (failed.length > 0) {
      console.warn(`[job-scratch] Job ${jobId}: ${failed.length} scratch file(s) not deleted, recorded for retry`)
    }
  } catch (err) {
    console.error(`[job-scratch] Emptying job ${jobId}'s scratch folder failed:`, err)
  }
}
