import type { Job } from "bullmq"
import { config } from "../../lib/config.js"
import { setJobProgress, type JobContext } from "../shared.js"

/**
 * Who actually ran a Suno job — written to `jobs.provider` (#753).
 *
 * The jobs.provider vocabulary, not the reconcile ProviderKind
 * (`providerKindForSuno()` returns "kie-suno", which keys the reconcile
 * probes): "kie" matches the KIE registry id, "nodaro" matches
 * NODARO_PROVIDER_ID — the same values every router-finalized job records.
 * REQUIRED on every finalize tail so tsc forces the next completion path
 * added here to attribute itself; the Suno handlers finalize via
 * markJobCompleted directly (never through job-finalize.ts), so they are the
 * only writers.
 */
export type SunoProviderUsed = "nodaro" | "kie"

/** True when this install has no KIE key and a live nodaro.ai connection. */
export async function shouldRunSunoOnCloud(): Promise<boolean> {
  if (config.KIE_API_KEY) return false
  const { isNodaroConnected } = await import("../../lib/nodaro-connect.js")
  return isNodaroConnected().catch(() => false)
}

/**
 * Cloud output for the four BESPOKE Suno operations (#643) — lyrics, separate,
 * music-video, convert-wav. They don't share the multi-track finalizer, so
 * instead of reshaping into a SunoTaskResult this hands the caller the cloud's
 * raw `output_data`; the per-operation adapter in each handler then feeds the
 * SAME local persistence tail a KIE result would take. Returns null when this
 * install should run the operation itself (has a key, or isn't connected).
 */
export async function maybeSunoCloudOutput(
  job: Job,
  ctx: JobContext,
  jobType: string,
): Promise<Record<string, unknown> | null> {
  if (!(await shouldRunSunoOnCloud())) return null
  const { runJobOnCloud } = await import("../../providers/nodaro/run-on-cloud.js")
  return runJobOnCloud(jobType, job.data as Record<string, unknown>, (p) =>
    setJobProgress(job, ctx.jobId, Math.min(45, Math.round(p * 0.45))),
  )
}

/** The cloud's `sunoTaskId`, or a marker when the field didn't survive. */
export function cloudTaskId(output: Record<string, unknown>): string {
  return typeof output.sunoTaskId === "string" ? output.sunoTaskId : "cloud"
}
