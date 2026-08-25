/**
 * YouTube-audio extraction as one shared flow: submit the job, poll to a
 * terminal state, return the audio URL.
 *
 * Two callers, on purpose: the reference-audio CONFIG PANEL (the manual
 * Extract button) and the reference-audio NODE itself (auto-extraction for a
 * node whose `youtubeUrl` arrived without the panel ever mounting — written by
 * the copilot, an import, or a template). A panel-only flow is the classic
 * fail-safe trap: effects in a panel run only while that panel is open.
 */
import { extractYouTubeAudioApi, getJobStatusLean } from "@/lib/api"

const POLL_INTERVAL_MS = 2000

/** Resolves with the extracted audio URL; rejects on a failed job. */
export async function runYouTubeAudioExtraction(youtubeUrl: string): Promise<string> {
  const { jobId } = await extractYouTubeAudioApi(youtubeUrl)
  for (;;) {
    const status = await getJobStatusLean(jobId)
    if (status.status === "completed" && status.output_data?.audioUrl) {
      return status.output_data.audioUrl
    }
    if (status.status === "failed") {
      throw new Error(status.error_message ?? "Extraction failed")
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}
