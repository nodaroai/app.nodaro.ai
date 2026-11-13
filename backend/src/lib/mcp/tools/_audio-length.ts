/**
 * The longest audio the lip-sync route accepts as `audioDurationSec` (its Zod
 * bound). The value is accepted and never read: the route measures the audio
 * of every model priced by its length itself (decided 2026-11-13).
 */
export const MAX_LIP_SYNC_AUDIO_SEC = 600
