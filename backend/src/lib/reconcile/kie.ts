import { variantJobId } from "@nodaro/shared"
import { supabase } from "../supabase.js"
import { uploadToR2 } from "../storage.js"
import {
  pollKieTask,
  pollVeoTask,
  runVeo1080pTask,
  isUpstreamKieFailure,
} from "../../providers/kie/client.js"
import { pollKling3Task } from "../../providers/kie/kling3-client.js"
import { pollKontextTask } from "../../providers/kie/kontext-client.js"
import { pollLumaTask } from "../../providers/kie/luma-client.js"
import { pollRunwayTask, pollAlephTask } from "../../providers/kie/runway-client.js"
import { pollSunoTask, type SunoTaskResult } from "../../providers/kie/suno-client.js"
import { finalizeJobWithMedia, type FinalizeJobType, type FinalizeClaimant } from "../job-finalize.js"
import { loopTrimAddonForReconcile } from "./loop-trim-refund.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { bumpAttemptsOrExhaust } from "./bump-attempts.js"

export interface KieJobRow {
  id: string
  provider_kind: string | null
  provider_task_id: string | null
  reconcile_attempts: number
  job_type: string | null
  input_data?: Record<string, unknown> | null
}

/** Caller identity for the finalize claim (audit H1). The cron omits it
 *  (default "cron"); the worker's stall re-pick passes "worker" via
 *  tryInlineReconcile so it can re-claim its crashed predecessor's claim. */
export interface ReconcileOpts {
  claimant?: FinalizeClaimant
}

/** Suno music job_types whose poll shape matches `SunoTaskResult` (multi-track
 *  audio). Other Suno operations (lyrics, separate, music-video, wav) use
 *  different poll endpoints + return shapes; bumped via the shared cap helper
 *  and force-failed at attempt 18 if still stuck. */
const SUNO_MUSIC_JOB_TYPES: ReadonlySet<string> = new Set([
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-mashup",
  "suno-replace-section",
  "suno-add-instrumental",
  "suno-add-vocals",
  "suno-upload-extend",
])

/** Single-attempt poll dispatcher. Returns the recovered URL(s) on success;
 *  throws when the upstream task is still running OR has terminally failed.
 *  Caller distinguishes terminal failure via `isUpstreamKieFailure(err)` (the
 *  structured flag) vs transient (timeout/network → bump). */
async function singlePoll(row: KieJobRow): Promise<{
  url: string
  extraUrls: readonly string[]
  providerMs?: number
}> {
  if (!row.provider_task_id) throw new Error("no provider_task_id")
  const id = row.provider_task_id

  switch (row.provider_kind) {
    case "kie-standard":
    case "kie-lip-sync": {
      // Kling avatar / InfiniTalk use the standard /jobs/recordInfo endpoint.
      const r = await pollKieTask(id, 1)
      const urls = r.resultJson.resultUrls ?? (
        r.resultJson.videoUrl ? [r.resultJson.videoUrl]
        : r.resultJson.audioUrl ? [r.resultJson.audioUrl]
        : []
      )
      if (!urls[0]) throw new Error("KIE success but no result URL")
      return { url: urls[0]!, extraUrls: urls.slice(1), providerMs: r.providerMs }
    }
    case "kie-veo": {
      const r = await pollVeoTask(id, "VEO")
      const urls = r.resultUrls
      if (!urls?.[0]) throw new Error("VEO success but no resultUrls")
      return { url: urls[0]!, extraUrls: urls.slice(1), providerMs: r.providerMs }
    }
    case "kie-veo-1080p": {
      // Quasi-sync GET /api/v1/veo/get-1080p-video with the PARENT kieTaskId
      // (the 1080p endpoint reuses the original VEO task's id; there is no
      // separate 1080p task). One-shot poll — `runVeo1080pTask` itself retries
      // internally if still processing, but for the reconcile path we just
      // attempt once and let `bumpAttemptsOrExhaust` re-fire on the next tick.
      const r = await runVeo1080pTask(id)
      return { url: r.url, extraUrls: [] }
    }
    case "kie-kling3": {
      const videoUrl = await pollKling3Task(id)
      return { url: videoUrl, extraUrls: [] }
    }
    case "kie-kontext": {
      const r = await pollKontextTask(id, 1)
      const urls = r.resultJson.resultUrls ?? []
      if (!urls[0]) throw new Error("Kontext success but no resultUrls")
      return { url: urls[0]!, extraUrls: urls.slice(1) }
    }
    case "kie-luma": {
      const r = await pollLumaTask(id, 1)
      const urls = r.resultJson.resultUrls ?? []
      if (!urls[0]) throw new Error("Luma success but no resultUrls")
      return { url: urls[0]!, extraUrls: urls.slice(1) }
    }
    case "kie-runway": {
      const videoUrl = await pollRunwayTask(id, "Runway")
      return { url: videoUrl, extraUrls: [] }
    }
    case "kie-aleph": {
      // Runway Aleph (v2v) uses `/api/v1/aleph/record-info` — DIFFERENT
      // endpoint from `kie-runway` (`/api/v1/runway/record-detail`). Wiring
      // through `kie-standard` (the old default) sent reconcile to the wrong
      // endpoint and force-failed every Aleph row after 18 attempts.
      const videoUrl = await pollAlephTask(id)
      return { url: videoUrl, extraUrls: [] }
    }
    case "kie-suno": {
      // Suno reconcile is handled via reconcileKieSunoJob (multi-track output).
      // singlePoll is only used for single-URL kinds; this path is unreachable
      // because the caller branches on kie-suno before reaching singlePoll.
      throw new Error("kie-suno should be handled by reconcileKieSunoJob")
    }
    default:
      throw new Error(`unknown KIE provider_kind: ${row.provider_kind}`)
  }
}

