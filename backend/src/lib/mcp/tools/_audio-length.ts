import { probeMediaDuration } from "../../../providers/video/ffmpeg-utils.js"

/** The longest audio the lip-sync route accepts as `audioDurationSec` (its Zod bound). */
export const MAX_LIP_SYNC_AUDIO_SEC = 600

/**
 * An audio file's length in seconds, rounded UP to 0.1 s, for a per-second lip-sync model's
 * reservation. `undefined` when it cannot be read (a probe failure, an unreadable or out-of-range
 * length): the route then reserves its largest bucket, exactly as before this helper existed, so
 * measuring can only ever lower a reservation.
 */
export async function measuredAudioSeconds(url: string): Promise<number | undefined> {
  try {
    const seconds = await probeMediaDuration(url)
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined
    const rounded = Math.ceil(seconds * 10) / 10
    return rounded <= MAX_LIP_SYNC_AUDIO_SEC ? rounded : undefined
  } catch {
    return undefined
  }
}
