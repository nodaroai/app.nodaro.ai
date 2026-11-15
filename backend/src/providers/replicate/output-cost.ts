import { probeVideoStreamDurationSource } from "../video/ffmpeg-utils.js"

// Replicate bills this model per OUTPUT second, not GPU prediction runtime.
// https://replicate.com/sync/lipsync-2-pro (verified 2026-09-14).
export const LIPSYNC_2_PRO_USD_PER_OUTPUT_SECOND = 0.08325

export async function replicateOutputCost(model: string, outputUrl: string): Promise<number | null> {
  if (model !== "lipsync-2-pro") return null
  try {
    const seconds = await probeVideoStreamDurationSource(outputUrl)
    if (Number.isFinite(seconds) && seconds > 0) return seconds * LIPSYNC_2_PRO_USD_PER_OUTPUT_SECOND
  } catch {
    // Missing duration is unknown cost. Never substitute GPU runtime, input
    // duration or a credit reservation bucket for output-based billing.
    console.warn("[replicate:cost] Could not measure lip-sync output duration")
  }
  return null
}
