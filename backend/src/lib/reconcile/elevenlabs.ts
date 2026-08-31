import { config } from "../config.js"
import { supabase } from "../supabase.js"
import { deliverDubbedMedia } from "../dubbing-delivery.js"
import type { ReconcileOpts } from "./kie.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { bumpAttemptsOrExhaust } from "./bump-attempts.js"
import { ELEVENLABS_BASE_URL } from "../../providers/elevenlabs/client.js"

export interface ElevenLabsJobRow {
  id: string
  provider_kind: string | null
  provider_task_id: string | null
  reconcile_attempts: number
  job_type: string | null
  input_data: Record<string, unknown> | null
}

interface DubbingMetadata {
  dubbing_id: string
  status: "dubbing" | "dubbed" | "failed"
  target_languages?: string[]
  error?: string
  /** ElevenLabs' probe of the source — the mode authority for sourceUrl dubs. */
  media_metadata?: {
    content_type?: string
    duration?: number
  }
}

async function fetchDubbingMetadata(
  dubbingId: string,
): Promise<DubbingMetadata | null> {
  try {
    const res = await fetch(
      `${ELEVENLABS_BASE_URL}/v1/dubbing/${dubbingId}`,
      { headers: { "xi-api-key": config.ELEVENLABS_API_KEY ?? "" } },
    )
    if (!res.ok) {
      console.warn(`[reconcile/elevenlabs] GET dubbing ${dubbingId} → ${res.status}`)
      return null
    }
    return (await res.json()) as DubbingMetadata
  } catch (err) {
    console.warn(
      `[reconcile/elevenlabs] fetch ${dubbingId} threw: ${(err as Error).message}`,
    )
    return null
  }
}

async function downloadDubbedMediaBytes(
  dubbingId: string,
  targetLang: string,
  videoMode: boolean,
): Promise<Buffer | null> {
  try {
    const res = await fetch(
      `${ELEVENLABS_BASE_URL}/v1/dubbing/${dubbingId}/audio/${targetLang}`,
      {
        headers: {
          "xi-api-key": config.ELEVENLABS_API_KEY ?? "",
          Accept: videoMode ? "video/mp4" : "audio/mpeg",
        },
      },
    )
    if (!res.ok) return null
    const arrayBuf = await res.arrayBuffer()
    return Buffer.from(arrayBuf)
  } catch {
    return null
  }
}

/**
 * Which mode is this dub? The worker decided from the classified upload (or
 * ElevenLabs' probe for sourceUrl) — the cron re-derives the same answer from
 * what persisted: ElevenLabs' media_metadata when present (the authority for
 * sourceUrl dubs and honest for uploads), else the input slot as recorded in
 * input_data (a videoUrl submission is a video dub).
 */
function resolveVideoMode(meta: DubbingMetadata, inputData: Record<string, unknown> | null): boolean {
  const contentType = meta.media_metadata?.content_type
  if (typeof contentType === "string" && contentType.length > 0) {
    return contentType.startsWith("video/")
  }
  return typeof inputData?.videoUrl === "string" && inputData.videoUrl.length > 0
}

async function markFailed(jobId: string, reason: string): Promise<void> {
  await supabase
    .from("jobs")
    .update({
      status: "failed",
      error_message: reason.slice(0, 500),
      completed_at: new Date().toISOString(),
      reconcile_last_error: "upstream_failed",
    })
    .eq("id", jobId)
    // CAS on the live (non-terminal) states only — a bare .neq("status","cancelled")
    // would still trample a job the worker concurrently flipped to "completed".
    // Matches kie.ts / sync-sweep.ts (the M6 fix); these two files were missed.
    .in("status", ["pending", "processing"])
}

/**
 * Reconcile a stuck ElevenLabs dubbing job. Polls /v1/dubbing/:id once, then:
 *   - status=dubbed → download the audio, upload to R2, finalize with the URL
 *   - status=failed → markFailed + refund
 *   - status=dubbing → bumpAttemptsOrExhaust
 *
 * Audio download is required here because ElevenLabs serves dubbed audio at a
 * separate endpoint that returns the bytes directly — there's no persistent
 * URL we could pass to finalize. The handler uploads to R2, then calls finalize
 * with the R2 URL as mediaUrl.
 */
export async function reconcileElevenLabsJob(row: ElevenLabsJobRow, opts?: ReconcileOpts): Promise<void> {
  if (!row.provider_task_id) return
  if (row.provider_kind !== "elevenlabs-async") {
    await bumpAttemptsOrExhaust(row.id, `unknown elevenlabs kind: ${row.provider_kind}`)
    return
  }

  const meta = await fetchDubbingMetadata(row.provider_task_id)
  if (!meta) {
    await bumpAttemptsOrExhaust(row.id, "fetch failed")
    return
  }

  if (meta.status === "dubbing") {
    await bumpAttemptsOrExhaust(row.id, "still dubbing")
    return
  }
  if (meta.status === "failed") {
    await markFailed(row.id, meta.error ?? "elevenlabs dubbing failed")
    await refundReservedCreditsForJob(row.id)
    return
  }

  // status=dubbed — fetch the media + deliver. Video-aware: with the worker's
  // park-for-long-sources policy this lane is a NORMAL completion path, so it
  // must deliver the same shape the worker does — the shared
  // deliverDubbedMedia is that guarantee (a video dub recovered here used to
  // land as a mis-typed .mp3).
  const targetLang = (row.input_data?.targetLanguage as string | undefined)
    ?? meta.target_languages?.[0]
    ?? "en"
  const videoMode = resolveVideoMode(meta, row.input_data)
  const mediaBuffer = await downloadDubbedMediaBytes(row.provider_task_id, targetLang, videoMode)
  if (!mediaBuffer) {
    await bumpAttemptsOrExhaust(row.id, "media download failed")
    return
  }

  // Get user_id from the job row for the R2 upload key
  const { data: jobUser } = await supabase
    .from("jobs")
    .select("user_id")
    .eq("id", row.id)
    .single()
  const userId = (jobUser as { user_id?: string } | null)?.user_id ?? undefined

  // P0.1 (audit Blocker B1): upload + finalize must bump on failure so
  // deterministic failures exhaust to refund+anomaly instead of looping at
  // every cron tick forever (see kie.ts twin for the full story).
  try {
    await deliverDubbedMedia({
      jobId: row.id,
      userId,
      buffer: mediaBuffer,
      videoMode,
      // KIE-reconcile precedent: cron-recovered VIDEO skips the free-tier
      // watermark step (stated delta in the PR, not an accident).
      shouldWatermark: false,
      claimant: opts?.claimant ?? "cron",
    })
  } catch (err) {
    await bumpAttemptsOrExhaust(row.id, err)
  }
}
