import { config } from "../config.js"
import { supabase } from "../supabase.js"
import { uploadBufferToR2 } from "../storage.js"
import { finalizeJobWithMedia } from "../job-finalize.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { bumpAttemptsOrExhaust } from "./bump-attempts.js"

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
}

async function fetchDubbingMetadata(
  dubbingId: string,
): Promise<DubbingMetadata | null> {
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/dubbing/${dubbingId}`,
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

async function downloadDubbingAudio(
  dubbingId: string,
  targetLang: string,
): Promise<Buffer | null> {
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/dubbing/${dubbingId}/audio/${targetLang}`,
      { headers: { "xi-api-key": config.ELEVENLABS_API_KEY ?? "" } },
    )
    if (!res.ok) return null
    const arrayBuf = await res.arrayBuffer()
    return Buffer.from(arrayBuf)
  } catch {
    return null
  }
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
export async function reconcileElevenLabsJob(row: ElevenLabsJobRow): Promise<void> {
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

  // status=dubbed — fetch the audio + upload to R2
  const targetLang = (row.input_data?.targetLanguage as string | undefined)
    ?? meta.target_languages?.[0]
    ?? "en"
  const audioBuffer = await downloadDubbingAudio(row.provider_task_id, targetLang)
  if (!audioBuffer) {
    await bumpAttemptsOrExhaust(row.id, "audio download failed")
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
    const r2Url = await uploadBufferToR2(
      audioBuffer,
      `audio/${row.id}.mp3`,
      "audio/mpeg",
      userId,
    )

    await finalizeJobWithMedia({
      jobId: row.id,
      jobType: "text-to-audio",
      result: { url: r2Url, cost: null, providerUsed: "elevenlabs-dubbing" },
      mediaUrl: r2Url,
    })
  } catch (err) {
    await bumpAttemptsOrExhaust(row.id, err)
  }
}
