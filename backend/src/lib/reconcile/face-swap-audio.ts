/**
 * A Face Swap finished by the reconcile cron (or a stall re-pick) keeps the
 * source clip's sound, as its worker's delivery does (`uploadSwapWithSourceAudio`).
 *
 * The swap model returns the picture only. The worker lays the source's audio
 * back on before it uploads; a job whose worker did not live to see the
 * prediction finish is delivered here instead, and used to deliver the silent
 * picture as it came back.
 *
 * The swap with its sound is stored in the job's scratch folder: finalize
 * stores the delivered copy (and its watermark) from it, as it stores any
 * recovered result. Best-effort, like the worker: the provider has delivered
 * and billed, so a source with no sound, a job with no source link on record,
 * or a failed download or mux delivers the swap as it came back.
 */
import { cleanupWorkDir, createWorkDir } from "../../providers/video/ffmpeg-utils.js"
import { swapWithSourceAudio } from "../../workers/handlers/face-swap-audio.js"

/**
 * The swap to deliver for a recovered Face Swap: a scratch copy with the
 * source's sound, or undefined to deliver the provider's result as it is.
 */
export async function recoveredFaceSwapWithAudio(
  row: { id: string; job_type: string | null | undefined; input_data?: Record<string, unknown> | null },
  swapUrl: string,
): Promise<string | undefined> {
  if (row.job_type !== "face-swap") return undefined
  const sourceUrl = row.input_data?.videoUrl
  if (typeof sourceUrl !== "string" || sourceUrl.trim() === "") return undefined

  const workDir = await createWorkDir("face-swap-audio-recovered")
  try {
    const local = await swapWithSourceAudio(workDir, swapUrl, sourceUrl, row.id)
    // A failed restore, or a silent source: the result as it came back.
    if (!local?.hasSourceAudio) return undefined
    // Lazy: job-scratch opens the storage client, which a reconcile tick of any other type never needs.
    const { uploadJobScratchFile } = await import("../job-scratch.js")
    return await uploadJobScratchFile(local.path, "face-swap-audio", "mp4", "video/mp4", row.id)
  } catch (err) {
    console.warn(
      `[reconcile/replicate] face-swap ${row.id}: could not store the swap with its sound, delivering it as returned: ${err instanceof Error ? err.message : String(err)}`,
    )
    return undefined
  } finally {
    await cleanupWorkDir(workDir)
  }
}