/**
 * Suno-specific reconcile: poll the music task, upload all tracks to R2 under
 * variant-suffixed keys, then call finalize with `mediaUrl` = primary track
 * and `extraOutputData` carrying the full multi-track metadata. This preserves
 * the same output_data shape the worker handler writes via uploadAllSunoTracks.
 */
async function reconcileKieSunoJob(row: KieJobRow, opts?: ReconcileOpts): Promise<void> {
  if (!row.provider_task_id) return
  if (!row.job_type || !SUNO_MUSIC_JOB_TYPES.has(row.job_type)) {
    // Suno variant we don't recover (lyrics, separate, music-video, wav).
    await bumpAttemptsOrExhaust(row.id, `suno variant not recoverable: ${row.job_type}`)
    return
  }

  // Get user_id for the R2 upload key (variantJobId paths land under the user's
  // namespace).
  const { data: jobUser } = await supabase
    .from("jobs")
    .select("user_id")
    .eq("id", row.id)
    .single()
  const userId = (jobUser as { user_id?: string } | null)?.user_id ?? undefined

  let result: SunoTaskResult
  try {
    result = await pollSunoTask(row.provider_task_id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Same shared classifier as reconcileKieJob — pollSunoTask sets the flag via
    // createUpstreamFailureError, so a terminal Suno failure fails fast + refunds
    // instead of riding to the 18-attempt exhaustion (the old msg.includes match
    // never matched the sanitized message).
    if (isUpstreamKieFailure(err)) {
      await markFailed(row.id, msg)
      await refundReservedCreditsForJob(row.id)
    } else {
      await bumpAttemptsOrExhaust(row.id, err)
    }
    return
  }

  const validTracks = result.tracks.filter((t) => t.audioUrl)
  if (validTracks.length === 0) {
    await markFailed(row.id, "Suno returned no tracks")
    await refundReservedCreditsForJob(row.id)
    return
  }

  // P0.1 (audit Blocker B1): uploads + finalize must bump on failure — same
  // rationale as reconcileKieJob's post-poll wrap (deterministic failures
  // must exhaust to refund+anomaly, never loop forever).
  try {
    // Upload each track to R2 under variant-suffixed keys (matches the worker
    // handler's uploadAllSunoTracks).
    const r2Urls = await Promise.all(
      validTracks.map((t, i) =>
        uploadToR2(t.audioUrl, variantJobId(row.id, i), "audio", userId),
      ),
    )
    const primary = validTracks[0]!

    await finalizeJobWithMedia({
      jobId: row.id,
      jobType: "generate-music",
      claimant: opts?.claimant ?? "cron",
      result: { url: r2Urls[0]!, cost: null, providerUsed: "suno" },
      mediaUrl: r2Urls[0]!,
      extraOutputData: {
        ...(r2Urls.length > 1 ? { audioUrls: r2Urls } : {}),
        sunoTrackId: primary.id,
        sunoTitle: primary.title,
        sunoDuration: primary.duration,
        sunoImageUrl: primary.imageUrl,
        sunoTaskId: result.taskId,
        sunoTracks: validTracks.map((t, i) => ({
          id: t.id,
          title: t.title,
          duration: t.duration,
          imageUrl: t.imageUrl,
          audioUrl: r2Urls[i]!,
        })),
        trackCount: validTracks.length,
      },
    })
  } catch (err) {
    await bumpAttemptsOrExhaust(row.id, err)
  }
}

async function markFailed(jobId: string, reason: string): Promise<void> {
  // CAS on the non-terminal precondition (not just `.neq("cancelled")`) so a job
  // the worker concurrently flipped to `completed` (or `cancelled`/`failed`) is
  // never trampled to `failed`. Matches sweepStaleSyncJob / forceFailExhausted.
  await supabase
    .from("jobs")
    .update({
      status: "failed",
      error_message: reason.slice(0, 500),
      completed_at: new Date().toISOString(),
      reconcile_last_error: "upstream_failed",
    })
    .eq("id", jobId)
    .in("status", ["pending", "processing"])
}

/**
 * Reconcile a stuck KIE job. Polls the upstream task once via the right
 * `pollX` for the row's `provider_kind`, then:
 *   - on success: forwards the result URLs to `finalizeJobWithMedia` so
 *     output_data gets written, credits commit, asset row created, workflow
 *     execution reopens if sole-cause.
 *   - on upstream failure (`isUpstreamKieFailure(err)`): marks the job
 *     failed + refunds reserved credits.
 *   - on transient (still running, network blip): bumps `reconcile_attempts`
 *     and leaves the row in place for the next cron tick.
 */
export async function reconcileKieJob(row: KieJobRow, opts?: ReconcileOpts): Promise<void> {
  if (!row.provider_task_id) return

  // Suno is a special case: multi-track output, dedicated upload + finalize path.
  if (row.provider_kind === "kie-suno") {
    return reconcileKieSunoJob(row, opts)
  }

  let result: { url: string; extraUrls: readonly string[]; providerMs?: number }
  try {
    result = await singlePoll(row)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Classify off the STRUCTURED flag via the shared isUpstreamKieFailure helper,
    // never the message text: KieError.message is sanitized (e.g. the generic
    // "Generation failed…"), so a string match silently missed every terminal
    // failure and bumped it toward the 18-attempt / 90-min exhaustion. ALL KIE
    // poll clients now set the flag (createUpstreamFailureError), so every
    // provider fails fast here — not just kie-standard.
    if (isUpstreamKieFailure(err)) {
      await markFailed(row.id, msg)
      await refundReservedCreditsForJob(row.id)
    } else {
      // still pending / transient / unsupported kind — try again next tick
      await bumpAttemptsOrExhaust(row.id, err)
    }
    return
  }

  // P0.1 (audit Blocker B1): the post-poll completion phase MUST bump
  // reconcile_attempts on failure. Without this, a poll-success-but-
  // finalize-failure propagated to the cron's per-row catch (errors++ only)
  // and a deterministic failure (size cap, bad transcode) looped at every
  // tick FOREVER — user charged, credits stranded `reserved`, no refund, no
  // anomaly. Bumping routes it into the 18-attempt exhaustion path
  // (forceFailExhausted → refund + credit_anomalies), which terminates.
  try {
    // i2v + loopTrim.enabled (single-node): the recovered RAW clip never got
    // the smart-loop-cut, so the addon comes OFF the commit. Computed here
    // (pure), applied by finalize AFTER markJobCompleted wins — committing it
    // up-front flipped the log out of `reserved` and defeated the exhaustion
    // refund when finalize kept failing (audit P0.3).
    const loopTrimAddon = loopTrimAddonForReconcile(row.job_type, row.input_data ?? null)

    await finalizeJobWithMedia({
      jobId: row.id,
      jobType: (row.job_type ?? "generate-image") as FinalizeJobType,
      claimant: opts?.claimant ?? "cron",
      ...(loopTrimAddon > 0 && { loopTrimAddonRefundCredits: loopTrimAddon }),
      result: {
        url: result.url,
        extraUrls: result.extraUrls,
        cost: null,  // committed at reservation; actual cost is unknown post-reconcile
        providerUsed: null,
        providerMs: result.providerMs,
      },
    })
  } catch (err) {
    await bumpAttemptsOrExhaust(row.id, err)
  }
}
